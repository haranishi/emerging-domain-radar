import type { Availability } from '@/lib/db/types';
import { availabilityDisplayLabel } from '@/view/labels';

const STYLES: Record<Availability, string> = {
  available: 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
  taken: 'border-red-300 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950 dark:text-red-200',
  unknown: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
  unsupported: 'border-zinc-300 bg-zinc-100 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200',
};

export function AvailabilityBadge({ availability }: { availability: Availability | null }) {
  const normalized = availability ?? 'unknown';
  const label = availabilityDisplayLabel(normalized);
  return <span className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold tracking-wide ${STYLES[normalized]}`}>{label}</span>;
}
