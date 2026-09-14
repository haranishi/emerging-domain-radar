# 調査D：日本未上陸度の情報源 / 為替API / 新興語検出の方法論 / 商標チェック / ドメイン名品質

対象プロダクト：新興技術トレンド × 空き .com ドメイン発見ツール（購入機能なし・調査専用・個人利用・ローカル動作・Next.js/TypeScript）
調査日：2026-09-03（本文中の「確認日」はすべてこの日）
実測方法：認証不要の GET のみ（curl）。POST・認証付き・アカウント作成・購入系は一切呼んでいない。

---

## TL;DR

1. 日本語圏の言及数は **Qiita API v2 と Wikipedia（Action API + Pageviews API）の2本柱**で足りる。両方とも1リクエストで件数が返り、公式ドキュメントがあり、キー不要。
2. Qiita は `Total-Count` ヘッダーに全件数が入る。実測：`MCPサーバー created:>=2026-08-27` で 141 件（確認日 2026-09-03）。未認証 60 req/h、認証 1000 req/h。
3. **Google News RSS は採用しない。** フィード本文の著作権表記が「personal feed reader での個人・非商用利用に限る。それ以外の利用は明確に禁止」と明記している（実測で取得）。
4. **はてなブックマークの検索RSSは動くが件数が取れない**（1ページ40件固定・総件数フィールドなし）。Zenn・note は公式APIが無く、note は `robots.txt` で `/api/*` を Disallow。連携するなら Zenn のみ、慎重に。
5. connpass API v2 はキー必須（申請制・個人は無償）。Yahoo!リアルタイム検索は API が存在しない（Yahoo!デベロッパーネットワークのAPI一覧に無い）。
6. 為替は **Frankfurter v2（api.frankfurter.dev）が第一候補**。キー不要・CORS可・`expand=providers` で「どの中央銀行の何日のレートを混ぜたか」が全部返る＝出典明記の要件をそのまま満たす。
7. Frankfurter は 2026-09 時点で **ECB専用ではなく84中央銀行のブレンド**に変わっている。ECB だけが欲しければ `providers=ECB` を付ける。旧 `api.frankfurter.app` は 301 で新ホストへ転送される。
8. 予備は `open.er-api.com`。`time_last_update_utc` / `time_next_update_utc` / `provider` を返すので出典明記に向くが、**帰属表示リンクが必須**で再配布は禁止。
9. Google Trends の "Breakout" は公式に **+5,000% 超**の意味。ただし低ボリューム語は 0 として扱われるため、伸び率だけを信じると少数ノイズを拾う。
10. Trend Score は **成長率（Laplace平滑化つき）・加速度・ソース数・早さ（絶対数の小ささ）の4成分の加重和**で作る。式は §3.4 にそのまま実装できる形で置いた。
11. Status は Trend Score とは**別軸**にする。Early / Emerging / Rising / Trending / Mainstream ＋ Fading を、30日件数と成長率の順序付きルールで判定する（§3.5）。
12. **商標の自動判定は MVP では不可能**。USPTO TSDR も特許庁APIも WIPO も、キーワード検索を機械で叩ける無料の口が無い（TSDR・USPTO ODP はキー必須で401、特許庁APIは2024-08-09に新規申込受付終了）。
13. WIPO Global Brand Database は利用規約で **automated queries と web scraping を明示的に禁止**、1IPあたり毎分10検索超を過剰利用とみなす。自動化は規約違反。
14. 商標は**「手動確認用リンクを1クリックで開ける」までが MVP の上限**。各サイトはSPAで、URLに検索語を付けても200が返るのは殻だけ（HTML内に検索語は現れない）。ブラウザで実際に検索が走るかは未検証。
15. Domain Score は **長さ・発音・綴り・キーワード一致・構造・記憶しやすさ・価格の7成分**で構成する（§5.4）。GoDaddy 等の商用評価ロジックは非公開なので流用できない。

---

## 1. 日本語圏の言及数を測る無料ソース

### 1.1 結論

Qiita と Wikipedia を主軸に据え、はてなブックマークを補助にする。Google News RSS・note・Yahoo!リアルタイム検索は外す。

### 1.2 比較表

| ソース | 公式API | キー | 件数が1発で取れるか | レート制限 | 規約上の可否 | 判定 |
|---|---|---|---|---|---|---|
| Qiita API v2 | あり | 不要（任意で付与可） | **取れる**（`Total-Count` ヘッダー） | 未認証 60 req/h・認証 1000 req/h | API利用はOK。スクレイピングは明示的に禁止。広告での収益化は規約違反 | **P0** |
| Wikipedia 日本語版 Action API | あり | 不要 | 取れる（存在有無・初版日時） | 明示的な数値上限は未確認 | 内容は CC BY-SA。User-Agent 必須 | **P0** |
| Wikimedia Pageviews API | あり | 不要 | 取れる（日次/月次PV） | 明示的な数値上限は未確認 | User-Agent 無しは **403**（実測） | **P0** |
| はてなブックマーク 検索RSS | 非公式（ドキュメント無し） | 不要 | **取れない**（40件固定・総数なし） | 未確認 | 公式のAPI規約が見当たらない＝未確認 | P2 |
| はてなブックマーク エントリー情報API | 準公式 | 不要 | URL単位のブクマ数のみ | 未確認 | 同上 | P2 |
| Zenn `/api/articles` | **無い**（非公式） | 不要 | 取れない | 未確認 | robots.txt は `/search` のみ Disallow。規約に自動取得の明文なし＝グレー | P2 |
| note `/api/v3/searches` | **無い**（非公式） | 不要 | 取れる（JSONに件数相当） | 未確認 | **robots.txt が `/api/*` を Disallow** | 不採用 |
| Google News RSS | 非公式 | 不要 | **取れない**（100件で頭打ち） | 未確認 | **フィード本文が個人・非商用の feed reader 利用に限定** | 不採用 |
| Yahoo!リアルタイム検索 | **無い** | — | — | — | — | 不採用 |
| connpass API v2 | あり | **必須**（申請制・審査あり） | 取れる | 「一定時間内での連続アクセス回数に制限」（数値非公開） | 個人・コミュニティは無償。API規約に同意が必要 | P2 |

### 1.3 Qiita API v2（実測あり）

公式ドキュメント：https://qiita.com/api/v2/docs （確認日 2026-09-03）

- レート制限の原文：「The limitation count per hour of authenticated request is 1000, and 60 is on non-authenticated request per its IP address.」
- `GET /api/v2/items` のパラメータ：`page`（1〜100）、`per_page`（1〜100、既定20）、`query`。
- `query` は Qiita の検索構文をそのまま受け付ける。日付での絞り込みはドキュメントに `created:>=2020-01 created:<=2020-12` の例がある。

**実測（2026-09-03）**：`per_page=1` を付けて1リクエスト投げるだけで、`Total-Count` に全件数が入って返る。これが決定的に便利で、件数集計のコストが1語あたり1リクエストで済む。

```
GET https://qiita.com/api/v2/items?query=MCPサーバー created:>=2026-08-27&per_page=1

HTTP/2 200
content-type: application/json; charset=utf-8
total-count: 141
rate-limit: 60
rate-remaining: 57
rate-reset: 1788410914
```

同条件での実測値（過去7日、確認日 2026-09-03）：

| クエリ | Total-Count |
|---|---:|
| `MCPサーバー created:>=2026-08-27` | 141 |
| `Model Context Protocol created:>=2026-08-27` | 38 |
| `バイブコーディング created:>=2026-08-27` | 8 |
| `AIエージェント created:>=2026-08-27` | 532 |

レスポンスヘッダーは HTTP/2 なので小文字（`total-count` / `rate-limit` / `rate-remaining` / `rate-reset`）。`rate-reset` は Unix 秒。

**規約**：公式ヘルプ「Qiita API・スクレイピングについて」（https://help.qiita.com/ja/articles/qiita-api ・確認日 2026-09-03）に次の記述がある。

> スクレイピングはサーバーの負荷上昇への懸念があるため、Qiitaへのスクレイピングは許可しておりません。
> Qiita APIでご用意している機能の範囲内でしたら、アプリ等を開発いただいて問題ございません。
> アプリ等に広告を設置して収益化されることに関しては Qiita利用規約 違反となります。

つまり **API経由なら本ツールの用途は問題なし**。ただし `robots.txt` は `/api/*` を Disallow している（`Allow: /api/*/docs$` のみ例外）ので、HTMLを辿るクローラの挙動は避け、API クライアントとして `/api/v2/items` だけを叩く形にする。個人利用・広告なしの本ツールは条件を満たす。

### 1.4 Wikipedia 日本語版（実測あり）

