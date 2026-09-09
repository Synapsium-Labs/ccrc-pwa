// Task 7: the release sweep and the kill switch. A held ask (Task 6's mint)
// either resolves before ASK_GRACE_MS lapses — an answer, an explicit
// release, or an orphan-settle — or the window itself becomes the answer:
// sweepAsks fires the SNAPSHOTTED push, verbatim, once `held.until` passes.
//
// RULING F9 (task-7-brief) governs what happens when `releaseAsk`'s CAS is
// beaten: the row's actual state decides whether the map entry survives to
// retry, or is dropped with or without a compensating push — never the
// naive "delete first, consult second" order that drops a deferred push
// forever whenever a parent is mid-answer. Three tests below (one per
// branch) pin that decision tree directly, reading the private `heldAsks`
// map the same way `hold-gate.test.ts`'s own `sweepSettled`/`forceDue`
// helpers already do (`(w as unknown as { field: T }).field`) — the
// codebase's established idiom for asserting on state a public method
// deliberately does not expose.
//
// Clock: `watch.ts` reads `Date.now()` directly throughout, with no
// injectable clock, so "advancing" the grace window means moving the mock
// (`ledger-sweep.test.ts`'s own `at()` idiom), not sleeping.
//
// `sweepAsks` is void-dispatched from `tick()` (mirroring `sweepMail`), so a
// test that only awaits `tick()` has not awaited it — every assertion below
// calls `w.sweepAsks()` directly, the same reason it is PUBLIC.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { localIO, type FleetIO } from '../src/io.js';
import { askKey } from '../src/askkey.js';

afterEach(() => { vi.restoreAllMocks(); });

const at = (ms: number): void => { vi.spyOn(Date, 'now').mockReturnValue(ms); };

const T0 = 1_785_400_000_000;
// Mirror `watch.ts`'s own (unexported, module-scope) constants rather than
// importing them — see that file's `ASK_GRACE_MS`/`ASK_SWEEP_MS`/`ASK_ANSWERING_MAX_MS`.
const ASK_GRACE_MS = 120_000;
const ASK_SWEEP_MS = 10_000;
const ASK_ANSWERING_MAX_MS = 60_000;

/** Private-field read of the `heldAsks` map — `hold-gate.test.ts`'s own
 *  `(w as unknown as {...})` idiom (`sweepSettled`/`forceDue`), the
 *  codebase's established way to assert on state a public method
 *  deliberately does not expose. */
const heldMap = (w: FleetWatcher): Map<string, { until: number; askId: number; answeringSince: number | null }> =>
  (w as unknown as { heldAsks: Map<string, { until: number; askId: number; answeringSince: number | null }> }).heldAsks;

/** Per-session bookkeeping the registry + live-status files need — verbatim
 *  idiom from `asks-mint.test.ts`'s own `Seeded`/`seedSessions` (itself
 *  copied from `push-copy.test.ts`). */
interface Seeded { pid: number; cfgDir: string }

const liveStatusFile = (s: Seeded): string => path.join(s.cfgDir, 'sessions', `${s.pid}.json`);

const writeLiveStatus = (s: Seeded, id: string, status: 'busy' | 'idle'): void => {
  writeFileSync(liveStatusFile(s), JSON.stringify({
    pid: s.pid, sessionId: `s-${id}`, cwd: '/d', status, statusUpdatedAt: Date.now(),
  }));
};

function seedSessions(home: string, specs: string[]): Map<string, Seeded> {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const cfgDir = path.join(home, '.claude');
  mkdirSync(path.join(cfgDir, 'sessions'), { recursive: true });
  const info = new Map<string, Seeded>();
  let pid = 71000;
  for (const spec of specs) {
    const [project, id] = spec.split('/');
    pid += 1;
    const fields: Record<string, string> = {
      wrapper: 'claude', project: project!, workdir: `/w/${id!}`, uuid: `u-${id!}`, started: '1',
    };
    for (const [f, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id!}.${f}`), v);
    const seeded: Seeded = { pid, cfgDir };
    info.set(id!, seeded);
    writeLiveStatus(seeded, id!, 'busy');
  }
  return info;
}

/** `~/.cc-sessions/<id>.hookstate.json`, the way `session-hook.sh` writes
 *  it — verbatim from `asks-mint.test.ts`. */
function writeHookState(home: string, id: string, ask: unknown, state = 'waiting'): void {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hookstate.json`), JSON.stringify({
    v: 1, state, sessionId: `u-${id}`, pid: 1, updatedAt: Date.now(), ask, subagents: [],
  }));
}

