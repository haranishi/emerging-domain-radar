# アーキテクチャと実装契約 — Emerging Domain Radar（確定版）

作成: 2026-09-03（Fable）。2026-09-03 の調査 `docs/research/01〜04` を反映した確定版。実装者はこの文書・`01_requirements.md`・`02_ux_design.md`・`docs/research/*.md` だけを前提に実装する。API のフィールド名や実測値は `docs/research/` を正とする。

## 0. 調査で決まったこと（要約）

| 論点 | 決定 | 根拠（research） |
|---|---|---|
| 空き判定 | **RDAP（Verisign）**。キー不要。DNS の NS 事前フィルタで RDAP 呼び出しを減らす | 01 §1・§7。Verisign RDAP 規約は大量自動問い合わせを禁止＝レート制御と負のキャッシュは必須要件 |
| 価格 | **Porkbun `GET /api/json/v3/pricing/get`**（キー不要・全 TLD 標準価格・.com は登録/更新/移管とも $11.08 実測） | 01 §1・§3 |
| Premium | **.com にレジストリの Premium 階層は無い**（ICANN 手数料表で一律 $10.26、2026-11-01 に $10.97 予定・ICANN 手数料 $0.20）。よって `standard_inferred` と表示し「予約語・ブロック名は 404 と区別できない」と注記 | 01 §5・§11 |
| キー付きレジストラ API | **MVP では使わない**。Porkbun/Namecheap/Name.com/Dynadot は購入権限が同梱。読み取り専用スコープがあるのは GoDaddy v3 と Spaceship のみ（P1） | 01 §7〜§9 |
| HN | **P0**。Algolia HN Search（キー不要・10,000 req/h/IP）。必ず引用符付きフレーズ。`exhaustiveNbHits:false` は概算として表示 | 02 |
| GitHub | **P0**。Search repositories の `total_count`。未認証 10/min、権限ゼロの fine-grained PAT で 30/min。既定スコープ固定（`in:readme` は使わない） | 02 |
| Reddit | **不採用**。OAuth 必須・未認証は 403・集計コストが大きい | 02 |
| arXiv | **P0**。`submittedDate` 範囲＋`opensearch:totalResults`。レート制限は累積式（4 秒間隔でも 429）→ 5 秒間隔＋指数バックオフ必須 | 03 |
| OpenAlex | **P0（キー無し）**。2026-02-24 から日次予算制：キー無し $0.10/日、無料キーで $1/日。`group_by=publication_year` 併用で 1 件数 $0.0001 → 25 語×4 窓＝$0.01/日。`x-ratelimit-cost-usd` をログ | 03 |
| Crossref / Semantic Scholar | **不採用**（Crossref はフレーズ検索不可、S2 は無認証だと常時 429） | 03 |
| Product Hunt | **不採用（P1）**。規約が商用利用禁止・トークン必須 | 03 |
| Google Trends / X / YouTube / Podcast | **不採用（P1〜P2）**。Trends 公式 API はアルファ申請制、X は無料枠なし従量課金、YouTube search は 100 回/日 | 03 |
| 日本語圏 | **Qiita API v2（`Total-Count` ヘッダ・未認証 60 req/h）＋ Wikipedia 日本語版（検索 API・Pageviews API）**。Google News RSS はライセンス上不採用 | 04 §1 |
| 為替 | **Frankfurter v2のみ** `GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=JPY&expand=providers`（キー不要・出典行つき）。取得失敗なら円換算なし。表示は「参考値」 | 04 §2。2026-10-03に予備APIを廃止 |
| 商標 | 自動判定は不可（USPTO/JPO API は閉じている・WIPO は自動化禁止）。**手動確認リンク＋常時注意文** | 04 §4 |
| スコア式 | Trend Score・Status・Domain Score は **research/04 §3.4・§3.5・§5.4 の式を採用**（本書 §5.4 に確定値を転記） | 04 |

## 1. スタック（決定・導入済み）

Next.js 16.3（App Router・TypeScript・Tailwind v4・`src/`）／`better-sqlite3`（`data/radar.db`・WAL・`next.config.ts` に `serverExternalPackages: ['better-sqlite3']`）／`tsx`（CLI）／Vitest／Playwright 1.62.1（Chromium はキャッシュ済み）／zod／fast-xml-parser／`@anthropic-ai/sdk`（任意）。Node 24・npm。**Git 操作は一切しない**（`.gitignore` は用意済み）。Next.js 16 は破壊的変更が多いので、実装前に `node_modules/next/dist/docs/` の該当ガイドを読む（`AGENTS.md` 参照）。

## 2. ディレクトリ

