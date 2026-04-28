"use strict";
/**
 * tests/sprint-validation.test.js
 *
 * 实战演练 — 三个端到端 Case
 *
 *  Case A: 模糊意图 → search_restaurants + get_attractions 工具链 + amap_id
 *  Case B: 极端偏好 → ContextWindow 负面约束保留 + hotel amap_id
 *  Case C: 合成数据降级 → synthetic_ 标记 + 不崩溃
 *
 * 需要服务器在 8787 端口运行。
 * 运行: node tests/sprint-validation.test.js
 */

const http = require("http");

const BASE = "http://localhost:8787";
const DEVICE_ID = `cx_${"a".repeat(32)}`;   // 固定 device id，符合 /^cx_[a-f0-9]{32}$/

// ─── SSE client helper ────────────────────────────────────────────────────────
/**
 * Sends a POST to /api/plan/coze and collects all SSE events until stream closes.
 * Returns { events[], toolCalls[], finalCard, raw }
 */
function callPlanSSE(body, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: "localhost",
      port: 8787,
      path: "/api/plan/coze",
      method: "POST",
      headers: {
        "Content-Type":  "application/json",
        "Content-Length": Buffer.byteLength(payload),
        "x-device-id":   body.deviceId || DEVICE_ID,
      },
    };

    const timer = setTimeout(() => reject(new Error(`SSE timeout after ${timeoutMs}ms`)), timeoutMs);

    const req = http.request(options, (res) => {
      if (res.statusCode !== 200) {
        clearTimeout(timer);
        let body = "";
        res.on("data", (c) => body += c);
        res.on("end", () => reject(new Error(`HTTP ${res.statusCode}: ${body.slice(0, 200)}`)));
        return;
      }

      const events    = [];
      const toolCalls = [];
      let   finalCard = null;
      let   buf       = "";

      res.setEncoding("utf8");
      res.on("data", (chunk) => {
        buf += chunk;
        const lines = buf.split("\n");
        buf = lines.pop();                       // keep incomplete line

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const raw = line.slice(6).trim();
          if (raw === "[DONE]") continue;
          try {
            const evt = JSON.parse(raw);
            events.push(evt);
            if (evt.type === "tool_call")  toolCalls.push(evt.tool_name);
            if (evt.type === "final")      finalCard = evt;
          } catch { /* non-JSON SSE line */ }
        }
      });

      res.on("end", () => {
        clearTimeout(timer);
        resolve({ events, toolCalls, finalCard });
      });

      res.on("error", (e) => { clearTimeout(timer); reject(e); });
    });

    req.on("error", (e) => { clearTimeout(timer); reject(e); });
    req.write(payload);
    req.end();
  });
}

// ─── Assertion helpers ────────────────────────────────────────────────────────
function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    return true;
  } else {
    console.log(`  ❌ ${label}`);
    return false;
  }
}

function extractAllPois(card) {
  const pois = [];
  // Server emits type:"final" — card_data is at top level of the event (not card.data)
  const cd = card?.card_data || card?.data?.card_data;
  if (!cd) return pois;
  for (const plan of cd.plans || []) {
    // Spread AFTER _kind so plan.hotel.type ("budget"/"balanced") doesn't override it
    if (plan.hotel) pois.push({ ...plan.hotel, _kind: "hotel" });
  }
  for (const day of cd.days || []) {
    for (const act of day.activities || []) pois.push({ ...act, _kind: "activity" });
    for (const meal of day.meals || []) pois.push({ ...meal, _kind: "meal" });
  }
  return pois;
}

