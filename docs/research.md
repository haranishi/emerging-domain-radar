# 調査統合：新興技術トレンド × 空き .com ドメイン発見ツール

- 対象：購入機能なし・調査専用・個人利用・ローカル動作（Next.js / TypeScript）
- 調査日：2026-09-03（4本のレポートすべて同日）
- 出典レポート：[01 ドメインAPI](research/01_domain_apis.md)／[02 HN・GitHub・Reddit](research/02_trend_sources_hn_github_reddit.md)／[03 論文・PH・Trends・メディア](research/03_trend_sources_papers_ph_trends_media.md)／[04 日本語圏・為替・方法論・商標](research/04_japan_gap_fx_methodology_trademark.md)
- この文書は4本の要約である。実測ログ・応答例・スコア式のコードは各レポートを参照する。

---

## 1. TL;DR

1. **APIキー0個で MVP が成立する。** 採用した10ソースはすべて認証不要のGETで、購入エンドポイントへ到達する経路が存在しない。
2. 空き判定は **RDAP**（IANAブートストラップ → Verisign `.com`）。登録済み200／未登録404を実測（01）。前段にDNS(NS/SOA)フィルタを置いてリクエストを削る。
3. 価格は **Porkbun `GET /api/json/v3/pricing/get`**。認証不要で907 TLDを1回、`.com` は登録・更新・移管とも $11.08（2026-09-03実測・01）。
4. **Premium判定はしない。** `.com` にはレジストリのPremium階層が無く（ICANN .COM手数料表で一律 $10.26/年・2024-09-01発効）、TLD単位価格で足りる。値は `standard_inferred` を返す（01）。
5. トレンドは **HN Algolia・GitHub Search・arXiv・OpenAlex** の4本。いずれも1語1リクエストで期間内の件数が返る（02・03）。
6. OpenAlex はキー無し **$0.10/日**の予算内で回す。`group_by` を付けると1件 **$0.0001**（検索価格の1/10）になる実測が決め手（03）。
7. 日本語圏は **Qiita API v2**（`Total-Count` ヘッダ・未認証60 req/h）と **Wikipedia 日本語版**（Action APIで存在判定＋Pageviews API）（04）。
8. 為替は **Frankfurter v2** の `expand=providers`。どの中央銀行の何日のレートを混ぜたかが応答に入るので、出典明記の要件をそのまま満たす。予備は open.er-api.com（04）。
9. **商標の自動判定は不可能。** 無料で機械から叩ける検索APIが無く、WIPOは automated queries を明示的に禁止している。手動確認リンク＋免責表示までが上限（04）。
10. 落とせないコンプライアンス要件が2つ。Verisign RDAP規約の「大量自動問い合わせ禁止」と、RDAPの404を「空き確定」と表示しないこと（01）。

---

## 2. 採用したAPIと決定理由

| 用途 | 採用 | 理由 | 無料枠・料金 | レート制限 | キー要否 | 詳細 |
|---|---|---|---|---|---|---|
| 空き判定 | RDAP（IANA `dns.json` → `rdap.verisign.com/com/v1/`）＋ DNS(NS/SOA)事前フィルタ | レジストリ直で権威。認証不要・CORS開放。購入機能が存在しないので誤爆しない。`.com` では代替が無い | 無料 | 閾値は非公開（実測10連続で429なし） | 不要 | [01 §9](research/01_domain_apis.md) |
| 価格 | Porkbun `GET /api/json/v3/pricing/get` | 認証不要と公式に明記。1回で907 TLD、CORS `*` で実測 | 無料 | 公式に記載なし | 不要 | [01 §2](research/01_domain_apis.md) |
| Premium判定 | 判定せず `standard_inferred` を返す | `.com` はレジストリPremium階層が無い。新gTLDの premium tier とは構造が違う | — | — | 不要 | [01 §12](research/01_domain_apis.md) |
| トレンド（話題） | HN Algolia `search_by_date` | 1リクエストで `nbHits`。新語が最初に出る場所 | 無料 | 10,000 req/時/IP（公式） | 不要 | [02 §1.2](research/02_trend_sources_hn_github_reddit.md) |
| トレンド（実装） | GitHub `GET /search/repositories` | 1リクエストで `total_count`。`created:` にISO8601範囲が使え、7日窓を秒単位で切れる | 無料 | 未認証10 req/分・認証30 req/分（公式） | 不要（権限ゼロのfine-grained PATで枠が3倍） | [02 §2](research/02_trend_sources_hn_github_reddit.md) |
| トレンド（プレプリント） | arXiv API `export.arxiv.org/api/query` | `opensearch:totalResults` が件数。投稿日ベースで OpenAlex より速報性が高い | 無料 | 3秒に1回・単一接続（公式） | 不要 | [03 §1](research/03_trend_sources_papers_ph_trends_media.md) |
| トレンド（論文） | OpenAlex `/works`（`title.search` ＋ `group_by=publication_year`） | 引用符でフレーズ完全一致が効く。`group_by` で件数取得が $0.0001/回 | キー無し $0.10/日（実測ヘッダ）／無料キーで $1/日 | 100 req/s ＋日次予算制（UTC 0時リセット） | 不要 | [03 §2](research/03_trend_sources_papers_ph_trends_media.md) |
| 日本語圏（記事） | Qiita API v2 `GET /api/v2/items` | `Total-Count` ヘッダに全件数。`query` に `created:>=` が使える。API経由の利用を公式が明示的に許可 | 無料 | 未認証60 req/h・認証1,000 req/h（公式） | 不要 | [04 §1.3](research/04_japan_gap_fx_methodology_trademark.md) |
| 日本語圏（上陸判定） | Wikipedia 日本語版 Action API（`redirects=1`） | 記事の存在有無と初版日時で「日本語圏に上陸したか」を二値で確定できる。1リクエストで最大50タイトル | 無料 | 数値上限は未確認 | 不要（説明的UA必須） | [04 §1.4](research/04_japan_gap_fx_methodology_trademark.md) |
| 日本語圏（関心量） | Wikimedia Pageviews API | 上陸後の関心量を日次PVで数値化。CORS `*`・4時間キャッシュを実測 | 無料 | 数値上限は未確認 | 不要（UAなしは403を実測） | [04 §1.4](research/04_japan_gap_fx_methodology_trademark.md) |
| 為替 USD→JPY | Frankfurter v2 `api.frankfurter.dev`（`expand=providers`） | 各中央銀行のキー・日付・レートが応答に入り、出典明記の要件を満たす。`providers=ECB` でECB単独も選べる | 無料 | 公式に記載なし（未確認） | 不要 | [04 §2.3](research/04_japan_gap_fx_methodology_trademark.md) |
| 為替（予備） | open.er-api.com `/v6/latest/USD` | `provider`・`time_last_update_utc`・`time_next_update_utc` を返す。CORS `*` | 無料（Openプラン） | 429で20分ブロック | 不要（**帰属表示リンク必須・再配布禁止**） | [04 §2.4](research/04_japan_gap_fx_methodology_trademark.md) |
| LLMによる語抽出 | 任意。Anthropic API または ローカル Codex CLI。**既定は none** | 4本のレポートには記載がない。決定事項として記録する | — | — | Anthropic APIはキー要 | （レポート外） |

