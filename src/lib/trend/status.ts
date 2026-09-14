/**
 * Status の判定。閾値は docs/03_architecture.md §5.4 の確定値（1 か所の定数）。
 *
 * 判定順（最初にマッチしたものを採用）:
 *   S === 0                    → Noise（ランから除外・保存しない）
 *   c30 >= 500                 → Mainstream
 *   c30 >= 100 || g30 >= 3.0   → Trending
 *   c30 >= 25 && g30 >= 1.5    → Rising
 *   c30 >= 5  && g30 >= 1.3    → Emerging
 *   それ以外                    → Early
 *
 * research/04 §3.5 では Fading を Status の 1 つとして扱っていたが、architecture では
 * 5 分類を維持したまま別フラグにする（UI は小さなタグで出す）。
 */
import type { Status } from '../db/types';
import { g30Of } from './score';

export type { Status };
export type StatusOrNoise = Status | 'Noise';

export const THRESHOLDS = {
  mainstream: 500,
  trending: 100,
  rising: 25,
  emerging: 5,
  gTrending: 3.0,
  gRising: 1.5,
  gEmerging: 1.3,
  gFading: 0.7,
} as const;

export interface StatusResult {
  status: StatusOrNoise;
  /** ピーク済み（30 日で 3 割以上減）。Status の 5 分類とは独立。 */
  fading: boolean;
  g30: number;
}

export function classifyStatus(c30: number, c30prev: number, S: number): StatusResult {
  const g30 = g30Of(c30, c30prev);
  const fading = c30 >= THRESHOLDS.rising && g30 < THRESHOLDS.gFading;

  let status: StatusOrNoise;
  if (S === 0) status = 'Noise';
  else if (c30 >= THRESHOLDS.mainstream) status = 'Mainstream';
  else if (c30 >= THRESHOLDS.trending || g30 >= THRESHOLDS.gTrending) status = 'Trending';
  else if (c30 >= THRESHOLDS.rising && g30 >= THRESHOLDS.gRising) status = 'Rising';
  else if (c30 >= THRESHOLDS.emerging && g30 >= THRESHOLDS.gEmerging) status = 'Emerging';
  else status = 'Early';

  return { status, fading: status === 'Noise' ? false : fading, g30 };
}

export const isNoise = (s: StatusOrNoise): s is 'Noise' => s === 'Noise';
