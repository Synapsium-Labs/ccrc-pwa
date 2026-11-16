// `ccrc account set` (accounts plan Task A16; spec §6.3, §8.4, §13.3; G5; D-7735): the stated account of a token
// lane, on stdin only, into the lane state; and a lane's placement, into the roster and its projection. The fixture
// is `laneStateFixture.ts`; every launcher is a stub.
import { describe, it, expect, beforeEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  HAVE_FLOCK, NODE_ID, addLane, answer, ccrcRun, laneBox, laneState, shadowAccountOp,
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

// The two serviceability facts (plan 2026-11-14 Task 3, F11/F12): `--fable-billing` and `--continuity`, into the
// roster through `set-facts`, and the projection regenerated, which answers them to ccd.
describe('set --fable-billing and --continuity (H16)', () => {
  const entryOf = (home: string, id: string): Record<string, unknown> | undefined =>
    (JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: Record<string, unknown>[] })
      .accounts.find((a) => a['id'] === id);
  const asked = (home: string, fn: string, id: string): string =>
    spawnSync('bash', ['-c', `source "${join(home, '.ccrc', 'accounts.sh')}"; ${fn} ${id}`], { encoding: 'utf8' }).stdout.trim();

  it('each flag alone is accepted, in both spellings, and the projection answers the value', () => {
    const home = laneBox('ccrc-set-facts-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const bill = ccrcRun(home, ['account', 'set', '--id', 'lane-c', '--fable-billing', 'credits']);
    expect(bill.code, bill.stderr).toBe(0);
    expect(entryOf(home, 'lane-c')?.['fableBilling']).toBe('credits');
    expect(asked(home, '_ccrc_fable_billing', 'lane-c')).toBe('credits');
    const on = ccrcRun(home, ['account', 'set', '--id=lane-c', '--continuity=on']);
    expect(on.code, on.stderr).toBe(0);
    const at = (entryOf(home, 'lane-c')?.['continuity'] as { recordedAt: number }).recordedAt;
    expect(at).toBeGreaterThan(1_700_000_000);
    expect(asked(home, '_ccrc_continuity', 'lane-c')).toBe(String(at));
    const answered = (answer(on)['roster'] as { accounts: { id: string; fableBilling?: string; continuity?: unknown }[] }).accounts;
    expect(answered.find((a) => a.id === 'lane-c')).toMatchObject({ fableBilling: 'credits', continuity: { recordedAt: at } });
    // A second identical set changes no byte of the roster.
    const bytes = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    expect(ccrcRun(home, ['account', 'set', '--id=lane-c', '--continuity=on', '--fable-billing=credits']).code).toBe(0);
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(bytes);
    const off = ccrcRun(home, ['account', 'set', '--id', 'lane-c', '--continuity', 'off']);
    expect(off.code, off.stderr).toBe(0);
    expect(entryOf(home, 'lane-c')).not.toHaveProperty('continuity');
    expect(asked(home, '_ccrc_continuity', 'lane-c')).toBe('');
  });

  it('refuses a word off the vocabulary with the words it takes, and writes nothing', () => {
    const home = laneBox('ccrc-set-facts-bad-');
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    for (const [args, words] of [[['--fable-billing', 'free'], 'included or credits'], [['--fable-billing=free'], 'included or credits'],
      [['--continuity', 'maybe'], 'on or off'], [['--continuity=maybe'], 'on or off']] as const) {
      const r = ccrcRun(home, ['account', 'set', '--id', 'lane-b', ...args]);
      expect(r.code, args.join(' ')).toBe(2);
      expect(answer(r)['error']).toBe('bad-value');
      expect(JSON.stringify(answer(r))).toContain(words);
    }
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
  });

  it('a refused set-facts after a placement says the placement change stands (F5)', () => {
    const home = laneBox('ccrc-set-facts-after-placement-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    shadowAccountOp(home, 'set-facts');   // the facts op is the one that cannot run; set-placement still does
    const r = ccrcRun(home, ['account', 'set', '--id', 'lane-c', '--placement', 'overflow', '--continuity', 'on']);
    expect(r.code, r.stderr).not.toBe(0);
    expect(homeAbleOf(home, 'lane-c')).toBe(false);   // the placement change stands
    const said = JSON.stringify(answer(r));
    expect(said).toContain('The placement was recorded. Nothing else was written.');
    expect(said).not.toMatch(/(?<!recorded\. )Nothing else was written/);
  });

  it('--method beside either is bad-argument; a lone --id is missing-value with the new sentence; an unknown flag is still refused', () => {
    const home = laneBox('ccrc-set-facts-args-');
    for (const flag of [['--fable-billing', 'credits'], ['--continuity', 'on']]) {
      const r = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--method', 'login', '--attempt', 'a'.repeat(32), ...flag]);
      expect(r.code, flag.join(' ')).toBe(2);
      expect(answer(r)['error']).toBe('bad-argument');
      expect(JSON.stringify(answer(r))).toContain(flag[0]);
    }
    const lone = ccrcRun(home, ['account', 'set', '--id', 'lane-b']);
    expect(lone.code).toBe(2);
    expect(answer(lone)['error']).toBe('missing-value');
    expect(JSON.stringify(answer(lone))).toContain('ccrc account set needs --stated -, --placement overflow|full, --fable-billing included|credits, --continuity on|off or --org <label>|none. Nothing was written.');
    const unknown = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--bogus']);
    expect(unknown.code).toBe(2);
    expect(answer(unknown)['error']).toBe('unknown-argument');
    expect(JSON.stringify(answer(unknown))).toContain('--fable-billing included|credits');
    expect(JSON.stringify(answer(unknown))).toContain('--continuity on|off');
  });
});

// The organization label (plan 2026-11-16-account-organization.md Task A3): `--org <label>|none`, passed through to
// `set-facts`, which owns its shape and refuses an id-shaped value `org-looks-like-an-id`.
describe('set --org (account organization A3)', () => {
  const entryOf = (home: string, id: string): Record<string, unknown> | undefined =>
    (JSON.parse(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')) as { accounts: Record<string, unknown>[] })
      .accounts.find((a) => a['id'] === id);

  it('writes the label in both spellings, the projection answers it, and none clears it', () => {
    const home = laneBox('ccrc-set-org-');
    expect(addLane(home, 'lane-c').code).toBe(0);
    const set = ccrcRun(home, ['account', 'set', '--id', 'lane-c', '--org', 'org-a']);
    expect(set.code, set.stderr).toBe(0);
    expect(entryOf(home, 'lane-c')?.['org']).toBe('org-a');
    expect(projection(home)).toMatch(/^ {4}lane-c\) echo org-a ;;$/m);
    const answered = (answer(set)['roster'] as { accounts: { id: string; org?: string }[] }).accounts;
    expect(answered.find((a) => a.id === 'lane-c')).toMatchObject({ org: 'org-a' });
    expect(ccrcRun(home, ['account', 'set', '--id=lane-c', '--org=org-b']).code).toBe(0);
    expect(entryOf(home, 'lane-c')?.['org']).toBe('org-b');
    const cleared = ccrcRun(home, ['account', 'set', '--id', 'lane-c', '--org', 'none']);
    expect(cleared.code, cleared.stderr).toBe(0);
    expect(entryOf(home, 'lane-c')).not.toHaveProperty('org');
    expect(projection(home)).not.toMatch(/echo org-b/);
  });

  it('an id-shaped label is refused org-looks-like-an-id, an off-shape one bad-argv, and nothing is written', () => {
    const home = laneBox('ccrc-set-org-bad-');
    const before = readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8');
    for (const [v, word] of [['abcdef0123456789abcdef0123456789', 'org-looks-like-an-id'], ['Org-A', 'bad-argv']] as const) {
      const r = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--org', v]);
      expect(r.code, v).toBe(2);
      expect(answer(r)['error'], v).toBe(word);
    }
    const empty = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--org']);
    expect(answer(empty)['error']).toBe('missing-value');
    expect(readFileSync(join(home, '.ccrc', 'accounts.json'), 'utf8')).toBe(before);
  });

  it('--method beside --org is bad-argument', () => {
    const home = laneBox('ccrc-set-org-method-');
    const r = ccrcRun(home, ['account', 'set', '--id', 'lane-b', '--method', 'login', '--attempt', 'a'.repeat(32), '--org', 'org-a']);
    expect(answer(r)['error']).toBe('bad-argument');
    expect(JSON.stringify(answer(r))).toContain('--org');
  });
});
