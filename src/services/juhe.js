"use strict";
/**
 * src/services/juhe.js
 * Juhe flight API + invoice OCR.
 * Reads JUHE_FLIGHT_KEY / JUHE_INVOICE_KEY from process.env at call time.
 *
 * Exports: CITY_IATA, queryJuheFlight, queryJuheFlightInvoice
 */

// City name → IATA code mapping for Juhe flight API
const CITY_IATA = {
  "\u5317\u4eac": "BJS", "\u4e0a\u6d77": "SHA", "\u5e7f\u5dde": "CAN", "\u6210\u90fd": "CTU",
  "\u6df1\u5733": "SZX", "\u897f\u5b89": "XIY", "\u676d\u5dde": "HGH", "\u6b66\u6c49": "WUH",
  "\u91cd\u5e86": "CKG", "\u53a6\u95e8": "XMN", "\u4e09\u4e9a": "SYX", "\u5357\u4eac": "NKG",
  "\u9752\u5c9b": "TAO", "\u957f\u6c99": "CSX", "\u5929\u6d25": "TSN", "\u662f\u660e": "KMG",
  "\u5c71\u4e1c": "TAO", "\u54c8\u5c14\u6ee8": "HRB", "\u6c88\u9633": "SHE", "\u5927\u8fde": "DLC",
  "\u4e3d\u6c5f": "LJG", "\u6842\u6797": "KWL", "\u62c9\u8428": "LXA", "\u5f20\u5bb6\u754c": "ZJJ",
  "\u654f\u714c": "DNH", "\u4e4c\u9c81\u6728\u9f50": "URC",
};

const FLIGHT_CACHE = new Map();
const FLIGHT_CACHE_TTL = 30 * 60 * 1000;

/**
 * Query Juhe flight API for routes between two cities.
 * Returns top flights sorted by price. Falls back to null on failure.
 * Cache: 30 min per route+date pair.
 */
async function queryJuheFlight(fromCity, toCity, dateStr) {
  const JUHE_FLIGHT_KEY = String(process.env.JUHE_FLIGHT_KEY || "").trim();
  if (!JUHE_FLIGHT_KEY) return null;
  const dep  = CITY_IATA[String(fromCity).replace(/\u5e02$/, "")] || fromCity;
  const arr  = CITY_IATA[String(toCity).replace(/\u5e02$/, "")]   || toCity;
  // Use tomorrow as default if no date provided
  const date = dateStr || (() => {
    const d = new Date(); d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
  })();
  const cacheKey = `${dep}-${arr}-${date}`;
  const cached   = FLIGHT_CACHE.get(cacheKey);
  if (cached && Date.now() - cached.ts < FLIGHT_CACHE_TTL) return cached.data;

  try {
    const url  = `https://apis.juhe.cn/flight/query?key=${JUHE_FLIGHT_KEY}&departure=${encodeURIComponent(dep)}&arrival=${encodeURIComponent(arr)}&departureDate=${date}`;
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.error_code !== 0 || !json.result) return null;
    const flights = (json.result.flightInfo || [])
      .map((f) => ({
        flightNo:      String(f.flightNo    || ""),
        airline:       String(f.airline     || f.airlineName || ""),
        depTime:       String(f.departureTime || ""),
        arrTime:       String(f.arrivalTime  || ""),
        duration:      String(f.duration     || ""),
        price:         Number(f.lowestPrice  || f.price || 0),
        stops:         Number(f.transferCount || 0),
      }))
      .filter((f) => f.flightNo)
      .sort((a, b) => (a.price || 9999) - (b.price || 9999));
    const result = { fromCity, toCity, date, flights: flights.slice(0, 10), source: "juhe" };
    FLIGHT_CACHE.set(cacheKey, { data: result, ts: Date.now() });
    console.log(`[juhe/flight] ${dep}→${arr} ${date}: ${flights.length} flights, lowest ¥${flights[0]?.price || "?"}`);
    return result;
  } catch (e) {
    console.warn(`[juhe/flight] Failed ${fromCity}→${toCity}:`, e.message);
    return null;
  }
}

/**
 * queryJuheFlightInvoice — OCR a flight itinerary photo/scan.
 * @param {string} base64Image  — base64-encoded image (JPEG/PNG)
 * @returns {object|null}  Parsed fields or null on failure.
 */
async function queryJuheFlightInvoice(base64Image) {
  const JUHE_INVOICE_KEY = String(process.env.JUHE_INVOICE_KEY || "").trim();
  if (!JUHE_INVOICE_KEY) return null;
  if (!base64Image) return null;
  try {
    const params = new URLSearchParams({ key: JUHE_INVOICE_KEY, ImageBase64: base64Image });
    const resp = await fetch("http://v.juhe.cn/flightinvoiceOcr/index", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: params.toString(),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return null;
    const json = await resp.json();
    if (json.error_code !== 0 || !json.result) {
      console.warn(`[juhe/invoice] OCR failed: code=${json.error_code} reason=${json.reason}`);
      return null;
    }
    const r = json.result;
    console.log("[juhe/invoice] OCR success:", JSON.stringify(r).slice(0, 200));
    return {
      name:        r.Name         || r.name         || "",
      idNo:        r.IdNo         || r.id_no        || "",
      flightNo:    r.FlightNo     || r.flight_no    || "",
      price:       r.Price        || r.price        || "",
      totalPrice:  r.TotalPrice   || r.total_price  || "",
      eTicketNo:   r.ETicketNo    || r.e_ticket_no  || "",
      issueDate:   r.IssueDate    || r.issue_date   || "",
      departure:   r.Departure    || r.departure    || "",
      destination: r.Destination  || r.destination  || "",
      raw:         r,
    };
  } catch (e) {
    console.warn("[juhe/invoice] OCR error:", e.message);
    return null;
  }
}

module.exports = { CITY_IATA, queryJuheFlight, queryJuheFlightInvoice };