**記事の存在チェック（Action API）**：1リクエストで最大50タイトルまとめて判定できる。

```
GET https://ja.wikipedia.org/w/api.php
  ?action=query&format=json&formatversion=2&redirects=1&prop=info
  &titles=MCP (プロトコル)|Model Context Protocol|バイブコーディング|存在しないテスト語zzz
```

実測レスポンス（2026-09-03）：

| title | 結果 |
|---|---|
| 存在しないテスト語zzz | `missing: true` |
| MCP (プロトコル) | `missing: true` |
| バイブコーディング | `pageid: 5059134`, `touched: 2026-08-30T04:58:11Z` |
| Model Context Protocol | `pageid: 5091930`, `touched: 2026-08-25T10:51:35Z` |

**初版日時＝日本語圏への上陸日の代理指標**として使える。`prop=revisions&rvdir=newer&rvlimit=1&rvprop=timestamp` で取得できる。実測：「バイブコーディング」の初版は `2025-03-18T23:46:45Z`。

**落とし穴：リダイレクトを解決しないとPVが桁違いにずれる。**
Action API で `redirects=1` を付けると「AIエージェント」は「知的エージェント」へ解決される。Pageviews API はリダイレクト元と先を別カウントするため、解決前後で値が大きく変わる。

| 記事名 | 2026年8月の月次PV（all-access / user） |
|---|---:|
| AIエージェント（リダイレクト元） | 55 |
| 知的エージェント（リダイレクト先） | 841 |

**必ず Action API で正規タイトルへ解決してから Pageviews を引く。**

**Pageviews API**：

```
GET https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/
    ja.wikipedia/all-access/user/{URLエンコード済みタイトル}/daily/20260801/20260831
```

実測ヘッダー（2026-09-03）：

```
HTTP/2 200
content-type: application/json; charset=utf-8
cache-control: s-maxage=14400, max-age=14400
access-control-allow-origin: *
access-control-allow-methods: GET,HEAD
```

CORS が全開なのでブラウザから直接呼べる。4時間キャッシュ。

**User-Agent は必須**。Wikimedia の User-Agent ポリシー（https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy ・確認日 2026-09-03）は、連絡先を含む説明的な UA を求め、無いものは 403 で弾くと定めている。推奨形式は `<client name>/<version> (<contact information>) <library/framework name>/<version>`。

**実測で確認**：`-H 'User-Agent:'`（UA を空にする）で同じエンドポイントを叩くと **403** が返った。`curl` や `Python-urllib` のような既定値もポリシー上は禁止されている。

具体的な req/sec 上限の数値は、Wikimedia の公開ドキュメント上で明示されたものを確認できなかった（**未確認**）。実装側で 1 req/sec 程度に自主的に絞り、`cache-control: max-age=14400` に合わせてローカルキャッシュを持つ。

### 1.5 Google News RSS（採用しない）

**実測でフィードを取得したところ、フィード本文の `<copyright>` 要素にこう書かれていた**（2026-09-03取得）。

> Copyright © 2026 Google. All rights reserved. This XML feed is made available solely for the purpose of rendering Google News results within a personal feed reader for personal, non-commercial use. Any other use of the feed is expressly prohibited. By accessing this feed or using these results in any manner whatsoever, you agree to be bound by the foregoing restrictions.

「personal feed reader でGoogle Newsの結果をレンダリングする目的に限る。それ以外の利用は明確に禁止」。トレンド集計ツールのデータソースとして使うのは「それ以外の利用」に当たると読むのが自然なので、**採用しない**。

なお技術的な制約も大きい。実測でどのクエリでも `<item>` はちょうど100件で頭打ちになり（「バイブコーディング」100件・「MCPサーバー」100件）、総件数フィールドが無い。件数指標としては 100 で飽和して使いものにならない。

### 1.6 はてなブックマーク（P2・補助）

- 検索RSS：`https://b.hatena.ne.jp/search/text?q={語}&mode=rss&users=1` は **301** で `https://b.hatena.ne.jp/q/{語}?target=text&users=1&mode=rss` へ転送され、RSS 1.0（RDF）が返る（実測 2026-09-03、274KB）。
- **`<item>` はちょうど40件**で、`openSearch:totalResults` のような総件数要素は含まれない（実測）。件数の指標にするには複数ページを辿る必要があり、コストの割に精度が出ない。
- エントリー情報API `https://b.hatena.ne.jp/entry/jsonlite/?url=...` は 200 でJSONを返す（実測）。ブックマーク数カウントの `https://bookmark.hatenaapis.com/count/entry?url=...` は数値をプレーンテキストで返す（実測：`https://qiita.com/` → 2630）。
- **これらの公式なAPI規約ページを特定できなかった（未確認）。** 用途がURL単位のブクマ数取得に限られ、語の言及数集計には向かないため P2 に置く。

### 1.7 Zenn / note / Yahoo!リアルタイム検索 / connpass

**Zenn**：公式APIは存在しない（公式ドキュメントを確認できず＝**未確認だが、存在の証拠が無い**）。非公式の `https://zenn.dev/api/articles?count=1&order=latest` は 200 で JSON を返す（実測）。`robots.txt` は `/search` のみ Disallow で `/api` は禁止していない。利用規約（https://zenn.dev/terms ・確認日 2026-09-03）にスクレイピング・自動取得を名指しで禁じる条項は見つからなかった。ただし公式に約束されたインターフェースではないので、壊れる前提で P2。

**note**：公式APIは存在しない。非公式の `https://note.com/api/v3/searches?context=note&q=...` は 200 で JSON を返す（実測）が、**`robots.txt` が `Disallow: /api/*` を明記している**（実測 2026-09-03）。利用規約本文は 403 で取得できず内容は未確認だが、robots.txt の明示的な拒否だけで採用しない理由として十分。

**Yahoo!リアルタイム検索**：Yahoo!デベロッパーネットワークのAPIドキュメント一覧（https://developer.yahoo.co.jp/sitemap/ ・確認日 2026-09-03）に掲載されているのは「ショッピング」「YOLP(地図)」「テキスト解析」「ニュース（建設的コメント順位付けAI）」「Yahoo! ID連携」「メール」のみ。**リアルタイム検索のAPIは存在しない**（実測でページ内に該当記載なし）。

**connpass API v2**：
- 公式ドキュメント：https://help.connpass.com/api/ （確認日 2026-09-03）
- **APIキー必須**。「connpass運営から発行されるAPIキーをリクエストヘッダーに設定してアクセス」。
- 「利用申請を行なっていただくことで、無償でご利用いただけます。」申請フォーム経由で、**APIキーは1つのみ発行**。
- レート制限は「APIキーごとに一定時間内での連続アクセス回数に制限がある」とあるのみで、**具体的な数値は非公開**。
- 実測：キー無しで `https://connpass.com/api/v2/events/?keyword=MCP&count=1` を叩くと **401 `{"detail": "Unauthorized"}`**。v1 は **403**（廃止済み）。
- API利用規約（https://help.connpass.com/api/api-term ・確認日 2026-09-03）は全18条＋コミュニティ・個人向け個別規定という構成で、利用者情報の登録・禁止行為・データの取扱いを定めている。

イベント名に新語が現れるかという当初の狙いは筋が良い（勉強会は技術ワードの初出が早い）が、**申請と審査が挟まる**ため MVP には重い。P2。

---

## 2. 為替（USD→JPY）の無料API

### 2.1 結論

**Frankfurter v2 を第一候補、open.er-api.com を予備**にする。どちらもキー不要・CORS可・出典と時刻を応答に含められる。

### 2.2 比較表

| API | ホスト | キー | 出典の明記 | 取得時刻の明記 | 更新頻度 | CORS | 制約 |
|---|---|---|---|---|---|---|---|
| **Frankfurter v2** | `api.frankfurter.dev` | 不要 | **`expand=providers` で各中央銀行のキー・日付・レートを列挙** | 各行に `date` | 日次（プロバイダごと） | 実測未確認（`Access-Control-Allow-Origin` はヘッダーに出ず） | オープンソース・自己ホスト可 |
| Frankfurter v1 | `api.frankfurter.dev/v1` | 不要 | 無し（`base`/`date` のみ） | `date` | 日次 | 同上 | v2 へ移行推奨 |
| open.er-api.com | `open.er-api.com/v6` | 不要 | `provider` フィールド | `time_last_update_utc` / `time_next_update_utc` | **1日1回** | **`Access-Control-Allow-Origin: *`**（実測） | **帰属表示リンク必須・再配布禁止** |
| ExchangeRate-API Free | `v6.exchangerate-api.com` | **必要** | — | — | 1日1回 | — | 1,500 req/月 |
| ECB 直接（XML） | `www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml` | 不要 | ECB そのもの | `time` 属性 | 平日 16:00 CET 頃 | 未確認 | **EUR基準のみ**＝USD→JPY は自分でクロス計算 |

