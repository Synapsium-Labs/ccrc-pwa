// Overlord W1, designation A, plan Task 4: the body adapter over ccd (`coord/overlordBody.ts`). Two halves. A FAKE runner pins every
// argv against the agent's whitelist, the capability gates, the `created` answers, the failed listing and the stop. FIXTURE-HOME
// cases (`makeCcdHarness`, never the live HOME) run the real `cmd_route` and `cmd_keep_awake` on argv the adapter composed:
// the clear, the session shell's refusal (`pool-set-operator-only`) and the runner's strip of `CLAUDECODE`.
import { describe, it, expect, afterEach } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { isExecAllowed } from '../../agent/src/whitelist.js';
import { CCD_ARGV, type CcdArgv } from '../src/ccdargv.js';
import { ccdOverlordBody, stopCreatedOf, withoutClaudeCode, type OverlordBodyDeps } from '../src/coord/overlordBody.js';
import type { CcdResult, RunCcd } from '../src/coord/ports.js';
import type { SessionRecord, SingleRead } from '../src/registry.js';
import { makeCcdHarness, CCD, type CcdHarness } from './ccdWsHelpers.js';

const ID = 'overlord-a1b2c3d4';
const SLUG = 'a1b2c3d4';
const GEN = '11111111-2222-4333-8444-555555555555';
const DIGEST = 'deadbeefdeadbeef';
const ROUTE = { class: 'opus', profile: 'overlord', profiledigest: DIGEST } as const;
/** The words the adapter asks of a deployed ccd: its five rows' tokens. */
const WORDS = ['project-add', 'route-v1', 'pool-set', 'keep-awake-v1', 'ws-title-v1', 'ws-wrapper-v1'];

const ok = (stdout = ''): CcdResult => ({ ran: true, ok: true, stdout, stderr: '', killed: false, signal: null, exitCode: 0 });
const refused = (stderr: string, exitCode = 1, stdout = ''): CcdResult => ({ ran: true, ok: false, stdout, stderr, killed: false, signal: null, exitCode });
const lost = (reason: 'transport' | 'timeout' | 'spawn' = 'timeout'): CcdResult =>
  ({ ran: false, ok: false, stdout: '', stderr: '', killed: 'unmeasured', signal: 'unmeasured', reason, detail: `the ${reason} arm` });
const cutShort = (): CcdResult => ({ ran: true, ok: false, stdout: '', stderr: '', killed: false, signal: 'SIGKILL', exitCode: 137 });

interface Fake { readonly run: RunCcd; readonly calls: string[][] }
/** A runner that answers each call from `answer` and records the argv. */
function fake(answer: (argv: readonly string[]) => CcdResult | Error): Fake {
  const calls: string[][] = [];
  const run: RunCcd = async (argv) => {
    calls.push([...argv]);
    const a = answer(argv);
    if (a instanceof Error) throw a;
    return a;
  };
  return { run, calls };
}

function bodyOf(f: Fake, over: Partial<OverlordBodyDeps> = {}) {
  return ccdOverlordBody({
    runCcd: f.run, fleetState: () => ({ ccdVerbs: WORDS }),
    projects: async () => ['demo'], rowOf: async () => ({ kind: 'absent' }),
    generationOf: async () => ({ kind: 'value', v: GEN }), stop: async () => ({ ok: true, absent: false }),
    env: {}, ...over,
  });
}

const allowed = (argv: readonly string[]): boolean => isExecAllowed('ccd', [...argv]);

describe('every argv the adapter composes is on the agent whitelist', () => {
  it('the project add, the create, the route writes, the probe and the markers', async () => {
    const f = fake((argv) => (argv[0] === 'pool-answer' ? ok('') : ok(argv[0] === 'keep-awake' ? `awake ${ID}` : '')));
    const body = bodyOf(f, { projects: async () => [] });
    await body.ensureProject();
    await body.create(SLUG, ID, 'lane-a', ROUTE, { surface: 'pwa', actor: 'unmeasured', reason: null });
    await body.writeSet(ID, { poolset: 'pool-a,pool-b+untagged', acctorder: 'acct-a,acct-b' });
    await body.writeSet(ID, { poolset: '', acctorder: '' });
    await body.clearProfile(ID);
    await body.poolAnswer(ID);
    await body.keepAwake(ID, 'on');
    await body.keepAwake(ID, 'off');
    expect(f.calls.map((c) => c[0])).toEqual(['project-add', 'ws-add', 'route', 'route', 'route', 'pool-answer', 'keep-awake', 'keep-awake']);
    for (const argv of f.calls) expect(allowed(argv), `ccd ${argv.join(' ')}`).toBe(true);
  });
});

