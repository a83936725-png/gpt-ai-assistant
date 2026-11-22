/* eslint-disable no-await-in-loop, no-restricted-syntax, no-console, object-curly-newline, quote-props */
/**
 * Builds web/travel-photos.json: a photo for every destination and attraction in web/travel-data.js.
 * Each photo is the lead image of an English Wikipedia article (a Wikimedia Commons file), with its
 * author and license so the page can credit it.
 *
 *   node scripts/travel-photos.js
 *
 * Run it again after adding destinations or attractions, then check the list it prints for misses.
 */
import { readFileSync, writeFileSync } from 'fs';
import path from 'path';

const ROOT = process.cwd();
const API = 'https://en.wikipedia.org/w/api.php';
const HEADERS = { 'User-Agent': 'TravelPhotoManifest/1.0 (one-off build script; low volume)' };
const OUT = path.join(ROOT, 'web', 'travel-photos.json');

// English Wikipedia articles to try, in order. Cover photos pick an iconic landmark rather than the
// city article, whose lead image is often a collage.
const TITLES = {
  tokyo: { cover: ['Tokyo Tower'], spots: { 淺草寺: ['Sensō-ji'], 'SHIBUYA SKY': ['Shibuya Scramble Square', 'Shibuya Crossing'], '東京晴空塔 天望甲板': ['Tokyo Skytree'], 'teamLab Planets': ['TeamLab Planets', 'Toyosu'], 築地場外市場: ['Tsukiji Outer Market', 'Tsukiji fish market'] } },
  hakone: { cover: ['Lake Ashi'], spots: { 箱根神社: ['Hakone Shrine'], 大涌谷: ['Ōwakudani'], '箱根周遊券（新宿出發 2 日）': ['Hakone Tozan Railway', 'Hakone Ropeway'], 蘆之湖海賊船: ['Hakone Sightseeing Cruise', 'Lake Ashi'] } },
  kawaguchiko: { cover: ['Lake Kawaguchi'], spots: { 大石公園: ['Lake Kawaguchi'], 新倉山淺間公園: ['Arakurayama Sengen Park', 'Chureito Pagoda', 'Fujiyoshida'], 河口湖富士山全景纜車: ['Mount Fuji'] } },
  kyoto: { cover: ['Hōkan-ji', 'Kyoto'], spots: { 伏見稻荷大社: ['Fushimi Inari-taisha'], 清水寺: ['Kiyomizu-dera'], 金閣寺: ['Kinkaku-ji'], 嵐山竹林小徑: ['Sagano Bamboo Forest', 'Arashiyama'] } },
  osaka: { cover: ['Osaka Castle'], spots: { 道頓堀: ['Dōtonbori'], 大阪城天守閣: ['Osaka Castle'], 日本環球影城: ['Universal Studios Japan'], 海遊館: ['Osaka Aquarium Kaiyukan'] } },
  nara: { cover: ['Tōdai-ji'], spots: { 奈良公園: ['Nara Park'], 東大寺大佛殿: ['Tōdai-ji'], 春日大社: ['Kasuga-taisha'] } },
  sapporo: { cover: ['Sapporo Snow Festival', 'Sapporo'], spots: { 二條市場: ['Nijō Market', 'Sapporo'], 小樽運河: ['Otaru Canal', 'Otaru Canal (Hokkaido)', 'Otaru'], 登別地獄谷: ['Jigokudani (Noboribetsu)', 'Noboribetsu Jigokudani', 'Noboribetsu Onsen'], 旭山動物園: ['Asahiyama Zoo'] } },
  okinawa: { cover: ['Manzamo', 'Kerama Islands', 'Okinawa Island'], spots: { 沖繩美麗海水族館: ['Okinawa Churaumi Aquarium'], 古宇利島: ['Kōri Island', 'Kouri Island', 'Kerama Islands'], 國際通: ['Makishi Public Market', 'Tsuboya pottery', 'Shuri Castle'], 首里城公園: ['Shuri Castle'] } },
  fukuoka: { cover: ['Fukuoka Tower', 'Fukuoka'], spots: { 中洲屋台: ['Nakasu', 'Yatai (food cart)'], 太宰府天滿宮: ['Dazaifu Tenman-gū'], 福岡塔: ['Fukuoka Tower'] } },
  kanazawa: { cover: ['Kenroku-en'], spots: { 兼六園: ['Kenroku-en'], 東茶屋街: ['Higashi Chaya District', 'Higashi Chaya', 'Kanazawa Castle'], '金澤 21 世紀美術館': ['21st Century Museum of Contemporary Art, Kanazawa'] } },
  seoul: { cover: ['Gyeongbokgung'], spots: { 景福宮: ['Gyeongbokgung'], 明洞: ['Myeong-dong'], 聖水洞: ['Seongsu-dong'], 'N 首爾塔 展望台': ['N Seoul Tower'] } },
  busan: { cover: ['Gamcheon Culture Village', 'Busan'], spots: { 甘川洞文化村: ['Gamcheon Culture Village'], 海雲台: ['Haeundae Beach'], 札嘎其市場: ['Jagalchi Market'], 海東龍宮寺: ['Haedong Yonggungsa'] } },
  jeju: { cover: ['Seongsan Ilchulbong'], spots: { 城山日出峰: ['Seongsan Ilchulbong'], 漢拏山: ['Hallasan'], 牛島渡輪: ['Udo (island)', 'Udo, Jeju'] } },
  bangkok: { cover: ['Wat Arun'], spots: { 大皇宮: ['Grand Palace'], 臥佛寺: ['Wat Pho'], 鄭王廟: ['Wat Arun'], 喬德夜市: ['Jodd Fairs', 'Chatuchak Weekend Market'] } },
  chiangmai: { cover: ['Wat Phra That Doi Suthep'], spots: { 素帖寺: ['Wat Phra That Doi Suthep'], 清邁古城: ['Tha Phae Gate', 'Chiang Mai'], 大象保護營: ['Elephant Nature Park'] } },
  phuket: { cover: ['Phi Phi Islands'], spots: { 皮皮島一日遊: ['Phi Phi Islands'], 芭東海灘: ['Patong'], 普吉老城: ['Phuket City'] } },
  danang: { cover: ['Golden Bridge (Vietnam)', 'Da Nang'], spots: { '巴拿山（含纜車）': ['Golden Bridge (Vietnam)', 'Bà Nà Hills'], 美溪沙灘: ['Mỹ Khê Beach', 'Da Nang'], 會安古鎮: ['Hội An Ancient Town', 'Hội An', 'Hoi An'] } },
  hanoi: { cover: ['Hoàn Kiếm Lake'], spots: { 還劍湖: ['Hoàn Kiếm Lake'], 文廟: ['Temple of Literature, Hanoi'], 下龍灣一日遊: ['Hạ Long Bay'], 三十六古街: ['Old Quarter (Hanoi)', 'Hanoi Old Quarter', 'Hanoi'] } },
  hcmc: { cover: ['Saigon Notre-Dame Basilica'], spots: { 濱城市場: ['Bến Thành Market'], 西貢聖母大教堂: ['Saigon Notre-Dame Basilica'], 古芝地道: ['Củ Chi tunnels'] } },
  phuquoc: { cover: ['Phú Quốc'], spots: { 香島跨海纜車: ['Hòn Thơm Cable Car', 'Phú Quốc'], 'VinWonders 樂園': ['VinWonders Phu Quoc', 'Phú Quốc'], 長灘: ['Phú Quốc'] } },
  singapore: { cover: ['Marina Bay Sands'], spots: { '濱海灣花園（戶外區）': ['Gardens by the Bay'], '雲霧林＋花穹': ['Cloud Forest (Gardens by the Bay)', 'Flower Dome', 'Gardens by the Bay'], 新加坡環球影城: ['Universal Studios Singapore'], 牛車水: ['Chinatown, Singapore'] } },
  kl: { cover: ['Petronas Towers', 'Kuala Lumpur City Centre'], spots: { '雙子星塔 觀景台': ['Petronas Towers', 'Kuala Lumpur City Centre'], 黑風洞: ['Batu Caves'], 亞羅街夜市: ['Jalan Alor'] } },
  penang: { cover: ['George Town, Penang'], spots: { 喬治市壁畫街: ['Street art in George Town', 'George Town, Penang'], 升旗山纜車: ['Penang Hill'], 新關仔角小販中心: ['Gurney Drive'] } },
  bali: { cover: ['Tanah Lot'], spots: { 德格拉朗梯田: ['Tegallalang', 'Subak (irrigation)'], 海神廟: ['Tanah Lot'], 金巴蘭海灘: ['Jimbaran'] } },
  cebu: { cover: ['Chocolate Hills'], spots: { 薄荷島巧克力山: ['Chocolate Hills'], 歐斯陸賞鯨鯊: ['Oslob, Cebu', 'Whale shark'], 麥哲倫十字架: ["Magellan's Cross"] } },
  hongkong: { cover: ['Victoria Harbour'], spots: { 太平山頂纜車: ['Peak Tram'], 維多利亞港: ['Victoria Harbour'], 天星小輪: ['Star Ferry'], 深水埗: ['Sham Shui Po'] } },
  macau: { cover: ["Ruins of St. Paul's"], spots: { 大三巴牌坊: ["Ruins of St. Paul's"], 議事亭前地: ['Senado Square'], 澳門塔觀光層: ['Macau Tower'] } },
  siemreap: { cover: ['Angkor Wat'], spots: { '吳哥通行證（1 日）': ['Angkor Wat'], 塔布蘿寺: ['Ta Prohm'], 洞里薩湖: ['Tonlé Sap'] } },
  maldives: { cover: ['Malé Atoll', 'Maldives', 'Tourism in the Maldives'], spots: { 浮潛看魟魚: ['Reef manta ray', 'Maldives'], 沙洲野餐: ['Tourism in the Maldives', 'Maldives'], 水上屋: ['Tourism in the Maldives', 'Maldives'] } },
  sydney: { cover: ['Sydney Opera House'], spots: { 雪梨歌劇院導覽: ['Sydney Opera House'], 邦代海灘: ['Bondi Beach'], 藍山國家公園: ['Three Sisters (Australia)', 'Blue Mountains National Park'] } },
  melbourne: { cover: ['Flinders Street railway station', 'Melbourne'], spots: { 大洋路: ['Twelve Apostles (Victoria)', 'Great Ocean Road'], 菲利普島企鵝歸巢: ['Phillip Island'], 巷弄咖啡: ['Hosier Lane'] } },
  queenstown: { cover: ['Milford Sound'], spots: { 米佛峽灣遊船: ['Milford Sound'], 天際線纜車: ['Skyline Queenstown', "Bob's Peak"], 卡瓦勞高空彈跳: ['Kawarau Gorge Suspension Bridge'] } },
  nyc: { cover: ['Brooklyn Bridge'], spots: { 中央公園: ['Central Park'], 大都會博物館: ['Metropolitan Museum of Art'], 帝國大廈: ['Empire State Building'], 時代廣場: ['Times Square'] } },
  la: { cover: ['Hollywood Sign'], spots: { 好萊塢星光大道: ['Hollywood Walk of Fame'], 好萊塢環球影城: ['Universal Studios Hollywood'], 蓋提中心: ['Getty Center'], 聖塔莫尼卡: ['Santa Monica Pier'] } },
  honolulu: { cover: ['Waikiki'], spots: { 威基基海灘: ['Waikiki'], 鑽石頭山: ['Diamond Head, Hawaii'], 珍珠港亞利桑那紀念館: ['USS Arizona Memorial'] } },
  vancouver: { cover: ['Stanley Park'], spots: { 史丹利公園: ['Stanley Park'], 卡皮拉諾吊橋: ['Capilano Suspension Bridge'], '惠斯勒 Peak 2 Peak': ['Peak 2 Peak Gondola'] } },
  london: { cover: ['Tower Bridge'], spots: { 大英博物館: ['British Museum'], 倫敦塔: ['Tower of London'], 倫敦塔橋展覽: ['Tower Bridge'], 柯芬園: ['Covent Garden'] } },
  paris: { cover: ['Eiffel Tower'], spots: { 羅浮宮: ['Louvre'], '艾菲爾鐵塔（電梯到頂）': ['Eiffel Tower'], 凡爾賽宮: ['Palace of Versailles'], 蒙馬特: ['Montmartre'] } },
  rome: { cover: ['Colosseum'], spots: { '羅馬競技場＋古羅馬廣場': ['Colosseum'], 梵蒂岡博物館: ['Vatican Museums'], 特雷維噴泉: ['Trevi Fountain'] } },
  barcelona: { cover: ['Sagrada Família'], spots: { 聖家堂: ['Sagrada Família'], 奎爾公園: ['Park Güell'], 波格利亞市場: ['La Boqueria'] } },
  prague: { cover: ['Charles Bridge'], spots: { 查理大橋: ['Charles Bridge'], 布拉格城堡: ['Prague Castle'], 舊城廣場: ['Old Town Square'] } },
  vienna: { cover: ['Schönbrunn Palace'], spots: { '美泉宮（完整導覽）': ['Schönbrunn Palace'], 史蒂芬大教堂: ["St. Stephen's Cathedral, Vienna"], 國家歌劇院導覽: ['Vienna State Opera'] } },
  interlaken: { cover: ['Jungfrau'], spots: { '少女峰（來回火車）': ['Jungfraujoch'], 布里恩茨湖: ['Lake Brienz'], 勞特布倫嫩瀑布谷: ['Lauterbrunnen'] } },
  amsterdam: { cover: ['Canals of Amsterdam'], spots: { 梵谷博物館: ['Van Gogh Museum'], 運河遊船: ['Canals of Amsterdam'], 庫肯霍夫花園: ['Keukenhof'] } },
  santorini: { cover: ['Oia, Greece', 'Santorini'], spots: { 伊亞夕陽: ['Oia, Greece'], 費拉: ['Fira'], 紅沙灘: ['Red Beach (Santorini)', 'Santorini'] } },
  lisbon: { cover: ['Belém Tower'], spots: { 貝倫塔: ['Belém Tower'], '28 號電車': ['Lisbon tramway route 28', 'Trams in Lisbon'], 辛特拉佩納宮: ['Pena Palace'] } },
  istanbul: { cover: ['Hagia Sophia'], spots: { 藍色清真寺: ['Sultan Ahmed Mosque'], 聖索菲亞大教堂: ['Hagia Sophia'], 大巴扎: ['Grand Bazaar, Istanbul'] } },
  cappadocia: { cover: ['Cappadocia'], spots: { 熱氣球: ['Cappadocia', 'Göreme'], 格雷梅露天博物館: ['Göreme Open Air Museum', 'Göreme National Park'], 地下城: ['Derinkuyu underground city'] } },
  dubai: { cover: ['Burj Khalifa'], spots: { 'Burj Khalifa At the Top': ['Burj Khalifa'], '哈里發塔 At the Top': ['Burj Khalifa'], 沙漠衝沙: ['Dune bashing', 'Desert safari'], 杜拜購物中心: ['The Dubai Mall'], 杜拜噴泉: ['The Dubai Fountain'] } },
};

