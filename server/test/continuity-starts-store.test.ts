// Overlord W1a, the start report (Task 1): `continuity_starts`, the record of every start the hook reported, its one
// writer (`insertStart`, idempotent on the hook's report id) and the generations lane's read (`startsSince`).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import type { StartInsert } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-starts-'), '.ccrc', 'coord.db')));
const NOW = 1_800_000_000_000;
const start = (over: Partial<StartInsert> = {}): StartInsert => ({
  sessionId: 'lane-a-project-a', reportId: 'r-0001-abcd', uuid: '11111111-2222-3333-4444-555555555555',
  source: 'clear', model: 'claude-opus-5-5', regGen: 4, reportedAt: NOW - 50, receivedAt: NOW, ...over,
});
const rows = (s: CoordStore): unknown[] => s.db.prepare('SELECT * FROM continuity_starts ORDER BY id').all();

describe('continuity_starts', () => {
  it('records one row with every field, and the read answers it', () => {
    const s = store();
    expect(s.insertStart(start())).toEqual({ ok: true, id: 1, fresh: true });
    const row = { id: 1, sessionId: 'lane-a-project-a', reportId: 'r-0001-abcd', uuid: '11111111-2222-3333-4444-555555555555',
      source: 'clear', model: 'claude-opus-5-5', regGen: 4, reportedAt: NOW - 50, receivedAt: NOW };
    expect(rows(s)).toEqual([row]);
    expect(s.startsSince(0)).toEqual({ ok: true, rows: [row] });
  });

  it('a resend of the same (sessionId, reportId) is one row and answers fresh: false with the first row\'s id', () => {
    const s = store();
    s.insertStart(start());
    expect(s.insertStart(start({ receivedAt: NOW + 5_000 }))).toEqual({ ok: true, id: 1, fresh: false });
    expect(rows(s)).toHaveLength(1);
    expect((rows(s)[0] as { receivedAt: number }).receivedAt).toBe(NOW);
  });

  it('the same report id from another session is its own row', () => {
    const s = store();
    s.insertStart(start());
    expect(s.insertStart(start({ sessionId: 'lane-b-project-a' }))).toEqual({ ok: true, id: 2, fresh: true });
  });

  it('a source word outside the vocabulary is stored as other; null model and regGen are stored null', () => {
    const s = store();
    s.insertStart(start({ source: 'teleport', model: null, regGen: null }));
    expect(rows(s)[0]).toMatchObject({ source: 'other', model: null, regGen: null });
    for (const w of ['startup', 'resume', 'clear', 'compact', 'fork', 'other']) {
      s.insertStart(start({ reportId: `r-${w}-0001`, source: w }));
    }
    expect((s.db.prepare("SELECT source FROM continuity_starts WHERE reportId LIKE 'r-%-0001' ORDER BY id").all() as { source: string }[])
      .map((r) => r.source)).toEqual(['startup', 'resume', 'clear', 'compact', 'fork', 'other']);
  });

  it('startsSince answers only the rows after the id it is given, in id order', () => {
    const s = store();
    s.insertStart(start({ reportId: 'r-aaaa-0001' }));
    s.insertStart(start({ reportId: 'r-bbbb-0002' }));
    s.insertStart(start({ reportId: 'r-cccc-0003' }));
    const r = s.startsSince(1);
    expect(r.ok && r.rows.map((x) => x.id)).toEqual([2, 3]);
    expect(s.startsSince(3)).toEqual({ ok: true, rows: [] });
  });

  it('a failed statement answers write-failed or ok: false, never a throw', () => {
    const s = store();
    s.db.exec('DROP TABLE continuity_starts');
    expect(s.insertStart(start())).toEqual({ ok: false, kind: 'write-failed' });
    const r = s.startsSince(0);
    expect(r.ok).toBe(false);
  });
});
