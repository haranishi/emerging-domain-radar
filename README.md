# Emerging Domain Radar

新興技術用語の兆候を毎日拾い、関連する `.com` の空き・登録価格・更新価格・Premium 判定を一覧して**調査優先度**でランキングする、**購入機能を持たないローカル専用の調査ツール**。

## 背景と目的
流行の一歩手前の言葉は、気づいた時点ならまだ `.com` が空いていることがある。ただし「言葉を見つける」「空きと価格を調べる」「判断する」がばらばらの場所にあって、毎朝やるには手間が大きい。このツールはその往復を 1 か所にまとめる。成功条件は、1 候補あたりの判断を 1 分以内で終えられること。キーワード → 根拠（Evidence）→ 関連 `.com` → 空き → 登録価格 → 更新価格 → Premium 判定 → 公式サイトへのリンク、が画面上でつながっていれば達成とする（`docs/01_requirements.md` §2）。的中率の保証、ドメインの購入、商標の可否判断は目的に入れない。判断は人がやる。

## 自動購入は行いません
このツールでドメインは買えない。購入・登録・チェックアウト・カート追加・入札・オークション・自動更新設定・購入予約のコードが、リポジトリに 1 行も無いため。UI とレポートは「公式サイトで確認」リンクまでで止まり、その先はレジストラのサイトで人が操作する。

- ドメインプロバイダのモジュールが公開する関数は `checkAvailability()` / `getPricing()` / `searchDomains()` の 3 つだけ。外部サービスへの書き込み（状態を変える POST 等）もせず、書き込み先はローカルの SQLite に限る。

この制約は `tests/unit/no-purchase-guard.test.ts` が機械的に守る。`src/` と `scripts/` を走査し、禁止識別子（`registerDomain` `purchaseDomain` `checkoutDomain` `bidDomain` `addToCart` など）と購入系 API パスを見つけたらテストが落ちる。落ちたときの直し方は、禁止リストを緩めることではなく、そのコードを消すこと。

## セットアップと起動
```bash
# Node 24・npm
npm install
cp .env.example .env                    # 任意。API キーは 1 つも要らない
npm run seed:demo                       # デモデータを入れて画面の見え方だけ確認する
npm run dev                             # http://localhost:3000
npm run radar:collect                   # 実データを収集（キー 0 個で完走する）
npm run check:domains -- example.com    # ドメインを手で調べる（最大 20 件・.com のみ）
```

保存先は `data/radar.db` だけ（`RADAR_DB_PATH` で変更可）。収集は画面のボタンではなく CLI から起こす。レート制限のある長時間処理を UI から始めないため（`docs/02_ux_design.md` §4）。

## API キーの取得
**すべて任意。** キーが 0 個でも収集は完走し、ダッシュボードに候補が出る。キーがあるソースだけ枠と精度が上がる。値は `.env` に置き、サーバー側（CLI・Route Handler・サーバーコンポーネント）だけで読む。`NEXT_PUBLIC_` は使わない。全変数と既定値は `.env.example` と `docs/03_architecture.md` §9。LLM は候補の追加提案だけに使い、スコアは常に数値根拠から計算する（既定は `LLM_PROVIDER=none` のルールベースのみ）。

