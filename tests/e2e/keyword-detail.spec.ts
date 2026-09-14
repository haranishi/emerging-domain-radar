/**
 * キーワード詳細（02_ux_design.md §3.4「Keyword detail」）。
 *
 * 詳細ページの役目は「その順位がどこから出たかを、コードを開かずに辿れること」。
 * したがって見るのは次の 3 つ。
 *  1. Evidence 表: ソース × 窓の実件数と、人が確認できる検索リンク
 *  2. ドメイン表: 価格・更新価格・種別・確認時刻（推測値を出していないこと）
 *  3. `Trademark check required`: 全候補に必ず出る手動確認の注記
 */
import { expect, test } from './test-base';

const SLUG = 'agent-mesh';
const KEYWORD = 'agent mesh';
/** demo fixture で `available` かつ価格が取れている候補。 */
const AVAILABLE_DOMAIN = 'agentmesh.com';
const SOURCES = ['HN', 'GitHub', 'arXiv', 'OpenAlex', 'Qiita', 'Wikipedia'];

test('Evidence 表に各ソースの件数と検索リンクがある', async ({ page }) => {
  await page.goto(`/keywords/${SLUG}`);
  await expect(page.getByRole('heading', { level: 1, name: KEYWORD })).toBeVisible();

  const evidence = page.locator('section[aria-labelledby="evidence-heading"]');
  await expect(evidence.getByRole('heading', { name: 'Evidence' })).toBeVisible();

  // 窓の列（7d / 前 7d / 変化 / 30d / 前 30d / 変化）が揃っている。
  for (const header of ['Last 7d', 'Prev 7d', 'Last 30d', 'Prev 30d']) {
    await expect(evidence.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  // ソースは 6 つ。各行に件数と「Open source ↗」リンクが必ず付く。
  for (const source of SOURCES) {
    const row = evidence.getByRole('row').filter({
      has: page.getByRole('rowheader', { name: source, exact: true }),
    });
    await expect(row).toHaveCount(1);
    await expect(row).toContainText(/\d/);
    await expect(row.getByRole('link', { name: /^Open source/ })).toHaveAttribute('href', /^https:\/\//);
  }
  const links = evidence.getByRole('link', { name: /^Open source/ });
  await expect(links).toHaveCount(SOURCES.length);
  // 外部リンクは別タブで開き、リファラを渡さない。
  await expect(links.first()).toHaveAttribute('target', '_blank');
  await expect(links.first()).toHaveAttribute('rel', /noreferrer/);
});

test('ドメイン表に価格・更新価格・種別・確認時刻が出る', async ({ page }) => {
  await page.goto(`/keywords/${SLUG}`);

  const domains = page.locator('section[aria-labelledby="domains-heading"]');
  await expect(domains.getByRole('heading', { name: 'Domain candidates' })).toBeVisible();

  for (const header of ['Domain', 'Availability', 'Registration', 'Renewal', 'Type', 'Checked at', 'Price source']) {
    await expect(domains.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  const row = domains.getByRole('row').filter({
    has: page.getByRole('rowheader', { name: AVAILABLE_DOMAIN, exact: true }),
  });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('AVAILABLE');
  // 価格は `$11.08 / yr` の形。Premium は推測であることを表示に残す。
  await expect(row).toContainText(/\$\d+\.\d{2} \/ yr/);
  await expect(row).toContainText('Standard (inferred)');
  // 確認時刻は UTC 表記（`2026-09-03 00:00 UTC`）。
  await expect(row).toContainText(/\d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC/);
  await expect(row).toContainText('porkbun-pricing-get');

  // 円換算は参考値・取得元・取得時刻をセットで出す。
  await expect(row).toContainText(/≈ ¥[\d,]+（参考値/);

  // 公式サイトは「検索画面を開くだけ」のリンク。購入導線は作らない。
  await expect(row.getByRole('link', { name: /^ICANN Lookup/ })).toHaveAttribute(
    'href',
    `https://lookup.icann.org/en/lookup?name=${AVAILABLE_DOMAIN}`,
  );
});

/**
 * ラウンド 1 の UI 採点で見つかった最優先の欠陥の再発防止。
 *
 * 円換算の全文（`≈ ¥1,771（参考値・Frankfurter v2・取得 …）`）が Registration /
 * Renewal 列を押し広げ、1440px でも Checked at 以降が画面外にあった＝確認時刻・
 * 公式サイトリンク・Watchlist 追加に届かなかった。列幅を固定した今は横スクロールが
 * 発生しないことを、幅ではなく「はみ出し量 0」で確かめる。
 */
test('ドメイン表が 1440px で横スクロールせず、右端の 2 列まで見えている', async ({ page }) => {
  await page.goto(`/keywords/${SLUG}`);
  const domains = page.locator('section[aria-labelledby="domains-heading"]');

  const overflow = await domains.locator('table').evaluate((table) => {
    const wrap = table.parentElement as HTMLElement;
    return wrap.scrollWidth - wrap.clientWidth;
  });
  expect(overflow).toBeLessThanOrEqual(1);

  for (const header of ['Checked at', 'Official sites', 'Watchlist']) {
    await expect(domains.getByRole('columnheader', { name: header, exact: true })).toBeVisible();
  }

  // Watchlist ボタンの右端が viewport の中にある（半分切れていない）。
  const button = domains.getByRole('button', { name: 'Add to Watchlist' }).first();
  const box = await button.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport!.width);
});

test('Trademark check required が出ていて、手動確認のリンクが並ぶ', async ({ page }) => {
  await page.goto(`/keywords/${SLUG}`);

  const trademark = page.locator('section[aria-labelledby="trademark-heading"]');
  await expect(trademark.getByRole('heading', { name: 'Trademark check required' })).toBeVisible();
  await expect(trademark).toContainText('指定商品・役務');
  // 判定ではなく検索画面への導線しか無い（可否を断定する表示は作らない）。
  const links = trademark.getByRole('link');
  expect(await links.count()).toBeGreaterThan(0);
  await expect(links.first()).toHaveAttribute('href', /^https:\/\//);

  // Japan Gap は計測に使った日本語訳（無ければ英語だけで測った事実）も表示する。
  const row = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: 'JP equivalent', exact: true }) });
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('JP equivalent unknown');
  await expect(row).toContainText('日本語訳が Wikipedia から取れず、英語フレーズだけで計測');
});