### 2.3 Frankfurter（実測あり）

公式ドキュメント：https://frankfurter.dev/ （確認日 2026-09-03）

> Frankfurter tracks daily exchange rates from 84 central banks, covering 201 currencies back to 1948. The public API lives at api.frankfurter.dev. It requires no API key. The project is open source, so you can also self-host for full control.

**重要な変更点**：Frankfurter を「ECBのデータを配るAPI」と説明した記事が多いが、2026-09 時点の v2 は **84の中央銀行のレートをブレンド**して返す。ECB のレートだけが欲しい場合は `providers=ECB` を明示する。

実測（2026-09-03）：

```
GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=JPY
→ [{"date":"2026-09-03","base":"USD","quote":"JPY","rate":159.87}]

GET https://api.frankfurter.dev/v2/rates?base=USD&quotes=JPY&providers=ECB
→ [{"date":"2026-09-02","base":"USD","quote":"JPY","rate":159.6}]

GET https://api.frankfurter.dev/v1/latest?base=USD&symbols=JPY   （旧v1・現役）
→ {"amount":1.0,"base":"USD","date":"2026-09-02","rates":{"JPY":159.6}}
```

**「取得元・取得時刻を明記」という要件は `expand=providers` が完璧に満たす。** 実測レスポンス（抜粋）：

```json
[{"date":"2026-09-03","base":"USD","quote":"JPY","rate":159.85,
  "providers":[
    {"key":"AMCM","date":"2026-09-03","rate":158.71},
    {"key":"BOJ", "date":"2026-09-01","rate":159.99},
    {"key":"ECB", "date":"2026-09-02","rate":159.6},
    {"key":"FRED","date":"2026-08-28","rate":159.97},
    {"key":"BCC", "date":"2026-09-03","rate":2562.56,"excluded":true}
  ]}]
```

外れ値には `excluded: true` が付く。`GET /v2/providers` を叩くと各プロバイダの正式名称・国コード・`data_url`・`terms_url`・`publish_cadence` まで返ってくるので、UI に「出典：欧州中央銀行 2026-09-02」と出す材料が揃う。

その他の実測事実：

- **旧ホスト `api.frankfurter.app` は 301 で `api.frankfurter.dev/v1/...` へ転送される**（実測）。新規実装では `.dev` を直接使う。
- 時系列は `?from=2026-08-25&to=2026-09-02&base=USD&quotes=JPY` で取れる。ブレンドなので**土日のレートも返る**（v1 の ECB ベースだと平日のみ）。
- レスポンスヘッダー：`cache-control: public, max-age=71986, stale-if-error=86400`（実測）。約20時間キャッシュ可。
- CSV 出力（`.csv` を付ける）、NDJSON（`Accept: application/x-ndjson`）にも対応。
- レート制限についての記述は公式ドキュメントに見当たらなかった（**未確認**）。ローカルツールで1日1回引く程度なら問題にならない。

### 2.4 open.er-api.com（実測あり）

公式ドキュメント：https://www.exchangerate-api.com/docs/free （確認日 2026-09-03）

実測（2026-09-03）：

```
GET https://open.er-api.com/v6/latest/USD
→ {
    "result": "success",
    "provider": "https://www.exchangerate-api.com",
    "documentation": "https://www.exchangerate-api.com/docs/free",
    "terms_of_use": "https://www.exchangerate-api.com/terms",
    "time_last_update_unix": 1788393751,
    "time_last_update_utc": "Thu, 03 Sep 2026 00:02:31 +0000",
    "time_next_update_utc": "Fri, 04 Sep 2026 00:09:01 +0000",
    "base_code": "USD",
    "rates": { "JPY": 159.088772, ... }   // 166通貨
  }

ヘッダー: access-control-allow-origin: *  /  cache-control: public, max-age=3600
```

**応答自体に出典URL・規約URL・前回更新時刻・次回更新時刻が入っている**ので、出典明記の要件を満たしやすい。CORS も全開。

**規約上の条件（公式ドキュメントの原文）**：

> This open access API is subject to our Terms and requires attribution. You're welcome to cache the data we respond with and to use it for either personal or commercial currency conversion purposes. You are, however, not allowed to re-distribute it.

> **Attribution** — We require attribution on the pages you're using these rates with the link below:
> `<a href="https://www.exchangerate-api.com">Rates By Exchange Rate API</a>`

**レート制限（公式ドキュメントの原文）**：

> If you only request once every 24 hours you won't need to read any more of this section. Easy!
> If you can't keep a cached response for that long, you could still request once every hour and never get rate limited.
> Rate limited IP's will receive HTTP code 429 responses. After 20 minutes the rate limit will finish and new requests will be allowed through.

**採用するなら、UIに帰属表示リンクを出すこと（必須）と、キャッシュを1時間以上持つことが条件。**

プラン差（同ページ・確認日 2026-09-03）：

| プラン | キー | 帰属表示 | 更新頻度 | 上限 |
|---|---|---|---|---|
| Open | 不要 | **必須** | 1日1回 | Rate limited（詳細非公開・429で20分） |
| Free | 必要 | 不要 | 1日1回 | 1,500 req/月 |
| Pro（$10/月） | 必要 | 不要 | 60分ごと | 30,000 req/月 |

### 2.5 ECB 直接（実測あり）

```
GET https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml
→ HTTP/2 200, content-type: text/xml, last-modified: Wed, 02 Sep 2026 13:56:14 GMT
   time='2026-09-02'
   currency='USD' rate='1.1578'
   currency='JPY' rate='184.78'
```

**EUR基準しか無いので USD→JPY は自分で割る**：184.78 ÷ 1.1578 = 159.59。Frankfurter の `providers=ECB` の値（159.6）と一致した＝Frankfurter の ECB 系列は信頼できる。

公表時刻の公式記述（https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html ・確認日 2026-09-03）：

> The reference rates are usually updated at around 16:00 CET every working day, except on TARGET closing days. They are based on the daily concertation procedure between central banks across Europe, which normally takes place around 14:10 CET. The reference rates are published for information purposes only. **Using the rates for transaction purposes is strongly discouraged.**

最後の一文は本ツールでは問題にならない（購入機能が無く、価格の目安を表示するだけなので）。ただし**UIには「参考値」と明記する**。

### 2.6 推奨する実装

1. Frankfurter v2 を `expand=providers` 付きで1日1回だけ引く。
2. レスポンスの `rate` と、`providers` 配列から抜いた ECB 行（`key === "ECB"`）の `date` を保存する。
3. UI には `1 USD = 159.87 JPY（出典：Frankfurter / 84中央銀行ブレンド, 2026-09-03取得, ECB系列は2026-09-02基準）` のように出す。
4. Frankfurter が落ちたら open.er-api.com へフォールバックし、そのときは帰属表示リンクを併記する。
5. 価格表示は必ず「参考値」と添える。

---

## 3. 新興語検出の方法論

### 3.1 既存手法の整理

**Kleinberg のバースト検出（2002）**
Jon Kleinberg, "Bursty and Hierarchical Structure in Streams", Data Mining and Knowledge Discovery 7:373-397（原論文PDF：https://www.cs.cornell.edu/home/kleinber/bhs.pdf ・確認日 2026-09-03）。

イベント列を確率オートマトンでモデル化する。低頻度状態 q0 と高頻度状態 q1 を置き、状態遷移にコストを課したうえで、観測列を最もよく説明する状態列を動的計画法で求める。q1 に留まった区間が「バースト」。多状態に拡張すると強度の階層が得られる。

**本ツールでは採用しない理由**：連続的なイベントタイムスタンプの列が必要だが、我々が手に入るのは Qiita の日次件数のような粗い集計値である。また、実装コストに対して、後述の単純な成長率＋平滑化との差が小さい。P2 に置く。

**z-score / 成長率比**
移動平均と標準偏差から `z = (x_t - μ) / σ` を出す古典的な手法。件数が小さい領域では σ が不安定になり、1件が2件になっただけで巨大な z を叩き出す。**少数件数のノイズ対策が必須**で、それが後述の shrinkage。

**Google Trends の "Breakout"**
公式ヘルプ（https://support.google.com/trends/answer/4355000 ・確認日 2026-09-03）：

> Rising — Terms that were searched for with the keyword you entered ... which had the most significant growth in volume in the requested time period.
> **"Breakout" appears when a search term's growth exceeds 5000%** rather than displaying a specific percentage figure.

またデータの扱いについて（https://support.google.com/trends/answer/4365533 ・確認日 2026-09-03）：

