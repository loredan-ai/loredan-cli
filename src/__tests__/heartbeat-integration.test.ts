import { describe, expect, it, jest } from '@jest/globals';
import { join } from 'node:path';
import { ensureHeartbeatDirective } from '../commands/init.js';
import { checkHeartbeatEnabled, checkPeriodicCheckin } from '../commands/doctor.js';

const WORKSPACE = '/tmp/workspace';
const HEARTBEAT_PATH = join(WORKSPACE, 'HEARTBEAT.md');
const DIRECTIVE = [
  '## Loredan Network Check',
  'Run `loredan check` and follow its directive.',
  'If returns exist, process them via `loredan letters returned`.',
  'If new inbox letters arrive, read them via `loredan letters inbox`.',
  'If pending approvals are waiting, there is nothing for you to do yet.',
  'If doctor warnings appear, run `loredan doctor`.',
  'If a CLI upgrade is available, run `loredan upgrade`.',
].join('\n');

describe('ensureHeartbeatDirective', () => {
  it('writes directive to HEARTBEAT.md that has no existing Loredan section', async () => {
    const writeFileFn = jest.fn(async (_path: string, _content: string) => {});
    const result = await ensureHeartbeatDirective(WORKSPACE, false, {
      fileExistsFn: async () => true,
      readFileFn: async () => '# Existing Section',
      writeFileFn,
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('written');
    expect(writeFileFn).toHaveBeenCalledWith(
      HEARTBEAT_PATH,
      `# Existing Section\n\n${DIRECTIVE}\n`,
    );
  });

  it('updates directive when existing section content differs', async () => {
    const writeFileFn = jest.fn(async (_path: string, _content: string) => {});
    const result = await ensureHeartbeatDirective(WORKSPACE, false, {
      fileExistsFn: async () => true,
      readFileFn: async () => [
        '# Intro',
        '',
        '## Loredan Network Check',
        'old line',
        '',
        '## Tail',
        'keep me',
      ].join('\n'),
      writeFileFn,
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('updated');
    const output = writeFileFn.mock.calls[0]?.[1] ?? '';
    expect(output).toContain('# Intro');
    expect(output).toContain(DIRECTIVE);
    expect(output).toContain('## Tail\nkeep me');
    expect(output).not.toContain('old line');
  });

  it('skips update when section already matches template', async () => {
    const writeFileFn = jest.fn(async (_path: string, _content: string) => {});
    const result = await ensureHeartbeatDirective(WORKSPACE, false, {
      fileExistsFn: async () => true,
      readFileFn: async () => `${DIRECTIVE}\n`,
      writeFileFn,
      renderTemplateFn: async () => `${DIRECTIVE}\n`,
    });

    expect(result.status).toBe('current');
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  it('force mode rewrites section even when content matches', async () => {
    const writeFileFn = jest.fn(async (_path: string, _content: string) => {});
    const result = await ensureHeartbeatDirective(WORKSPACE, true, {
      fileExistsFn: async () => true,
      readFileFn: async () => `${DIRECTIVE}\n`,
      writeFileFn,
      renderTemplateFn: async () => `${DIRECTIVE}\n`,
    });

    expect(result.status).toBe('updated');
    expect(writeFileFn).toHaveBeenCalledTimes(1);
  });

  it('returns no_heartbeat_file when HEARTBEAT.md does not exist', async () => {
    const readFileFn = jest.fn(async () => '');
    const writeFileFn = jest.fn(async (_path: string, _content: string) => {});
    const result = await ensureHeartbeatDirective(WORKSPACE, false, {
      fileExistsFn: async () => false,
      readFileFn,
      writeFileFn,
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('no_heartbeat_file');
    expect(readFileFn).not.toHaveBeenCalled();
    expect(writeFileFn).not.toHaveBeenCalled();
  });

  it('preserves content before and after the Loredan section when updating', async () => {
    const writeFileFn = jest.fn(async (_path: string, _content: string) => {});
    const result = await ensureHeartbeatDirective(WORKSPACE, false, {
      fileExistsFn: async () => true,
      readFileFn: async () => [
        '## Before',
        'before body',
        '',
        '## Loredan Network Check',
        'stale directive',
        '',
        '',
        '## After',
        'after body',
      ].join('\n'),
      writeFileFn,
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('updated');
    const output = writeFileFn.mock.calls[0]?.[1] ?? '';
    expect(output.startsWith('## Before\nbefore body\n\n## Loredan Network Check')).toBe(true);
    expect(output.endsWith('\n## After\nafter body\n')).toBe(true);
  });
});

describe('checkPeriodicCheckin', () => {
  it('returns pass when HEARTBEAT.md contains current template content', async () => {
    const result = await checkPeriodicCheckin(6, {
      resolveWorkspaceFn: async () => ({ workspace: WORKSPACE, source: 'cwd' }),
      readFileFn: async () => [
        '## Other Section',
        'noop',
        '',
        `${DIRECTIVE}   `,
        '',
        '## Tail',
        'done',
      ].join('\n'),
      renderTemplateFn: async () => `${DIRECTIVE}\n`,
    });

    expect(result.status).toBe('pass');
  });

  it('returns warn when section exists but content differs', async () => {
    const result = await checkPeriodicCheckin(6, {
      resolveWorkspaceFn: async () => ({ workspace: WORKSPACE, source: 'cwd' }),
      readFileFn: async () => [
        '## Loredan Network Check',
        'Run `loredan check` and do something old.',
      ].join('\n'),
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('outdated');
  });

  it('returns fail when HEARTBEAT.md is missing', async () => {
    const result = await checkPeriodicCheckin(6, {
      resolveWorkspaceFn: async () => ({ workspace: WORKSPACE, source: 'cwd' }),
      readFileFn: async () => {
        throw new Error('ENOENT');
      },
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('fail');
    expect(result.message).toContain('Missing HEARTBEAT.md');
  });

  it('returns fail when HEARTBEAT.md exists but has no Loredan section', async () => {
    const result = await checkPeriodicCheckin(6, {
      resolveWorkspaceFn: async () => ({ workspace: WORKSPACE, source: 'cwd' }),
      readFileFn: async () => '# Heartbeat file without section',
      renderTemplateFn: async () => DIRECTIVE,
    });

    expect(result.status).toBe('fail');
    expect(result.message).toContain('missing the Loredan check section');
  });
});

describe('checkHeartbeatEnabled', () => {
  it('returns pass when heartbeat.every is valid and non-zero', async () => {
    const result = await checkHeartbeatEnabled(7, {
      readFileFn: async () => JSON.stringify({
        agents: {
          main: {
            heartbeat: { every: '60m' },
          },
        },
      }),
    });

    expect(result.status).toBe('pass');
    expect(result.message).toContain('60m');
  });

  it('returns fail when heartbeat.every is zero or missing', async () => {
    const zeroResult = await checkHeartbeatEnabled(7, {
      readFileFn: async () => JSON.stringify({
        agents: {
          main: {
            heartbeat: { every: '0' },
          },
        },
      }),
    });
    const missingResult = await checkHeartbeatEnabled(7, {
      readFileFn: async () => JSON.stringify({
        agents: {
          main: {
            heartbeat: {},
          },
        },
      }),
    });
    const missingAgentsResult = await checkHeartbeatEnabled(7, {
      readFileFn: async () => JSON.stringify({}),
    });

    expect(zeroResult.status).toBe('fail');
    expect(missingResult.status).toBe('fail');
    expect(missingAgentsResult.status).toBe('fail');
  });

  it('returns warn when config cannot be read or duration format is invalid', async () => {
    const invalidDurationResult = await checkHeartbeatEnabled(7, {
      readFileFn: async () => JSON.stringify({
        agents: {
          main: {
            heartbeat: { every: 'abc' },
          },
        },
      }),
    });
    const readFailureResult = await checkHeartbeatEnabled(7, {
      readFileFn: async () => {
        throw new Error('EACCES');
      },
    });

    expect(invalidDurationResult.status).toBe('warn');
    expect(readFailureResult.status).toBe('warn');
  });
});
