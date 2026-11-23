// 家族週報：一週的數字、亮點、不放醫療紀錄、卡片圖、文字版、傳到 LINE（圖片／文字／存圖）、首頁週日提醒、
// 雙胞胎、懷孕週報、各個入口。時間固定在台北時間 2026-11-18（三），「上週」是 11/9（一）～11/15（日）。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/weekly.playwright.cjs   [BASE=...]
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://localhost:8080/';
const results = []; const errs = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });
const T = (s) => new Date(`${s}+08:00`); // Taipei time

(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, timezoneId: 'Asia/Taipei', locale: 'zh-TW', acceptDownloads: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errs.push(e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
  const opened = [];
  await p.exposeFunction('__opened', (u) => opened.push(u));
  await p.addInitScript(() => { window.open = (u) => { window.__opened(String(u)); return null; }; window.__noShareMoments = true; window.__noNightAuto = true; });
  await p.clock.setFixedTime(T('2026-11-18T10:00:00'));
  const S = (f, a) => p.evaluate(f, a);
  const wait = (ms = 300) => p.waitForTimeout(ms);
  // the same address again does not reload the page: redraw it instead (the clock may have moved)
  const go = async (hash, ms = 700) => {
    if (await S((x) => location.hash === `#/${x}` && !!window.App && !!App.refresh, hash)) await S(() => App.refresh());
    else await p.goto(`${BASE}#/${hash}`);
    await wait(ms);
  };

  // ---------- a family with a known week ----------
  await go('home', 400);
  await S(() => {
    const st = App.store.defaults();
    const L = (type, at, extra = {}) => st.logs.push({
      id: Core.uid(), babyId: 'b1', type, start: new Date(`${at}+08:00`).toISOString(), end: null, data: {}, note: '', by: '媽媽', createdAt: new Date(`${at}+08:00`).toISOString(), ...extra,
    });
    const end = (at) => new Date(`${at}+08:00`).toISOString();
    st.onboarded = true; st.onboardedAt = '2026-10-01T02:00:00.000Z';
    st.profile = { ...st.profile, momName: '小美', stage: 'baby' };
    st.babies = [{ id: 'b1', name: '小乖', sex: 'girl', birthday: '2026-08-05', birthWeight: 3.1, birthLength: 50, avatar: '👧' }];
    st.activeBabyId = 'b1';
    // Mon 11/9: 3 bottles (390 ml) + 2 breastfeeds, 4 diapers, a 2-hour nap
    L('bottle', '2026-11-09T08:00:00', { data: { ml: 120, kind: 'formula' } });
    L('bottle', '2026-11-09T11:00:00', { data: { ml: 130, kind: 'formula' } });
    L('bottle', '2026-11-09T14:00:00', { data: { ml: 140, kind: 'breastmilk' } });
    L('breast', '2026-11-09T17:00:00', { end: end('2026-11-09T17:20:00'), data: { leftMin: 10, rightMin: 10 } });
    L('breast', '2026-11-09T20:00:00', { end: end('2026-11-09T20:20:00'), data: { leftMin: 10, rightMin: 10 } });
    ['08:10', '11:10', '14:10'].forEach((t) => L('diaper', `2026-11-09T${t}:00`, { data: { kind: 'wet' } }));
    L('diaper', '2026-11-09T17:30:00', { data: { kind: 'dirty' } });
    L('sleep', '2026-11-09T13:00:00', { end: end('2026-11-09T15:00:00') });
    // Tue 11/10: 4 bottles (600 ml), 2 diapers, a night's sleep 22:00 → 03:00 (2 h Tue, 3 h Wed); a fever and medicine
    ['07:00', '10:00', '13:00', '16:00'].forEach((t) => L('bottle', `2026-11-10T${t}:00`, { data: { ml: 150, kind: 'formula' } }));
    L('diaper', '2026-11-10T07:10:00', { data: { kind: 'mixed' } }); L('diaper', '2026-11-10T13:10:00', { data: { kind: 'mixed' } });
    L('sleep', '2026-11-10T22:00:00', { end: end('2026-11-11T03:00:00') });
    L('temp', '2026-11-10T18:00:00', { data: { c: 38.4, site: '耳溫' } });
    // Wed 11/11: a bath, first rice cereal and pumpkin, a doctor's visit and fever medicine
    L('bath', '2026-11-11T19:00:00');
    L('food', '2026-11-11T11:00:00', { data: { item: '米粉' } }); L('food', '2026-11-11T12:00:00', { data: { item: '南瓜' } });
    L('visit', '2026-11-11T09:30:00', { data: { clinic: '小兒科', reason: '發燒', diagnosis: '感冒' } });
    L('med', '2026-11-11T10:00:00', { data: { name: '退燒藥', dose: '2.5ml' } });
    // Thu 11/12 (百日): rice cereal again, one bottle; apple (already eaten the week before)
    L('food', '2026-11-12T11:00:00', { data: { item: '米粉' } }); L('bottle', '2026-11-12T09:00:00', { data: { ml: 200, kind: 'formula' } });
    L('food', '2026-11-02T11:00:00', { data: { item: '蘋果' } }); L('food', '2026-11-13T11:00:00', { data: { item: '蘋果' } });
    // this week so far: Mon 11/16 two bottles, today (Wed) one
    L('bottle', '2026-11-16T09:00:00', { data: { ml: 100, kind: 'formula' } }); L('bottle', '2026-11-16T13:00:00', { data: { ml: 100, kind: 'formula' } });
    L('bottle', '2026-11-18T09:00:00', { data: { ml: 300, kind: 'formula' } });
    st.milestones.b1 = { m2a: '2026-11-10', m4a: '2026-11-14', m2d: '2026-11-01' };
    st.growth = [{ id: 'g1', babyId: 'b1', date: '2026-10-20', weight: 5.1, length: 57 }, { id: 'g2', babyId: 'b1', date: '2026-11-13', weight: 5.65, length: 59.2 }];
    st.vaccines.b1 = { dtap2: '2026-11-12' };
    st.chicken.log = { '2026-11-09': 1, '2026-11-10': 1, '2026-11-12': 2 };
    App.store.replace(st);
    App.isNight = () => false; App.applyTheme();
  });

  // ---------- weeks ----------
  const wk = await S(() => {
    const W = App.weekly;
    return {
      sun: W.weekOf('2026-11-22'), mon: W.weekOf('2026-11-16'), rSun: W.reportWeek(new Date(2026, 10, 22, 9)), rMon: W.reportWeek(new Date(2026, 10, 23, 9)), rWed: W.reportWeek(new Date(2026, 10, 18, 9)),
    };
  });
  ok('a week runs Monday to Sunday', wk.sun === '2026-11-16' && wk.mon === '2026-11-16', JSON.stringify(wk));
  ok('the report is about this week on Sunday, and the week that just ended on Monday–Saturday', wk.rSun === '2026-11-16' && wk.rMon === '2026-11-16' && wk.rWed === '2026-11-09', JSON.stringify(wk));

  // ---------- the baby's week ----------
  const r = await S(() => {
    const W = App.weekly; const x = W.build('baby', '2026-11-09', App.store.baby());
    const sp = W.spec(x, {});
    return {
      avg: x.avg, byBottle: x.byBottle, recDays: x.recDays, longest: x.longest, newFoods: x.newFoods, ms: x.ms.map((m) => m.key), tiles: W.tiles(x), lines: W.highlights(x),
      sleepTue: x.days[1].sleepMs / 3600000, sleepWed: x.days[2].sleepMs / 3600000, spec: JSON.stringify(sp), text: W.text(x, { note: '謝謝阿嬤這週來幫忙！' }),
      title: sp.hero.title, sub: sp.hero.sub, sub2: sp.hero.sub2, chart: sp.chart && sp.chart.title, bars: sp.chart && sp.chart.bars.map((bb) => bb.v),
    };
  });
  ok('milk per day: the average of the days with bottles (390, 600, 200 → 397 ml)', Math.round(r.avg.milk) === 397, String(r.avg.milk));
  ok('mostly bottles: the card shows the amount', r.byBottle && r.tiles[0].v === '397' && r.tiles[0].u === 'ml', JSON.stringify(r.tiles[0]));
  ok('feeds per day 3.3 (5, 4, 1)', Math.abs(r.avg.feeds - 10 / 3) < 0.01, String(r.avg.feeds));
  ok('a night\'s sleep is split between the two days it touches', r.sleepTue === 2 && r.sleepWed === 3, `${r.sleepTue}/${r.sleepWed}`);
  ok('sleep per day 2.3 h, diapers per day 3', Math.abs(r.avg.sleepH - 7 / 3) < 0.01 && r.avg.diapers === 3, `${r.avg.sleepH} ${r.avg.diapers}`);
  ok('5 days had records (Friday only an apple)', r.recDays === 5, String(r.recDays));
  ok('longest sleep 5 hours', r.longest === 5 * 3600000);
  ok('first foods: rice cereal and pumpkin (not the apple from the week before)', JSON.stringify(r.newFoods) === '["米粉","南瓜"]', JSON.stringify(r.newFoods));
  ok('new skills this week only', JSON.stringify(r.ms) === '["m2a","m4a"]', JSON.stringify(r.ms));
  ok('highlights in order: 百日, two skills, growth, first foods, longest sleep, bath, 滴雞精',
    r.lines[0] === '💯 11/12 百日快樂！' && r.lines[1] === '⭐ 新技能：趴著時能短暫抬頭' && r.lines[2] === '⭐ 新技能：抱坐時頭部穩定'
    && r.lines[3] === '📏 體重 5.65 公斤（比上次 +0.55）・身長 59.2 公分' && r.lines[4] === '🥣 第一次吃：米粉、南瓜' && r.lines[5] === '🌙 最長一覺睡了 5 小時'
    && r.lines[6] === '🛁 洗澡 1 次' && r.lines[7] === '媽媽有 3 天喝了滴雞精', r.lines.join(' | '));
  ok('card title: name, age at the end of the week', r.title === '小乖 這週' && r.sub === '3 個月 10 天' && r.sub2 === '出生第 103 天', `${r.title} ${r.sub} ${r.sub2}`);
  ok('chart: milk per day, the empty days are 0', r.chart === '每天喝奶（ml）' && JSON.stringify(r.bars) === '[390,600,0,200,0,0,0]', JSON.stringify(r.bars));
  const medical = /體溫|38\.4|°C|看診|小兒科|發燒|感冒|退燒|用藥|疫苗|五合一|dtap/;
  ok('no medical records on the card', !medical.test(r.spec), (r.spec.match(medical) || [])[0]);
  ok('…nor in the text', !medical.test(r.text), (r.text.match(medical) || [])[0]);
  ok('text: title, numbers, highlights, the note, the app link with the invite code',
    r.text.startsWith('【小乖這週】11/9（一）～11/15（日）') && r.text.includes('🍼 每天喝奶約 397 ml，平均餵 3.3 次') && r.text.includes('😴 每天睡約 2.3 小時')
    && r.text.includes('💬 謝謝阿嬤這週來幫忙！ — 小美') && /utm_campaign=weekly/.test(r.text) && /ref=[A-Z0-9]{6}/.test(r.text), r.text);

  // this week so far: today is not over, so it does not count in the average
  const cw = await S(() => {
    const W = App.weekly; const x = W.build('baby', '2026-11-16', App.store.baby()); const sp = W.spec(x, {});
    return { milk: x.avg.milk, bars: sp.chart.bars.map((bb) => bb.v), today: sp.chart.bars.map((bb) => bb.today) };
  });
  ok('this week so far: today (300 ml so far) is left out of the average', cw.milk === 200, String(cw.milk));
  ok('…yesterday with nothing is 0, the days still to come have no bar', JSON.stringify(cw.bars) === '[200,0,300,null,null,null,null]' && cw.today[2] === true, JSON.stringify(cw.bars));

  // ---------- the card picture ----------
  const pic = await S(async () => {
    const W = App.weekly; const x = W.build('baby', '2026-11-09', App.store.baby());
    const long = W.spec(x, { note: '謝謝阿公阿嬤這週每天都來幫忙洗澡、陪寶寶玩、煮好吃的月子餐，大家都辛苦了！我們都很愛你們 💜💜💜' });
    const blob = await W.draw(long); const bmp = await createImageBitmap(blob);
    return { w: bmp.width, h: bmp.height, size: blob.size, note: long.note };
  });
  ok('card picture is 1080×1920 (the same as the other share cards)', pic.w === 1080 && pic.h === 1920 && pic.size > 50000, `${pic.w}x${pic.h} ${pic.size}`);
  ok('a long note is kept to 40 characters (an emoji counts as one)', [...pic.note].length === 40, `${[...pic.note].length}`);

  // ---------- the screen ----------
  await go('weekly', 1600);
  ok('opens on last week (it has records)', (await p.textContent('.wk-nav .datenav-mid')).includes('11/9（一）～11/15（日）') && (await p.textContent('.wk-nav')).includes('上週'));
  ok('the card preview is drawn', await p.isVisible('.wk-img'));
  await p.fill('.wk-note', '謝謝阿嬤這週來幫忙！'); await wait(500);
  ok('the note is saved for that week and goes into the text', (await S(() => App.store.state.weekly.notes['2026-11-09'])) === '謝謝阿嬤這週來幫忙！' && (await p.textContent('.wk-text-pre')).includes('💬 謝謝阿嬤這週來幫忙！'));
  ok('typing does not redraw the screen (the field keeps focus)', await S(() => document.activeElement && document.activeElement.classList.contains('wk-note')));
  await p.click('.wk-note-card .chip >> nth=1'); await wait(400);
  ok('a suggested line fills the note', (await p.inputValue('.wk-note')) === '這週爸爸辛苦了！' && (await S(() => App.store.state.weekly.notes['2026-11-09'])) === '這週爸爸辛苦了！');
  await p.click('.wk-opts .seg button:has-text("睡眠")'); await wait(700);
  ok('the chart can show sleep instead', await S(() => document.querySelector('.wk-opts .seg button.active').textContent === '睡眠'));
  await p.click('.wk-checks label:has-text("顯示寶寶名字") input'); await wait(500);
  ok('without the name: 寶寶 in the text and on the card', (await p.textContent('.wk-text-pre')).startsWith('【寶寶這週】') && (await S(() => App.store.state.share.privacy.showName)) === false);
  await p.click('.wk-checks label:has-text("顯示寶寶名字") input'); await wait(300);
  ok('no photo checkbox when the baby has no photo', !(await p.isVisible('.wk-checks label:has-text("放寶寶照片")')));

  // send the words to LINE
  opened.length = 0;
  await p.click('.wk-text-btn'); await wait(400);
  const lineText = decodeURIComponent((opened[0] || '').replace('https://line.me/R/share?text=', ''));
  ok('只傳文字: LINE opens with the week in words', (opened[0] || '').startsWith('https://line.me/R/share?text=') && lineText.startsWith('【小乖這週】') && lineText.includes('這週爸爸辛苦了！'), lineText.slice(0, 60));
  ok('…marked as sent today, with 好孕點數', (await S(() => App.store.state.weekly.sent['2026-11-09'])) === '2026-11-18' && (await p.textContent('.wk-status')).includes('已傳給家人') && (await S(() => App.store.state.share.points)) === 10);
  // the picture on a computer (no picture sharing): downloaded, and LINE opens with the words
  opened.length = 0;
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('.wk-send')]);
  ok('傳到家族群組 on a computer: the picture downloads and LINE opens', !!dl && /yijia-weekly-2026-11-09\.png$/.test(dl.suggestedFilename()) && (opened[0] || '').startsWith('https://line.me/R/share?text='), dl ? dl.suggestedFilename() : 'no download');
  const [dl2] = await Promise.all([p.waitForEvent('download', { timeout: 8000 }).catch(() => null), p.click('.wk-save')]);
  ok('存圖片 downloads the picture', !!dl2);
  // the picture on a phone: the share sheet gets the picture and the words
  await S(() => {
    navigator.canShare = () => true;
    navigator.share = async (d) => { window.__shared = { n: d.files.length, type: d.files[0].type, name: d.files[0].name, text: d.text }; };
  });
  await p.click('.wk-send'); await wait(800);
  const shared = await S(() => window.__shared);
  ok('傳到家族群組 on a phone: the share sheet gets the PNG and the text', shared && shared.n === 1 && shared.type === 'image/png' && shared.text.startsWith('【小乖這週】'), JSON.stringify(shared));

  // weeks: arrows and their limits
  await p.click('.wk-nav button[aria-label="後一週"]'); await wait(900);
  ok('next week: this week so far', (await p.textContent('.wk-nav')).includes('本週（到今天）') && await S(() => document.querySelector('.wk-nav button[aria-label="後一週"]').disabled));
  await p.click('.wk-nav button[aria-label="前一週"]'); await p.click('.wk-nav button[aria-label="前一週"]'); await wait(900);
  ok('previous week', (await p.textContent('.wk-nav .datenav-mid')).includes('11/2（一）～11/8（日）'));
  await go('weekly?%7B%22wk%22%3A%222026-08-05%22%7D', 900);
  ok('a link to a week opens it; the birth week is the first one', (await p.textContent('.wk-nav .datenav-mid')).includes('8/3（一）～8/9（日）') && await S(() => document.querySelector('.wk-nav button[aria-label="前一週"]').disabled));
  const born = await S(() => { const W = App.weekly; const x = W.build('baby', '2026-08-03', App.store.baby()); return { lines: W.highlights(x), bars: W.spec(x, {}).chart }; });
  ok('the birth week: 出生了 on the day she was born', born.lines[0] === '🍼 8/5 出生了，歡迎來到這個世界！', born.lines.join(' | '));

  // ---------- 首頁 on Sunday and Monday ----------
  await p.clock.setFixedTime(T('2026-11-15T10:00:00')); // Sunday
  await S(() => { App.store.update((s) => { s.weekly.sent = {}; }); });
  await go('home', 900);
  ok('Sunday: 首頁 shows this week\'s report', (await p.isVisible('.wk-home')) && (await p.textContent('.wk-home')).includes('這週的家族週報做好了'));
  ok('…with the numbers', (await p.textContent('.wk-home')).includes('每天喝奶 397'));
  await p.click('.wk-home-go'); await wait(1200);
  ok('tapping it opens that week', (await S(() => document.body.dataset.screen)) === 'weekly' && (await p.textContent('.wk-nav .datenav-mid')).includes('11/9（一）～11/15（日）') && (await p.textContent('.wk-nav')).includes('本週'));
  await p.clock.setFixedTime(T('2026-11-16T09:00:00')); // Monday
  await go('home', 900);
  ok('Monday: last week\'s report is still offered', (await p.textContent('.wk-home')).includes('上週的家族週報做好了'));
  await p.click('.wk-home-x'); await wait(500);
  ok('✕ hides it for that week', !(await p.isVisible('.wk-home')) && (await S(() => App.store.state.weekly.skip['2026-11-09'])) === '2026-11-16');
  await p.clock.setFixedTime(T('2026-11-18T10:00:00')); // Wednesday
  await S(() => { App.store.update((s) => { s.weekly.skip = {}; }); });
  await go('home', 700);
  ok('midweek: no reminder', !(await p.isVisible('.wk-home')));
  await p.clock.setFixedTime(T('2026-11-15T10:00:00'));
  await S(() => { App.store.update((s) => { s.weekly.sent = { '2026-11-09': '2026-11-15' }; }); });
  await go('home', 700);
  ok('already sent: no reminder', !(await p.isVisible('.wk-home')));
  await S(() => { App.store.update((s) => { s.weekly.sent = {}; s.weekly.off = true; }); });
  await go('home', 700);
  ok('reminder switched off: none', !(await p.isVisible('.wk-home')));
  await S(() => { App.store.update((s) => { s.weekly.off = false; s.logs = s.logs.filter((l) => l.start < '2026-11-01'); s.milestones.b1 = {}; s.growth = []; }); });
  await go('home', 700);
  ok('a week with 百日 but no records: still offered (a big day is worth a report)', await p.isVisible('.wk-home'));
  await p.clock.setFixedTime(T('2026-11-22T10:00:00'));
  await go('home', 700);
  ok('a week with no records and no big day: no reminder', !(await p.isVisible('.wk-home')));
  await p.clock.setFixedTime(T('2026-11-18T10:00:00'));

  // ---------- twins ----------
  await S(() => {
    App.store.update((s) => {
      s.babies.push({ id: 'b2', name: '小寶', sex: 'boy', birthday: '2026-08-05', avatar: '👦', photo: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==' });
    });
  });
  await go('weekly', 1200);
  await p.clock.setFixedTime(T('2026-11-16T09:00:00'));
  await go('home', 800);
  ok('twins: 首頁 says whose week it is', (await p.textContent('.wk-home')).includes('小乖上週的週報做好了'));
  await p.clock.setFixedTime(T('2026-11-18T10:00:00'));
  await go('weekly', 1200);
  ok('twins: one tab per baby', (await S(() => document.querySelectorAll('#view > .mb .seg button').length)) === 2);
  await p.click('#view > .mb .seg button:has-text("小寶")'); await wait(1000);
  ok('…the other baby\'s week', (await p.textContent('.wk-text-pre')).startsWith('【小寶這週】'));
  ok('a baby with a photo: the photo can go on the card (off until ticked)', (await p.isVisible('.wk-checks label:has-text("放寶寶照片")')) && !(await p.isChecked('.wk-checks label:has-text("放寶寶照片") input')));
  await p.click('.wk-checks label:has-text("放寶寶照片") input'); await wait(800);
  ok('ticking it puts the photo on', await S(() => App.weekly.spec(App.weekly.build('baby', App.weekly.reportWeek(), App.store.state.babies[1]), {}).hero.photo !== null));
  await S(() => { App.store.update((s) => { s.share.privacy.showPhoto = false; }); });

  // ---------- pregnancy ----------
  await S(() => {
    App.store.update((s) => {
      s.profile.stage = 'preg'; s.profile.lmp = '2026-05-31'; s.profile.edd = '';
      s.preg.kicks = [{ id: 'k1', start: new Date('2026-11-10T21:00:00+08:00').toISOString(), end: new Date('2026-11-10T21:20:00+08:00').toISOString(), count: 10 },
        { id: 'k2', start: new Date('2026-11-12T21:00:00+08:00').toISOString(), end: new Date('2026-11-12T21:30:00+08:00').toISOString(), count: 10 }];
      s.preg.prenatal = { v4: '2026-10-20', v5: '2026-11-11' };
      s.chicken.log = { '2026-11-09': 1 };
    });
  });
  const pg = await S(() => {
    const W = App.weekly; const x = W.build('preg', '2026-11-09'); const sp = W.spec(x, {});
    return {
      weeks: x.ga.weeks, days: x.ga.days, tiles: W.tiles(x), lines: W.highlights(x), title: sp.hero.title, sub: sp.hero.sub, fact: sp.fact, progress: sp.progress, spec: JSON.stringify(sp), text: W.text(x, {}), kicker: sp.kicker,
    };
  });
  ok('pregnancy: 24 weeks at the end of that week, the fruit, the countdown', pg.weeks === 24 && pg.days === 0 && pg.title === '懷孕 24 週' && pg.sub === '寶寶大約像玉米一樣大' && pg.tiles[0].v === '112', JSON.stringify(pg.tiles));
  ok('…kicks counted and 滴雞精 days as tiles', pg.tiles[1].v === '2' && pg.tiles[1].l === '數胎動' && pg.tiles[2].v === '1' && pg.tiles[2].l === '滴雞精時光', JSON.stringify(pg.tiles));
  ok('…this week\'s baby and a progress bar', pg.fact.startsWith('這週的寶寶：') && pg.progress.label === '60%' && pg.kicker.startsWith('📮 好孕週報'), `${pg.progress.label}`);
  ok('…the check-up done this week, without what was checked', JSON.stringify(pg.lines) === '["🩺 完成第 5 次產檢"]' && !/妊娠糖尿病|貧血|血糖/.test(pg.spec + pg.text), pg.lines.join(' | '));
  await go('weekly', 1400);
  ok('pregnancy screen: the card preview, no chart choice', (await p.isVisible('.wk-img')) && !(await p.isVisible('.wk-opts .seg')));
  await p.clock.setFixedTime(T('2026-11-15T10:00:00'));
  await go('home', 900);
  ok('Sunday while pregnant: 首頁 offers the 好孕週報', (await p.textContent('.wk-home')).includes('這週的好孕週報做好了'));
  await p.clock.setFixedTime(T('2026-11-18T10:00:00'));
  await go('pregnancy', 700);
  ok('孕期週記 links to it', await p.isVisible('.pg-shortcuts button:has-text("週報給家人")'));
  await go('health', 700);
  ok('健康 tab while pregnant: a 家族週報 tile', await p.isVisible('.tool-card:has-text("家族週報")'));

  // ---------- 備孕: none ----------
  await S(() => { App.store.update((s) => { s.profile.stage = 'prep'; }); });
  await go('weekly', 700);
  ok('備孕: the screen explains it is for later', (await p.textContent('#view')).includes('家族週報在懷孕和育兒的時候使用'));
  await go('health', 700);
  ok('備孕: no tile', !(await p.isVisible('.tool-card:has-text("家族週報")')));

  // ---------- the ways in (育兒) ----------
  await S(() => { App.store.update((s) => { s.profile.stage = 'baby'; s.babies = s.babies.slice(0, 1); s.activeBabyId = 'b1'; }); });
  await go('health', 700);
  ok('健康 tab: a 家族週報 tile', await p.isVisible('.tool-card:has-text("家族週報")'));
  await go('stats', 900);
  ok('統計與報告 links to it', await p.isVisible('button:has-text("家族週報：這週做成一張卡")'));
  await go('invite', 900);
  ok('邀請好友: 家族週報 in the card gallery', await p.isVisible('.inv-weekly'));
  await p.click('.inv-weekly'); await wait(900);
  ok('…and it opens the screen', (await S(() => document.body.dataset.screen)) === 'weekly');
  await go('log', 600);
  await p.click('.log-top .seg button:has-text("月曆")'); await wait(600);
  ok('the month view links to it', await p.isVisible('button:has-text("家族週報：每週一張卡")'));
  await go('search', 700);
  await p.fill('#sr-input', '週報'); await wait(700);
  ok('search 週報 finds it', (await p.textContent('#view')).includes('家族週報'));

  ok('no page errors', !errs.length, errs.slice(0, 3).join(' | '));
  results.forEach((x) => console.log(`${x.pass ? 'PASS' : 'FAIL'}  ${x.name}${x.info && !x.pass ? `   [${x.info}]` : ''}`));
  console.log(`\n${results.filter((x) => x.pass).length}/${results.length} passed`);
  if (results.some((x) => !x.pass)) process.exitCode = 1;
  await b.close();
})().catch((e) => { console.error('SCRIPT ERROR', e.message); process.exit(1); });
