import { parseArgs } from 'node:util';
import { execSync } from 'node:child_process';
import { VERSION } from '../lib/config.js';
import { bold, cyan, dim, green, yellow } from '../lib/output.js';
import { StateManager } from '../lib/state-manager.js';

const NPM_PACKAGE_NAME = '@loredan-ai/loredan';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE_NAME)}/latest`;

interface UpgradeResult {
  name: 'cli';
  status: 'current' | 'updated' | 'available' | 'error';
  detail: string;
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((segment) => Number.parseInt(segment, 10) || 0);
  const pb = b.split('.').map((segment) => Number.parseInt(segment, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let index = 0; index < max; index += 1) {
    const av = pa[index] ?? 0;
    const bv = pb[index] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function fetchLatestVersion(): Promise<string | null> {
  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': `loredan-cli/${VERSION}`,
      },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = await response.json() as Record<string, unknown>;
    return typeof data.version === 'string' ? data.version : null;
  } catch {
    return null;
  }
}

export async function upgrade(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      check: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const dryRun = Boolean(values.check);
  const results: UpgradeResult[] = [];

  console.log('');
  console.log(bold('Checking for updates...'));
  console.log('');

  const latestVersion = await fetchLatestVersion();
  if (!latestVersion) {
    console.log(`  ${yellow('!')} ${bold('CLI')}: unable to reach npm registry`);
    results.push({ name: 'cli', status: 'error', detail: 'npm unreachable' });
  } else if (compareSemver(latestVersion, VERSION) > 0) {
    if (dryRun) {
      console.log(`  ${yellow('↑')} ${bold('CLI')}: ${VERSION} -> ${cyan(latestVersion)} available`);
      results.push({ name: 'cli', status: 'available', detail: `${VERSION} -> ${latestVersion}` });
    } else {
      try {
        console.log(`  ${yellow('↑')} ${bold('CLI')}: updating ${VERSION} -> ${cyan(latestVersion)}...`);
        execSync(`npm install -g ${NPM_PACKAGE_NAME}`, { stdio: 'pipe' });
        console.log(`  ${green('✓')} ${bold('CLI')}: updated to ${latestVersion}`);
        results.push({ name: 'cli', status: 'updated', detail: `${VERSION} -> ${latestVersion}` });
      } catch {
        console.log(`  ${yellow('!')} ${bold('CLI')}: auto-update failed; run manually: npm install -g ${NPM_PACKAGE_NAME}`);
        results.push({ name: 'cli', status: 'error', detail: 'npm install failed' });
      }
    }
  } else {
    console.log(`  ${green('✓')} ${bold('CLI')}: ${VERSION} (latest)`);
    results.push({ name: 'cli', status: 'current', detail: VERSION });
  }

  if (!dryRun) {
    await StateManager.touchLastCheck();
  }

  console.log('');
  const changed = results.filter((result) => result.status === 'updated' || result.status === 'available').length;
  if (changed > 0) {
    console.log(cyan(`  ${changed} update${changed === 1 ? '' : 's'} ${dryRun ? 'available' : 'applied'}.`));
  } else {
    console.log(dim('  Everything is current.'));
  }
  console.log('');

  if (values.json) {
    console.log(JSON.stringify({
      dryRun,
      results,
    }, null, 2));
  }
}
