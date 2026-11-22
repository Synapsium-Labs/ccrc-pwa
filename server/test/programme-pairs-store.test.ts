// Overlord W2, plan w2-overlaps.md Task 3, questions 5, 8 and 14: the pairs store, called with the db handle directly.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import {
  applyPairMoves, claimHistory, goalsStamp, newestEpisodes, programmeLandedSince, stampPairGoalsInTx,
  standingPairs,
} from '../src/coord/programmePairsStore.js';
import type { PairMoves } from '../src/coord/overlaps.js';
import type { PairEvidence } from '../../shared/programmeFacts.js';
import { mkTmp } from './tmpHelpers.js';

const NOW = 1_785_300_000_000;
const mkStore = (): CoordStore => new CoordStore(openCoordDb(path.join(mkTmp('ccrc-pairs-'), '.ccrc', 'coord.db')));

const evidence = (over: Partial<PairEvidence> = {}): PairEvidence => ({
  sources: ['claim-collision'], paths: ['server/src/io.ts'], pathsCut: false, claimIds: [1], prs: [], triples: 0, hotPaths: [], ...over,
});
const KEY = 'overlap:prog-a:prog-b';
const opening = (key = KEY, ep = 1, a = 'prog-a', b = 'prog-b', ev = evidence(), kind: 'overlap' | 'goal-conflict' = 'overlap',
  goalsA: string | null = null, goalsB: string | null = null) => ({
  sighting: { key, kind, a, b, newestAt: NOW - 500, evidence: ev }, episode: ep, goalsA, goalsB,
});
const moves = (over: Partial<PairMoves> = {}): PairMoves => ({ open: [], refresh: [], close: [], ...over }) as PairMoves;
const pairRows = (s: CoordStore): Record<string, unknown>[] => s.db.prepare('SELECT * FROM programme_pairs ORDER BY id').all() as Record<string, unknown>[];
const standing = (s: CoordStore) => {
  const r = standingPairs(s.db);
  if (!r.ok) throw new Error('unreachable');
  return r;
};
const addProgram = (s: CoordStore, slug: string): void => {
  s.db.prepare("INSERT INTO programs (slug, title, createdAt, state) VALUES (?, ?, 1, 'active')").run(slug, slug);
};
const addRun = (s: CoordStore, program: string, o: { kind?: string; state?: string; closedAt?: number | null } = {}): number =>
  Number(s.db.prepare(
    'INSERT INTO runs (program, wave, waveOf, project, state, claimedBy, openedAt, kind, closedAt) VALUES (?, 1, 1, ?, ?, ?, 1, ?, ?)',
  ).run(program, 'project-a', o.state ?? 'working', 'op-a', o.kind ?? 'work', o.closedAt ?? null).lastInsertRowid);

describe('programme_pairs and claim_collisions', () => {
  it('a fresh database has both tables and no row', () => {
    const s = mkStore();
    for (const t of ['programme_pairs', 'claim_collisions']) {
      expect((s.db.prepare('SELECT COUNT(*) AS n FROM ' + t).get() as { n: number }).n).toBe(0);
    }
    expect(standing(s)).toEqual({ ok: true, rows: [], unreadable: [] });
  });
});

