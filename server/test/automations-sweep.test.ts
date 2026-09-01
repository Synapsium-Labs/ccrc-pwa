// Task 8 (docs: .superpowers/sdd/2026-08-31-automations/task-8-brief.md, spec
// §6, §8), PLUS the controller's ruling on `POST /:id/run` (2026-09-01): the
// act (spawn, identify, adopt, prompt) belongs on the TICK, in exactly one
// place — this sweep. `POST /:id/run` now only claims (fast, one
// transaction) and answers 202; the run stays `outcome='running'` with an
// open lease until THIS sweep notices it and hands it to `fireAutomation`.
// That is why `fireAutomation` has exactly one caller in the whole tree
// after this task, and it is also what makes the property survive a server
// restart mid-run.
//
// Every `it` below drives `w.sweepAutomations()` DIRECTLY, never a timer —
// `tick()` void-dispatches it, so a test awaiting `tick()` has not awaited
// the sweep (its own docstring states this, matching `sweepNames`/
// `sweepMail`/`sweepLifecycle`).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FleetWatcher } from '../src/watch.js';
import { Bus } from '../src/bus.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { NotifyLog } from '../src/notifylog.js';
import { COORDINATOR_PAUSE_MARKER } from '../src/coord/rundefs.js';
import { AUTOMATION_PUNCTUAL_MS } from '../src/auto/schedulepolicy.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';
import type { Deps } from '../src/server.js';
import type { Runner } from '../src/exec.js';
import type { Cadence } from '../../shared/schedule.js';

const srcRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src');
const NOW = 1_785_300_000_000;
const PROJECT = 'demo';

// `mail-sweep.test.ts:239-245`'s shipped idiom, verbatim: only `Date` is
// faked, so `fs` and the microtask queue (and `vi.waitFor`'s own real-timer
// polling) behave.
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { vi.useRealTimers(); });
const advance = (ms: number): void => { vi.setSystemTime(Date.now() + ms); };

const wallClock = (over: Partial<{ days: number; minuteOfDay: number; tz: string }> = {}): Cadence =>
  ({ kind: 'wall-clock', days: 0b1111111, minuteOfDay: 540, tz: 'UTC', ...over });

/** `automations-store.test.ts`'s own `makeArmed`, reused verbatim in shape:
 *  prove the automation with a DIRECT, fake manual run (bypassing
 *  `fireAutomation` entirely — this is setup, not the thing under test),
 *  then arm it at the caller's own `nextRunAt`. */
const makeArmed = (
  s: CoordStore, now: number, nextRunAt: number, graceMs = 1_800_000, project = PROJECT,
): number => {
  const { id } = s.insertAutomation(
    { name: 'nightly', project, prompt: 'go', cadence: wallClock(), graceMs }, now,
  );
  const claim = s.claimAndOpenRun({ automationId: id, now, occurrence: { trigger: 'manual' } });
  if (!('runId' in claim)) throw new Error('setup: manual proving claim was refused');
  s.markAutomationSpawn({
    runId: claim.runId, spawnRc: 0,
    identity: {
      bound: true, sessionId: 'proof-session', workspace: 'ws', branch: 'main',
      wrapper: 'claude', adopted: false,
    },
  });
  s.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: now + 1 });
  const armed = s.armAutomation(id, nextRunAt, now + 2);
  if (!armed.ok) throw new Error('setup: arm was refused');
  return id;
};

/** One registry row on disk — `automations-fire.test.ts`'s `seedSession`,
 *  renamed to match this file's `automations-routes.test.ts` sibling. */
const seedRow = (home: string, id: string, project = PROJECT): void => {
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  const fields: Record<string, string> = {
    wrapper: 'claude', project, workdir: `/w/${id}`, uuid: `u-${id}`, started: '1',
    workspace: id, branch: `ws/${id}`, base: 'origin/main',
  };
  for (const [k, v] of Object.entries(fields)) writeFileSync(path.join(reg, `${id}.${k}`), v);
};

