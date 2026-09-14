import type { TrendSource } from '../types';
import { hnSource } from './hn';
import { githubSource } from './github';
import { arxivSource } from './arxiv';
import { openalexSource } from './openalex';

/** 順序は計測の順序でもある（1 キーワードにつき全ソース → 次のキーワード）。 */
export const TREND_SOURCES: readonly TrendSource[] = [hnSource, githubSource, arxivSource, openalexSource];

/** harvest（候補抽出用のタイトル収穫）に使うソース。openalex は含めない。 */
export const HARVEST_SOURCES: readonly TrendSource[] = [hnSource, githubSource, arxivSource];

export { hnSource, githubSource, arxivSource, openalexSource };
