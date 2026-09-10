import { describe, it, expect, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import WebSocket from 'ws';
import { Bus } from '../src/bus.js';
import type { Runner } from '../src/exec.js';
import { FleetWatcher } from '../src/watch.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import { unreadableField } from './ioDoubles.js';
import type { PrState } from '../../shared/api.js';
import type { PushPayload } from '../src/push.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';

function seed(ids: string[]): string {
  const home = mkTmp('ccrc-');
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

describe('the third lane', () => {
  it('runs ONE ccd pr-state --project per project, not one per session', async () => {
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor('', calls)), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(1));
    expect(calls.find((c) => c[0] === 'pr-state')).toEqual(['pr-state', '--project', 'demo']);
    w.stop();
  });

  it('is never awaited by tick — a hung gh must not stall the dialog detector', async () => {
    // gh pr list has no --timeout and a blocking DNS hang is 30 s. tick() must
    // return long before that.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'pr-state') return new Promise(() => { /* never resolves */ });
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
    const started = Date.now();
    await w.tick();
    expect(Date.now() - started).toBeLessThan(2000);
    w.stop();
  });

  it('abandons a wedged sweep instead of latching the lane off for good', async () => {
    // The other half of the test above. Nothing bounds the awaited ccd call in
    // local mode — realRunner passes no timeout to execFile (exec.ts:6-12) — so
    // a boolean in-flight flag that only clears in `finally` never clears, and
    // the cap silently stops updating for the process's lifetime with no error
    // anywhere to explain it.
    //
    // Only Date is faked: the sweep awaits real promises and vi.waitFor's own
    // scheduling would deadlock against faked setTimeout. The waits below are
    // real sleeps for the same reason — sweepPr is void-dispatched, so it has
    // not reached the runner yet when tick() returns.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const home = seed(['demo-quiet-basin']);
      liveIdle(home);
      const calls: string[][] = [];
      const run: Runner = async (_cmd, args) => {
        calls.push(args);
        if (args[0] === 'pr-state') return new Promise(() => { /* wedged forever */ });
        if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
        if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      };
      const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
      await w.tick();
      await new Promise((r) => setTimeout(r, 50));
      expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(1);
      // Still wedged, and now well past PR_SWEEP_STUCK_MS (900_000).
      vi.setSystemTime(Date.now() + 900_001);
      await w.tick();
      await new Promise((r) => setTimeout(r, 50));
      expect(calls.filter((c) => c[0] === 'pr-state'),
        'the lane must re-open once the in-flight sweep is older than the ceiling').toHaveLength(2);
      w.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves swept state through currentPrStates so /api/fleet is immediate', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
    w.stop();
  });

  it('survives a truncated JSON line without taking the process down', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor('{"id":"demo-qui', calls)), new Bus(), 10_000);
    await expect(w.tick()).resolves.toBeUndefined();
    w.stop();
  });

  it('greys ONLY the session whose registry is incomplete, never its siblings', async () => {
    // §6's "Partial sweep" row. The id-carrying failure line must not reach
    // phaseFor — it has no `rows`, so boundRow(undefined, …) throws inside a
    // void-dispatched sweep — and must not back the PROJECT off either, which
    // is what the id-LESS shape means. Both mistakes look identical from the
    // outside: every sibling reads `unknown`.
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    liveIdle(home);
    const calls: string[][] = [];
    const out = `${JSON.stringify({ id: 'demo-still-cove', phase: 'unknown', reason: 'error' })}\n${mergedLine('demo-quiet-basin')}`;
    const w = new FleetWatcher(testDeps(home, runnerFor(out, calls)), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
    const broken = w.currentPrStates().get('demo-still-cove');
    expect(broken?.phase).toBe('unknown');
    expect(broken?.reason).toBe('error');
    w.stop();
  });

  it('skips the sweep entirely while the agent link is down', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const deps = { ...testDeps(home, runnerFor('', calls)), fleetState: { connected: false, downSince: 1, ccdVerbs: null, rosterFp: null, build: null } };
    deps.cfg = { ...deps.cfg, fleetMode: 'remote' };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state')).toEqual([]);
    w.stop();
  });
});

