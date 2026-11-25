// The invariant monitor's deciders' cases and mutant sets (Overlord W1 sequence PR B2, plan `w1-sequence-monitor.md` Tasks 4 to 6).
// The cases are written ONCE here, as suite cases over a module: `invariants.test.ts` runs them against the real module, and
// `mutation-floors.test.ts` runs them against each textual mutant (D-8217's every-run floors). They live apart from
// `sequenceSets.ts` (the sequence's own deciders, another run's file) so the two pull requests never meet in one file.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { SequenceWireLine } from '../../../shared/overlord-sequence.js';
import type { RestoreSide } from '../../src/coord/overlordRestore.js';
import type { InvariantName } from '../../src/coord/invariants.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/coord/invariants.ts');
const KEY = 'server/src/coord/invariants.ts';

export type InvariantsModule = typeof import('../../src/coord/invariants.js');
type M = InvariantsModule;
type Verdict = ReturnType<M['invariantVerdict']>;
type I2 = Parameters<M['i2Structural']>[1];
type I5 = Parameters<M['i5Term']>[1];
type I7 = Parameters<M['i7Authority']>[1];
type I17 = Parameters<M['i17Timers']>[1];

// ------------------------------------------------------------------------------------------------------------ fixtures

export const line = (seq: number, over: Partial<SequenceWireLine> = {}): SequenceWireLine =>
  ({ seq, at: seq * 1000, kind: 'generation', id: String(seq), state: 'active', actor: 'server', actorKind: 'server', known: true, ...over });
const des = (seq: number, id: string, state: string, over: Partial<SequenceWireLine> = {}): SequenceWireLine =>
  line(seq, { kind: 'designation', id, state, actor: 'operator-a', actorKind: 'operator', ...over });
const act = (seq: number, actor: string, over: Partial<SequenceWireLine> = {}): SequenceWireLine =>
  line(seq, { kind: 'ladder-latch', id: 'inv-a', state: 'raised', actor, actorKind: 'session', ...over });

const subjects = (v: Verdict): string[] => (v.kind === 'violated' ? v.findings.map((f) => f.subject) : []);
const unmeasuredOf = (v: Verdict): string[] => (v.kind === 'violated' || v.kind === 'holds-where-measured' ? v.unmeasured.map((u) => u.subject) : []);

/** The monotonicity property (Review Focus 6): `more` adds an unknown, an unmeasured fact or a `known: false` line other than a
 *  designation line to `base`. It never removes a finding and never turns an arm into `holds`. (A designation line this build
 *  cannot name may turn a violated line unmeasured, the safe direction: its own I5 case, review 3843 F7.) */
function monotone(base: Verdict, more: Verdict): void {
  for (const s of subjects(base)) expect(subjects(more)).toContain(s);
  if (base.kind !== 'holds') expect(more.kind).not.toBe('holds');
}

const side = (over: Partial<RestoreSide> = {}): RestoreSide => ({
  binding: { sessionId: 'overlord-a', generation: 'gen-1' }, term: 3, operatorRung: 'advise',
  latches: [{ cause: 'restore-detected', cap: 'chat' }], accountSet: { pools: ['pool-a'], untagged: false }, modelClass: 'opus', ...over,
});
const coherent = { kind: 'coherent' } as const;

// ------------------------------------------------------------------------------------------------- the table and the verdict