```
src/app/                       ページと Route Handler
  layout.tsx  page.tsx(Dashboard)  keywords/[slug]/page.tsx  search/page.tsx  watchlist/page.tsx  about/page.tsx
  api/domains/check/route.ts   GET ?domains=a.com,b.com（最大20件・ライブ判定）
  api/keywords/route.ts        GET 一覧（フィルターはクエリ）
  api/keywords/[slug]/route.ts GET 詳細
  api/watchlist/route.ts       GET / POST / DELETE（書き込み先はローカル DB のみ）
  api/fx/route.ts              GET USD→JPY（24 時間キャッシュ）
  api/status/route.ts          GET 最終ラン情報
src/lib/env.ts                 zod で環境変数を読む。先頭で `import 'server-only'`
src/lib/http.ts                fetch ラッパー（タイムアウト・再試行・ホスト別レートリミッタ・UA・オフライン fixture）
src/lib/db/                    schema.ts（DDL） client.ts（シングルトン） repos/*.ts
src/lib/domain/                types.ts providers/{dns,rdap,porkbun-pricing}.ts index.ts generator.ts score.ts trademark.ts trademark-list.ts links.ts
src/lib/trend/                 types.ts sources/{hn,github,arxiv,openalex}.ts windows.ts normalize.ts score.ts status.ts novelty.ts
src/lib/extract/               ngram.ts blocklist.ts prompt.ts llm/{types,anthropic,codex-cli,none}.ts index.ts
src/lib/japan/                 sources/{qiita,wikipedia}.ts score.ts
src/lib/fx/frankfurter.ts
src/lib/scoring/opportunity.ts
src/pipeline/collect.ts        オーケストレータ（steps/ に分割してよい）
scripts/collect.ts  scripts/check-domains.ts  scripts/seed-demo.ts
fixtures/http/index.json + *.json   オフライン応答      fixtures/demo-run.json   デモ用の完成データ
tests/unit/*.test.ts  tests/e2e/*.spec.ts  vitest.config.ts  playwright.config.ts
docs/  README.md  .env.example  data/（gitignore）  .tmp/（gitignore）
```

## 3. ドメインプロバイダ（購入不可の構造）

`src/lib/domain/index.ts` が公開する関数は次の 3 つだけ。

```ts
checkAvailability(domains: string[], opts?): Promise<AvailabilityResult[]>   // DNS 事前フィルタ → RDAP
getPricing(tlds: string[]): Promise<TldPrice[]>                             // Porkbun 価格表（24h キャッシュ）
searchDomains(input: string): Promise<DomainReport[]>                        // 正規化 → 上 2 つを合成
```

- **DNS 事前フィルタ**（`providers/dns.ts`）: `node:dns/promises` の `resolveNs(domain)`。NS が返れば `taken`（`availability_source='dns'`）。`ENOTFOUND`/`ENODATA` なら RDAP へ。それ以外のエラーも RDAP へ。
- **RDAP**（`providers/rdap.ts`）: `GET https://rdap.verisign.com/com/v1/domain/{domain}`（ブートストラップ `https://data.iana.org/rdap/dns.json` の `.com` エントリを起動時に確認し、変わっていればそれを使う。24h キャッシュ）。200→`taken`、404→`available`、429/5xx/タイムアウト→1 回だけ再試行して `unknown`。同時実行 1、間隔 300ms。
- **負のキャッシュと予算**（規約対応）: DNS 事前フィルタ後、`taken` は 7 日間再問い合わせしない。RDAP の直前に UTC 日付をキーとする `rdap_budget` 台帳へトランザクションで 1 件予約し、`RADAR_RDAP_DAILY_BUDGET`（既定 300）を超える場合は呼ばずに `unknown`（理由 `budget`）で止める。DB なしモードは台帳を更新できないため RDAP を呼ばず `unknown`（理由 `no-db`）。Route Handler を含む手動検索も同じ台帳を使い、1 回 20 件まで。
- **価格**（`providers/porkbun-pricing.ts`）: `GET https://api.porkbun.com/api/json/v3/pricing/get`（キー不要）。応答 `pricing[tld].{registration,renewal,transfer}`（文字列 USD）を `tld_prices` に 24h キャッシュ。**Porkbun の他のパスは一切コードに書かない**（`checkDomain` も MVP では使わない）。
- **Premium**: `.com` は常に `standard_inferred`。UI 文言「Standard (inferred) — .com はレジストリに Premium 価格層が無い。ただし予約語・ブロック名は RDAP の 404 と区別できないため、最終確認はレジストラで」。
- 価格が取れない → `registrationPrice: null` → UI `Price unavailable`。推測値・既定値を入れない。
- `links.ts`: 「公式サイトで確認」用 URL を組む純関数だけ（Porkbun `https://porkbun.com/checkout/search?q={domain}`、Namecheap `https://www.namecheap.com/domains/registration/results/?domain={domain}`、ICANN Lookup `https://lookup.icann.org/en/lookup?name={domain}`）。fetch はしない。アフィリエイト・カート投入・購入 URL は作らない。
- **禁止ガード**（`tests/unit/no-purchase-guard.test.ts`）: `src/` `scripts/` を走査し、次に一致したら失敗。識別子 `registerDomain|purchaseDomain|checkoutDomain|bidDomain|createDomain|buyDomain|addToCart|placeOrder`、API パス `domain/create|domains/purchase|domains.create|/purchase|/checkout|/cart|/bid|/order`（`links.ts` の URL 文字列だけは除外リストで明示的に許可）。加えて `porkbun-pricing.ts` に `/api/json/v3/pricing/get` 以外の `/api/json/v3/` パスが無いこと、`src/` 全体に `checkDomain` が無いことを検査する。

## 4. データモデル（SQLite）

