/* Baby log types. Every log entry: {id, babyId, type, start, end, data, note, by}.
 * summary(log) -> short text for timelines. */
(function () {
  const App = window.App = window.App || {};
  const { fmtDuration } = window.Core;

  const POO_AMOUNT = { s: '少', m: '通常', l: '多' };
  const POO_TEXTURE = { water: '水狀', soft: '軟', paste: '糊狀', formed: '成形', hard: '硬' };
  const POO_COLOR = {
    yellow: { label: '黃色', hex: '#e2b93b' },
    green: { label: '綠色', hex: '#6f9a3a' },
    brown: { label: '褐色', hex: '#8a5a2b' },
    black: { label: '黑色', hex: '#2b2b2b', alert: true },
    white: { label: '灰白', hex: '#e6e2d6', alert: true },
    red: { label: '帶血', hex: '#c23b3b', alert: true },
  };

  const dur = (l) => (l.end ? fmtDuration(new Date(l.end) - new Date(l.start)) : '進行中');

  App.LOG_TYPES = {
    breast: {
      label: '親餵', icon: '🤱', color: 'var(--t-feed)', group: 'feed', timed: true,
      summary: (l) => {
        const d = l.data || {};
        const parts = [];
        if (d.leftMin) parts.push(`左 ${d.leftMin} 分`);
        if (d.rightMin) parts.push(`右 ${d.rightMin} 分`);
        if (!parts.length && l.end) parts.push(dur(l));
        if (!l.end && !d.leftMin && !d.rightMin) parts.push('進行中');
        if (d.lastSide) parts.push(`最後${d.lastSide === 'L' ? '左' : '右'}側`);
        return parts.join('・');
      },
    },
    bottle: {
      label: '瓶餵', icon: '🍼', color: 'var(--t-bottle)', group: 'feed',
      summary: (l) => `${l.data?.ml || 0} ml・${l.data?.kind === 'formula' ? '配方奶' : '母乳'}`,
    },
    pump: {
      label: '擠奶', icon: '🥛', color: 'var(--t-pump)', group: 'pump', timed: true,
      summary: (l) => {
        const d = l.data || {};
        const total = App.pumpMl(l);
        const side = d.left || d.right ? `（左 ${d.left || 0}／右 ${d.right || 0}）` : '';
        return `${total} ml${side}${d.stored ? '・已入庫' : ''}`;
      },
    },
    diaper: {
      label: '尿布', icon: '🧷', color: 'var(--t-diaper)', group: 'diaper',
      summary: (l) => {
        const d = l.data || {};
        const kind = { wet: '濕尿布', dirty: '便便', mixed: '尿＋便' }[d.kind] || '尿布';
        if (d.kind === 'wet' || !d.poo) return kind;
        const p = d.poo;
        return [kind, POO_AMOUNT[p.amount], POO_TEXTURE[p.texture], POO_COLOR[p.color]?.label].filter(Boolean).join('・');
      },
    },
    sleep: {
      label: '睡眠', icon: '😴', color: 'var(--t-sleep)', group: 'sleep', timed: true,
      summary: (l) => (l.end ? `睡了 ${dur(l)}` : '睡覺中…'),
    },
    temp: {
      label: '體溫', icon: '🌡️', color: 'var(--t-temp)', group: 'health',
      summary: (l) => {
        const c = Number(l.data?.c);
        const flag = c >= 38 ? '・發燒' : c >= 37.5 ? '・偏高' : '';
        return `${c ? c.toFixed(1) : '-'} °C${l.data?.site ? `（${l.data.site}）` : ''}${flag}`;
      },
    },
    food: {
      label: '副食品', icon: '🥣', color: 'var(--t-food)', group: 'feed',
      summary: (l) => [l.data?.item, l.data?.amount].filter(Boolean).join('・') || '副食品',
    },
    med: {
      label: '用藥', icon: '💊', color: 'var(--t-other)', group: 'health',
      summary: (l) => [l.data?.name, l.data?.dose].filter(Boolean).join('・') || '用藥',
    },
    bath: { label: '洗澡', icon: '🛁', color: 'var(--t-other)', group: 'care', summary: () => '洗澡' },
    visit: {
      label: '看診', icon: '🏥', color: 'var(--t-temp)', group: 'health',
      summary: (l) => {
        const d = l.data || {};
        const fu = d.followUp ? `回診 ${Number(d.followUp.slice(5, 7))}/${Number(d.followUp.slice(8, 10))}` : '';
        return [d.clinic, d.reason, d.diagnosis, fu].filter(Boolean).join('・') || '看診';
      },
    },
    other: { label: '其他', icon: '📝', color: 'var(--t-other)', group: 'care', summary: (l) => l.note || '備註' },
  };
  App.LOG_ORDER = ['breast', 'bottle', 'pump', 'diaper', 'sleep', 'temp', 'food', 'med', 'visit', 'bath', 'other'];
  // the app's own line icons for the record types (24×24, drawn in the text colour). Emoji look different on every
  // phone and read as a template; these are one set, and the 試閱本 page uses the same drawings.
  const LINE = {
    breast: "<circle cx='8' cy='4.6' r='2.3'/><path d='M4.6 20.5V15c0-3.1 1.5-5.3 4-6.1'/><circle cx='12.4' cy='11.6' r='2.1'/><path d='M14.4 11c2.4-.5 4.6.2 5.5 1.6'/><path d='M6.8 15c2.3 2.8 8.5 3.3 13.1-2.4'/>",
    bottle: "<path d='M10.5 5.5c0-1.7.6-2.6 1.5-2.6s1.5.9 1.5 2.6'/><rect x='8.5' y='5.5' width='7' height='2.6' rx='1'/><path d='M9.2 8.1 8.6 10v9a2 2 0 0 0 2 2h2.8a2 2 0 0 0 2-2v-9l-.6-1.9'/><path d='M8.6 13.2h2.6M8.6 16.4h2.6'/>",
    pump: "<path d='M12 2.8c1.7 2.2 2.6 3.6 2.6 4.8a2.6 2.6 0 0 1-5.2 0c0-1.2.9-2.6 2.6-4.8Z'/><path d='M7.3 12.5h9.4l-.8 7.3a1.6 1.6 0 0 1-1.6 1.4H9.7a1.6 1.6 0 0 1-1.6-1.4Z'/><path d='M8 16h8'/>",
    diaper: "<path d='M3.5 7.5h17v2.6c0 4.8-3.8 8.4-8.5 8.4s-8.5-3.6-8.5-8.4Z'/><path d='M3.5 10.6h17'/><path d='M8.8 18.1c.4-2.4 1.6-4 3.2-4s2.8 1.6 3.2 4'/>",
    sleep: "<path d='M18.5 14.6A7.6 7.6 0 0 1 9.4 5.5a7.6 7.6 0 1 0 9.1 9.1Z'/><path d='M14.6 3.6h3.4l-3.4 3.8h3.4'/>",
    temp: "<path d='M10 14.6V5a2 2 0 1 1 4 0v9.6a3.6 3.6 0 1 1-4 0Z'/><path d='M12 9.5v7.3'/>",
    food: "<path d='M3.8 11.5h16.4a8.2 8.2 0 0 1-16.4 0Z'/><path d='M9 20h6'/><path d='M14.2 8.6 17.8 3'/>",
    med: "<path d='M9.6 19.7a3.6 3.6 0 0 1-5.1-5.1l9-9a3.6 3.6 0 0 1 5.1 5.1Z'/><path d='M9 10l5 5'/>",
    bath: "<path d='M3.5 12h17v1.8a5.2 5.2 0 0 1-5.2 5.2H8.7a5.2 5.2 0 0 1-5.2-5.2Z'/><path d='M7.2 19l-1 2M16.8 19l1 2'/><path d='M6 12V6.6a2.1 2.1 0 0 1 3.8-1.2'/>",
    visit: "<path d='M6 3.5v4.6a4 4 0 0 0 8 0V3.5'/><path d='M10 12.1v2.7a4.2 4.2 0 0 0 8.4 0v-1.6'/><circle cx='18.4' cy='11.2' r='2'/>",
    other: "<rect x='5' y='3.5' width='14' height='17' rx='2.5'/><path d='M8.6 8.2h6.8M8.6 12h6.8M8.6 15.8h4'/>",
  };
  App.LOG_LINE = LINE;
  // <span class="lt-ico"><svg…></span> for a record type (unknown types get the note)
  App.logIcon = (type, cls = 'lt-ico') => {
    const s = document.createElement('span');
    s.className = cls; s.setAttribute('aria-hidden', 'true');
    s.innerHTML = `<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${LINE[type] || LINE.other}</svg>`;
    return s;
  };
  // how much one 擠奶 gave: both sides, or the total when only that was written
  App.pumpMl = (l) => { const d = (l && l.data) || {}; return (Number(d.left) || 0) + (Number(d.right) || 0) || Number(d.ml) || 0; };
  App.POO = { AMOUNT: POO_AMOUNT, TEXTURE: POO_TEXTURE, COLOR: POO_COLOR };
  App.logSummary = (l) => {
    const t = App.LOG_TYPES[l.type];
    return t ? t.summary(l) : '';
  };
}());
