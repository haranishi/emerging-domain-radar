/**
 * Porkbun の公開価格表。認証不要の GET 1 本だけを使う。
 *
 *   GET https://api.porkbun.com/api/json/v3/pricing/get
 *
 * このファイルには価格表以外の Porkbun エンドポイントを書かない。
 * （API キーのスコープは IP と対象ドメインのアローリストだけで「読み取り専用」が無く、
 *  同じキーで登録系のエンドポイントまで呼べてしまうため・research/01 §2。
 *  個別ドメインの空き判定エンドポイントも MVP では使わない＝POST かつ認証必須で、
 *  既定のレートが 1 件/10 秒（1,000 件で約 2.8 時間）と調査用途には遅すぎる。
 *  tests/unit/no-purchase-guard.test.ts がこの制約を機械的に検査する。）
 */
import { httpGet } from '../../http';
import type { TldPrice } from '../types';

export const PORKBUN_PRICING_URL = 'https://api.porkbun.com/api/json/v3/pricing/get';
export const PRICE_SOURCE = 'porkbun-pricing-get';

interface PorkbunPricingResponse {
  status?: string;
  pricing?: Record<string, { registration?: string; renewal?: string; transfer?: string }>;
}

function toNumber(v: unknown): number | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * 全 TLD の標準価格を取る（1 リクエストで 900 超の TLD が返る）。
 * 取れない値は null のまま返す。推測値・既定値は入れない。
 */
export async function fetchAllTldPrices(): Promise<TldPrice[]> {
  // 実測で 6〜10 秒（82KB・全 TLD）。既定 15 秒だと稀にタイムアウトするので広げる。
  const res = await httpGet(PORKBUN_PRICING_URL, { label: 'porkbun-pricing', timeoutMs: 30_000 });
  if (!res.ok) return [];
  const parsed = res.json<PorkbunPricingResponse>();
  if (parsed.status && parsed.status !== 'SUCCESS') return [];
  const fetchedAt = new Date().toISOString();
  const out: TldPrice[] = [];
  for (const [tld, row] of Object.entries(parsed.pricing ?? {})) {
    out.push({
      tld: tld.replace(/^\./, '').toLowerCase(),
      registration: toNumber(row.registration),
      renewal: toNumber(row.renewal),
      transfer: toNumber(row.transfer),
      currency: 'USD',
      source: PRICE_SOURCE,
      fetchedAt,
    });
  }
  return out;
}