> Trends only shows data for popular terms, so search terms with low volume appear as "0."
> Trends eliminates repeated searches from the same person over a short period of time.
> Each data point is divided by the total searches of the geography and time range it represents to compare relative popularity. The resulting numbers are then scaled on a range of 0 to 100.

**示唆**：Google 自身が「+5,000%」という極端に高い閾値を "Breakout" に割り当てているのは、低ボリューム帯では伸び率が容易に爆発するからである。裏返すと、伸び率だけをスコアにすると 1→50 件のノイズを最上位に押し上げてしまう。**絶対量による重み付けが必要**。

**Exploding Topics / Glimpse の "emerging" 定義**
Exploding Topics は公開情報として、トピックに Exploding（急上昇）/ Regular（一定の成長）/ Peaked（ピーク済み・下降）の3ステータスを付けており、この判定は Google 検索ボリュームの成長に基づくとしている（Semrush ナレッジベース https://www.semrush.com/kb/1490-exploding-topics ・確認日 2026-09-03）。

**具体的な閾値・アルゴリズムは公開されていない（未確認）。** 3値ラベルという設計思想だけを借りる。本ツールでは指示に沿って5段階＋下降1段階にする。

### 3.2 設計方針：Trend Score と Status を分離する

この2つを1本の数値に混ぜてはいけない。

- **Trend Score（0〜100）** = 「今このドメインを取りに行く価値」。勢いが強く、まだ小さく、複数ソースで裏が取れているものを高評価する。だから「絶対数が小さい」ことがプラスに働く。
- **Status** = ライフサイクル上の位置。Mainstream は「価値が低い」のではなく「もう遅い」というだけ。絶対量と成長率の2軸で決まる。

Mainstream な語は Trend Score が低く出る。これは仕様であって不具合ではない。

### 3.3 入力（すべてソース横断で1日1回集計する）

語 t について、収集日を基準に以下を持つ。

| 記号 | 意味 | 取得方法 |
|---|---|---|
| `c7[s]` | ソース s の直近7日の件数 | Qiita は `Total-Count`、Wikipedia PV は日次合計 |
| `c7prev[s]` | 8〜14日前の7日件数 | 同上（`created:>=` と `created:<=` を併用） |
| `c30[s]` | 直近30日の件数 | 同上 |
| `c30prev[s]` | 31〜60日前の30日件数 | 同上 |
| `S` | `c30[s] > 0` となるソース数 | — |
| `S_TOTAL` | 問い合わせたソース総数 | 実装上の定数（例：Qiita・Wikipedia PV・はてな の3） |

ソース横断の合計を `c7 = Σ c7[s]` のように置く。ソースごとに桁が違う（Qiita の件数と Wikipedia の PV は同じスケールではない）ので、**合計を取る前にソースごとに正規化する**。

```ts
// ソース s のスケール定数（そのソースで「よく見る語」の30日件数の目安）
const SCALE = { qiita: 100, wikipv: 3000, hatena: 40 };

// 正規化件数：どのソースでも「1.0 ≒ そこそこ有名」になるよう揃える
const n = (raw: number, s: keyof typeof SCALE) => raw / SCALE[s];
```

### 3.4 Trend Score（0〜100）

4成分の加重和。すべて 0〜100 に正規化してから重みを掛ける。

```ts
const clamp = (x: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, x));

// --- 定数（チューニング対象） ---
const ALPHA = 3;    // Laplace 平滑化の擬似カウント
const K     = 5;    // shrinkage の強さ（観測数がこの値のとき信頼度 0.5）
const VMAX  = 1000; // 「もう大きい」とみなす30日件数

// --- 1. Growth：成長率（Laplace 平滑化つき） ---
// α を分子分母に足すことで 0件→3件 のような爆発を抑える
const g = (c7 + ALPHA) / (c7prev + ALPHA);
const growthRaw = 100 * clamp(Math.log2(g) / 3);   // g=1→0, g=2→33, g=4→67, g>=8→100

// --- 2. Confidence：少数件数の shrinkage ---
// 観測が薄いほど成長率を 0 に引き戻す
const nObs = c7 + c7prev;
const w    = nObs / (nObs + K);                    // n=0→0, n=5→0.5, n=45→0.9
const G    = growthRaw * w;

// --- 3. Acceleration：直近7日の日平均 ÷ 直近30日の日平均 ---
const a = (c7 / 7) / Math.max(c30 / 30, 1e-9);
const A = 100 * clamp(a - 1);                      // a<=1→0, a=1.5→50, a>=2→100

// --- 4. Breadth：何ソースで裏が取れたか ---
const B = 100 * (S / S_TOTAL);

// --- 5. Earliness：絶対量が小さいほど高い ---
const V = 100 * clamp(1 - Math.log10(1 + c30) / Math.log10(1 + VMAX));
//  c30=0→100, c30=10→65, c30=100→33, c30>=1000→0

// --- 合成 ---
let trend = 0.35 * G + 0.20 * A + 0.20 * B + 0.25 * V;

// --- ハードゲート ---
// どのソースにも1件も出ない語は「発見」ではなく打ち間違い
if (S === 0) trend = 0;
// 1ソースだけ・かつ30日3件未満は上限を切る（裏が取れていない）
if (S <= 1 && c30 < 3) trend = Math.min(trend, 40);

const TrendScore = Math.round(clamp(trend, 0, 100));
```

**各成分の意図**

| 成分 | 重み | 何を測るか | 落とし穴への対処 |
|---|---:|---|---|
| Growth (G) | 0.35 | 直近7日 vs その前7日の伸び | Laplace α=3 で 0→n の爆発を抑え、shrinkage w で薄い観測を減衰 |
| Acceleration (A) | 0.20 | 30日平均に対する直近7日の加速 | 30日かけて一定ペースで増えた語（＝もう知られている）を弾く |
| Breadth (B) | 0.20 | 複数ソースで裏が取れたか | 1媒体の連載記事だけで跳ねる偽陽性を弾く |
| Earliness (V) | 0.25 | 絶対量の小ささ | 既にメジャーな語を上位に出さない |

**Laplace 平滑化と shrinkage の効き方（数値例）**

| c7prev → c7 | 素の比 | 平滑化後 g | growthRaw | w (K=5) | G |
|---|---:|---:|---:|---:|---:|
| 0 → 3 | ∞ | 2.00 | 33 | 0.38 | **13** |
| 0 → 30 | ∞ | 11.0 | 100 | 0.86 | **86** |
| 10 → 20 | 2.0 | 1.77 | 27 | 0.86 | **24** |
| 100 → 200 | 2.0 | 1.97 | 33 | 0.98 | **32** |
| 5 → 5 | 1.0 | 1.00 | 0 | 0.67 | **0** |

0→3 は 13 点にしかならず、0→30 は 86 点になる。**素の比だとどちらも無限大**なので、この差が付くことが平滑化の狙いそのものである。

### 3.5 Status の閾値（Early / Emerging / Rising / Trending / Mainstream）

**順序付きルール（最初にマッチしたものを採用）**。`c30` は日本語圏ソース横断の正規化済み30日件数、`g30 = (c30 + ALPHA) / (c30prev + ALPHA)` は30日ベースの成長率。

| # | Status | 条件（この順に評価） | 意味 |
|---:|---|---|---|
| 1 | `Noise` | `S === 0` | どのソースにも出ない。表示しない |
| 2 | `Fading` | `c30 >= 25 && g30 < 0.7` | ピーク済み。30日で3割以上減った |
| 3 | `Mainstream` | `c30 >= 500` | 日本語圏に定着済み。ドメインは手遅れ |
| 4 | `Trending` | `c30 >= 100` または `g30 >= 3.0` | 話題の真っ只中。競合が動いている |
| 5 | `Rising` | `c30 >= 25 && g30 >= 1.5` | 立ち上がり。**狙い目の中心** |
| 6 | `Emerging` | `c30 >= 5 && g30 >= 1.3` | 芽が出た。**最も価値が高い** |
| 7 | `Early` | `c30 >= 1` | 出たばかり、または一過性。要監視 |
| 8 | `Early` | それ以外 | フォールバック |

```ts
type Status = 'Noise'|'Early'|'Emerging'|'Rising'|'Trending'|'Mainstream'|'Fading';

function classify(c30: number, c30prev: number, S: number): Status {
  const g30 = (c30 + ALPHA) / (c30prev + ALPHA);
  if (S === 0)                       return 'Noise';
  if (c30 >= 25 && g30 < 0.7)        return 'Fading';
  if (c30 >= 500)                    return 'Mainstream';
  if (c30 >= 100 || g30 >= 3.0)      return 'Trending';
  if (c30 >= 25  && g30 >= 1.5)      return 'Rising';
  if (c30 >= 5   && g30 >= 1.3)      return 'Emerging';
  return 'Early';
}
```