describe('applyPairMoves', () => {
  it('an open, a refresh and a close each land', () => {
    const s = mkStore();
    const [id] = applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    expect(id).toBeTypeOf('number');
    expect(pairRows(s)[0]).toMatchObject({ pairKey: KEY, kind: 'overlap', progA: 'prog-a', progB: 'prog-b', episode: 1,
      firstSeenAt: NOW, lastSeenAt: NOW - 500, closedAt: null, goalsA: null, goalsB: null });
    const ev2 = evidence({ paths: ['a.ts', 'b.ts'], claimIds: [1, 2] });
    applyPairMoves(s.db, moves({ refresh: [{ id: id!, lastSeenAt: NOW + 10, evidence: ev2 }] }), NOW + 20);
    expect(pairRows(s)[0]).toMatchObject({ lastSeenAt: NOW + 10, firstSeenAt: NOW, closedAt: null });
    expect(JSON.parse(pairRows(s)[0]!['evidence'] as string)).toEqual(ev2);
    applyPairMoves(s.db, moves({ close: [{ id: id!, why: 'lapsed' }] }), NOW + 30);
    expect(pairRows(s)[0]).toMatchObject({ closedAt: NOW + 30, closedWhy: 'lapsed' });
    expect(standing(s).rows).toEqual([]);
  });

  it('an open and a refresh with stamps write the stamps through the one writer', () => {
    const s = mkStore();
    const [id] = applyPairMoves(s.db, moves({ open: [opening('goal-conflict:prog-a:prog-b', 1, 'prog-a', 'prog-b', evidence({ triples: 2 }),
      'goal-conflict', 'sa1', 'sb1')] }), NOW);
    expect(pairRows(s)[0]).toMatchObject({ goalsA: 'sa1', goalsB: 'sb1' });
    applyPairMoves(s.db, moves({ refresh: [{ id: id!, lastSeenAt: NOW + 1, evidence: evidence({ triples: 3 }), goalsA: 'sa2', goalsB: 'sb2' }] }), NOW + 2);
    expect(pairRows(s)[0]).toMatchObject({ goalsA: 'sa2', goalsB: 'sb2' });
  });

  it('a close and an open of the same key in one call land together', () => {
    const s = mkStore();
    const [id] = applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    const opened = applyPairMoves(s.db, moves({ close: [{ id: id!, why: 'goals-changed' }], open: [opening(KEY, 2)] }), NOW + 5);
    expect(opened).toHaveLength(1);
    const rows = pairRows(s);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ episode: 1, closedAt: NOW + 5, closedWhy: 'goals-changed' });
    expect(rows[1]).toMatchObject({ episode: 2, closedAt: null });
    expect(standing(s).rows.map((r) => [r.key, r.episode])).toEqual([[KEY, 2]]);
  });

  it('two standing rows for one key are refused by the index: the call throws and nothing of it lands', () => {
    const s = mkStore();
    applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    const before = pairRows(s);
    expect(() => applyPairMoves(s.db, moves({ open: [opening('overlap:prog-a:prog-c', 1, 'prog-a', 'prog-c'), opening(KEY, 2)] }), NOW + 1))
      .toThrow();
    expect(pairRows(s)).toEqual(before);
    expect(s.db.isTransaction).toBe(false);
  });

  it('a close of a row that does not stand throws and rolls back the whole call', () => {
    const s = mkStore();
    const [id] = applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    applyPairMoves(s.db, moves({ close: [{ id: id!, why: 'lapsed' }] }), NOW + 1);
    const before = pairRows(s);
    expect(() => applyPairMoves(s.db, moves({
      open: [opening('overlap:prog-a:prog-c', 1, 'prog-a', 'prog-c')], close: [{ id: id!, why: 'lapsed' }],
    }), NOW + 2)).toThrow(/does not stand/);
    expect(pairRows(s)).toEqual(before);
    expect(s.db.isTransaction).toBe(false);
    // a refresh of a row that no longer stands refuses the same way
    expect(() => applyPairMoves(s.db, moves({ refresh: [{ id: id!, lastSeenAt: NOW, evidence: evidence() }] }), NOW + 3)).toThrow();
    expect(pairRows(s)).toEqual(before);
  });
});

