# 調査C：トレンド情報源（論文 / Product Hunt / Google Trends / X / YouTube / Podcast）

- 対象プロダクト: 新興技術トレンド × 空き .com ドメイン発見ツール（購入機能なし・調査専用・個人利用・ローカル動作・Next.js/TypeScript）
- 調査日: 2026-09-03
- 検証方法: 公式ドキュメント・公式料金ページ・公式規約を一次情報として参照。加えて認証不要の GET を curl で実測（POST・認証付き・アカウント作成は一切行っていない）。

---

## TL;DR（15行以内）

1. **新語の「件数」を安く正確に取れるのは OpenAlex と arXiv の2つだけ。** ここに賭ける。
2. OpenAlex は 2026-02-24 に従量課金へ移行した。**無料キーで $1/日**、キー無しは **$0.10/日**（実測ヘッダで確認）。
3. OpenAlex の決め手は3つ。**引用符でフレーズ完全一致が効く**、**`group_by` を付けると件数取得が $0.0001/回**（検索価格の1/10）、**日付範囲フィルタが使える**。実測：`title.search:"agentic ai"` は30日525件・7日90件。
4. arXiv は無料・キー不要。`submittedDate:[… TO …]` で期間を切り、`opensearch:totalResults` が件数。**3秒に1回**の制限は本物で、4秒間隔でも連投すると HTTP 429「Rate exceeded.」が返った（実測）。
5. **Crossref の件数は使えない。** `query.bibliographic` はフレーズ検索ではなく、引用符あり・なしで同一件数（4,536件）だった。存在確認用にとどめる。
6. Semantic Scholar は無認証だと `/paper/search` が常時 429。キー申請が事実上の前提。
7. **Google Trends の公式 API は 2026-09 時点でもアルファ・申請制のまま**（2025-07-24 発表から1年以上）。pytrends は GitHub で archived（最終 push 2024-08-10）。
8. Google Trends の公式 RSS（`trending/rss?geo=`）は実測で生きているが、返るのは日次急上昇ワードのみ。任意キーワードの関心度時系列は取れない。
9. **X API に無料枠は無い。** 従量課金のみで Post 読み取り $0.005/件。100件返る検索1回で $0.50。日次30語なら月 $450 相当になり、MVP では非現実的。
10. **YouTube は `search.list` が1日100回の専用バケット**（10,000 units とは別建て・公式明記）。字幕 API は動画の編集権限が必要で、他人の動画からは取れない。
11. Product Hunt API は無料だが、規約に **「must not be used for commercial purposes」** がある。個人調査なら範囲内、公開・収益化するなら要照会。
12. Podcast は Apple の iTunes Search API がキー不要で即使える。Podcast Index は無料キー＋SHA-1 署名。どちらも「件数の推移」には向かない。
13. 推奨：**P0 = OpenAlex + arXiv**。**P1 = Product Hunt + Google Trends RSS + Apple Podcasts**。**P2 = Semantic Scholar / Crossref / YouTube**。
14. **採用しない = X API（費用）・Google Trends 公式 API（入手不可）・pytrends（非メンテ）・Listen Notes（無料枠300回/月では足りない）。**
15. 未確認：Product Hunt の GraphQL 引数（公式スキーマページが 404）、Podcast Index のレート制限、X の full-archive search、Glimpse の API 料金。

---

## 全体比較表

| ソース | キー | 費用（MVP規模） | 期間フィルタ | 件数の取り方 | レート制限 | 規約の障害 | 採用 |
|---|---|---|---|---|---|---|---|
| arXiv API | 不要 | 無料 | `submittedDate:[… TO …]` | `opensearch:totalResults` | 3秒に1回・1接続 | 本文の再配布禁止 | **P0** |
| OpenAlex | 推奨（無料） | $1/日の無料枠内 | `from/to_publication_date` | `meta.count`（`group_by`併用で$0.0001） | 100 req/s・日次予算制 | なし | **P0** |
| Semantic Scholar | 事実上必須 | 無料 | `publicationDateOrYear=a:b` | `total` | キー有 1 RPS | なし | P2 |
| Crossref | 不要（mailto推奨） | 無料 | `from/until-pub-date` | `total-results`（rows=0） | polite 3 req/s・public 1 req/s | なし | P2 |
| Product Hunt v2 | developer token | 無料 | `postedAfter/Before`（未確認） | 件数フィールドなし・要ページング | 6,250 complexity/15分 | **商用利用禁止** | **P1** |
| Google Trends 公式API | 申請制 | 不明 | 日/週/月/年 | 関心度スコア | 不明 | アルファ・申請制 | 不採用 |
| Google Trends RSS | 不要 | 無料 | 当日のみ | 急上昇ワード一覧 | 不明 | 公式文書なし | **P1** |
| X API | 必須 | $0.50/検索1回 | `start_time/end_time`（7日） | `meta.result_count` | 月300万Post読上限 | 無料枠なし | 不採用 |
| YouTube Data API v3 | 必須（無料） | 無料 | `publishedAfter` | `pageInfo.totalResults`（概算） | **search.list 100回/日** | 字幕は編集権限必須 | P2 |
| Apple Podcasts Search | 不要 | 無料 | なし | `resultCount`（上限200） | 未確認（約20回/分） | なし | **P1** |
| Podcast Index | 無料キー | 無料 | `since` | 件数フィールドあり | 未確認 | なし | P2 |
| Listen Notes | 必須 | 無料枠 300回/月 | あり | あり | 300回/月 | なし | 不採用 |

