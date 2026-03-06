import { randomBytes } from 'node:crypto';
import { StateManager, type LetterSession, type SessionMode } from './state-manager.js';

const SESSION_TTL_MS = 30 * 60 * 1000;

export interface SessionValidationResult {
  valid: boolean;
  error?: string;
  suggestion?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

function generateToken(): string {
  return `ctx_${randomBytes(4).toString('hex')}`;
}

export class SessionTokenManager {
  static async createSession(params: {
    recipientId: string;
    recipientName: string;
    mode: SessionMode;
    reviseLetterIds?: string[] | null;
  }): Promise<LetterSession> {
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_MS);

    const session: LetterSession = {
      token: generateToken(),
      recipientId: params.recipientId,
      recipientName: params.recipientName,
      mode: params.mode,
      createdAt: createdAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      reviseLetterIds: params.reviseLetterIds ?? null,
    };

    await StateManager.setLetterSession(session);
    return session;
  }

  static async clearSession(): Promise<void> {
    await StateManager.clearLetterSession();
  }

  static async getSession(): Promise<LetterSession | null> {
    const state = await StateManager.load();
    return state.letterSession;
  }

  static async validate(params: {
    recipientId?: string;
    mode: SessionMode | 'draft';
    letterId?: string;
  }): Promise<SessionValidationResult> {
    const state = await StateManager.load();
    const session = state.letterSession;

    if (!session) {
      return {
        valid: false,
        error: 'No active session.',
        suggestion: 'Run: loredan letters start --to <recipientId>',
      };
    }

    if (new Date(session.expiresAt).getTime() < Date.now()) {
      return {
        valid: false,
        error: 'Session expired. Context may be stale.',
        suggestion: `Run: loredan letters start --to ${params.recipientId ?? session.recipientId}`,
      };
    }

    if (params.recipientId && session.recipientId !== params.recipientId) {
      return {
        valid: false,
        error: `Active session is for ${session.recipientName} (${session.recipientId}), not recipient ${params.recipientId}.`,
        suggestion: `Run: loredan letters start --to ${params.recipientId}`,
      };
    }

    const expectedModes = params.mode === 'draft' ? ['new', 'ongoing'] : [params.mode];
    if (!expectedModes.includes(session.mode)) {
      if (session.mode === 'revise') {
        const target = session.reviseLetterIds?.[0] ?? '<letter-id>';
        return {
          valid: false,
          error: 'Active session is a revision.',
          suggestion: `Use: loredan letters revise --letter ${target} --content "..."`,
        };
      }

      if (params.mode === 'revise') {
        return {
          valid: false,
          error: 'Active session is for a new letter, not a revision.',
          suggestion: `Run: loredan letters start --to ${session.recipientId} --revise <letterId>`,
        };
      }

      return {
        valid: false,
        error: 'Active session is not valid for drafting.',
        suggestion: `Run: loredan letters start --to ${session.recipientId}`,
      };
    }

    if (params.mode === 'revise' && params.letterId) {
      const allowed = session.reviseLetterIds ?? [];
      if (!allowed.includes(params.letterId)) {
        return {
          valid: false,
          error: `Session was started for a different letter.`,
          suggestion: `Run: loredan letters start --to ${session.recipientId} --revise ${params.letterId}`,
        };
      }
    }

    return { valid: true };
  }

  static formatSummary(session: LetterSession): string {
    return `Session: ${session.token} -> ${session.recipientName} (${session.recipientId})\nExpires: ${session.expiresAt}\nNow: ${nowIso()}`;
  }
}