describe('standingPairs', () => {
  it('reads back every field in pairKey order', () => {
    const s = mkStore();
    applyPairMoves(s.db, moves({ open: [
      opening('overlap:prog-b:prog-c', 1, 'prog-b', 'prog-c'),
      opening('goal-conflict:prog-a:prog-b', 3, 'prog-a', 'prog-b', evidence({ triples: 2, hotPaths: ['x'] }), 'goal-conflict', 'sa', 'sb'),
    ] }), NOW);
    s.db.prepare("UPDATE programme_pairs SET ruled = 'both-stand', ruledAt = 77, ruledBy = 'op-a' WHERE pairKey LIKE 'goal-conflict%'").run();
    const r = standing(s);
    expect(r.unreadable).toEqual([]);
    expect(r.rows.map((x) => x.key)).toEqual(['goal-conflict:prog-a:prog-b', 'overlap:prog-b:prog-c']);
    expect(r.rows[0]).toMatchObject({ kind: 'goal-conflict', a: 'prog-a', b: 'prog-b', episode: 3, firstSeenAt: NOW, lastSeenAt: NOW - 500,
      evidence: evidence({ triples: 2, hotPaths: ['x'] }), goalsA: 'sa', goalsB: 'sb', ruled: { choice: 'both-stand', at: 77, by: 'op-a' } });
    expect(r.rows[1]).toMatchObject({ kind: 'overlap', ruled: null, goalsA: null, goalsB: null });
  });

  it('a hand-written kind of merge is listed unreadable and not in rows', () => {
    const s = mkStore();
    applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    s.db.prepare("UPDATE programme_pairs SET kind = 'merge'").run();
    const r = standing(s);
    expect(r.rows).toEqual([]);
    expect(r.unreadable).toEqual([{ id: expect.any(Number), key: KEY, why: 'kind' }]);
  });

  it('a ruled of stop-both reads ruled: unreadable on the row, and a ruling with no time or actor reads the same', () => {
    const s = mkStore();
    applyPairMoves(s.db, moves({ open: [opening('goal-conflict:prog-a:prog-b', 1, 'prog-a', 'prog-b', evidence({ triples: 2 }), 'goal-conflict'),
      opening('goal-conflict:prog-a:prog-c', 1, 'prog-a', 'prog-c', evidence({ triples: 2 }), 'goal-conflict')] }), NOW);
    s.db.prepare("UPDATE programme_pairs SET ruled = 'stop-both', ruledAt = 5, ruledBy = 'op-a' WHERE progB = 'prog-b'").run();
    s.db.prepare("UPDATE programme_pairs SET ruled = 'both-stand' WHERE progB = 'prog-c'").run();
    const r = standing(s);
    expect(r.rows.map((x) => x.ruled)).toEqual(['unreadable', 'unreadable']);
  });

  it('a malformed evidence reads evidence: unreadable and keeps the row', () => {
    const s = mkStore();
    applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    for (const bad of ['not json', '[]', '{"sources":["nope"]}', JSON.stringify({ ...evidence(), triples: 'x' })]) {
      s.db.prepare('UPDATE programme_pairs SET evidence = ?').run(bad);
      expect(standing(s).rows[0]!.evidence).toBe('unreadable');
    }
  });

  it('answers { ok: false, detail } when the table is gone', () => {
    const s = mkStore();
    s.db.exec('DROP TABLE programme_pairs');
    const r = standingPairs(s.db);
    expect(r.ok).toBe(false);
    expect(newestEpisodes(s.db).ok).toBe(false);
  });
});

describe('newestEpisodes', () => {
  it('answers the highest episode per key, closed episodes included', () => {
    const s = mkStore();
    const [a] = applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    applyPairMoves(s.db, moves({ close: [{ id: a!, why: 'lapsed' }], open: [opening(KEY, 2)] }), NOW + 1);
    const [b] = applyPairMoves(s.db, moves({ open: [opening('overlap:prog-a:prog-c', 1, 'prog-a', 'prog-c')] }), NOW + 2);
    applyPairMoves(s.db, moves({ close: [{ id: b!, why: 'programme-ended' }] }), NOW + 3);
    const r = newestEpisodes(s.db);
    if (!r.ok) throw new Error('unreachable');
    expect([...r.episodes.entries()].sort()).toEqual([[KEY, 2], ['overlap:prog-a:prog-c', 1]]);
  });
});

