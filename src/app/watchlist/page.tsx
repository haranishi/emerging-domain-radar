/**
 * Watchlist（US6・02_ux_design.md §3.4「Watchlist」）。
 *
 * 表示だけを行うサーバーコンポーネント。開いても空き判定・価格取得は走らせない
 * （訪問だけで RDAP の日次予算を消費しないため）。「現在価格」は最新の `domain_checks` で、
 * 追加後まだ再確認されていない行は発見時価格を出して「未再確認」と明示する。
 *
 * 円換算はページ上部に 1 回だけ出し、表の中では現在価格にだけ添える。発見時価格は
 * 過去に取った USD の記録なので、今日のレートで換算すると別の時点の値が混ざる。
 */
import Link from 'next/link';
import { AvailabilityBadge } from '@/components/AvailabilityBadge';
import { Price } from '@/components/Price';
import { WatchlistDeleteButton } from '@/components/WatchlistDeleteButton';
import { getUsdJpyCached } from '@/lib/fx/frankfurter';
import { EM_DASH, formatDate, formatDateTime, formatDiff, formatScore } from '@/view/format';
import { premiumLabel } from '@/view/labels';
import { buildWatchlistView, comparableRegistrationPrices, type WatchlistItem } from '@/view/watchlist';
import { openDb } from '@/view/server';

const TH = 'px-3 py-2 text-left align-bottom text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
const TD = 'px-3 py-3 align-top text-xs';
const ROW_BORDER = 'border-t border-zinc-200 dark:border-zinc-800';
/**
 * 列幅（%）。合計 100。`table-layout: fixed` と組で使う。
 *
 * auto レイアウトだと Current price の円換算が列を押し広げ、右端の Remove ボタンが
 * 1440px でも半分切れていた（UI 採点 ラウンド 2 の指摘）。狭い画面では横スクロールが
 * 要るので、REMOVE 列は `position: sticky` で右端に残す。
 */
const WIDTHS = ['13%', '17%', '9%', '10%', '18%', '7%', '6%', '8%', '12%'];
const COLUMN_COUNT = WIDTHS.length;
/**
 * 横スクロール時に REMOVE 列を残す。背景を敷かないと下の行が透け、
 * 左の罫線が無いと隣の列の見出しが途中で切れただけのように見える。
 */
const STICKY_REMOVE = 'sticky right-0 z-10 border-l border-zinc-200 bg-background dark:border-zinc-800';

/** 値上がり＝琥珀、値下がり＝緑。判断ではなく「動いた向き」だけを示す。 */
function diffClass(text: string): string {
  if (text.startsWith('+')) return 'text-amber-700 dark:text-amber-300';
  if (text.startsWith('-')) return 'text-emerald-700 dark:text-emerald-300';
  return 'text-zinc-600 dark:text-zinc-400';
}

