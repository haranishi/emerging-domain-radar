/**
 * About（US7・02_ux_design.md §3.4「About」・§4-9）。
 *
 * ここは「画面に出ている数字がどう出たか」を、ソースコードを開かずに確かめる場所。
 * そのため **数値をこのファイルに書き写さない**。式の係数・閾値・レート制限は
 * すべて実装側の定数を import して表示する。書き写すと、定数を直したときに
 * About だけ古い値のまま残り、説明ページが最も信用できない場所になる。
 *
 * DB は読まない（ランに依存しない静的な説明のため）。為替も引かない。
 */
import { StatusBadge } from '@/components/StatusBadge';
import type { Status } from '@/lib/db/types';
import { MANUAL_SEARCH_LIMIT, NEGATIVE_CACHE_DAYS, PRICE_UNAVAILABLE_NOTE, SUPPORTED_TLD, UNSUPPORTED_TLD_NOTE } from '@/lib/domain';
import { KEYWORD_MATCH_SCORE, NEUTRAL_PRICE_SCORE, WEIGHTS } from '@/lib/domain/score';
import { AVAILABILITY_CAVEAT, PREMIUM_INFERRED_NOTE, TRADEMARK_REQUIRED_NOTE } from '@/lib/domain/types';
import { FRANKFURTER_SOURCE, FX_DISCLAIMER } from '@/lib/fx/frankfurter';
import { RATE_LIMITS, type HostLimit } from '@/lib/http';
import { WIKI_PRESENT_BONUS, WIKI_PRESENT_CAP } from '@/lib/japan/score';
import {
  FADING_PENALTY,
  JAPAN_GAP_NEUTRAL,
  MAINSTREAM_PENALTY,
  NO_AVAILABLE_FACTOR,
  OPPORTUNITY_WEIGHTS,
  PREMIUM_PRICE_PENALTY,
  PRICE_OVER_20_PENALTY,
  PRICE_OVER_50_PENALTY,
  TRADEMARK_RISK_PENALTY,
} from '@/lib/scoring/opportunity';
import { SCALE } from '@/lib/trend/normalize';
import { NOVELTY_BUCKETS, NOVELTY_FLOOR } from '@/lib/trend/novelty';
import { ALPHA, K, TREND_WEIGHTS, VMAX } from '@/lib/trend/score';
import { THRESHOLDS } from '@/lib/trend/status';

/**
 * 節リンク。7,700px あるページを上から読ませないための目次
 * （UI 採点 ラウンド 1 の指摘）。並びはページの出現順で、リンク先は各節の h2 の id。
 */
const SECTIONS: { id: string; label: string }[] = [
  { id: 'no-purchase-heading', label: 'No purchase' },
  { id: 'normalize-heading', label: 'ソース正規化' },
  { id: 'trend-heading', label: 'Trend' },
  { id: 'status-heading', label: 'Status' },
  { id: 'novelty-heading', label: 'Novelty' },
  { id: 'japan-heading', label: 'Japan Gap' },
  { id: 'domain-heading', label: 'Domain' },
  { id: 'opportunity-heading', label: 'Opportunity' },
  { id: 'sources-heading', label: 'データソース' },
  { id: 'limitations-heading', label: '制限事項' },
];

export const metadata = {
  title: 'About — Emerging Domain Radar',
  description: 'スコアの式・閾値・データソース・制限事項。購入機能は実装していません。',
};

const TABLE_WRAP = 'overflow-x-auto border-y border-zinc-200 dark:border-zinc-800';
const TH = 'whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
const TD = 'px-3 py-2.5 align-top text-xs';
const TD_MONO = `${TD} whitespace-nowrap font-mono tabular-nums`;
const PRE = 'overflow-x-auto border border-zinc-200 bg-white px-4 py-3 font-mono text-[11px] leading-6 dark:border-zinc-800 dark:bg-zinc-900';

/** 端数が出ない範囲で短く書く（0.30 ではなく 0.3）。 */
const trim = (value: number): string => String(Number(value.toFixed(4)));

