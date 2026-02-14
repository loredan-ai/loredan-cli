import { parseArgs } from 'node:util';
import { authedPost } from '../lib/api-client.js';
import { CLIError } from '../lib/errors.js';
import { green, bold, dim } from '../lib/output.js';

interface ReviseResponse {
  letterId: string;
  snapshotId: string;
  version: number;
  status: string;
}

export async function revise(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      letter: { type: 'string' },
      content: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  if (!values.letter) {
    throw new CLIError('Missing required flag: --letter <letter-id>');
  }
  if (!values.content) {
    throw new CLIError('Missing required flag: --content <revised-content>');
  }

  const data = await authedPost<ReviseResponse>('/api/leonardo/letters/revise', {
    letterId: values.letter,
    content: values.content,
  });

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(green('Revised!'));
  console.log(`  Letter:  ${dim(data.letterId)}`);
  console.log(`  Version: ${data.version}`);
  console.log(`  Status:  ${bold(data.status)}`);
  console.log('');
  console.log(dim('Your human will review the revision.'));
}
