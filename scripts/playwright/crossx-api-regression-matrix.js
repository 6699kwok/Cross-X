#!/usr/bin/env node
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const regressionScript = path.join(__dirname, 'crossx-api-regression.js');
const scenarios = [
  { id: 'shanghai_en', message: 'Plan a 3-day Shanghai trip in English', language: 'EN' },
  { id: 'beijing_en', message: 'Plan a 2-day Beijing trip in English', language: 'EN' },
  { id: 'shenzhen_food_en', message: 'Plan a 2-day Shenzhen food trip in English', language: 'EN' },
  { id: 'guangzhou_en', message: 'Plan a 2-day Guangzhou trip in English', language: 'EN' },
  { id: 'chengdu_en', message: 'Plan a 2-day Chengdu trip in English', language: 'EN' },
  { id: 'beijing_stay_en', message: 'Find a 2-day Beijing stay plan in English', language: 'EN' },
  { id: 'hangzhou_en', message: 'Plan a 2-day Hangzhou trip in English', language: 'EN' },
  { id: 'chongqing_en', message: 'Plan a 2-day Chongqing trip in English', language: 'EN' },
  { id: 'xian_en', message: "Plan a 2-day Xi'an trip in English", language: 'EN' },
];

const results = [];
for (const scenario of scenarios) {
  try {
    const output = execFileSync('node', [regressionScript], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        CROSSX_API_PLAN_MESSAGE: scenario.message,
        CROSSX_API_PLAN_LANGUAGE: scenario.language,
      },
    });
    const parsed = JSON.parse(output);
    results.push({ scenario: scenario.id, ...parsed });
  } catch (err) {
    const stdout = String(err.stdout || '').trim();
    let parsed = null;
    try {
      parsed = stdout ? JSON.parse(stdout) : null;
    } catch {}
    if (parsed) {
      results.push({ scenario: scenario.id, ...parsed });
    } else {
      results.push({
        scenario: scenario.id,
        ok: false,
        checkedAt: new Date().toISOString(),
        fatal: String(err && err.stack ? err.stack : err),
      });
    }
  }
}

const report = {
  ok: results.every((item) => item.ok),
  checkedAt: new Date().toISOString(),
  scenarios: results,
};

process.stdout.write(JSON.stringify(report, null, 2) + '\n');
process.exitCode = report.ok ? 0 : 1;
