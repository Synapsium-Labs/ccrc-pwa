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
    // Absent for a second pass, so the prune runs over the cleared row before it returns (pins the 30-day window).
    await runDriftPass(deps(LIVE), T0 + 3 * H);
    expect(rows(coord)[0]).toMatchObject({ clearedAt: T0 + 2 * H, pushedAt: T0 + H });
    db.prepare("UPDATE runs SET state = 'working' WHERE id = ?").run(id);
    await runDriftPass(deps(LIVE), T0 + 4 * H);
    expect(rows(coord)[0]).toMatchObject({ clearedAt: null, pushedAt: T0 + H });
  });
  it('a row cleared more than 30 days ago is pruned', async () => {
    const { coord, deps, quietRun, db } = rig();
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(id);
    await runDriftPass(deps([]), T0 + H);
    await runDriftPass(deps([]), T0 + H + 30 * DAY);
    expect(rows(coord).map((r) => r.clearedAt), 'cleared exactly 30 days ago: kept').toEqual([T0 + H]);
    await runDriftPass(deps([]), T0 + H + 30 * DAY + 1);
    expect(rows(coord)).toEqual([]);
  });
  it('a stored kind this build does not know is skipped and warned once; the pass still records, clears and pushes', async () => {
    const { coord, deps, quietRun, db, warns, sent } = rig();
    db.prepare('INSERT INTO drift_findings (key, kind, subject, detail, factAt, runId, sessionId, firstSeenAt, lastSeenAt) ' +
      "VALUES ('future:1', 'kind-from-a-later-build', 'session', 'd', NULL, NULL, NULL, ?, ?)").run(T0 - H, T0 - H);
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps(LIVE), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    expect(rows(coord).map((r) => r.key)).toEqual([`run-quiet:${id}`]);
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1);
    expect(warns.filter((w) => w.includes('kind-from-a-later-build'))).toHaveLength(1);
    expect(warns.filter((w) => w.includes('nothing recorded') || w.includes('no push'))).toEqual([]);
    const raw = () => db.prepare("SELECT clearedAt FROM drift_findings WHERE key = 'future:1'").all() as { clearedAt: unknown }[];
    expect(raw().map((r) => Number(r.clearedAt)), 'the unknown row clears like any key the pass did not find').toEqual([T0]);
    await runDriftPass(deps(LIVE), T0 + 30 * DAY + 1);
    expect(raw(), 'and is pruned 30 days on').toEqual([]);
  });
  it("a finding's detail is stored through redactCommand", () => {
    const { coord } = rig();
    const f: DriftFinding = { key: 'run-quiet:1', kind: 'run-quiet', subject: 'run', detail: 'GH_TOKEN=ghx_neutral ls',
      factAt: null, runId: 1, sessionId: null };
    coord.recordDriftPass([f], T0);
    expect(rows(coord)[0]!.detail).toBe('GH_TOKEN=[REDACTED] ls');
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
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1);
    expect(sent[0]!.event.body).toBe("30 items are out of step; see today's digest");
    expect(sent[0]!.opts?.url).toMatch(/^\/digest\?day=\d{4}-\d{2}-\d{2}$/);
    expect(rows(coord).every((r) => r.pushedVia === 'summary')).toBe(true);
    expect(coord.driftPushesOnDay(0)).toBe(0);
    quietRun(T0 + H, 5 * DAY);
    await runDriftPass(deps(LIVE), T0 + H);
    expect(coord.driftPushesOnDay(0)).toBe(1);
  });
  it('four crossings in one pass push 3, the 4th next pass', async () => {
    const { deps, quietRun, sent } = rig();
    quietRun(T0 - H, 5 * DAY);
    await runDriftPass(deps(LIVE), T0 - H); // the first armed pass: its one finding goes out as the summary
    for (let i = 0; i < 4; i += 1) quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0 - H / 2); // unarmed: the table is no longer empty
    await runDriftPass(deps(LIVE), T0);
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1 + 3); // the summary, then 3 items
    await runDriftPass(deps(LIVE), T0 + H);
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1 + 4);
  });
  it('thirteen crossings in a day push 12, and a restart mid-day does not reset the count', async () => {
    const { coord, deps, quietRun, sent } = rig();
    const day = T0 - (T0 % DAY);
    quietRun(day, 5 * DAY);
    await runDriftPass(deps(LIVE), day + H / 2); // the first armed pass: a summary, spending no per-item budget
    for (let i = 0; i < 13; i += 1) quietRun(day, 5 * DAY);
    await runDriftPass(deps([]), day + H);
    for (let p = 0; p < 6; p += 1) await runDriftPass(deps(LIVE), day + 2 * H + p * 1000); // each call is a fresh lane: no memory
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1 + 12); // the summary, then 12 items
    expect(coord.driftPushesOnDay(day)).toBe(12);
  });
  it('a restart re-finds a key and does not push it again', async () => {
    const { deps, quietRun, sent } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    await runDriftPass(deps(LIVE), T0 + 2 * H);
    await runDriftPass(deps(LIVE), T0 + 3 * H);
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1);
  });
  it('every push carries a url, and a run kind carries its runId', async () => {
    const { deps, quietRun, sent } = rig();
    quietRun(T0 - H, 5 * DAY);
    await runDriftPass(deps(LIVE), T0 - H); // the first armed pass: a summary
    const id = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + H);
    const pushes = sent.filter((s) => s.mode !== 'record-only').slice(1);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.event.runId).toBe(id);
    expect(pushes[0]!.opts?.url).toBe('/runs');
    expect(sent[0]!.mode, 'the summary').toBe('push');
    expect(pushes[0]!.mode, 'an item records whatever the presence: its pushedAt is already stamped').toBe('record-always');
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
    expect(shadow.sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1);
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

