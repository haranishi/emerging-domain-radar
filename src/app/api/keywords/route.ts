/**
 * `GET /api/keywords?status=&available=1&maxPrice=&minTrend=&minOpportunity=&excludePremium=1&maxLength=&sources=hn,github`
 * — 最新完了ランのキーワード一覧（契約は docs/03_architecture.md §8）。
 *
 * 画面はこの API を fetch しない（サーバーコンポーネントが `db/queries.ts` を直接読む）。
 * ここは外から中身を確かめるための読み出し口で、CLI・E2E・手元の curl が想定利用者。
 *
 * 返すのは `KeywordCard[]` そのまま（ラップしない）。どのランの一覧かは `/api/status` で引ける。
 * 完了ランが無いときは 404 ではなく空配列 + 200 で返す。「まだ収集していない」は
 * エラーではなく空状態で、画面側も同じ扱いにしているため（architecture §8 の空状態）。
 *
 * フィルターの解釈は `parseKeywordFilters` に寄せる。ここで独自に解釈すると
 * URL クエリの意味が画面と API で分かれる。未知のキー・不正な値は同関数が黙って捨てる。
 *
 * `dynamic = 'force-dynamic'`: 都度 DB を読むので応答をキャッシュさせない
 * （cacheComponents は無効なので Next 16 でもこの指定が効く）。
 */
import { getDb } from '@/lib/db/client';
import { getDashboardRun, listKeywordCards, parseKeywordFilters } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const db = getDb();
    const run = getDashboardRun(db);
    if (!run) return Response.json([]);
    return Response.json(listKeywordCards(db, run.id, parseKeywordFilters(params)));
  } catch (cause) {
    // 原因はサーバーログにだけ出す（応答に混ぜると DB の場所や設定が漏れる）。
    console.error('[api/keywords] failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Reading keywords failed.' }, { status: 500 });
  }
}
