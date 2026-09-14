import type { Db } from '../client';
import type { RawItemInput, RawItemRow, SourceId } from '../types';

/** (source, external_id) で upsert。同じアイテムを何度収穫しても増えない。 */
export function upsertRawItems(db: Db, items: RawItemInput[]): number {
  const stmt = db.prepare(
    `INSERT INTO raw_items(source, external_id, title, url, created_at, score, run_id)
     VALUES(@source, @external_id, @title, @url, @created_at, @score, @run_id)
     ON CONFLICT(source, external_id) DO UPDATE SET
       title = excluded.title, url = excluded.url, score = excluded.score, run_id = excluded.run_id`,
  );
  const tx = db.transaction((rows: RawItemInput[]) => {
    for (const r of rows) stmt.run(r);
  });
  tx(items);
  return items.length;
}

export function listRawItemsForRun(db: Db, runId: number): RawItemRow[] {
  return db.prepare(`SELECT * FROM raw_items WHERE run_id = ? ORDER BY id`).all(runId) as RawItemRow[];
}

export function countRawItemsBySource(db: Db, runId: number): Record<string, number> {
  const rows = db
    .prepare(`SELECT source, COUNT(*) AS n FROM raw_items WHERE run_id = ? GROUP BY source`)
    .all(runId) as { source: SourceId; n: number }[];
  return Object.fromEntries(rows.map((r) => [r.source, r.n]));
}