describe('the lane wires its inputs into the push budget', () => {
  /** A rig past its first armed pass (the summary), so later findings go out as items. */
  async function seeded() {
    const r = rig();
    const seed = r.quietRun(T0 - 2 * H, 5 * DAY);
    await runDriftPass(r.deps(LIVE), T0 - 2 * H);
    r.sent.length = 0;
    return { ...r, seed };
  }
  /** A queued delivery; `o` sets its park and gate columns. Returns its id. */
  const delivery = (db: ReturnType<typeof rig>['db'], o: { parkedAt?: number; parkEscalatedAt?: number; lastGate?: string; gateSince?: number }): number => {
    const m = db.prepare("INSERT INTO mail (at, fromId, fromUuid, toId, runId, kind, subject, body) VALUES (1, 'coord-a', 'u', 'worker-1', NULL, 'status', 's', 'b')").run();
    const d = db.prepare("INSERT INTO mail_deliveries (mailId, toId, state, envelope, parkedAt, parkEscalatedAt, lastGate, gateSince) VALUES (?, 'worker-1', 'queued', 'e', ?, ?, ?, ?)")
      .run(m.lastInsertRowid, o.parkedAt ?? null, o.parkEscalatedAt ?? null, o.lastGate ?? null, o.gateSince ?? null);
    return Number(d.lastInsertRowid);
  };
  const stallRow = (r: { db: ReturnType<typeof rig>['db'] }, runId: number, mode: 'live' | 'shadow', key: number): void => {
    r.db.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(runId, T0 - H, 'working', 'working', 'coordinator', stallDetail(mode, 'mail-stuck', 1, key));
  };
  const itemPushes = (sent: Sent[]) => sent.filter((s) => s.mode !== 'record-only');

  it('a parked delivery with parkEscalatedAt set is not pushed; without it, one push to the session', async () => {
    const esc = await seeded();
    delivery(esc.db, { parkedAt: T0 - 25 * H, parkEscalatedAt: T0 - 20 * H });
    await runDriftPass(esc.deps([]), T0 - H);
    await runDriftPass(esc.deps(LIVE), T0);
    expect(itemPushes(esc.sent)).toEqual([]);
    expect(rows(esc.coord).some((r) => r.kind === 'mail-parked')).toBe(true);

    const plain = await seeded();
    delivery(plain.db, { parkedAt: T0 - 25 * H });
    await runDriftPass(plain.deps([]), T0 - H);
    await runDriftPass(plain.deps(LIVE), T0);
    const pushes = itemPushes(plain.sent);
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.event.sessionId).toBe('worker-1');
    expect(pushes[0]!.opts?.url).toBe('/s/worker-1');
  });
  it('a held delivery with a live mail-stuck row is not pushed; with a shadow one, it is', async () => {
    const live = await seeded();
    const a = delivery(live.db, { lastGate: 'busy', gateSince: T0 - 25 * H });
    stallRow(live, live.seed, 'live', a);
    await runDriftPass(live.deps([]), T0 - H);
    await runDriftPass(live.deps(LIVE), T0);
    expect(itemPushes(live.sent)).toEqual([]);
    expect(rows(live.coord).some((r) => r.kind === 'mail-held')).toBe(true);

    const shadow = await seeded();
    const b = delivery(shadow.db, { lastGate: 'busy', gateSince: T0 - 25 * H });
    stallRow(shadow, shadow.seed, 'shadow', b);
    await runDriftPass(shadow.deps([]), T0 - H);
    await runDriftPass(shadow.deps(LIVE), T0);
    expect(itemPushes(shadow.sent)).toHaveLength(1);
    expect(itemPushes(shadow.sent)[0]!.opts?.url).toBe('/s/worker-1');
  });
  it('a held ask past its margin is recorded and never pushed', async () => {
    const r = await seeded();
    r.db.prepare("INSERT INTO asks (at, childId, parentId, askKey, askAt, dialogId, question, options, state) VALUES (?, 'worker-1', 'coord-a', 'k', 1, 'd', 'q', '[]', 'held')")
      .run(T0 - 3 * DAY);
    await runDriftPass(r.deps([]), T0 - H);
    await runDriftPass(r.deps(LIVE), T0);
    expect(rows(r.coord).some((x) => x.kind === 'question-orphaned')).toBe(true);
    expect(itemPushes(r.sent)).toEqual([]);
  });
  it('a run-kind push names the run and no session, the shape the Inbox resolves to the run board', async () => {
    const r = await seeded();
    const id = r.quietRun(T0, 5 * DAY);
    await runDriftPass(r.deps([]), T0 - H / 2);
    await runDriftPass(r.deps(LIVE), T0);
    const p = itemPushes(r.sent);
    expect(p).toHaveLength(1);
    expect(p[0]!.event).toMatchObject({ kind: 'coord', sessionId: '', runId: id });
    expect(p[0]!.opts?.url).toBe('/runs');
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
    expect(sent.filter((s) => s.mode !== 'record-only')).toEqual([]);
  });
});

