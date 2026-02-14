import { parseArgs } from 'node:util';
import { stat, readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getEndpoint, VERSION } from '../lib/config.js';
import { credentialsExist, loadCredentials, type Credentials } from '../lib/credentials.js';
import { bold, dim, green, yellow, red, cyan } from '../lib/output.js';

// ─── Check types ─────────────────────────────────────────────

type CheckStatus = 'pass' | 'fail' | 'warn' | 'skip';

interface CheckResult {
  name: string;
  status: CheckStatus;
  message: string;
  detail?: string;
  fix?: string;
}

// ─── Symbols ─────────────────────────────────────────────────

function statusIcon(s: CheckStatus): string {
  switch (s) {
    case 'pass': return green('✓');
    case 'fail': return red('✗');
    case 'warn': return yellow('!');
    case 'skip': return dim('○');
  }
}

function statusColor(s: CheckStatus): (text: string) => string {
  switch (s) {
    case 'pass': return green;
    case 'fail': return red;
    case 'warn': return yellow;
    case 'skip': return dim;
  }
}

// ─── Individual checks ──────────────────────────────────────

async function checkCredentialsFile(): Promise<CheckResult> {
  const dir = join(homedir(), '.loredan');
  const file = join(dir, 'credentials.json');

  try {
    const s = await stat(file);

    // Check permissions (Unix only)
    if (process.platform !== 'win32') {
      const mode = s.mode & 0o777;
      if (mode !== 0o600) {
        return {
          name: 'Credentials file',
          status: 'warn',
          message: `Found but permissions are ${mode.toString(8)} (expected 600)`,
          fix: `chmod 600 ${file}`,
        };
      }
    }

    // Try to parse
    try {
      const raw = await readFile(file, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!parsed.api_key || !parsed.leonardo_id) {
        return {
          name: 'Credentials file',
          status: 'fail',
          message: 'File exists but missing required fields (api_key, leonardo_id)',
          fix: 'loredan logout && loredan claim --token <token> --name <name>',
        };
      }
      return {
        name: 'Credentials file',
        status: 'pass',
        message: `Found at ${dim(file)}`,
        detail: `Leonardo: ${parsed.leonardo_name || parsed.leonardo_id.slice(0, 8)}`,
      };
    } catch {
      return {
        name: 'Credentials file',
        status: 'fail',
        message: 'File exists but contains invalid JSON',
        fix: 'loredan logout && loredan claim --token <token> --name <name>',
      };
    }
  } catch {
    return {
      name: 'Credentials file',
      status: 'fail',
      message: 'Not found — you haven\'t claimed yet',
      fix: 'loredan claim --token <token> --name <name>',
    };
  }
}

function checkEndpoint(): CheckResult {
  const endpoint = getEndpoint();
  const isDefault = !process.env.LOREDAN_ENDPOINT;
  const isLocalhost = endpoint.includes('localhost') || endpoint.includes('127.0.0.1');

  if (isDefault) {
    return {
      name: 'Endpoint',
      status: 'pass',
      message: `${endpoint} ${dim('(default)')}`,
    };
  }

  if (isLocalhost) {
    return {
      name: 'Endpoint',
      status: 'warn',
      message: `${endpoint} ${yellow('(dev override via LOREDAN_ENDPOINT)')}`,
      detail: 'Using local dev server — credentials won\'t work on prod',
    };
  }

  return {
    name: 'Endpoint',
    status: 'warn',
    message: `${endpoint} ${yellow('(custom override via LOREDAN_ENDPOINT)')}`,
  };
}

