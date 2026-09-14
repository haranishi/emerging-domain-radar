/**
 * `GET / POST / DELETE /api/watchlist` — 気になった候補を覚えておくためのメモ
 * （US6・契約は docs/03_architecture.md §8）。
 *
 * 書き込み先はローカルの SQLite だけ。レジストラへの登録・予約・入札は一切しない
 * （そのためのコードがリポジトリに存在しない）。ここが行うのは行の追加と削除だけで、
 * 空き判定や価格の取得は走らせない。Watchlist の操作で DNS・RDAP を引くと、
 * ボタンを押した回数だけ RDAP の日次予算が減るため。
 *
 * `.com` 以外は 400 で断る。`availability:'unsupported'` の行を保存できてしまうと
 * 「現在価格」が永久に取れない行が Watchlist に溜まり、差分表が意味を失う。
 *
 * `dynamic = 'force-dynamic'`: 都度 DB を読む・書くので応答をキャッシュさせない
 * （cacheComponents は無効なので Next 16 でもこの指定が効く）。
 */
import { z } from 'zod';
import { getDb } from '@/lib/db/client';
import { addToWatchlist, removeFromWatchlist } from '@/lib/db/repos';
import { SUPPORTED_TLD, UNSUPPORTED_TLD_NOTE } from '@/lib/domain';
import { buildWatchlistView } from '@/view/watchlist';

export const dynamic = 'force-dynamic';

/** 価格・スコアは「取れなかった」を null で表す。0 と混ぜない。 */
const NullableNumber = z.number().nullable().optional();

const WatchlistPostBody = z.object({
  /** `/search` からの追加はキーワードを持たないので、無ければドメイン名で埋める。 */
  keyword: z.string().trim().max(200).nullable().optional(),
  domain: z.string().trim().min(3).max(253),
  registrationPrice: z.number().nonnegative().nullable().optional(),
  renewalPrice: z.number().nonnegative().nullable().optional(),
  currency: z.string().trim().min(1).max(8).nullable().optional(),
  trendScore: NullableNumber,
  opportunityScore: NullableNumber,
  note: z.string().trim().max(500).nullable().optional(),
});

/** ラベルは英数とハイフン、各ラベルは 63 文字以内、全体 253 文字以内。 */
const HOSTNAME = /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/;

/**
 * `@/lib/domain` の `normalizeDomainInput`（module 内部専用）と同じ整形。
 * 表示や比較のキーは 1 つに保ちたいので、大文字・`https://`・`www.`・パスを落とす。
 */
function normalizeDomain(input: string): string {
  let domain = input.trim().toLowerCase();
  domain = domain.replace(/^https?:\/\//, '');
  domain = domain.replace(/^www\./, '');
  domain = domain.split('/')[0].split('?')[0].split('#')[0];
  return domain.replace(/\.$/, '');
}

function tldOf(domain: string): string {
  const dot = domain.lastIndexOf('.');
  return dot === -1 ? '' : domain.slice(dot + 1);
}

/** zod の指摘は項目名だけ返す（値をそのまま返すと入力がログ・画面に回る）。 */
function fieldList(error: z.ZodError): string {
  const fields = [...new Set(error.issues.map((issue) => issue.path.join('.')).filter(Boolean))];
  return fields.length > 0 ? fields.join(', ') : 'body';
}

export async function GET() {
  try {
    return Response.json(buildWatchlistView(getDb()));
  } catch (cause) {
    console.error('[api/watchlist] GET failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Reading the watchlist failed.' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: 'A JSON body is required.' }, { status: 400 });
  }

  const parsed = WatchlistPostBody.safeParse(payload);
  if (!parsed.success) {
    return Response.json({ error: `Invalid request body: ${fieldList(parsed.error)}` }, { status: 400 });
  }

  const domain = normalizeDomain(parsed.data.domain);
  if (!HOSTNAME.test(domain)) {
    return Response.json({ error: 'A valid domain name is required.' }, { status: 400 });
  }
  if (tldOf(domain) !== SUPPORTED_TLD) {
    return Response.json({ error: `Unsupported TLD (${UNSUPPORTED_TLD_NOTE}).` }, { status: 400 });
  }

  try {
    const db = getDb();
    const keyword = parsed.data.keyword?.trim() ? parsed.data.keyword.trim() : domain;
    addToWatchlist(db, {
      keyword,
      domain,
      found_registration_price: parsed.data.registrationPrice ?? null,
      found_renewal_price: parsed.data.renewalPrice ?? null,
      found_currency: parsed.data.currency ?? null,
      trend_score: parsed.data.trendScore ?? null,
      opportunity_score: parsed.data.opportunityScore ?? null,
      note: parsed.data.note ?? null,
    });
    // 保存した行はドメインで引き直す。`addToWatchlist` は upsert で、既存行を更新した回は
    // INSERT が起きないため戻り値が `last_insert_rowid()`（＝直前に別の行を入れたときの id）
    // になりうる。それを鍵にすると「同じドメインをもう一度追加した」応答に他人の行が載る。
    // domain は UNIQUE なので、ここでは常にこちらを鍵にする。
    const item = buildWatchlistView(db).find((row) => row.domain === domain);
    return Response.json(item ?? { keyword, domain }, { status: 201 });
  } catch (cause) {
    console.error('[api/watchlist] POST failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Saving to the watchlist failed.' }, { status: 500 });
  }
}

/**
 * `DELETE /api/watchlist?domain=example.com`
 *
 * 無い行を消しても 200 と `removed:false` を返す（冪等）。連打や二重送信で 404 を出すと
 * 画面側が「消えたのに失敗表示」になるため、状態は `removed` で伝える。
 */
export async function DELETE(request: Request) {
  const raw = new URL(request.url).searchParams.get('domain') ?? '';
  const domain = normalizeDomain(raw);
  if (!domain) {
    return Response.json({ error: 'A domain query parameter is required.' }, { status: 400 });
  }

  try {
    return Response.json({ domain, removed: removeFromWatchlist(getDb(), domain) });
  } catch (cause) {
    console.error('[api/watchlist] DELETE failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Removing from the watchlist failed.' }, { status: 500 });
  }
}
