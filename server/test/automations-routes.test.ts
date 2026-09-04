// Task 9 (docs: .superpowers/sdd/2026-08-31-automations/task-9-brief.md, spec
// §10): the ten `auto/routes.ts` routes, behind the session gate the sweep
// can see (`auth-gate.test.ts`), never the box token
// (`requireMailToken`/`x-ccrc-mail-token`), with D-280's structural
// literal-at-call-site guarantee for *Run now*.
//
// `auth-gate.test.ts` already proves EVERY one of these ten routes answers
// `401 no-session` with no cookie — that is not repeated here. This file
// runs with `CCRC_AUTH` DARK (the `testDeps` default), `kickoff-route.test
// .ts`'s own posture, so each fixture below is free to focus on the route's
// OWN behaviour rather than re-proving the gate.
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { mkTmp } from './tmpHelpers.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { AUTOMATION_PROMPT_MAX_BYTES, AUTOMATION_RUN_RETENTION } from '../../shared/api.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const serverRoot = path.resolve(here, '..');

const PROJECT = 'demo';

const WALL_CLOCK = { kind: 'wall-clock', days: 0b1111111, minuteOfDay: 540, tz: 'UTC' };

/** One registry row on disk — `dispatch-adopt.test.ts:36-51`'s shape. */
const seedRow = (home: string, id: string, project = PROJECT): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/**
 * A `Runner` that answers BOTH `ws-add` (seeding exactly one new registry
 * row for `project`, the identify-by-diff target) and `capture-pane` (an
 * empty->echoed->empty pane so `sendPrompt` lands cleanly) — combined
 * because `testDeps(home, run)` builds `runCcd` AND `tmux` from the SAME
 * raw `Runner` (`helpers.ts:130-137`), and `fireAutomation` needs both to
 * complete a run end to end. `promptText` must be the automation's own
 * `prompt` — `sendPrompt`'s echo check needles on the first 24 bytes of
 * what it actually sent (`inject/send.ts:74,484`).
 */
function makeRunner(home: string, promptText: string, project = PROJECT):
{ run: Runner; calls: string[][]; sessionId: string } {
  const calls: string[][] = [];
  const sessionId = `${project}-auto-quiet-basin`;
  const panes = ['scrollback\n❯ \n', `scrollback\n❯ ${promptText}\n`, 'scrollback\n❯ \n'];
  let capIdx = 0;
  let seeded = false;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'ws-add') {
      if (!seeded) { seedRow(home, sessionId, project); seeded = true; }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      const p = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls, sessionId };
}

/** Keeps the `Deps` OBJECT it built and hands it back, which the original
 *  shape threw away. The reason is not tidiness: a watcher constructed over a
 *  DIFFERENT `Deps` would carry a different `CoordStore`, and the whole
 *  question this rig is now asked (does the route's act and the sweep's act
 *  collide on one lease?) is invisible unless both read the same
 *  `~/.ccrc/coord.db` handle. `pr-sweep.test.ts:65` is the shipped idiom for
 *  one `deps` shared by an app and a watcher. Every fixture that wants only an
 *  app keeps destructuring `{app, coord, cfg}` and is untouched. */
const openApp = async (home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const deps: Deps = { ...base, coord, ...over };
  const app = await buildServer(deps);
  return { app, coord, cfg: base.cfg, deps };
};

/** *Run now* is a CLAIM plus a SWEEP: the route answers `202` the moment the
 *  lease is open and the ACT — spawn, identify, adopt, prompt, close — is
 *  performed by the watcher's pass 3. So a fixture that asserts on the act has
 *  to drive a sweep, and must not mistake `await sweepAutomations()` for
 *  awaiting the act: `fireOne` void-dispatches (`watch.ts:2440`), which is why
 *  the settle is observed by POLLING the store rather than by the await.
 *
 *  Priming is exactly one `tick()` BEFORE the claim — `primed` flips at the
 *  END of a tick, immediately after the sweep that tick dispatched has already
 *  returned on `!primed`, so the priming tick fires nothing and the first
 *  explicit sweep afterwards always runs (`lastAutomationSweep` starts at 0
 *  and the interval gate is `!== 0`). ONE sweep needs no clock advance. */
