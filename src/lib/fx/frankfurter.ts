/**
 * USD → JPY の参考レート。Frankfurter v2（キー不要）。
 *
 * v2 は 84 の中央銀行のレートをブレンドして返す（ECB 専用ではない・research/04 §2.3）。
 * `expand=providers` を付けると各行の出典と日付が返るので「取得元・取得時刻を明記」を満たせる。
 * 取得失敗なら rate: null で USD だけ表示する。再配布禁止の予備APIは使用しない。
 */
import { httpGet } from '../http';
import type { Db } from '../db/client';
import { getFreshFxRate, saveFxRate } from '../db/repos/fx';

const FRANKFURTER = 'https://api.frankfurter.dev/v2/rates';

export const FRANKFURTER_SOURCE = 'Frankfurter v2 (central-bank blend)';
/** UI にはこの断りを付ける。 */
export const FX_DISCLAIMER = '参考値';
/** 取得失敗時に使う短い負キャッシュ。 */
export const FX_NEGATIVE_CACHE_TTL_MS = 15 * 60 * 1000;

let negativeCache: { result: FxResult; expiresAt: number } | null = null;

export interface ProviderRate {
  key: string;
  date: string;
  rate: number;
  excluded?: boolean;
}

export interface FxResult {
  base: string;
  quote: string;
  /** 取れなければ null（UI は USD のみ表示）。 */
  rate: number | null;
  asOf: string | null;
  source: string | null;
  /** ECB の行があればその日付（UI の「出典：欧州中央銀行 YYYY-MM-DD」用）。 */
  ecbDate: string | null;
  providers: ProviderRate[];
  attribution: string | null;
  fetchedAt: string;
  disclaimer: string;
}

interface FrankfurterRow {
  date?: string;
  base?: string;
  quote?: string;
  rate?: number;
  providers?: ProviderRate[];
}

function empty(): FxResult {
  return {
    base: 'USD',
    quote: 'JPY',
    rate: null,
    asOf: null,
    source: null,
    ecbDate: null,
    providers: [],
    attribution: null,
    fetchedAt: new Date().toISOString(),
    disclaimer: FX_DISCLAIMER,
  };
}

export function parseFrankfurter(rows: FrankfurterRow[]): FxResult | null {
  const row = rows[0];
  if (!row || typeof row.rate !== 'number') return null;
  const providers = (row.providers ?? []).filter((p) => typeof p.rate === 'number');
  const ecb = providers.find((p) => p.key === 'ECB' && !p.excluded);
  return {
    base: row.base ?? 'USD',
    quote: row.quote ?? 'JPY',
    rate: row.rate,
    asOf: row.date ?? null,
    source: FRANKFURTER_SOURCE,
    ecbDate: ecb?.date ?? null,
    providers,
    attribution: null,
    fetchedAt: new Date().toISOString(),
    disclaimer: FX_DISCLAIMER,
  };
}

export async function fetchUsdJpy(): Promise<FxResult> {
  const url = `${FRANKFURTER}?base=USD&quotes=JPY&expand=providers`;
  try {
    const res = await httpGet(url, { label: 'fx-frankfurter', retries: 1 });
    if (res.ok) {
      const parsed = parseFrankfurter(res.json<FrankfurterRow[]>());
      if (parsed) return parsed;
    }
  } catch {
    // 取得失敗 → rate: null。別の提供元へは切り替えない。
  }
  return empty();
}

/**
 * 24 時間キャッシュつきの取得。`/api/fx` とパイプラインはこちらを使う。
 * 1 日 1 回引けば足りる（Frankfurter の応答も約 20 時間キャッシュ可）。
 */
export async function getUsdJpyCached(db?: Db, maxAgeMs = 24 * 3600 * 1000): Promise<FxResult> {
  if (db) {
    const cached = getFreshFxRate(db, 'USD', 'JPY', maxAgeMs);
    // 旧版が保存した予備API由来のレートも、画面や /api/fx に返さない。
    if (cached && cached.source === FRANKFURTER_SOURCE) {
      let providers: ProviderRate[] = [];
      if (cached.providers_json) {
        try {
          providers = JSON.parse(cached.providers_json) as ProviderRate[];
        } catch {
          providers = [];
        }
      }
      const ecb = providers.find((p) => p.key === 'ECB' && !p.excluded);
      return {
        base: cached.base,
        quote: cached.quote,
        rate: cached.rate,
        asOf: cached.as_of,
        source: cached.source,
        ecbDate: ecb?.date ?? null,
        providers,
        attribution: null,
        fetchedAt: cached.fetched_at,
        disclaimer: FX_DISCLAIMER,
      };
    }
  }

  if (negativeCache && negativeCache.expiresAt > Date.now()) return negativeCache.result;
  negativeCache = null;

  const fresh = await fetchUsdJpy();
  if (db && fresh.rate !== null) {
    saveFxRate(db, {
      base: fresh.base,
      quote: fresh.quote,
      rate: fresh.rate,
      as_of: fresh.asOf ?? fresh.fetchedAt,
      source: fresh.source ?? 'unknown',
      providers: fresh.providers,
    });
  } else if (fresh.rate === null) {
    negativeCache = { result: fresh, expiresAt: Date.now() + FX_NEGATIVE_CACHE_TTL_MS };
  }
  return fresh;
}
