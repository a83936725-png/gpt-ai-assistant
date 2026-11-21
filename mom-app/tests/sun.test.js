import { describe, expect, test } from '@jest/globals';
import Core from '../js/core.js';

// 中央氣象署「日出日沒時刻表」臺北, the 21st of each month (the times move less than a minute between years)
const CWA_TAIPEI = [
  ['01-21', '06:40', '17:30'], ['02-21', '06:24', '17:51'], ['03-21', '05:58', '18:05'], ['04-21', '05:27', '18:19'],
  ['05-21', '05:07', '18:34'], ['06-21', '05:05', '18:47'], ['07-21', '05:16', '18:45'], ['08-21', '05:30', '18:24'],
  ['09-21', '05:42', '17:52'], ['10-21', '05:55', '17:22'], ['11-21', '06:14', '17:05'], ['12-21', '06:34', '17:09'],
];
// minutes after midnight in Taiwan time (UTC+8), whatever the test machine's time zone
const twMin = (d) => { const x = new Date(d.getTime() + 8 * 3600e3); return x.getUTCHours() * 60 + x.getUTCMinutes() + x.getUTCSeconds() / 60; };
const hm = (s) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
const noon = (md) => new Date(`2026-${md}T12:00:00+08:00`);

describe('sunrise and sunset', () => {
  test.each(CWA_TAIPEI)('臺北 %s: 日出 %s・日沒 %s (within 2 minutes)', (md, rise, set) => {
    const { sunrise, sunset } = Core.sunTimes(noon(md), 'north');
    expect(Math.abs(twMin(sunrise) - hm(rise))).toBeLessThanOrEqual(2);
    expect(Math.abs(twMin(sunset) - hm(set))).toBeLessThanOrEqual(2);
  });
  test('winter days are longer in the south, summer days longer in the north', () => {
    const len = (md, p) => { const s = Core.sunTimes(noon(md), p); return s.sunset - s.sunrise; };
    expect(len('12-21', 'south')).toBeGreaterThan(len('12-21', 'north'));
    expect(len('06-21', 'north')).toBeGreaterThan(len('06-21', 'south'));
    expect(len('06-21', 'matsu')).toBeGreaterThan(len('06-21', 'north'));
  });
  test('the west sets later: 金門 after 花蓮 on the same day', () => {
    expect(twMin(Core.sunTimes(noon('09-21'), 'kinmen').sunset)).toBeGreaterThan(twMin(Core.sunTimes(noon('09-21'), 'east').sunset) + 10);
  });
  test('an unknown place falls back to 北部', () => {
    expect(Core.sunTimes(noon('03-21'), 'nowhere').sunset.getTime()).toBe(Core.sunTimes(noon('03-21'), 'north').sunset.getTime());
  });
});

describe('固定時鐘 (the phone\'s own clock)', () => {
  test('06:00 天亮・18:00 天黑, 深夜 from 22:00 until 05:30', () => {
    const L = (h, m = 0) => new Date(2026, 11, 21, h, m);
    expect(Core.isDark(L(17, 59), 'clock')).toBe(false);
    expect(Core.isDark(L(18, 0), 'clock')).toBe(true);
    expect(Core.isDark(L(5, 59), 'clock')).toBe(true);
    expect(Core.isDark(L(6, 0), 'clock')).toBe(false);
    expect([L(23), L(5, 0), L(5, 40), L(12), L(17, 30), L(19)].map((d) => Core.dayPhase(d, 'clock')))
      .toEqual(['late', 'late', 'dawn', 'day', 'dusk', 'evening']);
  });
});

describe('day phase', () => {
  const at = (s) => new Date(`${s}+08:00`);
  test('winter evening: 黃昏 around 17:00, dark after 17:09, 晚上 at 19:00, 深夜 after 22:00', () => {
    expect(Core.dayPhase(at('2026-12-21T16:30:00'))).toBe('dusk');
    expect(Core.isDark(at('2026-12-21T17:05:00'))).toBe(false);
    expect(Core.isDark(at('2026-12-21T17:12:00'))).toBe(true);
    expect(Core.dayPhase(at('2026-12-21T19:00:00'))).toBe('evening');
    expect(Core.dayPhase(at('2026-12-21T22:10:00'))).toBe('late');
  });
  test('summer: 18:30 is still light (黃昏), 05:00 is 清晨 and already light by 05:10', () => {
    expect(Core.dayPhase(at('2026-06-21T18:30:00'))).toBe('dusk');
    expect(Core.isDark(at('2026-06-21T18:30:00'))).toBe(false);
    expect(Core.dayPhase(at('2026-06-21T05:00:00'))).toBe('dawn');
    expect(Core.isDark(at('2026-06-21T05:10:00'))).toBe(false);
    expect(Core.dayPhase(at('2026-06-21T03:00:00'))).toBe('late');
  });
  test('the same 06:20 in winter is still dark (dawn), in summer it is day', () => {
    expect(Core.isDark(at('2026-12-21T06:20:00'))).toBe(true);
    expect(Core.dayPhase(at('2026-12-21T06:20:00'))).toBe('dawn');
    expect(Core.dayPhase(at('2026-06-21T06:20:00'))).toBe('day');
  });
});
