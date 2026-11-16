// Overlord W1, authority journal plan Tasks 3 and 4 (PR A; the floors rule is D-8217's): the mutant sets of the Overlord authority
// journal's L1 deciders, the grammar's `authorityEntry`, `authorityDirection`, `authorityFold`, `authorityCoherence` and
// `authorityTailHeal`, each run against suite cases over a module. Registered in mutation-floors.test.ts's MUTANT_SETS, with a
// floor each in mutation-floors.json. The expected words are written out, never read from the code the cases judge.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { buildChainedRecord, chainNext, type ChainedJournalRecord, type ChainedPosition, type ChainedTail } from '../../src/chainedJournal.js';
import { OVERLORD_AUTHORITY_FORMAT, type OverlordAuthorityEntry } from '../../src/coord/overlordAuthority.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const GRAMMAR_TS = path.join(ROOT, 'server/src/coord/overlordAuthority.ts');
const COHERENCE_TS = path.join(ROOT, 'server/src/coord/overlordAuthorityCoherence.ts');

type Grammar = typeof import('../../src/coord/overlordAuthority.js');
type Coherence = typeof import('../../src/coord/overlordAuthorityCoherence.js');

export const AUTHORITY_ENTRY_KEY = 'server/src/coord/overlordAuthority.ts#authorityEntry';
export const AUTHORITY_DIRECTION_KEY = 'server/src/coord/overlordAuthority.ts#authorityDirection';
export const AUTHORITY_FOLD_KEY = 'server/src/coord/overlordAuthority.ts#authorityFold';
export const AUTHORITY_COHERENCE_KEY = 'server/src/coord/overlordAuthorityCoherence.ts#authorityCoherence';
export const AUTHORITY_HEAL_KEY = 'server/src/coord/overlordAuthorityCoherence.ts#authorityTailHeal';

type E = OverlordAuthorityEntry;
type Rec = ChainedJournalRecord<E>;
const GEN = '0f0e0d0c-0b0a-4908-8706-050403020100';
const rung = (from: string, to: string): E => ({ kind: 'authority-rung', opKey: 'op-r', from, to } as E);
const CONFIRM = {
  kind: 'authority-restore-confirmed', opKey: 'op-c', term: 4, epochAtConfirm: 7, privacySequenceAtConfirm: null, restoreGeneration: 1,
  newChain: false, binding: { kind: 'kept', sessionId: 'lane-a-project-a', generation: GEN }, operatorRung: 'advise',
  latches: [{ cause: 'restore-detected', cap: 'chat' }], accountSet: { pools: ['pool-a'], untagged: false }, modelClass: 'opus',
} as const;
/** Records chained from 1, built through the real kernel and the real format (the sets mutate the decider, not the format). */
function chain(entries: readonly E[]): Rec[] {
  const out: Rec[] = [];
  for (const entry of entries) {
    out.push(buildChainedRecord(OVERLORD_AUTHORITY_FORMAT, { ...chainNext(out.at(-1) ?? null), acceptedAt: '2026-11-16T10:00:00.000Z', entry }));
  }
  return out;
}

// ---------- authorityEntry: the grammar ----------

export function authorityEntryCases(m: Pick<Grammar, 'authorityEntry' | 'OverlordAuthorityError'>): Record<string, SuiteCase> {
  const refused = (raw: unknown): string => {
    try { m.authorityEntry(raw); } catch (err) { return err instanceof m.OverlordAuthorityError ? err.code : `other: ${String(err)}`; }
    return 'accepted';
  };
  const designate = { kind: 'authority-designate', opKey: 'op-1', term: 1, sessionId: 'lane-a-project-a', generation: GEN };
  const set = { kind: 'authority-account-set', opKey: 'op-2', from: { pools: ['pool-a', 'pool-b'], untagged: true }, to: { pools: ['pool-a'], untagged: false } };
  return {
    'a well-formed designate, account set and Confirm are accepted as given': () => {
      expect(m.authorityEntry(designate)).toEqual(designate);
      expect(m.authorityEntry(set)).toEqual(set);
      expect(m.authorityEntry(CONFIRM)).toEqual(CONFIRM);
    },
    'a kind of another journal is refused as this grammar\'s own refusal': () => {
      expect(refused({ ...designate, kind: 'lease-carrier-seen' })).toBe('bad-field');
    },
    'an unknown key is refused': () => { expect(refused({ ...designate, extra: 1 })).toBe('unknown-key'); },
    'a token with a space is refused': () => { expect(refused({ ...designate, opKey: 'op 1' })).toBe('bad-field'); },
    'a numeric generation is refused (X2)': () => { expect(refused({ ...designate, generation: 3 })).toBe('bad-field'); },
    'a term of 0 is refused': () => { expect(refused({ ...designate, term: 0 })).toBe('bad-field'); },
    'unsorted pools are refused': () => { expect(refused({ ...set, to: { pools: ['pool-b', 'pool-a'], untagged: false } })).toBe('bad-field'); },
    'one cause twice in a Confirm is refused': () => {
      expect(refused({ ...CONFIRM, latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'restore-detected', cap: 'off' }] })).toBe('bad-field');
    },
    'a cause that is not a kebab word is refused': () => {
      expect(refused({ kind: 'authority-latch-clear', opKey: 'op-3', cause: 'Restore_Detected' })).toBe('bad-field');
    },
    'a binding of another kind is refused, even with the kept fields': () => {
      expect(refused({ ...CONFIRM, binding: { kind: 'gone', sessionId: 'lane-a-project-a', generation: GEN } })).toBe('bad-field');
    },
  };
}

