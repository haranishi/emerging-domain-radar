/**
 * `GET /api/fx` — USD/JPY の参考レート（契約は docs/03_architecture.md §8）。
 *
 * 返す形: `{ rate, asOf, source, ecbDate, fetchedAt, attribution }`。
 * 両方の提供元が失敗したときは `rate: null` で 200（UI は USD だけ出す）。
 * ここを 500 にすると「為替が取れない」だけで画面が壊れるが、円換算は参考値であって
 * 主データではないため、取れないことは正常な結果として扱う。
 *
 * `attribution` は契約の 5 項目に無いが返す。予備の open.er-api.com は
 * 帰属表示を条件に無償提供されているので、レートを配る口は帰属文も一緒に配る必要がある
 * （Frankfurter 由来のときは null）。
 *
 * DB を渡すのは 24 時間キャッシュのため。毎リクエストで外部を叩くと、
 * 画面の再読み込みだけで提供元へ無駄な負荷をかける。
 *
 * `dynamic = 'force-dynamic'`: キャッシュの鮮度は DB 側で見るので、
 * ルート側の応答をキャッシュさせない。
 */
import { getDb } from '@/lib/db/client';
import { getUsdJpyCached } from '@/lib/fx/frankfurter';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const fx = await getUsdJpyCached(getDb());
    return Response.json({
      rate: fx.rate,
      asOf: fx.asOf,
      source: fx.source,
      ecbDate: fx.ecbDate,
      fetchedAt: fx.fetchedAt,
      attribution: fx.attribution,
    });
  } catch (cause) {
    console.error('[api/fx] failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Reading the exchange rate failed.' }, { status: 500 });
  }
}
