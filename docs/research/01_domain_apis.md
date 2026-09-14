# 調査A：ドメインの空き判定・価格取得API（Read-only運用が前提）

- 調査日：2026-09-03
- 対象プロダクト：新興技術トレンド × 空き .com ドメイン発見ツール（購入機能なし・個人利用・ローカル動作・Next.js/TypeScript）
- 調査方針：一次情報（公式ドキュメント・公式料金ページ・公式規約）で確認。認証不要のGETは実際に叩いて応答を記録した。POST・認証付き・購入/登録/カート/決済系のエンドポイントは一切呼んでいない。

---

## TL;DR

1. **空き判定はRDAP、価格はPorkbunの公開エンドポイント。この2つだけでMVPは成立する。** どちらも認証なし・CORS開放を実測済み。
2. RDAPのブートストラップ（`https://data.iana.org/rdap/dns.json`）は `.com → https://rdap.verisign.com/com/v1/`。登録済み=200、未登録=404（本文0バイト）を実測。
3. Porkbunの `GET /api/json/v3/pricing/get` は認証不要。907 TLDを返し、**.com は registration / renewal / transfer とも $11.08**（実測）。
4. **.com にはレジストリのプレミアム価格階層が無い。** ICANN掲載の .COM 手数料表で初期登録・更新・移管とも一律 $10.26/年（2024-09-01発効）。新gTLDのpremium tierとは構造が違う。
5. 卸値は **2026-11-01 に $10.26 → $10.97（約7%）** の予定。一次資料PDFは取得がブロックされたため準一次扱い（要再確認）。
6. ICANNの取引ベース変動料は **$0.20/件**（FY26・2025-07-01発効。旧 $0.18）。
7. **購入権限を分離できるのはGoDaddy v3（`domains.domain:read`）とSpaceship（`domains:read`）の2つだけ。**
8. Porkbun・Namecheap・Name.com・Dynadotは**キー1本に購入権限が同梱**される。読み取り専用キーは作れない。
9. Cloudflare Registrar APIはベータで検索・価格取得ができるが、**write権限トークンと有効な支払い方法が前提**。誤操作時の被害が最も大きい。
10. Namecheapは有効化条件（20ドメイン保有／残高$50／直近2年$50消費のいずれか）とIPホワイトリストが必要。個人の調査ツールには重い。
11. GoDaddyの可用性チェックは**50ドメイン保有か月平均$20超の支払い**が条件。実質的に入り口で弾かれる。
12. Domainr APIは公式に deprecated。後継のFastly Domain Research APIは従量課金で無料枠の記載なし。
13. **RDAPの落とし穴：価格もpremiumも分からず、予約語・ブロック名と未登録が同じ404に見える。** 「404＝買える」ではない。
14. **規約の落とし穴：Verisign RDAP利用規約は「登録・変更に必要な範囲を超える大量自動問い合わせ」を禁止している。** 総当たりスキャンは規約違反。
15. 結論：P0 = RDAP + Porkbun pricing/get + ローカルキャッシュとレート制御。P1 = GoDaddy v3（readスコープ）またはSpaceship（`domains:read`）。

---

## 1. 実測ログ（2026-09-03）

自分で叩いて確認した認証不要のGETだけを載せる。

| 対象 | リクエスト | 結果 |
|---|---|---|
| IANA RDAPブートストラップ | `GET https://data.iana.org/rdap/dns.json` | 200 / 7,925バイト / `version 1.0` / `publication 2026-07-23T02:00:03Z` / 590サービス / `["com"] → ["https://rdap.verisign.com/com/v1/"]` / `access-control-allow-origin: *` / `cache-control: max-age=86400` |
| RDAP 登録済み | `GET https://rdap.verisign.com/com/v1/domain/example.com` | 200 / `application/rdap+json` / 2,440バイト / `access-control-allow-origin: *` |
| RDAP 未登録 | `GET https://rdap.verisign.com/com/v1/domain/zzq7x4vk2mlp9dwhrn3btf6.com` | **404 / Content-Length 0（本文なし）** |
| RDAP プロキシ | `GET https://rdap.org/domain/<未登録>.com` | 302 → `https://rdap.verisign.com/com/v1/domain/...` → 404 |
| RDAP 連続10リクエスト | 別々の未登録名で10連続 | すべて404。**429は出なかった** |
| Porkbun 公開価格 | `GET https://api.porkbun.com/api/json/v3/pricing/get` | 200 / 82,223バイト / `status: SUCCESS` / **907 TLD** / `access-control-allow-origin: *` / `x-api-version: 3.18` |
| Porkbun モック | `GET https://api.porkbun.com/api/json/v3/mock/domain/checkDomain/example.com` | 200 / スキーマ準拠のサンプル応答（認証不要） |
| Gandi | `GET https://api.gandi.net/v5/domain/check?name=example.com` | **401**（`You must provide an access token or an API Key.`）＝認証必須を確認 |
| Domainr | `GET https://api.domainr.com/v2/status?domain=example.com` | **401**（`Unauthorized`）＝認証必須を確認 |

Porkbunの実測値（抜粋、USD、2026-09-03）：

| TLD | registration | renewal | transfer |
|---|---:|---:|---:|
| com | 11.08 | 11.08 | 11.08 |
| net | 12.52 | 12.52 | 12.52 |
| org | 7.98 | 11.84 | 11.84 |
| dev | 8.75 | 12.87 | 12.87 |
| app | 8.75 | 14.93 | 14.93 |
| io | 28.12 | 51.80 | 51.80 |
| ai | 82.70 | 82.70 | 165.09 |
| xyz | 2.04 | 14.21 | 14.21 |

`.com` は3つとも同額。`.org` `.dev` `.io` `.xyz` は初年度が安く更新で上がる。**新興技術のTLD（.ai / .io / .dev）を扱うなら、初年度価格だけを見せる設計は誤解を生む。**

---

## 2. Porkbun API v3

出典：<https://porkbun.com/llms-full.txt>（v3.18・自分でダウンロード）、<https://porkbun.com/api/json/v3/spec>（OpenAPI）／確認日 2026-09-03

### 空き判定：`POST /api/json/v3/domain/checkDomain/{domain}`

- **POSTのみ。GET版は存在しない**（OpenAPIのpathsで確認。他の読み取り系はGETも受けるが、checkDomainはPOSTだけ）。認証必須。
- 応答（`CheckDomainResponse`。モックGETで実物の形も確認済み）：