---

## 1. arXiv API

**結論：P0。無料・キー不要で、期間指定の件数が1リクエストで取れる。速度制限が唯一の制約。**

### エンドポイントと最小リクエスト

`https://export.arxiv.org/api/query`（`http://` は 301 を返すので必ず https を使う。実測）

```
GET https://export.arxiv.org/api/query
  ?search_query=all:"synthetic memory" AND submittedDate:[202608040000 TO 202609032359]
  &start=0
  &max_results=1
```

応答は Atom XML。件数は `<opensearch:totalResults>` を読むだけでよい。`max_results=1` にすれば本文をほぼ転送せずに件数だけ取れる。

### search_query の構文

- フィールド接頭辞：`ti`（タイトル）、`au`（著者）、`abs`（要旨）、`co`（コメント）、`jr`（掲載誌）、`cat`（カテゴリ）、`rn`（レポート番号）、`id`、`all`
- 論理演算子：`AND` / `OR` / `ANDNOT`
- 期間：`submittedDate:[YYYYMMDDTTTT TO YYYYMMDDTTTT]`（GMT・分単位）
- 並び順：`sortBy=relevance|lastUpdatedDate|submittedDate`、`sortOrder=ascending|descending`
- 引用符でフレーズ検索が効く（実測：`all:"synthetic memory"` は全期間6件）

出典: https://info.arxiv.org/help/api/user-manual.html（確認日 2026-09-03）

### 7日／30日の件数の取り方

同じクエリの `submittedDate` だけ差し替えて2回投げ、`totalResults` を比較する。1語あたり2リクエスト。**30語なら 60リクエスト**。3秒間隔の理論値は約3分だが、後述のとおり実測では 429 を挟むため 5〜10分を見込む。

実測値（2026-09-03）:

| クエリ | 期間 | totalResults |
|---|---|---|
| `all:"synthetic memory"` | 全期間 | 6 |
| `all:"synthetic memory"` | 2026-08-04〜09-03（30日） | 0 |
| `abs:"world model"` | 2026-08-27〜09-03（7日） | 43 |
| `cat:cs.AI` | 2026-08-04〜09-03（30日） | 4,816 |
| `all:"agentic ai"` | 2026-08-04〜09-03（30日） | 95 |
| `ti:"agentic ai"` | 全期間 | 777 |

### レート制限と実測

公式規約の文言：「make no more than one request every three seconds, and limit requests to a single connection at a time」。さらに「You should not attempt to overcome these limits by increasing the number of machines used to make requests」と、マシンを増やして回避することも明示的に禁じている。

**実測での注意**：4秒間隔でも連続10回程度で HTTP 429 が返り、本文は `Rate exceeded.`（14バイト）だけになった。60秒あけると回復したが、その直後に20秒あけて投げた2本目がまた 429 になった。つまり**制限は「直前1回との間隔」ではなく、一定時間内の累積回数で効いている**。単純な3秒スリープでは足りない。**429 を検知したら指数バックオフする実装が必須**で、日次30語（60リクエスト）を回すなら5〜10秒間隔＋リトライを見込むこと。

出典: https://info.arxiv.org/help/api/tou.html（確認日 2026-09-03）

### ページング上限

`max_results` の総取得上限は 30,000 件、1回のスライスは最大 2,000 件。30,000 を超える要求は HTTP 400。30,000件の取得には2分強かかると公式が案内している。件数だけ欲しい本ツールでは無関係。

### 利用規約

- メタデータは CC0 1.0。取得・保存・変換・共有が可能
- 本文（PDF・ソース）を**自前サーバから配信するのは禁止**。ユーザーは arXiv.org へ誘導する
- arXiv の推薦・支援を受けていると表示しない

本ツールは「メタデータの件数を数える」だけなので、規約上の障害はない。

### 代替経路

| 手段 | URL | 実測 | 用途 |
|---|---|---|---|
| OAI-PMH | `https://oaipmh.arxiv.org/oai?verb=Identify` | HTTP 200・earliestDatestamp 2005-09-16 | 差分同期・全件取得 |
| 新着 RSS | `https://rss.arxiv.org/rss/cs.AI` | HTTP 200・当日の新着 | 日次の新着監視 |
| Kaggle メタデータ | `https://www.kaggle.com/datasets/Cornell-University/arxiv` | HTTP 200 | ローカル全文検索の土台 |
| S3 バルク | `arxiv` バケット（requester-pays） | 未検証 | 本文一括（有料・不要） |

新語検出をローカルで高速に回すなら、Kaggle のメタデータ dump を落として全文インデックスを持つ手もある。ただし MVP には API で足りる。

---

## 2. OpenAlex API

**結論：P0。ただし2026年に料金体系が変わったので、旧情報は全部捨てること。**

### 2026-02-24 の変更（最重要）

OpenAlex は 2026-02-24 に**従量課金**を導入した。公式ブログの文言：

