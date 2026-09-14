/**
 * Porkbun 価格表の写像と `Price unavailable` 経路（architecture §3・§8）。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createMemoryDb } from '../../src/lib/db/client';
import { getTldPrice, upsertTldPrices } from '../../src/lib/db/repos/tldPrices';
import { getPricing, searchDomains, PRICE_UNAVAILABLE_NOTE } from '../../src/lib/domain/index';
import { fetchAllTldPrices, PORKBUN_PRICING_URL, PRICE_SOURCE } from '../../src/lib/domain/providers/porkbun-pricing';
import { PREMIUM_INFERRED_NOTE, TRADEMARK_REQUIRED_NOTE } from '../../src/lib/domain/types';
import { resetHttpStats, getHttpStats } from '../../src/lib/http';
import { resetEnvCache } from '../../src/lib/env';
import { resetRdapBootstrapCache } from '../../src/lib/domain/providers/rdap';
import { addToWatchlist, getWatchlistHistory } from '../../src/lib/db/repos/watchlist';
import { availabilityDisplayLabel, premiumLabel } from '../../src/view/labels';

describe('価格表の URL', () => {
  it('認証不要の GET 1 本だけ', () => {
    expect(PORKBUN_PRICING_URL).toBe('https://api.porkbun.com/api/json/v3/pricing/get');
  });
});

describe('fetchAllTldPrices', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
  });

  it('文字列の価格を数値に直す（実測値どおり）', async () => {
    const prices = await fetchAllTldPrices();
    const com = prices.find((p) => p.tld === 'com');
    expect(com).toMatchObject({
      tld: 'com',
      registration: 11.08,
      renewal: 11.08,
      transfer: 11.08,
      currency: 'USD',
      source: PRICE_SOURCE,
    });
    // .org / .dev / .io は初年度が安く更新で上がる（初年度だけ見せる設計は誤解を生む）
    const org = prices.find((p) => p.tld === 'org');
    expect(org?.registration).toBe(7.98);
    expect(org?.renewal).toBe(11.84);
    const io = prices.find((p) => p.tld === 'io');
    expect(io?.registration).toBe(28.12);
    expect(io?.renewal).toBe(51.8);
  });

  it('先頭のドットを外し小文字にする', async () => {
    const prices = await fetchAllTldPrices();
    for (const p of prices) expect(p.tld).toMatch(/^[a-z0-9-]+$/);
  });
});

describe('getPricing', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
  });

  it('DB があれば 24h キャッシュを使い、外部を叩かない', async () => {
    const db = createMemoryDb();
    await getPricing(['com'], { db });
    expect(getHttpStats().callsByHost['api.porkbun.com']).toBe(1);
    expect(getTldPrice(db, 'com')?.registration).toBe(11.08);

    resetHttpStats();
    const second = await getPricing(['com'], { db });
    expect(getHttpStats().callsByHost['api.porkbun.com']).toBeUndefined();
    expect(second[0].registration).toBe(11.08);
  });

  it('キャッシュが古ければ取り直す', async () => {
    const db = createMemoryDb();
    upsertTldPrices(db, [
      { tld: 'com', registration: 9.99, renewal: 9.99, transfer: 9.99, currency: 'USD', source: 'stale' },
    ]);
    db.prepare(`UPDATE tld_prices SET fetched_at = ? WHERE tld = 'com'`).run(
      new Date(Date.now() - 48 * 3600 * 1000).toISOString(),
    );
    const prices = await getPricing(['com'], { db });
    expect(prices[0].registration).toBe(11.08);
  });

  it('価格表に無い TLD は行を作らない（推測値を入れない）', async () => {
    const prices = await getPricing(['com', 'zzznotatld'], {});
    expect(prices.map((p) => p.tld)).toEqual(['com']);
  });

  it('1 回のリクエストで全 TLD が返る（TLD ごとに叩かない）', async () => {
    resetHttpStats();
    await getPricing(['com', 'net', 'org', 'io'], {});
    expect(getHttpStats().callsByHost['api.porkbun.com']).toBe(1);
  });
});

describe('searchDomains（合成と Price unavailable）', () => {
  beforeEach(() => {
    resetEnvCache();
    resetHttpStats();
    resetRdapBootstrapCache();
  });

  it('入力を正規化する（大文字・URL・パス・www・空白）', async () => {
    const reports = await searchDomains(' HTTPS://WWW.Example.com/path?q=1 \n zzq7x4vk2mlp9dwhrn3btf6.com ');
    expect(reports.map((r) => r.domain)).toEqual(['example.com', 'zzq7x4vk2mlp9dwhrn3btf6.com']);
  });

  it('TLD が無ければ .com を補う', async () => {
    const reports = await searchDomains('zzq7x4vk2mlp9dwhrn3btf6');
    expect(reports[0].domain).toBe('zzq7x4vk2mlp9dwhrn3btf6.com');
  });

  it('カンマ区切り・改行区切り・重複を扱う', async () => {
    const reports = await searchDomains('example.com, example.com\nzzq7x4vk2mlp9dwhrn3btf6.com');
    expect(reports).toHaveLength(2);
  });

  it('既定では 20 件まで', async () => {
    const many = Array.from({ length: 30 }, (_, i) => `nonexistent${'a'.repeat(i + 1)}.com`).join('\n');
    const reports = await searchDomains(many, { rdapBudget: 1000 });
    expect(reports).toHaveLength(20);
  });

  it('価格・Premium・商標注意・公式リンクを 1 行に揃える', async () => {
    const db = createMemoryDb();
    const [r] = await searchDomains('zzq7x4vk2mlp9dwhrn3btf6.com', { db });
    expect(r.registrationPrice).toBe(11.08);
    expect(r.renewalPrice).toBe(11.08);
    expect(r.currency).toBe('USD');
    expect(r.premium).toBe('standard_inferred');
    expect(r.priceSource).toBe(PRICE_SOURCE);
    expect(r.notes).toContain(TRADEMARK_REQUIRED_NOTE);
    expect(r.notes).toContain(PREMIUM_INFERRED_NOTE);
    expect(r.officialLinks.map((l) => l.label)).toEqual(['Porkbun', 'Namecheap', 'ICANN Lookup']);
  });

  it('.com 以外は unsupported で価格も出さない', async () => {
    const [r] = await searchDomains('example.io');
    expect(r.availability).toBe('unsupported');
    expect(r.registrationPrice).toBeNull();
    expect(r.premium).toBe('unknown');
    expect(r.notes).toContain('MVP は .com のみ');
  });

  it('DB を渡すと domain_checks に履歴が残る（負のキャッシュ由来は残さない）', async () => {
    const db = createMemoryDb();
    await searchDomains('zzq7x4vk2mlp9dwhrn3btf6.com', { db, runId: 7 });
    const rows = db.prepare(`SELECT * FROM domain_checks`).all() as { domain: string; run_id: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0].run_id).toBe(7);
  });

  it('Watchlist にあるドメインの手動検索結果を価格履歴にも追加する', async () => {
    const db = createMemoryDb();
    const watchlistId = addToWatchlist(db, {
      keyword: 'manual',
      domain: 'zzq7x4vk2mlp9dwhrn3btf6.com',
      found_registration_price: null,
      found_renewal_price: null,
      found_currency: null,
      trend_score: null,
      opportunity_score: null,
    });
    await searchDomains('zzq7x4vk2mlp9dwhrn3btf6.com', { db });
    expect(getWatchlistHistory(db, watchlistId)).toMatchObject([
      { registration_price: 11.08, renewal_price: 11.08, availability: 'available', premium: 'standard_inferred' },
    ]);
  });

  it('価格が取れないときは null と Price unavailable（推測値を入れない）', async () => {
    // 価格表が空を返すケースを DB キャッシュで再現する
    const db = createMemoryDb();
    upsertTldPrices(db, [
      { tld: 'com', registration: null, renewal: null, transfer: null, currency: 'USD', source: PRICE_SOURCE },
    ]);
    const [r] = await searchDomains('zzq7x4vk2mlp9dwhrn3btf6.com', { db });
    expect(r.registrationPrice).toBeNull();
    expect(r.renewalPrice).toBeNull();
    expect(r.currency).toBeNull();
    expect(r.priceSource).toBeNull();
    expect(r.notes).toContain(PRICE_UNAVAILABLE_NOTE);
    expect(PRICE_UNAVAILABLE_NOTE).toBe('Price unavailable');
  });

  it('空入力は空配列', async () => {
    expect(await searchDomains('')).toEqual([]);
    expect(await searchDomains('   \n  ')).toEqual([]);
  });
});

describe('表示ラベルと CLI 上限', () => {
  it('Premium と UNSUPPORTED の文言はクライアント安全な共通モジュールに集約する', () => {
    expect(premiumLabel('standard_inferred')).toBe('Standard (inferred)');
    expect(availabilityDisplayLabel('unsupported')).toBe('UNSUPPORTED (MVP は .com のみ)');
  });

  it('check-domains CLI は 21 件を切り捨てず exit 1 にする', () => {
    const domains = Array.from({ length: 21 }, (_, index) => `clilimit${index}.com`);
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/check-domains.ts', ...domains], {
      cwd: process.cwd(),
      encoding: 'utf8',
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('最大 20 件');
    expect(result.stdout).toBe('');
  });
});