/** A scripted `Runner` that answers `ws-add` (seeding exactly one new
 *  registry row, ONCE — idempotent, so a second `ws-add` call from a bug
 *  would be visible in `calls` without corrupting the fixture) and
 *  `capture-pane` (an empty->echoed->empty pane so `sendPrompt` lands),
 *  `automations-routes.test.ts`'s `makeRunner` shape. */
function makeRunner(home: string, promptText: string, project = PROJECT):
{ run: Runner; calls: string[][]; sessionId: string } {
  const calls: string[][] = [];
  const sessionId = `${project}-auto-quiet-basin`;
  const panes = ['scrollback\n❯ \n', `scrollback\n❯ ${promptText}\n`, 'scrollback\n❯ \n'];
  let capIdx = 0;
  let seeded = false;
  const run: Runner = async (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'ws-add') {
      if (!seeded) { seedRow(home, sessionId, project); seeded = true; }
      return { code: 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'capture-pane') {
      const p = panes[Math.min(capIdx, panes.length - 1)]!;
      capIdx++;
      return { code: 0, stdout: p, stderr: '' };
    }
    return { code: 0, stdout: '', stderr: '' };
  };
  return { run, calls, sessionId };
}

/** Primes a watcher the same way `mail-sweep.test.ts`'s `primedWatcher` does
 *  — a listable-but-empty registry (`.cc-sessions` created first), one
 *  `tick()`, THEN the caller seeds/arms fixtures — plus a `NotifyLog` every
 *  test gets whether it reads it or not (harmless unused, and it lets the
 *  NotifyEvent cases below share this one rig). */
