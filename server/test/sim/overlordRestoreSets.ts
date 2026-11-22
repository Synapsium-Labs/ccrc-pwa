// Overlord W1, authority journal plan Task 8 (PR C; the floors rule is D-8217's): the suite cases and mutant sets of Confirm the
// restore's L1 deciders, `restoreStricter` and `confirmRestorePlan` (`server/src/coord/overlordRestore.ts`). The unit suite
// (`overlord-restore.test.ts`) runs these cases against the real module; mutation-floors.test.ts runs them against each mutant.
// The expected values are written out, never read from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { buildChainedRecord, chainNext, type ChainedJournalRecord, type ChainedTail } from '../../src/chainedJournal.js';
import { OVERLORD_AUTHORITY_FORMAT, type OverlordAuthorityEntry } from '../../src/coord/overlordAuthority.js';
import type { ConfirmFacts, RestoreSide } from '../../src/coord/overlordRestore.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const RESTORE_TS = path.join(ROOT, 'server/src/coord/overlordRestore.ts');
type Restore = typeof import('../../src/coord/overlordRestore.js');

export const RESTORE_STRICTER_KEY = 'server/src/coord/overlordRestore.ts#restoreStricter';
export const CONFIRM_PLAN_KEY = 'server/src/coord/overlordRestore.ts#confirmRestorePlan';

type E = OverlordAuthorityEntry;
type Rec = ChainedJournalRecord<E>;
const GEN = '0f0e0d0c-0b0a-4908-8706-050403020100';
const GEN2 = '1f0e0d0c-0b0a-4908-8706-050403020101';
const S1 = 'overlord-quiet-otter';
const S2 = 'overlord-brisk-heron';

const NARROW: RestoreSide = { binding: null, term: 0, operatorRung: 'off', latches: [], accountSet: { pools: [], untagged: false }, modelClass: 'opus' };
const side = (o: Partial<RestoreSide>): RestoreSide => ({ ...NARROW, ...o });

/** Records chained from 1 through the real kernel and format. */
export function chain(entries: readonly E[]): Rec[] {
  const out: Rec[] = [];
  for (const entry of entries) {
    out.push(buildChainedRecord(OVERLORD_AUTHORITY_FORMAT, { ...chainNext(out.at(-1) ?? null), acceptedAt: '2026-11-22T10:00:00.000Z', entry }));
  }
  return out;
}
const pos = (r: Rec) => ({ sequence: r.sequence, journalId: r.journalId, digest: r.digest });
const TAIL: ChainedTail = { offset: 9, bytes: new Uint8Array([1, 2, 3]), sha256: 'a'.repeat(64), code: 'torn-tail' };

const designate = (term: number, sessionId: string, generation = GEN): E => ({ kind: 'authority-designate', opKey: `d${term}`, term, sessionId, generation });
const retire = (term: number, previousSessionId: string): E => ({ kind: 'authority-retire', opKey: `r${term}`, term, previousSessionId });
const rungTo = (from: string, to: string): E => ({ kind: 'authority-rung', opKey: `g-${to}`, from, to } as E);
const confirmRec = (o: { term: number; epochAtConfirm: number; restoreGeneration: number }): E => ({
  kind: 'authority-restore-confirmed', opKey: 'c', ...o, privacySequenceAtConfirm: null, newChain: false,
  binding: { kind: 'cleared' }, operatorRung: 'chat', latches: [], accountSet: { pools: [], untagged: false }, modelClass: 'opus',
});

// ---------- restoreStricter ----------

