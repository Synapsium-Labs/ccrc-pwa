// The server half of workspace holds — a lane that ANNOUNCES, and never acts.
// `archiveMerged` is gone (operator ruling, 2026-09-10: it killed live panes on
// merge, five of them measured revived by hand) and `sweepMerged` replaced it.
// The hold and the open run survive that removal with their job changed rather
// than lost: they used to VETO the archive, and they now choose which SENTENCE
// the merge gets — `PR #N merged — <reason>; nothing archived.` against the
// bare `PR #N merged; nothing archived.` when nothing is in the way. So these
// tests are no longer about what is spared; they are about what is said.
// Harness copied from `pr-sweep.test.ts`'s merged-lane tests — same seed, same
// runner shape, same registry-file idiom for the `.hold` field.
import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { seedRoster, testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { readRegistry, HOLD_NO_REASON, HOLD_UNREADABLE } from '../src/registry.js';
import type { SessionRecord } from '../src/registry.js';
import { localIO, type FleetIO } from '../src/io.js';
import { loadConfig } from '../src/config.js';
import type { PushPayload } from '../src/push.js';
import type { PrState } from '../../shared/api.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';

function seed(ids: string[]): string {
  const home = mkTmp('ccrc-');
  seedRoster(home);
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const id of ids) {
    for (const [f, v] of [['uuid', 'u-' + id], ['wrapper', 'claude'], ['workdir', '/w/' + id],
      ['project', 'demo'], ['workspace', id.slice('demo-'.length)], ['branch', 'ws/' + id],
      ['base', 'origin/main']]) {
      writeFileSync(path.join(reg, `${id}.${f}`), v!);
    }
  }
  return home;
}

const hold = (home: string, id: string, reason: string): void => {
  writeFileSync(path.join(home, '.cc-sessions', `${id}.hold`), reason);
};
const release = (home: string, id: string): void => {
  rmSync(path.join(home, '.cc-sessions', `${id}.hold`), { force: true });
};

const mergedLine = (id: string, number = 42): string => JSON.stringify({
  id, project: 'demo', repo: 'o/r', branch: 'ws/' + id, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 3, dirty: 0, commits: [], template: null,
  rows: [{ number, state: 'MERGED', headRefName: 'ws/' + id, headRefOid: 'deadbee',
    baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
    mergeCommit: { oid: '7a68ca0' }, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'merged', number, checkedAt: 1785300000000, reason: null,
});

/** A runner that answers tmux (idle, alive) and records ccd argv. `prOut` may
 *  be a THUNK: a workspace outlives its own merge now, so more than one test
 *  here has to change the PR the same session reports between sweeps. */
function runnerFor(prOut: string | (() => string), calls: string[][], pid = '4242'): Runner {
  return async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${pid}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'pr-state') return { code: 0, stdout: typeof prOut === 'function' ? prOut() : prOut, stderr: '' };
    return { code: 0, stdout: '', stderr: '' };
  };
}

const liveIdle = (home: string, pid = '4242'): void => {
  const dir = path.join(home, '.claude', 'sessions');
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${pid}.json`),
    JSON.stringify({ pid: Number(pid), sessionId: '1'.repeat(36), cwd: '/d', status: 'idle', statusUpdatedAt: 1 }));
};

/** `prSweepStartedAt` returns to 0 in `sweepPr`'s own `finally` — the one
 *  signal that a whole sweep (`sweepMerged` included) has actually finished,
 *  same reasoning as `pr-sweep.test.ts`'s own waits. */
const sweepSettled = (w: FleetWatcher): Promise<void> =>
  vi.waitFor(() => { expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0); });

const forceDue = (w: FleetWatcher): void => {
  (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
};

/** THIS lane's pushes only. A watcher built with a `coord` also raises the run
 *  lane's own notifications, and one fixture below advances a run on purpose —
 *  `merged-<id>#<pr>` is this lane's own collapse key (`announceMerged` passes
 *  it explicitly — `pushOne`'s id-only default would let a second PR's
 *  announcement replace the first in the tray), so it
 *  is the honest discriminator. Every other test here asserts on the raw call
 *  list, which is itself a pin that its fixture raises nothing else. */
