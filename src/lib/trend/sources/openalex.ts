/**
 * OpenAlex works の件数。
 *
 * 2026-02-24 の変更（research/03 §2）が前提:
 *  - キー無しは $0.10/日、無料キーで $1/日。`mailto` を付けても予算は変わらない
 *  - `group_by=publication_year` を付けると 1 件数あたり $0.001 → $0.0001（1/10）。
 *    ただし料金ページに明文化されていない挙動なので、`x-ratelimit-cost-usd` を毎回記録する
 *  - 引用符でフレーズ完全一致にする（付けないと 5.6 倍に膨らむ）
 *  - 予算切れ（429）は以降このソースを諦めて他ソースで続行する
 */
import { httpGet } from '../../http';
import { getEnv } from '../../env';
import { evidenceUrl } from '../../domain/links';
import { buildWindows, dateStamp } from '../windows';
import {
  emptyCounts,
  SourceUnavailableError,
  type HarvestItem,
  type MeasureResult,
  type TrendSource,
  type WindowCounts,
  type WindowId,
} from '../types';

const WORKS = 'https://api.openalex.org/works';

interface WorksResponse {
  meta?: { count?: number };
}

let unavailableReason: string | null = null;

export function resetOpenAlexState(): void {
  unavailableReason = null;
}

export function openAlexUnavailableReason(): string | null {
  return unavailableReason;
}

function buildUrl(keyword: string, from: Date, to: Date): string {
  const env = getEnv();
  const u = new URL(WORKS);
  u.searchParams.set(
    'filter',
    `title_and_abstract.search:"${keyword}",from_publication_date:${dateStamp(from)},to_publication_date:${dateStamp(to)}`,
  );
  u.searchParams.set('group_by', 'publication_year');
  if (env.OPENALEX_MAILTO) u.searchParams.set('mailto', env.OPENALEX_MAILTO);
  if (env.OPENALEX_API_KEY) u.searchParams.set('api_key', env.OPENALEX_API_KEY);
  return u.toString();
}

export const openalexSource: TrendSource = {
  id: 'openalex',
  enabled() {
    return true;
  },

  /** 候補抽出には使わない（件数計測専用）。 */
  async harvest(): Promise<HarvestItem[]> {
    return [];
  },

  async measure(keyword: string, now: Date): Promise<MeasureResult> {
    if (unavailableReason) throw new SourceUnavailableError('openalex', unavailableReason);
    const w = buildWindows(now);
    const counts: WindowCounts = emptyCounts();
    let ok = 0;
    for (const id of ['7d', 'prev7d', '30d', 'prev30d'] as WindowId[]) {
      const r = w[id];
      // 429 は予算切れなので再試行しない（待っても回復しない・UTC 深夜 0 時リセット）。
      const res = await httpGet(buildUrl(keyword, r.from, r.to), { label: 'openalex-measure', retries: 0 });
      if (res.status === 429) {
        unavailableReason = '日次予算切れ（429）';
        throw new SourceUnavailableError('openalex', unavailableReason);
      }
      if (!res.ok) continue;
      ok += 1;
      counts[id] = res.json<WorksResponse>().meta?.count ?? 0;
    }
    if (ok < 4) throw new Error(`openalex measure failed: ${4 - ok} unavailable windows`);
    return { counts, approximate: false, queryUrl: this.evidenceUrl(keyword) };
  },

  evidenceUrl(keyword: string): string {
    return evidenceUrl('openalex', keyword);
  },
};
