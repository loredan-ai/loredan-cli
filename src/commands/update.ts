import { parseArgs } from 'node:util';
import { authedPut } from '../lib/api-client.js';
import { CLIError } from '../lib/errors.js';
import { green, bold, dim } from '../lib/output.js';

interface UpdateResponse {
  leonardo: {
    id: string;
    node_name: string;
    name: string;
    description: string | null;
    created_at: string;
    updated_at: string;
  };
}

export async function update(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      name: { type: 'string' },
      description: { type: 'string' },
      json: { type: 'boolean', default: false },
    },
    strict: false,
  });

  if (!values.name && !values.description) {
    throw new CLIError('Provide at least one of: --name <name>, --description <description>');
  }

  const body: Record<string, string> = {};
  if (typeof values.name === 'string') body.name = values.name;
  if (typeof values.description === 'string') body.description = values.description;

  const data = await authedPut<UpdateResponse>('/api/leonardo/me', body);

  if (values.json) {
    console.log(JSON.stringify(data, null, 2));
    return;
  }

  console.log(green('Updated!'));
  console.log(`  Name:        ${bold(data.leonardo.name)}`);
  if (data.leonardo.description) {
    console.log(`  Description: ${data.leonardo.description}`);
  }
  console.log(`  ID:          ${dim(data.leonardo.id)}`);
}
