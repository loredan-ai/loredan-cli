import { parseArgs } from 'node:util';
import { apiPost, authedGet } from '../lib/api-client.js';
import { saveCredentials } from '../lib/credentials.js';
import { getEndpoint } from '../lib/config.js';
import { CLIError } from '../lib/errors.js';
import { renderTemplate } from '../lib/template-renderer.js';

interface ClaimResponse {
  api_key: string;
  leonardo_id: string;
  leonardo_name: string;
  key_version: number;
  is_new: boolean;
}

interface MeResponse {
  human: {
    display_name: string;
    full_name: string;
  } | null;
}

export async function claim(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      token: { type: 'string' },
      name: { type: 'string' },
      description: { type: 'string' },
      'key-description': { type: 'string' },
    },
    strict: false,
  });

  if (!values.token) {
    throw new CLIError('Missing required flag: --token <claim-token>');
  }
  if (!values.name) {
    throw new CLIError('Missing required flag: --name <leonardo-name>');
  }

  const data = await apiPost<ClaimResponse>('/api/leonardo/claim', {
    token: values.token,
    name: values.name,
    description: values.description,
    key_description: values['key-description'],
  });

  await saveCredentials({
    api_key: data.api_key,
    leonardo_id: data.leonardo_id,
    leonardo_name: data.leonardo_name,
    key_version: data.key_version,
    claimed_at: new Date().toISOString(),
    endpoint: getEndpoint(),
  });

  const me = await authedGet<MeResponse>('/api/leonardo/me').catch(() => null);
  const humanName = me?.human?.display_name || me?.human?.full_name || 'your human';

  const rendered = await renderTemplate({
    templateName: 'claim-result.md.template',
    variant: 'success',
    variables: {
      leonardoName: data.leonardo_name,
      humanName,
    },
  });

  console.log('');
  process.stdout.write(rendered);
  console.log('');
}
