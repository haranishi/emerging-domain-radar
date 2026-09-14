/**
 * 空き判定（architecture §3）。
 * DNS 事前フィルタ → RDAP の分岐と、200/404/429 の写像、負のキャッシュ、日次予算。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { createMemoryDb } from '../../src/lib/db/client';
import { insertDomainCheck } from '../../src/lib/db/repos/domainChecks';
import { checkAvailability, NEGATIVE_CACHE_DAYS, UNSUPPORTED_TLD_NOTE } from '../../src/lib/domain/index';
import { resetRdapBootstrapCache } from '../../src/lib/domain/providers/rdap';
import { resolveNsVerdict, resetDnsFixtureCache } from '../../src/lib/domain/providers/dns';
import { resetHttpStats, getHttpStats } from '../../src/lib/http';
import { resetEnvCache } from '../../src/lib/env';

describe('DNS 事前フィルタ', () => {
  beforeEach(() => {
    resetDnsFixtureCache();
    resetEnvCache();
  });

  it('NS が返れば has-ns', async () => {
    expect(await resolveNsVerdict('example.com')).toMatchObject({ verdict: 'has-ns' });
  });

  it('ENOTFOUND は no-ns（RDAP へ回す）', async () => {
    expect(await resolveNsVerdict('zzq7x4vk2mlp9dwhrn3btf6.com')).toMatchObject({ verdict: 'no-ns', code: 'ENOTFOUND' });
  });

  it('SERVFAIL は error（判定できないので RDAP へ回す）', async () => {
    expect(await resolveNsVerdict('dnserror.com')).toMatchObject({ verdict: 'error', code: 'SERVFAIL' });
  });
});

describe('checkAvailability', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
    resetRdapBootstrapCache();
    resetDnsFixtureCache();
  });

  it('NS があれば RDAP を引かずに taken（呼び出し削減）', async () => {
    const [r] = await checkAvailability(['example.com']);
    expect(r.availability).toBe('taken');
    expect(r.availabilitySource).toBe('dns');
    expect(r.reason).toBe('dns-ns');
    expect(getHttpStats().callsByHost['rdap.verisign.com']).toBeUndefined();
  });

  it('RDAP 200 → taken', async () => {
    const db = createMemoryDb();
    const [r] = await checkAvailability(['contextengineering.com'], { db });
    expect(r.availability).toBe('taken');
    expect(r.availabilitySource).toBe('rdap');
    expect(r.reason).toBe('rdap-200');
  });

  it('RDAP 404 → available（ただし空き確定ではない旨の注記を付ける）', async () => {
    const db = createMemoryDb();
    const [r] = await checkAvailability(['zzq7x4vk2mlp9dwhrn3btf6.com'], { db });
    expect(r.availability).toBe('available');
    expect(r.availabilitySource).toBe('rdap');
    expect(r.reason).toBe('rdap-404');
    expect(r.notes.join()).toContain('空き確定ではない');
  });

  it('RDAP 429 → unknown', async () => {
    const db = createMemoryDb();
    const [r] = await checkAvailability(['rdapunknown.com'], { db });
    expect(r.availability).toBe('unknown');
    expect(r.availabilitySource).toBe('rdap');
    expect(r.reason).toBe('rdap-429');
  });

  it('.com 以外は unsupported', async () => {
    const [r] = await checkAvailability(['example.io']);
    expect(r.availability).toBe('unsupported');
    expect(r.notes).toContain(UNSUPPORTED_TLD_NOTE);
  });

  it('taken は 7 日間の負のキャッシュで再問い合わせしない', async () => {
    const db = createMemoryDb();
    insertDomainCheck(db, {
      domain: 'cachedtaken.com',
      checked_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
      availability: 'taken',
      availability_source: 'rdap',
      registration_price: 11.08,
      renewal_price: 11.08,
      currency: 'USD',
      premium: 'standard_inferred',
      price_source: 'porkbun-pricing-get',
      raw: null,
      run_id: null,
    });
    resetHttpStats();
    const [r] = await checkAvailability(['cachedtaken.com'], { db });
    expect(r.availability).toBe('taken');
    expect(r.availabilitySource).toBe('cache');
    expect(r.reason).toContain('negative-cache');
    expect(getHttpStats().callsByHost['rdap.verisign.com']).toBeUndefined();
    expect(NEGATIVE_CACHE_DAYS).toBe(7);
  });

  it('7 日より古い taken は再問い合わせする', async () => {
    const db = createMemoryDb();
    insertDomainCheck(db, {
      domain: 'oldtaken.com',
      checked_at: new Date(Date.now() - 10 * 86_400_000).toISOString(),
      availability: 'taken',
      availability_source: 'rdap',
      registration_price: null,
      renewal_price: null,
      currency: null,
      premium: 'standard_inferred',
      price_source: null,
      raw: null,
      run_id: null,
    });
    const [r] = await checkAvailability(['oldtaken.com'], { db });
    expect(r.availabilitySource).toBe('rdap');
  });

  it('available はランごとに再確認する（キャッシュしない）', async () => {
    const db = createMemoryDb();
    insertDomainCheck(db, {
      domain: 'freshavailable.com',
      checked_at: new Date().toISOString(),
      availability: 'available',
      availability_source: 'rdap',
      registration_price: 11.08,
      renewal_price: 11.08,
      currency: 'USD',
      premium: 'standard_inferred',
      price_source: 'porkbun-pricing-get',
      raw: null,
      run_id: null,
    });
    const [r] = await checkAvailability(['freshavailable.com'], { db });
    expect(r.availabilitySource).toBe('rdap');
  });

  it('日次予算を超えた分は unknown（理由 budget）', async () => {
    const db = createMemoryDb();
    const [a, b] = await checkAvailability(['budget1.com', 'budget2.com'], { db, rdapBudget: 1 });
    expect(a.availability).toBe('available');
    expect(b.availability).toBe('unknown');
    expect(b.availabilitySource).toBe('budget');
    expect(b.reason).toBe('budget');
    expect(b.notes.join()).toContain('日次予算');
  });

  it('永続台帳の当日予約数を予算に数える', async () => {
    const db = createMemoryDb();
    const day = new Date().toISOString().slice(0, 10);
    db.prepare(`INSERT INTO rdap_budget(day, used) VALUES(?, 1)`).run(day);
    const [r] = await checkAvailability(['budget3.com'], { db, rdapBudget: 1 });
    expect(r.availabilitySource).toBe('budget');
    expect((db.prepare(`SELECT used FROM rdap_budget WHERE day = ?`).get(day) as { used: number }).used).toBe(1);
    expect(getHttpStats().callsByHost['rdap.verisign.com']).toBeUndefined();
  });

  it('RDAP 呼び出し前に台帳を +1 予約する', async () => {
    const db = createMemoryDb();
    await checkAvailability(['rdapunknown.com'], { db, rdapBudget: 2 });
    const row = db.prepare(`SELECT day, used FROM rdap_budget`).get() as { day: string; used: number };
    expect(row.day).toBe(new Date().toISOString().slice(0, 10));
    expect(row.used).toBe(1);
  });

  it('DB なしでは RDAP を呼ばず unknown（理由 no-db）', async () => {
    const [r] = await checkAvailability(['zzq7x4vk2mlp9dwhrn3btf6.com']);
    expect(r).toMatchObject({ availability: 'unknown', availabilitySource: 'no-db', reason: 'no-db' });
    expect(getHttpStats().callsByHost['rdap.verisign.com']).toBeUndefined();
  });
});