const ENTRY_SET: MutantSet<Grammar> = {
  modulePath: GRAMMAR_TS,
  mutants: [
    { id: 'E1 any kind', old: "if (typeof k !== 'string' || !Object.hasOwn(OVERLORD_AUTHORITY_KINDS, k)) {", new: "if (typeof k !== 'string') {" },
    { id: 'E2 no exact keys', old: 'exactKeys(raw, KEYS[kind], `an ${kind} entry`);', new: ';' },
    { id: 'E3 space in a token', old: 'const TOKEN_RE = /^[\\x21-\\x7e]{1,128}$/;', new: 'const TOKEN_RE = /^[\\x20-\\x7e]{1,128}$/;' },
    { id: 'E4 unsorted pools', old: 'if (out.length > 0 && !(out[out.length - 1]! < p))', new: 'if (false)' },
    { id: 'E5 a cause twice', old: "if (out.length > 0 && !(out[out.length - 1]!.cause < pair.cause)) return refuse", new: 'if (out.length > 0 && out[out.length - 1]!.cause > pair.cause) return refuse' },
    { id: 'E6 term 0', old: 'Number.isSafeInteger(v) && v >= 1 ? v', new: 'Number.isSafeInteger(v) && v >= 0 ? v' },
    { id: 'E7 a number as a token', old: "typeof v === 'string' && TOKEN_RE.test(v) ? v", new: 'TOKEN_RE.test(String(v)) ? v' },
    { id: 'E8 any cause', old: 'v.length <= CAUSE_MAX && CAUSE_RE.test(v)', new: 'v.length <= CAUSE_MAX' },
    { id: 'E9 any binding kind', old: "if (v['kind'] !== 'kept') return refuse", new: 'if (false) return refuse' },
    { id: 'E10 privacy null refused', old: "p === null ? null : countInt(p, 'privacySequenceAtConfirm')", new: "countInt(p, 'privacySequenceAtConfirm')" },
  ],
  suite: (mod) => authorityEntryCases(mod),
};

// ---------- authorityDirection ----------

export function authorityDirectionCases(m: Pick<Grammar, 'authorityDirection'>): Record<string, SuiteCase> {
  const d = (e: unknown): string => m.authorityDirection(e as never);
  const set = (from: [string[], boolean], to: [string[], boolean]) =>
    ({ kind: 'authority-account-set', opKey: 'k', from: { pools: from[0], untagged: from[1] }, to: { pools: to[0], untagged: to[1] } });
  return {
    'a binding widens and a retire narrows': () => {
      expect(d({ kind: 'authority-designate' })).toBe('widens');
      expect(d({ kind: 'authority-rebind' })).toBe('widens');
      expect(d({ kind: 'authority-retire' })).toBe('narrows');
    },
    'a latch raise narrows and a clear widens': () => {
      expect(d({ kind: 'authority-latch-raise' })).toBe('narrows');
      expect(d({ kind: 'authority-latch-clear' })).toBe('widens');
    },
    'a rung up widens; down or the same narrows': () => {
      expect(d(rung('advise', 'full'))).toBe('widens');
      expect(d(rung('full', 'advise'))).toBe('narrows');
      expect(d(rung('chat', 'chat'))).toBe('narrows');
    },
    'an account set within its from narrows; a new pool or untagged widens': () => {
      expect(d(set([['pool-a', 'pool-b'], true], [['pool-a'], false]))).toBe('narrows');
      expect(d(set([['pool-a'], false], [['pool-a', 'pool-b'], false]))).toBe('widens');
      expect(d(set([['pool-a'], false], [['pool-a'], true]))).toBe('widens');
    },
    'a model class widens to fable only': () => {
      expect(d({ kind: 'authority-model-class', from: 'opus', to: 'fable' })).toBe('widens');
      expect(d({ kind: 'authority-model-class', from: 'fable', to: 'opus' })).toBe('narrows');
      expect(d({ kind: 'authority-model-class', from: 'fable', to: 'fable' })).toBe('widens');
    },
  };
}

