import Link from 'next/link';
import { notFound } from 'next/navigation';
import { DomainResultsTable } from '@/components/DomainResultsTable';
import { ScoreBar } from '@/components/ScoreBar';
import { StatusBadge } from '@/components/StatusBadge';
import type { EvidenceRow } from '@/lib/db/queries';
import { getKeywordDetail } from '@/lib/db/queries';
import { evidenceUrl, officialLinks } from '@/lib/domain/links';
import { trademarkGuidance } from '@/lib/domain/trademark';
import { PREMIUM_INFERRED_NOTE } from '@/lib/domain/types';
import { getUsdJpyCached } from '@/lib/fx/frankfurter';
import {
  EM_DASH,
  formatCount,
  formatDate,
  formatDateTime,
  formatScore,
  isLlmDerived,
  noAvailableLabel,
} from '@/view/format';
import { openDb } from '@/view/server';

const TABLE_WRAP = 'overflow-x-auto border-y border-zinc-200 dark:border-zinc-800';
const TH = 'whitespace-nowrap px-3 py-2 text-left text-[10px] font-semibold uppercase tracking-wider text-zinc-500 dark:text-zinc-400';
const FX_SOURCE_LABEL = (source: string | null): string => (source?.startsWith('Frankfurter v2') ? 'Frankfurter v2' : (source ?? 'source unavailable'));
/**
 * Estimate 列の意味。提供元が「全件を数え切っていない」と申告した窓がある行に `≈` を付ける
 * （HN Algolia の `exhaustiveNbHits: false`、arXiv の打ち切り）。
 * 全行が正確なランでは列そのものを出さない（全行 `—` の列は情報を持たないため）。
 */
const ESTIMATE_NOTE = '提供元が全件を数え切れなかった窓がある行に ≈ を付ける（HN Algolia の非網羅ヒット・arXiv の打ち切り）。概算が 1 件も無いときはこの列を出しません。';
const TD = 'whitespace-nowrap px-3 py-3 align-top text-xs';

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function numberAt(value: unknown, key: string): number | null {
  const candidate = asRecord(value)[key];
  return typeof candidate === 'number' && Number.isFinite(candidate) ? candidate : null;
}

function displayNumber(value: number | null, digits = 2): string {
  if (value === null) return EM_DASH;
  return Number.isInteger(value) ? String(value) : value.toFixed(digits);
}

function changeLabel(now: number | undefined, previous: number | undefined): string {
  if (now === undefined || previous === undefined) return EM_DASH;
  if (previous === 0) return 'new';
  const percent = ((now - previous) / Math.max(previous, 1)) * 100;
  return `${percent > 0 ? '+' : ''}${percent.toFixed(0)}%`;
}

function sourceLabel(source: EvidenceRow['source']): string {
  return ({ hn: 'HN', github: 'GitHub', arxiv: 'arXiv', openalex: 'OpenAlex', qiita: 'Qiita', wikipv: 'Wikipedia' })[source];
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="mb-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">{eyebrow}</p>
      <h2 className="mt-1 text-xl font-semibold tracking-tight">{title}</h2>
    </div>
  );
}