| フィールド | 型 | 意味 |
|---|---|---|
| `response.avail` | `"yes"` / `"no"` | 登録可能か |
| `response.type` | string | 価格種別（主価格は常に `registration`） |
| `response.price` | string | 年額登録価格（USD） |
| `response.firstYearPromo` | `"yes"` / `"no"` | 初年度プロモ価格かどうか |
| `response.regularPrice` | string | 通常（非プロモ）登録価格 |
| `response.premium` | `"yes"` / `"no"` | プレミアムドメインか |
| `response.minDuration` | integer | レジストリが要求する最小登録年数 |
| `response.additional.renewal` / `.transfer` | object | それぞれ `type` / `price` / `regularPrice` |
| `limits` | object | `TTL`（窓の秒数）/ `limit` / `used` / `naturalLanguage` |
| `ttlRemaining` | integer | 窓リセットまでの秒数 |

- **レート制限（公式表記）**：「Configurable per API key. Default is 1 check per 10 seconds per account.」OpenAPIの `x-ratelimit` にも `requests: 1, window: 10, scope: account` とある。**1件/10秒は調査ツールには致命的に遅い**（1,000件で約2.8時間）。キー単位で引き上げ可能とあるが、引き上げ方法の記載は見つからず（未確認）。

### 価格取得：`GET /api/json/v3/pricing/get`

- 公式表記「Retrieve default domain pricing information for all supported TLDs. **Does not require authentication.** Prices are in US dollars.」
- GET版は全TLDを返す。TLD絞り込みはPOST版（`tlds` 配列）。
- 応答ヘッダに `access-control-allow-origin: *` → **ブラウザから直接呼べる**（実測）。
- 返るのはTLD単位の標準価格。**個別ドメインのpremium判定はできない。**

### APIキーの権限範囲

- スコープは**IPアロー リストと対象ドメインのアローリストの2つだけ**。「読み取り専用」スコープは存在しない。
- したがって**同じキーで `POST /domain/create/{domain}`（購入）が呼べる**。
- ただしcreateには追加条件がある：メールと電話の認証済み、口座残高が十分、`agreeToTerms` が `'yes'`、`cost`（セント単位）が現在価格と完全一致、**過去に1回以上ドメイン登録実績があること**、プレミアムドメインはAPI登録不可。
- 事故防止に効くのは「残高を入れない」こと。残高ゼロなら `INSUFFICIENT_FUNDS` で止まる。
- `dryRun: true` で課金なしの事前検証ができる（登録・更新・移管・DNS書き込み・NS変更）。
- 冪等キー（`Idempotency-Key`）で24時間の再送重複防止。

### 有効化条件・サンドボックス・規約

- APIキーは <https://porkbun.com/account/api> で作成。**ドメイン保有や残高の条件は文書に記載なし**（＝制限は見当たらないが、明示的な「条件なし」の文言もないため厳密には未確認）。
- サンドボックス：`pk1_sb_` / `sk1_sb_` のキーペア。同じベースURLでキーだけ差し替える。偽クレジット$1000付き。実レジストリ操作・課金は発生しない。可用性と価格は本番カタログを反映する。
- モックサーバー：`GET /mock/<path>` が**認証なし**でスキーマ準拠のサンプル応答を返す。クライアント実装の型合わせに使える。
- 規約（Intended use）：「The Porkbun API is not a reseller service as defined under ICANN's Registrar Accreditation Agreement (RAA). ... The API is intended for managing domains within your own account or on behalf of clients, and does not establish a reseller relationship.」自動問い合わせの明示的な禁止条項は見当たらない（未確認）。
- 429時は `Retry-After` ヘッダ。固定制限のエンドポイントは `X-RateLimit-Limit` / `-Remaining` / `-Reset` も返す。

---

## 3. Namecheap API

出典：<https://www.namecheap.com/support/api/methods/domains/check/>、<https://www.namecheap.com/support/api/methods/users/get-pricing/>、<https://www.namecheap.com/support/api/intro/>、<https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/>／確認日 2026-09-03

### `namecheap.domains.check`

- リクエスト：`DomainList`（カンマ区切り）。GETクエリ文字列。応答はXML固定。
- **1回50件まで。** エラーコード `2011169` の説明が「Only 50 domains are allowed in a single check command」。
- 応答属性：`Domain` / `Available` / `ErrorNo` / `Description` / `IsPremiumName` / `PremiumRegistrationPrice` / `PremiumRenewalPrice` / `PremiumRestorePrice` / `PremiumTransferPrice` / `IcannFee` / `EapFee`。
- 注意：**非プレミアムの通常価格はここでは返らない。** 公式サンプルでも非プレミアムは全部 `0`。通常価格は `users.getPricing` で別途取る必要がある。
- 注記：「Currently, Namecheap does not support registration of premium domains during EAP via API.」

### `namecheap.users.getPricing`

- パラメータ：`ProductType=DOMAIN` / `ProductCategory=DOMAINS` / `ActionName=REGISTER,RENEW,REACTIVATE,TRANSFER` / `ProductName=COM` / `PromotionCode`。
- 応答：`Price`（最終価格）/ `RegularPrice` / `YourPrice`（そのユーザーの価格）/ `CouponPrice` / `Currency`、`Duration` と `DurationType` 付き。

### 有効化条件・制限

- 本番有効化条件（公式FAQ）：「have at least 20 domains under your account」「have at least $50 on your account balance」「have at least $50 spent within the last 2 years」の**いずれか1つ**。
- **IPホワイトリスト必須。IPv4のみ。** 家庭回線の動的IPだと運用が破綻する。
- レート制限（公式FAQ）：**50/分、700/時、8000/日**（キー全体）。
- サンドボックス：`https://api.sandbox.namecheap.com/xml.response`。「There is no restriction on trying out our APIs in the sandbox environment.」条件を満たさなくてもテストは可能。
- **キーは1本でスコープ無し。** `namecheap.domains.create`（購入）も同じキーで通る。キー漏洩＝購入されうる。
- .com 表示価格（<https://www.namecheap.com/domains/registration/gtld/com/>、2026-09-03）：登録・移管 **$10.98**。新規顧客プロモコードで **$6.79**。更新価格は同ページに記載なし（未確認）。
- 同ページ記載：「ICANN ... charges a mandatory annual fee of $0.20 for each domain registration, renewal or transfer.」

---

## 4. Cloudflare Registrar API（ベータ）

出典：<https://developers.cloudflare.com/registrar/registrar-api/>、<https://developers.cloudflare.com/api/resources/registrar/>、<https://developers.cloudflare.com/fundamentals/api/reference/limits/>／確認日 2026-09-03（ドキュメント最終更新 2026-04-24）

**2026年時点では「アカウント内ドメイン一覧だけ」ではない。任意ドメインの検索・空き判定・価格取得ができる。**

| エンドポイント | メソッド | 用途 |
|---|---|---|
| `/accounts/{account_id}/registrar/domain-search?q=&limit=` | GET | キーワードから候補生成。キャッシュ由来で非権威 |
| `/accounts/{account_id}/registrar/domain-check` | POST | レジストリ直問い合わせ。**1回20ドメインまで** |
| `/accounts/{account_id}/registrar/registrations` | POST | 登録（課金・返金不可） |