async function runNowAndSettle(
  app: FastifyInstance, deps: Deps, coord: CoordStore, id: number,
): Promise<number> {
  const w = new FleetWatcher(deps, new Bus(), 2000);
  try {
    await w.tick();
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(res.statusCode, res.body).toBe(202);
    const runId = (res.json() as { runId: number }).runId;
    await w.sweepAutomations();
    await vi.waitFor(() => {
      expect(coord.automationRuns(id, 5).find((r) => r.id === runId)?.endedAt).not.toBeNull();
    });
    return runId;
  } finally {
    w.stop();
  }
}

const create = (app: FastifyInstance, body: Record<string, unknown>) =>
  app.inject({ method: 'POST', url: '/api/automations', payload: body });

const validBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  name: 'nightly', project: PROJECT, prompt: 'go', cadence: WALL_CLOCK, ...over,
});

describe('POST /api/automations — create', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('201, state:paused — the arm gate: nothing may fire it until an operator proves it by hand', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const res = await create(app, validBody());
    expect(res.statusCode).toBe(201);
    const body = res.json() as { ok: boolean; automation: { state: string; provedAt: number | null } };
    expect(body.ok).toBe(true);
    expect(body.automation.state).toBe('paused');
    expect(body.automation.provedAt).toBeNull();
  });

  it('409 bad-schedule, NAMING the ScheduleError, for a cadence with an empty day mask', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const res = await create(app, validBody({ cadence: { kind: 'wall-clock', days: 0, minuteOfDay: 540, tz: 'UTC' } }));
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-schedule', scheduleError: 'no-future-occurrence' });
  });

  it('413 oversize for a prompt over AUTOMATION_PROMPT_MAX_BYTES, REFUSED not truncated, with BOTH byte counts', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const prompt = 'x'.repeat(AUTOMATION_PROMPT_MAX_BYTES + 1);
    const res = await create(app, validBody({ prompt }));
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize', limit: AUTOMATION_PROMPT_MAX_BYTES, bytes: prompt.length });
    // Refused, not truncated — nothing was written.
    expect(w.coord.automations({}).length).toBe(0);
  });

  it('400 bad-request on a malformed body', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const res = await create(app, { name: '', project: PROJECT, prompt: 'go', cadence: WALL_CLOCK });
    expect(res.statusCode).toBe(400);
  });
});