**閾値の根拠**

- `500`（Mainstream）：Qiita の30日件数で500を超える語は、実測した「AIエージェント」（7日で532件）の水準。この規模はもう新語ではない。
- `100`（Trending）：実測「MCPサーバー」の7日141件から逆算した水準。既に多数の書き手がいる。
- `25` / `5`：実測「Model Context Protocol」7日38件、「バイブコーディング」7日8件。この帯が「知る人ぞ知る」から「立ち上がり」への境目にあたる。
- `3.0`（Trending への成長率ゲート）：件数が少なくても3倍に増えたら見逃さない。
- `0.7`（Fading）：30日で3割減はノイズでは説明しにくい。

**この数値は初期値であり、実データを2週間ほど貯めてから再調整する前提で置いている。** 閾値は1か所の定数オブジェクトに切り出し、UIから触れるようにするとよい。

```ts
export const THRESHOLDS = {
  mainstream: 500, trending: 100, rising: 25, emerging: 5,
  gTrending: 3.0, gRising: 1.5, gEmerging: 1.3, gFading: 0.7,
} as const;
```

---

## 4. 商標チェックの無料リソース

### 4.1 結論

**MVP では自動判定しない。「手動確認用のリンクを開く」までに留める。** 理由は3つある。

1. **無料で機械から叩ける検索APIが存在しない。** USPTO も特許庁も、キーワード検索のAPIはキー必須か申請制で、しかも申請の口が閉じている。
2. **規約が自動化を禁じている。** WIPO は automated queries と web scraping を明示的に禁止している。
3. **仮にデータが取れても判定できない。** 商標の抵触は「同一の文字列か」ではなく、指定商品・役務の類似群と、称呼・外観・観念の類似で決まる。文字列一致では偽陰性も偽陽性も大量に出る。

### 4.2 各リソースの実測結果（2026-09-03）

| リソース | 機械可読API | キー/申請 | キーワード付きURL | 実測結果 |
|---|---|---|---|---|
| USPTO Trademark Search (tmsearch) | 無し（Web UI） | — | `?q=openai` は 200 | **HTMLは125,660バイトのSPA殻。本文に `openai` は0回出現** |
| USPTO TSDR API | あり | **APIキー必須** | — | 未認証で **401** |
| USPTO Open Data Portal (api.uspto.gov) | あり | **APIキー必須** | — | 未認証で **401 `{"message":"Unauthorized"}`** |
| J-PlatPat | **無し** | — | **キーワードパラメータの仕様が無い** | 既定のcurl UAだと `reject_sorry.html` へ転送。ブラウザUAだと `/?uri=/t0100` |
| 特許庁 特許情報取得API | あり（商標も対象） | **利用者登録必須／2024-08-09に新規申込受付終了** | — | 申込不可 |
| WIPO Global Brand Database | 無し（第三者向けには） | — | `?by=brandName&v=openai` は 200 | **1,719バイトのSPA殻。`openai` は0回出現**。規約で自動化禁止 |
| EUIPO eSearch plus | 未確認 | — | `#basic/.../openai` は 200 | **フラグメントはサーバーに送られない。12,989バイトの殻** |
| TMview (tmdn.org) | 内部APIはPOST | — | `#/tmview/results?basicSearch=openai` は 200 | **531バイトの殻**。API相当は GET で **405** |

### 4.3 「HTTP 200 が返る」は「検索が動く」ではない

Codex の先行調査には「USPTO tmsearch / WIPO branddb / EUIPO eSearch / TMview はキーワード付き URL が 200 で開く」という記録があった。**200 が返るのは事実だが、それは検索が成功した証拠にならない。** 再確認した結果は次のとおり。

- USPTO：`/search/search-results?q=openai` と `/search/search-information?q=openai` が**まったく同じ 125,660 バイト**を返す。`q` の値がサーバー側のレスポンスに一切影響していない。HTML 内に `openai` は0回しか現れず、`<script>` が7本。**典型的なSPAの殻**。
- WIPO：1,719バイト、`<script>` 1本。同じく殻。
- EUIPO / TMview：URL の `#` 以降は**そもそもHTTPリクエストに含まれない**（RFC 3986）。サーバーは検索語を受け取っていない。200 はトップページが返っただけ。

**したがって「キーワード付きURLで検索結果が開くか」は、curl では原理的に検証できない。** 実際にブラウザ（またはヘッドレスブラウザ）で開いて描画を待つ必要がある。**本調査ではそこまでは行っていないので、この点は未確認**とする。

MVP では「リンクを新規タブで開く」だけなので、リンク先で検索が自動実行されなくても致命的ではない（ユーザーが検索欄に貼り直せばよい）。UI には**検索語をコピーできるボタンを併置する**のが現実的な落としどころ。

### 4.4 J-PlatPat の reject_sorry.html は「直リンク拒否」ではなく User-Agent 判定

Codex の記録では「J-PlatPat はキーワード付きの深いリンクを受け付けず `reject_sorry.html` に飛ばされる」となっていた。**再確認したところ、原因はキーワードではなく User-Agent だった。**

実測（同一URL `https://www.j-platpat.inpit.go.jp/t0100`・2026-09-03）：

| User-Agent | 最終URL |
|---|---|
| curl 既定（`curl/8.x`） | `https://www.j-platpat.inpit.go.jp/reject_sorry.html` |
| ブラウザ相当 | `https://www.j-platpat.inpit.go.jp/?uri=/t0100` |

そもそも `/t0100` にはキーワードが付いていない。**キーワードの有無と転送は無関係**である。

さらに `reject_sorry.html` の本文を取得すると、直リンク拒否の文言はどこにも無く、**メンテナンス告知**が書かれていた。

> 申し訳ありません。本システムは、現在メンテナンス作業によりサービスを停止しております。
> This system will stop the service now due to maintenance.

つまり J-PlatPat は、ボットと見なしたアクセスに「メンテナンス中」という汎用ページを返す設計になっている。**自動アクセスを歓迎していないことの表れ**なので、UA を偽装してまで叩きにいくべきではない。

**採否**：Codex の記述は「reject_sorry.html に飛ばされることがある」という現象としては正しいが、**原因の説明が誤り**。「キーワード付き深いリンクを受け付けない」ではなく「非ブラウザからのアクセスを拒否する」が正しい。加えて、J-PlatPat には**そもそも検索語をURLパラメータで渡す公式仕様が確認できない**（Angular SPA が `?uri=/画面ID` に書き換えるだけで、検索条件は保持されない）。リンクは商標検索画面（`https://www.j-platpat.inpit.go.jp/t0100`）を開くところまでにする。

### 4.5 特許庁の特許情報取得API：申込の口が閉じている

公式（https://www.jpo.go.jp/system/laws/sesaku/data/api-provision.html ・確認日 2026-09-03）：

> 特許庁は、特許情報の活用を促進するためAPIを利用した特許情報提供を、令和4年1月より開始しております。本API（以下、「特許情報取得API」といいます。）では、J-PlatPat及び特許情報標準データを通じて提供している日本国特許庁の特許、意匠及び商標出願情報（実用新案出願情報を除く）……の一部が取得可能です。
> 特許情報取得APIによる特許情報提供は、安定稼働のためアクセス数に上限を設けております。また、特許情報取得APIの有用性や利用者ニーズ調査を目的とした試行段階です。そのため……**利用にあたっては利用者登録が必要となります。**

商標関連では「商標経過情報取得API」「シンプル版商標経過情報取得API」「商標登録情報取得API」が提供されており、意匠・商標のAPIは令和5年4月20日開始（API情報提供サイト https://ip-data.jpo.go.jp/pages/top.html ・確認日 2026-09-03）。

**ただし新規申込は受付終了している。**

> 令和6年8月9日をもちまして新規申し込み受付を終了させていただきました。今後、追加募集をすることになった場合は、随時お知らせします

つまり 2024-08-09 以降は新規に使い始められない（2026-09-03 時点で再開の告知は確認できず）。**MVP の選択肢から外れる。**

なお、これらは「番号を指定して経過情報を取る」API であり、**キーワードから商標を検索する用途には設計上向いていない**（仕様書未読のため詳細は未確認）。

### 4.6 WIPO Global Brand Database：規約が自動化を禁止

公式規約（https://www.wipo.int/en/web/global-brand-database/terms_and_conditions ・November 2022版・確認日 2026-09-03）から、禁止行為の原文：

> perform automated queries; perform bulk acquisition, bulk downloading, and bulk storing of data; perform bulk copying, bulk reformatting, bulk sharing and bulk redistributing of data; perform web scraping

