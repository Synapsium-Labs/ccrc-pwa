// `account-op.mjs set-placement` (accounts plan Task A16, D-7735), the one writer of a lane's `homeAble`, which the
// Accounts card's "Start new sessions here" switch reaches through `ccrc account set --placement` (D-8195). The op
// itself, with no `ccrc` around it (its lock and `last-home-able` are `ccrc-account-set.test.ts`'s, behind flock):
// `full` and `overflow` write the field and nothing else, a no-op leaves the file's bytes alone, and a value off the
// enum or an id the roster does not hold writes nothing.
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
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
  const file = path.join(mkTmp('account-op-placement-'), 'accounts.json');
  writeFileSync(file, `${JSON.stringify(ROSTER, null, 2)}\n`, { mode: 0o600 });
  return file;
};
const op = (file: string, id: string, placement: string): { code: number | null; stdout: string } => {
  const r = spawnSync(process.execPath, [OP, 'set-placement', '--file', file, '--id', id, '--placement', placement], { encoding: 'utf8' });
  return { code: r.status, stdout: r.stdout };
};
const homeAble = (file: string): Record<string, unknown> => Object.fromEntries(
  (JSON.parse(readFileSync(file, 'utf8')) as typeof ROSTER).accounts.map((a) => [a.id, a.homeAble]));

describe('set-placement writes homeAble and nothing else (D-8195)', () => {
  it('overflow takes the lane out of new sessions, full puts it back, silently', () => {
    const file = rosterFile();
    const over = op(file, 'lane-b', 'overflow');
    expect(over).toEqual({ code: 0, stdout: '' });
    expect(homeAble(file)).toEqual({ 'lane-a': true, 'lane-b': false });
    const rest = JSON.parse(readFileSync(file, 'utf8')) as typeof ROSTER;
    expect({ ...rest.accounts[1], homeAble: true }).toEqual(ROSTER.accounts[1]);
    expect(op(file, 'lane-b', 'full')).toEqual({ code: 0, stdout: '' });
    expect(homeAble(file)).toEqual({ 'lane-a': true, 'lane-b': true });
  });

  it('a lane already placed so is a no-op that leaves the bytes alone', () => {
    const file = rosterFile();
    const before = readFileSync(file, 'utf8');
    expect(op(file, 'lane-a', 'full').code).toBe(0);
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('a value off the enum and an unknown id are refused, and nothing is written', () => {
    const file = rosterFile();
    const before = readFileSync(file, 'utf8');
    const bad = op(file, 'lane-b', 'sometimes');
    expect(bad.code).toBe(2);
    expect(JSON.parse(bad.stdout)).toMatchObject({ ok: false, error: 'bad-argv' });
    const unknown = op(file, 'lane-z', 'overflow');
    expect(unknown.code).toBe(1);
    expect(JSON.parse(unknown.stdout)).toMatchObject({ ok: false, error: 'unknown-id' });
    expect(readFileSync(file, 'utf8')).toBe(before);
  });
});
