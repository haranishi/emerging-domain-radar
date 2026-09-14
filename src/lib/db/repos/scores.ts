import type { Db } from '../client';
import type { ScoreInput, ScoreRow } from '../types';

export function saveScore(db: Db, input: ScoreInput): void {
  db.prepare(
    `INSERT INTO keyword_scores(run_id, keyword_id, trend_score, novelty_score, japan_gap_score, status, fading,
        breadth, c30_units, g7, g30, breakdown_json)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(run_id, keyword_id) DO UPDATE SET
       trend_score = excluded.trend_score, novelty_score = excluded.novelty_score,
       japan_gap_score = excluded.japan_gap_score, status = excluded.status, fading = excluded.fading,
       breadth = excluded.breadth, c30_units = excluded.c30_units, g7 = excluded.g7, g30 = excluded.g30,
       breakdown_json = excluded.breakdown_json`,
  ).run(
    input.run_id,
    input.keyword_id,
    input.trend_score,
    input.novelty_score,
    input.japan_gap_score,
    input.status,
    input.fading ? 1 : 0,
    input.breadth,
    input.c30_units,
    input.g7,
    input.g30,
    JSON.stringify(input.breakdown ?? {}),
  );
}

export function getScoresForRun(db: Db, runId: number): ScoreRow[] {
  return db.prepare(`SELECT * FROM keyword_scores WHERE run_id = ?`).all(runId) as ScoreRow[];
}

export function getScore(db: Db, runId: number, keywordId: number): ScoreRow | undefined {
  return db.prepare(`SELECT * FROM keyword_scores WHERE run_id = ? AND keyword_id = ?`).get(runId, keywordId) as
    | ScoreRow
    | undefined;
}
