// Merchant console entrypoint. This file is the dedicated partner-facing runtime
// for store operators: profile upkeep, listing requests, order fulfillment,
// support collaboration, and settlement review live here instead of the admin app.
(function createMerchantConsole() {
  const MERCHANT_TEXT = {
    ZH: {
      pageTitle: "Cross X Merchant Console",
      langLabel: "语言",
      heroTitle: "Merchant Console",
      heroCopy: "面向合作商家的独立工作台。只保留商家能直接执行、直接交付、直接对客解释的内容，帮助你把资料维护、门店运营、订单履约和支持协同放在同一条链路里处理。",
      heroTagProfile: "资料维护",
      heroTagFulfillment: "履约执行",
      heroTagSupport: "支持协同",
      heroTagSettlement: "结算回看",
      scopeItem1: "商家只维护自己可执行、可交付、可被客户理解的经营内容。",
      scopeItem2: "平台推荐位、GEO 策略与风控阈值仍由内部 admin 统一治理，不在这里开放直接控制。",
      scopeItem3: "日常工作默认按“经营看板 → 申请/资料 → 履约/支持 → 结算”推进，减少反复切页。",
      openUserApp: "打开用户端",
      loginTitle: "登录商家后台",
      loginCopy: "使用商家账号进入独立工作台。这个入口只服务商家日常经营，与内部 admin 后台完全分离。",
      loginItem1: "登录后优先确认平台推荐状态和门店网络，再处理订单履约与支持单。",
      loginItem2: "如果只是更新资料、补充服务能力或提交纳管申请，可直接在中段完成，不必再找平台代录。",
      loginUserLabel: "用户名",
      loginPasswordLabel: "密码",
      loginPasswordPlaceholder: "输入商家账号密码",
      loginButton: "进入商家工作台",
      loginLoading: "登录中...",
      refreshWorkspace: "刷新工作台",
      logout: "退出登录",
      navMetrics: "经营看板",
      navPlatform: "平台状态",
      navRequest: "平台申请",
      navProfile: "商家资料",
      navOrders: "订单履约",
      navSupport: "支持协同",
      navSettlement: "结算记录",
      sessionExpired: "登录状态已失效，请重新登录",
      serviceUnavailable: "服务暂不可用，请稍后重试",
      requestFailed: "请求处理失败，请重试",
      activityEmpty: "暂无操作记录",
      actionConfirm: "确认接单",
      actionStart: "开始履约",
      actionDeliver: "标记交付",
      actionIssue: "反馈异常",
      orderNoAction: "当前订单状态无需商家补充操作。",
      issuePlaceholderEnabled: "如遇履约异常、用户改期、线下无法接待等情况，请填写说明后点击“反馈异常”。",
      issuePlaceholderDisabled: "该订单当前没有任务上下文，暂不可提交异常。",
      orderEmpty: "当前筛选条件下没有订单",
      orderCity: "城市",
      orderType: "类型",
      orderAmount: "金额",
      orderTask: "任务",
      orderSupport: "支持单",
      orderCreatedAt: "创建时间",
      settlementGross: "累计毛收入",
      settlementNet: "累计净收入",
      settlementPendingAmount: "待结算金额",
      settlementSettledAmount: "已结算金额",
      settlementPendingCount: "待结算笔数",
      settlementSettledCount: "已结算笔数",
      settlementEmpty: "当前没有结算明细",
      settlementOrderStatus: "订单状态",
      settlementTask: "任务",
      settlementGrossLine: "毛收入",
      settlementNetLine: "净收入",
      settlementMarkup: "平台加价",
      settlementRefund: "退款",
      settlementOrderAmount: "订单金额",
      settlementSettledNet: "已结净额",
      settlementUpdatedAt: "更新时间",
      supportEmpty: "当前没有和该商家相关的支持单",
      supportOrder: "订单",
      supportOrderStatus: "订单状态",
      supportTask: "任务",
      supportReason: "原因",
      supportProgress: "处理进度",
      supportEta: "预计响应",
      supportMessageCount: "消息数",
      supportCreatedAt: "创建时间",
      supportUpdatedAt: "更新时间",
      supportLatest: "最新动态",
      supportNoMessage: "暂无消息",
      supportNotePlaceholder: "补充履约情况、处理进度或线下沟通结果，发送给支持团队。",
      supportSendNote: "发送商家备注",
      listingEmpty: "当前没有平台申请记录",
      listingFallbackTitle: "平台申请",
      listingType: "类型",
      listingCreatedAt: "创建时间",
      listingReviewNote: "处理备注",
      listingReviewNotePending: "等待平台审核",
      listingNextStep: "平台下一步",
      listingNextStepPending: "待平台安排",
      listingReviewedAt: "最近审核",
      platformGovernance: "治理方式",
      platformGovernanceValue: "平台内部治理",
      platformLinkedStores: "纳管门店",
      platformActiveStores: "推荐中门店",
      platformAccountType: "账号类型",
      platformLatestRequest: "最近申请",
      platformNoRequest: "暂无申请",
      platformSummary: "说明",
      platformSummaryFallback: "平台推荐策略由内部治理。",
      platformBadgeActive: "平台推荐中",
      platformBadgePending: "待平台审核",
      platformBadgeInactive: "尚未纳管",
      platformTagsEmpty: "当前没有平台标签",
      attentionPending: "待平台纳管",
      attentionSupport: "支持单 {count} 条",
      attentionAccountStatus: "账号状态 {status}",
      attentionGeoMissing: "未绑定 GEO 资料",
      filterAllCities: "全部城市",
      cityUnspecified: "未标注城市",
      scopedNeedAttention: "需关注门店",
      scopedPendingListing: "待纳管",
      scopedSupportBacklog: "支持积压",
      scopedCityCoverage: "城市覆盖",
      scopedFilterSummary: "当前筛选 {current} / {total} 家",
      scopedActiveSummary: "推荐中 {count} 家",
      scopedPendingSummary: "待纳管 {count} 家",
      scopedGroupEmpty: "当前没有门店分组信息",
      scopedMode: "工作台模式",
      scopedModeEnterprise: "多门店聚合视图",
      scopedModeSingle: "单门店工作台",
      scopedVisibleStores: "可查看门店",
      scopedActiveStores: "推荐中门店",
      scopedPendingSupport: "待处理支持",
      scopedCurrentFilter: "当前筛选",
      scopedBadgeEnterprise: "企业网络工作台 · {count} 家门店",
      scopedBadgeSingle: "当前门店",
      scopedListFilteredEmpty: "当前筛选条件下没有门店",
      scopedListEmpty: "当前没有可查看的门店",
      scopedBadgeAttention: "需关注",
      scopedBadgeActive: "推荐中",
      scopedBadgeInactive: "未推荐",
      scopedStatus: "状态",
      scopedOpenSupport: "待处理支持单",
      scopedGeoBinding: "GEO 绑定",
      scopedGeoUnbound: "未绑定",
      scopedAttentionReason: "关注原因",
      scopedAttentionNone: "当前无异常",
      listingStoresEmpty: "暂无可选门店",
      listingStoreStateActive: "已在推荐池",
      listingStoreStatePending: "待纳管",
      checklistEmpty: "当前没有额外运营提示",
      profileParent: "归属 {name}",
      profileUpdatedAt: "更新于 {time}",
      profileNotUpdated: "未更新",
      noticeEnterprise: "企业合作方账号可聚合查看旗下门店状态，推荐上线与 GEO 策略仍由平台内部治理。",
      noticeSingle: "商家端不开放 GEO 与推荐策略直接编辑，如需上架或更新推荐资料，请通过下方平台申请提交。",
      exportLoading: "导出中...",
      exportSuccess: "结算明细 CSV 已生成",
      exportFailed: "结算导出失败：{msg}",
      profileSaving: "保存中...",
      profileSaved: "商家资料已保存",
      profileSaveFailed: "资料保存失败：{msg}",
      requestTitleRequired: "请填写申请标题",
      requestNoteRequired: "请填写申请说明",
      requestSubmitting: "提交中...",
      requestSubmitted: "平台推荐 / 资料申请已提交",
      requestSubmitFailed: "平台申请提交失败：{msg}",
      orderIssueNoteRequired: "请先填写异常说明，再提交给支持协同",
      orderActionLoading: "处理中...",
      orderActionDone: "订单操作已完成",
      orderActionFailed: "订单操作失败：{msg}",
      supportNoteRequired: "请先填写协同备注，再发送给支持团队",
      supportSending: "发送中...",
      supportSent: "商家备注已发送",
      supportSendFailed: "备注发送失败：{msg}",
      refreshFailed: "刷新失败：{msg}",
      orderLoadFailed: "订单加载失败：{msg}",
      orderRefreshFailed: "订单刷新失败：{msg}",
      supportLoadFailed: "支持单加载失败：{msg}",
      supportRefreshFailed: "支持单刷新失败：{msg}",
      settlementLoadFailed: "结算加载失败：{msg}",
      settlementRefreshFailed: "结算刷新失败：{msg}",
      initFailed: "初始化失败：{msg}",
    },
    EN: {
      pageTitle: "Cross X Merchant Console",
      langLabel: "Language",
      heroTitle: "Merchant Console",
      heroCopy: "A focused workspace for partner merchants. It keeps only the content merchants can execute, deliver, and explain to customers directly, so profile updates, store operations, fulfillment, and support coordination stay in one flow.",
      heroTagProfile: "Profile upkeep",
      heroTagFulfillment: "Fulfillment",
      heroTagSupport: "Support sync",
      heroTagSettlement: "Settlements",
      scopeItem1: "Merchants should only maintain operational content they can execute, deliver, and explain clearly to customers.",
      scopeItem2: "Platform ranking, GEO strategy, and risk thresholds remain under internal admin governance and are not directly editable here.",
      scopeItem3: "Daily work should move in one order: business overview -> requests/profile -> fulfillment/support -> settlements.",
      openUserApp: "Open user app",
      loginTitle: "Sign in to Merchant Console",
      loginCopy: "Use your merchant account to enter the merchant workspace. This entry is only for merchant operations and stays separate from the internal admin console.",
      loginItem1: "Check platform listing status and store network first, then handle fulfillment and support tickets.",
      loginItem2: "If you only need to update materials, add service capabilities, or submit a governance request, finish it here without offline relay.",
      loginUserLabel: "Username",
      loginPasswordLabel: "Password",
      loginPasswordPlaceholder: "Enter merchant account password",
      loginButton: "Enter merchant workspace",
      loginLoading: "Signing in...",
      refreshWorkspace: "Refresh workspace",
      logout: "Sign out",
      navMetrics: "Overview",
      navPlatform: "Platform",
      navRequest: "Requests",
      navProfile: "Profile",
      navOrders: "Fulfillment",
      navSupport: "Support",
      navSettlement: "Settlements",
      sessionExpired: "Session expired. Please sign in again.",
      serviceUnavailable: "Service is temporarily unavailable. Please try again later.",
      requestFailed: "The request could not be completed. Please retry.",
      activityEmpty: "No recent activity",
      actionConfirm: "Accept order",
      actionStart: "Start fulfillment",
      actionDeliver: "Mark delivered",
      actionIssue: "Report issue",
      orderNoAction: "No additional merchant action is needed for the current order status.",
      issuePlaceholderEnabled: "If fulfillment is blocked, the traveler changes schedule, or onsite service cannot continue, add a note and click Report issue.",
      issuePlaceholderDisabled: "This order has no linked task context, so issue reporting is unavailable for now.",
      orderEmpty: "No orders match the current filter",
      orderCity: "City",
      orderType: "Type",
      orderAmount: "Amount",
      orderTask: "Task",
      orderSupport: "Support",
      orderCreatedAt: "Created",
      settlementGross: "Gross revenue",
      settlementNet: "Net revenue",
      settlementPendingAmount: "Pending settlement",
      settlementSettledAmount: "Settled amount",
      settlementPendingCount: "Pending items",
      settlementSettledCount: "Settled items",
      settlementEmpty: "No settlement records yet",
      settlementOrderStatus: "Order status",
      settlementTask: "Task",
      settlementGrossLine: "Gross",
      settlementNetLine: "Net",
      settlementMarkup: "Platform markup",
      settlementRefund: "Refund",
      settlementOrderAmount: "Order amount",
      settlementSettledNet: "Settled net",
      settlementUpdatedAt: "Updated",
      supportEmpty: "No support tickets are linked to this merchant",
      supportOrder: "Order",
      supportOrderStatus: "Order status",
      supportTask: "Task",
      supportReason: "Reason",
      supportProgress: "Progress",
      supportEta: "ETA",
      supportMessageCount: "Messages",
      supportCreatedAt: "Created",
      supportUpdatedAt: "Updated",
      supportLatest: "Latest update",
      supportNoMessage: "No message yet",
      supportNotePlaceholder: "Add fulfillment context, progress, or onsite coordination notes for the support team.",
      supportSendNote: "Send merchant note",
      listingEmpty: "No platform requests yet",
      listingFallbackTitle: "Platform request",
      listingType: "Type",
      listingCreatedAt: "Created",
      listingReviewNote: "Review note",
      listingReviewNotePending: "Waiting for platform review",
      listingNextStep: "Platform next step",
      listingNextStepPending: "Pending platform scheduling",
      listingReviewedAt: "Reviewed",
      platformGovernance: "Governance",
      platformGovernanceValue: "Platform-managed internally",
      platformLinkedStores: "Managed stores",
      platformActiveStores: "Stores in listing",
      platformAccountType: "Account type",
      platformLatestRequest: "Latest request",
      platformNoRequest: "No request yet",
      platformSummary: "Summary",
      platformSummaryFallback: "Platform listing strategy is managed internally.",
      platformBadgeActive: "Listed on platform",
      platformBadgePending: "Pending review",
      platformBadgeInactive: "Not onboarded yet",
      platformTagsEmpty: "No platform tags yet",
      attentionPending: "Pending platform onboarding",
      attentionSupport: "{count} support ticket(s)",
      attentionAccountStatus: "Account status {status}",
      attentionGeoMissing: "GEO profile not linked",
      filterAllCities: "All cities",
      cityUnspecified: "Unspecified city",
      scopedNeedAttention: "Stores needing attention",
      scopedPendingListing: "Pending onboarding",
      scopedSupportBacklog: "Support backlog",
      scopedCityCoverage: "Cities covered",
      scopedFilterSummary: "Filtered {current} / {total} stores",
      scopedActiveSummary: "Listed {count}",
      scopedPendingSummary: "Pending {count}",
      scopedGroupEmpty: "No store grouping data yet",
      scopedMode: "Workspace mode",
      scopedModeEnterprise: "Multi-store network view",
      scopedModeSingle: "Single-store workspace",
      scopedVisibleStores: "Visible stores",
      scopedActiveStores: "Listed stores",
      scopedPendingSupport: "Open support",
      scopedCurrentFilter: "Current filter",
      scopedBadgeEnterprise: "Enterprise network workspace · {count} stores",
      scopedBadgeSingle: "Current store",
      scopedListFilteredEmpty: "No stores match the current filter",
      scopedListEmpty: "No stores available in this scope",
      scopedBadgeAttention: "Needs attention",
      scopedBadgeActive: "Listed",
      scopedBadgeInactive: "Not listed",
      scopedStatus: "Status",
      scopedOpenSupport: "Open support tickets",
      scopedGeoBinding: "GEO link",
      scopedGeoUnbound: "Not linked",
      scopedAttentionReason: "Attention reasons",
      scopedAttentionNone: "No active issues",
      listingStoresEmpty: "No stores available for selection",
      listingStoreStateActive: "Already listed",
      listingStoreStatePending: "Pending onboarding",
      checklistEmpty: "No additional ops suggestions right now",
      profileParent: "Parent {name}",
      profileUpdatedAt: "Updated {time}",
      profileNotUpdated: "Not updated yet",
      noticeEnterprise: "Enterprise partner accounts can view grouped store status here. Listing strategy and GEO policy still remain under internal platform governance.",
      noticeSingle: "Direct editing of GEO and platform ranking is not available in merchant view. Use the platform request section below for listing or profile changes.",
      exportLoading: "Exporting...",
      exportSuccess: "Settlement CSV generated",
      exportFailed: "Settlement export failed: {msg}",
      profileSaving: "Saving...",
      profileSaved: "Merchant profile saved",
      profileSaveFailed: "Profile save failed: {msg}",
      requestTitleRequired: "Please enter a request title",
      requestNoteRequired: "Please enter request details",
      requestSubmitting: "Submitting...",
      requestSubmitted: "Platform request submitted",
      requestSubmitFailed: "Platform request failed: {msg}",
      orderIssueNoteRequired: "Add an issue note before sending it to support coordination",
      orderActionLoading: "Processing...",
      orderActionDone: "Order action completed",
      orderActionFailed: "Order action failed: {msg}",
      supportNoteRequired: "Add a coordination note before sending it to the support team",
      supportSending: "Sending...",
      supportSent: "Merchant note sent",
      supportSendFailed: "Failed to send note: {msg}",
      refreshFailed: "Refresh failed: {msg}",
      orderLoadFailed: "Order load failed: {msg}",
      orderRefreshFailed: "Order refresh failed: {msg}",
      supportLoadFailed: "Support ticket load failed: {msg}",
      supportRefreshFailed: "Support ticket refresh failed: {msg}",
      settlementLoadFailed: "Settlement load failed: {msg}",
      settlementRefreshFailed: "Settlement refresh failed: {msg}",
      initFailed: "Initialization failed: {msg}",
    },
  };

  const state = {
    language: "ZH",
    me: null,
    dashboard: null,
    orders: [],
    orderFilter: "",
    supportTickets: [],
    supportFilter: "",
    settlements: [],
    settlementFilter: "",
    listingRequests: [],
  };

  const el = {};

  function $(id) {
    return document.getElementById(id);
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function escapeSelectorValue(value) {
    return String(value ?? "").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  }

  function sanitizeClientErrorCode(value, fallback = "request_failed") {
    const safe = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_:-]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 80);
    return safe || fallback;
  }

  function normalizeLanguage(language) {
    const raw = String(language || "").toUpperCase();
    return raw.startsWith("ZH") ? "ZH" : "EN";
  }

  function localizeVisibleMerchantText(value, fallback = "") {
    const raw = String(value || "").trim();
    if (!raw) return fallback || "";
    if (state.language === "ZH") return raw;
    const map = {
      "平台推荐中": "Listed on platform",
      "推荐中门店": "Listed stores",
      "推荐中": "Listed",
      "待纳管": "Pending onboarding",
      "支持积压": "Support backlog",
      "待处理支持单": "Pending support tickets",
      "平台内部治理": "Platform-managed internally",
      "企业合作方": "Enterprise partner",
      "本地商家": "Local merchant",
      "门店网络": "Store network",
      "推荐池": "listing pool",
      "当前门店": "Current store",
      "当前网络": "Current network",
      "当前范围": "Current scope",
      "未绑定 GEO 资料": "GEO profile not linked",
      "未绑定": "Unbound",
      "当前无异常": "No issues right now",
      "已在推荐池": "Already in listing pool",
      "暂无可选门店": "No selectable stores yet",
      "当前没有可查看的门店": "No visible stores right now",
      "当前筛选条件下没有门店": "No stores match the current filter",
      "当前没有门店分组信息": "No store grouping info right now",
      "当前没有平台标签": "No platform tags right now",
      "当前没有平台申请记录": "No platform requests right now",
      "当前没有和该商家相关的支持单": "No support tickets for this merchant right now",
      "当前没有结算明细": "No settlement records right now",
      "当前筛选条件下没有订单": "No orders match the current filter",
      "暂无操作记录": "No recent activity",
      "暂无消息": "No messages yet",
      "待处理": "Pending",
      "处理中": "In progress",
      "已解决": "Resolved",
      "已完成": "Completed",
      "已关闭": "Closed",
      "待支付": "Pending payment",
      "已确认": "Confirmed",
      "已支付": "Paid",
      "履约中": "In fulfillment",
      "已交付": "Delivered",
      "已取消": "Canceled",
      "已退款": "Refunded",
      "已结算": "Settled",
      "待结算": "Pending settlement",
      "待平台审核": "Pending platform review",
      "等待平台审核": "Waiting for platform review",
      "平台申请": "Platform request",
      "资料更新申请": "Profile update request",
      "推荐上线申请": "Listing launch request",
      "服务能力补充": "Service capability update",
      "门店纳管申请": "Store-network onboarding request",
      "支持单": "Support ticket",
      "订单": "Order",
      "城市": "City",
      "门店": "Store",
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
      "出行": "Transport",
      "接送机": "Airport transfer",
      "包车": "Charter transport",
      "线下无法接待": "Onsite service unavailable",
      "用户改期": "Traveler reschedule",
      "履约异常": "Fulfillment issue",
      "启用": "Active",
      "正常": "Active",
      "停用": "Inactive",
      "冻结": "Frozen",
      "待响应": "Awaiting response",
      "已完成商家后台登录": "Merchant console sign-in completed",
      "已更新商家资料": "Merchant profile updated",
      "已向支持团队追加备注": "Merchant note added to support",
      "已确认接单": "Order accepted",
      "订单已确认接单": "Order accepted",
      "订单已进入履约中": "Order moved into fulfillment",
      "订单已标记交付": "Order marked delivered",
      "已提交订单异常协同": "Order issue escalated to support",
      "已提交平台资料申请": "Platform request submitted",
      "平台已更新资料申请状态": "Platform request status updated",
      "商家平台申请已更新": "Merchant platform request updated",
      "支持协同处理中": "Support coordination in progress",
      "已发送商家备注": "Merchant note sent",
      "支持团队已更新处理进度": "Support team updated progress",
      "工单状态已更新": "Ticket status updated",
      "当前门店已进入平台推荐池，展示策略由平台运营控制。": "This store is already in platform listing, and display strategy stays under platform operations control.",
      "当前门店未进入平台推荐池，如需上线推荐需提交申请。": "This store is not yet in platform listing. Submit a request if you want it launched into recommendations.",
      "当前门店尚未进入平台推荐池，如需上线推荐请提交平台申请": "This store is not yet in platform listing. Submit a platform request to go live.",
      "当前平台评级为重点合作档，可保持稳定履约与服务质量": "The current platform tier is priority partner. Keep fulfillment and service quality stable.",
      "当前平台评级仍有提升空间，建议先优化履约与服务数据": "The current platform tier still has room to improve. Prioritize fulfillment and service metrics first.",
      "当前没有待跟进支持单": "No support tickets need follow-up right now",
      "当前暂无订单沉淀，可优先完善门店资料与服务能力说明": "No order history yet. Prioritize profile completion and service capability details.",
      "默认": "default"
    };
    let output = raw;
    const regexRules = [
      [/企业账号当前覆盖\s*(\d+)\s*家门店，可统一查看订单、支持单与结算状态/g, "Enterprise account currently covers $1 stores with unified visibility across orders, support tickets, and settlements"],
      [/平台已将当前门店纳入\s*([^/]+?)\s*\/\s*([^/]+?)\s*推荐池/g, "The platform has placed this store into the $1 / $2 listing pool"],
      [/当前有\s*(\d+)\s*条待处理支持单，需要尽快跟进/g, "There are currently $1 open support tickets that need prompt follow-up"],
      [/近期待处理订单\s*(\d+)\s*笔，累计订单\s*(\d+)\s*笔/g, "Recent active orders: $1; total orders: $2"],
    ];
    regexRules.forEach(([pattern, replacement]) => {
      output = output.replace(pattern, replacement);
    });
    Object.entries(map).forEach(([from, to]) => {
      output = output.replace(new RegExp(from, "g"), to);
    });
    if (/[一-鿿]/.test(output) && fallback) return fallback;
    return output;
  }

  function tm(key, vars) {
    const lang = MERCHANT_TEXT[state.language] ? state.language : "EN";
    const template = MERCHANT_TEXT[lang][key] || MERCHANT_TEXT.EN[key] || key;
    if (!vars) return template;
    return String(template).replace(/\{(\w+)\}/g, (_, name) => (vars[name] !== undefined ? String(vars[name]) : ""));
  }

  function pickMerchantText(zh, en) {
    return state.language === "ZH" ? zh : en;
  }

  function describeMerchantError(err, fallback = "request_failed") {
    const code = sanitizeClientErrorCode(err && err.message, fallback);
    if (code === "unauthorized") return tm("sessionExpired");
    if (/_unavailable$/.test(code) || code === "request_failed" || /^http_\d+$/.test(code)) {
      return tm("serviceUnavailable");
    }
    return code === fallback ? tm("requestFailed") : code.replace(/_/g, " ");
  }

  async function readJsonSafe(response, fallback = {}) {
    if (!response || response.status === 204 || response.status === 205) return fallback;
    let text = "";
    try {
      text = await response.text();
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

  async function api(path, options = {}) {
    const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
    const response = await fetch(path, { ...options, headers });
    const data = await readJsonSafe(response, {});
    if (!response.ok) {
      const err = new Error(sanitizeClientErrorCode(data.error || data.code || data.reason, `http_${response.status}`));
      err.status = response.status;
      throw err;
    }
    return data;
  }

  function fillForm(fields) {
    Object.entries(fields).forEach(([id, value]) => {
      const input = $(id);
      if (!input) return;
      if (input.type === "checkbox") input.checked = Boolean(value);
      else input.value = value == null ? "" : String(value);
    });
  }

  function showLogin(error = "") {
    state.me = null;
    state.dashboard = null;
    el.loginView.classList.remove("hidden");
    el.appView.classList.add("hidden");
    el.loginError.textContent = error;
    el.loginError.classList.toggle("hidden", !error);
  }

  function applyMerchantLanguage() {
    document.documentElement.lang = state.language === "ZH" ? "zh-CN" : "en";
    document.title = tm("pageTitle");
    if (el.langLabel) el.langLabel.textContent = tm("langLabel");
    if (el.langSwitch) el.langSwitch.value = state.language;
    if (el.heroTitle) el.heroTitle.textContent = tm("heroTitle");
    if (el.heroCopy) el.heroCopy.textContent = tm("heroCopy");
    if (el.heroTagProfile) el.heroTagProfile.textContent = tm("heroTagProfile");
    if (el.heroTagFulfillment) el.heroTagFulfillment.textContent = tm("heroTagFulfillment");
    if (el.heroTagSupport) el.heroTagSupport.textContent = tm("heroTagSupport");
    if (el.heroTagSettlement) el.heroTagSettlement.textContent = tm("heroTagSettlement");
    if (el.scopeItem1) el.scopeItem1.textContent = tm("scopeItem1");
    if (el.scopeItem2) el.scopeItem2.textContent = tm("scopeItem2");
    if (el.scopeItem3) el.scopeItem3.textContent = tm("scopeItem3");
    if (el.openUserAppLink) el.openUserAppLink.textContent = tm("openUserApp");
    if (el.loginTitle) el.loginTitle.textContent = tm("loginTitle");
    if (el.loginCopy) el.loginCopy.textContent = tm("loginCopy");
    if (el.loginItem1) el.loginItem1.textContent = tm("loginItem1");
    if (el.loginItem2) el.loginItem2.textContent = tm("loginItem2");
    if (el.loginUserLabel) el.loginUserLabel.textContent = tm("loginUserLabel");
    if (el.loginPasswordLabel) el.loginPasswordLabel.textContent = tm("loginPasswordLabel");
    if (el.loginPassword) el.loginPassword.placeholder = tm("loginPasswordPlaceholder");
    if (el.loginBtn && !el.loginBtn.disabled) el.loginBtn.textContent = tm("loginButton");
    if (el.refreshBtn) el.refreshBtn.textContent = tm("refreshWorkspace");
    if (el.logoutBtn) el.logoutBtn.textContent = tm("logout");
    if (el.navMetrics) el.navMetrics.textContent = tm("navMetrics");
    if (el.navPlatform) el.navPlatform.textContent = tm("navPlatform");
    if (el.navRequest) el.navRequest.textContent = tm("navRequest");
    if (el.navProfile) el.navProfile.textContent = tm("navProfile");
    if (el.navOrders) el.navOrders.textContent = tm("navOrders");
    if (el.navSupport) el.navSupport.textContent = tm("navSupport");
    if (el.navSettlement) el.navSettlement.textContent = tm("navSettlement");
    if (el.platformTitle) el.platformTitle.textContent = pickMerchantText("平台推荐状态", "Platform listing status");
    if (el.platformCopy) el.platformCopy.textContent = pickMerchantText("先确认平台当前如何展示你，再决定是补资料、提申请，还是优先处理支持与履约问题。", "Check how the platform currently represents you before deciding whether to update materials, submit a request, or prioritize support and fulfillment.");
    if (el.storeNetworkTitle) el.storeNetworkTitle.textContent = pickMerchantText("门店网络", "Store network");
    if (el.storeNetworkCopy) el.storeNetworkCopy.textContent = pickMerchantText("门店网络按城市、状态和支持积压查看，方便先锁定最需要运营动作的门店。", "Review the store network by city, status, and support backlog so the highest-priority stores are clear first.");
    if (el.checklistTitle) el.checklistTitle.textContent = pickMerchantText("当前运营提示", "Current ops suggestions");
    if (el.checklistCopy) el.checklistCopy.textContent = pickMerchantText("这里不是消息堆积区，只保留当前最值得立刻执行的经营动作建议。", "This section is not a message backlog. It only keeps the most actionable business suggestions for right now.");
    if (el.settlementOverviewTitle) el.settlementOverviewTitle.textContent = pickMerchantText("结算概览", "Settlement overview");
    if (el.settlementOverviewCopy) el.settlementOverviewCopy.textContent = pickMerchantText("先看应收、已结与待处理差额，再决定是否需要追踪订单或发起支持协同。", "Review receivables, settled amounts, and pending gaps first, then decide whether follow-up or support coordination is needed.");
    if (el.listingRequestTitle) el.listingRequestTitle.textContent = pickMerchantText("平台推荐 / 资料申请", "Platform requests");
    if (el.listingFormStatus) el.listingFormStatus.textContent = pickMerchantText("由平台审核", "Platform reviewed");
    if (el.listingRequestCopy) el.listingRequestCopy.textContent = pickMerchantText("涉及推荐池、资料改版、服务能力补充和纳管申请，都在这里统一向平台提单，避免线下口头流转。", "Submit listing, profile, capability, and governance requests here instead of handling them through offline escalation.");
    if (el.listingRequestTypeLabel) el.listingRequestTypeLabel.textContent = pickMerchantText("申请类型", "Request type");
    if (el.listingRequestTitleLabel) el.listingRequestTitleLabel.textContent = pickMerchantText("申请标题", "Request title");
    if (el.listingRequestTitleInput) el.listingRequestTitleInput.placeholder = pickMerchantText("如：上海门店申请纳入推荐池", "Example: Apply Shanghai store for platform listing");
    if (el.listingRequestStoresLabel) el.listingRequestStoresLabel.textContent = pickMerchantText("涉及门店", "Stores in scope");
    if (el.listingRequestNoteLabel) el.listingRequestNoteLabel.textContent = pickMerchantText("补充说明", "Additional details");
    if (el.listingRequestNoteInput) el.listingRequestNoteInput.placeholder = pickMerchantText("请填写服务亮点、适用客群、上线诉求、资料变更内容等。", "Describe service highlights, target guests, launch goals, or profile changes.");
    if (el.listingRequestSubmitBtn && !el.listingRequestSubmitBtn.disabled) el.listingRequestSubmitBtn.textContent = pickMerchantText("提交平台申请", "Submit request");
    if (el.profileTitle) el.profileTitle.textContent = pickMerchantText("商家资料", "Merchant profile");
    if (el.profileCopy) el.profileCopy.textContent = pickMerchantText("只维护对用户展示和平台审核有影响的关键资料，避免把内部备注塞进公开资料字段。", "Only maintain the fields that affect user-facing presentation and platform review. Internal notes should not live in public profile fields.");
    if (el.profileNameLabel) el.profileNameLabel.textContent = pickMerchantText("商家名称", "Merchant name");
    if (el.profileCityLabel) el.profileCityLabel.textContent = pickMerchantText("城市", "City");
    if (el.profileCategoryLabel) el.profileCategoryLabel.textContent = pickMerchantText("类别", "Category");
    if (el.profileContactNameLabel) el.profileContactNameLabel.textContent = pickMerchantText("联系人", "Contact name");
    if (el.profileContactPhoneLabel) el.profileContactPhoneLabel.textContent = pickMerchantText("联系电话", "Contact phone");
    if (el.profileContactEmailLabel) el.profileContactEmailLabel.textContent = pickMerchantText("联系邮箱", "Contact email");
    if (el.profileDescriptionLabel) el.profileDescriptionLabel.textContent = pickMerchantText("商家简介", "Profile description");
    if (el.profileSubmitBtn && !el.profileSubmitBtn.disabled) el.profileSubmitBtn.textContent = pickMerchantText("保存资料", "Save profile");
    if (el.fulfillmentTitle) el.fulfillmentTitle.textContent = pickMerchantText("订单履约台", "Fulfillment desk");
    if (el.fulfillmentCopy) el.fulfillmentCopy.textContent = pickMerchantText("这一列只做接单、履约推进和异常反馈，不承担平台推荐审核或资料维护工作。", "This area is only for accepting orders, moving fulfillment forward, and reporting issues. It is not for platform review or profile editing.");
    if (el.supportTitle) el.supportTitle.textContent = pickMerchantText("支持协同", "Support collaboration");
    if (el.supportCopy) el.supportCopy.textContent = pickMerchantText("当订单、资料或线下服务出现阻塞时，在这里和平台支持团队协同处理。", "When orders, profile details, or onsite service become blocked, coordinate with the platform support team here.");
    if (el.settlementTitle) el.settlementTitle.textContent = pickMerchantText("结算明细", "Settlement details");
    if (el.settlementCopy) el.settlementCopy.textContent = pickMerchantText("这里按批次回看结算进度、差额和说明，确认账务闭环是否完整。", "Review settlement progress, variances, and notes by batch to confirm the financial loop is complete.");
    if (el.activityTitle) el.activityTitle.textContent = pickMerchantText("最近操作", "Recent activity");
    if (el.activityCopy) el.activityCopy.textContent = pickMerchantText("最后再看操作轨迹，判断本日是否还有待补的动作或异常回溯需要处理。", "Use the activity trail last to see whether any action is still missing or whether incident follow-up is needed today.");
    if (el.orderRefreshBtn && !el.orderRefreshBtn.disabled) el.orderRefreshBtn.textContent = pickMerchantText("刷新订单", "Refresh orders");
    if (el.supportRefreshBtn && !el.supportRefreshBtn.disabled) el.supportRefreshBtn.textContent = pickMerchantText("刷新支持单", "Refresh support");
    if (el.settlementRefreshBtn && !el.settlementRefreshBtn.disabled) el.settlementRefreshBtn.textContent = pickMerchantText("刷新结算", "Refresh settlements");
    if (el.settlementExportBtn && !el.settlementExportBtn.disabled) el.settlementExportBtn.textContent = pickMerchantText("导出 CSV", "Export CSV");
    if (el.orderStatusFilter) {
      el.orderStatusFilter.innerHTML = [
        { value: "", label: pickMerchantText("全部订单", "All orders") },
        { value: "pending", label: pickMerchantText("待支付", "Pending payment") },
        { value: "confirmed", label: pickMerchantText("已确认", "Confirmed") },
        { value: "paid", label: pickMerchantText("已支付", "Paid") },
        { value: "executing", label: pickMerchantText("履约中", "In fulfillment") },
        { value: "delivered", label: pickMerchantText("已交付", "Delivered") },
        { value: "completed", label: pickMerchantText("已完成", "Completed") },
        { value: "canceled", label: pickMerchantText("已取消", "Canceled") },
        { value: "refunded", label: pickMerchantText("已退款", "Refunded") },
      ].map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
      el.orderStatusFilter.value = state.orderFilter || "";
    }
    if (el.supportStatusFilter) {
      el.supportStatusFilter.innerHTML = [
        { value: "", label: pickMerchantText("全部支持单", "All support tickets") },
        { value: "open", label: pickMerchantText("待处理", "Open") },
        { value: "in_progress", label: pickMerchantText("处理中", "In progress") },
        { value: "resolved", label: pickMerchantText("已解决", "Resolved") },
      ].map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
      el.supportStatusFilter.value = state.supportFilter || "";
    }
    if (el.settlementStatusFilter) {
      el.settlementStatusFilter.innerHTML = [
        { value: "", label: pickMerchantText("全部状态", "All statuses") },
        { value: "pending", label: pickMerchantText("待结算", "Pending settlement") },
        { value: "settled", label: pickMerchantText("已结算", "Settled") },
        { value: "refunded", label: pickMerchantText("已退款", "Refunded") },
      ].map((option) => `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`).join("");
      el.settlementStatusFilter.value = state.settlementFilter || "";
    }
  }

  function showApp() {
    el.loginView.classList.add("hidden");
    el.appView.classList.remove("hidden");
  }

  function renderNotice(message = "") {
    el.notice.textContent = message;
    el.notice.classList.toggle("hidden", !message);
  }

  function formatTime(value) {
    if (!value) return "-";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(state.language === "ZH" ? "zh-CN" : "en-US", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function accountTypeLabel(accountType) {
    return accountType === "enterprise_partner"
      ? pickMerchantText("企业合作方", "Enterprise partner")
      : pickMerchantText("本地商家", "Local merchant");
  }

  function formatInlineMeta(detail = {}) {
    if (!detail || typeof detail !== "object" || Array.isArray(detail)) return "";
    return Object.entries(detail)
      .map(([key, value]) => {
        if (value == null || value === "") return "";
        const rendered = typeof value === "object" ? JSON.stringify(value) : String(value);
        return `${localizeVisibleMerchantText(key, key)}: ${localizeVisibleMerchantText(rendered, rendered)}`;
      })
      .filter(Boolean)
      .join(" · ");
  }

  function listingRequestTypeLabel(requestType) {
    const labels = {
      listing_launch_request: pickMerchantText("申请进入平台推荐池", "Apply for platform listing"),
      listing_material_update: pickMerchantText("更新推荐资料", "Update listing materials"),
      service_capability_update: pickMerchantText("补充服务能力说明", "Add service capabilities"),
      network_activation_request: pickMerchantText("门店网络纳管申请", "Request store-network onboarding"),
    };
    return labels[String(requestType || "").trim()] || pickMerchantText("平台申请", "Platform request");
  }

  function getPreferredListingRequestType() {
    if (state.me?.account?.accountType === "enterprise_partner") return "network_activation_request";
    return state.dashboard?.platformListing?.activeStoreCount > 0 ? "listing_material_update" : "listing_launch_request";
  }

  function getListingRequestTemplate(requestType) {
    const account = state.me?.account || {};
    const parentAccount = state.me?.parentAccount || null;
    const storeCount = Array.isArray(state.dashboard?.scopedStores) ? state.dashboard.scopedStores.length : 0;
    const isEnterprise = account.accountType === "enterprise_partner";
    const scopeText = isEnterprise
      ? pickMerchantText(`${storeCount || 0} 家门店网络`, `${storeCount || 0} store network`)
      : localizeVisibleMerchantText(account.name || "", pickMerchantText("当前门店", "Current store"));
    const titleMap = {
      listing_launch_request: pickMerchantText(`${account.name || "商家"} 推荐上线申请`, `Listing launch request for ${localizeVisibleMerchantText(account.name || "", account.name || "Merchant")}`),
      listing_material_update: pickMerchantText(`${account.name || "商家"} 资料更新申请`, `Profile update request for ${localizeVisibleMerchantText(account.name || "", account.name || "Merchant")}`),
      service_capability_update: pickMerchantText(`${account.name || "商家"} 服务能力补充`, `Service capability update for ${localizeVisibleMerchantText(account.name || "", account.name || "Merchant")}`),
      network_activation_request: isEnterprise
        ? pickMerchantText(`${account.name || "企业合作方"} 门店纳管申请`, `Store-network onboarding request for ${localizeVisibleMerchantText(account.name || "", account.name || "Enterprise partner")}`)
        : pickMerchantText(`${parentAccount?.name || account.name || "商家"} 门店纳管申请`, `Store-network onboarding request for ${localizeVisibleMerchantText(parentAccount?.name || account.name || "", parentAccount?.name || account.name || "Merchant")}`),
    };
    const noteMap = {
      listing_launch_request: pickMerchantText(`请说明希望进入平台推荐池的门店、适用客群、服务亮点、接待能力与当前履约保障。当前范围：${scopeText}。`, `Describe which stores should enter platform listing, target guests, service highlights, hosting capacity, and current fulfillment safeguards. Current scope: ${scopeText}.`),
      listing_material_update: pickMerchantText(`请列出需要更新的推荐资料，例如门店介绍、联系方式、营业时间、适合人群、平台标签或图片素材。当前范围：${scopeText}。`, `List the profile fields that need updating, such as store intro, contact details, opening hours, guest fit, platform tags, or image assets. Current scope: ${scopeText}.`),
      service_capability_update: pickMerchantText(`请补充可提供的服务能力，例如外语接待、跨境支付、企业接待、夜间服务、团队协同或特殊资源。当前范围：${scopeText}。`, `Add service capabilities you can provide, such as foreign-language hosting, cross-border payment, enterprise reception, night service, team support, or special resources. Current scope: ${scopeText}.`),
      network_activation_request: isEnterprise
        ? pickMerchantText(`请说明希望纳入平台治理的企业门店范围、城市分布、合作模式、对接人以及上线优先级。当前网络：${scopeText}。`, `Describe which enterprise stores should enter platform governance, including city coverage, partnership model, owners, and launch priority. Current network: ${scopeText}.`)
        : pickMerchantText(`请说明门店为何需要纳入企业合作网络或平台治理范围，并补充具体负责人与上线诉求。当前门店：${scopeText}。`, `Explain why this store should enter enterprise-network or platform-governed scope, and include the owner plus launch request. Current store: ${scopeText}.`),
    };
    const helperMap = {
      listing_launch_request: pickMerchantText("适合尚未进入推荐池的本地商家，重点补充服务亮点和履约能力。", "Best for local merchants not yet listed on the platform. Focus on service highlights and fulfillment capability."),
      listing_material_update: pickMerchantText("适合已在推荐池中的商家，重点说明需要更新的资料项。", "Best for merchants already listed on the platform. Focus on which profile items need updating."),
      service_capability_update: pickMerchantText("适合补充新增服务、接待能力或特殊资源说明。", "Best for adding new services, hosting capabilities, or special resources."),
      network_activation_request: isEnterprise
        ? pickMerchantText("适合企业合作方统一提交门店网络纳管、批量资料整理和上线节奏需求。", "Best for enterprise partners to submit store-network onboarding, bulk profile cleanup, and launch pacing needs.")
        : pickMerchantText("适合单店申请纳入企业合作网络或由平台统一纳管。", "Best for a single store to request enterprise-network onboarding or platform-governed onboarding."),
    };
    return {
      title: titleMap[requestType] || pickMerchantText(`${account.name || "商家"} 平台申请`, `Platform request for ${localizeVisibleMerchantText(account.name || "", account.name || "Merchant")}`),
      note: noteMap[requestType] || "",
      helper: helperMap[requestType] || pickMerchantText("请补充完整申请背景与业务诉求。", "Please add the full request background and business need."),
    };
  }

  function syncListingRequestTemplate(force = false) {
    const typeInput = $("listingRequestType");
    const titleInput = $("listingRequestTitle");
    const noteInput = $("listingRequestNote");
    if (!typeInput || !titleInput || !noteInput) return;
    const template = getListingRequestTemplate(typeInput.value || getPreferredListingRequestType());
    if (force || !titleInput.value.trim()) titleInput.value = template.title;
    if (force || !noteInput.value.trim()) noteInput.value = template.note;
    if (el.listingRequestHelper) el.listingRequestHelper.textContent = template.helper;
  }

  function renderMetrics(metrics = {}) {
    const isEnterprise = state.me?.account?.accountType === "enterprise_partner";
    const scopedStores = Array.isArray(state.dashboard?.scopedStores) ? state.dashboard.scopedStores : [];
    const platformListing = state.dashboard?.platformListing || {};
    const items = isEnterprise
      ? [
          { label: tm("platformAccountType"), value: accountTypeLabel(state.me?.account?.accountType) },
          { label: tm("platformLinkedStores"), value: scopedStores.length || 0 },
          { label: tm("platformActiveStores"), value: platformListing.activeStoreCount ?? 0 },
          { label: tm("scopedPendingSupport"), value: metrics.supportOpenCount ?? 0 },
        ]
      : [
          { label: tm("platformAccountType"), value: accountTypeLabel(state.me?.account?.accountType) },
          { label: pickMerchantText("待履约订单", "Active orders"), value: metrics.activeOrders ?? 0 },
          { label: tm("scopedPendingSupport"), value: metrics.supportOpenCount ?? 0 },
          { label: pickMerchantText("累计收入", "Total revenue"), value: `¥${Number(metrics.totalRevenue || 0).toFixed(2)}` },
        ];
    el.metrics.innerHTML = items.map((item) => `
      <article class="merchant-metric">
        <div class="merchant-metric-label">${escapeHtml(item.label)}</div>
        <div class="merchant-metric-value">${escapeHtml(item.value)}</div>
      </article>
    `).join("");
  }

  function renderActivity(list = []) {
    if (!Array.isArray(list) || !list.length) {
      el.activityList.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("activityEmpty"))}</div>`;
      return;
    }
    el.activityList.innerHTML = list.map((item) => `
      <article class="merchant-list-item">
        <div class="merchant-list-title">
          <span>${escapeHtml(localizeVisibleMerchantText(item.action || "", item.action || "-"))}</span>
          <span class="merchant-badge">${escapeHtml(formatTime(item.createdAt))}</span>
        </div>
        <div class="merchant-list-meta">${escapeHtml(localizeVisibleMerchantText(item.summary || formatInlineMeta(item.detail) || "", "-"))}</div>
        ${formatInlineMeta(item.detail) ? `<div class="merchant-list-caption">${escapeHtml(localizeVisibleMerchantText(formatInlineMeta(item.detail), formatInlineMeta(item.detail)))}</div>` : ""}
      </article>
    `).join("");
  }

  function getOrderActions(item) {
    const status = String(item?.status || "").toLowerCase();
    const isEnterprise = state.me?.account?.accountType === "enterprise_partner";
    const actions = [];
    if (!isEnterprise && (status === "pending" || status === "planned")) {
      actions.push({ action: "confirm", label: tm("actionConfirm"), variant: "secondary" });
    }
    if (!isEnterprise && status === "confirmed") {
      actions.push({ action: "start", label: tm("actionStart"), variant: "secondary" });
    }
    if (!isEnterprise && (status === "confirmed" || status === "executing")) {
      actions.push({ action: "deliver", label: tm("actionDeliver"), variant: "secondary" });
    }
    if (item?.taskId) {
      actions.push({ action: "issue", label: tm("actionIssue"), variant: "ghost" });
    }
    return actions;
  }

  function renderOrderActionControls(item) {
    const actions = getOrderActions(item);
    if (!actions.length) {
      return `<div class="merchant-list-caption">${escapeHtml(tm("orderNoAction"))}</div>`;
    }
    const noteEnabled = Boolean(item.taskId);
    const notePlaceholder = noteEnabled
      ? tm("issuePlaceholderEnabled")
      : tm("issuePlaceholderDisabled");
    return `
      <div class="merchant-action-row">
        <textarea
          class="merchant-inline-note"
          data-order-note="${escapeHtml(item.id || "")}"
          rows="3"
          ${noteEnabled ? "" : "disabled"}
          placeholder="${escapeHtml(notePlaceholder)}"
        ></textarea>
        <div class="merchant-action-group">
          ${actions.map((button) => `
            <button
              type="button"
              class="${button.variant === "ghost" ? "merchant-ghost" : "merchant-secondary"}"
              data-order-action="${escapeHtml(button.action)}"
              data-order-id="${escapeHtml(item.id || "")}"
            >${escapeHtml(button.label)}</button>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderOrders(list = []) {
    if (!Array.isArray(list) || !list.length) {
      el.orderList.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("orderEmpty"))}</div>`;
      return;
    }
    el.orderList.innerHTML = list.map((item) => `
      <article class="merchant-list-item">
        <div class="merchant-order-head">
          <span class="merchant-order-id">${escapeHtml(item.id || "-")}</span>
          <span class="merchant-badge">${escapeHtml(localizeVisibleMerchantText(item.status || "", item.status || "-"))}</span>
        </div>
        <div class="merchant-order-grid">
          <div class="merchant-list-meta">${escapeHtml(tm("orderCity"))}: ${escapeHtml(localizeVisibleMerchantText(item.city || "", item.city || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("orderType"))}: ${escapeHtml(localizeVisibleMerchantText(item.type || "", item.type || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("orderAmount"))}: ¥${escapeHtml(Number(item.price || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("orderTask"))}: ${escapeHtml(localizeVisibleMerchantText(item.taskIntent || item.taskId || "", item.taskId || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("orderSupport"))}: ${escapeHtml(String(item.supportOpenCount || 0))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("orderCreatedAt"))}: ${escapeHtml(formatTime(item.createdAt))}</div>
        </div>
        ${renderOrderActionControls(item)}
      </article>
    `).join("");
  }

  function renderSettlement(summary = {}) {
    const items = [
      { label: tm("settlementGross"), value: `¥${Number(summary.totalGross || 0).toFixed(2)}` },
      { label: tm("settlementNet"), value: `¥${Number(summary.totalNet || 0).toFixed(2)}` },
      { label: tm("settlementPendingAmount"), value: `¥${Number(summary.pendingNet || 0).toFixed(2)}` },
      { label: tm("settlementSettledAmount"), value: `¥${Number(summary.settledNet || 0).toFixed(2)}` },
      { label: tm("settlementPendingCount"), value: summary.pendingCount ?? 0 },
      { label: tm("settlementSettledCount"), value: summary.settledCount ?? 0 },
    ];
    el.settlementSummary.innerHTML = items.map((item) => `
      <article class="merchant-kv">
        <div class="merchant-kv-label">${escapeHtml(item.label)}</div>
        <div class="merchant-kv-value">${escapeHtml(item.value)}</div>
      </article>
    `).join("");
  }

  function renderSettlementList(list = []) {
    if (!Array.isArray(list) || !list.length) {
      el.settlementList.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("settlementEmpty"))}</div>`;
      return;
    }
    el.settlementList.innerHTML = list.map((item) => `
      <article class="merchant-list-item">
        <div class="merchant-order-head">
          <span class="merchant-order-id">${escapeHtml(item.orderId || item.id || "-")}</span>
          <span class="merchant-badge">${escapeHtml(localizeVisibleMerchantText(item.status || "", item.status || "-"))}</span>
        </div>
        <div class="merchant-order-grid">
          <div class="merchant-list-meta">${escapeHtml(tm("settlementOrderStatus"))}: ${escapeHtml(localizeVisibleMerchantText(item.orderStatus || "", item.orderStatus || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementTask"))}: ${escapeHtml(localizeVisibleMerchantText(item.taskIntent || item.taskId || "", item.taskId || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementGrossLine"))}: ¥${escapeHtml(Number(item.gross || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementNetLine"))}: ¥${escapeHtml(Number(item.net || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementMarkup"))}: ¥${escapeHtml(Number(item.markup || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementRefund"))}: ¥${escapeHtml(Number(item.refund || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementOrderAmount"))}: ¥${escapeHtml(Number(item.orderAmount || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementSettledNet"))}: ¥${escapeHtml(Number(item.settledNet || 0).toFixed(2))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("settlementUpdatedAt"))}: ${escapeHtml(formatTime(item.updatedAt || item.createdAt))}</div>
        </div>
      </article>
    `).join("");
  }

  function renderSupportTickets(list = []) {
    if (!Array.isArray(list) || !list.length) {
      el.supportList.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("supportEmpty"))}</div>`;
      return;
    }
    el.supportList.innerHTML = list.map((item) => `
      <article class="merchant-list-item">
        <div class="merchant-order-head">
          <span class="merchant-order-id">${escapeHtml(item.id || "-")}</span>
          <span class="merchant-badge">${escapeHtml(localizeVisibleMerchantText(item.status || "", item.status || "-"))}</span>
        </div>
        <div class="merchant-order-grid">
          <div class="merchant-list-meta">${escapeHtml(tm("supportOrder"))}: ${escapeHtml(localizeVisibleMerchantText(item.orderId || "", item.orderId || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportOrderStatus"))}: ${escapeHtml(localizeVisibleMerchantText(item.orderStatus || "", item.orderStatus || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportTask"))}: ${escapeHtml(localizeVisibleMerchantText(item.taskIntent || item.taskId || "", item.taskId || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportReason"))}: ${escapeHtml(localizeVisibleMerchantText(item.reason || "", item.reason || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportProgress"))}: ${escapeHtml(localizeVisibleMerchantText(item.coordinationStatus || "", item.coordinationStatus || "-"))} / ${escapeHtml(tm("supportEta"))}: ${escapeHtml(localizeVisibleMerchantText(item.eta || "", item.eta || "-"))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportMessageCount"))}: ${escapeHtml(String(item.messageCount || 0))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportCreatedAt"))}: ${escapeHtml(formatTime(item.createdAt))}</div>
          <div class="merchant-list-meta">${escapeHtml(tm("supportUpdatedAt"))}: ${escapeHtml(formatTime(item.updatedAt || item.createdAt))}</div>
        </div>
        <div class="merchant-list-caption">
          ${escapeHtml(tm("supportLatest"))}: ${escapeHtml(localizeVisibleMerchantText(item.lastMessage?.preview || "", tm("supportNoMessage")))} ${item.lastMessage?.at ? `· ${escapeHtml(formatTime(item.lastMessage.at))}` : ""}
        </div>
        <div class="merchant-action-row">
          <textarea
            class="merchant-inline-note"
            data-ticket-note="${escapeHtml(item.id || "")}"
            rows="3"
            placeholder="${escapeHtml(tm("supportNotePlaceholder"))}"
          ></textarea>
          <div class="merchant-action-group">
            <button
              type="button"
              class="merchant-secondary"
              data-ticket-comment="${escapeHtml(item.id || "")}"
              data-ticket-id="${escapeHtml(item.id || "")}"
            >${escapeHtml(tm("supportSendNote"))}</button>
          </div>
        </div>
      </article>
    `).join("");
  }

  function renderListingRequests(list = []) {
    if (!Array.isArray(list) || !list.length) {
      el.listingRequestsList.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("listingEmpty"))}</div>`;
      return;
    }
    el.listingRequestsList.innerHTML = list.map((item) => `
      <article class="merchant-list-item">
        <div class="merchant-list-title">
          <span>${escapeHtml(localizeVisibleMerchantText(item.title || item.requestType || "", tm("listingFallbackTitle")))}</span>
          <span class="merchant-badge">${escapeHtml(localizeVisibleMerchantText(item.status || "", item.status || "pending"))}</span>
        </div>
        <div class="merchant-list-meta">${escapeHtml(tm("listingType"))}: ${escapeHtml(listingRequestTypeLabel(item.requestType || "-"))}</div>
        <div class="merchant-list-meta">${escapeHtml(tm("listingCreatedAt"))}: ${escapeHtml(formatTime(item.createdAt))}</div>
        <div class="merchant-list-meta">${escapeHtml(tm("listingReviewNote"))}: ${escapeHtml(localizeVisibleMerchantText(item.reviewNote || "", tm("listingReviewNotePending")))}</div>
        <div class="merchant-list-meta">${escapeHtml(tm("listingNextStep"))}: ${escapeHtml(localizeVisibleMerchantText(item.reviewMeta?.nextStep || "", tm("listingNextStepPending")))} ${item.reviewMeta?.targetWindow ? `· ${escapeHtml(localizeVisibleMerchantText(item.reviewMeta.targetWindow || "", item.reviewMeta.targetWindow || ""))}` : ""}</div>
        ${item.reviewedAt ? `<div class="merchant-list-meta">${escapeHtml(tm("listingReviewedAt"))}: ${escapeHtml(formatTime(item.reviewedAt))}</div>` : ""}
      </article>
    `).join("");
  }

  function renderPlatformListing(platformListing = {}) {
    const latestRequest = Array.isArray(platformListing.latestRequests) && platformListing.latestRequests.length
      ? platformListing.latestRequests[0]
      : null;
    const items = [
      { label: tm("platformGovernance"), value: tm("platformGovernanceValue") },
      { label: tm("platformLinkedStores"), value: platformListing.linkedStoreCount ?? 0 },
      { label: tm("platformActiveStores"), value: platformListing.activeStoreCount ?? 0 },
      { label: tm("platformAccountType"), value: accountTypeLabel(platformListing.accountType) },
      { label: tm("platformLatestRequest"), value: latestRequest ? `${localizeVisibleMerchantText(latestRequest.status || "", latestRequest.status || "pending")} · ${formatTime(latestRequest.createdAt)}` : tm("platformNoRequest") },
      { label: tm("platformSummary"), value: localizeVisibleMerchantText(platformListing.summaryLine || "", tm("platformSummaryFallback")) },
    ];
    const activeStoreCount = Number(platformListing.activeStoreCount || 0);
    const linkedStoreCount = Number(platformListing.linkedStoreCount || 0);
    el.platformListingBadge.textContent = activeStoreCount > 0
      ? tm("platformBadgeActive")
      : (linkedStoreCount > 0 ? tm("platformBadgePending") : tm("platformBadgeInactive"));
    el.platformListingSummary.innerHTML = items.map((item) => `
      <article class="merchant-kv">
        <div class="merchant-kv-label">${escapeHtml(item.label)}</div>
        <div class="merchant-kv-value">${escapeHtml(item.value)}</div>
      </article>
    `).join("");
    const tags = [...new Set((Array.isArray(platformListing.stores) ? platformListing.stores : []).flatMap((item) => (
      Array.isArray(item.platformTags) ? item.platformTags : []
    )))];
    el.platformListingTags.innerHTML = tags.length
      ? tags.map((tag) => `<span class="merchant-chip">${escapeHtml(localizeVisibleMerchantText(tag || "", tag || "-"))}</span>`).join("")
      : `<div class="merchant-empty">${escapeHtml(tm("platformTagsEmpty"))}</div>`;
  }

  function getScopedStoreAttentionScore(store = {}) {
    const supportCount = Number(store.openSupportCount || 0);
    const status = String(store.status || "").toLowerCase();
    let score = 0;
    if (store.platformListingState !== "active") score += 4;
    if (supportCount > 0) score += Math.min(supportCount, 3);
    if (status && status !== "active") score += 2;
    if (!store.geoPartner?.name) score += 1;
    return score;
  }

  function getScopedStoreAttentionReasons(store = {}) {
    const reasons = [];
    if (store.platformListingState !== "active") reasons.push(tm("attentionPending"));
    if (Number(store.openSupportCount || 0) > 0) reasons.push(tm("attentionSupport", { count: Number(store.openSupportCount || 0) }));
    if (store.status && String(store.status).toLowerCase() !== "active") reasons.push(tm("attentionAccountStatus", { status: localizeVisibleMerchantText(store.status || "", store.status || "-") }));
    if (!store.geoPartner?.name) reasons.push(tm("attentionGeoMissing"));
    return reasons;
  }

  function syncScopedStoreCityFilter(scopedStores = []) {
    if (!el.scopedStoreCityFilter) return;
    const current = el.scopedStoreCityFilter.value || "";
    const cities = [...new Set(
      (Array.isArray(scopedStores) ? scopedStores : [])
        .map((item) => String(item.city || "").trim())
        .filter(Boolean)
    )].sort((left, right) => left.localeCompare(right, "zh-CN"));
    el.scopedStoreCityFilter.innerHTML = [
      `<option value="">${escapeHtml(tm("filterAllCities"))}</option>`,
      ...cities.map((city) => `<option value="${escapeHtml(city)}">${escapeHtml(localizeVisibleMerchantText(city, city))}</option>`),
    ].join("");
    if (current && cities.includes(current)) el.scopedStoreCityFilter.value = current;
  }

  function getFilteredScopedStores(scopedStores = []) {
    const city = el.scopedStoreCityFilter?.value || "";
    const statusFilter = el.scopedStoreStatusFilter?.value || "";
    const sortBy = el.scopedStoreSort?.value || "attention_desc";
    const filtered = (Array.isArray(scopedStores) ? scopedStores : []).filter((item) => {
      if (city && String(item.city || "") !== city) return false;
      if (statusFilter === "active" && item.platformListingState !== "active") return false;
      if (statusFilter === "inactive" && item.platformListingState === "active") return false;
      if (statusFilter === "support" && Number(item.openSupportCount || 0) <= 0) return false;
      if (statusFilter === "attention" && getScopedStoreAttentionScore(item) <= 0) return false;
      return true;
    });
    return filtered.sort((left, right) => {
      if (sortBy === "support_desc") {
        return Number(right.openSupportCount || 0) - Number(left.openSupportCount || 0)
          || getScopedStoreAttentionScore(right) - getScopedStoreAttentionScore(left)
          || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
      }
      if (sortBy === "city_asc") {
        return String(left.city || "").localeCompare(String(right.city || ""), "zh-CN")
          || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
      }
      if (sortBy === "name_asc") {
        return String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
      }
      return getScopedStoreAttentionScore(right) - getScopedStoreAttentionScore(left)
        || Number(right.openSupportCount || 0) - Number(left.openSupportCount || 0)
        || String(left.city || "").localeCompare(String(right.city || ""), "zh-CN")
        || String(left.name || "").localeCompare(String(right.name || ""), "zh-CN");
    });
  }

  function renderScopedStoreHighlights(sourceList = [], filteredList = []) {
    const allStores = Array.isArray(sourceList) ? sourceList : [];
    const currentStores = Array.isArray(filteredList) ? filteredList : [];
    const cityCounts = allStores.reduce((acc, item) => {
      const key = String(item.city || tm("cityUnspecified"));
      acc[key] = (acc[key] || 0) + 1;
      return acc;
    }, {});
    const cards = [
      { label: tm("scopedNeedAttention"), value: allStores.filter((item) => getScopedStoreAttentionScore(item) > 0).length },
      { label: tm("scopedPendingListing"), value: allStores.filter((item) => item.platformListingState !== "active").length },
      { label: tm("scopedSupportBacklog"), value: allStores.filter((item) => Number(item.openSupportCount || 0) > 0).length },
      { label: tm("scopedCityCoverage"), value: Object.keys(cityCounts).length },
    ];
    if (el.scopedStoreHighlights) {
      el.scopedStoreHighlights.innerHTML = cards.map((item) => `
        <article class="merchant-kv">
          <div class="merchant-kv-label">${escapeHtml(item.label)}</div>
          <div class="merchant-kv-value">${escapeHtml(item.value)}</div>
        </article>
      `).join("");
    }
    if (!el.scopedStoreGroups) return;
    const cityGroups = Object.entries(cityCounts)
      .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0]), "zh-CN"))
      .slice(0, 5)
      .map(([cityName, count]) => `${localizeVisibleMerchantText(cityName, cityName)} · ${pickMerchantText(`${count} 家`, `${count} stores`)}`);
    const groupTokens = [
      tm("scopedFilterSummary", { current: currentStores.length, total: allStores.length }),
      tm("scopedActiveSummary", { count: allStores.filter((item) => item.platformListingState === "active").length }),
      tm("scopedPendingSummary", { count: allStores.filter((item) => item.platformListingState !== "active").length }),
      ...cityGroups,
    ];
    el.scopedStoreGroups.innerHTML = groupTokens.length
      ? groupTokens.map((item) => `<span class="merchant-chip">${escapeHtml(localizeVisibleMerchantText(item || "", item || "-"))}</span>`).join("")
      : `<div class="merchant-empty">${escapeHtml(tm("scopedGroupEmpty"))}</div>`;
  }

  function renderScopedStores(scopedStores = []) {
    const sourceList = Array.isArray(scopedStores) ? scopedStores : [];
    syncScopedStoreCityFilter(sourceList);
    const list = getFilteredScopedStores(sourceList);
    const isEnterprise = state.me?.account?.accountType === "enterprise_partner";
    const items = [
      { label: tm("scopedMode"), value: isEnterprise ? tm("scopedModeEnterprise") : tm("scopedModeSingle") },
      { label: tm("scopedVisibleStores"), value: sourceList.length || 0 },
      { label: tm("scopedActiveStores"), value: sourceList.filter((item) => item.platformListingState === "active").length },
      { label: tm("scopedPendingSupport"), value: sourceList.reduce((sum, item) => sum + Number(item.openSupportCount || 0), 0) },
      { label: tm("scopedCurrentFilter"), value: pickMerchantText(`${list.length} 家`, `${list.length} stores`) },
    ];
    el.scopedStoreBadge.textContent = isEnterprise ? tm("scopedBadgeEnterprise", { count: sourceList.length }) : tm("scopedBadgeSingle");
    el.scopedStoreSummary.innerHTML = items.map((item) => `
      <article class="merchant-kv">
        <div class="merchant-kv-label">${escapeHtml(item.label)}</div>
        <div class="merchant-kv-value">${escapeHtml(item.value)}</div>
      </article>
    `).join("");
    renderScopedStoreHighlights(sourceList, list);
    if (!list.length) {
      el.scopedStoreList.innerHTML = sourceList.length
        ? `<div class="merchant-empty">${escapeHtml(tm("scopedListFilteredEmpty"))}</div>`
        : `<div class="merchant-empty">${escapeHtml(tm("scopedListEmpty"))}</div>`;
      return;
    }
    el.scopedStoreList.innerHTML = list.map((item) => `
      <article class="merchant-list-item">
        <div class="merchant-list-title">
          <span>${escapeHtml(localizeVisibleMerchantText(item.name || "", item.name || "-"))}</span>
          <span class="merchant-badge ${getScopedStoreAttentionScore(item) > 0 ? "merchant-badge-alert" : "merchant-badge-muted"}">${escapeHtml(getScopedStoreAttentionScore(item) > 0 ? tm("scopedBadgeAttention") : (item.platformListingState === "active" ? tm("scopedBadgeActive") : tm("scopedBadgeInactive")))}</span>
        </div>
        <div class="merchant-list-meta">${escapeHtml(localizeVisibleMerchantText(item.city || "", item.city || "-"))} · ${escapeHtml(localizeVisibleMerchantText(item.category || "", item.category || "-"))} · ${escapeHtml(accountTypeLabel(item.accountType))}</div>
        <div class="merchant-list-meta">${escapeHtml(tm("scopedStatus"))}: ${escapeHtml(localizeVisibleMerchantText(item.status || "", item.status || "-"))} · ${escapeHtml(tm("scopedOpenSupport"))}: ${escapeHtml(String(item.openSupportCount || 0))}</div>
        <div class="merchant-list-meta">${escapeHtml(tm("scopedGeoBinding"))}: ${escapeHtml(localizeVisibleMerchantText(item.geoPartner?.name || "", tm("scopedGeoUnbound")))}</div>
        <div class="merchant-list-meta">${escapeHtml(tm("scopedAttentionReason"))}: ${escapeHtml(localizeVisibleMerchantText(getScopedStoreAttentionReasons(item).join(" · ") || "", tm("scopedAttentionNone")))}</div>
      </article>
    `).join("");
  }

  function renderListingRequestStores(scopedStores = []) {
    const list = Array.isArray(scopedStores) && scopedStores.length
      ? scopedStores
      : [{
          merchantAccountId: state.me?.account?.id || "",
          name: state.me?.account?.name || "",
          city: state.me?.account?.city || "",
          category: state.me?.account?.category || "",
          platformListingState: state.dashboard?.metrics?.recommendationStatus === "active" ? "active" : "inactive",
        }];
    if (!list.filter((item) => item.merchantAccountId || item.name).length) {
      el.listingRequestStores.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("listingStoresEmpty"))}</div>`;
      return;
    }
    el.listingRequestStores.innerHTML = list.map((item, index) => `
      <label class="merchant-store-option">
        <input type="checkbox" value="${escapeHtml(item.merchantAccountId || "")}" ${index === 0 ? "checked" : ""} />
        <span>
          <strong>${escapeHtml(item.name || "-")}</strong>
          <small>${escapeHtml(localizeVisibleMerchantText(item.city || "", item.city || "-"))} · ${escapeHtml(localizeVisibleMerchantText(item.category || "", item.category || "-"))} · ${escapeHtml(item.platformListingState === "active" ? tm("listingStoreStateActive") : tm("listingStoreStatePending"))}</small>
        </span>
      </label>
    `).join("");
    syncListingRequestTemplate(false);
  }

  function renderChecklist(items = []) {
    if (!Array.isArray(items) || !items.length) {
      el.checklist.innerHTML = `<div class="merchant-empty">${escapeHtml(tm("checklistEmpty"))}</div>`;
      return;
    }
    el.checklist.innerHTML = items.map((item, index) => `
      <article class="merchant-list-item">
        <div class="merchant-list-item-check">
          <span class="merchant-list-bullet">${index + 1}</span>
          <div class="merchant-list-meta">${escapeHtml(localizeVisibleMerchantText(item, item))}</div>
        </div>
      </article>
    `).join("");
  }

  function renderProfile(me) {
    const account = me?.account || {};
    const parentAccount = me?.parentAccount || null;
    const typeLabel = accountTypeLabel(account.accountType);
    const parentLabel = parentAccount?.name ? ` · ${tm("profileParent", { name: localizeVisibleMerchantText(parentAccount.name, parentAccount.name) })}` : "";
    el.accountName.textContent = account.name || "Merchant Console";
    el.accountMeta.textContent = `${account.slug || "-"} · ${localizeVisibleMerchantText(account.city || "", account.city || "-")} · ${localizeVisibleMerchantText(account.category || "", account.category || "-")} · ${typeLabel}${parentLabel} · ${localizeVisibleMerchantText(me?.user?.role || "", me?.user?.role || "-")}`;
    el.profileUpdated.textContent = account.updatedAt ? tm("profileUpdatedAt", { time: formatTime(account.updatedAt) }) : tm("profileNotUpdated");
    fillForm({
      profileName: account.name || "",
      profileCity: account.city || "",
      profileCategory: account.category || "",
      profileContactName: account.contactName || "",
      profileContactPhone: account.contactPhone || "",
      profileContactEmail: account.contactEmail || "",
      profileDescription: account.description || "",
      listingRequestType: getPreferredListingRequestType(),
      listingRequestTitle: parentAccount?.name
        ? pickMerchantText(`${parentAccount.name} 门店资料更新申请`, `Profile update request for ${localizeVisibleMerchantText(parentAccount.name, parentAccount.name)}`)
        : pickMerchantText(`${account.name || "商家"} 资料更新申请`, `Profile update request for ${localizeVisibleMerchantText(account.name || "Merchant", account.name || "Merchant")}`),
      listingRequestNote: "",
    });
    syncListingRequestTemplate(true);
    renderNotice(account.accountType === "enterprise_partner"
      ? tm("noticeEnterprise")
      : tm("noticeSingle"));
  }

  async function refreshAll() {
    const [meRes, dashboardRes, listingRequestRes] = await Promise.all([
      api("/api/merchant/me"),
      api("/api/merchant/dashboard"),
      api("/api/merchant/listing-requests?limit=20"),
    ]);
    state.me = meRes.data;
    state.dashboard = dashboardRes.data;
    state.listingRequests = Array.isArray(listingRequestRes.data?.requests) ? listingRequestRes.data.requests : [];
    showApp();
    renderMetrics(state.dashboard.metrics);
    renderProfile(state.me);
    renderPlatformListing(state.dashboard.platformListing || {});
    renderScopedStores(state.dashboard.scopedStores || []);
    renderListingRequestStores(state.dashboard.scopedStores || []);
    renderListingRequests(state.listingRequests);
    renderChecklist(state.dashboard.opsChecklist);
    renderSettlement(state.dashboard.settlement);
    renderActivity(state.dashboard.activity);
    await Promise.all([
      loadOrders(state.orderFilter),
      loadSupportTickets(state.supportFilter),
      loadSettlements(state.settlementFilter),
    ]);
  }

  async function hasMerchantSession() {
    try {
      const response = await fetch("/api/merchant/session", { credentials: "same-origin" });
      const payload = await readJsonSafe(response, {});
      return Boolean(response.ok && payload && payload.authenticated);
    } catch {
      return false;
    }
  }

  async function loadOrders(status = "") {
    state.orderFilter = status || "";
    const query = new URLSearchParams();
    if (state.orderFilter) query.set("status", state.orderFilter);
    query.set("limit", "20");
    const response = await api(`/api/merchant/orders?${query.toString()}`);
    state.orders = Array.isArray(response.data?.orders) ? response.data.orders : [];
    renderOrders(state.orders);
  }

  async function loadSupportTickets(status = "") {
    state.supportFilter = status || "";
    const query = new URLSearchParams();
    if (state.supportFilter) query.set("status", state.supportFilter);
    query.set("limit", "20");
    const response = await api(`/api/merchant/support-tickets?${query.toString()}`);
    state.supportTickets = Array.isArray(response.data?.tickets) ? response.data.tickets : [];
    renderSupportTickets(state.supportTickets);
  }

  async function loadSettlements(status = "") {
    state.settlementFilter = status || "";
    const query = new URLSearchParams();
    if (state.settlementFilter) query.set("status", state.settlementFilter);
    query.set("limit", "20");
    const response = await api(`/api/merchant/settlements?${query.toString()}`);
    state.settlements = Array.isArray(response.data?.settlements) ? response.data.settlements : [];
    renderSettlementList(state.settlements);
  }

  async function downloadSettlementExport() {
    const query = new URLSearchParams();
    if (state.settlementFilter) query.set("status", state.settlementFilter);
    query.set("limit", "200");
    const original = el.settlementExportBtn.textContent;
    el.settlementExportBtn.disabled = true;
    el.settlementExportBtn.textContent = tm("exportLoading");
    try {
      const response = await fetch(`/api/merchant/settlements/export.csv?${query.toString()}`);
      if (!response.ok) {
        const data = await readJsonSafe(response, {});
        throw new Error(sanitizeClientErrorCode(data.error || data.code || data.reason, `http_${response.status}`));
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `crossx-merchant-settlements-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      renderNotice(tm("exportSuccess"));
    } catch (err) {
      renderNotice(tm("exportFailed", { msg: describeMerchantError(err) }));
    } finally {
      el.settlementExportBtn.disabled = false;
      el.settlementExportBtn.textContent = original;
    }
  }

  async function handleLogin(event) {
    event.preventDefault();
    el.loginError.classList.add("hidden");
    const username = $("merchantUsername").value.trim();
    const password = $("merchantPassword").value;
    const loginBtnText = el.loginBtn.textContent;
    el.loginBtn.disabled = true;
    el.loginBtn.textContent = tm("loginLoading");
    try {
      await api("/api/merchant/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      });
      await refreshAll();
    } catch (err) {
      showLogin(describeMerchantError(err, "unauthorized"));
    } finally {
      el.loginBtn.disabled = false;
      el.loginBtn.textContent = loginBtnText;
    }
  }

  async function handleProfileSave(event) {
    event.preventDefault();
    const submitter = event.submitter || el.profileForm.querySelector("button[type='submit']");
    const original = submitter.textContent;
    submitter.disabled = true;
    submitter.textContent = tm("profileSaving");
    try {
      await api("/api/merchant/profile", {
        method: "PUT",
        body: JSON.stringify({
          name: $("profileName").value.trim(),
          city: $("profileCity").value.trim(),
          category: $("profileCategory").value.trim(),
          contactName: $("profileContactName").value.trim(),
          contactPhone: $("profileContactPhone").value.trim(),
          contactEmail: $("profileContactEmail").value.trim(),
          description: $("profileDescription").value.trim(),
        }),
      });
      await refreshAll();
      renderNotice(tm("profileSaved"));
    } catch (err) {
      renderNotice(tm("profileSaveFailed", { msg: describeMerchantError(err) }));
    } finally {
      submitter.disabled = false;
      submitter.textContent = original;
    }
  }

  async function handleListingRequestSubmit(event) {
    event.preventDefault();
    const submitter = event.submitter || el.listingRequestForm.querySelector("button[type='submit']");
    const original = submitter.textContent;
    const title = $("listingRequestTitle").value.trim();
    const note = $("listingRequestNote").value.trim();
    const stores = Array.from(el.listingRequestStores?.querySelectorAll("input[type='checkbox']:checked") || [])
      .map((node) => node.value)
      .filter(Boolean);
    if (!title) {
      renderNotice(tm("requestTitleRequired"));
      return;
    }
    if (!note) {
      renderNotice(tm("requestNoteRequired"));
      return;
    }
    submitter.disabled = true;
    submitter.textContent = tm("requestSubmitting");
    try {
      await api("/api/merchant/listing-requests", {
        method: "POST",
        body: JSON.stringify({
          requestType: $("listingRequestType").value,
          title,
          note,
          stores,
        }),
      });
      el.listingRequestForm.reset();
      await refreshAll();
      renderNotice(tm("requestSubmitted"));
    } catch (err) {
      renderNotice(tm("requestSubmitFailed", { msg: describeMerchantError(err) }));
    } finally {
      submitter.disabled = false;
      submitter.textContent = original;
    }
  }

  async function handleOrderActionClick(event) {
    const button = event.target.closest("[data-order-action]");
    if (!button) return;
    const orderId = button.dataset.orderId || "";
    const action = button.dataset.orderAction || "";
    const card = button.closest(".merchant-list-item");
    const noteInput = card?.querySelector(`[data-order-note="${escapeSelectorValue(orderId)}"]`);
    const note = noteInput ? noteInput.value.trim() : "";
    if (action === "issue" && !note) {
      renderNotice(tm("orderIssueNoteRequired"));
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = tm("orderActionLoading");
    try {
      const response = await api(`/api/merchant/orders/${encodeURIComponent(orderId)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, note }),
      });
      if (noteInput) noteInput.value = "";
      await refreshAll();
      renderNotice(localizeVisibleMerchantText(response.data?.message || "", tm("orderActionDone")));
    } catch (err) {
      renderNotice(tm("orderActionFailed", { msg: describeMerchantError(err) }));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function handleSupportCommentClick(event) {
    const button = event.target.closest("[data-ticket-comment]");
    if (!button) return;
    const ticketId = button.dataset.ticketId || "";
    const card = button.closest(".merchant-list-item");
    const noteInput = card?.querySelector(`[data-ticket-note="${escapeSelectorValue(ticketId)}"]`);
    const note = noteInput ? noteInput.value.trim() : "";
    if (!note) {
      renderNotice(tm("supportNoteRequired"));
      return;
    }
    const original = button.textContent;
    button.disabled = true;
    button.textContent = tm("supportSending");
    try {
      const response = await api(`/api/merchant/support-tickets/${encodeURIComponent(ticketId)}/comment`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      if (noteInput) noteInput.value = "";
      await loadSupportTickets(state.supportFilter);
      renderNotice(localizeVisibleMerchantText(response.data?.message || "", tm("supportSent")));
    } catch (err) {
      renderNotice(tm("supportSendFailed", { msg: describeMerchantError(err) }));
    } finally {
      button.disabled = false;
      button.textContent = original;
    }
  }

  async function handleLogout() {
    try {
      await fetch("/api/merchant/logout", { method: "POST" });
    } catch {}
    state.orders = [];
    state.orderFilter = "";
    state.supportTickets = [];
    state.supportFilter = "";
    state.settlements = [];
    state.settlementFilter = "";
    state.listingRequests = [];
    showLogin("");
    el.loginForm.reset();
  }

  async function bootstrap() {
    Object.assign(el, {
      loginView: $("merchantLoginView"),
      appView: $("merchantAppView"),
      loginForm: $("merchantLoginForm"),
      loginBtn: $("merchantLoginBtn"),
      loginPassword: $("merchantPassword"),
      loginError: $("merchantLoginError"),
      langLabel: $("merchantLangLabel"),
      langSwitch: $("merchantLangSwitch"),
      heroTitle: $("merchantHeroTitle"),
      heroCopy: $("merchantHeroCopy"),
      heroTagProfile: $("merchantHeroTagProfile"),
      heroTagFulfillment: $("merchantHeroTagFulfillment"),
      heroTagSupport: $("merchantHeroTagSupport"),
      heroTagSettlement: $("merchantHeroTagSettlement"),
      scopeItem1: $("merchantScopeItem1"),
      scopeItem2: $("merchantScopeItem2"),
      scopeItem3: $("merchantScopeItem3"),
      openUserAppLink: $("merchantOpenUserAppLink"),
      loginTitle: $("merchantLoginTitle"),
      loginCopy: $("merchantLoginCopy"),
      loginItem1: $("merchantLoginItem1"),
      loginItem2: $("merchantLoginItem2"),
      loginUserLabel: $("merchantLoginUserLabel"),
      loginPasswordLabel: $("merchantLoginPasswordLabel"),
      navMetrics: $("merchantNavMetrics"),
      navPlatform: $("merchantNavPlatform"),
      navRequest: $("merchantNavRequest"),
      navProfile: $("merchantNavProfile"),
      navOrders: $("merchantNavOrders"),
      navSupport: $("merchantNavSupport"),
      navSettlement: $("merchantNavSettlement"),
      platformTitle: $("merchantPlatformTitle"),
      platformCopy: $("merchantPlatformCopy"),
      storeNetworkTitle: $("merchantStoreNetworkTitle"),
      storeNetworkCopy: $("merchantStoreNetworkCopy"),
      checklistTitle: $("merchantChecklistTitle"),
      checklistCopy: $("merchantChecklistCopy"),
      settlementOverviewTitle: $("merchantSettlementOverviewTitle"),
      settlementOverviewCopy: $("merchantSettlementOverviewCopy"),
      listingRequestTitle: $("merchantListingRequestTitle"),
      listingFormStatus: $("merchantListingFormStatus"),
      listingRequestCopy: $("merchantListingRequestCopy"),
      listingRequestTypeLabel: $("merchantListingRequestTypeLabel"),
      listingRequestTitleLabel: $("merchantListingRequestTitleLabel"),
      listingRequestTitleInput: $("listingRequestTitle"),
      listingRequestStoresLabel: $("merchantListingRequestStoresLabel"),
      listingRequestNoteLabel: $("merchantListingRequestNoteLabel"),
      listingRequestNoteInput: $("listingRequestNote"),
      listingRequestSubmitBtn: $("merchantListingRequestSubmitBtn"),
      profileTitle: $("merchantProfileTitle"),
      profileCopy: $("merchantProfileCopy"),
      profileNameLabel: $("merchantProfileNameLabel"),
      profileCityLabel: $("merchantProfileCityLabel"),
      profileCategoryLabel: $("merchantProfileCategoryLabel"),
      profileContactNameLabel: $("merchantProfileContactNameLabel"),
      profileContactPhoneLabel: $("merchantProfileContactPhoneLabel"),
      profileContactEmailLabel: $("merchantProfileContactEmailLabel"),
      profileDescriptionLabel: $("merchantProfileDescriptionLabel"),
      profileSubmitBtn: $("merchantProfileSubmitBtn"),
      fulfillmentTitle: $("merchantFulfillmentTitle"),
      fulfillmentCopy: $("merchantFulfillmentCopy"),
      supportTitle: $("merchantSupportTitle"),
      supportCopy: $("merchantSupportCopy"),
      settlementTitle: $("merchantSettlementTitle"),
      settlementCopy: $("merchantSettlementCopy"),
      activityTitle: $("merchantActivityTitle"),
      activityCopy: $("merchantActivityCopy"),
      refreshBtn: $("merchantRefreshBtn"),
      logoutBtn: $("merchantLogoutBtn"),
      metrics: $("merchantMetrics"),
      notice: $("merchantNotice"),
      accountName: $("merchantAccountName"),
      accountMeta: $("merchantAccountMeta"),
      profileUpdated: $("merchantProfileUpdated"),
      profileForm: $("merchantProfileForm"),
      listingRequestForm: $("merchantListingRequestForm"),
      listingRequestStores: $("merchantListingRequestStores"),
      listingRequestHelper: $("merchantListingRequestHelper"),
      listingRequestsList: $("merchantListingRequestsList"),
      activityList: $("merchantActivityList"),
      orderList: $("merchantOrderList"),
      platformListingBadge: $("merchantPlatformListingBadge"),
      platformListingSummary: $("merchantPlatformListingSummary"),
      platformListingTags: $("merchantPlatformListingTags"),
      scopedStoreBadge: $("merchantScopedStoreBadge"),
      scopedStoreSummary: $("merchantScopedStoreSummary"),
      scopedStoreCityFilter: $("merchantScopedStoreCityFilter"),
      scopedStoreStatusFilter: $("merchantScopedStoreStatusFilter"),
      scopedStoreSort: $("merchantScopedStoreSort"),
      scopedStoreHighlights: $("merchantScopedStoreHighlights"),
      scopedStoreGroups: $("merchantScopedStoreGroups"),
      scopedStoreList: $("merchantScopedStoreList"),
      checklist: $("merchantChecklist"),
      settlementSummary: $("merchantSettlementSummary"),
      orderStatusFilter: $("merchantOrderStatusFilter"),
      orderRefreshBtn: $("merchantOrderRefreshBtn"),
      supportStatusFilter: $("merchantSupportStatusFilter"),
      supportList: $("merchantSupportList"),
      supportRefreshBtn: $("merchantSupportRefreshBtn"),
      settlementStatusFilter: $("merchantSettlementStatusFilter"),
      settlementList: $("merchantSettlementList"),
      settlementRefreshBtn: $("merchantSettlementRefreshBtn"),
      settlementExportBtn: $("merchantSettlementExportBtn"),
    });

    try {
      state.language = normalizeLanguage(localStorage.getItem("crossx_merchant_lang") || navigator.language || "ZH");
    } catch {
      state.language = "ZH";
    }
    applyMerchantLanguage();

    el.loginForm.addEventListener("submit", handleLogin);
    el.langSwitch?.addEventListener("change", () => {
      state.language = normalizeLanguage(el.langSwitch.value || "ZH");
      try { localStorage.setItem("crossx_merchant_lang", state.language); } catch {}
      applyMerchantLanguage();
      if (state.me) {
        renderProfile(state.me);
        renderMetrics(state.dashboard?.metrics || {});
        renderPlatformListing(state.dashboard?.platformListing || {});
        renderScopedStores(state.dashboard?.scopedStores || []);
        renderListingRequestStores(state.dashboard?.scopedStores || []);
        renderListingRequests(state.listingRequests || []);
        renderChecklist(state.dashboard?.opsChecklist || []);
        renderSettlement(state.dashboard?.settlement || {});
        renderActivity(state.dashboard?.activity || []);
        renderOrders(state.orders || []);
        renderSupportTickets(state.supportTickets || []);
        renderSettlementList(state.settlements || []);
      }
    });
    el.refreshBtn.addEventListener("click", () => refreshAll().catch((err) => renderNotice(tm("refreshFailed", { msg: describeMerchantError(err) }))));
    el.logoutBtn.addEventListener("click", () => { handleLogout().catch(() => {}); });
    el.profileForm.addEventListener("submit", handleProfileSave);
    el.listingRequestForm.addEventListener("submit", handleListingRequestSubmit);
    $("listingRequestType")?.addEventListener("change", () => syncListingRequestTemplate(true));
    const rerenderScopedStores = () => renderScopedStores(state.dashboard?.scopedStores || []);
    el.scopedStoreCityFilter?.addEventListener("change", rerenderScopedStores);
    el.scopedStoreStatusFilter?.addEventListener("change", rerenderScopedStores);
    el.scopedStoreSort?.addEventListener("change", rerenderScopedStores);
    el.orderStatusFilter?.addEventListener("change", () => {
      loadOrders(el.orderStatusFilter.value).catch((err) => renderNotice(tm("orderLoadFailed", { msg: describeMerchantError(err) })));
    });
    el.orderRefreshBtn?.addEventListener("click", () => {
      loadOrders(el.orderStatusFilter?.value || "").catch((err) => renderNotice(tm("orderRefreshFailed", { msg: describeMerchantError(err) })));
    });
    el.orderList?.addEventListener("click", handleOrderActionClick);
    el.supportStatusFilter?.addEventListener("change", () => {
      loadSupportTickets(el.supportStatusFilter.value).catch((err) => renderNotice(tm("supportLoadFailed", { msg: describeMerchantError(err) })));
    });
    el.supportRefreshBtn?.addEventListener("click", () => {
      loadSupportTickets(el.supportStatusFilter?.value || "").catch((err) => renderNotice(tm("supportRefreshFailed", { msg: describeMerchantError(err) })));
    });
    el.supportList?.addEventListener("click", handleSupportCommentClick);
    el.settlementStatusFilter?.addEventListener("change", () => {
      loadSettlements(el.settlementStatusFilter.value).catch((err) => renderNotice(tm("settlementLoadFailed", { msg: describeMerchantError(err) })));
    });
    el.settlementRefreshBtn?.addEventListener("click", () => {
      loadSettlements(el.settlementStatusFilter?.value || "").catch((err) => renderNotice(tm("settlementRefreshFailed", { msg: describeMerchantError(err) })));
    });
    el.settlementExportBtn?.addEventListener("click", () => {
      downloadSettlementExport().catch((err) => renderNotice(tm("exportFailed", { msg: describeMerchantError(err) })));
    });

    const authenticated = await hasMerchantSession();
    if (!authenticated) {
      showLogin("");
      return;
    }

    try {
      await refreshAll();
    } catch (err) {
      if (err.status === 401) {
        showLogin("");
        return;
      }
      renderNotice(tm("initFailed", { msg: describeMerchantError(err) }));
      showApp();
    }
  }

  bootstrap().catch((err) => {
    showLogin(tm("initFailed", { msg: describeMerchantError(err) }));
  });
})();
