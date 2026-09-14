/**
 * 各ソースの measure / harvest が fixture の応答形を正しく読めるか。
 * fixture は research の実測応答（フィールド名・入れ子）に合わせてある。
 */
import { describe, expect, it, beforeEach } from 'vitest';
import { OFFLINE_REFERENCE_NOW, resetEnvCache } from '../../src/lib/env';
import { resetHttpStats, getHttpStats } from '../../src/lib/http';
import { hnSource, hnOldestBefore } from '../../src/lib/trend/sources/hn';
import { githubSource } from '../../src/lib/trend/sources/github';
import { arxivSource } from '../../src/lib/trend/sources/arxiv';
import { openalexSource, resetOpenAlexState } from '../../src/lib/trend/sources/openalex';
import { TREND_SOURCES, HARVEST_SOURCES } from '../../src/lib/trend/sources/index';
import { QIITA_AUTH_HOURLY, QIITA_UNAUTH_HOURLY, measureQiita, planQiitaWindows, qiitaBudget } from '../../src/lib/japan/sources/qiita';
import { measureWikipedia, normalizeTitle } from '../../src/lib/japan/sources/wikipedia';
import { fetchJaEquivalent, langlinksUrl, normalizeTitleKey } from '../../src/lib/japan/sources/langlinks';

const NOW = OFFLINE_REFERENCE_NOW;

beforeEach(() => {
  resetEnvCache();
  resetHttpStats();
  resetOpenAlexState();
});

describe('ソースの一覧', () => {
  it('計測は hn / github / arxiv / openalex の 4 つ', () => {
    expect(TREND_SOURCES.map((s) => s.id)).toEqual(['hn', 'github', 'arxiv', 'openalex']);
  });

  it('harvest は openalex を含まない（件数計測専用）', () => {
    expect(HARVEST_SOURCES.map((s) => s.id)).toEqual(['hn', 'github', 'arxiv']);
  });

  it('キー無しでも全ソースが有効', () => {
    const env = { GITHUB_TOKEN: undefined } as never;
    for (const s of TREND_SOURCES) expect(s.enabled(env)).toBe(true);
  });
});

describe('hn', () => {
  it('created_at_i で 4 窓に振り分ける', async () => {
    const r = await hnSource.measure('context engineering', NOW);
    expect(r.counts['7d']).toBe(5);
    expect(r.counts.prev7d).toBe(7);
    expect(r.counts['30d']).toBe(17);
    expect(r.counts.prev30d).toBe(5);
    expect(r.approximate).toBe(false);
  });

  it('観測できた最古の日付を返す（Novelty の材料）', async () => {
    const r = await hnSource.measure('context engineering', NOW);
    expect(r.oldestSeenAt).toBeDefined();
    expect(Date.parse(r.oldestSeenAt as string)).toBeLessThan(NOW.getTime());
  });

  it('Evidence URL は引用符付きフレーズで作る', () => {
    expect(hnSource.evidenceUrl('context engineering')).toBe(
      'https://hn.algolia.com/?q=%22context%20engineering%22&dateRange=pastMonth&type=all',
    );
  });

  it('measure は 1 リクエストで済む（60 日ぶんを一括取得）', async () => {
    await hnSource.measure('context engineering', NOW);
    expect(getHttpStats().callsByHost['hn.algolia.com']).toBe(1);
  });

  it('取得失敗は 0 件ではなく例外にする（Breadth の分母をずらさない）', async () => {
    await expect(hnSource.measure('__fail__', NOW)).rejects.toThrow(/status=500/);
  });

  it('harvest はタイトルを返す', async () => {
    const items = await hnSource.harvest(NOW);
    expect(items.length).toBeGreaterThan(10);
    expect(items[0].source).toBe('hn');
    expect(items[0].title.length).toBeGreaterThan(0);
    expect(items[0].url).toBeTruthy();
  });

  it('60 日より前のヒットを 1 回で確認する', async () => {
    const result = await hnOldestBefore('context engineering', NOW);
    expect(result.oldestSeenAt).not.toBeNull();
    expect(Date.parse(result.oldestSeenAt as string)).toBeLessThan(NOW.getTime() - 60 * 86_400_000);
    expect(result.approximate).toBe(false);
    expect(getHttpStats().callsByLabel['hn-novelty']).toBe(2);
  });

  it('60 日より前が 0 件なら日付なし、1000 件超なら初出日不明の 365 日超近似にする', async () => {
    const none = await hnOldestBefore('__hn_none__', NOW);
    expect(none).toEqual({ oldestSeenAt: null, approximate: false });
    const many = await hnOldestBefore('__hn_many__', NOW);
    expect(many).toEqual({ oldestSeenAt: null, approximate: true });
  });

  it('最古の追加取得は 1 ≤ nbHits ≤ 1000 のときだけ（0 件・1000 件超は 1 リクエスト）', async () => {
    // 0 件: 60 日より前に言及が無いので最終ページを引かない
    await hnOldestBefore('__hn_none__', NOW);
    expect(getHttpStats().callsByLabel['hn-novelty']).toBe(1);
    // 1000 件超: Algolia のページング上限で最古に届かないので引かない
    resetHttpStats();
    await hnOldestBefore('__hn_many__', NOW);
    expect(getHttpStats().callsByLabel['hn-novelty']).toBe(1);
    // 3 件: page=nbHits-1 を 1 回だけ追加で引く
    resetHttpStats();
    await hnOldestBefore('context engineering', NOW);
    expect(getHttpStats().callsByLabel['hn-novelty']).toBe(2);
  });
});