// ─── Case A ───────────────────────────────────────────────────────────────────
async function runCaseA() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Case A: 模糊意图 — 蛇口下午茶 + 博物馆");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const { events, toolCalls, finalCard } = await callPlanSSE({
    message:  "我想在蛇口找个地方喝下午茶，然后去最近的博物馆。",
    language: "ZH",
    city:     "深圳",
    deviceId: DEVICE_ID,
    history:  [],
  });

  console.log(`  [工具调用序列]: ${toolCalls.join(" → ") || "(无)"}`);
  console.log(`  [SSE事件总数]:  ${events.length}`);

  let pass = 0, total = 0;

  // 1. 工具链验证
  total++; if (assert(toolCalls.includes("search_restaurants"),     "search_restaurants 被调用")) pass++;
  total++; if (assert(toolCalls.includes("get_attractions") || toolCalls.includes("get_city_enrichment"),
                                                                      "get_attractions / get_city_enrichment 被调用")) pass++;

  // 2. 卡片生成
  total++; if (assert(finalCard !== null,                            "收到 result 事件")) pass++;
  if (!finalCard) { console.log("  ⛔ 无法继续验证 (无 finalCard)"); return { pass, total }; }

  const pois = extractAllPois(finalCard);
  console.log(`  [POI 数量]: ${pois.length}`);

  // 3. amap_id 验证
  const poisWithAmapId = pois.filter((p) => p.external_id && !p.external_id.startsWith("synthetic_"));
  const poisSynthetic  = pois.filter((p) => p.external_id?.startsWith("synthetic_"));
  console.log(`  [amap_id 真实]: ${poisWithAmapId.length}  [synthetic]: ${poisSynthetic.length}  [无ID]: ${pois.filter(p => !p.external_id).length}`);
  total++; if (assert(poisWithAmapId.length > 0,                    "至少 1 个 POI 有真实 amap_id")) pass++;

  // 4. _dataQuality 标签
  const dq = finalCard?.card_data?._dataQuality;
  console.log(`  [_dataQuality]: ${dq}`);
  total++; if (assert(dq === "live" || dq === "ai",                  `_dataQuality 有效 (${dq})`)) pass++;

  console.log(`\n  Case A 结果: ${pass}/${total} 通过`);
  return { pass, total };
}

// ─── Case B ───────────────────────────────────────────────────────────────────
async function runCaseB() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Case B: 极端偏好 — 大冲酒店 ¥500以下 + 不要老旧");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const deviceIdB = `cx_${"b".repeat(32)}`;

  // 轮次1: 发送带负面约束的请求
  const { events: ev1, toolCalls: tc1, finalCard: card1 } = await callPlanSSE({
    message:  "帮我规划大冲附近的酒店住2晚，价格500以下，绝对不要那种老旧的。下午去万象天地逛逛。",
    language: "ZH",
    city:     "深圳",
    deviceId: deviceIdB,
    history:  [],
  });

  console.log(`  [轮次1 工具调用]: ${tc1.join(" → ") || "(无)"}`);
  console.log(`  [轮次1 SSE事件]: ${ev1.length}`);

  let pass = 0, total = 0;

  total++; if (assert(card1 !== null, "轮次1: 收到 result 事件")) pass++;

  // 检查酒店 amap_id
  const pois1   = extractAllPois(card1);
  const hotels1 = pois1.filter((p) => p._kind === "hotel");
  console.log(`  [轮次1 酒店]: ${hotels1.map(h => `${h.name}(id:${h.external_id || "null"})`).join(", ")}`);
  total++; if (assert(hotels1.length > 0,                                  "轮次1: 有酒店 POI")) pass++;
  total++; if (assert(hotels1.some((h) => h.external_id),                  "轮次1: 酒店有 external_id")) pass++;

  // ContextWindow 测试: 轮次2 引用前次约束
  if (card1) {
    const history1 = [
      { role: "user",      content: "帮我规划大冲附近的酒店，价格500以下，绝对不要那种老旧的。下午去万象天地逛逛。" },
      { role: "assistant", content: card1?.data?.spoken_text || "好的，已为您规划。" },
    ];

    const { events: ev2, toolCalls: tc2, finalCard: card2 } = await callPlanSSE({
      message:  "好的，这个方案不错，但能帮我换一个更新装修的酒店吗，还是不要老旧风格的",
      language: "ZH",
      city:     "深圳",
      deviceId: deviceIdB,
      history:  history1,
    });

    console.log(`\n  [轮次2 工具调用]: ${tc2.join(" → ") || "(无)"}`);
    console.log(`  [轮次2 SSE事件]: ${ev2.length}`);

    total++; if (assert(card2 !== null, "轮次2: 收到 result 事件")) pass++;

    // ContextWindow 检查 — thinking 文本里应包含约束信息
    const thinkingTexts = ev2.filter(e => e.type === "thinking").map(e => e.text || "").join("");
    const hasConstraint = /新|装修|modern|老旧|500|预算/i.test(thinkingTexts);
    console.log(`  [轮次2 thinking片段]: "${thinkingTexts.slice(0, 150)}..."`);
    total++; if (assert(hasConstraint, "轮次2: thinking 包含前轮约束关键词")) pass++;
  }

  console.log(`\n  Case B 结果: ${pass}/${total} 通过`);
  return { pass, total };
}

