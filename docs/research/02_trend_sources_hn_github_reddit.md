# 調査B：トレンド情報源（Hacker News / GitHub / Reddit）

対象プロダクト：新興技術トレンド × 空き .com ドメイン発見ツール（購入機能なし・調査専用・個人利用・ローカル動作・Next.js/TypeScript）
調査日：2026-09-03（本文中の「確認日 2026-09-03」はすべてこの日）
実測はすべて認証なしの GET のみ。POST・認証付き・アカウント作成・購入系エンドポイントは呼んでいない。

---

## TL;DR

1. **HN の Algolia Search API が唯一「1リクエストで期間内の件数が返る」ソース**。`nbHits` を読むだけで7日窓・30日窓の言及数が取れる。
2. HN Algolia のレート制限は公式ページに **1 IP あたり 10,000 リクエスト/時**と明記。認証不要。MVP の主軸に据えられる。
3. ただし `nbHits` が厳密なのは低頻度語だけ。**`exhaustiveNbHits: false` が返ったら概算値**（実測：`agent` 7日 3,854件で false、`"context engineering"` 7日 5件で true）。新語検出は低頻度側なので実用上は問題にならない。
4. **フレーズはダブルクォートで囲まないと桁が変わる**。実測：`"context engineering"` は5件、クォート無しは51件。
5. GitHub Search repositories は未認証で `total_count` が返る。**未認証は 10 リクエスト/分**、認証済みは 30 リクエスト/分（公式値）。
6. GitHub の `created:` は **ISO8601 のタイムスタンプ範囲**が使える（`created:2026-08-27T00:00:00Z..2026-09-03T00:00:00Z`）。7日窓を正確に切れる。
7. GitHub の **fine-grained PAT は権限ゼロで足りる**（公式：「The fine-grained token does not require any permissions.」）。
8. **Search code は認証必須**（未認証で 401 を実測）。しかも既定ブランチのみ・384KB未満・1年以内に活動のあるリポジトリのみ。README の新語検出には向かない。代わりに repositories 検索の `in:readme` を使う。
9. **GitHub Trending に公式 API は存在しない**（`api.github.com` ルートの33キーに trending 系なし）。代替は `created:` + `stars:` の組み合わせか GH Archive。
10. **Reddit は MVP から外すのが妥当**。公式ヘルプが「OAuth トークンでの認証が必須」「OAuth を使わないトラフィックはブロックする」と明記している。
11. 実測でも未認証 `.json` は **HTTP 403**（ブラウザ UA・Reddit 推奨形式 UA のどちらでも）。`robots.txt` は `Disallow: /`。
12. Reddit の無料枠は **100 QPM / OAuth client id**（10分平均）。ただし検索エンドポイントに総件数フィールドが無く、`limit` 上限100でページングして数えるしかない。
13. Reddit の商用利用・レート超過の研究利用は**別途 Reddit との契約が必要**（Data API Terms 3.1）。Pushshift は**モデレーター限定**。
14. 推奨：**P0 = HN Algolia、P1 = GitHub Search repositories、P2 = GH Archive**。Reddit は当面採用しない。
15. 「synthetic memory」は HN・GitHub とも直近30日で 0 件。新語の当たり外れを見るテストケースとして残す価値がある。

---

## 検証の前提

窓の境界は UTC の 0時に固定した。再現性のためエポック秒を先に置く。

| 窓 | 期間（UTC） | エポック秒 |
|---|---|---|
| 直近7日 | 2026-08-27T00:00:00Z 〜 2026-09-03T00:00:00Z | 1787788800 〜 1788393600 |
| その前7日 | 2026-08-20T00:00:00Z 〜 2026-08-27T00:00:00Z | 1787184000 〜 1787788800 |
| 直近30日 | 2026-08-04T00:00:00Z 〜 2026-09-03T00:00:00Z | 1785801600 〜 1788393600 |

---

## 1. Hacker News

### 1.1 公式 Firebase API：件数集計には使えない

- ベース URI：`https://hacker-news.firebaseio.com/v0/`
- レート制限の公式記述は **「There is currently no rate limit.」**（出典：https://github.com/HackerNews/API 、確認日 2026-09-03）
- 認証・API キーは不要。`access-control-allow-origin: *` を実測（同日 03:53 UTC）。
- 実測：`GET /v0/maxitem.json` → `49545751`。`GET /v0/item/8863.json` → `{"id":8863,"type":"story","by":"dhouston","time":1175714200,...}`
- 提供エンドポイント：`item/<id>`、`user/<name>`、`maxitem`、`topstories`、`newstories`、`beststories`、`askstories`、`showstories`、`jobstories`、`updates`
- 規約・ライセンスの記述は README に無い（**未確認**）。連絡先として `api@ycombinator.com` のみ記載。

**結論：全文検索の口が無い。** 語の言及数を数えるには全アイテムを順に取得して自前で索引を張ることになり、MVP には過剰。**採用しない。**

### 1.2 Algolia HN Search API：件数集計の本命

公式ドキュメント：https://hn.algolia.com/api （確認日 2026-09-03）

エンドポイントは2つ。

| エンドポイント | 並び順 |
|---|---|
| `https://hn.algolia.com/api/v1/search` | 関連度 → points → コメント数 |
| `https://hn.algolia.com/api/v1/search_by_date` | 日付の新しい順 |

公式ドキュメントに載っている共通クエリパラメータ：