describe('the arm gate — never-run-by-hand, and what clears it', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('409 never-run-by-hand BEFORE any manual run has settled', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/arm` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'never-run-by-hand' });
  });

  it('200 and provedAt stamped AFTER a manual run that produced a session', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run, sessionId } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;

    // The arm gate's full loop — manual run -> proof -> arm succeeds — now
    // spans the route AND the sweep, so this fixture drives both. Re-targeting
    // it at the 202 alone would delete the only end-to-end proof of the gate.
    await runNowAndSettle(app, w.deps, w.coord, id);

    const after = w.coord.automation(id)!;
    expect(after.provedAt).not.toBeNull();
    expect(after.lastOutcome).toBe('ok');

    const runs = w.coord.automationRuns(id, 5);
    expect(runs[0]).toMatchObject({ outcome: 'ok', trigger: 'manual', sessionId });

    const armRes = await app.inject({ method: 'POST', url: `/api/automations/${id}/arm` });
    expect(armRes.statusCode, armRes.body).toBe(200);
    expect(w.coord.automation(id)!.state).toBe('armed');
  });
});

describe('POST /:id/run — the manual door, and what it must never read off the body', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('404 on an unknown automation id', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'POST', url: '/api/automations/9999/run' });
    expect(res.statusCode).toBe(404);
  });

  it('records coordinator-paused as a REFUSED RUN, not an HTTP refusal, and still spawns nothing', async () => {
    // WHY THIS IS NO LONGER A 409. `coordinator-paused` is rung 5 of
    // `checkPostClaim`, which runs inside `fireAutomation` — on the sweep,
    // after this route has already answered. The refusal is not lost, and that
    // is the assertion: `fireAutomation` settles the run row on every refusal
    // path before returning, so the code reaches the phone as the run's own
    // `outcome`/`refusal` and as the parent's `lastOutcome`/`lastRefusal` on
    // the `{type:'automations'}` frame, which arrives with no re-fetch. What
    // must NOT change is the fleet consequence: still no spawn.
    const home = mkTmp('ccrc-auto-routes-');
    const { run, calls } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    // rung 5 — the operator's existing fleet-wide pause (§7's own note: "the
    // operator's existing fleet-wide pause already stops automations too").
    writeFileSync(path.join(w.cfg.registryDir, COORDINATOR_PAUSE_MARKER), '');
    await runNowAndSettle(app, w.deps, w.coord, id);
    expect(w.coord.automationRuns(id, 5)[0]).toMatchObject({ outcome: 'refused', refusal: 'coordinator-paused' });
    expect(w.coord.automation(id)).toMatchObject({ lastOutcome: 'refused', lastRefusal: 'coordinator-paused' });
    // Refused BEFORE any fleet act: no spawn call was made.
    expect(calls.filter((c) => c.includes('ws-add'))).toEqual([]);
  });

  it('409 overlap — the ONE refusal a claim-only route can still decide itself', async () => {
    // The route's 409 arm did not disappear with the post-claim ladder;
    // `claimAndOpenRun` refuses `overlap` (a lease already open) and
    // `unknown-automation` (diverted to 404 above), so `overlap` is the whole
    // of it. Without this fixture the arm has no coverage at all, since the two
    // refusals that used to exercise it are now settled on the sweep.
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    const first = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(first.statusCode).toBe(202);
    // No sweep in between: the lease from the first claim is still open, which
    // is exactly the condition a double-tap on the phone now reaches.
    const second = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ ok: false, refused: 'overlap' });
    expect(w.coord.automationRuns(id, 5)).toHaveLength(1);
  });

  it('finishes a run that was claimed before the automation was retired, instead of stranding its lease', async () => {
    // The gap only exists because the manual door became claim-only: the act
    // now happens on a later tick, and `POST /:id/state` has no lease check,
    // so `retired` can land in between. Pass 3 reads `leasedAutomations()` for
    // exactly this reason — `automations({})` filters `retired` out, and with
    // that query the run below is never fired, never explained, and settles
    // `lost` only when its hard lease lapses 600 s later, holding the lease
    // and one of AUTOMATION_MAX_CONCURRENT the whole time.
    const home = mkTmp('ccrc-auto-routes-');
    const { run, sessionId } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;

    const claimed = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(claimed.statusCode).toBe(202);
    const retired = await app.inject({
      method: 'POST', url: `/api/automations/${id}/state`, payload: { state: 'retired' },
    });
    expect(retired.statusCode).toBe(200);
    expect(w.coord.automation(id)!.state).toBe('retired');

    const sweeper = new FleetWatcher(w.deps, new Bus(), 2000);
    try {
      await sweeper.tick();
      await sweeper.sweepAutomations();
      await vi.waitFor(() => {
        expect(w.coord.automationRuns(id, 5)[0]!.endedAt).not.toBeNull();
      });
    } finally {
      sweeper.stop();
    }
    expect(w.coord.automationRuns(id, 5)[0]).toMatchObject({ outcome: 'ok', sessionId });
    // And the lease is given back, so the row is not left wedged either.
    expect(w.coord.automation(id)!.leaseRunId).toBeNull();
  });

  it('D-280: a body naming another project/prompt/session/trigger is not a field that exists — the fired call is the STORED automation, verbatim', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run, calls, sessionId } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;

    const res = await app.inject({
      method: 'POST', url: `/api/automations/${id}/run`,
      payload: {
        project: 'some-other-project', prompt: 'rm -rf /', sessionId: 'not-a-real-session',
        trigger: 'schedule',
      },
    });
    expect(res.statusCode).toBe(202);

    // D-280 gets STRONGER with a claim-only route, not weaker: the body dies
    // at the route and the act is performed later, from the STORED row alone,
    // by a sweep that never saw the request. The proof still lives in the
    // `ws-add` argv, so this fixture drives the sweep rather than re-targeting
    // itself at the 202 — which would keep the status and drop the property.
    const wSweep = new FleetWatcher(w.deps, new Bus(), 2000);
    try {
      await wSweep.tick();
      await wSweep.sweepAutomations();
      await vi.waitFor(() => {
        expect(w.coord.automationRuns(id, 5)[0]!.endedAt).not.toBeNull();
      });
    } finally {
      wSweep.stop();
    }

    const wsAddCalls = calls.filter((c) => c.includes('ws-add'));
    expect(wsAddCalls.length).toBe(1);
    expect(wsAddCalls[0]).toContain(PROJECT);
    expect(wsAddCalls.flat()).not.toContain('some-other-project');

    const runRow = w.coord.automationRuns(id, 5)[0]!;
    expect(runRow.trigger).toBe('manual');          // the ROUTE's own word, never the body's
    expect(runRow.sessionId).toBe(sessionId);        // the REAL identified session, never the body's
    expect(runRow.outcome).toBe('ok');
  });

  it('409 bad-transition on a RETIRED automation — spec §6 "on any state but retired"', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    w.coord.setAutomationState(id, 'retired', Date.now());
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-transition', from: 'retired' });
  });
});

describe('runs and steps — the read side', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('GET /:id/runs clamps at AUTOMATION_RUN_RETENTION even when asked for more', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    const now = Date.now();
    for (let i = 0; i < AUTOMATION_RUN_RETENTION + 5; i++) {
      w.coord.openUnleasedRun({ automationId: id, now, occurrence: { trigger: 'manual' }, settlement: { outcome: 'missed' } });
    }
    const res = await app.inject({ method: 'GET', url: `/api/automations/${id}/runs?limit=999999` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { runs: unknown[] };
    expect(body.runs.length).toBe(AUTOMATION_RUN_RETENTION);
  });

  it('GET /automations/runs/:runId returns the run AND its step trail', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    // The route under test is the READ route; the step trail is its payload,
    // and every `automation_run_events` row is written by the act. Asserting
    // it straight after the claim would assert `steps: []` — the same shape a
    // broken wiring returns.
    const runId = await runNowAndSettle(app, w.deps, w.coord, id);

    const res = await app.inject({ method: 'GET', url: `/api/automations/runs/${runId}` });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { run: { id: number }; steps: { step: string }[] };
    expect(body.run.id).toBe(runId);
    expect(body.steps.length).toBeGreaterThan(0);
    expect(body.steps.map((s) => s.step)).toContain('close');
  });

  it('404 for an unknown runId', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'GET', url: '/api/automations/runs/999999' });
    expect(res.statusCode).toBe(404);
  });

  it('a RETIRED automation still serves its runs (spec §9 "retire, never delete")', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    w.coord.setAutomationState(id, 'retired', Date.now());

    const res = await app.inject({ method: 'GET', url: `/api/automations/${id}/runs` });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { runs: unknown[] }).runs.length).toBe(1);
  });
});

describe('GET /api/automations, GET /:id, POST /:id (edit), POST /:id/state, POST /automations/pause', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('GET /api/automations lists what create wrote, and a retired automation leaves the default list', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody({ name: 'a' }))).json().automation.id as number;
    await create(app, validBody({ name: 'b' }));
    w.coord.setAutomationState(id, 'retired', Date.now());

    const res = await app.inject({ method: 'GET', url: '/api/automations' });
    expect(res.statusCode).toBe(200);
    const names = (res.json() as { automations: { name: string }[] }).automations.map((a) => a.name);
    expect(names).toEqual(['b']);
  });

  it('GET /api/automations/:id returns the row with its recent runs; an unknown id is 404', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    const res = await app.inject({ method: 'GET', url: `/api/automations/${id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, automation: { id }, runs: [] });
    const miss = await app.inject({ method: 'GET', url: '/api/automations/9999' });
    expect(miss.statusCode).toBe(404);
  });

  it('POST /:id edits, recomputes nextRunAt for an armed row, and 404s on an unknown id', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run, sessionId } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    // This fixture is not about the act; it needs an ARMED row, and arming has
    // one door that the arm gate opens only once a manual run has SETTLED with
    // a session. The prelude's own `POST /arm` was unchecked, so a claim-only
    // route would have left the row `paused` and this fixture would have
    // measured `nextRunAt` for the wrong state while still reading as a
    // product regression.
    await runNowAndSettle(app, w.deps, w.coord, id);
    expect((await app.inject({ method: 'POST', url: `/api/automations/${id}/arm` })).statusCode).toBe(200);
    void sessionId;

    const res = await app.inject({
      method: 'POST', url: `/api/automations/${id}`,
      payload: validBody({ name: 'renamed' }),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { automation: { name: string; nextRunAt: number | null; state: string } };
    expect(body.automation.name).toBe('renamed');
    expect(body.automation.state).toBe('armed');
    expect(body.automation.nextRunAt).not.toBeNull();

    const miss = await app.inject({ method: 'POST', url: '/api/automations/9999', payload: validBody() });
    expect(miss.statusCode).toBe(404);
  });

  it("POST /:id/state 'paused' pauses; 'retired' retires and leaves every run row present", async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    await runNowAndSettle(app, w.deps, w.coord, id);
    expect((await app.inject({ method: 'POST', url: `/api/automations/${id}/arm` })).statusCode).toBe(200);

    const paused = await app.inject({ method: 'POST', url: `/api/automations/${id}/state`, payload: { state: 'paused' } });
    expect(paused.statusCode).toBe(200);
    expect(w.coord.automation(id)!.state).toBe('paused');

    const retired = await app.inject({ method: 'POST', url: `/api/automations/${id}/state`, payload: { state: 'retired' } });
    expect(retired.statusCode).toBe(200);
    expect(w.coord.automation(id)!.state).toBe('retired');
    expect(w.coord.automationRuns(id, 10).length).toBe(1);
  });

  it("POST /:id/state refuses 409 bad-transition for 'armed' — arming has ONE door", async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/state`, payload: { state: 'armed' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-transition' });
  });

  it('POST /:id/state refuses 409 bad-transition on a RETIRED row — retire is terminal', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    w.coord.setAutomationState(id, 'retired', Date.now());
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/state`, payload: { state: 'paused' } });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-transition', from: 'retired' });
  });

  it('POST /api/automations/pause flips the switch, and the next fire refuses automations-paused', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;

    const res = await app.inject({ method: 'POST', url: '/api/automations/pause', payload: { paused: true } });
    expect(res.statusCode).toBe(200);
    expect(w.coord.automationsPaused()).toMatchObject({ paused: true });

    // Rung 4, like rung 5 above, is decided on the sweep — so the switch's
    // effect is a REFUSED RUN rather than an HTTP refusal. Kept in one fixture
    // because the switch and its consequence are the same claim; the flip is
    // asserted above, the consequence here.
    await runNowAndSettle(app, w.deps, w.coord, id);
    expect(w.coord.automationRuns(id, 5)[0]).toMatchObject({ outcome: 'refused', refusal: 'automations-paused' });
  });

  it('400 bad-request for a non-boolean paused', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'POST', url: '/api/automations/pause', payload: { paused: 'yes' } });
    expect(res.statusCode).toBe(400);
  });
});

