// Characterization (D-5864; ARCH-51 #786; spec K13's listing half): what a steady `FleetWatcher.tick` lists, and what
// each lane that takes its own listing today sees of a registry that changes BETWEEN two ticks. Green on the code
// before the tick's one `FleetReadModel`. The fake `FleetIO` and its rig are `fleetListingFixture.ts`. Fixture homes
// only; no ccd, tmux or box is reached.
import { afterEach, describe, it, expect, vi } from 'vitest';
import path from 'node:path';
import { localIO, type FleetIO } from '../src/io.js';
import { ASKS_DISABLED_MARKER, MAIL_DISABLED_MARKER } from '../../shared/switches.js';
import { questionsTestView } from '../src/coord/questions.js';
import { LATER, MONO0, MONO_LATER, NOW, callerOf, countBy, primed, rig, type Rig } from './fleetListingFixture.js';

afterEach(() => { vi.restoreAllMocks(); });

describe('a steady tick, every throttle elapsed: the registry listings by caller (the base table)', () => {
  it('the listings by caller: the tick, the limits read in its assembly, and the lanes that still list for themselves', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const by = countBy(r.listings);
    const n = (c: string): number => by[c] ?? 0;
    // The dialog detector and the hook-state lane take the tick's own `records` and `names`; they never list. `limits` is
    // `readLimits`' marker listing inside `assembleFleet` (the plan counted eight by static reading and missed it).
    expect({ tick: n('tick'), limits: n('readLimits'), tasks: n('tasksPass'), names: n('namesPass'), pr: n('prPass'),
      divergences: n('divergencesPass'), ask: n('askPass'), mail: n('mailPass') })
      .toEqual({ tick: 1, limits: 1, tasks: 0, names: 0, pr: 0, divergences: 1, ask: 0, mail: 1 });
    expect(r.listings.length, 'the steady tick lists four times in all').toBe(4);
  });
});

describe('a registry that changes between two ticks: each lane reads the newest listing', () => {
  it('the task lane sees a session that appeared between the ticks', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    r.row('demo-b', 'demo');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const taskDirs = r.reads.filter((p) => p.endsWith(path.join('tasks', 'u-demo-b')));
    expect(taskDirs.length, 'the new session\'s plan directory was never read').toBeGreaterThan(0);
  });

  it('the name lane sees a workspace session that appeared between the ticks', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    r.row('demo-w', 'demo', { workspace: 'slug', branch: 'ws/slug' });
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(r.stats.filter((p) => p.includes('u-demo-w')).length, 'the new session\'s transcript was never stat\'d').toBeGreaterThan(0);
  });

  it('the ask lane sees the hold switch raised between the ticks, and lowered again', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    // W3 Q3d (D-7028, named exception 1): the switch the ask pass read is the watcher's `Questions` instance's.
    const disabled = (): boolean => questionsTestView(r.w.questions).asksDisabled();
    expect(disabled()).toBe(false);
    r.marker(ASKS_DISABLED_MARKER);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(disabled(), 'a raised asks-disabled marker was not read').toBe(true);
    r.unmarker(ASKS_DISABLED_MARKER);
    r.at(LATER + 3_600_000, MONO_LATER + 3_600_000);
    await r.w.tick();
    await r.settle();
    expect(disabled(), 'a lowered asks-disabled marker was not read').toBe(false);
  });
});

/** Make one field of one session unreadable from now on: listed, its bytes never come back (a dropped round trip). */
function breakField(r: Rig, id: string, field: string): void {
  const deps = (r.w as unknown as { deps: { io: FleetIO } }).deps;
  const base = deps.io;
  deps.io = { ...base, readFileMeasured: async (p: string) => (p.endsWith(`${id}.${field}`) ? { ok: false, reason: 'unreadable' } : base.readFileMeasured(p)) };
}
/** Record every ccd argv the PR lane (or any lane) runs from now on, answering a plain failure. */
function recordCcd(r: Rig): string[][] {
  const calls: string[][] = [];
  (r.w as unknown as { deps: { runCcd: (a: string[]) => Promise<unknown> } }).deps.runCcd = async (a: string[]) => { calls.push(a); return { ok: false, code: 1, stdout: '', stderr: '' }; };
  return calls;
}
const prProjects = (calls: string[][]): string[] => calls.filter((a) => a.includes('pr-state')).map((a) => a[a.indexOf('--project') + 1] ?? '');
const REFUSED = '--actor';
/** The delivery row as the lane left it: the narrow `delivery()` read carries neither its gate nor its error. */
const deliveryOf = (r: Rig, id: number): { state: string; lastError: string | null; lastGate: string | null; attempts: number } | undefined =>
  (r.coord as unknown as { db: { prepare: (q: string) => { get: (n: number) => unknown } } }).db
    .prepare('SELECT state, lastError, lastGate, attempts FROM mail_deliveries WHERE id = ?').get(id) as never;
