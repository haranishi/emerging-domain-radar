/**
 * `GET /api/domains/check?domains=a.com,b.com` — 手動ドメイン検索の唯一の入口
 * （契約は docs/03_architecture.md §8。返す形は `DomainReport` そのまま）。
 *
 * 20 件を超えた入力は切り詰めずに 400 で返す。黙って 20 件だけ判定すると
 * 「調べたはずのドメインが結果に無い」状態になり、調査ツールとして誤読を生むため。
 *
 * 判定・価格・日次予算の扱いはすべて `searchDomains` 側にある。ここは入力の受け取りと
 * 上限の検査だけで、環境変数・キー・DB のパスは応答に載せない（`error` は固定文言）。
 *
 * `dynamic = 'force-dynamic'`: RDAP・DNS・価格表を都度引くので応答をキャッシュさせない。
 * cacheComponents は無効なので Next 16 でもこの指定が有効（route-segment-config の
 * バージョン履歴のとおり、削除されるのは cacheComponents 有効時だけ）。
 */
import { getDb } from '@/lib/db/client';
import { MANUAL_SEARCH_LIMIT, searchDomains } from '@/lib/domain';

export const dynamic = 'force-dynamic';

/** 上限の検査用。正規化（小文字化・URL 剥がし・重複除去）は `searchDomains` が行う。 */
function splitInput(input: string): string[] {
  return input.split(/[\n,\s]+/).map((domain) => domain.trim()).filter(Boolean);
}

export async function GET(request: Request) {
  const input = new URL(request.url).searchParams.get('domains') ?? '';
  const domains = splitInput(input);

  if (domains.length === 0) {
    return Response.json({ error: 'At least one domain is required.' }, { status: 400 });
  }
  if (domains.length > MANUAL_SEARCH_LIMIT) {
    return Response.json({ error: `A maximum of ${MANUAL_SEARCH_LIMIT} domains is allowed.` }, { status: 400 });
  }

  try {
    const reports = await searchDomains(domains.join('\n'), { db: getDb() });
    return Response.json(reports);
  } catch (cause) {
    // 原因はサーバーログにだけ出す（応答に混ぜると経路や設定が漏れる）。
    console.error('[api/domains/check] failed:', cause instanceof Error ? cause.message : cause);
    return Response.json({ error: 'Domain check failed.' }, { status: 500 });
  }
}
