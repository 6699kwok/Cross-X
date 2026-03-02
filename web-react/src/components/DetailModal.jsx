import React, { useEffect } from "react";
import { getCityHeroUrl, FOOD_FALLBACK_URL } from "../utils/cityHero.js";
import { amapNavUrl, clamp } from "../utils/helpers.js";

/**
 * DetailModal — bottom-sheet detail view
 * Polymorphic: food_only → FoodDetail, else → TravelDetail
 *
 * Props:
 *   plan        — the selected plan object
 *   layoutType  — "food_only" | "travel_full" | "stay_focus"
 *   destination — city name for hero fallback
 *   onClose()
 */
export default function DetailModal({ plan, layoutType, destination, onClose }) {
  // Close on Escape key
  useEffect(() => {
    function onKey(e) { if (e.key === "Escape") onClose(); }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  if (!plan) return null;

  const isFoodOnly = layoutType === "food_only";

  return (
    <div
      className="cx-modal-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      role="dialog"
      aria-modal="true"
    >
      <div className="cx-modal">
        <button className="cx-modal-close" onClick={onClose} aria-label="关闭">✕</button>
        {isFoodOnly
          ? <FoodDetail plan={plan} destination={destination} onClose={onClose} />
          : <TravelDetail plan={plan} destination={destination} onClose={onClose} />
        }
      </div>
    </div>
  );
}

/* ============================
   Food Detail (zero hotel fields)
   ============================ */
function FoodDetail({ plan, destination, onClose }) {
  const heroUrl =
    plan.real_photo_url ||
    plan.food_image ||
    plan.item_image ||
    null;

  const name     = plan.name || plan.restaurant_name || "餐厅";
  const rating   = plan.rating;
  const avgPrice = plan.avg_price;
  const queueMin = Number(plan.queue_min);
  const address  = plan.address || plan.location;
  const review   = plan.review || plan.comment;
  const dishes   = Array.isArray(plan.dishes) ? plan.dishes.slice(0, 5) : [];
  const why      = plan.why || plan.reason || plan.headline;

  return (
    <>
      {heroUrl
        ? <img className="cx-modal-hero" src={heroUrl} alt={name} onError={(e) => { e.target.src = FOOD_FALLBACK_URL; }} />
        : <div className="cx-modal-hero-placeholder">🍜</div>
      }

      <div className="cx-modal-content">
        {plan.tag && (
          <div style={{ marginBottom: 6 }}>
            <span className="cx-plan-badge" style={{ position: "static", display: "inline-block" }}>{plan.tag}</span>
          </div>
        )}
        <h2 className="cx-modal-name">{name}</h2>

        <div className="cx-modal-meta-row">
          {rating   && <span className="cx-meta-badge cx-meta-badge--rating">★ {rating}</span>}
          {avgPrice && <span className="cx-meta-badge cx-meta-badge--price">人均¥{avgPrice}</span>}
          {queueMin > 0
            ? <span className="cx-meta-badge cx-meta-badge--queue">⏳ 等位约{queueMin}分钟</span>
            : queueMin === 0 && <span className="cx-meta-badge" style={{ color: "var(--success)", fontSize: 12 }}>✓ 无需排队</span>
          }
        </div>

        {(plan.cuisine_type || plan.flavor || plan.origin) && (
          <div className="cx-modal-food-tags">
            {plan.cuisine_type && <span className="cx-tag cx-tag--cuisine">🍴 {plan.cuisine_type}</span>}
            {plan.flavor       && <span className="cx-tag cx-tag--flavor">✦ {plan.flavor}</span>}
            {plan.origin       && <span className="cx-tag cx-tag--origin">📍 {plan.origin}</span>}
          </div>
        )}

        {address && (
          <div className="cx-addr-row">
            <div className="cx-addr-text">📍 {address}</div>
            <a
              className="cx-nav-btn"
              href={amapNavUrl(address)}
              target="_blank"
              rel="noopener noreferrer"
            >
              导航
            </a>
          </div>
        )}

        {review && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">真实评价</div>
            <blockquote className="cx-review-text">{review}</blockquote>
          </div>
        )}

        {dishes.length > 0 && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">招牌菜</div>
            <div className="cx-dishes-grid">
              {dishes.map((d, i) => (
                <span key={i} className="cx-dish-chip">
                  {typeof d === "string" ? d : d.name || String(d)}
                </span>
              ))}
            </div>
          </div>
        )}

        {why && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">为什么推荐</div>
            <p className="cx-why-text">{why}</p>
          </div>
        )}

        <div className="cx-modal-actions">
          <button className="cx-btn cx-btn--secondary" onClick={onClose}>返回</button>
          <button className="cx-btn cx-btn--primary">
            {address ? "立即导航" : "加入行程"}
          </button>
        </div>
      </div>
    </>
  );
}

