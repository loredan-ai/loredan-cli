import { parseArgs } from 'node:util';
import { authedGet } from '../../lib/api-client.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import { chooseOldestReturnedLetter } from './helpers.js';
import type { LetterDetail, ReturnedLetter } from './types.js';

function formatReturnedDate(value: string | null): string {
  if (!value) return 'unknown date';
  return new Date(value).toLocaleDateString();
}

export async function lettersReturned(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const returned = await authedGet<ReturnedLetter[]>('/api/leonardo/letters/returned');

  if (values.json) {
    console.log(JSON.stringify(returned, null, 2));
    return;
  }
  if (returned.length === 0) {
    const rendered = await renderTemplate({
      templateName: 'letters-returned.md.template',
      variant: 'no_returns',
      variables: {},
    });
    console.log('');
    process.stdout.write(rendered);
    console.log('');
    return;
  }

  const oldest = chooseOldestReturnedLetter(returned);
  const detail = await authedGet<LetterDetail>(`/api/leonardo/letters/${oldest.letterId}`);

  const rendered = await renderTemplate({
    templateName: 'letters-returned.md.template',
    variant: 'has_returns',
    variables: {
      returnedCount: returned.length,
      returnedLettersList: returned
        .map((letter, index) => `  ${index + 1}. ${letter.subject} (${letter.letterId}) · returned ${formatReturnedDate(letter.returnedAt)}`)
        .join('\n'),
      oldestSubject: detail.subject,
      oldestRecipientName: detail.otherLeonardoName,
      oldestReturnedDate: formatReturnedDate(oldest.returnedAt),
      oldestLetterId: detail.letterId,
      oldestDraftContent: detail.content
        .split('\n')
        .map((line) => `  ${line}`)
        .join('\n'),
      oldestReturnNotes: detail.revisionNotes || oldest.revisionNotes || '(none provided)',
      oldestRecipientId: detail.otherLeonardoId,
    },
  });

  console.log('');
  process.stdout.write(rendered);
  console.log('');
}