応答フィールド：

- `name`（punycode）/ `registrable`（boolean）/ `tier`（`standard` | `premium`）
- `pricing`（`registrable: true` のときだけ）：`currency`（ISO-4217）/ `registration_cost` / `renewal_cost`。いずれも小数保持のため**文字列**。
- `reason`（`registrable: false` のとき）：`domain_unavailable` / `extension_not_supported_via_api` / `extension_not_supported` / `extension_disallows_registration` / `domain_premium`

**プレミアム価格は表示されるが、このAPIでは登録できない**（「Search and Check may surface premium pricing, but this API currently supports standard registrations only.」）。

### 使うための前提（ここが重い）

公式の「Before you begin」に4つ書かれている：

1. Cloudflare アカウントID
2. **Registrar write 権限のAPIトークン**
3. **有効な既定の支払い方法を持つ請求プロファイル**
4. 既定の登録者連絡先の設定と、ドメイン登録契約への同意

APIリファレンス側では「use an API token or API key with the appropriate Registrar permissions **for the operations you are calling**」と書かれており、読み取りだけならread権限で足りる可能性がある。ただし**ガイド側は明確に write を要求している。read-onlyトークンで `domain-search` / `domain-check` が通るかは未確認**（実測は認証が必要なため行っていない）。

### 価格方針とレート制限

- 「Buy and renew domains through Cloudflare Registrar at cost, without markup fees. You only pay what is charged by registries and ICANN.」＝卸値＋ICANN手数料のみ。
- **.com の公表価格は無い。** ドキュメントの `acmecorp.com → "8.57"` は説明用のサンプル値であり、卸値$10.26を下回るので実勢価格ではない。実額は計算すると「$10.26 + $0.20 = $10.46」だが、Cloudflareが公表した数字ではない（推定）。
- レート制限：Cloudflare API全体で **1,200リクエスト / 5分 / ユーザー**（ダッシュボード・APIキー・APIトークンを合算）。超過すると5分間すべてのAPI呼び出しが429。
- 登録は成功すると**返金不可**（「All successful domain registrations are non-refundable.」）。

---

## 5. GoDaddy Domains API

出典：<https://developer.godaddy.com/doc/endpoint/domains>、<https://developer.godaddy.com/openapi/domains-v3.json>、<https://developer.godaddy.com/getstarted>、<https://www.godaddy.com/help/how-do-i-access-domain-related-apis-42424>／確認日 2026-09-03

**v1の `GET/POST /v1/domains/available` は現役だが、推奨はv3に移っている。** v3は「quote-execute モデル」（Discover → Quote → Register → Poll）。

### v3 の空き判定

| エンドポイント | 件数 | 備考 |
|---|---|---|
| `GET /v3/domains/check-availability?domain=` | 1件 | `optimizeFor=SPEED`（既定・キャッシュ）/ `ACCURACY`（レジストリ直） |
| `POST /v3/domains/check-availability` | **1〜25件** | `domains` 配列。同じ `optimizeFor` |
| `GET /v3/domains/suggestions` | 最大50件 | `query` / `tlds` / `lengthMin` / `lengthMax` / `pageSize`（最大50） |

応答（`Availability`）：

- `domain` / `unicodeDomain` / `available` / **`definitive`** / `inventory` / `prices[]` / `error`
- `definitive`：「When true, the availability result was confirmed directly with the registry (ACCURACY mode). When false, the result is from a cached zone data check (SPEED mode) and **may be stale**.」
- `inventory`：`REGISTRY`（標準）/ `REGISTRY_PREMIUM`（レジストリのプレミアム階層）/ `PREMIUM`（第三者アフターマーケット）
- `prices[]`（`TermPrice`）：`term`（現状 `YEAR` のみ）/ `period`（1〜10）/ `price` / `renewalPrice` / `firstTermPrice` / `recommended` / `fees[]`

**価格の単位はmicro unitsではない。** v3の `Simple Money` は `{currencyCode, value}` で、`value` は「ISO-4217の当該通貨の暗黙の小数桁に従う整数」。USDなら**セント**（例 `1199` = $11.99）。v1のmicro units仕様とは別物なので、v1のコードを流用すると1000倍ずれる。

### スコープ・環境・制限

- **スコープが分離されている**：`domains.domain:read`（読み取り）/ `domains.domain:create`（登録）/ `domains.dns:update` / `domains.nameserver:update`。公式の入門にも「The request is read-only, so no charges apply. Your token needs the `domains.domain:read` scope.」とある。**readだけのPATを発行すれば購入は物理的に不可能。**
- レート制限：**60 req/分 / クレデンシャル**（公式の Agent & Automation Notes）。429時は `Retry-After`。
- 環境：OpenAPIの `servers` に `api.{godaddy|ote-godaddy|test-godaddy|dev-godaddy}.com/v3/domains`。**OTE（テスト）環境あり。**
- 登録は `quoteToken` を必要とする `POST /v3/domains/registrations`（`Idempotency-Key` 必須）。read スコープのPATでは呼べない設計。

### 本番アクセス条件（2026-09時点で有効）

GoDaddy公式ヘルプ記事42424（2026-09-03確認）：

| 条件 | 使えるAPI | 月間上限 |
|---|---|---|
| 有効ドメイン1本以上 | Domains API | 20,000コール |
| **有効ドメイン50本以上** | Domains API ＋ **ドメイン可用性チェック** | 20,000コール |
| **月平均$20超の支払い** | Domains API ＋ ドメイン可用性チェック | 20,000コール |
| Discount Domain Club - Domain Pro | Domains API ＋ Valuation API | 20,000コール / 日150 |

**「50ドメイン保有 or Discount Domain Club」制限は2026-09現在も有効。** ただし「月平均$20超の支払い」という第3の道が追加されている点が2024年時点との差分。個人の調査ツールでは、どれもハードルとして残る。

---

## 6. Name.com API

出典：<https://docs.name.com/llms-full.txt>（Core API v1）／確認日 2026-09-03

**v4は「legacy」扱い。現行はCore API v1。** 公式表記：「v4 is still supported and will sunset at a predetermined time in 2026」。新規実装でv4を選ぶ理由はない。

| エンドポイント | 件数 | 備考 |
|---|---|---|
| `POST /core/v1/domains:checkAvailability` | **最大50件** | パスのコロンをURLエンコードしてはいけない |
| `POST /core/v1/domains:search` | — | キーワードからのサジェスト |
| `GET` Get Pricing | 1件 | `purchasePrice` / `renewalPrice` / `transferPrice`。ただし標準＋レジストリプレミアムの登録価格のみ |
| Zone Check | — | 高速だが「購入を完了するには不十分」と明記 |

