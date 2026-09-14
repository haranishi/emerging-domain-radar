/**
 * Claude API による候補抽出（任意・`LLM_PROVIDER=anthropic`）。
 * 呼び出し形は docs/03_architecture.md §7 のとおり。
 *
 * 方針:
 *  - `thinking` は指定しない（Opus 5 は既定で adaptive）。モデル ID に日付サフィックスを付けない。
 *  - refusal（stop_reason）とレート制限・認証エラーは警告してスキップ。ランは止めない。
 *  - 構造化出力は `output_config.format` + zodOutputFormat。beta が拒否されたら
 *    `client.messages.parse()` にフォールバックする。
 */
import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { getEnv } from '../../env';
import { logStep } from '../../http';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt';
import { ExtractionSchema, parseExtraction, type KeywordExtractor, type LlmKeyword } from './types';
import type { HarvestItem } from '../../trend/types';

const DEFAULT_MODEL = 'claude-opus-5';
const MAX_TOKENS = 16_000;

export const anthropicExtractor: KeywordExtractor = {
  name: 'anthropic',

  async extract(items: HarvestItem[]): Promise<LlmKeyword[]> {
    const env = getEnv();
    if (!env.ANTHROPIC_API_KEY) {
      logStep('extract', 'ANTHROPIC_API_KEY が未設定なので LLM 抽出をスキップしました');
      return [];
    }
    const client = new Anthropic();
    const model = env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    const userPrompt = buildUserPrompt(items);

    try {
      const res = await client.beta.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
        output_config: { format: zodOutputFormat(ExtractionSchema) },
      });
      if (res.stop_reason === 'refusal') {
        logStep('extract', 'LLM が応答を拒否しました（stop_reason=refusal）。LLM 抽出をスキップします');
        return [];
      }
      const text = res.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
      return parseExtraction(text);
    } catch (err) {
      if (err instanceof Anthropic.BadRequestError) {
        // beta の fallbacks / output_config が拒否された場合だけ通常の parse に切り替える。
        try {
          const res = await client.messages.parse({
            model,
            max_tokens: MAX_TOKENS,
            system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: userPrompt }],
            output_config: { format: zodOutputFormat(ExtractionSchema) },
          });
          return res.parsed_output?.keywords ?? [];
        } catch (inner) {
          logStep('extract', `LLM 抽出に失敗しました（${describe(inner)}）。ルールベースだけで続行します`);
          return [];
        }
      }
      if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.AuthenticationError) {
        logStep('extract', `LLM 抽出をスキップしました（${describe(err)}）`);
        return [];
      }
      logStep('extract', `LLM 抽出に失敗しました（${describe(err)}）。ルールベースだけで続行します`);
      return [];
    }
  },
};

/** エラーの型名と status だけを出す（本文やキーは出さない）。 */
function describe(err: unknown): string {
  if (err instanceof Anthropic.APIError) return `${err.name} status=${err.status ?? 'n/a'}`;
  return err instanceof Error ? err.name : 'UnknownError';
}
