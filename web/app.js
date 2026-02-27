const ASSET_VERSION = "20260228-010";

const i18n = window.CrossXI18n || {
  t: (_lang, key) => key,
  term: (_lang, key) => key,
  normalizeLanguage: (lang) => lang || "ZH",
};

const motion = window.CrossXMotion || {
  bindPressables() {},
  enter() {},
  stagger() {},
  safeDuration(ms) {
    return ms;
  },
};

const drawerController = window.CrossXDrawer ? window.CrossXDrawer.createDrawerController() : null;
const modal = window.CrossXModal ? window.CrossXModal.createModal() : null;
const toast = window.CrossXToast ? window.CrossXToast.createToast() : null;
const skeleton = window.CrossXSkeleton || null;
const taskComponents = window.CrossXTaskComponents || null;
const IS_USER_PORTAL = !/\/admin\.html(?:$|\?)/i.test(String(window.location.pathname || ""));
const AGENT_INTENTS = ["eat", "travel", "hotel", "combo_eat_travel", "combo_hotel_travel", "unknown"];
const AGENT_SLOT_KEYS = ["intent", "city", "area", "party_size", "budget", "time_constraint", "preferences", "execution_permission"];
const AGENT_STATES = ["idle", "parsing", "asking", "planning", "confirming", "executing", "completed", "failed", "replanning"];

const state = {
  selectedConstraints: {},
  constraintsExpanded: false,
  singleDialogMode: true,
  loopProgress: "intent",
  currentTask: null,
  tripPlans: [],
  activeTripId: "",
  currentTaskDetail: null,
  currentTaskRecommendation: null,
  auditLogs: [],
  supportTickets: [],
  replanTaskId: null,
  uiLanguage: "ZH",
  viewMode: "user",
  nearItems: [],
  selectedNearItemId: null,
  executionMockTimer: null,
  supportEtaTicker: null,
  chatNoticeTicker: null,
  chatNoticeSince: "",
  supportRoom: {
    activeSessionId: "",
    activeTicketId: "",
    pollTicker: null,
    recording: false,
    recorder: null,
    stream: null,
    chunks: [],
    recordingStartedAt: 0,
    opening: false,
  },
  currentSubtab: "overview",
  voice: {
    supported: false,
    listening: false,
    speaking: false,
    replyEnabled: false,
    audioPlayer: null,
    conversationMode: false,
    recognition: null,
    processing: false,
    interruptedUntil: 0,
    errorUntil: 0,
    pendingTaskId: null,
    restartTimer: null,
    listenTimer: null,
    translating: false,
    lastTranscript: "",
    lastTranslated: "",
  },
  // P8.3: Coze workflow enrichment data (hero_image, restaurant_queue, ticket_availability, total_price)
  cozeData: null,
  agentConversation: {
    mode: "idle",
    sessionId: `sess_${Date.now().toString(36)}`,
    sessionSeed: `${Date.now().toString(36)}_${Math.floor(Math.random() * 9e5 + 1e5).toString(36)}`,
    messages: [],
    slots: {
      intent: null,
      city: null,
      area: null,
      budget: null,
      time_constraint: null,
      party_size: null,
      preferences: [],
      execution_permission: false,
    },
    slotEvidence: {
      intent: false,
      city: false,
      area: false,
      budget: false,
      time_constraint: false,
      party_size: false,
      preferences: false,
      execution_permission: false,
    },
    currentPlan: null,
    currentRun: null,
    historyRuns: [],
    pendingOptionKey: "main",
    askCount: 0,
    lastAskedSignature: "",
    lastFailureCode: "",
    telemetry: [],
    lastUserInput: "",
    smartReply: null,
    smartHint: "",
    smartLoading: false,
    smartRequestId: 0,
    smartSignature: "",
    warnedMissingLlm: false,
  },
};

// ── Conversation Persistence (localStorage) ──────────────────────────────
const CONV_STORAGE_KEY = "crossx_conv_v2";
const CONV_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours

function saveConversationState() {
  try {
    const toSave = {
      messages: (state.agentConversation.messages || []).slice(-20),
      slots: { ...state.agentConversation.slots },
      savedAt: Date.now(),
    };
    localStorage.setItem(CONV_STORAGE_KEY, JSON.stringify(toSave));
  } catch { /* quota exceeded or storage disabled — ignore */ }
}

function restoreConversationState() {
  try {
    const raw = localStorage.getItem(CONV_STORAGE_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw);
    if (!saved || !saved.savedAt) return;
    if (Date.now() - saved.savedAt > CONV_TTL_MS) {
      localStorage.removeItem(CONV_STORAGE_KEY);
      return;
    }
    if (Array.isArray(saved.messages) && saved.messages.length > 0) {
      state.agentConversation.messages = saved.messages;
    }
    if (saved.slots && typeof saved.slots === "object") {
      Object.assign(state.agentConversation.slots, saved.slots);
    }
  } catch { /* corrupt data — ignore */ }
}

const store = window.CrossXState
  ? window.CrossXState.createStore({
      ui: {
        language: state.uiLanguage,
        viewMode: state.viewMode,
        tab: "chat",
        loading: {},
      },
      task: null,
      plan: null,
      steps: [],
      proofs: [],
      orders: [],
      nearby: [],
      audit: [],
      error: null,
    })
  : null;

const el = {
  chatFeed: document.getElementById("chatFeed"),
  taskWorkspace: document.getElementById("taskWorkspace"),
  taskStatusMount: document.getElementById("taskStatusMount"),
  planCardsSection: document.getElementById("planCardsSection"),
  confirmCardSection: document.getElementById("confirmCardSection"),
  executionStepsSection: document.getElementById("executionStepsSection"),
  executionResultSection: document.getElementById("executionResultSection"),
  chatSolutionStrip: document.getElementById("chatSolutionStrip"),
  chatForm: document.getElementById("chatForm"),
  chatInput: document.getElementById("chatInput"),
  chatSendBtn: document.getElementById("chatSendBtn"),
  myOrdersBtn: document.getElementById("myOrdersBtn"),
  contextSummary: document.getElementById("contextSummary"),
  contextTitle: document.getElementById("contextTitle"),
  contextGlossary: document.getElementById("contextGlossary"),
  quickGoalsTitle: document.getElementById("quickGoalsTitle"),
  quickGoals: document.getElementById("quickGoals"),
  humanAssistCard: document.getElementById("humanAssistCard"),
  humanAssistTitle: document.getElementById("humanAssistTitle"),
  humanAssistMode: document.getElementById("humanAssistMode"),
  humanAssistSummary: document.getElementById("humanAssistSummary"),
  humanAssistTicket: document.getElementById("humanAssistTicket"),
  humanAssistEta: document.getElementById("humanAssistEta"),
  humanAssistRecent: document.getElementById("humanAssistRecent"),
  assistRequestBtn: document.getElementById("assistRequestBtn"),
  assistOpenSupportBtn: document.getElementById("assistOpenSupportBtn"),
  assistLiveCallBtn: document.getElementById("assistLiveCallBtn"),
  assistRefreshBtn: document.getElementById("assistRefreshBtn"),
  conversationAura: document.getElementById("conversationAura"),
  conversationAuraLabel: document.getElementById("conversationAuraLabel"),
  thinkingIndicator: document.getElementById("thinkingIndicator"),
  toggleConstraintsBtn: document.getElementById("toggleConstraintsBtn"),
  inputAssistHint: document.getElementById("inputAssistHint"),
  voiceInputBtn: document.getElementById("voiceInputBtn"),
  translateBtn: document.getElementById("translateBtn"),
  paymentModal: document.getElementById("paymentModal"),
  payModalClose: document.getElementById("payModalClose"),
  payModalTitle: document.getElementById("payModalTitle"),
  payModalSubtitle: document.getElementById("payModalSubtitle"),
  payOrderSummary: document.getElementById("payOrderSummary"),
  payItemName: document.getElementById("payItemName"),
  payItemPrice: document.getElementById("payItemPrice"),
  payTotal: document.getElementById("payTotal"),
  payWechat: document.getElementById("payWechat"),
  payAlipay: document.getElementById("payAlipay"),
  payQrSection: document.getElementById("payQrSection"),
  payQrLabel: document.getElementById("payQrLabel"),
  payQrImg: document.getElementById("payQrImg"),
  payQrHint: document.getElementById("payQrHint"),
  payQrAmount: document.getElementById("payQrAmount"),
  payDoneBtn: document.getElementById("payDoneBtn"),
  openConditionEditorBtn: document.getElementById("openConditionEditorBtn"),
  inlineLocateBtn: document.getElementById("inlineLocateBtn"),
  voiceReplyBtn: document.getElementById("voiceReplyBtn"),
  recommendedTitle: document.getElementById("recommendedTitle"),
  recommendedSubtitle: document.getElementById("recommendedSubtitle"),
  nearHeading: document.getElementById("nearHeading"),
  nearFiltersHeading: document.getElementById("nearFiltersHeading"),
  nearResultsHeading: document.getElementById("nearResultsHeading"),
  nearMapHeading: document.getElementById("nearMapHeading"),
  tripsHeading: document.getElementById("tripsHeading"),
  tripPlanHeading: document.getElementById("tripPlanHeading"),
  activeTripHint: document.getElementById("activeTripHint"),
  ordersHeading: document.getElementById("ordersHeading"),
  mePreferencesHeading: document.getElementById("mePreferencesHeading"),
  plusHeading: document.getElementById("plusHeading"),
  plusDescription: document.getElementById("plusDescription"),
  paymentLimitsHeading: document.getElementById("paymentLimitsHeading"),
  llmConnectHeading: document.getElementById("llmConnectHeading"),
  llmConnectDesc: document.getElementById("llmConnectDesc"),
  trustSummaryHeading: document.getElementById("trustSummaryHeading"),
  authHeading: document.getElementById("authHeading"),
  operationHeading: document.getElementById("operationHeading"),
  privacyHeading: document.getElementById("privacyHeading"),
  supportHeading: document.getElementById("supportHeading"),
  advancedHeading: document.getElementById("advancedHeading"),
  savePrefBtn: document.getElementById("savePrefBtn"),
  switchModeBtn: document.getElementById("switchModeBtn"),
  plusSubscribeBtn: document.getElementById("plusSubscribeBtn"),
  plusCancelBtn: document.getElementById("plusCancelBtn"),
  saveRailBtn: document.getElementById("saveRailBtn"),
  saveLlmBtn: document.getElementById("saveLlmBtn"),
  openOpenAiBtn: document.getElementById("openOpenAiBtn"),
  clearLlmBtn: document.getElementById("clearLlmBtn"),
  openTrustAdvancedBtn: document.getElementById("openTrustAdvancedBtn"),
  updateAuthBtn: document.getElementById("updateAuthBtn"),
  exportDataBtn: document.getElementById("exportDataBtn"),
  deleteDataBtn: document.getElementById("deleteDataBtn"),
  probeProvidersBtn: document.getElementById("probeProvidersBtn"),
  closeTaskDrawerBtn: document.getElementById("closeTaskDrawerBtn"),
  closeReplanBtn: document.getElementById("closeReplanBtn"),
  previewReplanBtn: document.getElementById("previewReplanBtn"),
  saveReplanBtn: document.getElementById("saveReplanBtn"),
  cancelReplanBtn: document.getElementById("cancelReplanBtn"),
  closeProofDrawerBtn: document.getElementById("closeProofDrawerBtn"),
  closeOrderDrawerBtn: document.getElementById("closeOrderDrawerBtn"),
  subtabOverview: document.getElementById("subtabOverview"),
  subtabSteps: document.getElementById("subtabSteps"),
  subtabPayments: document.getElementById("subtabPayments"),
  subtabProof: document.getElementById("subtabProof"),
  prefDietaryInput: document.getElementById("prefDietaryInput"),
  prefHotelInput: document.getElementById("prefHotelInput"),
  prefOfficeInput: document.getElementById("prefOfficeInput"),
  prefAirportInput: document.getElementById("prefAirportInput"),
  replanDietaryInput: document.getElementById("replanDietaryInput"),
  tabs: [...document.querySelectorAll(".tab")],
  tabPanels: {
    chat: document.getElementById("chatTab"),
    near: document.getElementById("nearTab"),
    trips: document.getElementById("tripsTab"),
    me: document.getElementById("meTab"),
    trust: document.getElementById("trustTab"),
  },
  chips: [...document.querySelectorAll(".chip")],
  nearList: document.getElementById("nearList"),
  nearFilterForm: document.getElementById("nearFilterForm"),
  nearMapPreview: document.getElementById("nearMapPreview"),
  ordersList: document.getElementById("ordersList"),
  tripList: document.getElementById("tripList"),
  tripForm: document.getElementById("tripForm"),
  createTripBtn: document.getElementById("createTripBtn"),
  tripTitleInput: document.getElementById("tripTitleInput"),
  tripCityInput: document.getElementById("tripCityInput"),
  tripNoteInput: document.getElementById("tripNoteInput"),
  orderDetail: document.getElementById("orderDetail"),
  auditList: document.getElementById("auditList"),
  mcpList: document.getElementById("mcpList"),
  mcpSlaSummary: document.getElementById("mcpSlaSummary"),
  supportList: document.getElementById("supportList"),
  authForm: document.getElementById("authForm"),
  railForm: document.getElementById("railForm"),
  llmRuntimeForm: document.getElementById("llmRuntimeForm"),
  complianceForm: document.getElementById("complianceForm"),
  compliancePolicyForm: document.getElementById("compliancePolicyForm"),
  prefForm: document.getElementById("prefForm"),
  privacyForm: document.getElementById("privacyForm"),
  privacyResult: document.getElementById("privacyResult"),
  plusStatus: document.getElementById("plusStatus"),
  providerStatus: document.getElementById("providerStatus"),
  llmApiKeyInput: document.getElementById("llmApiKeyInput"),
  llmModelSelect: document.getElementById("llmModelSelect"),
  llmStatusText: document.getElementById("llmStatusText"),
  llmLastErrorText: document.getElementById("llmLastErrorText"),
  railStatus: document.getElementById("railStatus"),
  reconSummary: document.getElementById("reconSummary"),
  providerProbeSummary: document.getElementById("providerProbeSummary"),
  kpiSummary: document.getElementById("kpiSummary"),
  funnelSummary: document.getElementById("funnelSummary"),
  revenueSummary: document.getElementById("revenueSummary"),
  prdCoverageSummary: document.getElementById("prdCoverageSummary"),
  flagsSummary: document.getElementById("flagsSummary"),
  flagsForm: document.getElementById("flagsForm"),
  mcpPolicyForm: document.getElementById("mcpPolicyForm"),
  solutionBoard: document.getElementById("solutionBoard"),
  miniPackageSummary: document.getElementById("miniPackageSummary"),
  buildTag: document.getElementById("buildTag"),
  workspaceModeBtn: document.getElementById("workspaceModeBtn"),
  openOpsBtn: document.getElementById("openOpsBtn"),
  languageTag: document.getElementById("languageTag"),
  langPillLabel: document.getElementById("langPillLabel"),
  langSwitch: document.getElementById("langSwitch"),
  locateBtn: document.getElementById("locateBtn"),
  locationTag: document.getElementById("locationTag"),
  viewModeTag: document.getElementById("viewModeTag"),
  viewModeForm: document.getElementById("viewModeForm"),
  emergencyBtn: document.getElementById("emergencyBtn"),
  drawer: document.getElementById("taskDrawer"),
  drawerTitle: document.getElementById("drawerTitle"),
  drawerBody: document.getElementById("drawerBody"),
  replanDrawer: document.getElementById("replanDrawer"),
  conditionEditorDrawer: document.getElementById("conditionEditorDrawer"),
  conditionEditorForm: document.getElementById("conditionEditorForm"),
  conditionEditorTitle: document.getElementById("conditionEditorTitle"),
  closeConditionEditorBtn: document.getElementById("closeConditionEditorBtn"),
  conditionIntent: document.getElementById("conditionIntent"),
  conditionCity: document.getElementById("conditionCity"),
  conditionArea: document.getElementById("conditionArea"),
  conditionPartySize: document.getElementById("conditionPartySize"),
  conditionBudget: document.getElementById("conditionBudget"),
  conditionTimeConstraint: document.getElementById("conditionTimeConstraint"),
  conditionPreferences: document.getElementById("conditionPreferences"),
  conditionExecutionPermission: document.getElementById("conditionExecutionPermission"),
  replanTitle: document.getElementById("replanTitle"),
  replanForm: document.getElementById("replanForm"),
  replanHint: document.getElementById("replanHint"),
  replanPreview: document.getElementById("replanPreview"),
  replanTaskId: document.getElementById("replanTaskId"),
  replanTemplateId: document.getElementById("replanTemplateId"),
  replanIntent: document.getElementById("replanIntent"),
  trustSummaryCard: document.getElementById("trustSummaryCard"),
  proofDrawer: document.getElementById("proofDrawer"),
  proofDrawerBody: document.getElementById("proofDrawerBody"),
  proofDrawerTitle: document.getElementById("proofDrawerTitle"),
  orderDrawer: document.getElementById("orderDrawer"),
  orderDrawerBody: document.getElementById("orderDrawerBody"),
  orderDrawerTitle: document.getElementById("orderDrawerTitle"),
  supportRoomDrawer: document.getElementById("supportRoomDrawer"),
  supportRoomTitle: document.getElementById("supportRoomTitle"),
  supportRoomStatus: document.getElementById("supportRoomStatus"),
  supportRoomMeta: document.getElementById("supportRoomMeta"),
  supportRoomMessages: document.getElementById("supportRoomMessages"),
  supportRoomForm: document.getElementById("supportRoomForm"),
  supportRoomInput: document.getElementById("supportRoomInput"),
  supportRoomVoiceBtn: document.getElementById("supportRoomVoiceBtn"),
  supportRoomSendBtn: document.getElementById("supportRoomSendBtn"),
  closeSupportRoomBtn: document.getElementById("closeSupportRoomBtn"),
  subtabs: [...document.querySelectorAll(".subtab")],
  flowRailTitle: document.getElementById("flowRailTitle"),
  flowRail: document.getElementById("flowRail"),
  brainTitle: document.getElementById("brainTitle"),
  brainState: document.getElementById("brainState"),
};

const REPLAN_TEMPLATES = {
  eat_local: {
    intent: {
      EN: "Find authentic local noodles nearby and reserve a table for me.",
      ZH: "帮我找附近地道面馆并预约一个位置。",
    },
    constraints: {
      budget: "mid",
      distance: "walk",
      time: "soon",
      dietary: "",
      family: false,
      accessibility: "optional",
      city: "Shanghai",
      origin: "",
      destination: "",
    },
  },
  airport_rush: {
    intent: {
      EN: "Go from my hotel to the airport quickly and lock transport now.",
      ZH: "从酒店尽快去机场并立即锁定交通。",
    },
    constraints: {
      budget: "high",
      distance: "ride",
      time: "soon",
      dietary: "",
      family: false,
      accessibility: "yes",
      city: "Shanghai",
      origin: "hotel",
      destination: "PVG",
    },
  },
  family_food: {
    intent: {
      EN: "Find family-friendly local food with short waiting time and reserve now.",
      ZH: "找亲子友好且排队短的地道餐厅并立即预订。",
    },
    constraints: {
      budget: "mid",
      distance: "ride",
      time: "normal",
      dietary: "",
      family: true,
      accessibility: "yes",
      city: "Shanghai",
      origin: "",
      destination: "",
    },
  },
};

function escapeHtml(input) {
  return String(input || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function assetUrl(url) {
  const raw = String(url || "");
  if (!raw) return "";
  if (/^https?:\/\//i.test(raw)) return raw;
  return `${raw}${raw.includes("?") ? "&" : "?"}v=${ASSET_VERSION}`;
}

function tTerm(key) {
  return i18n.term(state.uiLanguage, key);
}

function tUi(key, vars) {
  return i18n.t(state.uiLanguage, `ui.${key}`, vars);
}

function pickText(zh, en, ja, ko) {
  if (state.uiLanguage === "ZH") return zh;
  if (state.uiLanguage === "JA") return ja || en;
  if (state.uiLanguage === "KO") return ko || en;
  return en;
}

function getLoopStages() {
  return [
    { key: "intent", label: pickText("意图", "Intent", "意図", "의도") },
    { key: "plan", label: pickText("计划", "Plan", "計画", "계획") },
    { key: "confirm", label: pickText("确认", "Confirm", "確認", "확인") },
    { key: "execute", label: pickText("执行", "Execute", "実行", "실행") },
    { key: "proof", label: pickText("凭证", "Proof", "証憑", "증빙") },
    { key: "support", label: pickText("售后", "Support", "サポート", "지원") },
  ];
}

function getLoopStageIndex(key) {
  const stages = getLoopStages();
  const idx = stages.findIndex((item) => item.key === key);
  return idx < 0 ? 0 : idx;
}

function renderFlowRail() {
  if (!el.flowRail) return;
  const stages = getLoopStages();
  const activeIndex = getLoopStageIndex(state.loopProgress || "intent");
  el.flowRail.innerHTML = stages
    .map((stage, idx) => {
      const phase = idx < activeIndex ? "done" : idx === activeIndex ? "active" : "pending";
      return `
        <div class="flow-step ${phase}" data-stage="${escapeHtml(stage.key)}">
          <span class="flow-dot" aria-hidden="true"></span>
          <span class="flow-label">${escapeHtml(stage.label)}</span>
        </div>
      `;
    })
    .join("");
}

function setLoopProgress(stageKey) {
  const safe = stageKey || "intent";
  state.loopProgress = safe;
  renderFlowRail();
  renderConversationAura();
  renderHumanAssistDock();
}

function getConversationAuraState() {
  if (state.voice.listening) {
    return { mode: "listening", label: pickText("正在聆听，你可以直接说需求。", "Listening. Speak your request.", "聞き取り中です。要望を話してください。", "듣는 중입니다. 요청을 말해 주세요.") };
  }
  if (state.voice.speaking) {
    return { mode: "speaking", label: pickText("正在播报方案与下一步动作。", "Speaking the plan and next action.", "プランと次のアクションを読み上げ中です。", "계획과 다음 행동을 안내 중입니다.") };
  }
  if (state.voice.processing) {
    return { mode: "planning", label: pickText("正在理解你的意图并组装执行方案。", "Understanding intent and assembling plan.", "意図を解析して実行プランを構成中です。", "의도를 파악하고 실행 계획을 구성 중입니다.") };
  }
  if (state.loopProgress === "execute" || state.loopProgress === "proof") {
    return { mode: "executing", label: pickText("正在执行步骤并生成凭证。", "Executing steps and generating proof.", "ステップを実行して証憑を生成中です。", "단계를 실행하고 증빙을 생성 중입니다.") };
  }
  if (state.loopProgress === "plan" || state.loopProgress === "confirm") {
    return { mode: "planning", label: pickText("正在规划可执行闭环。", "Planning executable closed loop.", "実行可能なクローズドループを計画中です。", "실행 가능한 폐쇄 루프를 계획 중입니다.") };
  }
  if (state.loopProgress === "support") {
    return { mode: "support", label: pickText("已进入人工协助流程，系统持续跟进。", "Human assist mode active. Monitoring in progress.", "有人サポートに切替済み。継続監視中です。", "사람 지원 모드 활성. 계속 모니터링 중입니다.") };
  }
  return { mode: "idle", label: pickText("待命中。输入一句话即可开始闭环执行。", "Standby. One sentence starts execution.", "待機中。ひと言で実行を開始できます。", "대기 중. 한 문장으로 실행을 시작할 수 있습니다.") };
}

function renderConversationAura() {
  if (!el.conversationAura) return;
  const meta = getConversationAuraState();
  el.conversationAura.dataset.mode = meta.mode;
  if (el.conversationAuraLabel) {
    el.conversationAuraLabel.textContent = meta.label;
  }
}

function pulseConversationAura() {
  if (!el.conversationAura) return;
  el.conversationAura.classList.remove("aura-burst");
  void el.conversationAura.offsetWidth;
  el.conversationAura.classList.add("aura-burst");
}

let thinkingActivatedAt = 0;
let thinkingHideTimer = null;
// P2: abort controller for in-flight plan stream (one active stream at a time)
let _currentPlanAbortController = null;

/**
 * isAiBusy() — true whenever ANY async AI operation is in flight.
 * Language switching must never trigger new LLM calls while busy.
 * Covers: SSE plan stream, slot-filling, chat reply, thinking indicator.
 */
function isAiBusy() {
  return Boolean(_currentPlanAbortController)
      || el.thinkingIndicator?.classList.contains("is-active") === true;
}

function applyThinkingIndicatorState(active, text = "") {
  if (!el.thinkingIndicator) return;
  const on = active === true;
  el.thinkingIndicator.classList.toggle("hidden", !on);
  el.thinkingIndicator.classList.toggle("is-active", on);
  // Apple AI animation: glow border on chat form + background aura
  if (el.chatForm) el.chatForm.classList.toggle("is-ai-thinking", on);
  document.body.classList.toggle("ai-thinking", on);
  if (on) {
    el.thinkingIndicator.textContent =
      text
      || pickText(
        "正在思考并生成定制化方案...",
        "Thinking and building tailored options...",
        "思考中。カスタム提案を生成しています...",
        "생각 중입니다. 맞춤 제안을 생성하고 있어요...",
      );
    if (el.conversationAura) {
      el.conversationAura.dataset.mode = "planning";
    }
    pulseConversationAura();
  } else {
    renderConversationAura();
  }
}

function setThinkingIndicator(active, text = "") {
  const on = active === true;
  if (on) {
    if (thinkingHideTimer) {
      clearTimeout(thinkingHideTimer);
      thinkingHideTimer = null;
    }
    thinkingActivatedAt = Date.now();
    applyThinkingIndicatorState(true, text);
  } else {
    const elapsed = Date.now() - thinkingActivatedAt;
    const delay = Math.max(0, 420 - elapsed);
    if (delay > 0) {
      if (thinkingHideTimer) clearTimeout(thinkingHideTimer);
      thinkingHideTimer = setTimeout(() => {
        thinkingHideTimer = null;
        applyThinkingIndicatorState(false);
      }, delay);
      return;
    }
    applyThinkingIndicatorState(false);
  }
}

function renderHumanAssistDock() {
  if (!el.humanAssistSummary || !el.humanAssistMode) return;
  const task = state.currentTask || null;
  const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [];
  const openTickets = tickets.filter((t) => ["open", "in_progress"].includes(String(t.status || "").toLowerCase()));
  const currentTicketId = task && task.handoff ? String(task.handoff.ticketId || "") : "";
  const currentTicket = currentTicketId ? tickets.find((t) => t.id === currentTicketId) || null : null;

  let modeKey = "standby";
  if (currentTicket && String(currentTicket.status || "") === "resolved") modeKey = "resolved";
  else if (currentTicket || state.loopProgress === "support") modeKey = "active";
  else if (openTickets.length > 0) modeKey = "watching";

  const modeLabel =
    modeKey === "resolved"
      ? pickText("已解决", "Resolved", "解決済み", "해결됨")
      : modeKey === "active"
        ? pickText("人工处理中", "Human Active", "有人対応中", "사람 처리중")
        : modeKey === "watching"
          ? pickText("监督中", "Watching", "監視中", "모니터링")
          : pickText("待命", "Standby", "待機", "대기");
  const badgeClass = modeKey === "resolved" ? "success" : modeKey === "active" ? "running" : "queued";
  el.humanAssistMode.className = `status-badge ${badgeClass}`;
  el.humanAssistMode.textContent = modeLabel;

  if (task) {
    el.humanAssistSummary.textContent = pickText(
      `当前任务 ${task.id} 可由人工监督并接管关键步骤。`,
      `Task ${task.id} can be supervised with human takeover on critical steps.`,
      `現在のタスク ${task.id} は重要ステップで有人監督・引継ぎが可能です。`,
      `현재 작업 ${task.id} 은(는) 핵심 단계에서 사람 감독/인계가 가능합니다.`,
    );
  } else {
    el.humanAssistSummary.textContent = pickText(
      "当前没有活动任务，建议先输入目标再决定是否转人工。",
      "No active task. Start with one goal, then escalate to human if needed.",
      "進行中タスクはありません。まず目標を入力し、必要時に有人へ切替してください。",
      "활성 작업이 없습니다. 목표를 입력한 뒤 필요 시 사람 지원으로 전환하세요.",
    );
  }

  if (currentTicket) {
    const ticketLine = pickText(
      `工单 ${currentTicket.id} · 状态 ${localizeStatus(currentTicket.status)} · 处理方 ${currentTicket.handler || "human"}`,
      `Ticket ${currentTicket.id} · ${localizeStatus(currentTicket.status)} · handler ${currentTicket.handler || "human"}`,
      `チケット ${currentTicket.id} · ${localizeStatus(currentTicket.status)} · 担当 ${currentTicket.handler || "human"}`,
      `티켓 ${currentTicket.id} · ${localizeStatus(currentTicket.status)} · 담당 ${currentTicket.handler || "human"}`,
    );
    el.humanAssistTicket.innerHTML = `
      <span>${escapeHtml(ticketLine)}</span>
      <button class="secondary" data-action="open-ticket-detail" data-ticket="${escapeHtml(currentTicket.id)}">${pickText("查看详情", "Open Detail", "詳細を見る", "상세 보기")}</button>
      <button class="secondary" data-action="open-live-support" data-ticket="${escapeHtml(currentTicket.id)}">${pickText("进入人工会话", "Open Live Room", "ライブ会話を開く", "실시간 상담 열기")}</button>
    `;
    if (el.humanAssistEta) {
      el.humanAssistEta.dataset.createdAt = String(currentTicket.createdAt || currentTicket.updatedAt || new Date().toISOString());
      el.humanAssistEta.dataset.etaMin = String(Number(currentTicket.etaMin || 0));
      el.humanAssistEta.classList.add("eta-live");
    }
  } else {
    el.humanAssistTicket.textContent = pickText(
      `当前开放工单 ${openTickets.length} 个。`,
      `${openTickets.length} open support ticket(s) in queue.`,
      `オープンチケット ${openTickets.length} 件。`,
      `열린 지원 티켓 ${openTickets.length}건.`,
    );
    if (el.humanAssistEta) {
      el.humanAssistEta.textContent = "";
      delete el.humanAssistEta.dataset.createdAt;
      delete el.humanAssistEta.dataset.etaMin;
      el.humanAssistEta.classList.remove("eta-live");
    }
  }

  const recent = tickets
    .slice()
    .sort((a, b) => String(b.updatedAt || b.createdAt || "").localeCompare(String(a.updatedAt || a.createdAt || "")))
    .slice(0, 3)
    .map(
      (ticket) =>
        `<li><strong>${escapeHtml(ticket.id)}</strong> · <span class="status-badge ${escapeHtml(ticket.status || "queued")}">${escapeHtml(localizeStatus(ticket.status || "open"))}</span> <span class="status">${new Date(ticket.updatedAt || ticket.createdAt).toLocaleString()}</span></li>`,
    )
    .join("");
  if (el.humanAssistRecent) {
    el.humanAssistRecent.innerHTML =
      recent || `<li>${pickText("暂无人工工单记录。", "No human assist ticket yet.", "有人チケットはまだありません。", "사람 지원 티켓이 아직 없습니다.")}</li>`;
  }

  if (el.assistRequestBtn) {
    if (task && task.id) {
      el.assistRequestBtn.removeAttribute("disabled");
      el.assistRequestBtn.dataset.task = task.id;
    } else {
      el.assistRequestBtn.setAttribute("disabled", "true");
      delete el.assistRequestBtn.dataset.task;
    }
    if (currentTicket && ["open", "in_progress"].includes(String(currentTicket.status || "").toLowerCase())) {
      el.assistRequestBtn.textContent = pickText("人工已接管", "Human already assigned", "有人対応中", "사람 상담 진행중");
    } else {
      el.assistRequestBtn.textContent = pickText("请求人工监督", "Request Human Supervision", "有人監督を依頼", "사람 감독 요청");
    }
  }
  if (el.assistLiveCallBtn) {
    const preferred = currentTicket || openTickets[0] || null;
    if (preferred) {
      el.assistLiveCallBtn.removeAttribute("disabled");
      el.assistLiveCallBtn.dataset.ticket = preferred.id;
    } else {
      el.assistLiveCallBtn.setAttribute("disabled", "true");
      delete el.assistLiveCallBtn.dataset.ticket;
    }
  }
  updateSupportEtaCountdown();
}

function applySingleDialogMode() {
  if (IS_USER_PORTAL) {
    state.viewMode = "user";
    state.singleDialogMode = true;
  }
  if (state.viewMode !== "admin") {
    state.singleDialogMode = true;
  }
  document.body.classList.toggle("single-dialog-mode", state.singleDialogMode === true);
  if (state.singleDialogMode) {
    switchTab("chat", { force: true });
  }
  if (el.workspaceModeBtn) {
    const lockUserMode = state.viewMode !== "admin";
    const label = state.singleDialogMode
      ? pickText("切换工作台", "Open Workspace", "ワークスペース表示", "워크스페이스 열기")
      : pickText("简化对话", "Simple Dialog", "シンプル会話", "단순 대화");
    el.workspaceModeBtn.textContent = label;
    el.workspaceModeBtn.setAttribute("aria-pressed", state.singleDialogMode ? "true" : "false");
    el.workspaceModeBtn.title = state.singleDialogMode
      ? pickText("当前为单对话模式", "Single-dialog mode enabled", "シングル会話モード有効", "단일 대화 모드 활성")
      : pickText("当前为工作台模式", "Workspace mode enabled", "ワークスペースモード有効", "워크스페이스 모드 활성");
    el.workspaceModeBtn.classList.toggle("hidden-by-mode", lockUserMode);
    if (lockUserMode) {
      el.workspaceModeBtn.setAttribute("disabled", "true");
    } else {
      el.workspaceModeBtn.removeAttribute("disabled");
    }
  }
  autoResizeChatInput();
}

function slotLabel(slotKey) {
  const key = String(slotKey || "");
  const map = {
    city: pickText("城市", "City", "都市", "도시"),
    area: pickText("区域", "Area", "エリア", "지역"),
    cuisine: pickText("口味/餐型", "Cuisine", "料理タイプ", "요리 타입"),
    budget: pickText("预算", "Budget", "予算", "예산"),
    eta: pickText("时间", "Time", "時間", "시간"),
    group_size: pickText("人数", "Group size", "人数", "인원"),
    transport_mode: pickText("交通偏好", "Transport", "移動手段", "이동 수단"),
    payment_constraint: pickText("支付偏好", "Payment", "決済設定", "결제 설정"),
    origin: pickText("出发地", "Origin", "出発地", "출발지"),
    destination: pickText("目的地", "Destination", "目的地", "목적지"),
  };
  return map[key] || key;
}

function defaultSlotValue(slotKey) {
  const city = getCurrentCity();
  const dict = {
    city,
    area: "downtown",
    cuisine: "authentic_local",
    budget: "mid",
    eta: "soon",
    group_size: "2",
    transport_mode: "walk_first",
    payment_constraint: "alipay_cn",
    origin: "current_location",
    destination: "airport",
  };
  return dict[String(slotKey || "")] || "";
}

function renderAgentBrain(task = null) {
  if (!el.brainState) return;
  const current = task || state.currentTask || null;
  if (!current) {
    el.brainState.innerHTML = `<div class="status">${pickText("等待你的目标输入，我会自动路由专家与补全槽位。", "Waiting for your goal. I will route domain experts and fill slots.", "目標入力を待機中。専門家ルーティングとスロット補完を行います。", "목표 입력을 기다리는 중입니다. 전문가 라우팅과 슬롯 보완을 수행합니다.")}</div>`;
    renderHumanAssistDock();
    return;
  }
  const sessionState = current.sessionState || (current.plan && current.plan.sessionState) || {};
  const expertRoute = current.expertRoute || (current.plan && current.plan.expertRoute) || {};
  const experts = Array.isArray(expertRoute.experts) ? expertRoute.experts : [];
  const slots = sessionState.slots && typeof sessionState.slots === "object" ? sessionState.slots : {};
  const missingSlots = Array.isArray(sessionState.missingSlots) ? sessionState.missingSlots : [];

  const expertHtml = experts
    .map(
      (item) =>
        `<div class="expert-chip"><strong>${escapeHtml(item.name || "-")}</strong><span>${Math.round(Number(item.confidence || 0) * 100)}%</span></div>`,
    )
    .join("");
  const slotRows = Object.entries(slots)
    .filter(([, v]) => String(v || "").trim())
    .map(([k, v]) => `<li><span>${escapeHtml(slotLabel(k))}</span><strong>${escapeHtml(String(v))}</strong></li>`)
    .join("");
  const missingRows = missingSlots
    .map(
      (slot) => `
      <button class="secondary slot-fill-btn" data-action="fill-missing-slot" data-task="${escapeHtml(current.id)}" data-slot="${escapeHtml(slot)}">
        ${escapeHtml(slotLabel(slot))} · ${pickText("一键补全", "Quick fill", "補完", "빠른 보완")}
      </button>
    `,
    )
    .join("");

  el.brainState.innerHTML = `
    <div class="brain-grid">
      <article class="brain-block">
        <h4>${pickText("专家路由", "Expert routing", "専門家ルーティング", "전문가 라우팅")}</h4>
        <div class="status">${pickText("主专家", "Primary", "主担当", "주 담당")}: <strong>${escapeHtml(expertRoute.primary || "-")}</strong></div>
        <div class="expert-list">${expertHtml || `<span class="status">-</span>`}</div>
        <div class="status">${escapeHtml(expertRoute.reason || "")}</div>
      </article>
      <article class="brain-block">
        <h4>${pickText("会话状态", "Session state", "セッション状態", "세션 상태")}</h4>
        <div class="status">${pickText("阶段", "Stage", "ステージ", "단계")}: <strong>${escapeHtml(sessionState.stage || "planning")}</strong> · Lane: <strong>${escapeHtml(sessionState.laneId || (current.plan && current.plan.laneId) || "-")}</strong></div>
        <ul class="slot-list">${slotRows || `<li class="status">${pickText("暂无已识别槽位。", "No filled slots yet.", "入力済みスロットはありません。", "채워진 슬롯이 없습니다.")}</li>`}</ul>
      </article>
      <article class="brain-block">
        <h4>${pickText("待补充信息", "Missing slots", "不足スロット", "누락 슬롯")}</h4>
        <div class="slot-fill-actions">
          ${
            missingRows ||
            `<span class="status">${pickText("已满足执行条件。", "All required slots are filled.", "必須スロットは満たされています。", "필수 슬롯이 모두 채워졌습니다.")}</span>`
          }
        </div>
      </article>
    </div>
  `;
  motion.bindPressables(el.brainState);
  renderHumanAssistDock();
}

function speechLocaleForLang(lang) {
  if (lang === "ZH") return "zh-CN";
  if (lang === "JA") return "ja-JP";
  if (lang === "KO") return "ko-KR";
  return "en-US";
}

function isSpeechSynthesisSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window && typeof window.SpeechSynthesisUtterance === "function";
}

function isAudioPlaybackSupported() {
  return typeof window !== "undefined" && typeof window.Audio === "function";
}

function stopCurrentVoicePlayback() {
  if (state.voice.audioPlayer) {
    try {
      state.voice.audioPlayer.pause();
      state.voice.audioPlayer.currentTime = 0;
    } catch {
      // ignore
    }
    state.voice.audioPlayer = null;
  }
}

function clearVoiceRestartTimer() {
  if (!state.voice.restartTimer) return;
  clearTimeout(state.voice.restartTimer);
  state.voice.restartTimer = null;
}

function clearVoiceListenTimer() {
  if (!state.voice.listenTimer) return;
  clearTimeout(state.voice.listenTimer);
  state.voice.listenTimer = null;
}

function startVoiceListenTimer() {
  clearVoiceListenTimer();
  if (!state.voice.conversationMode) return;
  state.voice.listenTimer = setTimeout(() => {
    state.voice.listenTimer = null;
    if (!state.voice.conversationMode || !state.voice.listening || !state.voice.recognition) return;
    try {
      state.voice.recognition.stop();
    } catch {
      // ignore
    }
    notify(
      pickText(
        "单次语音已到 60 秒，我继续待命并自动续听。",
        "60-second voice window reached. I am still on standby and will auto-listen again.",
        "音声入力は60秒に達しました。待機を継続し自動で再開します。",
        "음성 입력 60초에 도달했습니다. 대기 상태를 유지하고 자동으로 다시 청취합니다.",
      ),
      "info",
    );
  }, motion.safeDuration(60000));
}

async function ensureMicrophoneReady() {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return true;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    for (const track of stream.getTracks()) track.stop();
    return true;
  } catch (err) {
    const reason = err && err.name ? err.name : "permission_denied";
    notify(
      pickText(
        `麦克风权限不可用：${reason}`,
        `Microphone permission unavailable: ${reason}`,
        `マイク権限が利用できません: ${reason}`,
        `마이크 권한을 사용할 수 없습니다: ${reason}`,
      ),
      "error",
    );
    return false;
  }
}

function startVoiceRecognitionNow() {
  if (!state.voice.supported || !state.voice.recognition) return false;
  if (state.voice.listening) return true;
  try {
    state.voice.recognition.lang = speechLocaleForLang(state.uiLanguage);
    state.voice.recognition.start();
    return true;
  } catch (err) {
    const reason = err && err.message ? err.message : "start_failed";
    notify(
      pickText(
        `语音启动失败：${reason}`,
        `Voice start failed: ${reason}`,
        `音声起動に失敗: ${reason}`,
        `음성 시작 실패: ${reason}`,
      ),
      "warning",
    );
    return false;
  }
}

function scheduleVoiceRestart(delayMs = 420) {
  if (!state.voice.conversationMode) return;
  if (!state.voice.recognition || !state.voice.supported) return;
  if (state.voice.processing || state.voice.listening || state.voice.speaking) return;
  if (isSpeechSynthesisSupported() && window.speechSynthesis.speaking) return;
  clearVoiceRestartTimer();
  state.voice.restartTimer = setTimeout(() => {
    state.voice.restartTimer = null;
    if (!state.voice.conversationMode || state.voice.listening || state.voice.processing || state.voice.speaking) return;
    startVoiceRecognitionNow();
  }, motion.safeDuration(delayMs));
}

async function requestOpenAIVoiceAudio(text) {
  const content = String(text || "").trim();
  if (!content) return null;
  try {
    const data = await api("/api/chat/voice", {
      method: "POST",
      body: JSON.stringify({
        text: content.slice(0, 1000),
        language: state.uiLanguage,
      }),
    });
    if (!data || data.ok !== true || typeof data.audioDataUrl !== "string" || !data.audioDataUrl.startsWith("data:audio/")) {
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function playAudioDataUrl(dataUrl) {
  if (!isAudioPlaybackSupported()) return Promise.reject(new Error("audio_playback_unavailable"));
  return new Promise((resolve, reject) => {
    const audio = new Audio(dataUrl);
    state.voice.audioPlayer = audio;
    audio.onended = () => {
      if (state.voice.audioPlayer === audio) state.voice.audioPlayer = null;
      resolve(true);
    };
    audio.onerror = () => {
      if (state.voice.audioPlayer === audio) state.voice.audioPlayer = null;
      reject(new Error("audio_playback_failed"));
    };
    try {
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === "function") {
        playPromise.catch((err) => {
          if (state.voice.audioPlayer === audio) state.voice.audioPlayer = null;
          reject(err);
        });
      }
    } catch (err) {
      if (state.voice.audioPlayer === audio) state.voice.audioPlayer = null;
      reject(err);
    }
  });
}

function speakWithBrowserSynthesis(content) {
  if (!isSpeechSynthesisSupported()) return Promise.reject(new Error("speech_synthesis_unavailable"));
  return new Promise((resolve, reject) => {
    try {
      const utterance = new SpeechSynthesisUtterance(String(content || "").slice(0, 320));
      utterance.lang = speechLocaleForLang(state.uiLanguage);
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.onend = () => resolve(true);
      utterance.onerror = () => reject(new Error("speech_synthesis_failed"));
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      reject(err);
    }
  });
}

function speakAssistantMessage(text) {
  if (!state.voice.replyEnabled) return;
  const content = String(text || "").replace(/\s+/g, " ").trim();
  if (!content) return;
  const run = async () => {
    state.voice.speaking = true;
    clearVoiceRestartTimer();
    if (state.voice.listening && state.voice.recognition) {
      try {
        state.voice.recognition.stop();
      } catch {
        // ignore
      }
    }
    stopCurrentVoicePlayback();
    if (isSpeechSynthesisSupported()) {
      window.speechSynthesis.cancel();
    }
    renderVoiceControls();
    let played = false;
    if (state.viewMode !== "admin") {
      const tts = await requestOpenAIVoiceAudio(content);
      if (tts && tts.audioDataUrl) {
        try {
          await playAudioDataUrl(tts.audioDataUrl);
          played = true;
        } catch {
          played = false;
        }
      }
    }
    if (!played) {
      try {
        await speakWithBrowserSynthesis(content);
      } catch {
        // ignore local synthesis failure
      }
    }
  };
  run()
    .catch(() => {
      // ignore speech errors
    })
    .finally(() => {
      stopCurrentVoicePlayback();
      if (isSpeechSynthesisSupported() && window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }
      state.voice.speaking = false;
      renderVoiceControls();
      scheduleVoiceRestart();
    });
}

function shouldRenderAgentFlowCards() {
  // Show agent flow cards (plan/confirm/execute) in all modes when agent is active
  const mode = String((state.agentConversation && state.agentConversation.mode) || "idle");
  if (mode !== "idle") return true;
  return state.viewMode === "admin";
}

function renderVoiceControls() {
  const now = Date.now();
  const voiceErrorUntil = Number(state.voice.errorUntil || 0);
  const voiceInterruptedUntil = Number(state.voice.interruptedUntil || 0);
  let voiceUiState = "idle";
  if (voiceErrorUntil > now) voiceUiState = "error";
  else if (voiceInterruptedUntil > now) voiceUiState = "interrupted";
  else if (state.voice.speaking) voiceUiState = "speaking";
  else if (state.voice.processing || state.voice.translating) voiceUiState = "processing";
  else if (state.voice.listening) voiceUiState = "listening";

  if (el.voiceInputBtn) {
    const label = !state.voice.supported
      ? pickText("语音输入不可用", "Voice input unavailable", "音声入力は利用不可", "음성 입력 사용 불가")
      : voiceUiState === "error"
        ? pickText("语音输入异常", "Voice input error", "音声入力エラー", "음성 입력 오류")
        : voiceUiState === "interrupted"
          ? pickText("语音输入已中断", "Voice input interrupted", "音声入力を中断", "음성 입력 중단")
          : voiceUiState === "speaking"
            ? pickText("正在语音播报", "Speaking", "音声で案内中", "음성 안내 중")
            : voiceUiState === "processing"
              ? pickText("正在转写与翻译", "Transcribing and translating", "文字起こしと翻訳中", "음성 인식/번역 중")
              : voiceUiState === "listening"
                ? pickText("正在听你说话", "Listening", "聞き取り中", "듣는 중")
                : pickText("语音输入", "Voice input", "音声入力", "음성 입력");
    const disabled = !state.voice.supported || (state.voice.processing && !state.voice.listening);
    if (taskComponents && taskComponents.VoiceButton) {
      taskComponents.VoiceButton.apply(el.voiceInputBtn, {
        state: voiceUiState,
        label,
        disabled,
        ariaPressed: state.voice.listening === true,
        iconOnly: true,
      });
    } else {
      el.voiceInputBtn.disabled = disabled;
      el.voiceInputBtn.setAttribute("aria-pressed", state.voice.listening ? "true" : "false");
      el.voiceInputBtn.classList.toggle("is-on", state.voice.listening || state.voice.processing || state.voice.translating);
      el.voiceInputBtn.classList.toggle("is-listening", voiceUiState === "listening");
      el.voiceInputBtn.classList.toggle("is-speaking", voiceUiState === "speaking");
      el.voiceInputBtn.classList.toggle("is-processing", voiceUiState === "processing");
      el.voiceInputBtn.classList.toggle("is-interrupted", voiceUiState === "interrupted");
      el.voiceInputBtn.classList.toggle("is-error", voiceUiState === "error");
      el.voiceInputBtn.innerHTML = `<span class="voice-stem" aria-hidden="true"></span><span class="sr-only">${escapeHtml(label)}</span>`;
      el.voiceInputBtn.setAttribute("title", label);
      el.voiceInputBtn.setAttribute("aria-label", label);
    }
  }
  if (el.voiceReplyBtn) {
    const canSpeak = isSpeechSynthesisSupported() || isAudioPlaybackSupported();
    el.voiceReplyBtn.disabled = !canSpeak;
    el.voiceReplyBtn.setAttribute("aria-pressed", state.voice.replyEnabled ? "true" : "false");
    el.voiceReplyBtn.textContent = canSpeak
      ? state.voice.replyEnabled
        ? pickText("语音播报开", "Voice Reply On", "音声応答オン", "음성 응답 켜짐")
        : pickText("语音播报关", "Voice Reply Off", "音声応答オフ", "음성 응답 꺼짐")
      : pickText("播报不可用", "Reply Audio N/A", "音声応答不可", "음성 응답 미지원");
  }
  renderConversationAura();
}

function normalizeVoiceText(text) {
  return String(text || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function parseVoiceCommand(text) {
  const normalized = normalizeVoiceText(text);
  if (!normalized) return "empty";
  const check = (terms) => terms.some((term) => normalized.includes(term));
  if (check(["wait", "hold on", "pause", "等一下", "停一下", "先别说", "잠깐", "잠시만", "ちょっと待って"])) return "interrupt";
  if (check(["stop", "退出", "结束", "结束对话", "停止", "中止", "終了", "정지", "종료"])) return "stop";
  if (check(["confirm", "execute", "go ahead", "continue", "yes", "开始执行", "确认执行", "继续", "确认", "同意", "実行", "確認", "続けて", "동의", "확인", "실행", "계속"])) return "confirm";
  if (check(["cancel", "abort", "no", "取消", "不要了", "キャンセル", "취소"])) return "cancel";
  if (check(["human", "handoff", "agent", "人工", "转人工", "客服", "有人", "담당자", "상담"])) return "handoff";
  if (check(["retry", "重试", "再试", "再来", "再実行", "재시도"])) return "retry";
  if (check(["switch lane", "换路线", "切换路线", "ルート変更", "경로 변경"])) return "switch_lane";
  if (check(["modify", "change", "edit", "修改", "调整", "변경", "수정", "変更"])) return "modify";
  if (check(["new task", "new request", "新任务", "重新开始", "새 작업", "새 요청", "新しい依頼"])) return "new_task";
  return "intent";
}

function getVoiceConfirmHint() {
  return pickText(
    "你可以说\u201c确认执行\u201d、\u201c切换路线\u201d或\u201c人工接管\u201d。",
    'You can say "confirm execute", "switch lane", or "ask human".',
    "「実行を確認」「ルート変更」「有人対応」を話せます。",
    '"실행 확인", "경로 변경", "사람 상담"이라고 말할 수 있습니다.',
  );
}

function stopVoiceConversation(notifyUser = true) {
  state.voice.conversationMode = false;
  state.voice.pendingTaskId = null;
  state.voice.processing = false;
  state.voice.interruptedUntil = 0;
  state.voice.errorUntil = 0;
  clearVoiceRestartTimer();
  clearVoiceListenTimer();
  if (state.voice.listening && state.voice.recognition) {
    try {
      state.voice.recognition.stop();
    } catch {
      // ignore
    }
  }
  stopCurrentVoicePlayback();
  if (isSpeechSynthesisSupported()) {
    window.speechSynthesis.cancel();
  }
  state.voice.speaking = false;
  renderVoiceControls();
  if (notifyUser) {
    notify(
      pickText("已退出语音对话模式。", "Talk mode turned off.", "会話モードを終了しました。", "대화 모드를 종료했습니다."),
      "info",
    );
  }
}

function interruptAssistantSpeech(reason = "manual") {
  let interrupted = false;
  if (state.voice.audioPlayer) {
    try {
      state.voice.audioPlayer.pause();
      state.voice.audioPlayer.currentTime = 0;
      interrupted = true;
    } catch {
      // ignore
    }
  }
  stopCurrentVoicePlayback();
  if (isSpeechSynthesisSupported()) {
    if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
      window.speechSynthesis.cancel();
      interrupted = true;
    }
  }
  if (state.voice.speaking) {
    state.voice.speaking = false;
    interrupted = true;
  }
  if (interrupted) {
    state.voice.interruptedUntil = Date.now() + 1600;
    setTimeout(() => {
      renderVoiceControls();
    }, motion.safeDuration(1650));
  }
  renderVoiceControls();
  if (interrupted) {
    appendAgentTelemetry("voice_barge_in", { reason });
  }
  return interrupted;
}

function toggleConstraintPanel(expanded) {
  const nextExpanded = typeof expanded === "boolean" ? expanded : !state.constraintsExpanded;
  state.constraintsExpanded = nextExpanded;
  if (el.toggleConstraintsBtn) {
    el.toggleConstraintsBtn.textContent = nextExpanded
      ? pickText("收起约束", "Hide Constraints", "条件を閉じる", "조건 닫기")
      : pickText("展开约束", "Show Constraints", "条件を表示", "조건 보기");
    el.toggleConstraintsBtn.setAttribute("aria-expanded", nextExpanded ? "true" : "false");
  }
  const chipsWrap = document.getElementById("constraintChips");
  if (chipsWrap) {
    chipsWrap.classList.toggle("is-collapsed", !nextExpanded);
  }
}

function quickGoalTemplates() {
  const city = getCurrentCity();
  return [
    {
      id: "goal-eat",
      title: pickText("附近地道餐厅", "Authentic food nearby", "近くのローカル店", "근처 로컬 맛집"),
      subtitle: pickText("自动排队、订位、支付并给导航", "Queue + reserve + pay + navigate", "並び・予約・決済・ナビを自動実行", "대기·예약·결제·길안내 자동 실행"),
      intent: pickText(
        `帮我在${city}附近找地道餐厅，直接帮我排队订位并完成支付和双语导航。`,
        `In ${city}, find authentic local food nearby, queue and reserve for me, then pay and give bilingual navigation.`,
        `${city}で近くのローカル店を探し、並び・予約・決済・二言語ナビまで実行して。`,
        `${city}에서 근처 로컬 맛집을 찾아 대기·예약·결제·이중언어 길안내까지 진행해줘.`,
      ),
    },
    {
      id: "goal-airport",
      title: pickText("准时去机场", "Reach airport on time", "空港に間に合う", "공항 제시간 도착"),
      subtitle: pickText("避堵路线 + 一键锁车 + 自动支付", "Route + lock ride + auto pay", "渋滞回避 + 配車確保 + 自動決済", "혼잡 회피 + 차량 잠금 + 자동 결제"),
      intent: pickText(
        `从我当前位置先去目的地再去机场，避开拥堵并自动锁定交通和支付。`,
        `From my current location, go to the destination then airport, avoid congestion, and auto-lock transport with payment.`,
        `現在地から目的地経由で空港へ。渋滞を避け、移動手配と決済を自動で完了して。`,
        `현재 위치에서 목적지 경유 후 공항으로 가고, 혼잡을 피해서 이동 수단 잠금과 결제를 자동으로 완료해줘.`,
      ),
    },
    {
      id: "goal-family",
      title: pickText("亲子友好方案", "Family-friendly plan", "ファミリー向けプラン", "가족 친화 플랜"),
      subtitle: pickText("少等待、可退改、凭证可分享", "Low wait, refundable, shareable proof", "待ち時間短め・返金可・共有証憑", "짧은 대기, 환불 가능, 공유 증빙"),
      intent: pickText(
        `帮我安排亲子友好、等待时间短、可退改的餐厅并生成可分享凭证。`,
        `Arrange a family-friendly option with short wait and clear refund policy, then generate shareable proof.`,
        `家族向けで待ち時間が短く返金条件が明確な店舗を手配し、共有できる証憑を作って。`,
        `가족 친화적이고 대기 시간이 짧으며 환불 조건이 명확한 옵션을 잡아주고 공유 가능한 증빙을 만들어줘.`,
      ),
    },
  ];
}

function renderQuickGoals() {
  if (!el.quickGoals) return;
  const cards = quickGoalTemplates()
    .map(
      (item) => `
      <button class="quick-goal" data-action="run-intent" data-intent="${escapeHtml(item.intent)}" type="button">
        <strong>${escapeHtml(item.title)}</strong>
        <span>${escapeHtml(item.subtitle)}</span>
      </button>
    `,
    )
    .join("");
  el.quickGoals.innerHTML = cards;
  motion.bindPressables(el.quickGoals);
}

function initVoiceAssistant() {
  const RecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
  state.voice.supported = typeof RecognitionCtor === "function";
  if (!state.voice.supported) {
    renderVoiceControls();
    return;
  }
  if (state.voice.recognition) {
    renderVoiceControls();
    return;
  }
  const recognition = new RecognitionCtor();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.maxAlternatives = 1;
  recognition.lang = speechLocaleForLang(state.uiLanguage);
  recognition.onstart = () => {
    state.voice.listening = true;
    startVoiceListenTimer();
    renderVoiceControls();
  };
  recognition.onend = () => {
    state.voice.listening = false;
    clearVoiceListenTimer();
    renderVoiceControls();
  };
  recognition.onerror = (event) => {
    state.voice.listening = false;
    clearVoiceListenTimer();
    const errorCode = event && event.error ? String(event.error) : "unknown";
    clearVoiceRestartTimer();
    state.voice.errorUntil = Date.now() + 2200;
    setTimeout(() => {
      renderVoiceControls();
    }, motion.safeDuration(2250));
    renderVoiceControls();
    notify(
      pickText(
        `语音识别失败：${errorCode}`,
        `Voice recognition failed: ${errorCode}`,
        `音声認識に失敗: ${errorCode}`,
        `음성 인식 실패: ${errorCode}`,
      ),
      "error",
    );
  };
  recognition.onresult = async (event) => {
    let finalTranscript = "";
    let interimTranscript = "";
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i];
      const piece = String((result && result[0] && result[0].transcript) || "");
      if (result.isFinal) {
        finalTranscript += `${piece} `;
      } else {
        interimTranscript += `${piece} `;
      }
    }
    if (interimTranscript && el.chatInput) {
      el.chatInput.value = interimTranscript.trim();
      autoResizeChatInput();
      updateChatSendState();
    }
    const text = finalTranscript.trim();
    if (!text || state.voice.processing) return;
    clearVoiceListenTimer();
    await handleVoiceTranscript(text);
  };
  state.voice.recognition = recognition;
  renderVoiceControls();
}

async function handleVoiceTranscript(text) {
  const transcript = String(text || "").trim();
  if (!transcript) return;
  if (el.chatInput) {
    el.chatInput.value = transcript;
    autoResizeChatInput();
    updateChatSendState();
  }
  notify(
    pickText(`识别到：${transcript}`, `Heard: ${transcript}`, `認識結果: ${transcript}`, `인식 결과: ${transcript}`),
    "success",
  );
  state.voice.processing = true;
  clearVoiceRestartTimer();
  try {
    const command = parseVoiceCommand(transcript);
    if (command === "stop") {
      stopVoiceConversation();
      return;
    }
    if (isLocalAgentChatEnabled()) {
      if (command === "interrupt") {
        interruptAssistantSpeech("voice_interrupt");
        // Remove interrupt trigger words, keep the constraint content
        const cleanedTranscript = transcript
          .replace(/等一下|hold\s+on|wait|pause|停一下|稍等/gi, "")
          .trim();
        if (cleanedTranscript && cleanedTranscript.length > 3) {
          addMessage(
            pickText(
              `收到，已暂停。根据「${cleanedTranscript}」更新约束并重新规划。`,
              `Got it. Paused. Updating constraints: "${cleanedTranscript}" and replanning.`,
              `了解。一時停止。「${cleanedTranscript}」を基に再計画します。`,
              `알겠습니다. 정지. "${cleanedTranscript}"으로 재계획합니다.`,
            ),
            "agent",
          );
          state.voice.processing = false;
          await handleAgentConversationInput(cleanedTranscript);
        } else {
          addMessage(
            pickText(
              "收到，我已暂停播报。请直接说要修改的条件。",
              "Got it. I paused playback. Tell me what to change.",
              "了解しました。読み上げを停止しました。変更条件を話してください。",
              "알겠습니다. 음성 출력을 멈췄어요. 바꿀 조건을 말해주세요.",
            ),
            "agent",
          );
        }
        return;
      }
      if (command === "handoff") {
        const data = await api("/api/emergency/support", {
          method: "POST",
          body: JSON.stringify({ reason: "voice_requested_handoff", taskId: state.currentTask?.id || null }),
        });
        if (data && data.ticket) updateSupportRoomTicketState(data.ticket);
        addMessage(
          pickText(
            `已转人工处理，工单 ${data.ticketId}。`,
            `Human handoff created. Ticket ${data.ticketId}.`,
            `有人対応に切替しました。チケット ${data.ticketId}。`,
            `사람 상담으로 전환되었습니다. 티켓 ${data.ticketId}.`,
          ),
          "agent",
        );
        if (data && data.sessionId) {
          await openSupportRoomBySession(data.sessionId, null).catch(() => {});
        } else if (data && data.ticketId) {
          await openSupportRoomByTicket(data.ticketId, null, { reason: "voice_handoff_open_live" }).catch(() => {});
        }
        setLoopProgress("support");
        return;
      }
      const currentMode = String(state.agentConversation.mode || "idle");
      if (command === "confirm") {
        if (currentMode === "confirming") {
          await runAgentExecution(state.agentConversation.pendingOptionKey || "main", false);
          return;
        }
        if (currentMode === "planning") {
          state.agentConversation.pendingOptionKey = "main";
          setAgentMode("confirming", { source: "voice_confirm_request" });
          rerenderAgentFlowCards();
          addMessage(
            pickText(
              "我先展示确认卡，确认后就开始执行。",
              "I will show the confirmation card first, then execute.",
              "先に確認カードを表示し、確認後に実行します。",
              "먼저 확인 카드를 띄우고 확인 후 실행할게요.",
            ),
            "agent",
          );
          return;
        }
      }
      if (command === "switch_lane") {
        const backup = optionFromPlan("backup");
        if (!backup) {
          addMessage(
            pickText(
              "当前没有可切换的备选方案，你可以补充条件后重算。",
              "No backup is available yet. Add constraints and I will replan.",
              "切替可能な代替案がありません。条件追加で再計画できます。",
              "전환 가능한 대안이 없습니다. 조건을 추가하면 재계획합니다.",
            ),
            "agent",
          );
          return;
        }
        state.agentConversation.pendingOptionKey = "backup";
        setAgentMode("confirming", { source: "voice_switch_backup" });
        rerenderAgentFlowCards();
        addMessage(
          pickText(
            "已切到备选方案，确认后继续执行。",
            "Switched to backup. Confirm to continue execution.",
            "代替案へ切替えました。確認後に実行を続けます。",
            "대안으로 전환했습니다. 확인하면 계속 실행합니다.",
          ),
          "agent",
        );
        return;
      }
      if (command === "retry" && currentMode === "failed") {
        await runAgentExecution("main", false);
        return;
      }
      if (command === "cancel" && currentMode === "confirming") {
        setAgentMode("planning", { source: "voice_cancel_confirm" });
        rerenderAgentFlowCards();
        addMessage(
          pickText(
            "已取消本次确认，你可以改条件后再试。",
            "Confirmation canceled. You can edit constraints and retry.",
            "確認をキャンセルしました。条件修正後に再試行できます。",
            "확인을 취소했습니다. 조건 수정 후 다시 시도하세요.",
          ),
          "agent",
        );
        return;
      }
      if (command === "cancel" || command === "modify" || command === "new_task") {
        addMessage(
          pickText(
            "好的，请直接说新的目标，我会重新生成方案。",
            "Okay, speak your updated goal and I will regenerate options.",
            "了解しました。新しい目標を話してください。提案を再生成します。",
            "좋습니다. 새 목표를 말해주시면 옵션을 다시 생성하겠습니다.",
          ),
          "agent",
        );
        return;
      }
      const smart = state.agentConversation.smartReply;
      const options = smart && Array.isArray(smart.options) ? smart.options : [];
      if (command === "confirm" && smart && smart.crossXChoice) {
        const selected = options.find((item) => item.id === smart.crossXChoice.optionId) || options[0] || null;
        if (selected && selected.prompt) {
          await handleAgentConversationInput(selected.prompt);
          return;
        }
      }
      if (command === "switch_lane" && options[1] && options[1].prompt) {
        await handleAgentConversationInput(options[1].prompt);
        return;
      }
      if (el.chatInput) el.chatInput.value = "";
      updateChatSendState();
      await handleAgentConversationInput(transcript);
      return;
    }
    const pendingTaskId = state.voice.pendingTaskId;
    if (pendingTaskId) {
      if (command === "confirm") {
        const execution = await confirmAndExecute(pendingTaskId, {
          skipModal: true,
          autoConsent: true,
          skipSecondFactor: true,
          source: "voice",
        });
        if (execution && execution.ok) {
          state.voice.pendingTaskId = null;
          addMessage(
            pickText(
              "执行完成。你可以继续说下一个目标。",
              "Execution completed. You can speak the next goal.",
              "実行が完了しました。次の目標を話せます。",
              "실행이 완료되었습니다. 다음 목표를 말할 수 있습니다.",
            ),
            "agent",
          );
        }
        return;
      }
      if (command === "cancel") {
        const data = await api(`/api/tasks/${pendingTaskId}/cancel`, { method: "POST" });
        if (data && data.task) {
          state.currentTask = data.task;
          renderAgentBrain(state.currentTask);
        }
        await trackEvent("task_canceled_by_voice", {}, pendingTaskId);
        state.voice.pendingTaskId = null;
        setLoopProgress("support");
        addMessage(
          pickText(
            "已取消当前任务。你可以继续说一个新目标。",
            "Current task canceled. You can speak a new goal now.",
            "現在のタスクをキャンセルしました。新しい目標を話してください。",
            "현재 작업이 취소되었습니다. 새 목표를 말해주세요.",
          ),
          "agent",
        );
        return;
      }
      if (command === "handoff") {
        const data = await api(`/api/tasks/${pendingTaskId}/handoff`, {
          method: "POST",
          body: JSON.stringify({ reason: "voice_requested_handoff" }),
        });
        if (data && data.task) {
          state.currentTask = data.task;
          renderAgentBrain(state.currentTask);
        }
        await trackEvent("handoff_requested_by_voice", { ticketId: data.handoff.ticketId }, pendingTaskId);
        state.voice.pendingTaskId = null;
        setLoopProgress("support");
        addMessage(
          pickText(
            `已转人工处理，工单 ${data.handoff.ticketId}。`,
            `Human handoff created, ticket ${data.handoff.ticketId}.`,
            `有人対応に切替しました。チケット ${data.handoff.ticketId}。`,
            `사람 상담으로 전환되었습니다. 티켓 ${data.handoff.ticketId}.`,
          ),
          "agent",
        );
        await openSupportRoomByTicket(data.handoff.ticketId, null, { reason: "voice_handoff_open_live" }).catch(() => {});
        return;
      }
      if (command === "switch_lane") {
        const current = await api(`/api/tasks/${pendingTaskId}`);
        openReplanDrawer(current.task || null);
        addMessage(
          pickText(
            "已打开路线切换面板，请说\u201c确认执行\u201d继续或手动调整后保存。",
            'Lane switch panel opened. Say "confirm execute" to continue after adjustment.',
            "ルート切替パネルを開きました。調整後に「実行を確認」と話してください。",
            '경로 전환 패널을 열었습니다. 조정 후 "실행 확인"이라고 말해주세요.',
          ),
          "agent",
        );
        return;
      }
      if (command === "retry") {
        const execution = await confirmAndExecute(pendingTaskId, {
          skipModal: true,
          autoConsent: true,
          skipSecondFactor: true,
          source: "voice_retry",
        });
        if (execution && execution.ok) {
          state.voice.pendingTaskId = null;
        }
        return;
      }
      if (command === "modify") {
        state.voice.pendingTaskId = null;
        addMessage(
          pickText(
            "请直接说新的要求，我会重新规划。",
            "Please say the updated requirement. I will replan.",
            "変更後の要望を話してください。再計画します。",
            "변경할 요구를 말해주세요. 다시 계획하겠습니다.",
          ),
          "agent",
        );
        return;
      }
      if (command === "new_task") {
        state.voice.pendingTaskId = null;
      }
    }
    if (el.chatInput) el.chatInput.value = "";
    updateChatSendState();
    await createTaskFromText(transcript);
    if (state.voice.conversationMode && state.currentTask && state.currentTask.id) {
      state.voice.pendingTaskId = state.currentTask.id;
      addMessage(getVoiceConfirmHint(), "agent");
    }
  } catch (err) {
    notify(
      pickText(
        `语音任务处理失败：${err.message}`,
        `Voice task failed: ${err.message}`,
        `音声タスク処理に失敗: ${err.message}`,
        `음성 작업 처리 실패: ${err.message}`,
      ),
      "error",
    );
  } finally {
    state.voice.processing = false;
    scheduleVoiceRestart();
  }
}

async function toggleVoiceListening() {
  if (!state.voice.supported || !state.voice.recognition) {
    notify(pickText("当前浏览器不支持语音输入。", "Voice input is not supported in this browser.", "このブラウザは音声入力に対応していません。", "현재 브라우저는 음성 입력을 지원하지 않습니다."), "warning");
    return;
  }
  if (state.voice.conversationMode && state.voice.speaking) {
    const interrupted = interruptAssistantSpeech("tap_barge_in");
    if (interrupted) {
      state.voice.processing = false;
      const started = startVoiceRecognitionNow();
      if (started) {
        notify(
          pickText(
            "已打断播报，继续聆听中。",
            "Playback interrupted. Listening again.",
            "読み上げを中断し、再度聞き取りを開始しました。",
            "음성 출력을 중단하고 다시 듣기 시작했습니다.",
          ),
          "info",
        );
        scheduleVoiceRestart(180);
      }
      renderVoiceControls();
      return;
    }
  }
  state.voice.conversationMode = !state.voice.conversationMode;
  clearVoiceRestartTimer();
  if (state.voice.conversationMode) {
    state.voice.replyEnabled = isSpeechSynthesisSupported() || isAudioPlaybackSupported();
    const micReady = await ensureMicrophoneReady();
    if (!micReady) {
      state.voice.conversationMode = false;
      renderVoiceControls();
      return;
    }
    const started = startVoiceRecognitionNow();
    if (!started) {
      state.voice.conversationMode = false;
      renderVoiceControls();
      return;
    }
    notify(
      pickText(
        "对讲模式已开启，直接说你的需求。",
        "Intercom mode is on. Speak your request.",
        "インターコムモードを有効化しました。要望を話してください。",
        "인터컴 모드를 켰습니다. 요청을 말해주세요.",
      ),
      "success",
    );
    scheduleVoiceRestart(260);
  } else {
    stopVoiceConversation(false);
  }
  renderVoiceControls();
}

function buildWelcomeIntro(locationLabel) {
  // locationLabel: e.g. "广东省深圳市\u201d or null
  const loc = locationLabel ? String(locationLabel).trim() : "";
  if (state.uiLanguage === "ZH") {
    return loc
      ? `欢迎来到${loc}！我是 Cross X，你的跨境出行管家。告诉我一句话目标，我会为你定制方案并推进执行。`
      : "你好，我是 Cross X。告诉我一句话目标，我会给你定制化方案并推进执行。";
  }
  if (state.uiLanguage === "JA") {
    return loc
      ? `${loc}へようこそ！Cross Xです。ひと言で目的を伝えてください。最適な案を作成し実行まで進めます。`
      : "こんにちは、Cross Xです。ひと言で目的を伝えてください。最適な案を作成し実行まで進めます。";
  }
  if (state.uiLanguage === "KO") {
    return loc
      ? `${loc}에 오신 것을 환영합니다! Cross X입니다. 한 문장으로 목표를 말하면 맞춤 옵션을 만들고 실행까지 진행합니다.`
      : "안녕하세요, Cross X입니다. 한 문장으로 목표를 말하면 맞춤 옵션을 만들고 실행까지 진행합니다.";
  }
  // Default EN
  const locEn = state._locationLabelEn || loc;
  return locEn
    ? `Welcome to ${locEn}! I'm Cross X, your cross-border travel assistant. Tell me your goal and I'll build a tailored plan.`
    : "Hi, I am Cross X. Tell me one goal and I will generate tailored options and move execution forward.";
}

function getSystemMessageByKey(key) {
  if (key === "welcome_intro") {
    return buildWelcomeIntro(state._locationLabelZh || null);
  }
  return "";
}

function updateWelcomeBubbleWithLocation(data) {
  // data: { city, cityZh, province, provinceZh }
  const isChina = data.province && data.province !== data.city;
  state._locationLabelZh = isChina ? `${data.provinceZh}${data.cityZh}` : (data.cityZh || data.city);
  state._locationLabelEn = isChina ? `${data.city}, ${data.province}` : (data.city || "");
  // Update welcome bubble in chat feed
  if (!el.chatFeed) return;
  const rows = [...el.chatFeed.querySelectorAll(".msg.agent")];
  if (!rows.length) return;
  const first = rows[0];
  if (first.dataset.i18nKey !== "welcome_intro") return;
  const bubble = first.querySelector(".bubble");
  if (!bubble) return;
  bubble.textContent = buildWelcomeIntro(state._locationLabelZh);
}

async function silentAutoDetectLocation() {
  if (!navigator.geolocation) return;
  try {
    const position = await new Promise((resolve, reject) => {
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: false,
        timeout: 8000,
        maximumAge: 300000,
      });
    });
    const coords = position.coords || {};
    const data = await api("/api/user/location", {
      method: "POST",
      body: JSON.stringify({
        lat: Number(coords.latitude),
        lng: Number(coords.longitude),
        accuracy: Number(coords.accuracy || 0),
        source: "browser_geolocation_auto",
      }),
    });
    if (data && data.city) {
      if (el.locationTag) el.locationTag.textContent = `${data.cityZh || data.city} · GPS`;
      state.selectedConstraints.city = data.city;
      state.selectedConstraints.origin = "current_location";
      syncChipSelectionFromConstraints();
      updateContextSummary();
      renderQuickGoals();
      updateWelcomeBubbleWithLocation(data);
    }
  } catch {
    // Silent failure — location permission denied or unavailable, keep default welcome
  }
}

function normalizeWelcomeMessageRow() {
  if (!el.chatFeed) return;
  const rows = [...el.chatFeed.querySelectorAll(".msg.agent")];
  if (!rows.length) return;
  const first = rows[0];
  const bubble = first.querySelector(".bubble");
  if (!bubble) return;
  const text = String(bubble.textContent || "");
  const welcomePattern = /Cross\s*X|一句话目标|one goal|ひと言で目的|한 문장으로 목표|闭环|closed loop|実行|실행|欢迎来到|Welcome to/i;
  if (first.dataset.i18nKey !== "welcome_intro" && !welcomePattern.test(text)) return;
  first.dataset.i18nKey = "welcome_intro";
  const localized = getSystemMessageByKey("welcome_intro");
  if (localized) bubble.textContent = localized;
}

function localizeStatus(status) {
  const lang = state.uiLanguage;
  const map = {
    ZH: {
      idle: "待命",
      parsing: "理解中",
      asking: "追问中",
      planning: "规划中",
      confirming: "待确认",
      executing: "执行中",
      replanning: "重规划中",
      created: "已创建",
      draft: "草稿",
      active: "进行中",
      queued: "排队中",
      running: "执行中",
      in_progress: "处理中",
      success: "成功",
      failed: "失败",
      skipped: "跳过",
      fallback_to_human: "转人工",
      paused: "已暂停",
      confirmed: "已确认",
      completed: "已完成",
      canceled: "已取消",
      open: "待处理",
      resolved: "已解决",
      processing: "处理中",
      refunding: "退款中",
      refunded: "已退款",
    },
    JA: {
      idle: "待機",
      parsing: "解析中",
      asking: "確認中",
      planning: "計画中",
      confirming: "確認待ち",
      executing: "実行中",
      replanning: "再計画中",
      created: "作成済み",
      draft: "下書き",
      active: "進行中",
      queued: "待機",
      running: "実行中",
      in_progress: "処理中",
      success: "成功",
      failed: "失敗",
      skipped: "スキップ",
      fallback_to_human: "有人対応へ",
      paused: "一時停止",
      confirmed: "確認済み",
      completed: "完了",
      canceled: "キャンセル済み",
      open: "オープン",
      resolved: "解決済み",
      processing: "処理中",
      refunding: "返金中",
      refunded: "返金済み",
    },
    KO: {
      idle: "대기",
      parsing: "해석 중",
      asking: "질문 중",
      planning: "계획 중",
      confirming: "확인 대기",
      executing: "실행 중",
      replanning: "재계획 중",
      created: "생성됨",
      draft: "초안",
      active: "진행중",
      queued: "대기",
      running: "실행중",
      in_progress: "처리중",
      success: "성공",
      failed: "실패",
      skipped: "건너뜀",
      fallback_to_human: "사람 상담",
      paused: "일시중지",
      confirmed: "확인됨",
      completed: "완료",
      canceled: "취소됨",
      open: "열림",
      resolved: "해결됨",
      processing: "처리중",
      refunding: "환불중",
      refunded: "환불됨",
    },
    EN: {
      idle: "idle",
      parsing: "parsing",
      asking: "asking",
      planning: "planning",
      confirming: "confirming",
      executing: "executing",
      replanning: "replanning",
      created: "created",
      draft: "draft",
      active: "active",
      queued: "queued",
      running: "running",
      in_progress: "in_progress",
      success: "success",
      failed: "failed",
      skipped: "skipped",
      fallback_to_human: "fallback_to_human",
      paused: "paused",
      confirmed: "confirmed",
      completed: "completed",
      canceled: "canceled",
      open: "open",
      resolved: "resolved",
      processing: "processing",
      refunding: "refunding",
      refunded: "refunded",
    },
  };
  const langMap = map[lang] || map.EN;
  return langMap[status] || status;
}

function localizeLlmIssue(reason) {
  const key = String(reason || "").trim();
  if (!key) return pickText("无", "none", "なし", "없음");
  if (key.startsWith("invalid_key_format")) {
    return pickText(
      "API Key 格式无效（需 sk- 或 sk-proj- 开头，且不要带引号/空格）",
      "API key format is invalid (must start with sk- or sk-proj-, without extra quotes/spaces).",
      "APIキー形式が不正です（sk- / sk-proj- で始まり、余分な引用符や空白なし）。",
      "API 키 형식이 올바르지 않습니다 (sk- 또는 sk-proj- 시작, 따옴표/공백 제거).",
    );
  }
  if (key.startsWith("openai_http_401")) return pickText("鉴权失败（401），请检查 Key 是否正确。", "Auth failed (401). Check your key.", "認証失敗 (401)。キーを確認してください。", "인증 실패(401). 키를 확인하세요.");
  if (key.startsWith("openai_http_429")) return pickText("触发限流（429），请稍后重试。", "Rate limited (429). Retry later.", "レート制限 (429)。後で再試行してください。", "요청 제한(429). 잠시 후 다시 시도하세요.");
  if (key.startsWith("openai_timeout")) return pickText("请求超时，请稍后重试。", "Request timed out. Try again.", "タイムアウトしました。再試行してください。", "요청 시간이 초과되었습니다. 다시 시도하세요.");
  if (key === "missing_api_key") return pickText("未配置 API Key。", "API key is not configured.", "APIキーが未設定です。", "API 키가 설정되지 않았습니다.");
  return key;
}

function renderLlmRuntimeStatus(llmData) {
  if (!el.llmStatusText || !el.llmLastErrorText) return;
  const data = llmData && typeof llmData === "object" ? llmData : {};
  const keyHealth = data.keyHealth && typeof data.keyHealth === "object" ? data.keyHealth : {};
  const runtime = data.lastRuntime && typeof data.lastRuntime === "object" ? data.lastRuntime : {};
  const configured = data.configured === true;
  const valid = keyHealth.looksValid === true;
  const statusLine = configured
    ? `${pickText("连接状态", "Connection", "接続状態", "연결 상태")}: ${pickText("已配置", "configured", "設定済み", "설정됨")} · ${pickText("格式校验", "format check", "形式チェック", "형식 검사")} ${valid ? pickText("通过", "ok", "OK", "통과") : pickText("失败", "failed", "失敗", "실패")}`
    : `${pickText("连接状态", "Connection", "接続状態", "연결 상태")}: ${pickText("未配置", "not configured", "未設定", "미설정")}`;
  const preview = data.keyPreview ? ` · key ${String(data.keyPreview)}` : "";
  const model = data.model ? ` · model ${String(data.model)}` : "";
  el.llmStatusText.textContent = `${statusLine}${model}${preview}`;

  const lastError = runtime.lastError || keyHealth.reason || "";
  if (!lastError || lastError === "ok") {
    el.llmLastErrorText.textContent = pickText("最近诊断：无错误。", "Last diagnose: no error.", "最近の診断: エラーなし。", "최근 진단: 오류 없음.");
    return;
  }
  const when = runtime.errorAt ? ` · ${new Date(runtime.errorAt).toLocaleString()}` : "";
  el.llmLastErrorText.textContent = `${pickText("最近诊断", "Last diagnose", "最近の診断", "최근 진단")}: ${localizeLlmIssue(lastError)}${when}`;
}

function statusGlyph(status) {
  switch (status) {
    case "queued":
      return "○";
    case "running":
      return "◉";
    case "success":
      return "✓";
    case "failed":
      return "!";
    case "skipped":
      return "↷";
    case "fallback_to_human":
      return "H";
    default:
      return "•";
  }
}

function getStepFailureReason(step) {
  if (!step) return "-";
  if (step.failureReason) return String(step.failureReason);
  if (step.outputPreview && String(step.outputPreview).trim()) return String(step.outputPreview);
  if (step.outputSummary && String(step.outputSummary).trim()) return String(step.outputSummary);
  return pickText("上游接口超时或库存变更", "Upstream timeout or inventory changed", "上流APIのタイムアウトまたは在庫変動", "상위 API 지연 또는 재고 변경");
}

function getConsentItems(confirm) {
  const flags = Array.isArray(confirm && confirm.riskFlags) ? confirm.riskFlags : [];
  const list = [];
  const asText = flags.join(" ").toLowerCase();
  if (flags.some((f) => String(f).toLowerCase().includes("cost")) || asText.includes("费用")) {
    list.push({
      key: "cost",
      label:
        state.uiLanguage === "ZH"
          ? "我知晓本次会产生费用"
          : state.uiLanguage === "JA"
            ? "今回の料金発生を理解しました"
            : "I understand this task has a charge",
      required: true,
    });
  }
  if (flags.some((f) => String(f).toLowerCase().includes("location")) || asText.includes("定位")) {
    list.push({
      key: "location",
      label:
        state.uiLanguage === "ZH"
          ? "允许本次任务使用定位（仅任务内）"
          : state.uiLanguage === "JA"
            ? "このタスク中のみ位置情報共有を許可"
            : "Allow location sharing for this task only",
      required: true,
    });
  }
  if (flags.some((f) => String(f).toLowerCase().includes("no-pin")) || asText.includes("免密")) {
    list.push({
      key: "nopin",
      label:
        state.uiLanguage === "ZH"
          ? "允许在限额内使用免密代付"
          : state.uiLanguage === "JA"
            ? "上限内でNo-PIN委任支払いを許可"
            : "Allow delegated no-PIN payment within limits",
      required: true,
    });
  }
  return list;
}

function syncChipSelectionFromConstraints() {
  for (const chip of el.chips || []) {
    const key = chip.dataset.k;
    const value = chip.dataset.v;
    if (!key) continue;
    const active = String(state.selectedConstraints[key] || "") === String(value || "");
    chip.classList.toggle("selected", active);
  }
}

function inferConstraintsFromIntent(text) {
  const raw = String(text || "");
  const lower = raw.toLowerCase();
  const inferred = {};

  const budgetMatch = raw.match(/(\d{2,5})\s*(元|rmb|cny|¥)/i);
  if (budgetMatch) {
    const amount = Number(budgetMatch[1]);
    if (!Number.isNaN(amount)) {
      if (amount <= 80) inferred.budget = "low";
      else if (amount <= 180) inferred.budget = "mid";
      else inferred.budget = "high";
    }
  } else if (/cheap|economy|省钱|便宜|低预算/.test(lower)) {
    inferred.budget = "low";
  } else if (/premium|luxury|高预算|高端/.test(lower)) {
    inferred.budget = "high";
  }

  if (/walk|步行|附近|nearby/.test(lower)) inferred.distance = "walk";
  if (/ride|taxi|car|打车|网约车/.test(lower)) inferred.distance = "ride";
  if (/asap|urgent|赶|尽快|马上|before\s*\d|airport|机场/.test(lower)) inferred.time = "soon";
  if (/flexible|不急|随意|any time/.test(lower)) inferred.time = "flexible";
  if (/halal|清真/.test(lower)) inferred.dietary = "halal";
  if (/vegan|纯素/.test(lower)) inferred.dietary = "vegan";
  if (/vegetarian|素食/.test(lower)) inferred.dietary = inferred.dietary || "vegetarian";
  if (/family|亲子|孩子|儿童/.test(lower)) inferred.family = "true";
  if (/wheelchair|accessible|无障碍/.test(lower)) inferred.accessibility = "yes";
  if (/pvg|浦东/.test(lower)) inferred.destination = "PVG";
  if (/(sha|虹桥)/.test(lower)) inferred.destination = "SHA";
  if (/airport|机场/.test(lower) && !inferred.destination) inferred.destination = "Airport";

  const cityMap = [
    { key: /shanghai|上海/i, value: "Shanghai" },
    { key: /shenzhen|深圳/i, value: "Shenzhen" },
    { key: /beijing|北京/i, value: "Beijing" },
    { key: /guangzhou|广州/i, value: "Guangzhou" },
    { key: /hangzhou|杭州/i, value: "Hangzhou" },
    { key: /chengdu|成都/i, value: "Chengdu" },
  ];
  for (const item of cityMap) {
    if (item.key.test(raw)) {
      inferred.city = item.value;
      break;
    }
  }
  return inferred;
}

function summarizeConstraints(constraints) {
  const entries = Object.entries(constraints || {}).filter(([, value]) => value !== "" && value !== null && value !== undefined);
  return entries.map(([key, value]) => `${key}:${value}`).join(" · ");
}

function getCurrentCity() {
  const fromState = String(state.selectedConstraints && state.selectedConstraints.city ? state.selectedConstraints.city : "").trim();
  if (fromState) return fromState;
  const tagText = String((el.locationTag && el.locationTag.textContent) || "").trim();
  if (tagText) {
    const parsed = tagText.split("·")[0].trim();
    if (parsed) return parsed;
  }
  return "Shanghai";
}

function buildRecommendationPath(taskId = null) {
  const params = new URLSearchParams();
  if (taskId) params.set("taskId", String(taskId));
  params.set("language", state.uiLanguage || "EN");
  if (!taskId) {
    params.set("city", getCurrentCity());
    const keys = ["budget", "distance", "time", "dietary", "family", "accessibility"];
    for (const key of keys) {
      const value = state.selectedConstraints && state.selectedConstraints[key];
      if (value !== undefined && value !== null && String(value).trim() !== "") {
        params.set(key, String(value));
      }
    }
  }
  return `/api/solution/recommendation?${params.toString()}`;
}

function buildNearbyPath() {
  const params = new URLSearchParams();
  params.set("language", state.uiLanguage || "EN");
  params.set("city", getCurrentCity());
  return `/api/nearby/suggestions?${params.toString()}`;
}

function localizeRiskValue(value, fallbackCode = "") {
  const raw = String(value || "").trim();
  const code = String(fallbackCode || "").toLowerCase();
  if (!raw && !code) return "-";
  const lower = raw.toLowerCase();
  if (state.uiLanguage === "ZH") {
    if (code.includes("queue") || lower.includes("queue")) return "排队波动";
    if (code.includes("traffic") || lower.includes("traffic")) return "拥堵波动";
    if (code.includes("deposit") || lower.includes("deposit")) return "高峰需定金";
    if (code.includes("transfer") || lower.includes("transfer")) return "换乘复杂";
  } else if (state.uiLanguage === "JA") {
    if (code.includes("queue") || lower.includes("queue")) return "待ち時間変動";
    if (code.includes("traffic") || lower.includes("traffic")) return "渋滞変動";
    if (code.includes("deposit") || lower.includes("deposit")) return "ピーク時デポジット";
    if (code.includes("transfer") || lower.includes("transfer")) return "乗換複雑";
  } else if (state.uiLanguage === "KO") {
    if (code.includes("queue") || lower.includes("queue")) return "대기 변동";
    if (code.includes("traffic") || lower.includes("traffic")) return "교통 변동";
    if (code.includes("deposit") || lower.includes("deposit")) return "피크 시간 보증금";
    if (code.includes("transfer") || lower.includes("transfer")) return "환승 복잡";
  }
  return raw || "-";
}

async function withButtonLoading(button, loadingText, action) {
  if (!button || typeof action !== "function") return action();
  const previous = button.textContent;
  const wasDisabled = button.disabled;
  button.disabled = true;
  button.classList.add("is-loading");
  if (loadingText) button.textContent = loadingText;
  try {
    return await action();
  } finally {
    button.disabled = wasDisabled;
    button.classList.remove("is-loading");
    button.textContent = previous;
  }
}

function renderPostTaskReview(task, result) {
  const timeline = Array.isArray(result && result.timeline) ? result.timeline : [];
  const order = result && result.order ? result.order : null;
  const startAt = timeline.length ? new Date(timeline[0].at).getTime() : Date.now();
  const endAt = timeline.length ? new Date(timeline[timeline.length - 1].at).getTime() : Date.now();
  const durationMin = Math.max(1, Math.round((endAt - startAt) / 60000));
  const stepSet = new Set((timeline || []).map((item) => item.stepId));
  const successCount = (timeline || []).filter((item) => item.status === "success").length;
  const successRate = stepSet.size ? Math.min(100, Math.round((successCount / stepSet.size) * 100)) : 100;
  const pref = summarizeConstraints(state.selectedConstraints);

  addCard(`
    <article class="card">
      <h3>${pickText("任务复盘", "Post-task review", "実行レビュー", "실행 리뷰")}</h3>
      <div>${pickText("总花费", "Total spend", "合計支出", "총 지출")}: <strong>${order ? `${Number(order.price || 0)} ${escapeHtml(order.currency || "CNY")}` : "-"}</strong></div>
      <div class="status">${pickText("总用时", "Duration", "所要時間", "소요 시간")}: ${durationMin} min · ${pickText("步骤成功率", "Step success", "ステップ成功率", "단계 성공률")}: ${successRate}%</div>
      <div class="status">${pickText("可复用偏好", "Reusable preferences", "再利用可能な設定", "재사용 가능한 선호")}: ${escapeHtml(pref || "-")}</div>
      <div class="actions">
        ${order ? `<button class="secondary" data-action="open-order-detail" data-order="${escapeHtml(order.id)}">${pickText("查看订单详情", "Open order detail", "注文詳細を開く", "주문 상세 열기")}</button>` : ""}
        <button class="secondary" data-action="reuse-last-preferences">${pickText("保存为默认偏好", "Save as default preferences", "既定設定として保存", "기본 선호로 저장")}</button>
      </div>
    </article>
  `);
}

function updateSupportEtaCountdown() {
  const items = [...document.querySelectorAll(".eta-live")];
  const now = Date.now();
  for (const node of items) {
    const createdAt = new Date(node.dataset.createdAt || now).getTime();
    const etaMin = Number(node.dataset.etaMin || 0);
    const elapsed = Math.max(0, Math.floor((now - createdAt) / 60000));
    const remain = Math.max(0, etaMin - elapsed);
    node.textContent = pickText(
      `预计 ${remain} 分钟`,
      `ETA ${remain} min`,
      `ETA ${remain} 分`,
      `ETA ${remain}분`,
    );
  }
}

function startSupportEtaTicker() {
  updateSupportEtaCountdown();
  if (state.supportEtaTicker) clearInterval(state.supportEtaTicker);
  state.supportEtaTicker = setInterval(updateSupportEtaCountdown, 15000);
}

function autoResizeChatInput() {
  if (!el.chatInput) return;
  if (!(el.chatInput instanceof HTMLTextAreaElement)) return;
  const maxHeight = state.singleDialogMode ? 190 : 150;
  el.chatInput.style.height = "auto";
  const next = Math.min(maxHeight, Math.max(54, el.chatInput.scrollHeight));
  el.chatInput.style.height = `${next}px`;
}

function updateChatSendState() {
  if (!el.chatSendBtn || !el.chatInput) return;
  const value = String(el.chatInput.value || "").trim();
  el.chatSendBtn.disabled = value.length === 0;
}

function updateContextSummary() {
  if (!el.contextSummary) return;
  const entries = Object.entries(state.selectedConstraints || {});
  if (!entries.length) {
    el.contextSummary.textContent = pickText(
      "会根据你的话自动提取预算/距离/时间/口味/无障碍条件，可继续修改。",
      "I can auto-extract budget/distance/time/dietary/accessibility constraints. You can still edit them.",
      "予算/距離/時間/食事/アクセシビリティ条件を自動抽出します。後から編集できます。",
      "예산/거리/시간/식단/접근성 조건을 자동 추출하며 이후 수정할 수 있습니다.",
    );
    return;
  }
  el.contextSummary.textContent = entries.map(([k, v]) => `${k}: ${v}`).join(" · ");
}

function isLocalAgentChatEnabled() {
  return state.viewMode !== "admin";
}

function ensureAgentInputDeck() {
  if (!el.chatForm || document.getElementById("agentInputDeck")) return;
  const wrap = document.createElement("div");
  wrap.id = "agentInputDeck";
  wrap.className = "agent-input-deck";
  wrap.innerHTML = `
    <div id="agentSlotSummaryBar" class="agent-slot-summary"></div>
    <div id="agentQuickFillBar" class="agent-quick-fill"></div>
  `;
  el.chatForm.parentElement.insertBefore(wrap, el.chatForm);
}

function normalizeBudgetTier(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["low", "mid", "high"].includes(raw)) return raw;
  const amount = Number(raw.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount) || amount <= 0) return "";
  if (amount <= 120) return "low";
  if (amount <= 260) return "mid";
  return "high";
}

function mergePreferences(...lists) {
  const set = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const v = String(item || "").trim().toLowerCase();
      if (!v) continue;
      set.add(v);
    }
  }
  return [...set];
}

function stableHash32(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

function seededFloat(seed, key = "") {
  const value = stableHash32(`${seed || "seed"}|${key || ""}`);
  return (value % 10000) / 10000;
}

function seededPick(seed, key, list = []) {
  if (!Array.isArray(list) || !list.length) return null;
  const ratio = seededFloat(seed, key);
  const idx = Math.min(list.length - 1, Math.floor(ratio * list.length));
  return list[idx];
}

function normalizedSlotSignature(slots) {
  const safe = slots && typeof slots === "object" ? slots : {};
  const prefs = Array.isArray(safe.preferences) ? [...safe.preferences].sort() : [];
  return JSON.stringify({
    intent: safe.intent || "",
    city: safe.city || "",
    area: safe.area || "",
    budget: safe.budget || "",
    time_constraint: safe.time_constraint || "",
    party_size: safe.party_size || "",
    preferences: prefs,
  });
}

function createAgentSeedKey(scope = "default", slots = null) {
  const safeSlots = slots || state.agentConversation.slots || {};
  return `${state.agentConversation.sessionSeed || "seed"}|${scope}|${normalizedSlotSignature(safeSlots)}`;
}

function appendAgentTelemetry(event, payload = {}) {
  const logItem = {
    at: new Date().toISOString(),
    event: String(event || "event"),
    payload: payload && typeof payload === "object" ? payload : { value: payload },
  };
  if (!Array.isArray(state.agentConversation.telemetry)) state.agentConversation.telemetry = [];
  state.agentConversation.telemetry.unshift(logItem);
  if (state.agentConversation.telemetry.length > 180) {
    state.agentConversation.telemetry.length = 180;
  }
  if (typeof console !== "undefined" && console.debug) {
    console.debug("[agent.trace]", logItem.event, logItem.payload);
  }
}

function modeToLoopStage(mode) {
  const key = String(mode || "idle");
  if (["idle", "parsing", "asking"].includes(key)) return "intent";
  if (["planning", "replanning", "failed"].includes(key)) return "plan";
  if (key === "confirming") return "confirm";
  if (key === "executing") return "execute";
  if (key === "completed") return "proof";
  return "intent";
}

function setAgentMode(mode, payload = {}) {
  const next = String(mode || "idle");
  if (!AGENT_STATES.includes(next)) {
    appendAgentTelemetry("mode_rejected", { requested: next });
    return;
  }
  const prev = String(state.agentConversation.mode || "idle");
  state.agentConversation.mode = next;
  appendAgentTelemetry("mode_transition", {
    from: prev,
    to: next,
    ...payload,
  });
  setLoopProgress(modeToLoopStage(next));
}

function plannerOutputSchema() {
  return {
    intent: AGENT_INTENTS,
    slots: AGENT_SLOT_KEYS,
    missing_slots: AGENT_SLOT_KEYS.filter((key) => key !== "execution_permission"),
    plan: {
      type: ["simple", "combo"],
      main_option: "required",
      backup_option: "required",
      requires_confirmation: "boolean",
    },
  };
}

function normalizePlannerOutput(plan, fallbackSlots = null) {
  const safeSlots = fallbackSlots && typeof fallbackSlots === "object" ? fallbackSlots : {};
  const fallbackIntent = normalizeIntent(safeSlots.intent || "eat");
  const fallback = {
    type: fallbackIntent === "combo" ? "combo" : "simple",
    summary: pickText(
      "已生成可执行主备方案。",
      "Generated executable primary and backup options.",
      "実行可能な主案/代替案を生成しました。",
      "실행 가능한 주안/대안을 생성했습니다.",
    ),
    mainOption: {
      key: "main",
      intent: fallbackIntent,
      title: pickText("主方案", "Primary option", "主案", "주안"),
      place: "-",
      eta: 22,
      amount: budgetValueForPlan(safeSlots.budget),
      risk: pickText("待执行", "Pending execution", "実行待ち", "실행 대기"),
      reason: pickText("优先满足关键约束。", "Prioritized for key constraints.", "主要条件を優先。", "핵심 조건 우선."),
      requiresPayment: true,
      requiresPermission: true,
    },
    backupOption: {
      key: "backup",
      intent: fallbackIntent,
      title: pickText("备选方案", "Backup option", "代替案", "대안"),
      place: "-",
      eta: 25,
      amount: Math.max(40, Math.round(budgetValueForPlan(safeSlots.budget) * 0.92)),
      risk: pickText("待执行", "Pending execution", "実行待ち", "실행 대기"),
      reason: pickText("作为主方案异常时兜底。", "Fallback if primary fails.", "主案失敗時の代替。", "주안 실패 시 대체."),
      requiresPayment: true,
      requiresPermission: true,
    },
    steps: [],
    toolSnapshot: null,
  };
  const incoming = plan && typeof plan === "object" ? plan : {};
  const main = incoming.mainOption && typeof incoming.mainOption === "object" ? incoming.mainOption : fallback.mainOption;
  const backupRaw = incoming.backupOption && typeof incoming.backupOption === "object" ? incoming.backupOption : fallback.backupOption;
  const type = incoming.type === "combo" ? "combo" : "simple";
  const summary = String(incoming.summary || fallback.summary || "").trim();
  const steps = Array.isArray(incoming.steps) ? incoming.steps.filter(Boolean).slice(0, 6) : fallback.steps || [];
  const normalized = {
    type,
    summary,
    mainOption: {
      ...main,
      key: "main",
      intent: normalizeIntent(main.intent || safeSlots.intent || "eat"),
      requiresPayment: main.requiresPayment !== false,
      requiresPermission: main.requiresPermission !== false,
      requires_confirmation: main.requiresPayment !== false || Number(main.amount || 0) > 260,
    },
    backupOption: {
      ...backupRaw,
      key: "backup",
      isBackup: true,
      intent: normalizeIntent(backupRaw.intent || main.intent || safeSlots.intent || "eat"),
      requiresPayment: backupRaw.requiresPayment !== false,
      requiresPermission: backupRaw.requiresPermission !== false,
      requires_confirmation: backupRaw.requiresPayment !== false || Number(backupRaw.amount || 0) > 260,
    },
    steps,
    toolSnapshot: incoming.toolSnapshot || fallback.toolSnapshot || null,
  };
  return normalized;
}

function emptySlotEvidence(seed = null) {
  const keys = ["intent", "city", "area", "budget", "time_constraint", "party_size", "preferences", "execution_permission"];
  const next = {};
  for (const key of keys) {
    next[key] = seed && typeof seed === "object" ? seed[key] === true : false;
  }
  return next;
}

function mergeSlotEvidence(base = null, patch = null) {
  const next = emptySlotEvidence(base);
  if (!patch || typeof patch !== "object") return next;
  for (const key of Object.keys(next)) {
    if (patch[key] === true) next[key] = true;
  }
  return next;
}

function detectSlotEvidenceFromText(text) {
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();
  return {
    intent: /(eat|food|dinner|lunch|restaurant|trip|route|taxi|airport|hotel|stay|吃|餐|火锅|面|出行|打车|路线|机场|酒店|住宿)/.test(lower),
    city: /(shanghai|上海|beijing|北京|shenzhen|深圳|guangzhou|广州|hangzhou|杭州|chengdu|成都)/i.test(raw),
    area: /(jing.?an|静安|bund|外滩|pudong|浦东|xuhui|徐汇|nanshan|南山|futian|福田)/i.test(raw),
    budget: /(\d{2,5}\s*(元|rmb|cny|¥)?|mid|中等|中档|中预算|适中|预算中等|cheap|budget|省钱|便宜|低预算|premium|luxury|高预算|高端)/i.test(raw),
    time_constraint: /(\d{1,3}\s*(分钟|mins?|minutes?)|tonight|今晚|dinner|晚餐|asap|马上|尽快|立刻|before\s*\d{1,2}|前\s*\d{1,2})/i.test(raw),
    party_size: /(\d{1,2}\s*(个)?\s*(人|位|people|pax|persons?)|solo|single|一个人|1人|couple|两个人|2人|family|亲子|孩子|儿童)/i.test(raw),
    preferences: /(halal|清真|vegan|vegetarian|素食|spicy|辣|mild|清淡|walk|步行|no\s*queue|不排队|quiet|安静|family|亲子|儿童|kids)/i.test(raw),
    execution_permission: /(代下单|代支付|帮我订|帮我下单|book for me|pay for me|go ahead|直接执行)/i.test(lower),
  };
}

function markAgentSlotEvidence(slotKey, explicit = true) {
  const key = String(slotKey || "").trim();
  if (!key) return;
  const evidence = emptySlotEvidence(state.agentConversation.slotEvidence);
  if (Object.prototype.hasOwnProperty.call(evidence, key)) {
    evidence[key] = explicit === true;
  }
  state.agentConversation.slotEvidence = evidence;
}

function markAgentPreferenceEvidence() {
  markAgentSlotEvidence("preferences", true);
}

function markAgentEvidenceFromConstraint(key, value, enabled = true) {
  if (enabled !== true) return;
  const constraint = String(key || "").trim().toLowerCase();
  if (!constraint) return;
  if (constraint === "budget") {
    markAgentSlotEvidence("budget", true);
    return;
  }
  if (constraint === "time") {
    markAgentSlotEvidence("time_constraint", true);
    return;
  }
  if (constraint === "city") {
    markAgentSlotEvidence("city", true);
    return;
  }
  if (["dietary", "family", "distance", "accessibility"].includes(constraint)) {
    markAgentPreferenceEvidence();
    if (constraint === "distance" && String(value || "").toLowerCase() === "walk") {
      markAgentSlotEvidence("time_constraint", true);
    }
  }
}

function syncAgentSlotsFromSelectedConstraints() {
  const slots = normalizeAgentSlotsInPlace(state.agentConversation.slots || {});
  const c = state.selectedConstraints || {};
  if (!slots.city && c.city && !isUnknownSlotValue(c.city)) slots.city = String(c.city);
  if (!slots.budget && c.budget && !isUnknownSlotValue(c.budget)) slots.budget = String(c.budget);
  if (!slots.time_constraint && c.time && !isUnknownSlotValue(c.time)) slots.time_constraint = String(c.time);
  if (!slots.execution_permission) slots.execution_permission = false;
  const prefs = [];
  if (String(c.distance || "").toLowerCase() === "walk") prefs.push("walk_first");
  if (String(c.family || "").toLowerCase() === "true") prefs.push("family_friendly");
  if (String(c.dietary || "").toLowerCase() === "halal") prefs.push("halal");
  if (String(c.dietary || "").toLowerCase() === "vegan") prefs.push("vegetarian");
  if (String(c.time || "").toLowerCase() === "soon") prefs.push("asap");
  slots.preferences = mergePreferences(slots.preferences, prefs);
  state.agentConversation.slots = slots;
}

function syncSelectedConstraintsFromAgentSlots() {
  const slots = normalizeAgentSlotsInPlace(state.agentConversation.slots || {});
  const next = { ...(state.selectedConstraints || {}) };

  // Recompute agent-controlled keys from slots, so removing chips actually clears constraints.
  delete next.city;
  delete next.budget;
  delete next.time;
  delete next.distance;
  delete next.dietary;
  delete next.family;

  if (slots.city) next.city = slots.city;
  const budgetTier = normalizeBudgetTier(slots.budget);
  if (budgetTier) next.budget = budgetTier;
  if (slots.time_constraint) {
    const raw = String(slots.time_constraint).toLowerCase();
    next.time = /asap|soon|内|before|今晚|tonight/.test(raw) ? "soon" : "normal";
  }
  const prefs = Array.isArray(slots.preferences) ? slots.preferences : [];
  if (prefs.includes("walk_first")) next.distance = "walk";
  if (prefs.includes("halal")) next.dietary = "halal";
  if (prefs.includes("vegetarian")) next.dietary = next.dietary || "vegan";
  if (prefs.includes("family_friendly")) next.family = "true";

  state.selectedConstraints = next;
}

function agentIntentFromText(text, fallback = null) {
  const lower = String(text || "").toLowerCase();
  const eat = /(eat|food|dinner|lunch|restaurant|hotpot|noodle|coffee|tea|吃|餐|火锅|面|奶茶|清真|素食)/.test(lower);
  const trip = /(trip|taxi|route|airport|flight|metro|station|出行|打车|路线|机场|高铁)/.test(lower);
  const hotel = /(hotel|check[\s-]?in|stay|accommodation|酒店|住宿|住)/.test(lower);
  if (hotel && trip) return "combo_hotel_travel";
  if (eat && trip) return "combo_eat_travel";
  if (eat && hotel) return "combo_hotel_travel";
  if (eat) return "eat";
  if (trip) return "travel";
  if (hotel) return "hotel";
  return fallback || "unknown";
}

function isGreetingInput(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  const normalized = raw.toLowerCase().replace(/[!！?？.,，。;；:：\s]+/g, "");
  return /^(hi|hello|hey|yo|sup|你好|嗨|哈喽|在吗|在嘛|helloagain)$/.test(normalized);
}

function hasTaskIntentSignal(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  return /(eat|food|dinner|lunch|restaurant|trip|route|taxi|airport|hotel|stay|住宿|酒店|吃|餐|火锅|打车|出行|路线|机场|预订|booking)/i.test(raw);
}

function shouldUseFreeformAssistantReply(text) {
  const raw = String(text || "").trim();
  if (!raw) return false;
  if (isGreetingInput(raw)) return true;
  const shortInput = raw.replace(/\s+/g, "").length <= 14;
  if (shortInput && !hasTaskIntentSignal(raw)) return true;
  if (/^(thanks|thankyou|thx|你好啊|谢谢|在吗|你是谁|你能做什么)$/i.test(raw.replace(/\s+/g, "").toLowerCase())) return true;
  return false;
}

async function requestFreeformAssistantReply(text) {
  try {
    return await api("/api/chat/freeform", {
      method: "POST",
      body: JSON.stringify({
        message: String(text || ""),
        language: state.uiLanguage,
        city: getCurrentCity(),
        constraints: state.selectedConstraints || {},
      }),
    });
  } catch {
    return null;
  }
}

function isUnknownSlotValue(value) {
  const raw = String(value == null ? "" : value).trim().toLowerCase();
  return raw === "" || raw === "unknown" || raw === "null" || raw === "undefined";
}

function normalizeAgentSlotsInPlace(slotsLike) {
  const slots = slotsLike && typeof slotsLike === "object" ? slotsLike : {};
  const textKeys = ["intent", "city", "area", "budget", "time_constraint", "party_size"];
  for (const key of textKeys) {
    if (isUnknownSlotValue(slots[key])) {
      slots[key] = null;
    } else if (typeof slots[key] === "string") {
      slots[key] = slots[key].trim();
    }
  }
  if (!Array.isArray(slots.preferences)) slots.preferences = [];
  slots.preferences = slots.preferences
    .map((item) => String(item || "").trim())
    .filter((item) => item && !isUnknownSlotValue(item));
  slots.execution_permission = slots.execution_permission === true;
  return slots;
}

function extractSlotsFromText(text, existingSlots = null) {
  const normalizeSeed = (value) => (isUnknownSlotValue(value) ? null : value);
  const slots = {
    intent: existingSlots && existingSlots.intent ? normalizeSeed(existingSlots.intent) : null,
    city: existingSlots && existingSlots.city ? normalizeSeed(existingSlots.city) : null,
    area: existingSlots && existingSlots.area ? normalizeSeed(existingSlots.area) : null,
    budget: existingSlots && existingSlots.budget ? normalizeSeed(existingSlots.budget) : null,
    time_constraint: existingSlots && existingSlots.time_constraint ? normalizeSeed(existingSlots.time_constraint) : null,
    party_size: existingSlots && existingSlots.party_size ? normalizeSeed(existingSlots.party_size) : null,
    preferences: mergePreferences(existingSlots && existingSlots.preferences ? existingSlots.preferences : []),
    execution_permission: existingSlots && existingSlots.execution_permission === true,
  };
  const raw = String(text || "").trim();
  const lower = raw.toLowerCase();

  slots.intent = agentIntentFromText(lower, slots.intent);

  const cityRules = [
    { re: /shanghai|上海/i, v: "Shanghai" },
    { re: /beijing|北京/i, v: "Beijing" },
    { re: /shenzhen|深圳/i, v: "Shenzhen" },
    { re: /guangzhou|广州/i, v: "Guangzhou" },
    { re: /hangzhou|杭州/i, v: "Hangzhou" },
    { re: /chengdu|成都/i, v: "Chengdu" },
  ];
  for (const rule of cityRules) {
    if (rule.re.test(raw)) {
      slots.city = rule.v;
      break;
    }
  }

  const areaRules = [
    { re: /jing.?an|静安/i, v: "Jing'an" },
    { re: /bund|外滩/i, v: "Bund" },
    { re: /pudong|浦东/i, v: "Pudong" },
    { re: /xuhui|徐汇/i, v: "Xuhui" },
    { re: /nanshan|南山/i, v: "Nanshan" },
    { re: /futian|福田/i, v: "Futian" },
  ];
  for (const rule of areaRules) {
    if (rule.re.test(raw)) {
      slots.area = rule.v;
      break;
    }
  }

  const budgetAmount = raw.match(/(\d{2,5})\s*(元|rmb|cny|¥)?/i);
  if (budgetAmount && budgetAmount[1]) {
    slots.budget = String(Number(budgetAmount[1]));
  } else if (/mid|中等|中档|中预算|适中|预算中等/.test(lower)) {
    slots.budget = "mid";
  } else if (/cheap|budget|省钱|便宜|低预算/.test(lower)) {
    slots.budget = "low";
  } else if (/premium|luxury|高预算|高端/.test(lower)) {
    slots.budget = "high";
  }

  const party = raw.match(/(\d{1,2})\s*(个)?\s*(人|位|people|pax|persons?)/i);
  if (party && party[1]) {
    slots.party_size = String(Math.max(1, Number(party[1])));
  } else if (/solo|一个人|1人|single/.test(lower)) {
    slots.party_size = "1";
  } else if (/couple|两个人|2人/.test(lower)) {
    slots.party_size = "2";
  } else if (/family|亲子|孩子|儿童/.test(lower)) {
    slots.party_size = slots.party_size || "3";
  }

  const minMatch = raw.match(/(\d{1,3})\s*(分钟|mins?|minutes?)/i);
  if (minMatch && minMatch[1]) {
    slots.time_constraint = `${Number(minMatch[1])}${pickText("分钟内", "min", "分以内", "분 이내")}`;
  } else if (/tonight|今晚|dinner|晚餐/.test(lower)) {
    slots.time_constraint = pickText("今晚", "tonight", "今夜", "오늘 저녁");
  } else if (/asap|马上|尽快|立刻/.test(lower)) {
    slots.time_constraint = "ASAP";
  } else {
    const before = raw.match(/(?:before|前)\s*(\d{1,2})(?::(\d{2}))?/i);
    if (before && before[1]) {
      const h = String(before[1]).padStart(2, "0");
      const m = before[2] ? String(before[2]).padStart(2, "0") : "00";
      slots.time_constraint = `${h}:${m} ${pickText("前", "before", "まで", "이전")}`;
    }
  }

  const prefMap = [
    { re: /halal|清真/i, v: "halal" },
    { re: /vegan|vegetarian|素食|纯素/i, v: "vegetarian" },
    { re: /spicy|辣/i, v: "spicy" },
    { re: /mild|清淡|不辣/i, v: "mild" },
    { re: /family|亲子|儿童|kids/i, v: "family_friendly" },
    { re: /walk|步行|walking/i, v: "walk_first" },
    { re: /no\s*queue|不要排队|不排队/i, v: "no_queue" },
    { re: /quiet|安静/i, v: "quiet" },
    { re: /asap|马上|尽快/i, v: "asap" },
  ];
  const extraPrefs = prefMap.filter((item) => item.re.test(raw)).map((item) => item.v);
  slots.preferences = mergePreferences(slots.preferences, extraPrefs);

  if (/代下单|代支付|帮我订|帮我下单|book for me|pay for me|go ahead|直接执行/.test(lower)) {
    slots.execution_permission = true;
  }
  if (/先别下单|不要支付|不付钱|don't book|don't pay/.test(lower)) {
    slots.execution_permission = false;
  }

  return slots;
}

function getCriticalSlots(intent) {
  const map = {
    eat: ["city", "budget", "party_size"],
    travel: ["city", "time_constraint"],
    trip: ["city", "time_constraint"],
    hotel: ["city", "budget", "time_constraint"],
    combo_eat_travel: ["city", "budget", "time_constraint", "party_size"],
    combo_hotel_travel: ["city", "budget", "time_constraint", "party_size"],
    combo: ["city", "budget", "time_constraint", "party_size"],
    unknown: ["intent"],
  };
  return map[intent] || map.eat;
}

function getMissingCriticalSlots(slots) {
  const critical = getCriticalSlots(slots.intent || "eat");
  return critical.filter((key) => {
    if (key === "preferences") return !Array.isArray(slots.preferences) || slots.preferences.length === 0;
    const value = slots[key];
    return value === null || value === undefined || String(value).trim() === "";
  });
}

function dedupeSlotList(list) {
  const out = [];
  const set = new Set();
  for (const item of list || []) {
    const key = String(item || "").trim();
    if (!key || set.has(key)) continue;
    set.add(key);
    out.push(key);
  }
  return out;
}

function getClarificationMissingSlots(slots, evidence = null) {
  const safeSlots = slots && typeof slots === "object" ? slots : {};
  const ev = emptySlotEvidence(evidence);
  const intent = normalizeIntent(safeSlots.intent || "eat");
  const missing = [...getMissingCriticalSlots(safeSlots)];

  if (intent === "unknown" || !safeSlots.intent) {
    return dedupeSlotList(["intent"]);
  }

  // Ask-first policy: do not generate plans before collecting explicit user constraints.
  if (intent === "eat") {
    const hasExplicitBudget = ev.budget && !!safeSlots.budget;
    const hasExplicitParty = ev.party_size && !!safeSlots.party_size;
    if (!hasExplicitBudget && !hasExplicitParty) {
      missing.push("budget", "party_size");
    }
  } else if (intent === "trip") {
    if (!ev.time_constraint && !safeSlots.time_constraint) missing.push("time_constraint");
  } else if (intent === "hotel") {
    if (!ev.budget && !safeSlots.budget) missing.push("budget");
    if (!ev.time_constraint && !safeSlots.time_constraint) missing.push("time_constraint");
  } else if (intent === "combo") {
    if (!ev.budget && !safeSlots.budget) missing.push("budget");
    if (!ev.time_constraint && !safeSlots.time_constraint) missing.push("time_constraint");
    if (!ev.party_size && !safeSlots.party_size) missing.push("party_size");
  }
  return dedupeSlotList(missing);
}

function prioritizeMissingSlots(missingSlots, intent = "eat") {
  const list = dedupeSlotList(missingSlots || []);
  const key = normalizeIntent(intent || "eat");
  const priorityMap = {
    eat: ["budget", "party_size", "city", "area", "time_constraint"],
    trip: ["city", "time_constraint", "budget", "area", "party_size"],
    hotel: ["city", "time_constraint", "budget", "party_size", "area"],
    combo: ["city", "time_constraint", "budget", "party_size", "area"],
    unknown: ["intent", "city", "budget", "party_size", "time_constraint", "area"],
  };
  const priority = priorityMap[key] || priorityMap.eat;
  return list
    .slice()
    .sort((a, b) => {
      const ai = priority.indexOf(a);
      const bi = priority.indexOf(b);
      const av = ai >= 0 ? ai : 999;
      const bv = bi >= 0 ? bi : 999;
      if (av !== bv) return av - bv;
      return String(a).localeCompare(String(b));
    });
}

function slotSummaryLine(slots) {
  const safe = slots && typeof slots === "object" ? slots : {};
  const parts = [];
  if (!isUnknownSlotValue(safe.city)) parts.push(String(safe.city));
  if (!isUnknownSlotValue(safe.area)) parts.push(String(safe.area));
  if (!isUnknownSlotValue(safe.party_size)) parts.push(`${safe.party_size}${pickText("人", " pax", "名", "인")}`);
  if (!isUnknownSlotValue(safe.budget)) parts.push(`${pickText("预算", "budget", "予算", "예산")} ${safe.budget}`);
  if (!isUnknownSlotValue(safe.time_constraint)) parts.push(String(safe.time_constraint));
  if (!isUnknownSlotValue(safe.intent) && String(safe.intent).toLowerCase() !== "unknown") parts.push(String(safe.intent));
  const prefs = Array.isArray(safe.preferences) ? safe.preferences.slice(0, 2) : [];
  for (const pref of prefs) parts.push(pref);
  return parts.join(" / ");
}

function askingLeadMessage(slots, askSlots) {
  const known = slotSummaryLine(slots);
  const labels = (askSlots || []).map((slot) => slotLabelForAgent(slot));
  if (labels.length <= 1) {
    const label = labels[0] || pickText("关键条件", "a key constraint", "主要条件", "핵심 조건");
    return pickText(
      `我先按当前信息处理${known ? `（${known}）` : ""}。还差 ${label}，补一下我就能给你主备方案。`,
      `I can proceed with what I have${known ? ` (${known})` : ""}. I still need ${label} before generating primary and backup options.`,
      `現在の情報${known ? `（${known}）` : ""}で進めます。主案と代替案を出す前に ${label} を補ってください。`,
      `현재 정보${known ? ` (${known})` : ""}로 진행할게요. 주안/대안을 만들기 전에 ${label} 이(가) 필요합니다.`,
    );
  }
  return pickText(
    `我先按当前信息处理${known ? `（${known}）` : ""}。还差两项：${labels.join("、")}。`,
    `I can proceed with current context${known ? ` (${known})` : ""}. I still need two details: ${labels.join(" / ")}.`,
    `現在の情報${known ? `（${known}）` : ""}で進めます。あと2点必要です: ${labels.join(" / ")}。`,
    `현재 정보${known ? ` (${known})` : ""}로 진행할게요. 추가로 두 가지가 필요합니다: ${labels.join(" / ")}.`,
  );
}

function planningLeadMessage(slots) {
  const summary = slotSummaryLine(slots);
  if (!summary) {
    return pickText(
      "我先按默认约束筛一轮，优先给你可落地的主备方案。",
      "I will run a first pass with default constraints and prioritize executable primary/backup options.",
      "既定条件で一次選定し、実行可能な主案/代替案を優先します。",
      "기본 제약으로 1차 선별하고 실행 가능한 주안/대안을 우선 제공합니다.",
    );
  }
  return pickText(
    `我先按【${summary}】筛一轮，优先可执行、排队短、预算内。`,
    `I will filter by [${summary}] first, prioritizing executable options, shorter queues, and budget fit.`,
    `【${summary}】で一次選定し、実行性・待機短縮・予算適合を優先します。`,
    `[${summary}] 기준으로 1차 선별하고 실행 가능성, 짧은 대기, 예산 적합을 우선합니다.`,
  );
}

function slotLabelForAgent(slotKey) {
  const map = {
    intent: pickText("任务类型", "Task type", "タスク種別", "작업 유형"),
    city: pickText("城市", "City", "都市", "도시"),
    area: pickText("区域", "Area", "エリア", "지역"),
    budget: pickText("预算", "Budget", "予算", "예산"),
    time_constraint: pickText("时间限制", "Time", "時間制約", "시간 제한"),
    party_size: pickText("人数", "Party size", "人数", "인원"),
    preferences: pickText("偏好", "Preferences", "好み", "선호"),
    execution_permission: pickText("执行授权", "Execution permission", "実行許可", "실행 권한"),
  };
  return map[String(slotKey || "")] || slotKey;
}

function agentQuickChoicesForSlot(slotKey) {
  const slot = String(slotKey || "");
  if (slot === "intent") {
    return [
      { value: "eat", label: pickText("吃饭", "Eat", "食事", "식사") },
      { value: "trip", label: pickText("出行", "Travel", "移動", "이동") },
      { value: "hotel", label: pickText("酒店", "Hotel", "ホテル", "호텔") },
      { value: "combo", label: pickText("组合任务", "Combo", "複合タスク", "복합 작업") },
    ];
  }
  if (slot === "budget") {
    return [
      { value: "low", label: pickText("100内", "Low", "低予算", "저예산") },
      { value: "mid", label: pickText("100-250", "Mid", "中予算", "중예산") },
      { value: "high", label: pickText("250+", "High", "高予算", "고예산") },
    ];
  }
  if (slot === "party_size") {
    return [
      { value: "1", label: pickText("1人", "1 person", "1人", "1인") },
      { value: "2", label: pickText("2人", "2 people", "2人", "2인") },
      { value: "4", label: pickText("4人", "4 people", "4人", "4인") },
    ];
  }
  if (slot === "city") {
    return [
      { value: "Shanghai", label: pickText("上海", "Shanghai", "上海", "상하이") },
      { value: "Beijing", label: pickText("北京", "Beijing", "北京", "베이징") },
      { value: "Shenzhen", label: pickText("深圳", "Shenzhen", "深圳", "선전") },
    ];
  }
  if (slot === "time_constraint") {
    return [
      { value: "ASAP", label: "ASAP" },
      { value: pickText("今晚", "tonight", "今夜", "오늘 저녁"), label: pickText("今晚", "Tonight", "今夜", "오늘 밤") },
      { value: "20:00 before", label: pickText("20:00前", "Before 20:00", "20:00まで", "20:00 이전") },
    ];
  }
  return [];
}

function renderAgentInputDeck() {
  if (state.viewMode !== "admin" && state.singleDialogMode) {
    const deck = document.getElementById("agentInputDeck");
    if (deck) deck.classList.add("section-hidden");
    return;
  }
  ensureAgentInputDeck();
  const summary = document.getElementById("agentSlotSummaryBar");
  const quick = document.getElementById("agentQuickFillBar");
  const slots = state.agentConversation.slots || {};
  const chips = [];
  if (!isUnknownSlotValue(slots.city)) chips.push({ key: "city", val: slots.city });
  if (!isUnknownSlotValue(slots.area)) chips.push({ key: "area", val: slots.area });
  if (!isUnknownSlotValue(slots.party_size)) chips.push({ key: "party_size", val: `${slots.party_size}${pickText("人", "pax", "名", "인")}` });
  if (!isUnknownSlotValue(slots.budget)) chips.push({ key: "budget", val: slots.budget });
  if (!isUnknownSlotValue(slots.time_constraint)) chips.push({ key: "time_constraint", val: slots.time_constraint });
  if (slots.intent && String(slots.intent).toLowerCase() !== "unknown") chips.push({ key: "intent", val: slots.intent });
  for (const pref of Array.isArray(slots.preferences) ? slots.preferences.slice(0, 3) : []) {
    chips.push({ key: "preferences", val: pref });
  }

  if (summary) {
    if (!chips.length) {
      summary.innerHTML = `<span class="status">${pickText("当前理解：等待你输入需求。", "Current understanding: waiting for your request.", "現在の理解: 入力待ちです。", "현재 이해: 요청 입력을 기다리는 중입니다.")}</span>`;
    } else {
      summary.innerHTML = chips
        .map((item) => {
          if (item.key === "preferences") {
            return `<button type="button" class="agent-slot-chip is-removable" data-action="agent-remove-pref" data-value="${escapeHtml(item.val)}">[${escapeHtml(item.val)}] ×</button>`;
          }
          return `<button type="button" class="agent-slot-chip is-removable" data-action="agent-remove-slot" data-slot="${escapeHtml(item.key)}">[${escapeHtml(slotLabelForAgent(item.key))}: ${escapeHtml(item.val)}] ×</button>`;
        })
        .join("");
    }
  }

  if (quick) {
    const quickDefs = [
      { slot: "budget", value: "low", label: pickText("Budget Low", "Budget Low", "低予算", "저예산") },
      { slot: "budget", value: "mid", label: pickText("Budget Mid", "Budget Mid", "中予算", "중예산") },
      { slot: "budget", value: "high", label: pickText("Budget High", "Budget High", "高予算", "고예산") },
      { pref: "walk_first", label: pickText("步行优先", "Walk first", "徒歩優先", "도보 우선") },
      { pref: "no_queue", label: pickText("不排队", "No queue", "待ち短め", "대기 없음") },
      { pref: "family_friendly", label: pickText("家庭友好", "Family", "ファミリー", "가족 친화") },
      { pref: "halal", label: pickText("清真", "Halal", "ハラール", "할랄") },
      { slot: "time_constraint", value: "ASAP", label: "ASAP" },
    ];
    quick.innerHTML = quickDefs
      .map((item) => {
        const active = item.slot
          ? String(slots[item.slot] || "") === String(item.value || "")
          : Array.isArray(slots.preferences) && slots.preferences.includes(String(item.pref || ""));
        return `<button type="button" class="agent-quick-chip ${active ? "selected" : ""}" data-action="agent-quick-fill" data-slot="${escapeHtml(item.slot || "")}" data-pref="${escapeHtml(item.pref || "")}" data-value="${escapeHtml(item.value || "")}">${escapeHtml(item.label)}</button>`;
      })
      .join("");
  }
}

function agentCatalogByCity(cityName) {
  const city = String(cityName || "Shanghai");
  const common = {
    eat: [
      { name: "A Niang Noodles (阿娘面馆)", eta: 18, price: 92, risk: pickText("排队波动", "Queue fluctuation", "待ち変動", "대기 변동"), tags: ["local", "noodle"] },
      { name: "Yershari Xinjiang (耶里夏丽)", eta: 24, price: 138, risk: pickText("高峰满座", "Peak full seats", "ピーク満席", "피크 만석"), tags: ["halal"] },
      { name: "Haidilao (海底捞)", eta: 28, price: 198, risk: pickText("高峰等待", "Peak waiting", "ピーク待機", "피크 대기"), tags: ["hotpot", "family"] },
    ],
    trip: [
      { name: "Ride-hailing Fast Lane", eta: 36, price: 158, risk: pickText("拥堵波动", "Traffic volatility", "渋滞変動", "교통 변동"), tags: ["fast"] },
      { name: "Metro + Short Ride", eta: 52, price: 72, risk: pickText("换乘复杂", "Transfer complexity", "乗換複雑", "환승 복잡"), tags: ["cheap"] },
    ],
    hotel: [
      { name: "Pudong Shangri-La (浦东香格里拉)", eta: 20, price: 980, risk: pickText("房态波动", "Inventory volatility", "在庫変動", "재고 변동"), tags: ["premium"] },
      { name: "Yitel Plus (和颐至尚)", eta: 18, price: 420, risk: pickText("可订房量有限", "Limited room count", "客室数に限り", "객실 수 제한"), tags: ["value"] },
    ],
  };
  if (/beijing/i.test(city)) {
    return {
      eat: [
        { name: "Siji Minfu (四季民福烤鸭)", eta: 20, price: 220, risk: pickText("周末排队", "Weekend queue", "週末待機", "주말 대기"), tags: ["duck"] },
        { name: "Jubaoyuan Halal (聚宝源)", eta: 25, price: 168, risk: pickText("晚高峰等待", "Evening waiting", "夜ピーク待機", "저녁 피크 대기"), tags: ["halal"] },
      ],
      trip: common.trip,
      hotel: common.hotel,
    };
  }
  if (/shenzhen/i.test(city)) {
    return {
      eat: [
        { name: "Baheli Hotpot (八合里牛肉火锅)", eta: 16, price: 188, risk: pickText("排队波动", "Queue fluctuation", "待ち変動", "대기 변동"), tags: ["hotpot"] },
        { name: "Muwu BBQ (木屋烧烤)", eta: 14, price: 128, risk: pickText("晚间拥挤", "Evening crowd", "夜間混雑", "야간 혼잡"), tags: ["bbq"] },
      ],
      trip: common.trip,
      hotel: common.hotel,
    };
  }
  return common;
}

function budgetValueForPlan(budget) {
  const raw = String(budget || "").trim().toLowerCase();
  if (!raw) return 200;
  if (["low", "mid", "high"].includes(raw)) {
    return raw === "low" ? 100 : raw === "mid" ? 220 : 420;
  }
  const amount = Number(raw.replace(/[^\d.]/g, ""));
  return Number.isFinite(amount) && amount > 0 ? amount : 200;
}

function budgetLevelFromValue(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (raw === "low" || raw === "mid" || raw === "high") return raw;
  const amount = budgetValueForPlan(raw);
  if (amount <= 120) return "low";
  if (amount <= 280) return "mid";
  return "high";
}

function parsePartySize(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 2;
  return Math.min(10, Math.max(1, Math.round(num)));
}

function timePressureLevel(timeConstraint) {
  const text = String(timeConstraint || "").toLowerCase();
  if (!text) return "normal";
  if (/asap|马上|尽快|立刻/.test(text)) return "high";
  if (/今晚|tonight|before|前|\d{1,2}:\d{2}/.test(text)) return "medium";
  return "normal";
}

function intentCatalogRows(intent, catalog) {
  const key = String(intent || "eat");
  if (key === "travel" || key === "trip") return [...(catalog.trip || [])];
  if (key === "hotel") return [...(catalog.hotel || [])];
  if (key === "combo" || key === "combo_eat_travel" || key === "combo_hotel_travel") {
    return [...(catalog.eat || []), ...(catalog.trip || []), ...(catalog.hotel || [])];
  }
  return [...(catalog.eat || [])];
}

function normalizeIntent(intent) {
  const raw = String(intent || "").toLowerCase();
  if (raw === "travel") return "trip";
  if (raw === "combo_eat_travel" || raw === "combo_hotel_travel") return "combo";
  return raw || "eat";
}

function buildCandidateFromCatalogRow(row, idx, slots, seedKey, intent) {
  const party = parsePartySize(slots.party_size);
  const pressure = timePressureLevel(slots.time_constraint);
  const prefs = Array.isArray(slots.preferences) ? slots.preferences : [];
  const demandFactor = pressure === "high" ? 1.16 : pressure === "medium" ? 1.08 : 1;
  const variation = 0.88 + seededFloat(seedKey, `${row.name}|price|${idx}`) * 0.42;
  const queueBias = pressure === "high" ? 9 : pressure === "medium" ? 5 : 2;
  const queueBase = Math.max(4, Math.round((intent === "hotel" ? 6 : intent === "trip" ? 8 : 11) + seededFloat(seedKey, `${row.name}|queue|${idx}`) * 36 + queueBias));
  const distanceMin = Math.max(4, Math.round(4 + seededFloat(seedKey, `${row.name}|distance|${idx}`) * 20));
  const etaMin = Math.max(8, Math.round((Number(row.eta || 18) + distanceMin * 0.7) * (prefs.includes("walk_first") ? 1.08 : 0.97)));
  const inventoryRoll = seededFloat(seedKey, `${row.name}|inventory|${idx}`);
  const available = inventoryRoll > (intent === "hotel" ? 0.18 : 0.1);
  const unitPrice = Math.max(38, Math.round(Number(row.price || 120) * variation * demandFactor));
  const estimatedTotal =
    intent === "eat"
      ? Math.round(unitPrice * Math.max(1, party * 0.72))
      : intent === "hotel"
        ? Math.round(unitPrice * Math.max(1, Math.ceil(party / 2)))
        : unitPrice;
  const rating = Number((3.6 + seededFloat(seedKey, `${row.name}|rating|${idx}`) * 1.3).toFixed(1));
  const queuePenalty = prefs.includes("no_queue") ? queueBase * 1.25 : queueBase;
  const score = Number((rating * 17 - queuePenalty * 0.65 - estimatedTotal * 0.05 - distanceMin * 0.2).toFixed(1));
  return {
    id: `cand_${stableHash32(`${seedKey}|${row.name}|${idx}`).toString(36)}`,
    title: row.name,
    place: row.name,
    tags: Array.isArray(row.tags) ? row.tags : [],
    kind: intent,
    eta: etaMin,
    queueMin: queueBase,
    distanceMin,
    amount: estimatedTotal,
    unitPrice,
    available,
    rating,
    score,
    risk: row.risk || pickText("实时状态波动", "Live status variability", "リアルタイム状態の変動", "실시간 상태 변동"),
    imagePath: "/assets/solution-flow.svg",
  };
}

function searchOptionsMock(slots, intent) {
  const normalizedIntent = normalizeIntent(intent || slots.intent || "eat");
  const city = slots.city || getCurrentCity();
  const catalog = agentCatalogByCity(city);
  const rows = intentCatalogRows(normalizedIntent, catalog);
  const seedKey = createAgentSeedKey("search_options_mock", { ...slots, intent: normalizedIntent });
  const candidates = rows
    .map((row, idx) => buildCandidateFromCatalogRow(row, idx, slots, seedKey, normalizedIntent))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
  const response = {
    ok: candidates.length > 0,
    tool: "search_options_mock",
    city,
    intent: normalizedIntent,
    candidates,
  };
  appendAgentTelemetry("tool.search_options_mock", {
    intent: normalizedIntent,
    city,
    candidateCount: candidates.length,
  });
  return response;
}

function checkConstraintsMock(slots, candidate, reasonTag = "default") {
  const budgetCap = budgetValueForPlan(slots.budget);
  const prefs = Array.isArray(slots.preferences) ? slots.preferences : [];
  const noQueue = prefs.includes("no_queue");
  const queueFlexible = prefs.includes("queue_flexible_after_fail");
  const pressure = timePressureLevel(slots.time_constraint);
  const queueLimitBase = pressure === "high" ? 16 : pressure === "medium" ? 24 : 30;
  const queueLimit = queueLimitBase + (queueFlexible ? 14 : 0);
  const result = {
    ok: true,
    code: "ok",
    reason: "",
    tool: "check_constraints_mock",
    budgetCap,
    queueLimit,
    estimatedAmount: Number(candidate && candidate.amount ? candidate.amount : 0),
    queueMin: Number(candidate && candidate.queueMin ? candidate.queueMin : 0),
    availability: candidate ? candidate.available === true : false,
  };
  if (!candidate || candidate.available !== true) {
    result.ok = false;
    result.code = "resource_unavailable";
    result.reason = pickText("资源当前不可用（订满/关闭/不可达）。", "Resource is currently unavailable (sold out/closed/unreachable).", "リソースが利用不可です（満室/休業/到達不可）。", "리소스를 현재 사용할 수 없습니다(매진/휴무/도달 불가).");
  } else if (result.estimatedAmount > budgetCap * 1.04) {
    result.ok = false;
    result.code = "budget_overflow";
    result.reason = pickText(
      `当前估算 ${result.estimatedAmount} 超过预算上限 ${budgetCap}。`,
      `Estimated ${result.estimatedAmount} exceeds budget cap ${budgetCap}.`,
      `見積 ${result.estimatedAmount} が予算上限 ${budgetCap} を超えています。`,
      `예상 비용 ${result.estimatedAmount}이(가) 예산 상한 ${budgetCap}을(를) 초과했습니다.`,
    );
  } else if (noQueue && result.queueMin > queueLimit) {
    result.ok = false;
    result.code = "queue_too_long";
    result.reason = pickText(
      `排队约 ${result.queueMin} 分钟，超过你的等待偏好。`,
      `Queue is about ${result.queueMin} minutes, beyond your waiting preference.`,
      `待ち時間が約 ${result.queueMin} 分で、希望範囲を超えています。`,
      `대기 시간이 약 ${result.queueMin}분으로 선호 범위를 초과합니다.`,
    );
  }
  appendAgentTelemetry("tool.check_constraints_mock", {
    tag: reasonTag,
    candidate: candidate ? candidate.id : null,
    code: result.code,
    ok: result.ok,
  });
  return result;
}

function reserveMock(slots, candidate, seedKey, optionKey = "main") {
  const available = candidate && candidate.available === true;
  const reserveRoll = seededFloat(seedKey, `${candidate ? candidate.id : "none"}|reserve`);
  const softFail = reserveRoll < (String(optionKey || "main") === "backup" ? 0.03 : 0.12);
  const ok = available && !softFail;
  const result = {
    ok,
    code: ok ? "ok" : "resource_unavailable",
    tool: "reserve_mock",
    reason: ok
      ? pickText("资源已锁定。", "Resource locked.", "リソースを確保しました。", "리소스를 잠금 처리했습니다.")
      : pickText("锁位失败，资源已被占用。", "Lock failed because the resource was taken.", "確保に失敗しました。リソースが埋まりました。", "잠금 실패: 리소스가 이미 점유되었습니다."),
  };
  appendAgentTelemetry("tool.reserve_mock", {
    candidate: candidate ? candidate.id : null,
    ok: result.ok,
    code: result.code,
  });
  return result;
}

function routeMock(slots, candidate, seedKey) {
  const traffic = Math.round(4 + seededFloat(seedKey, `${candidate ? candidate.id : "none"}|traffic`) * 18);
  const eta = Math.max(8, Math.round((candidate ? candidate.eta : 18) + traffic * 0.45));
  const cost = Math.max(10, Math.round((candidate ? candidate.distanceMin : 8) * 2 + seededFloat(seedKey, `${candidate ? candidate.id : "none"}|route_cost`) * 18));
  const result = {
    ok: true,
    tool: "route_mock",
    eta,
    traffic,
    costRange: `${Math.max(8, cost - 6)}-${cost + 10} CNY`,
    reason: pickText(
      `当前路况中等，预计 ${eta} 分钟可达。`,
      `Traffic is moderate. ETA is about ${eta} minutes.`,
      `現在の交通は中程度で、到着は約 ${eta} 分です。`,
      `현재 교통은 보통이며 ETA는 약 ${eta}분입니다.`,
    ),
  };
  appendAgentTelemetry("tool.route_mock", {
    candidate: candidate ? candidate.id : null,
    eta,
    traffic,
  });
  return result;
}

function proofGenerateMock(slots, option, runId, routeInfo) {
  const place = String(option && option.place ? option.place : "-");
  const amount = Number(option && option.amount ? option.amount : 0);
  const eta = Number(routeInfo && routeInfo.eta ? routeInfo.eta : option && option.eta ? option.eta : 0);
  const proofId = `proof_${stableHash32(`${runId}|${place}|${amount}`).toString(36)}`;
  const result = {
    ok: true,
    tool: "proof_generate_mock",
    proof: {
      proofId,
      type: "summary",
      title: pickText("执行摘要", "Execution summary", "実行サマリー", "실행 요약"),
      content: pickText(
        `已锁定 ${place}，预计 ${eta} 分钟可达，预计花费 ${amount} CNY。`,
        `${place} is locked. ETA ${eta} minutes, estimated spend ${amount} CNY.`,
        `${place} を確保しました。ETA ${eta} 分、想定費用 ${amount} CNY。`,
        `${place} 예약 잠금 완료. ETA ${eta}분, 예상 비용 ${amount} CNY.`,
      ),
      generatedAt: new Date().toISOString(),
    },
  };
  appendAgentTelemetry("tool.proof_generate_mock", {
    proofId,
    place,
    amount,
  });
  return result;
}

function buildReasonBundleFromCheck(checkResult, candidate, slots) {
  const reasons = [];
  const prefs = Array.isArray(slots.preferences) ? slots.preferences : [];
  reasons.push(
    pickText(
      `预算匹配度较高（估算 ${candidate.amount} / 上限 ${checkResult.budgetCap}）。`,
      `Budget fit is good (estimated ${candidate.amount} / cap ${checkResult.budgetCap}).`,
      `予算適合度が高いです（見積 ${candidate.amount} / 上限 ${checkResult.budgetCap}）。`,
      `예산 적합도가 높습니다 (예상 ${candidate.amount} / 상한 ${checkResult.budgetCap}).`,
    ),
  );
  if (prefs.includes("no_queue")) {
    reasons.push(
      pickText(
        `排队约 ${candidate.queueMin} 分钟，已按\u201c不排队\u201c偏好排序。`,
        `Queue is about ${candidate.queueMin} min and ranked for your no-queue preference.`,
        `待ち時間は約 ${candidate.queueMin} 分で「待たない」嗜好を優先しています。`,
        `대기 시간은 약 ${candidate.queueMin}분이며 "대기 최소" 선호를 반영했습니다.`,
      ),
    );
  } else {
    reasons.push(
      pickText(
        `综合评分 ${candidate.score}，到达时效 ${candidate.eta} 分钟。`,
        `Composite score ${candidate.score} with ETA ${candidate.eta} min.`,
        `総合スコア ${candidate.score}、到着時効 ${candidate.eta} 分。`,
        `종합 점수 ${candidate.score}, ETA ${candidate.eta}분.`,
      ),
    );
  }
  return reasons.slice(0, 3);
}

function candidateToPlanOption(candidate, key, intent, slots, checkResult) {
  const reasons = buildReasonBundleFromCheck(checkResult, candidate, slots);
  return {
    key,
    intent,
    title:
      key === "main"
        ? pickText("主方案", "Primary option", "主案", "주안")
        : pickText("备选方案", "Backup option", "代替案", "대안"),
    place: candidate.place,
    eta: candidate.eta,
    amount: candidate.amount,
    risk: candidate.risk,
    reason: reasons[0] || pickText("优先满足你的关键约束。", "Best fit for your key constraints.", "主要制約に最適化。", "핵심 제약에 최적화됨."),
    requiresPayment: true,
    requiresPermission: true,
    imagePath: candidate.imagePath || "/assets/solution-flow.svg",
    recommendationLevel: key === "main" ? pickText("推荐", "Recommended", "推奨", "추천") : pickText("备选", "Backup", "代替", "대안"),
    grade: key === "main" ? "A" : "B",
    placeDisplay: candidate.place,
    costRange: `${Math.max(28, Math.round(candidate.amount * 0.9))}-${Math.round(candidate.amount * 1.08)} CNY`,
    etaWindow: `${Math.max(8, candidate.eta - 6)}-${candidate.eta + 10} min`,
    openHours: pickText("营业中（模拟）", "Open now (mock)", "営業中 (mock)", "영업중 (mock)"),
    paymentFriendly: "Alipay / WeChat / Card",
    englishMenu: true,
    nextActions: [],
    reasons,
    comments: [
      pickText("数据来自 mock 工具链，执行阶段会二次校验。", "Data comes from mock toolchain with a second check during execution.", "データは mock ツールチェーン由来で、実行時に再検証します。", "데이터는 mock 툴체인 기반이며 실행 단계에서 재검증합니다."),
    ],
    executionPlan: [],
  };
}

function buildAgentPlanFromSlots() {
  const slots = state.agentConversation.slots || {};
  const intent = normalizeIntent(slots.intent || "eat");
  const search = searchOptionsMock(slots, intent);
  const candidates = Array.isArray(search.candidates) ? search.candidates : [];
  const checked = candidates.map((candidate, idx) => ({
    candidate,
    check: checkConstraintsMock(slots, candidate, `plan_${idx + 1}`),
  }));
  const feasible = checked.filter((item) => item.check.ok);
  const fallbackPool = checked.filter((item) => !item.check.ok);
  const mainEntry = feasible[0] || checked[0] || null;
  const backupEntry = feasible[1] || feasible[0] || checked[1] || fallbackPool[0] || checked[0] || null;

  const mainOption = mainEntry
    ? candidateToPlanOption(mainEntry.candidate, "main", intent, slots, mainEntry.check)
    : {
        key: "main",
        intent,
        title: pickText("主方案", "Primary option", "主案", "주안"),
        place: "-",
        eta: 20,
        amount: budgetValueForPlan(slots.budget),
        risk: pickText("暂无可执行资源", "No executable resource yet", "実行可能なリソースなし", "실행 가능한 리소스 없음"),
        reason: pickText("当前数据不足，请调整条件。", "Data is insufficient. Please adjust constraints.", "現在のデータが不足しています。条件を調整してください。", "현재 데이터가 부족합니다. 조건을 조정해 주세요."),
        requiresPayment: true,
        requiresPermission: true,
      };

  const backupOption = backupEntry
    ? {
        ...candidateToPlanOption(backupEntry.candidate, "backup", intent, slots, backupEntry.check),
        isBackup: true,
      }
    : {
        ...mainOption,
        key: "backup",
        isBackup: true,
        title: pickText("备选方案", "Backup option", "代替案", "대안"),
      };

  if (intent === "combo") {
    const comboSteps = [
      pickText("Step1 查询候选", "Step1 Query options", "Step1 候補検索", "Step1 후보 조회"),
      pickText("Step2 校验预算/排队/可用性", "Step2 Validate budget/queue/availability", "Step2 予算/待機/在庫を検証", "Step2 예산/대기/가용성 검증"),
      pickText("Step3 锁位与路线", "Step3 Lock reservation and route", "Step3 予約とルート確保", "Step3 예약/경로 잠금"),
      pickText("Step4 生成凭证摘要", "Step4 Generate proof summary", "Step4 証憑サマリー生成", "Step4 증빙 요약 생성"),
    ];
    return normalizePlannerOutput({
      type: "combo",
      summary: pickText(
        "这是组合任务。我会先给主备两条路线，再按确认执行。",
        "This is a combined task. I prepared primary and backup lanes for confirmation.",
        "複合タスクです。主案と代替案を提示して確認後に実行します。",
        "복합 작업입니다. 주안/대안을 제시하고 확인 후 실행합니다.",
      ),
      mainOption,
      backupOption,
      steps: comboSteps,
      toolSnapshot: { search, checked },
    }, slots);
  }

  return normalizePlannerOutput({
    type: "simple",
    summary: pickText(
      "我已按你的约束生成 1 个主方案 + 1 个备选方案。",
      "I generated 1 primary + 1 backup option based on your constraints.",
      "制約に基づき主案1つ + 代替案1つを生成しました。",
      "조건 기반으로 주안 1개 + 대안 1개를 생성했습니다.",
    ),
    mainOption,
    backupOption,
    steps: [],
    toolSnapshot: { search, checked },
  }, slots);
}

function agentConstraintsFromSlots(slots) {
  const next = {};
  if (!slots || typeof slots !== "object") return next;
  if (slots.city) next.city = slots.city;
  if (slots.area) next.area = slots.area;
  if (slots.budget) next.budget = String(slots.budget);
  if (slots.time_constraint) next.time = String(slots.time_constraint);
  if (slots.party_size) next.group_size = String(slots.party_size);
  const prefs = Array.isArray(slots.preferences) ? slots.preferences : [];
  if (prefs.includes("walk_first")) next.distance = "walk";
  if (prefs.includes("no_queue")) next.queue = "short";
  if (prefs.includes("family_friendly")) next.family = "true";
  if (prefs.includes("halal")) next.dietary = "halal";
  if (prefs.includes("vegetarian")) next.dietary = next.dietary || "vegan";
  if (prefs.includes("asap")) next.time = next.time || "soon";
  return next;
}

function composeAgentMessageFromSlots(slots, fallback = "") {
  const parts = [];
  const intent = slots && slots.intent ? slots.intent : "eat";
  if (intent === "combo") parts.push("eat + trip + hotel");
  else parts.push(intent);
  if (slots && slots.city) parts.push(`in ${slots.city}`);
  if (slots && slots.area) parts.push(`near ${slots.area}`);
  if (slots && slots.party_size) parts.push(`${slots.party_size} pax`);
  if (slots && slots.budget) parts.push(`budget ${slots.budget}`);
  if (slots && slots.time_constraint) parts.push(`time ${slots.time_constraint}`);
  const prefs = Array.isArray(slots && slots.preferences) ? slots.preferences : [];
  if (prefs.length) parts.push(`prefs ${prefs.join(",")}`);
  const base = parts.join(" | ");
  return base || String(fallback || "").trim() || "find executable local solution";
}

function parseEtaWindowMin(etaWindow, fallback = 24) {
  const text = String(etaWindow || "");
  if (!text) return fallback;
  const nums = (text.match(/\d{1,3}/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return fallback;
  if (nums.length === 1) return nums[0];
  return Math.round((Math.min(...nums) + Math.max(...nums)) / 2);
}

function parseCostRangeAmount(costRange, fallback = 128) {
  const text = String(costRange || "");
  if (!text) return fallback;
  const nums = (text.match(/\d{2,5}/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n) && n > 0);
  if (!nums.length) return fallback;
  if (nums.length === 1) return nums[0];
  return Math.round((Math.min(...nums) + Math.max(...nums)) / 2);
}

function buildPlanOptionFromSmart(item, key, fallbackIntent = "eat", fallbackOption = null) {
  const safe = item && typeof item === "object" ? item : {};
  const fallback = fallbackOption && typeof fallbackOption === "object" ? fallbackOption : {};
  const reasons = Array.isArray(safe.reasons) ? safe.reasons.filter(Boolean) : [];
  const comments = Array.isArray(safe.comments) ? safe.comments.filter(Boolean) : [];
  const nextActions = Array.isArray(safe.nextActions) ? safe.nextActions : [];
  const executionPlan = Array.isArray(safe.executionPlan) ? safe.executionPlan : [];
  const place =
    safe.placeDisplay ||
    safe.placeName ||
    safe.hotelDisplay ||
    safe.hotelName ||
    fallback.place ||
    safe.title ||
    "-";
  return {
    key: key || "main",
    intent: fallbackIntent,
    title: safe.title || fallback.title || place,
    place,
    eta: parseEtaWindowMin(safe.etaWindow, Number(fallback.eta || 24)),
    amount: parseCostRangeAmount(safe.costRange, Number(fallback.amount || 128)),
    risk:
      safe.recommendationLevel ||
      safe.grade ||
      reasons[1] ||
      comments[1] ||
      fallback.risk ||
      pickText("执行波动", "Execution variability", "実行変動", "실행 변동"),
    reason:
      reasons[0] ||
      comments[0] ||
      safe.thinking ||
      fallback.reason ||
      pickText("按可执行性与成功率优先筛选。", "Prioritized by executability and success rate.", "実行可能性と成功率を優先して選定。", "실행 가능성과 성공률을 우선해 선별했습니다."),
    requiresPayment: true,
    requiresPermission: true,
    imagePath: safe.imagePath || fallback.imagePath || "/assets/solution-flow.svg",
    recommendationLevel: safe.recommendationLevel || fallback.recommendationLevel || "",
    grade: safe.grade || fallback.grade || "",
    placeDisplay: safe.placeDisplay || "",
    costRange: safe.costRange || "",
    etaWindow: safe.etaWindow || "",
    openHours: safe.openHours || "",
    paymentFriendly: safe.paymentFriendly || "",
    englishMenu: safe.englishMenu === true,
    nextActions,
    reasons,
    comments,
    executionPlan,
    prompt: safe.prompt || "",
  };
}

function buildAgentPlanFromSmartReply(smartReply, fallbackPlan = null) {
  const smart = smartReply && typeof smartReply === "object" ? smartReply : null;
  const options = smart && Array.isArray(smart.options) ? smart.options.filter(Boolean) : [];
  if (!options.length) return fallbackPlan;
  const slots = state.agentConversation.slots || {};
  const fallback = fallbackPlan || buildAgentPlanFromSlots();
  const intent = slots.intent || (fallback.mainOption && fallback.mainOption.intent) || "eat";
  const main = buildPlanOptionFromSmart(options[0], "main", intent, fallback.mainOption || null);
  const backup = buildPlanOptionFromSmart(options[1] || options[0], "backup", intent, fallback.backupOption || fallback.mainOption || null);
  const stage = String(smart.conversationStage || "");
  const comboByStage = /mobility_selection|hotel_selection/i.test(stage) && /(eat|trip|hotel)/i.test(intent);
  const comboByIntent = intent === "combo";
  const type = comboByIntent || comboByStage ? "combo" : "simple";
  const stepLines = (main.executionPlan || [])
    .map((row) => {
      if (typeof row === "string") return row;
      if (row && typeof row === "object") return String(row.label || row.step || row.action || "").trim();
      return "";
    })
    .filter(Boolean)
    .slice(0, 5);
  const defaultSteps =
    fallback && Array.isArray(fallback.steps) && fallback.steps.length
      ? fallback.steps
      : [
          pickText("Step1 查询候选", "Step1 Query options", "Step1 候補検索", "Step1 후보 조회"),
          pickText("Step2 校验时效和价格", "Step2 Validate ETA and price", "Step2 ETAと価格を検証", "Step2 ETA/가격 검증"),
          pickText("Step3 锁位与执行", "Step3 Lock and execute", "Step3 ロックして実行", "Step3 잠금 및 실행"),
          pickText("Step4 交付凭证", "Step4 Deliver proof", "Step4 証憑を交付", "Step4 증빙 전달"),
        ];
  return normalizePlannerOutput({
    type,
    summary:
      (typeof smart.thinking === "string" && smart.thinking.trim()) ||
      (fallback && fallback.summary) ||
      pickText("已结合实时数据细化主备方案。", "Refined options with live data context.", "リアルタイム情報で主案/代替案を精緻化しました。", "실시간 데이터 맥락으로 주안/대안을 정교화했습니다."),
    mainOption: main,
    backupOption: { ...backup, isBackup: true },
    steps: type === "combo" ? (stepLines.length ? stepLines : defaultSteps) : [],
  }, slots);
}

function smartReplySnippet(smartReply) {
  const smart = smartReply && typeof smartReply === "object" ? smartReply : null;
  if (!smart) return "";
  const raw = String(smart.thinking || smart.reply || "").replace(/\n+/g, " ").replace(/\s+/g, " ").trim();
  if (!raw) return "";
  return raw.length > 220 ? `${raw.slice(0, 220).trim()}...` : raw;
}

function setTaskPanelVisibility(node, visible) {
  if (!node) return;
  node.classList.toggle("section-hidden", !visible);
}

function clearTaskPanels() {
  const nodes = [el.taskStatusMount, el.planCardsSection, el.confirmCardSection, el.executionStepsSection, el.executionResultSection];
  for (const node of nodes) {
    if (!node) continue;
    node.innerHTML = "";
    setTaskPanelVisibility(node, false);
  }
}

function renderTaskPanel(node, html, animate = true) {
  if (!node) return;
  node.innerHTML = html || "";
  setTaskPanelVisibility(node, Boolean(html));
  if (html && animate) {
    motion.enter(node, { duration: 170, fromY: 8 });
    motion.bindPressables(node);
  }
}

function openConditionEditorDrawer(trigger = null) {
  if (!el.conditionEditorDrawer) return;
  const slots = state.agentConversation.slots || {};
  if (el.conditionIntent) el.conditionIntent.value = normalizeIntent(slots.intent || "eat");
  if (el.conditionCity) el.conditionCity.value = String(slots.city || "");
  if (el.conditionArea) el.conditionArea.value = String(slots.area || "");
  if (el.conditionPartySize) el.conditionPartySize.value = String(slots.party_size || "");
  if (el.conditionBudget) el.conditionBudget.value = normalizeBudgetTier(slots.budget);
  if (el.conditionTimeConstraint) el.conditionTimeConstraint.value = String(slots.time_constraint || "");
  if (el.conditionPreferences) el.conditionPreferences.value = Array.isArray(slots.preferences) ? slots.preferences.join(",") : "";
  if (el.conditionExecutionPermission) el.conditionExecutionPermission.value = slots.execution_permission === true ? "true" : "false";
  if (taskComponents && taskComponents.ConditionEditorDrawer) {
    taskComponents.ConditionEditorDrawer.open(drawerController, el.conditionEditorDrawer, trigger);
    return;
  }
  if (drawerController) {
    drawerController.open(el.conditionEditorDrawer, { trigger });
  } else {
    el.conditionEditorDrawer.classList.remove("hidden");
    el.conditionEditorDrawer.setAttribute("aria-hidden", "false");
  }
}

function closeConditionEditorDrawer() {
  if (!el.conditionEditorDrawer) return;
  if (taskComponents && taskComponents.ConditionEditorDrawer) {
    taskComponents.ConditionEditorDrawer.close(drawerController, el.conditionEditorDrawer);
    return;
  }
  if (drawerController) {
    drawerController.close(el.conditionEditorDrawer);
  } else {
    el.conditionEditorDrawer.classList.add("hidden");
    el.conditionEditorDrawer.setAttribute("aria-hidden", "true");
  }
}

function renderAgentTaskStatusCard() {
  if (!shouldRenderAgentFlowCards()) return;
  const mode = String(state.agentConversation.mode || "idle");
  const slots = state.agentConversation.slots || {};
  const run = state.agentConversation.currentRun || null;
  const chips = [];
  if (!isUnknownSlotValue(slots.city)) chips.push(`[${slots.city}]`);
  if (!isUnknownSlotValue(slots.area)) chips.push(`[${slots.area}]`);
  if (!isUnknownSlotValue(slots.party_size)) chips.push(`[${slots.party_size}${pickText("人", " pax", "名", "인")}]`);
  if (!isUnknownSlotValue(slots.budget)) chips.push(`[${pickText("预算", "Budget", "予算", "예산")} ${slots.budget}]`);
  if (!isUnknownSlotValue(slots.time_constraint)) chips.push(`[${slots.time_constraint}]`);
  if (slots.intent && String(slots.intent).toLowerCase() !== "unknown") chips.push(`[${slots.intent}]`);
  const prefs = Array.isArray(slots.preferences) ? slots.preferences.slice(0, 3) : [];
  for (const pref of prefs) chips.push(`[${pref}]`);
  const currentStep = run && Array.isArray(run.steps) ? run.steps.find((step) => step.status === "running") || null : null;
  if (taskComponents && taskComponents.TaskStatusCard) {
    taskComponents.TaskStatusCard.render(el.taskStatusMount, {
      visible: true,
      title: pickText("任务状态卡", "Task status", "タスク状態", "작업 상태"),
      stateLabel: pickText("当前状态", "Current state", "現在の状態", "현재 상태"),
      stateClass: mode,
      stateText: localizeStatus(mode),
      summaryLabel: pickText("目标摘要", "Goal summary", "目標サマリー", "목표 요약"),
      chips,
      summaryFallback: pickText("等待输入", "Waiting input", "入力待ち", "입력 대기"),
      stepLabel: pickText("当前步骤", "Current step", "現在のステップ", "현재 단계"),
      currentStep: currentStep ? currentStep.label : pickText("尚未执行", "Not executing yet", "未実行", "아직 실행 전"),
      actions: {
        modify: pickText("修改条件", "Modify constraints", "条件を修正", "조건 수정"),
        switchBackup: pickText("换备选方案", "Switch backup", "代替案へ切替", "대안으로 전환"),
      },
    });
    motion.bindPressables(el.taskStatusMount);
    return;
  }
  renderTaskPanel(
    el.taskStatusMount,
    `
    <h3>${pickText("任务状态卡", "Task status", "タスク状態", "작업 상태")}</h3>
    <div class="status">${pickText("当前状态", "Current state", "現在の状態", "현재 상태")}: <span class="status-badge ${escapeHtml(mode)}">${escapeHtml(localizeStatus(mode))}</span></div>
    <div class="status">${pickText("目标摘要", "Goal summary", "目標サマリー", "목표 요약")}: ${chips.length ? chips.map((chip) => escapeHtml(chip)).join(" ") : escapeHtml(pickText("等待输入", "Waiting input", "入力待ち", "입력 대기"))}</div>
    <div class="status">${pickText("当前步骤", "Current step", "現在のステップ", "현재 단계")}: ${escapeHtml(currentStep ? currentStep.label : pickText("尚未执行", "Not executing yet", "未実行", "아직 실행 전"))}</div>
    <div class="actions">
      <button class="secondary" data-action="agent-open-condition-editor">${pickText("修改条件", "Modify constraints", "条件を修正", "조건 수정")}</button>
      <button class="secondary" data-action="agent-switch-backup">${pickText("换备选方案", "Switch backup", "代替案へ切替", "대안으로 전환")}</button>
    </div>
  `,
  );
}

function rerenderAgentFlowCards() {
  if (!shouldRenderAgentFlowCards()) {
    clearAgentFlowCards();
    return;
  }
  clearAgentFlowCards();
  const mode = String(state.agentConversation.mode || "idle");
  if (mode !== "idle" || state.agentConversation.lastUserInput) {
    renderAgentTaskStatusCard();
  }
  if (mode === "parsing") {
    renderTaskPanel(
      el.planCardsSection,
      `
      <h3>${pickText("正在理解需求", "Parsing your request", "リクエスト解析中", "요청 해석 중")}</h3>
      <div class="status">${pickText("我先提取意图和关键条件，随后给你主方案+备选。", "I am extracting intent and key constraints, then I will provide a primary and backup plan.", "意図と主要条件を抽出し、主案と代替案を提示します。", "의도와 핵심 조건을 추출한 뒤 주안과 대안을 제시합니다.")}</div>
    `,
    );
    return;
  }
  if (mode === "asking") {
    renderAgentAskingCard(
      getClarificationMissingSlots(
        state.agentConversation.slots || {},
        state.agentConversation.slotEvidence || emptySlotEvidence(),
      ),
      state.agentConversation.slots || {},
    );
    return;
  }
  if (mode === "planning") {
    renderAgentPlanningCard(state.agentConversation.currentPlan);
    return;
  }
  if (mode === "replanning") {
    renderTaskPanel(
      el.planCardsSection,
      `
      <h3>${pickText("自动重规划中", "Replanning automatically", "自動再計画中", "자동 재계획 중")}</h3>
      <div class="status">${pickText("主方案受阻，我正在根据失败原因切换备选方案。", "Primary option is blocked. I am switching to backup based on failure reason.", "主案が中断したため、失敗理由に応じて代替案へ再計画します。", "주안이 막혀 실패 원인 기반으로 대안 재계획을 진행합니다.")}</div>
    `,
    );
    return;
  }
  if (mode === "confirming") {
    renderAgentPlanningCard(state.agentConversation.currentPlan);
    renderAgentConfirmCard(state.agentConversation.pendingOptionKey || "main");
    return;
  }
  if (mode === "executing") {
    renderAgentExecutionCard(state.agentConversation.currentRun);
    return;
  }
  if (mode === "completed") {
    renderAgentExecutionCard(state.agentConversation.currentRun);
    if (state.agentConversation.currentRun && state.agentConversation.currentRun.result) {
      renderAgentResultCard(state.agentConversation.currentRun.result);
    }
    return;
  }
  if (mode === "failed") {
    renderAgentExecutionCard(state.agentConversation.currentRun);
    if (state.agentConversation.currentRun && state.agentConversation.currentRun.failure) {
      renderAgentFailureCard(state.agentConversation.currentRun.failure);
    }
    return;
  }
  if (mode === "idle") {
    renderTaskPanel(
      el.planCardsSection,
      `
      <h3>${pickText("告诉我你的目标", "Tell me your goal", "目標を教えてください", "목표를 말해 주세요")}</h3>
      <div class="status">${pickText("我会先判断是否信息足够：足够就给主方案+备选；不足只追问1-2个关键条件。", "I first check whether info is sufficient: if yes, I provide primary+backup; if not, I ask only 1-2 critical questions.", "まず情報の充足を判定します。十分なら主案+代替案、不足なら1-2項目だけ確認します。", "먼저 정보 충분성을 판단합니다. 충분하면 주안+대안, 부족하면 핵심 1-2개만 질문합니다.")}</div>
      <div class="actions">
        <button class="secondary" data-action="agent-slot-quick" data-slot="intent" data-value="eat">${pickText("吃饭", "Eat", "食事", "식사")}</button>
        <button class="secondary" data-action="agent-slot-quick" data-slot="intent" data-value="trip">${pickText("出行", "Travel", "移動", "이동")}</button>
        <button class="secondary" data-action="agent-slot-quick" data-slot="intent" data-value="hotel">${pickText("酒店", "Hotel", "ホテル", "호텔")}</button>
      </div>
    `,
    );
  }
}

async function refineAgentPlanWithSmartReply(inputText = "", options = {}) {
  const opts = options || {};
  const slots = state.agentConversation.slots || {};
  const missing = prioritizeMissingSlots(
    getClarificationMissingSlots(slots, state.agentConversation.slotEvidence || emptySlotEvidence()),
    slots.intent || "eat",
  );
  if (missing.length) return null;
  const message = composeAgentMessageFromSlots(slots, inputText || state.agentConversation.lastUserInput || "");
  const constraints = {
    ...agentConstraintsFromSlots(slots),
    ...(state.selectedConstraints || {}),
  };
  const signature = JSON.stringify({
    language: state.uiLanguage,
    intent: slots.intent || "",
    message,
    constraints,
  });
  if (!opts.force && signature === state.agentConversation.smartSignature && state.agentConversation.smartReply) {
    return state.agentConversation.smartReply;
  }
  const requestId = Number(state.agentConversation.smartRequestId || 0) + 1;
  state.agentConversation.smartRequestId = requestId;
  state.agentConversation.smartLoading = true;
  state.agentConversation.smartHint = pickText(
    "正在结合 ChatGPT 和实时候选优化方案...",
    "Refining with ChatGPT and live candidates...",
    "ChatGPT とリアルタイム候補で提案を最適化中...",
    "ChatGPT와 실시간 후보로 제안을 고도화하는 중...",
  );
  if (["planning", "confirming"].includes(state.agentConversation.mode)) {
    rerenderAgentFlowCards();
  }
  try {
    const smart = await api("/api/chat/reply", {
      method: "POST",
      body: JSON.stringify({
        message,
        language: state.uiLanguage,
        city: slots.city || getCurrentCity(),
        constraints,
      }),
    });
    if (requestId !== state.agentConversation.smartRequestId) return null;
    state.agentConversation.smartLoading = false;
    state.agentConversation.smartReply = smart || null;
    state.agentConversation.smartSignature = signature;
    if (smart && Array.isArray(smart.options) && smart.options.length) {
      state.agentConversation.currentPlan = buildAgentPlanFromSmartReply(smart, state.agentConversation.currentPlan);
      if (smart.source === "openai") {
        state.agentConversation.smartHint = pickText(
          "已使用 ChatGPT 生成定制化方案。",
          "Customized plan generated by ChatGPT.",
          "ChatGPT によるカスタム提案を生成しました。",
          "ChatGPT로 맞춤 제안을 생성했습니다.",
        );
      } else {
        const reason = String(smart.fallbackReason || "").trim();
        const reasonLabel = localizeLlmIssue(reason || "fallback");
        state.agentConversation.smartHint = reason
          ? pickText(
            `当前为离线回退方案（${reasonLabel}）。如需 ChatGPT 智能对话，请先连接 OpenAI Key。`,
            `Offline fallback is active (${reasonLabel}). To enable ChatGPT-grade dialogue, connect an OpenAI key.`,
            `現在はオフラインフォールバックです（${reasonLabel}）。ChatGPT 対話を使うには OpenAI キーを接続してください。`,
            `현재 오프라인 폴백 모드입니다 (${reasonLabel}). ChatGPT 대화를 사용하려면 OpenAI 키를 연결하세요.`,
          )
          : pickText(
            "已使用实时候选生成定制化方案。",
            "Customized plan generated from live candidates.",
            "リアルタイム候補からカスタム提案を生成しました。",
            "실시간 후보 기반 맞춤 제안을 생성했습니다.",
          );
      }
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        rerenderAgentFlowCards();
      }
      if (!shouldRenderAgentFlowCards()) {
        renderSmartReplyCard(smart);
      }
      if (opts.announce && shouldRenderAgentFlowCards()) {
        const snippet = smartReplySnippet(smart);
        if (snippet) addMessage(snippet, "agent");
      }
    } else {
      state.agentConversation.smartHint = pickText(
        "实时方案暂不可用，已保留本地可执行方案。",
        "Live refinement unavailable. Kept local executable options.",
        "リアルタイム最適化は未取得のためローカル案を保持しました。",
        "실시간 고도화가 불가해 로컬 실행안을 유지했습니다.",
      );
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        rerenderAgentFlowCards();
      }
      if (!shouldRenderAgentFlowCards() && smart && smart.reply) {
        renderSmartReplyCard(smart);
      }
    }
    return smart || null;
  } catch (err) {
    if (requestId === state.agentConversation.smartRequestId) {
      state.agentConversation.smartLoading = false;
      state.agentConversation.smartHint = pickText(
        `智能引擎暂不可用：${err.message}`,
        `Smart engine unavailable: ${err.message}`,
        `スマートエンジン一時利用不可: ${err.message}`,
        `스마트 엔진 일시 사용 불가: ${err.message}`,
      );
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        rerenderAgentFlowCards();
      }
    }
    return null;
  }
}

function clearAgentFlowCards() {
  const cards = [...document.querySelectorAll(".agent-flow-card")];
  for (const node of cards) node.remove();
  clearTaskPanels();
}

function renderAgentAskingCard(missingSlots, slots = null) {
  if (!shouldRenderAgentFlowCards()) return;
  const safeSlots = slots && typeof slots === "object" ? slots : (state.agentConversation.slots || {});
  const askSlots = prioritizeMissingSlots(missingSlots || [], safeSlots.intent || "eat").slice(0, 2);
  const quickRows = askSlots
    .map((slot) => {
      const choices = agentQuickChoicesForSlot(slot);
      if (!choices.length) return "";
      const buttons = choices
        .map((item) => `<button class="secondary" data-action="agent-slot-quick" data-slot="${escapeHtml(slot)}" data-value="${escapeHtml(item.value)}">${escapeHtml(item.label)}</button>`)
        .join("");
      return `<div class="agent-ask-row"><strong>${escapeHtml(slotLabelForAgent(slot))}</strong><div class="actions">${buttons}</div></div>`;
    })
    .join("");
  renderTaskPanel(
    el.planCardsSection,
    `
    <h3>${pickText("还差关键信息", "Missing key inputs", "不足している情報", "누락된 핵심 정보")}</h3>
    <div class="status">${escapeHtml(askingLeadMessage(safeSlots, askSlots))}</div>
    <div class="status">${pickText("缺失项", "Missing", "不足項目", "누락 항목")}: ${askSlots.map((slot) => escapeHtml(slotLabelForAgent(slot))).join(" / ")}</div>
    ${quickRows || `<div class="status">${pickText("继续自然输入也可以。", "You can also continue with free text.", "自由入力でも続行できます。", "자유 입력으로도 계속할 수 있습니다.")}</div>`}
  `,
  );
}

function renderAgentPlanningCard(plan) {
  if (!shouldRenderAgentFlowCards()) return;
  if (!plan) return;
  const main = plan.mainOption;
  const backup = plan.backupOption;
  const comboSteps = Array.isArray(plan.steps) ? plan.steps : [];
  const smartHint = state.agentConversation.smartHint || "";
  const smartLoading = state.agentConversation.smartLoading === true;
  if (taskComponents && taskComponents.PlanCardsSection) {
    taskComponents.PlanCardsSection.render(el.planCardsSection, {
      visible: true,
      title: pickText("可执行方案", "Executable options", "実行可能な提案", "실행 가능한 옵션"),
      summary: `${plan.summary || "-"}${smartHint ? `\n${smartHint}` : ""}`,
      mainOption: {
        ...(main || {}),
        imagePath: assetUrl((main && main.imagePath) || "/assets/solution-flow.svg"),
      },
      backupOption: {
        ...(backup || main || {}),
        imagePath: assetUrl(((backup || main) && (backup || main).imagePath) || "/assets/solution-flow.svg"),
      },
      comboSteps: plan.type === "combo" ? comboSteps : [],
      placeLabel: pickText("地点/路线", "Place/Route", "場所/ルート", "장소/경로"),
      amountLabel: pickText("预估金额", "Estimated amount", "見積金額", "예상 금액"),
      riskLabel: pickText("风险", "Risk", "リスク", "리스크"),
      mainExecuteLabel: pickText("执行主方案", "Execute primary", "主案を実行", "주안 실행"),
      backupExecuteLabel: pickText("执行备选", "Execute backup", "代替案を実行", "대안 실행"),
    });
    motion.bindPressables(el.planCardsSection);
    return;
  }
  renderTaskPanel(
    el.planCardsSection,
    `
    <h3>${pickText("可执行方案", "Executable options", "実行可能な提案", "실행 가능한 옵션")}</h3>
    <div class="status">${escapeHtml(plan.summary || "-")}</div>
    ${
      smartHint
        ? `<div class="status ${smartLoading ? "agent-smart-hint-loading" : "agent-smart-hint"}">${escapeHtml(smartHint)}</div>`
        : ""
    }
    <div class="agent-plan-grid">
      <article class="inline-block agent-option-card agent-option-primary">
        <img class="agent-option-image media-photo" src="${escapeHtml(assetUrl((main && main.imagePath) || "/assets/solution-flow.svg"))}" alt="${escapeHtml((main && main.title) || "main option")}" />
        <h3>${escapeHtml((main && main.title) || "-")}</h3>
        <div class="status">${pickText("地点/路线", "Place/Route", "場所/ルート", "장소/경로")}: ${escapeHtml((main && main.place) || "-")}</div>
        <div class="status">ETA ${Number((main && main.eta) || 0)} min · ${pickText("预估金额", "Estimated amount", "見積金額", "예상 금액")} ${Number((main && main.amount) || 0)} CNY</div>
        <div class="actions"><button data-action="agent-request-execute" data-option="main">${pickText("执行主方案", "Execute primary", "主案を実行", "주안 실행")}</button></div>
      </article>
      <article class="inline-block agent-option-card">
        <img class="agent-option-image media-photo" src="${escapeHtml(assetUrl(((backup || main) && (backup || main).imagePath) || "/assets/solution-flow.svg"))}" alt="${escapeHtml(((backup || main) && (backup || main).title) || "backup option")}" />
        <h3>${escapeHtml(((backup || main) && (backup || main).title) || "-")}</h3>
        <div class="status">${pickText("地点/路线", "Place/Route", "場所/ルート", "장소/경로")}: ${escapeHtml(((backup || main) && (backup || main).place) || "-")}</div>
        <div class="status">ETA ${Number((((backup || main) && (backup || main).eta) || 0))} min · ${pickText("预估金额", "Estimated amount", "見積金額", "예상 금액")} ${Number((((backup || main) && (backup || main).amount) || 0))} CNY</div>
        <div class="actions"><button class="secondary" data-action="agent-request-execute" data-option="backup">${pickText("执行备选", "Execute backup", "代替案を実行", "대안 실행")}</button></div>
      </article>
    </div>
  `,
  );
}

function renderAgentConfirmCard(optionKey = "main") {
  if (!shouldRenderAgentFlowCards()) return;
  const plan = state.agentConversation.currentPlan;
  if (!plan) return;
  const option = optionKey === "backup" ? plan.backupOption : plan.mainOption;
  const total = Number(option.amount || 0);
  const serviceFee = Math.max(6, Math.round(total * 0.08));
  const merchantFee = Math.max(0, total - serviceFee);
  const thirdFee = Math.max(0, Math.round(total * 0.02));
  const slots = state.agentConversation.slots || {};
  const agreementRows = [
    { label: pickText("位置共享（仅本次任务）", "Location share (this task only)", "位置共有（このタスクのみ）", "위치 공유(이번 작업 한정)"), enabled: true },
    { label: pickText("代下单/代支付", "Delegated booking/payment", "委任予約/決済", "위임 예약/결제"), enabled: true },
    { label: pickText("No-PIN 额度内免密", "No-PIN within threshold", "閾値内 No-PIN", "한도 내 No-PIN"), enabled: total <= 260 && slots.execution_permission !== false },
  ];
  if (taskComponents && taskComponents.ConfirmCard) {
    taskComponents.ConfirmCard.render(el.confirmCardSection, {
      visible: true,
      optionKey,
      title: pickText("执行确认", "Execution confirmation", "実行確認", "실행 확인"),
      summary: `${pickText("你将获得", "You will get", "取得内容", "제공 항목")}: ${pickText("锁位结果 / 双语导航卡 / 订单凭证", "booking lock / bilingual navigation / order proof", "予約確保 / 多言語ナビ / 注文証憑", "예약 잠금 / 이중언어 길안내 / 주문 증빙")} · ${pickText("同意项", "Consent", "同意", "동의")}: ${agreementRows.map((row) => `${row.enabled ? "✓" : "•"} ${row.label}`).join(" · ")}`,
      amountLabel: pickText("应付总额", "Total payable", "支払総額", "총 결제금액"),
      amount: total,
      breakdownLabel: pickText("费用明细", "Fee breakdown", "料金内訳", "요금 상세"),
      breakdownMerchant: pickText("商家费用", "Merchant fee", "店舗費用", "매장 요금"),
      breakdownService: pickText("Cross X 服务费", "Cross X service fee", "Cross X 手数料", "Cross X 서비스 수수료"),
      breakdownThird: pickText("第三方手续费/汇率缓冲", "3rd-party fee/FX buffer", "外部手数料/為替バッファ", "제3자 수수료/환율 버퍼"),
      merchantAmount: merchantFee,
      serviceAmount: serviceFee,
      thirdAmount: thirdFee,
      cancelPolicy: `${pickText("取消与保障", "Cancellation & guarantee", "取消と保証", "취소 및 보장")}: ${pickText("10 分钟内免费取消；退款预计 T+1~T+3。", "Free cancel within 10 minutes; refund ETA T+1~T+3.", "10分以内は無料取消、返金はT+1~T+3。", "10분 이내 무료 취소, 환불 ETA T+1~T+3.")}`,
      confirmLabel: pickText("确认并开始执行", "Confirm & execute", "確認して実行", "확인 후 실행"),
      modifyLabel: pickText("修改条件", "Modify", "条件修正", "조건 수정"),
      cancelLabel: pickText("取消", "Cancel", "キャンセル", "취소"),
    });
    motion.bindPressables(el.confirmCardSection);
    return;
  }
  renderTaskPanel(
    el.confirmCardSection,
    `
    <h3>${pickText("执行确认", "Execution confirmation", "実行確認", "실행 확인")}</h3>
    <div class="status">${pickText("你将获得", "You will get", "取得内容", "제공 항목")}: ${pickText("锁位结果 / 双语导航卡 / 订单凭证", "booking lock / bilingual navigation / order proof", "予約確保 / 多言語ナビ / 注文証憑", "예약 잠금 / 이중언어 길안내 / 주문 증빙")}</div>
    <div class="status">${pickText("应付总额", "Total payable", "支払総額", "총 결제금액")}: <strong>${total} CNY</strong></div>
    <div class="actions">
      <button data-action="agent-confirm-execution" data-option="${escapeHtml(optionKey)}">${pickText("确认并开始执行", "Confirm & execute", "確認して実行", "확인 후 실행")}</button>
      <button class="secondary" data-action="agent-open-condition-editor">${pickText("修改条件", "Modify", "条件修正", "조건 수정")}</button>
      <button class="secondary" data-action="agent-cancel-confirm">${pickText("取消", "Cancel", "キャンセル", "취소")}</button>
    </div>
  `,
  );
}

function renderAgentExecutionCard(run) {
  if (!shouldRenderAgentFlowCards()) return;
  if (!run) return;
  const total = Array.isArray(run.steps) ? run.steps.length : 0;
  const done = (run.steps || []).filter((s) => s.status === "done").length;
  const running = (run.steps || []).filter((s) => s.status === "running").length;
  const failed = (run.steps || []).filter((s) => s.status === "failed").length;
  const normalizedRunStatus = run.status === "completed" ? "completed" : run.status === "failed" ? "failed" : run.status === "running" ? "running" : "queued";
  const steps = (run.steps || []).map((step) => {
    const normalized = step.status === "done" ? "success" : (step.status || "queued");
    return {
      label: step.label,
      badge: normalized,
      statusText: localizeStatus(normalized),
      reason: step.output && step.output.reason ? String(step.output.reason) : "",
    };
  });
  if (taskComponents && taskComponents.ExecutionStepsList) {
    taskComponents.ExecutionStepsList.render(el.executionStepsSection, {
      visible: true,
      title: `${pickText("执行步骤", "Execution steps", "実行ステップ", "실행 단계")} · ${run.id}`,
      statusLabel: pickText("状态", "Status", "状態", "상태"),
      statusClass: normalizedRunStatus,
      statusText: localizeStatus(normalizedRunStatus),
      progressLabel: pickText("完成", "Done", "完了", "완료"),
      done,
      total,
      steps,
    });
    motion.bindPressables(el.executionStepsSection);
    return;
  }
  const list = steps
    .map(
      (step) =>
        `<li class="step-line"><strong>${escapeHtml(step.label)}</strong> <span class="status-badge ${escapeHtml(step.badge)}">${escapeHtml(step.statusText)}</span>${step.reason ? `<div class=\"status\">${escapeHtml(step.reason)}</div>` : ""}</li>`,
    )
    .join("");
  renderTaskPanel(
    el.executionStepsSection,
    `
    <h3>${pickText("执行步骤", "Execution steps", "実行ステップ", "실행 단계")} · ${escapeHtml(run.id)}</h3>
    <div class="status">${pickText("状态", "Status", "状態", "상태")}: <strong>${escapeHtml(localizeStatus(normalizedRunStatus))}</strong></div>
    <div class="status">${pickText("完成", "Done", "完了", "완료")}: ${done}/${total}</div>
    <ol class="steps">${list}</ol>
  `,
  );
}

function renderAgentResultCard(result) {
  if (!shouldRenderAgentFlowCards()) return;
  if (!result) return;
  if (taskComponents && taskComponents.ExecutionResultCard) {
    taskComponents.ExecutionResultCard.render(el.executionResultSection, {
      visible: true,
      title: pickText("执行完成", "Execution completed", "実行完了", "실행 완료"),
      summary: `${pickText("地点/路线", "Place/Route", "場所/ルート", "장소/경로")}: ${result.place} · ${pickText("金额", "Amount", "金額", "금액")}: ${Number(result.amount || 0)} CNY · ETA ${Number(result.eta || 0)} min`,
      orderId: result.orderId,
      actions: {
        primaryLabel: pickText("导航过去", "Navigate", "ナビを開く", "길안내"),
        backupLabel: pickText("改成更便宜方案", "Switch to cheaper backup", "より安い代替案へ変更", "더 저렴한 대안으로 변경"),
      },
    });
    motion.bindPressables(el.executionResultSection);
    return;
  }
  renderTaskPanel(
    el.executionResultSection,
    `
    <h3>${pickText("执行完成", "Execution completed", "実行完了", "실행 완료")}</h3>
    <div class="status">${pickText("订单号", "Order ID", "注文ID", "주문 ID")}: <span class="code">${escapeHtml(result.orderId)}</span></div>
    <div class="status">${pickText("地点/路线", "Place/Route", "場所/ルート", "장소/경로")}: ${escapeHtml(result.place)}</div>
    <div class="status">${pickText("金额", "Amount", "金額", "금액")}: ${Number(result.amount || 0)} CNY · ETA ${Number(result.eta || 0)} min</div>
    <div class="actions">
      <button class="secondary" data-action="agent-nav">${pickText("导航过去", "Navigate", "ナビを開く", "길안내")}</button>
      <button class="secondary" data-action="agent-request-execute" data-option="backup">${pickText("改成更便宜方案", "Switch to cheaper backup", "より安い代替案へ変更", "더 저렴한 대안으로 변경")}</button>
    </div>
  `,
  );
}

function renderAgentFailureCard(failure) {
  if (!shouldRenderAgentFlowCards()) return;
  if (!failure) return;
  if (taskComponents && taskComponents.ExecutionResultCard) {
    taskComponents.ExecutionResultCard.render(el.executionResultSection, {
      visible: true,
      title: pickText("执行受阻", "Execution blocked", "実行中断", "실행 중단"),
      summary: `${failure.reason} ${failure.action}`,
      actions: {
        replanLabel: pickText("切换到备选并继续", "Switch to backup", "代替案へ切替", "대안으로 전환"),
        retryLabel: pickText("重试主方案", "Retry primary", "主案を再試行", "주안 재시도"),
      },
    });
    motion.bindPressables(el.executionResultSection);
    return;
  }
  renderTaskPanel(
    el.executionResultSection,
    `
    <h3>${pickText("执行受阻", "Execution blocked", "実行中断", "실행 중단")}</h3>
    <div class="status">${escapeHtml(failure.reason)}</div>
    <div class="status">${escapeHtml(failure.action)}</div>
    <div class="actions">
      <button data-action="agent-switch-backup">${pickText("切换到备选并继续", "Switch to backup", "代替案へ切替", "대안으로 전환")}</button>
      <button class="secondary" data-action="agent-retry-run">${pickText("重试主方案", "Retry primary", "主案を再試行", "주안 재시도")}</button>
    </div>
  `,
  );
}

function optionFromPlan(optionKey) {
  const plan = state.agentConversation.currentPlan;
  if (!plan) return null;
  return optionKey === "backup" ? plan.backupOption : plan.mainOption;
}

function buildRunSteps(option) {
  const intent = option && option.intent ? option.intent : "eat";
  if (intent === "combo") {
    return [
      { key: "query", label: pickText("查询候选资源", "Query candidates", "候補検索", "후보 조회"), status: "queued" },
      { key: "validate", label: pickText("校验时效与价格", "Validate ETA and price", "時効と価格を検証", "시간/가격 검증"), status: "queued" },
      { key: "lock", label: pickText("锁位与路线", "Lock booking and route", "予約とルートを確保", "예약/경로 잠금"), status: "queued" },
      { key: "pay", label: pickText("支付确认", "Payment confirmation", "決済確認", "결제 확인"), status: "queued" },
      { key: "proof", label: pickText("生成凭证", "Generate proof", "証憑生成", "증빙 생성"), status: "queued" },
    ];
  }
  if (intent === "trip") {
    return [
      { key: "query", label: pickText("查询可用交通", "Query transport", "交通候補検索", "교통 조회"), status: "queued" },
      { key: "validate", label: pickText("校验拥堵与时效", "Validate traffic and ETA", "渋滞と時効を検証", "혼잡/ETA 검증"), status: "queued" },
      { key: "lock", label: pickText("锁定路线", "Lock route", "ルート確定", "경로 잠금"), status: "queued" },
      { key: "proof", label: pickText("生成行程摘要", "Generate itinerary summary", "旅程要約を生成", "일정 요약 생성"), status: "queued" },
    ];
  }
  if (intent === "hotel") {
    return [
      { key: "query", label: pickText("查询可订房型", "Query room availability", "客室在庫検索", "객실 재고 조회"), status: "queued" },
      { key: "lock", label: pickText("锁定房型", "Lock room type", "客室タイプ確保", "객실 유형 잠금"), status: "queued" },
      { key: "pay", label: pickText("确认费用", "Confirm payment", "料金確認", "요금 확인"), status: "queued" },
      { key: "proof", label: pickText("生成入住凭证", "Generate check-in proof", "チェックイン証憑生成", "체크인 증빙 생성"), status: "queued" },
    ];
  }
  return [
    { key: "query", label: pickText("查询附近门店", "Query nearby venues", "近隣店舗検索", "주변 매장 조회"), status: "queued" },
    { key: "filter", label: pickText("筛选预算与偏好", "Filter by budget/preferences", "予算と好みで絞込", "예산/선호 필터링"), status: "queued" },
    { key: "queue", label: pickText("检查排队并锁位", "Check queue and lock", "待機確認と席確保", "대기 확인 및 좌석 잠금"), status: "queued" },
    { key: "proof", label: pickText("生成到店摘要", "Generate arrival summary", "到着サマリー生成", "도착 요약 생성"), status: "queued" },
  ];
}

function failureDetailByCode(code = "", context = {}) {
  const normalized = String(code || "");
  if (normalized === "budget_overflow") {
    return {
      code: normalized,
      reason: pickText(
        `主方案估算 ${context.estimatedAmount || "-"} 已超过你的预算上限 ${context.budgetCap || "-"}.`,
        `Primary option estimate ${context.estimatedAmount || "-"} exceeds your budget cap ${context.budgetCap || "-"}.`,
        `主案の見積 ${context.estimatedAmount || "-"} が予算上限 ${context.budgetCap || "-"} を超えました。`,
        `주안 예상 ${context.estimatedAmount || "-"} 이(가) 예산 상한 ${context.budgetCap || "-"} 을(를) 초과했습니다.`,
      ),
      action: pickText(
        "我已将预算约束加入重规划，优先切到更便宜备选。",
        "I added stricter budget constraints and will switch to a cheaper backup.",
        "予算制約を強めて再計画し、より安い代替案へ切替えます。",
        "예산 제약을 강화해 재계획하고 더 저렴한 대안으로 전환합니다.",
      ),
    };
  }
  if (normalized === "queue_too_long") {
    return {
      code: normalized,
      reason: pickText(
        `主方案排队约 ${context.queueMin || "-"} 分钟，超过你的可接受范围。`,
        `Primary option queue is about ${context.queueMin || "-"} minutes, above your tolerance.`,
        `主案の待ち時間が約 ${context.queueMin || "-"} 分で、許容範囲を超えました。`,
        `주안 대기 시간이 약 ${context.queueMin || "-"}분으로 허용 범위를 초과했습니다.`,
      ),
      action: pickText(
        "我会优先不排队条件重规划，并切换备选。",
        "I will replan with no-queue priority and switch to backup.",
        "待ち時間最小を優先して再計画し、代替案に切替えます。",
        "대기 최소 조건으로 재계획하고 대안으로 전환합니다.",
      ),
    };
  }
  return {
    code: "resource_unavailable",
    reason: pickText(
      "主方案资源不可用（订满/关闭/不可达）。",
      "Primary resource is unavailable (sold out/closed/unreachable).",
      "主案のリソースが利用不可です（満席/休業/到達不可）。",
      "주안 리소스를 사용할 수 없습니다(매진/휴무/도달 불가).",
    ),
    action: pickText(
      "我已自动切换到可用备选，并等待你确认继续。",
      "I switched to an available backup and await your confirmation.",
      "利用可能な代替案へ自動切替し、確認を待っています。",
      "사용 가능한 대안으로 자동 전환했고 확인을 기다립니다.",
    ),
  };
}

function runProgressNarrative(step, index, total) {
  const map = {
    query: pickText("正在查询可用资源...", "Searching available resources...", "利用可能リソースを検索中...", "사용 가능한 리소스를 조회 중..."),
    filter: pickText("已筛选符合预算与偏好的候选...", "Filtering candidates by budget and preferences...", "予算と好みに合う候補を抽出中...", "예산/선호 조건 후보를 추출 중..."),
    validate: pickText("正在校验时效、排队与价格...", "Validating ETA, queue and price...", "時効・待機・価格を検証中...", "ETA/대기/가격을 검증 중..."),
    queue: pickText("正在检查排队并尝试锁位...", "Checking queue and trying to lock...", "待機確認とロック処理中...", "대기 확인 및 잠금 처리 중..."),
    lock: pickText("正在锁定核心资源...", "Locking key resources...", "主要リソースを確保中...", "핵심 리소스를 잠그는 중..."),
    pay: pickText("正在处理支付确认...", "Processing payment confirmation...", "決済確認を処理中...", "결제 확인 처리 중..."),
    proof: pickText("正在生成凭证与结果摘要...", "Generating proof and result summary...", "証憑と結果要約を生成中...", "증빙 및 결과 요약을 생성 중..."),
  };
  const text = map[step.key] || pickText("正在执行步骤...", "Executing step...", "ステップ実行中...", "단계 실행 중...");
  return text;
}

function stepCanFailWithCode(stepKey, failureCode) {
  const step = String(stepKey || "");
  const code = String(failureCode || "");
  if (code === "queue_too_long") return ["queue", "validate", "filter"].includes(step);
  if (code === "budget_overflow") return ["validate", "filter", "pay"].includes(step);
  if (code === "resource_unavailable") return ["query", "lock", "validate"].includes(step);
  return false;
}

function deriveDeterministicFailureCode(optionKey, slots, seedKey) {
  const key = String(optionKey || "main");
  if (key !== "main") return "";
  const city = String((slots && slots.city) || "").toLowerCase();
  const area = String((slots && slots.area) || "").toLowerCase();
  const timeText = String((slots && slots.time_constraint) || "").toLowerCase();
  const prefs = Array.isArray(slots && slots.preferences) ? slots.preferences : [];
  const budgetLevel = budgetLevelFromValue(slots && slots.budget ? slots.budget : "");
  const isQueueStressCase = prefs.includes("no_queue") && (/shenzhen|深圳/.test(city) || /nanshan|南山/.test(area));
  const isEveningRush = /tonight|今晚|晚餐|dinner/.test(timeText) || prefs.includes("dinner") || /晚餐|dinner|tonight|今晚/.test(String((slots && slots.intent_raw) || "").toLowerCase());
  // Demo Path B: queue stress case always fails on main (evening rush or not)
  if (isQueueStressCase) return "queue_too_long";
  if (budgetLevel === "low" && seededFloat(seedKey, "runtime_budget_overflow") < 0.36) return "budget_overflow";
  if (seededFloat(seedKey, "runtime_resource_unavailable") < 0.11) return "resource_unavailable";
  return "";
}

function needsExecutionConfirm(option) {
  if (!option) return false;
  if (option.requiresPayment) return true;
  return Number(option.amount || 0) > 260;
}

function findCandidateForPlanOption(option, searchResult, seedKey) {
  const candidates = Array.isArray(searchResult && searchResult.candidates) ? searchResult.candidates : [];
  if (!candidates.length) return null;
  const exact = candidates.find((candidate) => candidate.place === option.place || candidate.title === option.place);
  if (exact) return exact;
  return seededPick(seedKey, `candidate_pick|${option.key || "main"}`, candidates) || candidates[0];
}

async function runStepTool(step, context) {
  const ctx = context || {};
  const stepKey = String(step && step.key ? step.key : "");
  if (stepKey === "query") {
    const search = searchOptionsMock(ctx.slots || {}, ctx.intent || "eat");
    const candidate = findCandidateForPlanOption(ctx.option, search, ctx.seedKey);
    return {
      ok: !!candidate,
      tool: "search_options_mock",
      candidate,
      search,
      code: candidate ? "ok" : "resource_unavailable",
      reason: candidate
        ? pickText("已筛选出可执行候选。", "Executable candidates are ready.","実行可能候補を抽出しました。", "실행 가능한 후보를 추렸습니다.")
        : pickText("没有可执行候选。", "No executable candidates found.","実行可能な候補がありません。", "실행 가능한 후보가 없습니다."),
    };
  }
  if (stepKey === "filter" || stepKey === "validate" || stepKey === "queue") {
    const check = checkConstraintsMock(ctx.slots || {}, ctx.candidate || null, stepKey);
    return {
      ...check,
      candidate: ctx.candidate || null,
    };
  }
  if (stepKey === "lock") {
    const reserve = reserveMock(ctx.slots || {}, ctx.candidate || null, `${ctx.seedKey}|lock`, (ctx.option && ctx.option.key) || "main");
    return {
      ...reserve,
      candidate: ctx.candidate || null,
    };
  }
  if (stepKey === "pay") {
    const check = checkConstraintsMock(ctx.slots || {}, ctx.candidate || null, "pay_guard");
    if (!check.ok) return check;
    return {
      ok: true,
      tool: "payment_mock",
      code: "ok",
      reason: pickText("支付校验通过（模拟）。", "Payment check passed (mock).","決済検証を通過しました（mock）。", "결제 검증을 통과했습니다 (mock)."),
    };
  }
  if (stepKey === "proof") {
    const route = routeMock(ctx.slots || {}, ctx.candidate || null, `${ctx.seedKey}|route`);
    const proof = proofGenerateMock(ctx.slots || {}, ctx.option || {}, ctx.runId || "run", route);
    return {
      ...proof,
      route,
    };
  }
  return {
    ok: true,
    tool: "noop",
    code: "ok",
    reason: pickText("步骤完成。", "Step completed.","ステップ完了。", "단계 완료."),
  };
}

async function autoReplanAfterFailure(run, detail) {
  const failure = detail || {};
  setAgentMode("replanning", { failureCode: failure.code || "unknown" });
  state.agentConversation.lastFailureCode = String(failure.code || "unknown");
  const slots = state.agentConversation.slots || {};
  if (failure.code === "budget_overflow") {
    slots.budget = budgetLevelFromValue(slots.budget) === "high" ? "mid" : "low";
    markAgentSlotEvidence("budget", true);
  } else if (failure.code === "queue_too_long") {
    slots.preferences = mergePreferences(slots.preferences, ["no_queue", "queue_flexible_after_fail"]);
    markAgentPreferenceEvidence();
  } else if (failure.code === "resource_unavailable") {
    slots.preferences = mergePreferences(slots.preferences, ["walk_first"]);
    markAgentPreferenceEvidence();
  }
  state.agentConversation.slots = slots;
  syncSelectedConstraintsFromAgentSlots();
  syncChipSelectionFromConstraints();
  updateContextSummary();
  renderAgentInputDeck();

  const replanned = buildAgentPlanFromSlots();
  state.agentConversation.currentPlan = replanned;
  state.agentConversation.pendingOptionKey = "backup";
  appendAgentTelemetry("auto_replanning", {
    failureCode: failure.code || "unknown",
    pendingOption: "backup",
  });
  addMessage(failure.reason || pickText("主方案失败。", "Primary option failed.","主案が失敗しました。", "주안이 실패했습니다."), "agent");
  addMessage(failure.action || pickText("我已生成新备选，请确认是否继续。", "I prepared a new backup. Confirm to continue.","新しい代替案を用意しました。続行するか確認してください。", "새 대안을 준비했습니다. 계속 진행할지 확인해 주세요."), "agent");
  setAgentMode("confirming", { source: "auto_replan" });
  rerenderAgentFlowCards();
}

async function runAgentExecution(optionKey = "main", forceFail = false) {
  const option = optionFromPlan(optionKey);
  if (!option) return;
  state.agentConversation.smartLoading = false;
  state.agentConversation.smartHint = "";
  const run = {
    id: `run_${Date.now().toString(36)}`,
    status: "queued",
    optionKey,
    option,
    steps: buildRunSteps(option),
    createdAt: new Date().toISOString(),
  };
  const slots = state.agentConversation.slots || {};
  state.agentConversation.currentRun = run;
  state.agentConversation.historyRuns.unshift(run);
  setAgentMode("executing", { runId: run.id, option: option.key || optionKey });
  rerenderAgentFlowCards();
  addMessage(pickText("任务已入队，马上开始执行。", "Task queued. Execution is starting.","タスクをキューに追加しました。実行を開始します。", "작업이 큐에 등록되었습니다. 실행을 시작합니다."), "agent");

  await new Promise((resolve) => setTimeout(resolve, motion.safeDuration(350)));
  run.status = "running";
  const seedKey = createAgentSeedKey(`run_${optionKey}`, slots);
  let activeCandidate = null;
  let routeInfo = null;
  let forcedFailureCode = "";
  const deterministicFailureCode = deriveDeterministicFailureCode(optionKey, slots, seedKey);
  if (forceFail) {
    const failureChoices = ["queue_too_long", "budget_overflow", "resource_unavailable"];
    forcedFailureCode = seededPick(seedKey, "force_failure_code", failureChoices) || "queue_too_long";
  } else {
    forcedFailureCode = deterministicFailureCode;
  }
  if (forcedFailureCode) {
    appendAgentTelemetry("execution_failure_policy", {
      runId: run.id,
      optionKey,
      forcedFailureCode,
      manual: forceFail === true,
    });
  }
  rerenderAgentFlowCards();

  for (let i = 0; i < run.steps.length; i += 1) {
    const step = run.steps[i];
    step.status = "running";
    rerenderAgentFlowCards();
    addMessage(runProgressNarrative(step, i, run.steps.length), "agent");
    await new Promise((resolve) => setTimeout(resolve, motion.safeDuration(280 + i * 120)));
    const toolResult = await runStepTool(step, {
      runId: run.id,
      option,
      slots,
      intent: option.intent || "eat",
      candidate: activeCandidate,
      seedKey,
    });
    step.tool = toolResult.tool;
    step.output = toolResult;
    if (toolResult.candidate) activeCandidate = toolResult.candidate;
    if (toolResult.route) routeInfo = toolResult.route;

    if (forcedFailureCode && stepCanFailWithCode(step.key, forcedFailureCode)) {
      step.status = "failed";
      run.status = "failed";
      const failure = failureDetailByCode(forcedFailureCode, toolResult);
      run.failure = failure;
      setAgentMode("failed", { runId: run.id, failureCode: failure.code });
      appendAgentTelemetry("execution_failed", {
        runId: run.id,
        step: step.key,
        code: failure.code,
      });
      rerenderAgentFlowCards();
      await autoReplanAfterFailure(run, failure);
      return;
    }

    if (!toolResult.ok) {
      step.status = "failed";
      run.status = "failed";
      const failure = failureDetailByCode(toolResult.code || "resource_unavailable", toolResult);
      run.failure = failure;
      setAgentMode("failed", { runId: run.id, failureCode: failure.code });
      appendAgentTelemetry("execution_failed", {
        runId: run.id,
        step: step.key,
        code: failure.code,
      });
      rerenderAgentFlowCards();
      await autoReplanAfterFailure(run, failure);
      return;
    }
    step.status = "done";
    appendAgentTelemetry("step_done", {
      runId: run.id,
      step: step.key,
      tool: toolResult.tool,
    });
    rerenderAgentFlowCards();
  }

  run.status = "completed";
  setAgentMode("completed", { runId: run.id, option: option.key || optionKey });
  const result = {
    orderId: `MOCK-${Date.now().toString().slice(-6)}`,
    place: option.place,
    amount: option.amount,
    eta: routeInfo && Number(routeInfo.eta || 0) ? Number(routeInfo.eta) : Number(option.eta || 0),
    proof: routeInfo ? routeInfo : null,
  };
  run.result = result;
  rerenderAgentFlowCards();
  addMessage(
    pickText(
      `已完成：${option.place}，金额 ${option.amount} CNY。可继续导航或改为备选方案。`,
      `Done: ${option.place}, amount ${option.amount} CNY. You can navigate now or switch to backup.`,
      `完了: ${option.place}、金額 ${option.amount} CNY。ナビ開始または代替案へ変更できます。`,
      `완료: ${option.place}, 금액 ${option.amount} CNY. 지금 이동하거나 대안으로 변경할 수 있습니다.`,
    ),
    "agent",
  );
}

function applyAssumptionsForMissingSlots(slots, missingSlots) {
  const safe = slots && typeof slots === "object" ? slots : {};
  const assumptions = [];
  for (const slot of missingSlots || []) {
    if (slot === "city" && !safe.city) {
      safe.city = getCurrentCity();
      assumptions.push(`${slotLabelForAgent(slot)}=${safe.city}`);
      continue;
    }
    if (slot === "budget" && !safe.budget) {
      safe.budget = "mid";
      assumptions.push(`${slotLabelForAgent(slot)}=mid`);
      continue;
    }
    if (slot === "party_size" && !safe.party_size) {
      safe.party_size = "2";
      assumptions.push(`${slotLabelForAgent(slot)}=2`);
      continue;
    }
    if (slot === "time_constraint" && !safe.time_constraint) {
      safe.time_constraint = "ASAP";
      assumptions.push(`${slotLabelForAgent(slot)}=ASAP`);
    }
  }
  return assumptions;
}

function evaluateAgentConversation(options = {}) {
  const opts = options || {};
  const slots = normalizeAgentSlotsInPlace(state.agentConversation.slots || {});
  state.agentConversation.slots = slots;
  const slotEvidence = state.agentConversation.slotEvidence || emptySlotEvidence();
  syncSelectedConstraintsFromAgentSlots();
  syncChipSelectionFromConstraints();
  updateContextSummary();
  renderAgentInputDeck();
  clearAgentFlowCards();

  const rawMissing = getClarificationMissingSlots(slots, slotEvidence);
  const missing = prioritizeMissingSlots(rawMissing, slots.intent || "eat");
  if (missing.length) {
    const askSlots = missing.slice(0, 2);
    const askSignature = JSON.stringify({
      mode: "asking",
      intent: slots.intent || "eat",
      askSlots,
    });
    const canAskMore = Number(state.agentConversation.askCount || 0) < 2;
    if (!canAskMore) {
      const assumptions = applyAssumptionsForMissingSlots(slots, askSlots);
      state.agentConversation.slots = slots;
      setAgentMode("planning", { reason: "assumption_after_max_ask", assumptions });
      state.agentConversation.currentPlan = buildAgentPlanFromSlots();
      state.agentConversation.pendingOptionKey = "main";
      state.agentConversation.smartHint = pickText(
        "已按默认值补全剩余条件，并生成主备方案。",
        "I filled missing fields with defaults and generated primary/backup options.",
        "不足項目を既定値で補完し、主案/代替案を生成しました。",
        "누락 항목을 기본값으로 보완해 주안/대안을 생성했습니다.",
      );
      state.agentConversation.smartLoading = true;
      rerenderAgentFlowCards();
      if (!opts.silent) {
        addMessage(
          pickText(
            `我先按默认值补全：${assumptions.join("、")}。你可随时改条件。`,
            `I used defaults: ${assumptions.join(", ")}. You can change them anytime.`,
            `既定値で補完しました: ${assumptions.join("、")}。いつでも修正できます。`,
            `기본값으로 보완했습니다: ${assumptions.join(", ")}. 언제든 수정 가능합니다.`,
          ),
          "agent",
        );
      }
      return;
    }

    setAgentMode("asking", { missing: askSlots });
    state.agentConversation.currentPlan = null;
    state.agentConversation.smartReply = null;
    state.agentConversation.smartHint = "";
    state.agentConversation.smartLoading = false;
    rerenderAgentFlowCards();
    if (!opts.silent && state.agentConversation.lastAskedSignature !== askSignature) {
      state.agentConversation.lastAskedSignature = askSignature;
      state.agentConversation.askCount = Number(state.agentConversation.askCount || 0) + 1;
      const askLead = askingLeadMessage(slots, askSlots);
      const quickHint = askSlots
        .map((slot) => {
          const choices = agentQuickChoicesForSlot(slot).slice(0, 3).map((item) => item.label);
          if (!choices.length) return "";
          return `${slotLabelForAgent(slot)}: ${choices.join(" / ")}`;
        })
        .filter(Boolean)
        .join(" · ");
      const askIntentOnly = askSlots.length === 1 && askSlots[0] === "intent";
      const askText = askIntentOnly
        ? pickText(
          "我可以先帮你做三类事：找吃的、安排出行、订酒店。你想先解决哪一个？",
          "I can help with three things first: food, travel, or hotel. Which one should I solve first?",
          "先にできるのは3つです: 食事・移動・ホテル。どれを先に進めますか？",
          "먼저 도와줄 수 있는 건 3가지예요: 식사, 이동, 호텔. 무엇부터 해결할까요?",
        )
        : pickText(
          `${askLead}${quickHint ? ` 可直接回复：${quickHint}` : ""}`,
          `${askLead}${quickHint ? ` Quick reply: ${quickHint}` : ""}`,
          `${askLead}${quickHint ? ` そのまま返信: ${quickHint}` : ""}`,
          `${askLead}${quickHint ? ` 바로 답장: ${quickHint}` : ""}`,
        );
      addMessage(
        askText,
        "agent",
      );
    }
    return;
  }

  state.agentConversation.askCount = 0;
  state.agentConversation.lastAskedSignature = "";
  const plan = buildAgentPlanFromSlots();
  state.agentConversation.currentPlan = plan;
  state.agentConversation.pendingOptionKey = "main";
  state.agentConversation.smartHint = pickText(
    "正在结合实时候选细化方案...",
    "Refining options with live candidates...",
    "リアルタイム候補で提案を精緻化しています...",
    "실시간 후보로 제안을 고도화하고 있습니다...",
  );
  state.agentConversation.smartLoading = true;
  setAgentMode("planning", {
    mainPlace: plan.mainOption && plan.mainOption.place ? plan.mainOption.place : "",
    backupPlace: plan.backupOption && plan.backupOption.place ? plan.backupOption.place : "",
  });
  rerenderAgentFlowCards();
  if (!opts.silent) {
    addMessage(
      planningLeadMessage(slots),
      "agent",
    );
  }
}

function resetAgentConversationForDemo() {
  state.agentConversation.mode = "idle";
  state.agentConversation.slots = {
    intent: null,
    city: null,
    area: null,
    budget: null,
    time_constraint: null,
    party_size: null,
    preferences: [],
    execution_permission: false,
  };
  state.agentConversation.slotEvidence = emptySlotEvidence();
  state.agentConversation.currentPlan = null;
  state.agentConversation.currentRun = null;
  state.agentConversation.pendingOptionKey = "main";
  state.agentConversation.askCount = 0;
  state.agentConversation.lastAskedSignature = "";
  state.agentConversation.lastFailureCode = "";
  state.agentConversation.lastUserInput = "";
  state.agentConversation.smartReply = null;
  state.agentConversation.smartHint = "";
  state.agentConversation.smartLoading = false;
  state.agentConversation.smartSignature = "";
  state.agentConversation.warnedMissingLlm = false;
  clearAgentFlowCards();
  syncSelectedConstraintsFromAgentSlots();
  syncChipSelectionFromConstraints();
  updateContextSummary();
  renderAgentInputDeck();
  rerenderAgentFlowCards();
}

function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, motion.safeDuration(ms)));
}

async function runAgentDemoPath(pathName = "normal") {
  const path = String(pathName || "normal").toLowerCase();
  resetAgentConversationForDemo();
  addMessage(
    pickText(
      `已启动演示路径：${path}`,
      `Demo path started: ${path}`,
      `デモパスを開始: ${path}`,
      `데모 경로 시작: ${path}`,
    ),
    "agent",
    { speak: false },
  );

  if (path === "normal" || path === "path-a") {
    await handleAgentConversationInput("我在深圳南山，2个人，预算中等，今晚想吃不排队的");
    await waitMs(180);
    state.agentConversation.pendingOptionKey = "main";
    setAgentMode("confirming", { source: "demo_normal" });
    rerenderAgentFlowCards();
    await runAgentExecution("main", false);
    return { ok: true, path };
  }

  if (path === "fail" || path === "path-b") {
    await handleAgentConversationInput("我想在深圳南山找一家不排队的晚餐，预算中等，2个人，今晚");
    await waitMs(180);
    state.agentConversation.pendingOptionKey = "main";
    setAgentMode("confirming", { source: "demo_fail" });
    rerenderAgentFlowCards();
    await runAgentExecution("main", true);
    await waitMs(220);
    if (state.agentConversation.mode === "confirming") {
      await runAgentExecution("backup", false);
    }
    return { ok: true, path };
  }

  if (path === "voice" || path === "path-c") {
    state.voice.conversationMode = true;
    state.voice.replyEnabled = true;
    state.voice.listening = true;
    state.voice.processing = false;
    state.voice.speaking = false;
    renderVoiceControls();
    await waitMs(120);
    await handleAgentConversationInput("帮我找深圳南山吃饭的地方");
    state.voice.listening = false;
    state.voice.processing = true;
    renderVoiceControls();
    await waitMs(160);
    state.voice.processing = false;
    state.voice.speaking = true;
    renderVoiceControls();
    await waitMs(200);
    interruptAssistantSpeech("demo_voice_barge_in");
    await handleAgentConversationInput("等一下，预算低一点，别排队");
    await waitMs(180);
    state.agentConversation.pendingOptionKey = "main";
    setAgentMode("confirming", { source: "demo_voice" });
    rerenderAgentFlowCards();
    await runAgentExecution("main", false);
    state.voice.speaking = false;
    state.voice.conversationMode = false;
    renderVoiceControls();
    return { ok: true, path };
  }

  addMessage(
    pickText(
      `未知演示路径：${path}。可用 normal/fail/voice。`,
      `Unknown demo path: ${path}. Available: normal/fail/voice.`,
      `不明なデモパス: ${path}。利用可能: normal/fail/voice。`,
      `알 수 없는 데모 경로: ${path}. 사용 가능: normal/fail/voice.`,
    ),
    "agent",
    { speak: false },
  );
  return { ok: false, path };
}

async function handleAgentConversationInput(text) {
  const input = String(text || "").trim();
  if (!input) return;
  addMessage(input, "user");

  if (!state.agentConversation.warnedMissingLlm) {
    state.agentConversation.warnedMissingLlm = true;
    try {
      const llm = await api("/api/system/llm-status");
      const configured = llm && llm.configured === true && llm.keyHealth && llm.keyHealth.looksValid === true;
      if (!configured) {
        addMessage(
          pickText(
            `当前未连接 OpenAI（${localizeLlmIssue((llm && llm.keyHealth && llm.keyHealth.reason) || (llm && llm.lastRuntime && llm.lastRuntime.lastError) || "missing_api_key")}），我会先用本地策略生成方案。`,
            `OpenAI is not connected (${localizeLlmIssue((llm && llm.keyHealth && llm.keyHealth.reason) || (llm && llm.lastRuntime && llm.lastRuntime.lastError) || "missing_api_key")}). I will use local strategy for now.`,
            `OpenAI 未接続です（${localizeLlmIssue((llm && llm.keyHealth && llm.keyHealth.reason) || (llm && llm.lastRuntime && llm.lastRuntime.lastError) || "missing_api_key")}）。現在はローカル戦略で提案します。`,
            `OpenAI가 연결되지 않았습니다 (${localizeLlmIssue((llm && llm.keyHealth && llm.keyHealth.reason) || (llm && llm.lastRuntime && llm.lastRuntime.lastError) || "missing_api_key")}). 현재는 로컬 전략으로 제안을 생성합니다.`,
          ),
          "agent",
          { speak: false },
        );
      }
    } catch {
      // ignore diagnostics failure
    }
  }

  if (shouldUseFreeformAssistantReply(input)) {
    setThinkingIndicator(true, pickText("我在组织更自然的回复...", "Preparing a natural reply...", "自然な返答を準備しています...", "자연스러운 답변을 준비 중입니다..."));
    const freeform = await requestFreeformAssistantReply(input);
    setThinkingIndicator(false);
    if (freeform && freeform.reply) {
      setAgentMode("idle", { source: "freeform_chat" });
      clearAgentFlowCards();
      addMessage(String(freeform.reply), "agent");
      return;
    }
  }

  if (isLocalAgentChatEnabled() && state.singleDialogMode) {
    await runOpenAISolutionTurn(input);
    return;
  }

  if (isGreetingInput(input) && !state.agentConversation.currentRun && !state.agentConversation.currentPlan) {
    setAgentMode("idle", { source: "greeting" });
    clearAgentFlowCards();
    addMessage(
      pickText(
        "我在。直接告诉我你要解决的事：吃饭、出行、酒店，最好带上城市/人数/预算。",
        "I am here. Tell me the task directly: eat, travel, or hotel, ideally with city/party size/budget.",
        "対応可能です。食事・移動・ホテルのどれを解決したいか、都市/人数/予算と一緒に教えてください。",
        "도와드릴게요. 식사/이동/호텔 중 무엇을 해결할지, 가능하면 도시/인원/예산과 함께 말해 주세요.",
      ),
      "agent",
    );
    return;
  }

  setAgentMode("parsing", { source: "user_input" });
  rerenderAgentFlowCards();
  state.agentConversation.lastUserInput = input;
  syncAgentSlotsFromSelectedConstraints();
  state.agentConversation.slots = normalizeAgentSlotsInPlace(extractSlotsFromText(input, state.agentConversation.slots));
  state.agentConversation.slotEvidence = mergeSlotEvidence(
    state.agentConversation.slotEvidence,
    detectSlotEvidenceFromText(input),
  );
  if (state.agentConversation.slots.intent && String(state.agentConversation.slots.intent).toLowerCase() !== "unknown") {
    markAgentSlotEvidence("intent", true);
  }
  appendAgentTelemetry("slot_extracted", {
    intent: state.agentConversation.slots.intent || "",
    slots: { ...state.agentConversation.slots },
  });
  evaluateAgentConversation({ silent: false });
  if (["planning", "confirming"].includes(state.agentConversation.mode)) {
    await refineAgentPlanWithSmartReply(input, { announce: true });
  }
}

async function runOpenAISolutionTurn(input) {
  setAgentMode("parsing", { source: "solution_turn" });
  rerenderAgentFlowCards();
  state.agentConversation.lastUserInput = String(input || "");
  const inferred = inferConstraintsFromIntent(input);
  const mergedConstraints = {
    ...(state.selectedConstraints || {}),
    ...inferred,
  };
  state.selectedConstraints = mergedConstraints;
  syncChipSelectionFromConstraints();
  updateContextSummary();
  setThinkingIndicator(true);
  try {
    const smart = await api("/api/chat/reply", {
      method: "POST",
      body: JSON.stringify({
        message: input,
        language: state.uiLanguage,
        city: getCurrentCity(),
        constraints: mergedConstraints,
      }),
    });
    if (smart && smart.reply) {
      renderSmartReplyCard(smart);
      const snippet = smartReplySnippet(smart);
      if (snippet) {
        addMessage(snippet, "agent", { speak: false });
      }
      if (smart.clarifyNeeded) {
        setAgentMode("asking", { source: "openai_clarify" });
      } else {
        setAgentMode("planning", { source: "openai_solution_ready" });
      }
      return;
    }
    setAgentMode("idle", { source: "empty_solution_reply" });
    addMessage(
      pickText(
        "我这轮没有拿到有效方案。你可以补充城市、人数、预算，我马上重算。",
        "I didn't get a usable plan this turn. Add city, party size, and budget, and I will replan now.",
        "このターンでは有効な提案を取得できませんでした。都市・人数・予算を追加して再計算します。",
        "이번 턴에서 유효한 제안을 받지 못했습니다. 도시/인원/예산을 추가해 주세요. 바로 다시 계산합니다.",
      ),
      "agent",
    );
  } catch (err) {
    setAgentMode("idle", { source: "solution_turn_error" });
    addMessage(
      pickText(
        `智能方案生成失败：${err.message}`,
        `Smart plan generation failed: ${err.message}`,
        `スマート提案の生成に失敗しました: ${err.message}`,
        `스마트 제안 생성 실패: ${err.message}`,
      ),
      "agent",
    );
  } finally {
    setThinkingIndicator(false);
  }
}

async function applyAgentQuickFill(slot, value, pref) {
  const slots = state.agentConversation.slots || {};
  if (slot) {
    slots[slot] = value;
    markAgentSlotEvidence(slot, true);
  }
  if (pref) {
    slots.preferences = mergePreferences(slots.preferences, [pref]);
    markAgentPreferenceEvidence();
  }
  state.agentConversation.slots = slots;
  evaluateAgentConversation({ silent: false });
  if (["planning", "confirming"].includes(state.agentConversation.mode)) {
    await refineAgentPlanWithSmartReply("", { announce: false });
  }
}

function updateViewModeUI() {
  if (IS_USER_PORTAL) {
    state.viewMode = "user";
    state.singleDialogMode = true;
  }
  const mode = state.viewMode === "admin" ? "admin" : "user";
  if (mode !== "admin") {
    state.singleDialogMode = true;
  }
  if (el.viewModeTag) el.viewModeTag.textContent = mode;
  document.body.classList.toggle("admin-mode", mode === "admin");
  const adminOnly = [...document.querySelectorAll(".admin-only")];
  for (const node of adminOnly) {
    node.classList.toggle("hidden-by-mode", mode !== "admin");
  }
  if (el.viewModeForm && el.viewModeForm.viewMode) {
    el.viewModeForm.viewMode.value = mode;
  }
  if (mode !== "admin" && el.chatFeed) {
    const legacySmart = [...el.chatFeed.querySelectorAll(".smart-reply-card")];
    for (const node of legacySmart) node.remove();
  }
  rerenderAgentFlowCards();
}

const I18N = {
  EN: { tabs: ["Chat", "Near Me", "Trips", "Me", "Trust"] },
  ZH: { tabs: ["对话","附近","订单","我的","信任"] },
  ID: { tabs: ["Chat", "Dekat", "Pesanan", "Saya", "Trust"] },
  JA: { tabs: ["チャット","近く","注文","マイ","信頼"] },
  KO: { tabs: ["채팅", "근처", "주문", "내 정보", "신뢰"] },
};

function applyLanguagePack() {
  const lang = i18n.normalizeLanguage(I18N[state.uiLanguage] ? state.uiLanguage : state.uiLanguage || "ZH");
  state.uiLanguage = lang;
  const pack = I18N[lang];
  el.tabs.forEach((tab, idx) => {
    tab.textContent = pack.tabs[idx] || tab.textContent;
  });
  const setText = (node, key) => {
    if (!node) return;
    node.textContent = i18n.t(lang, `ui.${key}`);
  };
  if (el.chatInput) el.chatInput.placeholder = i18n.t(lang, "ui.input_placeholder");
  if (el.chatForm && el.chatForm.querySelector("button[type='submit']")) {
    el.chatForm.querySelector("button[type='submit']").textContent = i18n.t(lang, "ui.send");
  }
  if (el.emergencyBtn) el.emergencyBtn.textContent = i18n.t(lang, "ui.emergency");
  const tag = document.querySelector(".brand p");
  if (tag) tag.textContent = i18n.t(lang, "ui.one_sentence");
  if (el.languageTag) el.languageTag.textContent = i18n.languageName(lang);
  if (el.langSwitch) el.langSwitch.value = lang;
  if (el.myOrdersBtn) {
    el.myOrdersBtn.textContent = pickText("我的订单", "My Orders","マイ注文", "내 주문");
  }
  if (el.langPillLabel) {
    el.langPillLabel.textContent = lang === "ZH" ? "语言" : lang === "ID" ? "Bahasa" : lang === "JA" ? "言語" : lang === "KO" ? "언어" : "Lang";
  }
  if (el.locateBtn) {
    el.locateBtn.textContent = pickText("定位", "Use Location","現在地", "현재 위치");
  }
  if (el.inlineLocateBtn) {
    el.inlineLocateBtn.textContent = pickText("定位", "Locate","現在地", "위치");
  }
  if (el.openOpsBtn) {
    el.openOpsBtn.textContent = pickText("人工后台", "Ops Board","運用ボード", "운영 보드");
  }
  if (el.flowRailTitle) {
    el.flowRailTitle.textContent = pickText("闭环进度", "Closed Loop Progress","クローズドループ進捗", "클로즈 루프 진행");
  }
  if (el.brainTitle) {
    el.brainTitle.textContent = pickText("Agent 智能体", "Agent Brain", "Agent ブレイン", "Agent 브레인");
  }
  if (el.quickGoalsTitle) {
    el.quickGoalsTitle.textContent = pickText("一键目标", "One Tap Goals","ワンタップ目標", "원탭 목표");
  }
  if (el.inputAssistHint) {
    el.inputAssistHint.textContent = pickText(
      "先说一句自然语言目标即可，约束项可按需展开。",
      "Start with one natural-language goal. Expand constraints only if needed.",
      "まずは自然文で1つの目標を入力。条件は必要時のみ展開してください。",
      "자연어 목표 한 문장부터 입력하세요. 조건은 필요할 때만 펼치면 됩니다.",
    );
  }
  setText(el.contextTitle, "context_chips");
  setText(el.contextGlossary, "context_glossary");
  setText(el.recommendedTitle, "recommended_solution");
  setText(el.recommendedSubtitle, "recommended_subtitle");
  setText(el.nearHeading, "near_heading");
  setText(el.nearFiltersHeading, "near_filters");
  setText(el.nearResultsHeading, "near_results");
  setText(el.nearMapHeading, "near_map");
  setText(el.tripsHeading, "trips_heading");
  if (el.tripPlanHeading) {
    el.tripPlanHeading.textContent = pickText("行程计划", "Trip Plans","旅程プラン", "트립 플랜");
  }
  if (el.ordersHeading) {
    el.ordersHeading.textContent = pickText("订单", "Orders","注文", "주문");
  }
  setText(el.mePreferencesHeading, "me_preferences");
  setText(el.plusHeading, "plus_heading");
  setText(el.plusDescription, "plus_description");
  setText(el.paymentLimitsHeading, "payment_limits_heading");
  if (el.llmConnectHeading) el.llmConnectHeading.textContent = pickText("连接 OpenAI", "Connect OpenAI", "OpenAI を接続", "OpenAI 연결");
  if (el.llmConnectDesc) {
    el.llmConnectDesc.textContent = pickText(
      "登录 OpenAI 后粘贴 API Key，即可启用 ChatGPT 动态回复。",
      "Sign in to OpenAI and paste API key to enable ChatGPT dynamic replies.",
      "OpenAI にログインして API キーを貼り付けると ChatGPT 応答を有効化できます。",
      "OpenAI 로그인 후 API 키를 붙여넣으면 ChatGPT 동적 응답을 사용할 수 있습니다.",
    );
  }
  if (el.saveLlmBtn) el.saveLlmBtn.textContent = pickText("保存并测试", "Save & Test","保存してテスト", "저장 후 테스트");
  if (el.openOpenAiBtn) el.openOpenAiBtn.textContent = pickText("打开 OpenAI 登录", "Open OpenAI Login", "OpenAI ログインを開く", "OpenAI 로그인 열기");
  if (el.clearLlmBtn) el.clearLlmBtn.textContent = pickText("清除 Key", "Clear Key","キーを削除", "키 삭제");
  if (el.llmApiKeyInput) el.llmApiKeyInput.placeholder = "sk-...";
  setText(el.trustSummaryHeading, "trust_summary_heading");
  setText(el.authHeading, "auth_heading");
  setText(el.operationHeading, "operation_heading");
  setText(el.privacyHeading, "privacy_heading");
  setText(el.supportHeading, "support_heading");
  setText(el.advancedHeading, "advanced_heading");
  setText(el.humanAssistTitle, "human_assist_heading");
  setText(el.assistOpenSupportBtn, "assist_open_support");
  if (el.assistLiveCallBtn) el.assistLiveCallBtn.textContent = pickText("人工语音会话", "Live Call Room","ライブ会話ルーム", "실시간 상담룸");
  setText(el.assistRefreshBtn, "assist_refresh_status");
  setText(el.savePrefBtn, "save_preferences");
  setText(el.switchModeBtn, "switch_mode");
  setText(el.plusSubscribeBtn, "activate_plus");
  setText(el.plusCancelBtn, "pause_plus");
  setText(el.saveRailBtn, "save_payment_method");
  setText(el.openTrustAdvancedBtn, "open_trust_advanced");
  setText(el.updateAuthBtn, "update_authorization");
  setText(el.exportDataBtn, "export_data");
  setText(el.deleteDataBtn, "delete_data");
  setText(el.probeProvidersBtn, "provider_probe");
  if (el.closeTaskDrawerBtn) el.closeTaskDrawerBtn.textContent = i18n.t(lang, "ui.close");
  if (el.closeReplanBtn) el.closeReplanBtn.textContent = i18n.t(lang, "ui.close");
  if (el.openConditionEditorBtn) el.openConditionEditorBtn.textContent = pickText("条件", "Conditions","条件", "조건");
  if (el.closeConditionEditorBtn) el.closeConditionEditorBtn.textContent = i18n.t(lang, "ui.close");
  if (el.conditionEditorTitle) el.conditionEditorTitle.textContent = pickText("条件编辑器", "Condition Editor","条件エディター", "조건 편집기");
  if (el.closeProofDrawerBtn) el.closeProofDrawerBtn.textContent = i18n.t(lang, "ui.close");
  if (el.closeOrderDrawerBtn) el.closeOrderDrawerBtn.textContent = i18n.t(lang, "ui.close");
  if (el.closeSupportRoomBtn) el.closeSupportRoomBtn.textContent = i18n.t(lang, "ui.close");
  if (el.supportRoomInput) el.supportRoomInput.placeholder = pickText("输入紧急情况或需求，人工坐席会即时处理。", "Describe your urgent need. Live agent will handle it.","緊急内容を入力してください。有人オペレーターが対応します。", "긴급 요청을 입력하세요. 상담원이 바로 처리합니다.");
  if (el.supportRoomSendBtn) el.supportRoomSendBtn.textContent = pickText("发送", "Send","送信", "전송");
  if (el.supportRoomTitle) el.supportRoomTitle.textContent = pickText("人工会话房间", "Live Human Room","有人対応ルーム", "사람 상담 룸");
  if (el.subtabOverview) el.subtabOverview.textContent = pickText("概览", "Overview","概要", "개요");
  if (el.subtabSteps) el.subtabSteps.textContent = pickText("步骤", "Steps","ステップ", "단계");
  if (el.subtabPayments) el.subtabPayments.textContent = pickText("支付", "Payments","支払い", "결제");
  if (el.subtabProof) el.subtabProof.textContent = pickText("凭证", "Proof","証憑", "증빙");
  if (el.previewReplanBtn) el.previewReplanBtn.textContent = pickText("预览", "Preview","プレビュー", "미리보기");
  if (el.saveReplanBtn) el.saveReplanBtn.textContent = pickText("保存计划", "Save Replan","プラン保存", "계획 저장");
  if (el.cancelReplanBtn) el.cancelReplanBtn.textContent = i18n.t(lang, "ui.cancel");
  if (el.replanTitle) el.replanTitle.textContent = pickText("编辑计划", "Edit Plan","プラン編集", "계획 편집");
  if (el.proofDrawerTitle && !el.proofDrawerTitle.dataset.lockedTitle) {
    el.proofDrawerTitle.textContent = pickText("凭证与支持", "Proof & Support","証憑とサポート", "증빙 및 지원");
  }
  if (el.orderDrawerTitle && !el.orderDrawerTitle.dataset.lockedTitle) {
    el.orderDrawerTitle.textContent = pickText("订单详情", "Order Detail","注文詳細", "주문 상세");
  }
  if (el.drawerTitle && !el.drawerTitle.dataset.lockedTitle) {
    el.drawerTitle.textContent = pickText("任务详情", "Task Detail","タスク詳細", "작업 상세");
  }
  if (el.prefDietaryInput) el.prefDietaryInput.placeholder = i18n.t(lang, "ui.placeholder_dietary_pref");
  if (el.prefHotelInput) el.prefHotelInput.placeholder = i18n.t(lang, "ui.placeholder_hotel");
  if (el.prefOfficeInput) el.prefOfficeInput.placeholder = i18n.t(lang, "ui.placeholder_office");
  if (el.prefAirportInput) el.prefAirportInput.placeholder = i18n.t(lang, "ui.placeholder_airport");
  if (el.replanDietaryInput) el.replanDietaryInput.placeholder = i18n.t(lang, "ui.placeholder_replan_dietary");
  if (el.tripTitleInput) {
    el.tripTitleInput.placeholder = pickText("例如：上海商务接待日", "e.g. Shanghai Business Day","例: 上海ビジネスデー", "예: 상하이 비즈니스 데이");
  }
  if (el.tripCityInput) {
    el.tripCityInput.placeholder = pickText("城市", "City","都市", "도시");
    if (!el.tripCityInput.value) el.tripCityInput.value = getCurrentCity();
  }
  if (el.tripNoteInput) {
    el.tripNoteInput.placeholder = pickText("例如：接机 + 晚餐 + 酒店", "e.g. airport pickup + dinner + hotel","例: 空港迎え + 夕食 + ホテル", "예: 공항 픽업 + 저녁 + 호텔");
  }
  if (el.createTripBtn) {
    el.createTripBtn.textContent = pickText("创建行程", "Create Trip Plan","旅程を作成", "트립 생성");
  }
  refreshI18nMessagesInChat();
  renderQuickGoals();
  renderVoiceControls();
  renderSupportRoomVoiceButton();
  if (state.voice.recognition) {
    state.voice.recognition.lang = speechLocaleForLang(lang);
  }
  renderFlowRail();
  renderAgentBrain(state.currentTask);
  renderAgentInputDeck();
  if (el.llmStatusText && !String(el.llmStatusText.textContent || "").trim()) {
    renderLlmRuntimeStatus({
      configured: false,
      keyHealth: { looksValid: false, reason: "" },
      lastRuntime: { lastError: "", errorAt: null },
    });
  }
  if (state.agentConversation.mode && state.agentConversation.mode !== "idle") {
    rerenderAgentFlowCards();
  }
  renderActiveTripHint();
  applySingleDialogMode();
  toggleConstraintPanel(state.constraintsExpanded);
  if (state.supportRoom.activeSessionId) {
    loadSupportRoomSession(state.supportRoom.activeSessionId).catch(() => {});
  }
  if (store) store.dispatch({ type: "SET_LANGUAGE", language: lang });

  // Smooth fade-in on static UI labels after text swap
  _triggerLangFade();
}

/** Brief opacity fade on key UI panels to make text swaps feel fluid. */
function _triggerLangFade() {
  const targets = [
    el.chatInput?.closest("form"),
    document.querySelector(".nav-tabs, .tab-bar, [role='tablist']"),
    document.querySelector(".brand"),
    document.querySelector(".quick-goals-panel, .quick-goals"),
  ].filter(Boolean);

  targets.forEach((t) => {
    t.classList.remove("cx-lang-anim");
    // Double rAF ensures the class removal is painted before re-adding
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add("cx-lang-anim")));
  });
}

function refreshI18nMessagesInChat() {
  if (!el.chatFeed) return;
  normalizeWelcomeMessageRow();
  const rows = [...el.chatFeed.querySelectorAll(".msg[data-i18n-key]")];
  for (const row of rows) {
    const key = row.dataset.i18nKey;
    const bubble = row.querySelector(".bubble");
    if (!bubble || !key) continue;
    const nextText = getSystemMessageByKey(key);
    if (nextText) bubble.textContent = nextText;
  }
}

function addMessage(text, who = "agent", options = null) {
  const opts = options || {};
  const row = document.createElement("div");
  row.className = `msg ${who}`;
  if (opts.i18nKey) row.dataset.i18nKey = String(opts.i18nKey);
  row.innerHTML = `<span class="bubble">${escapeHtml(text)}</span>`;
  el.chatFeed.appendChild(row);
  motion.enter(row, { duration: 160, fromY: 8 });
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
  pulseConversationAura();
  if (who === "agent" && opts.speak !== false) {
    speakAssistantMessage(text);
  }
  return row;
}

function notificationTextByLang(item) {
  const lang = state.uiLanguage || "EN";
  if (lang === "ZH") return String(item.message || item.messageEn || "");
  if (lang === "JA") return String(item.messageJa || item.messageEn || item.message || "");
  if (lang === "KO") return String(item.messageKo || item.messageEn || item.message || "");
  return String(item.messageEn || item.message || "");
}

async function pullChatNotifications() {
  const query = state.chatNoticeSince ? `?since=${encodeURIComponent(state.chatNoticeSince)}` : "";
  const data = await api(`/api/chat/notifications${query}`);
  const list = Array.isArray(data.notifications) ? data.notifications : [];
  if (!list.length) return;
  for (const item of list) {
    const text = notificationTextByLang(item).trim();
    if (!text) continue;
    addMessage(
      pickText(
        `订单通知：${text}`,
        `Order update: ${text}`,
        `注文通知: ${text}`,
        `주문 알림: ${text}`,
      ),
      "agent",
      { speak: false },
    );
    state.chatNoticeSince = String(item.at || data.now || new Date().toISOString());
  }
}

function startChatNotificationTicker() {
  if (state.chatNoticeTicker) {
    clearInterval(state.chatNoticeTicker);
    state.chatNoticeTicker = null;
  }
  pullChatNotifications().catch(() => {});
  state.chatNoticeTicker = setInterval(() => {
    pullChatNotifications().catch(() => {});
  }, 12000);
}

function addCard(html) {
  const wrap = document.createElement("div");
  wrap.innerHTML = html;
  const card = wrap.firstElementChild;
  el.chatFeed.appendChild(card);
  motion.enter(card, { duration: 180, fromY: 10 });
  motion.bindPressables(card);
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
  pulseConversationAura();
}

function renderTaskSkeletonCards() {
  const id = `task-sk-${Date.now().toString(36)}`;
  const wrap = document.createElement("div");
  wrap.className = "task-skeleton-wrap";
  wrap.dataset.skeletonId = id;
  wrap.innerHTML = `
    <article class="card skeleton-card">
      <span class="skeleton-title"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line"></span>
    </article>
    <article class="card skeleton-card">
      <span class="skeleton-title"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line"></span>
      <span class="skeleton-line"></span>
    </article>
  `;
  el.chatFeed.appendChild(wrap);
  motion.enter(wrap, { duration: 140, fromY: 6 });
  el.chatFeed.scrollTop = el.chatFeed.scrollHeight;
  return id;
}

function clearTaskSkeletonCards(id) {
  if (!id) return;
  const node = el.chatFeed.querySelector(`[data-skeleton-id="${id}"]`);
  if (!node) return;
  node.remove();
}

function getTicketById(ticketId) {
  if (!ticketId) return null;
  const tickets = Array.isArray(state.supportTickets) ? state.supportTickets : [];
  return tickets.find((t) => t.id === ticketId) || null;
}

async function loadTicketById(ticketId) {
  if (!ticketId) return null;
  const ticket = getTicketById(ticketId);
  if (ticket) return ticket;
  const data = await api("/api/support/tickets");
  state.supportTickets = Array.isArray(data.tickets) ? data.tickets : [];
  return getTicketById(ticketId);
}

async function renderSupportTicketDrawer(ticketId, trigger = null) {
  if (!ticketId || !el.proofDrawerBody) return;
  const ticket = await loadTicketById(ticketId);
  if (!ticket) {
    notify(
      pickText("未找到该工单。", "Ticket not found.","チケットが見つかりません。", "티켓을 찾을 수 없습니다."),
      "warning",
    );
    return;
  }
  const history = Array.isArray(ticket.history) ? ticket.history : [];
  const evidence = Array.isArray(ticket.evidence) ? ticket.evidence : [];
  const timelineRows = history.length
    ? history
        .map(
          (item) => `
      <li>
        <strong>${escapeHtml(localizeStatus(item.status || "open"))}</strong>
        <span class="status">${new Date(item.at || ticket.updatedAt || ticket.createdAt).toLocaleString()}</span>
        <div class="status">${escapeHtml(item.note || "-")}</div>
      </li>
    `,
        )
        .join("")
    : `<li>${pickText("暂无时间线记录。", "No timeline yet.","タイムラインはまだありません。", "타임라인 기록이 없습니다.")}</li>`;
  const evidenceRows = evidence.length
    ? evidence
        .map(
          (item) => `
      <li>
        <strong>${escapeHtml(item.type || "evidence")}</strong>
        <span class="status">${new Date(item.at || ticket.updatedAt || ticket.createdAt).toLocaleString()} · ${escapeHtml(item.hash || "-")}</span>
        <div class="status">${escapeHtml(item.note || "-")}</div>
      </li>
    `,
        )
        .join("")
    : `<li>${pickText("暂无证据材料。", "No evidence yet.","証拠はまだありません。", "증빙이 아직 없습니다.")}</li>`;

  const taskAction = ticket.taskId
    ? `<button class="secondary" data-action="open-task" data-task="${escapeHtml(ticket.taskId)}">${pickText("打开关联任务", "Open linked task","関連タスクを開く", "연결 작업 열기")}</button>`
    : "";

  el.proofDrawerBody.innerHTML = `
    <article class="card">
      <h3>${pickText("工单概览", "Ticket Overview","チケット概要", "티켓 개요")}</h3>
      <div>${pickText("工单号", "Ticket ID","チケットID", "티켓 ID")}: <span class="code">${escapeHtml(ticket.id)}</span></div>
      <div>${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${escapeHtml(ticket.status || "open")}">${escapeHtml(localizeStatus(ticket.status || "open"))}</span></div>
      <div class="status">${pickText("处理方", "Handler","担当", "담당")}: ${escapeHtml(ticket.handler || "human")} · ${pickText("来源", "Source","ソース", "소스")}: ${escapeHtml(ticket.source || "-")}</div>
      <div class="status eta-live" data-created-at="${escapeHtml(ticket.createdAt || ticket.updatedAt || new Date().toISOString())}" data-eta-min="${Number(ticket.etaMin || 0)}"></div>
      <div class="status">${pickText("原因", "Reason","理由", "사유")}: ${escapeHtml(ticket.reason || "-")}</div>
      <div class="actions">
        ${ticket.status === "open" ? `<button class="secondary" data-action="ticket-progress" data-ticket="${escapeHtml(ticket.id)}">${pickText("转处理中", "Mark In Progress","対応中にする", "처리중으로 변경")}</button>` : ""}
        ${ticket.status === "in_progress" ? `<button class="secondary" data-action="ticket-resolve" data-ticket="${escapeHtml(ticket.id)}">${pickText("标记已解决", "Mark Resolved","解決済みにする", "해결 완료로 변경")}</button>` : ""}
        <button class="secondary" data-action="open-live-support" data-ticket="${escapeHtml(ticket.id)}">${pickText("进入实时会话", "Open Live Room","ライブ会話を開く", "실시간 상담 열기")}</button>
        <button class="secondary" data-action="ticket-evidence" data-ticket="${escapeHtml(ticket.id)}">${pickText("补充证据", "Add Evidence","証拠を追加", "증빙 추가")}</button>
        <button class="secondary" data-action="refresh-ticket-detail" data-ticket="${escapeHtml(ticket.id)}">${pickText("刷新工单", "Refresh Ticket","チケット更新", "티켓 새로고침")}</button>
        ${taskAction}
      </div>
    </article>
    <article class="card">
      <h3>${pickText("处理时间线", "Timeline","対応タイムライン", "처리 타임라인")}</h3>
      <ul class="steps">${timelineRows}</ul>
    </article>
    <article class="card">
      <h3>${pickText("证据材料", "Evidence","証拠", "증빙 자료")}</h3>
      <ul class="steps">${evidenceRows}</ul>
    </article>
  `;
  if (el.proofDrawerTitle) {
    el.proofDrawerTitle.dataset.lockedTitle = "true";
    el.proofDrawerTitle.textContent = `${pickText("工单详情", "Ticket Detail","チケット詳細", "티켓 상세")} · ${ticket.id}`;
  }
  if (el.proofDrawer) {
    el.proofDrawer.dataset.ticketId = ticket.id;
  }
  updateSupportEtaCountdown();
  if (drawerController) drawerController.open(el.proofDrawer, { trigger: trigger || undefined });
}

function supportRoomStatusMeta(status) {
  const raw = String(status || "waiting").toLowerCase();
  if (raw === "active") {
    return {
      badge: "running",
      label: pickText("已接入", "Live","接続中", "연결됨"),
    };
  }
  if (raw === "closed") {
    return {
      badge: "success",
      label: pickText("已关闭", "Closed","クローズ済み", "종료됨"),
    };
  }
  return {
    badge: "queued",
    label: pickText("等待接入", "Waiting","待機中", "대기중"),
  };
}

function supportRoomVoiceButtonText() {
  if (state.supportRoom.recording) {
    return pickText("停止并发送语音", "Stop & Send Voice","停止して送信", "중지 후 음성 전송");
  }
  return pickText("语音呼叫", "Voice Talk","音声通話", "음성 통화");
}

function renderSupportRoomVoiceButton() {
  if (!el.supportRoomVoiceBtn) return;
  const mediaSupported =
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
  el.supportRoomVoiceBtn.disabled = !mediaSupported;
  el.supportRoomVoiceBtn.setAttribute("aria-pressed", state.supportRoom.recording ? "true" : "false");
  el.supportRoomVoiceBtn.textContent = mediaSupported
    ? supportRoomVoiceButtonText()
    : pickText("浏览器不支持语音", "Voice Unsupported","音声未対応", "음성 미지원");
}

function stopSupportRoomPolling() {
  if (state.supportRoom.pollTicker) {
    clearInterval(state.supportRoom.pollTicker);
    state.supportRoom.pollTicker = null;
  }
}

async function stopSupportRoomRecorder(send = false) {
  const recorder = state.supportRoom.recorder;
  if (!recorder) return;
  if (send && recorder.state === "recording") {
    recorder.stop();
    return;
  }
  if (recorder.state === "recording") {
    try {
      recorder.stop();
    } catch {
      // ignore
    }
  }
  if (state.supportRoom.stream) {
    state.supportRoom.stream.getTracks().forEach((track) => track.stop());
    state.supportRoom.stream = null;
  }
  state.supportRoom.recorder = null;
  state.supportRoom.chunks = [];
  state.supportRoom.recording = false;
  state.supportRoom.recordingStartedAt = 0;
  renderSupportRoomVoiceButton();
}

async function setSupportRoomPresence(online) {
  const sessionId = state.supportRoom.activeSessionId;
  if (!sessionId) return;
  try {
    await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/presence`, {
      method: "POST",
      body: JSON.stringify({ actor: "user", online: online === true }),
    });
  } catch {
    // ignore presence failure
  }
}

function updateSupportRoomTicketState(ticket) {
  if (!ticket || !ticket.id) return;
  const list = Array.isArray(state.supportTickets) ? state.supportTickets : [];
  const idx = list.findIndex((item) => item.id === ticket.id);
  if (idx >= 0) {
    list[idx] = { ...list[idx], ...ticket };
  } else {
    list.unshift(ticket);
    state.supportTickets = list.slice(0, 40);
  }
}

function renderSupportRoomSession(session, ticket = null) {
  if (!el.supportRoomMessages || !el.supportRoomMeta || !el.supportRoomStatus || !el.supportRoomTitle) return;
  const summary = session || {};
  const statusMeta = supportRoomStatusMeta(summary.status || "waiting");
  el.supportRoomStatus.className = `status-badge ${statusMeta.badge}`;
  el.supportRoomStatus.textContent = statusMeta.label;
  const roomTitleTicket = summary.ticketId || (ticket && ticket.id) || state.supportRoom.activeTicketId || "-";
  el.supportRoomTitle.textContent = `${pickText("人工会话房间", "Live Human Room","有人対応ルーム", "사람 상담 룸")} · ${roomTitleTicket}`;
  const opsOnline = summary.presence && summary.presence.ops && summary.presence.ops.online;
  const userUnread = summary.unread ? Number(summary.unread.user || 0) : 0;
  const opsName =
    (summary.assignedAgentName && String(summary.assignedAgentName).trim()) ||
    (opsOnline ? pickText("人工坐席在线", "Ops online","オペレーター在線", "상담원 온라인") : pickText("等待人工接入", "Waiting for ops","オペレーター待機", "상담원 대기"));
  el.supportRoomMeta.textContent = pickText(
    `工单 ${roomTitleTicket} · ${opsName} · ${userUnread > 0 ? `未读 ${userUnread}` :"无未读"}`,
    `Ticket ${roomTitleTicket} · ${opsName} · ${userUnread > 0 ? `${userUnread} unread` : "no unread"}`,
    `チケット ${roomTitleTicket} · ${opsName} · ${userUnread > 0 ? `未読 ${userUnread}` :"未読なし"}`,
    `티켓 ${roomTitleTicket} · ${opsName} · ${userUnread > 0 ? `읽지 않음 ${userUnread}` : "읽지 않음 없음"}`,
  );

  const messages = Array.isArray(summary.messages) ? summary.messages : [];
  if (!messages.length) {
    el.supportRoomMessages.innerHTML = `<div class="support-room-empty">${pickText("房间已创建，可发送文本或语音。", "Room is ready. Send text or voice.","ルーム作成済み。テキスト/音声を送信できます。", "룸이 준비되었습니다. 텍스트/음성을 보낼 수 있습니다.")}</div>`;
    return;
  }

  el.supportRoomMessages.innerHTML = messages
    .map((item) => {
      const actor = String(item.actor || "system");
      const roleLabel =
        actor === "user"
          ? pickText("我", "You","あなた", "나")
          : actor === "ops"
            ? pickText("人工坐席", "Support Agent","有人オペレーター", "상담원")
            : pickText("系统", "System","システム", "시스템");
      const text = item.text ? `<div class="support-room-text">${escapeHtml(item.text)}</div>` : "";
      const voice = item.type === "voice" && item.audioDataUrl
        ? `<audio controls preload="none" src="${escapeHtml(item.audioDataUrl)}"></audio>
           <div class="status">${pickText("语音时长", "Voice duration","音声長さ", "음성 길이")}: ${Number(item.durationSec || 0)}s</div>`
        : "";
      return `
        <article class="support-room-msg ${escapeHtml(actor)}">
          <div class="support-room-msg-head">
            <strong>${escapeHtml(roleLabel)}</strong>
            <span class="status">${new Date(item.at || Date.now()).toLocaleTimeString()}</span>
          </div>
          ${text}
          ${voice}
        </article>
      `;
    })
    .join("");
  el.supportRoomMessages.scrollTop = el.supportRoomMessages.scrollHeight;
}

async function loadSupportRoomSession(sessionId) {
  if (!sessionId) return null;
  const data = await api(`/api/support/sessions/${encodeURIComponent(sessionId)}?actor=user`);
  const summary = data && data.session ? data.session : null;
  const ticket = data && data.ticket ? data.ticket : null;
  if (ticket) updateSupportRoomTicketState(ticket);
  if (summary) {
    state.supportRoom.activeSessionId = summary.id || sessionId;
    state.supportRoom.activeTicketId = summary.ticketId || (ticket && ticket.id) || state.supportRoom.activeTicketId;
    renderSupportRoomSession(summary, ticket);
    renderHumanAssistDock();
  }
  return { summary, ticket };
}

function startSupportRoomPolling(sessionId) {
  stopSupportRoomPolling();
  if (!sessionId) return;
  state.supportRoom.pollTicker = setInterval(() => {
    const current = state.supportRoom.activeSessionId;
    if (!current || current !== sessionId) return;
    loadSupportRoomSession(current).catch(() => {});
  }, 3200);
}

async function openSupportRoomBySession(sessionId, trigger = null) {
  if (!sessionId || !el.supportRoomDrawer || state.supportRoom.opening) return;
  state.supportRoom.opening = true;
  try {
    state.supportRoom.activeSessionId = sessionId;
    if (drawerController) {
      await drawerController.open(el.supportRoomDrawer, { trigger: trigger || null });
    } else {
      el.supportRoomDrawer.classList.remove("hidden");
      el.supportRoomDrawer.setAttribute("aria-hidden", "false");
    }
    await setSupportRoomPresence(true);
    await loadSupportRoomSession(sessionId);
    startSupportRoomPolling(sessionId);
    setLoopProgress("support");
  } finally {
    state.supportRoom.opening = false;
  }
}

async function openSupportRoomByTicket(ticketId, trigger = null, opts = {}) {
  if (!ticketId) return;
  const ticket = await loadTicketById(ticketId);
  let sessionId = ticket && ticket.sessionId ? ticket.sessionId : "";
  if (!sessionId) {
    const start = await api("/api/support/sessions/start", {
      method: "POST",
      body: JSON.stringify({
        ticketId,
        actor: "user",
        urgent: opts.urgent === true,
        reason: opts.reason || "open_live_room",
      }),
    });
    if (start && start.ticket) updateSupportRoomTicketState(start.ticket);
    sessionId = start && start.session ? start.session.id : "";
  }
  if (!sessionId) {
    notify(pickText("无法创建人工会话。", "Failed to open live support room.","有人ルームを作成できませんでした。", "실시간 상담 룸을 열 수 없습니다."), "error");
    return;
  }
  await openSupportRoomBySession(sessionId, trigger);
}

async function closeSupportRoom() {
  stopSupportRoomPolling();
  await stopSupportRoomRecorder(false);
  await setSupportRoomPresence(false);
  if (drawerController && el.supportRoomDrawer) {
    await drawerController.close(el.supportRoomDrawer);
  } else if (el.supportRoomDrawer) {
    el.supportRoomDrawer.classList.add("hidden");
    el.supportRoomDrawer.setAttribute("aria-hidden", "true");
  }
  state.supportRoom.activeSessionId = "";
  state.supportRoom.activeTicketId = "";
  if (el.supportRoomMessages) el.supportRoomMessages.innerHTML = "";
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read audio data"));
    reader.readAsDataURL(blob);
  });
}

async function sendSupportRoomTextMessage(text) {
  const sessionId = state.supportRoom.activeSessionId;
  if (!sessionId) {
    notify(pickText("请先开启人工会话。", "Open live support room first.","先に有人会話を開いてください。", "먼저 실시간 상담 룸을 여세요."), "warning");
    return;
  }
  const message = String(text || "").trim();
  if (!message) return;
  await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/messages`, {
    method: "POST",
    body: JSON.stringify({
      actor: "user",
      type: "text",
      text: message,
    }),
  });
  await loadSupportRoomSession(sessionId);
}

async function toggleSupportRoomVoiceRecording() {
  const sessionId = state.supportRoom.activeSessionId;
  if (!sessionId) {
    notify(pickText("请先开启人工会话。", "Open live support room first.","先に有人会話を開いてください。", "먼저 실시간 상담 룸을 여세요."), "warning");
    return;
  }
  if (state.supportRoom.recording && state.supportRoom.recorder) {
    try {
      state.supportRoom.recorder.stop();
    } catch {
      // ignore
    }
    return;
  }
  if (typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    notify(pickText("当前浏览器不支持语音上传。", "Voice upload is not supported in this browser.","このブラウザは音声アップロード非対応です。", "현재 브라우저는 음성 업로드를 지원하지 않습니다."), "warning");
    return;
  }
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream);
  state.supportRoom.stream = stream;
  state.supportRoom.recorder = recorder;
  state.supportRoom.chunks = [];
  state.supportRoom.recording = true;
  state.supportRoom.recordingStartedAt = Date.now();
  renderSupportRoomVoiceButton();

  recorder.ondataavailable = (event) => {
    if (event && event.data && event.data.size > 0) {
      state.supportRoom.chunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    try {
      const blob = new Blob(state.supportRoom.chunks, { type: recorder.mimeType || "audio/webm" });
      const durationSec = Math.max(1, Math.round((Date.now() - (state.supportRoom.recordingStartedAt || Date.now())) / 1000));
      const dataUrl = await blobToDataUrl(blob);
      await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        body: JSON.stringify({
          actor: "user",
          type: "voice",
          audioDataUrl: dataUrl,
          durationSec,
        }),
      });
      await loadSupportRoomSession(sessionId);
      notify(pickText("语音已发送到人工会话。", "Voice message sent to live support.","音声を有人会話へ送信しました。", "음성 메시지를 상담 룸으로 전송했습니다."), "success");
    } catch (err) {
      notify(
        pickText(`语音发送失败：${err.message}`, `Voice send failed: ${err.message}`, `音声送信失敗: ${err.message}`, `음성 전송 실패: ${err.message}`),
        "error",
      );
    } finally {
      if (state.supportRoom.stream) {
        state.supportRoom.stream.getTracks().forEach((track) => track.stop());
      }
      state.supportRoom.stream = null;
      state.supportRoom.recorder = null;
      state.supportRoom.chunks = [];
      state.supportRoom.recording = false;
      state.supportRoom.recordingStartedAt = 0;
      renderSupportRoomVoiceButton();
    }
  };

  recorder.start();
  notify(pickText("开始录音，再次点击结束并发送。", "Recording started. Tap again to stop and send.","録音を開始しました。もう一度押して送信。", "녹음을 시작했습니다. 다시 눌러 전송하세요."), "info");
}

function removeTaskCards(taskId) {
  if (!taskId) return;
  const plan = document.getElementById(`plan-${taskId}`);
  const confirm = document.getElementById(`confirm-${taskId}`);
  if (plan) plan.remove();
  if (confirm) confirm.remove();
}

function getPreferredLanguage() {
  if (state.uiLanguage === "ZH") return "ZH";
  if (state.uiLanguage === "JA") return "JA";
  if (state.uiLanguage === "KO") return "KO";
  return "EN";
}

function pickTemplateIntent(template) {
  const lang = getPreferredLanguage();
  if (!template || !template.intent) return "";
  return template.intent[lang] || template.intent.EN || "";
}

function setReplanField(name, value) {
  if (!el.replanForm) return;
  const field = el.replanForm.elements.namedItem(name);
  if (field && "value" in field) field.value = value;
}

function clearReplanPreview() {
  if (el.replanPreview) el.replanPreview.innerHTML = "";
}

function renderReplanPreview(preview) {
  if (!el.replanPreview) return;
  if (!preview) {
    el.replanPreview.innerHTML = "";
    return;
  }
  const c = preview.constraints || {};
  const m = preview.mcpSummary || {};
  el.replanPreview.innerHTML = `
    <article class="card">
      <h3>${pickText("预览", "Preview","プレビュー", "미리보기")}</h3>
      <div>${pickText("类型", "Type","タイプ", "유형")}: <strong>${escapeHtml(preview.intentType || "-")}</strong> · ${pickText("步骤", "Steps","ステップ", "단계")}: ${Number(preview.stepCount || 0)}</div>
      <div class="status">${pickText("预估金额", "Estimated amount","見積金額", "예상 금액")}: ${Number((preview.confirm && preview.confirm.amount) || 0)} ${escapeHtml((preview.confirm && preview.confirm.currency) || "CNY")}</div>
      <div class="status">${pickText("支付通道", "Payment rail","決済レール", "결제 레일")}: ${escapeHtml(preview.paymentRail || "-")}</div>
      <div class="status">${pickText("原因说明", "Reasoning","理由", "근거")}: ${escapeHtml(preview.reasoning || "-")}</div>
      <div class="status">${pickText("约束", "Constraints","制約", "제약")}: budget ${escapeHtml(c.budget || "-")}, distance ${escapeHtml(c.distance || "-")}, time ${escapeHtml(c.time || "-")}</div>
      <div class="status">MCP: ${escapeHtml(m.query || "-")} -> ${escapeHtml(m.book || "-")} -> ${escapeHtml(m.pay || "-")} -> ${escapeHtml(m.status || "-")}</div>
    </article>
  `;
}

function readReplanPayload() {
  if (!el.replanForm) return null;
  const form = new FormData(el.replanForm);
  const taskId = String(form.get("taskId") || state.replanTaskId || "").trim();
  const intent = String(form.get("intent") || "").trim();
  if (!taskId || !intent) return null;
  return {
    taskId,
    intent,
    constraints: {
      budget: String(form.get("budget") || "mid"),
      distance: String(form.get("distance") || "walk"),
      time: String(form.get("time") || "soon"),
      dietary: String(form.get("dietary") || ""),
      family: String(form.get("family") || "false") === "true",
      accessibility: String(form.get("accessibility") || "optional"),
      city: String(form.get("city") || "Shanghai"),
      origin: String(form.get("origin") || ""),
      destination: String(form.get("destination") || ""),
    },
  };
}

function applyReplanTemplate(templateId) {
  const template = REPLAN_TEMPLATES[templateId];
  if (!template) return;
  const c = template.constraints || {};
  setReplanField("intent", pickTemplateIntent(template));
  setReplanField("budget", c.budget || "mid");
  setReplanField("distance", c.distance || "walk");
  setReplanField("time", c.time || "soon");
  setReplanField("dietary", c.dietary || "");
  setReplanField("family", String(c.family === true));
  setReplanField("accessibility", c.accessibility || "optional");
  setReplanField("city", c.city || "Shanghai");
  setReplanField("origin", c.origin || "");
  setReplanField("destination", c.destination || "");
  clearReplanPreview();
  if (el.replanHint) el.replanHint.textContent = `Template applied: ${templateId}`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "API error");
  return data;
}

async function trackEvent(kind, meta = {}, taskId = null) {
  try {
    await api("/api/metrics/events", {
      method: "POST",
      body: JSON.stringify({ kind, userId: "demo", taskId, meta }),
    });
  } catch {
    // no-op
  }
}

function shouldRenderExecutionCards() {
  return true;
}

function clearChatCards(options = {}) {
  if (!el.chatFeed) return;
  const keepDeliverable = options.keepDeliverable !== false;
  const keepSmartReply = options.keepSmartReply === true;
  const cards = [...el.chatFeed.querySelectorAll("article.card")];
  for (const card of cards) {
    if (keepDeliverable && card.classList.contains("deliverable-card")) continue;
    if (keepSmartReply && card.classList.contains("smart-reply-card")) continue;
    card.remove();
  }
}

function renderPlanCard(task) {
  if (!shouldRenderExecutionCards()) return;
  const currentStep = (task.steps || task.plan.steps || []).find((item) => item.status === "running");
  const steps = (task.steps && task.steps.length ? task.steps : task.plan.steps)
    .map(
      (s) => `
      <li class="step-line status-${escapeHtml(s.status)} ${s.status === "running" ? "is-current" : ""}">
        <div class="step-head">
          <span class="step-glyph">${statusGlyph(s.status)}</span>
          <strong>${escapeHtml(s.label)}</strong>
          <span class="status-badge ${escapeHtml(s.status)}">${escapeHtml(localizeStatus(s.status))}</span>
        </div>
        <div class="status">${tUi("step_tool")} ${escapeHtml(s.toolType)} · ETA ${Math.max(1, Math.ceil(Number(s.etaSec || 0) / 60))} min · ${escapeHtml(s.inputSchema)}</div>
        <div class="status">${tUi("step_input")}: ${escapeHtml(s.inputPreview || "pending")}</div>
        <div class="status">${tUi("step_output")}: ${escapeHtml(s.outputPreview || "pending")}</div>
        <div class="status">${tUi("step_fallback")}: ${escapeHtml(s.fallbackPolicy || "none")}</div>
        ${s.status === "failed" ? `<div class="status step-error">${tUi("step_failure_reason")}: ${escapeHtml(getStepFailureReason(s))}</div>` : ""}
        <div class="actions">
          <button class="secondary" data-action="retry-step" data-task="${task.id}" data-step="${escapeHtml(s.id)}">${pickText("重试这一步", "Retry this step","このステップを再試行", "이 단계 재시도")}</button>
          <button class="secondary" data-action="switch-lane" data-task="${task.id}" data-step="${escapeHtml(s.id)}">${pickText("切换路线", "Switch lane","ルート切替", "경로 전환")}</button>
          <button class="secondary" data-action="request-handoff" data-task="${task.id}">${pickText("人工接管", "Ask human","有人対応", "사람 상담")}</button>
          <button class="secondary" data-action="show-refund-policy" data-task="${task.id}">${pickText("退款规则", "Refund policy","返金ポリシー", "환불 정책")}</button>
        </div>
      </li>
    `,
    )
    .join("");
  const total = task.plan.steps.length;
  const done = (task.steps || task.plan.steps || []).filter((s) => s.status === "success").length;
  const percent = total ? Math.round((done / total) * 100) : 0;
  const etaMin = Math.max(2, Math.ceil((task.plan.steps || []).reduce((sum, s) => sum + Number(s.etaSec || 0), 0) / 60));

  addCard(`
    <article class="card" id="plan-${task.id}">
      <h3>${escapeHtml(tTerm("plan"))} Card</h3>
      <div>${pickText("我将为你完成", "I will complete","実行する内容", "실행 내용")}: <strong>${escapeHtml(task.plan.title)}</strong></div>
      <div class="status">${pickText("预计耗时", "ETA","推定時間", "예상 시간")}: ${etaMin} ${pickText("分钟", "min","分", "분")} · ${pickText("预估成功率", "Success","成功率見込み", "예상 성공률")}: 88-95%</div>
      <div class="status">${pickText("风险", "Risk","リスク", "리스크")}: ${escapeHtml(task.plan.confirm && task.plan.confirm.alternative ? task.plan.confirm.alternative : pickText("高峰期可能排队波动", "Queue fluctuation at peak","ピーク時は待ち時間が変動", "피크 시간 대기열 변동 가능"))}</div>
      <div class="status">${pickText("为什么这样做", "Why","選択理由", "선정 이유")}: ${escapeHtml(task.plan.reasoning || pickText("基于成本、时间和成功率做出选择。", "Based on cost, time and confidence.","コスト・時間・成功率を基に判断。", "비용·시간·성공률을 기반으로 선택했습니다."))}</div>
      <div class="status">${pickText("进度", "Progress","進捗", "진행")}: ${done}/${total} · ${percent}%</div>
      <div class="status">${tUi("step_current")}: ${escapeHtml((currentStep && currentStep.label) || pickText("等待开始", "Waiting to start","開始待ち", "시작 대기"))}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${percent}%;"></div></div>
      <details open class="plan-details">
        <summary>${pickText("执行步骤", "Execution steps","実行ステップ", "실행 단계")} (${task.plan.steps.length})</summary>
        <ol class="steps">${steps}</ol>
      </details>
      <div class="actions">
        <button class="secondary" data-action="open-task" data-task="${task.id}">${pickText("查看详情", "View detail","詳細", "상세 보기")}</button>
        <button class="secondary" data-action="edit-plan" data-task="${task.id}">${pickText("编辑计划", "Edit plan","プラン編集", "계획 편집")}</button>
        <button class="secondary" data-action="pause-plan" data-task="${task.id}">${pickText("暂停", "Pause","一時停止", "일시중지")}</button>
        <button class="secondary" data-action="resume-plan" data-task="${task.id}">${pickText("继续", "Resume","再開", "재개")}</button>
        <button class="secondary" data-action="cancel-task" data-task="${task.id}">${pickText("取消", "Cancel","キャンセル", "취소")}</button>
      </div>
    </article>
  `);
}

function renderConfirmCard(task) {
  if (!shouldRenderExecutionCards()) return;
  const c = task.plan.confirm;
  const flags = c.riskFlags.map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  const pricing = c.pricing || {};
  const breakdown = c.breakdown || {};
  const guarantee = c.guarantee || {};
  const deliverables = (c.deliverables || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const merchantFee = Number(breakdown.merchantFee || pricing.netPrice || 0);
  const serviceFee = Number(breakdown.serviceFee || pricing.markup || 0);
  const thirdPartyFee = Number(breakdown.thirdPartyFee || 0);
  const fxFee = Number(breakdown.fxFee || 0);
  const total = Number(c.amount || breakdown.total || 0);
  const totalFees = merchantFee + serviceFee + thirdPartyFee + fxFee;
  const consents = getConsentItems(c)
    .map(
      (item) => `
        <label class="consent-row">
          <input type="checkbox" data-consent="${escapeHtml(item.key)}" data-required="${item.required ? "1" : "0"}" />
          <span>${escapeHtml(item.label)}</span>
        </label>
      `,
    )
    .join("");

  addCard(`
    <article class="card" id="confirm-${task.id}">
      <h3>${pickText("确认卡", "Confirm Card","確認カード", "확인 카드")}</h3>
      <div class="status">${pickText("为什么需要你确认", "Why confirmation is required","確認が必要な理由", "확인이 필요한 이유")}: ${escapeHtml(c.confirmReason || pickText("因为将执行支付/定位/委托动作，需要你的明确同意。", "We need your explicit consent for payment/location/delegation actions.","支払い/位置情報/委任操作を実行するため、明示的な同意が必要です。", "결제/위치/위임 작업을 실행하기 위해 명시적 동의가 필요합니다."))}</div>
      <article class="inline-block">
        <h3>${pickText("你将获得", "You will get","取得内容", "제공 항목")}</h3>
        <ul class="steps">${deliverables || `<li>${pickText("预订结果 + 凭证包", "Reservation + proof bundle","予約結果 + 証憑セット", "예약 결과 + 증빙 번들")}</li>`}</ul>
      </article>
      <article class="inline-block">
        <h3>${pickText("费用明细", "Fee breakdown","料金内訳", "요금 상세")}</h3>
        <div>${pickText("总计", "Total","合計", "총액")}: <strong>${total.toFixed(2)} ${escapeHtml(c.currency)}</strong> (${escapeHtml(c.chargeType || "charge")})</div>
        <details class="confirm-breakdown">
          <summary>${pickText("展开费用明细", "Expand fee breakdown","料金内訳を展開", "요금 내역 펼치기")}</summary>
          <div>${pickText("商家费用", "Merchant fee","加盟店料金", "가맹점 요금")}: ${merchantFee.toFixed(2)} ${escapeHtml(c.currency)}</div>
          <div>Cross X ${pickText("服务费", "service fee","サービス料", "서비스 수수료")}: ${serviceFee.toFixed(2)} ${escapeHtml(c.currency)}</div>
          <div>${pickText("第三方手续费", "Third-party fee","第三者手数料", "제3자 수수료")}: ${thirdPartyFee.toFixed(2)} ${escapeHtml(c.currency)}</div>
          <div>${pickText("汇率费用", "FX fee","為替手数料", "환율 수수료")}: ${fxFee.toFixed(2)} ${escapeHtml(c.currency)}</div>
          <div class="status">${pickText("小计", "Subtotal","小計", "소계")}: ${totalFees.toFixed(2)} ${escapeHtml(c.currency)}</div>
        </details>
      </article>
      <article class="inline-block">
        <h3>${pickText("保障与取消", "Guarantee & cancellation","保証とキャンセル", "보장 및 취소")}</h3>
        <div>${pickText("取消规则", "Policy","キャンセル規約", "취소 규정")}: ${escapeHtml(c.cancelPolicy)}</div>
        <div>${pickText("免费取消窗口", "Free cancel window","無料キャンセル枠", "무료 취소 시간")}: ${Number(guarantee.freeCancelWindowMin || 10)} ${pickText("分钟", "min","分", "분")}</div>
        <div>${pickText("退款预计到账", "Refund ETA","返金予定", "환불 ETA")}: ${escapeHtml(guarantee.refundEta || "T+1 to T+3")}</div>
        <div class="status">${pickText("交易主体", "Merchant","取引主体", "거래 주체")}: ${escapeHtml(c.merchant)}</div>
        <div class="status">${pickText("支付通道", "Payment rail","決済レール", "결제 레일")}: ${escapeHtml(c.paymentRail || "alipay_cn")}</div>
        <div class="status">${pickText("备选方案", "Alternative","代替案", "대체안")}: ${escapeHtml(c.alternative)}</div>
        <ul class="confirm-flags">${flags}</ul>
      </article>
      ${
        consents
          ? `<article class="inline-block">
        <h3>${pickText("同意项", "Consents","同意項目", "동의 항목")}</h3>
        <div class="status">${pickText("仅在必要时展示，执行前可修改。", "Shown only when required. You can adjust before execution.","必要時のみ表示。実行前に変更可能です。", "필요할 때만 표시되며 실행 전에 변경할 수 있습니다.")}</div>
        <div class="consent-list">${consents}</div>
      </article>`
          : ""
      }
      <div class="actions">
        <button data-action="confirm-task" data-task="${task.id}">${tUi("execute")}</button>
        <button class="secondary" data-action="modify-task" data-task="${task.id}">${pickText("修改", "Modify","修正", "수정")}</button>
        <button class="secondary" data-action="cancel-task" data-task="${task.id}">${pickText("取消", "Cancel","キャンセル", "취소")}</button>
      </div>
    </article>
  `);
}

function renderTimeline(timeline) {
  if (!shouldRenderExecutionCards()) return;
  const list = timeline
    .slice(-10)
    .map(
      (s) =>
        `<li><strong>${escapeHtml(s.label)}</strong> <span class="status-badge ${escapeHtml(s.status)}">${escapeHtml(localizeStatus(s.status))}</span> <span class="status">${new Date(s.at).toLocaleTimeString()} · ${s.latency || 0}ms · ETA ${Math.max(1, Math.ceil(Number(s.etaSec || 0) / 60))} min</span></li>`,
    )
    .join("");

  addCard(`
    <article class="card">
      <h3>${pickText("执行时间线", "Execution Timeline","実行タイムライン", "실행 타임라인")}</h3>
      <ol class="steps">${list}</ol>
    </article>
  `);
}

function renderDeliverable(order) {
  const qrId = `qr-canvas-${escapeHtml(order.id || Date.now().toString(36))}`;
  const qrText = order.proof.qrText || order.proof.orderNo || order.id;
  const netPrice = order.pricing ? Number(order.pricing.netPrice || 0) : null;
  const markup = order.pricing ? Number(order.pricing.markup || 0) : null;
  const markupRate = order.pricing && order.pricing.markupRate ? `(${(Number(order.pricing.markupRate) * 100).toFixed(1)}%)` : "";
  addCard(`
    <article class="card deliverable-card">
      <h3>${escapeHtml(tTerm("proof"))} Card</h3>
      <div class="deliverable-row">
        <div class="deliverable-info">
          <div>${pickText("订单号", "Order","注文番号", "주문 번호")}: <span class="code">${escapeHtml(order.proof.orderNo)}</span></div>
          <div>${pickText("金额", "Amount","金額", "금액")}: <strong>${Number(order.price || 0)} ${escapeHtml(order.currency || "CNY")}</strong>${netPrice !== null ? ` <span class="status">净价 ${netPrice} + 服务费 ${markup} ${markupRate}</span>` : ""}</div>
          <div>${pickText("交易主体", "Merchant of Record","取引主体", "거래 주체")}: ${escapeHtml((order.merchantOfRecord) || "Cross X代收代付")}</div>
          <div>${pickText("地址", "Address","住所", "주소")}: ${escapeHtml(order.proof.bilingualAddress)}</div>
          <div>${pickText("行程备注", "Trip note","旅程メモ", "여행 메모")}: ${escapeHtml(order.proof.itinerary || "")}</div>
        </div>
        <div class="deliverable-qr" style="text-align:center;flex-shrink:0;">
          <canvas id="${qrId}" width="160" height="160" style="border-radius:8px;display:block;"></canvas>
          <div class="status" style="font-size:10px;margin-top:4px;">${pickText("扫码导航/核销", "Scan to navigate/redeem","スキャンして使用", "스캔하여 사용")}</div>
        </div>
      </div>
      <div class="actions">
        <button class="secondary" data-action="open-order-detail" data-order="${order.id}">${pickText("订单详情", "Order detail","注文詳細", "주문 상세")}</button>
        <button class="secondary" data-action="open-proof" data-order="${order.id}">${pickText("打开凭证", "Open proof","証憑を開く", "증빙 열기")}</button>
        <button class="secondary" data-action="open-task" data-task="${order.taskId}">${pickText("任务详情", "Task detail","タスク詳細", "작업 상세")}</button>
        <button class="secondary" data-action="share-order" data-order="${order.id}">${pickText("分享", "Share","共有", "공유")}</button>
      </div>
    </article>
  `);
  // Render QR code after DOM insertion
  setTimeout(() => {
    const canvas = document.getElementById(qrId);
    if (!canvas) return;
    if (window.QRCode) {
      window.QRCode.toCanvas(canvas, qrText, {
        width: 160, margin: 2,
        color: { dark: "#1a1a2e", light: "#f8f9ff" },
      }, (err) => {
        if (err) {
          const ctx = canvas.getContext("2d");
          if (ctx) { ctx.fillStyle = "#f0f0f0"; ctx.fillRect(0, 0, 160, 160); ctx.fillStyle = "#333"; ctx.font = "11px monospace"; ctx.fillText(qrText.slice(0, 20), 8, 80); }
        }
      });
    } else {
      // Fallback: styled placeholder
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.fillStyle = "#f8f9ff"; ctx.fillRect(0, 0, 160, 160);
        ctx.strokeStyle = "#ddd"; ctx.lineWidth = 1; ctx.strokeRect(2, 2, 156, 156);
        ctx.fillStyle = "#1a1a2e"; ctx.font = "bold 12px monospace";
        ctx.textAlign = "center"; ctx.fillText(qrText.slice(0, 18), 80, 75);
        ctx.font = "10px sans-serif"; ctx.fillStyle = "#888"; ctx.fillText("QR · scan to navigate", 80, 95);
      }
    }
  }, 80);
}

function notify(message, type = "info", actionLabel = "", onAction = null) {
  if (toast && typeof toast.show === "function") {
    toast.show({ message, type, actionLabel, onAction });
    return;
  }
  addMessage(message);
}

function setLoading(key, value) {
  if (store) store.dispatch({ type: "SET_LOADING", key, value });
}

function startExecutionMock(task) {
  if (!shouldRenderExecutionCards()) return;
  if (!task || !Array.isArray(task.plan && task.plan.steps)) return;
  if (state.executionMockTimer) clearTimeout(state.executionMockTimer);
  const steps = task.plan.steps.map((step) => ({ ...step }));
  let index = 0;

  function tick() {
    if (!steps[index]) return;
    steps[index].status = "running";
    removeTaskCards(task.id);
    renderPlanCard({ ...task, steps });
    renderConfirmCard(task);

    state.executionMockTimer = setTimeout(() => {
      if (!steps[index]) return;
      steps[index].status = "success";
      removeTaskCards(task.id);
      renderPlanCard({ ...task, steps });
      renderConfirmCard(task);
      index += 1;
      if (index < steps.length) {
        tick();
      }
    }, motion.safeDuration(Math.max(360, Number(steps[index].etaSec || 20) * 16)));
  }

  tick();
}

function renderFallbackCard(taskId, reason) {
  if (!shouldRenderExecutionCards()) return;
  const failedStep = state.currentTask && state.currentTask.id === taskId
    ? (state.currentTask.steps || state.currentTask.plan?.steps || []).find((s) => s.status === "failed")
    : null;
  addCard(`
    <article class="card">
      <h3>${tUi("fallback_title")}</h3>
      <div class="status">${pickText("执行受阻", "Execution blocked","実行が中断されました", "실행이 중단되었습니다")}: ${escapeHtml(reason || "unknown reason")}</div>
      <div class="status">${pickText("失败步骤", "Failed step","失敗したステップ", "실패 단계")}: ${escapeHtml((failedStep && failedStep.label) || pickText("未知", "unknown","不明", "알 수 없음"))}</div>
      <div class="status">${pickText("建议：可先重试；若仍失败可切换路线或人工接管。", "Suggestion: retry first, then switch lane or ask human if needed.","提案: まず再試行し、失敗時はルート切替か有人対応へ。", "권장: 먼저 재시도하고, 실패 시 경로 전환 또는 사람 상담을 사용하세요.")}</div>
      <div class="actions">
        <button data-action="retry-task-exec" data-task="${escapeHtml(taskId)}">${pickText("重试执行", "Retry execution","実行を再試行", "실행 재시도")}</button>
        <button class="secondary" data-action="switch-lane" data-task="${escapeHtml(taskId)}">${pickText("切换路线", "Switch lane","ルート切替", "경로 전환")}</button>
        <button class="secondary" data-action="request-handoff" data-task="${escapeHtml(taskId)}">${pickText("人工接管（2-5分钟）", "Ask human (2-5 min)","有人対応 (2-5分)", "사람 상담 (2-5분)")}</button>
        <button class="secondary" data-action="pause-plan" data-task="${escapeHtml(taskId)}">${pickText("暂停", "Pause","一時停止", "일시중지")}</button>
      </div>
    </article>
  `);
}

function renderSmartReplyCard(smart) {
  if (!smart || !smart.reply) return;

  // Check if reply is a structured options_card JSON (from slot-filling engine)
  const replyText = String(smart.reply || "").trim();
  if (smart.structured || smart.source === "openai-structured" || replyText.startsWith("{")) {
    try {
      const structured = smart.structured || JSON.parse(replyText);
      if (structured && structured.response_type === "options_card") {
        if (renderItineraryOptionsCard(structured)) return;
      } else if (structured && structured.response_type === "clarify") {
        renderClarifyCard(structured);
        return;
      }
    } catch {
      // Not JSON — fall through to normal rendering
    }
  }

  const userMode = isLocalAgentChatEnabled();
  const source = String(smart.source || "fallback").toLowerCase();
  const dataSources = smart && smart.dataSources && typeof smart.dataSources === "object" ? smart.dataSources : null;
  const allOptions = Array.isArray(smart.options) ? smart.options : [];
  const options = userMode ? allOptions.slice(0, 3) : allOptions;
  const compact = (value, max = 120) => {
    const raw = String(value || "").replace(/\s+/g, " ").trim();
    if (!raw) return "";
    return raw.length > max ? `${raw.slice(0, max - 1)}…` : raw;
  };
  const choice = smart && smart.crossXChoice ? smart.crossXChoice : null;
  const choiceOption = choice ? options.find((item) => item.id === choice.optionId) || null : null;
  const thinkingText = String(
    smart.thinking
      || (choice && choice.reason)
      || String(smart.reply || "")
          .split(/\n+/)
          .filter(Boolean)
          .slice(0, 2)
          .join(" "),
  ).trim();
  const compactReply = compact(String(smart.reply || "").trim(), 180);
  const summaryText = compact(thinkingText || compactReply, 180);
  const sourceBadges = [];
  if (source === "claude") {
    sourceBadges.push("Claude");
  } else if (source === "openai") {
    sourceBadges.push("OpenAI");
  }
  if (dataSources && dataSources.connectors) {
    if (dataSources.connectors.gaode) sourceBadges.push("Gaode");
    if (dataSources.connectors.partnerHub) sourceBadges.push("PartnerHub");
  }
  if (dataSources && dataSources.providerSources && dataSources.providerSources.length) {
    for (const item of dataSources.providerSources.slice(0, 3)) {
      sourceBadges.push(String(item));
    }
  }
  if (!sourceBadges.length) {
    sourceBadges.push(source === "claude" ? "Claude" : source === "openai" ? "OpenAI" : "Local Candidate Pool");
  }
  const sourceSummary =
    dataSources && dataSources.candidateCounts
      ? `${pickText("数据源", "Data sources","データソース", "데이터 소스")}: ${sourceBadges.join(" + ")} · ${pickText("候选", "Candidates","候補", "후보")} E${Number(dataSources.candidateCounts.eat || 0)}/T${Number(dataSources.candidateCounts.travel || 0)}`
      : `${pickText("数据源", "Data sources","データソース", "데이터 소스")}: ${sourceBadges.join(" + ")}`;
  const choiceCard = choice
    ? `
      <article class="inline-block crossx-choice-card">
        <div class="status"><strong>⭐ ${escapeHtml(pickText("Cross X 首选", "CrossX Choice", "CrossX 推奨", "CrossX 추천"))}</strong></div>
        <div><strong>${escapeHtml(choice.title || "-")}</strong></div>
        <div class="status">${escapeHtml(compact(choice.reason || "-", userMode ? 90 : 140))}</div>
        <div class="status">${pickText("推荐等级", "Recommendation","推奨レベル", "추천 레벨")}: ${escapeHtml(choice.recommendationLevel || "-")} · ${pickText("评分", "Score","スコア", "점수")} ${Number(choice.score || 0)}</div>
        ${
          (choice.prompt || (choiceOption && choiceOption.prompt))
            ? `<div class="actions"><button data-action="run-smart-action" data-kind="execute" data-prompt="${escapeHtml(choice.prompt || choiceOption.prompt)}" data-option="${escapeHtml(choice.optionId || "")}">${userMode ? pickText("采用该建议", "Use this choice","この案を採用", "이 제안 사용") : pickText("执行 CrossX Choice", "Run CrossX Choice", "CrossX Choice を実行", "CrossX Choice 실행")}</button></div>`
            : ""
        }
      </article>
    `
    : "";
  const optionCards = options
    .map((item, idx) => {
      const reasons = Array.isArray(item.reasons) ? item.reasons.filter(Boolean).slice(0, 2) : [];
      const comments = Array.isArray(item.comments) ? item.comments.filter(Boolean).slice(0, 1) : [];
      const candidates = Array.isArray(item.candidates) ? item.candidates.slice(0, 3) : [];
      const details = [];
      if (item.placeDisplay || item.placeName) details.push(`${pickText("地点", "Place","地点", "장소")}: ${escapeHtml(item.placeDisplay || item.placeName)}`);
      if (item.hotelDisplay || item.hotelName) details.push(`${pickText("酒店", "Hotel","ホテル", "호텔")}: ${escapeHtml(item.hotelDisplay || item.hotelName)}`);
      if (item.transportMode) details.push(`${pickText("交通", "Transport","交通", "교통")}: ${escapeHtml(item.transportMode)}`);
      if (item.etaWindow) details.push(`ETA: ${escapeHtml(item.etaWindow)}`);
      if (item.costRange) details.push(`${pickText("费用", "Cost","費用", "비용")}: ${escapeHtml(item.costRange)}`);
      const reasonRows = reasons.map((reason) => `<li>${escapeHtml(compact(reason, userMode ? 80 : 100))}</li>`).join("");
      const commentRows = comments.map((comment) => `<div class="status">${pickText("评论", "Comment","コメント", "코멘트")}: ${escapeHtml(compact(comment, userMode ? 80 : 120))}</div>`).join("");
      const executionSummary = Array.isArray(item.executionPlan) && item.executionPlan.length
        ? `<div class="status">${pickText("将为你完成", "Will execute","実行内容", "실행 내용")}: ${escapeHtml(item.executionPlan.slice(0, 3).join(" · "))}</div>`
        : "";
      const nextActionsRaw = Array.isArray(item.nextActions) ? item.nextActions : [];
      const nextActions = userMode
        ? nextActionsRaw.filter((act) => String((act && act.kind) || "").toLowerCase() !== "execute").slice(0, 1)
        : nextActionsRaw.slice(0, 3);
      const actionRows = nextActions
        .map((act) => {
          const kind = String(act.kind || "execute");
          let label = String(act.label || pickText("下一步", "Next","次へ", "다음"));
          if (userMode && kind === "execute") {
            label = pickText("采用这个建议", "Use this suggestion","この提案を使う", "이 제안 사용");
          }
          const prompt = String(act.prompt || "");
          const url = String(act.url || "");
          const payload = act && act.payload && typeof act.payload === "object" ? encodeURIComponent(JSON.stringify(act.payload)) : "";
          return `<button class="secondary" data-action="run-smart-action" data-kind="${escapeHtml(kind)}" data-prompt="${escapeHtml(prompt)}" data-url="${escapeHtml(url)}" data-option="${escapeHtml(item.id || "")}" data-action-id="${escapeHtml(act.id || "")}" data-payload="${escapeHtml(payload)}">${escapeHtml(label)}</button>`;
        })
        .join("");
      const candidateRows = userMode
        ? ""
        : candidates
        .map(
          (candidate) => `
            <div class="smart-candidate">
              <img class="smart-candidate-image" src="${escapeHtml(assetUrl(candidate.imageUrl || "/assets/solution-flow.svg"))}" alt="${escapeHtml(candidate.name || "candidate")}" />
              <div>
                <strong>${escapeHtml(candidate.name || "-")}</strong>
                <div class="status">${escapeHtml(candidate.category || "-")} · ${pickText("评分", "Score","スコア", "점수")} ${Number(candidate.score || 0)}</div>
              </div>
            </div>
          `,
        )
        .join("");
      if (userMode) {
        const userPrimaryReason = compact(
          reasons[0]
            || item.reason
            || (choice && choice.reason)
            || pickText("匹配你的预算与时效偏好", "Matches your budget and timing preference","予算と時間条件に適合", "예산/시간 조건에 맞습니다."),
          92,
        );
        const userMetaBits = [
          item.etaWindow ? `ETA ${escapeHtml(item.etaWindow)}` : "",
          item.costRange ? `${pickText("费用", "Cost","費用", "비용")}: ${escapeHtml(item.costRange)}` : "",
          item.riskLevel ? `${pickText("风险", "Risk","リスク", "리스크")}: ${escapeHtml(item.riskLevel)}` : "",
          `${pickText("推荐", "Rank","推奨", "추천")}: ${escapeHtml(item.recommendationLevel || "-")}`,
        ].filter(Boolean);
        return `
          <article class="smart-option-card smart-option-card-user">
            <img class="smart-option-image media-photo" src="${escapeHtml(assetUrl(item.imagePath || "/assets/solution-flow.svg"))}" alt="${escapeHtml(item.title || "option image")}" />
            <div class="smart-option-body">
              <div class="smart-option-title">
                <strong>${idx + 1}. ${escapeHtml(item.title || "-")}</strong>
                <span class="status-badge lane-grade">${escapeHtml(item.grade || "B")}</span>
              </div>
              <div class="smart-meta-row">
                ${userMetaBits.map((bit) => `<span class="smart-meta-chip">${bit}</span>`).join("")}
              </div>
              <div class="smart-option-why">
                <strong>${pickText("推荐理由", "Why this","推薦理由", "추천 이유")}：</strong>${escapeHtml(userPrimaryReason)}
              </div>
              ${commentRows}
              <div class="actions">
                <button data-action="run-smart-option" data-intent="${escapeHtml(item.prompt || item.title || "")}" data-option="${escapeHtml(item.id || "")}"
                  data-cost="${escapeHtml(item.costRange || item.cost || "")}" data-title="${escapeHtml(item.title || "")}"
                  onclick="window.crossxShowPayment && window.crossxShowPayment({title:'${escapeHtml(item.title || "")}',costRange:'${escapeHtml(item.costRange || "")}',price:'${escapeHtml(item.costRange || "")}'}); return false;">
                  ${pickText("立即预订", "Book Now","今すぐ予約", "지금 예약")}
                </button>
                ${actionRows}
              </div>
            </div>
          </article>
        `;
      }
      return `
        <article class="smart-option-card">
          <img class="smart-option-image media-photo" src="${escapeHtml(assetUrl(item.imagePath || "/assets/solution-flow.svg"))}" alt="${escapeHtml(item.title || "option image")}" />
          <div class="smart-option-body">
            <div class="smart-option-title">
              <strong>${idx + 1}. ${escapeHtml(item.title || "-")}</strong>
              <span class="status-badge lane-grade">${escapeHtml(item.grade || "B")}</span>
            </div>
            <div class="status">${escapeHtml(item.recommendationLevel || "-")}</div>
            ${commentRows}
            ${details.length ? `<div class="status">${details.slice(0, 4).join(" · ")}</div>` : ""}
            ${executionSummary}
            <div class="status">${pickText("筛选理由", "Why selected","選定理由", "선정 이유")}:</div>
            <ul class="steps">${reasonRows || `<li>${pickText("暂无理由", "No reason","理由なし", "이유 없음")}</li>`}</ul>
            ${
              candidateRows
                ? `<div class="status">${pickText("候选示例", "Sample candidates","候補例", "후보 예시")}:</div><div class="smart-candidate-list">${candidateRows}</div>`
                : ""
            }
            <div class="actions">
              <button data-action="run-smart-option" data-intent="${escapeHtml(item.prompt || item.title || "")}" data-option="${escapeHtml(item.id || "")}">
                ${pickText("执行此方案", "Run this option","この案を実行", "이 옵션 실행")}
              </button>
              ${actionRows}
            </div>
          </div>
        </article>
      `;
    })
    .join("");
  clearChatCards({ keepDeliverable: true, keepSmartReply: false });
  addCard(`
    <article class="card smart-reply-card">
      <h3>${pickText("定制化解决方案", "Tailored Solutions","カスタム提案", "맞춤 솔루션")}</h3>
      <div class="status">${escapeHtml(summaryText)}</div>
      <div class="status">${escapeHtml(sourceSummary)}</div>
      ${
        source !== "openai"
          ? `<div class="status">${pickText("当前为本地策略引擎回复。配置 OPENAI_API_KEY 后将自动切换为 ChatGPT。", "Fallback engine active. Configure OPENAI_API_KEY to switch to ChatGPT.","現在はフォールバック応答です。OPENAI_API_KEY 設定後に ChatGPT へ切替します。", "현재 폴백 엔진 응답입니다. OPENAI_API_KEY 설정 시 ChatGPT로 전환됩니다.")}</div>
             ${
               smart && smart.fallbackReason
                 ? `<div class="status">${pickText("回退原因", "Fallback reason","フォールバック理由", "폴백 사유")}: <span class="code">${escapeHtml(String(smart.fallbackReason))}</span></div>`
                 : ""
             }`
          : ""
      }
      ${choiceCard}
      ${
        optionCards
          ? `<div class="status">${pickText(`可选方案（${options.length}选）`, `Options (${options.length})`, `選択可能な提案（${options.length}）`, `선택 가능한 옵션 (${options.length})`)}${userMode && allOptions.length > options.length ? ` · ${escapeHtml(pickText("其余方案可通过\u201c换一批\u201c继续获取。", "Use refresh to load more options.","他の案は「再提案」で取得できます。", "다른 옵션은 새로고침으로 확인하세요."))}` : ""}</div><div class="smart-options-grid">${optionCards}</div>`
          : ""
      }
    </article>
  `);
  speakAssistantMessage(thinkingText || smart.reply);
}

/**
 * Renders the structured options_card JSON response as native UI cards.
 * Equivalent to the React <ItineraryCards> component — three gradient cards
 * with hotel/transport/dining/features and a "Book Now" CTA.
 */
// ── Platform deeplink helpers ──────────────────────────────────────────────
const PLATFORM_DEEPLINKS = {
  ctrip:   { name:"携程",   color: "#00A0E9", icon: "✈️", url: (kw) => `https://m.ctrip.com/webapp/hotel/list/?hotelname=${encodeURIComponent(kw)}` },
  meituan: { name:"美团",   color: "#F5A623", icon: "🍜", url: (kw) => `https://i.meituan.com/s/search.html?q=${encodeURIComponent(kw)}` },
  didi:    { name:"滴滴",   color: "#FF6600", icon: "🚕", url: ()   => "https://www.didiglobal.com/" },
  taobao:  { name:"淘宝",   color: "#FF4400", icon: "🛒", url: (kw) => `https://s.taobao.com/search?q=${encodeURIComponent(kw)}` },
  default: { name:"查看",   color: "#6B7280", icon: "🔗", url: (kw) => `https://www.baidu.com/s?wd=${encodeURIComponent(kw)}` },
};

function renderPaymentPanel(opt) {
  const items = Array.isArray(opt.payment_items) ? opt.payment_items : [];
  if (!items.length) return "";

  const breakdown = opt.budget_breakdown || {};
  const itemRows = items.map((item) => {
    const pl = PLATFORM_DEEPLINKS[item.deeplink_scheme] || PLATFORM_DEEPLINKS.default;
    const href = pl.url(item.search_keyword || item.name);
    const amt = Number(item.amount || 0).toLocaleString();
    return `
      <div class="payment-item-row">
        <span class="payment-item-icon">${pl.icon}</span>
        <span class="payment-item-name">${escapeHtml(item.name)}</span>
        <span class="payment-item-amount">¥${escapeHtml(amt)}</span>
        <a class="payment-item-link" href="${escapeHtml(href)}" target="_blank" rel="noopener"
           style="background:${pl.color}">${escapeHtml(pl.name)}</a>
      </div>`;
  }).join("");

  const total = Number(opt.total_cost || 0).toLocaleString();
  const optId = escapeHtml(opt.id || "");
  const optTag = escapeHtml(opt.tag || "");

  return `
    <div class="payment-panel">
      <div class="payment-panel-title">预订明细</div>
      <div class="payment-items-list">${itemRows}</div>
      <div class="payment-total-row">
        <span>总预算</span>
        <span class="payment-grand-total">¥${escapeHtml(total)}</span>
      </div>
      <button class="payment-confirm-btn"
        data-opt-id="${optId}" data-opt-tag="${optTag}"
        onclick="handleAgentPaymentConfirm(this)">
        <span class="payment-btn-icon">✓</span>
        ${pickText("确认方案 · 开始预订", "Confirm & Book","プランを確認・予約", "플랜 확인 · 예약")}
      </button>
      <p class="payment-disclaimer">${pickText("点击各平台按钮查看实时价格 · Cross X 不收取预订手续费", "Tap platform buttons to check live prices · No booking fee", "", "")}</p>
    </div>`;
}

function renderMealPlanSection(opt) {
  const days = Array.isArray(opt.meal_daily_plan) ? opt.meal_daily_plan : [];
  if (!days.length) return opt.dining_plan ? `<div class="option-detail-row"><span class="detail-label">🍜</span><span>${escapeHtml(opt.dining_plan)}</span></div>` : "";

  // Show first 2 days as preview, rest collapsed
  const preview = days.slice(0, 2).map((d) => `
    <div class="meal-day-row">
      <span class="meal-day-label">Day ${d.day}</span>
      <span class="meal-slot"><span class="meal-type">早</span>${escapeHtml(d.breakfast || "-")}</span>
      <span class="meal-slot"><span class="meal-type">中</span>${escapeHtml(d.lunch || "-")}</span>
      <span class="meal-slot"><span class="meal-type">晚</span>${escapeHtml(d.dinner || "-")}</span>
    </div>`).join("");

  const remaining = days.length > 2 ? `<div class="meal-more-days">+ ${days.length - 2} 天餐饮规划（已自动安排）</div>` : "";
  return `
    <div class="meal-plan-section">
      <div class="meal-plan-header">🍽️ 每日餐饮规划</div>
      ${preview}${remaining}
    </div>`;
}

// ── Type icons & booking platforms for card_data items ───────────────────
const ITEM_TYPE_CONFIG = {
  hotel:       { icon: "🏨", platform:"携程",  color: "#00A0E9", search: (n) => `https://m.ctrip.com/webapp/hotel/list/?hotelname=${encodeURIComponent(n)}` },
  transport:   { icon: "🚇", platform:"滴滴",  color: "#FF6600", search: ()  => "https://www.didiglobal.com/" },
  meals:       { icon: "🍜", platform:"美团",  color: "#F5A623", search: (n) => `https://i.meituan.com/s/search.html?q=${encodeURIComponent(n)}` },
  activity:    { icon: "🎯", platform:"携程",  color: "#00A0E9", search: (n) => `https://m.ctrip.com/webapp/sight/search/${encodeURIComponent(n)}` },
  translation: { icon: "🗣️", platform:"淘宝",  color: "#FF4400", search: (n) => `https://s.taobao.com/search?q=${encodeURIComponent(n)}` },
  sim:         { icon: "📶", platform:"淘宝",  color: "#FF4400", search: (n) => `https://s.taobao.com/search?q=${encodeURIComponent(n)}` },
  default:     { icon: "📦", platform:"查看",  color: "#6B7280", search: (n) => `https://www.baidu.com/s?wd=${encodeURIComponent(n)}` },
};

// ── Activity type → icon/color mapping ───────────────────────────────────
const ACT_TYPE_CONFIG = {
  transport:   { icon: "🚇", color: "#10b981" },
  meal:        { icon: "🍽️", color: "#f59e0b" },
  food:        { icon: "🍽️", color: "#f59e0b" },
  activity:    { icon: "🎯", color: "#8b5cf6" },
  sightseeing: { icon: "🎯", color: "#8b5cf6" },
  checkin:     { icon: "🏨", color: "#2d87f0" },
  hotel:       { icon: "🏨", color: "#2d87f0" },
  checkout:    { icon: "🧳", color: "#6b7280" },
  shopping:    { icon: "🛍️", color: "#ec4899" },
  rest:        { icon: "😌", color: "#94a3b8" },
  free:        { icon: "😌", color: "#94a3b8" },
  city_change: { icon: "✈️", color: "#2d87f0" },
  default:     { icon: "📍", color: "#6b7280" },
};

// ── Quick Action Native Widget Cards ─────────────────────────────────────
function renderQuickActionCard(smart) {
  const payload = smart.payload || {};
  const actionType = smart.action_type || "unknown";
  const spokenText = smart.spoken_text || "";
  let html = "";

  if (actionType === "ride_hailing") {
    const platforms = Array.isArray(payload.platforms) ? payload.platforms : [];
    const mainPlatform = platforms.find((p) => p.recommended) || platforms[0] || {};
    const tip = escapeHtml(payload.tip || "");
    const btnRows = platforms.map((p) => `
      <a href="${escapeHtml(p.url || p.fallback_url || "#")}"
         onclick="quickActionTrack('${escapeHtml(p.id || "")}')"
         class="qa-platform-btn${p.recommended ? " qa-platform-btn--primary" : ""}">
        ${p.recommended ? `<svg class="qa-btn-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 18h.01M8 21h8a2 2 0 002-2V5a2 2 0 00-2-2H8a2 2 0 00-2 2v14a2 2 0 002 2z"/></svg>` : ""}
        <span>${escapeHtml(p.label || "")}</span>
        ${p.recommended ? `<span class="qa-btn-rec">${pickText("推荐", "Recommended","推奨", "추천")}</span>` : ""}
      </a>`).join("");

    html = `
      <div class="qa-card qa-card--ride">
        <div class="qa-map-placeholder">
          <div class="qa-pulse-wrap"><div class="qa-pulse-ring"></div><div class="qa-pulse-dot"></div></div>
          <span class="qa-map-label">${pickText("您的当前位置", "Your Current Location","現在地", "현재 위치")}</span>
        </div>
        <div class="qa-route-rows">
          <div class="qa-route-row"><span class="qa-dot qa-dot--from"></span><span>${pickText("当前位置（GPS）", "Current Location (GPS)","現在地 (GPS)", "현재 위치 (GPS)")}</span></div>
          <div class="qa-route-row"><span class="qa-dot qa-dot--to"></span><span class="qa-muted">${pickText("目的地...", "Where to?","目的地...", "목적지...")}</span></div>
        </div>
        <div class="qa-platforms">${btnRows}</div>
        ${tip ? `<p class="qa-tip">${tip}</p>` : ""}
      </div>`;

  } else if (actionType === "translate") {
    const srcText = escapeHtml(payload.source_text || "");
    const zhText = escapeHtml(payload.translated_text || "");
    const ctxTip = escapeHtml(payload.context_tip || "");
    const ttsText = payload.translated_text || "";
    html = `
      <div class="qa-card qa-card--translate">
        ${srcText ? `<p class="qa-translate-source">"${srcText}"</p>` : ""}
        <h2 class="qa-translate-zh">${zhText}</h2>
        <div class="qa-translate-footer">
          <span class="qa-translate-hint">${ctxTip}</span>
          <button class="qa-tts-btn" onclick="quickActionSpeak(${JSON.stringify(ttsText)})" title="Play audio">
            <svg class="w-6 h-6 ml-1" fill="currentColor" viewBox="0 0 20 20"><path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clip-rule="evenodd"></path></svg>
          </button>
        </div>
      </div>`;

  } else if (actionType === "currency") {
    const fromAmt = payload.from_amount || 0;
    const toAmt = payload.to_amount;
    const fromCur = payload.from_currency || "CNY";
    const toCur = payload.to_currency || "USD";
    const rate = payload.rate || 0;
    const rateNote = escapeHtml(payload.rate_note || "");
    const flagMap = { CNY: "🇨🇳", USD: "🇺🇸", EUR: "🇪🇺", GBP: "🇬🇧", HKD: "🇭🇰", JPY: "🇯🇵", KRW: "🇰🇷", CAD: "🇨🇦", AUD: "🇦🇺", CHF: "🇨🇭" };
    const symMap = { CNY: "¥", USD: "$", EUR: "€", GBP: "£", HKD: "HK$", JPY: "¥", KRW: "₩", CAD: "CA$", AUD: "A$", CHF: "Fr" };
    html = `
      <div class="qa-card qa-card--currency">
        <div class="qa-curr-from">
          <span class="qa-curr-flag">${flagMap[fromCur] || "💱"}</span>
          <span class="qa-curr-label">${fromCur}</span>
          <span class="qa-curr-amt">${fromAmt > 0 ? fromAmt.toLocaleString() : "—"}</span>
        </div>
        <div class="qa-curr-arrow">→</div>
        <div class="qa-curr-to">
          <p class="qa-curr-equals">${pickText("约等于", "Equals to","約", "≈")}</p>
          <div class="qa-curr-result">
            <span class="qa-curr-sym">${symMap[toCur] || ""}</span>
            <span class="qa-curr-big">${toAmt !== null ? toAmt.toLocaleString() : "—"}</span>
            <span class="qa-curr-code">${toCur} ${flagMap[toCur] || ""}</span>
          </div>
        </div>
        <div class="qa-curr-rate">
          <span>${pickText("汇率", "Rate","レート", "환율")}: 1 CNY = ${rate} ${toCur}</span>
          <span class="qa-curr-live"><span class="qa-live-dot"></span>${pickText("参考汇率", "Reference Rate","参考レート", "참고 환율")}</span>
        </div>
        ${rateNote ? `<p class="qa-tip">${rateNote}</p>` : ""}
      </div>`;

  } else if (actionType === "emergency") {
    const numbers = Array.isArray(payload.numbers) ? payload.numbers : [];
    const numRows = numbers.map((n) => `
      <a href="tel:${escapeHtml(n.number)}" class="qa-emg-row">
        <span class="qa-emg-label">${escapeHtml(n.label)}</span>
        <span class="qa-emg-num">${escapeHtml(n.number)}</span>
      </a>`).join("");
    html = `
      <div class="qa-card qa-card--emergency">
        <div class="qa-emg-header"><span class="qa-emg-icon">🆘</span><span>${pickText("紧急联络", "Emergency Contacts","緊急連絡先", "긴급 연락처")}</span></div>
        <div class="qa-emg-list">${numRows}</div>
      </div>`;

  } else {
    // Generic fallback
    html = `<div class="qa-card"><p class="qa-spoken">${escapeHtml(spokenText)}</p></div>`;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "qa-wrapper";
  wrapper.innerHTML = `<p class="qa-spoken-lead">${escapeHtml(spokenText)}</p>${html}`;
  const chatMessages = document.getElementById("chatMessages");
  if (chatMessages) {
    chatMessages.appendChild(wrapper);
    wrapper.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function quickActionTrack(platformId) {
  console.log("[QuickAction] Platform opened:", platformId);
}

function quickActionSpeak(text) {
  if (!text) return;
  const utt = new SpeechSynthesisUtterance(text);
  utt.lang = "zh-CN";
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utt);
}

// ── Clarification Chips Card ──────────────────────────────────────────────
function renderClarifyCard(structured) {
  const questionText = structured.spoken_text || structured.spoken_text || "请补充以下信息以生成您的专属方案：";
  const missing = Array.isArray(structured.missing_slots) ? structured.missing_slots : [];

  // Predefined quick-select options per slot
  const SLOT_CHIPS = {
    budget: {
      label:"预算范围",
      icon: "¥",
      options: [
        { label: "< ¥5,000",    value:"预算5000以内" },
        { label: "¥5k – 10k",   value:"预算5000到10000" },
        { label: "¥10k – 30k",  value:"预算1万到3万" },
        { label: "> ¥30k",      value:"预算3万以上，追求极致体验" },
      ],
    },
    destination: {
      label:"目的地",
      icon: "📍",
      options: [
        { label:"上海", value:"去上海" },
        { label:"深圳", value:"去深圳" },
        { label:"北京", value:"去北京" },
        { label:"三亚", value:"去三亚" },
      ],
    },
    duration_days: {
      label:"行程天数",
      icon: "📅",
      options: [
        { label: "2天", value:"行程2天" },
        { label: "3天", value:"行程3天" },
        { label: "5天", value:"行程5天" },
        { label: "7天+", value:"行程7天以上" },
      ],
    },
    party_size: {
      label:"出行人数",
      icon: "👥",
      options: [
        { label: "1人", value: "1个人" },
        { label: "2人", value: "2个人" },
        { label: "3-4人", value: "3到4个人" },
        { label: "5人+", value: "5人以上" },
      ],
    },
    food_preference: {
      label:"饮食偏好",
      icon: "🍽️",
      options: [
        { label:"无特别要求", value:"饮食没有特别要求" },
        { label:"清真", value:"需要清真餐饮" },
        { label:"素食", value:"需要素食餐饮" },
        { label:"海鲜/粤菜", value:"喜欢海鲜和粤菜" },
      ],
    },
  };

  // Determine which slot groups to show (default to budget if nothing specified)
  const slotsToShow = missing.length > 0 ? missing : ["budget"];
  const chipGroups = slotsToShow
    .map((slot) => SLOT_CHIPS[slot])
    .filter(Boolean);

  if (!chipGroups.length) {
    addMessage(questionText, "agent");
    return;
  }

  const groupsHtml = chipGroups.map((group) => {
    const chips = group.options.map((opt) =>
      `<button class="clarify-chip" onclick="sendClarifyChip(${JSON.stringify(opt.value)})">
        <span class="clarify-chip-label">${escapeHtml(opt.label)}</span>
      </button>`
    ).join("");
    return `<div class="clarify-group">
      <div class="clarify-group-label"><span class="clarify-group-icon">${group.icon}</span>${escapeHtml(group.label)}</div>
      <div class="clarify-chips">${chips}</div>
    </div>`;
  }).join("");

  addCard(`
    <article class="card smart-reply-card clarify-card">
      <div class="clarify-header">
        <div class="clarify-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
        </div>
        <div class="clarify-title">补充信息</div>
      </div>
      <div class="clarify-question">${escapeHtml(questionText)}</div>
      ${groupsHtml}
    </article>
  `);
}

// Send a clarify chip selection as a user message
function sendClarifyChip(value) {
  if (el.chatInput) el.chatInput.value = "";
  createTaskFromText(value);
}

// ── Shared list-card builder (called by renderCardData + refreshPlanCardLanguage) ──
const _LIST_CARD_TAG_STYLES = {
  budget:   { bg: "#ecfdf5", color: "#065f46", border: "#6ee7b7" },
  balanced: { bg: "#eff6ff", color: "#1e40af", border: "#93c5fd" },
  premium:  { bg: "#fffbeb", color: "#92400e", border: "#fcd34d" },
};

// ── City hero image — Picsum scenic photos, deterministic by city seed ───────
// picsum.photos/seed/{seed}/W/H always returns the same high-quality landscape photo
// for a given seed. We use city-slug seeds so each destination gets its own image.
// No API key, no rate limit, no 503, never shows food/products.
const _CITY_IMG_SEEDS = {
  "北京" :    "beijing-great-wall",
  "上海" :    "shanghai-bund-night",
  "深圳" :    "shenzhen-skyline",
  "广州" :    "guangzhou-canton",
  "成都" :    "chengdu-sichuan",
  "重庆" :    "chongqing-mountain",
  "杭州" :    "hangzhou-west-lake",
  "苏州" :    "suzhou-garden",
  "西安" :    "xian-city-wall",
  "南京" :    "nanjing-scenic",
  "三亚" :    "sanya-beach-sea",
  "丽江" :    "lijiang-ancient-town",
  "大理" :    "dali-erhai-lake",
  "桂林" :    "guilin-karst-peaks",
  "张家界" :   "zhangjiajie-pillar",
  "黄山" :    "huangshan-mist",
  "新疆" :    "xinjiang-prairie",
  "拉萨" :    "lhasa-potala",
  "哈尔滨" :  "harbin-ice-snow",
  "青岛" :    "qingdao-coastal",
  "厦门" :    "xiamen-island",
  "乌鲁木齐" : "urumqi-xinjiang",
};

function _getCityHeroUrl(dest) {
  // P8.3: prefer Coze-generated hero image when available
  const cozeHero = state.cozeData?.hero_image;
  if (cozeHero && /^https?:\/\//i.test(cozeHero)) return cozeHero;
  const d = dest || "";
  // For multi-city destinations like "深圳·西安·新疆", extract the first city
  const firstCity = d.split(/[·,、·\s→>]/)[0].trim();
  const searchIn = firstCity || d;
  const cityKey = Object.keys(_CITY_IMG_SEEDS).find((k) => searchIn.includes(k) || k.includes(searchIn));
  const seed = _CITY_IMG_SEEDS[cityKey] || `travel-scenic-${(firstCity||d).slice(0, 6) || "city"}`;
  return `https://picsum.photos/seed/${encodeURIComponent(seed)}/800/450`;
}

function _buildListCard(p, idx, cardId, dur, pax, dest) {
  // P8.6: Card layout polymorphism — driven by layout_type from backend
  const layoutType  = state._layoutType || "travel_full";
  const isFoodCard  = layoutType === "food_only";
  const isStayFocus = layoutType === "stay_focus";

  const style = _LIST_CARD_TAG_STYLES[p.id] || _LIST_CARD_TAG_STYLES.balanced;
  const isRec = p.is_recommended;

  // P8.3: for recommended plan, prefer Coze MOR net price if available
  const cozePrice = isRec && state.cozeData?.total_price ? Number(state.cozeData.total_price) : 0;
  const rawPrice  = cozePrice > 0 ? cozePrice : Number(p.total_price || 0);

  // ── Polymorphic field mapping ────────────────────────────────────────────
  // food_only  → item name / avg_price / queue badge
  // stay_focus → hotel name + rating focus
  // travel_full → default hotel + price display
  const displayTitle = isFoodCard
    ? escapeHtml(p.name || p.restaurant_name || p.item_name || dest || "")
    : escapeHtml(p.hotel?.name || "");

  const displayRating = isFoodCard
    ? (p.rating || p.item_rating || p.score || 0)
    : (p.hotel?.rating || 0);

  const displayRevCount = isFoodCard ? "" : escapeHtml(p.hotel?.review_count || "");

  const priceDisplay = isFoodCard
    ? (p.avg_price
        ? `${pickText("人均","Avg","人均","인당")}¥${p.avg_price}`
        : `¥${rawPrice.toLocaleString()}`)
    : `¥${rawPrice.toLocaleString()}`;

  // Queue badge replaces review count on food cards
  const queueBadge = isFoodCard && state.cozeData?.restaurant_queue > 0
    ? `<span class="act-coze-queue" style="margin-bottom:6px">⏳ ${pickText("排队约","~","約","대기")}${state.cozeData.restaurant_queue}${pickText("分钟","min","分","분")}</span>`
    : "";

  const coverIcon = isFoodCard ? "🍜" : isStayFocus ? "🏨" : "✈️";
  const aiAnalysis = escapeHtml((p.highlights || []).slice(0, 2).join(" · ").slice(0, 90));
  const statusBarId = `cx-sb-${cardId}-${idx}`;
  const cardCls = `cx-list-card${isRec ? " cx-list-card--rec" : ""}`;

  // Image: food_only → real dish photo (real_photo_url / food_image) → curated food fallback
  //        others  → hotel hero → city Unsplash photo → styled cover
  // "深圳酒店大图" can NEVER leak into a food card because heroUrl skips hotel fields.
  const FOOD_FALLBACK_URL = "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?w=800&q=80"; // street food
  const heroUrl = isFoodCard
    ? (p.real_photo_url || p.food_image || p.item_image || "")   // real Coze photo first
    : (p.hotel?.hero_image || "");                                 // hotel image only for non-food
  const fallbackUrl = isFoodCard ? FOOD_FALLBACK_URL : _getCityHeroUrl(dest);
  const coverLabel  = escapeHtml(isFoodCard ? (p.name || p.restaurant_name || dest || "") : (dest || p.hotel?.name || ""));
  const coverHtml  = `<div class="cx-lc-img-cover">
       <span class="cx-cover-city">${coverLabel}</span>
       <span style="font-size:20px">${coverIcon}</span>
     </div>`;
  const imgHtml = heroUrl
    ? `<img class="cx-lc-img" src="${heroUrl}" alt="${coverLabel}" loading="lazy"
         onerror="this.src='${fallbackUrl}';this.onerror=function(){this.style.display='none';this.nextElementSibling.style.display='flex'}">`
       + `<div class="cx-lc-img-cover" style="display:none">${coverHtml}</div>`
    : `<img class="cx-lc-img" src="${fallbackUrl}" alt="${coverLabel}" loading="lazy"
         onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
       + `<div class="cx-lc-img-cover" style="display:none">${coverHtml}</div>`;

  // Mini timeline: food → label as 特色菜 / activity → Day N / default → Day N
  const hlList = (p.highlights || []).slice(0, 3);
  const timelineLabel = (i) => isFoodCard
    ? pickText("推荐", "Pick", "推薦", "추천")
    : `Day ${i + 1}`;
  const miniTimeline = hlList.length > 0
    ? `<div class="cx-mini-timeline">` +
      hlList.map((h, i) => `
        <div class="cx-mt-row">
          <div class="cx-mt-dot"></div>
          <div class="cx-mt-line"></div>
          <span class="cx-mt-label">${timelineLabel(i)}</span>
          <span class="cx-mt-text">${escapeHtml(h)}</span>
        </div>`).join("") +
      `</div>`
    : "";

  return `
  <div class="${cardCls}" data-plan-id="${escapeHtml(p.id || "")}" data-layout="${layoutType}"
    onclick="openPlanDetail('${cardId}', ${idx})">
    <div class="cx-lc-img-wrap">
      ${imgHtml}
      ${isRec ? `<span class="cx-lc-badge">${pickText("AI 优选","AI Pick","AI おすすめ","AI 추천")}</span>` : ""}
    </div>
    <div class="cx-lc-body">
      <div class="cx-lc-top">
        <span class="cx-lc-tag" style="color:${style.color}">${escapeHtml(p.tag || "")}</span>
        <div class="cx-lc-price">${priceDisplay}</div>
      </div>
      <div class="cx-lc-price-sub">${pax > 1 ? pax + pickText(" 人 / "," pax · "," 名 / "," 명 · ") : ""}${dur}${pickText("天","d","日","일")}</div>
      <div class="cx-lc-hotel">${displayTitle}</div>
      <div class="cx-lc-meta">
        ${displayRating   ? `<span>★ ${displayRating}</span>` : ""}
        ${displayRevCount ? `<span style="color:#9ca3af">${displayRevCount}</span>` : ""}
        ${queueBadge}
      </div>
      ${miniTimeline}
      ${aiAnalysis ? `<div class="cx-lc-analysis">${aiAnalysis}</div>` : ""}
      <div class="cx-status-bar" id="${statusBarId}">
        <span class="cx-sb-icon">⏳</span>
        <span class="cx-sb-text">${pickText("正在加载优惠...","Loading offers...","特典を取得中...","혜택 로딩 중...")}</span>
      </div>
    </div>
    <button class="cx-lc-cta" onclick="event.stopPropagation(); openPlanDetail('${cardId}', ${idx})">
      ${pickText("查看详情 →","View Details →","詳細を見る →","상세 보기 →")}
    </button>
  </div>`;
}

/**
 * refreshPlanCardLanguage — Re-renders plan card text in the new language
 * without destroying the DOM node (keeps coupon bar state, day-tab state etc.).
 * Called after every language switch when state.lastAiPlan is set.
 */
function refreshPlanCardLanguage() {
  const saved = state.lastAiPlan;
  if (!saved?.cd?.plans?.length) return;
  const cd = saved.cd;
  const article = document.querySelector(".plan-card--v2");
  if (!article) return;
  const cardId = article.id;
  const planList = article.querySelector(".cx-plan-list");
  if (!planList) return;

  // Step 1: blur during swap so the text replacement is invisible
  planList.classList.add("cx-smooth-refresh");

  // Step 2: re-render cards with updated pickText values
  const dur = cd.duration_days || 3;
  const pax = cd.pax || 1;
  planList.innerHTML = cd.plans.map((p, idx) => _buildListCard(p, idx, cardId, dur, pax, cd.destination || "")).join("");

  // Step 3: update static labels inside article (section headers, disclaimer)
  const headers = article.querySelectorAll(".plan-section-header");
  if (headers[0]) headers[0].textContent = pickText("选择你的方案","Choose Your Plan","プランを選ぶ","플랜 선택");
  const disc = article.querySelector(".payment-disclaimer");
  if (disc) disc.textContent = pickText("确认后 Cross X 为您锁定资源并安排预订 · 不收取手续费", "Confirm to lock all bookings · No service fee", "", "");

  // Step 4: unblur (double rAF ensures transition plays every time)
  requestAnimationFrame(() => requestAnimationFrame(() => planList.classList.remove("cx-smooth-refresh")));

  // Step 5: re-fetch coupon bars for re-rendered status bars
  const dest = cd.destination || "";
  if (dest) {
    cd.plans.forEach((_, idx) => {
      const barEl = planList.querySelector(`#cx-sb-${cardId}-${idx}`);
      if (barEl && _couponCache.has(dest)) _applyCouponBar(barEl, _couponCache.get(dest));
    });
  }
}

// ── card_data renderer — 3-plan comparison + day itinerary ────────────────
function renderCardData(cd, spokenText) {
  if (!cd) return false;
  const hasPlans = Array.isArray(cd.plans) && cd.plans.length > 0;
  const hasDays = Array.isArray(cd.days) && cd.days.length > 0;
  const hasItems = Array.isArray(cd.items) && cd.items.length > 0;
  if (!hasPlans && !hasDays && !hasItems) return false;

  // ── 3-PLAN COMPARISON MODE ─────────────────────────────────────────────
  if (hasPlans) {
    const cardId = "plan-" + Math.random().toString(36).slice(2, 8);
    const dest = escapeHtml(cd.destination || "");
    const dur = cd.duration_days || 3;
    const pax = cd.pax || 1;

    // Build plan option cards using shared builder
    const planCards = cd.plans.map((p, idx) => _buildListCard(p, idx, cardId, dur, pax, cd.destination || "")).join("");

    // Day-by-day itinerary section (shared, shown after plan selection or always for balanced)
    let dayItineraryHtml = "";
    if (hasDays) {
      const dayTabsHtml = `<div class="plan-day-tabs" id="${cardId}-tabs">` +
        cd.days.map((d, i) =>
          `<button class="day-tab${i === 0 ? " active" : ""}" onclick="switchPlanDay('${cardId}',${i})">Day ${d.day}</button>`
        ).join("") +
        "</div>";

      const dayPanelsHtml = cd.days.map((d, di) => {
        // Intercity transport banner for city-change days
        const IC_ICON_MAP = { flight: "✈️", hsr: "🚄", bus: "🚌", car: "🚗" };
        const icHtml = d.intercity_transport?.from ? (() => {
          const ic = d.intercity_transport;
          const mIcon = IC_ICON_MAP[ic.mode] || "🚌";
          const iCost = ic.cost_cny > 0 ? `<span class="act-intercity-cost">¥${Number(ic.cost_cny).toLocaleString()}</span>` : "";
          return `<div class="act-intercity">
            <div class="act-intercity-header"><span class="act-intercity-icon">${mIcon}</span><span class="act-intercity-route">${escapeHtml(ic.from||"")} → ${escapeHtml(ic.to||"")}</span>${iCost}</div>
            ${ic.detail ? `<div class="act-intercity-detail">${escapeHtml(ic.detail)}</div>` : ""}
            ${ic.tip ? `<div class="act-intercity-tip">💡 ${escapeHtml(ic.tip)}</div>` : ""}
          </div>`;
        })() : "";
        const activities = (d.activities || []).map((act) => {
          const cfg = ACT_TYPE_CONFIG[act.type] || ACT_TYPE_CONFIG.default;
          const imgKw = encodeURIComponent(act.image_keyword || act.name || "");
          const costRaw = act.cost_cny || act.cost || 0;
          const costFmt = costRaw > 0 ? `¥${Number(costRaw).toLocaleString()}` :"免费";
          const costCls  = costRaw === 0 ? " act-cost--free" : "";
          const mins = act.duration_min || 0;
          const durFmt = mins > 0 ? (mins >= 60 ? `${Math.floor(mins/60)}h${mins%60?""+mins%60+"m":""}` : `${mins}m`) : "";
          const transitHtml = act.transport_to
            ? `<div class="act-transit"><span>🗺</span>${escapeHtml(act.transport_to)}</div>` : "";
          const timeBadge = (act.time)
            ? `<span class="act-time-badge">${escapeHtml(act.time)}</span>` : "";
          // P8.3: Coze enrichment UI slots
          const isFood = /food|restaurant|eat|meal|lunch|dinner|breakfast/i.test(act.type||"") || act.type === "food";
          const isSight = /sight|attraction|museum|temple|park|activity/i.test(act.type||"") || act.type === "sightseeing";
          const cozeQueue = isFood && state.cozeData?.restaurant_queue > 0
            ? `<span class="act-coze-queue">⏳ 排队约${state.cozeData.restaurant_queue}分钟</span>` : "";
          const cozeTicket = isSight && state.cozeData?.ticket_availability
            ? `<span class="act-coze-ticket">🟢 有票·可代订</span>` : "";
          return `${transitHtml}
            <div class="act-row">
              <img class="act-img" src="https://picsum.photos/seed/${imgKw}/120/80" alt="${escapeHtml(act.name || "")}" loading="lazy" onerror="this.style.display='none'">
              <div class="act-body">
                <div class="act-name">${timeBadge}<span class="act-icon" style="color:${cfg.color}">${cfg.icon}</span>${escapeHtml(act.name || "")}${cozeQueue}${cozeTicket}</div>
                ${(act.desc||act.note) ? `<div class="act-note">${escapeHtml(act.desc||act.note)}</div>` : ""}
                ${durFmt ? `<div class="act-duration">⏱ ${durFmt}</div>` : ""}
                ${(act.real_vibe||act.real_vibes) ? `<div class="act-vibes">"${escapeHtml(act.real_vibe||act.real_vibes)}"</div>` : ""}
                ${(act.insider_tip||act.insider_tips) ? `<div class="act-tips"><span class="act-tips-icon">💡</span>${escapeHtml(act.insider_tip||act.insider_tips)}</div>` : ""}
              </div>
              <span class="act-cost${costCls}">${costFmt}</span>
            </div>`;
        }).join("");
        const hotelHtml = d.hotel ? (() => {
          const h = d.hotel;
          const hc = h.cost_cny > 0 ? `<span class="act-hotel-cost">¥${Number(h.cost_cny).toLocaleString()}/晚</span>` : "";
          return `<div class="act-hotel-card"><div class="act-hotel-header"><span>🏨</span><span class="act-hotel-name">${escapeHtml(h.name||"")}</span>${h.type?`<span class="act-hotel-type">${escapeHtml(h.type)}</span>`:""} ${hc}</div>${h.area?`<div class="act-hotel-area">📍 ${escapeHtml(h.area)}</div>`:""}${h.tip?`<div class="act-hotel-tip">💡 ${escapeHtml(h.tip)}</div>`:""}</div>`;
        })() : "";
        const budgetHtml = d.day_budget ? (() => {
          const b = d.day_budget;
          const parts = [b.transport>0?`🚇 交通¥${b.transport}`:null,b.meals>0?`🍽 餐饮¥${b.meals}`:null,b.activities>0?`🎯 游览¥${b.activities}`:null,b.hotel>0?`🏨 住宿¥${b.hotel}`:null].filter(Boolean).join(" · ");
          return `<div class="act-day-budget"><div class="act-day-budget-items">${parts}</div>${b.total>0?`<div class="act-day-budget-total">合计 ¥${b.total}</div>`:""}</div>`;
        })() : "";
        return `<div class="plan-day-panel${di === 0 ? " active" : ""}" data-panel="${di}" id="${cardId}-panel-${di}">
          <div class="day-panel-label">${escapeHtml(d.label || `Day ${d.day}`)}</div>
          ${icHtml}<div class="day-activities">${activities}</div>${hotelHtml}${budgetHtml}
        </div>`;
      }).join("");

      const arrivalNote = cd.arrival_note
        ? `<div class="arrival-banner">✈️ ${escapeHtml(cd.arrival_note)}</div>`
        : "";

      dayItineraryHtml = `
        <div class="plan-itinerary-section">
          <div class="plan-section-header">${pickText("逐日行程（推荐方案）","Day-by-Day Itinerary","日程表","일정표")}</div>
          ${arrivalNote}
          ${dayTabsHtml}
          <div class="plan-day-panels" id="${cardId}-panels">${dayPanelsHtml}</div>
        </div>`;
    } else if (hasPlans) {
      // Summary mode: days will be fetched on demand when user clicks "查看逐日行程"
      dayItineraryHtml = `
        <div class="plan-itinerary-section plan-itinerary-section--pending" style="display:none" id="${cardId}-itinerary-pending">
          <div class="plan-section-header">${pickText("逐日行程","Day-by-Day Itinerary","日程表","일정표")}</div>
          <div class="plan-detail-loading">
            <div class="plan-detail-spinner"></div>
            <span>${pickText("正在生成逐日行程...","Generating day-by-day itinerary...","日程を生成中...","일정 생성 중...")}</span>
          </div>
        </div>`;
    }

    clearChatCards({ keepDeliverable: true, keepSmartReply: false });
    addCard(`
      <article class="card smart-reply-card plan-card plan-card--v2" id="${cardId}"
        data-plans="${escapeHtml(JSON.stringify(cd.plans || []))}"
        data-destination="${escapeHtml(cd.destination || "")}"
        data-duration="${cd.duration_days || 3}"
        data-message="${escapeHtml(state.lastPlanMessage || "")}"
        data-language="${state.uiLanguage || "ZH"}"
        data-city="${escapeHtml(getCurrentCity() || "")}"
        data-constraints="${escapeHtml(JSON.stringify(state.selectedConstraints || {}))}"
        data-spoken="${escapeHtml(spokenText || "")}">
        <div class="plan-card-hero">
          <img class="plan-card-hero-img" src="${_getCityHeroUrl(cd.destination || "")}"
            alt="${escapeHtml(cd.destination || "")}" loading="lazy"
            onerror="this.style.opacity='0'">
          <div class="plan-card-hero-overlay">
            <h3 class="plan-card-title">${escapeHtml(cd.title || pickText("定制方案对比","Custom Plans","カスタムプラン","맞춤 플랜"))}</h3>
            ${dest || dur ? `<div class="plan-card-meta">📍 ${dest ? dest + "  ·  " : ""}${dur}${pickText("天","d","日","일")}${pax > 1 ? "  ·  " + pax + pickText("人","pax","名","명") : ""}</div>` : ""}
          </div>
        </div>
        ${spokenText ? `
        <div class="plan-analysis-block">
          <div class="plan-analysis-label">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 5a1 1 0 00-1 1v5l3.5 2a1 1 0 001-1.73L13 12.27V8a1 1 0 00-1-1z"/></svg>
            ${pickText("AI 方案解读","AI Insights","AI の解説","AI 인사이트")}
          </div>
          <div class="plan-analysis-text">${escapeHtml(spokenText)}</div>
        </div>` : ""}
        <div class="plan-section-header">${pickText("选择你的方案","Choose Your Plan","プランを選ぶ","플랜 선택")}</div>
        <div class="cx-plan-list">${planCards}</div>
        ${dayItineraryHtml}
        <p class="payment-disclaimer">${pickText("确认后 Cross X 为您锁定资源并安排预订 · 不收取手续费", "Confirm to lock all bookings · No service fee", "", "")}</p>
      </article>
    `);
    // Post-render: typewriter + coupon fetch
    setTimeout(() => {
      const articleEl = document.getElementById(cardId);
      if (!articleEl) return;
      // Typewriter on analysis text
      if (spokenText) {
        const analysisEl = articleEl.querySelector(".plan-analysis-text");
        if (analysisEl) animateAnalysisText(analysisEl, spokenText, 18);
      }
      // Fetch live coupon data for each plan's status bar
      const dest = cd.destination || "";
      if (dest) {
        (cd.plans || []).forEach((_, idx) => {
          const barEl = articleEl.querySelector(`#cx-sb-${cardId}-${idx}`);
          if (barEl) fetchCouponBar(dest, barEl).catch(() => {});
        });
      }
    }, 150);
    if (spokenText) speakAssistantMessage(spokenText);
    // Save plan for spotlight panel
    state.lastAiPlan = { cd, spokenText };
    updateSpotlightWithAiPlan(cd, spokenText);
    return true;
  }

  // ── LEGACY MODE: single plan with days[] or items[] ────────────────────
  const total = Number(cd.total_price || 0);
  const totalFmt = total.toLocaleString();
  const tags = Array.isArray(cd.tags) ? cd.tags.map((t) => `<span class="plan-tag">${escapeHtml(t)}</span>`).join("") : "";

  const tripMeta = [
    cd.destination ? `📍 ${escapeHtml(cd.destination)}` : "",
    cd.duration_days ? `${cd.duration_days}${pickText("天", " days","日間", "일")}` : "",
    cd.pax > 1 ? `${cd.pax}${pickText("人", " pax","名", "명")}` : "",
    cd.arrival_date ? `${escapeHtml(cd.arrival_date)}抵达` : "",
  ].filter(Boolean).join("  ·  ");

  // ── Hotel strip ───────────────────────────────────────────────────────
  let hotelHtml = "";
  if (cd.hotel && cd.hotel.name) {
    const h = cd.hotel;
    const hotelTotalFmt = Number(h.total || 0).toLocaleString();
    hotelHtml = `
      <div class="plan-hotel-strip">
        <img class="plan-hotel-img" src="${_getCityHeroUrl(cd.destination || h.name || "")}" alt="${escapeHtml(h.name)}" loading="lazy" onerror="this.style.display='none'">
        <div class="plan-hotel-info">
          <div class="plan-hotel-name">${escapeHtml(h.name)}</div>
          <div class="plan-hotel-meta">${escapeHtml(h.type || "")}${h.price_per_night ? ` · ¥${h.price_per_night}/晚` : ""}${cd.duration_days ? ` · ${cd.duration_days}晚` : ""}</div>
        </div>
        <span class="plan-hotel-price">¥${hotelTotalFmt}</span>
      </div>`;
  }

  // ── Day tabs + panels ─────────────────────────────────────────────────
  let dayTabsHtml = "";
  let dayPanelsHtml = "";

  if (hasDays) {
    const cardId = "plan-" + Math.random().toString(36).slice(2, 8);
    dayTabsHtml = `<div class="plan-day-tabs" id="${cardId}-tabs">` +
      cd.days.map((d, i) =>
        `<button class="day-tab${i === 0 ? " active" : ""}" onclick="switchPlanDay('${cardId}',${i})" data-day="${i}">Day ${d.day}</button>`
      ).join("") +
      `</div>`;

    dayPanelsHtml = cd.days.map((d, di) => {
      const _IC_ICON = { flight: "✈️", hsr: "🚄", bus: "🚌", car: "🚗" };
      const _icHtml2 = d.intercity_transport?.from ? (() => {
        const ic = d.intercity_transport;
        const cost2 = ic.cost_cny > 0 ? `<span class="act-intercity-cost">¥${Number(ic.cost_cny).toLocaleString()}</span>` : "";
        return `<div class="act-intercity"><div class="act-intercity-header"><span class="act-intercity-icon">${_IC_ICON[ic.mode]||"🚌"}</span><span class="act-intercity-route">${escapeHtml(ic.from||"")} → ${escapeHtml(ic.to||"")}</span>${cost2}</div>${ic.detail?`<div class="act-intercity-detail">${escapeHtml(ic.detail)}</div>`:""}${ic.tip?`<div class="act-intercity-tip">💡 ${escapeHtml(ic.tip)}</div>`:""}</div>`;
      })() : "";
      const activities = (d.activities || []).map((act) => {
        const cfg = ACT_TYPE_CONFIG[act.type] || ACT_TYPE_CONFIG.default;
        const imgKw = encodeURIComponent(act.image_keyword || act.name || "");
        const costRaw = act.cost_cny || act.cost || 0;
        const costFmt = costRaw > 0 ? `¥${Number(costRaw).toLocaleString()}` : "免费";
        const costCls  = costRaw === 0 ? " act-cost--free" : "";
        const mins = act.duration_min || 0;
        const durFmt = mins > 0 ? (mins >= 60 ? `${Math.floor(mins/60)}h${mins%60?""+mins%60+"m":""}` : `${mins}m`) : "";
        const transitHtml = act.transport_to
          ? `<div class="act-transit"><span>🗺</span>${escapeHtml(act.transport_to)}</div>` : "";
        const timeBadge = act.time ? `<span class="act-time-badge">${escapeHtml(act.time)}</span>` : "";
        const isFood2 = /food|restaurant|eat|meal|lunch|dinner|breakfast/i.test(act.type||"") || act.type === "food";
        const isSight2 = /sight|attraction|museum|temple|park|activity/i.test(act.type||"") || act.type === "sightseeing";
        const cozeQueue2 = isFood2 && state.cozeData?.restaurant_queue > 0
          ? `<span class="act-coze-queue">⏳ 排队约${state.cozeData.restaurant_queue}分钟</span>` : "";
        const cozeTicket2 = isSight2 && state.cozeData?.ticket_availability
          ? `<span class="act-coze-ticket">🟢 有票·可代订</span>` : "";
        return `${transitHtml}
          <div class="act-row">
            <img class="act-img" src="https://picsum.photos/seed/${imgKw}/120/80" alt="${escapeHtml(act.name || "")}" loading="lazy" onerror="this.style.display='none'">
            <div class="act-body">
              <div class="act-name">${timeBadge}<span class="act-icon" style="color:${cfg.color}">${cfg.icon}</span>${escapeHtml(act.name || "")}${cozeQueue2}${cozeTicket2}</div>
              ${(act.desc||act.note) ? `<div class="act-note">${escapeHtml(act.desc||act.note)}</div>` : ""}
              ${durFmt ? `<div class="act-duration">⏱ ${durFmt}</div>` : ""}
              ${(act.real_vibe||act.real_vibes) ? `<div class="act-vibes">"${escapeHtml(act.real_vibe||act.real_vibes)}"</div>` : ""}
              ${(act.insider_tip||act.insider_tips) ? `<div class="act-tips"><span class="act-tips-icon">💡</span>${escapeHtml(act.insider_tip||act.insider_tips)}</div>` : ""}
            </div>
            <span class="act-cost${costCls}">${costFmt}</span>
          </div>`;
      }).join("");
      const _hotelHtml2 = d.hotel ? (() => {
        const h = d.hotel;
        const hc = h.cost_cny > 0 ? `<span class="act-hotel-cost">¥${Number(h.cost_cny).toLocaleString()}/晚</span>` : "";
        return `<div class="act-hotel-card"><div class="act-hotel-header"><span>🏨</span><span class="act-hotel-name">${escapeHtml(h.name||"")}</span>${h.type?`<span class="act-hotel-type">${escapeHtml(h.type)}</span>`:""} ${hc}</div>${h.area?`<div class="act-hotel-area">📍 ${escapeHtml(h.area)}</div>`:""}${h.tip?`<div class="act-hotel-tip">💡 ${escapeHtml(h.tip)}</div>`:""}</div>`;
      })() : "";
      const _budgetHtml2 = d.day_budget ? (() => {
        const b = d.day_budget;
        const parts = [b.transport>0?`🚇 交通¥${b.transport}`:null,b.meals>0?`🍽 餐饮¥${b.meals}`:null,b.activities>0?`🎯 游览¥${b.activities}`:null,b.hotel>0?`🏨 住宿¥${b.hotel}`:null].filter(Boolean).join(" · ");
        return `<div class="act-day-budget"><div class="act-day-budget-items">${parts}</div>${b.total>0?`<div class="act-day-budget-total">合计 ¥${b.total}</div>`:""}</div>`;
      })() : "";
      return `<div class="plan-day-panel${di === 0 ? " active" : ""}" data-panel="${di}" id="${cardId}-panel-${di}">
        <div class="day-panel-label">${escapeHtml(d.label || `Day ${d.day}`)}</div>
        ${_icHtml2}<div class="day-activities">${activities}</div>${_hotelHtml2}${_budgetHtml2}
      </div>`;
    }).join("");

    // Wrap panels
    dayPanelsHtml = `<div class="plan-day-panels" id="${cardId}-panels">${dayPanelsHtml}</div>`;
  } else {
    // Legacy items[] fallback
    dayPanelsHtml = `<div class="plan-items">` + cd.items.map((item) => {
      const imgKw = encodeURIComponent(item.image_keyword || item.name || "");
      const priceFmt = Number(item.price || 0).toLocaleString();
      return `<div class="cd-item-row">
        <img class="cd-item-img" src="https://picsum.photos/seed/${imgKw}/120/80" alt="${escapeHtml(item.name || "")}" loading="lazy" onerror="this.style.display='none'">
        <div class="cd-item-body">
          <div class="cd-item-name">${escapeHtml(item.name || "")}</div>
          <div class="cd-item-desc">${escapeHtml(item.description || "")}</div>
        </div>
        <span class="cd-item-price">¥${priceFmt}</span>
      </div>`;
    }).join("") + `</div>`;
  }

  // ── Budget breakdown bar ──────────────────────────────────────────────
  const bb = cd.budget_breakdown || {};
  const bbEntries = [
    { label: pickText("住宿","Hotel","宿박","숙소"), key: "accommodation", color: "#2d87f0" },
    { label: pickText("交通","Transport","交通","교통"), key: "transport", color: "#10b981" },
    { label: pickText("餐饮","Food","食事","식사"), key: "meals", color: "#f59e0b" },
    { label: pickText("活动","Activities","アクティビティ","활동"), key: "activities", color: "#8b5cf6" },
    { label: pickText("杂项","Misc.","その他","기타"), key: "misc", color: "#94a3b8" },
  ].filter((e) => bb[e.key] > 0);
  const bbTotal = bbEntries.reduce((s, e) => s + (bb[e.key] || 0), 0) || 1;
  const budgetBar = bbEntries.map((e) => {
    const pct = Math.max(4, Math.round(bb[e.key] / bbTotal * 100));
    return `<div class="bb-seg" style="width:${pct}%;background:${e.color}" title="${e.label} ¥${Number(bb[e.key]).toLocaleString()}"></div>`;
  }).join("");
  const budgetLegend = bbEntries.map((e) =>
    `<span class="bb-legend-item"><span class="bb-dot" style="background:${e.color}"></span>${e.label} ¥${Number(bb[e.key]).toLocaleString()}</span>`
  ).join("");

  const btn = cd.action_button || {};
  const btnText = btn.text || `确认方案 · 开始预订 ¥${totalFmt}`;
  const btnPayload = JSON.stringify(btn.payload || {});

  const arrivalNote = cd.arrival_note
    ? `<div class="arrival-banner">✈️ ${escapeHtml(cd.arrival_note)}</div>`
    : "";

  clearChatCards({ keepDeliverable: true, keepSmartReply: false });
  addCard(`
    <article class="card smart-reply-card plan-card">
      <div class="plan-card-header">
        <div class="plan-card-header-left">
          <h3 class="plan-card-title">${escapeHtml(cd.title || "定制行程方案")}</h3>
          ${tripMeta ? `<div class="plan-card-meta">${tripMeta}</div>` : ""}
        </div>
        <div class="plan-total-price">
          <span class="price-label">总计</span>
          <span class="price-amount">¥${escapeHtml(totalFmt)}</span>
        </div>
      </div>
      ${tags ? `<div class="plan-tags">${tags}</div>` : ""}
      ${spokenText ? `
      <div class="plan-analysis-block">
        <div class="plan-analysis-label">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 110 20A10 10 0 0112 2zm0 5a1 1 0 00-1 1v5l3.5 2a1 1 0 001-1.73L13 12.27V8a1 1 0 00-1-1z"/></svg>
          AI 方案解读
        </div>
        <div class="plan-analysis-text">${escapeHtml(spokenText)}</div>
      </div>` : ""}
      ${arrivalNote}
      ${hotelHtml}
      ${dayTabsHtml}
      ${dayPanelsHtml}
      ${budgetBar ? `<div class="budget-breakdown-bar">${budgetBar}</div>
      <div class="bb-legend">${budgetLegend}</div>` : ""}
      <button class="payment-confirm-btn"
        data-payload="${escapeHtml(btnPayload)}"
        onclick="handleCardPaymentConfirm(this)">
        确认行程 · 开始预订 ¥${escapeHtml(totalFmt)}
      </button>
      <p class="payment-disclaimer">${pickText("确认后 Cross X 为您锁定资源并安排预订 · 不收取手续费", "Confirm to lock all bookings · No service fee", "", "")}</p>
    </article>
  `);
  if (spokenText) speakAssistantMessage(spokenText);
  return true;
}

// ── Day tab switcher (called from inline onclick) ─────────────────────────
function switchPlanDay(cardId, dayIdx) {
  const tabs = document.getElementById(`${cardId}-tabs`);
  const panels = document.getElementById(`${cardId}-panels`);
  if (!tabs || !panels) return;
  tabs.querySelectorAll(".day-tab").forEach((t, i) => t.classList.toggle("active", i === dayIdx));
  panels.querySelectorAll(".plan-day-panel").forEach((p, i) => p.classList.toggle("active", i === dayIdx));
}

// ── Plan detail reveal — shows day-by-day itinerary without triggering booking
// For complex itineraries (summaryOnly mode), fetches days on demand via /api/plan/detail
async function revealPlanItinerary(cardId, planId, planIdx, btn) {
  const card = document.getElementById(cardId);
  if (!card) return;

  // Toggle behaviour: if already showing, hide
  const itinerarySec = card.querySelector(".plan-itinerary-section");
  if (itinerarySec && itinerarySec.style.display !== "none" && !itinerarySec.classList.contains("plan-itinerary-section--pending")) {
    itinerarySec.style.display = "none";
    if (btn) {
      btn.textContent = btn.dataset.origText || pickText("查看逐日行程 ↓","View Itinerary ↓","日程を見る ↓","일정 보기 ↓");
      btn.classList.remove("opt-detail-btn--active");
    }
    card.querySelectorAll(".cx-list-card").forEach((c) => c.classList.remove("cx-list-card--active"));
    return;
  }

  // Visually highlight which plan's itinerary we're viewing
  card.querySelectorAll(".cx-list-card").forEach((c) => {
    const isThis = c.dataset.planId === planId;
    c.classList.toggle("cx-list-card--active", isThis);
  });
  // Update button state
  if (btn) {
    if (!btn.dataset.origText) btn.dataset.origText = btn.textContent;
    btn.textContent = pickText("收起行程 ↑","Hide Itinerary ↑","日程を閉じる ↑","일정 닫기 ↑");
    btn.classList.add("opt-detail-btn--active");
  }

  // Helper to update section header
  const updateHeader = (sec) => {
    const secHeader = sec.querySelector(".plan-section-header");
    if (secHeader) {
      const optCard = card.querySelector(`.cx-list-card[data-plan-id="${planId}"]`);
      const planTag = optCard?.querySelector(".cx-lc-tag")?.textContent || planId;
      secHeader.innerHTML = pickText(
        `逐日行程 · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span> 方案`,
        `Itinerary · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>`,
        `日程 · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>`,
        `일정 · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>`,
      );
    }
  };

  // Case 1: days already rendered (non-pending section)
  if (itinerarySec && !itinerarySec.classList.contains("plan-itinerary-section--pending")) {
    itinerarySec.style.display = "";
    updateHeader(itinerarySec);
    // P3: on mobile, clone into Bottom Sheet instead of inline scroll
    if (window.innerWidth <= 768) {
      const clone = itinerarySec.cloneNode(true);
      clone.style.display = "";
      openSheet(pickText("逐日行程", "Itinerary","日程", "일정"), clone);
    } else {
      setTimeout(() => itinerarySec.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
    return;
  }

  // Case 2: pending section — need to fetch days on demand
  if (itinerarySec && itinerarySec.classList.contains("plan-itinerary-section--pending")) {
    itinerarySec.style.display = "";
    updateHeader(itinerarySec);
    // P3: on mobile, move section into Bottom Sheet (live ref — fetchDetailBatch populates it)
    if (window.innerWidth <= 768) {
      openSheet(pickText("逐日行程", "Itinerary","日程", "일정"), itinerarySec);
    } else {
      setTimeout(() => itinerarySec.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }

    // Only fetch once — check if already loading or done
    if (itinerarySec.dataset.fetched) return;
    itinerarySec.dataset.fetched = "1";

    // Get context from card data attributes
    const message = card.dataset.message || state.lastPlanMessage || "";
    const language = card.dataset.language || state.uiLanguage || "ZH";
    const city = card.dataset.city || getCurrentCity() || "";
    let constraints = {};
    try { constraints = JSON.parse(card.dataset.constraints || "{}"); } catch { /* ignore */ }

    // Get the selected plan summary — enrich with card-level fields
    let plans = [];
    try { plans = JSON.parse(card.dataset.plans || "[]"); } catch { /* ignore */ }
    const planSummary = plans[planIdx] || plans.find((p) => p.id === planId) || plans[0] || {};
    if (!planSummary.destination) planSummary.destination = card.dataset.destination || "";
    // tier: plan objects use `id` (budget/balanced/premium), detail API expects `tier`
    if (!planSummary.tier) planSummary.tier = planSummary.id || "balanced";
    // duration_days: stored on article element, not on individual plan objects
    if (!planSummary.duration_days) planSummary.duration_days = parseInt(card.dataset.duration || "3", 10) || 3;

    // Render activity rows HTML (shared between initial load and "load more")
    const buildDayPanelHtml = (days, startGlobalIdx) =>
      days.map((d, di) => {
        const globalIdx = startGlobalIdx + di;

        // ── Intercity transport banner (flight/HSR/bus) ──────────────────────
        const IC_ICON = { flight: "✈️", hsr: "🚄", bus: "🚌", car: "🚗" };
        const intercityHtml = d.intercity_transport?.from ? (() => {
          const ic = d.intercity_transport;
          const modeIcon = IC_ICON[ic.mode] || "🚌";
          const cost = ic.cost_cny > 0 ? `<span class="act-intercity-cost">¥${Number(ic.cost_cny).toLocaleString()}</span>` : "";
          return `<div class="act-intercity">
            <div class="act-intercity-header">
              <span class="act-intercity-icon">${modeIcon}</span>
              <span class="act-intercity-route">${escapeHtml(ic.from || "")} → ${escapeHtml(ic.to || "")}</span>
              ${cost}
            </div>
            ${ic.detail ? `<div class="act-intercity-detail">${escapeHtml(ic.detail)}</div>` : ""}
            ${ic.tip ? `<div class="act-intercity-tip">💡 ${escapeHtml(ic.tip)}</div>` : ""}
          </div>`;
        })() : "";

        // ── Activity rows ────────────────────────────────────────────────────
        const activities = (d.activities || []).map((act) => {
          const cfg = ACT_TYPE_CONFIG[act.type] || ACT_TYPE_CONFIG.default;
          const imgKw = encodeURIComponent(act.image_keyword || act.name || "");
          const costRaw = act.cost_cny || act.cost || 0;
          const costFmt = costRaw > 0 ? `¥${Number(costRaw).toLocaleString()}` :"免费";
          const costCls  = costRaw === 0 ? " act-cost--free" : "";
          const mins = act.duration_min || 0;
          const durFmt = mins > 0
            ? (mins >= 60 ? `${Math.floor(mins / 60)}h${mins % 60 ? (mins % 60) + "m" : ""}` : `${mins}m`)
            : "";
          // Transit strip above the activity card
          const transitHtml = act.transport_to
            ? `<div class="act-transit"><span>🗺</span>${escapeHtml(act.transport_to)}</div>`
            : "";
          const timeBadge = act.time
            ? `<span class="act-time-badge">${escapeHtml(act.time)}</span>`
            : "";
          // P8.3: Coze real-time enrichment badges
          const isFood3 = /food|restaurant|eat|meal|lunch|dinner|breakfast/i.test(act.type||"") || act.type === "food";
          const isSight3 = /sight|attraction|museum|temple|park|activity/i.test(act.type||"") || act.type === "sightseeing";
          const cozeQueue3 = isFood3 && state.cozeData?.restaurant_queue > 0
            ? `<span class="act-coze-queue">⏳ 排队约${state.cozeData.restaurant_queue}分钟</span>` : "";
          const cozeTicket3 = isSight3 && state.cozeData?.ticket_availability
            ? `<span class="act-coze-ticket">🟢 有票·可代订</span>` : "";
          return `${transitHtml}
            <div class="act-row">
              <img class="act-img" src="https://picsum.photos/seed/${imgKw}/120/80" alt="${escapeHtml(act.name || "")}" loading="lazy" onerror="this.style.display='none'">
              <div class="act-body">
                <div class="act-name">${timeBadge}<span class="act-icon" style="color:${cfg.color}">${cfg.icon}</span>${escapeHtml(act.name || "")}${cozeQueue3}${cozeTicket3}</div>
                ${act.desc ? `<div class="act-note">${escapeHtml(act.desc)}</div>` : ""}
                ${durFmt ? `<div class="act-duration">⏱ ${durFmt}</div>` : ""}
                ${act.real_vibe ? `<div class="act-vibes">"${escapeHtml(act.real_vibe)}"</div>` : ""}
                ${act.insider_tip ? `<div class="act-tips"><span class="act-tips-icon">💡</span>${escapeHtml(act.insider_tip)}</div>` : ""}
              </div>
              <span class="act-cost${costCls}">${costFmt}</span>
            </div>`;
        }).join("");

        // ── Hotel card ───────────────────────────────────────────────────────
        const hotelHtml = d.hotel ? (() => {
          const h = d.hotel;
          const cost = h.cost_cny > 0 ? `<span class="act-hotel-cost">¥${Number(h.cost_cny).toLocaleString()}/晚</span>` : "";
          return `<div class="act-hotel-card">
            <div class="act-hotel-header">
              <span>🏨</span>
              <span class="act-hotel-name">${escapeHtml(h.name || "")}</span>
              ${h.type ? `<span class="act-hotel-type">${escapeHtml(h.type)}</span>` : ""}
              ${cost}
            </div>
            ${h.area ? `<div class="act-hotel-area">📍 ${escapeHtml(h.area)}</div>` : ""}
            ${h.tip ? `<div class="act-hotel-tip">💡 ${escapeHtml(h.tip)}</div>` : ""}
          </div>`;
        })() : "";

        // ── Day budget strip ─────────────────────────────────────────────────
        const budgetHtml = d.day_budget ? (() => {
          const b = d.day_budget;
          const parts = [
            b.transport  > 0 ? `🚇 交通¥${b.transport}`  : null,
            b.meals      > 0 ? `🍽 餐饮¥${b.meals}`      : null,
            b.activities > 0 ? `🎯 游览¥${b.activities}` : null,
            b.hotel      > 0 ? `🏨 住宿¥${b.hotel}`      : null,
          ].filter(Boolean).join(" · ");
          return `<div class="act-day-budget">
            <div class="act-day-budget-items">${parts}</div>
            ${b.total > 0 ? `<div class="act-day-budget-total">合计 ¥${b.total}</div>` : ""}
          </div>`;
        })() : "";

        return `<div class="plan-day-panel${globalIdx === 0 ? " active" : ""}" data-panel="${globalIdx}" id="${cardId}-panel-${globalIdx}">
          <div class="day-panel-label">${escapeHtml(d.label || `Day ${d.day}`)}</div>
          ${intercityHtml}
          <div class="day-activities">${activities}</div>
          ${hotelHtml}
          ${budgetHtml}
        </div>`;
      }).join("");

    // Fetch days batch and render; appends more tabs/panels if subsequent batch
    const fetchDetailBatch = async (startDay) => {
      try {
        const result = await api("/api/plan/detail", {
          method: "POST",
          body: JSON.stringify({ message, language, city, constraints, planSummary, startDay }),
        });

        if (!result.ok || !Array.isArray(result.days) || !result.days.length) {
          const loadEl = itinerarySec.querySelector(".plan-detail-loading");
          if (loadEl) loadEl.innerHTML =
            `<span style="color:#ef4444">${pickText("行程详情加载失败，请重试","Failed to load itinerary","日程の読み込みに失敗","일정 로드 실패")}</span>`;
          return;
        }

        const isFirstBatch = startDay === 1;
        const globalOffset = startDay - 1;  // Day 1 → index 0

        // Get or create tabs container and panels container
        let tabsContainer = itinerarySec.querySelector(`#${cardId}-tabs`);
        let panelsContainer = itinerarySec.querySelector(`#${cardId}-panels`);

        if (isFirstBatch) {
          const arrivalBanner = result.arrival_note
            ? `<div class="arrival-banner">✈️ ${escapeHtml(result.arrival_note)}</div>` : "";
          const dayTabsHtml = `<div class="plan-day-tabs" id="${cardId}-tabs">` +
            result.days.map((d, i) =>
              `<button class="day-tab${i === 0 ? " active" : ""}" onclick="switchPlanDay('${cardId}',${i})">Day ${d.day}</button>`
            ).join("") + "</div>";

          const loadingEl = itinerarySec.querySelector(".plan-detail-loading");
          if (loadingEl) loadingEl.remove();
          itinerarySec.insertAdjacentHTML("beforeend",
            `${arrivalBanner}${dayTabsHtml}<div class="plan-day-panels" id="${cardId}-panels">${buildDayPanelHtml(result.days, globalOffset)}</div>`
          );
          itinerarySec.classList.remove("plan-itinerary-section--pending");
        } else {
          // Append tabs and panels for subsequent batches
          tabsContainer = itinerarySec.querySelector(`#${cardId}-tabs`);
          panelsContainer = itinerarySec.querySelector(`#${cardId}-panels`);
          if (tabsContainer) {
            result.days.forEach((d, i) => {
              const idx = globalOffset + i;
              const tab = document.createElement("button");
              tab.className = "day-tab";
              tab.textContent = `Day ${d.day}`;
              tab.onclick = () => switchPlanDay(cardId, idx);
              tabsContainer.appendChild(tab);
            });
          }
          if (panelsContainer) {
            panelsContainer.insertAdjacentHTML("beforeend", buildDayPanelHtml(result.days, globalOffset));
          }
        }

        // Remove existing "load more" button
        const existingMore = itinerarySec.querySelector(".plan-load-more-btn");
        if (existingMore) existingMore.remove();

        // If more days available, show "Load more" button
        if (result.hasMore && result.nextStartDay) {
          const nextStart = result.nextStartDay;
          const moreBtn = document.createElement("button");
          moreBtn.className = "plan-load-more-btn";
          moreBtn.textContent = pickText(`加载 Day ${nextStart}+ 行程 ↓`, `Load Day ${nextStart}+ ↓`, `Day ${nextStart}+ を読み込む`, `Day ${nextStart}+ 로드`);
          moreBtn.onclick = async () => {
            moreBtn.disabled = true;
            moreBtn.textContent = pickText("加载中...", "Loading...", "読み込み中...", "로딩 중...");
            await fetchDetailBatch(nextStart);
          };
          itinerarySec.appendChild(moreBtn);
        }

      } catch (err) {
        const loadEl = itinerarySec.querySelector(".plan-detail-loading");
        if (loadEl) loadEl.innerHTML = `<span style="color:#ef4444">${pickText("行程详情加载失败","Failed","失敗","실패")}: ${escapeHtml(err.message)}</span>`;
      }
    };

    fetchDetailBatch(1);
  }
}

// ── Plan option selector (3-plan comparison) ─────────────────────────────
function selectPlanOption(cardId, planId, planIdx, btn) {
  const card = document.getElementById(cardId);
  if (!card) return;
  // Highlight selected card
  card.querySelectorAll(".cx-list-card").forEach((c) => c.classList.remove("cx-list-card--selected"));
  const selected = btn?.closest(".cx-list-card")
                || card.querySelector(`.cx-list-card[data-plan-id="${planId}"]`);
  if (selected) selected.classList.add("cx-list-card--selected");
  // Mark CTA as booked
  card.querySelectorAll(".cx-lc-cta").forEach((b) => {
    if (b.closest(".cx-list-card") === selected) {
      b.textContent = pickText("✓ 已预订", "✓ Booked", "✓ 予約済", "✓ 예약됨");
    }
  });

  // Extract plan metadata stored on card element
  const plansRaw = card.dataset.plans || "[]";
  let plans = [];
  try { plans = JSON.parse(plansRaw); } catch { /* ignore */ }
  const chosenPlan = plans[planIdx] || plans.find((p) => p.id === planId) || {};
  const destination = card.dataset.destination || "";

  // Update itinerary section header to reflect selected plan
  const itinerarySec = card.querySelector(".plan-itinerary-section");
  if (itinerarySec) {
    const secHeader = itinerarySec.querySelector(".plan-section-header");
    if (secHeader) {
      const planTag = chosenPlan.tag || planId;
      const hotelName = chosenPlan.hotel?.name || "";
      secHeader.innerHTML = pickText(
        `逐日行程 · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>${hotelName ? ` · <span style="font-weight:400;opacity:.75">${escapeHtml(hotelName)}</span>` : ""}`,
        `Itinerary · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>${hotelName ? ` · <span style="font-weight:400;opacity:.75">${escapeHtml(hotelName)}</span>` : ""}`,
        `行程 · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>`,
        `일정 · <span style="color:var(--color-primary)">${escapeHtml(planTag)}</span>`,
      );
    }
    // Scroll to itinerary
    setTimeout(() => itinerarySec.scrollIntoView({ behavior: "smooth", block: "start" }), 200);
  }

  // Remove any old booking guide and render a fresh one
  const existingGuide = document.getElementById(`${cardId}-booking-guide`);
  if (existingGuide) existingGuide.remove();

  setTimeout(() => {
    const guideEl = document.createElement("div");
    guideEl.id = `${cardId}-booking-guide`;
    guideEl.className = "booking-guide-wrap";
    guideEl.innerHTML = buildBookingGuideHTML(chosenPlan, destination);
    const disclaimer = card.querySelector(".payment-disclaimer");
    if (disclaimer) card.insertBefore(guideEl, disclaimer);
    guideEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, 400);
}

// ── CrossX AI-Native Checkout Sheet ─────────────────────────────────────────
function buildBookingGuideHTML(plan, destination) {
  const hotelName = plan.hotel?.name || "";
  const hotelNights = plan.hotel?.total || 0;
  const hotelPPN = plan.hotel?.price_per_night || 0;
  const hotelDuration = hotelPPN > 0 && hotelNights > 0 ? Math.round(hotelNights / hotelPPN) : 0;
  const totalPrice = plan.total_price ? Number(plan.total_price) : 0;
  const tag = plan.tag || "方案";
  const bb = plan.budget_breakdown || {};
  const refId = "CX" + Date.now().toString(36).toUpperCase().slice(-6);

  const lineItems = [
    hotelName && { icon: "🏨", label: hotelName, sub: hotelDuration > 0 ? `¥${hotelPPN.toLocaleString()}/晚 × ${hotelDuration}晚` : "", amount: hotelNights },
    bb.transport && { icon: "✈️", label: pickText("城际交通", "City Transport","交通費", "교통비"), sub: plan.transport_plan?.split("，")[0] || "", amount: bb.transport },
    bb.meals && { icon: "🍜", label: pickText("餐饮", "Meals","食費", "식비"), sub: pickText("全程", "Full trip","全行程", "전체"), amount: bb.meals },
    bb.activities && { icon: "🎯", label: pickText("景点活动", "Activities","アクティビティ", "활동"), sub: pickText("门票含景区预约", "Tickets incl.","入場料込み", "입장료 포함"), amount: bb.activities },
    bb.misc && { icon: "🛍️", label: pickText("杂项", "Misc.","雑費", "기타"), sub: pickText("小费/购物/通讯", "Tips/Shopping/SIM","チップ/買物/通信", "팁/쇼핑/통신"), amount: bb.misc },
  ].filter(Boolean);

  const lineItemsHtml = lineItems.map((item) => `
    <div class="cx-checkout-row">
      <span class="cx-checkout-icon">${item.icon}</span>
      <div class="cx-checkout-info">
        <div class="cx-checkout-label">${escapeHtml(item.label)}</div>
        ${item.sub ? `<div class="cx-checkout-sub">${escapeHtml(item.sub)}</div>` : ""}
      </div>
      <div class="cx-checkout-amount">¥${Number(item.amount || 0).toLocaleString()}</div>
    </div>`).join("");

  return `
  <div class="cx-checkout-sheet">
    <div class="cx-checkout-header">
      <div class="cx-checkout-badge">${escapeHtml(tag)}</div>
      <div class="cx-checkout-title">${pickText("CrossX 托管方案", "CrossX Managed Plan", "CrossX 手配プラン", "CrossX 매니지드 플랜")}</div>
      <div class="cx-checkout-ref">#${refId}</div>
    </div>
    <div class="cx-checkout-items">${lineItemsHtml}</div>
    <div class="cx-checkout-divider"></div>
    <div class="cx-checkout-total-row">
      <span>${pickText("预计总费用", "Estimated Total","合計金額（予算）", "예상 총액")}</span>
      <strong class="cx-checkout-total">¥${totalPrice.toLocaleString()}</strong>
    </div>
    <div class="cx-checkout-note">
      ${pickText("💡 价格基于实时数据估算，CrossX 将在确认后锁定最优报价", "💡 Prices are estimated. CrossX will lock the best rate upon confirmation.", "💡 価格は見積もりです。確認後に最適料金を確定します。", "💡 가격은 견적입니다. 확인 후 최적 금액을 확정합니다.")}
    </div>
    <button class="cx-checkout-cta" onclick="crossXConfirmBooking(this, '${escapeHtml(hotelName)}', '${destination}', ${totalPrice})">
      <span class="cx-checkout-cta-icon">✦</span>
      ${pickText("CrossX 一键搞定全部预订", "CrossX: Book Everything Now", "CrossX が全て手配します", "CrossX 전체 예약 실행")}
    </button>
    <div class="cx-checkout-assist">
      <button class="cx-checkout-text-btn" onclick="addMessage(${JSON.stringify(pickText("我想修改方案", "I want to modify the plan","プランを変更したい", "플랜을 수정하고 싶어요"))}, 'user'); createTaskFromText(${JSON.stringify(pickText("我想修改方案", "modify plan","プランを変更したい", "플랜 수정"))})">
        ${pickText("调整方案", "Modify Plan","プランを調整", "플랜 조정")}
      </button>
      <span class="cx-checkout-dot">·</span>
      <button class="cx-checkout-text-btn" onclick="addMessage(${JSON.stringify(pickText("我需要礼宾顾问协助", "I need concierge help","コンシェルジュの助けが必要", "컨시어지 도움이 필요합니다"))}, 'user'); createTaskFromText(${JSON.stringify(pickText("需要礼宾顾问协助", "concierge help","コンシェルジュ支援", "컨시어지 지원"))})">
        ${pickText("礼宾顾问", "Concierge","コンシェルジュ", "컨시어지")}
      </button>
    </div>
  </div>`;
}

// ── CrossX in-app booking confirmation flow ───────────────────────────────────
function crossXConfirmBooking(btn, hotelName, destination, totalPrice) {
  btn.disabled = true;
  const sheet = btn.closest(".cx-checkout-sheet");
  const phases = pickText(
    ["正在核查库存...", "锁定最优价格...", "生成预订凭证...", "✓ 预订成功！"],
    ["Checking availability...", "Locking best rate...", "Generating confirmation...", "✓ Booked!"],
    ["在庫確認中...", "最適料金確定中...", "予約確定書生成中...", "✓ 予約完了！"],
    ["재고 확인 중...", "최적 요금 확정 중...", "예약 확인서 생성 중...", "✓ 예약 완료!"],
  );
  let step = 0;
  btn.textContent = phases[step];
  const interval = setInterval(() => {
    step++;
    if (step < phases.length - 1) {
      btn.textContent = phases[step];
    } else {
      clearInterval(interval);
      btn.textContent = phases[phases.length - 1];
      btn.classList.add("cx-checkout-cta--success");
      // Show confirmation panel
      const confId = "CXB" + Math.random().toString(36).slice(2,8).toUpperCase();
      const confHtml = `
        <div class="cx-confirm-panel">
          <div class="cx-confirm-icon">🎉</div>
          <div class="cx-confirm-title">${pickText("预订已提交", "Booking Submitted","予約提出済み", "예약 제출됨")}</div>
          <div class="cx-confirm-ref">${pickText("确认编号", "Ref.","確認番号", "참조 번호")}: ${confId}</div>
          <div class="cx-confirm-hotel">${escapeHtml(hotelName || destination)}</div>
          <div class="cx-confirm-total">¥${Number(totalPrice).toLocaleString()}</div>
          <div class="cx-confirm-note">${pickText("CrossX 礼宾团队将在1小时内联系您确认细节", "CrossX concierge will contact you within 1 hour to confirm details.", "CrossX コンシェルジュが1時間以内にご連絡します。", "CrossX 컨시어지가 1시간 이내에 연락드립니다.")}</div>
          <button class="cx-confirm-chat" onclick="addMessage(${JSON.stringify(pickText(`预订编号 ${confId} 已提交，CrossX 礼宾顾问什么时候联系我？`, `Booking ref ${confId} submitted. When will CrossX contact me?`, `予約番号 ${confId} を提出しました。CrossX はいつ連絡しますか？`, `예약 번호 ${confId} 제출됨. CrossX가 언제 연락하나요?`))}, 'user')">
            ${pickText("查看预订状态", "Check Booking Status","予約状況を確認", "예약 상태 확인")}
          </button>
        </div>`;
      if (sheet) sheet.insertAdjacentHTML("beforeend", confHtml);
    }
  }, 900);
}

// ── Typewriter animation for analysis text ───────────────────────────────
function animateAnalysisText(el, text, speedMs = 20) {
  if (!el || !text) return;
  el.textContent = "";
  el.classList.remove("done");
  let i = 0;
  const tick = () => {
    if (i < text.length) {
      el.textContent += text[i++];
      setTimeout(tick, speedMs);
    } else {
      el.classList.add("done");
    }
  };
  tick();
}

function renderItineraryOptionsCard(structured) {
  if (!structured || structured.response_type !== "options_card") return false;

  // NEW: card_data format (single focused plan card)
  if (structured.card_data) {
    return renderCardData(structured.card_data, structured.spoken_text);
  }

  // LEGACY: multi-option format (options array)
  const opts = Array.isArray(structured.options) ? structured.options : [];
  if (!opts.length) return false;

  const tagColors = { opt_a: "card-tier-a", opt_b: "card-tier-b card-tier-recommended", opt_c: "card-tier-c" };

  // Arrival transport banner
  const arrivalBanner = structured.arrival_transport
    ? `<div class="arrival-banner"><span class="arrival-icon">✈️→🏨</span> <strong>机场到酒店：</strong>${escapeHtml(structured.arrival_transport)}</div>`
    : "";

  const optCards = opts.map((opt, i) => {
    const isRecommended = i === 1;
    const tierClass = tagColors[opt.id] || "";
    const featureRows = Array.isArray(opt.features)
      ? opt.features.map((f) => `<li><span class="check-mark">✓</span> ${escapeHtml(f)}</li>`).join("")
      : "";
    const totalFmt = opt.total_cost ? Number(opt.total_cost).toLocaleString() : "-";

    // Budget breakdown bar
    const bd = opt.budget_breakdown || {};
    const total = opt.total_cost || 1;
    const breakdownBar = (bd.hotel || bd.transport || bd.meals)
      ? `<div class="budget-breakdown-bar">
          ${bd.hotel   ? `<div class="bb-seg bb-hotel"   style="width:${Math.round(bd.hotel/total*100)}%"   title="酒店 ¥${bd.hotel.toLocaleString()}">🏨</div>` : ""}
          ${bd.meals   ? `<div class="bb-seg bb-meals"   style="width:${Math.round(bd.meals/total*100)}%"   title="餐饮 ¥${bd.meals.toLocaleString()}">🍜</div>` : ""}
          ${bd.transport? `<div class="bb-seg bb-transport" style="width:${Math.round(bd.transport/total*100)}%" title="交通 ¥${bd.transport.toLocaleString()}">🚇</div>` : ""}
          ${bd.misc    ? `<div class="bb-seg bb-misc"    style="width:${Math.round(bd.misc/total*100)}%"    title="其他 ¥${bd.misc.toLocaleString()}">📦</div>` : ""}
        </div>
        <div class="bb-legend">
          ${bd.hotel    ? `<span>🏨 酒店 ¥${Number(bd.hotel).toLocaleString()}</span>` : ""}
          ${bd.meals    ? `<span>🍜 餐饮 ¥${Number(bd.meals).toLocaleString()}</span>` : ""}
          ${bd.transport? `<span>🚇 交通 ¥${Number(bd.transport).toLocaleString()}</span>` : ""}
          ${bd.misc     ? `<span>📦 其他 ¥${Number(bd.misc).toLocaleString()}</span>` : ""}
        </div>`
      : "";

    return `
      <article class="itinerary-option-card ${tierClass}">
        ${isRecommended ? `<div class="recommended-badge">${pickText("✦ 推荐 · 最佳性价比", "✦ Best Value","おすすめ", "추천")}</div>` : ""}
        <div class="option-header">
          <span class="option-tag">${escapeHtml(opt.tag || `方案 ${i + 1}`)}</span>
          <div class="option-price">
            <span class="price-currency">¥</span>
            <span class="price-amount">${escapeHtml(totalFmt)}</span>
          </div>
        </div>
        <div class="option-details">
          <div class="option-detail-row">
            <span class="detail-label">🏨</span>
            <span><strong>${escapeHtml(opt.hotel_name || "-")}</strong>${opt.hotel_area ? ` · ${escapeHtml(opt.hotel_area)}` : ""}${opt.hotel_includes_breakfast ? " <em>(含早)</em>" : ""} <span class="price-per-night">¥${Number(opt.hotel_price_per_night || 0).toLocaleString()}/晚</span></span>
          </div>
          <div class="option-detail-row">
            <span class="detail-label">🚇</span>
            <span>${escapeHtml(opt.transport_day_plan || opt.transport_plan || "-")}</span>
          </div>
          ${opt.translation_service ? `<div class="option-detail-row"><span class="detail-label">🗣️</span><span>${escapeHtml(opt.translation_service)}</span></div>` : ""}
          ${renderMealPlanSection(opt)}
        </div>
        ${breakdownBar}
        ${featureRows ? `<ul class="option-features">${featureRows}</ul>` : ""}
        ${renderPaymentPanel(opt)}
      </article>
    `;
  }).join("");

  const intro = escapeHtml(structured.spoken_text || "");
  const tripMeta = [
    structured.destination ? `📍 ${escapeHtml(structured.destination)}` : "",
    structured.duration_days ? `${structured.duration_days}${pickText("天", " days","日間", "일")}` : "",
    structured.pax ? `${structured.pax}${pickText("人", " people","名", "명")}` : "",
    structured.arrival_date ? `${pickText("到达", "Arrives","到着", "도착")} ${escapeHtml(structured.arrival_date)}` : "",
  ].filter(Boolean).join("  ·  ");

  clearChatCards({ keepDeliverable: true, keepSmartReply: false });
  addCard(`
    <article class="card smart-reply-card itinerary-card">
      <h3>${pickText("AI 为您规划了 3 套完整方案", "3 AI-Crafted Plans Ready to Book", "AIが3つのプランをご提案", "AI가 3개 플랜 준비")}</h3>
      ${tripMeta ? `<div class="status trip-meta">${tripMeta}</div>` : ""}
      ${intro ? `<div class="status spoken-intro">${intro}</div>` : ""}
      ${arrivalBanner}
      <div class="itinerary-options-grid">${optCards}</div>
    </article>
  `);
  if (structured.spoken_text) speakAssistantMessage(structured.spoken_text);
  return true;
}

// ── card_data payment confirm handler ──────────────────────────────────────
function handleCardPaymentConfirm(btn) {
  btn.textContent = pickText("✓ 已确认 · 请点击各平台完成预订", "✓ Confirmed · Tap each platform to book", "確認済み", "확인됨");
  btn.disabled = true;
  btn.style.background = "var(--color-success, #22c55e)";
  const card = btn.closest(".plan-card");
  if (card) {
    const links = card.querySelectorAll(".cd-item-book");
    links.forEach((l, idx) => setTimeout(() => l.classList.add("payment-item-link-pulse"), idx * 150));
  }
  addMessage(
    pickText(
      "方案已确认！请依次点击每项右侧的平台按钮完成预订 —— 🏨 携程预订酒店，🍜 美团找餐厅，🚇 滴滴叫车。",
      "Plan confirmed! Tap each platform button to complete bookings — Ctrip for hotel, Meituan for food, Didi for rides.",
      "プランが確定しました。各プラットフォームのボタンをタップして予約を完了させてください。",
      "플랜 확정! 각 플랫폼 버튼을 눌러 예약을 완료하세요."
    ),
    "agent"
  );
}

// ── Legacy multi-option payment confirm ────────────────────────────────────
function handleAgentPaymentConfirm(btn) {
  const optTag = btn.getAttribute("data-opt-tag") || "";
  const card = btn.closest(".itinerary-option-card");
  if (card) {
    document.querySelectorAll(".itinerary-option-card").forEach((c) => c.classList.remove("card-selected"));
    card.classList.add("card-selected");
  }
  btn.textContent = pickText("✓ 方案已确认 · 请逐一完成预订", "✓ Confirmed", "", "");
  btn.disabled = true;
  btn.style.background = "var(--color-success, #22c55e)";
  addMessage(pickText(`已选「${optTag}」方案！依次点击各平台按钮完成预订。`, `"${optTag}" confirmed! Tap each platform button.`, "", ""), "agent");
}

function parseSmartActionPayload(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    const decoded = decodeURIComponent(text);
    const data = JSON.parse(decoded);
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

async function runHotelBookingAction(payload, optionId = "unknown") {
  const data = payload && typeof payload === "object" ? payload : {};
  if (!data.hotelId || !data.roomId) {
    throw new Error("missing hotelId/roomId");
  }
  const guestNum = Math.max(1, Number(data.guestNum || 1));
  const guestList = Array.from({ length: guestNum }).map((_, idx) => ({
    name: idx === 0 ? "Guest" : `Guest ${idx + 1}`,
    idType: "passport",
    idNo: `P${Date.now().toString().slice(-6)}${idx + 1}`,
  }));
  const outOrderNo = `CXH${Date.now().toString().slice(-10)}${Math.floor(Math.random() * 900 + 100)}`;
  const created = await api("/hotel/order/create", {
    method: "POST",
    body: JSON.stringify({
      cityCode: data.cityCode || "",
      cityName: data.cityName || "",
      hotelId: data.hotelId,
      roomId: data.roomId,
      checkInDate: data.checkInDate,
      checkOutDate: data.checkOutDate,
      guestNum,
      guestList,
      contactName: "Cross X Guest",
      contactPhone: "18800000000",
      arrivalTime: "18:00",
      outOrderNo,
      totalPrice: data.totalPrice || 0,
      paymentMode: "wechat_c",
      autoPaid: true,
    }),
  });
  await loadOrders().catch(() => {});
  const paymentHint =
    created && created.payment && created.payment.mode === "wechat"
      ? pickText(
        `支付入口已生成：${created.payment.payUrl}`,
        `Payment link generated: ${created.payment.payUrl}`,
        `決済リンクを生成しました: ${created.payment.payUrl}`,
        `결제 링크 생성됨: ${created.payment.payUrl}`,
      )
      : pickText("订单已创建。", "Order created.","注文を作成しました。", "주문이 생성되었습니다.");
  addMessage(
    pickText(
      `已创建酒店订单 ${created.outOrderNo}，状态：${created.orderStatus}。${paymentHint}`,
      `Hotel order ${created.outOrderNo} created. Status: ${created.orderStatus}. ${paymentHint}`,
      `ホテル注文 ${created.outOrderNo} を作成。状態: ${created.orderStatus}。${paymentHint}`,
      `호텔 주문 ${created.outOrderNo} 생성. 상태: ${created.orderStatus}. ${paymentHint}`,
    ),
    "agent",
  );
  if (created && created.orderId) {
    await loadOrderDetail(created.orderId).catch(() => {});
  }
  await trackEvent("hotel_order_created_from_chat", { optionId, outOrderNo: created.outOrderNo || "" });
}

async function captureLocationFromBrowser(triggerBtn = null) {
  const loadingBtn = triggerBtn || el.locateBtn || null;
  await withButtonLoading(
    loadingBtn,
    pickText("定位中...", "Locating...", "現在地取得中...", "위치 확인중..."),
    async () => {
      if (!navigator.geolocation) {
        notify(
          pickText(
            "当前浏览器不支持定位。",
            "Browser geolocation is unavailable.",
            "このブラウザは位置情報に対応していません。",
            "브라우저 위치 기능을 사용할 수 없습니다.",
          ),
          "warning",
        );
        return;
      }
      notify(pickText("定位中...", "Locating...", "位置情報を取得中...", "위치를 확인하는 중..."), "info");
      try {
        const position = await new Promise((resolve, reject) => {
          navigator.geolocation.getCurrentPosition(resolve, reject, {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 120000,
          });
        });
        const coords = position.coords || {};
        const data = await api("/api/user/location", {
          method: "POST",
          body: JSON.stringify({
            lat: Number(coords.latitude),
            lng: Number(coords.longitude),
            accuracy: Number(coords.accuracy || 0),
            source: "browser_geolocation",
          }),
        });
        if (el.locationTag) {
          el.locationTag.textContent = `${data.city || "Shanghai"} · GPS`;
        }
        state.selectedConstraints.city = data.city || "Shanghai";
        state.selectedConstraints.origin = "current_location";
        syncChipSelectionFromConstraints();
        updateContextSummary();
        renderQuickGoals();
        notify(
          pickText(
            `定位成功：${data.city || "Shanghai"}`,
            `Location updated: ${data.city || "Shanghai"}`,
            `位置情報を更新しました: ${data.city || "Shanghai"}`,
            `위치가 업데이트되었습니다: ${data.city || "Shanghai"}`,
          ),
          "success",
        );
        await Promise.all([loadNearSuggestions(), loadAuditLogs()]);
      } catch (err) {
        notify(
          pickText(
            "定位失败，请检查浏览器定位权限。",
            "Location failed. Please check browser permission.",
            "位置情報の取得に失敗しました。ブラウザ権限を確認してください。",
            "위치 확인에 실패했습니다. 브라우저 권한을 확인하세요.",
          ),
          "error",
        );
      }
    },
  );
}

async function createTaskFromText(text) {
  // P2: abort any in-flight plan stream before starting a new request
  if (_currentPlanAbortController) {
    _currentPlanAbortController.abort();
    _currentPlanAbortController = null;
  }
  _currentPlanAbortController = new AbortController();
  const _planStreamSignal = _currentPlanAbortController.signal;
  setLoopProgress("intent");
  if (!Array.isArray(state.agentConversation.messages)) state.agentConversation.messages = [];
  // Build history from PREVIOUS turns only, BEFORE pushing current user message
  const conversationHistory = state.agentConversation.messages.slice(-6).map((m) => ({
    role: m.role,
    content: m.content,
  }));
  // Store for on-demand detail fetch (revealPlanItinerary uses this)
  state.lastPlanMessage = text;
  // Now store current user message and persist
  state.agentConversation.messages.push({ role: "user", content: text });
  if (state.agentConversation.messages.length > 20) state.agentConversation.messages = state.agentConversation.messages.slice(-20);
  saveConversationState();
  addMessage(text, "user");
  let smartReplyPromise = Promise.resolve(null);
  const loadingRow = addMessage(
    pickText(
      "我正在理解你的需求并生成可执行方案...",
      "I am reasoning on your request and generating executable options...",
      "要件を解析し、実行可能な提案を生成しています...",
      "요청을 분析하고 실행 가능한 옵션을 생성하고 있습니다...",
    ),
    "agent",
    { speak: false },
  );
  const skeletonId = renderTaskSkeletonCards();
  const inferred = inferConstraintsFromIntent(text);
  const mergedConstraints = {
    ...(state.selectedConstraints || {}),
    ...inferred,
  };
  state.selectedConstraints = mergedConstraints;
  // ── Use SSE streaming plan builder for all chat queries ──────────────────
  let _thinkingStream = null;
  let _planSkeleton   = null;
  let _thinkingPanel  = null;
  smartReplyPromise = (async () => {
    _thinkingStream = renderThinkingStream();
    _planSkeleton   = renderPlanSkeleton();
    try {
      return await consumePlanStream({
        message: text,
        language: state.uiLanguage,
        city: getCurrentCity(),
        constraints: mergedConstraints,
        conversationHistory,
        signal: _planStreamSignal,
        onStatusUpdate: (code, label) => {
          appendThinkingStep(_thinkingStream, code, label);
          // P8.7: Unified REALTIME_THINKING_MAP — no fixed hotel/generic text ever.
          // Context extracted once from the user's message (closure over `text`).
          const _dest   = _extractDestFromText(text);
          const _foodKw = _extractFoodKw(text);
          const _toolName = code.startsWith("TOOL:") ? code.slice(5) : code;
          const fn = REALTIME_THINKING_MAP[_toolName];
          applyThinkingIndicatorState(true,
            fn ? fn(_dest, _foodKw) : label || pickText("AI 处理中...", "AI processing...", "AI 処理中...", "AI 처리 중..."));
        },
        onThinking: (chunk) => {
          if (!_thinkingPanel) _thinkingPanel = createThinkingPanel();
          appendThinkingText(_thinkingPanel, chunk);
        },
        onSessionId: (id) => { savePlanSessionId(id); renderSessionBadge(true); },
      });
    } catch (e) {
      if (e && e.name === "AbortError") return null; // new message sent — silently discard
      notify(
        pickText(
          "AI 回复加载失败，已使用本地方案。",
          "AI reply failed, using local fallback.",
          "AI返答失敗、ローカル案を使用します。",
          "AI 응답 실패, 로컬 대체안 사용 중.",
        ),
        "warning",
      );
      return null;
    }
  })();
  syncChipSelectionFromConstraints();
  updateContextSummary();
  // auto-constraint notification hidden per UX design
  if (skeleton && el.chatSolutionStrip) skeleton.render(el.chatSolutionStrip, { count: 3, lines: 4 });
  setLoading("createTask", true);
  // P8.6: Intent-aware thinking phases — align copy to what the user is actually asking
  const _iFood  = /餐厅|美食|好吃|推荐.*吃|吃什么|小吃|eat|restaurant|food|dining/i.test(text);
  const _iStay  = /酒店|住宿|宾馆|民宿|hotel|hostel|stay|accommodation/i.test(text);
  const _iSight = /景点|游览|门票|博物馆|景区|打卡|scenic|attraction|museum/i.test(text);
  const thinkingPhases = _iFood ? [
    pickText("正在理解你的美食偏好...", "Parsing your food preferences...", "食の好みを解析中...", "음식 취향 분석 중..."),
    pickText("搜索本地特色餐厅...", "Searching local eateries...", "地元レストランを検索中...", "현지 맛집 검색 중..."),
    pickText("核查等位情况与预约渠道...", "Checking wait times & bookings...", "待ち時間と予約を確認中...", "대기 시간 및 예약 확인 중..."),
  ] : _iStay ? [
    pickText("正在分析你的住宿需求...", "Analyzing your stay requirements...", "宿泊ニーズを分析中...", "숙박 요구사항 분석 중..."),
    pickText("匹配最优性价比酒店...", "Matching best-value hotels...", "最適ホテルをマッチング中...", "최적 호텔 매칭 중..."),
    pickText("核查房型与实时价格...", "Verifying room types & live rates...", "部屋タイプと料金を確認中...", "객실 유형 및 요금 확인 중..."),
  ] : _iSight ? [
    pickText("正在解析景点偏好...", "Parsing sightseeing preferences...", "観光の好みを解析中...", "관광 취향 분석 중..."),
    pickText("核查门票状态与余票...", "Checking ticket availability...", "チケット在庫を確認中...", "티켓 재고 확인 중..."),
    pickText("生成逐日游览路线...", "Building day-by-day route...", "日程別ルートを生成中...", "일별 루트 생성 중..."),
  ] : [
    pickText("正在理解你的需求...", "Understanding your request...", "リクエストを解析中...", "요청을 분석 중..."),
    pickText("搜索候选方案...", "Searching candidate options...", "候補を検索中...", "후보를 검색 중..."),
    pickText("生成定制化建议...", "Generating tailored suggestions...", "カスタム提案を生成中...", "맞춤 제안 생성 중..."),
  ];
  let thinkingPhaseIdx = 0;
  setThinkingIndicator(true, thinkingPhases[0]);
  const thinkingRotateTimer = setInterval(() => {
    thinkingPhaseIdx = (thinkingPhaseIdx + 1) % thinkingPhases.length;
    applyThinkingIndicatorState(true, thinkingPhases[thinkingPhaseIdx]);
  }, 1500);
  try {
    const data = await api("/api/tasks", {
      method: "POST",
      body: JSON.stringify({
        userId: "demo",
        intent: text,
        constraints: mergedConstraints,
        tripId: state.activeTripId || undefined,
      }),
    });
    state.currentTask = data.task;
    if (data.task && data.task.tripId) {
      state.activeTripId = data.task.tripId;
      renderActiveTripHint();
      addMessage(
        pickText(
          `任务已加入行程 ${data.task.tripId}。`,
          `Task attached to trip ${data.task.tripId}.`,
          `タスクは旅程 ${data.task.tripId} に紐付け済みです。`,
          `작업이 트립 ${data.task.tripId} 에 연결되었습니다.`,
        ),
        "agent",
      );
    }
    renderAgentBrain(state.currentTask);
    setLoopProgress("plan");
    if (store) store.dispatch({ type: "SET_TASK", task: data.task });
    await trackEvent("intent_submitted", { textLen: text.length, constraints: mergedConstraints, inferred }, data.task.id);
    const smart = await smartReplyPromise;
    clearInterval(thinkingRotateTimer);
    setThinkingIndicator(false);
    // P2: fade out thinking stream + skeleton; collapse reasoning panel
    teardownThinkingUI(_thinkingStream, _planSkeleton);
    collapseThinkingPanel(_thinkingPanel);

    if (smart) {
      let replyContent = "";
      if (smart.response_type === "chat") {
        // ── CHAT: casual conversation bubble — no cards, no chips
        const txt = smart.spoken_text || smart.text || "";
        if (txt) addMessage(txt, "agent");
        replyContent = txt;
      } else if (smart.response_type === "quick_action") {
        // ── QUICK ACTION: immediate service widget (taxi, translation, emergency, etc.)
        renderQuickActionCard(smart);
        replyContent = smart.spoken_text || "";
      } else if (smart.response_type === "boundary_rejection") {
        // P2: security guardrail triggered — show red-bordered warning card
        renderBoundaryRejectionCard(smart.spoken_text || "");
        replyContent = smart.spoken_text || "";
      } else if (smart.response_type === "options_card") {
        // Render 3-tier itinerary cards
        renderItineraryOptionsCard(smart);
        replyContent = smart.spoken_text || "";
      } else if (smart.response_type === "clarify") {
        // ── STRICT: clarify ONLY renders chips, never alongside an error
        renderClarifyCard(smart);
        replyContent = smart.spoken_text || "";
      } else if (smart.response_type === "text" || smart.text) {
        // RAG or freeform text answer
        const txt = smart.text || smart.msg || "";
        if (txt) addMessage(txt, "agent");
        replyContent = txt;
      } else if (smart.type === "error") {
        // ── STRICT: error ONLY shows friendly error message, no chips, no auto-handoff
        const errMsg = smart.msg || pickText(
          "抱歉，您的行程方案生成遇到问题，请稍后重试或换个方式描述您的需求。",
          "Sorry, we couldn't generate your plan. Please retry or rephrase your request.",
          "プランの生成に問題が発生しました。しばらく待ってから再試行してください。",
          "플랜 생성에 문제가 발생했습니다. 잠시 후 다시 시도하거나 요청을 바꿔 보세요.",
        );
        addMessage(errMsg, "agent");
        replyContent = errMsg;
        // No automatic handoff — let the user decide to retry
      } else if (smart.reply) {
        // Legacy /api/chat/reply fallback (backward compat)
        renderSmartReplyCard(smart);
        replyContent = smart.reply;
      }
      if (replyContent) {
        if (!Array.isArray(state.agentConversation.messages)) state.agentConversation.messages = [];
        // Store a concise version (not the full card JSON) for context history
        const contentForHistory = replyContent.startsWith("{")
          ? replyContent.slice(0, 400) + (replyContent.length > 400 ? "...[card]" : "")
          : replyContent.slice(0, 600);
        state.agentConversation.messages.push({ role: "assistant", content: contentForHistory });
        if (state.agentConversation.messages.length > 20)
          state.agentConversation.messages = state.agentConversation.messages.slice(-20);
        saveConversationState();
      }
    }
    setLoopProgress("confirm");
    if (state.voice.conversationMode) {
      state.voice.pendingTaskId = data.task.id;
    }
    await Promise.all([loadChatSolutionStrip(data.task.id), loadSolutionBoard(data.task.id)]);
    return data.task;
  } finally {
    clearInterval(thinkingRotateTimer);
    setThinkingIndicator(false);
    // P2: release abort controller when stream finishes (normally or by abort)
    if (_currentPlanAbortController && _currentPlanAbortController.signal === _planStreamSignal) {
      _currentPlanAbortController = null;
    }
    if (loadingRow && loadingRow.parentElement) loadingRow.remove();
    clearTaskSkeletonCards(skeletonId);
    if (skeleton && el.chatSolutionStrip) skeleton.clear(el.chatSolutionStrip);
    setLoading("createTask", false);
  }
}

async function runPromptWithExecution(prompt, meta = {}) {
  const text = String(prompt || "").trim();
  if (!text) {
    notify(
      pickText("缺少可执行方案内容。", "Missing executable prompt.","実行可能な内容がありません。", "실행 가능한 문구가 없습니다."),
      "warning",
    );
    return { ok: false, reason: "missing_prompt" };
  }
  const inferred = inferConstraintsFromIntent(text);
  const mergedConstraints = {
    ...(state.selectedConstraints || {}),
    ...inferred,
  };
  if (Object.keys(inferred).length) {
    state.selectedConstraints = mergedConstraints;
    syncChipSelectionFromConstraints();
    updateContextSummary();
  }
  const data = await api("/api/tasks", {
    method: "POST",
    body: JSON.stringify({
      userId: "demo",
      intent: text,
      constraints: mergedConstraints,
      tripId: state.activeTripId || undefined,
    }),
  });
  if (data && data.task) {
    state.currentTask = data.task;
    renderAgentBrain(state.currentTask);
    if (store) store.dispatch({ type: "SET_TASK", task: data.task });
    if (state.voice.conversationMode) {
      state.voice.pendingTaskId = data.task.id;
    }
  }
  await trackEvent(
    "intent_submitted",
    { source: meta.source || "smart_run", textLen: text.length, constraints: mergedConstraints, optionId: meta.optionId || null },
    data && data.task ? data.task.id : null,
  );
  if (!data || !data.task) return { ok: false, reason: "task_create_failed" };
  return confirmAndExecute(data.task.id, {
    source: meta.source || "smart_run",
    autoConsent: true,
  });
}

async function confirmAndExecute(taskId, options = {}) {
  const opts = options || {};
  const taskData = await api(`/api/tasks/${taskId}`);
  const task = taskData.task;
  const amount = task.plan.confirm.amount;

  const confirmedByModal = opts.skipModal
    ? true
    : modal
      ? await modal.confirm({
          title: tUi("execute"),
          body: `
            <div>${pickText("将执行步骤", "Will execute","実行ステップ数", "실행 단계 수")}: ${task.plan.steps.length}, ${pickText("预计", "ETA","予測", "예상")} ${Math.max(2, Math.ceil(task.plan.steps.reduce((sum, item) => sum + Number(item.etaSec || 0), 0) / 60))} ${pickText("分钟", "min","分", "분")}.</div>
            <div>${pickText("金额", "Amount","金額", "금액")}: <strong>${Number(amount).toFixed(2)} ${escapeHtml(task.plan.confirm.currency || "CNY")}</strong></div>
            <div>${pickText("你将获得", "You will get","取得内容", "제공 항목")}: ${escapeHtml((task.plan.confirm.deliverables || []).join(" / "))}</div>
          `,
          confirmText: i18n.t(state.uiLanguage, "ui.confirm"),
          cancelText: i18n.t(state.uiLanguage, "ui.cancel"),
        })
      : window.confirm(pickText(`确认支付 ${amount} ${task.plan.confirm.currency}？`, `Confirm ${amount} ${task.plan.confirm.currency}?`, `${amount} ${task.plan.confirm.currency} を確認しますか？`, `${amount} ${task.plan.confirm.currency} 결제를 확인할까요?`));
  if (!confirmedByModal) {
    notify(pickText("已取消执行。", "Execution cancelled.","実行をキャンセルしました。", "실행이 취소되었습니다."), "warning");
    return { ok: false, reason: "user_cancelled" };
  }

  const firstCheck = await api("/api/payments/verify-intent", {
    method: "POST",
    body: JSON.stringify({ amount }),
  });

  if (!firstCheck.verified) {
    const ok = opts.skipSecondFactor
      ? true
      : modal && typeof modal.confirm === "function"
        ? await modal.confirm({
            title: pickText("高额二次验证", "High-Amount Verification","高額認証", "고액 인증"),
            body: `
              <div style="text-align:center;padding:8px 0;">
                <div style="font-size:32px;margin-bottom:8px;">🔐</div>
                <div>${pickText("支付金额", "Payment amount","支払金額", "결제 금액")}: <strong>${amount} CNY</strong></div>
                <div class="status">${pickText("超出免密额度", "Exceeds No-PIN threshold","無PIN閾値を超過", "No-PIN 한도 초과")}: ${firstCheck.threshold} CNY</div>
                <div class="status" style="margin-top:8px;">${pickText("请用 Face ID / 指纹 / PIN 确认此笔支付。", "Please confirm with Face ID / Fingerprint / PIN.", "Face ID / 指紋 / PIN で認証してください。", "Face ID / 지문 / PIN으로 확인해 주세요.")}</div>
              </div>
            `,
            confirmText: pickText("确认支付", "Confirm Payment","支払い確認", "결제 확인"),
            cancelText: pickText("取消", "Cancel","キャンセル", "취소"),
          })
        : window.confirm(`${pickText("高额验证", "High-amount verify","高額認証", "고액 인증")}: ${amount} CNY. ${pickText("确认？", "Confirm?","確認？", "확인?")}`);
    if (!ok) {
      addMessage(pickText("高额二次确认已取消支付。", "Payment canceled at high-amount verification.","高額確認で支払いをキャンセルしました。", "고액 확인 단계에서 결제가 취소되었습니다."));
      await trackEvent("high_amount_rejected", { amount }, taskId);
      return { ok: false, reason: "second_factor_rejected" };
    }
    const secondCheck = await api("/api/payments/verify-intent", {
      method: "POST",
      body: JSON.stringify({ amount, secondFactor: opts.skipSecondFactor ? "voice-ok" : "faceid-ok" }),
    });
    if (!secondCheck.verified) {
      addMessage(pickText("二次验证失败。", "Second-factor verification failed.","二段階認証に失敗しました。", "2차 인증에 실패했습니다."));
      await trackEvent("high_amount_verify_failed", { amount }, taskId);
      return { ok: false, reason: "second_factor_failed" };
    }
  }

  await api(`/api/tasks/${taskId}/confirm`, { method: "POST", body: JSON.stringify({ accepted: true, ts: Date.now() }) });
  setLoopProgress("execute");
  addMessage(pickText("已确认，开始执行：查询 -> 锁定 -> 支付 -> 交付凭证。", "Confirmed. Executing: query -> lock -> pay -> deliver proof.","確認済み。実行開始: 検索 -> ロック -> 支払い -> 証憑交付。", "확인되었습니다. 실행 시작: 조회 -> 잠금 -> 결제 -> 증빙 전달."));
  startExecutionMock(task);
  try {
    setLoading("executeTask", true);
    const result = await api(`/api/tasks/${taskId}/execute`, { method: "POST" });
    if (state.executionMockTimer) clearTimeout(state.executionMockTimer);
    if (result.task) {
      state.currentTask = result.task;
      renderAgentBrain(state.currentTask);
      if (store) store.dispatch({ type: "SET_TASK", task: result.task });
    }
    await trackEvent("task_executed_from_chat", {}, taskId);
    renderTimeline(result.timeline || []);
    if (result.order) renderDeliverable(result.order);
    setLoopProgress(result.order ? "proof" : "execute");
    renderPostTaskReview(result.task || task, result);
    addMessage(pickText("闭环完成：可在订单页查看生命周期、凭证和退款入口。", "Closed loop complete: check lifecycle, proof, and refund entry in Trips.","クローズドループ完了: 注文タブで履歴・証憑・返金導線を確認できます。", "폐쇄 루프 완료: 주문 탭에서 라이프사이클/증빙/환불 경로를 확인하세요."));
    notify(pickText("执行成功，凭证已生成。", "Execution completed with proof.","実行成功。証憑を生成しました。", "실행 성공. 증빙이 생성되었습니다."), "success");
    await Promise.all([loadTrips(), loadOrders(), loadAuditLogs(), loadDashboard()]);
    return { ok: true, result };
  } catch (err) {
    if (state.executionMockTimer) clearTimeout(state.executionMockTimer);
    setLoopProgress("support");
    notify(pickText("执行失败，已提供兜底方案。", "Execution failed. Fallback ready.","実行失敗。フォールバックを提示しました。", "실행 실패. 대체 경로를 준비했습니다."), "error");
    renderFallbackCard(taskId, err.message);
    await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
    return { ok: false, reason: "execute_failed", error: err };
  } finally {
    setLoading("executeTask", false);
  }
}

function switchTab(tabName, options = {}) {
  if (state.singleDialogMode && tabName !== "chat" && !options.force) {
    notify(
      pickText(
        "当前为单对话模式。点击右上角可切换到工作台模式。",
        "Single-dialog mode is active. Use the top-right button to open workspace mode.",
        "シングル会話モードです。右上ボタンでワークスペースを開けます。",
        "단일 대화 모드입니다. 우측 상단 버튼으로 워크스페이스를 열 수 있습니다.",
      ),
      "info",
    );
    return;
  }
  el.tabs.forEach((t) => t.classList.remove("active"));
  const activeTab = el.tabs.find((t) => t.dataset.tab === tabName);
  if (activeTab) activeTab.classList.add("active");

  Object.values(el.tabPanels).forEach((p) => p.classList.remove("active"));
  el.tabPanels[tabName].classList.add("active");
  motion.enter(el.tabPanels[tabName], { duration: 180, fromY: 10 });
  if (store) store.dispatch({ type: "SET_TAB", tab: tabName });

  if (tabName === "near") loadNearSuggestions();
  if (tabName === "trips") {
    loadTrips();
    loadOrders();
  }
  if (tabName === "trust") loadAuditLogs();
  if (tabName === "me") loadUserProfile();
}

function openDrawer() {
  if (drawerController) {
    drawerController.open(el.drawer);
    return;
  }
  el.drawer.classList.remove("hidden");
  el.drawer.setAttribute("aria-hidden", "false");
}

function closeDrawer() {
  if (drawerController) {
    drawerController.close(el.drawer);
    return;
  }
  el.drawer.classList.add("hidden");
  el.drawer.setAttribute("aria-hidden", "true");
}

function openOrderDrawer(trigger) {
  if (!el.orderDrawer) return;
  if (drawerController) {
    drawerController.open(el.orderDrawer, { trigger });
    return;
  }
  el.orderDrawer.classList.remove("hidden");
  el.orderDrawer.setAttribute("aria-hidden", "false");
}

function closeOrderDrawer() {
  if (!el.orderDrawer) return;
  if (drawerController) {
    drawerController.close(el.orderDrawer);
    return;
  }
  el.orderDrawer.classList.add("hidden");
  el.orderDrawer.setAttribute("aria-hidden", "true");
}

function openReplanDrawer(task) {
  if (!el.replanDrawer || !el.replanForm || !task) return;
  const constraints = task.constraints && typeof task.constraints === "object" ? task.constraints : {};
  state.replanTaskId = task.id;
  el.replanTaskId.value = task.id;
  el.replanIntent.value = task.intent || "";
  setReplanField("budget", constraints.budget || "mid");
  setReplanField("distance", constraints.distance || "walk");
  setReplanField("time", constraints.time || "soon");
  setReplanField("dietary", constraints.dietary || "");
  setReplanField("family", String(constraints.family === true || constraints.family === "true"));
  setReplanField("accessibility", constraints.accessibility || "optional");
  setReplanField("city", constraints.city || "Shanghai");
  setReplanField("origin", constraints.origin || "");
  setReplanField("destination", constraints.destination || "");
  setReplanField("templateId", "");
  clearReplanPreview();
  if (el.replanHint) {
    el.replanHint.textContent = pickText(
      `正在编辑 ${task.id}（${task.plan && task.plan.intentType ? task.plan.intentType : "unknown"}）`,
      `Editing ${task.id} (${task.plan && task.plan.intentType ? task.plan.intentType : "unknown"})`,
      `${task.id} を編集中（${task.plan && task.plan.intentType ? task.plan.intentType : "unknown"}）`,
      `${task.id} 편집 중 (${task.plan && task.plan.intentType ? task.plan.intentType : "unknown"})`,
    );
  }
  if (drawerController) {
    drawerController.open(el.replanDrawer);
  } else {
    el.replanDrawer.classList.remove("hidden");
    el.replanDrawer.setAttribute("aria-hidden", "false");
  }
}

function closeReplanDrawer() {
  if (!el.replanDrawer) return;
  if (drawerController) {
    drawerController.close(el.replanDrawer);
  } else {
    el.replanDrawer.classList.add("hidden");
    el.replanDrawer.setAttribute("aria-hidden", "true");
  }
  if (el.replanHint) el.replanHint.textContent = "";
  if (el.replanForm) el.replanForm.reset();
  clearReplanPreview();
  state.replanTaskId = null;
}

function renderDrawerTab() {
  const detail = state.currentTaskDetail;
  if (!detail) return;

  el.subtabs.forEach((b) => b.classList.toggle("active", b.dataset.subtab === state.currentSubtab));

  if (state.currentSubtab === "overview") {
    const recommendation = state.currentTaskRecommendation;
    const fallback = (detail.fallbackEvents || [])
      .map((f) => `<li>${escapeHtml(f.kind)} · ${escapeHtml(f.note)} <span class="status">${new Date(f.at).toLocaleString()}</span></li>`)
      .join("");
    const lifecycle = (detail.lifecycle || [])
      .map((item) => `<li><strong>${escapeHtml(item.label || item.state)}</strong> <span class="status">${new Date(item.at).toLocaleString()} · ${escapeHtml(item.note || "")}</span></li>`)
      .join("");
    const p = detail.progress || {};
    const taskTypeLabel = (() => {
      const v = String(detail.overview.type || "").toLowerCase();
      if (v === "eat") return pickText("餐饮", "Eat","飲食", "식사");
      if (v === "travel") return pickText("出行", "Travel","移動", "이동");
      if (v === "support") return pickText("售后", "Support","サポート", "지원");
      return v || "-";
    })();
    const flags = Object.entries(detail.flagSnapshot || {})
      .map(([name, item]) => {
        const activeLabel = item.active
          ? pickText("已启用", "Active","有効", "활성")
          : pickText("未启用", "Inactive","無効", "비활성");
        return `<li>${escapeHtml(name)} · <strong>${activeLabel}</strong> <span class="status">${pickText("灰度", "Rollout","ロールアウト", "롤아웃")} ${item.rollout}% · ${pickText("分桶", "Bucket","バケット", "버킷")} ${item.bucket}</span></li>`;
      })
      .join("");
    const recoComments = recommendation && recommendation.comments
      ? recommendation.comments.slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : "";
    const recoReasons = recommendation && recommendation.reasons
      ? recommendation.reasons.slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join("")
      : "";
    const recommendationCard =
      recommendation && recommendation.imagePath
        ? `
      <article class="card">
        <h3>${pickText("推荐路线", "Recommended Lane","推奨ルート", "추천 경로")}</h3>
        <div class="status">${escapeHtml(recommendation.subtitle || pickText("任务级推荐", "Task-scoped recommendation","タスク別推奨", "작업 기준 추천"))}</div>
        <img class="media-photo" src="${escapeHtml(assetUrl(recommendation.imagePath))}" alt="${pickText("任务推荐", "Task recommendation","タスク推奨", "작업 추천")}" />
        <div class="status">${pickText("推荐提示词", "Recommended prompt","推奨プロンプト", "추천 프롬프트")}: ${escapeHtml(recommendation.recommendedPrompt || "-")}</div>
        <h3>${pickText("相关评论", "Related Comments","関連コメント", "관련 코멘트")}</h3>
        <ul class="steps">${recoComments || `<li>${pickText("暂无评论。", "No comments.","コメントはありません。", "코멘트가 없습니다.")}</li>`}</ul>
        <h3>${pickText("推荐原因", "Why This Lane","推奨理由", "추천 이유")}</h3>
        <ul class="steps">${recoReasons || `<li>${pickText("暂无分析。", "No analysis.","分析はありません。", "분석이 없습니다.")}</li>`}</ul>
      </article>
    `
        : "";
    el.drawerBody.innerHTML = `
      <article class="card">
        <h3>${escapeHtml(detail.overview.intent)}</h3>
        <div>${pickText("状态", "Status","状態", "상태")}: ${escapeHtml(localizeStatus(detail.overview.status || "-"))}</div>
        <div>${pickText("类型", "Type","タイプ", "유형")}: ${escapeHtml(taskTypeLabel)}</div>
        <div class="status">${pickText("进度", "Progress","進捗", "진행률")}: ${pickText("成功", "Success","成功", "성공")} ${Number(p.success || 0)} / ${Number(p.total || 0)} · ${pickText("执行中", "Running","実行中", "실행중")} ${Number(p.running || 0)} · ${pickText("兜底", "Fallback","フォールバック", "대체")} ${Number(p.fallback || 0)} · ${pickText("失败", "Failed","失敗", "실패")} ${Number(p.failed || 0)}</div>
        <div>${pickText("原因说明", "Reasoning","理由", "근거")}: ${escapeHtml(detail.overview.reasoning)}</div>
        <div>${pickText("支付通道", "Payment rail","決済レール", "결제 레일")}: ${escapeHtml(detail.overview.paymentRail || "alipay_cn")}</div>
        ${
          detail.overview.pricing
            ? `<div>${pickText("费用", "Pricing","価格", "가격")}: ${pickText("净价", "Net","ネット", "순액")} ${Number(detail.overview.pricing.netPrice || 0)} + ${pickText("服务费", "Markup","マークアップ", "마크업")} ${Number(detail.overview.pricing.markup || 0)} (${(Number(detail.overview.pricing.markupRate || 0) * 100).toFixed(1)}%)</div>`
            : ""
        }
        <div>${pickText("创建时间", "Created","作成日時", "생성 시각")}: ${new Date(detail.overview.createdAt).toLocaleString()}</div>
        <div>${pickText("人工接管", "Handoff","有人対応", "사람 상담")}: ${detail.handoff ? `<span class="code">${escapeHtml(detail.handoff.ticketId)}</span> (${escapeHtml(detail.handoff.status)})` : pickText("未请求", "Not requested","未リクエスト", "요청되지 않음")}</div>
        <div class="status">${detail.handoff ? `${pickText("请求时间", "Requested","依頼時刻", "요청 시각")}: ${new Date(detail.handoff.requestedAt).toLocaleString()}` : ""}</div>
        <div class="status">${detail.handoff && detail.handoff.updatedAt ? `${pickText("更新时间", "Updated","更新時刻", "업데이트 시각")}: ${new Date(detail.handoff.updatedAt).toLocaleString()}` : ""}</div>
        <div class="actions">
          <button class="secondary" data-action="request-handoff" data-task="${escapeHtml(detail.overview.taskId)}">${pickText("请求人工接管", "Request Human Handoff","有人対応を依頼", "사람 상담 요청")}</button>
          <button class="secondary" data-action="show-refund-policy" data-task="${escapeHtml(detail.overview.taskId)}">${pickText("退款规则", "Refund Policy","返金ポリシー", "환불 정책")}</button>
        </div>
      </article>
      <article class="card">
        <h3>${pickText("生命周期", "Lifecycle","ライフサイクル", "라이프사이클")}</h3>
        <ul class="steps">${lifecycle || `<li>${pickText("暂无生命周期。", "No lifecycle yet.","ライフサイクルはありません。", "라이프사이클이 없습니다.")}</li>`}</ul>
      </article>
      <article class="card">
        <h3>${pickText("兜底事件", "Fallback Events","フォールバックイベント", "대체 실행 이벤트")}</h3>
        <ul class="steps">${fallback || `<li>${pickText("未触发兜底。", "No fallback triggered.","フォールバックは未発生です。", "대체 실행이 발생하지 않았습니다.")}</li>`}</ul>
      </article>
      <article class="card">
        <h3>${pickText("灰度标记（快照）", "Feature Flags (Snapshot)","機能フラグ（スナップショット）", "기능 플래그 (스냅샷)")}</h3>
        <ul class="steps">${flags || `<li>${pickText("暂无标记。", "No flags.","フラグはありません。", "플래그가 없습니다.")}</li>`}</ul>
      </article>
      ${recommendationCard}
    `;
    motion.bindPressables(el.drawerBody);
    return;
  }

  if (state.currentSubtab === "steps") {
    const steps = detail.steps
      .map(
        (s) => `
      <li class="step-line status-${escapeHtml(s.status)} ${s.status === "running" ? "is-current" : ""}">
        <div class="step-head"><span class="step-glyph">${statusGlyph(s.status)}</span><strong>${escapeHtml(s.label)}</strong> <span class="status-badge ${escapeHtml(s.status)}">${escapeHtml(localizeStatus(s.status))}</span></div>
        <div class="status">${tUi("step_tool")} ${escapeHtml(s.toolType)} · ${pickText("预计", "ETA","予測", "예상")} ${Math.max(1, Math.ceil(Number(s.etaSec || 0) / 60))} ${pickText("分钟", "min","分", "분")} · ${pickText("耗时", "Latency","レイテンシ", "지연")} ${Number(s.latency || 0)}ms</div>
        <div class="status">${tUi("step_input")}: ${escapeHtml(s.inputSummary || "-")}</div>
        <div class="status">${tUi("step_output")}: ${escapeHtml(s.outputSummary || "-")}</div>
        <div class="status">${tUi("step_evidence")}: ${escapeHtml((s.evidence && s.evidence.receiptId) || "-")} · ${escapeHtml((s.evidence && s.evidence.summary) || "-")}</div>
        ${s.status === "failed" ? `<div class="status step-error">${tUi("step_failure_reason")}: ${escapeHtml(getStepFailureReason(s))}</div>` : ""}
        <div class="actions">
          <button class="secondary" data-action="retry-step" data-task="${escapeHtml(detail.overview.taskId)}" data-step="${escapeHtml(s.id)}">${pickText("重试这一步", "Retry this step","このステップを再試行", "이 단계 재시도")}</button>
          <button class="secondary" data-action="switch-lane" data-task="${escapeHtml(detail.overview.taskId)}" data-step="${escapeHtml(s.id)}">${pickText("切换路线", "Switch lane","ルート切替", "경로 전환")}</button>
          <button class="secondary" data-action="request-handoff" data-task="${escapeHtml(detail.overview.taskId)}">${pickText("人工接管", "Ask human","有人対応", "사람 상담")}</button>
          <button class="secondary" data-action="show-refund-policy" data-task="${escapeHtml(detail.overview.taskId)}">${pickText("退款规则", "Refund policy","返金ポリシー", "환불 정책")}</button>
        </div>
      </li>
    `,
      )
      .join("");
    el.drawerBody.innerHTML = `
      <article class="card">
        <h3>${pickText("执行步骤", "Execution Steps","実行ステップ", "실행 단계")}</h3>
        <ol class="steps">${steps}</ol>
      </article>
      <article class="card">
        <h3>MCP ${pickText("摘要", "Summary","サマリー", "요약")}</h3>
        <div>${pickText("查询", "Query","照会", "조회")}: <span class="code">${escapeHtml(detail.mcpSummary.query)}</span></div>
        <div>${pickText("预订", "Book","予約", "예약")}: <span class="code">${escapeHtml(detail.mcpSummary.book)}</span></div>
        <div>${pickText("支付", "Pay","支払い", "결제")}: <span class="code">${escapeHtml(detail.mcpSummary.pay)}</span></div>
        <div>${pickText("状态", "Status","状態", "상태")}: <span class="code">${escapeHtml(detail.mcpSummary.status)}</span></div>
      </article>
    `;
    motion.bindPressables(el.drawerBody);
    return;
  }

  if (state.currentSubtab === "payments") {
    const payments = detail.payments.length
      ? detail.payments
          .map(
            (p) =>
              `<li>${p.amount} ${escapeHtml(p.currency)} · ${escapeHtml(p.status)} · ${escapeHtml(p.railLabel || p.railId || "-")} · ${new Date(p.at).toLocaleString()} ${p.gatewayRef ? `<span class="code">${escapeHtml(p.gatewayRef)}</span>` : ""}</li>`,
          )
          .join("")
      : `<li>${pickText("暂无支付记录。", "No payment records.","支払い記録はありません。", "결제 기록이 없습니다.")}</li>`;
    el.drawerBody.innerHTML = `
      <article class="card">
        <h3>${pickText("支付记录", "Payments","支払い", "결제")}</h3>
        <ul class="steps">${payments}</ul>
      </article>
    `;
    motion.bindPressables(el.drawerBody);
    return;
  }

  const proof = detail.proof;
  const evidence = (detail.evidenceItems || [])
    .map(
      (item) =>
        `<li><strong>${escapeHtml(item.title || item.type)}</strong> <span class="status">${escapeHtml(item.hash || "-")} · ${new Date(item.generatedAt).toLocaleString()}</span><div class="status">${escapeHtml(item.content || "")}</div></li>`,
    )
    .join("");
  const chain = (detail.proofChain || [])
    .map(
      (c) =>
        `<li>
          <strong>${escapeHtml(c.op)}</strong> · ${escapeHtml(c.toolType)}
          <span class="status">${escapeHtml(c.responseStatus)} · ${c.latency || 0}ms · ${pickText("契约", "Contract","契約", "계약")} ${escapeHtml(c.contractId || "-")}</span>
          <div class="status">${pickText("请求", "Request","リクエスト", "요청")}: ${escapeHtml(c.requestSummary || "-")}</div>
          <div class="status">${pickText("响应", "Response","レスポンス", "응답")}: ${escapeHtml(c.responseSummary || "-")}</div>
          <div class="status">${pickText("选择理由", "Why selected","選定理由", "선정 이유")}: ${escapeHtml(c.selectionReason || "-")}</div>
        </li>`,
    )
    .join("");
  const moments = (detail.keyMoments || [])
    .map((m) => `<li><strong>${escapeHtml(m.kind)}</strong> · ${new Date(m.at).toLocaleString()} <span class="status">${escapeHtml(m.note)}</span></li>`)
    .join("");

  el.drawerBody.innerHTML = proof
    ? `
      <article class="card">
        <h3>${tTerm("proof")}</h3>
        <div>${pickText("订单号", "Order","注文番号", "주문 번호")}: <span class="code">${escapeHtml(proof.orderNo)}</span></div>
        <div>QR: <span class="code">${escapeHtml(proof.qrText)}</span></div>
        <div>${pickText("地址", "Address","住所", "주소")}: ${escapeHtml(proof.bilingualAddress)}</div>
        <div>${pickText("行程", "Itinerary","行程", "일정")}: ${escapeHtml(proof.itinerary || "")}</div>
      </article>
      <article class="card">
        <h3>${pickText("证据抽屉", "Evidence Drawer","証跡ドロワー", "증거 서랍")}</h3>
        <ul class="steps">${evidence || `<li>${pickText("暂无证据。", "No evidence items.","証跡はありません。", "증거가 없습니다.")}</li>`}</ul>
      </article>
      <article class="card">
        <h3>${pickText("关键节点", "Key Moments","重要な時点", "핵심 시점")}</h3>
        <ul class="steps">${moments || `<li>${pickText("暂无关键节点。", "No key moments.","重要な時点はありません。", "핵심 시점이 없습니다.")}</li>`}</ul>
      </article>
      <article class="card">
        <h3>${pickText("操作追踪链", "Operation Tracking Chain","操作追跡チェーン", "작업 추적 체인")}</h3>
        <ul class="steps">${chain || `<li>${pickText("暂无链路数据。", "No chain data.","チェーンデータはありません。", "체인 데이터가 없습니다.")}</li>`}</ul>
      </article>
    `
    : `<article class="card">${pickText("尚未生成凭证。", "No proof yet.","証憑はまだありません。", "증빙이 아직 없습니다.")}</article>`;
  motion.bindPressables(el.drawerBody);
}

async function openTaskDetail(taskId) {
  const [detailData, recommendationData] = await Promise.all([
    api(`/api/tasks/${taskId}/detail`),
    api(buildRecommendationPath(taskId)),
  ]);
  state.currentTaskDetail = detailData.detail;
  state.currentTaskRecommendation = recommendationData.recommendation || null;
  state.currentSubtab = "overview";
  el.drawerTitle.textContent = `${tTerm("task")} · ${taskId}`;
  renderDrawerTab();
  openDrawer();
}

function readCostMid(costRange) {
  const nums = String(costRange || "")
    .match(/\d+/g);
  if (!nums || nums.length < 2) return 0;
  return (Number(nums[0]) + Number(nums[1])) / 2;
}

function fitNearFilters(item, filters) {
  if (!item) return false;
  if (filters.distance && filters.distance !== "any") {
    const km = Number(item.map && item.map.distanceKm ? item.map.distanceKm : 99);
    const limit = filters.distance === "500m" ? 0.5 : filters.distance === "1km" ? 1 : 3;
    if (km > limit) return false;
  }
  if (filters.budget && filters.budget !== "any") {
    const mid = readCostMid(item.costRange);
    if (filters.budget === "low" && mid > 90) return false;
    if (filters.budget === "mid" && (mid < 60 || mid > 160)) return false;
    if (filters.budget === "high" && mid < 140) return false;
  }
  if (filters.queue && filters.queue === "short") {
    const riskCode = String(item.riskCode || "").toLowerCase();
    const riskText = String(item.risk || "").toLowerCase();
    if (riskCode.includes("queue") || riskText.includes("queue") || riskText.includes("排队")) return false;
  }
  if (filters.dietary && filters.dietary !== "none") {
    const text = `${item.title || ""} ${item.why || ""}`.toLowerCase();
    if (!text.includes(String(filters.dietary).toLowerCase())) return false;
  }
  if (filters.foreignCard === "supported_only" && item.type === "travel" && item.id === "n4") return false;
  if (filters.booking === "bookable_only" && item.type === "eat" && item.id === "n2") return false;
  return true;
}

function renderNearMap(item, mapPreview) {
  if (!el.nearMapPreview) return;
  if (!item) {
    el.nearMapPreview.innerHTML = `<div class="status">${pickText("未选择结果。", "No result selected.","結果が選択されていません。", "선택된 결과가 없습니다.")}</div>`;
    return;
  }
  const map = item.map || {};
  el.nearMapPreview.innerHTML = `
    <img class="near-map-image media-photo" src="${escapeHtml(assetUrl(item.imageUrl || (mapPreview && mapPreview.imagePath) || "/assets/solution-flow.svg"))}" alt="near map preview" />
    <div><strong>${escapeHtml(item.title)}</strong></div>
    <div class="status">${escapeHtml(item.placeName || "-")} · <span class="status-badge lane-grade">${escapeHtml(item.recommendationGrade || "-")}</span> ${escapeHtml(item.recommendationLevel || "-")}</div>
    <div class="status">${pickText("路线", "Route","ルート", "경로")}: ${escapeHtml(map.route || "-")} · ${pickText("距离", "Distance","距離", "거리")}: ${Number(map.distanceKm || 0)} km</div>
    <div class="status">ETA ${escapeHtml(item.eta || "-")} · ${pickText("成功率", "Success","成功率", "성공률")} ${(Number(item.successRate7d || 0) * 100).toFixed(0)}%</div>
    <div class="actions">
      <button data-action="run-intent" data-intent="${escapeHtml(item.title)}">${pickText("一键执行", "One-click Execute","ワンクリック実行", "원클릭 실행")}</button>
    </div>
  `;
}

async function loadNearSuggestions() {
  if (skeleton && el.nearList && !state.nearItems.length) {
    skeleton.render(el.nearList, { count: 2, lines: 4 });
  }
  const data = await api(buildNearbyPath());
  if (skeleton && el.nearList) skeleton.clear(el.nearList);
  state.nearItems = Array.isArray(data.items) ? data.items : [];
  if (store) store.dispatch({ type: "SET_NEARBY", items: state.nearItems });
  if (el.nearFilterForm && data.filters && data.filters.defaultBudget && el.nearFilterForm.budget.value === "any") {
    el.nearFilterForm.budget.value = data.filters.defaultBudget;
  }
  const form = el.nearFilterForm ? new FormData(el.nearFilterForm) : new FormData();
  const activeFilter = {
    distance: String(form.get("distance") || "any"),
    budget: String(form.get("budget") || "any"),
    queue: String(form.get("queue") || "any"),
    dietary: String(form.get("dietary") || "none"),
    booking: String(form.get("booking") || "all"),
    foreignCard: String(form.get("foreignCard") || "all"),
  };
  const visible = state.nearItems.filter((item) => fitNearFilters(item, activeFilter));
  if (!visible.length) {
    el.nearList.innerHTML = `<article class="card">${pickText("当前筛选下没有结果。", "No nearby result under current filters.","現在のフィルターに一致する結果はありません。", "현재 필터 조건에 맞는 결과가 없습니다.")}</article>`;
    renderNearMap(null, data.mapPreview || null);
    return;
  }
  if (!state.selectedNearItemId || !visible.some((item) => item.id === state.selectedNearItemId)) {
    state.selectedNearItemId = visible[0].id;
  }
  el.nearList.innerHTML = visible
    .map(
      (item) => `
      <article class="card ${item.id === state.selectedNearItemId ? "lane-recommended" : ""}">
        <h3>${escapeHtml(item.title)}</h3>
        <img class="near-card-image media-photo" src="${escapeHtml(assetUrl(item.imageUrl || "/assets/solution-flow.svg"))}" alt="${escapeHtml(item.placeName || item.title)}" />
        <div class="status">${escapeHtml(item.placeName || "-")} · <span class="status-badge lane-grade">${escapeHtml(item.recommendationGrade || "-")}</span> ${escapeHtml(item.recommendationLevel || "-")}</div>
        <div class="status">ETA ${escapeHtml(item.eta)} · ${pickText("成功率", "Success","成功率", "성공률")} ${(Number(item.successRate7d || 0) * 100).toFixed(0)}% · ${pickText("风险", "Risk","リスク", "리스크")} ${escapeHtml(localizeRiskValue(item.risk, item.riskCode))}</div>
        <div class="status">${pickText("费用", "Cost","費用", "비용")} ${escapeHtml(item.costRange || "-")}</div>
        <div class="status">${pickText("推荐理由", "Why recommended","推奨理由", "추천 이유")}: ${escapeHtml(item.why || "-")}</div>
        <div class="status">${pickText("一键后执行", "After one click","ワンクリック後の処理", "원클릭 후 실행")}: ${escapeHtml(item.executeWill || "-")}</div>
        <div class="actions">
          <button class="secondary" data-action="select-near-item" data-item="${escapeHtml(item.id)}">${pickText("地图预览", "Preview on map","地図で確認", "지도에서 보기")}</button>
          <button data-action="run-intent" data-intent="${escapeHtml(item.title)}">${pickText("在聊天中执行", "Run in Chat","チャットで実行", "채팅에서 실행")}</button>
        </div>
      </article>
    `,
    )
    .join("");
  motion.bindPressables(el.nearList);
  const selected = visible.find((item) => item.id === state.selectedNearItemId) || visible[0];
  renderNearMap(selected, data.mapPreview || null);
}

function renderActiveTripHint() {
  if (!el.activeTripHint) return;
  const active = state.tripPlans.find((trip) => trip.id === state.activeTripId) || null;
  if (!active) {
    el.activeTripHint.textContent = "";
    return;
  }
  el.activeTripHint.textContent = pickText(
    `当前行程：${active.title}（${localizeStatus(active.status)}）`,
    `Active trip: ${active.title} (${localizeStatus(active.status)})`,
    `現在の旅程: ${active.title}（${localizeStatus(active.status)}）`,
    `현재 트립: ${active.title} (${localizeStatus(active.status)})`,
  );
}

async function loadTrips() {
  if (!el.tripList) return;
  if (skeleton && !el.tripList.children.length) {
    skeleton.render(el.tripList, { count: 2, lines: 4 });
  }
  const data = await api("/api/trips");
  if (skeleton) skeleton.clear(el.tripList);
  state.tripPlans = Array.isArray(data.trips) ? data.trips : [];
  if (store) store.dispatch({ type: "SET_ERROR", error: null });
  if (!state.activeTripId || !state.tripPlans.some((trip) => trip.id === state.activeTripId)) {
    const preferred = state.tripPlans.find((trip) => ["active", "in_progress"].includes(String(trip.status || "").toLowerCase()));
    state.activeTripId = preferred ? preferred.id : "";
  }
  if (!state.tripPlans.length) {
    el.tripList.innerHTML = `<article class="card">${pickText("暂无行程计划。先创建一个 Trip Plan。", "No trip plan yet. Create one first.","旅程プランはまだありません。まず作成してください。", "트립 플랜이 없습니다. 먼저 생성하세요.")}</article>`;
    renderActiveTripHint();
    return;
  }
  el.tripList.innerHTML = state.tripPlans
    .map((trip) => {
      const progress = trip.progress || {};
      const counts = progress.counts || {};
      const isActive = trip.id === state.activeTripId;
      return `
      <article class="card ${isActive ? "lane-recommended" : ""}">
        <h3>${escapeHtml(trip.title)}</h3>
        <div>${pickText("城市", "City","都市", "도시")}: ${escapeHtml(trip.city || "-")}</div>
        <div>${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${escapeHtml(trip.status || "active")}">${escapeHtml(localizeStatus(trip.status || "active"))}</span></div>
        <div class="status">${pickText("任务", "Tasks","タスク", "작업")}: ${Number(progress.totalTasks || 0)} · ${pickText("订单", "Orders","注文", "주문")}: ${Number(progress.orderCount || 0)} · ${pickText("凭证", "Proof","証憑", "증빙")}: ${Number(progress.proofCount || 0)}</div>
        <div class="status">${pickText("完成率", "Completion","完了率", "완료율")}: ${(Number(progress.completedRate || 0) * 100).toFixed(0)}% · ${pickText("执行中", "Running","実行中", "실행중")} ${Number(counts.executing || 0)} · ${pickText("售后中", "Support","サポート中", "지원중")} ${Number(counts.support || 0)}</div>
        <div class="status">${escapeHtml(trip.note || "")}</div>
        <div class="actions">
          <button class="secondary" data-action="activate-trip" data-trip="${escapeHtml(trip.id)}">${isActive ? pickText("已激活", "Active","有効", "활성") : pickText("设为当前行程", "Set Active Trip","現在の旅程に設定", "활성 트립으로 설정")}</button>
          <button class="secondary" data-action="open-trip-detail" data-trip="${escapeHtml(trip.id)}">${pickText("行程详情", "Trip detail","旅程詳細", "트립 상세")}</button>
          ${
            state.currentTask && state.currentTask.id && state.currentTask.tripId !== trip.id
              ? `<button class="secondary" data-action="attach-current-task" data-trip="${escapeHtml(trip.id)}" data-task="${escapeHtml(state.currentTask.id)}">${pickText("挂载当前任务", "Attach current task","現在のタスクを紐付け", "현재 작업 연결")}</button>`
              : ""
          }
        </div>
      </article>
    `;
    })
    .join("");
  renderActiveTripHint();
  motion.bindPressables(el.tripList);
}

async function openTripDetail(tripId, trigger = null) {
  if (!tripId) return;
  const data = await api(`/api/trips/${tripId}`);
  const trip = data.trip || {};
  const tasks = Array.isArray(trip.tasks) ? trip.tasks : [];
  const lifecycle = (trip.lifecycle || [])
    .map((node) => `<li><strong>${escapeHtml(node.label || node.state || "-")}</strong> <span class="status">${new Date(node.at).toLocaleString()} · ${escapeHtml(node.note || "")}</span></li>`)
    .join("");
  const taskRows = tasks
    .map(
      (task) => `
      <li>
        <strong>${escapeHtml(task.intent || task.taskId)}</strong>
        <div class="status">${escapeHtml(task.taskId)} · <span class="status-badge ${escapeHtml(task.status)}">${escapeHtml(localizeStatus(task.status))}</span></div>
        <div class="status">${pickText("类型", "Type","タイプ", "유형")}: ${escapeHtml(task.type || "-")} · Lane: ${escapeHtml(task.laneId || "-")}</div>
        ${
          task.order
            ? `<div class="status">${pickText("订单", "Order","注文", "주문")}: ${escapeHtml(task.order.orderId)} · ${Number(task.order.amount || 0)} ${escapeHtml(task.order.currency || "CNY")} · ${pickText("凭证", "Proof","証憑", "증빙")} ${Number(task.order.proofCount || 0)}</div>`
            : `<div class="status">${pickText("暂无订单", "No order yet","注文未作成", "주문 없음")}</div>`
        }
        <div class="actions">
          <button class="secondary" data-action="open-task" data-task="${escapeHtml(task.taskId)}">${pickText("任务详情", "Task detail","タスク詳細", "작업 상세")}</button>
          ${task.order ? `<button class="secondary" data-action="open-order-detail" data-order="${escapeHtml(task.order.orderId)}">${pickText("订单详情", "Order detail","注文詳細", "주문 상세")}</button>` : ""}
        </div>
      </li>
    `,
    )
    .join("");

  if (el.drawerTitle) {
    el.drawerTitle.textContent = `${pickText("行程详情", "Trip Detail","旅程詳細", "트립 상세")} · ${escapeHtml(trip.title || tripId)}`;
  }
  if (el.drawerBody) {
    el.drawerBody.innerHTML = `
      <article class="card">
        <h3>${escapeHtml(trip.title || tripId)}</h3>
        <div>${pickText("城市", "City","都市", "도시")}: ${escapeHtml(trip.city || "-")} · <span class="status-badge ${escapeHtml(trip.status || "active")}">${escapeHtml(localizeStatus(trip.status || "active"))}</span></div>
        <div class="status">${pickText("任务", "Tasks","タスク", "작업")}: ${Number(trip.progress && trip.progress.totalTasks ? trip.progress.totalTasks : 0)} · ${pickText("订单", "Orders","注文", "주문")}: ${Number(trip.progress && trip.progress.orderCount ? trip.progress.orderCount : 0)} · ${pickText("凭证", "Proof","証憑", "증빙")}: ${Number(trip.progress && trip.progress.proofCount ? trip.progress.proofCount : 0)}</div>
        <div class="status">${escapeHtml(trip.note || "")}</div>
        <div class="actions">
          <button class="secondary" data-action="activate-trip" data-trip="${escapeHtml(trip.id)}">${pickText("设为当前行程", "Set Active Trip","現在の旅程に設定", "활성 트립으로 설정")}</button>
          <button class="secondary" data-action="trip-status" data-trip="${escapeHtml(trip.id)}" data-status="paused">${pickText("暂停行程", "Pause trip","旅程を一時停止", "트립 일시중지")}</button>
          <button class="secondary" data-action="trip-status" data-trip="${escapeHtml(trip.id)}" data-status="active">${pickText("恢复行程", "Resume trip","旅程を再開", "트립 재개")}</button>
        </div>
      </article>
      <article class="card">
        <h3>${pickText("生命周期", "Lifecycle","ライフサイクル", "라이프사이클")}</h3>
        <ol class="steps">${lifecycle || `<li>${pickText("暂无数据。", "No lifecycle data.","データがありません。", "데이터가 없습니다.")}</li>`}</ol>
      </article>
      <article class="card">
        <h3>${pickText("关联任务", "Linked Tasks","関連タスク", "연결 작업")}</h3>
        <ul class="steps">${taskRows || `<li>${pickText("暂无任务。", "No tasks yet.","タスクはまだありません。", "작업이 없습니다.")}</li>`}</ul>
      </article>
    `;
  }
  motion.bindPressables(el.drawerBody);
  openDrawer(trigger);
}

async function loadOrders() {
  if (skeleton && el.ordersList && !el.ordersList.children.length) {
    skeleton.render(el.ordersList, { count: 2, lines: 4 });
  }
  const data = await api("/api/orders");
  if (skeleton && el.ordersList) skeleton.clear(el.ordersList);
  if (store) store.dispatch({ type: "SET_ORDERS", orders: data.orders || [] });
  if (!data.orders.length) {
    el.ordersList.innerHTML = `<article class="card">${pickText("暂无订单。", "No trips/orders yet.","注文はまだありません。", "주문이 아직 없습니다.")}</article>`;
    return;
  }
  el.ordersList.innerHTML = data.orders
    .map(
      (o) => `
      <article class="card">
        <h3>${escapeHtml(o.provider)}</h3>
        <div>${pickText("时间", "Time","時刻", "시간")}: ${new Date(o.createdAt).toLocaleString()}</div>
        <div>${pickText("城市", "City","都市", "도시")}: ${escapeHtml(o.city || "Shanghai")}</div>
        <div>${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${escapeHtml(o.status)}">${escapeHtml(localizeStatus(o.status))}</span></div>
        <div>${pickText("类型", "Type","タイプ", "유형")}: ${escapeHtml(o.type)}</div>
        <div>${pickText("金额", "Amount","金額", "금액")}: ${o.price} ${escapeHtml(o.currency)} ${o.pricing ? `(Net ${o.pricing.netPrice} + Markup ${o.pricing.markup})` : ""}</div>
        <div>${pickText("订单号", "Order","注文番号", "주문번호")}: <span class="code">${escapeHtml(o.proof.orderNo)}</span></div>
        <div class="status">${pickText("凭证数量", "Proof count","証憑数", "증빙 수")}: ${Array.isArray(o.proofItems) ? o.proofItems.length : 0} · ${pickText("售后", "After-sales","アフターサポート", "사후지원")}: ${o.refund ? escapeHtml(localizeStatus(o.refund.status || "processing")) : pickText("可用", "available","利用可", "사용 가능")}</div>
        <div class="status">${pickText("生命周期", "Lifecycle","ライフサイクル", "라이프사이클")}: ${(o.lifecycle || []).map((x) => escapeHtml(localizeStatus(x.state))).join(" -> ")}</div>
        <div class="actions">
          <button class="secondary" data-action="open-order-detail" data-order="${o.id}">${pickText("订单详情", "Order Detail","注文詳細", "주문 상세")}</button>
          <button class="secondary" data-action="open-task" data-task="${o.taskId}">${pickText("任务详情", "Task Detail","タスク詳細", "작업 상세")}</button>
          <button class="secondary" data-action="open-proof" data-order="${o.id}">${pickText("凭证", "Proof","証憑", "증빙")}</button>
          <button class="secondary" data-action="cancel-order" data-order="${o.id}">${pickText("取消并退款", "Cancel & Refund","キャンセルと返金", "취소 및 환불")}</button>
        </div>
      </article>
    `,
    )
    .join("");
  motion.bindPressables(el.ordersList);
}

async function openMyOrdersQuickView(trigger = null) {
  if (!el.orderDrawerBody) return;
  if (skeleton) skeleton.render(el.orderDrawerBody, { count: 2, lines: 4 });
  const data = await api("/api/orders");
  if (skeleton) skeleton.clear(el.orderDrawerBody);
  const orders = Array.isArray(data.orders) ? data.orders : [];
  if (el.orderDrawerTitle) {
    el.orderDrawerTitle.textContent = pickText("我的订单", "My Orders","マイ注文", "내 주문");
    el.orderDrawerTitle.dataset.lockedTitle = "1";
  }
  if (!orders.length) {
    el.orderDrawerBody.innerHTML = `<article class="card">${pickText("暂无订单记录。", "No orders yet.","注文履歴はありません。", "주문 내역이 없습니다.")}</article>`;
    openOrderDrawer(trigger);
    return;
  }
  const rows = orders
    .slice(0, 20)
    .map(
      (o) => `
      <article class="card">
        <h3>${escapeHtml(o.provider || "Ctrip Hotel")}</h3>
        <div class="status">${pickText("订单号", "Order","注文番号", "주문번호")}: <span class="code">${escapeHtml((o.proof && o.proof.orderNo) || o.outOrderNo || o.id)}</span></div>
        <div class="status">${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${escapeHtml(o.status || "")}">${escapeHtml(localizeStatus(o.status || "-"))}</span></div>
        <div class="status">${pickText("金额", "Amount","金額", "금액")}: ${Number(o.price || o.totalPrice || 0)} ${escapeHtml(o.currency || "CNY")}</div>
        <div class="actions">
          <button class="secondary" data-action="open-order-detail" data-order="${escapeHtml(o.id)}">${pickText("查看详情", "View Detail","詳細を見る", "상세 보기")}</button>
          <button class="secondary" data-action="cancel-order" data-order="${escapeHtml(o.id)}">${pickText("发起退改", "Cancel/Refund","取消/返金", "취소/환불")}</button>
        </div>
      </article>
    `,
    )
    .join("");
  el.orderDrawerBody.innerHTML = rows;
  motion.bindPressables(el.orderDrawerBody);
  openOrderDrawer(trigger);
}

async function loadOrderDetail(orderId, trigger = null) {
  if (!el.orderDrawerBody || !orderId) return;
  if (skeleton) skeleton.render(el.orderDrawerBody, { count: 1, lines: 5 });
  const data = await api(`/api/orders/${orderId}/detail`);
  if (skeleton) skeleton.clear(el.orderDrawerBody);
  const detail = data.detail || {};
  const lifecycle = (detail.lifecycle || [])
    .map((item) => `<li><strong>${escapeHtml(item.label || item.state)}</strong> <span class="status">${new Date(item.at).toLocaleString()} · ${escapeHtml(item.note || "")}</span></li>`)
    .join("");
  const proofItems = (detail.proofItems || [])
    .map(
      (item) =>
        `<li>${escapeHtml(item.title || item.type)} <span class="status">${escapeHtml(item.hash || "-")} · ${new Date(item.generatedAt).toLocaleString()}</span><div class="actions"><button class="secondary" data-action="copy-proof" data-text="${escapeHtml(item.content || item.hash || "")}">${pickText("复制", "Copy","コピー", "복사")}</button><button class="secondary" data-action="share-proof" data-title="${escapeHtml(item.title || item.type)}" data-text="${escapeHtml(item.content || item.hash || "")}">${pickText("分享", "Share","共有", "공유")}</button></div></li>`,
    )
    .join("");
  const support = detail.support
    ? `<div>${pickText("工单", "Ticket","チケット", "티켓")}: <span class="code">${escapeHtml(detail.support.ticketId)}</span> · <span class="status-badge ${escapeHtml(detail.support.status)}">${escapeHtml(localizeStatus(detail.support.status))}</span> · ${escapeHtml(detail.support.handler)}</div>
       <div class="status eta-live" data-created-at="${escapeHtml(detail.support.createdAt || detail.support.updatedAt || new Date().toISOString())}" data-eta-min="${Number(detail.support.etaMin || 0)}"></div>
       <div class="actions">
         <button class="secondary" data-action="ticket-evidence" data-ticket="${escapeHtml(detail.support.ticketId)}">${pickText("补充材料", "Upload evidence","証拠を追加", "증빙 추가")}</button>
       </div>`
    : `<div class='status'>${pickText("暂无关联工单。", "No support ticket linked.","関連チケットはありません。", "연결된 티켓이 없습니다.")}</div>`;
  if (el.orderDrawerTitle) {
    delete el.orderDrawerTitle.dataset.lockedTitle;
    el.orderDrawerTitle.textContent = `${pickText("订单详情", "Order detail","注文詳細", "주문 상세")} · ${escapeHtml(detail.orderId || orderId)}`;
  }
  el.orderDrawerBody.innerHTML = `
    <article class="card">
      <h3>${pickText("订单生命周期", "Order Lifecycle","注文ライフサイクル", "주문 라이프사이클")}: ${escapeHtml(detail.orderId || orderId)}</h3>
      <div>${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${escapeHtml(detail.status || "")}">${escapeHtml(localizeStatus(detail.status || "-"))}</span> · ${pickText("金额", "Amount","金額", "금액")}: ${Number(detail.amount || 0)} ${escapeHtml(detail.currency || "CNY")}</div>
      <ol class="steps">${lifecycle || `<li>${pickText("暂无生命周期数据。", "No lifecycle.","ライフサイクルがありません。", "라이프사이클이 없습니다.")}</li>`}</ol>
    </article>
    <article class="card">
      <h3>${pickText("凭证包", "Proof Bundle","証憑バンドル", "증빙 번들")}</h3>
      <ul class="steps">${proofItems || `<li>${pickText("暂无凭证。", "No proof items.","証憑がありません。", "증빙이 없습니다.")}</li>`}</ul>
      <div class="actions">
        <button class="secondary" data-action="open-proof" data-order="${escapeHtml(orderId)}">${pickText("打开凭证抽屉", "Open Proof Drawer","証憑ドロワーを開く", "증빙 서랍 열기")}</button>
      </div>
    </article>
    <article class="card">
      <h3>${pickText("退款", "Refund","返金", "환불")}</h3>
      <div>${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${(detail.refund && detail.refund.status) || "queued"}">${escapeHtml(localizeStatus((detail.refund && detail.refund.status) || "queued"))}</span></div>
      <div>${pickText("预计到账", "ETA","着金目安", "환불 ETA")}: ${escapeHtml((detail.refund && detail.refund.eta) || "T+1 to T+3")}</div>
      <div class="status">${pickText("规则", "Policy","ポリシー", "정책")}: ${escapeHtml((detail.refund && detail.refund.policy && detail.refund.policy.freeCancelWindowMin) || 10)} ${pickText("分钟内免费取消", "min free cancel window","分以内は無料取消", "분 이내 무료 취소")}</div>
    </article>
    <article class="card">
      <h3>${pickText("售后支持", "Support","サポート", "지원")}</h3>
      ${support}
    </article>
  `;
  motion.bindPressables(el.orderDrawerBody);
  updateSupportEtaCountdown();
  openOrderDrawer(trigger);
}

async function loadAuditLogs() {
  if (skeleton) {
    if (el.auditList) skeleton.render(el.auditList, { count: 2, lines: 3 });
    if (el.mcpList) skeleton.render(el.mcpList, { count: 2, lines: 3 });
    if (el.supportList) skeleton.render(el.supportList, { count: 2, lines: 3 });
  }
  const [logsData, mcpData, supportData, userData, providerData, probeData, railsData, reconData, complianceData, contractsData, llmData] = await Promise.all([
    api("/api/trust/audit-logs"),
    api("/api/trust/mcp-calls"),
    api("/api/support/tickets"),
    api("/api/user"),
    api("/api/system/providers"),
    api("/api/system/providers/probe"),
    api("/api/payments/rails"),
    api("/api/billing/reconciliation"),
    api("/api/payments/compliance"),
    api("/api/mcp/contracts"),
    api("/api/system/llm-status").catch(() => null),
  ]);
  if (skeleton) {
    if (el.auditList) skeleton.clear(el.auditList);
    if (el.mcpList) skeleton.clear(el.mcpList);
    if (el.supportList) skeleton.clear(el.supportList);
  }

  el.languageTag.textContent = userData.user.language;
  state.uiLanguage = userData.user.language || "EN";
  applyLanguagePack();
  const hasGps = userData.user && userData.user.location && Number.isFinite(Number(userData.user.location.lat)) && Number.isFinite(Number(userData.user.location.lng));
  el.locationTag.textContent = hasGps ? `${userData.user.city || "Shanghai"} · GPS` : userData.user.city || "Shanghai";
  state.selectedConstraints.city = userData.user.city || state.selectedConstraints.city || "Shanghai";
  state.viewMode = IS_USER_PORTAL ? "user" : userData.user.viewMode === "admin" ? "admin" : "user";
  state.auditLogs = Array.isArray(logsData.logs) ? logsData.logs : [];
  state.supportTickets = Array.isArray(supportData.tickets) ? supportData.tickets : [];
  if (store) store.dispatch({ type: "SET_AUDIT", logs: state.auditLogs });
  updateViewModeUI();
  el.authForm.noPinEnabled.value = String(userData.user.authDomain.noPinEnabled);
  el.authForm.dailyLimit.value = userData.user.authDomain.dailyLimit;
  el.authForm.singleLimit.value = userData.user.authDomain.singleLimit;
  el.prefForm.language.value = userData.user.language;
  el.prefForm.budget.value = userData.user.preferences.budget || "mid";
  if (el.prefForm.dietary) el.prefForm.dietary.value = userData.user.preferences.dietary || "";
  if (el.prefForm.family) el.prefForm.family.value = String(userData.user.preferences.family === true);
  if (el.prefForm.transport) el.prefForm.transport.value = userData.user.preferences.transport || "mixed";
  if (el.prefForm.accessibility) el.prefForm.accessibility.value = userData.user.preferences.accessibility || "optional";
  if (el.prefForm.hotel) el.prefForm.hotel.value = (userData.user.savedPlaces && userData.user.savedPlaces.hotel) || "";
  if (el.prefForm.office) el.prefForm.office.value = (userData.user.savedPlaces && userData.user.savedPlaces.office) || "";
  if (el.prefForm.airport) el.prefForm.airport.value = (userData.user.savedPlaces && userData.user.savedPlaces.airport) || "";
  el.privacyForm.locationEnabled.value = String(userData.user.privacy.locationEnabled);
  if (el.railForm) {
    el.railForm.railId.value = railsData.selected || "alipay_cn";
  }
  if (el.complianceForm) {
    const rid = el.complianceForm.railId.value || "alipay_cn";
    const item = (complianceData.compliance && complianceData.compliance.rails && complianceData.compliance.rails[rid]) || {};
    el.complianceForm.certified.value = String(item.certified !== false);
    el.complianceForm.kycPassed.value = String(item.kycPassed !== false);
    el.complianceForm.pciDss.value = String(item.pciDss !== false);
    el.complianceForm.enabled.value = String(item.enabled !== false);
    el.complianceForm.riskTier.value = item.riskTier || "medium";
  }
  if (el.compliancePolicyForm) {
    const policy = (complianceData.compliance && complianceData.compliance.policy) || {};
    el.compliancePolicyForm.blockUncertifiedRails.value = String(policy.blockUncertifiedRails !== false);
    el.compliancePolicyForm.requireFraudScreen.value = String(policy.requireFraudScreen !== false);
  }

  el.plusStatus.textContent = userData.user.plusSubscription.active
    ? pickText(
        `方案：${userData.user.plusSubscription.plan}（已开通）`,
        `Plan: ${userData.user.plusSubscription.plan} (ACTIVE)`,
        `プラン: ${userData.user.plusSubscription.plan}（有効）`,
        `플랜: ${userData.user.plusSubscription.plan} (활성)`,
      )
    : pickText("未订阅", "Not subscribed","未加入", "미구독");
  const gaodeLabel = providerData.gaode.enabled ? "Gaode LIVE" : "Gaode mock";
  const partnerLabel = providerData.partnerHub && providerData.partnerHub.enabled ? "PartnerHub external" : "PartnerHub mock";
  const contracts = contractsData.contracts || {};
  const missingProviders = providerData.liveReadiness && Array.isArray(providerData.liveReadiness.missing)
    ? providerData.liveReadiness.missing
    : [];
  el.providerStatus.textContent = pickText(
    `数据源：${gaodeLabel}, ${partnerLabel} · MCP 合同 ${Number(contracts.enforcedContracts || 0)}/${Number(contracts.totalContracts || 0)} 已启用${
      missingProviders.length ? ` · 缺少环境变量: ${missingProviders.join(", ")}` : ""
    }`,
    `Providers: ${gaodeLabel}, ${partnerLabel} · MCP contracts ${Number(contracts.enforcedContracts || 0)}/${Number(contracts.totalContracts || 0)} enforced${
      missingProviders.length ? ` · Missing env: ${missingProviders.join(", ")}` : ""
    }`,
    `データソース: ${gaodeLabel}, ${partnerLabel} · MCP契約 ${Number(contracts.enforcedContracts || 0)}/${Number(contracts.totalContracts || 0)} 有効${
      missingProviders.length ? ` · 不足環境変数: ${missingProviders.join(", ")}` : ""
    }`,
    `데이터 소스: ${gaodeLabel}, ${partnerLabel} · MCP 계약 ${Number(contracts.enforcedContracts || 0)}/${Number(contracts.totalContracts || 0)} 적용${
      missingProviders.length ? ` · 누락 환경변수: ${missingProviders.join(", ")}` : ""
    }`,
  );
  if (el.providerProbeSummary) {
    const probes = Array.isArray(probeData.probes) ? probeData.probes : [];
    const lines = probes
      .map(
        (probe) =>
          `${probe.provider}: ${probe.mode} · p95 ${Number(probe.p95Ms || 0)}ms · SLA ${(Number(probe.slaMetRate || 0) * 100).toFixed(1)}% · ${pickText("调用", "calls","呼び出し", "호출")} ${Number(probe.sampleCalls || 0)}`,
      )
      .join(" | ");
    const health = probeData.ready
      ? i18n.t(state.uiLanguage, "ui.provider_probe_ready")
      : `${i18n.t(state.uiLanguage, "ui.provider_probe_missing")}: ${(probeData.missing || []).join(", ") || "-"}`;
    el.providerProbeSummary.textContent = `${health} · ${lines || "-"}`;
  }
  if (el.railStatus) {
    const selectedRail = (railsData.rails || []).find((r) => r.selected);
    const comp = selectedRail && selectedRail.compliance ? selectedRail.compliance : {};
    el.railStatus.textContent = selectedRail
      ? pickText(
        `当前支付方式：${selectedRail.label}（${selectedRail.supportsForeignCard ? "支持外卡" :"仅中国钱包"}）· 合规认证 ${comp.certified ? "通过" :"未通过"}`,
        `Current payment rail: ${selectedRail.label} (${selectedRail.supportsForeignCard ? "foreign card supported" : "CN wallet only"}) · certified ${comp.certified ? "yes" : "no"}`,
        `現在の決済レール: ${selectedRail.label}（${selectedRail.supportsForeignCard ? "海外カード対応" :"中国ウォレットのみ"}）· 認証 ${comp.certified ? "済み" :"未"} `,
        `현재 결제 레일: ${selectedRail.label} (${selectedRail.supportsForeignCard ? "해외카드 지원" : "중국 지갑 전용"}) · 인증 ${comp.certified ? "완료" : "미완료"}`,
      )
      : pickText("当前支付方式：-", "Current payment rail: -", "現在の決済レール: -", "현재 결제 레일: -");
  }
  if (el.reconSummary) {
    const c = reconData.current || {};
    el.reconSummary.textContent = pickText(
      `对账匹配率 ${(Number(c.matchRate || 0) * 100).toFixed(1)}% · 差异 ${Number(c.mismatched || 0)} · 样本 ${Number(c.checked || 0)}`,
      `Reconciliation ${(Number(c.matchRate || 0) * 100).toFixed(1)}% match · mismatches ${Number(c.mismatched || 0)} · checked ${Number(c.checked || 0)}`,
      `照合一致率 ${(Number(c.matchRate || 0) * 100).toFixed(1)}% · 差異 ${Number(c.mismatched || 0)} · 対象 ${Number(c.checked || 0)}`,
      `정산 일치율 ${(Number(c.matchRate || 0) * 100).toFixed(1)}% · 불일치 ${Number(c.mismatched || 0)} · 대상 ${Number(c.checked || 0)}`,
    );
  }

  renderLlmRuntimeStatus(llmData);
  if (el.llmModelSelect && llmData && llmData.model) {
    const modelValue = String(llmData.model);
    const hasOption = [...el.llmModelSelect.options].some((opt) => String(opt.value) === modelValue);
    if (!hasOption) {
      const extra = document.createElement("option");
      extra.value = modelValue;
      extra.textContent = modelValue;
      el.llmModelSelect.appendChild(extra);
    }
    el.llmModelSelect.value = modelValue;
  }

  if (el.trustSummaryCard) {
    try {
      const trust = await api("/api/trust/summary");
      const s = trust.summary || {};
      el.trustSummaryCard.innerHTML = `
        <article class="card">
          <div>${pickText("今日受保护支付", "Protected payments today","本日保護された決済", "오늘 보호된 결제")}: <strong>${Number(s.protectedPaymentsBlocked || 0)}</strong></div>
          <div>${pickText("风险拦截次数", "Risk interceptions","リスク遮断回数", "위험 차단 횟수")}: <strong>${Number(s.riskyTransactions || 0)}</strong></div>
          <div class="status">${pickText("位置共享", "Location sharing","位置共有", "위치 공유")}: ${s.locationSharing ? pickText("已开启（仅本任务）", "enabled (task-scoped)","有効（タスク単位）", "활성 (작업 범위)") : pickText("已关闭", "disabled","無効", "비활성")}</div>
          <div class="status">No-PIN: ${s.delegation && s.delegation.noPinEnabled ? pickText("已开启", "enabled","有効", "활성") : pickText("已关闭", "disabled","無効", "비활성")} · ${pickText("单笔", "Single","単筆", "단건")} ${Number((s.delegation && s.delegation.singleLimit) || 0)} · ${pickText("单日", "Daily","日次", "일일")} ${Number((s.delegation && s.delegation.dailyLimit) || 0)} CNY</div>
        </article>
      `;
    } catch {
      el.trustSummaryCard.innerHTML = `<article class="card">${pickText("信任摘要暂不可用。", "Trust summary unavailable.","信頼サマリーを取得できません。", "신뢰 요약을 불러올 수 없습니다.")}</article>`;
    }
  }

  el.auditList.innerHTML = !logsData.logs.length
    ? `<article class="card">${pickText("暂无日志。", "No logs.","ログはありません。", "로그가 없습니다.")}</article>`
    : logsData.logs
        .map(
          (log) => `
      <article class="card">
        <h3>${escapeHtml(log.what)}</h3>
        <div class="status">${new Date(log.at).toLocaleString()}</div>
        <div>Hash: <span class="code">${escapeHtml(log.hash)}</span></div>
        <div class="actions">
          <button class="secondary" data-action="open-audit-event" data-audit-id="${escapeHtml(log.id)}">${pickText("查看事件", "Open event","イベントを表示", "이벤트 열기")}</button>
        </div>
      </article>
    `,
        )
        .join("");
  motion.bindPressables(el.auditList);

  el.mcpList.innerHTML = !mcpData.calls.length
    ? `<article class="card">${pickText("暂无 MCP 调用。", "No MCP calls yet.", "MCP呼び出しはまだありません。", "MCP 호출이 아직 없습니다.")}</article>`
    : mcpData.calls
        .map(
          (call) => `
      <article class="card">
        <h3>${escapeHtml(call.op)} · ${escapeHtml(call.toolType)}</h3>
        <div class="status">${new Date(call.at).toLocaleString()} · ${call.response.latency}ms / SLA ${Number(call.response.slaMs || 0)}ms (${call.response.slaMet ? pickText("达标", "met","達成", "충족") : pickText("超时", "breach","違反", "위반")})</div>
        <div>${pickText("结果", "Result","結果", "결과")}: ${escapeHtml(call.response.status)} | ${pickText("代码", "Code","コード", "코드")}: ${escapeHtml(call.response.code)}</div>
        <div class="status">${pickText("提供方", "Provider","プロバイダ", "공급자")}: ${escapeHtml((call.response.data && call.response.data.provider) || "-")} · ${pickText("来源", "Source","ソース", "소스")}: ${escapeHtml((call.response.data && call.response.data.source) || "-")}</div>
        <div class="status">${pickText("契约", "Contract","契約", "계약")}: ${escapeHtml(call.response.contractId || "-")}</div>
      </article>
    `,
        )
        .join("");

  if (el.supportList) {
    el.supportList.innerHTML = !supportData.tickets.length
      ? `<article class="card">${pickText("暂无工单。", "No support tickets.","サポートチケットはありません。", "지원 티켓이 없습니다.")}</article>`
      : supportData.tickets
          .map(
            (ticket) => `
        <article class="card">
          <h3>${escapeHtml(ticket.id)}</h3>
          <div>${pickText("状态", "Status","状態", "상태")}: <span class="status-badge ${escapeHtml(ticket.status)}">${escapeHtml(localizeStatus(ticket.status))}</span> · ${pickText("来源", "Source","ソース", "소스")}: ${escapeHtml(ticket.source)} · ${pickText("处理方", "Handler","担当", "담당")}: ${escapeHtml(ticket.handler || "human")}</div>
          <div class="status">${new Date(ticket.createdAt).toLocaleString()} · <span class="eta-live" data-created-at="${escapeHtml(ticket.createdAt)}" data-eta-min="${Number(ticket.etaMin || 0)}">${pickText("预计", "ETA","目安", "예상")} ${Number(ticket.etaMin || 0)} ${pickText("分钟", "min","分", "분")}</span></div>
          <div class="status">${pickText("证据数量", "Evidence","証拠数", "증빙 수")}: ${Array.isArray(ticket.evidence) ? ticket.evidence.length : 0}</div>
          <div class="status">${pickText("实时会话", "Live room","ライブ会話", "실시간 상담")}: ${ticket.liveSession ? `${escapeHtml(ticket.liveSession.status)} · ${pickText("坐席未读", "Ops unread","オペレーター未読", "상담원 미확인")} ${Number((ticket.liveSession.unread && ticket.liveSession.unread.ops) || 0)}` : pickText("未创建", "not started","未開始", "미시작")}</div>
          <div class="actions">
            <button class="secondary" data-action="open-ticket-detail" data-ticket="${escapeHtml(ticket.id)}">${pickText("查看详情", "Open Detail","詳細を見る", "상세 보기")}</button>
            ${ticket.status === "open" ? `<button class="secondary" data-action="ticket-progress" data-ticket="${escapeHtml(ticket.id)}">${pickText("转处理中", "Mark In Progress","対応中にする", "처리중으로 변경")}</button>` : ""}
            ${ticket.status === "in_progress" ? `<button class="secondary" data-action="ticket-resolve" data-ticket="${escapeHtml(ticket.id)}">${pickText("标记已解决", "Mark Resolved","解決済みにする", "해결 완료로 변경")}</button>` : ""}
            <button class="secondary" data-action="open-live-support" data-ticket="${escapeHtml(ticket.id)}">${pickText("进入实时会话", "Open Live Room","ライブ会話を開く", "실시간 상담 열기")}</button>
            <button class="secondary" data-action="ticket-evidence" data-ticket="${escapeHtml(ticket.id)}">${pickText("上传凭证", "Upload Evidence","証拠を追加", "증빙 업로드")}</button>
          </div>
        </article>
      `,
          )
          .join("");
    motion.bindPressables(el.supportList);
    updateSupportEtaCountdown();
  }
  renderHumanAssistDock();
}

async function loadDashboard() {
  if (!el.kpiSummary || !el.flagsSummary) return;
  const [kpiData, funnelData, prdData, revenueData, mcpSlaData, flagsData, evaluatedData, mcpPolicyData] = await Promise.all([
    api("/api/dashboard/kpi"),
    api("/api/dashboard/funnel"),
    api("/api/dashboard/prd-coverage"),
    api("/api/dashboard/revenue"),
    api("/api/dashboard/mcp-sla"),
    api("/api/system/flags"),
    api("/api/system/flags/evaluate?userId=demo"),
    api("/api/system/mcp-policy"),
  ]);

  const ns = kpiData.kpi.northStar;
  const totals = kpiData.kpi.totals;
  const quality = kpiData.kpi.quality;

  el.kpiSummary.innerHTML = `
    <article class="card">
      <h3>${escapeHtml(ns.name)}</h3>
      <div>Rate: <strong>${(ns.value * 100).toFixed(1)}%</strong></div>
      <div class="status">${ns.numerator}/${ns.denominator} completed</div>
      <div class="status">Avg step latency: ${quality.avgStepLatencyMs} ms</div>
      <div class="status">SLA first response p50/p90: ${quality.firstResponseMinP50}/${quality.firstResponseMinP90} min</div>
      <div class="status">SLA resolution p50/p90: ${quality.resolutionMinP50}/${quality.resolutionMinP90} min</div>
      <div class="status">Tasks: ${totals.tasks} · Orders: ${totals.orders} · Settlements: ${totals.settlements || 0}</div>
      <div class="status">Reconciliation runs: ${totals.reconciliationRuns || 0}</div>
    </article>
  `;

  if (el.funnelSummary) {
    const f = funnelData.funnel || {};
    el.funnelSummary.innerHTML = `
      <article class="card">
        <div>Intent: ${Number(f.intentSubmitted || 0)}</div>
        <div>Planned: ${Number(f.planned || 0)}</div>
        <div>Confirmed: ${Number(f.confirmed || 0)}</div>
        <div>Executed: ${Number(f.executed || 0)}</div>
        <div>Paid: ${Number(f.paid || 0)}</div>
        <div>Delivered: ${Number(f.delivered || 0)}</div>
        <div>Handoff Open: ${Number(f.handoff || 0)}</div>
        <div>Handoff Resolved: ${Number(f.handoffResolved || 0)}</div>
      </article>
    `;
  }

  if (el.revenueSummary) {
    const rev = revenueData.revenue || {};
    const st = rev.settlements || {};
    const recon = rev.reconciliation || {};
    el.revenueSummary.innerHTML = `
      <article class="card">
        <div>Gross: <strong>${Number(rev.gross || 0)} ${escapeHtml(rev.currency || "CNY")}</strong></div>
        <div>Net: ${Number(rev.net || 0)} ${escapeHtml(rev.currency || "CNY")}</div>
        <div>Markup: ${Number(rev.markup || 0)} (${(Number(rev.markupRateRealized || 0) * 100).toFixed(1)}%)</div>
        <div class="status">Refunds: ${Number(rev.refunds || 0)} · Net after refund: ${Number(rev.netAfterRefund || 0)}</div>
        <div class="status">Settled gross/net: ${Number(st.totalSettledGross || 0)} / ${Number(st.totalSettledNet || 0)} ${escapeHtml(st.currency || "CNY")} (${Number(st.count || 0)} records)</div>
        <div class="status">Recon match: ${(Number(recon.matchRate || 0) * 100).toFixed(1)}% · mismatches ${Number(recon.mismatched || 0)} · provider entries ${Number(recon.providerEntries || 0)}</div>
      </article>
    `;
  }

  if (el.mcpSlaSummary) {
    const sla = mcpSlaData.sla || {};
    const byOp = sla.byOp || {};
    el.mcpSlaSummary.innerHTML = `
      <article class="card">
        <div>MCP SLA Met: <strong>${(Number(sla.metRate || 0) * 100).toFixed(1)}%</strong></div>
        <div class="status">Total: ${Number(sla.total || 0)} · Met: ${Number(sla.met || 0)} · Breached: ${Number(sla.breached || 0)}</div>
        <div class="status">Contract-bound calls: ${Number(sla.contractBound || 0)}</div>
      </article>
      <article class="card">
        <h3>By Operation</h3>
        <ul class="steps">
          ${
            Object.keys(byOp).length
              ? Object.entries(byOp)
                  .map(([op, item]) => `<li>${escapeHtml(op)} · ${item.met}/${item.total} met · avg ${item.avgLatencyMs}ms</li>`)
                  .join("")
              : `<li>${pickText("暂无 SLA 数据。", "No SLA data.", "SLAデータはありません。", "SLA 데이터가 없습니다.")}</li>`
          }
        </ul>
      </article>
    `;
  }

  if (el.prdCoverageSummary) {
    const coverage = prdData.coverage || {};
    const modules = coverage.modules || [];
    const remaining = coverage.remaining || [];
    el.prdCoverageSummary.innerHTML = `
      <article class="card">
        <div>Completion: <strong>${Number(coverage.percent || 0)}%</strong></div>
        <div class="status">Modules: ${modules.length}</div>
        <div class="status">Remaining items: ${remaining.length}</div>
      </article>
      <article class="card">
        <h3>Module Status</h3>
        <ul class="steps">
          ${
            modules.length
              ? modules.map((m) => `<li>${escapeHtml(m.name)} · <strong>${escapeHtml(m.status)}</strong></li>`).join("")
              : `<li>${pickText("暂无模块数据。", "No module data.","モジュールデータはありません。", "모듈 데이터가 없습니다.")}</li>`
          }
        </ul>
      </article>
      <article class="card">
        <h3>Remaining Requirements</h3>
        <ul class="steps">
          ${
            remaining.length
              ? remaining.map((item) => `<li>${escapeHtml(item)}</li>`).join("")
              : `<li>${pickText("暂无剩余需求。", "No remaining requirements.","残要件はありません。", "남은 요구사항이 없습니다.")}</li>`
          }
        </ul>
      </article>
    `;
  }

  const flags = Object.entries(flagsData.flags || {});
  const evaluated = evaluatedData.evaluated || {};
  const flagCards = flags.length
    ? flags.map(
        ([name, conf]) => `
      <article class="card">
        <h3>${escapeHtml(name)}</h3>
        <div>Enabled: ${conf.enabled ? "Yes" : "No"}</div>
        <div class="status">Rollout: ${Number(conf.rollout || 0)}%</div>
        <div class="status">Bucket: ${Number((evaluated[name] && evaluated[name].bucket) || 0)} · ${evaluated[name] && evaluated[name].active ? "ACTIVE" : "inactive"}</div>
      </article>
    `,
      )
    : [`<article class="card">${pickText("未配置灰度标记。", "No feature flags configured.","機能フラグは未設定です。", "기능 플래그가 설정되지 않았습니다.")}</article>`];
  flagCards.push(`
    <article class="card">
      <h3>MCP Policy</h3>
      <div>Strict SLA: ${(mcpPolicyData.policy && mcpPolicyData.policy.enforceSla) ? "Enabled" : "Disabled"}</div>
      <div class="status">Simulated breach rate: ${Number((mcpPolicyData.policy && mcpPolicyData.policy.simulateBreachRate) || 0)}%</div>
    </article>
  `);
  el.flagsSummary.innerHTML = flagCards.join("");

  if (el.flagsForm) {
    el.flagsForm.plusConciergeRollout.value = Number((flagsData.flags.plusConcierge && flagsData.flags.plusConcierge.rollout) || 0);
    el.flagsForm.liveTranslationRollout.value = Number((flagsData.flags.liveTranslation && flagsData.flags.liveTranslation.rollout) || 0);
    el.flagsForm.manualFallbackRollout.value = Number((flagsData.flags.manualFallback && flagsData.flags.manualFallback.rollout) || 0);
  }
  if (el.mcpPolicyForm) {
    el.mcpPolicyForm.enforceSla.value = String((mcpPolicyData.policy && mcpPolicyData.policy.enforceSla) === true);
    el.mcpPolicyForm.simulateBreachRate.value = Number((mcpPolicyData.policy && mcpPolicyData.policy.simulateBreachRate) || 0);
  }
}

async function loadUserProfile() {
  await Promise.all([loadAuditLogs(), loadDashboard(), loadSolutionBoard(), loadChatSolutionStrip(), loadMiniPackage()]);
}

async function loadBuildInfo() {
  if (!el.buildTag) return;
  try {
    const [data, llm] = await Promise.all([api("/api/system/build"), api("/api/system/llm-status").catch(() => null)]);
    const llmTag = llm && llm.configured ? "ChatGPT:on" : "ChatGPT:off";
    el.buildTag.textContent = `build:${data.buildId} · ${llmTag}`;
    document.title = `Cross X | ${data.buildId}`;
  } catch {
    el.buildTag.textContent = "build:unknown";
    document.title = "Cross X | build:unknown";
  }
}

function renderRequires(requires) {
  const list = Array.isArray(requires) ? requires : [];
  if (!list.length) return '<span class="req-chip">NONE</span>';
  const map = {
    location_permission: { code: "LOC", label: pickText("需定位", "Location","位置情報", "위치") },
    payment_delegation: { code: "PAY", label: pickText("需代付", "Delegated pay","委任決済", "위임결제") },
    no_pin_limit: { code: "PIN", label: pickText("免密限额", "No-PIN limit", "No-PIN上限", "무PIN 한도") },
    user_confirmation: { code: "OK", label: pickText("需确认", "Confirmation","確認必須", "확인 필요") },
    account_binding: { code: "ACC", label: pickText("需绑定", "Account bind","アカウント連携", "계정 연동") },
  };
  return list
    .map((key) => {
      const item = map[String(key)] || { code: "REQ", label: String(key) };
      return `<span class="req-chip" title="${escapeHtml(item.label)}">${escapeHtml(item.code)}</span>`;
    })
    .join("");
}

function renderLaneCandidates(candidates, compact) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (!list.length) return "";
  const rows = list
    .slice(0, compact ? 1 : 3)
    .map(
      (item) => `
      <article class="lane-candidate">
        <img class="lane-candidate-image media-photo" src="${escapeHtml(assetUrl(item.imageUrl || "/assets/solution-flow.svg"))}" alt="${escapeHtml(item.name || "candidate")}" />
        <div class="lane-candidate-info">
          <div><strong>${escapeHtml(item.name || "-")}</strong></div>
          <div class="status">${escapeHtml(item.category || "-")} · ${pickText("推荐分", "Score","推奨スコア", "추천 점수")} ${Number(item.score || 0)}</div>
          <div class="status">${escapeHtml(item.reason || "-")}</div>
        </div>
      </article>
    `,
    )
    .join("");
  return `
    <div class="lane-candidate-wrap">
      <div class="status">${pickText("场景示例（含图片）", "Scenario examples (with photos)","シナリオ例（画像付き）", "시나리오 예시 (이미지 포함)")}</div>
      <div class="lane-candidate-grid">${rows}</div>
    </div>
  `;
}

function renderOptionSpecificRows(item) {
  const details = [];
  if (item && item.placeName) details.push(`${pickText("餐厅/地点", "Place","店舗/地点", "식당/장소")}: ${escapeHtml(item.placeName)}`);
  if (item && item.hotelName) details.push(`${pickText("酒店", "Hotel","ホテル", "호텔")}: ${escapeHtml(item.hotelName)}`);
  if (item && item.transportMode) details.push(`${pickText("交通方式", "Transport","移動手段", "교통수단")}: ${escapeHtml(item.transportMode)}`);
  const detailLine = details.length ? `<div class="status">${details.join(" · ")}</div>` : "";
  const executionRows = item && Array.isArray(item.executionPlan)
    ? item.executionPlan.slice(0, 4).map((step) => `<li>${escapeHtml(step)}</li>`).join("")
    : "";
  const executionBlock = executionRows
    ? `<div class="status">${pickText("执行明细", "Execution plan","実行内訳", "실행 내역")}:</div><ul class="steps">${executionRows}</ul>`
    : "";
  return `${detailLine}${executionBlock}`;
}

function renderSolutionLaneCards(options, recommendedOptionId, compact = false) {
  const list = Array.isArray(options) ? options : [];
  if (!list.length) return `<article class="card">${pickText("暂无可选路线。", "No solution lanes.","利用可能なルートはありません。", "사용 가능한 경로가 없습니다.")}</article>`;
  return list
    .map(
      (item) => `
      <article class="card ${item.id === recommendedOptionId ? "lane-recommended" : ""}">
        <h3>${escapeHtml(item.title || pickText("推荐路线", "Solution lane","推奨ルート", "추천 경로"))}</h3>
        <img class="lane-hero-image media-photo" src="${escapeHtml(assetUrl(item.imagePath || "/assets/solution-flow.svg"))}" alt="${escapeHtml(item.title || "solution lane")}" />
        <div class="status">
          <span class="status-badge lane-grade">${escapeHtml(item.grade || "-")}</span>
          ${pickText("推荐等级", "Recommendation","推奨レベル", "추천 레벨")}: <strong>${escapeHtml(item.recommendationLevel || "-")}</strong> ·
          ${pickText("分数", "Score","スコア", "점수")} ${Number(item.score || 0)} / 100 · ${pickText("类型", "Type","タイプ", "유형")} ${escapeHtml(item.type || "-")}
        </div>
        <div class="status">ETA ${escapeHtml(item.etaWindow || "-")} · ${pickText("成功率", "Success","成功率", "성공률")} ${(Number(item.successRate7d || 0) * 100).toFixed(0)}% · ${pickText("风险", "Risk","リスク", "리스크")} ${escapeHtml(item.riskLabel || item.riskLevel || "-")}</div>
        <div class="status">${pickText("费用", "Cost","費用", "비용")} ${escapeHtml(item.costRange || "-")} · ${pickText("前置条件", "Requires","前提条件", "필요 조건")}</div>
        ${renderOptionSpecificRows(item)}
        <div class="requires-row">${renderRequires(item.requires || [])}</div>
        ${renderLaneCandidates(item.candidates || [], compact)}
        <div class="actions">
          <button class="secondary" data-action="toggle-lane" data-lane="${escapeHtml(item.id || "")}">${tUi("lane_show_details")}</button>
        </div>
        <div id="lane-tradeoff-${escapeHtml(item.id || "")}" class="lane-tradeoffs collapsed">
          <div class="status">${tUi("lane_tradeoffs")}: ${escapeHtml((item.tradeoffs || []).join(" | ") || pickText("无", "None","なし", "없음"))}</div>
          ${
            Array.isArray(item.scoring) && item.scoring.length
              ? `<div class="status">${pickText("评分依据", "Scoring basis","評価基準", "평가 기준")}: ${item.scoring.map((x) => `${escapeHtml(x.k)}=${Number(x.v || 0)}`).join(" · ")}</div>`
              : ""
          }
          ${
            compact
              ? ""
              : `<h3>${pickText("评论", "Comments","コメント", "코멘트")}</h3><ul class="steps">${(item.comments || []).map((comment) => `<li>${escapeHtml(comment)}</li>`).join("") || `<li>${pickText("暂无评论。", "No comments.","コメントはありません。", "코멘트가 없습니다.")}</li>`}</ul>`
          }
          ${
            compact
              ? ""
              : `<h3>${pickText("分析", "Analysis","分析", "분석")}</h3><ul class="steps">${(item.analysis || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join("") || `<li>${pickText("暂无分析。", "No analysis.","分析はありません。", "분석이 없습니다.")}</li>`}</ul>`
          }
        </div>
        <div class="actions">
          <button class="secondary" data-action="run-recommended" data-option="${escapeHtml(item.id || "")}" data-intent="${escapeHtml(item.prompt || "")}">${tUi("run_lane")}</button>
        </div>
      </article>
    `,
    )
    .join("");
}

// ── Populate spotlight panel with AI plan data ────────────────────────────
function updateSpotlightWithAiPlan(cd, spokenText) {
  if (!el.chatSolutionStrip) return;
  const plans = Array.isArray(cd.plans) ? cd.plans : [];
  const rec = plans.find((p) => p.is_recommended) || plans[1] || plans[0];
  const dest = escapeHtml(cd.destination || "");
  const dur = cd.duration_days || 3;

  const planRows = plans.map((p) => {
    const bb = p.budget_breakdown || {};
    const bbTotal = Object.values(bb).reduce((s, v) => s + (v || 0), 0) || 1;
    const isRec = p.is_recommended;
    return `
      <div class="sol-plan-row${isRec ? " sol-plan-row--rec" : ""}">
        <div class="sol-plan-tag">${isRec ? "⭐ " : ""}${escapeHtml(p.tag || p.id)}</div>
        <div class="sol-plan-price">¥${Number(p.total_price || 0).toLocaleString()}</div>
        <div class="sol-plan-hotel">${escapeHtml(p.hotel?.name || "")}</div>
        <div class="sol-bb-bar">
          ${bb.accommodation ? `<div class="sol-bb-seg" style="width:${Math.round(bb.accommodation/bbTotal*100)}%;background:#2d87f0" title="住宿\u201d></div>` : ""}
          ${bb.transport ? `<div class="sol-bb-seg" style="width:${Math.round(bb.transport/bbTotal*100)}%;background:#10b981" title="交通\u201d></div>` : ""}
          ${bb.meals ? `<div class="sol-bb-seg" style="width:${Math.round(bb.meals/bbTotal*100)}%;background:#f59e0b" title="餐饮\u201d></div>` : ""}
          ${bb.activities ? `<div class="sol-bb-seg" style="width:${Math.round(bb.activities/bbTotal*100)}%;background:#8b5cf6" title="活动\u201d></div>` : ""}
        </div>
      </div>`;
  }).join("");

  const highlights = rec ? (rec.highlights || []).slice(0, 3).map(
    (h) => `<li><span style="color:#2d87f0">✓</span> ${escapeHtml(h)}</li>`
  ).join("") : "";

  el.chatSolutionStrip.innerHTML = `
    <div class="sol-ai-header">
      <span class="sol-ai-badge">AI 方案</span>
      ${dest ? `<span class="sol-ai-dest">📍 ${dest}</span>` : ""}
      <span class="sol-ai-dur">${dur}${pickText("天","d","日","일")}</span>
    </div>
    ${spokenText ? `<div class="sol-ai-analysis">${escapeHtml(spokenText)}</div>` : ""}
    <div class="sol-plans-list">${planRows}</div>
    ${highlights ? `<ul class="sol-highlights">${highlights}</ul>` : ""}
    <button class="sol-scroll-btn" onclick="document.querySelector('.plan-card--v2')?.scrollIntoView({behavior:'smooth',block:'start'})">
      ${pickText("查看完整方案对比 ↑", "View Full Plan ↑", "フルプラン ↑", "전체 플랜 ↑")}
    </button>
  `;
}

async function loadChatSolutionStrip(taskId = null) {
  if (!el.chatSolutionStrip) return;
  // If we have a fresh AI plan, skip the legacy recommendation API
  if (state.lastAiPlan) return;
  const data = await api(buildRecommendationPath(taskId));
  const r = data.recommendation || {};
  const selected = (r.options || []).find((item) => item.id === r.recommendedOptionId) || (r.options || [])[0] || null;
  const shortComments = (r.comments || []).slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const shortReasons = (r.reasons || []).slice(0, 2).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const laneCards = renderSolutionLaneCards((r.options || []).slice(0, 3), r.recommendedOptionId, true);
  el.chatSolutionStrip.innerHTML = `
    <article class="card">
      <h3>${escapeHtml(r.title || pickText("Cross X 推荐方案", "Cross X Recommended Solution", "Cross X 推奨ソリューション", "Cross X 추천 솔루션"))}</h3>
      <div class="status">${escapeHtml(r.subtitle || pickText("全局组合级推荐", "Portfolio-level recommendation","ポートフォリオ推奨", "포트폴리오 추천"))}</div>
      <img class="solution-overview-image media-photo" src="${escapeHtml(assetUrl(r.imagePath || "/assets/solution-flow.svg"))}" alt="${pickText("方案总览", "Solution overview","ソリューション概要", "솔루션 개요")}" />
      <div class="status">${pickText("推荐路线", "Recommended lane","推奨ルート", "추천 경로")}: <strong>${escapeHtml(r.recommendedOptionId || "-")}</strong> · ${pickText("等级", "Grade","グレード", "등급")} <strong>${escapeHtml(r.recommendedGrade || "-")}</strong> · ${pickText("推荐级别", "Level","レベル", "레벨")} <strong>${escapeHtml(r.recommendedLevel || "-")}</strong></div>
      ${
        selected
          ? `<div class="status">${pickText("餐厅/地点", "Place","店舗/地点", "식당/장소")}: ${escapeHtml(selected.placeName || "-")} · ${pickText("酒店", "Hotel","ホテル", "호텔")}: ${escapeHtml(selected.hotelName || "-")} · ${pickText("交通", "Transport","交通", "교통")}: ${escapeHtml(selected.transportMode || "-")}</div>`
          : ""
      }
      <div class="actions">
        <button class="secondary" data-action="run-recommended" data-option="${escapeHtml(r.recommendedOptionId || "")}" data-intent="${escapeHtml(r.recommendedPrompt || "")}">${pickText("执行推荐方案", "Run Recommended Plan","推奨プランを実行", "추천 플랜 실행")}</button>
      </div>
    </article>
    <article class="card">
      <h3>${pickText("相关评论", "Related Comments","関連コメント", "관련 코멘트")}</h3>
      <ul class="steps">${shortComments || `<li>${pickText("暂无评论。", "No comments.","コメントはありません。", "코멘트가 없습니다.")}</li>`}</ul>
      <h3>${pickText("推荐原因", "Why Recommended","推奨理由", "추천 이유")}</h3>
      <ul class="steps">${shortReasons || `<li>${pickText("暂无分析。", "No analysis.","分析はありません。", "분석이 없습니다.")}</li>`}</ul>
    </article>
    ${laneCards}
  `;
  motion.bindPressables(el.chatSolutionStrip);
}

async function loadSolutionBoard(taskId = null) {
  if (!el.solutionBoard) return;
  const data = await api(buildRecommendationPath(taskId));
  const r = data.recommendation || {};
  const selected = (r.options || []).find((item) => item.id === r.recommendedOptionId) || (r.options || [])[0] || null;
  const comments = (r.comments || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const reasons = (r.reasons || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
  const options = renderSolutionLaneCards(r.options || [], r.recommendedOptionId, false);

  el.solutionBoard.innerHTML = `
    <article class="card">
      <h3>${escapeHtml(r.title || pickText("Cross X 推荐方案", "Cross X Recommended Solution", "Cross X 推奨ソリューション", "Cross X 추천 솔루션"))}</h3>
      <div class="status">${escapeHtml(r.subtitle || pickText("全局组合级推荐", "Portfolio-level recommendation","ポートフォリオ推奨", "포트폴리오 추천"))}</div>
      <img class="solution-overview-image media-photo" src="${escapeHtml(assetUrl(r.imagePath || "/assets/solution-flow.svg"))}" alt="${pickText("Cross X 方案流程", "Cross X solution flow", "Cross X ソリューションフロー", "Cross X 솔루션 플로우")}" />
      <div class="status">${pickText("推荐等级", "Recommended grade","推奨グレード", "추천 등급")}: <strong>${escapeHtml(r.recommendedGrade || "-")}</strong> · ${escapeHtml(r.recommendedLevel || "-")}</div>
      <div class="status">${pickText("闭环率", "Closed-loop","クローズドループ率", "클로즈 루프율")} ${(Number((r.metrics && r.metrics.closedLoopRate) || 0) * 100).toFixed(1)}% · ${pickText("人工接管中", "Open handoffs","有人対応中", "상담 진행")} ${Number((r.metrics && r.metrics.openHandoffs) || 0)}</div>
      <div class="status">MCP SLA ${(Number((r.metrics && r.metrics.mcpSlaRate) || 0) * 100).toFixed(1)}% · ${pickText("毛利率", "Markup","マークアップ率", "마진율")} ${(Number((r.metrics && r.metrics.markupRateRealized) || 0) * 100).toFixed(1)}%</div>
      <div class="status">${pickText("对账匹配", "Reconciliation","照合一致率", "정산 일치율")} ${(Number((r.metrics && r.metrics.reconciliationMatchRate) || 0) * 100).toFixed(1)}% · ${pickText("不一致", "mismatches","不一致", "불일치")} ${Number((r.metrics && r.metrics.reconciliationMismatched) || 0)}</div>
      <div class="status">${pickText("合同覆盖", "Contract coverage","契約カバレッジ", "계약 커버리지")} ${(Number((r.metrics && r.metrics.mcpContractCoverage) || 0) * 100).toFixed(1)}% · ${pickText("通道认证", "Rail certification","レール認証", "레일 인증")} ${(Number((r.metrics && r.metrics.railCertificationRate) || 0) * 100).toFixed(1)}%</div>
      ${
        selected
          ? `<div class="status">${pickText("推荐明细", "Recommended detail","推奨詳細", "추천 상세")}: ${escapeHtml(selected.placeName || "-")} · ${escapeHtml(selected.hotelName || "-")} · ${escapeHtml(selected.transportMode || "-")}</div>`
          : ""
      }
    </article>
    <article class="card">
      <h3>${pickText("相关评论", "Related Comments","関連コメント", "관련 코멘트")}</h3>
      <ul class="steps">${comments || `<li>${pickText("暂无评论。", "No comments.","コメントはありません。", "코멘트가 없습니다.")}</li>`}</ul>
    </article>
    <article class="card">
      <h3>${pickText("推荐分析", "Why This Recommendation","推奨分析", "추천 분석")}</h3>
      <ul class="steps">${reasons || `<li>${pickText("暂无分析。", "No analysis.","分析はありません。", "분석이 없습니다.")}</li>`}</ul>
    </article>
    ${options}
  `;
  motion.bindPressables(el.solutionBoard);
}

async function loadMiniPackage() {
  if (!el.miniPackageSummary) return;
  const data = await api("/api/mini-program/package");
  const pkg = data.package || {};
  const releases = pkg.releases || [];
  const alipay = (pkg.channels && pkg.channels.alipay) || {};
  const wechat = (pkg.channels && pkg.channels.wechat) || {};
  el.miniPackageSummary.innerHTML = `
    <article class="card">
      <div>${pickText("版本", "Version","バージョン", "버전")}: <strong>${escapeHtml(pkg.version || "0.1.0")}</strong></div>
      <div class="status">Alipay: ${escapeHtml(alipay.status || "ready")} ${alipay.lastReleaseAt ? `· ${new Date(alipay.lastReleaseAt).toLocaleString()}` : ""}</div>
      <div class="status">WeChat: ${escapeHtml(wechat.status || "ready")} ${wechat.lastReleaseAt ? `· ${new Date(wechat.lastReleaseAt).toLocaleString()}` : ""}</div>
      <div class="status">${pickText("页面", "Pages","ページ", "페이지")}: ${(pkg.pages || []).join(", ")}</div>
    </article>
    <article class="card">
      <h3>${pickText("最近发布", "Recent Releases","最近のリリース", "최근 릴리즈")}</h3>
      <ul class="steps">
        ${
          releases.length
            ? releases
                .map((r) => `<li>${escapeHtml(r.channel)} · v${escapeHtml(r.version)} · ${new Date(r.at).toLocaleString()} <span class="status">${escapeHtml(r.note || "")}</span></li>`)
                .join("")
            : `<li>${pickText("暂无发布记录。", "No releases yet.","リリースはまだありません。", "릴리즈 기록이 없습니다.")}</li>`
        }
      </ul>
    </article>
  `;
}

function bindActions() {
  document.body.addEventListener("click", async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;

    if (target.classList.contains("tab")) {
      switchTab(target.dataset.tab);
      return;
    }

    if (target.classList.contains("subtab")) {
      state.currentSubtab = target.dataset.subtab;
      renderDrawerTab();
      return;
    }

    const action = target.dataset.action;
    if (!action) return;

    if (action === "open-openai-login") {
      window.open("https://platform.openai.com/settings/organization/api-keys", "_blank", "noopener");
      notify(
        pickText("已打开 OpenAI 登录页。", "Opened OpenAI login page.", "OpenAI ログインページを開きました。", "OpenAI 로그인 페이지를 열었습니다."),
        "info",
      );
      return;
    }

    if (action === "clear-llm-runtime") {
      try {
        await api("/api/system/llm/runtime", {
          method: "POST",
          body: JSON.stringify({ clear: true, persist: true }),
        });
        if (el.llmApiKeyInput) el.llmApiKeyInput.value = "";
        const llm = await api("/api/system/llm-status");
        renderLlmRuntimeStatus(llm);
        notify(
          pickText("已清除运行时 OpenAI Key。", "Runtime OpenAI key cleared.","実行時 OpenAI キーを削除しました。", "런타임 OpenAI 키를 삭제했습니다."),
          "success",
        );
      } catch (err) {
        notify(
          pickText(`清除失败：${err.message}`, `Clear failed: ${err.message}`, `削除失敗: ${err.message}`, `삭제 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "agent-quick-fill") {
      const slot = String(target.dataset.slot || "").trim();
      const value = String(target.dataset.value || "").trim();
      const pref = String(target.dataset.pref || "").trim();
      await applyAgentQuickFill(slot || null, value || null, pref || null);
      return;
    }

    if (action === "agent-remove-slot") {
      const slot = String(target.dataset.slot || "").trim();
      if (!slot) return;
      const slots = state.agentConversation.slots || {};
      if (slot === "execution_permission") {
        slots.execution_permission = false;
      } else if (slot === "preferences") {
        slots.preferences = [];
      } else {
        slots[slot] = null;
      }
      state.agentConversation.slots = slots;
      markAgentSlotEvidence(slot, false);
      evaluateAgentConversation({ silent: false });
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        await refineAgentPlanWithSmartReply("", { announce: false });
      }
      return;
    }

    if (action === "agent-remove-pref") {
      const value = String(target.dataset.value || "").trim();
      if (!value) return;
      const slots = state.agentConversation.slots || {};
      const prefs = Array.isArray(slots.preferences) ? slots.preferences : [];
      slots.preferences = prefs.filter((item) => String(item) !== value);
      state.agentConversation.slots = slots;
      markAgentSlotEvidence("preferences", slots.preferences.length > 0);
      evaluateAgentConversation({ silent: false });
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        await refineAgentPlanWithSmartReply("", { announce: false });
      }
      return;
    }

    if (action === "agent-slot-quick") {
      const slot = String(target.dataset.slot || "").trim();
      const value = String(target.dataset.value || "").trim();
      if (!slot || !value) return;
      const slots = state.agentConversation.slots || {};
      slots[slot] = value;
      state.agentConversation.slots = slots;
      markAgentSlotEvidence(slot, true);
      evaluateAgentConversation({ silent: false });
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        await refineAgentPlanWithSmartReply("", { announce: false });
      }
      return;
    }

    if (action === "agent-request-execute") {
      const optionKey = String(target.dataset.option || "main").trim() || "main";
      const forceFail = String(target.dataset.forceFail || "") === "1";
      state.agentConversation.pendingOptionKey = optionKey;
      const option = optionFromPlan(optionKey);
      if (!option) {
        notify(
          pickText("当前没有可执行方案。", "No executable option available.","実行可能な案がありません。", "실행 가능한 옵션이 없습니다."),
          "warning",
        );
        return;
      }
      if (needsExecutionConfirm(option)) {
        setAgentMode("confirming", { source: "manual_request_execute", option: optionKey });
        rerenderAgentFlowCards();
        addMessage(
          pickText("这个动作会触发锁位和支付，我先给你确认卡。", "This action includes booking lock and payment. Please confirm first.","予約確保と決済を含むため、確認カードを表示します。", "예약 잠금과 결제를 포함하므로 먼저 확인이 필요합니다."),
          "agent",
        );
        state.agentConversation._forceFailNextRun = forceFail;
      } else {
        await runAgentExecution(optionKey, forceFail);
      }
      return;
    }

    if (action === "agent-confirm-execution") {
      const optionKey = String(target.dataset.option || state.agentConversation.pendingOptionKey || "main");
      const slots = state.agentConversation.slots || {};
      slots.execution_permission = true;
      state.agentConversation.slots = slots;
      const forceFail = state.agentConversation._forceFailNextRun === true;
      state.agentConversation._forceFailNextRun = false;
      await runAgentExecution(optionKey, forceFail);
      return;
    }

    if (action === "agent-cancel-confirm") {
      setAgentMode("planning", { source: "cancel_confirm" });
      rerenderAgentFlowCards();
      addMessage(
        pickText("好的，你可以改条件后再执行。", "Okay. You can modify constraints before execution.","了解です。条件を調整してから実行できます。", "좋아요. 조건을 수정한 뒤 실행할 수 있습니다."),
        "agent",
      );
      return;
    }

    if (action === "agent-switch-backup") {
      state.agentConversation.pendingOptionKey = "backup";
      const option = optionFromPlan("backup");
      if (!option) return;
      if (needsExecutionConfirm(option)) {
        setAgentMode("confirming", { source: "switch_backup" });
        rerenderAgentFlowCards();
      } else {
        await runAgentExecution("backup", false);
      }
      return;
    }

    if (action === "agent-retry-run") {
      setAgentMode("planning", { source: "retry_primary" });
      rerenderAgentFlowCards();
      addMessage(
        pickText("我把主方案重新放回执行入口，你确认后继续。", "Primary option is back in queue. Confirm to continue.","主案を再度実行入口に戻しました。確認して続行してください。", "주안을 다시 실행 대기 상태로 돌렸습니다. 확인 후 진행하세요."),
        "agent",
      );
      return;
    }

    if (action === "agent-nav") {
      notify(
        pickText("已打开导航（mock）。", "Navigation opened (mock).","ナビを開きました（mock）。", "내비를 열었습니다 (mock)."),
        "success",
      );
      return;
    }

    if (action === "agent-open-condition-editor") {
      openConditionEditorDrawer(target);
      return;
    }

    if (action === "agent-focus-input") {
      if (el.chatInput) {
        el.chatInput.focus();
      }
      notify(
        pickText("你可以直接补充条件，我会立即重算方案。", "Add or edit constraints and I will replan immediately.","条件を追加入力すると即時に再計画します。", "조건을 추가 입력하면 즉시 재계획합니다."),
        "info",
      );
      return;
    }

    if (action === "close-drawer") {
      closeDrawer();
      return;
    }

    if (action === "close-replan") {
      closeReplanDrawer();
      return;
    }

    if (action === "close-condition-editor") {
      closeConditionEditorDrawer();
      return;
    }

    if (action === "close-proof-drawer") {
      if (drawerController) drawerController.close(el.proofDrawer);
      else if (el.proofDrawer) {
        el.proofDrawer.classList.add("hidden");
        el.proofDrawer.setAttribute("aria-hidden", "true");
      }
      if (el.proofDrawerTitle) {
        delete el.proofDrawerTitle.dataset.lockedTitle;
        el.proofDrawerTitle.textContent = pickText("凭证与支持", "Proof & Support","証憑とサポート", "증빙 및 지원");
      }
      if (el.proofDrawer) delete el.proofDrawer.dataset.ticketId;
      return;
    }

    if (action === "close-order-drawer") {
      closeOrderDrawer();
      return;
    }

    if (action === "close-support-room") {
      await closeSupportRoom();
      return;
    }

    if (action === "open-trust-advanced") {
      switchTab("trust");
      const advanced = document.querySelector(".advanced");
      if (advanced && advanced.tagName === "DETAILS") {
        advanced.open = true;
      }
      return;
    }

    if (action === "support-voice-toggle") {
      try {
        await toggleSupportRoomVoiceRecording();
      } catch (err) {
        notify(
          pickText(`语音发送失败：${err.message}`, `Voice failed: ${err.message}`, `音声送信失敗: ${err.message}`, `음성 전송 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "toggle-lane") {
      const laneId = target.dataset.lane || "";
      const panel = document.getElementById(`lane-tradeoff-${laneId}`);
      if (!panel) return;
      panel.classList.toggle("collapsed");
      const expanded = !panel.classList.contains("collapsed");
      target.textContent = expanded ? tUi("lane_hide_details") : tUi("lane_show_details");
      motion.enter(panel, { duration: 150, fromY: 4 });
      return;
    }

    if (action === "preview-replan") {
      const payload = readReplanPayload();
      if (!payload) {
        if (el.replanHint) el.replanHint.textContent = pickText("缺少任务ID或意图。", "Task ID or intent is missing.","タスクIDまたは意図が不足しています。", "작업 ID 또는 의도가 누락되었습니다.");
        return;
      }
      try {
        if (el.replanHint) el.replanHint.textContent = pickText("正在生成预览...", "Generating preview...", "プレビューを生成中...", "미리보기를 생성 중...");
        const data = await api(`/api/tasks/${payload.taskId}/replan/preview`, {
          method: "POST",
          body: JSON.stringify({
            intent: payload.intent,
            constraints: payload.constraints,
          }),
        });
        renderReplanPreview(data.preview || null);
        if (el.replanHint) el.replanHint.textContent = pickText("预览已生成，可保存。", "Preview generated. You can now save.","プレビューを生成しました。保存できます。", "미리보기가 생성되었습니다. 저장할 수 있습니다.");
      } catch (err) {
        if (el.replanHint) el.replanHint.textContent = pickText(`预览失败：${err.message}`, `Preview failed: ${err.message}`, `プレビュー失敗: ${err.message}`, `미리보기 실패: ${err.message}`);
        addMessage(pickText(`预览改写失败：${err.message}`, `Preview replan failed: ${err.message}`, `再計画プレビューに失敗: ${err.message}`, `재계획 미리보기 실패: ${err.message}`));
      }
      return;
    }

    if (action === "refresh-solution") {
      try {
        await Promise.all([loadSolutionBoard(), loadChatSolutionStrip()]);
        addMessage(pickText("方案分析已刷新。", "Solution analysis refreshed.","提案分析を更新しました。", "솔루션 분석을 새로고침했습니다."));
      } catch (err) {
        addMessage(pickText(`刷新失败：${err.message}`, `Refresh failed: ${err.message}`, `更新失敗: ${err.message}`, `새로고침 실패: ${err.message}`));
      }
      return;
    }

    if (action === "refresh-mini-package") {
      try {
        await loadMiniPackage();
        addMessage(pickText("小程序发布状态已刷新。", "Mini package status refreshed.","ミニプログラム状態を更新しました。", "미니 프로그램 상태를 새로고침했습니다."));
      } catch (err) {
        addMessage(pickText(`小程序状态刷新失败：${err.message}`, `Mini package refresh failed: ${err.message}`, `ミニプログラム更新失敗: ${err.message}`, `미니 프로그램 새로고침 실패: ${err.message}`));
      }
      return;
    }

    if (action === "release-alipay" || action === "release-wechat") {
      const channel = action === "release-alipay" ? "alipay" : "wechat";
      try {
        const data = await api("/api/mini-program/release", {
          method: "POST",
          body: JSON.stringify({ channel, note: "manual release from dashboard" }),
        });
        await trackEvent("mini_release_created", { channel, releaseId: data.release.id });
        addMessage(
          pickText(
            `小程序已发布：${data.release.channel} v${data.release.version}`,
            `Mini program release created: ${data.release.channel} v${data.release.version}`,
            `ミニプログラムを公開しました: ${data.release.channel} v${data.release.version}`,
            `미니 프로그램 릴리즈 완료: ${data.release.channel} v${data.release.version}`,
          ),
        );
        await Promise.all([loadMiniPackage(), loadDashboard(), loadAuditLogs()]);
      } catch (err) {
        addMessage(pickText(`小程序发布失败：${err.message}`, `Mini program release failed: ${err.message}`, `ミニプログラム公開失敗: ${err.message}`, `미니 프로그램 릴리즈 실패: ${err.message}`));
      }
      return;
    }

    if (action === "run-intent") {
      const intent = target.dataset.intent;
      switchTab("chat");
      if (intent) {
        try {
          if (el.chatInput) el.chatInput.value = intent;
          if (isLocalAgentChatEnabled()) await handleAgentConversationInput(intent);
          else await createTaskFromText(intent);
          await trackEvent("quick_intent_clicked", { intent });
        } catch (err) {
          addMessage(pickText(`快捷意图执行失败：${err.message}`, `Failed to run quick intent: ${err.message}`, `クイック意図の実行失敗: ${err.message}`, `빠른 의도 실행 실패: ${err.message}`));
        }
      }
      return;
    }

    if (action === "assist-request-handoff") {
      const taskId = target.dataset.task || (state.currentTask && state.currentTask.id) || "";
      if (!taskId) {
        notify(
          pickText("当前没有可接管任务。先输入一句目标再请求人工。", "No active task to handoff. Start a task first.","引き継ぎ可能なタスクがありません。先に依頼を入力してください。", "인계할 작업이 없습니다. 먼저 작업을 시작하세요."),
          "warning",
        );
        return;
      }
      try {
        await withButtonLoading(
          target,
          pickText("请求中...", "Requesting...","依頼中...", "요청 중..."),
          async () => {
            const data = await api(`/api/tasks/${taskId}/handoff`, {
              method: "POST",
              body: JSON.stringify({ reason: "user_requested_from_assist_dock" }),
            });
            if (data && data.task) {
              state.currentTask = data.task;
              renderAgentBrain(state.currentTask);
            }
            await trackEvent("handoff_requested", { ticketId: data.handoff.ticketId, source: "assist_dock" }, taskId);
            setLoopProgress("support");
            state.voice.pendingTaskId = null;
            addMessage(
              pickText(
                `已请求人工监督。工单 ${data.handoff.ticketId}，预计 ${data.handoff.eta}。`,
                `Human supervision requested. Ticket ${data.handoff.ticketId}, ETA ${data.handoff.eta}.`,
                `有人監督を依頼しました。チケット ${data.handoff.ticketId}、ETA ${data.handoff.eta}。`,
                `사람 감독을 요청했습니다. 티켓 ${data.handoff.ticketId}, ETA ${data.handoff.eta}.`,
              ),
            );
            await openSupportRoomByTicket(data.handoff.ticketId, target, { reason: "assist_handoff_open_live" }).catch(() => {});
            await loadAuditLogs();
          },
        );
      } catch (err) {
        addMessage(pickText(`人工监督请求失败：${err.message}`, `Human supervision failed: ${err.message}`, `有人監督の依頼失敗: ${err.message}`, `사람 감독 요청 실패: ${err.message}`));
      }
      return;
    }

    if (action === "assist-open-support") {
      switchTab("trust", { force: true });
      const supportAnchor = el.supportHeading || el.supportList;
      if (supportAnchor && typeof supportAnchor.scrollIntoView === "function") {
        supportAnchor.scrollIntoView({ behavior: motion.safeDuration(180) <= 1 ? "auto" : "smooth", block: "start" });
      }
      notify(
        pickText("已打开支持工单区。", "Support desk opened.","サポートチケットを開きました。", "지원 티켓 영역을 열었습니다."),
        "info",
      );
      return;
    }

    if (action === "assist-open-live-room") {
      try {
        const preferredTicket = target.dataset.ticket || (state.currentTask && state.currentTask.handoff && state.currentTask.handoff.ticketId) || "";
        if (preferredTicket) {
          await openSupportRoomByTicket(preferredTicket, target, { reason: "assist_live_room_open" });
          return;
        }
        const data = await api("/api/support/sessions/start", {
          method: "POST",
          body: JSON.stringify({
            actor: "user",
            taskId: state.currentTask && state.currentTask.id ? state.currentTask.id : null,
            urgent: false,
            reason: "assist_live_room_without_ticket",
          }),
        });
        if (data && data.ticket) updateSupportRoomTicketState(data.ticket);
        if (data && data.session && data.session.id) {
          await openSupportRoomBySession(data.session.id, target);
        }
      } catch (err) {
        notify(
          pickText(`打开人工会话失败：${err.message}`, `Open live support room failed: ${err.message}`, `有人会話の開始失敗: ${err.message}`, `실시간 상담 룸 열기 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "assist-refresh") {
      try {
        await withButtonLoading(
          target,
          pickText("刷新中...", "Refreshing...","更新中...", "새로고침 중..."),
          async () => {
            await Promise.all([loadAuditLogs(), loadDashboard(), loadTrips()]);
          },
        );
        notify(
          pickText("人工监督状态已刷新。", "Human assist status refreshed.","有人監督ステータスを更新しました。", "사람 감독 상태를 새로고침했습니다."),
          "success",
        );
      } catch (err) {
        addMessage(pickText(`监督状态刷新失败：${err.message}`, `Assist refresh failed: ${err.message}`, `監督状態の更新失敗: ${err.message}`, `감독 상태 새로고침 실패: ${err.message}`));
      }
      return;
    }

    if (action === "open-ticket-detail") {
      const ticketId = target.dataset.ticket || "";
      if (!ticketId) return;
      try {
        await renderSupportTicketDrawer(ticketId, target);
      } catch (err) {
        addMessage(pickText(`工单详情加载失败：${err.message}`, `Ticket detail failed: ${err.message}`, `チケット詳細の読み込み失敗: ${err.message}`, `티켓 상세 로드 실패: ${err.message}`));
      }
      return;
    }

    if (action === "open-live-support") {
      const ticketId = target.dataset.ticket || "";
      if (!ticketId) return;
      try {
        await openSupportRoomByTicket(ticketId, target, { reason: "ticket_detail_live_open" });
      } catch (err) {
        notify(
          pickText(`打开人工会话失败：${err.message}`, `Open live support room failed: ${err.message}`, `有人会話の開始失敗: ${err.message}`, `실시간 상담 룸 열기 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "refresh-ticket-detail") {
      const ticketId = target.dataset.ticket || "";
      if (!ticketId) return;
      try {
        await Promise.all([loadAuditLogs(), loadDashboard()]);
        await renderSupportTicketDrawer(ticketId, target);
        notify(
          pickText("工单详情已刷新。", "Ticket detail refreshed.","チケット詳細を更新しました。", "티켓 상세를 새로고침했습니다."),
          "success",
        );
      } catch (err) {
        addMessage(pickText(`工单刷新失败：${err.message}`, `Ticket refresh failed: ${err.message}`, `チケット更新失敗: ${err.message}`, `티켓 새로고침 실패: ${err.message}`));
      }
      return;
    }

    if (action === "activate-trip") {
      const tripId = target.dataset.trip || "";
      if (!tripId) return;
      state.activeTripId = tripId;
      renderActiveTripHint();
      await loadTrips();
      notify(
        pickText("已设置为当前行程。后续新任务将自动挂载到该行程。", "Active trip set. New tasks will be attached automatically.","現在の旅程に設定しました。新規タスクは自動紐付けされます。", "활성 트립으로 설정되었습니다. 새 작업이 자동 연결됩니다."),
        "success",
      );
      return;
    }

    if (action === "open-trip-detail") {
      const tripId = target.dataset.trip || "";
      if (!tripId) return;
      try {
        await withButtonLoading(target, pickText("加载中...", "Loading...","読み込み中...", "로딩 중..."), async () => {
          await openTripDetail(tripId, target);
        });
      } catch (err) {
        notify(
          pickText(`行程详情加载失败：${err.message}`, `Trip detail failed: ${err.message}`, `旅程詳細の読み込み失敗: ${err.message}`, `트립 상세 로드 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "attach-current-task") {
      const tripId = target.dataset.trip || "";
      const taskId = target.dataset.task || (state.currentTask && state.currentTask.id) || "";
      if (!tripId || !taskId) return;
      try {
        await withButtonLoading(target, pickText("挂载中...", "Attaching...","紐付け中...", "연결 중..."), async () => {
          const data = await api(`/api/trips/${tripId}/tasks`, {
            method: "POST",
            body: JSON.stringify({ taskId }),
          });
          if (data && data.task) {
            state.currentTask = data.task;
            renderAgentBrain(state.currentTask);
          }
          state.activeTripId = tripId;
          renderActiveTripHint();
          await loadTrips();
        });
        notify(
          pickText("已挂载当前任务到行程。", "Current task attached to trip.","現在のタスクを旅程へ紐付けました。", "현재 작업을 트립에 연결했습니다."),
          "success",
        );
      } catch (err) {
        notify(
          pickText(`挂载失败：${err.message}`, `Attach failed: ${err.message}`, `紐付け失敗: ${err.message}`, `연결 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "trip-status") {
      const tripId = target.dataset.trip || "";
      const status = target.dataset.status || "";
      if (!tripId || !status) return;
      try {
        await withButtonLoading(target, pickText("更新中...", "Updating...","更新中...", "업데이트 중..."), async () => {
          await api(`/api/trips/${tripId}/status`, {
            method: "POST",
            body: JSON.stringify({ status }),
          });
          await loadTrips();
        });
      } catch (err) {
        notify(
          pickText(`行程状态更新失败：${err.message}`, `Trip status update failed: ${err.message}`, `旅程状態更新に失敗: ${err.message}`, `트립 상태 업데이트 실패: ${err.message}`),
          "error",
        );
      }
      return;
    }

    if (action === "fill-missing-slot") {
      const taskId = target.dataset.task;
      const slot = target.dataset.slot;
      if (!taskId || !slot) return;
      const value = defaultSlotValue(slot);
      if (!value) {
        notify(
          pickText("该槽位暂不支持自动补全。", "This slot cannot be auto-filled yet.","このスロットは自動補完に未対応です。", "이 슬롯은 자동 보완을 지원하지 않습니다."),
          "warning",
        );
        return;
      }
      try {
        await withButtonLoading(target, pickText("补全中...", "Filling...","補完中...", "보완 중..."), async () => {
          const data = await api(`/api/tasks/${taskId}/state`, {
            method: "POST",
            body: JSON.stringify({
              slots: { [slot]: value },
              replan: true,
              stage: "planning",
            }),
          });
          if (data && data.task) {
            state.currentTask = data.task;
            renderAgentBrain(state.currentTask);
            removeTaskCards(taskId);
            renderPlanCard(data.task);
            renderConfirmCard(data.task);
          }
          addMessage(
            pickText(
              `已补全 ${slotLabel(slot)}：${value}，计划已局部重算。`,
              `Filled ${slotLabel(slot)} as ${value}. Plan recalculated.`,
              `${slotLabel(slot)} を ${value} に補完し、プランを再計算しました。`,
              `${slotLabel(slot)} 을(를) ${value}(으)로 보완하고 계획을 다시 계산했습니다.`,
            ),
            "agent",
          );
          await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
        });
      } catch (err) {
        notify(
          pickText(
            `补全失败：${err.message}`,
            `Fill failed: ${err.message}`,
            `補完に失敗: ${err.message}`,
            `보완 실패: ${err.message}`,
          ),
          "error",
        );
      }
      return;
    }

    if (action === "run-smart-option") {
      const intent = target.dataset.intent;
      switchTab("chat");
      if (!intent) {
        notify(pickText("该方案缺少执行语句。", "This option is missing execution prompt.","この案に実行文がありません。", "이 옵션에 실행 문구가 없습니다."), "warning");
        return;
      }
      try {
        await withButtonLoading(target, pickText("执行中...", "Running...","実行中...", "실행 중..."), async () => {
          if (isLocalAgentChatEnabled()) {
            await handleAgentConversationInput(intent);
            await trackEvent("smart_option_selected", { optionId: target.dataset.option || "unknown" });
          } else {
            await runPromptWithExecution(intent, {
              source: "smart_option",
              optionId: target.dataset.option || "unknown",
            });
            await trackEvent("smart_option_executed", { optionId: target.dataset.option || "unknown" });
          }
        });
      } catch (err) {
        addMessage(
          pickText(
            `执行方案失败：${err.message}`,
            `Run option failed: ${err.message}`,
            `案の実行に失敗しました: ${err.message}`,
            `옵션 실행 실패: ${err.message}`,
          ),
        );
      }
      return;
    }

    if (action === "run-smart-action") {
      const kind = String(target.dataset.kind || "execute").toLowerCase();
      const payload = parseSmartActionPayload(target.dataset.payload);
      const prompt = String(target.dataset.prompt || "").trim();
      const url = String(target.dataset.url || "").trim();
      const optionId = target.dataset.option || "unknown";
      const actionId = target.dataset.actionId || "unknown";
      const resolvedPrompt = prompt || String((payload && payload.prompt) || "").trim();
      if (kind === "link" && url) {
        window.open(url, "_blank", "noopener");
        await trackEvent("smart_action_open_link", { optionId, actionId, url });
        return;
      }
      if (kind === "hotel_book") {
        if (!payload || !payload.hotelId || !payload.roomId) {
          notify(
            pickText(
              "该酒店方案缺少可执行参数，请先换一个方案。",
              "This hotel option is missing executable parameters. Please choose another option.",
              "このホテル案に実行パラメータが不足しています。別の案を選択してください。",
              "이 호텔 옵션에 실행 파라미터가 부족합니다. 다른 옵션을 선택해 주세요.",
            ),
            "warning",
          );
          return;
        }
        switchTab("chat");
        try {
          await withButtonLoading(target, pickText("下单中...", "Booking...","予約中...", "예약 중..."), async () => {
            await runHotelBookingAction(payload, optionId);
            await trackEvent("smart_hotel_book", { optionId, actionId, hotelId: payload.hotelId, roomId: payload.roomId });
          });
        } catch (err) {
          addMessage(
            pickText(
              `酒店下单失败：${err.message}`,
              `Hotel booking failed: ${err.message}`,
              `ホテル予約に失敗しました: ${err.message}`,
              `호텔 예약 실패: ${err.message}`,
            ),
          );
        }
        return;
      }
      if (!resolvedPrompt) {
        notify(
          pickText("该动作缺少可执行内容。", "This action has no executable prompt.","このアクションに実行内容がありません。", "이 작업에 실행 문구가 없습니다."),
          "warning",
        );
        return;
      }
      switchTab("chat");
      try {
        await withButtonLoading(target, pickText("执行中...", "Running...","実行中...", "실행 중..."), async () => {
          if (isLocalAgentChatEnabled()) {
            await handleAgentConversationInput(resolvedPrompt);
            await trackEvent("smart_action_selected", { optionId, actionId, kind });
          } else {
            await runPromptWithExecution(resolvedPrompt, {
              source: `smart_action:${actionId}`,
              optionId,
            });
            await trackEvent("smart_action_executed", { optionId, actionId, kind });
          }
        });
      } catch (err) {
        addMessage(
          pickText(
            `执行动作失败：${err.message}`,
            `Action failed: ${err.message}`,
            `アクション実行失敗: ${err.message}`,
            `작업 실행 실패: ${err.message}`,
          ),
        );
      }
      return;
    }

    if (action === "select-near-item") {
      state.selectedNearItemId = target.dataset.item || null;
      try {
        await loadNearSuggestions();
      } catch (err) {
        addMessage(pickText(`附近预览加载失败：${err.message}`, `Near Me preview failed: ${err.message}`, `近くのプレビュー読込失敗: ${err.message}`, `근처 미리보기 로드 실패: ${err.message}`));
      }
      return;
    }

    if (action === "open-order-detail") {
      try {
        await withButtonLoading(
          target,
          pickText("加载中...", "Loading...","読み込み中...", "로딩 중..."),
          async () => loadOrderDetail(target.dataset.order, target),
        );
        switchTab("trips");
      } catch (err) {
        addMessage(pickText(`订单详情加载失败：${err.message}`, `Order detail failed: ${err.message}`, `注文詳細の読み込み失敗: ${err.message}`, `주문 상세 로드 실패: ${err.message}`));
      }
      return;
    }

    if (action === "retry-step") {
      const taskId = target.dataset.task;
      const stepId = target.dataset.step;
      if (!taskId || !stepId) return;
      try {
        await withButtonLoading(target, pickText("重试中...", "Retrying...","再試行中...", "재시도 중..."), async () => {
          const retry = await api(`/api/tasks/${taskId}/steps/${stepId}/retry`, { method: "POST", body: JSON.stringify({}) });
          await trackEvent("step_retry_requested", { taskId, stepId });
          addMessage(
            pickText(
              `步骤 ${stepId} 已进入重试队列，正在重跑任务。`,
              `Step ${stepId} queued for retry. Re-running task...`,
              `ステップ ${stepId} を再試行キューに入れ、再実行します。`,
              `단계 ${stepId} 재시도 대기열에 추가되어 작업을 다시 실행합니다.`,
            ),
          );
          const executed = await api(`/api/tasks/${taskId}/execute`, { method: "POST" });
          renderTimeline(executed.timeline || []);
          if (executed.order) renderDeliverable(executed.order);
          if (retry && retry.task) {
            state.currentTask = retry.task;
            renderAgentBrain(state.currentTask);
          }
          await Promise.all([loadTrips(), loadOrders(), loadAuditLogs(), loadDashboard()]);
          if (state.currentTaskDetail && state.currentTaskDetail.overview && state.currentTaskDetail.overview.taskId === taskId) {
            await openTaskDetail(taskId);
          }
        });
      } catch (err) {
        addMessage(pickText(`步骤重试失败：${err.message}`, `Retry step failed: ${err.message}`, `ステップ再試行失敗: ${err.message}`, `단계 재시도 실패: ${err.message}`));
      }
      return;
    }

    if (action === "retry-task-exec") {
      const taskId = target.dataset.task;
      if (!taskId) return;
      try {
        await confirmAndExecute(taskId);
      } catch (err) {
        notify(`Retry failed: ${err.message}`, "error");
      }
      return;
    }

    if (action === "switch-lane") {
      const taskId = target.dataset.task;
      if (!taskId) return;
      try {
        const current = await api(`/api/tasks/${taskId}`);
        openReplanDrawer(current.task || null);
        if (el.replanHint) {
          el.replanHint.textContent = pickText(
            "切换路线：选择模板并预览后保存。",
            "Switch lane: choose a template and preview before saving.",
            "ルート切替: テンプレートを選択し、プレビュー後に保存してください。",
            "경로 전환: 템플릿을 선택하고 미리보기 후 저장하세요.",
          );
        }
      } catch (err) {
        addMessage(pickText(`路线切换失败：${err.message}`, `Switch lane failed: ${err.message}`, `ルート切替失敗: ${err.message}`, `경로 전환 실패: ${err.message}`));
      }
      return;
    }

    if (action === "show-refund-policy") {
      const taskId = target.dataset.task;
      if (!taskId) return;
      try {
        const data = await api(`/api/tasks/${taskId}/refund-policy`);
        const p = data.policy || {};
        addCard(`
          <article class="card">
            <h3>${pickText("退款规则", "Refund Policy","返金ポリシー", "환불 정책")}</h3>
            <div>${pickText("取消规则", "Cancel rule","キャンセル規約", "취소 규정")}: ${escapeHtml(p.cancelPolicy || "-")}</div>
            <div>${pickText("金额", "Amount","金額", "금액")}: ${Number(p.amount || 0)} ${escapeHtml(p.currency || "CNY")}</div>
            <div>${pickText("免费取消", "Free cancel","無料キャンセル", "무료 취소")}: ${Number((p.guarantee && p.guarantee.freeCancelWindowMin) || 10)} min</div>
            <div>ETA: ${escapeHtml((p.guarantee && p.guarantee.refundEta) || "T+1 to T+3")}</div>
          </article>
        `);
      } catch (err) {
        addMessage(pickText(`退款规则加载失败：${err.message}`, `Refund policy unavailable: ${err.message}`, `返金規約の取得失敗: ${err.message}`, `환불 정책 로드 실패: ${err.message}`));
      }
      return;
    }

    if (action === "copy-proof") {
      const text = target.dataset.text || "";
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
        notify(tUi("proof_copied"), "success");
      } catch {
        notify(tUi("proof_copy_failed"), "error");
      }
      return;
    }

    if (action === "share-proof") {
      const text = target.dataset.text || "";
      const title = target.dataset.title || "Cross X Proof";
      if (!text) return;
      if (navigator.share) {
        try {
          await navigator.share({ title, text });
          notify(pickText("已调起分享。", "Share panel opened.","共有パネルを開きました。", "공유 패널을 열었습니다."), "success");
          return;
        } catch {
          // fall back to clipboard
        }
      }
      try {
        await navigator.clipboard.writeText(text);
        notify(pickText("已复制分享内容。", "Share text copied.","共有内容をコピーしました。", "공유 텍스트를 복사했습니다."), "success");
      } catch {
        notify(pickText("分享失败。", "Share failed.","共有に失敗しました。", "공유에 실패했습니다."), "error");
      }
      return;
    }

    if (action === "open-audit-event") {
      const auditId = target.dataset.auditId;
      if (!auditId) return;
      try {
        const data = await api(`/api/trust/audit-logs/${encodeURIComponent(auditId)}`);
        const eventDetail = data.event || {};
        const related = Array.isArray(eventDetail.relatedProofItems) ? eventDetail.relatedProofItems : [];
        const relatedProof = related
          .map(
            (item) =>
              `<li>${escapeHtml(item.title || item.type)} <span class="status">${escapeHtml(item.hash || "-")}</span></li>`,
          )
          .join("");
        if (el.proofDrawerTitle) el.proofDrawerTitle.textContent = `${pickText("操作追踪事件", "Operation Event","操作トラッキングイベント", "작업 추적 이벤트")} · ${escapeHtml(eventDetail.id || auditId)}`;
        if (el.proofDrawerBody) {
          el.proofDrawerBody.innerHTML = `
            <article class="card">
              <h3>${escapeHtml(eventDetail.what || "-")}</h3>
              <div class="status">${new Date(eventDetail.at || Date.now()).toLocaleString()} · ${escapeHtml(eventDetail.kind || "-")}</div>
              <div>${pickText("参与者", "Actor","主体", "수행자")}: ${escapeHtml(eventDetail.who || "-")}</div>
              <div>${pickText("关联任务", "Task","関連タスク", "연관 작업")}: <span class="code">${escapeHtml(eventDetail.taskId || "-")}</span></div>
              <div class="status">Hash: <span class="code">${escapeHtml(eventDetail.hash || "-")}</span></div>
            </article>
            <article class="card">
              <h3>${pickText("输入摘要", "Input summary","入力サマリー", "입력 요약")}</h3>
              <pre class="code-block">${escapeHtml(JSON.stringify(eventDetail.toolInput || {}, null, 2))}</pre>
              <h3>${pickText("输出摘要", "Output summary","出力サマリー", "출력 요약")}</h3>
              <pre class="code-block">${escapeHtml(JSON.stringify(eventDetail.toolOutput || {}, null, 2))}</pre>
            </article>
            <article class="card">
              <h3>${pickText("关联凭证", "Related proof items","関連証憑", "연관 증빙")}</h3>
              <ul class="steps">${relatedProof || `<li>${pickText("暂无关联凭证。", "No related proof.","関連証憑はありません。", "연관 증빙이 없습니다.")}</li>`}</ul>
            </article>
          `;
        }
        if (drawerController) drawerController.open(el.proofDrawer, { trigger: target });
      } catch (err) {
        notify(`Failed to open event: ${err.message}`, "error");
      }
      return;
    }

    if (action === "ticket-evidence") {
      const ticketId = target.dataset.ticket;
      if (!ticketId) return;
      const note = window.prompt("Add evidence note for this ticket:");
      if (!note) return;
      try {
        await api(`/api/support/tickets/${ticketId}/evidence`, {
          method: "POST",
          body: JSON.stringify({ type: "user_note", note }),
        });
        addMessage(pickText(`已上传证据到工单 ${ticketId}。`, `Evidence uploaded to ${ticketId}.`, `チケット ${ticketId} に証拠を追加しました。`, `티켓 ${ticketId}에 증빙을 업로드했습니다.`));
        if (state.supportRoom.activeSessionId) {
          await loadSupportRoomSession(state.supportRoom.activeSessionId).catch(() => {});
        }
        await loadAuditLogs();
      } catch (err) {
        addMessage(pickText(`上传证据失败：${err.message}`, `Upload evidence failed: ${err.message}`, `証拠アップロード失敗: ${err.message}`, `증빙 업로드 실패: ${err.message}`));
      }
      return;
    }

    if (action === "run-recommended") {
      const intent = target.dataset.intent;
      if (!intent) {
        addMessage(pickText("未提供推荐路线的执行语句。", "No recommended prompt provided.","推奨ルートの実行文がありません。", "추천 실행 프롬프트가 없습니다."));
        return;
      }
      const prevLabel = target.textContent;
      switchTab("chat");
      try {
        target.textContent = pickText("执行中...", "Running...", "実行中...", "실행 중...");
        target.setAttribute("disabled", "true");
        await runPromptWithExecution(intent, {
          source: "recommended_lane",
          optionId: target.dataset.option || "unknown",
        });
        await trackEvent("recommended_lane_executed", { optionId: target.dataset.option || "unknown" });
        target.textContent = pickText("已启动", "Started","起動済み", "시작됨");
      } catch (err) {
        target.textContent = prevLabel || tUi("run_lane");
        addMessage(pickText(`执行推荐路线失败：${err.message}`, `Failed to execute recommended lane: ${err.message}`, `推奨ルート実行失敗: ${err.message}`, `추천 경로 실행 실패: ${err.message}`));
      } finally {
        setTimeout(() => {
          target.removeAttribute("disabled");
          target.textContent = tUi("run_lane");
        }, 900);
      }
      return;
    }

    if (action === "edit-plan") {
      const taskId = target.dataset.task;
      if (!taskId) return;
      try {
        const current = await api(`/api/tasks/${taskId}`);
        openReplanDrawer(current.task || null);
      } catch (err) {
        addMessage(pickText(`打开计划编辑器失败：${err.message}`, `Open plan editor failed: ${err.message}`, `プラン編集の表示失敗: ${err.message}`, `계획 편집기 열기 실패: ${err.message}`));
      }
      return;
    }

    if (action === "confirm-task") {
      try {
        await withButtonLoading(
          target,
          pickText("执行中...", "Executing...", "実行中...", "실행 중..."),
          async () => confirmAndExecute(target.dataset.task),
        );
      } catch (err) {
        addMessage(pickText(`执行失败：${err.message}`, `Execution failed: ${err.message}`, `実行失敗: ${err.message}`, `실행 실패: ${err.message}`));
      }
      return;
    }

    if (action === "reuse-last-preferences") {
      const payload = {
        language: state.uiLanguage,
        preferences: {
          budget: state.selectedConstraints.budget || "mid",
          dietary: state.selectedConstraints.dietary || "",
          family: String(state.selectedConstraints.family || "false") === "true",
          transport: state.selectedConstraints.distance === "walk" ? "walk_first" : state.selectedConstraints.distance === "ride" ? "taxi_first" : "mixed",
          accessibility: state.selectedConstraints.accessibility || "optional",
        },
      };
      try {
        await api("/api/user/preferences", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        notify(
          pickText("已保存为默认偏好。", "Saved as default preferences.","既定設定として保存しました。", "기본 선호로 저장되었습니다."),
          "success",
        );
        await loadAuditLogs();
      } catch (err) {
        notify(pickText(`保存偏好失败：${err.message}`, `Save preference failed: ${err.message}`, `設定保存失敗: ${err.message}`, `선호 저장 실패: ${err.message}`), "error");
      }
      return;
    }

    if (action === "open-task") {
      try {
        await openTaskDetail(target.dataset.task);
      } catch (err) {
        addMessage(pickText(`任务详情加载失败：${err.message}`, `Failed to load task detail: ${err.message}`, `タスク詳細の読み込み失敗: ${err.message}`, `작업 상세 로드 실패: ${err.message}`));
      }
      return;
    }

    if (action === "open-proof") {
      try {
        const proofPath = `/api/orders/${target.dataset.order}/proof?language=${encodeURIComponent(state.uiLanguage || "EN")}`;
        const data = await api(proofPath);
        const insights = data.insights || {};
        const proofItems = (data.proofItems || [])
          .map(
            (item) =>
              `<li>${escapeHtml(item.title || item.type)} <span class="status">${escapeHtml(item.hash || "-")} · ${new Date(item.generatedAt).toLocaleString()}</span><div class="actions"><button class="secondary" data-action="copy-proof" data-text="${escapeHtml(item.content || item.hash || "")}">${pickText("复制", "Copy","コピー", "복사")}</button><button class="secondary" data-action="share-proof" data-title="${escapeHtml(item.title || item.type)}" data-text="${escapeHtml(item.content || item.hash || "")}">${pickText("分享", "Share","共有", "공유")}</button></div></li>`,
          )
          .join("");
        const comments = (insights.comments || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        const reasons = (insights.reasons || []).map((item) => `<li>${escapeHtml(item)}</li>`).join("");
        const moments = (insights.keyMoments || [])
          .map((m) => `<li>${escapeHtml(m.kind)} · ${new Date(m.at).toLocaleString()} <span class="status">${escapeHtml(m.note || "")}</span></li>`)
          .join("");
        if (el.proofDrawerBody) {
          el.proofDrawerBody.innerHTML = `
            <article class="card">
              <h3>${pickText("凭证快照", "Proof Snapshot","証憑スナップショット", "증빙 스냅샷")}</h3>
              <div>${pickText("订单号", "Order","注文番号", "주문 번호")}: <span class="code">${escapeHtml(data.proof.orderNo)}</span></div>
              <div>${pickText("地址", "Address","住所", "주소")}: ${escapeHtml(data.proof.bilingualAddress)}</div>
              <div class="status">QR: ${escapeHtml(data.proof.qrText)}</div>
              ${insights.imagePath ? `<img class="media-photo" src="${escapeHtml(assetUrl(insights.imagePath))}" alt="proof insight" />` : ""}
              <h3>${pickText("证据抽屉", "Evidence Drawer","証跡ドロワー", "증거 서랍")}</h3>
              <ul class="steps">${proofItems || `<li>${pickText("暂无证据。", "No evidence items.","証跡はありません。", "증거가 없습니다.")}</li>`}</ul>
              <h3>${pickText("相关评论", "Related Comments","関連コメント", "관련 코멘트")}</h3>
              <ul class="steps">${comments || `<li>${pickText("暂无评论。", "No comments.","コメントはありません。", "코멘트가 없습니다.")}</li>`}</ul>
              <h3>${pickText("推荐原因", "Why This Proof Is Recommended","推奨理由", "추천 이유")}</h3>
              <ul class="steps">${reasons || `<li>${pickText("暂无分析。", "No analysis.","分析はありません。", "분석이 없습니다.")}</li>`}</ul>
              <h3>${pickText("关键节点", "Key Moments","重要な時点", "핵심 시점")}</h3>
              <ul class="steps">${moments || `<li>${pickText("暂无关键节点。", "No moments.","重要な時点はありません。", "핵심 시점이 없습니다.")}</li>`}</ul>
            </article>
          `;
        }
        if (el.proofDrawerTitle) {
          el.proofDrawerTitle.dataset.lockedTitle = "true";
          el.proofDrawerTitle.textContent = `${tTerm("proof")} · ${data.proof.orderNo}`;
        }
        if (el.proofDrawer) {
          delete el.proofDrawer.dataset.ticketId;
        }
        if (drawerController) drawerController.open(el.proofDrawer, { trigger: target });
        notify(`${tUi("proof_ready")}: ${data.proof.orderNo}`, "success");
      } catch (err) {
        notify(pickText(`凭证加载失败：${err.message}`, `Failed to load proof: ${err.message}`, `証憑の読み込み失敗: ${err.message}`, `증빙 로드 실패: ${err.message}`), "error");
      }
      return;
    }

    if (action === "request-handoff") {
      try {
        const data = await api(`/api/tasks/${target.dataset.task}/handoff`, {
          method: "POST",
          body: JSON.stringify({ reason: "user_requested_from_task_detail" }),
        });
        if (data && data.task) {
          state.currentTask = data.task;
          renderAgentBrain(state.currentTask);
        }
        await trackEvent("handoff_requested", { ticketId: data.handoff.ticketId }, target.dataset.task);
        setLoopProgress("support");
        state.voice.pendingTaskId = null;
        addMessage(
          pickText(
            `已请求人工接管。工单 ${data.handoff.ticketId}，预计 ${data.handoff.eta}。`,
            `Human handoff requested. Ticket ${data.handoff.ticketId}, ETA ${data.handoff.eta}.`,
            `有人対応を依頼しました。チケット ${data.handoff.ticketId}、ETA ${data.handoff.eta}。`,
            `사람 상담을 요청했습니다. 티켓 ${data.handoff.ticketId}, ETA ${data.handoff.eta}.`,
          ),
        );
        await openSupportRoomByTicket(data.handoff.ticketId, target, { reason: "task_handoff_open_live" }).catch(() => {});
        if (state.currentTaskDetail && state.currentTaskDetail.overview.taskId === target.dataset.task) {
          state.currentTaskDetail.handoff = data.handoff;
          renderDrawerTab();
        }
        await loadAuditLogs();
      } catch (err) {
        addMessage(pickText(`人工接管请求失败：${err.message}`, `Handoff failed: ${err.message}`, `有人対応依頼に失敗: ${err.message}`, `사람 상담 요청 실패: ${err.message}`));
      }
      return;
    }

    if (action === "ticket-progress" || action === "ticket-resolve") {
      const next = action === "ticket-progress" ? "in_progress" : "resolved";
      try {
        await withButtonLoading(
          target,
          next === "in_progress" ? pickText("处理中...", "Processing...", "対応中...", "처리중...") : pickText("提交中...", "Submitting...", "送信中...", "제출중..."),
          async () => {
            await api(`/api/support/tickets/${target.dataset.ticket}/status`, {
              method: "POST",
              body: JSON.stringify({ status: next }),
            });
            await trackEvent("ticket_status_updated", { ticketId: target.dataset.ticket, status: next });
            addMessage(
              pickText(
                `工单 ${target.dataset.ticket} 状态已更新为 ${next}。`,
                `Ticket ${target.dataset.ticket} updated to ${next}.`,
                `チケット ${target.dataset.ticket} を ${next} に更新しました。`,
                `티켓 ${target.dataset.ticket} 상태를 ${next}(으)로 변경했습니다.`,
              ),
            );
            if (state.currentTaskDetail && state.currentTaskDetail.handoff && state.currentTaskDetail.handoff.ticketId === target.dataset.ticket) {
              state.currentTaskDetail.handoff.status = next;
              renderDrawerTab();
            }
            await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
            if (el.proofDrawer && el.proofDrawer.dataset.ticketId === target.dataset.ticket) {
              await renderSupportTicketDrawer(target.dataset.ticket, target);
            }
            if (state.supportRoom.activeSessionId) {
              await loadSupportRoomSession(state.supportRoom.activeSessionId).catch(() => {});
            }
          },
        );
      } catch (err) {
        addMessage(pickText(`工单更新失败：${err.message}`, `Ticket update failed: ${err.message}`, `チケット更新失敗: ${err.message}`, `티켓 업데이트 실패: ${err.message}`));
      }
      return;
    }

    if (action === "share-order") {
      try {
        const data = await api(`/api/orders/${target.dataset.order}/share-card`);
        await trackEvent("order_share_clicked", { orderId: target.dataset.order });
        addMessage(
          pickText(
            `分享卡已生成：${data.shareCard.title} | 支付宝路径：${data.shareCard.miniProgram.alipayPath}`,
            `Share card ready: ${data.shareCard.title} | Alipay path: ${data.shareCard.miniProgram.alipayPath}`,
            `共有カード生成済み: ${data.shareCard.title} | Alipay パス: ${data.shareCard.miniProgram.alipayPath}`,
            `공유 카드 생성 완료: ${data.shareCard.title} | Alipay 경로: ${data.shareCard.miniProgram.alipayPath}`,
          ),
          "agent",
        );
      } catch (err) {
        addMessage(pickText(`分享卡生成失败：${err.message}`, `Share card failed: ${err.message}`, `共有カード生成失敗: ${err.message}`, `공유 카드 생성 실패: ${err.message}`));
      }
      return;
    }

    if (action === "run-settlement") {
      try {
        const data = await api("/api/billing/settlements/run", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await trackEvent("billing_settlement_run", { created: data.created });
        addMessage(
          pickText(
            `结算批次已完成，新增 ${data.created} 条记录。`,
            `Settlement batch done. Created ${data.created} record(s).`,
            `精算バッチ完了。${data.created} 件を作成。`,
            `정산 배치 완료. ${data.created}건 생성.`,
          ),
        );
        await Promise.all([loadDashboard(), loadAuditLogs()]);
      } catch (err) {
        addMessage(pickText(`结算执行失败：${err.message}`, `Settlement run failed: ${err.message}`, `精算実行失敗: ${err.message}`, `정산 실행 실패: ${err.message}`));
      }
      return;
    }

    if (action === "run-reconciliation") {
      try {
        const data = await api("/api/billing/reconciliation/run", {
          method: "POST",
          body: JSON.stringify({}),
        });
        await trackEvent("billing_reconciliation_run", {
          runId: data.run.id,
          mismatched: data.run.summary.mismatched,
        });
        addMessage(
          pickText(
            `对账任务 ${data.run.id}：匹配率 ${(Number(data.run.summary.matchRate || 0) * 100).toFixed(1)}%，不一致 ${Number(data.run.summary.mismatched || 0)} 条。`,
            `Reconciliation run ${data.run.id}: match ${(Number(data.run.summary.matchRate || 0) * 100).toFixed(1)}%, mismatches ${Number(data.run.summary.mismatched || 0)}.`,
            `照合実行 ${data.run.id}: 一致率 ${(Number(data.run.summary.matchRate || 0) * 100).toFixed(1)}%、不一致 ${Number(data.run.summary.mismatched || 0)} 件。`,
            `정산 대조 실행 ${data.run.id}: 일치율 ${(Number(data.run.summary.matchRate || 0) * 100).toFixed(1)}%, 불일치 ${Number(data.run.summary.mismatched || 0)}건.`,
          ),
        );
        await Promise.all([loadDashboard(), loadAuditLogs()]);
      } catch (err) {
        addMessage(pickText(`对账失败：${err.message}`, `Reconciliation failed: ${err.message}`, `照合失敗: ${err.message}`, `정산 대조 실패: ${err.message}`));
      }
      return;
    }

    if (action === "probe-providers") {
      try {
        await withButtonLoading(
          target,
          pickText("探测中...", "Probing...", "診断中...", "점검 중..."),
          async () => {
            await api("/api/system/providers/probe?refresh=1");
            await loadAuditLogs();
          },
        );
        notify(pickText("数据源探测已刷新。", "Provider probe refreshed.","データソース診断を更新しました。", "공급자 점검을 갱신했습니다."), "success");
      } catch (err) {
        notify(pickText(`数据源探测失败：${err.message}`, `Provider probe failed: ${err.message}`, `データソース診断失敗: ${err.message}`, `공급자 점검 실패: ${err.message}`), "error");
      }
      return;
    }

    if (action === "cancel-order") {
      try {
        const reason = window.prompt(
          pickText(
            "请输入退款原因（如：行程变更/下错单/重复支付）",
            "Please enter refund reason (e.g. schedule change / wrong order / duplicate payment)",
            "返金理由を入力してください（例：予定変更 / 誤注文 / 重複支払い）",
            "환불 사유를 입력하세요 (예: 일정 변경 / 오주문 / 중복 결제)",
          ),
          "schedule_change",
        );
        if (reason === null) return;
        await withButtonLoading(
          target,
          pickText("退款处理中...", "Refunding...", "返金処理中...", "환불 처리중..."),
          async () => {
            const data = await api(`/api/orders/${target.dataset.order}/cancel`, {
              method: "POST",
              body: JSON.stringify({ reason: String(reason || "user_request").slice(0, 120) }),
            });
            await trackEvent("order_canceled_by_user", { orderId: target.dataset.order, reason });
            addMessage(
              pickText(
                `订单已取消，退款：${data.order.refund.amount} ${data.order.refund.currency}`,
                `Order canceled. Refund: ${data.order.refund.amount} ${data.order.refund.currency}`,
                `注文をキャンセルしました。返金: ${data.order.refund.amount} ${data.order.refund.currency}`,
                `주문이 취소되었습니다. 환불: ${data.order.refund.amount} ${data.order.refund.currency}`,
              ),
            );
            await Promise.all([loadTrips(), loadOrders(), loadAuditLogs(), loadDashboard()]);
          },
        );
      } catch (err) {
        addMessage(pickText(`取消失败：${err.message}`, `Cancel failed: ${err.message}`, `キャンセル失敗: ${err.message}`, `취소 실패: ${err.message}`));
      }
      return;
    }

    if (action === "pause-plan") {
      try {
        const data = await api(`/api/tasks/${target.dataset.task}/pause`, { method: "POST" });
        if (data && data.task) {
          state.currentTask = data.task;
          renderAgentBrain(state.currentTask);
        }
        await trackEvent("task_paused_by_user", {}, target.dataset.task);
        addMessage(pickText("计划已暂停。", "Plan paused.","プランを一時停止しました。", "계획을 일시중지했습니다."));
        await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
      } catch (err) {
        addMessage(pickText(`暂停失败：${err.message}`, `Pause failed: ${err.message}`, `一時停止に失敗: ${err.message}`, `일시중지 실패: ${err.message}`));
      }
      return;
    }

    if (action === "resume-plan") {
      try {
        const data = await api(`/api/tasks/${target.dataset.task}/resume`, { method: "POST" });
        if (data && data.task) {
          state.currentTask = data.task;
          renderAgentBrain(state.currentTask);
        }
        await trackEvent("task_resumed_by_user", {}, target.dataset.task);
        addMessage(pickText("计划已恢复。", "Plan resumed.","プランを再開しました。", "계획을 재개했습니다."));
        await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
      } catch (err) {
        addMessage(pickText(`恢复失败：${err.message}`, `Resume failed: ${err.message}`, `再開に失敗: ${err.message}`, `재개 실패: ${err.message}`));
      }
      return;
    }

    if (action === "cancel-task") {
      try {
        const data = await api(`/api/tasks/${target.dataset.task}/cancel`, { method: "POST" });
        if (data && data.task) {
          state.currentTask = data.task;
          renderAgentBrain(state.currentTask);
        }
        await trackEvent("task_canceled_by_user", {}, target.dataset.task);
        setLoopProgress("support");
        state.voice.pendingTaskId = null;
        addMessage(pickText("任务已取消。", "Task canceled.","タスクをキャンセルしました。", "작업이 취소되었습니다."));
        await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
      } catch (err) {
        addMessage(pickText(`取消任务失败：${err.message}`, `Cancel task failed: ${err.message}`, `タスクキャンセル失敗: ${err.message}`, `작업 취소 실패: ${err.message}`));
      }
      return;
    }

    if (action === "modify-task") {
      const taskId = target.dataset.task || (state.currentTask && state.currentTask.id) || "";
      if (!taskId) {
        addMessage(pickText("没有可修改的任务。", "No task available to modify.","変更可能なタスクがありません。", "수정 가능한 작업이 없습니다."));
        return;
      }
      try {
        const current = await api(`/api/tasks/${taskId}`);
        openReplanDrawer(current.task || null);
      } catch (err) {
        addMessage(pickText(`打开改写面板失败：${err.message}`, `Open modify panel failed: ${err.message}`, `編集パネルを開けませんでした: ${err.message}`, `수정 패널 열기 실패: ${err.message}`));
      }
      return;
    }

    if (action === "plus-subscribe") {
      try {
        await api("/api/subscription/plus", {
          method: "POST",
          body: JSON.stringify({ active: true, plan: "monthly" }),
        });
        await trackEvent("plus_subscribed");
        addMessage(pickText("Cross X Plus 已开通。", "Cross X Plus activated.", "Cross X Plus を有効化しました。", "Cross X Plus가 활성화되었습니다."));
        await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
      } catch (err) {
        addMessage(pickText(`Plus 开通失败：${err.message}`, `Plus activation failed: ${err.message}`, `Plus 有効化失敗: ${err.message}`, `Plus 활성화 실패: ${err.message}`));
      }
      return;
    }

    if (action === "plus-cancel") {
      try {
        await api("/api/subscription/plus", {
          method: "POST",
          body: JSON.stringify({ active: false, plan: "paused" }),
        });
        await trackEvent("plus_paused");
        addMessage(pickText("Cross X Plus 已暂停。", "Cross X Plus paused.", "Cross X Plus を停止しました。", "Cross X Plus가 일시중지되었습니다."));
        await Promise.all([loadTrips(), loadAuditLogs(), loadDashboard()]);
      } catch (err) {
        addMessage(pickText(`Plus 暂停失败：${err.message}`, `Plus pause failed: ${err.message}`, `Plus 停止失敗: ${err.message}`, `Plus 일시중지 실패: ${err.message}`));
      }
      return;
    }

    if (action === "export-data") {
      try {
        const data = await api("/api/user/export");
        await trackEvent("data_exported");
        el.privacyResult.textContent = pickText(
          `导出已就绪：${new Date(data.exportedAt).toLocaleString()}（${data.tasks.length} 个任务，${data.orders.length} 个订单）`,
          `Export ready: ${new Date(data.exportedAt).toLocaleString()} (${data.tasks.length} tasks, ${data.orders.length} orders)`,
          `エクスポート準備完了: ${new Date(data.exportedAt).toLocaleString()} (${data.tasks.length} tasks, ${data.orders.length} orders)`,
          `내보내기 준비 완료: ${new Date(data.exportedAt).toLocaleString()} (${data.tasks.length} tasks, ${data.orders.length} orders)`,
        );
      } catch (err) {
        el.privacyResult.textContent = pickText(`导出失败：${err.message}`, `Export failed: ${err.message}`, `エクスポート失敗: ${err.message}`, `내보내기 실패: ${err.message}`);
      }
      return;
    }

    if (action === "delete-data") {
      const ok = window.confirm(
        pickText(
          "确认删除本地任务/订单/审计数据？",
          "Delete all local task/order/audit data?",
          "ローカルのタスク/注文/監査データを削除しますか？",
          "로컬 작업/주문/감사 데이터를 모두 삭제할까요?",
        ),
      );
      if (!ok) return;
      try {
        await api("/api/user/delete-data", { method: "POST", body: JSON.stringify({ reason: "user_request" }) });
        await trackEvent("data_deleted");
        el.privacyResult.textContent = pickText("本地数据已删除。", "Local data deleted.","ローカルデータを削除しました。", "로컬 데이터를 삭제했습니다.");
        addMessage(pickText("你的本地数据已删除。", "Your local data has been deleted.","ローカルデータを削除しました。", "로컬 데이터가 삭제되었습니다."));
        await Promise.all([loadTrips(), loadOrders(), loadAuditLogs(), loadDashboard()]);
      } catch (err) {
        el.privacyResult.textContent = pickText(`删除失败：${err.message}`, `Delete failed: ${err.message}`, `削除失敗: ${err.message}`, `삭제 실패: ${err.message}`);
      }
    }
  });
}

function bindInput() {
  el.chatForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = el.chatInput.value.trim();
    if (!text) return;
    el.chatInput.value = "";
    autoResizeChatInput();
    updateChatSendState();
    try {
      // AI-native flow: always use plan stream (createTaskFromText)
      await createTaskFromText(text);
    } catch (err) {
      addMessage(pickText(`创建任务失败：${err.message}`, `Failed to create task: ${err.message}`, `タスク作成失敗: ${err.message}`, `작업 생성 실패: ${err.message}`));
    }
  });

  if (el.chatInput) {
    el.chatInput.addEventListener("input", () => {
      autoResizeChatInput();
      updateChatSendState();
    });
    if (el.chatInput instanceof HTMLTextAreaElement) {
      el.chatInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        if (typeof el.chatForm.requestSubmit === "function") el.chatForm.requestSubmit();
        else el.chatForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      });
    }
  }

  if (el.myOrdersBtn) {
    el.myOrdersBtn.addEventListener("click", async () => {
      try {
        await withButtonLoading(
          el.myOrdersBtn,
          pickText("加载中...", "Loading...", "読み込み中...", "로딩 중..."),
          async () => openMyOrdersQuickView(el.myOrdersBtn),
        );
      } catch (err) {
        notify(
          pickText(
            `订单加载失败：${err.message}`,
            `Failed to load orders: ${err.message}`,
            `注文の読み込み失敗: ${err.message}`,
            `주문 로드 실패: ${err.message}`,
          ),
          "error",
        );
      }
    });
  }

  if (el.toggleConstraintsBtn) {
    el.toggleConstraintsBtn.addEventListener("click", () => {
      toggleConstraintPanel();
    });
  }

  if (el.openConditionEditorBtn) {
    el.openConditionEditorBtn.addEventListener("click", () => {
      openConditionEditorDrawer(el.openConditionEditorBtn);
    });
  }

  if (el.voiceInputBtn) {
    el.voiceInputBtn.addEventListener("click", () => {
      toggleVoiceListening().catch((err) => {
        notify(
          pickText(
            `语音模式启动失败：${err.message}`,
            `Failed to start voice mode: ${err.message}`,
            `音声モード起動失敗: ${err.message}`,
            `음성 모드 시작 실패: ${err.message}`,
          ),
          "error",
        );
      });
    });
  }

  // ── Payment Modal ──────────────────────────────────────────────────────
  function showPaymentModal(option) {
    if (!el.paymentModal) return;
    const title = (option && option.title) || (option && option.name) || "服务方案";
    const priceRaw = (option && (option.costRange || option.price || option.cost || option.estimatedCost)) || "";
    const priceLabel = priceRaw ? String(priceRaw) :"价格面议";
    if (el.payItemName) el.payItemName.textContent = title;
    if (el.payItemPrice) el.payItemPrice.textContent = priceLabel;
    if (el.payTotal) el.payTotal.textContent = priceLabel;
    if (el.payModalTitle) el.payModalTitle.textContent = pickText("确认订单", "Confirm Order","注文を確認", "주문 확인");
    if (el.payModalSubtitle) el.payModalSubtitle.textContent = pickText("请选择支付方式完成预订", "Choose payment to complete booking","お支払い方法を選択してください", "결제 방법을 선택하세요");
    if (el.payQrSection) el.payQrSection.classList.add("hidden");
    el.paymentModal.classList.remove("hidden");
    document.body.style.overflow = "hidden";
  }

  function hidePaymentModal() {
    if (!el.paymentModal) return;
    el.paymentModal.classList.add("hidden");
    document.body.style.overflow = "";
    if (el.payQrSection) el.payQrSection.classList.add("hidden");
    if (el.paymentModal) el.paymentModal.dataset.provider = "";
  }

  function showPaymentQR(provider) {
    if (!el.payQrSection) return;
    const priceText = (el.payQrAmount && el.payTotal && el.payTotal.textContent) ? el.payTotal.textContent : "";
    const isWeChat = provider === "wechat";
    const qrData = encodeURIComponent(isWeChat ? "weixin://wxpay/crossx_order_" + Date.now() : "alipays://platformapi/startapp?appId=20000067&url=" + encodeURIComponent("https://crossx.ai/pay?ref=" + Date.now()));
    const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&color=000000&bgcolor=ffffff&data=${qrData}&format=svg`;
    if (el.payQrImg) { el.payQrImg.src = qrUrl; el.payQrImg.alt = isWeChat ? "WeChat Pay QR" : "Alipay QR"; }
    if (el.payQrLabel) el.payQrLabel.textContent = isWeChat ? "微信扫码支付" :"支付宝扫码支付";
    if (el.payQrHint) el.payQrHint.textContent = isWeChat ? "请打开微信 → 扫一扫" :"请打开支付宝 → 扫一扫";
    if (el.payQrAmount) el.payQrAmount.textContent = priceText || el.payTotal?.textContent || "";
    el.payQrSection.classList.remove("hidden");
  }

  if (el.payModalClose) el.payModalClose.addEventListener("click", hidePaymentModal);
  if (el.paymentModal) el.paymentModal.addEventListener("click", (e) => { if (e.target === el.paymentModal) hidePaymentModal(); });
  if (el.payWechat) el.payWechat.addEventListener("click", () => showPaymentQR("wechat"));
  if (el.payAlipay) el.payAlipay.addEventListener("click", () => showPaymentQR("alipay"));
  if (el.payDoneBtn) {
    el.payDoneBtn.addEventListener("click", () => {
      hidePaymentModal();
      notify(pickText("支付已提交，凭证生成中…", "Payment submitted, generating proof…", "お支払い完了、証憑を生成中…", "결제 완료, 영수증 생성 중…"), "success");
    });
  }

  // Expose globally so option card buttons can call it
  window.crossxShowPayment = showPaymentModal;

  if (el.translateBtn) {
    el.translateBtn.addEventListener("click", async () => {
      const text = (el.chatInput && el.chatInput.value.trim()) || "";
      if (!text) {
        notify(pickText("请先输入内容再翻译", "Enter text first","翻訳するテキストを入力してください", "번역할 텍스트를 먼저 입력하세요"), "warning");
        return;
      }
      // Always translate to ZH so Coze/AI receives Chinese queries regardless of input language
      const toLang = "ZH";
      el.translateBtn.classList.add("is-loading");
      try {
        const result = await api("/api/chat/translate", {
          method: "POST",
          body: JSON.stringify({ text, toLang }),
        });
        if (result && result.ok && result.translated) {
          if (el.chatInput) {
            el.chatInput.value = result.translated;
            autoResizeChatInput();
            updateChatSendState();
          }
          el.translateBtn.classList.add("is-done");
          setTimeout(() => el.translateBtn.classList.remove("is-done"), 1800);
          notify(pickText("已翻译为中文", "Translated to Chinese","中国語に翻訳しました", "중국어로 번역됨"), "success");
        } else {
          notify(pickText("翻译失败，请重试", "Translation failed","翻訳に失敗しました", "번역 실패"), "error");
        }
      } catch {
        notify(pickText("翻译请求失败", "Translation request failed","翻訳リクエスト失敗", "번역 요청 실패"), "error");
      } finally {
        el.translateBtn.classList.remove("is-loading");
      }
    });
  }

  if (el.voiceReplyBtn) {
    el.voiceReplyBtn.addEventListener("click", () => {
      if (!isSpeechSynthesisSupported() && !isAudioPlaybackSupported()) {
        notify(
          pickText("当前浏览器不支持语音播报。", "Voice reply is not supported in this browser.","このブラウザは音声応答に対応していません。", "현재 브라우저는 음성 응답을 지원하지 않습니다."),
          "warning",
        );
        return;
      }
      state.voice.replyEnabled = !state.voice.replyEnabled;
      renderVoiceControls();
      if (!state.voice.replyEnabled) {
        stopCurrentVoicePlayback();
        if (isSpeechSynthesisSupported()) {
          window.speechSynthesis.cancel();
        }
      }
      notify(
        state.voice.replyEnabled
          ? pickText("已开启语音播报。", "Voice reply enabled.","音声応答を有効化しました。", "음성 응답을 켰습니다.")
          : pickText("已关闭语音播报。", "Voice reply disabled.","音声応答を無効化しました。", "음성 응답을 껐습니다."),
        "success",
      );
    });
  }

  if (el.workspaceModeBtn) {
    el.workspaceModeBtn.addEventListener("click", () => {
      if (state.viewMode !== "admin") {
        state.singleDialogMode = true;
        applySingleDialogMode();
        notify(
          pickText(
            "当前为用户模式，已锁定为单对话体验。",
            "User mode is locked to single-dialog experience.",
            "ユーザーモードではシングル会話に固定されています。",
            "사용자 모드에서는 단일 대화로 고정됩니다.",
          ),
          "info",
        );
        return;
      }
      state.singleDialogMode = !state.singleDialogMode;
      applySingleDialogMode();
      if (state.singleDialogMode) {
        notify(
          pickText(
            "已切换为单对话模式，聚焦一句话闭环。",
            "Switched to single-dialog mode for one-goal closed-loop execution.",
            "シングル会話モードに切替しました。",
            "단일 대화 모드로 전환했습니다.",
          ),
          "success",
        );
      } else {
        notify(
          pickText(
            "已切换为工作台模式，可查看附近/订单/信任页。",
            "Workspace mode enabled. You can view Near Me, Trips, and Trust.",
            "ワークスペースモードに切替しました。",
            "워크스페이스 모드로 전환했습니다.",
          ),
          "info",
        );
      }
    });
  }

  if (el.supportRoomForm && el.supportRoomInput) {
    el.supportRoomForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = String(el.supportRoomInput.value || "").trim();
      if (!text) return;
      try {
        if (el.supportRoomSendBtn) el.supportRoomSendBtn.disabled = true;
        await sendSupportRoomTextMessage(text);
        el.supportRoomInput.value = "";
      } catch (err) {
        notify(
          pickText(`发送失败：${err.message}`, `Send failed: ${err.message}`, `送信失敗: ${err.message}`, `전송 실패: ${err.message}`),
          "error",
        );
      } finally {
        if (el.supportRoomSendBtn) el.supportRoomSendBtn.disabled = false;
      }
    });
    if (el.supportRoomInput instanceof HTMLTextAreaElement) {
      el.supportRoomInput.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
        event.preventDefault();
        if (typeof el.supportRoomForm.requestSubmit === "function") el.supportRoomForm.requestSubmit();
        else el.supportRoomForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
      });
    }
  }

  for (const chip of el.chips) {
    chip.addEventListener("click", () => {
      const key = chip.dataset.k;
      const value = chip.dataset.v;
      if (!key) return;
      const alreadySelected = String(state.selectedConstraints[key] || "") === String(value || "");
      if (alreadySelected) {
        delete state.selectedConstraints[key];
      } else {
        state.selectedConstraints[key] = value;
        markAgentEvidenceFromConstraint(key, value, true);
      }
      syncChipSelectionFromConstraints();
      updateContextSummary();
      syncAgentSlotsFromSelectedConstraints();
      renderAgentInputDeck();
      if (isLocalAgentChatEnabled() && ["asking", "planning", "confirming", "failed"].includes(state.agentConversation.mode)) {
        evaluateAgentConversation({ silent: true });
        if (["planning", "confirming"].includes(state.agentConversation.mode)) {
          refineAgentPlanWithSmartReply("", { announce: false }).catch(() => {});
        }
      }
    });
  }

  if (el.nearFilterForm) {
    el.nearFilterForm.addEventListener("change", async () => {
      try {
        await loadNearSuggestions();
      } catch {
        // ignore
      }
    });
  }

  if (el.langSwitch) {
    el.langSwitch.addEventListener("change", () => {
      const next = i18n.normalizeLanguage(el.langSwitch.value || "ZH");

      // ── Step 1: Update language state + redraw all static labels immediately.
      // This is always safe — it only touches DOM text nodes, never sends requests.
      state.uiLanguage = next;
      applyLanguagePack();

      // ── Step 2: Re-translate any rendered plan cards in the new language.
      // This is safe regardless of busy state — it only re-renders DOM nodes
      // that are already fully loaded. Never sends a network request.
      refreshPlanCardLanguage();

      // ── Step 3: If AI is currently thinking/streaming, stop here.
      // The ongoing SSE / slot-fill / chat-reply must not be disrupted.
      if (isAiBusy()) return;

      // ── Step 4: Persist preference to backend (fire-and-forget, never awaited).
      api("/api/user/preferences", {
        method: "POST",
        body: JSON.stringify({ language: next }),
      }).catch(() => {});

      // ── Step 5: Refresh secondary data panels (all fire-and-forget).
      // loadChatSolutionStrip / loadSolutionBoard intentionally NOT called here —
      // they serve as legacy fallback panels and never contain plan cards.
      // Calling them here would risk replacing their content with empty data.
      loadNearSuggestions().catch(() => {});
      loadTrips().catch(() => {});
      loadOrders().catch(() => {});
      loadAuditLogs().catch(() => {});

      // ── Step 5: Refresh open task drawer label (if any).
      if (state.currentTaskDetail?.overview?.taskId) {
        if (el.drawerTitle) {
          el.drawerTitle.textContent = `${tTerm("task")} · ${state.currentTaskDetail.overview.taskId}`;
        }
        api(buildRecommendationPath(state.currentTaskDetail.overview.taskId))
          .then((data) => {
            state.currentTaskRecommendation = data.recommendation || null;
            renderDrawerTab();
          })
          .catch(() => {});
      }

      // ── Step 6: Brief success toast.
      notify(
        { ZH:"语言已切换。", JA:"言語を切り替えました。", KO: "언어를 변경했습니다.", MY: "Bahasa ditukar." }[next]
          || "Language switched.",
        "success",
      );

      // NOTE: refineAgentPlanWithSmartReply and /api/chat/reply are intentionally
      // NOT called here. Triggering a new LLM request on language switch would race
      // with existing conversations and corrupt the reply stream.
    });
  }
}

function bindForms() {
  if (el.tripForm) {
    el.tripForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.tripForm);
      const title = String(form.get("title") || "").trim();
      const city = String(form.get("city") || getCurrentCity()).trim();
      const note = String(form.get("note") || "").trim();
      if (!title) {
        notify(
          pickText("请先输入行程名称。", "Please enter a trip title first.","旅程名を入力してください。", "트립 제목을 입력하세요."),
          "warning",
        );
        return;
      }
      try {
        await withButtonLoading(el.createTripBtn || null, pickText("创建中...", "Creating...", "作成中...", "생성 중..."), async () => {
          const data = await api("/api/trips", {
            method: "POST",
            body: JSON.stringify({ title, city, note }),
          });
          state.activeTripId = data && data.trip && data.trip.id ? data.trip.id : state.activeTripId;
          if (el.tripForm) el.tripForm.reset();
          if (el.tripCityInput) el.tripCityInput.value = getCurrentCity();
          await Promise.all([loadTrips(), loadAuditLogs()]);
        });
        notify(
          pickText("行程已创建并激活。", "Trip created and activated.","旅程を作成して有効化しました。", "트립을 생성하고 활성화했습니다."),
          "success",
        );
      } catch (err) {
        notify(
          pickText(`创建行程失败：${err.message}`, `Create trip failed: ${err.message}`, `旅程作成に失敗: ${err.message}`, `트립 생성 실패: ${err.message}`),
          "error",
        );
      }
    });
  }

  if (el.replanForm) {
    el.replanForm.addEventListener("input", () => {
      clearReplanPreview();
    });

    if (el.replanTemplateId) {
      el.replanTemplateId.addEventListener("change", () => {
        const templateId = String(el.replanTemplateId.value || "");
        if (!templateId) {
          if (el.replanHint) el.replanHint.textContent = pickText("自定义模式。", "Custom mode.","カスタムモード。", "사용자 정의 모드.");
          clearReplanPreview();
          return;
        }
        applyReplanTemplate(templateId);
      });
    }

    el.replanForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const payload = readReplanPayload();
      if (!payload) {
        if (el.replanHint) el.replanHint.textContent = pickText("缺少任务ID或意图。", "Task ID or intent is missing.","タスクIDまたは意図が不足しています。", "작업 ID 또는 의도가 누락되었습니다.");
        return;
      }

      try {
        if (el.replanHint) el.replanHint.textContent = pickText("保存计划中...", "Saving replan...", "プラン保存中...", "계획 저장 중...");
        const updated = await api(`/api/tasks/${payload.taskId}/replan`, {
          method: "POST",
          body: JSON.stringify({
            intent: payload.intent,
            constraints: payload.constraints,
          }),
        });
        state.currentTask = updated.task;
        renderAgentBrain(state.currentTask);
        await trackEvent("task_replanned_from_ui", { taskId: payload.taskId });
        removeTaskCards(payload.taskId);
        renderPlanCard(updated.task);
        renderConfirmCard(updated.task);
        closeReplanDrawer();
        addMessage(
          pickText(
            `任务 ${payload.taskId} 计划已更新，请确认后执行。`,
            `Plan updated for ${payload.taskId}. Review confirm card and execute when ready.`,
            `タスク ${payload.taskId} のプランを更新しました。確認後に実行してください。`,
            `작업 ${payload.taskId} 계획이 업데이트되었습니다. 확인 후 실행하세요.`,
          ),
        );
        await Promise.all([
          loadDashboard(),
          loadAuditLogs(),
          loadSolutionBoard(payload.taskId),
          loadChatSolutionStrip(payload.taskId),
        ]);
        if (state.currentTaskDetail && state.currentTaskDetail.overview && state.currentTaskDetail.overview.taskId === payload.taskId) {
          await openTaskDetail(payload.taskId);
        }
      } catch (err) {
        if (el.replanHint) el.replanHint.textContent = pickText(`保存失败：${err.message}`, `Save failed: ${err.message}`, `保存失敗: ${err.message}`, `저장 실패: ${err.message}`);
        addMessage(pickText(`保存改写失败：${err.message}`, `Save replan failed: ${err.message}`, `再計画保存に失敗: ${err.message}`, `재계획 저장 실패: ${err.message}`));
      }
    });
  }

  if (el.conditionEditorForm) {
    el.conditionEditorForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.conditionEditorForm);
      const slots = state.agentConversation.slots || {};
      const intent = String(form.get("intent") || "").trim();
      const city = String(form.get("city") || "").trim();
      const area = String(form.get("area") || "").trim();
      const party = String(form.get("party_size") || "").trim();
      const budget = String(form.get("budget") || "").trim();
      const timeConstraint = String(form.get("time_constraint") || "").trim();
      const prefText = String(form.get("preferences") || "").trim();
      const executionPermission = String(form.get("execution_permission") || "false") === "true";

      if (intent) {
        slots.intent = intent;
        markAgentSlotEvidence("intent", true);
      }
      slots.city = city || slots.city;
      slots.area = area || null;
      slots.party_size = party || slots.party_size;
      slots.budget = budget || slots.budget;
      slots.time_constraint = timeConstraint || slots.time_constraint;
      slots.execution_permission = executionPermission;
      const prefs = prefText
        .split(",")
        .map((item) => String(item || "").trim().toLowerCase())
        .filter(Boolean);
      if (prefs.length) {
        slots.preferences = mergePreferences(slots.preferences, prefs);
        markAgentPreferenceEvidence();
      }
      if (city) markAgentSlotEvidence("city", true);
      if (area) markAgentSlotEvidence("area", true);
      if (party) markAgentSlotEvidence("party_size", true);
      if (budget) markAgentSlotEvidence("budget", true);
      if (timeConstraint) markAgentSlotEvidence("time_constraint", true);
      markAgentSlotEvidence("execution_permission", true);

      state.agentConversation.slots = slots;
      closeConditionEditorDrawer();
      evaluateAgentConversation({ silent: false });
      if (["planning", "confirming"].includes(state.agentConversation.mode)) {
        await refineAgentPlanWithSmartReply(state.agentConversation.lastUserInput || "", {
          announce: false,
        });
      }
    });
  }

  el.authForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(el.authForm);
    try {
      await api("/api/payments/authorize", {
        method: "POST",
        body: JSON.stringify({
          noPinEnabled: form.get("noPinEnabled") === "true",
          dailyLimit: Number(form.get("dailyLimit")),
          singleLimit: Number(form.get("singleLimit")),
        }),
      });
      addMessage(pickText("授权域已更新。", "Authorization domain updated.","委任設定を更新しました。", "권한 위임 영역을 업데이트했습니다."));
      await loadAuditLogs();
    } catch (err) {
      addMessage(pickText(`授权域更新失败：${err.message}`, `Failed to update authorization: ${err.message}`, `委任設定更新に失敗: ${err.message}`, `권한 위임 업데이트 실패: ${err.message}`));
    }
  });

  if (el.railForm) {
    el.railForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.railForm);
      try {
        const data = await api("/api/payments/rails/select", {
          method: "POST",
          body: JSON.stringify({ railId: form.get("railId") }),
        });
        await trackEvent("payment_rail_updated", { railId: data.selected });
        addMessage(
          pickText(
            `支付通道已更新：${data.selected}`,
            `Payment rail updated: ${data.selected}`,
            `決済レールを更新しました: ${data.selected}`,
            `결제 레일 업데이트: ${data.selected}`,
          ),
        );
        await loadAuditLogs();
      } catch (err) {
        addMessage(pickText(`支付通道更新失败：${err.message}`, `Failed to update payment rail: ${err.message}`, `決済レール更新失敗: ${err.message}`, `결제 레일 업데이트 실패: ${err.message}`));
      }
    });
  }

  if (el.complianceForm) {
    el.complianceForm.railId.addEventListener("change", async () => {
      try {
        const data = await api("/api/payments/compliance");
        const rid = el.complianceForm.railId.value || "alipay_cn";
        const item = (data.compliance && data.compliance.rails && data.compliance.rails[rid]) || {};
        el.complianceForm.certified.value = String(item.certified !== false);
        el.complianceForm.kycPassed.value = String(item.kycPassed !== false);
        el.complianceForm.pciDss.value = String(item.pciDss !== false);
        el.complianceForm.enabled.value = String(item.enabled !== false);
        el.complianceForm.riskTier.value = item.riskTier || "medium";
      } catch {
        // ignore
      }
    });

    el.complianceForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.complianceForm);
      try {
        const data = await api("/api/payments/compliance/certify", {
          method: "POST",
          body: JSON.stringify({
            railId: form.get("railId"),
            certified: form.get("certified") === "true",
            kycPassed: form.get("kycPassed") === "true",
            pciDss: form.get("pciDss") === "true",
            enabled: form.get("enabled") === "true",
            riskTier: form.get("riskTier"),
          }),
        });
        await trackEvent("payment_compliance_updated", { railId: data.railId });
        addMessage(
          pickText(
            `合规策略已更新：${data.railId}`,
            `Compliance updated: ${data.railId}`,
            `コンプライアンス更新: ${data.railId}`,
            `컴플라이언스 업데이트: ${data.railId}`,
          ),
        );
        await loadAuditLogs();
      } catch (err) {
        addMessage(pickText(`合规更新失败：${err.message}`, `Failed to update compliance: ${err.message}`, `コンプライアンス更新失敗: ${err.message}`, `컴플라이언스 업데이트 실패: ${err.message}`));
      }
    });
  }

  if (el.compliancePolicyForm) {
    el.compliancePolicyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.compliancePolicyForm);
      try {
        await api("/api/payments/compliance", {
          method: "POST",
          body: JSON.stringify({
            policy: {
              blockUncertifiedRails: form.get("blockUncertifiedRails") === "true",
              requireFraudScreen: form.get("requireFraudScreen") === "true",
            },
          }),
        });
        await trackEvent("payment_policy_updated");
        addMessage(pickText("支付合规策略已更新。", "Payment compliance policy updated.","決済コンプライアンスポリシーを更新しました。", "결제 컴플라이언스 정책을 업데이트했습니다."));
        await loadAuditLogs();
      } catch (err) {
        addMessage(pickText(`支付策略更新失败：${err.message}`, `Failed to update payment policy: ${err.message}`, `決済ポリシー更新失敗: ${err.message}`, `결제 정책 업데이트 실패: ${err.message}`));
      }
    });
  }

  el.prefForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(el.prefForm);
    try {
      await api("/api/user/preferences", {
        method: "POST",
        body: JSON.stringify({
          language: form.get("language"),
          preferences: {
            budget: form.get("budget"),
            dietary: form.get("dietary"),
            family: form.get("family") === "true",
            transport: form.get("transport"),
            accessibility: form.get("accessibility"),
          },
          savedPlaces: {
            hotel: form.get("hotel"),
            office: form.get("office"),
            airport: form.get("airport"),
          },
        }),
      });
      addMessage(pickText("偏好设置已保存。", "Preferences saved.","設定を保存しました。", "환경설정을 저장했습니다."));
      await loadAuditLogs();
    } catch (err) {
      addMessage(pickText(`偏好保存失败：${err.message}`, `Failed to save preferences: ${err.message}`, `設定保存に失敗: ${err.message}`, `환경설정 저장 실패: ${err.message}`));
    }
  });

  if (el.llmRuntimeForm) {
    el.llmRuntimeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.llmRuntimeForm);
      const apiKey = String(form.get("apiKey") || "").trim();
      const model = String(form.get("model") || "").trim();
      if (!apiKey) {
        notify(
          pickText("请先粘贴 OpenAI API Key。", "Paste OpenAI API key first.","先に OpenAI API キーを入力してください。", "먼저 OpenAI API 키를 입력하세요."),
          "warning",
        );
        return;
      }
      try {
        await api("/api/system/llm/runtime", {
          method: "POST",
          body: JSON.stringify({ apiKey, model, persist: true }),
        });
        const probe = await api("/api/chat/reply", {
          method: "POST",
          body: JSON.stringify({
            message: "Find halal dinner in Shanghai for 2 under 200",
            language: "EN",
            city: getCurrentCity(),
            constraints: { budget: "mid", dietary: "halal" },
          }),
        });
        const llm = await api("/api/system/llm-status");
        renderLlmRuntimeStatus(llm);
        const ok = probe && probe.source === "openai";
        if (!ok && probe && probe.fallbackReason) {
          el.llmLastErrorText.textContent = `${pickText("最近诊断", "Last diagnose","最近の診断", "최근 진단")}: ${localizeLlmIssue(probe.fallbackReason)}`;
        }
        notify(
          ok
            ? pickText("OpenAI 连接成功，已启用 ChatGPT。", "OpenAI connected. ChatGPT enabled.", "OpenAI 接続成功。ChatGPT を有効化しました。", "OpenAI 연결 성공. ChatGPT 활성화됨.")
            : pickText("Key 已保存，但探测未通过，请看下方诊断。", "Key saved but probe failed. Check diagnostics below.","キーは保存されましたが、プローブ失敗。下の診断を確認してください。", "키는 저장됐지만 프로브 실패. 아래 진단을 확인하세요."),
          ok ? "success" : "warning",
        );
      } catch (err) {
        notify(
          pickText(`连接失败：${err.message}`, `Connect failed: ${err.message}`, `接続失敗: ${err.message}`, `연결 실패: ${err.message}`),
          "error",
        );
      } finally {
        if (el.llmApiKeyInput) el.llmApiKeyInput.value = "";
      }
    });
  }

  if (el.viewModeForm) {
    el.viewModeForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.viewModeForm);
      const mode = String(form.get("viewMode") || "user");
      if (IS_USER_PORTAL && mode === "admin") {
        state.viewMode = "user";
        state.singleDialogMode = true;
        updateViewModeUI();
        addMessage(
          pickText(
            "用户端仅保留对话模式，后台请使用 /admin.html。",
            "User app is locked to dialog mode. Use /admin.html for operations.",
            "ユーザー画面は会話モード固定です。運用は /admin.html を使用してください。",
            "사용자 앱은 대화 모드로 고정됩니다. 운영은 /admin.html 을 사용하세요.",
          ),
        );
        return;
      }
      try {
        await api("/api/user/view-mode", {
          method: "POST",
          body: JSON.stringify({ mode }),
        });
        state.viewMode = mode === "admin" ? "admin" : "user";
        updateViewModeUI();
        addMessage(
          pickText(
            `已切换到 ${state.viewMode} 模式。`,
            `Mode switched to ${state.viewMode}.`,
            `${state.viewMode} モードへ切替しました。`,
            `${state.viewMode} 모드로 전환했습니다.`,
          ),
        );
        await loadAuditLogs();
      } catch (err) {
        addMessage(pickText(`模式切换失败：${err.message}`, `Switch mode failed: ${err.message}`, `モード切替失敗: ${err.message}`, `모드 전환 실패: ${err.message}`));
      }
    });
  }

  el.privacyForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(el.privacyForm);
    try {
      const data = await api("/api/user/privacy", {
        method: "POST",
        body: JSON.stringify({ locationEnabled: form.get("locationEnabled") === "true" }),
      });
      await trackEvent("privacy_updated", { locationEnabled: data.privacy.locationEnabled });
      el.privacyResult.textContent = pickText(
        `隐私设置已更新：定位${data.privacy.locationEnabled ? "开启" :"关闭"}`,
        `Privacy updated: location ${data.privacy.locationEnabled ? "enabled" : "disabled"}`,
        `プライバシー設定を更新: 位置情報 ${data.privacy.locationEnabled ? "有効" :"無効"}`,
        `개인정보 설정 업데이트: 위치 ${data.privacy.locationEnabled ? "사용" : "사용 안 함"}`,
      );
      await loadAuditLogs();
    } catch (err) {
      el.privacyResult.textContent = pickText(`隐私设置更新失败：${err.message}`, `Privacy update failed: ${err.message}`, `プライバシー更新失敗: ${err.message}`, `개인정보 설정 업데이트 실패: ${err.message}`);
    }
  });

  if (el.flagsForm) {
    el.flagsForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.flagsForm);
      try {
        await api("/api/system/flags", {
          method: "POST",
          body: JSON.stringify({
            plusConcierge: { enabled: true, rollout: Number(form.get("plusConciergeRollout") || 0) },
            liveTranslation: { enabled: true, rollout: Number(form.get("liveTranslationRollout") || 0) },
            manualFallback: { enabled: true, rollout: Number(form.get("manualFallbackRollout") || 0) },
          }),
        });
        await trackEvent("flags_rollout_updated");
        addMessage(pickText("灰度发布已更新。", "Gray rollout updated.","ロールアウト設定を更新しました。", "롤아웃 설정을 업데이트했습니다."));
        await loadDashboard();
      } catch (err) {
        addMessage(pickText(`灰度更新失败：${err.message}`, `Failed to update rollout: ${err.message}`, `ロールアウト更新失敗: ${err.message}`, `롤아웃 업데이트 실패: ${err.message}`));
      }
    });
  }

  if (el.mcpPolicyForm) {
    el.mcpPolicyForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(el.mcpPolicyForm);
      try {
        await api("/api/system/mcp-policy", {
          method: "POST",
          body: JSON.stringify({
            enforceSla: form.get("enforceSla") === "true",
            simulateBreachRate: Number(form.get("simulateBreachRate") || 0),
          }),
        });
        await trackEvent("mcp_policy_updated", {
          enforceSla: form.get("enforceSla") === "true",
          simulateBreachRate: Number(form.get("simulateBreachRate") || 0),
        });
        addMessage(pickText("MCP 策略已更新。", "MCP policy updated.", "MCP ポリシーを更新しました。", "MCP 정책을 업데이트했습니다."));
        await loadDashboard();
      } catch (err) {
        addMessage(pickText(`MCP 策略更新失败：${err.message}`, `Failed to update MCP policy: ${err.message}`, `MCP ポリシー更新失敗: ${err.message}`, `MCP 정책 업데이트 실패: ${err.message}`));
      }
    });
  }
}

function exposeAgentDebugInterface() {
  if (typeof window === "undefined") return;
  window.CrossXAgentSpec = {
    intents: [...AGENT_INTENTS],
    slots: [...AGENT_SLOT_KEYS],
    states: [...AGENT_STATES],
    plannerSchema: plannerOutputSchema(),
  };
  window.CrossXAgentDebug = {
    getState: () => JSON.parse(JSON.stringify(state.agentConversation || {})),
    getTelemetry: () => JSON.parse(JSON.stringify(state.agentConversation.telemetry || [])),
    runDemoPath: async (path) => runAgentDemoPath(path),
    reset: () => resetAgentConversationForDemo(),
  };
}

async function init() {
  // Restore conversation history and slots from previous session (up to 4h)
  restoreConversationState();

  if (IS_USER_PORTAL) {
    document.body.classList.add("consumer-app");
    state.viewMode = "user";
    state.singleDialogMode = true;
  }
  addMessage(getSystemMessageByKey("welcome_intro"), "agent", { i18nKey: "welcome_intro" });
  // Silently detect location in background to personalize the welcome message
  setTimeout(() => silentAutoDetectLocation().catch(() => {}), 600);
  // P6: prefetch live FX rates from API gateway
  setTimeout(() => fetchGatewayFx().catch(() => {}), 1200);

  // Force-remove stale service workers that can pin old JS/CSS.
  if ("serviceWorker" in navigator) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    } catch {
      // ignore
    }
  }

  bindActions();
  bindInput();
  bindForms();
  exposeAgentDebugInterface();
  setThinkingIndicator(false);
  setLoopProgress("intent");
  updateContextSummary();
  syncChipSelectionFromConstraints();
  updateViewModeUI();
  applyLanguagePack();
  renderQuickGoals();
  initVoiceAssistant();
  startSupportEtaTicker();
  startChatNotificationTicker();
  updateChatSendState();

  if (el.emergencyBtn) {
    el.emergencyBtn.addEventListener("click", async () => {
      try {
        const data = await api("/api/emergency/support", {
          method: "POST",
          body: JSON.stringify({ reason: "user_clicked_emergency", taskId: state.currentTask?.id || null }),
        });
        if (data && data.ticket) updateSupportRoomTicketState(data.ticket);
        await trackEvent("emergency_clicked", { ticketId: data.ticketId, sessionId: data.sessionId || null });
        addMessage(
          pickText(
            `紧急礼宾已接入。工单 ${data.ticketId}，预计 ${data.eta}。`,
            `Emergency concierge linked. Ticket ${data.ticketId}, ETA ${data.eta}.`,
            `緊急コンシェルジュに接続しました。チケット ${data.ticketId}、ETA ${data.eta}。`,
            `긴급 컨시어지 연결 완료. 티켓 ${data.ticketId}, ETA ${data.eta}.`,
          ),
        );
        if (data && data.sessionId) {
          await openSupportRoomBySession(data.sessionId, el.emergencyBtn);
        } else if (data && data.ticketId) {
          await openSupportRoomByTicket(data.ticketId, el.emergencyBtn, { urgent: true, reason: "emergency_fallback_open" });
        }
      } catch (err) {
        addMessage(pickText(`紧急支持失败：${err.message}`, `Emergency support failed: ${err.message}`, `緊急サポート失敗: ${err.message}`, `긴급 지원 실패: ${err.message}`));
      }
    });
  }

  if (el.locateBtn) {
    el.locateBtn.addEventListener("click", async () => {
      await captureLocationFromBrowser(el.locateBtn);
    });
  }

  if (el.inlineLocateBtn) {
    el.inlineLocateBtn.addEventListener("click", async () => {
      await captureLocationFromBrowser(el.inlineLocateBtn);
    });
  }

  const startupJobs = [loadAuditLogs(), loadBuildInfo()];
  if (!IS_USER_PORTAL || state.viewMode === "admin") {
    startupJobs.push(loadNearSuggestions(), loadTrips(), loadOrders(), loadDashboard(), loadSolutionBoard(), loadChatSolutionStrip(), loadMiniPackage());
  }
  await Promise.all(startupJobs);
  motion.bindPressables(document);

  const bootDemo = (() => {
    try {
      return new URLSearchParams(window.location.search).get("demo");
    } catch {
      return "";
    }
  })();
  if (bootDemo) {
    setTimeout(() => {
      runAgentDemoPath(bootDemo).catch((err) => {
        addMessage(
          pickText(
            `演示路径启动失败：${err.message}`,
            `Failed to start demo path: ${err.message}`,
            `デモパス開始に失敗: ${err.message}`,
            `데모 경로 시작 실패: ${err.message}`,
          ),
          "agent",
          { speak: false },
        );
      });
    }, motion.safeDuration(420));
  }

  if (el.supportRoomDrawer && typeof MutationObserver !== "undefined") {
    const observer = new MutationObserver(() => {
      const isClosed =
        el.supportRoomDrawer.classList.contains("hidden") || el.supportRoomDrawer.getAttribute("aria-hidden") === "true";
      if (!isClosed || !state.supportRoom.activeSessionId) return;
      const sid = state.supportRoom.activeSessionId;
      stopSupportRoomPolling();
      stopSupportRoomRecorder(false).catch(() => {});
      api(`/api/support/sessions/${encodeURIComponent(sid)}/presence`, {
        method: "POST",
        body: JSON.stringify({ actor: "user", online: false }),
      }).catch(() => {});
      state.supportRoom.activeSessionId = "";
      state.supportRoom.activeTicketId = "";
    });
    observer.observe(el.supportRoomDrawer, {
      attributes: true,
      attributeFilter: ["class", "aria-hidden"],
    });
  }

  window.addEventListener("beforeunload", () => {
    if (state.chatNoticeTicker) {
      clearInterval(state.chatNoticeTicker);
      state.chatNoticeTicker = null;
    }
    stopSupportRoomPolling();
    if (state.supportRoom.stream) {
      state.supportRoom.stream.getTracks().forEach((track) => track.stop());
      state.supportRoom.stream = null;
    }
    const sid = state.supportRoom.activeSessionId;
    if (sid && navigator.sendBeacon) {
      try {
        const payload = new Blob([JSON.stringify({ actor: "user", online: false })], { type: "application/json" });
        navigator.sendBeacon(`/api/support/sessions/${encodeURIComponent(sid)}/presence`, payload);
      } catch {
        // ignore unload beacon failure
      }
    }
  });
}

// ── P4: Plan Detail Modal / Sheet ─────────────────────────────────────────

// ── P6: FX rates — live from /api/gateway/fx, static fallback ───────────────
const FX_RATES_FALLBACK = {
  EN: { code: "USD", symbol: "$",  rate: 0.138  },
  JA: { code: "JPY", symbol: "¥",  rate: 20.8   },
  KO: { code: "KRW", symbol: "₩",  rate: 186.5  },
  MY: { code: "MYR", symbol: "RM", rate: 0.648  },
};
const _fxLive = { rates: null }; // populated by fetchGatewayFx()
const _couponCache = new Map();  // destination → coupon object

function getActiveFx() {
  const lang = state.uiLanguage || "ZH";
  const fb   = FX_RATES_FALLBACK[lang] || null;
  if (!_fxLive.rates) return fb;
  const codeMap = { EN: "USD", JA: "JPY", KO: "KRW", MY: "MYR" };
  const symMap  = { USD: "$", JPY: "¥", KRW: "₩", MYR: "RM" };
  const code    = codeMap[lang];
  if (!code || !_fxLive.rates[code]) return fb;
  return { code, symbol: symMap[code] || code, rate: _fxLive.rates[code] };
}

async function fetchGatewayFx() {
  try {
    const res  = await fetch("/api/gateway/fx");
    const json = await res.json();
    if (json.ok && json.rates) _fxLive.rates = json.rates;
  } catch { /* fallback constants stay in effect */ }
}

async function fetchCouponBar(destination, barEl) {
  if (!destination || !barEl) return;
  if (_couponCache.has(destination)) {
    _applyCouponBar(barEl, _couponCache.get(destination));
    return;
  }
  try {
    const res    = await fetch(`/api/gateway/coupons?keyword=${encodeURIComponent(destination)}`);
    const json   = await res.json();
    const coupon = (json.coupons || [])[0] || null;
    _couponCache.set(destination, coupon);
    _applyCouponBar(barEl, coupon);
  } catch { /* silent fail */ }
}

function _applyCouponBar(barEl, coupon) {
  if (!barEl) return;
  const lang = state.uiLanguage || "ZH";

  if (!coupon) {
    barEl.innerHTML = `<span class="cx-sb-icon">✈️</span><span class="cx-sb-text">${
      { ZH: "CrossX 安全预订保障", EN: "CrossX Secure Booking", JA: "CrossX 安全予約保障", KO: "CrossX 안전 예약 보장", MY: "CrossX Tempahan Selamat" }[lang] || "CrossX Secure Booking"
    }</span>`;
    return;
  }

  // ── Restaurant/store format (from fetchJutuiRestaurants via ele/store_list) ──
  if ("monthly_sales" in coupon || "biz_type" in coupon) {
    const name  = coupon.shop_name || "";
    const sales = coupon.monthly_sales || "";
    const label = name
      ? { ZH: `附近美食: ${name}${sales ? " · " + sales : ""}`, EN: `Nearby: ${name}${sales ? " · " + sales : ""}`, JA: `近く: ${name}${sales ? " · " + sales : ""}`, KO: `근처: ${name}${sales ? " · " + sales : ""}`, MY: `Berdekatan: ${name}` }[lang] || name
      : { ZH:"已接入本地美食数据", EN: "Local dining data active", JA:"ローカルグルメ接続済み", KO: "로컬 맛집 연결됨", MY: "Data makanan lokal aktif" }[lang] || "Local dining data active";
    barEl.innerHTML = `<span class="cx-sb-icon">🍜</span><span class="cx-sb-text">${escapeHtml(label)}</span>`;
    return;
  }

  // ── Legacy coupon format (coupon_price, h5_url) ──
  const price = coupon.coupon_price || "0";
  const h5url = coupon.h5_url || "";
  if (price === "0") {
    barEl.innerHTML = `<span class="cx-sb-icon">✈️</span><span class="cx-sb-text">${
      { ZH: "CrossX 安全预订保障", EN: "CrossX Secure Booking", JA: "CrossX 安全予約保障", KO: "CrossX 안전 예약 보장", MY: "CrossX Tempahan Selamat" }[lang] || "CrossX Secure Booking"
    }</span>`;
    return;
  }
  const label = { ZH: `专属优惠券 ¥${price}`, EN: `¥${price} Voucher`, JA: `クーポン ¥${price}`, KO: `쿠폰 ¥${price}`, MY: `Baucar ¥${price}` }[lang] || `¥${price} Off`;
  barEl.innerHTML = `<span class="cx-sb-icon">🎫</span><span class="cx-sb-text">${escapeHtml(label)}</span>`;
  if (h5url && h5url !== "#cx-book") {
    barEl.style.cursor = "pointer";
    barEl.onclick = () => window.open(h5url, "_blank", "noopener");
  }
}

function buildPlanDetailHtml(p, cardId, planIdx, spokenText) {
  const heroUrl       = p.hotel?.hero_image || "";
  const ppn           = p.hotel?.price_per_night || 0;
  const hotelRating   = p.hotel?.rating || 0;
  const hotelRevCount = p.hotel?.review_count || "";
  const hotelGuestRev = p.hotel?.guest_review || "";

  const highlights = (p.highlights || []).slice(0, 5).map((h) =>
    `<li><span class="opt-check">✓</span>${escapeHtml(h)}</li>`
  ).join("");

  // "Why we recommend" — use spokenText for recommended plan, highlights for others
  const whyText = spokenText
    ? escapeHtml(spokenText)
    : (p.highlights || []).slice(0, 2).map((h) => escapeHtml(h)).join(" · ");

  const bbEntries = [
    { label: pickText("住宿","Accom.","宿泊","숙소"),             key: "accommodation", color: "#2d87f0" },
    { label: pickText("交通","Transport","交通","교통"),           key: "transport",     color: "#10b981" },
    { label: pickText("餐饮","Food","食事","식사"),                key: "meals",         color: "#f59e0b" },
    { label: pickText("活动","Activities","アクティビティ","활동"), key: "activities",    color: "#8b5cf6" },
    { label: pickText("杂项","Misc.","その他","기타"),             key: "misc",          color: "#94a3b8" },
  ].filter((e) => (p.budget_breakdown || {})[e.key] > 0);
  const bbTotal = bbEntries.reduce((s, e) => s + ((p.budget_breakdown || {})[e.key] || 0), 0) || 1;
  const bbBar = bbEntries.map((e) => {
    const pct = Math.max(4, Math.round(((p.budget_breakdown || {})[e.key] || 0) / bbTotal * 100));
    return `<div class="opt-bb-seg" style="width:${pct}%;background:${e.color}"></div>`;
  }).join("");
  const bbLegend = bbEntries.map((e) =>
    `<span class="opt-bb-item"><span style="background:${e.color}"></span>${e.label} ¥${Number((p.budget_breakdown || {})[e.key] || 0).toLocaleString()}</span>`
  ).join("");

  const el = document.createElement("div");
  el.className = "cx-plan-detail";
  el.innerHTML = `
    ${heroUrl ? `<img class="cx-detail-hero" src="${heroUrl}" alt="" loading="lazy" onerror="this.style.display='none'">` : ""}
    <div class="cx-detail-body">
      <div class="cx-detail-hotel-name">${escapeHtml(p.hotel?.name || "")}</div>
      <div class="cx-detail-meta">
        ${hotelRating   ? `<span class="opt-hotel-stars">★ ${hotelRating}</span>` : ""}
        ${hotelRevCount ? `<span class="opt-hotel-revcount">${escapeHtml(hotelRevCount)}</span>` : ""}
        ${ppn           ? `<span class="opt-hotel-ppn">¥${ppn}${pickText("/晚","/night","/泊","/박")}</span>` : ""}
      </div>
      ${hotelGuestRev ? `<div class="opt-hotel-guestrev">"${escapeHtml(hotelGuestRev)}"</div>` : ""}
      ${whyText ? `
      <div class="cx-detail-why">
        <div class="cx-detail-why-label">${pickText("为何推荐","Why We Recommend This","おすすめの理由","추천 이유")}</div>
        ${whyText}
      </div>` : ""}
      <div class="cx-detail-divider"></div>
      <div class="cx-detail-section-label">${pickText("交通方案","Transport","交通","교통")}</div>
      <div class="cx-detail-transport">${escapeHtml(p.transport_plan || "")}</div>
      <div class="cx-detail-section-label">${pickText("亮点","Highlights","ハイライト","하이라이트")}</div>
      <ul class="opt-highlights">${highlights}</ul>
      ${bbBar ? `
      <div class="cx-detail-section-label">${pickText("预算分配","Budget Breakdown","予算内訳","예산 배분")}</div>
      <div class="opt-bb-bar" style="height:6px;margin:0 0 6px">${bbBar}</div>
      <div class="opt-bb-legend">${bbLegend}</div>` : ""}
      <div class="cx-detail-actions">
        <button class="cx-detail-itin-btn"
          data-card="${escapeHtml(cardId)}" data-plan="${escapeHtml(p.id || "")}" data-idx="${planIdx}"
          onclick="cxDetailOpenItinerary(this)">
          ${pickText("查看逐日行程 ↓","View Itinerary ↓","日程を見る ↓","일정 보기 ↓")}
        </button>
        <button class="cx-detail-book-btn"
          data-card="${escapeHtml(cardId)}" data-plan="${escapeHtml(p.id || "")}" data-idx="${planIdx}"
          onclick="cxGoToCheckout(this)">
          ${pickText("预订此方案 →","Book This Plan →","このプランを予約 →","이 플랜 예약 →")}
        </button>
      </div>
    </div>`;
  return el;
}

// ── P6: Multi-step Checkout (Confirm → Payment → Syncing) ─────────────────
function buildCheckoutHtml(p, cardId, planIdx) {
  const fx    = getActiveFx();
  const bd    = p.budget_breakdown || {};
  const total = p.total_price || 0;

  const rows = [
    { label: pickText("住宿","Accommodation","宿泊","숙소"),          key: "accommodation" },
    { label: pickText("交通","Transport","交通","교통"),               key: "transport"     },
    { label: pickText("餐饮","Meals","食事","식사"),                   key: "meals"         },
    { label: pickText("活动","Activities","アクティビティ","활동"),    key: "activities"    },
    { label: pickText("杂项","Misc.","その他","기타"),                 key: "misc"          },
  ].filter((r) => bd[r.key] > 0);

  const fxHeader  = fx ? `<th>${fx.code}</th>` : "";
  const tableRows = rows.map((r) => {
    const cny   = Number(bd[r.key] || 0).toLocaleString();
    const fxVal = fx ? `<td class="cx-co-fx">${fx.symbol}${Math.round((bd[r.key] || 0) * fx.rate).toLocaleString()}</td>` : "";
    return `<tr><td class="cx-co-label">${r.label}</td><td class="cx-co-cny">¥${cny}</td>${fxVal}</tr>`;
  }).join("");
  const totalFx = fx ? `<td class="cx-co-fx cx-co-total-fx">${fx.symbol}${Math.round(total * fx.rate).toLocaleString()}</td>` : "";
  const totalFxInline = fx ? ` · ${fx.symbol}${Math.round(total * fx.rate).toLocaleString()}` : "";

  // Payment method rows
  const pmMethods = [
    { icon: "💳", label: pickText("信用卡 / 借记卡", "Credit / Debit Card","クレジットカード", "Kad Kredit / Debit"), method: "card" },
    { icon: "💚", label: "CrossX Pay (WeChat)",  method: "wxpay"  },
    { icon: "💙", label: "CrossX Pay (Alipay)",  method: "alipay" },
  ].map((pm, i) =>
    `<div class="cx-pm-row${i === 0 ? " cx-pm-selected" : ""}" onclick="cxSelectPayMethod(this)" data-method="${pm.method}">
      <span class="cx-pm-icon">${pm.icon}</span>
      <span class="cx-pm-label">${pm.label}</span>
      <span class="cx-pm-radio"></span>
    </div>`
  ).join("");

  const el = document.createElement("div");
  el.className = "cx-checkout";
  el.innerHTML = `
    <!-- Step 1: Booking confirmation + fee breakdown -->
    <div class="cx-pay-step">
      <div class="cx-co-summary">
        <div class="cx-co-hotel">${escapeHtml(p.hotel?.name || "")}</div>
        <div class="cx-co-meta">${pickText("总价","Total","合計","합계")}: ¥${Number(total).toLocaleString()}${totalFxInline}</div>
      </div>
      <div class="cx-co-divider"></div>
      <table class="cx-co-table">
        <thead><tr>
          <th>${pickText("费用项","Item","項目","항목")}</th>
          <th>CNY</th>
          ${fxHeader}
        </tr></thead>
        <tbody>${tableRows}</tbody>
        <tfoot><tr class="cx-co-total-row">
          <td>${pickText("合计","Total","合計","합계")}</td>
          <td class="cx-co-cny">¥${Number(total).toLocaleString()}</td>
          ${totalFx}
        </tr></tfoot>
      </table>
      <div class="cx-co-divider"></div>
      <button class="cx-pay-btn"
        data-card="${escapeHtml(cardId)}" data-plan="${escapeHtml(p.id || "")}" data-idx="${planIdx}"
        onclick="cxGoToPayment(this)">
        <span class="cx-pay-lock">🔒</span>
        <span class="cx-pay-label">${pickText("确认预订","Confirm Booking","予約を確認","예약 확인")}</span>
        <span class="cx-pay-arrow">→</span>
      </button>
      <div class="cx-pay-trust">${pickText(
        "CrossX 安全支付 · 无隐藏费用 · SSL 加密",
        "CrossX Secure Pay · No hidden fees · SSL encrypted",
        "CrossX セキュア決済 · 非表示料金なし · SSL 暗号化",
        "CrossX 안전 결제 · 숨겨진 비용 없음 · SSL 암호화"
      )}</div>
    </div>

    <!-- Step 2: Payment method selection -->
    <div class="cx-pay-step" style="display:none">
      <div class="cx-co-summary">
        <div class="cx-co-hotel">${pickText("选择支付方式","Select Payment","支払い方法","결제 방법 선택")}</div>
        <div class="cx-co-meta">${pickText("应付","Due","支払金額","결제 금액")}: ¥${Number(total).toLocaleString()}${totalFxInline}</div>
      </div>
      <div class="cx-payment-methods">${pmMethods}</div>
      <button class="cx-pay-btn"
        data-card="${escapeHtml(cardId)}" data-plan="${escapeHtml(p.id || "")}" data-idx="${planIdx}"
        onclick="cxProcessPayment(this)">
        <span class="cx-pay-lock">🔒</span>
        <span class="cx-pay-label">${pickText("立即支付","Pay Now","今すぐ支払う","지금 결제")} ¥${Number(total).toLocaleString()}${totalFxInline}</span>
        <span class="cx-pay-arrow">→</span>
      </button>
    </div>

    <!-- Step 3: Syncing animation -->
    <div class="cx-pay-step cx-pay-syncing" style="display:none">
      <div class="cx-pay-spinner"></div>
      <div class="cx-pay-sync-text">${pickText("正在与航司同步状态...","Syncing with airline...","航空会社と同期中...","항공사와 동기화 중...")}</div>
      <div class="cx-pay-sync-sub">${pickText("通常约15秒","Usually ~15s","通常約15秒","보통 ~15초")}</div>
    </div>`;
  return el;
}

// Step 1 → Step 2: show payment method selection
function cxGoToPayment(btn) {
  const steps = btn.closest(".cx-checkout")?.querySelectorAll(".cx-pay-step");
  if (!steps) return;
  steps[0].style.display = "none";
  steps[1].style.display = "flex";
}

// Toggle payment method highlight
function cxSelectPayMethod(el) {
  el.closest(".cx-payment-methods")
    ?.querySelectorAll(".cx-pm-row")
    .forEach((r) => r.classList.remove("cx-pm-selected"));
  el.classList.add("cx-pm-selected");
}

// Step 2 → Step 3 → create backend order → poll → show voucher
async function cxProcessPayment(btn) {
  const cardId  = btn.dataset.card;
  const planId  = btn.dataset.plan;
  const planIdx = parseInt(btn.dataset.idx, 10);
  const checkout = btn.closest(".cx-checkout");
  if (!checkout) return;

  const steps  = checkout.querySelectorAll(".cx-pay-step");
  const method = checkout.querySelector(".cx-pm-selected")?.dataset.method || "card";

  // Show syncing step
  if (steps[1]) steps[1].style.display = "none";
  if (steps[2]) steps[2].style.display = "flex";

  // Resolve plan data for order creation
  const card = document.getElementById(cardId);
  let plans = [];
  try { plans = JSON.parse(card?.dataset.plans || "[]"); } catch {}
  const chosenPlan  = plans[planIdx] || plans.find((p) => p.id === planId) || {};
  const destination = card?.dataset.destination || "";

  // Animate sync messages
  const syncText = checkout.querySelector(".cx-pay-sync-text");
  const syncSub  = checkout.querySelector(".cx-pay-sync-sub");
  const msgs = [
    [pickText("正在与航司同步状态...", "Syncing with airline...", "航空会社と同期中...", "항공사와 동기화 중..."),
     pickText("通常约15秒", "Usually ~15s","通常約15秒", "보통 ~15초")],
    [pickText("正在确认酒店房态...", "Confirming hotel availability...", "ホテルの空室を確認中...", "호텔 가용성 확인 중..."), ""],
    [pickText("正在锁定最优价格...", "Locking best rate...", "最良レートを確定中...", "최적 요금 확정 중..."), ""],
  ];
  let mi = 0;
  const ticker = setInterval(() => {
    const [text, sub] = msgs[mi++ % msgs.length];
    if (syncText) syncText.textContent = text;
    if (syncSub)  syncSub.textContent  = sub;
  }, 750);

  // Create order on backend (non-blocking — start alongside animation)
  let orderRef = null;
  try {
    const resp = await fetch("/api/order/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        plan: { id: chosenPlan.id, tag: chosenPlan.tag },
        destination,
        method,
        total: Number(chosenPlan.total_price || 0),
      }),
    });
    const json = await resp.json();
    if (json.ok) orderRef = json.ref;
  } catch { /* graceful degradation */ }

  // Client-side fallback ref if backend unreachable
  if (!orderRef) orderRef = "CXS-" + Date.now().toString(36).slice(-5).toUpperCase();

  // Mobile wallets: open H5 pay URL
  const coupon = _couponCache.get(destination);
  if ((method === "wxpay" || method === "alipay") && coupon?.h5_url && coupon.h5_url !== "#cx-book") {
    window.open(coupon.h5_url, "_blank", "noopener");
  }

  // Poll backend for payment confirmation (4 × 800 ms = 3.2 s total)
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 800));
    try {
      const sr = await fetch(`/api/order/status?ref=${encodeURIComponent(orderRef)}`);
      const sj = await sr.json();
      if (sj.status === "confirmed") break;
    } catch {}
  }
  clearInterval(ticker);

  // Replace syncing UI with booking voucher
  if (steps[2]) {
    steps[2].classList.remove("cx-pay-syncing");
    steps[2].style.display = "block";
    steps[2].innerHTML = buildVoucherHtml(orderRef, chosenPlan, destination, method);
  }

  // Auto-close and mark plan as booked after user reads voucher
  await new Promise((r) => setTimeout(r, 3200));
  closeModal();
  closeSheet();
  setTimeout(() => {
    const lc     = card?.querySelector(`.cx-list-card[data-plan-id="${planId}"]`);
    const ctaBtn = lc?.querySelector(".cx-lc-cta");
    if (ctaBtn) selectPlanOption(cardId, planId, planIdx, ctaBtn);
  }, 300);
}

// ── P6-B: Booking Voucher ──────────────────────────────────────────────────
function buildVoucherHtml(ref, plan, destination, method) {
  const methodLabel = { card: pickText("信用卡","Credit Card","クレジットカード","신용카드"), wxpay: "微信支付 WeChat Pay", alipay: "支付宝 Alipay" }[method] || method;
  const total = Number(plan.total_price || 0);
  const tag   = plan.tag || plan.id || "";
  const now   = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
  return `
  <div class="cx-voucher">
    <div class="cx-voucher-check">✓</div>
    <div class="cx-voucher-title">${pickText("预订成功","Booking Confirmed","予約確定","예약 확정")}</div>
    <div class="cx-voucher-qr">
      <div class="cx-voucher-qr-inner">
        <div class="cx-voucher-qr-logo">CX</div>
        <div class="cx-voucher-qr-ref">${escapeHtml(ref)}</div>
      </div>
    </div>
    <div class="cx-voucher-rows">
      <div class="cx-voucher-row"><span>${pickText("目的地","Destination","目的地","목적지")}</span><strong>${escapeHtml(destination)}</strong></div>
      <div class="cx-voucher-row"><span>${pickText("方案","Plan","プラン","플랜")}</span><strong>${escapeHtml(tag)}</strong></div>
      <div class="cx-voucher-row"><span>${pickText("总价","Total","合計","합계")}</span><strong>¥${total.toLocaleString()}</strong></div>
      <div class="cx-voucher-row"><span>${pickText("支付","Payment","支払い","결제")}</span><strong>${escapeHtml(methodLabel)}</strong></div>
      <div class="cx-voucher-row"><span>${pickText("日期","Date","日付","날짜")}</span><strong>${now}</strong></div>
    </div>
    <div class="cx-voucher-note">${pickText("凭此凭证换取所有票券及酒店预订","Present this voucher for all bookings","この券で全ての予約を確認できます","이 바우처로 모든 예약을 확인하세요")}</div>
  </div>`;
}

// ── P5: slide-to-checkout / slide-back ────────────────────────────────────
function cxGoToCheckout(btn) {
  const cardId  = btn.dataset.card;
  const planId  = btn.dataset.plan;
  const planIdx = parseInt(btn.dataset.idx, 10);

  const card = document.getElementById(cardId);
  if (!card) return;
  let plans = [];
  try { plans = JSON.parse(card.dataset.plans || "[]"); } catch {}
  const p = plans[planIdx];
  if (!p) return;

  const checkoutEl    = buildCheckoutHtml(p, cardId, planIdx);
  const checkoutTitle = pickText("确认预订","Checkout","チェックアウト","결제");

  if (window.innerWidth > 768 && _cxModal) {
    // Desktop: slide within modal to panel 2
    const slidesEl  = _cxModal.querySelector(".cx-modal-slides");
    const slideOut  = _cxModal.querySelector(".cx-slide-checkout");
    const backBtn   = _cxModal.querySelector(".cx-modal-back");
    const titleEl   = _cxModal.querySelector(".cx-modal-title");
    if (!slidesEl || !slideOut) return;
    slideOut.innerHTML = "";
    slideOut.appendChild(checkoutEl);
    requestAnimationFrame(() => slidesEl.classList.add("slide-checkout"));
    if (backBtn) { backBtn._prevTitle = titleEl?.textContent || ""; backBtn.style.display = "flex"; }
    if (titleEl) titleEl.textContent = checkoutTitle;
  } else if (_cxBottomSheet) {
    // Mobile: replace sheet body with checkout
    const body    = _cxBottomSheet.querySelector(".cx-sheet-body");
    const titleEl = _cxBottomSheet.querySelector(".cx-sheet-title");
    _cxBottomSheet._prevContent = body.firstElementChild ? body.firstElementChild.cloneNode(true) : null;
    _cxBottomSheet._prevTitle   = titleEl?.textContent || "";
    body.innerHTML = "";
    body.appendChild(checkoutEl);
    if (titleEl) titleEl.textContent = checkoutTitle;
    let backBtn = _cxBottomSheet.querySelector(".cx-sheet-back-btn");
    if (!backBtn) {
      backBtn = document.createElement("button");
      backBtn.className = "cx-modal-back cx-sheet-back-btn";
      backBtn.innerHTML = "←";
      backBtn.addEventListener("click", cxGoBack);
      const hdr = _cxBottomSheet.querySelector(".cx-sheet-header");
      if (hdr) hdr.insertBefore(backBtn, hdr.firstChild);
    }
    backBtn.style.display = "flex";
  }
}

function cxGoBack() {
  if (window.innerWidth > 768 && _cxModal) {
    const slidesEl = _cxModal.querySelector(".cx-modal-slides");
    const backBtn  = _cxModal.querySelector(".cx-modal-back");
    const titleEl  = _cxModal.querySelector(".cx-modal-title");
    if (slidesEl) slidesEl.classList.remove("slide-checkout");
    if (backBtn)  { if (titleEl) titleEl.textContent = backBtn._prevTitle || ""; backBtn.style.display = "none"; }
  } else if (_cxBottomSheet) {
    const body    = _cxBottomSheet.querySelector(".cx-sheet-body");
    const titleEl = _cxBottomSheet.querySelector(".cx-sheet-title");
    const backBtn = _cxBottomSheet.querySelector(".cx-sheet-back-btn");
    if (_cxBottomSheet._prevContent) { body.innerHTML = ""; body.appendChild(_cxBottomSheet._prevContent); }
    if (titleEl) titleEl.textContent = _cxBottomSheet._prevTitle || "";
    if (backBtn) backBtn.style.display = "none";
  }
}

function cxDetailOpenItinerary(btn) {
  const cardId  = btn.dataset.card;
  const planId  = btn.dataset.plan;
  const planIdx = parseInt(btn.dataset.idx, 10);
  closeModal();
  closeSheet();
  setTimeout(() => revealPlanItinerary(cardId, planId, planIdx, null), 350);
}

function openPlanDetail(cardId, planIdx) {
  const card = document.getElementById(cardId);
  if (!card) return;
  let plans = [];
  try { plans = JSON.parse(card.dataset.plans || "[]"); } catch {}
  const p = plans[planIdx];
  if (!p) return;
  const spokenText = card.dataset.spoken || "";
  const title      = p.tag || pickText("方案详情","Plan Details","プラン詳細","플랜 상세");
  const contentEl  = buildPlanDetailHtml(p, cardId, planIdx, spokenText);
  if (window.innerWidth <= 768) {
    openSheet(title, contentEl);
  } else {
    openModal(title, contentEl);
  }
}

// ── P4: Desktop Modal ─────────────────────────────────────────────────────
let _cxModalBackdrop = null;
let _cxModal         = null;

function initModal() {
  if (_cxModalBackdrop) return;
  _cxModalBackdrop = document.createElement("div");
  _cxModalBackdrop.className = "cx-modal-backdrop";
  _cxModalBackdrop.addEventListener("click", closeModal);

  _cxModal = document.createElement("div");
  _cxModal.className = "cx-modal";
  _cxModal.innerHTML = `
    <div class="cx-modal-header">
      <div class="cx-modal-hleft">
        <button class="cx-modal-back" style="display:none" onclick="cxGoBack()">←</button>
        <span class="cx-modal-title"></span>
      </div>
      <button class="cx-sheet-close" aria-label="Close">✕</button>
    </div>
    <div class="cx-modal-slides">
      <div class="cx-modal-slide cx-slide-detail"></div>
      <div class="cx-modal-slide cx-slide-checkout"></div>
    </div>`;
  _cxModal.querySelector(".cx-sheet-close").addEventListener("click", closeModal);
  _cxModal.addEventListener("click", (e) => e.stopPropagation());

  document.body.append(_cxModalBackdrop, _cxModal);

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeSheet(); }
  });
}

function openModal(title, contentEl) {
  initModal();
  _cxModal.querySelector(".cx-modal-title").textContent = title || "";
  const slide = _cxModal.querySelector(".cx-slide-detail");
  slide.innerHTML = "";
  slide.appendChild(contentEl);
  // Reset to detail panel
  _cxModal.querySelector(".cx-modal-slides")?.classList.remove("slide-checkout");
  const backBtn = _cxModal.querySelector(".cx-modal-back");
  if (backBtn) backBtn.style.display = "none";
  requestAnimationFrame(() => {
    _cxModalBackdrop.classList.add("cx-modal-open");
    _cxModal.classList.add("cx-modal-open");
  });
  document.body.style.overflow = "hidden";
}

function closeModal() {
  if (!_cxModal) return;
  _cxModalBackdrop.classList.remove("cx-modal-open");
  _cxModal.classList.remove("cx-modal-open");
  document.body.style.overflow = "";
}

// ── P3: Bottom Sheet ──────────────────────────────────────────────────────
let _cxSheetBackdrop = null;
let _cxBottomSheet   = null;

function initSheet() {
  if (_cxSheetBackdrop) return;
  _cxSheetBackdrop = document.createElement("div");
  _cxSheetBackdrop.className = "cx-sheet-backdrop";
  _cxSheetBackdrop.addEventListener("click", closeSheet);

  _cxBottomSheet = document.createElement("div");
  _cxBottomSheet.className = "cx-bottom-sheet";
  _cxBottomSheet.innerHTML = `
    <div class="cx-sheet-handle"></div>
    <div class="cx-sheet-header">
      <span class="cx-sheet-title"></span>
      <button class="cx-sheet-close" aria-label="Close">✕</button>
    </div>
    <div class="cx-sheet-body"></div>`;
  _cxBottomSheet.querySelector(".cx-sheet-close").addEventListener("click", closeSheet);

  // Swipe-to-close: drag down ≥60px closes the sheet
  let _touchStartY = 0;
  _cxBottomSheet.addEventListener("touchstart", (e) => {
    _touchStartY = e.touches[0].clientY;
  }, { passive: true });
  _cxBottomSheet.addEventListener("touchend", (e) => {
    if (e.changedTouches[0].clientY - _touchStartY > 60) closeSheet();
  }, { passive: true });

  document.body.append(_cxSheetBackdrop, _cxBottomSheet);
}

function openSheet(title, contentEl) {
  initSheet();
  _cxBottomSheet.querySelector(".cx-sheet-title").textContent = title || "";
  const body = _cxBottomSheet.querySelector(".cx-sheet-body");
  body.innerHTML = "";
  body.appendChild(contentEl);
  requestAnimationFrame(() => {
    _cxSheetBackdrop.classList.add("cx-sheet-open");
    _cxBottomSheet.classList.add("cx-sheet-open");
  });
  document.body.style.overflow = "hidden";
}

function closeSheet() {
  if (!_cxBottomSheet) return;
  _cxSheetBackdrop.classList.remove("cx-sheet-open");
  _cxBottomSheet.classList.remove("cx-sheet-open");
  document.body.style.overflow = "";
}

// ── P2: Session Auto-Binding ──────────────────────────────────────────────
const CX_PLAN_SESSION_KEY = "cx_plan_session";
const CX_SESSION_TTL_MS   = 4 * 60 * 60 * 1000; // 4h — mirrors backend TTL

function savePlanSessionId(id) {
  if (!id) return;
  try { localStorage.setItem(CX_PLAN_SESSION_KEY, JSON.stringify({ id, savedAt: Date.now() })); } catch {}
}

function loadPlanSessionId() {
  try {
    const raw = localStorage.getItem(CX_PLAN_SESSION_KEY);
    if (!raw) return null;
    const { id, savedAt } = JSON.parse(raw);
    if (Date.now() - savedAt > CX_SESSION_TTL_MS) { localStorage.removeItem(CX_PLAN_SESSION_KEY); return null; }
    return id || null;
  } catch { return null; }
}

function renderSessionBadge(show) {
  let badge = document.getElementById("cx-session-badge");
  if (!badge) {
    const form = document.getElementById("chatForm");
    if (!form) return;
    badge = document.createElement("span");
    badge.id = "cx-session-badge";
    badge.className = "cx-session-badge hidden";
    badge.title = pickText(
      "AI 已记住本次行程，可直接追问修改",
      "AI remembers your plan — ask follow-up questions",
      "AIが行程を記憶中 — 追加質問できます",
      "AI가 일정을 기억 중 — 추가 질문 가능",
    );
    badge.innerHTML = `<span class="cx-session-dot"></span><span class="cx-session-label">${pickText("记忆中", "Active","記憶中", "기억 중")}</span>`;
    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.insertAdjacentElement("beforebegin", badge);
    else form.appendChild(badge);
  }
  badge.classList.toggle("hidden", !show);
}

// ── P2: Boundary Rejection Card ───────────────────────────────────────────
function renderBoundaryRejectionCard(text) {
  const feed = document.getElementById("chatFeed");
  if (!feed) return;
  const card = document.createElement("div");
  card.className = "cx-boundary-card";
  card.innerHTML = `
    <div class="cx-boundary-icon">🛡</div>
    <div class="cx-boundary-body">
      <p class="cx-boundary-text">${escapeHtml(text || pickText(
        "抱歉，我是专注于旅行规划的 AI 助手，无法处理此类请求。",
        "Sorry, I specialize in travel planning and cannot assist with this request.",
        "申し訳ありません、旅行専門 AI のため対応できません。",
        "죄송합니다. 저는 여행 전문 AI로 이 요청을 처리할 수 없습니다.",
      ))}</p>
      <button class="cx-boundary-reset" onclick="(function(){var i=document.getElementById('chatInput');if(i){i.focus();i.value='';}})()">
        ${pickText("返回旅行规划 ↩", "Back to Travel Planning ↩", "旅行計画に戻る ↩", "여행 계획으로 돌아가기 ↩")}
      </button>
    </div>`;
  feed.appendChild(card);
  feed.scrollTop = feed.scrollHeight;
}

// ── SSE Plan Stream Client ────────────────────────────────────────────────
// Connects to /api/plan/coze via fetch + ReadableStream (SSE-over-POST).
// Calls onStatusUpdate(code, label) for each progress event.
// Returns the final event object when stream ends.
async function consumePlanStream({
  message, language, city, constraints, conversationHistory,
  onStatusUpdate, onThinking, onSessionId,
  signal,  // AbortController.signal — abort this fetch when user sends new message
}) {
  const resp = await fetch("/api/plan/coze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message, language, city, constraints, conversationHistory,
      sessionId: loadPlanSessionId(), // P2: auto-carry session memory
    }),
    signal,
  });
  if (!resp.ok || !resp.body) throw new Error(`plan_stream_${resp.status}`);

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalEvent = null;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep partial line
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        try {
          const ev = JSON.parse(line.slice(6));
          if (ev.type === "status" && typeof onStatusUpdate === "function") {
            onStatusUpdate(ev.code, ev.label);
          } else if (ev.type === "tool_call" && typeof onStatusUpdate === "function") {
            // P8.6: Coze/backend emits tool_call events → TOOL_SIGNAL_MAP lookup
            onStatusUpdate("TOOL:" + (ev.tool_name || "unknown"), ev.label || "");
          } else if (ev.type === "thinking" && typeof onThinking === "function") {
            onThinking(ev.text || "");
          } else if (ev.type === "final" || ev.type === "error") {
            finalEvent = ev;
            // P2: persist sessionId from backend for future UPDATE requests
            if (ev.sessionId && typeof onSessionId === "function") onSessionId(ev.sessionId);
            // P8.3: store Coze enrichment for hero_image / queue / ticket slots
            if (ev.coze_data) state.cozeData = ev.coze_data;
            // P8.6: store layout_type for polymorphic card rendering
            state._layoutType = ev.card_data?.layout_type || "travel_full";
          }
        } catch { /* ignore malformed line */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return finalEvent || { type: "error", msg: "No response" };
}

// ── P2: Thinking Stream + Plan Skeleton ──────────────────────────────────
// Replaces the old "step-progress-card" with an animated thinking timeline
// and a shimmer skeleton screen — giving users a real sense of AI at work.

const PLAN_STEPS = [
  { id: "INIT",     icon: "🔍" },
  { id: "H_SEARCH", icon: "🏨" },
  { id: "T_CALC",   icon: "🚗" },
  { id: "B_CHECK",  icon: "💰" },
];

// P8.7 Unified real-time thinking map — handles BOTH SSE tool_call events AND
// backend status codes. Values are thunks: (dest, foodKw) => string.
// Rules: (1) No hardcoded hotel/generic text when user asks about food.
//        (2) dest + foodKw injected at call-time for city-specific copy.
const REALTIME_THINKING_MAP = {
  // ── Backend status codes ─────────────────────────────────────────────────
  INIT:     (d, f) => f
    ? pickText(`正在解析${d}${f}偏好...`,      `Parsing ${d} food preferences...`,          `${d}の${f}好みを解析中...`,       `${d} ${f} 취향 분석 중...`)
    : pickText("正在理解需求...",              "Analyzing request...",                      "リクエスト解析中...",             "요청 분석 중..."),
  H_SEARCH: (d, f) => f
    ? pickText(`搜寻${d}${f}`,                 `Hunting ${d} ${f}`,                         `${d}の${f}を探索中`,              `${d} ${f} 탐색 중`)
    : pickText(`搜罗${d}特色住宿`,             `Scouting ${d} stays`,                       `${d}の宿を探索中`,                `${d} 숙소 탐색 중`),
  T_CALC:   (d, f) => f
    ? pickText(`规划${d}美食打卡路线`,         `Mapping ${d} food trail`,                   `${d}グルメルートを計画中`,        `${d} 맛집 경로 계획 중`)
    : pickText("正在核算交通费用...",          "Calculating transport...",                  "交通費を計算中...",               "교통비 계산 중..."),
  B_CHECK:  (d, f) => f
    ? pickText(`精算${d}人均餐饮消费`,         `Budgeting ${d} per-person dining`,          `${d}の一人あたり飲食費を計算中`,  `${d} 1인 식비 계산 중`)
    : pickText("正在锁定最优预算...",          "Locking best budget...",                    "最適予算を確定中...",             "최적 예산 확정 ���..."),
  // ── Coze tool_call names ─────────────────────────────────────────────────
  search_restaurants:          (d) => pickText(`搜寻${d}本地必吃老字号`,    `Hunting ${d} must-eat spots`,       `${d}の必食店を探索中`,     `${d} 필수 맛집 탐색 중`),
  check_restaurant_queue:      (d) => pickText(`实时探测${d}餐厅排队强度`, `Checking ${d} restaurant queues`,   `${d}の待ち時間を確認中`,   `${d} 대기 시간 확인 중`),
  search_attractions:          (d) => pickText(`挖掘${d}符合你口味的景点`, `Finding ${d} gems for you`,         `${d}のあなた向け名所を発見中`, `${d} 맞춤 명소 발굴 중`),
  generate_creative_itinerary: (d) => pickText(`规划${d}避开人流专属动线`, `Plotting ${d} crowd-free route`,    `${d}の穴場ルートを計画中`, `${d} 한산한 경로 계획 중`),
  search_hotels:               (d) => pickText(`搜罗${d}特色住宿`,         `Scouting ${d} unique stays`,        `${d}のユニークな宿を探索中`, `${d} 특색 숙소 탐색 중`),
  check_tickets:               (d) => pickText(`查询${d}景点余票`,         `Checking ${d} ticket availability`, `${d}のチケット在庫を確認中`, `${d} 티켓 재고 확인 중`),
  fetch_fx_rates:              ()  => pickText("调取实时汇率...",           "Fetching live FX rates...",         "為替レートを取得中...",    "환율 조회 중..."),
  match_coupons:               (d) => pickText(`匹配${d}专属优惠`,         `Matching ${d} exclusive deals`,     `${d}の限定特典を取得中`,   `${d} 전용 혜택 검색 중`),
  plan_transport:              (d) => pickText(`规划${d}交通路线`,          `Plotting ${d} best route`,          `${d}のルートを最適化中`,   `${d} 경로 계획 중`),
  verify_budget:               ()  => pickText("精算最优预算...",           "Optimizing budget...",              "予算を最適化中...",        "예산 최적화 중..."),
};

// Helper: extract destination city from user message (inline, no regex import needed)
function _extractDestFromText(msg) {
  const CITIES = ["北京","上海","广州","深圳","成都","西安","杭州","南京","武汉","重庆","厦门","三亚","丽江","桂林","拉萨","乌鲁木齐","苏州","青岛","大理","张家界","黄山","敦煌"];
  return CITIES.find((c) => msg.includes(c)) || getCurrentCity() || "";
}

// Helper: extract specific food keyword from message (e.g. "肉夹馍" from "想吃肉夹馍")
function _extractFoodKw(msg) {
  const m = msg.match(/[^\s，。！？,!?]{2,6}(?:饭|菜|面|馍|泡馍|凉皮|肠粉|火锅|烤肉|串|烧烤|小吃|海鲜|烤鸭|粥|汤|饺子|丸子|炒饭|米粉|螺蛳粉)/);
  if (m) return m[0];
  if (/餐厅|美食|好吃|吃遍|推荐.*吃/.test(msg)) return pickText("特色小吃", "local food", "地元グルメ", "현지 음식");
  return null;
}
const STEP_ORDER = PLAN_STEPS.map((s) => s.id);

/** Create the thinking-stream timeline and append to chatFeed. Returns root el. */
function renderThinkingStream() {
  const feed = document.getElementById("chatFeed");
  if (!feed) return null;

  const wrap = document.createElement("div");
  wrap.className = "cx-thinking-stream";

  const title = document.createElement("div");
  title.className = "cx-ts-title";
  title.innerHTML = `<span class="cx-ts-ping"></span>${pickText("CrossX AI 正在思考...", "CrossX AI is thinking...", "CrossX AI が思考中...", "CrossX AI 생각 중...")}`;
  wrap.appendChild(title);

  const list = document.createElement("div");
  list.className = "cx-ts-list";
  PLAN_STEPS.forEach((s, i) => {
    const row = document.createElement("div");
    row.className = "cx-ts-step" + (i === 0 ? " active" : " pending");
    row.dataset.step = s.id;
    row.innerHTML = `<span class="cx-ts-icon">${s.icon}</span><span class="cx-ts-label"></span><span class="cx-ts-state"></span>`;
    list.appendChild(row);
  });
  wrap.appendChild(list);

  feed.appendChild(wrap);
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

/** Typewriter animation helper for a single DOM text element. */
function _typewrite(el, text, speedMs = 14) {
  if (!el || !text) return;
  el.textContent = "";
  let i = 0;
  const tick = () => {
    if (i < text.length) { el.textContent += text[i++]; setTimeout(tick, speedMs); }
  };
  tick();
}

/** Mark current step done + activate next one with typewriter effect. */
function appendThinkingStep(stream, code, label) {
  if (!stream) return;
  const idx = STEP_ORDER.indexOf(code);
  if (idx === -1) return;

  STEP_ORDER.forEach((stepId, i) => {
    const row = stream.querySelector(`[data-step="${stepId}"]`);
    if (!row) return;
    const lblEl   = row.querySelector(".cx-ts-label");
    const stateEl = row.querySelector(".cx-ts-state");
    if (i < idx) {
      row.className = "cx-ts-step done";
      if (stateEl) stateEl.textContent = "✓";
    } else if (i === idx) {
      row.className = "cx-ts-step active";
      if (lblEl) _typewrite(lblEl, label || code, 14);
      if (stateEl) stateEl.innerHTML = `<span class="cx-ts-pulse"></span>`;
    }
  });

  const feed = document.getElementById("chatFeed");
  if (feed) feed.scrollTop = feed.scrollHeight;
}

/** Render 3-column shimmer skeleton below the thinking stream. Returns root el. */
function renderPlanSkeleton() {
  const feed = document.getElementById("chatFeed");
  if (!feed) return null;

  const wrap = document.createElement("div");
  wrap.className = "cx-plan-skeleton";
  for (let c = 0; c < 3; c++) {
    const col = document.createElement("div");
    col.className = "cx-skel-col";
    col.innerHTML = `
      <div class="cx-skel-block cx-skel-h1"></div>
      <div class="cx-skel-block cx-skel-h2"></div>
      <div class="cx-skel-block cx-skel-h3"></div>
      <div class="cx-skel-block cx-skel-h3"></div>`;
    wrap.appendChild(col);
  }
  feed.appendChild(wrap);
  feed.scrollTop = feed.scrollHeight;
  return wrap;
}

/** Fade out + remove both thinking stream and skeleton when final event arrives. */
function teardownThinkingUI(thinkingEl, skeletonEl) {
  [skeletonEl, thinkingEl].forEach((el, idx) => {
    if (!el || !el.parentElement) return;
    el.classList.add("cx-fadeout");
    setTimeout(() => { if (el.parentElement) el.remove(); }, 250 + idx * 80);
  });
}

// ── Thinking Panel (Coze reasoning chain display) ─────────────────────────
function createThinkingPanel() {
  const feed = document.getElementById("chatFeed");
  if (!feed) return null;
  const panel = document.createElement("div");
  panel.className = "thinking-panel";
  panel.dataset.thinkingPanel = "1";
  panel.innerHTML = `
    <div class="thinking-panel-header" onclick="this.closest('.thinking-panel').classList.toggle('collapsed')">
      <div class="thinking-panel-icon"></div>
      <span class="thinking-panel-label">${pickText("深度推理中...", "Deep Reasoning...", "深層推論中...", "심층 추론 중...")}</span>
      <span class="thinking-panel-chars"></span>
      <span class="thinking-panel-toggle">▾</span>
    </div>
    <div class="thinking-panel-body"><span class="thinking-text"></span></div>`;
  feed.appendChild(panel);
  feed.scrollTop = feed.scrollHeight;
  return panel;
}

function appendThinkingText(panel, text) {
  if (!panel) return;
  const textEl = panel.querySelector(".thinking-text");
  if (!textEl) return;
  textEl.textContent += text;
  // Update char count
  const chars = panel.querySelector(".thinking-panel-chars");
  if (chars) chars.textContent = `${textEl.textContent.length} chars`;
  const body = panel.querySelector(".thinking-panel-body");
  if (body) body.scrollTop = body.scrollHeight;
}

function collapseThinkingPanel(panel) {
  if (!panel) return;
  panel.classList.add("done", "collapsed");
  const label = panel.querySelector(".thinking-panel-label");
  if (label) label.textContent = pickText("推理完成", "Reasoning done","推論完了", "추론 완료");
  const chars = panel.querySelector(".thinking-panel-chars");
  const textEl = panel.querySelector(".thinking-text");
  if (chars && textEl) chars.textContent = `${textEl.textContent.length} chars`;
  else if (chars) chars.textContent = "";
}

// ── Booking Handlers ──────────────────────────────────────────────────────
async function handleBookingCreate(opt) {
  try {
    setLoading("booking", true);
    const data = await api("/api/booking/create", {
      method: "POST",
      body: JSON.stringify({
        optionId: opt.id,
        totalCost: opt.total_cost,
        currency: "CNY",
        planSnapshot: { tag: opt.tag, hotel_name: opt.hotel_name, total_cost: opt.total_cost },
      }),
    });
    if (data && data.status === "awaiting_payment") {
      showBookingPaymentModal(data);
    }
  } catch {
    notify(pickText("预订请求失败，请重试", "Booking request failed","予約に失敗しました", "예약 요청 실패"), "error");
  } finally {
    setLoading("booking", false);
  }
}

function showBookingPaymentModal(orderData) {
  const modal = document.getElementById("paymentModal");
  if (!modal) return;
  const setText = (id, v) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  setText("payModalTitle","确认订单");
  setText("payModalSubtitle", `订单号: ${orderData.orderId}`);
  setText("payItemName","定制行程方案");
  setText("payItemPrice",     `¥${Number(orderData.totalCost).toLocaleString()}`);
  setText("payTotal",         `¥${Number(orderData.totalCost).toLocaleString()}`);

  const qrSection = document.getElementById("payQrSection");
  if (qrSection) qrSection.classList.add("hidden");

  // Wire payment method buttons to show QR placeholder
  ["payWechat", "payAlipay"].forEach((btnId) => {
    const btn = document.getElementById(btnId);
    if (!btn) return;
    btn.onclick = () => {
      const label = document.getElementById("payQrLabel");
      const amount = document.getElementById("payQrAmount");
      const hint = document.getElementById("payQrHint");
      if (label) label.textContent = btnId === "payWechat" ? "微信支付扫码" :"支付宝扫码";
      if (amount) amount.textContent = `¥${Number(orderData.totalCost).toLocaleString()}`;
      if (hint)   hint.textContent   = btnId === "payWechat" ? "请用微信扫描二维码" :"请用支付宝扫描二维码";
      if (qrSection) qrSection.classList.remove("hidden");
    };
  });

  // "我已完成支付\u201d → call confirm API
  const doneBtn = document.getElementById("payDoneBtn");
  if (doneBtn) {
    doneBtn.onclick = async () => {
      try {
        const result = await api("/api/booking/confirm", {
          method: "POST",
          body: JSON.stringify({ orderId: orderData.orderId }),
        });
        modal.classList.add("hidden");
        if (result && result.status === "success") renderPaymentSuccessCard(result);
      } catch {
        notify(pickText("确认支付失败，请重试", "Payment confirmation failed","支払い確認に失敗", "결제 확인 실패"), "error");
      }
    };
  }

  const closeBtn = document.getElementById("payModalClose");
  if (closeBtn) closeBtn.onclick = () => modal.classList.add("hidden");
  modal.classList.remove("hidden");
}

function renderPaymentSuccessCard(result) {
  const { orderId = "", itineraryId = "", msg = "" } = result;
  clearChatCards({ keepDeliverable: true, keepSmartReply: false });
  addCard(`
    <article class="card booking-success-card">
      <div class="booking-success-icon">✓</div>
      <h3 class="booking-success-title">${pickText("支付成功！行程已确认", "Payment Successful!","支払い完了！旅程確定", "결제 완료! 일정 확정")}</h3>
      <p class="booking-success-msg">${escapeHtml(msg || pickText("您的行程已成功预订。", "Your itinerary is confirmed.","旅程が確定しました。", "일정이 확정되었습니다."))}</p>
      <div class="booking-success-code">
        <span class="booking-code-label">${pickText("电子确认码", "Confirmation Code","確認コード", "확인 코드")}</span>
        <span class="booking-code-value">${escapeHtml(itineraryId || orderId)}</span>
      </div>
      <div class="booking-success-meta">${pickText("订单号", "Order","注文番号", "주문번호")}: ${escapeHtml(orderId)}</div>
    </article>
  `);

  const confirmMsg = pickText(
    "太棒了！您的行程已预订成功。您可以随时问我关于这趟旅程的其他问题，比如当地美食推荐、交通攻略或注意事项。",
    "Excellent! Your itinerary has been booked. Feel free to ask me anything about this trip — dining tips, transport routes, or things to know.",
    "予約が完了しました！旅程について何でも質問してください。食事、交通、注意点など。",
    "예약이 완료되었습니다! 이번 여행에 대해 언제든지 질문해 주세요.",
  );
  addMessage(confirmMsg, "agent");
  speakAssistantMessage(confirmMsg);

  if (!Array.isArray(state.agentConversation.messages)) state.agentConversation.messages = [];
  state.agentConversation.messages.push({ role: "assistant", content: confirmMsg });
}

init();