describe('github', () => {
  it('total_count を 4 窓ぶん読む', async () => {
    const r = await githubSource.measure('context engineering', NOW);
    expect(r.counts).toEqual({ '7d': 7, prev7d: 6, '30d': 24, prev30d: 11 });
    expect(r.approximate).toBe(false);
    expect(getHttpStats().callsByHost['api.github.com']).toBe(4);
  });

  it('harvest はトピック 5 件ぶん問い合わせる', async () => {
    const items = await githubSource.harvest(NOW);
    expect(getHttpStats().callsByHost['api.github.com']).toBe(5);
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].title).toContain('—');
  });

  it('Evidence URL', () => {
    expect(githubSource.evidenceUrl('agent mesh')).toContain('https://github.com/search?q=%22agent%20mesh%22');
  });
});

describe('arxiv', () => {
  it('Atom の published で 4 窓に振り分ける', async () => {
    const r = await arxivSource.measure('context engineering', NOW);
    expect(r.counts['7d']).toBe(2);
    expect(r.counts.prev7d).toBe(1);
    expect(r.counts['30d']).toBe(5);
    expect(r.counts.prev30d).toBe(2);
  });

  it('60 日で 1 リクエスト', async () => {
    await arxivSource.measure('context engineering', NOW);
    expect(getHttpStats().callsByHost['export.arxiv.org']).toBe(1);
  });

  it('harvest は cs.AI 等の新着を返す', async () => {
    const items = await arxivSource.harvest(NOW);
    expect(items.length).toBe(12);
    expect(items[0].source).toBe('arxiv');
    expect(items[0].url).toContain('arxiv.org');
  });
});

describe('openalex', () => {
  it('group_by 応答の meta.count を読む', async () => {
    const r = await openalexSource.measure('context engineering', NOW);
    expect(r.counts).toEqual({ '7d': 3, prev7d: 2, '30d': 14, prev30d: 8 });
    expect(getHttpStats().callsByHost['api.openalex.org']).toBe(4);
  });

  it('課金コストを記録する（$0.0001 × 4）', async () => {
    await openalexSource.measure('context engineering', NOW);
    expect(getHttpStats().openalexCostUsd).toBeCloseTo(0.0004, 8);
  });

  it('harvest は空（候補抽出には使わない）', async () => {
    expect(await openalexSource.harvest(NOW)).toEqual([]);
  });
});

describe('qiita', () => {
  it('Total-Count ヘッダから 30d / prev30d を読む', async () => {
    const r = await measureQiita('MCPサーバー', NOW);
    expect(r?.c30).toBe(12);
    expect(r?.c30prev).toBe(4);
    expect(getHttpStats().callsByHost['qiita.com']).toBe(2);
  });

  it('Total-Count が無い応答は unavailable', async () => {
    expect(await measureQiita('__japan_unavailable__', NOW)).toBeNull();
  });

  it('複数語は引用符で囲んで窓を分ける', async () => {
    // 窓別 fixture は `query="agent mesh" created:>=2026-08-04` の形にしか当たらない。
    // 引用符を外すか窓の日付を間違えると fixture が無く例外になる。
    const r = await measureQiita('agent mesh', NOW);
    expect(r).toMatchObject({ c30: 12, c30prev: 4 });
    expect(getHttpStats().callsByHost['qiita.com']).toBe(2);
  });
});

