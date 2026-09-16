// The legacy generation ends here. Spec §3 F2 accepted a missing `homeProject`
// for ONE deploy generation, recorded each acceptance as a `legacy-home-project`
// run event, and dated the flip by evidence rather than by the calendar: zero
// such events over seven consecutive days. That window did NOT clear on its own
// — the measured trail is in the programme ledger — and the operator waived it
// against that trail, under a waiver whose number lives in the home-project-flip
// programme ledger. This suite is what holds the flip shut afterwards.
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
import { okRuns } from './coordReadHelpers.js';
import { mkTmp } from './tmpHelpers.js';

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
    // THE `detail` IS ASSERTED, and the plan that prescribed this suite said the
    // opposite. Wave 3's Task 6 fence argues for a bare
    // `{ ok: false, error: 'bad-request' }` on the grounds that the require arm
    // sends the same shape as the route's four other `bad-request` sends. Wave 1
    // did not ship it that way: D-2349 gave this refusal its OWN sentence
    // precisely so that "your JSON is malformed" and "this build requires a home"
    // do not reach the caller as one value, and `routes.ts` says so in a comment
    // beside the send. The shipped source governs over the plan's anticipation of
    // it, so the assertion below pins the three-key body that actually ships —
    // and pins the distinction D-2349 bought, which a bare-shape assertion would
    // have silently permitted a later edit to collapse. This correction is a
    // deviation from the plan's own fence, argued in the PR that carries the
    // flip rather than numbered here: no number was issued for it, and a D-ref
    // written without being issued seals its own band forever.
    const w = await openApp(); app = w.app;
    const res = await postOpen(app, OPEN_BODY);
    expect(res.statusCode, 'an open with no homeProject was accepted').toBe(400);
    const body = JSON.parse(res.body) as { ok: boolean; error: string; detail?: string };
    expect(body).toEqual({ ok: false, error: 'bad-request', detail: 'homeProject is required' });
    // `okRuns`, not `.length`: `runs()` answers a UNION — measured rows or an
    // unmeasurable refusal — and reading `.length` off it silently answers
    // `undefined`, which `toBe(0)` would have reported as a failure and a
    // `toBeFalsy()` would have passed over. The helper makes an unmeasurable
    // read fail loudly instead of counting as zero orphans.
    expect(okRuns(w.coord.runs()), 'a refused open left a planned orphan behind').toEqual([]);
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
    // The event the flip exists to stop: with the constant false there is no
    // accept branch left to write one.
    expect(w.coord.runEvents(body.id).map((e) => e.detail))
      .not.toContain('legacy-home-project');
  });
});