describe('the swept state reaches the wire, not just currentPrStates()', () => {
  // Mutation-sweep finding: none of the tests above hit server.ts's routes at
  // all, so dropping watcher.currentPrStates() from either assembleFleet call
  // (server.ts's REST route or the /ws/fleet initial push) survived every
  // test above — both routes silently fell back to the registry's stale,
  // unenriched `persistedPr` and nothing failed. These two pin the actual
  // wiring server.ts:84/156-170 depends on, the same way fleetws.test.ts
  // pins currentPending()'s wiring for dialogPending.
  it('GET /api/fleet carries the swept phase, not the stale registry phase', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const deps = testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls));
    const watcher = new FleetWatcher(deps, new Bus(), 10_000);
    const app = await buildServer(deps, new Bus(), watcher);
    try {
      await watcher.tick();
      await vi.waitFor(() => expect(watcher.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
      const res = await app.inject({ method: 'GET', url: '/api/fleet' });
      const body = res.json() as { sessions: { id: string; pr: { phase: string } | null }[] };
      expect(body.sessions.find((s) => s.id === 'demo-quiet-basin')?.pr?.phase).toBe('merged');
    } finally {
      watcher.stop();
      await app.close();
    }
  });

  it('a NEW /ws/fleet client sees an ALREADY-swept merged phase on connect', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const deps = testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls));
    const bus = new Bus();
    const watcher = new FleetWatcher(deps, bus, 10_000);
    const app = await buildServer(deps, bus, watcher);
    try {
      await watcher.tick();
      await vi.waitFor(() => expect(watcher.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
      await app.listen({ host: '127.0.0.1', port: 0 });
      const addr = app.server.address();
      const port = typeof addr === 'object' && addr !== null ? addr.port : 0;
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/fleet`);
      // The dormant handshake's `hello` is now the first frame on every
      // connect (server.ts, Rider E) — skip it to reach the fleet snapshot
      // this test actually pins.
      type FleetFrame = { type: string; sessions: { id: string; pr: { phase: string } | null }[] };
      const frames: FleetFrame[] = [];
      const msg = await new Promise<FleetFrame>((resolve, reject) => {
        ws.on('message', (d) => {
          frames.push(JSON.parse(String(d)) as FleetFrame);
          if (frames.length === 2) resolve(frames[1]!);
        });
        ws.on('error', reject);
      });
      expect(frames[0]?.type).toBe('hello');
      expect(msg.type).toBe('fleet');
      expect(msg.sessions.find((s) => s.id === 'demo-quiet-basin')?.pr?.phase).toBe('merged');
      ws.close();
    } finally {
      watcher.stop();
      await app.close();
    }
  });
});

describe('tick() feeds its OWN fleet assembly from the sweep too, not just the routes', () => {
  it("emits 'fleet' carrying the swept pr phase once the sweep has landed", async () => {
    // Distinct from the /api/fleet and /ws/fleet wiring above: this pins
    // tick()'s OWN `assembleFleet(...)` call (the one that produces the
    // 'fleet' bus event long-lived WS clients receive on every change), which
    // reads `this.prStates` independently of the routes' calls into
    // `watcher.currentPrStates()`.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const bus = new Bus();
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), bus, 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));

    const got = new Promise<{ id: string; pr: { phase: string } | null }[]>((resolve) => {
      bus.on('fleet', (sessions) => resolve(sessions as unknown as { id: string; pr: { phase: string } | null }[]));
    });
    // Force a real session-list change so tick()'s json-diff guard cannot
    // suppress the emission depending on how the sweep's OWN race against
    // this tick's first assembleFleet call happened to land (assembleFleet
    // and sweepPr both hop several awaits over the SAME live `this.prStates`
    // map, so whether the very first tick already saw 'merged' is timing-
    // dependent — this test only needs to prove the SECOND tick's assembly
    // reflects the (by-then-certainly-landed) sweep, not race the first).
    const reg = path.join(home, '.cc-sessions');
    for (const [f, v] of [['uuid', 'u-demo-second'], ['wrapper', 'claude'], ['workdir', '/w/demo-second'], ['project', 'demo']]) {
      writeFileSync(path.join(reg, `demo-second.${f}`), v!);
    }
    await w.tick();
    const sessions = await got;
    expect(sessions.find((s) => s.id === 'demo-quiet-basin')?.pr?.phase).toBe('merged');
    w.stop();
  });
});

describe('the single-flight and due-interval guards hold their line, not just their reopening', () => {
  // The wedged-sweep test in "the third lane" above only proves the lane
  // REOPENS once PR_SWEEP_STUCK_MS has passed. It never calls tick() a
  // second time BEFORE that ceiling, so a guard broken in the direction of
  // "always allow a new sweep" would leave that test green. These two close
  // that gap from the other side.
  it('does NOT start a second sweep while the first is still wedged and well under the ceiling', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'pr-state') return new Promise(() => { /* wedged forever */ });
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(1);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state'), 'a fresh in-flight sweep must hold the lane shut').toHaveLength(1);
    w.stop();
  });

  it('the single-flight guard holds even if the due-interval would otherwise allow a new sweep', async () => {
    // Isolates the single-flight guard from the due-interval guard: the test
    // above ("does NOT start a second sweep while wedged") never resets
    // lastPrSweep, so the due-interval guard would ALSO block a second
    // sweep on its own — a single-flight guard broken toward "always allow"
    // could hide behind it. Force the due-interval open here so only
    // single-flight stands in the way.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'pr-state') return new Promise(() => { /* wedged forever */ });
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(1);
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;   // due-interval bypassed
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state'), 'single-flight must hold even with the due-interval bypassed').toHaveLength(1);
    w.stop();
  });

  it("an abandoned sweep's own finally must not clear a NEWER sweep's still-active latch", async () => {
    // The `if (this.prSweepStartedAt === mySweep)` identity check in
    // sweepPr's finally, isolated: sweep A wedges and is abandoned past the
    // ceiling; sweep B supersedes it and is ALSO still in flight when A
    // finally settles. A's own finally running unconditionally must not
    // unlatch B.
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const home = seed(['demo-quiet-basin']);
      liveIdle(home);
      const calls: string[][] = [];
      let resolveA: (() => void) | null = null;
      let resolveB: (() => void) | null = null;
      const run: Runner = async (_cmd, args) => {
        calls.push(args);
        if (args[0] === 'pr-state') {
          const n = calls.filter((c) => c[0] === 'pr-state').length;
          if (n === 1) return new Promise((resolve) => { resolveA = () => resolve({ code: 0, stdout: '', stderr: '' }); });
          if (n === 2) return new Promise((resolve) => { resolveB = () => resolve({ code: 0, stdout: '', stderr: '' }); });
          return { code: 0, stdout: '', stderr: '' };
        }
        if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
        if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
        return { code: 0, stdout: '', stderr: '' };
      };
      const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);

      await w.tick();   // sweep A starts, wedges on its own pr-state call
      await new Promise((r) => setTimeout(r, 50));
      expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(1);

      vi.setSystemTime(Date.now() + 900_001);   // past the ceiling — A is abandoned
      await w.tick();   // sweep B starts, ALSO wedges on its own pr-state call
      await new Promise((r) => setTimeout(r, 50));
      expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(2);

      resolveA!();   // A finally settles, long after B superseded it
      await new Promise((r) => setTimeout(r, 50));

      // B is STILL legitimately in flight. Forcing due again must NOT start
      // a third sweep: A's finally clearing the latch out from under B would
      // be exactly the bug the identity check exists to prevent.
      (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
      await w.tick();
      await new Promise((r) => setTimeout(r, 50));
      expect(calls.filter((c) => c[0] === 'pr-state'),
        "A's finally must not unlatch B — B is still legitimately in flight").toHaveLength(2);

      resolveB!();
      w.stop();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does NOT re-sweep on a second tick within PR_SWEEP_MS of a successful sweep', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(1));
    // Wait for the FULL sweep (including archiveMerged and the finally that
    // releases the single-flight latch) so this test isolates the
    // due-interval guard rather than incidentally riding on single-flight
    // still being fresh.
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state'), 'a completed sweep still inside its interval must not repeat').toHaveLength(1);
    w.stop();
  });

  it('shortens the sweep interval to PR_SWEEP_ACTIVE_MS while any project has an open PR with pending checks', async () => {
    const elapsed = 40_000;   // > PR_SWEEP_ACTIVE_MS (30s), < PR_SWEEP_MS (120s)
    const openPending: PrState = {
      phase: 'open', number: 1, url: null, title: null, checks: 'pending', checkNames: null,
      ahead: 0, reason: null, checkedAt: 1, mergedAt: null, retryAt: null,
    };
    const openNotPending: PrState = { ...openPending, checks: 'pass' };

    const idleHome = seed(['demo-quiet-basin']);
    liveIdle(idleHome);
    const idleCalls: string[][] = [];
    const wIdle = new FleetWatcher(testDeps(idleHome, runnerFor('', idleCalls)), new Bus(), 10_000);
    (wIdle as unknown as { lastPrSweep: number }).lastPrSweep = Date.now() - elapsed;
    await wIdle.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(idleCalls.filter((c) => c[0] === 'pr-state'), 'no pending PR — the slow 120s cadence applies').toEqual([]);
    wIdle.stop();

    // 'open' alone, with checks already settled, must NOT count as pending —
    // pins `&&`, not `||`, in the anyPending predicate.
    const openHome = seed(['demo-quiet-basin']);
    liveIdle(openHome);
    const openCalls: string[][] = [];
    const wOpen = new FleetWatcher(testDeps(openHome, runnerFor('', openCalls)), new Bus(), 10_000);
    (wOpen as unknown as { prStates: Map<string, PrState> }).prStates.set('demo-quiet-basin', openNotPending);
    (wOpen as unknown as { lastPrSweep: number }).lastPrSweep = Date.now() - elapsed;
    await wOpen.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(openCalls.filter((c) => c[0] === 'pr-state'), 'open with settled checks is not "pending" — the slow cadence still applies').toEqual([]);
    wOpen.stop();

    const activeHome = seed(['demo-quiet-basin']);
    liveIdle(activeHome);
    const activeCalls: string[][] = [];
    const wActive = new FleetWatcher(testDeps(activeHome, runnerFor('', activeCalls)), new Bus(), 10_000);
    (wActive as unknown as { prStates: Map<string, PrState> }).prStates.set('demo-quiet-basin', openPending);
    (wActive as unknown as { lastPrSweep: number }).lastPrSweep = Date.now() - elapsed;
    await wActive.tick();
    await vi.waitFor(() => expect(activeCalls.filter((c) => c[0] === 'pr-state')).toHaveLength(1));
    wActive.stop();
  });
});

describe('backoffPr — a failed read never overwrites a good phase, and unauthenticated skips the doubling', () => {
  it('backs the WHOLE project off, greys every session, keeps prior fields, and blocks a same-project re-poll while backed off', async () => {
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    liveIdle(home);
    const calls: string[][] = [];
    const failing = { value: false };
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'pr-state') {
        if (failing.value) return { code: 1, stdout: '', stderr: 'gh: rate limited' };
        return { code: 0, stdout: `${mergedLine('demo-quiet-basin')}\n${mergedLine('demo-still-cove')}`, stderr: '' };
      }
      return { code: 0, stdout: '', stderr: '' };
    };
    const w = new FleetWatcher(testDeps(home, run), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
    expect(w.currentPrStates().get('demo-quiet-basin')?.number).toBe(42);
    // `phase` lands mid-sweep, well before `archiveMerged` and the `finally`
    // that releases the single-flight latch — wait for the FULL first sweep
    // to finish, or forcing a second one below would just bounce off its own
    // still-fresh `prSweepStartedAt` and never reach the failing branch.
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));

    failing.value = true;
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('unknown'));
    const quiet = w.currentPrStates().get('demo-quiet-basin')!;
    const cove = w.currentPrStates().get('demo-still-cove')!;
    expect(quiet.reason).toBe('agent-down');
    expect(cove.reason).toBe('agent-down');
    // Prior good fields survive the grey — only phase/reason/retryAt changed.
    expect(quiet.number).toBe(42);
    expect(quiet.retryAt).not.toBeNull();
    // A fresh (no-prior-backoff) failure doubles PR_SWEEP_MS (120_000 -> 240_000),
    // capped at PR_BACKOFF_MAX_MS (900_000) — pin the actual arithmetic, not
    // just "sometime in the future", so a broken multiplier or an inverted cap
    // (Math.max instead of Math.min) cannot masquerade as "greater than now".
    const delta = quiet.retryAt! - Date.now();
    expect(delta).toBeGreaterThan(200_000);
    expect(delta).toBeLessThan(300_000);
    expect(calls.filter((c) => c[0] === 'pr-state')).toHaveLength(2);

    // A third tick, forced due again, must NOT re-poll this project: it's backed off.
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state'), 'an active per-project backoff must block the next due sweep').toHaveLength(2);
    w.stop();
  });

  it('unauthenticated jumps straight to the 15-minute ceiling, not the doubling step', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const out = JSON.stringify({ phase: 'unknown', reason: 'unauthenticated' });
    const w = new FleetWatcher(testDeps(home, runnerFor(out, calls)), new Bus(), 10_000);
    const before = Date.now();
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.reason).toBe('unauthenticated'));
    const retryAt = w.currentPrStates().get('demo-quiet-basin')!.retryAt!;
    // A fresh (no-prior-backoff) DOUBLING step would land at 240_000ms out;
    // 'unauthenticated' must skip straight to the 900_000ms ceiling instead.
    expect(retryAt - before).toBeGreaterThan(800_000);
    w.stop();
  });

  it('clears an existing backoff on a successful read, so normal cadence resumes', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    // Pre-seed an expired backoff so the per-project `until` gate doesn't
    // itself block this sweep — isolates `prBackoff.delete(project)`.
    (w as unknown as { prBackoff: Map<string, { until: number; step: number }> })
      .prBackoff.set('demo', { until: Date.now() - 1, step: 240_000 });
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
    expect((w as unknown as { prBackoff: Map<string, unknown> }).prBackoff.has('demo')).toBe(false);
    w.stop();
  });
});

describe('the unsupported-verb branch — a fleet that never advertised pr-state', () => {
  it('marks every session of the project "unsupported", without ever calling ccd', async () => {
    const home = seed(['demo-quiet-basin', 'demo-still-cove']);
    liveIdle(home);
    const calls: string[][] = [];
    const deps = { ...testDeps(home, runnerFor('', calls)), fleetState: { connected: true, downSince: null, ccdVerbs: ['start'], rosterFp: null, build: null } };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.reason).toBe('unsupported'));
    const quiet = w.currentPrStates().get('demo-quiet-basin')!;
    const cove = w.currentPrStates().get('demo-still-cove')!;
    expect(quiet.phase).toBe('unknown');
    expect(cove.phase).toBe('unknown');
    expect(cove.reason).toBe('unsupported');
    expect(quiet.retryAt).toBeNull();
    expect(quiet.number).toBeNull();
    expect(calls.filter((c) => c[0] === 'pr-state')).toEqual([]);   // never called at all
    w.stop();
  });
});

// THE MERGED LANE ANNOUNCES AND NEVER ACTS (operator ruling, 2026-09-10).
//
// This lane used to run `ccd ws-archive` on a merged workspace the moment it
// measured idle and unwatched — the only destructive ccd call in this server
// that NOBODY ASKED FOR. (The two that remain both answer a request: the
// operator's own `/archive` route, and a run close carrying
// `{state:'failed', archive:true}`.) `ws-archive` deletes nothing on disk, but
// it unsupervises the unit and kills the tmux pane, so it ends the session, its
// scrollback and any turn in flight (`ccd/ccd`'s `_ws_archive`).
//
// MEASURED on the live fleet the day this changed: 7 of the box's 13 archive
// markers read `merged:#N`, five of them from the preceding 48 hours — and ALL
// FIVE sat on sessions that were alive again, revived by hand after the sweep
// had killed them. The sweep was not tidying finished work; it was interrupting
// work in progress, on a level trigger that re-fired every 120 s (`ws-restore`
// clears the marker that suppresses it, so a restored workspace was re-killed).
//
// Its safety ladder could not see the harm and never could: `archiveSafety`
// measured an INSTANTANEOUS `idle`, and a session parked at the prompt while
// its operator reads the last answer measures exactly that. A `tmux attach` on
// the fleet box was invisible to it; only an open PWA websocket counted.
//
// So the act is gone and the SENTENCE stays: one notification per (workspace,
// PR), whatever is or is not in the way. Archiving remains a thing a human
// does — `POST /api/sessions/:id/archive` from the PWA, `ccd ws-archive` at a
// terminal — and the coordinator's own lane (`coord/close.ts`'s
// `{state:'failed', archive:true}`) is untouched.
describe('the merged lane announces and never acts', () => {
  it('runs NO ws-archive for a merged, idle, unattached workspace, and says so instead', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    // `prSweepStartedAt` back to 0 is the one signal the whole sweep finished —
    // waiting on the absence of a call otherwise proves only that it is slow.
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    const payload = notify.mock.calls[0]![0];
    expect(payload.title).toContain('merged');
    expect(payload.body).toContain('#42');
    expect(payload.body).toContain('nothing archived');
    w.stop();
  });

  it('announces a SECOND merged PR from the same workspace — the latch is per (workspace, PR), not per workspace', async () => {
    // The reason the act had to go, stated as a test: a workspace that merges
    // one PR is usually not finished. Now that it survives its first merge it
    // can land another, and the operator has to hear about that one too.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));

    // The same sweep again with the SAME PR: the latch holds, no second push.
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
    expect(notify).toHaveBeenCalledTimes(1);

    // A NEW pr-state reading, a higher PR number: `boundRow` binds the newest
    // PR on the branch, so this is what a second merge from one workspace
    // actually looks like on the wire.
    (w as unknown as { deps: { runCcd: unknown } }).deps.runCcd =
      testDeps(home, runnerFor(mergedLine('demo-quiet-basin', 43), calls)).runCcd;
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(2));
    expect(notify.mock.calls[1]![0].body).toContain('#43');
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('announces a BUSY session\'s merge too — liveness gated a destructive act, and there is no longer one to gate', async () => {
    const home = seed(['demo-quiet-basin']);
    const dir = path.join(home, '.claude', 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ pid: 4242, sessionId: '1'.repeat(36), cwd: '/d', status: 'busy', statusUpdatedAt: 1 }));
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('announces a WATCHED session\'s merge too — an open chat screen is not a reason to stay silent', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const bus = new Bus();
    bus.on('session:demo-quiet-basin', () => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, bus, 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('takes NO tmux or live-state reading for a merged row — the lane measures nothing because it acts on nothing', async () => {
    // `archiveSafety`'s pane pid + `<pid>.json` reads existed to prove an
    // affirmative idle before destroying something. In remote mode each one is
    // an agent round trip, per merged row, per sweep — and merged rows now
    // ACCUMULATE, because nothing retires them on a timer any more. The lane
    // must not pay that price for a sentence it can write from the snapshot.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    // `detectDialogs` takes its own capture-pane/list-panes for every row, so
    // the assertion is about the SWEEP's own extra reads: with the lane's
    // measurement gone there is exactly one `has-session` per tick (the dialog
    // detector's), never a second one taken at an archive decision point.
    expect(calls.filter((c) => c[0] === 'has-session').length).toBeLessThanOrEqual(1);
    w.stop();
  });
});

// THE RUNGS ABOVE THE ACT, which outlived it. Every one of them used to decide
// whether to DESTROY a workspace; each now decides whether there is a sentence
// at all (the phase, the degraded row) and what clause it carries (the hold,
// the open run). They are pinned apart from the describe above because of what
// makes them non-vacuous: an assertion that no `ws-archive` ran would now pass
// with the whole lane deleted, so each of these turns on the ANNOUNCEMENT the
// rung changes — its presence, its absence, or its exact words.
describe('the merged lane\'s surviving rungs choose the SENTENCE', () => {
  it('stays silent on an UNKNOWN phase, and speaks the moment the sweep reads merged', async () => {
    // `pr?.phase !== 'merged'` is the same rung that used to mean "unknown
    // never archives", and it is still why a `gh` timeout does not tell the
    // operator their PR landed. The second sweep is what keeps this from being
    // a tautology: exactly ONE thing changes between them, the phase.
    //
    // A per-session grey (the line carries an `id`), NOT the id-less shape the
    // deleted test used: that one is a whole-repo failure, so it would back the
    // project off and the second sweep would never reach `pr-state` at all.
    const home = seed(['demo-quiet-basin']);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const grey = JSON.stringify({ id: 'demo-quiet-basin', phase: 'unknown', reason: 'timeout' });
    const w = new FleetWatcher(
      { ...testDeps(home, runnerFor(grey, calls)), push: { notify } as never }, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('unknown'));
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
    expect(notify).not.toHaveBeenCalled();

    (w as unknown as { deps: { runCcd: unknown } }).deps.runCcd =
      testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)).runCcd;
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toContain('nothing archived');
    w.stop();
  });

  it('says nothing at all for a DEGRADED row, and everything for the same row measured', async () => {
    // `measuredIdentity(r) === null` no longer guards an act — there is none —
    // but it still guards the CLAIM. `held` reads null on a row whose files
    // this box could not read exactly as it does on a workspace nobody holds,
    // so announcing the unqualified "nothing is in the way" off a degraded row
    // states something never measured. Silence is the honest answer.
    //
    // The second watcher is the whole point: one fixture, one field, and the
    // announcement appears. Without it this would pass with the lane deleted.
    const home = seed(['demo-quiet-basin']);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const w = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      io: unreadableField('demo-quiet-basin', 'workdir'), push: { notify } as never }, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged'));
    await vi.waitFor(() => expect((w as unknown as { prSweepStartedAt: number }).prSweepStartedAt).toBe(0));
    expect(notify).not.toHaveBeenCalled();
    w.stop();

    const measured = vi.fn(async (_payload: PushPayload) => {});
    const w2 = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify: measured } as never }, new Bus(), 10_000);
    await w2.tick();
    await vi.waitFor(() => expect(measured).toHaveBeenCalledTimes(1));
    w2.stop();
  });

  it('names the HOLD in the sentence, verbatim', async () => {
    // The hold used to be the rung that REFUSED the archive; it is now the
    // clause that explains why the workspace is still here. Asserted whole,
    // not `toContain`: the reason string IS the display (`registry.ts`'s
    // HOLD_UNREADABLE docstring), so a hold reworded, truncated or prefixed on
    // its way to the tray is the defect this pins.
    const home = seed(['demo-quiet-basin']);
    writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.hold'), 'program:orca wave:2/3');
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const w = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify } as never }, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body).toBe('PR #42 merged — program:orca wave:2/3; nothing archived.');
    w.stop();
  });

  it('names the OPEN RUN when nothing is held — and still announces with no coord store to ask', async () => {
    // THE RUNG THAT AN ABSENT HOLD IS NOT ENOUGH ON ITS OWN. Release-then-crash
    // and the archive-vs-hold race both leave a live wave's workspace unheld
    // for a window; the run row outlives both, so it is what names the wave
    // still working in a workspace whose PR just landed. It reaches the tray
    // verbatim, same as the hold above.
    //
    // The second watcher pins the `?.`/`?? []` on `coord`: `testDeps` supplies
    // no store, and a server with coordination switched off has no runs to be
    // claimed by — so it announces the PLAIN sentence rather than throwing
    // inside a void-dispatched sweep, where the TypeError would surface only
    // as a notification that never came.
    const home = seed(['demo-quiet-basin']);
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const opened = coord.openRun({ program: 'build4', title: 't', project: 'demo',
      wave: 2, waveOf: 3, claimedBy: 'ccrc-pwa-coordinator' });
    if (!('id' in opened)) throw new Error('fixture openRun refused');
    coord.setSession(opened.id, 'demo-quiet-basin');

    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const w = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      coord, push: { notify } as never }, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    expect(notify.mock.calls[0]![0].body)
      .toBe(`PR #42 merged — run ${opened.id} is still open — build4 wave 2/3; nothing archived.`);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();

    const coordless = vi.fn(async (_payload: PushPayload) => {});
    const w2 = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify: coordless } as never }, new Bus(), 10_000);
    await w2.tick();
    await vi.waitFor(() => expect(coordless).toHaveBeenCalledTimes(1));
    expect(coordless.mock.calls[0]![0].body).toBe('PR #42 merged; nothing archived.');
    w2.stop();
  });

  it('addresses the push at the merged session and collapses on `merged-<id>#<pr>`', async () => {
    // What the tray can actually do with this, and nothing more. `push-sw.js`
    // passes no `actions[]`, so copy offering a choice would be a lie on the
    // lock screen — the body is a statement of fact and `sessionId` is the
    // only affordance, deep-linking to /s/<id>. The tag is the other half:
    // `mergedNotified` is in-memory, so a restart may repeat this push, and
    // the tag is what makes that repeat REPLACE the first rather than stack a
    // second identical notification — and why the tag carries the PR NUMBER
    // as well as the id: a workspace can land a second PR now, and an id-only
    // key would let #43's announcement quietly overwrite #42's in the tray.
    const home = seed(['demo-quiet-basin']);
    const calls: string[][] = [];
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const w = new FleetWatcher({ ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      push: { notify } as never }, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalledTimes(1));
    const payload = notify.mock.calls[0]![0];
    expect(payload.sessionId).toBe('demo-quiet-basin');
    expect(payload.tag).toBe('merged-demo-quiet-basin#42');
    expect(payload.title).toBe('✓ merged › quiet-basin');
    expect(payload.actions).toBeUndefined();
    w.stop();
  });
});
