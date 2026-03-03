"use strict";
/**
 * src/services/geo.js
 * Geo utilities: coordinate conversion, reverse geocoding, city inference.
 * Reads GAODE_KEY / AMAP_KEY from process.env at call time.
 *
 * Exports: toNumberOrNull, haversineKm, inferCityFromCoordinates,
 *          inferCityNameFromCoordinates, wgs84ToGcj02, reverseGeocodeWithAmap,
 *          offsetCoords
 */

const https = require("https");

function toNumberOrNull(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return 6371 * c;
}

function inferCityFromCoordinates(lat, lng) {
  const points = [
    { city: "Shanghai",      cityZh: "上海市",  province: "Shanghai",   provinceZh: "上海市",   lat: 31.2304, lng: 121.4737 },
    { city: "Beijing",       cityZh: "北京市",  province: "Beijing",    provinceZh: "北京市",   lat: 39.9042, lng: 116.4074 },
    { city: "Shenzhen",      cityZh: "深圳市",  province: "Guangdong",  provinceZh: "广东省",   lat: 22.5431, lng: 114.0579 },
    { city: "Guangzhou",     cityZh: "广州市",  province: "Guangdong",  provinceZh: "广东省",   lat: 23.1291, lng: 113.2644 },
    { city: "Hangzhou",      cityZh: "杭州市",  province: "Zhejiang",   provinceZh: "浙江省",   lat: 30.2741, lng: 120.1551 },
    { city: "Chengdu",       cityZh: "成都市",  province: "Sichuan",    provinceZh: "四川省",   lat: 30.5728, lng: 104.0668 },
    { city: "Chongqing",     cityZh: "重庆市",  province: "Chongqing",  provinceZh: "重庆市",   lat: 29.5630, lng: 106.5516 },
    { city: "Nanjing",       cityZh: "南京市",  province: "Jiangsu",    provinceZh: "江苏省",   lat: 32.0603, lng: 118.7969 },
    { city: "Wuhan",         cityZh: "武汉市",  province: "Hubei",      provinceZh: "湖北省",   lat: 30.5928, lng: 114.3055 },
    { city: "Xian",          cityZh: "西安市",  province: "Shaanxi",    provinceZh: "陕西省",   lat: 34.3416, lng: 108.9398 },
    { city: "Xiamen",        cityZh: "厦门市",  province: "Fujian",     provinceZh: "福建省",   lat: 24.4798, lng: 118.0894 },
    { city: "Kuala Lumpur",  cityZh: "吉隆坡",  province: "Selangor",   provinceZh: "雪兰莪州", lat: 3.1390,  lng: 101.6869 },
    { city: "Singapore",     cityZh: "新加坡",  province: "Singapore",  provinceZh: "新加坡",   lat: 1.3521,  lng: 103.8198 },
  ];
  let best = points[0];
  let minDist = Infinity;
  for (const item of points) {
    const d = haversineKm(lat, lng, item.lat, item.lng);
    if (d < minDist) {
      best = item;
      minDist = d;
    }
  }
  if (minDist > 300) best = { city: "Shanghai", cityZh: "上海市", province: "Shanghai", provinceZh: "上海市", lat: 31.2304, lng: 121.4737 };
  return best;
}

function inferCityNameFromCoordinates(lat, lng) {
  return inferCityFromCoordinates(lat, lng).city;
}

/**
 * WGS-84 → GCJ-02 (火星坐标系) conversion.
 * Required because browser geolocation returns WGS-84,
 * but AMap/GaoDe uses GCJ-02. Apply only if coordinates are within China.
 */
function wgs84ToGcj02(lat, lng) {
  const PI = 3.1415926535897932384626;
  const a = 6378245.0;
  const ee = 0.00669342162296594323;

  function isInChinaBounds(lat, lng) {
    return lng >= 72.004 && lng <= 137.8347 && lat >= 0.8293 && lat <= 55.8271;
  }

  if (!isInChinaBounds(lat, lng)) return { lat, lng }; // Outside China: no transform

  function transformLat(x, y) {
    let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0;
    ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0;
    return ret;
  }

  function transformLng(x, y) {
    let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x));
    ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0;
    ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0;
    ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0;
    return ret;
  }

  let dLat = transformLat(lng - 105.0, lat - 35.0);
  let dLng = transformLng(lng - 105.0, lat - 35.0);
  const radLat = lat / 180.0 * PI;
  let magic = Math.sin(radLat);
  magic = 1 - ee * magic * magic;
  const sqrtMagic = Math.sqrt(magic);
  dLat = (dLat * 180.0) / ((a * (1 - ee)) / (magic * sqrtMagic) * PI);
  dLng = (dLng * 180.0) / (a / sqrtMagic * Math.cos(radLat) * PI);
  return { lat: lat + dLat, lng: lng + dLng };
}

/**
 * Reverse geocode using AMap (GaoDe) API.
 * Returns { city, cityZh, province, provinceZh, district, districtZh, address }
 * Falls back to inferCityFromCoordinates if API key is absent or call fails.
 */
