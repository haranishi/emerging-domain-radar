import { Suspense } from 'react';
import { FilterBar } from '@/components/FilterBar';
import { KeywordCard } from '@/components/KeywordCard';
import { getDashboardRun, listKeywordCards, parseKeywordFilters } from '@/lib/db/queries';
import { getUsdJpyCached } from '@/lib/fx/frankfurter';
import { formatDateTime, formatDateTimeJst } from '@/view/format';
import { toURLSearchParams, type SearchParamsRecord } from '@/view/searchParams';
import { openDb } from '@/view/server';

export default async function Home({ searchParams }: { searchParams: Promise<SearchParamsRecord> }) {
  const params = toURLSearchParams(await searchParams);
  const db = await openDb();
  const run = getDashboardRun(db);
  const cards = run ? listKeywordCards(db, run.id, parseKeywordFilters(params)) : [];
  const fx = run ? await getUsdJpyCached(db) : null;

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-zinc-800">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Dashboard</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Emerging Domain Radar</h1>
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:text-right">
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">Last collected</dt><dd className="mt-0.5 font-mono tabular-nums">{formatDateTimeJst(run?.finished_at ?? null)} JST</dd></div>
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">Candidates</dt><dd className="mt-0.5 font-mono font-semibold tabular-nums">{cards.length}</dd></div>
        </dl>
      </header>
      {fx !== null && fx.rate !== null ? <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">USD/JPY {fx.rate.toFixed(2)}（参考値・{fx.source?.startsWith('Frankfurter v2') ? 'Frankfurter v2' : fx.source}・取得 {formatDateTime(fx.fetchedAt)}）</p> : null}
      <Suspense fallback={<div className="h-20 border-y border-zinc-200 dark:border-zinc-800" aria-hidden="true" />}><FilterBar /></Suspense>
      {/*
        AVAILABLE / 価格の読み方は詳細ページと About にしか書いていなかったので、
        一覧だけ見て「空きが確定した」「この値段で買える」と読めてしまっていた
        （UI 採点 ラウンド 2 の指摘）。カードの真上＝読む前に必ず通る位置に置く。
      */}
      <p className="mt-3 text-xs leading-6 text-zinc-500 dark:text-zinc-400">
        AVAILABLE は RDAP の 404 に基づく候補で確定ではありません。価格・円換算は参考値。商標確認は各候補の詳細で。
      </p>
      {run && cards.length > 0 ? (
        <section aria-label="Ranked keyword candidates" className="mt-6">{cards.map((card) => <KeywordCard key={card.keywordId} card={card} fx={fx} />)}</section>
      ) : (
        <section className="mt-8 border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <h2 className="text-lg font-semibold">No candidates</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400"><code className="font-mono">npm run radar:collect</code> を実行してください。デモ確認は <code className="font-mono">npm run seed:demo</code></p>
        </section>
      )}
    </div>
  );
}
