/** n-gram 抽出（architecture §5.3）。 */
import { describe, expect, it } from 'vitest';
import { EXTRACT_LIMITS, candidateScore, containsPhrase, extractCandidates, itemOverlap, phrasesFromTitle, rejectReason, tokenizeTitle } from '../../src/lib/extract/ngram';
import { GENERIC_BLOCKLIST, STOPWORDS, containsGenericPhrase } from '../../src/lib/extract/blocklist';
import { resetEnvCache } from '../../src/lib/env';
import type { HarvestItem } from '../../src/lib/trend/types';

const item = (source: HarvestItem['source'], id: string, title: string, createdAt = '2026-09-01T00:00:00Z'): HarvestItem => ({
  source,
  externalId: id,
  title,
  url: null,
  createdAt,
  score: null,
});

describe('ブロックリスト', () => {
  it('一般語は 150 語以上・重複なし', () => {
    expect(GENERIC_BLOCKLIST.length).toBeGreaterThanOrEqual(150);
    expect(new Set(GENERIC_BLOCKLIST).size).toBe(GENERIC_BLOCKLIST.length);
  });

  it('要件に挙がっている一般語を含む', () => {
    for (const w of [
      'ai', 'llm', 'llms', 'chatgpt', 'gpt', 'machine learning', 'deep learning', 'blockchain', 'cloud',
      'saas', 'open source', 'language model', 'language models', 'large language', 'neural network',
      'neural networks', 'generative ai', 'ai agent', 'ai agents', 'startup', 'startups', 'web app',
      'react', 'python',
    ]) {
      expect(GENERIC_BLOCKLIST, w).toContain(w);
    }
  });

  it('ストップワードがある', () => {
    expect(STOPWORDS.length).toBeGreaterThan(50);
    expect(STOPWORDS).toContain('the');
    expect(STOPWORDS).toContain('of');
  });
});

describe('トークン化', () => {
  it('小文字化・記号除去・ハイフン複合語を開く', () => {
    expect(tokenizeTitle('Vibe-Coding a Compiler!')).toEqual(['vibe', 'coding', 'a', 'compiler']);
    expect(tokenizeTitle("Anthropic's new model")).toEqual(['anthropics', 'new', 'model']);
    expect(tokenizeTitle('agent/mesh_topology')).toEqual(['agent', 'mesh', 'topology']);
  });

  it('2〜3-gram を作る', () => {
    expect(phrasesFromTitle('synthetic memory store')).toEqual([
      'synthetic memory',
      'memory store',
      'synthetic memory store',
    ]);
  });
});

describe('rejectReason', () => {
  it('一般語の句を落とす', () => {
    expect(rejectReason('machine learning')).toBe('generic-phrase');
    expect(rejectReason('ai agents')).toBe('generic-phrase');
  });

  it('単数形が一般語なら複数形も落とす（列挙漏れを機械的に埋める）', () => {
    // 実運用で `large language model` は落ちたのに `large language models` が通っていた
    expect(rejectReason('large language models')).toBe('generic-phrase');
    expect(rejectReason('neural networks')).toBe('generic-phrase');
    expect(rejectReason('foundation models')).toBe('generic-phrase');
    expect(rejectReason('design systems')).toBe('generic-phrase');
    // 'use cases' は 'use' がストップワードなので、複数形判定の前に落ちる（どちらでも除外される）
    expect(rejectReason('use cases')).toBe('leading-stopword');
  });

  it('実運用で拾ってしまった既知語を落とす', () => {
    for (const p of ['agentic ai', 'multi agent', 'local first', 'coding agent']) {
      expect(rejectReason(p), p).toBe('generic-phrase');
    }
  });

  it('ストップワードで始まる／終わる句を落とす', () => {
    expect(rejectReason('the agent')).toBe('leading-stopword');
    expect(rejectReason('agent of')).toBe('trailing-stopword');
  });

  it('数字を含む句を落とす', () => {
    expect(rejectReason('gpt5 agents')).toBe('contains-digit');
  });

  it('一般語トークンだけの句を落とす', () => {
    expect(rejectReason('cloud saas')).toBe('all-generic-tokens');
  });

  it('3 文字未満の語だけの句を落とす', () => {
    expect(rejectReason('a b')).toBe('leading-stopword');
    expect(rejectReason('xy zw')).toBe('tokens-too-short');
  });

  it('商標に触れる句を落とす', () => {
    expect(rejectReason('google agents')).toContain('trademark');
  });

  it('残したい新語は通す', () => {
    for (const p of ['synthetic memory', 'durable execution', 'agentic protocol', 'semantic caching', 'agent mesh', 'edge inference']) {
      expect(rejectReason(p), p).toBeNull();
    }
  });
});

