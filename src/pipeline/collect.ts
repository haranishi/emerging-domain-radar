/**
 * 収集パイプライン（docs/03_architecture.md §11 の 10 ステップ）。
 *
 * 契約:
 *  - API キー 0 個で完走する。キーがあるソースだけ精度・レートが上がる
 *  - ソース単位の失敗は runs.notes に記録して他ソースで続行。全ソース失敗ならラン failed
 *  - 進捗ログは `[step] message` 形式。秘密は出さない
 *  - 外部への書き込みはしない。書き込み先はローカル SQLite だけ
 */
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { dbPath as defaultDbPath, describeEnv, getEnv, isOffline, OFFLINE_REFERENCE_NOW, resetEnvCache } from '../lib/env';
import { getHttpStats, logStep, resetHttpStats, SourceRateLimitError, type HttpStats } from '../lib/http';
import { getDb, nowIso, type Db } from '../lib/db/client';
import {
  appendRunNote,
  countRawItemsBySource,
  finishRun,
  getKeywordBySlug,
  listTrackedKeywords,
  saveMetrics,
  saveOpportunities,
  saveScore,
  slugify,
  startRun,
  upsertDomains,
  upsertKeyword,
  upsertRawItems,
  getDomainRow,
  listWatchlist,
} from '../lib/db/repos/index';
import { listAlertCandidates, type AlertCandidate } from '../lib/db/queries';
import { extractKeywords, type ExtractedKeyword } from '../lib/extract/index';
import { HARVEST_SOURCES, TREND_SOURCES } from '../lib/trend/sources/index';
import { hnOldestBefore } from '../lib/trend/sources/hn';
import { resetOpenAlexState } from '../lib/trend/sources/openalex';
import { SourceUnavailableError, type HarvestItem, type SourceId, type WindowId } from '../lib/trend/types';
import { aggregate, type SourceMeasurement } from '../lib/trend/normalize';
import { g7Of, trendBreakdown } from '../lib/trend/score';
import { classifyStatus } from '../lib/trend/status';
import { NOVELTY_FLOOR, noveltyScore } from '../lib/trend/novelty';
import { measureQiita, planQiitaWindows, qiitaBudget } from '../lib/japan/sources/qiita';
import { measureWikipedia } from '../lib/japan/sources/wikipedia';
import { fetchJaEquivalent } from '../lib/japan/sources/langlinks';
import { japanGapBreakdown } from '../lib/japan/score';
import { generateDomainCandidates, generateDomains } from '../lib/domain/generator';
import { getPricing, searchDomains } from '../lib/domain/index';
import { opportunityBreakdown } from '../lib/scoring/opportunity';
import { getUsdJpyCached } from '../lib/fx/frankfurter';

const WINDOW_IDS: readonly WindowId[] = ['7d', 'prev7d', '30d', 'prev30d'];

export interface CollectOptions {
  maxKeywords?: number;
  maxNewKeywords?: number;
  skipLlm?: boolean;
  /** 指定するとこの語だけを計測し、harvest と抽出をスキップする。 */
  keywords?: string[];
  /** 外部呼び出しの見積りだけ出して終わる。 */
  dryRun?: boolean;
  dbPath?: string;
  now?: Date;
}

export interface CollectStats {
  durationMs: number;
  harvested: Record<string, number>;
  candidates: number;
  keywordsMeasured: number;
  keywordsSaved: number;
  noiseDropped: number;
  domainsGenerated: number;
  domainsChecked: number;
  sourcesUnavailable: string[];
  http: HttpStats;
}

export interface CollectResult {
  runId: number;
  status: 'completed' | 'partial' | 'failed';
  stats: CollectStats;
  alerts: AlertCandidate[];
  notes: string[];
}

export interface DryRunEstimate {
  keywords: number;
  calls: Record<string, number>;
  total: number;
}

/** `--dry-run`: 実際には呼ばずに外部呼び出し件数を見積もる。 */
export function estimateCalls(keywordCount: number): DryRunEstimate {
  const calls: Record<string, number> = {
    'hn harvest': 2,
    'github harvest': 5,
    'arxiv harvest': 1,
    'hn measure': keywordCount,
    'hn novelty (最大)': keywordCount * 2,
    'github measure': keywordCount * 4,
    'arxiv measure': keywordCount,
    'openalex measure': keywordCount * 4,
    'en.wikipedia langlinks': keywordCount,
    'qiita measure (最大)': keywordCount * 4,
    'wikipedia measure': keywordCount * 3,
    'porkbun pricing': 1,
    'rdap bootstrap': 1,
    'dns + rdap (最大)': keywordCount * 10,
    fx: 1,
  };
  const total = Object.values(calls).reduce((a, b) => a + b, 0);
  return { keywords: keywordCount, calls, total };
}

