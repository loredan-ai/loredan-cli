import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

interface OpenClawConfig {
  agents?: {
    defaults?: {
      workspace?: string;
    };
    list?: Array<{
      id?: string;
      workspace?: string;
    }>;
  };
}

export interface WorkspaceResolution {
  workspace: string;
  source:
    | 'env_override'
    | 'openclaw_agent'
    | 'openclaw_default'
    | 'openclaw_fallback'
    | 'legacy_openclaw'
    | 'legacy_moltbot'
    | 'legacy_clawd'
    | 'cwd';
}

async function existsDir(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

async function readOpenClawConfig(): Promise<OpenClawConfig | null> {
  const path = join(homedir(), '.openclaw', 'openclaw.json');
  try {
    const raw = await readFile(path, 'utf-8');
    return JSON.parse(raw) as OpenClawConfig;
  } catch {
    return null;
  }
}

export async function resolveWorkspace(cwd = process.cwd()): Promise<WorkspaceResolution> {
  const envOverride = process.env.LOREDAN_WORKSPACE;
  if (envOverride) {
    return { workspace: resolve(envOverride), source: 'env_override' };
  }

  const cfg = await readOpenClawConfig();
  const requestedAgentId = process.env.LOREDAN_OPENCLAW_AGENT_ID?.trim();

  if (requestedAgentId && cfg?.agents?.list?.length) {
    const agent = cfg.agents.list.find((entry) => entry.id === requestedAgentId);
    if (agent?.workspace && await existsDir(agent.workspace)) {
      return { workspace: resolve(agent.workspace), source: 'openclaw_agent' };
    }
  }

  const defaultWorkspace = cfg?.agents?.defaults?.workspace;
  if (defaultWorkspace && await existsDir(defaultWorkspace)) {
    return { workspace: resolve(defaultWorkspace), source: 'openclaw_default' };
  }

  const openclawFallback = join(homedir(), '.openclaw', 'workspace');
  if (await existsDir(openclawFallback)) {
    return { workspace: openclawFallback, source: 'openclaw_fallback' };
  }

  const legacyOpenclaw = join(homedir(), 'openclaw');
  if (await existsDir(legacyOpenclaw)) {
    return { workspace: legacyOpenclaw, source: 'legacy_openclaw' };
  }

  const legacyMoltbot = join(homedir(), 'moltbot');
  if (await existsDir(legacyMoltbot)) {
    return { workspace: legacyMoltbot, source: 'legacy_moltbot' };
  }

  const legacyClawd = join(homedir(), 'clawd');
  if (await existsDir(legacyClawd)) {
    return { workspace: legacyClawd, source: 'legacy_clawd' };
  }

  return { workspace: resolve(cwd), source: 'cwd' };
}
