function makeLatency() {
  return Math.floor(150 + Math.random() * 500);
}

function sourceStamp(source) {
  const providerMap = {
    mock: "CrossX Mock Provider",
    gaode_or_fallback: "Gaode LBS",
    mobility_partner: "Partner Mobility Network",
    partner_hub_traffic: "Partner Hub Traffic API",
    partner_hub_transport: "Partner Hub Transport API",
    act_gateway: "ACT Gateway",
    crossx_proof: "Cross X Core",
  };
  return {
    provider: providerMap[source] || "Cross X Core",
    source,
    sourceTs: new Date().toISOString(),
  };
}

function createTravelTools({ connectors, payments } = {}) {
  const gaode = connectors && connectors.gaode;
  const partnerHub = connectors && connectors.partnerHub;

  return {
    async planRoute(input) {
      const start = Date.now();
      let route = "City center -> Landmark -> Airport";
      let etaMin = 80;

      if (gaode && gaode.enabled) {
        try {
          const live = await gaode.routePlan({
            origin: input.origin || "121.4737,31.2304",
            destination: input.destination || "121.8083,31.1512",
          });
          if (live.route) {
            etaMin = Math.max(1, Math.round(live.route.durationSec / 60));
            route = `Live route (${Math.round(live.route.distanceM / 1000)} km)`;
          }
        } catch {
          // use mock route
        }
      }

      const latency = Math.max(10, Date.now() - start) || makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "query",
        data: {
          route,
          etaMin,
          ...sourceStamp(gaode && gaode.enabled ? "gaode_or_fallback" : "mock"),
        },
      };
    },
    async checkTraffic(input) {
      if (partnerHub && partnerHub.enabled) {
        try {
          const live = await partnerHub.trafficStatus({
            origin: input && input.origin ? input.origin : "",
            destination: input && input.destination ? input.destination : "",
          });
          if (live && live.enabled) {
            return {
              ok: true,
              latency: Number(live.latency || makeLatency()),
              mcpOp: "status",
              data: {
                congestionLevel: live.congestionLevel || "medium",
                risk: live.risk || "low",
                ...sourceStamp("partner_hub_traffic"),
              },
            };
          }
        } catch {
          // fallback to existing source.
        }
      }

      const start = Date.now();
      let congestionLevel = "medium";
      let risk = "low";

      if (gaode && gaode.enabled) {
        try {
          const live = await gaode.routePlan({
            origin: input.origin || "121.4737,31.2304",
            destination: input.destination || "121.8083,31.1512",
          });
          if (live.route) {
            const lights = live.route.trafficLights || 0;
            congestionLevel = lights > 35 ? "high" : lights > 15 ? "medium" : "low";
            risk = congestionLevel === "high" ? "medium" : "low";
          }
        } catch {
          // use mock status
        }
      }

      const latency = Math.max(10, Date.now() - start) || makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "status",
        data: {
          congestionLevel,
          risk,
          ...sourceStamp(gaode && gaode.enabled ? "gaode_or_fallback" : "mock"),
        },
      };
    },
    async lockTransport(input) {
      if (partnerHub && partnerHub.enabled) {
        try {
          const live = await partnerHub.lockTransport({ city: input && input.city ? input.city : "Shanghai" });
          if (live && live.enabled) {
            return {
              ok: true,
              latency: Number(live.latency || makeLatency()),
              mcpOp: "book",
              data: {
                ticketRef: live.ticketRef,
                provider: "Partner Hub Transport API",
                ...sourceStamp("partner_hub_transport"),
              },
            };
          }
        } catch {
          // fallback to existing source.
        }
      }

      const latency = makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "book",
        data: {
          ticketRef: `TR-${Date.now().toString().slice(-6)}`,
          provider: "Partner Mobility Network",
          ...sourceStamp("mobility_partner"),
        },
      };
    },
    async payAct(input) {
      if (payments && typeof payments.charge === "function") {
        const charged = await payments.charge({
          railId: input.railId,
          amount: input.amount,
          currency: input.currency,
          userId: input.userId,
          taskId: input.taskId,
        });
        return {
          ok: charged.ok,
          errorCode: charged.errorCode,
          latency: charged.latency,
          provider: charged.provider,
          source: charged.source,
          sourceTs: charged.sourceTs,
          mcpOp: "pay",
          data: charged.data,
        };
      }

      const latency = makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "pay",
        data: {
          amount: input.amount,
          currency: input.currency,
          paymentRef: `PAY-${Date.now().toString().slice(-6)}`,
          railId: "alipay_cn",
          railLabel: "Alipay CN",
          ...sourceStamp("act_gateway"),
        },
      };
    },
    async makeProof(input) {
      const latency = makeLatency();
      const liveTranslationOn =
        Boolean(input && input.constraints && input.constraints.flags && input.constraints.flags.liveTranslation && input.constraints.flags.liveTranslation.active);
      return {
        ok: true,
        latency,
        mcpOp: "deliverable",
        data: {
          bilingualAddress: "CN: 浦东机场 T2 出发层 / EN: PVG Airport T2 Departures",
          navLink: "https://maps.google.com",
          itinerary: liveTranslationOn
            ? "CN: 17:10 上车，18:20 到达机场 / EN: 17:10 pickup, 18:20 airport arrival"
            : "17:10 Pickup, 18:20 airport arrival",
          ...sourceStamp("crossx_proof"),
        },
      };
    },
  };
}

module.exports = {
  createTravelTools,
};
