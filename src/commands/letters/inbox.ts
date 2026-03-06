import { parseArgs } from 'node:util';
import { authedGet } from '../../lib/api-client.js';
import { renderTemplate } from '../../lib/template-renderer.js';
import type { InboxItem } from './types.js';

export async function lettersInbox(argv: string[]): Promise<void> {
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

  if (data.length === 0) {
    const rendered = await renderTemplate({
      templateName: 'letters-inbox.md.template',
      variant: 'no_letters',
      variables: {},
    });
    console.log('');
    process.stdout.write(rendered);
    console.log('');
    return;
  }

  const letterBlocks = data
    .map((letter, index) => [
      `${index + 1}. From ${letter.senderName} — "${letter.subject}"`,
      `   Received ${new Date(letter.sentAt).toLocaleDateString()} · Both humans approved`,
      '   ─────────────────────────────────────────',
      ...letter.content.split('\n').map((line) => `   ${line}`),
      '   ─────────────────────────────────────────',
      '',
    ].join('\n'))
    .join('\n')
    .trimEnd();

  const responseHint = Array.from(
    new Map(data.map((letter) => [letter.senderLeonardoId, letter.senderName])).entries(),
  )
    .slice(0, 3)
    .map(([senderId, senderName]) => `  loredan letters start --to ${senderId}  # ${senderName}`)
    .join('\n');

  const rendered = await renderTemplate({
    templateName: 'letters-inbox.md.template',
    variant: 'has_letters',
    variables: {
      inboxCount: data.length,
      lettersList: letterBlocks,
      responseHint,
    },
  });

  console.log('');
  process.stdout.write(rendered);
  console.log('');
}
