// D-8071 (spec §9.3, §11.2, A17, A30): who closed a run and why are stored beside closedAt, written by the one statement
// that writes closedAt, and filled for history from the terminal run_events row.
import { describe, it, expect, afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore, toRunSummary } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const ADD = /ALTER TABLE runs ADD COLUMN closedBy\b/;
const SLOT = MIGRATIONS.findIndex((m) => ADD.test(m)) + 1;

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-closecols-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, wave: number): number => {
  const r = s.openRun({ program: 'programme-a', title: 'T', project: 'demo', wave, waveOf: null, claimedBy: 'coord-a' });
  if (!('id' in r)) throw new Error(`fixture openRun refused: ${JSON.stringify(r)}`);
  return r.id;
};
const cols = (s: CoordStore, id: number): { closedBy: string | null; closeDetail: string | null; closedAt: number | null } =>
  s.db.prepare('SELECT closedBy, closeDetail, closedAt FROM runs WHERE id = ?').get(id) as never;
const terminalEvent = (s: CoordStore, id: number): { at: number; causedBy: string; detail: string | null } =>
  s.db.prepare(
    "SELECT at, causedBy, detail FROM run_events WHERE runId = ? AND toState IN ('done','failed') ORDER BY id DESC LIMIT 1",
  ).get(id) as never;
const wire = (s: CoordStore, id: number) => {
  const r = s.run(id);
  if (!r.ok || r.run === null) throw new Error('fixture run unreadable');
  return toRunSummary(r.run);
};

describe('advanceInner writes the close columns', () => {
  it('advanceInner writes the close columns in the statement that writes closedAt', () => {
    const s = store();
    const id = open(s, 1);
    expect(cols(s, id)).toEqual({ closedBy: null, closeDetail: null, closedAt: null });
    expect(s.advance(id, 'failed', 'operator', 'abandon:overtaken').ok).toBe(true);
    const c = cols(s, id);
    expect(c.closedBy).toBe('operator');
    expect(c.closeDetail).toBe('abandon:overtaken');
    expect(c.closedAt).not.toBeNull();
  });

  it('the stored columns equal the terminal run_events row', () => {
    const s = store();
    const id = open(s, 1);
    s.advance(id, 'failed', 'sweep', 'expired:row-a');
    const e = terminalEvent(s, id);
    expect(cols(s, id)).toEqual({ closedBy: e.causedBy, closeDetail: e.detail, closedAt: e.at });
  });

  it('an unknown causedBy gives no closedBy', () => {
    const s = store();
    const id = open(s, 1);
    s.advance(id, 'failed', 'session-uuid-a');
    expect(cols(s, id).closedBy).toBeNull();
    expect(wire(s, id).closedBy).toBeNull();
  });

  it('a move that does not end the run leaves the columns null', () => {
    const s = store();
    const id = open(s, 1);
    s.advance(id, 'dispatched', 'coordinator', 'not terminal');
    expect(cols(s, id)).toEqual({ closedBy: null, closeDetail: null, closedAt: null });
  });

  it('closeRun passes its detail to the final advance', () => {
    const s = store();
    const id = open(s, 1);
    const r = s.closeRun({
      runId: id, finalState: 'failed', causedBy: 'operator', handoffCommit: null, program: 'programme-a', viaClosing: false,
      detail: 'abandon:owner-gone',
    });
    expect(r.ok).toBe(true);
    expect(cols(s, id)).toMatchObject({ closedBy: 'operator', closeDetail: 'abandon:owner-gone' });
    expect(wire(s, id)).toMatchObject({ closedBy: 'operator', closeDetail: 'abandon:owner-gone' });
  });

  it('a close with no detail stores a null detail', () => {
    const s = store();
    const id = open(s, 1);
    s.closeRun({ runId: id, finalState: 'failed', causedBy: 'sweep', handoffCommit: null, program: 'programme-a', viaClosing: false });
    expect(cols(s, id)).toMatchObject({ closedBy: 'sweep', closeDetail: null });
  });
});

describe('the migration', () => {
  const planted = (): CoordStore => {
    const p = path.join(mkTmp('ccrc-mig-closecols-'), '.ccrc', 'coord.db');
    mkdirSync(path.dirname(p), { recursive: true });
    const raw = new DatabaseSync(p);
    tx(raw, () => {
      for (let v = 0; v < SLOT - 1; v++) raw.exec(MIGRATIONS[v]!);
      raw.exec(`PRAGMA user_version = ${SLOT - 1}`);
      raw.exec("INSERT INTO programs (slug, title, createdAt, state) VALUES ('programme-a', 'P', 1, 'active')");
      const run = raw.prepare(
        "INSERT INTO runs (id, program, wave, waveOf, project, state, claimedBy, openedAt, closedAt) VALUES (?, 'programme-a', ?, NULL, 'demo', ?, 'c', 1, ?)",
      );
      const ev = raw.prepare('INSERT INTO run_events (runId, at, fromState, toState, causedBy, detail) VALUES (?, ?, ?, ?, ?, ?)');
      run.run(1, 1, 'failed', 50); ev.run(1, 40, 'working', 'closing', 'operator', null); ev.run(1, 50, 'closing', 'failed', 'operator', 'abandon:x');
      run.run(2, 2, 'done', 60); ev.run(2, 60, 'closing', 'done', 'coordinator', null);
      run.run(3, 3, 'failed', 70); ev.run(3, 70, 'working', 'failed', 'a-session-id', 'note');
      run.run(4, 4, 'working', null); ev.run(4, 5, 'dispatched', 'working', 'coordinator', null);
      run.run(5, 5, 'failed', 80);
    });
    raw.close();
    return new CoordStore(openCoordDb(p));
  };

  it('the entry is one additive pair of columns', () => {
    expect(SLOT, 'no MIGRATIONS entry adds runs.closedBy').toBeGreaterThanOrEqual(44);
    expect(MIGRATIONS.filter((m) => ADD.test(m)).length).toBe(1);
  });

  it('the migration fills them from that row', () => {
    const s = planted();
    expect(cols(s, 1)).toMatchObject({ closedBy: 'operator', closeDetail: 'abandon:x' });
    expect(cols(s, 2)).toMatchObject({ closedBy: 'coordinator', closeDetail: null });
  });

  it('an unknown causedBy, an open run and a run with no event stay null', () => {
    const s = planted();
    expect(cols(s, 3).closedBy).toBeNull();
    expect(cols(s, 4)).toMatchObject({ closedBy: null, closeDetail: null });
    expect(cols(s, 5)).toMatchObject({ closedBy: null, closeDetail: null });
  });
});
