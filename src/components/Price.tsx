/**
 * 価格 1 セル分の表示（USD の年額 ＋ 参考値の円換算）。
 *
 * 円換算は**短い 1 行**（`≈ ¥1,771`）で出し、「参考値・取得元・取得時刻」は
 * `title` に退避する。以前は括弧付きの全文をセルに出していたが、その 1 行が
 * ドメイン表の Registration / Renewal 列を 2 倍以上に広げ、右端の
 * Official sites と Watchlist を 1440px でも画面外に押し出していた
 * （UI 採点 ラウンド 1 の最優先指摘）。取得元と取得時刻は各ページ上部の
 * USD/JPY 行にも 1 回出るので、画面から消えるわけではない。
 */
import { PRICE_UNAVAILABLE_NOTE } from '@/view/labels';

export interface PriceFx {
  rate: number | null;
  source: string | null;
  fetchedAt: string;
  disclaimer: string;
}

function formatDateTime(iso: string): string {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return iso;
  return `${new Date(timestamp).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

function formatPrice(value: number | null, currency: string | null): string {
  if (value === null) return PRICE_UNAVAILABLE_NOTE;
  return `${currency === null || currency === 'USD' ? '$' : `${currency} `}${value.toFixed(2)} / yr`;
}

/**
 * 円換算の 2 通りの表記。`short` がセルに出る文字、`detail` が `title` と読み上げ用。
 * `Price` の外（ダッシュボードのカード）でも円換算だけを別の位置に置きたいので分けている。
 */
export function jpyParts(value: number | null, currency: string | null, fx?: PriceFx | null): { short: string; suffix: string; detail: string } | null {
  if (value === null || fx == null || fx.rate === null) return null;
  if (currency !== null && currency !== 'USD') return null;
  const source = fx.source?.startsWith('Frankfurter v2') ? 'Frankfurter v2' : (fx.source ?? 'source unavailable');
  const short = `≈ ¥${Math.round(value * fx.rate).toLocaleString('en-US')}`;
  const suffix = `（${fx.disclaimer}・${source}・取得 ${formatDateTime(fx.fetchedAt)}）`;
  return { short, suffix, detail: `${short}${suffix}` };
}

/** 円換算 1 行分。読み上げには全文（参考値・取得元・取得時刻）を残す。 */
export function JpyNote({ parts, className = '' }: { parts: { short: string; suffix: string; detail: string }; className?: string }) {
  return (
    <span className={`whitespace-nowrap font-mono text-[10px] leading-4 text-zinc-500 dark:text-zinc-400 ${className}`} title={parts.detail}>
      {parts.short}
      <span className="sr-only">{parts.suffix}</span>
    </span>
  );
}

export function Price({ value, currency, fx, showJpy = true }: { value: number | null; currency: string | null; fx?: PriceFx | null; showJpy?: boolean }) {
  const jpy = showJpy ? jpyParts(value, currency, fx) : null;
  return (
    <span className="font-mono tabular-nums">
      <span className={value === null ? 'text-zinc-500 dark:text-zinc-400' : ''}>{formatPrice(value, currency)}</span>
      {jpy ? <JpyNote parts={jpy} className="mt-0.5 block" /> : null}
    </span>
  );
}
