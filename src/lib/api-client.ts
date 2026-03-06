import { getEndpoint, VERSION } from './config.js';
import { loadCredentials, getActiveEndpoint } from './credentials.js';
import { CLIError } from './errors.js';

interface RequestOptions {
  body?: unknown;
  headers?: Record<string, string>;
  endpoint?: string;
}

async function request<T>(
  method: string,
  path: string,
  opts?: RequestOptions,
): Promise<T> {
  const url = (opts?.endpoint || getEndpoint()) + path;
  const headers: Record<string, string> = {
    'User-Agent': `loredan-cli/${VERSION}`,
    'Accept': 'application/json',
    ...opts?.headers,
  };

  if (opts?.body) {
    headers['Content-Type'] = 'application/json';
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: opts?.body ? JSON.stringify(opts.body) : undefined,
      signal: AbortSignal.timeout(30_000),
    });
  } catch (err: any) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') {
      throw new CLIError('Request timed out after 30s. Is the server running?');
    }
    if (err.cause?.code === 'ECONNREFUSED' || err.message?.includes('ECONNREFUSED')) {
      const endpoint = getEndpoint();
      throw new CLIError(
        `Could not connect to ${endpoint}. ` +
        (endpoint.includes('localhost')
          ? 'Is the dev server running on port 8829?'
          : 'Check your internet connection.'),
      );
    }
    throw new CLIError(`Network error: ${err.message}`);
  }

  let json: any;
  try {
    json = await res.json();
  } catch {
    throw new CLIError(`Invalid response from server (status ${res.status})`);
  }

  // Dual response format: ping returns raw JSON, everything else uses envelope
  if (!res.ok) {
    // Envelope error shape: { success: false, error: { code, message } }
    const errMsg = json?.error?.message || json?.message || `HTTP ${res.status}`;

    if (res.status === 401) {
      throw new CLIError(`Authentication failed: ${errMsg}\nRun: loredan claim --token <token> --name <name>`);
    }
    if (res.status === 429) {
      const retryAfter = json?.error?.details?.retryAfter || 60;
      throw new CLIError(`Rate limited. Try again in ${retryAfter} seconds.`);
    }
    throw new CLIError(errMsg);
  }

  // Envelope success: { success: true, data: T }
  if ('success' in json && json.success === true) {
    return json.data as T;
  }

  // Raw JSON (ping)
  return json as T;
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>('GET', path);
}

export function apiPost<T>(path: string, body: unknown): Promise<T> {
  return request<T>('POST', path, { body });
}

async function getClientMetadataHeaders(): Promise<Record<string, string>> {
  return {
    'X-Loredan-CLI-Version': VERSION,
  };
}

export async function authedGet<T>(path: string): Promise<T> {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  const metadataHeaders = await getClientMetadataHeaders();
  return request<T>('GET', path, {
    headers: {
      ...metadataHeaders,
      'X-Leonardo-API-Key': creds.api_key,
    },
    endpoint,
  });
}

export async function authedPost<T>(path: string, body: unknown): Promise<T> {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  const metadataHeaders = await getClientMetadataHeaders();
  return request<T>('POST', path, {
    body,
    headers: {
      ...metadataHeaders,
      'X-Leonardo-API-Key': creds.api_key,
    },
    endpoint,
  });
}

export async function authedPut<T>(path: string, body: unknown): Promise<T> {
  const creds = await loadCredentials();
  const endpoint = getActiveEndpoint(creds);
  const metadataHeaders = await getClientMetadataHeaders();
  return request<T>('PUT', path, {
    body,
    headers: {
      ...metadataHeaders,
      'X-Leonardo-API-Key': creds.api_key,
    },
    endpoint,
  });
}
