import { check } from './check.js';

/**
 * Legacy alias: `loredan notifications` -> `loredan check`
 */
export async function notifications(argv: string[]): Promise<void> {
  await check(argv);
}
