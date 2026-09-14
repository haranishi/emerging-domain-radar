/** 為替（architecture §8・research/04 §2.3）。 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  FALLBACK_ATTRIBUTION,
  FALLBACK_SOURCE,
  FRANKFURTER_SOURCE,
  FX_DISCLAIMER,
  FX_NEGATIVE_CACHE_TTL_MS,
  fetchUsdJpy,
  getUsdJpyCached,
  parseFallback,
  parseFrankfurter,
} from '../../src/lib/fx/frankfurter';
import { resetEnvCache } from '../../src/lib/env';
import { getHttpStats, resetHttpStats } from '../../src/lib/http';
import { createMemoryDb } from '../../src/lib/db/client';

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

describe('parseFallback（open.er-api.com）', () => {
  it('帰属表示を必ず付ける', () => {
    const r = parseFallback({
      result: 'success',
      time_last_update_utc: 'Wed, 03 Sep 2026 00:00:01 +0000',
      rates: { USD: 1, JPY: 159.6 },
    });
    expect(r?.rate).toBe(159.6);
    expect(r?.source).toBe(FALLBACK_SOURCE);
    expect(r?.attribution).toBe(FALLBACK_ATTRIBUTION);
  });

  it('result が success 以外なら null', () => {
    expect(parseFallback({ result: 'error', rates: { JPY: 159 } })).toBeNull();
    expect(parseFallback({ result: 'success', rates: {} })).toBeNull();
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

describe('getUsdJpyCached の負キャッシュ', () => {
  it('両提供元の失敗後は短い TTL 内に外部へ再試行しない', async () => {
    vi.resetModules();
    const httpGet = vi.fn().mockRejectedValue(new Error('offline'));
    vi.doMock('../../src/lib/http', () => ({ httpGet }));
    try {
      const fx = await import('../../src/lib/fx/frankfurter');
      expect((await fx.getUsdJpyCached()).rate).toBeNull();
      expect((await fx.getUsdJpyCached()).rate).toBeNull();
      expect(httpGet).toHaveBeenCalledTimes(2);
    } finally {
      vi.doUnmock('../../src/lib/http');
      vi.resetModules();
    }
  });
});
