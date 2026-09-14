/**
 * Opportunity Score（表示名「調査優先度」）。式は docs/03_architecture.md §5.4。
 *
 *   O = 0.45·Trend + 0.25·Domain + 0.15·(JapanGap ?? 50) + 0.15·Novelty
 *       − mainstreamPenalty − trademarkRisk − pricePenalty
 *
 * これは「調べる順番」を決めるための合成指標であって購入判断ではない。
 * 購入を勧める文言・抵触しないと断定する文言は UI・コード・出力のどこにも書かない
 * （要件 §3・F10）。
 */
import type { Availability, Premium, Status } from '../db/types';

export const OPPORTUNITY_WEIGHTS = { trend: 0.45, domain: 0.25, japanGap: 0.15, novelty: 0.15 } as const;

export const MAINSTREAM_PENALTY: Readonly<Record<Status, number>> = {
  Mainstream: 30,
  Trending: 10,
  Rising: 0,
  Emerging: 0,
  Early: 0,
};

export const FADING_PENALTY = 10;
export const TRADEMARK_RISK_PENALTY = 40;
export const PREMIUM_PRICE_PENALTY = 20;
export const PRICE_OVER_50_PENALTY = 15;
export const PRICE_OVER_20_PENALTY = 5;
/** Japan Gap が取れないときの中立値。 */
export const JAPAN_GAP_NEUTRAL = 50;
/** 空きドメインが 1 件も無いときの係数。 */
export const NO_AVAILABLE_FACTOR = 0.6;

const clamp = (x: number, lo = 0, hi = 100): number => Math.min(hi, Math.max(lo, x));

export interface OpportunityInputs {
  trendScore: number;
  /** そのドメインの Domain Score。空きが無い場合は null。 */
  domainScore: number | null;
  japanGapScore: number | null;
  noveltyScore: number;
  status: Status;
  fading: boolean;
  /** 商標フラグが立っているか。 */
  trademarkFlagged: boolean;
  premium: Premium | null;
  registrationPrice: number | null;
}

export interface OpportunityBreakdown {
  trend: number;
  domain: number;
  japanGap: number;
  novelty: number;
  base: number;
  mainstreamPenalty: number;
  fadingPenalty: number;
  trademarkRisk: number;
  pricePenalty: number;
  noAvailableFactorApplied: boolean;
  score: number;
}

function pricePenaltyOf(premium: Premium | null, registrationPrice: number | null): number {
  if (premium === 'premium') return PREMIUM_PRICE_PENALTY;
  if (registrationPrice === null) return 0;
  if (registrationPrice > 50) return PRICE_OVER_50_PENALTY;
  if (registrationPrice > 20) return PRICE_OVER_20_PENALTY;
  return 0;
}

/** 空きドメイン 1 件に対する Opportunity。 */
export function opportunityBreakdown(input: OpportunityInputs): OpportunityBreakdown {
  const japanGap = input.japanGapScore ?? JAPAN_GAP_NEUTRAL;
  const hasDomain = input.domainScore !== null;
  const domain = input.domainScore ?? 0;

  const weighted =
    OPPORTUNITY_WEIGHTS.trend * input.trendScore +
    (hasDomain ? OPPORTUNITY_WEIGHTS.domain * domain : 0) +
    OPPORTUNITY_WEIGHTS.japanGap * japanGap +
    OPPORTUNITY_WEIGHTS.novelty * input.noveltyScore;

  const mainstreamPenalty = MAINSTREAM_PENALTY[input.status] ?? 0;
  const fadingPenalty = input.fading ? FADING_PENALTY : 0;
  const trademarkRisk = input.trademarkFlagged ? TRADEMARK_RISK_PENALTY : 0;
  const pricePenalty = hasDomain ? pricePenaltyOf(input.premium, input.registrationPrice) : 0;

  const raw = weighted - mainstreamPenalty - fadingPenalty - trademarkRisk - pricePenalty;
  // 空きが 1 件も無ければドメイン項を除いた値の 0.6 倍（UI に `no .com available` を出す）。
  const adjusted = hasDomain ? raw : raw * NO_AVAILABLE_FACTOR;

  return {
    trend: input.trendScore,
    domain,
    japanGap,
    novelty: input.noveltyScore,
    base: weighted,
    mainstreamPenalty,
    fadingPenalty,
    trademarkRisk,
    pricePenalty,
    noAvailableFactorApplied: !hasDomain,
    score: Math.round(clamp(adjusted)),
  };
}

export function opportunityScore(input: OpportunityInputs): number {
  return opportunityBreakdown(input).score;
}

/** 空き扱いにするのは `available` だけ（`unknown` は含めない）。 */
export const isAvailable = (a: Availability | null | undefined): boolean => a === 'available';
