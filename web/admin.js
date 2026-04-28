// Admin console entrypoint. This surface is for internal operations staff rather
// than end users, so the file mixes dashboard metrics, manual intervention queues,
// privacy/security controls, and live support tooling in one browser runtime.
(function createCrossXOpsConsole() {
  const ASSET_VERSION = "20260327-5";

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
      analyticsHeading: "业务指标",
      kpiClosedLoop: "闭环完成率",
      kpiTasks: "总任务",
      kpiCompleted: "已完成",
      kpiFailed: "失败",
      kpiOrders: "总订单",
      kpiSupportTickets: "支持工单",
      kpiMcpSla: "MCP 合规率",
      kpiMcpCalls: "MCP 总调用",
      funnelLabel: "转化漏斗",
      funnelIntent: "意图提交",
      funnelPlanned: "规划完成",
      funnelConfirmed: "已确认",
      funnelPaid: "已支付",
      funnelDelivered: "已交付",
      revHeading: "收入总览 (CNY)",
      revGross: "总收入",
      revNet: "净收入",
      revMarkup: "加价收益",
      revRefunds: "退款",
      revOrders: "付款订单",
      usersHeading: "用户管理",
      usersSearchPlaceholder: "搜索用户名 / ID",
      usersTotal: "共 {total} 用户",
      usersLoadMore: "加载更多",
      dataQualityHeading: "数据源质量",
      dataQualityUsers: "用户总数",
      dataQualityTrips: "行程规划",
      dataQualitySessions: "支持会话",
      dataQualityAuditLogs: "审计日志",
      dataQualityGrossRevenue: "总毛收入 ¥",
      dataQualityRefunded: "退款 ¥",
      dataQualityPlusUsers: "Plus 用户",
      dataQualityTaskStatus: "任务状态分布",
      dataQualityOrderStatus: "订单状态分布",
      kbHeading: "知识库管理",
      kbCityPlaceholder: "城市（如 北京）",
      kbSearch: "查询",
      kbAttractionCount: "景点总数",
      kbLastUpdated: "最后更新",
      securityHeading: "安全健康",
      securityEncryption: "加密写入",
      securityConsent: "同意策略",
      securityHttps: "HTTPS",
      securityAdminAllowlist: "管理 IP 白名单",
      securitySessionStore: "会话持久化",
      securityPendingRequests: "待处理隐私请求",
      securitySlaBreaches: "GDPR SLA 超时",
      securityReady: "就绪",
      securityBlocked: "阻断",
      securityStrict: "严格",
      securitySoft: "宽松",
      securityEnabled: "已启用",
      securityMissing: "缺失",
      securityErrors: "阻断项",
      securityWarnings: "警告项",
      securityNoIssues: "当前没有阻断项或警告项。",
      privacyQueueHeading: "隐私请求队列",
      privacyQueueTotal: "总请求",
      privacyQueuePending: "待确认",
      privacyQueueAcknowledged: "已确认",
      privacyQueueScheduled: "已排期",
      privacyQueueCompleted: "已完成",
      privacyQueueRejected: "已拒绝",
      privacyQueueLegalHold: "法务保留",
      privacyQueueEmpty: "当前没有隐私请求。",
      privacyRequestType: "类型",
      privacyRequestStatus: "状态",
      privacyRequestDeadline: "截止时间",
      privacyRequestAck: "确认受理",
      privacyRequestReject: "拒绝请求",
      privacyRequestLegalHold: "法务保留",
      privacyRequestAckSuccess: "隐私请求 {id} 已确认受理。",
      privacyRequestRejectSuccess: "隐私请求 {id} 已标记为拒绝。",
      privacyRequestLegalHoldSuccess: "隐私请求 {id} 已转为法务保留。",
      privacyRequestAckPrompt: "请输入处理备注（可选）：",
      privacyRequestRejectPrompt: "请输入拒绝备注（可选）：",
      privacyRequestLegalHoldPrompt: "请输入法务保留说明（可选）：",
      privacyTypeErase: "删除",
      privacyTypeRestrict: "限制处理",
      privacyStatusPending: "待确认",
      privacyStatusAcknowledged: "已确认",
      privacyStatusScheduled: "已排期",
      privacyStatusCompleted: "已完成",
      privacyStatusRejected: "已拒绝",
      privacyStatusLegalHold: "法务保留",
      privacyStatusError: "异常",
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
      analyticsHeading: "Business KPIs",
      kpiClosedLoop: "Closed-loop Rate",
      kpiTasks: "Total Tasks",
      kpiCompleted: "Completed",
      kpiFailed: "Failed",
      kpiOrders: "Total Orders",
      kpiSupportTickets: "Support Tickets",
      kpiMcpSla: "MCP SLA Rate",
      kpiMcpCalls: "MCP Total Calls",
      funnelLabel: "Conversion Funnel",
      funnelIntent: "Intent",
      funnelPlanned: "Planned",
      funnelConfirmed: "Confirmed",
      funnelPaid: "Paid",
      funnelDelivered: "Delivered",
      revHeading: "Revenue Summary (CNY)",
      revGross: "Gross",
      revNet: "Net",
      revMarkup: "Markup",
      revRefunds: "Refunds",
      revOrders: "Paid Orders",
      usersHeading: "User Management",
      usersSearchPlaceholder: "Search by name / ID",
      usersTotal: "{total} users",
      usersLoadMore: "Load more",
      dataQualityHeading: "Data Source Quality",
      dataQualityUsers: "Total Users",
      dataQualityTrips: "Trip Plans",
      dataQualitySessions: "Support Sessions",
      dataQualityAuditLogs: "Audit Logs",
      dataQualityGrossRevenue: "Gross Revenue ¥",
      dataQualityRefunded: "Refunded ¥",
      dataQualityPlusUsers: "Plus Users",
      dataQualityTaskStatus: "Task Status Distribution",
      dataQualityOrderStatus: "Order Status Distribution",
      kbHeading: "Knowledge Base",
      kbCityPlaceholder: "City (e.g. Beijing)",
      kbSearch: "Search",
      kbAttractionCount: "Attractions",
      kbLastUpdated: "Last updated",
      securityHeading: "Security Health",
      securityEncryption: "Encrypted writes",
      securityConsent: "Consent policy",
      securityHttps: "HTTPS",
      securityAdminAllowlist: "Admin IP allowlist",
      securitySessionStore: "Session persistence",
      securityPendingRequests: "Pending privacy requests",
      securitySlaBreaches: "GDPR SLA breaches",
      securityReady: "Ready",
      securityBlocked: "Blocked",
      securityStrict: "Strict",
      securitySoft: "Soft",
      securityEnabled: "Enabled",
      securityMissing: "Missing",
      securityErrors: "Blocking issues",
      securityWarnings: "Warnings",
      securityNoIssues: "No blocking issues or warnings.",
      privacyQueueHeading: "Privacy Request Queue",
      privacyQueueTotal: "Total requests",
      privacyQueuePending: "Pending",
      privacyQueueAcknowledged: "Acknowledged",
      privacyQueueScheduled: "Scheduled",
      privacyQueueCompleted: "Completed",
      privacyQueueRejected: "Rejected",
      privacyQueueLegalHold: "Legal hold",
      privacyQueueEmpty: "No privacy requests right now.",
      privacyRequestType: "Type",
      privacyRequestStatus: "Status",
      privacyRequestDeadline: "Deadline",
      privacyRequestAck: "Acknowledge",
      privacyRequestReject: "Reject",
      privacyRequestLegalHold: "Legal hold",
      privacyRequestAckSuccess: "Privacy request {id} has been acknowledged.",
      privacyRequestRejectSuccess: "Privacy request {id} has been rejected.",
      privacyRequestLegalHoldSuccess: "Privacy request {id} has been placed on legal hold.",
      privacyRequestAckPrompt: "Add an acknowledgement note (optional):",
      privacyRequestRejectPrompt: "Add a rejection note (optional):",
      privacyRequestLegalHoldPrompt: "Add a legal-hold note (optional):",
      privacyTypeErase: "Erasure",
      privacyTypeRestrict: "Restriction",
      privacyStatusPending: "Pending",
      privacyStatusAcknowledged: "Acknowledged",
      privacyStatusScheduled: "Scheduled",
      privacyStatusCompleted: "Completed",
      privacyStatusRejected: "Rejected",
      privacyStatusLegalHold: "Legal hold",
      privacyStatusError: "Error",
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
      privacyQueueHeading: "プライバシー要求キュー",
      privacyQueueTotal: "総件数",
      privacyQueuePending: "未確認",
      privacyQueueAcknowledged: "確認済み",
      privacyQueueScheduled: "予定済み",
      privacyQueueCompleted: "完了",
      privacyQueueRejected: "却下",
      privacyQueueLegalHold: "法務保留",
      privacyQueueEmpty: "現在、プライバシー要求はありません。",
      privacyRequestType: "種類",
      privacyRequestStatus: "状態",
      privacyRequestDeadline: "期限",
      privacyRequestAck: "受理確認",
      privacyRequestReject: "却下",
      privacyRequestLegalHold: "法務保留",
      privacyRequestAckSuccess: "プライバシー要求 {id} を受理しました。",
      privacyRequestRejectSuccess: "プライバシー要求 {id} を却下しました。",
      privacyRequestLegalHoldSuccess: "プライバシー要求 {id} を法務保留にしました。",
      privacyRequestAckPrompt: "受理メモを入力してください（任意）:",
      privacyRequestRejectPrompt: "却下メモを入力してください（任意）:",
      privacyRequestLegalHoldPrompt: "法務保留メモを入力してください（任意）:",
      privacyTypeErase: "削除",
      privacyTypeRestrict: "処理制限",
      privacyStatusPending: "未確認",
      privacyStatusAcknowledged: "確認済み",
      privacyStatusScheduled: "予定済み",
      privacyStatusCompleted: "完了",
      privacyStatusRejected: "却下",
      privacyStatusLegalHold: "法務保留",
      privacyStatusError: "異常",
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
      privacyQueueHeading: "개인정보 요청 큐",
      privacyQueueTotal: "총 요청",
      privacyQueuePending: "대기",
      privacyQueueAcknowledged: "접수됨",
      privacyQueueScheduled: "예약됨",
      privacyQueueCompleted: "완료",
      privacyQueueRejected: "거절됨",
      privacyQueueLegalHold: "법적 보존",
      privacyQueueEmpty: "현재 개인정보 요청이 없습니다.",
      privacyRequestType: "유형",
      privacyRequestStatus: "상태",
      privacyRequestDeadline: "기한",
      privacyRequestAck: "접수 확인",
      privacyRequestReject: "거절",
      privacyRequestLegalHold: "법적 보존",
      privacyRequestAckSuccess: "개인정보 요청 {id} 를 접수했습니다.",
      privacyRequestRejectSuccess: "개인정보 요청 {id} 를 거절했습니다.",
      privacyRequestLegalHoldSuccess: "개인정보 요청 {id} 를 법적 보존으로 전환했습니다.",
      privacyRequestAckPrompt: "접수 메모를 입력하세요 (선택):",
      privacyRequestRejectPrompt: "거절 메모를 입력하세요 (선택):",
      privacyRequestLegalHoldPrompt: "법적 보존 메모를 입력하세요 (선택):",
      privacyTypeErase: "삭제",
      privacyTypeRestrict: "처리 제한",
      privacyStatusPending: "대기",
      privacyStatusAcknowledged: "접수됨",
      privacyStatusScheduled: "예약됨",
      privacyStatusCompleted: "완료",
      privacyStatusRejected: "거절됨",
      privacyStatusLegalHold: "법적 보존",
      privacyStatusError: "오류",
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
    analytics: null,
    securityHealth: null,
    privacyQueue: null,
    merchantAccounts: [],
    merchantGeoPartners: [],
    merchantListingRequests: [],
    merchantListingRequestsAll: [],
    merchantListingRequestSelectedIds: new Set(),
    activeMerchantListingRequestId: "",
    merchantListingReviewEvents: [],
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
    analyticsHeading: document.getElementById("analyticsHeading"),
    analyticsUpdatedText: document.getElementById("analyticsUpdatedText"),
    analyticsKpiGrid: document.getElementById("analyticsKpiGrid"),
    analyticsFunnelRow: document.getElementById("analyticsFunnelRow"),
    analyticsRevenueGrid: document.getElementById("analyticsRevenueGrid"),
    analyticsConvRow: document.getElementById("analyticsConvRow"),
    analyticsIntentRow: document.getElementById("analyticsIntentRow"),
    securityHeading: document.getElementById("securityHeading"),
    securityUpdatedText: document.getElementById("securityUpdatedText"),
    securityGrid: document.getElementById("securityGrid"),
    securityDetail: document.getElementById("securityDetail"),
    privacyQueueHeading: document.getElementById("privacyQueueHeading"),
    privacyQueueUpdatedText: document.getElementById("privacyQueueUpdatedText"),
    privacyQueueSummary: document.getElementById("privacyQueueSummary"),
    privacyQueueList: document.getElementById("privacyQueueList"),
    merchantGovernanceBadge: document.getElementById("merchantGovernanceBadge"),
    merchantSecretBox: document.getElementById("merchantSecretBox"),
    merchantTableBody: document.getElementById("merchantGovernanceTableBody"),
    merchantListingRequestsBadge: document.getElementById("merchantListingRequestsBadge"),
    merchantListingRequestsTableBody: document.getElementById("merchantListingRequestsTableBody"),
    merchantListingRequestsSlaSummary: document.getElementById("merchantListingRequestsSlaSummary"),
    merchantListingReviewAuditList: document.getElementById("merchantListingReviewAuditList"),
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

  function pickOpsText(zh, en, ja, ko) {
    const lang = LANG_TEXT[state.language] ? state.language : "EN";
    if (lang === "ZH") return zh;
    if (lang === "JA") return ja;
    if (lang === "KO") return ko;
    return en;
  }

  function describeOpsError(err, fallback = "request_failed") {
    const safeCode = String((err && err.message) || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_:-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80) || fallback;
    if (safeCode === "unauthorized") {
      return pickOpsText("登录状态已失效，请重新验证。", "Session expired. Please authenticate again.", "ログイン状態の有効期限が切れました。再認証してください。", "로그인 세션이 만료되었습니다. 다시 인증해 주세요.");
    }
    if (safeCode === "invalid_status") {
      return pickOpsText("状态无效。", "Invalid status.", "状態が無効です。", "상태 값이 올바르지 않습니다.");
    }
    if (safeCode === "support_session_init_failed") {
      return pickOpsText("会话初始化失败。", "Support session initialization failed.", "サポートセッションの初期化に失敗しました。", "지원 세션 초기화에 실패했습니다.");
    }
    if (/_unavailable$/.test(safeCode) || safeCode === "request_failed" || /^http_\d+$/.test(safeCode)) {
      return pickOpsText("服务暂不可用，请稍后重试。", "Service is temporarily unavailable. Please try again later.", "サービスは一時的に利用できません。後でもう一度お試しください。", "서비스를 일시적으로 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
    }
    if (/_failed$/.test(safeCode)) {
      return pickOpsText("请求处理失败，请重试。", "The request could not be completed. Please retry.", "リクエストの処理に失敗しました。再試行してください。", "요청 처리에 실패했습니다. 다시 시도해 주세요.");
    }
    return safeCode.replace(/_/g, " ");
  }

  async function _readJsonSafe(res, fallback = {}) {
    if (!res || res.status === 204 || res.status === 205) return fallback;
    let text = "";
    try {
      text = await res.text();
    } catch {
      return fallback;
    }
    const trimmed = String(text || "").trim();
    if (!trimmed) return fallback;
    try {
      return JSON.parse(trimmed);
    } catch {
      return fallback;
    }
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

  function localizeVisibleOpsText(value, fallback = "") {
    const raw = String(value || "").trim();
    if (!raw) return fallback || "";
    if (state.language === "ZH") return raw;
    const map = {
      "当前状态": pickOpsText("当前状态", "Current status", "現在の状態", "현재 상태"),
      "当前备注": pickOpsText("当前备注", "Current note", "現在のメモ", "현재 메모"),
      "当前没有审批动作": pickOpsText("当前没有审批动作", "No review actions yet", "審査アクションはまだありません", "검토 작업이 아직 없습니다."),
      "当前没有商家申请": pickOpsText("当前没有商家申请", "No merchant requests", "加盟店申請はありません", "상점 신청이 없습니다."),
      "暂无用户数据": pickOpsText("暂无用户数据", "No user data", "ユーザーデータはありません", "사용자 데이터가 없습니다."),
      "暂无数据": pickOpsText("暂无数据", "No data", "データなし", "데이터 없음"),
      "暂无历史记录": pickOpsText("暂无历史记录", "No history", "履歴なし", "기록 없음"),
      "暂无证据": pickOpsText("暂无证据", "No evidence", "証拠なし", "증빙 없음"),
      "当前无工单": pickOpsText("当前无工单", "No tickets right now", "現在チケットはありません", "현재 티켓이 없습니다."),
      "当前无待转人工问题": pickOpsText("当前无待转人工问题", "No pending human-handoff issues", "現在、有人化が必要な課題はありません", "현재 사람 전환이 필요한 이슈가 없습니다."),
      "当前无实时会话": pickOpsText("当前无实时会话", "No live sessions right now", "現在ライブ会話はありません", "현재 실시간 세션이 없습니다."),
      "总计": pickOpsText("总计", "Total", "合計", "총계"),
      "总工单": pickOpsText("总工单", "Total tickets", "総チケット", "총 티켓"),
      "已接入": pickOpsText("已接入", "Live", "接続中", "연결됨"),
      "已关闭": pickOpsText("已关闭", "Closed", "クローズ済み", "종료됨"),
      "等待接入": pickOpsText("等待接入", "Waiting", "待機中", "대기중"),
      "人工坐席": pickOpsText("人工坐席", "Ops", "オペレーター", "상담원"),
      "系统": pickOpsText("系统", "System", "システム", "시스템"),
      "用户": pickOpsText("用户", "User", "ユーザー", "사용자"),
      "证据": pickOpsText("证据", "Evidence", "証拠", "증빙"),
      "备注": pickOpsText("备注", "Note", "メモ", "메모"),
      "节点": pickOpsText("节点", "Moment", "時点", "시점"),
      "待处理": pickOpsText("待处理", "Pending", "未対応", "대기"),
      "处理中": pickOpsText("处理中", "In progress", "対応中", "처리 중"),
      "已解决": pickOpsText("已解决", "Resolved", "解決済み", "해결됨"),
      "失败": pickOpsText("失败", "Failed", "失敗", "실패"),
      "已取消": pickOpsText("已取消", "Canceled", "キャンセル済み", "취소됨"),
      "排队中": pickOpsText("排队中", "Queued", "待機中", "대기열"),
      "执行中": pickOpsText("执行中", "Running", "実行中", "실행 중"),
      "成功": pickOpsText("成功", "Success", "成功", "성공"),
      "已跳过": pickOpsText("已跳过", "Skipped", "スキップ済み", "건너뜀"),
      "转人工": pickOpsText("转人工", "Human handoff", "有人切替", "사람 상담 전환"),
      "普通": pickOpsText("普通", "Normal", "通常", "보통"),
      "高优先": pickOpsText("高优先", "High priority", "高優先", "높은 우선순위"),
      "紧急": pickOpsText("紧急", "Critical", "緊急", "긴급"),
      "归属：": pickOpsText("归属：", "Parent: ", "帰属: ", "소속: "),
      "涉及门店": pickOpsText("涉及门店", "Stores", "対象店舗", "대상 매장"),
      "审核备注": pickOpsText("审核备注", "Review note", "審査メモ", "검토 메모"),
      "后续动作": pickOpsText("后续动作", "Next step", "次のアクション", "다음 단계"),
      "无补充说明": pickOpsText("无补充说明", "No additional note", "補足なし", "추가 설명 없음"),
      "暂无": pickOpsText("暂无", "None", "なし", "없음"),
      "无": pickOpsText("无", "None", "なし", "없음"),
      "未填写": pickOpsText("未填写", "Not filled", "未入力", "미입력"),
      "未分配": pickOpsText("未分配", "Unassigned", "未割当", "미배정"),
      "未指定": pickOpsText("未指定", "Not specified", "未指定", "미지정"),
      "未绑定": pickOpsText("未绑定", "Unbound", "未連携", "미연결"),
      "内部聚合视图": pickOpsText("内部聚合视图", "Internal aggregate view", "内部集約ビュー", "내부 집계 뷰"),
      "独立门店": pickOpsText("独立门店", "Standalone store", "独立店舗", "독립 매장"),
      "展示中": pickOpsText("展示中", "Listed", "掲載中", "노출 중"),
      "关闭": pickOpsText("关闭", "Off", "停止", "비활성"),
      "测试数据": pickOpsText("测试数据", "Demo data", "テストデータ", "테스트 데이터"),
      "订单": pickOpsText("订单", "Orders", "注文", "주문"),
      "支持单": pickOpsText("支持单", "Support tickets", "サポートチケット", "지원 티켓"),
      "结算": pickOpsText("结算", "Settlements", "精算", "정산"),
      "未准备": pickOpsText("未准备", "Not prepared", "未準備", "미준비"),
      "活跃": pickOpsText("活跃", "Active", "稼働中", "활성"),
      "停用": pickOpsText("停用", "Disabled", "停止", "비활성"),
      "启用": pickOpsText("启用", "Enabled", "有効", "활성"),
      "正常": pickOpsText("正常", "Active", "正常", "정상"),
      "冻结": pickOpsText("冻结", "Frozen", "凍結", "동결"),
      "北京": "Beijing",
      "上海": "Shanghai",
      "广州": "Guangzhou",
      "深圳": "Shenzhen",
      "杭州": "Hangzhou",
      "成都": "Chengdu",
      "重庆": "Chongqing",
      "西安": "Xi'an",
      "苏州": "Suzhou",
      "南京": "Nanjing",
      "武汉": "Wuhan",
      "天津": "Tianjin",
      "长沙": "Changsha",
      "厦门": "Xiamen",
      "青岛": "Qingdao",
      "珠海": "Zhuhai",
      "香港": "Hong Kong",
      "澳门": "Macau",
      "酒店": "Hotel",
      "餐饮": "Dining",
      "餐厅": "Restaurant",
      "景点": "Attraction",
      "旅游": "Travel",
      "购物": "Shopping",
      "医疗": "Medical",
      "出行": "Transport"
    };
    let output = raw;
    Object.entries(map).forEach(([from, to]) => {
      output = output.replace(new RegExp(from, "g"), to);
    });
    if (/[一-鿿]/.test(output) && fallback) return fallback;
    return output;
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

  // ── Admin Auth ─────────────────────────────────────────────────────────────
  const ADMIN_TOKEN_STORAGE_KEY = "cx_admin_tk";

  function getStoredAdminToken() {
    try {
      const token = localStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
      return token ? String(token).trim() : "";
    } catch {
      return "";
    }
  }

  function storeAdminToken(token) {
    try {
      if (token) localStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, String(token));
      else localStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    } catch {}
  }

  function buildAdminRequestHeaders(extraHeaders = {}) {
    const headers = { ...extraHeaders };
    const token = getStoredAdminToken();
    if (token && !headers.Authorization) headers.Authorization = "Bearer " + token;
    return headers;
  }

  function _showLoginModal() {
    // Remove any existing modal
    const old = document.getElementById("cx-admin-login-modal");
    if (old) old.remove();

    const overlay = document.createElement("div");
    overlay.id = "cx-admin-login-modal";
    overlay.className = "ops-login-overlay";
    overlay.innerHTML = `
      <div class="ops-login-modal">
        <h3 class="ops-login-title">Admin Login</h3>
        <p class="ops-login-copy">${escapeHtml(pickOpsText("请输入管理员密钥", "Enter admin key", "管理者キーを入力してください", "관리자 키를 입력하세요"))}</p>
        <input id="cx-admin-key-input" type="password" placeholder="Admin Key"
          class="ops-login-input"/>
        <div id="cx-admin-login-err" class="ops-login-error"></div>
        <button id="cx-admin-login-btn" class="ops-login-btn">
          ${escapeHtml(pickOpsText("登录", "Sign in", "ログイン", "로그인"))}
        </button>
      </div>`;
    document.body.appendChild(overlay);

    const input = overlay.querySelector("#cx-admin-key-input");
    const btn   = overlay.querySelector("#cx-admin-login-btn");
    const errEl = overlay.querySelector("#cx-admin-login-err");

    async function doLogin() {
      const key = input.value.trim();
      if (!key) { errEl.textContent = pickOpsText("请输入密钥", "Enter key", "キーを入力してください", "키를 입력하세요"); return; }
      btn.disabled = true; btn.textContent = pickOpsText("验证中…", "Verifying…", "確認中…", "확인 중…");
      try {
        const res = await fetch("/api/admin/login", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-crossx-auth-mode": "token" },
          credentials: "same-origin",
          body: JSON.stringify({ key }),
        });
        const data = await _readJsonSafe(res, {});
        if (res.ok && data.ok !== false) {
          storeAdminToken(data.token || "");
          overlay.remove();
          _bindMerchantGovernanceEvents();
          _bindMerchantListingRequestEvents();
          _bindGeoEvents();
          startRefreshTicker();
          refreshOpsConsole({ showLoading: true, resetUsers: true, includeMetadata: true }).catch(() => {});
        } else {
          errEl.textContent = data.error || pickOpsText("密钥错误，请重试", "Wrong key. Please retry.", "キーが違います。再試行してください。", "키가 올바르지 않습니다. 다시 시도하세요.");
          btn.disabled = false; btn.textContent = pickOpsText("登录", "Sign in", "ログイン", "로그인");
        }
      } catch {
        errEl.textContent = pickOpsText("网络错误，请重试", "Network error. Please retry.", "ネットワークエラー。再試行してください。", "네트워크 오류. 다시 시도하세요.");
        btn.disabled = false; btn.textContent = pickOpsText("登录", "Sign in", "ログイン", "로그인");
      }
    }

    btn.addEventListener("click", doLogin);
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") doLogin(); });
    setTimeout(() => input.focus(), 50);
  }

  async function api(path, options) {
    const requestOptions = options || {};
    const headers = buildAdminRequestHeaders({ "Content-Type": "application/json", ...(requestOptions.headers || {}) });
    const res = await fetch(path, { credentials: "same-origin", ...requestOptions, headers });
    if (res.status === 401) {
      storeAdminToken("");
      _showLoginModal();
      const err = new Error("unauthorized");
      err.needsLogin = true;
      throw err;
    }
    const payload = await _readJsonSafe(res, {});
    if (!res.ok) {
      const rawCode = payload && (payload.error || payload.code || payload.reason) ? String(payload.error || payload.code || payload.reason) : "";
      const safeCode = rawCode.trim().toLowerCase().replace(/[^a-z0-9_:-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 80) || `http_${res.status}`;
      throw new Error(safeCode);
    }
    return payload;
  }

  async function hasAdminSession() {
    try {
      const res = await fetch("/api/admin/session", {
        credentials: "same-origin",
        headers: buildAdminRequestHeaders(),
      });
      const payload = await _readJsonSafe(res, {});
      return Boolean(res.ok && payload && payload.authenticated);
    } catch {
      return false;
    }
  }

  function startRefreshTicker() {
    if (state.refreshTicker) clearInterval(state.refreshTicker);
    state.refreshTicker = setInterval(() => {
      refreshOpsConsole().catch(() => {});
    }, Math.max(12000, motion.safeDuration(15000)));
  }

  async function deleteFeatureFlag(flagName) {
    try {
      await api(`/api/admin/flags/${encodeURIComponent(flagName)}`, { method: "DELETE" });
      loadFeatureFlags();
    } catch (err) {
      notify(describeOpsError(err), "error");
    }
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
    if (el.analyticsHeading) el.analyticsHeading.textContent = t("analyticsHeading");
    const introTitle = document.getElementById("opsIntroTitle");
    const introCopy = document.getElementById("opsIntroCopy");
    const navOverview = document.getElementById("opsNavOverview");
    const navAnalytics = document.getElementById("opsNavAnalytics");
    const navSecurity = document.getElementById("opsNavSecurity");
    const navPrivacy = document.getElementById("opsNavPrivacy");
    const navMerchant = document.getElementById("opsNavMerchant");
    const overviewCopy = document.getElementById("overviewCopy");
    const analyticsCopy = document.getElementById("analyticsCopy");
    const securityCopy = document.getElementById("securityCopy");
    const privacyQueueCopy = document.getElementById("privacyQueueCopy");
    const issuesCopy = document.getElementById("issuesCopy");
    const usersCopy = document.getElementById("usersCopy");
    const dataQualityCopy = document.getElementById("dataQualityCopy");
    const kbCopy = document.getElementById("kbCopy");
    const merchantGovernanceCopy = document.getElementById("merchantGovernanceCopy");
    if (introTitle) introTitle.textContent = pickOpsText("先看风险，再推动执行，最后回到治理闭环", "Triage risk first, drive execution next, then close the governance loop", "まずリスクを見て、次に実行を進め、最後に統制ループへ戻す", "먼저 리스크를 보고, 다음에 실행을 밀고, 마지막에 거버넌스 루프로 돌아갑니다");
    if (introCopy) introCopy.textContent = pickOpsText("这个后台只保留三类高价值动作：看实时风险、处理人工接管、校准平台治理。业务指标、安全健康、隐私请求和商家治理都按同一节奏组织，避免在多页之间来回跳转。", "This console keeps only three high-value actions in one place: spot live risk, take over human intervention, and recalibrate platform governance.", "このコンソールでは、リアルタイムのリスク確認、人手介入、プラットフォーム統制の調整という高価値な運営アクションだけを一か所に集約しています。", "이 콘솔은 실시간 리스크 확인, 사람 개입 처리, 플랫폼 거버넌스 보정이라는 핵심 운영 행동만 한 흐름으로 묶습니다.");
    if (navOverview) navOverview.textContent = pickOpsText("总览", "Overview", "概要", "개요");
    if (navAnalytics) navAnalytics.textContent = pickOpsText("指标", "KPIs", "指標", "지표");
    if (navSecurity) navSecurity.textContent = pickOpsText("安全", "Security", "安全", "보안");
    if (navPrivacy) navPrivacy.textContent = pickOpsText("隐私", "Privacy", "プライバシー", "개인정보");
    if (navMerchant) navMerchant.textContent = pickOpsText("商家治理", "Merchants", "加盟店統制", "상점 거버넌스");
    if (overviewCopy) overviewCopy.textContent = pickOpsText("先确认今天要不要人工接管，再决定优先处理哪些工单和会话。", "Confirm whether human takeover is needed today, then decide which tickets and sessions deserve priority.", "今日本当に人手介入が必要かを確認し、優先して扱うチケットとセッションを決めます。", "오늘 사람 개입이 필요한지 먼저 확인하고, 우선 처리할 티켓과 세션을 정합니다.");
    if (analyticsCopy) analyticsCopy.textContent = pickOpsText("用漏斗、收入和意图分布判断问题出在转化前段、履约中段还是供给质量。", "Use funnel, revenue, and intent mix to tell whether the problem sits in conversion, fulfillment, or supply quality.", "ファネル、売上、意図分布を見て、課題が転換・履行・供給品質のどこにあるかを判断します。", "퍼널, 매출, 의도 분포를 함께 보고 문제가 전환, 이행, 공급 품질 중 어디에 있는지 판단합니다.");
    if (securityCopy) securityCopy.textContent = pickOpsText("这里只看会阻断业务或放大合规风险的核心状态，不把次要告警混进主决策面板。", "Only blocking states and real compliance risks belong here. Secondary warnings should not crowd the primary operating surface.", "業務を止める状態と実質的なコンプライアンスリスクだけをここで扱い、軽微な警告は主画面に混ぜません。", "업무를 막는 상태와 실제 컴플라이언스 리스크만 여기서 보고, 부차 경고는 메인 운영 화면에 섞지 않습니다.");
    if (privacyQueueCopy) privacyQueueCopy.textContent = pickOpsText("删除、限制处理、法务保留统一在这一列判断时效与处理责任，避免遗漏 SLA。", "Handle erasure, restriction, and legal hold requests here with deadline visibility so SLA misses do not slip through.", "削除・処理制限・リーガルホールドをここで期限付きで判断し、SLA 漏れを防ぎます。", "삭제, 처리 제한, 법무 보류 요청을 이곳에서 기한과 함께 보고 SLA 누락을 막습니다.");
    if (issuesCopy) issuesCopy.textContent = pickOpsText("这一区只放“还没正式建单，但已经值得人工接住”的问题，方便快速转工单。", "This area only keeps problems worth human pickup before a formal ops ticket is created.", "正式なチケット化前でも、人が拾うべき課題だけをここに集めます。", "정식 티켓이 없어도 사람이 먼저 잡아야 하는 문제만 이 구역에 둡니다.");
    if (usersCopy) usersCopy.textContent = pickOpsText("从这里查账号、角色、订单量和最近活跃城市，用于支持排查，不承担用户画像运营功能。", "Use this for support investigation: account, role, order count, and latest active city. It is not a growth CRM surface.", "アカウント、権限、注文数、最近の活動都市を確認するための支援用画面で、CRM 運用面ではありません。", "계정, 역할, 주문 수, 최근 활동 도시를 확인하는 지원 조사 화면이며 CRM 운영 화면은 아닙니다.");
    if (dataQualityCopy) dataQualityCopy.textContent = pickOpsText("确认用户、任务、订单、审计和收入这些关键底账有没有断层，先看底数再看业务判断。", "Verify whether users, tasks, orders, audit trails, and revenue ledgers are complete before making business judgments.", "ユーザー、タスク、注文、監査、売上の元データに欠落がないかを確認してから業務判断します。", "사용자, 작업, 주문, 감사 로그, 매출 원장이 끊기지 않았는지 먼저 확인한 뒤 운영 판단을 합니다.");
    if (kbCopy) kbCopy.textContent = pickOpsText("按城市和类别抽查知识库覆盖率，确认推荐内容缺口来自供给不足还是资料没有入库。", "Sample cities and categories to tell whether recommendation gaps come from weak supply or content not yet ingested.", "都市とカテゴリごとに確認し、推薦不足が供給不足か未登録コンテンツかを見分けます。", "도시와 카테고리별로 점검해 추천 공백이 공급 부족인지 미입고 콘텐츠인지 구분합니다.");
    if (merchantGovernanceCopy) merchantGovernanceCopy.textContent = pickOpsText("这里处理“平台要不要管、账号能不能开、资料是否合规”这类治理动作，不承接商家日常运营细节。", "This area handles governance decisions such as merchant onboarding, account readiness, and content compliance, not day-to-day merchant operations.", "ここでは加盟店の開設可否、アカウント準備、内容適合性といった統制判断を扱い、日常運営は扱いません。", "이 영역은 상점 개설, 계정 준비 상태, 콘텐츠 적합성 같은 거버넌스 판단을 다루며 일상 운영은 다루지 않습니다.");
    const setNodeText = (selector, value, root = document) => {
      const node = root.querySelector(selector);
      if (node) node.textContent = value;
    };
    const setNodePlaceholder = (selector, value, root = document) => {
      const node = root.querySelector(selector);
      if (node) node.placeholder = value;
    };
    const setNodeOptions = (selector, values, root = document) => {
      const node = root.querySelector(selector);
      if (!node) return;
      Array.from(node.options || []).forEach((option, index) => {
        if (values[index] !== undefined) option.textContent = values[index];
      });
    };

    const merchantGovernanceCard = document.getElementById("merchantGovernanceCard");
    if (merchantGovernanceCard) {
      const merchantNotes = merchantGovernanceCard.querySelectorAll(".ops-inline-note");
      const merchantLabels = merchantGovernanceCard.querySelectorAll("#merchantGovernanceForm .geo-field-label");
      const merchantHeaders = merchantGovernanceCard.querySelectorAll("thead th");
      const merchantLoading = merchantGovernanceCard.querySelector("#merchantGovernanceTableBody .ops-table-empty-cell");
      const editingMerchant = state.merchantAccounts.find((item) => item.id === _merchantEditingId);
      const editingMerchantName = localizeVisibleOpsText(editingMerchant?.name || editingMerchant?.slug || "", editingMerchant?.name || editingMerchant?.slug || "-");
      const merchantLabelTexts = [
        pickOpsText("商家名称 *", "Merchant name *", "加盟店名 *", "상점 이름 *"),
        pickOpsText("商家 Slug *", "Merchant slug *", "加盟店 slug *", "상점 slug *"),
        pickOpsText("登录用户名 *", "Login username *", "ログインユーザー名 *", "로그인 사용자명 *"),
        pickOpsText("初始化密码", "Initial password", "初期パスワード", "초기 비밀번호"),
        pickOpsText("账号类型", "Account type", "アカウント種別", "계정 유형"),
        pickOpsText("城市", "City", "都市", "도시"),
        pickOpsText("类别", "Category", "カテゴリ", "카테고리"),
        pickOpsText("上级企业合作方", "Parent enterprise partner", "上位企業パートナー", "상위 엔터프라이즈 파트너"),
        pickOpsText("绑定 GEO 商家", "Linked GEO merchant", "連携 GEO 加盟店", "연동 GEO 상점"),
        pickOpsText("账户状态", "Account status", "アカウント状態", "계정 상태")
      ];
      const merchantHeaderTexts = [
        pickOpsText("商家", "Merchant", "加盟店", "상점"),
        pickOpsText("类型/归属", "Type / ownership", "種別 / 帰属", "유형 / 소속"),
        "Owner",
        pickOpsText("绑定 GEO", "Linked GEO", "連携 GEO", "연동 GEO"),
        pickOpsText("状态", "Status", "状態", "상태"),
        pickOpsText("推荐", "Recommendation", "推薦", "추천"),
        pickOpsText("更新时间", "Updated", "更新時刻", "업데이트 시각"),
        pickOpsText("操作", "Actions", "操作", "작업")
      ];
      setNodeText(".ops-section-head h3", pickOpsText("商家治理", "Merchant governance", "加盟店統制", "상점 거버넌스"), merchantGovernanceCard);
      if (merchantNotes[0]) merchantNotes[0].textContent = pickOpsText("内部后台负责商家开户、状态治理、密码重置和 GEO 绑定；资料维护和上架文案仍留在商家端处理。", "Internal admin handles merchant onboarding, status governance, password resets, and GEO binding. Profile upkeep and listing copy stay in merchant console.", "内部管理画面では加盟店開設、状態統制、パスワード再発行、GEO 連携を扱い、プロフィール更新や掲載文言は加盟店コンソール側で管理します。", "내부 콘솔은 상점 온보딩, 상태 거버넌스, 비밀번호 재설정, GEO 연동만 다루고 프로필 관리와 노출 문구는 상점 콘솔에 남겨 둡니다.");
      if (merchantNotes[1]) merchantNotes[1].textContent = pickOpsText("如果要测试商家后台，请在这里为指定商家生成隔离的演示数据，不要触碰真实用户数据。", "For merchant-console testing, generate isolated demo data here for a specific merchant without touching real user data.", "加盟店コンソールを検証する場合は、実ユーザーデータに触れず、対象加盟店向けの分離されたデモデータをここで生成します。", "상점 콘솔을 테스트할 때는 실제 사용자 데이터를 건드리지 말고, 특정 상점용 격리 데모 데이터를 여기서 생성하세요.");
      merchantLabels.forEach((label, index) => {
        if (merchantLabelTexts[index]) label.textContent = merchantLabelTexts[index];
      });
      merchantHeaders.forEach((header, index) => {
        if (merchantHeaderTexts[index] !== undefined) header.textContent = merchantHeaderTexts[index];
      });
      setNodeText("#merchantFormTitle", editingMerchant
        ? pickOpsText("✏️ 编辑：" + editingMerchantName, "✏️ Editing: " + editingMerchantName, "✏️ 編集: " + editingMerchantName, "✏️ 편집: " + editingMerchantName)
        : pickOpsText("➕ 新建商家后台账号", "➕ Create merchant console account", "➕ 加盟店コンソールアカウント作成", "➕ 상점 콘솔 계정 만들기"), merchantGovernanceCard);
      setNodeText("#merchantCancelEditBtn", pickOpsText("取消编辑", "Cancel edit", "編集を取り消す", "편집 취소"), merchantGovernanceCard);
      setNodePlaceholder("#merchantName", pickOpsText("如：海底捞火锅（静安寺店）", "Example: Haidilao Hot Pot (Jingan Temple)", "例: 海底撈火鍋（静安寺店）", "예: 하이디라오 훠궈 (징안사점)"), merchantGovernanceCard);
      setNodePlaceholder("#merchantSlug", pickOpsText("如：haidilao-jingansi", "Example: haidilao-jingansi", "例: haidilao-jingansi", "예: haidilao-jingansi"), merchantGovernanceCard);
      setNodePlaceholder("#merchantUsername", pickOpsText("如：haidilao_owner", "Example: haidilao_owner", "例: haidilao_owner", "예: haidilao_owner"), merchantGovernanceCard);
      setNodePlaceholder("#merchantPassword", pickOpsText("留空则自动生成", "Leave blank to auto-generate", "空欄なら自動生成", "비워 두면 자동 생성"), merchantGovernanceCard);
      setNodePlaceholder("#merchantCity", pickOpsText("如：上海", "Example: Shanghai", "例: 上海", "예: 상하이"), merchantGovernanceCard);
      setNodeOptions("#merchantAccountType", [
        pickOpsText("本地商家", "Local merchant", "ローカル加盟店", "로컬 상점"),
        pickOpsText("企业合作方", "Enterprise partner", "企業パートナー", "엔터프라이즈 파트너")
      ], merchantGovernanceCard);
      setNodeOptions("#merchantCategory", [
        pickOpsText("🍜 餐厅/美食", "🍜 Restaurant / Food", "🍜 レストラン / グルメ", "🍜 식당 / 음식"),
        pickOpsText("🏨 酒店/住宿", "🏨 Hotel / Stay", "🏨 ホテル / 宿泊", "🏨 호텔 / 숙박"),
        pickOpsText("🏛️ 景点/娱乐", "🏛️ Attraction / Leisure", "🏛️ 観光 / レジャー", "🏛️ 관광 / 레저"),
        pickOpsText("🚕 交通/出行", "🚕 Transport / Mobility", "🚕 交通 / 移動", "🚕 교통 / 이동"),
        pickOpsText("🛍️ 购物/商场", "🛍️ Shopping / Mall", "🛍️ 買い物 / モール", "🛍️ 쇼핑 / 몰"),
        pickOpsText("📌 其他", "📌 Other", "📌 その他", "📌 기타")
      ], merchantGovernanceCard);
      setNodeOptions("#merchantParentAccountId", [pickOpsText("无", "None", "なし", "없음")], merchantGovernanceCard);
      setNodeOptions("#merchantGeoPartnerId", [pickOpsText("暂不绑定", "Do not bind yet", "まだ連携しない", "아직 연동하지 않음")], merchantGovernanceCard);
      setNodeOptions("#merchantStatus", [pickOpsText("启用", "Active", "有効", "활성"), pickOpsText("停用", "Suspended", "停止", "중지")], merchantGovernanceCard);
      setNodeText("#merchantSaveBtn", pickOpsText("保存商家账户", "Save merchant account", "加盟店アカウントを保存", "상점 계정 저장"), merchantGovernanceCard);
      setNodeText("#merchantRefreshBtn", pickOpsText("刷新列表", "Refresh list", "一覧を更新", "목록 새로고침"), merchantGovernanceCard);
      if (merchantLoading && /^(加载中|Loading)/.test(String(merchantLoading.textContent || "").trim())) {
        merchantLoading.textContent = pickOpsText("加载中...", "Loading...", "読み込み中...", "불러오는 중...");
      }
    }

    const merchantListingRequestsCard = document.getElementById("merchantListingRequestsCard");
    if (merchantListingRequestsCard) {
      const listingNote = merchantListingRequestsCard.querySelector(".ops-inline-note.ops-inline-note-spaced");
      const filterRow = merchantListingRequestsCard.querySelector(".ops-filter-row");
      const batchRow = merchantListingRequestsCard.querySelectorAll(".ops-filter-row")[1];
      const subhead = merchantListingRequestsCard.querySelector(".ops-section-subhead");
      const subheadNote = subhead?.querySelector(".ops-inline-note");
      const auditLoading = merchantListingRequestsCard.querySelector("#merchantListingReviewAuditList .ops-table-empty-cell");
      const tableHeaders = merchantListingRequestsCard.querySelectorAll("thead th");
      const tableLoading = merchantListingRequestsCard.querySelector("#merchantListingRequestsTableBody .ops-table-empty-cell");
      setNodeText(".ops-section-head h3", pickOpsText("商家申请审核", "Merchant request review", "加盟店申請審査", "상점 신청 검토"), merchantListingRequestsCard);
      if (listingNote) listingNote.textContent = pickOpsText("商家端提交的上架、资料更新、能力开通和入驻申请都会进入这里；审核只改变申请状态，不会自动授予 GEO 管理权限。", "Listing, material update, capability, and onboarding requests submitted from merchant console enter this queue. Review changes request status only and does not grant GEO control automatically.", "加盟店コンソールから送られた掲載・資料更新・機能開通・入店申請はここへ集約されます。審査で変わるのは申請状態のみで、GEO 管理権限は自動付与されません。", "상점 콘솔에서 제출한 노출, 자료 업데이트, 기능 개통, 입점 신청은 모두 여기로 들어옵니다. 검토는 신청 상태만 바꾸며 GEO 관리 권한을 자동 부여하지 않습니다.");
      setNodeOptions("#merchantListingRequestStatusFilter", [
        pickOpsText("全部状态", "All statuses", "全状態", "전체 상태"),
        pickOpsText("待处理", "Pending", "未対応", "대기"),
        pickOpsText("审核中", "In review", "審査中", "검토 중"),
        pickOpsText("已通过", "Approved", "承認済み", "승인됨"),
        pickOpsText("已驳回", "Rejected", "却下済み", "반려됨")
      ], merchantListingRequestsCard);
      setNodeOptions("#merchantListingRequestAccountTypeFilter", [
        pickOpsText("全部账号类型", "All account types", "全アカウント種別", "전체 계정 유형"),
        pickOpsText("本地商家", "Local merchant", "ローカル加盟店", "로컬 상점"),
        pickOpsText("企业合作方", "Enterprise partner", "企業パートナー", "엔터프라이즈 파트너")
      ], merchantListingRequestsCard);
      setNodeOptions("#merchantListingRequestPriorityFilter", [
        pickOpsText("全部优先级", "All priorities", "全優先度", "전체 우선순위"),
        pickOpsText("紧急", "Critical", "緊急", "긴급"),
        pickOpsText("高", "High", "高", "높음"),
        pickOpsText("普通", "Normal", "通常", "보통")
      ], merchantListingRequestsCard);
      setNodePlaceholder("#merchantListingRequestTagFilter", pickOpsText("按标签筛选", "Filter by tag", "タグで絞り込む", "태그로 필터"), merchantListingRequestsCard);
      setNodeText("#merchantListingRequestRefreshBtn", pickOpsText("刷新申请", "Refresh requests", "申請を更新", "신청 새로고침"), merchantListingRequestsCard);
      setNodeText("#merchantListingRequestSelectionMeta", state.merchantListingRequestSelectedIds.size
        ? pickOpsText(`已选 ${state.merchantListingRequestSelectedIds.size} 条申请`, `${state.merchantListingRequestSelectedIds.size} requests selected`, `${state.merchantListingRequestSelectedIds.size} 件選択中`, `${state.merchantListingRequestSelectedIds.size}건 선택됨`)
        : pickOpsText("未选择申请", "No request selected", "申請未選択", "선택된 신청 없음"), merchantListingRequestsCard);
      setNodeOptions("#merchantListingRequestBatchStatus", [
        pickOpsText("批量更新状态", "Batch status update", "状態を一括更新", "일괄 상태 업데이트"),
        pickOpsText("标记审核中", "Mark in review", "審査中にする", "검토 중으로 표시"),
        pickOpsText("批量通过", "Batch approve", "一括承認", "일괄 승인"),
        pickOpsText("批量驳回", "Batch reject", "一括却下", "일괄 반려")
      ], merchantListingRequestsCard);
      setNodePlaceholder("#merchantListingRequestBatchOwner", pickOpsText("负责人", "Owner", "担当者", "담당자"), merchantListingRequestsCard);
      setNodePlaceholder("#merchantListingRequestBatchWindow", pickOpsText("排期窗口", "Schedule window", "スケジュール枠", "일정 창구"), merchantListingRequestsCard);
      setNodeText("#merchantListingRequestBatchApplyBtn", pickOpsText("应用到所选申请", "Apply to selected", "選択項目へ適用", "선택 항목에 적용"), merchantListingRequestsCard);
      if (subhead) {
        const titleNode = subhead.querySelector("strong");
        if (titleNode) titleNode.textContent = pickOpsText("最近审批动作", "Recent review actions", "最近の審査アクション", "최근 검토 작업");
      }
      if (subheadNote) subheadNote.textContent = pickOpsText("这里用于快速核对批量和单条审核动作是否已经落地。", "Use this to verify batch and single review operations quickly.", "一括処理と単件審査が正しく反映されたかをここで素早く確認します。", "일괄/단건 검토 작업이 반영됐는지 여기서 빠르게 확인합니다.");
      const selectAll = document.getElementById("merchantListingRequestSelectAll");
      if (selectAll) selectAll.setAttribute("aria-label", pickOpsText("全选商家申请", "Select all merchant requests", "加盟店申請をすべて選択", "상점 신청 전체 선택"));
      const listingHeaderTexts = [
        "",
        pickOpsText("商家", "Merchant", "加盟店", "상점"),
        pickOpsText("申请", "Request", "申請", "신청"),
        pickOpsText("类型", "Type", "種別", "유형"),
        pickOpsText("状态", "Status", "状態", "상태"),
        pickOpsText("内容", "Content", "内容", "내용"),
        pickOpsText("更新时间", "Updated", "更新時刻", "업데이트 시각"),
        pickOpsText("操作", "Actions", "操作", "작업")
      ];
      tableHeaders.forEach((header, index) => {
        if (listingHeaderTexts[index] !== undefined) header.textContent = listingHeaderTexts[index];
      });
      if (auditLoading && /^(加载中|Loading)/.test(String(auditLoading.textContent || "").trim())) {
        auditLoading.textContent = pickOpsText("加载中...", "Loading...", "読み込み中...", "불러오는 중...");
      }
      if (tableLoading && /^(加载中|Loading)/.test(String(tableLoading.textContent || "").trim())) {
        tableLoading.textContent = pickOpsText("加载中...", "Loading...", "読み込み中...", "불러오는 중...");
      }
    }

    const geoPartnersCard = document.getElementById("geoPartnersCard");
    if (geoPartnersCard) {
      const geoNote = geoPartnersCard.querySelector(".ops-inline-note");
      const geoLabels = geoPartnersCard.querySelectorAll("#geoPartnerForm .geo-field-label");
      const geoHeaders = geoPartnersCard.querySelectorAll("thead th");
      const geoLoading = geoPartnersCard.querySelector("#geoPartnersTableBody td");
      const geoActiveLabel = geoPartnersCard.querySelector(".geo-checkbox-label");
      const geoNameValue = localizeVisibleOpsText(document.getElementById("geoName")?.value || "", document.getElementById("geoName")?.value || "-");
      const geoLabelTexts = [
        pickOpsText("商家名称 *", "Merchant name *", "加盟店名 *", "상점 이름 *"),
        pickOpsText("城市 *", "City *", "都市 *", "도시 *"),
        pickOpsText("类别", "Category", "カテゴリ", "카테고리"),
        pickOpsText("优先级分数（越高越靠前）", "Priority score (higher ranks first)", "優先度スコア（高いほど上位）", "우선순위 점수 (높을수록 상단)"),
        pickOpsText("地址", "Address", "住所", "주소"),
        pickOpsText("联系方式", "Contact", "連絡先", "연락처"),
        pickOpsText("商家简介（AI 会直接引用此内容）", "Merchant description (AI may cite this directly)", "加盟店紹介（AI が直接引用する場合があります）", "상점 소개 (AI가 직접 인용할 수 있음)"),
        pickOpsText("标签（逗号分隔）", "Tags (comma separated)", "タグ（カンマ区切り）", "태그 (쉼표 구분)")
      ];
      const geoHeaderTexts = [
        pickOpsText("商家名", "Merchant", "加盟店名", "상점명"),
        pickOpsText("城市", "City", "都市", "도시"),
        pickOpsText("类别", "Category", "カテゴリ", "카테고리"),
        pickOpsText("优先级", "Priority", "優先度", "우선순위"),
        pickOpsText("状态", "Status", "状態", "상태"),
        pickOpsText("操作", "Actions", "操作", "작업")
      ];
      setNodeText("#geoPartnersHeading", pickOpsText("🏆 GEO 合作商家排名", "🏆 GEO partner ranking", "🏆 GEO 提携先ランキング", "🏆 GEO 제휴 상점 순위"), geoPartnersCard);
      if (geoNote) geoNote.textContent = pickOpsText("填入合作商家后，当用户提问时该商家信息将混合进 AI 回复，并以最高优先级（🏆 平台优选）展示。", "After you add a GEO partner here, its merchant profile can be blended into AI answers and shown at the highest priority (🏆 Platform pick).", "提携先を追加すると、ユーザーへの AI 回答にその加盟店情報が混ざり、最優先（🏆 プラットフォーム優先）で表示されます。", "제휴 상점을 추가하면 사용자 대상 AI 답변에 해당 상점 정보가 섞여 들어가고 최우선(🏆 플랫폼 우선 추천)으로 노출됩니다.");
      geoLabels.forEach((label, index) => {
        if (geoLabelTexts[index]) label.textContent = geoLabelTexts[index];
      });
      geoHeaders.forEach((header, index) => {
        if (geoHeaderTexts[index] !== undefined) header.textContent = geoHeaderTexts[index];
      });
      setNodeText("#geoFormTitle", _geoEditingId
        ? pickOpsText("✏️ 编辑：" + geoNameValue, "✏️ Editing: " + geoNameValue, "✏️ 編集: " + geoNameValue, "✏️ 편집: " + geoNameValue)
        : pickOpsText("➕ 新增合作商家", "➕ Add GEO partner", "➕ 提携加盟店を追加", "➕ GEO 제휴 상점 추가"), geoPartnersCard);
      setNodeText("#geoCancelEditBtn", pickOpsText("取消编辑", "Cancel edit", "編集を取り消す", "편집 취소"), geoPartnersCard);
      setNodePlaceholder("#geoName", pickOpsText("如：海底捞火锅（静安寺店）", "Example: Haidilao Hot Pot (Jingan Temple)", "例: 海底撈火鍋（静安寺店）", "예: 하이디라오 훠궈 (징안사점)"), geoPartnersCard);
      setNodePlaceholder("#geoCity", pickOpsText("如：上海", "Example: Shanghai", "例: 上海", "예: 상하이"), geoPartnersCard);
      setNodePlaceholder("#geoAddress", pickOpsText("如：静安区南京西路1515号", "Example: 1515 Nanjing West Rd, Jingan", "例: 静安区南京西路1515号", "예: 징안구 난징서로 1515호"), geoPartnersCard);
      setNodePlaceholder("#geoContact", pickOpsText("电话 / 微信 / 公众号", "Phone / WeChat / official account", "電話 / WeChat / 公式アカウント", "전화 / 위챗 / 공식 계정"), geoPartnersCard);
      setNodePlaceholder("#geoDescription", pickOpsText("人均150元，招牌菜：毛肚、鸭血；提供英文菜单；外国游客友好", "Average spend RMB 150; signatures: tripe, duck blood; English menu available; foreigner-friendly", "客単価150元、看板料理: 毛肚・鴨血、英語メニューあり、訪日客にもやさしい", "1인 평균 150위안, 대표 메뉴: 우건, 선지, 영어 메뉴 제공, 외국인 친화적"), geoPartnersCard);
      setNodePlaceholder("#geoTags", pickOpsText("火锅, 外国游客友好, 英文菜单, 24小时", "hotpot, foreigner-friendly, English menu, 24h", "火鍋, 訪問客向け, 英語メニュー, 24時間", "훠궈, 외국인 친화적, 영어 메뉴, 24시간"), geoPartnersCard);
      setNodeOptions("#geoCategory", [
        pickOpsText("🍜 餐厅/美食", "🍜 Restaurant / Food", "🍜 レストラン / グルメ", "🍜 식당 / 음식"),
        pickOpsText("🏨 酒店/住宿", "🏨 Hotel / Stay", "🏨 ホテル / 宿泊", "🏨 호텔 / 숙박"),
        pickOpsText("🏛️ 景点/娱乐", "🏛️ Attraction / Leisure", "🏛️ 観光 / レジャー", "🏛️ 관광 / 레저"),
        pickOpsText("🚕 交通/出行", "🚕 Transport / Mobility", "🚕 交通 / 移動", "🚕 교통 / 이동"),
        pickOpsText("🛍️ 购物/商场", "🛍️ Shopping / Mall", "🛍️ 買い物 / モール", "🛍️ 쇼핑 / 몰"),
        pickOpsText("📌 其他", "📌 Other", "📌 その他", "📌 기타")
      ], geoPartnersCard);
      setNodeText("#geoSaveBtn", pickOpsText("保存商家", "Save partner", "加盟店を保存", "상점 저장"), geoPartnersCard);
      setNodePlaceholder("#geoFilterCity", pickOpsText("按城市筛选", "Filter by city", "都市で絞り込む", "도시로 필터"), geoPartnersCard);
      setNodeOptions("#geoFilterCategory", [
        pickOpsText("全部类别", "All categories", "全カテゴリ", "전체 카테고리"),
        pickOpsText("餐厅", "Restaurant", "レストラン", "식당"),
        pickOpsText("酒店", "Hotel", "ホテル", "호텔"),
        pickOpsText("景点", "Attraction", "観光", "관광"),
        pickOpsText("交通", "Transport", "交通", "교통"),
        pickOpsText("购物", "Shopping", "買い物", "쇼핑"),
        pickOpsText("其他", "Other", "その他", "기타")
      ], geoPartnersCard);
      setNodeOptions("#geoFilterActive", [
        pickOpsText("全部状态", "All statuses", "全状態", "전체 상태"),
        pickOpsText("仅活跃", "Active only", "稼働中のみ", "활성만"),
        pickOpsText("已停用", "Disabled only", "停止済みのみ", "비활성만")
      ], geoPartnersCard);
      setNodeText("#geoFilterBtn", pickOpsText("筛选", "Filter", "絞り込み", "필터"), geoPartnersCard);
      setNodeText("#geoRefreshBtn", pickOpsText("刷新", "Refresh", "更新", "새로고침"), geoPartnersCard);
      if (geoActiveLabel && geoActiveLabel.lastChild) geoActiveLabel.lastChild.textContent = " " + pickOpsText("立即启用", "Enable immediately", "すぐ有効化", "즉시 활성화");
      if (geoLoading && /^(加载中|Loading)/.test(String(geoLoading.textContent || "").trim())) {
        geoLoading.textContent = pickOpsText("加载中...", "Loading...", "読み込み中...", "불러오는 중...");
      }
    }

    if (state.analytics) renderAnalytics();
    if (el.securityHeading) el.securityHeading.textContent = t("securityHeading");
    if (state.securityHealth) renderSecurityHealth();
    if (el.privacyQueueHeading) el.privacyQueueHeading.textContent = t("privacyQueueHeading");
    if (state.privacyQueue) renderPrivacyQueue();
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
          <span class="status">${escapeHtml(localizeVisibleOpsText(ticket.source || "", "-"))}</span>
          <span class="status">${escapeHtml(t("etaLine", { min: asNumber(ticket.remainingEtaMin) }))}</span>
          ${overdueLine}
        </div>
        <div class="ops-ticket-title">${escapeHtml(localizeVisibleOpsText(ticket.reason || "", "-"))}</div>
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
        <div class="ops-ticket-title">${escapeHtml(localizeVisibleOpsText(issue.intent || "", "-"))}</div>
        <div class="status">${escapeHtml(t("city"))}: ${escapeHtml(localizeVisibleOpsText(issue.city || "", "-"))}</div>
        <div class="status">${escapeHtml(t("reason"))}: ${escapeHtml(localizeVisibleOpsText(issue.reason || "", "-"))}</div>
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
      el.liveVoiceBtn.textContent = pickOpsText("语音不可用", "Voice N/A", "音声不可", "음성 사용 불가");
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
            <div class="status">${escapeHtml(t("liveTicket"))}: ${escapeHtml(session.ticketId || "-")} · ${escapeHtml(t("liveAgent"))}: ${escapeHtml(localizeVisibleOpsText(session.assignedAgentName || "", "-"))}</div>
            <div class="status">${escapeHtml(t("liveUnreadOps"))}: ${unreadOps} · ${escapeHtml(t("liveUnreadUser"))}: ${unreadUser}</div>
            <div class="status">${last ? `${escapeHtml(localizeVisibleOpsText(last.actor || "", last.actor || "-"))} · ${escapeHtml(localizeVisibleOpsText(last.text || "", last.text || ""))}` : "-"}</div>
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
      localizeVisibleOpsText(session.assignedAgentName || "", "-")
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
        const role = actor === "user"
          ? pickOpsText("用户", "User", "ユーザー", "사용자")
          : actor === "ops"
            ? pickOpsText("人工坐席", "Ops", "オペレーター", "상담원")
            : pickOpsText("系统", "System", "システム", "시스템");
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
            ${item.text ? `<div class="ops-live-text">${escapeHtml(localizeVisibleOpsText(item.text || "", item.text || ""))}</div>` : ""}
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

  function renderAnalytics() {
    const a = state.analytics;
    if (!a) return;

    if (el.analyticsHeading) el.analyticsHeading.textContent = t("analyticsHeading");
    if (el.analyticsUpdatedText) el.analyticsUpdatedText.textContent = formatDateTime(new Date().toISOString());

    // ── KPI grid ─────────────────────────────────────────────────────────────
    if (el.analyticsKpiGrid) {
      const kpi = a.kpi || {};
      const totals = kpi.totals || {};
      const ns = kpi.northStar || {};
      const sla = a.sla || {};
      const closedLoopPct = ns.value !== undefined ? (ns.value * 100).toFixed(1) + "%" : "-";
      const slaRate = sla.metRate !== undefined ? (sla.metRate * 100).toFixed(1) + "%" : "-";
      const kpiStats = [
        { label: t("kpiClosedLoop"),    value: closedLoopPct },
        { label: t("kpiTasks"),         value: asNumber(totals.tasks) },
        { label: t("kpiCompleted"),     value: asNumber(totals.completed) },
        { label: t("kpiFailed"),        value: asNumber(totals.failed) },
        { label: t("kpiOrders"),        value: asNumber(totals.orders) },
        { label: t("kpiSupportTickets"),value: asNumber(totals.supportTickets) },
        { label: t("kpiMcpSla"),        value: slaRate },
        { label: t("kpiMcpCalls"),      value: asNumber(sla.total) },
      ];
      el.analyticsKpiGrid.innerHTML = kpiStats
        .map((s) => `<article class="ops-kpi"><span class="label">${escapeHtml(s.label)}</span><span class="value">${escapeHtml(String(s.value))}</span></article>`)
        .join("");
    }

    // ── Funnel ────────────────────────────────────────────────────────────────
    if (el.analyticsFunnelRow) {
      const f = a.funnel || {};
      const stages = [
        { label: t("funnelIntent"),    value: f.intentSubmitted || 0 },
        { label: t("funnelPlanned"),   value: f.planned         || 0 },
        { label: t("funnelConfirmed"), value: f.confirmed       || 0 },
        { label: t("funnelPaid"),      value: f.paid            || 0 },
        { label: t("funnelDelivered"), value: f.delivered       || 0 },
      ];
      const maxVal = Math.max(1, ...stages.map((s) => s.value));
      el.analyticsFunnelRow.innerHTML = `
        <div class="ops-section-minihead">${escapeHtml(t("funnelLabel"))}</div>
        <div class="ops-funnel-row">
          ${stages.map((s, i) => {
            const pct = Math.max(12, Math.round((s.value / maxVal) * 60));
            const arrow = i < stages.length - 1 ? `<span class="ops-funnel-arrow">›</span>` : "";
            return `<div class="ops-funnel-stage">
              <div class="ops-funnel-card">
                <svg class="ops-funnel-svg" viewBox="0 0 56 64" preserveAspectRatio="none" aria-hidden="true">
                  <rect x="0" y="${64 - pct}" width="56" height="${pct}" rx="4" fill="var(--primary,#6366f1)"></rect>
                </svg>
                <span class="ops-funnel-value">${escapeHtml(String(s.value))}</span>
              </div>
              <div class="ops-funnel-label">${escapeHtml(s.label)}</div>
              ${arrow}
            </div>`;
          }).join("")}
        </div>`;
    }

    // ── Revenue grid ──────────────────────────────────────────────────────────
    if (el.analyticsRevenueGrid) {
      const rev = a.revenue || {};
      const fmt = (n) => n !== undefined ? "¥" + Number(n).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : "-";
      const revStats = [
        { label: t("revGross"),   value: fmt(rev.gross) },
        { label: t("revNet"),     value: fmt(rev.net) },
        { label: t("revMarkup"),  value: fmt(rev.markup) },
        { label: t("revRefunds"), value: fmt(rev.refunds) },
        { label: t("revOrders"),  value: asNumber(rev.orders) },
      ];
      el.analyticsRevenueGrid.innerHTML = `
        <div class="ops-section-minihead ops-grid-span-full">${escapeHtml(t("revHeading"))}</div>
        ${revStats.map((s) => `<article class="ops-kpi"><span class="label">${escapeHtml(s.label)}</span><span class="value">${escapeHtml(String(s.value))}</span></article>`).join("")}`;
    }

    // ── Book Conversion Rate ───────────────────────────────────────────────
    const raw = a.raw || {};
    if (el.analyticsConvRow && raw.conversions) {
      const c = raw.conversions;
      el.analyticsConvRow.innerHTML =
        `<div class="ops-section-minihead ops-section-minihead-spaced">📊 ${escapeHtml(pickOpsText("预订转化率", "Booking conversion rate", "予約転換率", "예약 전환율"))}</div>` +
        `<div class="ops-inline-stats">` +
        `<article class="ops-kpi"><span class="label">${escapeHtml(pickOpsText("Book 点击", "Book clicks", "Bookクリック", "Book 클릭"))}</span><span class="value">${escapeHtml(String(c.bookClicks || 0))}</span></article>` +
        `<article class="ops-kpi"><span class="label">${escapeHtml(pickOpsText("意图总数", "Total intents", "意図総数", "총 인텐트"))}</span><span class="value">${escapeHtml(String(c.intentTotal || 0))}</span></article>` +
        `<article class="ops-kpi"><span class="label">${escapeHtml(pickOpsText("转化率", "Conversion rate", "転換率", "전환율"))}</span><span class="value ops-accent-value">${escapeHtml(String(c.convRate || "0.0"))}%</span></article>` +
        `</div>`;
    }

    // ── Intent Distribution ────────────────────────────────────────────────
    if (el.analyticsIntentRow && raw.intentDist) {
      const dist = raw.intentDist;
      const total = Math.max(1, Object.values(dist).reduce((s, v) => s + v, 0));
      const bars = [
        { key: "hotel",    label: pickOpsText("🏨 酒店", "🏨 Hotels", "🏨 ホテル", "🏨 호텔"),  tone: "hotel" },
        { key: "food",     label: pickOpsText("🍜 美食", "🍜 Food", "🍜 グルメ", "🍜 음식"),  tone: "food" },
        { key: "activity", label: pickOpsText("🗺️ 景点", "🗺️ Attractions", "🗺️ 観光", "🗺️ 관광"),  tone: "activity" },
        { key: "travel",   label: pickOpsText("✈️ 行程", "✈️ Travel", "✈️ 旅程", "✈️ 이동"),  tone: "travel" },
      ].map(({ key, label, tone }) => {
        const cnt = dist[key] || 0;
        const pct = Math.round((cnt / total) * 100);
        return `<div class="ops-intent-row">` +
          `<span class="ops-intent-label">${label}</span>` +
          `<progress class="ops-intent-meter ops-intent-meter--${tone}" max="100" value="${pct}"></progress>` +
          `<span class="ops-intent-meta">${cnt} (${pct}%)</span>` +
          `</div>`;
      }).join("");
      el.analyticsIntentRow.innerHTML =
        `<div class="ops-section-minihead ops-section-minihead-spaced">🎯 ${escapeHtml(pickOpsText("意图分布", "Intent distribution", "意図分布", "인텐트 분포"))}</div>${bars}`;
    }
  }

  async function loadAnalytics() {
    try {
      const [kpi, funnel, revenue, sla, rawAnalytics] = await Promise.all([
        api("/api/dashboard/kpi"),
        api("/api/dashboard/funnel"),
        api("/api/dashboard/revenue"),
        api("/api/dashboard/mcp-sla"),
        api("/api/admin/analytics").catch(() => ({})),
      ]);
      state.analytics = { kpi, funnel, revenue, sla, raw: rawAnalytics };
      renderAnalytics();
    } catch (err) {
      if (!err.needsLogin) console.warn("[admin/analytics] load failed:", describeOpsError(err));
    }
    loadFeatureFlags().catch(() => {});
  }

  function renderSecurityHealth() {
    const payload = state.securityHealth;
    if (!payload) return;
    const health = payload.health || {};
    const checks = health.checks || {};
    const encryption = checks.encryption || {};
    const consent = checks.consent || {};
    const sessionStore = checks.sessionStore || {};
    const gdprQueue = payload.gdprQueue || {};
    const sla = payload.sla || {};

    if (el.securityHeading) el.securityHeading.textContent = t("securityHeading");
    if (el.securityUpdatedText) el.securityUpdatedText.textContent = formatDateTime(new Date().toISOString());

    const cards = [
      { label: t("securityEncryption"), value: encryption.writeEncryptionReady ? t("securityReady") : t("securityBlocked") },
      { label: t("securityConsent"), value: consent.strictMode ? t("securityStrict") : t("securitySoft") },
      { label: t("securityHttps"), value: checks.httpsConfigured ? t("securityEnabled") : t("securityMissing") },
      { label: t("securityAdminAllowlist"), value: checks.adminAllowlistConfigured ? t("securityEnabled") : t("securityMissing") },
      { label: t("securitySessionStore"), value: sessionStore.persistenceReady ? t("securityReady") : t("securityBlocked") },
      { label: t("securityPendingRequests"), value: asNumber(gdprQueue.summary && gdprQueue.summary.pending) },
      { label: t("securitySlaBreaches"), value: asNumber(Array.isArray(sla.breaches) ? sla.breaches.length : 0) },
    ];
    if (el.securityGrid) {
      el.securityGrid.innerHTML = cards
        .map((item) => `<article class="ops-kpi"><span class="label">${escapeHtml(item.label)}</span><span class="value">${escapeHtml(String(item.value))}</span></article>`)
        .join("");
    }

    if (el.securityDetail) {
      const errors = Array.isArray(health.errors) ? health.errors : [];
      const warnings = Array.isArray(health.warnings) ? health.warnings : [];
      const renderList = (items, tone) => items.map((entry) => (
        `<div class="ops-alert-row ops-alert-row--${tone}">${escapeHtml(entry)}</div>`
      )).join("");
      el.securityDetail.innerHTML = errors.length || warnings.length
        ? `
          <div class="ops-alert-title">${escapeHtml(t("securityErrors"))}</div>
          ${errors.length ? renderList(errors, "error") : `<div class="status">${escapeHtml(t("securityNoIssues"))}</div>`}
          <div class="ops-alert-title ops-alert-title-spaced">${escapeHtml(t("securityWarnings"))}</div>
          ${warnings.length ? renderList(warnings, "warning") : `<div class="status">${escapeHtml(t("securityNoIssues"))}</div>`}
        `
        : `<div class="status">${escapeHtml(t("securityNoIssues"))}</div>`;
    }
  }

  async function loadSecurityHealth() {
    try {
      const [health, gdprQueue, sla] = await Promise.all([
        api("/api/system/security-health"),
        api("/api/admin/gdpr/requests?limit=120").catch(() => ({ requests: [], summary: {} })),
        api("/api/admin/gdpr/sla").catch(() => ({ breaches: [] })),
      ]);
      state.securityHealth = { health, gdprQueue, sla };
      renderSecurityHealth();
    } catch (err) {
      if (!err.needsLogin) console.warn("[admin/security] load failed:", describeOpsError(err));
    }
  }

  function localizePrivacyRequestType(type) {
    const normalized = String(type || "").toLowerCase();
    if (normalized === "erase") return t("privacyTypeErase");
    if (normalized === "restrict") return t("privacyTypeRestrict");
    return normalized || "-";
  }

  function localizePrivacyRequestStatus(status) {
    const normalized = String(status || "").toLowerCase();
    if (normalized === "pending") return t("privacyStatusPending");
    if (normalized === "acknowledged") return t("privacyStatusAcknowledged");
    if (normalized === "scheduled") return t("privacyStatusScheduled");
    if (normalized === "completed") return t("privacyStatusCompleted");
    if (normalized === "rejected") return t("privacyStatusRejected");
    if (normalized === "legal_hold") return t("privacyStatusLegalHold");
    if (normalized === "error") return t("privacyStatusError");
    return normalized || "-";
  }

  function canModifyPrivacyRequest(status) {
    const normalized = String(status || "").toLowerCase();
    return !["completed", "rejected", "legal_hold", "error"].includes(normalized);
  }

  function renderPrivacyQueue() {
    const payload = state.privacyQueue;
    if (!payload) return;
    const summary = payload.summary || {};
    const requests = Array.isArray(payload.requests) ? payload.requests : [];

    if (el.privacyQueueHeading) el.privacyQueueHeading.textContent = t("privacyQueueHeading");
    if (el.privacyQueueUpdatedText) el.privacyQueueUpdatedText.textContent = formatDateTime(payload.checkedAt || new Date().toISOString());
    if (el.privacyQueueSummary) {
      const cards = [
        { label: t("privacyQueueTotal"), value: asNumber(summary.total) },
        { label: t("privacyQueuePending"), value: asNumber(summary.pending) },
        { label: t("privacyQueueAcknowledged"), value: asNumber(summary.acknowledged) },
        { label: t("privacyQueueScheduled"), value: asNumber(summary.scheduled) },
        { label: t("privacyQueueCompleted"), value: asNumber(summary.completed) },
        { label: t("privacyQueueRejected"), value: asNumber(summary.rejected) },
        { label: t("privacyQueueLegalHold"), value: asNumber(summary.legalHold) },
      ];
      el.privacyQueueSummary.innerHTML = cards
        .map((item) => `<article class="ops-kpi"><span class="label">${escapeHtml(item.label)}</span><span class="value">${escapeHtml(String(item.value))}</span></article>`)
        .join("");
    }
    if (!el.privacyQueueList) return;
    if (!requests.length) {
      el.privacyQueueList.innerHTML = `<article class="ops-empty">${escapeHtml(t("privacyQueueEmpty"))}</article>`;
      return;
    }
    el.privacyQueueList.innerHTML = requests.slice(0, 24).map((request) => `
      <article class="issue-card">
        <div class="issue-card-head">
          <span class="code">${escapeHtml(request.id || "-")}</span>
          <span class="status-badge queued">${escapeHtml(localizePrivacyRequestStatus(request.status))}</span>
        </div>
        <div class="status">${escapeHtml(t("privacyRequestType"))}: ${escapeHtml(localizePrivacyRequestType(request.type))}</div>
        <div class="status">${escapeHtml(pickOpsText("设备", "Device", "端末", "기기"))}: ${escapeHtml(String(request.deviceId || "-"))}</div>
        <div class="status">${escapeHtml(t("createdAt"))}: ${escapeHtml(formatDateTime(request.createdAt))}</div>
        <div class="status">${escapeHtml(t("privacyRequestDeadline"))}: ${escapeHtml(formatDateTime(request.deadline))}</div>
        ${request.acknowledgedAt ? `<div class="status">${escapeHtml(pickOpsText("已确认", "Acknowledged", "確認済み", "접수됨"))}: ${escapeHtml(formatDateTime(request.acknowledgedAt))} · ${escapeHtml(localizeVisibleOpsText(request.acknowledgedBy || "", request.acknowledgedBy || "-"))}</div>` : ""}
        ${request.rejectedAt ? `<div class="status">${escapeHtml(pickOpsText("已拒绝", "Rejected", "却下済み", "거절됨"))}: ${escapeHtml(formatDateTime(request.rejectedAt))} · ${escapeHtml(localizeVisibleOpsText(request.rejectedBy || "", request.rejectedBy || "-"))}</div>` : ""}
        ${request.legalHoldAt ? `<div class="status">${escapeHtml(pickOpsText("法务保留", "Legal hold", "法務保留", "법적 보존"))}: ${escapeHtml(formatDateTime(request.legalHoldAt))} · ${escapeHtml(localizeVisibleOpsText(request.legalHoldBy || "", request.legalHoldBy || "-"))}</div>` : ""}
        ${request.reason ? `<div class="status">${escapeHtml(pickOpsText("原因", "Reason", "理由", "사유"))}: ${escapeHtml(localizeVisibleOpsText(request.reason || "", request.reason || ""))}</div>` : ""}
        ${request.basis ? `<div class="status">${escapeHtml(pickOpsText("依据", "Basis", "根拠", "근거"))}: ${escapeHtml(localizeVisibleOpsText(request.basis || "", request.basis || ""))}</div>` : ""}
        ${request.retainedCategories && request.retainedCategories.length ? `<div class="status">${escapeHtml(pickOpsText("保留项", "Retained", "保持項目", "보존 항목"))}: ${escapeHtml(request.retainedCategories.map((item) => localizeVisibleOpsText(item || "", item || "-")).join(", "))}</div>` : ""}
        ${request.note ? `<div class="status">${escapeHtml(pickOpsText("备注", "Note", "メモ", "메모"))}: ${escapeHtml(localizeVisibleOpsText(request.note || "", request.note || ""))}</div>` : ""}
        <div class="actions">
          ${["pending", "scheduled"].includes(String(request.status || "").toLowerCase()) ? `<button class="secondary" data-action="acknowledge-privacy-request" data-request="${escapeHtml(request.id)}">${escapeHtml(t("privacyRequestAck"))}</button>` : ""}
          ${canModifyPrivacyRequest(request.status) ? `<button class="secondary" data-action="reject-privacy-request" data-request="${escapeHtml(request.id)}">${escapeHtml(t("privacyRequestReject"))}</button>` : ""}
          ${canModifyPrivacyRequest(request.status) ? `<button class="secondary" data-action="legal-hold-privacy-request" data-request="${escapeHtml(request.id)}">${escapeHtml(t("privacyRequestLegalHold"))}</button>` : ""}
        </div>
      </article>
    `).join("");
    motion.bindPressables(el.privacyQueueList);
  }

  async function loadPrivacyQueue() {
    try {
      const payload = await api("/api/admin/gdpr/requests?limit=120");
      state.privacyQueue = payload;
      renderPrivacyQueue();
    } catch (err) {
      if (!err.needsLogin && el.privacyQueueList) {
        el.privacyQueueList.innerHTML = `<article class="ops-empty">${escapeHtml(t("loadError", { msg: describeOpsError(err) }))}</article>`;
      }
    }
  }

  async function acknowledgePrivacyRequest(requestId) {
    const note = window.prompt(t("privacyRequestAckPrompt"), "") || "";
    const result = await api(`/api/admin/gdpr/requests/${encodeURIComponent(requestId)}/acknowledge`, {
      method: "POST",
      body: JSON.stringify({ note }),
    });
    notify(t("privacyRequestAckSuccess", { id: result.id || requestId }), "success");
    await Promise.all([loadPrivacyQueue(), loadSecurityHealth()]);
  }

  async function rejectPrivacyRequest(requestId) {
    const note = window.prompt(t("privacyRequestRejectPrompt"), "") || "";
    const result = await api(`/api/admin/gdpr/requests/${encodeURIComponent(requestId)}/reject`, {
      method: "POST",
      body: JSON.stringify({ note, reason: "manual_review" }),
    });
    notify(t("privacyRequestRejectSuccess", { id: result.id || requestId }), "success");
    await Promise.all([loadPrivacyQueue(), loadSecurityHealth()]);
  }

  async function legalHoldPrivacyRequest(requestId) {
    const note = window.prompt(t("privacyRequestLegalHoldPrompt"), "") || "";
    const result = await api(`/api/admin/gdpr/requests/${encodeURIComponent(requestId)}/legal-hold`, {
      method: "POST",
      body: JSON.stringify({ note, basis: "statutory_finance_retention" }),
    });
    notify(t("privacyRequestLegalHoldSuccess", { id: result.id || requestId }), "success");
    await Promise.all([loadPrivacyQueue(), loadSecurityHealth()]);
  }

  // ── Feature Flags ──────────────────────────────────────────────────────────
  function formatFeatureFlagValue(value) {
    if (value && typeof value === "object") {
      const enabled = Object.prototype.hasOwnProperty.call(value, "enabled")
        ? (value.enabled ? "on" : "off")
        : "set";
      const parts = [enabled];
      if (Number.isFinite(Number(value.rollout))) parts.push(`${Number(value.rollout)}%`);
      return parts.join(" · ");
    }
    return String(value);
  }

  async function loadFeatureFlags() {
    const el_flags = document.getElementById("flagsList");
    if (!el_flags) return;
    try {
      const data = await api("/api/system/flags");
      const flags = data.flags || data || {};
      if (!Object.keys(flags).length) {
        el_flags.innerHTML = `<span class="ops-flags-empty">${escapeHtml(pickOpsText("当前没有功能开关", "No flags set.", "機能フラグはありません。", "설정된 기능 플래그가 없습니다."))}</span>`;
        return;
      }
      el_flags.innerHTML = Object.entries(flags).map(([k, v]) =>
        `<span class="ops-flag-chip">
          <b>${escapeHtml(k)}</b><span class="ops-flag-value ${v && typeof v === "object" ? (v.enabled ? "ops-flag-value-on" : "ops-flag-value-off") : (v ? "ops-flag-value-on" : "ops-flag-value-off")}">${escapeHtml(formatFeatureFlagValue(v))}</span>
          <button data-action="delete-feature-flag" data-flag="${escapeHtml(k)}" title="${escapeHtml(pickOpsText("删除", "Delete", "削除", "삭제"))}" class="ops-flag-delete">&times;</button>
        </span>`
      ).join("");
    } catch (err) {
      if (el_flags) el_flags.innerHTML = `<span class="ops-flags-error">${escapeHtml(pickOpsText("加载失败", "Load failed", "読み込み失敗", "로드 실패"))}: ${escapeHtml(describeOpsError(err))}</span>`;
    }
  }

  async function setFeatureFlag(key, value) {
    if (!key) return;
    await api("/api/system/flags", { method: "POST", body: JSON.stringify({ [key]: value }) });
    loadFeatureFlags();
  }

  // Wire flag set button
  const _flagSetBtn = document.getElementById("flagSetBtn");
  if (_flagSetBtn) {
    _flagSetBtn.addEventListener("click", async () => {
      const keyEl = document.getElementById("flagKeyInput");
      const valEl = document.getElementById("flagValInput");
      const key = (keyEl && keyEl.value.trim()) || "";
      const val = valEl ? valEl.value === "true" : true;
      if (!key) { notify("Flag name required", "warning"); return; }
      await setFeatureFlag(key, val);
      if (keyEl) keyEl.value = "";
    });
  }

  // Wire audit CSV export button
  const _flagExportBtn = document.getElementById("flagExportAuditBtn");
  if (_flagExportBtn) {
    _flagExportBtn.addEventListener("click", () => {
      const url = "/api/admin/audit?format=csv&limit=500";
      const a = document.createElement("a");
      a.href = url;
      a.download = `crossx-audit-${new Date().toISOString().slice(0,10)}.csv`;
      a.click();
    });
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

  async function refreshOpsConsole(options = {}) {
    const { showLoading = false, resetUsers = false, includeMetadata = false } = options;
    const tasks = [
      loadBoard(showLoading),
      loadAnalytics(),
      loadSecurityHealth(),
      loadPrivacyQueue(),
      loadDataQuality(),
      loadMerchantGovernance(includeMetadata),
      loadMerchantListingRequests(),
      loadMerchantListingReviewEvents(),
    ];
    if (resetUsers) tasks.push(loadUsers(true));
    if (includeMetadata) {
      tasks.push(loadKbVersion());
      tasks.push(loadGeoPartners());
    }
    const results = await Promise.allSettled(tasks);
    const rejected = results.find((item) => item.status === "rejected");
    if (rejected) throw rejected.reason;
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
      notify(t("handoffFailed", { msg: describeOpsError(err) }), "error");
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
        notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
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
      `<div class="drawer-line">${escapeHtml(t("reason"))}: ${escapeHtml(localizeVisibleOpsText(ticket.reason || "", ticket.reason || "-"))}</div>`,
      `<div class="drawer-line">${escapeHtml(t("source"))}: ${escapeHtml(localizeVisibleOpsText(ticket.source || "", ticket.source || "-"))}</div>`,
      `<div class="drawer-line">${escapeHtml(t("handler"))}: ${escapeHtml(localizeVisibleOpsText(ticket.handler || "", "-"))}</div>`,
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
          `<li>${escapeHtml(formatDateTime(item.at))} · <span class="status-badge ${escapeHtml(item.status || "open")}">${escapeHtml(localizeStatus(item.status || "open"))}</span> · ${escapeHtml(localizeVisibleOpsText(item.note || "", "-"))}</li>`,
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
          `<li>${escapeHtml(formatDateTime(item.at))} · ${escapeHtml(localizeVisibleOpsText(item.type || "", pickOpsText("备注", "Note", "メモ", "메모")))} · ${escapeHtml(localizeVisibleOpsText(item.note || "", "-"))} · ${escapeHtml(item.hash || "-")}</li>`,
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
          <div class="drawer-line">${escapeHtml(t("reason"))}: ${escapeHtml(localizeVisibleOpsText(overview.intent || "", "-"))}</div>
          <div class="drawer-line">${escapeHtml(t("city"))}: ${escapeHtml(localizeVisibleOpsText((taskDetail.sessionState && taskDetail.sessionState.slots && taskDetail.sessionState.slots.city) || "", "-"))}</div>
          <div class="drawer-line">Lane: ${escapeHtml(overview.laneId || "-")} · Rail: ${escapeHtml(localizeVisibleOpsText(overview.paymentRail || "", overview.paymentRail || "-"))}</div>
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
          `<li><span class="status-badge ${escapeHtml(step.status || "queued")}">${escapeHtml(localizeStatus(step.status || "queued"))}</span> ${escapeHtml(localizeVisibleOpsText(step.label || step.id || "", step.id || "-"))} · ${escapeHtml(localizeVisibleOpsText(step.outputSummary || "", "-"))}</li>`,
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
      .map((point) => `<li>${escapeHtml(formatDateTime(point.at))} · ${escapeHtml(localizeVisibleOpsText(point.kind || "", pickOpsText("节点", "Moment", "時点", "시점")))} · ${escapeHtml(localizeVisibleOpsText(point.note || "", "-"))}</li>`)
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
      el.drawerBody.innerHTML = `<article class="ops-empty">${escapeHtml(t("loadError", { msg: describeOpsError(err) }))}</article>`;
    }
  }

  async function openTicketDrawer(ticketId, trigger) {
    if (!ticketId || !el.drawer || !el.drawerBody) return;
    state.activeTicketId = ticketId;
    state.activeTaskId = "";
    state.activeMerchantListingRequestId = "";
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
        el.drawerBody.innerHTML = `<article class="ops-empty">${escapeHtml(t("ticketDetail"))}: ${escapeHtml(ticketId)} · ${escapeHtml(pickOpsText("未找到工单", "Ticket not found", "チケットが見つかりません", "티켓을 찾을 수 없습니다."))}</article>`;
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
      el.drawerBody.innerHTML = `<article class="ops-empty">${escapeHtml(t("loadError", { msg: describeOpsError(err) }))}</article>`;
    }
  }

  function buildMerchantListingRequestBlock(request) {
    if (!request) {
      return `
        <section class="drawer-block">
          <h4>${escapeHtml(pickOpsText("申请详情", "Request details", "申請詳細", "신청 상세"))}</h4>
          <div class="drawer-line">${escapeHtml(pickOpsText("未找到申请记录", "Request not found", "申請が見つかりません", "신청 내역을 찾을 수 없습니다."))}</div>
        </section>
      `;
    }
    const payload = request.payload || {};
    const reviewMeta = request.reviewMeta || {};
    const stores = Array.isArray(payload.stores) ? payload.stores : [];
    const lines = [
      `<div class="drawer-line">${escapeHtml(pickOpsText("商家", "Merchant", "加盟店", "상점"))}: ${escapeHtml(localizeVisibleOpsText(request.merchantName || "", "-"))}</div>`,
      `<div class="drawer-line">${escapeHtml(pickOpsText("账号类型", "Account type", "アカウント種別", "계정 유형"))}: ${escapeHtml(merchantAccountTypeLabel(request.merchantAccountType))}</div>`,
      `<div class="drawer-line">${escapeHtml(pickOpsText("申请类型", "Request type", "申請種別", "신청 유형"))}: ${escapeHtml(merchantListingRequestTypeLabel(request.requestType))}</div>`,
      `<div class="drawer-line">${escapeHtml(pickOpsText("当前状态", "Current status", "現在の状態", "현재 상태"))}: ${escapeHtml(merchantListingRequestStatusLabel(request.status))}</div>`,
      `<div class="drawer-line">${escapeHtml(pickOpsText("更新时间", "Updated", "更新時間", "업데이트 시각"))}: ${escapeHtml(formatDateTime(request.updatedAt))}</div>`,
      `<div class="drawer-line">${escapeHtml(pickOpsText("创建时间", "Created", "作成時間", "생성 시각"))}: ${escapeHtml(formatDateTime(request.createdAt))}</div>`,
      `<div class="drawer-line">${escapeHtml(pickOpsText("门店范围", "Store scope", "店舗範囲", "매장 범위"))}: ${escapeHtml(localizeVisibleOpsText(stores.length ? stores.join(", ") : "", pickOpsText("未指定", "Not specified", "未指定", "미지정")))}</div>`,
    ];
    if (request.parentAccountName) lines.push(`<div class="drawer-line">${escapeHtml(pickOpsText("企业归属", "Parent enterprise", "企業帰属", "상위 기업"))}: ${escapeHtml(localizeVisibleOpsText(request.parentAccountName || "", request.parentAccountName || ""))}</div>`);
    if (request.reviewedBy) lines.push(`<div class="drawer-line">${escapeHtml(pickOpsText("最近审核人", "Latest reviewer", "最新レビュアー", "최근 검토자"))}: ${escapeHtml(localizeVisibleOpsText(request.reviewedBy || "", request.reviewedBy || ""))}</div>`);
    if (request.reviewedAt) lines.push(`<div class="drawer-line">${escapeHtml(pickOpsText("最近审核时间", "Latest review time", "最新審査時刻", "최근 검토 시각"))}: ${escapeHtml(formatDateTime(request.reviewedAt))}</div>`);
    return `
      <section class="drawer-block">
        <h4>${escapeHtml(pickOpsText("申请详情", "Request details", "申請詳細", "신청 상세"))}</h4>
        <div class="drawer-lines">${lines.join("")}</div>
      </section>
      <section class="drawer-block">
        <h4>${escapeHtml(pickOpsText("商家说明", "Merchant note", "加盟店メモ", "상점 메모"))}</h4>
        <div class="drawer-line">${escapeHtml(localizeVisibleOpsText(String(payload.note || ""), pickOpsText("无补充说明", "No additional note", "補足なし", "추가 설명 없음")))}</div>
      </section>
      <section class="drawer-block">
        <h4>${escapeHtml(pickOpsText("审核处理", "Review handling", "審査処理", "검토 처리"))}</h4>
        <div class="drawer-lines">
          <div class="drawer-line">${escapeHtml(pickOpsText("标题", "Title", "タイトル", "제목"))}: ${escapeHtml(localizeVisibleOpsText(request.title || "", "-"))}</div>
          <div class="drawer-line">${escapeHtml(pickOpsText("当前备注", "Current note", "現在のメモ", "현재 메모"))}: ${escapeHtml(localizeVisibleOpsText(request.reviewNote || "", pickOpsText("暂无审核备注", "No review note yet", "審査メモなし", "검토 메모 없음")))}</div>
          <div class="drawer-line">${escapeHtml(pickOpsText("负责人", "Owner", "担当者", "담당자"))}: ${escapeHtml(localizeVisibleOpsText(reviewMeta.owner || "", "-"))} · ${escapeHtml(pickOpsText("下一步", "Next step", "次の一手", "다음 단계"))}: ${escapeHtml(localizeVisibleOpsText(reviewMeta.nextStep || "", "-"))}</div>
          <div class="drawer-line">${escapeHtml(pickOpsText("排期窗口", "Window", "スケジュール枠", "일정 창구"))}: ${escapeHtml(localizeVisibleOpsText(reviewMeta.targetWindow || "", "-"))} · ${escapeHtml(pickOpsText("优先级", "Priority", "優先度", "우선순위"))}: ${escapeHtml(merchantReviewPriorityLabel(reviewMeta.priority || "-"))}</div>
          <div class="drawer-line">${escapeHtml(pickOpsText("标签", "Tags", "タグ", "태그"))}: ${escapeHtml(localizeVisibleOpsText(Array.isArray(reviewMeta.tags) && reviewMeta.tags.length ? reviewMeta.tags.join(", ") : "", pickOpsText("无", "None", "なし", "없음")))}</div>
        </div>
        <div class="ops-mt-12">
          <textarea id="merchantListingReviewNote" class="ops-control" rows="4" placeholder="${escapeHtml(pickOpsText("填写审核备注，商家端会同步可见。", "Add a review note visible to the merchant side.", "加盟店側にも見える審査メモを入力します。", "상점 쪽에도 보이는 검토 메모를 입력하세요."))}">${escapeHtml(localizeVisibleOpsText(request.reviewNote || "", ""))}</textarea>
        </div>
        <div class="ops-inline-row ops-inline-wrap ops-mt-12">
          <input id="merchantListingReviewOwner" class="ops-control ops-control-sm" type="text" placeholder="${escapeHtml(pickOpsText("负责人", "Owner", "担当者", "담당자"))}" value="${escapeHtml(localizeVisibleOpsText(reviewMeta.owner || "", ""))}">
          <input id="merchantListingReviewNextStep" class="ops-control ops-control-md" type="text" placeholder="${escapeHtml(pickOpsText("下一步动作", "Next action", "次のアクション", "다음 액션"))}" value="${escapeHtml(localizeVisibleOpsText(reviewMeta.nextStep || "", ""))}">
        </div>
        <div class="ops-inline-row ops-inline-wrap ops-mt-12">
          <input id="merchantListingReviewWindow" class="ops-control ops-control-sm" type="text" placeholder="${escapeHtml(pickOpsText("排期窗口", "Schedule window", "スケジュール枠", "일정 창구"))}" value="${escapeHtml(localizeVisibleOpsText(reviewMeta.targetWindow || "", ""))}">
          <select id="merchantListingReviewPriority" class="ops-control">
            <option value="">${escapeHtml(pickOpsText("优先级", "Priority", "優先度", "우선순위"))}</option>
            <option value="normal" ${reviewMeta.priority === "normal" ? "selected" : ""}>${escapeHtml(pickOpsText("普通", "Normal", "通常", "보통"))}</option>
            <option value="high" ${reviewMeta.priority === "high" ? "selected" : ""}>${escapeHtml(pickOpsText("高", "High", "高", "높음"))}</option>
            <option value="critical" ${reviewMeta.priority === "critical" ? "selected" : ""}>${escapeHtml(pickOpsText("紧急", "Critical", "緊急", "긴급"))}</option>
          </select>
          <input id="merchantListingReviewTags" class="ops-control ops-control-md" type="text" placeholder="${escapeHtml(pickOpsText("标签，逗号分隔", "Tags, comma separated", "タグ、カンマ区切り", "태그, 쉼표 구분"))}" value="${escapeHtml(localizeVisibleOpsText(Array.isArray(reviewMeta.tags) ? reviewMeta.tags.join(", ") : "", ""))}">
        </div>
        <div class="actions ops-mt-12">
          <button class="secondary" data-action="submit-merchant-listing-review" data-id="${escapeHtml(request.id)}" data-status="in_review">${escapeHtml(pickOpsText("标记审核中", "Mark in review", "審査中にする", "검토 중으로 표시"))}</button>
          <button class="secondary" data-action="submit-merchant-listing-review" data-id="${escapeHtml(request.id)}" data-status="approved">${escapeHtml(pickOpsText("审核通过", "Approve", "承認", "승인"))}</button>
          <button class="secondary" data-action="submit-merchant-listing-review" data-id="${escapeHtml(request.id)}" data-status="rejected">${escapeHtml(pickOpsText("驳回申请", "Reject", "却下", "반려"))}</button>
        </div>
      </section>
    `;
  }

  async function openMerchantListingRequestDrawer(requestId, trigger) {
    if (!requestId || !el.drawer || !el.drawerBody) return;
    state.activeMerchantListingRequestId = requestId;
    state.activeTaskId = "";
    state.activeTicketId = "";
    const request = state.merchantListingRequests.find((item) => item.id === requestId) || null;
    if (el.drawerTitle) el.drawerTitle.textContent = `${pickOpsText("商家申请", "Merchant request", "加盟店申請", "상점 신청")} · ${requestId}`;
    el.drawerBody.innerHTML = skeleton ? skeleton.card(3) : `<article class="ops-empty">${escapeHtml(t("refresh"))}...</article>`;
    if (drawerController) {
      await drawerController.open(el.drawer, { trigger: trigger || null });
    } else {
      el.drawer.classList.remove("hidden");
      el.drawer.setAttribute("aria-hidden", "false");
    }
    el.drawerBody.innerHTML = `<div class="drawer-grid">${buildMerchantListingRequestBlock(request)}</div>`;
    motion.bindPressables(el.drawerBody);
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
        } else if (state.activeMerchantListingRequestId && drawerController && el.drawer && drawerController.isOpen(el.drawer)) {
          openMerchantListingRequestDrawer(state.activeMerchantListingRequestId);
        }
      });
    }

    if (el.refreshBtn) {
      el.refreshBtn.addEventListener("click", async () => {
        el.refreshBtn.disabled = true;
        try {
          await refreshOpsConsole();
          notify(t("copied"), "success");
        } catch (err) {
          notify(t("loadError", { msg: describeOpsError(err) }), "error");
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
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
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
        state.activeMerchantListingRequestId = "";
        return;
      }

      if (action === "ops-live-voice") {
        try {
          await toggleLiveVoiceReply();
        } catch (err) {
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
        }
        return;
      }

      if (action === "ops-live-claim") {
        try {
          await claimLiveSession(state.activeSessionId || "");
        } catch (err) {
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
        }
        return;
      }

      if (action === "ops-live-close") {
        try {
          await closeLiveSession(state.activeSessionId || "");
        } catch (err) {
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
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
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
        }
        return;
      }

      if (action === "claim-live-session") {
        const sessionId = target.dataset.session || state.activeSessionId || "";
        if (!sessionId) return;
        try {
          await claimLiveSession(sessionId);
        } catch (err) {
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
        }
        return;
      }

      if (action === "close-live-session") {
        const sessionId = target.dataset.session || state.activeSessionId || "";
        if (!sessionId) return;
        try {
          await closeLiveSession(sessionId);
        } catch (err) {
          notify(t("liveActionFailed", { msg: describeOpsError(err) }), "error");
        }
        return;
      }

      if (action === "open-ticket") {
        const ticketId = target.dataset.ticket || "";
        if (!ticketId) return;
        await openTicketDrawer(ticketId, target);
        return;
      }

      if (action === "open-merchant-listing-request") {
        const requestId = target.dataset.request || "";
        if (!requestId) return;
        await openMerchantListingRequestDrawer(requestId, target);
        return;
      }

      if (action === "toggle-merchant-listing-request-select") {
        const requestId = target.dataset.id || "";
        if (!requestId) return;
        if (target.checked) state.merchantListingRequestSelectedIds.add(requestId);
        else state.merchantListingRequestSelectedIds.delete(requestId);
        syncMerchantListingRequestSelectionUi();
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

      if (action === "acknowledge-privacy-request") {
        const requestId = target.dataset.request || "";
        if (!requestId) return;
        await acknowledgePrivacyRequest(requestId);
        return;
      }

      if (action === "reject-privacy-request") {
        const requestId = target.dataset.request || "";
        if (!requestId) return;
        await rejectPrivacyRequest(requestId);
        return;
      }

      if (action === "legal-hold-privacy-request") {
        const requestId = target.dataset.request || "";
        if (!requestId) return;
        await legalHoldPrivacyRequest(requestId);
        return;
      }

      if (action === "submit-merchant-listing-review") {
        const requestId = target.dataset.id || "";
        const nextStatus = target.dataset.status || "";
        if (!requestId || !nextStatus) return;
        const reviewNote = document.getElementById("merchantListingReviewNote")?.value || "";
        await reviewMerchantListingRequest(requestId, nextStatus, reviewNote);
        return;
      }

      if (action === "delete-feature-flag") {
        const flagName = target.dataset.flag || "";
        if (!flagName) return;
        await deleteFeatureFlag(flagName);
        return;
      }

      if (action === "geo-edit") {
        const geoId = target.dataset.id || "";
        if (!geoId) return;
        await editGeoPartner(geoId);
        return;
      }

      if (action === "geo-toggle") {
        const geoId = target.dataset.id || "";
        if (!geoId) return;
        await toggleGeoPartner(geoId, target.dataset.active === "true");
        return;
      }

      if (action === "geo-delete") {
        const geoId = target.dataset.id || "";
        if (!geoId) return;
        await deleteGeoPartner(geoId, target.dataset.name || "");
        return;
      }

      if (action === "create-handoff") {
        const taskId = target.dataset.task || "";
        if (!taskId) return;
        await createHandoff(taskId);
      }
    });
  }


  // ── Users Module ───────────────────────────────────────────────────────────
  let _usersOffset = 0;
  const _usersLimit = 50;
  let _allUsersCache = [];

  function renderUsersTable(users) {
    const tbody = document.getElementById("usersTableBody");
    if (!tbody) return;
    if (!users || !users.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="ops-table-empty-cell">${escapeHtml(pickOpsText("暂无用户数据", "No user data", "ユーザーデータはありません", "사용자 데이터가 없습니다."))}</td></tr>`;
      return;
    }
    tbody.innerHTML = users.map((u) => `
      <tr class="ops-table-row">
        <td class="ops-table-cell ops-table-cell-code">${escapeHtml((u.id || "-").slice(0, 16))}…</td>
        <td class="ops-table-cell">${escapeHtml(u.displayName || "-")}</td>
        <td class="ops-table-cell"><span class="status-badge ${u.role === "admin" ? "failed" : "success"}">${escapeHtml(localizeVisibleOpsText(u.role || "user", u.role || "user"))}</span></td>
        <td class="ops-table-cell">${u.plusActive ? `<span class="status-badge running">Plus ✓</span>` : `<span class="ops-table-dash">-</span>`}</td>
        <td class="ops-table-cell ops-table-cell-center">${escapeHtml(String(u.orderCount || 0))}</td>
        <td class="ops-table-cell">${escapeHtml(localizeVisibleOpsText(u.city || "", u.city || "-"))}</td>
        <td class="ops-table-cell ops-table-cell-muted">${escapeHtml(u.lastLogin ? new Date(u.lastLogin).toLocaleDateString() : "-")}</td>
      </tr>`).join("");
  }

  async function loadUsers(reset = false) {
    if (reset) { _usersOffset = 0; _allUsersCache = []; }
    try {
      const data = await api(`/api/admin/users?limit=${_usersLimit}&offset=${_usersOffset}`);
      const users = Array.isArray(data.users) ? data.users : [];
      _allUsersCache = reset ? users : [..._allUsersCache, ...users];
      _usersOffset += users.length;

      const totalBadge = document.getElementById("usersTotalBadge");
      if (totalBadge) totalBadge.textContent = String(data.total || _allUsersCache.length);

      const loadMoreWrap = document.getElementById("usersLoadMore");
      if (loadMoreWrap) loadMoreWrap.classList.toggle("hidden", !(_usersOffset < (data.total || 0)));

      // Apply search filter
      const searchVal = (document.getElementById("usersSearchInput") || {}).value || "";
      filterAndRenderUsers(searchVal);
    } catch (err) {
      if (!err.needsLogin) console.warn("[admin/users] load failed:", describeOpsError(err));
    }
  }

  function filterAndRenderUsers(query) {
    const q = String(query || "").toLowerCase().trim();
    const filtered = q
      ? _allUsersCache.filter((u) =>
          (u.id || "").toLowerCase().includes(q) ||
          (u.displayName || "").toLowerCase().includes(q) ||
          (u.city || "").toLowerCase().includes(q))
      : _allUsersCache;
    renderUsersTable(filtered);
  }

  // Wire users search input
  const _usersSearchEl = document.getElementById("usersSearchInput");
  if (_usersSearchEl) {
    _usersSearchEl.addEventListener("input", () => filterAndRenderUsers(_usersSearchEl.value));
  }
  const _usersLoadMoreBtn = document.getElementById("usersLoadMoreBtn");
  if (_usersLoadMoreBtn) {
    _usersLoadMoreBtn.addEventListener("click", () => loadUsers(false).catch(() => {}));
  }

  // ── Data Quality Module ─────────────────────────────────────────────────────
  async function loadDataQuality() {
    const grid = document.getElementById("dataQualityGrid");
    const detail = document.getElementById("dataQualityDetail");
    const updatedText = document.getElementById("dataQualityUpdatedText");
    if (!grid) return;
    try {
      const data = await api("/api/admin/overview");
      if (updatedText) {
        updatedText.textContent = pickOpsText(
          `更新：${new Date().toLocaleTimeString()}`,
          `Updated: ${new Date().toLocaleTimeString()}`,
          `更新: ${new Date().toLocaleTimeString()}`,
          `업데이트: ${new Date().toLocaleTimeString()}`,
        );
      }

      // Show counts from overview
      const counts = data.counts || {};
      const revenue = data.revenue || {};
      const stats = [
        { label: pickOpsText("用户总数", "Total users", "ユーザー総数", "총 사용자"), value: counts.users || 0, tone: "blue" },
        { label: pickOpsText("行程规划", "Trips planned", "旅程プラン", "여행 계획"), value: counts.trips || 0, tone: "green" },
        { label: pickOpsText("支持会话", "Support sessions", "サポート会話", "지원 세션"), value: counts.sessions || 0, tone: "amber" },
        { label: pickOpsText("审计日志", "Audit logs", "監査ログ", "감사 로그"), value: counts.auditLogs || 0, tone: "purple" },
        { label: pickOpsText("总毛收入 ¥", "Gross revenue ¥", "総売上 ¥", "총매출 ¥"), value: Number(revenue.totalGross || 0).toLocaleString(), tone: "emerald" },
        { label: pickOpsText("退款 ¥", "Refunds ¥", "返金 ¥", "환불 ¥"), value: Number(revenue.refunded || 0).toLocaleString(), tone: "red" },
        { label: pickOpsText("Plus 用户", "Plus users", "Plus ユーザー", "Plus 사용자"), value: data.plusUsers || 0, tone: "indigo" },
      ];
      grid.innerHTML = stats.map((s) => `
        <article class="ops-kpi ops-kpi-accent ops-kpi-accent--${s.tone}">
          <span class="label">${escapeHtml(String(s.label))}</span>
          <span class="value">${escapeHtml(String(s.value))}</span>
        </article>`).join("");

      // Task/order breakdown
      if (detail) {
        const tasksByStatus = data.tasksByStatus || {};
        const ordersByStatus = data.ordersByStatus || {};
        const buildStatusChips = (obj, toneMap) =>
          Object.entries(obj).map(([k, v]) =>
            `<span class="ops-status-chip">
              <span class="ops-status-dot ops-status-dot--${toneMap[k] || "slate"}"></span>
              ${escapeHtml(localizeVisibleOpsText(k, k))}: <b>${escapeHtml(String(v))}</b>
            </span>`).join("");
        const taskColors = { done: "green", running: "blue", failed: "red", pending: "amber", canceled: "slate" };
        const orderColors = { paid: "green", pending: "amber", refunded: "red", confirmed: "blue" };
        detail.innerHTML =
          `<div class="ops-detail-group"><div class="ops-section-minihead">📋 ${escapeHtml(pickOpsText("任务状态分布", "Task status breakdown", "タスク状態の分布", "작업 상태 분포"))}</div>${buildStatusChips(tasksByStatus, taskColors) || `<span class='ops-empty-inline'>${escapeHtml(pickOpsText("暂无数据", "No data", "データなし", "데이터 없음"))}</span>`}</div>` +
          `<div class="ops-detail-group"><div class="ops-section-minihead">💳 ${escapeHtml(pickOpsText("订单状态分布", "Order status breakdown", "注文状態の分布", "주문 상태 분포"))}</div>${buildStatusChips(ordersByStatus, orderColors) || `<span class='ops-empty-inline'>${escapeHtml(pickOpsText("暂无数据", "No data", "データなし", "데이터 없음"))}</span>`}</div>`;
      }
    } catch (err) {
      if (!err.needsLogin) {
        if (grid) grid.innerHTML = `<span class="ops-flags-error">${escapeHtml(pickOpsText("加载失败", "Load failed", "読み込み失敗", "로드 실패"))}: ${escapeHtml(describeOpsError(err))}</span>`;
      }
    }
  }

  // ── Knowledge Base Module ───────────────────────────────────────────────────
  async function loadKbVersion() {
    const badge = document.getElementById("kbVersionBadge");
    const info = document.getElementById("kbVersionInfo");
    try {
      const data = await api("/api/admin/knowledge/version");
      if (badge) badge.textContent = `v${data.static_knowledge_version || "-"}`;
      if (info) info.textContent = `${t("kbLastUpdated")}: ${data.last_updated ? new Date(data.last_updated).toLocaleString() : "-"}  ·  ${t("kbAttractionCount")}: ${data.attraction_count || "-"}`;
    } catch (err) {
      if (!err.needsLogin && badge) badge.textContent = "v-";
    }
  }

  async function loadKbAttractions() {
    const cityEl = document.getElementById("kbCityInput");
    const catEl  = document.getElementById("kbCategoryInput");
    const list   = document.getElementById("kbAttractionsList");
    if (!list) return;
    const city     = (cityEl && cityEl.value.trim()) || "";
    const category = (catEl && catEl.value) || "";
    try {
      const params = new URLSearchParams({ limit: "30" });
      if (city)     params.set("city",     city);
      if (category) params.set("category", category);
      const data = await api(`/api/admin/knowledge/attractions?${params}`);
      const items = Array.isArray(data.attractions) ? data.attractions : [];
      if (!items.length) {
        list.innerHTML = `<div class="ops-kb-empty">${escapeHtml(pickOpsText(`暂无数据${city ? `（${city}）` : ""}，请调整筛选条件。`, `No data${city ? ` (${localizeVisibleOpsText(city, city)})` : ""}. Adjust the filters.`, `データがありません${city ? `（${localizeVisibleOpsText(city, city)}）` : ""}。条件を調整してください。`, `데이터가 없습니다${city ? ` (${localizeVisibleOpsText(city, city)})` : ""}. 필터를 조정하세요.`))}</div>`;
        return;
      }
      list.innerHTML = `<div class="ops-kb-grid">${items.map((item) => `
        <article class="ops-kb-card">
          <div class="ops-kb-title">${escapeHtml(localizeVisibleOpsText(item.name || "", item.name || "-"))}</div>
          <div class="ops-kb-meta">${escapeHtml(localizeVisibleOpsText(item.city || "", item.city || ""))}${item.category ? ` · ${escapeHtml(localizeVisibleOpsText(item.category || "", item.category || ""))}` : ""}</div>
          ${item.rating ? `<div class="ops-kb-rating">★ ${escapeHtml(String(item.rating))}</div>` : ""}
          ${item.description ? `<div class="ops-kb-description" title="${escapeHtml(localizeVisibleOpsText(item.description, item.description))}">${escapeHtml(localizeVisibleOpsText(item.description.slice(0, 60), item.description.slice(0, 60)))}${item.description.length > 60 ? "…" : ""}</div>` : ""}
          ${item.price != null ? `<div class="ops-kb-price">¥${escapeHtml(String(item.price))}</div>` : ""}
        </article>`).join("")}</div>`;
    } catch (err) {
      if (!err.needsLogin) {
        list.innerHTML = `<span class="ops-flags-error">${escapeHtml(pickOpsText("加载失败", "Load failed", "読み込み失敗", "로드 실패"))}: ${escapeHtml(describeOpsError(err))}</span>`;
      }
    }
  }

  const _kbSearchBtn = document.getElementById("kbSearchBtn");
  if (_kbSearchBtn) {
    _kbSearchBtn.addEventListener("click", () => {
      loadKbAttractions().catch(() => {});
    });
  }
  const _kbRefreshBtn = document.getElementById("kbRefreshBtn");
  if (_kbRefreshBtn) {
    _kbRefreshBtn.addEventListener("click", () => {
      loadKbVersion().catch(() => {});
      loadKbAttractions().catch(() => {});
    });
  }
  const _kbCityInput = document.getElementById("kbCityInput");
  if (_kbCityInput) {
    _kbCityInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loadKbAttractions().catch(() => {}); });
  }

  async function init() {
    await bootstrapLanguage();
    await loadBuild();
    bindEvents();
    motion.bindPressables(document);
    const authenticated = await hasAdminSession();
    if (authenticated) {
      try {
        await refreshOpsConsole({ showLoading: true, resetUsers: true, includeMetadata: true });
      } catch (err) {
        if (!err.needsLogin) notify(t("loadError", { msg: describeOpsError(err) }), "error");
      }
      startRefreshTicker();
    } else {
      _showLoginModal();
    }
    _bindMerchantGovernanceEvents();
    _bindMerchantListingRequestEvents();
    // ── GEO Partner 面板事件绑定 ─────────────────────────────────────────────
    _bindGeoEvents();
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
      return refreshOpsConsole();
    },
  };

  let _merchantEditingId = null;

  function _merchantPayloadRoot(payload) {
    return payload && typeof payload === "object" && payload.data && typeof payload.data === "object"
      ? payload.data
      : (payload || {});
  }

  function slugifyMerchantValue(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 48);
  }

  function showMerchantSecret(message = null) {
    const box = el.merchantSecretBox;
    if (!box) return;
    if (!message) {
      box.classList.add("hidden");
      box.textContent = "";
      return;
    }
    box.classList.remove("hidden");
    if (typeof message === "string") {
      box.textContent = message;
      return;
    }
    const fragments = [];
    const appendText = (value, strong = false) => {
      const node = document.createElement(strong ? "strong" : "span");
      node.textContent = String(value || "");
      fragments.push(node);
    };
    if (message.type === "merchant_created") {
      appendText(pickOpsText("已创建商家账号。", "Merchant account created.", "加盟店アカウントを作成しました。", "상점 계정을 생성했습니다."));
      appendText(message.username || "-", true);
      appendText(pickOpsText(" 的初始密码为 ", " initial password: ", " の初期パスワード: ", " 의 초기 비밀번호: "));
      appendText(message.password || "-", true);
      appendText(pickOpsText(" ，请立即下发给商家并提醒首次登录后妥善保管。", ". Send it to the merchant now and remind them to store it safely after first login.", "。加盟店にすぐ共有し、初回ログイン後は安全に保管するよう案内してください。", ". 상점에 즉시 전달하고 첫 로그인 후 안전하게 보관하도록 안내하세요."));
    } else if (message.type === "password_reset") {
      appendText(pickOpsText("密码已重置。", "Password reset.", "パスワードを再発行しました。", "비밀번호를 재설정했습니다."));
      appendText(message.username || "-", true);
      appendText(pickOpsText(" 的临时密码为 ", " temporary password: ", " の一時パスワード: ", " 의 임시 비밀번호: "));
      appendText(message.password || "-", true);
      appendText(pickOpsText(" 。请通过安全渠道发送给商家。", ". Send it to the merchant through a secure channel.", "。安全な経路で加盟店へ共有してください。", ". 안전한 채널을 통해 상점에 전달하세요."));
    } else if (message.type === "demo_ready") {
      appendText(pickOpsText("已为 ", "Prepared isolated demo data for ", "隔離デモデータを準備しました: ", "격리 데모 데이터를 준비했습니다: "));
      appendText(message.merchantName || "-", true);
      appendText(pickOpsText(" 准备隔离测试数据：", ": ", "", ": "));
      appendText(String(message.orders || 0), true);
      appendText(pickOpsText(" 笔订单，", " orders, ", " 件の注文、", "건의 주문, "));
      appendText(String(message.tickets || 0), true);
      appendText(pickOpsText(" 条支持单，", " support tickets, ", " 件のサポートチケット、", "건의 지원 티켓, "));
      appendText(String(message.settlements || 0), true);
      appendText(pickOpsText(" 条结算。", " settlements.", " 件の精算。", "건의 정산."));
    } else {
      box.textContent = String(message.text || "");
      return;
    }
    box.replaceChildren(...fragments);
  }

  async function loadMerchantGeoOptions() {
    const payload = await api("/api/admin/geo-partners?city=&category=");
    const data = _merchantPayloadRoot(payload);
    state.merchantGeoPartners = Array.isArray(data.partners) ? data.partners : [];
    const select = document.getElementById("merchantGeoPartnerId");
    if (!select) return;
    const current = select.value;
    const options = [
      `<option value="">${escHtml(pickOpsText("暂不绑定", "Do not bind yet", "まだ連携しない", "아직 연동하지 않음"))}</option>`,
      ...state.merchantGeoPartners.map((partner) => `<option value="${escHtml(partner.id)}">${escHtml(partner.name)} · ${escHtml(partner.city || "-")}</option>`),
    ];
    select.innerHTML = options.join("");
    select.value = current || "";
  }

  function merchantAccountTypeLabel(accountType) {
    return String(accountType || "") === "enterprise_partner"
      ? pickOpsText("企业合作方", "Enterprise partner", "企業パートナー", "엔터프라이즈 파트너")
      : pickOpsText("本地商家", "Local merchant", "ローカル加盟店", "로컬 상점");
  }

  function loadMerchantParentOptions(selectedValue = "") {
    const select = document.getElementById("merchantParentAccountId");
    if (!select) return;
    const editingId = document.getElementById("merchantEditId")?.value || "";
    const enterpriseAccounts = state.merchantAccounts.filter((item) => (
      item?.accountType === "enterprise_partner" && item.id !== editingId
    ));
    select.innerHTML = [
      `<option value="">${escHtml(pickOpsText("无", "None", "なし", "없음"))}</option>`,
      ...enterpriseAccounts.map((item) => `<option value="${escHtml(item.id)}">${escHtml(item.name || item.slug || item.id)}</option>`),
    ].join("");
    select.value = selectedValue || "";
  }

  function syncMerchantGovernanceFormState() {
    const accountType = document.getElementById("merchantAccountType")?.value || "local_merchant";
    const parentSelect = document.getElementById("merchantParentAccountId");
    const geoSelect = document.getElementById("merchantGeoPartnerId");
    const isEnterprise = accountType === "enterprise_partner";
    if (parentSelect) {
      parentSelect.disabled = isEnterprise;
      if (isEnterprise) parentSelect.value = "";
    }
    if (geoSelect) {
      geoSelect.disabled = isEnterprise;
      if (isEnterprise) geoSelect.value = "";
    }
  }

  function renderMerchantGovernance(merchants) {
    const tableBody = el.merchantTableBody;
    if (!tableBody) return;
    const list = Array.isArray(merchants) ? merchants : [];
    const demoReadyCount = list.filter((merchant) => Number(merchant?.demoWorkspace?.orders || 0) > 0).length;
    if (el.merchantGovernanceBadge) el.merchantGovernanceBadge.textContent = pickOpsText(`${list.length} 商家 / ${demoReadyCount} 可测试`, `${list.length} merchants / ${demoReadyCount} demo-ready`, `${list.length} 加盟店 / ${demoReadyCount} テスト可`, `${list.length}개 상점 / ${demoReadyCount}개 테스트 가능`);
    if (!list.length) {
      tableBody.innerHTML = `<tr><td colspan="8" class="ops-table-empty-cell">${escapeHtml(pickOpsText("暂无商家后台账号", "No merchant console accounts", "加盟店コンソールアカウントはありません", "상점 콘솔 계정이 없습니다."))}</td></tr>`;
      return;
    }
    tableBody.innerHTML = list.map((merchant) => {
      const owner = Array.isArray(merchant.users) && merchant.users.length ? merchant.users[0] : null;
      const linkedGeo = merchant.geoPartner && merchant.geoPartner.name ? `${localizeVisibleOpsText(merchant.geoPartner.name || "", merchant.geoPartner.name || "-")} · ${localizeVisibleOpsText(merchant.geoPartner.city || "", merchant.geoPartner.city || "-")}` : pickOpsText("未绑定", "Unbound", "未連携", "미연결");
      const demoWorkspace = merchant.demoWorkspace || {};
      const accountTypeLabel = merchantAccountTypeLabel(merchant.accountType);
      const ownershipLine = merchant.accountType === "enterprise_partner"
        ? pickOpsText("内部聚合视图", "Internal aggregate view", "内部集約ビュー", "내부 집계 뷰")
        : (merchant.parentAccount?.name ? pickOpsText(`归属：${merchant.parentAccount.name}`, `Parent: ${merchant.parentAccount.name}`, `帰属: ${merchant.parentAccount.name}`, `소속: ${merchant.parentAccount.name}`) : pickOpsText("独立门店", "Standalone store", "独立店舗", "독립 매장"));
      const recommendationLabel = merchant.accountType === "enterprise_partner"
        ? pickOpsText("平台聚合账号", "Platform aggregate account", "プラットフォーム集約アカウント", "플랫폼 집계 계정")
        : (merchant.recommendationEnabled ? pickOpsText("展示中", "Listed", "掲載中", "노출 중") : pickOpsText("关闭", "Off", "停止", "비활성"));
      const demoSummary = Number(demoWorkspace.orders || 0) > 0
        ? pickOpsText(`测试数据: ${demoWorkspace.orders || 0} 订单 / ${demoWorkspace.tickets || 0} 支持单 / ${demoWorkspace.settlements || 0} 结算`, `Demo data: ${demoWorkspace.orders || 0} orders / ${demoWorkspace.tickets || 0} tickets / ${demoWorkspace.settlements || 0} settlements`, `テストデータ: ${demoWorkspace.orders || 0} 注文 / ${demoWorkspace.tickets || 0} チケット / ${demoWorkspace.settlements || 0} 精算`, `테스트 데이터: ${demoWorkspace.orders || 0} 주문 / ${demoWorkspace.tickets || 0} 티켓 / ${demoWorkspace.settlements || 0} 정산`)
        : pickOpsText("测试数据: 未准备", "Demo data: not prepared", "テストデータ: 未準備", "테스트 데이터: 미준비");
      return `
        <tr class="ops-table-row">
          <td class="ops-merchant-main" data-label="${escHtml(pickOpsText("商家", "Merchant", "加盟店", "상점"))}">
            <div class="ops-merchant-name">${escHtml(merchant.name || "-")}</div>
            <div class="ops-merchant-meta">slug: ${escHtml(merchant.slug || "-")}</div>
            <div class="ops-merchant-meta">${escHtml(localizeVisibleOpsText(merchant.city || "", merchant.city || "-"))} · ${escHtml(localizeVisibleOpsText(merchant.category || "", merchant.category || "-"))}</div>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("类型/归属", "Type / ownership", "種別 / 帰属", "유형 / 소속"))}">
            <div>${escHtml(accountTypeLabel)}</div>
            <div class="ops-merchant-meta">${escHtml(ownershipLine)}</div>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("负责人", "Owner", "担当者", "담당자"))}">
            <div>${escHtml(localizeVisibleOpsText(owner?.username || "", owner?.username || "-"))}</div>
            <div class="ops-merchant-meta">${escHtml(localizeVisibleOpsText(owner?.role || "", owner?.role || "-"))}</div>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("绑定 GEO", "Linked GEO", "連携 GEO", "연동 GEO"))}">
            <div>${escHtml(linkedGeo)}</div>
            <div class="ops-merchant-meta">${escHtml(demoSummary)}</div>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("状态", "Status", "状態", "상태"))}">
            <span class="ops-pill ${merchant.status === "active" ? "ops-pill-active" : "ops-pill-inactive"}">${escHtml(localizeVisibleOpsText(merchant.status || "", merchant.status || "-"))}</span>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("推荐", "Recommendation", "推薦", "추천"))}">
            <span class="ops-pill ${merchant.recommendationEnabled ? "ops-pill-active" : "ops-pill-inactive"}">${escHtml(recommendationLabel)}</span>
          </td>
          <td class="ops-table-cell ops-table-cell-muted" data-label="${escHtml(pickOpsText("更新时间", "Updated", "更新時刻", "업데이트 시각"))}">${escHtml(merchant.updatedAt ? new Date(merchant.updatedAt).toLocaleString() : "-")}</td>
          <td class="ops-table-cell ops-merchant-actions" data-label="${escHtml(pickOpsText("操作", "Actions", "操作", "작업"))}">
            <button data-action="merchant-edit" data-id="${escHtml(merchant.id)}" class="ops-mini-btn">${escHtml(pickOpsText("编辑", "Edit", "編集", "편집"))}</button>
            <button data-action="merchant-status" data-id="${escHtml(merchant.id)}" data-status="${merchant.status === "active" ? "suspended" : "active"}" class="ops-mini-btn">${escHtml(merchant.status === "active" ? pickOpsText("停用", "Disable", "停止", "비활성") : pickOpsText("启用", "Enable", "有効化", "활성"))}</button>
            <button data-action="merchant-reset-password" data-id="${escHtml(merchant.id)}" class="ops-mini-btn">${escHtml(pickOpsText("重置密码", "Reset password", "パスワードを再発行", "비밀번호 재설정"))}</button>
            <button data-action="merchant-provision-demo" data-id="${escHtml(merchant.id)}" class="ops-mini-btn">${escHtml(Number(demoWorkspace.orders || 0) > 0 ? pickOpsText("重建测试数据", "Rebuild demo data", "デモデータを再生成", "데모 데이터 다시 만들기") : pickOpsText("生成测试数据", "Generate demo data", "デモデータを生成", "데모 데이터 생성"))}</button>
          </td>
        </tr>
      `;
    }).join("");
  }

  async function loadMerchantGovernance(includeGeoOptions = false) {
    try {
      if (includeGeoOptions || !state.merchantGeoPartners.length) await loadMerchantGeoOptions();
      const payload = await api("/api/admin/merchant-accounts");
      const data = _merchantPayloadRoot(payload);
      state.merchantAccounts = Array.isArray(data.merchants) ? data.merchants : [];
      loadMerchantParentOptions(document.getElementById("merchantParentAccountId")?.value || "");
      syncMerchantGovernanceFormState();
      renderMerchantGovernance(state.merchantAccounts);
    } catch (err) {
      if (el.merchantTableBody) {
        el.merchantTableBody.innerHTML = `<tr><td colspan="8" class="ops-table-error-cell">${escHtml(pickOpsText("加载失败", "Load failed", "読み込み失敗", "로드 실패"))}: ${escHtml(describeOpsError(err))}</td></tr>`;
      }
    }
  }

  function resetMerchantForm() {
    _merchantEditingId = null;
    showMerchantSecret("");
    const defaults = {
      merchantEditId: "",
      merchantName: "",
      merchantSlug: "",
      merchantUsername: "",
      merchantPassword: "",
      merchantAccountType: "local_merchant",
      merchantCity: "",
      merchantCategory: "restaurant",
      merchantParentAccountId: "",
      merchantGeoPartnerId: "",
      merchantStatus: "active",
    };
    Object.entries(defaults).forEach(([id, value]) => {
      const node = document.getElementById(id);
      if (!node) return;
      node.value = value;
    });
    const title = document.getElementById("merchantFormTitle");
    if (title) title.textContent = pickOpsText("➕ 新建商家后台账号", "➕ Create merchant console account", "➕ 加盟店コンソールアカウント作成", "➕ 상점 콘솔 계정 만들기");
    document.getElementById("merchantCancelEditBtn")?.classList.add("hidden");
    loadMerchantParentOptions("");
    syncMerchantGovernanceFormState();
  }

  function editMerchantAccount(id) {
    const merchant = state.merchantAccounts.find((item) => item.id === id);
    if (!merchant) return;
    _merchantEditingId = id;
    const owner = Array.isArray(merchant.users) && merchant.users.length ? merchant.users[0] : null;
    const fillMap = {
      merchantEditId: merchant.id || "",
      merchantName: merchant.name || "",
      merchantSlug: merchant.slug || "",
      merchantUsername: owner?.username || "",
      merchantPassword: "",
      merchantAccountType: merchant.accountType || "local_merchant",
      merchantCity: merchant.city || "",
      merchantCategory: merchant.category || "restaurant",
      merchantParentAccountId: merchant.parentAccount?.id || "",
      merchantGeoPartnerId: merchant.linkedGeoPartnerId || "",
      merchantStatus: merchant.status || "active",
    };
    Object.entries(fillMap).forEach(([idKey, value]) => {
      const node = document.getElementById(idKey);
      if (node) node.value = value;
    });
    const title = document.getElementById("merchantFormTitle");
    if (title) title.textContent = pickOpsText(`✏️ 编辑：${merchant.name || merchant.slug}`, `✏️ Editing: ${merchant.name || merchant.slug}`, `✏️ 編集: ${merchant.name || merchant.slug}`, `✏️ 편집: ${merchant.name || merchant.slug}`);
    document.getElementById("merchantCancelEditBtn")?.classList.remove("hidden");
    loadMerchantParentOptions(merchant.parentAccount?.id || "");
    syncMerchantGovernanceFormState();
    document.getElementById("merchantGovernanceForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  async function saveMerchantGovernance() {
    const name = document.getElementById("merchantName")?.value.trim() || "";
    const slug = slugifyMerchantValue(document.getElementById("merchantSlug")?.value || name);
    const username = String(document.getElementById("merchantUsername")?.value || "").trim().toLowerCase();
    const accountType = document.getElementById("merchantAccountType")?.value || "local_merchant";
    if (!name) { notify(pickOpsText("请填写商家名称", "Please enter a merchant name", "加盟店名を入力してください", "상점 이름을 입력해 주세요."), "error"); return; }
    if (!slug) { notify(pickOpsText("请填写商家 slug", "Please enter a merchant slug", "加盟店 slug を入力してください", "상점 slug를 입력해 주세요."), "error"); return; }
    if (!username) { notify(pickOpsText("请填写商家登录用户名", "Please enter a merchant login username", "加盟店ログインユーザー名を入力してください", "상점 로그인 사용자명을 입력해 주세요."), "error"); return; }
    const payload = {
      name,
      slug,
      username,
      password: document.getElementById("merchantPassword")?.value.trim() || "",
      accountType,
      city: document.getElementById("merchantCity")?.value.trim() || "",
      category: document.getElementById("merchantCategory")?.value || "restaurant",
      parentAccountId: accountType === "local_merchant" ? (document.getElementById("merchantParentAccountId")?.value || "") : "",
      geoPartnerId: accountType === "local_merchant" ? (document.getElementById("merchantGeoPartnerId")?.value || "") : "",
      status: document.getElementById("merchantStatus")?.value || "active",
    };
    try {
      let result;
      let secretMessage = "";
      if (_merchantEditingId) {
        result = await api(`/api/admin/merchant-accounts/${encodeURIComponent(_merchantEditingId)}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        notify(pickOpsText(`商家「${name}」已更新`, `Merchant "${name}" updated`, `加盟店「${name}」を更新しました`, `상점 "${name}"을(를) 업데이트했습니다`), "success");
      } else {
        result = await api("/api/admin/merchant-accounts", {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const data = _merchantPayloadRoot(result);
        if (data.temporaryPassword) {
          secretMessage = { type: "merchant_created", username, password: data.temporaryPassword };
        }
        notify(pickOpsText(`商家「${name}」已创建`, `Merchant "${name}" created`, `加盟店「${name}」を作成しました`, `상점 "${name}"을(를) 생성했습니다`), "success");
      }
      resetMerchantForm();
      if (secretMessage) showMerchantSecret(secretMessage);
      await loadMerchantGovernance(true);
    } catch (err) {
      notify(`${pickOpsText("保存失败", "Save failed", "保存に失敗しました", "저장에 실패했습니다.")}: ${describeOpsError(err)}`, "error");
    }
  }

  async function toggleMerchantAccountStatus(id, nextStatus) {
    try {
      await api(`/api/admin/merchant-accounts/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus }),
      });
      notify(nextStatus === "active"
        ? pickOpsText("商家账号已启用", "Merchant account enabled", "加盟店アカウントを有効化しました", "상점 계정을 활성화했습니다")
        : pickOpsText("商家账号已停用", "Merchant account disabled", "加盟店アカウントを停止しました", "상점 계정을 비활성화했습니다"), "success");
      await loadMerchantGovernance(false);
    } catch (err) {
      notify(`${pickOpsText("状态切换失败", "Status update failed", "状態更新に失敗しました", "상태 변경에 실패했습니다.")}: ${describeOpsError(err)}`, "error");
    }
  }

  async function resetMerchantPassword(id) {
    const ok = confirm(pickOpsText("确认重置该商家 owner 账号密码？", "Reset this merchant owner password?", "この加盟店 owner アカウントのパスワードを再発行しますか？", "이 상점 owner 계정 비밀번호를 재설정할까요?"));
    if (!ok) return;
    try {
      const payload = await api(`/api/admin/merchant-accounts/${encodeURIComponent(id)}/reset-password`, {
        method: "POST",
        body: JSON.stringify({}),
      });
      const data = _merchantPayloadRoot(payload);
      showMerchantSecret({
        type: "password_reset",
        username: data.merchantUser?.username || "-",
        password: data.temporaryPassword || "-",
      });
      notify(pickOpsText("商家密码已重置", "Merchant password reset", "加盟店パスワードを再発行しました", "상점 비밀번호를 재설정했습니다"), "success");
      await loadMerchantGovernance(false);
    } catch (err) {
      notify(`${pickOpsText("重置密码失败", "Password reset failed", "パスワード再発行に失敗しました", "비밀번호 재설정에 실패했습니다.")}: ${describeOpsError(err)}`, "error");
    }
  }

  async function provisionMerchantDemoWorkspace(id) {
    const merchant = state.merchantAccounts.find((item) => item.id === id);
    const hasDemoData = Number(merchant?.demoWorkspace?.orders || 0) > 0;
    const ok = confirm(hasDemoData
      ? pickOpsText("确认重建该商家的隔离测试数据？这只会覆盖该商家的 demo 订单/结算/支持单，不影响真实用户数据。", "Rebuild this merchant's isolated demo workspace? Only this merchant's demo orders, settlements, and support tickets will be replaced.", "この加盟店の隔離デモデータを再生成しますか？この加盟店のデモ注文・精算・サポートチケットのみを上書きし、実データには影響しません。", "이 상점의 격리 데모 데이터를 다시 만들까요? 이 상점의 데모 주문, 정산, 지원 티켓만 덮어쓰고 실제 데이터에는 영향이 없습니다.")
      : pickOpsText("确认生成该商家的隔离测试数据？这不会影响真实用户数据。", "Generate an isolated demo workspace for this merchant? Real user data will not be affected.", "この加盟店向けの隔離デモデータを生成しますか？実ユーザーデータには影響しません。", "이 상점용 격리 데모 데이터를 생성할까요? 실제 사용자 데이터에는 영향이 없습니다."));
    if (!ok) return;
    try {
      const payload = await api(`/api/admin/merchant-accounts/${encodeURIComponent(id)}/provision-demo`, {
        method: "POST",
        body: JSON.stringify({ reset: true }),
      });
      const data = _merchantPayloadRoot(payload);
      const summary = data.summary || {};
      showMerchantSecret({
        type: "demo_ready",
        merchantName: data.merchant?.name || merchant?.name || "-",
        orders: summary.orders || 0,
        tickets: summary.tickets || 0,
        settlements: summary.settlements || 0,
      });
      notify(pickOpsText("商家测试数据已准备", "Merchant demo data ready", "加盟店デモデータを準備しました", "상점 데모 데이터를 준비했습니다"), "success");
      await loadMerchantGovernance(false);
    } catch (err) {
      notify(`${pickOpsText("生成测试数据失败", "Demo provisioning failed", "デモデータ生成に失敗しました", "데모 데이터 생성에 실패했습니다.")}: ${describeOpsError(err)}`, "error");
    }
  }

  function _bindMerchantGovernanceEvents() {
    if (_bindMerchantGovernanceEvents.bound) return;
    _bindMerchantGovernanceEvents.bound = true;
    document.getElementById("merchantSaveBtn")?.addEventListener("click", saveMerchantGovernance);
    document.getElementById("merchantRefreshBtn")?.addEventListener("click", () => {
      loadMerchantGovernance(true).catch((err) => notify(`${pickOpsText("商家列表刷新失败", "Merchant list refresh failed", "加盟店一覧の更新に失敗しました", "상점 목록 새로고침에 실패했습니다.")}: ${describeOpsError(err)}`, "error"));
    });
    document.getElementById("merchantCancelEditBtn")?.addEventListener("click", resetMerchantForm);
    document.getElementById("merchantName")?.addEventListener("blur", () => {
      const slugInput = document.getElementById("merchantSlug");
      const usernameInput = document.getElementById("merchantUsername");
      if (slugInput && !slugInput.value.trim()) slugInput.value = slugifyMerchantValue(document.getElementById("merchantName")?.value || "");
      if (usernameInput && !usernameInput.value.trim()) usernameInput.value = `${slugifyMerchantValue(slugInput?.value || "")}_owner`;
    });
    document.getElementById("merchantAccountType")?.addEventListener("change", syncMerchantGovernanceFormState);
    el.merchantTableBody?.addEventListener("click", (event) => {
      const target = event.target.closest("button[data-action]");
      if (!target) return;
      const action = target.dataset.action || "";
      const id = target.dataset.id || "";
      if (!id) return;
      if (action === "merchant-edit") {
        editMerchantAccount(id);
        return;
      }
      if (action === "merchant-status") {
        toggleMerchantAccountStatus(id, target.dataset.status || "suspended");
        return;
      }
      if (action === "merchant-reset-password") {
        resetMerchantPassword(id);
        return;
      }
      if (action === "merchant-provision-demo") {
        provisionMerchantDemoWorkspace(id);
      }
    });
  }

  function merchantListingRequestTypeLabel(type) {
    const map = {
      listing_launch_request: pickOpsText("推荐上线申请", "Listing launch request", "掲載開始申請", "노출 개시 신청"),
      listing_material_update: pickOpsText("资料更新", "Material update", "資料更新", "자료 업데이트"),
      service_capability_update: pickOpsText("服务能力补充", "Service capability update", "サービス能力更新", "서비스 역량 업데이트"),
      network_activation_request: pickOpsText("门店纳管申请", "Network activation request", "店舗連携申請", "매장 편입 신청"),
    };
    return map[String(type || "").trim()] || (type || "-");
  }

  function merchantListingRequestStatusLabel(status) {
    const map = {
      pending: pickOpsText("待处理", "Pending", "未対応", "대기"),
      in_review: pickOpsText("审核中", "In review", "審査中", "검토 중"),
      approved: pickOpsText("已通过", "Approved", "承認済み", "승인됨"),
      rejected: pickOpsText("已驳回", "Rejected", "却下済み", "반려됨"),
    };
    return map[String(status || "").trim()] || (status || "-");
  }

  function merchantReviewPriorityLabel(priority) {
    const map = {
      normal: pickOpsText("普通", "Normal", "通常", "보통"),
      high: pickOpsText("高", "High", "高", "높음"),
      critical: pickOpsText("紧急", "Critical", "緊急", "긴급"),
    };
    return map[String(priority || "").trim()] || (priority || "-");
  }

  function computeMerchantListingRequestSla(list) {
    const now = Date.now();
    const rows = Array.isArray(list) ? list : [];
    const hoursSince = (iso) => {
      const ts = new Date(iso || "").getTime();
      if (!Number.isFinite(ts)) return 0;
      return Math.max(0, Math.round((now - ts) / 36e5));
    };
    const pending = rows.filter((item) => item.status === "pending");
    const inReview = rows.filter((item) => item.status === "in_review");
    return {
      pendingCount: pending.length,
      inReviewCount: inReview.length,
      approvedCount: rows.filter((item) => item.status === "approved").length,
      rejectedCount: rows.filter((item) => item.status === "rejected").length,
      breachedCount: rows.filter((item) => ["pending", "in_review"].includes(item.status) && hoursSince(item.createdAt) >= 48).length,
      dueSoonCount: rows.filter((item) => ["pending", "in_review"].includes(item.status) && hoursSince(item.createdAt) >= 24 && hoursSince(item.createdAt) < 48).length,
    };
  }

  function renderMerchantListingRequestSlaSummary(list) {
    if (!el.merchantListingRequestsSlaSummary) return;
    const summary = computeMerchantListingRequestSla(list);
    const cards = [
      { label: pickOpsText("待处理", "Pending", "未対応", "대기"), value: summary.pendingCount },
      { label: pickOpsText("审核中", "In review", "審査中", "검토 중"), value: summary.inReviewCount },
      { label: pickOpsText("已通过", "Approved", "承認済み", "승인됨"), value: summary.approvedCount },
      { label: pickOpsText("已驳回", "Rejected", "却下済み", "반려됨"), value: summary.rejectedCount },
      { label: pickOpsText("24h 预警", "24h warning", "24時間警告", "24시간 경고"), value: summary.dueSoonCount },
      { label: pickOpsText("48h 超时", "48h breached", "48時間超過", "48시간 초과"), value: summary.breachedCount },
    ];
    el.merchantListingRequestsSlaSummary.innerHTML = cards
      .map((item) => `<article class="ops-kpi"><span class="label">${escHtml(item.label)}</span><span class="value">${escHtml(String(item.value))}</span></article>`)
      .join("");
  }

  function syncMerchantListingRequestSelectionUi() {
    const selectedCount = state.merchantListingRequestSelectedIds.size;
    const meta = document.getElementById("merchantListingRequestSelectionMeta");
    if (meta) meta.textContent = selectedCount
      ? pickOpsText(`已选择 ${selectedCount} 条申请`, `${selectedCount} requests selected`, `${selectedCount} 件選択中`, `${selectedCount}건 선택됨`)
      : pickOpsText("未选择申请", "No request selected", "申請未選択", "선택된 신청 없음");
    const selectAll = document.getElementById("merchantListingRequestSelectAll");
    if (selectAll) {
      const visibleIds = state.merchantListingRequests.map((item) => item.id);
      selectAll.checked = visibleIds.length > 0 && visibleIds.every((id) => state.merchantListingRequestSelectedIds.has(id));
      selectAll.indeterminate = visibleIds.some((id) => state.merchantListingRequestSelectedIds.has(id)) && !selectAll.checked;
    }
  }

  function getFilteredMerchantListingRequests(sourceList) {
    const priority = document.getElementById("merchantListingRequestPriorityFilter")?.value || "";
    const tag = String(document.getElementById("merchantListingRequestTagFilter")?.value || "").trim().toLowerCase();
    const rows = Array.isArray(sourceList) ? sourceList : [];
    return rows.filter((item) => {
      const reviewMeta = item.reviewMeta || {};
      const tags = Array.isArray(reviewMeta.tags) ? reviewMeta.tags.map((entry) => String(entry).toLowerCase()) : [];
      if (priority && String(reviewMeta.priority || "") !== priority) return false;
      if (tag && !tags.some((entry) => entry.includes(tag))) return false;
      return true;
    });
  }

  function renderMerchantListingRequests(requests) {
    const tableBody = el.merchantListingRequestsTableBody;
    if (!tableBody) return;
    const list = Array.isArray(requests) ? requests : [];
    const pendingCount = list.filter((item) => item.status === "pending").length;
    if (el.merchantListingRequestsBadge) {
      el.merchantListingRequestsBadge.textContent = pickOpsText(
        `${pendingCount} ${pickOpsText("待处理", "Pending", "未対応", "대기")} / ${list.length} ${pickOpsText("总计", "Total", "合計", "총계")}`,
        `${pendingCount} Pending / ${list.length} Total`,
        `${pendingCount} 件未対応 / ${list.length} 件合計`,
        `${pendingCount}건 대기 / 총 ${list.length}건`
      );
    }
    renderMerchantListingRequestSlaSummary(list);
    if (!list.length) {
      tableBody.innerHTML = `<tr><td colspan="8" class="ops-table-empty-cell">${escapeHtml(pickOpsText("当前没有商家申请", "No merchant requests", "加盟店申請はありません", "상점 신청이 없습니다."))}</td></tr>`;
      syncMerchantListingRequestSelectionUi();
      return;
    }
    tableBody.innerHTML = list.map((item) => {
      const stores = Array.isArray(item.payload?.stores) ? item.payload.stores : [];
      const accountType = merchantAccountTypeLabel(item.merchantAccountType);
      const ownership = item.parentAccountName ? pickOpsText(`归属：${item.parentAccountName}`, `Parent: ${item.parentAccountName}`, `帰属: ${item.parentAccountName}`, `소속: ${item.parentAccountName}`) : accountType;
      const note = String(item.payload?.note || "").trim();
      const reviewMeta = item.reviewMeta || {};
      const isChecked = state.merchantListingRequestSelectedIds.has(item.id);
      return `
        <tr class="ops-table-row">
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("选择", "Select", "選択", "선택"))}">
            <input type="checkbox" data-action="toggle-merchant-listing-request-select" data-id="${escHtml(item.id)}" ${isChecked ? "checked" : ""}>
          </td>
          <td class="ops-merchant-main" data-label="${escHtml(pickOpsText("商家", "Merchant", "加盟店", "상점"))}">
            <div class="ops-merchant-name">${escHtml(localizeVisibleOpsText(item.merchantName || "", item.merchantName || "-"))}</div>
            <div class="ops-merchant-meta">${escHtml(localizeVisibleOpsText(item.merchantCity || "", item.merchantCity || "-"))} · ${escHtml(localizeVisibleOpsText(item.merchantCategory || "", item.merchantCategory || "-"))}</div>
            <div class="ops-merchant-meta">${escHtml(ownership)}</div>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("申请", "Request", "申請", "신청"))}">
            <div>${escHtml(localizeVisibleOpsText(item.title || "", item.title || "-"))}</div>
            <div class="ops-merchant-meta">${escHtml(merchantListingRequestTypeLabel(item.requestType))}</div>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("类型", "Type", "種別", "유형"))}">${escHtml(accountType)}</td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("状态", "Status", "状態", "상태"))}">
            <span class="ops-pill ${item.status === "approved" ? "ops-pill-active" : (item.status === "rejected" ? "ops-pill-inactive" : "ops-pill-priority")}">${escHtml(merchantListingRequestStatusLabel(item.status))}</span>
          </td>
          <td class="ops-table-cell" data-label="${escHtml(pickOpsText("内容", "Content", "内容", "내용"))}">
            <div>${escHtml(localizeVisibleOpsText(note || "", pickOpsText("无补充说明", "No additional note", "補足なし", "추가 설명 없음")))}</div>
            <div class="ops-merchant-meta">${escHtml(pickOpsText("涉及门店", "Stores", "対象店舗", "대상 매장"))}: ${escHtml(localizeVisibleOpsText(stores.length ? stores.join(", ") : "", pickOpsText("未指定", "Not specified", "未指定", "미지정")))}</div>
            <div class="ops-merchant-meta">${escHtml(pickOpsText("审核备注", "Review note", "審査メモ", "검토 메모"))}: ${escHtml(localizeVisibleOpsText(item.reviewNote || "", pickOpsText("暂无", "None", "なし", "없음")))}</div>
            <div class="ops-merchant-meta">${escHtml(pickOpsText("后续动作", "Next step", "次のアクション", "다음 단계"))}: ${escHtml(localizeVisibleOpsText(reviewMeta.nextStep || "", pickOpsText("未填写", "Not filled", "未入力", "미입력")))} ${reviewMeta.targetWindow ? `· ${escHtml(localizeVisibleOpsText(reviewMeta.targetWindow || "", reviewMeta.targetWindow || ""))}` : ""}</div>
          </td>
          <td class="ops-table-cell ops-table-cell-muted" data-label="${escHtml(pickOpsText("更新时间", "Updated", "更新時刻", "업데이트 시각"))}">${escHtml(item.updatedAt ? new Date(item.updatedAt).toLocaleString() : "-")}</td>
          <td class="ops-table-cell ops-merchant-actions" data-label="${escHtml(pickOpsText("操作", "Actions", "操作", "작업"))}">
            <button data-action="open-merchant-listing-request" data-request="${escHtml(item.id)}" class="ops-mini-btn">${escHtml(pickOpsText("查看详情", "View details", "詳細を見る", "상세 보기"))}</button>
          </td>
        </tr>
      `;
    }).join("");
    syncMerchantListingRequestSelectionUi();
  }

  function renderMerchantListingReviewEvents(logs) {
    if (!el.merchantListingReviewAuditList) return;
    const list = Array.isArray(logs) ? logs : [];
    if (!list.length) {
      el.merchantListingReviewAuditList.innerHTML = `<div class="ops-table-empty-cell">${escHtml(pickOpsText("当前没有审批动作", "No review actions yet", "審査アクションはまだありません", "검토 작업이 아직 없습니다."))}</div>`;
      return;
    }
    el.merchantListingReviewAuditList.innerHTML = list.map((entry) => {
      const input = entry.toolInput && typeof entry.toolInput === "object" ? entry.toolInput : {};
      const output = entry.toolOutput && typeof entry.toolOutput === "object" ? entry.toolOutput : {};
      const status = String(entry.what || "").split(".").pop();
      const statusLabel = merchantListingRequestStatusLabel(status);
      const tagLine = Array.isArray(output.followUp?.tags) && output.followUp.tags.length
        ? output.followUp.tags.map((tag) => localizeVisibleOpsText(tag || "", tag || "-")).join(", ")
        : pickOpsText("无标签", "No tags", "タグなし", "태그 없음");
      return `
        <article class="ops-review-feed-item">
          <div class="ops-review-feed-head">
            <div class="ops-review-feed-title">${escHtml(statusLabel)} · ${escHtml(input.requestId || "-")}</div>
            <span class="ops-pill ${status === "approved" ? "ops-pill-active" : (status === "rejected" ? "ops-pill-inactive" : "ops-pill-priority")}">${escHtml(input.batch ? pickOpsText("批量", "Batch", "一括", "일괄") : pickOpsText("单条", "Single", "単件", "단건"))}</span>
          </div>
          <div class="ops-review-feed-meta">${escHtml(pickOpsText("时间", "Time", "時刻", "시간"))}: ${escHtml(formatDateTime(entry.at || entry.ts || ""))} · ${escHtml(pickOpsText("操作人", "Operator", "担当者", "작업자"))}: ${escHtml(localizeVisibleOpsText(entry.who || "", entry.who || "-"))}</div>
          <div class="ops-review-feed-meta">${escHtml(pickOpsText("备注", "Review note", "審査メモ", "검토 메모"))}: ${escHtml(localizeVisibleOpsText(output.reviewNote || "", pickOpsText("无", "None", "なし", "없음")))} · ${escHtml(pickOpsText("下一步", "Next step", "次のアクション", "다음 단계"))}: ${escHtml(localizeVisibleOpsText(output.followUp?.nextStep || "", pickOpsText("未填写", "Not filled", "未入力", "미입력")))}</div>
          <div class="ops-review-feed-meta">${escHtml(pickOpsText("负责人", "Owner", "担当者", "담당자"))}: ${escHtml(localizeVisibleOpsText(output.followUp?.owner || "", pickOpsText("未分配", "Unassigned", "未割当", "미배정")))} · ${escHtml(pickOpsText("窗口", "Window", "期間", "기간"))}: ${escHtml(localizeVisibleOpsText(output.followUp?.targetWindow || "", pickOpsText("未填写", "Not filled", "未入力", "미입력")))} · ${escHtml(pickOpsText("标签", "Tags", "タグ", "태그"))}: ${escHtml(tagLine)}</div>
        </article>
      `;
    }).join("");
  }

  async function loadMerchantListingReviewEvents() {
    if (!el.merchantListingReviewAuditList) return;
    try {
      const payload = await api("/api/admin/audit?kind=merchant.listing.request.review&limit=12");
      const data = _merchantPayloadRoot(payload);
      state.merchantListingReviewEvents = Array.isArray(data.logs) ? data.logs : [];
      renderMerchantListingReviewEvents(state.merchantListingReviewEvents);
    } catch (err) {
      el.merchantListingReviewAuditList.innerHTML = `<div class="ops-table-error-cell">${escHtml(pickOpsText("审批动作加载失败", "Failed to load review actions", "審査アクションの読み込みに失敗しました", "검토 작업을 불러오지 못했습니다."))}: ${escHtml(describeOpsError(err))}</div>`;
    }
  }

  async function loadMerchantListingRequests() {
    const tableBody = el.merchantListingRequestsTableBody;
    const status = document.getElementById("merchantListingRequestStatusFilter")?.value || "";
    const accountType = document.getElementById("merchantListingRequestAccountTypeFilter")?.value || "";
    try {
      const query = new URLSearchParams();
      if (status) query.set("status", status);
      if (accountType) query.set("accountType", accountType);
      query.set("limit", "200");
      const payload = await api(`/api/admin/merchant-listing-requests?${query.toString()}`);
      const data = _merchantPayloadRoot(payload);
      state.merchantListingRequestsAll = Array.isArray(data.requests) ? data.requests : [];
      state.merchantListingRequests = getFilteredMerchantListingRequests(state.merchantListingRequestsAll);
      const visibleIds = new Set(state.merchantListingRequests.map((item) => item.id));
      state.merchantListingRequestSelectedIds = new Set(
        [...state.merchantListingRequestSelectedIds].filter((id) => visibleIds.has(id))
      );
      renderMerchantListingRequests(state.merchantListingRequests);
    } catch (err) {
      if (tableBody) {
        tableBody.innerHTML = `<tr><td colspan="8" class="ops-table-error-cell">${escHtml(pickOpsText("加载失败", "Load failed", "読み込み失敗", "로드 실패"))}: ${escHtml(describeOpsError(err))}</td></tr>`;
      }
    }
  }

  async function reviewMerchantListingRequest(id, nextStatus, reviewNote = "") {
    const request = state.merchantListingRequests.find((item) => item.id === id);
    if (!request) return;
    const followUp = {
      owner: document.getElementById("merchantListingReviewOwner")?.value.trim() || "",
      nextStep: document.getElementById("merchantListingReviewNextStep")?.value.trim() || "",
      targetWindow: document.getElementById("merchantListingReviewWindow")?.value.trim() || "",
      priority: document.getElementById("merchantListingReviewPriority")?.value || "",
      tags: String(document.getElementById("merchantListingReviewTags")?.value || "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    };
    try {
      await api(`/api/admin/merchant-listing-requests/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: nextStatus, reviewNote, followUp }),
      });
      notify(pickOpsText(`申请已更新为${merchantListingRequestStatusLabel(nextStatus)}`, `Request updated to ${merchantListingRequestStatusLabel(nextStatus)}`, `申請を${merchantListingRequestStatusLabel(nextStatus)}に更新しました`, `신청 상태를 ${merchantListingRequestStatusLabel(nextStatus)}(으)로 업데이트했습니다`), "success");
      await Promise.all([
        loadMerchantListingRequests(),
        loadMerchantGovernance(false),
        loadMerchantListingReviewEvents(),
      ]);
      if (state.activeMerchantListingRequestId === id && el.drawer && drawerController && drawerController.isOpen(el.drawer)) {
        await openMerchantListingRequestDrawer(id);
      }
    } catch (err) {
      notify(`${pickOpsText("审核失败", "Review failed", "審査に失敗しました", "검토에 실패했습니다.")}: ${describeOpsError(err)}`, "error");
    }
  }

  function _bindMerchantListingRequestEvents() {
    if (_bindMerchantListingRequestEvents.bound) return;
    _bindMerchantListingRequestEvents.bound = true;
    document.getElementById("merchantListingRequestStatusFilter")?.addEventListener("change", () => {
      loadMerchantListingRequests().catch((err) => notify(`${pickOpsText("申请列表加载失败", "Request list load failed", "申請一覧の読み込みに失敗しました", "신청 목록을 불러오지 못했습니다.")}: ${describeOpsError(err)}`, "error"));
    });
    document.getElementById("merchantListingRequestAccountTypeFilter")?.addEventListener("change", () => {
      loadMerchantListingRequests().catch((err) => notify(`${pickOpsText("申请列表加载失败", "Request list load failed", "申請一覧の読み込みに失敗しました", "신청 목록을 불러오지 못했습니다.")}: ${describeOpsError(err)}`, "error"));
    });
    document.getElementById("merchantListingRequestPriorityFilter")?.addEventListener("change", () => {
      state.merchantListingRequests = getFilteredMerchantListingRequests(state.merchantListingRequestsAll);
      renderMerchantListingRequests(state.merchantListingRequests);
    });
    document.getElementById("merchantListingRequestTagFilter")?.addEventListener("input", () => {
      state.merchantListingRequests = getFilteredMerchantListingRequests(state.merchantListingRequestsAll);
      renderMerchantListingRequests(state.merchantListingRequests);
    });
    document.getElementById("merchantListingRequestRefreshBtn")?.addEventListener("click", () => {
      Promise.all([loadMerchantListingRequests(), loadMerchantListingReviewEvents()])
        .catch((err) => notify(`${pickOpsText("申请列表刷新失败", "Request list refresh failed", "申請一覧の更新に失敗しました", "신청 목록 새로고침에 실패했습니다.")}: ${describeOpsError(err)}`, "error"));
    });
    document.getElementById("merchantListingRequestSelectAll")?.addEventListener("change", (event) => {
      const checked = event.target.checked;
      state.merchantListingRequests.forEach((item) => {
        if (checked) state.merchantListingRequestSelectedIds.add(item.id);
        else state.merchantListingRequestSelectedIds.delete(item.id);
      });
      renderMerchantListingRequests(state.merchantListingRequests);
    });
    document.getElementById("merchantListingRequestBatchApplyBtn")?.addEventListener("click", async () => {
      const ids = [...state.merchantListingRequestSelectedIds];
      const nextStatus = document.getElementById("merchantListingRequestBatchStatus")?.value || "";
      if (!ids.length) { notify(pickOpsText("请先选择申请", "Select at least one request first", "先に申請を選択してください", "먼저 신청을 선택하세요."), "warning"); return; }
      if (!nextStatus) { notify(pickOpsText("请选择批量状态", "Select a batch status", "一括更新する状態を選択してください", "일괄 상태를 선택하세요."), "warning"); return; }
      const owner = document.getElementById("merchantListingRequestBatchOwner")?.value.trim() || "";
      const targetWindow = document.getElementById("merchantListingRequestBatchWindow")?.value.trim() || "";
      try {
        const payload = await api("/api/admin/merchant-listing-requests/bulk-review", {
          method: "POST",
          body: JSON.stringify({
            ids,
            status: nextStatus,
            reviewNote: pickOpsText(`${merchantListingRequestStatusLabel(nextStatus)} · 批量处理`, `${merchantListingRequestStatusLabel(nextStatus)} · Batch update`, `${merchantListingRequestStatusLabel(nextStatus)} · 一括処理`, `${merchantListingRequestStatusLabel(nextStatus)} · 일괄 처리`),
            followUp: {
              owner,
              targetWindow,
              nextStep: nextStatus === "approved"
                ? pickOpsText("进入批量排期", "Move into batch scheduling", "一括日程調整へ進める", "일괄 일정 조정으로 이동")
                : (nextStatus === "rejected"
                  ? pickOpsText("等待商家补充材料", "Wait for merchant resubmission", "加盟店の追加資料待ち", "상점 추가 자료 대기")
                  : pickOpsText("进入审核队列", "Move into review queue", "審査キューへ入れる", "검토 대기열로 이동")),
              priority: nextStatus === "approved" ? "high" : "normal",
              tags: ["batch-update"],
            },
          }),
        });
        const data = _merchantPayloadRoot(payload);
        const summary = data.summary || {};
        const issueCount = (Array.isArray(summary.missingIds) ? summary.missingIds.length : 0)
          + (Array.isArray(summary.failedIds) ? summary.failedIds.length : 0);
        notify(
          issueCount
            ? pickOpsText(`已更新 ${summary.updatedCount || 0} 条申请，${issueCount} 条需复核`, `Updated ${summary.updatedCount || 0} requests, ${issueCount} require follow-up`, `${summary.updatedCount || 0} 件更新、${issueCount} 件は再確認が必要です`, `${summary.updatedCount || 0}건 업데이트, ${issueCount}건 추가 확인 필요`)
            : pickOpsText(`已批量更新 ${summary.updatedCount || ids.length} 条申请`, `Batch updated ${summary.updatedCount || ids.length} requests`, `${summary.updatedCount || ids.length} 件を一括更新しました`, `${summary.updatedCount || ids.length}건 일괄 업데이트 완료`),
          issueCount ? "warning" : "success"
        );
        state.merchantListingRequestSelectedIds.clear();
        await Promise.all([
          loadMerchantListingRequests(),
          loadMerchantListingReviewEvents(),
        ]);
        if (ids.includes(state.activeMerchantListingRequestId) && el.drawer && drawerController && drawerController.isOpen(el.drawer)) {
          await openMerchantListingRequestDrawer(state.activeMerchantListingRequestId);
        }
      } catch (err) {
        notify(`${pickOpsText("批量处理失败", "Bulk review failed", "一括処理に失敗しました", "일괄 처리에 실패했습니다.")}: ${describeOpsError(err)}`, "error");
      }
    });
  }

  // ── GEO Partner 面板逻辑 ──────────────────────────────────────────────────
  const GEO_CATEGORY_LABELS = {
    restaurant: { zh: "🍜 餐厅", en: "🍜 Restaurant", ja: "🍜 レストラン", ko: "🍜 식당" },
    hotel:      { zh: "🏨 酒店", en: "🏨 Hotel", ja: "🏨 ホテル", ko: "🏨 호텔" },
    attraction: { zh: "🏛️ 景点", en: "🏛️ Attraction", ja: "🏛️ 観光", ko: "🏛️ 관광" },
    transport:  { zh: "🚕 交通", en: "🚕 Transport", ja: "🚕 交通", ko: "🚕 교통" },
    shopping:   { zh: "🛍️ 购物", en: "🛍️ Shopping", ja: "🛍️ 買い物", ko: "🛍️ 쇼핑" },
    other:      { zh: "📌 其他", en: "📌 Other", ja: "📌 その他", ko: "📌 기타" },
  };

  let _geoEditingId = null;

  async function loadGeoPartners(filter = {}) {
    const city     = filter.city     ?? (document.getElementById("geoFilterCity")?.value.trim()     || "");
    const category = filter.category ?? (document.getElementById("geoFilterCategory")?.value         || "");
    const activeRaw = filter.active  ?? (document.getElementById("geoFilterActive")?.value           || "");
    const qs = new URLSearchParams();
    if (city)      qs.set("city", city);
    if (category)  qs.set("category", category);
    if (activeRaw === "1") qs.set("activeOnly", "1");
    try {
      const payload = await api(`/api/admin/geo-partners?${qs}`);
      const data = _merchantPayloadRoot(payload);
      const partners = data.partners || [];
      _renderGeoTable(partners, activeRaw);
      const active = partners.filter(p => p.active).length;
      const badge = document.getElementById("geoPartnersBadge");
      if (badge) badge.textContent = pickOpsText(`${active} 活跃`, `${active} active`, `${active} 稼働中`, `${active} 활성`);
    } catch (e) {
      const tb = document.getElementById("geoPartnersTableBody");
      if (tb) tb.innerHTML = `<tr><td colspan="6" class="ops-table-error-cell">${escapeHtml(pickOpsText("加载失败", "Load failed", "読み込み失敗", "로드 실패"))}: ${escapeHtml(describeOpsError(e))}</td></tr>`;
    }
  }

  function _renderGeoTable(partners, activeFilter = "") {
    const tb = document.getElementById("geoPartnersTableBody");
    if (!tb) return;
    const filtered = activeFilter === "1" ? partners.filter(p => p.active) :
                     activeFilter === "0" ? partners.filter(p => !p.active) : partners;
    if (!filtered.length) {
      tb.innerHTML = `<tr><td colspan="6" class="ops-table-empty-cell ops-table-empty-cell-lg">${escapeHtml(pickOpsText("暂无合作商家，请在上方表单添加", "No GEO partners yet. Add one above.", "提携先はまだありません。上のフォームから追加してください。", "협력 파트너가 없습니다. 위 폼에서 추가하세요."))}</td></tr>`;
      return;
    }
    tb.innerHTML = filtered.map(p => `
      <tr data-id="${p.id}" class="ops-table-row ops-geo-row">
        <td class="ops-geo-main" data-label="${escHtml(pickOpsText("商家名", "Merchant", "加盟店名", "상점명"))}">
          ${escHtml(localizeVisibleOpsText(p.name || "", p.name || "-"))}
          ${p.address ? `<div class="ops-geo-subline">📍 ${escHtml(localizeVisibleOpsText(p.address || "", p.address || ""))}</div>` : ""}
          ${p.description ? `<div class="ops-geo-subcopy">${escHtml(localizeVisibleOpsText(p.description.slice(0, 60), p.description.slice(0, 60)))}${p.description.length > 60 ? "…" : ""}</div>` : ""}
        </td>
        <td class="ops-table-cell" data-label="${escHtml(pickOpsText("城市", "City", "都市", "도시"))}">${escHtml(localizeVisibleOpsText(p.city || "", p.city || "-"))}</td>
        <td class="ops-table-cell" data-label="${escHtml(pickOpsText("类别", "Category", "カテゴリ", "카테고리"))}">${escHtml((() => { const label = GEO_CATEGORY_LABELS[p.category]; return label ? pickOpsText(label.zh, label.en, label.ja, label.ko) : localizeVisibleOpsText(p.category || "", p.category || "-"); })())}</td>
        <td class="ops-table-cell" data-label="${escHtml(pickOpsText("优先级", "Priority", "優先度", "우선순위"))}">
          <span class="ops-pill ops-pill-priority">${p.priority_score}</span>
        </td>
        <td class="ops-table-cell" data-label="${escHtml(pickOpsText("状态", "Status", "状態", "상태"))}">
          <span class="ops-pill ${p.active ? "ops-pill-active" : "ops-pill-inactive"}">
            ${p.active ? pickOpsText("✅ 活跃", "✅ Active", "✅ 稼働中", "✅ 활성") : pickOpsText("⏸ 停用", "⏸ Disabled", "⏸ 停止", "⏸ 비활성")}
          </span>
        </td>
        <td class="ops-table-cell ops-geo-actions" data-label="${escHtml(pickOpsText("操作", "Actions", "操作", "작업"))}">
          <button data-action="geo-edit" data-id="${escHtml(p.id)}" class="ops-mini-btn">${escapeHtml(pickOpsText("编辑", "Edit", "編集", "편집"))}</button>
          <button data-action="geo-toggle" data-id="${escHtml(p.id)}" data-active="${String(!p.active)}" class="ops-mini-btn">${escapeHtml(p.active ? pickOpsText("停用", "Disable", "停止", "비활성") : pickOpsText("启用", "Enable", "有効化", "활성"))}</button>
          <button data-action="geo-delete" data-id="${escHtml(p.id)}" data-name="${escHtml(p.name)}" class="ops-mini-btn ops-mini-btn-danger">${escapeHtml(pickOpsText("删除", "Delete", "削除", "삭제"))}</button>
        </td>
      </tr>
    `).join("");
  }

  function escHtml(s) {
    return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
  }

  function _resetGeoForm() {
    _geoEditingId = null;
    const ids = ["geoEditId","geoName","geoCity","geoAddress","geoContact","geoDescription","geoTags"];
    ids.forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const pri = document.getElementById("geoPriority"); if (pri) pri.value = "90";
    const cat = document.getElementById("geoCategory"); if (cat) cat.value = "restaurant";
    const act = document.getElementById("geoActive"); if (act) act.checked = true;
    const title = document.getElementById("geoFormTitle"); if (title) title.textContent = pickOpsText("➕ 新增合作商家", "➕ Add GEO partner", "➕ 提携店舗を追加", "➕ 제휴 매장 추가");
    const cancelBtn = document.getElementById("geoCancelEditBtn"); if (cancelBtn) cancelBtn.classList.add("hidden");
  }

  async function editGeoPartner(id) {
    try {
      const payload = await api("/api/admin/geo-partners?city=&category=");
      const data = _merchantPayloadRoot(payload);
      const p = (data.partners || []).find(x => x.id === id);
      if (!p) return;
      _geoEditingId = id;
      document.getElementById("geoEditId").value = id;
      document.getElementById("geoName").value = p.name || "";
      document.getElementById("geoCity").value = p.city || "";
      document.getElementById("geoAddress").value = p.address || "";
      document.getElementById("geoContact").value = p.contact || "";
      document.getElementById("geoDescription").value = p.description || "";
      document.getElementById("geoTags").value = p.tags || "";
      document.getElementById("geoPriority").value = p.priority_score ?? 90;
      document.getElementById("geoCategory").value = p.category || "restaurant";
      document.getElementById("geoActive").checked = Boolean(p.active);
      const title = document.getElementById("geoFormTitle"); if (title) title.textContent = pickOpsText(`✏️ 编辑：${localizeVisibleOpsText(p.name || "", p.name || "-")}`, `✏️ Editing: ${localizeVisibleOpsText(p.name || "", p.name || "-")}`, `✏️ 編集: ${localizeVisibleOpsText(p.name || "", p.name || "-")}`, `✏️ 편집: ${localizeVisibleOpsText(p.name || "", p.name || "-")}`);
      const cancelBtn = document.getElementById("geoCancelEditBtn"); if (cancelBtn) cancelBtn.classList.remove("hidden");
      document.getElementById("geoPartnerForm")?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    } catch(e) { notify(`${pickOpsText("加载商家数据失败", "Failed to load merchant data", "店舗データの読み込みに失敗しました", "매장 데이터를 불러오지 못했습니다.")}: ${describeOpsError(e)}`, "error"); }
  }

  async function deleteGeoPartner(id, name) {
    if (!confirm(pickOpsText(`确认删除「${name}」？删除后 AI 将不再优先推荐此商家。`, `Delete "${name}"? AI will stop prioritizing this merchant after removal.`, `「${name}」を削除しますか？削除後、AI の優先推薦対象から外れます。`, `"${name}"을(를) 삭제하시겠습니까? 삭제 후 AI 우선 추천에서 제외됩니다.`))) return;
    try {
      await api(`/api/admin/geo-partners/${id}`, { method: "DELETE" });
      notify(pickOpsText(`已删除「${name}」`, `Deleted "${name}"`, `「${name}」を削除しました`, `"${name}"을(를) 삭제했습니다`), "success");
      loadGeoPartners();
    } catch(e) { notify(`${pickOpsText("删除失败", "Delete failed", "削除に失敗しました", "삭제에 실패했습니다.")}: ${describeOpsError(e)}`, "error"); }
  }

  async function toggleGeoPartner(id, active) {
    try {
      await api(`/api/admin/geo-partners/${id}/toggle`, {
        method: "PATCH",
        body: JSON.stringify({ active }),
      });
      notify(active ? pickOpsText("已启用商家", "Merchant enabled", "店舗を有効化しました", "매장을 활성화했습니다") : pickOpsText("已停用商家", "Merchant disabled", "店舗を無効化しました", "매장을 비활성화했습니다"), "success");
      loadGeoPartners();
    } catch(e) { notify(`${pickOpsText("操作失败", "Action failed", "操作に失敗しました", "작업에 실패했습니다.")}: ${describeOpsError(e)}`, "error"); }
  }

  function _bindGeoEvents() {
    // 保存按钮
    document.getElementById("geoSaveBtn")?.addEventListener("click", async () => {
      const name = document.getElementById("geoName")?.value.trim();
      const city = document.getElementById("geoCity")?.value.trim();
      if (!name) { notify(pickOpsText("请填写商家名称", "Please enter a merchant name", "店舗名を入力してください", "매장 이름을 입력해 주세요."), "error"); return; }
      if (!city) { notify(pickOpsText("请填写城市", "Please enter a city", "都市を入力してください", "도시를 입력해 주세요."), "error"); return; }
      const payload = {
        name,
        city,
        category:       document.getElementById("geoCategory")?.value || "restaurant",
        address:        document.getElementById("geoAddress")?.value.trim() || "",
        contact:        document.getElementById("geoContact")?.value.trim() || "",
        description:    document.getElementById("geoDescription")?.value.trim() || "",
        tags:           document.getElementById("geoTags")?.value.trim() || "",
        priority_score: parseInt(document.getElementById("geoPriority")?.value || "90", 10),
        active:         document.getElementById("geoActive")?.checked !== false,
      };
      try {
        if (_geoEditingId) {
          await api(`/api/admin/geo-partners/${_geoEditingId}`, {
            method: "PUT",
            body: JSON.stringify(payload),
          });
          notify(pickOpsText(`「${name}」已更新`, `"${name}" updated`, `「${name}」を更新しました`, `"${name}"을(를) 업데이트했습니다`), "success");
        } else {
          await api("/api/admin/geo-partners", {
            method: "POST",
            body: JSON.stringify(payload),
          });
          notify(pickOpsText(`「${name}」已添加，AI 将在相关问题中优先推荐`, `"${name}" added and will be prioritized in relevant AI recommendations`, `「${name}」を追加し、関連する AI 推薦で優先表示します`, `"${name}"을(를) 추가했고 관련 AI 추천에서 우선 노출합니다`), "success");
        }
        _resetGeoForm();
        loadGeoPartners();
      } catch(e) { notify(`${pickOpsText("保存失败", "Save failed", "保存に失敗しました", "저장에 실패했습니다.")}: ${describeOpsError(e)}`, "error"); }
    });

    // 取消编辑
    document.getElementById("geoCancelEditBtn")?.addEventListener("click", _resetGeoForm);

    // 筛选 & 刷新
    document.getElementById("geoFilterBtn")?.addEventListener("click", () => loadGeoPartners());
    document.getElementById("geoRefreshBtn")?.addEventListener("click", () => loadGeoPartners());
  }
})();
