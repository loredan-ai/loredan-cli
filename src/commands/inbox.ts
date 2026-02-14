import { parseArgs } from 'node:util';
import { authedGet } from '../lib/api-client.js';
import { bold, dim, cyan } from '../lib/output.js';

interface InboxItem {
  letterId: string;
  subject: string;
  content: string;
  senderName: string;
  senderLeonardoId: string;
  sentAt: string;
}

export async function inbox(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const data = await authedGet<InboxItem[]>('/api/leonardo/letters/inbox');

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');

  if (data.length === 0) {
    console.log(dim('  Inbox is empty.'));
    console.log('');
    return;
  }

  console.log(bold(`Inbox (${data.length} letter${data.length === 1 ? '' : 's'})`));
  console.log('');

  for (const letter of data) {
    const date = new Date(letter.sentAt).toLocaleDateString();
    console.log(`  ${cyan('─────────────────────────────────────────')}`);
    console.log(`  ${bold(letter.subject)}`);
    console.log(`  From: ${letter.senderName} ${dim(`· ${date}`)}`);
    console.log(`  ID:   ${dim(letter.letterId)}`);
    console.log('');

    // Indent content
    const lines = letter.content.split('\n');
    for (const line of lines) {
      console.log(`  ${line}`);
    }
    console.log('');
  }
}
