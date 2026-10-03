/**
 * 外部 API を叩く唯一の入口。
 * 契約: docs/03_architecture.md §10（タイムアウト 15s・429/5xx を指数バックオフで最大 3 回・
 * Retry-After 尊重・ホスト別トークンバケット・RADAR_OFFLINE=1 で fixtures 応答）。
 *
 * 設計の理由:
 *  - レート制限値を「1 か所の表」に集める（§5.2 と §3 の値）。ソース側に散らすと必ずずれる。
 *  - ホストごとに直列化する。並列度を上げても各ソースの上限（arXiv は 1 req/5s 等）が律速なので、
 *    直列 + トークンバケットのほうが規約違反を作りにくい。
 *  - レスポンス本文はログに出さない（サイズと status だけ）。秘密が本文に混ざる事故を防ぐ。
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fixturesDir, isOffline, userAgent, getEnv } from './env';

export interface HostLimit {
  /** 1 秒あたりの許容リクエスト数。 */
  ratePerSec: number;
  /** バースト許容量（トークンバケットの容量）。 */
  burst: number;
  /** 429/5xx のバックオフ（ms）。省略時は既定 [1000, 2000, 4000]。 */
  backoffMs?: readonly number[];
}

const DEFAULT_BACKOFF_MS = [1000, 2000, 4000] as const;

/**
 * ホスト別レート制限（唯一の正本）。
 * 出典: research/01 §9（RDAP）・02 §1.2/§2.1（HN・GitHub）・03 §1/§2（arXiv・OpenAlex）・
 *       04 §1.3/§1.4（Qiita・Wikimedia）。
 */
export const RATE_LIMITS: Record<string, HostLimit> = {
  // Algolia HN Search: 10,000 req/h/IP。余裕はあるが 2 req/s に自主規制。
  'hn.algolia.com': { ratePerSec: 2, burst: 2 },
  // GitHub Search: 未認証 10/min = 1 req/6s。安全側に 1 req/7s。トークンありは 30/min = 1 req/2s → 1 req/2.5s。
  'api.github.com': { ratePerSec: 1 / 7, burst: 1 },
  // arXiv: 「3 秒に 1 回」だが実測では累積で 429。5 秒間隔 + 60/120/240s の指数バックオフ。
  // 間隔は RADAR_ARXIV_INTERVAL_MS で上書きできる（500 連発の時間帯は 10000 推奨）。
  'export.arxiv.org': { ratePerSec: 1 / 5, burst: 1, backoffMs: [60_000, 120_000, 240_000] },
  // OpenAlex: 秒間上限より日次予算（キー無し $0.10/日）が実質の上限。
  'api.openalex.org': { ratePerSec: 2, burst: 2 },
  // Qiita: 未認証 60 req/h（= 0.0167 req/s）。認証時 1000 req/h。瞬間的にも 1 件ずつ送る。
  'qiita.com': { ratePerSec: 60 / 3600, burst: 1 },
  'ja.wikipedia.org': { ratePerSec: 1, burst: 1 },
  // en.wikipedia は langlinks（キーワードの日本語訳）だけ・1 キーワード 1 回。UA 必須。
  'en.wikipedia.org': { ratePerSec: 2, burst: 2 },
  'wikimedia.org': { ratePerSec: 1, burst: 1 },
  // Verisign RDAP: 閾値非公開。規約が大量自動問い合わせを禁止 → 300ms 間隔・直列。
  'rdap.verisign.com': { ratePerSec: 1 / 0.3, burst: 1 },
  'data.iana.org': { ratePerSec: 1, burst: 1 },
  'api.porkbun.com': { ratePerSec: 1, burst: 1 },
  'api.frankfurter.dev': { ratePerSec: 1, burst: 1 },
};

const FALLBACK_LIMIT: HostLimit = { ratePerSec: 1, burst: 1 };

/**
 * そのホストに実際に適用する制限。
 * 表の値を環境で上書きするのはここだけ（ソース側に散らさない）。
 */
export function limitFor(host: string): HostLimit {
  const base = RATE_LIMITS[host] ?? FALLBACK_LIMIT;
  // GitHub はトークンの有無でレートが変わる（研究 02 §2.1）。
  if (host === 'api.github.com' && getEnv().GITHUB_TOKEN) return { ...base, ratePerSec: 1 / 2.5 };
  // arXiv は時間帯で 500 の出方が変わるので、間隔を env で伸ばせるようにする。
  if (host === 'export.arxiv.org') return { ...base, ratePerSec: 1000 / getEnv().RADAR_ARXIV_INTERVAL_MS };
  return base;
}

