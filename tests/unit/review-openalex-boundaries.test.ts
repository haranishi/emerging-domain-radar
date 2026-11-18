import { afterEach, expect, it, vi } from 'vitest';
import * as http from '../../src/lib/http';
import { openalexSource, resetOpenAlexState } from '../../src/lib/trend/sources/openalex';

afterEach(() => vi.restoreAllMocks());
it('does not count the boundary publication in two adjacent windows or include today', async () => {
  resetOpenAlexState();
  vi.spyOn(http, 'httpGet').mockImplementation(async (url) => {
    const filter = new URL(url).searchParams.get('filter')!;
    const from = /from_publication_date:([\d-]+)/.exec(filter)![1];
    const to = /to_publication_date:([\d-]+)/.exec(filter)![1];
    // OpenAlex date filters include both dates.
    const dates = ['2026-08-27', '2026-09-03'];
    const body = { meta: { count: dates.filter((d) => from <= d && d <= to).length } };
    return { url, ok: true, status: 200, headers: new Headers(), body: JSON.stringify(body), json: <T>() => body as T };
  });
  const result = await openalexSource.measure('sample phrase', new Date('2026-09-03T00:00:00Z'));
  expect(result.counts).toEqual({ '7d': 1, prev7d: 0, '30d': 1, prev30d: 0 });
});
