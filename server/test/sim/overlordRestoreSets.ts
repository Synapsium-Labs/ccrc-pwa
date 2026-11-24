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
    { id: 'S8 the latest cap', old: '...journal.latches]) {\n    const had = caps.get(l.cause);\n    caps.set(l.cause, had === undefined ? l.cap : lower(had, l.cap));', new: '...journal.latches]) {\n    const had = caps.get(l.cause);\n    caps.set(l.cause, l.cap);' },
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
    witnesses: { kind: 'measured', epoch: 0, restoreGeneration: 0 }, told: { kind: 'measured', told: null }, opKey: 'op-confirm', ...o,
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
      expect(refuse(facts({ ...coherent, guard: { kind: 'rolled-back', cause: 'witness-epoch' }, told: { kind: 'unmeasured', why: 'x' } }))).toBe('refuse');
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
      expect(pn.kind === 'confirm' && pn.cutTail).toBeNull();
    },
    'a told state narrows the rung and joins its latches at the lower cap; null changes nothing (told-narrowings-survive-confirm)': () => {
      const AF = chain([designate(1, S1), rungTo('chat', 'full')]);
      const base = { file: { kind: 'records' as const, records: AF, tail: null }, rows: { kind: 'measured' as const, head: pos(AF[1]!), anyAuthorityRow: true },
        dbSide: side({ ...DB, latches: [{ cause: 'restore-detected', cap: 'chat' }] }) };
      const told = m.confirmRestorePlan(facts({ ...base, told: { kind: 'measured', told: { operatorRung: 'advise', latches: [{ cause: 'alpha-cause', cap: 'off' }, { cause: 'restore-detected', cap: 'off' }] } } }));
      expect(told.kind === 'confirm' && told.entry.operatorRung).toBe('advise');
      expect(told.kind === 'confirm' && told.entry.latches).toEqual([{ cause: 'alpha-cause', cap: 'off' }, { cause: 'restore-detected', cap: 'off' }]);
      const wider = m.confirmRestorePlan(facts({ ...base, dbSide: side({ ...base.dbSide, operatorRung: 'advise' }),
        told: { kind: 'measured', told: { operatorRung: 'full', latches: [{ cause: 'restore-detected', cap: 'advise' }] } } }));
      expect(wider.kind === 'confirm' && [wider.entry.operatorRung, wider.entry.latches]).toEqual(['advise', [{ cause: 'restore-detected', cap: 'chat' }]]);
      const none = m.confirmRestorePlan(facts({ ...base, told: { kind: 'measured', told: { operatorRung: null, latches: [] } } }));
      expect(none.kind === 'confirm' && none.entry.operatorRung).toBe('full');
      const nul = m.confirmRestorePlan(facts(base));
      expect(nul.kind === 'confirm' && [nul.entry.operatorRung, nul.entry.latches]).toEqual(['full', [{ cause: 'restore-detected', cap: 'chat' }]]);
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
    'a malformed file refuses, whatever a witness holds: its lines bound its sequences, not the values it issued (review 3334 F2)': () => {
      for (const head of [pos(A[1]!), null]) {
        const p = m.confirmRestorePlan(facts({
          file: { kind: 'malformed', code: 'bad-chain', detail: 'x', lines: 6 }, rows: { kind: 'measured', head, anyAuthorityRow: true },
          witnesses: { kind: 'measured', epoch: 20, restoreGeneration: 9 },
        }));
        expect(p).toEqual({ kind: 'refuse', detail: expect.stringContaining('malformed') });
      }
    },
    'records that do not reach the head row refuse, a high witness or not: missing, behind and diverged (review 3334 F1)': () => {
      const high = { kind: 'measured' as const, epoch: 50, restoreGeneration: 9 };
      const other = chain([designate(1, S2), rungTo('chat', 'advise')]);
      const lost = [
        { kind: 'absent' as const },
        { kind: 'records' as const, records: A.slice(0, 1), tail: null },
        { kind: 'records' as const, records: other, tail: null },
      ];
      for (const file of lost) {
        for (const witnesses of [facts({}).witnesses, high]) {
          const p = m.confirmRestorePlan(facts({ file, rows: { kind: 'measured', head: pos(A[1]!), anyAuthorityRow: true }, witnesses }));
          expect(p).toEqual({ kind: 'refuse', detail: expect.stringContaining('head row attests') });
        }
      }
    },
    'a torn tail after records that reach the head row is set aside, never the file; the journal side is the records\' fold': () => {
      const C = chain([designate(1, S1), confirmRec({ term: 2, epochAtConfirm: 30, restoreGeneration: 12 })]);
      const p = m.confirmRestorePlan(facts({
        file: { kind: 'records', records: C, tail: TAIL }, rows: { kind: 'measured', head: pos(C[0]!), anyAuthorityRow: true },
        epoch: { kind: 'measured', n: 30 },
      }));
      expect(p.kind).toBe('confirm');
      if (p.kind !== 'confirm') return;
      expect(p.cutTail).toEqual({ offset: 9, bytes: 3, sha256: 'a'.repeat(64), code: 'torn-tail', name: `9-${'a'.repeat(64)}.tail` });
      expect(p.expectHead).toEqual(pos(C[1]!));
      expect(p.entry).toMatchObject({ newChain: false, epochAtConfirm: 31, restoreGeneration: 13, operatorRung: 'chat', term: 3 });
      const behind = m.confirmRestorePlan(facts({
        file: { kind: 'records', records: C.slice(0, 1), tail: TAIL }, rows: { kind: 'measured', head: pos(C[1]!), anyAuthorityRow: true },
      }));
      expect(behind.kind).toBe('refuse');
    },
  };
}

