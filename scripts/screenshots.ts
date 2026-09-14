/**
 * 画面のスクリーンショットを撮る（1440×900・フルページ・ライト/ダーク各 1 枚）。
 *
 *   RADAR_DB_PATH=.tmp/demo.db PORT=3210 npm run dev   # 別のターミナルで先に起動しておく
 *   npm run screenshots
 *   SHOT_BASE_URL=http://127.0.0.1:3217 SHOT_SLUG=synthetic-memory npm run screenshots
 *
 * 出力は `.tmp/shots/<page>-<light|dark>.png` の 10 枚。
 *
 * dev サーバーの起動をこのスクリプトに含めていないのは、どの DB を見た画面なのかを
 * 呼ぶ側が決められるようにするため（`RADAR_DB_PATH` を内側で固定すると、
 * 撮った絵がデモデータなのか実データなのか後から分からなくなる）。
 *
 * 同じディレクトリで `next dev` は 2 つ動かせない（`.next/dev/lock` で弾かれる）。
 * 誰かが既に dev を上げているときは、その URL を `SHOT_BASE_URL` で指すか、
 * `RADAR_DB_PATH=.tmp/demo.db PORT=3217 npm run start`（要 `npm run build`）で別ポートに出す。
 *
 * `SHOT_BASE_URL` / `SHOT_SLUG` を `src/lib/env.ts` に通さないのは、これがアプリの設定では
 * なく撮影スクリプト専用のつまみだから（アプリ側はこの 2 つを読まない）。
 */
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { chromium, type Browser, type Page } from '@playwright/test';

const BASE_URL = (process.env.SHOT_BASE_URL ?? 'http://127.0.0.1:3210').replace(/\/+$/, '');
const OUT_DIR = path.join(process.cwd(), '.tmp', 'shots');
const VIEWPORT: { width: number; height: number } = { width: 1440, height: 900 };
const SCHEMES = ['light', 'dark'] as const;
type Scheme = (typeof SCHEMES)[number];

/** ページ表示・要素待ちの上限。 */
const READY_TIMEOUT_MS = 30_000;
/** ドメイン判定の上限。実 API（DNS・RDAP・価格表）を叩くのでページ表示より長く待つ。 */
const RESULT_TIMEOUT_MS = 60_000;

/** `/search` に入れる 2 件（取得済みの `example.com` と、まず取られていない乱数ラベル）。 */
const SEARCH_INPUT = 'example.com\nq8v2zkx7trmwq3lp.com';

interface Target {
  /** ファイル名の前半。 */
  name: string;
  path: string;
  /**
   * 撮る前の操作。撮れる状態にできなかったときは理由を返す。
   * 返しても撮影は続ける（「結果が出ない画面」も記録として要る）。
   */
  prepare?: (page: Page) => Promise<string | null>;
}

function log(message: string): void {
  process.stdout.write(`${message}\n`);
}

/** 詳細ページの slug。`SHOT_SLUG` が無ければ `/api/keywords` の先頭を使う。 */
async function resolveSlug(browser: Browser): Promise<string> {
  const given = process.env.SHOT_SLUG?.trim();
  if (given) return given;

  const context = await browser.newContext({ baseURL: BASE_URL });
  try {
    const response = await context.request.get('/api/keywords');
    if (!response.ok()) throw new Error(`GET /api/keywords が HTTP ${response.status()} を返しました`);
    const body: unknown = await response.json();
    if (!Array.isArray(body) || body.length === 0) {
      throw new Error(
        '/api/keywords が空でした。RADAR_DB_PATH=.tmp/demo.db npm run seed:demo を先に実行してください',
      );
    }
    const slug: unknown = (body[0] as { slug?: unknown }).slug;
    if (typeof slug !== 'string' || slug === '') throw new Error('/api/keywords の先頭に slug がありません');
    return slug;
  } finally {
    await context.close();
  }
}

/**
 * `/search` で実際に判定を走らせる。空のフォームだけを撮っても結果表の見え方が分からない。
 *
 * セレクタは id や文言ではなくフォームの構造で指す（ラベルと id は表層の調整で変わりうる）。
 * 待ち方を `Promise.race` にしないのは、負けた側の待ちが reject して
 * unhandled rejection でスクリプトごと落ちるため。
 */