スコアリングは外部APIではなくローカル実装。Trend Score は成長率・加速度・ソース数・絶対量の小ささの4成分の加重和、Status は絶対量と成長率の順序付きルール、Domain Score は7成分。式とコードは [04 §3・§5](research/04_japan_gap_fx_methodology_trademark.md) にある。

---

## 3. 採用しなかったものと理由

| 対象 | 採用しない理由 | 出典 |
|---|---|---|
| Reddit Data API | Data API Terms 2.8 がOAuthトークンでのアクセスを義務づけ、公式ヘルプが「OAuthを使わないトラフィックはブロックする」と明記。未認証 `.json` は実測でHTTP 403。検索に総件数フィールドが無く、`limit` 上限100でページングして数えるしかない。商用は3.1で別契約 | 02 |
| Crossref（件数用途） | `query.bibliographic` がフレーズ検索にならず、引用符あり・なしで同一件数（4,536件）。この数字を出現件数として使うと誤る | 03 |
| Semantic Scholar | 無認証で `/paper/search` がほぼ常時429。キー申請が事実上の前提で、承認期間は公式に記載なし。母数もOpenAlexより小さい | 03 |
| Product Hunt API v2 | 公式ドキュメントに「must not be used for commercial purposes」。件数フィールドが無くページングが必要。`posts` の引数も公式スキーマページが404で裏が取れていない | 03 |
| Google Trends 公式API | 2025-07-24の発表から1年以上たった2026-09-03時点でもアルファ・申請制。料金・レート制限・GA時期はいずれも非公開。MVPの前提にできない | 03 |
| Google Trends RSS | 返るのは当日の急上昇ワードのみで、任意キーワードの関心度時系列は取れない。内容もスポーツ・芸能中心で技術新語がほぼ乗らない。公式ドキュメントも見つからない | 03 |
| pytrends（非公式） | GitHubで archived（最終push 2024-08-10）、PyPI最新は4.9.2（2023-04-13）。Google側の内部API変更に追従されない | 03 |
| X API | 無料枠が無い。Posts読み取り $0.005/件で、100件返る検索1回が $0.50。30語×日次で月$450相当。「読んだPost 1件ごと」の課金は件数だけ欲しい用途と構造的に合わない | 03 |
| YouTube Data API v3 | `search.list` が1日100回の専用バケット（10,000 unitsとは別建て）で1日50語が限界。`pageInfo.totalResults` は概算。字幕は `captions.download` に動画の編集権限が必要で他人の動画から取れず、非公式取得は規約が禁じている | 03 |
| Apple Podcasts Search / Podcast Index | Appleは期間フィルタが無く `limit` 上限200（実測で91件打ち止め）＝件数の推移に使えない。Podcast Index は無料キー＋SHA-1署名の実装が要り、レート制限が仕様書に無い | 03 |
| Listen Notes API | 無料枠300 requests/月では日次監視に足りず、次のプランが $200/月 | 03 |
| Google News RSS | フィード本文の `<copyright>` が「personal feed reader での個人・非商用利用に限る。それ以外の利用は明確に禁止」と定めている（実測）。加えて `<item>` が100件で頭打ちで総件数が取れない | 04 |
| Namecheap API | 有効化条件（20ドメイン保有／残高$50／直近2年$50消費のいずれか）とIPv4ホワイトリストが必要。キーはスコープ無しで `domains.create` が同じキーで通る | 01 |
| GoDaddy Domains API | 可用性チェックの利用条件が「50ドメイン保有」「月平均$20超の支払い」「Discount Domain Club」のいずれか。`domains.domain:read` で購入権限を分離できる数少ない選択肢だが、入り口の条件が個人ツールには重い | 01 |
| Name.com Core API v1 | HTTP Basic認証でスコープ無し。同じトークンで `POST /core/v1/domains`（登録）が通る | 01 |
| Dynadot API v3 | キー1本で `register` から `place_auction_bid` まで通る。価格が `"44.00 in USD and domain is not premium"` という自然文でパースが脆い。通常アカウントは1コマンド1件 | 01 |
| Cloudflare Registrar API | 検索・空き判定・価格取得の機能自体は優秀だが、公式ガイドが **Registrar write 権限のトークンと有効な既定の支払い方法**を前提にしている。登録は返金不可。調査専用ツールが背負うリスクとして最大 | 01 |
| Domainr API v2 | 公式ドキュメントが `(deprecated)` 表記。価格が返らない。未認証は実測401。後継のFastly Domain Research APIは従量課金で無料枠の記載が無い | 01 |
| Porkbun `checkDomain`（キー付き） | 既定レート制限が1件/10秒/アカウントで、1,000件に約2.8時間。キーに購入権限が同梱され、読み取り専用スコープが存在しない | 01 |