describe('claimHistory', () => {
  const claim = (s: CoordStore, p: string, at: number, runId: number | null = null) => {
    const r = s.claimAttempt({ project: 'project-a', paths: [p], sessionId: `lane-${p.replace(/\W/g, '')}-project-a`, uuid: 'u', runId,
      intent: 'x', now: at });
    if (!r.ok) throw new Error('unreachable');
    return r.claims[0]!.id;
  };

  it('leaves out re-chained rows and rows before since, reads newest first, with paths and programme', () => {
    const s = mkStore();
    addProgram(s, 'prog-a');
    const run = addRun(s, 'prog-a');
    claim(s, 'old.ts', NOW - 5000);
    const chained = claim(s, 'chain.ts', NOW + 100);
    s.db.prepare('UPDATE claims SET chainedFrom = 1 WHERE id = ?').run(chained);
    claim(s, 'one.ts', NOW + 200, run);
    claim(s, 'two.ts', NOW + 300);
    const r = claimHistory(s.db, NOW, 10);
    if (!r.ok) throw new Error('unreachable');
    expect(r.cut).toBe(false);
    expect(r.rows.map((x) => x.paths)).toEqual([['two.ts'], ['one.ts']]);
    expect(r.rows.map((x) => x.program)).toEqual([null, 'prog-a']);
    expect(r.rows[0]).toMatchObject({ project: 'project-a', createdAt: NOW + 300 });
  });

  it('past the cap says cut and keeps the NEWEST', () => {
    const s = mkStore();
    for (let i = 0; i < 4; i++) claim(s, `f${i}.ts`, NOW + i);
    const r = claimHistory(s.db, 0, 2);
    if (!r.ok) throw new Error('unreachable');
    expect(r.cut).toBe(true);
    expect(r.rows.map((x) => x.paths[0])).toEqual(['f3.ts', 'f2.ts']);
    const exact = claimHistory(s.db, 0, 4);
    if (!exact.ok) throw new Error('unreachable');
    expect(exact.cut).toBe(false);
    expect(exact.rows).toHaveLength(4);
  });

  it('answers { ok: false } when the read throws', () => {
    const s = mkStore();
    s.db.exec('DROP TABLE claim_paths');
    expect(claimHistory(s.db, 0, 5).ok).toBe(false);
  });
});

describe('goalsStamp', () => {
  const setup = (): CoordStore => {
    const s = mkStore();
    addProgram(s, 'prog-a');
    s.db.prepare("UPDATE programs SET specPath = 'docs/a.md', inShort = 'x', inShortAt = 10, doneWhen = ? WHERE slug = 'prog-a'")
      .run(JSON.stringify(['it works']));
    return s;
  };
  it('is stable when nothing changed and is 16 hex characters', () => {
    const s = setup();
    const a = goalsStamp(s.db, 'prog-a');
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(goalsStamp(s.db, 'prog-a')).toBe(a);
  });
  it('changes on a modification added, ruled and merged, on doneWhen and on a re-pin', () => {
    const s = setup();
    const seen = new Set<string>([goalsStamp(s.db, 'prog-a')]);
    const step = (sql: string, ...args: (string | number)[]): void => {
      const before = goalsStamp(s.db, 'prog-a');
      s.db.prepare(sql).run(...args);
      const after = goalsStamp(s.db, 'prog-a');
      expect(after).not.toBe(before);
      seen.add(after);
    };
    step("INSERT INTO programme_modifications (program, at, text) VALUES ('prog-a', 20, 'add a thing')");
    step("UPDATE programme_modifications SET ruling = 'accept' WHERE program = 'prog-a'");
    step("UPDATE programme_modifications SET mergedAt = 30 WHERE program = 'prog-a'");
    step("UPDATE programs SET doneWhen = ? WHERE slug = 'prog-a'", JSON.stringify(['it works', 'and more']));
    step("UPDATE programs SET inShortAt = 99 WHERE slug = 'prog-a'");
    expect(seen.size).toBe(6);
  });
  it('does not change with another programme, and is stable for a programme with no row', () => {
    const s = setup();
    addProgram(s, 'prog-b');
    const a = goalsStamp(s.db, 'prog-a');
    s.db.prepare("UPDATE programs SET inShortAt = 5 WHERE slug = 'prog-b'").run();
    expect(goalsStamp(s.db, 'prog-a')).toBe(a);
    expect(goalsStamp(s.db, 'no-such')).toBe(goalsStamp(s.db, 'no-such'));
  });
  it('throws when the read throws', () => {
    const s = setup();
    s.db.exec('DROP TABLE programme_modifications');
    expect(() => goalsStamp(s.db, 'prog-a')).toThrow();
  });
});