// ─── Case C ───────────────────────────────────────────────────────────────────
async function runCaseC() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Case C: 合成数据降级 — 火星旅游");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  let pass = 0, total = 0;
  let crashed = false;

  try {
    const { events, toolCalls, finalCard } = await callPlanSSE({
      message:  "我想去火星旅游，帮我规划3天行程。",
      language: "ZH",
      city:     "",
      deviceId: `cx_${"c".repeat(32)}`,
      history:  [],
    });

    console.log(`  [工具调用序列]: ${toolCalls.join(" → ") || "(无)"}`);
    console.log(`  [SSE事件总数]:  ${events.length}`);

    // 1. 不崩溃
    total++; if (assert(true, "系统未崩溃 (SSE正常关闭)")) pass++;

    // 2. 检查是否有 result 事件
    const hasResult = finalCard !== null;
    console.log(`  [有 result 事件]: ${hasResult}`);
    total++; if (assert(events.length > 0, "至少有 SSE 事件")) pass++;

    if (finalCard) {
      const pois = extractAllPois(finalCard);
      const synthetic = pois.filter((p) => p.external_id?.startsWith("synthetic_"));
      const noId      = pois.filter((p) => !p.external_id);
      console.log(`  [POI 总数]: ${pois.length}  [synthetic_]: ${synthetic.length}  [无ID]: ${noId.length}`);
      const dq = finalCard?.card_data?._dataQuality;
      console.log(`  [_dataQuality]: ${dq}`);

      // 3. synthetic 数据被正确标记
      total++; if (assert(dq === "synthetic" || dq === "ai" || dq === "mock",
                           `降级数据质量标记正确 (${dq})`)) pass++;

      // 4. 无真实 amap_id (火星没有高德数据)
      const realAmapIds = pois.filter((p) => p.external_id && !p.external_id.startsWith("synthetic_"));
      total++; if (assert(realAmapIds.length === 0, "无真实 amap_id (降级路径正确)")) pass++;
    } else {
      // 系统可能直接拒绝了 (boundary rejection or clarify card) — 也是正确行为
      const hasBoundary = events.some((e) => e.type === "boundary" || (e.type === "result" && e.data?.response_type === "clarify_card"));
      const hasError    = events.some((e) => e.type === "error");
      console.log(`  [响应类型]: ${hasBoundary ? "boundary拒绝" : hasError ? "error" : "无result(clarify/boundary)"}`);
      total++; if (assert(hasBoundary || hasError || events.length > 0,
                           "系统给出了明确响应 (拒绝/错误/引导)")) pass++;
    }

  } catch (err) {
    crashed = true;
    console.log(`  ❌ 系统崩溃: ${err.message}`);
    total++; pass += 0;
  }

  total++; if (assert(!crashed, "全程无未捕获异常")) pass++;

  console.log(`\n  Case C 结果: ${pass}/${total} 通过`);
  return { pass, total };
}

