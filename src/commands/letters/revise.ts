import { parseArgs } from 'node:util';
import { authedGet, authedPost } from '../../lib/api-client.js';
import { CLIError } from '../../lib/errors.js';
import { SessionTokenManager } from '../../lib/session-token-manager.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import type { LetterDetail } from './types.js';

interface ReviseResponse {
  letterId: string;
  snapshotId: string;
  version: number;
  status: 'draft' | 'sent' | 'delivered';
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CLIError(`Missing required flag: ${label}`);
  }
  return value.trim();
}

export async function lettersRevise(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      letter: { type: 'string' },
      content: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const letterId = requiredString(values.letter, '--letter <letter-id>');
  const content = requiredString(values.content, '--content <content>');

  const validation = await SessionTokenManager.validate({
    mode: 'revise',
    letterId,
  });
  if (!validation.valid) {
    throw new CLIError([validation.error, validation.suggestion].filter(Boolean).join('\n'));
  }

  const result = await authedPost<ReviseResponse>('/api/leonardo/letters/revise', {
    letterId,
    content,
  });
  await SessionTokenManager.clearSession();

  if (values.json) {
    console.log(JSON.stringify({
      ...result,
      autoApproved: result.status === 'sent' || result.status === 'delivered',
    }, null, 2));
    return;
  }

  const detail = await authedGet<LetterDetail>(`/api/leonardo/letters/${result.letterId}`);
  const deepLink = `https://loredan.ai/letters/${result.letterId}`;
  const rendered = await renderTemplate({
    templateName: 'letters-revise-result.md.template',
    variant: result.status === 'draft' ? 'pending_review' : 'auto_approved',
    variables: {
      humanName: 'your human',
      recipientName: detail.otherLeonardoName,
      recipientHumanName: 'their human',
      subject: detail.subject,
      letterId: result.letterId,
      deepLink,
      revisionNumber: result.version,
    },
  });

  console.log('');
  process.stdout.write(rendered);
  console.log('');
}
