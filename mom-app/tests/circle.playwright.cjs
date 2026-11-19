// 同週好孕圈 (needs the member API): moms in the same due-date week and in other circles, each in their own browser.
// Usage: (repo root) MOM_TRUST_PROXY=1 APP_PORT=8790 node api/index.js   then   node mom-app/tests/circle.playwright.cjs
//        BASE=http://localhost:8790/mom-app/  STATIC_BASE=<static-only host, for the offline state>  AXE_PATH=<axe.min.js>
const { chromium, devices } = require('playwright');
const fs = require('fs');
const BASE = process.env.BASE || 'http://localhost:8790/mom-app/';
const STATIC_BASE = process.env.STATIC_BASE || '';
const AXE = process.env.AXE_PATH || '';
const results = []; const errors = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info: String(info).slice(0, 300) });
const S = (p, f, a) => p.evaluate(f, a);
const ip = () => `10.${1 + Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`;
const WEEKS = 12 + Math.floor(Math.random() * 20); // a random circle each run, so earlier runs rarely share it

(async () => {
  const b = await chromium.launch();
  const mk = async (who, { base = BASE, scheme = 'light', device = 'iPhone 13' } = {}) => {
    const ctx = await b.newContext({
      ...devices[device], locale: 'zh-TW', reducedMotion: 'reduce', colorScheme: scheme, extraHTTPHeaders: { 'X-Forwarded-For': ip() },
    });
    await ctx.addInitScript(() => { window.__noShareMoments = true; });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(`${who}: ${e.message}`));
    p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push(`${who}: ${m.text()}`); });
    p.sent = [];
    p.on('request', (r) => { if (/\/api\/circle/.test(r.url())) p.sent.push({ url: r.url(), body: r.postData() || '' }); });
    await p.goto(base); await p.waitForFunction(() => window.App && App.circle && App.social);
    return p;
  };
  const preg = (p, weeks, opts = {}) => S(p, ([w, o]) => {
    const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'preg'; s.profile.momName = '小美'; s.settings.a2hsDismissed = '1';
    s.island = { stamps: {}, quiz: {}, visited: {}, seen: { prep: 1, preg1: 1, preg2: 1, preg3: 1 }, toured: '1' };
    if (!o.noDate) { s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(w * 7))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); }
    App.store.replace(s);
  }, [weeks, opts]);
  const baby = (p, days) => S(p, (d) => {
    const s = App.store.defaults(); s.onboarded = true; s.onboardedAt = '2026-01-01'; s.profile.stage = 'baby'; s.settings.a2hsDismissed = '1';
    s.babies = [{ id: 'b1', name: '小湯圓', sex: 'girl', birthday: Core.dateKey(Core.addDays(new Date(), -d)) }]; s.activeBabyId = 'b1';
    App.store.replace(s);
  }, days);
  const go = async (p, id, wait = 1000) => { await S(p, (x) => App.navigate(x, { n: Math.random() }), id); await p.waitForTimeout(wait); };
  const text = (p, sel = '#view') => S(p, (q) => (document.querySelector(q) || {}).innerText || '', sel);
  const toasts = (p) => S(p, () => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
  const axe = async (p, label) => {
    if (!AXE || !fs.existsSync(AXE)) return;
    await p.addScriptTag({ path: AXE }).catch(() => {});
    const v = await S(p, async () => (await window.axe.run(document, { runOnly: ['wcag2a', 'wcag2aa'], resultTypes: ['violations'] })).violations
      .filter((x) => ['serious', 'critical'].includes(x.impact)).map((x) => `${x.id}: ${x.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | ')}`));
    ok(`a11y: ${label}`, !v.length, v.join(' || '));
  };
  const smallTaps = (p) => S(p, () => [...document.querySelectorAll('#view button, #view a')].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.width < 40 || r.height < 40) && !e.classList.contains('link-btn'); })
    .map((e) => `${(e.getAttribute('aria-label') || e.textContent).trim().slice(0, 12)} ${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
  const members = (p) => S(p, async () => { await App.circle.sync({ quiet: true }); return App.circle.live().members; });

  /* ---------- joining ---------- */
  const A = await mk('A'); await preg(A, WEEKS);
  await go(A, 'home', 2500);
  const nudge = await S(A, () => (document.querySelector('.cc-home') || {}).textContent || '');
  ok('首頁 invites to 同週好孕圈 with her own circle (預產期 m/d–m/d 的媽媽)', /同週好孕圈/.test(nudge) && /預產期 \d+\/\d+–\d+\/\d+ 的媽媽/.test(nudge), nudge);
  ok('nothing is sent before joining', !A.sent.length, A.sent.map((r) => r.url).join(','));
  await A.click('.cc-home-main'); await A.waitForTimeout(900);
  const joinText = await text(A);
  ok('join screen says what is sent (the week, not the date) and what is not', /預產期是哪一週（不是日期）/.test(joinText) && /誰選了什麼/.test(joinText) && /3 位以上回答才公布結果/.test(joinText), joinText.slice(0, 200));
  await axe(A, 'circle join screen');
  await A.click('button:has-text("加入同週好孕圈")'); await A.waitForTimeout(1500);
  const sent = A.sent.find((r) => /circle\/sync/.test(r.url));
  const cohortA = sent && JSON.parse(sent.body).cohort;
  ok('joining sends only the due-date week', /^p:\d{4}-W\d{2}$/.test(cohortA) && !/lmp|edd|\d{4}-\d{2}-\d{2}/.test(sent.body.replace(cohortA, '')), sent && sent.body);
  const mA = await S(A, () => App.circle.live().members);
  ok('the circle shows how many moms are in it', mA >= 1 && new RegExp(`${mA}\\s*位媽媽`).test(await text(A)), mA);
  if (mA === 1) ok('alone: a friendly invite to bring friends', /目前只有你在這一圈/.test(await text(A)));
  await axe(A, 'circle screen');
  ok('buttons are big enough to tap', !(await smallTaps(A)).length, (await smallTaps(A)).join(', '));

  const B = await mk('B'); await preg(B, WEEKS); await S(B, () => App.circle.join());
  const Cm = await mk('C'); await preg(Cm, WEEKS); await S(Cm, () => App.circle.join());
  ok('same due-date week = same circle', (await S(B, () => App.circle.cohort())) === cohortA && (await members(A)) >= mA + 2);

  /* ---------- the question of the week, from 首頁 ---------- */
  await go(A, 'home', 1500);
  const homePoll = await S(A, () => (document.querySelector('.cc-home-poll') || {}).textContent || '');
  ok('首頁 shows this week\'s question with its answers', /本週小問題/.test(homePoll) && (await S(A, () => document.querySelectorAll('.cc-home-poll .cc-opt').length)) >= 2, homePoll);
  const q = await S(A, () => App.circle.live().poll);
  await A.click('.cc-home-poll .cc-opt >> nth=0'); await A.waitForTimeout(1200);
  ok('voting on 首頁: the card stays and marks the answer', await S(A, () => !!document.querySelector('.cc-home-poll .cc-opt.mine')) && (await S(A, () => App.circle.live().poll.mine)) === 0);
  const before = q.total;
  // the other two answer on the circle screen
  for (const [p, i] of [[B, 1], [Cm, 0]]) {
    await go(p, 'circle', 1500); // eslint-disable-line no-await-in-loop
    await p.click(`.cc-poll-card .cc-opt >> nth=${i}`); await p.waitForTimeout(900); // eslint-disable-line no-await-in-loop
  }
  await go(A, 'circle', 1500);
  const pollNow = await S(A, () => App.circle.live().poll);
  ok('three answers: the totals show (percent on each answer)', pollNow.total >= before + 3 && pollNow.counts && (await S(A, () => document.querySelectorAll('.cc-poll-card .cc-opt-n').length)) === pollNow.options.length, JSON.stringify(pollNow));
  ok('…and how many chose the same as you', /和你選一樣|比較特別/.test(await text(A)));
  ok('nobody\'s answer is tied to them: no ids in what the app gets back', !JSON.stringify(await S(A, () => App.circle.live())).match(/nid|key/));
  // changing her mind: still one vote
  await A.click('.cc-poll-card .cc-opt >> nth=1'); await A.waitForTimeout(900);
  ok('changing the answer keeps one vote', (await S(A, () => App.circle.live().poll.total)) === pollNow.total && (await S(A, () => App.circle.live().poll.mine)) === 1);
  const spotLink = await S(A, () => { const l = [...document.querySelectorAll('.cc-poll-card .link-btn')].find((x) => /相關小知識/.test(x.textContent)); return l ? l.textContent : ''; });
  ok('a question links to the related island knowledge (when there is one)', !q.spot || /相關小知識/.test(spotLink), `${q.spot} ${spotLink}`);

  /* ---------- mood and cheering ---------- */
  await A.click('.cc-mood[aria-label^="有點擔心"]'); await A.waitForTimeout(900);
  const care = await S(A, () => { const c = document.querySelector('.cc-care'); return c ? { t: c.innerText, tel: [...c.querySelectorAll('a[href^="tel:"]')].map((a) => a.getAttribute('href')) } : null; });
  ok('feeling worried: a gentle line with 0800-870-870 and 1925 to call', care && care.tel.includes('tel:0800870870') && care.tel.includes('tel:1925'), JSON.stringify(care));
  for (const p of [B, Cm]) { await S(p, () => document.querySelector('.cc-mood[aria-label^="好累"]').click()); await p.waitForTimeout(700); } // eslint-disable-line no-await-in-loop
  await S(A, () => App.circle.sync({ quiet: true })); await A.waitForTimeout(500);
  const mood = await S(A, () => App.circle.live().mood);
  ok('mood tally: counts per mood once 3 moms shared', mood.total >= 3 && mood.counts && mood.counts.tired >= 2 && mood.counts.worried >= 1, JSON.stringify(mood));
  const cheers0 = await S(A, () => App.circle.live().cheers.week);
  await A.click('.cc-cheer button'); await A.waitForTimeout(900);
  ok('為大家加油: counted once, then 今天加油過了', (await S(A, () => App.circle.live().cheers.week)) === cheers0 + 1 && /今天加油過了/.test(await S(A, () => document.querySelector('.cc-cheer button').textContent)));
  await axe(A, 'circle screen after answering');

  /* ---------- other circles ---------- */
  const D = await mk('D'); await baby(D, 20); await S(D, () => App.circle.join());
  const lbD = await S(D, () => App.circle.label().title);
  ok('a baby\'s circle: 「YYYY 年 M 月出生寶寶的媽媽」, its own question', /^\d{4} 年 \d+ 月出生寶寶的媽媽$/.test(lbD) && (await S(D, () => App.circle.live().poll.instance)) !== q.instance, lbD);
  const E = await mk('E'); await S(E, () => { const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'prep'; s.settings.a2hsDismissed = '1'; App.store.replace(s); });
  ok('備孕: 一起備孕的媽媽', (await S(E, () => App.circle.label().title)) === '一起備孕的媽媽' && (await S(E, () => App.circle.cohort())) === 'prep');
  const N = await mk('N'); await preg(N, 10, { noDate: true });
  await go(N, 'circle', 1200);
  ok('no due date yet: asks for it first, nothing to join', /先填預產期/.test(await text(N)) && !(await N.isVisible('button:has-text("加入同週好孕圈")')));
  await S(N, () => App.store.update((s) => { s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -70)); s.profile.edd = ''; }));
  await go(N, 'circle', 1200);
  ok('only the last period entered: the due date is worked out, and she can join', /^p:\d{4}-W\d{2}$/.test(await S(N, () => App.circle.cohort())) && await N.isVisible('button:has-text("加入同週好孕圈")'));

  /* ---------- dark mode + small phone ---------- */
  const SE = await mk('SE', { scheme: 'dark', device: 'iPhone SE' }); await preg(SE, WEEKS); await S(SE, () => App.circle.join());
  await go(SE, 'circle', 1500);
  await axe(SE, 'circle screen (dark, iPhone SE)');
  ok('small phone: no sideways scroll', (await S(SE, () => document.documentElement.scrollWidth - innerWidth)) <= 1);

  /* ---------- moving on, leaving, clearing ---------- */
  const mBefore = await members(B);
  await S(Cm, () => { App.store.update((s) => { s.profile.stage = 'baby'; s.babies = [{ id: 'b1', name: '寶寶', sex: 'boy', birthday: Core.dateKey() }]; s.activeBabyId = 'b1'; }); });
  await S(Cm, () => App.circle.sync()); await Cm.waitForTimeout(800);
  ok('after the birth, the circle moves to the birth month (and says so)', /^b:\d{4}-\d{2}$/.test(await S(Cm, () => App.social.soc().circle.cohort)) && /已移到/.test(await toasts(Cm)), await toasts(Cm));
  ok('…and leaves the due-date circle', (await members(B)) === mBefore - 1);
  await go(A, 'circle', 1200);
  await A.click('button:has-text("離開同週好孕圈")'); await A.waitForTimeout(400);
  await A.click('.sheet button:has-text("離開")'); await A.waitForTimeout(900);
  ok('leaving: back to the join screen; the circle has one fewer', /加入同週好孕圈/.test(await text(A)) && (await members(B)) === mBefore - 2);
  await S(SE, () => App.store.reset()); await SE.waitForTimeout(800);
  ok('清除所有資料 also leaves the circle', (await members(B)) === mBefore - 3);
  await go(B, 'me', 900);
  ok('我的 lists 同週好孕圈 (joined, with the circle)', /同週好孕圈/.test(await text(B)) && /已加入・預產期/.test(await text(B)));

  /* ---------- without the member service ---------- */
  if (STATIC_BASE) {
    const O = await mk('O', { base: STATIC_BASE }); await preg(O, WEEKS);
    await go(O, 'home', 2500);
    ok('offline / static site: no circle card on 首頁', !(await S(O, () => !!document.querySelector('.cc-home, .cc-home-poll'))));
    await go(O, 'circle', 1500);
    ok('offline: the circle screen says it needs the member service', /需要連上會員服務/.test(await text(O)));
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 同週好孕圈 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
