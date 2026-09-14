/** 計測窓（architecture §5.1）。 */
import { describe, expect, it } from 'vitest';
import { WINDOW_IDS, arxivStamp, buildWindows, dateStamp, githubStamp, oldestBound, toEpochSec, windowsFor } from '../../src/lib/trend/windows';

const now = new Date('2026-09-03T00:00:00.000Z');
const DAY = 86_400_000;

describe('buildWindows', () => {
  const w = buildWindows(now);

  it('7d / prev7d / 30d / prev30d の 4 窓', () => {
    expect(Object.keys(w).sort()).toEqual(['30d', '7d', 'prev30d', 'prev7d']);
    expect(WINDOW_IDS).toEqual(['7d', 'prev7d', '30d', 'prev30d']);
  });

  it('7d は [now-7d, now)', () => {
    expect(w['7d'].from.toISOString()).toBe('2026-08-27T00:00:00.000Z');
    expect(w['7d'].to.toISOString()).toBe('2026-09-03T00:00:00.000Z');
  });

  it('prev7d は [now-14d, now-7d)', () => {
    expect(w.prev7d.from.toISOString()).toBe('2026-08-20T00:00:00.000Z');
    expect(w.prev7d.to.toISOString()).toBe('2026-08-27T00:00:00.000Z');
  });

  it('30d は [now-30d, now)・prev30d は [now-60d, now-30d)', () => {
    expect(w['30d'].from.toISOString()).toBe('2026-08-04T00:00:00.000Z');
    expect(w.prev30d.from.toISOString()).toBe('2026-07-05T00:00:00.000Z');
    expect(w.prev30d.to.toISOString()).toBe('2026-08-04T00:00:00.000Z');
  });

  it('60 日窓の下端は prev30d の下端と一致する', () => {
    expect(oldestBound(now).toISOString()).toBe(w.prev30d.from.toISOString());
  });
});

describe('windowsFor', () => {
  const w = buildWindows(now);

  it('7d のタイムスタンプは 30d にも入る（30d は総量）', () => {
    expect(windowsFor(new Date(now.getTime() - 3 * DAY), w).sort()).toEqual(['30d', '7d']);
  });

  it('prev7d のタイムスタンプは 30d にも入る', () => {
    expect(windowsFor(new Date(now.getTime() - 10 * DAY), w).sort()).toEqual(['30d', 'prev7d']);
  });

  it('40 日前は prev30d だけ', () => {
    expect(windowsFor(new Date(now.getTime() - 40 * DAY), w)).toEqual(['prev30d']);
  });

  it('60 日より前・未来はどの窓にも入らない', () => {
    expect(windowsFor(new Date(now.getTime() - 70 * DAY), w)).toEqual([]);
    expect(windowsFor(new Date(now.getTime() + DAY), w)).toEqual([]);
  });

  it('窓の下端は含み上端は含まない', () => {
    expect(windowsFor(w['7d'].from, w)).toContain('7d');
    expect(windowsFor(w['7d'].to, w)).toEqual([]);
  });
});

describe('各 API 用のタイムスタンプ書式', () => {
  it('arXiv は YYYYMMDDHHMM（GMT・分単位）', () => {
    expect(arxivStamp(now)).toBe('202609030000');
    expect(arxivStamp(new Date('2026-08-04T13:45:59Z'))).toBe('202608041345');
  });

  it('GitHub は ISO8601（秒まで・Z）', () => {
    expect(githubStamp(now)).toBe('2026-09-03T00:00:00Z');
  });

  it('OpenAlex / Qiita は YYYY-MM-DD', () => {
    expect(dateStamp(now)).toBe('2026-09-03');
  });

  it('epoch 秒', () => {
    expect(toEpochSec(now)).toBe(Math.floor(now.getTime() / 1000));
  });
});