- 応答（`SearchResult`）：`purchasable` / `purchaseType` / `purchasePrice` / `premium` / `reason`
- `purchaseType` は `registration` のほか aftermarket / expiring / backorder があり、**非 `registration` は価格が変動する**（「re-check Check Availability immediately before create」）。トレンド発見ツールでは `purchaseType: registration` に絞るのが実務的。
- 認証：**HTTP Basic（ユーザー名＋APIトークン）。スコープ無し。** 同じトークンで `POST /core/v1/domains`（登録）が通る。
- 開発環境：`https://api.dev.name.com`、ユーザー名に `-test` を付ける（例 `reseller123-test`）＋サンドボックス用トークン。
- レート制限：**20リクエスト/秒、3,000リクエスト/時**（アカウント全体）。加えて登録には「アカウント×ドメイン名」単位の別制限がある。
- WHOIS privacyは全ユーザー無料で、`purchasePrice` に影響しない。

---

## 7. Dynadot API v3

出典：<https://www.dynadot.com/domain/api3.html>／確認日 2026-09-03

- 空き判定：`command=search`。`domain0` 〜 `domain99`。**通常アカウントは1コマンド1件、bulk / super bulk アカウントは最大100件。**
- `show_price=1` を付けると価格とプレミアム情報が返る。応答例は `<Price>44.00 in USD and domain is not premium</Price>` という**自然文の文字列**で、構造化されていない。パースが脆い。
- レート制限（アカウントのspending level別、公式表）：

| Spending Level | Thread Count | Rate Limit |
|---|---|---|
| Regular | 1 thread | 60/min（1/sec） |
| Bulk | 5 threads | 600/min（10/sec） |
| super bulk | 35 threads | 6000/min（100/sec） |
| premium bulk | 25 threads | 6000/min（100/sec） |

- サンドボックス：`https://api-sandbox.dynadot.com/api3.json`（専用のSandbox APIキー）
- **キーは1本で全コマンド。** `register` / `bulk_register` / `buy_it_now` / `place_auction_bid` まで同じキーで通る。権限分離は無い。オークション入札まで同居しているぶん、他社よりリスクの幅が広い。
- 公式表記：「Our domain API is available to all accounts」＝利用条件は緩い。

---

## 8. Domainr API（deprecated）／Fastly Domain Research API

出典：<https://domainr.com/docs/api>、<https://domainr.com/docs/api/v2/status>、<https://www.fastly.com/documentation/reference/api/domain-management/domain-research/>、<https://docs.fastly.com/products/domain-research-api>／確認日 2026-09-03

**Domainr APIは公式ドキュメント上で「(deprecated)」と表記されている。** DomainrはFastly傘下となり、後継はFastly Domain Research API。

### `status` の値（Domainr v2、優先度の低い順）

| 値 | 意味 |
|---|---|
| `unknown` | 上流から権威ある状態を判定できなかった |
| `undelegated` | DNSに存在しない |
| `inactive` | **新規登録可能** |
| `pending` | TLDがまだルートゾーンに入っていない |
| `disallowed` | レジストリまたはICANNの禁止（不正なスクリプト等） |
| `claimed` | 第三者に確保済みで登録不可 |
| `reserved` | ICANN・レジストリ等が明示的に予約 |
| `dpml` | 商標保護リスト（Domains Protected Marks List）で保護 |
| `invalid` | 技術的に不正（長すぎる・短すぎる。最大64文字） |
| `active` | 登録済み。アフターマーケットで入手できる可能性あり |
| `parked` | 登録済みかつパーク中 |
| `marketed` | アフターマーケットで明示的に売り出し中 |
| `expiring` | 償還猶予期間（バックオーダー可能性あり） |
| `deleting` | Pending Delete フェーズ |
| `priced` | アフターマーケットで価格が付いている |
| `transferable` | ファストトランスファー可能 |
| `premium` | レジストリが売るプレミアムドメイン |
| `suffix` / `zone` / `tld` | 公開接尾辞 / Domainrデータベース上のゾーン / TLD |

`status` はスペース区切りの複数値で、**右端が最も重要**。`summary` フィールドはdeprecatedで「開発者向けのヒントであって最終的な可用性判定ではない」と明記されている。

### 料金・制約

- Domainr v2：**価格は返らない。** 1リクエスト1ドメイン。アクセス経路は RapidAPI（`domainr.p.rapidapi.com`）または直接契約（`api.domainr.com` + `client_id`）。**RapidAPI側の具体的な無料枠・クレカ要否は未確認**（RapidAPIのページがJSレンダリングで取得できなかった）。
- 規約：DoS攻撃、データスクレイピング、キーの無断利用、**ドメインのフロントランニング**、未文書化メソッドの呼び出しを禁止。
- Fastly Domain Research API：`GET /domain-management/v1/tools/status`（1件のみ）と `GET /domain-management/v1/tools/suggest`。`scope=estimate` で推定モード。**status応答の `offers` 配列にアフターマーケット価格（currency / price / vendor）が入る。**
- Fastlyの課金：「Billing for the Domain Research API is based on Domain Research API requests.」Suggest / Status-Precise / Status-Estimated の3種が課金対象。**無料枠の記載なし。** 既定では無効で、superuserがProductsページで有効化する。
- 「Our platform limits Domain Research API requests to a total runtime of 30 seconds.」タイムアウトすると `unknown` か `undelegated` が返るベストエフォート応答になる。

---

## 9. RDAP（推奨の中核）

出典：<https://data.iana.org/rdap/dns.json>、<https://www.verisign.com/news-insights/registration-data-access-protocol/help/>、<https://www.verisign.com/legal-center/rdap-terms/>、RFC 7480 §5.5／確認日 2026-09-03

### 仕組みと実測結果

- IANAブートストラップファイルが「TLD → RDAPベースURL」の対応を配る。`.com` は `https://rdap.verisign.com/com/v1/`。`.net` は `https://rdap.verisign.com/net/v1/`。
- ブートストラップは `cache-control: max-age=86400`。**1日1回取ってキャッシュすればいい。** 毎回取る必要はない。
- 照会は `GET {base}/domain/{name}`。認証不要。
- **登録済み → 200 + `application/rdap+json`。未登録 → 404、本文0バイト。**
- `Access-Control-Allow-Origin: *` がブートストラップにもVerisign RDAPにも付いている。**ブラウザから直接呼べる。**
- `rdap.org` は302リダイレクトのプロキシとして機能する（実測）。TLDごとのURL解決を任せられるが、経路が1つ増えるので自前でブートストラップを読むほうが速い。

### 404の限界（ここを設計で吸収する必要がある）

RDAPの404は「レジストリのデータベースに該当レコードが無い」という意味しかない。次の3つは**すべて同じ404に見える**：

1. 純粋に未登録で、いま買える
2. レジストリまたはICANNが予約していて、誰も登録できない
3. レジストリのブロックリスト・商標保護（DPML等）で登録が拒否される

