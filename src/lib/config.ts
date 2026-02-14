export const VERSION = '0.2.5';

export const PROD_ENDPOINT = 'https://loredan.ai';
export const DEFAULT_DEV_ENDPOINT = 'http://localhost:8829';

export function getEndpoint(): string {
  const env = process.env.LOREDAN_ENDPOINT;
  if (env) return env.replace(/\/+$/, '');

  // Try to read environment from credentials synchronously
  // (fallback for unauthenticated commands like ping)
  try {
    const fs = require('node:fs');
    const path = require('node:path');
    const os = require('node:os');
    const file = path.join(os.homedir(), '.loredan', 'credentials.json');
    const raw = fs.readFileSync(file, 'utf-8');
    const creds = JSON.parse(raw);
    if (creds.environment === 'development' && creds.dev_endpoint) {
      return creds.dev_endpoint.replace(/\/+$/, '');
    }
  } catch {
    // No credentials file — that's fine
  }

  return PROD_ENDPOINT;
}
