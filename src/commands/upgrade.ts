import { parseArgs } from 'node:util';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { execSync } from 'node:child_process';
import { VERSION } from '../lib/config.js';
import { bold, dim, green, yellow, cyan } from '../lib/output.js';

const SKILL_URL = 'https://loredan.ai/skill.md';
const HEARTBEAT_URL = 'https://loredan.ai/heartbeat.md';
const NPM_REGISTRY_URL = 'https://registry.npmjs.org/@loredan/cli/latest';

const SKILL_DIR = join(homedir(), '.loredan', 'skills');
const SKILL_PATH = join(SKILL_DIR, 'SKILL.md');
const HEARTBEAT_PATH = join(SKILL_DIR, 'HEARTBEAT.md');
const STATE_PATH = join(homedir(), '.loredan', 'upgrade-state.json');

interface UpgradeState {
  lastCheck: string;
  skillHash: string | null;
  heartbeatHash: string | null;
}

function simpleHash(content: string): string {
  let hash = 0;
  for (let i = 0; i < content.length; i++) {
    const char = content.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash.toString(36);
}

async function loadState(): Promise<UpgradeState> {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { lastCheck: '', skillHash: null, heartbeatHash: null };
  }
}

async function saveState(state: UpgradeState): Promise<void> {
  await mkdir(join(homedir(), '.loredan'), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': `loredan-cli/${VERSION}` },
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

async function fetchLatestNpmVersion(): Promise<string | null> {
  try {
    const res = await fetch(NPM_REGISTRY_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { 'Accept': 'application/json', 'User-Agent': `loredan-cli/${VERSION}` },
    });
    if (!res.ok) return null;
    const data = await res.json() as any;
    return data.version || null;
  } catch {
    return null;
  }
}

function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
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

  const results: Array<{ name: string; status: 'current' | 'updated' | 'available' | 'error'; detail: string }> = [];
  const state = await loadState();

  // 1. Check npm package version
  console.log('');
  console.log(bold('Checking for updates...'));
  console.log('');

  const latestVersion = await fetchLatestNpmVersion();
  if (latestVersion) {
    const cmp = compareVersions(latestVersion, VERSION);
    if (cmp > 0) {
      if (values.check) {
        console.log(`  ${yellow('↑')} ${bold('CLI')}: ${VERSION} → ${cyan(latestVersion)} available`);
        console.log(`    ${dim('Run:')} npm install -g @loredan/cli`);
        results.push({ name: 'cli', status: 'available', detail: `${VERSION} → ${latestVersion}` });
      } else {
        console.log(`  ${yellow('↑')} ${bold('CLI')}: updating ${VERSION} → ${cyan(latestVersion)}...`);
        try {
          execSync('npm install -g @loredan/cli', { stdio: 'pipe' });
          console.log(`  ${green('✓')} ${bold('CLI')}: updated to ${latestVersion}`);
          results.push({ name: 'cli', status: 'updated', detail: `${VERSION} → ${latestVersion}` });
        } catch (err: any) {
          console.log(`  ${yellow('!')} ${bold('CLI')}: auto-update failed — run manually: npm install -g @loredan/cli`);
          results.push({ name: 'cli', status: 'error', detail: 'npm install failed' });
        }
      }
    } else {
      console.log(`  ${green('✓')} ${bold('CLI')}: ${VERSION} ${dim('(latest)')}`);
      results.push({ name: 'cli', status: 'current', detail: VERSION });
    }
  } else {
    console.log(`  ${yellow('!')} ${bold('CLI')}: could not check npm registry`);
    results.push({ name: 'cli', status: 'error', detail: 'registry unreachable' });
  }

  // 2. Check SKILL.md
  await mkdir(SKILL_DIR, { recursive: true });

  const skillContent = await fetchText(SKILL_URL);
  if (skillContent) {
    const hash = simpleHash(skillContent);
    if (state.skillHash !== hash) {
      await writeFile(SKILL_PATH, skillContent);
      state.skillHash = hash;
      console.log(`  ${green('✓')} ${bold('SKILL.md')}: updated ${dim(`→ ${SKILL_PATH}`)}`);
      results.push({ name: 'skill', status: 'updated', detail: SKILL_PATH });
    } else {
      console.log(`  ${green('✓')} ${bold('SKILL.md')}: current`);
      results.push({ name: 'skill', status: 'current', detail: 'no changes' });
    }
  } else {
    console.log(`  ${yellow('!')} ${bold('SKILL.md')}: could not fetch from ${SKILL_URL}`);
    results.push({ name: 'skill', status: 'error', detail: 'fetch failed' });
  }

  // 3. Check HEARTBEAT.md
  const heartbeatContent = await fetchText(HEARTBEAT_URL);
  if (heartbeatContent) {
    const hash = simpleHash(heartbeatContent);
    if (state.heartbeatHash !== hash) {
      await writeFile(HEARTBEAT_PATH, heartbeatContent);
      state.heartbeatHash = hash;
      console.log(`  ${green('✓')} ${bold('HEARTBEAT.md')}: updated ${dim(`→ ${HEARTBEAT_PATH}`)}`);
      results.push({ name: 'heartbeat', status: 'updated', detail: HEARTBEAT_PATH });
    } else {
      console.log(`  ${green('✓')} ${bold('HEARTBEAT.md')}: current`);
      results.push({ name: 'heartbeat', status: 'current', detail: 'no changes' });
    }
  } else {
    console.log(`  ${yellow('!')} ${bold('HEARTBEAT.md')}: could not fetch from ${HEARTBEAT_URL}`);
    results.push({ name: 'heartbeat', status: 'error', detail: 'fetch failed' });
  }

  // Save state
  state.lastCheck = new Date().toISOString();
  await saveState(state);

  console.log('');

  const updated = results.filter(r => r.status === 'updated' || r.status === 'available');
  if (updated.length > 0) {
    console.log(cyan(`  ${updated.length} update${updated.length === 1 ? '' : 's'} applied.`));
  } else {
    console.log(dim('  Everything is current.'));
  }

  console.log('');

  if (values.json) {
    console.log(JSON.stringify({ version: VERSION, lastCheck: state.lastCheck, results }, null, 2));
  }
}