describe('create', () => {
  it('carries class, profile and profiledigest on --route, never poolset or acctorder, behind --title and --wrapper', async () => {
    const f = fake(() => ok());
    // A route that wrongly carries the set fields: ccd refuses them on `--route`, so the adapter drops them.
    const wide = { ...ROUTE, poolset: 'pool-a', acctorder: 'acct-a' };
    const r = await bodyOf(f).create(SLUG, ID, 'lane-a', wide, null);
    expect(r).toEqual({ ok: true, generation: GEN });
    expect(f.calls[0]).toEqual(['ws-add', '--title', 'Overlord', '--wrapper', 'lane-a',
      '--route', 'class=opus', '--route', 'profile=overlord', '--route', `profiledigest=${DIGEST}`, 'overlord', SLUG]);
    expect(f.calls[0]!.join(' ')).not.toMatch(/poolset|acctorder/);
  });

  it('a ws-add that ccd refused made nothing', async () => {
    const f = fake(() => refused('ccd: slug in use: a1b2c3d4'));
    expect(await bodyOf(f).create(SLUG, ID, 'lane-a', ROUTE, null)).toMatchObject({ ok: false, created: 'no' });
  });

  it('a ws-add that never started made nothing', async () => {
    const f = fake(() => lost('spawn'));
    expect(await bodyOf(f).create(SLUG, ID, 'lane-a', ROUTE, null)).toMatchObject({ ok: false, created: 'no' });
  });

  it('a refusal that left a worktree behind may have made the session', async () => {
    const f = fake(() => refused('ccd: --wrapper refused — lane-a is busy; the account was named\nthe worktree and branch EXIST and no registry row names them'));
    expect(await bodyOf(f).create(SLUG, ID, 'lane-a', ROUTE, null)).toMatchObject({ ok: false, created: 'yes' });
  });

  it('a failed generation read after a made session answers created yes', async () => {
    const f = fake(() => ok());
    for (const kind of ['absent', 'unreadable'] as const) {
      const r = await bodyOf(f, { generationOf: async () => ({ kind }) }).create(SLUG, ID, 'lane-a', ROUTE, null);
      expect(r).toMatchObject({ ok: false, created: 'yes' });
    }
    const threw = await bodyOf(f, { generationOf: async () => { throw new Error('read broke'); } }).create(SLUG, ID, 'lane-a', ROUTE, null);
    expect(threw).toMatchObject({ ok: false, created: 'yes' });
  });

  it('a LOST answer is re-measured in the registry: a row is yes, a measured absence no, an unreadable registry unknown', async () => {
    const created = async (answer: CcdResult, rowOf: OverlordBodyDeps['rowOf']): Promise<unknown> =>
      (await bodyOf(fake(() => answer), { rowOf }).create(SLUG, ID, 'lane-a', ROUTE, null) as { created?: string }).created;
    for (const answer of [lost('timeout'), lost('transport'), cutShort()]) {
      expect(await created(answer, async () => ({ kind: 'found' })), 'a row').toBe('yes');
      expect(await created(answer, async () => ({ kind: 'absent' })), 'a measured absence').toBe('no');
      expect(await created(answer, async () => ({ kind: 'unlistable' })), 'an unlistable registry').toBe('unknown');
      expect(await created(answer, async () => ({ kind: 'unmeasurable' })), 'a row that cannot be assembled').toBe('unknown');
      expect(await created(answer, async () => { throw new Error('registry broke'); }), 'a throwing reader').toBe('unknown');
    }
  });

  it('a runner that rejects is a lost answer, never a throw', async () => {
    const f = fake(() => new Error('link dropped'));
    const r = await bodyOf(f, { rowOf: async () => ({ kind: 'found' }) }).create(SLUG, ID, 'lane-a', ROUTE, null);
    expect(r).toMatchObject({ ok: false, created: 'yes' });
  });

  it('a ccd without the title and wrapper words answers created no and runs nothing', async () => {
    for (const missing of ['ws-title-v1', 'ws-wrapper-v1']) {
      const f = fake(() => ok());
      const r = await bodyOf(f, { fleetState: () => ({ ccdVerbs: WORDS.filter((w) => w !== missing) }) }).create(SLUG, ID, 'lane-a', ROUTE, null);
      expect(r).toMatchObject({ ok: false, created: 'no' });
      expect(f.calls).toEqual([]);
    }
  });
});