/* --------------------------------------------------------------- 各ステップ */

async function harvestAll(
  db: Db,
  runId: number,
  now: Date,
  notes: string[],
  unavailable: Set<SourceId>,
): Promise<HarvestItem[]> {
  const items: HarvestItem[] = [];
  for (const source of HARVEST_SOURCES) {
    if (!source.enabled(getEnv())) {
      notes.push(`${source.id}: 無効化されているため harvest をスキップ`);
      continue;
    }
    try {
      const got = await source.harvest(now);
      logStep('harvest', `${source.id}: ${got.length} 件`);
      items.push(...got);
    } catch (err) {
      const rateLimited = err instanceof SourceRateLimitError;
      const note = rateLimited
        ? `${source.id}: unavailable・以降スキップ（${err.message}）`
        : `${source.id}: harvest 失敗（${errName(err)}）`;
      if (rateLimited) unavailable.add(source.id);
      notes.push(note);
      appendRunNote(db, runId, note);
      logStep('harvest', note);
    }
  }
  if (items.length > 0) {
    upsertRawItems(
      db,
      items.map((i) => ({
        source: i.source,
        external_id: i.externalId,
        title: i.title,
        url: i.url,
        created_at: i.createdAt,
        score: i.score,
        run_id: runId,
      })),
    );
  }
  return items;
}

interface Target {
  keyword: string;
  slug: string;
  extracted: ExtractedKeyword | null;
}

/**
 * 計測するキーワードを決める。
 *
 * 追跡継続（前回 Opportunity 順）と新規発見の両方に枠を割る。
 * 追跡を先に上限まで詰めると、キーワードが RADAR_MAX_KEYWORDS に達した翌日から
 * 新規が 1 語も入らなくなり RADAR_MAX_NEW_KEYWORDS が意味を失う。
 * そこで「合計 = 新規の枠（最大 RADAR_MAX_NEW_KEYWORDS）＋ 残りを追跡」とし、
 * 新規候補が足りないときは追跡で埋める（既定 25/15 なら 追跡 10 ＋ 新規 15）。
 */
function buildTargets(db: Db, extracted: ExtractedKeyword[], maxKeywords: number, maxNew: number): Target[] {
  const newSlots = Math.min(maxNew, maxKeywords);
  const trackedSlots = maxKeywords - newSlots;
  const tracked = listTrackedKeywords(db, maxKeywords);
  const targets: Target[] = [];
  const seen = new Set<string>();

  const pushTracked = (limit: number): void => {
    for (const row of tracked) {
      if (targets.length >= limit) break;
      if (seen.has(row.slug)) continue;
      seen.add(row.slug);
      targets.push({ keyword: row.keyword, slug: row.slug, extracted: null });
    }
  };

  pushTracked(trackedSlots);

  let added = 0;
  for (const e of extracted) {
    if (added >= newSlots || targets.length >= maxKeywords) break;
    const slug = slugify(e.keyword);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    targets.push({ keyword: e.keyword, slug, extracted: e });
    added += 1;
  }

  // 新規候補が枠より少なければ、残りは追跡で埋める。
  pushTracked(maxKeywords);
  return targets;
}

/* ------------------------------------------------------------------- 本体 */

export async function runCollect(opts: CollectOptions = {}): Promise<CollectResult> {
  resetEnvCache();
  const targetDbPath = opts.dbPath ?? defaultDbPath();
  const releaseLock = acquireCollectLock(path.dirname(targetDbPath));
  try {
    return await runCollectLocked(opts);
  } finally {
    releaseLock();
  }
}

interface CollectLockData {
  pid: number;
  startedAt: string;
}

