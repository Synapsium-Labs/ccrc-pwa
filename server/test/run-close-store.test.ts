// D-8077 (the ruled plan's W1; spec 2026-11-04 §12): the run-close lane's durable facts. `runs.lastDispatchAttemptAt` is
// stamped by EVERY answer `dispatchRun` gives, refusals included, by one store method; `run_close_anchors` and
// `run_close_warnings` hold the lane's two clocks; the store reads give R4's activity without hydrating a run.
import { describe, it, expect, afterEach } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import { dispatchRun as dispatchBare, stampDispatchAttempt, type DispatchRunDeps } from '../src/coord/dispatch.js';
import { clearSender } from '../src/inject/send.js';
import { configDirFor } from '../src/config.js';
import type { Runner } from '../src/exec.js';
import { testDeps } from './helpers.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

// The route's pairing (routes.ts): the stamp around the bare dispatch.
const dispatchRun = (deps: DispatchRunDeps, id: number, brief: unknown, items: unknown) =>
  stampDispatchAttempt(deps.coord, id, () => dispatchBare(deps, id, brief, items));

afterEach(removeTmpFixtures);

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-closestore-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, wave: number, over: { program?: string; claimedBy?: string } = {}): number => {
  const r = s.openRun({ program: over.program ?? 'programme-a', title: 'T', project: 'demo', wave, waveOf: null, claimedBy: over.claimedBy ?? 'coord-a' });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const stamp = (s: CoordStore, id: number): number | null =>
  (s.db.prepare('SELECT lastDispatchAttemptAt AS at FROM runs WHERE id = ?').get(id) as { at: number | null }).at;

const dispatchRig = (marker?: string) => {
  const home = mkTmp('ccrc-closestore-d-');
  mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  if (marker !== undefined) writeFileSync(path.join(home, '.cc-sessions', marker), '');
  const run: Runner = async (_cmd, args) => {
    if (args[0] === 'ws-add') {
      for (const [k, v] of Object.entries({ wrapper: 'claude', project: 'demo', workdir: '/w/demo-fresh', uuid: 'u-fresh', started: '1',
        workspace: 'demo-fresh', branch: 'ws/demo-fresh', base: 'origin/main' })) writeFileSync(path.join(home, '.cc-sessions', `demo-fresh.${k}`), v);
    }
    return { ran: true, code: 0, stdout: '', stderr: '' };
  };
  const base = testDeps(home, run);
  const coord = new CoordStore(openCoordDb(path.join(home, '.ccrc', 'coord.db')));
  const deps: DispatchRunDeps = { coord, io: base.io, cfg: base.cfg, runCcd: base.runCcd, fleetState: undefined,
    sendClear: clearSender(base), configDir: (w: string) => configDirFor(base.cfg, w), turnVerdict: async () => 'idle' as const };
  return { coord, deps };
};

describe('migration 50', () => {
  it('adds the column and the two tables, and nothing on an existing table that an older build would trip on', () => {
    const slot = MIGRATIONS.findIndex((m) => m.includes('run_close_anchors')) + 1;
    expect(slot).toBe(50);
    const s = store();
    expect(() => s.db.prepare('SELECT lastDispatchAttemptAt FROM runs').all()).not.toThrow();
    expect(() => s.db.prepare('SELECT laneRow, key, firstAt, lastAt FROM run_close_anchors').all()).not.toThrow();
    expect(() => s.db.prepare('SELECT programme, claimant, warnedAt, deliveryId FROM run_close_warnings').all()).not.toThrow();
    expect(MIGRATIONS[49]).not.toMatch(/NOT NULL DEFAULT|CHECK \(/);
  });
});

describe('every dispatch answer stamps lastDispatchAttemptAt, refusals included', () => {
  it('a proceed stamps it', async () => {
    const { coord, deps } = dispatchRig();
    const id = open(coord, 1);
    expect(stamp(coord, id)).toBeNull();
    const before = Date.now();
    expect((await dispatchRun(deps, id, 'do the thing', undefined)).ok).toBe(true);
    expect(stamp(coord, id)).toBeGreaterThanOrEqual(before);
  });

  it('a refused dispatch (a bad transition, a pause) stamps it and keeps its answer', async () => {
    const { coord, deps } = dispatchRig();
    const id = open(coord, 1);
    await dispatchRun(deps, id, 'do the thing', undefined);
    coord.db.prepare('UPDATE runs SET lastDispatchAttemptAt = NULL WHERE id = ?').run(id);
    const again = await dispatchRun(deps, id, 'do the thing', undefined);
    expect(again).toMatchObject({ ok: false, kind: 'bad-transition' });
    expect(stamp(coord, id)).not.toBeNull();

    const paused = dispatchRig('coordinator-paused');
    const pid = open(paused.coord, 1);
    const out = await dispatchRun(paused.deps, pid, 'do the thing', undefined);
    expect(out.ok).toBe(false);
    expect(stamp(paused.coord, pid)).not.toBeNull();
  });

  it('an unknown run id is stamped nowhere and throws nothing', async () => {
    const { coord, deps } = dispatchRig();
    expect(await dispatchRun(deps, 424242, 'do the thing', undefined)).toMatchObject({ ok: false });
    expect(coord.db.prepare('SELECT COUNT(*) AS n FROM runs').get()).toEqual({ n: 0 });
  });
});

describe('the lane\'s tables', () => {
  it('anchors round-trip per row and key', () => {
    const s = store();
    s.setRunCloseAnchor('never-started', 'programme-a', { firstAt: 10, lastAt: 20 });
    s.setRunCloseAnchor('never-started', 'programme-a', { firstAt: 10, lastAt: 30 });
    s.setRunCloseAnchor('review-orphaned', '7', { firstAt: 5, lastAt: 5 });
    expect(s.runCloseAnchors('never-started')).toEqual(new Map([['programme-a', { firstAt: 10, lastAt: 30 }]]));
    s.deleteRunCloseAnchor('never-started', 'programme-a');
    expect(s.runCloseAnchors('never-started').size).toBe(0);
    expect(s.runCloseAnchors('review-orphaned').size).toBe(1);
  });

  it('a warning reads delivered only once its delivery was', () => {
    const s = store();
    let id = 0;
    s.queueRunCloseWarning('programme-a', 'coord-a', 100, () => {
      const m = s.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: 'coord-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
      id = s.queueDelivery(m.id, 'coord-a', 'env', null, null).id;
      return id;
    });
    expect(s.runCloseWarning('programme-a')).toMatchObject({ warnedAt: 100, deliveredAt: null, deliveryId: id });
    s.markDelivered(id, 500);
    expect(s.runCloseWarning('programme-a')).toMatchObject({ deliveredAt: 500 });
    expect(s.runCloseWarningProgrammes()).toEqual(['programme-a']);
    s.deleteRunCloseWarning('programme-a');
    expect(s.runCloseWarning('programme-a')).toBeNull();
  });

  it('a warning whose send throws leaves no row and no mail (one transaction)', () => {
    const s = store();
    expect(() => s.queueRunCloseWarning('programme-a', 'coord-a', 100, () => {
      s.insertMail({ fromId: 'operator', fromUuid: 'operator', toId: 'coord-a', runId: null, kind: 'status', subject: 's', body: 'b', artifacts: [] });
      throw new Error('boom');
    })).toThrow('boom');
    expect(s.runCloseWarning('programme-a')).toBeNull();
    expect((s.db.prepare('SELECT COUNT(*) AS n FROM mail').get() as { n: number }).n).toBe(0);
  });
});

describe('R4\'s store half', () => {
  it('the lane\'s own sweep rows never reset the clock', () => {
    const s = store();
    const a = open(s, 1);
    const b = open(s, 2);
    s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, 1000, 'planned', 'planned', 'coordinator', NULL)").run(a);
    s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, 9000, 'planned', 'failed', 'sweep', 'expired:x')").run(b);
    s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, 8000, 'planned', 'planned', 'operator', NULL)").run(a);
    expect(s.programmeActivity('programme-a').lastActAt).toBe(1000);
  });

  it('a refused dispatch, an openedAt and a claimant mail each count', () => {
    const s = store();
    const a = open(s, 1);
    s.db.prepare('UPDATE runs SET openedAt = 50, lastDispatchAttemptAt = 70 WHERE id = ?').run(a);
    s.db.prepare("INSERT INTO mail (fromId, fromUuid, toId, runId, kind, subject, body, at, artifacts) VALUES ('coord-a', 'u', 'worker', ?, 'status', 's', 'b', 90, '[]')").run(a);
    s.db.prepare("INSERT INTO mail (fromId, fromUuid, toId, runId, kind, subject, body, at, artifacts) VALUES ('someone-else', 'u', 'worker', ?, 'status', 's', 'b', 99, '[]')").run(a);
    expect(s.programmeActivity('programme-a')).toMatchObject({ lastOpenedAt: 50, lastDispatchAttemptAt: 70, lastClaimantMailAt: 90 });
  });

  it('laneOpenRuns lists open runs only, and a later review that moved is found by its first move', () => {
    const s = store();
    const w = open(s, 1);
    const open2 = open(s, 2);
    s.db.prepare("UPDATE runs SET state = 'done', closedAt = 5 WHERE id = ?").run(w);
    expect(s.runCloseRuns().map((r) => r.id)).toEqual([open2]);
    const r1 = s.openRun({ program: 'programme-a', title: 'R', project: 'demo', wave: 1, waveOf: null, claimedBy: 'coord-a', kind: 'review', reviews: w });
    if (!('id' in r1)) throw new Error(`fixture review refused: ${JSON.stringify(r1)}`);
    s.db.prepare("UPDATE runs SET state = 'failed', closedAt = 6 WHERE id = ?").run(r1.id);
    const r2 = s.openRun({ program: 'programme-a', title: 'R', project: 'demo', wave: 1, waveOf: null, claimedBy: 'coord-a', kind: 'review', reviews: w });
    if (!('id' in r2)) throw new Error(`fixture review refused: ${JSON.stringify(r2)}`);
    s.db.prepare("INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, 777, 'planned', 'working', 'coordinator', NULL)").run(r2.id);
    expect(s.laterReviewMovedAt(w, r1.id)).toBe(777);
    expect(s.laterReviewMovedAt(w, r2.id)).toBeNull();
  });
});