**注記（レポート間の差）**：レポート03は Product Hunt・Google Trends RSS・Apple Podcasts を P1 として推奨している。今回の確定した採用構成ではこの3つを外している。レポート04はGoogle Trends系の外部シグナルを P2 に置いており、03のP1評価と揃っていない。

---

## 4. ドメインAPI比較表

Read-only運用可否＝「読み取りだけのクレデンシャルを発行できるか」。不可のものは、キー1本に購入権限が不可分に同梱される。

| サービス | 空き判定 | 価格 | 1回の最大件数 | レート制限 | キー | **Read-only運用** | 有効化条件 |
|---|---|---|---|---|---|---|---|
| **RDAP（Verisign）** | ○ 200/404 | × | 1 | 非公開（実測10連続で429なし） | 不要 | **完全に安全**（購入機能なし） | なし |
| **Porkbun `pricing/get`** | × | ○ TLD単位 | 全TLD一括 | 記載なし | 不要 | **完全に安全** | なし |
| Porkbun `checkDomain` | ○ レジストリ直 | ○ 個別＋premium | 1 | 1件/10秒/アカウント（既定） | 要 | **不可**（購入権限が同梱） | 記載なし |
| Namecheap | ○ | △ premiumのみ（通常価格は別API） | 50 | 50/分・700/時・8000/日 | 要 | **不可**（スコープ概念なし） | 20ドメイン／$50残高／2年$50消費のいずれか＋IPv4固定 |
| Cloudflare Registrar | ○ `domain-check` | ○ `registration_cost`/`renewal_cost` | 20 | 1,200/5分/ユーザー | 要（**write**） | **未確認**（ガイドはwrite要求、APIリファレンスは操作相応と矛盾） | 支払い方法・登録者連絡先の設定必須 |
| GoDaddy v3 | ○（`definitive` で権威性が分かる） | ○ 複数期間・`inventory` で3種のpremium | 25 | 60/分/クレデンシャル | 要（PAT） | **可**（`domains.domain:read`） | 50ドメイン or 月平均$20超 or DDC |
| Name.com Core v1 | ○ | ○ `purchasePrice`（更新は別API） | 50 | 20/秒・3,000/時 | 要 | **不可**（Basic認証・スコープなし） | 記載なし。v4は2026年サンセット予定 |
| Dynadot v3 | ○ | △ 自然文文字列 | 1（Regular）/100（Bulk） | 60/分（Regular）〜6,000/分 | 要 | **不可**（オークション入札まで同一キー） | 全アカウント利用可 |
| Domainr v2 | ○ 詳細な状態値18種 | × | 1 | 非公開 | 要 | 安全（購入機能なし） | **deprecated**。RapidAPIの無料枠は未確認 |
| Fastly Domain Research | ○ precise/estimate | △ アフターマーケット `offers` のみ | 1 | 30秒ランタイム上限 | 要 | 安全 | 従量課金・**無料枠の記載なし**・superuserが有効化 |
| Spaceship | ○ | △ premiumのみ | 20 | 30req/30秒（ユーザー）／5req/300秒（ドメイン） | 要（Key+Secret） | **可**（`domains:read`） | 未確認 |
| WhoisXML / Whoapi | ○ DNS or DNS+WHOIS | × | 1 | 未確認 | 要 | 安全 | WhoisXMLは100クレジット無料・クレカ不要／Whoapiは$23/月〜 |
| DNS（NS/SOA） | △ 一次フィルタのみ | × | — | リゾルバ依存 | 不要 | 安全 | **NXDOMAIN→空き は誤り**。「引けたら登録済み確定」方向にのみ使う |
| WHOIS（TCP 43） | △ 非構造テキスト | × | 1 | Verisign規約の対象 | 不要 | 安全 | gTLDはRDAPへ一本化済み。新規実装で選ぶ理由なし |

---

## 5. トレンド情報源比較表

7日／30日の件数は、**同じクエリの期間パラメータだけ差し替えて2回投げ、総件数フィールドを読む**（1語あたり2リクエスト）。窓の境界はUTCの0時に固定する。

