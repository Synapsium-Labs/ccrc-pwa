// Task 9: open, dispatch (caps + pause + D-1's resume/clear), close (D-5's
// release, never an autonomous archive). Zero new ccd verbs — every argv this
// file proves gets exercised is one of the five `whitelist-subset.test.ts`
// already enumerates; that suite (run unchanged, Step 4) is the proof this
// task added none.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { degradedReadIO, unreadableField } from './ioDoubles.js';
import { holdReason } from '../src/coord/rundefs.js';
import { WORKER_KICKOFF_PREFIX } from '../src/coord/dispatch.js';
import { MAIL_BODY_MAX_BYTES, WORK_ITEM_MAX, WORK_ITEM_TITLE_MAX } from '../../shared/api.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Every `.ts`/`.tsx` under `dir`, recursively. */
const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    // `__`-prefixed names are TRANSIENT, not sources: `boot.test.ts` writes
    // `server/src/__boot_control_mutant__.ts` and removes it in a `finally`
    // up to ~15s later, and vitest runs test FILES in parallel — so such a
    // name can exist at `readdirSync` time and be gone by `readFileSync`,
    // ENOENT-ing a scan that has nothing to do with it. Skipping the prefix
    // costs no coverage: no shipped source is named that way.
    if (e.name.startsWith('__')) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

const PROJECT = 'demo';
const CLAIMED_BY = 'ccrc-pwa-coordinator';
// Review findings 3/10/27: the coordinator write routes are now box-token
// gated, the same gate `mail-routes.test.ts`'s own `TOKEN` constant already
// drives — every helper below attaches it by default; the auth-specific
// tests further down override it to `null` to prove the 401 path.
const TOKEN = 'f'.repeat(64);

const OPEN_BODY = { program: 'build4', title: 'Transcript surface', project: PROJECT,
  wave: 1, waveOf: 3, claimedBy: CLAIMED_BY };

/** A full registry row — same field set `hold-gate.test.ts`'s own `seed`
 *  writes, so a fixture session reads exactly like a real ccd one. */
const seed = (home: string, id: string, over: Partial<Record<string, string>> = {}): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main', ...over,
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** The scripted `capture-pane` sequence a happy `sendPrompt('/clear')` needs
 *  — copied from `send.test.ts`'s own happy-path shape (empty box, echo,
 *  emptied-after-Enter), text swapped for `/clear`. */
const CLEAR_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ /clear\n', 'scrollback\n❯ \n'];

interface RunnerConfig {
  /** ids `ws-add` fabricates in the registry, simulating what ccd's own
   *  `cmd_ws_add` does — default one, for the ordinary wave-1 case. */
  wsAddCreates?: string[];
  /** Verbs that fail (`code: 1`) rather than succeed. */
  fail?: ReadonlySet<string>;
  prState?: { code: number; stdout: string; stderr: string };
  panes?: string[];
}

/** One runner covering every verb this task's routes call: the three ccd
 *  writes (`ws-add`/`ensure`/`ws-hold`/`ws-release`/`ws-archive`), `pr-state`
 *  (close's `verifyDone`), and the tmux calls `sendPrompt`'s `/clear`
 *  injection makes — `Tmux` and `runCcd` share this SAME guarded runner
 *  (`testDeps`'s own wiring), so one function has to answer both vocabularies,
 *  exactly the pattern `hold-gate.test.ts`'s `runnerFor` already uses. */