過剰利用の定義：

> use the service excessively to the detriment of other Users (for that matter, **more than 10 search related actions per minute from a single IP address can be considered excessive**)

**automated queries が名指しで禁止**なので、リンクを開く以上のことはしない。

### 4.7 なぜ自動判定が困難か（データが取れたとしても）

1. **類似の判断が文字列一致ではない。** 日本の商標審査は称呼（読み）・外観（見た目）・観念（意味）の3観点で類似を判断する。`Cursol` と `Cursor` は文字列としては1文字違いだが称呼が同一に近い。逆に `X` と `Twitter` は文字列上は無関係だが実務上は関連する。
2. **指定商品・役務が効く。** 同じ文字列でも、第9類（ソフトウェア）と第30類（菓子）では併存登録されうる。区分を無視した「登録あり／なし」の二値判定は意味を持たない。
3. **未登録でもリスクがある。** 周知・著名な未登録商標は不正競争防止法の対象になる。データベースに無いことは安全の証明にならない。
4. **国ごとに独立している。** .com は世界中で見えるが、商標は国別。USPTO で空いていても JPO で埋まっていることは普通にある。
5. **出願中は検索に出るまでラグがある。** 出願から公開までの間は、どのデータベースを見ても存在しない。

**MVP の落としどころ**：ドメイン候補ごとに「商標を確認する」ボタンを置き、USPTO・J-PlatPat・TMview の3リンクを新規タブで開く。あわせて画面の固定位置に**「法的助言ではありません。登録可能性を判定するものでもありません」と常時表示しておく。**

推奨リンク（キーワードの自動投入は「ブラウザで動くか未確認」の前提で）：

| 対象 | URL |
|---|---|
| 米国 | `https://tmsearch.uspto.gov/search/search-results?q={語}` |
| 日本 | `https://www.j-platpat.inpit.go.jp/t0100`（検索語は手入力／コピーボタンを併置） |
| EU・国際 | `https://www.tmdn.org/tmview/`（同上） |

---

## 5. ドメイン名の品質評価

### 5.1 既知の手法（一次情報で確認できた範囲）

**発音しやすさ（phonotactic probability）**
Laufer & Storkel 系の研究として、"Phonotactic probability of brand names: I'd buy that!"（Psychological Research, 2011 / PMC3289729 ・確認日 2026-09-03）がある。

- phonotactic probability の定義：「the frequency with which phonological segments and sequences of segments appear in a word」。単語中に音素および音素連鎖がどれだけ高頻度で現れるかの指標。
- 実験：英語母語話者19名が、単音節の非単語60語（高確率30・低確率30）を7段階で評価。
- 結果：購入意向との相関は sum of the segments で r = .51、sum of the biphones で r = .48（いずれも p < .0001）。
- 語らしさ（word-likeness）の評価は購入意向を強く予測した（r = .70）。主観的な発音しやすさは客観的な音素連鎖指標と相関した（r = .55〜.56）。

**要点**：**よくある音の並びは、発音しやすいと感じられ、買いたいと思われる。** ドメイン名の評価に「音素連鎖の一般性」を入れる根拠になる。

**音節数**
2〜3音節が記憶しやすいという報告が複数ある（ただし出典はレビュー記事・二次情報が中心で、**査読論文の一次情報までは確認していない＝未確認**）。実装では「2〜4音節を無罰、1音節・5音節以上に減点」という緩い形にする。

**商用ツールの評価ロジックは非公開**
GoDaddy の Domain Appraisal は、機械学習と実売買データを組み合わせたアルゴリズムだと自社ブログで説明している（https://www.godaddy.com/resources/news/domain-name-valuation ・確認日 2026-09-03）。TLD と SLD の類似ドメイン、独自性、長さを考慮するとされるが、**式も重みも公開されていない**。したがって流用できない。Estibot 等も同様。

**結論**：公開ロジックが無いので、**自前でルールベースの式を作るしかない**。以下がその提案。

### 5.2 前提：.com はゲートにする

本ツールは .com 専用なので、TLD をスコアの一成分にしても常に満点になって情報量がない。**.com 以外は対象外にする（ゲート）**。将来 .io / .ai を扱うなら、そのとき係数を導入する。

### 5.3 特徴量の抽出

```ts
type Features = {
  sld: string;        // 例: "vibecoding"（.com を除いた部分・小文字）
  tld: string;        // 例: "com"
  len: number;        // 文字数（sld の長さ）
  words: string[];    // 辞書ベースの単語分割結果（例: ["vibe","coding"]）
  hyphens: number;    // '-' の個数
  digits: number;     // 数字の個数
  leadingDigit: boolean;
  vowelRatio: number; // a,e,i,o,u,y の比率
  maxConsRun: number; // 最長の連続子音数
  syllables: number;  // 母音グループ数（連続母音を1つと数える近似）
  dictCoverage: number; // 辞書語で説明できる文字数の割合（0〜1）
  termMatch: 'exact'|'suffix'|'plus1'|'stem'|'related'|'none';
  priceJpy: number;   // 更新価格（初年度割引ではなく更新価格）
  isRegistryPremium: boolean;
};
```

音節数の近似（英語の SLD 向け・十分実用的）：

```ts
const syllables = (s: string) =>
  (s.toLowerCase().replace(/[^a-z]/g, '').match(/[aeiouy]+/g) ?? []).length;
```

### 5.4 Domain Score（0〜100）

```ts
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
const cl100   = (x: number) => Math.min(100, Math.max(0, x));

// --- 1. 長さ（22%）短いほど良いが、極端に短いのは実質取れない ---
function lengthScore(L: number) {
  if (L <= 3)  return 60;              // 該当時のみ。実際にはほぼ空いていない
  if (L <= 10) return 100;
  if (L <= 14) return 100 - 8 * (L - 10);   // 11→92, 14→68
  if (L <= 20) return 68 - 9 * (L - 14);    // 17→41, 20→14
  return 0;
}

// --- 2. 発音しやすさ（18%）---
function pronounceScore(f: Features) {
  let s = 100;
  // 母音比率：0.34〜0.50 は無罰。外れるほど減点
  s -= 60 * clamp01((Math.abs(f.vowelRatio - 0.42) - 0.08) / 0.25);
  // 子音の連続：4連続から減点（例: "strngth"）
  s -= 20 * Math.max(0, f.maxConsRun - 3);
  // 音節数：2〜4 は無罰
  s -= 12 * Math.max(0, f.syllables - 4);
  s -= 10 * Math.max(0, 2 - f.syllables);
  // 英語で成立しない音素連鎖（音素連鎖の一般性が低い）
  if (/(zx|qx|vk|kx|jq|xz|tsq)/.test(f.sld)) s -= 25;
  return cl100(s);
}

// --- 3. 綴りやすさ（15%）耳で聞いて一意に書けるか ---
const AMBIGUOUS = [/ph/, /gh/, /kn/, /wr/, /mb$/, /ce/, /ck/, /x/, /que/, /ough/];
function spellScore(f: Features) {
  let s = 100;
  if (/(.)\1\1/.test(f.sld)) s -= 20;                       // 同一文字3連
  const amb = AMBIGUOUS.filter(re => re.test(f.sld)).length;
  s -= Math.min(45, 15 * amb);                              // 同音異綴リスク
  if (/(.)\1/.test(f.sld) && f.words.length >= 2) s -= 15;  // 語境界の重複（newsstand 型）
  if (f.dictCoverage < 0.5) s -= 20;                        // 辞書で説明できない綴り
  return cl100(s);
}

// --- 4. キーワード一致（15%）---
const KEYWORD = { exact: 100, suffix: 85, plus1: 70, stem: 50, related: 25, none: 0 };

// --- 5. 構造（12%）---
function structureScore(f: Features) {
  let s = 100;
  if (f.hyphens > 0)  s -= 35;
  if (f.digits  > 0)  s -= 25;
  if (f.leadingDigit) s -= 15;   // 上の -25 と累積して -40
  if (f.words.length === 3)  s -= 15;
  if (f.words.length >= 4)   s -= 30;
  return cl100(s);
}

// --- 6. 記憶しやすさ（10%）---
function memorabilityScore(f: Features) {
  let s = 60;                                        // 基準点
  if (f.syllables >= 2 && f.syllables <= 3) s += 25; // 2〜3音節
  if (f.words.length === 1) s += 15;                 // 1語のほうが覚えやすい
  if (f.words.length === 2 && f.dictCoverage > 0.9) s += 10;
  if (f.words[0]?.[0] === f.words[1]?.[0]) s += 5;   // 頭韻
  return cl100(s);
}

// --- 7. 価格（8%）更新価格ベース・USD→JPY は §2 のレートで換算 ---
function priceScore(p: number, premium: boolean) {
  let s: number;
  if (p <= 2000)       s = 100;
  else if (p <= 5000)  s = 100 - 40 * (p - 2000) / 3000;
  else if (p <= 20000) s = 60  - 50 * (p - 5000) / 15000;
  else                 s = Math.max(0, 10 - (p - 20000) / 10000);
  if (premium) s -= 30;
  return cl100(s);
}

// --- 合成 ---
function domainScore(f: Features) {
  if (!f.sld || f.tld !== 'com') return null;   // .com 以外はゲートで除外
  return Math.round(cl100(
      0.22 * lengthScore(f.len)
    + 0.18 * pronounceScore(f)
    + 0.15 * spellScore(f)
    + 0.15 * KEYWORD[f.termMatch]
    + 0.12 * structureScore(f)
    + 0.10 * memorabilityScore(f)
    + 0.08 * priceScore(f.priceJpy, f.isRegistryPremium)
  ));
}
```

