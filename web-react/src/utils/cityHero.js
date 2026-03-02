/**
 * GLOBAL_CITY_HERO_MAP — curated Unsplash landmark photos for 22+ cities
 * Priority: Coze hero_image > this map > fallback
 */
const GLOBAL_CITY_HERO_MAP = {
  北京:   "https://images.unsplash.com/photo-1508804185872-d7badad00f7d?w=800&q=80",
  上海:   "https://images.unsplash.com/photo-1538428494232-9c0d8a3ab403?w=800&q=80",
  深圳:   "https://images.unsplash.com/photo-1596464716127-f2a82984de30?w=800&q=80",
  广州:   "https://images.unsplash.com/photo-1533395427226-788cee21cc9e?w=800&q=80",
  成都:   "https://images.unsplash.com/photo-1591166004267-ccd477e82fcd?w=800&q=80",
  重庆:   "https://images.unsplash.com/photo-1587401012579-71e2db2be1de?w=800&q=80",
  杭州:   "https://images.unsplash.com/photo-1516738901171-8eb4fc13bd20?w=800&q=80",
  苏州:   "https://images.unsplash.com/photo-1527596428323-1d9dd3d5b52b?w=800&q=80",
  西安:   "https://images.unsplash.com/photo-1548080819-6f8d2843e08b?w=800&q=80",
  南京:   "https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=800&q=80",
  三亚:   "https://images.unsplash.com/photo-1559494007-9f5847c49d94?w=800&q=80",
  丽江:   "https://images.unsplash.com/photo-1512236258305-32fb110fdb01?w=800&q=80",
  大理:   "https://images.unsplash.com/photo-1544735716-392fe2489ffa?w=800&q=80",
  桂林:   "https://images.unsplash.com/photo-1537531173545-d0ea26c50fe0?w=800&q=80",
  张家界: "https://images.unsplash.com/photo-1551276744-b6a4f1c8b1e3?w=800&q=80",
  黄山:   "https://images.unsplash.com/photo-1513569536301-a04d61e40c00?w=800&q=80",
  青岛:   "https://images.unsplash.com/photo-1558706776-43c36f9040ce?w=800&q=80",
  厦门:   "https://images.unsplash.com/photo-1558724601-2c82e19c07c9?w=800&q=80",
  拉萨:   "https://images.unsplash.com/photo-1527245521717-41e1f6d5c4fb?w=800&q=80",
  哈尔滨: "https://images.unsplash.com/photo-1547036967-23d11aacaee0?w=800&q=80",
  武汉:   "https://images.unsplash.com/photo-1556565685-316fa0d76e0a?w=800&q=80",
  长沙:   "https://images.unsplash.com/photo-1559565029-6b6e32b8a74c?w=800&q=80",
  昆明:   "https://images.unsplash.com/photo-1552465011-b4e21bf6e79a?w=800&q=80",
  东京:   "https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=800&q=80",
  大阪:   "https://images.unsplash.com/photo-1589952283406-b53a7d1347e8?w=800&q=80",
  首尔:   "https://images.unsplash.com/photo-1548115184-bc6544d06a58?w=800&q=80",
  曼谷:   "https://images.unsplash.com/photo-1563492065599-3520f775eeed?w=800&q=80",
  新加坡: "https://images.unsplash.com/photo-1565967511849-76a60a516170?w=800&q=80",
  巴黎:   "https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=800&q=80",
  伦敦:   "https://images.unsplash.com/photo-1513635269975-59663e0ac1ad?w=800&q=80",
};

const FOOD_FALLBACK_URL =
  "https://images.unsplash.com/photo-1504674900247-0877df9cc836?w=800&q=80";

const CITY_HERO_FALLBACK =
  "https://images.unsplash.com/photo-1480714378408-67cf0d13bc1b?w=800&q=80";

/**
 * Get city hero URL — matches partial city name
 */
export function getCityHeroUrl(cityName) {
  if (!cityName) return CITY_HERO_FALLBACK;
  for (const [key, url] of Object.entries(GLOBAL_CITY_HERO_MAP)) {
    if (cityName.includes(key) || key.includes(cityName)) return url;
  }
  return CITY_HERO_FALLBACK;
}

export { FOOD_FALLBACK_URL, CITY_HERO_FALLBACK };
