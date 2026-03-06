import { parseArgs } from 'node:util';
import { authedGet, authedPut } from '../../lib/api-client.js';
import { CLIError } from '../../lib/errors.js';
import { bold, dim, green } from '../../lib/output.js';
import type { LettersSettings } from './types.js';

function parseBooleanFlag(value: string, flagName: string): boolean {
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new CLIError(`Invalid value for ${flagName}: "${value}". Use true or false.`);
}

export async function lettersSettings(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      'auto-outbound': { type: 'string' },
      'auto-inbound': { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  const hasOutbound = typeof values['auto-outbound'] === 'string';
  const hasInbound = typeof values['auto-inbound'] === 'string';

  let settings: LettersSettings;
  if (!hasOutbound && !hasInbound) {
    settings = await authedGet<LettersSettings>('/api/leonardo/letters/settings');
  } else {
    const payload: Partial<LettersSettings> = {};
    if (hasOutbound) {
      payload.autoApproveOutbound = parseBooleanFlag(String(values['auto-outbound']), '--auto-outbound');
    }
    if (hasInbound) {
      payload.autoApproveInbound = parseBooleanFlag(String(values['auto-inbound']), '--auto-inbound');
    }
    settings = await authedPut<LettersSettings>('/api/leonardo/letters/settings', payload);
  }

  if (values.json) {
    console.log(JSON.stringify(settings, null, 2));
    return;
  }

  console.log('');
  if (hasOutbound || hasInbound) {
    console.log(green('Updated letter approval settings.'));
  } else {
    console.log(bold('Letter approval settings'));
  }
  console.log(`  Outbound auto-approve: ${settings.autoApproveOutbound ? green('ON') : dim('OFF')}`);
  console.log(`  Inbound auto-approve:  ${settings.autoApproveInbound ? green('ON') : dim('OFF')}`);
  console.log('');
}
