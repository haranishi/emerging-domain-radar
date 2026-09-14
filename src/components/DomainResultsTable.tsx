/**
 * ドメイン表（詳細ページのドメイン候補と `/search` の結果で共用）。
 *
 * 列は 02_ux_design.md §3.4 の「ドメイン候補表」に合わせ、`/search` でも同じ並びにする。
 * パイプラインしか持たない Domain Score / Generation rule は手動検索では `—` になる
 * （API 契約 03_architecture.md §8 に無い値を UI で作らない）。
 *
 * 日時・種別の整形をここに持っているのは `src/view/format.ts` を使えないため。
 * format.ts は `@/lib/domain` を import し、その先で env.ts と better-sqlite3 に届くので、
 * この表はクライアント部品の `DomainSearchForm` からも読まれるので、入れると境界を破る。
 *
 * 幅の設計（UI 採点 ラウンド 2 の最優先指摘＝右端が 1440px で切れていた）:
 *  - `table-layout: fixed` ＋ `<colgroup>` の百分率で列幅を固定する。auto レイアウトだと
 *    円換算や `porkbun-pricing-get` のような長い値が列を勝手に広げ、右端の
 *    Official sites と Watchlist を画面外へ押し出す。
 *  - `Availability source` は独立列をやめ、Availability バッジの下の小文字に統合した
 *    （列を 1 本減らして右端 2 列を 1440px の中へ入れるため）。
 *  - それでも狭い画面では横スクロールが要るので、DOMAIN 列を `position: sticky` で残す。
 */
import { AvailabilityBadge } from '@/components/AvailabilityBadge';
import { Price, type PriceFx } from '@/components/Price';
import { WatchlistButton } from '@/components/WatchlistButton';
import type { Availability, Premium } from '@/lib/db/types';
import type { OfficialLink } from '@/lib/domain/types';
import { premiumLabel } from '@/view/labels';

const TH = 'px-3 py-2 text-left align-bottom text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
const TD = 'px-3 py-3 align-top text-xs';
const ROW_BORDER = 'border-t border-zinc-200 dark:border-zinc-800';
/**
 * 横スクロール時に DOMAIN 列を残す。背景を敷かないと下の行が透けて重なり、
 * 右の罫線が無いと隣の列の切れ端（`/ yr` など）が地続きに見える。
 */
const STICKY_DOMAIN = 'sticky left-0 z-10 border-r border-zinc-200 bg-background dark:border-zinc-800';

/** 列幅（%）。合計 100。パイプライン列の有無で 2 通り持つ。 */
const PIPELINE_WIDTHS = ['14%', '8%', '9%', '9%', '7%', '6%', '9%', '8%', '7%', '10%', '13%'];
const SEARCH_WIDTHS = ['16%', '10%', '10%', '10%', '8%', '11%', '9%', '11%', '15%'];

const TABLE_SCROLL_NOTE = '→ 表は横スクロールします（右端に Official sites と Watchlist）。';

export interface DomainTableRow {
  domain: string;
  availability: Availability | null;
  availabilitySource: string | null;
  registrationPrice: number | null;
  renewalPrice: number | null;
  currency: string | null;
  premium: Premium | null;
  domainScore?: number | null;
  checkedAt: string | null;
  priceSource: string | null;
  generationRule?: string | null;
  officialLinks: OfficialLink[];
  notes?: string[];
}

