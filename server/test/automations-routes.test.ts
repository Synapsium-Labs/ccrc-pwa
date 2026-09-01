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
import { describe, it, expect, afterEach } from 'vitest';
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

const openApp = async (home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, coord, ...over });
  return { app, coord, cfg: base.cfg };
};

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

    const runRes = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(runRes.statusCode, runRes.body).toBe(202);

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

  it('409, carrying the refusal code, when the fleet-wide pause marker is present', async () => {
    const home = mkTmp('ccrc-auto-routes-');
    const { run } = makeRunner(home, 'go');
    const w = await openApp(home, run); app = w.app;
    const id = (await create(app, validBody())).json().automation.id as number;
    // rung 5 — the operator's existing fleet-wide pause (§7's own note: "the
    // operator's existing fleet-wide pause already stops automations too").
    writeFileSync(path.join(w.cfg.registryDir, COORDINATOR_PAUSE_MARKER), '');
    const res = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ ok: false, refused: 'coordinator-paused' });
    // Refused BEFORE any fleet act: no spawn call was made.
    expect(w.coord.automationRuns(id, 5)[0]).toMatchObject({ outcome: 'refused', refusal: 'coordinator-paused' });
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
    await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    const runId = w.coord.automationRuns(id, 1)[0]!.id;

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
    await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    await app.inject({ method: 'POST', url: `/api/automations/${id}/arm` });
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
    await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    await app.inject({ method: 'POST', url: `/api/automations/${id}/arm` });

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

    const fired = await app.inject({ method: 'POST', url: `/api/automations/${id}/run` });
    expect(fired.statusCode).toBe(409);
    expect(fired.json()).toMatchObject({ ok: false, refused: 'automations-paused' });
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