さらにRDAPは**価格を返さない。premium判定もできない。** `.com` については premium 階層自体が無いので実害は小さい（→ §11）が、`.ai` `.io` `.dev` のような新gTLDに広げるなら別途価格APIが必須になる。

補足：単純な「短い名前＝予約」という仮説は成り立たない。実測で `b.com` `q.com` `nic.com` はいずれも200（登録済み）だった。予約語の判別はRDAP単体では不可能なので、**「404 ＝ 空きの候補」であって「空き確定」ではない**とUIに書くのが誠実。

### レート制限と規約

- **Verisignは閾値を公開していない。** 実測では10連続リクエストで429は出なかった。RFC 7480 §5.5 に従い、制限時は429と（あれば）`Retry-After` が返る。
- **Verisign RDAP利用規約（重要）**：
  - 「use the data in Verisign's RDAP database only for lawful purposes」
  - 禁止：「enable **high volume, automated, electronic processes** that send queries or data to the systems of Verisign or an ICANN-accredited registrar, **except as reasonably necessary to register domain names or modify existing registrations**」
  - 「Verisign reserves the right to restrict your access to the RDAP database in its sole discretion」
- つまり**総当たりスキャンは規約違反になりうる。** 実装上は次を守る：
  - 候補生成をLLM/トレンド側で絞り込んでから照会する（1トレンドあたり数十件まで）
  - ローカルにネガティブキャッシュ（404の結果）を持ち、同じ名前を繰り返し引かない
  - 同時実行1〜2、リクエスト間隔を空ける
  - 429/`Retry-After` を必ず尊重する指数バックオフ

---

## 10. WHOIS（TCP 43）とDNSを補助に使う場合の限界

- **WHOIS(43)**：出力が非構造テキストでレジストラごとに書式が違う。gTLDでは2025年1月以降ICANNがWHOISサービス要件を終了しRDAPへ一本化しているため、新規実装で選ぶ理由がない。レート制限も同じくVerisign規約の対象。**採用しない。**
- **DNS（NS/SOA）**：`NXDOMAIN` は「ゾーンが委任されていない」ことしか示さない。登録済みだがネームサーバー未設定のドメインは NXDOMAIN を返すため、**登録済みを「空き」と誤判定する。** 逆に、DNSキャッシュのTTLぶんだけ古い情報を掴む。
- 使いどころは**一次スクリーニングのみ**。「DNSで引けたら確実に登録済み → RDAPを叩かずに除外できる」という**RDAPリクエスト削減**の用途に限れば有効で、規約リスクの低減にもつながる。逆方向（NXDOMAIN → 空き）には使ってはいけない。

---

## 11. 追加候補

| サービス | 空き判定 | 価格 | 認証 | 権限分離 | 無料枠 | 評価 |
|---|---|---|---|---|---|---|
| **Spaceship** | `POST /api/v1/domains/available`（1〜20件）／`GET /api/v1/domains/{domain}/available` | `premiumPricing[]{operation, price, currency}` | `X-API-Key` + `X-API-Secret` | **あり**（`domains:read` と `domains:billing` が別） | 未確認 | **有力**。購入権限を持たないキーが作れる |
| Gandi | `GET /v5/domain/check?name=`（**401実測＝認証必須**） | あり（`currency` / `grid` / `max_duration`） | Personal Access Token（スコープ付き） | あり（PATはスコープ指定） | 未確認 | 悪くないが情報が英語ドキュメント内に散在。要追加調査 |
| OVH | ルートAPI（`/1.0/?format=json`）は公開だが、空き＋価格は `/order/cart` 系を経由 | カート経由 | 要認証 | — | — | **カート作成（POST）が必要＝今回の調査制約でも運用方針でも不適** |
| Squarespace | Reseller API（ドメイン）は **"Coming soon"** | — | — | — | — | 2026-09-03時点で使えない |
| WhoisXML Domain Availability | `GET /api/v1?apiKey=&domainName=&mode=DNS_ONLY\|DNS_AND_WHOIS` | **返らない** | APIキー | 購入機能そのものが無い＝安全 | **100クレジット無料・クレカ不要**（公式明記） | 価格が取れないのでRDAPの上位互換にならない |
| Whoapi | `GET https://api.whoapi.com/?domain=&r=taken&apikey=` | **返らない** | APIキー（IP制限可） | 購入機能なし＝安全 | 無料テストアカウントあり（件数未確認） | $23/月40,000リクエスト〜$399/月500万。価格が取れず割高 |

Spaceshipのレート制限（公式）：可用性チェックは「30 requests per user, within 30 seconds」、単一ドメインは追加で「5 requests per domain, within 300 seconds」。

---

## 12. .com の価格構造（事実確認）

### レジストリのプレミアム階層は存在しない

ICANN掲載の一次資料「.COM FEE SCHEDULE EFFECTIVE SEPTEMBER 1, 2024」（<https://itp.cdn.icann.org/en/files/registry-agreements/com/com-fees-01-09-2024-en.pdf>、2026-09-03取得）に記載の手数料：

| 項目 | 手数料 |
|---|---:|
| .com Domain-Name Initial Registration（年増分あたり） | **$10.26** |
| .com Domain-Name Renewal（年増分あたり） | **$10.26** |
| .com Domain-Name Transfer（1ドメインあたり） | **$10.26** |
| .com EPP Update to Restore a Domain-Name | $40.00 |
| .com Sync | $2.00 ＋ $1.00/月 |

**登録・更新・移管とも一律で、名前による段階価格が無い。** これが新gTLDとの決定的な違いで、新gTLDのレジストリは同じTLD内でも「premium tier」を設けて特定の文字列に数十倍〜数千倍の価格を付ける（GoDaddy v3の `inventory: REGISTRY_PREMIUM`、Cloudflareの `tier: premium`、Namecheapの `IsPremiumName` が表現しているのはこの階層）。

したがって**このプロダクトが .com だけを扱う限り、「個別ドメインの価格API」はほぼ不要**になる。TLD単位の標準価格（Porkbunの `pricing/get`）で足りる。世に言う「プレミアム .com」は、レジストリ価格ではなく**すでに誰かが登録していて流通市場で売られている**ドメインのことで、空き判定では `active` / `marketed` 側に分類される。

### 卸値の推移と次回改定

- 2024-09-01 発効：$10.26（上記の一次資料で確認）
- 2020年のAmendment 3により、**2026年10月まで卸値上限は $10.26 に据え置き**（ICANN公表）
- **2026-11-01 発効予定：$10.26 → $10.97（約7%増）**
  - 出典：Verisign 2026年第1四半期決算リリース（<https://investor.verisign.com/news-releases/news-release-details/verisign-reports-first-quarter-2026-results>）
  - **一次資料PDFは取得がブロックされ（HTTP 403）、検索経由の記述で確認した準一次情報。2026-11-01が近づいたらICANN掲載の新しい `.com fee schedule` PDFで再確認すること。**
  - 契約上、6年契約の最後の4年は毎年最大7%の値上げが可能。すべて行使されれば2029年には約$13.45になる（報道ベース・未確認）。

