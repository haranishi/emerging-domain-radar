/**
 * ドメインプロバイダの公開 API。
 *
 * **このモジュールが公開する関数は次の 3 つだけ**（docs/01_requirements.md §3・architecture §3）。
 *
 *   checkAvailability(domains, opts?)  DNS 事前フィルタ → RDAP
 *   getPricing(tlds, opts?)            Porkbun 価格表（24h キャッシュ）
 *   searchDomains(input, opts?)        正規化 → 上 2 つを合成
 *
 * 購入・登録・チェックアウト・カート・入札・自動更新・購入予約に関する関数は
 * 定義も呼び出しもしない。tests/unit/no-purchase-guard.test.ts が機械的に検査する。
 */
import { getEnv } from '../env';
import type { Db } from '../db/client';
import { findFreshTakenCheck, insertDomainCheck } from '../db/repos/domainChecks';
import { appendWatchlistPrice } from '../db/repos/watchlist';
import { getFreshTldPrice, upsertTldPrices } from '../db/repos/tldPrices';
import { PRICE_UNAVAILABLE_NOTE, UNSUPPORTED_TLD_NOTE } from '../../view/labels';
import { resolveNsVerdict } from './providers/dns';
import { rdapLookup } from './providers/rdap';
import { fetchAllTldPrices, PRICE_SOURCE } from './providers/porkbun-pricing';
import { officialLinks } from './links';
import {
  AVAILABILITY_CAVEAT,
  PREMIUM_INFERRED_NOTE,
  TRADEMARK_REQUIRED_NOTE,
  type AvailabilityResult,
  type DomainReport,
  type TldPrice,
} from './types';

/** 負のキャッシュの有効期間（taken を再問い合わせしない日数）。 */
export const NEGATIVE_CACHE_DAYS = 7;
/** 手動検索の 1 回あたり上限。 */
export const MANUAL_SEARCH_LIMIT = 20;
/** MVP が扱う TLD。 */
export const SUPPORTED_TLD = 'com';

export { PRICE_UNAVAILABLE_NOTE, UNSUPPORTED_TLD_NOTE } from '../../view/labels';

export interface CheckOptions {
  /** 負のキャッシュ・日次予算・履歴に使う。無ければ RDAP を呼ばない。 */
  db?: Db;
  /** RDAP の日次予算。既定は RADAR_RDAP_DAILY_BUDGET。 */
  rdapBudget?: number;
  negativeCacheDays?: number;
}

/** RDAP 呼び出し枠を原子的に先取りする。同時検索でも予算を超過させない。 */
function reserveRdapBudget(db: Db, budget: number, now = new Date()): boolean {
  const day = now.toISOString().slice(0, 10);
  const reserve = db.transaction(() => {
    db.prepare(`INSERT INTO rdap_budget(day, used) VALUES(?, 0) ON CONFLICT(day) DO NOTHING`).run(day);
    const info = db.prepare(`UPDATE rdap_budget SET used = used + 1 WHERE day = ? AND used < ?`).run(day, budget);
    return info.changes === 1;
  });
  return reserve();
}

