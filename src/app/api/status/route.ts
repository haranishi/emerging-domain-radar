/**
 * `GET /api/status` — 最新ランの状態。「いつのデータを見ているのか」を機械可読で返す口。
 *
 * 返す形: `{ id, started_at, finished_at, status, stats }`（`stats` は `stats_json` をパース）。
 * 列名をそのまま使うのは、これがランの行そのものの写しだから。
 *
 * 見るのは `getLatestRun`（`getDashboardRun` の「最新完了ラン」ではない）。
 * このエンドポイントの用途は進行中・失敗も含めた現状確認で、`running` や `failed` を
 * 隠すと「収集が動いているのか」を外から確かめられなくなる。ランが 1 つも無ければ全項目 null。
 *
 * **DB のパスは返さない。** ファイルの場所は秘密の扱いにする（architecture §9）。
 * `stats` に入るのは件数・所要時間・ホスト別呼び出し数だけで、パスもキーも含まない
 * （`CollectStats` と `HttpStats` の定義を参照）。
 *
 * `dynamic = 'force-dynamic'`: 都度 DB を読むので応答をキャッシュさせない。
 */
import { getDb } from '@/lib/db/client';
import { getLatestRun } from '@/lib/db/repos';

export const dynamic = 'force-dynamic';

/** 壊れた JSON でルート全体を 500 にしない（ランの他の項目は返せる）。 */
function parseStats(statsJson: string | null): unknown {
  if (!statsJson) return null;
  try {
    return JSON.parse(statsJson);
  } catch {
    return null;
  }
}

export async function GET() {
  try {
    const run = getLatestRun(getDb());
    return Response.json({
      id: run?.id ?? null,
      started_at: run?.started_at ?? null,
      finished_at: run?.finished_at ?? null,
      status: run?.status ?? null,
      stats: parseStats(run?.stats_json ?? null),
    });
  } catch (cause) {
    console.error('[api/status] failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Reading the run status failed.' }, { status: 500 });
  }
}
