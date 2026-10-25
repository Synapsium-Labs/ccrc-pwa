// The drift reconciler's lane and its table (coordinator-durability tail spec §4.3 to §4.5; D-5922; #760): a real
// store, a fake claimant reading and a recording notice sink. The lane records and tells; it never acts.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { runDriftPass, type DriftLaneDeps } from '../src/coord/driftLane.js';
import { stallDetail } from '../src/coord/stall.js';
import type { ClaimantReading } from '../src/deadCoordinator.js';
import type { NoticeMode, NoticeOpts, NoticeRecord } from '../src/notice.js';
import { DEAD_COORDINATOR_LANE_LIVE_MARKER, DRIFT_PUSH_LIVE_MARKER } from '../../shared/switches.js';
import type { DriftFinding } from '../../shared/api.js';
import { mkTmp } from './tmpHelpers.js';

const H = 3_600_000;
const DAY = 24 * H;
const alive: ClaimantReading = { state: 'alive', why: 'pane live' };
const dead: ClaimantReading = { state: 'dead', cause: 'absent' };

interface Sent { event: NoticeRecord; mode: NoticeMode; opts: NoticeOpts | undefined }

function rig() {
  const db = openCoordDb(path.join(mkTmp('ccrc-drift-lane-'), '.ccrc', 'coord.db'));
  const coord = new CoordStore(db);
  const sent: Sent[] = [];
  const warns: string[] = [];
  const calls: string[] = [];
  let reading: ClaimantReading = alive;
  const guarded = new Proxy(coord, {
    get(t, p, r) { const v = Reflect.get(t, p, r) as unknown; if (typeof p === 'string') calls.push(p); return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v; },
  });
  const deps = (names: readonly string[] | null, o: Partial<DriftLaneDeps> = {}): DriftLaneDeps => ({
    coord: guarded, names, childMarks: null, measure: () => Promise.resolve(reading),
    notice: (event, mode, opts) => { sent.push({ event, mode, opts }); return { recorded: true, archived: 'none' }; },
    warn: (l) => { warns.push(l); }, ...o,
  });
  let n = 0;
  /** A working run whose last act is `agoMs` before `now`. */
  const quietRun = (now: number, agoMs: number): number => {
    n += 1;
    const r = coord.openRun({ program: `program-${n}`, title: 'T', project: 'project-a', wave: 1, waveOf: 1, claimedBy: 'coord-a' });
    if (!('id' in r)) throw new Error('fixture openRun refused');
    db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(r.id);
    db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.id, now - agoMs, 'dispatched', 'working', 'coordinator', null);
    return r.id;
  };
  return { db, coord, sent, warns, calls, deps, quietRun, setReading: (x: ClaimantReading) => { reading = x; } };
}
const LIVE = [DRIFT_PUSH_LIVE_MARKER];
const T0 = Date.now() + 200 * DAY;
const rows = (c: CoordStore) => { const r = c.driftFindingRows(); if (!r.ok) throw new Error(r.detail); return r.rows; };

describe('the table', () => {
  it('a pass records the keys found and clears the rest', async () => {
    const { coord, deps, quietRun, db } = rig();
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    expect(rows(coord).map((r) => [r.key, r.clearedAt])).toEqual([[`run-quiet:${id}`, null]]);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    await runDriftPass(deps([]), T0 + H);
    expect(rows(coord).map((r) => r.clearedAt)).toEqual([T0 + H]);
  });
  it('a key cleared and found again keeps its pushedAt', async () => {
    const { coord, deps, quietRun, db } = rig();
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H); // armed, table not empty: pushes as an item
    expect(rows(coord)[0]!.pushedAt).toBe(T0 + H);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    await runDriftPass(deps(LIVE), T0 + 2 * H);
    db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    await runDriftPass(deps(LIVE), T0 + 3 * H);
    expect(rows(coord)[0]).toMatchObject({ clearedAt: null, pushedAt: T0 + H });
  });
  it('a row cleared more than 30 days ago is pruned', async () => {
    const { coord, deps, quietRun, db } = rig();
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    await runDriftPass(deps([]), T0 + H);
    await runDriftPass(deps([]), T0 + H + 30 * DAY + 1);
    expect(rows(coord)).toEqual([]);
  });
  it('an unreadable registry listing records nothing and clears nothing', async () => {
    const { coord, deps, quietRun } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(null, { measure: () => Promise.reject(new Error('x')) }), T0 + H);
    expect(rows(coord).map((r) => r.clearedAt)).toEqual([null]);
    expect(rows(coord)[0]!.lastSeenAt).toBe(T0);
  });
  it('a store read that fails records nothing and warns', async () => {
    const { coord, deps, quietRun, warns } = rig();
    quietRun(T0, 5 * DAY);
    const broken = { ...deps([]), coord: Object.assign(Object.create(coord) as CoordStore, { driftOpenRuns: () => ({ ok: false, detail: 'boom' }) }) };
    await runDriftPass(broken, T0);
    expect(rows(coord)).toEqual([]);
    expect(warns.join(' ')).toContain('boom');
  });
});