```sql
runs(id INTEGER PRIMARY KEY, started_at TEXT, finished_at TEXT, status TEXT, stats_json TEXT, notes TEXT);
raw_items(id INTEGER PRIMARY KEY, source TEXT, external_id TEXT, title TEXT, url TEXT, created_at TEXT, score INTEGER, run_id INTEGER, UNIQUE(source, external_id));
keywords(id INTEGER PRIMARY KEY, slug TEXT UNIQUE, keyword TEXT, description TEXT, why_emerging TEXT, first_seen_context TEXT,
         related_terms_json TEXT, extraction_method TEXT, llm_confidence REAL, llm_basis TEXT, first_seen_at TEXT, created_run_id INTEGER, updated_run_id INTEGER);
keyword_metrics(id INTEGER PRIMARY KEY, run_id INTEGER, keyword_id INTEGER, source TEXT, window TEXT, count INTEGER, approximate INTEGER DEFAULT 0,
         query_url TEXT, fetched_at TEXT, UNIQUE(run_id, keyword_id, source, window));   -- window: 7d | prev7d | 30d | prev30d
keyword_scores(id INTEGER PRIMARY KEY, run_id INTEGER, keyword_id INTEGER, trend_score REAL, novelty_score REAL, japan_gap_score REAL, status TEXT, fading INTEGER,
         breadth INTEGER, c30_units REAL, g7 REAL, g30 REAL, breakdown_json TEXT, UNIQUE(run_id, keyword_id));
domains(id INTEGER PRIMARY KEY, keyword_id INTEGER, domain TEXT, generation_rule TEXT, domain_score REAL, trademark_flag TEXT, created_run_id INTEGER, UNIQUE(keyword_id, domain));
domain_checks(id INTEGER PRIMARY KEY, domain TEXT, checked_at TEXT, availability TEXT, availability_source TEXT, registration_price REAL, renewal_price REAL,
         currency TEXT, premium TEXT, price_source TEXT, raw_json TEXT, run_id INTEGER);   -- 履歴。availability: available|taken|unknown|unsupported、premium: premium|standard|standard_inferred|unknown
rdap_budget(day TEXT PRIMARY KEY, used INTEGER NOT NULL);   -- day は UTC の YYYY-MM-DD、RDAP 呼び出し前に予約
tld_prices(tld TEXT PRIMARY KEY, registration REAL, renewal REAL, transfer REAL, currency TEXT, source TEXT, fetched_at TEXT);
opportunity(id INTEGER PRIMARY KEY, run_id INTEGER, keyword_id INTEGER, domain_id INTEGER, score REAL, breakdown_json TEXT);
watchlist(id INTEGER PRIMARY KEY, keyword TEXT, domain TEXT UNIQUE, added_at TEXT, found_registration_price REAL, found_renewal_price REAL, found_currency TEXT,
         trend_score REAL, opportunity_score REAL, note TEXT);
watchlist_price_history(id INTEGER PRIMARY KEY, watchlist_id INTEGER, checked_at TEXT, registration_price REAL, renewal_price REAL, availability TEXT, premium TEXT);
fx_rates(id INTEGER PRIMARY KEY, base TEXT, quote TEXT, rate REAL, as_of TEXT, source TEXT, providers_json TEXT, fetched_at TEXT);
```

ダッシュボードは「最新の完了ラン」を表示。ランは毎回追加（履歴を残す）。

## 5. トレンド計測

### 5.1 窓

ラン開始時刻 `now`（UTC）を基準に `7d=[now-7d,now)`、`prev7d=[now-14d,now-7d)`、`30d=[now-30d,now)`、`prev30d=[now-60d,now-30d)`。

### 5.2 ソース（`TrendSource` インターフェース）

```ts
interface TrendSource {
  id: 'hn' | 'github' | 'arxiv' | 'openalex';
  enabled(env): boolean;
  harvest(now): Promise<RawItem[]>;                    // 候補抽出用の最近のタイトル群（hn/github/arxiv のみ）
  measure(keyword, now): Promise<{ counts: WindowCounts; approximate: boolean; queryUrl: string; oldestSeenAt?: string }>;
  evidenceUrl(keyword): string;                        // 人が確認する検索 URL
}
```

| ソース | measure（キーワードは必ず引用符付きフレーズ） | レートリミッタ（`http.ts` の表） |
|---|---|---|
| hn | `GET https://hn.algolia.com/api/v1/search_by_date?query="kw"&tags=(story,comment)&numericFilters=created_at_i>=t60,created_at_i<tnow&hitsPerPage=1000` → `created_at_i` で 4 窓に振り分け。`nbHits>1000` なら窓ごとに `search?query=...&numericFilters=...&hitsPerPage=0` で `nbHits` を取り直す。`exhaustiveNbHits:false` → `approximate=1`。Evidence URL `https://hn.algolia.com/?q="kw"&dateRange=pastMonth&type=all` | 2 req/s |
| github | `GET https://api.github.com/search/repositories?q="kw" created:{from}..{to}&per_page=1`（ISO 8601 の日付範囲）→ `total_count` を 4 窓で 4 回。ヘッダ `Accept: application/vnd.github+json`・`X-GitHub-Api-Version: 2022-11-28`・`GITHUB_TOKEN` があれば `Authorization: Bearer`。Evidence URL `https://github.com/search?q="kw"&type=repositories&s=updated&o=desc` | 未認証 1 req/7s（10/min）、トークンあり 1 req/2.5s（30/min）。`X-RateLimit-Remaining: 0` は reset まで 120 秒以下なら待機、超えるならそのランで GitHub を `unavailable` にする |
| arxiv | `GET https://export.arxiv.org/api/query?search_query=all:%22kw%22+AND+submittedDate:[{YYYYMMDDHHMM} TO {YYYYMMDDHHMM}]&max_results=200&sortBy=submittedDate` を 60 日で 1 回、`<published>` で振り分け。`opensearch:totalResults>200` なら窓ごとに `max_results=0` で `totalResults` を取り直す。Evidence URL `https://arxiv.org/search/?query="kw"&searchtype=all&order=-announced_date_first` | **1 req/5s＋429 は 60s→120s→240s の指数バックオフ（最大 3 回）**。間隔は `RADAR_ARXIV_INTERVAL_MS`（既定 5000）で上書きできる。500 を連発する時間帯は 10000 を推奨（実測） |
| openalex | `GET https://api.openalex.org/works?filter=title_and_abstract.search:"kw",from_publication_date:{from},to_publication_date:{to}&group_by=publication_year&mailto={OPENALEX_MAILTO}` → `meta.count` を 4 窓で 4 回。`OPENALEX_API_KEY` があれば `api_key` を付ける。応答ヘッダ `x-ratelimit-cost-usd`・`x-ratelimit-remaining-usd` を run の統計に記録。429（予算切れ）なら以降このソースを `unavailable` にして続行。Evidence URL `https://openalex.org/works?filter=title_and_abstract.search:"kw",from_publication_date:{from}` | 2 req/s（日次予算が実質の上限） |

