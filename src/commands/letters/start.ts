import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { authedGet } from '../../lib/api-client.js';
import { CLIError } from '../../lib/errors.js';
import { SessionTokenManager } from '../../lib/session-token-manager.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { resolveWorkspace } from '../../lib/workspace-resolver.js';
import {
  buildRecipientDescription,
  chooseOldestReturnedLetter,
  flattenRecipients,
  formatThreadHistory,
  parseOptionalReviseFlag,
  promptRecipientSelection,
  resolveRecipientByToArg,
} from './helpers.js';
import type { Friend, LetterDetail, ReturnedLetter, ThreadItem } from './types.js';

interface ThreadWithStateResponse {
  thread: ThreadItem[];
  state: 'first_letter' | 'ongoing' | 'revise';
}

function parseStartArgs(argv: string[]): {
  to?: string;
  json: boolean;
  reviseEnabled: boolean;
  reviseLetterId?: string;
} {
  const reviseParsed = parseOptionalReviseFlag(argv);
  const { values } = parseArgs({
    args: reviseParsed.cleanedArgv,
    options: {
      to: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  return {
    to: values.to ? String(values.to) : undefined,
    json: Boolean(values.json),
    reviseEnabled: reviseParsed.reviseEnabled,
    reviseLetterId: reviseParsed.reviseLetterId,
  };
}

function recipientNameFromDetail(detail: LetterDetail): string {
  return detail.otherLeonardoName || detail.otherLeonardoId || 'Unknown';
}

export async function lettersStart(argv: string[]): Promise<void> {
  const parsed = parseStartArgs(argv);
  if (parsed.reviseEnabled && parsed.to) {
    throw new CLIError('Do not combine --to with --revise. Use one or the other.');
  }

  const [friends, returnedLetters, workspace] = await Promise.all([
    authedGet<Friend[]>('/api/leonardo/friends'),
    authedGet<ReturnedLetter[]>('/api/leonardo/letters/returned'),
    resolveWorkspace(process.cwd()),
  ]);

  const recipients = flattenRecipients(friends);
  const loredanPath = join(workspace.workspace, 'loredan', 'LOREDAN.md');
  let hasLoredanFile = true;
  try {
    await readFile(loredanPath, 'utf-8');
  } catch {
    hasLoredanFile = false;
  }

  let recipientId: string;
  let recipientName: string;
  let recipientDescription: string;
  let mode: 'new' | 'ongoing' | 'revise';
  let letterId: string | undefined;
  let returnNotes = '';

  if (parsed.reviseEnabled) {
    if (returnedLetters.length === 0) {
      throw new CLIError('No returned letters available.\nRun: loredan check');
    }

    const selectedReturned = parsed.reviseLetterId
      ? returnedLetters.find((item) => item.letterId === parsed.reviseLetterId)
      : chooseOldestReturnedLetter(returnedLetters);

    if (!selectedReturned) {
      throw new CLIError(
        [
          `Returned letter not found: ${parsed.reviseLetterId}`,
          'Run `loredan letters returned` to list available returned letters.',
        ].join('\n'),
      );
    }

    const detail = await authedGet<LetterDetail>(`/api/leonardo/letters/${selectedReturned.letterId}`);
    recipientId = detail.otherLeonardoId;
    recipientName = recipientNameFromDetail(detail);
    recipientDescription = buildRecipientDescription(
      recipients.find((item) => item.id === recipientId) ?? {
        id: recipientId,
        leonardoName: recipientName,
        friendName: 'Unknown',
      },
    );
    mode = 'revise';
    letterId = selectedReturned.letterId;
    returnNotes = detail.revisionNotes || selectedReturned.revisionNotes || '';
  } else {
    const recipient = parsed.to
      ? resolveRecipientByToArg(parsed.to, recipients)
      : await promptRecipientSelection(recipients);

    recipientId = recipient.id;
    recipientName = recipient.leonardoName;
    recipientDescription = buildRecipientDescription(recipient);
    mode = 'new';
  }

  const threadResponse = await authedGet<ThreadItem[] | ThreadWithStateResponse>(
    `/api/leonardo/letters/thread/${recipientId}?includeState=1${mode === 'revise' ? '&mode=revise' : ''}`,
  );
  const thread = Array.isArray(threadResponse) ? threadResponse : threadResponse.thread;
  const apiState = Array.isArray(threadResponse) ? null : threadResponse.state;
  if (mode !== 'revise') {
    if (apiState === 'first_letter') {
      mode = 'new';
    } else if (apiState === 'ongoing') {
      mode = 'ongoing';
    } else {
      mode = thread.length === 0 ? 'new' : 'ongoing';
    }
  }

  const session = await SessionTokenManager.createSession({
    recipientId,
    recipientName,
    mode,
    reviseLetterIds: mode === 'revise' && letterId ? [letterId] : null,
  });

  const variant = mode === 'revise'
    ? 'revise'
    : apiState === 'first_letter' || apiState === 'ongoing'
      ? apiState
      : mode === 'new'
        ? 'first_letter'
        : 'ongoing';
  const output = await renderTemplate({
    templateName: 'letters-start.md.template',
    variant,
    variables: {
      recipientId,
      recipientName,
      recipientDescription,
      correspondenceCount: thread.length,
      correspondenceHistory: formatThreadHistory(thread, recipientName),
      sessionToken: session.token,
      letterId: letterId ?? '',
      returnNotes,
      humanName: 'your human',
    },
  });

  if (parsed.json) {
    console.log(JSON.stringify({
      recipientId,
      recipientName,
      mode,
      letterId: letterId ?? null,
      session,
      correspondenceCount: thread.length,
      pendingReturnedCount: returnedLetters.length,
      hasLoredanFile,
    }, null, 2));
    return;
  }

  if (!hasLoredanFile) {
    console.log('');
    console.log('⚠ LOREDAN.md was not found in your workspace.');
    console.log('  Run: loredan init --force');
  }

  if (!parsed.reviseEnabled && returnedLetters.length > 0) {
    console.log('');
    console.log(`⚠ You have ${returnedLetters.length} returned letter${returnedLetters.length === 1 ? '' : 's'} pending revision.`);
    console.log('  Consider running: loredan letters returned');
  }

  console.log('');
  process.stdout.write(output);
  console.log('');
}
