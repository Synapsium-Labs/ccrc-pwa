// Overlord W1, the renewal readings PR C (plan `w1-renewal-readings.md` Task 5; slug designated-class-stamped-at-mint): the
// class an Overlord generation was minted under, `continuity_generations.designatedClass`. One nullable column (migration
// 121), written by the mint alone and read back on every row; NULL reads null, which `classChangedOf` reads unmeasured.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import type { MintInput } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(async () => { await removeTmpFixtures(); });

const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-designated-class-'), 'coord.db')));
let reports = 0;
/** A recorded start, so a generation's `startId` names a real row. */
const startOf = (s: CoordStore, sessionId: string): number => {
  reports += 1;
  const r = s.insertStart({ sessionId, reportId: `r-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'clear',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: 1_000, receivedAt: 1_000 });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};
const mint = (s: CoordStore, over: Partial<MintInput> = {}, expect: Parameters<CoordStore['mintGeneration']>[1] = null) => {
  const sessionId = over.sessionId ?? 'lane-a-project-a';
  return s.mintGeneration({
    identity: 'overlord', sessionId, role: 'overlord', term: 2, rowIncarnation: null, startId: startOf(s, sessionId),
    startReportedAt: 1_000, resumed: false, model: 'claude-opus-5-5', lane: 'lane-a', host: null, outcome: 'cleared', mono: 1, proc: 'p1', now: 1_000,
    ...over,
  }, expect, true);
};
const rows = (s: CoordStore) => {
  const r = s.liveGenerations();
  if (!r.ok) throw new Error(r.detail);
  return r.rows.map((g) => ({ identity: g.identity, designatedClass: g.designatedClass }));
};

describe('continuity_generations.designatedClass', () => {
  it('migration 121 adds one nullable column with no default', () => {
    const entry = MIGRATIONS[120]!;
    expect(entry).toContain('ALTER TABLE continuity_generations ADD COLUMN designatedClass TEXT;');
    const s = store();
    const col = (s.db.prepare("SELECT name, \"notnull\" AS nn, dflt_value AS d FROM pragma_table_info('continuity_generations') WHERE name = 'designatedClass'").all());
    expect(col).toEqual([{ name: 'designatedClass', nn: 0, d: null }]);
    s.db.close();
  });

  it('the mint writes the class it is given, and the reader reads it back', () => {
    const s = store();
    expect(mint(s, { designatedClass: 'fable' })).toMatchObject({ ok: true });
    expect(rows(s)).toEqual([{ identity: 'overlord', designatedClass: 'fable' }]);
    s.db.close();
  });

  it('a mint given null, or nothing, writes NULL, and NULL reads null', () => {
    const s = store();
    expect(mint(s, { identity: 'lane-a-project-a', role: 'coordinator', designatedClass: null })).toMatchObject({ ok: true });
    expect(mint(s, { identity: 'lane-b-project-a', sessionId: 'lane-b-project-a', role: 'coordinator' })).toMatchObject({ ok: true });
    expect(s.db.prepare('SELECT designatedClass FROM continuity_generations').all()).toEqual([{ designatedClass: null }, { designatedClass: null }]);
    expect(rows(s).map((r) => r.designatedClass)).toEqual([null, null]);
    s.db.close();
  });

  it('a class word this build does not know is read as written, never folded to null', () => {
    const s = store();
    expect(mint(s, { designatedClass: 'fable' })).toMatchObject({ ok: true });
    s.db.prepare("UPDATE continuity_generations SET designatedClass = 'some-later-class'").run();
    expect(rows(s)).toEqual([{ identity: 'overlord', designatedClass: 'some-later-class' }]);
    s.db.close();
  });

  it('the next generation is stamped afresh: a mint over an Overlord row minted before the class was recorded writes its own', () => {
    const s = store();
    expect(mint(s, { designatedClass: null })).toMatchObject({ ok: true });
    const first = s.liveGenerations();
    if (!first.ok) throw new Error(first.detail);
    const g = first.rows[0]!;
    expect(mint(s, { designatedClass: 'opus' }, { term: g.term, n: g.n, state: g.state, shadowState: g.shadowState, walk: g.walk }))
      .toMatchObject({ ok: true });
    expect(rows(s)).toEqual([{ identity: 'overlord', designatedClass: 'opus' }]);
    s.db.close();
  });
});
