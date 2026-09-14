import type { Status } from '@/lib/db/types';

const STATUS_STYLES: Record<Status, string> = {
  Early: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  Emerging: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  Rising: 'border-blue-300 bg-blue-50 text-blue-800 dark:border-blue-800 dark:bg-blue-950 dark:text-blue-200',
  Trending: 'border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950 dark:text-amber-200',
  Mainstream: 'border-slate-300 bg-slate-100 text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200',
};

export function StatusBadge({ status, fading = false }: { status: Status; fading?: boolean }) {
  return (
    <span data-testid="status-badge" className="inline-flex items-center gap-1.5">
      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${STATUS_STYLES[status]}`}>{status}</span>
      {/* `FADING` だけでは意味が伝わらないので日本語を添える（30 日で 3 割以上減った状態）。 */}
      {fading ? <span title="直近 30 日の言及が前 30 日から 3 割以上減っている（ピークを過ぎている可能性）" className="whitespace-nowrap rounded border border-violet-300 bg-violet-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-violet-700 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200">FADING（勢いが減衰）</span> : null}
    </span>
  );
}
