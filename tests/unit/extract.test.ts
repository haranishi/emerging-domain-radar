/**
 * 候補抽出の入口とプロンプト（architecture §5.3・§7）。
 * 既定は LLM_PROVIDER=none で、キー 0 個でも候補が出ること。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { resetEnvCache } from '../../src/lib/env';
import { extractKeywords, getExtractor } from '../../src/lib/extract/index';
import { MAX_INPUT_LINES, MAX_LLM_KEYWORDS, SYSTEM_PROMPT, buildUserPrompt } from '../../src/lib/extract/prompt';
import { ExtractionSchema, parseExtraction } from '../../src/lib/extract/llm/types';
import type { HarvestItem } from '../../src/lib/trend/types';

const item = (source: HarvestItem['source'], id: string, title: string): HarvestItem => ({
  source,
  externalId: id,
  title,
  url: null,
  createdAt: '2026-09-01T00:00:00Z',
  score: null,
});

const items: HarvestItem[] = [
  item('hn', '1', 'Show HN: Synthetic memory store for agents'),
  item('hn', '2', 'Synthetic memory beats RAG'),
  item('github', '3', 'labs/synthetic-memory — synthetic memory for agents'),
  item('arxiv', '4', 'Agent mesh topology for distributed inference'),
  item('hn', '5', 'Agent mesh in production'),
];

describe('getExtractor', () => {
  beforeEach(() => resetEnvCache());

  it('既定は none', () => {
    expect(getExtractor('none').name).toBe('none');
  });

  it('provider ごとに切り替わる', () => {
    expect(getExtractor('anthropic').name).toBe('anthropic');
    expect(getExtractor('codex-cli').name).toBe('codex-cli');
  });

  it('none は何も返さない', async () => {
    expect(await getExtractor('none').extract(items)).toEqual([]);
  });
});

describe('extractKeywords', () => {
  beforeEach(() => resetEnvCache());

  it('LLM 無しでもルールベースで候補が出る', async () => {
    const out = await extractKeywords(items);
    expect(out.length).toBeGreaterThan(0);
    expect(out.map((k) => k.keyword)).toContain('synthetic memory');
    expect(out[0].extractionMethod).toBe('ngram');
    expect(out[0].llmConfidence).toBeNull();
  });

  it('candidateScore 降順で並ぶ（決定的）', async () => {
    const a = await extractKeywords(items);
    const b = await extractKeywords(items);
    expect(a.map((k) => k.keyword)).toEqual(b.map((k) => k.keyword));
    for (let i = 1; i < a.length; i += 1) expect(a[i - 1].candidateScore).toBeGreaterThanOrEqual(a[i].candidateScore);
  });

  it('観測できた最古の作成日を引き継ぐ', async () => {
    const out = await extractKeywords(items);
    expect(out[0].oldestCreatedAt).toBe('2026-09-01T00:00:00Z');
  });

  it('--skip-llm 相当でも落ちない', async () => {
    const out = await extractKeywords(items, { skipLlm: true });
    expect(out.length).toBeGreaterThan(0);
  });

  it('入力が空なら空配列', async () => {
    expect(await extractKeywords([])).toEqual([]);
  });
});

describe('プロンプト', () => {
  it('出力は JSON のみ・一般語除外・最大 20 語を指示する', () => {
    expect(SYSTEM_PROMPT).toContain('JSON のみ');
    expect(SYSTEM_PROMPT).toContain(`最大 ${MAX_LLM_KEYWORDS} 語`);
    expect(MAX_LLM_KEYWORDS).toBe(20);
    expect(SYSTEM_PROMPT).toContain('一般語');
    expect(SYSTEM_PROMPT).toContain('basis');
  });

  it('推測と確認を basis で分ける指示がある', () => {
    expect(SYSTEM_PROMPT).toContain('"inferred"');
    expect(SYSTEM_PROMPT).toContain('"confirmed"');
  });

  /**
   * 依頼者原文の要点（発見したい語の定義・除外する一般語・返すフィールド）。
   * 表層の言い換えで消えやすいので、原文にしか無い語で固定する。
   */
  it('依頼者原文の定義・除外語・返すフィールドが入っている', () => {
    expect(SYSTEM_PROMPT).toContain('直近 7〜30 日');
    expect(SYSTEM_PROMPT).toContain('まだ一般には広く知られていない');
    for (const generic of ['ChatGPT', 'Machine Learning', 'Blockchain', 'SaaS']) {
      expect(SYSTEM_PROMPT).toContain(generic);
    }
    for (const field of [
      'keyword',
      'short_description',
      'why_emerging',
      'first_seen_context',
      'related_terms',
      'confidence',
      'domain_keywords',
    ]) {
      expect(SYSTEM_PROMPT).toContain(field);
    }
  });

  it('ユーザープロンプトはソース別にタイトルを並べる', () => {
    const prompt = buildUserPrompt(items);
    expect(prompt).toContain('## hn');
    expect(prompt).toContain('## github');
    expect(prompt).toContain('## arxiv');
    expect(prompt).toContain('- Show HN: Synthetic memory store for agents');
  });

  it('入力はソースごとに最大 300 行', () => {
    const many = Array.from({ length: 500 }, (_, i) => item('hn', String(i), `title ${i}`));
    const prompt = buildUserPrompt(many);
    const lines = prompt.split('\n').filter((l) => l.startsWith('- '));
    expect(lines).toHaveLength(MAX_INPUT_LINES);
    expect(MAX_INPUT_LINES).toBe(300);
  });
});

describe('LLM 出力の検証', () => {
  it('前置きが付いていても JSON を切り出す', () => {
    const text = 'はい、結果です:\n```json\n{"keywords":[{"keyword":"agent mesh"}]}\n```\n以上';
    const out = parseExtraction(text);
    expect(out).toHaveLength(1);
    expect(out[0].keyword).toBe('agent mesh');
    // 既定値が埋まる
    expect(out[0].basis).toBe('inferred');
    expect(out[0].confidence).toBe(0.5);
    expect(out[0].related_terms).toEqual([]);
  });

  it('壊れた JSON は空配列（ランを止めない）', () => {
    expect(parseExtraction('not json at all')).toEqual([]);
    expect(parseExtraction('{"keywords": [')).toEqual([]);
    expect(parseExtraction('')).toEqual([]);
  });

  it('スキーマに合わない要素は落とす', () => {
    expect(parseExtraction('{"keywords":[{"keyword":"x"}]}')).toEqual([]); // 2 文字未満
    const parsed = ExtractionSchema.safeParse({ keywords: [{ keyword: 'agent mesh', confidence: 2 }] });
    expect(parsed.success).toBe(false);
  });
});