/** This workspace's merged announcements, in order. Matched on the tag's
 *  PREFIX, not the whole tag: `announceMerged` collapses per (workspace, PR),
 *  so the tag carries the number and a workspace that lands two PRs produces
 *  two distinct tags — which is exactly what the last test in this file walks
 *  through. */
const mergedPushes = (
  notify: { mock: { calls: [PushPayload][] } }, id = 'demo-quiet-basin',
): PushPayload[] =>
  notify.mock.calls.map(([p]) => p).filter((p) => p.tag?.startsWith(`merged-${id}#`) === true);

/** `localIO` with every `<id>.hold` read failing and everything else real —
 *  the shape `remote/io.ts` produces when one op of the ~21 a session's
 *  `readRegistry` fires in parallel times out: null, indistinguishable at
 *  `field()` from a file that is not there. */
const holdUnreadableIO: FleetIO = {
  ...localIO,
  readFileMeasured: async (p) => (p.endsWith('.hold') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
};

describe('sweepMerged — a held merge is announced, never acted on', () => {
  it('says it once across many sweeps, names the hold, and archives nothing', async () => {
    // The ruling and the sentence that replaced it, in one test. The negative
    // half alone would be vacuous — a deleted lane also runs no `ws-archive` —
    // so it is only ever asserted here beside the push that DID happen: three
    // sweeps over one merged, held row produce no archive argv at all and
    // exactly ONE notification, whose reason clause is the hold verbatim.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    for (let i = 0; i < 3; i++) {
      forceDue(w);
      await w.tick();
      await sweepSettled(w);
    }
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0].body)
      .toBe('PR #42 merged — program:agent-evals wave:1/4; nothing archived.');
    w.stop();
  });

  it('a release AFTER the announcement does not re-announce — one merge, one sentence', async () => {
    // THIS WAS THE RE-ARM TEST: the hold was a level, and releasing it let the
    // very next sweep archive. There is no act left to re-arm. The latch is per
    // (workspace, PR), so a release changes nothing about a merge already
    // announced — PR #42 was told with the hold as its reason and that stays
    // the only sentence it gets. The price is one notification naming a hold
    // that has since gone; the alternative is saying the same merge twice.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:3/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toContain('program:agent-evals wave:3/4');

    release(home, 'demo-quiet-basin');
    forceDue(w);
    await w.tick();
    await sweepSettled(w);
    expect(notify).toHaveBeenCalledTimes(1);
    // And the release is not a trigger either: the row that used to be archived
    // the instant it read unheld is still here, untouched.
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('the merged push says WHAT is in the way, verbatim, and collapses on the session', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());

    const payload = notify.mock.calls[0]![0];
    expect(payload.title).toContain('✓ merged');
    // The reason string IS the display — verbatim, not paraphrased — and the
    // body says plainly that nothing was destroyed. This wording is DELIBERATELY
    // unchanged from when the held branch was the only one that could produce
    // it: what changed underneath is that every merge now reads this way.
    expect(payload.body).toContain('program:agent-evals wave:1/4');
    expect(payload.body).toContain('nothing archived');
    // `pushOne`'s default `${kind}-${sessionId}` collapse key, deliberately not
    // overridden: a later statement about this workspace REPLACES this one on
    // the phone rather than stacking beside it.
    expect(payload.tag).toBe('merged-demo-quiet-basin#42');
    w.stop();
  });

  it('the merged push latch resets when the PR number changes', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    let prNumber = 591;
    const deps = {
      ...testDeps(home, runnerFor(() => mergedLine('demo-quiet-basin', prNumber), calls)),
      push: { notify } as never,
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toContain('PR #591');

    prNumber = 601;
    forceDue(w);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify.mock.calls[1]![0].body).toContain('PR #601');
    // THE NUMBER IN THE LATCH KEY, which is more load-bearing since the archive
    // was removed than it was when it was added: a workspace SURVIVES its own
    // merge now, so it goes on to land a second PR and `boundRow` binds the
    // newest one. Keyed on the id alone this lane would announce a workspace's
    // first merge and silently swallow every one after it — which, on a
    // workspace that no longer retires itself, is most of them.
    for (const [payload] of notify.mock.calls) expect(payload.body).toContain('nothing archived');
    w.stop();
  });

  // Registry ladder (architecture doc, increment 1's second half): SKIP, before
  // anything else. This rung outlived the act it was written to guard, with its
  // job changed: a degraded row's `held` reads null exactly as an unheld row's
  // does, so announcing the bare "merged; nothing archived." off one is a claim
  // about a hold this box never measured. It says nothing at all instead.
  it('says nothing at all about a row with an unmeasured identity field', async () => {
    // Calls the private `sweepMerged` DIRECTLY, twice, on ONE watcher: the same
    // merged PR, the same workspace, one measured field's difference. The pair
    // is what makes the silence mean something — a lane that pushed nothing
    // ever would pass the first assertion and fail the second. The latch makes
    // it sharper still: had the degraded call announced, its key would suppress
    // the healthy one and the second assertion would go red too.
    const home = seed(['demo-quiet-basin']);
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    const degraded: SessionRecord = {
      id: 'demo-quiet-basin', wrapper: '', project: 'demo', workdir: '/w/demo-quiet-basin', uuid: 'u-demo-quiet-basin',
      started: true, home: null, pool: null, lastswap: null,
      workspace: 'quiet-basin', branch: 'ws/quiet-basin', branchEvidence: 'named', base: 'origin/main',
      prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
      substrate: null, stopped: null, supervisedAt: null, swapBlocked: null, spawn: null, lifecycleUnmeasured: [],
      unmeasured: ['wrapper'],
    };
    const merged: PrState = { phase: 'merged', number: 42, url: null, title: null, checks: null,
      checkNames: null, ahead: 3, reason: null, checkedAt: 1785300000000, mergedAt: null, retryAt: null };
    const cast = w as unknown as {
      prStates: Map<string, PrState>;
      sweepMerged(records: SessionRecord[]): void;
    };
    cast.prStates.set('demo-quiet-basin', merged);
    cast.sweepMerged([degraded]);
    expect(notify).not.toHaveBeenCalled();

    cast.sweepMerged([{ ...degraded, wrapper: 'claude', unmeasured: [] }]);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0].body).toBe('PR #42 merged; nothing archived.');
    w.stop();
  });

  it('a present-but-unreadable .hold is NAMED in the sentence, never read as unheld', async () => {
    // The remote-fleet fault the fail-shut mapping exists for (review finding
    // 2): `readdir` succeeded — the file IS listed — and one `read` op over the
    // agent WS did not, which `remote/io.ts` maps to null exactly as a missing
    // file. That misread used to end a live pane at a wave boundary; now it
    // ends a sentence, and the sentence is the whole of what is left to get
    // right. Reading it as released would announce "nothing is in the way" over
    // a workspace this box could not read the hold of.
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:2/4');
    const cfg = loadConfig({ CCRC_HOME: home });

    const records = await readRegistry(holdUnreadableIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBe(HOLD_UNREADABLE);
    // …and the sentinel is not blanket: a session with no `.hold` at all is
    // still unheld under the very same failing IO, which is what keeps this a
    // fail-shut mapping rather than "every merge names a broken registry".
    expect(records.find((r) => r.id === 'demo-still-cove')?.held).toBeNull();

    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = {
      ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      io: holdUnreadableIO,
      push: { notify } as never,
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toBe(`PR #42 merged — ${HOLD_UNREADABLE}; nothing archived.`);
    w.stop();
  });
});

