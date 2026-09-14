# 要件定義 — Emerging Domain Radar

作成: 2026-09-03（Fable・メインループ）。正本はこのファイル。実装（Codex/Opus）はこの文書と `03_architecture.md` だけを前提に動く。

## 1. 何を作るか（1文）

海外の技術コミュニティで「言及が増え始めた（まだ主流ではない）」技術用語を毎日見つけ、その用語に関連する `.com` の空き・登録価格・更新価格・Premium 判定を一覧し、**調査優先度**でランキングする、**購入機能を持たないローカル専用の調査ツール**。

## 2. 目的と成功条件

- 目的: 「流行の一歩手前の言葉を見つける → .com が空いているか・いくらかを知る → 自分で判断する」までを 1 候補あたり 1 分以内で終えられる。
- 成功条件（完成条件・§33 相当）: キーワード一覧 → 根拠（Evidence）→ 関連 .com → 空き → 現在価格 → 更新価格 → Premium 判定 → 公式サイトへのリンク、が全部画面で確認できる。
- 非目的: 流行の的中率保証、ドメイン購入、商標の安全性の断定、有料 API 前提の運用。

## 3. 最重要ルール（購入禁止）

- ドメインの購入・登録・チェックアウト・カート追加・入札・オークション・自動更新設定・購入予約に関するコードを **一切実装しない**。
- ドメインプロバイダ用モジュールが公開する関数は `checkAvailability()` / `getPricing()` / `searchDomains()` の 3 種のみ。`registerDomain` / `purchaseDomain` / `checkoutDomain` / `bidDomain` 等は **定義も呼び出しもしない**。
- 外部サービスへの書き込み（POST 等で状態を変える操作）はしない。唯一の書き込み先はローカル SQLite。
- 上記をテストで機械的に保証する（`tests/unit/no-purchase-guard.test.ts` が `src/` と `app/` を走査し、禁止識別子・禁止エンドポイントを検出したら失敗）。
- UI は「公式サイトで確認」リンクまで。以降はユーザーが手動で判断する。

## 4. 機能要件

### P0（MVP・今回必ず実装）

| # | 機能 | 受け入れ条件 |
|---|---|---|
| F1 | 手動ドメイン検索 | 1 件または複数（改行・カンマ区切り）を入力し、各ドメインの Availability / Registration / Renewal / Currency / Premium・Standard / Checked At / 価格の取得元 を表示。価格が取れない場合は `Price unavailable` と表示し、推測値を出さない |
| F2 | 空き判定 | `.com` を RDAP（Verisign）で判定。200=登録済み、404=未登録（＝空きの可能性が高い）。それ以外は `UNKNOWN` |
| F3 | 価格取得 | 標準価格は認証不要の価格表 API から取得。任意でレジストラ API キーがあれば個別価格・Premium 判定を上書き |
| F4 | Premium 判定 | レジストラ API があれば API の値。無ければ「.com はレジストリに Premium 価格層が無い」事実に基づき `Standard (inferred)` と根拠付きで表示。予約語の可能性は注記 |
| F5 | 新興キーワード一覧（Dashboard） | 最新の収集ランで得たキーワードを Opportunity Score 降順にカード表示。カードには順位・キーワード・Status・Trend/Japan Gap/Opportunity・Why trending（上位 3 根拠）・ドメイン上位 3 件（空き・価格）・Last checked |
| F6 | キーワード詳細 | 説明・なぜ候補か・いつから増えたか・ソース別 Evidence（7 日/前 7 日/30 日/前 30 日の件数と増減率、元ソースの検索 URL）・関連キーワード・ドメイン候補全件・スコア内訳 |
| F7 | ドメイン候補生成 | 1 キーワードにつき最大 10 件。`.com` のみ・ハイフン無し・数字無し・短い順。生成規則は決定的（同じ入力→同じ出力） |
| F8 | Trend Score | 0〜100。ルールベース。増加率（7 日・30 日）× ソース横断性 × 「まだ少ない」補正。式は `03_architecture.md` に固定し About ページにも表示 |
| F9 | Status 判定 | Early / Emerging / Rising / Trending / Mainstream。閾値は文書化 |
| F10 | Opportunity Score | 0〜100。表示名は **「調査優先度」**。「買うべき」という表現は UI・文書のどこにも使わない |
| F11 | Evidence 表示 | 各ソースの窓別件数と増減率、元ソースへのリンク（検索 URL）。AI の説明文は「推測」と明記し、数値根拠と区別 |
| F12 | フィルター | Available only / .com only / 価格上限（$15・$20・$50） / Trend Score 下限 / Opportunity 下限 / Status（Emerging のみ等） / Premium 除外 / 文字数上限 / 情報源。状態は URL クエリに保持 |
| F13 | 日本円換算 | USD→JPY を無料 API（ECB 由来）で取得し、レート・取得元・取得時刻を明記。取得失敗時は USD のみ表示 |
| F14 | 商標注意 | 全ドメイン候補に `Trademark check required` を表示。USPTO / J-PlatPat / WIPO / EUIPO の検索リンクを生成。既知ブランド・企業名リスト（ローカル辞書）に一致する候補は除外し、理由を表示。「商標的に安全」とは表示しない |
| F15 | 収集パイプライン（手動実行） | `npm run radar:collect` で 収集→抽出→計測→スコア→ドメイン生成→空き確認→価格→DB 保存 を 1 コマンドで実行。API キー無しでも完走する（キーがあるソースだけ追加で使う） |
| F16 | LLM 抽出（任意） | `LLM_PROVIDER=none|anthropic|codex-cli`。`none` はルールベース n-gram のみ。`anthropic` は Claude API（キー必須）、`codex-cli` はローカルの Codex CLI（ChatGPT ログイン・追加課金なし）。LLM の出力は候補提案に限り、スコアは常に数値根拠から計算 |