const queueMailTo = (r: Rig, toId: string): number => {
  // The delivery is queued at the primed clock, so it is due by the second tick (a real-clock row would be in its future).
  r.at(NOW, MONO0);
  const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId, runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
  r.coord.queueDelivery(m.id, toId, 'env');
  return m.id;
};

describe('a registry that changes between two ticks: the PR and mail lanes read the newest listing', () => {
  it('the PR lane checks the project of a workspace row that appeared between the ticks', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    r.row('late-w', 'lateproj', { workspace: 'late', branch: 'ws/late' });
    const calls = recordCcd(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(prProjects(calls), 'the new workspace row\'s project was never asked for its PR state').toContain('lateproj');
  });

  it('the mail lane attempts a queued delivery to a recipient that appeared between the ticks, and neither parks nor holds it', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const id = queueMailTo(r, 'demo-late');
    await primed(r);
    r.row('demo-late', 'demo');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const row = deliveryOf(r, id);
    expect(row?.lastGate, 'the recipient was read as absent').not.toBe('registry-absent');
    expect(row?.lastGate, 'the delivery was never attempted').toBeTruthy();
    expect(row?.state).toBe('queued');
  });

  it('a refused id planted between the ticks is left out by the task, name and PR lanes', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    r.row(REFUSED, 'refproj', { workspace: 'ref', branch: 'ws/ref' });
    const calls = recordCcd(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(prProjects(calls)).not.toContain('refproj');
    expect(r.reads.filter((p) => p.endsWith(path.join('tasks', `u-${REFUSED}`)))).toEqual([]);
    expect(r.stats.filter((p) => p.includes(`u-${REFUSED}`))).toEqual([]);
  });

  it('a refused recipient planted between the ticks is held registry-unmeasurable by the mail lane, never read as absent', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const id = queueMailTo(r, REFUSED);
    await primed(r);
    r.row(REFUSED, 'demo');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const row = deliveryOf(r, id);
    expect(row?.lastError).toBe('registry row listed but unreadable (registry-unmeasurable)');
    expect(row?.state).not.toBe('rejected');
  });

  it('a session whose uuid file became unreadable between the ticks has no plan directory or transcript read', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    r.row('demo-w', 'demo', { workspace: 'slug', branch: 'ws/slug' });
    await primed(r);
    breakField(r, 'demo-a', 'uuid');
    breakField(r, 'demo-w', 'uuid');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(r.reads.filter((p) => p.endsWith(path.join('tasks', 'u-demo-a'))), 'a row with no measured uuid had its plan directory read').toEqual([]);
    expect(r.stats.filter((p) => p.includes('u-demo-w')), 'a row with no measured uuid had its transcript stat\'d').toEqual([]);
  });

  it('a workspace row whose workspace file became unreadable between the ticks is not asked for its PR state', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    r.row('unr-w', 'unrproj', { workspace: 'unr', branch: 'ws/unr' });
    await primed(r);
    breakField(r, 'unr-w', 'workspace');
    const calls = recordCcd(r);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(prProjects(calls)).not.toContain('unrproj');
  });

  it('a recipient whose uuid file became unreadable between the ticks is held registry-unmeasurable by the mail lane', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const id = queueMailTo(r, 'demo-a');
    await primed(r);
    breakField(r, 'demo-a', 'uuid');
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    const row = deliveryOf(r, id);
    expect(row?.lastError).toBe('registry row listed but unreadable (registry-unmeasurable)');
    expect(row?.state).not.toBe('rejected');
  });
});

describe('a mail switch raised after the tick\'s listing holds the mail lane', () => {
  it('a mail-disabled marker raised between the ticks stops the lane before it reads its queue; lowered, the lane goes on', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    const m = r.coord.insertMail({ fromId: 'demo-b', fromUuid: 'u-b', toId: 'demo-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
    r.coord.queueDelivery(m.id, 'demo-a', 'env');
    await primed(r);
    const due = vi.spyOn(r.coord, 'dueDeliveries');
    r.marker(MAIL_DISABLED_MARKER);
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(due.mock.calls.length, 'a raised mail switch must stop the lane before it reads its queue').toBe(0);
    r.unmarker(MAIL_DISABLED_MARKER);
    r.at(LATER + 3_600_000, MONO_LATER + 3_600_000);
    await r.w.tick();
    await r.settle();
    expect(due.mock.calls.length, 'a lowered mail switch must let the lane read its queue').toBeGreaterThan(0);
  });
});

describe('an unlistable registry: the tick lists once and no lane lists at all', () => {
  it('a listing that fails ends the tick before any lane that lists runs', async () => {
    const r = rig();
    r.row('demo-a', 'demo');
    await primed(r);
    const failing: FleetIO = { ...localIO, readdir: async (p: string) => { if (p === r.cfg.registryDir) { r.listings.push(callerOf()); return null; } return localIO.readdir(p); } };
    (r.w as unknown as { deps: { io: FleetIO } }).deps.io = failing;
    r.at(LATER, MONO_LATER);
    await r.w.tick();
    await r.settle();
    expect(countBy(r.listings)).toEqual({ tick: 1 });
  });
});