describe('wikipedia', () => {
  it('表記ゆれを潰して比較する', () => {
    expect(normalizeTitle('バイブ・コーディング')).toBe(normalizeTitle('バイブコーディング'));
    expect(normalizeTitle('Agent Mesh')).toBe(normalizeTitle('agent-mesh'));
  });

  it('タイトルが一致しなければ wikiJa=false（PV も引かない）', async () => {
    const r = await measureWikipedia('agent mesh', NOW);
    expect(r.wikiJa).toBe(false);
    expect(r.pv30).toBe(0);
    expect(r.ok).toBe(true);
    expect(getHttpStats().callsByHost['wikimedia.org']).toBeUndefined();
  });

  it('一致すれば正規タイトルへ解決してから 30 日 PV を合計する', async () => {
    const r = await measureWikipedia('model context protocol', NOW);
    expect(r.wikiJa).toBe(true);
    expect(r.title).toBe('Model Context Protocol');
    expect(r.pv30).toBeGreaterThan(0);
    // 検索 → 正規タイトル解決 → PV の 3 リクエスト。
    // リダイレクト解決を挟まないと PV が桁違いにずれる（research/04 §1.4）。
    expect(getHttpStats().callsByHost['ja.wikipedia.org']).toBe(2);
    expect(getHttpStats().callsByHost['wikimedia.org']).toBe(1);
  });

  it('カタカナ表記の記事は英語フレーズと正規化一致しない（既知の限界）', async () => {
    // ja.wikipedia に「バイブコーディング」があっても、英語の 'vibe coding' とは
    // 文字列として一致しないので wikiJa は false になる。
    // 音写を辞書で対応付けない限り、この経路では拾えない（Japan Gap は Qiita 側で効く）。
    const r = await measureWikipedia('vibe coding', NOW);
    expect(r.wikiJa).toBe(false);
    expect(r.pv30).toBe(0);
  });
});

describe('langlinks（日本語での呼び方・フェーズ3）', () => {
  it('URL は en.wikipedia の langlinks 1 リクエスト分', () => {
    expect(langlinksUrl('vibe coding')).toBe(
      'https://en.wikipedia.org/w/api.php?action=query&titles=vibe+coding&prop=langlinks&lllang=ja&redirects=1&format=json',
    );
  });

  it('日本語版へのリンクがあれば日本語タイトルを返す（1 リクエスト）', async () => {
    const r = await fetchJaEquivalent('vibe coding');
    expect(r).toEqual({ title: 'バイブコーディング', enTitle: 'Vibe coding', ok: true });
    expect(getHttpStats().callsByHost['en.wikipedia.org']).toBe(1);
  });

  it('英語版に記事が無ければ title=null・ok=true（英語フレーズのまま測る）', async () => {
    const r = await fetchJaEquivalent('agent mesh');
    expect(r.title).toBeNull();
    expect(r.ok).toBe(true);
  });

  it('記事はあるが日本語版が無ければ title=null・ok=true', async () => {
    const r = await fetchJaEquivalent('semantic caching');
    expect(r.title).toBeNull();
    expect(r.enTitle).toBe('Semantic caching');
    expect(r.ok).toBe(true);
  });

  it('HTTP が失敗したら ok=false（「日本語版が無い」とは区別する）', async () => {
    const r = await fetchJaEquivalent('__langlinks_fail__');
    expect(r).toEqual({ title: null, enTitle: null, ok: false });
  });

  it('リダイレクトで別記事に着地したら訳として採用しない', async () => {
    // fixture: `world model` → リダイレクト `Mental model` → 日本語「メンタルモデル」
    const r = await fetchJaEquivalent('world model');
    expect(r.title).toBeNull();
    expect(r.enTitle).toBe('Mental model');
    expect(r.ok).toBe(true);
  });

  it('リダイレクト先が同じ語なら採用する（大文字小文字・ハイフンの差だけ）', async () => {
    // fixture: `vibe-coding` → リダイレクト `Vibe coding`（正規化すると一致）
    const r = await fetchJaEquivalent('vibe-coding');
    expect(r).toEqual({ title: 'バイブコーディング', enTitle: 'Vibe coding', ok: true });
  });

  it('タイトルの正規化は小文字化と空白/ハイフンの統一だけ', () => {
    expect(normalizeTitleKey('Vibe-Coding')).toBe('vibe coding');
    expect(normalizeTitleKey('  World   Model ')).toBe('world model');
    expect(normalizeTitleKey('World_model')).toBe('world model');
    expect(normalizeTitleKey('Mental model')).not.toBe(normalizeTitleKey('World model'));
  });
});

