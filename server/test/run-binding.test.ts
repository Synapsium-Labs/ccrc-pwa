// ARCH-60 (#795), the run binding. `coord/runBinding.ts` is L1: the one place a run is matched to a worker's
// INCARNATION (session id plus birth), so a recycled id cannot inherit an earlier occupant's run. Three groups:
// the pure queries on a hand-built series, the #746 fixture through a real store (two runs naming one worker, a
// recycled id, the open-vs-newest pair), and the single-writer pin.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  bindingOf, bindsRun, boundRunsOf, bornIncarnation, childrenOf, claimantsOf, incarnationOf, parentOf, runNamesSession, unbornIncarnation,
  bindingWriterCalls, BINDING_WRITER_FILES, BINDING_WRITER_VERBS,
  type BindingRun,
} from '../src/coord/runBinding.js';
import { openCoordDb } from '../src/coord/db.js';
import { CoordStore } from '../src/coord/store.js';
import { mkTmp } from './tmpHelpers.js';
import { walkSrc } from './rings/walkSrc.js';
import { parentOfSession } from './coordReadHelpers.js';

const BORN = 1_700_000_000_000;
let n = 0;
const run = (over: Partial<BindingRun> = {}): BindingRun =>
  ({ id: ++n, sessionId: 'demo-w', claimedBy: 'coord-1', state: 'dispatched', openedAt: BORN + 10,
     sessionBornAt: null, sessionBornFor: null, ...over });

describe('Incarnation', () => {
  it('a placed birth is a born incarnation; an unplaceable one is unborn and says why', () => {
    expect(incarnationOf('demo-w', { kind: 'at', ms: BORN })).toMatchObject({ kind: 'born', sessionId: 'demo-w', bornAt: BORN });
    expect(incarnationOf('demo-w', { kind: 'unplaceable', detail: 'no birth' }))
      .toMatchObject({ kind: 'unborn', sessionId: 'demo-w', why: 'unplaceable' });
    expect(unbornIncarnation('demo-w', 'not-a-child')).toMatchObject({ kind: 'unborn', why: 'not-a-child' });
  });
});

describe('runNamesSession', () => {
  it('is the id-string rule alone: the same id yes, another id or no worker no, a birth never read', () => {
    expect(runNamesSession({ sessionId: 'demo-w' }, 'demo-w')).toBe(true);
    expect(runNamesSession({ sessionId: 'demo-x' }, 'demo-w')).toBe(false);
    expect(runNamesSession({ sessionId: null }, 'demo-w')).toBe(false);
  });
  it('agrees with bindsRun on every run an unborn incarnation is asked about', () => {
    const inc = unbornIncarnation('demo-w', 'not-a-child');
    for (const sessionId of ['demo-w', 'demo-x', null]) {
      expect(runNamesSession({ sessionId }, 'demo-w')).toBe(bindsRun(inc, run({ sessionId })) === 'bound');
    }
  });
});

describe('bindsRun', () => {
  const inc = bornIncarnation('demo-w', BORN);
  it('another session\'s run never binds', () => {
    expect(bindsRun(inc, run({ sessionId: 'demo-x' }))).toBe('unbound');
    expect(bindsRun(inc, run({ sessionId: null }))).toBe('unbound');
  });
  it('a run carrying this birth binds, one carrying another birth or another occupant\'s does not', () => {
    expect(bindsRun(inc, run({ sessionBornAt: BORN, sessionBornFor: 'demo-w', openedAt: BORN - 5 }))).toBe('bound');
    expect(bindsRun(inc, run({ sessionBornAt: BORN - 1, sessionBornFor: 'demo-w' }))).toBe('unbound');
    expect(bindsRun(inc, run({ sessionBornAt: BORN, sessionBornFor: 'demo-other' }))).toBe('unbound');
    expect(bindsRun(inc, run({ sessionBornAt: BORN, sessionBornFor: null }))).toBe('unbound');
  });
  it('a run with no birth binds only when it was opened at or after the birth (a later wave on a live worker)', () => {
    expect(bindsRun(inc, run({ openedAt: BORN }))).toBe('bound');
    expect(bindsRun(inc, run({ openedAt: BORN + 1 }))).toBe('bound');
    expect(bindsRun(inc, run({ openedAt: BORN - 1 }))).toBe('undecidable');
  });
  it('an unborn incarnation matches on the id alone, the rule that held before the binding', () => {
    const unborn = unbornIncarnation('demo-w', 'not-a-child');
    expect(bindsRun(unborn, run({ openedAt: 1, sessionBornAt: 5, sessionBornFor: 'x' }))).toBe('bound');
    expect(bindsRun(unborn, run({ sessionId: 'demo-x' }))).toBe('unbound');
  });
});

