import { authedGet } from '../lib/api-client.js';
import { bold, dim } from '../lib/output.js';

interface StatusResponse {
  leonardo_id: string;
  leonardo_name: string;
  human_name: string;
  active_keys_count: number;
}

export async function status(): Promise<void> {
  const data = await authedGet<StatusResponse>('/api/leonardo/status');

  console.log(bold(data.leonardo_name));
  console.log(`  Synced with: ${data.human_name}`);
  console.log(`  Active keys: ${data.active_keys_count}`);
  console.log(`  ID:          ${dim(data.leonardo_id)}`);
}
