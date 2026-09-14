/**
 * E2E 共通の土台。
 *
 * やっていることは 1 つだけ: **ブラウザから外部ホストへ出たらテストを落とす**。
 * このアプリはオフライン（`RADAR_OFFLINE=1`）なら `fixtures/` だけで完結するので、
 * 外部への通信が起きたら「fixtures を足し忘れて実 API を叩いた」か
 * 「画面に外部リソースを埋め込んだ」のどちらかで、どちらも結果が日によって変わる。
 * 素通りさせると E2E が緑のまま非決定になるため、abort して最後に必ず報告する。
 */
import { test as base, expect, type Locator, type Page } from '@playwright/test';

/**
 * クライアント部品が動き出す（ハイドレーションが済む）まで待つ。
 *
 * dev サーバーは HTML を先に返し、クライアントバンドルは初回アクセスでコンパイルされる。
 * Playwright の click / fill は「見えて・押せて・動いていない」だけで進むので、
 * ハイドレーション前に触ると **操作が DOM に入って React の state には届かない**。
 * checkbox は一瞬 checked になってからハイドレーションで戻され、URL は変わらない——
 * 「たまに落ちる E2E」の典型なので、操作の前にここで待つ。
 *
 * 目印は React が host node に貼る `__reactFiber$…`。React の内部実装に依存するが、
 * Next.js はハイドレーション完了を外から観測できる印を出さないので他に手がない。
 * 名前が変わったらこのヘルパーが落ちるだけで、原因はすぐ分かる。
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await locator.waitFor({ state: 'attached' });
  await expect
    .poll(
      () => locator.evaluate((el) => Object.getOwnPropertyNames(el).some((key) => key.startsWith('__reactFiber$'))),
      { message: 'クライアント部品のハイドレーションが終わらない', timeout: 30_000 },
    )
    .toBe(true);
}

/**
 * `/search` の入力欄に書いて、件数表示が追いつくまで待つ。
 *
 * ハイドレーション前に fill すると値が React の state に入らないので、送信ボタンが
 * 「0 件」の判定で disabled のまま残る。入力の作法をここ 1 か所に閉じ込める。
 */
export async function enterDomains(page: Page, domains: string[]): Promise<void> {
  const textarea = page.getByLabel('Domains');
  await waitForHydration(textarea);
  await textarea.fill(domains.join('\n'));
  await expect(page.getByText(`${domains.length} / 20`)).toBeVisible();
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

function isLocal(url: string): boolean {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    // data: / blob: などは Playwright のルーティング対象外だが、来ても止めない。
    return true;
  }
}

/**
 * 第 2 引数は Playwright の慣例では `use` だが、`react-hooks/rules-of-hooks` が
 * 「React Hook を関数の外で呼んだ」と誤検出するので `runTest` に改名している
 * （名前は Playwright 側では何でもよい。lint を黙らせるために規則を切りたくない）。
 */
export const test = base.extend({
  page: async ({ page }, runTest) => {
    const blocked: string[] = [];
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (isLocal(url)) {
        await route.continue();
        return;
      }
      blocked.push(url);
      await route.abort();
    });

    await runTest(page);

    expect(blocked, 'E2E は外部ネットワークに出ない').toEqual([]);
  },
});

export { expect };
