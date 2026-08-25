// `POST /api/runs/:id/abandon` — the operator's release valve for a wedged
// run, and the negative pins that keep it one.
//
// It calls the SAME L1 decision function as `POST .../close` (`closeRun`), as
// ONE contiguous arm entered before any of the ordinary close's own body
// validation (D-290 (was D-B4-17)). Most of this file asserts ABSENCES — no fingerprint, no
// `.prhistory` read, no `verifyDone`, no `ws-archive`, no `not-dispatched` —
// and each of those is true because the call is absent from the arm, not
// because a flag skipped it. A later edit that folds any of them back in fails
// here rather than on a phone.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { closeRun, type CloseRunDeps } from '../src/coord/close.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { RunState } from '../../shared/api.js';

const PROJECT = 'demo';
const TOKEN = 'f'.repeat(64);
const CLAIMED_BY = 'ccrc-pwa-coordinator';

const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

interface RunnerCfg { fail?: ReadonlySet<string> }

const makeRunner = (cfg: RunnerCfg = {}): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => {
    calls.push(args);
    const verb = args[0] ?? '';
    if (cfg.fail?.has(verb)) return { code: 1, stdout: '', stderr: `${verb} failed on the box` };
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

const openApp = async (home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

/** A run parked in `state`, with or without a session. `planned` + no session
 *  is the `ambiguous-dispatch` wedge this whole route exists for. */
const wedged = (
  coord: CoordStore, home: string, state: RunState, sessionId: string | null, program = 'build4',
): number => {
  const opened = coord.openRun({
    program, title: 'Fleet controls', project: PROJECT, wave: 1, waveOf: 3, claimedBy: CLAIMED_BY,
  });
  // `openRun` answers a UNION — it can refuse (a second coordinator) — so the
  // id is narrowed rather than destructured off the refusal shape, exactly as
  // `coord-decide.test.ts` does.
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  const { id } = opened;
  if (sessionId !== null) {
    seed(home, sessionId);
    if (state === 'planned') coord.setSession(id, sessionId);
    else coord.markDispatched(id, sessionId, sessionId, `ws/${sessionId}`, false);
  }
  if (state !== 'planned') {
    // `markDispatched` writes the binding, never the state — `advance` is the
    // only writer of `runs.state` (`store.ts`'s own docstring), so the walk
    // starts at `dispatched` rather than assuming it.
    for (const to of ['dispatched', 'working', 'awaiting-review', 'merging'] as const satisfies readonly RunState[]) {
      if (coord.run(id)!.state === state) break;
      const adv = coord.advance(id, to, 'coordinator');
      if (!adv.ok) throw new Error(`fixture could not reach ${state}: ${JSON.stringify(adv)}`);
    }
  }
  return id;
};

/** A SECOND open run naming the same session — the state the coordinator
 *  protocol deliberately creates (open wave N+1 BEFORE closing wave N) and
 *  which no fixture in this tree had before Wave 2. */
const sibling = (coord: CoordStore, sessionId: string, wave: number, program = 'build4'): number => {
  const opened = coord.openRun({
    program, title: 'Fleet controls', project: PROJECT, wave, waveOf: 3, claimedBy: CLAIMED_BY,
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  coord.setSession(opened.id, sessionId);
  return opened.id;
};

const postAbandon = (app: FastifyInstance, id: number, payload?: unknown) =>
  app.inject({
    method: 'POST', url: `/api/runs/${id}/abandon`,
    ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
  });

describe('POST /api/runs/:id/abandon', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('planned with NO session: no fleet act at all, planned → failed', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'planned', null);

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, id, state: 'failed' });
    expect(w.coord.run(id)!.state).toBe('failed');
    // Nothing to release: a `planned` run that never dispatched holds no
    // workspace, so the ccd call is ABSENT, not merely tolerated-if-it-fails.
    expect(calls).toEqual([]);
    // …and no `closing` hop was invented on the way (D-281 (was D-B4-8)): the table's own
    // `planned → failed` edge was used, and `RUN_TRANSITIONS` is untouched.
    expect(w.coord.runEvents(id).map((e) => [e.fromState, e.toState]))
      .toEqual([['planned', 'failed']]);
  });

  it('planned WITH a session (a wave≥2 reclaim, D-45): ws-release, then planned → failed', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'planned', `${PROJECT}-reclaim`);

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-release', '--session', `${PROJECT}-reclaim`]);
    expect(w.coord.run(id)!.state).toBe('failed');
    expect(w.coord.runEvents(id).map((e) => e.toState)).toEqual(['failed']);
  });

  it.each(['dispatched', 'working', 'awaiting-review', 'merging'] as const)(
    '%s: ws-release, then → closing → failed', async (state) => {
      const home = mkTmp('ccrc-abandon-');
      const { run, calls } = makeRunner();
      const w = await openApp(home, run); app = w.app;
      const sessionId = `${PROJECT}-${state}`;
      const id = wedged(w.coord, home, state, sessionId);

      const res = await postAbandon(app, id);
      expect(res.statusCode).toBe(200);
      expect(calls).toContainEqual(['ws-release', '--session', sessionId]);
      expect(w.coord.run(id)!.state).toBe('failed');
      const hops = w.coord.runEvents(id).map((e) => e.toState);
      expect(hops.slice(-2)).toEqual(['closing', 'failed']);
    });

  it('done or failed: 409 bad-transition, carrying `from` so the phone can say "already closed"', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'planned', null);
    await postAbandon(app, id);                       // now `failed`
    const callsAfterFirst = calls.length;

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(409);
    // `from` is what the phone renders ("this run already closed"); `to` is the
    // hop the arm would have taken, which for anything that is not `planned` is
    // the ordinary `closing` one.
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-transition', from: 'failed', to: 'closing' });
    // The refusal is read-only: the second attempt never touched the fleet.
    expect(calls.length).toBe(callsAfterFirst);
  });

  it('404 unknown-run', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await postAbandon(app, 4242);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-run' });
  });

  it('501 when the fleet ccd does not support ws-release', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run, {
      fleetState: { connected: true, downSince: null, ccdVerbs: ['start', 'ensure'], rosterFp: null, build: null },
    }); app = w.app;
    const id = wedged(w.coord, home, 'dispatched', `${PROJECT}-old-agent`);

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'unsupported' });
    expect(calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    // D-48: the fleet act is ahead of the commit, so a refusal leaves the run
    // exactly where it was — retryable, never wedged terminal.
    expect(w.coord.run(id)!.state).toBe('dispatched');
  });

  it('502 with stderr, leaving the run RETRYABLE — the fleet act stays ahead of the commit (D-48)', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner({ fail: new Set(['ws-release']) });
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'working', `${PROJECT}-stuck`);

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(502);
    expect(res.json()).toMatchObject({ ok: false, stderr: 'ws-release failed on the box' });
    expect(w.coord.run(id)!.state).toBe('working');
    expect(w.coord.run(id)!.closedAt).toBeNull();
  });

  it('records causedBy=operator in run_events, never coordinator', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'dispatched', `${PROJECT}-attrib`);

    await postAbandon(app, id);
    const closing = w.coord.runEvents(id).filter((e) => e.toState === 'closing' || e.toState === 'failed');
    expect(closing.length).toBeGreaterThan(0);
    expect(closing.every((e) => e.causedBy === 'operator')).toBe(true);
  });

  it('writes handoffCommit null', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'dispatched', `${PROJECT}-nohandoff`);

    await postAbandon(app, id);
    // An abandon carries no claim, so there is nothing to write — exactly what
    // the existing `HANDOFF_SHA` guard would have produced anyway (D-274 (was D-B4-1)).
    expect(w.coord.run(id)!.handoffCommit).toBeNull();
  });

  it("cancels the run's own outstanding deliveries and retires the program when it was the last run", async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-mail`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const mail = w.coord.insertMail({
      fromId: CLAIMED_BY, fromUuid: 'u', toId: sessionId, runId: id,
      kind: 'status', subject: 'wave-brief', body: 'do the thing', artifacts: [],
    });
    const delivery = w.coord.queueDelivery(mail.id, sessionId, 'envelope');

    await postAbandon(app, id);
    expect(w.coord.delivery(delivery.id)!.state).toBe('rejected');
    expect(w.coord.programs().find((p) => p.slug === 'build4')!.state).toBe('abandoned');
  });

  // — the negative pins (spec §6) —

  it('CANNOT reach ws-archive: the route never reads req.body, so archive:true is not a field', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'dispatched', `${PROJECT}-noarchive`);

    // The body a caller WISHES were honoured — a close-shaped one, carrying the
    // one flag that destroys a worktree. D-280 (was D-B4-7): the route constructs
    // `{intent:'abandon'}` itself, so this is not a field that exists here.
    const res = await postAbandon(app, id, {
      intent: 'abandon', archive: true, state: 'failed', final: true,
      fingerprint: { branchTip: 'a'.repeat(40), prNumber: null, prPhase: 'none', handoffCommit: 'b'.repeat(40) },
    });
    expect(res.statusCode).toBe(200);
    expect(calls.map((c) => c[0])).not.toContain('ws-archive');
    expect(calls).toContainEqual(['ws-release', '--session', `${PROJECT}-noarchive`]);
  });

  it('never calls verifyDone — the five done-authority codes are unreachable here', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    // THE PIN IS "NO I/O AT ALL", not "no pr-state" — measured, in this wave's
    // own mutation sweep. A `verifyDone` folded into the abandon arm answers
    // `tip-unmeasurable` off a fixture with no git repo and returns BEFORE its
    // `ccd pr-state` call, so a pr-state-only pin watched the mutant walk past
    // it. What `verifyDone` cannot avoid is reading: it lists the registry
    // (`readRegistryMeasured`) and reads git's own ref files (`gitref.ts`)
    // before it can answer anything except the cheap claim-shape refusal — and
    // the abandon arm touches `deps.io` not once.
    const reads: string[] = [];
    let recording = false;
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => { if (recording) reads.push(p); return localIO.readFileMeasured(p); },
      readdir: async (p) => { if (recording) reads.push(p); return localIO.readdir(p); },
    };
    const w = await openApp(home, run, { io }); app = w.app;
    const id = wedged(w.coord, home, 'dispatched', `${PROJECT}-noverify`);

    recording = true;
    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    expect(reads).toEqual([]);
    expect(calls.map((c) => c[0])).not.toContain('pr-state');
    expect(res.json()).not.toMatchObject({ error: 'stale-tip' });
  });

  it('never reads .prhistory — prhistory-unreadable is unreachable here', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const sessionId = `${PROJECT}-badledger`;
    // A ledger that CANNOT be read: the ordinary close refuses on exactly this
    // (`prhistory-unreadable`), which would disable the abandon in precisely
    // the broken-box case it exists for (D-275 (was D-B4-2)).
    const reads: string[] = [];
    const io: FleetIO = {
      ...localIO,
      readFileMeasured: async (p) => {
        if (p.endsWith('.prhistory')) { reads.push(p); return { ok: false, reason: 'unreadable' }; }
        return localIO.readFileMeasured(p);
      },
    };
    const home2 = home;
    const w = await openApp(home2, run, { io }); app = w.app;
    const id = wedged(w.coord, home2, 'merging', sessionId);
    writeFileSync(path.join(home2, '.cc-sessions', `${sessionId}.prhistory`), 'not json\n');

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toMatchObject({ refused: 'prhistory-unreadable' });
    // Not merely "it tolerated an unreadable ledger": it never opened one.
    expect(reads).toEqual([]);
    expect(w.coord.run(id)!.prLineage).toEqual([]);
  });

  it('never answers not-dispatched on this path', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    // The exact shape the ordinary close refuses with `not-dispatched`, and the
    // exact wedge this route exists for. If the abandon arm ever slid below
    // that guard, this is the test that says so.
    const id = wedged(w.coord, home, 'planned', null);
    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    expect(res.json()).not.toMatchObject({ refused: 'not-dispatched' });
  });

  it('never answers bad-request for a MISSING fingerprint — that block is not on this path', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = wedged(w.coord, home, 'dispatched', `${PROJECT}-nofp`);
    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
  });

  it('abandoning ONE of two open runs re-holds with the SIBLING reason — it does not release', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-two`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const other = sibling(w.coord, sessionId, 2);

    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(200);
    // The abandoned run still transitions — the workspace just stays claimed.
    expect(res.json()).toMatchObject({ ok: true, state: 'failed', released: false });
    expect(w.coord.run(id)!.state).toBe('failed');
    expect(calls.filter((c) => c[0] === 'ws-release')).toEqual([]);
    expect(calls).toContainEqual(
      ['ws-hold', '--session', sessionId, '--reason', `program:build4 wave:2/3 run:${other}`]);
  });

  it('with no sibling it still releases, and says so', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-lone`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const res = await postAbandon(app, id);
    expect(res.json()).toMatchObject({ ok: true, released: true });
    expect(calls).toContainEqual(['ws-release', '--session', sessionId]);
  });

  it('a CLOSED sibling is not a sibling — a done run cannot keep a workspace claimed forever', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run, calls } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-closedsib`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    const other = sibling(w.coord, sessionId, 2);
    w.coord.advance(other, 'dispatched', 'coordinator');
    w.coord.advance(other, 'closing', 'coordinator');
    w.coord.advance(other, 'done', 'coordinator');
    const res = await postAbandon(app, id);
    expect(res.json()).toMatchObject({ ok: true, released: true });
    expect(calls).toContainEqual(['ws-release', '--session', sessionId]);
  });

  it('a FAILED re-hold leaves the run RETRYABLE — the fleet act stays ahead of the commit (D-48)', async () => {
    const home = mkTmp('ccrc-abandon-');
    const { run } = makeRunner({ fail: new Set(['ws-hold']) });
    const w = await openApp(home, run); app = w.app;
    const sessionId = `${PROJECT}-rehold-fail`;
    const id = wedged(w.coord, home, 'dispatched', sessionId);
    sibling(w.coord, sessionId, 2);
    const res = await postAbandon(app, id);
    expect(res.statusCode).toBe(502);
    expect(w.coord.run(id)!.state).toBe('dispatched');   // UNCHANGED
  });
});

