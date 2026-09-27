// The legacy generation ends here. Spec §3 F2 accepted a missing `homeProject`
// for ONE deploy generation, recorded each acceptance as a `legacy-home-project`
// run event, and would have dated the flip by evidence rather than by the
// calendar: zero such events over seven consecutive days. That criterion was
// measured NOT met — 8 of the 15 opens since the 2026-09-14 deploy omitted the
// field, the last at 2026-09-15T07:38:57Z — and the operator waived it (D-2867;
// the programme ledger's `## Measurements` block carries the trail and its
// date). This suite is what holds the flip shut afterwards.
//
// TWO ASSERTIONS, DELIBERATELY, because they fail differently. The text pin
// catches a revert of the constant even if the route were later rewritten; the
// route test catches a require branch that stops requiring even while the
// constant still reads `false`. Either alone leaves half the guard unmeasured.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { okRuns } from './coordReadHelpers.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROUTES = readFileSync(path.join(REPO, 'server/src/coord/routes.ts'), 'utf8');

const TOKEN = 'f'.repeat(64);
/** Nothing in this suite reaches ccd: an open with no `sessionId` places no
 *  hold, so the runner is never called. It exists because `testDeps` requires
 *  one. */
const runner: Runner = async () => ({ code: 0, stdout: '', stderr: '' });

const OPEN_BODY = {
  program: 'crossrepo-fixture', title: 'Wave one', project: 'demo',
  wave: 1, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator',
};

const openApp = async () => {
  const home = mkTmp('ccrc-home-project-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, runner), mailToken: TOKEN, coord });
  return { app, coord };
};

const postOpen = (app: FastifyInstance, body: unknown) =>
  app.inject({
    method: 'POST', url: '/api/runs',
    headers: { 'x-ccrc-mail-token': TOKEN },
    payload: body as Record<string, unknown>,
  });

describe('homeProject is required at open (the legacy generation is over)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  it('ships with the legacy constant FALSE', () => {
    const m = /HOME_PROJECT_LEGACY_ACCEPTED\s*(?::\s*boolean\s*)?=\s*(true|false)/.exec(ROUTES);
    expect(m, 'HOME_PROJECT_LEGACY_ACCEPTED is gone from coord/routes.ts — wave 1 declared it, and ' +
      'the flip is a change to its VALUE, never a deletion of the constant').not.toBeNull();
    expect(m![1], 'the legacy generation was re-opened without a measurement').toBe('false');
  });

  it('refuses an open with no homeProject, and leaves no orphan behind', async () => {
    // The `detail` is asserted because the shipped `required` arm sends one and
    // must keep sending it — "this build requires a home" is a different remedy
    // from "your JSON is malformed" and the two may not reach the caller as the
    // same bytes (D-2349, D-2744).
    const w = await openApp(); app = w.app;
    const res = await postOpen(app, OPEN_BODY);
    expect(res.statusCode, 'an open with no homeProject was accepted').toBe(400);
    const body = JSON.parse(res.body) as { ok: boolean; error: string; detail?: string };
    expect(body).toEqual({ ok: false, error: 'bad-request', detail: 'homeProject is required' });
    expect(okRuns(w.coord.runs({ includeClosed: true })).length,
      'a refused open left a planned orphan behind').toBe(0);
    expect(w.coord.programs().some((p) => p.slug === 'crossrepo-fixture'),
      'a refused open still minted the programme row').toBe(false);
  });

  it('still opens when homeProject is given, and records no legacy event', async () => {
    const w = await openApp(); app = w.app;
    const res = await postOpen(app, { ...OPEN_BODY, homeProject: 'demo' });
    expect(res.statusCode, 'a well-formed open was refused').toBe(200);
    const body = JSON.parse(res.body) as { ok: boolean; id: number; ledgerRepo: string | null };
    expect(body.ok).toBe(true);
    expect(body.ledgerRepo, 'the response does not carry the home the body just declared')
      .toBe('demo');
    // The event the flip exists to stop: with the constant false no reachable
    // accept arm is left to write one.
    expect(w.coord.runEvents(body.id).map((e) => e.detail))
      .not.toContain('legacy-home-project');
  });
});
