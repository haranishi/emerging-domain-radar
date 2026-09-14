/** トレンド計測の型。ソースを足すときは TrendSource を実装するだけで済むようにする。 */
import type { Env } from '../env';
import type { SourceId, WindowId } from '../db/types';

export type { SourceId, WindowId };

export type WindowCounts = Record<WindowId, number>;

export interface MeasureResult {
  counts: WindowCounts;
  /** 件数が概算のとき true（HN の exhaustiveNbHits:false・GitHub の incomplete_results）。 */
  approximate: boolean;
  /** 人が確認できる検索 URL。Evidence の各行に必ず付ける。 */
  queryUrl: string;
  /** そのソースで観測できた最古の日付（ISO）。Novelty の材料。 */
  oldestSeenAt?: string;
}

export interface HarvestItem {
  source: SourceId;
  externalId: string;
  title: string;
  url: string | null;
  createdAt: string | null;
  score: number | null;
}

export interface TrendSource {
  id: SourceId;
  /** キーが無くても使えるソースは常に true。 */
  enabled(env: Env): boolean;
  /** 候補抽出用の最近のタイトル群。openalex は空配列（抽出には使わない）。 */
  harvest(now: Date): Promise<HarvestItem[]>;
  /** キーワードは必ず引用符付きフレーズで問い合わせる。 */
  measure(keyword: string, now: Date): Promise<MeasureResult>;
  evidenceUrl(keyword: string): string;
}

/** そのランでこのソースを諦める（予算切れ・恒久エラー）。パイプラインは他ソースで続行する。 */
export class SourceUnavailableError extends Error {
  constructor(
    readonly sourceId: SourceId,
    message: string,
  ) {
    super(message);
    this.name = 'SourceUnavailableError';
  }
}

export const emptyCounts = (): WindowCounts => ({ '7d': 0, prev7d: 0, '30d': 0, prev30d: 0 });