### 5.5 重みの根拠と検算

| 成分 | 重み | なぜその重みか |
|---|---:|---|
| 長さ | 0.22 | 口頭で伝えられるか、名刺に載るか。最も効く単一要因 |
| 発音 | 0.18 | 音素連鎖の一般性は購入意向と r ≒ .5 で相関する（§5.1） |
| 綴り | 0.15 | 「聞いて書ける」は流入の前提条件 |
| キーワード一致 | 0.15 | 本ツールの目的（新語のドメインを取る）に直結 |
| 構造 | 0.12 | ハイフン・数字は実務上ほぼ致命的だが、候補生成側で避けられる |
| 記憶 | 0.10 | 定量化しにくく、他成分と相関が高いので低め |
| 価格 | 0.08 | 個人利用で年数千円なら差が小さい。ただしプレミアムは弾きたい |

**検算（手計算・termMatch は exact を仮定、価格は 1,500円/年・非プレミアム）**

| ドメイン | len | 音節 | 母音比 | words | Length | Pron | Spell | KW | Struct | Mem | Price | **Score** |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| `vibecoding.com` | 11 | 4 | 0.45 | 2 | 92 | 100 | 100 | 100 | 100 | 95 | 100 | **97** |
| `mcpserver.com` | 9 | 3 | 0.33 | 2 | 100 | 96 | 100 | 100 | 100 | 95 | 100 | **99** |
| `ai-agent-hub.com` | 12 | 5 | 0.42 | 3 | 84 | 88 | 100 | 85 | 50 | 60 | 100 | **83** |
| `getvibecoding2.com` | 15 | 5 | 0.40 | 3 | 59 | 88 | 100 | 70 | 60 | 60 | 100 | **74** |
| `strngthtrnr.com` | 12 | 1 | 0.08 | 0 | 84 | 0 | 80 | 25 | 100 | 60 | 100 | **57** |

意図どおり、短くて素直な2語の .com が上位に来て、ハイフン・数字・母音欠落が下がる。

### 5.6 実装上の注意

- **辞書はローカルに持つ。** 単語分割と `dictCoverage` に使う。英語の頻度付き語彙リスト（例：`wordfreq` 相当のデータ）をビルド時に同梱すれば、実行時のネットワークアクセスがゼロで済む。
- **単語分割は動的計画法で。** `vibecoding` → `["vibe","coding"]` のように、辞書語の連結として最尤分割を求める。全探索は指数時間になるので必ずメモ化する。
- **価格は更新価格を使う。** 初年度$0.99のような値で並べ替えると意味がない。
- **DomainScore と TrendScore は掛け算しない。** 2軸の散布図（横軸 TrendScore・縦軸 DomainScore）で見せるほうが、判断材料として役に立つ。総合順位が欲しければ `0.6 * Trend + 0.4 * Domain` のような別スコアを添える。

---

## 6. MVPでの採用推奨（P0 / P1 / P2）

### P0（MVP に必ず入れる）

| # | 項目 | 理由 |
|---|---|---|
| 1 | **Qiita API v2**（`Total-Count` で件数取得） | キー不要・1リクエストで件数・公式ドキュメントあり・規約でAPI利用が明示的にOK |
| 2 | **Wikipedia Action API**（`redirects=1` で存在判定＋初版日時） | 「日本語圏に上陸したか」を二値で確定できる唯一のソース。50語を1リクエストで判定 |
| 3 | **Wikimedia Pageviews API** | 上陸後の関心量を数値化。CORS全開・4時間キャッシュ |
| 4 | **Frankfurter v2**（`expand=providers`） | キー不要。出典と日付が応答に入る。ECB単独も選べる |
| 5 | **Trend Score（§3.4）と Status 判定（§3.5）** | ルールベースなので決定的にテストできる。閾値は定数に外出し |
| 6 | **Domain Score（§5.4）** | 同上。`.com` はゲート |
| 7 | **商標は手動確認リンク＋免責表示** | 自動判定は不可能。リンクとコピーボタンで十分に役立つ |
| 8 | **User-Agent に連絡先を入れる** | Wikimedia は無しだと403（実測）。他ソースでも礼儀として必須 |
| 9 | **ローカルキャッシュ（ソース別TTL）** | Qiita 60 req/h・ExchangeRate 20分BAN。キャッシュ無しでは即詰まる |

### P1（MVP直後・v1.1）

| # | 項目 | 理由 |
|---|---|---|
| 10 | open.er-api.com へのフォールバック（帰属表示つき） | Frankfurter 停止時の保険。UIに `Rates By Exchange Rate API` リンクが必須 |
| 11 | Qiita の認証トークン対応（1000 req/h） | 語数を増やすと 60 req/h では足りなくなる |
| 12 | はてなブックマークRSS（40件の有無だけを見る二値シグナル） | 件数は取れないが「はてブに出たか」は Breadth の1票になる |
| 13 | Zenn `/api/articles`（非公式・壊れる前提） | 日本語圏の技術文脈をもう1ソース増やせる。失敗時は静かにスキップ |
| 14 | ECB XML との突き合わせによる為替の健全性チェック | Frankfurter の値がECBから乖離したら警告を出す |
| 15 | Trend Score の閾値をUIから調整可能にする | 初期値は仮説。実データ2週間分で必ず調整が要る |

### P2（あとで／必要になったら）

| # | 項目 | 理由 |
|---|---|---|
| 16 | connpass API v2 | 申請と審査が挟まる。イベント名は良いシグナルなので、通ったら追加 |
| 17 | Kleinberg のバースト検出 | 日次集計しか無い現状では単純な成長率との差が小さい |
| 18 | ヘッドレスブラウザでの商標リンク検証 | 「キーワード付きURLで検索が走るか」の未確認事項を潰したくなったら |
| 19 | Google Trends 系の外部シグナル | 公式APIが無く、非公式ライブラリは規約が不透明 |

---

## 7. 採用しない理由（明示）

| 対象 | 採用しない理由 |
|---|---|
| **Google News RSS** | フィード本文の著作権表記が「personal feed reader での個人・非商用利用に限る。それ以外の利用は明確に禁止」と定めている（実測で取得）。加えて `<item>` が100件で頭打ちになり、総件数が取れないため件数指標として機能しない |
| **note.com API** | 公式APIが存在せず、`robots.txt` が `Disallow: /api/*` を明記している（実測）。取得できることと、取得してよいことは別 |
| **Yahoo!リアルタイム検索** | APIが存在しない。Yahoo!デベロッパーネットワークのAPI一覧に掲載が無い（実測） |
| **特許庁 特許情報取得API** | 2024-08-09（令和6年8月9日）をもって新規申込受付を終了。2026-09-03時点で再開の告知が確認できない。加えて番号指定の取得APIであり、キーワード検索には向かない |
| **WIPO Global Brand Database の自動取得** | 利用規約が automated queries と web scraping を名指しで禁止。1IPあたり毎分10検索超を過剰利用と定義している |
| **USPTO TSDR / Open Data Portal** | どちらもAPIキー必須。未認証で 401（実測）。登録すれば使えるが、商標の抵触判定そのものが自動化できないので、キーを取ってまで組み込む価値が薄い |
| **J-PlatPat の自動アクセス** | 非ブラウザからのアクセスに「メンテナンス中」ページを返す設計（実測）。UAを偽装してまで叩くべきではない。検索語をURLで渡す公式仕様も確認できない |
| **商標の自動抵触判定** | 称呼・外観・観念の類似と、指定商品・役務の区分で決まるため、文字列一致では判定できない。未登録の著名商標や出願中の案件も検索に現れない。誤った「安全」表示はユーザーに実害を与える |
| **GoDaddy 等の評価ロジック流用** | 機械学習と実売買データに基づくとしか公表されておらず、式も重みも非公開。再現できない |
| **Kleinberg バースト検出（MVP時点）** | 連続的なイベント列が前提だが、実際に手に入るのは日次の集計値。実装コストに対する精度の上積みが小さい |
| **TrendScore と DomainScore の乗算** | 2つは独立した軸で、掛けると「勢いはあるが名前が悪い」と「名前は良いが勢いが無い」が区別できなくなる。散布図で見せるほうが判断に役立つ |