async function checkConnectivity(): Promise<CheckResult> {
  const endpoint = getEndpoint();
  const url = `${endpoint}/api/leonardo/ping`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        'User-Agent': `loredan-cli/${VERSION}`,
        'Accept': 'application/json',
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      return {
        name: 'Server connectivity',
        status: 'fail',
        message: `Server responded with HTTP ${res.status}`,
        fix: endpoint.includes('localhost')
          ? 'Is the dev server running? Check: npm run dev'
          : 'Check https://status.loredan.ai or try again later',
      };
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      return {
        name: 'Server connectivity',
        status: 'warn',
        message: 'Server responded but returned non-JSON',
      };
    }

    const serverVersion = json?.version || json?.server_version || 'unknown';
    return {
      name: 'Server connectivity',
      status: 'pass',
      message: `PONG — server v${serverVersion}`,
    };
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      return {
        name: 'Server connectivity',
        status: 'fail',
        message: 'Timed out after 10s',
        fix: endpoint.includes('localhost')
          ? 'Is the dev server running on port 8829?'
          : 'Check your internet connection',
      };
    }

    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      return {
        name: 'Server connectivity',
        status: 'fail',
        message: `Connection refused at ${endpoint}`,
        fix: endpoint.includes('localhost')
          ? 'Is the dev server running? Start it and try again.'
          : 'Check your internet connection',
      };
    }

    return {
      name: 'Server connectivity',
      status: 'fail',
      message: `Network error: ${err.message}`,
    };
  }
}

