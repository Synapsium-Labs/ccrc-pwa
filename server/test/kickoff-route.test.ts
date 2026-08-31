// program-leverage wave 4 (F4) — `POST /api/sessions/:id/kickoff`, the PWA
// surface that queues a program kickoff as durable system mail. TDD red-first:
// written and run before the route existed, to confirm it failed for the right
// reason.
//
// The decision half lives in `coord-kickoff.test.ts`. What is pinned HERE is the
// route: its four pre-queue arms, and — the pin the wave's brief asks for by
// name — that this path never types anything into anybody's pane.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { Runner } from '../src/exec.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import { EXEC_WHITELIST } from '../../agent/src/whitelist.js';
import { MAIL_BODY_MAX_BYTES, PROGRAM_KICKOFF_SUBJECT, programKickoff } from '../../shared/api.js';

const ID = 'demo-quiet-mesa';
const BODY = { slug: 'build9-demo', title: 'Build 9 demo' };

/** The tmux vocabulary, DERIVED. `agent/src/whitelist.ts` is the ONE definition
 *  of what a tmux argv may even be, so a sixth grant appearing there widens this
 *  pin automatically instead of silently escaping it. */
const TMUX_VERBS: readonly string[] = EXEC_WHITELIST.tmux.map((p) => p[0]!);

/** The same registry row `run-routes.test.ts`'s own `seed` writes, so a fixture
 *  session reads exactly like a real ccd one. */
const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: 'demo', workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/**
 * Panes scripted for a HAPPY `sendPrompt`: an empty box, our text echoed, the box
 * emptied again. This fixture deliberately gives an injecting mutant every chance
 * to succeed — no `not-alive`, no dialog, no draft — because the whole point of
 * the pin below is that it must not pass for the wrong reason.
 */
const PING_PANES = ['scrollback\n❯ \n', 'scrollback\n❯ ping\n', 'scrollback\n❯ \n'];

/**
 * `run-routes.test.ts`'s runner with ONE change, and it is the whole point: it
 * records `cmd` as well as the argv. That file's `calls.push(args)` throws the
 * command away, so `calls` cannot tell `tmux capture-pane` from a ccd verb — and
 * "no tmux I/O at all" is a statement about `cmd`.
 */
function makeRunner(panes: string[] = PING_PANES): { run: Runner; execs: string[][] } {
  const execs: string[][] = [];
  let capIdx = 0;
  const run: Runner = async (cmd, args) => {
    execs.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const p = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, execs };
}

const openApp = async (home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, coord, ...over });
  return { app, coord };
};

const post = (app: FastifyInstance, id = ID, payload: unknown = BODY) =>
  app.inject({ method: 'POST', url: `/api/sessions/${id}/kickoff`,
    payload: payload as Record<string, unknown> });

