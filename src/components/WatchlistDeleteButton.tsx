'use client';

/**
 * Watchlist の 1 行を消すボタン（`/watchlist` の唯一のクライアント部品）。
 *
 * 消すのは自分の DB の行だけ。レジストラ側には何も送らない。
 * 削除後は `router.refresh()` でサーバーコンポーネントを再取得する（行の見た目を
 * クライアント state で先に消すと、DB の実際の状態とずれた表を見せることになる）。
 */
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

type RequestState = 'idle' | 'deleting' | 'error';

export function WatchlistDeleteButton({ domain }: { domain: string }) {
  const router = useRouter();
  const [state, setState] = useState<RequestState>('idle');
  const [pending, startTransition] = useTransition();

  async function remove() {
    setState('deleting');
    try {
      const response = await fetch(`/api/watchlist?domain=${encodeURIComponent(domain)}`, {
        method: 'DELETE',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`Watchlist delete failed: ${response.status}`);
      startTransition(() => {
        router.refresh();
      });
      setState('idle');
    } catch {
      setState('error');
    }
  }

  const busy = state === 'deleting' || pending;

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        onClick={remove}
        disabled={busy}
        aria-label={`Remove ${domain} from the watchlist`}
        className="min-h-11 w-full cursor-pointer whitespace-nowrap rounded-md border border-zinc-300 px-3 py-2 text-xs font-semibold transition-colors hover:border-red-500 hover:bg-red-50 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 disabled:cursor-default disabled:opacity-60 dark:border-zinc-700 dark:hover:border-red-500 dark:hover:bg-red-950 dark:hover:text-red-200"
      >
        {busy ? 'Removing…' : 'Remove'}
      </button>
      {state === 'error' ? (
        <p role="status" className="mt-1 text-[10px] leading-4 text-red-700 dark:text-red-300">削除できませんでした。時間をおいて再試行してください。</p>
      ) : null}
    </div>
  );
}