> 「you'll need an API key for all requests. Getting one is free and takes about 30 seconds」
> 「You can still make a few calls without an API key for demo purposes, but it's not suitable for any kind of production use.」
> 「The full OpenAlex dataset—all 480M works, all the metadata—is free to download, share, remix, and build on.」

出典: https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/（確認日 2026-09-03）

ヘルプ側の表現はやや緩く、「you can make basic queries with no key at all」「a free key gives you 10× the keyless budget」「最大 100 requests/second」となっている。
出典: https://help.openalex.org/guides/authentication（確認日 2026-09-03）

**実測：キー無しでも 200 が返る。** ヘッダに予算が出る。

```
x-ratelimit-limit-usd: 0.1
x-ratelimit-remaining-usd: 0.0969
x-ratelimit-cost-usd: 0.0001
x-ratelimit-limit: 1000
x-ratelimit-remaining: 969
x-ratelimit-reset: 72415        # 秒。UTC 深夜0時にリセット
```

つまり **キー無し＝$0.10/日、無料キー＝$1.00/日**。`mailto` を付けても付けなくても予算は $0.10/日で変わらなかった（実測）。**かつての polite pool は、もう予算に影響しない。**

### 料金表（公式）

| 操作 | 単価 | 1,000回あたり |
|---|---|---|
| 単一エンティティ取得（ID/DOI指定） | 無料 | $0 |
| List + Filter | $0.0001 | $0.10 |
| Search | $0.001 | $1.00 |
| Semantic search | $0.001 | $1.00 |
| Content download（PDF/XML） | $0.01 | $10.00 |

$1/日で買えるのは「list+filter 10,000回（約100万件）」「search 1,000回（約10万件）」「content download 100回」「単一取得は無制限」。予算は UTC 深夜0時にリセット。

有料プラン：従量前払いは $1 単位（最終購入から3か月で失効）。年額は Member $20/日（$7,300/年）、Member+ $100/日（$36,500/年）、Partner $200+/日（$20,000/年〜）。

出典: https://help.openalex.org/access/example-costs 、 https://help.openalex.org/access/pricing（確認日 2026-09-03）

### 新語検出に使う最小のリクエスト（推奨形）

```
GET https://api.openalex.org/works
  ?filter=title.search:"agentic ai",from_publication_date:2026-08-04,to_publication_date:2026-09-03
  &group_by=publication_year
```

このリクエストが本調査で見つけた**最良の形**で、理由は3つある。

**(1) 引用符でフレーズ完全一致が効く。** 実測差は大きい。

| フィルタ | 期間 | count |
|---|---|---|
| `title_and_abstract.search:agentic ai`（引用符なし） | 30日 | 5,642 |
| `title_and_abstract.search:"agentic ai"`（引用符あり） | 30日 | **1,003** |
| `title.search:"agentic ai"` | 30日 | **525** |
| `title.search:"agentic ai"` | 7日 | **90** |
| `title.search:"synthetic memory"` | 全期間 | 51 |

引用符なしは語のOR的なマッチになり、5.6倍に膨らむ。新語検出では必ず引用符を付ける。

**(2) `group_by` を付けると課金が1/10になる。** 実測ヘッダ：

| リクエスト | x-ratelimit-cost-usd |
|---|---|
| `filter=title_and_abstract.search:X&per-page=1` | 0.001 |
| `filter=title_and_abstract.search:X&group_by=publication_year` | **0.0001** |
| `search=X&per-page=1` | 0.001 |
| `filter=publication_year:2026&per-page=1` | 0.0001 |

`group_by` 応答にも `meta.count`（総件数）が入るので、件数取得の目的は満たせる。**同じ情報が1/10の価格で手に入る。** ただしこの挙動は料金ページに明文化されていないので、**仕様変更で戻される前提**でコードを書き、`x-ratelimit-cost-usd` を毎回ログに残すこと。

**(3) 予算の見積もりが立つ。** $0.0001/回なら、無料キーの $1/日で **10,000回**。1語につき7日・30日の2回として **1日5,000語まで**監視できる。MVP には十分すぎる。

### 制約（実測で判明）

- **`group_by=publication_date` は不可。** `{"error":"Invalid query parameters error.","message":"Cannot group by date, number, or search fields."}` が返る。日別の推移が欲しいなら日付フィルタを日数ぶん回すしかない。`group_by=publication_year` は可。
- **`from_created_date`（索引付け日）は有料プラン限定。** `{"error":"Plan upgrade required","message":"The \"from_created_date:2026-08-27\" filter requires a Premium, Institutional, or Partner plan."}` が HTTP 429 で返る。使えるのは `publication_date` 系だけ。出版日と索引日がずれる分、直近7日の数字は後から増える点に注意。
- `search=`（フルテキスト検索）は範囲が広すぎる。実測：`search=synthetic memory` は 483,087件。新語検出には `title.search` か `title_and_abstract.search` を使う。

### バルクスナップショット

CC0 のバルクスナップショット（S3）は無料・キー不要のまま。API 予算を気にせず全件を回したくなったらこちらへ移行する。

---

## 3. Semantic Scholar Academic Graph API

**結論：P2。データは良いが、無認証だと実用にならない。キーを申請してから判断する。**

### キー申請とレート

