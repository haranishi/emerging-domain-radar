/** Opportunity Score（調査優先度・architecture §5.4）。 */
import { describe, expect, it } from 'vitest';
import {
  FADING_PENALTY,
  JAPAN_GAP_NEUTRAL,
  MAINSTREAM_PENALTY,
  NO_AVAILABLE_FACTOR,
  OPPORTUNITY_WEIGHTS,
  TRADEMARK_RISK_PENALTY,
  isAvailable,
  opportunityBreakdown,
  opportunityScore,
} from '../../src/lib/scoring/opportunity';

const base = {
  trendScore: 80,
  domainScore: 90,
  japanGapScore: 100,
  noveltyScore: 100,
  status: 'Rising' as const,
  fading: false,
  trademarkFlagged: false,
  premium: 'standard_inferred' as const,
  registrationPrice: 11.08,
};

describe('opportunityBreakdown', () => {
  it('式どおりの重み', () => {
    const r = opportunityBreakdown(base);
    expect(r.base).toBeCloseTo(0.45 * 80 + 0.25 * 90 + 0.15 * 100 + 0.15 * 100, 6);
    expect(r.score).toBe(89);
  });

  it('重みの合計は 1', () => {
    expect(Object.values(OPPORTUNITY_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 10);
  });

  it('Japan Gap が null なら中立値 50 を使う', () => {
    const r = opportunityBreakdown({ ...base, japanGapScore: null });
    expect(r.japanGap).toBe(JAPAN_GAP_NEUTRAL);
  });

  it('Mainstream は −30、Trending は −10、それ以外は 0', () => {
    expect(MAINSTREAM_PENALTY).toEqual({ Mainstream: 30, Trending: 10, Rising: 0, Emerging: 0, Early: 0 });
    expect(opportunityBreakdown({ ...base, status: 'Mainstream' }).mainstreamPenalty).toBe(30);
    expect(opportunityBreakdown({ ...base, status: 'Trending' }).mainstreamPenalty).toBe(10);
    expect(opportunityBreakdown({ ...base, status: 'Emerging' }).mainstreamPenalty).toBe(0);
  });

  it('fading は追加で −10', () => {
    const normal = opportunityScore(base);
    const fading = opportunityScore({ ...base, fading: true });
    expect(normal - fading).toBe(FADING_PENALTY);
  });

  it('商標フラグは −40', () => {
    const normal = opportunityScore(base);
    const flagged = opportunityScore({ ...base, trademarkFlagged: true });
    expect(normal - flagged).toBe(TRADEMARK_RISK_PENALTY);
  });

  it('価格ペナルティ: premium 20 / >$50 15 / >$20 5 / それ以下 0', () => {
    expect(opportunityBreakdown({ ...base, premium: 'premium' }).pricePenalty).toBe(20);
    expect(opportunityBreakdown({ ...base, registrationPrice: 60 }).pricePenalty).toBe(15);
    expect(opportunityBreakdown({ ...base, registrationPrice: 25 }).pricePenalty).toBe(5);
    expect(opportunityBreakdown({ ...base, registrationPrice: 11.08 }).pricePenalty).toBe(0);
    expect(opportunityBreakdown({ ...base, registrationPrice: null }).pricePenalty).toBe(0);
  });

  it('空きが 1 件も無いときはドメイン項を除いて 0.6 倍', () => {
    const r = opportunityBreakdown({ ...base, domainScore: null, registrationPrice: null, premium: null });
    const withoutDomain = 0.45 * 80 + 0.15 * 100 + 0.15 * 100;
    expect(r.noAvailableFactorApplied).toBe(true);
    expect(r.score).toBe(Math.round(withoutDomain * NO_AVAILABLE_FACTOR));
  });

  it('0〜100 に収まる', () => {
    const worst = opportunityScore({
      trendScore: 0,
      domainScore: 0,
      japanGapScore: 0,
      noveltyScore: 0,
      status: 'Mainstream',
      fading: true,
      trademarkFlagged: true,
      premium: 'premium',
      registrationPrice: 500,
    });
    expect(worst).toBe(0);
    const best = opportunityScore({
      trendScore: 100,
      domainScore: 100,
      japanGapScore: 100,
      noveltyScore: 100,
      status: 'Emerging',
      fading: false,
      trademarkFlagged: false,
      premium: 'standard_inferred',
      registrationPrice: 11.08,
    });
    expect(best).toBe(100);
  });
});

describe('isAvailable', () => {
  it('available だけを空きとして扱う（unknown は含めない）', () => {
    expect(isAvailable('available')).toBe(true);
    expect(isAvailable('taken')).toBe(false);
    expect(isAvailable('unknown')).toBe(false);
    expect(isAvailable('unsupported')).toBe(false);
    expect(isAvailable(null)).toBe(false);
  });
});
