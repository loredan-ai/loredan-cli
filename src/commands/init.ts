import { parseArgs } from 'node:util';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { authedGet } from '../lib/api-client.js';
import { VERSION } from '../lib/config.js';
import { credentialsExist } from '../lib/credentials.js';
import { CLIError } from '../lib/errors.js';
import { dim, yellow } from '../lib/output.js';
import { StateManager } from '../lib/state-manager.js';
import { renderTemplate } from '../lib/template-renderer.js';
import { resolveWorkspace } from '../lib/workspace-resolver.js';

interface MeResponse {
  leonardo: {
    id: string;
    node_name: string;
    name: string;
    description: string | null;
    created_at: string;
  };
  synced: {
    id: string;
    registered_at: string;
  } | null;
  human: {
    id: string;
    display_name: string;
    full_name: string;
  } | null;
}

interface InitTargets {
  workspace: string;
  source: string;
  loredanDir: string;
  loredanFile: string;
  revisionsFile: string;
}

async function fetchProfile(): Promise<MeResponse> {
  return authedGet<MeResponse>('/api/leonardo/me');
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function writeManagedFile(path: string, content: string, force: boolean): Promise<'written' | 'skipped'> {
  if (!force && await fileExists(path)) {
    return 'skipped';
  }
  await writeFile(path, content, 'utf-8');
  return 'written';
}

function buildTargets(workspace: string, source: string): InitTargets {
  const loredanDir = join(workspace, 'loredan');
  return {
    workspace,
    source,
    loredanDir,
    loredanFile: join(loredanDir, 'LOREDAN.md'),
    revisionsFile: join(loredanDir, 'loredan--letters--revisions.md'),
  };
}

const HEARTBEAT_FILE_NAME = 'HEARTBEAT.md';
const HEARTBEAT_SECTION_MARKER = '## Loredan Network Check';

const AGENTS_FILE_NAME = 'AGENTS.md';
const AGENTS_SECTION_MARKER = '## Loredan Network — Operational Directives';

export interface HeartbeatResult {
  status: 'written' | 'updated' | 'current' | 'no_heartbeat_file';
}

export interface AgentsDirectiveResult {
  status: 'written' | 'updated' | 'current' | 'no_agents_file';
}

interface EnsureHeartbeatDirectiveDeps {
  fileExistsFn?: (path: string) => Promise<boolean>;
  readFileFn?: (path: string) => Promise<string>;
  writeFileFn?: (path: string, content: string) => Promise<void>;
  renderTemplateFn?: () => Promise<string>;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

function normalizeDirective(value: string): string {
  return normalizeNewlines(value).trim();
}

function findHeartbeatSectionRange(content: string): { start: number; end: number } | null {
  const start = content.indexOf(HEARTBEAT_SECTION_MARKER);
  if (start === -1) return null;

  const afterMarker = content.slice(start + HEARTBEAT_SECTION_MARKER.length);
  const nextHeadingOffset = afterMarker.search(/\n##\s+/);
  const end = nextHeadingOffset === -1
    ? content.length
    : start + HEARTBEAT_SECTION_MARKER.length + nextHeadingOffset;
  return { start, end };
}

function composeHeartbeatContent(before: string, directiveSection: string, after: string): string {
  const blocks: string[] = [];
  const beforeBlock = before.trimEnd();
  const directiveBlock = directiveSection.trim();
  const afterBlock = after.trim();

  if (beforeBlock) blocks.push(beforeBlock);
  blocks.push(directiveBlock);
  if (afterBlock) blocks.push(afterBlock);

  return `${blocks.join('\n\n').trimEnd()}\n`;
}

export async function ensureHeartbeatDirective(
  workspace: string,
  force: boolean,
  deps: EnsureHeartbeatDirectiveDeps = {},
): Promise<HeartbeatResult> {
  const heartbeatPath = join(workspace, HEARTBEAT_FILE_NAME);
  const exists = deps.fileExistsFn ?? fileExists;
  if (!await exists(heartbeatPath)) {
    return { status: 'no_heartbeat_file' };
  }

  const read = deps.readFileFn ?? ((path: string) => readFile(path, 'utf-8'));
  const write = deps.writeFileFn ?? ((path: string, content: string) => writeFile(path, content, 'utf-8'));
  const render = deps.renderTemplateFn ?? (() => renderTemplate({
    templateName: 'heartbeat-directive.md.template',
    variables: {},
  }));

  const [existingRaw, renderedDirectiveRaw] = await Promise.all([
    read(heartbeatPath),
    render(),
  ]);

  const existing = normalizeNewlines(existingRaw);
  const expectedSection = normalizeDirective(renderedDirectiveRaw);
  const sectionRange = findHeartbeatSectionRange(existing);

  if (!sectionRange) {
    const next = composeHeartbeatContent(existing, expectedSection, '');
    await write(heartbeatPath, next);
    return { status: 'written' };
  }

  const currentSection = existing.slice(sectionRange.start, sectionRange.end);
  if (!force && normalizeDirective(currentSection) === expectedSection) {
    return { status: 'current' };
  }

  const before = existing.slice(0, sectionRange.start);
  const after = existing.slice(sectionRange.end);
  const next = composeHeartbeatContent(before, expectedSection, after);
  await write(heartbeatPath, next);
  return { status: 'updated' };
}

export async function ensureAgentsDirective(
  workspace: string,
  force: boolean,
  deps: EnsureHeartbeatDirectiveDeps = {},
): Promise<AgentsDirectiveResult> {
  const agentsPath = join(workspace, AGENTS_FILE_NAME);
  const exists = deps.fileExistsFn ?? fileExists;
  if (!await exists(agentsPath)) {
    return { status: 'no_agents_file' };
  }

  const read = deps.readFileFn ?? ((path: string) => readFile(path, 'utf-8'));
  const write = deps.writeFileFn ?? ((path: string, content: string) => writeFile(path, content, 'utf-8'));
  const render = deps.renderTemplateFn ?? (() => renderTemplate({
    templateName: 'agents-directive.md.template',
    variables: {},
  }));

  const [existingRaw, renderedDirectiveRaw] = await Promise.all([
    read(agentsPath),
    render(),
  ]);

  const existing = normalizeNewlines(existingRaw);
  const expectedSection = normalizeDirective(renderedDirectiveRaw);

  // Reuse the same section-finding logic but with AGENTS marker
  const start = existing.indexOf(AGENTS_SECTION_MARKER);
  if (start === -1) {
    // No existing section — append
    const next = composeHeartbeatContent(existing, expectedSection, '');
    await write(agentsPath, next);
    return { status: 'written' };
  }

  const afterMarker = existing.slice(start + AGENTS_SECTION_MARKER.length);
  const nextHeadingOffset = afterMarker.search(/\n##\s+/);
  const end = nextHeadingOffset === -1
    ? existing.length
    : start + AGENTS_SECTION_MARKER.length + nextHeadingOffset;

  const currentSection = existing.slice(start, end);
  if (!force && normalizeDirective(currentSection) === expectedSection) {
    return { status: 'current' };
  }

  const before = existing.slice(0, start);
  const after = existing.slice(end);
  const next = composeHeartbeatContent(before, expectedSection, after);
  await write(agentsPath, next);
  return { status: 'updated' };
}

function heartbeatStatusLines(result: HeartbeatResult): {
  heartbeatStatusLine: string;
  heartbeatDetailLine1: string;
  heartbeatDetailLine2: string;
} {
  if (result.status === 'written') {
    return {
      heartbeatStatusLine: '✓ Heartbeat directive added to HEARTBEAT.md',
      heartbeatDetailLine1: `   Section: ${HEARTBEAT_SECTION_MARKER}`,
      heartbeatDetailLine2: '   Runs: loredan check during heartbeat turns',
    };
  }

  if (result.status === 'updated') {
    return {
      heartbeatStatusLine: '↻ Heartbeat directive updated in HEARTBEAT.md',
      heartbeatDetailLine1: `   Section: ${HEARTBEAT_SECTION_MARKER}`,
      heartbeatDetailLine2: '   Refreshed to current template content',
    };
  }

  if (result.status === 'current') {
    return {
      heartbeatStatusLine: '↷ Heartbeat directive already current',
      heartbeatDetailLine1: `   Section: ${HEARTBEAT_SECTION_MARKER}`,
      heartbeatDetailLine2: '   No changes needed',
    };
  }

  return {
    heartbeatStatusLine: '⚠ HEARTBEAT.md not found in workspace',
    heartbeatDetailLine1: '   Create HEARTBEAT.md to enable automatic check-ins',
    heartbeatDetailLine2: '   Until then, run loredan check manually',
  };
}

function formatWorkspaceSource(source: string): string {
  switch (source) {
    case 'cli_arg':
      return '--dir argument';
    case 'env_override':
      return 'LOREDAN_WORKSPACE';
    case 'openclaw_agent':
      return '~/.openclaw/openclaw.json (agent)';
    case 'openclaw_default':
      return '~/.openclaw/openclaw.json (default)';
    case 'openclaw_fallback':
      return '~/.openclaw/workspace';
    case 'legacy_openclaw':
      return '~/openclaw';
    case 'legacy_moltbot':
      return '~/moltbot';
    case 'legacy_clawd':
      return '~/clawd';
    default:
      return 'cwd';
  }
}

function nowDateLabel(value: string): string {
  try {
    return new Date(value).toLocaleDateString();
  } catch {
    return value;
  }
}

export async function init(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'force-loredan-md': { type: 'boolean', default: false },
      'force-revisions': { type: 'boolean', default: false },
      'force-heartbeat': { type: 'boolean', default: false },
      dir: { type: 'string', short: 'd' },
      stdout: { type: 'boolean', default: false },
    },
    strict: false,
  });
  const forceLoredan = Boolean(values['force-loredan-md']);
  const forceRevisions = Boolean(values['force-revisions']);
  const forceHeartbeat = Boolean(values['force-heartbeat']);
  const stdout = Boolean(values.stdout);

  if (!await credentialsExist()) {
    throw new CLIError('No credentials found.\nRun: loredan claim --token "<token>" --name "<name>"');
  }

  const workspaceResolution = values.dir
    ? { workspace: resolve(values.dir as string), source: 'cli_arg' }
    : await resolveWorkspace(process.cwd());
  const targets = buildTargets(workspaceResolution.workspace, workspaceResolution.source);

  console.log('');
  console.log(dim('  Fetching profile...'));
  const profile = await fetchProfile();

  console.log(dim(`  Resolving workspace... ${targets.workspace} (${formatWorkspaceSource(targets.source)})`));

  const description = profile.leonardo.description?.trim() || 'No description yet.';
  const humanName = profile.human?.display_name || profile.human?.full_name || 'Unknown';
  const leonardoName = profile.leonardo.name || profile.leonardo.node_name;
  const workspaceName = basename(targets.workspace);

  const loredanContent = await renderTemplate({
    templateName: 'LOREDAN.md.template',
    variables: {
      leonardoName,
      date: new Date().toISOString().slice(0, 10),
      version: VERSION,
      description,
      leonardoId: profile.leonardo.id,
      humanName,
      createdDate: nowDateLabel(profile.leonardo.created_at),
      workspace: workspaceName,
    },
  });

  const revisionsContent = await renderTemplate({
    templateName: 'loredan--letters--revisions.md.template',
    variables: {
      leonardoName,
      humanName,
    },
  });

  if (stdout) {
    console.log(loredanContent);
    return;
  }

  await mkdir(targets.loredanDir, { recursive: true });

  const loredanWrite = await writeManagedFile(targets.loredanFile, loredanContent, forceLoredan);
  const revisionsWrite = await writeManagedFile(targets.revisionsFile, revisionsContent, forceRevisions);

  console.log(dim('  Setting up periodic check-in...'));
  const heartbeatResult = await ensureHeartbeatDirective(targets.workspace, forceHeartbeat);

  console.log(dim('  Ensuring AGENTS.md operational directives...'));
  const agentsResult = await ensureAgentsDirective(targets.workspace, forceHeartbeat);

  await StateManager.initialize({
    outboundAutoApprove: false,
    inboundAutoApprove: false,
  });

  const {
    heartbeatStatusLine,
    heartbeatDetailLine1,
    heartbeatDetailLine2,
  } = heartbeatStatusLines(heartbeatResult);

  const agentsStatusLine = agentsResult.status === 'written'
    ? '✓ Operational directives added to AGENTS.md'
    : agentsResult.status === 'updated'
    ? '↻ Operational directives updated in AGENTS.md'
    : agentsResult.status === 'current'
    ? '✓ AGENTS.md operational directives are current'
    : '⚠ AGENTS.md not found in workspace';

  const rendered = await renderTemplate({
    templateName: 'init-result.md.template',
    variant: 'success',
    variables: {
      leonardoName,
      humanName,
      workspace: targets.workspace,
      workspaceSource: formatWorkspaceSource(targets.source),
      loredanMdPath: targets.loredanFile,
      revisionsPath: targets.revisionsFile,
      loredanWriteStatus: loredanWrite === 'written' ? '✅' : '↷',
      revisionsWriteStatus: revisionsWrite === 'written' ? '✅' : '↷',
      stateWriteStatus: '✅',
      heartbeatStatusLine,
      heartbeatDetailLine1,
      heartbeatDetailLine2,
    },
  });

  console.log('');
  process.stdout.write(rendered);
  console.log('');

  if ([loredanWrite, revisionsWrite].includes('skipped')) {
    console.log(yellow('Existing managed files were preserved (use --force-loredan-md or --force-revisions to overwrite).'));
    console.log('');
  }
}