async function rig(): Promise<{
  w: FleetWatcher; coord: CoordStore; home: string; calls: string[][]; deps: Deps; log: NotifyLog;
}> {
  const home = mkTmp('ccrc-auto-sweep-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  const { run, calls } = makeRunner(home, 'go');
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const log = new NotifyLog(path.join(home, 'notify.json'));
  await log.load();
  const deps: Deps = { ...testDeps(home, run), coord, notifyLog: log };
  const w = new FleetWatcher(deps, new Bus(), 2000);
  await w.tick();
  return { w, coord, home, calls, deps, log };
}

describe('FleetWatcher.sweepAutomations — the schedule path', () => {
  it('a due armed automation fires exactly once — spawns and prompts a real session', async () => {
    const { w, coord, calls } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    await w.sweepAutomations();
    await vi.waitFor(() => {
      const fired = coord.automationRuns(id, 5).find((r) => r.trigger === 'schedule');
      expect(fired?.outcome).toBe('ok');
    });
    const fired = coord.automationRuns(id, 5).find((r) => r.trigger === 'schedule')!;
    expect(fired.sessionId).not.toBeNull();
    expect(calls.filter((c) => c.includes('ws-add')).length).toBe(1);
  });

  it('a paused automation does not fire, even past its old due time', async () => {
    const { w, coord } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    coord.setAutomationState(id, 'paused', NOW);
    await w.sweepAutomations();
    // Only the direct proving run from setup exists — nothing new fired.
    expect(coord.automationRuns(id, 5).length).toBe(1);
  });

  it('a row with scheduleError set is excluded — dueAutomations() itself refuses it', async () => {
    const { w, coord } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    // The invariant (`state='armed' AND scheduleError IS NULL <=> nextRunAt
    // IS NOT NULL`) is a CHECK constraint — nextRunAt must clear alongside.
    coord.db.prepare("UPDATE automations SET scheduleError = 'bad-cadence', nextRunAt = NULL WHERE id = ?").run(id);
    await w.sweepAutomations();
    expect(coord.automationRuns(id, 5).length).toBe(1);
  });

  it('provedAt IS NULL excludes an automation from dueAutomations — it cannot even be armed to test the sweep against', async () => {
    const { w, coord } = await rig();
    const { id } = coord.insertAutomation(
      { name: 'never proved', project: PROJECT, prompt: 'go', cadence: wallClock(), graceMs: 1_800_000 }, NOW,
    );
    const armed = coord.armAutomation(id, NOW, NOW);
    expect(armed).toEqual({ ok: false, why: 'never-run-by-hand' });
    await w.sweepAutomations();
    expect(coord.automationRuns(id, 5).length).toBe(0);
  });
});

describe('FleetWatcher.sweepAutomations — the gate', () => {
  it('is GATED — a second call inside AUTOMATION_SWEEP_MS does no work; the first call after construction runs immediately', async () => {
    const { w, coord } = await rig();
    await w.sweepAutomations();                       // the FIRST sweep always runs (nothing due yet)
    const id = makeArmed(coord, NOW, NOW);
    await w.sweepAutomations();
    expect(
      coord.automationRuns(id, 5).some((r) => r.trigger === 'schedule'),
      'the gate did not hold',
    ).toBe(false);
    advance(10_000 + 1);                               // AUTOMATION_SWEEP_MS
    await w.sweepAutomations();
    await vi.waitFor(() => {
      const fired = coord.automationRuns(id, 5).find((r) => r.trigger === 'schedule');
      expect(fired?.outcome).toBe('ok');
    });
  });

  it('the priming tick fires nothing — restart-quiet', async () => {
    const home = mkTmp('ccrc-auto-sweep-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    const { run } = makeRunner(home, 'go');
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const id = makeArmed(coord, NOW, NOW);             // already due BEFORE the watcher ever primes
    const deps: Deps = { ...testDeps(home, run), coord };
    const w = new FleetWatcher(deps, new Bus(), 2000);
    await w.tick();                                    // the priming tick — `sweepAutomations` is
                                                         // dispatched but must no-op: `primed` is still
                                                         // false at the instant it is called.
    expect(coord.automationRuns(id, 5).length).toBe(1); // only the direct proving run
  });
});

describe('FleetWatcher.sweepAutomations — lateness and the per-restart catch-up bound', () => {
  it('a five-hours-late occurrence past a 30-minute grace records missed and fires nothing', async () => {
    const { w, coord, calls } = await rig();
    const graceMs = 30 * 60_000;
    const id = makeArmed(coord, NOW, NOW, graceMs);
    advance(5 * 3_600_000);
    await w.sweepAutomations();
    const runs = coord.automationRuns(id, 5);
    expect(runs[0]).toMatchObject({ outcome: 'missed', refusal: null });
    expect(coord.automation(id)!.nextRunAt).not.toBeNull();
    expect(coord.automation(id)!.nextRunAt!).toBeGreaterThan(Date.now());
    expect(calls.some((c) => c.includes('ws-add'))).toBe(false);
  });

  it('a ten-minutes-late occurrence fires once as a catchup, with a truthful lateMs', async () => {
    const { w, coord } = await rig();
    const graceMs = 30 * 60_000;
    const id = makeArmed(coord, NOW, NOW, graceMs);
    advance(10 * 60_000);
    expect(10 * 60_000).toBeGreaterThan(AUTOMATION_PUNCTUAL_MS);
    await w.sweepAutomations();
    await vi.waitFor(() => {
      const fired = coord.automationRuns(id, 5).find((r) => r.trigger === 'catchup');
      expect(fired?.outcome).toBe('ok');
    });
    const fired = coord.automationRuns(id, 5).find((r) => r.trigger === 'catchup')!;
    expect(fired.lateMs).toBeGreaterThanOrEqual(10 * 60_000);
  });

  it('three missed occurrences across a restart produce ONE catch-up, not three', async () => {
    const { w, coord } = await rig();
    const graceMs = 3_600_000;                          // 1 h grace
    // An interval automation (10-minute period, far shorter than grace) armed
    // 35 minutes in the past — the "box off for a weekend" shape spec §8
    // names. Without the per-restart bound, EVERY occurrence inside the
    // grace window would fire as its own catchup as the sweep walks forward.
    const { id } = coord.insertAutomation(
      { name: 'frequent', project: PROJECT, prompt: 'go', cadence: { kind: 'interval', everyMinutes: 10 }, graceMs },
      NOW - 35 * 60_000,
    );
    const claim = coord.claimAndOpenRun({
      automationId: id, now: NOW - 35 * 60_000, occurrence: { trigger: 'manual' },
    });
    if (!('runId' in claim)) throw new Error('setup');
    coord.markAutomationSpawn({
      runId: claim.runId, spawnRc: 0,
      identity: { bound: true, sessionId: 'proof', workspace: 'ws', branch: 'main', wrapper: 'claude', adopted: false },
    });
    coord.settleAutomationRun({ runId: claim.runId, settlement: { outcome: 'ok' }, now: NOW - 35 * 60_000 + 1 });
    const armed = coord.armAutomation(id, NOW - 35 * 60_000, NOW - 35 * 60_000 + 2);
    if (!armed.ok) throw new Error('setup: arm was refused');

    // Walk several sweep ticks — each `dueAutomations()` call only ever
    // offers the CURRENT `nextRunAt`, so the backlog is discovered one
    // occurrence per tick, not all at once.
    for (let i = 0; i < 6; i++) {
      await w.sweepAutomations();
      advance(10_000 + 1);                              // past AUTOMATION_SWEEP_MS
      const row = coord.automation(id)!;
      if (row.nextRunAt !== null && row.nextRunAt > Date.now()) break;
    }
    await vi.waitFor(() => {
      const catchup = coord.automationRuns(id, 20).find((r) => r.trigger === 'catchup');
      expect(catchup?.outcome).toBe('ok');
    });

    const runs = coord.automationRuns(id, 20);
    const catchups = runs.filter((r) => r.trigger === 'catchup');
    expect(catchups.length).toBe(1);
    expect(catchups[0]!.outcome).toBe('ok');
    // AND NO `missed` ROWS — every occurrence here sits INSIDE the 1h grace,
    // and spec §8 scopes that outcome to the other side of it: "an occurrence
    // within `graceMs` fires ONCE with `trigger='catchup'` and its real
    // `lateMs`. BEYOND grace it records `outcome='missed'` and advances."
    //
    // This is not a hole in the history, which is the thing §8 actually
    // forbids ("an operator told nothing would reasonably believe it ran").
    // The single catch-up row carries `lateMs` for the WHOLE span — measured
    // at 35 minutes, the full distance back to the first skipped occurrence —
    // so the operator reads "ran, 35 minutes late", which is the true story.
    // Writing a row per collapsed occurrence would contradict the rule this
    // test exists for: one catch-up per restart, "never one per missed
    // occurrence", because a box off for a weekend must not wake and spawn
    // ninety sessions.
    //
    // The beyond-grace case — where `missed` rows ARE required — is pinned by
    // 'a five-hours-late occurrence past a 30-minute grace records missed and
    // fires nothing' above.
    expect(runs.filter((r) => r.outcome === 'missed')).toEqual([]);
    expect(catchups[0]!.lateMs).toBeGreaterThanOrEqual(30 * 60_000);
  });
});

describe('FleetWatcher.sweepAutomations — the lease lapse', () => {
  it('a running run past leaseHardUntil settles lost — a record written, nothing on the fleet touched', async () => {
    const { w, coord, calls } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    // A lease with no one working it, exactly what a crashed prior process
    // (or the new claim-only `/run` route) leaves standing.
    const claim = coord.claimAndOpenRun({ automationId: id, now: NOW, occurrence: { trigger: 'manual' } });
    if (!('runId' in claim)) throw new Error('setup');
    advance(600_000 + 1);                               // past AUTOMATION_LEASE_HARD_MS
    await w.sweepAutomations();
    const run = coord.automationRun(claim.runId)!;
    expect(run.outcome).toBe('lost');
    expect(calls.some((c) => c.includes('ws-add'))).toBe(false);
  });
});

describe('FleetWatcher.sweepAutomations — a throwing fireAutomation does not kill the tick', () => {
  it('the sweep resolves; the run stays leased rather than being retried', async () => {
    const home = mkTmp('ccrc-auto-sweep-');
    mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
    let wsAddCalls = 0;
    const run: Runner = async (_cmd, args) => {
      if (args[0] === 'ws-add') { wsAddCalls++; throw new Error('boom — simulated transport failure'); }
      return { code: 0, stdout: '', stderr: '' };
    };
    const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
    const deps: Deps = { ...testDeps(home, run), coord };
    const w = new FleetWatcher(deps, new Bus(), 2000);
    await w.tick();
    const id = makeArmed(coord, NOW, NOW);

    await expect(w.sweepAutomations()).resolves.toBeUndefined();
    await vi.waitFor(() => expect(wsAddCalls).toBe(1));

    // A SECOND tick, once the gate reopens, must not retry: the throw could
    // have happened AFTER a real spawn, and firing again would manufacture a
    // second session for the same automation.
    advance(10_000 + 1);
    await w.sweepAutomations();
    await new Promise((r) => { setImmediate(r); });
    expect(wsAddCalls).toBe(1);
    const row = coord.automation(id)!;
    expect(row.leaseRunId).not.toBeNull();              // still leased — a crash, not a lie
  });
});

describe('FleetWatcher.sweepAutomations — the controller ruling: /run only claims, this sweep performs the act', () => {
  it('a run claimed (simulating POST /:id/run) but not yet started is picked up by the next sweep tick, exactly once', async () => {
    const { w, coord, calls } = await rig();
    const id = makeArmed(coord, NOW, NOW - 500);
    const claim = coord.claimAndOpenRun({ automationId: id, now: NOW, occurrence: { trigger: 'manual' } });
    if (!('runId' in claim)) throw new Error('setup');
    expect(coord.automationRun(claim.runId)!.outcome).toBe('running');

    await w.sweepAutomations();
    await vi.waitFor(() => expect(coord.automationRun(claim.runId)!.outcome).not.toBe('running'));
    expect(coord.automationRun(claim.runId)!.outcome).toBe('ok');
    expect(calls.filter((c) => c.includes('ws-add')).length).toBe(1);

    // A LATER tick must not re-fire the now-settled run.
    advance(10_000 + 1);
    await w.sweepAutomations();
    await new Promise((r) => { setImmediate(r); });
    expect(calls.filter((c) => c.includes('ws-add')).length).toBe(1);
  });

  it('does not double-fire within the SAME tick: the schedule path\'s own fresh claim is not re-picked-up by the leased-run scan that follows it', async () => {
    const { w, coord, calls } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    await w.sweepAutomations();
    await vi.waitFor(() => expect(coord.automationRuns(id, 5)[0]?.outcome).toBe('ok'));
    expect(calls.filter((c) => c.includes('ws-add')).length).toBe(1);
  });
});

describe('FleetWatcher.sweepAutomations — NotifyEvent (kind:\'run\'), only when a session was created', () => {
  it('ok WITH a sessionId raises exactly one NotifyEvent', async () => {
    const { w, coord, log } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    const seqBefore = log.seq;
    await w.sweepAutomations();
    await vi.waitFor(() => expect(coord.automationRuns(id, 5)[0]?.outcome).toBe('ok'));
    expect(log.seq).toBe(seqBefore + 1);
  });

  it('refused (a post-claim rung, e.g. coordinator-paused) raises none', async () => {
    const { w, coord, log, deps } = await rig();
    const id = makeArmed(coord, NOW, NOW - 500);
    writeFileSync(path.join(deps.cfg.registryDir, COORDINATOR_PAUSE_MARKER), '');
    const claim = coord.claimAndOpenRun({ automationId: id, now: NOW, occurrence: { trigger: 'manual' } });
    if (!('runId' in claim)) throw new Error('setup');
    const seqBefore = log.seq;
    await w.sweepAutomations();
    await vi.waitFor(() => expect(coord.automationRun(claim.runId)!.outcome).not.toBe('running'));
    expect(coord.automationRun(claim.runId)!.outcome).toBe('refused');
    expect(log.seq).toBe(seqBefore);
  });

  it('missed raises none', async () => {
    const { w, coord, log } = await rig();
    const graceMs = 30 * 60_000;
    const id = makeArmed(coord, NOW, NOW, graceMs);
    advance(5 * 3_600_000);
    const seqBefore = log.seq;
    await w.sweepAutomations();
    expect(coord.automationRuns(id, 5)[0]!.outcome).toBe('missed');
    expect(log.seq).toBe(seqBefore);
  });

  it('skipped (overlap, a pre-claim rung) raises none', async () => {
    const { w, coord, log } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    // Take the lease directly, simulating a run already in flight when this
    // automation's OWN scheduled occurrence also comes due.
    coord.claimAndOpenRun({ automationId: id, now: NOW, occurrence: { trigger: 'manual' } });
    const seqBefore = log.seq;
    await w.sweepAutomations();
    const runs = coord.automationRuns(id, 5);
    expect(runs.find((r) => r.refusal === 'overlap')).toBeTruthy();
    expect(log.seq).toBe(seqBefore);
  });

  it('lost (a lapsed lease) raises none', async () => {
    const { w, coord, log } = await rig();
    const id = makeArmed(coord, NOW, NOW);
    const claim = coord.claimAndOpenRun({ automationId: id, now: NOW, occurrence: { trigger: 'manual' } });
    if (!('runId' in claim)) throw new Error('setup');
    advance(600_000 + 1);
    const seqBefore = log.seq;
    await w.sweepAutomations();
    expect(coord.automationRun(claim.runId)!.outcome).toBe('lost');
    expect(log.seq).toBe(seqBefore);
  });
});

describe('the tick itself', () => {
  const src = fs.readFileSync(path.join(srcRoot, 'watch.ts'), 'utf8');

  it('adds NO new timer — the sweep rides the tick that already exists', () => {
    expect(src.match(/setInterval\(/g) ?? []).toHaveLength(1);
  });

  it('dispatches the sweep from tick(), never awaited', () => {
    expect(src).toContain('void this.sweepAutomations().catch(');
  });
});


// ── Task 10: the automations FRAME ──────────────────────────────────────────
// Additive, and `FLEET_PROTO` is NOT bumped: a PWA that does not know this
// frame type drops it silently, which is the whole reason the wire is
// additive-only. The byte-equality guard starts at `null`, NEVER at `'[]'` —
// "no automations" and "never measured" are two different facts, and a first
// measurement of an empty fleet must still reach the client or the screen
// cannot tell them apart (which is exactly the three-empty-states rule the
// PWA is held to).
describe('the automations frame — additive, byte-diffed, and it survives a bad read', () => {
  it('emits on the FIRST measurement even when the list is empty', async () => {
    // A FRESH watcher that has never ticked — `rig()` ticks once, which spends
    // the first measurement, and this test is about exactly that measurement.
    const { deps } = await rig();
    const bus = new Bus();
    const w = new FleetWatcher(deps, bus, 2000);
    const seen: unknown[][] = [];
    bus.on('automations', (rows) => seen.push(rows));

    w.emitAutomations();
    expect(seen.length, 'an empty first measurement did not emit — "none" is indistinguishable from "never measured"').toBe(1);
    expect(seen[0]).toEqual([]);

    // ...and does NOT emit again for an unchanged list.
    w.emitAutomations();
    expect(seen.length).toBe(1);
  });

  it('re-emits when the list changes', async () => {
    const { deps, coord } = await rig();
    const bus = new Bus();
    const w = new FleetWatcher(deps, bus, 2000);
    const seen: unknown[][] = [];
    bus.on('automations', (rows) => seen.push(rows));
    w.emitAutomations();
    makeArmed(coord, NOW, NOW);
    w.emitAutomations();
    expect(seen.length).toBe(2);
    expect((seen[1] as unknown[]).length).toBe(1);
  });

  it('a throwing store leaves the tick alive rather than killing the server', async () => {
    const { deps } = await rig();
    const w = new FleetWatcher(deps, new Bus(), 2000);
    const broken = { automations: () => { throw new Error('disk full'); } };
    (w as unknown as { deps: { coord: unknown } }).deps.coord = broken;
    expect(() => w.emitAutomations()).not.toThrow();
  });
});