async function reverseGeocodeWithAmap(rawLat, rawLng) {
  const amapKey = process.env.GAODE_KEY || process.env.AMAP_KEY || "";

  // Convert to GCJ-02 if we're in China bounds
  const { lat, lng } = wgs84ToGcj02(rawLat, rawLng);
  const coordStr = `${lng.toFixed(6)},${lat.toFixed(6)}`;

  if (!amapKey) {
    // No API key — fall back to lookup table
    console.warn("[ReverseGeocode] No GAODE_KEY/AMAP_KEY. Using fallback lookup table.");
    return inferCityFromCoordinates(rawLat, rawLng);
  }

  return new Promise((resolve) => {
    const url = `https://restapi.amap.com/v3/geocode/regeo?key=${amapKey}&location=${coordStr}&poitype=&radius=0&extensions=base&batch=false&roadlevel=0`;
    const urlObj = new URL(url);
    const reqOptions = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: "GET",
      headers: { "User-Agent": "CrossX/1.0" },
    };

    const req = https.request(reqOptions, (apiRes) => {
      let data = "";
      apiRes.on("data", (chunk) => (data += chunk));
      apiRes.on("end", () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.status !== "1" || !parsed.regeocode) {
            console.warn("[ReverseGeocode] AMap API error:", parsed.info || parsed.status);
            return resolve(inferCityFromCoordinates(rawLat, rawLng));
          }
          const comp = parsed.regeocode.addressComponent || {};
          // AMap returns Chinese names natively
          const cityZh = String(comp.city || comp.district || "").replace(/市$/, "") + "市" || "未知市";
          const provinceZh = String(comp.province || "").trim();
          const districtZh = String(comp.district || "").trim();
          const cityZhClean = String(comp.city || comp.district || "").trim() || cityZh;
          const provinceZhClean = provinceZh || cityZhClean; // Some cities like 北京 are their own province

          // Build English names via simple lookup
          const zhToEnCity = {
            "上海市": "Shanghai", "北京市": "Beijing", "深圳市": "Shenzhen",
            "广州市": "Guangzhou", "杭州市": "Hangzhou", "成都市": "Chengdu",
            "重庆市": "Chongqing", "南京市": "Nanjing", "武汉市": "Wuhan",
            "西安市": "Xi'an", "厦门市": "Xiamen", "天津市": "Tianjin",
            "苏州市": "Suzhou", "青岛市": "Qingdao", "长沙市": "Changsha",
            "郑州市": "Zhengzhou", "大连市": "Dalian", "宁波市": "Ningbo",
            "哈尔滨市": "Harbin", "昆明市": "Kunming", "福州市": "Fuzhou",
            "合肥市": "Hefei", "济南市": "Jinan", "石家庄市": "Shijiazhuang",
            "乌鲁木齐市": "Urumqi", "南宁市": "Nanning", "贵阳市": "Guiyang",
            "兰州市": "Lanzhou", "太原市": "Taiyuan", "三亚市": "Sanya",
          };
          const zhToEnProv = {
            "广东省": "Guangdong", "浙江省": "Zhejiang", "四川省": "Sichuan",
            "江苏省": "Jiangsu", "湖北省": "Hubei", "陕西省": "Shaanxi",
            "福建省": "Fujian", "山东省": "Shandong", "湖南省": "Hunan",
            "河南省": "Henan", "河北省": "Hebei", "辽宁省": "Liaoning",
            "云南省": "Yunnan", "贵州省": "Guizhou", "广西壮族自治区": "Guangxi",
            "内蒙古自治区": "Inner Mongolia", "新疆维吾尔自治区": "Xinjiang",
            "西藏自治区": "Tibet", "宁夏回族自治区": "Ningxia",
            "黑龙江省": "Heilongjiang", "吉林省": "Jilin", "辽宁省": "Liaoning",
            "安徽省": "Anhui", "江西省": "Jiangxi", "海南省": "Hainan",
            "山西省": "Shanxi", "甘肃省": "Gansu", "青海省": "Qinghai",
            "上海市": "Shanghai", "北京市": "Beijing", "天津市": "Tianjin",
            "重庆市": "Chongqing",
          };

          const city = zhToEnCity[cityZhClean] || cityZhClean.replace(/市$/, "");
          const province = zhToEnProv[provinceZhClean] || provinceZhClean.replace(/省$|自治区$|壮族自治区$|回族自治区$|维吾尔自治区$/, "");

          resolve({
            city,
            cityZh: cityZhClean,
            province,
            provinceZh: provinceZhClean,
            district: districtZh.replace(/区$|县$/, ""),
            districtZh,
            address: String(parsed.regeocode.formatted_address || ""),
          });
        } catch (e) {
          console.warn("[ReverseGeocode] Parse error:", e.message);
          resolve(inferCityFromCoordinates(rawLat, rawLng));
        }
      });
    });
    req.on("error", (e) => {
      console.warn("[ReverseGeocode] Request error:", e.message);
      resolve(inferCityFromCoordinates(rawLat, rawLng));
    });
    req.setTimeout(5000, () => {
      req.destroy();
      console.warn("[ReverseGeocode] Timeout — using fallback.");
      resolve(inferCityFromCoordinates(rawLat, rawLng));
    });
    req.end();
  });
}

function offsetCoords(lat, lng, northKm, eastKm) {
  const latDeg = northKm / 110.574;
  const lngDeg = eastKm / (111.320 * Math.cos((lat * Math.PI) / 180));
  return {
    lat: Number((lat + latDeg).toFixed(6)),
    lng: Number((lng + lngDeg).toFixed(6)),
  };
}

module.exports = {
  toNumberOrNull,
  haversineKm,
  inferCityFromCoordinates,
  inferCityNameFromCoordinates,
  wgs84ToGcj02,
  reverseGeocodeWithAmap,
  offsetCoords,
};