すべて `src/lib/http.ts` 経由。UA は `emerging-domain-radar/0.1 (local research tool; contact: {OPENALEX_MAILTO or "not-set"})`。

### 5.3 収穫（harvest）と候補抽出

- harvest: HN（Algolia `search?tags=story&numericFilters=created_at_i>=t7,points>=20&hitsPerPage=200` を 2 ページ）、GitHub（`search/repositories?q=created:>={d14} stars:>=10 topic:{ai|llm|agents|developer-tools|mcp}&sort=stars&per_page=100` を 5 クエリ）、arXiv（`search_query=cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG+OR+cat:cs.SE&sortBy=submittedDate&sortOrder=descending&max_results=300`）。`raw_items` に upsert。
- ルールベース抽出（`extract/ngram.ts`）: タイトルを小文字化・記号除去・トークン化し、2〜3-gram とハイフン複合語（`vibe-coding` → `vibe coding`）を候補にする。除外: 一般語ブロックリスト（`blocklist.ts`・150 語以上。ai, llm, llms, chatgpt, gpt, machine learning, deep learning, blockchain, cloud, saas, open source, language model(s), large language, neural network(s), generative ai, ai agent(s), startup(s), web app, react, python 等の一般名詞・言語名・OS 名）、ストップワードで始まる/終わる句、数字を含む句、商標ブロックリスト（§6）に触れる句、3 文字未満の語だけの句。採用条件: 2 件以上の異なるアイテムかつ 2 ソース以上、または 1 ソースで 3 件以上。
- ブロックリストの判定は**句全体の一致ではなくトークン列の部分一致**（`containsGenericPhrase`）。ブロック語のトークン列を連続部分列として含む句は落とす（`large language models` は `large language` を含むので落ちる／`ai coding agents` は `ai coding`）。ハイフン形と空白形・末尾の単純な複数形は同じ扱いに畳む。ただし**1 語のブロック語は部分一致に使わない**（`cloud sovereignty` のような残したい新語まで消えるため）。1 語は「全トークンが一般語なら落とす」側で見る。
- 候補選定は `EXTRACT_LIMITS`（`ngram.ts` の 1 か所）に集約。出現アイテム数 `n` が `RADAR_EXTRACT_MAX_ITEMS`（既定 25）以上の句は「一般語予備軍」として**新規候補から外す**（追跡中のキーワードは DB 由来なので影響なし）。候補スコアは `s × (1 + log2 n)` を基本に、`n ≤ 15` を満点帯・`n ≥ 16` を 0.5 倍とする**山形**。
  - なぜ「アイテム数 × ソース数」を捨てたか（2026-09-03 実測）: `--max-keywords 3` で出た 3 語が全部 Mainstream（`large language models` / `multi agent` / `local first`）だった。単純な積は「1 ラン内で何度も出てくる語」＝すでに一般化した語を必ず上位に押し上げる。欲しいのは逆で「複数ソースに散らばっているが、まだ数は少ない語」。
- 同じランの新規候補に包含関係の句が並ぶとき（`self improving agents` / `improving agents` / `self improving`）は、**支持アイテム集合の重なり（Jaccard）が 0.8 以上なら 1 つに統合**する（`EXTRACT_LIMITS.mergeOverlap`）。残すのはスコアが高い方・同点なら語数が多い方で、畳んだ句は残した候補の `related_terms` に入れる。判定は連結成分単位（`mesh router` ⊂ `agent mesh router` ⊂ `agent mesh` の鎖で中間だけが消えないように）。重なりが小さい包含（広く使われる語と 1 記事だけの言い方）は別候補のまま残す。
- 追跡継続: 既存 `keywords` を前回 Opportunity 順に再計測。新規は `RADAR_MAX_NEW_KEYWORDS`（既定 15）、合計 `RADAR_MAX_KEYWORDS`（既定 25）。
- LLM 抽出（§7）は候補の追加提案のみ。数値はすべて measure で取り直す。

### 5.4 スコア式（確定。About ページにも同じ内容を表示）