| ソース | 件数の取り方 | キー | 費用 | レート制限 | 期間フィルタの精度 | 判定 |
|---|---|---|---|---|---|---|
| HN Algolia | `numericFilters=created_at_i>=..,<..` ＋ `hitsPerPage=1` → `nbHits` | 不要 | 無料 | 10,000 req/時/IP | エポック秒で厳密 | **採用** |
| GitHub `/search/repositories` | `q="語" created:..T..Z..` ＋ `per_page=1` → `total_count` | 不要 | 無料 | 未認証10/分・認証30/分 | ISO8601で厳密 | **採用** |
| arXiv | `submittedDate:[YYYYMMDDTTTT TO ..]` ＋ `max_results=1` → `opensearch:totalResults` | 不要 | 無料 | 3秒に1回・単一接続 | GMT・分単位で厳密 | **採用** |
| OpenAlex | `filter=title.search:"語",from_publication_date:..,to_publication_date:..&group_by=publication_year` → `meta.count` | 不要 | $0.10/日（キー無し） | 100 req/s＋日次予算 | 出版日で厳密。索引日フィルタは有料プラン限定 | **採用** |
| Qiita API v2 | `?query=語 created:>=..&per_page=1` → `Total-Count` ヘッダ | 不要 | 無料 | 未認証60 req/h | `created:>=` / `created:<=` で厳密 | **採用** |
| Wikipedia Action API | `titles=` で最大50件を一括 → `missing` / `pageid` / 初版 `timestamp` | 不要 | 無料 | 未確認 | 件数ではなく存在と初版日 | **採用** |
| Wikimedia Pageviews | `per-article/ja.wikipedia/all-access/user/{title}/daily/..` の日次PVを合計 | 不要 | 無料 | 未確認 | 日次で厳密 | **採用** |
| HN 公式 Firebase | 全文検索の口が無い。全アイテム走査が必要 | 不要 | 無料 | 「現在制限なし」（公式） | — | 不採用（個別メタデータの補助のみ） |
| GitHub Search code | `total_count` は返るが索引条件が厳しい | **必須** | 無料 | 10 req/分 | ISO8601 | 不採用 |
| GH Archive | 時間単位のJSON.gzかBigQueryで自前集計 | 不要／BigQueryは要 | 無料（BigQueryは月1TBまで） | — | イベント単位で最も細かい | P2（ローカルツールには重い） |
| Reddit Data API | **総件数フィールドなし**。`limit`100でページングして自前集計 | **必須（OAuth）** | 無料枠あり | 100 QPM/client id（10分平均） | `t=week`/`t=month` のみ＝粗い | 不採用 |
| Semantic Scholar | `total`（bulkは推定値） | 事実上必須 | 無料 | キー保持で1 RPS | `publicationDateOrYear=a:b` | 不採用 |
| Crossref | `rows=0` で `total-results` | 不要（mailto推奨） | 無料 | polite 3 req/s・public 1 req/s | `from-pub-date`/`until-pub-date` は動作 | 不採用（件数が信頼できない） |
| Product Hunt v2 | 件数フィールドなし。`postedAfter`/`postedBefore` でページング | 要（developer token） | 無料 | 6,250 complexity/15分 | 引数仕様が未確認 | 不採用 |
| Google Trends 公式API | 関心度スコア（リクエスト間で一貫したスケーリング） | 申請制 | 不明 | 不明 | 日/週/月/年 | 不採用（入手不可） |
| Google Trends RSS | 当日の急上昇ワード一覧のみ | 不要 | 無料 | 不明 | 当日のみ | 不採用 |
| X API | `meta.result_count` | 必須 | $0.005/Post（検索1回で約$0.50） | 月300万Post読み上限 | `start_time`/`end_time`（recentは7日） | 不採用 |
| YouTube Data API v3 | `pageInfo.totalResults`（**概算**） | 必須（無料） | 無料 | `search.list` 100回/日 | `publishedAfter`（RFC 3339） | 不採用 |
| Apple Podcasts Search | `resultCount`（上限200） | 不要 | 無料 | 未確認（約20 req/分は通説） | **期間フィルタなし** | 不採用 |
| Podcast Index | 件数フィールドあり | 無料キー＋SHA-1署名 | 無料 | 未確認 | `since` | 不採用 |
| Listen Notes | あり | 必須 | 無料300 req/月・次は$200/月 | 300 req/月 | あり | 不採用 |
| はてなブックマーク 検索RSS | **取れない**（`<item>` ちょうど40件・総件数要素なし） | 不要 | 無料 | 未確認 | — | P2（二値シグナルとしてのみ） |
| Zenn `/api/articles` | 取れない | 不要 | 無料 | 未確認 | — | P2（非公式・壊れる前提） |
| note `/api/v3/searches` | 取れる | 不要 | 無料 | 未確認 | — | 不採用（robots.txt が `/api/*` を Disallow） |
| Google News RSS | **取れない**（100件で頭打ち） | 不要 | 無料 | 未確認 | — | 不採用（ライセンス） |
| connpass API v2 | 取れる | **必須**（申請制・無償） | 無料 | 数値非公開 | あり | P2（申請と審査が挟まる） |

同じ語でもソースごとに桁が違う（例：`agentic ai` 30日は OpenAlex `title.search` 525件・arXiv `all:` 95件・Semantic Scholar 223件）。**絶対値を横断比較せず、同一ソース内の時系列変化だけを見る**（03）。

---

## 6. 重要な制約と落とし穴

