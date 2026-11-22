import { IKIGAI_CIRCLES } from './analyze-ikigai.js';

// Builds the emailed IKIGAI report from a stored record. Inline styles only, so mail apps show it as designed.
const KEYS = IKIGAI_CIRCLES.map(({ key }) => key);
const SHORT = {
  love: '熱愛', good: '擅長', need: '世界需要', paid: '報酬',
};
const COLOR = {
  love: '#dc4f67', good: '#dd9324', need: '#23988b', paid: '#4f63d6',
};
const PAIRS = [
  { keys: ['love', 'good'], name: '熱情 Passion' },
  { keys: ['love', 'need'], name: '使命 Mission' },
  { keys: ['good', 'paid'], name: '專業 Profession' },
  { keys: ['need', 'paid'], name: '天職 Vocation' },
];
const HORIZONS = { d30: '30 天', d90: '90 天', y1: '1 年' };
const GAP_ADVICE = {
  love: '多嘗試新活動，記下做什麼事時最投入、最不覺得累。',
  good: '挑 1 項技能刻意練習 30 天，做出一個小作品並請人給回饋。',
  need: '訪談 3 位可能的服務對象，了解他們真正的困擾和需求。',
  paid: '研究市場行情：找 5 個相關職缺或服務，看要求的能力和收費方式。',
};

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[c]));

const h2 = (t) => `<h2 style="margin:28px 0 10px;font-size:19px;color:#1f1c1a;border-bottom:2px solid #efe9df;padding-bottom:6px">${t}</h2>`;
const row = (label, value) => `<tr><td style="padding:8px 10px;border-bottom:1px solid #efe9df;color:#6d665f;white-space:nowrap;vertical-align:top;width:110px">${label}</td><td style="padding:8px 10px;border-bottom:1px solid #efe9df;color:#1f1c1a">${value}</td></tr>`;
const table = (rows) => `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;font-size:15px">${rows}</table>`;

/**
 * @param {Object} record A sanitized IKIGAI record.
 * @param {{ siteUrl: string }} options
 * @returns {{ subject: string, html: string, text: string }}
 */
