import React from "react";
import { getCityHeroUrl, FOOD_FALLBACK_URL } from "../utils/cityHero.js";
import { clamp } from "../utils/helpers.js";

/**
 * PlanOptionsCard — horizontal-scrolling 3-plan comparison
 *
 * Card layout (food_only):
 *   ┌──────────────────────────┐
 *   │  City landmark photo     │  ← getCityHeroUrl(destination)
 *   │  (destination city hero) │
 *   ├──────────────────────────┤
 *   │  🍜 聚鑫楼（LARGE）       │
 *   │  ★4.8  人均¥200  ⏳20分   │
 *   │  [real restaurant photo] │  ← small inset photo from real_photo_url
 *   │  🍴陕西菜  ✦咸鲜  📍回民街 │
 *   └──────────────────────────┘
 *
 * Card layout (travel_full):
 *   ┌──────────────────────────┐
 *   │  City landmark photo     │
 *   ├──────────────────────────┤
 *   │  方案名称（LARGE）         │
 *   │  🏨 酒店名  ★★★★★        │
 *   │  ¥xxx/晚                  │
 *   └──────────────────────────┘
 */
export default function PlanOptionsCard({ plans = [], layoutType, destination, city, spokenText, onSelect }) {
  const isFoodOnly = layoutType === "food_only";
  // City hero: destination city first, fallback to user's current city
  const cityHero = getCityHeroUrl(destination || city);

  return (
    <div className="cx-plans-wrapper">
      {spokenText && (
        <div className="cx-msg cx-msg--agent" style={{ marginBottom: 10 }}>
          <div className="cx-msg-avatar" aria-hidden="true">✦</div>
          <div className="cx-msg-bubble">{spokenText}</div>
        </div>
      )}
      <div className="cx-plans-label">
        {isFoodOnly ? "精选餐厅方案" : "行程方案对比"} — 点击查看详情
      </div>
      <div className="cx-plans-scroll" role="list">
        {plans.map((plan, i) => (
          isFoodOnly
            ? <FoodPlanCard key={i} plan={plan} index={i} cityHero={cityHero} onSelect={onSelect} />
            : <TravelPlanCard key={i} plan={plan} index={i} cityHero={cityHero} onSelect={onSelect} />
        ))}
      </div>
    </div>
  );
}

function FoodPlanCard({ plan, index, cityHero, onSelect }) {
  // Real restaurant photo (small, shown inside body)
  const restPhoto = plan.real_photo_url || plan.food_image || plan.item_image || null;

  const rating   = plan.rating   ? `★ ${plan.rating}` : null;
  const avgPrice = plan.avg_price ? `人均¥${plan.avg_price}` : null;
  const queueMin = plan.queue_min ? `⏳ 等位${plan.queue_min}分钟` : null;

  const isRecommended = !!plan.is_recommended;

  return (
    <div
      className={`cx-plan-card${isRecommended ? " cx-plan-card--recommended" : ""}`}
      role="listitem"
      onClick={() => onSelect(plan, index)}
    >
      {/* TOP: City landmark hero (always) */}
      <div className="cx-plan-city-hero-wrap">
        <img
          className="cx-plan-city-hero"
          src={cityHero}
          alt="城市风景"
          loading="lazy"
          onError={(e) => { e.target.style.display = "none"; }}
        />
        {isRecommended && <span className="cx-plan-badge">推荐</span>}
      </div>

      <div className="cx-plan-body">
        {/* Restaurant name — LARGE */}
        <div className="cx-plan-rest-name">{plan.name || plan.restaurant_name || "餐厅"}</div>
        {plan.headline && <div className="cx-plan-headline">{clamp(plan.headline, 42)}</div>}

        {/* Meta row */}
        <div className="cx-plan-food-meta">
          {rating   && <span className="cx-plan-rating">{rating}</span>}
          {avgPrice && <span className="cx-plan-avgprice">{avgPrice}</span>}
          {queueMin && <span className="cx-plan-queue">{queueMin}</span>}
        </div>

        {/* Real restaurant photo — inset */}
        {restPhoto && (
          <img
            className="cx-plan-rest-photo"
            src={restPhoto}
            alt={plan.name || "餐厅照片"}
            loading="lazy"
            onError={(e) => { e.target.src = FOOD_FALLBACK_URL; }}
          />
        )}

        {/* Cuisine tags */}
        {(plan.cuisine_type || plan.flavor || plan.origin) && (
          <div className="cx-food-tags">
            {plan.cuisine_type && <span className="cx-tag cx-tag--cuisine">🍴 {plan.cuisine_type}</span>}
            {plan.flavor       && <span className="cx-tag cx-tag--flavor">✦ {plan.flavor}</span>}
            {plan.origin       && <span className="cx-tag cx-tag--origin">📍 {plan.origin}</span>}
          </div>
        )}
      </div>
    </div>
  );
}

function TravelPlanCard({ plan, index, cityHero, onSelect }) {
  const hotelName = plan.hotel?.name;
  const stars     = plan.hotel?.stars ? "★".repeat(Math.min(5, Number(plan.hotel.stars))) : null;
  const price     = plan.hotel?.price_per_night
    ? `¥${plan.hotel.price_per_night}/晚`
    : plan.total_cost
      ? `总价¥${plan.total_cost}`
      : null;
  const isRecommended = !!plan.is_recommended;

  return (
    <div
      className={`cx-plan-card${isRecommended ? " cx-plan-card--recommended" : ""}`}
      role="listitem"
      onClick={() => onSelect(plan, index)}
    >
      <div className="cx-plan-city-hero-wrap">
        <img
          className="cx-plan-city-hero"
          src={cityHero}
          alt="城市风景"
          loading="lazy"
          onError={(e) => { e.target.style.display = "none"; }}
        />
        {isRecommended && <span className="cx-plan-badge">推荐</span>}
      </div>

      <div className="cx-plan-body">
        <div className="cx-plan-rest-name">{clamp(plan.name, 22)}</div>
        {plan.headline && <div className="cx-plan-headline">{clamp(plan.headline, 42)}</div>}
        {hotelName && (
          <div className="cx-plan-hotel">
            🏨 <span>{clamp(hotelName, 18)}</span>
            {stars && <span style={{ color: "var(--warning)", fontSize: 11, marginLeft: 4 }}>{stars}</span>}
          </div>
        )}
        {price && <div className="cx-plan-price">{price}</div>}
        {plan.hotel?.price_per_night && <div className="cx-plan-price-sub">含早餐 · 可取消</div>}
      </div>
    </div>
  );
}
