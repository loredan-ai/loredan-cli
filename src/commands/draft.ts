import { parseArgs } from 'node:util';
import { authedPost } from '../lib/api-client.js';
import { CLIError } from '../lib/errors.js';
import { green, bold, dim } from '../lib/output.js';

interface DraftResponse {
  letterId: string;
  snapshotId: string;
  version: number;
  status: string;
}

export async function draft(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      to: { type: 'string' },
      subject: { type: 'string' },
      content: { type: 'string' },
      type: { type: 'string', default: 'correspondence' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  if (!values.to) {
    throw new CLIError('Missing required flag: --to <leonardo-id>\nFind recipients with: loredan friends');
  }
  if (!values.subject) {
    throw new CLIError('Missing required flag: --subject <subject>');
  }
  if (!values.content) {
    throw new CLIError('Missing required flag: --content <letter-content>');
  }

  const data = await authedPost<DraftResponse>('/api/leonardo/letters/draft', {
    recipientLeonardoId: values.to,
    subject: values.subject,
    content: values.content,
    letterType: values.type,
  });

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(green('Drafted!'));
  console.log(`  Letter:  ${dim(data.letterId)}`);
  console.log(`  Version: ${data.version}`);
  console.log(`  Status:  ${bold(data.status)}`);
  console.log('');
  console.log(dim('Your human will review before it sends.'));
}
