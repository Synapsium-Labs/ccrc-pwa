// `POST /api/asks/:id/answer` — the parent presses the digit into its
// child's live menu (Task 9, the ask pre-emption lane). The most
// safety-sensitive route in the lane: box token, then registry attribution
// (the box token proves only "a process on this box", never "this ask's
// parent"), then `ask.parentId === fromId`, then the instance guard
// (D-2170) and the row-CAS (D-2171) — both BEFORE `answerAsk` ever touches
// the pane.
//
// `POST /api/asks/:id/release` (Task 10) is the SAME lane's decline route,
// below — the verb that makes the grace window a CEILING rather than a
// flat tax on every ask the parent cannot rule on. Unlike `/answer`, it
// never touches the pane, so its own describe block below builds a real
// `FleetWatcher` alongside the server (the `fleetws.test.ts` idiom: watcher
// constructed first, sharing ONE `deps` object with `buildServer`) so the
// decline case can prove the deferred push actually fires — the thing
// `/answer`'s tests above have no need to set up at all.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildServer, type Deps } from '../src/server.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import type { Runner } from '../src/exec.js';
import { askKey } from '../src/askkey.js';
import { localIO, type FleetIO } from '../src/io.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { Bus } from '../src/bus.js';
import { FleetWatcher } from '../src/watch.js';
import type { PushPayload } from '../src/push.js';
import { hashLine, type ScryptParams } from '../src/auth/secret.js';
import { okAsk } from './coordReadHelpers.js';

const TOKEN = 'f'.repeat(64);
const TOK = { 'x-ccrc-mail-token': TOKEN };

// `GET /api/asks`'s own describe block (Task 11) arms `CCRC_AUTH` for real to
// exercise the session-cookie half of D-149's either-credential shape — the
// same fixture `peers-route.test.ts`'s ARMED case uses, at the same cheap
// cost factor so the suite is not paying scrypt's real ~100ms per login.
const FAST_PARAMS: ScryptParams = { n: 1024, r: 8, p: 1, keylen: 32 };
const PASSPHRASE = 'correct horse battery staple';

const CHILD = 'demo-quiet-mesa';
const PARENT = 'demo-coordinator';
const OTHER = 'demo-someone-else';
const CHILD_UUID = 'c'.repeat(36);
const PARENT_UUID = 'p'.repeat(36);
const OTHER_UUID = 'o'.repeat(36);

const QUESTION = { question: 'Which colour?', options: [{ label: 'Red' }, { label: 'Blue' }] };
// Non-null: a single-question envelope always has a key (askKey.ts's own
// contract — only an approval envelope or an empty questions array has none).
const ASK_KEY = askKey({ questions: [QUESTION] })!;
const ASK_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\nEnter to select\n';

const seed = (home: string, id: string, uuid: string): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields = { wrapper: 'claude', project: 'demo', workdir: `/w/demo/${id}`, uuid, started: '1' };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A fresh, waiting hookstate for the child, carrying `QUESTION` — the real
 *  wiring `freshAskAt` reads, not a stub (`routes.test.ts`'s `seedAsk` is the
 *  proven shape). `updatedAt` is the row this route re-measures against the
 *  stored `askAt` (D-2170). */
const seedHookstate = (home: string, id: string, uuid: string, updatedAt: number): void => {
  const reg = path.join(home, '.cc-sessions');
  writeFileSync(path.join(reg, `${id}.hookstate.json`), JSON.stringify({
    // D-2405: `PermissionRequest`, not `Notification`. `session-hook.sh` can
    // never write the latter (`*) exit 0` at `:1009`) and
    // `install-session-hooks.sh:37` registers it nowhere — measured against
    // all six live wrapper HOMEs, whose hook keys are identical and carry no
    // `Notification`. No assertion here reads `event`, which is exactly why
    // the fiction survived: a fixture teaching the next reader that an event
    // exists when it does not.
    v: 1, state: 'waiting', event: 'PermissionRequest', sessionId: uuid, pid: 4242,
    updatedAt, ask: { questions: [QUESTION] }, subagents: [],
  }));
};

/** `capture-pane` answers the scripted pane (last repeats); every other tmux
 *  verb (`send-keys` included) succeeds with an empty stdout — the same
 *  shape `routes.test.ts`'s `makeApp` and `claims-routes.test.ts`'s
 *  `tmuxRunner` use. */