- **Verisign RDAP規約は大量自動問い合わせを禁じている。** 「登録・変更に必要な範囲を超える high volume, automated, electronic processes」が禁止行為に挙がっており、アクセス制限は Verisign の裁量。総当たりスキャンは規約違反になりうる。候補を絞ってから照会し、ネガティブキャッシュ・同時実行1〜2・429と `Retry-After` 尊重の指数バックオフを**機能ではなくコンプライアンス要件として**実装する（01 §9）。
- **RDAPの404は「空き確定」ではない。** ①純粋に未登録、②レジストリ/ICANNの予約、③ブロックリスト・商標保護（DPML等）による拒否が、すべて同じ404に見える。「404＝空きの候補」とUIに明記する。なお「短い名前＝予約」という仮説は成立しない（`b.com` `q.com` `nic.com` はいずれも200を実測）（01）。
- **RDAPは価格もpremiumも返さない。** `.com` に限れば実害は小さいが、`.ai` `.io` `.dev` に広げた時点で個別価格APIが必須になる（01）。
- **OpenAlexの日次予算と `group_by` 割引は明文化されていない。** キー無し$0.10/日・無料キー$1/日は実測ヘッダで確認したが、`group_by` で $0.001 → $0.0001 になる挙動は料金ページに記載がない。**仕様変更で戻される前提**でコードを書き、`x-ratelimit-cost-usd` と `x-ratelimit-remaining-usd` を毎回ログに残す（03）。公式ブログは「all requests でキーが必要」、ヘルプは「キー無しでも基本的なクエリは可能」と記述が揃っていない点にも注意。
- **arXivの429は「直前1回との間隔」ではなく累積で効く。** 公式は3秒に1回・単一接続だが、実測では4秒間隔でも連続10回程度で429（本文 `Rate exceeded.`）。60秒あけて回復した直後に20秒間隔で投げた2本目も429だった。5秒間隔＋指数バックオフを最初から入れる（03）。
- **HNの `nbHits` は常に厳密ではない。** 高頻度語は概算値になる（実測：7日窓で `agent` 3,854件が `exhaustiveNbHits: false`、`"context engineering"` 5件が true）。**`exhaustiveNbHits` を必ず読み、falseなら「概算」と表示する**。新語は低頻度側なので実害は小さい（02）。
- **フレーズはダブルクォートで囲まないと桁が変わる。** HNは7日窓で5件 → 51件、OpenAlexは30日で `title_and_abstract.search` が1,003件 → 5,642件（引用符なし）。両ソースで引用符を必須にする（02・03）。
- **GitHubの `in:readme` は付ける/付けないを固定する。** 実測で50件 → 456件（約9倍）に変わる。途中で変えると時系列が壊れる。既定の検索スコープの正確な定義は公式に記述がない（02）。
- **Qiitaは未認証60 req/h。** 25語×2窓で50リクエスト＝1時間枠の8割を使う。キャッシュ無しでは即詰まる。語数を増やすなら認証（1,000 req/h）へ移る（04）。
- **Wikipediaはリダイレクトを解決しないとPVが桁違いにずれる。** Action APIで `redirects=1` を付けて正規タイトルへ解決してからPageviewsを引く（実測：「AIエージェント」55 PV vs リダイレクト先「知的エージェント」841 PV・2026年8月）。Pageviews APIはUAなしで403（04）。
- **DNSは片方向にしか使えない。** NXDOMAINは「委任されていない」であって「未登録」ではなく、登録済みでNS未設定のドメインを空きと誤判定する。「引けたら登録済み確定 → RDAPを叩かない」方向にのみ使う（01）。
- **Google News RSSはライセンスで使えない。** フィード本文の著作権表記が「personal feed reader での個人・非商用利用に限る。それ以外の利用は明確に禁止」と定めている（04）。
- **商標の確認リンクは検索画面を開くだけで、結果が出ない場合がある。** USPTO・WIPO・EUIPO・TMviewはいずれもSPAで、キーワード付きURLが200を返してもHTML本文に検索語が現れない（USPTOは `q` の値を変えても同一の125,660バイト）。EUIPO/TMviewの `#` 以降はそもそもHTTPリクエストに含まれない。**ブラウザで実際に検索が走るかは未検証**。検索語のコピーボタンを併置する（04）。
- **J-PlatPatはUser-Agent判定。** 同一URL `/t0100` が、curl既定UAでは `reject_sorry.html`（本文はメンテナンス告知）、ブラウザ相当UAでは `/?uri=/t0100` になる。キーワードの有無とは無関係。UAを偽装してまで叩かない。検索語をURLで渡す公式仕様も確認できない（04）。
- **商標は文字列一致では判定できない。** 称呼・外観・観念の類似と、指定商品・役務の区分で決まる。未登録の著名商標や出願中の案件はデータベースに現れない。誤った「安全」表示は実害を出すので、「法的助言ではなく登録可能性の判定でもない」旨を常時表示する（04）。
- **為替は参考値と明記する。** ECB自身が「Using the rates for transaction purposes is strongly discouraged」と述べている。Frankfurterは2026-09時点でECB専用ではなく84中央銀行のブレンドで、土日のレートも返る。予備の open.er-api.com を使う場合は帰属表示リンク（`Rates By Exchange Rate API`）が必須で、再配布は禁止（04）。
- **`.com` 卸値の次回改定は準一次情報。** 2026-11-01に $10.26 → $10.97（約7%）とされるが、一次資料PDFの取得がHTTP 403で失敗している。ICANN掲載の新しい `.com fee schedule` が出たら差し替える。ICANNの取引ベース手数料は $0.20/件（FY26・2025-07-01発効。旧 $0.18）（01）。
- **Trend Score と Domain Score は掛け算しない。** 独立した2軸で、掛けると「勢いはあるが名前が悪い」と「名前は良いが勢いが無い」が区別できなくなる。散布図で見せる（04）。