- キーは `x-api-key` ヘッダに入れる（大文字小文字を区別する）
- 申請フォーム：https://www.semanticscholar.org/product/api#api-key-form
- 公式ページの記載：無認証は「1000 requests per second shared among all unauthenticated users」（全ユーザー共有）、キー保持者は「1 RPS on all endpoints」が初期レート
- 承認までの期間は公式に記載なし＝**未確認**

出典: https://www.semanticscholar.org/product/api 、 https://api.semanticscholar.org/graph/v1/swagger.json（確認日 2026-09-03）

**実測**：無認証で `/paper/search` を叩くと**ほぼ常に HTTP 429**。共有プールが枯れている。`/paper/search/bulk` は最初の数回だけ通り、そのあと 429 になった。無認証運用は現実的でない。

### 2つの検索エンドポイント

| エンドポイント | 性質 | 上限 | 件数 |
|---|---|---|---|
| `/paper/search` | 関連度順 | 1,000件・10MB | `total` |
| `/paper/search/bulk` | 関連度なし・ブール式可 | 1回1,000件・累計1,000万件・`token` で継続 | `total`（推定値） |

公式の文言：bulk は「Returns a structure with an estimated total matches」。**推定値**である点は明記されている。

### 期間フィルタ

`publicationDateOrYear=2026-08-04:2026-09-03` の範囲指定が動作する（実測）。`year=2026-2026` 形式も可。

```
GET https://api.semanticscholar.org/graph/v1/paper/search/bulk
  ?query="agentic ai"
  &publicationDateOrYear=2026-08-04:2026-09-03
  &fields=title,publicationDate
```

実測値：`"agentic ai"` 30日 = 223件、`"world model"` 7日 = 18件、`"synthetic memory"` 2026年 = 10件。

OpenAlex と比べて母数が小さい。**OpenAlex を主、S2 を裏取りに使う構成が妥当。**

---

## 4. Crossref REST API

**結論：P2。件数の使い道がない。DOI の存在確認・出版社メタデータの補完に限定する。**

### 致命的な問題：フレーズ検索ができない

実測（2026-08-04〜09-03 の期間フィルタ付き）：

| クエリ | total-results |
|---|---|
| `query.bibliographic="retrieval augmented generation"`（引用符あり） | 4,536 |
| `query.bibliographic=retrieval augmented generation`（引用符なし） | **4,536（同一）** |
| `query.title=agentic ai` | 8,711 |
| `query.bibliographic="agentic ai"` | 10,679 |

引用符が無視され、同じ件数が返る。`query.*` は関連度スコアによる緩いマッチであり、フィルタではない。**この `total-results` を「新語の出現件数」として扱うと完全に誤る。**

### 使える部分

- `rows=0` を付けると items が空になり `total-results` だけ返る（軽量）
- `rows` の上限は 1,000（`rows=1001` は HTTP 400「must be a positive integer less than or equal to 1000」・実測）
- 期間フィルタ：`from-pub-date` / `until-pub-date` / `from-index-date` / `until-index-date`（いずれも実測で動作）
- `from-index-date` は「いつ Crossref に登録されたか」で切れる。OpenAlex の索引日フィルタが有料なのに対し、こちらは無料

### レート制限（実測ヘッダ）

| 条件 | x-rate-limit-limit | interval | x-api-pool |
|---|---|---|---|
| `mailto=` あり | **3** | 1s | `polite-array` |
| `mailto=` なし | **1** | 1s | `public-array` |

polite pool は健在で、`mailto` を付けるだけで3倍になる。公式のエチケット文書は「back off if you start seeing 429 statuses」と述べ、大量取得には REST API ではなく Metadata Plus スナップショットやパブリックデータファイルを勧めている。

出典: https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/（確認日 2026-09-03）

---

## 5. Product Hunt API v2（GraphQL）

**結論：P1。無料で新規プロダクト名＝新語の宝庫。ただし商用利用禁止の一文に注意。**

### 接続と認証

- エンドポイント：`https://api.producthunt.com/v2/api/graphql`
- `developer_token` を https://www.producthunt.com/v2/oauth/applications で発行する。「does not expire, linked to your account」
- 既定で read-only・public scope

### レート制限（公式・数値あり）

- GraphQL：**15分あたり 6,250 complexity points**
- その他エンドポイント：**15分あたり 450 requests**
- ヘッダ：`X-Rate-Limit-Limit`、`X-Rate-Limit-Remaining`、`X-Rate-Limit-Reset`（リセットまでの秒数）

出典: https://api.producthunt.com/v2/docs/rate_limits/headers（確認日 2026-09-03）

1日の投稿数はせいぜい数十件なので、日次で1回全件を舐めるだけならこの枠に余裕で収まる。

### 規約（要注意）

公式ドキュメントの文言：

> 「The Product Hunt API must not be used for commercial purposes. If you would like to use it for your business, please contact us at hello@producthunt.com.」
> 「We kindly ask that you include attribution in your project, linking back to Product Hunt」

出典: https://api.producthunt.com/v2/docs（確認日 2026-09-03）

本プロダクトは「個人利用・ローカル動作・購入機能なし」なので商用には当たらないと解釈できる。ただし**将来 SaaS 化・収益化するなら、その時点で照会が必要**。設計上、Product Hunt 由来のデータは他ソースと分離しておき、あとから切り離せるようにしておくとよい。

