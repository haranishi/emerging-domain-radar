/**
 * Japan Gap Score（日本未上陸度・0〜100）。式は docs/03_architecture.md §5.4。
 *
 *   jpUnits = qiita30 × 100/100 + (wikiJa ? 20 + pv30 × 100/3000 : 0)
 *   enUnits = c30（英語圏ソース横断の参照単位）
 *   enUnits === 0 → null（比べる相手が無いので出さない）
 *   gap = round(100 × clamp(1 − jpUnits / enUnits, 0, 1))
 *   wikiJa なら上限 40（記事があるなら「未上陸」とは言えない）
 */
import { SCALE } from '../trend/normalize';

export const WIKI_PRESENT_BONUS = 20;
export const WIKI_PRESENT_CAP = 40;

const clamp = (x: number, lo = 0, hi = 1): number => Math.min(hi, Math.max(lo, x));

export interface JapanGapInput {
  /** Qiita の 30 日件数（英語フレーズ＋日本語訳の合算）。 */
  qiita30: number;
  qiita30prev?: number;
  wikiJa: boolean;
  pv30: number;
  /** 英語圏の 30 日参照単位合計。 */
  enUnits: number;
  /**
   * en.wikipedia langlinks で取れた日本語タイトル。
   * null は「訳が分からない」＝英語フレーズだけで測った、という意味
   * （画面は「JP equivalent unknown」と注記する）。
   */
  jaEquivalent?: string | null;
}

export interface JapanGapBreakdown {
  jpUnits: number;
  enUnits: number;
  qiitaUnits: number;
  wikiUnits: number;
  capped: boolean;
  score: number | null;
  /** 日本語で何と呼ばれているか。null なら不明（英語フレーズだけの計測）。 */
  jaEquivalent: string | null;
}

export function japanGapBreakdown(input: JapanGapInput): JapanGapBreakdown {
  const qiitaUnits = (input.qiita30 * 100) / SCALE.qiita;
  const wikiUnits = input.wikiJa ? WIKI_PRESENT_BONUS + (input.pv30 * 100) / SCALE.wikipv : 0;
  const jpUnits = qiitaUnits + wikiUnits;
  const jaEquivalent = input.jaEquivalent ?? null;

  if (input.enUnits === 0) {
    return { jpUnits, enUnits: 0, qiitaUnits, wikiUnits, capped: false, score: null, jaEquivalent };
  }

  let score = Math.round(100 * clamp(1 - jpUnits / input.enUnits, 0, 1));
  let capped = false;
  if (input.wikiJa && score > WIKI_PRESENT_CAP) {
    score = WIKI_PRESENT_CAP;
    capped = true;
  }
  return { jpUnits, enUnits: input.enUnits, qiitaUnits, wikiUnits, capped, score, jaEquivalent };
}

export function japanGapScore(input: JapanGapInput): number | null {
  return japanGapBreakdown(input).score;
}
