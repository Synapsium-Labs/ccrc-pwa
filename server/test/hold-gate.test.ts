// The server half of workspace holds: `archiveMerged`'s gate becomes
// *merged AND unheld*, and the held branch pushes once per (workspace, PR)
// instead of archiving. Harness copied from `pr-sweep.test.ts`'s
// `archiveMerged` tests (`grep -rln archiveMerged server/test`) — same seed,
// same runner shape, same registry-file idiom for the new `.hold` field.
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

/** A runner that answers tmux (idle, alive) and records ccd argv. */
function runnerFor(prOut: string, calls: string[][], pid = '4242'): Runner {
  return async (_cmd, args) => {
    calls.push(args);
    if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'list-panes') return { code: 0, stdout: `${pid}\n`, stderr: '' };
    if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
    if (args[0] === 'pr-state') return { code: 0, stdout: prOut, stderr: '' };
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
 *  signal that a whole sweep (archiveMerged included) has actually finished,
 *  same reasoning as `pr-sweep.test.ts`'s own waits. */
const sweepSettled = (w: FleetWatcher): Promise<void> =>
  vi.waitFor(() => { expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0); });

const forceDue = (w: FleetWatcher): void => {
  (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
};

/** `localIO` with every `<id>.hold` read failing and everything else real —
 *  the shape `remote/io.ts` produces when one op of the ~21 a session's
 *  `readRegistry` fires in parallel times out: null, indistinguishable at
 *  `field()` from a file that is not there. */
const holdUnreadableIO: FleetIO = {
  ...localIO,
  readFile: async (p) => (p.endsWith('.hold') ? null : localIO.readFile(p)),
};

describe('archiveMerged — merged AND unheld', () => {
  it('merged + held never archives, across many sweeps', async () => {
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
    // Not just "no archive call" — no push carrying the ARCHIVE copy either,
    // across every one of the three sweeps.
    for (const [payload] of notify.mock.calls) expect(payload.body).not.toContain('nothing deleted');
    w.stop();
  });

  it('merged + released archives on the very next sweep — the level re-arms itself', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'w');
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);

    release(home, 'demo-quiet-basin');
    forceDue(w);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-quiet-basin']);
    w.stop();
  });

  it('the held-merged push fires ONCE, says held, and names nothing destroyed', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:1/4');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    // A second sweep must not re-fire the latch.
    forceDue(w);
    await w.tick();
    await sweepSettled(w);

    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0]![0];
    expect(payload.title).toContain('✓ merged');
    // The reason string IS the display — verbatim, not paraphrased — and the
    // body says plainly that nothing was destroyed.
    expect(payload.body).toContain('program:agent-evals wave:1/4');
    expect(payload.body).toContain('nothing archived');
    // Same collapse key as the real archive push, so a later real archive
    // push REPLACES this one on the phone rather than stacking.
    expect(payload.tag).toBe('merged-demo-quiet-basin');
    w.stop();
  });

  it('the held-merged push latch resets when the PR number changes', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'w');
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    let prNumber = 591;
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'pr-state') return { code: 0, stdout: mergedLine('demo-quiet-basin', prNumber), stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps = { ...testDeps(home, run), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toContain('PR #591');

    prNumber = 601;
    forceDue(w);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify.mock.calls[1]![0].body).toContain('PR #601');
    // REVIEW FINDING 4, measured: with `watch.ts`/`registry.ts` reverted to
    // `c120e88^` this test was the one new test that stayed GREEN — the OLD
    // unconditional archive path pushes once per sweep too, and its body also
    // names a PR number, so every assertion above was satisfied by the branch
    // this file exists to pin. These two say WHICH branch fired: the held one,
    // which archives nothing and says so.
    for (const [payload] of notify.mock.calls) expect(payload.body).toContain('nothing archived');
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  // Registry ladder (architecture doc, increment 1's second half): SKIP,
  // before ANYTHING else — including the `workspace === null ||
  // archivedAt !== null` test right below it in `archiveMerged`, which is
  // itself UNSAFE on a degraded row (both fields read null on an unreadable
  // file, and a false null on `archivedAt` would make an ALREADY-archived
  // workspace look freshly archive-ELIGIBLE). Written FIRST and confirmed
  // red against the pre-gate code: `records` comes from `readRegistry`,
  // which now DEGRADES (never drops) a row with one unreadable identity
  // field, so this row reaches `archiveMerged`'s loop for the first time
  // ever — exactly the hazard the design's own review flagged ("emitting
  // rows that were previously dropped exposes them to destructive lanes for
  // the first time").
  it('skips a row with an unmeasured identity field — never archives it, however merged it looks', async () => {
    // Calls the private `archiveMerged` DIRECTLY, with a hand-built,
    // FULLY WORKING `io` (a live, idle, unheld session that a healthy
    // `archiveSafety` fresh read would happily answer 'ok' for) — isolating
    // THIS guard from `archiveSafety`'s own, separate one (added by the same
    // ladder): only the `records` snapshot handed to `archiveMerged` carries
    // `unmeasured`, exactly modelling a field that read back unreadable in
    // the PRE-SWEEP snapshot `sweepPr` took (this file's own "the hold is
    // re-read at the DECISION POINT" block explains why that snapshot
    // exists) yet would read clean if re-fetched right now. Deleting
    // `archiveMerged`'s own early guard alone (leaving `archiveSafety`'s
    // untouched) reaches this exact fully-working `io` and archives —
    // proving neither guard is redundant with the other.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const deps = testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls));
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    const degraded: SessionRecord = {
      id: 'demo-quiet-basin', wrapper: '', project: 'demo', workdir: '/w/demo-quiet-basin', uuid: 'u-demo-quiet-basin',
      started: true, home: null, pool: null, lastswap: null,
      workspace: 'quiet-basin', branch: 'ws/quiet-basin', branchUnmeasured: false, base: 'origin/main',
      prPhase: null, prNumber: null, prCheckedAt: null, archivedAt: null, archivedBytes: null, held: null,
      stopped: null, supervisedAt: null, swapBlocked: null, spawn: null, lifecycleUnmeasured: [],
      unmeasured: ['wrapper'],
    };
    const merged: PrState = { phase: 'merged', number: 42, url: null, title: null, checks: null,
      checkNames: null, ahead: 3, reason: null, checkedAt: 1785300000000, mergedAt: null, retryAt: null };
    const cast = w as unknown as {
      prStates: Map<string, PrState>;
      archiveMerged(records: SessionRecord[]): Promise<void>;
    };
    cast.prStates.set('demo-quiet-basin', merged);
    await cast.archiveMerged([degraded]);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('a present-but-unreadable .hold reads as held and still blocks the archive', async () => {
    // The remote-fleet fault the fail-shut mapping exists for (review finding
    // 2): `readdir` succeeded — the file IS listed — and one `read` op over
    // the agent WS did not, which `remote/io.ts` maps to null exactly as a
    // missing file. Reading that as released archives a held workspace, and
    // `ccd ws-archive` has no held rung to catch it: the pane dies mid-program.
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:2/4');
    const cfg = loadConfig({ CCRC_HOME: home });

    const records = await readRegistry(holdUnreadableIO, cfg);
    expect(records.find((r) => r.id === 'demo-quiet-basin')?.held).toBe(HOLD_UNREADABLE);
    // …and the sentinel is not blanket: a session with no `.hold` at all is
    // still unheld under the very same failing IO, which is what keeps this a
    // fail-shut mapping rather than "nothing ever archives".
    expect(records.find((r) => r.id === 'demo-still-cove')?.held).toBeNull();

    const calls: string[][] = [];
    const deps = {
      ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      io: holdUnreadableIO,
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });
});

describe('archiveMerged — the hold is re-read at the DECISION POINT', () => {
  it('a hold placed while the sweep is in flight still blocks the archive', async () => {
    // FIX-WAVE FINDINGS 1/5, the critical one. `sweepPr` reads `records` ONCE
    // at the top, then awaits one gh-bound `ccd pr-state` per project (20 s
    // budget each; the sweep is only abandoned after 15 minutes), and only
    // then calls `archiveMerged(records)`. A hold placed inside that window is
    // invisible to a gate that reads the snapshot — and the window is exactly
    // when a hold gets placed, because the merge that ends wave N is what
    // tells the orchestrator to hold for wave N+1. `ccd ws-archive` has no
    // held rung to catch it, so the pane and its whole scrollback die at the
    // wave boundary the feature exists to protect.
    //
    // The hold here is written by the `pr-state` leg itself: same ordering as
    // the real thing (snapshot taken, THEN the hold appears, THEN
    // archiveMerged runs), with no timing to get right.
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

    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    // And it is told, in the held branch's own words — not silently deferred
    // as if the session were merely busy.
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    const payload = notify.mock.calls[0]![0];
    expect(payload.body).toContain('program:agent-evals wave:2/4');
    expect(payload.body).toContain('nothing archived');
    w.stop();
  });

  it('a release landing mid-sweep defers ONE sweep and never archives on a stale hold', async () => {
    // DOCUMENTS the two rungs' division of labour rather than covering a fix
    // (it is green before the fix too — the existing "merged + released
    // archives on the very next sweep" test covers the re-arm). The snapshot
    // rung is kept in front of the fresh one because it costs no registry read
    // in the steady state, where every hold predates the sweep; the price is
    // that it is blind to a release that lands mid-sweep. That blindness has
    // exactly one direction — it DEFERS — and a deferral destroys nothing and
    // re-arms itself 120 s later, which is why the fresh read below it is the
    // one that had to be added and this one did not have to be removed.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    hold(home, 'demo-quiet-basin', 'program:agent-evals wave:4/4');
    const calls: string[][] = [];
    const inner = runnerFor(mergedLine('demo-quiet-basin'), calls);
    const run: Runner = async (cmd, args) => {
      const res = await inner(cmd, args);
      if (args[0] === 'pr-state') release(home, 'demo-quiet-basin');
      return res;
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
    await w.tick();
    await sweepSettled(w);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);

    forceDue(w);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    w.stop();
  });
});

describe('SessionRecord.held', () => {
  it('an EMPTY .hold file is held, and says so instead of showing nothing', async () => {
    // `touch $REG/<id>.hold` and a truncated write both land here. `''` is not
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
    // HOLD_UNREADABLE, the registry-is-broken sentence, and `archiveMerged`
    // fired a held-merged push announcing corruption seconds after the
    // operator tapped Release. One second listing tells them apart.
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
      readFile: async (p) => (p.endsWith('.hold') ? null : localIO.readFile(p)),
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

describe('archiveMerged — and an OPEN RUN, even with no hold', () => {
  it('does not archive a merged workspace an open run names, though the hold is ABSENT', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    // NO `hold(...)` call: this is release-then-crash, and the whole point of
    // the rung is that an absent hold is no longer sufficient.
    const calls: string[][] = [];
    const notify = vi.fn(async (_p: PushPayload) => {});
    const deps = {
      ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify } as never,
      coord: coordWithOpenRun(home, 'demo-quiet-basin'),
    };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    for (let i = 0; i < 3; i++) { forceDue(w); await w.tick(); await sweepSettled(w); }
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    // Same shape of notification `notifyHeldMerged` already sends, and it
    // NAMES the run — a silent skip would be the defect one door over.
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    expect(notify.mock.calls[0]![0].body).toContain('nothing archived');
    expect(notify.mock.calls[0]![0].body).toMatch(/run \d+/);
    w.stop();
  });

  it('archives again once that run closes — the level re-arms on the RUN now, not on the hold', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const coord = coordWithOpenRun(home, 'demo-quiet-basin');
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), coord };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick(); await sweepSettled(w);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);

    const openId = coord.runs()[0]!.id;
    coord.advance(openId, 'dispatched', 'coordinator');
    coord.advance(openId, 'closing', 'coordinator');
    coord.advance(openId, 'done', 'coordinator');
    forceDue(w); await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    w.stop();
  });

  it('a watcher with NO coord still archives — `deps.coord` is optional and that is load-bearing', async () => {
    // `testDeps` supplies no `coord`; fourteen tests in this file and every
    // archive test in `pr-sweep.test.ts` build their watchers from it. This
    // test exists so a future NON-optional `this.deps.coord.openRunsForSession`
    // reds ONE named test instead of fourteen unrelated ones.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    w.stop();
  });
});
