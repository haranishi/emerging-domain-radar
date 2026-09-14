/**
 * 表示のための整形だけを持つ純関数。
 *
 * 契約（docs/02_ux_design.md §3.2 表示ルール）:
 *  - 価格は `$11.08 / yr` の形。取れないときは `Price unavailable`（0 も推測値も出さない）。
 *  - JPY は参考値。セルには `≈ ¥1,771` だけを出し、取得元と取得時刻は
 *    `title` と各ページ上部の USD/JPY 行で示す（表の列幅を壊さないため）。
 *  - 取れない数値は `—`。
 *
 * サーバー側専用。文言は `src/lib` から import して二重管理しない。
 */
import type { Availability } from '@/lib/db/types';
import { PRICE_UNAVAILABLE_NOTE } from '@/view/labels';

/** 円換算の文字列は `src/components/Price.tsx` が組む（クライアント部品からも読むため）。 */
export const EM_DASH = '—';

export function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return PRICE_UNAVAILABLE_NOTE;
  const symbol = currency === null || currency === 'USD' ? '$' : `${currency} `;
  return `${symbol}${value.toFixed(2)} / yr`;
}

export function formatDate(iso: string | null): string {
  if (!iso) return EM_DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toISOString().slice(0, 10);
}

export function formatDateTime(iso: string | null): string {
  if (!iso) return EM_DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return `${new Date(t).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

export function formatDateTimeJst(iso: string | null): string {
  if (!iso) return EM_DASH;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(t));
}

const SOURCE_LABELS: Record<string, string> = {
  hn: 'HN',
  github: 'GitHub',
  arxiv: 'arXiv',
  openalex: 'OpenAlex',
  qiita: 'Qiita',
  wikipv: 'Wikipedia',
};

/** DB の Evidence 要約を、カード上で走査しやすい短い表記にする。 */
export function formatEvidenceSummary(line: string): string {
  const weekly = line.match(/^(\w+): 7d (\d+) vs prev 7d (\d+) \(([^)]+)\)(.*)$/);
  if (weekly) {
    const [, source, current, previous, ratio, suffix] = weekly;
    const change = ratio === 'new' ? 'new' : formatChange(Number.parseFloat(ratio));
    return `${SOURCE_LABELS[source] ?? source} 7d ${current}（前 7d ${previous}・${change}）${suffix}`;
  }

  const monthly = line.match(/^(\w+): 30d (\d+)(?: vs prev 30d (\d+) \(([^)]+)\))?(.*)$/);
  if (monthly) {
    const [, source, current, previous, ratio, suffix] = monthly;
    const comparison = previous === undefined
      ? ''
      : `（前 30d ${previous}・${ratio === 'new' ? 'new' : formatChange(Number.parseFloat(ratio))}）`;
    return `${SOURCE_LABELS[source] ?? source} 30d ${current}${comparison}${suffix}`;
  }

  return line;
}

export function formatScore(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return EM_DASH;
  return String(Math.round(value));
}

/** 件数比（直近 ÷ 前）を増減率にする。前が 0 のときは比が出せないので `new`。 */
export function formatChange(ratio: number | null): string {
  if (ratio === null) return 'new';
  const pct = (ratio - 1) * 100;
  const sign = pct > 0 ? '+' : '';
  return `${sign}${pct.toFixed(0)}%`;
}

export function formatCount(value: number | undefined): string {
  return value === undefined ? EM_DASH : String(value);
}

/** 価格差。片方でも取れなければ `—`（0 と区別する）。 */
export function formatDiff(current: number | null, found: number | null): string {
  if (current === null || found === null) return EM_DASH;
  const diff = current - found;
  if (Math.abs(diff) < 0.005) return '±$0.00';
  return `${diff > 0 ? '+' : '-'}$${Math.abs(diff).toFixed(2)}`;
}

/**
 * 空きが 1 件も無いときの表示。
 *
 * 以前は英語の `no .com available` だけを出していたが、そのすぐ下に `.com` が
 * 3 行並ぶため「空きが無い」と「候補が 3 件ある」が矛盾して読めた（UI 採点の指摘）。
 * 出している件数と、その中身（すべて TAKEN か、UNKNOWN が混ざるか）まで書く。
 */
export function noAvailableLabel(domains: { availability: Availability | null }[], scope = '上位'): string {
  const shown = domains.length;
  if (shown === 0) return '空きなし（.com 候補なし）';
  const allTaken = domains.every((domain) => domain.availability === 'taken');
  return allTaken
    ? `空きなし（${scope} ${shown} 件はすべて TAKEN）`
    : `空きなし（${scope} ${shown} 件に AVAILABLE はありません）`;
}

/** 抽出が LLM 由来かどうか（詳細画面の「推測」バッジの出し分け）。 */
export function isLlmDerived(extractionMethod: string | null): boolean {
  return typeof extractionMethod === 'string' && extractionMethod.includes('llm');
}