describe("sweepMerged — the reason comes from the sweep's own snapshot", () => {
  it('a hold placed while the sweep is in flight is NOT named — and costs a word, not a session', async () => {
    // THE FRESH REGISTRY RE-READ AT THE DECISION POINT IS GONE, and this test
    // is what pins its absence. `sweepPr` reads `records` once at the top, then
    // awaits one gh-bound `ccd pr-state` per project, and only then calls
    // `sweepMerged(records)`. A hold placed inside that window — and that is
    // exactly when holds get placed, since the merge that ends wave N is what
    // tells the coordinator to hold for wave N+1 — is invisible to the
    // snapshot. When the decision was DESTRUCTIVE that blindness ended a pane;
    // now it is display only, so the whole cost of the stale read is a less
    // specific sentence. The trade is deliberate: this row is announced with no
    // reason clause at all, and nothing is done to it either way. A re-added
    // fresh read reds this test.
    //
    // The hold here is written by the `pr-state` leg itself: same ordering as
    // the real thing (snapshot taken, THEN the hold appears, THEN sweepMerged
    // runs), with no timing to get right.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const inner = runnerFor(mergedLine('demo-quiet-basin'), calls);
    const run: Runner = async (cmd, args) => {
      const res = await inner(cmd, args);
      if (args[0] === 'pr-state') hold(home, 'demo-quiet-basin', 'program:agent-evals wave:2/4');
      return res;
    };
    const deps = { ...testDeps(home, run), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);

    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    const payload = notify.mock.calls[0]![0];
    expect(payload.body).toBe('PR #42 merged; nothing archived.');
    expect(payload.body).not.toContain('wave:2/4');
    // The snapshot said unheld — under the old lane that was the whole gate,
    // and this is the row it would have archived.
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });
});

