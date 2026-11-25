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
    EU: { name: '歐洲多國', icon: '🇪🇺', base: 65, countries: ['GB', 'IE', 'FR', 'DE', 'IT', 'ES', 'PT', 'NL', 'BE', 'LU', 'CH', 'AT', 'CZ', 'SK', 'PL', 'HU', 'SI', 'HR', 'GR', 'BG', 'RO', 'EE', 'LV', 'LT', 'FI', 'SE', 'NO', 'DK', 'IS', 'MT', 'TR'] },
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

  // eSIM 方案類型（示意）。k 是相對每日 1GB 參考價的倍數；總量型的 k 是整包價格倍數。
  const PLAN_TYPES = {
    daily: {
      label: '每日定量', note: '每天 0 點（當地時間）重置流量，用完當天降速，隔天恢復',
      options: [
        { size: '1', name: '每日 1GB', persona: '輕量社交', speed: '128kbps', k: 1, icon: '📍', desc: '地圖導航、LINE 文字訊息、查餐廳評價，大多數自由行夠用。', tags: ['Google 地圖', 'LINE 訊息', '網頁搜尋'] },
        { size: '2', name: '每日 2GB', persona: '打卡分享', speed: '256kbps', k: 1.5, icon: '📸', desc: '每天上傳照片、滑 IG／FB、偶爾視訊報平安。', tags: ['IG／FB 打卡', '上傳照片', '短時間視訊'] },
        { size: '3', name: '每日 3GB', persona: '影音工作', speed: '384kbps', k: 1.9, icon: '🎬', desc: '看影片、開視訊會議，或分享熱點給一位同行的人。', tags: ['YouTube', '視訊會議', '熱點分享'] },
      ],
    },
    total: {
      label: '總量型', note: '一次給足，用完即止、不每日重置。可以前幾天只開地圖，最後一天把剩下的流量用完',
      options: [
        { size: '5', name: '5GB', persona: '短程輕量', days: 15, k: 4.6, icon: '🧳', desc: '3～5 天的短程旅行，主要用地圖和通訊軟體。', tags: ['短程', '省錢'] },
        { size: '10', name: '10GB', persona: '一週剛好', days: 30, k: 7.5, icon: '🗓️', desc: '一週左右的旅行，每天使用量不固定也不怕。', tags: ['一週', '彈性'] },
        { size: '20', name: '20GB', persona: '長途重度', days: 30, k: 12, icon: '🌍', desc: '兩週以上或同行共用熱點。', tags: ['長途', '共用熱點'] },
      ],
    },
    unl: {
      label: '吃到飽', note: '每天不限流量，適合重度使用與熱點分享',
      options: [
        { size: 'std', name: '標準吃到飽', persona: 'CP 值之選', k: 2.3, icon: '⚡', desc: '全程 4G 不限量；當地網路壅塞時，速度可能較慢。', tags: ['不限量', '4G'] },
        { size: 'pro', name: '高速優先吃到飽', persona: '旗艦', k: 3.2, icon: '⭐', premium: true, desc: '5G／4G 高速優先線路，熱門景點、跨年活動現場也比較穩。', perks: ['網路壅塞時優先連線', '低延遲，適合直播與視訊', '熱點分享更穩定'], tags: ['5G', '優先線路'] },
      ],
    },
  };

  // 使用期限（示意，請改成官網條款）。
  const POLICY = { claimDays: 540, installDays: 180, activateDays: 30 };

  // 各國有名的美食、文化、伴手禮與小提醒。[中文, 英文維基條目（用來找照片）]
  const CULTURE = {
    JP: { food: [['壽司', 'Sushi'], ['拉麵', 'Ramen'], ['和牛燒肉', 'Wagyu']], culture: [['溫泉', 'Onsen'], ['和服體驗', 'Kimono'], ['茶道', 'Japanese tea ceremony']], buy: ['藥妝', '抹茶點心', '文具'], tips: ['手扶梯東京靠左站、大阪靠右站', '多數餐廳不收小費，在桌上結帳時直接付'] },
    KR: { food: [['韓式烤肉', 'Korean barbecue'], ['部隊鍋', 'Budae-jjigae'], ['炸雞配啤酒', 'Chimaek']], culture: [['韓服體驗', 'Hanbok'], ['汗蒸幕', 'Jjimjilbang'], ['K-POP', 'K-pop']], buy: ['韓系美妝', '海苔', '蜂蜜奶油杏仁'], tips: ['叫車用 Kakao T，搭車用 T-money 卡', '多數店家一個人也能用餐，但烤肉店常要兩人份起'] },
    TH: { food: [['泰式酸辣蝦湯', 'Tom yum'], ['泰式炒河粉', 'Pad thai'], ['芒果糯米飯', 'Mango sticky rice']], culture: [['泰式按摩', 'Thai massage'], ['水上市場', 'Floating market'], ['潑水節', 'Songkran (Thailand)']], buy: ['香氛精油', '泰式奶茶', '乾燥水果'], tips: ['進寺廟要遮住肩膀與膝蓋', '不要摸別人的頭，也不要批評王室'] },
    VN: { food: [['越南河粉', 'Phở'], ['越式法國麵包', 'Bánh mì'], ['越南咖啡', 'Vietnamese iced coffee']], culture: [['奧黛', 'Áo dài'], ['水上木偶戲', 'Water puppetry'], ['斗笠', 'Nón lá']], buy: ['咖啡豆與滴漏壺', '腰果', '絲巾'], tips: ['過馬路慢慢走、不要突然停下或後退', '叫車用 Grab，比路邊攔車更好溝通價格'] },
    SG: { food: [['海南雞飯', 'Hainanese chicken rice'], ['辣椒螃蟹', 'Chilli crab'], ['叻沙', 'Laksa']], culture: [['小販中心', 'Hawker centre'], ['濱海灣超級樹', 'Supertree Grove'], ['魚尾獅', 'Merlion']], buy: ['肉骨茶包', '咖椰醬', '鹹蛋魚皮'], tips: ['地鐵上不能飲食，榴槤不能帶上車', '口香糖不能買賣，亂丟垃圾會被罰款'] },
    MY: { food: [['椰漿飯', 'Nasi lemak'], ['沙爹', 'Satay'], ['拉茶', 'Teh tarik']], culture: [['峇峇娘惹', 'Peranakan'], ['清真寺', 'Putra Mosque'], ['夜市', 'Pasar malam']], buy: ['白咖啡', '榴槤餅', '娘惹糕點'], tips: ['遞東西、吃東西用右手', '進清真寺要穿長袖長褲，女生要包頭巾'] },
    ID: { food: [['印尼炒飯', 'Nasi goreng'], ['仁當牛肉', 'Rendang'], ['巴東菜', 'Padang food']], culture: [['峇里島火舞', 'Kecak'], ['梯田灌溉', 'Subak (irrigation)'], ['蠟染', 'Batik']], buy: ['麝香貓咖啡', '蠟染布', '木雕'], tips: ['進峇里島寺廟要圍沙龍', '只喝瓶裝水，刷牙也建議用瓶裝水'] },
    PH: { food: [['阿斗波', 'Adobo'], ['烤乳豬', 'Lechon'], ['哈囉哈囉', 'Halo-halo']], culture: [['吉普尼', 'Jeepney'], ['跳島', 'Island hopping'], ['聖嬰節', 'Sinulog']], buy: ['芒果乾', '椰子油', '珍珠飾品'], tips: ['叫車用 Grab', '海島陽光強，防曬與防水袋要帶'] },
    HK: { food: [['港式點心', 'Dim sum'], ['菠蘿包', 'Pineapple bun'], ['燒鵝', 'Siu mei']], culture: [['茶餐廳', 'Cha chaan teng'], ['叮叮電車', 'Hong Kong Tramways'], ['幻彩詠香江', 'A Symphony of Lights']], buy: ['老婆餅', '雞仔餅', '涼茶'], tips: ['八達通卡搭車、便利商店都能用', '手扶梯靠右站，左邊讓人走'] },
    MO: { food: [['葡式蛋塔', 'Pastel de nata'], ['豬扒包', 'Pork chop bun'], ['杏仁餅', 'Almond biscuit']], culture: [['葡式碎石路', 'Portuguese pavement'], ['澳門歷史城區', 'Historic Centre of Macau'], ['路氹度假村', 'Cotai']], buy: ['杏仁餅', '肉乾', '蛋卷'], tips: ['酒店接駁巴士免費又方便', '港幣通用，但找零常是澳門幣'] },
    KH: { food: [['阿莫克魚', 'Fish amok'], ['柬式粿條湯', 'Kuy teav'], ['棕櫚糖', 'Palm sugar']], culture: [['吳哥窟日出', 'Angkor Wat'], ['嘟嘟車', 'Auto rickshaw'], ['仙女舞', 'Apsara Dance']], buy: ['貢布胡椒', '棕櫚糖', '絲綢圍巾'], tips: ['美金通用，小額找零常給瑞爾', '參觀吳哥窟要遮住肩膀與膝蓋'] },
    MV: { food: [['鮪魚椰子沙拉', 'Mas huni'], ['魚湯', 'Garudhiya'], ['熱帶水果', 'Coconut']], culture: [['水上屋', 'Water villa'], ['浮潛', 'Snorkeling'], ['發光海灘', 'Bioluminescence']], buy: ['漆器', '鮪魚乾'], tips: ['度假島可以喝酒，首都馬列禁酒', '當地是穆斯林國家，離開度假島穿著保守些'] },
    AU: { food: [['澳洲肉派', 'Meat pie'], ['帕芙洛娃', 'Pavlova'], ['小白咖啡', 'Flat white']], culture: [['無尾熊', 'Koala'], ['袋鼠', 'Kangaroo'], ['大堡礁', 'Great Barrier Reef']], buy: ['綿羊油', 'Tim Tam 餅乾', '蜂膠'], tips: ['陽光很強，防曬要擦足', '入境時食物、木製品都要申報'] },
    NZ: { food: [['麥蘆卡蜂蜜', 'Mānuka honey'], ['紐西蘭羊排', 'Lamb and mutton'], ['奇異果', 'Kiwifruit']], culture: [['毛利戰舞', 'Haka'], ['哈比屯', 'Hobbiton Movie Set'], ['高空彈跳', 'Bungee jumping']], buy: ['麥蘆卡蜂蜜', '美麗諾羊毛', '綿羊油'], tips: ['入境生鮮食品一定要申報，罰款很重', '天氣變化快，隨時帶外套'] },
    US: { food: [['漢堡', 'Hamburger'], ['紐約披薩', 'New York–style pizza'], ['美式烤肉', 'Barbecue in the United States']], culture: [['百老匯', 'Broadway theatre'], ['國家公園', 'Grand Canyon National Park'], ['職棒球賽', 'Major League Baseball']], buy: ['保健食品', 'Outlet 名牌', '球隊周邊'], tips: ['餐廳小費約 18–20%', '入境前要申請 ESTA'] },
    CA: { food: [['楓糖漿', 'Maple syrup'], ['肉汁起司薯條', 'Poutine'], ['冰酒', 'Ice wine']], culture: [['極光', 'Aurora'], ['洛磯山脈', 'Banff National Park'], ['冰上曲棍球', 'Ice hockey']], buy: ['楓糖製品', '冰酒', '煙燻鮭魚'], tips: ['小費約 15–20%', '冬天非常冷，洋蔥式穿搭'] },
    GB: { food: [['炸魚薯條', 'Fish and chips'], ['英式早餐', 'Full breakfast'], ['英式下午茶', 'Afternoon tea']], culture: [['衛兵交接', 'Changing of the Guard'], ['英式酒吧', 'Pub'], ['英超足球', 'Premier League']], buy: ['紅茶', '奶油酥餅', '博物館周邊'], tips: ['車輛靠左行駛，過馬路先看右邊', '大型博物館多數免費'] },
    FR: { food: [['可頌', 'Croissant'], ['馬卡龍', 'Macaron'], ['法式長棍', 'Baguette']], culture: [['巴黎咖啡館', 'Coffeehouse'], ['香水', 'Perfume'], ['法國葡萄酒', 'French wine']], buy: ['香水', '馬卡龍', '藥妝保養品'], tips: ['進店先說 Bonjour', '地鐵與觀光區小心扒手'] },
    IT: { food: [['拿坡里披薩', 'Neapolitan pizza'], ['義式冰淇淋', 'Gelato'], ['義大利麵', 'Pasta']], culture: [['文藝復興藝術', 'Italian Renaissance'], ['站著喝濃縮咖啡', 'Espresso'], ['威尼斯貢多拉', 'Gondola']], buy: ['橄欖油', '皮件', '檸檬酒'], tips: ['觀光區小心扒手', '教堂要遮住肩膀與膝蓋'] },
    ES: { food: [['西班牙海鮮飯', 'Paella'], ['Tapas 小菜', 'Tapas'], ['吉拿棒', 'Churros']], culture: [['佛朗明哥', 'Flamenco'], ['高第建築', 'Antoni Gaudí'], ['鬥牛場', 'Plaza de toros de Las Ventas']], buy: ['伊比利火腿', '橄欖油', '番紅花'], tips: ['晚餐 21 點後才熱鬧', '巴塞隆納觀光區小心扒手'] },
    DE: { food: [['德國豬腳', 'Schweinshaxe'], ['德國香腸', 'Bratwurst'], ['椒鹽卷餅', 'Pretzel']], culture: [['啤酒節', 'Oktoberfest'], ['聖誕市集', 'Christmas market'], ['新天鵝堡', 'Neuschwanstein Castle']], buy: ['小熊軟糖', '啤酒杯', '保養品'], tips: ['週日多數商店不營業', '不要走在自行車道上'] },
    CH: { food: [['起司火鍋', 'Fondue'], ['瑞士巧克力', 'Swiss chocolate'], ['烤起司', 'Raclette']], culture: [['冰河列車', 'Glacier Express'], ['馬特洪峰', 'Matterhorn'], ['瑞士製錶', 'Swiss watch']], buy: ['巧克力', '瑞士刀', '手錶'], tips: ['物價高，善用 Swiss Travel Pass', '水龍頭的水可以直接喝'] },
    NL: { food: [['焦糖煎餅', 'Stroopwafel'], ['生鯡魚', 'Soused herring'], ['高達起司', 'Gouda cheese']], culture: [['風車', 'Kinderdijk'], ['鬱金香', 'Tulip'], ['騎單車', 'Cycling in the Netherlands']], buy: ['起司', '木鞋', '焦糖煎餅'], tips: ['小心自行車道，車速很快', '很多地方只收卡不收現金'] },
    AT: { food: [['維也納炸豬排', 'Wiener schnitzel'], ['薩赫蛋糕', 'Sachertorte'], ['蘋果捲', 'Apple strudel']], culture: [['維也納咖啡館', 'Viennese coffee house'], ['古典音樂', 'Vienna Philharmonic'], ['哈修塔特', 'Hallstatt']], buy: ['莫札特巧克力球', '薩赫蛋糕', '水晶飾品'], tips: ['咖啡館坐多久都可以，結帳再叫服務生', '週日多數商店休息'] },
    CZ: { food: [['烤豬肉佐酸菜', 'Vepřo knedlo zelo'], ['煙囪捲', 'Trdelník'], ['皮爾森啤酒', 'Pilsner Urquell']], culture: [['天文鐘', 'Prague astronomical clock'], ['波希米亞水晶', 'Bohemian glass'], ['提線木偶', 'Marionette']], buy: ['水晶玻璃', '溫泉餅', '木偶'], tips: ['換匯認明「0% 手續費」，避開路邊換匯所', '啤酒常比水便宜'] },
    GR: { food: [['希臘沙拉', 'Greek salad'], ['希臘烤肉捲', 'Gyros'], ['希臘優格', 'Strained yogurt']], culture: [['帕德嫩神廟', 'Parthenon'], ['愛琴海跳島', 'Cyclades'], ['藍白小鎮', 'Santorini']], buy: ['橄欖油', '蜂蜜', '天然海綿'], tips: ['夏天很熱，中午避開戶外', '跳島船班旺季要提早訂'] },
    PT: { food: [['葡式蛋塔', 'Pastel de nata'], ['鹽漬鱈魚', 'Bacalhau'], ['波特酒', 'Port wine']], culture: [['法朵音樂', 'Fado'], ['花磚', 'Azulejo'], ['杜羅河谷', 'Douro Valley']], buy: ['花磚', '軟木製品', '沙丁魚罐頭'], tips: ['里斯本坡很多，穿好走的鞋', '晚餐時間偏晚'] },
    TR: { food: [['土耳其烤肉', 'Kebab'], ['土耳其軟糖', 'Turkish delight'], ['土耳其咖啡', 'Turkish coffee']], culture: [['土耳其浴', 'Hammam'], ['旋轉舞', 'Mevlevi Order'], ['藍眼睛', 'Nazar (amulet)']], buy: ['土耳其軟糖', '藍眼睛', '香料'], tips: ['進清真寺女生要包頭巾、遮住膝蓋', '市集殺價是常態'] },
    AE: { food: [['椰棗', 'Date palm'], ['沙威瑪', 'Shawarma'], ['駱駝奶', 'Camel milk']], culture: [['沙漠野營', 'Desert safari'], ['黃金市集', 'Gold Souk'], ['謝赫扎耶德清真寺', 'Sheikh Zayed Grand Mosque']], buy: ['椰棗', '香料', '駱駝奶巧克力'], tips: ['公共場合穿著保守', '齋戒月白天不要在公開場合飲食'] },
    TW: { food: [['珍珠奶茶', 'Bubble tea'], ['小籠包', 'Xiaolongbao'], ['夜市小吃', 'Night markets in Taiwan']], culture: [['九份', 'Jiufen'], ['台北 101', 'Taipei 101'], ['媽祖遶境', 'Mazu']], buy: ['鳳梨酥', '高山茶', '牛軋糖'], tips: ['這是你的出發地'] },
  };

  // 所有國家與地區（ISO 3166-1 alpha-2），探索世界用；名稱由瀏覽器依繁體中文顯示。
  const WORLD = {
    asia: 'JP KR CN TW HK MO MN KP TH VN SG MY ID PH KH LA MM BN TL',
    southasia: 'IN PK BD LK NP BT MV AF',
    mideast: 'AE SA QA KW BH OM YE JO IL PS LB SY IQ IR TR CY',
    centralasia: 'KZ UZ KG TJ TM GE AM AZ',
    europe: 'GB IE FR DE IT ES PT NL BE LU CH AT CZ SK PL HU SI HR BA RS ME MK AL GR BG RO MD UA BY RU EE LV LT FI SE NO DK IS MT AD MC SM VA LI XK',
    america: 'US CA MX GT BZ SV HN NI CR PA CU JM HT DO BS BB TT AG DM GD KN LC VC PR CO VE EC PE BO BR PY UY AR CL GY SR',
    oceania: 'AU NZ FJ PG SB VU NC PF WS TO KI TV NR MH FM PW GU',
    africa: 'EG MA DZ TN LY SD SS ET ER DJ SO KE UG TZ RW BI CD CG GA GQ CM CF TD NE NG BJ TG GH CI LR SL GN GW SN GM ML BF MR CV ST AO ZM ZW MW MZ MG MU SC KM NA BW ZA LS SZ RE',
  };

  // 中等預算每人每天的花費（住宿、餐飲、交通，新台幣，概估）。
  const DAY_COST = {
    JP: 4500, KR: 3800, TH: 2500, VN: 2200, SG: 5200, MY: 2600, ID: 2800, PH: 2600, HK: 5000, MO: 4800, KH: 2200, MV: 12000,
    AU: 6200, NZ: 6200, US: 7800, CA: 6800, GB: 7500, FR: 7200, IT: 6500, ES: 5600, DE: 6200, CH: 9500, NL: 7000, AT: 6200,
    CZ: 4600, GR: 5600, PT: 5200, TR: 4200, AE: 7200,
  };

  const HOMES = {
    TPE: { name: '台北', lat: 25.08, lng: 121.23, n: '158' },
    RMQ: { name: '台中', lat: 24.26, lng: 120.62, n: '158' },
    KHH: { name: '高雄', lat: 22.58, lng: 120.35, n: '158' },
  };

  global.TRAVEL_DATA = {
    ELEMENTS, REGIONS, RATES, COUNTRIES, DESTS, PACKS, HOMES, WIKI, PLAN_TYPES, POLICY, CULTURE, WORLD, DAY_COST,
  };
}(typeof window !== 'undefined' ? window : globalThis));
