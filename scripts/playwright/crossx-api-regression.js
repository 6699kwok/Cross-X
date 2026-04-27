#!/usr/bin/env node
'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const crypto = require('node:crypto');

const execFileAsync = promisify(execFile);

const BASE_URL = process.env.CROSSX_BASE_URL || 'http://127.0.0.1:8817';
const PLAN_MESSAGE = process.env.CROSSX_API_PLAN_MESSAGE || 'Plan a 3-day Shanghai trip in English';
const PLAN_LANGUAGE = process.env.CROSSX_API_PLAN_LANGUAGE || 'EN';
const MAX_MS = Number(process.env.CROSSX_API_PLAN_MAX_MS || 20000) || 20000;
const RETRY_COUNT = Number(process.env.CROSSX_API_PLAN_RETRIES || 2) || 2;
const RETRY_DELAY_MS = Number(process.env.CROSSX_API_PLAN_RETRY_DELAY_MS || 500) || 500;
const RAW_FILE = process.env.CROSSX_API_PLAN_RAW_FILE || '';
const RAW_STDIN = process.env.CROSSX_API_PLAN_RAW_STDIN === '1';
const RAW_DURATION_MS = Number(process.env.CROSSX_API_PLAN_DURATION_MS || 0) || 0;
const PLAN_DEVICE_ID = process.env.CROSSX_TEST_DEVICE_ID
  || `cx_${crypto.createHash("md5").update(`${PLAN_LANGUAGE}:${PLAN_MESSAGE}`).digest("hex")}`;
const BROKEN_SNIPPETS = [
  'localizedvibe2 is not defined',
  'localizedtip2 is not defined',
  'Here is a workable -day',
  'Di Di to ',
  'Check in at "',
];

