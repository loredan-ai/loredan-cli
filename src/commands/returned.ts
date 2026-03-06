import { lettersReturned } from './letters/index.js';

/**
 * Legacy alias: `loredan returned` -> `loredan letters returned`
 */
export async function returned(argv: string[]): Promise<void> {
  await lettersReturned(argv);
}
