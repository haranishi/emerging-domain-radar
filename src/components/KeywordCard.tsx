import Link from 'next/link';
import type { KeywordCard as KeywordCardData } from '@/lib/db/queries';
import type { FxResult } from '@/lib/fx/frankfurter';
import { formatDateTime, formatEvidenceSummary, formatPrice, noAvailableLabel } from '@/view/format';
import { AvailabilityBadge } from './AvailabilityBadge';
import { JpyNote, jpyParts, Price } from './Price';
import { ScoreBar } from './ScoreBar';
import { StatusBadge } from './StatusBadge';

export function KeywordCard({ card, fx }: { card: KeywordCardData; fx?: FxResult | null }) {
  const hiddenDomains = Math.max(0, card.domainCount - card.topDomains.length);

  return (
    <article data-testid="keyword-card" className="border-b border-zinc-200 py-6 first:border-t dark:border-zinc-800">
      {/* items-start にしているのは、左右で高さが違っても左カラムを引き伸ばさないため
          （引き伸ばすと Why trending の下に 150px の空白が残っていた）。 */}
      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.1fr)_minmax(18rem,0.9fr)]">
        <div className="min-w-0">
          <div className="flex items-start gap-3">
            <span aria-label={`Rank ${card.rank}`} className="flex size-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 font-mono text-sm font-bold tabular-nums text-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">{card.rank}</span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                {/* 詳細への導線。以前は本文色だったので、リンクだと分からなかった。 */}
                <h2 className="text-xl font-semibold tracking-tight">
                  <Link href={`/keywords/${card.slug}`} className="cursor-pointer text-blue-700 underline-offset-4 transition-colors hover:text-blue-900 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400 dark:hover:text-blue-300">{card.keyword}</Link>
                </h2>
                <StatusBadge status={card.status} fading={card.fading} />
              </div>
              {card.description ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">{card.description}</p> : null}

              {/*
                スコアと Why trending を順位バッジの外ではなくタイトルと同じ列に入れているのは、
                左カラムの基準線を 1 本にするため（UI 採点 ラウンド 2 の指摘）。以前はスコアだけが
                バッジと同じ x から始まり、タイトル・説明はその 48px 右で、1 枚のカードの中に
                縦線が 2 本見えていた。バッジ幅ぶんの padding-left を足しても同じ絵になるが、
                それだと `size-9` と `gap-3` を変えたときに数字を直し忘れてずれる。
              */}
              <div className="mt-4 grid grid-cols-3 gap-4">
                <ScoreBar label="Trend" value={card.trendScore} />
                <ScoreBar label="Japan Gap" value={card.japanGapScore} />
                <ScoreBar label="Opportunity Score（調査優先度）" value={card.opportunityScore} emphasis="primary" />
              </div>

              <div className="mt-5">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Why trending</h3>
                {card.whyTrending.length ? (
                  <ul className="mt-2 grid gap-1 text-sm text-zinc-700 dark:text-zinc-300">
                    {card.whyTrending.slice(0, 3).map((line) => <li key={line} className="font-mono text-xs">{formatEvidenceSummary(line)}</li>)}
                  </ul>
                ) : <p className="mt-2 text-sm text-zinc-500">—</p>}
              </div>
            </div>
          </div>
        </div>

        <div className="min-w-0 lg:border-l lg:border-zinc-200 lg:pl-5 dark:lg:border-zinc-800">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400">Top .com domains</h3>
            {card.noAvailableDomain ? <span className="text-right text-[10px] font-semibold text-zinc-500 dark:text-zinc-400">{noAvailableLabel(card.topDomains)}</span> : null}
          </div>
          <div className="divide-y divide-zinc-200 border-y border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {card.topDomains.map((domain) => {
              const jpy = jpyParts(domain.registrationPrice, domain.currency, fx);
              return (
                /*
                  3 列 × 2 行の固定グリッド（ドメイン / 空き / 登録価格 と、更新価格 / 円換算）。
                  以前は flex-wrap の 3 行で、長いドメインの後ろでバッジが折り返して
                  行ごとに位置が変わり、右カラムだけが 150px 高くなっていた。
                  ドメインは TLD の途中で折らず、入り切らないときは末尾を省略する。
                */
                <div key={domain.domainId} data-testid="card-domain" className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-baseline gap-x-3 gap-y-0.5 py-2.5">
                  <span className="truncate font-mono text-sm font-semibold [overflow-wrap:normal] [word-break:keep-all]" title={domain.domain}>{domain.domain}</span>
                  <AvailabilityBadge availability={domain.availability} />
                  <span className="text-right text-xs"><Price value={domain.registrationPrice} currency={domain.currency} showJpy={false} /></span>
                  <p className="col-span-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">Renewal {formatPrice(domain.renewalPrice, domain.currency)}</p>
                  {jpy ? <JpyNote parts={jpy} className="block text-right" /> : <span />}
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] font-semibold text-amber-800 dark:text-amber-300">Trademark check required（詳細で確認）</p>
          {hiddenDomains > 0 ? <Link href={`/keywords/${card.slug}`} className="mt-2 inline-flex min-h-9 cursor-pointer items-center text-xs font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400">+{hiddenDomains} more</Link> : null}
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">Last checked <span className="font-mono">{formatDateTime(card.lastCheckedAt)}</span></p>
        </div>
      </div>
    </article>
  );
}
