import React from "react";
import { openPoi, isMobile } from "../utils/helpers.js";

/**
 * ItineraryCard — renders a single itinerary plan using DataShaper-shaped fields.
 *
 * Works directly with the lean JSON that backend now returns:
 *   hotel:        { name, tier, price, rating, photo, external_id }
 *   route:        { mode, no, dep, arr, price, stops, amap_route_id }
 *   days[]:       [ { day, label, activities[], meals[] } ]
 *   activities[]: { name, price, hours, photo, external_id }
 *   meals[]:      { name, time, cost, image_url }
 *
 * Props:
 *   plan         — the selected plan object from card_data.plans[]
 *   days         — card_data.days[] (shared across all plan tiers)
 *   destination  — string, used for map deep-links
 *   onClose      — () => void
 */
export default function ItineraryCard({ plan = {}, days = [], destination = "", onClose }) {
  const hotel  = plan.hotel  || {};
  const route  = plan.route  || null;

  return (
    <div className="cx-itinerary">

      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="cx-itinerary-header">
        <div>
          <div className="cx-itinerary-title">{plan.tag || plan.name || "行程方案"}</div>
          {plan.total_price && (
            <div className="cx-itinerary-total">
              预估总费用 <span>¥{plan.total_price}</span>
            </div>
          )}
        </div>
        {onClose && (
          <button className="cx-modal-close" onClick={onClose} aria-label="关闭">✕</button>
        )}
      </div>

      {/* ── Hotel ──────────────────────────────────────────────── */}
      {hotel.name && (
        <Section title="住宿">
          <HotelCard hotel={hotel} />
        </Section>
      )}

      {/* ── Route ──────────────────────────────────────────────── */}
      {route && (
        <Section title="交通">
          <RouteTimeline route={route} destination={destination} />
        </Section>
      )}

      {/* ── Day-by-day ─────────────────────────────────────────── */}
      {days.map((day) => (
        <Section
          key={day.day}
          title={`第 ${day.day} 天${day.label ? "  " + day.label : ""}`}
        >
          <DaySchedule activities={day.activities || []} meals={day.meals || []} />
        </Section>
      ))}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }) {
  return (
    <div className="cx-itinerary-section">
      <div className="cx-modal-section-title">{title}</div>
      {children}
    </div>
  );
}

/**
 * HotelCard — renders shaped hotel fields.
 * Fields: name, tier, price, rating, photo, external_id, location
 * Click → openPoi() → mobile app deep-link or desktop map focus
 */
