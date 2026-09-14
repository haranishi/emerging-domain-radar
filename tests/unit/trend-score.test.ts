/**
 * Trend Score の式（architecture §5.4）。
 * research/04 §3.4 の数値例を検算として入れている。
 */
import { describe, expect, it } from 'vitest';
import { ALPHA, K, VMAX, growthComponent, g30Of, g7Of, trendBreakdown, trendScore } from '../../src/lib/trend/score';

/**
 * 浮動小数の誤差を落としてから四捨五入する。
 * 0→3 の G は数学的にちょうど 12.5 だが、log2(2)/3 の誤差で 12.499999999999998 になり、
 * 素の Math.round では 12 に落ちる。research/04 の表（13）と突き合わせるために桁を丸める。
 */
const roundHalfUp = (x: number): number => Math.round(Number(x.toFixed(9)));

describe('growthComponent（Laplace 平滑化 + shrinkage）', () => {
  // research/04 §3.4 の表をそのまま検算する
  const cases: { c7prev: number; c7: number; g: number; growthRaw: number; w: number; G: number }[] = [
    { c7prev: 0, c7: 3, g: 2.0, growthRaw: 33, w: 0.38, G: 13 },
    { c7prev: 0, c7: 30, g: 11.0, growthRaw: 100, w: 0.86, G: 86 },
    { c7prev: 10, c7: 20, g: 1.77, growthRaw: 27, w: 0.86, G: 24 },
    { c7prev: 100, c7: 200, g: 1.97, growthRaw: 33, w: 0.98, G: 32 },
    { c7prev: 5, c7: 5, g: 1.0, growthRaw: 0, w: 0.67, G: 0 },
  ];

  for (const c of cases) {
    it(`${c7label(c)} → G=${c.G}`, () => {
      const r = growthComponent(c.c7, c.c7prev);
      expect(r.g).toBeCloseTo(c.g, 1);
      expect(Math.round(r.growthRaw)).toBe(c.growthRaw);
      expect(Number(r.w.toFixed(2))).toBeCloseTo(c.w, 2);
      expect(roundHalfUp(r.G)).toBe(c.G);
    });
  }

  function c7label(c: { c7prev: number; c7: number }): string {
    return `${c.c7prev} → ${c.c7}`;
  }

  it('0→3 は 13、0→30 は 86（素の比はどちらも無限大）', () => {
    expect(growthComponent(3, 0).G).toBeCloseTo(12.5, 6);
    expect(roundHalfUp(growthComponent(3, 0).G)).toBe(13);
    expect(roundHalfUp(growthComponent(30, 0).G)).toBe(86);
  });
});

describe('定数', () => {
  it('ALPHA=3 / K=5 / VMAX=1000', () => {
    expect(ALPHA).toBe(3);
    expect(K).toBe(5);
    expect(VMAX).toBe(1000);
  });
});

describe('trendBreakdown', () => {
  it('S=0 なら 0（打ち間違い語のハードゲート）', () => {
    const r = trendBreakdown({ c7: 5, c7prev: 0, c30: 0, c30prev: 0, S: 0, S_TOTAL: 4 });
    expect(r.trendScore).toBe(0);
    expect(r.gates.join()).toContain('S=0');
  });

  it('1 ソースのみ かつ c30<3 なら上限 40', () => {
    const r = trendBreakdown({ c7: 2, c7prev: 0, c30: 2, c30prev: 0, S: 1, S_TOTAL: 4 });
    expect(r.trendScore).toBeLessThanOrEqual(40);
    expect(r.gates.join()).toContain('上限 40');
  });

  it('Acceleration は a=1.5 で 50、a>=2 で 100', () => {
    // c7/7 ÷ c30/30 = a → c30 を固定して c7 を動かす
    const a15 = trendBreakdown({ c7: (1.5 * 7 * 30) / 30, c7prev: 1, c30: 30, c30prev: 10, S: 4, S_TOTAL: 4 });
    expect(Math.round(a15.A)).toBe(50);
    const a20 = trendBreakdown({ c7: (2 * 7 * 30) / 30, c7prev: 1, c30: 30, c30prev: 10, S: 4, S_TOTAL: 4 });
    expect(Math.round(a20.A)).toBe(100);
  });

  it('Breadth は S/S_TOTAL', () => {
    expect(trendBreakdown({ c7: 1, c7prev: 1, c30: 5, c30prev: 5, S: 2, S_TOTAL: 4 }).B).toBe(50);
    expect(trendBreakdown({ c7: 1, c7prev: 1, c30: 5, c30prev: 5, S: 4, S_TOTAL: 4 }).B).toBe(100);
  });

  it('Earliness は c30=0 で 100、c30>=1000 で 0', () => {
    expect(Math.round(trendBreakdown({ c7: 0, c7prev: 0, c30: 0, c30prev: 0, S: 2, S_TOTAL: 4 }).V)).toBe(100);
    expect(Math.round(trendBreakdown({ c7: 10, c7prev: 10, c30: 1000, c30prev: 900, S: 4, S_TOTAL: 4 }).V)).toBe(0);
    expect(Math.round(trendBreakdown({ c7: 3, c7prev: 3, c30: 10, c30prev: 10, S: 4, S_TOTAL: 4 }).V)).toBe(65);
    expect(Math.round(trendBreakdown({ c7: 30, c7prev: 30, c30: 100, c30prev: 100, S: 4, S_TOTAL: 4 }).V)).toBe(33);
  });

  it('0〜100 に収まり整数で返る', () => {
    for (const c30 of [0, 1, 10, 100, 1000, 10_000]) {
      for (const c7 of [0, 1, 10, 100]) {
        const s = trendScore({ c7, c7prev: 1, c30, c30prev: 1, S: 3, S_TOTAL: 4 });
        expect(Number.isInteger(s)).toBe(true);
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(100);
      }
    }
  });

  it('重みの合計は 1', () => {
    const r = trendBreakdown({ c7: 10, c7prev: 5, c30: 30, c30prev: 20, S: 4, S_TOTAL: 4 });
    const expected = 0.35 * r.G + 0.2 * r.A + 0.2 * r.B + 0.25 * r.V;
    expect(r.weighted).toBeCloseTo(expected, 6);
  });
});

describe('成長率ヘルパー', () => {
  it('g30 / g7 は Laplace 平滑化つき', () => {
    expect(g30Of(47, 17)).toBeCloseTo(50 / 20, 6);
    expect(g7Of(0, 0)).toBe(1);
  });
});
