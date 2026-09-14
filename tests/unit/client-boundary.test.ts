/**
 * 秘密の境界。env.ts はサーバー専用で、クライアントバンドルに載ってはいけない。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx|js|jsx|mts|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

const files = [...walk(path.join(ROOT, 'src')), ...walk(path.join(ROOT, 'scripts'))];
const rel = (f: string): string => path.relative(ROOT, f).split(path.sep).join('/');

describe('client boundary', () => {
  it("'use client' のファイルはサーバー専用モジュールを値 import しない（import type は可）", () => {
    const hits: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const head = content.slice(0, 200);
      const isClient = /^\s*(['"])use client\1/m.test(head);
      if (!isClient) continue;
      const imports = content.matchAll(/import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g);
      for (const match of imports) {
        const clause = match[1].trim();
        const source = match[2];
        const typeOnly = clause.startsWith('type ') || (
          clause.startsWith('{')
          && clause.endsWith('}')
          && clause.slice(1, -1).split(',').every((name) => name.trim().startsWith('type '))
        );
        if (typeOnly) continue;
        const serverOnly = /(?:^|\/)lib\/env$/.test(source)
          || /^(?:\.\.\/|\.\/)+env$/.test(source)
          || /(?:^|\/)lib\/db\//.test(source)
          || /(?:^|\/)lib\/domain(?:\/index)?$/.test(source)
          || /(?:^|\/)lib\/http$/.test(source);
        if (serverOnly) hits.push(`${rel(file)} -> ${source}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('NEXT_PUBLIC_ を使っていない', () => {
    const hits: string[] = [];
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      if (content.includes('NEXT_PUBLIC_')) hits.push(rel(file));
    }
    expect(hits).toEqual([]);
  });

  it('.env.example に秘密の値が書かれていない（すべて空）', () => {
    const content = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    const assignments = content
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => l.trim());
    expect(assignments.length).toBeGreaterThan(10);
    for (const line of assignments) expect(line.endsWith('=')).toBe(true);
  });

  it('.env.example に §9 の環境変数が全部ある（フェーズ3 の 2 変数を含む）', () => {
    const content = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
    for (const key of [
      'RADAR_DB_PATH', 'RADAR_OFFLINE', 'RADAR_MAX_KEYWORDS', 'RADAR_MAX_NEW_KEYWORDS',
      'RADAR_RDAP_DAILY_BUDGET', 'RADAR_EXTRACT_MAX_ITEMS', 'RADAR_ARXIV_INTERVAL_MS',
      'LLM_PROVIDER', 'ANTHROPIC_API_KEY', 'ANTHROPIC_MODEL', 'CODEX_HOME', 'GITHUB_TOKEN',
      'OPENALEX_MAILTO', 'OPENALEX_API_KEY', 'QIITA_TOKEN', 'PORT',
    ]) {
      expect(content, key).toContain(`${key}=`);
    }
  });

  it('env.ts の describeEnv がキーの値を出さない', async () => {
    process.env.GITHUB_TOKEN = 'ghp_dummy_value_for_test';
    const { describeEnv, resetEnvCache } = await import('../../src/lib/env');
    resetEnvCache();
    const text = describeEnv();
    expect(text).not.toContain('ghp_dummy_value_for_test');
    expect(text).toContain('GITHUB_TOKEN=set');
    delete process.env.GITHUB_TOKEN;
    resetEnvCache();
  });
});
