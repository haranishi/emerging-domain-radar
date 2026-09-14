import type { Db } from '../client';
import { nowIso } from '../client';
import type { TldPriceRow } from '../types';

export function upsertTldPrices(db: Db, rows: Omit<TldPriceRow, 'fetched_at'>[]): void {
  const stmt = db.prepare(
    `INSERT INTO tld_prices(tld, registration, renewal, transfer, currency, source, fetched_at)
     VALUES(@tld, @registration, @renewal, @transfer, @currency, @source, @fetched_at)
     ON CONFLICT(tld) DO UPDATE SET registration = excluded.registration, renewal = excluded.renewal,
       transfer = excluded.transfer, currency = excluded.currency, source = excluded.source,
       fetched_at = excluded.fetched_at`,
  );
  const fetched_at = nowIso();
  const tx = db.transaction((list: Omit<TldPriceRow, 'fetched_at'>[]) => {
    for (const r of list) stmt.run({ ...r, fetched_at });
  });
  tx(rows);
}

export function getTldPrice(db: Db, tld: string): TldPriceRow | undefined {
  return db.prepare(`SELECT * FROM tld_prices WHERE tld = ?`).get(tld) as TldPriceRow | undefined;
}

/** 24h キャッシュの判定。期限切れ・未取得なら undefined。 */
export function getFreshTldPrice(db: Db, tld: string, maxAgeMs = 24 * 3600 * 1000): TldPriceRow | undefined {
  const row = getTldPrice(db, tld);
  if (!row?.fetched_at) return undefined;
  const age = Date.now() - Date.parse(row.fetched_at);
  return Number.isFinite(age) && age <= maxAgeMs ? row : undefined;
}
