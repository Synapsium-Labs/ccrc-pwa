// Overlord W1 readiness, plan `w1-readiness.md` Task 2: `restartsSince` (completed restarts of an identity in a window, by
// RESTART_OUTCOME_MAP) and `liveGenerationOfIdentity` (one identity's live row, parsed alone), over a coord db opened through
// the real migrations.
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { liveGenerationOfIdentity, restartsSince } from '../src/continuity/continuityStore.js';
import { RESTART_OUTCOME_MAP } from '../../shared/overlord-readiness.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const T0 = 1_800_000_000_000;
const A = 'lane-a-project-a';
const B = 'lane-b-project-a';
const store = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-restarts-'), '.ccrc', 'coord.db')));

let reports = 0;
const startOf = (s: CoordStore, at: number): number => {
  reports += 1;
  const r = s.insertStart({ sessionId: A, reportId: `r-${reports}`, uuid: '11111111-2222-3333-4444-555555555555', source: 'clear',
    model: 'claude-opus-5-5', rowIncarnation: null, reportedAt: at, receivedAt: at });
  if (!r.ok) throw new Error('start not recorded');
  return r.id;
};

interface G { identity: string; term?: number; n: number; state: 'ended' | 'active'; outcome: string | null; startReportedAt: number }
/** One generation row, written raw so each test names its outcomes and clocks. */
const gen = (s: CoordStore, g: G): number => {
  const startId = startOf(s, g.startReportedAt);
  const r = s.db.prepare("INSERT INTO continuity_generations (identity, sessionId, role, term, n, state, enteredAt, outcome, resumed, startId, startReportedAt, observed, mintedObservedMs) "
    + "VALUES (?, ?, 'coordinator', ?, ?, ?, ?, ?, 0, ?, ?, '{\"ms\":0,\"mono\":1,\"proc\":\"p\"}', 0)")
    .run(g.identity, g.identity, g.term ?? 1, g.n, g.state, T0, g.outcome, startId, g.startReportedAt);
  return Number(r.lastInsertRowid);
};
/** A predecessor with `outcome` and a successor started at `at`. */
const pair = (s: CoordStore, identity: string, outcome: string | null, at: number, n = 1, term = 1) => {
  gen(s, { identity, term, n, state: 'ended', outcome, startReportedAt: at - 10 });
  gen(s, { identity, term, n: n + 1, state: 'active', outcome: null, startReportedAt: at });
};
const count = (s: CoordStore, identity: string, since: number) => restartsSince(s.db, identity, since);

describe('restartsSince', () => {
  for (const [outcome, cls] of Object.entries(RESTART_OUTCOME_MAP)) {
    it(`a predecessor ended '${outcome}' (${cls}) ${cls === 'restart' ? 'counts' : 'does not count'}`, () => {
      const s = store();
      pair(s, A, outcome, T0 + 100);
      expect(count(s, A, T0)).toEqual({ ok: true, count: cls === 'restart' ? 1 : 0 });
    });
  }

  it('counts only the restart class over a chain of mixed outcomes', () => {
    const s = store();
    const chain = ['crashed', 'renewed', 'swapped', 'cleared', 'woken', 'retired', 'woken-elsewhere', 'unmeasured'];
    chain.forEach((o, i) => gen(s, { identity: A, n: i + 1, state: 'ended', outcome: o, startReportedAt: T0 + i * 10 }));
    gen(s, { identity: A, n: chain.length + 1, state: 'active', outcome: null, startReportedAt: T0 + 1_000 });
    // generations 2..9 each have a predecessor; their predecessors' outcomes are chain[0..7]
    expect(count(s, A, T0)).toEqual({ ok: true, count: 5 });
  });

  it('the window is closed at the start: startReportedAt equal to sinceMs counts, one less does not', () => {
    const s = store();
    pair(s, A, 'crashed', T0 + 500);
    expect(count(s, A, T0 + 500)).toEqual({ ok: true, count: 1 });
    expect(count(s, A, T0 + 501)).toEqual({ ok: true, count: 0 });
  });

  it('a first generation (no predecessor) is not a restart', () => {
    const s = store();
    gen(s, { identity: A, n: 1, state: 'active', outcome: null, startReportedAt: T0 + 5 });
    expect(count(s, A, T0)).toEqual({ ok: true, count: 0 });
  });

  it('another identity\'s rows are not counted, and a predecessor in another term does not pair', () => {
    const s = store();
    pair(s, B, 'crashed', T0 + 100);
    pair(s, A, 'crashed', T0 + 200);
    expect(count(s, A, T0)).toEqual({ ok: true, count: 1 });
    expect(count(s, B, T0)).toEqual({ ok: true, count: 1 });
    expect(count(s, 'nobody', T0)).toEqual({ ok: true, count: 0 });
    const s2 = store();
    gen(s2, { identity: A, term: 1, n: 1, state: 'ended', outcome: 'crashed', startReportedAt: T0 });
    gen(s2, { identity: A, term: 2, n: 2, state: 'active', outcome: null, startReportedAt: T0 + 50 });
    expect(count(s2, A, T0)).toEqual({ ok: true, count: 0 });
  });

  it('a predecessor with an unreadable outcome answers ok:false, never a zero', () => {
    const s = store();
    pair(s, A, null, T0 + 100);
    expect(count(s, A, T0)).toMatchObject({ ok: false });
    const s2 = store();
    pair(s2, A, 'from-the-future', T0 + 100);
    expect(count(s2, A, T0)).toMatchObject({ ok: false });
  });

  it('an unreadable outcome outside the window does not matter', () => {
    const s = store();
    pair(s, A, 'from-the-future', T0 + 100);
    expect(count(s, A, T0 + 101)).toEqual({ ok: true, count: 0 });
  });
});

describe('liveGenerationOfIdentity', () => {
  it('returns the identity\'s own live row', () => {
    const s = store();
    pair(s, A, 'crashed', T0 + 100);
    const r = liveGenerationOfIdentity(s.db, A);
    expect(r).toMatchObject({ ok: true, row: { identity: A, n: 2, state: 'active' } });
  });

  it('returns null for an identity with no live row (none at all, or only ended rows)', () => {
    const s = store();
    expect(liveGenerationOfIdentity(s.db, A)).toEqual({ ok: true, row: null });
    gen(s, { identity: A, n: 1, state: 'ended', outcome: 'crashed', startReportedAt: T0 });
    expect(liveGenerationOfIdentity(s.db, A)).toEqual({ ok: true, row: null });
  });

  it('reads its own live row while another identity\'s live row cannot be parsed', () => {
    const s = store();
    gen(s, { identity: A, n: 1, state: 'active', outcome: null, startReportedAt: T0 });
    gen(s, { identity: B, n: 1, state: 'active', outcome: null, startReportedAt: T0 });
    s.db.prepare("UPDATE continuity_generations SET state = 'garbage' WHERE identity = ?").run(B);
    expect(liveGenerationOfIdentity(s.db, A)).toMatchObject({ ok: true, row: { identity: A } });
    expect(liveGenerationOfIdentity(s.db, B)).toMatchObject({ ok: false });
  });

  it('answers ok:false when its own row is corrupt', () => {
    const s = store();
    gen(s, { identity: A, n: 1, state: 'active', outcome: null, startReportedAt: T0 });
    s.db.prepare("UPDATE continuity_generations SET observed = 'not json' WHERE identity = ?").run(A);
    expect(liveGenerationOfIdentity(s.db, A)).toMatchObject({ ok: false });
  });
});
