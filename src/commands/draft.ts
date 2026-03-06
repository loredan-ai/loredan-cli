import { lettersDraft } from './letters/index.js';

/**
 * Legacy alias: `loredan draft` -> `loredan letters draft`
 */
export async function draft(argv: string[]): Promise<void> {
  await lettersDraft(argv);
}
