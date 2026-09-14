/**
 * E2E（Playwright）の設定。
 *
 * このスイートの前提は「決定的であること」の 1 点だけ。そのために
 *  - `RADAR_OFFLINE=1` で外部 HTTP と DNS を `fixtures/` に差し替える
 *  - DB は専用の `.tmp/e2e.db` を毎回捨てて `seed:demo` で作り直す（globalSetup）
 *  - `workers: 1`。1 つの SQLite と 1 つの dev サーバーを共有するので並列にしない
 * を守る。ブラウザから外部ホストへ出ていないことは `tests/e2e/test-base.ts` が
 * 実行時に検査する（fixtures を足し忘れて実 API を叩いた、を静かに通さないため）。
 *
 * `webServer.url` を `/about` にしている理由（重要）:
 *   Playwright は webServer を起動して url が応答するまで待ってから globalSetup を呼ぶ
 *   （runner の createGlobalSetupTasks はプラグイン setup の後に globalSetup を並べる）。
 *   ここで `/` を叩くと dev サーバーが `.tmp/e2e.db` を開き、直後に globalSetup が
 *   同じファイルを削除する。`src/lib/db/client.ts` はパスをキーにした接続を保持するので、
 *   サーバーは削除済み inode を読み続け、テストは seed 前の中身を見ることになる。
 *   `/about` は DB を読まない唯一のページなので、起動確認だけを安全に行える。
 *
 * `reuseExistingServer` が効くのはローカルだけ。3210 で **別の設定の** dev サーバーを
 * 手で起動していると、そちらが使われて（例えば `data/radar.db`・オンライン）テストが
 * 落ちる。E2E を回すときは 3210 を空けておく。
 */
import { defineConfig } from '@playwright/test';

/** 3210 固定。スクリーンショット確認用の 3217 とぶつけない。 */
const PORT = 3210;
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: './tests/e2e',
  globalSetup: './tests/e2e/global-setup.ts',
  // 1 つの dev サーバーと 1 つの SQLite を共有するため直列に流す。
  workers: 1,
  fullyParallel: false,
  retries: 0,
  forbidOnly: Boolean(process.env.CI),
  // dev サーバーは初回アクセスでルートをコンパイルするので、1 テスト目だけ数秒かかる。
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    navigationTimeout: 60_000,
    actionTimeout: 15_000,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    viewport: { width: 1440, height: 960 },
    // Chromium はキャッシュ済み（~/Library/Caches/ms-playwright）。channel は指定しない
    // （システムの Chrome に依存させると環境によって落ちる）。
    browserName: 'chromium',
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run dev',
    // 環境変数はコマンド文字列に埋めずここで渡す（シェルのクォートに依存させない）。
    env: {
      RADAR_OFFLINE: '1',
      RADAR_DB_PATH: '.tmp/e2e.db',
      PORT: String(PORT),
    },
    url: `${BASE_URL}/about`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