**ソース正規化**（`trend/normalize.ts`）: 生件数をソースごとの目安で割り「参照単位」に揃える。`units_s = raw_s × 100 / SCALE_s`、`SCALE = { hn: 300, github: 200, arxiv: 100, openalex: 300, qiita: 100, wikipv: 3000 }`（「そこそこ有名な語の 30 日件数」。初期値・1 か所の定数・2 週間データを貯めて再調整）。以下 `c7, c7prev, c30, c30prev` はソース横断の参照単位の合計、`S` は `c30_raw[s] > 0` のソース数、`S_TOTAL` はこのランで問い合わせたソース数。

```ts
const ALPHA = 3, K = 5, VMAX = 1000;
const g = (c7 + ALPHA) / (c7prev + ALPHA);
const growthRaw = 100 * clamp(Math.log2(g) / 3);            // g=2→33, 4→67, ≥8→100
const w = (c7 + c7prev) / (c7 + c7prev + K);                 // shrinkage
const G = growthRaw * w;
const a = (c7 / 7) / Math.max(c30 / 30, 1e-9);
const A = 100 * clamp(a - 1);                                // 加速。a=1.5→50, ≥2→100
const B = 100 * (S / S_TOTAL);                               // ソース横断性
const V = 100 * clamp(1 - Math.log10(1 + c30) / Math.log10(1 + VMAX));   // 小ささ
let trend = 0.35 * G + 0.20 * A + 0.20 * B + 0.25 * V;
if (S === 0) trend = 0;
if (S <= 1 && c30 < 3) trend = Math.min(trend, 40);
TrendScore = Math.round(clamp(trend, 0, 100));
```

**Status**（順に評価。`g30 = (c30 + ALPHA) / (c30prev + ALPHA)`。`THRESHOLDS` は 1 か所の定数）:
`S === 0` → **Noise**（ランから除外・保存しない） ／ `c30 ≥ 500` → **Mainstream** ／ `c30 ≥ 100 || g30 ≥ 3.0` → **Trending** ／ `c30 ≥ 25 && g30 ≥ 1.5` → **Rising** ／ `c30 ≥ 5 && g30 ≥ 1.3` → **Emerging** ／ それ以外 → **Early**。
追加フラグ `fading = (c30 ≥ 25 && g30 < 0.7)`（UI は小さなタグ「fading」で表示。Status の 5 分類は維持）。

**Novelty Score**: HN Algolia に `search?query="kw"&tags=(story,comment)&hitsPerPage=1&numericFilters=created_at_i<t60`（1 回）で 60 日より前の最古ヒットを見る。各ソースの観測最古日・`keywords.first_seen_at` との最小値を初出日とし、初出 ≤30 日: 100、≤60 日: 85、≤180 日: 60、≤365 日: 35、それ以上: 10。

**Japan Gap Score**: まず**日本語での呼び方**を en.wikipedia の langlinks から 1 リクエストで引く（`japan/sources/langlinks.ts`・`GET https://en.wikipedia.org/w/api.php?action=query&titles={kw}&prop=langlinks&lllang=ja&redirects=1&format=json`・UA 必須・2 req/s）。日本語圏では「大規模言語モデル」と書かれるので、英語フレーズのまま Qiita と ja.wikipedia に投げると日本語の言及が 0 に見える（2026-09-03 実測: `large language models` の Japan Gap が 99）。翻訳 API も辞書も要らないのが採用理由で、限界は「Wikipedia に記事が無い新語は取れない＝新語ほど取れない」。

- **リダイレクトで別記事に着地した langlinks は採用しない**。`redirects=1` を付けているため、記事の無い語は en.wikipedia 側で別記事へ飛ばされる（実例: `World model` → `Mental model` → 日本語「メンタルモデル」）。応答に `query.redirects` があり、解決後の `title` が要求キーワードの正規化（小文字化・空白/ハイフン/アンダースコアの統一）と一致しないときは `jaEquivalent = null`（＝「訳が分からない」）として扱う。誤訳を採用すると、測っている語と別の語の件数で Japan Gap が動く。
- Qiita `GET https://qiita.com/api/v2/items?query="kw" created:>={d30}&per_page=1` の `Total-Count` ヘッダ（30d）と `created:>={d60} created:<{d30}`（prev30d）。日本語タイトルが取れた語は**同じ窓を日本語（引用符付き）でも引いて件数を合算**する。未認証は 60 req/h しかないので 1 ラン分の総数を見積もり、入る窓だけ取る（`planQiitaWindows`・優先順位は **英語 30d → 日本語 30d → 英語 prev30d → 日本語 prev30d**。既定 25 語・未認証だと 30d の 2 窓まで）。省いた窓は 0 として扱い、ログに 1 回出す。
- ja.wikipedia: 日本語タイトルが取れたら `GET .../api.php?action=query&titles={ja}&redirects=1&prop=info&format=json&formatversion=2` の 1 回で存在判定する（検索は挟まない）。取れなければ従来どおり `list=search&srsearch="kw"` の正規化一致で判定する。英語フレーズとカタカナ表記は文字列一致しないため、検索経由では日本語版に記事があっても `wikiJa=false` になり Japan Gap が過大に出ていた。記事があれば Pageviews `GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/ja.wikipedia/all-access/user/{title}/daily/{YYYYMMDD}/{YYYYMMDD}`（30 日合計 `pv30`）。
- `jpUnits = qiita30 × 100/100 + (wikiJa ? 20 + pv30 × 100/3000 : 0)`、`enUnits = c30`。`enUnits === 0` → null。`gap = round(100 × clamp(1 − jpUnits / enUnits, 0, 1))`。`wikiJa` なら上限 40。
- `breakdown_json.japanGap.jaEquivalent` に日本語タイトルを記録する。**`null` は「日本語の言及が無い」ではなく「訳が分からないので英語フレーズだけで測った」**という意味で、画面は `JP equivalent unknown` と注記する（`db/queries.ts` の `KeywordDetail.jaEquivalent` で読む）。日本語圏の計測が 1 つも成功しなかったランは Japan Gap 自体を null にする。

