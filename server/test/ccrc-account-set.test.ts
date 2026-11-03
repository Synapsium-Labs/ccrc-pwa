// `ccrc account set` (accounts plan Task A16; spec §6.3, §8.4, §13.3; G5; D-7735): the stated account of a token
// lane, on stdin only, into the lane state; and a lane's placement, into the roster and its projection. The fixture
// is `laneStateFixture.ts`; every launcher is a stub.
import { describe, it, expect, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HAVE_FLOCK, NODE_ID, addLane, answer, ccrcRun, laneBox, laneState,
} from './laneStateFixture.js';

beforeEach((ctx) => { if (!HAVE_FLOCK) ctx.skip(); });

const homeAbleOf = (home: string, id: string): unknown =>
  (JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: { id: string; homeAble: unknown }[] })
    .accounts.find((a) => a.id === id)?.homeAble;
const projection = (home: string): string => readFileSync(join(home, '.ccrc', 'accounts.sh'), 'utf8');

describe('set --stated (spec §6.3)', () => {
  it('`--stated` takes stdin only and refuses a control byte', () => {
    const home = laneBox('ccrc-set-stated-');
    const ok = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--stated', '-'], 'someone@example.invalid\n');
    expect(ok.code, ok.stderr).toBe(0);
    expect(laneState(home, 'lane-b')).toMatchObject({ identity: 'someone@example.invalid', identitySource: 'stated' });
    const a = answer(ok);
    expect(a).toMatchObject({ ok: true, id: 'lane-b', fleetIdentity: NODE_ID });
    expect(a).toHaveProperty('roster');

    // The agent's spelling, one argv word.
    const eq = ccrcRun(home, ['account', 'set', '--id=lane-b', '--stated=-'], 'other@example.invalid');
    expect(eq.code, eq.stderr).toBe(0);
    expect(laneState(home, 'lane-b')).toMatchObject({ identity: 'other@example.invalid', identitySource: 'stated' });

    // Never on an argv: a value there is world-readable for as long as the process lives.
    const argv = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--stated=someone@example.invalid']);
    expect(argv.code).toBe(2);
    expect(answer(argv)['error']).toBe('stated-not-stdin');
    const two = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--stated', 'someone@example.invalid']);
    expect(two.code).toBe(2);
    expect(answer(two)['error']).toBe('stated-not-stdin');

    for (const bad of ['some\tone@example.invalid', 'a\nb', 'x\u0000y', 'x\u007f', '', '   ']) {
      const r = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--stated', '-'], bad);
      expect(r.code, `${JSON.stringify(bad)}: ${r.stderr}`).toBe(2);
      expect(answer(r)['error'], JSON.stringify(bad)).toBe('bad-stated');
      expect(laneState(home, 'lane-b')!['identity'], JSON.stringify(bad)).toBe('other@example.invalid');
    }
    const long = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--stated', '-'], 'x'.repeat(121));
    expect(long.code).not.toBe(0);
    expect(laneState(home, 'lane-b')!['identity']).toBe('other@example.invalid');
  });

  it('a sign-in lane refuses a stated account: `check` measures it', () => {
    const home = laneBox('ccrc-set-signin-');
    const add = ccrcRun(home, ['account', 'add', '--id', 'lane-s', '--provider', 'anthropic', '--method', 'login',
      '--label', 'lane·s', '--hue', 'green']);
    expect(add.code, add.stderr).toBe(0);
    const r = ccrcRun(home, ['account', 'set', '--id', 'lane-s', '--stated', '-'], 'someone@example.invalid\n');
    expect(r.code).toBe(1);
    expect(answer(r)['error']).toBe('not-a-token-lane');
    expect(laneState(home, 'lane-s')).not.toHaveProperty('identity');
  });
});

describe('set --placement (spec §8.4)', () => {
  it('`--placement full` sets `homeAble:true`, and `overflow` takes it out of placement', () => {
    const home = laneBox('ccrc-set-placement-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    expect(homeAbleOf(home, 'lane-c')).toBe(true);

    const over = ccrcRun(home, ['account', 'set', '--id', 'lane-c', '--placement', 'overflow']);
    expect(over.code, over.stderr).toBe(0);
    expect(homeAbleOf(home, 'lane-c')).toBe(false);
    expect(projection(home)).not.toMatch(/CCRC_HOME_ABLE=\([^)]*\blane-c\b/);
    const answered = (answer(over)['roster'] as { accounts: { id: string; homeAble: boolean }[] }).accounts;
    expect(answered.find((a) => a.id === 'lane-c')?.homeAble).toBe(false);

    const full = ccrcRun(home, ['account', 'set', '--id=lane-c', '--placement=full']);
    expect(full.code, full.stderr).toBe(0);
    expect(homeAbleOf(home, 'lane-c')).toBe(true);
    expect(projection(home)).toMatch(/CCRC_HOME_ABLE=\([^)]*\blane-c\b/);
  });

  it('refuses `last-home-able` for the only lane fresh sessions can be placed on', () => {
    const home = laneBox('ccrc-set-last-');
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    const r = ccrcRun(home, ['account', 'set', '--id', 'claude', '--placement', 'overflow']);
    expect(r.code, r.stderr).toBe(1);
    expect(answer(r)['error']).toBe('last-home-able');
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
  });

  it('refuses a value off the enum, and a set with nothing to set', () => {
    const home = laneBox('ccrc-set-bad-');
    for (const args of [['--placement', 'everywhere'], ['--placement=sometimes'], []]) {
      const r = ccrcRun(home, ['account', 'set', '--id', 'lane-b', ...args]);
      expect(r.code, args.join(' ')).toBe(2);
    }
  });
});