const DIRECTION_SET: MutantSet<Grammar> = {
  modulePath: GRAMMAR_TS,
  mutants: [
    { id: 'D1 same rung widens', old: "rank(entry.to) > rank(entry.from) ? 'widens' : 'narrows'", new: "rank(entry.to) >= rank(entry.from) ? 'widens' : 'narrows'" },
    { id: 'D2 a clear narrows', old: "case 'authority-rebind': case 'authority-latch-clear': return 'widens';", new: "case 'authority-rebind': return 'widens'; case 'authority-latch-clear': return 'narrows';" },
    { id: 'D3 a retire widens', old: "case 'authority-retire': case 'authority-latch-raise': return 'narrows';", new: "case 'authority-latch-raise': return 'narrows'; case 'authority-retire': return 'widens';" },
    { id: 'D4 untagged ignored', old: '(!to.untagged || from.untagged)', new: 'true' },
    { id: 'D5 within turned round', old: 'to.pools.every((p) => from.pools.includes(p))', new: 'from.pools.every((p) => to.pools.includes(p))' },
    { id: 'D6 a class change widens', old: "entry.to === 'fable' ? 'widens' : 'narrows'", new: "entry.to !== entry.from ? 'widens' : 'narrows'" },
  ],
  suite: (mod) => authorityDirectionCases(mod),
};

// ---------- authorityFold ----------

export function authorityFoldCases(m: Pick<Grammar, 'authorityFold'>): Record<string, SuiteCase> {
  const designate = { kind: 'authority-designate', opKey: 'op-1', term: 1, sessionId: 'lane-a-project-a', generation: GEN } as E;
  const raise = (cause: string, cap: string): E => ({ kind: 'authority-latch-raise', opKey: `op-${cause}-${cap}`, cause, cap } as E);
  return {
    'a retire leaves no binding and its term': () => {
      expect(m.authorityFold(chain([designate, { kind: 'authority-retire', opKey: 'op-2', term: 2, previousSessionId: 'lane-a-project-a' }])).designation)
        .toEqual({ term: 2, sessionId: null, generation: null });
    },
    'a rung record sets the rung to its to': () => { expect(m.authorityFold(chain([rung('full', 'chat')])).operatorRung).toBe('chat'); },
    'a second raise never raises the cap; a clear removes the latch': () => {
      expect([...m.authorityFold(chain([raise('restore-detected', 'off'), raise('restore-detected', 'advise')])).latches]).toEqual([['restore-detected', 'off']]);
      expect([...m.authorityFold(chain([raise('restore-detected', 'chat'), { kind: 'authority-latch-clear', opKey: 'op-x', cause: 'restore-detected' } as E])).latches]).toEqual([]);
    },
    'a Confirm sets every field and the latches to what it carries, and records lastConfirm': () => {
      const v = m.authorityFold(chain([raise('invariant-violation', 'advise'), rung('advise', 'full'), CONFIRM as unknown as E]));
      expect([...v.latches]).toEqual([['restore-detected', 'chat']]);
      expect(v.operatorRung).toBe('advise');
      expect(v.designation).toEqual({ term: 4, sessionId: 'lane-a-project-a', generation: GEN });
      expect(v.lastConfirm).toEqual({ sequence: 3, epochAtConfirm: 7, privacySequenceAtConfirm: null, restoreGeneration: 1 });
    },
    'a Confirm that cleared the binding leaves none': () => {
      expect(m.authorityFold(chain([designate, { ...CONFIRM, binding: { kind: 'cleared' } } as unknown as E])).designation)
        .toEqual({ term: 4, sessionId: null, generation: null });
    },
  };
}

