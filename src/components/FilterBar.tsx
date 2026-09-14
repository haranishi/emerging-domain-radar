'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import type { SourceId, Status } from '@/lib/db/types';

const STATUSES: Status[] = ['Early', 'Emerging', 'Rising', 'Trending', 'Mainstream'];
const SOURCES: { id: SourceId; label: string }[] = [
  { id: 'hn', label: 'HN' },
  { id: 'github', label: 'GitHub' },
  { id: 'arxiv', label: 'arXiv' },
  { id: 'openalex', label: 'OpenAlex' },
  { id: 'qiita', label: 'Qiita' },
  { id: 'wikipv', label: 'Wikipedia' },
];

function selectedList(params: URLSearchParams, key: string): string[] {
  return (params.get(key) ?? '').split(',').filter(Boolean);
}

export function FilterBar() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const replaceParam = (key: string, value?: string) => {
    const next = new URLSearchParams(searchParams.toString());
    if (value === undefined || value === '') next.delete(key);
    else next.set(key, value);
    const query = next.toString();
    router.replace(query ? `/?${query}` : '/', { scroll: false });
  };

  const toggleListValue = (key: string, value: string, checked: boolean) => {
    const current = selectedList(searchParams, key);
    const next = checked ? [...new Set([...current, value])] : current.filter((item) => item !== value);
    replaceParam(key, next.length ? next.join(',') : undefined);
  };

  const fieldClass = 'h-10 rounded-md border border-zinc-300 bg-white px-2 text-sm text-zinc-900 outline-none transition-colors focus:border-blue-600 focus:ring-2 focus:ring-blue-600/25 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-100';
  // 各列の小見出し。fieldset の legend と label の span で共有する（高さを揃えるため）。
  const legendClass = 'mb-1 block text-xs font-medium text-zinc-600 dark:text-zinc-400';
  const statuses = selectedList(searchParams, 'status');
  const sources = selectedList(searchParams, 'sources');

  return (
    <section aria-label="Dashboard filters" className="sticky top-0 z-20 border-y border-zinc-200 bg-white/95 py-3 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/95">
      {/*
        2 段組み。上段が「絞り込みの条件」、下段が「対象の選択（Status / Sources）」で、
        どの項目も「小見出し 1 行 ＋ 操作 1 行」の形にそろえる。
        以前は 4 列 1 段で、最初の列だけ見出しを持たず下寄せだったため左上に大きな空白ができ、
        さらに Status / Sources が幅 155px に押し込まれて 3 行に折り返していた。
      */}
      <div className="grid gap-x-6 gap-y-3">
        <div className="grid items-start gap-x-6 gap-y-3 sm:grid-cols-[auto_auto_1fr]">
          <fieldset className="min-w-0">
            <legend className={legendClass}>Options</legend>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={searchParams.get('available') === '1'} onChange={(event) => replaceParam('available', event.target.checked ? '1' : undefined)} className="size-4 accent-blue-600" />
                Available only
              </label>
              <label className="flex min-h-10 items-center gap-2 text-sm text-zinc-500 dark:text-zinc-400">
                <input type="checkbox" checked disabled className="size-4" />
                .com のみ（MVP 固定）
              </label>
              <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium">
                <input type="checkbox" checked={searchParams.get('excludePremium') === '1'} onChange={(event) => replaceParam('excludePremium', event.target.checked ? '1' : undefined)} className="size-4 accent-blue-600" />
                Exclude Premium
              </label>
            </div>
          </fieldset>

          <label className="grid min-w-0 gap-1">
            <span className={legendClass}>Max price</span>
            <select value={searchParams.get('maxPrice') ?? ''} onChange={(event) => replaceParam('maxPrice', event.target.value)} className={fieldClass}>
              <option value="">No limit</option>
              <option value="15">$15</option>
              <option value="20">$20</option>
              <option value="50">$50</option>
            </select>
          </label>

          <div className="grid grid-cols-3 gap-2">
            <NumberFilter label="Min Trend" name="minTrend" value={searchParams.get('minTrend') ?? ''} onChange={replaceParam} className={fieldClass} />
            <NumberFilter label="Min Opportunity" name="minOpportunity" value={searchParams.get('minOpportunity') ?? ''} onChange={replaceParam} className={fieldClass} />
            <NumberFilter label="Max length" name="maxLength" value={searchParams.get('maxLength') ?? ''} onChange={replaceParam} className={fieldClass} />
          </div>
        </div>

        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-[auto_1fr]">
          <fieldset className="min-w-0">
            <legend className={legendClass}>Status</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {STATUSES.map((status) => (
                <label key={status} className="flex min-h-8 cursor-pointer items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={statuses.includes(status)} onChange={(event) => toggleListValue('status', status, event.target.checked)} className="size-3.5 accent-blue-600" />
                  {status}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="min-w-0">
            <legend className={legendClass}>Sources</legend>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {SOURCES.map((source) => (
                <label key={source.id} className="flex min-h-8 cursor-pointer items-center gap-1.5 text-xs">
                  <input type="checkbox" checked={sources.includes(source.id)} onChange={(event) => toggleListValue('sources', source.id, event.target.checked)} className="size-3.5 accent-blue-600" />
                  {source.label}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </div>
    </section>
  );
}

function NumberFilter({ label, name, value, onChange, className }: { label: string; name: string; value: string; onChange: (key: string, value?: string) => void; className: string }) {
  return (
    <label className="grid min-w-0 gap-1">
      <span className="block truncate text-xs font-medium text-zinc-600 dark:text-zinc-400">{label}</span>
      <input type="number" min="0" max="100" inputMode="numeric" value={value} onChange={(event) => onChange(name, event.target.value)} placeholder="Any" className={`${className} min-w-0 w-full`} />
    </label>
  );
}
