import type { Db } from '../client';
import type { OpportunityInput, OpportunityRow } from '../types';

export function saveOpportunities(db: Db, rows: OpportunityInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO opportunity(run_id, keyword_id, domain_id, score, breakdown_json) VALUES(?,?,?,?,?)`,
  );
  const tx = db.transaction((list: OpportunityInput[]) => {
    for (const r of list) {
      stmt.run(r.run_id, r.keyword_id, r.domain_id, r.score, JSON.stringify(r.breakdown ?? {}));
    }
  });
  tx(rows);
}

export function getOpportunitiesForRun(db: Db, runId: number): OpportunityRow[] {
  return db.prepare(`SELECT * FROM opportunity WHERE run_id = ? ORDER BY score DESC`).all(runId) as OpportunityRow[];
}

/** キーワードの Opportunity は所属する空きドメインの最大値（architecture §5.4）。 */
export function getKeywordOpportunity(db: Db, runId: number, keywordId: number): OpportunityRow | undefined {
  return db
    .prepare(`SELECT * FROM opportunity WHERE run_id = ? AND keyword_id = ? ORDER BY score DESC LIMIT 1`)
    .get(runId, keywordId) as OpportunityRow | undefined;
}

/** ドメイン 1 件の Opportunity（通知条件の判定はドメイン単位で行う）。 */
export function getDomainOpportunity(db: Db, runId: number, domainId: number): OpportunityRow | undefined {
  return db
    .prepare(`SELECT * FROM opportunity WHERE run_id = ? AND domain_id = ? ORDER BY score DESC LIMIT 1`)
    .get(runId, domainId) as OpportunityRow | undefined;
}
