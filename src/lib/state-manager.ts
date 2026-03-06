import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const LOREDAN_DIR = join(homedir(), '.loredan');
const STATE_PATH = join(LOREDAN_DIR, 'state.json');

type SessionMode = 'new' | 'ongoing' | 'revise';

export interface LetterSession {
  token: string;
  recipientId: string;
  recipientName: string;
  mode: SessionMode;
  createdAt: string;
  expiresAt: string;
  reviseLetterIds: string[] | null;
}

export interface LoredanState {
  approvals: {
    outboundAutoApprove: boolean;
    inboundAutoApprove: boolean;
    lastSynced: string | null;
  };
  upgrades: {
    lastCheck: string;
  };
  letterSession: LetterSession | null;
}

function defaultState(): LoredanState {
  return {
    approvals: {
      outboundAutoApprove: false,
      inboundAutoApprove: false,
      lastSynced: null,
    },
    upgrades: {
      lastCheck: '',
    },
    letterSession: null,
  };
}

function mergeState(input: Partial<LoredanState> | null | undefined): LoredanState {
  const defaults = defaultState();
  if (!input || typeof input !== 'object') return defaults;

  return {
    approvals: {
      outboundAutoApprove: input.approvals?.outboundAutoApprove ?? defaults.approvals.outboundAutoApprove,
      inboundAutoApprove: input.approvals?.inboundAutoApprove ?? defaults.approvals.inboundAutoApprove,
      lastSynced: input.approvals?.lastSynced ?? defaults.approvals.lastSynced,
    },
    upgrades: {
      lastCheck: input.upgrades?.lastCheck ?? defaults.upgrades.lastCheck,
    },
    letterSession: input.letterSession ?? defaults.letterSession,
  };
}

export class StateManager {
  static path(): string {
    return STATE_PATH;
  }

  static async load(): Promise<LoredanState> {
    try {
      const raw = await readFile(STATE_PATH, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<LoredanState>;
      return mergeState(parsed);
    } catch {
      return defaultState();
    }
  }

  static async save(state: LoredanState): Promise<void> {
    await mkdir(LOREDAN_DIR, { recursive: true, mode: 0o700 });
    await writeFile(
      STATE_PATH,
      JSON.stringify(state, null, 2) + '\n',
      { mode: 0o600 },
    );
  }

  static async initialize(params: {
    outboundAutoApprove?: boolean;
    inboundAutoApprove?: boolean;
  }): Promise<LoredanState> {
    const now = new Date().toISOString();
    const state: LoredanState = {
      approvals: {
        outboundAutoApprove: params.outboundAutoApprove ?? false,
        inboundAutoApprove: params.inboundAutoApprove ?? false,
        lastSynced: null,
      },
      upgrades: {
        lastCheck: now,
      },
      letterSession: null,
    };

    await this.save(state);
    return state;
  }

  static async patch(patch: {
    approvals?: Partial<LoredanState['approvals']>;
    upgrades?: Partial<LoredanState['upgrades']>;
    letterSession?: LetterSession | null;
  }): Promise<LoredanState> {
    const current = await this.load();
    const merged = mergeState({
      ...current,
      ...patch,
      approvals: {
        ...current.approvals,
        ...(patch.approvals ?? {}),
      },
      upgrades: {
        ...current.upgrades,
        ...(patch.upgrades ?? {}),
      },
    });

    await this.save(merged);
    return merged;
  }

  static async touchLastCheck(): Promise<void> {
    await this.patch({ upgrades: { lastCheck: new Date().toISOString() } });
  }

  static async setApprovals(params: {
    outboundAutoApprove?: boolean;
    inboundAutoApprove?: boolean;
    lastSynced?: string | null;
  }): Promise<LoredanState> {
    return this.patch({
      approvals: {
        ...params,
      },
    });
  }

  static async clearLetterSession(): Promise<void> {
    await this.patch({ letterSession: null });
  }

  static async setLetterSession(session: LetterSession | null): Promise<void> {
    await this.patch({ letterSession: session });
  }
}

export type { SessionMode };