### P1（今回、実装コストが低いものは含める）

| # | 機能 | 方針 |
|---|---|---|
| F17 | Watchlist | キーワード・ドメイン・発見時価格・現在価格・発見日・Trend/Opportunity を保存。価格履歴テーブルを持つ。今回実装する |
| F18 | Japan Gap Score | Qiita / Google News（日本語）/ Wikipedia 日本語版 で日本語圏の言及を測り 0〜100。今回実装する（無料・キー不要） |
| F19 | 自動定期収集 | cron / launchd から `npm run radar:collect` を呼べる設計。今回は手順を README に書くだけ |
| F20 | 通知 | 条件（Trend≥80 かつ Opportunity≥80 かつ available かつ ≤$20 かつ 非 Premium）を満たす候補を CLI の終了時に一覧出力するまで。外部通知は未実装。**通知から購入には絶対につなげない** |

### P2（今回は実装しない・設計上の拡張点だけ残す）

Podcast / YouTube / X / Threads / SNS ユーザー名の空き / 高度な AI 予測。ソースは `TrendSource` インターフェースを実装して追加できる構造にする。

## 5. 非機能要件

- ローカル動作（`npm run dev` / `npm run build && npm start`）。外部公開・デプロイはしない。
- API キーはサーバー側のみ（Next.js の Route Handler / サーバーコンポーネント / CLI）。`NEXT_PUBLIC_` プレフィックスの秘密は禁止。ログ・API レスポンス・README に秘密を出さない。`.env.example` を用意。
- 無料枠・レート制限を守る（各ソースの制限値は `docs/research.md` の値をコード内定数として持ち、超えない同時実行数と待ち時間で呼ぶ）。
- 決定的テスト: スコア・生成規則・パーサはフィクスチャで単体テスト。E2E はシードデータ＋オフラインモード（`RADAR_OFFLINE=1` で外部 API をフィクスチャに差し替え）で実行。
- 有料 API を前提にしない。キーが無い場合の挙動を全機能で定義する（表示は `Price unavailable` / `source unavailable` 等）。

## 6. 用語

- **Emerging**: 絶対数はまだ小さいが、直近 7〜30 日で複数ソースの言及が増えている状態。今回一番探したい対象。
- **Opportunity Score（調査優先度）**: 調べる順番を決めるための合成指標。購入判断ではない。
- **Price unavailable**: 価格 API から値が取れなかった状態。推測しない。
