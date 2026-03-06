import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { authedGet, apiGet } from '../lib/api-client.js';
import { VERSION, getEndpoint } from '../lib/config.js';
import { credentialsExist, loadCredentials, type Credentials } from '../lib/credentials.js';
import { bold, cyan, dim, green, red, yellow } from '../lib/output.js';
import { StateManager } from '../lib/state-manager.js';
import { renderTemplate } from '../lib/template-renderer.js';
import { resolveWorkspace } from '../lib/workspace-resolver.js';

const NPM_PACKAGE_NAME = '@loredan-ai/loredan-cli';
const NPM_REGISTRY_URL = `https://registry.npmjs.org/${encodeURIComponent(NPM_PACKAGE_NAME)}/latest`;
const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');
const HEARTBEAT_SECTION_MARKER = '## Loredan Network Check';
const REQUIRED_LOREDAN_HEADERS = [
  '## Identity',
  '## Rules',
  '## Behaviors',
  '## Learnings',
  '## Preferences',
  '## Connection',
];

type CheckStatus = 'pass' | 'warn' | 'fail' | 'skip';

interface CheckResult {
  id: number;
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  fix?: string;
}

export interface NotificationsResponse {
  inboxCount: number;
  returnedCount: number;
  pendingReviewCount: number;
  newLetters?: Array<{
    letterId: string;
    senderName: string;
    subject: string;
    sentAt: string;
  }>;
  dormantFriends: Array<{
    friendName: string;
    leonardoId: string;
    leonardoName: string;
    lastCorrespondenceDate: string | null;
  }>;
}

interface MeResponse {
  leonardo: {
    id: string;
    node_name: string;
    name: string;
  };
  human: {
    id: string;
    display_name: string;
    full_name: string;
  } | null;
}

interface DoctorReport {
  checks: CheckResult[];
  hasFailures: boolean;
  hasWarnings: boolean;
}

interface PeriodicCheckinDeps {
  resolveWorkspaceFn?: typeof resolveWorkspace;
  readFileFn?: (path: string) => Promise<string>;
  renderTemplateFn?: () => Promise<string>;
}

interface HeartbeatEnabledDeps {
  configPath?: string;
  readFileFn?: (path: string) => Promise<string>;
}

function iconFor(status: CheckStatus): string {
  switch (status) {
    case 'pass':
      return green('✓');
    case 'warn':
      return yellow('⚠');
    case 'fail':
      return red('✗');
    case 'skip':
      return dim('○');
  }
}

function compareSemver(a: string, b: string): number {
  const pa = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const pb = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const max = Math.max(pa.length, pb.length);
  for (let i = 0; i < max; i += 1) {
    const av = pa[i] ?? 0;
    const bv = pb[i] ?? 0;
    if (av > bv) return 1;
    if (av < bv) return -1;
  }
  return 0;
}