### ICANN手数料

- ICANN公式アナウンス「ICANN-Accredited Registrars Approve Registrar-Level Fees for Fiscal Year 2026」（2025-07-21、<https://www.icann.org/en/announcements/details/icann-accredited-registrars-approve-registrar-level-fees-for-fiscal-year-2026-21-07-2025-en>）：
  - **Transaction-Based Fees: $0.20 per transaction**（add / renew / transfer の年増分ごと）、**2025年7月1日発効**
  - 以前は $0.18。**「$0.18」で覚えている情報は古い。**
- 別に per-registrar の変動料（四半期ごとに $950,000 を全レジストラで按分）と固定認定料がある。これはレジストラ側のコストで、ドメイン単価には直接乗らない。

### 実勢の小売価格（2026-09-03確認）

| レジストラ | .com 登録（初年度） | .com 更新 | 出典 |
|---|---:|---:|---|
| **Porkbun** | **$11.08** | **$11.08** | `GET /api/json/v3/pricing/get` 実測、および <https://porkbun.com/tld/com>（「everyday low price」表記） |
| **Namecheap** | **$10.98**（新規顧客プロモ $6.79） | 未確認 | <https://www.namecheap.com/domains/registration/gtld/com/> |
| **Cloudflare** | 公表なし（at cost） | 公表なし | <https://www.cloudflare.com/products/registrar/> |
| GoDaddy | 未確認（公式ページが403） | 未確認 | — |

Cloudflareの at cost を計算すると **$10.26 + $0.20 = $10.46** になるが、これはCloudflareが公表した数字ではない（推定値）。

---

## 13. 比較表

### 13-1. 空き判定・価格

| サービス | 空き判定 | リアルタイム性 | 新規価格 | 更新価格 | Premium判定 | Premium価格 |
|---|---|---|---|---|---|---|
| **RDAP（Verisign）** | ○ 200/404 | レジストリ直（権威） | × | × | × | × |
| **Porkbun `pricing/get`** | × | TLD標準価格 | ○（TLD単位） | ○（TLD単位） | × | × |
| Porkbun `checkDomain` | ○ | レジストリ直 | ○ `price` | ○ `additional.renewal` | ○ `premium` | ○ |
| Namecheap `domains.check` | ○ | レジストリ直 | △（プレミアムのみ） | △（プレミアムのみ） | ○ `IsPremiumName` | ○ |
| Namecheap `users.getPricing` | × | TLD標準価格 | ○ | ○ | × | × |
| Cloudflare `domain-check` | ○ | レジストリ直 | ○ `registration_cost` | ○ `renewal_cost` | ○ `tier` | ○（登録は不可） |
| Cloudflare `domain-search` | △ キャッシュ | 非権威 | ○ | ○ | ○ | ○ |
| GoDaddy v3 `check-availability` | ○ | SPEED=キャッシュ / ACCURACY=直 | ○ 複数期間 | ○ | ○ `inventory` | ○ |
| Name.com `checkAvailability` | ○ | レジストリ直 | ○ `purchasePrice` | △ 別API | ○ `premium` | ○ |
| Dynadot `search` | ○ | レジストリ直 | ○（自然文文字列） | × | ○（同上） | ○ |
| Domainr v2 `status` | ○ 詳細な状態値 | 上流依存 | × | × | ○ `premium` | × |
| Fastly Domain Research | ○ precise / estimate | precise=レジストリ直 | × | × | ○ | △ アフターマーケットのみ |
| Spaceship `available` | ○ | 未確認 | △ premiumのみ | △ premiumのみ | ○ `premiumPricing` | ○ |
| WhoisXML / Whoapi | ○ | DNS or DNS+WHOIS | × | × | × | × |

### 13-2. 運用条件

| サービス | 料金・無料枠 | Rate Limit | 1回の最大件数 | APIキー要否 | クレカ要否 | Read-only運用 | 商用利用・規約 | Sandbox |
|---|---|---|---|---|---|---|---|---|
| **RDAP** | 無料 | **非公開**（実測10連続で429なし） | 1 | **不要** | 不要 | **完全に安全**（購入機能なし） | 大量自動問い合わせ禁止（Verisign ToS） | — |
| **Porkbun `pricing/get`** | 無料 | 記載なし | 全TLD一括 | **不要** | 不要 | **完全に安全** | 明示の禁止条項なし（未確認） | モックGETあり |
| Porkbun `checkDomain` | 無料 | **1件/10秒/アカウント**（既定） | 1 | 要 | 不要（残高制） | **不可**（購入権限が同梱） | リセラーではない旨を明記 | ○ `pk1_sb_` |
| Namecheap | 無料 | 50/分・700/時・8000/日 | **50** | 要 | 不要（有効化条件あり） | **不可**（スコープなし） | リセラー用途を想定 | ○ sandbox環境 |
| Cloudflare Registrar | 無料（at cost） | 1,200/5分/ユーザー | **20** | 要（**write権限**） | **要**（支払い方法必須） | **未確認**（ガイドはwrite要求） | ベータ。登録は返金不可 | × |
| GoDaddy v3 | 無料（条件付き） | **60/分/クレデンシャル** | **25** | 要（PAT） | 不要（保有条件あり） | **可**（`domains.domain:read`） | 50ドメイン or 月$20超 or DDC | ○ OTE |
| Name.com Core v1 | 無料 | 20/秒・3,000/時 | **50** | 要 | 不要 | **不可**（Basic認証・スコープなし） | リセラー向け記述あり | ○ `api.dev.name.com` |
| Dynadot | 無料 | 60/分（Regular）〜6000/分 | 1（Regular）/ 100（Bulk） | 要 | 不要 | **不可**（全コマンド同一キー） | 全アカウント利用可 | ○ `api-sandbox` |
| Domainr v2 | RapidAPI経由（**未確認**） | 未公開 | 1 | 要 | RapidAPI依存（未確認） | 安全（購入機能なし） | **deprecated**。フロントランニング禁止 | × |
| Fastly Domain Research | **従量課金・無料枠の記載なし** | 30秒ランタイム上限 | 1 | 要（Fastlyトークン） | 要（Fastly課金） | 安全 | superuserが有効化 | × |
| Spaceship | 未確認 | 30req/30秒（ユーザー）／5req/300秒（ドメイン） | **20** | 要（Key+Secret） | 未確認 | **可**（`domains:read`） | 未確認 | 未確認 |
| WhoisXML | **100クレジット無料・クレカ不要** / 以降未確認 | 未確認 | 1 | 要 | **不要**（無料枠） | 安全 | 未確認 | × |
| Whoapi | 無料テスト有 / $23/月〜（40,000req） | 未確認 | 1 | 要（IP制限可） | 有料プランは要 | 安全 | 未確認 | × |

