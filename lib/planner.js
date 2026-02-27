function parseIntentType(intent) {
  const text = String(intent || "").toLowerCase();
  const eatKeywords = ["eat", "food", "restaurant", "dinner", "lunch", "breakfast", "吃", "餐厅", "美食", "排队", "订位"];
  const travelKeywords = ["airport", "taxi", "ride", "flight", "metro", "go to", "机场", "打车", "出行", "路线"];
  if (eatKeywords.some((k) => text.includes(k))) return "eat";
  if (travelKeywords.some((k) => text.includes(k))) return "travel";
  return "eat";
}

function findTextValue(text, patterns) {
  for (const pattern of patterns) {
    const hit = text.match(pattern);
    if (hit && hit[1]) return hit[1].trim();
  }
  return "";
}

function normalizeConstraints(constraints) {
  const c = constraints && typeof constraints === "object" ? constraints : {};
  const distance = c.distance || "walk";
  const transportMode =
    c.transport_mode ||
    c.transportMode ||
    (distance === "walk" ? "walk_first" : distance === "ride" ? "ride_first" : distance === "metro" ? "metro_first" : "");
  return {
    budget: c.budget || "mid",
    distance,
    time: c.time || "soon",
    dietary: c.dietary || "",
    family: c.family === true || c.family === "true",
    accessibility: c.accessibility || "optional",
    city: c.city || "Shanghai",
    area: c.area || "",
    cuisine: c.cuisine || "",
    group_size: c.group_size || c.groupSize || "",
    transport_mode: transportMode,
    payment_constraint: c.payment_constraint || c.paymentConstraint || "",
    origin: c.origin || "",
    destination: c.destination || "",
    originLat: Number.isFinite(Number(c.originLat)) ? Number(c.originLat) : undefined,
    originLng: Number.isFinite(Number(c.originLng)) ? Number(c.originLng) : undefined,
  };
}

function normalizeBudgetByHint(raw) {
  const text = String(raw || "").toLowerCase();
  if (!text) return "";
  if (["low", "cheap", "budget", "省钱", "便宜"].some((k) => text.includes(k))) return "low";
  if (["high", "premium", "luxury", "高端", "高预算"].some((k) => text.includes(k))) return "high";
  if (["mid", "medium", "适中"].some((k) => text.includes(k))) return "mid";
  const num = Number(String(text).replace(/[^\d]/g, ""));
  if (Number.isFinite(num) && num > 0) {
    if (num <= 300) return "low";
    if (num >= 1200) return "high";
    return "mid";
  }
  return "";
}

function parseGroupSize(text, constraints) {
  if (constraints && Number.isFinite(Number(constraints.group_size)) && Number(constraints.group_size) > 0) {
    return String(Math.round(Number(constraints.group_size)));
  }
  const first = findTextValue(text, [/(\d+)\s*(?:人|位|people|pax|guests?)/i, /\bfor\s+(\d+)\b/i]);
  if (!first) return "";
  const n = Number(first);
  if (!Number.isFinite(n) || n <= 0) return "";
  return String(Math.round(n));
}

function extractSlots({ intent, intentType, constraints }) {
  const text = String(intent || "");
  const lower = text.toLowerCase();
  const city =
    constraints.city ||
    (lower.includes("shanghai") || text.includes("上海")
      ? "Shanghai"
      : lower.includes("beijing") || text.includes("北京")
        ? "Beijing"
        : lower.includes("shenzhen") || text.includes("深圳")
          ? "Shenzhen"
          : lower.includes("guangzhou") || text.includes("广州")
            ? "Guangzhou"
            : "");

  const area = findTextValue(text, [/附近\s*([^\s，。,.]+)/, /in\s+([a-zA-Z\s]+)\s+area/i, /near\s+([a-zA-Z\s]+)/i]);
  const cuisine =
    constraints.dietary ||
    (lower.includes("halal") || text.includes("清真")
      ? "halal"
      : lower.includes("vegan") || text.includes("素")
        ? "vegan"
        : lower.includes("noodle") || text.includes("面")
          ? "noodle"
          : lower.includes("hotpot") || text.includes("火锅")
            ? "hotpot"
            : "");
  const budget = constraints.budget || normalizeBudgetByHint(text) || "";
  const eta =
    constraints.time ||
    (lower.includes("asap") || text.includes("尽快")
      ? "soon"
      : lower.includes("tonight") || text.includes("今晚")
        ? "tonight"
        : lower.includes("tomorrow") || text.includes("明天")
          ? "tomorrow"
          : "");
  const groupSize = parseGroupSize(text, constraints);
  const transportMode =
    constraints.transport_mode ||
    (constraints.distance === "walk"
      ? "walk_first"
      : constraints.distance === "ride"
        ? "ride_first"
        : lower.includes("metro") || text.includes("地铁")
          ? "metro_first"
          : lower.includes("taxi") || text.includes("打车")
            ? "ride_first"
            : "");
  const paymentConstraint =
    constraints.payment_constraint ||
    (lower.includes("alipay") || text.includes("支付宝")
      ? "alipay_cn"
      : lower.includes("wechat") || text.includes("微信")
        ? "wechat_cn"
        : lower.includes("card") || text.includes("外卡")
          ? "card_delegate"
          : "");
  const origin = constraints.origin || findTextValue(text, [/from\s+([a-zA-Z0-9_\-\s]+)\s+to/i, /从\s*([^\s，。,.]+)\s*到/]);
  const destination = constraints.destination || findTextValue(text, [/to\s+([a-zA-Z0-9_\-\s]+)$/i, /到\s*([^\s，。,.]+)/]);

  const slots = {
    city,
    area,
    cuisine,
    budget,
    eta,
    group_size: groupSize,
    transport_mode: transportMode,
    payment_constraint: paymentConstraint,
    origin,
    destination,
  };

  const required = intentType === "travel" ? ["origin", "destination", "eta", "transport_mode", "budget"] : ["city", "budget", "eta", "group_size"];
  const missingSlots = required.filter((key) => !String(slots[key] || "").trim());
  return { slots, missingSlots };
}

