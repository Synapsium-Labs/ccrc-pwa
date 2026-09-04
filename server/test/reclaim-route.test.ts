// program-leverage wave 5 (F5) — `POST /api/runs/:id/reclaim`, the FOURTH ungated
// operator door. TDD red-first: every test below was written and run before the
// route existed, so the record shows it failed for the right reason.
//
// The DECISION half — `measureClaimant`'s three-step ladder, `reclaimRun`'s
// refusal order — is pinned in `coord-reclaim.test.ts`. What is pinned HERE is the
// ADAPTER: that each member of `ReclaimOutcome` reaches its own status with its
// own body (an L4 adapter may not narrow a distinction it received), that the
// door answers a caller holding no box token, and that a malformed id is refused
// before anything at all is measured.
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

const TOKEN = 'f'.repeat(64);
const PROGRAM = 'leverage';
const PROJECT = 'demo';
/** The coordinator that died. Deliberately NOT seeded in most fixtures: an id
 *  with no `.uuid` in a directory that listed cleanly is `measureClaimant`'s
 *  step-1 `dead` — the shortest honest death this suite can build, and the one
 *  that reaches it without a single tmux call. */
const DEAD = 'demo-coordinator-old';
const HEIR = 'demo-coordinator-new';

/** `coord-abandon.test.ts:30-38`'s registry row, field for field, so a fixture
 *  session reads exactly like a ccd one. */