describe('SessionRecord.held', () => {
  it('an EMPTY .hold file is held, and says so instead of showing nothing', async () => {
    // `touch $REG/<id>.hold` and every other residual empty-field route land
    // here (`BranchEvidence`'s `'empty'` rung; a truncated write is no longer
    // one of them). `''` is not
    // null, so every consumer enforces the hold — while the reason, which IS
    // the display, renders as nothing at all on every surface: `Held — `, an
    // empty chip tooltip, `PR #591 merged — ; nothing archived.` The one thing
    // the no-expiry design cannot afford is a hold nobody can see.
    const home = seed(['demo-quiet-basin']);
    hold(home, 'demo-quiet-basin', '');
    const cfg = loadConfig({ CCRC_HOME: home });
    const records = await readRegistry(localIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBe(HOLD_NO_REASON);
    expect(HOLD_NO_REASON).not.toBe('');
  });

  it('an ordinary release landing inside readRegistry\'s own read window is NOT corruption', async () => {
    // `readRegistry` lists the directory, then fires ~21 field reads per
    // session. A `ccd ws-release` anywhere in that window leaves the name in
    // the listing with no bytes behind it — indistinguishable at `field()`
    // from a read that failed, so a perfectly ordinary release was reported as
    // HOLD_UNREADABLE, the registry-is-broken sentence, and `sweepMerged`
    // announced corruption seconds after the operator tapped Release. One
    // second listing tells them apart.
    const home = seed(['demo-quiet-basin']);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const cfg = loadConfig({ CCRC_HOME: home });
    let listings = 0;
    const releasedMidReadIO: FleetIO = {
      ...localIO,
      readdir: async (p) => {
        const names = await localIO.readdir(p);
        if (names === null || !names.includes('demo-quiet-basin.hold')) return names;
        listings += 1;
        // First listing: the hold is there. Then the release lands — so the
        // read returns null and the SECOND listing no longer names it.
        if (listings === 1) return names;
        return names.filter((n) => n !== 'demo-quiet-basin.hold');
      },
      readFileMeasured: async (p) => (p.endsWith('.hold') ? { ok: false, reason: 'unreadable' } : localIO.readFileMeasured(p)),
    };
    const records = await readRegistry(releasedMidReadIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBeNull();
    expect(listings).toBe(2);
  });

  it('a still-listed unreadable hold stays HOLD_UNREADABLE after the re-check', async () => {
    // The confirmation must not become an escape hatch: when the second
    // listing still names the file, the fail-shut answer is unchanged.
    const home = seed(['demo-quiet-basin']);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const cfg = loadConfig({ CCRC_HOME: home });
    const records = await readRegistry(holdUnreadableIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBe(HOLD_UNREADABLE);
  });

  it('carries the reason verbatim, null when absent', async () => {
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const cfg = loadConfig({ CCRC_HOME: home });
    const records = await readRegistry(localIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBe('program:agent-evals wave:1/4');
    expect(records.find((r) => r.id === 'demo-still-cove')?.held).toBeNull();
  });
});

/** A coord store with one OPEN run naming `id`, and NO hold on disk — the
 *  release-then-crash shape, and the hand-created-workspace-adopted-into-a-run
 *  shape, in one fixture. */
const coordWithOpenRun = (home: string, id: string): CoordStore => {
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const opened = coord.openRun({ program: 'build4', title: 'T', project: 'demo', wave: 2, waveOf: 3,
    claimedBy: 'ccrc-pwa-coordinator' });
  if (!('id' in opened)) throw new Error('fixture openRun refused');
  coord.setSession(opened.id, id);
  return coord;
};

describe('sweepMerged — an OPEN RUN names the reason when no hold does', () => {
  it('names the run, in full, on a merged workspace whose hold is ABSENT', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    // NO `hold(...)` call: this is release-then-crash. Under the old lane an
    // absent hold was the whole permission to archive, which is why the run
    // rung was added; what it buys now is the SENTENCE — a merge on a workspace
    // a program still owns must not read as a merge with nothing in the way.
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const coord = coordWithOpenRun(home, 'demo-quiet-basin');
    const deps = {
      ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify } as never,
      coord,
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    for (let i = 0; i < 3; i++) { forceDue(w); await w.tick(); await sweepSettled(w); }
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    // The whole clause, verbatim — id, program, wave and waveOf. A silent skip
    // would be the defect one door over, and a vague one ("a run is open") is
    // the defect two doors over: the operator has to know WHICH.
    const runId = coord.runs()[0]!.id;
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0].body)
      .toBe(`PR #42 merged — run ${runId} is still open — build4 wave 2/3; nothing archived.`);
    w.stop();
  });

  it('a closed run stops naming a reason — but never re-opens a sentence already said', async () => {
    // THE RUN-SIDE RE-ARM TEST, which used to prove that closing the run let
    // the next sweep archive. There is no act to re-arm, so what is pinned here
    // is the pair of properties that replaced it: the latch holds PR #42 to the
    // one sentence it already got, however much the reason changes underneath,
    // and the reason is nonetheless re-measured for the NEXT PR — which now
    // reads as the ordinary merge, no clause at all, because nothing is in the
    // way any more.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const coord = coordWithOpenRun(home, 'demo-quiet-basin');
    let prNumber = 42;
    const deps = {
      ...testDeps(home, runnerFor(() => mergedLine('demo-quiet-basin', prNumber), calls)),
      push: { notify } as never,
      coord,
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick(); await sweepSettled(w);
    const runId = coord.runs()[0]!.id;
    await vi.waitFor(() => expect(mergedPushes(notify)).toHaveLength(1));
    expect(mergedPushes(notify)[0]!.body).toContain(`run ${runId} is still open`);

    coord.advance(runId, 'dispatched', 'coordinator');
    coord.advance(runId, 'closing', 'coordinator');
    coord.advance(runId, 'done', 'coordinator');
    forceDue(w); await w.tick(); await sweepSettled(w);
    expect(mergedPushes(notify)).toHaveLength(1);

    prNumber = 601;
    forceDue(w); await w.tick();
    await vi.waitFor(() => expect(mergedPushes(notify)).toHaveLength(2));
    expect(mergedPushes(notify)[1]!.body).toBe('PR #601 merged; nothing archived.');
    // Unheld, unclaimed and merged twice over: the exact row the old lane
    // archived on sight, still here.
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('a watcher with NO coord still announces — `deps.coord` is optional and that is load-bearing', async () => {
    // `testDeps` supplies no `coord`; most of the watchers in this file and
    // every merged-lane test in `pr-sweep.test.ts` are built from it, so
    // `sweepMerged`'s `this.deps.coord?.openRunsForSession(...) ?? []` is what
    // keeps them all running. This test exists so a future non-optional access
    // reds ONE named test instead of a dozen unrelated ones. No coord and no
    // hold is also the ORDINARY merge — nothing is in the way, and the sentence
    // carries no reason clause at all.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toBe('PR #42 merged; nothing archived.');
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });
});