function makeRunner(home: string, cfg: RunnerConfig = {}): { run: Runner; calls: string[][] } {
  const calls: string[][] = [];
  let capIdx = 0;
  const panes = cfg.panes ?? CLEAR_PANES;
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed` };
    if (verb === 'ws-add') {
      const ids = cfg.wsAddCreates ?? [`${PROJECT}-fresh`];
      for (const id of ids) seed(home, id);
      // A DECOY sentence, deliberately wrong: proves the route learns the id
      // from the registry diff, never from parsing this text.
      return { code: 0, stdout: 'workspace demo-decoy-sentence on claude — /w/x (branch ws/decoy)', stderr: '' };
    }
    if (verb === 'pr-state') return cfg.prState ?? { code: 0, stdout: '', stderr: '' };
    if (verb === 'capture-pane') {
      const p = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };   // ensure, ws-hold, ws-release, ws-archive, send-keys, has-session…
  };
  return { run, calls };
}

/** `cfg` is a PARTIAL override merged onto `testDeps`'s own — every call site
 *  below only ever wants to override `projectsRoot`, never restate the other
 *  fifteen `CcrcConfig` fields, so this widens `Deps['cfg']` from required-
 *  and-whole to optional-and-partial rather than making sixteen-field cfg
 *  literals the price of one field's override at every call site. */
const openApp = async (
  home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> & { cfg?: Partial<Deps['cfg']> } = {},
) => {
  // The registry directory always exists on a real fleet host once ccd has
  // ever run — the pause check's own fail-shut-on-unlistable rule is about a
  // LISTING that failed, not a fixture that never created the directory a
  // real box always has. Every fixture below gets this baseline for free, the
  // same way `seed()` already creates it as a side effect of writing a real
  // session's fields.
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord, ...over, cfg: { ...base.cfg, ...(over.cfg ?? {}) } });
  return { app, coord };
};

const tokenHeaders = (token: string | null): Record<string, string> =>
  token === null ? {} : { 'x-ccrc-mail-token': token };

const postOpen = (app: FastifyInstance, body: unknown = OPEN_BODY, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: '/api/runs', headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });
const postDispatch = (
  app: FastifyInstance, id: number, body: unknown = { brief: 'do the thing' }, token: string | null = TOKEN,
) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });
const postClose = (app: FastifyInstance, id: number, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/close`, headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });
const postAdvance = (app: FastifyInstance, id: number, body: unknown, token: string | null = TOKEN) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/advance`, headers: tokenHeaders(token),
    payload: body as Record<string, unknown> });
// GET /api/runs stays UNGATED — it is not one of the six routes PR J's
// contract item 6 names, and this build's GET routes (`/api/runs`,
// `/api/feed`) carry no token check either before or after review findings
// 3/10/27's fix.
const getRuns = (app: FastifyInstance, closed = false) =>
  app.inject({ method: 'GET', url: `/api/runs${closed ? '?closed=1' : ''}` });
const getMail = (
  app: FastifyInstance, to: string, token: string | null = TOKEN, extraQuery = '',
) =>
  app.inject({ method: 'GET', url: `/api/mail?to=${encodeURIComponent(to)}${extraQuery}`,
    headers: tokenHeaders(token) });

/** A directory listing that always fails — the ordinary transient shape in
 *  remote mode, reused from `mail-routes.test.ts`'s own fixture. */
const unlistableIO: FleetIO = { ...localIO, readdir: async () => null };

describe('POST /api/runs', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('opens a run, in planned, and names the ledger path it never writes or reads', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true, program: 'build4', state: 'planned', ledgerPath: 'docs/superpowers/programs/build4.md',
    });
    const id = (res.json() as { id: number }).id;
    expect(w.coord.run(id)?.state).toBe('planned');
  });

  it('refuses a second coordinator rather than arbitrating', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    await postOpen(app);
    const res = await postOpen(app, { ...OPEN_BODY, wave: 2, claimedBy: 'ccrc-pwa-other' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'claimed-by-another', by: CLAIMED_BY });
  });

  it('places the hold immediately when sessionId names an existing workspace, and persists it onto the row', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' });
    expect(res.statusCode).toBe(200);
    const id = (res.json() as { id: number }).id;
    expect(w.coord.run(id)?.sessionId).toBe('demo-existing');
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-existing', '--reason', `program:build4 wave:2/3 run:${id}`]);
  });

  it('refuses a malformed body', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, wave: 'one' });
    expect(res.statusCode).toBe(400);
  });

  it('answers 501 not-configured without a coordination store', async () => {
    const home = mkTmp('ccrc-runs-');
    app = await buildServer(testDeps(home));   // no `coord` key at all
    const res = await postOpen(app);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });
});

describe('POST /api/runs/:id/dispatch', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses while $REG/coordinator-paused exists, before counting anything', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    writeFileSync(path.join(home, '.cc-sessions', 'coordinator-paused'), '');
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'paused' });
    expect(calls).toEqual([]);   // nothing spawned, nothing counted
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });

  it('refuses paused even when BOTH caps are also exhausted — pause is the answer, not a cap', async () => {
    // Discriminates `dispatch: check caps before the pause file`: with the
    // schema defaults (Task 11 review finding), a lone pause fixture with
    // `running: 0`/`dispatchedIn24h: 0` cannot tell the order apart — both
    // orderings answer `refused: 'paused'`. Zeroing both caps means a
    // caps-first ordering would answer `cap-concurrency` instead; this case
    // fails against that mutant and passes only when the pause check truly
    // runs first.
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    w.coord.setCaps({ maxConcurrentWorkers: 0, maxSessionsPerDay: 0 });
    const opened = (await postOpen(app)).json() as { id: number };
    writeFileSync(path.join(home, '.cc-sessions', 'coordinator-paused'), '');
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'paused' });
    expect(calls).toEqual([]);
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });

  it('refuses when the registry cannot be listed — an unreadable pause file is a PAUSE', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { io: unlistableIO }); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'paused' });
    expect(calls).toEqual([]);
  });

  it('refuses at maxConcurrentWorkers, and says what the limit and the count are', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    // A run already counted as running — `dispatchedAt` set directly, the
    // same bypass `coord-store.test.ts` uses for `capsUsage` fixtures.
    const blocker = w.coord.openRun({ program: 'other', title: 'Other', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-other' }) as { id: number };
    w.coord.markDispatched(blocker.id, 'demo-blocker', 'blocker', 'ws/blocker', false);
    w.coord.setCaps({ maxConcurrentWorkers: 1, maxSessionsPerDay: 12 });

    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'cap-concurrency', limit: 1, running: 1 });
    expect(calls).toEqual([]);
  });

  it('refuses at maxSessionsPerDay over a rolling 24h, not a calendar day', async () => {
    // D-59 (Task 11 review): the original fixture used a bare `Date.now() -
    // 23h` — a calendar-day count agrees with the rolling-24h answer
    // whenever the real wall clock is within the last hour of the local
    // day, so the mutant this case exists to kill only died 23 hours out of
    // every 24. Fake timers pin `now` at a fixed local NOON, so `now - 23h`
    // lands on the PREVIOUS calendar date deterministically, regardless of
    // when this suite actually runs (assumes a UTC/UTC-like test host, the
    // same assumption `mail-sweep.test.ts`/`pr-sweep.test.ts` already make
    // with their own fixed `vi.setSystemTime` epochs).
    const NOW = new Date('2024-06-15T12:00:00.000Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
    try {
      const home = mkTmp('ccrc-runs-');
      const { run } = makeRunner(home);
      const w = await openApp(home, run); app = w.app;
      const blocker = w.coord.openRun({ program: 'other', title: 'Other', project: PROJECT,
        wave: 1, waveOf: 1, claimedBy: 'ccrc-pwa-other' }) as { id: number };
      // Dispatched 23h ago — inside the rolling 24h window (counts), but on
      // the PREVIOUS calendar date (a calendar-day count would not).
      w.coord.markDispatched(blocker.id, 'demo-blocker', 'blocker', 'ws/blocker', false, NOW - 23 * 3600_000);
      w.coord.setCaps({ maxConcurrentWorkers: 12, maxSessionsPerDay: 1 });

      const opened = (await postOpen(app)).json() as { id: number };
      const res = await postDispatch(app, opened.id);
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, refused: 'cap-daily', limit: 1, used: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it('runs ws-add for wave 1 and learns the id from the registry, not from ccd\'s sentence', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sessionId: 'demo-fresh1', resumed: false, clearedAt: null });
    // Position-agnostic on purpose: the exact worker argv (leading `--no-rc`,
    // then the project) is pinned by its own test below — this one is about
    // the registry-diff id learning, not the flag.
    expect(calls.some((c) => c[0] === 'ws-add' && c.includes(PROJECT))).toBe(true);
    expect(calls.some((c) => c[0] === 'ensure')).toBe(false);
    const row = w.coord.run(opened.id);
    expect(row).toMatchObject({ sessionId: 'demo-fresh1', workspace: 'demo-fresh1', branch: 'ws/demo-fresh1',
      resumed: false, clearedAt: null, state: 'dispatched' });
  });

  // Per-worker RC (the 2026-08-13 ruling, task #37): the dispatch path is the
  // ONE call site that knows a spawn is a dispatched worker, so it — and only
  // it — composes `--no-rc`. Exact argv, token for token: ccd's parse contract
  // is a LEADING flag (`cmd_ws_add` shifts it before the positionals), so a
  // trailing `--no-rc` would arrive as the slug and name the worktree after
  // the flag.
  it('a wave-1 fresh spawn declares the worker: ws-add carries --no-rc, in the leading position ccd parses', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(200);
    expect(calls.filter((c) => c[0] === 'ws-add')).toEqual([['ws-add', '--no-rc', PROJECT]]);
  });

  it('the PWA\'s ordinary workspace-add stays box-default — no --no-rc anywhere in its argv', async () => {
    // The other half of the same pin: only the dispatch path declares a
    // worker. An operator's add from the PWA follows the box flag, so its
    // argv must stay exactly two tokens — `--no-rc` anywhere in it would
    // strip RC from a session nobody marked.
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'POST', url: `/api/projects/${PROJECT}/workspaces` });
    expect(res.statusCode).toBe(200);
    expect(calls.filter((c) => c[0] === 'ws-add')).toEqual([['ws-add', PROJECT]]);
  });

  it('the 200 body CARRIES adopted and spawnState — the coordinator sees nothing but this JSON', async () => {
    // §1.5's verdict is computed in `dispatchRun` and would be dead if the
    // delivery edge dropped it: the coordinator reads HTTP and nothing else, and
    // `ccd/coordinator-skill/references/wave-lifecycle.md` already documents both
    // fields verbatim. An L4 adapter may not narrow a distinction it received.
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-fresh1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(200);
    // A CLEAN ws-add: not adopted, and no spawn fact of its own to report.
    // `null` here means "nothing was recorded", NOT `unrecognised`.
    expect(res.json()).toMatchObject({ ok: true, adopted: false, spawnState: null });
  });

  // Registry ladder (architecture doc, increment 1's second half): the AFTER
  // read never tolerates degradation, unlike BEFORE — see the comment at the
  // call site in coord/routes.ts, written there on purpose because the
  // design names this exact spot as the most likely target of a future
  // "simplification" back into a bug. Written FIRST and confirmed red
  // against the pre-gate code (which used a plain `readRegistry` after-read
  // and would have bound the degraded row as the winning candidate, since
  // its `.workspace` still reads a real value even though its identity does
  // not).
  describe('the AFTER read never tolerates a same-project unmeasured row (identity-by-subtraction)', () => {
    it('refuses registry-unmeasurable, binds and holds NOTHING, when the freshly spawned workspace\'s ' +
       'own identity could not be measured', async () => {
      const home = mkTmp('ccrc-runs-');
      const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh1'] });
      const io = unreadableField('demo-fresh1', 'wrapper');
      const w = await openApp(home, run, { io }); app = w.app;
      const opened = (await postOpen(app)).json() as { id: number };
      const res = await postDispatch(app, opened.id);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
      expect(calls.some((c) => c[0] === 'ws-hold')).toBe(false);
      const row = w.coord.run(opened.id);
      expect(row?.state).toBe('planned');
      expect(row?.sessionId).toBeNull();
    });

    it('refuses registry-unmeasurable when the AFTER listing itself cannot be read, even though BEFORE ' +
       'and the ws-add call both succeeded', async () => {
      const home = mkTmp('ccrc-runs-');
      let spawned = false;
      const { run: baseRun, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh1'] });
      const run: Runner = async (cmd, args) => {
        const res = await baseRun(cmd, args);
        if (args[0] === 'ws-add') spawned = true;
        return res;
      };
      // BEFORE (pre-ws-add) reads succeed; only the AFTER listing fails —
      // proving this refusal is really about the AFTER read, not a blanket
      // "the registry is unlistable" pause-style refusal that would also
      // fire on BEFORE.
      const io: FleetIO = { ...localIO, readdir: async (p) => (spawned ? null : localIO.readdir(p)) };
      const w = await openApp(home, run, { io }); app = w.app;
      const opened = (await postOpen(app)).json() as { id: number };
      const res = await postDispatch(app, opened.id);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
      expect(calls.some((c) => c[0] === 'ws-add')).toBe(true);   // the spawn itself was never in question
      expect(calls.some((c) => c[0] === 'ws-hold')).toBe(false);
      const row = w.coord.run(opened.id);
      expect(row?.state).toBe('planned');
      expect(row?.sessionId).toBeNull();
      // ccd is NOT the failing party here, so the body says nothing on its
      // behalf. The presence of `stderr` is the distinction — see the next test.
      expect(res.json()).not.toHaveProperty('stderr');
    });

    it('the 502 QUOTES ccd when the ws-add failed too — two failures, and the operator hears both', async () => {
      // §1.5 moved the `!res.ok` early return past the AFTER read, and the
      // operator-facing cost was here: on the one path where BOTH the spawn and
      // the listing fail, the 502 used to name only the listing. `fleetFailed`
      // quotes ccd on every other refusal in this route; this one lost it purely
      // as a side effect of the return moving.
      const home = mkTmp('ccrc-runs-');
      let spawned = false;
      const calls: string[][] = [];
      const run: Runner = async (_cmd, args) => {
        calls.push(args);
        if (args[0] === 'ws-add') {
          // The workspace IS created and the call STILL fails — the real
          // cut-short shape, which is why this arm is reachable at all.
          seed(home, 'demo-fresh1');
          spawned = true;
          return { code: 1, stdout: '', stderr: 'ccd: no wrapper has capacity', killed: true };
        }
        return { code: 0, stdout: '', stderr: '' };
      };
      const io: FleetIO = { ...localIO, readdir: async (p) => (spawned ? null : localIO.readdir(p)) };
      const w = await openApp(home, run, { io }); app = w.app;
      const opened = (await postOpen(app)).json() as { id: number };
      const res = await postDispatch(app, opened.id);
      expect(res.statusCode).toBe(502);
      expect(res.json()).toEqual({
        ok: false, error: 'registry-unmeasurable', stderr: 'ccd: no wrapper has capacity',
      });
      // Still binds and holds NOTHING — carrying ccd's words is not adoption.
      expect(calls.some((c) => c[0] === 'ws-hold')).toBe(false);
      expect(w.coord.run(opened.id)?.sessionId).toBeNull();
    });
  });

  it('refuses ambiguous-dispatch when two new workspaces appear, and holds NOTHING', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-amb1', 'demo-amb2'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'ambiguous-dispatch', candidates: 2 });
    expect(calls.some((c) => c[0] === 'ws-hold')).toBe(false);
    const row = w.coord.run(opened.id);
    expect(row?.state).toBe('planned');
    expect(row?.sessionId).toBeNull();
  });

  // Registry ladder: the resumed session's identity must be measured before
  // EITHER the busy gate or `markDispatched` persists workspace/branch —
  // written FIRST and confirmed red against the pre-gate code, which read
  // `record.uuid` straight off a (then always-fully-measured-or-absent)
  // record and would have fed a degraded `''` uuid to `readHookState`,
  // reading back `null` (not busy) and letting the resume/`/clear` proceed.
  it('refuses registry-unmeasurable on wave N>=2 when the resumed session\'s identity cannot be measured — ' +
     'before the busy gate, before /clear, and before persisting workspace/branch onto the run row', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const io = unreadableField('demo-existing', 'uuid');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { io }); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    // `ensure` already ran (D-1 resumes the SAME workspace unconditionally,
    // before this gate can even read the fresh record) but the /clear never
    // fired, and dispatch never committed.
    expect(calls.some((c) => c[0] === 'ensure' && c[1] === 'demo-existing')).toBe(true);
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(false);
    const row = w.coord.run(opened.id);
    expect(row?.state).toBe('planned');
    expect(row?.workspace).toBeNull();
    expect(row?.branch).toBeNull();
  });

  // Blocking review finding 7: the SAME asymmetry the AFTER read above
  // closes had a twin left open one branch over. Wave N>=2 used to source
  // `record` from `readRegistry`'s OLD signature ([] on an unlistable
  // registry) — the SAME shape "record is undefined" (genuinely absent)
  // wears — so a dropped SECOND directory read (the pause-marker's own read
  // a moment earlier, at the top of this same route, succeeded) forced
  // `record` to `undefined`, `hs` to `null`, and skipped the worker-busy
  // gate entirely: `/clear` would have been injected into a possibly
  // mid-turn worker. Written FIRST and confirmed red against the pre-fix
  // code, which answered 200 here (an injected `/clear`) instead of 502.
  it('refuses registry-unmeasurable on wave N>=2 when the SECOND directory read (the resumed ' +
     'session\'s own registry listing) fails, even though the pause-marker\'s own read moments ' +
     'earlier succeeded — the busy gate must fail shut here exactly as hard as the AFTER read does',
     async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    // Succeeds on the pause-marker's own read (call 1), fails on the very
    // next one — this route's own registry read for the resumed session
    // (call 2) — never a third: nothing else in this branch touches
    // `io.readdir` before either of those two.
    let n = 0;
    const io: FleetIO = { ...localIO, readdir: async (p) => { n += 1; return n === 2 ? null : localIO.readdir(p); } };
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run, { io }); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    // `ensure` already ran (D-1 resumes the SAME workspace unconditionally,
    // before this gate can even read the fresh record), but the busy gate
    // and `/clear` must never be reached, and dispatch must never commit.
    expect(calls.some((c) => c[0] === 'ensure' && c[1] === 'demo-existing')).toBe(true);
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(false);
    const row = w.coord.run(opened.id);
    expect(row?.state).toBe('planned');
    expect(row?.workspace).toBeNull();
    expect(row?.branch).toBeNull();
  });

  it('runs ensure — never start — for wave 2 into the same workspace (D-1)', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, sessionId: 'demo-existing', resumed: true });
    expect(calls.some((c) => c[0] === 'ensure' && c[1] === 'demo-existing')).toBe(true);
    expect(calls.some((c) => c[0] === 'ws-add')).toBe(false);
    // The injected /clear, through sendPrompt's own proof discipline.
    expect(calls.some((c) => c[0] === 'send-keys' && c.includes('-l') && c.includes('/clear'))).toBe(true);
    const row = w.coord.run(opened.id);
    expect(row?.resumed).toBe(true);
    expect(row?.clearedAt).toEqual(expect.any(Number));
    expect(row?.workspace).toBe('demo-existing');
    expect(row?.branch).toBe('ws/demo-existing');
  });

  it('a RESUMED dispatch leaves dispatchStartedAt null — the column measures the SPAWN, and a resume ' +
     'mints no workspace (the scope is deliberate, not an oversight)', async () => {
    // THE SCOPE OF `dispatchStartedAt`, PINNED SO IT IS DELIBERATE RATHER THAN
    // DISCOVERED. `markDispatchStarted` is called on ONE path — the fresh-spawn
    // arm, immediately before the `ws-add` (`dispatch.ts`) — and the D-1 resume
    // arm above (`CCD_ARGV.ensure` + `runCcd`) never calls it. That is correct
    // and not an omission: the column exists to describe the window in which a
    // workspace is being MINTED and no session id exists yet, and a resume has
    // neither half of that — `run.sessionId` is already known before the call,
    // so the console has a row to point at from the first frame and needs no
    // stamp to say so.
    //
    // WHICH MAKES NULL CARRY A NAMED SECOND CONDITION, and the docstrings on
    // `RunSummary.dispatchStartedAt` (shared/api.ts), `hydrateRun` (store.ts)
    // and MIGRATIONS[4] (schema.ts) each say so in as many words: null means no
    // FRESH-SPAWN dispatch has started — nobody dispatched this run, OR every
    // dispatch it has had was a resume. The consequence a reader must be able
    // to derive from those words alone is asserted here: on this row
    // `dispatchedAt` is set and `dispatchStartedAt` is not, so the
    // `dispatchedAt - dispatchStartedAt` spawn duration those docstrings
    // promise is available for wave-1 fresh spawns and NOT for a resume.
    //
    // Stamp the resume arm too and this goes red — which is the point: making
    // the column mean "any dispatch began" is a scope change, and it must cost
    // a test, not pass unnoticed.
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing-resume');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app,
      { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing-resume' })).json() as { id: number };
    expect(w.coord.run(opened.id)?.dispatchStartedAt).toBeNull();   // nothing has dispatched it yet
    expect((await postDispatch(app, opened.id)).json()).toMatchObject({ ok: true, resumed: true });
    const row = w.coord.run(opened.id)!;
    expect(row.state).toBe('dispatched');                 // it WAS dispatched …
    expect(row.dispatchedAt).toEqual(expect.any(Number));
    expect(row.dispatchStartedAt).toBeNull();             // … and no spawn window was measured
    // And the wire says the same thing — the PWA reads this exact pair, so a
    // renderer that treats a null start as "never dispatched" is reading the
    // wrong field: `state` is what answers that, on every path.
    expect(toRunSummary(row).dispatchStartedAt).toBeNull();
  });

  it('leaves clearedAt null when the injected /clear is refused (dialog open) — dispatch still lands, ' +
     'the refusal is RECORDED, and the brief is NOT queued into the un-cleared context (D-47)', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing2');
    // A live AskUserQuestion menu pane — `sendPrompt` refuses `dialog-open`
    // and never presses a key.
    const menuPane = '❯ 1. Yes\n  2. No\n  ──────────────\nEnter to select\n';
    const { run, calls } = makeRunner(home, { panes: [menuPane] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing2' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      ok: true, resumed: true, clearedAt: null, briefQueued: false, clearError: 'dialog-open',
    });
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(false);   // refused before any keystroke
    expect(w.coord.run(opened.id)?.clearedAt).toBeNull();
    expect(w.coord.run(opened.id)?.state).toBe('dispatched');   // dispatch itself still lands
    // D-47: the refusal is a fact about the run now, not a null column and a
    // silently discarded error — `run_events.detail` names which of
    // sendPrompt's typed refusals fired.
    expect(w.coord.runEvents(opened.id)).toEqual([
      { at: expect.any(Number), fromState: 'planned', toState: 'dispatched', causedBy: 'coordinator',
        detail: 'clear-refused:dialog-open' },
    ]);
    // D-47: NOTHING was queued — the delivery lane must never be handed a
    // brief to inject into a context `/clear` never actually verified as
    // fresh (the exact hazard that, left unfixed, parks the brief
    // `rejected('undeliverable')` after MAIL_MAX_ATTEMPTS with no signal why).
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('queues NO mail AT ALL on that same path — the kickoff prefix never becomes a mail of its ' +
     'own when there is no brief to carry it', async () => {
    // The sibling test above pins the BRIEF's absence through
    // `dueDeliveries`, which answers "what should a sweep type next". This one
    // asks the wider question the prefix makes worth asking: composing a
    // kickoff into every dispatch must not create a message on a path that
    // sends none. `mailForRecipient` sees every row in every state, so a mail
    // parked, delivered or merely queued-but-not-yet-due would all show here.
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing2b');
    const menuPane = '❯ 1. Yes\n  2. No\n  ──────────────\nEnter to select\n';
    const { run } = makeRunner(home, { panes: [menuPane] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing2b' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id, { brief: 'the wave the worker never gets' });
    expect(res.json()).toMatchObject({ ok: true, briefQueued: false });
    expect(w.coord.mailForRecipient('demo-existing2b')).toEqual([]);
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('places the hold with the convention reason, and never parses one back', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh2'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-fresh2', '--reason', `program:build4 wave:1/3 run:${opened.id}`]);
    // The run's own program/wave columns carry this — nothing reads it back
    // out of the reason string.
    expect(w.coord.run(opened.id)).toMatchObject({ program: 'build4', wave: 1, waveOf: 3 });
  });

  it('queues the brief as mail rather than injecting it', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh3'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id, { brief: 'implement task 3, then the review lens pass' });
    // Wave 1 has no /clear step at all, so ANY send-keys call here would mean
    // the brief was injected directly instead of queued as mail.
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(false);
    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(1);
    expect(due[0]).toMatchObject({ toId: 'demo-fresh3' });
    expect(due[0]!.envelope).toContain('kind: status');
    expect(due[0]!.envelope).toContain('subject: wave-brief');
    expect(due[0]!.envelope).toContain('implement task 3, then the review lens pass');
    expect(due[0]!.envelope).toContain('from: coordinator');
  });

  it('hands the worker its protocol BY NAME inside that same mail — the body OPENS with the ' +
     'kickoff prefix and the coordinator\'s brief follows it verbatim', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh3b'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const brief = 'implement task 3, then the review lens pass';
    await postDispatch(app, opened.id, { brief });
    // The prefix rides the MAIL. It is not a second thing typed at the pane
    // beside it — wave 1 still gets zero keystrokes, the pin one test up.
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(false);
    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(1);   // ONE mail — a kickoff is not a second message
    // POSITION, not mere presence. `renderEnvelope` terminates its header block
    // with a bare `--` line and then emits the body and nothing else but the
    // closing fence, so this one assertion says three things at once: the
    // prefix opens the body, the brief is unaltered, and nothing was inserted
    // between them.
    expect(due[0]!.envelope).toContain(`\n--\n${WORKER_KICKOFF_PREFIX}${brief}\n`);
  });

  it('records the transition with causedBy=coordinator', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-fresh4'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    expect(w.coord.runEvents(opened.id)).toEqual([
      { at: expect.any(Number), fromState: 'planned', toState: 'dispatched', causedBy: 'coordinator', detail: null },
    ]);
  });

  it('refuses a second dispatch before touching the fleet at all — the transition guard runs FIRST (D-46)', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh5'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const first = await postDispatch(app, opened.id);
    expect(first.statusCode).toBe(200);
    const callsAfterFirst = calls.length;
    const second = await postDispatch(app, opened.id);
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, error: 'bad-transition', from: 'dispatched', to: 'dispatched' });
    // Nothing ran on the retry — no second `ws-add`/`ensure`/`ws-hold`, and
    // no second `run_events` row (still exactly the first dispatch's).
    expect(calls.length).toBe(callsAfterFirst);
    expect(w.coord.runEvents(opened.id).length).toBe(1);
  });

  it('a wave-2 double dispatch never re-injects /clear into a live, already-resumed worker (D-46)', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-existing3');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-existing3' }))
      .json() as { id: number };
    await postDispatch(app, opened.id);
    const sendKeysBefore = calls.filter((c) => c[0] === 'send-keys').length;
    expect(sendKeysBefore).toBeGreaterThan(0);   // the first dispatch's own /clear landed
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    const sendKeysAfter = calls.filter((c) => c[0] === 'send-keys').length;
    expect(sendKeysAfter).toBe(sendKeysBefore);   // the SECOND call never wiped the worker again
  });

  it('answers 404 unknown-run for a run id that does not exist', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postDispatch(app, 4242);
    expect(res.statusCode).toBe(404);
  });

  it('answers 501 not-configured without a coordination store', async () => {
    const home = mkTmp('ccrc-runs-');
    app = await buildServer(testDeps(home));
    const res = await postDispatch(app, 1);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });
});

