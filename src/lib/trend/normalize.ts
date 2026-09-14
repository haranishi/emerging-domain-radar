/**
 * ソース正規化。生件数をソースごとの目安で割り「参照単位」に揃える（architecture §5.4）。
 *
 *   units_s = raw_s × 100 / SCALE_s
 *
 * SCALE は「そこそこ有名な語の 30 日件数」の初期値。1 か所の定数として置き、
 * 2 週間ぶんのデータを貯めてから再調整する前提（research/04 §3.3）。
 */
import type { SourceId, WindowCounts, WindowId } from './types';
import { emptyCounts } from './types';

export const SCALE: Readonly<Record<SourceId, number>> = {
  hn: 300,
  github: 200,
  arxiv: 100,
  openalex: 300,
  qiita: 100,
  wikipv: 3000,
} as const;

export function toUnits(source: SourceId, raw: number): number {
  return (raw * 100) / SCALE[source];
}

export interface SourceMeasurement {
  source: SourceId;
  counts: WindowCounts;
}

export interface Aggregate {
  /** ソース横断の参照単位の合計。 */
  c7: number;
  c7prev: number;
  c30: number;
  c30prev: number;
  /** 30 日の生件数が 1 以上のソース数。 */
  S: number;
  /** このランで問い合わせたソース数。 */
  S_TOTAL: number;
  unitsBySource: Partial<Record<SourceId, WindowCounts>>;
  rawBySource: Partial<Record<SourceId, WindowCounts>>;
}

/**
 * 集計する。`sourcesQueried` は enabled で問い合わせを試みたソース数。
 * 失敗ソースの件数は集計に入れないが、Breadth の分母には含める。
 */
export function aggregate(measurements: SourceMeasurement[], sourcesQueried: number): Aggregate {
  const totals = emptyCounts();
  const unitsBySource: Partial<Record<SourceId, WindowCounts>> = {};
  const rawBySource: Partial<Record<SourceId, WindowCounts>> = {};
  let S = 0;

  for (const m of measurements) {
    const units = emptyCounts();
    for (const w of Object.keys(totals) as WindowId[]) {
      const u = toUnits(m.source, m.counts[w] ?? 0);
      units[w] = u;
      totals[w] += u;
    }
    unitsBySource[m.source] = units;
    rawBySource[m.source] = { ...m.counts };
    if ((m.counts['30d'] ?? 0) > 0) S += 1;
  }

  return {
    c7: totals['7d'],
    c7prev: totals.prev7d,
    c30: totals['30d'],
    c30prev: totals.prev30d,
    S,
    S_TOTAL: sourcesQueried,
    unitsBySource,
    rawBySource,
  };
}