// Lead images that are maps, logos or diagrams make poor travel photos.
// When an article's lead image is one of those, the first real photo in the article is used instead.
const BAD_FILE = /\.svg$|logo|map|locator|location|flag|coat[_ ]of[_ ]arms|seal|emblem|diagram|plan\b|icon|montage|collage|satellite|ISS\d/i;
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const chunks = (list, size) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, i * size + size));
const stripHtml = (html = '') => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Wikimedia answers 429 when requests come too fast, so wait and retry.
const getJson = async (url, { optional = false } = {}) => {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) return res.json();
    if (res.status === 404 && optional) return null;
    if (res.status !== 429 && res.status < 500) throw new Error(`Wikipedia ${res.status} for ${url}`);
    await sleep(3000 * (attempt + 1));
  }
  throw new Error('Wikipedia kept refusing requests; try again in a few minutes');
};
const query = (params) => getJson(`${API}?${new URLSearchParams({ action: 'query', format: 'json', formatversion: '2', ...params })}`);

// Article title -> lead image file name (following redirects).
const leadImages = async (titles) => {
  const out = new Map();
  for (const batch of chunks(titles, 40)) {
    const data = await query({ prop: 'pageimages', piprop: 'name', titles: batch.join('|'), redirects: '1' });
    const alias = new Map();
    (data.query.normalized || []).forEach(({ from, to }) => alias.set(to, from));
    (data.query.redirects || []).forEach(({ from, to }) => alias.set(to, alias.get(from) || from));
    (data.query.pages || []).forEach((page) => {
      if (!page.pageimage) return;
      let original = page.title;
      while (alias.has(original)) original = alias.get(original);
      out.set(original, page.pageimage);
      out.set(page.title, page.pageimage);
    });
    await sleep(800);
  }
  return out;
};

