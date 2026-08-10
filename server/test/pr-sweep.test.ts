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
import type { PrState } from '../../shared/api.js';
import type { PushPayload } from '../src/push.js';
import { localIO, type FleetIO } from '../src/io.js';

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

const mergedLine = (id: string): string => JSON.stringify({
  id, project: 'demo', repo: 'o/r', branch: 'ws/' + id, base: 'origin/main', baseShort: 'main',
  tip: 'f'.repeat(40), ahead: 3, dirty: 0, commits: [], template: null,
  rows: [{ number: 42, state: 'MERGED', headRefName: 'ws/' + id, headRefOid: 'deadbee',
    baseRefName: 'main', isCrossRepository: false, mergedAt: '2026-07-20T10:00:00Z',
    mergeCommit: { oid: '7a68ca0' }, url: 'u', title: 't', isDraft: false,
    statusCheckRollup: null, ours: true }],
  phase: 'merged', number: 42, checkedAt: 1785300000000, reason: null,
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
    const deps = { ...testDeps(home, runnerFor('', calls)), fleetState: { connected: false, downSince: 1, ccdVerbs: null } };
    deps.cfg = { ...deps.cfg, fleetMode: 'remote' };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'pr-state')).toEqual([]);
    w.stop();
  });
});

describe('level-triggered archiving', () => {
  it('archives a merged, idle, unattached workspace', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls).toContainEqual(['ws-archive', '--session', 'demo-quiet-basin']));
    w.stop();
  });

  it('RETRIES on the next sweep rather than consuming an edge', async () => {
    // ws-archive is idempotent, so a level is free to re-fire. An edge
    // consumed on one box and never received on the other strands the
    // workspace in a state the UI claims was archived.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(1));
    (w as unknown as { lastPrSweep: number }).lastPrSweep = 0;
    await w.tick();
    await vi.waitFor(() => expect(calls.filter((c) => c[0] === 'ws-archive')).toHaveLength(2));
    w.stop();
  });

  it('does NOT archive a busy session', async () => {
    const home = seed(['demo-quiet-basin']);
    const dir = path.join(home, '.claude', 'sessions');
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, '4242.json'), JSON.stringify({ pid: 4242, sessionId: '1'.repeat(36), cwd: '/d', status: 'busy', statusUpdatedAt: 1 }));
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('does NOT archive when the status is UNKNOWN — never collapse unknown to idle', async () => {
    // liveStatus returns 'idle' when the status file is unreadable, and in
    // remote mode that read crosses the agent WS: a socket hiccup would
    // otherwise kill a running turn.
    const home = seed(['demo-quiet-basin']);   // no sessions/<pid>.json at all
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('does NOT archive a session someone is watching', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const bus = new Bus();
    bus.on('session:demo-quiet-basin', () => {});
    const w = new FleetWatcher(testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), bus, 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('does NOT archive an unknown phase, at any staleness', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor('{"phase":"unknown","reason":"timeout"}', calls)), new Bus(), 10_000);
    await w.tick();
    await new Promise((r) => setTimeout(r, 50));
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    w.stop();
  });

  it('notifies AFTER the archive succeeded, promising only navigation', async () => {
    // PushPayload is {title, body, sessionId?} and push-sw.js passes no
    // actions[], so any "tap to keep / tap to cancel" copy would be a straight
    // lie on the lock screen.
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    // Typed with `PushPayload`, not `async () => {}`: an untyped, zero-arg
    // mock infers a zero-arg call-args TUPLE, so indexing `[0]` below does
    // not typecheck under a test/-inclusive tsconfig — invisible here only
    // because the real server tsconfig excludes test/ (pre-merge fix round,
    // finding 14-M1; this was copied verbatim from the brief itself).
    const notify = vi.fn(async (_payload: PushPayload) => {});
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(notify).toHaveBeenCalled());
    const payload = notify.mock.calls[0]![0];
    expect(payload.title).toContain('merged');
    expect(payload.body).toContain('nothing deleted');
    expect(payload.sessionId).toBe('demo-quiet-basin');
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
    const deps = { ...testDeps(home, runnerFor('', calls)), fleetState: { connected: true, downSince: null, ccdVerbs: ['start'] } };
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

  // ROUND 3 — the third instance of NF10's class, and the only one that is not
  // a route. `archiveMerged` is LEVEL-triggered by design (see the retry test
  // above), so on a host whose ccd predates `ws-archive` the ungated call did
  // not fail once: it re-fired for every merged session on every sweep,
  // forever. The gate has to sit here and not only on the two routes.
  it('never fires the level-triggered ws-archive at a fleet that lacks the verb', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    // `pr-state` IS advertised — otherwise the sweep short-circuits upstream at
    // watch.ts's own gate and this would pass for the wrong reason, proving
    // nothing about archiveMerged.
    const deps = { ...testDeps(home, runnerFor(mergedLine('demo-quiet-basin'), calls)),
      fleetState: { connected: true, downSince: null, ccdVerbs: ['pr-state'] } };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    // Waiting on the merged PHASE is not enough and would make this pass both
    // ways: `tick()` fires `sweepPr()` with `void`, and archiveMerged runs
    // AFTER the phase lands, so the assertion would race the very call it
    // forbids. `prSweepStartedAt` returns to 0 in sweepPr's own `finally`, so
    // it is the one signal that the whole sweep — archiveMerged included —
    // has finished. (Measured: without this wait, deleting the gate under test
    // leaves the test green.)
    const started = (): number => (w as unknown as { prSweepStartedAt: number }).prSweepStartedAt;
    await vi.waitFor(() => { expect(started()).not.toBe(0); });
    await vi.waitFor(() => { expect(started()).toBe(0); });
    expect(w.currentPrStates().get('demo-quiet-basin')?.phase).toBe('merged');
    expect(calls).toContainEqual(['pr-state', '--project', 'demo']);
    expect(calls.filter((c) => c[0] === 'ws-archive')).toEqual([]);
    // Level, not edge: the state is untouched, so the archive happens on the
    // first sweep after the host is upgraded.
    expect(w.currentPrStates().get('demo-quiet-basin')?.reason).toBeNull();
    w.stop();
  });
});