---

## 7. 無料でできる範囲

キーは0個、外部費用はOpenAlexの日次予算内のみ。前提はキーワード25語、トレンド4ソース×2窓（7日・30日）、RDAP照会は1日最大300件（自主上限）。

| ソース | 1日の呼び出し | 上限に対する位置 | 出典 |
|---|---:|---|---|
| HN Algolia | 25語 × 2窓 = **50** | 10,000 req/時/IP の 0.5% | 02 |
| GitHub Search（未認証） | 25語 × 2窓 = **50** | 10 req/分 ＝ 5分以上かけて逐次実行 | 02 |
| arXiv | 25語 × 2窓 = **50** | 5秒間隔＋バックオフで約4〜8分 | 03 |
| OpenAlex（キー無し・`group_by`） | 25語 × 2窓 = **50**（$0.005/日） | $0.10/日 予算の 5% | 03 |
| Qiita（未認証） | 25語 × 2窓 = **50** | 60 req/h の 83%。**ここが最初に詰まる** | 04 |
| Wikipedia Action API | 25語を一括 = **1** | 1リクエスト最大50タイトル | 04 |
| Wikimedia Pageviews | 正規タイトル25件 = **25** | 上限は未確認。1 req/秒に自主規制 | 04 |
| Frankfurter v2 | **1** | 応答が約20時間キャッシュ可 | 04 |
| Porkbun `pricing/get` | **1** | 起動時1回 → 24時間キャッシュ | 01 |
| IANA RDAPブートストラップ | **1** | `max-age=86400` ＝1日1回で足りる | 01 |
| RDAP（Verisign） | 候補ドメイン **最大300** | 閾値は非公開。DNS事前フィルタ＋ネガティブキャッシュ＋同時実行1〜2＋バックオフが前提 | 01 |
| **合計** | **約580リクエスト/日** | **キー0個・費用 $0.005/日（OpenAlexのみ）** | — |

構成の性質（01 §14）：認証情報が存在しないので漏洩も誤爆もない。購入エンドポイントに到達する経路が物理的に無い。クレジットカード登録もアカウント作成も不要。RDAPとPorkbunはどちらも `Access-Control-Allow-Origin: *` なので、レート制御を集中管理できるサーバー側（Route Handler）に寄せる。

RDAPの300件は規約上の上限ではなく、規約リスクを下げるための自主的な上限である。1トレンドあたり数十件まで候補を絞ってから照会する。

---

## 8. 未確認事項

### ドメイン・価格（01）

1. `.com` 卸値の2026-11-01改定（$10.97）— Verisign決算リリースPDFがHTTP 403。ICANN掲載の新しい手数料表で差し替える
2. Cloudflare Registrar の read-only トークンで `domain-search` / `domain-check` が通るか — ガイドはwrite要求、APIリファレンスは「呼ぶ操作に応じた権限」と矛盾
3. Porkbun `checkDomain` のレート制限引き上げ方法 —「configurable per API key」とあるが設定箇所の記載が無い
4. Porkbun のAPI利用規約本体 — `porkbun.com/policies/tos` が404。自動問い合わせの可否が確認できない
5. Verisign RDAP の実際のレート制限閾値 — 非公開。**探る行為自体が規約違反になりうるので意図的に探らない**
6. Domainr（RapidAPI経由）の無料枠・クレカ要否／WhoisXML の有料プラン価格 — 該当ページがJSレンダリングで取得できず
7. Namecheap `.com` の更新価格／GoDaddy `.com` の小売価格 — 前者は公式ページに記載なし、後者は403
8. Spaceship の無料枠・サンドボックス・API利用条件 — ドキュメントに記載が見当たらない

### トレンド（02・03）

9. HN Algolia の利用規約・帰属表示義務、HN 公式 Firebase API のライセンス — どちらもドキュメントに規約リンクが無い
10. HN Algolia の `typoTolerance` — Algolia共通パラメータとしては存在するが、HN側のドキュメントに記載なし・挙動は未実測
11. GitHub リポジトリ検索の既定検索スコープの正確な定義 — `in:readme` の有無で約9倍変わることは実測したが、既定で何を検索しているかの明示的な記述が無い
12. GitHub 認証済みリクエストのレート制限の実測値 — PATを使わなかったため未実測（公式値のみ）
13. GH Archive のライセンス・利用規約 — サイト上に明示的な記述が見つからない
14. Reddit の未認証 `.json` の「10 QPM」枠、対象subredditの実在と正式名称、`search` の実応答形式 — 403のため確認手段がない（HTMLは存在しない名前でも200を返す）
15. Product Hunt の `posts` クエリ引数 — 公式スキーマページが404。`postedAfter` / `postedBefore` / `order` はコミュニティ実装での確認にとどまる
16. OpenAlex の `group_by` 課金割引 — 実測$0.0001だが料金ページに明文化されていない
17. arXiv 以外の細目：Podcast Index のレート制限（仕様書に記載なし）、Apple iTunes Search API のレート制限（ヘッダにも公式ページにも無い）、Semantic Scholar のキー承認期間（記載なし）
18. X API の full-archive search の提供可否と価格／旧 Basic・Pro 廃止 — 第三者記事のみで一次情報の裏が取れていない
19. Google Trends RSS の公式性 — 実測では稼働しているが、Googleのドキュメントで説明したページが見つからない
20. Podcasting 2.0 `<podcast:transcript>` の付与率 — 仕様は存在するが実際の対応率を測っていない

