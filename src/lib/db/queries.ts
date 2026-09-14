/**
 * 画面が使う読み出しモデル。ページ（サーバーコンポーネント）はここを直接呼び、
 * 自分の API を fetch しない（architecture §8）。
 */
import type { Db } from './client';
import { getLatestCompletedRun, getRun } from './repos/runs';
import { getKeywordBySlug, parseRelatedTerms } from './repos/keywords';
import { getMetricsForRun, groupMetrics } from './repos/metrics';
import { getScoresForRun, getScore } from './repos/scores';
import { listDomainsForKeyword } from './repos/domains';
import { getLatestCheck } from './repos/domainChecks';
import { getDomainOpportunity, getOpportunitiesForRun } from './repos/opportunity';
import type {
  Availability,
  DomainCheckRow,
  KeywordRow,
  MetricRow,
  Premium,
  RunRow,
  SourceId,
  Status,
  WindowId,
} from './types';

export interface DomainView {
  domainId: number;
  domain: string;
  generationRule: string | null;
  domainScore: number | null;
  trademarkFlag: string | null;
  availability: Availability | null;
  availabilitySource: string | null;
  registrationPrice: number | null;
  renewalPrice: number | null;
  currency: string | null;
  premium: Premium | null;
  priceSource: string | null;
  checkedAt: string | null;
}

export interface EvidenceRow {
  source: SourceId;
  counts: Partial<Record<WindowId, number>>;
  approximate: boolean;
  /** 人が確認する検索 URL（Evidence の各行に必ず付ける）。 */
  queryUrl: string | null;
  fetchedAt: string | null;
  /** 直近 7 日 ÷ 前 7 日（前が 0 のときは null）。 */
  change7: number | null;
  change30: number | null;
}

export interface KeywordCard {
  rank: number;
  keywordId: number;
  slug: string;
  keyword: string;
  description: string | null;
  whyEmerging: string | null;
  status: Status;
  fading: boolean;
  trendScore: number;
  noveltyScore: number;
  japanGapScore: number | null;
  opportunityScore: number;
  /** 空きドメインが 1 件も無いとき true。UI に `no .com available` を出す。 */
  noAvailableDomain: boolean;
  /** Why trending の上位 3 行（件数の多い順）。 */
  whyTrending: string[];
  /** カードに出す上位 3 件。詳細は全件。 */
  topDomains: DomainView[];
  domainCount: number;
  lastCheckedAt: string | null;
}

export interface KeywordDetail extends KeywordCard {
  firstSeenAt: string | null;
  firstSeenContext: string | null;
  relatedTerms: string[];
  extractionMethod: string | null;
  llmConfidence: number | null;
  llmBasis: string | null;
  evidence: EvidenceRow[];
  domains: DomainView[];
  excludedDomains: { domain: string; reason: string }[];
  trendBreakdown: unknown;
  opportunityBreakdown: unknown;
  /**
   * Japan Gap を測るときに使った日本語での呼び方（en.wikipedia langlinks 由来）。
   * null は「訳が分からないので英語フレーズだけで測った」という意味で、
   * 「日本語の言及が無い」ではない（画面は `JP equivalent unknown` と注記する）。
   */
  jaEquivalent: string | null;
  c30Units: number;
  g7: number;
  g30: number;
  breadth: number;
}

export interface KeywordFilters {
  status?: Status[];
  availableOnly?: boolean;
  maxPrice?: number;
  minTrend?: number;
  minOpportunity?: number;
  excludePremium?: boolean;
  maxLength?: number;
  /** 指定ソースで 30 日件数が 1 以上のキーワードだけ残す。 */
  sources?: SourceId[];
}