// ─── DataShaper 单元测试 ──────────────────────────────────────────────────────
function runDataShaperUnit() {
  console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("Unit: DataShaper — amap_id 透传 + 崩溃修复");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const { DataShaper } = require("../src/agent/data_shaper.js");
  let pass = 0, total = 0;

  // 1. search_hotels: amap_id 透传
  const hotelRaw = {
    city: "深圳", pax: 2,
    hotels: [
      { name: "南山喜来登", tier: "premium", price_per_night: 1200, rating: 4.8, amap_id: "B0FFHQJJR1", real_photo_url: null },
      { name: "汉庭酒店",   tier: "budget",  price_per_night: 280,  rating: 4.2, amap_id: "B0FFABC123" },
    ],
  };
  const shapedHotels = DataShaper.shape("search_hotels", hotelRaw);
  total++; if (assert(shapedHotels.hotels[0].external_id === "B0FFHQJJR1", "hotel amap_id → external_id 正确透传")) pass++;

  // 2. get_attractions: amap_id 透传
  const attrRaw = {
    city: "深圳",
    attractions: [
      { name: "深圳博物馆", ticket_price: 0, open_hours: "9:00-17:00", amap_id: "B0FFGHI456", real_photo_url: "" },
    ],
  };
  const shapedAttr = DataShaper.shape("get_attractions", attrRaw);
  total++; if (assert(shapedAttr.attractions[0].external_id === "B0FFGHI456", "attraction amap_id → external_id 正确透传")) pass++;

  // 3. search_restaurants: amap_id 透传
  const restRaw = {
    city: "深圳",
    restaurants: [
      { name: "宜和粤菜", avg_price: 150, amap_id: "B0FFDEF789" },
    ],
  };
  const shapedRest = DataShaper.shape("search_restaurants", restRaw);
  total++; if (assert(shapedRest.restaurants[0].external_id === "B0FFDEF789", "restaurant amap_id → external_id 正确透传")) pass++;

  // 4. synthetic_ fallback
  const synthRaw = {
    city: "火星",
    hotels: [{ name: "奥林匹斯火山酒店", tier: "premium", price_per_night: 9999, _source: "openai" }],
  };
  const shapedSynth = DataShaper.shape("search_hotels", synthRaw);
  total++; if (assert(
    shapedSynth.hotels[0].external_id === "synthetic_奥林匹斯火山酒店",
    "openai合成数据 → synthetic_ 前缀"
  )) pass++;

  // 5. unknown tool — 不崩溃，返回原始对象
  const unknownRaw = { foo: "bar", big: "x".repeat(1000) };
  let unknownResult;
  try {
    unknownResult = DataShaper.shape("unknown_tool_xyz", unknownRaw);
    total++; if (assert(unknownResult === unknownRaw, "未知工具: 返回原始对象，不崩溃")) pass++;
  } catch (e) {
    total++; if (assert(false, `未知工具: 意外崩溃 — ${e.message}`)) pass++;
  }

  // 6. get_city_enrichment: amap_id 透传
  const enrichRaw = {
    city: "深圳",
    item_list: [
      { name: "世界之窗", avg_price: 120, amap_id: "B0FFWOW001" },
    ],
  };
  const shapedEnrich = DataShaper.shape("get_city_enrichment", enrichRaw);
  total++; if (assert(shapedEnrich.items[0].external_id === "B0FFWOW001", "enrichment amap_id → external_id 正确透传")) pass++;

  console.log(`\n  Unit 结果: ${pass}/${total} 通过`);
  return { pass, total };
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log("═══════════════════════════════════════════════════");
  console.log("  CrossX Sprint Validation — 三 Case 实战演练");
  console.log(`  时间: ${new Date().toLocaleString("zh-CN")}`);
  console.log("═══════════════════════════════════════════════════");

  // 单元测试先跑 (不需要服务器)
  const unit = runDataShaperUnit();

  // 检查服务器可达性
  let serverUp = false;
  try {
    await new Promise((resolve, reject) => {
      const req = http.get("http://localhost:8787/api/health", (r) => {
        serverUp = r.statusCode < 500;
        resolve();
      });
      req.on("error", reject);
      req.setTimeout(3000, () => { req.destroy(); reject(new Error("timeout")); });
    });
  } catch {
    serverUp = false;
  }

  if (!serverUp) {
    console.log("\n⚠️  服务器未运行 (localhost:8787)");
    console.log("   端到端 Case A/B/C 跳过。");
    console.log("   仅 DataShaper 单元测试完成。");
    console.log(`\n单元测试: ${unit.pass}/${unit.total} 通过`);
    process.exit(unit.pass < unit.total ? 1 : 0);
  }

  const results = { unit };

  try { results.caseA = await runCaseA(); } catch (e) {
    console.log(`\n  ❌ Case A 异常: ${e.message}`);
    results.caseA = { pass: 0, total: 1 };
  }

  try { results.caseB = await runCaseB(); } catch (e) {
    console.log(`\n  ❌ Case B 异常: ${e.message}`);
    results.caseB = { pass: 0, total: 1 };
  }

  try { results.caseC = await runCaseC(); } catch (e) {
    console.log(`\n  ❌ Case C 异常: ${e.message}`);
    results.caseC = { pass: 0, total: 1 };
  }

  // 总结
  console.log("\n═══════════════════════════════════════════════════");
  console.log("  汇总");
  console.log("═══════════════════════════════════════════════════");
  let totalPass = 0, totalAll = 0;
  for (const [name, r] of Object.entries(results)) {
    const icon = r.pass === r.total ? "✅" : r.pass > 0 ? "⚠️ " : "❌";
    console.log(`  ${icon} ${name.padEnd(8)} ${r.pass}/${r.total}`);
    totalPass += r.pass;
    totalAll  += r.total;
  }
  console.log(`  ${"─".repeat(30)}`);
  console.log(`  总计:    ${totalPass}/${totalAll} (${Math.round(totalPass/totalAll*100)}%)`);
  console.log("═══════════════════════════════════════════════════\n");

  process.exit(totalPass < totalAll ? 1 : 0);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
