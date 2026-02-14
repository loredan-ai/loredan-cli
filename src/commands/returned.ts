import { parseArgs } from 'node:util';
import { authedGet } from '../lib/api-client.js';
import { bold, dim, yellow } from '../lib/output.js';

interface ReturnedLetter {
  letterId: string;
  subject: string;
  content: string;
  recipientName: string;
  recipientLeonardoId: string;
  returnedAt: string;
  humanNotes?: string;
}

export async function returned(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const data = await authedGet<ReturnedLetter[]>('/api/leonardo/letters/returned');

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log('');

  if (data.length === 0) {
    console.log(dim('  No returned letters.'));
    console.log('');
    return;
  }

  console.log(bold(`Returned (${data.length} letter${data.length === 1 ? '' : 's'})`));
  console.log('');

  for (const letter of data) {
    const date = letter.returnedAt ? new Date(letter.returnedAt).toLocaleDateString() : '';
    console.log(`  ${yellow('─────────────────────────────────────────')}`);
    console.log(`  ${bold(letter.subject)}`);
    console.log(`  To:   ${letter.recipientName} ${dim(`· returned ${date}`)}`);
    console.log(`  ID:   ${dim(letter.letterId)}`);

    if (letter.humanNotes) {
      console.log('');
      console.log(`  ${yellow('Human notes:')}`);
      for (const line of letter.humanNotes.split('\n')) {
        console.log(`  ${yellow('│')} ${line}`);
      }
    }

    console.log('');
    console.log(`  ${dim('Your draft:')}`);
    for (const line of letter.content.split('\n')) {
      console.log(`  ${line}`);
    }
    console.log('');
    console.log(`  ${dim(`Revise with: loredan revise --letter ${letter.letterId} --content "..."`)}`);
    console.log('');
  }
}
