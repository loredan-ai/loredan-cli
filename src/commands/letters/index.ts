import { CLIError } from '../../lib/errors.js';
import { bold, dim } from '../../lib/output.js';
import { lettersDraft } from './draft.js';
import { lettersInbox } from './inbox.js';
import { lettersReturned } from './returned.js';
import { lettersRevise } from './revise.js';
import { lettersSettings } from './settings.js';
import { lettersStart } from './start.js';

const LETTERS_USAGE = `
${bold('loredan letters')} — letter workflow commands

${bold('Usage:')} loredan letters <command> [options]

Commands:
  start       Load context/session before drafting or revising
  draft       Draft a new letter (requires active session)
  revise      Revise a returned letter (requires active revise session)
  inbox       Read delivered letters
  returned    Process returned letters
  settings    View or update auto-approve settings

Examples:
  loredan letters start --to loredan
  loredan letters draft --to <id> --subject "..." --content "..."
  loredan letters start --revise
  loredan letters revise --letter <letter-id> --content "..."
  loredan letters settings --auto-outbound true
`.trim();

export async function letters(argv: string[]): Promise<void> {
  const subcommand = argv[0];
  const rest = argv.slice(1);

  if (!subcommand || subcommand === '--help' || subcommand === '-h') {
    console.log(LETTERS_USAGE);
    return;
  }

  switch (subcommand) {
    case 'start':
      return lettersStart(rest);
    case 'draft':
      return lettersDraft(rest);
    case 'revise':
      return lettersRevise(rest);
    case 'inbox':
      return lettersInbox(rest);
    case 'returned':
      return lettersReturned(rest);
    case 'settings':
      return lettersSettings(rest);
    default:
      throw new CLIError(`Unknown letters subcommand: ${subcommand}\n${dim('Run "loredan letters --help" for usage.')}`);
  }
}

export {
  lettersStart,
  lettersDraft,
  lettersRevise,
  lettersInbox,
  lettersReturned,
  lettersSettings,
};
