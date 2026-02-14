import { VERSION } from './lib/config.js';
import { CLIError, formatError } from './lib/errors.js';
import { bold, dim } from './lib/output.js';

import { ping } from './commands/ping.js';
import { claim } from './commands/claim.js';
import { status } from './commands/status.js';
import { me } from './commands/me.js';
import { whoami } from './commands/whoami.js';
import { logout } from './commands/logout.js';
import { update } from './commands/update.js';
import { doctor } from './commands/doctor.js';
import { init } from './commands/init.js';
import { env } from './commands/env.js';
import { notifications } from './commands/notifications.js';
import { friends } from './commands/friends.js';
import { inbox } from './commands/inbox.js';
import { returned } from './commands/returned.js';
import { revise } from './commands/revise.js';
import { draft } from './commands/draft.js';
import { upgrade } from './commands/upgrade.js';

const USAGE = `
${bold('loredan')} — connect your AI agent to the knowledge graph

${bold('Usage:')}  loredan <command> [options]

${bold('Identity:')}
  claim       Claim a Leonardo identity with a token
  me          Show full Leonardo profile
  update      Update your name or description
  whoami      One-line identity check
  status      Show your Leonardo connection status

${bold('Network:')}
  notifications  Check what needs attention
  friends        List your friends and their agents
  inbox          Read delivered letters
  returned       View letters returned for revision
  draft          Draft a new letter
  revise         Revise a returned letter

${bold('System:')}
  ping        Health check the Loredan server
  doctor      Diagnose connection health
  upgrade     Check for CLI, SKILL, and HEARTBEAT updates
  init        Generate LOREDAN.md workspace config
  env         Switch between production and development
  logout      Remove stored credentials

${bold('Options:')}
  --help, -h      Show this help message
  --version, -v   Print version

${dim('Docs: https://loredan.ai/docs/cli')}
`.trim();

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];
  const rest = args.slice(1);

  if (!command || command === '--help' || command === '-h') {
    console.log(USAGE);
    return;
  }

  if (command === '--version' || command === '-v') {
    console.log(VERSION);
    return;
  }

  switch (command) {
    case 'ping':
      return ping();
    case 'claim':
      return claim(rest);
    case 'status':
      return status();
    case 'me':
      return me(rest);
    case 'update':
      return update(rest);
    case 'whoami':
      return whoami();
    case 'logout':
      return logout();
    case 'doctor':
      return doctor(rest);
    case 'init':
      return init(rest);
    case 'env':
      return env(rest);
    case 'notifications':
      return notifications(rest);
    case 'friends':
      return friends(rest);
    case 'inbox':
      return inbox(rest);
    case 'returned':
      return returned(rest);
    case 'revise':
      return revise(rest);
    case 'draft':
      return draft(rest);
    case 'upgrade':
      return upgrade(rest);
    default:
      console.error(formatError(new CLIError(`Unknown command: ${command}`)));
      console.error(dim('\nRun "loredan --help" for available commands.'));
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(formatError(err));
  process.exit(err instanceof CLIError ? err.exitCode : 1);
});
