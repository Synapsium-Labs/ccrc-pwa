// Task 9: open, dispatch (caps + pause + D-1's resume/clear), close (D-5's
// release, never an autonomous archive). Zero new ccd verbs — every argv this
// file proves gets exercised is one of the five `whitelist-subset.test.ts`
// already enumerates; that suite (run unchanged, Step 4) is the proof this
// task added none.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const PROJECT = 'demo';
const CLAIMED_BY = 'ccrc-pwa-coordinator';

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
  const app = await buildServer({ ...base, coord, ...over, cfg: { ...base.cfg, ...(over.cfg ?? {}) } });
  return { app, coord };
};

const postOpen = (app: FastifyInstance, body: unknown = OPEN_BODY) =>
  app.inject({ method: 'POST', url: '/api/runs', payload: body as Record<string, unknown> });
const postDispatch = (app: FastifyInstance, id: number, body: unknown = { brief: 'do the thing' }) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/dispatch`, payload: body as Record<string, unknown> });
const postClose = (app: FastifyInstance, id: number, body: unknown) =>
  app.inject({ method: 'POST', url: `/api/runs/${id}/close`, payload: body as Record<string, unknown> });
const getRuns = (app: FastifyInstance, closed = false) =>
  app.inject({ method: 'GET', url: `/api/runs${closed ? '?closed=1' : ''}` });

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
      ['ws-hold', '--session', 'demo-existing', '--reason', 'program:build4 wave:2/3']);
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
    expect(calls.some((c) => c[0] === 'ws-add' && c[1] === PROJECT)).toBe(true);
    expect(calls.some((c) => c[0] === 'ensure')).toBe(false);
    const row = w.coord.run(opened.id);
    expect(row).toMatchObject({ sessionId: 'demo-fresh1', workspace: 'demo-fresh1', branch: 'ws/demo-fresh1',
      resumed: false, clearedAt: null, state: 'dispatched' });
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

  it('places the hold with the convention reason, and never parses one back', async () => {
    const home = mkTmp('ccrc-runs-');
    const { run, calls } = makeRunner(home, { wsAddCreates: ['demo-fresh2'] });
    const w = await openApp(home, run); app = w.app;
    const opened = (await postOpen(app)).json() as { id: number };
    await postDispatch(app, opened.id);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', 'demo-fresh2', '--reason', 'program:build4 wave:1/3']);
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
    const unreadablePrhistory: FleetIO = {
      ...localIO, readFile: async (p) => (p.endsWith('.prhistory') ? null : localIO.readFile(p)),
    };
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
    expect(coord.run(id)!.state).toBe('done');
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', 'program:build4 wave:2/3']);
    expect(calls.some((c) => c[0] === 'ws-release')).toBe(false);
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

  it('answers 501 when the fleet ccd does not support ws-release, and the run stays RETRYABLE — ' +
     'not wedged done with the hold silently un-released (D-48)', async () => {
    const sessionId = `${PROJECT}-close7`;
    const root = gitRoot(PROJECT, `ws/${sessionId}`, TIP);
    const { id, coord } = await dispatchedRun(sessionId, root,
      { code: 0, stdout: `${ccdLine(sessionId, `ws/${sessionId}`, [prRow(`ws/${sessionId}`, 'OPEN')])}\n`, stderr: '' },
      // `pr-state` stays supported — `verifyDone` has its OWN `verbSupported`
      // gate (`fingerprint.ts`) and must succeed here, so the 501 this test
      // proves is close's own fleet-act gate, not a verifyDone side effect.
      { fleetState: { connected: true, downSince: null, ccdVerbs: ['ws-add', 'ensure', 'ws-hold', 'pr-state'] } });
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
