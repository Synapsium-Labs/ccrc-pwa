// `account-op.mjs set-facts` (the serviceability plan's Task 3, F11), the one writer of a lane's `fableBilling` and
// `continuity`, which the account set verb's `--fable-billing` and `--continuity` flags reach. The op itself, with no
// verb around it: each flag writes its field, `off` removes the key, `on` over a standing record keeps its time, a call
// that changes nothing writes no byte, and a value off its vocabulary writes nothing. It prints nothing on success.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkTmp } from './tmpHelpers.js';
import { REPO } from './laneStateFixture.js';

const OP = path.join(REPO, 'deploy', 'account-op.mjs');

const ROSTER = {
  version: 1,
  accounts: [
    { id: 'lane-a', label: 'lane-a', configDirSuffix: '.lane-a', exec: { kind: 'upstream' }, homeAble: true, hue: 'cyan', telemetry: 'anthropic' },
    { id: 'lane-b', label: 'lane-b', configDirSuffix: '.lane-b', exec: { kind: 'generated' }, homeAble: true, hue: 'amber', telemetry: 'anthropic' },
  ],
};

const rosterFile = (): string => {
  const file = path.join(mkTmp('account-op-facts-'), 'accounts.json');
  writeFileSync(file, `${JSON.stringify(ROSTER, null, 2)}\n`, { mode: 0o600 });
  return file;
};
const op = (file: string, id: string, ...flags: string[]): { code: number | null; stdout: string } => {
  const r = spawnSync(process.execPath, [OP, 'set-facts', '--file', file, '--id', id, ...flags], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout };
};
const entry = (file: string, id: string): Record<string, unknown> =>
  (JSON.parse(readFileSync(file, 'utf8')) as typeof ROSTER).accounts.find((a) => a.id === id) as unknown as Record<string, unknown>;

describe('set-facts writes the two account facts and nothing else (F11)', () => {
  it('each billing word is written, silently', () => {
    const file = rosterFile();
    expect(op(file, 'lane-a', '--fable-billing', 'credits', '--recorded-at', 'now')).toEqual({ code: 0, stdout: '' });
    expect(entry(file, 'lane-a')['fableBilling']).toBe('credits');
    expect(op(file, 'lane-a', '--fable-billing', 'included', '--recorded-at', 'now')).toEqual({ code: 0, stdout: '' });
    expect(entry(file, 'lane-a')['fableBilling']).toBe('included');
    expect(entry(file, 'lane-b')).toEqual(ROSTER.accounts[1]);
    expect(entry(file, 'lane-a')['continuity']).toBeUndefined();
  });

  it('on writes the given time; off removes the key, never a null', () => {
    const file = rosterFile();
    expect(op(file, 'lane-a', '--continuity', 'on', '--recorded-at', '1794000000').code).toBe(0);
    expect(entry(file, 'lane-a')['continuity']).toEqual({ recordedAt: 1794000000 });
    expect(op(file, 'lane-a', '--continuity', 'off', '--recorded-at', 'now')).toEqual({ code: 0, stdout: '' });
    expect(Object.hasOwn(entry(file, 'lane-a'), 'continuity')).toBe(false);
    expect(readFileSync(file, 'utf8')).not.toContain('null');
  });

  it('on over a standing record keeps its time; off then on writes the new one', () => {
    const file = rosterFile();
    op(file, 'lane-a', '--continuity', 'on', '--recorded-at', '1794000000');
    expect(op(file, 'lane-a', '--continuity', 'on', '--recorded-at', '1794999999').code).toBe(0);
    expect(entry(file, 'lane-a')['continuity']).toEqual({ recordedAt: 1794000000 });
    op(file, 'lane-a', '--continuity', 'off', '--recorded-at', '1794999999');
    op(file, 'lane-a', '--continuity', 'on', '--recorded-at', '1794999999');
    expect(entry(file, 'lane-a')['continuity']).toEqual({ recordedAt: 1794999999 });
  });

  it('now stamps this process clock in whole seconds', () => {
    const file = rosterFile();
    const before = Math.floor(Date.now() / 1000);
    op(file, 'lane-a', '--continuity', 'on', '--recorded-at', 'now');
    const at = (entry(file, 'lane-a')['continuity'] as { recordedAt: number }).recordedAt;
    expect(Number.isInteger(at)).toBe(true);
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(before + 60);
  });

  it('a second identical call changes no byte and prints nothing', () => {
    const file = rosterFile();
    expect(op(file, 'lane-a', '--fable-billing', 'included', '--continuity', 'on', '--recorded-at', '1794000000').code).toBe(0);
    const bytes = readFileSync(file, 'utf8');
    utimesSync(file, 1_700_000_000, 1_700_000_000);
    const mtime = statSync(file).mtimeMs;
    expect(op(file, 'lane-a', '--fable-billing', 'included', '--continuity', 'on', '--recorded-at', '1795000000')).toEqual({ code: 0, stdout: '' });
    expect(readFileSync(file, 'utf8')).toBe(bytes);
    expect(statSync(file).mtimeMs).toBe(mtime);
  });

  it('a value off its vocabulary, a bad time and an unknown id write nothing', () => {
    const file = rosterFile();
    const before = readFileSync(file, 'utf8');
    for (const flags of [['--fable-billing', 'free'], ['--continuity', 'maybe'], ['--continuity', 'on', '--recorded-at', '-3'],
      ['--continuity', 'on', '--recorded-at', 'soon'], ['--continuity', 'on', '--recorded-at', '1.5']]) {
      const bad = op(file, 'lane-a', ...flags);
      expect(bad.code, flags.join(' ')).toBe(2);
      expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, error: 'bad-argv' });
    }
    const unknown = op(file, 'lane-z', '--continuity', 'on', '--recorded-at', 'now');
    expect(unknown.code).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false, error: 'unknown-id' });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

