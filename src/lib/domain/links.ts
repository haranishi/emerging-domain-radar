/**
 * 「公式サイトで確認」用の URL を組む純関数だけ。fetch もしないし副作用も無い。
 *
 * ここで作るのは *検索・情報照会* のリンクだけで、カート・購入・アフィリエイトの
 * URL は作らない（docs/01_requirements.md §3）。
 */

export interface OfficialLink {
  label: string;
  url: string;
}

/** レジストラの検索画面と ICANN Lookup。ユーザーがここから先を手動で判断する。 */
export function officialLinks(domain: string): OfficialLink[] {
  const d = encodeURIComponent(domain);
  return [
    { label: 'Porkbun', url: `https://porkbun.com/checkout/search?q=${d}` },
    { label: 'Namecheap', url: `https://www.namecheap.com/domains/registration/results/?domain=${d}` },
    { label: 'ICANN Lookup', url: `https://lookup.icann.org/en/lookup?name=${d}` },
  ];
}

/**
 * 商標の手動確認リンク（research/04 §4）。
 * リンク先は SPA なので検索が自動実行されないことがある。UI にその旨を注記する。
 */
export function trademarkSearchLinks(keyword: string): OfficialLink[] {
  const k = encodeURIComponent(keyword);
  return [
    { label: 'USPTO', url: `https://tmsearch.uspto.gov/search/search-results/${k}` },
    {
      label: 'WIPO Global Brand DB',
      url: `https://branddb.wipo.int/en/quicksearch/results?by=brandName&v=${k}&rows=30&sort=score%20desc&start=0`,
    },
    { label: 'EUIPO eSearch', url: `https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/${k}` },
    {
      label: 'TMview',
      url: `https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=30&criteria=C&basicSearch=${k}`,
    },
    // J-PlatPat は検索語を URL で渡す公式仕様が無い（research/04 §4.4）。トップだけ開く。
    { label: 'J-PlatPat（要再入力）', url: 'https://www.j-platpat.inpit.go.jp/' },
  ];
}

export const TRADEMARK_LINK_CAVEAT =
  'リンク先は検索画面を開くだけで、語の再入力が必要な場合がある（各庁のサイトが SPA のため）。';

/** Evidence 用のソース検索 URL（数値だけの表を作らないための導線）。 */
export function evidenceUrl(source: 'hn' | 'github' | 'arxiv' | 'openalex' | 'qiita' | 'wikipv', keyword: string): string {
  const phrase = encodeURIComponent(`"${keyword}"`);
  switch (source) {
    case 'hn':
      return `https://hn.algolia.com/?q=${phrase}&dateRange=pastMonth&type=all`;
    case 'github':
      return `https://github.com/search?q=${phrase}&type=repositories&s=updated&o=desc`;
    case 'arxiv':
      return `https://arxiv.org/search/?query=${encodeURIComponent(keyword)}&searchtype=all&order=-announced_date_first`;
    case 'openalex':
      return `https://openalex.org/works?filter=title_and_abstract.search:${phrase}`;
    case 'qiita':
      return `https://qiita.com/search?q=${encodeURIComponent(keyword)}`;
    case 'wikipv':
      return `https://ja.wikipedia.org/w/index.php?search=${encodeURIComponent(keyword)}`;
  }
}