const FOLD_SET: MutantSet<Grammar> = {
  modulePath: GRAMMAR_TS,
  mutants: [
    { id: 'F1 retire ignored', old: "case 'authority-retire': v.designation = { term: e.term, sessionId: null, generation: null }; break;", new: "case 'authority-retire': break;" },
    { id: 'F2 a raise raises the cap', old: 'had !== undefined && rank(had) < rank(e.cap) ? had : e.cap', new: 'e.cap' },
    { id: 'F3 clear ignored', old: "case 'authority-latch-clear': latchMap.delete(e.cause); break;", new: "case 'authority-latch-clear': break;" },
    { id: 'F4 latches kept past a Confirm', old: 'latchMap.clear();\n', new: '\n' },
    { id: 'F5 a Confirm always keeps the binding', old: "v.designation = e.binding.kind === 'kept'", new: 'v.designation = true' },
    { id: 'F6 lastConfirm has no sequence', old: 'sequence: r.sequence, epochAtConfirm', new: 'sequence: 0, epochAtConfirm' },
    { id: 'F7 the rung takes from', old: "case 'authority-rung': v.operatorRung = e.to; break;", new: "case 'authority-rung': v.operatorRung = e.from; break;" },
  ],
  suite: (mod) => authorityFoldCases(mod),
};

// ---------- authorityCoherence and authorityTailHeal ----------

const RUNG_WORDS = ['off', 'chat', 'advise', 'full'];
const forkChain = (n: number, fork: number): Rec[] => chain(Array.from({ length: n }, (_, i) => ({
  kind: 'authority-rung', opKey: `op-${fork}-${i}`, from: RUNG_WORDS[i % 4], to: RUNG_WORDS[(i + 1) % 4],
} as E)));
const pos = (r: Rec): ChainedPosition => ({ sequence: r.sequence, journalId: r.journalId, digest: r.digest });
const TAIL: ChainedTail = { offset: 9, bytes: new Uint8Array([123]), sha256: 'a'.repeat(64), code: 'torn-tail' };
const recs = (r: Rec[], tail: ChainedTail | null = null) => ({ kind: 'records' as const, records: r, tail });
const rows = (head: ChainedPosition | null, anyAuthorityRow = false) => ({ kind: 'measured' as const, head, anyAuthorityRow });

export function authorityCoherenceCases(m: Pick<Coherence, 'authorityCoherence'>): Record<string, SuiteCase> {
  const A = forkChain(3, 0);
  const B = forkChain(3, 1);
  const w = (f: unknown, r: unknown): string => {
    const v = m.authorityCoherence(f as never, r as never);
    return v.kind === 'coherent' ? 'coherent' : v.kind === 'rolled-back' ? v.cause : `unmeasured:${v.why}`;
  };
  return {
    'an unreadable file, then unreadable rows': () => {
      expect(w({ kind: 'unmeasured', why: 'unreadable' }, { kind: 'unmeasured' })).toBe('unmeasured:journal');
      expect(w(recs(A), { kind: 'unmeasured' })).toBe('unmeasured:rows');
    },
    'malformed, and a tail the heal did not take': () => {
      expect(w({ kind: 'malformed', code: 'x', detail: 'x', lines: 1 }, rows(null))).toBe('malformed');
      expect(w(recs(A, TAIL), rows(pos(A[2]!)))).toBe('malformed');
    },
    'a fresh box, and missing beside a head row or any Overlord row': () => {
      expect(w({ kind: 'absent' }, rows(null))).toBe('coherent');
      expect(w({ kind: 'absent' }, rows(null, true))).toBe('missing');
      expect(w({ kind: 'absent' }, rows(pos(A[0]!)))).toBe('missing');
    },
    'equal heads are coherent': () => { expect(w(recs(A), rows(pos(A[2]!)))).toBe('coherent'); },
    'another record at the row\'s sequence, or the same journalId with another digest, is diverged': () => {
      expect(w(recs(A), rows(pos(B[1]!)))).toBe('diverged');
      expect(w(recs(A), rows({ ...pos(A[2]!), digest: 'f'.repeat(64) }))).toBe('diverged');
    },
    'one past is trailing, further is ahead, below is behind': () => {
      expect(w(recs(A), rows(pos(A[1]!)))).toBe('trailing');
      expect(w(recs(A), rows(pos(A[0]!)))).toBe('ahead');
      expect(w(recs(A.slice(0, 2)), rows(pos(A[2]!)))).toBe('behind');
    },
    'with no head row: one record is trailing, more is ahead': () => {
      expect(w(recs(A.slice(0, 1)), rows(null))).toBe('trailing');
      expect(w(recs(A), rows(null))).toBe('ahead');
    },
  };
}