async function runDomainCheck(page: Page): Promise<string | null> {
  await page.locator('form textarea').first().fill(SEARCH_INPUT);
  await page.locator('form button[type="submit"]').first().click();

  const table = page.locator('table').first();
  const alert = page.locator('[role="alert"]').first();
  const deadline = Date.now() + RESULT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (await table.isVisible()) {
      // 行が出そろってから撮る（描画中はページの高さが変わる）。
      await page.waitForTimeout(500);
      return null;
    }
    const message = ((await alert.textContent()) ?? '').trim();
    if (message !== '') return `判定がエラーになりました: ${message}`;
    await page.waitForTimeout(250);
  }
  return `判定が ${RESULT_TIMEOUT_MS / 1000} 秒で終わりませんでした（ネットワーク不通の可能性）`;
}

/**
 * ページの高さが動かなくなるまで待つ。
 *
 * `load` と `h1` だけでは足りない。`next start` のダッシュボードは `useSearchParams` を使う
 * クライアント部品（FilterBar）を `<Suspense>` で囲んでいるので、HTML には高さ 80px の
 * フォールバックだけが入り、フィルター行はハイドレーション後に差し替わる。
 * ここを待たずに撮ると、フィルター行が空白の帯になった絵が残る（実測で 70px 縮む）。
 *
 * 個別のセレクタで待たないのは、他のチャンクが作った DOM に撮影スクリプトを縛らないため。
 */
async function waitForStableLayout(page: Page, quietMs = 700, timeoutMs = 15_000): Promise<void> {
  const height = () => page.evaluate(() => document.documentElement.scrollHeight);
  const deadline = Date.now() + timeoutMs;
  let last = await height();
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await page.waitForTimeout(100);
    const now = await height();
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (Date.now() - stableSince >= quietMs) {
      return;
    }
  }
}

async function shoot(page: Page, target: Target, scheme: Scheme): Promise<string | null> {
  const response = await page.goto(`${BASE_URL}${target.path}`, {
    waitUntil: 'load',
    timeout: READY_TIMEOUT_MS,
  });
  const status = response?.status();
  if (status !== undefined && status >= 400) {
    throw new Error(`${target.path} が HTTP ${status} を返しました`);
  }
  await page.locator('h1').first().waitFor({ state: 'visible', timeout: READY_TIMEOUT_MS });
  // JS チャンクの取得を待つ（ハイドレーションはこの後に走る）。dev の HMR で
  // idle にならないことがあるので、待てなくても撮影は続ける。
  await page.waitForLoadState('networkidle', { timeout: READY_TIMEOUT_MS }).catch(() => undefined);
  // Web フォントの読み込みを待つ。待たずに撮ると文字幅が変わって版面がずれる。
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
  await waitForStableLayout(page);

  const warning = target.prepare ? await target.prepare(page) : null;

  const file = path.join(OUT_DIR, `${target.name}-${scheme}.png`);
  await page.screenshot({ path: file, fullPage: true, animations: 'disabled' });
  log(`  ${path.relative(process.cwd(), file)}${warning === null ? '' : `  ※ ${warning}`}`);
  return warning;
}

async function main(): Promise<void> {
  await mkdir(OUT_DIR, { recursive: true });
  const browser = await chromium.launch();
  const warnings: string[] = [];
  let shots = 0;

  try {
    const slug = await resolveSlug(browser);
    const targets: Target[] = [
      { name: 'dashboard', path: '/' },
      { name: 'keyword-detail', path: `/keywords/${encodeURIComponent(slug)}` },
      { name: 'search', path: '/search', prepare: runDomainCheck },
      { name: 'watchlist', path: '/watchlist' },
      { name: 'about', path: '/about' },
    ];
    log(`base ${BASE_URL} / slug ${slug}`);

    for (const scheme of SCHEMES) {
      log(`[${scheme}]`);
      const context = await browser.newContext({
        viewport: VIEWPORT,
        colorScheme: scheme,
        deviceScaleFactor: 1,
        reducedMotion: 'reduce',
      });
      const page = await context.newPage();
      try {
        for (const target of targets) {
          const warning = await shoot(page, target, scheme);
          shots += 1;
          if (warning !== null) warnings.push(`${target.name}-${scheme}: ${warning}`);
        }
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser.close();
  }

  log(`\n${shots} 枚を ${path.relative(process.cwd(), OUT_DIR)} に保存しました`);
  for (const warning of warnings) log(`※ ${warning}`);
}

main().catch((err: unknown) => {
  process.stderr.write(`スクリーンショットの取得に失敗しました: ${err instanceof Error ? err.message : String(err)}\n`);
  process.stderr.write(`dev サーバーが ${BASE_URL} で動いているか確認してください。\n`);
  process.exit(1);
});