describe('programmeHasOpenRun', () => {
  it('is true with a working run and false with only done and failed ones', () => {
    const s = mkStore();
    addProgram(s, 'prog-a'); addProgram(s, 'prog-b');
    addRun(s, 'prog-a', { state: 'done', closedAt: 5 });
    addRun(s, 'prog-a', { state: 'failed', closedAt: 6 });
    expect(s.programmeHasOpenRun('prog-a')).toBe(false);
    addRun(s, 'prog-a', { state: 'working' });
    expect(s.programmeHasOpenRun('prog-a')).toBe(true);
    addProgram(s, 'prog-c');
    addRun(s, 'prog-c', { state: 'planned' });
    expect(s.programmeHasOpenRun('prog-c')).toBe(true);   // planned counts as open
    expect(s.programmeHasOpenRun('prog-b')).toBe(false);
  });
});

describe('programmeLandedSince', () => {
  it('is true for a work run closed done after at; false before, for a review run, for a failed run, and for none', () => {
    const s = mkStore();
    for (const p of ['prog-a', 'prog-b', 'prog-c', 'prog-d', 'prog-e']) addProgram(s, p);
    addRun(s, 'prog-a', { state: 'done', closedAt: 200 });
    addRun(s, 'prog-b', { state: 'done', closedAt: 100 });
    addRun(s, 'prog-c', { state: 'done', closedAt: 200, kind: 'review' });
    addRun(s, 'prog-d', { state: 'failed', closedAt: 200 });
    expect(programmeLandedSince(s.db, 'prog-a', 150)).toBe(true);
    expect(programmeLandedSince(s.db, 'prog-b', 150)).toBe(false);
    expect(programmeLandedSince(s.db, 'prog-c', 150)).toBe(false);
    expect(programmeLandedSince(s.db, 'prog-d', 150)).toBe(false);
    expect(programmeLandedSince(s.db, 'prog-e', 150)).toBe(false);
  });
  it("answers 'unmeasured' when the runs read throws, after DROP TABLE and on a closed handle", () => {
    const s = mkStore();
    s.db.exec('DROP TABLE runs');
    expect(programmeLandedSince(s.db, 'prog-a', 0)).toBe('unmeasured');
    const t = mkStore();
    t.db.close();
    expect(programmeLandedSince(t.db, 'prog-a', 0)).toBe('unmeasured');
  });
});

describe('stampPairGoalsInTx', () => {
  it('writes both stamps and nothing else', () => {
    const s = mkStore();
    const [id] = applyPairMoves(s.db, moves({ open: [opening('goal-conflict:prog-a:prog-b', 1, 'prog-a', 'prog-b', evidence({ triples: 2 }),
      'goal-conflict', 'old-a', 'old-b')] }), NOW);
    s.db.prepare("UPDATE programme_pairs SET mailedAt = 9, ruled = 'both-stand', ruledAt = 8, ruledBy = 'op-a'").run();
    const before = pairRows(s)[0]!;
    stampPairGoalsInTx(s.db, id!, 'new-a', null);
    expect(pairRows(s)[0]).toEqual({ ...before, goalsA: 'new-a', goalsB: null });
  });
  it('throws for a row that does not stand, and for a closed one', () => {
    const s = mkStore();
    expect(() => stampPairGoalsInTx(s.db, 999, 'a', 'b')).toThrow(/does not stand/);
    const [id] = applyPairMoves(s.db, moves({ open: [opening()] }), NOW);
    applyPairMoves(s.db, moves({ close: [{ id: id!, why: 'lapsed' }] }), NOW + 1);
    expect(() => stampPairGoalsInTx(s.db, id!, 'a', 'b')).toThrow(/does not stand/);
  });
});
