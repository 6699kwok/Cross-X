# Cross X PRD v0.1 (MVP)

## 1. Product Positioning
- Product: Digital private concierge for inbound travelers in China.
- North-star: One sentence closes one task loop (`Intent -> Plan -> Execute -> Pay -> Deliverable`).
- Core scenarios in MVP:
  - Eat locally like a pro.
  - Navigate + pay + catch flight.

## 2. User Stories
- As an inbound traveler, I can type one sentence and get a complete plan with confirmable cost.
- As a risk-sensitive user, I can see why the AI made each key choice and what alternatives exist.
- As a paying user, I can authorize no-PIN limits and still get second-factor checks above threshold.
- As a privacy-sensitive user, I can toggle location sharing and export/delete my data.

## 3. Information Architecture
- Chat: primary canvas (Plan/Confirm/Timeline/Deliverable cards).
- Near Me: quick intents only, execution still returns to Chat.
- Trips & Orders: historical tasks/orders/proofs.
- Me: profile + Plus + KPI dashboard + gray-release flags.
- Trust: auth domain, operation tracking chain, MCP call chain, privacy controls.

## 4. Functional Modules
### 4.1 Chat as UI
- Intent parsing with constraints (budget, distance, time, dietary, family, accessibility).
- Plan Card with editable workflow visibility.
- Replan drawer for visual intent/constraint edits (no raw JSON input).
- Replan preview API for non-destructive quote and step preview before save.
- Confirm Card with merchant/cancel/alternative and explicit consent.
- Execution Timeline with atomic task state transitions.
- Deliverable Card with QR/orderNo/bilingual navigation.

### 4.2 Agentic Workflow
- Atomic tasks for Eat chain:
  - `map.query -> queue.status -> book.lock -> pay.act -> proof.card`
- Atomic tasks for Travel chain:
  - `route.plan -> traffic.live -> transport.lock -> pay.act -> proof.card`
- Pause/Resume/Cancel controls.
- Auto fallback event recording on execution failure.

### 4.3 MCP Semantic Layer
- Unified operation schema: `Query`, `Book`, `Pay`, `Cancel`, `Status`.
- Strict result validation:
  - Pay must include `amount`, `currency`, `paymentRef`.
  - Book must include `lockId` or `ticketRef`.
  - All MCP responses must include `provider`, `source`, `sourceTs`.
- SLA contract:
  - Every call stores `slaMs` and `slaMet`.
  - SLA dashboard summarizes breach rate by operation.
  - Strict policy mode (`enforceSla=true`) can fail execution on SLA breach.
  - Controlled simulation (`simulateBreachRate`) for fallback/handoff drills.
- Contract registry:
  - External sources are mapped to contract IDs with enforceable SLA overrides.
  - Contract updates are auditable via MCP contract endpoints.
- Call-chain persistence for trust replay and proof detail.

### 4.4 ACT Trust & Payment
- Delegation domain: no-PIN enabled + daily/single limits.
- Tracking: operation chain in task detail and trust center.
- Intent verification:
  - Above threshold requires second factor.
  - Explicit user confirmation before execution.
- Payment rail adapter:
  - User-selectable rail (`alipay_cn`, `wechat_cn`, `card_delegate`).
  - `pay.act` includes rail metadata (`railId`, `gatewayRef`) in proof chain.
- Compliance controls:
  - Rail certification, KYC, PCI, and enable/disable flags.
  - Policy can block uncertified rails before execution.

### 4.5 Monetization
- Merchant of Record shown in confirm/order detail.
- Plus subscription with concierge benefits.
- Net-price + markup quote engine:
  - Confirm card and order include `netPrice`, `markup`, `markupRate`.
  - Revenue dashboard shows gross/net/markup/refund.
- Settlement ledger:
  - Batch settlement endpoint generates per-order reconciliation records.
  - Dashboard displays settled gross/net/markup totals.

## 5. API Contract (Implemented)
### Task / Workflow
- `POST /api/tasks`
- `GET /api/tasks/:id`
- `POST /api/tasks/:id/confirm`
- `POST /api/tasks/:id/replan/preview`
- `POST /api/tasks/:id/replan`
- `POST /api/tasks/:id/steps/:stepId/retry`
- `GET /api/tasks/:id/refund-policy`
- `POST /api/tasks/:id/execute`
- `POST /api/tasks/:id/pause`
- `POST /api/tasks/:id/resume`
- `POST /api/tasks/:id/cancel`
- `POST /api/tasks/:id/handoff`
- `GET /api/tasks/:id/detail`