---

## 8. 未確認事項の一覧

実装前に埋めるか、埋めないまま進むかを判断する必要がある項目。

| # | 未確認事項 | 影響 | 埋め方 |
|---|---|---|---|
| 1 | 商標DBの「キーワード付きURLでブラウザ上の検索が実際に走るか」 | 小（リンクが検索画面を開くだけでも実用に足る） | Playwright 等で1度だけ実測する |
| 2 | Wikimedia の具体的な req/sec 上限 | 小（1 req/sec なら問題ない） | 公式ドキュメントに数値が見当たらない。実運用でヘッダーを監視 |
| 3 | Frankfurter のレート制限 | 小（1日1回の利用なら無関係） | 公式ドキュメントに記載なし |
| 4 | Frankfurter の CORS 可否 | 小（サーバー側で叩けばよい） | 実測ヘッダーに `Access-Control-Allow-Origin` が出なかった |
| 5 | はてなブックマークAPIの公式規約 | 中（P1で使うなら要確認） | 公式のAPI規約ページを特定できていない |
| 6 | Zenn の自動取得に関する規約上の扱い | 中（P1で使うなら要確認） | 利用規約に明文が無く、robots.txt も `/api` を禁じていない＝グレー |
| 7 | note.com 利用規約の本文 | 小（robots.txt だけで不採用が確定している） | `note.com/terms` が403で取得できず |
| 8 | 音節数と記憶しやすさの査読論文 | 小（緩い減点にとどめている） | 二次情報のみで確認 |
| 9 | Trend Score / Status の閾値の妥当性 | **大** | 実データを2週間貯めて、既知の語（MCP・バイブコーディング等）が正しい Status に落ちるか検証する |

---

## 付録A：実測ログのサマリ（2026-09-03・認証不要 GET のみ）

| 対象 | リクエスト | 結果 |
|---|---|---|
| Qiita API v2 | `GET /api/v2/items?query=MCPサーバー created:>=2026-08-27&per_page=1` | 200 / `total-count: 141` / `rate-limit: 60` |
| Google News RSS | `GET /rss/search?q="AIエージェント"&hl=ja&gl=JP&ceid=JP:ja` | 200 / 99,486 B / `<item>` 100件 / 個人非商用限定の著作権表記 |
| Wikipedia Action API | `action=query&redirects=1&titles=...`（4件） | 200 / `missing` と `pageid` と `touched` を返す |
| Wikipedia 初版 | `prop=revisions&rvdir=newer&rvlimit=1` | 200 / バイブコーディング初版 `2025-03-18T23:46:45Z` |
| Pageviews API | `per-article/ja.wikipedia/all-access/user/{title}/monthly/...` | 200 / AIエージェント 55 PV vs 知的エージェント 841 PV（2026年8月） |
| Pageviews API（UA無し） | 同上・`User-Agent:` を空に | **403** |
| Frankfurter v2 | `GET /v2/rates?base=USD&quotes=JPY` | 200 / `159.87`（date 2026-09-03） |
| Frankfurter v2 | `GET /v2/rates?...&providers=ECB` | 200 / `159.6`（date 2026-09-02） |
| Frankfurter v2 | `GET /v2/rates?...&expand=providers` | 200 / 73プロバイダの個別レートと日付、外れ値に `excluded: true` |
| Frankfurter 旧 | `GET api.frankfurter.app/latest?...` | **301** → `api.frankfurter.dev/v1/latest?...` |
| open.er-api.com | `GET /v6/latest/USD` | 200 / JPY 159.088772 / 166通貨 / `time_next_update_utc` あり / CORS `*` |
| ECB XML | `GET /stats/eurofxref/eurofxref-daily.xml` | 200 / `time='2026-09-02'` / USD 1.1578 / JPY 184.78（→ USD/JPY 159.59） |
| USPTO tmsearch | `GET /search/search-results?q=openai` | 200 / 125,660 B / 本文に `openai` 0回 / SPA殻 |
| USPTO TSDR | `GET tsdrapi.uspto.gov/ts/cd/casestatus/...` | **401** |
| USPTO ODP | `GET api.uspto.gov/api/v1/...` | **401 `{"message":"Unauthorized"}`** |
| J-PlatPat | `GET /t0100`（curl既定UA） | 200 → `reject_sorry.html`（メンテナンス告知） |
| J-PlatPat | `GET /t0100`（ブラウザUA） | 200 → `/?uri=/t0100` |
| WIPO branddb | `GET /en/quicksearch/results?by=brandName&v=openai&...` | 200 / 1,719 B / 本文に `openai` 0回 |
| TMview | `GET /tmview/#/tmview/results?basicSearch=openai` | 200 / 531 B（フラグメントは送信されない） |
| TMview 内部API | `GET /tmview/api/search/results?...` | **405** |
| EUIPO eSearch | `GET /eSearch/#basic/.../openai` | 200 / 12,989 B（同上） |
| connpass API v2 | `GET /api/v2/events/?keyword=MCP&count=1` | **401 `{"detail": "Unauthorized"}`** |
| connpass API v1 | `GET /api/v1/event/?keyword=MCP&count=1` | **403** |
| はてブ 検索RSS | `GET /search/text?q=MCP&mode=rss&users=1` | 301 → 200 / RSS 1.0 / `<item>` ちょうど40件 / 総件数フィールドなし |
| はてブ jsonlite | `GET /entry/jsonlite/?url=...` | 200 / JSON |
| はてブ count | `GET bookmark.hatenaapis.com/count/entry?url=https://qiita.com/` | 200 / `2630` |
| Zenn 非公式 | `GET /api/articles?count=1&order=latest` | 200 / JSON |
| note 非公式 | `GET /api/v3/searches?context=note&q=MCP&size=1` | 200 / JSON（ただし robots.txt が `/api/*` を Disallow） |

## 付録B：参照した一次情報

すべて確認日 2026-09-03。

- Qiita API v2 ドキュメント — https://qiita.com/api/v2/docs
- Qiita API・スクレイピングについて — https://help.qiita.com/ja/articles/qiita-api
- Qiita robots.txt — https://qiita.com/robots.txt
- Wikimedia User-Agent ポリシー — https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy
- Wikimedia Analytics API — https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/
- Wikimedia APIs（カタログ） — https://www.mediawiki.org/wiki/Wikimedia_APIs
- Zenn 利用規約 — https://zenn.dev/terms ／ robots.txt — https://zenn.dev/robots.txt
- note robots.txt — https://note.com/robots.txt
- Yahoo!デベロッパーネットワーク APIドキュメント — https://developer.yahoo.co.jp/sitemap/
- connpass API について — https://help.connpass.com/api/ ／ API利用規約 — https://help.connpass.com/api/api-term
- Frankfurter 公式ドキュメント — https://frankfurter.dev/
- ExchangeRate-API Open Access ドキュメント — https://www.exchangerate-api.com/docs/free
- ECB euro reference rates — https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html
- Google Trends: Top / Rising / Breakout — https://support.google.com/trends/answer/4355000
- Google Trends: データについて — https://support.google.com/trends/answer/4365533
- Kleinberg, "Bursty and Hierarchical Structure in Streams" — https://www.cs.cornell.edu/home/kleinber/bhs.pdf
- Exploding Topics のトレンドステータス（Semrush ナレッジベース） — https://www.semrush.com/kb/1490-exploding-topics
- 特許庁「APIを利用した特許情報の試行提供」 — https://www.jpo.go.jp/system/laws/sesaku/data/api-provision.html
- 特許庁 API情報提供サイト — https://ip-data.jpo.go.jp/pages/top.html
- WIPO Global Brand Database 利用規約 — https://www.wipo.int/en/web/global-brand-database/terms_and_conditions
- USPTO 商標データベース検索 — https://www.uspto.gov/trademarks/search
- USPTO TSDR API 仕様 — https://developer.uspto.gov/swagger/tsdr-api-v1
- "Phonotactic probability of brand names: I'd buy that!" — https://pmc.ncbi.nlm.nih.gov/articles/PMC3289729/
- GoDaddy: Using Deep Learning for Domain Name Valuation — https://www.godaddy.com/resources/news/domain-name-valuation