// ── Gating: session-cookie only, never the box token (spec §10 "Gating") ────

describe('automations routes never call requireMailToken — session gate only', () => {
  it('the source never CALLS requireMailToken/checkMailToken, and never spells the header literal', () => {
    // Call-syntax only, not a bare word — this file's own banner names
    // `requireMailToken` in PROSE (documenting the absence), which a bare
    // `/requireMailToken/` scan would trip on itself.
    const src = readFileSync(path.join(serverRoot, 'src', 'auto', 'routes.ts'), 'utf8');
    expect(src).not.toMatch(/requireMailToken\s*\(/);
    expect(src).not.toMatch(/checkMailToken\s*\(/);
    expect(src).not.toMatch(/['"]x-ccrc-mail-token['"]/);
  });
});

// ── D-280, both halves (contract-draft.md F9's shape) ────────────────────

/** Every route registration in the file, in source order, each with the text
 *  that follows it up to the next registration — `auth-gate.test.ts:74-78`'s
 *  own registration regex, so the two suites agree on what a registration
 *  looks like. */
function handlers(src: string): { route: string; body: string }[] {
  const hits = [...src.matchAll(/app\.(get|post)\('([^']+)'/g)];
  return hits.map((m, i) => ({
    route: `${m[1]!.toUpperCase()} ${m[2]!}`,
    body: src.slice(m.index!, i + 1 < hits.length ? hits[i + 1]!.index! : src.length),
  }));
}

describe('D-280 — only the four body-carrying routes read a body; Run-now never does', () => {
  it('the scan sees all ten routes, and exactly the four that read req.body', () => {
    const src = readFileSync(path.join(serverRoot, 'src', 'auto', 'routes.ts'), 'utf8');
    const hs = handlers(src);
    expect(hs.length, 'the scan sees all ten routes, or it proves nothing').toBe(10);
    expect(hs.filter((h) => /\breq\.body\b/.test(h.body)).map((h) => h.route).sort()).toEqual([
      'POST /api/automations',
      'POST /api/automations/:id',
      'POST /api/automations/:id/state',
      'POST /api/automations/pause',
    ]);
  });
});

// ── ONE manual run, ONE session ─────────────────────────────────────────────
//
// The invariant this pins is not about HTTP status codes; it is that a single
// *Run now* creates a single session. Two actors can perform a manual run's
// act — `POST /:id/run` and the watcher's sweep pass 3 ("every open lease this
// process has not already started") — and the sweep's single-flight guard,
// `automationsInFlight`, is a PRIVATE FIELD OF THE WATCHER (`watch.ts:649`,
// added only in `fireOne` at `:2441`). A route that performs the act itself
// therefore cannot register in it. While that route is inside its spawn — ccd's
// `SPAWN_SETTLE_S` is 240 s, and the automations lane sweeps every 10 s — every
// sweep in the window reads the same `leaseRunId` as "leased but not started"
// and fires it AGAIN.
//
// The second act is silent, not loud: `markAutomationSpawn` (`store.ts:3834`)
// is a bare `UPDATE automation_runs SET ... WHERE id = ?` with no idempotency
// guard, so the second identify OVERWRITES sessionId/workspace/branch on the
// one run row and the first session becomes an orphan no run row names — the
// exact thing `store.ts:3829`'s own docstring calls "spec §6's
// orphan-manufacture rule". Only the second settle is refused.
//
// The fixture is written to hold on BOTH sides of the cut-over rather than to
// describe one implementation: it counts `ws-add` attempts across two sweeps
// and asserts ONE, whoever performs it. `calls.push` runs BEFORE the gate, so
// an attempt is counted while it is still blocked.
describe('a manual run spawns exactly one session', () => {
  const NOW = Date.UTC(2026, 8, 2, 12, 0);
  const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };
  let app: FastifyInstance | undefined;
  beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
  afterEach(async () => { await app?.close(); app = undefined; vi.useRealTimers(); });

  /** `makeRunner`, with a gate the fixture opens: `ws-add` records its attempt
   *  and then WAITS, modelling the 240 s a real spawn can hold. */
  function gatedRunner(home: string, promptText: string):
  { run: Runner; calls: string[][]; open: () => void } {
    const calls: string[][] = [];
    const sessionId = `${PROJECT}-auto-quiet-basin`;
    const panes = ['scrollback\n❯ \n', `scrollback\n❯ ${promptText}\n`, 'scrollback\n❯ \n'];
    let capIdx = 0;
    let seeded = false;
    let open = (): void => { /* replaced below, before any call can await it */ };
    const gate = new Promise<void>((resolve) => { open = () => resolve(); });
    const run: Runner = async (cmd, args) => {
      calls.push([cmd, ...args]);
      if (args[0] === 'ws-add') {
        await gate;
        if (!seeded) { seedRow(home, sessionId); seeded = true; }
        return { code: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'capture-pane') {
        const pane = panes[Math.min(capIdx, panes.length - 1)]!;
        capIdx++;
        return { code: 0, stdout: pane, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    return { run, calls, open };
  }

  it('does not spawn a second session for a sweep that lands while the act is in flight', async () => {
    const home = mkTmp('automations-run-once-');
    const PROMPT = 'go';
    const r = gatedRunner(home, PROMPT);
    const opened = await openApp(home, r.run);
    app = opened.app;
    const { coord, deps } = opened;

    const created = await create(app, validBody({ prompt: PROMPT }));
    expect(created.statusCode).toBe(201);
    const id = (created.json() as { automation: { id: number } }).automation.id;

    // The row is `paused` with `provedAt` NULL, so `dueAutomations` excludes it
    // by construction: the manual door is the only actor that can fire it, and
    // pass 2 cannot be the source of a second act.
    const w = new FleetWatcher(deps, new Bus(), 2000);
    const attempts = (): number => r.calls.filter((c) => c[1] === 'ws-add').length;
    try {
      await w.tick();                       // primes; `primed` flips AFTER the dispatch
      const posted = app.inject({ method: 'POST', url: `/api/automations/${id}/run` });

      // Wait for the CLAIM, not for the response. Awaiting the response would
      // be the natural thing to write and would make this fixture unable to
      // measure the defect it exists for: a route that performs the act does
      // not answer until the act is done, so the sweep below would never land
      // inside the window. The claim's own row is the observable both shapes
      // share — it is committed before either performs anything.
      await vi.waitFor(() => { expect(coord.automationRuns(id, 5)).toHaveLength(1); });

      await w.sweepAutomations();            // the first sweep after priming always runs
      await vi.waitFor(() => { expect(attempts()).toBeGreaterThanOrEqual(1); });
      advance(10_000 + 1);                   // past AUTOMATION_SWEEP_MS
      await w.sweepAutomations();

      r.open();
      expect((await posted).statusCode).toBe(202);
      await vi.waitFor(() => {
        expect(coord.automationRuns(id, 5)[0]!.endedAt).not.toBeNull();
      });

      expect(attempts(), 'one Run now must issue exactly one ws-add').toBe(1);
      expect(coord.automationRuns(id, 5)).toHaveLength(1);
    } finally {
      w.stop();
    }
  });
});