describe('POST /api/sessions/:id/kickoff — the four pre-queue arms', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('501 not-configured when this box does no coordination at all', async () => {
    // Unlike `/api/fleet` and `/api/sessions/:id`, which degrade without a
    // store because they must work on a box with no coordination, this route
    // cannot: no coord, no durable mail, so a 200 here would be a promise
    // nothing kept. `{ok:false,error:...}` — NOT the push routes' bare
    // `{error:...}`, which is a different shape for a different reason.
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run, { coord: undefined }); app = w.app;
    const res = await post(app);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toMatchObject({ ok: false, error: 'not-configured' });
  });

  it('400 bad-session-id for an id that is not a safe session name', async () => {
    const home = mkTmp('ccrc-kick-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await post(app, '..%2Fetc');
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-session-id' });
  });

  it.each([
    ['an empty body', {}],
    ['a blank slug', { slug: '   ', title: 'T' }],
    ['a blank title', { slug: 's', title: '' }],
    ['a slug of the wrong type', { slug: 7, title: 'T' }],
    ['no title key', { slug: 's' }],
  ])('400 bad-request for %s', async (_label, payload) => {
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await post(app, ID, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('400 bad-request for NO body at all — the shape the auth sweep probes with', async () => {
    // Its own test, not an `it.each` row: `post`'s default parameter would
    // substitute the VALID body for an `undefined` argument, and the first draft
    // of this file did exactly that and reported green. `auth-gate.test.ts`'s
    // drift loop injects every route with no payload, so this is the shape that
    // decides whether dark and authenticated agree — it has to be real.
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await app.inject({ method: 'POST', url: `/api/sessions/${ID}/kickoff` });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  // THE PAIR THIS ROUTE EXISTS NOT TO COLLAPSE. `knownId` (`server.ts`) folds an
  // unlistable registry into "unknown" by design, for a keystroke route where
  // fail-shut is right; 16 callers turn that single `false` into a bare 404. A
  // kickoff route on that gate would tell the sheet "that session does not
  // exist" when the truth is "this box could not read its registry", and the
  // sheet — having lost its toast-only retry — would have nothing to act on.
  // Same split, same two bodies, as `POST /api/sessions/:id/stop`.
  it('503 registry-unmeasurable when the registry DIRECTORY cannot be listed', async () => {
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    const w = await openApp(home, run, { io: unlistable }); app = w.app;
    const res = await post(app);
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
  });

  it('STILL QUEUES when the row is listed but a field will not read — this route needs presence, not identity', async () => {
    // Written first as a 503, to mirror `/api/sessions/:id/stop`, and MEASURED
    // 200 — the code was right and the expectation was wrong, so the
    // expectation moved. `readSessionRecord` answers `found: true` with a
    // degraded record for an unreadable FIELD; `reason: 'unlistable'` is the
    // whole-directory collapse alone. `/stop` adds a SECOND gate on
    // `measuredIdentity` because `stopPair` recomputes a wrapper/project pair
    // into an argv that kills a tmux session BY NAME — a guessed field there is
    // a wrong session killed.
    //
    // This route recomputes nothing: it addresses mail by the id in its own
    // path, which the listing proved present, and the delivery lane re-measures
    // the recipient itself and refuses to park a degraded row. Refusing here
    // would deny a coordinator its brief over a field neither the route nor the
    // lane ever reads. Pinned as a positive, so that adding an identity gate is
    // a decision somebody makes on purpose rather than a copy-paste from the
    // sibling route.
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run, { io: unreadableField(ID, 'wrapper') }); app = w.app;
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, queued: true });
    expect(w.coord.dueDeliveries(Date.now(), 60_000).length).toBe(1);
  });

  it('404 unknown-session for an id the registry PROVES absent', async () => {
    // The directory exists and lists cleanly — it just does not name this id.
    // Without that, the fixture would prove `unlistable`, not `absent`, and
    // would pass against a draft that answered 404 for both.
    const home = mkTmp('ccrc-kick-');
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await post(app);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ ok: false, error: 'unknown-session' });
  });
});

describe('POST /api/sessions/:id/kickoff — what it queues, and what it answers twice', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('200 queued:true, and the mail is really in the lane', async () => {
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await post(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, queued: true });

    const due = w.coord.dueDeliveries(Date.now(), 60_000);
    expect(due.length).toBe(1);
    expect(due[0]).toMatchObject({ toId: ID });
    expect(due[0]!.envelope).toContain(`subject: ${PROGRAM_KICKOFF_SUBJECT}`);
    expect(due[0]!.envelope).toContain(programKickoff(BODY.slug, BODY.title));
  });

  it('200 queued:false on the second call, and queues nothing more', async () => {
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    expect((await post(app)).json()).toMatchObject({ ok: true, queued: true });
    const second = await post(app);
    expect(second.statusCode).toBe(200);
    expect(second.json()).toMatchObject({ ok: true, queued: false });
    expect(w.coord.dueDeliveries(Date.now(), 60_000).length).toBe(1);
  });

  // WAVE-4 REVIEW, MINOR 2 (D-1119). `server.ts` builds Fastify with no
  // `bodyLimit` override, so the ceiling on what reaches this handler is
  // Fastify's 1 MiB default — three orders of magnitude above the mail body
  // cap. The seam refuses; this pins that the route says so in the house
  // shape (`413 oversize` with its `limit`, same as the claims and ledger
  // caps) and that nothing was written on the way to saying it.
  it('413 oversize for a title that pushes the body past the mail cap, and queues NOTHING', async () => {
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await post(app, ID, { slug: BODY.slug, title: 'x'.repeat(64 * 1024) });
    expect(res.statusCode).toBe(413);
    expect(res.json()).toMatchObject({ ok: false, error: 'oversize', limit: MAIL_BODY_MAX_BYTES });
    expect(w.coord.dueDeliveries(Date.now(), 60_000)).toEqual([]);
  });

  it('a 413 is not a dedupe — the session can still be kicked off with a sane title', async () => {
    // The refusal writes nothing, so it cannot occupy the outstanding-mail key
    // the dedupe reads. A cap that refused by queueing a truncated row would
    // fail this.
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    expect((await post(app, ID, { slug: BODY.slug, title: 'x'.repeat(64 * 1024) })).statusCode).toBe(413);
    expect((await post(app)).json()).toMatchObject({ ok: true, queued: true });
    expect(w.coord.dueDeliveries(Date.now(), 60_000).length).toBe(1);
  });
});