| 変数 | 何が変わるか | 取得先 | 必要な権限 |
|---|---|---|---|
| `GITHUB_TOKEN` | GitHub Search が 10 req/分 → 30 req/分 | GitHub の fine-grained PAT | **ゼロでよい**（公式に "The fine-grained token does not require any permissions."） |
| `OPENALEX_API_KEY` | OpenAlex の日次予算が $0.10/日 → $1/日 | [help.openalex.org/guides/authentication](https://help.openalex.org/guides/authentication) | 権限の概念なし。無料・約 30 秒 |
| `QIITA_TOKEN` | Qiita が 60 req/h → 1,000 req/h | Qiita の設定画面（API 仕様は [qiita.com/api/v2/docs](https://qiita.com/api/v2/docs)） | 本ツールは GET しか投げない |
| `ANTHROPIC_API_KEY` | `LLM_PROVIDER=anthropic` でキーワード抽出に Claude を併用 | Anthropic API のコンソール | — |
| `CODEX_HOME` | `LLM_PROVIDER=codex-cli` でローカルの Codex CLI を使う（ChatGPT ログイン・追加課金なし） | 既存の Codex CLI 設定ディレクトリ | — |

## 使用 API とデータ取得元
採用した 10 ソースはすべて認証不要の GET で、購入エンドポイントへ到達する経路が無い。1 日あたり約 580 リクエスト、外部費用は OpenAlex の $0.005/日だけ。不採用にしたもの（Reddit・Google Trends・X・YouTube・Product Hunt・Google News RSS・レジストラの認証 API など）とその理由は `docs/research.md` §3・§7。

| 用途 | API | キー | 制限 |
|---|---|---|---|
| 空き判定 | DNS(NS) 事前フィルタ → RDAP（Verisign `.com`） | 不要 | 閾値は非公開。自主上限 300 件/日 |
| 価格 | Porkbun `GET /api/json/v3/pricing/get` | 不要 | 公式に記載なし。24 時間キャッシュ |
| トレンド（話題） | HN Algolia `search_by_date` | 不要 | 10,000 req/時/IP |
| トレンド（実装） | GitHub `GET /search/repositories` | 任意 | 未認証 10 req/分・認証 30 req/分 |
| トレンド（プレプリント） | arXiv `export.arxiv.org/api/query` | 不要 | 5 秒間隔＋指数バックオフ |
| トレンド（論文） | OpenAlex `/works`（`group_by` 併用） | 任意 | キー無し $0.10/日・UTC 0 時リセット |
| 日本語圏 | Qiita API v2・Wikipedia 日本語版・Wikimedia Pageviews | 任意 | Qiita 未認証 60 req/h |
| 為替 USD→JPY | Frankfurter v2（予備 open.er-api.com） | 不要 | 公式に記載なし |

## スコアの計算方法
- **Trend Score**（0〜100）: 成長率・加速度・ソース横断性・「まだ少ない」補正の加重和。件数が多いだけの語は上がらない。
- **Status**: Early / Emerging / Rising / Trending / Mainstream の 5 段階。30 日件数と 30 日成長率のしきい値で決める。勢いが落ちた語には `fading` タグが付く。
- **Novelty Score**: 初出が新しいほど高い。HN の 60 日より前の最古ヒットと、各ソースの観測最古日から決める。
- **Japan Gap Score**: 英語圏に比べて日本語圏の言及がどれだけ少ないか。日本語での呼び方は英語版 Wikipedia の langlinks から引く。
- **Domain Score**: 長さ・発音しやすさ・綴り・キーワード一致・構造・記憶しやすさ・価格の 7 成分。`.com` 以外は算出しない。
- **Opportunity Score（調査優先度）**: 上 4 つの合成から、Mainstream・商標フラグ・高価格の分を引く。調べる順番を決めるための指標であって、購入判断ではない。

式・定数・しきい値は `docs/03_architecture.md` §5.4 と、アプリ内の `/about` に同じ内容がある。

## 制限事項
- **RDAP の 404 は空きの候補であって、確定ではない。** 純粋な未登録・レジストリの予約・商標ブロックが、すべて同じ 404 に見える。
- **価格は参考値。** Porkbun の TLD 単位の標準価格を出している。取れないときは `Price unavailable` と表示し、推測値も既定値も入れない。
- **Premium 判定は推定。** `.com` にはレジストリの Premium 価格層が無いため `Standard (inferred)` を返す。予約語・ブロック名は区別できない。
- **日本語圏の計測は取り逃す。** 英語フレーズと Wikipedia 由来の日本語訳でしか測れず、Wikipedia に記事の無い新語ほど訳が取れない。訳が不明なときは `JP equivalent unknown` と注記する。
- **RDAP は総当たりしない。** Verisign の規約が大量の自動問い合わせを禁じている。DNS 事前フィルタ・`taken` の 7 日負のキャッシュ・日次予算（既定 300 件）の 3 段で必ず絞る。
- **有料 API を前提にしない。** キーが無いときの挙動を全機能で定義してある。

## 商標の確認が必要です
商標の判定はしていない。無料で機械から叩ける商標検索 API が存在せず、WIPO は自動問い合わせを明示的に禁じているため（`docs/research/04_japan_gap_fx_methodology_trademark.md` §4）。

- 全ドメイン候補に `Trademark check required` を常時表示する。既知ブランド名の辞書に当たった候補は除外して理由を出すが、辞書は文字列一致にすぎない。
- USPTO・WIPO・EUIPO・TMview・J-PlatPat へのリンクは**検索画面を開くだけ**で、語の再入力が必要な場合がある。
- 「商標的に安全」という表示は作らない。称呼・外観・観念の類似と、指定商品・役務の区分で決まるものを、文字列一致では判定できないため。

## 毎日の自動実行
```
0 9 * * * cd /path/to/emerging-domain-radar && /usr/bin/env npm run radar:collect >> .tmp/collect.log 2>&1
```

macOS の launchd なら、`~/Library/LaunchAgents/*.plist` の `StartCalendarInterval` から同じコマンドを呼ぶ。二重起動は `collect.lock`（DB と同じディレクトリ）が防ぐ。生存 PID のロックがあれば即終了し、残骸ロックは置き換える。UTC 深夜 0 時の直後は避ける。OpenAlex の日次予算がそこでリセットされる。

## テストと検証
```bash
npm run test         # Vitest
npm run e2e          # Playwright（RADAR_OFFLINE=1・.tmp/e2e.db・ポート 3210）
npm run build
npm run screenshots  # .tmp/shots/ に 10 枚。別ターミナルで dev か start を先に起動しておく
```

2026-09-04 時点で、単体テスト 23 ファイル 397 件と E2E 16 件が全緑、`npm run build` 成功。E2E とスクリーンショットはオフライン fixtures で動く。fixtures は 2026-09-03 の実測応答なので、窓の基準時刻もその日に固定してある。

## ドキュメント
- [docs/01_requirements.md](docs/01_requirements.md) — 要件定義（正本）
- [docs/02_ux_design.md](docs/02_ux_design.md) — ユーザーストーリーと UX 5 階層
- [docs/03_architecture.md](docs/03_architecture.md) — 実装契約。スコア式・DB スキーマ・環境変数
- [docs/research.md](docs/research.md) — 調査 4 本の統合。採用/不採用の一覧と、踏んだ罠
- 調査の原本 — [01 ドメイン API](docs/research/01_domain_apis.md)／[02 HN・GitHub・Reddit](docs/research/02_trend_sources_hn_github_reddit.md)／[03 論文・Trends・メディア](docs/research/03_trend_sources_papers_ph_trends_media.md)／[04 日本語圏・為替・方法論・商標](docs/research/04_japan_gap_fx_methodology_trademark.md)