function parseSseEvents(raw) {
  return String(raw || '')
    .split(/\n\n+/)
    .map((chunk) => chunk
      .split('\n')
      .filter((line) => line.startsWith('data: '))
      .map((line) => line.slice(6))
      .join('\n'))
    .filter(Boolean)
    .map((payload) => {
      try {
        return JSON.parse(payload);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

function collectStringLeaves(node, out = []) {
  if (out.length >= 400 || node == null) return out;
  if (typeof node === 'string') {
    const text = node.trim();
    if (text) out.push(text);
    return out;
  }
  if (Array.isArray(node)) {
    node.forEach((item) => collectStringLeaves(item, out));
    return out;
  }
  if (typeof node === 'object') {
    Object.values(node).forEach((value) => collectStringLeaves(value, out));
  }
  return out;
}

function findRecommendedHotelName(cardData) {
  const plans = Array.isArray(cardData?.plans) ? cardData.plans : [];
  const recommended = plans.find((plan) => plan && plan.is_recommended) || plans[1] || plans[0] || null;
  return String(recommended?.hotel?.name || recommended?.hotel_name || '').trim();
}

function findRecommendedVisibleName(cardData) {
  const layoutType = String(cardData?.layout_type || 'travel_full');
  const plans = Array.isArray(cardData?.plans) ? cardData.plans : [];
  const recommended = plans.find((plan) => plan && plan.is_recommended) || plans[1] || plans[0] || null;
  if (layoutType === 'food_only') return String(recommended?.name || recommended?.restaurant_name || '').trim();
  return String(recommended?.hotel?.name || recommended?.hotel_name || '').trim();
}

function inferRequestedDestination(message) {
  const text = String(message || '').trim();
  if (!text) return '';
  const stopWords = /^(food|stay|travel|trip|itinerary|plan)$/i;
  const cleanValue = (value) => String(value || '')
    .trim()
    .replace(/\s{2,}/g, ' ')
    .replace(/\b(food|stay|travel|trip|itinerary|plan)\b$/i, '')
    .trim();
  const patterns = [
    /\b(?:plan|find|need|want|book)\s+(?:a\s+\d+-day\s+)?([A-Z][A-Za-z' -]{1,40}?)\s+(?:trip|travel|stay|itinerary|plan)\b/i,
    /\b(?:trip|travel|stay|itinerary|plan)\s+(?:in|for|to)\s+([A-Z][A-Za-z' -]{1,40}?)(?=\s+(?:in\s+English|in\s+Chinese|with|for|under|on|this|next)|[,.!?]|$)/i,
    /\b(?:visit|going to|travel to|trip to)\s+([A-Z][A-Za-z' -]{1,40}?)(?=\s+(?:in\s+English|in\s+Chinese|with|for|under|on|this|next)|[,.!?]|$)/i,
    /(?:去|到|前往|出发去|飞往)\s*([一-龥]{2,10})(?=玩|旅|游|看|走|参观|出发|\s|，|。|$)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    const cleaned = cleanValue(match && match[1]);
    if (cleaned && !stopWords.test(cleaned)) return cleaned;
  }
  return '';
}

function normalizeCityToken(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[\'’]/g, '')
    .replace(/\b(city|district|province)\b/g, ' ')
    .replace(/[^a-z0-9一-鿿]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildCityAliases(value) {
  const raw = String(value || '').trim();
  const normalized = normalizeCityToken(raw);
  if (!normalized) return [];
  const aliases = new Set([normalized]);
  const aliasMap = {
    xian: ['xi an', 'xian', '西安'],
    'xi an': ['xi an', 'xian', '西安'],
    beijing: ['beijing', '北京'],
    shanghai: ['shanghai', '上海'],
    shenzhen: ['shenzhen', '深圳'],
    guangzhou: ['guangzhou', '广州'],
    chengdu: ['chengdu', '成都'],
    hangzhou: ['hangzhou', '杭州'],
    chongqing: ['chongqing', '重庆'],
  };
  for (const values of Object.values(aliasMap)) {
    const normalizedValues = values.map((item) => normalizeCityToken(item));
    if (normalizedValues.includes(normalized)) {
      normalizedValues.forEach((item) => aliases.add(item));
    }
  }
  return [...aliases].filter(Boolean);
}

function cardMatchesRequestedDestination(cardData, requestedDestination) {
  const aliases = buildCityAliases(requestedDestination);
  if (!aliases.length) return true;
  const leaves = collectStringLeaves(cardData || {}).map((value) => normalizeCityToken(value)).filter(Boolean);
  return aliases.some((alias) => leaves.some((leaf) => leaf.includes(alias)));
}

function readAllStdin() {
  return new Promise((resolve, reject) => {
    let raw = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => { raw += chunk; });
    process.stdin.on('end', () => resolve(raw));
    process.stdin.on('error', reject);
  });
}

async function loadRawOverride() {
  if (RAW_FILE) {
    const fs = require('node:fs/promises');
    return { raw: await fs.readFile(RAW_FILE, 'utf8'), durationMs: RAW_DURATION_MS, transport: 'raw-file' };
  }
  if (RAW_STDIN) {
    return { raw: await readAllStdin(), durationMs: RAW_DURATION_MS, transport: 'stdin' };
  }
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function describeNetworkError(err) {
  const cause = err && err.cause ? err.cause : null;
  return {
    name: String(err?.name || ''),
    message: String(err?.message || ''),
    code: String(err?.code || cause?.code || ''),
    causeMessage: String(cause?.message || ''),
  };
}

function isRetryableLoopbackError(err) {
  const details = describeNetworkError(err);
  return ['EPERM', 'ECONNREFUSED', 'EHOSTUNREACH', 'ETIMEDOUT'].includes(details.code)
    || /fetch failed/i.test(details.message)
    || /connect EPERM/i.test(details.causeMessage);
}

async function postPlanViaFetch() {
  const startedAt = Date.now();
  const response = await fetch(new URL('/api/plan/coze', BASE_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: PLAN_MESSAGE, language: PLAN_LANGUAGE, deviceId: PLAN_DEVICE_ID }),
    signal: AbortSignal.timeout(40000),
  });
  const raw = await response.text();
  if (!response.ok) {
    const err = new Error(`plan_request_failed:`);
    err.status = response.status;
    err.body = raw;
    throw err;
  }
  return { raw, durationMs: Date.now() - startedAt, transport: 'fetch' };
}

async function postPlanViaCurl() {
  const startedAt = Date.now();
  const payload = JSON.stringify({ message: PLAN_MESSAGE, language: PLAN_LANGUAGE, deviceId: PLAN_DEVICE_ID });
  const { stdout } = await execFileAsync('curl', [
    '-s',
    '-X', 'POST',
    '-H', 'Content-Type: application/json',
    '--data', payload,
    new URL('/api/plan/coze', BASE_URL).toString(),
  ], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 8,
  });
  return { raw: stdout, durationMs: Date.now() - startedAt, transport: 'curl' };
}

async function postPlanWithRetry() {
  let lastError = null;
  for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
    try {
      return await postPlanViaFetch();
    } catch (err) {
      lastError = err;
      if (attempt >= RETRY_COUNT) break;
      if (!isRetryableLoopbackError(err)) break;
      await sleep(RETRY_DELAY_MS * attempt);
    }
  }
  try {
    return await postPlanViaCurl();
  } catch (curlErr) {
    if (lastError && isRetryableLoopbackError(lastError)) throw lastError;
    throw curlErr || lastError;
  }
}

async function main() {
  const override = await loadRawOverride();
  const { raw, durationMs, transport } = override || await postPlanWithRetry();
  const events = parseSseEvents(raw);
  const finalEvent = [...events].reverse().find((event) => event && event.type === 'final') || null;
  const cardData = finalEvent?.card_data || null;
  const layoutType = String(cardData?.layout_type || 'travel_full');
  const recommendedHotelName = findRecommendedHotelName(cardData);
  const recommendedVisibleName = findRecommendedVisibleName(cardData);
  const checkinNames = (Array.isArray(cardData?.days) ? cardData.days : []).flatMap((day) =>
    (Array.isArray(day?.activities) ? day.activities : [])
      .filter((activity) => activity && activity.type === 'checkin')
      .map((activity) => String(activity.name || '').trim())
      .filter(Boolean)
  );
  const mealNames = (Array.isArray(cardData?.days) ? cardData.days : []).flatMap((day) =>
    (Array.isArray(day?.meals) ? day.meals : [])
      .map((meal) => String(meal?.restaurant || meal?.name || '').trim())
      .filter(Boolean)
  );
  const hasHotelPlanFields = (Array.isArray(cardData?.plans) ? cardData.plans : []).some((plan) =>
    Boolean(String(plan?.hotel?.name || plan?.hotel_name || '').trim())
  );
  const hasCheckinActivities = (Array.isArray(cardData?.days) ? cardData.days : []).some((day) =>
    (Array.isArray(day?.activities) ? day.activities : []).some((activity) => String(activity?.type || '').trim() === 'checkin')
  );
  const paymentNames = (Array.isArray(cardData?.plans) ? cardData.plans : []).flatMap((plan) =>
    (Array.isArray(plan?.payment_items) ? plan.payment_items : []).map((item) => String(item?.name || '').trim())
  ).filter(Boolean);
  const requestedDestination = inferRequestedDestination(PLAN_MESSAGE);
  const cozeSpokenText = String(finalEvent?.coze_data?.spoken_text || '').trim();
  const localizedLeaves = collectStringLeaves({
    spoken_text: finalEvent?.spoken_text || '',
    card_data: cardData || {},
    coze_spoken_text: cozeSpokenText,
    follow_up_suggestions: Array.isArray(finalEvent?.follow_up_suggestions) ? finalEvent.follow_up_suggestions : [],
  });
  const chineseLeafSamples = localizedLeaves.filter((value) => /[\u4e00-\u9fff]/u.test(value)).slice(0, 12);
  const stayFocusHasDiningFields = (Array.isArray(cardData?.plans) ? cardData.plans : []).some((plan) => {
    const paymentSchemes = (Array.isArray(plan?.payment_items) ? plan.payment_items : []).map((item) => String(item?.deeplink_scheme || '').trim().toLowerCase());
    return Boolean(
      String(plan?.dining_plan || '').trim()
      || (Array.isArray(plan?.meal_daily_plan) && plan.meal_daily_plan.length)
      || plan?.restaurant_platform_links
      || String(plan?.restaurant_source || '').trim()
      || paymentSchemes.some((scheme) => ['meituan', 'dianping', 'xiaohongshu'].includes(scheme))
    );
  });
  const stayFocusHasFoodActivities = (Array.isArray(cardData?.days) ? cardData.days : []).some((day) =>
    (Array.isArray(day?.activities) ? day.activities : []).some((activity) => ['food', 'meal'].includes(String(activity?.type || '').trim().toLowerCase()))
    || (Array.isArray(day?.meals) ? day.meals : []).length > 0
  );

  const checks = [
    { name: 'stream-has-events', ok: events.length > 0, detail: events.length },
    { name: 'duration-under-threshold', ok: durationMs <= MAX_MS, detail: { durationMs, maxMs: MAX_MS } },
    { name: 'final-options-card', ok: finalEvent?.response_type === 'options_card' && Boolean(cardData), detail: finalEvent?.response_type || null },
    { name: 'card-core-shape', ok: Boolean(cardData && String(cardData.title || '').trim() && Number(cardData.duration_days || 0) > 0 && Array.isArray(cardData.plans) && cardData.plans.length > 0 && Array.isArray(cardData.days) && cardData.days.length > 0), detail: { title: cardData?.title || '', durationDays: cardData?.duration_days || 0, plans: Array.isArray(cardData?.plans) ? cardData.plans.length : 0, days: Array.isArray(cardData?.days) ? cardData.days.length : 0 } },
    { name: 'requested-destination-preserved', ok: cardMatchesRequestedDestination(cardData, requestedDestination), detail: { requestedDestination, title: cardData?.title || '', recommendedVisibleName, cozeSpokenText } },
    { name: 'recommended-hotel-clean', ok: Boolean(recommendedVisibleName) && !(/[\u4e00-\u9fff]/u.test(recommendedVisibleName)), detail: recommendedVisibleName },
    { name: 'checkin-matches-recommended-hotel', ok: layoutType === 'food_only' ? (Boolean(recommendedVisibleName) && mealNames.includes(recommendedVisibleName)) : (Boolean(recommendedHotelName) && checkinNames.length > 0 && checkinNames.every((name) => name === recommendedHotelName)), detail: layoutType === 'food_only' ? { recommendedVisibleName, mealNames } : { recommendedHotelName, checkinNames } },
    { name: 'food-only-has-no-hotel-shape', ok: layoutType !== 'food_only' || (!hasHotelPlanFields && !hasCheckinActivities), detail: { layoutType, hasHotelPlanFields, hasCheckinActivities } },
    { name: 'stay-focus-has-no-dining-shape', ok: layoutType !== 'stay_focus' || (!stayFocusHasDiningFields && !stayFocusHasFoodActivities), detail: { layoutType, stayFocusHasDiningFields, stayFocusHasFoodActivities } },
    { name: 'no-known-broken-placeholders', ok: !BROKEN_SNIPPETS.some((snippet) => raw.toLowerCase().includes(snippet.toLowerCase())), detail: BROKEN_SNIPPETS.filter((snippet) => raw.toLowerCase().includes(snippet.toLowerCase())) },
    { name: 'payment-item-names-clean', ok: paymentNames.every((name) => !(/[\u4e00-\u9fff]/u.test(name))), detail: paymentNames },
    { name: 'dining-plan-clean', ok: (Array.isArray(cardData?.plans) ? cardData.plans : []).every((plan) => !(/[\u4e00-\u9fff]/u.test(String(plan?.dining_plan || '')))), detail: (Array.isArray(cardData?.plans) ? cardData.plans : []).map((plan) => String(plan?.dining_plan || '')) },
    { name: 'coze-spoken-text-clean', ok: !(/[\u4e00-\u9fff]/u.test(cozeSpokenText)), detail: cozeSpokenText },
    { name: 'localized-string-leaves-clean', ok: chineseLeafSamples.length === 0, detail: chineseLeafSamples },
  ];

  const report = {
    ok: checks.every((item) => item.ok),
    checkedAt: new Date().toISOString(),
    message: PLAN_MESSAGE,
    language: PLAN_LANGUAGE,
    durationMs,
    transport,
    checks,
  };

  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exitCode = report.ok ? 0 : 1;
}

main().catch((err) => {
  const details = describeNetworkError(err);
  const report = {
    ok: false,
    checkedAt: new Date().toISOString(),
    message: PLAN_MESSAGE,
    language: PLAN_LANGUAGE,
    error: {
      name: details.name || String(err?.name || ''),
      message: details.message || String(err?.message || ''),
      code: details.code || null,
      causeMessage: details.causeMessage || null,
      environmentBlocked: isRetryableLoopbackError(err),
    },
  };
  process.stdout.write(JSON.stringify(report, null, 2) + '\n');
  process.exit(1);
});