**Domain Score**（`domain/score.ts`・research/04 §5.4 を採用。TLD が .com 以外は null）:
`0.22·length + 0.18·pronounce + 0.15·spell + 0.15·keywordMatch + 0.12·structure + 0.10·memorability + 0.08·price`（各 0〜100）。
- length: `L≤3:60 / ≤10:100 / ≤14: 100−8(L−10) / ≤20: 68−9(L−14) / >20: 0`
- pronounce: 100 から `−60·clamp((|vowelRatio−0.42|−0.08)/0.25)`、`−20·max(0, maxConsRun−3)`、`−12·max(0, syllables−4)`、`−10·max(0, 2−syllables)`、`/(zx|qx|vk|kx|jq|xz|tsq)/` に一致で −25
- spell: 100 から 同一文字 3 連 −20、曖昧綴り `[ph, gh, kn, wr, mb$, ce, ck, x, que, ough]` 1 件 −15（最大 −45）、語境界の重複文字 −15、`dictCoverage < 0.5` で −20（`dictCoverage` = SLD のうち「キーワード語・略語辞書・接頭/接尾辞」で説明できる文字の割合）
- keywordMatch: `concat:100 / suffix|prefix:85 / reorder:70 / abbrev:50 / partial:25 / none:0`（生成規則から決まる。手動入力は `none` ではなく `n/a` で 50）
- structure: 100 から ハイフン −35、数字 −25、先頭数字 −15、3 語 −15、4 語以上 −30
- memorability: 60 を基準に 2〜3 音節 +25、1 語 +15、2 語で `dictCoverage>0.9` +10、頭韻 +5
- price（USD・更新価格ベース）: `≤13:100 / ≤33: 100−40(p−13)/20 / ≤130: 60−50(p−33)/97 / >130: max(0, 10−(p−130)/70)`、premium −30。価格不明は 70（減点も加点もしない中立値）

**Opportunity Score（調査優先度）**: 空き（`available`）ドメインごとに
`O = 0.45·Trend + 0.25·Domain + 0.15·(JapanGap ?? 50) + 0.15·Novelty − mainstreamPenalty − trademarkRisk − pricePenalty`。
`mainstreamPenalty = {Mainstream:30, Trending:10, その他:0}`、`fading` なら追加 −10、`trademarkRisk = 40（商標フラグあり）`、`pricePenalty = premium:20 / 登録>$50:15 / 登録>$20:5`。0〜100 に丸める。キーワードの Opportunity は所属する空きドメインの最大値。空きが 1 件も無ければ `0.6·(ドメイン項を除いた値)` とし UI に `no .com available` を表示。`breakdown_json` に各項を保存し、詳細画面「スコア内訳」に表示する。

## 6. ドメイン候補生成と商標

- 入力トークン: キーワードを小文字・ASCII 英字のみに正規化し、先頭の冠詞・前置詞（the/a/an/of/for）を除去。数字を含むトークンは捨てる。
- 生成規則（順序固定・決定的・`generation_rule` に記録）: ①`concat` 全結合 → ②`abbrev` 略語辞書（synthetic→synth, memory→mem, intelligence→intel, engineering→eng, application→app, development→dev, infrastructure→infra, automation→auto, generative→gen, generation→gen, distributed→dist, computing→compute, protocol→proto, architecture→arch, environment→env, operations→ops, management→mgmt, network→net, security→sec, language→lang, optimization→opt, evaluation→eval, など 40 語以上）を 1 語ずつ・全語に適用 → ③`reorder` 2 語なら逆順 → ④`prefix` get/try/use（結合が 12 文字以下のときだけ）→ ⑤`suffix` hq/hub/labs/ai（キーワードに ai を含まない場合のみ ai）→ ⑥`partial` 末尾の一般語（ai/engine/system/framework/protocol/platform）を落とす。
- フィルター: `/^[a-z]+$/`、4〜24 文字、重複除去、商標ブロックリスト該当を除外（理由を保持）、Domain Score 降順→短い順で **最大 10 件**。
- 商標（`trademark.ts` + `trademark-list.ts`）: 300 語以上の既知企業・サービス・ブランド名。候補 SLD がブロック語をトークンとして含む／4 文字以上のブロック語で始まる・終わる場合は除外し `trademark_flag='brand:<語>'`。全候補に `Trademark check required` を表示し、検索画面へのリンクを出す（**リンクは検索画面を開くだけで、語の再入力が必要な場合がある**と注記）: USPTO `https://tmsearch.uspto.gov/search/search-results/{kw}`、WIPO `https://branddb.wipo.int/en/quicksearch/results?by=brandName&v={kw}&rows=30&sort=score%20desc&start=0`、EUIPO `https://euipo.europa.eu/eSearch/#basic/1+1+1+1/100+100+100+100/{kw}`、TMview `https://www.tmdn.org/tmview/#/tmview/results?page=1&pageSize=30&criteria=C&basicSearch={kw}`、J-PlatPat はトップ `https://www.j-platpat.inpit.go.jp/`。
- 「商標的に安全」という表示は一切作らない。

