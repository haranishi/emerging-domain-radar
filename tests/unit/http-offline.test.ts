/**
 * HTTP 層（architecture §10）。
 * オフライン fixture はヘッダも再現できることが要件（Qiita の Total-Count・
 * OpenAlex の x-ratelimit-cost-usd をテストするため）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { MAX_HEADER_BLOCK_MS, RATE_LIMITS, getHttpStats, httpGet, limitFor, rateLimitResetDecision, resetHttpStats, retryDelayMs, HttpError, SourceRateLimitError } from '../../src/lib/http';
import { fixturesDir, isOffline, resetEnvCache, userAgent } from '../../src/lib/env';

describe('オフラインモード', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
  });

  it('テストは常にオフライン（実 API を叩かない）', () => {
    expect(isOffline()).toBe(true);
  });

  it('fixture の本文を返す', async () => {
    const res = await httpGet('https://api.porkbun.com/api/json/v3/pricing/get');
    expect(res.status).toBe(200);
    expect(res.ok).toBe(true);
    const body = res.json<{ status: string; pricing: Record<string, { registration: string }> }>();
    expect(body.status).toBe('SUCCESS');
    expect(body.pricing.com.registration).toBe('11.08');
  });

  it('Qiita の Total-Count ヘッダを再現する', async () => {
    const res = await httpGet('https://qiita.com/api/v2/items?query=%22test%22+created%3A%3E%3D2026-08-04&per_page=1');
    expect(res.headers.get('total-count')).toBe('12');
    // 大文字小文字を区別しない
    expect(res.headers.get('Total-Count')).toBe('12');
    expect(res.headers.get('rate-remaining')).toBe('57');
  });

  it('OpenAlex の x-ratelimit-cost-usd を集計する', async () => {
    await httpGet('https://api.openalex.org/works?filter=title_and_abstract.search%3A%22x%22%2Cfrom_publication_date%3A2026-08-27%2Cto_publication_date%3A2026-09-03&group_by=publication_year');
    await httpGet('https://api.openalex.org/works?filter=title_and_abstract.search%3A%22y%22%2Cfrom_publication_date%3A2026-08-20%2Cto_publication_date%3A2026-08-27&group_by=publication_year');
    const stats = getHttpStats();
    expect(stats.openalexCostUsd).toBeCloseTo(0.0002, 8);
    expect(stats.openalexRemainingUsd).toBeCloseTo(0.0969, 8);
  });

  it('404 は throw せずに返す（RDAP の空き判定に使う）', async () => {
    const res = await httpGet('https://rdap.verisign.com/com/v1/domain/zzq7x4vk2mlp9dwhrn3btf6.com');
    expect(res.status).toBe(404);
    expect(res.ok).toBe(false);
    expect(res.body).toBe('');
  });

  it('正規表現の fixture が前方一致より先に評価される', async () => {
    const taken = await httpGet('https://rdap.verisign.com/com/v1/domain/example.com');
    expect(taken.status).toBe(200);
    const limited = await httpGet('https://rdap.verisign.com/com/v1/domain/rdapunknown.com');
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('1');
  });

  it('fixture が無い URL は例外', async () => {
    await expect(httpGet('https://example.invalid/nope')).rejects.toThrow(HttpError);
  });

  it('窓別 fixture は窓ごとに違う件数を返す（GitHub / OpenAlex / Qiita）', async () => {
    const github = async (from: string, to: string): Promise<number> =>
      (
        await httpGet(
          `https://api.github.com/search/repositories?q=%22kw%22+created%3A${from}T00%3A00%3A00Z..${to}T00%3A00%3A00Z&per_page=1`,
        )
      ).json<{ total_count: number }>().total_count;
    // 7d / prev7d / 30d / prev30d が別ファイル・別件数（窓の取り違えが件数のズレとして出る）
    expect(await github('2026-08-27', '2026-09-03')).toBe(7);
    expect(await github('2026-08-20', '2026-08-27')).toBe(6);
    expect(await github('2026-08-04', '2026-09-03')).toBe(24);
    expect(await github('2026-07-05', '2026-08-04')).toBe(11);

    const openalex = async (from: string, to: string): Promise<number> =>
      (
        await httpGet(
          `https://api.openalex.org/works?filter=title_and_abstract.search%3A%22kw%22%2Cfrom_publication_date%3A${from}%2Cto_publication_date%3A${to}&group_by=publication_year`,
        )
      ).json<{ meta: { count: number } }>().meta.count;
    expect(await openalex('2026-08-27', '2026-09-03')).toBe(3);
    expect(await openalex('2026-08-20', '2026-08-27')).toBe(2);
    expect(await openalex('2026-08-04', '2026-09-03')).toBe(14);
    expect(await openalex('2026-07-05', '2026-08-04')).toBe(8);

    const qiita = async (query: string): Promise<string | null> =>
      (await httpGet(`https://qiita.com/api/v2/items?query=${query}&per_page=1`)).headers.get('total-count');
    expect(await qiita('%22kw%22+created%3A%3E%3D2026-08-04')).toBe('12');
    expect(await qiita('%22kw%22+created%3A%3E%3D2026-07-05+created%3A%3C2026-08-04')).toBe('4');
  });

  it('引用符を外す・窓の日付を間違えると fixture に当たらない（誤りが例外として出る）', async () => {
    // 引用符なし
    await expect(
      httpGet('https://api.github.com/search/repositories?q=kw+created%3A2026-08-27T00%3A00%3A00Z..2026-09-03T00%3A00%3A00Z&per_page=1'),
    ).rejects.toThrow(HttpError);
    await expect(
      httpGet('https://qiita.com/api/v2/items?query=kw+created%3A%3E%3D2026-08-04&per_page=1'),
    ).rejects.toThrow(HttpError);
    // 窓の境界が 1 日ずれている
    await expect(
      httpGet('https://api.github.com/search/repositories?q=%22kw%22+created%3A2026-08-28T00%3A00%3A00Z..2026-09-03T00%3A00%3A00Z&per_page=1'),
    ).rejects.toThrow(HttpError);
    await expect(
      httpGet(
        'https://api.openalex.org/works?filter=title_and_abstract.search%3A%22kw%22%2Cfrom_publication_date%3A2026-08-05%2Cto_publication_date%3A2026-09-03&group_by=publication_year',
      ),
    ).rejects.toThrow(HttpError);
  });

  it('fixtures/http の全ファイルが index.json から参照されている（取り残しを作らない）', () => {
    const dir = path.join(fixturesDir(), 'http');
    const index = JSON.parse(readFileSync(path.join(dir, 'index.json'), 'utf8')) as { file: string }[];
    const referenced = new Set(index.map((e) => e.file));
    const orphans = readdirSync(dir).filter((name) => name !== 'index.json' && !referenced.has(name));
    expect(orphans).toEqual([]);
    // 逆向き: index.json が実在しないファイルを指していない
    const missing = index.map((e) => e.file).filter((file) => !existsSync(path.join(dir, file)));
    expect(missing).toEqual([]);
  });

  it('ホスト別・ラベル別の呼び出し件数を数える', async () => {
    await httpGet('https://api.porkbun.com/api/json/v3/pricing/get', { label: 'porkbun-pricing' });
    const stats = getHttpStats();
    expect(stats.callsByHost['api.porkbun.com']).toBe(1);
    expect(stats.callsByLabel['porkbun-pricing']).toBe(1);
    expect(stats.offlineHits).toBe(1);
  });
});

describe('レート制限の表', () => {
  it('architecture §5.2 / §3 の値を 1 か所に持つ', () => {
    expect(RATE_LIMITS['hn.algolia.com'].ratePerSec).toBe(2);
    // 未認証 GitHub は 10/min → 安全側に 1 req/7s
    expect(RATE_LIMITS['api.github.com'].ratePerSec).toBeCloseTo(1 / 7, 6);
    // arXiv は 1 req/5s ＋ 60/120/240 秒の指数バックオフ
    expect(RATE_LIMITS['export.arxiv.org'].ratePerSec).toBeCloseTo(1 / 5, 6);
    expect(RATE_LIMITS['export.arxiv.org'].backoffMs).toEqual([60_000, 120_000, 240_000]);
    expect(RATE_LIMITS['api.openalex.org'].ratePerSec).toBe(2);
    // Qiita 未認証は 60 req/h
    expect(RATE_LIMITS['qiita.com'].ratePerSec).toBeCloseTo(60 / 3600, 8);
    expect(RATE_LIMITS['qiita.com'].burst).toBe(1);
    // RDAP は 300ms 間隔
    expect(RATE_LIMITS['rdap.verisign.com'].ratePerSec).toBeCloseTo(1 / 0.3, 6);
  });

  it('GitHub/Qiita は reset が 120 秒以下なら待機、超えるならソース停止', () => {
    const now = 1_800_000_000_000;
    expect(rateLimitResetDecision('api.github.com', new Headers({
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': String((now + 120_000) / 1000),
    }), now)).toEqual({ waitMs: 120_000, stopSource: false });
    expect(rateLimitResetDecision('qiita.com', new Headers({
      'rate-remaining': '0',
      'rate-reset': String((now + 121_000) / 1000),
    }), now)).toEqual({ waitMs: 121_000, stopSource: true });
    expect(rateLimitResetDecision('api.github.com', new Headers({
      'x-ratelimit-remaining': '1',
      'x-ratelimit-reset': String((now + 999_000) / 1000),
    }), now)).toBeNull();
  });

  it('reset が 120 秒超のホストは実リクエスト後にそのランで停止する', async () => {
    process.env.RADAR_OFFLINE = '0';
    resetEnvCache();
    resetHttpStats();
    const reset = Math.ceil((Date.now() + 121_000) / 1000);
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 200,
      headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(reset) },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(httpGet('https://api.github.com/search/repositories?q=x')).rejects.toBeInstanceOf(SourceRateLimitError);
      await expect(httpGet('https://api.github.com/search/repositories?q=y')).rejects.toBeInstanceOf(SourceRateLimitError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      process.env.RADAR_OFFLINE = '1';
      resetEnvCache();
      resetHttpStats();
    }
  });

  it('長いバックオフは 429 のときだけ使う（5xx は 1/2/4 秒）', () => {
    const arxiv = RATE_LIMITS['export.arxiv.org'];
    const res429 = { status: 429, headers: new Headers() } as never;
    const res500 = { status: 500, headers: new Headers() } as never;
    expect(retryDelayMs(res429, 0, arxiv)).toBe(60_000);
    expect(retryDelayMs(res429, 2, arxiv)).toBe(240_000);
    // arXiv がたまに返す 500 で 7 分待たないようにする
    expect(retryDelayMs(res500, 0, arxiv)).toBe(1000);
    expect(retryDelayMs(res500, 2, arxiv)).toBe(4000);
    expect(retryDelayMs(null, 0, arxiv)).toBe(1000);
  });

  it('Retry-After を尊重する（既定より長ければそちらを使う）', () => {
    const res = { status: 429, headers: new Headers({ 'retry-after': '90' }) } as never;
    expect(retryDelayMs(res, 0, RATE_LIMITS['api.github.com'])).toBe(90_000);
    const shortRes = { status: 429, headers: new Headers({ 'retry-after': '1' }) } as never;
    expect(retryDelayMs(shortRes, 0, RATE_LIMITS['export.arxiv.org'])).toBe(60_000);

    const future = new Date(Date.now() + MAX_HEADER_BLOCK_MS + 60_000).toUTCString();
    const dateRes = { status: 429, headers: new Headers({ 'retry-after': future }) } as never;
    expect(retryDelayMs(dateRes, 0, RATE_LIMITS['api.github.com'])).toBe(MAX_HEADER_BLOCK_MS);
  });

  it('120 秒超の Retry-After HTTP-date は待たず、そのホストを当該ランで停止する', async () => {
    process.env.RADAR_OFFLINE = '0';
    resetEnvCache();
    resetHttpStats();
    const future = new Date(Date.now() + MAX_HEADER_BLOCK_MS + 60_000).toUTCString();
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', {
      status: 429,
      headers: { 'retry-after': future },
    }));
    vi.stubGlobal('fetch', fetchMock);
    try {
      await expect(httpGet('https://api.github.com/search/repositories?q=date-a')).rejects.toBeInstanceOf(SourceRateLimitError);
      await expect(httpGet('https://api.github.com/search/repositories?q=date-b')).rejects.toBeInstanceOf(SourceRateLimitError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
      process.env.RADAR_OFFLINE = '1';
      resetEnvCache();
      resetHttpStats();
    }
  });

  it('arXiv の間隔は RADAR_ARXIV_INTERVAL_MS で上書きできる', () => {
    resetEnvCache();
    // 既定は 5000ms = 1 req/5s
    expect(limitFor('export.arxiv.org').ratePerSec).toBeCloseTo(1 / 5, 6);
    process.env.RADAR_ARXIV_INTERVAL_MS = '10000';
    resetEnvCache();
    try {
      // 500 を連発する時間帯は 10000 にして 1 ランを通す
      expect(limitFor('export.arxiv.org').ratePerSec).toBeCloseTo(1 / 10, 6);
      // バックオフの表と他ホストは変わらない
      expect(limitFor('export.arxiv.org').backoffMs).toEqual([60_000, 120_000, 240_000]);
      expect(limitFor('hn.algolia.com').ratePerSec).toBe(2);
      // 表そのものは書き換えない（上書きは limitFor だけ）
      expect(RATE_LIMITS['export.arxiv.org'].ratePerSec).toBeCloseTo(1 / 5, 6);
    } finally {
      delete process.env.RADAR_ARXIV_INTERVAL_MS;
      resetEnvCache();
    }
  });

  it('計測に使うホストがすべて表にある', () => {
    for (const host of [
      'hn.algolia.com',
      'api.github.com',
      'export.arxiv.org',
      'api.openalex.org',
      'qiita.com',
      'ja.wikipedia.org',
      // langlinks（キーワードの日本語訳）で使う
      'en.wikipedia.org',
      'wikimedia.org',
      'rdap.verisign.com',
      'data.iana.org',
      'api.porkbun.com',
      'api.frankfurter.dev',
    ]) {
      expect(RATE_LIMITS[host], host).toBeDefined();
    }
  });
});

describe('User-Agent', () => {
  it('architecture §5.2 の形（連絡先は OPENALEX_MAILTO か not-set）', () => {
    resetEnvCache();
    expect(userAgent()).toBe('emerging-domain-radar/0.1 (local research tool; contact: not-set)');
    process.env.OPENALEX_MAILTO = 'someone@example.com';
    resetEnvCache();
    expect(userAgent()).toContain('contact: someone@example.com');
    delete process.env.OPENALEX_MAILTO;
    resetEnvCache();
  });
});
