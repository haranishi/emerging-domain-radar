'use client';

/**
 * 手動ドメイン検索のフォーム（`/search` の唯一のクライアント部品）。
 *
 * 判定そのものは `GET /api/domains/check` に任せる。DNS・RDAP・価格表・日次予算は
 * サーバー側の `searchDomains` だけが触る（キーや DB をブラウザに出さないため）。
 */
import { FormEvent, useMemo, useState } from 'react';
import { DomainResultsTable, type DomainTableRow } from '@/components/DomainResultsTable';
import type { PriceFx } from '@/components/Price';

/**
 * `MANUAL_SEARCH_LIMIT`（`@/lib/domain`）と同じ値。import しないのは、その先が
 * env.ts と better-sqlite3 に届いてクライアント境界を破るため（値は API 側でも検証する）。
 */
const MAX_DOMAINS = 20;

/** 件数の数え方をサーバーの `splitInput` と揃える（重複はサーバーで畳むので数えるのは生の件数）。 */
function entries(value: string): string[] {
  return value.split(/[\n,\s]+/).map((entry) => entry.trim()).filter(Boolean);
}

export function DomainSearchForm({ fx }: { fx?: PriceFx | null }) {
  const [input, setInput] = useState('');
  const [rows, setRows] = useState<DomainTableRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const count = useMemo(() => entries(input).length, [input]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (count === 0) {
      setError('Enter at least one domain.');
      return;
    }
    if (count > MAX_DOMAINS) {
      setError(`You can check up to ${MAX_DOMAINS} domains at once.`);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      // 同一オリジンの自 API だけを叩く（外部 HTTP は src/lib/http.ts の仕事）。
      // no-purchase-guard は宛先が相対パスなら GET 以外も通すので、素直に書く。
      const response = await fetch(`/api/domains/check?domains=${encodeURIComponent(input)}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
      });
      const body: unknown = await response.json();
      if (!response.ok) {
        const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string'
          ? body.error
          : `Domain check failed (${response.status}).`;
        throw new Error(message);
      }
      if (!Array.isArray(body)) throw new Error('The domain check returned an invalid response.');
      setRows(body as DomainTableRow[]);
    } catch (cause) {
      setRows([]);
      setError(cause instanceof Error ? cause.message : 'Domain check failed.');
    } finally {
      setLoading(false);
    }
  }

  const countError = count > MAX_DOMAINS ? `You can check up to ${MAX_DOMAINS} domains at once.` : null;

  return (
    <div>
      <form onSubmit={submit} className="border-y border-zinc-200 py-5 dark:border-zinc-800">
        <div className="flex items-end justify-between gap-4">
          <label htmlFor="domains" className="text-sm font-semibold">Domains</label>
          <span className={`font-mono text-xs tabular-nums ${countError ? 'text-red-700 dark:text-red-300' : 'text-zinc-500 dark:text-zinc-400'}`}>{count} / {MAX_DOMAINS}</span>
        </div>
        <p id="domains-help" className="mt-1 text-xs leading-5 text-zinc-600 dark:text-zinc-400">Separate domains with commas or new lines. Example: <code className="font-mono">syntheticmemory.com</code></p>
        <textarea
          id="domains"
          name="domains"
          value={input}
          onChange={(event) => {
            setInput(event.target.value);
            setError(null);
          }}
          rows={5}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-describedby="domains-help domain-error"
          aria-invalid={Boolean(countError || error)}
          placeholder={'syntheticmemory.com\nexample.com'}
          className="mt-3 block w-full resize-y rounded-md border border-zinc-300 bg-white px-3 py-3 font-mono text-base leading-6 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-600/25 dark:border-zinc-700 dark:bg-zinc-950 dark:placeholder:text-zinc-600"
        />
        <div className="mt-3 flex min-h-11 flex-col gap-2 sm:flex-row sm:items-center">
          <button type="submit" disabled={loading || count === 0 || Boolean(countError)} className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-md bg-blue-700 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 disabled:cursor-default disabled:opacity-50 dark:bg-blue-600 dark:hover:bg-blue-500 dark:focus-visible:ring-offset-zinc-950">
            {loading ? 'Checking…' : 'Check domains'}
          </button>
          <p id="domain-error" role="alert" className="text-sm text-red-700 dark:text-red-300">{countError ?? error}</p>
        </div>
      </form>

      <section className="mt-7" aria-labelledby="results-heading" aria-busy={loading}>
        <div className="mb-3 flex items-end justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Live lookup</p>
            <h2 id="results-heading" className="mt-1 text-xl font-semibold tracking-tight">Results</h2>
          </div>
          {rows.length ? <p className="font-mono text-xs text-zinc-500 dark:text-zinc-400">{rows.length} domains</p> : null}
        </div>
        {rows.length ? (
          /* 横スクロールの注記は表と一緒に DomainResultsTable が出す（詳細ページと同じ文言）。 */
          <DomainResultsTable rows={rows} fx={fx} headingId="results-domain-heading" />
        ) : (
          <div className="flex min-h-28 items-center justify-center border border-dashed border-zinc-300 px-4 text-center text-sm text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
            {loading ? 'Checking availability and pricing…' : 'Enter domains above to see availability and pricing.'}
          </div>
        )}
      </section>
    </div>
  );
}
