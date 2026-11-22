/* 旅圖 eSIM：國家、目的地、景點門票、eSIM 方案資料。
 * 價格與門票都是「參考價」（2026 年概估），正式上線前請改成官網與景點官方公告的金額。 */
(function attach(global) {
  // 旅行元素：用在足跡回顧、推薦配對與行程篩選。
  const ELEMENTS = {
    food: { label: '美食', icon: '🍜' },
    culture: { label: '文化古蹟', icon: '⛩️' },
    nature: { label: '自然風景', icon: '🏔️' },
    island: { label: '海島', icon: '🏝️' },
    city: { label: '城市漫遊', icon: '🏙️' },
    shopping: { label: '購物', icon: '🛍️' },
    onsen: { label: '溫泉', icon: '♨️' },
    snow: { label: '雪景滑雪', icon: '⛷️' },
    family: { label: '親子', icon: '🎡' },
    night: { label: '夜生活', icon: '🌃' },
    art: { label: '藝術設計', icon: '🎨' },
    adventure: { label: '戶外冒險', icon: '🧗' },
  };

  const REGIONS = {
    asia: '亞洲', europe: '歐洲', america: '美洲', oceania: '大洋洲', mideast: '中東',
  };

  // 匯率（1 單位外幣 ≈ 新台幣），只用來換算門票概估。
  const RATES = {
    JPY: 0.21, KRW: 0.023, THB: 0.95, VND: 0.00125, SGD: 24.5, MYR: 7.2, IDR: 0.002, PHP: 0.55,
    HKD: 4.1, MOP: 4, AUD: 21, NZD: 19, USD: 32, CAD: 23, GBP: 42, EUR: 36, CHF: 39, CZK: 1.45,
    AED: 8.7, TWD: 1,
  };

  // n：地圖用的 ISO 3166 數字代碼；base：每日 1GB 方案的參考價（新台幣/天）。
  const C = (n, name, region, site, cur, plug, base, ops, note) => ({
    n, name, region, site, cur, plug, base, ops, note: note || '',
  });
  const COUNTRIES = {
    JP: C('392', '日本', 'asia', 'https://www.japan.travel/', 'JPY', 'A / B（100V）', 39, 'docomo / SoftBank / KDDI', '入境前可先填 Visit Japan Web，通關較快'),
    KR: C('410', '韓國', 'asia', 'https://english.visitkorea.or.kr/', 'KRW', 'C / F（220V）', 39, 'SK Telecom / KT / LG U+'),
    TH: C('764', '泰國', 'asia', 'https://www.tourismthailand.org/', 'THB', 'A / B / C / O（220V）', 35, 'AIS / TrueMove H'),
    VN: C('704', '越南', 'asia', 'https://vietnam.travel/', 'VND', 'A / C（220V）', 35, 'Viettel / Vinaphone / Mobifone'),
    SG: C('702', '新加坡', 'asia', 'https://www.visitsingapore.com/', 'SGD', 'G（230V）', 39, 'Singtel / StarHub / M1', '入境前 3 天內要填 SG Arrival Card'),
    MY: C('458', '馬來西亞', 'asia', 'https://www.malaysia.travel/', 'MYR', 'G（240V）', 35, 'Maxis / CelcomDigi / U Mobile', '入境前要填 MDAC 數位入境卡'),
    ID: C('360', '印尼', 'asia', 'https://www.indonesia.travel/', 'IDR', 'C / F（230V）', 39, 'Telkomsel / Indosat / XL', '峇里島另收觀光稅 IDR 150,000（約 NT$300）'),
    PH: C('608', '菲律賓', 'asia', 'https://philippines.travel/', 'PHP', 'A / B / C（220V）', 39, 'Globe / Smart', '入境前要填 eTravel'),
    HK: C('344', '香港', 'asia', 'https://www.discoverhongkong.com/', 'HKD', 'G（220V）', 35, 'CSL / 3HK / SmarTone'),
    MO: C('446', '澳門', 'asia', 'https://www.macaotourism.gov.mo/', 'MOP', 'G / D（220V）', 35, 'CTM / 3 Macau'),
    KH: C('116', '柬埔寨', 'asia', 'https://www.tourismcambodia.com/', 'USD', 'A / C / G（230V）', 45, 'Smart / Cellcard'),
    MV: C('462', '馬爾地夫', 'asia', 'https://visitmaldives.com/', 'USD', 'G / D（230V）', 69, 'Dhiraagu / Ooredoo'),
    AU: C('036', '澳洲', 'oceania', 'https://www.australia.com/', 'AUD', 'I（230V）', 49, 'Telstra / Optus / Vodafone', '入境前要申請 ETA 電子簽'),
    NZ: C('554', '紐西蘭', 'oceania', 'https://www.newzealand.com/', 'NZD', 'I（230V）', 55, 'One NZ / Spark / 2degrees', '入境前要申請 NZeTA'),
    US: C('840', '美國', 'america', 'https://www.gousa.com/', 'USD', 'A / B（120V）', 49, 'T-Mobile / AT&T', '入境前要申請 ESTA'),
    CA: C('124', '加拿大', 'america', 'https://travel.destinationcanada.com/', 'CAD', 'A / B（120V）', 59, 'Rogers / Bell / Telus', '搭機入境前要申請 eTA'),
    GB: C('826', '英國', 'europe', 'https://www.visitbritain.com/', 'GBP', 'G（230V）', 49, 'EE / Vodafone / O2', '入境前要申請 ETA'),
    FR: C('250', '法國', 'europe', 'https://www.france.fr/', 'EUR', 'E（230V）', 49, 'Orange / SFR / Bouygues'),
    IT: C('380', '義大利', 'europe', 'https://www.italia.it/', 'EUR', 'F / L（230V）', 49, 'TIM / Vodafone / WindTre'),
    ES: C('724', '西班牙', 'europe', 'https://www.spain.info/', 'EUR', 'F（230V）', 49, 'Movistar / Orange / Vodafone'),
    DE: C('276', '德國', 'europe', 'https://www.germany.travel/', 'EUR', 'F（230V）', 49, 'Telekom / Vodafone / O2'),
    CH: C('756', '瑞士', 'europe', 'https://www.myswitzerland.com/', 'CHF', 'J（230V）', 69, 'Swisscom / Sunrise / Salt'),
    NL: C('528', '荷蘭', 'europe', 'https://www.holland.com/', 'EUR', 'F（230V）', 49, 'KPN / Vodafone / Odido'),
    AT: C('040', '奧地利', 'europe', 'https://www.austria.info/', 'EUR', 'F（230V）', 49, 'A1 / Magenta / Drei'),
    CZ: C('203', '捷克', 'europe', 'https://www.visitczechia.com/', 'CZK', 'E（230V）', 49, 'O2 / T-Mobile / Vodafone'),
    GR: C('300', '希臘', 'europe', 'https://www.visitgreece.gr/', 'EUR', 'F（230V）', 49, 'Cosmote / Vodafone / Nova'),
    PT: C('620', '葡萄牙', 'europe', 'https://www.visitportugal.com/', 'EUR', 'F（230V）', 49, 'MEO / NOS / Vodafone'),
    TR: C('792', '土耳其', 'mideast', 'https://goturkiye.com/', 'EUR', 'F（230V）', 55, 'Turkcell / Vodafone / Türk Telekom'),
    AE: C('784', '阿聯酋', 'mideast', 'https://www.visitdubai.com/', 'AED', 'G（230V）', 59, 'e& / du'),
    TW: C('158', '台灣', 'asia', 'https://www.taiwan.net.tw/', 'TWD', 'A / B（110V）', 0, '中華電信 / 台灣大哥大 / 遠傳'),
  };

  // 景點：[名稱, 幣別, 成人門票, 備註]。門票 0 = 免費，null = 依方案而定。
  const S = (name, cur, fee, note) => ({
    name, cur, fee, note: note || '',
  });
  // 目的地：[id, 國家, 名稱, 緯度, 經度, 元素, 最佳月份, 台北直飛約幾小時, 一句話, 景點]
  const D = (id, c, name, lat, lng, tags, months, hours, blurb, spots) => ({
    id, c, name, lat, lng, tags, months, hours, blurb, spots,
  });
  const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
  const DESTS = [
    D('tokyo', 'JP', '東京', 35.68, 139.76, ['city', 'shopping', 'food', 'night', 'art'], ALL, 3.2, '潮流、動漫與米其林密度世界第一的城市', [
      S('淺草寺', 'JPY', 0), S('SHIBUYA SKY', 'JPY', 2500, '線上預約較便宜'), S('東京晴空塔 天望甲板', 'JPY', 2100, '起'), S('teamLab Planets', 'JPY', 3600, '起，依日期浮動'), S('築地場外市場', 'JPY', 0)]),
    D('hakone', 'JP', '箱根', 35.23, 139.1, ['onsen', 'nature'], [1, 3, 4, 10, 11, 12], 3.5, '離東京最近的溫泉鄉，晴天看得到富士山', [
      S('箱根神社', 'JPY', 0), S('大涌谷', 'JPY', 0, '纜車另計'), S('箱根周遊券（新宿出發 2 日）', 'JPY', 6100), S('蘆之湖海賊船', 'JPY', 1500, '單程')]),
    D('kawaguchiko', 'JP', '河口湖', 35.5, 138.76, ['nature', 'onsen'], [1, 2, 4, 10, 11, 12], 3.5, '拍富士山倒影最美的湖畔小鎮', [
      S('大石公園', 'JPY', 0), S('新倉山淺間公園', 'JPY', 0), S('河口湖富士山全景纜車', 'JPY', 1000, '來回')]),
    D('kyoto', 'JP', '京都', 35.01, 135.77, ['culture', 'food', 'art'], [3, 4, 11], 2.8, '千年古都，春櫻秋楓都是一生必看', [
      S('伏見稻荷大社', 'JPY', 0), S('清水寺', 'JPY', 500), S('金閣寺', 'JPY', 500), S('嵐山竹林小徑', 'JPY', 0)]),
    D('osaka', 'JP', '大阪', 34.69, 135.5, ['food', 'city', 'shopping', 'family', 'night'], ALL, 2.6, '「吃到倒」的美食之都，親子行首選', [
      S('道頓堀', 'JPY', 0), S('大阪城天守閣', 'JPY', 1200), S('日本環球影城', 'JPY', 8600, '起，依日期浮動'), S('海遊館', 'JPY', 2700)]),
    D('nara', 'JP', '奈良', 34.68, 135.84, ['culture', 'family'], [3, 4, 10, 11], 2.8, '和小鹿一起散步的古都，大阪出發一小時', [
      S('奈良公園', 'JPY', 0, '鹿仙貝約 ¥200'), S('東大寺大佛殿', 'JPY', 800), S('春日大社', 'JPY', 0, '本殿特別參拜另計')]),
    D('sapporo', 'JP', '北海道・札幌', 43.06, 141.35, ['snow', 'food', 'nature', 'onsen'], [1, 2, 7, 8, 12], 3.8, '冬天看雪祭、夏天看花海，海鮮必吃', [
      S('二條市場', 'JPY', 0), S('小樽運河', 'JPY', 0), S('登別地獄谷', 'JPY', 0), S('旭山動物園', 'JPY', 1000)]),
    D('okinawa', 'JP', '沖繩', 26.21, 127.68, ['island', 'family', 'nature'], [4, 5, 6, 7, 8, 9, 10], 1.3, '飛行一小時就到的海島，自駕最方便', [
      S('沖繩美麗海水族館', 'JPY', 2180), S('古宇利島', 'JPY', 0), S('國際通', 'JPY', 0), S('首里城公園', 'JPY', 400)]),
    D('fukuoka', 'JP', '福岡', 33.59, 130.4, ['food', 'city', 'onsen'], ALL, 2.1, '屋台與拉麵的城市，週末小旅行剛好', [
      S('中洲屋台', 'JPY', 0), S('太宰府天滿宮', 'JPY', 0), S('福岡塔', 'JPY', 1000)]),
    D('kanazawa', 'JP', '金澤', 36.56, 136.66, ['culture', 'food', 'art'], [4, 10, 11], 3, '小京都：庭園、茶屋街與金箔冰淇淋', [
      S('兼六園', 'JPY', 320), S('東茶屋街', 'JPY', 0), S('金澤 21 世紀美術館', 'JPY', 0, '交流區免費，展覽另計')]),
    D('seoul', 'KR', '首爾', 37.57, 126.98, ['city', 'shopping', 'food', 'night'], ALL, 2.4, '韓劇場景、美妝與咖啡廳巡禮', [
      S('景福宮', 'KRW', 3000, '穿韓服免費'), S('明洞', 'KRW', 0), S('聖水洞', 'KRW', 0), S('N 首爾塔 展望台', 'KRW', 26000)]),
    D('busan', 'KR', '釜山', 35.18, 129.08, ['island', 'food', 'city'], [4, 5, 6, 7, 8, 9, 10], 2.1, '海港城市，海景咖啡廳與新鮮海產', [
      S('甘川洞文化村', 'KRW', 0), S('海雲台', 'KRW', 0), S('札嘎其市場', 'KRW', 0), S('海東龍宮寺', 'KRW', 0)]),
    D('jeju', 'KR', '濟州島', 33.49, 126.53, ['island', 'nature', 'adventure'], [4, 5, 9, 10], 2, '火山島自駕，油菜花與海女文化', [
      S('城山日出峰', 'KRW', 5000), S('漢拏山', 'KRW', 0, '部分步道需預約'), S('牛島渡輪', 'KRW', 10500, '來回')]),
    D('bangkok', 'TH', '曼谷', 13.76, 100.5, ['food', 'city', 'night', 'shopping', 'culture'], [1, 2, 11, 12], 3.8, '寺廟、夜市與按摩，CP 值最高的城市', [
      S('大皇宮', 'THB', 500), S('臥佛寺', 'THB', 300), S('鄭王廟', 'THB', 200), S('喬德夜市', 'THB', 0)]),
    D('chiangmai', 'TH', '清邁', 18.79, 98.99, ['culture', 'nature', 'food'], [1, 2, 11, 12], 4, '慢活古城，咖啡、山林與大象', [
      S('素帖寺', 'THB', 30), S('清邁古城', 'THB', 0), S('大象保護營', 'THB', 2500, '起，半日')]),
    D('phuket', 'TH', '普吉島', 7.88, 98.39, ['island', 'night', 'adventure'], [1, 2, 3, 4, 11, 12], 4.5, '跳島、潛水與海灘夜生活', [
      S('皮皮島一日遊', 'THB', 1800, '起，含船'), S('芭東海灘', 'THB', 0), S('普吉老城', 'THB', 0)]),
    D('danang', 'VN', '峴港', 16.05, 108.2, ['island', 'food', 'family'], [3, 4, 5, 6, 7, 8], 2.5, '海灘度假村＋會安古鎮，親子友善', [
      S('巴拿山（含纜車）', 'VND', 900000), S('美溪沙灘', 'VND', 0), S('會安古鎮', 'VND', 120000)]),
    D('hanoi', 'VN', '河內', 21.03, 105.85, ['culture', 'food'], [3, 4, 10, 11, 12], 3, '法式老城與河粉，順遊下龍灣', [
      S('還劍湖', 'VND', 0), S('文廟', 'VND', 70000), S('下龍灣一日遊', 'VND', 1200000, '起，含船'), S('三十六古街', 'VND', 0)]),
    D('hcmc', 'VN', '胡志明市', 10.78, 106.7, ['city', 'food', 'night'], [1, 2, 3, 4, 12], 3.2, '摩托車之城，咖啡與法式建築', [
      S('濱城市場', 'VND', 0), S('西貢聖母大教堂', 'VND', 0), S('古芝地道', 'VND', 125000)]),
    D('phuquoc', 'VN', '富國島', 10.29, 103.98, ['island', 'family'], [1, 2, 3, 4, 11, 12], 3.5, '越南最南的度假島，跨海纜車超壯觀', [
      S('香島跨海纜車', 'VND', 650000), S('VinWonders 樂園', 'VND', 950000), S('長灘', 'VND', 0)]),
    D('singapore', 'SG', '新加坡', 1.35, 103.82, ['city', 'family', 'food', 'shopping'], ALL, 4.5, '乾淨安全的花園城市，親子行不踩雷', [
      S('濱海灣花園（戶外區）', 'SGD', 0), S('雲霧林＋花穹', 'SGD', 53), S('新加坡環球影城', 'SGD', 83), S('牛車水', 'SGD', 0)]),
    D('kl', 'MY', '吉隆坡', 3.14, 101.69, ['city', 'food', 'shopping'], ALL, 4.8, '多元文化與平價美食', [
      S('雙子星塔 觀景台', 'MYR', 98), S('黑風洞', 'MYR', 0), S('亞羅街夜市', 'MYR', 0)]),
    D('penang', 'MY', '檳城', 5.41, 100.33, ['food', 'culture', 'art'], [1, 2, 3, 12], 4.5, '街頭壁畫與娘惹美食', [
      S('喬治市壁畫街', 'MYR', 0), S('升旗山纜車', 'MYR', 30, '來回'), S('新關仔角小販中心', 'MYR', 0)]),
    D('bali', 'ID', '峇里島', -8.41, 115.19, ['island', 'nature', 'culture', 'adventure'], [4, 5, 6, 7, 8, 9, 10], 5.2, '梯田、神廟與夕陽海灘', [
      S('德格拉朗梯田', 'IDR', 50000), S('海神廟', 'IDR', 75000), S('金巴蘭海灘', 'IDR', 0)]),
    D('cebu', 'PH', '宿霧', 10.32, 123.89, ['island', 'adventure'], [1, 2, 3, 4, 5], 2.5, '跳島、浮潛與鯨鯊共游', [
      S('薄荷島巧克力山', 'PHP', 100), S('歐斯陸賞鯨鯊', 'PHP', 1000), S('麥哲倫十字架', 'PHP', 0)]),
    D('hongkong', 'HK', '香港', 22.32, 114.17, ['city', 'food', 'shopping', 'night'], [1, 2, 3, 10, 11, 12], 1.8, '飛 2 小時的週末城市，夜景與茶餐廳', [
      S('太平山頂纜車', 'HKD', 118, '來回'), S('維多利亞港', 'HKD', 0), S('天星小輪', 'HKD', 5), S('深水埗', 'HKD', 0)]),
    D('macau', 'MO', '澳門', 22.2, 113.54, ['culture', 'food', 'night'], [1, 2, 3, 10, 11, 12], 1.8, '葡式街景、蛋塔與度假村', [
      S('大三巴牌坊', 'MOP', 0), S('議事亭前地', 'MOP', 0), S('澳門塔觀光層', 'MOP', 165)]),
    D('siemreap', 'KH', '暹粒', 13.36, 103.86, ['culture', 'adventure'], [1, 2, 3, 11, 12], 3, '吳哥窟日出，一生一定要看一次', [
      S('吳哥通行證（1 日）', 'USD', 37), S('塔布蘿寺', 'USD', 0, '含在吳哥通行證'), S('洞里薩湖', 'USD', 20, '起')]),
    D('maldives', 'MV', '馬爾地夫', 4.18, 73.51, ['island'], [1, 2, 3, 4, 11, 12], 9, '水上屋與透明海水，蜜月首選', [
      S('浮潛看魟魚', 'USD', 50, '起'), S('沙洲野餐', 'USD', 100, '起'), S('水上屋', 'USD', null, '住宿依飯店而定')]),
    D('sydney', 'AU', '雪梨', -33.87, 151.21, ['city', 'nature', 'island'], [1, 2, 3, 9, 10, 11, 12], 9, '歌劇院、海灘與藍山', [
      S('雪梨歌劇院導覽', 'AUD', 45), S('邦代海灘', 'AUD', 0), S('藍山國家公園', 'AUD', 0)]),
    D('melbourne', 'AU', '墨爾本', -37.81, 144.96, ['art', 'food', 'city'], [1, 2, 3, 10, 11, 12], 9.5, '咖啡之都，自駕大洋路', [
      S('大洋路', 'AUD', 0), S('菲利普島企鵝歸巢', 'AUD', 35), S('巷弄咖啡', 'AUD', 0)]),
    D('queenstown', 'NZ', '皇后鎮', -45.03, 168.66, ['adventure', 'nature', 'snow'], [1, 2, 3, 6, 7, 8, 12], 12, '極限運動之都，峽灣美景', [
      S('米佛峽灣遊船', 'NZD', 100, '起'), S('天際線纜車', 'NZD', 59), S('卡瓦勞高空彈跳', 'NZD', 275)]),
    D('nyc', 'US', '紐約', 40.71, -74.01, ['city', 'art', 'shopping', 'night'], [4, 5, 6, 9, 10, 11, 12], 15.5, '博物館、百老匯與天際線', [
      S('中央公園', 'USD', 0), S('大都會博物館', 'USD', 30), S('帝國大廈', 'USD', 44, '起'), S('時代廣場', 'USD', 0)]),
    D('la', 'US', '洛杉磯', 34.05, -118.24, ['city', 'family', 'nature'], ALL, 12, '好萊塢、主題樂園與加州陽光', [
      S('好萊塢星光大道', 'USD', 0), S('好萊塢環球影城', 'USD', 109, '起'), S('蓋提中心', 'USD', 0, '停車另計'), S('聖塔莫尼卡', 'USD', 0)]),
    D('honolulu', 'US', '夏威夷・檀香山', 21.31, -157.86, ['island', 'family', 'adventure'], ALL, 9, '威基基海灘與火山健行', [
      S('威基基海灘', 'USD', 0), S('鑽石頭山', 'USD', 5, '需預約'), S('珍珠港亞利桑那紀念館', 'USD', 0, '預約費 $1')]),
    D('vancouver', 'CA', '溫哥華', 49.28, -123.12, ['nature', 'city', 'snow'], [1, 2, 6, 7, 8, 9, 12], 11, '城市就在山海之間，冬天滑雪', [
      S('史丹利公園', 'CAD', 0), S('卡皮拉諾吊橋', 'CAD', 72), S('惠斯勒 Peak 2 Peak', 'CAD', 100, '起')]),
    D('london', 'GB', '倫敦', 51.51, -0.13, ['city', 'art', 'culture', 'shopping'], [5, 6, 7, 8, 9, 12], 14, '免費博物館最多的城市', [
      S('大英博物館', 'GBP', 0), S('倫敦塔', 'GBP', 35), S('倫敦塔橋展覽', 'GBP', 13), S('柯芬園', 'GBP', 0)]),
    D('paris', 'FR', '巴黎', 48.86, 2.35, ['art', 'culture', 'food', 'shopping'], [4, 5, 6, 9, 10], 14, '藝術、甜點與塞納河', [
      S('羅浮宮', 'EUR', 32, '非歐盟旅客'), S('艾菲爾鐵塔（電梯到頂）', 'EUR', 36), S('凡爾賽宮', 'EUR', 21), S('蒙馬特', 'EUR', 0)]),
    D('rome', 'IT', '羅馬', 41.9, 12.5, ['culture', 'art', 'food'], [4, 5, 9, 10], 14, '走在兩千年的歷史裡', [
      S('羅馬競技場＋古羅馬廣場', 'EUR', 18), S('梵蒂岡博物館', 'EUR', 20, '線上預約另加手續費'), S('特雷維噴泉', 'EUR', 2, '近池區')]),
    D('barcelona', 'ES', '巴塞隆納', 41.39, 2.17, ['art', 'food', 'island', 'city'], [5, 6, 9, 10], 15, '高第建築與地中海海鮮飯', [
      S('聖家堂', 'EUR', 26, '起'), S('奎爾公園', 'EUR', 18), S('波格利亞市場', 'EUR', 0)]),
    D('prague', 'CZ', '布拉格', 50.08, 14.44, ['culture', 'art', 'city'], [5, 6, 9, 12], 14, '童話般的古城，聖誕市集超浪漫', [
      S('查理大橋', 'CZK', 0), S('布拉格城堡', 'CZK', 450), S('舊城廣場', 'CZK', 0)]),
    D('vienna', 'AT', '維也納', 48.21, 16.37, ['art', 'culture'], [5, 6, 9, 12], 14, '音樂之都，宮殿與咖啡館', [
      S('美泉宮（完整導覽）', 'EUR', 30), S('史蒂芬大教堂', 'EUR', 0, '登塔另計'), S('國家歌劇院導覽', 'EUR', 15)]),
    D('interlaken', 'CH', '因特拉肯', 46.69, 7.86, ['nature', 'snow', 'adventure'], [1, 2, 6, 7, 8, 9], 15, '阿爾卑斯山的門戶', [
      S('少女峰（來回火車）', 'CHF', 240, '起'), S('布里恩茨湖', 'CHF', 0, '遊船另計'), S('勞特布倫嫩瀑布谷', 'CHF', 0)]),
    D('amsterdam', 'NL', '阿姆斯特丹', 52.37, 4.9, ['art', 'city'], [4, 5, 9], 14, '運河、單車與梵谷', [
      S('梵谷博物館', 'EUR', 22), S('運河遊船', 'EUR', 20, '起'), S('庫肯霍夫花園', 'EUR', 20, '春季限定')]),
    D('santorini', 'GR', '聖托里尼', 36.39, 25.46, ['island', 'art'], [5, 6, 9, 10], 16, '藍頂白屋與伊亞夕陽', [
      S('伊亞夕陽', 'EUR', 0), S('費拉', 'EUR', 0), S('紅沙灘', 'EUR', 0)]),
    D('lisbon', 'PT', '里斯本', 38.72, -9.14, ['city', 'food', 'culture'], [4, 5, 6, 9, 10], 16, '黃色電車、蛋塔與大西洋', [
      S('貝倫塔', 'EUR', 10), S('28 號電車', 'EUR', 3), S('辛特拉佩納宮', 'EUR', 20)]),
    D('istanbul', 'TR', '伊斯坦堡', 41.01, 28.98, ['culture', 'food', 'shopping'], [4, 5, 9, 10], 12.5, '橫跨歐亞的千年古城', [
      S('藍色清真寺', 'EUR', 0), S('聖索菲亞大教堂', 'EUR', 25, '外國旅客'), S('大巴扎', 'EUR', 0)]),
    D('cappadocia', 'TR', '卡帕多奇亞', 38.64, 34.83, ['nature', 'adventure'], [4, 5, 6, 9, 10], 14, '清晨上百顆熱氣球', [
      S('熱氣球', 'EUR', 200, '起，依季節'), S('格雷梅露天博物館', 'EUR', 20), S('地下城', 'EUR', 13)]),
    D('dubai', 'AE', '杜拜', 25.2, 55.27, ['city', 'shopping', 'adventure'], [1, 2, 3, 11, 12], 9, '世界第一高樓與沙漠衝沙', [
      S('哈里發塔 At the Top', 'AED', 169, '起'), S('沙漠衝沙', 'AED', 150, '起'), S('杜拜購物中心', 'AED', 0), S('杜拜噴泉', 'AED', 0)]),
  ];

  // eSIM 多國方案。
  const PACKS = {
    ASIA: { name: '亞洲多國', icon: '🌏', base: 55, countries: ['JP', 'KR', 'TH', 'VN', 'SG', 'MY', 'ID', 'PH', 'HK', 'MO', 'KH'] },
    SEA: { name: '東南亞', icon: '🌴', base: 45, countries: ['TH', 'VN', 'SG', 'MY', 'ID', 'PH', 'KH'] },
    HKMO: { name: '港澳', icon: '🌉', base: 39, countries: ['HK', 'MO'] },
    EU: { name: '歐洲多國', icon: '🇪🇺', base: 65, countries: ['GB', 'FR', 'IT', 'ES', 'DE', 'CH', 'NL', 'AT', 'CZ', 'GR', 'PT', 'TR'] },
    ANZ: { name: '澳紐', icon: '🦘', base: 59, countries: ['AU', 'NZ'] },
    NA: { name: '美加', icon: '🗽', base: 59, countries: ['US', 'CA'] },
    GLOBAL: { name: '全球通用', icon: '🌐', base: 99, countries: Object.keys(COUNTRIES).filter((code) => code !== 'TW') },
  };

  // 中文維基百科條目名稱，用來抓目的地照片（Wikipedia REST API，瀏覽器端讀取）。
  const WIKI = {
    tokyo: '東京', hakone: '箱根町', kawaguchiko: '河口湖', kyoto: '京都市', osaka: '大阪市', nara: '奈良市', sapporo: '札幌市',
    okinawa: '沖繩島', fukuoka: '福岡市', kanazawa: '金澤市', seoul: '首爾', busan: '釜山廣域市', jeju: '濟州島', bangkok: '曼谷',
    chiangmai: '清邁', phuket: '普吉島', danang: '峴港', hanoi: '河內', hcmc: '胡志明市', phuquoc: '富國島', singapore: '新加坡',
    kl: '吉隆坡', penang: '檳城', bali: '峇里島', cebu: '宿霧市', hongkong: '香港', macau: '澳門', siemreap: '暹粒', maldives: '馬爾地夫',
    sydney: '雪梨', melbourne: '墨爾本', queenstown: '皇后鎮 (紐西蘭)', nyc: '紐約', la: '洛杉磯', honolulu: '檀香山', vancouver: '溫哥華',
    london: '倫敦', paris: '巴黎', rome: '羅馬', barcelona: '巴塞隆納', prague: '布拉格', vienna: '維也納', interlaken: '因特拉肯',
    amsterdam: '阿姆斯特丹', santorini: '聖托里尼島', lisbon: '里斯本', istanbul: '伊斯坦堡', cappadocia: '卡帕多細亞', dubai: '杜拜',
  };

  const HOMES = {
    TPE: { name: '台北', lat: 25.08, lng: 121.23, n: '158' },
    RMQ: { name: '台中', lat: 24.26, lng: 120.62, n: '158' },
    KHH: { name: '高雄', lat: 22.58, lng: 120.35, n: '158' },
  };

  global.TRAVEL_DATA = {
    ELEMENTS, REGIONS, RATES, COUNTRIES, DESTS, PACKS, HOMES, WIKI,
  };
}(typeof window !== 'undefined' ? window : globalThis));
