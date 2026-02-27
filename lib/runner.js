const { shapeMcpCall, validateMcpResult } = require("./mcp/schema");

function stablePercent(input) {
  const text = String(input || "");
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0) % 100;
}

function resolveContract(plan, source) {
  const table = plan && plan.constraints && plan.constraints.mcpContracts ? plan.constraints.mcpContracts : {};
  const contract = source && table[source] ? table[source] : null;
  if (!contract || typeof contract !== "object") return null;
  return contract;
}

function stepMapper(intentType) {
  if (intentType === "eat") {
    return {
      "map.query": "queryMap",
      "queue.status": "checkQueue",
      "book.lock": "lockBooking",
      "pay.act": "payAct",
      "proof.card": "makeProof",
    };
  }
  return {
    "route.plan": "planRoute",
    "traffic.live": "checkTraffic",
    "transport.lock": "lockTransport",
    "pay.act": "payAct",
    "proof.card": "makeProof",
  };
}

function previewInput(input, step) {
  const safe = input && typeof input === "object" ? input : {};
  if (step.toolType === "pay.act") {
    return `${safe.amount || 0} ${safe.currency || "CNY"} via ${safe.railId || "-"}`;
  }
  return `city=${safe.city || "-"} budget=${(safe.constraints && safe.constraints.budget) || "-"} time=${(safe.constraints && safe.constraints.time) || "-"}`;
}

function previewOutput(result, step) {
  const data = result && result.data && typeof result.data === "object" ? result.data : {};
  if (step.toolType === "queue.status") {
    return `wait ${data.waitMin || 0} min, seats ${data.seatsLeft || 0}`;
  }
  if (step.toolType === "traffic.live") {
    return `congestion ${data.congestionLevel || "-"}, risk ${data.risk || "-"}`;
  }
  if (step.toolType === "book.lock") {
    return `lock ${data.lockId || "-"}`;
  }
  if (step.toolType === "transport.lock") {
    return `ticket ${data.ticketRef || "-"}`;
  }
  if (step.toolType === "pay.act") {
    return `payment ref ${data.paymentRef || "-"} (${data.railLabel || data.railId || "-"})`;
  }
  if (step.toolType === "proof.card") {
    return String(data.itinerary || "Proof generated").slice(0, 96);
  }
  if (step.toolType === "map.query") {
    const picks = Array.isArray(data.picks) ? data.picks.length : 0;
    return `ranked ${picks} candidate(s)`;
  }
  if (step.toolType === "route.plan") {
    return `eta ${data.etaMin || 0} min`;
  }
  return "completed";
}

function fallbackSupported(step) {
  return step.toolType === "queue.status" || step.toolType === "traffic.live";
}

function shouldSkipStep(step, plan) {
  const c = (plan && plan.constraints) || {};
  return step.toolType === "traffic.live" && c.time === "flexible";
}

function shouldForceFallback(step, plan, taskId) {
  const c = (plan && plan.constraints) || {};
  if (!(step.toolType === "queue.status" || step.toolType === "traffic.live")) return false;
  if (c.time !== "soon") return false;
  const ticket = stablePercent(`${taskId}:${step.id}:${step.toolType}:availability`);
  return ticket < 12;
}

function pushFallbackStep({ step, timeline, outputs, stepLogs, taskId, reason }) {
  const ts = new Date().toISOString();
  step.status = "fallback_to_human";
  step.latency = 0;
  step.outputPreview = reason;
  step.evidence = {
    type: "fallback_notice",
    title: "Automatic fallback engaged",
    receiptId: `FALLBACK-${taskId}-${step.id}`,
    generatedAt: ts,
    imagePath: "/assets/solution-trust.svg",
    note: reason,
  };
  timeline.push({
    stepId: step.id,
    label: step.label,
    status: "fallback_to_human",
    reason,
    latency: 0,
    at: ts,
  });
  outputs.push({
    stepId: step.id,
    toolType: step.toolType,
    mcpOp: "status",
    data: { fallback: true, reason, handoffSuggested: true },
    latency: 0,
    fallback: true,
  });
  stepLogs.push({
    op: "Status",
    toolType: step.toolType,
    request: {
      op: "Status",
      payload: {},
      at: ts,
    },
    response: {
      op: "Status",
      ok: true,
      status: "success",
      code: "fallback_to_human",
      latency: 0,
      slaMs: 2000,
      slaMet: true,
      data: {
        provider: "Cross X Human Concierge",
        source: "human_fallback",
        sourceTs: ts,
        note: reason,
      },
    },
  });
}