### posts クエリの引数（未確認）

`posts(postedAfter:, postedBefore:, topic:, order:, first:, after:)` という形が広く使われており、`order` は `RANKING`（既定）／`NEWEST`／`VOTES`／`FEATURED_AT`、日時は ISO 8601 とされる。取得できるフィールドは `name` `tagline` `description` `votesCount` `createdAt` `url` `website` `topics` など。

**ただしこれは公式スキーマページで裏が取れていない。** 公式リファレンス `https://api-v2-docs.producthunt.com/operation/query/posts/` は 2026-09-03 時点で HTTP 404 を返し、`api.producthunt.com/v2/docs/api_reference/queries` も引数を列挙していなかった。実装前に API Explorer で実物を確認すること。

### 件数の取り方

`posts` に「件数だけ返すフィールド」は無い。`postedAfter` / `postedBefore` で日を区切り、`edges` をページングして数える。**7日／30日の件数は自前で集計する。**

ただし本ツールにとっての Product Hunt の主な価値は、件数より **プロダクト名と tagline に現れる新語そのもの**にある。日次で新規投稿を取り込み、名詞句を抽出して候補語プールに入れる使い方を推奨する。

---

## 6. Google Trends

**結論：公式 API は入手不可。RSS だけ P1 で採用し、関心度の時系列は諦める。**

### 公式 Trends API（2026-09-03 時点：アルファ・申請制）

2025-07-24 に Google Search Central ブログで発表された。**1年以上たった 2026-09-03 現在もアルファのまま**で、一般提供されていない。

公式ドキュメントの文言：「Our focus with the alpha test is to verify functionality and gather feedback from a limited set of developers.」申請には具体的なユースケースと、アクセス直後にフィードバックを返せることが求められる。

提供内容：
- 直近5年（1,800日）のローリングウィンドウ
- 日次・週次・月次・年次の集計
- 地域・サブ地域での絞り込み
- **リクエスト間で一貫したスケーリング**（Web UI の 0〜100 再スケールと違い、複数リクエストの結果を結合・比較できる）

料金・レート制限・GA 時期はいずれも公式に記載なし＝**未確認**。

出典: https://developers.google.com/search/apis/trends 、 https://developers.google.com/search/blog/2025/07/trends-api（確認日 2026-09-03）

**MVP では申請待ちを前提にできない。** 申請だけ出しておき、通ったら差し替える設計にする。

### 公式 RSS（実測で稼働）

```
GET https://trends.google.com/trending/rss?geo=US
GET https://trends.google.com/trending/rss?geo=JP
```

両方とも HTTP 200（JP は 19,835 バイト）。返る XML は次の形。

```xml
<item>
  <title>vaughn grissom</title>
  <ht:approx_traffic>500+</ht:approx_traffic>
  <pubDate>Wed, 2 Sep 2026 20:40:00 -0700</pubDate>
  <ht:picture>…</ht:picture>
  <ht:news_item><ht:news_item_title>…</ht:news_item_title></ht:news_item>
</item>
```

- 取れるのは **その日の急上昇ワード**と概算トラフィック（「500+」のような幅表記）
- **任意キーワードの関心度時系列は取れない**
- 内容は一般消費者向けの話題（スポーツ・芸能）が中心で、技術新語はほとんど乗らない
- Google の公式ドキュメント上でこの RSS を説明したページは見つからなかった＝**未確認**（実測では稼働）。予告なく落ちる前提で扱う

技術トレンド検出への寄与は小さい。「日本と米国で何が急に検索されたか」を毎日ログしておく補助線として P1 に置く。

### 非公式（pytrends）は使えない

- GitHub `GeneralMills/pytrends` は **archived = true**（GitHub API で実測）、最終 push は **2024-08-10**
- PyPI の最新は **4.9.2（2023-04-13）**
- メンテされていないため、Google 側の内部 API 変更が来ても修正されない

Google の利用規約に照らしても内部エンドポイントの自動取得は推奨できない。**採用しない。**

### 有料代替

| サービス | 料金 | 内容 |
|---|---|---|
| SerpApi | Free 250回/月、Starter $25/月 1,000回、Developer $75/月 5,000回、Production $150/月 15,000回 | Google Trends API として `TIMESERIES`（関心度時系列）、`GEO_MAP`、`GEO_MAP_0`、`RELATED_TOPICS`、`RELATED_QUERIES` に対応。「Cache expires after 1h. Cached searches are free, and are not counted towards your searches per month.」 |
| Glimpse | Hobbyist $0（10検索/月）、Pro $99/月、Expert $299/月 | **API は Enterprise アドオンで料金非公開＝未確認**。公式に料金ページが存在しない |

出典: https://serpapi.com/pricing 、 https://serpapi.com/google-trends-api（確認日 2026-09-03）

SerpApi の無料250回/月は「30語 × 週1回 = 120回/月」なら収まる。**関心度の時系列がどうしても要るなら、SerpApi 無料枠が現実的な唯一の入口。** ただし MVP のスコープからは外してよい。

---

## 7. X API

**結論：不採用。無料枠が無く、検索1回で $0.50 かかる。**