const seed = (home: string, id: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project: PROJECT, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A runner whose only scripted verb is `tmux has-session`, answered per target.
 *  Anything not in `live` gets ccd's ONE death sentence verbatim: `exec.ts:98-101`
 *  recognises exactly `can't find session` as proof of death and calls every other
 *  failure `unknown`, so a fixture that improvised a stderr would be scripting
 *  `unmeasurable` by accident and passing for the wrong reason. `cmd` is recorded
 *  as well as the argv (`kickoff-route.test.ts:133`'s reason) — "nothing was
 *  measured" is a statement about `cmd`, which `calls.push(args)` cannot make. */
const makeRunner = (live: ReadonlySet<string> = new Set()): { run: Runner; execs: string[][] } => {
  const execs: string[][] = [];
  const run: Runner = async (cmd, args) => {
    execs.push([cmd, ...args]);
    if (cmd === 'tmux' && args[0] === 'has-session') {
      const t = args[2] ?? '';
      return live.has(t)
        ? { code: 0, stdout: '', stderr: '' }
        : { code: 1, stdout: '', stderr: `can't find session: ${t}` };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, execs };
};

const openApp = async (home: string, run: Runner, over: Partial<Omit<Deps, 'cfg'>> = {}) => {
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const base = testDeps(home, run);
  const app = await buildServer({ ...base, mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

/** One run of `PROGRAM`, claimed by `DEAD`. `openRun` answers a UNION — it can
 *  refuse a second coordinator — so the id is narrowed rather than destructured
 *  off the refusal shape (`coord-abandon.test.ts:70-73`). */
const openWave = (coord: CoordStore, wave: number, claimedBy = DEAD): number => {
  const opened = coord.openRun({
    program: PROGRAM, title: 'Program leverage', project: PROJECT, wave, waveOf: 8, claimedBy,
  });
  if (!('id' in opened)) throw new Error(`fixture openRun refused: ${JSON.stringify(opened)}`);
  return opened.id;
};

const post = (
  app: FastifyInstance, id: number | string, payload: unknown = { claimedBy: HEIR },
  headers: Record<string, string> = {},
) => app.inject({
  method: 'POST', url: `/api/runs/${id}/reclaim`, headers,
  payload: payload as Record<string, unknown>,
});

describe('POST /api/runs/:id/reclaim — the union→status map', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { await app?.close(); app = undefined; });

  it('200: EVERY run of the program moves to the heir, and the trail names the operator', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seed(home, HEIR);                     // the heir is real; the dead claimant is not
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const w1 = openWave(w.coord, 1);
    const w2 = openWave(w.coord, 2);

    const res = await post(app, w2);
    expect(res.statusCode).toBe(200);
    const body = res.json() as { runIds: number[] };
    // The KEY SET, not merely a subset: an adapter that dropped `from` would
    // leave `toMatchObject` green and leave the sheet unable to say what it
    // replaced.
    expect(Object.keys(body).sort()).toEqual(['from', 'ok', 'program', 'runIds', 'to']);
    expect(body).toMatchObject({ ok: true, program: PROGRAM, from: DEAD, to: HEIR });
    // Sorted: `reclaimProgram`'s SELECT carries no ORDER BY, and asserting an
    // incidental rowid order would pin sqlite's plan rather than the contract.
    expect([...body.runIds].sort((a, b) => a - b)).toEqual([w1, w2]);
    // RULING R1, as a mechanism: ALL of the program's runs, not just the one
    // named in the path. `openRun`'s guard (`store.ts:369-371`) and
    // `resolveCoordinator(null)` (`store.ts:1188-1191`) both read the LOWEST-id
    // claimed row with no state predicate, so a rewrite that spared wave 1
    // would leave both readers answering the corpse and the wedge intact.
    expect(w.coord.run(w1)!.claimedBy).toBe(HEIR);
    expect(w.coord.run(w2)!.claimedBy).toBe(HEIR);
    const ev = w.coord.runEvents(w1).at(-1)!;
    expect(ev.causedBy).toBe('operator');
    expect(ev.detail).toBe(`reclaim:${DEAD} -> ${HEIR}`);
  });

  it('404 unknown-run — measured BEFORE any registry read, so the heir need not exist', async () => {
    // Order, asserted as an absence: `reclaimRun` checks the run first, so an
    // unknown id answers with an unseeded heir and an untouched registry. A
    // reordered implementation would answer `unknown-session` here.
    const home = mkTmp('ccrc-reclaim-');
    const { run, execs } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const res = await post(app, 9999);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-run' });
    expect(execs).toEqual([]);
  });

  it('409 no-claimant for a reconstructed run whose claimedBy is NULL', async () => {
    // `reconstruct` inserts every rebuilt run with `claimedBy` bound to NULL
    // (`store.ts:361-368`) and no in-tree method writes that shape, so the row
    // is made the way `run-routes.test.ts:1329` already makes it.
    const home = mkTmp('ccrc-reclaim-');
    seed(home, HEIR);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);
    w.coord.db.prepare('UPDATE runs SET claimedBy = NULL WHERE id = ?').run(id);

    const res = await post(app, id);
    expect(res.statusCode).toBe(409);
    // `refused`, not `error`: this is a member of `ReclaimRefuseCode`, and the
    // repo spells a refusal code on `refused` (`sendCloseOutcome`'s own arm).
    expect(res.json()).toEqual({ ok: false, refused: 'no-claimant' });
  });

  it('404 unknown-session when the HEIR has no registry row', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seed(home, DEAD);                     // a listable directory, with no heir in it
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);
    const res = await post(app, id);
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    // …and the run did NOT move: a refusal that half-committed would be worse
    // than the wedge it was called to clear.
    expect(w.coord.run(id)!.claimedBy).toBe(DEAD);
  });

  it('502 registry-unmeasurable, with its detail, when the registry DIRECTORY will not list', async () => {
    // THE PAIR THIS ROUTE EXISTS NOT TO COLLAPSE, and the reason 404 and 502 are
    // two arms: "that session does not exist" and "this box could not read its
    // registry" are different facts and the operator acts differently on each.
    // 502, not `/api/sessions/:id/kickoff`'s 503 — this is the coord-route
    // family's status for the same condition (`sendDispatchOutcome`,
    // `routes.ts:147-151`).
    const home = mkTmp('ccrc-reclaim-');
    seed(home, HEIR);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);
    const unlistable: FleetIO = { ...localIO, readdir: async () => null };
    await app.close();
    const w2 = await openApp(home, run, { io: unlistable }); app = w2.app;

    const res = await post(app, id);
    expect(res.statusCode).toBe(502);
    const body = res.json() as { detail: string };
    expect(body).toMatchObject({ ok: false, error: 'registry-unmeasurable' });
    // The sentence rides along because the adapter RECEIVED it and cannot
    // recompute it — L1 measured which read failed, this layer did not.
    expect(body.detail.length).toBeGreaterThan(0);
  });

  it('409 claimant-alive names the holder and says how it was measured', async () => {
    const home = mkTmp('ccrc-reclaim-');
    seed(home, DEAD);
    seed(home, HEIR);
    const { run } = makeRunner(new Set([`cc-${DEAD}`]));
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);

    const res = await post(app, id);
    expect(res.statusCode).toBe(409);
    const body = res.json() as { detail: string };
    expect(body).toMatchObject({ ok: false, refused: 'claimant-alive', by: DEAD });
    // `why` survives the collapse to a code — `alive` is reached from a live
    // pane AND from a gone-but-restarting lifecycle, and the sheet must be able
    // to tell the operator which.
    expect(body.detail.length).toBeGreaterThan(0);
    expect(w.coord.run(id)!.claimedBy).toBe(DEAD);
  });

  it('501 not-configured on a box that does no coordination at all', async () => {
    // The FIRST arm, and `auth-gate.test.ts`'s three-probe sweep leans on it:
    // that harness wires no `coord`, so dark and authenticated both land here.
    const home = mkTmp('ccrc-reclaim-');
    const { run } = makeRunner();
    const w = await openApp(home, run, { coord: undefined }); app = w.app;
    const res = await post(app, 1);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it.each([
    ['an empty body', {}],
    ['a blank claimedBy', { claimedBy: '   ' }],
    ['a claimedBy of the wrong type', { claimedBy: 7 }],
    ['the abandon-shaped body, which names no heir', { intent: 'abandon' }],
  ])('400 bad-request for %s', async (_label, payload) => {
    const home = mkTmp('ccrc-reclaim-');
    seed(home, HEIR);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);
    const res = await post(app, id, payload);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
  });

  it('a NON-INTEGER id answers 400 before anything is measured — the sweep probe', async () => {
    // `auth-gate.test.ts:93`'s `concrete()` rewrites `:id` to `x` and injects
    // with NO payload at all, three times (dark, armed-anonymous, armed with a
    // session), and requires dark and authenticated to be EQUAL. That holds only
    // if the answer is decided before any IO — so it is asserted here rather
    // than inferred there. Injected directly, not through `post`: a default
    // parameter would substitute the valid body for `undefined` and report green
    // on a shape the sweep never sends (`kickoff-route.test.ts:129-134`).
    const home = mkTmp('ccrc-reclaim-');
    seed(home, HEIR);
    const { run, execs } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    openWave(w.coord, 1);
    const res = await app.inject({ method: 'POST', url: '/api/runs/x/reclaim' });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(execs, 'the malformed id reached a fleet act').toEqual([]);

    // …AND THE SAME MALFORMED ID CARRYING A VALID BODY. Measured at execution,
    // not predicted: with the bodyless probe alone, DELETING the
    // `Number.isInteger` arm outright left this whole suite GREEN, because the
    // `claimedBy` arm below it answers the empty payload first and shadows it.
    // A probe whose refusal has two possible authors measures neither.
    const withBody = await post(app, 'x');
    expect(withBody.statusCode).toBe(400);
    expect(withBody.json()).toEqual({ ok: false, error: 'bad-request' });

    // …AND BEFORE ANYTHING IS READ, which a status cannot say on its own: the
    // same arm moved BELOW `coordMutex.run` still answers 400, just after
    // `reclaimRun` has already gone to the store — also measured GREEN before
    // this was added. A store that throws on the read is how "nothing was
    // measured" becomes an assertion, the way `execs` states it for a fleet act.
    w.coord.run = () => { throw new Error('the malformed id reached the coordination store'); };
    const unread = await post(app, 'x');
    expect(unread.statusCode, 'the malformed id was refused only AFTER a store read').toBe(400);
    expect(unread.json()).toEqual({ ok: false, error: 'bad-request' });
    expect(execs, 'the malformed id reached a fleet act').toEqual([]);
  });

  it('answers WITHOUT the box token, and NEVER takes attribution from the body', async () => {
    // The `claims-routes.test.ts:292-305` shape, with the one difference this
    // door has: the body IS read. So both halves are asserted — no token is
    // needed (D-282), and the one field that is read is `claimedBy` and not the
    // provenance, which is a literal at the store call site.
    const home = mkTmp('ccrc-reclaim-');
    seed(home, HEIR);
    const { run } = makeRunner();
    const w = await openApp(home, run); app = w.app;
    const id = openWave(w.coord, 1);

    const res = await post(app, id, { claimedBy: HEIR, causedBy: 'coordinator', archive: true });
    expect(res.statusCode).toBe(200);
    expect(w.coord.runEvents(id).at(-1)!.causedBy).toBe('operator');
    // …and a WRONG token is not a refusal either: the route never consults the
    // header, so presenting garbage changes nothing.
    const id2 = openWave(w.coord, 2, HEIR);
    const wrong = await post(app, id2, { claimedBy: HEIR }, { 'x-ccrc-mail-token': 'a'.repeat(64) });
    expect(wrong.statusCode).toBe(200);
  });
});