// The organization label (plan 2026-11-16-account-organization.md Task A3): `--org <label>` writes it, `--org none`
// removes the key, and an id-shaped or off-shape value is refused before any write.
describe('set-facts writes the organization label (account organization A3)', () => {
  it('--org writes the label silently, and none removes the key, never a null', () => {
    const file = rosterFile();
    expect(op(file, 'lane-a', '--org', 'org-a')).toEqual({ code: 0, stdout: '' });
    expect(entry(file, 'lane-a')['org']).toBe('org-a');
    expect(entry(file, 'lane-b')).toEqual(ROSTER.accounts[1]);
    expect(op(file, 'lane-a', '--org', 'org-b').code).toBe(0);
    expect(entry(file, 'lane-a')['org']).toBe('org-b');
    expect(op(file, 'lane-a', '--org', 'none')).toEqual({ code: 0, stdout: '' });
    expect(Object.hasOwn(entry(file, 'lane-a'), 'org')).toBe(false);
    expect(readFileSync(file, 'utf8')).not.toContain('null');
  });

  it('--org none on an unlabelled lane changes no byte', () => {
    const file = rosterFile();
    const bytes = readFileSync(file, 'utf8');
    expect(op(file, 'lane-a', '--org', 'none')).toEqual({ code: 0, stdout: '' });
    expect(readFileSync(file, 'utf8')).toBe(bytes);
  });

  it('an id-shaped value is refused org-looks-like-an-id before any write', () => {
    const file = rosterFile();
    const before = readFileSync(file, 'utf8');
    for (const v of ['0f8e2c1a-1b2c-4d3e-8f90-123456789abc', 'abcdef0123456789abcdef0123456789']) {
      const bad = op(file, 'lane-a', '--org', v);
      expect(bad.code, v).toBe(2);
      expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, error: 'org-looks-like-an-id' });
    }
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('an off-shape value is refused bad-argv before any write', () => {
    const file = rosterFile();
    const before = readFileSync(file, 'utf8');
    for (const v of ['Org-A', 'org a', `o${'x'.repeat(32)}`]) {
      const bad = op(file, 'lane-a', '--org', v);
      expect(bad.code, v).toBe(2);
      expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, error: 'bad-argv' });
    }
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});

// `org-check` (account organization B1, PR A's review F2): the label's gate alone, which the verb asks read-only before
// its first write. It shares `set-facts`' gate, so both refuse alike, and both say nothing was written.
describe('org-check: the label gate, read-only (account organization B1)', () => {
  const check = (...flags: string[]): { code: number | null; stdout: string } => {
    const r = spawnSync(process.execPath, [OP, 'org-check', ...flags], { encoding: 'utf8' });
    return { code: r.status, stdout: r.stdout };
  };

  it('admits a label and the clear word, silently', () => {
    expect(check('--org', 'org-a')).toEqual({ code: 0, stdout: '' });
    expect(check('--org', 'none')).toEqual({ code: 0, stdout: '' });
  });

  it('refuses an id shape and an off-shape name as set-facts does, saying nothing was written', () => {
    const file = rosterFile();
    for (const [v, word] of [['0f8e2c1a-1b2c-4d3e-8f90-123456789abc', 'org-looks-like-an-id'],
      ['abcdef0123456789abcdef0123456789', 'org-looks-like-an-id'], ['Org-A', 'bad-argv'], ['none-of-it x', 'bad-argv']] as const) {
      const alone = check('--org', v);
      expect(alone.code, v).toBe(2);
      const said = JSON.parse(alone.stdout) as { error: string; detail: string };
      expect(said.error, v).toBe(word);
      expect(said.detail, v).toMatch(/Nothing was written\.$/);
      expect(JSON.parse(op(file, 'lane-a', '--org', v).stdout), v).toEqual(said);
    }
  });

  it('takes no key but --org', () => {
    expect(check('--file', '/nonexistent', '--org', 'org-a').code).toBe(2);
  });
});
