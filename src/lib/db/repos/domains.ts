import type { Db } from '../client';
import type { DomainInput, DomainRow } from '../types';

export function upsertDomains(db: Db, rows: DomainInput[]): DomainRow[] {
  const stmt = db.prepare(
    `INSERT INTO domains(keyword_id, domain, generation_rule, domain_score, trademark_flag, excluded, exclusion_reason, created_run_id)
     VALUES(@keyword_id, @domain, @generation_rule, @domain_score, @trademark_flag, @excluded, @exclusion_reason, @run_id)
     ON CONFLICT(keyword_id, domain) DO UPDATE SET
       generation_rule = excluded.generation_rule, domain_score = excluded.domain_score,
       trademark_flag = excluded.trademark_flag, excluded = excluded.excluded,
       exclusion_reason = excluded.exclusion_reason`,
  );
  const tx = db.transaction((list: DomainInput[]) => {
    for (const r of list) {
      stmt.run({ ...r, excluded: r.excluded ? 1 : 0, exclusion_reason: r.exclusion_reason ?? null });
    }
  });
  tx(rows);
  if (rows.length === 0) return [];
  return listDomainsForKeyword(db, rows[0].keyword_id);
}

export function listDomainsForKeyword(db: Db, keywordId: number): DomainRow[] {
  return db
    .prepare(`SELECT * FROM domains WHERE keyword_id = ? AND excluded = 0 ORDER BY COALESCE(domain_score, -1) DESC, LENGTH(domain) ASC, domain ASC`)
    .all(keywordId) as DomainRow[];
}

export function listDomainsForRun(db: Db, runId: number): DomainRow[] {
  return db.prepare(`SELECT * FROM domains WHERE created_run_id = ? AND excluded = 0 ORDER BY keyword_id`).all(runId) as DomainRow[];
}

export function getDomainRow(db: Db, keywordId: number, domain: string): DomainRow | undefined {
  return db.prepare(`SELECT * FROM domains WHERE keyword_id = ? AND domain = ? AND excluded = 0`).get(keywordId, domain) as
    | DomainRow
    | undefined;
}
