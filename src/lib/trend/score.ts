/**
 * Trend Score（0〜100）。式は docs/03_architecture.md §5.4（research/04 §3.4 を採用）。
 * 定数は 1 か所。About ページにも同じ内容を表示する。
 */

export const ALPHA = 3;
/** shrinkage の強さ（観測数がこの値のとき信頼度 0.5）。 */
export const K = 5;
/** 「もう大きい」とみなす 30 日件数。 */
export const VMAX = 1000;

export const TREND_WEIGHTS = { growth: 0.35, acceleration: 0.2, breadth: 0.2, earliness: 0.25 } as const;

const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));

export interface GrowthComponent {
  /** Laplace 平滑化後の成長率。 */
  g: number;
  growthRaw: number;
  /** shrinkage の重み。 */
  w: number;
  G: number;
}

/**
 * Growth。Laplace 平滑化（α=3）で 0→n の爆発を抑え、shrinkage で薄い観測を減衰させる。
 * 検算（research/04 §3.4）: 0→3 で G=13、0→30 で G=86。
 */
export function growthComponent(c7: number, c7prev: number): GrowthComponent {
  const g = (c7 + ALPHA) / (c7prev + ALPHA);
  const growthRaw = 100 * clamp(Math.log2(g) / 3);
  const nObs = c7 + c7prev;
  const w = nObs / (nObs + K);
  return { g, growthRaw, w, G: growthRaw * w };
}

export interface TrendInput {
  c7: number;
  c7prev: number;
  c30: number;
  c30prev: number;
  /** 30 日件数が 1 以上のソース数。 */
  S: number;
  /** このランで問い合わせたソース数。 */
  S_TOTAL: number;
}

export interface TrendBreakdown {
  G: number;
  growthRaw: number;
  shrinkage: number;
  g: number;
  A: number;
  a: number;
  B: number;
  V: number;
  weighted: number;
  gates: string[];
  trendScore: number;
}

export function trendBreakdown(input: TrendInput): TrendBreakdown {
  const { c7, c7prev, c30, S, S_TOTAL } = input;
  const growth = growthComponent(c7, c7prev);

  // 加速: 直近 7 日の日平均 ÷ 直近 30 日の日平均
  const a = c7 / 7 / Math.max(c30 / 30, 1e-9);
  const A = 100 * clamp(a - 1);

  // ソース横断性
  const B = S_TOTAL > 0 ? 100 * (S / S_TOTAL) : 0;

  // 絶対量の小ささ
  const V = 100 * clamp(1 - Math.log10(1 + c30) / Math.log10(1 + VMAX));

  const weighted =
    TREND_WEIGHTS.growth * growth.G +
    TREND_WEIGHTS.acceleration * A +
    TREND_WEIGHTS.breadth * B +
    TREND_WEIGHTS.earliness * V;

  let trend = weighted;
  const gates: string[] = [];
  if (S === 0) {
    trend = 0;
    gates.push('S=0 → 0（どのソースにも出ない語）');
  }
  if (S <= 1 && c30 < 3) {
    trend = Math.min(trend, 40);
    gates.push('1 ソースのみ かつ c30<3 → 上限 40（裏が取れていない）');
  }

  return {
    G: growth.G,
    growthRaw: growth.growthRaw,
    shrinkage: growth.w,
    g: growth.g,
    A,
    a,
    B,
    V,
    weighted,
    gates,
    trendScore: Math.round(clamp(trend, 0, 100)),
  };
}

export function trendScore(input: TrendInput): number {
  return trendBreakdown(input).trendScore;
}

/** 30 日ベースの成長率（Status と fading の判定に使う）。 */
export function g30Of(c30: number, c30prev: number): number {
  return (c30 + ALPHA) / (c30prev + ALPHA);
}

/** 7 日ベースの成長率（表示用）。 */
export function g7Of(c7: number, c7prev: number): number {
  return (c7 + ALPHA) / (c7prev + ALPHA);
}
