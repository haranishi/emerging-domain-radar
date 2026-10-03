/** 為替（architecture §8・research/04 §2.3）。 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  FRANKFURTER_SOURCE,
  FX_DISCLAIMER,
  FX_NEGATIVE_CACHE_TTL_MS,
  fetchUsdJpy,
  getUsdJpyCached,
  parseFrankfurter,
} from '../../src/lib/fx/frankfurter';
import { resetEnvCache } from '../../src/lib/env';
import { getHttpStats, resetHttpStats } from '../../src/lib/http';
import { createMemoryDb } from '../../src/lib/db/client';
import { saveFxRate } from '../../src/lib/db/repos/fx';

describe('parseFrankfurter', () => {
  it('v2 の配列応答からレート・日付・出典を取る', () => {
    const r = parseFrankfurter([
      {
        date: '2026-09-03',
        base: 'USD',
        quote: 'JPY',
        rate: 159.85,
        providers: [
          { key: 'BOJ', date: '2026-09-01', rate: 159.99 },
          { key: 'ECB', date: '2026-09-02', rate: 159.6 },
          { key: 'BCC', date: '2026-09-03', rate: 2562.56, excluded: true },
        ],
      },
    ]);
    expect(r).not.toBeNull();
    expect(r?.rate).toBe(159.85);
    expect(r?.asOf).toBe('2026-09-03');
    expect(r?.source).toBe(FRANKFURTER_SOURCE);
    // 「出典：欧州中央銀行 2026-09-02」を出すために ECB の日付を分けて持つ
    expect(r?.ecbDate).toBe('2026-09-02');
    expect(r?.disclaimer).toBe(FX_DISCLAIMER);
  });

  it('外れ値（excluded）も内訳としては残す', () => {
    const r = parseFrankfurter([
      { date: '2026-09-03', base: 'USD', quote: 'JPY', rate: 159.85, providers: [{ key: 'BCC', date: '2026-09-03', rate: 2562.56, excluded: true }] },
    ]);
    expect(r?.providers).toHaveLength(1);
    expect(r?.ecbDate).toBeNull();
  });

  it('rate が無ければ null（推測しない）', () => {
    expect(parseFrankfurter([])).toBeNull();
    expect(parseFrankfurter([{ date: '2026-09-03', base: 'USD', quote: 'JPY' }])).toBeNull();
  });
});

describe('getUsdJpyCached', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
  });

  it('DB があれば 24h キャッシュを使い、外部を叩かない', async () => {
    const db = createMemoryDb();
    const first = await getUsdJpyCached(db);
    expect(first.rate).toBe(159.85);
    expect(getHttpStats().callsByHost['api.frankfurter.dev']).toBe(1);

    resetHttpStats();
    const second = await getUsdJpyCached(db);
    expect(second.rate).toBe(159.85);
    expect(second.source).toBe(FRANKFURTER_SOURCE);
    expect(second.ecbDate).toBe('2026-09-02');
    expect(getHttpStats().callsByHost['api.frankfurter.dev']).toBeUndefined();
  });

  it('キャッシュが古ければ取り直す', async () => {
    const db = createMemoryDb();
    await getUsdJpyCached(db);
    db.prepare(`UPDATE fx_rates SET fetched_at = ?`).run(new Date(Date.now() - 48 * 3600 * 1000).toISOString());
    resetHttpStats();
    await getUsdJpyCached(db);
    expect(getHttpStats().callsByHost['api.frankfurter.dev']).toBe(1);
  });

  it('DB 無しでも動く（毎回取得）', async () => {
    const r = await getUsdJpyCached();
    expect(r.rate).toBe(159.85);
  });

  it('旧版の予備APIキャッシュは返さず Frankfurter から取り直す', async () => {
    const db = createMemoryDb();
    saveFxRate(db, { base: 'USD', quote: 'JPY', rate: 123, as_of: '2000-01-01', source: 'open.er-api.com' });
    const r = await getUsdJpyCached(db);
    expect(r.rate).toBe(159.85);
    expect(r.source).toBe(FRANKFURTER_SOURCE);
    expect(r.attribution).toBeNull();
    expect(getHttpStats().callsByHost['api.frankfurter.dev']).toBe(1);
    expect(getHttpStats().callsByHost['open.er-api.com']).toBeUndefined();
  });
});

describe('fetchUsdJpy', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
  });

  it('fixture から Frankfurter を読む', async () => {
    const r = await fetchUsdJpy();
    expect(r.rate).toBe(159.85);
    expect(r.source).toBe(FRANKFURTER_SOURCE);
    expect(r.providers.length).toBeGreaterThan(0);
    expect(r.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('表示は「参考値」', () => {
    expect(FX_DISCLAIMER).toBe('参考値');
    expect(FX_NEGATIVE_CACHE_TTL_MS).toBe(15 * 60 * 1000);
  });
});

describe('取得失敗時は別の提供元へ切り替えない', () => {
  const failures: [string, () => Promise<{ ok: boolean; json?: () => unknown }>][] = [
    ['接続失敗', () => Promise.reject(new Error('offline'))],
    ['HTTP エラー', () => Promise.resolve({ ok: false })],
    ['レート欠落', () => Promise.resolve({ ok: true, json: () => [] })],
    ['JSON 破損', () => Promise.resolve({ ok: true, json: () => { throw new Error('invalid JSON'); } })],
  ];
  it.each(failures)('%s なら rate:null を返す', async (_label, response) => {
    vi.resetModules();
    const httpGet = vi.fn((_url: string) => response());
    vi.doMock('../../src/lib/http', () => ({ httpGet }));
    try {
      const fx = await import('../../src/lib/fx/frankfurter');
      expect(await fx.fetchUsdJpy()).toMatchObject({ rate: null, source: null, attribution: null });
      expect(httpGet).toHaveBeenCalledTimes(1);
      expect(httpGet.mock.calls[0]?.[0]).toMatch(/^https:\/\/api\.frankfurter\.dev\//);
    } finally {
      vi.doUnmock('../../src/lib/http');
      vi.resetModules();
    }
  });

  it('取得失敗後は短い TTL 内に外部へ再試行しない', async () => {
    vi.resetModules();
    const httpGet = vi.fn().mockRejectedValue(new Error('offline'));
    vi.doMock('../../src/lib/http', () => ({ httpGet }));
    try {
      const fx = await import('../../src/lib/fx/frankfurter');
      expect((await fx.getUsdJpyCached()).rate).toBeNull();
      expect((await fx.getUsdJpyCached()).rate).toBeNull();
      expect(httpGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('../../src/lib/http');
      vi.resetModules();
    }
  });

  it('Frankfurter が失敗しても旧版の予備APIキャッシュは返さない', async () => {
    const db = createMemoryDb();
    saveFxRate(db, { base: 'USD', quote: 'JPY', rate: 123, as_of: '2000-01-01', source: 'open.er-api.com' });
    vi.resetModules();
    const httpGet = vi.fn().mockRejectedValue(new Error('offline'));
    vi.doMock('../../src/lib/http', () => ({ httpGet }));
    try {
      const fx = await import('../../src/lib/fx/frankfurter');
      expect(await fx.getUsdJpyCached(db)).toMatchObject({ rate: null, source: null, attribution: null });
      expect(httpGet).toHaveBeenCalledTimes(1);
    } finally {
      vi.doUnmock('../../src/lib/http');
      vi.resetModules();
    }
  });
});
