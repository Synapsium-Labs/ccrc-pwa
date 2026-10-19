// One act per lane (accounts plan Task A11; spec §3.9, G18; D-5518): every mutating `ccrc account` verb takes
// `flock -n` on `~/.ccrc/locks/<id>.lock` and refuses `lane-busy`, and the box-wide placement lock
// (`_acct_marker_lock`) is always taken AFTER it. The fixture is `laneStateFixture.ts`.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BASH, CANARY, HAVE_FLOCK, addLane, answer, boxEnv, ccrcIn, laneBox, modeOf,
} from './laneStateFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const ADD = (id: string): string =>
  `"$1" account add --id ${id} --provider compatible --label ${id}·x --hue amber `
  + '--base-url https://orchard-api/v1 --credential -';

describe('one act per lane (G18)', () => {
  it('two concurrent adds on one id: one gets `lane-busy`', () => {
    const home = laneBox('ccrc-lane-lock-race-');
    // The first add to reach the lock holds it for three seconds inside its installers; the second starts with it.
    writeFileSync(join(home, 'slow-installer'), '');
    const script = `printf '%s\\n' '${CANARY}' | ${ADD('lane-c')} >"$HOME/a.out" 2>"$HOME/a.err" & p1=$!\n`
      + `printf '%s\\n' '${CANARY}' | ${ADD('lane-c')} >"$HOME/b.out" 2>"$HOME/b.err" & p2=$!\n`
      + 'wait "$p1"; printf %s "$?" > "$HOME/a.status"; wait "$p2"; printf %s "$?" > "$HOME/b.status"\n';
    const pair = spawnSync(BASH, ['-c', `umask 022; ${script}`, '_', ccrcIn(home)],
      { env: boxEnv(home), encoding: 'utf8', timeout: 120_000 });
    expect(pair.error).toBeUndefined();
    const outs = ['a', 'b'].map((k) => ({
      status: readFileSync(join(home, `${k}.status`), 'utf8'),
      body: JSON.parse(readFileSync(join(home, `${k}.out`), 'utf8')) as Record<string, unknown>,
    }));
    const busy = outs.filter((o) => o.body['error'] === 'lane-busy');
    const ok = outs.filter((o) => o.body['ok'] === true);
    expect(busy, JSON.stringify(outs)).toHaveLength(1);
    expect(ok, JSON.stringify(outs)).toHaveLength(1);
    expect(busy[0]!.status).toBe('1');
    expect(modeOf(join(home, '.ccrc', 'locks'))).toBe('700');
  });

  it('a lane held by one verb refuses another verb on it, and leaves other lanes alone', () => {
    const home = laneBox('ccrc-lane-lock-held-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const hold = `exec 9>>"$HOME/.ccrc/locks/lane-c.lock"; flock -n 9 || exit 3; `
      + `"$1" account enable --id lane-c >"$HOME/c.out"; "$1" account disable --id lane-b >"$HOME/b.out"`;
    const r = spawnSync(BASH, ['-c', hold, '_', ccrcIn(home)], { env: boxEnv(home), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(home, 'c.out'), 'utf8'))).toMatchObject({ ok: false, error: 'lane-busy' });
    expect(JSON.parse(readFileSync(join(home, 'b.out'), 'utf8'))).toMatchObject({ ok: true });
    // `add` leaves a lane switched off; the refused `enable` changed nothing.
    expect(existsSync(join(home, '.cc-sessions', 'lane-c-disabled'))).toBe(true);
  });
});

describe('the lock order (spec §3.9)', () => {
  it('the lane lock is always taken before the marker lock', () => {
    const home = laneBox('ccrc-lane-lock-order-');
    const realFlock = spawnSync(BASH, ['-c', 'command -v flock'], { encoding: 'utf8' }).stdout.trim();
    const env = boxEnv(home);
    // A stub flock FIRST on PATH: it records each call's argv, then hands it to the real one.
    writeFileSync(join(home, '.local', 'bin', 'flock'),
      `#!/bin/sh\nprintf '%s\\n' "$*" >> "$HOME/flock-calls"\nexec ${JSON.stringify(realFlock)} "$@"\n`,
      { mode: 0o755 });
    const calls = (): string[] => {
      const p = join(home, 'flock-calls');
      const out = existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n') : [];
      writeFileSync(p, '');
      return out;
    };
    const run = (args: string[], stdin = ''): void => {
      const r = spawnSync(BASH, [ccrcIn(home), ...args], { env, encoding: 'utf8', input: stdin });
      expect(r.status, `${args.join(' ')}: ${r.stdout}${r.stderr}`).toBe(0);
    };
    // The lane lock is the non-blocking one (`-n`); the placement lock waits.
    const expectOrder = (verb: string): void => {
      const c = calls();
      expect(c, `${verb}: ${c.join(' | ')}`).toHaveLength(2);
      expect(c[0], `${verb}: the first lock taken`).toMatch(/^-n \d+$/);
      expect(c[1], `${verb}: the second lock taken`).toMatch(/^\d+$/);
    };
    run(['account', 'add', '--id', 'lane-c', '--provider', 'compatible', '--label', 'lane-c·x', '--hue', 'amber',
      '--base-url', 'https://orchard-api/v1', '--credential', '-'], `${CANARY}\n`);
    expectOrder('add');
    run(['account', 'disable', '--id', 'lane-c']);
    expectOrder('disable');
    run(['account', 'enable', '--id', 'lane-c']);
    expectOrder('enable');
  });

  it('asking for a lane lock while the placement lock is held is refused as a bug', () => {
    const home = laneBox('ccrc-lane-lock-guard-');
    const r = spawnSync(BASH, ['-c', `. "$1"; _acct_marker_lock "Nothing was written."; _acct_lane_lock lane-b "Nothing was written."`,
      '_', ccrcIn(home)], { env: boxEnv(home), encoding: 'utf8' });
    expect(r.status).toBe(1);
    expect(answer({ code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr })['error']).toBe('lock-order');
  });
});