async function checkAuth(creds: Credentials | null): Promise<CheckResult> {
  if (!creds) {
    return {
      name: 'Authentication',
      status: 'skip',
      message: 'Skipped — no credentials',
    };
  }

  const endpoint = getEndpoint();

  // Check if credentials endpoint matches current endpoint
  if (creds.endpoint && creds.endpoint !== endpoint) {
    return {
      name: 'Authentication',
      status: 'warn',
      message: `Credentials were claimed on ${dim(creds.endpoint)} but endpoint is ${dim(endpoint)}`,
      detail: 'Your API key may not work on this server',
      fix: creds.endpoint.includes('localhost')
        ? `export LOREDAN_ENDPOINT=${creds.endpoint}`
        : 'loredan logout && loredan claim with a token from this server',
    };
  }

  try {
    const res = await fetch(`${endpoint}/api/leonardo/status`, {
      method: 'GET',
      headers: {
        'User-Agent': `loredan-cli/${VERSION}`,
        'Accept': 'application/json',
        'X-Leonardo-API-Key': creds.api_key,
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (res.status === 401) {
      return {
        name: 'Authentication',
        status: 'fail',
        message: 'API key rejected — may have been revoked',
        fix: 'loredan logout && loredan claim --token <token> --name <name>',
      };
    }

    if (!res.ok) {
      return {
        name: 'Authentication',
        status: 'fail',
        message: `Server returned HTTP ${res.status}`,
      };
    }

    let json: any;
    try {
      json = await res.json();
      const data = json?.data || json;
      return {
        name: 'Authentication',
        status: 'pass',
        message: `Authenticated as ${bold(data.leonardo_name || creds.leonardo_name)}`,
        detail: data.human_name ? `Synced with ${data.human_name}` : undefined,
      };
    } catch {
      return {
        name: 'Authentication',
        status: 'pass',
        message: 'Authenticated (response parsed)',
      };
    }
  } catch (err: any) {
    return {
      name: 'Authentication',
      status: 'skip',
      message: `Could not reach server: ${err.message}`,
    };
  }
}

function checkEndpointMismatch(creds: Credentials | null): CheckResult | null {
  if (!creds || !creds.endpoint) return null;

  const current = getEndpoint();
  if (creds.endpoint === current) return null;

  // This is a significant issue — the #1 thing Colin hit today
  const credIsLocal = creds.endpoint.includes('localhost') || creds.endpoint.includes('127.0.0.1');
  const currentIsLocal = current.includes('localhost') || current.includes('127.0.0.1');

  if (credIsLocal && !currentIsLocal) {
    return {
      name: 'Endpoint mismatch',
      status: 'warn',
      message: `Credentials from dev server but pointing at prod`,
      detail: `Claimed on: ${dim(creds.endpoint)}\nCurrent:    ${dim(current)}`,
      fix: `export LOREDAN_ENDPOINT=${creds.endpoint}`,
    };
  }

  if (!credIsLocal && currentIsLocal) {
    return {
      name: 'Endpoint mismatch',
      status: 'warn',
      message: `Credentials from prod but pointing at dev server`,
      detail: `Claimed on: ${dim(creds.endpoint)}\nCurrent:    ${dim(current)}`,
      fix: `unset LOREDAN_ENDPOINT  # or claim a new token on dev`,
    };
  }

  return {
    name: 'Endpoint mismatch',
    status: 'warn',
    message: `Credentials from different endpoint`,
    detail: `Claimed on: ${dim(creds.endpoint)}\nCurrent:    ${dim(current)}`,
    fix: `export LOREDAN_ENDPOINT=${creds.endpoint}`,
  };
}

function checkVersion(): CheckResult {
  return {
    name: 'CLI version',
    status: 'pass',
    message: `v${VERSION}`,
  };
}

function checkNodeVersion(): CheckResult {
  const major = parseInt(process.version.slice(1), 10);
  if (major < 18) {
    return {
      name: 'Node.js',
      status: 'fail',
      message: `${process.version} — requires Node 18+`,
      fix: 'Install Node 18 or later: https://nodejs.org',
    };
  }
  return {
    name: 'Node.js',
    status: 'pass',
    message: process.version,
  };
}

// ─── Main ────────────────────────────────────────────────────

export async function doctor(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
      verbose: { type: 'boolean', short: 'v', default: false },
    },
    strict: false,
  });

  const results: CheckResult[] = [];

  // Phase 1: Environment
  results.push(checkVersion());
  results.push(checkNodeVersion());
  results.push(checkEndpoint());

  // Phase 2: Credentials
  const credsResult = await checkCredentialsFile();
  results.push(credsResult);

  // Try to load creds for further checks
  let creds: Credentials | null = null;
  try {
    creds = await loadCredentials();
  } catch {
    // Fine — already reported in credsResult
  }

  // Phase 3: Endpoint mismatch (the exact bug Colin hit today)
  const mismatchResult = checkEndpointMismatch(creds);
  if (mismatchResult) {
    results.push(mismatchResult);
  }

  // Phase 4: Connectivity
  const connResult = await checkConnectivity();
  results.push(connResult);

  // Phase 5: Auth (only if we have creds AND server is reachable)
  if (creds && connResult.status === 'pass') {
    const authResult = await checkAuth(creds);
    results.push(authResult);
  } else if (creds && connResult.status !== 'pass') {
    results.push({
      name: 'Authentication',
      status: 'skip',
      message: 'Skipped — server unreachable',
    });
  }

  // ─── Output ──────────────────────────────────────────────

  if (values.json) {
    console.log(JSON.stringify({ version: VERSION, checks: results }, null, 2));
    return;
  }

  console.log('');
  console.log(bold('loredan doctor'));
  console.log('');

  let hasFailures = false;
  let hasWarnings = false;

  for (const r of results) {
    const icon = statusIcon(r.status);
    const color = statusColor(r.status);
    console.log(`  ${icon} ${bold(r.name)}: ${color(r.message)}`);

    if (r.detail && (values.verbose || r.status === 'fail' || r.status === 'warn')) {
      for (const line of r.detail.split('\n')) {
        console.log(`    ${dim(line)}`);
      }
    }

    if (r.fix && (r.status === 'fail' || r.status === 'warn')) {
      console.log(`    ${dim('Fix:')} ${cyan(r.fix)}`);
    }

    if (r.status === 'fail') hasFailures = true;
    if (r.status === 'warn') hasWarnings = true;
  }

  console.log('');

  if (hasFailures) {
    console.log(red('  Some checks failed. Fix the issues above and run again.'));
  } else if (hasWarnings) {
    console.log(yellow('  All checks passed with warnings.'));
  } else {
    console.log(green('  All checks passed. Your Leonardo is healthy.'));
  }

  console.log('');

  if (hasFailures) process.exit(1);
}
