/**
 * デモデータの投入。
 *
 *   npm run seed:demo
 *   RADAR_DB_PATH=.tmp/demo.db npm run seed:demo
 *
 * 収集を実行しなくてもダッシュボードの見え方を確認できるようにするためのもの。
 * `fixtures/demo-run.json` を「最新の完了ラン」として DB に流し込む。
 * 実データではないので、投入した run の notes にその旨を書く。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { dbPath, projectRoot } from '../src/lib/env';
import { getDb, nowIso, truncateAll } from '../src/lib/db/client';
import { finishRun, startRun } from '../src/lib/db/repos/runs';
import { upsertKeyword } from '../src/lib/db/repos/keywords';
import { saveMetrics } from '../src/lib/db/repos/metrics';
import { saveScore } from '../src/lib/db/repos/scores';
import { getDomainRow, upsertDomains } from '../src/lib/db/repos/domains';
import { insertDomainCheck } from '../src/lib/db/repos/domainChecks';
import { upsertTldPrices } from '../src/lib/db/repos/tldPrices';
import { saveOpportunities } from '../src/lib/db/repos/opportunity';
import { addToWatchlist, appendWatchlistPrice } from '../src/lib/db/repos/watchlist';
import { saveFxRate } from '../src/lib/db/repos/fx';
import type { Availability, Premium, SourceId, Status, WindowId } from '../src/lib/db/types';

interface DemoMetric {
  source: SourceId;
  window: WindowId;
  count: number;
  approximate: boolean;
  queryUrl: string;
  fetchedAt: string;
}

interface DemoDomain {
  domain: string;
  generationRule: string;
  domainScore: number | null;
  trademarkFlag: string | null;
  availability: Availability;
  availabilitySource: string;
  registrationPrice: number | null;
  renewalPrice: number | null;
  currency: string | null;
  premium: Premium;
  priceSource: string | null;
  checkedAt: string;
  opportunityScore: number | null;
  opportunityBreakdown: unknown;
}

interface DemoKeyword {
  keyword: string;
  slug: string;
  description: string;
  whyEmerging: string;
  firstSeenContext: string;
  relatedTerms: string[];
  extractionMethod: string;
  llmConfidence: number | null;
  llmBasis: string | null;
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
    g7: number;
    g30: number;
    breakdown: unknown;
  };
  domains: DemoDomain[];
  fallbackOpportunity: { score: number } | null;
}

interface DemoFile {
  referenceNow: string;
  run: { startedAt: string; finishedAt: string; status: string; notes: string };
  tldPrices: { tld: string; registration: number; renewal: number; transfer: number; currency: string; source: string }[];
  fx: { base: string; quote: string; rate: number; asOf: string; source: string; providers: unknown };
  watchlist: {
    keyword: string;
    domain: string;
    foundRegistrationPrice: number | null;
    foundRenewalPrice: number | null;
    currency: string | null;
    note: string | null;
  }[];
  keywords: DemoKeyword[];
}

function main(): void {
  const file = path.join(projectRoot(), 'fixtures', 'demo-run.json');
  const demo = JSON.parse(readFileSync(file, 'utf8')) as DemoFile;
  const db = getDb();

  // 何度実行しても同じ状態になるように全消しから始める。
  truncateAll(db);

  upsertTldPrices(db, demo.tldPrices);
  saveFxRate(db, {
    base: demo.fx.base,
    quote: demo.fx.quote,
    rate: demo.fx.rate,
    as_of: demo.fx.asOf,
    source: demo.fx.source,
    providers: demo.fx.providers,
  });

  const runId = startRun(db, demo.run.notes);
  let domainCount = 0;
  let opportunityCount = 0;

  for (const k of demo.keywords) {
    const keywordId = upsertKeyword(db, {
      slug: k.slug,
      keyword: k.keyword,
      description: k.description,
      why_emerging: k.whyEmerging,
      first_seen_context: k.firstSeenContext,
      related_terms: k.relatedTerms,
      extraction_method: k.extractionMethod,
      llm_confidence: k.llmConfidence,
      llm_basis: k.llmBasis,
      first_seen_at: k.firstSeenAt,
      run_id: runId,
    });

    saveMetrics(
      db,
      k.metrics.map((m) => ({
        run_id: runId,
        keyword_id: keywordId,
        source: m.source,
        window: m.window,
        count: m.count,
        approximate: m.approximate,
        query_url: m.queryUrl,
        fetched_at: m.fetchedAt,
      })),
    );

    saveScore(db, {
      run_id: runId,
      keyword_id: keywordId,
      trend_score: k.scores.trendScore,
      novelty_score: k.scores.noveltyScore,
      japan_gap_score: k.scores.japanGapScore,
      status: k.scores.status,
      fading: k.scores.fading,
      breadth: k.scores.breadth,
      c30_units: k.scores.c30Units,
      g7: k.scores.g7,
      g30: k.scores.g30,
      breakdown: k.scores.breakdown,
    });

    upsertDomains(
      db,
      k.domains.map((d) => ({
        keyword_id: keywordId,
        domain: d.domain,
        generation_rule: d.generationRule,
        domain_score: d.domainScore,
        trademark_flag: d.trademarkFlag,
        run_id: runId,
      })),
    );
    domainCount += k.domains.length;

    const opportunityRows = [];
    for (const d of k.domains) {
      insertDomainCheck(db, {
        domain: d.domain,
        checked_at: d.checkedAt,
        availability: d.availability,
        availability_source: d.availabilitySource,
        registration_price: d.registrationPrice,
        renewal_price: d.renewalPrice,
        currency: d.currency,
        premium: d.premium,
        price_source: d.priceSource,
        raw: { seeded: true },
        run_id: runId,
      });
      if (d.opportunityScore === null) continue;
      const row = getDomainRow(db, keywordId, d.domain);
      opportunityRows.push({
        run_id: runId,
        keyword_id: keywordId,
        domain_id: row?.id ?? null,
        score: d.opportunityScore,
        breakdown: d.opportunityBreakdown,
      });
    }
    if (opportunityRows.length === 0 && k.fallbackOpportunity) {
      opportunityRows.push({
        run_id: runId,
        keyword_id: keywordId,
        domain_id: null,
        score: k.fallbackOpportunity.score,
        breakdown: k.fallbackOpportunity,
      });
    }
    saveOpportunities(db, opportunityRows);
    opportunityCount += opportunityRows.length;
  }

  // Watchlist（発見時価格と現在価格の差分を見せるため履歴も 2 点入れる）
  for (const w of demo.watchlist) {
    const kw = demo.keywords.find((k) => k.keyword === w.keyword);
    const current = kw?.domains.find((d) => d.domain === w.domain);
    const id = addToWatchlist(db, {
      keyword: w.keyword,
      domain: w.domain,
      found_registration_price: w.foundRegistrationPrice,
      found_renewal_price: w.foundRenewalPrice,
      found_currency: w.currency,
      trend_score: kw?.scores.trendScore ?? null,
      opportunity_score: current?.opportunityScore ?? null,
      note: w.note,
    });
    appendWatchlistPrice(db, id, {
      registration_price: w.foundRegistrationPrice,
      renewal_price: w.foundRenewalPrice,
      availability: 'available',
      premium: 'standard_inferred',
    });
    appendWatchlistPrice(db, id, {
      registration_price: current?.registrationPrice ?? null,
      renewal_price: current?.renewalPrice ?? null,
      availability: current?.availability ?? 'unknown',
      premium: current?.premium ?? 'unknown',
    });
  }

  finishRun(
    db,
    runId,
    'completed',
    {
      seeded: true,
      referenceNow: demo.referenceNow,
      keywords: demo.keywords.length,
      domains: domainCount,
      opportunity: opportunityCount,
      seededAt: nowIso(),
    },
    demo.run.notes,
  );

  process.stdout.write(
    `[seed] ${dbPath()} に投入しました: run=${runId} keywords=${demo.keywords.length} domains=${domainCount} opportunity=${opportunityCount} watchlist=${demo.watchlist.length}\n`,
  );
  process.stdout.write('[seed] これはデモデータです。実データは `npm run radar:collect` で作ります。\n');
}

try {
  main();
} catch (err) {
  process.stderr.write(`seed に失敗しました: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
}
