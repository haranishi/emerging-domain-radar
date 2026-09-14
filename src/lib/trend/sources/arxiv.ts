/**
 * arXiv API。Atom XML を返すので `opensearch:totalResults` を読む。
 *
 * レート制限（research/03 §1）: 公式は「3 秒に 1 回」だが実測では 4 秒間隔でも累積で 429。
 * → http.ts のレート表で 1 req/5s、バックオフ 60/120/240 秒にしている。
 */
import { XMLParser } from 'fast-xml-parser';
import { httpGet } from '../../http';
import { evidenceUrl } from '../../domain/links';
import { arxivStamp, buildWindows, oldestBound, windowsFor } from '../windows';
import { emptyCounts, type HarvestItem, type MeasureResult, type TrendSource, type WindowCounts, type WindowId } from '../types';

const QUERY_URL = 'https://export.arxiv.org/api/query';
/** 1 回で読み切れる上限。超えたら窓ごとに件数だけ取り直す。 */
const PAGE_LIMIT = 200;

const parser = new XMLParser({ ignoreAttributes: false, isArray: (name) => name === 'entry' });

interface AtomEntry {
  id?: string;
  title?: string;
  published?: string;
  updated?: string;
  summary?: string;
}

interface AtomFeed {
  feed?: {
    'opensearch:totalResults'?: number | string | { '#text'?: number | string };
    entry?: AtomEntry[];
  };
}

function totalResultsOf(feed: AtomFeed): number {
  const raw = feed.feed?.['opensearch:totalResults'];
  const value = typeof raw === 'object' && raw !== null ? raw['#text'] : raw;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function cleanTitle(t: unknown): string {
  return typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '';
}

function buildUrl(searchQuery: string, params: Record<string, string>): string {
  const u = new URL(QUERY_URL);
  u.searchParams.set('search_query', searchQuery);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export const arxivSource: TrendSource = {
  id: 'arxiv',
  enabled() {
    return true;
  },

  async harvest(): Promise<HarvestItem[]> {
    const url = buildUrl('cat:cs.AI OR cat:cs.CL OR cat:cs.LG OR cat:cs.SE', {
      sortBy: 'submittedDate',
      sortOrder: 'descending',
      max_results: '300',
    });
    const res = await httpGet(url, { label: 'arxiv-harvest' });
    if (!res.ok) return [];
    const feed = parser.parse(res.body) as AtomFeed;
    const out: HarvestItem[] = [];
    for (const e of feed.feed?.entry ?? []) {
      const title = cleanTitle(e.title);
      if (!title || !e.id) continue;
      out.push({
        source: 'arxiv',
        externalId: String(e.id),
        title,
        url: String(e.id),
        createdAt: e.published ?? null,
        score: null,
      });
    }
    return out;
  },

  async measure(keyword: string, now: Date): Promise<MeasureResult> {
    const w = buildWindows(now);
    const range = `submittedDate:[${arxivStamp(oldestBound(now))} TO ${arxivStamp(now)}]`;
    const url = buildUrl(`all:"${keyword}" AND ${range}`, {
      max_results: String(PAGE_LIMIT),
      sortBy: 'submittedDate',
      start: '0',
    });
    const res = await httpGet(url, { label: 'arxiv-measure' });
    const counts: WindowCounts = emptyCounts();
    let approximate = false;
    let oldestSeenAt: string | undefined;

    // arXiv はたまに 500 を返す。取得失敗を「0 件」にすると Breadth が狂うので投げる。
    if (!res.ok) throw new Error(`arxiv measure failed: status=${res.status}`);

    {
      const feed = parser.parse(res.body) as AtomFeed;
      const total = totalResultsOf(feed);
      for (const e of feed.feed?.entry ?? []) {
        if (!e.published) continue;
        const ts = new Date(e.published);
        if (Number.isNaN(ts.getTime())) continue;
        for (const id of windowsFor(ts, w)) counts[id] += 1;
        const iso = ts.toISOString();
        if (!oldestSeenAt || iso < oldestSeenAt) oldestSeenAt = iso;
      }
      if (total > PAGE_LIMIT) {
        approximate = true;
        for (const id of ['7d', 'prev7d', '30d', 'prev30d'] as WindowId[]) {
          const r = w[id];
          const cu = buildUrl(`all:"${keyword}" AND submittedDate:[${arxivStamp(r.from)} TO ${arxivStamp(r.to)}]`, {
            max_results: '0',
          });
          const cr = await httpGet(cu, { label: 'arxiv-measure' });
          if (cr.ok) counts[id] = totalResultsOf(parser.parse(cr.body) as AtomFeed);
        }
      }
    }

    return { counts, approximate, queryUrl: this.evidenceUrl(keyword), oldestSeenAt };
  },

  evidenceUrl(keyword: string): string {
    return evidenceUrl('arxiv', keyword);
  },
};
