// Overlord W2 remaining work A (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-remaining-work.md, Task 2):
// `programme_remaining` and `programme_edges`, and their one writer. A real coord.db under the per-run temp root, neutral
// names (prog-a, prog-b, lane-a-project-a).
import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import { openCoordDb } from '../src/coord/db.js';
import { MIGRATIONS } from '../src/coord/schema.js';
import { CoordStore } from '../src/coord/store.js';
import type { NewEdge, NewRemaining } from '../src/coord/programmeRemaining.js';
import { OPEN_EDGES_PER_PROGRAMME_MAX, edgeTargetKey } from '../../shared/programmeFacts.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

afterEach(removeTmpFixtures);

const NOW = 1_800_000_000_000;
const BY = 'lane-a-project-a';
const SECRET = 'sk-' + 'Zq9'.repeat(10);

interface Rig { coord: CoordStore; runA: number; runB: number }
function rig(): Rig {
  const coord = new CoordStore(openCoordDb(path.join(mkTmp('ccrc-programme-facts-'), '.ccrc', 'coord.db')));
  const open = (program: string, claimedBy: string): number =>
    (coord.openRun({ program, title: program.toUpperCase(), project: 'project-a', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
  return { coord, runA: open('prog-a', BY), runB: open('prog-b', 'lane-b-project-a') };
}

const st = (o: Partial<NewRemaining> = {}): NewRemaining => ({ lo: 2, hi: 3, reason: 'wave 4 and its review', runId: null, ...o });
const landed = (runId: number, why = 'prog-b lands first'): NewEdge => ({ kind: 'needs-landed', target: { predicate: 'run-closed', runId }, why });
const merged = (runId: number, pr: number): NewEdge => ({ kind: 'needs-landed', target: { predicate: 'pr-merged', runId, pr }, why: 'the PR merges' });
const decide = (itemId: number): NewEdge => ({ kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId }, why: 'the operator picks' });
const count = (r: Rig, table: string): number => (r.coord.db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
const insert = (r: Rig, edges: NewEdge[], o: Partial<NewRemaining> = {}, program = 'prog-a', now = NOW) =>
  r.coord.insertRemaining(program, BY, st(o), edges, 'v0.0.1', now);
const okOf = (res: ReturnType<CoordStore['insertRemaining']>) => {
  if (!res.ok) throw new Error(res.detail);
  return res;
};
const raise = (r: Rig, program: string): number => r.coord.raiseItem({
  program, runId: null, raisedBy: BY, kind: 'do', title: 't', why: 'w', how: [], options: null,
  neededBy: 'soon', soonLabel: null, secretSlot: null,
}, NOW - 60_000);

describe('the migration', () => {
  it('is one entry that creates both tables and adds nothing to an older table', () => {
    const at = MIGRATIONS.findIndex((m) => /CREATE TABLE programme_remaining\b/.test(m));
    expect(at).toBeGreaterThan(0);
    expect(MIGRATIONS.filter((m) => /CREATE TABLE programme_(remaining|edges)\b/.test(m))).toHaveLength(1);
    expect(MIGRATIONS[at]!).toMatch(/CREATE TABLE programme_edges\b/);
    expect(MIGRATIONS[at]!).not.toMatch(/ALTER TABLE/);
    expect(MIGRATIONS.slice(0, at).some((m) => /programme_(remaining|edges)/.test(m))).toBe(false);
  });

  it('a fresh database has both tables and no rows', () => {
    const r = rig();
    expect([count(r, 'programme_remaining'), count(r, 'programme_edges')]).toEqual([0, 0]);
  });
});

describe('insertRemaining, the one writer', () => {
  it('a statement with two edges writes three rows in one transaction and answers both as added', () => {
    const r = rig();
    const res = okOf(insert(r, [landed(r.runB), merged(r.runB, 7)], { runId: r.runA }));
    expect(res.added).toHaveLength(2);
    expect(res.kept).toEqual([]);
    expect([count(r, 'programme_remaining'), count(r, 'programme_edges')]).toEqual([1, 2]);
    expect(r.coord.remainingOf('prog-a', 10)).toEqual([
      { id: res.id, program: 'prog-a', at: NOW, byId: BY, runId: r.runA, lo: 2, hi: 3, reason: 'wave 4 and its review' },
    ]);
    const row = r.coord.db.prepare('SELECT build, statementId FROM programme_remaining s JOIN programme_edges e ON e.statementId = s.id LIMIT 1')
      .get() as { build: string; statementId: number };
    expect(row).toEqual({ build: 'v0.0.1', statementId: res.id });
  });

  it('the same edge in a later statement is kept, not duplicated; an edge a later statement omits stays open', () => {
    const r = rig();
    const first = okOf(insert(r, [landed(r.runB), merged(r.runB, 7)]));
    const second = okOf(insert(r, [{ ...landed(r.runB), why: 'said again' }], {}, 'prog-a', NOW + 1000));
    expect(second.added).toEqual([]);
    expect(second.kept).toEqual([first.added[0]]);
    expect(count(r, 'programme_edges')).toBe(2);
    expect(r.coord.openEdgesOf(['prog-a']).map((e) => e.id)).toEqual(first.added);
    expect(r.coord.openEdgesOf(['prog-a']).every((e) => e.state === 'open')).toBe(true);
  });

  it('the canonical target form makes two key orders one edge', () => {
    const r = rig();
    const a = okOf(insert(r, [merged(r.runB, 7)]));
    const swapped = { kind: 'needs-landed', target: { pr: 7, runId: r.runB, predicate: 'pr-merged' }, why: 'w' } as unknown as NewEdge;
    const b = okOf(insert(r, [swapped]));
    expect(b.kept).toEqual(a.added);
    const stored = (r.coord.db.prepare('SELECT target FROM programme_edges').get() as { target: string }).target;
    expect(stored).toBe(`{"predicate":"pr-merged","runId":${r.runB},"pr":7}`);
  });

  it('a throw inside the transaction (an unknown programme) leaves no row in either table', () => {
    const r = rig();
    expect(() => insert(r, [landed(r.runB)], {}, 'prog-zzz')).toThrow();
    expect([count(r, 'programme_remaining'), count(r, 'programme_edges')]).toEqual([0, 0]);
  });

  it(`a statement that would pass ${OPEN_EDGES_PER_PROGRAMME_MAX} open edges writes nothing; a kept edge is not counted twice`, () => {
    const r = rig();
    const many = (from: number, n: number): NewEdge[] => Array.from({ length: n }, (_, i) => merged(r.runB, from + i));
    okOf(insert(r, many(1, 10)));
    okOf(insert(r, many(11, 10)));
    expect(count(r, 'programme_edges')).toBe(20);
    const over = insert(r, many(21, 1));
    expect(over).toMatchObject({ ok: false, why: 'too-many-open-edges' });
    expect([count(r, 'programme_remaining'), count(r, 'programme_edges')]).toEqual([2, 20]);
    const kept = okOf(insert(r, many(1, 10)));
    expect([kept.added.length, kept.kept.length]).toEqual([0, 10]);
    expect(count(r, 'programme_remaining')).toBe(3);
  });
});

describe('the reads', () => {
  it('remainingOf answers newest first, at most limit, one programme', () => {
    const r = rig();
    const ids = [1, 2, 3].map((i) => okOf(insert(r, [], { lo: i, hi: i }, 'prog-a', NOW + i)).id);
    okOf(insert(r, [], {}, 'prog-b'));
    expect(r.coord.remainingOf('prog-a', 2).map((s) => s.id)).toEqual([ids[2], ids[1]]);
  });

  it('an unknown kind, an unreadable target and an unknown state are carried with their flags, never dropped or hidden', () => {
    const r = rig();
    const s = okOf(insert(r, [landed(r.runB)]));
    const add = (kind: string, target: string, state: string): void => {
      r.coord.db.prepare('INSERT INTO programme_edges (program, statementId, kind, target, why, state, openedAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .run('prog-a', s.id, kind, target, 'by hand', state, NOW);
    };
    add('needs-x', edgeTargetKey({ predicate: 'run-closed', runId: 5 }), 'open');
    add('needs-landed', '{"predicate":"review-passed","runId":5}', 'open');
    add('needs-landed', edgeTargetKey({ predicate: 'run-closed', runId: 6 }), 'paused');
    add('needs-landed', edgeTargetKey({ predicate: 'run-closed', runId: 8 }), 'met');
    const edges = r.coord.openEdgesOf(['prog-a']);
    expect(edges).toHaveLength(4);
    expect(edges[1]).toMatchObject({ kind: null, kindUnreadable: true, target: { predicate: 'run-closed', runId: 5 }, openedBy: BY });
    expect(edges[2]).toMatchObject({ kind: 'needs-landed', target: null, targetUnreadable: true });
    expect(edges[3]).toMatchObject({ state: 'open', stateUnreadable: true });
    expect(edges[0]).not.toHaveProperty('stateUnreadable');
    expect(edges[0]).not.toHaveProperty('kindUnreadable');
  });

  it('a reason, a why and an evidence written by hand with a key read back masked', () => {
    const r = rig();
    const s = okOf(insert(r, [landed(r.runB)]));
    r.coord.db.prepare('UPDATE programme_remaining SET reason = ? WHERE id = ?').run(`left ${SECRET}`, s.id);
    r.coord.db.prepare('UPDATE programme_edges SET why = ?, evidence = ?, state = ? WHERE id = ?')
      .run(`why ${SECRET}`, `end ${SECRET}`, 'target-ended', s.added[0]);
    const texts = [r.coord.remainingOf('prog-a', 1)[0]!.reason, r.coord.openEdgesOf(['prog-a'])[0]!.why, r.coord.openEdgesOf(['prog-a'])[0]!.evidence ?? ''];
    for (const t of texts) {
      expect(t.length).toBeGreaterThan(0);
      for (let i = 0; i + 8 <= SECRET.length; i++) expect(t.includes(SECRET.slice(i, i + 8)), t).toBe(false);
    }
  });

  it('openEdgesOf reads only the listed programmes, and none for an empty list', () => {
    const r = rig();
    okOf(insert(r, [landed(r.runB)]));
    okOf(insert(r, [landed(r.runA)], {}, 'prog-b'));
    expect(r.coord.openEdgesOf(['prog-b']).map((e) => e.program)).toEqual(['prog-b']);
    expect(r.coord.openEdgesOf([])).toEqual([]);
    expect(r.coord.openEdgesOf(['prog-a', 'prog-b'])).toHaveLength(2);
  });
});

describe('edgeTargetCheck', () => {
  it('a run-closed target must be another programme\'s run that exists', () => {
    const r = rig();
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'run-closed', runId: r.runB })).toEqual({ ok: true });
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'run-closed', runId: r.runA })).toMatchObject({ ok: false });
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'run-closed', runId: 99999 })).toMatchObject({ ok: false });
  });

  it('a pr-merged target must be a pull request the run\'s lineage lists; a run with no lineage lists none', () => {
    const r = rig();
    const t = { predicate: 'pr-merged', runId: r.runB, pr: 7 } as const;
    expect(r.coord.edgeTargetCheck('prog-a', t)).toMatchObject({ ok: false, detail: expect.stringMatching(/does not list pull request 7/) });
    r.coord.foldPrLineage(r.runB, [{ pr: 6, branch: 'ws/a', phase: 'merged', recordedAt: NOW }]);
    expect(r.coord.edgeTargetCheck('prog-a', t)).toMatchObject({ ok: false });
    r.coord.foldPrLineage(r.runB, [{ pr: 6, branch: 'ws/a', phase: 'merged', recordedAt: NOW }, { pr: 7, branch: 'ws/a', phase: 'open', recordedAt: NOW }]);
    expect(r.coord.edgeTargetCheck('prog-a', t)).toEqual({ ok: true });
  });

  it('an unreadable lineage throws, naming the run, rather than reading as none', () => {
    const r = rig();
    r.coord.db.prepare('UPDATE runs SET prLineage = ? WHERE id = ?').run('{"not":"a list"}', r.runB);
    expect(() => r.coord.edgeTargetCheck('prog-a', { predicate: 'pr-merged', runId: r.runB, pr: 7 })).toThrow(new RegExp(`run ${r.runB}`));
  });

  it('an operator-confirms target must be a waiting item of this programme (F6)', () => {
    const r = rig();
    const mine = raise(r, 'prog-a');
    const theirs = raise(r, 'prog-b');
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'operator-confirms', itemId: mine })).toEqual({ ok: true });
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'operator-confirms', itemId: theirs })).toMatchObject({ ok: false });
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'operator-confirms', itemId: 99999 })).toMatchObject({ ok: false });
    r.coord.moveItem(mine, 'withdraw', 'coordinator', {}, NOW, { programmeHasOpenRun: true });
    expect(r.coord.edgeTargetCheck('prog-a', { predicate: 'operator-confirms', itemId: mine })).toMatchObject({ ok: false });
  });

  it('it writes nothing', () => {
    const r = rig();
    r.coord.edgeTargetCheck('prog-a', { predicate: 'run-closed', runId: r.runB });
    expect([count(r, 'programme_remaining'), count(r, 'programme_edges')]).toEqual([0, 0]);
  });
});

it('decide edges round-trip through the store', () => {
  const r = rig();
  const item = raise(r, 'prog-a');
  const res = okOf(insert(r, [decide(item)]));
  expect(r.coord.openEdgesOf(['prog-a'])).toEqual([{
    id: res.added[0], program: 'prog-a', kind: 'needs-decision', target: { predicate: 'operator-confirms', itemId: item },
    why: 'the operator picks', state: 'open', openedAt: NOW, openedBy: BY, endedAt: null, evidence: null, unmeasuredSince: null,
  }]);
});