function buildExpertRoute({ intent, intentType }) {
  const lower = String(intent || "").toLowerCase();
  const experts = [];
  if (intentType === "eat") {
    experts.push({
      key: "eat_expert",
      name: "Eat Expert",
      confidence: 0.94,
      reason: "Best match for local food discovery, queue and reservation.",
    });
  } else {
    experts.push({
      key: "mobility_expert",
      name: "Mobility Expert",
      confidence: 0.93,
      reason: "Best match for route, congestion and transport lock.",
    });
  }
  experts.push({
    key: "payment_expert",
    name: "Payment Expert",
    confidence: 0.91,
    reason: "Ensures payment rail strategy and ACT checks.",
  });
  experts.push({
    key: "trust_expert",
    name: "Trust Expert",
    confidence: 0.9,
    reason: "Keeps authorization, audit and fallback policies consistent.",
  });
  if (["refund", "support", "售后", "退款", "客服"].some((k) => lower.includes(k))) {
    experts.push({
      key: "support_expert",
      name: "Support Expert",
      confidence: 0.87,
      reason: "Handles after-sales and human handoff strategy.",
    });
  }
  return {
    primary: experts[0].name,
    experts,
    reason: "Routing-based multi-expert plan for reliable closed-loop execution.",
  };
}

function buildAgentMeta({ taskId, intent, intentType, constraints }) {
  const { slots, missingSlots } = extractSlots({ intent, intentType, constraints: constraints || {} });
  return {
    expertRoute: buildExpertRoute({ intent, intentType }),
    sessionState: {
      taskId,
      intent: intentType,
      slots,
      missingSlots,
      stage: "planning",
      laneId: `${intentType}_default`,
      updatedAt: new Date().toISOString(),
    },
  };
}

function stepDef({ id, toolType, label, inputSchema, etaSec, fallbackPolicy, evidenceType }) {
  return {
    id,
    toolType,
    label,
    inputSchema,
    status: "queued",
    latency: 0,
    etaSec,
    retryable: true,
    fallbackPolicy: fallbackPolicy || "none",
    evidenceType: evidenceType || "api_receipt",
    inputPreview: "",
    outputPreview: "",
  };
}

function buildConfirm({ amount, currency, merchant, cancelPolicy, alternative, riskFlags, intentType }) {
  const deposit = intentType === "eat" ? Math.max(8, Math.round(amount * 0.3)) : Math.max(20, Math.round(amount * 0.2));
  const merchantFee = Math.max(0, amount - Math.max(6, Math.round(amount * 0.12)));
  const serviceFee = Math.max(6, Math.round(amount * 0.12));
  const thirdPartyFee = intentType === "travel" ? 2 : 1;
  const fxFee = intentType === "travel" ? 2 : 0;
  return {
    amount,
    currency,
    merchant,
    cancelPolicy,
    alternative,
    riskFlags,
    chargeType: intentType === "eat" ? "deposit" : "full_payment",
    deliverables:
      intentType === "eat"
        ? ["Reservation success", "Queue number", "Bilingual navigation card", "Payment receipt"]
        : ["Ride/Ticket lock", "Route + ETA card", "Bilingual navigation card", "Payment receipt"],
    breakdown: {
      merchantFee,
      serviceFee,
      thirdPartyFee,
      fxFee,
      total: amount,
      deposit,
    },
    guarantee: {
      freeCancelWindowMin: 10,
      refundEta: "T+1 to T+3",
      policyNote: cancelPolicy,
      riskControl: ["No-PIN capped by limits", "High amount requires second factor", "Operation chain is auditable"],
    },
    confirmReason:
      intentType === "eat"
        ? "We need your confirmation before we place queue/booking and charge your deposit."
        : "We need your confirmation before we lock transport inventory and charge the selected payment rail.",
  };
}

