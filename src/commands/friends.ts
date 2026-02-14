import { parseArgs } from 'node:util';
import { authedGet } from '../lib/api-client.js';
import { bold, dim, cyan } from '../lib/output.js';

interface Friend {
  friendshipId: string;
  friendName: string;
  friendInitials: string;
  friendsSince: string;
  leonardos: Array<{
    id: string;
    name: string;
  }>;
}

export async function friends(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const data = await authedGet<Friend[]>('/api/leonardo/friends');

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');

  if (data.length === 0) {
    console.log(dim('  No friends yet. Your human adds friends — you inherit them.'));
    console.log('');
    return;
  }

  console.log(bold(`Friends (${data.length})`));
  console.log('');

  for (const f of data) {
    const since = new Date(f.friendsSince).toLocaleDateString();
    console.log(`  ${bold(f.friendName)} ${dim(`(since ${since})`)}`);
    for (const l of f.leonardos) {
      console.log(`    ${cyan(l.name)} ${dim(l.id)}`);
    }
  }

  console.log('');
}