describe('ensureProject', () => {
  it('a failed listing refuses and never runs project-add', async () => {
    for (const projects of [async () => null, async (): Promise<readonly string[]> => { throw new Error('walk broke'); }]) {
      const f = fake(() => ok());
      const r = await bodyOf(f, { projects }).ensureProject();
      expect(r.ok).toBe(false);
      expect(f.calls).toEqual([]);
    }
  });

  it('a listed project is not added again; an absent one is added with --empty', async () => {
    const present = fake(() => ok());
    expect(await bodyOf(present, { projects: async () => ['demo', 'overlord'] }).ensureProject()).toEqual({ ok: true });
    expect(present.calls).toEqual([]);
    const absent = fake(() => ok());
    let changed = 0;
    expect(await bodyOf(absent, { projects: async () => ['demo'], projectsChanged: () => { changed += 1; } }).ensureProject()).toEqual({ ok: true });
    expect(absent.calls).toEqual([['project-add', '--name', 'overlord', '--empty']]);
    expect(changed).toBe(1);
  });

  it('an "exists" answer is the project being there; a lost answer and another refusal are failures', async () => {
    const exists = fake(() => refused('ccd: project exists: overlord'));
    expect(await bodyOf(exists, { projects: async () => [] }).ensureProject()).toEqual({ ok: true });
    for (const answer of [lost('timeout'), refused('ccd: no disk')]) {
      const r = await bodyOf(fake(() => answer), { projects: async () => [] }).ensureProject();
      expect(r.ok).toBe(false);
    }
  });

  it('a ccd without project-add runs nothing', async () => {
    const f = fake(() => ok());
    const r = await bodyOf(f, { fleetState: () => ({ ccdVerbs: WORDS.filter((w) => w !== 'project-add') }) }).ensureProject();
    expect(r.ok).toBe(false);
    expect(f.calls).toEqual([]);
  });
});

describe('the route writes and the probe', () => {
  it('writeSet and clearProfile are one route --set each; an empty value clears', async () => {
    const f = fake(() => ok());
    const body = bodyOf(f);
    await body.writeSet(ID, { poolset: 'pool-a', acctorder: 'acct-a' });
    await body.writeSet(ID, { poolset: '', acctorder: '' });
    await body.clearProfile(ID);
    expect(f.calls).toEqual([
      ['route', '--session', ID, '--set', 'poolset=pool-a', '--set', 'acctorder=acct-a'],
      ['route', '--session', ID, '--set', 'poolset=', '--set', 'acctorder='],
      ['route', '--session', ID, '--set', 'profiledigest='],
    ]);
  });

  it('a missing word answers ok false and runs nothing: pool-set for the set, route-v1 for both, pool-set for the probe', async () => {
    const without = (w: string): OverlordBodyDeps['fleetState'] => () => ({ ccdVerbs: WORDS.filter((x) => x !== w) });
    const f = fake(() => ok());
    expect((await bodyOf(f, { fleetState: without('pool-set') }).writeSet(ID, { poolset: '', acctorder: '' })).ok).toBe(false);
    expect((await bodyOf(f, { fleetState: without('route-v1') }).writeSet(ID, { poolset: '', acctorder: '' })).ok).toBe(false);
    expect((await bodyOf(f, { fleetState: without('route-v1') }).clearProfile(ID)).ok).toBe(false);
    expect(await bodyOf(f, { fleetState: without('pool-set') }).poolAnswer(ID)).toEqual({ kind: 'not-run' });
    expect(await bodyOf(f, { fleetState: () => undefined }).poolAnswer(ID)).toEqual({ kind: 'not-run' });
    expect(f.calls).toEqual([]);
  });

  it('an id that is not a registry id composes no argv', async () => {
    const f = fake(() => ok());
    const body = bodyOf(f);
    expect((await body.writeSet('--set', { poolset: '', acctorder: '' })).ok).toBe(false);
    expect((await body.clearProfile('a b')).ok).toBe(false);
    expect((await body.keepAwake('-x', 'on')).ok).toBe(false);
    expect(await body.poolAnswer('-x')).toEqual({ kind: 'not-run' });
    expect(f.calls).toEqual([]);
  });

  it('the probe keeps ccd\'s refusal and a lost call apart', async () => {
    expect(await bodyOf(fake(() => refused('ccd: no such session'))).poolAnswer(ID)).toEqual({ kind: 'refused', code: 1 });
    expect(await bodyOf(fake(() => lost('transport'))).poolAnswer(ID)).toEqual({ kind: 'not-run' });
    expect(await bodyOf(fake(() => new Error('dropped'))).poolAnswer(ID)).toEqual({ kind: 'not-run' });
  });
});

