import type { Db } from '../client';
import { nowIso } from '../client';
import type { FxRateInput, FxRateRow } from '../types';

export function saveFxRate(db: Db, input: FxRateInput): number {
  const info = db
    .prepare(
      `INSERT INTO fx_rates(base, quote, rate, as_of, source, providers_json, fetched_at) VALUES(?,?,?,?,?,?,?)`,
    )
    .run(
      input.base,
      input.quote,
      input.rate,
      input.as_of,
      input.source,
      input.providers === undefined ? null : JSON.stringify(input.providers),
      nowIso(),
    );
  return Number(info.lastInsertRowid);
}

export function getLatestFxRate(db: Db, base = 'USD', quote = 'JPY'): FxRateRow | undefined {
  return db
    .prepare(`SELECT * FROM fx_rates WHERE base = ? AND quote = ? ORDER BY fetched_at DESC, id DESC LIMIT 1`)
    .get(base, quote) as FxRateRow | undefined;
}

/** 24 時間キャッシュ。期限切れなら undefined を返して再取得させる。 */
export function getFreshFxRate(
  db: Db,
  base = 'USD',
  quote = 'JPY',
  maxAgeMs = 24 * 3600 * 1000,
): FxRateRow | undefined {
  const row = getLatestFxRate(db, base, quote);
  if (!row) return undefined;
  const age = Date.now() - Date.parse(row.fetched_at);
  return Number.isFinite(age) && age <= maxAgeMs ? row : undefined;
}
