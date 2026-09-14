/**
 * 日本語版 Wikipedia。記事の有無と 30 日ページビューを見る（research/04 §1.4）。
 *
 * 落とし穴: リダイレクトを解決しないと PV が桁違いにずれる
 * （「AIエージェント」55 PV / リダイレクト先「知的エージェント」841 PV）。
 * 必ず Action API で正規タイトルへ解決してから Pageviews を引く。
 * User-Agent は必須（空だと 403・実測）。http.ts が常に付ける。
 *
 * 日本語タイトルが分かっている場合（フェーズ3）:
 * en.wikipedia の langlinks から「バイブコーディング」のような日本語タイトルが取れたら、
 * `list=search` の正規化一致は使わずそのタイトルで直接存在判定する。
 * 英語フレーズとカタカナ表記は文字列として一致しないので、検索経由では拾えなかった
 * （＝日本語版に記事があるのに wikiJa=false になり Japan Gap が過大に出ていた）。
 */
import { httpGet } from '../../http';

const API = 'https://ja.wikipedia.org/w/api.php';
const PAGEVIEWS = 'https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia/all-access/user';

interface SearchResponse {
  query?: { search?: { title: string; pageid: number }[] };
}

interface InfoResponse {
  query?: {
    pages?: { title: string; missing?: boolean; pageid?: number }[];
    redirects?: { from: string; to: string }[];
  };
}

interface PageviewsResponse {
  items?: { views?: number }[];
}

/** 表記ゆれを潰した比較キー（大小・空白・中黒・ハイフンを無視）。 */
export function normalizeTitle(s: string): string {
  return s
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s　・\-_—–]/g, '');
}

export interface WikipediaResult {
  /** 日本語版に記事があるか。 */
  wikiJa: boolean;
  /** 正規化して一致した記事タイトル（リダイレクト解決後）。 */
  title: string | null;
  /** 直近 30 日のページビュー合計。 */
  pv30: number;
  queryUrl: string;
  ok: boolean;
}

function stamp(d: Date): string {
  return d.toISOString().slice(0, 10).replace(/-/g, '');
}

function infoUrlFor(title: string): string {
  const infoUrl = new URL(API);
  infoUrl.searchParams.set('action', 'query');
  infoUrl.searchParams.set('titles', title);
  infoUrl.searchParams.set('redirects', '1');
  infoUrl.searchParams.set('prop', 'info');
  infoUrl.searchParams.set('format', 'json');
  infoUrl.searchParams.set('formatversion', '2');
  return infoUrl.toString();
}

export interface WikipediaOptions {
  /** en.wikipedia langlinks で取れた日本語タイトル。あれば検索を飛ばしてこれで測る。 */
  jaTitle?: string | null;
}

export async function measureWikipedia(
  keyword: string,
  now: Date,
  opts: WikipediaOptions = {},
): Promise<WikipediaResult> {
  const jaTitle = opts.jaTitle && opts.jaTitle.trim() !== '' ? opts.jaTitle.trim() : null;
  const queryUrl = `https://ja.wikipedia.org/w/index.php?search=${encodeURIComponent(jaTitle ?? keyword)}`;

  let title: string;
  if (jaTitle !== null) {
    // 日本語タイトルが分かっているので存在判定は info 1 回で足りる（検索は挟まない）。
    const infoRes = await httpGet(infoUrlFor(jaTitle), { label: 'wikipedia' });
    if (!infoRes.ok) return { wikiJa: false, title: null, pv30: 0, queryUrl, ok: false };
    const page = infoRes.json<InfoResponse>().query?.pages?.[0];
    if (!page || page.missing) return { wikiJa: false, title: null, pv30: 0, queryUrl, ok: true };
    title = page.title;
  } else {
    const searchUrl = new URL(API);
    searchUrl.searchParams.set('action', 'query');
    searchUrl.searchParams.set('list', 'search');
    searchUrl.searchParams.set('srsearch', `"${keyword}"`);
    searchUrl.searchParams.set('srlimit', '3');
    searchUrl.searchParams.set('format', 'json');
    searchUrl.searchParams.set('utf8', '1');

    const res = await httpGet(searchUrl.toString(), { label: 'wikipedia' });
    if (!res.ok) return { wikiJa: false, title: null, pv30: 0, queryUrl, ok: false };

    const hits = res.json<SearchResponse>().query?.search ?? [];
    const target = normalizeTitle(keyword);
    const matched = hits.find((h) => normalizeTitle(h.title) === target);
    if (!matched) return { wikiJa: false, title: null, pv30: 0, queryUrl, ok: true };

    // リダイレクトを解決して正規タイトルにする（PV がずれるのを防ぐ）。
    const infoRes = await httpGet(infoUrlFor(matched.title), { label: 'wikipedia' });
    title = matched.title;
    if (infoRes.ok) {
      const page = infoRes.json<InfoResponse>().query?.pages?.[0];
      if (page && !page.missing) title = page.title;
    }
  }

  const from = stamp(new Date(now.getTime() - 30 * 86_400_000));
  const to = stamp(new Date(now.getTime() - 86_400_000));
  const pvUrl = `${PAGEVIEWS}/${encodeURIComponent(title)}/daily/${from}/${to}`;
  const pvRes = await httpGet(pvUrl, { label: 'wikipedia-pv', retries: 1 });
  let pv30 = 0;
  if (pvRes.ok) {
    for (const item of pvRes.json<PageviewsResponse>().items ?? []) pv30 += item.views ?? 0;
  }

  return { wikiJa: true, title, pv30, queryUrl, ok: true };
}
