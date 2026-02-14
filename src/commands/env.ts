import { parseArgs } from 'node:util';
import {
  credentialsExist,
  loadCredentials,
  updateCredentials,
  type Environment,
} from '../lib/credentials.js';
import { PROD_ENDPOINT, DEFAULT_DEV_ENDPOINT } from '../lib/config.js';
import { CLIError } from '../lib/errors.js';
import { bold, dim, green, yellow, cyan } from '../lib/output.js';

const USAGE = `
${bold('loredan env')} — switch between production and development

${bold('Usage:')}
  loredan env                     Show current environment
  loredan env dev [--endpoint]    Switch to development
  loredan env prod                Switch to production

${bold('Options:')}
  --endpoint, -e    Dev server URL (default: ${DEFAULT_DEV_ENDPOINT})

${bold('Examples:')}
  loredan env dev                         Use default dev endpoint (${DEFAULT_DEV_ENDPOINT})
  loredan env dev -e http://localhost:3000 Use custom dev endpoint
  loredan env prod                        Switch back to production
`.trim();

export async function env(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    options: {
      endpoint: { type: 'string', short: 'e' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help) {
    console.log(USAGE);
    return;
  }

  const target = positionals[0] as string | undefined;

  // No argument — show current environment
  if (!target) {
    return showCurrentEnv();
  }

  // Validate target
  if (target !== 'dev' && target !== 'prod' && target !== 'development' && target !== 'production') {
    throw new CLIError(
      `Unknown environment: "${target}"\nUse: loredan env dev  or  loredan env prod`,
    );
  }

  const isDev = target === 'dev' || target === 'development';

  if (!(await credentialsExist())) {
    throw new CLIError(
      'No credentials found. Claim first, then switch environments.\n' +
      'Run: loredan claim --token <token> --name <name>',
    );
  }

  if (isDev) {
    return switchToDev(values.endpoint as string | undefined);
  } else {
    return switchToProd();
  }
}

async function showCurrentEnv(): Promise<void> {
  const envOverride = process.env.LOREDAN_ENDPOINT;

  if (!(await credentialsExist())) {
    console.log('');
    console.log(`  ${bold('Environment:')} ${green('production')} ${dim('(default, no credentials)')}`);
    console.log(`  ${bold('Endpoint:')}    ${PROD_ENDPOINT}`);
    if (envOverride) {
      console.log(`  ${bold('Override:')}    ${yellow(envOverride)} ${dim('(LOREDAN_ENDPOINT)')}`);
    }
    console.log('');
    return;
  }

  const creds = await loadCredentials();
  const currentEnv = creds.environment || 'production';
  const isDev = currentEnv === 'development';

  const activeEndpoint = isDev && creds.dev_endpoint
    ? creds.dev_endpoint
    : creds.endpoint || PROD_ENDPOINT;

  console.log('');
  console.log(`  ${bold('Environment:')} ${isDev ? yellow('development') : green('production')}`);
  console.log(`  ${bold('Endpoint:')}    ${activeEndpoint}`);

  if (isDev && creds.dev_endpoint) {
    console.log(`  ${bold('Prod saved:')}  ${dim(creds.endpoint || PROD_ENDPOINT)}`);
  }

  if (envOverride) {
    console.log(`  ${bold('Override:')}    ${yellow(envOverride)} ${dim('(LOREDAN_ENDPOINT — takes priority)')}`);
  }

  console.log('');
}

async function switchToDev(endpoint?: string): Promise<void> {
  const devEndpoint = endpoint || DEFAULT_DEV_ENDPOINT;

  const updated = await updateCredentials({
    environment: 'development',
    dev_endpoint: devEndpoint,
  });

  console.log('');
  console.log(`  ${green('Switched to development')}`);
  console.log(`  ${bold('Endpoint:')} ${cyan(devEndpoint)}`);
  console.log('');
  console.log(`  ${dim('All CLI commands now target the dev server.')}`);
  console.log(`  ${dim('Run')} ${bold('loredan env prod')} ${dim('to switch back.')}`);
  console.log('');
}

async function switchToProd(): Promise<void> {
  const creds = await loadCredentials();
  const prodEndpoint = creds.endpoint || PROD_ENDPOINT;

  await updateCredentials({
    environment: 'production',
  });

  console.log('');
  console.log(`  ${green('Switched to production')}`);
  console.log(`  ${bold('Endpoint:')} ${cyan(prodEndpoint)}`);
  console.log('');
}