function MetricTable({ rows }: { rows: { label: string; value: string; note: string }[] }) {
  return (
    <div className={TABLE_WRAP}>
      <table className="w-full min-w-[34rem] border-collapse">
        <thead><tr><th className={TH}>Input</th><th className={`${TH} text-right`}>Value</th><th className={TH}>Meaning</th></tr></thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {rows.map((row) => (
            <tr key={row.label}>
              <th scope="row" className={`${TD} font-mono font-semibold`}>{row.label}</th>
              <td className={`${TD} text-right font-mono tabular-nums`}>{row.value}</td>
              <td className={`${TD} whitespace-normal text-zinc-600 dark:text-zinc-400`}>{row.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function KeywordDetailPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const db = await openDb();
  const detail = getKeywordDetail(db, slug);
  if (!detail) notFound();

  const fx = await getUsdJpyCached(db);
  const bestDomain = detail.domains[0];
  const guidance = trademarkGuidance(detail.keyword);
  const excludedDomains = detail.excludedDomains;
  const llmDerived = isLlmDerived(detail.extractionMethod);
  const trend = asRecord(detail.trendBreakdown);
  const trendParts = asRecord(trend.trend);
  const japanGap = asRecord(trend.japanGap);
  const opportunity = asRecord(detail.opportunityBreakdown);
  const novelty = asRecord(trend.novelty);
  const ageDays = numberAt(novelty, 'ageDays');
  const noveltyApproximate = asRecord(novelty).approximate === true;
  const hasApproximate = detail.evidence.some((row) => row.approximate);

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/" className="inline-flex min-h-11 cursor-pointer items-center text-sm font-semibold text-blue-700 underline-offset-4 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400">← Dashboard</Link>

      <header className="mt-3 border-b border-zinc-200 pb-7 dark:border-zinc-800">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-700 dark:text-blue-400">Keyword detail</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">{detail.keyword}</h1>
          <StatusBadge status={detail.status} fading={detail.fading} />
        </div>
        {detail.noAvailableDomain ? <p className="mt-2 text-xs font-semibold text-zinc-500 dark:text-zinc-400">{noAvailableLabel(detail.domains, '候補')}</p> : null}
        <div className="mt-6 grid grid-cols-2 gap-x-5 gap-y-5 sm:grid-cols-3 lg:grid-cols-5">
          <ScoreBar label="Trend" value={detail.trendScore} />
          <ScoreBar label="Novelty" value={detail.noveltyScore} />
          <ScoreBar label="Japan Gap" value={detail.japanGapScore} />
          <ScoreBar label="Domain（最良候補）" value={bestDomain?.domainScore} />
          {/* 5 本のうち主は Opportunity だけ（残り 4 本はその内訳）。→ ScoreBar の emphasis。 */}
          <ScoreBar label="Opportunity Score（調査優先度）" value={detail.opportunityScore} emphasis="primary" />
        </div>
      </header>

      {fx.rate !== null ? (
        <p className="mt-4 text-xs text-zinc-500 dark:text-zinc-400">USD/JPY {fx.rate.toFixed(2)}（{fx.disclaimer}・{FX_SOURCE_LABEL(fx.source)}・取得 {formatDateTime(fx.fetchedAt)}）</p>
      ) : null}

      <section className="grid gap-6 border-b border-zinc-200 py-7 md:grid-cols-2 dark:border-zinc-800" aria-labelledby="overview-heading">
        <div>
          <h2 id="overview-heading" className="text-sm font-semibold">Description</h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">{detail.description ?? EM_DASH}</p>
        </div>
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-sm font-semibold">Why this candidate</h2>
            {llmDerived ? (
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${detail.llmBasis === 'confirmed' ? 'border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950 dark:text-emerald-200' : 'border-violet-300 bg-violet-50 text-violet-800 dark:border-violet-800 dark:bg-violet-950 dark:text-violet-200'}`}>
                {detail.llmBasis === 'confirmed' ? '確認済み（LLM）' : '推測'}
              </span>
            ) : <span className="rounded border border-zinc-300 bg-zinc-100 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800 dark:text-zinc-200">ルールベース抽出（数値根拠のみ）</span>}
          </div>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">{detail.whyEmerging ?? detail.firstSeenContext ?? EM_DASH}</p>
          {llmDerived && detail.llmConfidence !== null ? <p className="mt-2 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">LLM confidence {detail.llmConfidence.toFixed(2)}</p> : null}
        </div>
      </section>

      <section className="border-b border-zinc-200 py-7 dark:border-zinc-800" aria-labelledby="evidence-heading">
        <SectionTitle eyebrow="Source × window" title="Evidence" />
        <div className={TABLE_WRAP}>
          <table className={`w-full border-collapse ${hasApproximate ? 'min-w-[58rem]' : 'min-w-[54rem]'}`}>
            <thead>
              <tr><th id="evidence-heading" className={TH}>Source</th><th className={`${TH} text-right`}>Last 7d</th><th className={`${TH} text-right`}>Prev 7d</th><th className={`${TH} text-right`}>Change 7d</th><th className={`${TH} text-right`}>Last 30d</th><th className={`${TH} text-right`}>Prev 30d</th><th className={`${TH} text-right`}>Change 30d</th>{hasApproximate ? <th className={`${TH} text-center`} title={ESTIMATE_NOTE}>Estimate</th> : null}<th className={TH}>Source search</th></tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {detail.evidence.map((row) => (
                <tr key={row.source}>
                  <th scope="row" className={`${TD} font-semibold`}>{sourceLabel(row.source)}</th>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{formatCount(row.counts['7d'])}</td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{formatCount(row.counts.prev7d)}</td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{changeLabel(row.counts['7d'], row.counts.prev7d)}</td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{formatCount(row.counts['30d'])}</td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{formatCount(row.counts.prev30d)}</td>
                  <td className={`${TD} text-right font-mono tabular-nums`}>{changeLabel(row.counts['30d'], row.counts.prev30d)}</td>
                  {hasApproximate ? <td className={`${TD} text-center font-mono text-base`} aria-label={row.approximate ? 'Approximate' : 'Exact'}>{row.approximate ? '≈' : '—'}</td> : null}
                  <td className={TD}><a href={row.queryUrl ?? evidenceUrl(row.source, detail.keyword)} target="_blank" rel="noopener noreferrer" className="cursor-pointer font-semibold text-blue-700 underline underline-offset-4 hover:text-blue-900 focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 dark:text-blue-400 dark:hover:text-blue-300">Open source ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-8 border-b border-zinc-200 py-7 md:grid-cols-2 dark:border-zinc-800">
        <div>
          <h2 className="text-sm font-semibold">When it started growing</h2>
          <p className="mt-2 font-mono text-sm">{noveltyApproximate ? '初出は 365 日より前（概算）' : `First seen ${formatDate(detail.firstSeenAt)}`}</p>
          <p className="mt-1 text-sm leading-6 text-zinc-600 dark:text-zinc-400">Novelty {formatScore(detail.noveltyScore)} — {noveltyApproximate ? '365 日超（概算）として算出しています。' : ageDays === null ? '初出時点を基準にした新規性スコアです。' : `初出から ${Math.round(ageDays)} 日の観測として算出しています。`}</p>
        </div>
        <div>
          <h2 className="text-sm font-semibold">Related terms</h2>
          {detail.relatedTerms.length ? <ul className="mt-2 flex flex-wrap gap-2">{detail.relatedTerms.map((term) => <li key={term} className="rounded-full border border-zinc-300 bg-zinc-100 px-2.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-800">{term}</li>)}</ul> : <p className="mt-2 text-sm text-zinc-500">—</p>}
        </div>
      </section>

      <section className="border-b border-zinc-200 py-7 dark:border-zinc-800" aria-labelledby="domains-heading">
        <SectionTitle eyebrow={`${detail.domains.length} candidates`} title="Domain candidates" />
        <DomainResultsTable
          headingId="domains-heading"
          rows={detail.domains.map((domain) => ({ ...domain, officialLinks: officialLinks(domain.domain) }))}
          fx={fx}
          watchlist={{ keyword: detail.keyword, trendScore: detail.trendScore, opportunityScore: detail.opportunityScore }}
        />
        {detail.domains.some((domain) => domain.premium === 'standard_inferred') ? <p className="mt-3 max-w-4xl text-xs leading-5 text-zinc-600 dark:text-zinc-400">{PREMIUM_INFERRED_NOTE}</p> : null}
      </section>

      <section className="border-b border-amber-300 bg-amber-50/70 px-4 py-7 dark:border-amber-900 dark:bg-amber-950/30" aria-labelledby="trademark-heading">
        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-amber-800 dark:text-amber-300">Manual review</p>
        <h2 id="trademark-heading" className="mt-1 text-xl font-semibold">{guidance.note}</h2>
        <p className="mt-2 max-w-4xl text-sm leading-6 text-zinc-700 dark:text-zinc-300">候補ごとに指定商品・役務、称呼、外観、観念を確認してください。{guidance.caveat}</p>
        <div className="mt-4 flex flex-wrap gap-2">{guidance.links.map((link) => <a key={link.label} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 cursor-pointer items-center rounded-md border border-amber-300 bg-white px-3 py-2 text-xs font-semibold text-amber-900 transition-colors hover:bg-amber-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-600 dark:border-amber-800 dark:bg-zinc-950 dark:text-amber-200 dark:hover:bg-amber-950">{link.label} ↗</a>)}</div>
        {excludedDomains.length ? (
          <div className="mt-5">
            <h3 className="text-sm font-semibold">Excluded by trademark flag</h3>
            <ul className="mt-2 grid gap-1 text-xs text-zinc-700 dark:text-zinc-300">{excludedDomains.map((domain) => <li key={domain.domain}><span className="font-mono font-semibold">{domain.domain}</span> — {domain.reason}</li>)}</ul>
          </div>
        ) : null}
      </section>

      <section className="py-7" aria-labelledby="breakdown-heading">
        <SectionTitle eyebrow="Formula inputs" title="Score breakdown" />
        <div id="breakdown-heading" className="grid gap-7 lg:grid-cols-2">
          <div><h3 className="mb-3 text-sm font-semibold">Trend</h3><MetricTable rows={[
            { label: 'G', value: displayNumber(numberAt(trendParts, 'G')), note: 'Growth（平滑化・観測量補正後）' },
            { label: 'A', value: displayNumber(numberAt(trendParts, 'A')), note: 'Acceleration（直近 7 日の日平均）' },
            { label: 'B', value: displayNumber(numberAt(trendParts, 'B')), note: 'Breadth（ソース横断性）' },
            { label: 'V', value: displayNumber(numberAt(trendParts, 'V')), note: 'Volume earliness（絶対量の小ささ）' },
          ]} /></div>
          <div><h3 className="mb-3 text-sm font-semibold">Status inputs</h3><MetricTable rows={[
            { label: 'c30', value: displayNumber(detail.c30Units), note: '30 日のソース横断参照単位' },
            { label: 'g30', value: displayNumber(detail.g30), note: '前 30 日に対する平滑化後の比率' },
            { label: 'S', value: displayNumber(detail.breadth, 0), note: '30 日件数があるソース数' },
          ]} /></div>
          <div><h3 className="mb-3 text-sm font-semibold">Japan Gap inputs</h3><MetricTable rows={[
            { label: 'JP equivalent', value: detail.jaEquivalent ?? 'JP equivalent unknown', note: detail.jaEquivalent ? 'Wikipedia langlinks から取得した日本語' : '日本語訳が Wikipedia から取れず、英語フレーズだけで計測' },
            { label: 'jp', value: displayNumber(numberAt(japanGap, 'jpUnits')), note: '日本語圏の参照単位' },
            { label: 'en', value: displayNumber(numberAt(japanGap, 'enUnits')), note: '英語圏の参照単位' },
          ]} /></div>
          <div><h3 className="mb-3 text-sm font-semibold">Opportunity Score（調査優先度）</h3><MetricTable rows={[
            { label: 'trend', value: displayNumber(numberAt(opportunity, 'trend')), note: 'Trend input' },
            { label: 'domain', value: displayNumber(numberAt(opportunity, 'domain')), note: 'Domain input' },
            { label: 'japanGap', value: displayNumber(numberAt(opportunity, 'japanGap')), note: 'Japan Gap input' },
            { label: 'novelty', value: displayNumber(numberAt(opportunity, 'novelty')), note: 'Novelty input' },
            { label: 'base', value: displayNumber(numberAt(opportunity, 'base')), note: '加重合計（減点前）' },
            { label: 'mainstreamPenalty', value: displayNumber(numberAt(opportunity, 'mainstreamPenalty')), note: 'Mainstream / Trending 減点' },
            { label: 'fadingPenalty', value: displayNumber(numberAt(opportunity, 'fadingPenalty')), note: 'fading 減点' },
            { label: 'trademarkRisk', value: displayNumber(numberAt(opportunity, 'trademarkRisk')), note: '商標フラグ減点' },
            { label: 'pricePenalty', value: displayNumber(numberAt(opportunity, 'pricePenalty')), note: '価格・Premium 減点' },
            { label: 'score', value: displayNumber(numberAt(opportunity, 'score')), note: '最終スコア' },
          ]} /></div>
        </div>
      </section>
    </div>
  );
}