describe('keepAwake', () => {
  it('on: the awake line is ok with no foreign marker', async () => {
    const f = fake(() => ok(`awake ${ID}\n`));
    expect(await bodyOf(f).keepAwake(ID, 'on')).toEqual({ ok: true, foreign: null });
    expect(f.calls).toEqual([['keep-awake', '--session', ID, '--state', 'on']]);
  });

  it('kept-foreign with rc 0 is ok, and names the marker', async () => {
    const out = `kept no-roll: not keep-awake's\nkept-foreign no-roll\nawake ${ID}\n`;
    expect(await bodyOf(fake(() => ok(out))).keepAwake(ID, 'on')).toEqual({ ok: true, foreign: 'no-roll' });
  });

  it('an unreadable marker, rc 1 and no awake line, is ok false and says which', async () => {
    const out = 'kept no-hibernate: unreadable (a link, not a regular file, not readable, or the read timed out)\n';
    const r = await bodyOf(fake(() => refused('', 1, out))).keepAwake(ID, 'on');
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ detail: expect.stringContaining('no-hibernate') });
  });

  it('rc 0 without the verb\'s line, a lost answer and a missing word are failures', async () => {
    expect((await bodyOf(fake(() => ok(''))).keepAwake(ID, 'on')).ok).toBe(false);
    expect((await bodyOf(fake(() => lost('timeout'))).keepAwake(ID, 'on')).ok).toBe(false);
    const f = fake(() => ok());
    expect((await bodyOf(f, { fleetState: () => ({ ccdVerbs: WORDS.filter((w) => w !== 'keep-awake-v1') }) }).keepAwake(ID, 'on')).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('off waits for the released line', async () => {
    expect(await bodyOf(fake(() => ok(`released ${ID}\n`))).keepAwake(ID, 'off')).toEqual({ ok: true, foreign: null });
    expect((await bodyOf(fake(() => ok(`awake ${ID}\n`))).keepAwake(ID, 'off')).ok).toBe(false);
  });
});

describe('stop (the stop route\'s own path)', () => {
  const rec = (workspace: string | null): SessionRecord => ({ id: ID, workspace, project: 'overlord', wrapper: 'lane-a', unmeasured: [] }) as unknown as SessionRecord;
  const stopWith = (read: SingleRead | Error, run: RunCcd, over: { identity?: null; refuse?: boolean } = {}) => stopCreatedOf({
    read: async () => { if (read instanceof Error) throw read; return read; }, runCcd: run,
    identityOf: () => (over.identity === null ? null : { wrapper: 'lane-a' }),
    pairRefused: () => over.refuse === true,
    argvFor: (id, r) => (r.workspace !== null ? CCD_ARGV.stopId(id, 'pwa') : CCD_ARGV.stopPair('lane-a', r.project, 'pwa')),
  });

  it('composes the route\'s argv for a workspace row and answers absent: false', async () => {
    const f = fake(() => ok());
    expect(await stopWith({ kind: 'found', record: rec('ws') }, f.run)(ID)).toEqual({ ok: true, absent: false });
    expect(f.calls).toEqual([['stop', '--surface', 'pwa', ID]]);
    expect(allowed(f.calls[0]!)).toBe(true);
  });

  it('answers absent: true for a registry that proves no row, and nothing else is absent', async () => {
    const f = fake(() => ok());
    expect(await stopWith({ kind: 'absent' }, f.run)(ID)).toEqual({ ok: true, absent: true });
    for (const kind of ['unlistable', 'unmeasurable', 'bad-id'] as const) {
      expect((await stopWith({ kind } as SingleRead, f.run)(ID)).ok, kind).toBe(false);
    }
    expect(f.calls).toEqual([]);
  });

  it('a row with no measured identity, or a refused pair, composes no argv', async () => {
    const f = fake(() => ok());
    expect((await stopWith({ kind: 'found', record: rec(null) }, f.run, { identity: null })(ID)).ok).toBe(false);
    expect((await stopWith({ kind: 'found', record: rec(null) }, f.run, { refuse: true })(ID)).ok).toBe(false);
    expect(f.calls).toEqual([]);
  });

  it('a ccd that refuses, a lost call, a rejecting runner and a throwing reader are failures, never throws', async () => {
    const found: SingleRead = { kind: 'found', record: rec('ws') };
    expect((await stopWith(found, fake(() => refused('ccd: no unit')).run)(ID)).ok).toBe(false);
    expect((await stopWith(found, fake(() => lost('transport')).run)(ID)).ok).toBe(false);
    expect((await stopWith(found, fake(() => new Error('dropped')).run)(ID)).ok).toBe(false);
    expect((await stopWith(new Error('registry broke'), fake(() => ok()).run)(ID)).ok).toBe(false);
  });

  it('the body\'s stop never throws when the injected stop does', async () => {
    const r = await bodyOf(fake(() => ok()), { stop: async () => { throw new Error('boom'); } }).stop(ID);
    expect(r).toMatchObject({ ok: false });
  });
});

describe('the runner passes no CLAUDECODE', () => {
  it('takes the variable out of the environment while the child starts, and puts it back', async () => {
    const env: NodeJS.ProcessEnv = { CLAUDECODE: '1', KEEP: 'x' };
    const seen: (string | undefined)[] = [];
    const f = fake(() => { seen.push(env['CLAUDECODE']); return ok(); });
    await bodyOf(f, { env }).writeSet(ID, { poolset: '', acctorder: '' });
    expect(seen).toEqual([undefined]);
    expect(env).toEqual({ CLAUDECODE: '1', KEEP: 'x' });
  });

  it('puts it back when the runner throws, and leaves an absent one absent', async () => {
    const env: NodeJS.ProcessEnv = { CLAUDECODE: '1' };
    const thrower: RunCcd = () => { throw new Error('sync'); };
    expect(() => withoutClaudeCode(thrower, env)(CCD_ARGV.keepAwake(ID, 'on') as CcdArgv)).toThrow('sync');
    expect(env['CLAUDECODE']).toBe('1');
    const bare: NodeJS.ProcessEnv = {};
    await withoutClaudeCode(async () => ok(), bare)(CCD_ARGV.keepAwake(ID, 'on'));
    expect(Object.keys(bare)).toEqual([]);
  });
});

// ── fixture HOME: the real ccd verbs ────────────────────────────────────────────────────────────────────────────────

describe('against a fixture HOME (makeCcdHarness)', () => {
  let h: CcdHarness | null = null;
  afterEach(() => { h?.cleanup(); h = null; });
  const home = (): CcdHarness => { h ??= makeCcdHarness('ccrc-overlord-body-'); return h; };
  const seed = (): void => { home().sh(`_reg_set ${ID} wrapper claude; _reg_set ${ID} uuid deadbeef-0000-4000-8000-000000000000`); };
  /** The process environment the harness's ccd would inherit: `CLAUDECODE` is read at each call, as a real child reads it. */
  const procEnv: NodeJS.ProcessEnv = {};
  afterEach(() => { delete procEnv['CLAUDECODE']; });
  const quote = (a: string): string => `'${a.replace(/'/g, `'\\''`)}'`;
  /** A runner that runs the verb in source mode in the fixture HOME, with whatever `CLAUDECODE` `procEnv` holds now (the harness reads it from `CCRC_TEST_CLAUDECODE`, so a suite run inside a session never inherits one). */
  const harnessRun: RunCcd = async (argv) => {
    const verb = `cmd_${argv[0]!.replace(/-/g, '_')}`;
    const extra: NodeJS.ProcessEnv = procEnv['CLAUDECODE'] === undefined ? {} : { CCRC_TEST_CLAUDECODE: procEnv['CLAUDECODE'] };
    try {
      const stdout = execFileSync('bash', ['-c', 'ccd_h_src=$CCD_HARNESS_SRC ccd_h_snippet=$CCD_HARNESS_SNIPPET; unset CCD_HARNESS_SRC CCD_HARNESS_SNIPPET; '
        + 'source "$ccd_h_src"; FLEET_SPAWN_PINS=; eval "$ccd_h_snippet"'], {
        encoding: 'utf8', cwd: home().home, stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...home().env(extra), CCD_HARNESS_SRC: CCD, CCD_HARNESS_SNIPPET: `${verb} ${argv.slice(1).map(quote).join(' ')}` },
      });
      return ok(stdout.trim());
    } catch (e) {
      const err = e as { status?: number; stderr?: Buffer | string; stdout?: Buffer | string };
      return refused(String(err.stderr ?? ''), err.status ?? 1, String(err.stdout ?? '').trim());
    }
  };
  const fixtureBody = () => bodyOf({ run: harnessRun, calls: [] }, { env: procEnv });
  const filePath = (field: string): string => path.join(home().home, '.cc-sessions', `${ID}.${field}`);

  it('writeSet writes the set, and the same write with empty values clears both files', async () => {
    seed();
    const body = fixtureBody();
    expect(await body.writeSet(ID, { poolset: 'pool-a,pool-b+untagged', acctorder: 'acct-a,acct-b' })).toEqual({ ok: true });
    expect(fs.readFileSync(filePath('poolset'), 'utf8').trim()).toBe('pool-a,pool-b+untagged');
    expect(fs.readFileSync(filePath('acctorder'), 'utf8').trim()).toBe('acct-a,acct-b');
    expect(await body.writeSet(ID, { poolset: '', acctorder: '' })).toEqual({ ok: true });
    expect(fs.existsSync(filePath('poolset'))).toBe(false);
    expect(fs.existsSync(filePath('acctorder'))).toBe(false);
  });

  it('clearProfile clears profiledigest', async () => {
    seed();
    home().sh(`_reg_set ${ID} profiledigest ${DIGEST}`);
    expect(fs.existsSync(filePath('profiledigest'))).toBe(true);
    expect(await fixtureBody().clearProfile(ID)).toEqual({ ok: true });
    expect(fs.existsSync(filePath('profiledigest'))).toBe(false);
  });

  it('with CLAUDECODE in the environment the same write refuses pool-set-operator-only; the adapter\'s runner strips it', async () => {
    seed();
    procEnv['CLAUDECODE'] = '1';
    // The raw runner, with the variable present: ccd refuses a session shell's pool-set write.
    const raw = await harnessRun(CCD_ARGV.routeSet(ID, { poolset: 'pool-a', acctorder: 'acct-a' }));
    expect(raw.ok).toBe(false);
    expect(raw.stderr).toMatch(/pool-set-operator-only/);
    expect(fs.existsSync(filePath('poolset'))).toBe(false);
    // The adapter's runner, given the same environment, runs the write without it.
    expect(await fixtureBody().writeSet(ID, { poolset: 'pool-a', acctorder: 'acct-a' })).toEqual({ ok: true });
    expect(fs.readFileSync(filePath('poolset'), 'utf8').trim()).toBe('pool-a');
    expect(procEnv['CLAUDECODE']).toBe('1');
  });

  it('keepAwake: on, then kept-foreign beside someone else\'s marker, then off', async () => {
    seed();
    const body = fixtureBody();
    expect(await body.keepAwake(ID, 'on')).toEqual({ ok: true, foreign: null });
    expect(fs.readFileSync(filePath('no-roll'), 'utf8')).toBe('keep-awake v1');
    expect(await body.keepAwake(ID, 'off')).toEqual({ ok: true, foreign: null });
    expect(fs.existsSync(filePath('no-roll'))).toBe(false);
    fs.writeFileSync(filePath('no-roll'), 'an operator wrote this');
    expect(await body.keepAwake(ID, 'on')).toEqual({ ok: true, foreign: 'no-roll' });
    expect(fs.readFileSync(filePath('no-roll'), 'utf8')).toBe('an operator wrote this');
  });

  it('keepAwake: a marker ccd cannot read is rc 1, which is ok false', async () => {
    seed();
    fs.symlinkSync('/nonexistent-target', filePath('no-hibernate'));
    const r = await fixtureBody().keepAwake(ID, 'on');
    expect(r.ok).toBe(false);
  });
});
