// Splits a "數據卡 ..." message into a title and metrics.
// Segments are separated by ｜ | newline , ，or 、. A segment with no digit is
// the title; a segment with a number becomes { label, value, delta }.
const SEGMENT_SPLIT = /[｜|\n,，、]+/;
const METRIC = /^(\D*?)\s*([+-]?\d[\d.,]*%?)\s*(.*)$/;

/**
 * @param {string} text The message text after the command word.
 * @returns {{ title: string, metrics: Array<{ label: string, value: string, delta: string }> }}
 */
const parseKpi = (text) => {
  const segments = String(text).split(SEGMENT_SPLIT).map((s) => s.trim()).filter(Boolean);
  let title = '';
  const metrics = [];
  segments.forEach((seg) => {
    const m = seg.match(METRIC);
    if (m) {
      metrics.push({ label: m[1].trim() || '—', value: m[2], delta: m[3].trim() });
    } else if (!title) {
      title = seg;
    }
  });
  return { title, metrics };
};

export default parseKpi;
