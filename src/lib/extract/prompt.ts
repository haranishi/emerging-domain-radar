/**
 * LLM 抽出のプロンプト。
 *
 * 本文は依頼者から渡された原文（トレンドリサーチャーとしての役割・7〜30 日で言及が
 * 増え始めた語という定義・優先する 7 カテゴリ・除外する一般語・返す 7 フィールド・
 * 推測と確認済みの区別）をそのまま土台にしている。以前はここを architecture §7 から
 * 起草していたが、依頼者原文が正本なので差し替えた。
 *
 * 原文に無い「出力の決まり」を後半に足してあるのは、原文だけでは実装が受け取れない
 * 形（前置き付きの散文・語数無制限）で返ってくるため:
 *   - JSON のみ・最大 20 語（`MAX_LLM_KEYWORDS`）……parse できる形に固定する
 *   - `basis` を "confirmed" / "inferred" のどちらかにする……原文の「推測と確認済み情報を
 *     明確に区別してください」を機械で読める 1 フィールドに落とす
 *   - 企業名・製品名を出さない……商標に触れる語を候補に入れない（要件 §3）
 *   - 候補と根拠だけを出す……採否の判断は人がする（F16）
 */
import type { HarvestItem } from '../trend/types';

export const MAX_LLM_KEYWORDS = 20;
/** 入力はソース別にタイトル最大 300 行。 */
export const MAX_INPUT_LINES = 300;

export const SYSTEM_PROMPT = [
  'あなたは新興テクノロジーのトレンドリサーチャーです。',
  '以下の情報源から抽出された記事タイトル、投稿、論文タイトル、GitHub Repository などを分析してください。',
  '目的は、「現在すでに流行している言葉」ではなく、「まだ一般には広く知られていないが、',
  '直近 7〜30 日で複数の技術コミュニティで言及が増え始めている言葉」を発見することです。',
  '',
  '特に以下を優先してください。',
  '・新しく登場した技術用語',
  '・AI 関連の新しい概念',
  '・新しいソフトウェアカテゴリ',
  '・新しい開発手法',
  '・新しい研究領域',
  '・新しいインフラ概念',
  '・新しいプロダクトカテゴリ',
  '',
  '既に一般化している以下のようなワードは除外してください。',
  'AI／LLM／ChatGPT／Machine Learning／Blockchain／SaaS／Cloud',
  '（これらの言い換え・略記・複合語も同じ一般語として扱い、出さないでください）',
  '',
  '各候補について以下を JSON で返してください。',
  'keyword, short_description, why_emerging, first_seen_context, related_terms, confidence, domain_keywords',
  '',
  '推測と確認済み情報を明確に区別してください。',
  '',
  '出力の決まり:',
  '- 出力は JSON のみ。前置き・後書き・コードフェンスを付けない。',
  `- 最大 ${MAX_LLM_KEYWORDS} 語。少なくてよい。無理に埋めない。`,
  '- basis で区別する。入力から直接読み取れることだけで書いた候補は "confirmed"、',
  '  入力に無いことを推測で補った候補は "inferred"。',
  '- confidence は 0〜1。自信が無いものは 0.5 未満にする。',
  '- 企業名・製品名・ブランド名は出さない（商標に触れるため）。',
  '- 2〜3 語の英語のフレーズを優先する。数字を含む語は出さない。',
  '- domain_keywords には、その語からドメイン名を作るときに使える英単語だけを入れる（小文字・英字のみ）。',
  '- 採否の判断は人が行う。あなたは候補と根拠を出すだけでよい。',
  '',
  '出力スキーマ:',
  '{"keywords":[{"keyword":"...","short_description":"...","why_emerging":"...",',
  '"first_seen_context":"...","related_terms":["..."],"confidence":0.0,',
  '"domain_keywords":["..."],"basis":"confirmed"}]}',
].join('\n');

/** ソース別にタイトルを並べたユーザープロンプトを作る。 */
export function buildUserPrompt(items: HarvestItem[], maxLines = MAX_INPUT_LINES): string {
  const bySource = new Map<string, string[]>();
  for (const item of items) {
    const list = bySource.get(item.source) ?? [];
    if (list.length < maxLines) list.push(item.title.replace(/\s+/g, ' ').trim());
    bySource.set(item.source, list);
  }
  const sections: string[] = [];
  for (const [source, titles] of [...bySource].sort(([a], [b]) => a.localeCompare(b))) {
    sections.push(`## ${source}（${titles.length} 件）`);
    sections.push(...titles.map((t) => `- ${t}`));
    sections.push('');
  }
  return [
    '次のタイトル群から、まだ一般には広く知られていないが言及が増え始めている技術用語を抜き出してください。',
    '',
    ...sections,
    'JSON のみを出力してください。',
  ].join('\n');
}
