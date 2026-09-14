/** ソース正規化（architecture §5.4 の SCALE）。 */
import { describe, expect, it } from 'vitest';
import { SCALE, aggregate, toUnits } from '../../src/lib/trend/normalize';

describe('SCALE', () => {
  it('確定値', () => {
    expect(SCALE).toEqual({ hn: 300, github: 200, arxiv: 100, openalex: 300, qiita: 100, wikipv: 3000 });
  });

  it('units = raw × 100 / SCALE', () => {
    expect(toUnits('hn', 300)).toBe(100);
    expect(toUnits('github', 100)).toBe(50);
    expect(toUnits('arxiv', 7)).toBe(7);
    expect(toUnits('openalex', 525)).toBe(175);
    expect(toUnits('wikipv', 3000)).toBe(100);
  });
});

describe('aggregate', () => {
  const measurements = [
    { source: 'hn' as const, counts: { '7d': 5, prev7d: 8, '30d': 28, prev30d: 12 } },
    { source: 'github' as const, counts: { '7d': 50, prev7d: 48, '30d': 206, prev30d: 150 } },
    { source: 'arxiv' as const, counts: { '7d': 2, prev7d: 1, '30d': 7, prev30d: 4 } },
    { source: 'openalex' as const, counts: { '7d': 90, prev7d: 60, '30d': 525, prev30d: 300 } },
  ];

  it('参照単位の合計を出す', () => {
    const a = aggregate(measurements, 4);
    expect(a.c30).toBeCloseTo(28 / 3 + 103 + 7 + 175, 6);
    expect(a.c7).toBeCloseTo(5 / 3 + 25 + 2 + 30, 6);
    expect(a.S).toBe(4);
    expect(a.S_TOTAL).toBe(4);
  });

  it('S は 30 日の生件数が 1 以上のソース数（0 のソースは数えない）', () => {
    const a = aggregate(
      [
        { source: 'hn', counts: { '7d': 1, prev7d: 0, '30d': 2, prev30d: 0 } },
        { source: 'github', counts: { '7d': 0, prev7d: 0, '30d': 0, prev30d: 0 } },
      ],
      4,
    );
    expect(a.S).toBe(1);
    expect(a.S_TOTAL).toBe(4);
  });

  it('ソースごとの生件数と参照単位を両方残す（内訳の表示用）', () => {
    const a = aggregate(measurements, 4);
    expect(a.rawBySource.hn?.['30d']).toBe(28);
    expect(a.unitsBySource.hn?.['30d']).toBeCloseTo(28 / 3, 6);
  });

  it('問い合わせたソースが 0 でも落ちない', () => {
    const a = aggregate([], 0);
    expect(a).toMatchObject({ c7: 0, c30: 0, S: 0, S_TOTAL: 0 });
  });

  it('失敗ソースは分子や metrics に入れず、試行した数として分母に残す', () => {
    const a = aggregate([measurements[0]], 4);
    expect(a.S).toBe(1);
    expect(a.S_TOTAL).toBe(4);
    expect(Object.keys(a.rawBySource)).toEqual(['hn']);
  });
});
