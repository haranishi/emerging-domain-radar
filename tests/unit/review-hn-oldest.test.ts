import { afterEach, expect, it, vi } from 'vitest';
import * as http from '../../src/lib/http';
import { hnOldestBefore } from '../../src/lib/trend/sources/hn';
import { noveltyScore } from '../../src/lib/trend/novelty';

afterEach(() => vi.restoreAllMocks());
it('oldest mention uses chronological order rather than relevance order', async () => {
  const old = Date.parse('2020-01-01T00:00:00Z') / 1000;
  const recent = Date.parse('2026-06-01T00:00:00Z') / 1000;
  vi.spyOn(http, 'httpGet').mockImplementation(async (url) => {
    const u = new URL(url);
    // search ranks by relevance; search_by_date ranks newest first (research/02 §1.2).
    const hits = u.pathname.endsWith('/search_by_date') ? [recent, old] : [old, recent];
    const index = Number(u.searchParams.get('page') ?? 0);
    const body = { nbHits: 2, hits: [{ created_at_i: hits[index] }] };
    return { url, ok: true, status: 200, headers: new Headers(), body: JSON.stringify(body), json: <T>() => body as T };
  });
  const now = new Date('2026-09-03T00:00:00Z');
  const result = await hnOldestBefore('sample phrase', now);
  expect(result.oldestSeenAt).toBe('2020-01-01T00:00:00.000Z');
  expect(noveltyScore([result.oldestSeenAt], now).score).toBe(10);
});
