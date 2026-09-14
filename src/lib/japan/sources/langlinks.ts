/**
 * 英語キーワードの「日本語での呼び方」を en.wikipedia の langlinks から引く。
 *
 * なぜ必要か（2026-09-03 の実測）:
 * `large language models` の Japan Gap が 99 になった。日本語圏では「大規模言語モデル」と
 * 書かれるので、英語フレーズのまま Qiita と ja.wikipedia に投げると日本語の言及が 0 に見える。
 * en.wikipedia の記事には日本語版へのリンク（langlinks）が付いているので、
 * 1 リクエストで「その語の日本語タイトル」が取れる。翻訳 API も辞書も要らない。
 *
 * 限界:
 *  - Wikipedia に記事が無い新語は取れない（＝新語ほど取れない）。取れなければ英語のまま測る。
 *  - 記事名と実務での呼び方がずれることがある（例: 記事は正式名、現場は略称）。
 *  - タイトルは「文中の大文字小文字」規則で、先頭だけ大文字（`Vibe coding`）。
 *    小文字のキーワードをそのまま投げれば MediaWiki 側が先頭を大文字に正規化する。
 *
 * リダイレクト解決は採用しない:
 * `redirects=1` を付けているので、記事が無い語は en.wikipedia 側で**別の記事**に
 * 飛ばされることがある（実例: `World model` → `Mental model` → 日本語「メンタルモデル」）。
 * これを日本語訳として使うと、測っている語と違う語の件数で Japan Gap が動く。
 * リダイレクトが起きたうえに解決後のタイトルが要求キーワードと一致しないときは、
 * 「訳が分からない」として `null` を返す（誤訳より不明のほうが害が小さい）。
 * 大文字小文字と空白/ハイフンの差はリダイレクトでも同じ語なので、正規化して比べる。
 */
import { httpGet } from '../../http';

const API = 'https://en.wikipedia.org/w/api.php';

/** format=json（formatversion 1）の応答。pages は pageid をキーにした連想配列。 */
interface LangLinksResponse {
  query?: {
    /** `redirects=1` で別記事に飛んだときだけ入る。 */
    redirects?: { from?: string; to?: string }[];
    pages?: Record<string, {
      title?: string;
      missing?: string | boolean;
      langlinks?: { lang?: string; '*'?: string; title?: string }[];
    }>;
  };
}

/** 比較用の正規化。小文字化し、空白・ハイフン・アンダースコアを 1 つの空白に畳む。 */
export function normalizeTitleKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s_\-\u2010-\u2015]+/g, ' ')
    .trim();
}

export function langlinksUrl(keyword: string): string {
  const u = new URL(API);
  u.searchParams.set('action', 'query');
  u.searchParams.set('titles', keyword);
  u.searchParams.set('prop', 'langlinks');
  u.searchParams.set('lllang', 'ja');
  u.searchParams.set('redirects', '1');
  u.searchParams.set('format', 'json');
  return u.toString();
}

export interface JaEquivalent {
  /** 日本語版の記事タイトル。取れなければ null（画面は「JP equivalent unknown」と出す）。 */
  title: string | null;
  /** 英語版の記事タイトル（リダイレクト解決後）。参考情報。 */
  enTitle: string | null;
  /** HTTP が成功したか。false は「無い」ではなく「分からない」。 */
  ok: boolean;
}

/**
 * キーワードの日本語タイトルを 1 リクエストで引く。
 * 失敗しても throw しない（Japan Gap は英語フレーズだけでも出せる）。
 */
export async function fetchJaEquivalent(keyword: string): Promise<JaEquivalent> {
  let res;
  try {
    res = await httpGet(langlinksUrl(keyword), { label: 'wikipedia-langlinks', retries: 1 });
  } catch {
    return { title: null, enTitle: null, ok: false };
  }
  if (!res.ok) return { title: null, enTitle: null, ok: false };

  let query: LangLinksResponse['query'];
  try {
    query = res.json<LangLinksResponse>().query;
  } catch {
    return { title: null, enTitle: null, ok: false };
  }
  const redirected = (query?.redirects ?? []).length > 0;
  for (const page of Object.values(query?.pages ?? {})) {
    if (page.missing !== undefined) continue;
    const enTitle = page.title ?? null;
    // リダイレクトで別の語に着地したら訳として使わない（上のコメント参照）。
    if (redirected && (enTitle === null || normalizeTitleKey(enTitle) !== normalizeTitleKey(keyword))) {
      return { title: null, enTitle, ok: true };
    }
    const link = (page.langlinks ?? []).find((l) => l.lang === undefined || l.lang === 'ja');
    const title = link?.['*'] ?? link?.title ?? null;
    return { title: title && title.trim() !== '' ? title.trim() : null, enTitle, ok: true };
  }
  return { title: null, enTitle: null, ok: true };
}
