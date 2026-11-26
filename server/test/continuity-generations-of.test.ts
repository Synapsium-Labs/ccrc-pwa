// Overlord W1, the chat (plan w1-chat.md, Task 2, question 12): `generationsOf`, every generation of one identity across terms, text-free,
// for the chat's dividers. ALL-OR-FAILURE like `liveGenerations`: one row this build cannot read fails the read. Rows are seeded through
// the store's own writers on a fixture coord.db. Neutral names only.
import { afterEach, describe, expect, it } from 'vitest';
import path from 'node:path';
import { openCoordDb, tx } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { endOverlordGeneration, generationsOf, type MintInput } from '../src/continuity/continuityStore.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const LANE_A = 'lane-a-overlord';
const LANE_B = 'lane-b-overlord';
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-gens-of-'), '.ccrc', 'coord.db')));

let reports = 0;
/** A recorded start of `sessionId` for the conversation `uuid`, so a generation's `startId` names a real row. */
const startOf = (s: CoordStore, sessionId: string, uuid: string, reportedAt: number): number => {
  reports += 1;
  const r = s.insertStart({ sessionId, reportId: `r-${reports}`, uuid, source: 'clear', model: 'claude-opus-5-5', rowIncarnation: null, reportedAt, receivedAt: reportedAt });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};
const mintOf = (identity: string, sessionId: string, term: number, startId: number, startReportedAt: number): MintInput => ({
  identity, sessionId, role: 'coordinator', term, rowIncarnation: null, startId, startReportedAt, resumed: false, model: 'claude-opus-5-5',
  lane: 'lane-a', host: null, outcome: 'crashed', mono: 1_000, proc: 'p1', now: startReportedAt,
});
const UUID_1 = '11111111-1111-4111-8111-111111111111';
const UUID_2 = '22222222-2222-4222-8222-222222222222';
const UUID_3 = '33333333-3333-4333-8333-333333333333';
const UUID_OTHER = '44444444-4444-4444-8444-444444444444';

/** Term 1 run by lane A (two conversations: n=1 ended by a /clear, n=2 retired by the rebind), then term 2 run by lane B (live). Another
 *  identity's generation is minted between them. */
function rebindFixture(): CoordStore {
  const s = store();
  const m = (i: MintInput, e: Parameters<CoordStore['mintGeneration']>[1] = null) => {
    const r = s.mintGeneration(i, e, true);
    if (!r.ok) throw new Error(`mint ${r.kind}`);
    return r;
  };
  m(mintOf('overlord', LANE_A, 1, startOf(s, LANE_A, UUID_1, NOW), NOW));
  m(mintOf('lane-c-project-a', 'lane-c-project-a', 1, startOf(s, 'lane-c-project-a', UUID_OTHER, NOW + 500), NOW + 500));
  const live = s.liveGenerationOfIdentity('overlord');
  if (!live.ok || live.row === null) throw new Error('no live row');
  m(mintOf('overlord', LANE_A, 1, startOf(s, LANE_A, UUID_2, NOW + 1_000), NOW + 1_000), live.row);
  tx(s.db, () => { endOverlordGeneration(s.db, LANE_A, NOW + 2_000); });
  m(mintOf('overlord', LANE_B, 2, startOf(s, LANE_B, UUID_3, NOW + 3_000), NOW + 3_000));
  return s;
}

describe('generationsOf (the chat plan, question 12)', () => {
  it('answers every generation of the identity across both terms in (term, n) order, with its own session, start time and conversation, and marks the live one', () => {
    const s = rebindFixture();
    const r = generationsOf(s.db, 'overlord');
    expect(r).toEqual({ ok: true, rows: [
      { term: 1, n: 1, sessionId: LANE_A, startReportedAt: NOW, live: false, conversation: UUID_1 },
      { term: 1, n: 2, sessionId: LANE_A, startReportedAt: NOW + 1_000, live: false, conversation: UUID_2 },
      { term: 2, n: 1, sessionId: LANE_B, startReportedAt: NOW + 3_000, live: true, conversation: UUID_3 },
    ] });
  });

  it('leaves another identity\'s rows out, and answers an identity with no rows as an empty list', () => {
    const s = rebindFixture();
    const other = generationsOf(s.db, 'lane-c-project-a');
    expect(other).toEqual({ ok: true, rows: [{ term: 1, n: 1, sessionId: 'lane-c-project-a', startReportedAt: NOW + 500, live: true, conversation: UUID_OTHER }] });
    expect(generationsOf(s.db, 'nobody')).toEqual({ ok: true, rows: [] });
  });

  it('carries no other column of the row: its keys are exactly the six', () => {
    const r = generationsOf(rebindFixture().db, 'overlord');
    expect(r.ok && Object.keys(r.rows[0]!).sort()).toEqual(['conversation', 'live', 'n', 'sessionId', 'startReportedAt', 'term']);
  });

  it('fails the whole read, naming the row, when one row\'s counter or session is not one this build can read', () => {
    for (const [label, sql] of [
      ['term', "UPDATE continuity_generations SET term = 'x' WHERE n = 2"],
      ['n', "UPDATE continuity_generations SET n = 1.5 WHERE term = 2"],
      ['startReportedAt', "UPDATE continuity_generations SET startReportedAt = 'soon' WHERE term = 2"],
      ['sessionId', "UPDATE continuity_generations SET sessionId = '' WHERE term = 2"],
    ] as const) {
      const s = rebindFixture();
      s.db.exec(sql);
      const r = generationsOf(s.db, 'overlord');
      expect(r.ok, label).toBe(false);
      expect(!r.ok && r.detail, label).toMatch(/continuity_generations row \d+/);
    }
  });

  it('fails the whole read when a start\'s uuid is empty or its start row is gone', () => {
    const s = rebindFixture();
    s.db.exec("UPDATE continuity_starts SET uuid = '' WHERE uuid = '" + UUID_2 + "'");
    expect(generationsOf(s.db, 'overlord').ok).toBe(false);
    const t = rebindFixture();
    t.db.exec('PRAGMA foreign_keys = OFF');
    t.db.exec("DELETE FROM continuity_starts WHERE uuid = '" + UUID_3 + "'");
    const r = generationsOf(t.db, 'overlord');
    expect(r.ok).toBe(false);
  });

  it('answers ok: false, never an empty list, on a closed database', () => {
    const s = rebindFixture();
    s.db.close();
    const r = generationsOf(s.db, 'overlord');
    expect(r.ok).toBe(false);
    expect(!r.ok && r.detail).toMatch(/continuity_generations read failed/);
  });
});
