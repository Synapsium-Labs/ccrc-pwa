// The caps door. Before it, `CoordStore.setCaps` had NO caller anywhere in
// `server/src` (D-1164): the only way to change `maxConcurrentWorkers` or
// `maxSessionsPerDay` was to edit `coord.db` by hand.
//
// Its POSTURE is the part worth reading twice. NOT box-token — the box token
// gates MACHINE lanes, callers on the fleet host with no cookie jar, and an
// operator turning a dial in the PWA is not one. NOT `UNGATED` either —
// `UNGATED` is the D-282 family, whose whole argument is that the party locked
// out is the party holding the key, and raising a cap releases no wedge
// (D-1240). Session-gated when armed, open dark, like every other same-origin
// PWA write. `coord-pause-route.test.ts` holds both halves of that.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import type { CcdResult } from '../src/lifecycle.js';
import { CAP_MAX, CAP_MIN } from '../src/coord/caps.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '..', 'src');

/** The shipped defaults, seeded by migration 1 — every partial-write assertion
 *  below is stated against these rather than re-reading them, so a changed
 *  default is a failing test rather than a silently-rebased expectation. */
const DEFAULTS = { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 };

const apps: FastifyInstance[] = [];
afterEach(async () => { while (apps.length) await apps.pop()!.close(); });

const withCoord = async (over: Partial<Deps> = {}) => {
  const home = mkTmp('ccrc-caps-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const db = openCoordDb(path.join(home, '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
  await notifyLog.load();
  const app = await buildServer({ ...testDeps(home), coord, notifyLog, ...over });
  apps.push(app);
  // `db` is handed back for ONE test: the singleton `coordinator_state` row is
  // reachable through no public method, and D-1164's disagreement between
  // `setCaps` (silent no-op) and `caps()` (throws) is only observable without it.
  return { app, coord, notifyLog, db };
};

/** A box with no coordination database — no `coord` key at all, the same shape
 *  `run-routes.test.ts` uses for its own not-configured cases. */
const withoutCoord = async () => {
  const app = await buildServer(testDeps(mkTmp('ccrc-caps-none-')));
  apps.push(app);
  return { app };
};

const getCaps = (app: FastifyInstance) => app.inject({ method: 'GET', url: '/api/coord/caps' });
const postCaps = (app: FastifyInstance, payload: unknown) =>
  app.inject({ method: 'POST', url: '/api/coord/caps', payload: payload as Record<string, unknown> });

describe('GET /api/coord/caps', () => {
  it('answers the stored limits and the derived usage', async () => {
    const { app, coord } = await withCoord();
    coord.setCaps({ maxConcurrentWorkers: 4, maxSessionsPerDay: 16 });
    const res = await getCaps(app);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true,
      caps: { maxConcurrentWorkers: 4, maxSessionsPerDay: 16 },
      usage: { running: 0, dispatchedIn24h: 0 } });
  });

  it('answers 501 not-configured on a box with no coordination database', async () => {
    // The arm `POST /api/coord/pause` deliberately does NOT have, because a
    // pause is a marker file and a box with no database can still be paused.
    // Caps are rows, and `caps()` casts an undefined row rather than returning
    // null — copying pause's opening verbatim ships a route that throws (D-1166).
    const { app } = await withoutCoord();
    const res = await getCaps(app);
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'not-configured' });
  });

  it('reports usage a dispatched run actually moved', async () => {
    // The fixture that could witness the change: without it, `running: 0` above
    // is satisfied by a query that always answers zero.
    const { app, coord } = await withCoord();
    const r = coord.openRun({ program: 'p', title: 'P', project: 'demo',
      wave: 1, waveOf: 8, claimedBy: 'the-coordinator' }) as { id: number };
    coord.markDispatched(r.id, 'the-worker', 'ws', 'ws/ws', false);
    expect((await getCaps(app)).json().usage).toEqual({ running: 1, dispatchedIn24h: 1 });
  });
});

