/** LLM 抽出プロバイダの契約。LLM の出力は候補提案に限り、スコアは常に数値根拠から計算する。 */
import { z } from 'zod';
import type { HarvestItem } from '../../trend/types';

export const LlmKeywordSchema = z.object({
  keyword: z.string().min(2).max(80),
  short_description: z.string().max(400).default(''),
  why_emerging: z.string().max(600).default(''),
  first_seen_context: z.string().max(400).default(''),
  related_terms: z.array(z.string().max(80)).max(20).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  domain_keywords: z.array(z.string().max(40)).max(20).default([]),
  basis: z.enum(['confirmed', 'inferred']).default('inferred'),
});

export const ExtractionSchema = z.object({
  keywords: z.array(LlmKeywordSchema).max(50).default([]),
});

export type LlmKeyword = z.infer<typeof LlmKeywordSchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;

export interface KeywordExtractor {
  name: string;
  extract(items: HarvestItem[]): Promise<LlmKeyword[]>;
}

/** `{`〜`}` を切り出して zod で検証する（LLM が前置きを付けた場合の保険）。 */
export function parseExtraction(text: string): LlmKeyword[] {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) return [];
  const slice = text.slice(start, end + 1);
  let json: unknown;
  try {
    json = JSON.parse(slice);
  } catch {
    return [];
  }
  const parsed = ExtractionSchema.safeParse(json);
  return parsed.success ? parsed.data.keywords : [];
}
