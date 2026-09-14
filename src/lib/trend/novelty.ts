/**
 * Novelty Score（初出の新しさ）。architecture §5.4。
 *
 * 初出 <=30 日: 100 / <=60 日: 85 / <=180 日: 60 / <=365 日: 35 / それ以上: 10
 *
 * 初出日は「各ソースの観測最古日」と `keywords.first_seen_at` の最小値。
 * HN Algolia に 60 日より前のヒットがあるかを 1 回だけ確認して精度を上げる。
 */
const DAY_MS = 86_400_000;

export const NOVELTY_BUCKETS = [
  { maxDays: 30, score: 100 },
  { maxDays: 60, score: 85 },
  { maxDays: 180, score: 60 },
  { maxDays: 365, score: 35 },
] as const;

export const NOVELTY_FLOOR = 10;

export function noveltyScoreFromAgeDays(ageDays: number): number {
  for (const b of NOVELTY_BUCKETS) {
    if (ageDays <= b.maxDays) return b.score;
  }
  return NOVELTY_FLOOR;
}

/**
 * 候補となる日付（ISO 文字列）のうち最も古いものを初出とみなす。
 * 1 つも無ければ「観測できていない＝今回が初出」として 100 を返す。
 */
export function noveltyScore(candidateDates: (string | null | undefined)[], now: Date): { score: number; firstSeenAt: string | null; ageDays: number | null } {
  const times = candidateDates
    .filter((d): d is string => typeof d === 'string' && d.length > 0)
    .map((d) => Date.parse(d))
    .filter((t) => Number.isFinite(t));
  if (times.length === 0) return { score: 100, firstSeenAt: null, ageDays: null };
  const oldest = Math.min(...times);
  const ageDays = (now.getTime() - oldest) / DAY_MS;
  return {
    score: noveltyScoreFromAgeDays(ageDays),
    firstSeenAt: new Date(oldest).toISOString(),
    ageDays,
  };
}