const buildReport = (record, { siteUrl }) => {
  const { name } = record.profile;
  const inCircle = (k) => record.items.filter((it) => it.c[k]).map((it) => it.text);
  const hasAll = (it, keys) => keys.every((k) => it.c[k]);
  const center = record.items.filter((it) => hasAll(it, KEYS)).map((it) => it.text);
  const near = record.items.filter((it) => KEYS.filter((k) => it.c[k]).length === 3).map((it) => it.text);
  const ins = record.insights;
  const type = ins.archetype || null;
  const strengths = inCircle('good').map((t) => t.toLowerCase());
  const owned = (skill) => strengths.some((g) => skill.toLowerCase().includes(g) || g.includes(skill.toLowerCase().slice(0, 2)));
  const main = record.plan.dirs.find((d) => d.main) || record.plan.dirs[0];
  const invite = `${siteUrl}/?ref=${record.id}&src=email`;

  const parts = [];
  parts.push(`<p style="margin:0 0 6px;color:#6d665f;font-size:14px">IKIGAI 生涯羅盤</p>
    <h1 style="margin:0 0 8px;font-size:26px;color:#1f1c1a">${esc(name)}，這是你的 IKIGAI 完整報告</h1>
    <p style="margin:0;color:#6d665f;font-size:15px">熱愛、擅長、世界需要、可以獲得報酬：四個圈的交集，就是值得投入的方向。</p>`);
  if (type && type.name) {
    parts.push(`<div style="margin:24px 0 0;padding:18px 20px;border-radius:14px;background:#f6f1fa">
      <p style="margin:0;color:#6d665f;font-size:13px">你的 IKIGAI 人格類型</p>
      <p style="margin:4px 0 6px;font-size:26px;font-weight:800;color:#1f1c1a">${esc(type.name)}</p>
      <p style="margin:0 0 10px;font-size:15px;color:#1f1c1a">${esc(type.tagline)}</p>
      ${type.strengths && type.strengths.length ? `<p style="margin:0 0 6px;font-size:14px">優勢：${type.strengths.map(esc).join('、')}</p>` : ''}
      ${type.advice ? `<p style="margin:0;font-size:14px;color:#6d665f">給你的一句話：${esc(type.advice)}</p>` : ''}
    </div>`);
  }
  parts.push(h2('你的四個圈'));
  parts.push(table(KEYS.map((k) => row(`<span style="color:${COLOR[k]};font-weight:700">●</span> ${SHORT[k]}（${inCircle(k).length}）`, esc(inCircle(k).join('、')) || '—')).join('')));
  parts.push(h2('交集'));
  parts.push(table([
    row('IKIGAI 中心', esc(center.join('、')) || '—'),
    near.length ? row('差一圈', esc(near.join('、'))) : '',
    ...PAIRS.map((p) => row(p.name, esc(record.items.filter((it) => hasAll(it, p.keys)).map((it) => it.text).join('、')) || '—')),
  ].join('')));
  if (record.note) parts.push(`<p style="margin:10px 0 0;font-size:14px;color:#6d665f">補充說明：${esc(record.note)}</p>`);

  if (ins.careers.length) {
    parts.push(h2('建議職業'));
    parts.push(table(ins.careers.map((c, i) => row(`0${i + 1}`, `<b>${esc(c.name)}</b>&nbsp;&nbsp;<span style="color:#6d665f;font-size:13px">符合：${c.circles.map((k) => SHORT[k]).join('、')}</span>`)).join('')));
    if (ins.paths.length) {
      parts.push('<h3 style="margin:18px 0 6px;font-size:16px">可以往哪個方向走</h3>');
      parts.push(table(ins.paths.map((p) => row(esc(p.title), esc(p.career))).join('')));
    }
    if (ins.skills.length) parts.push(`<p style="margin:14px 0 0;font-size:15px"><b>需要加強的能力：</b>${ins.skills.map(esc).join('、')}</p>`);
    if (ins.weakest) parts.push(`<p style="margin:8px 0 0;font-size:15px"><b>最需要補強的圈：</b>${SHORT[ins.weakest]}。${GAP_ADVICE[ins.weakest]}</p>`);

    parts.push(h2('前三個建議職業的準備方式'));
    ins.careers.slice(0, 3).forEach((c) => {
      const skills = c.skills || [];
      const need = skills.filter((s) => !owned(s));
      const have = skills.filter(owned);
      const first = need[0] || skills[0] || '核心技能';
      parts.push(`<h3 style="margin:18px 0 6px;font-size:16px">${esc(c.name)}</h3>`);
      parts.push(table([
        c.items && c.items.length ? row('為什麼適合', `符合${c.circles.map((k) => SHORT[k]).join('、')}；依據：${c.items.map(esc).join('、')}`) : '',
        skills.length ? row('需要的能力', skills.map(esc).join('、')) : '',
        row('你已具備', have.map(esc).join('、') || '—'),
        row('第 1～30 天', `學習「${esc(first)}」的基礎，每週整理一篇學習筆記`),
        row('第 31～60 天', `完成一個和「${esc(c.name)}」有關、可以公開展示的小作品`),
        row('第 61～90 天', '請 3 位業內人士給回饋，修正後放進作品集，並投遞或洽談 3 個機會'),
      ].join('')));
    });
  }

  if (main) {
    parts.push(h2('你的生涯規劃'));
    parts.push(table([
      row('主要方向', `<b>${esc(main.title)}</b>&nbsp;&nbsp;<span style="color:#6d665f;font-size:13px">${KEYS.map((k) => `${SHORT[k]} ${main.s[k]}`).join('、')}</span>`),
      ...Object.entries(HORIZONS).map(([h, l]) => (record.plan.goals[h] ? row(`${l}目標`, esc(record.plan.goals[h])) : '')),
    ].join('')));
    if (record.plan.actions.length) {
      parts.push(`<ul style="margin:12px 0 0;padding-left:20px;font-size:15px">${record.plan.actions.map((a) => `<li style="margin:4px 0">${a.done ? '☑' : '☐'} [${HORIZONS[a.h]}] ${esc(a.text)}</li>`).join('')}</ul>`);
    }
  }
  if (record.ai) {
    parts.push(h2('深度解析'));
    parts.push(`<div style="white-space:pre-wrap;font-size:15px;line-height:1.7;background:#faf7f2;border-radius:12px;padding:14px 16px">${esc(record.ai)}</div>`);
  }
  parts.push(`<div style="margin:30px 0 0;padding:18px 20px;border-radius:14px;background:#1f1c1a;color:#fff">
    <p style="margin:0 0 6px;font-size:17px;font-weight:700">邀請朋友一起測</p>
    <p style="margin:0 0 12px;font-size:14px;color:#d9d3ca">把你的專屬連結傳給朋友，一起找到各自的方向。</p>
    <a href="${esc(invite)}" style="display:inline-block;background:#fff;color:#1f1c1a;text-decoration:none;font-weight:700;padding:10px 16px;border-radius:10px">打開邀請連結</a>
    <p style="margin:10px 0 0;font-size:12px;color:#b9b2a8;word-break:break-all">${esc(invite)}</p>
  </div>
  <p style="margin:24px 0 0;font-size:12px;color:#8a837a">你收到這封信，是因為你在 IKIGAI 生涯羅盤留下了 Email 並同意寄送報告。想刪除資料，直接回覆這封信即可。</p>`);

  const html = `<!doctype html><html lang="zh-Hant-TW"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>IKIGAI 完整報告</title></head>
<body style="margin:0;background:#f4f1ec;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans TC','PingFang TC','Microsoft JhengHei',sans-serif;line-height:1.6">
<div style="max-width:640px;margin:0 auto;padding:24px 12px"><div style="background:#fff;border-radius:18px;padding:28px 24px">${parts.join('')}</div></div></body></html>`;

  const text = [
    `${name}，這是你的 IKIGAI 完整報告`,
    type && type.name ? `人格類型：${type.name}（${type.tagline}）` : '',
    '',
    ...KEYS.map((k) => `【${SHORT[k]}】${inCircle(k).join('、') || '—'}`),
    `IKIGAI 中心：${center.join('、') || '—'}`,
    ins.careers.length ? `建議職業：${ins.careers.map((c) => c.name).join('、')}` : '',
    ins.skills.length ? `需要加強：${ins.skills.join('、')}` : '',
    main ? `主要方向：${main.title}` : '',
    '',
    `邀請朋友一起測：${invite}`,
  ].filter((l) => l !== null).join('\n');

  return { subject: `${name}的 IKIGAI 完整報告${type && type.name ? `：${type.name}` : ''}`, html, text };
};

export default buildReport;
