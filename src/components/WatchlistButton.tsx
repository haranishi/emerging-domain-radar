'use client';

import { useState } from 'react';

interface WatchlistButtonProps {
  keyword: string;
  domain: string;
  registrationPrice: number | null;
  renewalPrice: number | null;
  currency: string | null;
  trendScore: number;
  opportunityScore: number;
}

type RequestState = 'idle' | 'saving' | 'saved' | 'error';

export function WatchlistButton(props: WatchlistButtonProps) {
  const [state, setState] = useState<RequestState>('idle');

  async function add() {
    setState('saving');
    try {
      const response = await fetch('/api/watchlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          keyword: props.keyword,
          domain: props.domain,
          registrationPrice: props.registrationPrice,
          renewalPrice: props.renewalPrice,
          currency: props.currency,
          trendScore: props.trendScore,
          opportunityScore: props.opportunityScore,
        }),
      });
      if (!response.ok) throw new Error(`Watchlist request failed: ${response.status}`);
      setState('saved');
    } catch {
      setState('error');
    }
  }

  const label = state === 'saving' ? 'Adding…' : state === 'saved' ? 'Added' : 'Add to Watchlist';

  return (
    <div className="w-full min-w-0">
      <button
        type="button"
        onClick={add}
        disabled={state === 'saving' || state === 'saved'}
        className="min-h-11 w-full cursor-pointer rounded-md border border-zinc-300 px-2 py-2 text-xs font-semibold transition-colors hover:border-blue-500 hover:bg-blue-50 hover:text-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 disabled:cursor-default disabled:opacity-60 dark:border-zinc-700 dark:hover:border-blue-500 dark:hover:bg-blue-950 dark:hover:text-blue-200"
      >
        {label}
      </button>
      {state === 'error' ? <p role="status" className="mt-1 text-[10px] leading-4 text-red-700 dark:text-red-300">Watchlist API is not available yet.</p> : null}
      {state === 'saved' ? <p role="status" className="mt-1 text-[10px] leading-4 text-emerald-700 dark:text-emerald-300">Saved to Watchlist.</p> : null}
    </div>
  );
}
