/**
 * パイプラインの 10 ステップ（architecture §11）をオフラインで通す。
 * 外部呼び出しは fixtures だけ。キーは 1 つも使わない。
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { OFFLINE_REFERENCE_NOW } from '../../src/lib/env';
import { closeDb, getDb, type Db } from '../../src/lib/db/client';
import { CollectAlreadyRunningError, estimateCalls, runCollect, type CollectResult } from '../../src/pipeline/collect';
import { getKeywordDetail, listKeywordCards } from '../../src/lib/db/queries';
import { addToWatchlist, getWatchlistHistory } from '../../src/lib/db/repos/watchlist';
import { openalexSource, openAlexUnavailableReason } from '../../src/lib/trend/sources/openalex';

describe('estimateCalls（--dry-run）', () => {
  it('キーワード数から外部呼び出しを見積もる', () => {
    const est = estimateCalls(3);
    expect(est.keywords).toBe(3);
    expect(est.total).toBeGreaterThan(0);
    expect(est.calls['github measure']).toBe(12);
    expect(est.calls['openalex measure']).toBe(12);
    expect(est.calls['porkbun pricing']).toBe(1);
  });
});

describe('runCollect（オフライン）', () => {
  let dir: string;
  let dbPath: string;
  let result: CollectResult;
  let db: Db;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'edr-pipeline-'));
    dbPath = path.join(dir, 'test.db');
    result = await runCollect({ dbPath, maxKeywords: 2, now: OFFLINE_REFERENCE_NOW });
    db = getDb(dbPath);
  }, 60_000);

  afterAll(() => {
    closeDb(dbPath);
    rmSync(dir, { recursive: true, force: true });
  });

  it('キー 0 個で完走する', () => {
    expect(result.status).toBe('completed');
    expect(result.notes).toEqual([]);
  });

  it('1. runs に開始と終了が記録される', () => {
    const run = db.prepare(`SELECT * FROM runs WHERE id = ?`).get(result.runId) as {
      status: string;
      started_at: string;
      finished_at: string;
      stats_json: string;
    };
    expect(run.status).toBe('completed');
    expect(run.started_at).toBeTruthy();
    expect(run.finished_at).toBeTruthy();
    expect(JSON.parse(run.stats_json).keywordsSaved).toBe(2);
  });

  it('2. harvest が raw_items に入る（3 ソース）', () => {
    expect(Object.keys(result.stats.harvested).sort()).toEqual(['arxiv', 'github', 'hn']);
    const n = (db.prepare(`SELECT COUNT(*) AS n FROM raw_items`).get() as { n: number }).n;
    expect(n).toBeGreaterThan(30);
  });

  it('3. 抽出で候補が出る', () => {
    expect(result.stats.candidates).toBeGreaterThan(0);
  });

  it('4. keyword_metrics に 4 ソース × 4 窓が入る', () => {
    const rows = db.prepare(`SELECT source, window FROM keyword_metrics WHERE keyword_id = 1`).all() as {
      source: string;
      window: string;
    }[];
    const trendSources = rows.filter((r) => ['hn', 'github', 'arxiv', 'openalex'].includes(r.source));
    expect(trendSources).toHaveLength(16);
  });

  it('5. 日本語圏（qiita・wikipv）も記録される', () => {
    const sources = (db.prepare(`SELECT DISTINCT source FROM keyword_metrics`).all() as { source: string }[]).map((r) => r.source);
    expect(sources).toContain('qiita');
    expect(sources).toContain('wikipv');
  });

  it('6. keyword_scores に Trend / Status / Novelty / Japan Gap が入る', () => {
    const rows = db.prepare(`SELECT * FROM keyword_scores`).all() as {
      trend_score: number;
      novelty_score: number;
      japan_gap_score: number | null;
      status: string;
      breadth: number;
      breakdown_json: string;
    }[];
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r.trend_score).toBeGreaterThanOrEqual(0);
      expect(r.trend_score).toBeLessThanOrEqual(100);
      expect(['Early', 'Emerging', 'Rising', 'Trending', 'Mainstream']).toContain(r.status);
      expect(r.breadth).toBe(4);
      const breakdown = JSON.parse(r.breakdown_json);
      expect(Object.keys(breakdown).sort()).toEqual(['aggregate', 'japanGap', 'novelty', 'trend']);
    }
  });

  it('Noise（S=0）は保存しない', () => {
    const count = (db.prepare(`SELECT COUNT(*) AS n FROM keyword_scores WHERE breadth = 0`).get() as { n: number }).n;
    expect(count).toBe(0);
  });

  it('7. domains が生成される（最大 10 件・.com のみ）', () => {
    const rows = db.prepare(`SELECT domain, generation_rule, domain_score FROM domains`).all() as {
      domain: string;
      generation_rule: string;
      domain_score: number;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.domain.endsWith('.com')).toBe(true);
      expect(r.generation_rule).toBeTruthy();
      expect(r.domain_score).toBeGreaterThan(0);
    }
    const perKeyword = db.prepare(`SELECT keyword_id, COUNT(*) AS n FROM domains GROUP BY keyword_id`).all() as { n: number }[];
    for (const p of perKeyword) expect(p.n).toBeLessThanOrEqual(10);
  });

  it('8. domain_checks に空き判定と価格が入る', () => {
    const rows = db.prepare(`SELECT * FROM domain_checks`).all() as {
      availability: string;
      availability_source: string;
      registration_price: number | null;
      premium: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(['available', 'taken', 'unknown']).toContain(r.availability);
      expect(['dns', 'rdap', 'budget']).toContain(r.availability_source);
      expect(r.premium).toBe('standard_inferred');
    }
    // 価格表も 24h キャッシュとして保存される
    const com = db.prepare(`SELECT * FROM tld_prices WHERE tld='com'`).get() as { registration: number };
    expect(com.registration).toBe(11.08);
  });

  it('9. opportunity がキーワードごとに 1 件以上入る', () => {
    const rows = db.prepare(`SELECT keyword_id, score, breakdown_json FROM opportunity`).all() as {
      keyword_id: number;
      score: number;
      breakdown_json: string;
    }[];
    expect(rows.length).toBeGreaterThan(0);
    const keywordIds = new Set(rows.map((r) => r.keyword_id));
    expect(keywordIds.size).toBe(2);
    for (const r of rows) {
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(100);
      expect(JSON.parse(r.breakdown_json)).toHaveProperty('trend');
    }
  });

  it('10. 為替を保存し、通知条件の一覧を返す', () => {
    const fx = db.prepare(`SELECT * FROM fx_rates`).get() as { rate: number; source: string };
    expect(fx.rate).toBe(159.85);
    expect(fx.source).toContain('Frankfurter');
    expect(Array.isArray(result.alerts)).toBe(true);
  });

  it('統計に OpenAlex の課金額と外部呼び出し件数が入る', () => {
    expect(result.stats.http.openalexCostUsd).toBeGreaterThan(0);
    expect(Object.keys(result.stats.http.callsByHost).length).toBeGreaterThan(3);
    expect(result.stats.http.offlineHits).toBeGreaterThan(0);
  });

  it('ダッシュボードの読み出しが成立する', () => {
    const cards = listKeywordCards(db, result.runId);
    expect(cards).toHaveLength(2);
    expect(cards[0].rank).toBe(1);
    expect(cards[0].topDomains.length).toBeGreaterThan(0);
  });

  it('2 回目のランでも新規発見の枠が残る（追跡が全枠を埋めない）', async () => {
    const dir5 = mkdtempSync(path.join(tmpdir(), 'edr-two-'));
    const p5 = path.join(dir5, 'two.db');
    // 合計 4 語・新規は最大 2 語 → 追跡 2 枠 ＋ 新規 2 枠
    const first = await runCollect({ dbPath: p5, maxKeywords: 4, maxNewKeywords: 2, now: OFFLINE_REFERENCE_NOW });
    const db5 = getDb(p5);
    const countKeywords = (): number => (db5.prepare(`SELECT COUNT(*) AS n FROM keywords`).get() as { n: number }).n;
    expect(countKeywords()).toBe(2);

    // 追跡が 2 語ある状態でもう一度回すと、新規枠の 2 語が足されて 4 語になる
    const second = await runCollect({ dbPath: p5, maxKeywords: 4, maxNewKeywords: 2, now: OFFLINE_REFERENCE_NOW });
    expect(second.runId).not.toBe(first.runId);
    expect(countKeywords()).toBe(4);
    const measured = db5.prepare(`SELECT COUNT(*) AS n FROM keyword_scores WHERE run_id = ?`).get(second.runId) as { n: number };
    expect(measured.n).toBe(4);

    // maxNewKeywords=0 なら追跡だけを回す（語は増えない）
    const third = await runCollect({ dbPath: p5, maxKeywords: 4, maxNewKeywords: 0, now: OFFLINE_REFERENCE_NOW });
    expect(countKeywords()).toBe(4);
    const trackedOnly = db5.prepare(`SELECT COUNT(*) AS n FROM keyword_scores WHERE run_id = ?`).get(third.runId) as { n: number };
    expect(trackedOnly.n).toBe(4);

    closeDb(p5);
    rmSync(dir5, { recursive: true, force: true });
  }, 60_000);

  it('--dry-run はランも DB 行も作らない（最新の完了ランを汚さない）', async () => {
    const dir3 = mkdtempSync(path.join(tmpdir(), 'edr-dry-'));
    const p3 = path.join(dir3, 'dry.db');
    const r3 = await runCollect({ dbPath: p3, dryRun: true, maxKeywords: 3, now: OFFLINE_REFERENCE_NOW });
    const db3 = getDb(p3);
    expect(r3.runId).toBe(0);
    expect(r3.notes).toEqual(['dry-run']);
    expect((db3.prepare(`SELECT COUNT(*) AS n FROM runs`).get() as { n: number }).n).toBe(0);
    expect((db3.prepare(`SELECT COUNT(*) AS n FROM keywords`).get() as { n: number }).n).toBe(0);
    closeDb(p3);
    rmSync(dir3, { recursive: true, force: true });
  });

  it('ソース単位の失敗は notes に残して他ソースで続行する', async () => {
    const dir4 = mkdtempSync(path.join(tmpdir(), 'edr-fail-'));
    const p4 = path.join(dir4, 'fail.db');
    // fixture で hn だけ 500 を返す語
    const r4 = await runCollect({ dbPath: p4, keywords: ['__fail__'], now: OFFLINE_REFERENCE_NOW });
    const db4 = getDb(p4);
    expect(r4.status).toBe('partial');
    expect(r4.notes.join()).toContain('hn');
    // hn 以外の 3 ソースは計測できている
    const sources = (db4.prepare(`SELECT DISTINCT source FROM keyword_metrics`).all() as { source: string }[]).map((r) => r.source);
    expect(sources).not.toContain('hn');
    expect(sources).toContain('github');
    expect(sources).toContain('openalex');
    // Breadth の分子は成功してヒットした 3 ソース、分母は失敗した HN も含む試行 4 ソース。
    const score = db4.prepare(`SELECT breadth, breakdown_json FROM keyword_scores`).get() as { breadth: number; breakdown_json: string };
    expect(score.breadth).toBe(3);
    expect(JSON.parse(score.breakdown_json).aggregate.S_TOTAL).toBe(4);
    const notes = (db4.prepare(`SELECT notes FROM runs`).get() as { notes: string | null }).notes ?? '';
    expect(notes).toContain('hn');
    closeDb(p4);
    rmSync(dir4, { recursive: true, force: true });
  }, 60_000);

  it('Qiita と Wikipedia が unavailable なら Japan Gap は null で Qiita metrics を残さない', async () => {
    const dir6 = mkdtempSync(path.join(tmpdir(), 'edr-japan-unavailable-'));
    const p6 = path.join(dir6, 'japan.db');
    const r6 = await runCollect({ dbPath: p6, keywords: ['__japan_unavailable__'], now: OFFLINE_REFERENCE_NOW });
    const db6 = getDb(p6);
    const score = db6.prepare(`SELECT japan_gap_score FROM keyword_scores`).get() as { japan_gap_score: number | null };
    expect(score.japan_gap_score).toBeNull();
    expect(db6.prepare(`SELECT COUNT(*) AS n FROM keyword_metrics WHERE source = 'qiita'`).get()).toEqual({ n: 0 });
    expect(db6.prepare(`SELECT COUNT(*) AS n FROM keyword_metrics WHERE source = 'wikipv'`).get()).toEqual({ n: 0 });
    expect(r6.status).toBe('partial');
    closeDb(p6);
    rmSync(dir6, { recursive: true, force: true });
  }, 60_000);

  it('商標除外候補を理由付きで保存し、既定一覧と Opportunity から除く', async () => {
    const dir7 = mkdtempSync(path.join(tmpdir(), 'edr-trademark-'));
    const p7 = path.join(dir7, 'trademark.db');
    const r7 = await runCollect({ dbPath: p7, keywords: ['google gemini agents'], now: OFFLINE_REFERENCE_NOW });
    const db7 = getDb(p7);
    const excluded = db7
      .prepare(`SELECT domain, exclusion_reason FROM domains WHERE excluded = 1`)
      .all() as { domain: string; exclusion_reason: string }[];
    expect(excluded.length).toBeGreaterThan(0);
    expect(excluded.every((row) => row.exclusion_reason.startsWith('brand:'))).toBe(true);
    const detail = getKeywordDetail(db7, 'google-gemini-agents', r7.runId);
    expect(detail?.domains).toEqual([]);
    expect(detail?.excludedDomains.length).toBe(excluded.length);
    const pageSource = readFileSync(path.join(process.cwd(), 'src/app/keywords/[slug]/page.tsx'), 'utf8');
    expect(pageSource).toContain('const excludedDomains = detail.excludedDomains;');
    expect(pageSource).not.toContain("from '@/lib/domain/generator'");
    expect(db7.prepare(`SELECT COUNT(*) AS n FROM opportunity WHERE domain_id IS NOT NULL`).get()).toEqual({ n: 0 });
    closeDb(p7);
    rmSync(dir7, { recursive: true, force: true });
  }, 60_000);

  it('日本語訳が取れた語は Qiita を合算し、jaEquivalent を内訳と詳細に残す', async () => {
    const dir8 = mkdtempSync(path.join(tmpdir(), 'edr-ja-equiv-'));
    const p8 = path.join(dir8, 'ja.db');
    // fixture: en.wikipedia langlinks が 'vibe coding' → 'バイブコーディング' を返す
    const r8 = await runCollect({ dbPath: p8, keywords: ['vibe coding'], now: OFFLINE_REFERENCE_NOW });
    const db8 = getDb(p8);
    expect(r8.status).toBe('completed');

    const score = db8.prepare(`SELECT japan_gap_score, breakdown_json FROM keyword_scores`).get() as {
      japan_gap_score: number | null;
      breakdown_json: string;
    };
    const japanGap = JSON.parse(score.breakdown_json).japanGap as { jaEquivalent: string | null };
    expect(japanGap.jaEquivalent).toBe('バイブコーディング');

    // 英語 12 件 + 日本語 12 件 = 24 件（英語だけだと 12 件で Japan Gap が過大に出る）
    const qiita = db8
      .prepare(`SELECT window, count FROM keyword_metrics WHERE source = 'qiita' ORDER BY window`)
      .all() as { window: string; count: number }[];
    expect(qiita.find((r) => r.window === '30d')?.count).toBe(24);
    expect(qiita.find((r) => r.window === 'prev30d')?.count).toBe(8);

    // 日本語タイトルで存在判定できるので wikiJa=true → 上限 40
    expect(score.japan_gap_score).not.toBeNull();
    expect(score.japan_gap_score as number).toBeLessThanOrEqual(40);

    // 画面が「JP equivalent」を出せるように queries から読める
    const slug = (db8.prepare(`SELECT slug FROM keywords`).get() as { slug: string }).slug;
    expect(getKeywordDetail(db8, slug, r8.runId)?.jaEquivalent).toBe('バイブコーディング');

    closeDb(p8);
    rmSync(dir8, { recursive: true, force: true });
  }, 60_000);

  it('日本語訳が取れない語は jaEquivalent が null（英語フレーズだけで計測・失敗ではない）', async () => {
    const dir9 = mkdtempSync(path.join(tmpdir(), 'edr-ja-unknown-'));
    const p9 = path.join(dir9, 'ja-unknown.db');
    const r9 = await runCollect({ dbPath: p9, keywords: ['agent mesh'], now: OFFLINE_REFERENCE_NOW });
    const db9 = getDb(p9);
    // langlinks が「記事なし」を返しただけなので notes には出さない
    expect(r9.status).toBe('completed');
    expect(r9.notes).toEqual([]);
    const score = db9.prepare(`SELECT breakdown_json FROM keyword_scores`).get() as { breakdown_json: string };
    expect((JSON.parse(score.breakdown_json).japanGap as { jaEquivalent: string | null }).jaEquivalent).toBeNull();
    const slug = (db9.prepare(`SELECT slug FROM keywords`).get() as { slug: string }).slug;
    expect(getKeywordDetail(db9, slug, r9.runId)?.jaEquivalent).toBeNull();
    closeDb(p9);
    rmSync(dir9, { recursive: true, force: true });
  }, 60_000);

  it('--keywords 指定なら harvest と抽出をスキップする', async () => {
    const dir2 = mkdtempSync(path.join(tmpdir(), 'edr-pipeline2-'));
    const p2 = path.join(dir2, 'kw.db');
    const r2 = await runCollect({ dbPath: p2, keywords: ['agent mesh'], now: OFFLINE_REFERENCE_NOW });
    const db2 = getDb(p2);
    expect(r2.status).toBe('completed');
    expect(r2.stats.harvested).toEqual({});
    expect((db2.prepare(`SELECT COUNT(*) AS n FROM keywords`).get() as { n: number }).n).toBe(1);
    closeDb(p2);
    rmSync(dir2, { recursive: true, force: true });
  }, 60_000);

  it('HN が 1000 件超で最古に届かないときは初出日 null・概算のまま Novelty 10', async () => {
    const dir10 = mkdtempSync(path.join(tmpdir(), 'edr-hn-many-'));
    const p10 = path.join(dir10, 'hn-many.db');
    const r10 = await runCollect({ dbPath: p10, keywords: ['__hn_many__'], now: OFFLINE_REFERENCE_NOW });
    const db10 = getDb(p10);
    const row = db10.prepare(`SELECT novelty_score, breakdown_json FROM keyword_scores`).get() as { novelty_score: number; breakdown_json: string };
    const novelty = JSON.parse(row.breakdown_json).novelty;
    expect(row.novelty_score).toBe(10);
    expect(novelty).toMatchObject({ score: 10, firstSeenAt: null, ageDays: null, approximate: true });
    expect(r10.status).toBe('completed');
    closeDb(p10);
    rmSync(dir10, { recursive: true, force: true });
  }, 60_000);

  it('ラン開始時に前ランの OpenAlex unavailable 状態をリセットする', async () => {
    await expect(openalexSource.measure('__openalex_limit__', OFFLINE_REFERENCE_NOW)).rejects.toThrow();
    expect(openAlexUnavailableReason()).not.toBeNull();

    const dir11 = mkdtempSync(path.join(tmpdir(), 'edr-openalex-reset-'));
    const p11 = path.join(dir11, 'reset.db');
    const result11 = await runCollect({ dbPath: p11, keywords: ['agent mesh'], now: OFFLINE_REFERENCE_NOW });
    const db11 = getDb(p11);
    expect(db11.prepare(`SELECT COUNT(*) AS n FROM keyword_metrics WHERE source = 'openalex'`).get()).toEqual({ n: 4 });
    expect(result11.status).toBe('completed');
    closeDb(p11);
    rmSync(dir11, { recursive: true, force: true });
  }, 60_000);

  it('候補外を含む seed Watchlist 2 件に当日の価格履歴を 1 行ずつ追加する', async () => {
    const dir12 = mkdtempSync(path.join(tmpdir(), 'edr-watchlist-history-'));
    const p12 = path.join(dir12, 'watchlist.db');
    const db12 = getDb(p12);
    const demo = JSON.parse(readFileSync(path.join(process.cwd(), 'fixtures/demo-run.json'), 'utf8')) as {
      watchlist: { keyword: string; domain: string; foundRegistrationPrice: number | null; foundRenewalPrice: number | null; currency: string | null }[];
    };
    const ids = demo.watchlist.map((entry) => addToWatchlist(db12, {
      keyword: entry.keyword,
      domain: entry.domain,
      found_registration_price: entry.foundRegistrationPrice,
      found_renewal_price: entry.foundRenewalPrice,
      found_currency: entry.currency,
      trend_score: null,
      opportunity_score: null,
    }));
    expect(ids).toHaveLength(2);
    expect(ids.map((id) => getWatchlistHistory(db12, id).length)).toEqual([0, 0]);

    process.env.RADAR_RDAP_DAILY_BUDGET = '0';
    try {
      // agent mesh の候補には seed Watchlist 2 件がどちらも含まれない。さらに RDAP 枠 0
      // でも、候補外ドメインを unknown として履歴に残す。
      await runCollect({ dbPath: p12, keywords: ['agent mesh'], now: OFFLINE_REFERENCE_NOW });
    } finally {
      delete process.env.RADAR_RDAP_DAILY_BUDGET;
    }
    expect(ids.map((id) => getWatchlistHistory(db12, id).length)).toEqual([1, 1]);
    for (const id of ids) {
      expect(getWatchlistHistory(db12, id)[0]).toMatchObject({
        registration_price: 11.08,
        renewal_price: 11.08,
        availability: 'unknown',
        premium: 'standard_inferred',
      });
    }
    closeDb(p12);
    rmSync(dir12, { recursive: true, force: true });
  }, 60_000);

  it('生きている PID の collect.lock があれば即終了し、stale lock は置き換える', async () => {
    const lockDir = mkdtempSync(path.join(tmpdir(), 'edr-lock-'));
    const lockDb = path.join(lockDir, 'lock.db');
    const lockPath = path.join(lockDir, 'collect.lock');
    writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    await expect(runCollect({ dbPath: lockDb, dryRun: true })).rejects.toBeInstanceOf(CollectAlreadyRunningError);

    writeFileSync(lockPath, JSON.stringify({ pid: 2_147_483_647, startedAt: '2000-01-01T00:00:00.000Z' }));
    await expect(runCollect({ dbPath: lockDb, dryRun: true })).resolves.toMatchObject({ status: 'completed' });
    expect(existsSync(lockPath)).toBe(false);
    closeDb(lockDb);
    rmSync(lockDir, { recursive: true, force: true });
  });

  it('ラン開始後の最上位例外を failed にし、ロックも解除する', async () => {
    const failDir = mkdtempSync(path.join(tmpdir(), 'edr-top-fail-'));
    const failDbPath = path.join(failDir, 'fail.db');
    await expect(runCollect({
      dbPath: failDbPath,
      keywords: [null as unknown as string],
      now: OFFLINE_REFERENCE_NOW,
    })).rejects.toThrow();
    const failDb = getDb(failDbPath);
    const run = failDb.prepare(`SELECT status, finished_at, notes FROM runs`).get() as {
      status: string;
      finished_at: string | null;
      notes: string | null;
    };
    expect(run.status).toBe('failed');
    expect(run.finished_at).toBeTruthy();
    expect(run.notes).toContain('run failed');
    expect(existsSync(path.join(failDir, 'collect.lock'))).toBe(false);
    closeDb(failDbPath);
    rmSync(failDir, { recursive: true, force: true });
  });
});