| パラメータ | 値 | 用途 |
|---|---|---|
| `query=` | 文字列 | 全文検索クエリ |
| `tags=` | `story` / `comment` / `poll` / `pollopt` / `show_hn` / `ask_hn` / `front_page` / `author_:USERNAME` / `story_:ID` | 種別の絞り込み |
| `numericFilters=` | `created_at_i` / `points` / `num_comments` に `<` `<=` `=` `>` `>=` | 数値・期間の絞り込み |
| `page=` | 整数 | ページ番号 |

`tags` の論理演算も公式に明記されている。`author_pg,(story,poll)` は `author=pg AND (type=story OR type=poll)` を意味する。カンマが AND、括弧内が OR。
ページングは `nbPages` と `hitsPerPage` を見て `&page=2`、1ページあたりの件数は `hitsPerPage=50` のように指定する。
`restrictSearchableAttributes=url` のような検索対象の限定も公式の例に含まれる。

**レート制限（公式原文）**：

> We are limiting the number of API requests from a single IP to 10,000 per hour. If you or your application has been blacklisted and you think there has been an error, please contact us

（出典：https://hn.algolia.com/api の "Rate limits" セクション。ページ本文は JavaScript で描画されるため、同ページが読み込むバンドル `https://hn.algolia.com/public/main-6e634771f729331a3c3c.js` から原文を確認した。確認日 2026-09-03）

**利用規約**：ドキュメントページに利用規約・帰属表示のリンクは無い。外部リンクは Algolia の製品ページと GitHub リポジトリのみ（**規約の明文は未確認**）。認証も API キーも不要。

**レスポンスヘッダ**：レート制限系ヘッダは返らない。実測したヘッダは `content-type`、`access-control-allow-origin: *`、`x-cloud-trace-context`、`date`、`server: Google Frontend` など。**残り回数はクライアント側で自前カウントするしかない。**

### 1.3 7日／30日の言及数を取る具体的なリクエスト例

```bash
# 直近7日（2026-08-27T00:00:00Z 〜 2026-09-03T00:00:00Z）の "synthetic memory" 言及数
curl -sS -G 'https://hn.algolia.com/api/v1/search_by_date' \
  --data-urlencode 'query="synthetic memory"' \
  --data-urlencode 'tags=(story,comment)' \
  --data-urlencode 'numericFilters=created_at_i>=1787788800,created_at_i<1788393600' \
  --data-urlencode 'hitsPerPage=1' \
  | jq '{nbHits, exhaustiveNbHits}'
```

```bash
# 直近30日（2026-08-04T00:00:00Z 〜 2026-09-03T00:00:00Z）
curl -sS -G 'https://hn.algolia.com/api/v1/search_by_date' \
  --data-urlencode 'query="context engineering"' \
  --data-urlencode 'tags=(story,comment)' \
  --data-urlencode 'numericFilters=created_at_i>=1785801600,created_at_i<1788393600' \
  --data-urlencode 'hitsPerPage=1' \
  | jq '{nbHits, exhaustiveNbHits}'
```

`hitsPerPage=1` にしておけば本文は返らず `nbHits` だけ読める。**1語あたり1リクエストで済む。**

TypeScript から呼ぶ場合：

```ts
const HN = 'https://hn.algolia.com/api/v1/search_by_date';

async function hnMentions(phrase: string, fromSec: number, toSec: number) {
  const u = new URL(HN);
  u.searchParams.set('query', `"${phrase}"`);          // 引用符は必須
  u.searchParams.set('tags', '(story,comment)');
  u.searchParams.set('numericFilters', `created_at_i>=${fromSec},created_at_i<${toSec}`);
  u.searchParams.set('hitsPerPage', '1');
  const r = await fetch(u, { headers: { 'User-Agent': 'emerging-domain-radar/0.1' } });
  const j = await r.json();
  return { count: j.nbHits as number, exact: j.exhaustiveNbHits as boolean };
}
```

### 1.4 実測結果（2026-09-03 03:52〜03:56 UTC）

`search_by_date` + `tags=(story,comment)`：

| 検索語 | 直近7日 | その前7日 | 直近30日 | `exhaustiveNbHits` |
|---|---:|---:|---:|---|
| `"synthetic memory"` | 0 | 0 | 0 | true |
| `"context engineering"` | 5 | 8 | 28 | true |

直近7日の `"context engineering"` の内訳：`tags=story` が1件、`tags=comment` が4件。合算の5件と一致する。
`search` と `search_by_date` の `nbHits` は同値（どちらも5件）。件数だけ欲しいならどちらでもよい。

応答例（`hitsPerPage=2`、直近7日、`"context engineering"`）：

```json
{
  "nbHits": 5,
  "hits": [
    {
      "objectID": "49539184",
      "created_at": "2026-09-02T17:00:43Z",
      "created_at_i": 1788368443,
      "title": null,
      "story_title": "Show HN: Aura – a Rust agent that investigates and fixes production incidents",
      "author": "chipadeedoodah",
      "_tags": ["comment", "author_chipadeedoodah", "story_49538195"]
    },
    {
      "objectID": "49532425",
      "created_at": "2026-09-02T06:21:13Z",
      "created_at_i": 1788330073,
      "title": null,
      "story_title": "Claude Fable 5.1 and Claude Mythos 5.1",
      "author": "mirekrusin",
      "_tags": ["comment", "author_mirekrusin", "story_49525378"]
    }
  ]
}
```

レスポンスのトップレベルキー（実測）：`exhaustive`, `exhaustiveNbHits`, `exhaustiveTypo`, `hits`, `hitsPerPage`, `nbHits`, `nbPages`, `page`, `params`, `processingTimeMS`, `processingTimingsMS`, `query`, `serverTimeMS`