/* ============================
   Travel Detail (hotel-centric)
   ============================ */
function TravelDetail({ plan, destination, onClose }) {
  const heroUrl =
    plan.hotel?.hero_image ||
    getCityHeroUrl(destination || plan.destination);

  const hotel = plan.hotel || {};
  const activities = Array.isArray(plan.activities) ? plan.activities : [];
  const meals = Array.isArray(plan.meals) ? plan.meals : [];
  const why = plan.why || plan.reason || plan.description;

  return (
    <>
      {heroUrl
        ? <img className="cx-modal-hero" src={heroUrl} alt={plan.name || "方案"} onError={(e) => { e.target.style.display = "none"; }} />
        : <div className="cx-modal-hero-placeholder">🗺️</div>
      }

      <div className="cx-modal-content">
        <h2 className="cx-modal-name">{plan.name || "行程方案"}</h2>
        {plan.headline && <p style={{ color: "var(--text-dim)", marginBottom: 16, fontSize: 14 }}>{plan.headline}</p>}

        {/* Hotel info */}
        {hotel.name && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">住宿</div>
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>
              {hotel.name}
              {hotel.stars && <span style={{ color: "var(--warning)", fontSize: 13, marginLeft: 6 }}>{"★".repeat(Math.min(5, Number(hotel.stars)))}</span>}
            </div>
            {hotel.price_per_night && (
              <div className="cx-hotel-price-row">
                <span className="cx-hotel-price">¥{hotel.price_per_night}</span>
                <span className="cx-hotel-price-unit">/晚</span>
              </div>
            )}
            {(hotel.check_in || hotel.check_out) && (
              <div className="cx-hotel-checkin">
                {hotel.check_in && `入住 ${hotel.check_in}`}
                {hotel.check_in && hotel.check_out && "  →  "}
                {hotel.check_out && `退房 ${hotel.check_out}`}
              </div>
            )}
          </div>
        )}

        {/* Activities */}
        {activities.length > 0 && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">行程安排</div>
            <div className="cx-activities">
              {activities.map((act, i) => {
                const imgSrc = act.image_url || act.real_photo_url ||
                  `https://picsum.photos/seed/${encodeURIComponent(act.name || i)}/120/80`;
                return (
                  <div key={i} className="cx-activity-row">
                    <img
                      className="cx-activity-img"
                      src={imgSrc}
                      alt={act.name || "景点"}
                      loading="lazy"
                      onError={(e) => { e.target.style.display = "none"; }}
                    />
                    <div className="cx-activity-info">
                      <div className="cx-activity-name">{act.name}</div>
                      <div className="cx-activity-meta">
                        {act.duration && `${act.duration}`}
                        {act.cost && ` · ¥${act.cost}`}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Meals */}
        {meals.length > 0 && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">餐饮安排</div>
            <div className="cx-activities">
              {meals.map((m, i) => (
                <div key={i} className="cx-activity-row">
                  <div className="cx-activity-img" style={{ background: "var(--surface-3)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🍽️</div>
                  <div className="cx-activity-info">
                    <div className="cx-activity-name">{m.name || "餐厅"}</div>
                    <div className="cx-activity-meta">
                      {m.time && `${m.time}`}
                      {m.cost && ` · ¥${m.cost}`}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Total cost */}
        {plan.total_cost && (
          <div style={{ padding: "12px 14px", background: "var(--surface)", borderRadius: "var(--radius)", marginBottom: 16 }}>
            <span style={{ color: "var(--text-dim)", fontSize: 13 }}>预估总费用 </span>
            <span style={{ fontWeight: 800, fontSize: 18, color: "var(--brand-light)" }}>¥{plan.total_cost}</span>
          </div>
        )}

        {why && (
          <div className="cx-modal-section">
            <div className="cx-modal-section-title">为什么推荐</div>
            <p className="cx-why-text">{why}</p>
          </div>
        )}

        <div className="cx-modal-actions">
          <button className="cx-btn cx-btn--secondary" onClick={onClose}>返回</button>
          <button className="cx-btn cx-btn--primary">选择此方案</button>
        </div>
      </div>
    </>
  );
}