describe('POST /api/coord/caps', () => {
  it('writes a partial and answers what was STORED', async () => {
    const { app, coord } = await withCoord();
    const res = await postCaps(app, { maxConcurrentWorkers: 5 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true,
      caps: { maxConcurrentWorkers: 5, maxSessionsPerDay: DEFAULTS.maxSessionsPerDay },
      usage: { running: 0, dispatchedIn24h: 0 } });
    // …and it really landed in the store, not merely in the reply.
    expect(coord.caps()).toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 12 });
  });

  it('takes the other field alone, leaving the first untouched', async () => {
    const { app, coord } = await withCoord();
    await postCaps(app, { maxSessionsPerDay: 20 });
    expect(coord.caps()).toEqual({ maxConcurrentWorkers: 3, maxSessionsPerDay: 20 });
  });

  it('refuses a bad body with the policy detail, and writes NOTHING', async () => {
    const { app, coord } = await withCoord();
    const before = coord.caps();
    const res = await postCaps(app, { maxConcurrentWorkers: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-request',
      detail: `maxConcurrentWorkers must be an integer between ${CAP_MIN} and ${CAP_MAX}` });
    expect(coord.caps()).toEqual(before);
  });

  it('refuses a body that asks for nothing', async () => {
    const { app } = await withCoord();
    const res = await postCaps(app, {});
    expect(res.statusCode).toBe(400);
    expect(res.json().detail).toContain('at least one of');
  });

  it('answers 501 not-configured on a box with no coordination database', async () => {
    const { app } = await withoutCoord();
    expect((await postCaps(app, { maxConcurrentWorkers: 5 })).statusCode).toBe(501);
  });

  it('records a coord feed event naming the old value and the new', async () => {
    const { app, coord } = await withCoord();
    await postCaps(app, { maxConcurrentWorkers: 5 });
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.kind).toBe('coord');
    expect(ev.body).toContain('3');
    expect(ev.body).toContain('5');
  });

  it('records NO feed event when the body is refused', async () => {
    const { app, coord } = await withCoord();
    const before = coord.feedEvents(10).length;
    await postCaps(app, { maxConcurrentWorkers: 0 });
    expect(coord.feedEvents(10).length).toBe(before);
  });

  it('writes NO run_events row — there is no run to attribute it to', async () => {
    // `recordRunEvent` would write fromState === toState, which `pushNewRuns`
    // skips outright: the row would land and be seen by nobody. The premise is
    // established rather than assumed — a run EXISTS here, so a route reaching
    // for `recordRunEvent` would have something to write against.
    const { app, coord } = await withCoord();
    const r = coord.openRun({ program: 'p', title: 'P', project: 'demo',
      wave: 1, waveOf: 8, claimedBy: 'the-coordinator' }) as { id: number };
    const before = coord.runEvents(r.id).length;
    await postCaps(app, { maxConcurrentWorkers: 5 });
    expect(coord.runEvents(r.id).length).toBe(before);
  });

  it('still writes the caps when there is no notify log to record into, and says NOTHING about it', async () => {
    // The seam: a missing NotifyLog degrades the RECORD, never the write. The
    // opposite collapse — refusing the operator's write because the feed archive
    // is unavailable — is what the status assertion guards.
    //
    // The console assertion guards the OTHER half, and it is the half a
    // try/catch alone cannot give (measured: deleting the `if (log)` guard
    // leaves every status assertion green, because the throw lands in the
    // catch). A box with no feed configured is not a box whose feed write
    // FAILED, and a warning on every caps write would collapse the two in the
    // one place an operator would look.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { app, coord } = await withCoord({ notifyLog: undefined });
      const res = await postCaps(app, { maxSessionsPerDay: 20 });
      expect(res.statusCode).toBe(200);
      expect(coord.caps().maxSessionsPerDay).toBe(20);
      expect(warn.mock.calls.flat().join(' '), 'a box with no feed warned as though a write had failed')
        .not.toContain('recordFeedEvent');
    } finally { warn.mockRestore(); }
  });

  it('a refused body does not reach the store even if the handler kept going', async () => {
    // The ordering IS the guard here — decide, then write — so the mutation that
    // tests it is the slip that actually happens: a refusal that sends its 400
    // without RETURNING. The `writes NOTHING` assertion above cannot see that,
    // because fastify keeps the first reply; only the store can.
    const { app, coord } = await withCoord();
    const before = coord.caps();
    await postCaps(app, { maxSessionsPerDay: CAP_MAX + 1 });
    expect(coord.caps()).toEqual(before);
    expect(coord.feedEvents(10)).toEqual([]);
  });

  it('writes the caps even when the feed archive itself THROWS', async () => {
    // The try/catch around `recordFeedEvent`, which shipped with no row of its
    // own until the self-review asked for one. `recordFeedEvent` throws
    // SYNCHRONOUSLY (`node:sqlite`), so without the catch the operator's write
    // lands and the response is a 500 — the worst pair available, since the
    // caller then retries a write that already succeeded.
    //
    // The throw is manufactured by removing the table the feed writes to, which
    // needs the raw db handle: no public method can put the store in this state.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { app, coord, db } = await withCoord();
      db.prepare('DROP TABLE feed_events').run();
      const res = await postCaps(app, { maxConcurrentWorkers: 5 });
      expect(res.statusCode).toBe(200);
      expect(coord.caps().maxConcurrentWorkers).toBe(5);
      // …and it SAYS the archive degraded, rather than failing silently — this
      // is the case where a warning is the honest output, unlike the
      // no-notify-log case above where it would be noise.
      expect(warn.mock.calls.flat().join(' ')).toContain('recordFeedEvent failed');
    } finally { warn.mockRestore(); }
  });

  it('persists the seq it minted on the ordinary path', () => {
    // The floor for the row beneath it. `record()` bumps the in-memory seq and
    // hands it to a client; `flush()` is what makes that seq survive a restart.
    //
    // WHY THIS ARM EXISTS, corrected (D-1237). It first said the throw-path row
    // "could be satisfied by a route that had simply stopped flushing at all",
    // which is backwards — a route that never flushes REDS that row. Measured:
    // with the flush back inside the try, the throw arm fails and this one
    // passes. What this arm actually holds is the other direction: that the fix
    // did not become "flush only when the archive threw". The two together pin
    // the property — the flush follows `record()`, on both paths.
    return withCoord().then(async ({ app, notifyLog }) => {
      const flush = vi.spyOn(notifyLog, 'flush');
      await postCaps(app, { maxConcurrentWorkers: 5 });
      expect(flush, 'the caps write minted a seq and never persisted it').toHaveBeenCalled();
    });
  });

  it('persists that seq even when the feed archive THROWS — the case the try/catch exists for', async () => {
    // D-1213. `void log.flush()` shipped INSIDE the try, AFTER
    // `recordFeedEvent`, which throws synchronously (`node:sqlite`) — so on
    // exactly the failure the catch was written for, the flush was skipped.
    // `record()` had already spent the seq, and `NotifyLog.flush`'s own
    // docstring names the consequence: "a seq handed to a client but never
    // persisted lets a restart re-mint the same {epoch, seq} pair for a
    // different event", which is the stale-but-valid landing `catchUp` cannot
    // tell from the truth.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const { app, notifyLog, db } = await withCoord();
      const flush = vi.spyOn(notifyLog, 'flush');
      db.prepare('DROP TABLE feed_events').run();
      const res = await postCaps(app, { maxConcurrentWorkers: 5 });
      expect(res.statusCode).toBe(200);
      // THE PREMISE, ASSERTED (D-1229). This test creates the `warn` spy that
      // would prove the archive threw and then never read it — so the day
      // `recordFeedEvent` stops throwing (a `try {} catch {}` inside it would do
      // it), this case degenerates into a duplicate of the ordinary-path arm
      // above and stays GREEN with the flush back inside the try. Measured
      // exactly that way: with D-1213 reverted AND the store's throw swallowed,
      // the pre-existing sibling at the top of this pair fails on its own premise
      // assertion while this one passed. The sibling had the line; this one was
      // copied from it down to the spy and stopped short of it.
      expect(warn.mock.calls.flat().join(' '),
        'the feed archive never threw — this case is no longer about the throw path')
        .toContain('recordFeedEvent failed');
      expect(flush, 'the archive throw skipped the flush — the minted seq was never persisted')
        .toHaveBeenCalled();
    } finally { warn.mockRestore(); }
  });

  it('two concurrent partial writes both land', async () => {
    // WHAT THIS PINS, AND WHAT IT DOES NOT — measured, not assumed.
    //
    // It pins the end-to-end property: two disjoint dials written together both
    // survive, in either order. That is worth having.
    //
    // It does NOT witness the self-review's MAJOR (the merge base being read
    // outside `coordMutex.run`). Measured: reverting the fix — capturing
    // `coord.caps()` before the lock and merging onto that — leaves THIS test
    // GREEN, because `app.inject` does not interleave the two handlers'
    // synchronous prologues; the second request's read happens after the
    // first's write.
    //
    // WHAT THIS COMMENT USED TO SAY, AND WHY IT WAS WRONG (D-1211): that
    // reproducing the lost update needed a third actor holding the mutex across
    // a real await, "which no fixture in this suite can stage". The first half
    // is right and the second half was never measured — `POST /api/runs` with a
    // `sessionId` awaits `deps.runCcd` inside `coordMutex.run`, and injecting a
    // runner that waits is about forty lines. The test that does it is directly
    // below. Unmeasured is not unmeasurable, and recording the second as the
    // first is the same dodge this file's own `SESSION_ONLY` note refuses one
    // suite over.
    const { app, coord } = await withCoord();
    await Promise.all([
      postCaps(app, { maxConcurrentWorkers: 5 }),
      postCaps(app, { maxSessionsPerDay: 20 }),
    ]);
    expect(coord.caps()).toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 20 });
  });

  it('holds the merge base under the lock while a THIRD actor keeps it across a real await', async () => {
    // THE WITNESS THE SELF-REVIEW SAID COULD NOT BE STAGED (D-1211). The
    // sibling case above pins the end-to-end property and does NOT see the lost
    // update, because `app.inject` never interleaves two handlers' synchronous
    // prologues. That was recorded here as unmeasurable. It was merely
    // UNMEASURED: `POST /api/runs` with a `sessionId` awaits `deps.runCcd` for
    // its `ws-hold` INSIDE `coordMutex.run`, so a runner that signals on entry
    // and then waits holds the lock across a real await — which is exactly the
    // third actor the hazard needs, and it is already in this server.
    //
    // With the merge base read OUTSIDE the lock, both saves read `{3, 12}`
    // while the hold is in flight and the second writes the first's field back
    // unchanged. With it read inside, the second reads what the first stored.
    const TOKEN = 'f'.repeat(64);
    let signalHeld = (): void => {};
    const held = new Promise<void>((r) => { signalHeld = () => r(); });
    let release = (): void => {};
    const gate = new Promise<void>((r) => { release = () => r(); });
    const runCcd = async (): Promise<CcdResult> => {
      signalHeld();
      await gate;
      return { ok: true, stdout: '', stderr: '', killed: false, signal: null };
    };

    const { app, coord } = await withCoord({ mailToken: TOKEN, runCcd });
    // The instrument for "both prologues have run". Counting `caps()` reads is
    // deterministic under BOTH spellings — the shape probe outside the lock is
    // one per request either way — so this wait cannot pass for one variant and
    // hang for the other, which a fixed number of event-loop turns could.
    const reads = vi.spyOn(coord, 'caps');
    const waitUntil = async (p: () => boolean, what: string): Promise<void> => {
      for (let i = 0; i < 2000; i++) {
        if (p()) return;
        await new Promise((r) => setImmediate(r));
      }
      throw new Error(`timed out waiting for ${what}`);
    };

    const opening = app.inject({ method: 'POST', url: '/api/runs',
      headers: { 'x-ccrc-mail-token': TOKEN },
      payload: { program: 'p', title: 'P', project: 'demo', wave: 1, waveOf: 8,
                 claimedBy: 'the-coordinator', sessionId: 'the-worker' } });

    // PREMISE 1 — THE HOLD IS REACHED AT ALL, and it fails FAST if it is not
    // (D-1228). `POST /api/runs` has three early returns before `runCcd` — a 400
    // body check, a 409 `openRun` refusal and a 501 `verbSupported` — and every
    // one of them leaves `held` pending for ever. A bare `await held` then hangs
    // to the 20s vitest ceiling and reports a timeout, which says nothing about
    // which premise died. Racing the response against it turns that into one
    // sentence in milliseconds.
    const brokenPremise = opening.then((r) => {
      throw new Error(`POST /api/runs answered ${r.statusCode} without ever reaching ` +
        'the hold — the third actor never took the lock, and this test witnesses nothing');
    });
    // The loser of a race is still a rejection; handled here so it cannot surface
    // as an unhandled rejection after `held` wins.
    brokenPremise.catch(() => {});
    await Promise.race([held, brokenPremise]);

    const settled: number[] = [];
    const saves = [postCaps(app, { maxConcurrentWorkers: 5 }),
                   postCaps(app, { maxSessionsPerDay: 20 })]
      .map((p) => p.then((r) => { settled.push(r.statusCode); return r; }));
    await waitUntil(() => reads.mock.calls.length >= 2, 'both caps prologues to run');

    // PREMISE 2 — THE LOCK IS ACTUALLY HELD, measured rather than assumed, and
    // this is the assertion the first version of this test did not have
    // (D-1228). It checked `openRes.statusCode === 200` and called that the
    // premise; a 200 says the route ANSWERED, not that it held anything.
    // Measured on an isolated copy: revert D-1170 *and* take `coordMutex.run` off
    // `POST /api/runs`, and the old test passed — green with the lost update in
    // the tree, exactly the failure class D-1215 fixed one file over. A caps
    // write that can finish while the hold is in flight proves there was no lock
    // to queue behind, so nothing below this line means anything.
    //
    // Twenty turns is not a timing guess: an unblocked `coordMutex.run` resolves
    // in a microtask, and `app.inject` needs a handful of turns end to end, so a
    // save that has not settled after twenty is queued rather than merely slow.
    for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
    expect(settled,
      'a caps write completed while the hold was in flight — the mutex is NOT held ' +
      'across the await, so this test witnesses nothing').toEqual([]);

    release();
    const [openRes, ...capRes] = await Promise.all([opening, ...saves]);
    expect(openRes.statusCode).toBe(200);
    for (const r of capRes) expect(r.statusCode).toBe(200);
    expect(coord.caps(),
      'one save read its merge base before the other wrote — a lost update')
      .toEqual({ maxConcurrentWorkers: 5, maxSessionsPerDay: 20 });
  });

  it('accepts the boundary values the policy allows', async () => {
    const { app, coord } = await withCoord();
    expect((await postCaps(app, { maxConcurrentWorkers: CAP_MAX })).statusCode).toBe(200);
    expect(coord.caps().maxConcurrentWorkers).toBe(CAP_MAX);
    expect((await postCaps(app, { maxConcurrentWorkers: CAP_MIN })).statusCode).toBe(200);
    expect(coord.caps().maxConcurrentWorkers).toBe(CAP_MIN);
  });

  it('fails LOUDLY when the singleton caps row is gone', async () => {
    // WHAT THIS PINS, stated exactly, because a first draft of this comment
    // claimed more: that answering `decided.next` instead of the re-read
    // `coord.caps()` would be caught here. It would NOT. The route reads
    // `caps()` as `before` in its very first statement, so a missing row throws
    // there and both spellings answer 500 — measured. The re-read is a
    // truthfulness choice with no observable consequence (see the plan's
    // mutation table), not a guard, and this test does not pretend otherwise.
    //
    // What it DOES pin is D-1164's disagreement reaching the caller as a fault
    // rather than as a success: `setCaps` is `UPDATE … WHERE id = 1` returning
    // `void`, so with the row gone it changes nothing and reports nothing, while
    // `caps()` casts an undefined row and throws. A route that swallowed that
    // would answer 200 for a write that did not happen.
    const { app, db } = await withCoord();
    db.prepare('DELETE FROM coordinator_state WHERE id = 1').run();
    const res = await postCaps(app, { maxConcurrentWorkers: 5 });
    expect(res.statusCode).toBe(500);
    expect(res.body).not.toContain('"maxConcurrentWorkers":5');
  });

  it('needs NO box token — it is an operator dial, not a machine lane', async () => {
    // Stated here as behaviour; `coord-pause-route.test.ts` holds it
    // structurally, in both directions, against the source.
    const { app } = await withCoord();
    const res = await app.inject({ method: 'POST', url: '/api/coord/caps',
      headers: { 'x-ccrc-mail-token': 'wrong-token-entirely' },
      payload: { maxConcurrentWorkers: 5 } });
    expect(res.statusCode).toBe(200);
  });
});

