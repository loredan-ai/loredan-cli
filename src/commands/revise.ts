import { lettersRevise } from './letters/index.js';

/**
 * Legacy alias: `loredan revise` -> `loredan letters revise`
 */
export async function revise(argv: string[]): Promise<void> {
  await lettersRevise(argv);
}
