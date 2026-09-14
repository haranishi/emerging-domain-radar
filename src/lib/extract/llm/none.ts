/** 既定のプロバイダ。何もしない（ルールベースの n-gram だけで動かす）。 */
import type { KeywordExtractor } from './types';

export const noneExtractor: KeywordExtractor = {
  name: 'none',
  async extract() {
    return [];
  },
};
