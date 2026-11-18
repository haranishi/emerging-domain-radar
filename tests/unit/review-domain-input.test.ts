import { expect, it } from 'vitest';
import { createMemoryDb } from '../../src/lib/db/client';
import { searchDomains } from '../../src/lib/domain';
import { getHttpStats, resetHttpStats } from '../../src/lib/http';

it('rejects subdomains and invalid labels before DNS/RDAP or pricing', async () => {
  const db = createMemoryDb();
  try {
    resetHttpStats();
    const input = ['child.example.com', '-bad.com', 'bad_.com', `${'a'.repeat(64)}.com`];
    const reports = await searchDomains(input.join(','), { db });
    expect(reports.map((r) => r.availability)).toEqual(input.map(() => 'unsupported'));
    expect(reports.every((r) => r.registrationPrice === null)).toBe(true);
    expect(getHttpStats().callsByHost['rdap.verisign.com']).toBeUndefined();
    expect(db.prepare('SELECT * FROM rdap_budget').all()).toEqual([]);
  } finally { db.close(); }
});

it('still accepts valid single labels including short names, hyphens and punycode', async () => {
  const db = createMemoryDb();
  try {
    const reports = await searchDomains('a.com,a-b.com,xn--bcher-kva.com', { db });
    expect(reports.map((r) => r.availability)).toEqual(['available', 'available', 'available']);
  } finally { db.close(); }
});