### 1.5 注意点

**（a）`nbHits` は常に厳密ではない。** 高頻度語では Algolia が概算値を返す。直近7日窓での実測：

| 検索語 | `nbHits` | `exhaustiveNbHits` |
|---|---:|---|
| `agent` | 3,854 | **false** |
| `LLM` | 4,663 | **false** |
| `MCP` | 1,606 | **false** |
| `"context engineering"` | 5 | true |

**対策：`exhaustiveNbHits` を必ず読み、false なら UI に「概算」と出す。** 新語レーダーの用途では検出したい語は低頻度側にあるので、実害は小さい。

**（b）ダブルクォートを外すと桁が変わる。** 直近7日窓の実測で `"context engineering"` は5件（exhaustive）、`context engineering` は51件（非 exhaustive）。後者は2語を別々に含む投稿まで拾っている。**フレーズは必ずクォートで囲む。**

**（c）タイポ許容が既定で効く。** `exhaustiveTypo` が false になるケースがある。厳密一致を優先するなら `typoTolerance=false` の付与を検討する（公式ドキュメントのパラメータ表には載っていないが Algolia 共通パラメータ。**HN のドキュメント上は未確認**）。

**（d）タイトルだけに絞ると精度が上がる。** 実測：`restrictSearchableAttributes=title` + `tags=story` + 30日窓で `"context engineering"` は6件（exhaustive）。コメント内の言及を除きたいときに使える。

**（e）ページング上限。** 高頻度語では `nbPages` が 1000 で頭打ちになる（実測）。件数だけを読む用途では影響しない。

**（f）Algolia 側の一存で仕様が変わりうる。** 非公式の第三者ホスティングであり、SLA も規約も明文化されていない。**キャッシュ層を必ず挟み、1日1回の取得に留める設計にする。**

---

## 2. GitHub REST API

### 2.1 レート制限（公式値と実測値）

出典：https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api および https://docs.github.com/en/rest/search/search （確認日 2026-09-03。原文は github/docs リポジトリの `content/rest/...` からも照合済み）

| 区分 | 公式値 | 実測（未認証・2026-09-03 03:47〜04:00 UTC） |
|---|---|---|
| コア（未認証） | 60 リクエスト/時 | `x-ratelimit-limit: 60`, `x-ratelimit-resource: core` |
| コア（PAT 認証） | 5,000 リクエスト/時 | 未実測 |
| GitHub App インストール | 5,000 リクエスト/時（GHEC 組織は 15,000） | 未実測 |
| Search（未認証） | **10 リクエスト/分** | `x-ratelimit-limit: 10`, `x-ratelimit-resource: search` |
| Search（認証済み） | 30 リクエスト/分 | 未実測 |
| Search code | **認証必須・10 リクエスト/分** | 未認証で 401 |
| GraphQL（未認証） | — | `limit: 0`（＝使用不可） |

公式原文：

> The REST API has a custom rate limit for searching. For authenticated requests, you can make up to 30 requests per minute for all search endpoints except for the Search code endpoint. The Search code endpoint requires you to authenticate and limits you to 10 requests per minute. For unauthenticated requests, the rate limit allows you to make up to 10 requests per minute.

副次レート制限（secondary rate limit）も別建てで存在する。同時リクエスト100件まで、REST は毎分900ポイントまで、実時間60秒あたり CPU 時間90秒まで。超過時は 403 か 429 が返り、`retry-after` があればその秒数待つ。

レスポンスヘッダは `x-ratelimit-limit` / `-remaining` / `-used` / `-reset` / `-resource` の5種。`GET /rate_limit` は主レート制限を消費しない。

`GET /rate_limit` の実測（未認証）：

```json
{"core":{"limit":60,"remaining":56,"reset":1788409333,"used":4},
 "search":{"limit":10,"remaining":10,"reset":1788407760,"used":0},
 "code_search":{"limit":60,"remaining":56,"reset":1788409333,"used":4},
 "graphql":{"limit":0,"remaining":0,"reset":1788411300,"used":0}}
```

### 2.2 fine-grained PAT に必要な権限：ゼロでよい

公式ドキュメントの Search repositories / Search issues and pull requests / Search code / Search topics の各項に、同じ文が繰り返されている。

> The fine-grained token does not require any permissions.
> This endpoint can be used without authentication if only public resources are requested.

（出典：https://docs.github.com/en/rest/search/search 、確認日 2026-09-03）

**つまり public リポジトリの検索なら、権限を1つもチェックしない fine-grained PAT で足りる。** 認証すればレート制限が 10/分 → 30/分、コアが 60/時 → 5,000/時 に上がるので、**MVP でも PAT は入れるべき**。ただし `Search users` だけは例外で「This endpoint does not accept authentication」と明記されている。

### 2.3 検索の制約（公式値）

- 1回の検索で返る結果は **最大1,000件**（`total_count` 自体は1,000を超えて返る。実測：`agent created:2026-08-27..2026-09-03` で `total_count: 46287`, `incomplete_results: false`）
- クエリが走査するリポジトリは **最大4,000件**
- クエリは **256文字以内**（演算子・修飾子を除く）
- `AND` / `OR` / `NOT` は **5個まで**
- タイムアウト時は `incomplete_results: true` が返る。この場合の件数は信用できない

### 2.4 日付・期間の指定