// ── close ────────────────────────────────────────────────────────────────
//
// verifyDone needs a REAL fingerprint to pass: a git ref this fixture's
// project actually has, and a `pr-state` answer that agrees with the claim —
// copied straight off `coord-fingerprint.test.ts`'s own `project`/`prRow`/
// `ccdLine` helpers, so the shapes `readBranchTip`/`phaseFor` require are
// exactly the ones already proven correct there.
const gitRoot = (project: string, branch: string, tip: string): string => {
  const root = mkTmp('ccrc-runs-git-');
  const git = path.join(root, project, '.git');
  const segs = branch.split('/');
  const file = segs.pop()!;
  mkdirSync(path.join(git, 'refs', 'heads', ...segs), { recursive: true });
  writeFileSync(path.join(git, 'refs', 'heads', ...segs, file), `${tip}\n`);
  return root;
};

const prRow = (branch: string, state: 'OPEN' | 'CLOSED' | 'MERGED'): Record<string, unknown> => ({
  number: 7, state, headRefName: branch, baseRefName: 'main',
  isCrossRepository: false, ours: true, isDraft: false,
  ...(state === 'MERGED' ? { mergedAt: '2020-01-01T00:00:00Z', mergeCommit: { oid: 'f'.repeat(40) } } : {}),
});
const ccdLine = (sessionId: string, branch: string, rows: Record<string, unknown>[]): string =>
  JSON.stringify({ id: sessionId, rows, baseShort: 'main', branch, ahead: 1, checkedAt: Date.now() });