/** Blank out comments and string/template bodies, preserving byte positions and
 *  newlines — `dispatch-mutex-gate.test.ts`'s own helper, copied unchanged, so a
 *  call site mentioned only in prose is invisible to the scanner. */
function blankCommentsAndStrings(text: string): string {
  const out = text.split('');
  const blank = (a: number, b: number): void => {
    for (let k = a; k < b; k++) if (out[k] !== '\n') out[k] = ' ';
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const d = text[i + 1];
    if (c === '/' && d === '/') {
      const j = text.indexOf('\n', i);
      const e = j < 0 ? text.length : j;
      blank(i, e); i = e;
    } else if (c === '/' && d === '*') {
      const j = text.indexOf('*/', i + 2);
      const e = j < 0 ? text.length : j + 2;
      blank(i, e); i = e;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < text.length) {
        if (text[j] === '\\') j += 2;
        else if (text[j] === c) break;
        else j++;
      }
      blank(i + 1, Math.min(j, text.length));
      i = Math.min(j + 1, text.length);
    } else i++;
  }
  return out.join('');
}

const sourcesUnder = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name.startsWith('__')) return [];
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sourcesUnder(full);
    return /\.tsx?$/.test(e.name) ? [full] : [];
  });

/** Slice one route handler's body out of `coord/routes.ts`: from its own
 *  registration to the next one, the same slice `box-token-census.test.ts` and
 *  `auth-gate.test.ts:405-413` take. Fails LOUDLY on a missing anchor, because
 *  `''` satisfies every assertion made about it.
 *
 *  ADDRESSED IN THE RAW TEXT, READ FROM THE BLANKED COPY — the two are the same
 *  length by construction (`blankCommentsAndStrings` overwrites in place and
 *  keeps every newline), so one set of offsets addresses both. It has to work
 *  that way: the anchor is a route path, which lives INSIDE a string literal and
 *  is therefore blanked out of the copy being searched. Measured — the first
 *  draft searched the blanked text and found nothing, and said so. */