`created:` は日付だけでなく **ISO8601 のタイムスタンプ範囲**を受け付ける（出典：https://docs.github.com/en/search-github/searching-on-github/getting-started-with-searching-on-github/understanding-the-search-syntax 、確認日 2026-09-03）。

| 記法 | 例 |
|---|---|
| `>YYYY-MM-DD` | `cats created:>2016-04-29` |
| `>=YYYY-MM-DD` | `cats created:>=2017-04-01` |
| `YYYY-MM-DD..YYYY-MM-DD` | `cats pushed:2016-04-30..2016-07-04` |
| `YYYY-MM-DDTHH:MM:SSZ..YYYY-MM-DDTHH:MM:SSZ` | `cats created:2016-03-21T14:11:00Z..2016-04-07T20:45:00Z` |

**7日窓を厳密に切るならタイムスタンプ形式を使う。** 日付だけだと境界日の扱いがぶれる。

`stars:` は `stars:500`（ちょうど）、`stars:10..20`（範囲）、`stars:>=500` が使える。`*` を使った片側開区間（`stars:10..*`）も可。

### 2.5 7日／30日の言及数を取る具体的なリクエスト例

```bash
# 直近7日に作成されたリポジトリのうち "synthetic memory" を含むもの
curl -sS -G 'https://api.github.com/search/repositories' \
  -H 'Accept: application/vnd.github+json' \
  -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'User-Agent: emerging-domain-radar/0.1' \
  --data-urlencode 'q="synthetic memory" created:2026-08-27T00:00:00Z..2026-09-03T00:00:00Z' \
  --data-urlencode 'sort=stars' --data-urlencode 'order=desc' --data-urlencode 'per_page=1' \
  | jq '{total_count, incomplete_results}'
```

```bash
# README 内での言及を数える（Search code を使わずに済む）
curl -sS -G 'https://api.github.com/search/repositories' \
  -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'User-Agent: emerging-domain-radar/0.1' \
  --data-urlencode 'q="context engineering" in:readme created:2026-08-04..2026-09-03' \
  --data-urlencode 'per_page=1' | jq '.total_count'
```

```bash
# Issue / PR での言及（未認証で使える）
curl -sS -G 'https://api.github.com/search/issues' \
  -H 'Accept: application/vnd.github+json' -H 'X-GitHub-Api-Version: 2022-11-28' \
  -H 'User-Agent: emerging-domain-radar/0.1' \
  --data-urlencode 'q="context engineering" created:2026-08-27..2026-09-03' \
  --data-urlencode 'per_page=1' | jq '.total_count'
```

認証する場合は `-H "Authorization: Bearer $GITHUB_TOKEN"` を足すだけ。

### 2.6 実測結果（2026-09-03 03:47〜04:00 UTC・未認証）

| クエリ | `total_count` | `incomplete_results` |
|---|---:|---|
| `"synthetic memory" created:2026-08-27..2026-09-03` | 0 | false |
| `"context engineering" created:2026-08-27..2026-09-03` | 50 | false |
| `"context engineering" created:2026-08-20..2026-08-27` | 48 | false |
| `"context engineering" created:2026-08-04..2026-09-03` | 206 | false |
| `"context engineering" in:readme created:2026-08-27..2026-09-03` | 456 | false |
| `agent created:2026-08-27..2026-09-03` | 46,287 | false |
| `/search/issues` `"context engineering" created:2026-08-27..2026-09-03` | 1,841 | false |

直近7日の1位：`PerceptivePenguin/PPenguinAgents`（`created_at: 2026-08-27T07:11:20Z`、stars 3）

**`in:readme` を付けると9倍になる（50 → 456）。** リポジトリ検索の既定スコープは名前と説明が中心で、README は含まれていないと読める。公式ドキュメントは「Besides using `in:readme`, it's not possible to find repositories by searching for specific content within the repository.」とだけ書いており、既定スコープの明示は無い（**既定スコープの正確な定義は未確認**）。**指標として使うなら `in:readme` を付ける／付けないを固定し、途中で変えない。**

### 2.7 Search code：README の新語検出には使えない

未認証での実測：

```json
{"message":"Requires authentication","status":"401","documentation_url":"https://docs.github.com/rest"}
```

公式の制約（出典：https://docs.github.com/en/search-github/searching-on-github/searching-code 、確認日 2026-09-03）：

- サインイン必須
- **既定ブランチのみ**が索引対象
- **384KB 未満のファイルのみ**検索可能
- fork は「親より star が多く、作成後に push が1つ以上ある」場合のみ索引
- 非公開は最大4,000リポジトリ
- **50万ファイル未満**のリポジトリのみ
- **直近1年に活動があるか検索結果に出たリポジトリのみ**
- アーカイブ済みリポジトリは対象外
- `filename` 検索以外は検索語が1つ以上必須
- 同一ファイルから返る断片は最大2つ

さらに、この記事自体が「legacy code search の構文で、REST の code search API 用にだけ必要」と注記している。

**結論：索引の網羅性が担保されず、認証必須で 10 リクエスト/分。README 内の新語を数える用途には向かない。`in:readme` 付きのリポジトリ検索で代替する。**

### 2.8 Trending の公式 API は存在しない

