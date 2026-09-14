/**
 * Qiita API v2。件数は `Total-Count` ヘッダで 1 リクエストで取れる（research/04 §1.3）。
 * 未認証 60 req/h・IP 単位。API 経由なら本ツールの用途は規約上問題なし（HTML は辿らない）。
 *
 * 日本語訳での再検索（フェーズ3）:
 * 英語フレーズだけで数えると「大規模言語モデル」のような日本語表記の言及を取り逃す。
 * en.wikipedia langlinks で日本語タイトルが取れた語は、日本語でも数えて件数を**合算**する。
 * ただし未認証は 60 req/h しかないので、1 ラン分を見積もって入る窓だけ取る（`planQiitaWindows`）。
 */
import { httpGet } from '../../http';
import { getEnv } from '../../env';
import { dateStamp } from '../../trend/windows';

const ITEMS = 'https://qiita.com/api/v2/items';

/** 未認証の 1 時間あたり上限（IP 単位）。 */
export const QIITA_UNAUTH_HOURLY = 60;
/** 認証時の 1 時間あたり上限。 */
export const QIITA_AUTH_HOURLY = 1000;

export interface QiitaCounts {
  /** 直近 30 日（英語＋日本語の合算）。 */
  c30: number;
  /** その前 30 日（英語＋日本語の合算）。取れなかった窓は 0。 */
  c30prev: number;
  /** 合算に使った日本語タイトル（無ければ null）。 */
  jaKeyword: string | null;
  /** 予算のため省いた窓（ラン単位で 1 回ログに出す）。 */
  skippedWindows: string[];
  /** 呼んだが取れなかった窓（`runs.notes` に残す）。 */
  failedWindows: string[];
  /** 実際に投げたリクエスト数。 */
  calls: number;
  queryUrl: string;
}

/** 1 キーワードで取りに行く窓。優先順位の低いものから落とす。 */
export interface QiitaWindowPlan {
  /** 英語 30d。これだけは必ず取る（Japan Gap の分子はここ）。 */
  enRecent: true;
  /** 日本語 30d。 */
  jaRecent: boolean;
  /** 英語 prev30d。 */
  enPrev: boolean;
  /** 日本語 prev30d。 */
  jaPrev: boolean;
}

/**
 * 1 ランの呼び出し総数を見積もり、予算に収まる窓だけ有効にする。
 *
 * 優先順位: 英語 30d → 日本語 30d → 英語 prev30d → 日本語 prev30d。
 * Japan Gap の式が使うのは 30d だけなので、prev30d（記録用）より
 * 「日本語の現在の言及量」を先に確保する。既定 25 語・未認証 60 req/h だと
 * 英語 30d と日本語 30d の 2 窓（最大 50 回）までが入る。
 */
export function planQiitaWindows(keywordCount: number, budget: number): QiitaWindowPlan {
  const fits = (perKeyword: number): boolean => keywordCount > 0 && keywordCount * perKeyword <= budget;
  return {
    enRecent: true,
    jaRecent: fits(2),
    enPrev: fits(3),
    jaPrev: fits(4),
  };
}

/** 認証の有無で決まる 1 ランの Qiita 予算。 */
export function qiitaBudget(): number {
  return getEnv().QIITA_TOKEN ? QIITA_AUTH_HOURLY : QIITA_UNAUTH_HOURLY;
}

export const ALL_QIITA_WINDOWS: QiitaWindowPlan = { enRecent: true, jaRecent: true, enPrev: true, jaPrev: true };

function url(query: string): string {
  const u = new URL(ITEMS);
  u.searchParams.set('query', query);
  u.searchParams.set('per_page', '1');
  return u.toString();
}

function headers(): Record<string, string> {
  const token = getEnv().QIITA_TOKEN;
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function totalCount(query: string): Promise<number | null> {
  const res = await httpGet(url(query), { label: 'qiita', headers: headers() });
  if (!res.ok) return null;
  // HTTP/2 なのでヘッダ名は小文字。Headers は大小を区別しないので両方通る。
  const raw = res.headers.get('total-count');
  if (raw === null) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

const quoted = (s: string): string => `"${s.replaceAll('"', '\\"')}"`;

export interface QiitaMeasureOptions {
  /** en.wikipedia langlinks で取れた日本語タイトル。 */
  jaKeyword?: string | null;
  /** 取りに行く窓。既定は全部（`planQiitaWindows` の結果を渡す）。 */
  plan?: QiitaWindowPlan;
}

export async function measureQiita(
  keyword: string,
  now: Date,
  opts: QiitaMeasureOptions = {},
): Promise<QiitaCounts | null> {
  const plan = opts.plan ?? ALL_QIITA_WINDOWS;
  const jaKeyword = opts.jaKeyword && opts.jaKeyword.trim() !== '' ? opts.jaKeyword.trim() : null;
  const d30 = dateStamp(new Date(now.getTime() - 30 * 86_400_000));
  const d60 = dateStamp(new Date(now.getTime() - 60 * 86_400_000));
  const recentOf = (phrase: string): string => `${quoted(phrase)} created:>=${d30}`;
  const prevOf = (phrase: string): string => `${quoted(phrase)} created:>=${d60} created:<${d30}`;

  const skippedWindows: string[] = [];
  const failedWindows: string[] = [];
  let calls = 0;

  const recent = await totalCount(recentOf(keyword));
  calls += 1;
  // 英語 30d が取れないときは Japan Gap の分子が作れない → unavailable として扱う。
  if (recent === null) return null;

  let jaRecent = 0;
  if (jaKeyword !== null) {
    if (plan.jaRecent) {
      const got = await totalCount(recentOf(jaKeyword));
      calls += 1;
      if (got === null) failedWindows.push('ja 30d');
      else jaRecent = got;
    } else {
      skippedWindows.push('ja 30d');
    }
  }

  let prev = 0;
  if (plan.enPrev) {
    const got = await totalCount(prevOf(keyword));
    calls += 1;
    if (got === null) failedWindows.push('en prev30d');
    else prev = got;
  } else {
    skippedWindows.push('en prev30d');
  }

  let jaPrev = 0;
  if (jaKeyword !== null) {
    if (plan.jaPrev) {
      const got = await totalCount(prevOf(jaKeyword));
      calls += 1;
      if (got === null) failedWindows.push('ja prev30d');
      else jaPrev = got;
    } else {
      skippedWindows.push('ja prev30d');
    }
  }

  return {
    c30: recent + jaRecent,
    c30prev: prev + jaPrev,
    jaKeyword,
    skippedWindows,
    failedWindows,
    calls,
    // 件数は 2 回の検索の合計なので、1 本の URL では再現できない。
    // 人が確認したいのは「日本語で書かれているか」なので、訳が取れた語は日本語側を出す。
    queryUrl: `https://qiita.com/search?q=${encodeURIComponent(jaKeyword ?? keyword)}`,
  };
}
