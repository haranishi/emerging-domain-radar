/**
 * DDL と repos の往復（architecture §4）。
 * 画面（フェーズ 2）が読む queries.ts の形もここで固定する。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createMemoryDb, type Db } from '../../src/lib/db/client';
import { applySchema, TABLES } from '../../src/lib/db/schema';
import {
  addToWatchlist,
  appendRunNote,
  appendWatchlistPrice,
  countRawItemsBySource,
  finishRun,
  getKeywordBySlug,
  getLatestCheck,
  getLatestCompletedRun,
  getLatestFxRate,
  getWatchlistHistory,
  insertDomainCheck,
  listDomainsForKeyword,
  listTrackedKeywords,
  listWatchlist,
  parseRelatedTerms,
  removeFromWatchlist,
  saveFxRate,
  saveMetrics,
  saveOpportunities,
  saveScore,
  slugify,
  startRun,
  upsertDomains,
  upsertKeyword,
  upsertRawItems,
} from '../../src/lib/db/repos/index';
import { getKeywordDetail, listAlertCandidates, listKeywordCards, parseKeywordFilters } from '../../src/lib/db/queries';

function seed(db: Db): { runId: number; keywordId: number } {
  const runId = startRun(db);
  const keywordId = upsertKeyword(db, {
    slug: 'agent-mesh',
    keyword: 'agent mesh',
    description: 'テスト用',
    why_emerging: '4 ソースで増加',
    first_seen_context: 'Show HN: ...',
    related_terms: ['multi agent', 'agent router'],
    extraction_method: 'ngram',
    llm_confidence: null,
    llm_basis: null,
    first_seen_at: '2026-08-14T00:00:00.000Z',
    run_id: runId,
  });
  saveMetrics(db, [
    { run_id: runId, keyword_id: keywordId, source: 'hn', window: '7d', count: 40, approximate: false, query_url: 'https://hn.example/?q=x', fetched_at: '2026-09-03T00:00:00.000Z' },
    { run_id: runId, keyword_id: keywordId, source: 'hn', window: 'prev7d', count: 1, approximate: false, query_url: 'https://hn.example/?q=x', fetched_at: '2026-09-03T00:00:00.000Z' },
    { run_id: runId, keyword_id: keywordId, source: 'hn', window: '30d', count: 44, approximate: false, query_url: 'https://hn.example/?q=x', fetched_at: '2026-09-03T00:00:00.000Z' },
    { run_id: runId, keyword_id: keywordId, source: 'hn', window: 'prev30d', count: 12, approximate: false, query_url: 'https://hn.example/?q=x', fetched_at: '2026-09-03T00:00:00.000Z' },
    { run_id: runId, keyword_id: keywordId, source: 'qiita', window: '30d', count: 1, approximate: false, query_url: 'https://qiita.example/?q=x', fetched_at: '2026-09-03T00:00:00.000Z' },
  ]);
  saveScore(db, {
    run_id: runId,
    keyword_id: keywordId,
    trend_score: 82,
    novelty_score: 100,
    japan_gap_score: 98,
    status: 'Rising',
    fading: false,
    breadth: 4,
    c30_units: 59,
    g7: 10.75,
    g30: 2.14,
    breakdown: { note: 'test' },
  });
  upsertDomains(db, [
    { keyword_id: keywordId, domain: 'agentmesh.com', generation_rule: 'concat', domain_score: 99, trademark_flag: null, run_id: runId },
    { keyword_id: keywordId, domain: 'meshagent.com', generation_rule: 'reorder', domain_score: 94, trademark_flag: null, run_id: runId },
  ]);
  insertDomainCheck(db, {
    domain: 'agentmesh.com',
    checked_at: '2026-09-03T00:00:00.000Z',
    availability: 'available',
    availability_source: 'rdap',
    registration_price: 11.08,
    renewal_price: 11.08,
    currency: 'USD',
    premium: 'standard_inferred',
    price_source: 'porkbun-pricing-get',
    raw: null,
    run_id: runId,
  });
  insertDomainCheck(db, {
    domain: 'meshagent.com',
    checked_at: '2026-09-03T00:00:00.000Z',
    availability: 'taken',
    availability_source: 'dns',
    registration_price: 11.08,
    renewal_price: 11.08,
    currency: 'USD',
    premium: 'standard_inferred',
    price_source: 'porkbun-pricing-get',
    raw: null,
    run_id: runId,
  });
  const domainId = (db.prepare(`SELECT id FROM domains WHERE domain = 'agentmesh.com'`).get() as { id: number }).id;
  saveOpportunities(db, [{ run_id: runId, keyword_id: keywordId, domain_id: domainId, score: 91, breakdown: { note: 'test' } }]);
  finishRun(db, runId, 'completed', { keywords: 1 });
  return { runId, keywordId };
}

describe('スキーマ', () => {
  it('DDL の全テーブルが作られる', () => {
    const db = createMemoryDb();
    const names = (db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]).map((r) => r.name);
    for (const t of TABLES) expect(names, t).toContain(t);
  });

  it('window 列は予約語だが使える（DDL の列名を契約どおりにする）', () => {
    const db = createMemoryDb();
    const cols = (db.prepare(`PRAGMA table_info(keyword_metrics)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['id', 'run_id', 'keyword_id', 'source', 'window', 'count', 'approximate', 'query_url', 'fetched_at']);
  });

  it('rdap_budget は UTC 日付ごとの永続台帳', () => {
    const db = createMemoryDb();
    const cols = (db.prepare(`PRAGMA table_info(rdap_budget)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toEqual(['day', 'used']);
    db.prepare(`INSERT INTO rdap_budget(day, used) VALUES('2026-09-03', 1)`).run();
    expect(() => db.prepare(`INSERT INTO rdap_budget(day, used) VALUES('2026-09-03', 2)`).run()).toThrow();
  });

  it('domains に除外列を作り、既存 DB にも migration する', () => {
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE domains(id INTEGER PRIMARY KEY, keyword_id INTEGER, domain TEXT)`);
    applySchema(db);
    const cols = (db.prepare(`PRAGMA table_info(domains)`).all() as { name: string }[]).map((c) => c.name);
    expect(cols).toContain('excluded');
    expect(cols).toContain('exclusion_reason');
    const defaults = db.prepare(`SELECT dflt_value, "notnull" FROM pragma_table_info('domains') WHERE name = 'excluded'`).get();
    expect(defaults).toEqual({ dflt_value: '0', notnull: 1 });
    db.close();
  });
});

describe('slugify', () => {
  it('決定的で URL に載る形', () => {
    expect(slugify('Agent Mesh')).toBe('agent-mesh');
    expect(slugify('context  engineering!')).toBe('context-engineering');
    expect(slugify('vibe-coding')).toBe('vibe-coding');
  });
});

describe('repos の往復', () => {
  let db: Db;
  beforeEach(() => {
    db = createMemoryDb();
  });

  it('runs: 開始 → メモ追記 → 完了', () => {
    const runId = startRun(db, '最初のメモ');
    appendRunNote(db, runId, 'openalex: 予算切れ');
    finishRun(db, runId, 'partial', { a: 1 });
    const run = getLatestCompletedRun(db);
    expect(run?.id).toBe(runId);
    expect(run?.status).toBe('partial');
    expect(run?.notes).toBe('最初のメモ\nopenalex: 予算切れ');
    expect(JSON.parse(run?.stats_json ?? '{}')).toEqual({ a: 1 });
  });

  it('raw_items: (source, external_id) で upsert される', () => {
    const runId = startRun(db);
    const item = { source: 'hn' as const, external_id: '1', title: 'A', url: null, created_at: null, score: null, run_id: runId };
    upsertRawItems(db, [item, item]);
    upsertRawItems(db, [{ ...item, title: 'A updated' }]);
    const rows = db.prepare(`SELECT * FROM raw_items`).all() as { title: string }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe('A updated');
    expect(countRawItemsBySource(db, runId)).toEqual({ hn: 1 });
  });

  it('keywords: slug で upsert し first_seen_at は最初の値を保つ', () => {
    const runId = startRun(db);
    const id = upsertKeyword(db, {
      slug: 'agent-mesh',
      keyword: 'agent mesh',
      description: null,
      why_emerging: null,
      first_seen_context: null,
      related_terms: ['a'],
      extraction_method: 'ngram',
      llm_confidence: null,
      llm_basis: null,
      first_seen_at: '2026-01-01T00:00:00.000Z',
      run_id: runId,
    });
    const again = upsertKeyword(db, {
      slug: 'agent-mesh',
      keyword: 'agent mesh',
      description: '説明',
      why_emerging: null,
      first_seen_context: null,
      related_terms: ['a', 'b'],
      extraction_method: 'ngram+llm:anthropic',
      llm_confidence: 0.7,
      llm_basis: 'confirmed',
      first_seen_at: '2026-05-05T00:00:00.000Z',
      run_id: runId + 1,
    });
    expect(again).toBe(id);
    const row = getKeywordBySlug(db, 'agent-mesh');
    expect(row?.first_seen_at).toBe('2026-01-01T00:00:00.000Z');
    expect(row?.description).toBe('説明');
    expect(parseRelatedTerms(row!)).toEqual(['a', 'b']);
  });

  it('keyword_metrics: (run, keyword, source, window) で一意', () => {
    const { runId, keywordId } = seed(db);
    saveMetrics(db, [
      { run_id: runId, keyword_id: keywordId, source: 'hn', window: '7d', count: 99, approximate: true, query_url: 'u', fetched_at: 'f' },
    ]);
    const row = db.prepare(`SELECT count, approximate FROM keyword_metrics WHERE source='hn' AND window='7d'`).get() as { count: number; approximate: number };
    expect(row.count).toBe(99);
    expect(row.approximate).toBe(1);
  });

  it('domains: (keyword, domain) で一意・スコア降順で返る', () => {
    const { keywordId } = seed(db);
    const list = listDomainsForKeyword(db, keywordId);
    expect(list.map((d) => d.domain)).toEqual(['agentmesh.com', 'meshagent.com']);
  });

  it('domains: 除外フラグは upsert で切り替わり、既定の一覧と詳細の扱いが分かれる', () => {
    const { runId, keywordId } = seed(db);
    // 商標で除外された候補として上書きする（excluded は SQLite の upsert 擬似表と同名なので実挙動を確かめる）
    upsertDomains(db, [
      {
        keyword_id: keywordId,
        domain: 'meshagent.com',
        generation_rule: 'reorder',
        domain_score: 94,
        trademark_flag: 'brand:Mesh',
        excluded: true,
        exclusion_reason: 'brand:Mesh',
        run_id: runId,
      },
    ]);
    const row = db.prepare(`SELECT excluded, exclusion_reason FROM domains WHERE domain = 'meshagent.com'`).get();
    expect(row).toEqual({ excluded: 1, exclusion_reason: 'brand:Mesh' });
    // 既定の一覧からは消え、詳細の excludedDomains に理由付きで出る
    expect(listDomainsForKeyword(db, keywordId).map((d) => d.domain)).toEqual(['agentmesh.com']);
    const detail = getKeywordDetail(db, 'agent-mesh', runId);
    expect(detail?.domains.map((d) => d.domain)).toEqual(['agentmesh.com']);
    expect(detail?.excludedDomains).toEqual([{ domain: 'meshagent.com', reason: 'brand:Mesh' }]);

    // 除外を解除すれば戻る（列を消さずにフラグで持つ意味がある）
    upsertDomains(db, [
      {
        keyword_id: keywordId,
        domain: 'meshagent.com',
        generation_rule: 'reorder',
        domain_score: 94,
        trademark_flag: null,
        excluded: false,
        exclusion_reason: null,
        run_id: runId,
      },
    ]);
    expect(listDomainsForKeyword(db, keywordId).map((d) => d.domain)).toEqual(['agentmesh.com', 'meshagent.com']);
    expect(getKeywordDetail(db, 'agent-mesh', runId)?.excludedDomains).toEqual([]);
  });

  it('domain_checks は履歴として積み、最新を取り出せる', () => {
    const { runId } = seed(db);
    insertDomainCheck(db, {
      domain: 'agentmesh.com',
      checked_at: '2026-09-04T00:00:00.000Z',
      availability: 'taken',
      availability_source: 'dns',
      registration_price: 11.08,
      renewal_price: 11.08,
      currency: 'USD',
      premium: 'standard_inferred',
      price_source: 'porkbun-pricing-get',
      raw: null,
      run_id: runId,
    });
    expect(db.prepare(`SELECT COUNT(*) AS n FROM domain_checks WHERE domain='agentmesh.com'`).get()).toEqual({ n: 2 });
    expect(getLatestCheck(db, 'agentmesh.com')?.availability).toBe('taken');
  });

  it('追跡キーワードは前回 Opportunity 降順で返る', () => {
    const { runId } = seed(db);
    const second = upsertKeyword(db, {
      slug: 'low-score',
      keyword: 'low score',
      description: null,
      why_emerging: null,
      first_seen_context: null,
      related_terms: [],
      extraction_method: 'ngram',
      llm_confidence: null,
      llm_basis: null,
      first_seen_at: null,
      run_id: runId,
    });
    saveOpportunities(db, [{ run_id: runId, keyword_id: second, domain_id: null, score: 5, breakdown: {} }]);
    expect(listTrackedKeywords(db, 10).map((k) => k.slug)).toEqual(['agent-mesh', 'low-score']);
  });

  it('watchlist: 追加・履歴・削除', () => {
    seed(db);
    const id = addToWatchlist(db, {
      keyword: 'agent mesh',
      domain: 'agentmesh.com',
      found_registration_price: 10.44,
      found_renewal_price: 10.44,
      found_currency: 'USD',
      trend_score: 82,
      opportunity_score: 91,
      note: 'メモ',
    });
    appendWatchlistPrice(db, id, { registration_price: 10.44, renewal_price: 10.44, availability: 'available', premium: 'standard_inferred' });
    appendWatchlistPrice(db, id, { registration_price: 11.08, renewal_price: 11.08, availability: 'available', premium: 'standard_inferred' });
    expect(listWatchlist(db)).toHaveLength(1);
    expect(getWatchlistHistory(db, id)).toHaveLength(2);
    expect(removeFromWatchlist(db, 'agentmesh.com')).toBe(true);
    expect(listWatchlist(db)).toHaveLength(0);
    expect(getWatchlistHistory(db, id)).toHaveLength(0);
    expect(removeFromWatchlist(db, 'agentmesh.com')).toBe(false);
  });

  it('watchlist は domain で一意（二重登録しない）', () => {
    const input = {
      keyword: 'agent mesh',
      domain: 'agentmesh.com',
      found_registration_price: 11.08,
      found_renewal_price: 11.08,
      found_currency: 'USD',
      trend_score: 82,
      opportunity_score: 91,
    };
    const a = addToWatchlist(db, input);
    const b = addToWatchlist(db, input);
    expect(a).toBe(b);
    expect(listWatchlist(db)).toHaveLength(1);
  });

  it('watchlist: 再追加でも自分の行の id を返す（last_insert_rowid() を鍵にしない）', () => {
    const input = (domain: string) => ({
      keyword: 'agent mesh',
      domain,
      found_registration_price: 11.08,
      found_renewal_price: 11.08,
      found_currency: 'USD',
      trend_score: 82,
      opportunity_score: 91,
    });
    const first = addToWatchlist(db, input('agentmesh.com'));
    // 別のドメインを挟むと last_insert_rowid() はこちらを指す。
    // 再追加が UPDATE 経路になるので、直せていないとこの id が返る。
    const other = addToWatchlist(db, input('agentgrid.com'));
    expect(other).not.toBe(first);

    const again = addToWatchlist(db, input('agentmesh.com'));
    expect(again).toBe(first);
    expect(listWatchlist(db)).toHaveLength(2);

    // 価格履歴が別の行にぶら下がらないこと（id を間違えたときの実害）
    appendWatchlistPrice(db, again, {
      registration_price: 11.08,
      renewal_price: 11.08,
      availability: 'available',
      premium: 'standard_inferred',
    });
    expect(getWatchlistHistory(db, first)).toHaveLength(1);
    expect(getWatchlistHistory(db, other)).toHaveLength(0);
  });

  it('fx_rates は最新を取れる', () => {
    saveFxRate(db, { base: 'USD', quote: 'JPY', rate: 159.85, as_of: '2026-09-03', source: 'Frankfurter v2', providers: [{ key: 'ECB' }] });
    const row = getLatestFxRate(db);
    expect(row?.rate).toBe(159.85);
    expect(JSON.parse(row?.providers_json ?? '[]')).toEqual([{ key: 'ECB' }]);
  });
});

describe('parseKeywordFilters（URL クエリ → フィルター）', () => {
  it('全項目を読む', () => {
    const params = new URLSearchParams(
      'status=Emerging,Rising&available=1&maxPrice=20&minTrend=60&minOpportunity=70&excludePremium=1&maxLength=14&sources=hn,github',
    );
    expect(parseKeywordFilters(params)).toEqual({
      status: ['Emerging', 'Rising'],
      sources: ['hn', 'github'],
      availableOnly: true,
      excludePremium: true,
      maxPrice: 20,
      minTrend: 60,
      minOpportunity: 70,
      maxLength: 14,
    });
  });

  it('未指定・空・不正値は無視する（既定は「すべて」）', () => {
    expect(parseKeywordFilters(new URLSearchParams())).toEqual({});
    expect(parseKeywordFilters(new URLSearchParams('maxPrice=&minTrend=abc'))).toEqual({});
    expect(parseKeywordFilters(new URLSearchParams('status=Noise,Bogus&sources=reddit'))).toEqual({});
    expect(parseKeywordFilters(new URLSearchParams('available=0'))).toEqual({});
  });
});

describe('queries（画面の読み出しモデル）', () => {
  let db: Db;
  let runId: number;
  beforeEach(() => {
    db = createMemoryDb();
    runId = seed(db).runId;
  });

  it('カードは順位・Status・3 スコア・根拠・ドメイン 3 件を持つ', () => {
    const [card] = listKeywordCards(db, runId);
    expect(card.rank).toBe(1);
    expect(card.keyword).toBe('agent mesh');
    expect(card.status).toBe('Rising');
    expect(card.trendScore).toBe(82);
    expect(card.japanGapScore).toBe(98);
    expect(card.noveltyScore).toBe(100);
    expect(card.opportunityScore).toBe(91);
    expect(card.whyTrending.length).toBeGreaterThan(0);
    expect(card.topDomains.length).toBeLessThanOrEqual(3);
    expect(card.domainCount).toBe(2);
    expect(card.noAvailableDomain).toBe(false);
    expect(card.lastCheckedAt).toBe('2026-09-03T00:00:00.000Z');
  });

  it('Available only フィルターは空きが無いキーワードを落とす', () => {
    expect(listKeywordCards(db, runId, { availableOnly: true })).toHaveLength(1);
    db.prepare(`UPDATE domain_checks SET availability='taken' WHERE domain='agentmesh.com'`).run();
    expect(listKeywordCards(db, runId, { availableOnly: true })).toHaveLength(0);
  });

  it('価格上限・文字数上限・Status・スコア下限で絞れる', () => {
    expect(listKeywordCards(db, runId, { maxPrice: 10 })).toHaveLength(0);
    expect(listKeywordCards(db, runId, { maxPrice: 20 })).toHaveLength(1);
    expect(listKeywordCards(db, runId, { maxLength: 8 })).toHaveLength(0);
    expect(listKeywordCards(db, runId, { maxLength: 20 })).toHaveLength(1);
    expect(listKeywordCards(db, runId, { status: ['Emerging'] })).toHaveLength(0);
    expect(listKeywordCards(db, runId, { status: ['Rising'] })).toHaveLength(1);
    expect(listKeywordCards(db, runId, { minTrend: 90 })).toHaveLength(0);
    expect(listKeywordCards(db, runId, { minOpportunity: 95 })).toHaveLength(0);
    expect(listKeywordCards(db, runId, { sources: ['github'] })).toHaveLength(0);
    expect(listKeywordCards(db, runId, { sources: ['hn'] })).toHaveLength(1);
  });

  it('フィルターが効いているとカードの上位 3 件も絞られる（表示と絞り込みを食い違わせない）', () => {
    const [all] = listKeywordCards(db, runId);
    expect(all.topDomains.map((d) => d.domain)).toEqual(['agentmesh.com', 'meshagent.com']);
    const [availableOnly] = listKeywordCards(db, runId, { availableOnly: true });
    expect(availableOnly.topDomains.map((d) => d.domain)).toEqual(['agentmesh.com']);
    // 件数は全件を示す（「+N more」の N を出すため）
    expect(availableOnly.domainCount).toBe(2);
  });

  it('詳細は Evidence 表・関連語・内訳・ドメイン全件を返す', () => {
    db.prepare(
      `INSERT INTO domains(keyword_id, domain, generation_rule, domain_score, trademark_flag, excluded, exclusion_reason, created_run_id)
       VALUES(1, 'googleagent.com', 'concat', 80, 'brand:google', 1, 'brand:google', ?)`,
    ).run(runId);
    const detail = getKeywordDetail(db, 'agent-mesh');
    expect(detail).toBeDefined();
    expect(detail?.evidence.map((e) => e.source)).toEqual(['hn', 'qiita']);
    const hn = detail?.evidence.find((e) => e.source === 'hn');
    expect(hn?.counts).toEqual({ '7d': 40, prev7d: 1, '30d': 44, prev30d: 12 });
    expect(hn?.change7).toBe(40);
    expect(hn?.queryUrl).toBe('https://hn.example/?q=x');
    expect(detail?.relatedTerms).toEqual(['multi agent', 'agent router']);
    expect(detail?.domains).toHaveLength(2);
    expect(detail?.excludedDomains).toEqual([{ domain: 'googleagent.com', reason: 'brand:google' }]);
    expect(detail?.trendBreakdown).toEqual({ note: 'test' });
    expect(detail?.opportunityBreakdown).toEqual({ note: 'test' });
    expect(detail?.firstSeenAt).toBe('2026-08-14T00:00:00.000Z');
  });

  it('存在しない slug は undefined', () => {
    expect(getKeywordDetail(db, 'nope')).toBeUndefined();
  });

  it('通知条件（Trend>=80・Opportunity>=80・available・<=$20・非 premium）', () => {
    expect(listAlertCandidates(db, runId)).toEqual([
      {
        keyword: 'agent mesh',
        slug: 'agent-mesh',
        domain: 'agentmesh.com',
        trendScore: 82,
        opportunityScore: 91,
        registrationPrice: 11.08,
        currency: 'USD',
      },
    ]);
  });

  it('通知の Opportunity はドメイン単位の値を出す（キーワードの最大値を全行に出さない）', () => {
    // 2 件目のドメインには Opportunity 行を作っていないので通知には出ない
    const scores = listAlertCandidates(db, runId);
    expect(scores.map((a) => a.domain)).toEqual(['agentmesh.com']);
    // 79 に下げると閾値 80 を割って落ちる
    db.prepare(`UPDATE opportunity SET score = 79 WHERE keyword_id = 1 AND domain_id IS NOT NULL`).run();
    expect(listAlertCandidates(db, runId)).toEqual([]);
  });

  it('premium や $20 超は通知条件から外れる', () => {
    db.prepare(`UPDATE domain_checks SET registration_price = 25 WHERE domain='agentmesh.com'`).run();
    expect(listAlertCandidates(db, runId)).toEqual([]);
    db.prepare(`UPDATE domain_checks SET registration_price = 11.08, premium='premium' WHERE domain='agentmesh.com'`).run();
    expect(listAlertCandidates(db, runId)).toEqual([]);
  });
});