/** 入力文字列を `.com` のドメイン名リストに正規化する（module 内部専用）。 */
function normalizeDomainInput(input: string): string[] {
  const parts = input
    .split(/[\n,\s]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  const out: string[] = [];
  for (const raw of parts) {
    let d = raw.toLowerCase();
    d = d.replace(/^https?:\/\//, '');
    d = d.replace(/^www\./, '');
    d = d.split('/')[0];
    d = d.split('?')[0];
    d = d.split('#')[0];
    d = d.replace(/\.$/, '');
    if (!d) continue;
    if (!d.includes('.')) d = `${d}.${SUPPORTED_TLD}`;
    if (!out.includes(d)) out.push(d);
  }
  return out;
}

function tldOf(domain: string): string {
  const i = domain.lastIndexOf('.');
  return i === -1 ? '' : domain.slice(i + 1);
}

/**
 * 空き判定。DNS で NS が返れば `taken`、返らなければ RDAP を引く。
 *
 * Verisign 規約対応の 3 段構え:
 *  1. DNS 事前フィルタで RDAP の件数を落とす
 *  2. `taken` は 7 日間の負のキャッシュで再問い合わせしない
 *  3. 日次予算（既定 300）を超えた分は `unknown`（理由 `budget`）で止める
 */
export async function checkAvailability(
  domains: string[],
  opts: CheckOptions = {},
): Promise<AvailabilityResult[]> {
  const env = getEnv();
  const budget = opts.rdapBudget ?? env.RADAR_RDAP_DAILY_BUDGET;
  const cacheDays = opts.negativeCacheDays ?? NEGATIVE_CACHE_DAYS;

  const results: AvailabilityResult[] = [];
  for (const domain of domains) {
    const checkedAt = new Date().toISOString();

    if (tldOf(domain) !== SUPPORTED_TLD) {
      results.push({
        domain,
        availability: 'unsupported',
        availabilitySource: 'unsupported',
        reason: 'tld-not-supported',
        checkedAt,
        notes: [UNSUPPORTED_TLD_NOTE],
      });
      continue;
    }

    // 1. DNS 事前フィルタ
    const dns = await resolveNsVerdict(domain);
    if (dns.verdict === 'has-ns') {
      results.push({
        domain,
        availability: 'taken',
        availabilitySource: 'dns',
        reason: 'dns-ns',
        checkedAt,
        notes: ['NS レコードが存在する＝登録済み'],
      });
      continue;
    }

    // 2. 負のキャッシュ
    if (opts.db) {
      const cached = findFreshTakenCheck(opts.db, domain, cacheDays);
      if (cached) {
        results.push({
          domain,
          availability: 'taken',
          availabilitySource: 'cache',
          reason: `negative-cache(${cached.availability_source ?? 'unknown'})`,
          checkedAt: cached.checked_at,
          notes: [`${cacheDays} 日以内の判定を再利用（RDAP への再問い合わせを避けるため）`],
        });
        continue;
      }
    }

    // DB が無ければ永続予算を数えられないため、RDAP へは出ない。
    if (!opts.db) {
      results.push({
        domain,
        availability: 'unknown',
        availabilitySource: 'no-db',
        reason: 'no-db',
        checkedAt,
        notes: ['DB が無く RDAP 日次予算を記録できないため判定を保留'],
      });
      continue;
    }

    // 3. 日次予算。外部呼び出しの前にトランザクションで 1 枠を予約する。
    if (!reserveRdapBudget(opts.db, budget)) {
      results.push({
        domain,
        availability: 'unknown',
        availabilitySource: 'budget',
        reason: 'budget',
        checkedAt,
        notes: [`RDAP の日次予算（${budget} 件）に達したため判定を保留`],
      });
      continue;
    }

    const rdap = await rdapLookup(domain);
    const availability = rdap.verdict;
    const notes: string[] = [];
    if (availability === 'available') notes.push(AVAILABILITY_CAVEAT);
    if (availability === 'unknown') notes.push('RDAP が判定できなかった（429/5xx/タイムアウト）');
    results.push({
      domain,
      availability,
      availabilitySource: 'rdap',
      reason: rdap.reason,
      checkedAt,
      notes,
    });
  }
  return results;
}

export interface PricingOptions {
  db?: Db;
  /** キャッシュを無視して取り直す。 */
  force?: boolean;
}

/**
 * TLD の標準価格。Porkbun の価格表 API（認証不要）を 1 回引いて 24h キャッシュする。
 * 取れなかった値は null のまま返す（推測値・既定値を入れない）。
 */
export async function getPricing(tlds: string[], opts: PricingOptions = {}): Promise<TldPrice[]> {
  const wanted = tlds.map((t) => t.replace(/^\./, '').toLowerCase());
  const out: TldPrice[] = [];
  const missing: string[] = [];

  if (opts.db && !opts.force) {
    for (const tld of wanted) {
      const row = getFreshTldPrice(opts.db, tld);
      if (row) {
        out.push({
          tld: row.tld,
          registration: row.registration,
          renewal: row.renewal,
          transfer: row.transfer,
          currency: row.currency ?? 'USD',
          source: row.source ?? PRICE_SOURCE,
          fetchedAt: row.fetched_at ?? new Date().toISOString(),
        });
      } else {
        missing.push(tld);
      }
    }
  } else {
    missing.push(...wanted);
  }

  if (missing.length === 0) return out;

  const all = await fetchAllTldPrices();
  if (opts.db && all.length > 0) {
    upsertTldPrices(
      opts.db,
      all.map((p) => ({
        tld: p.tld,
        registration: p.registration,
        renewal: p.renewal,
        transfer: p.transfer,
        currency: p.currency,
        source: p.source,
      })),
    );
  }
  const byTld = new Map(all.map((p) => [p.tld, p]));
  for (const tld of missing) {
    const found = byTld.get(tld);
    if (found) out.push(found);
    // 見つからなければ何も足さない（= 価格不明。null 行を作らない）
  }
  return out;
}

export interface SearchOptions extends CheckOptions {
  /** 1 回に判定する件数の上限。既定 20（手動検索の上限）。 */
  maxDomains?: number;
  /** domain_checks に履歴を残すか。db があれば既定 true。 */
  persist?: boolean;
  runId?: number | null;
}

/**
 * 手動検索とパイプラインの共通入口。
 * 改行・カンマ区切りの入力を正規化し、空き判定と価格を合成して 1 行分の表示モデルにする。
 */
export async function searchDomains(input: string, opts: SearchOptions = {}): Promise<DomainReport[]> {
  const max = opts.maxDomains ?? MANUAL_SEARCH_LIMIT;
  const domains = normalizeDomainInput(input).slice(0, max);
  if (domains.length === 0) return [];

  const availability = await checkAvailability(domains, opts);
  const needsPrice = domains.some((d) => tldOf(d) === SUPPORTED_TLD);
  const prices = needsPrice ? await getPricing([SUPPORTED_TLD], { db: opts.db }) : [];
  const comPrice = prices.find((p) => p.tld === SUPPORTED_TLD);
  const persist = opts.persist ?? Boolean(opts.db);

  const reports: DomainReport[] = [];
  for (const a of availability) {
    const supported = a.availability !== 'unsupported';
    const registrationPrice = supported ? comPrice?.registration ?? null : null;
    const renewalPrice = supported ? comPrice?.renewal ?? null : null;
    const notes = [...a.notes];
    if (supported) {
      notes.push(TRADEMARK_REQUIRED_NOTE);
      notes.push(PREMIUM_INFERRED_NOTE);
      if (registrationPrice === null) notes.push(PRICE_UNAVAILABLE_NOTE);
    }
    const report: DomainReport = {
      domain: a.domain,
      availability: a.availability,
      availabilitySource: a.availabilitySource,
      registrationPrice,
      renewalPrice,
      currency: registrationPrice === null ? null : comPrice?.currency ?? 'USD',
      premium: supported ? 'standard_inferred' : 'unknown',
      priceSource: registrationPrice === null ? null : comPrice?.source ?? PRICE_SOURCE,
      checkedAt: a.checkedAt,
      officialLinks: officialLinks(a.domain),
      notes,
    };
    reports.push(report);

    if (opts.db) {
      const watchlist = opts.db
        .prepare(`SELECT id FROM watchlist WHERE domain = ?`)
        .get(report.domain) as { id: number } | undefined;
      if (watchlist) {
        appendWatchlistPrice(opts.db, watchlist.id, {
          registration_price: report.registrationPrice,
          renewal_price: report.renewalPrice,
          availability: report.availability,
          premium: report.premium,
        });
      }
    }

    if (persist && opts.db && a.availabilitySource !== 'cache') {
      insertDomainCheck(opts.db, {
        domain: report.domain,
        checked_at: report.checkedAt,
        availability: report.availability,
        availability_source: report.availabilitySource,
        registration_price: report.registrationPrice,
        renewal_price: report.renewalPrice,
        currency: report.currency,
        premium: report.premium,
        price_source: report.priceSource,
        raw: { reason: a.reason },
        run_id: opts.runId ?? null,
      });
    }
  }
  return reports;
}
