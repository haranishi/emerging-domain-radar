/**
 * ローカルの Codex CLI による候補抽出（任意・`LLM_PROVIDER=codex-cli`）。
 * ChatGPT ログイン認証で動くので追加課金が無い。
 *
 * 実行形は architecture §7 のとおり:
 *   codex exec -s read-only --skip-git-repo-check -c model_reasoning_effort=low -o <tmp> "<prompt>"
 *
 * 落とし穴: stdin を開いたままにすると codex が入力待ちで固まる。
 *          必ず `stdio: ['ignore', 'pipe', 'pipe']` にして stdin を閉じる。
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getEnv } from '../../env';
import { logStep } from '../../http';
import { buildUserPrompt, SYSTEM_PROMPT } from '../prompt';
import { parseExtraction, type KeywordExtractor, type LlmKeyword } from './types';
import type { HarvestItem } from '../../trend/types';

const TIMEOUT_MS = 300_000;
const LIMIT_PATTERNS = [/usage limit/i, /out of credits/i];

export const codexCliExtractor: KeywordExtractor = {
  name: 'codex-cli',

  async extract(items: HarvestItem[]): Promise<LlmKeyword[]> {
    const env = getEnv();
    const dir = mkdtempSync(path.join(tmpdir(), 'edr-codex-'));
    const outFile = path.join(dir, 'out.txt');
    const prompt = `${SYSTEM_PROMPT}\n\n---\n\n${buildUserPrompt(items)}`;

    try {
      const result = await run(
        'codex',
        ['exec', '-s', 'read-only', '--skip-git-repo-check', '-c', 'model_reasoning_effort=low', '-o', outFile, prompt],
        env.CODEX_HOME,
      );
      if (LIMIT_PATTERNS.some((re) => re.test(result.stderr) || re.test(result.stdout))) {
        logStep('extract', 'Codex CLI が上限に達していたので LLM 抽出をスキップしました');
        return [];
      }
      if (result.code !== 0) {
        logStep('extract', `Codex CLI が異常終了しました（exit=${result.code}）。ルールベースだけで続行します`);
        return [];
      }
      const text = readFileSync(outFile, 'utf8');
      return parseExtraction(text);
    } catch (err) {
      logStep('extract', `Codex CLI を実行できませんでした（${err instanceof Error ? err.name : 'error'}）`);
      return [];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  },
};

interface RunResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

function run(cmd: string, args: string[], codexHome?: string): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      // stdin を閉じる（開いたままだと codex が標準入力待ちで固まる）
      stdio: ['ignore', 'pipe', 'pipe'],
      env: codexHome ? { ...process.env, CODEX_HOME: codexHome } : process.env,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
    }, TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => {
      stdout += d.toString();
    });
    child.stderr.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}
