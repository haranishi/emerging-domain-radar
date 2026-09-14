/**
 * GitHub Search repositories の `total_count`。
 *
 * 決めごと（research/02 §2.6）:
 *  - 既定スコープを固定する。`in:readme` は使わない（付けると 9 倍になり、途中で変えると指標が壊れる）
 *  - fine-grained PAT は権限ゼロで足りる。あればレート 10/min → 30/min
 *  - `incomplete_results: true` は件数が信用できない → approximate
 */
import { httpGet } from '../../http';
import { getEnv } from '../../env';
import { evidenceUrl } from '../../domain/links';
import { buildWindows, githubStamp } from '../windows';
import { emptyCounts, type HarvestItem, type MeasureResult, type TrendSource, type WindowCounts, type WindowId } from '../types';

const SEARCH_REPOS = 'https://api.github.com/search/repositories';

/** harvest で回すトピック（新語が出やすい領域に固定）。 */
const HARVEST_TOPICS = ['ai', 'llm', 'agents', 'developer-tools', 'mcp'] as const;

interface RepoSearchResponse {
  total_count?: number;
  incomplete_results?: boolean;
  items?: { id: number; full_name?: string; description?: string | null; html_url?: string; created_at?: string; stargazers_count?: number }[];
}

function headers(): Record<string, string> {
  const env = getEnv();
  const h: Record<string, string> = {
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
  };
  if (env.GITHUB_TOKEN) h.authorization = `Bearer ${env.GITHUB_TOKEN}`;
  return h;
}

function url(q: string, extra: Record<string, string> = {}): string {
  const u = new URL(SEARCH_REPOS);
  u.searchParams.set('q', q);
  for (const [k, v] of Object.entries(extra)) u.searchParams.set(k, v);
  return u.toString();
}

export const githubSource: TrendSource = {
  id: 'github',
  enabled() {
    return true;
  },

  async harvest(now: Date): Promise<HarvestItem[]> {
    const from = new Date(now.getTime() - 14 * 86_400_000).toISOString().slice(0, 10);
    const out: HarvestItem[] = [];
    for (const topic of HARVEST_TOPICS) {
      const res = await httpGet(url(`created:>=${from} stars:>=10 topic:${topic}`, { sort: 'stars', order: 'desc', per_page: '100' }), {
        label: 'github-harvest',
        headers: headers(),
      });
      if (!res.ok) continue;
      const body = res.json<RepoSearchResponse>();
      for (const item of body.items ?? []) {
        const title = [item.full_name, item.description].filter(Boolean).join(' — ');
        if (!title) continue;
        out.push({
          source: 'github',
          externalId: String(item.id),
          title,
          url: item.html_url ?? null,
          createdAt: item.created_at ?? null,
          score: item.stargazers_count ?? null,
        });
      }
    }
    return out;
  },

  async measure(keyword: string, now: Date): Promise<MeasureResult> {
    const w = buildWindows(now);
    const counts: WindowCounts = emptyCounts();
    let approximate = false;
    let ok = 0;
    for (const id of ['7d', 'prev7d', '30d', 'prev30d'] as WindowId[]) {
      const r = w[id];
      const q = `"${keyword}" created:${githubStamp(r.from)}..${githubStamp(r.to)}`;
      const res = await httpGet(url(q, { per_page: '1' }), { label: 'github-measure', headers: headers() });
      if (!res.ok) continue;
      ok += 1;
      const body = res.json<RepoSearchResponse>();
      counts[id] = body.total_count ?? 0;
      if (body.incomplete_results) approximate = true;
    }
    // 1 窓でも失敗したソースは 0 件で補わず、metrics 全体を保存しない。
    if (ok < 4) throw new Error(`github measure failed: ${4 - ok} unavailable windows`);
    return { counts, approximate, queryUrl: this.evidenceUrl(keyword) };
  },

  evidenceUrl(keyword: string): string {
    return evidenceUrl('github', keyword);
  },
};
