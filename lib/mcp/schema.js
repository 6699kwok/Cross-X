const MCP_OP_MAP = {
  "map.query": "Query",
  "queue.status": "Status",
  "book.lock": "Book",
  "pay.act": "Pay",
  "proof.card": "Status",
  "route.plan": "Query",
  "traffic.live": "Status",
  "transport.lock": "Book",
  "order.cancel": "Cancel",
};

const MCP_SLA_MS = {
  Query: 2000,
  Status: 1500,
  Book: 2500,
  Pay: 3000,
  Cancel: 2500,
};

function getMcpSchema(toolType) {
  return MCP_OP_MAP[toolType] || "Status";
}

function getSlaMs(op) {
  return MCP_SLA_MS[op] || 2000;
}

function shapeMcpCall({ toolType, input, result, elapsedMs }) {
  const op = getMcpSchema(toolType);
  const slaMs = getSlaMs(op);
  const safeResult = result && typeof result === "object" ? result : {};
  const rawData = safeResult.data && typeof safeResult.data === "object" ? safeResult.data : {};
  const latency = Number(elapsedMs || safeResult.latency || 0);
  const provider = safeResult.provider || rawData.provider || "mock_provider";
  const source = safeResult.source || rawData.source || "mock";
  const sourceTs = rawData.sourceTs || safeResult.sourceTs || new Date().toISOString();
  return {
    op,
    toolType,
    request: {
      op,
      payload: input && typeof input === "object" ? input : {},
      at: new Date().toISOString(),
    },
    response: {
      op,
      ok: safeResult.ok === true,
      status: safeResult.ok === true ? "success" : "failed",
      code: safeResult.ok === true ? "ok" : safeResult.errorCode || "tool_error",
      latency,
      slaMs,
      slaMet: latency <= slaMs,
      data: {
        ...rawData,
        provider,
        source,
        sourceTs,
      },
    },
  };
}

function validateMcpResult(call) {
  const response = call && call.response ? call.response : {};
  if (typeof response.ok !== "boolean") return false;
  if (typeof response.status !== "string") return false;
  if (typeof response.code !== "string") return false;
  if (typeof response.latency !== "number") return false;
  if (typeof response.slaMs !== "number") return false;
  if (typeof response.slaMet !== "boolean") return false;
  if (!response.data || typeof response.data !== "object") return false;
  if (typeof response.data.provider !== "string") return false;
  if (typeof response.data.source !== "string") return false;
  if (typeof response.data.sourceTs !== "string") return false;

  if (call.op === "Pay") {
    if (response.ok) {
      return (
        typeof response.data.amount === "number" &&
        typeof response.data.currency === "string" &&
        typeof response.data.paymentRef === "string" &&
        response.data.paymentRef.length > 0
      );
    }
    return typeof response.data.amount === "number" && typeof response.data.currency === "string";
  }

  if (call.op === "Book") {
    return Boolean(response.data.lockId || response.data.ticketRef) && typeof response.data.provider === "string";
  }

  return true;
}

module.exports = {
  getMcpSchema,
  shapeMcpCall,
  validateMcpResult,
};