describe('extractCandidates', () => {
  const items: HarvestItem[] = [
    item('hn', '1', 'Show HN: Synthetic memory store for LLM agents'),
    item('hn', '2', 'Synthetic memory beats RAG for long sessions'),
    item('github', '3', 'labs/synthetic-memory — Synthetic memory for agents'),
    item('arxiv', '4', 'Synthetic memory for autonomous agents', '2026-07-20T00:00:00Z'),
    item('hn', '5', 'Latent retrieval at scale'),
    item('hn', '6', 'Latent retrieval beats keyword search'),
    item('hn', '7', 'Notes on latent retrieval'),
    item('hn', '8', 'One-off phrase about widget plumbing'),
    item('github', '9', 'acme/google-gemini-kit — google gemini agents kit'),
  ];

  it('2 ソース以上 かつ 2 アイテム以上、または 1 ソースで 3 件以上を採用する', () => {
    const found = extractCandidates(items).map((c) => c.keyword);
    expect(found).toContain('synthetic memory'); // 3 ソース・4 アイテム
    expect(found).toContain('latent retrieval'); // 1 ソース・3 アイテム
    expect(found).not.toContain('widget plumbing'); // 1 ソース・1 アイテム
  });

  it('候補スコア = ソース数 × (1 + log2(アイテム数))', () => {
    const sm = extractCandidates(items).find((c) => c.keyword === 'synthetic memory');
    expect(sm?.itemCount).toBe(4);
    expect(sm?.sourceCount).toBe(3);
    // 3 × (1 + log2(4)) = 9。旧式（4 × 3 = 12）ではない
    expect(sm?.score).toBe(9);
    expect(sm?.sources).toEqual(['arxiv', 'github', 'hn']);
  });

  it('観測できた最古の作成日を残す（Novelty の材料）', () => {
    const sm = extractCandidates(items).find((c) => c.keyword === 'synthetic memory');
    expect(sm?.oldestCreatedAt).toBe('2026-07-20T00:00:00Z');
  });

  it('由来のタイトルを最大 3 件だけ持つ', () => {
    const sm = extractCandidates(items).find((c) => c.keyword === 'synthetic memory');
    expect(sm?.sampleTitles.length).toBeLessThanOrEqual(3);
    expect(sm?.sampleTitles[0]).toContain('Synthetic memory');
  });

  it('商標に触れる句は候補にならない', () => {
    const found = extractCandidates(items).map((c) => c.keyword);
    expect(found.some((k) => k.includes('google'))).toBe(false);
  });

  it('スコア降順で並ぶ', () => {
    const list = extractCandidates(items);
    for (let i = 1; i < list.length; i += 1) expect(list[i - 1].score).toBeGreaterThanOrEqual(list[i].score);
  });

  it('同じアイテム内の重複は 1 回として数える', () => {
    const dup = [
      item('hn', '1', 'Agent mesh agent mesh agent mesh'),
      item('hn', '2', 'Agent mesh in production'),
      item('github', '3', 'Agent mesh router'),
    ];
    const found = extractCandidates(dup).find((c) => c.keyword === 'agent mesh');
    expect(found?.itemCount).toBe(3);
  });

  it('空入力なら空配列', () => {
    expect(extractCandidates([])).toEqual([]);
  });
});

describe('ブロックリストの部分一致（フェーズ3）', () => {
  it('ブロック語をトークン列の部分列として含む句を、当たった語つきで落とす', () => {
    // 表に無い並びでも、含んでいれば落ちる（列挙で追いかけると必ず漏れる）
    expect(rejectReason('ai coding agents')).toBe('generic-phrase:ai coding');
    expect(rejectReason('multi agent systems')).toBe('generic-phrase:multi agent');
    expect(rejectReason('local first sync')).toBe('generic-phrase:local first');
    expect(rejectReason('state of ai')).toBe('generic-phrase:state of');
  });

  it('1 語のブロック語は部分一致に使わない（残したい新語を消さない）', () => {
    // 'cloud' は表にあるが `cloud sovereignty` は新語として残す
    expect(containsGenericPhrase('cloud sovereignty')).toBeNull();
    expect(rejectReason('cloud sovereignty')).toBeNull();
  });

  it('ハイフン形と空白形は同じ判定になる', () => {
    expect(containsGenericPhrase('local-first sync')).toBe('local first');
    expect(containsGenericPhrase('real-time inference')).toBe('real time');
  });

  it('フェーズ3で追加した既知語と HN の定型句が表にある', () => {
    for (const w of [
      'large language model', 'large language models', 'language models', 'multi agent', 'multi-agent',
      'local first', 'local-first', 'vector database', 'prompt engineering', 'agentic ai', 'ai agents',
      'ai agent', 'foundation model', 'foundation models', 'generative ai', 'open weights', 'fine tuning',
      'fine-tuning', 'retrieval augmented', 'rag', 'mcp server', 'model context protocol', 'vibe coding',
      'context engineering', 'ai coding', 'coding agent', 'coding agents', 'web development',
      'developer tools', 'open source', 'real time', 'real-time', 'state of', 'year old',
      'show hn', 'ask hn', 'tell hn', 'launch hn',
    ]) {
      expect(GENERIC_BLOCKLIST, w).toContain(w);
    }
  });
});

