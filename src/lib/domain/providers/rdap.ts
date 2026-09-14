/**
 * RDAP（Verisign）による `.com` の空き判定。認証不要。
 * 200 → taken / 404 → available / それ以外 → unknown（architecture §3、research/01 §9）。
 *
 * 規約対応: Verisign は「大量の自動問い合わせ」を禁じているので
 *  - DNS 事前フィルタ（dns.ts）で件数を落とす
 *  - taken は負のキャッシュで再問い合わせしない（index.ts）
 *  - 日次予算 RADAR_RDAP_DAILY_BUDGET で上限を切る（index.ts）
 *  - 300ms 間隔・直列（http.ts のレート表）
 * の 4 点を必ず通す。
 */
import { httpGet } from '../../http';

const IANA_BOOTSTRAP = 'https://data.iana.org/rdap/dns.json';
const FALLBACK_BASE = 'https://rdap.verisign.com/com/v1/';
const BOOTSTRAP_TTL_MS = 24 * 3600 * 1000;

interface BootstrapFile {
  services: [string[], string[]][];
}

let cachedBase: { base: string; at: number } | null = null;

/**
 * IANA ブートストラップから `.com` の RDAP ベース URL を得る（24h キャッシュ）。
 * 取得できなければ実測値 rdap.verisign.com にフォールバックする。
 */
export async function getComRdapBase(): Promise<string> {
  if (cachedBase && Date.now() - cachedBase.at < BOOTSTRAP_TTL_MS) return cachedBase.base;
  try {
    const res = await httpGet(IANA_BOOTSTRAP, { label: 'rdap-bootstrap', retries: 1 });
    if (res.ok) {
      const parsed = res.json<BootstrapFile>();
      for (const [tlds, urls] of parsed.services ?? []) {
        if (tlds.map((t) => t.toLowerCase()).includes('com') && urls.length > 0) {
          const base = urls[0].endsWith('/') ? urls[0] : `${urls[0]}/`;
          cachedBase = { base, at: Date.now() };
          return base;
        }
      }
    }
  } catch {
    // ブートストラップが引けないだけで判定を止めない。
  }
  cachedBase = { base: FALLBACK_BASE, at: Date.now() };
  return FALLBACK_BASE;
}

export function resetRdapBootstrapCache(): void {
  cachedBase = null;
}

export type RdapVerdict = 'taken' | 'available' | 'unknown';

export interface RdapResult {
  verdict: RdapVerdict;
  status: number | null;
  url: string;
  reason: string;
}

export async function rdapLookup(domain: string): Promise<RdapResult> {
  const base = await getComRdapBase();
  const url = `${base}domain/${encodeURIComponent(domain)}`;
  try {
    // 429/5xx は http 層で 1 回だけ再試行し、それでも駄目なら unknown（architecture §3）。
    const res = await httpGet(url, {
      label: 'rdap',
      retries: 1,
      headers: { accept: 'application/rdap+json' },
    });
    if (res.status === 200) return { verdict: 'taken', status: 200, url, reason: 'rdap-200' };
    if (res.status === 404) return { verdict: 'available', status: 404, url, reason: 'rdap-404' };
    return { verdict: 'unknown', status: res.status, url, reason: `rdap-${res.status}` };
  } catch {
    return { verdict: 'unknown', status: null, url, reason: 'rdap-error' };
  }
}
