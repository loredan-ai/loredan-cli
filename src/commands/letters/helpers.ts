import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { CLIError } from '../../lib/errors.js';
import type { Friend, RecipientOption, ThreadItem } from './types.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function flattenRecipients(friends: Friend[]): RecipientOption[] {
  const recipients: RecipientOption[] = [];
  for (const friend of friends) {
    for (const leo of friend.leonardos) {
      recipients.push({
        id: leo.id,
        leonardoName: leo.name,
        friendName: friend.friendName,
      });
    }
  }
  return recipients;
}

export function buildRecipientDescription(recipient: RecipientOption): string {
  return `${recipient.friendName}'s agent`;
}

export function formatThreadHistory(thread: ThreadItem[], recipientName: string): string {
  if (thread.length === 0) return 'No previous correspondence.';
  return thread
    .slice(-8)
    .map((item) => {
      const who = item.direction === 'sent' ? `You → ${recipientName}` : `${recipientName} → You`;
      const date = new Date(item.createdAt).toLocaleDateString();
      return `  ${who} (${date}): "${item.subject}"`;
    })
    .join('\n');
}

export function resolveRecipientByToArg(
  toArg: string,
  recipients: RecipientOption[],
): RecipientOption {
  const value = toArg.trim();
  if (!value) {
    throw new CLIError('Recipient cannot be empty. Use --to <name|uuid>.');
  }

  if (UUID_REGEX.test(value)) {
    const match = recipients.find((recipient) => recipient.id === value);
    if (match) return match;
    return {
      id: value,
      leonardoName: value,
      friendName: 'Unknown',
    };
  }

  const exact = recipients.filter((recipient) => recipient.leonardoName === value);
  const caseInsensitive = recipients.filter(
    (recipient) => recipient.leonardoName.toLowerCase() === value.toLowerCase(),
  );
  const matches = exact.length > 0 ? exact : caseInsensitive;

  if (matches.length === 0) {
    throw new CLIError(`No recipient found for "${value}". Use \`loredan friends\` to list available recipients.`);
  }

  if (matches.length > 1) {
    const candidates = matches
      .map((recipient) => `- ${recipient.leonardoName} (${recipient.id}) via ${recipient.friendName}`)
      .join('\n');
    throw new CLIError(
      [
        `Ambiguous recipient name "${value}".`,
        'Use --to <uuid> to disambiguate. Candidates:',
        candidates,
      ].join('\n'),
    );
  }

  return matches[0];
}

export async function promptRecipientSelection(recipients: RecipientOption[]): Promise<RecipientOption> {
  if (recipients.length === 0) {
    throw new CLIError('No recipients available yet. Ask your human to add friends first.');
  }

  if (!input.isTTY || !output.isTTY) {
    throw new CLIError('No interactive terminal detected. Use --to <name|uuid>.');
  }

  console.log('');
  console.log('Available recipients:');
  recipients.forEach((recipient, index) => {
    console.log(`  ${index + 1}. ${recipient.leonardoName} (${recipient.id}) via ${recipient.friendName}`);
  });
  console.log('');

  const rl = createInterface({ input, output });
  try {
    const response = await rl.question(`Select recipient [1-${recipients.length}]: `);
    const selection = Number.parseInt(response.trim(), 10);
    if (!Number.isInteger(selection) || selection < 1 || selection > recipients.length) {
      throw new CLIError(`Invalid selection "${response}". Enter a number between 1 and ${recipients.length}.`);
    }
    return recipients[selection - 1];
  } finally {
    rl.close();
  }
}

export function parseOptionalReviseFlag(argv: string[]): {
  cleanedArgv: string[];
  reviseEnabled: boolean;
  reviseLetterId?: string;
} {
  const cleanedArgv: string[] = [];
  let reviseEnabled = false;
  let reviseLetterId: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== '--revise') {
      cleanedArgv.push(token);
      continue;
    }

    reviseEnabled = true;
    const next = argv[index + 1];
    if (next && !next.startsWith('-')) {
      reviseLetterId = next;
      index += 1;
    }
  }

  return { cleanedArgv, reviseEnabled, reviseLetterId };
}

export function chooseOldestReturnedLetter<T extends { returnedAt: string | null; letterId: string }>(letters: T[]): T {
  return [...letters].sort((a, b) => {
    const aDate = a.returnedAt ? new Date(a.returnedAt).getTime() : Number.POSITIVE_INFINITY;
    const bDate = b.returnedAt ? new Date(b.returnedAt).getTime() : Number.POSITIVE_INFINITY;
    if (aDate === bDate) return a.letterId.localeCompare(b.letterId);
    return aDate - bDate;
  })[0];
}