---

## 14. 価格取得だけを安全に行える組み合わせ（推奨構成）

```
[1] トレンド語 → 候補ドメイン生成（ローカル）
        ↓
[2] DNS 事前フィルタ（任意）: NS/SOA が引ければ「登録済み」確定 → RDAPを叩かない
        ↓
[3] 空き判定: RDAP  GET https://rdap.verisign.com/com/v1/domain/{name}
        200 → 登録済み  /  404 → 空きの「候補」
        ↓
[4] 価格表示: Porkbun  GET https://api.porkbun.com/api/json/v3/pricing/get
        起動時に1回取得 → 24時間キャッシュ → TLD単位で表示
        ↓
[5] UI: 「登録可否と最終価格は各レジストラの購入画面で確認してください」と明記
```

この構成の性質：

- **APIキーが1本も要らない。** 認証情報が存在しないので、漏洩も誤爆もない。
- **購入エンドポイントに到達する経路が物理的に無い。**
- クレジットカード登録が不要。アカウント作成も不要。
- 両方とも `Access-Control-Allow-Origin: *` なので、Next.jsのクライアント側からでもサーバー側（Route Handler）からでも呼べる。**個人利用のローカル動作なら、レート制御を集中管理できるサーバー側に寄せるほうがよい。**
- 規約リスクを下げるため、RDAPへの問い合わせは必ず「絞り込んだ候補だけ」「ネガティブキャッシュ付き」「同時実行1〜2」「429で指数バックオフ」で実装する。

premium判定や個別価格が本当に必要になったときだけ、次の順で足す：

1. **GoDaddy v3**（`domains.domain:read` のPAT、25件バルク、`inventory` で3種のプレミアムを識別）— ただしアカウント条件を満たせる場合のみ
2. **Spaceship**（`domains:read` のキー、20件バルク）
3. Cloudflare Registrar（write権限＋支払い方法が必要なぶんリスクが最大）

### APIキーに購入権限が付随するサービスのリスク

| サービス | リスクの実体 | 緩和策 |
|---|---|---|
| **Porkbun** | 同じキーで `POST /domain/create` が通る。IP/対象ドメインのアローリストしか絞れない | 口座残高をゼロにしておく（`INSUFFICIENT_FUNDS` で止まる）／サンドボックスキーを使う／`dryRun` を活用 |
| **Namecheap** | 同じキーで `domains.create` が通る。スコープ概念が無い | 残高を持たない／IPホワイトリストを最小に／sandbox環境で開発 |
| **Name.com** | 同じトークンで `POST /core/v1/domains` が通る | `api.dev.name.com` の `-test` アカウントで開発 |
| **Dynadot** | `register` / `bulk_register` / `buy_it_now` / `place_auction_bid` まで同一キー。**オークション入札まで含む点が最悪** | サンドボックスキーのみ使う／本番キーを発行しない |
| **Cloudflare** | write権限トークン＋有効な支払い方法が前提。登録は**返金不可** | 本番アカウントで検証しない／読み取り権限で通るか先に検証する |

**個人の調査ツールで、購入権限のあるキーを平文の `.env` に置く合理性はない。** 上の推奨構成なら、そもそもその判断自体が発生しない。

---

## 15. MVPでの採用推奨

### P0（MVPに必ず入れる）

| # | 採用するもの | 理由 |
|---|---|---|
| 1 | **RDAP（IANAブートストラップ + Verisign .com）** | 認証不要・無料・レジストリ直で権威がある・CORS開放。`.com` に限れば空き判定の代替が存在しない |
| 2 | **Porkbun `GET /api/json/v3/pricing/get`** | 認証不要・CORS開放・907 TLDを1回で取得。`.com` はプレミアム階層が無いので、TLD単位価格で価格表示の要件を満たせる |
| 3 | **ローカルのネガティブキャッシュ＋レート制御＋バックオフ** | Verisign RDAP規約の「大量自動問い合わせ禁止」に対する実装上の答え。**機能ではなくコンプライアンス要件として扱う** |
| 4 | **UIでの但し書き** | 「404は空きの候補であって確定ではない（予約語・ブロック名を区別できない）」「最終価格は購入画面で確認」を明記する |

### P1（MVPの次に足す）

| # | 採用するもの | 理由 |
|---|---|---|
| 5 | **DNS（NS/SOA）による事前フィルタ** | 「引けたら登録済み確定」の方向にだけ使い、RDAPリクエスト数を削る。逆方向には使わない |
| 6 | **GoDaddy v3 `check-availability`（`domains.domain:read` スコープのPAT）** | 購入権限を分離できる数少ない選択肢。25件バルク・`definitive` フラグ・`inventory` でプレミアム3種を識別。ただしアカウント条件（50ドメイン or 月$20超 or DDC）を満たせる場合のみ |
| 7 | **Spaceship（`domains:read`）** | 同じく権限分離が可能。20件バルク。GoDaddyの条件を満たせないときの代替 |
| 8 | **Porkbunサンドボックス（`pk1_sb_`）での `checkDomain` 検証** | 本番の課金・登録が起きない環境で、premium/promo込みの応答形状を確認できる |

### P2（将来・条件付き）

| # | 採用するもの | 条件 |
|---|---|---|
| 9 | Cloudflare Registrar `domain-check` | read-onlyトークンで通ることが確認できた場合のみ。write権限＋支払い方法が必須のままなら見送る |
| 10 | Namecheap `domains.check` + `users.getPricing` | 有効化条件（20ドメイン／$50）を満たし、固定IPが確保できる場合 |
| 11 | Name.com Core v1 `checkAvailability` | 50件バルクが必要になり、かつ購入権限同梱を受け入れられる場合 |
| 12 | Fastly Domain Research API | アフターマーケット価格（`offers`）が要件になった場合。従量課金の見積もりが先 |
| 13 | 新gTLD（.ai / .io / .dev）への拡大 | このとき初めて「個別ドメインのpremium判定」が必須になる。P1の6か7が前提条件になる |

---

## 16. 採用しない理由

