import type { Db } from '../client';
import { nowIso } from '../client';
import type { RunRow } from '../types';

export function startRun(db: Db, notes?: string): number {
  const info = db
    .prepare(`INSERT INTO runs(started_at, status, notes) VALUES(?, 'running', ?)`)
    .run(nowIso(), notes ?? null);
  return Number(info.lastInsertRowid);
}

export function finishRun(
  db: Db,
  runId: number,
  status: 'completed' | 'failed' | 'partial',
  statsJson: unknown,
  notes?: string,
): void {
  db.prepare(`UPDATE runs SET finished_at = ?, status = ?, stats_json = ?, notes = COALESCE(?, notes) WHERE id = ?`).run(
    nowIso(),
    status,
    JSON.stringify(statsJson ?? {}),
    notes ?? null,
    runId,
  );
}

/** ソース単位の失敗などを追記する（1 行 1 メモ）。 */
export function appendRunNote(db: Db, runId: number, note: string): void {
  const row = db.prepare(`SELECT notes FROM runs WHERE id = ?`).get(runId) as { notes: string | null } | undefined;
  const next = row?.notes ? `${row.notes}\n${note}` : note;
  db.prepare(`UPDATE runs SET notes = ? WHERE id = ?`).run(next, runId);
}

export function getRun(db: Db, runId: number): RunRow | undefined {
  return db.prepare(`SELECT * FROM runs WHERE id = ?`).get(runId) as RunRow | undefined;
}

/** ダッシュボードが表示する「最新の完了ラン」。 */
export function getLatestCompletedRun(db: Db): RunRow | undefined {
  return db
    .prepare(`SELECT * FROM runs WHERE status IN ('completed','partial') ORDER BY id DESC LIMIT 1`)
    .get() as RunRow | undefined;
}

export function getLatestRun(db: Db): RunRow | undefined {
  return db.prepare(`SELECT * FROM runs ORDER BY id DESC LIMIT 1`).get() as RunRow | undefined;
}