### 日本語圏・為替・方法論・商標（04）

21. 商標DBのキーワード付きURLで、ブラウザ上の検索が実際に走るか — 影響は小（リンクが検索画面を開くだけでも実用に足る）。Playwright等で1度実測すれば埋まる
22. Wikimedia の具体的な req/sec 上限 — 公式ドキュメントに数値が見当たらない
23. Frankfurter のレート制限とCORS可否 — レート制限は記載なし。実測ヘッダに `Access-Control-Allow-Origin` が出なかった（サーバー側で叩くなら影響なし）
24. はてなブックマークAPIの公式規約 — 規約ページを特定できていない
25. Zenn の自動取得に関する規約上の扱い — 利用規約に明文が無く、robots.txt も `/api` を禁じていない＝グレー
26. note.com の利用規約本文 — 403で取得できず（robots.txt の明示的拒否だけで不採用は確定）
27. 音節数と記憶しやすさの査読論文 — 二次情報のみで確認。実装では緩い減点にとどめている
28. **Trend Score / Status の閾値の妥当性（影響：大）** — 実データを2週間貯めて、既知の語（MCP・バイブコーディング等）が正しいStatusに落ちるか検証する

---

## 9. 一次情報URL一覧

すべて確認日 2026-09-03。

### RDAP・ドメイン価格の一次資料

- IANA RDAPブートストラップ <https://data.iana.org/rdap/dns.json>
- Verisign RDAP ヘルプ <https://www.verisign.com/news-insights/registration-data-access-protocol/help/> ／ 利用規約 <https://www.verisign.com/legal-center/rdap-terms/>
- .COM 手数料表（2024-09-01発効） <https://itp.cdn.icann.org/en/files/registry-agreements/com/com-fees-01-09-2024-en.pdf>
- ICANN FY2026 レジストラ手数料 <https://www.icann.org/en/announcements/details/icann-accredited-registrars-approve-registrar-level-fees-for-fiscal-year-2026-21-07-2025-en>
- Verisign 2026年Q1決算（準一次・PDFは403） <https://investor.verisign.com/news-releases/news-release-details/verisign-reports-first-quarter-2026-results>

### レジストラAPI

- Porkbun API v3 <https://porkbun.com/llms-full.txt> ／ OpenAPI <https://porkbun.com/api/json/v3/spec> ／ 公開価格 <https://api.porkbun.com/api/json/v3/pricing/get> ／ .com <https://porkbun.com/tld/com>
- Namecheap `domains.check` <https://www.namecheap.com/support/api/methods/domains/check/> ／ `users.getPricing` <https://www.namecheap.com/support/api/methods/users/get-pricing/> ／ Intro <https://www.namecheap.com/support/api/intro/> ／ FAQ <https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/> ／ .com <https://www.namecheap.com/domains/registration/gtld/com/>
- Cloudflare Registrar API <https://developers.cloudflare.com/registrar/registrar-api/> ／ APIリファレンス <https://developers.cloudflare.com/api/resources/registrar/> ／ 概要 <https://developers.cloudflare.com/registrar/> ／ レート制限 <https://developers.cloudflare.com/fundamentals/api/reference/limits/> ／ 製品ページ <https://www.cloudflare.com/products/registrar/>
- GoDaddy Domains v3 <https://developer.godaddy.com/doc/endpoint/domains> ／ OpenAPI <https://developer.godaddy.com/openapi/domains-v3.json> ／ Getting Started <https://developer.godaddy.com/getstarted> ／ APIアクセス条件 <https://www.godaddy.com/help/how-do-i-access-domain-related-apis-42424>
- Name.com Core API <https://docs.name.com/llms-full.txt>
- Dynadot Domain API <https://www.dynadot.com/domain/api3.html>
- Domainr API（deprecated） <https://domainr.com/docs/api> ／ status <https://domainr.com/docs/api/v2/status>
- Fastly Domain Research API <https://www.fastly.com/documentation/reference/api/domain-management/domain-research/> ／ <https://docs.fastly.com/products/domain-research-api>
- Spaceship <https://docs.spaceship.dev/> ／ Gandi <https://api.gandi.net/docs/domains/> ／ Squarespace <https://developers.squarespace.com/>
- WhoisXML Domain Availability <https://domain-availability.whoisxmlapi.com/api/documentation/making-requests> ／ WhoAPI <https://whoapi.com/api-documentation/> ・<https://whoapi.com/domain-availability-api/>

### Hacker News・GitHub・Reddit

