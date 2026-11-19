/* 易家做媽媽 — 祝福牆 (滿月／百日／週歲, or 好孕加油 while pregnant).
 * The mom opens a wall and shares its link; family and friends leave a short blessing on a public page (no app, no
 * sign-up). A blessing shows only after the mom approves it. She can turn the wall into a share card or print it.
 * Needs the member API; a wall's private key stays on the mom's phone (and in her backup file).
 *   screens 'wall' (the mom's) and 'wish' (public, ?w=<id>)   App.wall.open(occasion) */
(function () {
  const App = window.App;
  const { h, ui } = App;
  const store = App.store;
  const C = window.Core;

  const OCC = {
    preg: {
      name: '好孕加油牆', emoji: '🤰', theme: 'peach', sticker: '🌸',
      presets: ['好孕加油！平安順產 💜', '期待和寶寶見面！', '媽媽辛苦了，要好好休息', '需要幫忙隨時說！'],
    },
    month: {
      name: '滿月祝福牆', emoji: '🎉', theme: 'purple', sticker: '🎉',
      presets: ['滿月快樂！平安健康長大', '頭好壯壯、一眠大一吋', '歡迎來到這個世界 💜', '媽媽辛苦了，坐月子好好休息'],
    },
    hundred: {
      name: '百日祝福牆', emoji: '💯', theme: 'green', sticker: '⭐',
      presets: ['百日快樂！健康平安', '笑口常開、越來越可愛', '100 天了，爸媽辛苦了！', '平安長大，天天開心'],
    },
    year: {
      name: '週歲祝福牆', emoji: '🎂', theme: 'peach', sticker: '🎂',
      presets: ['生日快樂！一歲了 🎂', '抓週快樂，未來無限可能', '健康快樂地長大', '謝謝你帶給大家這麼多笑容'],
    },
  };
  const ORDER = ['preg', 'month', 'hundred', 'year'];
  const STICKERS = ['💜', '🎉', '🌸', '🍼', '🎂', '⭐', '🧸', '🌈'];
  const ERR = {
    no_wall: '這面祝福牆已經關閉，或連結不完整', too_many: '送出太多次了，請稍後再試', full: '這面牆的祝福已經滿了',
    empty: '請寫一句祝福', not_owner: '這支手機沒有這面牆的管理權', offline: '目前連不到，請檢查網路後再試',
  };
  const errText = (e) => ERR[e && e.code] || (e && e.name === 'AbortError' ? ERR.offline : '目前連不到，請稍後再試');

  const S = () => (App.social ? App.social.soc() : { walls: [], wrote: {} });
  const upd = (fn) => (App.social ? App.social.upd(fn) : null);
  const call = (m, p, b) => App.account.call(m, p, b);
  const occ = (w) => OCC[w && w.occasion] || OCC.month;
  const titleOf = (w) => (w.occasion === 'preg' ? `${w.mom || '媽咪'}的好孕加油牆` : `${w.baby || '寶寶'}的${occ(w).name}`);
  const myWall = (id) => (S().walls || []).find((w) => w.id === id);

  function suggest() {
    if (store.stage === 'preg' || (store.inStage && store.inStage(['preg']) && !(store.baby && store.baby()))) return 'preg';
    const b = store.baby && store.baby();
    const a = b && b.birthday ? C.babyAge(b.birthday) : null;
    if (!a || a.days < 0) return store.stage === 'baby' ? 'month' : 'preg';
    if (a.days < 70) return 'month';
    if (a.days < 250) return 'hundred';
    return 'year';
  }
  // home nudge windows: 滿月 (2–6 weeks), 百日 (80–115 days), 週歲 (340–380 days), 好孕加油 (24 weeks on)
  function nudgeFor() {
    if (store.stage === 'preg') {
      const lmp = store.state.profile.lmp;
      const g = lmp ? C.gestAge(lmp) : null;
      return g && g.weeks >= 24 && g.weeks < 41 ? 'preg' : null;
    }
    const b = store.baby && store.baby();
    const a = b && b.birthday ? C.babyAge(b.birthday) : null;
    if (!a) return null;
    if (a.days >= 14 && a.days <= 45) return 'month';
    if (a.days >= 80 && a.days <= 115) return 'hundred';
    if (a.days >= 340 && a.days <= 380) return 'year';
    return null;
  }

  /* ---------------- data ---------------- */
  const cache = new Map(); // wall id -> {wall, wishes, at}
  async function loadAdmin(w) {
    const r = await call('POST', `wall/${w.id}/admin`, { key: w.key });
    cache.set(w.id, { wall: r.wall, wishes: r.wishes, at: Date.now() });
    const pending = r.wishes.filter((x) => !x.ok).length;
    if (pending !== w.pending) upd((x) => { x.walls = (x.walls || []).map((y) => (y.id === w.id ? { ...y, pending, total: r.wishes.length } : y)); });
    return cache.get(w.id);
  }
  async function create({
    occasion, baby, mom, withAv,
  }) {
    const av = withAv && App.social ? App.social.publicAv() : null;
    const r = await call('POST', 'wall', {
      occasion, baby, mom, av,
    });
    const w = {
      id: r.id, key: r.key, occasion, baby: r.wall.baby, mom: r.wall.mom, av: r.wall.av || null, createdAt: new Date().toISOString(), pending: 0, total: 0,
    };
    upd((x) => { x.walls = [w, ...(x.walls || [])].slice(0, 20); });
    return w;
  }
  async function remove(w) {
    try { await call('POST', `wall/${w.id}/delete`, { key: w.key }); } catch (e) { if (e.code !== 'no_wall') throw e; }
    upd((x) => { x.walls = (x.walls || []).filter((y) => y.id !== w.id); });
    cache.delete(w.id);
  }

  /* ---------------- sharing ---------------- */
  function shareInvite(w) {
    const o = occ(w);
    App.share.open({
      spec: {
        emoji: o.emoji, kicker: o.name, title: titleOf(w), subtitle: '掃描 QR 碼，留下一句祝福', theme: o.theme, linesTitle: '大家可以這樣寫', lines: o.presets.slice(0, 3), footnote: '不用下載 App・媽媽確認後就會出現在牆上',
      },
      text: `${titleOf(w)}開張了！點連結留一句祝福${w.occasion === 'preg' ? '給準媽媽和寶寶' : `給${w.baby || '寶寶'}`}（不用下載 App）：`,
      title: titleOf(w), campaign: 'wish', path: 'wish', params: { w: w.id },
    });
  }
  const cardSpec = (w, wishes) => {
    const o = occ(w); const shown = wishes.filter((x) => x.ok !== false);
    return {
      emoji: o.emoji, kicker: o.name, title: titleOf(w), subtitle: `${shown.length} 則親友的祝福`, theme: o.theme,
      linesTitle: '親友的祝福', lines: shown.slice(-5).reverse().map((x) => `${x.sticker} ${x.name}：${x.text}`), footnote: shown.length > 5 ? `還有 ${shown.length - 5} 則祝福` : '',
      campaign: 'wish', path: 'wish', params: { w: w.id },
    };
  };
  async function saveCard(w, wishes) {
    ui.toast('產生圖片中…');
    try {
      const blob = await App.share.render(cardSpec(w, wishes));
      if (!blob) { ui.toast('這台裝置無法產生圖片'); return; }
      const how = await App.share.saveImage(blob, `${titleOf(w)}.png`, titleOf(w));
      if (how === 'downloaded') ui.toast('圖片已下載，可以傳到 LINE 或印出來');
      if (App.share.record && how !== 'cancel') App.share.record('image', 'wish');
    } catch (e) { ui.toast('圖片產生失敗，請再試一次'); }
  }

  /* ---------------- pieces ---------------- */
  const wishCard = (x, extra) => h('div', { class: `wish-card${x.ok === false ? ' pending' : ''}` },
    h('span', { class: 'wish-st', 'aria-hidden': 'true' }, x.sticker || '💜'),
    h('div', { class: 'grow' }, h('p', { class: 'wish-text' }, x.text), h('div', { class: 'wish-by' }, `— ${x.name}`)),
    extra || null);
  const hero = (w, sub) => {
    const o = occ(w);
    return h('div', { class: `wish-hero t-${o.theme}` },
      w.av && App.social ? App.social.chibi(w.av, 64) : h('span', { class: 'wish-hero-e', 'aria-hidden': 'true' }, o.emoji),
      h('div', { class: 'grow' }, h('div', { class: 'wish-kicker' }, `${o.emoji} ${o.name}`), h('h2', { class: 'wish-title' }, titleOf(w)), sub ? h('div', { class: 'wish-sub' }, sub) : null));
  };

  /* ================= the mom's screen ================= */
  let creating = null; // occasion picked from a nudge
  let pollTimer = 0;
  App.screen('wall', {
    title: '祝福牆',
    tab: 'me',
    liveUpdate: false,
    actions: () => h('button', { class: 'icon-btn', 'aria-label': '列印或存成 PDF', html: ui.ICONS.print, onclick: () => window.print() }),
    onLeave() { clearInterval(pollTimer); },
    render(el, params = {}) {
      clearInterval(pollTimer);
      const walls = S().walls || [];
      if (params.new || !walls.length || creating) { renderCreate(el, params.occasion || creating || suggest()); creating = null; return; }
      const w = myWall(params.id) || walls[0];
      if (walls.length > 1) {
        el.append(h('div', { class: 'wall-tabs no-print', role: 'tablist' }, walls.map((x) => h('button', {
          class: `chip${x.id === w.id ? ' on' : ''}`, role: 'tab', 'aria-selected': x.id === w.id ? 'true' : 'false', onclick: () => App.navigate('wall', { id: x.id }),
        }, `${occ(x).emoji} ${occ(x).name}${x.pending ? `・${x.pending}` : ''}`)), h('button', { class: 'chip', onclick: () => App.navigate('wall', { new: 1 }) }, '＋ 新的一面')));
      }
      const box = h('div', { class: 'stack' });
      el.append(box);
      const draw = (data, err) => {
        box.innerHTML = '';
        const wishes = (data && data.wishes) || [];
        const pending = wishes.filter((x) => !x.ok); const shown = wishes.filter((x) => x.ok);
        box.append(hero(w, `${shown.length} 則祝福${pending.length ? `・${pending.length} 則等你確認` : ''}`));
        if (err) box.append(h('p', { class: 'login-err' }, errText(err)));
        box.append(h('div', { class: 'wall-btns no-print' },
          h('button', { class: 'btn btn-primary btn-block', onclick: () => shareInvite(w) }, '📤 分享給親友留言'),
          h('div', { class: 'row gap-sm' },
            h('button', { class: 'btn btn-soft grow', disabled: !shown.length, onclick: () => saveCard(w, shown) }, '🖼️ 存成祝福卡'),
            h('button', { class: 'btn btn-ghost grow', onclick: () => App.navigate('wish', { w: w.id }) }, '👀 親友看到的樣子'))));
        if (pending.length) {
          box.append(h('div', { class: 'card no-print' },
            h('div', { class: 'row gap' }, h('div', { class: 'card-title grow' }, `💌 等你確認（${pending.length}）`),
              pending.length > 1 ? h('button', { class: 'btn btn-sm btn-soft', onclick: () => act(null, 'approveAll') }, '全部顯示') : null),
            h('p', { class: 'tiny muted' }, '按「顯示」才會出現在牆上，不想公開的可以刪除。'),
            h('div', { class: 'stack-sm' }, pending.map((x) => wishCard(x, h('div', { class: 'wish-mod' },
              h('button', { class: 'btn btn-sm btn-primary', 'aria-label': `顯示 ${x.name} 的祝福`, onclick: () => act(x, 'approve') }, '顯示'),
              h('button', { class: 'btn btn-sm btn-ghost', 'aria-label': `刪除 ${x.name} 的祝福`, onclick: () => act(x, 'remove') }, '刪除')))))));
        }
        box.append(h('div', { class: 'card wall-shown' },
          h('div', { class: 'card-title' }, `${occ(w).emoji} 牆上的祝福（${shown.length}）`),
          shown.length ? h('div', { class: 'stack-sm' }, shown.map((x) => wishCard(x, h('button', { class: 'btn btn-sm btn-ghost no-print', 'aria-label': `從牆上收起 ${x.name} 的祝福`, onclick: () => act(x, 'hide') }, '收起'))))
            : h('p', { class: 'small muted' }, data ? '還沒有祝福。把連結分享到家族群組，大家就能留言了！' : '載入中…')));
        box.append(h('p', { class: 'tiny muted no-print' }, '知道連結的人都看得到牆上「已顯示」的祝福；寶寶的生日、照片和任何紀錄都不會出現在這裡。'),
          h('button', {
            class: 'btn btn-ghost btn-block no-print danger-text',
            onclick: async () => {
              if (!(await ui.confirm(`刪除「${titleOf(w)}」？牆上的祝福會一起刪除，連結也會失效。`, { ok: '刪除', danger: true }))) return;
              try { await remove(w); ui.toast('已刪除'); App.navigate('wall', { n: Date.now() }); } catch (e) { ui.toast(errText(e)); }
            },
          }, '刪除這面祝福牆'));
      };
      async function act(x, action) {
        try {
          const r = await call('POST', `wall/${w.id}/moderate`, { key: w.key, wid: x && x.id, action });
          cache.set(w.id, { wishes: r.wishes, at: Date.now() });
          lastSeen = JSON.stringify(r.wishes);
          draw(cache.get(w.id));
          if (action === 'approve' || action === 'approveAll') { ui.toast('已顯示在牆上 💜'); ui.celebrate && ui.celebrate({ emojis: [occ(w).sticker, '💜', '✨'] }); }
          loadAdmin(w).catch(() => {});
        } catch (e) { ui.toast(errText(e)); }
      }
      draw(cache.get(w.id) || null);
      let lastSeen = '';
      // redraw only when something changed (a 30-second refresh must not swap buttons under a finger)
      const refresh = () => loadAdmin(w).then((d) => { const j = JSON.stringify(d.wishes); if (j !== lastSeen) { lastSeen = j; draw(d); } }).catch((e) => { lastSeen = ''; draw(cache.get(w.id), e); });
      refresh();
      pollTimer = setInterval(() => { if (document.visibilityState === 'visible' && document.body.dataset.screen === 'wall') refresh(); }, 30000);
    },
  });

  function renderCreate(el, pick) {
    let occasion = OCC[pick] ? pick : suggest();
    const b = store.baby && store.baby();
    const baby = h('input', {
      class: 'input', type: 'text', maxlength: 10, value: (b && b.name) || '', placeholder: '例如：小湯圓', 'aria-label': '寶寶的名字或小名',
    });
    const mom = h('input', {
      class: 'input', type: 'text', maxlength: 10, value: store.state.profile.momName || '', placeholder: '例如：小美', 'aria-label': '媽媽的名稱',
    });
    const hasAv = !!(App.avatar && App.avatar.current());
    const withAv = h('input', { type: 'checkbox', checked: hasAv });
    const err = h('p', { class: 'login-err', hidden: true });
    const preview = h('div');
    const drawPreview = () => {
      preview.innerHTML = '';
      preview.append(hero({
        occasion, baby: baby.value.trim() || '寶寶', mom: mom.value.trim(), av: withAv.checked && App.social ? App.social.publicAv() : null,
      }, '親友打開連結就能留下祝福'));
    };
    [baby, mom].forEach((i) => i.addEventListener('input', drawPreview));
    withAv.addEventListener('change', drawPreview);
    const segEl = h('div');
    const drawSeg = () => {
      segEl.innerHTML = '';
      segEl.append(h('div', { class: 'wall-occ', role: 'radiogroup', 'aria-label': '祝福牆種類' }, ORDER.map((k) => h('button', {
        class: `wall-occ-b${k === occasion ? ' on' : ''}`, role: 'radio', 'aria-checked': k === occasion ? 'true' : 'false',
        onclick: () => { occasion = k; drawSeg(); drawPreview(); },
      }, h('span', { 'aria-hidden': 'true' }, OCC[k].emoji), h('span', null, OCC[k].name)))));
    };
    drawSeg(); drawPreview();
    const submit = h('button', { class: 'btn btn-primary btn-block' }, '開一面祝福牆');
    const available = h('div');
    el.append(h('div', { class: 'stack' },
      h('div', { class: 'card soft' }, h('div', { class: 'card-title' }, '💌 祝福牆'), h('p', { class: 'small' }, '滿月、百日、週歲（或懷孕時的好孕加油），開一面牆、把連結傳到家族群組。親友不用下載 App 就能留言，你按「顯示」才會出現在牆上，最後可以存成一張祝福卡。')),
      segEl, preview,
      ui.field('寶寶的名字或小名', baby, '會顯示在牆的標題，可以只寫小名'),
      ui.field('媽媽的名稱', mom),
      h('label', { class: 'row gap-sm wall-av' }, withAv, h('span', null, hasAv ? '放上我的 Q 版角色（畫的版本，不會用照片）' : '放上 Q 版角色（還沒做角色，會用預設樣子）')),
      err, submit, available,
      h('p', { class: 'tiny muted' }, '知道連結的人都看得到你確認過的祝福。寶寶的生日、照片和紀錄都不會放上去。')));
    submit.addEventListener('click', async () => {
      err.hidden = true; submit.disabled = true; submit.textContent = '建立中…';
      try {
        const w = await create({
          occasion, baby: baby.value.trim(), mom: mom.value.trim(), withAv: withAv.checked,
        });
        ui.celebrate && ui.celebrate({ emojis: [OCC[occasion].emoji, '💌', '✨'] });
        App.navigate('wall', { id: w.id });
        setTimeout(() => shareInvite(w), 500);
      } catch (e) {
        err.textContent = e.code === 'too_many' ? '今天建立太多面牆了，明天再試' : errText(e); err.hidden = false;
        submit.disabled = false; submit.textContent = '開一面祝福牆';
      }
    });
    (App.social ? App.social.api() : Promise.resolve(false)).then((ok) => {
      if (ok) return;
      submit.disabled = true;
      available.append(h('p', { class: 'small muted center' }, '祝福牆需要連上會員服務，目前連不到；連上網路後再試試。'));
    });
  }

  /* ================= the public page friends open ================= */
  App.screen('wish', {
    title: '祝福牆',
    liveUpdate: false,
    render(el, params = {}) {
      const id = String(params.w || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12);
      const box = h('div', { class: 'stack wish-page' }, h('p', { class: 'center muted mt' }, '打開祝福牆中…'));
      el.append(box);
      if (!id) { box.innerHTML = ''; box.append(h('p', { class: 'center muted mt' }, ERR.no_wall)); return; }
      const mine = myWall(id);
      const draw = (data) => {
        box.innerHTML = '';
        const w = data.wall; const o = occ(w);
        const wrote = ((S().wrote || {})[id] || []).filter((x) => !data.wishes.some((y) => y.id === x.id));
        box.append(hero(w, mine ? '這是你的祝福牆' : `${w.mom || '媽咪'}邀請你留下一句祝福`));
        if (mine) box.append(h('button', { class: 'btn btn-soft btn-block', onclick: () => App.navigate('wall', { id }) }, '⚙️ 管理這面牆（確認祝福、分享）'));
        box.append(h('div', { class: 'wish-wall', 'aria-label': '牆上的祝福' },
          data.wishes.length || wrote.length ? [...data.wishes.map((x) => wishCard(x)), ...wrote.map((x) => wishCard({ ...x, ok: false }, h('span', { class: 'tag' }, '等媽媽確認')))]
            : h('p', { class: 'center muted small wish-first' }, `成為第一個留下祝福的人 ${o.sticker}`)));
        box.append(form(w));
        box.append(h('div', { class: 'card soft wish-cta' },
          h('div', { class: 'card-title' }, `${(window.BRAND || {}).appName || '易家做媽媽'}`),
          h('p', { class: 'small' }, '從備孕、懷孕到育兒的記錄小幫手：產檢日記、寶寶紀錄、好孕群島，免費使用。'),
          h('button', { class: 'btn btn-ghost btn-block', onclick: () => App.navigate(store.state.onboarded ? 'home' : 'onboarding') }, store.state.onboarded ? '回到我的 App' : '我也來試試')));
      };
      const form = (w) => {
        const o = occ(w);
        let sticker = o.sticker;
        const name = h('input', {
          class: 'input', type: 'text', maxlength: 10, placeholder: '例如：阿嬤、小美阿姨', value: S().wishName || '', 'aria-label': '你的名字',
        });
        const text = h('textarea', {
          class: 'input', maxlength: 60, rows: 3, placeholder: '寫一句祝福（最多 60 字）', 'aria-label': '祝福的話',
        });
        const count = h('span', { class: 'tiny muted' }, '0 / 60');
        text.addEventListener('input', () => { count.textContent = `${[...text.value].length} / 60`; });
        const presets = h('div', { class: 'wish-presets' }, o.presets.map((p) => h('button', { type: 'button', class: 'chip', onclick: () => { text.value = p; text.dispatchEvent(new Event('input')); } }, p)));
        const stickers = h('div', { class: 'wish-stickers', role: 'radiogroup', 'aria-label': '選一個貼圖' });
        const drawStickers = () => {
          stickers.innerHTML = '';
          STICKERS.forEach((s) => stickers.append(h('button', {
            type: 'button', class: `wish-stk${s === sticker ? ' on' : ''}`, role: 'radio', 'aria-checked': s === sticker ? 'true' : 'false', 'aria-label': `貼圖 ${s}`, onclick: () => { sticker = s; drawStickers(); },
          }, s)));
        };
        drawStickers();
        const err = h('p', { class: 'login-err', hidden: true });
        const send = h('button', { class: 'btn btn-primary btn-block', type: 'submit' }, `送出祝福 ${o.sticker}`);
        const f = h('form', { class: 'card wish-form', novalidate: true },
          h('div', { class: 'card-title' }, '✍️ 留下你的祝福'),
          ui.field('你的名字', name),
          h('div', { class: 'small muted' }, '點一下就能用：'), presets,
          ui.field('祝福的話', h('div', null, text, h('div', { class: 'wish-count' }, count))),
          ui.field('貼圖', stickers),
          err, send,
          h('p', { class: 'tiny muted' }, '媽媽確認後才會出現在牆上。請不要留下電話、地址或連結。'));
        f.addEventListener('submit', async (e) => {
          e.preventDefault();
          if (!text.value.trim()) { err.textContent = ERR.empty; err.hidden = false; text.focus(); return; }
          err.hidden = true; send.disabled = true; send.textContent = '送出中…';
          try {
            const r = await call('POST', `wall/${w.id}/wish`, { name: name.value, text: text.value, sticker });
            upd((x) => {
              x.wishName = name.value.trim().slice(0, 10);
              x.wrote = { ...(x.wrote || {}) }; x.wrote[w.id] = [...(x.wrote[w.id] || []), r.wish].slice(-10);
            });
            ui.celebrate && ui.celebrate({ from: send, emojis: [sticker, '💜', '✨'], big: true });
            ui.toast('已送出！媽媽確認後就會出現在牆上 💜', { ms: 3500 });
            load();
          } catch (ex) {
            err.textContent = errText(ex); err.hidden = false; send.disabled = false; send.textContent = `送出祝福 ${o.sticker}`;
          }
        });
        return f;
      };
      const load = () => call('GET', `wall/${id}`).then(draw).catch((e) => {
        box.innerHTML = '';
        box.append(h('div', { class: 'card soft center' }, h('div', { class: 'wish-hero-e', 'aria-hidden': 'true' }, '💌'), h('p', null, errText(e)),
          e.code === 'no_wall' ? null : h('button', { class: 'btn btn-soft', onclick: () => { box.innerHTML = ''; box.append(h('p', { class: 'center muted mt' }, '打開祝福牆中…')); load(); } }, '再試一次')));
      });
      load();
    },
  });

  /* ================= 首頁 ================= */
  let lastCheck = 0;
  function checkPending() {
    const walls = S().walls || [];
    if (!walls.length || Date.now() - lastCheck < 10 * 60 * 1000 || document.visibilityState !== 'visible') return;
    lastCheck = Date.now();
    walls.slice(0, 3).forEach((w) => loadAdmin(w).then(() => { if (App.homeRefresh) App.homeRefresh(); }).catch((e) => {
      if (e.code === 'no_wall') upd((x) => { x.walls = (x.walls || []).filter((y) => y.id !== w.id); });
    }));
  }
  setTimeout(() => { if (App.social) App.social.api().then((ok) => { if (ok) checkPending(); }); }, 2500);
  setInterval(checkPending, 60 * 1000);

  App.homeCard('wall', {
    stages: ['preg', 'baby'],
    order: 7,
    render(el) {
      if (!App.social || App.social.isReady() !== true) return;
      const walls = S().walls || [];
      const waiting = walls.find((w) => w.pending);
      if (waiting) {
        el.append(h('button', { type: 'button', class: 'card wall-home', onclick: () => App.navigate('wall', { id: waiting.id }) },
          h('span', { class: 'wall-home-e', 'aria-hidden': 'true' }, '💌'),
          h('span', { class: 'grow' }, h('strong', null, `${titleOf(waiting)}有 ${waiting.pending} 則新祝福`), h('span', { class: 'small muted' }, '確認後就會出現在牆上')),
          h('span', { class: 'soc-dot' }, String(waiting.pending))));
        return;
      }
      const k = nudgeFor();
      if (!k || walls.some((w) => w.occasion === k) || (S().wallSkip || {})[k]) return;
      const o = OCC[k];
      const b = store.baby && store.baby();
      el.append(h('div', { class: 'card wall-home' },
        h('span', { class: 'wall-home-e', 'aria-hidden': 'true' }, o.emoji),
        h('button', { type: 'button', class: 'grow wall-home-main', onclick: () => { creating = k; App.navigate('wall', { new: 1, occasion: k }); } },
          h('strong', null, k === 'preg' ? '開一面好孕加油牆' : `${(b && b.name) || '寶寶'}的${o.name.slice(0, 2)}快到了！`),
          h('span', { class: 'small muted' }, '把連結傳到家族群組，親友不用下載 App 就能留祝福')),
        h('button', { class: 'icon-btn', 'aria-label': '不用了', onclick: () => { upd((x) => { x.wallSkip = { ...(x.wallSkip || {}), [k]: C.dateKey() }; }); if (App.homeRefresh) App.homeRefresh(); } }, '✕')));
    },
  });

  App.tool({
    id: 'wall', title: '祝福牆', icon: '💌', desc: '滿月、百日、週歲，親友留言祝福', stages: ['preg', 'baby'], screen: 'wall', order: 62, group: '媽媽', tags: ['滿月', '百日', '週歲', '祝福', '收涎', '抓週', '親友'],
  });

  App.wall = {
    OCC, titleOf, create, remove, loadAdmin, suggest, nudgeFor,
  };
}());
