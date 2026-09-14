/**
 * About（US7・02_ux_design.md §3.4「About」）。
 *
 * このツールの一番大事な約束は「購入機能が無い」こと。文言が消えたら気付けるように、
 * About の宣言と全ページのフッターの両方を見る（片方だけ残っても意味が薄い）。
 * 併せて、係数・閾値が実装の定数から出ていることを 1 か所だけ確かめる。
 */
import { expect, test } from './test-base';

test('About に「購入はできません」が出ている', async ({ page }) => {
  await page.goto('/about');

  const scope = page.getByTestId('about-no-purchase');
  await expect(scope).toBeVisible();
  await expect(scope.getByRole('heading', { name: 'No purchase functions' })).toBeVisible();
  await expect(scope).toContainText('このツールから購入はできません（購入機能は実装していません）。');
  await expect(scope).toContainText('購入・登録・カート・入札・決済の画面・ボタン・API は存在しません。');

  // フッターは全ページ共通。ダッシュボードでも同じ宣言が出る。
  await expect(page.getByRole('contentinfo')).toContainText('このツールから購入はできません（調査専用）');
  await page.goto('/');
  await expect(page.getByRole('contentinfo')).toContainText('このツールから購入はできません（調査専用）');
});

test('About の係数表が実装の定数から出ている', async ({ page }) => {
  await page.goto('/about');

  // Trend の式と定数（ALPHA / K / VMAX）が表として出ていること。
  const trend = page.getByTestId('about-trend-formula');
  await expect(trend).toContainText('Trend = round(clamp(');
  for (const name of ['ALPHA', 'K', 'VMAX']) {
    await expect(trend.getByRole('rowheader', { name, exact: true })).toBeVisible();
  }

  await expect(page.getByTestId('about-normalize')).toContainText('units_s = raw_s × 100 / SCALE_s');
  await expect(page.getByTestId('about-status-thresholds')).toContainText('Mainstream');
});

test('データソースとレート制限表の最右列が 1440px viewport 内に収まる', async ({ page }) => {
  await page.goto('/about');
  const sources = page.getByTestId('about-sources');
  const auth = sources.getByRole('columnheader', { name: 'Auth', exact: true });
  await expect(auth).toBeVisible();
  const box = await auth.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
});