describe('一般語予備軍の除外と山形スコア（フェーズ3）', () => {
  const rep = (n: number, title: string, source: HarvestItem['source'] = 'hn'): HarvestItem[] =>
    Array.from({ length: n }, (_, i) => item(source, `${source}-${i}`, title));
  const keywords = (items: HarvestItem[], maxItems?: number): string[] =>
    extractCandidates(items, maxItems === undefined ? {} : { maxItems }).map((c) => c.keyword);

  it('アイテム数が maxItems 以上の句は新規候補にしない', () => {
    expect(keywords(rep(6, 'Agent mesh'), 6)).not.toContain('agent mesh');
    expect(keywords(rep(6, 'Agent mesh'), 7)).toContain('agent mesh');
  });

  it('既定の上限は 25（RADAR_EXTRACT_MAX_ITEMS の既定値）', () => {
    expect(EXTRACT_LIMITS.defaultMaxItems).toBe(25);
    expect(keywords(rep(25, 'Agent mesh'))).not.toContain('agent mesh');
    expect(keywords(rep(24, 'Agent mesh'))).toContain('agent mesh');
  });

  it('上限は RADAR_EXTRACT_MAX_ITEMS で上書きできる', () => {
    process.env.RADAR_EXTRACT_MAX_ITEMS = '4';
    resetEnvCache();
    try {
      expect(keywords(rep(4, 'Agent mesh'))).not.toContain('agent mesh');
      expect(keywords(rep(3, 'Agent mesh'))).toContain('agent mesh');
    } finally {
      delete process.env.RADAR_EXTRACT_MAX_ITEMS;
      resetEnvCache();
    }
  });

  it('スコアは 2〜15 件を頂上とする山形（16 件以上は 0.5 倍で降格）', () => {
    expect(candidateScore(2, 3)).toBe(6); // 3 × (1 + log2 2)
    expect(candidateScore(8, 3)).toBe(12); // 3 × (1 + log2 8)
    expect(candidateScore(EXTRACT_LIMITS.peakItems, 3)).toBeCloseTo(14.72, 2);
    // 15 → 16 で下がる。これが無いと「1 ラン内で何度も出る語」＝一般語が必ず上位に来る
    expect(candidateScore(16, 3)).toBe(7.5);
    expect(candidateScore(16, 3)).toBeLessThan(candidateScore(EXTRACT_LIMITS.peakItems, 3));
    // ソース数は線形に効く
    expect(candidateScore(8, 1)).toBe(4);
    expect(candidateScore(8, 2)).toBe(8);
  });

  it('1 ソースで多く出た語より、少数でも多ソースの語が上に来る', () => {
    const items = [
      ...rep(20, 'Agent mesh'),
      item('hn', 'd1', 'Durable execution for long jobs'),
      item('github', 'd2', 'acme/durable-execution — Durable execution runtime'),
      item('arxiv', 'd3', 'Durable execution semantics'),
    ];
    const list = extractCandidates(items);
    const mesh = list.findIndex((c) => c.keyword === 'agent mesh');
    const durable = list.findIndex((c) => c.keyword === 'durable execution');
    expect(durable).toBeGreaterThanOrEqual(0);
    expect(mesh).toBeGreaterThanOrEqual(0);
    expect(durable).toBeLessThan(mesh);
  });
});

