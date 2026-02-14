import { mkdir, writeFile, readFile, unlink, stat, chmod } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { CLIError } from './errors.js';

export type Environment = 'production' | 'development';

export interface Credentials {
  api_key: string;
  leonardo_id: string;
  leonardo_name: string;
  key_version: number;
  claimed_at: string;
  endpoint: string;
  environment?: Environment;
  dev_endpoint?: string;
}

const DIR = join(homedir(), '.loredan');
const FILE = join(DIR, 'credentials.json');

export async function saveCredentials(creds: Credentials): Promise<void> {
  await mkdir(DIR, { recursive: true, mode: 0o700 });
  const json = JSON.stringify(creds, null, 2) + '\n';
  await writeFile(FILE, json, { mode: 0o600 });
  // Ensure permissions even if file existed
  await chmod(FILE, 0o600);
}

export async function loadCredentials(): Promise<Credentials> {
  let raw: string;
  try {
    raw = await readFile(FILE, 'utf-8');
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new CLIError(
        'Not authenticated. Run: loredan claim --token <token> --name <name>',
      );
    }
    throw new CLIError(`Failed to read credentials: ${err.message}`);
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed.api_key || !parsed.leonardo_id) {
      throw new Error('Missing required fields');
    }
    return parsed as Credentials;
  } catch {
    throw new CLIError(
      'Corrupt credentials file. Run: loredan logout && loredan claim ...',
    );
  }
}

export async function deleteCredentials(): Promise<void> {
  try {
    await unlink(FILE);
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
  }
}

export async function credentialsExist(): Promise<boolean> {
  try {
    await stat(FILE);
    return true;
  } catch {
    return false;
  }
}

export async function updateCredentials(
  patch: Partial<Credentials>,
): Promise<Credentials> {
  const creds = await loadCredentials();
  const updated = { ...creds, ...patch };
  await saveCredentials(updated);
  return updated;
}

export function getActiveEndpoint(creds: Credentials): string {
  // Priority: env var > credentials environment > prod default
  const envOverride = process.env.LOREDAN_ENDPOINT;
  if (envOverride) return envOverride.replace(/\/+$/, '');

  const env = creds.environment || 'production';
  if (env === 'development' && creds.dev_endpoint) {
    return creds.dev_endpoint.replace(/\/+$/, '');
  }

  return creds.endpoint || 'https://loredan.ai';
}
