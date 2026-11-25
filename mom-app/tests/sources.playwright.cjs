// 資料來源測試：每一則衛教知識都有可點擊的官方／專業來源與一句小註解；來源只來自官方或專業網域、都是 https、
// 新分頁開啟；好孕群島小知識、注意事項、新手教學、問答、健康頁面底部、PDF 手冊（印出網址）都有；「資料來源」頁列出全部。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/sources.playwright.cjs   [BASE=...]
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
// official and professional domains only (anything else would be a sign of a made-up link)
const OFFICIAL = /^https:\/\/([a-z0-9-]+\.)*(gov\.tw|gov\.taipei|who\.int|cdc\.gov|healthychildren\.org|aap\.org|acog\.org|org\.tw|nih\.gov|nhs\.uk|unicef\.org|edu\.tw)(\/|$)/i;

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const ctx = await browser.newContext({ ...devices['iPhone 13'], locale: 'zh-TW' });
  await ctx.addInitScript(() => { window.__noShareMoments = true; window.__noNightAuto = true; });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(e.message));
  const S = (f, a) => p.evaluate(f, a);
  await p.goto(BASE); await p.waitForFunction(() => window.App && App.store && !App.store.loading && App.src && App.SOURCES);
  const top = () => S(() => { const all = document.querySelectorAll('.sheet'); return all[all.length - 1] || null; });
  const esc = async () => { for (let i = 0; i < 3; i += 1) { if (!(await S(() => document.body.classList.contains('has-sheet')))) break; await p.keyboard.press('Escape'); await p.waitForTimeout(300); } };

  /* ---------- 1. the registry ---------- */
  const reg = await S(() => {
    const A = window.App; const src = Object.entries(A.SOURCES);
    const used = new Set(Object.values(A.SOURCE_MAP).flat().map((x) => (typeof x === 'string' ? x : x.s)));
    return {
      n: src.length, urls: src.filter(([, s]) => s.kind !== 'media').map(([, s]) => s.url), noTitle: src.filter(([, s]) => !s.title || !s.org).map(([k]) => k),
      news: src.filter(([, s]) => s.kind === 'media').map(([, s]) => s.url),
      // news and summaries add the latest amounts; something official is always cited with them
      newsOnly: Object.entries(A.SOURCE_MAP).filter(([, v]) => v.length && v.every((x) => (A.SOURCES[typeof x === 'string' ? x : x.s] || {}).kind === 'media')).map(([k]) => k),
      unused: src.filter(([k]) => !used.has(k)).map(([k]) => k),
      dangling: Object.entries(A.SOURCE_MAP).filter(([, v]) => !v.length || v.some((x) => !A.SOURCES[typeof x === 'string' ? x : x.s])).map(([k]) => k),
      longNotes: Object.values(A.SOURCE_MAP).flat().filter((x) => x.n && x.n.length > 30).map((x) => x.n),
    };
  });
  ok(`${reg.n} sources, each with an organisation and a title`, reg.n >= 15 && !reg.noTitle.length, reg.noTitle.join(','));
  const bad = reg.urls.filter((u) => !OFFICIAL.test(u));
  ok('every link is https on an official or professional site (政府、WHO、CDC、AAP、ACOG、學會)', !bad.length, bad.join(' '));
  ok('news and summaries (新聞與整理) are https, and never the only source for anything', reg.news.every((u) => /^https:\/\//.test(u)) && !reg.newsOnly.length, reg.newsOnly.join(','));
  ok('every source is used, and every citation points at a real source', !reg.unused.length && !reg.dangling.length, `unused ${reg.unused.join(',')} dangling ${reg.dangling.join(',')}`);
  ok('the small notes stay small (≤ 30 字)', !reg.longNotes.length, reg.longNotes.slice(0, 3).join(' | '));

  /* ---------- 2. coverage ---------- */
  const cov = await S(() => {
    const A = window.App; const M = A.SOURCE_MAP; const I = A.ISLAND;
    const cards = []; I.SPOTS.filter((s) => !s.brand).forEach((s) => s.cards.forEach((c, i) => cards.push(`card:${s.id}:${i}`)));
    const notes = []; I.ISLANDS.forEach((isl) => isl.notes.forEach((n, i) => notes.push(`note:${isl.id}:${i}`)));
    const guides = I.ISLANDS.map((isl) => `guide:${isl.id}`);
    const faqs = A.FAQ.map((f) => `faq:${f.id}`);
    const pct = (list) => Math.round((list.filter((k) => M[k]).length / list.length) * 100);
    return { cards: pct(cards), notes: pct(notes), guides: pct(guides), faqs: pct(faqs), screens: ['vaccines', 'checkups', 'milestones', 'growth', 'prenatal', 'weeks'].filter((k) => !M[k]) };
  });
  ok('好孕群島: ≥ 90% of knowledge cards, every 注意事項 and every 新手教學 have sources', cov.cards >= 90 && cov.notes === 100 && cov.guides === 100, JSON.stringify(cov));
  ok('問答: ≥ 90% of answers have sources', cov.faqs >= 90, `${cov.faqs}%`);
  ok('vaccines, checkups, milestones, growth, prenatal schedule and pregnancy weeks all have sources', !cov.screens.length, cov.screens.join(','));

  /* ---------- 3. in the app ---------- */
  await S(() => { App.demo.seed(); App.store.update((s) => { s.settings.a2hsDismissed = '1'; s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1, preg3: 1, newborn: 1, infant: 1 }, toured: '1' }; }); });
  await S(() => App.island.openSpot('vaccine')); await p.waitForTimeout(500);
  const spot = await S(() => { const sh = [...document.querySelectorAll('.sheet')].pop(); return { marks: sh.querySelectorAll('.isl-know .src-mark').length, links: [...sh.querySelectorAll('.src-foot a.src-link')].map((a) => ({ href: a.href, target: a.target, rel: a.rel })), notes: sh.querySelectorAll('.src-foot .src-note').length }; });
  const mapped = await S(() => App.ISLAND.SPOTS.find((x) => x.id === 'vaccine').cards.filter((c, i) => App.src.refs(`card:vaccine:${i}`).length).length);
  ok('a stop (疫苗站): every card with a source ends with its number, and the 資料來源 list under it', mapped >= 3 && spot.marks === mapped && spot.links.length >= 1 && spot.notes >= 1, `${mapped} mapped; ${JSON.stringify(spot).slice(0, 160)}`);
  ok('…the sources open in a new tab (target=_blank, rel=noopener)', spot.links.every((l) => l.target === '_blank' && /noopener/.test(l.rel) && /^https:/.test(l.href)));
  const tapSize = await S(() => { const a = [...document.querySelectorAll('.sheet')].pop().querySelector('.src-foot a.src-link'); const r = a.getBoundingClientRect(); return Math.round(r.height); });
  ok('…and are big enough to tap', tapSize >= 24, `${tapSize}px`);
  await esc();
  await S(() => App.island.openIsland('infant')); await p.waitForTimeout(500);
  const isl = await S(() => { const sh = [...document.querySelectorAll('.sheet')].pop(); return { notes: sh.querySelectorAll('.isl-note .src-mark').length, all: sh.querySelectorAll('.isl-note').length, guide: !!sh.querySelector('.isl-guide .src-mark'), foot: !!sh.querySelector('.src-foot') }; });
  ok('an island: every 注意事項 and the 新手教學 are numbered, with the list at the bottom', isl.notes === isl.all && isl.guide && isl.foot, JSON.stringify(isl));
  await esc();
  await S(() => App.search && App.search.openFaq ? App.search.openFaq(App.FAQ[0].id) : null); await p.waitForTimeout(500);
  const faq = await S(() => { const sh = [...document.querySelectorAll('.sheet')].pop(); return sh ? { mark: !!sh.querySelector('.sr-ans .src-mark'), foot: sh.querySelectorAll('.src-foot a').length } : null; });
  ok('問答: the answer is numbered and its sources are listed', faq && faq.mark && faq.foot >= 1, JSON.stringify(faq));
  await esc();
  for (const id of ['vaccines', 'growth', 'milestones', 'checkups']) {
    await S((x) => App.navigate(x), id); await p.waitForTimeout(600);
    ok(`「${id}」 page: 資料來源 at the bottom`, await S(() => !!document.querySelector('#view .src-foot a.src-link')));
  }
  await S(() => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.settings.a2hsDismissed = '1'; s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -150)); s.profile.edd = Core.eddFromLmp(s.profile.lmp); App.store.replace(s); App.navigate('prenatal'); });
  await p.waitForTimeout(600);
  ok('產檢時程: 資料來源 at the bottom', await S(() => !!document.querySelector('#view .src-foot a.src-link')));
  // the printed handbook spells out the web addresses
  await S(() => App.navigate('island-guide', { island: 'preg2' })); await p.waitForTimeout(700);
  await p.emulateMedia({ media: 'print' });
  const pr = await S(() => { const u = [...document.querySelectorAll('.isl-doc .src-url')]; return { n: u.length, shown: u.filter((e) => getComputedStyle(e).display !== 'none').length, http: u.every((e) => /^https:\/\//.test(e.textContent)) }; });
  ok('島嶼手冊 printed: each source shows its full web address', pr.n >= 1 && pr.shown === pr.n && pr.http, JSON.stringify(pr));
  await p.emulateMedia({ media: 'screen' });
  // every source in one place
  await S(() => App.navigate('sources')); await p.waitForTimeout(600);
  const page = await S(() => ({ links: document.querySelectorAll('#view .src-item a.src-link').length, n: Object.keys(App.SOURCES).length }));
  ok('我的 → 資料來源: every source, tappable, with how many places cite it', page.links === page.n && page.n > 0, JSON.stringify(page));
  await S(() => App.navigate('me')); await p.waitForTimeout(500);
  ok('我的 has the 「📚 資料來源」 button', await S(() => [...document.querySelectorAll('button')].some((b) => /資料來源/.test(b.textContent))));

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 資料來源 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