const oneQuestion = { questions: [{ question: 'Which colour?', header: 'Colour', multiSelect: false,
  options: [{ label: 'Red' }, { label: 'Blue' }] }] };

const MENU_PANE = 'Which colour?\n❯ 1. Red\n  2. Blue\n  3. Green\nEnter to select\n';
const BARE_PROMPT = 'ready\n❯ \n';

/** Same shape as `asks-mint.test.ts`'s own `fixture()`, plus what THIS task's
 *  tests need and the mint tests didn't: the raw `FleetWatcher` (so a test
 *  can call `sweepAsks()` directly, off its own clock — `ledger-sweep.test.ts`'s
 *  own `watcher` idiom), the registry directory (to write the kill-switch
 *  marker), and an `overIo` hook (`ledger-sweep.test.ts`'s own idiom) so the
 *  fail-shut test can swap in a `readdir` that answers `null` without
 *  mutating the shared `localIO` singleton. */
function fixture(opts: {
  push: { notify: (p: PushPayload) => Promise<void> };
  sessions: string[];
  overIo?: (base: FleetIO) => FleetIO;
}): {
  coord: CoordStore; home: string; reg: string; w: FleetWatcher;
  tick: () => Promise<void>;
  showMenu: (id: string, text?: string) => void;
  writeAsk: (id: string, ask: unknown, state?: string) => void;
} {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  const info = seedSessions(home, opts.sessions);
  const panes = new Map<string, string>(opts.sessions.map((spec) => [spec.split('/')[1]!, BARE_PROMPT]));
  const runner: Runner = async (_cmd, args) => {
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    const target = args[2] ?? '';
    const id = target.startsWith('cc-') ? target.slice('cc-'.length) : '';
    if (args[0] === 'list-panes') {
      const pid = info.get(id)?.pid;
      return { code: 0, stdout: pid ? `${pid}\n` : '', stderr: '' };
    }
    if (args[0] === 'capture-pane') return { code: 0, stdout: panes.get(id) ?? BARE_PROMPT, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const io: FleetIO = opts.overIo ? opts.overIo(localIO) : localIO;
  const deps = { ...testDeps(home, runner), push: opts.push as never, coord, io };
  const w = new FleetWatcher(deps, new Bus(), 10_000);
  return {
    coord, home, reg, w,
    tick: () => w.tick(),
    showMenu: (id: string, text: string = MENU_PANE) => { panes.set(id, text); },
    writeAsk: (id: string, ask: unknown, state?: string) => writeHookState(home, id, ask, state),
  };
}

const askTag = (id: string): string => `ask-${id}`;

/** Opens a run claimed by `parentId`, dispatches to `childId`, primes, then
 *  shows an eligible single-question menu and ticks once more — the mint
 *  edge (`detectDialogs`'s `last !== dialog.id` branch). Returns the minted,
 *  held ask's id. Shared setup every test below needs. */
async function mintHold(f: ReturnType<typeof fixture>, childId: string, parentId: string): Promise<number> {
  const run = f.coord.openRun({
    program: 'prog', title: 'Prog', project: 'ccrc-pwa',
    wave: 1, waveOf: null, claimedBy: parentId,
  }) as { id: number };
  f.coord.setSession(run.id, childId);
  await f.tick();                                          // priming
  f.writeAsk(childId, oneQuestion);
  f.showMenu(childId);
  await f.tick();                                           // mints, holds
  const held = f.coord.asksForParent(parentId, 'held');
  expect(held).toHaveLength(1);
  return held[0]!.id;
}

describe('sweepAsks — the release sweep (Task 7)', () => {
  it('fires the held payload verbatim once the window lapses', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);   // still deferred

    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();

    const fired = sent.filter((p) => p.tag === askTag('cc-a'));
    expect(fired).toHaveLength(1);
    // The exact `actions` `hold` snapshotted at mint time — proves the sweep
    // pushes the SNAPSHOT, not a value re-derived from (possibly stale or
    // gone) live hookstate at release time.
    const key = askKey(oneQuestion);
    expect(fired[0]!.actions).toEqual([
      { action: `ask:${key}:0`, title: 'Red' },
      { action: `ask:${key}:1`, title: 'Blue' },
    ]);
    expect(f.coord.askById(askId)!.state).toBe('released');
  });

  it('never holds while $REG/asks-disabled is present', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const run = f.coord.openRun({
      program: 'prog', title: 'Prog', project: 'ccrc-pwa',
      wave: 1, waveOf: null, claimedBy: 'coord-1',
    }) as { id: number };
    f.coord.setSession(run.id, 'cc-a');

    // Armed BEFORE any sweep runs, so `tick()`'s own auto-dispatched
    // `sweepAsks()` (fired during the priming tick below) already sees it —
    // no window where the flag briefly disagrees with the marker on disk.
    writeFileSync(path.join(f.reg, 'asks-disabled'), '');
    await f.tick();                                          // priming
    // Deterministic: guarantees `this.asksDisabled` is set before the mint
    // attempt below, rather than trusting the priming tick's own
    // void-dispatched sweep to have finished by the time `tick()` resolved.
    at(T0 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();

    f.writeAsk('cc-a', oneQuestion);
    f.showMenu('cc-a');
    await f.tick();                                          // eligible, has a parent — but disabled

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);   // pushed immediately
    expect(f.coord.asksForParent('coord-1', 'held')).toEqual([]);
  });

  // The fail-shut arm, isolated: rather than driving the whole mint pipeline
  // a second time (which would race the priming tick's own auto-dispatched
  // `sweepAsks()` against this test's explicit poisoning — the SAME registry
  // directory serves both the fleet-wide listing `tick()` itself needs to
  // even reach `detectDialogs` and this lane's kill-switch listing, so a
  // blanket `readdir -> null` stub breaks tick() before it gets there), this
  // reads the private flag directly — `hold-gate.test.ts`'s own
  // `(w as unknown as {...})` idiom — immediately after the awaited call
  // that set it, with no intervening `await` an unrelated in-flight sweep
  // could race into.
  it('reads an unlistable registry as disabled, not as enabled', async () => {
    let poisoned = false;
    const io: FleetIO = { ...localIO, readdir: async (p: string) => (poisoned ? null : localIO.readdir(p)) };
    at(T0);
    const f = fixture({ push: { notify: async () => {} }, sessions: ['ccrc-pwa/cc-a'], overIo: () => io });
    await f.tick();                                          // priming, unpoisoned
    poisoned = true;
    at(T0 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();

    expect((f.w as unknown as { asksDisabled: boolean }).asksDisabled).toBe(true);
  });

  // RULING F9, branch 1: a principal has TAKEN the row (`answering`) — the
  // CAS is beaten, but not because anyone settled it. The hold survives to
  // retry, and genuinely does once the principal abandons the attempt
  // (`untakeAsk`, `answering -> held`).
  it('keeps the hold, no push, while a principal is mid-answer — and retries once it resolves (F9)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    const askAt = f.coord.askById(askId)!.askAt;
    expect(f.coord.takeAskForAnswer(askId, askAt).ok).toBe(true);   // held -> answering

    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
    expect(heldMap(f.w).has('cc-a')).toBe(true);

    // The principal gives up — `answering -> held` — and the VERY NEXT sweep
    // (own clock, past ASK_SWEEP_MS) fires the still-live hold. This is only
    // possible because the entry survived the sweep above.
    f.coord.untakeAsk(askId);
    at(T0 + ASK_GRACE_MS + 1 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
    expect(f.coord.askById(askId)!.state).toBe('released');
  });

  // RULING F9, branch 2: the row was settled by someone else — an explicit
  // `POST /api/asks/:id/release` here (`answered`/`stale` are the other two
  // members of this branch; all three read the same way). Dropped, no push,
  // and the settled state is left untouched — the sweep never rewrites a row
  // it lost the race on.
  it('drops the hold with no push once the row is settled by someone else (F9)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    expect(f.coord.releaseAsk(askId, T0 + 1)).toBe(true);        // held -> released, by "someone else"

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
    expect(heldMap(f.w).has('cc-a')).toBe(false);
    expect(f.coord.askById(askId)!.state).toBe('released');      // untouched, not rewritten
    // Silent: distinguishes this branch from the exhaustiveness fallback
    // ('held'/'unknown'), which warns.
    expect(warn).not.toHaveBeenCalled();
  });

  // RULING F9, branch 3: the row itself is gone — a lost coord.db. Its loss
  // is free BY DESIGN (`heldAsks`'s own docstring in watch.ts); the sweep
  // degrades to exactly today's ordinary behaviour, an immediate push,
  // rather than silently swallowing the question forever.
  it('pushes and drops when the row itself is missing — a lost coord.db degrades to today\'s behaviour (F9)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    f.coord.db.prepare('DELETE FROM asks WHERE id = ?').run(askId);   // simulate a lost row

    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
    expect(heldMap(f.w).has('cc-a')).toBe(false);
    expect(f.coord.askById(askId)).toBeNull();

    // And it does not repeat — the entry is truly gone, not merely silent
    // this one sweep.
    at(T0 + ASK_GRACE_MS + 1 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
  });

  // Fix round 1, item 1a: still under `ASK_ANSWERING_MAX_MS` since first
  // observed 'answering' — kept, no push, on repeat sweeps too (not just the
  // very first observation).
  it('keeps the "answering" hold under the bound across repeat sweeps, no push (fix round 1, item 1)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    const askAt = f.coord.askById(askId)!.askAt;
    expect(f.coord.takeAskForAnswer(askId, askAt).ok).toBe(true);   // held -> answering

    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();                                          // first sighting — starts the timer
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
    expect(heldMap(f.w).has('cc-a')).toBe(true);
    expect(heldMap(f.w).get('cc-a')!.answeringSince).toBe(T0 + ASK_GRACE_MS + 1);

    // A later sweep, still inside the bound (one tick short of it).
    at(T0 + ASK_GRACE_MS + 1 + ASK_ANSWERING_MAX_MS - 1);
    await f.w.sweepAsks();
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
    expect(heldMap(f.w).has('cc-a')).toBe(true);
    // The timer does not reset on a re-observation of the SAME episode.
    expect(heldMap(f.w).get('cc-a')!.answeringSince).toBe(T0 + ASK_GRACE_MS + 1);
  });

  // Fix round 1, item 1b: past the bound, `sweepAsks` gives up on the
  // principal — pushes once, drops the entry — the same degrade F9's
  // missing-row arm uses. The DB row itself is left exactly as it was
  // ('answering'): this guard bounds the MAP, not the row.
  it('pushes once and drops the "answering" hold once it has been stuck past the bound (fix round 1, item 1)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    const askAt = f.coord.askById(askId)!.askAt;
    expect(f.coord.takeAskForAnswer(askId, askAt).ok).toBe(true);

    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();                                          // first sighting — starts the timer
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);

    at(T0 + ASK_GRACE_MS + 1 + ASK_ANSWERING_MAX_MS + 1);
    await f.w.sweepAsks();

    const fired = sent.filter((p) => p.tag === askTag('cc-a'));
    expect(fired).toHaveLength(1);
    expect(heldMap(f.w).has('cc-a')).toBe(false);
    expect(f.coord.askById(askId)!.state).toBe('answering');        // row untouched — the map is what's bounded

    // And it does not repeat.
    at(T0 + ASK_GRACE_MS + 1 + ASK_ANSWERING_MAX_MS + 1 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
  });

  // Fix round 1, item 2: a `'held'` reading after a failed `releaseAsk` is
  // unreachable under ordinary single-threaded execution — the only way to
  // exercise it is to simulate the race directly, stubbing `releaseAsk` to
  // report "beaten" while the row is genuinely back at `'held'` (via
  // `untakeAsk`). Proves BOTH halves of the fix: the entry is KEPT (not
  // dropped — dropping would orphan the row), and `answeringSince` resets so
  // a later 'answering' episode is not measured against a stale timestamp.
  it('keeps (does not drop) a "held" reading after a failed release, and resets the answering timer (fix round 1, item 2)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    const askAt = f.coord.askById(askId)!.askAt;
    expect(f.coord.takeAskForAnswer(askId, askAt).ok).toBe(true);

    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();                                          // observes 'answering', sets the timer
    expect(heldMap(f.w).get('cc-a')!.answeringSince).toBe(T0 + ASK_GRACE_MS + 1);

    // The row genuinely returns to 'held' — but THIS sweep's own
    // `releaseAsk` is stubbed to report a beaten CAS anyway, the only way to
    // reach the 'held' arm of the switch in a single-threaded process (a
    // real CAS against a genuinely-held row would simply succeed).
    f.coord.untakeAsk(askId);
    const realReleaseAsk = f.coord.releaseAsk.bind(f.coord);
    f.coord.releaseAsk = () => false;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(T0 + ASK_GRACE_MS + 1 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
    expect(heldMap(f.w).has('cc-a')).toBe(true);                    // kept, not dropped
    expect(heldMap(f.w).get('cc-a')!.answeringSince).toBeNull();     // reset
    expect(warn).toHaveBeenCalled();                                 // visibility preserved

    // Restore the real CAS and prove the hold still resolves normally.
    f.coord.releaseAsk = realReleaseAsk;
    at(T0 + ASK_GRACE_MS + 1 + ASK_SWEEP_MS + 1 + ASK_SWEEP_MS + 1);
    await f.w.sweepAsks();
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
    expect(f.coord.askById(askId)!.state).toBe('released');
  });

  // Fix round 1, item 2: an 'unknown' (out-of-vocabulary) state token reads
  // as "cannot tell" — F9's own missing-row reasoning — and degrades to
  // pushing, not silently dropping.
  it('pushes and drops on an unrecognised state token, warned (fix round 1, item 2)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    f.coord.db.prepare("UPDATE asks SET state = 'reconciling' WHERE id = ?").run(askId);   // out-of-vocabulary

    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    at(T0 + ASK_GRACE_MS + 1);
    await f.w.sweepAsks();

    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toHaveLength(1);
    expect(heldMap(f.w).has('cc-a')).toBe(false);
    expect(warn).toHaveBeenCalled();
  });
});