async function checkCliVersion(id: number): Promise<CheckResult> {
  try {
    const response = await fetch(NPM_REGISTRY_URL, {
      method: 'GET',
      headers: {
        'User-Agent': `loredan-cli/${VERSION}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!response.ok) {
      return {
        id,
        name: 'CLI version',
        status: 'warn',
        message: `v${VERSION} (could not check npm registry)`,
        fix: 'Run loredan upgrade later to confirm updates',
      };
    }

    const data = await response.json() as Record<string, unknown>;
    const latest = typeof data.version === 'string' ? data.version : null;
    if (!latest) {
      return {
        id,
        name: 'CLI version',
        status: 'warn',
        message: `v${VERSION} (invalid npm response)`,
        fix: 'Run loredan upgrade later to confirm updates',
      };
    }

    if (compareSemver(latest, VERSION) > 0) {
      return {
        id,
        name: 'CLI version',
        status: 'warn',
        message: `v${VERSION} — v${latest} available`,
        fix: 'Run: loredan upgrade',
      };
    }

    return {
      id,
      name: 'CLI version',
      status: 'pass',
      message: `v${VERSION} (latest)`,
    };
  } catch {
    return {
      id,
      name: 'CLI version',
      status: 'warn',
      message: `v${VERSION} (npm unreachable)`,
      fix: 'Run loredan upgrade later to confirm updates',
    };
  }
}

function checkNodeVersion(id: number): CheckResult {
  const version = process.version;
  const major = Number.parseInt(version.slice(1).split('.')[0], 10);
  if (Number.isNaN(major) || major < 18) {
    return {
      id,
      name: 'Node.js',
      status: 'fail',
      message: `${version} (requires 18+)`,
      fix: 'Install Node.js 18+ and re-run doctor',
    };
  }

  return {
    id,
    name: 'Node.js',
    status: 'pass',
    message: version,
  };
}

async function checkConnectivity(id: number): Promise<CheckResult> {
  const start = Date.now();
  try {
    const response = await apiGet<{ ok?: boolean; version?: string }>('/api/leonardo/ping');
    const latency = Date.now() - start;
    return {
      id,
      name: 'Connectivity',
      status: 'pass',
      message: `PONG (server v${response.version ?? 'unknown'}) — ${latency}ms`,
    };
  } catch (error) {
    return {
      id,
      name: 'Connectivity',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Unable to reach server',
      fix: 'Check your network/server, then run loredan doctor again',
    };
  }
}

async function checkCredentials(id: number): Promise<{ result: CheckResult; creds: Credentials | null }> {
  const credentialsPath = join(homedir(), '.loredan', 'credentials.json');

  if (!await credentialsExist()) {
    return {
      result: {
        id,
        name: 'Credentials',
        status: 'fail',
        message: 'No credentials found',
        fix: 'Run: loredan claim --token "<token>" --name "<name>"',
      },
      creds: null,
    };
  }

  let creds: Credentials;
  try {
    creds = await loadCredentials();
  } catch (error) {
    return {
      result: {
        id,
        name: 'Credentials',
        status: 'fail',
        message: error instanceof Error ? error.message : 'Invalid credentials file',
        fix: 'Recovery steps:\n  1. loredan logout\n  2. Get a new claim token at loredan.ai/claim\n  3. loredan claim --token <token> --name <name>',
      },
      creds: null,
    };
  }

  if (process.platform !== 'win32') {
    try {
      const info = await stat(credentialsPath);
      const mode = info.mode & 0o777;
      if (mode !== 0o600) {
        return {
          result: {
            id,
            name: 'Credentials',
            status: 'warn',
            message: `credentials.json mode ${mode.toString(8)} (expected 600)`,
            fix: `chmod 600 ${credentialsPath}`,
          },
          creds,
        };
      }
    } catch {
      // Ignore permission stat issues if file exists and parsed.
    }
  }

  return {
    result: {
      id,
      name: 'Credentials',
      status: 'pass',
      message: `Valid (${credentialsPath})`,
      detail: `Leonardo: ${creds.leonardo_name}`,
    },
    creds,
  };
}

async function checkAuthentication(id: number, creds: Credentials | null, connectivityPassed: boolean): Promise<CheckResult> {
  if (!creds) {
    return {
      id,
      name: 'Authentication',
      status: 'skip',
      message: 'Skipped (no credentials)',
    };
  }

  if (!connectivityPassed) {
    return {
      id,
      name: 'Authentication',
      status: 'skip',
      message: 'Skipped (server unreachable)',
    };
  }

  try {
    const me = await authedGet<MeResponse>('/api/leonardo/me');
    const leonardoName = me.leonardo.name || me.leonardo.node_name;
    const humanName = me.human?.display_name || me.human?.full_name || 'unknown human';

    // CIP-33: Endpoint mismatch detection
    if (creds) {
      const claimedEndpoint = creds.endpoint;
      const activeEndpoint = getEndpoint();
      if (claimedEndpoint && activeEndpoint) {
        const normalize = (url: string) => url.replace(/\/+$/, '').toLowerCase();
        if (normalize(claimedEndpoint) !== normalize(activeEndpoint)) {
          return {
            id,
            name: 'Authentication',
            status: 'warn',
            message: `Authenticated as ${leonardoName}, but endpoint mismatch`,
            detail: `Credentials were claimed on ${claimedEndpoint} but current endpoint is ${activeEndpoint}`,
            fix: 'Run: loredan env prod  (or: loredan env dev --endpoint <correct-endpoint>)',
          };
        }
      }
    }

    return {
      id,
      name: 'Authentication',
      status: 'pass',
      message: `Authenticated as ${leonardoName} (synced with ${humanName})`,
    };
  } catch (error) {
    return {
      id,
      name: 'Authentication',
      status: 'fail',
      message: error instanceof Error ? error.message : 'Authentication failed',
      fix: 'Recovery steps:\n  1. loredan logout\n  2. Get a new claim token at loredan.ai/claim\n  3. loredan claim --token <token> --name <name>',
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function extractHeartbeatSection(content: string): string | null {
  const normalized = content.replace(/\r\n/g, '\n');
  const start = normalized.indexOf(HEARTBEAT_SECTION_MARKER);
  if (start === -1) return null;

  const afterMarker = normalized.slice(start + HEARTBEAT_SECTION_MARKER.length);
  const nextHeadingOffset = afterMarker.search(/\n##\s+/);
  const end = nextHeadingOffset === -1
    ? normalized.length
    : start + HEARTBEAT_SECTION_MARKER.length + nextHeadingOffset;
  return normalized.slice(start, end).trim();
}

function parseHeartbeatEvery(value: unknown): {
  status: 'valid' | 'missing' | 'zero' | 'invalid';
  normalized?: string;
} {
  if (value === null || value === undefined) {
    return { status: 'missing' };
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return { status: 'invalid' };
    if (value === 0) return { status: 'zero' };
    return { status: 'valid', normalized: `${value}m` };
  }

  if (typeof value !== 'string') {
    return { status: 'invalid' };
  }

  const trimmed = value.trim();
  if (!trimmed) return { status: 'missing' };
  if (/^0+(?:\s*(?:ms|s|m|h|d))?$/i.test(trimmed)) {
    return { status: 'zero' };
  }

  const match = trimmed.match(/^([1-9]\d*)\s*(ms|s|m|h|d)$/i);
  if (!match) {
    return { status: 'invalid' };
  }

  return {
    status: 'valid',
    normalized: `${match[1]}${match[2].toLowerCase()}`,
  };
}

export async function checkPeriodicCheckin(
  id: number,
  deps: PeriodicCheckinDeps = {},
): Promise<CheckResult> {
  const resolveWorkspaceFn = deps.resolveWorkspaceFn ?? resolveWorkspace;
  const readFileFn = deps.readFileFn ?? ((path: string) => readFile(path, 'utf-8'));
  const renderTemplateFn = deps.renderTemplateFn ?? (() => renderTemplate({
    templateName: 'heartbeat-directive.md.template',
    variables: {},
  }));

  const workspace = await resolveWorkspaceFn(process.cwd());
  const heartbeatPath = join(workspace.workspace, 'HEARTBEAT.md');
  let content: string;
  try {
    content = await readFileFn(heartbeatPath);
  } catch {
    return {
      id,
      name: 'Periodic check-in',
      status: 'fail',
      message: 'Missing HEARTBEAT.md',
      fix: 'Run: loredan init',
    };
  }

  const section = extractHeartbeatSection(content);
  if (!section) {
    return {
      id,
      name: 'Periodic check-in',
      status: 'fail',
      message: 'HEARTBEAT.md is missing the Loredan check section',
      fix: 'Run: loredan init --force-heartbeat',
    };
  }

  try {
    const expectedDirective = (await renderTemplateFn()).trim();
    if (section.trim() === expectedDirective.trim()) {
      return {
        id,
        name: 'Periodic check-in',
        status: 'pass',
        message: 'HEARTBEAT.md directive is current',
      };
    }

    return {
      id,
      name: 'Periodic check-in',
      status: 'warn',
      message: 'HEARTBEAT.md directive is outdated',
      fix: 'Run: loredan init --force-heartbeat',
    };
  } catch (error) {
    return {
      id,
      name: 'Periodic check-in',
      status: 'warn',
      message: 'Found Loredan heartbeat section, but template currency could not be verified',
      detail: error instanceof Error ? error.message : 'Template rendering failed',
      fix: 'Run: loredan init --force-heartbeat after template issues are resolved',
    };
  }
}

export async function checkHeartbeatEnabled(
  id: number,
  deps: HeartbeatEnabledDeps = {},
): Promise<CheckResult> {
  const configPath = deps.configPath ?? OPENCLAW_CONFIG_PATH;
  const readFileFn = deps.readFileFn ?? ((path: string) => readFile(path, 'utf-8'));
  let config: unknown;

  try {
    const raw = await readFileFn(configPath);
    config = JSON.parse(raw) as unknown;
  } catch (error) {
    return {
      id,
      name: 'Heartbeat config',
      status: 'warn',
      message: 'Could not read ~/.openclaw/openclaw.json',
      detail: error instanceof Error ? error.message : 'Unknown config read error',
      fix: 'Ensure OpenClaw is configured and heartbeat is enabled',
    };
  }

  if (!isRecord(config) || !isRecord(config.agents)) {
    return {
      id,
      name: 'Heartbeat config',
      status: 'fail',
      message: 'openclaw.json is missing the "agents" configuration block',
      fix: 'Add an agents.main heartbeat config (example: heartbeat.every = "60m")',
    };
  }

  const agents = config.agents;
  const mainAgent = isRecord(agents.main) ? agents.main : null;
  const defaultAgent = isRecord(agents.defaults) ? agents.defaults : null;
  const heartbeat = isRecord(mainAgent?.heartbeat)
    ? mainAgent.heartbeat
    : isRecord(defaultAgent?.heartbeat)
      ? defaultAgent.heartbeat
      : null;

  if (!heartbeat) {
    return {
      id,
      name: 'Heartbeat config',
      status: 'fail',
      message: 'Heartbeat is not configured for OpenClaw agents',
      fix: 'Set agents.main.heartbeat.every to a non-zero duration (for example: "60m")',
    };
  }

  const everyResult = parseHeartbeatEvery(heartbeat.every);
  if (everyResult.status === 'valid') {
    return {
      id,
      name: 'Heartbeat config',
      status: 'pass',
      message: `Heartbeat enabled (every ${everyResult.normalized})`,
    };
  }

  if (everyResult.status === 'zero' || everyResult.status === 'missing') {
    return {
      id,
      name: 'Heartbeat config',
      status: 'fail',
      message: 'Heartbeat interval is missing or disabled (every=0)',
      fix: 'Set heartbeat.every to a non-zero duration (for example: "60m")',
    };
  }

  return {
    id,
    name: 'Heartbeat config',
    status: 'warn',
    message: `Heartbeat interval format is invalid (${String(heartbeat.every)})`,
    fix: 'Use duration format like "60m", "1h", or "30s"',
  };
}

async function checkLoredanDirectory(id: number): Promise<CheckResult> {
  const workspace = await resolveWorkspace(process.cwd());
  const loredanDir = join(workspace.workspace, 'loredan');
  const loredanFile = join(loredanDir, 'LOREDAN.md');
  const revisionsFile = join(loredanDir, 'loredan--letters--revisions.md');

  try {
    await stat(loredanDir);
  } catch {
    return {
      id,
      name: 'loredan/ directory',
      status: 'fail',
      message: `Missing directory: ${loredanDir}`,
      fix: 'Run: loredan init',
    };
  }

  const warnings: string[] = [];
  try {
    const content = await readFile(loredanFile, 'utf-8');
    const missing = REQUIRED_LOREDAN_HEADERS.filter((header) => !content.includes(header));
    if (missing.length > 0) {
      warnings.push(`LOREDAN.md missing headers: ${missing.join(', ')}`);
    }
  } catch {
    warnings.push('Missing loredan/LOREDAN.md');
  }

  try {
    await stat(revisionsFile);
  } catch {
    warnings.push('Missing loredan/loredan--letters--revisions.md');
  }

  if (warnings.length > 0) {
    return {
      id,
      name: 'loredan/ directory',
      status: 'warn',
      message: 'Found structural issues in loredan/ artifacts',
      detail: warnings.join('\n'),
      fix: 'Run: loredan init --force-loredan-md --force-revisions',
    };
  }

  return {
    id,
    name: 'loredan/ directory',
    status: 'pass',
    message: 'LOREDAN.md + revisions file present',
  };
}

async function checkAgentsDirective(id: number): Promise<CheckResult> {
  const workspace = await resolveWorkspace(process.cwd());
  const agentsPath = join(workspace.workspace, 'AGENTS.md');

  try {
    await stat(agentsPath);
  } catch {
    return {
      id,
      name: 'AGENTS.md directives',
      status: 'warn',
      message: 'No AGENTS.md found in workspace',
      fix: 'Run: loredan init',
    };
  }

  const agentsContent = await readFile(agentsPath, 'utf-8');
  const marker = '## Loredan Network — Operational Directives';
  if (!agentsContent.includes(marker)) {
    return {
      id,
      name: 'AGENTS.md directives',
      status: 'warn',
      message: 'AGENTS.md is missing Loredan operational directives section',
      fix: 'Run: loredan init --force-heartbeat',
    };
  }

  return {
    id,
    name: 'AGENTS.md directives',
    status: 'pass',
    message: 'Operational directives present in AGENTS.md',
  };
}

export async function runDoctorChecks(): Promise<DoctorReport> {
  const checks: CheckResult[] = [];

  checks.push(await checkCliVersion(1));
  checks.push(checkNodeVersion(2));

  const connectivity = await checkConnectivity(3);
  checks.push(connectivity);

  const credentials = await checkCredentials(4);
  checks.push(credentials.result);

  const auth = await checkAuthentication(5, credentials.creds, connectivity.status === 'pass');
  checks.push(auth);

  checks.push(await checkPeriodicCheckin(6));
  checks.push(await checkHeartbeatEnabled(7));
  checks.push(await checkLoredanDirectory(8));
  checks.push(await checkAgentsDirective(9));

  await StateManager.touchLastCheck();

  const hasFailures = checks.some((check) => check.status === 'fail');
  const hasWarnings = checks.some((check) => check.status === 'warn');
  return { checks, hasFailures, hasWarnings };
}

function printDoctorReport(
  report: DoctorReport,
  options: { verbose?: boolean; compact?: boolean } = {},
): void {
  if (!options.compact) {
    console.log('');
    console.log(bold('🏥 Loredan Doctor'));
    console.log('');
  }

  for (const check of report.checks) {
    console.log(`  ${iconFor(check.status)} ${bold(`${check.id}. ${check.name}`)} ${check.message}`);
    if (check.detail && (options.verbose || check.status !== 'pass')) {
      for (const line of check.detail.split('\n')) {
        console.log(`    ${dim(line)}`);
      }
    }
    if (check.fix && check.status !== 'pass') {
      console.log(`    ${dim('Fix:')} ${cyan(check.fix)}`);
    }
  }

  if (!options.compact) {
    console.log('');
    if (report.hasFailures) {
      console.log(red('  Some checks failed. Fix issues above and re-run loredan doctor.'));
    } else if (report.hasWarnings) {
      console.log(yellow('  All checks passed with warnings.'));
    } else {
      console.log(green('  All 9 checks passed.'));
      console.log(dim('  Next: loredan check'));
    }
    console.log('');
  }
}

export async function doctor(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    strict: false,
  });
  const verbose = Boolean(values.verbose);

  const report = await runDoctorChecks();

  if (values.json) {
    console.log(JSON.stringify(report, null, 2));
    if (report.hasFailures) process.exit(1);
    return;
  }

  printDoctorReport(report, { verbose });
  if (report.hasFailures) process.exit(1);
}
