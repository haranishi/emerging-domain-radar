/**
 * Watchlist の行を組み立てる（`/watchlist` と `GET /api/watchlist` で共用）。
 *
 * 画面は自分の API を叩かず DB を直接読む（03_architecture.md §8）。同じ形を 2 か所で
 * 別々に組み立てると片方だけ直る事故が起きるので、DB 行 → 表示用の写像はここだけに置く。
 *
 * 「現在価格」は最新の `domain_checks` をそのまま使う。Watchlist を開いただけで DNS・RDAP は
 * 引かない（訪問だけで RDAP の日次予算を食い潰さないため。再確認は `npm run check:domains`
 * と収集パイプラインの仕事）。まだ再確認されていない行は `current: null` で返し、
 * 画面側が「未再確認」と表示する。
 *
 * サーバー側専用（`@/lib/db` に届くのでクライアント部品からは import しない）。
 */
import type { Db } from '@/lib/db/client';
import { getKeywordBySlug, getLatestCheck, getWatchlistHistory, listWatchlist, slugify } from '@/lib/db/repos';
import type { Availability, Premium } from '@/lib/db/types';

export interface WatchlistPricePoint {
  checkedAt: string;
  registrationPrice: number | null;
  renewalPrice: number | null;
  availability: Availability | null;
  premium: Premium | null;
}

export interface WatchlistCurrentCheck {
  registrationPrice: number | null;
  renewalPrice: number | null;
  currency: string | null;
  availability: Availability;
  premium: Premium;
  priceSource: string | null;
  checkedAt: string;
}

export interface WatchlistItem {
  id: number;
  keyword: string;
  /** キーワード詳細が DB にあるときだけ slug を返す（無い語にリンクを張らない）。 */
  keywordSlug: string | null;
  domain: string;
  addedAt: string;
  foundRegistrationPrice: number | null;
  foundRenewalPrice: number | null;
  foundCurrency: string | null;
  trendScore: number | null;
  opportunityScore: number | null;
  note: string | null;
  /** 最新の `domain_checks`。追加後まだ再確認されていなければ null。 */
  current: WatchlistCurrentCheck | null;
  history: WatchlistPricePoint[];
}

/**
 * 差分に使う登録価格の組。
 *
 * 通貨が違う 2 つの数値を引き算しても意味が無いので、その場合は比較しない（`—` になる）。
 * 再確認がまだなら現在価格を null のままにする。`formatDiff` は「片方でも取れなければ `—`」
 * なので、0 円差（値動き無しの確認済み）と未確認が混ざらない。
 */
export function comparableRegistrationPrices(item: WatchlistItem): { current: number | null; found: number | null } {
  const found = item.foundRegistrationPrice;
  if (item.current === null) return { current: null, found };
  const foundCurrency = item.foundCurrency ?? 'USD';
  const currentCurrency = item.current.currency ?? 'USD';
  if (foundCurrency !== currentCurrency) return { current: null, found };
  return { current: item.current.registrationPrice, found };
}

export function buildWatchlistView(db: Db): WatchlistItem[] {
  return listWatchlist(db).map((row) => {
    const latest = getLatestCheck(db, row.domain);
    const slug = slugify(row.keyword);
    return {
      id: row.id,
      keyword: row.keyword,
      keywordSlug: slug && getKeywordBySlug(db, slug) ? slug : null,
      domain: row.domain,
      addedAt: row.added_at,
      foundRegistrationPrice: row.found_registration_price,
      foundRenewalPrice: row.found_renewal_price,
      foundCurrency: row.found_currency,
      trendScore: row.trend_score,
      opportunityScore: row.opportunity_score,
      note: row.note,
      current: latest
        ? {
            registrationPrice: latest.registration_price,
            renewalPrice: latest.renewal_price,
            currency: latest.currency,
            availability: latest.availability,
            premium: latest.premium,
            priceSource: latest.price_source,
            checkedAt: latest.checked_at,
          }
        : null,
      history: getWatchlistHistory(db, row.id).map((point) => ({
        checkedAt: point.checked_at,
        registrationPrice: point.registration_price,
        renewalPrice: point.renewal_price,
        availability: point.availability,
        premium: point.premium,
      })),
    };
  });
}
