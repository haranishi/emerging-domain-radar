/**
 * `GET /api/keywords/<slug>` — キーワード詳細（`KeywordDetail` をそのまま JSON で）。
 *
 * 詳細画面（`/keywords/[slug]`）が使うのと同じ `getKeywordDetail` を通す。
 * 画面と API で別のクエリを書くと、Evidence の件数や Opportunity の内訳が
 * 「画面で見た値と API で取れる値が違う」状態になるため、入口は 1 つに保つ。
 *
 * 無い slug は 404。`getKeywordDetail` は「slug が無い」「完了ランが無い」
 * 「そのランにスコアが無い」のいずれでも undefined を返すので、区別せず 404 にする
 * （どれだったかを応答で言い分けると、DB の状態を外に説明することになる）。
 *
 * Next.js 16 の Route Handler は第 2 引数の `params` が Promise なので await する
 * （node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md）。
 *
 * `dynamic = 'force-dynamic'`: 都度 DB を読むので応答をキャッシュさせない。
 */
import { getDb } from '@/lib/db/client';
import { getKeywordDetail } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  try {
    const detail = getKeywordDetail(getDb(), slug);
    if (!detail) return Response.json({ error: 'Keyword not found.' }, { status: 404 });
    return Response.json(detail);
  } catch (cause) {
    console.error('[api/keywords/[slug]] failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Reading the keyword failed.' }, { status: 500 });
  }
}