export function restoreStricterCases(m: Pick<Restore, 'restoreStricter'>): Record<string, SuiteCase> {
  const both = (db: RestoreSide, j: RestoreSide) => [m.restoreStricter(db, j), m.restoreStricter(j, db)] as const;
  return {
    'the binding is kept only when both sides bind the same session, with the row\'s generation': () => {
      const r = m.restoreStricter(side({ binding: { sessionId: S1, generation: GEN } }), side({ binding: { sessionId: S1, generation: GEN2 } }));
      expect(r.binding).toEqual({ kind: 'kept', sessionId: S1, generation: GEN });
      expect(r.pastIdsJoin).toEqual([]);
    },
    'another session or none on either side clears the binding, and both ids join the past ids': () => {
      const r = m.restoreStricter(side({ binding: { sessionId: S1, generation: GEN } }), side({ binding: { sessionId: S2, generation: GEN2 } }));
      expect(r.binding).toEqual({ kind: 'cleared' });
      expect(r.pastIdsJoin).toEqual([S1, S2]);
      for (const x of both(side({ binding: { sessionId: S1, generation: GEN } }), side({}))) {
        expect(x.binding).toEqual({ kind: 'cleared' });
        expect(x.pastIdsJoin).toEqual([S1]);
      }
      expect(m.restoreStricter(side({}), side({})).pastIdsJoin).toEqual([]);
    },
    'the term is the higher of the two, plus one, either way round; an absent side counts 0': () => {
      for (const x of both(side({ term: 4 }), side({ term: 7 }))) expect(x.term).toBe(8);
      expect(m.restoreStricter(NARROW, side({ term: 3 })).term).toBe(4);
      expect(m.restoreStricter(NARROW, NARROW).term).toBe(1);
    },
    'the rung is the lower of the two, either way round; an absent side reads off': () => {
      for (const x of both(side({ operatorRung: 'full' }), side({ operatorRung: 'advise' }))) expect(x.operatorRung).toBe('advise');
      for (const x of both(side({ operatorRung: 'chat' }), side({ operatorRung: 'full' }))) expect(x.operatorRung).toBe('chat');
      expect(m.restoreStricter(NARROW, side({ operatorRung: 'full' })).operatorRung).toBe('off');
    },
    'latches are the union, each cause at the lower cap, sorted by cause': () => {
      for (const x of both(
        side({ latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'zeta-cause', cap: 'advise' }] }),
        side({ latches: [{ cause: 'alpha-cause', cap: 'advise' }, { cause: 'zeta-cause', cap: 'off' }] }),
      )) {
        expect(x.latches).toEqual([
          { cause: 'alpha-cause', cap: 'advise' }, { cause: 'restore-detected', cap: 'chat' }, { cause: 'zeta-cause', cap: 'off' },
        ]);
      }
    },
    'the account set is the intersection, sorted, and untagged only when both hold it': () => {
      for (const x of both(side({ accountSet: { pools: ['pool-c', 'pool-a', 'pool-b'], untagged: true } }), side({ accountSet: { pools: ['pool-b', 'pool-c'], untagged: false } }))) {
        expect(x.accountSet).toEqual({ pools: ['pool-b', 'pool-c'], untagged: false });
      }
      expect(m.restoreStricter(side({ accountSet: { pools: ['pool-a'], untagged: true } }), side({ accountSet: { pools: ['pool-a'], untagged: true } })).accountSet)
        .toEqual({ pools: ['pool-a'], untagged: true });
      expect(m.restoreStricter(NARROW, side({ accountSet: { pools: ['pool-a'], untagged: true } })).accountSet).toEqual({ pools: [], untagged: false });
    },
    'the model class is opus unless both read fable': () => {
      for (const x of both(side({ modelClass: 'fable' }), side({ modelClass: 'opus' }))) expect(x.modelClass).toBe('opus');
      expect(m.restoreStricter(side({ modelClass: 'fable' }), side({ modelClass: 'fable' })).modelClass).toBe('fable');
      expect(m.restoreStricter(NARROW, side({ modelClass: 'fable' })).modelClass).toBe('opus');
    },
  };
}

const STRICTER_SET: MutantSet<Restore> = {
  modulePath: RESTORE_TS,
  mutants: [
    { id: 'S1 keep any binding', old: 'const kept = db.binding !== null && journal.binding !== null && journal.binding.sessionId === db.binding.sessionId;', new: 'const kept = db.binding !== null;' },
    { id: 'S2 term not raised', old: 'term: Math.max(db.term, journal.term) + 1,', new: 'term: Math.max(db.term, journal.term),' },
    { id: 'S3 the higher rung', old: 'const lower = (a: Rung, b: Rung): Rung => (rungRank(a) <= rungRank(b) ? a : b);', new: 'const lower = (a: Rung, b: Rung): Rung => (rungRank(a) >= rungRank(b) ? a : b);' },
    { id: 'S4 union of pools', old: 'pools: db.accountSet.pools.filter((p) => journal.accountSet.pools.includes(p)).sort(),', new: 'pools: [...new Set([...db.accountSet.pools, ...journal.accountSet.pools])].sort(),' },
    { id: 'S5 untagged either', old: 'untagged: db.accountSet.untagged && journal.accountSet.untagged,', new: 'untagged: db.accountSet.untagged || journal.accountSet.untagged,' },
    { id: 'S6 fable either', old: "modelClass: db.modelClass === 'fable' && journal.modelClass === 'fable' ? 'fable' : 'opus',", new: "modelClass: db.modelClass === 'fable' || journal.modelClass === 'fable' ? 'fable' : 'opus'," },
    { id: 'S7 the journal\'s latches only', old: 'for (const l of [...db.latches, ...journal.latches]) {', new: 'for (const l of [...journal.latches]) {' },
    { id: 'S8 the latest cap', old: 'caps.set(l.cause, had === undefined ? l.cap : lower(had, l.cap));', new: 'caps.set(l.cause, l.cap);' },
    { id: 'S9 no past ids', old: 'if (!kept) {', new: 'if (false) {' },
  ],
  suite: (mod) => restoreStricterCases(mod),
};

