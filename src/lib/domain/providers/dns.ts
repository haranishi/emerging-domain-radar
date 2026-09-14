/**
 * DNS の NS 事前フィルタ。RDAP の呼び出し回数を減らすために先に引く（architecture §3）。
 * NS が返れば `taken`。ENOTFOUND/ENODATA なら RDAP へ回す。
 */
import { Resolver } from 'node:dns/promises';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixturesDir, isOffline } from '../../env';

export type DnsVerdict = 'has-ns' | 'no-ns' | 'error';

export interface DnsResult {
  verdict: DnsVerdict;
  /** 診断用。エラーコード（ENOTFOUND 等）。 */
  code?: string;
  nameservers?: string[];
}

interface DnsFixture {
  /** ドメイン → NS の配列、またはエラーコード文字列。 */
  records: Record<string, string[] | string>;
  /** 未登録のドメインに対する既定の答え。 */
  default: string;
}

let fixture: DnsFixture | null = null;

function loadFixture(): DnsFixture {
  if (fixture) return fixture;
  const raw = readFileSync(path.join(fixturesDir(), 'dns.json'), 'utf8');
  fixture = JSON.parse(raw) as DnsFixture;
  return fixture;
}

export function resetDnsFixtureCache(): void {
  fixture = null;
}

const resolver = new Resolver({ timeout: 3000, tries: 2 });

export async function resolveNsVerdict(domain: string): Promise<DnsResult> {
  if (isOffline()) {
    const f = loadFixture();
    const entry = f.records[domain] ?? f.default;
    if (Array.isArray(entry)) return { verdict: 'has-ns', nameservers: entry };
    if (entry === 'ENOTFOUND' || entry === 'ENODATA') return { verdict: 'no-ns', code: entry };
    return { verdict: 'error', code: String(entry) };
  }

  try {
    const ns = await resolver.resolveNs(domain);
    return ns.length > 0 ? { verdict: 'has-ns', nameservers: ns } : { verdict: 'no-ns', code: 'ENODATA' };
  } catch (err) {
    const code = (err as { code?: string }).code ?? 'UNKNOWN';
    if (code === 'ENOTFOUND' || code === 'ENODATA') return { verdict: 'no-ns', code };
    // SERVFAIL・タイムアウト等は判定できないので RDAP に回す。
    return { verdict: 'error', code };
  }
}