// First photo in an article, in page order (REST media list), skipping maps, logos and flags.
const firstPhoto = async (title) => {
  const data = await getJson(`https://en.wikipedia.org/api/rest_v1/page/media-list/${encodeURIComponent(title.replace(/ /g, '_'))}`, { optional: true });
  await sleep(700);
  if (!data) return null;
  const item = (data.items || []).find((it) => it.type === 'image' && /\.(jpe?g)$/i.test(it.title || '') && !BAD_FILE.test(it.title));
  return item ? item.title.replace(/^File:/, '').replace(/ /g, '_') : null;
};

// File name -> 1280px rendition, Commons page, author and license.
const fileInfo = async (files) => {
  const out = new Map();
  for (const batch of chunks(files, 40)) {
    const data = await query({
      prop: 'imageinfo', iiprop: 'url|extmetadata|size', iiurlwidth: '1280', titles: batch.map((f) => `File:${f}`).join('|'),
    });
    (data.query.pages || []).forEach((page) => {
      const info = page.imageinfo?.[0];
      if (!info?.thumburl) return;
      const meta = info.extmetadata || {};
      // Only freely licensed photos can be copied into the project.
      if (meta.NonFree?.value === 'true') return;
      out.set(page.title.replace(/^File:/, '').replace(/ /g, '_'), {
        src: info.thumburl,
        width: info.thumbwidth,
        height: info.thumbheight,
        page: info.descriptionurl,
        author: stripHtml(meta.Artist?.value).slice(0, 80),
        license: stripHtml(meta.LicenseShortName?.value),
      });
    });
    await sleep(800);
  }
  return out;
};

