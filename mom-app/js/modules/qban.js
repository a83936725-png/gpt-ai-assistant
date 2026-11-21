/* 易家做媽媽 — Q 版小東西.
 * 小滴: the brand's drop (易家「滴」雞精) drawn as a small Q版 friend with moods. She keeps people company on empty
 *   pages, on the welcome screen, in big celebrations and late at night. Always decorative (aria-hidden): the words
 *   next to her say what matters.
 * Q版寶寶: the baby as a big-head chibi on the 首頁 card: asleep while the sleep timer runs, smiling while feeding,
 *   blinking otherwise. 編輯寶寶 picks the outfit colour and one small accessory. A baby whose picture is the default
 *   👶 is drawn this way (the data keeps 👶, so plain text and older versions still show the emoji). The baby's skin
 *   and hair follow her own Q 版角色 when she has one.
 * Both are plain SVG drawings (never a photo), so share cards can use them as stickers.
 *   App.mascot.svg({mood, size, ground, plain})  .el({mood, size, badge, cls})  .dataUrl(opts)  .cheer({text, mood})
 *              .moodFor(icon)  .night()  .MOODS
 *   App.qbaby.svg(baby, {state, size, ground, party})  .face(baby, {size, state, cls})  .icon(baby)  .isQ(baby)  .qOf(baby)
 *             .stateOf(baby)  .partyDay(baby)  .hop()  .dataUrl(baby, opts)  .WEARS  .ACCS
 *   In the week of 滿月, 百日 and 度晬 the baby wears a party hat; after a one-tap record on 首頁 it does a little hop. */