describe('the pushes', () => {
  it('the first armed pass sends one summary push, no per-item push, and spends no daily budget', async () => {
    const { coord, deps, quietRun, sent } = rig();
    for (let i = 0; i < 30; i += 1) quietRun(T0, 5 * DAY);
    await runDriftPass(deps(LIVE), T0);
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(1);
    expect(sent[0]!.event.body).toBe("30 items are out of step; see today's digest");
    expect(sent[0]!.opts?.url).toMatch(/^\/digest\?day=\d{4}-\d{2}-\d{2}$/);
    expect(rows(coord).every((r) => r.pushedVia === 'summary')).toBe(true);
    expect(coord.driftPushesSince(0)).toBe(0);
    quietRun(T0 + H, 5 * DAY);
    await runDriftPass(deps(LIVE), T0 + H);
    expect(coord.driftPushesSince(0)).toBe(1);
  });
  it('four crossings in one pass push 3, the 4th next pass', async () => {
    const { deps, quietRun, sent } = rig();
    await runDriftPass(deps(LIVE), T0 - H); // a row exists after this only if something is found
    for (let i = 0; i < 4; i += 1) quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0 - H / 2); // unarmed: the table is no longer empty
    await runDriftPass(deps(LIVE), T0);
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(3);
    await runDriftPass(deps(LIVE), T0 + H);
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(4);
  });
  it('thirteen crossings in a day push 12, and a restart mid-day does not reset the count', async () => {
    const { coord, deps, quietRun, sent } = rig();
    const day = T0 - (T0 % DAY);
    for (let i = 0; i < 13; i += 1) quietRun(day, 5 * DAY);
    await runDriftPass(deps([]), day + H);
    for (let p = 0; p < 6; p += 1) await runDriftPass(deps(LIVE), day + 2 * H + p * 1000); // each call is a fresh lane: no memory
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(12);
    expect(coord.driftPushesSince(day)).toBe(12);
  });
  it('a restart re-finds a key and does not push it again', async () => {
    const { deps, quietRun, sent } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    await runDriftPass(deps(LIVE), T0 + 2 * H);
    await runDriftPass(deps(LIVE), T0 + 3 * H);
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(1);
  });
  it('every push carries a url, and a run kind carries its runId', async () => {
    const { deps, quietRun, sent } = rig();
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    const pushes = sent.filter((s) => s.mode === 'push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.event.runId).toBe(id);
    expect(pushes[0]!.opts?.url).toBe('/runs');
  });
  it('a live stall rung 3 on the run suppresses the push; a shadow one does not', async () => {
    const live = rig();
    const a = live.quietRun(T0, 5 * DAY);
    live.db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(a, T0 - H, 'working', 'working', 'coordinator', stallDetail('live', 'quiet', 3, 1));
    await runDriftPass(live.deps([]), T0);
    await runDriftPass(live.deps(LIVE), T0 + H);
    expect(live.sent).toEqual([]);
    const shadow = rig();
    const b = shadow.quietRun(T0, 5 * DAY);
    shadow.db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(b, T0 - H, 'working', 'working', 'coordinator', stallDetail('shadow', 'quiet', 3, 1));
    await runDriftPass(shadow.deps([]), T0);
    await runDriftPass(shadow.deps(LIVE), T0 + H);
    expect(shadow.sent.filter((s) => s.mode === 'push')).toHaveLength(1);
  });
  it('claimant-gone pushes while the dead-coordinator lane is unarmed and not once it is armed', async () => {
    const un = rig();
    un.setReading(dead);
    un.quietRun(T0, H);
    await runDriftPass(un.deps([]), T0);
    await runDriftPass(un.deps(LIVE), T0 + 25 * H);
    expect(un.sent.map((s) => s.event.title)).toContain('Out of step');
    expect(un.coord.driftFindingRows()).toMatchObject({ ok: true });
    const armed = rig();
    armed.setReading(dead);
    armed.quietRun(T0, H);
    const names = [DRIFT_PUSH_LIVE_MARKER, DEAD_COORDINATOR_LANE_LIVE_MARKER];
    await runDriftPass(armed.deps(names), T0);
    await runDriftPass(armed.deps(names), T0 + 25 * H);
    expect(armed.sent.filter((s) => s.event.body.includes('claimant'))).toHaveLength(0);
    expect(rows(armed.coord).some((r) => r.kind === 'claimant-gone')).toBe(true);
  });
});

