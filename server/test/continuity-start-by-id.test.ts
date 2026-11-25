// Overlord W1, the renewal readings PR B (plan `w1-renewal-readings.md`, Task 3): `startById`, the read `notLocal` takes of a
// generation's own start. It reads by primary key, never through `startsOf`'s newest-N window, which a run of later `/clear`
// or compact starts would push the start out of (review 2183, F16). Its own file, so this PR adds no hunk to a suite a W1
// peer is editing (the PR C note's slug designated-class-tests-in-own-file, followed here).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-start-by-id-'), '.ccrc', 'coord.db')));

let reports = 0;
const startOf = (s: CoordStore, source = 'clear', reportedAt = NOW, uuid = UUID): number => {
  reports += 1;
  const r = s.insertStart({ sessionId: ID, reportId: `r-${reports}`, uuid, source, model: 'claude-opus-5-5', rowIncarnation: null,
    reportedAt, receivedAt: reportedAt });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};

describe('startById', () => {
  it('answers the recorded start with that id', () => {
    const s = store();
    const id = startOf(s, 'resume', NOW + 3, '22222222-3333-4444-5555-666666666666');
    expect(s.startById(id)).toEqual({ ok: true, row: {
      id, sessionId: ID, reportId: `r-${reports}`, uuid: '22222222-3333-4444-5555-666666666666', source: 'resume', model: 'claude-opus-5-5',
      rowIncarnation: null, reportedAt: NOW + 3, receivedAt: NOW + 3,
    } });
  });

  it('an id with no row answers row null, not a failure', () => {
    const s = store();
    startOf(s);
    expect(s.startById(9_999)).toEqual({ ok: true, row: null });
  });

  it('finds a start that 21 later starts of the same session have pushed out of a newest-20 window (F16)', () => {
    const s = store();
    const id = startOf(s, 'resume', NOW);
    for (let i = 1; i <= 21; i++) startOf(s, 'clear', NOW + i);
    const window = s.startsOf(ID, 20);
    expect(window.ok && window.rows.some((r) => r.id === id)).toBe(false);
    const r = s.startById(id);
    expect(r.ok && r.row?.source).toBe('resume');
  });

  it('a source word a newer build wrote reads as `other`, through the one rule', () => {
    const s = store();
    const id = startOf(s);
    s.db.prepare("UPDATE continuity_starts SET source = 'teleport' WHERE id = ?").run(id);
    const r = s.startById(id);
    expect(r.ok && r.row?.source).toBe('other');
  });

  it('a database that cannot be read answers ok false with the detail', () => {
    const s = store();
    const id = startOf(s);
    s.db.close();
    const r = s.startById(id);
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toMatch(/^continuity_starts read failed: /);
  });
});
