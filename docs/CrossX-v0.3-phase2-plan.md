# CrossX v0.3 — Phase 2 Sprint Plan

> 前提：v0.2 已 100% 交付（49/49 DoD）。
> Phase 2 目标：**把 mock 执行链替换为真实 API 调用，打通完整商业闭环。**

---

## 总体目标

| 维度 | v0.2（现状） | v0.3（目标） |
|------|-------------|-------------|
| 执行工具 | 5 个 mock 工具 | 真实 API（Amap + 商家 webhook） |
| Planner | 规则 based `buildAgentPlanFromSlots()` | LLM structured output（流式） |
| 支付 | UI 选轨道 → POST mock | 真实 Alipay/WeChat charge → 收据 |
| 数据持久 | 会话内存（4h TTL） | SQLite 订单 + 行程历史 |
| 证明文件 | mock proof JSON | 真实收据 + QR 核销码 |
| 上下文 | 单次对话 | 历史行程注入 planner |

---

## Feature 列表（优先级排序）

### P0 — 真实执行工具链（必须交付）

替换 5 个 mock 工具，保持接口签名不变（runner.js / loop.js 无需改动）。

#### P0-A：`search_options` 真实化

**现状：** `search_options_mock` 返回 `partner_hub.js` 的 fallback 数据
**目标：** 调用真实 Amap POI API + `lib/connectors/gaode.js`（已有，待接入）

```
search_options({ intent, city, area, preferences[] })
  → gaodeConnector.searchPoi({ keywords, cityName })
  → 归一化 → { candidates: [{id, name, address, score, eta, priceRange}] }
```

Key files:
- `lib/tools/food.js` → 替换 fallback → 调 gaode connector
- `lib/tools/travel.js` → 同上
- 环境变量：`AMAP_API_KEY`（已存在于 `.env.local`）

风险：Amap 免费配额 2000 QPS；演示不超限。

---

#### P0-B：`check_constraints` 真实化

**现状：** `check_constraints_mock` 基于随机种子决定 fail code
**目标：** 向商家 webhook 查询实时库存/排队状态

```
check_constraints({ candidateId, party_size, time_constraint, budget })
  → POST partner_hub /v1/availability
  → { available: bool, queue_estimate_min: int, price: int, failure_code? }
```

由于商家 API 尚未接入，Phase 2 实现为**半真实**：
- 有 `PARTNER_WEBHOOK_URL` → 真实调用
- 无 → 退回当前 seed-based 逻辑（保持 demo path B 可靠性）

Key files: `lib/runner.js` → `runStepTool("check_constraints")` 分支

---

#### P0-C：`route` 真实化

**现状：** `route_mock` 返回硬编码 ETA
**目标：** 调用 `src/services/amapRouting.js`（已实现，真实 Amap 路线）

```
route({ origin_coords, destination_coords, mode })
  → amapRouting.getDrivingRoute(...)
  → { distanceM, durationSec, steps[] }
```

这是 5 个工具里**最容易完成**的，因为真实代码已存在，仅需接线。

Key files: `lib/tools/travel.js` → `route` step → 调 `src/services/amapRouting`

---

#### P0-D：`reserve` + `proof_generate` 真实化

**reserve：**
```
reserve({ candidateId, party_size, railId, amount, userId })
  → paymentRailManager.charge({ railId, amount, currency: "CNY" })
  → Alipay SDK / WeChat Pay API
  → { orderId, transactionId, timestamp }
```

`alipay-sdk` 已在 `package.json`，`lib/payments/rail.js` 已有 `charge()` 骨架。
Phase 2 需补充：
- Alipay SDK 初始化（`ALIPAY_APP_ID` + `ALIPAY_PRIVATE_KEY`）
- 异步支付回调 webhook（`/api/payments/callback`）
- 支付超时处理（30s → fallback）

**proof_generate：**
```
proof_generate({ orderId, transactionId, place, amount, timestamp })
  → 生成 PDF/HTML 收据
  → 上传 OSS / 本地存储
  → { proofUrl, qrCodeUrl }
```

收据包含：订单号、商家名、金额、支付时间、核销 QR。

---

### P1 — LLM Planner 升级（高价值）

**现状：** `buildAgentPlanFromSlots()` 是纯规则引擎（确定性，快速）
**目标：** 实际调用 LLM 生成 main+backup，输出符合 planner 合约的 JSON

#### 架构

```
plannerLLM({ slots, sessionContext, historySnippet })
  → stream: OpenAI / Claude structured output
  → partial JSON → UI 逐字段渐显（流式 reveal）
  → 完整 plan → normalizePlannerOutput() → state
```

流式渐显效果：
- `summary` 先出现
- `mainOption.place` + `mainOption.amount` 出现 → 主卡片骨架渲染
- `backupOption` 延迟 200ms 渲染

降级策略：LLM 超时（>5s）→ fallback 回规则引擎（v0.2 行为）

Key files:
- `src/planner/pipeline.js` → 新增 `plannerAgentCall()` 函数
- `src/planner/prompts.js` → 新增 agent planner system prompt
- `web/app.js` → `renderAgentPlanningCard()` 支持流式部分渲染