describe('the once-only stamps', () => {
  const found = (): DriftFinding => ({ key: 'run-quiet:1', kind: 'run-quiet', subject: '{}', detail: 'd', factAt: null, runId: 1, sessionId: null });
  it('markDriftPushed and markDriftShadowed are compare-and-set: the second caller changes nothing', () => {
    const { coord } = rig();
    coord.recordDriftPass([found()], T0);
    expect(coord.markDriftPushed(['run-quiet:1'], T0 + 1, 'item')).toEqual(['run-quiet:1']);
    expect(coord.markDriftPushed(['run-quiet:1'], T0 + 2, 'summary')).toEqual([]);
    expect(rows(coord)[0]).toMatchObject({ pushedAt: T0 + 1, pushedVia: 'item' });
    expect(coord.markDriftShadowed(['run-quiet:1'], T0 + 3)).toEqual(['run-quiet:1']);
    expect(coord.markDriftShadowed(['run-quiet:1'], T0 + 4)).toEqual([]);
    expect(rows(coord)[0]!.shadowAt).toBe(T0 + 3);
  });
  it('a push whose stamp another pass won is not sent', async () => {
    const { coord, deps, quietRun, sent } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    const lost = Object.assign(Object.create(coord) as CoordStore, { markDriftPushed: () => [] as string[] });
    await runDriftPass(deps(LIVE, { coord: lost }), T0 + H);
    expect(sent.filter((s) => s.mode === 'push')).toEqual([]);
  });
});

describe('the shadow', () => {
  it('unarmed, nothing is pushed and one record-only notice names what it would have pushed, once per key', async () => {
    const { coord, deps, quietRun, sent } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps([]), T0 + H);
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mode: 'record-only' });
    expect(sent[0]!.event.body).toContain('would have pushed 1 item');
    expect(rows(coord)[0]!.shadowAt).not.toBeNull();
    expect(rows(coord)[0]!.pushedAt).toBeNull();
  });
  it('arming later still pushes a finding the shadow recorded', async () => {
    const { deps, quietRun, sent } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    expect(sent.filter((s) => s.mode === 'push')).toHaveLength(1);
  });
});

describe('the reconciler never acts', () => {
  it('calls no store writer but recordDriftPass, markDriftPushed and markDriftShadowed, and mails nothing', async () => {
    const { deps, quietRun, calls, db } = rig();
    quietRun(T0, 5 * DAY);
    const mailBefore = (db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n;
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    const writers = calls.filter((c) => /^(record|mark|insert|set|advance|close|abandon|reclaim|queue|send|open|write|update|delete|end)/i.test(c));
    expect([...new Set(writers)].sort()).toEqual(['markDriftPushed', 'markDriftShadowed', 'recordDriftPass']);
    expect((db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(mailBefore);
  });
});