## 7. LLM 抽出プロバイダ（任意・既定は none）

```ts
interface KeywordExtractor { name: string; extract(items: RawItem[]): Promise<LlmKeyword[]> }
LlmKeyword = { keyword, short_description, why_emerging, first_seen_context, related_terms: string[], confidence: number(0-1),
               domain_keywords: string[], basis: 'confirmed' | 'inferred' }
```

- `LLM_PROVIDER=none`（既定）: 何もしない。
- `LLM_PROVIDER=anthropic`: `@anthropic-ai/sdk`。`new Anthropic()`（`ANTHROPIC_API_KEY` を SDK が読む）。
  ```ts
  import Anthropic from '@anthropic-ai/sdk';
  import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
  const res = await client.beta.messages.create({
    model: env.ANTHROPIC_MODEL ?? 'claude-opus-5', max_tokens: 16000,
    betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default',
    system: SYSTEM_PROMPT, messages: [{ role: 'user', content: userPrompt }],
    output_config: { format: zodOutputFormat(ExtractionSchema) },
  });
  if (res.stop_reason === 'refusal') { warn; return []; }
  const text = res.content.filter(b => b.type === 'text').map(b => b.text).join('');
  return ExtractionSchema.parse(JSON.parse(text)).keywords;
  ```
  `Anthropic.BadRequestError` で `fallbacks`/`output_config` が拒否された場合だけ `client.messages.parse({ model, max_tokens, system, messages, output_config: { format: zodOutputFormat(ExtractionSchema) } })` に切り替え `parsed_output` を使う。`Anthropic.RateLimitError` / `Anthropic.AuthenticationError` は警告して LLM ステップをスキップ（ランは続行）。`thinking` は指定しない。モデル ID に日付サフィックスを付けない。
- `LLM_PROVIDER=codex-cli`: `codex exec -s read-only --skip-git-repo-check -c model_reasoning_effort=low -o <tmp> "<prompt>"` を `child_process.spawn` で実行（`stdio: ['ignore','pipe','pipe']`・stdin を閉じる・タイムアウト 300 秒）。`CODEX_HOME` は環境変数をそのまま渡す。`-o` ファイルの最初の `{`〜最後の `}` を JSON として zod で検証。失敗・上限エラー（`usage limit` / `out of credits`）は警告してスキップ。
- プロンプト（`prompt.ts`）: 要件書 §13 の文面を基にし、出力は JSON のみ・一般語除外・`basis` で推測と確認を分ける・最大 20 語。入力はソース別にタイトルを最大 300 行。

## 8. Route Handler と画面

- `GET /api/domains/check?domains=a.com,b.com`（最大 20）: 正規化（小文字・空白・`https://`・末尾 `/`・パスを除去）→ `.com` 以外は `availability:'unsupported'`（メッセージ「MVP は .com のみ」）→ DNS → RDAP → 価格表 → `domain_checks` に保存 → JSON。フィールド: `domain, availability, availabilitySource, registrationPrice, renewalPrice, currency, premium, priceSource, checkedAt, officialLinks[], notes[]`。
- `GET /api/keywords?status=&available=1&maxPrice=&minTrend=&minOpportunity=&excludePremium=1&maxLength=&sources=hn,github`: 最新ランの一覧。ページはサーバーコンポーネントで直接 DB から読む（自 API を fetch しない）。
- `POST /api/watchlist` body `{keyword, domain, registrationPrice, renewalPrice, currency, trendScore, opportunityScore}` / `DELETE /api/watchlist?domain=`。
- `GET /api/fx`: Frankfurter v2 → `{ rate, asOf, source: 'Frankfurter v2 (central-bank blend)', ecbDate, fetchedAt, attribution: null }`。失敗なら `{ rate: null }` で UI は USD のみ。予備APIとその旧キャッシュは使わない。表示は「参考値」。
- 画面構成は `02_ux_design.md` §3.4。サーバーコンポーネント中心。クライアント部品はフィルターバー（URL 同期）・検索フォーム・Watchlist ボタンのみ。見出しは `Opportunity Score（調査優先度）`。
- 空状態: ラン無し→「`npm run radar:collect` を実行してください」と手順。デモ確認用に `npm run seed:demo` を案内。
- ダッシュボードの Status フィルター既定は「すべて」。Noise は保存されないので出ない。

## 9. 環境変数（`.env.example` に全部・すべて任意）

`RADAR_DB_PATH`(data/radar.db) `RADAR_OFFLINE`(1 で fixture) `RADAR_MAX_KEYWORDS`(25) `RADAR_MAX_NEW_KEYWORDS`(15) `RADAR_RDAP_DAILY_BUDGET`(300) `RADAR_EXTRACT_MAX_ITEMS`(25・§5.3 の一般語予備軍の門) `RADAR_ARXIV_INTERVAL_MS`(5000・§5.2。500 連発の時間帯は 10000 推奨) `LLM_PROVIDER`(none) `ANTHROPIC_API_KEY` `ANTHROPIC_MODEL` `CODEX_HOME` `GITHUB_TOKEN`（権限ゼロの fine-grained PAT で足りる） `OPENALEX_MAILTO` `OPENALEX_API_KEY`（無料キー・$1/日） `QIITA_TOKEN` `PORT`。
`NEXT_PUBLIC_` は使わない。`env.ts` は `server-only`。ログに値を出さない（キーは `set/unset` だけ表示）。