function HotelCard({ hotel }) {
  const tierLabel = { budget: "经济", balanced: "均衡", premium: "豪华" };

  function handleClick() {
    openPoi({
      name:     hotel.name,
      amap_id:  hotel.external_id,
      location: hotel.location,
    });
  }

  return (
    <div
      className="cx-hotel-card cx-poi-clickable"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
      title={isMobile() ? "点击在高德地图中查看" : "点击在地图中定位"}
    >
      {hotel.photo && (
        <img
          className="cx-hotel-photo"
          src={hotel.photo}
          alt={hotel.name}
          loading="lazy"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      )}
      <div className="cx-hotel-info">
        <div className="cx-hotel-name">
          {hotel.name}
          <span className="cx-poi-pin" aria-hidden="true">📍</span>
        </div>
        <div className="cx-hotel-meta">
          {hotel.tier && (
            <span className="cx-tag cx-tag--tier">{tierLabel[hotel.tier] || hotel.tier}</span>
          )}
          {hotel.rating && (
            <span className="cx-meta-badge cx-meta-badge--rating">★ {hotel.rating}</span>
          )}
          {hotel.price && (
            <span className="cx-hotel-price">¥{hotel.price}<span className="cx-hotel-price-unit">/晚</span></span>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * RouteTimeline — renders shaped route fields.
 * Fields: mode, no, dep, arr, price, stops, amap_route_id
 *
 * "导航" button:
 *   Mobile  → universal navigation URI (wakes Amap APP or opens web)
 *   Desktop → dispatches FOCUS_POI for MapProvider to pan to destination
 */
function RouteTimeline({ route, destination }) {
  const modeIcon = { flight: "✈️", hsr: "🚄", train: "🚆", bus: "🚌", drive: "🚗" };
  const icon = modeIcon[route.mode] || "🗺️";

  function handleNav(e) {
    e.preventDefault();
    if (isMobile()) {
      // Universal navigation deep link (callnative=1 wakes Amap APP if installed)
      const url = route.amap_route_id
        ? `https://uri.amap.com/navigation?to=${encodeURIComponent(destination)}&routeid=${route.amap_route_id}&callnative=1`
        : `https://uri.amap.com/navigation?to=${encodeURIComponent(destination)}&callnative=1`;
      window.open(url, "_blank", "noopener,noreferrer");
    } else {
      // Desktop: focus destination on the embedded map
      openPoi({ name: destination, amap_id: null, location: null });
    }
  }

  return (
    <div className="cx-route-row">
      <span className="cx-route-icon">{icon}</span>
      <div className="cx-route-info">
        <div className="cx-route-main">
          {route.no  && <span className="cx-route-no">{route.no}</span>}
          {route.dep && <span className="cx-route-time">{route.dep}</span>}
          {route.dep && route.arr && <span className="cx-route-arrow"> → </span>}
          {route.arr && <span className="cx-route-time">{route.arr}</span>}
        </div>
        <div className="cx-route-sub">
          {route.price  && <span>¥{route.price}</span>}
          {route.stops > 0 && <span>  {route.stops} 次经停</span>}
        </div>
      </div>
      {destination && (
        <button className="cx-nav-btn" onClick={handleNav} type="button">
          导航
        </button>
      )}
    </div>
  );
}

/**
 * DaySchedule — renders activities and meals for one day.
 * Uses DataShaper fields: name, price, hours, photo, external_id
 */
function DaySchedule({ activities, meals }) {
  const allItems = [
    ...activities.map((a) => ({ ...a, _kind: "activity" })),
    ...meals.map((m)      => ({ ...m, _kind: "meal" })),
  ];

  if (!allItems.length) return <div style={{ color: "var(--text-dim)", fontSize: 13 }}>暂无安排</div>;

  return (
    <div className="cx-activities">
      {activities.map((act, i) => (
        <ActivityRow key={i} item={act} />
      ))}
      {meals.map((meal, i) => (
        <MealRow key={i} item={meal} />
      ))}
    </div>
  );
}

function ActivityRow({ item }) {
  const photo = item.photo || item.image_url || item.real_photo_url;

  function handleClick() {
    openPoi({
      name:     item.name,
      amap_id:  item.external_id,
      location: item.location,
    });
  }

  return (
    <div
      className="cx-activity-row cx-poi-clickable"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
    >
      {photo ? (
        <img
          className="cx-activity-img"
          src={photo}
          alt={item.name}
          loading="lazy"
          onError={(e) => { e.target.style.display = "none"; }}
        />
      ) : (
        <div className="cx-activity-img" style={{ background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
          🏛️
        </div>
      )}
      <div className="cx-activity-info">
        <div className="cx-activity-name">
          {item.name}
          {item.external_id && <span className="cx-poi-pin" aria-hidden="true">📍</span>}
        </div>
        <div className="cx-activity-meta">
          {item.hours && <span>{item.hours}</span>}
          {item.price != null && <span>  ¥{item.price}</span>}
        </div>
      </div>
    </div>
  );
}

function MealRow({ item }) {
  function handleClick() {
    openPoi({
      name:     item.name || item.restaurant,
      amap_id:  item.external_id,
      location: item.location,
      address:  item.address,
    });
  }

  return (
    <div
      className="cx-activity-row cx-poi-clickable"
      onClick={handleClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && handleClick()}
    >
      <div className="cx-activity-img" style={{ background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18 }}>
        🍽️
      </div>
      <div className="cx-activity-info">
        <div className="cx-activity-name">
          {item.name || item.restaurant || "餐厅"}
          {item.external_id && <span className="cx-poi-pin" aria-hidden="true">📍</span>}
        </div>
        <div className="cx-activity-meta">
          {item.time && <span>{item.time}</span>}
          {item.cost && <span>  ¥{item.cost}</span>}
        </div>
      </div>
    </div>
  );
}
