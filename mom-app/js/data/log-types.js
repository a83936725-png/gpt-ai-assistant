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
  // how much one 擠奶 gave: both sides, or the total when only that was written
  App.pumpMl = (l) => { const d = (l && l.data) || {}; return (Number(d.left) || 0) + (Number(d.right) || 0) || Number(d.ml) || 0; };
  App.POO = { AMOUNT: POO_AMOUNT, TEXTURE: POO_TEXTURE, COLOR: POO_COLOR };
  App.logSummary = (l) => {
    const t = App.LOG_TYPES[l.type];
    return t ? t.summary(l) : '';
  };
}());
