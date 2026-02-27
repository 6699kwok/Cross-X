const BASE = "https://restapi.amap.com/v3";

function withTimeout(promise, ms = 4500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  return Promise.race([
    promise(ctrl.signal).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms + 10)),
  ]);
}

async function fetchJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) {
    throw new Error(`http_${res.status}`);
  }
  return res.json();
}

function createGaodeConnector({ key, city = "Shanghai" }) {
  const enabled = Boolean(key);

  return {
    enabled,

    async searchPoi({ keywords, cityName }) {
      if (!enabled) return { enabled: false, pois: [] };
      const q = encodeURIComponent(keywords || "restaurant");
      const c = encodeURIComponent(cityName || city);
      const url = `${BASE}/place/text?key=${encodeURIComponent(key)}&keywords=${q}&city=${c}&offset=5&page=1&extensions=base`;
      const data = await withTimeout((signal) => fetchJson(url, signal));
      const pois = (data.pois || []).map((p) => ({
        name: p.name,
        address: p.address,
        location: p.location,
        type: p.type,
      }));
      return { enabled: true, pois };
    },

    async routePlan({ origin, destination }) {
      if (!enabled) return { enabled: false, route: null };
      if (!origin || !destination) return { enabled: true, route: null };
      const url = `${BASE}/direction/driving?key=${encodeURIComponent(key)}&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&strategy=0`;
      const data = await withTimeout((signal) => fetchJson(url, signal));
      const firstPath = data?.route?.paths?.[0];
      if (!firstPath) return { enabled: true, route: null };
      return {
        enabled: true,
        route: {
          distanceM: Number(firstPath.distance || 0),
          durationSec: Number(firstPath.duration || 0),
          tolls: Number(firstPath.tolls || 0),
          trafficLights: Number(firstPath.traffic_lights || 0),
        },
      };
    },
  };
}

module.exports = {
  createGaodeConnector,
};