const tmuxRunner = (panes: (string | null)[]): { run: Runner; calls: string[][] } => {
  const calls: string[][] = [];
  let i = 0;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'capture-pane') {
      const pane = panes[Math.min(i, panes.length - 1)] ?? null;
      i++;
      return pane === null ? { code: 1, stdout: '', stderr: '' } : { code: 0, stdout: pane, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

const sendKeysCalls = (calls: string[][]) => calls.filter((c) => c[1] === 'send-keys');

const openApp = async (home: string, run: Runner, over: Partial<Deps> = {}) => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, ...over });
  return { app, coord };
};

const answer = (app: FastifyInstance, id: number, body: Record<string, unknown>,
                headers: Record<string, string> = TOK) =>
  app.inject({ method: 'POST', url: `/api/asks/${id}/answer`, headers, payload: body });

describe('POST /api/asks/:id/answer', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  /** Registry (child + parent + a third, unrelated session), a fresh
   *  waiting hookstate for the child at `now`, and an ask row minted
   *  against that exact `askAt` — the ordinary, non-moved case every test
   *  below starts from unless it deliberately diverges. */
  const setup = async (now: number, panes: (string | null)[] = [ASK_PANE], runId: number | null = null) => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seed(home, OTHER, OTHER_UUID);
    seedHookstate(home, CHILD, CHILD_UUID, now);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner(panes);
    const w = await openApp(home, run, { notifyLog });
    app = w.app;
    const id = w.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });
    return { coord: w.coord, id, now, calls };
  };

  it('401s without the box token', async () => {
    const { id } = await setup(Date.now());
    const res = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] }, {});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });

  it('403s a caller that is not this ask\'s derived parent', async () => {
    const { id } = await setup(Date.now());
    const res = await answer(app!, id, { fromId: OTHER, fromUuid: OTHER_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ ok: false, error: 'not-parent',
      detail: 'only this child\'s derived parent may pre-empt its question' });
  });

  it('409s ask-moved when the child has repainted an identical question (D-2170)', async () => {
    const now = Date.now();
    // Minted against an EARLIER hookstate read (`askAt: now`); the child has
    // since repainted an identical question (`askKey` hashes content only),
    // so the LIVE hookstate now reads `now + 5000` — a different instance of
    // the same key, which `freshAskAt` must catch.
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seedHookstate(home, CHILD, CHILD_UUID, now + 5000);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner([ASK_PANE]);
    const w = await openApp(home, run, { notifyLog });
    app = w.app;
    const id = w.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });

    const res = await answer(app, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'ask-moved' });
    // Fails shut BEFORE the keystroke — nothing was pressed into the pane.
    expect(sendKeysCalls(calls)).toEqual([]);
    expect(okAsk(w.coord.askById(id))!.state).toBe('held');
  });

  /**
   * `freshAskAt`'s fail-shut arm — its OWN code since the whole-branch
   * review (M2), no longer folded onto `ask-moved`.
   *
   * `freshAskAt` answers `UNMEASURED_ASK_AT` for THREE conditions that have
   * nothing to do with the question moving: no session record, no measured
   * identity, no readable hookstate. Reporting all of them as `ask-moved`
   * collapsed "the child repainted its question" with "this box could not
   * read the child" — and it reached a SHIPPED CONTRACT, which is what makes
   * it more than a taxonomy quibble: `wave-lifecycle.md` tells coordinators
   * `ask-moved` means "the child repainted — re-read and answer the current
   * one". A coordinator told that when the truth is "unmeasurable" re-reads,
   * finds the row still `held`, answers again, and loops.
   *
   * Both arms below are the same fact from the parent's side — the box could
   * not measure this child — and neither is a reason to re-read the row.
   */
  for (const [arm, seedChild] of [
    ['no hookstate file at all', () => { /* the file is simply not written */ }],
    ['a hookstate whose identity gate rejects it', (home: string, now: number) => {
      seedHookstate(home, CHILD, 'x'.repeat(36), now);
    }],
  ] as const) {
    it(`409s child-unmeasurable, not ask-moved, when the child cannot be read — ${arm} (M2)`, async () => {
      const now = Date.now();
      const home = mkTmp('ccrc-asks-');
      seed(home, CHILD, CHILD_UUID);
      seed(home, PARENT, PARENT_UUID);
      seedChild(home, now);
      const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
      await notifyLog.load();
      const { run, calls } = tmuxRunner([ASK_PANE]);
      const w = await openApp(home, run, { notifyLog });
      app = w.app;
      const id = w.coord.insertAsk({
        childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
        askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
        options: QUESTION.options.map((o) => o.label), now,
      });

      const res = await answer(app, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toMatchObject({ ok: false, error: 'child-unmeasurable' });
      // Still FAIL-SHUT, and still before the keystroke: the only thing that
      // changed is which true sentence the parent is told.
      expect(sendKeysCalls(calls)).toEqual([]);
      expect(okAsk(w.coord.askById(id))!.state).toBe('held');
    });
  }

  it('409s not-held when a second principal is already answering (D-2171)', async () => {
    const { coord, id, now } = await setup(Date.now());
    const taken = coord.takeAskForAnswer(id, now);
    expect(taken.ok).toBe(true);

    const res = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'not-held' });
    expect(okAsk(coord.askById(id))!.state).toBe('answering');
  });

  it('presses the digit and records a programless second event on success', async () => {
    // The ask row's runId is provenance for parent derivation only. Feed `ask`
    // events stay session events, so even a numeric provenance never enters a
    // programme-filtered feed.
    const { coord, id, calls } = await setup(Date.now(), [ASK_PANE], 42);
    const res = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // Single-select: the digit alone, no Enter — answerAsk's own contract.
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${CHILD}`, '2']]);

    const row = okAsk(coord.askById(id))!;
    expect(row.state).toBe('answered');
    expect(row.answeredBy).toBe(PARENT);
    expect(row.answer).toBe('Blue');

    // D-2172: a SECOND durable record, distinct from the mint-time one —
    // naming who answered and what they chose.
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.kind).toBe('ask');
    expect(ev.sessionId).toBe(CHILD);
    expect(ev.runId).toBeNull();
    expect(ev.body).toContain(PARENT);
    expect(ev.body).toContain('Blue');
  });

  /**
   * THE DEFECT THE BRIEF SHIPPED WITH: its rollback was `releaseAsk`, whose
   * CAS source is `'held'` — it can never reach a row `takeAskForAnswer`
   * already moved to `'answering'`, so `releaseAsk` returns `false` and
   * every refused press strands the row forever. `untakeAsk` (`'answering'`
   * -> `'held'`) is the correct rollback: a refusal here means no digit was
   * pressed and the question is still live — not because every one of
   * `answerAsk`'s guards returns before its `sendKey` loop (since D-2177 a
   * failed `sendKey` refuses too), but because a HELD row only ever exists
   * for a single-select ask (`askActions` returns null on `multiSelect`,
   * the sole eligibility gate `hold` checks before minting one — D-2173),
   * which makes exactly one `sendKey` call and no Enter — and this test's
   * own refusal (`range`) fires before `answerAsk` ever reads the pane,
   * let alone sends a key, so it is unaffected either way. This proves the
   * row survives a refused press and is still pre-emptible afterwards.
   */
  it('a refused press leaves the row held, not stranded in answering', async () => {
    const { coord, id, calls } = await setup(Date.now());
    // Out of range for a 2-option question (indices 0/1 only) — `answerAsk`
    // refuses `range` before it ever reads the pane, well before any
    // `sendKey`.
    const bad = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [5] });
    expect(bad.statusCode).toBe(409);
    expect(bad.json()).toEqual({ ok: false, error: 'range' });
    expect(sendKeysCalls(calls)).toEqual([]);

    // Not stranded in 'answering' — back to 'held', exactly what the CAS
    // needs to be pre-emptible again.
    expect(okAsk(coord.askById(id))!.state).toBe('held');

    // And genuinely pre-emptible: a second, well-formed attempt succeeds.
    const good = await answer(app!, id, { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [1] });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ ok: true });
    expect(okAsk(coord.askById(id))!.state).toBe('answered');
  });
});

/**
 * `POST /api/asks/:id/release` — the parent DECLINES to rule on its
 * child's question (Task 10). The verb that makes the grace window a
 * CEILING rather than a flat tax on every ask the parent cannot answer: a
 * decline fires the operator's push NOW, through `FleetWatcher.releaseHeldAsk`
 * — the ONLY door a route has into the watcher's in-memory hold, since
 * `heldAsks` is watcher-private state.
 *
 * Its gate ladder is `/answer`'s minus the pane-touching half: box token,
 * body shape, attribution, `unknown-ask`, `ask.parentId === fromId`, then
 * the store's own `releaseAsk` CAS (`'held' -> 'released'`) — a decline that
 * finds nothing held refuses `not-held` rather than pretending to succeed.
 */
describe('POST /api/asks/:id/release', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const release = (id: number, body: Record<string, unknown>,
                   headers: Record<string, string> = TOK) =>
    app!.inject({ method: 'POST', url: `/api/asks/${id}/release`, headers, payload: body });

  /** Same shape as `buildServer`'s own third argument (`fleetws.test.ts`'s
   *  idiom): the `FleetWatcher` is constructed FIRST, sharing the one `deps`
   *  object `buildServer` also receives, so both sides see the same
   *  `heldAsks` map this route reaches through `releaseHeldAsk`. */
  const openAppWithWatcher = async (home: string, run: Runner, sent: PushPayload[]) => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const notify = async (p: PushPayload) => { sent.push(p); };
    const deps = { ...testDeps(home, run), mailToken: TOKEN, coord, push: { notify } as never };
    const bus = new Bus();
    const w = new FleetWatcher(deps, bus, 10_000);
    const built = await buildServer(deps, bus, w);
    return { app: built, coord, w };
  };

  /** Reflection idiom `asks-sweep.test.ts`/`hold-gate.test.ts` already use to
   *  reach the watcher's private, in-memory hold — `heldAsks` deliberately
   *  has no public read; `releaseHeldAsk` is its only public WRITE. */
  const heldMap = (w: FleetWatcher): Map<string, { until: number; askId: number;
      ev: unknown; answeringSince: number | null }> =>
    (w as unknown as { heldAsks: Map<string, { until: number; askId: number;
      ev: unknown; answeringSince: number | null }> }).heldAsks;

  /** Registry (child + parent + a third, unrelated session), a held ask row,
   *  and the watcher's own in-memory hold seeded to match it — the shape
   *  `FleetWatcher`'s private `hold()` would have left behind after a real
   *  mint. This route never touches the pane, so — unlike `/answer`'s own
   *  `setup` above — no hookstate or tmux pane is needed; `tmuxRunner([])`
   *  answers every call with an empty success, and none should ever land. */
  const setup = async (now: number) => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seed(home, OTHER, OTHER_UUID);
    const sent: PushPayload[] = [];
    const { run, calls } = tmuxRunner([]);
    const built = await openAppWithWatcher(home, run, sent);
    app = built.app;
    const id = built.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });
    heldMap(built.w).set(CHILD, {
      until: now + 120_000, askId: id, answeringSince: null,
      ev: { kind: 'ask', sessionId: CHILD, project: 'demo', title: 'question needs you',
        body: QUESTION.question, tag: `ask-${CHILD}` },
    });
    return { coord: built.coord, w: built.w, id, now, sent, calls };
  };

  it('401s without the box token', async () => {
    const { id } = await setup(Date.now());
    const res = await release(id, { fromId: PARENT, fromUuid: PARENT_UUID }, {});
    expect(res.statusCode).toBe(401);
    expect(res.json()).toMatchObject({ ok: false, error: 'unauthenticated' });
  });

  it('fires the operator push immediately when the parent declines', async () => {
    const { coord, w, id, sent, calls } = await setup(Date.now());
    const res = await release(id, { fromId: PARENT, fromUuid: PARENT_UUID });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(okAsk(coord.askById(id))!.state).toBe('released');
    // The deferred push fired NOW rather than waiting for `sweepAsks` to
    // notice the grace window lapse — the whole point of this route.
    expect(sent.filter((p) => p.tag === `ask-${CHILD}`)).toHaveLength(1);
    // The in-memory hold is gone — `releaseHeldAsk` deleted it, not a route
    // reaching into the map directly.
    expect(heldMap(w).has(CHILD)).toBe(false);
    // Never touches the pane — no `answerAsk`, no keystroke.
    expect(sendKeysCalls(calls)).toEqual([]);
  });

  it('403s a caller that is not this ask\'s derived parent', async () => {
    const { coord, w, id, sent } = await setup(Date.now());
    const res = await release(id, { fromId: OTHER, fromUuid: OTHER_UUID });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ ok: false, error: 'not-parent',
      detail: 'only this child\'s derived parent may decline its question' });
    // Untouched: the store row is still held and the in-memory hold survives
    // for the actual parent to decline (or the grace window to lapse) later.
    expect(okAsk(coord.askById(id))!.state).toBe('held');
    expect(heldMap(w).has(CHILD)).toBe(true);
    expect(sent).toEqual([]);
  });

  it('409s not-held on a decline of an already-released ask', async () => {
    const { coord, id, sent } = await setup(Date.now());
    const first = await release(id, { fromId: PARENT, fromUuid: PARENT_UUID });
    expect(first.statusCode).toBe(200);

    // A decline that finds nothing held must not pretend it succeeded — the
    // store's own CAS (`releaseAsk`, source state `'held'`) refuses, and the
    // route must refuse with it rather than reporting `{ok:true}` again.
    const second = await release(id, { fromId: PARENT, fromUuid: PARENT_UUID });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toEqual({ ok: false, error: 'not-held' });
    expect(okAsk(coord.askById(id))!.state).toBe('released');
    // No double push: the second decline never reached `releaseHeldAsk`.
    expect(sent.filter((p) => p.tag === `ask-${CHILD}`)).toHaveLength(1);
  });

  /**
   * Fix round 1, item 1: with NO watcher configured (`buildServer`'s own
   * third argument, defaulted — every non-test caller in the tree always
   * supplies one, but nothing enforced that here), `watcher.releaseHeldAsk`
   * was previously reached through a bare `?.`, so the CAS above still moved
   * the row `'held' -> 'released'` and the route still answered `{ok:true}`
   * with NOTHING telling anyone the operator's push never fired — exactly
   * the failure this whole lane exists to prevent, silent. Uses the
   * `describe('POST /api/asks/:id/answer', ...)` block's own top-level
   * `openApp` (NOT this block's `openAppWithWatcher`), which calls
   * `buildServer({...})` with no second/third argument at all — the
   * watcher-less shape.
   */
  it('warns instead of silently dropping the push when no watcher is configured', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    const now = Date.now();
    const built = await openApp(home, tmuxRunner([]).run);
    app = built.app;
    const id = built.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await release(id, { fromId: PARENT, fromUuid: PARENT_UUID });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    // The decline is genuinely real — the row released — even with no
    // watcher to notify anyone about it.
    expect(okAsk(built.coord.askById(id))!.state).toBe('released');
    expect(warn).toHaveBeenCalledTimes(1);
    const [msg] = warn.mock.calls[0]!;
    expect(msg).toContain(String(id));
    expect(msg).toContain(CHILD);
    warn.mockRestore();
  });
});

/**
 * `GET /api/asks?parent=<id>&state=<AskState>` (Task 11) — the READ side of
 * the lane, serving two callers with two different credentials: a fleet
 * PARENT reading its own children's open asks cookieless, and the PWA's chip
 * (Task 19) reading the same record with a cookie.
 */
describe('GET /api/asks', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const getAsks = (qs: string, headers: Record<string, string> = TOK) =>
    app!.inject({ method: 'GET', url: `/api/asks${qs}`, headers });

  /** `CCRC_AUTH` ARMED for real, the `peers-route.test.ts` ARMED fixture:
   *  writes a real (cheap-cost) passphrase file so the session half of
   *  D-149's either-credential shape has something to authenticate against. */
  const openArmedApp = async (home: string) => {
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const base = testDeps(home, tmuxRunner([]).run);
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'auth.scrypt'),
      `${await hashLine(PASSPHRASE, FAST_PARAMS, 1)}\n`, { mode: 0o600 });
    const built = await buildServer({ ...base, cfg: { ...base.cfg, authEnabled: true },
      mailToken: TOKEN, coord });
    return { app: built, coord };
  };

  /** A live session cookie, minted through the real login route — the same
   *  helper `auth-gate.test.ts`'s own `login` is. */
  const login = async (a: FastifyInstance): Promise<string> => {
    const res = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { passphrase: PASSPHRASE } });
    expect(res.statusCode, res.body).toBe(204);
    const set = res.headers['set-cookie'];
    const line = Array.isArray(set) ? set[0]! : String(set);
    return line.slice(0, line.indexOf(';'));
  };

  const seedOneHeldAsk = (coord: CoordStore, now: number): number =>
    coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });

  it('answers a fleet parent with the box token PLUS its own attribution, and the PWA with a cookie; neither 401s', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    const { app: built, coord } = await openArmedApp(home);
    app = built;
    seedOneHeldAsk(coord, Date.now());

    // The box token alone proves only "a process on this box" — never WHICH
    // parent — so the fleet caller also names itself via `?fromUuid=`,
    // checked against `?parent=` through the same registry gate `/answer`
    // and `/release` already run.
    const boxToken = await getAsks(`?parent=${PARENT}&fromUuid=${PARENT_UUID}`, TOK);
    expect(boxToken.statusCode).toBe(200);
    expect((boxToken.json() as { ok: boolean; asks: unknown[] }).asks).toHaveLength(1);

    const cookie = await login(app);
    const cookied = await getAsks(`?parent=${PARENT}`, { cookie });
    expect(cookied.statusCode).toBe(200);
    expect((cookied.json() as { ok: boolean; asks: unknown[] }).asks).toHaveLength(1);

    const neither = await getAsks(`?parent=${PARENT}`, {});
    expect(neither.statusCode).toBe(401);
    expect(neither.json()).toMatchObject({ ok: false, error: 'unauthenticated', verdict: 'no-session' });
  });

  it('a box-token caller with no ?fromUuid= is refused, not answered for every parent', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    const { app: built, coord } = await openArmedApp(home);
    app = built;
    seedOneHeldAsk(coord, Date.now());

    const res = await getAsks(`?parent=${PARENT}`, TOK);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it("a box-token caller cannot name a parent it is not — OTHER's own live uuid does not attribute it as PARENT", async () => {
    // THE SCOPING GUARD (this task's own critical constraint): the box token
    // is ONE SHARED SECRET, identical for every session on the fleet host, so
    // without this check ANY session holding it could read ANY parent's asks
    // by changing `?parent=`. OTHER is a real, live, registered session — its
    // OWN uuid is genuinely valid — but it is not PARENT's uuid, so
    // `requireAttribution` must refuse it exactly as it would a forged one.
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seed(home, OTHER, OTHER_UUID);
    const { app: built, coord } = await openArmedApp(home);
    app = built;
    seedOneHeldAsk(coord, Date.now());

    const res = await getAsks(`?parent=${PARENT}&fromUuid=${OTHER_UUID}`, TOK);
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ ok: false, error: 'stale-uuid' });
  });

  it('the PWA cookie caller reads across parents — no attribution required', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seed(home, OTHER, OTHER_UUID);
    const { app: built, coord } = await openArmedApp(home);
    app = built;
    seedOneHeldAsk(coord, Date.now());

    const cookie = await login(app);
    // The operator asks about a parent that is not its own session at all —
    // there is no "its own session" for a browser — and still gets the read.
    const res = await getAsks(`?parent=${PARENT}`, { cookie });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { asks: unknown[] }).asks).toHaveLength(1);
  });

  it('?parent= is required regardless of credential', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, PARENT, PARENT_UUID);
    const { app: built } = await openArmedApp(home);
    app = built;
    const cookie = await login(app);
    const res = await getAsks('', { cookie });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('?state=, when given, filters — and an out-of-vocabulary value 400s rather than being silently ignored', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    const { app: built, coord } = await openArmedApp(home);
    app = built;
    const id = seedOneHeldAsk(coord, Date.now());
    coord.releaseAsk(id, Date.now());

    const cookie = await login(app);
    const held = await getAsks(`?parent=${PARENT}&state=held`, { cookie });
    expect(held.statusCode).toBe(200);
    expect((held.json() as { asks: unknown[] }).asks).toEqual([]);

    const released = await getAsks(`?parent=${PARENT}&state=released`, { cookie });
    expect(released.statusCode).toBe(200);
    expect((released.json() as { asks: { id: number }[] }).asks.map((a) => a.id)).toEqual([id]);

    const bad = await getAsks(`?parent=${PARENT}&state=not-a-real-state`, { cookie });
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toMatchObject({ ok: false, error: 'bad-request' });
  });

  it('DARK: a box with CCRC_AUTH off answers with no credential of any kind, byte-identical to every ' +
     'other dual-credential GET', async () => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    const w = await openApp(home, tmuxRunner([]).run);
    app = w.app;
    seedOneHeldAsk(w.coord, Date.now());

    const res = await getAsks(`?parent=${PARENT}`, {});
    expect(res.statusCode).toBe(200);
    expect((res.json() as { asks: unknown[] }).asks).toHaveLength(1);
  });
});

/**
 * `POST /api/sessions/:id/ask` — the OPERATOR's own answer path, closing the
 * hole Task 12 exists for (D-2171). Before this task the route never
 * consulted the `asks` table at all: if the operator answered first, the
 * row stayed `'held'` forever, the parent's later `/api/asks/:id/answer`
 * call CAS'd it to `'answering'`, got refused by `answerAsk` (the menu was
 * already gone), rolled back to `'held'` via `untakeAsk` — and the row never
 * named the operator. Both routes serialize through the ONE per-session
 * `KeyedQueue` (`askDeps`, shared, `server.ts`'s own comment on why), so
 * exactly one digit ever reaches the pane regardless — this is a RECORD
 * defect, not a safety one, and these tests prove the record.
 *
 * `routes.test.ts`'s own `POST /api/sessions/:id/ask` describe block — the
 * pre-Task-12 suite, `makeApp` untouched, `deps.coord` left undefined the
 * way most of that file's server instances are built — is the byte-for-byte
 * proof that a coord-less box takes exactly its old path; it is NOT
 * duplicated here on purpose (duplicating it would let the two drift).
 * This file adds the coord-configured cases `routes.test.ts` has no way to
 * build: a row held for the child, and a coord-configured box with no row
 * at all (the "parentless path" the overwhelming majority of asks take).
 */
describe('POST /api/sessions/:id/ask — closes the held row (Task 12)', () => {
  let app: FastifyInstance | undefined;
  afterEach(async () => { if (app) await app.close(); app = undefined; });

  const post = (id: string, body: Record<string, unknown>) =>
    app!.inject({ method: 'POST', url: `/api/sessions/${id}/ask`, payload: body });

  /** Same shape as `/answer`'s own `setup` above: registry, a fresh waiting
   *  hookstate for the child at `now`, and — the one difference — the
   *  caller decides whether to mint a `held` row at all, since this route's
   *  whole point is to behave identically whether one exists or not. */
  const setup = async (
    now: number,
    mintRow: boolean,
    panes: (string | null)[] = [ASK_PANE],
    runId: number | null = null,
  ) => {
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seedHookstate(home, CHILD, CHILD_UUID, now);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner(panes);
    const w = await openApp(home, run, { notifyLog });
    app = w.app;
    const id = mintRow ? w.coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    }) : null;
    return { coord: w.coord, id, now, calls };
  };

  it('records the operator as the answerer, keeps the event programless, and locks the parent out', async () => {
    const { coord, id } = await setup(Date.now(), true, [ASK_PANE], 42);
    const res = await post(CHILD, { askKey: ASK_KEY, optionIndexes: [1] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const row = okAsk(coord.askById(id!))!;
    expect(row.state).toBe('answered');
    expect(row.answeredBy).toBe('operator');
    expect(row.answer).toBe('Blue');

    // The row is what the parent's own route CASes against — it must now
    // find nothing to take.
    const parent = await app!.inject({
      method: 'POST', url: `/api/asks/${id}/answer`, headers: TOK,
      payload: { fromId: PARENT, fromUuid: PARENT_UUID, optionIndexes: [0] },
    });
    expect(parent.statusCode).toBe(409);
    expect(parent.json()).toEqual({ ok: false, error: 'not-held' });

    // D-2172's second durable record, same as the parent's own route writes
    // on its own successful press.
    const ev = coord.feedEvents(10).at(-1)!;
    expect(ev.kind).toBe('ask');
    expect(ev.sessionId).toBe(CHILD);
    expect(ev.runId).toBeNull();
    expect(ev.body).toContain('operator');
    expect(ev.body).toContain('Blue');
  });

  it('a refused operator press leaves the row held, not stranded — and still refuses the client', async () => {
    const { coord, id, calls } = await setup(Date.now(), true);
    // Out of range for a 2-option question — `answerAsk` refuses before any
    // keystroke, so the take must roll back to `held`.
    const res = await post(CHILD, { askKey: ASK_KEY, optionIndexes: [5] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'range' });
    expect(sendKeysCalls(calls)).toEqual([]);
    expect(okAsk(coord.askById(id!))!.state).toBe('held');
    expect(okAsk(coord.askById(id!))!.answeredBy).toBeNull();
  });

  it('a row already taken before the request arrives reads as nothing held — same branch as the parentless path', async () => {
    const { coord, id, now, calls } = await setup(Date.now(), true);
    // The parent got there first: CAS the row to 'answering' directly,
    // BEFORE the request below is even sent. `heldAskFor` filters strictly
    // on `state = 'held'` (store.ts), so by the time the route runs its own
    // `coord.heldAskFor(id)` it finds NOTHING — `held === null` — and takes
    // `pressPlain()`, the identical branch the parentless test below
    // exercises. This proves that branch is safe when a row exists but
    // isn't `held`; it does NOT reach `takeAskForAnswer` or `taken.ok` at
    // all (fix round 1, finding 1) — the test below this one is what
    // exercises that branch, by racing the take into the request's OWN
    // async window instead of landing it before the request starts.
    const taken = coord.takeAskForAnswer(id!, now);
    expect(taken.ok).toBe(true);

    const res = await post(CHILD, { askKey: ASK_KEY, optionIndexes: [1] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${CHILD}`, '2']]);

    // The row is untouched by this request — left exactly where the
    // pre-existing take put it, neither settled nor rolled back.
    const row = okAsk(coord.askById(id!))!;
    expect(row.state).toBe('answering');
    expect(row.answeredBy).toBeNull();
  });

  it('a competing take landing inside this request\'s own CAS window loses the row but never refuses the operator', async () => {
    // Fix round 1, finding 1: the test above moves the row to `'answering'`
    // BEFORE the request starts, so the route's own `heldAskFor` finds
    // nothing and never reaches `takeAskForAnswer` — `taken.ok === false`
    // was unpinned. This test lands the competing take INSIDE the one
    // genuine async gap the route has between finding the row held and
    // taking it: `takeAskForAnswer(held.id, await freshAskAt(deps.io,
    // deps.cfg, id))`, where `freshAskAt` (`registry.ts`, shared with
    // `coord/routes.ts`'s own call, fix round 1 finding 2) awaits a real
    // registry + hookstate read. The
    // competitor is injected as a side effect of that read (via a wrapped
    // `io.readFileMeasured`, fired exactly once, on the child's own
    // `.hookstate.json`) — so by the time this request's own
    // `takeAskForAnswer` call runs, the row has already moved out from
    // under it and the CAS genuinely fails `not-held`.
    const now = Date.now();
    const home = mkTmp('ccrc-asks-');
    seed(home, CHILD, CHILD_UUID);
    seed(home, PARENT, PARENT_UUID);
    seedHookstate(home, CHILD, CHILD_UUID, now);
    const notifyLog = new NotifyLog(path.join(home, '.ccrc', 'notify.json'));
    await notifyLog.load();
    const { run, calls } = tmuxRunner([ASK_PANE]);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const id = coord.insertAsk({
      childId: CHILD, parentId: PARENT, runId: null, askKey: ASK_KEY,
      askAt: now, dialogId: 'dlg-1', question: QUESTION.question,
      options: QUESTION.options.map((o) => o.label), now,
    });

    let fired = false;
    const raceIO: FleetIO = {
      ...localIO,
      async readFileMeasured(p: string) {
        if (!fired && p.endsWith(`${CHILD}.hookstate.json`)) {
          fired = true;
          // The competing take: same `askAt` the row was minted with, so it
          // is a genuine, legitimate CAS win — not a fabricated failure.
          const won = coord.takeAskForAnswer(id, now);
          expect(won.ok).toBe(true);
        }
        return localIO.readFileMeasured(p);
      },
    };

    app = await buildServer({ ...testDeps(home, run), mailToken: TOKEN, coord, notifyLog, io: raceIO });
    const res = await post(CHILD, { askKey: ASK_KEY, optionIndexes: [1] });

    // The injected race actually fired — this is not a no-op fixture.
    expect(fired).toBe(true);

    // The property under test: a lost CAS never refuses the operator. The
    // press proceeds on its own merits, and the response is that press's
    // own result — not shaped by `taken.ok` at all.
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${CHILD}`, '2']]);

    // This request never held the row — left exactly where the competing
    // take put it, neither settled nor rolled back out from under it.
    const row = okAsk(coord.askById(id))!;
    expect(row.state).toBe('answering');
    expect(row.answeredBy).toBeNull();
  });

  it('the parentless path (coord configured, no row for this child) is unaffected', async () => {
    const { calls } = await setup(Date.now(), false);
    const res = await post(CHILD, { askKey: ASK_KEY, optionIndexes: [1] });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
    expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${CHILD}`, '2']]);
  });

  // WHOLE-BRANCH REVIEW, F3 — the operator's LOCK-SCREEN answer must survive
  // a broken coord.db. `node:sqlite` throws SYNCHRONOUSLY on a closed handle
  // or a lock race, and both of this route's coord touchpoints sit BEFORE
  // `answerAsk`: `heldAskFor` is an ordinary read, `takeAskForAnswer` runs
  // `tx()` -> `BEGIN IMMEDIATE`. Unguarded, either turns the one path the
  // spec promises is untouched (§2.7 — "nothing on the answering side") into
  // a 500 with NO keystroke. Every other new coord touchpoint on this branch
  // is guarded; these two carried a shipped promise and were not. The
  // degrade is `pressPlain()`, the byte-identical pre-Task-12 path: the
  // RECORD is lost (its loss is free by design, D-2169) and the digit is not.
  for (const [what, method] of [
    ['heldAskFor', 'heldAskFor'],
    ['takeAskForAnswer', 'takeAskForAnswer'],
  ] as const) {
    it(`presses the digit anyway when coord.${what} throws — the operator's answer survives a broken db (F3)`, async () => {
      const { coord, id, calls } = await setup(Date.now(), true);
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
      (coord as unknown as Record<string, unknown>)[method] = () => {
        throw new Error('boom — simulated coord.db failure');
      };

      const res = await post(CHILD, { askKey: ASK_KEY, optionIndexes: [1] });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ok: true });
      expect(sendKeysCalls(calls)).toEqual([['tmux', 'send-keys', '-t', `cc-${CHILD}`, '2']]);
      expect(warn).toHaveBeenCalled();
      expect(id).not.toBeNull();
    });
  }

  it('a stale/mismatched askKey with a held row still refuses ask-mismatch, and the row stays held', async () => {
    const { coord, id, calls } = await setup(Date.now(), true);
    const res = await post(CHILD, { askKey: 'deadbeefdeadbeef', optionIndexes: [0] });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ ok: false, error: 'ask-mismatch' });
    expect(sendKeysCalls(calls)).toEqual([]);
    expect(okAsk(coord.askById(id!))!.state).toBe('held');
  });
});