describe('包含関係の重複候補の統合', () => {
  it('包含かつ支持アイテム集合の重なりが大きければ 1 つに畳む', () => {
    // 3 件とも同じ 3 アイテムに出るので、3 つの句は同じ話を指している
    const items = [
      item('hn', 's1', 'Self improving agents in production'),
      item('github', 's2', 'labs/self-improving-agents — Self improving agents runtime'),
      item('arxiv', 's3', 'Self improving agents survey'),
    ];
    const list = extractCandidates(items);
    const keywords = list.map((c) => c.keyword);
    expect(keywords).toContain('self improving agents');
    expect(keywords).not.toContain('improving agents');
    expect(keywords).not.toContain('self improving');
    // 畳んだ句は残った候補から辿れる
    const kept = list.find((c) => c.keyword === 'self improving agents');
    expect(kept?.relatedTerms).toEqual(['improving agents', 'self improving']);
    // 件数・ソースは残した句のものをそのまま使う（measure で取り直すため）
    expect(kept?.itemCount).toBe(3);
    expect(kept?.sourceCount).toBe(3);
  });

  it('包含でも支持アイテム集合が違えば別の候補として残す', () => {
    // `agent mesh` は 6 件、`agent mesh router` はそのうち 2 件だけ（重なり 0.33）
    const items = [
      item('hn', 'a1', 'Agent mesh notes'),
      item('hn', 'a2', 'Agent mesh explained'),
      item('github', 'a3', 'acme/agent-mesh — Agent mesh core'),
      item('github', 'a4', 'beta/agent-mesh — Agent mesh guide'),
      item('hn', 'a5', 'Agent mesh router benchmarks'),
      item('github', 'a6', 'gamma/agent-mesh-router — Agent mesh router setup'),
    ];
    const list = extractCandidates(items);
    const keywords = list.map((c) => c.keyword);
    expect(keywords).toContain('agent mesh');
    expect(keywords).toContain('agent mesh router');
    expect(list.find((c) => c.keyword === 'agent mesh')?.relatedTerms).toEqual([]);
    // 同じ 2 件にしか出ない `mesh router` は `agent mesh router` に畳まれる
    expect(keywords).not.toContain('mesh router');
    expect(list.find((c) => c.keyword === 'agent mesh router')?.relatedTerms).toEqual(['mesh router']);
  });

  it('残すのはスコアが高い方（同点なら語数が多い方）', () => {
    // `agent mesh` 5 件・`agent mesh router` 4 件 → 重なり 0.8 でぎりぎり畳む。
    // スコアは件数の多い `agent mesh` が上なので、短い句が残る
    const items = [
      item('hn', 'r1', 'Agent mesh router alpha'),
      item('hn', 'r2', 'Agent mesh router beta'),
      item('github', 'r3', 'x/agent-mesh-router — Agent mesh router gamma'),
      item('github', 'r4', 'y/agent-mesh-router — Agent mesh router delta'),
      item('hn', 'r5', 'Agent mesh basics'),
    ];
    const list = extractCandidates(items);
    const keywords = list.map((c) => c.keyword);
    expect(keywords).toContain('agent mesh');
    expect(keywords).not.toContain('agent mesh router');
    // 鎖（`mesh router` ⊂ `agent mesh router` ⊂ `agent mesh`）は 1 つに畳む
    expect(keywords).not.toContain('mesh router');
    expect(list.find((c) => c.keyword === 'agent mesh')?.relatedTerms).toEqual([
      'agent mesh router',
      'mesh router',
    ]);
  });

  it('重なりは和集合を分母にする（共通集合だと包含関係では常に 1 になる）', () => {
    expect(EXTRACT_LIMITS.mergeOverlap).toBe(0.8);
    expect(itemOverlap(new Set(['a', 'b']), new Set(['a', 'b']))).toBe(1);
    expect(itemOverlap(new Set(['a', 'b', 'c', 'd', 'e']), new Set(['a', 'b', 'c', 'd']))).toBe(0.8);
    expect(itemOverlap(new Set(['a', 'b', 'c']), new Set(['a']))).toBeCloseTo(1 / 3, 5);
    expect(itemOverlap(new Set<string>(), new Set(['a']))).toBe(0);
  });

  it('包含判定はトークン列の連続部分列（部分文字列ではない）', () => {
    expect(containsPhrase('self improving agents', 'improving agents')).toBe(true);
    expect(containsPhrase('self improving agents', 'self improving')).toBe(true);
    expect(containsPhrase('self improving agents', 'self agents')).toBe(false);
    // 語の途中では当たらない（`agent` は `agentic mesh` に含まれない）
    expect(containsPhrase('agentic mesh', 'agent')).toBe(false);
    // 同じ句は包含扱いにしない（自分を吸わせない）
    expect(containsPhrase('agent mesh', 'agent mesh')).toBe(false);
  });
});
