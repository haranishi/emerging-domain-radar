import { test, expect } from './test-base';

test('Watchlist rejects a subdomain rather than saving a nonregistrable name', async ({ request }) => {
  const response = await request.post('/api/watchlist', { data: { domain: 'child.example.com' } });
  expect(response.status()).toBe(400);
  const rows = await (await request.get('/api/watchlist')).json();
  expect(rows.some((row: { domain: string }) => row.domain === 'child.example.com')).toBe(false);
});
