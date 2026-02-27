"use strict";

/**
 * CrossX built-in China travel knowledge base.
 * Injected into LLM system prompts as background context.
 * Real prices, real platform names, real transport times.
 * Data current as of 2025.
 */

const CHINA_TRAVEL_KNOWLEDGE = `
=== CHINA TRAVEL KNOWLEDGE BASE FOR FOREIGN VISITORS ===
Real prices, real platform names, real transport times. Data current as of 2025.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 1: AIRPORT-TO-CITY TRANSPORT (8 Major Cities)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- SHENZHEN (深圳) ---
Airport: 深圳宝安国际机场 (SZX), Terminal T3
- Metro Line 11 (Airport Express): 13.5元, ~50min to Futian Station. Most cost-effective option.
- Airport Express Bus Line 2: 25元, ~50min to Futian CBD. Stops at major hotels.
- Airport Express Bus Line 3: 30元, ~60min to Luohu border crossing. Good for HK connections.
- Didi Express: 80-130元, 40-60min depending on traffic to Futian/Luohu/Nanshan.
- Taxi: 100-150元 to downtown Futian; metered, no surcharge for airport pickup.
- Tip: Line 11 runs 6:06-23:00. Buy metro ticket via Alipay QR or ticket machine.

--- SHANGHAI (上海) ---
Airport: 浦东国际机场 (PVG) — main international hub
- Maglev (磁浮列车): 50元 standard / 40元 with plane ticket, 7min to Longyang Road, then Metro Line 2 to city (20-30min more). Total ~50min, total cost ~65元. Fastest but requires metro transfer.
- Metro Line 2 direct: 8元, ~70min to People's Square. Cheapest but slow.
- Airport shuttle bus: 24-30元, multiple lines, 60-90min depending on traffic. Lines: 1 (Hongqiao), 2 (Jing'an), 5 (Renmin Square).
- Taxi: 150-200元 to city center (Jing'an/Huangpu/Pudong CBD), ~45-70min.
- Didi Express: 130-180元, same time as taxi but no language barrier.

Airport: 虹桥国际机场 (SHA) — domestic + regional international
- Metro Line 2 or Line 10: 6元, ~25min to city center. Very convenient.
- Taxi: 80-120元 to Jing'an/Huangpu/Xuhui districts.
- Didi Express: 70-110元.
- Tip: SHA is inside the city; PVG is 45km away. Know which airport your flight uses.

--- BEIJING (北京) ---
Airport: 首都国际机场 (PEK) — Terminal T3 for most international flights
- Airport Express Train (机场快轨): 25元, ~20min to Dongzhimen, connects to Metro Line 2/13. Then subway to destination 3-6元 more. Total ~45min door-to-door in city.
- Taxi: 100-140元 to central Beijing (Chaoyang/Dongcheng), ~40-60min off-peak, 60-90min rush hour.
- Didi Express: 90-130元.
- Airport bus lines: Multiple routes 16-24元, 50-90min depending on route.

Airport: 大兴国际机场 (PKX) — newer airport, South Beijing
- Metro (大兴机场线): 35元, ~40min to Caoqiao, connect to Line 10 for central Beijing. Total 55-70min.
- Didi Express: 150-200元 to central Beijing (further away than PEK).
- Taxi: 160-220元.
- Tip: PKX serves mostly domestic and some international. Check which airport your flight uses.

--- GUANGZHOU (广州) ---
Airport: 广州白云国际机场 (CAN), Terminal T1 & T2
- Metro Line 3 North Extension: 8元, ~40min to Tiyuxi Station (city center). Runs 6:00-23:00.
- Airport shuttle bus: 16-25元, multiple city routes, 50-90min.
- Taxi: 100-140元 to Tianhe/Yuexiu districts.
- Didi Express: 90-130元.
- Tip: Metro is clearly signed in English. Line 3 goes directly into the main shopping/hotel district.

--- CHENGDU (成都) ---
Airport: 天府国际机场 (TFU) — new main international airport, East of city
- Metro Line 18: 21元, ~40min to Jinkeng (city area). Transfer at Tianfu → Line 1 to city center ~60min total.
- Airport shuttle bus: 30元, ~60min to city center.
- Didi Express: 80-120元, ~40-60min.
- Taxi: 100-150元.

Airport: 双流国际机场 (CTU) — older airport, closer to city
- Metro Line 10: 8元, ~30min to Chunxi Road/Tianfu Square area.
- Didi Express: 60-100元.
- Taxi: 70-120元.
- Tip: CTU is still used for many domestic and some international. TFU handles growing international traffic.

--- HANGZHOU (杭州) ---
Airport: 萧山国际机场 (HGH)
- Airport shuttle bus: 20元, ~40min to city center (Wulin Square/武林广场 terminus). Multiple city routes.
- Didi Express: 60-90元.
- Taxi: 80-120元.
- Metro Line 1 (extension): ~15元, 45min. Check current operational status.
- Tip: Hangzhou is compact; most hotels are 30-40min from airport by car.

--- XI'AN (西安) ---
Airport: 咸阳国际机场 (XIY)
- Airport shuttle bus (机场大巴): 30元, ~60min to city center (Xiao Zhai/小寨 or Bell Tower/钟楼). Very reliable, runs until last flight.
- Metro Line 14: 12元, ~40min to city (check current extension status).
- Didi Express: 80-120元.
- Taxi: 100-150元.
- Tip: Airport is 38km from city. Bus is most cost-effective.

--- NANJING (南京) ---
Airport: 禄口国际机场 (NKG)
- Metro S1 (Airport Line): 29元, ~40min to South Railway Station (南京南站), then Line 1/3 to city. Total ~60min.
- Airport shuttle bus: 25元, ~50min to downtown (Xinjiekou/新街口).
- Didi Express: 80-110元.
- Taxi: 100-130元.
- Tip: Nanjing's metro S1 line is fast and reliable. Alipay QR code works for tickets.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 2: HOTELS BY CITY AND TIER
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- BUDGET (150-400元/night) ---
Reliable budget chains available in all major cities:
- 汉庭酒店 Hanting Hotel: 150-280元/night. Clean, consistent, good locations. Part of Huazhu Group.
- 如家快捷酒店 Home Inn: 150-280元/night. Widely available, decent value.
- 7天连锁酒店 7 Days Inn: 120-250元/night. Very basic, cheap. Book via app for discounts.
- 格林豪泰 GreenTree Inn: 150-300元/night. Clean business hotel.
- 速8酒店 Super 8 (China): 150-280元/night. Franchised local, quality varies by location.
- 布丁酒店 Pudding Hotel: 150-280元/night. Design-focused budget chain, popular with younger travelers.
- Tip: Budget hotels may ask to copy passport — normal procedure. Always request upper floors for quieter rooms.

--- MID-RANGE (400-900元/night) ---
- 全季酒店 Ji Hotel: 350-600元/night. Premium budget/mid-range from Huazhu Group. Reliable.
- 亚朵酒店 Atour Hotel: 400-700元/night. Lifestyle brand, design-focused, great for business travelers.
- 维也纳国际酒店 Vienna International: 400-700元/night. Popular in Shenzhen/Pearl River Delta.
- 丽枫酒店 Lavande Hotels: 350-600元/night. Good value, consistent quality.
- 美居酒店 Mercure (Accor): 500-900元/night. International standard, English-friendly, international card payment.
- 假日酒店 Holiday Inn Express: 500-900元/night. IHG brand, familiar Western comfort, English service.
- 希尔顿欢朋 Hampton Inn (Hilton): 500-900元/night. Reliable, international brand standards.

--- LUXURY (1000-5000元+/night) ---

SHANGHAI:
- 外滩华尔道夫 Waldorf Astoria Shanghai on the Bund: 3000-8000元/night. Historic 1910 heritage building + modern tower. Best Bund location. Peacock Room bar is iconic.
- 浦东香格里拉 Shangri-La Hotel Pudong: 1800-4500元/night. River views, excellent breakfast, large rooms.
- 上海柏悦 Park Hyatt Shanghai: 2200-6000元/night. Floors 79-93 of SWFC tower, stunning city views.
- 四季酒店 Four Seasons Shanghai: 2000-5000元/night. Jing'an district, excellent dining.
- 上海半岛酒店 The Peninsula Shanghai: 2500-7000元/night. Bund-side, colonial glamour.
- 璞丽酒店 The PuLi Hotel: 1800-4500元/night. Boutique luxury, Jing'an, gallery-hotel concept.

BEIJING:
- 北京饭店 Beijing Hotel (Raffles): 1200-3000元/night. Historic 1900 landmark, Chang'an Ave.
- 瑰丽酒店 Rosewood Beijing: 3000-8000元/night. Chaoyang, newest ultra-luxury.
- 北京四季酒店 Four Seasons Beijing: 2500-7000元/night. CBD area, consistent luxury.
- 北京华尔道夫 Waldorf Astoria Beijing: 2500-7000元/night. CBD, sleek modern.
- 北京文华东方 Mandarin Oriental Wangfujing: 2000-5500元/night. Steps from Forbidden City.
- 北京王府半岛 The Peninsula Beijing: 2000-5000元/night. Wangfujing, Forbidden City proximity.

SHENZHEN — NANSHAN / QIANHAI AREA (南山·前海) DETAILED:
[For travelers staying in 南山区 or 前海自贸区]

LUXURY (1500-5000元/night):
- 深圳湾万象城瑰丽酒店 Rosewood Shenzhen: 2500-5000元. 深圳湾/万象城, harbor views. Metro: Line 9/Line 2 Shenzhenwan. English-friendly concierge.
- 招商局蛇口希尔顿酒店 Hilton Shenzhen Shekou Nanhai: 1200-2800元. 蛇口片区, sea view, nearest to Shekou Ferry Terminal (Hong Kong ferries). Metro: Line 2 Shekou Port.
- 深圳W酒店 W Shenzhen: 1800-4500元 (Futian CBD, 30min by metro from Nanshan). IFS tower, ultra-modern, rooftop bar.
- 前海万豪酒店 Marriott Shenzhen Qianhai: 1200-2500元. 前海石公园, business-focused, Metro Line 1 Qianhai. Best for Qianhai Free Trade Zone business stays. Breakfast included in most packages.

MID-RANGE (400-900元/night):
- 维也纳国际酒店·深圳南山前海店 Vienna International: 420-680元. 前海片区. Metro Line 5 前海湾. Business amenities, reliable quality. Accepts international cards.
- 亚朵酒店·深圳南山科技园 Atour Hotel Nanshan Tech Park: 450-750元. 科技园/软件园. Metro Line 1 桃园站. Popular with tech business travelers. Modern design, good WiFi.
- 全季酒店·深圳南山前海 Ji Hotel Nanshan Qianhai: 380-650元. Metro Line 1/5. Clean, consistent, good location for Qianhai FTZ area.
- 希尔顿欢朋·深圳南山 Hampton Inn by Hilton Shenzhen Nanshan: 500-800元. 科技园北. Metro Line 2. Reliable Western standards, English service, buffet breakfast.
- 宜必思·深圳南山 ibis Shenzhen Nanshan: 350-550元. Budget-friendly international chain. Metro accessible.

BUDGET (150-350元/night):
- 汉庭酒店·深圳南山前海店 Hanting Hotel Qianhai: 180-280元. Basic, clean. Good for budget-conscious travelers.
- 如家快捷·深圳南山 Home Inn Nanshan: 150-260元. Consistent quality, near metro stations.

NANSHAN/QIANHAI DAILY TRANSPORT:
- Metro Line 1 (罗宝线): East-West corridor connecting Qianhai → Nanshan → Futian → Luohu. Runs 06:30-23:00.
- Metro Line 5 (环中线): 前海湾 ↔ 宝安 ↔ 布吉. Good for Qianhai FTZ area.
- Metro Line 11 (机场快线): Airport → Bao'an → Qianhai → Nanshan. Direct airport connection, 50min, 13.5元.
- Metro Line 2 (蛇口线): Qianhai → Shekou → Sea World area. Good for restaurants and Shekou.
- Didi in Nanshan: 15-30元 for most in-district trips. Easy to use with Google Pay.
- Day pass recommendation: 深圳通 Shenzhen Tong card (购于地铁站), 每次地铁约3-6元, 1-day unlimited metro pass ~20元.

NANSHAN/QIANHAI DINING GUIDE:
BREAKFAST options:
- 酒店自助早餐 (mid-range hotels): 60-100元/person, most common choice.
- 太二酸菜鱼·早茶: 50-80元. Nearby 万象天地.
- 麦当劳/肯德基: International chain breakfast 25-40元. Available everywhere.
- 沙县小吃 (Shaxian snacks, local chain): 15-25元. Steamed dumplings, noodles, soup. Very filling.
- 蒸功夫 (steam Chinese breakfast chain): 30-60元. Healthy steamed dim sum.

LUNCH options (Nanshan area):
- 万象天地·前海湾商圈: 30+ restaurants in one complex. Metro Line 1/5 前海湾. Options: 粤菜, sushi, Western, Korean.
- 海岸城 Coast City Mall (南山区): 50+ dining options. 地铁1号线 华侨城站旁.
- 南油片区老字号: Local canteens 20-35元/person. Fast and filling for lunch.
- 老渔民海鲜馆 (Shekou): 100-180元/person. Fresh Cantonese seafood, very popular. Metro Line 2 Shekou.
- 招商港湾购物广场: Good food court. 50-150元 range.

DINNER options (Nanshan area):
- 渔人码头·蛇口 Shekou Fisherman's Wharf: Cantonese seafood dining strip. 100-250元/person. Metro Line 2 Sea World.
- 深圳湾万象城: Luxury dining hub with international restaurants. 150-400元/person.
- 唐宫海鲜舫 Tang Palace (南山分店): 100-200元/person. Cantonese dim sum and seafood. English menu.
- 海底捞火锅·前海店 Haidilao Qianhai: 120-200元/person. 24hr, English menu, interactive dining.
- 西贝莜面村 Xi Bei (Nanshan): Halal-certified Northwest Chinese. 80-150元/person.
- 九毛九 9 Mao 9 (chain): Shanxi noodles, popular with locals. 60-100元/person.

ALL-DAY TRANSLATION SETUP (for Shenzhen/China):
- 讯飞翻译 iFlytek: Best real-time Chinese translation. Download offline pack before arrival.
- 腾讯翻译君 Tencent Translate: Good backup. WeChat mini-program available.
- Google Translate: Download Chinese offline pack. Works well for signs/menus.
- SIM card: China Mobile/Unicom tourist SIM, 5-day ~60元, 7-day ~80元 at airport. Buy at T3 Arrivals hall.
- eSIM alternative: Airalo or similar, 1GB/day ~$3USD. No physical card needed.

SHENZHEN:
- 深圳湾万象城瑰丽酒店 Rosewood Shenzhen: 2500-7000元/night. Shekou, harbor views, ultra-luxury.
- 招商局蛇口希尔顿酒店 Hilton Shenzhen Shekou: 1200-3000元/night. Nanshan, Shekou harbor.
- 深圳君悦酒店 Grand Hyatt Shenzhen: 1500-4000元/night. Convention center area.
- 深圳瑞吉 St. Regis Shenzhen: 2000-5000元/night. Luohu, older but grand.

GUANGZHOU:
- 广州文华东方酒店 Mandarin Oriental Guangzhou: 2000-5000元/night. Tianhe CBD, top service.
- 广州四季酒店 Four Seasons Hotel Guangzhou: 2000-5500元/night. IFC Tower, stunning views.
- 广州花园酒店 Garden Hotel Guangzhou: 1000-2500元/night. Yuexiu, classic, large gardens.
- 广州白天鹅宾馆 White Swan Hotel: 1200-3000元/night. Shamian Island, historic, riverfront.

BOOKING TIPS:
- 携程 Ctrip/Trip.com: Often 10-20% cheaper than hotel direct booking. Look for 会员价 member price.
- Book 7+ days ahead for weekends and Golden Week (国庆节 Oct 1-7, 春节 Chinese New Year).
- IHG/Marriott/Hilton loyalty points work at China properties.
- Chinese hotels often charge deposit (押金) 200-1000元 at check-in, returned at checkout.
- Most mid-range and above hotels have English-speaking front desk staff.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 3: RESTAURANTS BY CATEGORY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- PEKING DUCK (北京烤鸭) ---
- 全聚德 Quanjude (Qianmen flagship, Beijing): Since 1864. 200-350元/person. English menu available. Tourist-friendly, accepts international cards. Whole duck ~288元, half duck ~148元. Best for first-timers.
- 大董烤鸭 Dadong (multiple Beijing locations, also Shanghai): Modern interpretation, thinner skin. 300-500元/person. Reservation essential — book via Dianping 1-2 weeks ahead. Creative Sichuan-influenced sides.
- 四季民福 Siji Minfu (near Forbidden City, Beijing): Traditional style, 150-250元/person. Popular with locals, expect 30-60min queue at dinner. No reservation system. Arrive before 5:30pm.
- 便宜坊 Bianyifang (Beijing, multiple locations): One of oldest duck restaurants, 焖炉烤鸭 oven-roasted style (different from open-fire). 150-250元/person.

--- HOT POT (火锅) ---
- 海底捞 Haidilao (nationwide, 700+ locations): 120-200元/person. 24-hour service at many locations. English menu. Free waiting services: manicure, shoe polish, face masks, phone screen protector. Book via Haidilao app or arrive early evening.
- 巴奴毛肚火锅 Banu (Beijing, Zhengzhou, expanding): 150-250元/person. Known for premium 牛油 tallow broth and 毛肚 tripe. Reservation required.
- 小龙坎老火锅 Xiaolongkan (Chengdu origin, nationwide): 100-180元/person. Authentic Sichuan numbing-spicy 麻辣 broth. Order 鸳鸯锅 half-half for non-spicy/spicy combo.
- 呷哺呷哺 Xiabu Xiabu (North China, especially Beijing): 80-130元/person. Individual hotpot portions, fast and efficient. Good for solo dining.
- 大龙燚火锅 Da Long Yi (Chengdu style, expanding): 100-180元/person. Chengdu original, authentic 麻辣 flavor.

--- DIM SUM / CANTONESE BREAKFAST (点心/粤式早茶) ---
- 莲香楼 Lian Xiang Lou (Guangzhou, Dishifu Road since 1889): 60-100元/person. Arrive 7-9am for best experience. Classic 广式点心 Cantonese dim sum. Cash preferred. Very crowded on weekends.
- 广州酒家 Guangzhou Restaurant (Guangzhou, multiple locations): 80-150元/person. Established institution, better service than Lian Xiang Lou. Reliable quality. Book ahead for weekend yum cha.
- 唐宫海鲜舫 Tang Palace (Guangzhou, Shenzhen, Hong Kong): 100-200元/person. Upscale dim sum, private rooms available, English menu.
- 点都德 Dian Dou De (Guangzhou chain): 60-120元/person. Modern dim sum chain, consistently good, easier to get seats than older institutions.
- 南海渔村 (Guangzhou): 100-180元/person. Fresh seafood dim sum, large venue, good for groups.

--- SICHUAN (川菜) ---
- 陈麻婆豆腐 Chen Mapo Tofu (成都 original, Xiyulong Street): Since 1862. 60-100元/person. The original 麻婆豆腐 from the founding family. Very spicy. Ask for 微辣 (mild) or 不辣 (no spice). Cash only at original location.
- 宽窄巷子 Kuanzhai Alley (成都): Free entry. Multiple restaurants 80-200元/person. Try 龙抄手 wontons, 钟水饺 dumplings, 赖汤圆 sweet rice balls.
- 锦里老街 Jinli (成都): Similar to Kuanzhai, touristy but fun for snacks. 3-30元 for individual snacks.
- 眉州东坡 Meizhou Dongpo (nationwide): 100-180元/person. Good mid-range Sichuan, reliable quality, multiple cities.

--- SHANGHAINESE (本帮菜) ---
- 小杨生煎 Xiao Yang Sheng Jian (Shanghai, multiple locations): Pan-fried dumplings 生煎包. 20-35元/person for snack. Order by 两 (50g portions). 4 pieces per 两, usually order 2两. Soup inside, eat carefully.
- 南翔馒头店 Nanxiang Mantou Dian (Shanghai, Yu Garden): Famous 小笼包 xiaolongbao. 60-120元/person. Expect 30-60min queue at Yuyuan location. English menu.
- 鼎泰丰 Din Tai Fung (Shanghai, Beijing, multiple): Premium 小笼包. 120-200元/person. Consistent, English menu. Shanghai locations at IAPM mall, Xintiandi.
- 老正兴菜馆 Lao Zheng Xing (Shanghai, near People's Square): Classic 本帮 Shanghai cuisine since 1862. 100-180元/person. Must-try: 红烧肉 braised pork belly, 腌笃鲜 salted pork with bamboo shoot soup.
- 光明邨大酒家 Guangming Village (Shanghai, Huaihai Road): 60-120元/person. Very popular with locals, queues at peak. Great 熟食 cooked deli section.

--- HALAL (清真食品) ---
- 西贝莜面村 Xi Bei / Xibei Youmian Village (nationwide): Northwest Chinese halal. 80-150元/person. Halal-certified, great 莜面 oat noodles, 羊肉 lamb. English menu at some locations. Popular family-friendly chain.
- 东来顺饭庄 Dong Lai Shun (Beijing, Wangfujing flagship since 1903): 120-180元/person. Beijing's most famous halal hotpot. Thinly-sliced 涮羊肉 lamb hot pot. English service at main location. Reservation strongly recommended.
- 牛道牛肉火锅 Niu Dao (Beijing/Shanghai): 80-130元/person. Halal beef hotpot, popular with young professionals.
- 回民街 Muslim Street / 回坊 (Xi'an, near Drum Tower): Free entry. Street food heaven.
  * 羊肉串 Lamb skewers: 3-8元 each
  * 肉夹馍 Rou Jia Mo (meat burger): 12-18元
  * 凉皮 Liangpi cold noodles: 10-15元
  * Biangbiang 面 wide belt noodles: 15-25元
  * 羊肉泡馍 Lamb soup with bread: 28-45元
  * Best time: 5-9pm. Very crowded on weekends.
- Search 清真 (qīng zhēn) on Meituan/Dianping to filter halal options in any city.

--- WESTERN / EXPAT-FRIENDLY ---
- Wagas (Shanghai, Beijing, Guangzhou, Shenzhen): Salads, sandwiches, smoothies. 80-130元/person. English menu, English-speaking staff. International card payment. WiFi. Popular with expats and business travelers.
- Baker & Spice (Shanghai, Beijing, Chengdu): Artisan bakery/cafe. 60-100元/person. Excellent pastries, sandwiches, coffee. English menu, card-friendly.
- Element Fresh 新元素 (Shanghai, Beijing): Western-Asian fusion. 100-150元/person. English menu, reliable quality. Good salads, pastas, grilled dishes.
- KABB (Shanghai, Xintiandi): American/International. 120-180元/person. Burgers, steaks, cocktails. English menu, international vibe.
- Starbucks / Costa Coffee: Reliable for English menu, WiFi, card payment in all major cities.
- McDonald's / KFC / Burger King: Accept Alipay/WeChat, picture menus. Delivery via 美团外卖.

--- VEGETARIAN (素食) ---
- 枣子树 Zaoshu (Shanghai, multiple): Buddhist vegetarian. 80-150元/person. Creative mock-meat dishes.
- 功德林 Gongdelin (Shanghai, Beijing): Historic vegetarian since 1922. 80-150元/person.
- Most temples (寺庙) in major cities have vegetarian restaurants attached: inexpensive, authentic.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 4: TRANSPORT WITHIN CITIES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- DIDI (滴滴出行) — China's Uber ---
Setup:
1. Download "DiDi - Ride Hailing App" from App Store or Google Play
2. Register with international phone number (SMS verification)
3. Link international Visa or Mastercard credit card OR Alipay
4. Enable location permissions

Service Types (cheapest to most expensive):
- 快车 Express: Standard car (Civic/Elantra class). Most common.
- 优享 Premier: Slightly newer/nicer cars.
- 专车 Premium: Business class (Camry/Accord class). 1.5x Express price.
- 豪华车 Luxury: High-end (BMW/Mercedes). 2-3x Express price.

Approximate Express Prices:
- 3km: 12-20元
- 5km: 18-30元
- 10km: 35-55元
- 20km: 70-110元
- Airport 30km: 80-150元 (varies by city)
- Midnight surcharge (23:00-6:00): +20-30%
- Peak surcharge (7:30-9:30, 17:30-19:30 weekdays): +10-30%

Tips:
- Show driver destination on screen in Chinese characters. Screenshot the address.
- If driver calls, share phone to WeChat for text communication.
- Driver location shown on map — walk to them, they cannot always pull over.
- Set pickup to specific building entrance for large malls/hotels.

--- METRO (地铁) ---

Shanghai Metro (上海地铁):
- Fares: 3-14元 depending on distance. Most journeys 4-7元.
- Runs: 5:30am-23:00 (varies by line)
- Day pass: 18元
- Tourist card (交通卡): Available at airports and major stations, deposit 20元 + load credit
- Alipay QR: Scan at turnstile, no ticket needed (most convenient)
- English signage: Good, all stations have English names
- Key tourist lines: Line 2 (E-W spine, Pudong to Hongqiao), Line 10 (Old Town, Xintiandi), Line 11 (Disney)

Beijing Metro (北京地铁):
- Fares: 3元 base, +1元 per additional 6km, max 12元 for most trips
- Runs: ~5:00-23:30
- Useful lines: Line 1 (Tiananmen, Xidan, CBD), Line 2 (loop, hutong areas), Line 10 (Sanlitun, CBD), Airport Express
- Alipay/WeChat QR works at turnstiles
- Security check at all stations: bag X-ray mandatory

Shenzhen Metro (深圳地铁):
- Fares: 3-12元; Line 11 airport express 13.5元
- Key lines: Line 1 (Luohu to Overseas Chinese Town), Line 11 (airport to Futian)
- Very modern, fast, clean

Guangzhou Metro (广州地铁):
- Fares: 2-14元
- Key lines: Line 3 (Tianhe CBD and airport), Line 1 (east-west spine)

Other cities (Chengdu / Xi'an / Hangzhou / Nanjing):
- Simpler networks, 2-7元 typical fare, all accept Alipay QR

--- TAXI ---
- Shanghai: 14元 flag fall, 2.5元/km day, 3.1元/km night (23:00-5:00). Additional surcharge in heavy traffic.
- Beijing: 13元 flag fall (first 3km), 2.3元/km after. Night surcharge +20%.
- Shenzhen: 10元 flag fall (first 2km), 2.4元/km. No mandatory surcharge.
- Guangzhou: 10元 flag fall, 2.6元/km.
- Chengdu: 8元 flag fall, 1.9元/km.
- Xi'an: 8元 flag fall, 1.5元/km (among cheapest in major cities).
- All cities: Legitimate taxis have meters. Refuse unmarked cars offering flat rates at airports/stations.
- Best practice: Use Didi instead — no language barrier, digital receipt, price shown upfront.

--- HIGH-SPEED RAIL (高铁 / CRH) ---
Major Routes and Times:
- Shanghai — Beijing (G/D trains): 4.5-5.5h, 553元 2nd class / 933元 1st class / 1748元 business class
- Shanghai — Nanjing: 1-1.5h, 100-165元 2nd class. Very frequent (every 10-30min at peak).
- Shanghai — Hangzhou: 1-1.5h, 73-100元 2nd class. Multiple trains per hour.
- Shanghai — Suzhou: 20-25min, 40元. Excellent day trip option.
- Beijing — Xi'an: 4-5h, 515-700元 2nd class.
- Beijing — Guangzhou: 7.5-8h daytime G train ~880元.
- Guangzhou — Shenzhen (inter-city): 30-40min, 75-80元. Very frequent.
- Chengdu — Chongqing: 1-1.5h, 130-165元.

Booking HSR Tickets:
- 携程 Ctrip app (English): Best for foreigners. +15-25元 service fee. Can deliver to hotel or collect at station.
- Trip.com (Ctrip's English site): Same as above.
- 12306.cn (official Chinese railway): No service fee but account setup is complex for foreigners. Ctrip recommended.
- Tickets go on sale 15 days before departure. Popular routes sell out fast — book early.

At the Station:
- Passport required at gate (身份核验/ticket validation gate). Machine reads your passport.
- Collect physical ticket at 取票机 ticket machine if booked via Ctrip (insert passport, prints ticket).
- Allow 30-45min before departure for security + platforms.
- On-board: Clean, comfortable, food cart comes through. 2nd class seats: Assigned, comfortable. 1st class: Wider, more legroom. Business class: Lie-flat, meal included.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 5: PAYMENTS FOR FOREIGN VISITORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- ALIPAY INTERNATIONAL (支付宝) ---
The recommended payment method for foreign travelers.
Setup:
1. Download Alipay app (iOS/Android)
2. Select "International" or language option
3. Register with international phone number
4. Add Visa or Mastercard (most major international cards accepted)
5. Complete identity verification

Usage:
- Show QR code (scan 付款码 payment QR) at shops/restaurants
- Scan merchant QR code with app camera
- Works at: restaurants, supermarkets, convenience stores (7-Eleven, Family Mart, Lawson), taxis (via Didi), metro QR, pharmacies, tourist attractions, most shops
- Daily spending limit: ~3000元 USD equivalent per day (can request increase)
- Currency: Transactions in RMB; your card is charged in home currency with Alipay exchange rate
- Where it may not work: Very small rural vendors, some government offices

--- WECHAT PAY (微信支付) ---
Secondary option.
Setup for foreigners (improved as of 2024):
1. Download WeChat app
2. Go to "Me" → "Pay" → "Add Cards"
3. Link Visa or Mastercard directly
- Single transaction cap: 1,000元; daily cap: 3,000元
- Works for QR code payments at most places
- Basic payment QR works with linked foreign card

--- CASH (人民币 RMB / CNY) ---
When to use: Small vendors, street food, rural markets, taxis in smaller cities, emergency backup.

ATMs:
- Best banks for foreign cards: 中国工商银行 ICBC, 中国建设银行 CCB, 汇丰 HSBC (in major cities)
- Fee per withdrawal: ~25-35元 + your bank's international fee
- Limit: Usually 2000-3000元 per transaction
- 7-Eleven ATMs also accept some international cards

Currency Exchange:
- Airport exchange desks: Convenient but rates 3-5% worse than banks
- Major banks in city: Better rates, need passport
- Hotel lobby exchange: Rates vary, convenient for small amounts
- Avoid street money changers

Useful denominations: 100元, 50元, 20元, 10元 notes; 1元, 5角 coins for metro and small shops.

--- CREDIT/DEBIT CARDS ---
Where international cards are accepted:
- International hotels (5-star): Yes, always
- Upscale restaurants (chains with foreign ownership): Usually
- Major shopping malls: Usually
- Apple Store, international brand stores: Yes
- Convenience chains (7-Eleven, Family Mart): NO — QR code only
- Most local restaurants: NO
- Taxis: NO (use Didi)
- Metro stations: NO (use Alipay QR or buy ticket)

Cards with best China acceptance: Visa > Mastercard > Amex (limited) > Discover (rarely)


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 6: ATTRACTIONS BY CITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- SHANGHAI ---
- 外滩 The Bund: Free. Best visited at night (8-10pm) for Pudong skyline. Take Metro Line 2/10 to East Nanjing Road (南京东路).
- 豫园 Yu Garden: 40元 (inner garden). Built 1559, classical Suzhou-style garden. Allow 1-2h. Avoid weekends — extremely crowded. Surrounding bazaar is free.
- 上海博物馆 Shanghai Museum: Free (reserve online). Renmin Square. World-class collection of Chinese bronzes, ceramics, calligraphy. Allow 2-3h.
- 上海迪士尼乐园 Shanghai Disney Resort: 399-799元 depending on date (peak holiday 799元). Book 2-4 weeks ahead online. Take Metro Line 11 to Shanghai Disney Station.
- 新天地 Xintiandi: Free entry. Lane-house architecture turned into restaurants, bars, boutiques. English-friendly, international card payment.
- M50创意园 M50 Art District (Moganshan Road): Free. 50+ independent galleries, street art. Best on weekends.
- 田子坊 Tianzifang (French Concession): Free. Converted lilong alley with boutiques, cafes, art studios.

--- BEIJING ---
- 故宫博物院 The Palace Museum / Forbidden City: 60元 (Nov-Mar) / 80元 (Apr-Oct). MUST reserve online in advance at pm.cultural.cn — no same-day walk-in tickets. Opens 8:30am, closes 5pm (4:30pm winter). Allow full day. Metro: Tiananmen East/West (Line 1).
- 万里长城 Great Wall — Mutianyu (慕田峪): Most recommended section. 65元 entry + 100元 cable car up/toboggan down (or 80元 chairlift one-way). 2-3h walk time. Take public bus 916快 from Dongzhimen then shuttle, or organized tour 200-350元.
- 天坛公园 Temple of Heaven: 15元 (park) + 35元 (all buildings pass) = 50元 total. Ming dynasty ritual site. Best in morning when locals do tai chi. Allow 2h.
- 颐和园 Summer Palace: 30元 (Nov-Mar) / 50元 (Apr-Oct). Lakeside imperial gardens. 2-3h. Best in spring and autumn.
- 天安门广场 Tiananmen Square: Free but passport required for entry since 2019. Opens 6am. Expect security queue 15-30min.
- 798艺术区 798 Art District: Free entry. Factory-turned-art-district. Galleries, design studios, cafes, sculptures. Allow 2-3h. Metro Line 14 to 将台 Jiangtai.
- 雍和宫 Lama Temple: 25元 (includes incense). Active Tibetan Buddhist temple, beautiful architecture. Allow 1-2h.

--- SHENZHEN ---
- 深圳湾公园 Shenzhen Bay Park: Free. 15km waterfront park along bay facing Hong Kong. Sunset view of HK skyline. Take Metro Line 9 to 红树湾南站 Mangrove Bay South.
- 大梅沙海滨公园 Dameisha Beach: Free. Sandy beach 1h from downtown. Crowded on weekends.
- 华强北 Huaqiangbei Electronics Market: Free entry to streets. World's largest electronics market. Multiple multi-story buildings: 华强电子世界, 赛格广场. Phone accessories, components, cables, secondhand gadgets.
- 欢乐谷 Happy Valley: 280元 weekday / 320元 weekend. Major theme park. Metro Line 1 to 华侨城站 Overseas Chinese Town.
- 世界之窗 Window of the World: 210-230元. Miniature landmark replicas from around world. Same area as Happy Valley.

--- CHENGDU ---
- 成都大熊猫繁育研究基地 Giant Panda Research Base: 55元. Must-do in Chengdu. Book online in advance at cdpanda.com. Go early: arrive by 8am opening, pandas most active 8-10am. Allow 2-3h. Take Metro Line 3 to 熊猫大道站 Panda Boulevard then taxi/shuttle.
- 宽窄巷子 Wide and Narrow Alleys: Free entry. Traditional Qing dynasty alley complex, now dining/shopping. Crowded evenings.
- 锦里 Jinli: Free. Ancient street next to Wuhou Shrine (武侯祠). Traditional Sichuan snacks, handicrafts, teahouses. More atmospheric at night.
- 武侯祠 Wuhou Shrine (Three Kingdoms Memorial): 50元. Temple dedicated to Zhuge Liang. Allow 1-2h.
- 都江堰水利工程 Dujiangyan Irrigation System (day trip): 80元. UNESCO site 60km from Chengdu, 1.5h by metro/train. 2,000-year-old working irrigation system.

--- XI'AN ---
- 兵马俑 Terracotta Warriors Museum: 120元 peak season (Mar-Nov), 65元 off-season. Most important archaeological site in China. Half day minimum. Take Metro Line 9 to 兵马俑站 then walk 15min. Start with Pit 1 (largest), then Pit 2, Pit 3, then museum. English audio guide at entrance 40元.
- 西安城墙 City Wall: 54元. Complete 14km Ming dynasty city wall — one of best preserved in China. Rent bike: 45元/90min, 100元/full day. Sunrise ride especially beautiful.
- 回民街 Muslim Quarter / 回坊 Food Street: Free. Near Drum Tower (鼓楼). Pedestrian food street. Best 5-9pm. Islamic architecture, street food, evening atmosphere.
- 大雁塔 Big Wild Goose Pagoda: 50元 to enter pagoda / park free. Tang dynasty Buddhist pagoda from 652 AD. Evening musical fountain light show at 8pm (free).
- 华清宫 Huaqing Hot Springs Palace: 150元. Imperial resort where Yang Guifei bathed. 30km from city, combine with Terracotta Warriors trip.

--- GUANGZHOU ---
- 广州塔 Canton Tower: 150元 observation deck. 600m tall, tallest in China. Best at night for panoramic city view. Metro Line 3/APM to 赤岗塔站.
- 沙面 Shamian Island: Free. Colonial-era island with European architecture, cafe culture, banyan trees. Perfect for strolling. Metro Line 1 to 黄沙站.
- 陈家祠 Chen Clan Ancestral Hall: 10元. Stunning 1894 Lingnan-style architecture with intricate woodcarvings, stone sculptures. Allow 1-2h. Metro Line 1 to 陈家祠站.
- 白云山 Baiyun Mountain: 5元 entry + optional cable car. City's green lung, popular for morning hikes and city views from summit.
- 北京路步行街 Beijing Road Pedestrian Street: Free. Shopping, street food, archaeological ruins visible through glass floor.

--- HANGZHOU ---
- 西湖 West Lake: Free (most areas). UNESCO World Heritage. Multiple pagodas, causeways, gardens. Rent bike 30-50元/half day or take boat 45元. Best spring (March-April) and autumn.
- 灵隐寺 Lingyin Temple: 45元 temple entry (飞来峰 scenic area additional 45元). One of China's most famous Buddhist temples. Go early morning. Bus or Didi from lakeside.
- 河坊街 Hefang Street: Free. Old town pedestrian street with traditional snacks, herbal medicine shops, tea houses.
- 千岛湖 Thousand Island Lake (day trip): 190-240元 boat + entry. 2.5h by HSR from Hangzhou, stunning reservoir landscape.

--- NANJING ---
- 中山陵 Sun Yat-sen Mausoleum: 70元 (free Mon Nov-Mar). Impressive hilltop mausoleum. 392 stairs up, panoramic view. Metro Line 2 to 苜蓿园站 then cable car or walk.
- 明孝陵 Ming Xiaoling Mausoleum: 70元. Founding emperor of Ming dynasty, UNESCO site, forest avenue of stone animals.
- 夫子庙 Confucius Temple: Surrounding area free; inner temples 30元. Evening lantern reflections on Qinhuai River are beautiful.
- 南京博物院 Nanjing Museum: Free (reserve online). One of China's top provincial museums. 3 floors, comprehensive collection.
- 侵华日军南京大屠杀遇难同胞纪念馆 Nanjing Massacre Memorial Hall: Free. Deeply moving museum. Allow 2h. Appropriate dress and behavior expected.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 7: BOOKING PLATFORMS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- 携程 CTRIP / TRIP.COM ---
English interface: trip.com | Chinese app: 携程 (better deals, same company)
- Hotels: Largest inventory in China. Often 10-20% cheaper than direct booking. Easy English customer service. Cancel policies clearly stated.
- Flights: All domestic airlines, international connections. Seat selection available.
- HSR tickets: Reserve in-app, service fee ~25-30元. Collect physical ticket at station with passport.
- Tours/Attractions: Advance tickets for Forbidden City, Terracotta Warriors, Disney, Panda Base — avoids queues.
- Car transfers: Book airport-to-hotel transfers in advance, English-capable driver, fixed price.
- Customer service: English hotline available. App has English chat support.

--- 美团 MEITUAN ---
China's super-app for local services. Primarily in Chinese.
- 美团外卖 Food Delivery: Most comprehensive delivery app. Wider restaurant selection than any competitor.
- 美团酒店 Hotels: Competitive pricing especially for same-day and weekend bookings.
- 美团门票 Attractions: Buy tickets to parks, museums, shows.
- 美团单车 Bike Sharing: Yellow bikes across all major cities. Scan QR to unlock, 1.5元/30min.
- Foreign visitor use: Need Chinese phone number. Hotel/host can usually help set up.

--- 大众点评 DIANPING (Meituan's review platform) ---
China's equivalent of Yelp/TripAdvisor.
- Browse restaurant menus, read reviews, see photos
- Filter: 可预订 (reservations), 有英文菜单 (English menu), price range, cuisine
- 口碑值 Reputation score out of 5 (4.5+ is excellent)
- Coupon deals (团购): Significant discounts on set meals at restaurants
- Make reservations for popular restaurants directly through app
- Use for: verifying restaurant quality before going, finding nearby options, reading real guest reviews

--- 飞猪 FLIGGY (Alibaba Travel) ---
- Domestic flights: Good prices, links to Alipay seamlessly
- Package tours: Good for organized tours within China
- Hotels: Competitive, especially Alibaba partner hotels

--- 12306.CN (Official China Railway) ---
- Only source for guaranteed real-time ticket availability
- Foreign passport registration possible but process is complex
- Better to use Ctrip which pulls from 12306 inventory with English UI

--- BOOKING.COM / AGODA ---
- Works in China. Good inventory of international hotels.
- International credit card payment. Easy English interface.
- Some local hotels not listed or priced higher than Ctrip.


━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SECTION 8: PRACTICAL TIPS FOR FOREIGN VISITORS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

--- LANGUAGE ---
Translation apps:
- 百度翻译 Baidu Translate: Best for Chinese. Photo translation (point camera at menu/sign). Voice recognition for Mandarin.
- Google Translate: Works with VPN. Photo mode excellent for menus.
- Pleco: Best Chinese dictionary app for learning/looking up characters.

Essential Mandarin phrases:
- Ni hao (你好): Hello
- Xie xie (谢谢): Thank you
- Duoshao qian? (多少钱?): How much?
- Tai gui le (太贵了): Too expensive
- Bu yao (不要): Don't want / No thank you
- Wo bu dong (我不懂): I don't understand
- Cesuo zai nar? (厕所在哪?): Where is the bathroom?
- Wo yao qu... (我要去...): I want to go to...
- Sao ma (扫码): Scan QR code
- Xian jin (现金): Cash

Always have destination written in Chinese characters — show to driver or staff.
Get hotel business card with Chinese address — essential for taxis back.

--- SIM CARD / INTERNET ---
At the airport on arrival:
- China Mobile (中国移动): Best coverage nationwide including rural areas
- China Unicom (中国联通): Good coverage, usually cheaper data plans
- China Telecom (中国电信): Good in east China

Tourist SIM options:
- 7-day SIM: 80-100元, unlimited data (slowed after 15GB)
- 15-day SIM: 120-160元
- 30-day SIM: 200-300元
- Buy at airport immediately after arrival — passport required. Staff speak basic English.

Alternatively:
- International eSIM: Airalo, Holafly, Nomad — buy before departure, activate on arrival. 7-day China plan ~$15-25 USD. No physical SIM swap needed.

VPN (CRITICAL — download BEFORE entering China):
- Blocked in China: Google, Gmail, YouTube, Facebook, Instagram, WhatsApp, Twitter/X, most Western news sites
- Working VPNs (as of 2025): ExpressVPN, NordVPN, Astrill (most reliable), Surfshark
- Download and set up at home before travel — cannot install after arrival easily
- Enable VPN to use all blocked apps. WeChat, Line, Telegram: Work without VPN inside China.

--- TIPPING ---
- Restaurants: NOT expected or customary. Do not tip at most restaurants including high-end ones.
- Taxis: No tipping. Round up at most.
- Hotel housekeeping: Not expected, but 20-50元 appreciated at luxury properties.
- Tour guides: 50-100元/person/day appropriate for private guides.
- Hair salons: 20-50元 tip acceptable.
- Massage/spa: 20-50元 tip appropriate.

--- HEALTH & SAFETY ---
Air quality:
- Check 空气质量 Air Quality Index before outdoor activities in Beijing/Shanghai in winter.
- Apps: 墨迹天气 Moji Weather (includes AQI), AirVisual
- N95 masks recommended when AQI > 150 (unhealthy). Available at pharmacies.

Medical:
- Travel insurance: Essential. Hospital costs high for foreigners without insurance.
- Major hospitals international departments: Peking Union Medical College Hospital (北京协和医院), Huashan Hospital International Medical Center (上海华山医院)
- International SOS Beijing: +86 10 6462 9100 | International SOS Shanghai: +86 21 6295 0099
- Pharmacies: 24-hour pharmacies widely available. 药店 Yaodian. Common brand: 国大药房 Guoda.

--- EMERGENCY CONTACTS ---
- Police (警察 / 公安): 110
- Ambulance (救护车): 120
- Fire Department: 119
- Tourist Complaints & Assistance Hotline: 12301 (English available)
- China International SOS (medical evacuation): +86 10 6462 9100

--- SHOPPING & VAT REFUND ---
- VAT refund eligibility: Single-day single-store purchases of 500元+ on same receipt
- Participating stores display 退税 (tax refund) sticker
- At departure airport: Find 退税处 tax refund counter before customs, present: receipts, purchased goods, passport
- Refund rate: 9-11% of purchase price (processing fee deducted)
- Best shopping areas: Shanghai IFC Mall, Beijing SKP (upscale), Shenzhen MixC — all accept international cards

--- BEVERAGES & CAFES ---
- Bottled water: 农夫山泉 Nongfu Spring, 怡宝 C'estbon — buy at convenience store 2-4元/1.5L. Tap water not safe to drink.
- Convenience stores: 7-Eleven, Family Mart (全家), Lawson — in major cities, extensive beverage selection
- Tea shops: 喜茶 Heytea, 奈雪的茶 Nayuki, 茶百道 Cha Bai Dao — popular milk tea chains, 20-45元/drink
- Coffee: 瑞幸 Luckin Coffee — cheapest quality coffee 9-20元/cup, order via app. Starbucks at all major cities, 35-50元/cup.

--- ETIQUETTE ---
- Dress at religious sites: Cover shoulders and knees at Buddhist temples
- Photos: Ask permission before photographing people; temples have signs about restricted photography
- Bargaining: Appropriate at markets (华强北, 秀水市场 Silk Market in Beijing) — start at 30-40% of asking price. Not appropriate at malls or restaurants.
- Business cards (if business travel): Accept with two hands, look at it respectfully

--- CURRENCY CONVERSION REFERENCE ---
Approximate rates for planning (actual rates vary):
- 100元 RMB ≈ $14 USD ≈ €13 EUR ≈ £11 GBP ≈ HK$110
- Useful rule of thumb: Divide RMB price by 7 to get approximate USD equivalent

--- ACCOMMODATION REGISTRATION ---
- Chinese law requires foreigners to register address with local police within 24h of arrival
- Hotels do this automatically (they copy your passport at check-in)
- If staying at friends' home or Airbnb: Host must report to local police station. Ask Airbnb hosts if they handle this.

--- COMMON TOURIST SCAMS TO AVOID ---
- Tea ceremony scam: Friendly strangers invite you for "traditional tea ceremony" then present enormous bill. Decline politely.
- Art student scam: "Students" showing artwork at tourist sites invite you to "gallery" with pressure to buy overpriced art.
- Fake monks: Offering blessings or beads, then demanding payment.
- Unlicensed taxi: Drivers at arrival halls quoting inflated fixed rates — use Didi or official taxi stand with meters.

--- GOLDEN WEEK & HOLIDAY CROWDS ---
Peak travel periods — book everything well in advance, expect significant crowds:
- 春节 Chinese New Year (CNY): Jan-Feb (date varies). Most businesses closed. Domestic travel surges massively.
- 五一 Labor Day: May 1-5 (5-day holiday). Major travel surge.
- 国庆节 National Day Golden Week: October 1-7. BIGGEST holiday. All major attractions sell out weeks ahead. Hotel prices double. Book 4-6 weeks ahead or avoid if possible.
- 清明节 Qingming, 端午节 Dragon Boat Festival, 中秋节 Mid-Autumn Festival: 3-day weekends — elevated travel demand.
`;

function buildChinaTravelKnowledge() {
  return CHINA_TRAVEL_KNOWLEDGE.trim();
}

module.exports = { buildChinaTravelKnowledge };
