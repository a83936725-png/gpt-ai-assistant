import { beforeAll, describe, expect, test } from '@jest/globals';
import Core from '../js/core.js';

// health-data.js is a classic browser script that fills window.App.HEALTH
let H;
beforeAll(async () => {
  globalThis.window = globalThis.window || {};
  window.App = window.App || {};
  await import('../js/data/health-data.js');
  H = window.App.HEALTH;
});

// medians (M) from the WHO Child Growth Standards monthly tables
const WHO_MEDIANS = [
  ['weight', 'boy', 0, 3.3464], ['weight', 'boy', 24, 12.1515], ['weight', 'boy', 48, 16.3489], ['weight', 'boy', 60, 18.3366],
  ['weight', 'girl', 0, 3.2322], ['weight', 'girl', 48, 16.0697], ['weight', 'girl', 60, 18.2193],
  ['length', 'boy', 48, 103.3273], ['length', 'boy', 60, 109.9638],
  ['length', 'girl', 48, 102.7312], ['length', 'girl', 60, 109.4233],
];

describe('WHO growth tables', () => {
  test('cover every month from birth to 5 years, for each measure and sex', () => {
    ['weight', 'length', 'head'].forEach((m) => ['boy', 'girl'].forEach((s) => {
      const rows = H.WHO[m][s];
      expect(rows.map((r) => r[0])).toEqual(Array.from({ length: 61 }, (_, i) => i));
      rows.forEach(([, L, M, S]) => { expect(Number.isFinite(L) && M > 0 && S > 0 && S < 0.2).toBe(true); });
    }));
  });
  test.each(WHO_MEDIANS)('%s %s at %i months: median %f', (m, s, mo, median) => {
    expect(H.WHO[m][s][mo][2]).toBeCloseTo(median, 3);
  });
  test('medians keep rising month to month (no row typed in the wrong place)', () => {
    ['weight', 'length', 'head'].forEach((m) => ['boy', 'girl'].forEach((s) => {
      const med = H.WHO[m][s].map((r) => r[2]);
      med.slice(1).forEach((v, i) => { expect(v).toBeGreaterThan(med[i] - (m === 'length' && i === 24 ? 1 : 0)); }); // height at 25 months is measured standing
    }));
  });
  test('a child exactly on the median is the 50th percentile at 4 years', () => {
    const [L, M, S] = Core.interpLMS(H.WHO.weight.girl, 48);
    expect(Core.zToPercentile(Core.lmsZ(L, M, S, M))).toBeCloseTo(50, 3);
  });
});
