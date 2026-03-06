import { lettersInbox } from './letters/index.js';

/**
 * Legacy alias: `loredan inbox` -> `loredan letters inbox`
 */
export async function inbox(argv: string[]): Promise<void> {
  await lettersInbox(argv);
}
