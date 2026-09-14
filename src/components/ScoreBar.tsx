import { formatScore } from '@/view/format';

/**
 * スコアの横棒。
 *
 * `emphasis` は主従の指定。画面に並ぶ 3〜5 本のうち最初に読むべきなのは
 * Opportunity Score（調査優先度）だけで、Trend / Japan Gap / Novelty / Domain は
 * その内訳にあたる。全部を同じ太さ・同じ濃さで描くと「どれから読むか」が画面から
 * 消えてしまうので、主だけ 6px の濃色、従は 4px の淡色にする（UI 採点 ラウンド 2 の指摘）。
 *
 * 既定を `secondary` にしているのは、内訳のほうが数が多く、主を毎回明示させたいから
 * （書き忘れても「細い棒が増える」だけで、主が 2 本になる事故は起きない）。
 */
export type ScoreBarEmphasis = 'primary' | 'secondary';

/**
 * 主 6px・従 4px。どちらも高さ 6px の帯の中で上下中央に置く（→ 下の flex ラッパー）。
 * 上端で揃えると主だけが 2px 下に伸びて、横に並べたとき下辺がぎざぎざになる。
 * 従に `my-px` を付ける方法は使えない。直前のラベル行の `mb-1` と相殺されて効かない。
 */
const TRACK: Record<ScoreBarEmphasis, string> = {
  primary: 'h-1.5',
  secondary: 'h-1',
};

const FILL: Record<ScoreBarEmphasis, string> = {
  primary: 'bg-blue-600 dark:bg-blue-500',
  secondary: 'bg-blue-400 dark:bg-blue-700',
};

export function ScoreBar({ label, value, emphasis = 'secondary' }: { label: string; value: number | null | undefined; emphasis?: ScoreBarEmphasis }) {
  const normalized = value === null || value === undefined || !Number.isFinite(value) ? 0 : Math.min(100, Math.max(0, value));
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2">
        <span className="text-[11px] font-medium leading-4 text-zinc-600 dark:text-zinc-400">{label}</span>
        <span className="font-mono text-sm font-semibold tabular-nums">{formatScore(value)}</span>
      </div>
      <div className="flex h-1.5 items-center">
        <div className={`${TRACK[emphasis]} w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800`} role="meter" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={normalized}>
          <div className={`${FILL[emphasis]} h-full rounded-full`} style={{ width: `${normalized}%` }} />
        </div>
      </div>
    </div>
  );
}
