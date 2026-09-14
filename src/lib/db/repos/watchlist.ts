import type { Db } from '../client';
import { nowIso } from '../client';
import type { Availability, Premium, WatchlistHistoryRow, WatchlistInput, WatchlistRow } from '../types';

/** 書き込み先はローカル DB だけ。購入・予約とは無関係の「メモ」機能。 */
export function addToWatchlist(db: Db, input: WatchlistInput): number {
  db
    .prepare(
      `INSERT INTO watchlist(keyword, domain, added_at, found_registration_price, found_renewal_price,
          found_currency, trend_score, opportunity_score, note)
       VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(domain) DO UPDATE SET keyword = excluded.keyword, trend_score = excluded.trend_score,
          opportunity_score = excluded.opportunity_score, note = COALESCE(excluded.note, watchlist.note)`,
    )
    .run(
      input.keyword,
      input.domain,
      nowIso(),
      input.found_registration_price,
      input.found_renewal_price,
      input.found_currency,
      input.trend_score,
      input.opportunity_score,
      input.note ?? null,
    );
  // 戻り値は必ず domain で読み戻す。`ON CONFLICT DO UPDATE` を通った回は INSERT が
  // 起きないので `last_insert_rowid()` はこの接続で直前に挿入した**別の行**の id を返す
  // （0 にはならないため「0 なら読み戻す」では拾えない）。それを鍵にすると、同じドメインを
  // もう一度追加したときに他の行の価格履歴が生えたり、他の行を消したりする。
  // domain は UNIQUE なので、読み戻しは 1 行に決まる。
  const row = db.prepare(`SELECT id FROM watchlist WHERE domain = ?`).get(input.domain) as
    | { id: number }
    | undefined;
  if (!row) throw new Error(`watchlist の行を保存できませんでした: ${input.domain}`);
  return row.id;
}

export function removeFromWatchlist(db: Db, domain: string): boolean {
  const row = db.prepare(`SELECT id FROM watchlist WHERE domain = ?`).get(domain) as { id: number } | undefined;
  if (!row) return false;
  db.prepare(`DELETE FROM watchlist_price_history WHERE watchlist_id = ?`).run(row.id);
  db.prepare(`DELETE FROM watchlist WHERE id = ?`).run(row.id);
  return true;
}

export function listWatchlist(db: Db): WatchlistRow[] {
  return db.prepare(`SELECT * FROM watchlist ORDER BY added_at DESC, id DESC`).all() as WatchlistRow[];
}

export function appendWatchlistPrice(
  db: Db,
  watchlistId: number,
  row: {
    registration_price: number | null;
    renewal_price: number | null;
    availability: Availability | null;
    premium: Premium | null;
  },
): void {
  db.prepare(
    `INSERT INTO watchlist_price_history(watchlist_id, checked_at, registration_price, renewal_price, availability, premium)
     VALUES(?,?,?,?,?,?)`,
  ).run(watchlistId, nowIso(), row.registration_price, row.renewal_price, row.availability, row.premium);
}

export function getWatchlistHistory(db: Db, watchlistId: number): WatchlistHistoryRow[] {
  return db
    .prepare(`SELECT * FROM watchlist_price_history WHERE watchlist_id = ? ORDER BY checked_at ASC, id ASC`)
    .all(watchlistId) as WatchlistHistoryRow[];
}
