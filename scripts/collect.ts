/**
 * 収集パイプラインの CLI。
 *
 *   npm run radar:collect
 *   npm run radar:collect -- --max-keywords 3
 *   npm run radar:collect -- --keywords "context engineering,agentic protocol"
 *   npm run radar:collect -- --dry-run
 *   npm run radar:collect -- --offline
 *
 * cron / launchd からはこのコマンドをそのまま呼ぶ（README 参照）。
 */
import { resetEnvCache } from '../src/lib/env';
import { runCollect } from '../src/pipeline/collect';

interface Args {
  maxKeywords?: number;
  maxNewKeywords?: number;
  skipLlm: boolean;
  keywords?: string[];
  dryRun: boolean;
  offline: boolean;
  help: boolean;
}

function parseArgs(argv: string[]): Args {
  const out: Args = { skipLlm: false, dryRun: false, offline: false, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const next = (): string => argv[++i] ?? '';
    if (a === '--max-keywords') out.maxKeywords = Number(next());
    else if (a === '--max-new-keywords') out.maxNewKeywords = Number(next());
    else if (a === '--skip-llm') out.skipLlm = true;
    else if (a === '--keywords') out.keywords = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--offline') out.offline = true;
    else if (a === '--help' || a === '-h') out.help = true;
  }
  return out;
}

const USAGE = `使い方: npm run radar:collect -- [オプション]

  --max-keywords N       このランで計測するキーワードの上限（既定: RADAR_MAX_KEYWORDS=25）
  --max-new-keywords N   新規に採用するキーワードの上限（既定: RADAR_MAX_NEW_KEYWORDS=15）
  --keywords "a,b"       指定した語だけを計測（harvest と抽出をスキップ）
  --skip-llm             LLM 抽出を使わない
  --dry-run              外部呼び出し件数の見積りだけ出す
  --offline              fixtures だけで動かす（RADAR_OFFLINE=1 と同じ）
  --help                 この表示

このツールはドメインを購入しません。表示は調査のための情報だけです。`;

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (args.offline) {
    process.env.RADAR_OFFLINE = '1';
    resetEnvCache();
  }
  const result = await runCollect({
    maxKeywords: Number.isFinite(args.maxKeywords) ? args.maxKeywords : undefined,
    maxNewKeywords: Number.isFinite(args.maxNewKeywords) ? args.maxNewKeywords : undefined,
    skipLlm: args.skipLlm,
    keywords: args.keywords,
    dryRun: args.dryRun,
  });
  if (result.status === 'failed') process.exitCode = 1;
}

main().catch((err: unknown) => {
  process.stderr.write(`収集に失敗しました: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