describe('archiveSafety — an unconfigured wrapper is UNKNOWN, never a silent ok', () => {
  it('a valid pid with no cfgDir for its wrapper is unknown, not ok', async () => {
    // Isolates `!pid || !cfgDir` from `||`-vs-`&&`: pid resolves fine, but
    // the wrapper was never registered in cfg.wrappers, so cfgDir is
    // undefined. `||` must short the whole check to 'unknown' BEFORE ever
    // handing `undefined` to readLiveState.
    const home = seed(['demo-quiet-basin']);
    writeFileSync(path.join(home, '.cc-sessions', 'demo-quiet-basin.wrapper'), 'ghost-wrapper');
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor('', calls)), new Bus(), 10_000);
    await expect(w.archiveSafety('demo-quiet-basin')).resolves.toEqual({ verdict: 'unknown', held: null });
    w.stop();
  });

  it('an id with no registry record at all is unknown, not ok', async () => {
    // Mutation-sweep finding: collapsing `if (!rec) return 'unknown';` to
    // `return 'ok';` survived every other test — nothing calls archiveSafety
    // for an id readRegistry() cannot find. Real gap, not equivalent:
    // archiveMerged's OWN records come from an EARLIER readRegistry() call
    // than archiveSafety's; if the entry vanishes between the two reads (the
    // session was reaped, or its registry files were mid-write), an
    // unidentifiable session must defer, never be treated as safe.
    const home = seed(['demo-quiet-basin']);   // registry has demo-quiet-basin, NOT demo-ghost
    const calls: string[][] = [];
    const w = new FleetWatcher(testDeps(home, runnerFor('', calls)), new Bus(), 10_000);
    await expect(w.archiveSafety('demo-ghost')).resolves.toEqual({ verdict: 'unknown', held: null });
    w.stop();
  });

  // Registry ladder (architecture doc, increment 1's second half): a row
  // that USED to be dropped entirely (readRegistry's old blanket rule) is
  // now DEGRADED instead — `readSessionRecord` finds it — so `!rec` alone no
  // longer catches this case. Written FIRST and confirmed red against the
  // pre-gate code, which would fall through past the (now-added)
  // `measuredIdentity` check straight to `configDirFor(cfg.home, rec.wrapper)`
  // — `rec.wrapper` measured fine here, so it would have answered `'ok'`
  // for a row whose OWN `.workdir`/`.uuid` this read could not confirm at
  // all, preserving the pre-change behaviour for the previously-dropped row
  // is exactly what this pins.
  it('a row LISTED but with an unmeasured identity field is unknown, not ok — SKIP, preserving the ' +
     'previously-dropped row\'s own answer exactly', async () => {
    const home = seed(['demo-quiet-basin']);
    const unreadableWorkdir: FleetIO = {
      ...localIO,
      readFile: async (p) => (p.endsWith('demo-quiet-basin.workdir') ? null : localIO.readFile(p)),
    };
    const calls: string[][] = [];
    const w = new FleetWatcher({ ...testDeps(home, runnerFor('', calls)), io: unreadableWorkdir }, new Bus(), 10_000);
    await expect(w.archiveSafety('demo-quiet-basin')).resolves.toEqual({ verdict: 'unknown', held: null });
    w.stop();
  });
});

describe('the idempotent re-fire — "already archived" must not push a second notification', () => {
  it('does not notify when ws-archive reports it was already archived', async () => {
    const home = seed(['demo-quiet-basin']);
    liveIdle(home);
    const calls: string[][] = [];
    const notify = vi.fn(async () => {});
    const run: Runner = async (_cmd, args) => {
      calls.push(args);
      if (args[0] === 'has-session') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'list-panes') return { code: 0, stdout: '4242\n', stderr: '' };
      if (args[0] === 'capture-pane') return { code: 0, stdout: '', stderr: '' };
      if (args[0] === 'pr-state') return { code: 0, stdout: mergedLine('demo-quiet-basin'), stderr: '' };
      if (args[0] === 'ws-archive') return { code: 0, stdout: 'already archived demo-quiet-basin', stderr: '' };
      return { code: 0, stdout: '', stderr: '' };
    };
    const deps = { ...testDeps(home, run), push: { notify } as never };
    const w = new FleetWatcher(deps, new Bus(), 10_000);
    await w.tick();
    await vi.waitFor(() => expect(calls).toContainEqual(['ws-archive', '--session', 'demo-quiet-basin']));
    await new Promise((r) => setTimeout(r, 50));
    expect(notify).not.toHaveBeenCalled();
    w.stop();
  });
});
