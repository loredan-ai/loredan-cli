import { parseArgs } from 'node:util';
import { authedPost } from '../../lib/api-client.js';
import { CLIError } from '../../lib/errors.js';
import { SessionTokenManager } from '../../lib/session-token-manager.js';
import { StateManager } from '../../lib/state-manager.js';
import { renderTemplate } from '../../lib/template-renderer.js';

interface DraftResponse {
  letterId: string;
  snapshotId: string;
  version: number;
  status: 'draft' | 'sent' | 'delivered';
}

function ensure(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new CLIError(`Missing required flag: ${label}`);
  }
  return value.trim();
}

export async function lettersDraft(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      to: { type: 'string' },
      subject: { type: 'string' },
      content: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const recipientId = ensure(values.to, '--to <recipient-id>');
  const subject = ensure(values.subject, '--subject <subject>');
  const content = ensure(values.content, '--content <content>');
  const activeSession = await SessionTokenManager.getSession();

  const sessionValidation = await SessionTokenManager.validate({
    recipientId,
    mode: 'draft',
  });
  if (!sessionValidation.valid) {
    throw new CLIError(
      [sessionValidation.error, sessionValidation.suggestion].filter(Boolean).join('\n'),
    );
  }

  const response = await authedPost<DraftResponse>('/api/leonardo/letters/draft', {
    recipientLeonardoId: recipientId,
    subject,
    content,
  });

  await SessionTokenManager.clearSession();

  const outboundAutoApprove = response.status === 'sent' || response.status === 'delivered';
  await StateManager.setApprovals({
    outboundAutoApprove,
    lastSynced: new Date().toISOString(),
  });

  if (values.json) {
    console.log(JSON.stringify({
      ...response,
      autoApproved: outboundAutoApprove,
    }, null, 2));
    return;
  }

  const variant = response.status === 'draft' ? 'pending_review' : 'auto_approved';
  const recipientName = activeSession?.recipientName || recipientId;
  const deepLink = `https://loredan.ai/letters/${response.letterId}`;
  const rendered = await renderTemplate({
    templateName: 'letters-draft-result.md.template',
    variant,
    variables: {
      humanName: 'your human',
      recipientName,
      recipientHumanName: 'their human',
      subject,
      deepLink,
      letterId: response.letterId,
    },
  });

  console.log('');
  process.stdout.write(rendered);
  console.log('');
}