### 2026年の料金体系

X API v2 は **pay-per-usage（従量課金・クレジット前払い）**が既定になっている。公式ドキュメントの文言：

> 「The X API uses pay-per-usage pricing. No subscriptions—pay only for what you use.」
> 「Purchase credits upfront. Deducted as you use the API.」

単価（公式料金表）：

| 操作 | 単価 |
|---|---|
| Posts（読み取り） | **$0.005 / resource** |
| Users | $0.010 / resource |
| Likes | $0.001 / resource |
| Owned Reads（自分のデータ） | $0.001 / resource |
| Post 作成 | $0.015 / request |
| URL 付き Post 作成 | $0.200 / request |

上限と重複排除：

> 「Pay-per-usage plans are capped at 3 million Post reads per monthly billing cycle.」
> 「All resources are deduplicated within a 24-hour UTC day window. If you request and are charged for a resource (such as a Post), requesting the same resource again within that window will not incur an additional charge.」（ただし soft guarantee と注記）

出典: https://docs.x.com/x-api/getting-started/pricing 、 https://docs.x.com/x-api/introduction（確認日 2026-09-03）

**公式料金ページに Free tier の記載は無い。** 第三者記事は「2026-02-06 に従量課金が既定化」「Basic($200/月)は廃止・Pro($5,000/月)は新規停止」と報じているが、これは一次情報で裏が取れていない＝未確認。なお第三者は月間上限を「200万リード」と書くものがあり、公式の300万と食い違う。**公式の300万を採る。**

### 検索の範囲

- Recent search：「Must be within the last 7 days.」（公式・実測なし）
- Full-archive search の提供可否と価格は本調査では公式確認できず＝**未確認**

出典: https://docs.x.com/x-api/posts/recent-search（確認日 2026-09-03）

### コスト試算（不採用の根拠）

課金は **返ってきた Post 1件ごと**。検索1回で100件返れば `100 × $0.005 = $0.50`。

- 30語 × 日次1回 = **$15/日 ≒ $450/月**
- 30語 × 週次1回 = **$15/週 ≒ $60/月**

個人利用・調査専用のツールに月$60〜450は釣り合わない。**MVP では採用しない。** X の言及数がどうしても欲しくなったら、週次・語数を絞ってから再検討する。

---

## 8. YouTube Data API v3

**結論：P2。1日100検索の壁と、字幕が取れない制約で使い道が限られる。**

### クォータ（2026年の重要な変更）

公式ドキュメントの文言：

> 「Projects that enable the YouTube Data API have a default quota allocation of 100 `search.list` calls, 100 `videos.insert` calls, and 10,000 units per day combined for all other endpoints.」

出典: https://developers.google.com/youtube/v3/getting-started（確認日 2026-09-03）

**`search.list` は 10,000 units とは別建ての「1日100回」バケットになっている。** 従来の「search.list=100 units、10,000 units/日 ⇒ 実質100回」という理解は結果的に近いが、**内部の仕組みが変わっている**。10,000 units が残っていても、search.list を100回使い切った時点で 403 になる。

その他のコスト：`videos.list` = 1 unit、`playlistItems.list` = 1 unit、`captions.list` = 50 units、`captions.download` = 200 units。

### 7日／30日の件数の取り方

`search.list` に `publishedAfter` / `publishedBefore`（RFC 3339）を付け、`pageInfo.totalResults` を読む。ただし YouTube の `totalResults` は**概算値で、ページングするとぶれる**ことが知られている。件数の精度は期待しない。

1語につき2回（7日・30日）なら **1日50語が上限**。

### 字幕は原則取れない

`captions.download` の公式記載：

> 「This method is requires the user to have permission to edit the video.」

必要スコープは `youtube.force-ssl` または `youtubepartner`、クォータは 200 units。**他人の動画の字幕は API では取得できない。**

出典: https://developers.google.com/youtube/v3/docs/captions/download（確認日 2026-09-03）

### 非公式な字幕取得は規約違反

YouTube 利用規約の「Permissions and Restrictions」には、自動化された手段による本サービスへのアクセスを禁じる条項がある（日本語版の文言）：

> 「自動化された手段（ロボット、ボットネット、スクレーパなど）を使用して本サービスにアクセスすること。ただし、（a）公開されている検索エンジンを YouTube の robots.txt ファイルに従って使用する場合、または（b）YouTube が事前に書面で許可している場合を除きます。」

加えて、コピー・利用を制限する保護機能の回避も禁じられている。`timedtext` エンドポイントを直接叩くような取得は**この条項に抵触する**。個人利用でも採用しない。

出典: https://www.youtube.com/t/terms（確認日 2026-09-03）

---

## 9. Podcast

**結論：Apple Podcasts Search API のみ P1。無料・キー不要で即動く。件数の推移には向かない。**

### Apple Podcasts（iTunes）Search API

キー不要・実測で稼働。

```
GET https://itunes.apple.com/search
  ?term=agentic ai
  &media=podcast
  &entity=podcastEpisode
  &limit=200
  &country=us
```