const handlerBody = (raw: string, blanked: string, decl: string): string => {
  expect(blanked.length, 'the blanked copy no longer aligns with the source')
    .toBe(raw.length);
  const at = raw.indexOf(decl);
  expect(at, `the ${decl} registration is gone — this scan is over nothing`).toBeGreaterThan(-1);
  const next = /app\.(?:get|post)\('/.exec(raw.slice(at + decl.length));
  const end = next === null ? raw.length : at + decl.length + next.index;
  const body = blanked.slice(at, end);
  expect(body.length, `the ${decl} body is too short to be a handler`).toBeGreaterThan(40);
  return body;
};

describe('the caps answer shape is defined ONCE, and both halves send it', () => {
  // D-1212, and it is the coordinator's own ruling getting the mechanism it
  // asked for. The ruling was "the read must not carry a copy of what the write
  // answers"; the fix was `capsView()`; and the row recorded for it measured a
  // mutation that changed the VALUES the GET reports, not one that undoes the
  // sharing. A FAITHFUL inline rebuild — `{ ok: true, caps: c.caps(), usage:
  // c.capsUsage() }` — reds nothing at all, which was measured across all ten
  // suites that touch caps.
  //
  // AND IT IS A TEXT SCAN, NOT A PROPERTY — said plainly, because the wave that
  // produced it is about claims that outrun their mechanism. It catches the
  // mutation the ruling named and every careless respelling of it; an adversarial
  // rewrite that rebuilds the GET inline while keeping the token `capsView(` in
  // the handler's text, and reads the usage through some other spelling, defeats
  // both arms. A real property check would need the two responses compared at
  // runtime. This is the cheap guard that reds on the realistic edit.
  const raw = (): string => readFileSync(path.join(srcRoot, 'coord', 'routes.ts'), 'utf8');

  it('both halves build their answer from the shared builder', () => {
    const r = raw();
    const b = blankCommentsAndStrings(r);
    expect(/const capsView\s*=/.test(b),
      'the shared builder is gone under this name — the scan below is over nothing').toBe(true);
    for (const decl of ["app.get('/api/coord/caps'", "app.post('/api/coord/caps'"]) {
      expect(handlerBody(r, b, decl), `${decl} builds its own answer instead of the shared one`)
        .toContain('capsView(');
    }
  });

  it('…and the usage half is read in exactly one place, so a rebuild cannot be faithful', () => {
    // `capsUsage` is the discriminator, and deliberately so: `caps()` has other
    // legitimate callers in this file (the shape probe and the merge base both
    // read it), while the usage reading exists for this answer alone. Any
    // rebuild of the shape — faithful or not — has to spell it a second time.
    const sites = [...blankCommentsAndStrings(raw()).matchAll(/\.capsUsage\(/g)].length;
    expect(sites,
      'the usage reading is taken more than once — one half of the answer is being rebuilt')
      .toBe(1);
  });
});

describe('the caps door is the ONE caller of setCaps', () => {
  it('setCaps is called from exactly one file in server/src, and it is the route', () => {
    // The negative half needs a positive floor or a regex that stopped matching
    // satisfies it vacuously — the failure mode this tree names by name.
    const files = sourcesUnder(srcRoot);
    expect(files.length, 'the source walk found nothing — this scan is over nothing')
      .toBeGreaterThan(30);
    const callers = files
      .filter((f) => !f.endsWith(path.join('coord', 'store.ts')))       // the DECLARATION lives here
      .filter((f) => /\bsetCaps\s*\(/.test(blankCommentsAndStrings(readFileSync(f, 'utf8'))))
      .map((f) => path.relative(srcRoot, f));
    expect(callers).toEqual([path.join('coord', 'routes.ts')]);
  });

  it('…and the scanner can actually see a call site — it is not matching nothing', () => {
    // Anti-vacuity for the scanner itself: the declaration file DOES contain the
    // token, so a scanner that had silently stopped matching would fail here.
    const store = blankCommentsAndStrings(
      readFileSync(path.join(srcRoot, 'coord', 'store.ts'), 'utf8'));
    expect(/\bsetCaps\s*\(/.test(store)).toBe(true);
  });
});
