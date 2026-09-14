/**
 * ドメインの空き・価格を 1 コマンドで調べる CLI。
 *
 *   npm run check:domains -- example.com zzq7x4vk2mlp9dwhrn3btf6.com
 *
 * このコマンドは調査のための照会だけを行う。購入・登録・カート追加は一切しない
 * （そのためのコードがリポジトリに存在しない）。
 */
import { resetEnvCache } from '../src/lib/env';
import { getHttpStats } from '../src/lib/http';
import { getDb } from '../src/lib/db/client';
import { MANUAL_SEARCH_LIMIT, searchDomains } from '../src/lib/domain/index';

const USAGE = `使い方: npm run check:domains -- <domain> [domain...]

  --offline   fixtures だけで動かす
  --no-db     DB に履歴を残さない（負のキャッシュも使わない）

最大 ${MANUAL_SEARCH_LIMIT} 件。MVP は .com のみ。価格が取れない場合は "Price unavailable" と表示します。`;

function fmtPrice(value: number | null, currency: string | null): string {
  if (value === null) return 'Price unavailable';
  return `${currency === 'USD' ? '$' : `${currency ?? ''} `}${value.toFixed(2)} / yr`;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const offline = argv.includes('--offline');
  const noDb = argv.includes('--no-db');
  const domains = argv.filter((a) => !a.startsWith('--'));
  const domainCount = domains.flatMap((input) => input.split(/[\n,\s]+/).filter(Boolean)).length;

  if (domains.length === 0) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  if (domainCount > MANUAL_SEARCH_LIMIT) {
    process.stderr.write(`一度に判定できるのは最大 ${MANUAL_SEARCH_LIMIT} 件です（入力: ${domainCount} 件）。\n`);
    process.exitCode = 1;
    return;
  }
  if (offline) {
    process.env.RADAR_OFFLINE = '1';
    resetEnvCache();
  }

  const db = noDb ? undefined : getDb();
  const reports = await searchDomains(domains.join('\n'), { db });

  for (const r of reports) {
    process.stdout.write(`\n${r.domain}\n`);
    process.stdout.write(`  Availability   : ${r.availability.toUpperCase()} (source: ${r.availabilitySource})\n`);
    process.stdout.write(`  Registration   : ${fmtPrice(r.registrationPrice, r.currency)}\n`);
    process.stdout.write(`  Renewal        : ${fmtPrice(r.renewalPrice, r.currency)}\n`);
    process.stdout.write(`  Premium        : ${r.premium}\n`);
    process.stdout.write(`  Price source   : ${r.priceSource ?? '—'}\n`);
    process.stdout.write(`  Checked at     : ${r.checkedAt}\n`);
    for (const link of r.officialLinks) process.stdout.write(`  ${link.label.padEnd(14)} : ${link.url}\n`);
    for (const note of r.notes) process.stdout.write(`  note           : ${note}\n`);
  }

  const stats = getHttpStats();
  const total = Object.values(stats.callsByHost).reduce((a, b) => a + b, 0);
  process.stdout.write(`\n外部呼び出し ${total} 件 ${JSON.stringify(stats.callsByHost)}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`判定に失敗しました: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
