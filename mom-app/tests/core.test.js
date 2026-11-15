import { describe, expect, test } from '@jest/globals';
import Core from '../js/core.js';

const at = (s) => new Date(s);

describe('dates', () => {
  test('dateKey / parseKey round-trip in local time', () => {
    expect(Core.dateKey(Core.parseKey('2026-03-09'))).toBe('2026-03-09');
  });
  test('diffDays counts calendar days', () => {
    expect(Core.diffDays('2026-01-30', '2026-02-02')).toBe(3);
  });
  test('addMonths clamps to month end', () => {
    expect(Core.dateKey(Core.addMonths('2026-01-31', 1))).toBe('2026-02-28');
  });
  test('ago formats minutes and hours', () => {
    const now = at('2026-05-01T12:00:00').getTime();
    expect(Core.ago(at('2026-05-01T11:48:00'), now)).toBe('12 分前');
    expect(Core.ago(at('2026-05-01T09:55:00'), now)).toBe('2 小時 5 分前');
  });
});

describe('baby age', () => {
  test('months and remaining days', () => {
    const a = Core.babyAge('2026-08-18', at('2026-11-15T10:00:00'));
    expect(a.months).toBe(2);
    expect(a.remDays).toBe(28);
    expect(a.text).toBe('2 個月 28 天');
    expect(a.days).toBe(89);
  });
  test('newborn shows days', () => {
    expect(Core.babyAge('2026-11-01', at('2026-11-15T10:00:00')).text).toBe('14 天');
  });
});

describe('pregnancy', () => {
  test('EDD is LMP + 280 days and back', () => {
    expect(Core.eddFromLmp('2026-01-01')).toBe('2026-10-08');
    expect(Core.lmpFromEdd('2026-10-08')).toBe('2026-01-01');
  });
  test('gestational age weeks + days', () => {
    const g = Core.gestAge('2026-01-01', at('2026-06-15T09:00:00'));
    expect(g.weeks).toBe(23);
    expect(g.days).toBe(4);
    expect(g.trimester).toBe(2);
  });
});

describe('cycle prediction', () => {
  test('average cycle length ignores implausible gaps', () => {
    const periods = [{ start: '2026-01-01' }, { start: '2026-01-30' }, { start: '2026-02-28' }, { start: '2026-06-01' }];
    expect(Core.avgCycleLength(periods)).toBe(29);
  });
  test('ovulation 14 days before next period, fertile window 6 days', () => {
    const p = Core.predictCycle({ lastStart: '2026-03-01', cycleLength: 28, periodLength: 5, now: at('2026-03-10T08:00:00') });
    expect(p.nextPeriod).toBe('2026-03-29');
    expect(p.ovulation).toBe('2026-03-15');
    expect(p.fertileStart).toBe('2026-03-10');
    expect(p.fertileEnd).toBe('2026-03-16');
    expect(p.cycleDay).toBe(10);
    expect(p.inFertile).toBe(true);
  });
  test('rolls forward when last logged period is old', () => {
    const p = Core.predictCycle({ lastStart: '2026-01-01', cycleLength: 28, now: at('2026-03-10T08:00:00') });
    expect(p.nextPeriod).toBe('2026-03-26');
  });
});

describe('predictions', () => {
  test('avgInterval uses recent plausible gaps only', () => {
    const t0 = at('2026-05-01T00:00:00').getTime();
    const H = Core.HOUR;
    const times = [t0, t0 + 3 * H, t0 + 6 * H, t0 + 6 * H + 5 * Core.MIN, t0 + 9 * H];
    // the 5-minute gap is ignored; remaining gaps: 3h, 3h, 2h55m
    expect(Math.round(Core.avgInterval(times) / Core.MIN)).toBe(178);
  });
  test('wake window grows with age', () => {
    expect(Core.wakeWindow(0.5).max).toBeLessThan(Core.wakeWindow(6).min);
  });
});

describe('breast milk expiry', () => {
  test('fridge 4 days, thawed 24h', () => {
    const pumpedAt = '2026-05-01T10:00:00.000Z';
    expect(Core.milkExpiry({ storage: 'fridge', pumpedAt }).toISOString()).toBe('2026-05-05T10:00:00.000Z');
    expect(Core.milkExpiry({ storage: 'freezer', pumpedAt, thawedAt: '2026-06-01T08:00:00.000Z' }).toISOString()).toBe('2026-06-02T08:00:00.000Z');
  });
});

describe('growth LMS', () => {
  test('z of the value at z is z', () => {
    const [L, M, S] = [0.1257, 7.934, 0.10958];
    const x = Core.lmsValue(L, M, S, 1.5);
    expect(Core.lmsZ(L, M, S, x)).toBeCloseTo(1.5, 6);
    expect(Core.lmsValue(L, M, S, 0)).toBeCloseTo(M, 6);
  });
  test('percentiles', () => {
    expect(Core.zToPercentile(0)).toBeCloseTo(50, 3);
    expect(Core.zToPercentile(1.96)).toBeCloseTo(97.5, 1);
    expect(Core.zToPercentile(-1.88)).toBeCloseTo(3, 0);
  });
  test('interpLMS interpolates between months', () => {
    const rows = [[0, 1, 50, 0.04], [2, 1, 58, 0.03]];
    expect(Core.interpLMS(rows, 1)).toEqual([1, 54, 0.035]);
  });
});
