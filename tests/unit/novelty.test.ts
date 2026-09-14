/** Novelty Score（architecture §5.4）。 */
import { describe, expect, it } from 'vitest';
import { NOVELTY_FLOOR, noveltyScore, noveltyScoreFromAgeDays } from '../../src/lib/trend/novelty';

describe('noveltyScoreFromAgeDays', () => {
  const cases: [number, number][] = [
    [0, 100],
    [30, 100],
    [31, 85],
    [60, 85],
    [61, 60],
    [180, 60],
    [181, 35],
    [365, 35],
    [366, NOVELTY_FLOOR],
    [3000, NOVELTY_FLOOR],
  ];
  for (const [age, score] of cases) {
    it(`${age} 日 → ${score}`, () => {
      expect(noveltyScoreFromAgeDays(age)).toBe(score);
    });
  }
});

describe('noveltyScore', () => {
  const now = new Date('2026-09-03T00:00:00.000Z');
  const daysAgo = (n: number): string => new Date(now.getTime() - n * 86_400_000).toISOString();

  it('候補日のうち最も古いものを初出とみなす', () => {
    const r = noveltyScore([daysAgo(10), daysAgo(200), daysAgo(40)], now);
    expect(r.score).toBe(35); // 200 日 → 「<=365 日」の帯
    expect(r.firstSeenAt).toBe(daysAgo(200));
    expect(Math.round(r.ageDays ?? 0)).toBe(200);
  });

  it('最古が 150 日前なら 60（<=180 日の帯）', () => {
    expect(noveltyScore([daysAgo(150), daysAgo(3)], now).score).toBe(60);
  });

  it('候補が無ければ 100（まだ観測できていない＝今回が初出）', () => {
    expect(noveltyScore([], now)).toEqual({ score: 100, firstSeenAt: null, ageDays: null });
    expect(noveltyScore([null, undefined, ''], now).score).toBe(100);
  });

  it('壊れた日付は無視する', () => {
    const r = noveltyScore(['not-a-date', daysAgo(5)], now);
    expect(r.score).toBe(100);
    expect(r.firstSeenAt).toBe(daysAgo(5));
  });
});
