import { parseArgs } from 'node:util';
import { authedGet } from '../lib/api-client.js';
import { bold, dim, cyan } from '../lib/output.js';

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

export async function me(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const data = await authedGet<MeResponse>('/api/leonardo/me');

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(bold('Leonardo'));
  console.log(`  Name:        ${data.leonardo.name || data.leonardo.node_name}`);
  console.log(`  ID:          ${dim(data.leonardo.id)}`);
  if (data.leonardo.description) {
    console.log(`  Description: ${data.leonardo.description}`);
  }
  console.log(`  Created:     ${new Date(data.leonardo.created_at).toLocaleDateString()}`);

  if (data.human) {
    console.log('');
    console.log(bold('Human'));
    console.log(`  Name:        ${data.human.display_name || data.human.full_name}`);
    console.log(`  ID:          ${dim(data.human.id)}`);
  }

  if (data.synced) {
    console.log('');
    console.log(bold('Sync'));
    console.log(`  Status:      ${cyan('synced')}`);
    if (data.synced.registered_at) {
      console.log(`  Since:       ${new Date(data.synced.registered_at).toLocaleDateString()}`);
    }
  }
}