## 10. HTTP 層（`http.ts`）

- `httpGet(url, opts)`: タイムアウト 15 s、429/5xx は指数バックオフで最大 3 回、`Retry-After` 尊重。ホスト別トークンバケット（§5.2 と §3 の値。設定は 1 か所のテーブル）。
- Qiita は認証有無にかかわらずバースト 1、60 件/時を超えない補充率。GitHub の `X-RateLimit-Remaining` / `X-RateLimit-Reset`、Qiita の `Rate-Remaining` / `Rate-Reset` を読み、残り 0 かつ reset まで 120 秒以下なら待機する。120 秒超なら待機を打ち切って再開せず、そのランで該当ソースを `unavailable` として `runs.notes` に残す。
- `RADAR_OFFLINE=1`: `fixtures/http/index.json` の `[{ match: <URL の前方一致 or 正規表現>, file, status?, headers? }]` から応答を返す（ヘッダも再現できること。Qiita の `Total-Count`、OpenAlex の `x-ratelimit-cost-usd` をテストするため）。該当なしは例外。DNS 事前フィルタもオフライン時は fixture（`fixtures/dns.json`）で答える。
- レスポンス本文はログに出さない（サイズと status のみ）。

## 11. パイプライン（`scripts/collect.ts` → `src/pipeline/collect.ts`）

1. `runs` に開始を記録 → 2. harvest → `raw_items` upsert → 3. 抽出（ルール＋任意 LLM）→ 追跡キーワードと合流・上限適用 → 4. 各キーワードを各ソースで measure（1 キーワードずつ全ソース → 次へ。リミッタ順守）→ `keyword_metrics` → 5. 日本語圏計測（Qiita・ja.wikipedia）→ 6. 正規化・Trend・Status・fading・Novelty・Japan Gap → `keyword_scores`（Noise は保存しない）→ 7. ドメイン生成 → `domains` → 8. 空き判定（DNS → RDAP・負のキャッシュ・予算）→ 価格表（24h キャッシュ）→ `domain_checks` → 9. Opportunity → 10. 終了記録・要約出力・**通知条件**（Trend≥80 かつ Opportunity≥80 かつ available かつ 登録≤$20 かつ 非 premium）の一覧を stdout に出す（外部通知はしない）。
- CLI 引数: `--max-keywords N` `--skip-llm` `--keywords "a,b"`（指定語だけ計測・抽出をスキップ）`--dry-run`（外部呼び出し件数の見積りだけ）`--offline`。
- DB と同じディレクトリの `collect.lock` に PID と開始時刻を記録する。生存 PID のロックがあれば「別の収集が実行中」で即終了（exit 1）、存在しない PID の stale lock は置換し、正常・異常終了とも `finally` で解除する。
- ソース単位の失敗は `runs.notes` に記録して他ソースで続行。全ソース失敗ならラン `failed`。ラン開始後の未処理例外も最上位で捕捉し、エラー要約を付けて `finishRun(..., 'failed', ...)` を実行するため `running` のまま残さない。
- 進捗ログは `[step] message` 形式。秘密は出さない。

## 12. テスト（合格ゲート）

- 単体（Vitest）: normalize / trend / status（fading 含む）/ novelty / japanGap / domainScore / opportunity のテーブルテスト（research/04 の数値例を含める: `c7prev→c7` が `0→3` で G=13、`0→30` で G=86）、生成規則の決定性と上限 10 件、商標除外、n-gram 抽出（fixture タイトル）、DNS→RDAP の分岐と 200/404/429 の写像、Porkbun 価格表の写像（fixture）、FX パース、`Price unavailable` 経路、**no-purchase-guard**、`'use client'` ファイルが `env.ts` を import していないこと、`NEXT_PUBLIC_` が使われていないこと。
- E2E（Playwright・`RADAR_OFFLINE=1`・`RADAR_DB_PATH=.tmp/e2e.db`・`npm run seed:demo` 済み・ポート 3210）: ダッシュボードにランキングカード（順位・Status・3 スコア・ドメイン 3 件）／`Available only` でリストと URL が変わる／詳細に Evidence 表（リンク付き）とドメイン表（価格・更新・種別・確認時刻）／`/search` で 2 件一括判定（fixture: 1 件 taken・1 件 available・価格 fixture 無しで `Price unavailable`）／Watchlist 追加・削除／About に購入不可の文言。
- `npm run build`・`npm run lint` が通る。

## 13. 受け入れチェック（実装者が最後に実行して結果を報告）

1. `npm run test` 全緑 2. `npm run e2e` 全緑 3. `npm run build` 成功 4. `npm run check:domains -- example.com <ランダム文字列>.com` が DNS/RDAP 判定と Porkbun 標準価格 $11.08 を表示（ネットワーク使用・キー無し） 5. `npm run radar:collect -- --max-keywords 3` がキー無しで完走し `npm run dev` のダッシュボードにカードが出る 6. `grep -rn "registerDomain\|purchaseDomain\|checkoutDomain\|bidDomain\|checkDomain" src scripts` が 0 件。