// ---------- confirmRestorePlan ----------

const DB = side({ binding: { sessionId: S1, generation: GEN }, term: 1, operatorRung: 'full', modelClass: 'fable', accountSet: { pools: ['pool-a'], untagged: true } });
function facts(o: Partial<ConfirmFacts>): ConfirmFacts {
  return {
    guard: { kind: 'rolled-back', cause: 'behind' }, file: { kind: 'absent' }, rows: { kind: 'measured', head: null, anyAuthorityRow: true },
    dbSide: DB, epoch: { kind: 'measured', n: 0 }, privacy: { kind: 'measured', sequence: null },
    witnesses: { kind: 'measured', epoch: 0, restoreGeneration: 0 }, opKey: 'op-confirm', ...o,
  };
}

export function confirmRestorePlanCases(m: Pick<Restore, 'confirmRestorePlan'>): Record<string, SuiteCase> {
  const A = chain([designate(1, S1), rungTo('chat', 'full')]);
  const coherent = { file: { kind: 'records' as const, records: A, tail: null }, rows: { kind: 'measured' as const, head: pos(A[1]!), anyAuthorityRow: true } };
  const refuse = (f: ConfirmFacts): string => { const p = m.confirmRestorePlan(f); return p.kind === 'refuse' ? 'refuse' : p.kind; };
  return {
    'an unmeasured guard, file, head row or rows side refuses and writes nothing': () => {
      expect(refuse(facts({ guard: { kind: 'unmeasured', why: 'journal' } }))).toBe('refuse');
      expect(refuse(facts({ file: { kind: 'unmeasured', why: 'unreadable' } }))).toBe('refuse');
      expect(refuse(facts({ rows: { kind: 'unmeasured' } }))).toBe('refuse');
      expect(refuse(facts({ dbSide: { kind: 'unmeasured', why: 'x' } }))).toBe('refuse');
    },
    'an unmeasured epoch, privacy head or witness refuses once something waits': () => {
      expect(refuse(facts({ ...coherent, guard: { kind: 'rolled-back', cause: 'witness-epoch' }, epoch: { kind: 'unmeasured', why: 'x' } }))).toBe('refuse');
      expect(refuse(facts({ ...coherent, guard: { kind: 'rolled-back', cause: 'witness-epoch' }, privacy: { kind: 'unmeasured', why: 'x' } }))).toBe('refuse');
      expect(refuse(facts({ ...coherent, guard: { kind: 'rolled-back', cause: 'witness-epoch' }, witnesses: { kind: 'unmeasured', why: 'x' } }))).toBe('refuse');
    },
    'a coherent guard over a coherent file is unchanged: nothing waits': () => {
      expect(m.confirmRestorePlan(facts({ ...coherent, guard: { kind: 'coherent' } }))).toEqual({ kind: 'unchanged' });
      expect(m.confirmRestorePlan(facts({ guard: { kind: 'coherent' }, rows: { kind: 'measured', head: null, anyAuthorityRow: false } }))).toEqual({ kind: 'unchanged' });
    },
    'a coherent guard over a trailing file waits (review F1), and a rolled-back guard over a coherent file waits': () => {
      const trailing = { ...coherent, rows: { kind: 'measured' as const, head: pos(A[0]!), anyAuthorityRow: true } };
      const p = m.confirmRestorePlan(facts({ ...trailing, guard: { kind: 'coherent' } }));
      expect(p.kind).toBe('confirm');
      expect(m.confirmRestorePlan(facts({ ...coherent, guard: { kind: 'rolled-back', cause: 'witness-heads' } })).kind).toBe('confirm');
    },
    'a trailing record is folded into the journal side: a widening is not applied, a narrowing is': () => {
      const widened = chain([designate(1, S1), rungTo('chat', 'advise'), rungTo('advise', 'full')]);
      const pw = m.confirmRestorePlan(facts({
        file: { kind: 'records', records: widened, tail: null }, rows: { kind: 'measured', head: pos(widened[1]!), anyAuthorityRow: true },
        dbSide: side({ ...DB, operatorRung: 'advise' }),
      }));
      expect(pw.kind === 'confirm' && pw.entry.operatorRung).toBe('advise');
      const narrowed = chain([designate(1, S1), rungTo('chat', 'advise'), rungTo('advise', 'chat')]);
      const pn = m.confirmRestorePlan(facts({
        file: { kind: 'records', records: narrowed, tail: null }, rows: { kind: 'measured', head: pos(narrowed[1]!), anyAuthorityRow: true },
        dbSide: side({ ...DB, operatorRung: 'advise' }),
      }));
      expect(pn.kind === 'confirm' && pn.entry.operatorRung).toBe('chat');
      expect(pn.kind === 'confirm' && pn.expectHead).toEqual(pos(narrowed[2]!));
      expect(pn.kind === 'confirm' && pn.cutWhole).toBe(false);
    },
    'a later retire in the journal clears the row\'s binding': () => {
      const R = chain([designate(1, S1), retire(2, S1)]);
      const p = m.confirmRestorePlan(facts({ file: { kind: 'records', records: R, tail: null }, rows: { kind: 'measured', head: pos(R[0]!), anyAuthorityRow: true } }));
      expect(p.kind).toBe('confirm');
      if (p.kind !== 'confirm') return;
      expect(p.entry.binding).toEqual({ kind: 'cleared' });
      expect(p.stricter.pastIdsJoin).toEqual([S1]);
      expect(p.entry.term).toBe(3);
    },
    'the epoch is above the server\'s and every witness\'s; the generation above the journal\'s last and every witness\'s': () => {
      const C = chain([designate(1, S1), confirmRec({ term: 2, epochAtConfirm: 5, restoreGeneration: 2 }), rungTo('chat', 'advise')]);
      const base = { file: { kind: 'records' as const, records: C, tail: null }, rows: { kind: 'measured' as const, head: pos(C[1]!), anyAuthorityRow: true } };
      const own = m.confirmRestorePlan(facts({ ...base, epoch: { kind: 'measured', n: 6 } }));
      expect(own.kind === 'confirm' && [own.entry.epochAtConfirm, own.entry.restoreGeneration]).toEqual([7, 3]);
      const witnessed = m.confirmRestorePlan(facts({ ...base, epoch: { kind: 'measured', n: 6 }, witnesses: { kind: 'measured', epoch: 11, restoreGeneration: 4 } }));
      expect(witnessed.kind === 'confirm' && [witnessed.entry.epochAtConfirm, witnessed.entry.restoreGeneration]).toEqual([12, 5]);
      expect(witnessed.kind === 'confirm' && witnessed.entry.newChain).toBe(false);
    },
    'the record carries the privacy sequence, the op key and the stricter values': () => {
      const p = m.confirmRestorePlan(facts({ privacy: { kind: 'measured', sequence: 9 } }));
      expect(p.kind).toBe('confirm');
      if (p.kind !== 'confirm') return;
      expect(p.entry).toMatchObject({ kind: 'authority-restore-confirmed', opKey: 'op-confirm', privacySequenceAtConfirm: 9, newChain: true, term: 2 });
      expect(p.entry.operatorRung).toBe('off');
      expect(p.expectHead).toBeNull();
    },
    'a malformed file is cut whole, read as the narrowest side, and bounded by its lines and the head row': () => {
      const p = m.confirmRestorePlan(facts({
        file: { kind: 'malformed', code: 'bad-chain', detail: 'x', lines: 6 }, rows: { kind: 'measured', head: pos(A[1]!), anyAuthorityRow: true },
        epoch: { kind: 'unmeasured', why: 'the file cannot be folded' }, witnesses: { kind: 'measured', epoch: 3, restoreGeneration: 2 },
      }));
      expect(p.kind).toBe('confirm');
      if (p.kind !== 'confirm') return;
      expect(p.cutWhole).toBe(true);
      expect(p.expectHead).toBeNull();
      expect(p.entry).toMatchObject({ newChain: true, epochAtConfirm: 7, restoreGeneration: 7, operatorRung: 'off', modelClass: 'opus' });
      expect(p.entry.binding).toEqual({ kind: 'cleared' });
      expect(p.entry.accountSet).toEqual({ pools: [], untagged: false });
      const above = m.confirmRestorePlan(facts({ file: { kind: 'malformed', code: 'bad-chain', detail: 'x', lines: 2 }, witnesses: { kind: 'measured', epoch: 20, restoreGeneration: 9 } }));
      expect(above.kind === 'confirm' && [above.entry.epochAtConfirm, above.entry.restoreGeneration]).toEqual([21, 10]);
    },
    'a record behind a torn tail the heal refused is cut whole, bounded by the records plus the tail and what they carried': () => {
      const C = chain([designate(1, S1), confirmRec({ term: 2, epochAtConfirm: 30, restoreGeneration: 12 })]);
      const p = m.confirmRestorePlan(facts({ file: { kind: 'records', records: C, tail: TAIL }, rows: { kind: 'measured', head: pos(C[0]!), anyAuthorityRow: true } }));
      expect(p.kind).toBe('confirm');
      if (p.kind !== 'confirm') return;
      expect(p.cutWhole).toBe(true);
      expect(p.entry).toMatchObject({ newChain: true, epochAtConfirm: 31, restoreGeneration: 31 });
      const bare = chain([designate(1, S1)]);
      const q = m.confirmRestorePlan(facts({ file: { kind: 'records', records: bare, tail: TAIL }, rows: { kind: 'measured', head: null, anyAuthorityRow: true } }));
      expect(q.kind === 'confirm' && [q.entry.epochAtConfirm, q.entry.restoreGeneration]).toEqual([3, 3]);
    },
  };
}