### Payment / Trust
- `POST /api/payments/authorize`
- `POST /api/payments/verify-intent`
- `GET /api/payments/rails`
- `POST /api/payments/rails/select`
- `GET /api/payments/compliance`
- `POST /api/payments/compliance`
- `POST /api/payments/compliance/certify`
- `GET /api/trust/audit-logs`
- `GET /api/trust/mcp-calls`
- `GET /api/trust/summary`

### Orders
- `GET /api/orders`
- `GET /api/orders/:id/detail`
- `GET /api/orders/:id/proof`
  - Includes recommendation insights (image/comments/reasons), key moments, and proof-chain summary.
- `GET /api/orders/:id/share-card`
- `POST /api/orders/:id/cancel`

### Billing
- `GET /api/billing/settlements`
- `POST /api/billing/settlements/run`
- `GET /api/billing/reconciliation`
- `POST /api/billing/reconciliation/run`

### Mini Program
- `GET /api/mini-program/package`
- `POST /api/mini-program/release`

### User / Privacy
- `GET /api/user`
- `POST /api/user/preferences`
- `POST /api/user/view-mode`
- `POST /api/user/privacy`
- `GET /api/user/export`
- `POST /api/user/delete-data`

### System / Ops
- `GET /api/health`
- `GET /api/system/providers`
- `GET /api/system/build`
- `GET /api/system/flags`
- `GET /api/system/flags/evaluate?userId=demo`
- `POST /api/system/flags`
- `GET /api/system/mcp-policy`
- `POST /api/system/mcp-policy`
- `GET /api/mcp/contracts`
- `POST /api/mcp/contracts`
- `POST /api/metrics/events`
- `GET /api/dashboard/kpi`
- `GET /api/dashboard/funnel`
- `GET /api/dashboard/prd-coverage`
- `GET /api/dashboard/revenue`
- `GET /api/dashboard/mcp-sla`
- `GET /api/solution/recommendation`
  - Supports `taskId` query for task-scoped recommendation lanes with image + comments + analysis.
- `POST /api/emergency/support`
- `GET /api/support/tickets`
- `POST /api/support/tickets/:id/status`
- `POST /api/support/tickets/:id/evidence`

## 6. Error & Fallback Strategy
- Tool call missing: step fails with explicit reason.
- MCP schema mismatch: hard fail and fallback event recorded.
- Execution failure: task status `failed`, fallback alternative surfaced.
- Order cancel: converts to `Cancel` MCP event and refund info preserved.
- High-risk POST actions support idempotency by `X-Idempotency-Key`.

## 7. Event Tracking & Dashboard
### Core Events
- `intent_submitted`
- `task_created`
- `task_executed_from_chat`
- `closed_loop_completed`
- `task_failed_fallback`
- `task_paused_by_user`
- `task_canceled_by_user`
- `order_canceled_by_user`
- `plus_subscribed`
- `privacy_updated`
- `data_exported`
- `emergency_clicked`

### KPI Panel
- North-star completion rate.
- Funnel (`intent -> planned -> confirmed -> executed -> paid -> delivered`).
- PRD coverage percent and remaining modules.
- Revenue breakdown (`gross/net/markup/refund`).
- MCP SLA met rate and per-op latency/breach summary.
- Total tasks/orders/failures.
- Average step latency.
- Event volume.
- Support SLA (`first response` and `resolution` p50/p90).

## 8. Gray Release Strategy
- Feature flags with rollout percentage:
  - `plusConcierge`
  - `manualFallback`
  - `liveTranslation`
- Controlled rollout via `/api/system/flags`.
- Deterministic user-level hit logic (`bucket < rollout`) via `/api/system/flags/evaluate`.
- Each task persists a flag snapshot for audit/replay.
- Runtime impact:
  - `plusConcierge(active)` increases confirm amount and updates alternative text.
  - `liveTranslation(active)` upgrades deliverable itinerary text to explicit CN/EN bilingual output.
  - `manualFallback(active)` enables automatic human-handoff ticket creation on execution failure.

## 9. DoD Checklist (MVP)
- One-sentence Eat and Travel both complete full loop.
- ACT trust UI and high-amount verification present.
- MCP call chain visible in trust/task proof views.
- Privacy export/delete flows callable and traceable.
- KPI dashboard shows north-star and operational metrics.