// Task 8: staleness off `dialog_cleared`. A held ask's dialog can go away
// with NOTHING to answer it — the operator hit escape at the terminal, the
// session was interrupted, cleared, swapped, or died. `detectDialogs`'s own
// `else if (last !== undefined)` clear branch is the only place this can be
// caught: the pane is the one signal a `cmd_swap` (which does not rotate the
// session uuid) cannot lie to, where hookstate's identity gate would stay
// blind and keep reading `waiting` behind a pane that's gone.
describe('detectDialogs — staleness off dialog_cleared (Task 8)', () => {
  it('marks a held ask stale when its dialog goes away unanswered, no push', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');
    expect(heldMap(f.w).has('cc-a')).toBe(true);

    f.showMenu('cc-a', BARE_PROMPT);                      // operator hit escape
    await f.tick();

    expect(f.coord.askById(askId)!.state).toBe('stale');
    expect(heldMap(f.w).has('cc-a')).toBe(false);
    // Nothing to notify about — a cleared dialog is a question that no
    // longer exists.
    expect(sent.filter((p) => p.tag === askTag('cc-a'))).toEqual([]);
  });

  // The clear-then-remint overwrite path (recorded against this task in
  // earlier reviews): Task 6's orphan-settle in the `last !== dialog.id`
  // branch is gated on `last !== undefined`, so when a dialog CLEARS first
  // (dropping `last` from `dialogIds`) and only later does a DIFFERENT
  // dialog appear on the same session, that guard never fires — unless the
  // clear branch itself already settled the row on its way out, which is
  // exactly what this test pins.
  it('settles the stale row on clear so a later, different dialog does not orphan it (clear-then-remint)', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const staleId = await mintHold(f, 'cc-a', 'coord-1');

    f.showMenu('cc-a', BARE_PROMPT);                      // the first dialog clears
    await f.tick();
    expect(f.coord.askById(staleId)!.state).toBe('stale');
    expect(heldMap(f.w).has('cc-a')).toBe(false);

    // A DIFFERENT dialog appears later, on the same session — no shared
    // dialog id with the one that just cleared.
    const otherQuestion = { questions: [{ question: 'Which size?', header: 'Size', multiSelect: false,
      options: [{ label: 'Small' }, { label: 'Large' }] }] };
    const OTHER_MENU_PANE = 'Which size?\n❯ 1. Small\n  2. Large\nEnter to select\n';
    f.writeAsk('cc-a', otherQuestion);
    f.showMenu('cc-a', OTHER_MENU_PANE);
    await f.tick();

    const held = f.coord.asksForParent('coord-1', 'held');
    expect(held).toHaveLength(1);                          // exactly one held row survives
    expect(held[0]!.id).not.toBe(staleId);
    expect(f.coord.askById(staleId)!.state).toBe('stale');  // the old row, untouched since
  });

  // Mutation-table guard: the `staleAsk` call on this path is a synchronous
  // `node:sqlite` write sitting directly on the 2 s poll, and `detectDialogs`
  // is awaited by `tick()`, which has no catch of its own (`void this.tick()`
  // in the timer) — so an unguarded throw here would kill the whole server
  // process. Stubbing `staleAsk` to throw proves the guard: the tick still
  // resolves, a warning is logged, and the in-memory hold is dropped anyway
  // (never retried forever on a settle that keeps failing).
  it('does not let a throwing staleAsk escape the clear branch and kill the tick', async () => {
    const sent: PushPayload[] = [];
    const push = { notify: async (p: PushPayload) => { sent.push(p); } };
    at(T0);
    const f = fixture({ push, sessions: ['ccrc-pwa/cc-a'] });
    const askId = await mintHold(f, 'cc-a', 'coord-1');

    f.coord.staleAsk = () => { throw new Error('boom'); };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    f.showMenu('cc-a', BARE_PROMPT);
    await f.tick();                                        // must not throw

    expect(warn).toHaveBeenCalled();
    expect(heldMap(f.w).has('cc-a')).toBe(false);           // dropped unconditionally, despite the throw
    expect(f.coord.askById(askId)!.state).toBe('held');     // the CAS never actually ran
  });
});