- JSON で `resultCount` と `results[]` が返る。エピソードには `trackName` `releaseDate` `shortDescription` `feedUrl` `genres` が含まれる
- `entity=podcast`（番組）と `entity=podcastEpisode`（エピソード）を切り替えられる
- **`limit` の上限は 200。** 実測：`"agentic ai"` エピソードは limit=50 で 46件、limit=200 で **91件**（打ち止め）
- **期間フィルタが無い。** 日付は `releaseDate` を自前で絞る。上限200件なので「30日の件数」は取れない
- レート制限を示すヘッダは返らなかった（実測）。Apple は約20リクエスト/分を案内しているとされるが、公式ページで確認できず＝**未確認**

**使い方**：用途は存在確認に絞る。「その新語を冠した番組・エピソードがあるか」「いつ最初に現れたか」を見て、ドメイン候補語の実在性チェックに使う。件数の推移には使えない。

### Podcast Index API

- 無料キー：「Register for a free API key at https://api.podcastindex.org/」
- 認証は4ヘッダ必須：`User-Agent`、`X-Auth-Date`（UTC unix epoch 秒・文字列・**3分ウィンドウ**）、`X-Auth-Key`、`Authorization`
- `Authorization` は `sha1(apiKey + apiSecret + unixTime)` の16進小文字
- エンドポイントは50個。関連するのは `/search/byterm`、`/search/bytitle`、`/search/byperson`、`/recent/episodes`、`/recent/feeds`、`/recent/newfeeds`
- **OpenAPI 仕様書の中にレート制限の記述は無かった**（実測で全文検索）＝**未確認**
- 規約：https://github.com/Podcastindex-org/legal（Terms of Service / Privacy Policy）

出典: https://podcastindex-org.github.io/docs-api/pi_api.json（確認日 2026-09-03）

Apple より検索の自由度が高く、`/recent/episodes` で新着を追える。ただしキー発行と SHA-1 署名の実装が要る。**MVP では後回し（P2）。**

### Listen Notes API

- **Free：300 requests/月**
- Pro：$200/月〜（0〜5,000 requests 込み、超過 $1.60/1,000）
- Enterprise：要問合せ
- 音声トランスクリプトは Pro 以上

出典: https://www.listennotes.com/api/pricing/（確認日 2026-09-03）

300回/月では日次監視に足りず、Pro の $200/月は個人ツールに見合わない。**不採用。**

### Podcasting 2.0 の `<podcast:transcript>`

podcast-namespace 仕様に `Transcript` タグが定義されている（`docs/tags/transcript.md`）。RSS フィードにこのタグがあれば、字幕・文字起こしの URL を直接取得できる。YouTube と違い規約上の障害がない点は大きい。

ただし**実際の付与率は未確認**。全番組の何割が対応しているか測っていないので、これを前提にした設計は避ける。

出典: https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md（確認日 2026-09-03）

---

## 実測データまとめ（2026-09-03）

同じ語を複数ソースで測った結果。**ソースごとに桁が違うので、絶対値を横断比較してはいけない。同一ソース内の時系列変化だけを見る。**

| 語 | ソース | 条件 | 7日 | 30日 | 全期間 |
|---|---|---|---:|---:|---:|
| agentic ai | OpenAlex | `title.search:"…"` | 90 | 525 | — |
| agentic ai | OpenAlex | `title_and_abstract.search:"…"` | — | 1,003 | — |
| agentic ai | OpenAlex | `title_and_abstract.search:…`（引用符なし） | 1,044 | 5,642 | — |
| agentic ai | arXiv | `all:"…"` | — | 95 | — |
| agentic ai | arXiv | `ti:"…"` | — | — | 777 |
| agentic ai | Semantic Scholar | bulk `"…"` | — | 223 | — |
| agentic ai | Crossref | `query.bibliographic="…"` | — | 10,679（**信頼不可**） | — |
| agentic ai | Apple Podcasts | episodes | — | — | 91（上限200で打ち止め） |
| world model | arXiv | `abs:"…"` | 43 | — | — |
| world model | Semantic Scholar | bulk `"…"` | 18 | — | — |
| synthetic memory | arXiv | `all:"…"` | — | 0 | 6 |
| synthetic memory | OpenAlex | `title.search:"…"` | — | — | 51 |
| synthetic memory | OpenAlex | `title_and_abstract.search:…` | — | 578 | — |
| synthetic memory | OpenAlex | `search=…`（フルテキスト） | — | — | 483,087（**広すぎ**） |
| （参考）cs.AI 全体 | arXiv | `cat:cs.AI` | — | 4,816 | — |

---

## MVP での採用推奨

### P0（最初に実装する）

**1. OpenAlex API**

- 無料 API キーを1つ取得する（30秒・無料）。$1/日で本ツールには十分
- クエリは `filter=title.search:"<語>",from_publication_date:…,to_publication_date:…&group_by=publication_year` に固定する
- **引用符を必ず付ける**（付けないと5.6倍にぶれる）
- **`group_by` を必ず付ける**（$0.001 → $0.0001）
- レスポンスの `x-ratelimit-cost-usd` と `x-ratelimit-remaining-usd` を毎回ログに残す。課金仕様が変わったら即座に気づける
- 索引日フィルタが有料なので、直近7日の数字は後から増える。伸び率は「7日 vs 30日」ではなく「先週測った7日 vs 今週測った7日」で見るほうが安定する