---

### P2 — 行程历史 + 跨会话记忆（AI Native 深化）

**现状：** `src/session/profile.js` 存储 30 天旅行偏好，但 agent 对话不持久化
**目标：** 行程 → 写入 SQLite → 下次 planner 注入历史

#### 数据模型

```sql
CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  device_id TEXT,
  city TEXT,
  intent TEXT,           -- eat/travel/hotel/combo
  place TEXT,
  amount INTEGER,
  rail_id TEXT,
  executed_at TEXT,
  slots_json TEXT,       -- full slot snapshot
  proof_url TEXT
);
```

#### 历史注入

```
loadRecentTrips(deviceId, { limit: 3 })
  → [{ city, place, amount, executed_at }]
  → buildHistorySnippet()
  → 注入 planner prompt：
    "用户最近3次：深圳南山吃饭·¥120, 上海外滩·¥380, ..."
```

UI 侧：
- 欢迎页面显示「上次：深圳南山 XX 餐厅」chip
- Replan Drawer 里的"城市"可选项包含历史城市

Key files:
- `src/services/db.js` → 新增 `insertTrip()`, `getRecentTrips()`
- `src/session/profile.js` → 整合 trip 历史
- `web/app.js` → 完成后 `renderAgentDeliverableCard` → 写入行程

---

### P3 — 收据 + 财务报销闭环（商业化）

**现状：** deliverable card 有 QR，但 QR 仅 mock 订单 URL
**目标：** 真实收据可下载，企业报销流程可接入

功能：
- PDF 收据生成（`pdfkit` 或 HTML→PDF）
- 收据包含：商家名/地址、金额、税号、支付方式、二维码
- 企业账号：报销审批 API（飞书 / 钉钉 webhook）
- 收据 URL 显示在 deliverable card「📄 下载收据」按钮

Key files:
- 新增 `lib/receipts/generator.js`
- `server.js` → `GET /api/orders/:id/receipt`（返回 PDF）
- `web/app.js` → deliverable card 增加收据下载按钮

---

## 工作量估算

| Feature | 难度 | 依赖 | Sprint |
|---------|------|------|--------|
| P0-C route 真实化 | XS | amapRouting 已有 | Sprint 1 |
| P0-A search 真实化 | S | AMAP_API_KEY | Sprint 1 |
| P1 LLM planner 流式 | M | OpenAI structured output | Sprint 1 |
| P2 行程历史写入 | S | db.js 已有 | Sprint 1 |
| P0-B check 半真实 | S | partner webhook TBD | Sprint 2 |
| P0-D reserve + 支付 | L | Alipay 密钥 + 回调 | Sprint 2 |
| P0-D proof_generate | M | OSS / 本地存储 | Sprint 2 |
| P2 历史注入 planner | M | P2 写入完成后 | Sprint 2 |
| P3 收据 PDF | M | pdfkit | Sprint 3 |
| P3 企业报销 webhook | L | 外部系统 | Sprint 3 |

---

## Sprint 1 交付范围（建议立即启动）

1. **route 真实化**（接 amapRouting，1h）
2. **search 真实化**（接 gaode connector，2h）
3. **LLM planner 流式**（plannerAgentCall + 部分渲染，4h）
4. **行程历史写入**（deliverable → insertTrip，1h）

**Sprint 1 DoD：**
- 执行完成后，数据库里有真实订单记录
- Planner 从 LLM 取方案（非规则引擎），流式渐显
- Route step 显示真实 Amap ETA 和距离
- `window.CrossXAgentDebug.getState()` 中 `lastTripId` 有值

---

## 风险 & 控制

| 风险 | 控制 |
|------|------|
| LLM planner 响应慢（>5s） | 规则引擎 fallback，保持 demo path 可靠 |
| Alipay 沙箱对接复杂 | Sprint 2 保留 mock charge，仅做 UI + 数据流验证 |
| Amap 配额耗尽 | 结果缓存 4h（`AI_ENRICHMENT_CACHE` 已有同类逻辑） |
| 历史数据污染 demo | demo 路径绕过历史注入（`isDemoPath` flag） |
| 商家 webhook 不稳定 | check_constraints 半真实降级策略 |

---

## 验收标准（Phase 2 完成定义）

### Sprint 1
- [ ] 执行 Path A → route step 显示真实 Amap 距离（非 mock `12 min`）
- [ ] 执行 Path A → search step 返回真实 POI 名（非 `fallback_1`）
- [ ] Planner 调用 LLM，DevTools 可见 `/api/plan/agent` 请求
- [ ] 完成后 `SELECT * FROM trips` 有一条记录

### Sprint 2
- [ ] reserve step 真实调用 `paymentRailManager.charge()`
- [ ] deliverable card QR 指向真实订单 URL（非 mock）
- [ ] `/api/orders/:id` 返回完整订单含 `transactionId`

### Sprint 3
- [ ] 点击「下载收据」可获得含商家信息的 PDF
- [ ] 次日打开 app，欢迎页显示「上次：XX 餐厅」
