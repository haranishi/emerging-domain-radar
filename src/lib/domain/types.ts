/**
 * ドメイン調査の型。
 *
 * このディレクトリには購入・登録・カート・入札・決済に関わる型も関数も存在しない。
 * 公開されるのは `index.ts` の checkAvailability / getPricing / searchDomains の 3 つだけ
 * （docs/01_requirements.md §3・docs/03_architecture.md §3）。
 */
import type { Availability, Premium } from '../db/types';

export type { Availability, Premium };

/** 空き判定の取得元。`budget` は日次上限に達して問い合わせを止めた状態。 */
export type AvailabilitySource = 'dns' | 'rdap' | 'cache' | 'unsupported' | 'budget' | 'no-db';

export interface AvailabilityResult {
  domain: string;
  availability: Availability;
  availabilitySource: AvailabilitySource;
  /** 判定理由（`negative-cache` / `rdap-404` / `dns-ns` / `budget` / `error` 等）。 */
  reason: string;
  checkedAt: string;
  notes: string[];
}

export interface TldPrice {
  tld: string;
  /** 取れなければ null。推測値・既定値は入れない。 */
  registration: number | null;
  renewal: number | null;
  transfer: number | null;
  currency: string;
  source: string;
  fetchedAt: string;
}

export interface OfficialLink {
  label: string;
  url: string;
}

/** 手動検索と一覧で共通に使う 1 行分の表示モデル。 */
export interface DomainReport {
  domain: string;
  availability: Availability;
  availabilitySource: AvailabilitySource;
  /** 価格が取れないときは null。UI は `Price unavailable` と出す。 */
  registrationPrice: number | null;
  renewalPrice: number | null;
  currency: string | null;
  premium: Premium;
  priceSource: string | null;
  checkedAt: string;
  officialLinks: OfficialLink[];
  notes: string[];
}

/** `.com` は常にこの判定（research/01 §12: レジストリの Premium 階層が存在しない）。 */
export const PREMIUM_INFERRED_NOTE =
  'Standard (inferred) — .com はレジストリに Premium 価格層が無い。ただし予約語・ブロック名は RDAP の 404 と区別できないため、最終確認はレジストラで。';

/** 全候補に必ず出す注意文（要件 F14）。商標の可否を断定する表示は作らない。 */
export const TRADEMARK_REQUIRED_NOTE = 'Trademark check required';

export const AVAILABILITY_CAVEAT =
  '404 は「レジストリに登録が無い」だけを意味する。予約語・ブロック名の可能性があるため空き確定ではない。';