(function () {
  const App = window.App = window.App || {};
  const { h } = App;

  let seq = 0;
  const uid = (p) => `${p}${(seq += 1)}${Math.random().toString(36).slice(2, 6)}`;
  const INK = '#2b1d33';
  const f = (n) => Math.round(n * 100) / 100;
  const hex2rgb = (hx) => { const n = parseInt(String(hx).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const rgb2hex = (r, g, b) => `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
  const mix = (a, b, t) => { const A = hex2rgb(a); const B = hex2rgb(b); return rgb2hex(...A.map((v, i) => v + (B[i] - v) * t)); };
  const safe = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : fallback);
  const toUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  const heart = (cx, cy, s, fill, extra = '') => `<path d="M${cx} ${f(cy + s * 0.9)} C${f(cx - s * 1.3)} ${cy} ${f(cx - s * 0.9)} ${f(cy - s * 0.85)} ${cx} ${f(cy - s * 0.3)} C${f(cx + s * 0.9)} ${f(cy - s * 0.85)} ${f(cx + s * 1.3)} ${cy} ${cx} ${f(cy + s * 0.9)} Z" fill="${fill}"${extra}/>`;
  const star = (x, y, s, fill) => `<path d="M${x} ${f(y - s)} Q${x} ${y} ${f(x + s)} ${y} Q${x} ${y} ${x} ${f(y + s)} Q${x} ${y} ${f(x - s)} ${y} Q${x} ${y} ${x} ${f(y - s)} Z" fill="${fill}"/>`;

  /* ================= 小滴 (viewBox 0 0 100 112) ================= */
  const MOODS = ['happy', 'wave', 'cheer', 'sleepy', 'think', 'oops', 'love'];
  const DROP = 'M50 8 C58 22 86 42 86 68 C86 89 70 104 50 104 C30 104 14 89 14 68 C14 42 42 22 50 8 Z';
  // plain: fixed colours (an image on a share card has no page styles); otherwise dark mode lightens her (css/qban.css)
  function mascotSvg({ mood = 'happy', size = 64, ground = true, plain = false } = {}) {
    const m = MOODS.includes(mood) ? mood : 'happy';
    const v = (name, hex) => (plain ? hex : `var(--${name},${hex})`);
    const id = uid('md');
    const body = v('md-c', '#5a2873'); const arm = v('md-arm', '#7a44a0'); const line = v('md-line', '#4a1f62');
    const o = [];
    o.push(`<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${v('md-a', '#b585d8')}"/><stop offset=".55" style="stop-color:${v('md-b', '#7f48a3')}"/><stop offset="1" style="stop-color:${body}"/></linearGradient></defs>`);
    if (ground) o.push('<ellipse cx="50" cy="107.6" rx="25" ry="3.4" fill="rgba(40,20,50,.16)"/>');
    o.push(`<ellipse cx="39" cy="104" rx="7.5" ry="4.2" style="fill:${body}"/><ellipse cx="61" cy="104" rx="7.5" ry="4.2" style="fill:${body}"/>`);
    // little arms (behind the body, except a hand at the chin while thinking)
    const nub = (cx, cy, rot) => `<ellipse cx="${cx}" cy="${cy}" rx="5.4" ry="8.4" transform="rotate(${rot} ${cx} ${cy})" style="fill:${arm};stroke:${line};stroke-width:1.2"/>`;
    if (m === 'cheer') o.push(nub(12, 54, 32), nub(88, 54, -32));
    else if (m === 'wave') o.push(nub(12.5, 80, 28), `<g class="md-arm-r">${nub(89, 55, -34)}</g>`);
    else if (m === 'think') o.push(nub(12.5, 80, 28));
    else o.push(nub(12.5, 80, 28), nub(87.5, 80, -28));
    o.push(`<path d="${DROP}" fill="url(#${id})" style="stroke:${line};stroke-width:1.4"/>`);
    o.push('<ellipse cx="31.5" cy="47" rx="6.5" ry="11.5" transform="rotate(30 31.5 47)" fill="#fff" opacity=".3"/><circle cx="41" cy="31" r="2.6" fill="#fff" opacity=".6"/>');
    // face
    const eyes = (dx = 0, dy = 0, rx = 4.7, ry = 5.9) => `<g class="md-eyes"><ellipse cx="${f(38 + dx)}" cy="${f(68 + dy)}" rx="${rx}" ry="${ry}" fill="${INK}"/><ellipse cx="${f(62 + dx)}" cy="${f(68 + dy)}" rx="${rx}" ry="${ry}" fill="${INK}"/><circle cx="${f(39.7 + dx)}" cy="${f(65.6 + dy)}" r="1.9" fill="#fff"/><circle cx="${f(63.7 + dx)}" cy="${f(65.6 + dy)}" r="1.9" fill="#fff"/><circle cx="${f(36.6 + dx)}" cy="${f(70.4 + dy)}" r=".9" fill="#fff"/><circle cx="${f(60.6 + dx)}" cy="${f(70.4 + dy)}" r=".9" fill="#fff"/></g>`;
    const arcs = (d) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="2.8" stroke-linecap="round"/>`;
    const blush = '<ellipse cx="28.5" cy="78.5" rx="6" ry="3.4" fill="#ff9ec4" opacity=".75"/><ellipse cx="71.5" cy="78.5" rx="6" ry="3.4" fill="#ff9ec4" opacity=".75"/>';
    const smile = `<path d="M45 77.5 Q50 82.5 55 77.5" fill="none" stroke="${INK}" stroke-width="2.4" stroke-linecap="round"/>`;
    if (m === 'cheer') o.push(arcs('M33 70 Q38 63.5 43 70 M57 70 Q62 63.5 67 70'), blush, '<path d="M43.5 76.5 Q50 89 56.5 76.5 Z" fill="#5b1f3a"/><path d="M46.8 80.6 Q50 84.6 53.2 80.6 Q50 79.2 46.8 80.6 Z" fill="#ff8fb1"/>');
    else if (m === 'sleepy') o.push(arcs('M33 68 Q38 72.5 43 68 M57 68 Q62 72.5 67 68'), blush, '<ellipse cx="50" cy="79.5" rx="2.6" ry="3" fill="#5b1f3a"/>');
    else if (m === 'love') o.push(heart(38, 68, 5.4, '#ff5c93'), heart(62, 68, 5.4, '#ff5c93'), '<circle cx="36.2" cy="65.6" r="1.2" fill="#fff"/><circle cx="60.2" cy="65.6" r="1.2" fill="#fff"/>', blush, smile);
    else if (m === 'think') o.push(eyes(1.8, -2.2, 4.3, 5.4), blush, '<path d="M46.5 79.6 L53.5 78.6" stroke="#5b1f3a" stroke-width="2.2" stroke-linecap="round"/>');
    else if (m === 'oops') o.push(`<path d="M32.5 61 L42.5 57.8 M67.5 61 L57.5 57.8" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`, eyes(0, 1, 4.3, 5.2), blush, `<path d="M44.5 80 Q47.25 77.5 50 80 Q52.75 82.5 55.5 80" fill="none" stroke="${INK}" stroke-width="2.2" stroke-linecap="round"/>`);
    else o.push(eyes(), blush, smile);
    // the heart clip (the logo's little heart), or a nightcap
    if (m === 'sleepy') {
      o.push('<path d="M34 26 C36 10 49 0 65 5 C74 7.5 79 12.5 80 19.5 C73.5 15 67.5 17.5 66 26 Z" fill="#a9c4f2" stroke="#7f9fd6" stroke-width="1.2" stroke-linejoin="round"/>'
        + '<circle cx="44" cy="16" r="1.3" fill="#fff"/><circle cx="55" cy="10" r="1.1" fill="#fff"/><circle cx="58" cy="19" r="1.2" fill="#fff"/>'
        + '<rect x="30.5" y="23.5" width="39" height="8" rx="4" fill="#fff" stroke="#d3dcf0" stroke-width="1"/><circle cx="80.5" cy="20.5" r="5" fill="#fff" stroke="#d3dcf0" stroke-width="1"/>'
        + '<g class="md-z" fill="none" stroke="#a58bd6" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M84 37 h4 l-4 4.6 h4"/><path d="M89 25 h6.5 l-6.5 7.5 h6.5"/></g>');
    } else {
      o.push(heart(62, 24, 5, '#ff8db6'), '<circle cx="60.2" cy="22.3" r="1.2" fill="#fff" opacity=".85"/>');
    }
    if (m === 'think') o.push(nub(63.5, 89, -56), `<path d="M78 22 Q78 14.5 85 14.5 Q92 14.5 92 21 Q92 25.5 86 27.5 L86 30.5" fill="none" style="stroke:${v('md-q', '#7b4597')};stroke-width:2.6;stroke-linecap:round"/><circle cx="86" cy="35.5" r="1.8" style="fill:${v('md-q', '#7b4597')}"/>`);
    if (m === 'cheer') o.push(`<g class="md-spark">${star(13, 26, 5.5, '#ffcf5a')}${star(87, 22, 6.5, '#ffcf5a')}${star(93, 44, 3.6, '#ffe08f')}${star(7, 44, 3.2, '#ffe08f')}</g>`);
    if (m === 'oops') o.push('<path d="M78 44 Q73.5 51.5 78 54 Q82.5 51.5 78 44 Z" fill="#a9dcf7" stroke="#76c0ea" stroke-width="1"/>');
    if (m === 'love') o.push(`<g class="md-hearts">${heart(87, 34, 4.2, '#ff7fab')}${heart(13, 44, 3.2, '#ffb0cb')}</g>`);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 112" width="${size}" height="${Math.round(size * 1.12)}" class="md-svg" aria-hidden="true" focusable="false">${o.join('')}</svg>`;
  }
  // an element: <span class="md md-happy">svg [badge]</span>; the badge is the page's own emoji in a little bubble
  function mascotEl({ mood = 'happy', size = 64, badge = null, cls = '' } = {}) {
    const m = MOODS.includes(mood) ? mood : 'happy';
    const el = h('span', { class: `md md-${m}${cls ? ` ${cls}` : ''}`, 'aria-hidden': 'true', dataset: { mood: m } });
    el.innerHTML = mascotSvg({ mood: m, size });
    if (badge) el.append(h('span', { class: 'md-badge' }, badge));
    return el;
  }
  const mascotUrl = (opts = {}) => toUrl(mascotSvg({ ...opts, plain: true }));
  // which face fits an empty page, from its emoji
  const EMPTY_MOOD = { '🌙': 'sleepy', '😴': 'sleepy', '💤': 'sleepy', '🔍': 'think', '🤔': 'think', '🫶': 'love', '💌': 'love', '⚠️': 'oops' };
  const moodFor = (icon) => EMPTY_MOOD[icon] || 'happy';
  // sleepy late at night: from 22:00 until the sky starts to light up (follows the season's sunrise, see App.dayPhase)
  const night = (d = new Date()) => (App.dayPhase ? App.dayPhase(d) === 'late' : d.getHours() >= 22 || d.getHours() < 5);
  // a big moment: 小滴 hops up by the corner for a moment and cheers (the toast next to it carries the words)
  const CHEERS = ['太棒了！', '好厲害！', '恭喜你！', '耶～！'];
  let popT = 0;
  function cheer({ text = null, mood = 'cheer' } = {}) {
    if (!document.body) return null;
    document.querySelectorAll('.md-pop').forEach((x) => x.remove());
    const pop = h('div', { class: 'md-pop', 'aria-hidden': 'true' },
      h('span', { class: 'md-pop-say' }, text || CHEERS[Math.floor(Math.random() * CHEERS.length)]), mascotEl({ mood, size: 58 }));
    document.body.appendChild(pop);
    requestAnimationFrame(() => requestAnimationFrame(() => pop.classList.add('show')));
    clearTimeout(popT);
    popT = setTimeout(() => { pop.classList.remove('show'); setTimeout(() => pop.remove(), 450); }, 2600);
    return pop;
  }
  App.mascot = { svg: mascotSvg, el: mascotEl, dataUrl: mascotUrl, cheer, moodFor, night, MOODS };

  /* ================= Q版寶寶 (viewBox 0 0 100 100) ================= */
  const WEARS = [['yellow', '奶黃', '#ffd978'], ['pink', '粉紅', '#f7a8c4'], ['blue', '天藍', '#9fcaf2'], ['mint', '薄荷', '#9ddcbf'], ['lilac', '薰衣草', '#c9aaea']];
  const ACCS = [['none', '不用'], ['bow', '蝴蝶結'], ['hat', '小帽子'], ['paci', '奶嘴'], ['tuft', '呆毛']];
  const isQ = (b) => !!b && !b.photo && (!b.avatar || b.avatar === '👶');
  const qOf = (b) => {
    const q = (b && b.q) || {};
    return { wear: WEARS.some((w) => w[0] === q.wear) ? q.wear : 'yellow', acc: ACCS.some((a) => a[0] === q.acc) ? q.acc : 'none' };
  };
  const wearHex = (b) => WEARS.find((w) => w[0] === qOf(b).wear)[2];
  // the week of 滿月, 百日 and 度晬 (the same windows as the custom share cards): the baby wears a party hat
  const partyDay = (b, now = new Date()) => {
    const a = b && b.birthday && window.Core ? window.Core.babyAge(b.birthday, now) : null;
    if (!a || a.days < 0) return null;
    const d = a.days + 1;
    if (d >= 30 && d <= 36) return '滿月';
    if (d >= 100 && d <= 106) return '百日';
    if (a.months === 12 && a.remDays <= 6) return '度晬';
    return null;
  };
  const stateOf = (b) => (!b || !App.timers ? 'awake' : App.timers.get('sleep', b.id) ? 'sleep' : App.timers.get('breast', b.id) ? 'feed' : 'awake');
  // skin and hair: a little lighter than her own Q 版角色 (when she has one)
  function tones() {
    const av = App.avatar && App.avatar.current ? App.avatar.current() : null;
    return {
      skin: av && av.skin ? mix(safe(av.skin, '#f6d2b8'), '#ffffff', 0.2) : '#fde3d1',
      hair: av && av.hair ? mix(safe(av.hair, '#3a2a24'), '#ffffff', 0.12) : '#5b4033',
    };
  }
  function babySvg(b, { state = 'awake', size = 56, ground = true, party = null } = {}) {
    const isParty = party === null ? !!partyDay(b) : !!party;
    const acc = isParty && qOf(b).acc !== 'paci' ? 'party' : qOf(b).acc; // the party hat takes the place of the accessory
    const wear = wearHex(b); const wearD = mix(wear, '#5a3a4a', 0.3); const wearL = mix(wear, '#ffffff', 0.45);
    const { skin, hair } = tones(); const skinD = mix(skin, '#8a4a3a', 0.25);
    const st = ['awake', 'sleep', 'feed'].includes(state) ? state : 'awake';
    const o = [];
    if (ground) o.push('<ellipse cx="50" cy="95.6" rx="24" ry="3.4" fill="rgba(40,20,50,.15)"/>');
    // feet, the onesie (a white heart on the tummy), arms with little hands
    o.push(`<ellipse cx="38" cy="91.5" rx="8.6" ry="5" fill="${wearD}"/><ellipse cx="62" cy="91.5" rx="8.6" ry="5" fill="${wearD}"/>`);
    o.push(`<path d="M28 92 Q26 68 50 66 Q74 68 72 92 Q50 97 28 92 Z" fill="${wear}" stroke="${wearD}" stroke-width="1.3"/>`);
    o.push(heart(50, 82, 3.6, '#fff', ' opacity=".85"'));
    o.push(`<ellipse cx="27.5" cy="79" rx="5.4" ry="7.2" transform="rotate(22 27.5 79)" fill="${wear}" stroke="${wearD}" stroke-width="1.2"/><circle cx="25.6" cy="85" r="4" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
    o.push(`<ellipse cx="72.5" cy="79" rx="5.4" ry="7.2" transform="rotate(-22 72.5 79)" fill="${wear}" stroke="${wearD}" stroke-width="1.2"/><circle cx="74.4" cy="85" r="4" fill="${skin}" stroke="${skinD}" stroke-width="1"/>`);
    // ears and the big round head
    o.push(`<circle cx="21" cy="47" r="6.5" fill="${skin}" stroke="${skinD}" stroke-width="1.1"/><circle cx="79" cy="47" r="6.5" fill="${skin}" stroke="${skinD}" stroke-width="1.1"/>`);
    o.push(`<circle cx="50" cy="44" r="30" fill="${skin}" stroke="${skinD}" stroke-width="1.2"/>`);
    if (acc !== 'hat' && !isParty) { // (no hair showing under a hat)
      o.push(acc === 'tuft'
        ? `<path d="M50 15.5 Q45.5 4.5 53.5 3.8 Q60 4 57.2 9.6 Q55 12.4 52.4 9.8" fill="none" stroke="${hair}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`
        : `<path d="M44.5 16.5 Q47 11.5 50 15 M50 15 Q53 9.5 56.5 14.5" fill="none" stroke="${hair}" stroke-width="2.1" stroke-linecap="round"/>`);
    }
    o.push('<ellipse cx="31" cy="55.5" rx="5.6" ry="3.3" fill="#ff9fb8" opacity=".62"/><ellipse cx="69" cy="55.5" rx="5.6" ry="3.3" fill="#ff9fb8" opacity=".62"/>');
    // eyes: closed while asleep, happy arcs while feeding, open (and blinking) otherwise
    const lines = (d, w = 2.4) => `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${w}" stroke-linecap="round"/>`;
    if (st === 'sleep') o.push(lines('M35 48.5 Q39.5 52.6 44 48.5 M56 48.5 Q60.5 52.6 65 48.5'));
    else if (st === 'feed') o.push(lines('M35 50 Q39.5 44.2 44 50 M56 50 Q60.5 44.2 65 50'));
    else o.push(`<g class="qb-eyes"><ellipse cx="39.5" cy="48" rx="4.2" ry="5.2" fill="${INK}"/><ellipse cx="60.5" cy="48" rx="4.2" ry="5.2" fill="${INK}"/><circle cx="41" cy="45.8" r="1.7" fill="#fff"/><circle cx="62" cy="45.8" r="1.7" fill="#fff"/><circle cx="38.3" cy="50.2" r=".8" fill="#fff"/><circle cx="59.3" cy="50.2" r=".8" fill="#fff"/></g>`);
    // mouth (the 奶嘴 comes out while feeding)
    const mouth = '#b0485a';
    const paci = acc === 'paci' && st !== 'feed';
    if (paci) o.push(`<circle cx="50" cy="63.4" r="3.4" fill="none" stroke="${wearD}" stroke-width="1.6"/><ellipse cx="50" cy="58.6" rx="7.2" ry="4.6" fill="${wearL}" stroke="${wearD}" stroke-width="1.2"/><circle cx="50" cy="58.6" r="2.2" fill="#fff"/>`);
    else if (st === 'sleep') o.push(`<ellipse cx="50" cy="58.2" rx="2.1" ry="2.5" fill="${mouth}"/>`);
    else if (st === 'feed') o.push(`<path d="M45.6 56.6 Q47.8 59.6 50 56.6 Q52.2 59.6 54.4 56.6" fill="none" stroke="${mouth}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`);
    else o.push(`<path d="M46.5 57 Q50 60.6 53.5 57" fill="none" stroke="${mouth}" stroke-width="2" stroke-linecap="round"/>`);
    if (st === 'sleep' && !paci) o.push('<g class="qb-bubble"><circle cx="55.5" cy="55.5" r="3" fill="rgba(178,221,247,.6)" stroke="#86c3ea" stroke-width=".9"/><circle cx="54.7" cy="54.6" r=".8" fill="#fff"/></g>');
    // accessories
    if (acc === 'bow') o.push('<g transform="rotate(16 66 20)"><path d="M66 20 L56.5 14.2 Q53.4 20 56.5 25.8 Z" fill="#ff8fb3" stroke="#e46f98" stroke-width="1.1" stroke-linejoin="round"/><path d="M66 20 L75.5 14.2 Q78.6 20 75.5 25.8 Z" fill="#ff8fb3" stroke="#e46f98" stroke-width="1.1" stroke-linejoin="round"/><circle cx="66" cy="20" r="3.1" fill="#ff6f9f"/></g>');
    if (isParty) {
      o.push('<g transform="rotate(-14 45 20)"><path d="M34 22 L45 4 L56 22 Z" fill="#ffcf5a" stroke="#e0a92e" stroke-width="1.2" stroke-linejoin="round"/>'
        + '<path d="M37.7 16 H52.3 M41.3 10 H48.7" stroke="#ff7fab" stroke-width="2.4" stroke-linecap="round"/>'
        + '<path d="M34 22 Q45 25.4 56 22" fill="none" stroke="#e0a92e" stroke-width="1.2"/><circle cx="45" cy="4.2" r="3.4" fill="#ff7fab"/></g>'
        + `<g class="qb-confetti">${star(76, 14, 3.4, '#ffcf5a')}${star(85, 30, 2.4, '#ff9fc0')}<circle cx="20" cy="16" r="1.8" fill="#9fcaf2"/><circle cx="82" cy="22" r="1.5" fill="#9ddcbf"/></g>`);
    }
    if (acc === 'hat') {
      o.push(`<path d="M21.5 38 C21.5 22 33 12 50 12 C67 12 78.5 22 78.5 38 Z" fill="${wearL}" stroke="${wearD}" stroke-width="1.2"/>`
        + `<path d="M35 16 Q37 27 36 37 M50 12 V37 M65 16 Q63 27 64 37" fill="none" stroke="${wear}" stroke-width="2.2" opacity=".75"/>`
        + `<rect x="19" y="33.5" width="62" height="9" rx="4.5" fill="${wear}" stroke="${wearD}" stroke-width="1.2"/>`
        + `<circle cx="50" cy="10.5" r="5.6" fill="#fff" stroke="${wearD}" stroke-width="1.1"/>`);
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" class="qb-svg" aria-hidden="true" focusable="false">${o.join('')}</svg>`;
  }
  // the baby's picture for any place: her photo, the Q版 baby, or the emoji she picked
  function face(b, { size = 56, state = null, cls = '' } = {}) {
    if (b && b.photo) return h('img', { src: b.photo, alt: '', class: cls || null });
    if (!isQ(b)) return h('span', { class: `${cls} emoji`.trim(), 'aria-hidden': 'true' }, b.avatar);
    const st = state || 'awake';
    const party = partyDay(b);
    const el = h('span', { class: `${cls} qb qb-${st}`.trim(), 'aria-hidden': 'true', dataset: { state: st, party: party || null }, style: { '--qb-bg': mix(wearHex(b), '#ffffff', 0.7) } });
    el.innerHTML = babySvg(b, { state: st, size, ground: false });
    return el;
  }
  // the small square icon of a list row
  const icon = (b) => (b && b.photo ? h('img', { src: b.photo, alt: '', class: 'li-icon li-photo' }) : isQ(b) ? face(b, { size: 40, cls: 'li-icon' }) : h('span', { class: 'li-icon' }, (b && b.avatar) || '👶'));
  const babyUrl = (b, opts = {}) => toUrl(babySvg(b, opts));
  // a happy hop (after a one-tap record for this baby)
  function hop() {
    const el = document.querySelector('.hero-avatar.qb');
    if (!el) return;
    el.classList.remove('qb-yay'); void el.offsetWidth; el.classList.add('qb-yay'); // eslint-disable-line no-void
    setTimeout(() => el.classList.remove('qb-yay'), 900);
  }
  App.qbaby = { svg: babySvg, face, icon, isQ, qOf, stateOf, partyDay, hop, dataUrl: babyUrl, WEARS, ACCS };
}());