describe('bindingOf, parentOf, claimantsOf', () => {
  const inc = bornIncarnation('demo-w', BORN);
  it('the open-vs-newest pair: newest is any state, open is the newest non-terminal', () => {
    const a = run({ state: 'planned', claimedBy: 'coord-1' });
    const b = run({ state: 'done', claimedBy: 'coord-2' });
    const c = run({ state: 'failed', claimedBy: 'coord-3' });
    const b1 = bindingOf([a, b, c], inc);
    expect(b1.newest?.id).toBe(c.id);
    expect(b1.open?.id).toBe(a.id);
    expect(bindingOf([b, c], inc)).toEqual({ newest: c, open: null, undecided: [] });
    expect(bindingOf([], inc)).toEqual({ newest: null, open: null, undecided: [] });
  });
  it('a state this build cannot name counts as open', () => {
    const u = run({ state: 'unknown' });
    expect(bindingOf([u], inc).open?.id).toBe(u.id);
  });
  it('two runs naming one worker: the parent is the newest open claimant, the set holds both, newest first', () => {
    const a = run({ claimedBy: 'coord-1' });
    const b = run({ claimedBy: 'coord-2' });
    const c = run({ claimedBy: 'coord-1' });
    expect(parentOf(bindingOf([a, b, c], inc))).toBe('coord-1');
    expect(claimantsOf([a, b, c], inc)).toEqual(['coord-1', 'coord-2']);
    expect(claimantsOf([a, b], inc)).toEqual(['coord-2', 'coord-1']);
  });
  it('an ownerless open run is the parent\'s null and contributes no claimant', () => {
    const a = run({ claimedBy: 'coord-1' });
    const b = run({ claimedBy: null });
    expect(parentOf(bindingOf([a, b], inc))).toBeNull();
    expect(claimantsOf([a, b], inc)).toEqual(['coord-1']);
  });
  it('a run where the session is the claimant does not make the series\' other role a worker', () => {
    expect(bindingOf([run({ sessionId: 'demo-x', claimedBy: 'demo-w' })], inc)).toEqual({ newest: null, open: null, undecided: [] });
  });
});

describe('childrenOf', () => {
  it('the open runs a coordinator claims whose worker is still the one they were opened for', () => {
    const live = run({ id: 10, sessionId: 'w-live', claimedBy: 'coord-1', openedAt: BORN + 5 });
    const ghost = run({ id: 11, sessionId: 'w-recycled', claimedBy: 'coord-1', openedAt: BORN - 5 });
    const done = run({ id: 12, sessionId: 'w-live', claimedBy: 'coord-1', state: 'done' });
    const unbound = run({ id: 13, sessionId: null, claimedBy: 'coord-1' });
    const other = run({ id: 14, sessionId: 'w-live', claimedBy: 'coord-2' });
    const incFor = (id: string) => bornIncarnation(id, BORN);
    expect(childrenOf([live, ghost, done, unbound, other], 'coord-1', incFor).map((r) => r.id)).toEqual([10]);
  });
});

const store = (): CoordStore =>
  new CoordStore(openCoordDb(path.join(mkTmp('ccrc-binding-'), '.ccrc', 'coord.db')));
const open = (s: CoordStore, program: string, claimedBy: string): number =>
  (s.openRun({ program, title: program, project: 'p', wave: 1, waveOf: null, claimedBy }) as { id: number }).id;
// The minting run opens BEFORE the worker it dispatches is born, as in real use. A fixture that opened it after the
// birth would let it bind through the opened-after-birth rule alone, and the store's read of the birth columns
// (sessionBornAt/sessionBornFor) would go unpinned.
const backdate = (s: CoordStore, runId: number, ms: number): void => {
  s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(ms, runId);
};
const readSeries = (s: CoordStore, id: string): BindingRun[] => {
  const r = s.bindingRunsOf(id);
  if (!r.ok) throw new Error(r.detail);
  return r.runs;
};

