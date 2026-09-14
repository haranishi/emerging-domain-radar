import type { Db } from '../client';
import type { MetricInput, MetricRow, SourceId, WindowId } from '../types';

export function saveMetrics(db: Db, rows: MetricInput[]): void {
  const stmt = db.prepare(
    `INSERT INTO keyword_metrics(run_id, keyword_id, source, window, count, approximate, query_url, fetched_at)
     VALUES(@run_id, @keyword_id, @source, @window, @count, @approximate, @query_url, @fetched_at)
     ON CONFLICT(run_id, keyword_id, source, window) DO UPDATE SET
       count = excluded.count, approximate = excluded.approximate,
       query_url = excluded.query_url, fetched_at = excluded.fetched_at`,
  );
  const tx = db.transaction((list: MetricInput[]) => {
    for (const r of list) stmt.run({ ...r, approximate: r.approximate ? 1 : 0 });
  });
  tx(rows);
}

export function getMetricsForRun(db: Db, runId: number, keywordId?: number): MetricRow[] {
  if (keywordId === undefined) {
    return db.prepare(`SELECT * FROM keyword_metrics WHERE run_id = ? ORDER BY keyword_id, source, window`).all(runId) as MetricRow[];
  }
  return db
    .prepare(`SELECT * FROM keyword_metrics WHERE run_id = ? AND keyword_id = ? ORDER BY source, window`)
    .all(runId, keywordId) as MetricRow[];
}

/** source → window → count の入れ子に畳む（Evidence 表と正規化で使う）。 */
export function groupMetrics(rows: MetricRow[]): Record<string, Partial<Record<WindowId, MetricRow>>> {
  const out: Record<string, Partial<Record<WindowId, MetricRow>>> = {};
  for (const r of rows) {
    const src = r.source as SourceId;
    out[src] ??= {};
    out[src][r.window] = r;
  }
  return out;
}
