// A verb that dies halfway (accounts plan Task A11; spec §3.9, G18; D-5518, D-5755). The agent ends a sub that outlives
// its bound with SIGTERM to the process group, then SIGKILL (D-5621). A TERM runs the verb's trap, which removes the
// temps it staged; a KILL runs nothing, so `add`, `credential` and `remove` sweep the secret temps an earlier killed run
// left for their lane. Each case pauses `add` exactly between the secret temp's create and its rename, with a stub `mv`
// first on PATH that waits on a release file, and signals the whole group there.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASH, CANARY, HAVE_FLOCK, addLane, ccrcSpawn, exited, laneBox, secretTemps, waitFor,
} from './laneStateFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const ADD = ['account', 'add', '--id', 'lane-c', '--provider', 'compatible', '--label', 'lane-c·x', '--hue', 'amber',
  '--base-url', 'https://orchard-api/v1', '--credential', '-'];

/** A `mv` that stops on the rename of a secret temp until the case releases it, and is the real `mv` otherwise. */
function plantPausingMv(home: string): void {
  const real = spawnSync(BASH, ['-c', 'command -v mv'], { encoding: 'utf8' }).stdout.trim();
  writeFileSync(join(home, '.local', 'bin', 'mv'), [
    '#!/bin/sh',
    'case "$*" in',
    '  *"/.cc-secrets/."*".env.tmp."*)',
    '    : > "$HOME/mv-paused"',
    '    while [ ! -e "$HOME/mv-release" ]; do sleep 0.05; done ;;',
    'esac',
    `exec ${JSON.stringify(real)} "$@"`,
  ].join('\n') + '\n', { mode: 0o755 });
}

/** `add`, paused with its secret temp on disk; resolves once the temp exists. */
async function pausedAdd(home: string): Promise<ReturnType<typeof ccrcSpawn>> {
  plantPausingMv(home);
  const c = ccrcSpawn(home, ADD, `${CANARY}\n`);
  await waitFor(join(home, 'mv-paused'));
  expect(secretTemps(home, 'lane-c'), 'the pause is between the temp create and the rename').toHaveLength(1);
  return c;
}

describe('a killed verb leaves no secret temp (G18)', () => {
  it('a TERM mid-write removes the verb\'s own temp file', async () => {
    const home = laneBox('ccrc-lane-kill-term-');
    const c = await pausedAdd(home);
    const done = exited(c);
    process.kill(-c.pid!, 'SIGTERM');
    expect(await done).toBe(143);
    expect(secretTemps(home, 'lane-c')).toEqual([]);
  });

  it('killing `add` between the temp create and the rename leaves no secret temp file after the next verb', async () => {
    const home = laneBox('ccrc-lane-kill-9-');
    const c = await pausedAdd(home);
    const done = exited(c);
    process.kill(-c.pid!, 'SIGKILL');
    await done;
    const left = secretTemps(home, 'lane-c');
    expect(left, 'a KILL runs no trap, so the temp is still there').toHaveLength(1);
    expect(readFileSync(join(home, '.cc-secrets', left[0]!), 'utf8')).toContain(CANARY);

    rmSync(join(home, '.local', 'bin', 'mv'));
    const retry = addLane(home, 'lane-c');
    expect(retry.code, retry.stderr).toBe(0);
    expect(secretTemps(home, 'lane-c')).toEqual([]);
  });

  it('the sweep is exact: a neighbouring lane\'s temp, whose name shares the prefix, is left alone', async () => {
    const home = laneBox('ccrc-lane-kill-exact-');
    const c = await pausedAdd(home);
    const done = exited(c);
    process.kill(-c.pid!, 'SIGKILL');
    await done;
    // `lane-c-x`'s own temp: `.lane-c-x-compatible.env.tmp.<pid>` matches the spec's `.lane-c-*.tmp.*` glob.
    writeFileSync(join(home, '.cc-secrets', '.lane-c-x-compatible.env.tmp.4242'), 'x', { mode: 0o600 });
    rmSync(join(home, '.local', 'bin', 'mv'));
    expect(addLane(home, 'lane-c').code).toBe(0);
    expect(secretTemps(home, 'lane-c')).toEqual(['.lane-c-x-compatible.env.tmp.4242']);
  });
});