const TIP = 'a'.repeat(40);
const OTHER_TIP = 'b'.repeat(40);

describe('POST /api/runs/:id/close', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** Opens and dispatches a wave-1 run for real, through the routes, so the
   *  run row carries a genuine sessionId/workspace/branch the way close's
   *  own preconditions expect — the same reason `mail-routes.test.ts`'s ack
   *  tests build their delivery through a real send rather than poking rows
   *  in directly. */
  const dispatchedRun = async (
    sessionId: string, projectsRoot: string, prState: { code: number; stdout: string; stderr: string },
    over: Partial<Deps> = {},
  ) => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: [sessionId], prState });
    const w = await openApp(home, run, { cfg: { projectsRoot }, ...over });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    return { id: opened.id, coord: w.coord, calls };
  };

  const GOOD_CLAIM = { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP };

  it('leaves the run untouched and mails the code back on a stale-tip claim', async () => {
    const sessionId = `${PROJECT}-close1`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, OTHER_TIP);   // the REAL tip has moved
    const { id, coord } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const before = coord.run(id)!.state;
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'stale-tip' });
    expect(coord.run(id)!.state).toBe(before);   // UNCHANGED
    expect(coord.rejections().map((r) => r.code)).toContain('stale-tip');
    const due = coord.dueDeliveries(Date.now(), 60_000);
    expect(due.some((d) => d.toId === sessionId && d.envelope.includes('stale-tip'))).toBe(true);
  });

  it('refuses to close when .prhistory is present-but-unreadable', async () => {
    const sessionId = `${PROJECT}-close2`;
    const home = mkTmp('ccrc-runs-');
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    // Listed (a real, present file — `readPrHistory`'s own second-look logic
    // needs a listing that names it) but every read of it fails, the same
    // `withUnreadableField` idiom `mail-routes.test.ts` uses.
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    writeFileSync(path.join(home, '.cc-sessions', `${sessionId}.prhistory`), '');
    const unreadablePrhistory = degradedReadIO((p) => p.endsWith('.prhistory'));
    const { run } = makeRunner(home, { wsAddCreates: [sessionId],
      prState: { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' } });
    const base = testDeps(home, run);
    const w = await openApp(home, run, { io: unreadablePrhistory, cfg: { ...base.cfg, projectsRoot: root } });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const res = await postClose(app, opened.id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'prhistory-unreadable' });
    expect(w.coord.run(opened.id)!.state).toBe('dispatched');   // nothing closes
  });

  it('folds the PR lineage it CAN read, and [] is a measured answer', async () => {
    const sessionId = `${PROJECT}-close3`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    // No `.prhistory` file at all: ABSENT is a MEASURED [].
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(200);
    expect(coord.run(id)!.prLineage).toEqual([]);
  });

  it('releases the hold on the final wave and archives NOTHING itself', async () => {
    const sessionId = `${PROJECT}-close4`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'MERGED')])}\n`, stderr: '' });
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ released: true });
    expect(coord.run(id)!.state).toBe('done');
    expect(coord.run(id)!.handoffCommit).toBe(TIP);
    expect(calls.some((c) => c[0] === 'ws-release' && c.includes(sessionId))).toBe(true);
    expect(calls.some((c) => c[0] === 'ws-archive')).toBe(false);
  });

  it('updates the hold reason to the next wave otherwise', async () => {
    const sessionId = `${PROJECT}-close5`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ released: false });
    expect(coord.run(id)!.state).toBe('done');
    // NO ` run:` suffix, deliberately: this reason claims the workspace for
    // wave 2, whose run has not been opened yet. Stamping the CLOSING run's
    // id onto the successor's claim would name the wrong run.
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', 'program:build4 wave:2/3']);
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
  });

  it('final:true with a sibling open re-holds with the SIBLING reason and answers released:false', async () => {
    const sessionId = `${PROJECT}-close-sib`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'MERGED')])}\n`, stderr: '' });
    const next = coord.openRun({ program: 'build4', title: 'T', project: PROJECT, wave: 2, waveOf: 3,
      claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('fixture openRun refused');
    coord.setSession(next.id, sessionId);

    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'done', released: false });
    expect(coord.run(id)!.state).toBe('done');
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:2/3 run:${next.id}`]);
  });

  it('the non-final arm re-holds with the SURVIVING run, never with its own next wave', async () => {
    // Before Wave 2 it re-held `holdReason(program, wave+1, waveOf)` from its
    // OWN row, silently rewriting the live run's claim whenever the two rows
    // disagree. With a sibling open, the surviving run's reason wins.
    const sessionId = `${PROJECT}-close-nonfinal-sib`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const next = coord.openRun({ program: 'build4', title: 'T', project: PROJECT, wave: 4, waveOf: 3,
      claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('fixture openRun refused');
    coord.setSession(next.id, sessionId);

    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: false });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, released: false });
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:4/3 run:${next.id}`]);
    expect(calls).not.toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', 'program:build4 wave:2/3']);
  });

  it('archives on explicit abandon (state:failed, archive:true) — the only wsArchive call in the lane', async () => {
    const sessionId = `${PROJECT}-close6`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true, state: 'failed', archive: true });
    expect(res.statusCode).toBe(200);
    expect(coord.run(id)!.state).toBe('failed');
    expect(calls.some((c) => c[0] === 'ws-archive' && c.includes(sessionId))).toBe(true);
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
  });

  it('failed+archive with a SIBLING open archives NOTHING and re-holds — the fourth fleet act, gated', async () => {
    // `ws-archive` has no hold rung in ccd (by design: a by-hand archive of a
    // held workspace must still work), so an ungated arm here archives the
    // SIBLING's workspace and leaves the sibling's `.hold` standing over it —
    // F9's harm through a different door, in the function Wave 2 rewrites.
    const sessionId = `${PROJECT}-close-arch-sib`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const next = coord.openRun({ program: 'build4', title: 'T', project: PROJECT, wave: 2, waveOf: 3,
      claimedBy: CLAIMED_BY });
    if (!('id' in next)) throw new Error('fixture openRun refused');
    coord.setSession(next.id, sessionId);

    const res = await postClose(app!, id,
      { fingerprint: GOOD_CLAIM, final: true, state: 'failed', archive: true });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, state: 'failed', released: false });
    // The run still transitions — the WORKSPACE is what is protected.
    expect(coord.run(id)!.state).toBe('failed');
    expect(calls.some((c) => c[0] === 'ws-archive')).toBe(false);
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:2/3 run:${next.id}`]);
  });

  it('failed+archive with NO sibling still archives — the arm is gated, not deleted', async () => {
    const sessionId = `${PROJECT}-close-arch-lone`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const res = await postClose(app!, id,
      { fingerprint: GOOD_CLAIM, final: true, state: 'failed', archive: true });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', sessionId]);
  });

  it('answers 501 when the fleet ccd does not support ws-release, and the run stays RETRYABLE — ' +
     'not wedged done with the hold silently un-released (D-48)', async () => {
    const sessionId = `${PROJECT}-close7`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' },
      // `pr-state` stays supported — `verifyDone` has its OWN `verbSupported`
      // gate (`fingerprint.ts`) and must succeed here, so the 501 this test
      // proves is close's own fleet-act gate, not a verifyDone side effect.
      { fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', 'ensure', 'ws-hold', 'pr-state'], rosterFp: null, build: null } });
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'unsupported' });
    // D-48: the fleet act moved AHEAD of the transition commit — a 501 here
    // must leave the run exactly where it was, never terminally `done`
    // (`RUN_TRANSITIONS.done = []` would give no retry at all).
    expect(coord.run(id)!.state).toBe('dispatched');
    expect(coord.run(id)!.closedAt).toBeNull();
  });

  it('refuses a second close before touching the fleet again — the transition guard runs first (D-48)', async () => {
    const sessionId = `${PROJECT}-close8`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord, calls } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'MERGED')])}\n`, stderr: '' });
    const first = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(first.statusCode).toBe(200);
    const releasesAfterFirst = calls.filter((c) => c[0] === 'ws-release').length;
    expect(releasesAfterFirst).toBe(1);
    const second = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, error: 'bad-transition', from: 'done', to: 'closing' });
    // The retry never touched the fleet a second time.
    expect(calls.filter((c) => c[0] === 'ws-release').length).toBe(releasesAfterFirst);
    expect(coord.run(id)!.state).toBe('done');
  });

  it('closes state:failed WITHOUT re-measuring the claim — an operator abandon is not a done claim (D-49)', async () => {
    const sessionId = `${PROJECT}-close9`;
    // The REAL tip is OTHER_TIP — the same mismatch the very first test in
    // this file proves `verifyDone` refuses for a `done` close (`stale-tip`).
    // A `state:'failed'` close must succeed anyway: there is no claim of
    // doneness here to re-measure.
    const root = gitRoot(PROJECT, `ws/${sessionId}`, OTHER_TIP);
    const { id, coord } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true, state: 'failed' });
    expect(res.statusCode).toBe(200);
    expect(coord.run(id)!.state).toBe('failed');
    // D-13's own wedge, reached through the DISPATCHED side instead of
    // `planned`: a terminal run must not keep pinning the concurrency cap.
    expect(coord.capsUsage().running).toBe(0);
  });

  it('closes state:failed directly from awaiting-review — one call, no bounce through working first ' +
     '(fix, scoped-verify R3)', async () => {
    // Before this fix, `RUN_TRANSITIONS['awaiting-review']` had no `closing`
    // edge (`working` and `merging` both did), so THIS call 409'd
    // `bad-transition` and an abandon from `awaiting-review` needed a first
    // `/advance` back to `working` before `/close` would even look at the
    // fleet act — an undocumented two-call path.
    const sessionId = `${PROJECT}-close12`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' });
    await postAdvance(app!, id,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    const toReview = await postAdvance(app!, id,
      { to: 'awaiting-review', fingerprint: { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP } });
    expect(toReview.statusCode).toBe(200);
    expect(coord.run(id)!.state).toBe('awaiting-review');

    const res = await postClose(app!, id, { fingerprint: GOOD_CLAIM, final: true, state: 'failed' });
    expect(res.statusCode).toBe(200);
    expect(coord.run(id)!.state).toBe('failed');
  });

  it('folds real PR lineage read from a real .prhistory file — [] alone cannot discriminate ' +
     'the fold call being dropped (D-50)', async () => {
    const sessionId = `${PROJECT}-close10`;
    const home = mkTmp('ccrc-runs-');
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const line = JSON.stringify({ pr: 42, branch: `ws/${sessionId}`, phase: 'merged', recordedAt: 12345 });
    writeFileSync(path.join(home, '.cc-sessions', `${sessionId}.prhistory`), `${line}\n`);
    const { run } = makeRunner(home, { wsAddCreates: [sessionId],
      prState: { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' } });
    const base = testDeps(home, run);
    const w = await openApp(home, run, { cfg: { ...base.cfg, projectsRoot: root } });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const res = await postClose(app, opened.id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(200);
    // Deleting `coord.foldPrLineage(id, history.entries)` at the fold site
    // would leave this answer `[]` too (`hydrateRun`'s own NULL-column
    // default) — the same `[]` an absent ledger genuinely means. Only a REAL
    // recorded entry discriminates the fold call from its own absence.
    expect(w.coord.run(opened.id)!.prLineage).toEqual([
      { pr: 42, branch: `ws/${sessionId}`, phase: 'merged', recordedAt: 12345 },
    ]);
  });

  it('retires the program only once ALL its runs are terminal, mirroring whichever run ' +
     'closes it out (D-51)', async () => {
    const sessionA = `${PROJECT}-close11`;
    const root = gitRoot(PROJECT, `ws/${sessionA}`, TIP);
    const { id: idA, coord } = await dispatchedRun(sessionA, root,
      { code: 0, stdout: `${ccdLine(sessionA, `ws/${sessionA}`, [prRow(`ws/${sessionA}`, 'MERGED')])}\n`, stderr: '' });

    // A sibling run under the SAME program, seeded directly at the store
    // level — the identical bypass `maxConcurrentWorkers`'s own fixture
    // already uses for an auxiliary run that is not what this test proves.
    const sibling = coord.openRun({ program: 'build4', title: 'Transcript surface', project: PROJECT,
      wave: 2, waveOf: 3, claimedBy: CLAIMED_BY }) as { id: number };
    coord.markDispatched(sibling.id, `${sessionA}-sib`, 'sib-ws', 'ws/sib', false);
    coord.advance(sibling.id, 'dispatched', 'coordinator');

    expect(coord.programs()).toEqual([{ slug: 'build4', title: 'Transcript surface', state: 'active' }]);
    const resA = await postClose(app!, idA, { fingerprint: GOOD_CLAIM, final: true });
    expect(resA.statusCode).toBe(200);
    // The SIBLING is still non-terminal — the program must stay `active`.
    expect(coord.programs()).toEqual([{ slug: 'build4', title: 'Transcript surface', state: 'active' }]);

    // Close the sibling too, as an explicit abandon — D-49 lets this route
    // skip verifyDone, so a fabricated sessionId with no real git root still
    // closes cleanly. NOW it is the last run, and the program retires
    // `abandoned`, mirroring the run that closed it out.
    const resB = await postClose(app!, sibling.id, { fingerprint: GOOD_CLAIM, final: true, state: 'failed' });
    expect(resB.statusCode).toBe(200);
    expect(coord.programs()).toEqual([{ slug: 'build4', title: 'Transcript surface', state: 'abandoned' }]);
  });

  it('answers 404 unknown-run for a run id that does not exist', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postClose(app, 4242, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(404);
  });

  it('refuses not-dispatched for a run still in planned', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postClose(app, opened.id, { fingerprint: GOOD_CLAIM, final: true });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'not-dispatched' });
  });
});