const PLAN_SET: MutantSet<Restore> = {
  modulePath: RESTORE_TS,
  mutants: [
    { id: 'P1 nothing waits from the guard alone', old: "if (f.guard.kind === 'coherent' && verdict.kind === 'coherent') return { kind: 'unchanged' };", new: "if (f.guard.kind === 'coherent') return { kind: 'unchanged' };" },
    { id: 'P2 epoch at the server\'s own', old: 'epochAtConfirm: Math.max(epochBase, f.witnesses.epoch) + 1,', new: 'epochAtConfirm: epochBase + 1,' },
    { id: 'P3 witnesses\' generation ignored', old: 'restoreGeneration: Math.max(generationBase, f.witnesses.restoreGeneration) + 1,', new: 'restoreGeneration: generationBase + 1,' },
    { id: 'P4 an unmeasured guard proceeds', old: "if (f.guard.kind === 'unmeasured') return { kind: 'refuse', detail: `the authority guard reads unmeasured: ${f.guard.why}` };", new: '' },
    { id: 'P5 an unmeasured epoch proceeds', old: "if (f.epoch.kind === 'unmeasured') return { kind: 'refuse', detail: `the authority epoch could not be read: ${f.epoch.why}` };", new: "if (f.epoch.kind === 'unmeasured') return { kind: 'unchanged' };" },
    { id: 'P6 a tail is not cut', old: "const cutWhole = f.file.kind === 'malformed' || (f.file.kind === 'records' && f.file.tail !== null);", new: "const cutWhole = f.file.kind === 'malformed';" },
    { id: 'P7 no line bound', old: "if (f.file.kind === 'malformed') lines = Math.max(lines, f.file.lines);", new: '' },
    { id: 'P8 the journal\'s fold over a malformed file', old: '    journalSide = NARROWEST_RESTORE_SIDE;\n    expectHead = null;', new: '    journalSide = { ...NARROWEST_RESTORE_SIDE, operatorRung: \'full\', modelClass: \'fable\', accountSet: { pools: [\'pool-a\'], untagged: true } };\n    expectHead = null;' },
    { id: 'P9 the journal\'s generation ignored', old: 'generationBase = view.lastConfirm === null ? 0 : view.lastConfirm.restoreGeneration;', new: 'generationBase = 0;' },
    { id: 'P10 the carried bound ignored', old: 'epochBase = Math.max(lines, carried);', new: 'epochBase = lines;' },
    { id: 'P11 an unmeasured witness proceeds', old: "if (f.witnesses.kind === 'unmeasured') return { kind: 'refuse', detail: `the witnesses could not be read: ${f.witnesses.why}` };", new: "if (f.witnesses.kind === 'unmeasured') return { kind: 'unchanged' };" },
  ],
  suite: (mod) => confirmRestorePlanCases(mod),
};

export const OVERLORD_RESTORE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [RESTORE_STRICTER_KEY]: STRICTER_SET as MutantSet<never>,
  [CONFIRM_PLAN_KEY]: PLAN_SET as MutantSet<never>,
};
