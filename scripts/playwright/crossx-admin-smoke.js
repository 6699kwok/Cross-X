#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const playwrightRoots = [
  '/Users/kwok/.npm/_npx/9833c18b2d85bc59/node_modules/playwright',
  '/Users/kwok/.npm/_npx/e41f203b7505f1fb/node_modules/playwright',
];

function loadPlaywright() {
  for (const candidate of playwrightRoots) {
    try {
      return require(candidate);
    } catch {}
  }
  throw new Error('playwright package not found in local npx cache');
}

const { chromium } = loadPlaywright();
const BASE_URL = process.env.CROSSX_BASE_URL || 'http://127.0.0.1:8817/admin.html';
const PROFILE_ROOT = path.join(os.tmpdir(), 'crossx-playwright-admin-smoke');
const CHROME_EXECUTABLE = process.env.CROSSX_CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PLAYWRIGHT_LAUNCH_ARGS = [
  '--no-sandbox',
  '--disable-dev-shm-usage',
  '--disable-background-timer-throttling',
  '--disable-renderer-backgrounding',
];

function ensureCleanDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

async function launchBrowserContext(userDataDir) {
  const launchOptions = {
    headless: true,
    args: PLAYWRIGHT_LAUNCH_ARGS,
    viewport: { width: 1440, height: 1200 },
  };

  const chromeOptions = {
    ...launchOptions,
    channel: 'chrome',
    executablePath: CHROME_EXECUTABLE,
  };

  try {
    return await chromium.launchPersistentContext(userDataDir, chromeOptions);
  } catch (err) {
    const detail = String(err && err.stack ? err.stack : err);
    if (!/Target page, context or browser has been closed|SIGABRT|Executable doesn't exist/i.test(detail)) throw err;
    return chromium.launchPersistentContext(userDataDir, launchOptions);
  }
}

async function main() {
  const userDataDir = path.join(PROFILE_ROOT, `run-${Date.now()}`);
  ensureCleanDir(userDataDir);
  const context = await launchBrowserContext(userDataDir);
  const page = context.pages()[0] || await context.newPage();
  const consoleErrors = [];
  const pageErrors = [];

  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    pageErrors.push(String(err && err.message ? err.message : err));
  });

  try {
    await page.goto(BASE_URL, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForSelector('#cx-admin-key-input', { timeout: 10000 });
    await page.fill('#cx-admin-key-input', '88888888');
    await page.click('#cx-admin-login-btn');
    await page.waitForSelector('#opsSummaryGrid .ops-kpi, #opsSummaryGrid .ops-kpi-accent', { timeout: 30000 });

    const result = await page.evaluate(() => ({
      loginModalVisible: Boolean(document.querySelector('#cx-admin-login-modal')),
      summaryCount: document.querySelectorAll('#opsSummaryGrid .ops-kpi, #opsSummaryGrid .ops-kpi-accent').length,
      overviewHeading: document.querySelector('#overviewHeading')?.textContent?.trim() || '',
      merchantNav: document.querySelector('#opsNavMerchant')?.textContent?.trim() || '',
      buildTag: document.querySelector('#opsBuildTag')?.textContent?.trim() || '',
      localTokenPresent: Boolean(localStorage.getItem('cx_admin_tk')),
    }));

    console.log(JSON.stringify({ ok: true, result, consoleErrors, pageErrors }, null, 2));
  } finally {
    await context.close().catch(() => {});
  }
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, error: String(err && err.stack ? err.stack : err) }, null, 2));
  process.exit(1);
});
