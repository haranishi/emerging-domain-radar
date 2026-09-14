import type { Db } from '../client';
import type { DomainCheckInput, DomainCheckRow } from '../types';

export function insertDomainCheck(db: Db, input: DomainCheckInput): number {
  const info = db
    .prepare(
      `INSERT INTO domain_checks(domain, checked_at, availability, availability_source, registration_price,
          renewal_price, currency, premium, price_source, raw_json, run_id)
       VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      input.domain,
      input.checked_at,
      input.availability,
      input.availability_source,
      input.registration_price,
      input.renewal_price,
      input.currency,
      input.premium,
      input.price_source,
      input.raw === undefined ? null : JSON.stringify(input.raw),
      input.run_id,
    );
  return Number(info.lastInsertRowid);
}

export function getLatestCheck(db: Db, domain: string): DomainCheckRow | undefined {
  return db
    .prepare(`SELECT * FROM domain_checks WHERE domain = ? ORDER BY checked_at DESC, id DESC LIMIT 1`)
    .get(domain) as DomainCheckRow | undefined;
}

/**
 * 負のキャッシュ（Verisign 規約対応）。`taken` は指定日数のあいだ再問い合わせしない。
 * `available` はランごとに再確認する。
 */
export function findFreshTakenCheck(db: Db, domain: string, maxAgeDays: number): DomainCheckRow | undefined {
  const cutoff = new Date(Date.now() - maxAgeDays * 86_400_000).toISOString();
  return db
    .prepare(
      `SELECT * FROM domain_checks WHERE domain = ? AND availability = 'taken' AND checked_at >= ?
       ORDER BY checked_at DESC, id DESC LIMIT 1`,
    )
    .get(domain, cutoff) as DomainCheckRow | undefined;
}
