/* 易家做媽媽 — 我的 Q 版角色.
 * A mom takes (or picks) a front-facing photo; on this phone only, the app reads her skin and hair colour from the
 * area inside the face guide and draws a big-head chibi of her (or puts her own face on the chibi body). The original
 * photo is never uploaded or kept; only the small face crop is kept if she chooses the 「照片大頭」 style.
 * The chibi shows her stage: a round belly while pregnant, a baby in her arms after birth.
 *   App.avatar.svg(av, {pose, size})  App.avatar.dataUrl(av)  App.avatar.current()  App.avatar.head(size)  screen 'avatar' */
(function () {
  const App = window.App = window.App || {};
  const { h, ui } = App;
  const store = App.store;
  const C = window.Core;

  const HAIR_STYLES = [['long', '長髮'], ['pony', '馬尾'], ['bun', '丸子頭'], ['bob', '鮑伯頭'], ['short', '短髮'], ['curly', '捲髮']];
  const EYES = [['round', '圓圓眼'], ['smile', '笑眼'], ['lash', '長睫毛']];
  const SKINS = ['#fbe0cf', '#f6d2b8', '#eebf9c', '#dca47e', '#c08660', '#94603f'];
  const HAIRS = ['#2b2020', '#4a3428', '#6e4a32', '#9a6a43', '#c79b62', '#8a4a5a'];
  const OUTFITS = ['#8b57a8', '#e7809a', '#6476d6', '#4fa77a', '#ef9b4b', '#5e86c6'];
  const DEFAULT = { v: 1, mode: 'draw', skin: '#f6d2b8', hair: '#3a2a24', style: 'long', eyes: 'round', glasses: false, blush: true, outfit: '#8b57a8' };

  /* ---------- colour helpers ---------- */
  const hex2rgb = (hx) => { const n = parseInt(String(hx).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const A = hex2rgb(a); const B = hex2rgb(b); return rgb2hex(...A.map((v, i) => v + (B[i] - v) * t)); };
  const safe = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fallback);

  /* ---------- the chibi, as SVG (viewBox 120 × 150) ---------- */
  let seq = 0;
  function svg(avIn, { pose = null, size = 120, ground = true } = {}) {
    const av = { ...DEFAULT, ...(avIn || {}) };
    const skin = safe(av.skin, DEFAULT.skin); const hair = safe(av.hair, DEFAULT.hair); const outfit = safe(av.outfit, DEFAULT.outfit);
    const line = '#3b2a35'; const hairD = mix(hair, '#000000', 0.25); const skinD = mix(skin, '#8a4a3a', 0.25); const outfitD = mix(outfit, '#000000', 0.22); const outfitL = mix(outfit, '#ffffff', 0.22);
    const p = pose || (store && store.stage === 'preg' ? 'preg' : store && store.stage === 'baby' && store.baby && store.baby() ? 'baby' : 'plain');
    const id = `av${(seq += 1)}${Math.random().toString(36).slice(2, 6)}`;
    const o = [];
    if (ground) o.push(`<ellipse cx="60" cy="146" rx="28" ry="4" fill="rgba(40,20,50,.16)"/>`); // (not on a sticker)
    // legs + shoes
    o.push(`<rect x="49" y="128" width="9" height="13" rx="4" fill="${skin}" stroke="${skinD}" stroke-width="1"/><rect x="62" y="128" width="9" height="13" rx="4" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
    o.push(`<ellipse cx="53" cy="142" rx="7" ry="3.6" fill="#5b4a52"/><ellipse cx="67" cy="142" rx="7" ry="3.6" fill="#5b4a52"/>`);
    // back hair (behind everything above the shoulders)
    const BACK = {
      long: `<path d="M20 60 Q16 22 60 17 Q104 22 100 60 L104 114 Q92 122 80 108 L40 108 Q28 122 16 114 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/>`,
      pony: `<path d="M22 60 Q18 22 60 18 Q102 22 98 60 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/><path d="M92 34 Q118 44 110 92 Q106 104 98 98 Q106 70 90 46 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/><circle cx="93" cy="38" r="5" fill="${outfit}"/>`,
      bun: `<circle cx="60" cy="15" r="13" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/><path d="M22 60 Q18 22 60 18 Q102 22 98 60 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/>`,
      bob: `<path d="M18 62 Q14 20 60 17 Q106 20 102 62 L102 88 Q92 96 84 86 L36 86 Q28 96 18 88 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/>`,
      short: `<path d="M22 64 Q16 20 60 17 Q104 20 98 64 Q94 70 92 62 L28 62 Q26 70 22 64 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/>`,
      curly: [[22, 40], [18, 58], [20, 76], [24, 94], [30, 108], [36, 28], [50, 19], [70, 19], [84, 28], [98, 40], [102, 58], [100, 76], [96, 94], [90, 108]]
        .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="13" fill="${hair}" stroke="${hairD}" stroke-width="1.5"/>`).join(''),
    };
    o.push(BACK[av.style] || BACK.long);
    // body: a dress; with a belly while pregnant
    o.push(`<path d="M44 94 Q60 88 76 94 L88 132 Q60 140 32 132 Z" fill="${outfit}" stroke="${outfitD}" stroke-width="1.5"/>`);
    o.push(`<path d="M50 94 Q60 101 70 94" fill="none" stroke="${outfitL}" stroke-width="2.4" stroke-linecap="round"/>`);
    if (p === 'preg') {
      o.push(`<ellipse cx="62" cy="117" rx="17" ry="14" fill="${outfitL}" stroke="${outfitD}" stroke-width="1.5"/>`);
      o.push(`<path d="M62 121 C55 115 56 110 59.5 110 C61 110 62 111 62 112.5 C62 111 63 110 64.5 110 C68 110 69 115 62 121 Z" fill="#fff" opacity=".85"/>`);
      o.push(`<ellipse cx="38" cy="112" rx="5" ry="9" transform="rotate(18 38 112)" fill="${skin}" stroke="${skinD}" stroke-width="1"/><ellipse cx="78" cy="118" rx="5.5" ry="8" transform="rotate(-60 78 118)" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
    } else if (p === 'baby') {
      o.push(`<ellipse cx="60" cy="113" rx="19" ry="12" fill="#fbe3ea" stroke="#e7a7b8" stroke-width="1.5"/>`);
      o.push(`<circle cx="69" cy="108" r="7" fill="${mix(skin, '#ffffff', 0.15)}" stroke="${skinD}" stroke-width="1"/><path d="M66.5 108 h1.6 M70.5 108 h1.6" stroke="${line}" stroke-width="1.4" stroke-linecap="round"/><path d="M67.5 111 Q69.3 112.6 71 111" fill="none" stroke="${line}" stroke-width="1" stroke-linecap="round"/>`);
      o.push(`<ellipse cx="44" cy="114" rx="9" ry="5" fill="${skin}" stroke="${skinD}" stroke-width="1"/><ellipse cx="76" cy="118" rx="9" ry="5" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
    } else {
      o.push(`<ellipse cx="36" cy="112" rx="5" ry="10" transform="rotate(14 36 112)" fill="${skin}" stroke="${skinD}" stroke-width="1"/><ellipse cx="84" cy="112" rx="5" ry="10" transform="rotate(-14 84 112)" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
    }
    // neck, ears, head
    o.push(`<rect x="55" y="84" width="10" height="10" rx="3" fill="${skin}"/>`);
    if (av.mode === 'photo' && av.face) {
      o.push(`<clipPath id="${id}c"><circle cx="60" cy="58" r="37"/></clipPath>`);
      o.push(`<circle cx="60" cy="58" r="39.5" fill="#fff"/><image href="${av.face}" x="23" y="21" width="74" height="74" clip-path="url(#${id}c)" preserveAspectRatio="xMidYMid slice"/>`);
      o.push(`<circle cx="60" cy="58" r="38.5" fill="none" stroke="${hairD}" stroke-width="2"/>`);
    } else {
      o.push(`<circle cx="23" cy="62" r="6" fill="${skin}" stroke="${skinD}" stroke-width="1"/><circle cx="97" cy="62" r="6" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
      o.push(`<circle cx="60" cy="58" r="38" fill="${skin}" stroke="${skinD}" stroke-width="1.2"/>`);
      // eyes
      if (av.eyes === 'smile') o.push(`<path d="M40 65 Q46 58 52 65 M68 65 Q74 58 80 65" fill="none" stroke="${line}" stroke-width="2.8" stroke-linecap="round"/>`);
      else {
        o.push(`<ellipse cx="46" cy="64" rx="5.2" ry="6.4" fill="${line}"/><ellipse cx="74" cy="64" rx="5.2" ry="6.4" fill="${line}"/>`);
        o.push(`<circle cx="47.8" cy="61.6" r="1.9" fill="#fff"/><circle cx="75.8" cy="61.6" r="1.9" fill="#fff"/><circle cx="44.6" cy="66.4" r=".9" fill="#fff"/><circle cx="72.6" cy="66.4" r=".9" fill="#fff"/>`);
        if (av.eyes === 'lash') o.push(`<path d="M40.5 60 l-3 -2.4 M41.6 58.2 l-2.2 -3 M79.5 60 l3 -2.4 M78.4 58.2 l2.2 -3" stroke="${line}" stroke-width="1.6" stroke-linecap="round"/>`);
      }
      o.push(`<path d="M40 52 Q46 49 51 52 M69 52 Q74 49 80 52" fill="none" stroke="${hairD}" stroke-width="2" stroke-linecap="round"/>`);
      if (av.blush !== false) o.push(`<ellipse cx="38.5" cy="74" rx="6.5" ry="3.6" fill="#f5a3b5" opacity=".65"/><ellipse cx="81.5" cy="74" rx="6.5" ry="3.6" fill="#f5a3b5" opacity=".65"/>`);
      o.push(`<path d="M55 77 Q60 82.5 65 77" fill="none" stroke="#b0485a" stroke-width="2.2" stroke-linecap="round"/>`);
      if (av.glasses) o.push(`<circle cx="46" cy="64" r="10" fill="rgba(255,255,255,.18)" stroke="${line}" stroke-width="2"/><circle cx="74" cy="64" r="10" fill="rgba(255,255,255,.18)" stroke="${line}" stroke-width="2"/><path d="M56 63 Q60 60.5 64 63" fill="none" stroke="${line}" stroke-width="2"/>`);
      // bangs
      const BANGS = {
        short: `<path d="M22 60 Q20 22 60 19 Q100 22 98 58 Q90 40 70 36 Q58 48 30 50 Q26 54 22 60 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.2"/>`,
        default: `<path d="M22 58 Q22 22 60 19 Q98 22 98 58 Q90 42 76 40 Q70 50 58 44 Q50 50 40 44 Q30 48 22 58 Z" fill="${hair}" stroke="${hairD}" stroke-width="1.2"/>`,
      };
      o.push(BANGS[av.style === 'short' ? 'short' : 'default']);
      if (av.style === 'curly') o.push(`<circle cx="34" cy="34" r="9" fill="${hair}"/><circle cx="86" cy="34" r="9" fill="${hair}"/>`);
      o.push(`<ellipse cx="44" cy="32" rx="8" ry="3" fill="#fff" opacity=".25" transform="rotate(-20 44 32)"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 150" width="${size}" height="${Math.round(size * 1.25)}" role="img" aria-label="我的 Q 版角色">${o.join('')}</svg>`;
  }
  const dataUrl = (av, opts) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg(av, opts))}`;
  const current = () => (store.state.profile && store.state.profile.avatar) || null;
  // a round head for small places (HUD, greeting); null when no character yet
  function head(size = 36, av = current()) {
    if (!av) return null;
    const el = h('span', { class: 'av-head', style: { width: `${size}px`, height: `${size}px` }, 'aria-hidden': 'true' });
    // the head (x 18–102, y 17–96 of 120 × 150) fills the circle
    el.innerHTML = svg(av, { pose: 'plain', size: Math.round(size * 1.45) });
    const sv = el.firstChild; if (sv) sv.style.marginTop = `${Math.round(-size * 0.2)}px`;
    return el;
  }

  /* ---------- reading colours from the photo (inside the face guide) ---------- */
  function boxAvg(ctx, x, y, r) {
    const d = ctx.getImageData(Math.max(0, Math.round(x - r)), Math.max(0, Math.round(y - r)), Math.max(1, Math.round(r * 2)), Math.max(1, Math.round(r * 2))).data;
    let R = 0; let G = 0; let B = 0; let n = 0;
    for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n += 1; }
    return n ? [R / n, G / n, B / n] : [200, 170, 150];
  }
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  // ox, oy, ow, oh: the face oval on the canvas
  function analyse(ctx, ox, oy, ow, oh) {
    const at = (fx, fy, r = Math.max(3, ow * 0.05)) => boxAvg(ctx, ox + ow * fx, oy + oh * fy, r);
    const cheeks = [at(0.32, 0.62), at(0.68, 0.62), at(0.5, 0.5)];
    const skinRaw = cheeks.map((c, i) => c.map((v, k) => v / 3 + (i ? 0 : 0))).reduce((a, c) => a.map((v, k) => v + c[k]), [0, 0, 0]);
    const hairRaw = [at(0.5, -0.05), at(0.2, 0.08), at(0.8, 0.08)].sort((a, b) => (a[0] + a[1] + a[2]) - (b[0] + b[1] + b[2]))[0]; // the darkest of the three: hair, not background
    const sides = [at(-0.04, 0.9), at(1.04, 0.9)];
    const longHair = sides.filter((s) => dist(s, hairRaw) < 70).length >= 1;
    // stylise: skin a little lighter and warmer, hair a little richer, so the chibi looks friendly
    const skin = mix(rgb2hex(...skinRaw), '#f6d2b8', 0.35);
    const hair = mix(rgb2hex(...hairRaw), '#000000', 0.12);
    return { skin, hair, style: longHair ? 'long' : 'bob' };
  }

  /* ---------- photo step: fit the face in the guide, then read the colours ---------- */
  function photoSheet(file, onDone) {
    const W = 280; const H = 340; const OW = 168; const OH = 210; const OX = (W - OW) / 2; const OY = 46;
    const cv = h('canvas', { width: W * 2, height: H * 2, class: 'av-crop-cv', style: { width: `${W}px`, height: `${H}px` } });
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    const src = URL.createObjectURL(file);
    const st = { k: 1, x: 0, y: 0, img: null };
    const draw = () => {
      ctx.setTransform(2, 0, 0, 2, 0, 0); ctx.fillStyle = '#ddd'; ctx.fillRect(0, 0, W, H);
      if (st.img) ctx.drawImage(st.img, st.x, st.y, st.img.naturalWidth * st.k, st.img.naturalHeight * st.k);
    };
    const zoom = h('input', { type: 'range', min: '0.5', max: '3', step: '0.01', value: '1', 'aria-label': '放大縮小' });
    let base = 1;
    zoom.addEventListener('input', () => {
      const nk = base * Number(zoom.value); const cx = W / 2; const cy = OY + OH / 2;
      st.x = cx - ((cx - st.x) / st.k) * nk; st.y = cy - ((cy - st.y) / st.k) * nk; st.k = nk; draw();
    });
    App.media.loadImage(src).then((im) => {
      st.img = im; base = Math.max(OW * 1.5 / im.naturalWidth, OH * 1.5 / im.naturalHeight); st.k = base;
      st.x = (W - im.naturalWidth * st.k) / 2; st.y = OY + OH / 2 - (im.naturalHeight * st.k) / 2; draw();
    }).catch(() => { ui.toast('無法讀取這張照片'); });
    let drag = null;
    cv.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, sx: st.x, sy: st.y }; try { cv.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    cv.addEventListener('pointermove', (e) => { if (!drag) return; st.x = drag.sx + (e.clientX - drag.x); st.y = drag.sy + (e.clientY - drag.y); draw(); });
    ['pointerup', 'pointercancel'].forEach((ev) => cv.addEventListener(ev, () => { drag = null; }));
    const guide = h('div', { class: 'av-crop-guide', style: { left: `${OX}px`, top: `${OY}px`, width: `${OW}px`, height: `${OH}px` }, 'aria-hidden': 'true' });
    const sh = ui.sheet({
      title: '把臉放進框框裡',
      body: h('div', null,
        h('div', { class: 'av-crop', style: { width: `${W}px`, height: `${H}px` } }, cv, guide),
        h('p', { class: 'small muted center' }, '拖曳移動、拉桿放大，讓臉剛好在橢圓形裡（頭髮露在框外一點點最準）。'),
        ui.field('放大', zoom),
        h('p', { class: 'tiny faint' }, '🔒 照片只在你的手機上處理，不會上傳，原圖也不會存下來。')),
      footer: h('button', {
        class: 'btn btn-primary btn-block',
        onclick: () => {
          if (!st.img) return;
          draw();
          const ctxRead = cv.getContext('2d', { willReadFrequently: true });
          ctxRead.setTransform(1, 0, 0, 1, 0, 0);
          const got = analyse(ctxRead, OX * 2, OY * 2, OW * 2, OH * 2);
          // the small face crop, kept only for the 「照片大頭」 style
          const fc = document.createElement('canvas'); fc.width = 160; fc.height = 160;
          const side = OW * 2 * 1.02;
          fc.getContext("2d").drawImage(cv, OX * 2 + (OW * 2 - side) / 2, OY * 2 + (OH * 2 - side) / 2 + OH * 2 * 0.06, side, side, 0, 0, 160, 160);
          got.face = fc.toDataURL('image/jpeg', 0.85);
          URL.revokeObjectURL(src);
          sh.close(); onDone(got);
        },
      }, '✨ 產生我的 Q 版角色'),
      onClose: () => URL.revokeObjectURL(src),
    });
  }

  /* ---------- the maker screen ---------- */
  function save(patch) {
    store.update((s) => { s.profile.avatar = { ...DEFAULT, ...(s.profile.avatar || {}), ...patch, updatedAt: new Date().toISOString() }; });
  }
  function swatches(list, val, onPick, label) {
    return h('div', { class: 'av-swatches', role: 'radiogroup', 'aria-label': label },
      list.map((c) => h('button', { type: 'button', class: `swatch${c === val ? ' on' : ''}`, style: { background: c }, role: 'radio', 'aria-checked': c === val ? 'true' : 'false', 'aria-label': c, onclick: () => onPick(c) })));
  }
  const chips = (list, val, onPick, label) => h('div', { class: 'chips wrap', role: 'radiogroup', 'aria-label': label },
    list.map(([v, t]) => h('button', { type: 'button', class: `chip${v === val ? ' on' : ''}`, role: 'radio', 'aria-checked': v === val ? 'true' : 'false', onclick: () => onPick(v) }, t)));

  App.screen('avatar', {
    title: '我的 Q 版角色',
    tab: 'me',
    render(el) {
      const av = current();
      const a = { ...DEFAULT, ...(av || {}) };
      const name = store.state.profile.momName || '';
      const fileCam = h('input', { type: 'file', accept: 'image/*', capture: 'user', class: 'hide' });
      const fileLib = h('input', { type: 'file', accept: 'image/*', class: 'hide' });
      const onFile = (inp) => () => {
        const f = inp.files && inp.files[0]; if (!f) return;
        photoSheet(f, (got) => {
          save({ skin: got.skin, hair: got.hair, style: got.style, face: got.face, auto: { skin: got.skin, hair: got.hair } });
          ui.celebrate({ emojis: ['✨', '💜', '🌸'] });
          ui.toast('角色好了！可以再調整髮型、眼睛和衣服');
        });
        inp.value = '';
      };
      fileCam.addEventListener('change', onFile(fileCam)); fileLib.addEventListener('change', onFile(fileLib));
      const preview = h('div', { class: 'av-preview' }); preview.innerHTML = svg(a, { size: 150 });
      el.append(ui.card({ class: 'av-hero' },
        preview,
        h('div', { class: 'av-hero-t' }, av ? `${name || '我'}的 Q 版角色` : '建立你的 Q 版角色'),
        h('p', { class: 'small muted center' }, av ? '會出現在好孕群島、產檢日記和分享卡上。' : '上傳一張正面照，自動做出長得像你的 Q 版角色，帶著它逛好孕群島。'),
        h('div', { class: 'row gap-sm center-row' },
          h('button', { class: 'btn btn-primary', onclick: () => fileCam.click() }, '📷 拍一張'),
          h('button', { class: 'btn btn-soft', onclick: () => fileLib.click() }, '🖼️ 從相簿選')),
        h('p', { class: 'tiny faint center mt' }, '🔒 照片只在你的手機上處理，不會上傳；不想用照片也可以直接在下面挑。'),
        fileCam, fileLib));

      const set = (patch) => save(patch);
      el.append(ui.card(null,
        h('div', { class: 'card-title' }, '調整我的角色'),
        a.face ? ui.field('風格', chips([['draw', '✏️ Q 版插畫'], ['photo', '📸 照片大頭']], a.mode, (v) => set({ mode: v }), '風格')) : null,
        ui.field('髮型', chips(HAIR_STYLES, a.style, (v) => set({ style: v }), '髮型')),
        ui.field('髮色', swatches([...(a.auto ? [a.auto.hair] : []), ...HAIRS], a.hair, (v) => set({ hair: v }), '髮色')),
        ui.field('膚色', swatches([...(a.auto ? [a.auto.skin] : []), ...SKINS], a.skin, (v) => set({ skin: v }), '膚色')),
        ui.field('眼睛', chips(EYES, a.eyes, (v) => set({ eyes: v }), '眼睛')),
        ui.field('配件', h('div', { class: 'chips wrap' },
          h('button', { type: 'button', class: `chip${a.glasses ? ' on' : ''}`, onclick: () => set({ glasses: !a.glasses }) }, '👓 眼鏡'),
          h('button', { type: 'button', class: `chip${a.blush !== false ? ' on' : ''}`, onclick: () => set({ blush: a.blush === false }) }, '🌸 腮紅'))),
        ui.field('衣服顏色', swatches(OUTFITS, a.outfit, (v) => set({ outfit: v }), '衣服顏色')),
        av ? h('button', { class: 'link-btn small mt', onclick: async () => { if (await ui.confirm('移除我的 Q 版角色？（照片裁切也會一起刪掉）', { ok: '移除', danger: true })) store.update((s) => { delete s.profile.avatar; }); } }, '移除角色') : null));
      if (!av) el.append(h('p', { class: 'tiny faint center' }, '先挑髮型或顏色，也會自動建立角色。'));
      el.append(h('div', { class: 'row gap-sm center-row mt' },
        h('button', { class: 'btn btn-soft', onclick: () => App.navigate('island') }, '🏝️ 帶著角色逛群島')));
    },
  });

  App.avatar = { svg, dataUrl, current, head, DEFAULT, analyse };
}());