function HistoryRow({ item }: { item: WatchlistItem }) {
  return (
    <tr>
      <td colSpan={COLUMN_COUNT} className="px-3 pb-3 pt-0">
        <details className="text-[11px] leading-5 text-zinc-600 dark:text-zinc-400">
          <summary className="cursor-pointer font-semibold text-zinc-700 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-zinc-300">
            {item.history.length > 0 ? `Price history (${item.history.length})` : 'Note'}
          </summary>
          <div className="mt-2 grid gap-3">
            {item.note ? <p className="max-w-3xl whitespace-normal">Note: {item.note}</p> : null}
            {item.history.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[36rem] border-collapse">
                  <thead>
                    <tr>
                      <th className={TH}>Checked at</th>
                      <th className={TH}>Registration</th>
                      <th className={TH}>Renewal</th>
                      <th className={TH}>Availability</th>
                      <th className={TH}>Type</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                    {item.history.map((point, index) => (
                      <tr key={`${point.checkedAt}-${index}`}>
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono tabular-nums">{formatDateTime(point.checkedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5"><Price value={point.registrationPrice} currency={item.foundCurrency} showJpy={false} /></td>
                        <td className="whitespace-nowrap px-3 py-1.5"><Price value={point.renewalPrice} currency={item.foundCurrency} showJpy={false} /></td>
                        <td className="whitespace-nowrap px-3 py-1.5"><AvailabilityBadge availability={point.availability} /></td>
                        <td className="whitespace-nowrap px-3 py-1.5">{premiumLabel(point.premium)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            {item.current ? <p>Price source: {item.current.priceSource ?? EM_DASH}</p> : null}
          </div>
        </details>
      </td>
    </tr>
  );
}

function WatchlistTableRow({ item, fx, first }: { item: WatchlistItem; fx: Parameters<typeof Price>[0]['fx']; first: boolean }) {
  const comparable = comparableRegistrationPrices(item);
  const diff = formatDiff(comparable.current, comparable.found);
  // 区切り線は tbody の divide-y ではなくセルの border-t で引く。sticky セルに背景を
  // 敷くと、border-collapse で tr に引いた線がその背景の下で途切れるため。
  const td = `${TD} ${first ? '' : ROW_BORDER}`;
  return (
    <>
      <tr>
        <td className={td}>
          {item.keywordSlug ? (
            <Link href={`/keywords/${item.keywordSlug}`} className="cursor-pointer font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400">{item.keyword}</Link>
          ) : (
            <span className="font-semibold">{item.keyword}</span>
          )}
        </td>
        <th scope="row" className={`${td} break-all text-left font-mono text-sm font-semibold`} title={item.domain}>{item.domain}</th>
        <td className={`${td} whitespace-nowrap font-mono tabular-nums`}>{formatDate(item.addedAt)}</td>
        <td className={td}><Price value={item.foundRegistrationPrice} currency={item.foundCurrency} showJpy={false} /></td>
        <td className={td}>
          {item.current ? (
            <>
              <Price value={item.current.registrationPrice} currency={item.current.currency} fx={fx} />
              <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                <AvailabilityBadge availability={item.current.availability} />
                <span className="whitespace-nowrap font-mono text-[10px] text-zinc-500 dark:text-zinc-400">{formatDateTime(item.current.checkedAt)}</span>
              </span>
            </>
          ) : (
            <>
              <Price value={item.foundRegistrationPrice} currency={item.foundCurrency} showJpy={false} />
              <span className="mt-1 block text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">未再確認（発見時の価格を表示しています）</span>
            </>
          )}
        </td>
        <td className={`${td} whitespace-nowrap font-mono font-semibold tabular-nums ${diffClass(diff)}`}>{diff}</td>
        <td className={`${td} font-mono tabular-nums`}>{formatScore(item.trendScore)}</td>
        <td className={`${td} font-mono tabular-nums`}>{formatScore(item.opportunityScore)}</td>
        <td className={`${td} ${STICKY_REMOVE}`}><WatchlistDeleteButton domain={item.domain} /></td>
      </tr>
      {item.history.length > 0 || item.note ? <HistoryRow item={item} /> : null}
    </>
  );
}

export default async function WatchlistPage() {
  const db = await openDb();
  const items = buildWatchlistView(db);
  const fx = await getUsdJpyCached(db);
  // クライアント部品にも渡る形にそろえる（providers 等は RSC ペイロードに載せない）。
  const priceFx = fx.rate === null
    ? null
    : { rate: fx.rate, source: fx.source, fetchedAt: fx.fetchedAt, disclaimer: fx.disclaimer };

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-end sm:justify-between dark:border-zinc-800">
        <div>
          <p className="mb-1 text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Saved candidates</p>
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Watchlist</h1>
          <p className="mt-3 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">発見時の価格と、最後に確認した価格を並べます。保存先はローカルの DB だけです。</p>
        </div>
        <dl className="grid grid-cols-1 gap-y-1 text-sm sm:text-right">
          <div><dt className="text-xs text-zinc-500 dark:text-zinc-400">Saved</dt><dd data-testid="watchlist-count" className="mt-0.5 font-mono font-semibold tabular-nums">{items.length}</dd></div>
        </dl>
      </header>

      {priceFx !== null && priceFx.rate !== null ? (
        <p className="mb-4 text-xs text-zinc-500 dark:text-zinc-400">USD/JPY {priceFx.rate.toFixed(2)}（{priceFx.disclaimer}・{priceFx.source?.startsWith('Frankfurter v2') ? 'Frankfurter v2' : priceFx.source}・取得 {formatDateTime(priceFx.fetchedAt)}）</p>
      ) : null}

      {items.length > 0 ? (
        <>
          <div className="overflow-x-auto border-y border-zinc-200 dark:border-zinc-800">
            <table className="w-full min-w-[64rem] table-fixed border-collapse">
              <caption className="sr-only">Saved keywords and .com candidates with the price at the time they were found and the latest checked price</caption>
              <colgroup>{WIDTHS.map((width, index) => <col key={index} style={{ width }} />)}</colgroup>
              <thead>
                <tr>
                  <th className={TH}>Keyword</th>
                  <th className={TH}>Domain</th>
                  <th className={TH}>Added</th>
                  <th className={TH}>Price when found</th>
                  <th className={TH}>Current price</th>
                  <th className={TH}>Diff</th>
                  <th className={`${TH} text-right`}>Trend</th>
                  <th className={`${TH} text-right`}>Opportunity</th>
                  <th className={`${TH} ${STICKY_REMOVE}`}>Remove</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, index) => <WatchlistTableRow key={item.id} item={item} fx={priceFx} first={index === 0} />)}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">→ 表は横スクロールします（右端に Remove）。</p>
          <p className="mt-3 max-w-4xl text-xs leading-5 text-zinc-600 dark:text-zinc-400">
            現在価格は最後に記録された確認結果です（<code className="font-mono">npm run check:domains -- &lt;domain&gt;</code> か <code className="font-mono">npm run radar:collect</code> で更新されます）。価格・円換算は参考値で、空き表示は確定ではありません。
          </p>
        </>
      ) : (
        <section className="mt-8 border border-dashed border-zinc-300 p-8 text-center dark:border-zinc-700">
          <h2 className="text-lg font-semibold">No saved candidates</h2>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            キーワード詳細ページや <Link href="/search" className="cursor-pointer font-semibold text-blue-700 underline underline-offset-4 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400">Search</Link> の「Add to Watchlist」から追加してください。
          </p>
        </section>
      )}
    </div>
  );
}