- HN Algolia Search API <https://hn.algolia.com/api> ／ HN 公式 Firebase API <https://github.com/HackerNews/API>
- GitHub REST レート制限 <https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api> ／ Search <https://docs.github.com/en/rest/search/search> ／ 検索構文 <https://docs.github.com/en/search-github/searching-on-github/getting-started-with-searching-on-github/understanding-the-search-syntax> ／ Search code <https://docs.github.com/en/search-github/searching-on-github/searching-code>
- GitHub 利用規約 <https://docs.github.com/en/site-policy/github-terms/github-terms-of-service> ／ Acceptable Use Policies <https://docs.github.com/en/site-policy/acceptable-use-policies/github-acceptable-use-policies>
- GH Archive <https://www.gharchive.org/>
- Reddit Data API Terms <https://www.redditinc.com/policies/data-api-terms> ／ Data API Wiki <https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki> ／ API ドキュメント <https://www.reddit.com/dev/api> ／ robots.txt <https://www.reddit.com/robots.txt>
- Pushshift Access Request <https://support.reddithelp.com/hc/en-us/articles/16470271632404-Pushshift-Access-Request> ／ Reddit for Researchers <https://support.reddithelp.com/hc/en-us/articles/49381918834964-Reddit-for-Researchers-Program>

### 論文・プロダクト・メディア

- arXiv API ユーザーマニュアル <https://info.arxiv.org/help/api/user-manual.html> ／ 利用規約 <https://info.arxiv.org/help/api/tou.html>
- OpenAlex 料金移行ブログ <https://blog.openalex.org/openalex-api-new-features-and-usage-based-pricing/> ／ 認証 <https://help.openalex.org/guides/authentication> ／ 料金 <https://help.openalex.org/access/pricing> ・<https://help.openalex.org/access/example-costs>
- Semantic Scholar API <https://www.semanticscholar.org/product/api> ／ Swagger <https://api.semanticscholar.org/graph/v1/swagger.json>
- Crossref REST API のコツ <https://www.crossref.org/documentation/retrieve-metadata/rest-api/tips-for-using-the-crossref-rest-api/>
- Product Hunt API v2 <https://api.producthunt.com/v2/docs> ／ レート制限 <https://api.producthunt.com/v2/docs/rate_limits/headers>
- Google Trends API（アルファ） <https://developers.google.com/search/apis/trends> ／ 発表 <https://developers.google.com/search/blog/2025/07/trends-api>
- SerpApi 料金 <https://serpapi.com/pricing> ／ Google Trends API <https://serpapi.com/google-trends-api>
- X API 料金 <https://docs.x.com/x-api/getting-started/pricing> ／ 概要 <https://docs.x.com/x-api/introduction> ／ recent search <https://docs.x.com/x-api/posts/recent-search>
- YouTube Data API v3 <https://developers.google.com/youtube/v3/getting-started> ／ captions.download <https://developers.google.com/youtube/v3/docs/captions/download> ／ YouTube 利用規約 <https://www.youtube.com/t/terms>
- Podcast Index OpenAPI <https://podcastindex-org.github.io/docs-api/pi_api.json> ／ podcast-namespace <https://github.com/Podcastindex-org/podcast-namespace/blob/main/docs/1.0.md> ／ Listen Notes 料金 <https://www.listennotes.com/api/pricing/>

### 日本語圏ソース

- Qiita API v2 <https://qiita.com/api/v2/docs> ／ API・スクレイピングについて <https://help.qiita.com/ja/articles/qiita-api> ／ robots.txt <https://qiita.com/robots.txt>
- Wikimedia User-Agent ポリシー <https://foundation.wikimedia.org/wiki/Policy:User-Agent_policy> ／ Analytics API <https://doc.wikimedia.org/generated-data-platform/aqs/analytics-api/> ／ Wikimedia APIs <https://www.mediawiki.org/wiki/Wikimedia_APIs>
- Zenn 利用規約 <https://zenn.dev/terms> ・robots.txt <https://zenn.dev/robots.txt> ／ note robots.txt <https://note.com/robots.txt>
- Yahoo!デベロッパーネットワーク APIドキュメント <https://developer.yahoo.co.jp/sitemap/>
- connpass API <https://help.connpass.com/api/> ／ API利用規約 <https://help.connpass.com/api/api-term>

### 為替

- Frankfurter <https://frankfurter.dev/>
- ExchangeRate-API Open Access <https://www.exchangerate-api.com/docs/free>
- ECB euro reference rates <https://www.ecb.europa.eu/stats/policy_and_exchange_rates/euro_reference_exchange_rates/html/index.en.html>

### 方法論・ドメイン名品質

- Google Trends: Top / Rising / Breakout <https://support.google.com/trends/answer/4355000> ／ データについて <https://support.google.com/trends/answer/4365533>
- Kleinberg, "Bursty and Hierarchical Structure in Streams" <https://www.cs.cornell.edu/home/kleinber/bhs.pdf>
- Exploding Topics のトレンドステータス（Semrush） <https://www.semrush.com/kb/1490-exploding-topics>
- "Phonotactic probability of brand names: I'd buy that!" <https://pmc.ncbi.nlm.nih.gov/articles/PMC3289729/>
- GoDaddy: Using Deep Learning for Domain Name Valuation <https://www.godaddy.com/resources/news/domain-name-valuation>

### 商標

- WIPO Global Brand Database 利用規約 <https://www.wipo.int/en/web/global-brand-database/terms_and_conditions>
- USPTO 商標データベース検索 <https://www.uspto.gov/trademarks/search> ／ TSDR API 仕様 <https://developer.uspto.gov/swagger/tsdr-api-v1>
- 特許庁「APIを利用した特許情報の試行提供」 <https://www.jpo.go.jp/system/laws/sesaku/data/api-provision.html> ／ API情報提供サイト <https://ip-data.jpo.go.jp/pages/top.html>