describe('GET /api/runs', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('lists open runs by default, and never leaks prLineage onto the wire', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-list1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const res = await getRuns(app);
    expect(res.statusCode).toBe(200);
    const { runs } = res.json() as { runs: Record<string, unknown>[] };
    expect(runs.length).toBe(1);
    expect(runs[0]).not.toHaveProperty('prLineage');
    expect(runs[0]).toMatchObject({ id: opened.id, state: 'dispatched' });
  });

  it('excludes closed runs unless closed=1 is asked for', async () => {
    const home = mkTmp('ccrc-runs-');
    const sessionId = 'demo-list2';
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { run } = makeRunner(home, { wsAddCreates: [sessionId],
      prState: { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' } });
    const base = testDeps(home, run);
    const w = await openApp(home, run, { cfg: { ...base.cfg, projectsRoot: root } });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    await postClose(app, opened.id, {
      fingerprint: { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP }, final: true,
    });
    expect((await getRuns(app)).json()).toEqual({ runs: [] });
    const withClosed = (await getRuns(app, true)).json() as { runs: { id: number }[] };
    expect(withClosed.runs.map((r) => r.id)).toContain(opened.id);
  });

  it('answers 501 not-configured without a coordination store', async () => {
    const home = mkTmp('ccrc-runs-');
    app = await buildServer(testDeps(home));
    const res = await getRuns(app);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });
});

// ── review findings 3/10/27: the write routes are now box-token gated ──────
describe('the coordinator write routes require the box token (review findings 3/10/27)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses POST /api/runs with no token', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postOpen(app, OPEN_BODY, null);
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
    expect(calls).toEqual([]);
    expect(w.coord.runs({ includeClosed: true })).toEqual([]);   // nothing opened
  });

  it('refuses POST /api/runs/:id/dispatch with the WRONG token', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-authfail1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id, { brief: 'x' }, 'wrong-token-wrong-length-000000000000000000000000');
    expect(res.statusCode).toBe(401);
    expect(calls).toEqual([]);
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });

  it('refuses POST /api/runs/:id/close with no token', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postClose(app, opened.id, { fingerprint: {}, final: true }, null);
    expect(res.statusCode).toBe(401);
  });

  it('refuses POST /api/runs/:id/advance with no token', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postAdvance(app, 1, { to: 'working', fingerprint: {} }, null);
    expect(res.statusCode).toBe(401);
  });

  it('refuses GET /api/mail?to= with no token', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await getMail(app, 'some-session', null);
    expect(res.statusCode).toBe(401);
  });

  it('an UNCONFIGURED server (no mailToken at all) fails shut on these routes too', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    app = await buildServer({ ...testDeps(home, run), coord });   // NOTE: no mailToken key at all
    const res = await postOpen(app, OPEN_BODY, TOKEN);   // even the "right-shaped" token is refused
    expect(res.statusCode).toBe(401);
  });
});