const COHERENCE_SET: MutantSet<Coherence> = {
  modulePath: COHERENCE_TS,
  mutants: [
    { id: 'C1 trailing reads coherent', old: "if (last.sequence === head.sequence) return { kind: 'coherent' };", new: "if (last.sequence <= head.sequence + 1) return { kind: 'coherent' };" },
    { id: 'C2 rows read as the journal', old: "return { kind: 'unmeasured', why: 'rows' };", new: "return { kind: 'unmeasured', why: 'journal' };" },
    { id: 'C3 a tail ignored', old: " || (file.kind === 'records' && file.tail !== null)", new: '' },
    { id: 'C4 a fresh box beside rows', old: 'head === null && !rows.anyAuthorityRow', new: 'head === null' },
    { id: 'C5 no diverged', old: "if (atRow === undefined || !samePosition(atRow, head)) return { kind: 'rolled-back', cause: 'diverged' };", new: '' },
    { id: 'C6 no behind', old: "if (last.sequence < head.sequence) return { kind: 'rolled-back', cause: 'behind' };", new: '' },
    { id: 'C7 no head row is always trailing', old: "last.sequence === 1 ? 'trailing' : 'ahead'", new: "'trailing'" },
    { id: 'C8 digest not compared', old: 'a.journalId === b.journalId && a.digest === b.digest', new: 'a.journalId === b.journalId' },
  ],
  suite: (mod) => authorityCoherenceCases(mod),
};

export function authorityTailHealCases(m: Pick<Coherence, 'authorityTailHeal'>): Record<string, SuiteCase> {
  const A = forkChain(2, 0);
  return {
    'a tail behind a sound prefix with an equal head row is healed, and with neither records nor a head row': () => {
      expect(m.authorityTailHeal(recs(A, TAIL), rows(pos(A[1]!)))).toMatchObject({ offset: 9, name: `9-${'a'.repeat(64)}.tail` });
      expect(m.authorityTailHeal(recs([], TAIL), rows(null))).toMatchObject({ offset: 9 });
    },
    'a tail is not healed when the head row differs or is absent beside records, or with records and no head row': () => {
      expect(m.authorityTailHeal(recs(A, TAIL), rows(pos(A[0]!)))).toBeNull();
      expect(m.authorityTailHeal(recs(A, TAIL), rows(null))).toBeNull();
      expect(m.authorityTailHeal(recs([], TAIL), rows(pos(A[0]!)))).toBeNull();
    },
    'a tail behind unreadable rows is not healed': () => {
      expect(m.authorityTailHeal(recs(A, TAIL), { kind: 'unmeasured' } as never)).toBeNull();
    },
    'no tail, nothing to heal': () => { expect(m.authorityTailHeal(recs(A), rows(pos(A[1]!)))).toBeNull(); },
  };
}

const HEAL_SET: MutantSet<Coherence> = {
  modulePath: COHERENCE_TS,
  mutants: [
    { id: 'H1 any head row', old: 'const prefixSound = last === undefined ? head === null : head !== null && samePosition(last, head);', new: 'const prefixSound = true;' },
    { id: 'H2 unreadable rows heal', old: "file.tail === null || rows.kind !== 'measured') return null;", new: 'file.tail === null) return null;' },
    { id: 'H3 an empty journal heals beside a head row', old: 'last === undefined ? head === null :', new: 'last === undefined ? true :' },
  ],
  suite: (mod) => authorityTailHealCases(mod),
};

export const OVERLORD_AUTHORITY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [AUTHORITY_ENTRY_KEY]: ENTRY_SET as MutantSet<never>,
  [AUTHORITY_DIRECTION_KEY]: DIRECTION_SET as MutantSet<never>,
  [AUTHORITY_FOLD_KEY]: FOLD_SET as MutantSet<never>,
  [AUTHORITY_COHERENCE_KEY]: COHERENCE_SET as MutantSet<never>,
  [AUTHORITY_HEAL_KEY]: HEAL_SET as MutantSet<never>,
};
