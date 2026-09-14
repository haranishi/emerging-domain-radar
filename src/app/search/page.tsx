/**
 * 手動ドメイン検索（US4・02_ux_design.md §3.4「Search」）。
 *
 * 判定はユーザーの操作でしか走らせない。ページ表示だけで DNS・RDAP を叩くと
 * RDAP の日次予算（既定 300 件）を訪問だけで食い潰すため、サーバー側でやるのは
 * 為替の取得だけにしてある。
 */
import { DomainSearchForm } from '@/components/DomainSearchForm';
import { TRADEMARK_REQUIRED_NOTE } from '@/lib/domain/types';
import { getUsdJpyCached } from '@/lib/fx/frankfurter';
import { formatDateTime } from '@/view/format';
import { openDb } from '@/view/server';

export default async function SearchPage() {
  const db = await openDb();
  const fx = await getUsdJpyCached(db);
  // クライアントへ渡すのは表示に使う 4 項目だけ（providers 等は RSC ペイロードに載せない）。
  const priceFx = fx.rate === null
    ? null
    : { rate: fx.rate, source: fx.source, fetchedAt: fx.fetchedAt, disclaimer: fx.disclaimer };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 max-w-3xl">
        <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Manual research</p>
        <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Domain Search</h1>
        <p className="mt-3 text-sm leading-6 text-zinc-600 dark:text-zinc-400">複数のドメインをまとめて確認できます。.com 以外は MVP の判定対象外です。</p>
      </header>

      <aside className="mb-6 border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-xs leading-5 text-zinc-700 dark:border-amber-700 dark:bg-amber-950/30 dark:text-zinc-300" aria-label="Research disclaimers">
        <p>RDAP の 404 は空きの候補であり、予約語・ブロック名を含む可能性があるため確定ではありません。価格と円換算は参考値です。</p>
        <p className="mt-1 font-semibold text-amber-900 dark:text-amber-200">{TRADEMARK_REQUIRED_NOTE}</p>
      </aside>

      {priceFx !== null ? (
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">USD/JPY {priceFx.rate.toFixed(2)}（{priceFx.disclaimer}・{priceFx.source?.startsWith('Frankfurter v2') ? 'Frankfurter v2' : priceFx.source}・取得 {formatDateTime(priceFx.fetchedAt)}）</p>
      ) : null}

      <DomainSearchForm fx={priceFx} />
    </div>
  );
}
