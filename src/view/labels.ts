/** DB・環境変数に依存しない、サーバー／クライアント共用の表示文言。 */
import type { Availability, Premium } from '@/lib/db/types';

export const PRICE_UNAVAILABLE_NOTE = 'Price unavailable';
export const UNSUPPORTED_TLD_NOTE = 'MVP は .com のみ';

export function availabilityDisplayLabel(availability: Availability | null): string {
  const normalized = availability ?? 'unknown';
  return normalized === 'unsupported'
    ? `UNSUPPORTED (${UNSUPPORTED_TLD_NOTE})`
    : normalized.toUpperCase();
}

export function premiumLabel(premium: Premium | null): string {
  if (premium === 'premium') return 'Premium';
  if (premium === 'standard') return 'Standard';
  if (premium === 'standard_inferred') return 'Standard (inferred)';
  return 'Unknown';
}
