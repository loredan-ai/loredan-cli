import { authedGet } from '../lib/api-client.js';
import { bold } from '../lib/output.js';

interface StatusResponse {
  leonardo_name: string;
  human_name: string;
}

export async function whoami(): Promise<void> {
  const data = await authedGet<StatusResponse>('/api/leonardo/status');
  console.log(`${bold(data.leonardo_name)} synced with ${bold(data.human_name)}`);
}