describe('dispatch caps the brief the same as /api/mail (review finding 2)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses an oversize brief with 413 before touching the fleet', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-bigbrief'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const hugeBrief = 'a'.repeat(8 * 1024 + 1);
    const res = await postDispatch(app, opened.id, { brief: hugeBrief });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize' });
    expect(calls).toEqual([]);   // refused before ws-add, before anything is counted or spawned
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });

  it('caps what it actually SENDS, not what it was handed: a brief that fits the cap alone but ' +
     'not once the kickoff prefix is composed onto it is refused, with both numbers', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-bigbrief2'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    // EXACTLY the cap: a legal brief (the check is `>`, not `>=`) and an
    // illegal MAIL, because the mail is the prefix plus this. A cap that still
    // measured the raw brief would accept it and queue a body over the very
    // ceiling `/api/mail` refuses — the cost model `envelope.ts` states is the
    // envelope's, and the envelope carries the composed body.
    const brief = 'a'.repeat(MAIL_BODY_MAX_BYTES);
    expect(Buffer.byteLength(brief, 'utf8')).toBe(MAIL_BODY_MAX_BYTES);
    const res = await postDispatch(app, opened.id, { brief });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize', limit: MAIL_BODY_MAX_BYTES });
    // The operator's own arithmetic, in the refusal. "Your 8192-byte brief
    // exceeds the 8192-byte cap" is indistinguishable from a bug — the caps
    // doctrine one describe up ("a cap that refuses without saying what it is")
    // applied to a cap the sender cannot compute from the brief in their hand.
    const { detail } = res.json() as { detail: string };
    expect(detail, 'the refusal never names the brief\'s own size')
      .toContain(String(MAIL_BODY_MAX_BYTES));
    expect(detail, 'the refusal never names what the prefix costs')
      .toContain(String(Buffer.byteLength(WORKER_KICKOFF_PREFIX, 'utf8')));
    expect(calls).toEqual([]);   // still refused before ws-add, before anything is spawned
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });
});

describe('dispatch refuses to /clear a session it can observe is mid-turn (review finding 12)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const seedHookState = (home: string, id: string, over: Record<string, unknown> = {}): void => {
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    const body = { v: 1, state: 'working', sessionId: `u-${id}`, pid: 1, event: null,
      updatedAt: Date.now(), ask: null, subagents: [], ...over };
    writeFileSync(path.join(reg, `${id}.hookstate.json`), JSON.stringify(body));
  };

  it('refuses dispatch with worker-busy when the hookstate says the session is still working', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-busy1');
    seedHookState(home, 'demo-busy1', { state: 'working' });
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-busy1' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'worker-busy' });
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(false);   // /clear never sent
    expect(w.coord.run(opened.id)?.state).toBe('planned');   // dispatch never landed
  });

  it('still proceeds when no hookstate file exists at all — unreadable/absent is not proof of busy', async () => {
    const home = mkTmp('ccrc-runs-');
    seed(home, 'demo-busy2');   // no hookstate file written
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app, { ...OPEN_BODY, wave: 2, sessionId: 'demo-busy2' }))
      .json() as { id: number };
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(200);
    expect(calls.some((c) => c[0] === 'send-keys')).toBe(true);
  });
});

describe('dispatch honours $REG/mail-disabled, not only $REG/coordinator-paused (review finding 17)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('refuses dispatch while mail-disabled exists, before touching the fleet', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-maildisabled'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    writeFileSync(path.join(home, '.cc-sessions', 'mail-disabled'), '');
    const res = await postDispatch(app, opened.id);
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'mail-disabled' });
    expect(calls).toEqual([]);
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });
});

describe('dispatch avoids orphaning a spawned workspace on a failed hold (review finding 7)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a retry after ws-hold fails resumes the ALREADY-SPAWNED workspace instead of spawning a second one', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-orphan1'], fail: new Set(['ws-hold']) });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };

    const first = await postDispatch(app, opened.id);
    expect(first.statusCode).toBe(502);
    // The spawn is already persisted onto the row, even though the hold
    // failed and the transition never landed — the orphan-avoiding fix.
    expect(w.coord.run(opened.id)?.sessionId).toBe('demo-orphan1');
    expect(w.coord.run(opened.id)?.state).toBe('planned');
    expect(calls.filter((c) => c[0] === 'ws-add').length).toBe(1);

    const second = await postDispatch(app, opened.id);
    expect(second.statusCode).toBe(502);   // ws-hold still fails in this fixture
    // Still only ONE ws-add across both attempts — the retry took the
    // resume (`ensure`) branch because `run.sessionId` was already set.
    expect(calls.filter((c) => c[0] === 'ws-add').length).toBe(1);
    expect(calls.filter((c) => c[0] === 'ensure').length).toBe(1);
  });
});

describe('POST /api/runs is idempotent under retry (review findings 19/32)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a retry naming the same (program, wave, claimedBy) reuses the existing planned run', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const first = (await postOpen(app)).json() as { id: number };
    const second = (await postOpen(app)).json() as { id: number };
    expect(second.id).toBe(first.id);
    expect(w.coord.runs({ includeClosed: true }).length).toBe(1);   // never a second row
  });

  it('does NOT reuse a run once it has moved past planned', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-dedupe1'] });
    const w = await openApp(home, run); app = w.app;
    const first = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, first.id);
    const second = (await postOpen(app)).json() as { id: number };
    expect(second.id).not.toBe(first.id);   // the first is dispatched now — a genuinely new open
  });
});

describe('dispatch/close serialise concurrent requests for the same run (review findings 4/11/23/24)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('two dispatch requests fired CONCURRENTLY for the same run never both spawn a workspace', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-race1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };

    const [a, b] = await Promise.all([postDispatch(app, opened.id), postDispatch(app, opened.id)]);
    const codes = [a.statusCode, b.statusCode].sort();
    expect(codes).toEqual([200, 409]);   // exactly one wins, one is refused — never ambiguous-dispatch
    expect(calls.filter((c) => c[0] === 'ws-add').length).toBe(1);
    expect(w.coord.run(opened.id)?.state).toBe('dispatched');
  });

  it('two dispatches for DIFFERENT runs racing a maxConcurrentWorkers=1 cap never both pass the check', async () => {
    const home = mkTmp('ccrc-runs-');
    // A stateful ws-add: exactly ONE new session per call (not `makeRunner`'s
    // own `wsAddCreates`, which seeds its WHOLE list on every single call —
    // right for proving `ambiguous-dispatch`, wrong here, where each of the
    // two runs needs its OWN single-candidate spawn).
    const calls: string[][] = [];
    const ids = ['demo-cap1', 'demo-cap2'];
    let spawnIdx = 0;
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'ws-add') {
        seed(home, ids[spawnIdx]!); spawnIdx++;
        return { code: 0, stdout: '', stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = await openApp(home, run); app = w.app;
    w.coord.setCaps({ maxConcurrentWorkers: 1, maxSessionsPerDay: 12 });
    const a = (await postOpen(app, OPEN_BODY)).json() as { id: number };
    const b = (await postOpen(app, { ...OPEN_BODY, wave: 2 })).json() as { id: number };

    const [ra, rb] = await Promise.all([postDispatch(app, a.id), postDispatch(app, b.id)]);
    const codes = [ra.statusCode, rb.statusCode].sort();
    expect(codes).toEqual([200, 409]);
    expect(calls.filter((c) => c[0] === 'ws-add').length).toBe(1);   // only the winner ever spawned
  });
});