function buildPlan({ taskId, intent, constraints, lastUserQuery }) {
  const intentType = parseIntentType(intent);
  const normalizedConstraints = normalizeConstraints(constraints);
  const meta = buildAgentMeta({ taskId, intent, intentType, constraints: normalizedConstraints });
  const queryHint = lastUserQuery ? ` Refined from last query: ${lastUserQuery}.` : "";

  if (intentType === "eat") {
    const amount = 68;
    return {
      taskId,
      sourceIntent: intent,
      intentType,
      title: "Eat locally like a pro",
      estimatedCost: 168,
      reasoning: `Sorted by authenticity, walkability, queue wait and tourist-overpricing risk.${queryHint}`,
      mcpSummary: {
        query: "poi.search + restaurant.rank",
        book: "queue.reserve",
        pay: "act.charge",
        status: "booking.confirmed",
      },
      steps: [
        stepDef({
          id: "s1",
          toolType: "map.query",
          label: "Search nearby authentic restaurants",
          inputSchema: "Query",
          etaSec: 35,
          fallbackPolicy: "switch_lane_or_human",
          evidenceType: "poi_list",
        }),
        stepDef({
          id: "s2",
          toolType: "queue.status",
          label: "Check live queue and seats",
          inputSchema: "Status",
          etaSec: 25,
          fallbackPolicy: "fallback_to_human_queue",
          evidenceType: "queue_snapshot",
        }),
        stepDef({
          id: "s3",
          toolType: "book.lock",
          label: "Lock a table or queue number",
          inputSchema: "Book",
          etaSec: 30,
          fallbackPolicy: "switch_lane",
          evidenceType: "booking_receipt",
        }),
        stepDef({
          id: "s4",
          toolType: "pay.act",
          label: "Pay deposit with ACT",
          inputSchema: "Pay",
          etaSec: 20,
          fallbackPolicy: "refund_policy",
          evidenceType: "payment_receipt",
        }),
        stepDef({
          id: "s5",
          toolType: "proof.card",
          label: "Generate bilingual navigation + proof",
          inputSchema: "Status",
          etaSec: 18,
          fallbackPolicy: "manual_delivery",
          evidenceType: "proof_bundle",
        }),
      ],
      confirm: buildConfirm({
        amount,
        currency: "CNY",
        merchant: "Cross X (Merchant of Record)",
        cancelPolicy: "Free cancel within 10 minutes",
        alternative: "Switch to no-deposit restaurants",
        riskFlags: ["Cost applies", "Location will be shared", "Uses no-pin allowance"],
        intentType,
      }),
      constraints: normalizedConstraints,
      expertRoute: meta.expertRoute,
      sessionState: meta.sessionState,
      laneId: "eat_default",
    };
  }

  const amount = 128;
  return {
    taskId,
    sourceIntent: intent,
    intentType,
    title: "Navigate and pay seamlessly",
    estimatedCost: 212,
    reasoning: `Balanced punctuality, traffic reliability and payment success rate for inbound users.${queryHint}`,
    mcpSummary: {
      query: "route.search + traffic.live",
      book: "mobility.lock",
      pay: "act.charge",
      status: "ticket.confirmed",
    },
    steps: [
      stepDef({
        id: "s1",
        toolType: "route.plan",
        label: "Plan multi-stop route",
        inputSchema: "Query",
        etaSec: 35,
        fallbackPolicy: "switch_lane_or_human",
        evidenceType: "route_snapshot",
      }),
      stepDef({
        id: "s2",
        toolType: "traffic.live",
        label: "Check congestion risk",
        inputSchema: "Status",
        etaSec: 22,
        fallbackPolicy: "fallback_to_human_dispatch",
        evidenceType: "traffic_receipt",
      }),
      stepDef({
        id: "s3",
        toolType: "transport.lock",
        label: "Lock ride/ticket",
        inputSchema: "Book",
        etaSec: 28,
        fallbackPolicy: "switch_lane",
        evidenceType: "ticket_receipt",
      }),
      stepDef({
        id: "s4",
        toolType: "pay.act",
        label: "Pay with ACT",
        inputSchema: "Pay",
        etaSec: 18,
        fallbackPolicy: "refund_policy",
        evidenceType: "payment_receipt",
      }),
      stepDef({
        id: "s5",
        toolType: "proof.card",
        label: "Generate QR + trip card",
        inputSchema: "Status",
        etaSec: 18,
        fallbackPolicy: "manual_delivery",
        evidenceType: "proof_bundle",
      }),
    ],
    confirm: buildConfirm({
      amount,
      currency: "CNY",
      merchant: "Cross X (Merchant of Record)",
      cancelPolicy: "Partial refund before dispatch",
      alternative: "Switch to metro-only route",
      riskFlags: ["Cost applies", "Location will be shared", "Uses no-pin allowance"],
      intentType,
    }),
    constraints: normalizedConstraints,
    expertRoute: meta.expertRoute,
    sessionState: meta.sessionState,
    laneId: "travel_default",
  };
}

module.exports = {
  parseIntentType,
  buildAgentMeta,
  buildPlan,
};