// THE PIN THE BRIEF ASKS FOR BY NAME, spelled "no tmux I/O at all".
//
// Spelling it `expect(calls.some((c) => c[0] === 'send-keys')).toBe(false)` —
// the shape `run-routes.test.ts` uses for the wave brief — is VACUOUS on any
// fixture whose pane is not live. `sendPrompt`'s first act is `captureAnsi`
// (`tmux capture-pane`), and every refusal it owns returns after that capture
// and before the type loop: `not-alive` (any runner answering code!==0, which
// `testDeps`' own default runner does), `dialog-open`, `draft-present`. So a
// route that genuinely calls `sendPrompt` records zero `send-keys`.
//
// MEASURED, not argued (2026-08-30). With the route mutated to call
// `sendPrompt` AND this file's runner answering code 1 for `capture-pane`, the
// send-keys-only spelling of the assertion below reported **1 passed** — the
// mutant walked straight past it. Both changes reverted; the numbers above are
// from that run. This is the same substitution `coord-abandon.test.ts` had to
// make after its own narrower pin watched a mutant walk past: THE PIN IS "NO
// I/O AT ALL", and the fixture below keeps a LIVE pane so the stronger pin is
// measured against a mutant that really could have typed.
describe('the kickoff route queues; it never injects', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('touches tmux NOT ONCE — no capture, no keystroke — and the kickoff still lands as mail', async () => {
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run, execs } = makeRunner();
    const w = await openApp(home, run); app = w.app;

    expect((await post(app)).statusCode).toBe(200);

    expect(execs.filter((c) => c[0] === 'tmux')).toEqual([]);
    expect(execs.filter((c) => TMUX_VERBS.includes(c[1] ?? ''))).toEqual([]);
    // …and the durable half in the same test, so "no tmux" cannot be satisfied
    // by a route that does nothing at all.
    expect(w.coord.dueDeliveries(Date.now(), 60_000).length).toBe(1);
  });

  it('CONTROL: this same recorder DOES see tmux when something really injects', async () => {
    // A pin over a recorder that never fires passes everything. The control is
    // the neighbouring route this wave deliberately leaves alone — the operator
    // still types into a session, and `POST /api/sessions/:id/prompt` is still
    // how. Its presence here is the proof that the assertion above is a
    // measurement rather than a wish.
    const home = mkTmp('ccrc-kick-');
    seed(home, ID);
    const { run, execs } = makeRunner();
    const w = await openApp(home, run); app = w.app;

    await app.inject({ method: 'POST', url: `/api/sessions/${ID}/prompt`, payload: { text: 'ping' } });

    expect(execs.filter((c) => c[0] === 'tmux').length).toBeGreaterThan(0);
    expect(execs.filter((c) => TMUX_VERBS.includes(c[1] ?? '')).length).toBeGreaterThan(0);
  });
});