| 見送るもの | 理由 |
|---|---|
| **Dynadot** | キー1本で `register` から `place_auction_bid` まで通る。権限分離が無く、事故時の被害範囲が他社より広い。加えて `Price` が `"44.00 in USD and domain is not premium"` という自然文でパースが脆い。通常アカウントは1コマンド1件・60/分と性能面の利点も無い |
| **Domainr API v2** | 公式ドキュメントが `(deprecated)` 表記。価格が取れない。RapidAPI経由の無料枠とクレカ要否が確認できなかった。後継のFastly版に移る前提の技術に依存すべきでない |
| **Fastly Domain Research API（MVP段階）** | 従量課金で無料枠の記載が無い。1リクエスト1ドメイン。Fastlyアカウントとsuperuser権限が要る。個人の調査ツールに対して重い |
| **OVH API** | 空き判定と価格が `/order/cart` 系（カート作成）を経由する設計。今回の調査制約（カート・決済系は呼ばない）に反するうえ、運用上も「調査するだけでカートを作る」のは筋が悪い |
| **Squarespace Domains** | Reseller APIが "Coming soon"。2026-09-03時点で使えない |
| **WhoisXML Domain Availability API** | 無料100クレジット・クレカ不要は魅力だが、**価格が返らない**のでRDAPの上位互換にならない。RDAPで足りる用途に有料枠を使う理由が無い |
| **Whoapi** | 同じく価格が返らない。最安$23/月40,000リクエスト。無料のRDAPに対して払う対価に見合わない |
| **WHOIS（TCP 43）** | 非構造テキストでレジストラごとに書式が異なる。gTLDはRDAPへ移行済み。新規実装で選ぶ理由が無い |
| **DNSだけでの空き判定** | NXDOMAIN は「委任されていない」であって「未登録」ではない。登録済みでNS未設定のドメインを空きと誤判定する。**一次フィルタ以外には使わない** |
| **Cloudflare Registrar（MVP段階）** | 検索・価格取得の機能自体は優秀だが、**write権限トークンと有効な支払い方法が前提**。登録は返金不可。調査専用ツールが背負うリスクとして最大 |
| **Namecheap / Name.com / Porkbun `checkDomain`（MVP段階）** | いずれもキーに購入権限が同梱される。`.com` に限ればRDAP＋TLD価格で要件を満たせるので、MVPでこのリスクを取る必要が無い |

---

## 17. 未確認事項（次に確認すべきこと）

1. **2026-11-01の .com 卸値 $10.97** — Verisign決算リリースのPDF取得がHTTP 403で失敗。ICANN掲載の新しい `.com fee schedule` PDFが出たら差し替える。
2. **Cloudflare Registrar のread-onlyトークン** — `domain-search` / `domain-check` がread権限だけで通るか。ガイドは write を要求、APIリファレンスは「呼ぶ操作に応じた権限」と書いており矛盾している。
3. **Porkbun `checkDomain` のレート制限引き上げ方法** — 「configurable per API key」とあるが、どこで設定するのか記載が見つからない。
4. **PorkbunのAPI利用規約本体** — `porkbun.com/policies/tos` は404。利用規約のURLを特定できていない。自動問い合わせの可否を確認する必要がある。
5. **Domainr（RapidAPI経由）の無料枠・クレカ要否** — RapidAPIのページがJSレンダリングで取得できず。
6. **WhoisXML Domain Availability APIの有料プラン価格** — 同上。
7. **Namecheap .com の更新価格** — 公式ページに登録・移管価格しか出ていない。
8. **GoDaddy .com の小売価格** — 公式ページが403。
9. **Spaceshipの無料枠・サンドボックス・API利用条件** — ドキュメントに記載が見当たらない。
10. **Verisign RDAPの実際のレート制限閾値** — 非公開。10連続では429が出なかったが、上限は不明。**「試して探る」行為自体が規約違反になりうるので、意図的に探らない。**

---

## 出典一覧（すべて確認日 2026-09-03）

- Porkbun API v3 全リファレンス <https://porkbun.com/llms-full.txt> ／ OpenAPI <https://porkbun.com/api/json/v3/spec>
- Porkbun 公開価格（実測） <https://api.porkbun.com/api/json/v3/pricing/get> ／ .com <https://porkbun.com/tld/com>
- Namecheap `domains.check` <https://www.namecheap.com/support/api/methods/domains/check/>
- Namecheap `users.getPricing` <https://www.namecheap.com/support/api/methods/users/get-pricing/>
- Namecheap API Intro <https://www.namecheap.com/support/api/intro/>
- Namecheap API FAQ <https://www.namecheap.com/support/knowledgebase/article.aspx/9739/63/api-faq/>
- Namecheap .com <https://www.namecheap.com/domains/registration/gtld/com/>
- Cloudflare Registrar API <https://developers.cloudflare.com/registrar/registrar-api/>
- Cloudflare Registrar APIリファレンス <https://developers.cloudflare.com/api/resources/registrar/>
- Cloudflare Registrar 概要 <https://developers.cloudflare.com/registrar/>
- Cloudflare API レート制限 <https://developers.cloudflare.com/fundamentals/api/reference/limits/>
- Cloudflare Registrar 製品ページ <https://www.cloudflare.com/products/registrar/>
- GoDaddy Domains v3 概要 <https://developer.godaddy.com/doc/endpoint/domains>
- GoDaddy Domains v3 OpenAPI <https://developer.godaddy.com/openapi/domains-v3.json>
- GoDaddy Getting Started <https://developer.godaddy.com/getstarted>
- GoDaddy APIアクセス条件 <https://www.godaddy.com/help/how-do-i-access-domain-related-apis-42424>
- Name.com Core API 全リファレンス <https://docs.name.com/llms-full.txt>
- Dynadot Domain API <https://www.dynadot.com/domain/api3.html>
- Domainr API（deprecated） <https://domainr.com/docs/api> ／ status <https://domainr.com/docs/api/v2/status>
- Fastly Domain Research API <https://www.fastly.com/documentation/reference/api/domain-management/domain-research/> ／ <https://docs.fastly.com/products/domain-research-api>
- IANA RDAPブートストラップ <https://data.iana.org/rdap/dns.json>
- Verisign RDAP ヘルプ <https://www.verisign.com/news-insights/registration-data-access-protocol/help/>
- Verisign RDAP 利用規約 <https://www.verisign.com/legal-center/rdap-terms/>
- .COM 手数料表（2024-09-01発効） <https://itp.cdn.icann.org/en/files/registry-agreements/com/com-fees-01-09-2024-en.pdf>
- ICANN FY2026 レジストラ手数料 <https://www.icann.org/en/announcements/details/icann-accredited-registrars-approve-registrar-level-fees-for-fiscal-year-2026-21-07-2025-en>
- Verisign 2026年Q1決算（準一次・PDF取得は403） <https://investor.verisign.com/news-releases/news-release-details/verisign-reports-first-quarter-2026-results>
- Spaceship API ドキュメント <https://docs.spaceship.dev/>
- Gandi Domains API <https://api.gandi.net/docs/domains/>
- WhoisXML Domain Availability API <https://domain-availability.whoisxmlapi.com/api/documentation/making-requests>
- WhoAPI ドキュメント <https://whoapi.com/api-documentation/> ／ 料金 <https://whoapi.com/domain-availability-api/>
- Squarespace Developer Platform <https://developers.squarespace.com/>
