// Routing spec 2026-09-14 §5.3, slice 4, Task 5 — `POST
// /api/sessions/:id/route`, the pickers' write. It builds `CCD_ARGV.routeApply`
// (routing spec's live-change form) behind two independent gates:
// `capSupported(deps.fleetState, ROUTE_APPLY_CAP)` (501 when the box has not
// shipped `--apply` yet) and the shape guard `parseRouteFields` reuses from
// the operator's own routing doors (400 on anything but exactly one known,
// well-formed field). `pwaDec(req)` is the SAME human-driven dec every other
// PWA-surface write already declares — `--actor`/`--reason` only, never
// `--surface` (`cmd_route` has no such flag; `ccdargv.ts`'s own `route`
// docstring is the measured argument for that).
import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import { ACTOR_FLAGS_CAP, ROUTE_APPLY_CAP } from '../src/ccdargv.js';
import { EXEMPT } from '../src/auth/gate.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const ID = 'claude-a-MekWarLive';

const seedSession = (home: string, id: string, wrapper: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper, project: id, workdir: `/data/projects/${id}`, uuid: '1'.repeat(36), started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

const seededHome = (): string => {
  const home = mkTmp('ccrc-route-apply-');
  seedRoster(home);
  seedSession(home, ID, 'claude-a');
  return home;
};

const BOTH_CAPS = { connected: true, downSince: null, ccdVerbs: [ROUTE_APPLY_CAP, ACTOR_FLAGS_CAP], rosterFp: null, build: null };
const APPLY_ONLY = { connected: true, downSince: null, ccdVerbs: [ROUTE_APPLY_CAP], rosterFp: null, build: null };
const NEITHER_CAP = { connected: true, downSince: null, ccdVerbs: ['start'], rosterFp: null, build: null };

const open = async (
  home: string, run: Runner, fleetState: typeof BOTH_CAPS | typeof NEITHER_CAP,
): Promise<{ app: FastifyInstance; calls: string[][] }> => {
  const calls: string[][] = [];
  const recording: Runner = async (cmd, args) => { calls.push(args); return run(cmd, args); };
  const app = await buildServer({ ...testDeps(home, recording), fleetState });
  await app.ready();
  return { app, calls };
};

const post = (app: FastifyInstance, id: string, payload: unknown) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/route`, payload: payload as never });

describe('POST /api/sessions/:id/route (routing spec §5.3, live change from the PWA)', () => {
  it('404 for an unknown session, before any parse', async () => {
    const home = seededHome();
    const { app, calls } = await open(home, async () => ({ code: 0, stdout: '', stderr: '' }), BOTH_CAPS);
    const res = await post(app, 'nope-nothing', { field: 'effort', value: 'high' });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('400 for a missing field, an unknown field, a control character, and an attempt to name two fields at once — never a ccd call', async () => {
    const home = seededHome();
    const { app, calls } = await open(home, async () => ({ code: 0, stdout: '', stderr: '' }), BOTH_CAPS);
    const bad = [
      {}, // missing field entirely
      { field: 'effort' }, // value missing — not a string
      { field: 'colour', value: 'blue' }, // unknown field
      { field: 'effort', value: 'hi\x00gh' }, // control character
      { field: 'effort', value: '' }, // empty value
      // A caller naming two fields in one call — R1's "only ONE field per
      // call" — is not a string `field`, so it lands on the same not-object
      // refusal a missing field gets: `typeof body.field === 'string'` is
      // false for an object, never a route this route can build.
      { field: { class: 'opus', effort: 'high' }, value: 'high' },
    ];
    for (const payload of bad) {
      const res = await post(app, ID, payload);
      expect(res.statusCode, JSON.stringify(payload)).toBe(400);
      expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    }
    expect(calls).toEqual([]);
    await app.close();
  });

  it('501 unsupported when the box does not advertise route-apply-v1 — never a silent drop', async () => {
    const home = seededHome();
    const { app, calls } = await open(home, async () => ({ code: 0, stdout: '', stderr: '' }), NEITHER_CAP);
    const res = await post(app, ID, { field: 'effort', value: 'high' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
    await app.close();
  });

  it('builds route --session <id> --set effort=high --apply --actor <device actor> when both caps stand', async () => {
    // No `--surface`: `cmd_route` has no such case (`ccdargv.ts`'s own `route`
    // docstring measures it against the real binary), so `routeApply` sends
    // `actorReasonFlags`, not the five workspace verbs' `decFlags`.
    const home = seededHome();
    const { app, calls } = await open(home, async () => ({ code: 0, stdout: '', stderr: '' }), BOTH_CAPS);
    const res = await post(app, ID, { field: 'effort', value: 'high' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // No session cookie in this fixture (auth off by default) — the gate
    // measures no session, so `deviceActor(null)` is the bare word
    // `unmeasured`, never `device:unmeasured` (`ccdargv.ts`'s own
    // `deviceActor` docstring is the two-word, two-condition argument).
    expect(calls).toEqual([
      ['route', '--session', ID, '--set', 'effort=high', '--apply', '--actor', 'unmeasured'],
    ]);
    await app.close();
  });

  it('omits the actor flags when actor-flags-v1 is absent, keeps --apply', async () => {
    const home = seededHome();
    const { app, calls } = await open(home, async () => ({ code: 0, stdout: '', stderr: '' }), APPLY_ONLY);
    const res = await post(app, ID, { field: 'class', value: 'opus' });
    expect(res.statusCode).toBe(200);
    expect(calls).toEqual([
      ['route', '--session', ID, '--set', 'class=opus', '--apply'],
    ]);
    await app.close();
  });

  it('a ccd refusal is a 502 carrying stderr', async () => {
    const home = seededHome();
    const { app, calls } = await open(
      home, async () => ({ code: 1, stdout: '', stderr: 'ccd: route refused on the box' }), BOTH_CAPS,
    );
    const res = await post(app, ID, { field: 'effort', value: 'high' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ ok: false, stderr: 'ccd: route refused on the box' });
    expect(calls).toEqual([
      ['route', '--session', ID, '--set', 'effort=high', '--apply', '--actor', 'unmeasured'],
    ]);
    await app.close();
  });

  it('is NOT in auth/gate.ts EXEMPT (session-gated like /prompt)', () => {
    // Positive control first: a negatives-only test would pass just the same
    // against an empty map, or one EXEMPT has been re-keyed under, so prove
    // the table itself still holds a real entry before trusting the two
    // absences below.
    expect(EXEMPT.has('GET /health')).toBe(true);
    expect(EXEMPT.has('POST /api/sessions/:id/route')).toBe(false);
    // The sibling it sits beside, for the contrast — also gated, so this
    // route is not an outlier among the session's own writes.
    expect(EXEMPT.has('POST /api/sessions/:id/prompt')).toBe(false);
  });
});