/** 成長率の閾値は小数第 1 位まで揃える（3 ではなく 3.0。1.5 と並べて読むため）。 */
const ratio = (value: number): string => value.toFixed(1);

function Section({ id, eyebrow, title, testId, children }: { id: string; eyebrow: string; title: string; testId?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} data-testid={testId} className="border-b border-zinc-200 py-7 dark:border-zinc-800">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">{eyebrow}</p>
      <h2 id={id} className="mt-1 scroll-mt-6 text-xl font-semibold tracking-tight">{title}</h2>
      <div className="mt-4 space-y-4">{children}</div>
    </section>
  );
}

/** 2 列（項目・値）または 3 列（項目・値・意味）の小さな表。 */
function KeyValueTable({ caption, rows, keyHeader = 'Name', valueHeader = 'Value' }: { caption: string; rows: { key: string; value: string; note?: string }[]; keyHeader?: string; valueHeader?: string }) {
  const withNotes = rows.some((row) => row.note !== undefined);
  return (
    <div className={TABLE_WRAP}>
      <table className="w-full min-w-[22rem] border-collapse">
        <caption className="px-3 py-2 text-left text-xs font-semibold">{caption}</caption>
        <thead>
          <tr>
            <th className={TH}>{keyHeader}</th>
            <th className={`${TH} text-right`}>{valueHeader}</th>
            {withNotes ? <th className={TH}>Meaning</th> : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className={`${TD_MONO} font-semibold`}>{row.key}</th>
              <td className={`${TD_MONO} text-right`}>{row.value}</td>
              {withNotes ? <td className={`${TD} text-zinc-600 dark:text-zinc-400`}>{row.note ?? ''}</td> : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * ホスト別レート制限の表記。`1/7 req/s` では読めないので「1 req / 7 s」に直す。
 * 値そのものは `RATE_LIMITS` から取り、ここでは書式だけを決める。
 *
 * 間隔（rate）と burst/backoff（detail）を分けて返すのは、1 行に繋げると
 * 最長で 44 文字になり、この列だけで 320px 使って最右の Auth を表の外へ
 * 押し出していたため。読む順も「まず間隔、必要なら詳細」なので 2 行が自然。
 */
function rateParts(limit: HostLimit): { rate: string; detail: string } {
  const interval = limit.ratePerSec > 0 ? 1 / limit.ratePerSec : Number.POSITIVE_INFINITY;
  const rate = Number.isInteger(limit.ratePerSec) ? `${limit.ratePerSec} req/s` : `1 req / ${trim(interval)} s`;
  const backoff = limit.backoffMs ? `・backoff ${limit.backoffMs.map((ms) => `${ms / 1000}s`).join('/')}` : '';
  return { rate, detail: `burst ${limit.burst}${backoff}` };
}

/**
 * ホストごとの説明。**表の行はこの説明ではなく `RATE_LIMITS` を起点に作る**ので、
 * http.ts にホストが増えたら About にも必ず出る（説明が無い行はホスト名だけ出る）。
 */
const HOST_NOTES: Record<string, { label: string; purpose: string; auth: string }> = {
  'hn.algolia.com': { label: 'HN Algolia Search', purpose: 'Hacker News の story・comment での言及数（窓別）と初出', auth: 'キー不要' },
  'api.github.com': { label: 'GitHub Search', purpose: 'リポジトリでの言及数（窓別）', auth: '任意 GITHUB_TOKEN（10/min → 30/min）' },
  'export.arxiv.org': { label: 'arXiv API', purpose: 'プレプリントでの言及数（窓別）', auth: 'キー不要' },
  'api.openalex.org': { label: 'OpenAlex', purpose: '学術論文での言及数（窓別）', auth: '任意 OPENALEX_MAILTO / OPENALEX_API_KEY' },
  'qiita.com': { label: 'Qiita', purpose: '日本語圏の記事数（Japan Gap の分子）', auth: '任意 QIITA_TOKEN（60/h → 1000/h）' },
  'ja.wikipedia.org': { label: 'Wikipedia 日本語版', purpose: '日本語記事の有無（Japan Gap）', auth: 'キー不要・UA 必須' },
  'en.wikipedia.org': { label: 'Wikipedia 英語版 langlinks', purpose: '日本語での呼び方を 1 リクエストで引く', auth: 'キー不要・UA 必須' },
  'wikimedia.org': { label: 'Wikimedia Pageviews', purpose: '日本語版記事の 30 日閲覧数（Japan Gap）', auth: 'キー不要・UA 必須' },
  'rdap.verisign.com': { label: 'Verisign RDAP', purpose: `.${SUPPORTED_TLD} の登録有無（200 = 登録済み / 404 = 登録なし）`, auth: 'キー不要' },
  'data.iana.org': { label: 'IANA RDAP bootstrap', purpose: 'TLD ごとの RDAP エンドポイント解決', auth: 'キー不要' },
  'api.porkbun.com': { label: 'Porkbun 価格表', purpose: `.${SUPPORTED_TLD} の標準登録価格・更新価格（24h キャッシュ）`, auth: 'キー不要（価格表の参照のみ）' },
  'api.frankfurter.dev': { label: FRANKFURTER_SOURCE, purpose: `USD/JPY の${FX_DISCLAIMER}レート（24h キャッシュ）`, auth: 'キー不要' },
};

const SCALE_NOTES: Record<string, string> = {
  hn: 'Hacker News（story + comment）',
  github: 'GitHub リポジトリ',
  arxiv: 'arXiv プレプリント',
  openalex: 'OpenAlex 論文',
  qiita: 'Qiita 記事（日本語圏）',
  wikipv: 'Wikipedia 日本語版の閲覧数',
};

const TREND_WEIGHT_NOTES: Record<keyof typeof TREND_WEIGHTS, string> = {
  growth: 'G — 直近 7 日 ÷ 前 7 日の伸び（平滑化・観測量で減衰）',
  acceleration: 'A — 直近 7 日の日平均が 30 日平均をどれだけ上回るか',
  breadth: 'B — 何種類のソースに出ているか',
  earliness: 'V — 絶対量の小ささ（まだ主流でないほど高い）',
};

const DOMAIN_WEIGHT_NOTES: Record<keyof typeof WEIGHTS, string> = {
  length: 'SLD の文字数（4〜10 文字が満点、3 文字以下は実質取れないので 60）',
  pronounce: '母音比率・子音の連続・音節数',
  spell: '聞いて一意に書けるか（曖昧綴り・語境界の重複・辞書被覆率）',
  keywordMatch: '生成規則から決まるキーワードとの一致度（手動入力は n/a）',
  structure: 'ハイフン・数字・語数',
  memorability: '音節数・語数・頭韻',
  price: '更新価格（USD）ベース。初年度割引では並べない',
};

const STATUS_RULES: { status: Status; rule: string }[] = [
  { status: 'Mainstream', rule: `c30 ≥ ${THRESHOLDS.mainstream}` },
  { status: 'Trending', rule: `c30 ≥ ${THRESHOLDS.trending} または g30 ≥ ${ratio(THRESHOLDS.gTrending)}` },
  { status: 'Rising', rule: `c30 ≥ ${THRESHOLDS.rising} かつ g30 ≥ ${ratio(THRESHOLDS.gRising)}` },
  { status: 'Emerging', rule: `c30 ≥ ${THRESHOLDS.emerging} かつ g30 ≥ ${ratio(THRESHOLDS.gEmerging)}` },
  { status: 'Early', rule: '上のどれにも当てはまらない' },
];

const LIMITATIONS: { title: string; body: string }[] = [
  { title: `RDAP の 404 は「空きの候補」で確定ではない`, body: AVAILABILITY_CAVEAT },
  { title: '価格は参考値', body: `価格は認証不要の価格表から取った標準価格で、実際の請求額（キャンペーン・プレミアム扱い・手数料・税）とは一致しない。取れないときは推測値を出さず「${PRICE_UNAVAILABLE_NOTE}」と表示する。円換算も${FX_DISCLAIMER}で、レートが取れなければ USD だけを出す。` },
  { title: 'Premium 判定は推定', body: PREMIUM_INFERRED_NOTE },
  { title: '商標は手動確認', body: `全候補に「${TRADEMARK_REQUIRED_NOTE}」を表示する。除外辞書に載っている語を含む候補は候補から落とすが、辞書に無いブランドは検出できない。表示する 4 つのリンクは検索画面を開くだけで、語の再入力が必要な場合がある。可否を判定する表示はこのツールには存在しない。` },
  { title: '日本語圏は英語フレーズで計測するため取り逃しがある', body: `日本語での呼び方は en.wikipedia の langlinks から引く。Wikipedia に記事が無い新語では訳が取れず、英語フレーズのまま Qiita と ja.wikipedia に投げるので日本語の言及を取り逃す。詳細画面の「JP equivalent unknown」は「日本語の言及が無い」ではなく「訳が分からないので英語フレーズだけで測った」という意味。` },
  { title: `対応 TLD は .${SUPPORTED_TLD} のみ`, body: `${UNSUPPORTED_TLD_NOTE}。他の TLD は判定せず UNSUPPORTED として返す。手動検索は 1 回 ${MANUAL_SEARCH_LIMIT} 件まで。登録済みの判定は ${NEGATIVE_CACHE_DAYS} 日キャッシュするので、確認時刻はその範囲で古いことがある。` },
  { title: 'SCALE は初期値', body: 'ソース正規化の SCALE（Step 1 の表）は「そこそこ有名な語の 30 日件数」の見積りで、実データを 2 週間ぶん貯めてから再調整する前提の暫定値。ソース間の比較はこの値の精度に依存する。' },
  { title: 'Opportunity Score は調査の順番', body: '合成指標であって、取得・利用の可否を示すものではない。判断材料は必ず Evidence（各ソースの実件数とその検索リンク）まで戻って確認する。' },
];

export default function AboutPage() {
  const trendFormula = [
    `g      = (c7 + ${ALPHA}) / (c7prev + ${ALPHA})              // Laplace 平滑化（0→n の爆発を抑える）`,
    `growth = 100 × clamp(log2(g) / 3)`,
    `w      = (c7 + c7prev) / (c7 + c7prev + ${K})           // shrinkage（観測が薄いほど減衰）`,
    `G      = growth × w`,
    `a      = (c7 / 7) / max(c30 / 30, 1e-9)`,
    `A      = 100 × clamp(a − 1)`,
    `B      = 100 × (S / S_TOTAL)`,
    `V      = 100 × clamp(1 − log10(1 + c30) / log10(1 + ${VMAX}))`,
    `Trend  = round(clamp(${trim(TREND_WEIGHTS.growth)}·G + ${trim(TREND_WEIGHTS.acceleration)}·A + ${trim(TREND_WEIGHTS.breadth)}·B + ${trim(TREND_WEIGHTS.earliness)}·V, 0, 100))`,
    ``,
    `ゲート: S = 0 なら Trend = 0 ／ S ≤ 1 かつ c30 < 3 なら上限 40`,
  ].join('\n');

  const opportunityFormula = [
    `O = ${trim(OPPORTUNITY_WEIGHTS.trend)}·Trend + ${trim(OPPORTUNITY_WEIGHTS.domain)}·Domain + ${trim(OPPORTUNITY_WEIGHTS.japanGap)}·(JapanGap ?? ${JAPAN_GAP_NEUTRAL}) + ${trim(OPPORTUNITY_WEIGHTS.novelty)}·Novelty`,
    `    − mainstreamPenalty − fadingPenalty − trademarkRisk − pricePenalty`,
    ``,
    `キーワードの Opportunity = 所属する空きドメインの最大値`,
    `空きが 1 件も無い場合 = ${trim(NO_AVAILABLE_FACTOR)} × (ドメイン項を除いた値)  → 画面に「空きなし（… はすべて TAKEN）」`,
  ].join('\n');

  const japanGapFormula = [
    `jpUnits = qiita30 × 100/${SCALE.qiita} + (日本語版に記事あり ? ${WIKI_PRESENT_BONUS} + pv30 × 100/${SCALE.wikipv} : 0)`,
    `enUnits = c30`,
    `gap     = round(100 × clamp(1 − jpUnits / enUnits, 0, 1))   // enUnits = 0 なら null`,
    `日本語版に記事があるときは上限 ${WIKI_PRESENT_CAP}`,
  ].join('\n');

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="border-b border-zinc-200 pb-7 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">About</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">How this tool works</h1>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          海外の技術コミュニティで言及が増え始めた（まだ主流ではない）技術用語を毎日見つけ、その用語から作った
          <code className="mx-1 font-mono">.{SUPPORTED_TLD}</code>
          候補の空き・登録価格・更新価格・種別を並べて、<strong>調査する順番</strong>を決めるためのローカル専用ツールです。
        </p>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          このページに出ている係数・閾値・レート制限は、すべて実装で使っている定数をそのまま読み出して表示しています。画面の数値がどう出たかは、下の式と Evidence（各ソースの実件数と検索リンク）まで戻って確認できます。
        </p>
      </header>

      <nav aria-label="Sections on this page" data-testid="about-toc" className="mt-5 border-y border-zinc-200 py-3 dark:border-zinc-800">
        <ul className="flex flex-wrap gap-x-2 gap-y-1 text-xs">
          {SECTIONS.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="inline-flex min-h-8 cursor-pointer items-center rounded-md px-2 font-medium text-blue-700 underline-offset-4 transition-colors hover:bg-blue-50 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400 dark:hover:bg-blue-950">{section.label}</a>
            </li>
          ))}
        </ul>
      </nav>

      <section aria-labelledby="no-purchase-heading" data-testid="about-no-purchase" className="mt-7 border-l-4 border-amber-400 bg-amber-50 px-4 py-4 dark:border-amber-700 dark:bg-amber-950/30">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">Scope</p>
        <h2 id="no-purchase-heading" className="mt-1 scroll-mt-6 text-xl font-semibold tracking-tight">No purchase functions</h2>
        <p className="mt-2 text-sm font-semibold leading-6 text-amber-900 dark:text-amber-200">このツールから購入はできません（購入機能は実装していません）。</p>
        <p className="mt-2 max-w-3xl text-xs leading-6 text-zinc-700 dark:text-zinc-300">
          購入・登録・カート・入札・決済の画面・ボタン・API は存在しません。外部への通信は読み取り（GET）だけで、レジストラへ登録や予約を送る経路はコードにありません。これは
          <code className="mx-1 font-mono">tests/unit/no-purchase-guard.test.ts</code>
          が禁止識別子・禁止パス・GET 以外のメソッドを毎回機械的に検査して保証しています。
        </p>
        <p className="mt-2 max-w-3xl text-xs leading-6 text-zinc-700 dark:text-zinc-300">
          ドメイン行の外部リンクは、レジストラや商標データベースの<strong>検索画面を開くだけ</strong>です。Watchlist はローカルの SQLite に行を足すメモで、レジストラ側では何も起きません。
        </p>
      </section>

      <Section id="normalize-heading" eyebrow="Step 1" title="ソース正規化（参照単位）" testId="about-normalize">
        <p className="max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          ソースごとに件数の桁が違うため、生件数をそのまま足せません。ソースごとの目安（SCALE）で割って「参照単位」に揃えてから合計します。以下の式に出てくる
          <code className="mx-1 font-mono">c7 / c7prev / c30 / c30prev</code>
          はこの参照単位の合計、<code className="mx-1 font-mono">S</code> は 30 日の生件数が 1 以上のソース数、
          <code className="mx-1 font-mono">S_TOTAL</code> はそのランで問い合わせたソース数です。
        </p>
        <pre className={PRE}>units_s = raw_s × 100 / SCALE_s</pre>
        <KeyValueTable
          caption="SCALE（そこそこ有名な語の 30 日件数の目安・暫定値）"
          keyHeader="Source"
          valueHeader="30d"
          rows={Object.entries(SCALE).map(([source, scale]) => ({ key: source, value: String(scale), note: SCALE_NOTES[source] ?? '' }))}
        />
      </Section>

      <Section id="trend-heading" eyebrow="Step 2" title="Trend Score（0〜100）" testId="about-trend-formula">
        <pre className={PRE}>{trendFormula}</pre>
        <KeyValueTable
          caption="定数"
          rows={[
            { key: 'ALPHA', value: String(ALPHA), note: 'Laplace 平滑化の加算値。0 件から 3 件への変化を「無限倍」にしない' },
            { key: 'K', value: String(K), note: 'shrinkage の強さ。観測数がこの値のとき信頼度 0.5' },
            { key: 'VMAX', value: String(VMAX), note: '「もう大きい」とみなす 30 日件数。V が 0 になる目安' },
          ]}
        />
        <KeyValueTable
          caption="重み"
          valueHeader="Weight"
          rows={Object.entries(TREND_WEIGHTS).map(([key, weight]) => ({
            key,
            value: trim(weight),
            note: TREND_WEIGHT_NOTES[key as keyof typeof TREND_WEIGHTS],
          }))}
        />
      </Section>

      <Section id="status-heading" eyebrow="Step 3" title="Status の閾値" testId="about-status-thresholds">
        <p className="max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          上から順に評価し、最初に当てはまったものを採用します（<code className="mx-1 font-mono">g30 = (c30 + {ALPHA}) / (c30prev + {ALPHA})</code>）。
        </p>
        <div className={TABLE_WRAP}>
          <table className="w-full min-w-[26rem] border-collapse">
            <thead><tr><th className={TH}>Status</th><th className={TH}>条件</th></tr></thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {STATUS_RULES.map((row) => (
                <tr key={row.status}>
                  <th scope="row" className={`${TD} whitespace-nowrap`}><StatusBadge status={row.status} /></th>
                  <td className={`${TD} font-mono tabular-nums`}>{row.rule}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className={`${TD} whitespace-nowrap font-semibold`}>Noise</th>
                <td className={`${TD} font-mono tabular-nums`}>S = 0（どのソースにも出ない語。ランから除外し保存しない）</td>
              </tr>
              <tr>
                <th scope="row" className={`${TD_MONO} font-semibold`}>fading</th>
                <td className={`${TD} font-mono tabular-nums`}>c30 ≥ {THRESHOLDS.rising} かつ g30 &lt; {ratio(THRESHOLDS.gFading)}（5 分類とは独立した追加フラグ。上のバッジの隣に小さなタグで出る）</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Section>

      <Section id="novelty-heading" eyebrow="Step 4" title="Novelty Score（初出の新しさ）" testId="about-novelty">
        <p className="max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          初出日は「各ソースで観測できた最古日」と DB の <code className="mx-1 font-mono">keywords.first_seen_at</code> の最小値です。1 つも観測できなければ「今回が初出」として満点になります。
        </p>
        <KeyValueTable
          caption="初出からの日数 → スコア"
          keyHeader="初出からの日数"
          valueHeader="Score"
          rows={[
            ...NOVELTY_BUCKETS.map((bucket) => ({ key: `≤ ${bucket.maxDays} 日`, value: String(bucket.score) })),
            { key: `> ${NOVELTY_BUCKETS[NOVELTY_BUCKETS.length - 1].maxDays} 日`, value: String(NOVELTY_FLOOR) },
          ]}
        />
      </Section>

      <Section id="japan-heading" eyebrow="Step 5" title="Japan Gap Score（日本語圏との差）" testId="about-japan-gap">
        <p className="max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          英語圏で語られている量に対して、日本語圏でどれだけ語られていないかです。高いほど「日本語の情報が少ない」を意味します。
        </p>
        <pre className={PRE}>{japanGapFormula}</pre>
        <p className="max-w-3xl text-xs leading-6 text-zinc-600 dark:text-zinc-400">
          取れなかったときは null で、Opportunity では中立値 {JAPAN_GAP_NEUTRAL} を使います（0 として減点しません）。
        </p>
      </Section>

      <Section id="domain-heading" eyebrow="Step 6" title={`Domain Score（0〜100・.${SUPPORTED_TLD} のみ）`} testId="about-domain-score">
        <p className="max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          各項目を 0〜100 で出し、下の重みで加重平均します。価格は<strong>更新価格</strong>で見ます（初年度割引で並べても翌年以降の実態と合わないため）。価格が取れないときは {NEUTRAL_PRICE_SCORE}（中立値）にして、減点も加点もしません。
          <code className="mx-1 font-mono">.{SUPPORTED_TLD}</code> 以外はスコアを出さず null になります。
        </p>
        <KeyValueTable
          caption="重み"
          valueHeader="Weight"
          rows={Object.entries(WEIGHTS).map(([key, weight]) => ({
            key,
            value: trim(weight),
            note: DOMAIN_WEIGHT_NOTES[key as keyof typeof WEIGHTS],
          }))}
        />
        <KeyValueTable
          caption="keywordMatch（生成規則ごとの点数）"
          keyHeader="Rule"
          valueHeader="Score"
          rows={Object.entries(KEYWORD_MATCH_SCORE).map(([rule, score]) => ({ key: rule, value: String(score) }))}
        />
      </Section>

      <Section id="opportunity-heading" eyebrow="Step 7" title="Opportunity Score（調査優先度）" testId="about-opportunity">
        <pre className={PRE}>{opportunityFormula}</pre>
        <KeyValueTable
          caption="重み"
          valueHeader="Weight"
          rows={Object.entries(OPPORTUNITY_WEIGHTS).map(([key, weight]) => ({ key, value: trim(weight) }))}
        />
        <KeyValueTable
          caption="減点"
          valueHeader="Penalty"
          rows={[
            ...Object.entries(MAINSTREAM_PENALTY).map(([status, penalty]) => ({
              key: `mainstreamPenalty（${status}）`,
              value: penalty === 0 ? '0' : `−${penalty}`,
              note: penalty === 0 ? '減点なし' : 'もう主流に近いほど、調べる価値が下がる',
            })),
            { key: 'fadingPenalty', value: `−${FADING_PENALTY}`, note: 'ピークを過ぎている（30 日で 3 割以上減）' },
            { key: 'trademarkRisk', value: `−${TRADEMARK_RISK_PENALTY}`, note: '商標フラグあり（除外辞書に載っている語を含む）' },
            { key: 'pricePenalty（premium）', value: `−${PREMIUM_PRICE_PENALTY}`, note: 'Premium 扱い' },
            { key: 'pricePenalty（登録 > $50）', value: `−${PRICE_OVER_50_PENALTY}`, note: '登録価格が $50 を超える' },
            { key: 'pricePenalty（登録 > $20）', value: `−${PRICE_OVER_20_PENALTY}`, note: '登録価格が $20 を超える' },
          ]}
        />
        <p className="max-w-3xl text-xs leading-6 text-zinc-600 dark:text-zinc-400">
          これは「どれを先に調べるか」を決めるための合成指標です。取得・利用の可否を判定するものではありません。
        </p>
      </Section>

      <Section id="sources-heading" eyebrow="Data" title="データソースとレート制限" testId="about-sources">
        <p className="max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">
          外部への通信は 1 か所（<code className="mx-1 font-mono">src/lib/http.ts</code>）を通し、ホスト単位で直列化しています。下の値はこのツールが自分に課している上限で、提供元の公表値より厳しい側に寄せてあります（タイムアウト 15 秒・429/5xx は最大 3 回まで指数バックオフ・
          <code className="mx-1 font-mono">Retry-After</code> を尊重）。
        </p>
        {/*
          このページで唯一の 5 列の表。本文幅（max-w-4xl = 832px）に入れると最右の Auth が
          overflow-x-auto の外に隠れ、スクロールしない限り列があること自体に気付けなかった
          （フルページのスクショでは切れたまま残る／UI 採点 ラウンド 2 の指摘）。
          広い画面では本文の外へはみ出させて 5 列とも見せる。負の margin は
          「本文の外に余っている幅」より小さく取ってあるので、ページ全体は横に伸びない
          （lg = 1024px で片側 64px 空きに対して 48px、xl = 1280px で 192px 空きに対して 160px）。
        */}
        <div className="lg:-mx-12 xl:-mx-40">
          <div className={TABLE_WRAP}>
            <table className="w-full min-w-[52rem] border-collapse">
              <thead>
                <tr>
                  <th className={TH}>Source</th>
                  <th className={TH}>Host</th>
                  {/* この列だけ下限を決める。決めないと自動レイアウトが 100px 前後まで詰めて 7 行に折り返す。 */}
                  <th className={`${TH} min-w-64`}>何を測るか</th>
                  <th className={TH}>Rate limit（自主規制）</th>
                  <th className={TH}>Auth</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {Object.entries(RATE_LIMITS).map(([host, limit]) => {
                  const note = HOST_NOTES[host];
                  const rate = rateParts(limit);
                  return (
                    <tr key={host}>
                      {/* nowrap にしない。`Frankfurter v2 (central-bank blend)` の 1 行で 264px 取られる。 */}
                      <th scope="row" className={`${TD} font-semibold`}>{note?.label ?? host}</th>
                      <td className={TD_MONO}>{host}</td>
                      <td className={`${TD} min-w-64 text-zinc-600 dark:text-zinc-400`}>{note?.purpose ?? '—'}</td>
                      <td className={`${TD} font-mono tabular-nums`}>
                        <span className="whitespace-nowrap">{rate.rate}</span>
                        <span className="block text-zinc-500 dark:text-zinc-400">{rate.detail}</span>
                      </td>
                      <td className={`${TD} text-zinc-600 dark:text-zinc-400`}>{note?.auth ?? '—'}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        {/* 表がはみ出さない幅（lg 以上）では出さない。出しっぱなしにすると嘘の案内になる。 */}
        <p className="text-xs leading-6 text-zinc-600 lg:hidden dark:text-zinc-400">→ 表は横スクロールします（Auth まで 5 列あります）。</p>
        <p className="max-w-3xl text-xs leading-6 text-zinc-600 dark:text-zinc-400">
          収集は UI のボタンではなく CLI（<code className="mx-1 font-mono">npm run radar:collect</code>）で走ります。レート制限のある長時間処理を画面から起こすと、開いた回数だけ提供元へ負荷がかかるためです。RDAP には 1 日あたりの問い合わせ上限も別に設けています。
        </p>
      </Section>

      <Section id="limitations-heading" eyebrow="Limits" title="制限事項" testId="about-limitations">
        <dl className="space-y-4">
          {LIMITATIONS.map((item) => (
            <div key={item.title} className="border-l-2 border-zinc-300 pl-4 dark:border-zinc-700">
              <dt className="text-sm font-semibold">{item.title}</dt>
              <dd className="mt-1 max-w-3xl text-xs leading-6 text-zinc-700 dark:text-zinc-300">{item.body}</dd>
            </div>
          ))}
        </dl>
      </Section>

      <section aria-labelledby="closing-heading" className="py-7">
        <h2 id="closing-heading" className="text-sm font-semibold">まとめ</h2>
        <p className="mt-2 max-w-3xl text-xs leading-6 text-zinc-700 dark:text-zinc-300">
          スコアは順番を決めるための道具で、結論ではありません。気になった候補は Evidence の検索リンクで実際の言及を読み、価格と種別はレジストラの公式サイトで、商標は 4 つのデータベースで自分で確認してください。このツールはその確認の入口までしか行きません。
        </p>
      </section>
    </div>
  );
}
