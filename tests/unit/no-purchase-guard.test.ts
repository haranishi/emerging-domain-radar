/**
 * 購入禁止の機械的な保証（docs/01_requirements.md §3・architecture §3）。
 *
 * このテストが落ちたら、購入・登録・カート・入札・決済に触れるコードが混ざったということ。
 * 直し方は「禁止リストを緩める」ではなく「そのコードを消す」。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const SCAN_DIRS = ['src', 'scripts'];

/** 禁止識別子。定義も呼び出しも許さない。 */
const FORBIDDEN_IDENTIFIERS = [
  'registerDomain',
  'purchaseDomain',
  'checkoutDomain',
  'bidDomain',
  'createDomain',
  'buyDomain',
  'addToCart',
  'placeOrder',
  // Porkbun の空き判定 API（POST・1 件/10 秒）は MVP では使わない
  'checkDomain',
];

/** 禁止 API パス。links.ts の「公式サイトで確認」URL だけは例外。 */
const FORBIDDEN_PATHS = [
  'domain/create',
  'domains/purchase',
  'domains.create',
  '/purchase',
  '/checkout',
  '/cart',
  '/bid',
  '/order',
];

/** 例外: レジストラの検索画面リンク（購入 URL ではない）。 */
const PATH_ALLOWLIST: { file: string; text: string }[] = [
  { file: 'src/lib/domain/links.ts', text: 'https://porkbun.com/checkout/search?q=' },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|mts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

function sourceFiles(): string[] {
  return SCAN_DIRS.flatMap((d) => {
    const full = path.join(ROOT, d);
    try {
      return statSync(full).isDirectory() ? walk(full) : [];
    } catch {
      return [];
    }
  });
}

function relative(file: string): string {
  return path.relative(ROOT, file).split(path.sep).join('/');
}

/** 許可された文字列だけを取り除いてから検査する。 */
function scrub(rel: string, content: string): string {
  let text = content;
  for (const allow of PATH_ALLOWLIST) {
    if (rel === allow.file) text = text.split(allow.text).join('__ALLOWED_LINK__');
  }
  return text;
}

/* ------------------------------------------------- リクエストの静的解析 */

/**
 * 宛先の種別。
 *  - `same-origin`: 自サイトの相対パス（`/api/...`）。自分の DB を触るだけなので許可。
 *  - `external-url`: `http(s)://` で始まる絶対 URL・`//host` の省略形。
 *  - `unknown`: 変数・関数の戻り値。外部かどうか静的には決まらないので外部として扱う。
 */
export type RequestTarget = 'same-origin' | 'external-url' | 'unknown';

export interface RequestCall {
  /** 1 始まりの行番号。 */
  line: number;
  callee: string;
  target: RequestTarget;
  targetText: string;
  /** 大文字。`method` を書かなければ GET。 */
  method: string;
  /** 引数リストの範囲（`method:` がこの呼び出しに属するかの判定に使う）。 */
  argsStart: number;
  argsEnd: number;
}

/**
 * `fetch` の呼び名。`const request = globalThis.fetch` のような束縛替えも拾う。
 * これを見ないと、識別子を変えるだけでガードを抜けられる。
 */
export function calleeNames(content: string): string[] {
  const names = new Set(['fetch']);
  const alias = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:globalThis|window|self)\s*\.\s*fetch\b/g;
  for (const m of content.matchAll(alias)) names.add(m[1]);
  return [...names];
}

/** 文字列・テンプレートの中を読み飛ばしながら、`(` に対応する `)` を探す。 */
function matchParen(content: string, openParen: number): number | null {
  let depth = 0;
  let quote: string | null = null;
  for (let i = openParen; i < content.length; i += 1) {
    const ch = content[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return null;
}

/** 引数リストの先頭の引数（トップレベルの `,` まで）。 */
function firstArg(args: string): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < args.length; i += 1) {
    const ch = args[i];
    if (quote !== null) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') quote = ch;
    else if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ',' && depth === 0) return args.slice(0, i);
  }
  return args;
}