/**
 * レート制限ヘッダを見て待つ上限。
 * reset が遠い場合にラン全体を長時間止めないため、この時間を超えたソースは停止する。
 */
export const MAX_HEADER_BLOCK_MS = 120_000;

export class SourceRateLimitError extends Error {
  constructor(
    readonly host: string,
    readonly label: string,
    readonly waitMs: number,
  ) {
    super(`${host}: レート制限の reset まで ${Math.ceil(waitMs / 1000)} 秒のため、このランでは停止`);
    this.name = 'SourceRateLimitError';
  }
}

/** ホスト単位のトークンバケット + 直列キュー。 */
class HostGate {
  private tokens: number;
  private lastRefill = Date.now();
  private tail: Promise<void> = Promise.resolve();
  /** X-RateLimit-Remaining が 0 のときの解放時刻（epoch ms）。 */
  private blockedUntil = 0;

  constructor(private limit: HostLimit) {
    this.tokens = limit.burst;
  }

  updateLimit(limit: HostLimit): void {
    this.limit = limit;
  }

  /** ヘッダで「残り 0」と言われたらリセットまで待つ（GitHub 用）。 */
  blockUntil(epochMs: number): void {
    this.blockedUntil = Math.max(this.blockedUntil, epochMs);
  }

  /** 直列に順番待ちしてからトークンを 1 つ消費する。 */
  acquire(): Promise<void> {
    const wait = this.tail.then(() => this.consume());
    this.tail = wait.catch(() => undefined);
    return wait;
  }

  private async consume(): Promise<void> {
    for (;;) {
      const now = Date.now();
      if (now < this.blockedUntil) {
        await sleep(this.blockedUntil - now);
        continue;
      }
      const elapsedSec = (now - this.lastRefill) / 1000;
      this.tokens = Math.min(this.limit.burst, this.tokens + elapsedSec * this.limit.ratePerSec);
      this.lastRefill = now;
      if (this.tokens >= 1) {
        this.tokens -= 1;
        return;
      }
      const needSec = (1 - this.tokens) / this.limit.ratePerSec;
      await sleep(Math.ceil(needSec * 1000));
    }
  }
}

const gates = new Map<string, HostGate>();
const unavailableHosts = new Map<string, SourceRateLimitError>();

function gateFor(host: string): HostGate {
  const limit = limitFor(host);
  const existing = gates.get(host);
  if (existing) {
    existing.updateLimit(limit);
    return existing;
  }
  const gate = new HostGate(limit);
  gates.set(host, gate);
  return gate;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    if (ms <= 0) resolve();
    else setTimeout(resolve, ms);
  });

export interface HttpResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  body: string;
  json<T = unknown>(): T;
}

export interface HttpGetOptions {
  headers?: Record<string, string>;
  timeoutMs?: number;
  /** 429/5xx の再試行回数。既定 3。 */
  retries?: number;
  /** ログとレート統計のラベル（ソース名）。 */
  label?: string;
}