const main = async () => {
  new Function(readFileSync(path.join(ROOT, 'web', 'travel-data.js'), 'utf8'))(); // eslint-disable-line no-new-func
  const { DESTS, CULTURE } = globalThis.TRAVEL_DATA;
  const wanted = [];
  // Famous food and culture of each country, shown when a country is opened.
  Object.entries(CULTURE).forEach(([code, c]) => [...c.food, ...c.culture].forEach(([name, title]) => {
    wanted.push({ key: `culture:${code}:${name}`, titles: [title] });
  }));
  DESTS.forEach((d) => {
    const entry = TITLES[d.id] || { cover: [], spots: {} };
    wanted.push({ key: `dest:${d.id}`, titles: entry.cover.length ? entry.cover : [d.name] });
    d.spots.forEach((s) => wanted.push({ key: `spot:${d.id}:${s.name}`, titles: entry.spots[s.name] || [] }));
  });
  const titles = [...new Set(wanted.flatMap((w) => w.titles))];
  console.log(`Looking up ${titles.length} articles…`);
  const images = await leadImages(titles);
  // Titles are tried in order: an article's lead image, or its first real photo, before the next title.
  const fallback = new Map();
  const chosen = new Map();
  for (const w of wanted) {
    for (const t of w.titles) {
      const lead = images.get(t);
      let file = lead && !BAD_FILE.test(lead) ? lead : null;
      if (!file) {
        if (!fallback.has(t)) fallback.set(t, await firstPhoto(t));
        file = fallback.get(t);
      }
      if (file) { chosen.set(w.key, file); break; }
    }
  }
  const pick = (w) => chosen.get(w.key);
  const files = [...new Set(wanted.map(pick).filter(Boolean))];
  console.log(`Reading ${files.length} photos…`);
  const info = await fileInfo(files);
  const photos = {};
  const missing = [];
  wanted.forEach((w) => {
    const file = pick(w);
    const photo = file && info.get(file.replace(/ /g, '_'));
    if (photo) photos[w.key] = { ...photo, file };
    else missing.push(`${w.key} (${w.titles.join(' / ') || 'no title'})`);
  });
  writeFileSync(OUT, `${JSON.stringify({ source: 'Wikimedia Commons via English Wikipedia', generated: new Date().toISOString().slice(0, 10), photos }, null, 1)}\n`);
  console.log(`Wrote ${Object.keys(photos).length} photos to ${path.relative(ROOT, OUT)}`);
  if (missing.length) console.log(`No photo for ${missing.length}:\n  ${missing.join('\n  ')}`);
};

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