export function invariantVerdictCases(m: M): Record<string, SuiteCase> {
  const measured = <F>(value: F) => ({ kind: 'measured', value }) as const;
  const EMPTY: Parameters<M['invariantVerdict']>[1] = {
    lines: measured([]),
    facts: {
      I2: measured({ reached: [], bound: [] }), I5: measured({ baseline: null, current: { kind: 'none' } }),
      I7: measured({ guard: coherent, rows: side(), journal: side() }), I17: measured({ timers: [], mails: new Map() }),
    },
  };
  return {
    'I9 answers simulator-only for every input': () => {
      expect(m.invariantVerdict('I9', EMPTY)).toEqual({ kind: 'simulator-only' });
      expect(m.invariantVerdict('I9', { lines: { kind: 'unmeasured', why: 'x' }, facts: {} })).toEqual({ kind: 'simulator-only' });
    },
    'a row with no predicate answers not-applicable with its waitsOn; tables-absent and predicate-not-built are told apart': () => {
      expect(m.invariantVerdict('I1', EMPTY)).toEqual({ kind: 'not-applicable', waitsOn: 'W3, the holds', why: 'tables-absent' });
      expect(m.invariantVerdict('I18', EMPTY)).toEqual({ kind: 'not-applicable', waitsOn: 'ticket invariant-i18-seal-predicate', why: 'predicate-not-built' });
      for (const n of ['I8', 'I13'] as const) expect(m.invariantVerdict(n, EMPTY)).toMatchObject({ kind: 'not-applicable', why: 'predicate-not-built' });
      for (const n of ['I3', 'I4', 'I6', 'I10', 'I11', 'I12', 'I14', 'I15', 'I16'] as const) {
        expect(m.invariantVerdict(n, EMPTY)).toMatchObject({ kind: 'not-applicable', why: 'tables-absent' });
      }
    },
    'the four running rows answer holds over empty facts': () => {
      for (const n of ['I2', 'I5', 'I7', 'I17'] as const) expect(m.invariantVerdict(n, EMPTY)).toEqual({ kind: 'holds' });
    },
    'an unmeasured facts arm answers unmeasured, never holds': () => {
      for (const n of ['I2', 'I5', 'I7', 'I17'] as const) {
        expect(m.invariantVerdict(n, { ...EMPTY, facts: { ...EMPTY.facts, [n]: { kind: 'unmeasured', why: 'a fixture' } } }))
          .toEqual({ kind: 'unmeasured', why: 'a fixture' });
      }
    },
    'an absent facts arm answers not-applicable, tables-absent, naming what is absent': () => {
      expect(m.invariantVerdict('I17', { ...EMPTY, facts: { ...EMPTY.facts, I17: { kind: 'absent', what: 'continuity_timers' } } }))
        .toEqual({ kind: 'not-applicable', waitsOn: 'continuity_timers', why: 'tables-absent' });
    },
    'no facts at all for a running row answers unmeasured': () => {
      expect(m.invariantVerdict('I2', { lines: measured([]), facts: {} })).toMatchObject({ kind: 'unmeasured' });
    },
    'the lines arm is read only by a row that reads lines': () => {
      const unreadLines = { ...EMPTY, lines: { kind: 'unmeasured', why: 'the sequence is closed' } } as const;
      expect(m.invariantVerdict('I5', unreadLines)).toEqual({ kind: 'unmeasured', why: 'the sequence is closed' });
      expect(m.invariantVerdict('I2', unreadLines)).toEqual({ kind: 'holds' });
      expect(m.invariantVerdict('I5', { ...EMPTY, lines: { kind: 'absent', what: 'overlord_sequence' } }))
        .toEqual({ kind: 'not-applicable', waitsOn: 'overlord_sequence', why: 'tables-absent' });
    },
    'a row\'s answer carries its predicate\'s findings and unmeasured subjects together': () => {
      const v = m.invariantVerdict('I17', { ...EMPTY, facts: { ...EMPTY.facts, I17: measured({
        timers: [{ id: 1, setter: 'lane-a', state: 'fired', mailId: null }, { id: 2, setter: 'lane-a', state: 'snoozed', mailId: null }],
        mails: new Map(),
      }) } });
      expect(v.kind).toBe('violated');
      expect(subjects(v)).toEqual(['timer:1']);
      expect(unmeasuredOf(v)).toEqual(['timer:2']);
    },
    'measuredVerdict: findings win, then unmeasured, then holds': () => {
      const f = { invariant: 'I2' as const, subject: 'ask:1', seq: null, message: 'x' };
      const u = { subject: 'ask:2', why: 'y' };
      expect(m.measuredVerdict([f], [u])).toEqual({ kind: 'violated', findings: [f], unmeasured: [u] });
      expect(m.measuredVerdict([], [u])).toEqual({ kind: 'holds-where-measured', unmeasured: [u] });
      expect(m.measuredVerdict([], [])).toEqual({ kind: 'holds' });
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------- I2

export function i2Cases(m: M): Record<string, SuiteCase> {
  const run = (f: I2) => m.i2Structural([], f);
  return {
    'no reach-stamped source and no bound row holds': () => { expect(run({ reached: [], bound: [] })).toEqual({ kind: 'holds' }); },
    'a stamped item with its one outbox row holds, and a stamped ask the same': () => {
      expect(run({ reached: [{ kind: 'item', id: 4 }, { kind: 'ask', id: 4 }], bound: [{ sourceKind: 'item', sourceId: 4 }, { sourceKind: 'ask', sourceId: 4 }] }))
        .toEqual({ kind: 'holds' });
    },
    'a stamped item without an outbox row is violated, keyed item:<id>': () => {
      expect(subjects(run({ reached: [{ kind: 'item', id: 4 }], bound: [] }))).toEqual(['item:4']);
    },
    'two bound rows for one stamped source are violated (exactly one)': () => {
      expect(subjects(run({ reached: [{ kind: 'ask', id: 2 }], bound: [{ sourceKind: 'ask', sourceId: 2 }, { sourceKind: 'ask', sourceId: 2 }] }))).toEqual(['ask:2']);
    },
    'a bound outbox row whose source has no reach stamp is violated; an ask and an item of one id are two sources': () => {
      expect(subjects(run({ reached: [{ kind: 'item', id: 9 }], bound: [{ sourceKind: 'item', sourceId: 9 }, { sourceKind: 'ask', sourceId: 9 }] }))).toEqual(['ask:9']);
    },
    'a bound row of a source kind I2 does not name is unmeasured, never violated': () => {
      const v = run({ reached: [], bound: [{ sourceKind: 'grant', sourceId: 1 }] });
      expect(v).toMatchObject({ kind: 'holds-where-measured' });
      expect(unmeasuredOf(v)).toEqual(['grant:1']);
    },
    'monotone: an unknown bound row never removes a finding or makes holds': () => {
      const base = { reached: [{ kind: 'item' as const, id: 1 }], bound: [] };
      monotone(run(base), run({ ...base, bound: [{ sourceKind: 'grant', sourceId: 1 }] }));
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------- I5

export function i5Cases(m: M): Record<string, SuiteCase> {
  const none = { kind: 'none' } as const;
  const run = (lines: SequenceWireLine[], f: Partial<I5> = {}) => m.i5Term(lines, { baseline: null, current: none, ...f });
  return {
    'a session line from the bound session holds; server and operator lines are never read': () => {
      expect(run([des(1, 'overlord-a', 'live'), act(2, 'overlord-a'), line(3, { actor: 'overlord-b', actorKind: 'server' }),
        line(4, { actor: 'overlord-b', actorKind: 'operator' })])).toEqual({ kind: 'holds' });
    },
    'a session line from another session is violated, keyed by its seq': () => {
      const v = run([des(1, 'overlord-a', 'live'), act(2, 'overlord-b')]);
      expect(subjects(v)).toEqual(['seq:2']);
      expect(v.kind === 'violated' && v.findings[0]!.seq).toBe(2);
    },
    'a session line under a retired binding is violated': () => {
      expect(subjects(run([des(1, 'overlord-a', 'live'), des(2, 'overlord-a', 'retired'), act(3, 'overlord-a')]))).toEqual(['seq:3']);
    },
    'a window that starts mid-term reads its first lines against the kept designation line': () => {
      expect(run([act(10, 'overlord-a'), act(11, 'overlord-a')], { baseline: des(2, 'overlord-a', 'live') })).toEqual({ kind: 'holds' });
      expect(subjects(run([act(10, 'overlord-b')], { baseline: des(2, 'overlord-a', 'live') }))).toEqual(['seq:10']);
      expect(subjects(run([act(10, 'overlord-a')], { baseline: des(2, 'overlord-a', 'retired') }))).toEqual(['seq:10']);
    },
    'a kept line also in the window is read once, in its place': () => {
      expect(run([des(2, 'overlord-a', 'live'), act(3, 'overlord-a')], { baseline: des(2, 'overlord-a', 'live') })).toEqual({ kind: 'holds' });
    },
    'during a pending rebind the standing body still binds; a pending or failed line never moves the binding': () => {
      const lines = [des(1, 'overlord-a', 'live'), des(2, 'overlord-b', 'pending'), act(3, 'overlord-a'), des(4, 'overlord-b', 'failed'), act(5, 'overlord-a')];
      expect(run(lines)).toEqual({ kind: 'holds' });
      expect(subjects(run([...lines, act(6, 'overlord-b')]))).toEqual(['seq:6']);
    },
    'after a rebind goes live, in either stamp order, the new body binds and the old one does not': () => {
      const goLiveThenRetire = [des(1, 'overlord-a', 'live'), des(2, 'overlord-b', 'pending'), des(3, 'overlord-b', 'live'), des(4, 'overlord-a', 'retired')];
      const retireThenGoLive = [des(1, 'overlord-a', 'live'), des(2, 'overlord-b', 'pending'), des(3, 'overlord-a', 'retired'), des(4, 'overlord-b', 'live')];
      for (const ls of [goLiveThenRetire, retireThenGoLive]) {
        expect(run([...ls, act(5, 'overlord-b')])).toEqual({ kind: 'holds' });
        expect(subjects(run([...ls, act(5, 'overlord-a')]))).toEqual(['seq:5']);
      }
    },
    'a retired line read with no binding known yet leaves nothing bound': () => {
      expect(subjects(run([des(1, 'overlord-a', 'retired'), act(2, 'overlord-a')], { current: { kind: 'bound', sessionId: 'overlord-a' } }))).toEqual(['seq:2']);
    },
    'a retired line of another id ends nothing': () => {
      expect(run([des(1, 'overlord-a', 'live'), des(2, 'overlord-b', 'retired'), act(3, 'overlord-a')])).toEqual({ kind: 'holds' });
    },
    'with no designation line before it and none after, the current binding decides': () => {
      expect(run([act(1, 'overlord-a')], { current: { kind: 'bound', sessionId: 'overlord-a' } })).toEqual({ kind: 'holds' });
      expect(subjects(run([act(1, 'overlord-b')], { current: { kind: 'bound', sessionId: 'overlord-a' } }))).toEqual(['seq:1']);
      expect(subjects(run([act(1, 'overlord-a')], { current: none }))).toEqual(['seq:1']);
    },
    'with no designation line before it but one after, the line is unmeasured': () => {
      const v = run([act(1, 'overlord-a'), des(2, 'overlord-a', 'live')], { current: { kind: 'bound', sessionId: 'overlord-a' } });
      expect(v.kind).toBe('holds-where-measured');
      expect(unmeasuredOf(v)).toEqual(['seq:1']);
    },
    'an unreadable current binding leaves such a line unmeasured, never violated': () => {
      const v = run([act(1, 'overlord-b')], { current: { kind: 'unmeasured', why: 'the row is unreadable' } });
      expect(v.kind).toBe('holds-where-measured');
    },
    'a ladder-latch line whose actor text names a session but whose kind is server is never read as that session\'s act': () => {
      expect(run([des(1, 'overlord-a', 'live'), act(2, 'overlord-b', { actorKind: 'server' })])).toEqual({ kind: 'holds' });
    },
    'a message line (always server) moved by another session is never read': () => {
      expect(run([des(1, 'overlord-a', 'live'), line(2, { kind: 'message', id: '7', state: 'picked-up', actor: 'mail-lane', actorKind: 'server' })]))
        .toEqual({ kind: 'holds' });
    },
    'a designation line is a move of the binding, not a write under it': () => {
      expect(run([des(1, 'overlord-a', 'live'), des(2, 'overlord-b', 'pending', { actor: 'overlord-b', actorKind: 'session' })])).toEqual({ kind: 'holds' });
    },
    'a known:false line whose actor may be a session is unmeasured for I5; one marked server or operator is not read': () => {
      const v = run([des(1, 'overlord-a', 'live'), act(2, 'overlord-b', { kind: 'grant', known: false }), act(3, 'overlord-b', { kind: 'grant', known: false, actorKind: 'unknown' })]);
      expect(unmeasuredOf(v)).toEqual(['seq:2', 'seq:3']);
      expect(run([des(1, 'overlord-a', 'live'), line(2, { kind: 'grant', known: false, actorKind: 'server' })])).toEqual({ kind: 'holds' });
    },
    'a designation line this build cannot name makes the binding unknown until the next known one': () => {
      const v = run([des(1, 'overlord-a', 'live'), des(2, 'overlord-a', 'suspended', { known: false }), act(3, 'overlord-a'), des(4, 'overlord-a', 'live'), act(5, 'overlord-b')]);
      expect(unmeasuredOf(v)).toEqual(['seq:3']);
      expect(subjects(v)).toEqual(['seq:5']);
    },
    'lines given out of order are read in seq order': () => {
      expect(run([act(3, 'overlord-a'), des(1, 'overlord-a', 'live'), des(4, 'overlord-a', 'retired'), act(2, 'overlord-a')])).toEqual({ kind: 'holds' });
    },
    'monotone: adding an unknown line never removes a finding or makes holds': () => {
      const base = [des(1, 'overlord-a', 'live'), act(2, 'overlord-b')];
      monotone(run(base), run([...base, act(3, 'overlord-c', { kind: 'grant', known: false })]));
      monotone(run([act(1, 'overlord-b')], { current: { kind: 'bound', sessionId: 'overlord-a' } }),
        run([act(1, 'overlord-b'), line(2, { kind: 'grant', known: false, actorKind: 'unknown' })], { current: { kind: 'bound', sessionId: 'overlord-a' } }));
    },
    'a designation line this build cannot name, after a violated line, turns it unmeasured, never holds (review 3843 F7)': () => {
      const bound = { current: { kind: 'bound', sessionId: 'overlord-a' } } as const;
      expect(subjects(run([act(1, 'overlord-b')], bound))).toEqual(['seq:1']);
      const v = run([act(1, 'overlord-b'), des(2, 'overlord-b', 'handed', { known: false })], bound);
      expect(v.kind).toBe('holds-where-measured');
      expect(unmeasuredOf(v)).toEqual(['seq:1']);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------- I7

export function i7Cases(m: M): Record<string, SuiteCase> {
  const run = (rows: RestoreSide, journal: RestoreSide, guard: I7['guard'] = coherent) => m.i7Authority([], { guard, rows, journal });
  return {
    'the same two sides under a coherent guard hold; both absent (the narrowest on each side) hold': () => {
      expect(run(side(), side())).toEqual({ kind: 'holds' });
      const narrowest = side({ binding: null, term: 0, operatorRung: 'off', latches: [], accountSet: { pools: [], untagged: false }, modelClass: 'opus' });
      expect(run(narrowest, narrowest)).toEqual({ kind: 'holds' });
    },
    'any guard but coherent answers unmeasured with its cause, never violated, however wide the rows': () => {
      const wide = side({ operatorRung: 'full', modelClass: 'fable' });
      expect(run(wide, side(), { kind: 'rolled-back', cause: 'trailing' })).toEqual({ kind: 'unmeasured', why: 'the authority guard reads rolled-back: trailing' });
      expect(run(wide, side(), { kind: 'unmeasured', why: 'journal' })).toEqual({ kind: 'unmeasured', why: 'the authority guard reads unmeasured: journal' });
    },
    'a rung written without its record (rows above the journal) is violated; the same rung, or a lower one, holds': () => {
      expect(subjects(run(side({ operatorRung: 'full' }), side()))).toEqual(['operatorRung']);
      expect(run(side({ operatorRung: 'chat' }), side())).toEqual({ kind: 'holds' });
    },
    'one-sided rung: an absent rung reads off on both sides alike': () => {
      expect(subjects(run(side({ operatorRung: 'chat' }), side({ operatorRung: 'off' })))).toEqual(['operatorRung']);
      expect(run(side({ operatorRung: 'off' }), side({ operatorRung: 'chat' }))).toEqual({ kind: 'holds' });
    },
    'a model class that differs is violated, either way': () => {
      expect(subjects(run(side({ modelClass: 'fable' }), side()))).toEqual(['modelClass']);
      expect(subjects(run(side(), side({ modelClass: 'fable' })))).toEqual(['modelClass']);
    },
    'a term that differs is violated, either way': () => {
      expect(subjects(run(side({ term: 4 }), side()))).toEqual(['term']);
      expect(subjects(run(side({ term: 2 }), side()))).toEqual(['term']);
    },
    'the term and the model class must equal the journal\'s: rows ahead of the journal, and behind it, are violated (review 3843 F3)': () => {
      expect(subjects(run(side({ term: 4, modelClass: 'opus' }), side({ term: 3, modelClass: 'fable' })))).toEqual(['term', 'modelClass']);
      expect(subjects(run(side({ term: 2, modelClass: 'fable' }), side({ term: 3, modelClass: 'opus' })))).toEqual(['term', 'modelClass']);
    },
    'the binding: the rows bind and the journal does not, or another session or generation, is violated; the journal binding alone holds': () => {
      expect(subjects(run(side(), side({ binding: null })))).toEqual(['binding']);
      expect(subjects(run(side(), side({ binding: { sessionId: 'overlord-b', generation: 'gen-1' } })))).toEqual(['binding']);
      expect(subjects(run(side(), side({ binding: { sessionId: 'overlord-a', generation: 'gen-2' } })))).toEqual(['binding']);
      expect(run(side({ binding: null }), side())).toEqual({ kind: 'holds' });
    },
    'the account set: a pool the journal lacks, or untagged where the journal is not, is violated; a narrower set holds': () => {
      expect(subjects(run(side({ accountSet: { pools: ['pool-a', 'pool-b'], untagged: false } }), side()))).toEqual(['accountSet']);
      expect(subjects(run(side({ accountSet: { pools: ['pool-a'], untagged: true } }), side()))).toEqual(['accountSet']);
      expect(run(side({ accountSet: { pools: [], untagged: false } }), side({ accountSet: { pools: ['pool-a'], untagged: true } }))).toEqual({ kind: 'holds' });
    },
    'a latch the journal holds that is not standing is violated; one standing at a wider cap too; a latch only the rows hold is narrower': () => {
      expect(subjects(run(side({ latches: [] }), side()))).toEqual(['latch:restore-detected']);
      expect(subjects(run(side({ latches: [{ cause: 'restore-detected', cap: 'advise' }] }), side()))).toEqual(['latch:restore-detected']);
      expect(run(side({ latches: [{ cause: 'restore-detected', cap: 'off' }, { cause: 'inv-a', cap: 'chat' }] }), side())).toEqual({ kind: 'holds' });
    },
    'every differing field is its own finding': () => {
      expect(subjects(run(side({ term: 9, operatorRung: 'full', latches: [] }), side()))).toEqual(['term', 'operatorRung', 'latch:restore-detected']);
    },
  };
}

// ------------------------------------------------------------------------------------------------------------------ I17

export function i17Cases(m: M): Record<string, SuiteCase> {
  const mail = (fromId: string, toId: string) => ({ fromId, toId });
  const run = (timers: I17['timers'], mails: [number, { fromId: string; toId: string }][] = []) => m.i17Timers([], { timers, mails: new Map(mails) });
  return {
    'one mail from the timer sender to the setter carrying three fired timers holds; a role setter too': () => {
      expect(run([1, 2, 3].map((id) => ({ id, setter: 'lane-a', state: 'fired', mailId: 50 })), [[50, mail('timer', 'lane-a')]])).toEqual({ kind: 'holds' });
      expect(run([{ id: 4, setter: 'overlord', state: 'fired', mailId: 51 }], [[51, mail('timer', 'overlord')]])).toEqual({ kind: 'holds' });
    },
    'a fired timer with no mail id is violated, keyed timer:<id>': () => {
      expect(subjects(run([{ id: 1, setter: 'lane-a', state: 'fired', mailId: null }]))).toEqual(['timer:1']);
    },
    'a fired timer naming no mail is violated': () => {
      expect(subjects(run([{ id: 1, setter: 'lane-a', state: 'fired', mailId: 99 }]))).toEqual(['timer:1']);
    },
    'a fired timer whose mail is not from the timer sender, or not to its setter, is violated': () => {
      expect(subjects(run([{ id: 1, setter: 'lane-a', state: 'fired', mailId: 5 }], [[5, mail('lane-b', 'lane-a')]]))).toEqual(['timer:1']);
      expect(subjects(run([{ id: 2, setter: 'lane-a', state: 'fired', mailId: 5 }], [[5, mail('timer', 'lane-b')]]))).toEqual(['timer:2']);
    },
    'a cancelled timer with a mail id is violated; without one it holds': () => {
      expect(subjects(run([{ id: 1, setter: 'lane-a', state: 'cancelled', mailId: 5 }], [[5, mail('timer', 'lane-a')]]))).toEqual(['timer:1']);
      expect(run([{ id: 1, setter: 'lane-a', state: 'cancelled', mailId: null }])).toEqual({ kind: 'holds' });
    },
    'a state word this build cannot name is unmeasured, never violated': () => {
      const v = run([{ id: 1, setter: 'lane-a', state: 'snoozed', mailId: null }]);
      expect(v.kind).toBe('holds-where-measured');
      expect(unmeasuredOf(v)).toEqual(['timer:1']);
    },
    'monotone: an unknown timer never removes a finding or makes holds': () => {
      const base: I17['timers'] = [{ id: 1, setter: 'lane-a', state: 'fired', mailId: null }];
      monotone(run(base), run([...base, { id: 2, setter: 'lane-a', state: 'snoozed', mailId: null }]));
    },
  };
}

// ------------------------------------------------------------------------------------------------------- findingMoves

export function findingMovesCases(m: M): Record<string, SuiteCase> {
  const f = (invariant: 'I2' | 'I5' | 'I17', subject: string) => ({ invariant, subject, seq: null, message: 'x' });
  const verdicts = (entries: [InvariantName, Verdict][]): ReadonlyMap<InvariantName, Verdict> => new Map(entries);
  return {
    'a new finding is recorded; one with an open row is skipped': () => {
      const v = verdicts([['I17', { kind: 'violated', findings: [f('I17', 'timer:1'), f('I17', 'timer:2')], unmeasured: [] }]]);
      expect(m.findingMoves(v, [{ id: 7, invariant: 'I17', subject: 'timer:1' }])).toEqual({ record: [f('I17', 'timer:2')], resolve: [] });
    },
    'two findings of one subject in one pass are one': () => {
      const v = verdicts([['I17', { kind: 'violated', findings: [f('I17', 'timer:1'), { ...f('I17', 'timer:1'), message: 'y' }], unmeasured: [] }]]);
      expect(m.findingMoves(v, []).record).toHaveLength(1);
    },
    'a subject measured holding resolves its open row: its invariant holds, or a verdict that names it in neither list': () => {
      expect(m.findingMoves(verdicts([['I17', { kind: 'holds' }]]), [{ id: 7, invariant: 'I17', subject: 'timer:1' }]).resolve).toEqual([7]);
      expect(m.findingMoves(verdicts([['I17', { kind: 'violated', findings: [f('I17', 'timer:2')], unmeasured: [] }]]),
        [{ id: 7, invariant: 'I17', subject: 'timer:1' }]).resolve).toEqual([7]);
      expect(m.findingMoves(verdicts([['I17', { kind: 'holds-where-measured', unmeasured: [{ subject: 'timer:3', why: 'x' }] }]]),
        [{ id: 7, invariant: 'I17', subject: 'timer:1' }]).resolve).toEqual([7]);
    },
    'a subject in an unmeasured list, and an unmeasured, not-applicable or simulator-only verdict, resolve nothing': () => {
      const open = [{ id: 7, invariant: 'I17', subject: 'timer:1' }];
      expect(m.findingMoves(verdicts([['I17', { kind: 'holds-where-measured', unmeasured: [{ subject: 'timer:1', why: 'x' }] }]]), open).resolve).toEqual([]);
      expect(m.findingMoves(verdicts([['I17', { kind: 'violated', findings: [f('I17', 'timer:2')], unmeasured: [{ subject: 'timer:1', why: 'x' }] }]]), open).resolve).toEqual([]);
      expect(m.findingMoves(verdicts([['I17', { kind: 'unmeasured', why: 'x' }]]), open).resolve).toEqual([]);
      expect(m.findingMoves(verdicts([['I17', { kind: 'not-applicable', waitsOn: 'x', why: 'tables-absent' }]]), open).resolve).toEqual([]);
      expect(m.findingMoves(verdicts([['I9', { kind: 'simulator-only' }]]), [{ id: 8, invariant: 'I9', subject: 's' }]).resolve).toEqual([]);
    },
    'an open row of an invariant the pass did not ask, or of a name this build cannot name, resolves nothing': () => {
      expect(m.findingMoves(verdicts([['I2', { kind: 'holds' }]]), [{ id: 7, invariant: 'I17', subject: 'timer:1' }, { id: 8, invariant: 'I99', subject: 's' }]).resolve).toEqual([]);
    },
    'a finding still violated keeps its row open and is not recorded again': () => {
      const v = verdicts([['I17', { kind: 'violated', findings: [f('I17', 'timer:1')], unmeasured: [] }]]);
      expect(m.findingMoves(v, [{ id: 7, invariant: 'I17', subject: 'timer:1' }])).toEqual({ record: [], resolve: [] });
    },
    'a finding after its row resolved is recorded again (a new episode)': () => {
      const v = verdicts([['I17', { kind: 'violated', findings: [f('I17', 'timer:1')], unmeasured: [] }]]);
      expect(m.findingMoves(v, []).record).toEqual([f('I17', 'timer:1')]);
    },
    'one subject key under two invariants is two keys': () => {
      const v = verdicts([['I2', { kind: 'violated', findings: [f('I2', 's')], unmeasured: [] }], ['I5', { kind: 'violated', findings: [f('I5', 's')], unmeasured: [] }]]);
      expect(m.findingMoves(v, [{ id: 7, invariant: 'I2', subject: 's' }]).record).toEqual([f('I5', 's')]);
    },
  };
}

// -------------------------------------------------------------------------------- the runner's questions (Task 6, L1)

export function invariantPassDueCases(m: M): Record<string, SuiteCase> {
  const last = { head: 5, mode: 'shadow' as const, atMono: 1_000 };
  return {
    'the first pass runs': () => { expect(m.invariantPassDue({ head: 5, mode: 'shadow', atMono: 1_000 }, null, 600_000)).toBe(true); },
    'the same head, the same mode, inside the table sweep: no pass': () => {
      expect(m.invariantPassDue({ head: 5, mode: 'shadow', atMono: 1_000 + 599_999 }, last, 600_000)).toBe(false);
    },
    'the table sweep elapsed, at its edge: a pass': () => {
      expect(m.invariantPassDue({ head: 5, mode: 'shadow', atMono: 1_000 + 600_000 }, last, 600_000)).toBe(true);
    },
    'a moved head runs at once': () => { expect(m.invariantPassDue({ head: 6, mode: 'shadow', atMono: 1_001 }, last, 600_000)).toBe(true); },
    'an unreadable head runs (the gather says why)': () => {
      expect(m.invariantPassDue({ head: 'unmeasured', mode: 'shadow', atMono: 1_001 }, last, 600_000)).toBe(true);
      expect(m.invariantPassDue({ head: 'unmeasured', mode: 'shadow', atMono: 1_001 }, { ...last, head: 'unmeasured' }, 600_000)).toBe(true);
    },
    'a mode that changed runs at once': () => { expect(m.invariantPassDue({ head: 5, mode: 'live', atMono: 1_001 }, last, 600_000)).toBe(true); },
  };
}

export function latchedOfCases(m: M): Record<string, SuiteCase> {
  return {
    'a refused raise is null: no live finding': () => { expect(m.latchedOf({ ok: false })).toBeNull(); },
    'a standing latch is standing': () => { expect(m.latchedOf({ ok: true, changed: false })).toBe('standing'); },
    'a journalled raise is raised; one written as its row alone is row-only': () => {
      expect(m.latchedOf({ ok: true, changed: true, journalled: true })).toBe('raised');
      expect(m.latchedOf({ ok: true, changed: true, journalled: false })).toBe('row-only');
    },
  };
}

export function verdictWordChangesCases(m: M): Record<string, SuiteCase> {
  const v = (entries: [InvariantName, Verdict][]): ReadonlyMap<InvariantName, Verdict> => new Map(entries);
  return {
    'the first pass names every invariant it asked, from nothing': () => {
      expect(m.verdictWordChanges(null, v([['I2', { kind: 'holds' }], ['I9', { kind: 'simulator-only' }]])))
        .toEqual([{ name: 'I2', from: null, to: 'holds' }, { name: 'I9', from: null, to: 'simulator-only' }]);
    },
    'an unchanged word is not named; a changed one is, in table order': () => {
      const prev = v([['I17', { kind: 'holds' }], ['I2', { kind: 'holds' }]]);
      const next = v([['I17', { kind: 'unmeasured', why: 'x' }], ['I2', { kind: 'holds' }]]);
      expect(m.verdictWordChanges(prev, next)).toEqual([{ name: 'I17', from: 'holds', to: 'unmeasured' }]);
    },
    'a new finding under a word already violated changes no word': () => {
      const f = { invariant: 'I2' as const, subject: 'ask:1', seq: null, message: 'x' };
      expect(m.verdictWordChanges(v([['I2', { kind: 'violated', findings: [f], unmeasured: [] }]]),
        v([['I2', { kind: 'violated', findings: [f, { ...f, subject: 'ask:2' }], unmeasured: [] }]]))).toEqual([]);
    },
  };
}

// -------------------------------------------------------------------------------------------------------- mutant sets

const set = (cases: (m: M) => Record<string, SuiteCase>, mutants: MutantSet<M>['mutants']): MutantSet<M> =>
  ({ modulePath: MODULE, mutants, suite: cases });

const VERDICT_SET = set(invariantVerdictCases, [
  { id: 'V1 I9 runs', old: "if (row.w1 === 'simulator-only') return { kind: 'simulator-only' };", new: '' },
  { id: 'V2 unmeasured falls through to the predicate', old: "  if (un !== undefined && un.kind === 'unmeasured') return { kind: 'unmeasured', why: un.why };\n", new: '' },
  { id: 'V3 absent falls through', old: "  if (absent !== undefined && absent.kind === 'absent') return { kind: 'not-applicable', waitsOn: absent.what, why: 'tables-absent' };\n", new: '' },
  { id: 'V4 no facts holds', old: "if (facts === undefined) return { kind: 'unmeasured', why: 'the gatherer gave no facts for this row' };", new: "if (facts === undefined) return { kind: 'holds' };" },
  { id: 'V5 lines never read', old: 'const reads: FactsRead<unknown>[] = p.readsLines ? [input.lines, facts] : [facts];', new: 'const reads: FactsRead<unknown>[] = [facts];' },
  { id: 'V6 lines read by every row', old: 'const reads: FactsRead<unknown>[] = p.readsLines ? [input.lines, facts] : [facts];', new: 'const reads: FactsRead<unknown>[] = [input.lines, facts];' },
  { id: 'V7 one reason for every not-applicable row', old: "why: row.w1 === 'runs' ? 'predicate-not-built' : row.w1", new: "why: 'tables-absent'" },
  { id: 'V8 violated drops its unmeasured list', old: "if (findings.length > 0) return { kind: 'violated', findings, unmeasured };", new: "if (findings.length > 0) return { kind: 'violated', findings, unmeasured: [] };" },
  { id: 'V9 unmeasured subjects read as holds', old: "if (unmeasured.length > 0) return { kind: 'holds-where-measured', unmeasured };", new: '' },
]);

const I2_SET = set(i2Cases, [
  { id: 'A1 any count of bound rows will do', old: 'if (n !== 1) findings.push', new: 'if (n === 0) findings.push' },
  { id: 'A2 an unstamped bound row is fine', old: "    else findings.push({ invariant: 'I2', subject, seq: null, message: 'a bound outbox row whose source has no reach stamp' });\n", new: '' },
  { id: 'A3 an unknown kind is violated', old: "if (kind !== 'ask' && kind !== 'item') unmeasured.push", new: 'if (false) unmeasured.push' },
  { id: 'A4 a source is its id alone', old: 'const key = (kind: string, id: number): string => `${kind}:${id}`;', new: 'const key = (_kind: string, id: number): string => `ask:${id}`;' },
]);

const I5_SET = set(i5Cases, [
  { id: 'B1 every session line holds', old: 'else if (l.actor !== bound) findings.push', new: 'else if (false) findings.push' },
  { id: 'B2 nothing bound is fine', old: "if (bound === null) findings.push({ invariant: 'I5', subject, seq: l.seq, message: `a session line from ${l.actor} while nothing is bound` });\n    else ", new: 'if (bound === null) {} else ' },
  { id: 'B3 a retire ends nothing', old: "else if (l.state === 'retired' && binding.kind === 'known' && binding.sessionId === l.id) binding = { kind: 'known', sessionId: null };", new: '' },
  { id: 'B4 any retire ends the binding', old: "l.state === 'retired' && binding.kind === 'known' && binding.sessionId === l.id", new: "l.state === 'retired' && binding.kind === 'known'" },
  { id: 'B5 pending binds', old: "if (l.state === 'live') binding", new: "if (l.state === 'live' || l.state === 'pending') binding" },
  { id: 'B6 the baseline is ignored', old: 'const all = f.baseline !== null && !window.some((l) => l.seq === f.baseline!.seq) ? [f.baseline, ...window] : window;', new: 'const all = window;' },
  { id: 'B7 arrival order', old: 'const window = [...lines].sort((a, b) => a.seq - b.seq);', new: 'const window = [...lines];' },
  { id: 'B8 server lines are read', old: "if (l.actorKind === 'server' || l.actorKind === 'operator') continue;", new: "if (l.actorKind === 'operator') continue;" },
  { id: 'B9 an unknown line is read as known', old: "if (!l.known || l.actorKind !== 'session') {", new: "if (l.actorKind !== 'session') {" },
  { id: 'B10 an unknown designation line is read', old: "if (!l.known) { binding = { kind: 'unknown', why: `designation line ${l.seq} is of a state this build cannot name` }; continue; }", new: '' },
  { id: 'B11 the current binding answers every line', old: 'else if (l.seq > lastDesignation && f.current.kind', new: 'else if (f.current.kind' },
  { id: 'B13 a retire read before any binding binds nothing known', old: "      else if (l.state === 'retired' && binding.kind === 'unknown') binding = { kind: 'known', sessionId: null };\n", new: '' },
  { id: 'B12 designation lines are writes', old: "      continue;\n    }\n    if (l.actorKind === 'server'", new: "    }\n    if (l.actorKind === 'server'" },
]);

const I7_SET = set(i7Cases, [
  { id: 'C1 read under any guard', old: "  if (f.guard.kind !== 'coherent') {", new: '  if (false) {' },
  { id: 'C2 the rung compared with >=', old: 'if (rungRank(db.operatorRung) > rungRank(j.operatorRung))', new: 'if (rungRank(db.operatorRung) >= rungRank(j.operatorRung))' },
  { id: 'C3 the rung never compared', old: 'if (rungRank(db.operatorRung) > rungRank(j.operatorRung))', new: 'if (false)' },
  { id: 'C4 the term never compared', old: "if (db.term !== j.term) found('term'", new: "if (false) found('term'" },
  { id: 'C5 the model never compared', old: 'if (db.modelClass !== j.modelClass)', new: 'if (false)' },
  { id: 'C6 untagged never compared', old: ' || (db.accountSet.untagged && !j.accountSet.untagged)', new: '' },
  { id: 'C7 the pools never compared', old: 'db.accountSet.pools.some((p) => !j.accountSet.pools.includes(p)) || ', new: '' },
  { id: 'C8 a missing latch is fine', old: "    if (standing === undefined) found(`latch:${l.cause}`, 'a latch the journal holds is not standing');\n    else if", new: '    if (standing === undefined) {} else if' },
  { id: 'C9 a wider latch cap is fine', old: 'else if (rungRank(standing.cap) > rungRank(l.cap))', new: 'else if (false)' },
  { id: 'C10 the generation never compared', old: ' || j.binding.generation !== db.binding.generation', new: '' },
  { id: 'C11 a journal with no binding is fine', old: 'j.binding === null || j.binding.sessionId', new: 'j.binding !== null && j.binding.sessionId' },
]);

const I17_SET = set(i17Cases, [
  { id: 'D1 a cancelled timer with mail is fine', old: "if (t.state === 'cancelled') { if (t.mailId !== null) found(", new: "if (t.state === 'cancelled') { if (false) found(" },
  { id: 'D2 an unknown state is violated', old: "if (t.state !== 'fired') { unmeasured.push(", new: "if (t.state !== 'fired') { found('x'); unmeasured.push(" },
  { id: 'D3 a fired timer with no mail is fine', old: "if (t.mailId === null) { found('a fired timer names no mail'); continue; }", new: 'if (t.mailId === null) continue;' },
  { id: 'D4 a missing mail is fine', old: 'if (mail === undefined) found(', new: 'if (mail === undefined) {} else if (false) found(' },
  { id: 'D5 any sender', old: 'else if (mail.fromId !== TIMER_MAIL_SENDER)', new: 'else if (false)' },
  { id: 'D6 any recipient', old: 'else if (mail.toId !== t.setter)', new: 'else if (false)' },
]);

const MOVES_SET = set(findingMovesCases, [
  { id: 'E1 an open finding is recorded again', old: 'if (openKeys.has(key) || seen.has(key)) continue;', new: 'if (seen.has(key)) continue;' },
  { id: 'E2 one subject twice in a pass', old: 'if (openKeys.has(key) || seen.has(key)) continue;', new: 'if (openKeys.has(key)) continue;' },
  { id: 'E3 holds resolves nothing', old: "if (v.kind === 'holds') { resolve.push(o.id); continue; }", new: '' },
  { id: 'E4 an unmeasured subject resolves', old: 'if (!still && !unknown) resolve.push(o.id);', new: 'if (!still) resolve.push(o.id);' },
  { id: 'E5 an unmeasured verdict resolves', old: "if (v.kind !== 'violated' && v.kind !== 'holds-where-measured') continue;", new: "if (v.kind !== 'violated' && v.kind !== 'holds-where-measured') { resolve.push(o.id); continue; }" },
  { id: 'E6 a verdict the pass did not ask resolves', old: '    if (v === undefined) continue;\n', new: "    if (v === undefined) { resolve.push(o.id); continue; }\n" },
  { id: 'E7 the key is the subject alone', old: 'const k = (invariant: string, subject: string): string => `${invariant}\\u0000${subject}`;', new: 'const k = (_invariant: string, subject: string): string => subject;' },
]);

const DUE_SET = set(invariantPassDueCases, [
  { id: 'F1 a mode change waits', old: 'if (last === null || now.mode !== last.mode) return true;', new: 'if (last === null) return true;' },
  { id: 'F2 a moved head waits', old: "if (now.head === 'unmeasured' || now.head !== last.head) return true;", new: "if (now.head === 'unmeasured') return true;" },
  { id: 'F3 an unread head waits', old: "if (now.head === 'unmeasured' || now.head !== last.head) return true;", new: "if (now.head !== 'unmeasured' && now.head !== last.head) return true;" },
  { id: 'F4 the sweep edge is late', old: 'return now.atMono - last.atMono >= tableSweepMs;', new: 'return now.atMono - last.atMono > tableSweepMs;' },
  { id: 'F5 never on the cadence', old: 'return now.atMono - last.atMono >= tableSweepMs;', new: 'return false;' },
]);

const LATCHED_SET = set(latchedOfCases, [
  { id: 'G1 a refusal is standing', old: '  if (!w.ok) return null;\n', new: '' },
  { id: 'G2 a standing latch is raised', old: "if (!w.changed) return 'standing';", new: "if (!w.changed) return 'raised';" },
  { id: 'G3 row-only reads raised', old: "return w.journalled ? 'raised' : 'row-only';", new: "return 'raised';" },
]);

const CHANGES_SET = set(verdictWordChangesCases, [
  { id: 'H1 every word is a change', old: 'return from === to ? [] : [{ name, from, to }];', new: 'return [{ name, from, to }];' },
  { id: 'H2 the first pass is silent', old: 'const from = prev?.get(name)?.kind ?? null;', new: "const from = prev?.get(name)?.kind ?? to;" },
]);

export const INVARIANT_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [`${KEY}#invariantVerdict`]: VERDICT_SET as MutantSet<never>,
  [`${KEY}#i2Structural`]: I2_SET as MutantSet<never>,
  [`${KEY}#i5Term`]: I5_SET as MutantSet<never>,
  [`${KEY}#i7Authority`]: I7_SET as MutantSet<never>,
  [`${KEY}#i17Timers`]: I17_SET as MutantSet<never>,
  [`${KEY}#findingMoves`]: MOVES_SET as MutantSet<never>,
  [`${KEY}#invariantPassDue`]: DUE_SET as MutantSet<never>,
  [`${KEY}#latchedOf`]: LATCHED_SET as MutantSet<never>,
  [`${KEY}#verdictWordChanges`]: CHANGES_SET as MutantSet<never>,
};
