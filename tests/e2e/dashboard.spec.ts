/**
 * ダッシュボード（02_ux_design.md §3.4「Dashboard」）。
 *
 * 見ているのは 2 点。
 *  1. ランキングカードが順位・Status・3 スコア・ドメイン 3 件を揃えて出ている
 *  2. `Available only` が「リストの中身」と「URL」の両方を動かす（片方だけ動くと、
 *     絞り込んだ URL を貼っても相手には別の一覧が見える）
 *
 * 件数（10 → 9）は `fixtures/demo-run.json` から決まる。空きドメインが 1 件も無い
 * `sovereign compute` だけが `available=1` で落ちるので、その 1 件を名指しで確かめる。
 */
import { expect, test, waitForHydration } from './test-base';

const ALL_CANDIDATES = 10;
const AVAILABLE_ONLY_CANDIDATES = 9;
/** 空き `.com` が 1 件も無い唯一のキーワード（demo fixture）。 */
const NO_AVAILABLE_KEYWORD = 'sovereign compute';

test('ランキングカードが順位・Status・3 スコア・ドメイン 3 件を出す', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { level: 1, name: 'Emerging Domain Radar' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Ranked keyword candidates' })).toBeVisible();

  const cards = page.getByTestId('keyword-card');
  await expect(cards).toHaveCount(ALL_CANDIDATES);

  // 順位は 1 から連番で、Opportunity Score の降順（先頭は demo fixture の agent mesh）。
  await expect(cards.locator('[aria-label^="Rank "]')).toHaveText(
    Array.from({ length: ALL_CANDIDATES }, (_, i) => String(i + 1)),
  );

  const first = cards.first();
  await expect(first.getByRole('heading', { level: 2 })).toHaveText('agent mesh');
  await expect(first.getByRole('link', { name: 'agent mesh' })).toHaveAttribute('href', '/keywords/agent-mesh');

  // Status バッジ（demo fixture では Rising）。
  await expect(first.getByTestId('status-badge')).toHaveText('Rising');

  // 3 スコア。値は fixture 次第なので「0〜100 の整数が出ている」ところまでを見る。
  for (const label of ['Trend', 'Japan Gap', 'Opportunity Score（調査優先度）']) {
    await expect(first.getByRole('meter', { name: label })).toHaveAttribute('aria-valuenow', /^(100|\d{1,2})$/);
  }

  // ドメインはカードに 3 件。各行にドメイン名・空き状態・更新価格が揃っていること。
  const domains = first.getByTestId('card-domain');
  await expect(domains).toHaveCount(3);
  for (let i = 0; i < 3; i += 1) {
    const row = domains.nth(i);
    await expect(row).toContainText(/[a-z0-9-]+\.com/);
    await expect(row).toContainText(/AVAILABLE|TAKEN|UNKNOWN/);
    await expect(row).toContainText(/Renewal (\$\d+\.\d{2} \/ yr|Price unavailable)/);
  }
  await expect(first.getByText('Trademark check required（詳細で確認）', { exact: true })).toHaveCount(1);
  // 3 件より多い候補は詳細ページへ送る。
  await expect(first.getByRole('link', { name: /^\+\d+ more$/ })).toBeVisible();
});

test('Available only を操作するとリストと URL が変わる', async ({ page }) => {
  await page.goto('/');

  const cards = page.getByTestId('keyword-card');
  await expect(cards).toHaveCount(ALL_CANDIDATES);
  await expect(page.getByRole('link', { name: NO_AVAILABLE_KEYWORD })).toBeVisible();

  // 制御された checkbox なので check() ではなく click()（URL が戻るまでの間に
  // Playwright が「まだ checked でない」と見て二度押すのを避ける）。
  const availableOnly = page.getByRole('checkbox', { name: 'Available only' });
  await waitForHydration(availableOnly);
  await availableOnly.click();

  await expect(page).toHaveURL(/\/\?available=1$/);
  await expect(availableOnly).toBeChecked();
  await expect(cards).toHaveCount(AVAILABLE_ONLY_CANDIDATES);
  await expect(page.getByRole('link', { name: NO_AVAILABLE_KEYWORD })).toHaveCount(0);

  // 絞り込み中はカードに出るドメインも空きだけになる（表示と絞り込みを食い違わせない）。
  const filteredDomains = cards.first().getByTestId('card-domain');
  const filteredCount = await filteredDomains.count();
  expect(filteredCount).toBeGreaterThan(0);
  for (let i = 0; i < filteredCount; i += 1) {
    await expect(filteredDomains.nth(i)).toContainText('AVAILABLE');
  }

  // 外すと元に戻り、クエリも消える。
  await availableOnly.click();
  await expect(page).toHaveURL(/\/$/);
  await expect(availableOnly).not.toBeChecked();
  await expect(cards).toHaveCount(ALL_CANDIDATES);
  await expect(page.getByRole('link', { name: NO_AVAILABLE_KEYWORD })).toBeVisible();
});

test('直接 ?available=1 を開いても同じ一覧になる（URL が状態を持っている）', async ({ page }) => {
  await page.goto('/?available=1');

  await expect(page.getByTestId('keyword-card')).toHaveCount(AVAILABLE_ONLY_CANDIDATES);
  await expect(page.getByRole('checkbox', { name: 'Available only' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'Exclude Premium' })).not.toBeChecked();
  await expect(page.getByRole('link', { name: NO_AVAILABLE_KEYWORD })).toHaveCount(0);
});