async function executePlan({ plan, tools, amount, currency, userId, taskId, paymentRail }) {
  const map = stepMapper(plan.intentType);
  const runner = plan.intentType === "eat" ? tools.food : tools.travel;
  const timeline = [];
  const outputs = [];
  const stepLogs = [];
  let proof = null;

  for (const step of plan.steps) {
    const fn = runner[map[step.toolType]];
    step.status = "running";
    const runningAt = new Date().toISOString();
    timeline.push({
      stepId: step.id,
      label: step.label,
      status: "running",
      reason: "Started by orchestrator",
      latency: 0,
      etaSec: Number(step.etaSec || 0),
      at: runningAt,
    });

    if (!fn) {
      step.status = "failed";
      timeline.push({
        stepId: step.id,
        label: step.label,
        status: "failed",
        reason: "Missing tool mapping",
        latency: 0,
        etaSec: Number(step.etaSec || 0),
        at: new Date().toISOString(),
      });
      throw new Error(`Tool not found for ${step.toolType}`);
    }

    if (shouldSkipStep(step, plan)) {
      step.status = "skipped";
      step.latency = 0;
      step.outputPreview = "Skipped because time is flexible and cached route confidence is high.";
      timeline.push({
        stepId: step.id,
        label: step.label,
        status: "skipped",
        reason: "Skipped under flexible-time strategy",
        latency: 0,
        etaSec: Number(step.etaSec || 0),
        at: new Date().toISOString(),
      });
      outputs.push({
        stepId: step.id,
        toolType: step.toolType,
        mcpOp: "status",
        data: { skipped: true },
        latency: 0,
        skipped: true,
      });
      continue;
    }

    const input =
      step.toolType === "pay.act"
        ? {
            amount,
            currency,
            userId,
            taskId,
            railId: paymentRail || (plan.confirm && plan.confirm.paymentRail) || "alipay_cn",
          }
        : {
            intent: plan.sourceIntent,
            city: plan?.constraints?.city || "Shanghai",
            origin: plan?.constraints?.origin,
            destination: plan?.constraints?.destination,
            constraints: plan?.constraints || {},
          };
    step.inputPreview = previewInput(input, step);

    if (shouldForceFallback(step, plan, taskId)) {
      pushFallbackStep({
        step,
        timeline,
        outputs,
        stepLogs,
        taskId,
        reason: `${step.toolType} unavailable, switched to human-assisted lane`,
      });
      continue;
    }

    const startedAt = Date.now();
    let result;
    try {
      result = await fn(input);
    } catch (err) {
      if (fallbackSupported(step)) {
        pushFallbackStep({
          step,
          timeline,
          outputs,
          stepLogs,
          taskId,
          reason: `${step.toolType} error, escalated to human fallback`,
        });
        continue;
      }
      step.status = "failed";
      timeline.push({
        stepId: step.id,
        label: step.label,
        status: "failed",
        reason: err.message || "tool execution failed",
        latency: Date.now() - startedAt,
        etaSec: Number(step.etaSec || 0),
        at: new Date().toISOString(),
      });
      throw err;
    }
    const call = shapeMcpCall({ toolType: step.toolType, input, result, elapsedMs: Date.now() - startedAt });
    const policy = (plan && plan.constraints && plan.constraints.mcpPolicy) || {};
    const source = call && call.response && call.response.data ? call.response.data.source : "";
    const contract = resolveContract(plan, source);
    if (contract && contract.enforced) {
      const contractSla = Number(contract.slaMs || call.response.slaMs || 0);
      if (contractSla > 0) {
        call.response.slaMs = contractSla;
        call.response.slaMet = Number(call.response.latency || 0) <= contractSla;
      }
      call.response.contractId = contract.id || source;
      call.response.contractProvider = contract.provider || call.response.data.provider || "unknown";
    }
    const simulateRate = Math.max(0, Math.min(100, Number(policy.simulateBreachRate || 0)));
    if (simulateRate > 0 && stablePercent(`${taskId}:${step.id}:${step.toolType}`) < simulateRate) {
      call.response.slaMet = false;
      call.response.latency = Math.max(call.response.latency, Number(call.response.slaMs || 0) + 50);
      call.response.code = "sla_breach_simulated";
    }
    stepLogs.push(call);

    if (!validateMcpResult(call)) {
      if (fallbackSupported(step)) {
        pushFallbackStep({
          step,
          timeline,
          outputs,
          stepLogs,
          taskId,
          reason: `${step.toolType} schema invalid, moved to human fallback`,
        });
        continue;
      }
      step.status = "failed";
      timeline.push({
        stepId: step.id,
        label: step.label,
        status: "failed",
        reason: "MCP response schema validation failed",
        latency: call.response.latency,
        etaSec: Number(step.etaSec || 0),
        at: new Date().toISOString(),
      });
      throw new Error(`Invalid MCP response for ${step.toolType}`);
    }

    const strictSla = Boolean(policy.enforceSla);
    if (strictSla && call.response && call.response.slaMet === false) {
      if (fallbackSupported(step)) {
        pushFallbackStep({
          step,
          timeline,
          outputs,
          stepLogs,
          taskId,
          reason: `${step.toolType} SLA breached, switched to human fallback`,
        });
        continue;
      }
      step.status = "failed";
      timeline.push({
        stepId: step.id,
        label: step.label,
        status: "failed",
        reason: "MCP SLA breached under strict policy",
        latency: call.response.latency,
        etaSec: Number(step.etaSec || 0),
        at: new Date().toISOString(),
      });
      throw new Error(`SLA breach for ${step.toolType}`);
    }

    step.status = result.ok ? "success" : "failed";
    step.latency = result.latency;
    step.outputPreview = previewOutput(result, step);
    step.evidence = {
      type: step.evidenceType || "api_receipt",
      title: step.label,
      receiptId: `${taskId}-${step.id}-${Date.now().toString().slice(-6)}`,
      generatedAt: new Date().toISOString(),
      imagePath: step.toolType === "proof.card" ? "/assets/solution-trust.svg" : "/assets/solution-flow.svg",
      summary: step.outputPreview,
    };
    timeline.push({
      stepId: step.id,
      label: step.label,
      status: step.status,
      reason: result.ok ? "Tool returned valid MCP response" : "Tool failure",
      latency: result.latency,
      etaSec: Number(step.etaSec || 0),
      at: new Date().toISOString(),
    });

    if (!result.ok) {
      throw new Error(`Tool failure for ${step.toolType}: ${result.errorCode || "tool_error"}`);
    }

    outputs.push({ stepId: step.id, toolType: step.toolType, mcpOp: result.mcpOp, data: result.data, latency: result.latency });

    if (step.toolType === "proof.card") {
      proof = result.data;
    }
  }

  return {
    timeline,
    outputs,
    proof,
    stepLogs,
  };
}

module.exports = {
  executePlan,
};
