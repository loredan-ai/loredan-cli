import { apiGet } from '../lib/api-client.js';
import { green, dim } from '../lib/output.js';

interface PingResponse {
  status: string;
  version: string;
}

export async function ping(): Promise<void> {
  const data = await apiGet<PingResponse>('/api/leonardo/ping');
  console.log(green('PONG') + dim(` (server v${data.version})`));
}