describe('the #746 fixture, through a store', () => {
  it('a recycled id never inherits the stale run: the parent is the live coordinator, or none', () => {
    const s = store();
    const stale = open(s, 'prog-old', 'coord-gone');
    s.setSession(stale, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
    const fresh = open(s, 'prog-new', 'coord-live');
    backdate(s, fresh, BORN - 10);
    s.setSession(fresh, 'demo-w', BORN);
    const series = readSeries(s, 'demo-w');
    const inc = bornIncarnation('demo-w', BORN);
    expect(series.map((r) => r.id)).toEqual([stale, fresh]);
    expect(parentOf(bindingOf(series, inc))).toBe('coord-live');
    expect(claimantsOf(series, inc)).toEqual(['coord-live']);
    // In this shape the old reader agrees: the fresh run is the newest open one. The next case is where it
    // inherits the ghost. ARCH-62 moves the sites; this commit adds the owner.
    expect(parentOfSession(s, 'demo-w')).toBe('coord-live');
  });

  it('a recycled id with only the stale run left open has no parent at all, not a ghost coordinator', () => {
    const s = store();
    const stale = open(s, 'prog-old', 'coord-gone');
    s.setSession(stale, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
    const fresh = open(s, 'prog-new', 'coord-live');
    backdate(s, fresh, BORN - 10);
    s.setSession(fresh, 'demo-w', BORN);
    for (const to of ['dispatched', 'closing', 'done'] as const) s.advance(fresh, to, 'coordinator');
    const series = readSeries(s, 'demo-w');
    const inc = bornIncarnation('demo-w', BORN);
    expect(parentOfSession(s, 'demo-w')).toBe('coord-gone');
    expect(parentOf(bindingOf(series, inc))).toBeNull();
    expect(bindingOf(series, inc).newest?.id).toBe(fresh);
    expect(bindingOf(series, inc).open).toBeNull();
  });

  it('the coordinator side: childrenOf drops the run the recycled worker never belonged to', () => {
    const s = store();
    const stale = open(s, 'prog-old', 'coord-gone');
    s.setSession(stale, 'demo-w');
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, stale);
    const series = readSeries(s, 'coord-gone');
    expect(childrenOf(series, 'coord-gone', (id) => bornIncarnation(id, BORN))).toEqual([]);
    expect(childrenOf(series, 'coord-gone', (id) => unbornIncarnation(id, 'not-a-child')).map((r) => r.id)).toEqual([stale]);
  });

  it('the dup-arm re-open: a planned run opened before the birth, then bound after it, records the birth and is bound (#1407)', () => {
    const s = store();
    const input = { program: 'prog-two', title: 't', project: 'p', wave: 2, waveOf: null, claimedBy: 'coord-1' };
    const wave2 = (s.openRun(input) as { id: number }).id;
    s.db.prepare('UPDATE runs SET openedAt = ? WHERE id = ?').run(BORN - 1000, wave2);
    const wave1 = open(s, 'prog-one', 'coord-1');
    backdate(s, wave1, BORN - 10);
    s.setSession(wave1, 'demo-w', BORN);
    const again = (s.openRun(input) as { id: number }).id;
    expect(again).toBe(wave2);
    s.setSession(again, 'demo-w');
    const series = readSeries(s, 'demo-w');
    const inc = bornIncarnation('demo-w', BORN);
    const b = bindingOf(series, inc);
    expect(parentOfSession(s, 'demo-w')).toBe('coord-1');
    expect(parentOf(b)).toBe('coord-1');
    expect(b.undecided).toEqual([]);
    expect(boundRunsOf(series, inc, 'any').map((r) => r.id)).toContain(wave2);
    for (const to of ['dispatched', 'closing', 'done'] as const) s.advance(wave1, to, 'coordinator');
    const after = bindingOf(readSeries(s, 'demo-w'), inc);
    expect(parentOf(after)).toBe('coord-1');
    expect(after.undecided).toEqual([]);
    expect(childrenOf(readSeries(s, 'coord-1'), 'coord-1', () => inc).map((r) => r.id)).toContain(wave2);
  });

  it('bindingRunsOf answers the runs a session works on and the runs it claims, by id', () => {
    const s = store();
    const a = open(s, 'prog-a', 'demo-c');
    s.setSession(a, 'demo-w');
    const b = open(s, 'prog-b', 'coord-2');
    s.setSession(b, 'demo-c');
    expect(readSeries(s, 'demo-c').map((r) => r.id)).toEqual([a, b]);
    expect(readSeries(s, 'demo-nobody')).toEqual([]);
  });
});

describe('RunBinding has one writer', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const files = (): { file: string; text: string }[] =>
    walkSrc({ roots: ['server/src'], min: 150 }).map((f) => ({ file: f, text: readFileSync(path.join(root, f), 'utf8') }));

  it('CONTROL: the scan names a call and ignores a comment or a definition', () => {
    const hits = bindingWriterCalls([
      { file: 'server/src/a.ts', text: 'x.setSession(1, "a");\n// c.reclaimProgram(1)\n  clearSession(runId: number) {}\n' },
    ]);
    expect(hits).toEqual([{ file: 'server/src/a.ts', verb: 'setSession' }]);
  });

  it('only the run lifecycle (open, dispatch, reclaim) and the store call the binding\'s write verbs', () => {
    const allowed = new Set(BINDING_WRITER_FILES);
    const offenders = bindingWriterCalls(files()).filter((h) => !allowed.has(h.file));
    expect(offenders).toEqual([]);
    expect([...BINDING_WRITER_VERBS].sort()).toEqual(['bindSession', 'clearSession', 'markDispatched', 'openRun', 'reclaimProgram', 'setSession']);
  });

  it('a planted call from a fourth file is named', () => {
    const planted = [...files(), { file: 'server/src/planted.ts', text: 'coord.setSession(1, "x");' }];
    expect(bindingWriterCalls(planted).filter((h) => !new Set(BINDING_WRITER_FILES).has(h.file)))
      .toEqual([{ file: 'server/src/planted.ts', verb: 'setSession' }]);
  });

  it('a planted bindSession or openRun call from a fourth file is named', () => {
    const planted = [...files(), { file: 'server/src/planted.ts', text: 'c.bindSession(1, "x");\nc.openRun({});' }];
    expect(bindingWriterCalls(planted).filter((h) => !new Set(BINDING_WRITER_FILES).has(h.file)))
      .toEqual([{ file: 'server/src/planted.ts', verb: 'openRun' }, { file: 'server/src/planted.ts', verb: 'bindSession' }]);
  });
});