describe("closeRun's abandon arm, called directly", () => {
  const build = async () => {
    const home = mkTmp('ccrc-abandon-unit-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const { run, calls } = makeRunner();
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const base = testDeps(home, run);
    const deps: CloseRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd };
    return { home, coord, deps, calls };
  };

  it('accepts the bare {intent:"abandon"} body and answers ok — no fingerprint, no final', async () => {
    const { home, coord, deps } = await build();
    const id = wedged(coord, home, 'dispatched', `${PROJECT}-unit1`);
    // `released: true` — this fixture opens exactly one run, so nothing else
    // claims the workspace and the abandon genuinely ends the claim. The
    // assertion stays `toEqual` (not `toMatchObject`) deliberately: it is the
    // one place the WHOLE ok-arm shape is pinned, so a silently-added field
    // reds here rather than reaching a client that never learns to read it.
    expect(await closeRun(deps, id, { intent: 'abandon' }, 'operator'))
      .toEqual({ ok: true, id, state: 'failed', released: true });
  });

  it('refuses bad-request for {intent:"abandon", archive:true} — a mixed shape is not a shape', async () => {
    const { home, coord, deps, calls } = await build();
    const id = wedged(coord, home, 'dispatched', `${PROJECT}-unit2`);
    expect(await closeRun(deps, id, { intent: 'abandon', archive: true }, 'operator'))
      .toEqual({ ok: false, kind: 'bad-request' });
    // Refused BEFORE any act: a caller that has confused two acts gets an
    // answer, not half of one.
    expect(calls).toEqual([]);
    expect(coord.run(id)!.state).toBe('dispatched');
  });

  it('refuses bad-request for {intent:"abandon", fingerprint:{…}} likewise', async () => {
    const { home, coord, deps } = await build();
    const id = wedged(coord, home, 'dispatched', `${PROJECT}-unit3`);
    const body = {
      intent: 'abandon',
      fingerprint: { branchTip: 'a'.repeat(40), prNumber: null, prPhase: 'none', handoffCommit: 'b'.repeat(40) },
    };
    expect(await closeRun(deps, id, body, 'operator')).toEqual({ ok: false, kind: 'bad-request' });
    // …and `final`/`state` are refused on the same rule.
    expect(await closeRun(deps, id, { intent: 'abandon', final: true }, 'operator'))
      .toEqual({ ok: false, kind: 'bad-request' });
    expect(await closeRun(deps, id, { intent: 'abandon', state: 'failed' }, 'operator'))
      .toEqual({ ok: false, kind: 'bad-request' });
  });

  it('still demands the full fingerprint on the ORDINARY close path', async () => {
    const { home, coord, deps } = await build();
    const id = wedged(coord, home, 'dispatched', `${PROJECT}-unit4`);
    expect(await closeRun(deps, id, {}, 'coordinator')).toEqual({ ok: false, kind: 'bad-request' });
  });

  it('still answers not-dispatched on the ORDINARY path for a run with no session', async () => {
    const { home, coord, deps } = await build();
    const id = wedged(coord, home, 'planned', null);
    expect(await closeRun(deps, id, { fingerprint: {}, final: true }, 'coordinator'))
      .toEqual({ ok: false, kind: 'refused', code: 'not-dispatched' });
  });
});