/** `keyword_scores.breakdown_json` の `japanGap.jaEquivalent` を取り出す（無ければ null）。 */
function jaEquivalentOf(breakdown: unknown): string | null {
  if (typeof breakdown !== 'object' || breakdown === null) return null;
  const japanGap = (breakdown as { japanGap?: unknown }).japanGap;
  if (typeof japanGap !== 'object' || japanGap === null) return null;
  const value = (japanGap as { jaEquivalent?: unknown }).jaEquivalent;
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function toDomainView(
  row: { id: number; domain: string; generation_rule: string | null; domain_score: number | null; trademark_flag: string | null },
  check: DomainCheckRow | undefined,
): DomainView {
  return {
    domainId: row.id,
    domain: row.domain,
    generationRule: row.generation_rule,
    domainScore: row.domain_score,
    trademarkFlag: row.trademark_flag,
    availability: check?.availability ?? null,
    availabilitySource: check?.availability_source ?? null,
    registrationPrice: check?.registration_price ?? null,
    renewalPrice: check?.renewal_price ?? null,
    currency: check?.currency ?? null,
    premium: check?.premium ?? null,
    priceSource: check?.price_source ?? null,
    checkedAt: check?.checked_at ?? null,
  };
}

function buildEvidence(metrics: MetricRow[]): EvidenceRow[] {
  const grouped = groupMetrics(metrics);
  const rows: EvidenceRow[] = [];
  for (const [source, windows] of Object.entries(grouped)) {
    const counts: Partial<Record<WindowId, number>> = {};
    let approximate = false;
    let queryUrl: string | null = null;
    let fetchedAt: string | null = null;
    for (const [w, m] of Object.entries(windows)) {
      if (!m) continue;
      counts[w as WindowId] = m.count;
      approximate = approximate || m.approximate === 1;
      queryUrl ??= m.query_url;
      fetchedAt ??= m.fetched_at;
    }
    const c7 = counts['7d'] ?? 0;
    const p7 = counts.prev7d ?? 0;
    const c30 = counts['30d'] ?? 0;
    const p30 = counts.prev30d ?? 0;
    rows.push({
      source: source as SourceId,
      counts,
      approximate,
      queryUrl,
      fetchedAt,
      change7: p7 > 0 ? c7 / p7 : null,
      change30: p30 > 0 ? c30 / p30 : null,
    });
  }
  return rows.sort((a, b) => (b.counts['30d'] ?? 0) - (a.counts['30d'] ?? 0));
}

/**
 * Why trending の 3 行。
 * 7 日窓を持つソース（hn/github/arxiv/openalex）を優先し、
 * 30 日窓しか無いソース（qiita/wikipv）は「7d 0 vs prev 0」と書かず 30 日で表す。
 */
function whyTrendingLines(evidence: EvidenceRow[]): string[] {
  const withWeekly = evidence.filter((e) => e.counts['7d'] !== undefined && (e.counts['7d'] ?? 0) > 0);
  const rest = evidence.filter((e) => !withWeekly.includes(e) && (e.counts['30d'] ?? 0) > 0);
  const approxTag = (e: EvidenceRow): string => (e.approximate ? ' (approx)' : '');
  const weekly = withWeekly.map((e) => {
    const c7 = e.counts['7d'] ?? 0;
    const p7 = e.counts.prev7d ?? 0;
    const delta = e.change7 === null ? 'new' : `${e.change7.toFixed(1)}x`;
    return `${e.source}: 7d ${c7} vs prev 7d ${p7} (${delta})${approxTag(e)}`;
  });
  const monthly = rest.map((e) => {
    const c30 = e.counts['30d'] ?? 0;
    const p30 = e.counts.prev30d;
    const delta = e.change30 === null ? 'new' : `${e.change30.toFixed(1)}x`;
    const prev = p30 === undefined ? '' : ` vs prev 30d ${p30} (${delta})`;
    return `${e.source}: 30d ${c30}${prev}${approxTag(e)}`;
  });
  return [...weekly, ...monthly].slice(0, 3);
}

/** ダッシュボードが読むラン。完了ランが無ければ undefined（空状態）。 */
export function getDashboardRun(db: Db, runId?: number): RunRow | undefined {
  return runId === undefined ? getLatestCompletedRun(db) : getRun(db, runId);
}

export function listKeywordCards(db: Db, runId: number, filters: KeywordFilters = {}): KeywordCard[] {
  const scores = getScoresForRun(db, runId);
  const opportunities = getOpportunitiesForRun(db, runId);
  const bestByKeyword = new Map<number, number>();
  for (const o of opportunities) {
    const cur = bestByKeyword.get(o.keyword_id);
    if (cur === undefined || o.score > cur) bestByKeyword.set(o.keyword_id, o.score);
  }

  const cards: KeywordCard[] = [];
  for (const s of scores) {
    const kw = db.prepare(`SELECT * FROM keywords WHERE id = ?`).get(s.keyword_id) as KeywordRow | undefined;
    if (!kw) continue;
    if (filters.status?.length && !filters.status.includes(s.status)) continue;
    if (filters.minTrend !== undefined && s.trend_score < filters.minTrend) continue;
    const opportunityScore = bestByKeyword.get(s.keyword_id) ?? 0;
    if (filters.minOpportunity !== undefined && opportunityScore < filters.minOpportunity) continue;

    const metrics = getMetricsForRun(db, runId, s.keyword_id);
    if (filters.sources?.length) {
      const hit = filters.sources.some((src) => metrics.some((m) => m.source === src && m.window === '30d' && m.count > 0));
      if (!hit) continue;
    }

    const allDomains = listDomainsForKeyword(db, s.keyword_id).map((d) => toDomainView(d, getLatestCheck(db, d.domain)));
    const pool = applyDomainFilters(allDomains, filters);
    // ドメイン条件を付けているのに 1 件も残らないキーワードは出さない。
    if (isDomainFilterActive(filters) && pool.length === 0) continue;

    const evidence = buildEvidence(metrics);
    const lastCheckedAt = allDomains.reduce<string | null>(
      (acc, d) => (d.checkedAt && (!acc || d.checkedAt > acc) ? d.checkedAt : acc),
      null,
    );

    cards.push({
      rank: 0,
      keywordId: s.keyword_id,
      slug: kw.slug,
      keyword: kw.keyword,
      description: kw.description,
      whyEmerging: kw.why_emerging,
      status: s.status,
      fading: s.fading === 1,
      trendScore: s.trend_score,
      noveltyScore: s.novelty_score,
      japanGapScore: s.japan_gap_score,
      opportunityScore,
      noAvailableDomain: !allDomains.some((d) => d.availability === 'available'),
      whyTrending: whyTrendingLines(evidence),
      // フィルターが効いているときはカードの 3 件も絞る（絞り込みと表示を食い違わせない）
      topDomains: pool.slice(0, 3),
      domainCount: allDomains.length,
      lastCheckedAt,
    });
  }

  cards.sort((a, b) => b.opportunityScore - a.opportunityScore || b.trendScore - a.trendScore);
  return cards.map((c, i) => ({ ...c, rank: i + 1 }));
}

function isDomainFilterActive(f: KeywordFilters): boolean {
  return f.availableOnly === true || f.excludePremium === true || f.maxPrice !== undefined || f.maxLength !== undefined;
}

function applyDomainFilters(domains: DomainView[], f: KeywordFilters): DomainView[] {
  let pool = domains;
  if (f.availableOnly) pool = pool.filter((d) => d.availability === 'available');
  if (f.excludePremium) pool = pool.filter((d) => d.premium !== 'premium');
  if (f.maxPrice !== undefined) {
    const max = f.maxPrice;
    pool = pool.filter((d) => d.registrationPrice !== null && d.registrationPrice <= max);
  }
  if (f.maxLength !== undefined) {
    const max = f.maxLength;
    pool = pool.filter((d) => d.domain.length <= max);
  }
  return pool;
}

export function getKeywordDetail(db: Db, slug: string, runId?: number): KeywordDetail | undefined {
  const kw = getKeywordBySlug(db, slug);
  if (!kw) return undefined;
  const run = getDashboardRun(db, runId);
  if (!run) return undefined;
  const score = getScore(db, run.id, kw.id);
  if (!score) return undefined;

  const breakdown: unknown = score.breakdown_json ? JSON.parse(score.breakdown_json) : null;
  const metrics = getMetricsForRun(db, run.id, kw.id);
  const evidence = buildEvidence(metrics);
  const domainRows = listDomainsForKeyword(db, kw.id);
  const domains = domainRows.map((d) => toDomainView(d, getLatestCheck(db, d.domain)));
  const excludedDomains = db
    .prepare(
      `SELECT domain, exclusion_reason AS reason
       FROM domains
       WHERE keyword_id = ? AND excluded = 1 AND exclusion_reason IS NOT NULL
       ORDER BY domain ASC`,
    )
    .all(kw.id) as { domain: string; reason: string }[];
  const opp = db
    .prepare(`SELECT * FROM opportunity WHERE run_id = ? AND keyword_id = ? ORDER BY score DESC LIMIT 1`)
    .get(run.id, kw.id) as { score: number; breakdown_json: string | null } | undefined;
  const lastCheckedAt = domains.reduce<string | null>(
    (acc, d) => (d.checkedAt && (!acc || d.checkedAt > acc) ? d.checkedAt : acc),
    null,
  );

  return {
    rank: 0,
    keywordId: kw.id,
    slug: kw.slug,
    keyword: kw.keyword,
    description: kw.description,
    whyEmerging: kw.why_emerging,
    status: score.status,
    fading: score.fading === 1,
    trendScore: score.trend_score,
    noveltyScore: score.novelty_score,
    japanGapScore: score.japan_gap_score,
    opportunityScore: opp?.score ?? 0,
    noAvailableDomain: !domains.some((d) => d.availability === 'available'),
    whyTrending: whyTrendingLines(evidence),
    topDomains: domains.slice(0, 3),
    domainCount: domains.length,
    lastCheckedAt,
    firstSeenAt: kw.first_seen_at,
    firstSeenContext: kw.first_seen_context,
    relatedTerms: parseRelatedTerms(kw),
    extractionMethod: kw.extraction_method,
    llmConfidence: kw.llm_confidence,
    llmBasis: kw.llm_basis,
    evidence,
    domains,
    excludedDomains,
    trendBreakdown: breakdown,
    opportunityBreakdown: opp?.breakdown_json ? JSON.parse(opp.breakdown_json) : null,
    jaEquivalent: jaEquivalentOf(breakdown),
    c30Units: score.c30_units,
    g7: score.g7,
    g30: score.g30,
    breadth: score.breadth,
  };
}

/**
 * URL クエリ → フィルター。
 * フィルター状態は URL に持たせる契約（02_ux_design.md §4-1）なので、
 * 画面と Route Handler が同じ解釈を使えるようにここに置く。
 *
 *   ?status=Emerging,Rising&available=1&maxPrice=20&minTrend=60
 *   &minOpportunity=70&excludePremium=1&maxLength=14&sources=hn,github
 */
export function parseKeywordFilters(params: URLSearchParams): KeywordFilters {
  const num = (key: string): number | undefined => {
    const raw = params.get(key);
    if (raw === null || raw.trim() === '') return undefined;
    const n = Number(raw);
    return Number.isFinite(n) ? n : undefined;
  };
  const list = (key: string): string[] =>
    (params.get(key) ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

  const validStatuses: Status[] = ['Early', 'Emerging', 'Rising', 'Trending', 'Mainstream'];
  const validSources: SourceId[] = ['hn', 'github', 'arxiv', 'openalex', 'qiita', 'wikipv'];

  const status = list('status').filter((s): s is Status => (validStatuses as string[]).includes(s));
  const sources = list('sources').filter((s): s is SourceId => (validSources as string[]).includes(s));

  const filters: KeywordFilters = {};
  if (status.length > 0) filters.status = status;
  if (sources.length > 0) filters.sources = sources;
  if (params.get('available') === '1') filters.availableOnly = true;
  if (params.get('excludePremium') === '1') filters.excludePremium = true;
  const maxPrice = num('maxPrice');
  if (maxPrice !== undefined) filters.maxPrice = maxPrice;
  const minTrend = num('minTrend');
  if (minTrend !== undefined) filters.minTrend = minTrend;
  const minOpportunity = num('minOpportunity');
  if (minOpportunity !== undefined) filters.minOpportunity = minOpportunity;
  const maxLength = num('maxLength');
  if (maxLength !== undefined) filters.maxLength = maxLength;
  return filters;
}

/** 通知条件（architecture §11 step 10）を満たす候補。CLI が stdout に出す。 */
export interface AlertCandidate {
  keyword: string;
  slug: string;
  domain: string;
  trendScore: number;
  opportunityScore: number;
  registrationPrice: number | null;
  currency: string | null;
}

export function listAlertCandidates(db: Db, runId: number): AlertCandidate[] {
  const out: AlertCandidate[] = [];
  for (const card of listKeywordCards(db, runId)) {
    // キーワードの Opportunity は所属ドメインの最大値なので、まずここで粗く落とす。
    if (card.trendScore < 80 || card.opportunityScore < 80) continue;
    const all = listDomainsForKeyword(db, card.keywordId).map((d) => toDomainView(d, getLatestCheck(db, d.domain)));
    for (const d of all) {
      if (d.availability !== 'available') continue;
      if (d.premium === 'premium') continue;
      if (d.registrationPrice === null || d.registrationPrice > 20) continue;
      // 判定と表示はドメイン単位の値で行う（キーワードの最大値を全行に出すと誤解を招く）。
      const score = getDomainOpportunity(db, runId, d.domainId)?.score;
      if (score === undefined || score < 80) continue;
      out.push({
        keyword: card.keyword,
        slug: card.slug,
        domain: d.domain,
        trendScore: card.trendScore,
        opportunityScore: score,
        registrationPrice: d.registrationPrice,
        currency: d.currency,
      });
    }
  }
  return out.sort((a, b) => b.opportunityScore - a.opportunityScore || a.domain.localeCompare(b.domain));
}