describe('qiita の日本語訳合算と予算（フェーズ3）', () => {
  it('日本語タイトルがあれば英語と日本語の件数を合算する（4 リクエスト）', async () => {
    const r = await measureQiita('vibe coding', NOW, { jaKeyword: 'バイブコーディング' });
    // 英語 12 + 日本語 12 = 24、prev は 4 + 4 = 8
    expect(r?.c30).toBe(24);
    expect(r?.c30prev).toBe(8);
    expect(r?.jaKeyword).toBe('バイブコーディング');
    expect(r?.calls).toBe(4);
    expect(r?.skippedWindows).toEqual([]);
    expect(getHttpStats().callsByHost['qiita.com']).toBe(4);
  });

  it('予算に入らない窓は省き、省いた窓を報告する', async () => {
    const r = await measureQiita('vibe coding', NOW, {
      jaKeyword: 'バイブコーディング',
      plan: { enRecent: true, jaRecent: true, enPrev: false, jaPrev: false },
    });
    expect(r?.c30).toBe(24);
    expect(r?.c30prev).toBe(0);
    expect(r?.calls).toBe(2);
    expect(r?.skippedWindows).toEqual(['en prev30d', 'ja prev30d']);
    expect(getHttpStats().callsByHost['qiita.com']).toBe(2);
  });

  it('日本語タイトルが無ければ英語だけを測る（呼び出しは増えない）', async () => {
    const r = await measureQiita('agent mesh', NOW, { jaKeyword: null });
    expect(r?.c30).toBe(12);
    expect(r?.jaKeyword).toBeNull();
    expect(r?.calls).toBe(2);
  });

  it('未認証 60 req/h では 25 語で「英語 30d + 日本語 30d」までが入る', () => {
    expect(qiitaBudget()).toBe(QIITA_UNAUTH_HOURLY);
    expect(planQiitaWindows(25, QIITA_UNAUTH_HOURLY)).toEqual({
      enRecent: true, jaRecent: true, enPrev: false, jaPrev: false,
    });
    // 語数が少なければ 4 窓とも取れる
    expect(planQiitaWindows(2, QIITA_UNAUTH_HOURLY)).toEqual({
      enRecent: true, jaRecent: true, enPrev: true, jaPrev: true,
    });
    // 認証時は 1000 req/h なので 25 語でも 4 窓
    expect(planQiitaWindows(25, QIITA_AUTH_HOURLY).jaPrev).toBe(true);
  });

  it('QIITA_TOKEN があれば予算は 1000 req/h', () => {
    process.env.QIITA_TOKEN = 'dummy';
    resetEnvCache();
    try {
      expect(qiitaBudget()).toBe(QIITA_AUTH_HOURLY);
    } finally {
      delete process.env.QIITA_TOKEN;
      resetEnvCache();
    }
  });
});

describe('wikipedia の日本語タイトル指定（フェーズ3）', () => {
  it('日本語タイトルを渡せばカタカナ記事も拾える（検索を挟まず info 1 回）', async () => {
    const r = await measureWikipedia('vibe coding', NOW, { jaTitle: 'バイブコーディング' });
    expect(r.wikiJa).toBe(true);
    expect(r.title).toBe('バイブコーディング');
    expect(r.pv30).toBeGreaterThan(0);
    expect(r.ok).toBe(true);
    // 検索経由の 2 回ではなく、存在判定 1 回だけ
    expect(getHttpStats().callsByHost['ja.wikipedia.org']).toBe(1);
    expect(getHttpStats().callsByHost['wikimedia.org']).toBe(1);
  });

  it('空文字の日本語タイトルは「無し」と同じ扱い（検索経由に戻る）', async () => {
    const r = await measureWikipedia('agent mesh', NOW, { jaTitle: '  ' });
    expect(r.wikiJa).toBe(false);
    expect(r.ok).toBe(true);
  });
});