const PLAN_SET: MutantSet<Restore> = {
  modulePath: RESTORE_TS,
  mutants: [
    { id: 'P1 nothing waits from the guard alone', old: "if (f.guard.kind === 'coherent' && verdict.kind === 'coherent') return { kind: 'unchanged' };", new: "if (f.guard.kind === 'coherent') return { kind: 'unchanged' };" },
    { id: 'P2 epoch at the server\'s own', old: 'epochAtConfirm: Math.max(f.epoch.n, f.witnesses.epoch) + 1,', new: 'epochAtConfirm: f.epoch.n + 1,' },
    { id: 'P3 witnesses\' generation ignored', old: 'restoreGeneration: Math.max(generationBase, f.witnesses.restoreGeneration) + 1,', new: 'restoreGeneration: generationBase + 1,' },
    { id: 'P4 an unmeasured guard proceeds', old: "if (f.guard.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.guard };", new: '' },
    { id: 'P5 an unmeasured epoch proceeds', old: "if (f.epoch.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.epoch };", new: "if (f.epoch.kind === 'unmeasured') return { kind: 'unchanged' };" },
    { id: 'P6 a torn tail is left for the append', old: "const cutTail = f.file.kind === 'records' ? chainedTailHealPlan(f.file.tail, true) : null;", new: 'const cutTail = null;' },
    { id: 'P7 a malformed file proceeds', old: "if (f.file.kind === 'malformed') return { kind: 'refuse', detail: CONFIRM_REFUSED.malformed };", new: '' },
    { id: 'P8 lost records proceed', old: "if (head !== null && (atHead === undefined || !samePosition(atHead, head))) return { kind: 'refuse', detail: CONFIRM_REFUSED.lost };", new: '' },
    { id: 'P9 the journal\'s generation ignored', old: 'const generationBase = view.lastConfirm === null ? 0 : view.lastConfirm.restoreGeneration;', new: 'const generationBase = 0;' },
    { id: 'P10 a diverged head reads as reached', old: '(atHead === undefined || !samePosition(atHead, head))', new: '(atHead === undefined)' },
    { id: 'P11 an unmeasured witness proceeds', old: "if (f.witnesses.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.witnesses };", new: "if (f.witnesses.kind === 'unmeasured') return { kind: 'unchanged' };" },
    { id: 'P12 told ignored', old: 'const stricter = toldNarrowed(restoreStricter(f.dbSide, journalSideOf(view)), f.told.told);', new: 'const stricter = restoreStricter(f.dbSide, journalSideOf(view));' },
    { id: 'P13 told widens the rung', old: 'operatorRung: told.operatorRung === null ? s.operatorRung : lower(s.operatorRung, told.operatorRung),', new: 'operatorRung: told.operatorRung === null ? s.operatorRung : told.operatorRung,' },
    { id: 'P14 told latches replace', old: 'caps.set(l.cause, had === undefined ? l.cap : lower(had, l.cap));\n  }\n  return {\n    ...s,', new: 'caps.set(l.cause, l.cap);\n  }\n  return {\n    ...s,' },
    { id: 'P15 an unmeasured told proceeds', old: "if (f.told.kind === 'unmeasured') return { kind: 'refuse', detail: CONFIRM_REFUSED.told };", new: "if (f.told.kind === 'unmeasured') return { kind: 'unchanged' };" },
    { id: 'P16 every record starts a new chain', old: 'newChain: expectHead === null,', new: 'newChain: true,' },
  ],
  suite: (mod) => confirmRestorePlanCases(mod),
};

export const OVERLORD_RESTORE_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [RESTORE_STRICTER_KEY]: STRICTER_SET as MutantSet<never>,
  [CONFIRM_PLAN_KEY]: PLAN_SET as MutantSet<never>,
};
