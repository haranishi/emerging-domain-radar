/**
 * Watchlist（US6・02_ux_design.md §3.4「Watchlist」）。
 *
 * 追加 → 表示 → 削除を 1 本で通す。ここで確かめたいのは「保存先がローカルの DB だけ」で、
 * 追加も削除もレジストラには何も送っていないこと。`test-base.ts` が外部ホストへの通信を
 * abort するので、このテストが緑ならブラウザからは自分のオリジンしか叩いていない。
 *
 * 使うドメインは demo fixture に無い名前にする（seed 済みの 2 行と混ざらないように）。
 * `.tmp/e2e.db` は globalSetup で作り直すので、途中で落ちても次の実行には残らない。
 */
import { enterDomains, expect, test, waitForHydration } from './test-base';

/** DNS fixture の既定（ENOTFOUND）→ RDAP 404 → available になる名前。 */
const DOMAIN = 'e2ewatch7q3z.com';
/** seed:demo が入れる行数。 */
const SEEDED_ROWS = 2;

test('Search から Watchlist に追加し、表示してから削除できる', async ({ page }) => {
  await page.goto('/watchlist');
  const savedCount = page.getByTestId('watchlist-count');
  await expect(savedCount).toHaveText(String(SEEDED_ROWS));

  // --- 追加（Search の結果行から）
  await page.goto('/search');
  await enterDomains(page, [DOMAIN]);
  await page.getByRole('button', { name: 'Check domains' }).click();

  const resultRow = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: DOMAIN, exact: true }),
  });
  await expect(resultRow).toContainText('AVAILABLE');
  await resultRow.getByRole('button', { name: 'Add to Watchlist' }).click();
  await expect(resultRow.getByText('Saved to Watchlist.')).toBeVisible();
  await expect(resultRow.getByRole('button', { name: 'Added' })).toBeDisabled();

  // --- 表示
  await page.goto('/watchlist');
  await expect(savedCount).toHaveText(String(SEEDED_ROWS + 1));

  const savedRow = page.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: DOMAIN, exact: true }),
  });
  await expect(savedRow).toHaveCount(1);
  // 発見時価格と、判定直後に記録された現在価格が並ぶ。
  await expect(savedRow).toContainText('$11.08 / yr');
  await expect(savedRow).toContainText('AVAILABLE');

  // --- 削除
  const remove = page.getByRole('button', { name: `Remove ${DOMAIN} from the watchlist` });
  await waitForHydration(remove);
  await remove.click();
  await expect(savedRow).toHaveCount(0);
  await expect(savedCount).toHaveText(String(SEEDED_ROWS));
  // seed 済みの行は消えていない（消したのは 1 行だけ）。
  await expect(
    page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'synthmem.com', exact: true }) }),
  ).toHaveCount(1);
});

/**
 * ラウンド 1 の UI 採点で「Remove ボタンが右端で半分切れる」と指摘された箇所の再発防止。
 * 原因は Current price 列の円換算全文で表が 1216px を超えていたこと。
 */
test('Remove ボタンが 1440px で切れずに収まっている', async ({ page }) => {
  await page.goto('/watchlist');

  const overflow = await page.locator('table').first().evaluate((table) => {
    const wrap = table.parentElement as HTMLElement;
    return wrap.scrollWidth - wrap.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  const button = page.getByRole('button', { name: /^Remove .* from the watchlist$/ }).first();
  const box = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
});