**2. arXiv API**

- `https://export.arxiv.org/api/query`（https 必須）
- `max_results=1` で `opensearch:totalResults` だけ読む
- **3秒スリープでは足りない場面がある。** 429 検知 → 指数バックオフを最初から入れる。安全側に倒すなら5秒間隔
- 30語 × 2期間 = 60リクエストで約3〜5分。日次バッチで回す
- OpenAlex は出版日ベース、arXiv は投稿日ベース。arXiv のほうが速報性が高いので、**2つの差分そのものが「今まさに立ち上がっている語」のシグナルになる**

### P1（MVP に入れると価値が上がる）

**3. Product Hunt API v2** — 新語の供給源として使う。日次の新規投稿から `name` と `tagline` を取り、名詞句を抽出して候補語プールへ入れる（件数の集計は目的にしない）。無料・15分6,250 complexity で余裕。**商用利用禁止の一文を README に明記し、公開・収益化時は再検討すること。**

**4. Google Trends 公式 RSS** — `geo=US` と `geo=JP` を日次で保存するだけ。技術新語はほとんど乗らないが、コストがゼロで、あとから振り返れる。公式ドキュメントが無いので落ちる前提で例外処理を入れる。

**5. Apple Podcasts Search API** — キー不要・即動く。候補語の「実在性チェック」に使う。件数の推移には使わない（期間フィルタ無し・上限200件）。

### P2（あとで足す・必要になってから）

**6. Semantic Scholar** — キーを申請してから。無認証は 429 で使えない。OpenAlex の裏取り用。
**7. Crossref** — `mailto` を付けて polite pool（3 req/s）。**件数は使わず**、DOI の存在確認と出版社メタデータの補完だけ。
**8. YouTube Data API v3** — 1日50語が限界、`totalResults` は概算。動画側の盛り上がりが必要になったら足す。
**9. Podcast Index API** — SHA-1 署名の実装コストに見合う場面が来たら。

---

## 採用しない理由

**X API** — 無料枠が無く、検索1回（100件返る想定）で $0.50。30語日次なら月$450相当。個人利用の調査ツールとして費用が釣り合わない。従量課金は「読んだ Post 1件ごと」の課金なので、件数だけ欲しい用途と構造的に相性が悪い。24時間の重複排除はあるが、日々新しい Post を読む本用途では効かない。

**Google Trends 公式 API** — 2025-07-24 の発表から1年以上たった 2026-09-03 時点でもアルファ・申請制。申請しても通る保証がなく、MVP の前提にできない。申請だけ出しておき、通ったら差し替える。

**pytrends** — GitHub で archived（最終 push 2024-08-10）、PyPI 最新は 2023-04-13 の 4.9.2。Google 側の内部 API 変更に追従されない。非公式エンドポイントを自動で叩く手法そのものも推奨できない。

**Glimpse API** — 料金が非公開（Enterprise アドオン）。見積もりが立たないものは MVP に入れない。

**Listen Notes API** — 無料枠 300 requests/月では日次監視に足りない。次のプランが $200/月で、個人ツールに見合わない。

**YouTube 字幕の非公式取得** — YouTube 利用規約が自動化手段によるアクセスを明示的に禁じている。`captions.download` は動画の編集権限が必要で、他人の動画からは取れない。回避策は規約違反になるため取らない。

**Crossref の件数** — フレーズ検索ができず、引用符の有無で結果が変わらない。この数字を新語の出現件数として使うと誤った結論を出す。件数用途では採用しない。

---

## 未確認事項（実装前に確認すること）

1. **Product Hunt の `posts` クエリ引数** — 公式スキーマページ `api-v2-docs.producthunt.com/operation/query/posts/` が 404。`postedAfter` / `postedBefore` / `topic` / `order` はコミュニティ実装での確認にとどまる。API Explorer で実物を叩いて確認する。
2. **Podcast Index のレート制限** — OpenAPI 仕様書に記載が無い。実際に叩いてヘッダを見るか、運営に問い合わせる。
3. **X API の full-archive search** — 提供可否と価格が公式で確認できなかった。採用しないので実害はない。
4. **Apple iTunes Search API のレート制限** — レスポンスヘッダに制限情報が無く、公式ページでも数値を確認できなかった。「約20リクエスト/分」は通説。保守的に1秒1回で回す。
5. **Google Trends RSS の公式性** — 実測では稼働しているが、Google のドキュメントで説明されたページが見つからなかった。予告なく落ちる前提で扱う。
6. **OpenAlex の `group_by` 課金** — 実測で $0.0001（検索価格の1/10）だが、料金ページに明文化されていない。仕様変更でこの割引が消える可能性がある。`x-ratelimit-cost-usd` を監視する。
7. **Podcasting 2.0 `<podcast:transcript>` の付与率** — 仕様は存在するが、実際に何割の番組が対応しているか測っていない。
8. **Semantic Scholar のキー承認期間** — 公式に記載なし。申請してから待ち時間を実測する。
9. **X API の旧 Basic / Pro 廃止** — 第三者記事が「Basic は廃止、Pro は新規停止」と報じているが、公式ページで裏が取れなかった。公式の従量課金の記述のみを事実として扱った。
