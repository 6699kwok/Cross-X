function makeLatency() {
  return Math.floor(150 + Math.random() * 500);
}

function sourceStamp(source) {
  const providerMap = {
    mock: "CrossX Mock Provider",
    gaode_or_fallback: "Gaode LBS",
    queue_partner: "Restaurant Queue Partner",
    partner_hub_queue: "Partner Hub Queue API",
    restaurant_partner: "Partner Restaurant Network",
    partner_hub_booking: "Partner Hub Booking API",
    act_gateway: "ACT Gateway",
    crossx_proof: "Cross X Core",
  };
  return {
    provider: providerMap[source] || "Cross X Core",
    source,
    sourceTs: new Date().toISOString(),
  };
}

function createFoodTools({ connectors, payments } = {}) {
  const gaode = connectors && connectors.gaode;
  const partnerHub = connectors && connectors.partnerHub;

  return {
    async queryMap(input) {
      const start = Date.now();
      let picks = [
        { name: "Local Noodle House", score: 92 },
        { name: "Old Alley Dumplings", score: 88 },
      ];

      if (gaode && gaode.enabled) {
        try {
          const live = await gaode.searchPoi({
            keywords: input.intent || "restaurant",
            cityName: input.city || "Shanghai",
          });
          if (live.pois && live.pois.length) {
            picks = live.pois.map((p, idx) => ({
              name: `${p.name}${p.address ? ` · ${p.address}` : ""}`,
              score: Math.max(70, 95 - idx * 4),
            }));
          }
        } catch {
          // fall back to mock picks
        }
      }

      const latency = Math.max(10, Date.now() - start) || makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "query",
        data: {
          query: input.intent,
          picks,
          ...sourceStamp(gaode && gaode.enabled ? "gaode_or_fallback" : "mock"),
        },
      };
    },
    async checkQueue(input) {
      if (partnerHub && partnerHub.enabled) {
        try {
          const live = await partnerHub.queueStatus({ city: input && input.city ? input.city : "Shanghai" });
          if (live && live.enabled) {
            return {
              ok: true,
              latency: Number(live.latency || makeLatency()),
              mcpOp: "status",
              data: {
                waitMin: Number(live.waitMin || 0),
                seatsLeft: Number(live.seatsLeft || 0),
                ...sourceStamp("partner_hub_queue"),
              },
            };
          }
        } catch {
          // fallback to local mock partner.
        }
      }

      const latency = makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "status",
        data: {
          waitMin: 18,
          seatsLeft: 2,
          ...sourceStamp("queue_partner"),
        },
      };
    },
    async lockBooking(input) {
      if (partnerHub && partnerHub.enabled) {
        try {
          const live = await partnerHub.lockRestaurant({ city: input && input.city ? input.city : "Shanghai" });
          if (live && live.enabled) {
            return {
              ok: true,
              latency: Number(live.latency || makeLatency()),
              mcpOp: "book",
              data: {
                lockId: live.lockId,
                expiresInSec: Number(live.expiresInSec || 600),
                ...sourceStamp("partner_hub_booking"),
              },
            };
          }
        } catch {
          // fallback to local mock partner.
        }
      }

      const latency = makeLatency();
      return {
        ok: true,
        latency,
        mcpOp: "book",
        data: {
          lockId: `BK-${Date.now().toString().slice(-6)}`,
          expiresInSec: 600,
          ...sourceStamp("restaurant_partner"),
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
          bilingualAddress: "CN: 静安区愚园路 88 号 / EN: 88 Yuyuan Rd, Jing'an",
          navLink: "https://maps.google.com",
          itinerary: liveTranslationOn
            ? "CN: 18:30 已预留座位，预计15分钟到达 / EN: 18:30 seat reserved, arrival in 15 min"
            : "18:30 Seat reserved, arrival in 15 min",
          ...sourceStamp("crossx_proof"),
        },
      };
    },
  };
}

module.exports = {
  createFoodTools,
};