export class CollectAlreadyRunningError extends Error {
  constructor(readonly lockPath: string, readonly pid: number) {
    super(`別の収集が実行中です（PID ${pid}）`);
    this.name = 'CollectAlreadyRunningError';
  }
}

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** DB と同じディレクトリに、プロセス間で原子的な collect.lock を確保する。 */
function acquireCollectLock(dbDir: string): () => void {
  mkdirSync(dbDir, { recursive: true });
  const lockPath = path.join(dbDir, 'collect.lock');
  const owner: CollectLockData = { pid: process.pid, startedAt: new Date().toISOString() };

  for (;;) {
    try {
      writeFileSync(lockPath, JSON.stringify(owner), { flag: 'wx' });
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      let existing: Partial<CollectLockData> = {};
      try {
        existing = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<CollectLockData>;
      } catch {
        // 壊れたロックは stale として置き換える。
      }
      if (typeof existing.pid === 'number' && pidIsAlive(existing.pid)) {
        throw new CollectAlreadyRunningError(lockPath, existing.pid);
      }
      try {
        unlinkSync(lockPath);
      } catch (unlinkError) {
        if ((unlinkError as NodeJS.ErrnoException).code !== 'ENOENT') throw unlinkError;
      }
    }
  }

  return () => {
    try {
      const current = JSON.parse(readFileSync(lockPath, 'utf8')) as Partial<CollectLockData>;
      if (current.pid === owner.pid && current.startedAt === owner.startedAt) unlinkSync(lockPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT' && !(err instanceof SyntaxError)) throw err;
    }
  };
}

async function runCollectLocked(opts: CollectOptions): Promise<CollectResult> {
  resetEnvCache();
  resetHttpStats();
  resetOpenAlexState();
  const env = getEnv();
  // オフラインは fixtures の実測日を基準にする（窓がずれて件数 0 になるのを防ぐ）。
  const now = opts.now ?? (isOffline() ? OFFLINE_REFERENCE_NOW : new Date());
  const t0 = Date.now();
  const maxKeywords = opts.maxKeywords ?? env.RADAR_MAX_KEYWORDS;
  const maxNew = opts.maxNewKeywords ?? env.RADAR_MAX_NEW_KEYWORDS;
  const notes: string[] = [];
  const unavailable = new Set<SourceId>();

  const db = getDb(opts.dbPath);
  // 設定の実値をログに出す（キーは set/unset だけ）。
  logStep('start', describeEnv());
  logStep('start', `offline=${isOffline() ? 'yes' : 'no'} maxKeywords=${maxKeywords} maxNewKeywords=${maxNew}`);

  // --dry-run はランを作らない。
  // 作ってしまうと「最新の完了ラン」がキーワード 0 件の見積りランになり、
  // ダッシュボードが前回の実データを見失う。
  if (opts.dryRun) {
    const tracked = opts.keywords?.length ?? listTrackedKeywords(db, maxKeywords).length;
    const est = estimateCalls(tracked || maxKeywords);
    logStep('dry-run', `キーワード ${est.keywords} 語の想定外部呼び出し: ${est.total} 件`);
    for (const [k, v] of Object.entries(est.calls)) logStep('dry-run', `  ${k}: ${v}`);
    logStep('dry-run', 'DB には何も書きません（ランも作りません）');
    return {
      runId: 0,
      status: 'completed',
      stats: emptyStats(Date.now() - t0),
      alerts: [],
      notes: ['dry-run'],
    };
  }

  // 1. ラン開始
  const runId = startRun(db);

  try {

  // 2. harvest
  let items: HarvestItem[] = [];
  if (opts.keywords && opts.keywords.length > 0) {
    logStep('harvest', '--keywords 指定のため harvest と抽出をスキップします');
  } else {
    items = await harvestAll(db, runId, now, notes, unavailable);
  }

  // 3. 抽出 → 追跡キーワードと合流
  let extracted: ExtractedKeyword[] = [];
  if (items.length > 0) {
    extracted = await extractKeywords(items, { skipLlm: opts.skipLlm });
    logStep('extract', `候補 ${extracted.length} 語（method: ${env.LLM_PROVIDER === 'none' || opts.skipLlm ? 'ngram' : `ngram+${env.LLM_PROVIDER}`}）`);
  }

  const targets: Target[] =
    opts.keywords && opts.keywords.length > 0
      ? opts.keywords.map((k) => ({ keyword: k.trim().toLowerCase(), slug: slugify(k), extracted: null })).filter((t) => t.slug)
      : buildTargets(db, extracted, maxKeywords, maxNew);

  logStep('measure', `${targets.length} 語を計測します`);

  // Qiita は未認証 60 req/h。日本語訳での再検索を足すと 1 語 4 回になるので、
  // 語数から総数を見積もって「入る窓」だけをこのランの方針として固定する。
  const qiitaPlan = planQiitaWindows(targets.length, qiitaBudget());
  const qiitaWindowLabels = [
    'en 30d',
    ...(qiitaPlan.jaRecent ? ['ja 30d'] : []),
    ...(qiitaPlan.enPrev ? ['en prev30d'] : []),
    ...(qiitaPlan.jaPrev ? ['ja prev30d'] : []),
  ];
  logStep('measure', `qiita 予算 ${qiitaBudget()} req/h・${targets.length} 語 → 取る窓: ${qiitaWindowLabels.join(' / ')}`);

  // 価格表は 24h キャッシュ。ドメイン生成の価格スコアにも使うので先に取る。
  let comRenewal: number | null = null;
  let comRegistration: number | null = null;
  try {
    const prices = await getPricing(['com'], { db });
    comRenewal = prices[0]?.renewal ?? null;
    comRegistration = prices[0]?.registration ?? null;
    logStep('price', comRegistration === null ? '.com 価格を取得できませんでした（Price unavailable）' : `.com 登録 $${comRegistration} / 更新 $${comRenewal}`);
  } catch (err) {
    const note = `porkbun: 価格表の取得に失敗（${errName(err)}）。価格は Price unavailable として続行`;
    notes.push(note);
    appendRunNote(db, runId, note);
  }

  let keywordsSaved = 0;
  let noiseDropped = 0;
  let domainsGenerated = 0;
  let domainsChecked = 0;
  let trendSourceSuccesses = 0;
  const trendSourcesQueried = new Set<SourceId>();
  const runDomainReports = new Map<string, Awaited<ReturnType<typeof searchDomains>>[number]>();

  for (const target of targets) {
    const existing = getKeywordBySlug(db, target.slug);
    const keywordId = upsertKeyword(db, {
      slug: target.slug,
      keyword: target.keyword,
      description: target.extracted?.description ?? null,
      why_emerging: target.extracted?.whyEmerging ?? null,
      first_seen_context: target.extracted?.firstSeenContext ?? null,
      related_terms: target.extracted?.relatedTerms ?? [],
      extraction_method: target.extracted?.extractionMethod ?? existing?.extraction_method ?? 'tracked',
      llm_confidence: target.extracted?.llmConfidence ?? null,
      llm_basis: target.extracted?.llmBasis ?? null,
      first_seen_at: existing?.first_seen_at ?? target.extracted?.oldestCreatedAt ?? null,
      run_id: runId,
    });

    // 4. 各ソースで measure
    const measurements: SourceMeasurement[] = [];
    const oldestDates: (string | null | undefined)[] = [existing?.first_seen_at, target.extracted?.oldestCreatedAt];
    for (const source of TREND_SOURCES) {
      if (!source.enabled(env) || unavailable.has(source.id)) continue;
      // S_TOTAL は成功数ではなく、enabled で実際に照会を試みたソース数。
      trendSourcesQueried.add(source.id);
      try {
        const result = await source.measure(target.keyword, now);
        trendSourceSuccesses += 1;
        measurements.push({ source: source.id, counts: result.counts });
        oldestDates.push(result.oldestSeenAt);
        saveMetrics(
          db,
          WINDOW_IDS.map((w) => ({
            run_id: runId,
            keyword_id: keywordId,
            source: source.id,
            window: w,
            count: result.counts[w] ?? 0,
            approximate: result.approximate,
            query_url: result.queryUrl,
            fetched_at: nowIso(),
          })),
        );
      } catch (err) {
        if (err instanceof SourceUnavailableError || err instanceof SourceRateLimitError) {
          const sourceId = err instanceof SourceUnavailableError ? err.sourceId : source.id;
          unavailable.add(sourceId);
          const note = `${sourceId}: unavailable・以降スキップ（${err.message}）`;
          notes.push(note);
          appendRunNote(db, runId, note);
          logStep('measure', note);
        } else {
          const note = `${source.id}: ${target.keyword} の計測に失敗（${errName(err)}）`;
          notes.push(note);
          appendRunNote(db, runId, note);
        }
      }
    }

    // Novelty 用に HN の 60 日より前を調べ、1000 件以内なら最終ページも見る。
    let hnNoveltyApproximate = false;
    try {
      const hnOldest = await hnOldestBefore(target.keyword, now);
      oldestDates.push(hnOldest.oldestSeenAt);
      hnNoveltyApproximate = hnOldest.approximate;
    } catch {
      // 失敗しても Novelty は他の材料で計算する
    }

    // 5. 日本語圏
    let qiita30 = 0;
    let qiita30prev = 0;
    let wikiJa = false;
    let pv30 = 0;
    // 日本語圏の計測が 1 つも成功しなかったときは Japan Gap を null にする。
    // 取得失敗を「日本語の言及ゼロ」と同じ扱いにすると gap が過大に出るため。
    let japanMeasured = false;

    // 日本語での呼び方を先に引く（1 リクエスト）。
    // 取れれば Qiita と ja.wikipedia を日本語でも測る。取れなければ英語のまま測る。
    const ja = await fetchJaEquivalent(target.keyword);
    const jaEquivalent = ja.title;
    if (!ja.ok) {
      const note = `langlinks: ${target.keyword} の日本語訳を取得できませんでした（英語フレーズのみで計測）`;
      notes.push(note);
      appendRunNote(db, runId, note);
    }

    if (!unavailable.has('qiita')) {
      try {
        const q = await measureQiita(target.keyword, now, { jaKeyword: jaEquivalent, plan: qiitaPlan });
        if (q) {
          qiita30 = q.c30;
          qiita30prev = q.c30prev;
          japanMeasured = true;
          if (q.failedWindows.length > 0) {
            const note = `qiita: ${target.keyword} は ${q.failedWindows.join(' / ')} を取得できませんでした`;
            notes.push(note);
            appendRunNote(db, runId, note);
          }
          saveMetrics(db, [
            { run_id: runId, keyword_id: keywordId, source: 'qiita', window: '30d', count: q.c30, approximate: false, query_url: q.queryUrl, fetched_at: nowIso() },
            { run_id: runId, keyword_id: keywordId, source: 'qiita', window: 'prev30d', count: q.c30prev, approximate: false, query_url: q.queryUrl, fetched_at: nowIso() },
          ]);
        } else {
          const note = `qiita: ${target.keyword} は Total-Count 欠落のため unavailable`;
          notes.push(note);
          appendRunNote(db, runId, note);
        }
      } catch (err) {
        if (err instanceof SourceRateLimitError) unavailable.add('qiita');
        const note = `qiita: ${err instanceof SourceRateLimitError ? 'unavailable・以降スキップ' : `${target.keyword} の計測に失敗`}（${errName(err)}）`;
        notes.push(note);
        appendRunNote(db, runId, note);
      }
    }
    try {
      const wiki = await measureWikipedia(target.keyword, now, { jaTitle: jaEquivalent });
      wikiJa = wiki.wikiJa;
      pv30 = wiki.pv30;
      japanMeasured = japanMeasured || wiki.ok;
      if (wiki.ok) {
        saveMetrics(db, [
          { run_id: runId, keyword_id: keywordId, source: 'wikipv', window: '30d', count: wiki.pv30, approximate: false, query_url: wiki.queryUrl, fetched_at: nowIso() },
        ]);
      } else {
        const note = `wikipedia: ${target.keyword} は unavailable`;
        notes.push(note);
        appendRunNote(db, runId, note);
      }
    } catch (err) {
      const note = `wikipedia: ${target.keyword} の計測に失敗（${errName(err)}）`;
      notes.push(note);
      appendRunNote(db, runId, note);
    }

    // 6. スコア
    const agg = aggregate(measurements, trendSourcesQueried.size);
    const trend = trendBreakdown({ c7: agg.c7, c7prev: agg.c7prev, c30: agg.c30, c30prev: agg.c30prev, S: agg.S, S_TOTAL: agg.S_TOTAL });
    const statusResult = classifyStatus(agg.c30, agg.c30prev, agg.S);

    if (statusResult.status === 'Noise') {
      noiseDropped += 1;
      logStep('score', `${target.keyword}: Noise（どのソースにも出ない）→ 保存しない`);
      continue;
    }

    const novelty = hnNoveltyApproximate
      ? { score: NOVELTY_FLOOR, firstSeenAt: null, ageDays: null }
      : noveltyScore(oldestDates, now);
    const japanGap = japanMeasured
      ? japanGapBreakdown({ qiita30, qiita30prev, wikiJa, pv30, enUnits: agg.c30, jaEquivalent })
      : { jpUnits: 0, enUnits: agg.c30, qiitaUnits: 0, wikiUnits: 0, capped: false, score: null, jaEquivalent };

    saveScore(db, {
      run_id: runId,
      keyword_id: keywordId,
      trend_score: trend.trendScore,
      novelty_score: novelty.score,
      japan_gap_score: japanGap.score,
      status: statusResult.status,
      fading: statusResult.fading,
      breadth: agg.S,
      c30_units: agg.c30,
      g7: g7Of(agg.c7, agg.c7prev),
      g30: statusResult.g30,
      breakdown: {
        trend,
        japanGap,
        novelty: { ...novelty, approximate: hnNoveltyApproximate },
        aggregate: { ...agg, unitsBySource: agg.unitsBySource, rawBySource: agg.rawBySource },
      },
    });
    keywordsSaved += 1;

    // 7. ドメイン生成
    const allCandidates = generateDomainCandidates(target.keyword, { renewalPrice: comRenewal });
    const candidates = generateDomains(target.keyword, { renewalPrice: comRenewal });
    const selectedDomains = new Set(candidates.map((candidate) => candidate.domain));
    const candidatesToSave = allCandidates.filter(
      (candidate) => candidate.excluded || selectedDomains.has(candidate.domain),
    );
    domainsGenerated += candidates.length;
    if (candidatesToSave.length > 0) {
      upsertDomains(
        db,
        candidatesToSave.map((c) => ({
          keyword_id: keywordId,
          domain: c.domain,
          generation_rule: c.rule,
          domain_score: c.domainScore,
          trademark_flag: c.trademarkFlag,
          excluded: c.excluded,
          exclusion_reason: c.excludeReason,
          run_id: runId,
        })),
      );
    }

    // 8. 空き判定 + 価格 → domain_checks
    let reports: Awaited<ReturnType<typeof searchDomains>> = [];
    if (candidates.length > 0) {
      try {
        const missing = candidates.filter((candidate) => !runDomainReports.has(candidate.domain));
        if (missing.length > 0) {
          const checked = await searchDomains(missing.map((candidate) => candidate.domain).join('\n'), {
            db,
            runId,
            maxDomains: missing.length,
          });
          for (const report of checked) runDomainReports.set(report.domain, report);
          domainsChecked += checked.length;
        }
        reports = candidates
          .map((candidate) => runDomainReports.get(candidate.domain))
          .filter((report): report is NonNullable<typeof report> => report !== undefined);
      } catch (err) {
        const note = `domain: ${target.keyword} の空き判定に失敗（${errName(err)}）`;
        notes.push(note);
        appendRunNote(db, runId, note);
      }
    }

    // 9. Opportunity（空きドメインごと。キーワードの値は最大値）
    const rows = [];
    const byDomain = new Map(reports.map((r) => [r.domain, r]));
    for (const c of candidates) {
      const report = byDomain.get(c.domain);
      if (report?.availability !== 'available') continue;
      const domainRow = getDomainRow(db, keywordId, c.domain);
      const breakdown = opportunityBreakdown({
        trendScore: trend.trendScore,
        domainScore: c.domainScore,
        japanGapScore: japanGap.score,
        noveltyScore: novelty.score,
        status: statusResult.status,
        fading: statusResult.fading,
        trademarkFlagged: Boolean(c.trademarkFlag),
        premium: report.premium,
        registrationPrice: report.registrationPrice,
      });
      rows.push({ run_id: runId, keyword_id: keywordId, domain_id: domainRow?.id ?? null, score: breakdown.score, breakdown });
    }
    if (rows.length === 0) {
      const breakdown = opportunityBreakdown({
        trendScore: trend.trendScore,
        domainScore: null,
        japanGapScore: japanGap.score,
        noveltyScore: novelty.score,
        status: statusResult.status,
        fading: statusResult.fading,
        trademarkFlagged: false,
        premium: null,
        registrationPrice: null,
      });
      rows.push({ run_id: runId, keyword_id: keywordId, domain_id: null, score: breakdown.score, breakdown });
    }
    saveOpportunities(db, rows);

    const best = Math.max(...rows.map((r) => r.score));
    logStep('score', `${target.keyword}: Trend ${trend.trendScore} / ${statusResult.status}${statusResult.fading ? '(fading)' : ''} / Opportunity ${best} / domains ${candidates.length}`);
  }

  // F17: 候補に現れなかった Watchlist ドメインも毎ラン追跡する。RDAP 枠を使い切った
  // 場合も searchDomains が availability=unknown を返すので、価格履歴の日次点は欠けない。
  const uncheckedWatchlist = listWatchlist(db).filter((row) => !runDomainReports.has(row.domain));
  if (uncheckedWatchlist.length > 0) {
    try {
      const checked = await searchDomains(uncheckedWatchlist.map((row) => row.domain).join('\n'), {
        db,
        runId,
        maxDomains: uncheckedWatchlist.length,
      });
      for (const report of checked) runDomainReports.set(report.domain, report);
      domainsChecked += checked.length;
      logStep('watchlist', `${checked.length} 件の価格履歴を追加しました`);
    } catch (err) {
      const note = `watchlist: 履歴の更新に失敗（${errName(err)}）`;
      notes.push(note);
      appendRunNote(db, runId, note);
    }
  }

  // 為替（参考値・24h キャッシュ）
  try {
    const fx = await getUsdJpyCached(db);
    if (fx.rate !== null) {
      logStep('fx', `USD→JPY ${fx.rate}（${fx.source}・${fx.asOf ?? 'n/a'}・参考値）`);
    } else {
      notes.push('fx: レートを取得できなかったため USD のみ表示');
    }
  } catch (err) {
    notes.push(`fx: 取得に失敗（${errName(err)}）`);
  }

  // 10. 終了記録・要約・通知条件
  const allSourcesFailed = trendSourceSuccesses === 0 && targets.length > 0;
  const status: CollectResult['status'] = allSourcesFailed ? 'failed' : notes.length > 0 ? 'partial' : 'completed';
  const stats: CollectStats = {
    durationMs: Date.now() - t0,
    harvested: countRawItemsBySource(db, runId),
    candidates: extracted.length,
    keywordsMeasured: targets.length,
    keywordsSaved,
    noiseDropped,
    domainsGenerated,
    domainsChecked,
    sourcesUnavailable: [...unavailable],
    http: getHttpStats(),
  };
  finishRun(db, runId, status, stats);

  const alerts = listAlertCandidates(db, runId);
  logStep('done', `status=${status} keywords=${keywordsSaved}/${targets.length} domains=${domainsChecked} 外部呼び出し=${sumCalls(stats.http)} 所要=${(stats.durationMs / 1000).toFixed(1)}s`);
  if (stats.http.openalexCostUsd > 0) {
    logStep('done', `OpenAlex 課金合計 $${stats.http.openalexCostUsd.toFixed(4)}（残 ${stats.http.openalexRemainingUsd ?? 'n/a'}）`);
  }
  logStep('alert', `通知条件（Trend>=80 かつ Opportunity>=80 かつ available かつ 登録<=$20 かつ 非 premium）を満たす候補: ${alerts.length} 件`);
  for (const a of alerts) {
    logStep('alert', `  ${a.domain} — ${a.keyword} / Trend ${a.trendScore} / Opportunity ${a.opportunityScore} / $${a.registrationPrice ?? 'n/a'}`);
  }
  if (notes.length > 0) logStep('notes', `${notes.length} 件のメモを runs.notes に記録しました`);

  return { runId, status, stats, alerts, notes };
  } catch (err) {
    const summary = `run failed: ${errName(err)}`;
    try {
      finishRun(db, runId, 'failed', {
        durationMs: Date.now() - t0,
        http: getHttpStats(),
      }, summary);
    } catch {
      // 元の例外を優先する。DB 自体が壊れている場合は更新を保証できない。
    }
    throw err;
  }
}

export function sumCalls(http: HttpStats): number {
  return Object.values(http.callsByHost).reduce((a, b) => a + b, 0);
}

function emptyStats(durationMs: number): CollectStats {
  return {
    durationMs,
    harvested: {},
    candidates: 0,
    keywordsMeasured: 0,
    keywordsSaved: 0,
    noiseDropped: 0,
    domainsGenerated: 0,
    domainsChecked: 0,
    sourcesUnavailable: [],
    http: getHttpStats(),
  };
}

function errName(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message.slice(0, 120)}` : 'unknown';
}
