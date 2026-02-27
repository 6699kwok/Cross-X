# Cross X v0.2 Sprint Delivery (P0)

## 1) Intent / Slot baseline

### Intents (P0)
- `eat`
- `travel`
- `hotel`
- `combo_eat_travel`
- `combo_hotel_travel`
- `unknown`

### Slots (P0)
- `intent`
- `city`
- `area`
- `party_size`
- `budget`
- `time_constraint`
- `preferences[]`
- `execution_permission`

## 2) Conversation state machine (9 states)

- `idle`
- `parsing`
- `asking`
- `planning`
- `confirming`
- `executing`
- `completed`
- `failed`
- `replanning`

State transitions are emitted via `setAgentMode(...)` and logged in telemetry (`mode_transition`).

## 3) Planner minimal output contract

Planner output is normalized to:

```json
{
  "type": "simple|combo",
  "summary": "string",
  "mainOption": {
    "key": "main",
    "intent": "eat|trip|hotel|combo",
    "place": "string",
    "eta": 0,
    "amount": 0,
    "risk": "string",
    "reason": "string",
    "requires_confirmation": true
  },
  "backupOption": {
    "key": "backup",
    "intent": "eat|trip|hotel|combo",
    "place": "string",
    "eta": 0,
    "amount": 0,
    "risk": "string",
    "reason": "string",
    "requires_confirmation": true
  },
  "steps": [],
  "toolSnapshot": {}
}
```

Notes:
- Always `1 main + 1 backup`.
- Clarification rounds capped at `<=2`.
- After max asks, planner can proceed with explicit assumptions and announces them.

## 4) Executor + mock tools

### Mock tools
- `search_options_mock`
- `check_constraints_mock`
- `reserve_mock`
- `route_mock`
- `proof_generate_mock`

### Failure scenarios (P0)
- `budget_overflow`
- `queue_too_long`
- `resource_unavailable`

### Replanning chain
- `executing -> failed -> replanning -> confirming -> executing`
- On failure, system explains cause and auto switches to backup lane for confirmation.

### Deterministic behavior policy
- Same session uses seed-based deterministic mock behavior.
- Queue-fail demo path is forced for evening no-queue stress case in Shenzhen/Nanshan on **main** option.
- Backup lock failure threshold is lower than main to reduce repeated dead loops.

## 5) Voice MVP (P0/P0.5)

### Voice button states
- standby
- listening
- processing
- speaking

### Voice behavior
- Voice transcript enters same Planner/Executor loop as text.
- Supports barge-in: interruption while speaking immediately stops playback and resumes listening.
- Voice commands drive state changes:
  - continue / confirm
  - cancel
  - switch backup
  - retry
  - handoff

## 6) UI state-driven rendering

Chat UI is state-rendered by mode:
- `asking`: clarification card + quick-fill chips
- `planning`: primary/backup option cards
- `confirming`: confirmation card
- `executing`: task status card + step progress
- `failed`: failure card + next actions
- `completed`: result card + proof summary

## 7) Observability (P0)

Telemetry logs include:
- slot extraction
- mode transitions
- tool calls and result code
- failure reasons
- auto replanning
- voice barge-in

Debug hooks in browser:
- `window.CrossXAgentSpec`
- `window.CrossXAgentDebug.getState()`
- `window.CrossXAgentDebug.getTelemetry()`

## 8) Demo scripts (acceptance)

### Path A: normal completion
Input:
- `我在深圳南山，2个人，预算中等，想吃不排队的。`

Expected:
- parsing -> planning -> confirming -> executing -> completed
- main+backup shown
- confirmation required before execution

### Path B: failure + replanning
Input:
- `我想在深圳南山找一家不排队的晚餐，预算中等。`
- follow-up when asked: `2个人`

Expected:
- asks missing slot(s) (<=2 rounds)
- execution fails on main (`queue_too_long`)
- transitions to `failed -> replanning -> confirming`
- backup execution can complete

### Path C: voice barge-in
1. Tap intercom and speak:
- `帮我找深圳南山吃饭的地方`
2. While assistant speaking, interrupt:
- `等一下，预算低一点，别排队`

Expected:
- speech interrupted immediately
- slots updated (`budget=low`, no queue preference)
- replanning + new options + reconfirmation


## 9) Workstream split (execution)

### Frontend
- State-driven card rendering by mode (`asking/planning/confirming/executing/failed/completed`)
- Task status card / plan cards / confirmation card
- Voice button state animation + barge-in interaction
- Telemetry exposure in browser debug hooks

### Backend
- Keep `/api/chat/reply` and LLM runtime status as provider layer
- Keep secure key handling (`/api/system/llm/runtime`, no key exposure to client)
- Keep support + order endpoints for integration demo

### AI (Planner)
- Intent + slot extraction with capped clarification rounds (`<=2`)
- Main + backup option generation contract
- Replanning trigger inputs from executor failure codes

### Voice
- Speech recognition to Planner input
- TTS/voice playback
- Interruption and command parsing (`confirm/cancel/switch/retry/handoff`)

## 10) Risks and controls

- Risk: falls back to timer-like fake execution.
  - Control: each step result is driven by tool output (`search/check/reserve/route/proof`) and failure code.

- Risk: mock randomness causes inconsistent story.
  - Control: deterministic seed per session + constrained runtime failure policy.

- Risk: team drifts into visual polishing and breaks core behavior.
  - Control: lock acceptance to state transitions + 3 scripted paths before any major visual change.

- Risk: voice flow feels like upload-playback only.
  - Control: keep barge-in and command parsing in same state machine loop.
