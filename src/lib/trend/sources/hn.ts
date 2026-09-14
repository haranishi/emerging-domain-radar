/**
 * Hacker News（Algolia HN Search）。キー不要・10,000 req/h/IP。
 *
 * 落とし穴（research/02 §1.5）:
 *  - フレーズは必ずダブルクォートで囲む（外すと桁が変わる）
 *  - `nbHits` は高頻度語で概算になる → `exhaustiveNbHits` を必ず読む
 *  - 非公式ホスティングなので 1 日 1 回の取得に留める
 */
import { httpGet } from '../../http';
import { evidenceUrl } from '../../domain/links';
import { buildWindows, oldestBound, toEpochSec, windowsFor } from '../windows';
import { emptyCounts, type HarvestItem, type MeasureResult, type TrendSource, type WindowCounts } from '../types';

const BASE = 'https://hn.algolia.com/api/v1';
/** 1 回で取れる上限。これを超えたら窓ごとに件数だけ取り直す。 */
const PAGE_LIMIT = 1000;

interface AlgoliaHit {
  objectID: string;
  created_at?: string;
  created_at_i?: number;
  title?: string | null;
  story_title?: string | null;
  url?: string | null;
  points?: number | null;
}

interface AlgoliaResponse {
  nbHits: number;
  exhaustiveNbHits?: boolean;
  hits?: AlgoliaHit[];
}

function searchUrl(path: 'search' | 'search_by_date', params: Record<string, string>): string {
  const u = new URL(`${BASE}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export const hnSource: TrendSource = {
  id: 'hn',
  enabled() {
    return true;
  },

  async harvest(now: Date): Promise<HarvestItem[]> {
    const from = toEpochSec(new Date(now.getTime() - 7 * 86_400_000));
    const out: HarvestItem[] = [];
    for (const page of [0, 1]) {
      const url = searchUrl('search', {
        tags: 'story',
        numericFilters: `created_at_i>=${from},points>=20`,
        hitsPerPage: '200',
        page: String(page),
      });
      const res = await httpGet(url, { label: 'hn-harvest' });
      if (!res.ok) break;
      const body = res.json<AlgoliaResponse>();
      for (const h of body.hits ?? []) {
        const title = h.title ?? h.story_title ?? '';
        if (!title) continue;
        out.push({
          source: 'hn',
          externalId: h.objectID,
          title,
          url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
          createdAt: h.created_at ?? null,
          score: h.points ?? null,
        });
      }
      if ((body.hits ?? []).length < 200) break;
    }
    return out;
  },

  async measure(keyword: string, now: Date): Promise<MeasureResult> {
    const w = buildWindows(now);
    const from = toEpochSec(oldestBound(now));
    const to = toEpochSec(now);
    const url = searchUrl('search_by_date', {
      query: `"${keyword}"`,
      tags: '(story,comment)',
      numericFilters: `created_at_i>=${from},created_at_i<${to}`,
      hitsPerPage: String(PAGE_LIMIT),
    });
    const res = await httpGet(url, { label: 'hn-measure' });
    const counts: WindowCounts = emptyCounts();
    let approximate = false;
    let oldestSeenAt: string | undefined;

    // 取得失敗を「0 件」として返さない。0 件と失敗を混同すると Breadth の分母がずれる。
    if (!res.ok) throw new Error(`hn measure failed: status=${res.status}`);

    {
      const body = res.json<AlgoliaResponse>();
      approximate = body.exhaustiveNbHits === false;
      for (const h of body.hits ?? []) {
        if (typeof h.created_at_i !== 'number') continue;
        const ts = new Date(h.created_at_i * 1000);
        for (const id of windowsFor(ts, w)) counts[id] += 1;
        const iso = ts.toISOString();
        if (!oldestSeenAt || iso < oldestSeenAt) oldestSeenAt = iso;
      }
      // 1000 件を超える語は 1 リクエストで数え切れないので窓ごとに nbHits を取り直す。
      if (body.nbHits > PAGE_LIMIT) {
        approximate = true;
        for (const id of ['7d', 'prev7d', '30d', 'prev30d'] as const) {
          const r = w[id];
          const cu = searchUrl('search', {
            query: `"${keyword}"`,
            tags: '(story,comment)',
            numericFilters: `created_at_i>=${toEpochSec(r.from)},created_at_i<${toEpochSec(r.to)}`,
            hitsPerPage: '0',
          });
          const cr = await httpGet(cu, { label: 'hn-measure' });
          if (cr.ok) {
            const cb = cr.json<AlgoliaResponse>();
            counts[id] = cb.nbHits;
            if (cb.exhaustiveNbHits === false) approximate = true;
          }
        }
      }
    }

    return { counts, approximate, queryUrl: this.evidenceUrl(keyword), oldestSeenAt };
  },

  evidenceUrl(keyword: string): string {
    return evidenceUrl('hn', keyword);
  },
};

export interface HnOldestResult {
  oldestSeenAt: string | null;
  approximate: boolean;
}

/** Novelty 用。60 日より前の件数を調べ、ページング可能なら最終ページを最古とする。 */
export async function hnOldestBefore(keyword: string, now: Date): Promise<HnOldestResult> {
  const cutoff = toEpochSec(oldestBound(now));
  const url = searchUrl('search', {
    query: `"${keyword}"`,
    tags: '(story,comment)',
    hitsPerPage: '1',
    numericFilters: `created_at_i<${cutoff}`,
  });
  const res = await httpGet(url, { label: 'hn-novelty' });
  if (!res.ok) return { oldestSeenAt: null, approximate: false };
  const body = res.json<AlgoliaResponse>();
  if (body.nbHits === 0) return { oldestSeenAt: null, approximate: false };
  if (body.nbHits > PAGE_LIMIT) {
    return {
      oldestSeenAt: null,
      approximate: true,
    };
  }

  const oldestUrl = searchUrl('search', {
    query: `"${keyword}"`,
    tags: '(story,comment)',
    numericFilters: `created_at_i<${cutoff}`,
    page: String(body.nbHits - 1),
    hitsPerPage: '1',
  });
  const oldestRes = await httpGet(oldestUrl, { label: 'hn-novelty' });
  if (!oldestRes.ok) return { oldestSeenAt: null, approximate: false };
  const hit = (oldestRes.json<AlgoliaResponse>().hits ?? [])[0];
  const oldestSeenAt =
    typeof hit?.created_at_i === 'number'
      ? new Date(hit.created_at_i * 1000).toISOString()
      : hit?.created_at ?? null;
  return { oldestSeenAt, approximate: false };
}