- `https://api.github.com/` のルートが返すキーは33個。`trend` を含むキーは**ゼロ**（実測 2026-09-03）。検索系は `code_search_url` / `commit_search_url` / `issue_search_url` / `label_search_url` / `repository_search_url` / `topic_search_url` / `user_search_url` の7つのみ。
- GitHub 自身のドキュメントも「You can browse popular repositories of the day by visiting [Trending](https://github.com/trending).」と Web ページを案内するに留まる（出典：github/docs `content/get-started/exploring-projects-on-github/finding-ways-to-contribute-to-open-source-on-github.md`、確認日 2026-09-03）。

**代替案：**

| 代替 | 内容 | 評価 |
|---|---|---|
| `created:` + `stars:` の組み合わせ | 「直近N日に作られて star がM以上」を検索。API 1回で済む | **MVP はこれで十分** |
| GitHub Topics | `topic:` 修飾子、`/search/topics` エンドポイント。`github.com/topics/<topic>` も公式に案内あり | 語彙の発見に補助的に使える |
| GH Archive | 公開イベントタイムラインの記録。`https://data.gharchive.org/YYYY-MM-DD-HH.json.gz` で時間単位に取得。2011-02-12 以降。BigQuery の公開データセット `githubarchive` でも提供（BigQuery は月1TBまで無料）。出典：https://www.gharchive.org/ 、確認日 2026-09-03 | 精度は最高だが、ローカル動作の個人ツールには重い。**P2** |
| Trending ページのスクレイピング | — | **不可**（後述の規約） |

### 2.9 規約

**GitHub 利用規約 Section H「API Terms」**（出典：https://docs.github.com/en/site-policy/github-terms/github-terms-of-service 、確認日 2026-09-03）：

> Abuse or excessively frequent requests to GitHub via the API may result in the temporary or permanent suspension of your Account's access to the API. GitHub, in our sole discretion, will determine abuse or excessive usage of the API. We will make a reasonable attempt to warn you via email prior to suspension.
> You may not share API tokens to exceed GitHub's rate limitations.
> You may not use the API to download data or Content from GitHub for spamming purposes, including for the purposes of selling GitHub users' personal information, such as to recruiters, headhunters, and job boards.
> GitHub may offer subscription-based access to our API for those Users who require high-throughput access or access that would result in resale of GitHub's Service.

**Acceptable Use Policies 第7項「Information Usage Restrictions」**（出典：https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies 、確認日 2026-09-03）：

> Scraping refers to extracting information from our Service via an automated process, such as a bot or webcrawler. Scraping does not refer to the collection of information through our API.
> Researchers may use public, non-personal information from the Service for research purposes, only if any publications resulting from that research are open access.
> Archivists may use public information from the Service for archival purposes.
> You may not use information from the Service (whether scraped, collected through our API, or obtained otherwise) for spamming purposes...

**本プロダクトへの当てはめ：**

- API 経由の取得はスクレイピングに当たらない。個人利用・調査目的・ローカル動作なら Section H に抵触しない。
- **Trending ページの HTML スクレイピングは避ける。** AUP 上の scraping に該当し、研究（オープンアクセス公開が条件）にも archival にも当てはまらない。
- リポジトリ名・説明・README の集計はリポジトリの公開メタデータであり、個人情報の販売にも当たらない。
- 商用化・高スループット化する段階になったら Section H の「subscription-based access」を検討する必要がある。

---

## 3. Reddit

### 3.1 結論：MVP では使わない

理由は3つ。規約、実挙動、集計コストのすべてが噛み合わない。

### 3.2 規約：OAuth が必須

**Reddit Data API Terms**（出典：https://www.redditinc.com/policies/data-api-terms 、Effective June 19, 2023 / **Last Revised July 20, 2026**、確認日 2026-09-03）

該当条項の原文：

- **1.3 Contact Information**「In order to access the Data APIs, you are required to provide identification information (e.g., contact details). This information must be up to date and accurate at all times.」
- **2.8 Permitted Access**「You will only access (or attempt to access) Data APIs using Access Info described in the Developer Documentation for the Data APIs. You must use the Access Info we provided you (e.g., the OAuth token) when accessing the Data APIs, and you will not misrepresent or mask either the user agent or OAuth identity when using the Data APIs.」
- **2.9 API Limitations**「Reddit may set and enforce limits on your use of the Data APIs (e.g., limiting the number of API requests that you may make or the number of App Users you may serve), in our sole discretion.」
- **3.1 Fees**「If you are interested in using the Data APIs for commercial purposes, research in excess of rate limits, or for any use that is not expressly permitted under the Data API Terms, then you will need to enter into a separate agreement with Reddit.」
- **3.2 Restrictions**「circumvent or exceed limitations on calls and use of the Data APIs as outlined in the Developer Documentation...（中略）...Reddit reserves the right to permanently block your access to the Data APIs」
- **2.4 User Content**「no other rights or licenses are granted or implied, including any right to use User Content for other purposes, such as for training a machine learning or AI model, without the express permission of rightsholders」
- **3.2**「use or retain any User Content, Materials, or data accessed through the Data APIs beyond your approved use case, and you must immediately delete any data not required for it」

**Reddit Data API Wiki**（出典：https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki 、記事更新日 2026-08-31、確認日 2026-09-03）

- 「Reddit requires OAuth for authentication」
- 「**Clients must authenticate with a registered OAuth token. We can and will freely throttle or block unidentified Data API users.**」
- 「**Our robots.txt is for search engines, not Data API users.**」
- User-Agent の形式：`<platform>:<app ID>:<version string> (by /u/<reddit username>)`。例：`android:com.example.myredditapp:v1.2.3 (by /u/kemitche)`。「Many default User-Agents (like "Python/urllib" or "Java") are drastically limited」「NEVER lie about your User-Agent.」
- 削除されたコンテンツの削除義務。「we strongly recommend routinely deleting any stored user data and content within 48 hours」

**レート制限（原文）：**

> We enforce rate limits for those eligible for free access usage of our Data API. The limit is:
> **100 queries per minute (QPM) per OAuth client id**
> QPM limits will be an average over a time window (currently 10 minutes) to support bursting requests.
> ...
> **Traffic not using OAuth or login credentials will be blocked, and the default rate limit will not apply.**

監視すべきヘッダは `X-Ratelimit-Used` / `X-Ratelimit-Remaining` / `X-Ratelimit-Reset`。

**未認証 `.json` の「10 QPM」については、現行の公式文書で確認できなかった（未確認）。** 現行の記述は「OAuth を使わないトラフィックはブロックし、既定のレート制限は適用しない」であり、数値の枠が与えられているのではなく遮断対象とされている。なお旧公式 wiki のミラー（https://github.com/reddit-archive/reddit/wiki/API 、確認日 2026-09-03）には「Clients connecting via OAuth2 may make up to 60 requests per minute」とあるが、これは現行ヘルプの100 QPM に置き換わった旧値と読むのが妥当。

**robots.txt**（https://www.reddit.com/robots.txt 、確認日 2026-09-03、全文）：

```
# Welcome to Reddit's robots.txt
# Reddit believes in an open internet, but not the misuse of public content.
# See https://support.reddithelp.com/hc/en-us/articles/26410290525844-Public-Content-Policy ...
User-agent: *
Disallow: /
```

**Public Content Policy**（記事更新日 2026-09-02、確認日 2026-09-03）：「you can use Reddit content for non-commercial uses, such as learning and community, but talk to us if you have commercial purposes in mind」

### 3.3 実測：未認証 `.json` は 403 で返る

2026-09-03 04:0x UTC の実測。すべて GET のみ。

| リクエスト | 結果 |
|---|---|
| `https://www.reddit.com/r/<sub>/about.json`（ブラウザ UA） | **HTTP 403**（7サブレディットすべて） |
| `https://www.reddit.com/r/LocalLLaMA/about.json`（Reddit 推奨形式 UA） | **HTTP 403** |
| `https://www.reddit.com/r/LocalLLaMA/search.json?q=...&restrict_sr=1&sort=new&t=week&limit=100` | **HTTP 403**、`retry-after: 0` |
| `https://old.reddit.com/r/LocalLLaMA/about.json` | HTTP 404 |
| `https://www.reddit.com/r/LocalLLaMA/`（HTML） | HTTP 200（8,410バイトの SPA シェル） |

403 応答には `x-ratelimit-*` ヘッダは付かない。**レート制限に当たっているのではなく、未認証トラフィックそのものが遮断されている**と読める。公式ヘルプの記述と一致する。

### 3.4 subreddit 名の確認：未確認

`.json` が 403 のため、API では確認できなかった。

HTML ページは対象7件（AI / MachineLearning / LocalLLaMA / programming / startups / singularity / technology）と追加4件（artificial / LocalLLM / OpenAI / ClaudeAI / ArtificialInteligence）のすべてが HTTP 200 を返した。ただし**対照実験として存在しないはずの `r/zzzz_not_a_real_subreddit_9x8y7z` と `r/thisdoesnotexist_qqq123` も HTTP 200 を返した**（8,432 / 8,423バイト）。したがって **HTML のステータスコードは実在確認の手段にならない。**

**確認するなら OAuth トークンを取得して `GET /r/<sub>/about` か `GET /api/search_reddit_names` を呼ぶしかない。** 本調査ではトークン取得（POST）を行わないため未確認のままとする。

### 3.5 検索エンドポイントの仕様（公式）

出典：https://www.reddit.com/dev/api （Reddit 公式のライブ API ドキュメント。確認日 2026-09-03）

```
GET [/r/subreddit]/search      scope: read      （listing）
```

| パラメータ | 値 |
|---|---|
| `q` | 512文字以内の文字列 |
| `restrict_sr` | 真偽値（そのサブレディットに限定するか） |
| `sort` | `relevance` / `hot` / `top` / `new` / `comments` |
| `t` | `hour` / `day` / `week` / `month` / `year` / `all` |
| `limit` | 既定25、**最大100** |
| `type` | `sr` / `link` / `user` のカンマ区切り |
| `after` / `before` / `count` | ページング |
| `include_facets` / `category` / `sr_detail` / `show` | その他 |

**総件数を返すフィールドが無い。** listing 形式なので `after` を辿ってページングし、自分で数えるしかない。

### 3.6 仮に採用する場合のリクエスト例（未実行）

トークン取得は POST になるため本調査では実行していない。

```bash
# ① アプリ登録（https://www.reddit.com/prefs/apps で "script" タイプを作成）→ client_id / client_secret を得る
# ② アプリ専用 OAuth（client_credentials）でトークンを取得 ※POST
#    POST https://www.reddit.com/api/v1/access_token
#         -u "<client_id>:<client_secret>" -d "grant_type=client_credentials"
#         -H "User-Agent: macos:emerging-domain-radar:v0.1 (by /u/<username>)"

# ③ 直近7日の言及を取得（oauth.reddit.com を使う）
curl -sS -G 'https://oauth.reddit.com/r/LocalLLaMA/search' \
  -H "Authorization: Bearer $REDDIT_TOKEN" \
  -H 'User-Agent: macos:emerging-domain-radar:v0.1 (by /u/<username>)' \
  --data-urlencode 'q="context engineering"' \
  --data-urlencode 'restrict_sr=1' \
  --data-urlencode 'sort=new' \
  --data-urlencode 't=week' \
  --data-urlencode 'limit=100' \
  | jq '{n: (.data.children|length), after: .data.after}'
# → after が null になるまで繰り返して合計する。100件超なら複数リクエストが必要
```

30日窓は `t=month` に置き換える。ただし `t` の刻みは hour/day/week/month/year/all しかないので、**「直近30日」を厳密には切れない**。`created_utc` を見てクライアント側で絞り込むことになる。

対象候補サブレディット7件で7日窓と30日窓を1語ぶん取るだけで、最良でも 7 × 2 = 14 リクエスト。ヒットが100件を超えればページングでさらに増える。**HN が1語1リクエストで済むのと比べて桁違いに重い。**

### 3.7 Pushshift：モデレーター限定

出典：https://support.reddithelp.com/hc/en-us/articles/16470271632404-Pushshift-Access-Request （記事更新日 2026-08-21、確認日 2026-09-03）

> Reddit is partnering with Pushshift to grant access to community-enabled moderation tools developed through the Pushshift API, which will be reinstated for verified Reddit moderators.
> Each moderator will also need explicit approval from Reddit, and the use of Pushshift will be limited to moderation use cases only.

申請は `r/pushshiftrequest` へのモッドメール。承認後に https://api.pushshift.io/signup でキーを取得する。

**本プロダクトはモデレーション用途ではないため、対象外。**

### 3.8 研究利用：Reddit for Researchers

出典：https://support.reddithelp.com/hc/en-us/articles/49381918834964-Reddit-for-Researchers-Program （記事更新日 2026-08-28、確認日 2026-09-03）

- 認定大学に所属し、機関のメールアドレスで申請すること
- 研究計画書、IRB など倫理審査の承認・免除証明、所属機関の推薦が必要
- 「Access is limited to sponsored academic researchers affiliated with higher education institutions conducting non-commercial research.」
- 承認期間は最長1年

**個人プロジェクトでは要件を満たさない。**

---

## 4. 3ソース横断比較

| 観点 | HN（Algolia） | GitHub Search | Reddit Data API |
|---|---|---|---|
| 認証 | 不要 | 任意（推奨） | **必須（OAuth）** |
| 期間内の総件数 | `nbHits` を1リクエストで取得 | `total_count` を1リクエストで取得 | **総件数フィールド無し**。ページングして数える |
| 7日窓の切り方 | `created_at_i` のエポック秒範囲（秒単位で厳密） | `created:...T..Z..` の ISO8601 範囲（秒単位で厳密） | `t=week` のみ（刻みが粗い） |
| 30日窓の切り方 | 同上（厳密） | 同上（厳密） | `t=month` ＋クライアント側フィルタ |
| レート制限 | 10,000 req/時/IP | 未認証 10 req/分・認証済み 30 req/分 | 100 QPM / client id（10分平均） |
| 1語あたりのリクエスト数 | **1**（窓ごと） | **1**（窓ごと） | 7サブレディット × 窓数 × ページ数 |
| 件数の厳密性 | 低頻度語は厳密、高頻度語は概算（`exhaustiveNbHits`） | `incomplete_results` で判定 | 自前カウントなので厳密（ただし高コスト） |
| 規約上の個人・調査利用 | 明文なし（**未確認**） | API 経由なら可 | **商用は別契約が必要。未認証は遮断** |
| ブラウザから直接呼べるか | 可（`access-control-allow-origin: *`） | 可（`access-control-allow-origin: *`） | 不可（トークンを露出させられない） |
| 実測での動作 | 正常 | 正常 | **未認証は 403** |

---

## 5. MVP での採用推奨

### P0：Hacker News Algolia Search API

理由は3つ。**（1）認証が要らない**ので、ローカル動作の個人ツールに一番早く組み込める。**（2）1語1リクエストで期間内の件数が返る**ので、100語のウォッチリストを7日窓・30日窓で回しても200リクエスト、公式上限 10,000 req/時 の2%で済む。**（3）新語が最初に出る場所**であり、目的（新興技術トレンドの検出）と情報源の性質が合っている。

実装時に必ず守ること：

- フレーズは必ずダブルクォートで囲む
- `exhaustiveNbHits` を読み、false なら「概算」と表示する
- 取得結果はローカルにキャッシュし、同じ語の同じ窓を1日に2回以上叩かない
- `User-Agent` に連絡可能な識別子を入れる（規約要求ではないが、ブラックリスト入りしたときの復旧が早い）

### P1：GitHub Search repositories

理由：**HN が「話題になったか」を測るのに対し、GitHub は「作られたか」を測る**。この2つは別の信号で、片方だけでは新語の実体を見誤る。実測でも `"context engineering"` は HN 5件に対して GitHub 50件と、感度が違った。

実装時に必ず守ること：

- 権限ゼロの fine-grained PAT を入れて 30 req/分・5,000 req/時 の枠を使う
- `created:` は ISO8601 のタイムスタンプ範囲で指定する
- `in:readme` を付けるかどうかを決めて固定する（付けると件数が約9倍になり、途中で変えると時系列が壊れる）
- `incomplete_results: true` の結果は指標に採用しない
- Trending ページの HTML スクレイピングはしない

### P2：GH Archive（BigQuery / hourly JSON）

理由：Search API では取れない「イベントの粒度」（star が付いた瞬間、リポジトリが作られた瞬間）を持つ。速度の一次微分・二次微分を出したくなったときに効く。ただし **1時間ごとの JSON.gz を落として集計するか BigQuery を叩くことになり、ローカル動作の個人ツールには重い**。MVP には入れず、指標の精度が問題になってから足す。

---

## 6. 採用しない理由

### Reddit Data API — MVP では採用しない

1. **規約がクリアできない。** Data API Terms 2.8 が OAuth トークンでのアクセスを義務づけ、公式ヘルプが「OAuth を使わないトラフィックはブロックする」と明記している。個人利用でも認証は免除されない。
2. **実測で 403。** ブラウザ UA でも Reddit 推奨形式の UA でも、`.json` はすべて 403 を返した。「動くけれど規約がグレー」ではなく、そもそも動かない。
3. **件数集計のコストが桁違い。** 検索エンドポイントに総件数フィールドが無く、`limit` 上限100でページングするしかない。HN の1語1リクエストに対し、7サブレディット × 2窓 × ページ数が必要になる。
4. **将来の商用化で必ず引っかかる。** 3.1 が商用利用に別契約を要求している。個人ツールから育てる前提なら、初めから依存しないほうが安全。
5. **データ保持義務が重い。** 削除されたコンテンツの削除義務があり、48時間以内の定期削除が推奨されている。ローカルにキャッシュを持つ設計と噛み合わない。

**再検討の条件：** Reddit の信号がどうしても必要になったら、`script` タイプのアプリを登録し、client_credentials でトークンを取り、ウォッチリストを10語程度に絞ったうえで日1回だけ回す。その時点で 3.1（商用の別契約）と 3.2（承認済みユースケース外のデータ保持禁止）を再読する。

### HN 公式 Firebase API — 採用しない

全文検索の口が無い。件数を数えるには全アイテムを走査して自前で索引を張ることになり、Algolia が同じことを1リクエストで返してくれる以上、MVP で持つ理由がない。**個別アイテムの正確なメタデータ（score や descendants の最新値）が必要になったときだけ、Algolia の結果に含まれる `objectID` を使って引きにいく補助として使う。**

### GitHub Search code — 採用しない

認証必須で 10 リクエスト/分。加えて既定ブランチのみ・384KB未満・50万ファイル未満・直近1年に活動あり・アーカイブ済み除外という索引条件があり、**「網羅的に数えた」と言える指標にならない**。README 内の言及は `in:readme` 付きのリポジトリ検索で代替する。

### GitHub Trending のスクレイピング — 採用しない

公式 API が存在せず（`api.github.com` ルートに trending 系キーなし）、HTML の取得は AUP 第7項の scraping に該当する。研究（オープンアクセス公開が条件）にも archival にも当てはまらない。`created:` + `stars:` の組み合わせで代替する。

---

## 7. 未確認事項

推測と確認済みを分けるため、公式に裏が取れなかったものを列挙する。

| 項目 | 状態 |
|---|---|
| HN Algolia API の利用規約・帰属表示義務 | **未確認**。ドキュメントページに規約リンクが無い。外部リンクは Algolia 製品ページと GitHub リポジトリのみ |
| HN 公式 Firebase API のライセンス・利用規約 | **未確認**。README に記述なし |
| HN Algolia の `typoTolerance` パラメータ | Algolia 共通パラメータとしては存在するが、**HN のドキュメントには記載なし**。挙動は未実測 |
| GitHub リポジトリ検索の既定検索スコープの正確な定義 | **未確認**。`in:readme` の有無で件数が約9倍変わることは実測したが、既定で何が検索対象かの明示的な記述は見つからなかった |
| GitHub 認証済みリクエストのレート制限の実測値 | **未実測**（PAT を使わなかったため）。公式値のみ記載 |
| Reddit 未認証 `.json` の「10 QPM」枠 | **未確認**。現行の公式記述は「OAuth を使わないトラフィックはブロックする」であり、数値の枠は示されていない |
| Reddit の対象 subreddit 7件の実在と正式名称 | **未確認**。`.json` が 403、HTML は存在しない名前でも 200 を返すため確認手段がない。OAuth トークン取得後に `GET /r/<sub>/about` で確認する必要がある |
| Reddit の `search` エンドポイントの実応答形式 | **未実測**（403 のため）。パラメータ仕様は公式ドキュメントで確認済み |
| GH Archive のライセンス・利用規約 | **未確認**。サイト上に明示的な記述が見つからなかった |

---

## 参考：本調査で叩いたエンドポイント一覧

すべて GET・認証なし。

- `https://hn.algolia.com/api/v1/search_by_date`（14回）
- `https://hn.algolia.com/api/v1/search`（1回）
- `https://hacker-news.firebaseio.com/v0/maxitem.json`、`/v0/item/8863.json`
- `https://api.github.com/search/repositories`（7回）、`/search/code`（1回）、`/search/issues`（1回）、`/rate_limit`（1回）、`/`（1回）
- `https://raw.githubusercontent.com/github/docs/main/content/...`（5ファイル）、`https://raw.githubusercontent.com/HackerNews/API/master/README.md`
- `https://www.redditinc.com/policies/data-api-terms`、`/developer-terms`
- `https://support.reddithelp.com/api/v2/help_center/...`（記事4件＋検索2回）
- `https://www.reddit.com/robots.txt`、`/dev/api`、`/r/<sub>/`（14件）、`/r/<sub>/about.json`（8件・すべて403）
- `https://github.com/reddit-archive/reddit/wiki/API`、`/wiki/OAuth2`
- `https://hn.algolia.com/api`、`https://hn.algolia.com/public/main-6e634771f729331a3c3c.js`
