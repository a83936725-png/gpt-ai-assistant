// 手機好用度測試：小螢幕、橫放、鍵盤、拇指好按、滑下關閉、返回鍵、輸入框不放大、浮動＋不擋內容、震動回饋。
// Usage: cd mom-app && python3 -m http.server 8080   then   node tests/mobile.playwright.cjs   [BASE=...]
const { chromium, devices } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8080/';
const results = [];
const ok = (name, cond, info = '') => results.push({ name, pass: !!cond, info });

(async () => {
  const browser = await chromium.launch();
  const errors = [];
  const open = async (dev, tag, extra = {}) => {
    const ctx = await browser.newContext({ ...devices[dev], locale: 'zh-TW', ...extra });
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.__noShareMoments = true; window.__noNightAuto = true;
      window.__vibrations = [];
      try { Object.defineProperty(navigator, 'vibrate', { configurable: true, value: (ms) => { window.__vibrations.push(ms); return true; } }); } catch (e) { /* ignore */ }
      document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '.toast-wrap{display:none!important}'; document.head.append(st); });
    });
    p.on('pageerror', (e) => errors.push(`[${tag}] ${e.message}`));
    p.on('dialog', (d) => d.dismiss().catch(() => {}));
    await p.goto(BASE); await p.waitForFunction(() => window.App && App.screens && App.screens.goods);
    return { p, ctx };
  };
  const S = (p, f, a) => p.evaluate(f, a);
  const STAGES = {
    baby: () => { App.demo.seed(); },
    preg: () => {
      const s = App.store.defaults(); s.onboarded = true; s.profile.stage = 'preg'; s.profile.heightCm = 160; s.profile.prePregWeight = 52;
      s.profile.lmp = Core.dateKey(Core.addDays(new Date(), -(28 * 7 + 3))); s.profile.edd = Core.eddFromLmp(s.profile.lmp); App.store.replace(s);
    },
  };
  const go = async (p, id, ms = 250) => { await S(p, (x) => { location.hash = `#/${x}?${encodeURIComponent(JSON.stringify({ t: Math.random() }))}`; }, id); await p.waitForTimeout(ms); };
  const isOpen = (p) => S(p, () => !!document.querySelector('.sheet-backdrop.open'));

  /* ---------- 1. every screen fits small phones and landscape (no sideways scroll, nothing stuck under the bars) ---------- */
  for (const dev of ['iPhone SE', 'Galaxy S8', 'iPhone 13 landscape']) {
    const { p, ctx } = await open(dev, dev);
    const wide = []; const stuck = [];
    for (const [st, fn] of Object.entries(STAGES)) {
      await S(p, fn); await S(p, () => { App.isNight = () => false; });
      const screens = await S(p, () => Object.keys(App.screens).filter((x) => !['onboarding', 'login'].includes(x)));
      for (const id of screens) {
        await go(p, id, 220);
        const r = await S(p, () => {
          const W = innerWidth; const H = innerHeight;
          const over = document.documentElement.scrollWidth - W;
          window.scrollTo(0, document.documentElement.scrollHeight);
          const tab = document.getElementById('tabbar').getBoundingClientRect().top;
          // controls whose centre ends up under the tab bar even at the end of the page cannot be reached
          const hidden = [...document.querySelectorAll('#view button, #view a[href]')].filter((e) => {
            const b = e.getBoundingClientRect(); if (!b.width || getComputedStyle(e).position === 'fixed') return false;
            const cy = b.top + b.height / 2; return cy > tab && cy < H;
          }).map((e) => (e.innerText || e.getAttribute('aria-label') || '').trim().slice(0, 12));
          window.scrollTo(0, 0);
          return { over, hidden };
        });
        if (r.over > 1) wide.push(`${st}/${id} ${r.over}px`);
        if (r.hidden.length) stuck.push(`${st}/${id}: ${r.hidden.slice(0, 2).join('、')}`);
      }
    }
    ok(`${dev}: every screen fits the width (no sideways scroll)`, !wide.length, wide.slice(0, 4).join(' | '));
    ok(`${dev}: at the end of every page nothing is left under the tab bar`, !stuck.length, stuck.slice(0, 4).join(' | '));
    await ctx.close();
  }

  /* ---------- 2. thumb-sized targets and no iOS zoom on inputs (iPhone SE, the smallest) ---------- */
  {
    const { p, ctx } = await open('iPhone SE', 'targets');
    await S(p, STAGES.baby); await S(p, () => { App.isNight = () => false; });
    await go(p, 'growth');
    const back = await S(p, () => { const b = document.querySelector('#appbar .icon-btn').getBoundingClientRect(); return [b.width, b.height]; });
    ok('back / search buttons in the top bar are 44×44', back[0] >= 44 && back[1] >= 44, back.join('×'));
    await go(p, 'home');
    await p.tap('.qt-main >> text=瓶餵'); await p.waitForTimeout(400);
    const sh = await S(p, () => {
      const sheet = document.querySelector('.sheet-backdrop.open .sheet');
      const size = (sel) => [...sheet.querySelectorAll(sel)].map((e) => { const b = e.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)); });
      const fields = [...sheet.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, textarea')].map((e) => parseFloat(getComputedStyle(e).fontSize));
      return { close: size('.sheet-header .icon-btn'), stepper: size('.stepper-btn'), seg: size('.seg button'), fields, ta: getComputedStyle(sheet.querySelector('button')).touchAction, osb: getComputedStyle(sheet.querySelector('.sheet-body')).overscrollBehaviorY };
    });
    ok('in a form: ✕ close is 44px, − / + steppers are 44px (not squeezed), choice buttons are 44px tall', sh.close.every((x) => x >= 44) && sh.stepper.length && sh.stepper.every((x) => x >= 44) && sh.seg.every((x) => x >= 44), JSON.stringify(sh));
    ok('every input in the form is at least 16px, so iPhone does not zoom in when you tap it', sh.fields.length && sh.fields.every((x) => x >= 16), sh.fields.join(','));
    ok('quick repeated taps never zoom (touch-action: manipulation); the form never triggers pull-to-refresh (overscroll contain)', sh.ta === 'manipulation' || sh.ta === 'none' ? sh.osb === 'contain' : false, `${sh.ta} / ${sh.osb}`);
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // avatar picker in 編輯寶寶 used to be 28px wide on this phone
    await S(p, () => App.me.editBaby(App.store.baby())); await p.waitForTimeout(400);
    const av = await S(p, () => [...document.querySelectorAll('.sheet-backdrop.open .av-btn')].map((e) => { const b = e.getBoundingClientRect(); return Math.round(Math.min(b.width, b.height)); }));
    ok('baby avatar choices are at least 44px each', av.length && av.every((x) => x >= 44), av.join(','));
    await p.keyboard.press('Escape'); await p.waitForTimeout(300);
    // reminders: the whole title row toggles the switch
    await go(p, 'reminders');
    const before = await S(p, () => App.store.state.reminders.find((r) => r.id === 'chicken').enabled);
    await p.tap('.switch-row >> text=滴雞精時光提醒'); await p.waitForTimeout(300);
    const after = await S(p, () => App.store.state.reminders.find((r) => r.id === 'chicken').enabled);
    ok('reminders: tapping the title row turns the reminder on/off (not only the small switch)', before !== after, `${before} → ${after}`);
    const meta = await S(p, () => document.querySelector('meta[name=viewport]').content);
    ok('Android keyboard resizes the page, so a form\'s save button stays above the keyboard', /interactive-widget=resizes-content/.test(meta), meta);
    await ctx.close();
  }

  /* ---------- 3. sheets: swipe down to close, back button, keyboard ---------- */
  {
    const { p, ctx } = await open('iPhone SE', 'sheet');
    await S(p, STAGES.baby); await S(p, () => { App.isNight = () => false; });
    await go(p, 'home', 400);
    const cdp = await ctx.newCDPSession(p);
    const swipe = async (x, y0, y1, ms) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y: y0 }] });
      for (let i = 1; i <= 8; i += 1) { await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y0 + ((y1 - y0) * i) / 8 }] }); await p.waitForTimeout(ms / 8); }
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
      await p.waitForTimeout(400);
    };
    const openBottle = async () => { if (await isOpen(p)) { await p.keyboard.press('Escape'); await p.waitForTimeout(300); } await p.tap('.qt-main >> text=瓶餵'); await p.waitForTimeout(400); };
    const at = (sel) => S(p, (s) => { const r = document.querySelector(`.sheet-backdrop.open ${s}`).getBoundingClientRect(); return [r.left + Math.min(r.width / 2, 40), r.top + Math.min(r.height / 2, 40)]; }, sel);
    await openBottle(); let [x, y] = await at('.sheet-grip');
    await swipe(x, y, y + 220, 300);
    ok('swipe the sheet down by its grip: it closes, and you stay on the same screen', !(await isOpen(p)) && (await S(p, () => location.hash.startsWith('#/home'))));
    await openBottle(); [x, y] = await at('.sheet-grip');
    await swipe(x, y, y + 25, 300);
    ok('a small accidental drag does not close it; the sheet springs back', (await isOpen(p)) && (await S(p, () => document.querySelector('.sheet-backdrop.open .sheet').style.transform === '')));
    [x, y] = await at('.sheet-body');
    await swipe(x, y, y + 200, 300);
    ok('dragging inside the form (to scroll) never closes it', await isOpen(p));
    // a real finger reports moves every 8–16 ms; the emulator only every ~33 ms, so the flick is timed synthetic events
    const flick = (gapMs) => S(p, async (g) => {
      const h2 = document.querySelector('.sheet-backdrop.open .sheet-header h2'); const r = h2.getBoundingClientRect();
      const ev = (type, yy) => h2.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 9, pointerType: 'touch', clientX: r.left + 5, clientY: yy }));
      const wait = (ms) => new Promise((res) => setTimeout(res, ms));
      ev('pointerdown', r.top + 5); for (let i = 1; i <= 6; i += 1) { await wait(g); ev('pointermove', r.top + 5 + i * 12); } await wait(g); ev('pointerup', r.top + 77);
    }, gapMs);
    await flick(60); await p.waitForTimeout(400);
    ok('a slow short pull on the title and letting go: stays open', await isOpen(p));
    await flick(12); await p.waitForTimeout(400);
    ok('a quick flick down on the title closes it', !(await isOpen(p)));
    await openBottle();
    await p.goBack(); await p.waitForTimeout(400);
    ok('phone back button closes the sheet first, staying on the screen', !(await isOpen(p)) && (await S(p, () => location.hash.startsWith('#/home'))));
    // keyboard up (Android resizes the page): the sheet shrinks to fit and the save button stays on screen
    await openBottle();
    await S(p, () => document.querySelector('.sheet-backdrop.open .stepper-input').focus());
    await p.setViewportSize({ width: 320, height: 300 }); await p.waitForTimeout(300);
    const kb = await S(p, () => { const H = innerHeight; const sh = document.querySelector('.sheet-backdrop.open .sheet').getBoundingClientRect(); const ft = document.querySelector('.sheet-backdrop.open .sheet-footer').getBoundingClientRect(); return { H, top: Math.round(sh.top), footer: Math.round(ft.bottom) }; });
    ok('with the keyboard up the form fits the space left and 儲存 stays visible', kb.top >= 0 && kb.footer <= kb.H + 1, JSON.stringify(kb));
    await ctx.close();
  }

  /* ---------- 4. landscape: island fits, bars are slimmer ---------- */
  {
    const { p, ctx } = await open('iPhone 13 landscape', 'landscape');
    await S(p, STAGES.baby); await S(p, () => { App.isNight = () => false; });
    await go(p, 'island', 1200);
    const r = await S(p, () => {
      const tab = document.getElementById('tabbar').getBoundingClientRect();
      const tk = document.querySelector('.isl-ticker').getBoundingClientRect();
      const ctrl = [...document.querySelectorAll('.isl-cbtn')].map((e) => e.getBoundingClientRect().bottom);
      return { tabTop: Math.round(tab.top), tabH: Math.round(tab.height), ticker: Math.round(tk.bottom), ctrl: Math.round(Math.max(...ctrl)), scroll: document.documentElement.scrollHeight - innerHeight };
    });
    ok('phone on its side: the island news ticker and all map buttons sit above the tab bar', r.ticker <= r.tabTop && r.ctrl <= r.tabTop && r.scroll <= 1, JSON.stringify(r));
    ok('phone on its side: the tab bar is slimmer (more room for content)', r.tabH <= 52, `${r.tabH}px`);
    await ctx.close();
  }

  /* ---------- 5. floating ＋ never hides the last record; quick log buzzes (Android) ---------- */
  {
    const { p, ctx } = await open('Pixel 7', 'fab');
    await S(p, STAGES.baby); await S(p, () => { App.isNight = () => false; });
    await go(p, 'log', 400);
    const r = await S(p, () => {
      window.scrollTo(0, document.documentElement.scrollHeight);
      const fab = document.querySelector('.fab').getBoundingClientRect();
      const items = [...document.querySelectorAll('#view .tl-item, #view .list-item')].filter((e) => e.getBoundingClientRect().height);
      const last = items[items.length - 1].getBoundingClientRect();
      return { lastBottom: Math.round(last.bottom), fabTop: Math.round(fab.top) };
    });
    ok('log: at the end of the list the last record is fully above the floating ＋', r.lastBottom <= r.fabTop, JSON.stringify(r));
    await go(p, 'home', 400);
    await S(p, () => { window.__vibrations = []; });
    await p.tap('.qt-plus >> nth=2').catch(async () => { await S(p, () => App.babylog && App.babylog.quickLog ? App.babylog.quickLog('diaper') : null); });
    await p.waitForTimeout(300);
    const vib = await S(p, () => window.__vibrations.length);
    ok('one-tap logging gives a short buzz on Android phones', vib > 0, `${vib} vibrations`);
    await ctx.close();
  }

  ok('no page errors anywhere', !errors.length, errors.slice(0, 4).join(' | '));
  console.log('\n=== 手機好用度 ===');
  results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}${r.info && !r.pass ? `   [${r.info}]` : ''}`));
  console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`);
  if (results.some((r) => !r.pass)) process.exitCode = 1;
  await browser.close();
})().catch((e) => { console.error('SCRIPT ERROR', e); results.forEach((r) => console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}  ${r.info}`)); process.exit(1); });
