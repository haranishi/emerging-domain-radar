/**
 * 計測窓。ラン開始時刻 `now`（UTC）を基準に固定する（architecture §5.1）。
 *   7d      = [now-7d,  now)
 *   prev7d  = [now-14d, now-7d)
 *   30d     = [now-30d, now)
 *   prev30d = [now-60d, now-30d)
 * 30d と 7d は重なる（30d は「直近 30 日の総量」を測るため）。
 */
import type { WindowId } from './types';

const DAY_MS = 86_400_000;

export interface Range {
  from: Date;
  to: Date;
}

export type Windows = Record<WindowId, Range>;

export function buildWindows(now: Date): Windows {
  const t = now.getTime();
  return {
    '7d': { from: new Date(t - 7 * DAY_MS), to: new Date(t) },
    prev7d: { from: new Date(t - 14 * DAY_MS), to: new Date(t - 7 * DAY_MS) },
    '30d': { from: new Date(t - 30 * DAY_MS), to: new Date(t) },
    prev30d: { from: new Date(t - 60 * DAY_MS), to: new Date(t - 30 * DAY_MS) },
  };
}

/** 60 日窓の下端（1 回のリクエストで全部取るソース用）。 */
export function oldestBound(now: Date): Date {
  return new Date(now.getTime() - 60 * DAY_MS);
}

export const WINDOW_IDS: readonly WindowId[] = ['7d', 'prev7d', '30d', 'prev30d'];

export const toEpochSec = (d: Date): number => Math.floor(d.getTime() / 1000);

/** 1 件のタイムスタンプが入る窓をすべて返す（7d は 30d にも入る）。 */
export function windowsFor(ts: Date, w: Windows): WindowId[] {
  const out: WindowId[] = [];
  for (const id of WINDOW_IDS) {
    const r = w[id];
    if (ts >= r.from && ts < r.to) out.push(id);
  }
  return out;
}

/** arXiv の submittedDate 用 `YYYYMMDDHHMM`（GMT・分単位）。 */
export function arxivStamp(d: Date): string {
  const iso = d.toISOString();
  return `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}${iso.slice(11, 13)}${iso.slice(14, 16)}`;
}

/** GitHub の created: 用 ISO8601 タイムスタンプ（秒まで・Z 付き）。 */
export function githubStamp(d: Date): string {
  return `${d.toISOString().slice(0, 19)}Z`;
}

/** OpenAlex / Qiita 用 `YYYY-MM-DD`。 */
export function dateStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}