describe('the shadow', () => {
  it('unarmed, nothing is pushed and one record-only notice names what it would have pushed, once per key', async () => {
    const { coord, deps, quietRun, sent } = rig();
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps([]), T0 + H);
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(0);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ mode: 'record-only' });
    expect(sent[0]!.event.body).toContain('would have pushed 1 item');
    expect(rows(coord)[0]!.shadowAt).not.toBeNull();
    expect(rows(coord)[0]!.pushedAt).toBeNull();
  });
  it('N findings shadowed, then armed: one summary push, no item push, today\'s budget still 12', async () => {
    const { coord, deps, quietRun, sent } = rig();
    for (let i = 0; i < 30; i += 1) quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    await runDriftPass(deps(LIVE), T0 + 7 * DAY);
    const pushes = sent.filter((s) => s.mode !== 'record-only');
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.event.body).toBe("30 items are out of step; see today's digest");
    expect(rows(coord).every((r) => r.pushedVia === 'summary')).toBe(true);
    expect(coord.driftPushesOnDay(0)).toBe(0);
    await runDriftPass(deps(LIVE), T0 + 7 * DAY + H);
    expect(sent.filter((s) => s.mode !== 'record-only')).toHaveLength(1);
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

describe('the drift reads', () => {
  it('openDriftFindings answers the uncleared rows only', async () => {
    const { coord, deps, quietRun, db } = rig();
    const a = quietRun(T0, 5 * DAY);
    quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(a);
    await runDriftPass(deps([]), T0 + H);
    const r = coord.openDriftFindings();
    expect(r.ok && r.rows.map((x) => x.clearedAt)).toEqual([null]);
    expect(r.ok && r.rows[0]!.kind).toBe('run-quiet');
  });
  it('driftFindingsOpenAt answers the rows open at that instant, first seen before it and not cleared until it', async () => {
    const { coord, deps, quietRun, db } = rig();
    const a = quietRun(T0, 5 * DAY);
    await runDriftPass(deps([]), T0);
    quietRun(T0 + 2 * H, 5 * DAY);
    db.prepare("UPDATE runs SET state = 'done' WHERE id = ?").run(a);
    await runDriftPass(deps([]), T0 + 2 * H); // a cleared, b first seen
    const at = (ms: number): string[] => { const r = coord.driftFindingsOpenAt(ms); if (!r.ok) throw new Error(r.detail); return r.rows.map((x) => x.key); };
    expect(at(T0)).toEqual([]); // first seen AT T0 is not yet open before it
    expect(at(T0 + H)).toEqual([`run-quiet:${a}`]);
    expect(at(T0 + 2 * H)).toHaveLength(1); // a cleared exactly then still counts; b first seen then does not
    expect(at(T0 + 3 * H)).toHaveLength(1);
  });
});