interface WatchlistContext {
  keyword?: string;
  trendScore?: number;
  opportunityScore?: number;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '—';
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  return `${new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

/**
 * パイプライン由来の 2 列（Domain Score / Generation rule）を出すかどうか。
 *
 * 手動検索の行は API 契約（§8）にこの 2 つが無く、出しても全行 `—` になる。
 * 空の列で右端の Watchlist ボタンを画面外へ押し出さないよう、値を持ち得ない時は畳む。
 * 詳細ページの行（`DomainView`）はキー自体が必ず存在するので、null でも表示は変わらない。
 */
function hasPipelineColumns(rows: DomainTableRow[]): boolean {
  return rows.some((row) => row.domainScore !== undefined || row.generationRule !== undefined);
}

export function DomainResultsTable({
  rows,
  fx,
  watchlist = {},
  headingId,
}: {
  rows: DomainTableRow[];
  fx?: PriceFx | null;
  watchlist?: WatchlistContext;
  headingId?: string;
}) {
  const pipeline = hasPipelineColumns(rows);
  const widths = pipeline ? PIPELINE_WIDTHS : SEARCH_WIDTHS;
  const columnCount = widths.length;
  return (
    <>
      <div className="overflow-x-auto border-y border-zinc-200 dark:border-zinc-800">
        <table className={`w-full table-fixed border-collapse ${pipeline ? 'min-w-[62rem]' : 'min-w-[54rem]'}`}>
          <colgroup>
            {widths.map((width, index) => <col key={index} style={{ width }} />)}
          </colgroup>
          <thead>
            <tr>
              <th id={headingId} className={`${TH} ${STICKY_DOMAIN}`}>Domain</th>
              <th className={TH} title="RDAP / DNS の判定と、その根拠にしたソース">Availability</th>
              <th className={TH}>Registration</th>
              <th className={TH}>Renewal</th>
              <th className={TH}>Type</th>
              {pipeline ? <th className={`${TH} text-right`}>Domain Score</th> : null}
              <th className={TH}>Checked at</th>
              <th className={TH}>Price source</th>
              {pipeline ? <th className={TH}>Generation rule</th> : null}
              <th className={TH}>Official sites</th>
              <th className={TH}>Watchlist</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <DomainResultRow key={row.domain} row={row} fx={fx} watchlist={watchlist} pipeline={pipeline} columnCount={columnCount} first={index === 0} />
            ))}
          </tbody>
        </table>
      </div>
      {/* 列が多く狭い画面では右端が隠れる。Watchlist ボタンの在り処を文字で示す。 */}
      <p className="mt-2 text-[11px] leading-5 text-zinc-500 dark:text-zinc-400">{TABLE_SCROLL_NOTE}</p>
    </>
  );
}

function DomainResultRow({ row, fx, watchlist, pipeline, columnCount, first }: { row: DomainTableRow; fx?: PriceFx | null; watchlist: WatchlistContext; pipeline: boolean; columnCount: number; first: boolean }) {
  const notesId = row.notes?.length ? `notes-${row.domain.replace(/[^a-z0-9-]/gi, '-')}` : undefined;
  // 行の区切り線は tbody の divide-y ではなくセルの border-t で引く。sticky セルに背景を
  // 敷くと、border-collapse で tr に引いた線がその背景の下に隠れて途切れるため。
  const border = first ? '' : ROW_BORDER;
  const td = `${TD} ${border}`;
  return (
    <>
      <tr aria-describedby={notesId}>
        {/* th は既定で中央寄せなので、行見出しにも text-left を明示する（他の列と縦線を揃える）。 */}
        <th scope="row" className={`${td} ${STICKY_DOMAIN} break-all text-left font-mono text-sm font-semibold`} title={row.domain}>{row.domain}</th>
        <td className={td}>
          <AvailabilityBadge availability={row.availability} />
          <span className="mt-1 block font-mono text-[10px] leading-4 text-zinc-500 dark:text-zinc-400">{row.availabilitySource ?? '—'}</span>
        </td>
        <td className={td}><Price value={row.registrationPrice} currency={row.currency} fx={fx} /></td>
        <td className={td}><Price value={row.renewalPrice} currency={row.currency} fx={fx} /></td>
        <td className={td}><span className={row.premium === 'premium' ? 'rounded border border-amber-300 bg-amber-50 px-1.5 py-0.5 font-semibold text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200' : ''}>{premiumLabel(row.premium)}</span></td>
        {pipeline ? <td className={`${td} text-right font-mono font-semibold tabular-nums`}>{row.domainScore == null ? '—' : Math.round(row.domainScore)}</td> : null}
        <td className={`${td} font-mono tabular-nums`}>{formatDateTime(row.checkedAt)}</td>
        <td className={`${td} break-words`}>{row.priceSource ?? '—'}</td>
        {pipeline ? <td className={`${td} break-words font-mono`}>{row.generationRule ?? '—'}</td> : null}
        <td className={td}>
          <div className="flex flex-col gap-1">
            {row.officialLinks.map((link) => (
              /* 11px なのは `ICANN Lookup ↗` を列幅に収めて折り返さないため（12px だと 2 行になる）。 */
              <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="cursor-pointer whitespace-nowrap text-[11px] font-semibold text-blue-700 underline underline-offset-4 transition-colors hover:text-blue-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400 dark:hover:text-blue-300">{link.label} ↗</a>
            ))}
          </div>
        </td>
        <td className={td}>
          <WatchlistButton
            keyword={watchlist.keyword ?? row.domain}
            domain={row.domain}
            registrationPrice={row.registrationPrice}
            renewalPrice={row.renewalPrice}
            currency={row.currency}
            trendScore={watchlist.trendScore ?? 0}
            opportunityScore={watchlist.opportunityScore ?? 0}
          />
        </td>
      </tr>
      {row.notes?.length ? (
        <tr id={notesId}>
          <td colSpan={columnCount} className="px-3 pb-3 pt-0">
            <ul className="grid gap-1 text-[11px] leading-5 text-zinc-600 dark:text-zinc-400">
              {row.notes.map((note, index) => <li key={`${index}-${note}`}>Note: {note}</li>)}
            </ul>
          </td>
        </tr>
      ) : null}
    </>
  );
}