describe('close cancels the run\'s own outstanding mail (review findings 8/14/26)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('a queued/delivered-unacked delivery for the closing run is parked rejected(undeliverable)', async () => {
    const sessionId = `${PROJECT}-mailclose1`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: [sessionId],
      prState: { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'MERGED')])}\n`, stderr: '' } });
    const base = testDeps(home, run);
    const w = await openApp(home, run, { cfg: { ...base.cfg, projectsRoot: root } });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    // A delivery still outstanding for this run's own mail (e.g. a finding
    // the worker never acked), queued directly at the store level — the
    // shape `mail`/`mail_deliveries` always have once `POST /api/mail` or
    // dispatch's own `wave-brief` has run.
    const mail = w.coord.insertMail({ fromId: sessionId, fromUuid: 'u', toId: 'coordinator', runId: opened.id,
      kind: 'finding', subject: 'a finding', body: 'body', artifacts: [] });
    const delivery = w.coord.queueDelivery(mail.id, sessionId, 'envelope text');

    const res = await postClose(app, opened.id, {
      fingerprint: { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP }, final: true,
    });
    expect(res.statusCode).toBe(200);
    const row = w.coord.db.prepare('SELECT state, rejectCode FROM mail_deliveries WHERE id = ?')
      .get(delivery.id) as { state: string; rejectCode: string | null };
    expect(row.state).toBe('rejected');
    expect(row.rejectCode).toBe('undeliverable');
  });
});

describe('close only writes a shape-valid handoffCommit (review findings 6/18)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('an abandon with a non-SHA handoffCommit closes, but the column stays null', async () => {
    const sessionId = `${PROJECT}-badsha1`;
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: [sessionId] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const res = await postClose(app, opened.id, {
      fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: 'n/a' },
      final: true, state: 'failed',
    });
    expect(res.statusCode).toBe(200);
    expect(w.coord.run(opened.id)?.state).toBe('failed');
    expect(w.coord.run(opened.id)?.handoffCommit).toBeNull();   // never a fabricated value
  });

  it('an abandon with a genuinely SHA-shaped handoffCommit DOES record it', async () => {
    const sessionId = `${PROJECT}-goodsha1`;
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: [sessionId] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const res = await postClose(app, opened.id, {
      fingerprint: { branchTip: TIP, prNumber: null, prPhase: 'none', handoffCommit: TIP },
      final: true, state: 'failed',
    });
    expect(res.statusCode).toBe(200);
    expect(w.coord.run(opened.id)?.handoffCommit).toBe(TIP);
  });
});

describe('a retried close does not spam wave-done-rejected mail (review finding 33)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('two identical stale-tip retries queue only ONE outstanding rejection mail', async () => {
    const sessionId = `${PROJECT}-spam1`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, OTHER_TIP);   // the REAL tip has moved
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: [sessionId],
      prState: { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' } });
    const base = testDeps(home, run);
    const w = await openApp(home, run, { cfg: { ...base.cfg, projectsRoot: root } });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const claim = { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP };

    const first = await postClose(app, opened.id, { fingerprint: claim, final: true });
    expect(first.statusCode).toBe(409);
    const second = await postClose(app, opened.id, { fingerprint: claim, final: true });
    expect(second.statusCode).toBe(409);

    const outstanding = w.coord.db.prepare(
      "SELECT count(*) AS c FROM mail m JOIN mail_deliveries d ON d.mailId = m.id " +
      "WHERE m.subject = 'wave-done-rejected' AND d.state IN ('queued','delivered')",
    ).get() as { c: number };
    expect(outstanding.c).toBe(1);
  });
});

describe('POST /api/runs/:id/advance (review findings 1/15)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('answers 404 reject unknown-run for a run id that does not exist', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await postAdvance(app, 4242,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, reject: { code: 'unknown-run' } });
  });

  it('refuses an out-of-scope target (dispatch/close own those transitions)', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-adv1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const res = await postAdvance(app, opened.id,
      { to: 'done', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, reject: { code: 'bad-transition' } });
  });

  it('dispatched -> working never re-measures (no pr-state call) and needs no real fingerprint', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-adv2'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    const callsBefore = calls.length;
    const res = await postAdvance(app, opened.id,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { run: { state: string } }).run.state).toBe('working');
    expect(calls.slice(callsBefore).some((c) => c[0] === 'pr-state')).toBe(false);
    expect(w.coord.run(opened.id)?.state).toBe('working');
  });

  it('working -> awaiting-review DOES re-measure, and a stale claim is refused (D-6)', async () => {
    const sessionId = 'demo-adv3';
    const root = gitRoot(PROJECT, `ws/${sessionId}`, OTHER_TIP);
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: [sessionId],
      prState: { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' } });
    const base = testDeps(home, run);
    const w = await openApp(home, run, { cfg: { ...base.cfg, projectsRoot: root } });
    app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    await postAdvance(app, opened.id,
      { to: 'working', fingerprint: { branchTip: '', prNumber: null, prPhase: 'none', handoffCommit: '' } });

    const staleRes = await postAdvance(app, opened.id,
      { to: 'awaiting-review', fingerprint: { branchTip: TIP, prNumber: 7, prPhase: 'open', handoffCommit: TIP } });
    expect(staleRes.statusCode).toBe(409);
    expect(staleRes.json()).toMatchObject({ ok: false, reject: { code: 'stale-tip' } });
    expect(w.coord.run(opened.id)?.state).toBe('working');   // unchanged

    const goodRes = await postAdvance(app, opened.id,
      { to: 'awaiting-review', fingerprint: { branchTip: OTHER_TIP, prNumber: 7, prPhase: 'open', handoffCommit: OTHER_TIP } });
    expect(goodRes.statusCode).toBe(200);
    expect(w.coord.run(opened.id)?.state).toBe('awaiting-review');
  });
});

describe('GET /api/mail?to= (review findings 1/15)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('returns the wave-brief mail queued for the dispatched session', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { wsAddCreates: ['demo-getmail1'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id, { brief: 'implement the thing' });

    const res = await getMail(app, 'demo-getmail1');
    expect(res.statusCode).toBe(200);
    const { mail } = res.json() as { mail: { subject: string; toId: string; kind: string }[] };
    expect(mail.length).toBe(1);
    expect(mail[0]).toMatchObject({ subject: 'wave-brief', toId: 'demo-getmail1', kind: 'status' });
  });

  it('refuses a missing ?to= with 400', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/mail', headers: { 'x-ccrc-mail-token': TOKEN } });
    expect(res.statusCode).toBe(400);
  });

  // Test gap, I5 (measured): reverting this route to `mailForRecipient` left
  // 194 tests green — nothing in the tree pinned the DEFAULT read as
  // outstanding-only rather than full history. Four rows, four different
  // fates: `queued` (in either read), `acked` (default-excluded, `?all=1`-
  // included), a replay-ceiling park on a run that is STILL LIVE
  // (default-included — orchestrator ruling I2's own "no path to clear it"
  // failure mode, still outstanding until acked or its run closes), and the
  // identical park on a run that has since closed (default-excluded by I2(a)'s
  // derivation, `?all=1`-included regardless — history is history).
  it('answers outstanding-only by DEFAULT — acked and a parked-with-closed-run row excluded, a parked-with-LIVE-run row included; ?all=1 answers full history (test gap, I5)', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    seed(home, 'demo-getmail2');
    const toId = 'demo-getmail2';

    const queueTo = (subject: string, runId: number | null): number => {
      const mail = w.coord.insertMail({ fromId: 'coordinator', fromUuid: 'u1', toId, runId,
        kind: 'status', subject, body: 'b', artifacts: [] });
      return w.coord.queueDelivery(mail.id, toId, `<mail>${subject}</mail>`).id;
    };

    const queuedId = queueTo('still queued', null);

    const ackedId = queueTo('acked', null);
    w.coord.markDelivered(ackedId, Date.now());
    w.coord.markAcked(ackedId, Date.now());

    const liveRun = w.coord.openRun({ program: 'p-live', title: 'live', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: CLAIMED_BY }) as { id: number };
    const abandonedLiveId = queueTo('abandoned, run still live', liveRun.id);
    w.coord.rejectDelivery(abandonedLiveId, 'undeliverable', 'replayed without ack past the replay ceiling');

    const closedRun = w.coord.openRun({ program: 'p-closed', title: 'closed', project: PROJECT,
      wave: 1, waveOf: 1, claimedBy: CLAIMED_BY }) as { id: number };
    const abandonedClosedId = queueTo('abandoned, run now closed', closedRun.id);
    w.coord.rejectDelivery(abandonedClosedId, 'undeliverable', 'replayed without ack past the replay ceiling');
    w.coord.advance(closedRun.id, 'failed', 'coordinator');   // planned -> failed directly

    const byDefault = await getMail(app, toId);
    expect(byDefault.statusCode).toBe(200);
    const defaultIds = (byDefault.json() as { mail: { id: number }[] }).mail
      .map((m) => m.id).sort((a, b) => a - b);
    expect(defaultIds).toEqual([queuedId, abandonedLiveId].sort((a, b) => a - b));

    const everything = await getMail(app, toId, TOKEN, '&all=1');
    expect(everything.statusCode).toBe(200);
    const allIds = (everything.json() as { mail: { id: number }[] }).mail
      .map((m) => m.id).sort((a, b) => a - b);
    expect(allIds).toEqual(
      [queuedId, ackedId, abandonedLiveId, abandonedClosedId].sort((a, b) => a - b),
    );
  });
});

// ── Build 4, Task 1: the dispatch body declares the ledger ──────────────────
// Spec §3.1 and D-277 (was D-B4-4). The BRIEF stays opaque prose parsed by nothing; the
// coordinator declares the item titles beside it, as a structured field, and
// the whole dispatch commit — `markDispatched`, `setClearedAt`, the transition
// and the item INSERTs — becomes ONE transaction.

/** The rows themselves, in insertion order. Read through raw SQL rather than
 *  through a store method on purpose: this suite is Task 1's, and pinning the
 *  INSERTs against the TABLE keeps the assertion honest if a later task
 *  reshapes the reader (`CoordStore.workItems`, Task 2) that would otherwise
 *  sit between the test and the fact. */
const itemRows = (coord: CoordStore, runId: number) =>
  coord.db.prepare('SELECT id, title, state, claimedBy, blockedBy FROM work_items WHERE runId = ? ORDER BY id')
    .all(runId) as { id: number; title: string; state: string; claimedBy: string | null; blockedBy: string }[];

describe('POST /api/runs/:id/dispatch — the declared ledger (spec §3.1)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('inserts one pending work item per title, in body order', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id,
      { brief: 'do the thing', items: ['write the reader', 'review it', 'ship it'] });
    expect(res.statusCode).toBe(200);
    const rows = itemRows(w.coord, opened.id);
    expect(rows.map((r) => r.title)).toEqual(['write the reader', 'review it', 'ship it']);
    expect(rows.every((r) => r.state === 'pending')).toBe(true);
    expect(rows.every((r) => r.claimedBy === null)).toBe(true);
    expect(rows.every((r) => r.blockedBy === '[]')).toBe(true);
    expect(w.coord.itemTally(opened.id)).toEqual({ done: 0, total: 3 });
  });

  it('treats an absent items field and [] identically: the run has no declared ledger', async () => {
    // One fixture per dispatch, deliberately: the runner's `ws-add` fabricates
    // a FIXED id, so two successful wave-1 spawns inside one registry are two
    // spawns of the same id — `ambiguous-dispatch`, a fact about the fixture
    // rather than about `items`.
    const dispatched = async (body: unknown) => {
      const home = mkTmp('ccrc-runs-');
      const { run } = makeRunner(home);
      const w = await openApp(home, run);
      try {
        const opened = (await postOpen(w.app)).json() as { id: number };
        expect((await postDispatch(w.app, opened.id, body)).statusCode).toBe(200);
        return { tally: w.coord.itemTally(opened.id), rows: itemRows(w.coord, opened.id) };
      } finally {
        await w.app.close();
      }
    };
    expect(await dispatched({ brief: 'no ledger' })).toEqual({ tally: { done: 0, total: 0 }, rows: [] });
    expect(await dispatched({ brief: 'no ledger', items: [] }))
      .toEqual({ tally: { done: 0, total: 0 }, rows: [] });
  });

  it('refuses bad-request on a non-array, a non-string entry, or an empty/whitespace title', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    for (const items of ['write it', 42, {}, ['ok', 7], ['ok', null], ['ok', ''], ['ok', '   ']]) {
      const res = await postDispatch(app, opened.id, { brief: 'do the thing', items });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
    }
    // A malformed body is the cheapest refusal and D-46's ordering rule puts
    // it first: nothing spawned, nothing held, the run untouched.
    expect(calls).toEqual([]);
    expect(w.coord.run(opened.id)?.state).toBe('planned');
    expect(itemRows(w.coord, opened.id)).toEqual([]);
  });

  it('refuses bad-request past WORK_ITEM_MAX entries, and accepts exactly WORK_ITEM_MAX', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const over = (await postOpen(app)).json() as { id: number };
    const titles = (n: number) => Array.from({ length: n }, (_, i) => `item ${i + 1}`);
    const refused = await postDispatch(app, over.id,
      { brief: 'do the thing', items: titles(WORK_ITEM_MAX + 1) });
    expect(refused.statusCode).toBe(400);
    expect(itemRows(w.coord, over.id)).toEqual([]);
    // The ACCEPT half is what kills the `>` -> `>=` mutant: a refusal at 33
    // alone reads identically under both bounds.
    const at = (await postOpen(app, { ...OPEN_BODY, wave: 2 })).json() as { id: number };
    const ok = await postDispatch(app, at.id, { brief: 'do the thing', items: titles(WORK_ITEM_MAX) });
    expect(ok.statusCode).toBe(200);
    expect(w.coord.itemTally(at.id)).toEqual({ done: 0, total: WORK_ITEM_MAX });
  });

  it('refuses bad-request on a title over WORK_ITEM_TITLE_MAX BYTES, measured in utf-8', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const over = (await postOpen(app)).json() as { id: number };
    // 101 characters, 202 BYTES: under the cap read as a string length, over
    // it read as UTF-8 — the one fixture that can tell `Buffer.byteLength`
    // from `.length`.
    const multibyte = 'é'.repeat(101);
    expect(multibyte.length).toBeLessThanOrEqual(WORK_ITEM_TITLE_MAX);
    expect(Buffer.byteLength(multibyte, 'utf8')).toBeGreaterThan(WORK_ITEM_TITLE_MAX);
    const refused = await postDispatch(app, over.id, { brief: 'do the thing', items: [multibyte] });
    expect(refused.statusCode).toBe(400);
    expect(itemRows(w.coord, over.id)).toEqual([]);
    // Exactly at the cap is legal — the boundary is `>`, not `>=`.
    const at = (await postOpen(app, { ...OPEN_BODY, wave: 2 })).json() as { id: number };
    const exact = 'a'.repeat(WORK_ITEM_TITLE_MAX);
    expect((await postDispatch(app, at.id, { brief: 'do the thing', items: [exact] })).statusCode).toBe(200);
    expect(itemRows(w.coord, at.id).map((r) => r.title)).toEqual([exact]);
  });

  it('leaves NO work_items rows behind when the transition is refused', async () => {
    // D-277, at the store: the items are inserted AFTER the transition and
    // inside its own transaction, so a refused `advanceInner` returns before
    // any INSERT runs. Driven through `CoordStore.dispatchRun` directly
    // because the route can no longer reach this arm — `dispatchRun`'s own
    // precondition (`run.state !== 'planned'`) answers first, behind
    // `CoordMutex`; the store method is what must hold the line anyway.
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    expect(w.coord.advance(opened.id, 'dispatched', 'coordinator')).toMatchObject({ ok: true });

    const adv = w.coord.dispatchRun({ runId: opened.id, sessionId: 'demo-x', workspace: 'demo-x',
      branch: 'ws/demo-x', resumed: false, clearedAt: null, items: ['one', 'two'] });
    expect(adv).toMatchObject({ ok: false, error: 'bad-transition', from: 'dispatched', to: 'dispatched' });
    expect(itemRows(w.coord, opened.id)).toEqual([]);
  });

  it('rolls the WHOLE dispatch back when an item INSERT throws — one transaction, not four', async () => {
    // The `split dispatchRun back into three tx()s` mutant: a refused
    // transition cannot discriminate it (both shapes return before any
    // INSERT), and neither can a failed hold (it runs two steps earlier). A
    // THROW inside the item loop is what tells them apart — one transaction
    // rolls `markDispatched` and the `dispatched` state back with the rows;
    // four independent ones leave a dispatched run carrying half a ledger.
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const real = w.coord.addWorkItem.bind(w.coord);
    let n = 0;
    w.coord.addWorkItem = (runId, title, blockedBy) => {
      if (++n === 2) throw new Error('disk full mid-ledger');
      return real(runId, title, blockedBy);
    };
    try {
      expect(() => w.coord.dispatchRun({ runId: opened.id, sessionId: 'demo-x', workspace: 'demo-x',
        branch: 'ws/demo-x', resumed: false, clearedAt: 123, items: ['one', 'two', 'three'] }))
        .toThrow('disk full mid-ledger');
    } finally {
      w.coord.addWorkItem = real;
    }
    const row = w.coord.run(opened.id);
    expect(row).toMatchObject({ state: 'planned', sessionId: null, workspace: null, branch: null,
      clearedAt: null });
    expect(itemRows(w.coord, opened.id)).toEqual([]);
    expect(w.coord.runEvents(opened.id)).toEqual([]);
  });

  it('leaves NO work_items rows behind when the hold fails 502 before the commit', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home, { fail: new Set(['ws-hold']) });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const res = await postDispatch(app, opened.id, { brief: 'do the thing', items: ['one', 'two'] });
    expect(res.statusCode).toBe(502);
    expect(itemRows(w.coord, opened.id)).toEqual([]);
    expect(w.coord.run(opened.id)?.state).toBe('planned');
  });

  it('needs no dedupe key: RUN_TRANSITIONS.dispatched has no self-edge, so a second dispatch 409s', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run } = makeRunner(home);
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    const first = await postDispatch(app, opened.id, { brief: 'do the thing', items: ['one', 'two'] });
    expect(first.statusCode).toBe(200);
    const second = await postDispatch(app, opened.id, { brief: 'do the thing', items: ['one', 'two'] });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, error: 'bad-transition' });
    // The ledger is fixed at dispatch: still two rows, not four.
    expect(itemRows(w.coord, opened.id).map((r) => r.title)).toEqual(['one', 'two']);
  });
});

describe('the hold reason', () => {
  it('the reason names its run, and NOTHING in the tree parses one back', () => {
    // DISPLAY-ONLY. `run:` exists so a human reading ~/.cc-sessions can answer
    // "whose claim is this?" from the box alone — which they could not during
    // the F9 incident. Run-awareness itself comes from coord.db
    // (`openRunsForSession`), never from this string.
    expect(holdReason('build4', 2, 3, 17)).toBe('program:build4 wave:2/3 run:17');
    expect(holdReason('build4', 2, null, 17)).toBe('program:build4 wave:2 run:17');
    // A HAND hold has no run: no suffix, so the PWA composer's placeholder
    // `program:name wave:2/4` is still a truthful example.
    expect(holdReason('build4', 2, 3, null)).toBe('program:build4 wave:2/3');

    // The negative half, scanned over the two rings that could plausibly
    // acquire a parser. A `.split('run:')`, a `/run:(\d+)/`, a
    // `new RegExp('run:(\\d+)')`, a `startsWith('program:')` — any of them
    // turns a display string into a protocol. The capture alternative does
    // NOT require a leading `/`, so a RegExp built from a STRING is caught
    // too; and `'program:'` as a whole quoted token is caught, while
    // `"program:name wave:2/4"` (the composer's placeholder, a prose example)
    // is not, because the quote must close immediately after the colon.
    for (const dir of [path.join(repoRoot, 'server', 'src'), path.join(repoRoot, 'pwa', 'src')]) {
      for (const f of sourcesUnder(dir)) {
        const src = readFileSync(f, 'utf8');
        expect(/['"`](?:run|program):['"`]|run:\\?\(/.test(src.replace(/^\s*\/\/.*$/gm, '')),
          `${f} looks like it parses a hold reason`).toBe(false);
      }
    }
  });
});
