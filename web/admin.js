(function createCrossXOpsConsole() {
  const ASSET_VERSION = "20260224-15";

  const motion = window.CrossXMotion || {
    bindPressables() {},
    enter() {},
    safeDuration(ms) {
      return ms;
    },
  };
  const drawerController = window.CrossXDrawer ? window.CrossXDrawer.createDrawerController() : null;
  const modal = window.CrossXModal ? window.CrossXModal.createModal() : null;
  const toast = window.CrossXToast ? window.CrossXToast.createToast() : null;
  const skeleton = window.CrossXSkeleton || null;

  const LANG_TEXT = {
    ZH: {
      title: "Cross X Ops Console",
      subtitle: "人工监督与工单执行中台",
      openUserApp: "打开用户端",
      refresh: "刷新",
      langLabel: "语言",
      overviewHeading: "人工干预总览",
      lastUpdated: "最后更新：{time}",
      issuesHeading: "待转人工问题",
      liveSessionsHeading: "实时会话队列",
      liveRoomHeading: "人工通话空间",
      immediateHeading: "需立即监督",
      pendingHeading: "待处理工单",
      activeHeading: "处理中",
      resolvedHeading: "已解决",
      total: "总工单",
      immediate: "立即处理",
      pending: "待处理",
      inProgress: "处理中",
      resolved: "已解决",
      overdue: "超时风险",
      issueCount: "待补工单问题",
      firstResponse: "平均首响(分钟)",
      resolveDuration: "平均解决(分钟)",
      emptyQueue: "当前无工单",
      emptyIssue: "当前无待转人工问题",
      liveListEmpty: "当前无实时会话",
      liveRoomEmpty: "请选择会话并接入。",
      liveOpenRoom: "打开会话",
      liveClaimSession: "接入会话",
      liveCloseSession: "关闭会话",
      liveVoiceReply: "语音回复",
      liveSend: "发送",
      liveInputPlaceholder: "输入回复给前端用户...",
      liveStatus_waiting: "等待接入",
      liveStatus_active: "进行中",
      liveStatus_closed: "已关闭",
      liveUnreadUser: "用户未读",
      liveUnreadOps: "坐席未读",
      liveSession: "会话",
      liveTicket: "工单",
      liveAgent: "坐席",
      status_open: "待处理",
      status_in_progress: "处理中",
      status_resolved: "已解决",
      status_failed: "失败",
      status_canceled: "已取消",
      status_queued: "排队中",
      status_running: "执行中",
      status_success: "成功",
      status_skipped: "已跳过",
      status_fallback_to_human: "转人工",
      priority_normal: "普通",
      priority_high: "高优先",
      priority_critical: "紧急",
      taskLine: "任务：{taskId} · {status}",
      etaLine: "剩余 ETA：{min} 分钟",
      overdueLine: "已超时 {min} 分钟",
      updatedAt: "更新时间",
      createdAt: "创建时间",
      source: "来源",
      reason: "原因",
      handler: "处理方",
      city: "城市",
      openDetail: "查看详情",
      claim: "接单处理",
      resolve: "标记解决",
      addEvidence: "补充证据",
      openTask: "查看任务",
      createTicket: "创建人工工单",
      close: "关闭",
      ticketDetail: "工单详情",
      taskDetail: "任务详情",
      ticketInfo: "工单信息",
      history: "处理历史",
      evidence: "证据",
      taskSnapshot: "关联任务快照",
      taskSteps: "任务步骤",
      keyMoments: "关键时间点",
      noHistory: "暂无历史记录",
      noEvidence: "暂无证据",
      noTask: "无关联任务",
      noTaskSteps: "无步骤数据",
      noMoments: "无关键时间点",
      claimConfirmTitle: "确认接单",
      claimConfirmBody: "将把工单 {id} 更新为“处理中”。",
      resolveConfirmTitle: "确认解决",
      resolveConfirmBody: "将把工单 {id} 更新为“已解决”。",
      evidencePrompt: "请输入补充证据说明：",
      handoffConfirmTitle: "创建人工工单",
      handoffConfirmBody: "将为任务 {id} 创建人工接管工单。",
      loadError: "加载运营看板失败：{msg}",
      claimSuccess: "工单 {id} 已转为处理中。",
      resolveSuccess: "工单 {id} 已标记为已解决。",
      evidenceSuccess: "工单 {id} 证据已补充。",
      handoffSuccess: "任务 {id} 已创建人工工单 {ticketId}。",
      handoffFailed: "创建工单失败：{msg}",
      liveClaimSuccess: "会话 {id} 已接入。",
      liveCloseSuccess: "会话 {id} 已关闭。",
      liveSendSuccess: "消息已发送到会话 {id}。",
      liveVoiceSuccess: "语音已发送到会话 {id}。",
      liveActionFailed: "会话操作失败：{msg}",
      copied: "已刷新",
      buildTag: "build:{id}",
      taskStatus_unknown: "未知",
      taskStatus_planned: "已规划",
      taskStatus_confirmed: "待执行",
      taskStatus_executing: "执行中",
      taskStatus_completed: "已完成",
      taskStatus_failed: "失败",
      taskStatus_canceled: "已取消",
      taskStatus_support: "人工处理中",
    },
    EN: {
      title: "Cross X Ops Console",
      subtitle: "Human intervention and ticket execution center",
      openUserApp: "Open User App",
      refresh: "Refresh",
      langLabel: "Lang",
      overviewHeading: "Human Intervention Overview",
      lastUpdated: "Last update: {time}",
      issuesHeading: "Issues Missing Ticket",
      liveSessionsHeading: "Live Session Queue",
      liveRoomHeading: "Live Agent Room",
      immediateHeading: "Immediate Supervision",
      pendingHeading: "Pending Tickets",
      activeHeading: "In Progress",
      resolvedHeading: "Resolved",
      total: "Total Tickets",
      immediate: "Immediate",
      pending: "Pending",
      inProgress: "In Progress",
      resolved: "Resolved",
      overdue: "Overdue Risk",
      issueCount: "Issues without ticket",
      firstResponse: "Avg first response (min)",
      resolveDuration: "Avg resolve (min)",
      emptyQueue: "No tickets in this queue",
      emptyIssue: "No issue requires manual ticket now",
      liveListEmpty: "No live sessions",
      liveRoomEmpty: "Pick a session and claim it.",
      liveOpenRoom: "Open Room",
      liveClaimSession: "Claim Session",
      liveCloseSession: "Close Session",
      liveVoiceReply: "Voice Reply",
      liveSend: "Send",
      liveInputPlaceholder: "Reply to the user in this room...",
      liveStatus_waiting: "Waiting",
      liveStatus_active: "Active",
      liveStatus_closed: "Closed",
      liveUnreadUser: "User unread",
      liveUnreadOps: "Ops unread",
      liveSession: "Session",
      liveTicket: "Ticket",
      liveAgent: "Agent",
      status_open: "Open",
      status_in_progress: "In progress",
      status_resolved: "Resolved",
      status_failed: "Failed",
      status_canceled: "Canceled",
      status_queued: "Queued",
      status_running: "Running",
      status_success: "Success",
      status_skipped: "Skipped",
      status_fallback_to_human: "Human fallback",
      priority_normal: "Normal",
      priority_high: "High",
      priority_critical: "Critical",
      taskLine: "Task: {taskId} · {status}",
      etaLine: "ETA left: {min} min",
      overdueLine: "Overdue by {min} min",
      updatedAt: "Updated",
      createdAt: "Created",
      source: "Source",
      reason: "Reason",
      handler: "Handler",
      city: "City",
      openDetail: "Open Detail",
      claim: "Claim",
      resolve: "Resolve",
      addEvidence: "Add Evidence",
      openTask: "Open Task",
      createTicket: "Create Handoff Ticket",
      close: "Close",
      ticketDetail: "Ticket Detail",
      taskDetail: "Task Detail",
      ticketInfo: "Ticket Info",
      history: "History",
      evidence: "Evidence",
      taskSnapshot: "Task Snapshot",
      taskSteps: "Task Steps",
      keyMoments: "Key Moments",
      noHistory: "No history yet",
      noEvidence: "No evidence yet",
      noTask: "No linked task",
      noTaskSteps: "No step data",
      noMoments: "No key moments",
      claimConfirmTitle: "Claim Ticket",
      claimConfirmBody: "Mark ticket {id} as in progress?",
      resolveConfirmTitle: "Resolve Ticket",
      resolveConfirmBody: "Mark ticket {id} as resolved?",
      evidencePrompt: "Add evidence note:",
      handoffConfirmTitle: "Create Handoff Ticket",
      handoffConfirmBody: "Create a human handoff ticket for task {id}?",
      loadError: "Failed to load ops board: {msg}",
      claimSuccess: "Ticket {id} moved to in progress.",
      resolveSuccess: "Ticket {id} marked as resolved.",
      evidenceSuccess: "Evidence added to ticket {id}.",
      handoffSuccess: "Task {id} handoff ticket {ticketId} created.",
      handoffFailed: "Create handoff failed: {msg}",
      liveClaimSuccess: "Session {id} claimed.",
      liveCloseSuccess: "Session {id} closed.",
      liveSendSuccess: "Message sent to session {id}.",
      liveVoiceSuccess: "Voice sent to session {id}.",
      liveActionFailed: "Live-room action failed: {msg}",
      copied: "Refreshed",
      buildTag: "build:{id}",
      taskStatus_unknown: "Unknown",
      taskStatus_planned: "Planned",
      taskStatus_confirmed: "Confirmed",
      taskStatus_executing: "Executing",
      taskStatus_completed: "Completed",
      taskStatus_failed: "Failed",
      taskStatus_canceled: "Canceled",
      taskStatus_support: "Support",
    },
    JA: {
      title: "Cross X Ops Console",
      subtitle: "有人監督とチケット運用センター",
      openUserApp: "ユーザー画面を開く",
      refresh: "更新",
      langLabel: "言語",
      overviewHeading: "有人介入サマリー",
      lastUpdated: "最終更新: {time}",
      issuesHeading: "チケット未作成の課題",
      liveSessionsHeading: "ライブ会話キュー",
      liveRoomHeading: "有人会話ルーム",
      immediateHeading: "即時対応",
      pendingHeading: "未対応",
      activeHeading: "対応中",
      resolvedHeading: "解決済み",
      total: "総チケット",
      immediate: "即時対応",
      pending: "未対応",
      inProgress: "対応中",
      resolved: "解決済み",
      overdue: "SLA超過",
      issueCount: "未チケット課題",
      firstResponse: "平均初動(分)",
      resolveDuration: "平均解決(分)",
      emptyQueue: "このキューにチケットはありません",
      emptyIssue: "現在、有人化が必要な課題はありません",
      liveListEmpty: "ライブ会話はありません",
      liveRoomEmpty: "会話を選択して接続してください。",
      liveOpenRoom: "会話を開く",
      liveClaimSession: "接続する",
      liveCloseSession: "会話を閉じる",
      liveVoiceReply: "音声返信",
      liveSend: "送信",
      liveInputPlaceholder: "ユーザーへ返信を入力...",
      liveStatus_waiting: "待機中",
      liveStatus_active: "対応中",
      liveStatus_closed: "終了",
      liveUnreadUser: "ユーザー未読",
      liveUnreadOps: "オペレーター未読",
      liveSession: "会話",
      liveTicket: "チケット",
      liveAgent: "担当",
      status_open: "未対応",
      status_in_progress: "対応中",
      status_resolved: "解決済み",
      status_failed: "失敗",
      status_canceled: "キャンセル",
      status_queued: "待機中",
      status_running: "実行中",
      status_success: "成功",
      status_skipped: "スキップ",
      status_fallback_to_human: "有人へ切替",
      priority_normal: "通常",
      priority_high: "高",
      priority_critical: "緊急",
      taskLine: "タスク: {taskId} · {status}",
      etaLine: "残り ETA: {min} 分",
      overdueLine: "{min} 分超過",
      updatedAt: "更新",
      createdAt: "作成",
      source: "ソース",
      reason: "理由",
      handler: "担当",
      city: "都市",
      openDetail: "詳細",
      claim: "対応開始",
      resolve: "解決済み",
      addEvidence: "証拠追加",
      openTask: "タスク確認",
      createTicket: "有人チケット作成",
      close: "閉じる",
      ticketDetail: "チケット詳細",
      taskDetail: "タスク詳細",
      ticketInfo: "チケット情報",
      history: "履歴",
      evidence: "証拠",
      taskSnapshot: "関連タスク概要",
      taskSteps: "タスクステップ",
      keyMoments: "主要イベント",
      noHistory: "履歴なし",
      noEvidence: "証拠なし",
      noTask: "関連タスクなし",
      noTaskSteps: "ステップデータなし",
      noMoments: "主要イベントなし",
      claimConfirmTitle: "対応開始",
      claimConfirmBody: "チケット {id} を対応中にしますか？",
      resolveConfirmTitle: "解決済みにする",
      resolveConfirmBody: "チケット {id} を解決済みにしますか？",
      evidencePrompt: "証拠メモを入力してください:",
      handoffConfirmTitle: "有人チケット作成",
      handoffConfirmBody: "タスク {id} に有人チケットを作成しますか？",
      loadError: "運用ボードの読込失敗: {msg}",
      claimSuccess: "チケット {id} を対応中に更新しました。",
      resolveSuccess: "チケット {id} を解決済みに更新しました。",
      evidenceSuccess: "チケット {id} に証拠を追加しました。",
      handoffSuccess: "タスク {id} にチケット {ticketId} を作成しました。",
      handoffFailed: "チケット作成失敗: {msg}",
      liveClaimSuccess: "会話 {id} に接続しました。",
      liveCloseSuccess: "会話 {id} を終了しました。",
      liveSendSuccess: "会話 {id} に送信しました。",
      liveVoiceSuccess: "音声を会話 {id} に送信しました。",
      liveActionFailed: "会話操作に失敗: {msg}",
      copied: "更新しました",
      buildTag: "build:{id}",
      taskStatus_unknown: "不明",
      taskStatus_planned: "計画済み",
      taskStatus_confirmed: "確認済み",
      taskStatus_executing: "実行中",
      taskStatus_completed: "完了",
      taskStatus_failed: "失敗",
      taskStatus_canceled: "キャンセル",
      taskStatus_support: "サポート中",
    },
    KO: {
      title: "Cross X Ops Console",
      subtitle: "사람 개입 및 티켓 운영 센터",
      openUserApp: "사용자 화면 열기",
      refresh: "새로고침",
      langLabel: "언어",
      overviewHeading: "사람 개입 요약",
      lastUpdated: "마지막 업데이트: {time}",
      issuesHeading: "티켓 없는 이슈",
      liveSessionsHeading: "실시간 상담 큐",
      liveRoomHeading: "상담 통화 공간",
      immediateHeading: "즉시 감독",
      pendingHeading: "대기 티켓",
      activeHeading: "처리중",
      resolvedHeading: "해결됨",
      total: "전체 티켓",
      immediate: "즉시 처리",
      pending: "대기",
      inProgress: "처리중",
      resolved: "해결됨",
      overdue: "SLA 초과",
      issueCount: "티켓 없는 이슈",
      firstResponse: "평균 첫 응답(분)",
      resolveDuration: "평균 해결(분)",
      emptyQueue: "이 큐에 티켓이 없습니다",
      emptyIssue: "현재 사람 티켓이 필요한 이슈가 없습니다",
      liveListEmpty: "실시간 상담이 없습니다",
      liveRoomEmpty: "세션을 선택하고 접속하세요.",
      liveOpenRoom: "상담 열기",
      liveClaimSession: "접속",
      liveCloseSession: "세션 종료",
      liveVoiceReply: "음성 답변",
      liveSend: "전송",
      liveInputPlaceholder: "프론트 사용자에게 답변 입력...",
      liveStatus_waiting: "대기중",
      liveStatus_active: "진행중",
      liveStatus_closed: "종료됨",
      liveUnreadUser: "사용자 미확인",
      liveUnreadOps: "상담원 미확인",
      liveSession: "세션",
      liveTicket: "티켓",
      liveAgent: "상담원",
      status_open: "대기",
      status_in_progress: "처리중",
      status_resolved: "해결됨",
      status_failed: "실패",
      status_canceled: "취소됨",
      status_queued: "대기중",
      status_running: "실행중",
      status_success: "성공",
      status_skipped: "건너뜀",
      status_fallback_to_human: "사람 전환",
      priority_normal: "일반",
      priority_high: "높음",
      priority_critical: "긴급",
      taskLine: "작업: {taskId} · {status}",
      etaLine: "남은 ETA: {min}분",
      overdueLine: "{min}분 초과",
      updatedAt: "업데이트",
      createdAt: "생성",
      source: "소스",
      reason: "사유",
      handler: "담당",
      city: "도시",
      openDetail: "상세",
      claim: "접수",
      resolve: "해결 처리",
      addEvidence: "증빙 추가",
      openTask: "작업 보기",
      createTicket: "사람 티켓 생성",
      close: "닫기",
      ticketDetail: "티켓 상세",
      taskDetail: "작업 상세",
      ticketInfo: "티켓 정보",
      history: "이력",
      evidence: "증빙",
      taskSnapshot: "연결 작업 요약",
      taskSteps: "작업 단계",
      keyMoments: "주요 시점",
      noHistory: "이력이 없습니다",
      noEvidence: "증빙이 없습니다",
      noTask: "연결 작업이 없습니다",
      noTaskSteps: "단계 데이터가 없습니다",
      noMoments: "주요 시점이 없습니다",
      claimConfirmTitle: "접수 처리",
      claimConfirmBody: "티켓 {id}를 처리중으로 변경할까요?",
      resolveConfirmTitle: "해결 처리",
      resolveConfirmBody: "티켓 {id}를 해결됨으로 변경할까요?",
      evidencePrompt: "증빙 메모를 입력하세요:",
      handoffConfirmTitle: "사람 티켓 생성",
      handoffConfirmBody: "작업 {id}에 사람 개입 티켓을 만들까요?",
      loadError: "운영 보드 로드 실패: {msg}",
      claimSuccess: "티켓 {id}가 처리중으로 변경되었습니다.",
      resolveSuccess: "티켓 {id}가 해결됨으로 변경되었습니다.",
      evidenceSuccess: "티켓 {id}에 증빙이 추가되었습니다.",
      handoffSuccess: "작업 {id}에 티켓 {ticketId}가 생성되었습니다.",
      handoffFailed: "티켓 생성 실패: {msg}",
      liveClaimSuccess: "세션 {id}에 접속했습니다.",
      liveCloseSuccess: "세션 {id}를 종료했습니다.",
      liveSendSuccess: "세션 {id}에 전송했습니다.",
      liveVoiceSuccess: "음성을 세션 {id}에 전송했습니다.",
      liveActionFailed: "세션 작업 실패: {msg}",
      copied: "갱신 완료",
      buildTag: "build:{id}",
      taskStatus_unknown: "알 수 없음",
      taskStatus_planned: "계획됨",
      taskStatus_confirmed: "확인됨",
      taskStatus_executing: "실행중",
      taskStatus_completed: "완료",
      taskStatus_failed: "실패",
      taskStatus_canceled: "취소됨",
      taskStatus_support: "지원중",
    },
  };

  const state = {
    language: "ZH",
    board: null,
    ticketsById: new Map(),
    liveSessions: [],
    refreshTicker: null,
    liveTicker: null,
    activeTicketId: "",
    activeTaskId: "",
    activeSessionId: "",
    activeSessionDetail: null,
    liveRecorder: null,
    liveStream: null,
    liveChunks: [],
    liveRecording: false,
    liveRecordingStartedAt: 0,
  };

  const el = {
    title: document.getElementById("opsTitle"),
    subtitle: document.getElementById("opsSubtitle"),
    openUserAppLink: document.getElementById("openUserAppLink"),
    refreshBtn: document.getElementById("opsRefreshBtn"),
    buildTag: document.getElementById("opsBuildTag"),
    langLabel: document.getElementById("opsLangLabel"),
    langSwitch: document.getElementById("opsLangSwitch"),
    overviewHeading: document.getElementById("overviewHeading"),
    lastUpdatedText: document.getElementById("lastUpdatedText"),
    issuesHeading: document.getElementById("issuesHeading"),
    immediateHeading: document.getElementById("immediateHeading"),
    pendingHeading: document.getElementById("pendingHeading"),
    activeHeading: document.getElementById("activeHeading"),
    resolvedHeading: document.getElementById("resolvedHeading"),
    summaryGrid: document.getElementById("opsSummaryGrid"),
    issuesCountBadge: document.getElementById("issuesCountBadge"),
    liveSessionsHeading: document.getElementById("liveSessionsHeading"),
    liveSessionsCountBadge: document.getElementById("liveSessionsCountBadge"),
    liveSessionsList: document.getElementById("liveSessionsList"),
    liveRoomHeading: document.getElementById("liveRoomHeading"),
    liveRoomStatusBadge: document.getElementById("liveRoomStatusBadge"),
    liveRoomMeta: document.getElementById("liveRoomMeta"),
    liveRoomMessages: document.getElementById("liveRoomMessages"),
    liveRoomForm: document.getElementById("liveRoomForm"),
    liveRoomInput: document.getElementById("liveRoomInput"),
    liveVoiceBtn: document.getElementById("liveVoiceBtn"),
    liveClaimBtn: document.getElementById("liveClaimBtn"),
    liveCloseBtn: document.getElementById("liveCloseBtn"),
    liveSendBtn: document.getElementById("liveSendBtn"),
    immediateCountBadge: document.getElementById("immediateCountBadge"),
    pendingCountBadge: document.getElementById("pendingCountBadge"),
    activeCountBadge: document.getElementById("activeCountBadge"),
    resolvedCountBadge: document.getElementById("resolvedCountBadge"),
    issuesList: document.getElementById("issuesList"),
    immediateList: document.getElementById("immediateList"),
    pendingList: document.getElementById("pendingList"),
    activeList: document.getElementById("activeList"),
    resolvedList: document.getElementById("resolvedList"),
    drawer: document.getElementById("opsDrawer"),
    drawerTitle: document.getElementById("opsDrawerTitle"),
    drawerBody: document.getElementById("opsDrawerBody"),
    closeDrawerBtn: document.getElementById("closeOpsDrawerBtn"),
  };

  function normalizeLanguage(language) {
    const raw = String(language || "").toUpperCase();
    if (raw.startsWith("ZH")) return "ZH";
    if (raw.startsWith("JA") || raw.startsWith("JP")) return "JA";
    if (raw.startsWith("KO")) return "KO";
    return "EN";
  }

  function t(key, vars) {
    const lang = LANG_TEXT[state.language] ? state.language : "EN";
    const template = LANG_TEXT[lang][key] || LANG_TEXT.EN[key] || key;
    if (!vars) return template;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : ""));
  }

  function localizeTaskStatus(status) {
    const key = `taskStatus_${String(status || "unknown").toLowerCase()}`;
    return t(key);
  }

  function localizeStatus(status) {
    return t(`status_${String(status || "").toLowerCase()}`);
  }

  function localizePriority(priority) {
    return t(`priority_${String(priority || "normal").toLowerCase()}`);
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatDateTime(iso) {
    if (!iso) return "-";
    const dt = new Date(iso);
    if (Number.isNaN(dt.getTime())) return "-";
    return dt.toLocaleString();
  }

  function asNumber(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }

  async function api(path, options) {
    const res = await fetch(path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = payload && payload.error ? payload.error : `HTTP ${res.status}`;
      throw new Error(message);
    }
    return payload;
  }

  function notify(message, type = "info") {
    if (toast) {
      toast.show({ message, type });
      return;
    }
    window.alert(message);
  }

  async function confirmAction(config) {
    if (modal) {
      return modal.confirm({
        title: config.title,
        body: config.body,
        confirmText: config.confirmText || t("claim"),
        cancelText: config.cancelText || t("close"),
        danger: config.danger === true,
      });
    }
    return window.confirm(`${config.title}\n${config.body}`);
  }

  function applyLanguagePack() {
    document.documentElement.lang = state.language.toLowerCase();
    if (el.title) el.title.textContent = t("title");
    if (el.subtitle) el.subtitle.textContent = t("subtitle");
    if (el.openUserAppLink) el.openUserAppLink.textContent = t("openUserApp");
    if (el.refreshBtn) el.refreshBtn.textContent = t("refresh");
    if (el.langLabel) el.langLabel.textContent = t("langLabel");
    if (el.overviewHeading) el.overviewHeading.textContent = t("overviewHeading");
    if (el.issuesHeading) el.issuesHeading.textContent = t("issuesHeading");
    if (el.liveSessionsHeading) el.liveSessionsHeading.textContent = t("liveSessionsHeading");
    if (el.liveRoomHeading) el.liveRoomHeading.textContent = t("liveRoomHeading");
    if (el.immediateHeading) el.immediateHeading.textContent = t("immediateHeading");
    if (el.pendingHeading) el.pendingHeading.textContent = t("pendingHeading");
    if (el.activeHeading) el.activeHeading.textContent = t("activeHeading");
    if (el.resolvedHeading) el.resolvedHeading.textContent = t("resolvedHeading");
    if (el.closeDrawerBtn) el.closeDrawerBtn.textContent = t("close");
    if (el.liveVoiceBtn) el.liveVoiceBtn.textContent = t("liveVoiceReply");
    if (el.liveClaimBtn) el.liveClaimBtn.textContent = t("liveClaimSession");
    if (el.liveCloseBtn) el.liveCloseBtn.textContent = t("liveCloseSession");
    if (el.liveSendBtn) el.liveSendBtn.textContent = t("liveSend");
    if (el.liveRoomInput) el.liveRoomInput.placeholder = t("liveInputPlaceholder");
  }

  function renderSummary() {
    if (!el.summaryGrid) return;
    const summary = state.board && state.board.summary ? state.board.summary : {};
    const stats = [
      { label: t("total"), value: asNumber(summary.total) },
      { label: t("immediate"), value: asNumber(summary.immediate) },
      { label: t("pending"), value: asNumber(summary.pending) },
      { label: t("inProgress"), value: asNumber(summary.inProgress) },
      { label: t("resolved"), value: asNumber(summary.resolved) },
      { label: t("overdue"), value: asNumber(summary.overdue) },
      { label: t("issueCount"), value: asNumber(summary.issuesWithoutTicket) },
      { label: t("firstResponse"), value: summary.avgFirstResponseMin !== null ? summary.avgFirstResponseMin : "-" },
      { label: t("resolveDuration"), value: summary.avgResolveMin !== null ? summary.avgResolveMin : "-" },
    ];
    el.summaryGrid.innerHTML = stats
      .map(
        (item) => `
          <article class="ops-kpi">
            <span class="label">${escapeHtml(item.label)}</span>
            <span class="value">${escapeHtml(item.value)}</span>
          </article>
        `,
      )
      .join("");
    motion.bindPressables(el.summaryGrid);
  }

  function buildTicketCard(ticket) {
    const task = ticket.task;
    const taskLine = task ? t("taskLine", { taskId: task.taskId, status: localizeTaskStatus(task.status) }) : t("noTask");
    const overdue = asNumber(ticket.overdueMin);
    const overdueLine = overdue > 0 ? `<span class="status-badge failed">${escapeHtml(t("overdueLine", { min: overdue }))}</span>` : "";
    return `
      <article class="ops-ticket priority-${escapeHtml(ticket.priority || "normal")}">
        <div class="ops-ticket-head">
          <span class="ops-ticket-id">${escapeHtml(ticket.id)}</span>
          <span class="priority-badge ${escapeHtml(ticket.priority || "normal")}">${escapeHtml(localizePriority(ticket.priority || "normal"))}</span>
        </div>
        <div class="ops-ticket-meta">
          <span class="status-badge ${escapeHtml(ticket.status || "open")}">${escapeHtml(localizeStatus(ticket.status || "open"))}</span>
          <span class="status">${escapeHtml(ticket.source || "-")}</span>
          <span class="status">${escapeHtml(t("etaLine", { min: asNumber(ticket.remainingEtaMin) }))}</span>
          ${overdueLine}
        </div>
        <div class="ops-ticket-title">${escapeHtml(ticket.reason || "-")}</div>
        <div class="status">${escapeHtml(taskLine)}</div>
        <div class="status">${escapeHtml(t("updatedAt"))}: ${escapeHtml(formatDateTime(ticket.updatedAt))}</div>
        <div class="actions">
          <button class="secondary" data-action="open-ticket" data-ticket="${escapeHtml(ticket.id)}">${escapeHtml(t("openDetail"))}</button>
          ${ticket.status === "open" ? `<button class="secondary" data-action="claim-ticket" data-ticket="${escapeHtml(ticket.id)}">${escapeHtml(t("claim"))}</button>` : ""}
          ${ticket.status === "in_progress" ? `<button class="secondary" data-action="resolve-ticket" data-ticket="${escapeHtml(ticket.id)}">${escapeHtml(t("resolve"))}</button>` : ""}
          <button class="secondary" data-action="open-live-session" data-session="${escapeHtml(ticket.sessionId || "")}" data-ticket="${escapeHtml(ticket.id)}">${escapeHtml(t("liveOpenRoom"))}</button>
          <button class="secondary" data-action="add-evidence" data-ticket="${escapeHtml(ticket.id)}">${escapeHtml(t("addEvidence"))}</button>
          ${task && task.taskId ? `<button class="secondary" data-action="open-task" data-task="${escapeHtml(task.taskId)}">${escapeHtml(t("openTask"))}</button>` : ""}
        </div>
      </article>
    `;
  }

  function buildIssueCard(issue) {
    return `
      <article class="issue-card">
        <div class="issue-card-head">
          <span class="code">${escapeHtml(issue.taskId)}</span>
          <span class="status-badge failed">${escapeHtml(localizeTaskStatus(issue.status || "failed"))}</span>
        </div>
        <div class="ops-ticket-title">${escapeHtml(issue.intent || "-")}</div>
        <div class="status">${escapeHtml(t("city"))}: ${escapeHtml(issue.city || "-")}</div>
        <div class="status">${escapeHtml(t("reason"))}: ${escapeHtml(issue.reason || "-")}</div>
        <div class="status">${escapeHtml(t("updatedAt"))}: ${escapeHtml(formatDateTime(issue.updatedAt))}</div>
        <div class="actions">
          <button class="secondary" data-action="create-handoff" data-task="${escapeHtml(issue.taskId)}">${escapeHtml(t("createTicket"))}</button>
          <button class="secondary" data-action="open-task" data-task="${escapeHtml(issue.taskId)}">${escapeHtml(t("openTask"))}</button>
        </div>
      </article>
    `;
  }

  function renderQueue(listEl, items, emptyText) {
    if (!listEl) return;
    if (!Array.isArray(items) || !items.length) {
      listEl.innerHTML = `<article class="ops-empty">${escapeHtml(emptyText || t("emptyQueue"))}</article>`;
      return;
    }
    listEl.innerHTML = items.map((ticket) => buildTicketCard(ticket)).join("");
    motion.bindPressables(listEl);
  }

  function renderIssues() {
    if (!el.issuesList) return;
    const issues = state.board && state.board.queues ? state.board.queues.issuesWithoutTicket || [] : [];
    if (el.issuesCountBadge) el.issuesCountBadge.textContent = String(issues.length);
    if (!issues.length) {
      el.issuesList.innerHTML = `<article class="ops-empty">${escapeHtml(t("emptyIssue"))}</article>`;
      return;
    }
    el.issuesList.innerHTML = issues.map((item) => buildIssueCard(item)).join("");
    motion.bindPressables(el.issuesList);
  }

  function renderBoard() {
    const queues = state.board && state.board.queues ? state.board.queues : {};
    const immediate = Array.isArray(queues.immediate) ? queues.immediate : [];
    const pending = Array.isArray(queues.pending) ? queues.pending : [];
    const active = Array.isArray(queues.inProgress) ? queues.inProgress : [];
    const resolved = Array.isArray(queues.resolved) ? queues.resolved : [];

    state.ticketsById = new Map([...immediate, ...pending, ...active, ...resolved].map((item) => [item.id, item]));

    if (el.immediateCountBadge) el.immediateCountBadge.textContent = String(immediate.length);
    if (el.pendingCountBadge) el.pendingCountBadge.textContent = String(pending.length);
    if (el.activeCountBadge) el.activeCountBadge.textContent = String(active.length);
    if (el.resolvedCountBadge) el.resolvedCountBadge.textContent = String(resolved.length);
    if (el.lastUpdatedText) el.lastUpdatedText.textContent = t("lastUpdated", { time: formatDateTime(state.board && state.board.generatedAt) });

    renderSummary();
    renderIssues();
    renderQueue(el.immediateList, immediate, t("emptyQueue"));
    renderQueue(el.pendingList, pending, t("emptyQueue"));
    renderQueue(el.activeList, active, t("emptyQueue"));
    renderQueue(el.resolvedList, resolved, t("emptyQueue"));
  }

  function localizeLiveStatus(status) {
    const key = `liveStatus_${String(status || "waiting").toLowerCase()}`;
    const value = t(key);
    return value === key ? String(status || "waiting") : value;
  }

  function renderLiveVoiceButton() {
    if (!el.liveVoiceBtn) return;
    const supported =
      typeof window.MediaRecorder !== "undefined" &&
      !!(navigator.mediaDevices && typeof navigator.mediaDevices.getUserMedia === "function");
    el.liveVoiceBtn.disabled = !supported;
    el.liveVoiceBtn.setAttribute("aria-pressed", state.liveRecording ? "true" : "false");
    if (!supported) {
      el.liveVoiceBtn.textContent = "Voice N/A";
      return;
    }
    el.liveVoiceBtn.textContent = state.liveRecording
      ? state.language === "ZH"
        ? "停止并发送"
        : state.language === "JA"
          ? "停止して送信"
          : state.language === "KO"
            ? "중지 후 전송"
            : "Stop & Send"
      : t("liveVoiceReply");
  }

  function renderLiveSessions() {
    if (!el.liveSessionsList) return;
    const sessions = Array.isArray(state.liveSessions) ? state.liveSessions : [];
    if (el.liveSessionsCountBadge) el.liveSessionsCountBadge.textContent = String(sessions.length);
    if (!sessions.length) {
      el.liveSessionsList.innerHTML = `<article class="ops-live-empty">${escapeHtml(t("liveListEmpty"))}</article>`;
      return;
    }
    el.liveSessionsList.innerHTML = sessions
      .map((session) => {
        const active = state.activeSessionId && state.activeSessionId === session.id;
        const unreadOps = Number((session.unread && session.unread.ops) || 0);
        const unreadUser = Number((session.unread && session.unread.user) || 0);
        const last = session.lastMessage || null;
        return `
          <article class="ops-live-session ${active ? "active" : ""}">
            <div class="ops-live-session-head">
              <span class="ops-live-session-id">${escapeHtml(session.id || "-")}</span>
              <span class="status-badge ${escapeHtml(session.status || "waiting")}">${escapeHtml(localizeLiveStatus(session.status || "waiting"))}</span>
            </div>
            <div class="status">${escapeHtml(t("liveTicket"))}: ${escapeHtml(session.ticketId || "-")} · ${escapeHtml(t("liveAgent"))}: ${escapeHtml(session.assignedAgentName || "-")}</div>
            <div class="status">${escapeHtml(t("liveUnreadOps"))}: ${unreadOps} · ${escapeHtml(t("liveUnreadUser"))}: ${unreadUser}</div>
            <div class="status">${last ? `${escapeHtml(last.actor || "-")} · ${escapeHtml(last.text || "")}` : "-"}</div>
            <div class="actions">
              <button class="secondary" data-action="open-live-session" data-session="${escapeHtml(session.id)}">${escapeHtml(t("liveOpenRoom"))}</button>
              <button class="secondary" data-action="claim-live-session" data-session="${escapeHtml(session.id)}">${escapeHtml(t("liveClaimSession"))}</button>
            </div>
          </article>
        `;
      })
      .join("");
    motion.bindPressables(el.liveSessionsList);
  }

  function renderLiveRoom() {
    if (!el.liveRoomMessages || !el.liveRoomMeta || !el.liveRoomStatusBadge) return;
    const detail = state.activeSessionDetail;
    if (!detail) {
      el.liveRoomStatusBadge.className = "status-badge queued";
      el.liveRoomStatusBadge.textContent = localizeLiveStatus("waiting");
      el.liveRoomMeta.textContent = t("liveRoomEmpty");
      el.liveRoomMessages.innerHTML = `<article class="ops-live-empty">${escapeHtml(t("liveRoomEmpty"))}</article>`;
      if (el.liveClaimBtn) el.liveClaimBtn.disabled = true;
      if (el.liveCloseBtn) el.liveCloseBtn.disabled = true;
      if (el.liveRoomForm) el.liveRoomForm.classList.add("is-disabled");
      if (el.liveSendBtn) el.liveSendBtn.disabled = true;
      if (el.liveRoomInput) el.liveRoomInput.disabled = true;
      renderLiveVoiceButton();
      return;
    }
    if (el.liveRoomForm) el.liveRoomForm.classList.remove("is-disabled");
    if (el.liveSendBtn) el.liveSendBtn.disabled = false;
    if (el.liveRoomInput) el.liveRoomInput.disabled = false;
    const session = detail.session || {};
    const ticket = detail.ticket || {};
    const badge = session.status === "active" ? "running" : session.status === "closed" ? "success" : "queued";
    el.liveRoomStatusBadge.className = `status-badge ${badge}`;
    el.liveRoomStatusBadge.textContent = localizeLiveStatus(session.status || "waiting");
    el.liveRoomMeta.textContent = `${t("liveSession")}: ${session.id || "-"} · ${t("liveTicket")}: ${ticket.id || session.ticketId || "-"} · ${t("liveAgent")}: ${
      session.assignedAgentName || "-"
    }`;
    if (el.liveClaimBtn) el.liveClaimBtn.disabled = session.status === "active";
    if (el.liveCloseBtn) el.liveCloseBtn.disabled = session.status === "closed";
    if (el.liveSendBtn) el.liveSendBtn.disabled = session.status === "closed";
    if (el.liveRoomInput) el.liveRoomInput.disabled = session.status === "closed";

    const messages = Array.isArray(session.messages) ? session.messages : [];
    if (!messages.length) {
      el.liveRoomMessages.innerHTML = `<article class="ops-live-empty">${escapeHtml(t("liveRoomEmpty"))}</article>`;
      return;
    }
    el.liveRoomMessages.innerHTML = messages
      .map((item) => {
        const actor = String(item.actor || "system");
        const role = actor === "user" ? "User" : actor === "ops" ? "Ops" : "System";
        const voice =
          item.type === "voice" && item.audioDataUrl
            ? `<audio controls preload="none" src="${escapeHtml(item.audioDataUrl)}"></audio><div class="status">${Number(item.durationSec || 0)}s</div>`
            : "";
        return `
          <article class="ops-live-msg ${escapeHtml(actor)}">
            <div class="ops-live-msg-head">
              <strong>${escapeHtml(role)}</strong>
              <span class="status">${escapeHtml(formatDateTime(item.at))}</span>
            </div>
            ${item.text ? `<div class="ops-live-text">${escapeHtml(item.text)}</div>` : ""}
            ${voice}
          </article>
        `;
      })
      .join("");
    el.liveRoomMessages.scrollTop = el.liveRoomMessages.scrollHeight;
    renderLiveVoiceButton();
  }

  function renderSkeleton() {
    if (skeleton) {
      if (el.summaryGrid) skeleton.render(el.summaryGrid, { count: 6, lines: 2 });
      if (el.issuesList) skeleton.render(el.issuesList, { count: 2, lines: 3 });
      if (el.immediateList) skeleton.render(el.immediateList, { count: 2, lines: 3 });
      if (el.pendingList) skeleton.render(el.pendingList, { count: 2, lines: 3 });
      if (el.activeList) skeleton.render(el.activeList, { count: 2, lines: 3 });
      if (el.resolvedList) skeleton.render(el.resolvedList, { count: 2, lines: 3 });
      return;
    }
    if (el.summaryGrid) el.summaryGrid.innerHTML = "";
    if (el.issuesList) el.issuesList.innerHTML = "";
    if (el.immediateList) el.immediateList.innerHTML = "";
    if (el.pendingList) el.pendingList.innerHTML = "";
    if (el.activeList) el.activeList.innerHTML = "";
    if (el.resolvedList) el.resolvedList.innerHTML = "";
  }

  async function loadBoard(showLoading = false) {
    if (showLoading) renderSkeleton();
    const [data, sessionsData] = await Promise.all([
      api("/api/support/ops-board?limit=120"),
      api("/api/support/sessions?actor=ops&status=waiting,active,closed&limit=120"),
    ]);
    state.board = data;
    state.liveSessions = Array.isArray(sessionsData.sessions) ? sessionsData.sessions : [];
    renderBoard();
    renderLiveSessions();
    renderLiveVoiceButton();
    if (state.activeTicketId) {
      const exists = state.ticketsById.get(state.activeTicketId);
      if (exists && el.drawer && drawerController && drawerController.isOpen(el.drawer)) {
        await openTicketDrawer(state.activeTicketId);
      }
    }
    if (state.activeSessionId) {
      const existsSession = state.liveSessions.find((item) => item.id === state.activeSessionId);
      if (existsSession) {
        await loadLiveSession(state.activeSessionId, false).catch(() => {});
      } else {
        state.activeSessionId = "";
        state.activeSessionDetail = null;
        renderLiveRoom();
      }
    } else {
      renderLiveRoom();
    }
  }

  async function loadBuild() {
    try {
      const data = await api("/api/system/build");
      if (el.buildTag) el.buildTag.textContent = t("buildTag", { id: data.buildId || "-" });
    } catch {
      if (el.buildTag) el.buildTag.textContent = t("buildTag", { id: "-" });
    }
  }

  async function bootstrapLanguage() {
    try {
      const userData = await api("/api/user");
      state.language = normalizeLanguage(userData && userData.user ? userData.user.language : "ZH");
    } catch {
      state.language = "ZH";
    }
    if (el.langSwitch) el.langSwitch.value = state.language;
    applyLanguagePack();
  }

  async function updateTicketStatus(ticketId, nextStatus) {
    const isClaim = nextStatus === "in_progress";
    const ok = await confirmAction({
      title: isClaim ? t("claimConfirmTitle") : t("resolveConfirmTitle"),
      body: isClaim ? t("claimConfirmBody", { id: ticketId }) : t("resolveConfirmBody", { id: ticketId }),
      confirmText: isClaim ? t("claim") : t("resolve"),
    });
    if (!ok) return;
    await api(`/api/support/tickets/${encodeURIComponent(ticketId)}/status`, {
      method: "POST",
      body: JSON.stringify({ status: nextStatus }),
    });
    notify(nextStatus === "in_progress" ? t("claimSuccess", { id: ticketId }) : t("resolveSuccess", { id: ticketId }), "success");
    await loadBoard(false);
  }

  async function addEvidence(ticketId) {
    const note = window.prompt(t("evidencePrompt"), "");
    if (note === null) return;
    await api(`/api/support/tickets/${encodeURIComponent(ticketId)}/evidence`, {
      method: "POST",
      body: JSON.stringify({
        type: "ops_note",
        note: String(note).slice(0, 240),
      }),
    });
    notify(t("evidenceSuccess", { id: ticketId }), "success");
    await loadBoard(false);
    if (state.activeTicketId === ticketId && el.drawer && drawerController && drawerController.isOpen(el.drawer)) {
      await openTicketDrawer(ticketId);
    }
  }

  async function createHandoff(taskId) {
    const ok = await confirmAction({
      title: t("handoffConfirmTitle"),
      body: t("handoffConfirmBody", { id: taskId }),
      confirmText: t("createTicket"),
    });
    if (!ok) return;
    try {
      const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/handoff`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Idempotency-Key": `ops-handoff-${taskId}`,
        },
        body: JSON.stringify({ reason: "ops_board_manual_supervision" }),
      });
      const ticketId = data && data.handoff ? data.handoff.ticketId : "-";
      notify(t("handoffSuccess", { id: taskId, ticketId }), "success");
      await loadBoard(false);
      if (ticketId && ticketId !== "-") {
        await openTicketDrawer(ticketId);
      }
    } catch (err) {
      notify(t("handoffFailed", { msg: err.message }), "error");
    }
  }

  async function fetchTicketById(ticketId) {
    const fromState = state.ticketsById.get(ticketId);
    const data = await api("/api/support/tickets");
    const fromList = Array.isArray(data.tickets) ? data.tickets.find((ticket) => ticket.id === ticketId) : null;
    if (fromList) return { ...fromState, ...fromList };
    return fromState || null;
  }

  async function fetchTaskDetail(taskId) {
    if (!taskId) return null;
    const data = await api(`/api/tasks/${encodeURIComponent(taskId)}/detail`);
    return data && data.detail ? data.detail : null;
  }

  async function loadLiveSession(sessionId, markRead = true) {
    if (!sessionId) return null;
    const data = await api(`/api/support/sessions/${encodeURIComponent(sessionId)}?actor=ops`);
    const session = data && data.session ? data.session : null;
    const ticket = data && data.ticket ? data.ticket : null;
    if (markRead) {
      await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/read`, {
        method: "POST",
        body: JSON.stringify({ actor: "ops" }),
      }).catch(() => {});
      if (session && session.unread) session.unread.ops = 0;
    }
    state.activeSessionId = sessionId;
    state.activeSessionDetail = { session, ticket };
    renderLiveRoom();
    return state.activeSessionDetail;
  }

  async function claimLiveSession(sessionId) {
    if (!sessionId) return;
    await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/claim`, {
      method: "POST",
      body: JSON.stringify({
        agentId: "ops_agent",
        agentName: "Cross X Ops",
      }),
    });
    notify(t("liveClaimSuccess", { id: sessionId }), "success");
    await loadBoard(false);
    await loadLiveSession(sessionId, true).catch(() => {});
  }

  async function closeLiveSession(sessionId) {
    if (!sessionId) return;
    await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/close`, {
      method: "POST",
      body: JSON.stringify({
        actor: "ops",
        resolveTicket: true,
        note: "Closed by ops console",
      }),
    });
    notify(t("liveCloseSuccess", { id: sessionId }), "success");
    await loadBoard(false);
    await loadLiveSession(sessionId, true).catch(() => {});
  }

  async function sendLiveTextMessage(text) {
    const sessionId = state.activeSessionId;
    if (!sessionId) return;
    await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/messages`, {
      method: "POST",
      body: JSON.stringify({
        actor: "ops",
        type: "text",
        text: String(text || "").slice(0, 600),
        agentName: "Cross X Ops",
      }),
    });
    notify(t("liveSendSuccess", { id: sessionId }), "success");
    await loadBoard(false);
    await loadLiveSession(sessionId, true).catch(() => {});
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("audio read failed"));
      reader.readAsDataURL(blob);
    });
  }

  async function toggleLiveVoiceReply() {
    const sessionId = state.activeSessionId;
    if (!sessionId) {
      notify(t("liveRoomEmpty"), "warning");
      return;
    }
    if (state.liveRecording && state.liveRecorder) {
      try {
        state.liveRecorder.stop();
      } catch {
        // ignore
      }
      return;
    }
    if (typeof window.MediaRecorder === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
      notify("Voice capture is not supported.", "warning");
      return;
    }
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    state.liveStream = stream;
    state.liveRecorder = recorder;
    state.liveChunks = [];
    state.liveRecording = true;
    state.liveRecordingStartedAt = Date.now();
    renderLiveVoiceButton();

    recorder.ondataavailable = (event) => {
      if (event && event.data && event.data.size > 0) state.liveChunks.push(event.data);
    };
    recorder.onstop = async () => {
      try {
        const blob = new Blob(state.liveChunks, { type: recorder.mimeType || "audio/webm" });
        const audioDataUrl = await blobToDataUrl(blob);
        const durationSec = Math.max(1, Math.round((Date.now() - state.liveRecordingStartedAt) / 1000));
        await api(`/api/support/sessions/${encodeURIComponent(sessionId)}/messages`, {
          method: "POST",
          body: JSON.stringify({
            actor: "ops",
            type: "voice",
            audioDataUrl,
            durationSec,
            agentName: "Cross X Ops",
          }),
        });
        notify(t("liveVoiceSuccess", { id: sessionId }), "success");
        await loadBoard(false);
        await loadLiveSession(sessionId, true).catch(() => {});
      } catch (err) {
        notify(t("liveActionFailed", { msg: err.message }), "error");
      } finally {
        if (state.liveStream) {
          state.liveStream.getTracks().forEach((track) => track.stop());
        }
        state.liveStream = null;
        state.liveRecorder = null;
        state.liveChunks = [];
        state.liveRecording = false;
        state.liveRecordingStartedAt = 0;
        renderLiveVoiceButton();
      }
    };
    recorder.start();
    renderLiveVoiceButton();
  }

  function buildTicketInfoBlock(ticket) {
    const lines = [
      `<div class="drawer-line">${escapeHtml(t("reason"))}: ${escapeHtml(ticket.reason || "-")}</div>`,
      `<div class="drawer-line">${escapeHtml(t("source"))}: ${escapeHtml(ticket.source || "-")}</div>`,
      `<div class="drawer-line">${escapeHtml(t("handler"))}: ${escapeHtml(ticket.handler || "-")}</div>`,
      `<div class="drawer-line">${escapeHtml(t("createdAt"))}: ${escapeHtml(formatDateTime(ticket.createdAt))}</div>`,
      `<div class="drawer-line">${escapeHtml(t("updatedAt"))}: ${escapeHtml(formatDateTime(ticket.updatedAt))}</div>`,
      `<div class="drawer-line">${escapeHtml(t("etaLine", { min: asNumber(ticket.etaMin) }))}</div>`,
      `<div class="drawer-line">${escapeHtml(t("liveSession"))}: ${escapeHtml(ticket.sessionId || "-")}</div>`,
    ];
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(t("ticketInfo"))}</h4>
        <div class="drawer-lines">${lines.join("")}</div>
        <div class="actions">
          <button class="secondary" data-action="open-live-session" data-session="${escapeHtml(ticket.sessionId || "")}" data-ticket="${escapeHtml(ticket.id)}">${escapeHtml(t("liveOpenRoom"))}</button>
        </div>
      </section>
    `;
  }

  function buildHistoryBlock(ticket) {
    const history = Array.isArray(ticket.history) ? ticket.history : [];
    if (!history.length) {
      return `
        <section class="drawer-block">
          <h4>${escapeHtml(t("history"))}</h4>
          <div class="drawer-line">${escapeHtml(t("noHistory"))}</div>
        </section>
      `;
    }
    const list = history
      .map(
        (item) =>
          `<li>${escapeHtml(formatDateTime(item.at))} · <span class="status-badge ${escapeHtml(item.status || "open")}">${escapeHtml(localizeStatus(item.status || "open"))}</span> · ${escapeHtml(item.note || "-")}</li>`,
      )
      .join("");
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(t("history"))}</h4>
        <ol class="drawer-steps">${list}</ol>
      </section>
    `;
  }

  function buildEvidenceBlock(ticket) {
    const evidence = Array.isArray(ticket.evidence) ? ticket.evidence : [];
    if (!evidence.length) {
      return `
        <section class="drawer-block">
          <h4>${escapeHtml(t("evidence"))}</h4>
          <div class="drawer-line">${escapeHtml(t("noEvidence"))}</div>
        </section>
      `;
    }
    const list = evidence
      .map(
        (item) =>
          `<li>${escapeHtml(formatDateTime(item.at))} · ${escapeHtml(item.type || "note")} · ${escapeHtml(item.note || "-")} · ${escapeHtml(item.hash || "-")}</li>`,
      )
      .join("");
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(t("evidence"))}</h4>
        <ol class="drawer-steps">${list}</ol>
      </section>
    `;
  }

  function buildTaskBlock(taskDetail) {
    if (!taskDetail || !taskDetail.overview) {
      return `
        <section class="drawer-block">
          <h4>${escapeHtml(t("taskSnapshot"))}</h4>
          <div class="drawer-line">${escapeHtml(t("noTask"))}</div>
        </section>
      `;
    }
    const overview = taskDetail.overview;
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(t("taskSnapshot"))}</h4>
        <div class="drawer-lines">
          <div class="drawer-line">${escapeHtml(t("taskLine", { taskId: overview.taskId, status: localizeTaskStatus(overview.status) }))}</div>
          <div class="drawer-line">${escapeHtml(t("reason"))}: ${escapeHtml(overview.intent || "-")}</div>
          <div class="drawer-line">${escapeHtml(t("city"))}: ${escapeHtml((taskDetail.sessionState && taskDetail.sessionState.slots && taskDetail.sessionState.slots.city) || "-")}</div>
          <div class="drawer-line">Lane: ${escapeHtml(overview.laneId || "-")} · Rail: ${escapeHtml(overview.paymentRail || "-")}</div>
        </div>
      </section>
    `;
  }

  function buildTaskStepsBlock(taskDetail) {
    const steps = taskDetail && Array.isArray(taskDetail.steps) ? taskDetail.steps : [];
    if (!steps.length) {
      return `
        <section class="drawer-block">
          <h4>${escapeHtml(t("taskSteps"))}</h4>
          <div class="drawer-line">${escapeHtml(t("noTaskSteps"))}</div>
        </section>
      `;
    }
    const list = steps
      .map(
        (step) =>
          `<li><span class="status-badge ${escapeHtml(step.status || "queued")}">${escapeHtml(localizeStatus(step.status || "queued"))}</span> ${escapeHtml(step.label || step.id || "-")} · ${escapeHtml(step.outputSummary || "-")}</li>`,
      )
      .join("");
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(t("taskSteps"))}</h4>
        <ol class="drawer-steps">${list}</ol>
      </section>
    `;
  }

  function buildTaskMomentsBlock(taskDetail) {
    const points = taskDetail && Array.isArray(taskDetail.keyMoments) ? taskDetail.keyMoments : [];
    if (!points.length) {
      return `
        <section class="drawer-block">
          <h4>${escapeHtml(t("keyMoments"))}</h4>
          <div class="drawer-line">${escapeHtml(t("noMoments"))}</div>
        </section>
      `;
    }
    const list = points
      .map((point) => `<li>${escapeHtml(formatDateTime(point.at))} · ${escapeHtml(point.kind || "-")} · ${escapeHtml(point.note || "-")}</li>`)
      .join("");
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(t("keyMoments"))}</h4>
        <ol class="drawer-steps">${list}</ol>
      </section>
    `;
  }

  async function openTaskDrawer(taskId, trigger) {
    if (!taskId || !el.drawer || !el.drawerBody) return;
    state.activeTaskId = taskId;
    state.activeTicketId = "";
    if (el.drawerTitle) el.drawerTitle.textContent = `${t("taskDetail")} · ${taskId}`;
    el.drawerBody.innerHTML = skeleton ? skeleton.card(4) : `<article class="ops-empty">${escapeHtml(t("refresh"))}...</article>`;
    if (drawerController) {
      await drawerController.open(el.drawer, { trigger: trigger || null });
    } else {
      el.drawer.classList.remove("hidden");
      el.drawer.setAttribute("aria-hidden", "false");
    }
    try {
      const detail = await fetchTaskDetail(taskId);
      el.drawerBody.innerHTML = `
        <div class="drawer-grid">
          ${buildTaskBlock(detail)}
          ${buildTaskStepsBlock(detail)}
          ${buildTaskMomentsBlock(detail)}
        </div>
      `;
      motion.bindPressables(el.drawerBody);
    } catch (err) {
      el.drawerBody.innerHTML = `<article class="ops-empty">${escapeHtml(t("loadError", { msg: err.message }))}</article>`;
    }
  }

  async function openTicketDrawer(ticketId, trigger) {
    if (!ticketId || !el.drawer || !el.drawerBody) return;
    state.activeTicketId = ticketId;
    state.activeTaskId = "";
    if (el.drawerTitle) el.drawerTitle.textContent = `${t("ticketDetail")} · ${ticketId}`;
    el.drawerBody.innerHTML = skeleton ? skeleton.card(4) : `<article class="ops-empty">${escapeHtml(t("refresh"))}...</article>`;
    if (drawerController) {
      await drawerController.open(el.drawer, { trigger: trigger || null });
    } else {
      el.drawer.classList.remove("hidden");
      el.drawer.setAttribute("aria-hidden", "false");
    }
    try {
      const ticket = await fetchTicketById(ticketId);
      if (!ticket) {
        el.drawerBody.innerHTML = `<article class="ops-empty">${escapeHtml(t("ticketDetail"))}: ${escapeHtml(ticketId)} not found</article>`;
        return;
      }
      const taskDetail = ticket.taskId ? await fetchTaskDetail(ticket.taskId).catch(() => null) : null;
      el.drawerBody.innerHTML = `
        <div class="drawer-grid">
          ${buildTicketInfoBlock(ticket)}
          ${buildHistoryBlock(ticket)}
          ${buildEvidenceBlock(ticket)}
          ${buildTaskBlock(taskDetail)}
          ${buildTaskStepsBlock(taskDetail)}
          ${buildTaskMomentsBlock(taskDetail)}
        </div>
      `;
      motion.bindPressables(el.drawerBody);
    } catch (err) {
      el.drawerBody.innerHTML = `<article class="ops-empty">${escapeHtml(t("loadError", { msg: err.message }))}</article>`;
    }
  }

  function bindEvents() {
    if (el.langSwitch) {
      el.langSwitch.addEventListener("change", () => {
        state.language = normalizeLanguage(el.langSwitch.value || "ZH");
        applyLanguagePack();
        renderBoard();
        renderLiveSessions();
        renderLiveRoom();
        renderLiveVoiceButton();
        if (state.activeTicketId && drawerController && el.drawer && drawerController.isOpen(el.drawer)) {
          openTicketDrawer(state.activeTicketId);
        } else if (state.activeTaskId && drawerController && el.drawer && drawerController.isOpen(el.drawer)) {
          openTaskDrawer(state.activeTaskId);
        }
      });
    }

    if (el.refreshBtn) {
      el.refreshBtn.addEventListener("click", async () => {
        el.refreshBtn.disabled = true;
        try {
          await loadBoard(false);
          notify(t("copied"), "success");
        } catch (err) {
          notify(t("loadError", { msg: err.message }), "error");
        } finally {
          el.refreshBtn.disabled = false;
        }
      });
    }

    if (el.liveRoomForm && el.liveRoomInput) {
      el.liveRoomForm.addEventListener("submit", async (event) => {
        event.preventDefault();
        const text = String(el.liveRoomInput.value || "").trim();
        if (!text || !state.activeSessionId) return;
        try {
          if (el.liveSendBtn) el.liveSendBtn.disabled = true;
          await sendLiveTextMessage(text);
          el.liveRoomInput.value = "";
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        } finally {
          if (el.liveSendBtn) el.liveSendBtn.disabled = false;
        }
      });
      if (el.liveRoomInput instanceof HTMLTextAreaElement) {
        el.liveRoomInput.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" || event.shiftKey || event.isComposing) return;
          event.preventDefault();
          if (typeof el.liveRoomForm.requestSubmit === "function") el.liveRoomForm.requestSubmit();
          else el.liveRoomForm.dispatchEvent(new Event("submit", { cancelable: true, bubbles: true }));
        });
      }
    }

    document.body.addEventListener("click", async (event) => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      const action = target.dataset.action;
      if (!action) return;

      if (action === "close-ops-drawer") {
        if (drawerController && el.drawer) {
          await drawerController.close(el.drawer);
        } else if (el.drawer) {
          el.drawer.classList.add("hidden");
          el.drawer.setAttribute("aria-hidden", "true");
        }
        state.activeTicketId = "";
        state.activeTaskId = "";
        return;
      }

      if (action === "ops-live-voice") {
        try {
          await toggleLiveVoiceReply();
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        }
        return;
      }

      if (action === "ops-live-claim") {
        try {
          await claimLiveSession(state.activeSessionId || "");
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        }
        return;
      }

      if (action === "ops-live-close") {
        try {
          await closeLiveSession(state.activeSessionId || "");
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        }
        return;
      }

      if (action === "open-live-session") {
        let sessionId = target.dataset.session || "";
        const ticketId = target.dataset.ticket || "";
        try {
          if (!sessionId && ticketId) {
            const start = await api("/api/support/sessions/start", {
              method: "POST",
              body: JSON.stringify({
                ticketId,
                actor: "ops",
                reason: "ops_open_live_room",
              }),
            });
            sessionId = start && start.session ? start.session.id : "";
          }
          if (!sessionId) {
            notify(t("liveActionFailed", { msg: "session missing" }), "error");
            return;
          }
          await loadLiveSession(sessionId, true);
          await loadBoard(false);
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        }
        return;
      }

      if (action === "claim-live-session") {
        const sessionId = target.dataset.session || state.activeSessionId || "";
        if (!sessionId) return;
        try {
          await claimLiveSession(sessionId);
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        }
        return;
      }

      if (action === "close-live-session") {
        const sessionId = target.dataset.session || state.activeSessionId || "";
        if (!sessionId) return;
        try {
          await closeLiveSession(sessionId);
        } catch (err) {
          notify(t("liveActionFailed", { msg: err.message }), "error");
        }
        return;
      }

      if (action === "open-ticket") {
        const ticketId = target.dataset.ticket || "";
        if (!ticketId) return;
        await openTicketDrawer(ticketId, target);
        return;
      }

      if (action === "open-task") {
        const taskId = target.dataset.task || "";
        if (!taskId) return;
        await openTaskDrawer(taskId, target);
        return;
      }

      if (action === "claim-ticket") {
        const ticketId = target.dataset.ticket || "";
        if (!ticketId) return;
        await updateTicketStatus(ticketId, "in_progress");
        if (state.activeTicketId === ticketId && el.drawer && drawerController && drawerController.isOpen(el.drawer)) {
          await openTicketDrawer(ticketId);
        }
        return;
      }

      if (action === "resolve-ticket") {
        const ticketId = target.dataset.ticket || "";
        if (!ticketId) return;
        await updateTicketStatus(ticketId, "resolved");
        if (state.activeTicketId === ticketId && el.drawer && drawerController && drawerController.isOpen(el.drawer)) {
          await openTicketDrawer(ticketId);
        }
        return;
      }

      if (action === "add-evidence") {
        const ticketId = target.dataset.ticket || "";
        if (!ticketId) return;
        await addEvidence(ticketId);
        return;
      }

      if (action === "create-handoff") {
        const taskId = target.dataset.task || "";
        if (!taskId) return;
        await createHandoff(taskId);
      }
    });
  }

  async function init() {
    await bootstrapLanguage();
    await loadBuild();
    bindEvents();
    motion.bindPressables(document);
    try {
      await loadBoard(true);
    } catch (err) {
      notify(t("loadError", { msg: err.message }), "error");
    }
    if (state.refreshTicker) clearInterval(state.refreshTicker);
    state.refreshTicker = setInterval(() => {
      loadBoard(false).catch(() => {});
    }, Math.max(12000, motion.safeDuration(15000)));
    window.addEventListener("beforeunload", () => {
      if (state.refreshTicker) clearInterval(state.refreshTicker);
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }

  window.CrossXOps = {
    version: ASSET_VERSION,
    refresh() {
      return loadBoard(false);
    },
  };
})();
