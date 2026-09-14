/**
 * 候補抽出の入口。ルールベース（n-gram）を主とし、LLM は候補の追加提案に限る。
 * 数値（件数・スコア）は LLM を使っても必ず measure で取り直す（architecture §5.3）。
 */
import { getEnv } from '../env';
import { logStep } from '../http';
import { extractCandidates, type KeywordCandidate } from './ngram';
import { anthropicExtractor } from './llm/anthropic';
import { codexCliExtractor } from './llm/codex-cli';
import { noneExtractor } from './llm/none';
import type { KeywordExtractor, LlmKeyword } from './llm/types';
import type { HarvestItem } from '../trend/types';

export { extractCandidates } from './ngram';
export type { KeywordCandidate } from './ngram';
export type { LlmKeyword } from './llm/types';

export function getExtractor(provider = getEnv().LLM_PROVIDER): KeywordExtractor {
  switch (provider) {
    case 'anthropic':
      return anthropicExtractor;
    case 'codex-cli':
      return codexCliExtractor;
    default:
      return noneExtractor;
  }
}

export interface ExtractedKeyword {
  keyword: string;
  description: string | null;
  whyEmerging: string | null;
  firstSeenContext: string | null;
  relatedTerms: string[];
  /** 'ngram' | 'llm:anthropic' | 'llm:codex-cli' | 'ngram+llm:...' */
  extractionMethod: string;
  llmConfidence: number | null;
  llmBasis: string | null;
  /** ルールベースの候補スコア（LLM 単独の候補は 0）。 */
  candidateScore: number;
  oldestCreatedAt: string | null;
}

function fromNgram(c: KeywordCandidate): ExtractedKeyword {
  return {
    keyword: c.keyword,
    description: null,
    whyEmerging: `${c.sourceCount} ソース・${c.itemCount} 件のタイトルに出現（ルールベース抽出）`,
    firstSeenContext: c.sampleTitles[0] ?? null,
    // n-gram 側で畳んだ包含関係の句（`self improving agents` に吸われた `improving agents` 等）。
    relatedTerms: c.relatedTerms,
    extractionMethod: 'ngram',
    llmConfidence: null,
    llmBasis: null,
    candidateScore: c.score,
    oldestCreatedAt: c.oldestCreatedAt,
  };
}

function mergeLlm(base: ExtractedKeyword, llm: LlmKeyword, provider: string): ExtractedKeyword {
  return {
    ...base,
    description: llm.short_description || base.description,
    whyEmerging: llm.why_emerging || base.whyEmerging,
    firstSeenContext: llm.first_seen_context || base.firstSeenContext,
    // LLM の語を先に出すが、n-gram で畳んだ句は消さない（消えると統合の痕跡が無くなる）。
    relatedTerms: [...new Set([...llm.related_terms, ...base.relatedTerms])],
    extractionMethod: base.extractionMethod === 'ngram' ? `ngram+llm:${provider}` : `llm:${provider}`,
    llmConfidence: llm.confidence,
    llmBasis: llm.basis,
  };
}

export interface ExtractRunOptions {
  skipLlm?: boolean;
  /** ルールベース候補の取得上限。 */
  ngramLimit?: number;
}

/**
 * 収穫したアイテムから候補キーワードを作る。
 * 並び順は candidateScore 降順 → LLM の confidence 降順 → 語の辞書順（決定的）。
 */
export async function extractKeywords(
  items: HarvestItem[],
  opts: ExtractRunOptions = {},
): Promise<ExtractedKeyword[]> {
  const ngram = extractCandidates(items, { limit: opts.ngramLimit ?? 200 });
  const byKeyword = new Map<string, ExtractedKeyword>();
  for (const c of ngram) byKeyword.set(c.keyword, fromNgram(c));

  const provider = getEnv().LLM_PROVIDER;
  if (!opts.skipLlm && provider !== 'none' && items.length > 0) {
    const extractor = getExtractor(provider);
    const llmKeywords = await extractor.extract(items);
    logStep('extract', `LLM（${extractor.name}）から ${llmKeywords.length} 語の提案を受け取りました`);
    for (const llm of llmKeywords) {
      const key = llm.keyword.toLowerCase().trim();
      const existing = byKeyword.get(key);
      if (existing) {
        byKeyword.set(key, mergeLlm(existing, llm, extractor.name));
      } else {
        byKeyword.set(key, {
          keyword: key,
          description: llm.short_description || null,
          whyEmerging: llm.why_emerging || null,
          firstSeenContext: llm.first_seen_context || null,
          relatedTerms: llm.related_terms,
          extractionMethod: `llm:${extractor.name}`,
          llmConfidence: llm.confidence,
          llmBasis: llm.basis,
          candidateScore: 0,
          oldestCreatedAt: null,
        });
      }
    }
  }

  return [...byKeyword.values()].sort(
    (a, b) =>
      b.candidateScore - a.candidateScore ||
      (b.llmConfidence ?? 0) - (a.llmConfidence ?? 0) ||
      a.keyword.localeCompare(b.keyword),
  );
}