/** 第 1 引数のテキストから宛先を判定する。 */
export function classifyTarget(arg: string): RequestTarget {
  const text = arg.trim();
  const quote = text[0];
  if (quote !== "'" && quote !== '"' && quote !== '`') return 'unknown';
  const body = text.slice(1);
  if (/^https?:\/\//i.test(body) || body.startsWith('//')) return 'external-url';
  if (body.startsWith('/')) return 'same-origin';
  return 'unknown';
}

const METHOD_LITERAL = /\bmethod\s*:\s*(['"`])\s*([A-Za-z]+)\s*\1/;

const lineOf = (content: string, index: number): number => content.slice(0, index).split('\n').length;

/** ソース中のリクエスト呼び出しを列挙する。 */
export function findRequestCalls(content: string): RequestCall[] {
  const out: RequestCall[] = [];
  for (const callee of calleeNames(content)) {
    const call = new RegExp(`\\b${callee}\\s*\\(`, 'g');
    for (const m of content.matchAll(call)) {
      const openParen = m.index + m[0].length - 1;
      // `globalThis.fetch(...)` は `fetch(` としても当たるので、二重に数えない。
      if (out.some((c) => c.argsStart === openParen + 1)) continue;
      const close = matchParen(content, openParen);
      if (close === null) continue;
      const args = content.slice(openParen + 1, close);
      const target = firstArg(args);
      const method = METHOD_LITERAL.exec(args);
      out.push({
        line: lineOf(content, m.index),
        callee,
        target: classifyTarget(target),
        targetText: target.trim().slice(0, 80),
        method: (method?.[2] ?? 'GET').toUpperCase(),
        argsStart: openParen + 1,
        argsEnd: close,
      });
    }
  }
  return out.sort((a, b) => a.argsStart - b.argsStart);
}

/** ソース中の `method: '...'` を全部拾う（引用符の種類は問わない）。 */
export function findMethodLiterals(content: string): { line: number; index: number; method: string }[] {
  const out: { line: number; index: number; method: string }[] = [];
  const re = new RegExp(METHOD_LITERAL.source, 'g');
  for (const m of content.matchAll(re)) {
    out.push({ line: lineOf(content, m.index), index: m.index, method: m[2].toUpperCase() });
  }
  return out;
}

/** 自作の http.ts 以外の HTTP クライアント。static / side-effect / dynamic import と require を見る。 */
const FORBIDDEN_CLIENTS = 'axios|node:https|undici|got';
const FORBIDDEN_CLIENT_IMPORT = new RegExp(
  `(?:import[\\s\\S]*?from\\s*|import\\s*)['"](?:${FORBIDDEN_CLIENTS})['"]` +
    `|\\bimport\\s*\\(\\s*['"](?:${FORBIDDEN_CLIENTS})['"]\\s*\\)` +
    `|\\brequire\\s*\\(\\s*['"](?:${FORBIDDEN_CLIENTS})['"]\\s*\\)`,
  'i',
);

/**
 * コメントだけの行を空行にする。
 * 「なぜ fetch を直接書かないか」を説明したコメントまで違反になると、
 * 説明を消す方向に圧力がかかって規約の理由が失われる。
 * 行頭が `//` `*` `/*` の行にコードは無いので、消しても呼び出しは見逃さない。
 * 行数は保つ（違反の行番号をそのまま報告するため）。
 */
export function withoutCommentLines(content: string): string {
  return content
    .split('\n')
    .map((line) => {
      const t = line.trim();
      return t.startsWith('//') || t.startsWith('*') || t.startsWith('/*') ? '' : line;
    })
    .join('\n');
}

/** 走査対象の本文（許可リストを取り除き、コメント行を空行にしたもの）。 */
function scannable(rel: string, content: string): string {
  return withoutCommentLines(scrub(rel, content));
}

describe('no-purchase guard', () => {
  const files = sourceFiles();

  it('走査対象のファイルが存在する', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it('禁止識別子が 1 つも無い', () => {
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel.startsWith('tests/')) continue;
      const content = readFileSync(file, 'utf8');
      content.split('\n').forEach((line, i) => {
        for (const id of FORBIDDEN_IDENTIFIERS) {
          if (line.includes(id)) hits.push(`${rel}:${i + 1} ${id}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('禁止 API パスが 1 つも無い（links.ts の検索 URL のみ例外）', () => {
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      const content = scrub(rel, readFileSync(file, 'utf8'));
      content.split('\n').forEach((line, i) => {
        for (const p of FORBIDDEN_PATHS) {
          if (line.includes(p)) hits.push(`${rel}:${i + 1} ${p}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  it('porkbun-pricing.ts に pricing/get 以外の /api/json/v3/ パスが無い', () => {
    const file = path.join(ROOT, 'src/lib/domain/providers/porkbun-pricing.ts');
    const content = readFileSync(file, 'utf8');
    const matches = content.match(/\/api\/json\/v3\/[A-Za-z0-9/_-]*/g) ?? [];
    expect(matches.length).toBeGreaterThan(0);
    for (const m of matches) expect(m).toBe('/api/json/v3/pricing/get');
  });

  it('domain/index.ts が公開するのは checkAvailability / getPricing / searchDomains の 3 関数だけ', async () => {
    const mod = (await import('../../src/lib/domain/index')) as Record<string, unknown>;
    const functions = Object.entries(mod)
      .filter(([, v]) => typeof v === 'function')
      .map(([k]) => k)
      .sort();
    expect(functions).toEqual(['checkAvailability', 'getPricing', 'searchDomains']);
  });

  /**
   * 検出するのは「外部への GET 以外」だけにする。
   *
   * 以前は行単位で `method: 'POST'` を全部落としていた。禁止したいのはレジストラへの
   * 登録・購入なのに、自サイトの `/api/watchlist` への POST まで違反になったため、
   * クライアント部品がバッククォート（`method: \`POST\``）と `globalThis.fetch` の
   * 別名で回避する形になっていた。ガードを避けるためのコードが増えるのは、
   * ガードの方が間違っているという意味なのでこちらを直した。
   */
  it('外部への GET 以外のリクエストが無い（自サイトの /api への POST・DELETE は可）', () => {
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      const content = scannable(rel, readFileSync(file, 'utf8'));
      const calls = findRequestCalls(content);
      for (const call of calls) {
        if (call.method !== 'GET' && call.target !== 'same-origin') {
          hits.push(`${rel}:${call.line} ${call.method} → ${call.targetText}`);
        }
      }
      // 呼び出しの外に置いた `method:` で抜けられないようにする。
      // 非 GET は「同一オリジンのリクエストの引数の中」にしか書けない。
      for (const lit of findMethodLiterals(content)) {
        if (lit.method === 'GET') continue;
        const owner = calls.find(
          (c) => c.target === 'same-origin' && lit.index > c.argsStart && lit.index < c.argsEnd,
        );
        if (!owner) hits.push(`${rel}:${lit.line} ${lit.method}（宛先が同一オリジンだと確認できない）`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('外部ホストへのリクエストは src/lib/http.ts だけ（相対パスの自 API 呼び出しは可）', () => {
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      if (rel === 'src/lib/http.ts') continue;
      for (const call of findRequestCalls(scannable(rel, readFileSync(file, 'utf8')))) {
        if (call.target !== 'same-origin') hits.push(`${rel}:${call.line} ${call.targetText}`);
      }
    }
    expect(hits).toEqual([]);

    // http.ts 側は実際にリクエストを持っていて、しかも GET だけ（走査の空振り防止）
    const httpCalls = findRequestCalls(readFileSync(path.join(ROOT, 'src/lib/http.ts'), 'utf8'));
    expect(httpCalls.length).toBeGreaterThan(0);
    expect(httpCalls.map((c) => c.method)).toEqual(httpCalls.map(() => 'GET'));
  });

  it('ガードは外部 URL への POST を検出し、/api/watchlist への POST は通す', () => {
    const external = findRequestCalls("await fetch('https://api.example.com/v3/x', { method: 'POST' });");
    expect(external).toHaveLength(1);
    expect(external[0]).toMatchObject({ target: 'external-url', method: 'POST' });

    const own = findRequestCalls("await fetch('/api/watchlist', { method: 'POST', body });");
    expect(own).toHaveLength(1);
    expect(own[0]).toMatchObject({ target: 'same-origin', method: 'POST' });

    // テンプレートリテラルの相対パス（DELETE）も同一オリジン扱い
    const del = findRequestCalls('await fetch(`/api/watchlist?domain=${encodeURIComponent(d)}`, { method: `DELETE` });');
    expect(del).toHaveLength(1);
    expect(del[0]).toMatchObject({ target: 'same-origin', method: 'DELETE' });

    // method を書かなければ GET・変数の URL は「外部かどうか分からない」
    expect(findRequestCalls("await fetch('https://example.com/x');")[0].method).toBe('GET');
    expect(findRequestCalls('await fetch(url, { method: "GET" });')[0].target).toBe('unknown');
    // 相対でもプロトコル相対（//host）は外部
    expect(classifyTarget("'//evil.example/x'")).toBe('external-url');
  });

  it('ガードはバッククォートと fetch の別名では回避できない', () => {
    const backtick = findRequestCalls('await fetch(\'https://example.com/x\', { method: `POST` });');
    expect(backtick[0]).toMatchObject({ target: 'external-url', method: 'POST' });

    const alias = findRequestCalls(
      "const request = globalThis.fetch;\nawait request('https://example.com/x', { method: 'POST' });",
    );
    expect(calleeNames('const request = globalThis.fetch;')).toEqual(['fetch', 'request']);
    expect(alias).toHaveLength(1);
    expect(alias[0]).toMatchObject({ callee: 'request', target: 'external-url', method: 'POST' });
  });

  it('走査はコメント行を無視し、行番号はずらさない', () => {
    expect(findRequestCalls(withoutCommentLines('  // `fetch(` と直接書かない理由の説明\n  const x = 1;\n'))).toEqual([]);
    expect(findRequestCalls(withoutCommentLines('/**\n * fetch( は http.ts だけ\n */\nconst x = 1;\n'))).toEqual([]);
    const kept = findRequestCalls(withoutCommentLines('// 説明\n// 説明\nconst res = await fetch(url);\n'));
    expect(kept).toHaveLength(1);
    expect(kept[0].line).toBe(3);
  });

  it('http.ts に GET 以外の HTTP メソッド文字列が無い', () => {
    const file = path.join(ROOT, 'src/lib/http.ts');
    const content = readFileSync(file, 'utf8');
    // 引用符の中で改行をまたぐ書き方（`method:\n  'POST'`）も拾う
    expect(content.match(/['"][\s\n]*(?:POST|PUT|PATCH|DELETE)[\s\n]*['"]/gi) ?? []).toEqual([]);
    // 語として現れないところまで見る（'POST ' のように末尾を足した抜け道を作らない）
    expect(content.match(/\b(?:POST|PUT|PATCH|DELETE)\b/gi) ?? []).toEqual([]);
    // 唯一使うメソッドは GET
    expect(content).toMatch(/method:\s*'GET'/);
  });

  it('src に別の HTTP クライアントの import が無い', () => {
    const srcFiles = files.filter((file) => relative(file).startsWith('src/'));
    const hits = srcFiles.filter((file) => FORBIDDEN_CLIENT_IMPORT.test(readFileSync(file, 'utf8'))).map(relative);
    expect(hits).toEqual([]);
  });

  it('別クライアントの検査は static / side-effect / dynamic / require の 4 形を拾う', () => {
    for (const code of [
      "import got from 'got';",
      "import { request } from 'undici';",
      "import 'axios';",
      "const https = await import('node:https');",
      "const axios = require('axios');",
      "import type { Got } from\n  'got';",
    ]) {
      expect(FORBIDDEN_CLIENT_IMPORT.test(code), code).toBe(true);
    }
    // 自作の http.ts と node の標準モジュールは対象外
    for (const code of ["import { httpGet } from '../lib/http';", "import path from 'node:path';"]) {
      expect(FORBIDDEN_CLIENT_IMPORT.test(code), code).toBe(false);
    }
  });

  it('「買うべき」「安全」という断定をコード・出力に書いていない', () => {
    const banned = ['買うべき', '買うべし', '商標的に安全', '安全です', 'safe to buy', 'you should buy'];
    const hits: string[] = [];
    for (const file of files) {
      const rel = relative(file);
      const content = readFileSync(file, 'utf8');
      for (const word of banned) {
        if (content.includes(word)) hits.push(`${rel}: ${word}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