export class HttpError extends Error {
  constructor(
    message: string,
    readonly url: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

/* ------------------------------------------------------------------ 統計 */

export interface HttpStats {
  /** ホスト別の実リクエスト数。 */
  callsByHost: Record<string, number>;
  /** ラベル（ソース）別の実リクエスト数。 */
  callsByLabel: Record<string, number>;
  /** OpenAlex の x-ratelimit-cost-usd の合計。 */
  openalexCostUsd: number;
  /** OpenAlex の残予算（最後に見た値）。 */
  openalexRemainingUsd: number | null;
  /** status 別の件数。 */
  statuses: Record<string, number>;
  /** 再試行した回数。 */
  retries: number;
  /** オフライン fixture で返した件数。 */
  offlineHits: number;
}

let stats: HttpStats = emptyStats();

function emptyStats(): HttpStats {
  return {
    callsByHost: {},
    callsByLabel: {},
    openalexCostUsd: 0,
    openalexRemainingUsd: null,
    statuses: {},
    retries: 0,
    offlineHits: 0,
  };
}

export function getHttpStats(): HttpStats {
  return JSON.parse(JSON.stringify(stats)) as HttpStats;
}

export function resetHttpStats(): void {
  stats = emptyStats();
  gates.clear();
  unavailableHosts.clear();
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

/* ------------------------------------------------- オフライン fixture 層 */

export interface FixtureEntry {
  /** URL の前方一致（既定）か、`regex: true` なら正規表現。 */
  match: string;
  regex?: boolean;
  /** fixtures/http/ 配下のファイル名。 */
  file: string;
  status?: number;
  headers?: Record<string, string>;
}

let fixtureIndex: FixtureEntry[] | null = null;

function loadFixtureIndex(): FixtureEntry[] {
  if (fixtureIndex) return fixtureIndex;
  const p = path.join(fixturesDir(), 'http', 'index.json');
  const raw = readFileSync(p, 'utf8');
  const parsed = JSON.parse(raw) as FixtureEntry[];
  if (!Array.isArray(parsed)) throw new Error(`fixtures の index.json は配列である必要があります: ${p}`);
  fixtureIndex = parsed;
  return fixtureIndex;
}

/** テスト用。fixtures を編集した直後に呼ぶ。 */
export function resetFixtureCache(): void {
  fixtureIndex = null;
}

function offlineResponse(url: string): HttpResponse {
  const entry = loadFixtureIndex().find((e) =>
    e.regex ? new RegExp(e.match).test(url) : url.startsWith(e.match),
  );
  if (!entry) {
    throw new HttpError(`オフラインモードだが fixture がありません: ${url}`, url);
  }
  const body = readFileSync(path.join(fixturesDir(), 'http', entry.file), 'utf8');
  const status = entry.status ?? 200;
  const headers = new Headers(entry.headers ?? { 'content-type': 'application/json' });
  stats.offlineHits += 1;
  bump(stats.statuses, String(status));
  return makeResponse(url, status, headers, body);
}

function makeResponse(url: string, status: number, headers: Headers, body: string): HttpResponse {
  return {
    url,
    status,
    ok: status >= 200 && status < 300,
    headers,
    body,
    json<T>(): T {
      return JSON.parse(body) as T;
    },
  };
}

/* ---------------------------------------------------------------- httpGet */

function recordOpenAlexCost(headers: Headers): void {
  const cost = Number(headers.get('x-ratelimit-cost-usd'));
  if (Number.isFinite(cost)) stats.openalexCostUsd += cost;
  const remaining = headers.get('x-ratelimit-remaining-usd');
  if (remaining !== null && Number.isFinite(Number(remaining))) {
    stats.openalexRemainingUsd = Number(remaining);
  }
}

export interface RateLimitResetDecision {
  waitMs: number;
  stopSource: boolean;
}

/** GitHub/Qiita の reset ヘッダ（epoch 秒）を共通の停止条件に変換する。 */
export function rateLimitResetDecision(
  host: string,
  headers: Headers,
  nowMs = Date.now(),
): RateLimitResetDecision | null {
  const names = host === 'api.github.com'
    ? ['x-ratelimit-remaining', 'x-ratelimit-reset']
    : host === 'qiita.com'
      ? ['rate-remaining', 'rate-reset']
      : null;
  if (!names) return null;
  const remaining = headers.get(names[0]);
  const reset = headers.get(names[1]);
  if (remaining === null || reset === null || Number(remaining) !== 0) return null;
  const resetMs = Number(reset) * 1000;
  if (!Number.isFinite(resetMs)) return null;
  const waitMs = Math.max(0, resetMs - nowMs);
  return { waitMs, stopSource: waitMs > MAX_HEADER_BLOCK_MS };
}

/**
 * 再試行までの待ち時間。
 *
 * ホスト固有の長いバックオフ（arXiv の 60/120/240 秒）は **429 のときだけ**使う。
 * 5xx とネットワークエラーは一時障害なので既定の 1/2/4 秒で十分で、
 * ここを分けないと arXiv がたまに返す 500 で 1 リクエストに 7 分かかる（実測）。
 */
export function retryDelayMs(res: HttpResponse | null, attempt: number, limit: HostLimit): number {
  const table = res?.status === 429 ? limit.backoffMs ?? DEFAULT_BACKOFF_MS : DEFAULT_BACKOFF_MS;
  const base = table[Math.min(attempt, table.length - 1)];
  const retryAfter = res?.headers.get('retry-after');
  if (retryAfter) {
    const secs = Number(retryAfter);
    if (Number.isFinite(secs)) return Math.max(base, secs * 1000);
    const date = Date.parse(retryAfter);
    if (Number.isFinite(date)) return Math.max(base, Math.min(MAX_HEADER_BLOCK_MS, date - Date.now()));
  }
  return base;
}

/** Retry-After の HTTP-date が待機上限を超える場合の、生の待ち時間。 */
function excessiveRetryAfterDateMs(headers: Headers, nowMs = Date.now()): number | null {
  const value = headers.get('retry-after');
  if (!value || Number.isFinite(Number(value))) return null;
  const date = Date.parse(value);
  if (!Number.isFinite(date)) return null;
  const waitMs = Math.max(0, date - nowMs);
  return waitMs > MAX_HEADER_BLOCK_MS ? waitMs : null;
}

/**
 * GET のみ。状態を変える HTTP メソッドはこのモジュールに存在しない
 * （購入・登録系の実装が物理的にできないようにするため）。
 *
 * HTTP のステータスでは throw しない（404 を「空き」として使うため）。
 * 429/5xx は内部で再試行し、それでも解決しなければ最後の応答を返す。
 * ネットワーク・タイムアウトは再試行後に HttpError。
 */
export async function httpGet(url: string, opts: HttpGetOptions = {}): Promise<HttpResponse> {
  const host = new URL(url).host;
  const label = opts.label ?? host;

  if (isOffline()) {
    bump(stats.callsByHost, host);
    bump(stats.callsByLabel, label);
    const res = offlineResponse(url);
    if (host === 'api.openalex.org') recordOpenAlexCost(res.headers);
    return res;
  }

  const unavailable = unavailableHosts.get(host);
  if (unavailable) throw unavailable;

  const limit = limitFor(host);
  const gate = gateFor(host);
  const retries = opts.retries ?? 3;
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let last: HttpResponse | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    await gate.acquire();
    bump(stats.callsByHost, host);
    bump(stats.callsByLabel, label);
    try {
      const res = await fetch(url, {
        method: 'GET',
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
        headers: { 'user-agent': userAgent(), ...(opts.headers ?? {}) },
      });
      const body = await res.text();
      const wrapped = makeResponse(url, res.status, res.headers, body);
      bump(stats.statuses, String(res.status));
      if (host === 'api.openalex.org') recordOpenAlexCost(res.headers);

      // GitHub/Qiita は残り 0 のとき reset まで待つ。ただし 120 秒超ならこのランで停止する。
      const decision = rateLimitResetDecision(host, res.headers);
      if (decision?.stopSource) {
        const error = new SourceRateLimitError(host, label, decision.waitMs);
        unavailableHosts.set(host, error);
        throw error;
      }
      if (decision && decision.waitMs > 0) {
        gate.blockUntil(Date.now() + decision.waitMs);
        logStep('rate', `${host}: 残り 0 → ${Math.ceil(decision.waitMs / 1000)} 秒待機`);
      }

      if (res.status === 429 || res.status >= 500) {
        last = wrapped;
        const excessiveWait = excessiveRetryAfterDateMs(wrapped.headers);
        if (excessiveWait !== null) {
          const error = new SourceRateLimitError(host, label, excessiveWait);
          unavailableHosts.set(host, error);
          throw error;
        }
        const delay = retryDelayMs(wrapped, attempt, limit);
        // 429 はホスト全体のクールダウンにする。
        // arXiv の制限は「直前 1 回との間隔」ではなく一定時間内の累積回数で効くので
        // （research/03 §1）、この 1 本だけ待っても次のリクエストがまた 429 になる。
        if (res.status === 429) gate.blockUntil(Date.now() + delay);
        if (attempt === retries) return wrapped;
        stats.retries += 1;
        // 何秒待つかは必ず出す。arXiv の 60/120/240 秒バックオフは
        // 黙っていると「固まった」ように見えるため。
        logStep('retry', `${host}: status=${res.status} → ${Math.ceil(delay / 1000)} 秒後に再試行（${attempt + 1}/${retries}）`);
        await sleep(delay);
        continue;
      }
      return wrapped;
    } catch (err) {
      if (err instanceof SourceRateLimitError) throw err;
      lastError = err;
      if (attempt === retries) break;
      stats.retries += 1;
      const delay = retryDelayMs(null, attempt, limit);
      logStep('retry', `${host}: ネットワークエラー → ${Math.ceil(delay / 1000)} 秒後に再試行（${attempt + 1}/${retries}）`);
      await sleep(delay);
    }
  }

  if (last) return last;
  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new HttpError(`GET に失敗しました（${retries + 1} 回試行）: ${reason}`, url);
}

/** 進捗ログ。秘密と本文は出さない。 */
export function logStep(step: string, message: string): void {
  process.stdout.write(`[${step}] ${message}\n`);
}
