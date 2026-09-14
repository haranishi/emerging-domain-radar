/**
 * 手動ドメイン検索（02_ux_design.md §3.4「Search」・API 契約は 03_architecture.md §8）。
 *
 * オフライン（`RADAR_OFFLINE=1`）の答えは fixtures で決まっている。
 *  - `example.com`                  → `fixtures/dns.json` に NS があるので TAKEN（source: dns）
 *  - `zzq7x4vk2mlp9dwhrn3btf6.com`  → DNS 既定 ENOTFOUND → RDAP 404 で AVAILABLE
 *  - `example.dev`                  → .com 以外は判定せず UNSUPPORTED・価格も出さない
 *
 * 価格が取れないケースは `.dev` で作る。`searchDomains` が価格表を引くのは `.com` だけで、
 * `.com` の価格は Porkbun fixture に必ずあるため、`.com` に価格不明を作る経路が無い。
 */
import { enterDomains, expect, test } from './test-base';

const TAKEN_DOMAIN = 'example.com';
const AVAILABLE_DOMAIN = 'zzq7x4vk2mlp9dwhrn3btf6.com';
const UNSUPPORTED_DOMAIN = 'example.dev';

test('2 件をまとめて判定し、taken と available を出し分ける', async ({ page }) => {
  await page.goto('/search');
  await expect(page.getByRole('heading', { level: 1, name: 'Domain Search' })).toBeVisible();
  // 判定前は空。ページを開いただけで DNS・RDAP は引かない。
  await expect(page.getByText('Enter domains above to see availability and pricing.')).toBeVisible();

  await enterDomains(page, [TAKEN_DOMAIN, AVAILABLE_DOMAIN]);
  await page.getByRole('button', { name: 'Check domains' }).click();

  const results = page.locator('section[aria-labelledby="results-heading"]');
  await expect(results.getByText('2 domains')).toBeVisible();

  const taken = results.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: TAKEN_DOMAIN, exact: true }),
  });
  await expect(taken).toHaveCount(1);
  await expect(taken).toContainText('TAKEN');
  await expect(taken).toContainText('dns');
  await expect(taken).toContainText('$11.08 / yr');

  const available = results.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: AVAILABLE_DOMAIN, exact: true }),
  });
  await expect(available).toHaveCount(1);
  await expect(available).toContainText('AVAILABLE');
  await expect(available).toContainText('rdap');
  await expect(available).toContainText('$11.08 / yr');

  // 空きは確定ではない、という注記が必ず付く。
  await expect(results).toContainText('空き確定ではない');
  await expect(results).toContainText('Trademark check required');
  // 手動検索の行はパイプライン由来の 2 列を持たない（全行 `—` の列を作らない）。
  await expect(results.getByRole('columnheader', { name: 'Domain Score' })).toHaveCount(0);
  await expect(results.getByRole('columnheader', { name: 'Generation rule' })).toHaveCount(0);
});

test('価格が取れない TLD は Price unavailable と出る', async ({ page }) => {
  await page.goto('/search');
  await enterDomains(page, [UNSUPPORTED_DOMAIN]);
  await page.getByRole('button', { name: 'Check domains' }).click();

  const results = page.locator('section[aria-labelledby="results-heading"]');
  const row = results.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: UNSUPPORTED_DOMAIN, exact: true }),
  });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('UNSUPPORTED (MVP は .com のみ)');
  // 推測値・0 円を出さず、取れないことを書く。行に金額が 1 つも出ないことまで見る
  // （登録・更新はどちらも「価格か Price unavailable」のどちらかしか出ない）。
  await expect(row).toContainText('Price unavailable');
  await expect(row).not.toContainText('$');
});

test('20 件を超える入力はフォームが止め、API も 400 を返す', async ({ page }) => {
  const over = Array.from({ length: 21 }, (_, i) => `e2elimit${i}.com`);

  await page.goto('/search');
  await enterDomains(page, over);
  await expect(page.getByText('You can check up to 20 domains at once.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Check domains' })).toBeDisabled();
});

test('GET /api/domains/check は 21 件で 400 を返す', async ({ request }) => {
  const over = Array.from({ length: 21 }, (_, i) => `e2elimit${i}.com`).join(',');

  const response = await request.get('/api/domains/check', { params: { domains: over } });
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: 'A maximum of 20 domains is allowed.' });

  // 0 件も 400（黙って空配列を返さない）。
  const empty = await request.get('/api/domains/check', { params: { domains: '' } });
  expect(empty.status()).toBe(400);
  expect(await empty.json()).toEqual({ error: 'At least one domain is required.' });
});
