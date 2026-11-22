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
const DECISION_ROW = {
  kind: 'authority-decision-row', opKey: 'op-d', row: 'scope.widens', gate: true,
  from: { mode: 'shadow', ceiling: 600, armedLine: null, held: false },
  to: { mode: 'armed', ceiling: 600, armedLine: { id: 3, line: 0.9 }, held: false },
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
    'a decision-model row record is accepted as given, and its gate is checked against the catalogue': () => {
      expect(m.authorityEntry(DECISION_ROW)).toEqual(DECISION_ROW);
      expect(refused({ ...DECISION_ROW, gate: false })).toBe('bad-field');
      expect(refused({ ...DECISION_ROW, row: 'relay.method', gate: true })).toBe('bad-field');
      expect(refused({ ...DECISION_ROW, row: 'relay.method', gate: false })).toBe('accepted');
    },
    'a decision-model row refuses an unknown row, a missing key, an extra key in the record, a side and an armed line': () => {
      expect(refused({ ...DECISION_ROW, row: 'row.unknown' })).toBe('bad-field');
      expect(refused({ ...DECISION_ROW, from: { mode: 'off', ceiling: 600, held: false } })).toBe('bad-field');
      expect(refused({ ...DECISION_ROW, from: { ...DECISION_ROW.from, extra: 1 } })).toBe('unknown-key');
      expect(refused({ ...DECISION_ROW, to: { ...DECISION_ROW.to, armedLine: { id: 3, line: 0.9, extra: 1 } } })).toBe('unknown-key');
    },
    'a decision-model row\'s ceiling is an integer from 50 to 5000': () => {
      const at = (ceiling: number): string => refused({ ...DECISION_ROW, to: { ...DECISION_ROW.to, ceiling } });
      expect([at(49), at(50), at(5000), at(5001), at(60.5)]).toEqual(['bad-field', 'accepted', 'accepted', 'bad-field', 'bad-field']);
    },
    'a decision-model row\'s mode is off, shadow or armed': () => {
      expect(refused({ ...DECISION_ROW, to: { ...DECISION_ROW.to, mode: 'on' } })).toBe('bad-field');
      expect(refused({ ...DECISION_ROW, to: { ...DECISION_ROW.to, mode: 'off' } })).toBe('accepted');
    },
    'a decision-model row\'s armed line carries its id and a value from 0 to 1': () => {
      const line = (armedLine: unknown): string => refused({ ...DECISION_ROW, to: { ...DECISION_ROW.to, armedLine } });
      expect([line({ id: 3 }), line({ id: 3, line: 1.5 }), line({ id: 3, line: -0.5 }), line({ id: 0, line: 0.9 }), line({ id: 3, line: 0 }),
        line({ id: 3, line: 1 }), line(null), line({ id: 3, line: Number.NaN })])
        .toEqual(['bad-field', 'bad-field', 'bad-field', 'bad-field', 'accepted', 'accepted', 'accepted', 'bad-field']);
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
    { id: 'E11 gate unchecked', old: 'if (gate !== isDecisionGate(row)) return refuse', new: 'if (false) return refuse' },
    { id: 'E12 any row', old: "if (!isDecisionRowId(row)) return refuse('bad-field', 'row is not a decision-model row');", new: '' },
    { id: 'E13 no side keys', old: 'exactKeys(v, SIDE_KEYS, what);', new: ';' },
    { id: 'E14 no line keys', old: 'exactKeys(l, LINE_KEYS, `${what}.armedLine`);', new: ';' },
    { id: 'E15 any mode', old: "if (!isDecisionRowMode(mode)) return refuse('bad-field', `${what}.mode is not off, shadow or armed`);", new: '' },
    { id: 'E16 ceiling 49', old: 'c < DECISION_CEILING_MIN ||', new: 'c < DECISION_CEILING_MIN - 1 ||' },
    { id: 'E17 ceiling 5001', old: 'c > DECISION_CEILING_MAX)', new: 'c > DECISION_CEILING_MAX + 1)' },
    { id: 'E18 ceiling 50 refused', old: 'c < DECISION_CEILING_MIN ||', new: 'c <= DECISION_CEILING_MIN ||' },
    { id: 'E19 ceiling 5000 refused', old: 'c > DECISION_CEILING_MAX)', new: 'c >= DECISION_CEILING_MAX)' },
    { id: 'E20 fractional ceiling', old: '!Number.isSafeInteger(c) ||', new: '' },
    { id: 'E21 line above 1', old: 'line < 0 || line > 1)', new: 'line < 0)' },
    { id: 'E22 line below 0', old: 'line < 0 || line > 1)', new: 'line > 1)' },
    { id: 'E23 line 1 refused', old: 'line < 0 || line > 1)', new: 'line < 0 || line >= 1)' },
    { id: 'E24 line not finite', old: '!Number.isFinite(line) ||', new: '' },
    { id: 'E25 line id optional', old: "armedLine = { id: positiveInt(l['id'], `${what}.armedLine.id`), line };", new: "armedLine = { id: Number(l['id']), line };" },
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
    'a decision-model row reads its direction from the entry alone: new spend widens, a gate that stops shutting widens, advice does not': () => {
      const side = (mode: string, ceiling = 600, line: number | null = null, held = false) =>
        ({ mode, ceiling, armedLine: line === null ? null : { id: 1, line }, held });
      const row = (gate: boolean, from: unknown, to: unknown) =>
        ({ kind: 'authority-decision-row', opKey: 'k', row: gate ? 'scope.widens' : 'relay.method', gate, from, to });
      expect(d(row(false, side('off'), side('shadow')))).toBe('widens');
      expect(d(row(true, side('off'), side('shadow')))).toBe('widens');
      expect(d(row(false, side('shadow'), side('off')))).toBe('narrows');
      expect(d(row(false, side('shadow'), side('shadow', 601)))).toBe('widens');
      expect(d(row(false, side('shadow', 601), side('shadow')))).toBe('narrows');
      expect(d(row(true, side('armed', 600, 0.9), side('shadow')))).toBe('widens');
      expect(d(row(false, side('armed'), side('shadow')))).toBe('narrows');
      expect(d(row(true, side('shadow'), side('armed', 600, 0.9)))).toBe('narrows');
      expect(d(row(true, side('armed', 600, 0.9), side('armed', 600, 0.95)))).toBe('narrows');
      expect(d(row(true, side('armed', 600, 0.9), side('armed', 600, 0.8)))).toBe('widens');
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
    { id: 'D7 a decision row always narrows', old: 'return decisionRowDirection(entry.gate, entry.from, entry.to);', new: "return 'narrows';" },
    { id: 'D8 a decision row always widens', old: 'return decisionRowDirection(entry.gate, entry.from, entry.to);', new: "return 'widens';" },
    { id: 'D9 a decision row\'s gate turned round', old: 'decisionRowDirection(entry.gate, entry.from, entry.to)', new: 'decisionRowDirection(!entry.gate, entry.from, entry.to)' },
    { id: 'D10 a decision row\'s sides swapped', old: 'decisionRowDirection(entry.gate, entry.from, entry.to)', new: 'decisionRowDirection(entry.gate, entry.to, entry.from)' },
    { id: 'D11 a decision row is never a gate', old: 'decisionRowDirection(entry.gate, entry.from, entry.to)', new: 'decisionRowDirection(false, entry.from, entry.to)' },
    { id: 'D12 a decision row is always a gate', old: 'decisionRowDirection(entry.gate, entry.from, entry.to)', new: 'decisionRowDirection(true, entry.from, entry.to)' },
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
    'decision rows: two moves on one row keep the last to, two rows are kept apart, and a Confirm leaves them as they stood': () => {
      const side = (ceiling: number) => ({ mode: 'shadow', ceiling, armedLine: null, held: false });
      const move = (row: string, from: number, to: number): E =>
        ({ kind: 'authority-decision-row', opKey: `op-${row}-${to}`, row, gate: row === 'scope.widens', from: side(from), to: side(to) } as E);
      const v = m.authorityFold(chain([move('relay.method', 600, 500), move('scope.widens', 600, 400), move('relay.method', 500, 300)]));
      expect([...v.decisionRows.entries()]).toEqual([['relay.method', side(300)], ['scope.widens', side(400)]]);
      expect([...m.authorityFold(chain([])).decisionRows]).toEqual([]);
      expect(m.authorityFold(chain([move('relay.method', 600, 500), CONFIRM as unknown as E])).decisionRows.get('relay.method')).toEqual(side(500));
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
    { id: 'F8 a decision row ignored', old: "case 'authority-decision-row': rowMap.set(e.row, e.to); break;", new: "case 'authority-decision-row': break;" },
    { id: 'F9 a decision row takes from', old: 'rowMap.set(e.row, e.to)', new: 'rowMap.set(e.row, e.from)' },
    { id: 'F10 one decision row for all', old: 'rowMap.set(e.row, e.to)', new: "rowMap.set('relay.method', e.to)" },
    { id: 'F11 the first decision move stays', old: 'rowMap.set(e.row, e.to)', new: 'if (!rowMap.has(e.row)) rowMap.set(e.row, e.to)' },
    { id: 'F12 a Confirm clears the decision rows', old: 'latchMap.clear();\n', new: 'latchMap.clear(); rowMap.clear();\n' },
    { id: 'F13 the decision rows are not returned', old: 'decisionRows: rowMap };', new: 'decisionRows: new Map() };' },
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

// ---------- the witness: epoch, verdict, off-volume holders (Task 5, PR B) ----------

const WITNESS_TS = path.join(ROOT, 'server/src/coord/overlordAuthorityWitness.ts');
const WITNESS_L0_TS = path.join(ROOT, 'shared/authorityWitness.ts');
type Witness = typeof import('../../src/coord/overlordAuthorityWitness.js');
type WitnessL0 = typeof import('../../../shared/authorityWitness.js');
type WView = Parameters<Witness['authorityEpoch']>[0];
type WFacts = Parameters<Witness['witnessVerdict']>[0];
type WTuple = Parameters<WitnessL0['witnessKeep']>[1];
type WPrivacy = Parameters<Witness['authorityEpoch']>[2];

export const AUTHORITY_EPOCH_KEY = 'server/src/coord/overlordAuthorityWitness.ts#authorityEpoch';
export const WITNESS_VERDICT_KEY = 'server/src/coord/overlordAuthorityWitness.ts#witnessVerdict';
export const OFF_VOLUME_HELD_KEY = 'server/src/coord/overlordAuthorityWitness.ts#offVolumeHeld';
export const WITNESS_KEEP_KEY = 'shared/authorityWitness.ts#witnessKeep';
export const PARSE_WITNESS_TUPLE_KEY = 'shared/authorityWitness.ts#parseWitnessTuple';

const HEX = (c: string): string => c.repeat(64);
const wview = (lastConfirm: WView['lastConfirm'] = null): WView => ({
  designation: null, operatorRung: null, latches: new Map(), accountSet: null, modelClass: null, decisionRows: new Map(), lastConfirm,
});
const wconfirm = (sequence: number, epochAtConfirm: number, privacySequenceAtConfirm: number | null): WView['lastConfirm'] =>
  ({ sequence, epochAtConfirm, privacySequenceAtConfirm, restoreGeneration: 1 });
const wpriv = (sequence: number, digests: Record<number, string> = {}): WPrivacy => ({
  kind: 'head', sequence, digest: digests[sequence] ?? HEX('e'), highestMessageId: null,
  digestAt: (s: number) => (s === sequence ? (digests[s] ?? HEX('e')) : (digests[s] ?? null)),
});
const WDIGESTS: Record<number, string> = { 1: HEX('1'), 2: HEX('2'), 3: HEX('3') };

export function authorityEpochCases(m: Pick<Witness, 'authorityEpoch'>): Record<string, SuiteCase> {
  return {
    'with no Confirm the base is 0 and the terms are the two sequences': () => {
      expect(m.authorityEpoch(wview(), 4, { kind: 'absent' })).toEqual({ total: 4, base: 0, terms: { authority: 4, privacy: 'absent' } });
      expect(m.authorityEpoch(wview(), 4, wpriv(3))).toEqual({ total: 7, base: 0, terms: { authority: 4, privacy: 3 } });
    },
    'a wired privacy journal with no record is term 0': () => {
      expect(m.authorityEpoch(wview(), 2, { kind: 'empty' })).toEqual({ total: 2, base: 0, terms: { authority: 2, privacy: 0 } });
    },
    'after a Confirm the base is epochAtConfirm and the terms count the records after it': () => {
      const v = wview(wconfirm(5, 10, 3));
      expect(m.authorityEpoch(v, 7, wpriv(5))).toEqual({ total: 14, base: 10, terms: { authority: 2, privacy: 2 } });
      expect(m.authorityEpoch(v, 6, { kind: 'absent' })).toEqual({ total: 11, base: 10, terms: { authority: 1, privacy: 'absent' } });
    },
    'a Confirm with no privacy sequence counts every privacy record, and an empty journal is 0': () => {
      const v = wview(wconfirm(1, 4, null));
      expect(m.authorityEpoch(v, 3, wpriv(5))).toEqual({ total: 11, base: 4, terms: { authority: 2, privacy: 5 } });
      expect(m.authorityEpoch(v, 1, { kind: 'empty' })).toEqual({ total: 4, base: 4, terms: { authority: 0, privacy: 0 } });
    },
    'an unmeasured privacy head is unmeasured, never absent': () => {
      expect(m.authorityEpoch(wview(), 2, { kind: 'unmeasured', why: 'unreadable' })).toBe('unmeasured');
    },
    'a negative term is unmeasured, on the authority side and on the privacy side': () => {
      const v = wview(wconfirm(5, 10, 3));
      expect(m.authorityEpoch(v, 4, { kind: 'absent' })).toBe('unmeasured');
      expect(m.authorityEpoch(v, 7, wpriv(2))).toBe('unmeasured');
      expect(m.authorityEpoch(v, 6, { kind: 'empty' })).toBe('unmeasured');
    },
    'a sequence that is not a count is unmeasured': () => {
      expect(m.authorityEpoch(wview(), -1, { kind: 'absent' })).toBe('unmeasured');
      expect(m.authorityEpoch(wview(), 1.5, { kind: 'absent' })).toBe('unmeasured');
    },
  };
}

const wtuple = (over: Partial<WTuple> = {}): WTuple => ({
  v: 1, epoch: 2, base: 0, terms: { authority: 2, privacy: 'absent', act: 'absent' }, boot: 'boot-old',
  authority: { sequence: 2, digest: HEX('2') }, privacy: 'absent', act: 'absent', highestIds: { restoreGeneration: 0 },
  told: { operatorRung: null, latches: [] }, ...over,
});
const wauth = (seq: number): Exclude<WFacts['authority'], 'unmeasured'> => ({
  head: seq === 0 ? null : { sequence: seq, digest: WDIGESTS[seq]! },
  digestAt: (s: number) => (s <= seq ? (WDIGESTS[s] ?? null) : null),
});
const wfacts = (over: Partial<WFacts> & { seq?: number; base?: number } = {}): WFacts => ({
  epoch: { total: (over.base ?? 0) + (over.seq ?? 2), base: over.base ?? 0, terms: { authority: over.seq ?? 2, privacy: 'absent' } },
  boot: 'boot-now', authority: wauth(over.seq ?? 2), privacy: { kind: 'absent' }, ...over,
});
const privTerm = (n: number): WTuple['terms'] => ({ authority: 2, privacy: n, act: 'absent' });

export function witnessVerdictCases(m: Pick<Witness, 'witnessVerdict'>): Record<string, SuiteCase> {
  const v = m.witnessVerdict;
  const held = (tuple: WTuple) => ({ kind: 'tuple', tuple }) as const;
  return {
    'row 1: a malformed tuple is unmeasured malformed, before every other row': () => {
      expect(v(wfacts({ epoch: 'unmeasured' }), { kind: 'malformed' }, 'console')).toEqual({ kind: 'unmeasured', why: 'malformed' });
    },
    'row 2: nothing held is no-witness, before the server facts are read': () => {
      expect(v(wfacts({ epoch: 'unmeasured' }), { kind: 'nothing' }, 'console')).toEqual({ kind: 'no-witness' });
      expect(v(wfacts(), { kind: 'nothing' }, 'console')).toEqual({ kind: 'no-witness' });
    },
    'row 3: the server facts unmeasured name the journal, or the privacy head when that is the cause': () => {
      expect(v(wfacts({ epoch: 'unmeasured' }), held(wtuple({ base: 9, epoch: 11 })), 'console')).toEqual({ kind: 'unmeasured', why: 'journal' });
      expect(v(wfacts({ authority: 'unmeasured' }), held(wtuple()), 'console')).toEqual({ kind: 'unmeasured', why: 'journal' });
      expect(v(wfacts({ privacy: { kind: 'unmeasured', why: 'x' } }), held(wtuple()), 'console')).toEqual({ kind: 'unmeasured', why: 'privacy-head' });
      expect(v(wfacts({ epoch: 'unmeasured', privacy: { kind: 'unmeasured', why: 'x' } }), held(wtuple()), 'console'))
        .toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    },
    'row 4: a base below the server\'s is stale, even with higher terms': () => {
      const server = wfacts({ base: 5 });
      expect(v(server, held(wtuple({ base: 3, epoch: 10, terms: { authority: 7, privacy: 'absent', act: 'absent' } })), 'console')).toEqual({ kind: 'stale' });
      expect(v(server, held(wtuple({ base: 4 })), 'console')).toEqual({ kind: 'stale' });
      expect(v(server, held(wtuple({ base: 5, epoch: 7 })), 'console')).not.toEqual({ kind: 'stale' });
    },
    'row 5: a base above, or an equal base and a higher authority term, is witness-epoch; an equal term is not': () => {
      expect(v(wfacts(), held(wtuple({ base: 1, epoch: 3 })), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      expect(v(wfacts(), held(wtuple({ epoch: 3, terms: { authority: 3, privacy: 'absent', act: 'absent' } })), 'console'))
        .toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      expect(v(wfacts(), held(wtuple()), 'console')).toEqual({ kind: 'consistent', counts: true });
    },
    'row 5: a higher privacy term is witness-epoch only when both sides read one': () => {
      const t = wtuple({ epoch: 5, terms: privTerm(3), privacy: { sequence: 3, digest: HEX('e') } });
      expect(v(wfacts({ privacy: wpriv(2), epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } }), held(t), 'console'))
        .toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      expect(v(wfacts({ privacy: { kind: 'empty' }, epoch: { total: 2, base: 0, terms: { authority: 2, privacy: 0 } } }), held(t), 'console'))
        .toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
      expect(v(wfacts({ privacy: wpriv(3), epoch: { total: 5, base: 0, terms: { authority: 2, privacy: 3 } } }), held(t), 'console'))
        .toEqual({ kind: 'consistent', counts: true });
    },
    'row 5: a term the server does not read is skipped, never compared as zero (a build rollback)': () => {
      const t = wtuple({ epoch: 5, terms: privTerm(3), privacy: { sequence: 3, digest: HEX('e') } });
      expect(v(wfacts(), held(t), 'console')).toEqual({ kind: 'consistent', counts: true });
    },
    'row 5: a term the witness holds as absent while the server reads it is skipped': () => {
      const server = wfacts({ privacy: wpriv(2), epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } });
      expect(v(server, held(wtuple()), 'console')).toEqual({ kind: 'consistent', counts: true });
    },
    'row 5 comes before row 6': () => {
      const t = wtuple({ epoch: 3, terms: { authority: 3, privacy: 'absent', act: 'absent' }, authority: { sequence: 3, digest: HEX('f') } });
      expect(v(wfacts(), held(t), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-epoch' });
    },
    'row 6: an authority head with another digest, or past the server\'s head, or against an empty journal, is witness-heads': () => {
      const heads = { kind: 'rolled-back', cause: 'witness-heads' };
      expect(v(wfacts(), held(wtuple({ authority: { sequence: 2, digest: HEX('f') } })), 'console')).toEqual(heads);
      expect(v(wfacts(), held(wtuple({ authority: { sequence: 1, digest: HEX('f') } })), 'console')).toEqual(heads);
      expect(v(wfacts({ seq: 2 }), held(wtuple({ authority: { sequence: 3, digest: HEX('3') } })), 'console')).toEqual(heads);
      expect(v(wfacts({ seq: 0 }), held(wtuple({ epoch: 0, terms: { authority: 0, privacy: 'absent', act: 'absent' } })), 'console')).toEqual(heads);
    },
    'row 6: an earlier head the server holds, or no head at all, is consistent': () => {
      const ok = { kind: 'consistent', counts: true };
      expect(v(wfacts(), held(wtuple({ epoch: 1, terms: { authority: 1, privacy: 'absent', act: 'absent' }, authority: { sequence: 1, digest: HEX('1') } })), 'console')).toEqual(ok);
      expect(v(wfacts(), held(wtuple({ epoch: 0, terms: { authority: 0, privacy: 'absent', act: 'absent' }, authority: null })), 'console')).toEqual(ok);
    },
    'row 6: the privacy head is compared when both sides hold one': () => {
      const server = wfacts({ privacy: wpriv(2, { 2: HEX('a') }), epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } });
      const mk = (digest: string): WTuple => wtuple({ epoch: 4, terms: privTerm(2), privacy: { sequence: 2, digest } });
      expect(v(server, held(mk(HEX('a'))), 'console')).toEqual({ kind: 'consistent', counts: true });
      expect(v(server, held(mk(HEX('b'))), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
      const lower = wtuple({ epoch: 3, terms: privTerm(1), privacy: { sequence: 1, digest: HEX('c') } });
      const withLower = wfacts({ privacy: wpriv(2, { 1: HEX('c'), 2: HEX('a') }), epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } });
      expect(v(withLower, held(lower), 'console')).toEqual({ kind: 'consistent', counts: true });
      expect(v(server, held(lower), 'console')).toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
    },
    'row 6: a privacy digest the journal could not read is unmeasured privacy-head': () => {
      const unread: WPrivacy = { kind: 'head', sequence: 2, digest: HEX('a'), highestMessageId: null, digestAt: () => 'unmeasured' };
      const t = wtuple({ epoch: 4, terms: privTerm(2), privacy: { sequence: 2, digest: HEX('a') } });
      expect(v(wfacts({ privacy: unread, epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } }), held(t), 'console'))
        .toEqual({ kind: 'unmeasured', why: 'privacy-head' });
    },
    'row 6: a witness privacy head against a wired journal with no record is witness-heads; absent or empty on either side is skipped': () => {
      const withHead = wtuple({ epoch: 2, terms: privTerm(0), privacy: { sequence: 1, digest: HEX('a') } });
      expect(v(wfacts({ privacy: { kind: 'empty' }, epoch: { total: 2, base: 0, terms: { authority: 2, privacy: 0 } } }), held(withHead), 'console'))
        .toEqual({ kind: 'rolled-back', cause: 'witness-heads' });
      const ok = { kind: 'consistent', counts: true };
      expect(v(wfacts({ privacy: { kind: 'absent' } }), held(wtuple({ epoch: 5, terms: privTerm(3), privacy: { sequence: 3, digest: HEX('d') } })), 'console')).toEqual(ok);
      expect(v(wfacts({ privacy: wpriv(2), epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } }), held(wtuple()), 'console')).toEqual(ok);
      const empty = wtuple({ epoch: 2, terms: privTerm(0), privacy: 'empty' });
      expect(v(wfacts({ privacy: wpriv(2), epoch: { total: 4, base: 0, terms: { authority: 2, privacy: 2 } } }), held(empty), 'console')).toEqual(ok);
      expect(v(wfacts({ privacy: { kind: 'empty' }, epoch: { total: 2, base: 0, terms: { authority: 2, privacy: 0 } } }), held(empty), 'console')).toEqual(ok);
    },
    'row 7: consistent counts only from another host or a console, under another boot': () => {
      const at = (host: 'other-host' | 'same-host' | 'unmeasured' | 'console', boot = 'boot-old') => v(wfacts(), held(wtuple({ boot })), host);
      expect(at('other-host')).toEqual({ kind: 'consistent', counts: true });
      expect(at('console')).toEqual({ kind: 'consistent', counts: true });
      expect(at('same-host')).toEqual({ kind: 'consistent', counts: false });
      expect(at('unmeasured')).toEqual({ kind: 'consistent', counts: false });
      expect(at('other-host', 'boot-now')).toEqual({ kind: 'consistent', counts: false });
      expect(at('console', 'boot-now')).toEqual({ kind: 'consistent', counts: false });
    },
  };
}

export function offVolumeHeldCases(m: Pick<Witness, 'offVolumeHeld'>): Record<string, SuiteCase> {
  type Host = 'other-host' | 'same-host' | 'unmeasured' | 'console';
  const h = (host: Host, epoch: number, boot = 'boot-old') => ({ host, epoch, boot });
  return {
    'a same-host or unmeasured holder alone does not hold it': () => {
      expect(m.offVolumeHeld(5, [h('same-host', 9)])).toBe('not-yet');
      expect(m.offVolumeHeld(5, [h('unmeasured', 9)])).toBe('not-yet');
    },
    'a console or an other-host holder at or above the epoch holds it': () => {
      expect(m.offVolumeHeld(5, [h('console', 5)])).toBe('held');
      expect(m.offVolumeHeld(5, [h('other-host', 6)])).toBe('held');
      expect(m.offVolumeHeld(5, [h('same-host', 9), h('console', 7)])).toBe('held');
    },
    'a holder below the epoch, or nobody, does not hold it': () => {
      expect(m.offVolumeHeld(5, [h('console', 4)])).toBe('not-yet');
      expect(m.offVolumeHeld(5, [h('other-host', 4)])).toBe('not-yet');
      expect(m.offVolumeHeld(5, [])).toBe('not-yet');
    },
    'a holder under this boot still counts for holding a narrowing': () => {
      expect(m.offVolumeHeld(5, [h('console', 5)])).toBe('held');
    },
    'an epoch that is not a count is unmeasured': () => {
      expect(m.offVolumeHeld(-1, [h('console', 5)])).toBe('unmeasured');
      expect(m.offVolumeHeld(1.5, [])).toBe('unmeasured');
    },
  };
}

export function witnessKeepCases(m: Pick<WitnessL0, 'witnessKeep'>): Record<string, SuiteCase> {
  const at = (epoch: number, boot: string): WTuple => wtuple({ epoch, boot, terms: { authority: epoch, privacy: 'absent', act: 'absent' } });
  return {
    'nothing held takes the offer': () => { const o = at(3, 'o'); expect(m.witnessKeep(null, o)).toBe(o); },
    'a higher epoch is taken and a lower one never replaces': () => {
      const held = at(5, 'held');
      expect(m.witnessKeep(held, at(6, 'offer')).boot).toBe('offer');
      expect(m.witnessKeep(held, at(4, 'offer'))).toBe(held);
    },
    'equal epochs keep what is held': () => { const held = at(5, 'held'); expect(m.witnessKeep(held, at(5, 'offer'))).toBe(held); },
  };
}

export function parseWitnessTupleCases(m: Pick<WitnessL0, 'parseWitnessTuple'>): Record<string, SuiteCase> {
  const good = (): Record<string, any> => ({
    v: 1, epoch: 5, base: 0, terms: { authority: 2, privacy: 3, act: 'absent' }, boot: 'boot-a', authority: { sequence: 2, digest: HEX('1') },
    privacy: { sequence: 3, digest: HEX('2') }, act: 'absent', highestIds: { restoreGeneration: 1, message: 7 },
    told: { operatorRung: 'advise', latches: [{ cause: 'restore-detected', cap: 'chat' }, { cause: 'unwitnessed-third', cap: 'advise' }] },
  });
  const bad = (f: (t: Record<string, any>) => void): boolean => {
    const t = good();
    f(t);
    const r = m.parseWitnessTuple(t);
    return !r.ok && r.why === 'malformed';
  };
  return {
    'a whole tuple is accepted as given, with and without a message id': () => {
      expect(m.parseWitnessTuple(good())).toEqual({ ok: true, tuple: good() });
      const t = good();
      delete t.highestIds.message;
      expect(m.parseWitnessTuple(t)).toEqual({ ok: true, tuple: t });
    },
    'the words absent and empty and a null authority head are accepted': () => {
      expect(bad((t) => { t.privacy = 'absent'; t.terms.privacy = 'absent'; t.epoch = 2; })).toBe(false);
      expect(bad((t) => { t.privacy = 'empty'; t.terms.privacy = 0; t.epoch = 2; })).toBe(false);
      expect(bad((t) => { t.authority = null; })).toBe(false);
    },
    'a value that is not an object is refused': () => {
      for (const raw of [null, 1, 'x', [], [good()]]) expect(m.parseWitnessTuple(raw)).toEqual({ ok: false, why: 'malformed' });
    },
    'an unknown key is refused at every level': () => {
      expect(bad((t) => { t.extra = 1; })).toBe(true);
      expect(bad((t) => { t.terms.extra = 1; })).toBe(true);
      expect(bad((t) => { t.authority.extra = 1; })).toBe(true);
      expect(bad((t) => { t.highestIds.extra = 1; })).toBe(true);
      expect(bad((t) => { t.told.extra = 1; })).toBe(true);
      expect(bad((t) => { t.told.latches[0].extra = 1; })).toBe(true);
    },
    'a missing required key is refused, and the restore generation is required': () => {
      for (const k of ['v', 'epoch', 'base', 'terms', 'boot', 'authority', 'privacy', 'act', 'highestIds', 'told']) expect(bad((t) => { delete t[k]; }), k).toBe(true);
      expect(bad((t) => { delete t.highestIds.restoreGeneration; })).toBe(true);
      expect(bad((t) => { delete t.terms.act; })).toBe(true);
    },
    'v other than 1 is refused': () => {
      for (const v of [0, 2, '1']) expect(bad((t) => { t.v = v; }), String(v)).toBe(true);
    },
    'a number that is not a non-negative safe integer is refused': () => {
      for (const n of [-1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1, '3']) {
        expect(bad((t) => { t.base = n; }), String(n)).toBe(true);
        expect(bad((t) => { t.terms.authority = n; }), String(n)).toBe(true);
        expect(bad((t) => { t.highestIds.restoreGeneration = n; }), String(n)).toBe(true);
        expect(bad((t) => { t.highestIds.message = n; }), String(n)).toBe(true);
      }
    },
    'an epoch that is not the base plus the terms is refused': () => {
      expect(bad((t) => { t.epoch = 4; })).toBe(true);
      expect(bad((t) => { t.epoch = 6; })).toBe(true);
      expect(bad((t) => { t.base = 2; })).toBe(true);
      expect(bad((t) => { t.base = 2; t.epoch = 7; })).toBe(false);
      expect(bad((t) => { t.privacy = 'absent'; t.terms.privacy = 'absent'; t.epoch = 5; })).toBe(true);
    },
    'a negative term that still sums to the epoch is refused': () => {
      expect(bad((t) => { t.terms.privacy = -1; t.epoch = 1; })).toBe(true);
      expect(bad((t) => { t.terms.authority = -1; t.epoch = 2; })).toBe(true);
    },
    'a head with sequence 0 or a digest that is not 64 lowercase hex is refused': () => {
      expect(bad((t) => { t.authority.sequence = 0; })).toBe(true);
      for (const d of [HEX('A'), 'a'.repeat(63), 'a'.repeat(65), HEX('g'), 5]) expect(bad((t) => { t.authority.digest = d; }), String(d)).toBe(true);
    },
    'a privacy word that is neither absent, empty nor a head, and an act that is not absent, are refused': () => {
      expect(bad((t) => { t.privacy = 'present'; })).toBe(true);
      expect(bad((t) => { t.act = 'present'; })).toBe(true);
      expect(bad((t) => { t.terms.act = 0; })).toBe(true);
      expect(bad((t) => { t.terms.privacy = 'empty'; })).toBe(true);
    },
    'a boot that is not printable ASCII with no space, 1 to 128 characters, is refused': () => {
      for (const b of ['', 'has space', 'café', 'a'.repeat(129), 7]) expect(bad((t) => { t.boot = b; }), String(b)).toBe(true);
      expect(bad((t) => { t.boot = 'a'.repeat(128); })).toBe(false);
    },
    'told: an unknown rung, a bad or long cause, a repeated or unsorted cause is refused': () => {
      expect(bad((t) => { t.told.operatorRung = 'max'; })).toBe(true);
      expect(bad((t) => { t.told.latches[0].cap = 'max'; })).toBe(true);
      expect(bad((t) => { t.told.latches[0].cause = 'Restore'; })).toBe(true);
      expect(bad((t) => { t.told.latches[0].cause = 'a'.repeat(65); })).toBe(true);
      expect(bad((t) => { t.told.latches[1].cause = 'restore-detected'; })).toBe(true);
      expect(bad((t) => { t.told.latches.reverse(); })).toBe(true);
      expect(bad((t) => { t.told.latches[0].cause = 'a'.repeat(64); t.told.latches[1].cause = 'b'; })).toBe(false);
      expect(bad((t) => { t.told.operatorRung = null; t.told.latches = []; })).toBe(false);
    },
  };
}

const EPOCH_SET: MutantSet<Witness> = {
  modulePath: WITNESS_TS,
  mutants: [
    { id: 'E1 base ignored', old: 'const base = confirm?.epochAtConfirm ?? 0;', new: 'const base = 0;' },
    { id: 'E2 authority term from zero', old: 'const authority = authoritySequence - (confirm?.sequence ?? 0);', new: 'const authority = authoritySequence;' },
    { id: 'E3 negative authority term accepted', old: ' || !isCount(base) || !isCount(authority)) return', new: ' || !isCount(base)) return' },
    { id: 'E4 empty term ignores the Confirm', old: "case 'empty': term = 0 - (confirm?.privacySequenceAtConfirm ?? 0); break;", new: "case 'empty': term = 0; break;" },
    { id: 'E5 head term ignores the Confirm', old: "case 'head': term = privacy.sequence - (confirm?.privacySequenceAtConfirm ?? 0); break;", new: "case 'head': term = privacy.sequence; break;" },
    { id: 'E6 unmeasured privacy read as absent', old: "case 'unmeasured': return 'unmeasured';", new: "case 'unmeasured': term = 'absent'; break;" },
    { id: 'E7 absent privacy read as zero', old: "case 'absent': term = 'absent'; break;", new: "case 'absent': term = 0; break;" },
    { id: 'E8 negative privacy term accepted', old: "if (term !== 'absent' && !isCount(term)) return 'unmeasured';", new: '' },
    { id: 'E9 total leaves out the base', old: "const total = base + authority + (term === 'absent' ? 0 : term);", new: "const total = authority + (term === 'absent' ? 0 : term);" },
    { id: 'E10 total leaves out the privacy term', old: "const total = base + authority + (term === 'absent' ? 0 : term);", new: 'const total = base + authority;' },
    { id: 'E11 empty journal reads absent', old: "case 'empty': term = 0 - (confirm?.privacySequenceAtConfirm ?? 0); break;", new: "case 'empty': term = 'absent'; break;" },
  ],
  suite: (mod) => authorityEpochCases(mod),
};

const VERDICT_SET: MutantSet<Witness> = {
  modulePath: WITNESS_TS,
  mutants: [
    { id: 'V1 malformed named journal', old: "if (held.kind === 'malformed') return { kind: 'unmeasured', why: 'malformed' };", new: "if (held.kind === 'malformed') return { kind: 'unmeasured', why: 'journal' };" },
    { id: 'V2 nothing is unmeasured', old: "if (held.kind === 'nothing') return { kind: 'no-witness' };", new: "if (held.kind === 'nothing') return { kind: 'unmeasured', why: 'journal' };" },
    { id: 'V3 authority unmeasured names the privacy head', old: "if (server.authority === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };", new: "if (server.authority === 'unmeasured') return { kind: 'unmeasured', why: 'privacy-head' };" },
    { id: 'V4 privacy unmeasured names the journal', old: "if (server.privacy.kind === 'unmeasured') return { kind: 'unmeasured', why: 'privacy-head' };", new: "if (server.privacy.kind === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };" },
    { id: 'V5 unmeasured epoch is stale', old: "if (epoch === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };", new: "if (epoch === 'unmeasured') return { kind: 'stale' };" },
    { id: 'V6 equal base is stale', old: "if (tuple.base < epoch.base) return { kind: 'stale' };", new: "if (tuple.base <= epoch.base) return { kind: 'stale' };" },
    {
      id: 'V7 terms judged before the base (rows 5 and 4 swapped)', old: "if (tuple.base < epoch.base) return { kind: 'stale' };",
      new: "if (termHigher(tuple, epoch)) return { kind: 'rolled-back', cause: 'witness-epoch' };\n  if (tuple.base < epoch.base) return { kind: 'stale' };",
    },
    { id: 'V8 equal base is witness-epoch', old: 'if (tuple.base > epoch.base || termHigher(tuple, epoch))', new: 'if (tuple.base >= epoch.base || termHigher(tuple, epoch))' },
    { id: 'V9 base above ignored', old: 'if (tuple.base > epoch.base || termHigher(tuple, epoch))', new: 'if (termHigher(tuple, epoch))' },
    { id: 'V10 terms ignored', old: 'if (tuple.base > epoch.base || termHigher(tuple, epoch))', new: 'if (tuple.base > epoch.base)' },
    { id: 'V11 an equal authority term refuses', old: 'if (tuple.terms.authority > epoch.terms.authority) return true;', new: 'if (tuple.terms.authority >= epoch.terms.authority) return true;' },
    {
      id: 'V12 a missing privacy term compared as zero', old: "return mine !== 'absent' && theirs !== 'absent' && theirs > mine;",
      new: "return (theirs === 'absent' ? 0 : theirs) > (mine === 'absent' ? 0 : mine);",
    },
    { id: 'V13 a term the server does not read compared as zero', old: "return mine !== 'absent' && theirs !== 'absent' && theirs > mine;", new: "return theirs !== 'absent' && theirs > (mine === 'absent' ? 0 : mine);" },
    { id: 'V14 an equal privacy term refuses', old: "return mine !== 'absent' && theirs !== 'absent' && theirs > mine;", new: "return mine !== 'absent' && theirs !== 'absent' && theirs >= mine;" },
    { id: 'V15 the authority digest is not compared', old: 'authority.digestAt(theirs.sequence) !== theirs.digest) return', new: 'authority.digestAt(theirs.sequence) === theirs.digest) return' },
    { id: 'V17 an absent witness privacy head is compared', old: "if (held === 'absent' || privacy.kind === 'absent') return 'held';", new: "if (privacy.kind === 'absent') return 'held';" },
    { id: 'V18 an absent server privacy head is compared', old: "if (held === 'absent' || privacy.kind === 'absent') return 'held';", new: "if (held === 'absent') return 'held';" },
    { id: 'V19 an empty witness holds a mismatch', old: "if (held === 'empty') return 'held';", new: "if (held === 'empty') return 'mismatch';" },
    { id: 'V20 a head against an empty journal is held', old: "if (privacy.kind !== 'head') return 'mismatch';", new: "if (privacy.kind !== 'head') return 'held';" },
    { id: 'V21 an unread privacy digest is held', old: "if (at === 'unmeasured') return 'unmeasured';", new: "if (at === 'unmeasured') return 'held';" },
    { id: 'V22 a privacy digest is not compared', old: "return at === held.digest ? 'held' : 'mismatch';", new: "return 'held';" },
    { id: 'V23 an unread privacy digest names the journal', old: "if (heads === 'unmeasured') return { kind: 'unmeasured', why: 'privacy-head' };", new: "if (heads === 'unmeasured') return { kind: 'unmeasured', why: 'journal' };" },
    { id: 'V24 heads mismatch named epoch', old: "if (heads === 'mismatch') return { kind: 'rolled-back', cause: 'witness-heads' };", new: "if (heads === 'mismatch') return { kind: 'rolled-back', cause: 'witness-epoch' };" },
    { id: 'V25 a same-host witness counts', old: "const counting = host === 'other-host' || host === 'console';", new: "const counting = host === 'other-host' || host === 'console' || host === 'same-host';" },
    { id: 'V26 an unmeasured host counts', old: "const counting = host === 'other-host' || host === 'console';", new: "const counting = host !== 'same-host';" },
    { id: 'V27 a console does not count', old: "const counting = host === 'other-host' || host === 'console';", new: "const counting = host === 'other-host';" },
    { id: 'V28 another host does not count', old: "const counting = host === 'other-host' || host === 'console';", new: "const counting = host === 'console';" },
    { id: 'V29 this boot counts', old: 'counts: counting && tuple.boot !== server.boot', new: 'counts: counting' },
    { id: 'V30 any boot counts for any host', old: 'counts: counting && tuple.boot !== server.boot', new: 'counts: counting || tuple.boot !== server.boot' },
  ],
  suite: (mod) => witnessVerdictCases(mod),
};

const OFF_VOLUME_SET: MutantSet<Witness> = {
  modulePath: WITNESS_TS,
  mutants: [
    { id: 'O1 an invalid epoch is measured', old: "if (!isCount(epoch)) return 'unmeasured';", new: '' },
    { id: 'O2 a same-host holder counts', old: "(h.host === 'other-host' || h.host === 'console')", new: "(h.host === 'other-host' || h.host === 'console' || h.host === 'same-host')" },
    { id: 'O3 an unmeasured holder counts', old: "(h.host === 'other-host' || h.host === 'console')", new: "h.host !== 'same-host'" },
    { id: 'O4 a console does not count', old: "(h.host === 'other-host' || h.host === 'console')", new: "h.host === 'other-host'" },
    { id: 'O5 another host does not count', old: "(h.host === 'other-host' || h.host === 'console')", new: "h.host === 'console'" },
    { id: 'O6 an equal epoch is not held', old: 'h.epoch >= epoch', new: 'h.epoch > epoch' },
    { id: 'O7 a lower epoch is held', old: 'h.epoch >= epoch', new: 'h.epoch >= epoch - 1' },
    { id: 'O8 a holder from this boot is dropped', old: 'holders.some((h) =>', new: 'holders.filter((h) => h.boot !== _thisBoot).some((h) =>' },
    { id: 'O9 always held', old: "return held ? 'held' : 'not-yet';", new: "return 'held';" },
    { id: 'O10 never held', old: "return held ? 'held' : 'not-yet';", new: "return 'not-yet';" },
  ],
  suite: (mod) => offVolumeHeldCases(mod),
};

const KEEP_SET: MutantSet<WitnessL0> = {
  modulePath: WITNESS_L0_TS,
  mutants: [
    { id: 'K1 nothing held drops the offer', old: 'if (held === null) return offered;', new: 'if (held === null) return null as never;' },
    { id: 'K2 an equal epoch takes the offer', old: 'return offered.epoch > held.epoch ? offered : held;', new: 'return offered.epoch >= held.epoch ? offered : held;' },
    { id: 'K3 a lower epoch is taken', old: 'return offered.epoch > held.epoch ? offered : held;', new: 'return offered.epoch < held.epoch ? offered : held;' },
    { id: 'K4 always the offer', old: 'return offered.epoch > held.epoch ? offered : held;', new: 'return offered;' },
    { id: 'K5 always what is held', old: 'return offered.epoch > held.epoch ? offered : held;', new: 'return held;' },
  ],
  suite: (mod) => witnessKeepCases(mod),
};

const PARSE_SET: MutantSet<WitnessL0> = {
  modulePath: WITNESS_L0_TS,
  mutants: [
    { id: 'P1 any version', old: 'raw.v !== 1 || ', new: '' },
    { id: 'P2 any act word', old: ' || raw.act !== \'absent\') return bad;', new: ') return bad;' },
    { id: 'P3 an empty boot', old: '{1,128}$/', new: '{0,128}$/' },
    { id: 'P4 a boot of 129', old: '{1,128}$/', new: '{1,129}$/' },
    { id: 'P5 an uppercase digest', old: '[0-9a-f]{64}$/', new: '[0-9a-fA-F]{64}$/' },
    { id: 'P6 a cause of 65', old: 'const CAUSE_MAX = 64;', new: 'const CAUSE_MAX = 65;' },
    { id: 'P7 a head at sequence 0', old: 'sequence < 1 ||', new: 'sequence < 0 ||' },
    { id: 'P8 the epoch is not summed', old: "raw.base + terms.authority + (privacyTerm === 'absent' ? 0 : privacyTerm) !== raw.epoch", new: 'false' },
    { id: 'P9 the privacy term does not count', old: "raw.base + terms.authority + (privacyTerm === 'absent' ? 0 : privacyTerm)", new: 'raw.base + terms.authority' },
    { id: 'P10 a repeated cause', old: '!(prev.cause < cause)', new: '!(prev.cause <= cause)' },
    { id: 'P11 an unsorted cause', old: '!(prev.cause < cause)', new: 'false' },
    { id: 'P12 an unknown key', old: 'keys.every((k) => required.includes(k) || optional.includes(k))', new: 'true' },
    { id: 'P13 a bad message id', old: " && !isCount(ids.message)) return bad;", new: ' && false) return bad;' },
    { id: 'P14 the message id is dropped', old: 'if (isCount(ids.message)) highestIds.message = ids.message;', new: '' },
    { id: 'P15 any operator rung', old: 'if (operatorRung !== null && !isRung(operatorRung)) return null;', new: '' },
    { id: 'P16 any latch cap', old: ' || !isRung(cap)) return null;', new: ') return null;' },
    { id: 'P17 any cause length', old: 'cause.length > CAUSE_MAX || ', new: '' },
    { id: 'P18 any cause shape', old: '!CAUSE_RE.test(cause)', new: 'false' },
    { id: 'P19 any privacy term', old: "if (terms.privacy !== 'absent' && !isCount(terms.privacy)) return bad;", new: '' },
    { id: 'P20 any authority term', old: 'if (!isCount(terms.authority) || terms.act !== \'absent\') return bad;', new: "if (terms.act !== 'absent') return bad;" },
    { id: 'P21 any terms act', old: " || terms.act !== 'absent') return bad;", new: ') return bad;' },
    { id: 'P22 the restore generation unchecked', old: " || !isCount(ids.restoreGeneration)) return bad;", new: ') return bad;' },
    { id: 'P23 the boot unchecked', old: "typeof raw.boot !== 'string' || !BOOT_RE.test(raw.boot)", new: 'false' },
  ],
  suite: (mod) => parseWitnessTupleCases(mod),
};

export const OVERLORD_AUTHORITY_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [AUTHORITY_ENTRY_KEY]: ENTRY_SET as MutantSet<never>,
  [AUTHORITY_DIRECTION_KEY]: DIRECTION_SET as MutantSet<never>,
  [AUTHORITY_FOLD_KEY]: FOLD_SET as MutantSet<never>,
  [AUTHORITY_COHERENCE_KEY]: COHERENCE_SET as MutantSet<never>,
  [AUTHORITY_HEAL_KEY]: HEAL_SET as MutantSet<never>,
  [AUTHORITY_EPOCH_KEY]: EPOCH_SET as MutantSet<never>,
  [WITNESS_VERDICT_KEY]: VERDICT_SET as MutantSet<never>,
  [OFF_VOLUME_HELD_KEY]: OFF_VOLUME_SET as MutantSet<never>,
  [WITNESS_KEEP_KEY]: KEEP_SET as MutantSet<never>,
  [PARSE_WITNESS_TUPLE_KEY]: PARSE_SET as MutantSet<never>,
};
