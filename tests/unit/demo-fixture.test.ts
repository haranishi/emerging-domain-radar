/**
 * `fixtures/demo-run.json` が現在のスコア式と整合しているかを検査する。
 *
 * デモデータは src/lib のスコア実装で計算して作った。式や閾値を変えるとこのテストが落ちる。
 * 落ちたら fixtures/demo-run.json の `scores` / `domains[].opportunityScore` を
 * 現在の実装で計算し直す（件数 metrics は手で決めた入力なのでそのまま使える）。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { projectRoot } from '../../src/lib/env';
import { aggregate, type SourceMeasurement } from '../../src/lib/trend/normalize';
import { trendBreakdown } from '../../src/lib/trend/score';
import { classifyStatus } from '../../src/lib/trend/status';
import { japanGapBreakdown } from '../../src/lib/japan/score';
import { opportunityBreakdown } from '../../src/lib/scoring/opportunity';
import { scoreDomain } from '../../src/lib/domain/score';
import type { Availability, Premium, SourceId, Status, WindowId } from '../../src/lib/db/types';
import type { KeywordMatch } from '../../src/lib/domain/score';

interface DemoMetric {
  source: SourceId;
  window: WindowId;
  count: number;
  approximate: boolean;
  queryUrl: string;
}

interface DemoDomain {
  domain: string;
  generationRule: KeywordMatch;
  domainScore: number | null;
  trademarkFlag: string | null;
  availability: Availability;
  registrationPrice: number | null;
  renewalPrice: number | null;
  premium: Premium;
  opportunityScore: number | null;
}

interface DemoKeyword {
  keyword: string;
  slug: string;
  description: string;
  whyEmerging: string;
  relatedTerms: string[];
  firstSeenAt: string;
  metrics: DemoMetric[];
  scores: {
    trendScore: number;
    noveltyScore: number;
    japanGapScore: number | null;
    status: Status;
    fading: boolean;
    breadth: number;
    c30Units: number;
  };
  domains: DemoDomain[];
}

interface DemoFile {
  referenceNow: string;
  keywords: DemoKeyword[];
  tldPrices: { tld: string; registration: number }[];
  fx: { rate: number };
  watchlist: { domain: string }[];
}

const demo = JSON.parse(readFileSync(path.join(projectRoot(), 'fixtures', 'demo-run.json'), 'utf8')) as DemoFile;
const TREND_SOURCES: SourceId[] = ['hn', 'github', 'arxiv', 'openalex'];

describe('demo-run.json の中身', () => {
  it('キーワードが 8 件以上ある', () => {
    expect(demo.keywords.length).toBeGreaterThanOrEqual(8);
  });

  it('Status が 5 種類すべて含まれる', () => {
    const statuses = new Set(demo.keywords.map((k) => k.scores.status));
    expect([...statuses].sort()).toEqual(['Early', 'Emerging', 'Mainstream', 'Rising', 'Trending']);
  });

  it('fading・Japan Gap が null・空きゼロ の各ケースを含む', () => {
    expect(demo.keywords.some((k) => k.scores.fading)).toBe(true);
    expect(demo.keywords.some((k) => k.scores.japanGapScore === null)).toBe(true);
    expect(demo.keywords.some((k) => k.domains.every((d) => d.availability !== 'available'))).toBe(true);
  });

  it('各キーワードにソース別 4 窓の件数がある', () => {
    for (const k of demo.keywords) {
      for (const source of TREND_SOURCES) {
        const windows = k.metrics.filter((m) => m.source === source).map((m) => m.window).sort();
        expect(windows, `${k.keyword}/${source}`).toEqual(['30d', '7d', 'prev30d', 'prev7d']);
      }
      // Evidence の各行に検索 URL が付いている
      for (const m of k.metrics) expect(m.queryUrl.startsWith('https://'), k.keyword).toBe(true);
    }
  });

  it('ドメイン候補は 5〜10 件で、availability が 3 種類混ざっている', () => {
    const availabilities = new Set<string>();
    for (const k of demo.keywords) {
      expect(k.domains.length, k.keyword).toBeGreaterThanOrEqual(5);
      expect(k.domains.length, k.keyword).toBeLessThanOrEqual(10);
      for (const d of k.domains) {
        expect(d.domain.endsWith('.com')).toBe(true);
        availabilities.add(d.availability);
      }
    }
    expect([...availabilities].sort()).toEqual(['available', 'taken', 'unknown']);
  });

  it('価格は $11.08 と null（Price unavailable）が混ざっている', () => {
    const prices = demo.keywords.flatMap((k) => k.domains.map((d) => d.registrationPrice));
    expect(prices).toContain(11.08);
    expect(prices).toContain(null);
  });

  it('説明文・関連語・初出日が埋まっている', () => {
    for (const k of demo.keywords) {
      expect(k.description.length, k.keyword).toBeGreaterThan(10);
      expect(k.whyEmerging.length, k.keyword).toBeGreaterThan(10);
      expect(k.relatedTerms.length, k.keyword).toBeGreaterThan(0);
      expect(Date.parse(k.firstSeenAt)).toBeGreaterThan(0);
    }
  });

  it('通知条件（Trend>=80・Opportunity>=80）を満たす例が 1 件以上ある', () => {
    const hit = demo.keywords.some(
      (k) =>
        k.scores.trendScore >= 80 &&
        k.domains.some((d) => d.availability === 'available' && (d.opportunityScore ?? 0) >= 80),
    );
    expect(hit).toBe(true);
  });

  it('価格表と為替も入っている', () => {
    expect(demo.tldPrices.find((p) => p.tld === 'com')?.registration).toBe(11.08);
    expect(demo.fx.rate).toBeGreaterThan(0);
    expect(demo.watchlist.length).toBeGreaterThan(0);
  });
});

describe('demo-run.json のスコアが現在の式と一致する', () => {
  for (const k of demo.keywords) {
    it(`${k.keyword}`, () => {
      const measurements: SourceMeasurement[] = TREND_SOURCES.map((source) => {
        const rows = k.metrics.filter((m) => m.source === source);
        const counts = { '7d': 0, prev7d: 0, '30d': 0, prev30d: 0 };
        for (const r of rows) counts[r.window] = r.count;
        return { source, counts };
      });
      const agg = aggregate(measurements, TREND_SOURCES.length);
      const trend = trendBreakdown({
        c7: agg.c7,
        c7prev: agg.c7prev,
        c30: agg.c30,
        c30prev: agg.c30prev,
        S: agg.S,
        S_TOTAL: agg.S_TOTAL,
      });
      const status = classifyStatus(agg.c30, agg.c30prev, agg.S);

      expect(trend.trendScore).toBe(k.scores.trendScore);
      expect(status.status).toBe(k.scores.status);
      expect(status.fading).toBe(k.scores.fading);
      expect(agg.S).toBe(k.scores.breadth);
      expect(agg.c30).toBeCloseTo(k.scores.c30Units, 2);

      // Japan Gap（qiita / wikipv の行があるキーワードだけ）
      const qiita30 = k.metrics.find((m) => m.source === 'qiita' && m.window === '30d')?.count;
      if (qiita30 !== undefined) {
        const pv30 = k.metrics.find((m) => m.source === 'wikipv' && m.window === '30d')?.count ?? 0;
        const wikiJa = pv30 > 0;
        const gap = japanGapBreakdown({ qiita30, wikiJa, pv30, enUnits: agg.c30 });
        expect(gap.score).toBe(k.scores.japanGapScore);
      } else {
        expect(k.scores.japanGapScore).toBeNull();
      }

      // Domain Score と Opportunity
      for (const d of k.domains) {
        const recomputed = scoreDomain(d.domain, {
          keywordMatch: d.generationRule,
          renewalPrice: 11.08,
          isPremium: false,
          keywordTokens: k.keyword.split(' '),
        });
        expect(recomputed.score, d.domain).toBe(d.domainScore);

        if (d.availability !== 'available') {
          expect(d.opportunityScore, d.domain).toBeNull();
          continue;
        }
        const opp = opportunityBreakdown({
          trendScore: k.scores.trendScore,
          domainScore: d.domainScore,
          japanGapScore: k.scores.japanGapScore,
          noveltyScore: k.scores.noveltyScore,
          status: k.scores.status,
          fading: k.scores.fading,
          trademarkFlagged: Boolean(d.trademarkFlag),
          premium: d.premium,
          registrationPrice: d.registrationPrice,
        });
        expect(opp.score, d.domain).toBe(d.opportunityScore);
      }
    });
  }
});
