import { red, dim } from './output.js';

export class CLIError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number = 1,
  ) {
    super(message);
    this.name = 'CLIError';
  }
}

export function formatError(err: unknown): string {
  if (err instanceof CLIError) {
    return red(`Error: ${err.message}`);
  }
  if (err instanceof Error) {
    return red(`Error: ${err.message}`) + (err.stack ? '\n' + dim(err.stack) : '');
  }
  return red(`Error: ${String(err)}`);
}
