// Overlord W2, the decision-model port (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 2):
// the cases over `planDecision`, `serveCap`, `maintainCap`, `bandOf`, `isPrivateAddress`, `isLiteralHost`,
// `encodeDecisionRequest`, `decisionRequestGroups`, `readDecisionAnswers`, `applyDecision` and `gateOutcome` (PR B, Task 8) and,
// in the second half, over `decisionLines.ts` (Tasks 6 to 8), each over hand-built inputs. `decision-model-decide.test.ts`
// and `decision-model-lines.test.ts` run them against the real modules and `sim/decisionModelSets.ts` against each mutant,
// so one list of cases is both the suite and the mutation floor's judge.
import { expect } from 'vitest';
import {
  DECISION_BANDS, DECISION_OUTCOMES, DECISION_QUESTIONS, DECISION_ROW_DEFAULT, DECISION_ROW_IDS,
  type DecisionBand, type DecisionCheck, type DecisionRowId, type DecisionRowSide,
} from '../../shared/decisionModel.js';
import { upperBound95 } from '../../shared/binomialBound.js';
import type * as DecisionModel from '../src/coord/decisionModel.js';
import type { DecisionEffect, DecisionFields, DecisionQuestionKey, PlanInput } from '../src/coord/decisionModel.js';
import type * as DecisionLines from '../src/coord/decisionLines.js';
import type { DecisionLineFacts, LabelledAnswer } from '../src/coord/decisionLines.js';

export type DecisionModelModule = Pick<typeof DecisionModel, 'planDecision' | 'serveCap' | 'maintainCap' | 'bandOf'
  | 'isPrivateAddress' | 'isLiteralHost' | 'encodeDecisionRequest' | 'decisionRequestGroups' | 'readDecisionAnswers'
  | 'applyDecision' | 'gateOutcome'>;

export interface DecisionModelCase { name: string; run: (m: DecisionModelModule) => void }

export const SHADOW: DecisionRowSide = { ...DECISION_ROW_DEFAULT, mode: 'shadow' };
export const ARMED_HELD: DecisionRowSide = { mode: 'armed', ceiling: 600, armedLine: { id: 3, line: 0.9 }, held: true };
export const LOCAL = { kind: 'local' as const, modelId: 'model-a', origin: 'http://127.0.0.1:9000' };
export const HOSTED = { kind: 'hosted' as const, modelId: 'model-a', origin: 'https://model-host-a.example' };
export const USAGE_ZERO = { measured: true as const, serve: 0, maintain: 0, reserved: 0, ceiling: 600, fleetTotal: 0 };

/** Each row's minimal complete state. */
export const FIELDS: Record<DecisionRowId, DecisionFields> = {
  'programme.pick': { request: 'add a door', candidates: ['programme-a', 'programme-b'], goals: ['goals a', 'goals b'] },
  'programme.any': { request: 'add a door', candidates: ['programme-a', 'programme-b'], goals: ['goals a', 'goals b'] },
  'scope.widens': { cited: 'the operator words', goals: 'the new goals' },
  'relay.method': { part: 'use a map' },
  'readback.omits': { request: 'the request words', readback: 'the readback text', doneTest: 'tests pass' },
  'readback.adds': { request: 'the request words', readback: 'the readback text', doneTest: 'tests pass' },
  'goals.conflict': { a: 'goals of a', b: 'goals of b', signal: 'shared path' },
};

/** A plan input that asks, for `row`; each override sets one condition. */
export const plan = (row: DecisionRowId, o: Partial<PlanInput> = {}): PlanInput => ({
  row, kind: 'serve', fresh: false, side: SHADOW, host: LOCAL, keySet: true, fields: FIELDS[row], requestBytes: 100,
  egress: 'not-hosted', record: null, usage: USAGE_ZERO, ...o,
});

/** The plan table's skip conditions, in table order, each as an override with the answer it must give on its own. */
export const CONDITIONS: { n: number; row: DecisionRowId; o: Partial<PlanInput>; want: unknown }[] = [
  { n: 1, row: 'scope.widens', o: { side: DECISION_ROW_DEFAULT }, want: { do: 'skip', outcome: 'disarmed', why: null } },
  { n: 2, row: 'scope.widens', o: { side: ARMED_HELD }, want: { do: 'skip', outcome: 'not-asked', why: 'held' } },
  { n: 3, row: 'scope.widens', o: { host: null }, want: { do: 'skip', outcome: 'unavailable', why: 'host-unset' } },
  { n: 4, row: 'scope.widens', o: { keySet: false }, want: { do: 'skip', outcome: 'unavailable', why: 'no-key' } },
  { n: 5, row: 'scope.widens', o: { host: HOSTED, egress: 'clear' }, want: { do: 'skip', outcome: 'not-asked', why: 'private-state-hosted' } },
  { n: 6, row: 'scope.widens', o: { fields: { goals: 'g' } }, want: { do: 'skip', outcome: 'not-asked', why: 'missing-field' } },
  { n: 7, row: 'scope.widens', o: { requestBytes: 32769 }, want: { do: 'skip', outcome: 'over-size', why: null } },
  { n: 8, row: 'relay.method', o: { host: HOSTED, egress: 'hit' }, want: { do: 'skip', outcome: 'not-asked', why: 'egress-hit' } },
  { n: 9, row: 'relay.method', o: { host: HOSTED, egress: 'unreadable' }, want: { do: 'skip', outcome: 'not-asked', why: 'egress-unreadable' } },
  { n: 10, row: 'scope.widens', o: { record: { id: 41 } }, want: { do: 'reuse', recordId: 41 } },
  { n: 11, row: 'scope.widens', o: { usage: { measured: false } }, want: { do: 'skip', outcome: 'over-ceiling', why: null } },
  { n: 12, row: 'scope.widens', o: { usage: { ...USAGE_ZERO, fleetTotal: 2999 } }, want: { do: 'skip', outcome: 'over-ceiling', why: null } },
  { n: 13, row: 'scope.widens', o: { usage: { ...USAGE_ZERO, serve: 599 } }, want: { do: 'skip', outcome: 'over-ceiling', why: null } },
  { n: 14, row: 'scope.widens', o: { kind: 'maintain', usage: { ...USAGE_ZERO, maintain: 299 } }, want: { do: 'skip', outcome: 'over-ceiling', why: null } },
];

const ASK = { do: 'ask' };

export const PLAN_CASES: DecisionModelCase[] = [
  { name: 'plan: every row with a complete state, in shadow on a local host, asks', run: (m) => {
    for (const row of DECISION_ROW_IDS) expect(m.planDecision(plan(row)), row).toEqual(ASK);
  } },
  ...CONDITIONS.map((c): DecisionModelCase => ({ name: `plan: row ${c.n} alone gives its answer`, run: (m) => {
    expect(m.planDecision(plan(c.row, c.o))).toEqual(c.want);
  } })),
  { name: 'plan: an earlier row condition wins over every later one, and no set of conditions lets a later answer through', run: (m) => {
    // The rows that apply to the gate row: 8 and 9 apply to a hosted non-private row, which row 5 already stops for the gate.
    const gate = CONDITIONS.filter((c) => c.row === 'scope.widens');
    for (const [i, a] of gate.entries()) {
      for (const b of gate.slice(i + 1)) {
        const merged = { ...b.o, ...a.o };
        expect(m.planDecision(plan('scope.widens', merged)), `rows ${a.n} and ${b.n}`).toEqual(a.want);
      }
    }
    const relay = CONDITIONS.filter((c) => c.row === 'relay.method' || c.n >= 10);
    for (const [i, a] of relay.entries()) {
      for (const b of relay.slice(i + 1)) {
        const merged = { ...b.o, ...a.o };
        expect(m.planDecision(plan('relay.method', merged)), `relay rows ${a.n} and ${b.n}`).toEqual(a.want);
      }
    }
  } },
  { name: 'plan: monotone (Table 11.7b): adding a skip condition to an input that skips never asks', run: (m) => {
    for (const a of CONDITIONS) {
      for (const row of DECISION_ROW_IDS) {
        if (m.planDecision(plan(row, a.o)).do !== 'skip') continue;
        for (const b of CONDITIONS.filter((c) => c.n !== 10)) {
          expect(m.planDecision(plan(row, { ...b.o, ...a.o })).do, `row ${a.n} then ${b.n} on ${row}`).toBe('skip');
        }
      }
    }
    // Every condition but reuse skips on the row it was written for.
    for (const c of CONDITIONS) if (c.n !== 10) expect(m.planDecision(plan(c.row, c.o)).do, `row ${c.n}`).toBe('skip');
  } },
  { name: 'plan: a held gate is never reused; a held advice row is asked as in shadow', run: (m) => {
    expect(m.planDecision(plan('scope.widens', { side: ARMED_HELD, record: { id: 9 } }))).toEqual(CONDITIONS[1]!.want);
    expect(m.planDecision(plan('relay.method', { side: { ...ARMED_HELD } }))).toEqual(ASK);
    expect(m.planDecision(plan('scope.widens', { side: { ...ARMED_HELD, held: false } }))).toEqual(ASK);
  } },
  { name: 'plan: a private row on a hosted host is never reused; on a zero-retention host it asks', run: (m) => {
    expect(m.planDecision(plan('readback.omits', { host: HOSTED, egress: 'clear', record: { id: 9 } })))
      .toEqual({ do: 'skip', outcome: 'not-asked', why: 'private-state-hosted' });
    expect(m.planDecision(plan('readback.omits', { host: { ...HOSTED, kind: 'zero-retention' }, egress: 'hit' }))).toEqual(ASK);
  } },
  { name: 'plan: a hit or an unreadable list is never reused; no-list and clear ask', run: (m) => {
    expect(m.planDecision(plan('relay.method', { host: HOSTED, egress: 'hit', record: { id: 9 } })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { host: HOSTED, egress: 'unreadable', record: { id: 9 } })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { host: HOSTED, egress: 'no-list' }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { host: HOSTED, egress: 'clear' }))).toEqual(ASK);
  } },
  { name: 'plan: fresh never reuses a record; an empty shortlist is a missing field; an optional field may be absent', run: (m) => {
    expect(m.planDecision(plan('relay.method', { fresh: true, record: { id: 9 } }))).toEqual(ASK);
    expect(m.planDecision(plan('programme.pick', { fields: { ...FIELDS['programme.pick'], candidates: [], goals: [] } })))
      .toEqual({ do: 'skip', outcome: 'not-asked', why: 'missing-field' });
    expect(m.planDecision(plan('programme.pick', { fields: { ...FIELDS['programme.pick'], request: '' } })).do).toBe('skip');
    expect(m.planDecision(plan('readback.adds', { fields: { request: 'r', readback: 'b' } }))).toEqual(ASK);
    // A required list holding an empty text is missing too (review 2324 F6).
    for (const candidates of [[''], ['programme-a', '']]) {
      expect(m.planDecision(plan('programme.pick', { fields: { ...FIELDS['programme.pick'], candidates, goals: candidates.map(() => 'g') } })))
        .toEqual({ do: 'skip', outcome: 'not-asked', why: 'missing-field' });
    }
  } },
  { name: 'plan: a fact is a short server-made value: 200 characters ask, 201 are over-size (review 2324 F6)', run: (m) => {
    expect(m.planDecision(plan('goals.conflict', { fields: { ...FIELDS['goals.conflict'], signal: 'x'.repeat(200) } }))).toEqual(ASK);
    expect(m.planDecision(plan('goals.conflict', { fields: { ...FIELDS['goals.conflict'], signal: 'x'.repeat(201) } })))
      .toMatchObject({ outcome: 'over-size' });
    expect(m.planDecision(plan('readback.omits', { fields: { ...FIELDS['readback.omits'], doneTest: 'x'.repeat(201) } })))
      .toMatchObject({ outcome: 'over-size' });
    expect(m.planDecision(plan('goals.conflict', { fields: { ...FIELDS['goals.conflict'], a: 'x'.repeat(201) } }))).toEqual(ASK);
  } },
  { name: 'plan: a field of 8000 characters asks and of 8001 is over-size; a list entry counts the same', run: (m) => {
    expect(m.planDecision(plan('relay.method', { fields: { part: 'x'.repeat(8000) } }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { fields: { part: 'x'.repeat(8001) } })).do).toBe('skip');
    const goals = ['g', 'x'.repeat(8001)];
    expect(m.planDecision(plan('programme.pick', { fields: { ...FIELDS['programme.pick'], goals } }))).toMatchObject({ outcome: 'over-size' });
    expect(m.planDecision(plan('relay.method', { requestBytes: 32768 }))).toEqual(ASK);
  } },
  { name: 'plan: the ceilings, each at its edge, the reservation counted', run: (m) => {
    const u = (o: object) => ({ ...USAGE_ZERO, ...o });
    expect(m.planDecision(plan('relay.method', { usage: u({ fleetTotal: 2998 }) }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { usage: u({ fleetTotal: 2999 }) })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { usage: u({ serve: 598 }) }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { usage: u({ serve: 597, reserved: 2 }) })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { usage: u({ serve: 299, maintain: 300 }) })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { usage: u({ serve: 298, maintain: 300 }) }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { usage: u({ serve: 297, maintain: 300, reserved: 2 }) })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { kind: 'maintain', usage: u({ maintain: 298 }) }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { kind: 'maintain', usage: u({ maintain: 297, reserved: 2 }) })).do).toBe('skip');
    expect(m.planDecision(plan('relay.method', { kind: 'maintain', usage: u({ serve: 500 }) }))).toEqual(ASK);
    expect(m.planDecision(plan('relay.method', { kind: 'maintain', usage: u({ serve: 500, maintain: 99 }) })).do).toBe('skip');
    // Serving is not held by the maintenance cap, nor maintenance by serving's.
    expect(m.planDecision(plan('relay.method', { kind: 'maintain', usage: u({ serve: 0, maintain: 0, reserved: 0 }) }))).toEqual(ASK);
  } },
  { name: 'plan: concurrency, as arithmetic: two plans at 597 of 600, the second given the first reservation, refuses', run: (m) => {
    const first = m.planDecision(plan('relay.method', { usage: { ...USAGE_ZERO, serve: 597, reserved: 0 } }));
    const second = m.planDecision(plan('relay.method', { usage: { ...USAGE_ZERO, serve: 597, reserved: 2 } }));
    expect([first.do, second.do]).toEqual(['ask', 'skip']);
  } },
];

export const CAP_CASES: DecisionModelCase[] = [
  { name: 'caps: at C = 600, serving keeps at least 300, maintenance never passes 300, and together never 600', run: (m) => {
    for (const maintain of [0, 200, 300, 400]) {
      for (const serve of [0, 500, 600]) {
        const s = m.serveCap({ ceiling: 600, maintain: Math.min(maintain, 300) });
        const mt = m.maintainCap({ ceiling: 600, serve });
        expect(s, `serve cap at maintain ${maintain}`).toBeGreaterThanOrEqual(300);
        expect(mt, `maintain cap at serve ${serve}`).toBeLessThanOrEqual(300);
        expect(Math.min(serve, s) + Math.min(maintain, mt), `${serve}/${maintain}`).toBeLessThanOrEqual(600);
      }
    }
    expect(m.serveCap({ ceiling: 600, maintain: 200 })).toBe(400);
    expect(m.maintainCap({ ceiling: 600, serve: 0 })).toBe(300);
    expect(m.maintainCap({ ceiling: 600, serve: 500 })).toBe(100);
    expect(m.maintainCap({ ceiling: 600, serve: 600 })).toBe(0);
    expect(m.maintainCap({ ceiling: 51, serve: 0 })).toBe(25);
  } },
];

export const BAND_CASES: DecisionModelCase[] = [
  { name: 'bands: each cut falls in the upper band', run: (m) => {
    const at = [[0, 'unlikely'], [0.2499, 'unlikely'], [0.25, 'doubtful'], [0.4999, 'doubtful'], [0.5, 'likely'],
      [0.7499, 'likely'], [0.75, 'very-likely'], [1, 'very-likely']] as const;
    for (const [p, b] of at) expect(m.bandOf(p), String(p)).toBe(b);
  } },
];

/** The address one below an IPv4 address, built here so no public address is written in the tree. */
const below = (a: string): string => {
  const n = a.split('.').reduce((acc, x) => acc * 256 + Number(x), 0) - 1;
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
};
const above = (a: string): string => {
  const n = a.split('.').reduce((acc, x) => acc * 256 + Number(x), 0) + 1;
  return [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join('.');
};

export const ADDRESS_CASES: DecisionModelCase[] = [
  { name: 'addresses: each private range, its edges in and out', run: (m) => {
    const ranges: [string, string][] = [['10.0.0.0', '10.255.255.255'], ['172.16.0.0', '172.31.255.255'],
      ['192.168.0.0', '192.168.255.255'], ['127.0.0.0', '127.255.255.255']];
    for (const [lo, hi] of ranges) {
      expect(m.isPrivateAddress(lo, false), lo).toBe(true);
      expect(m.isPrivateAddress(hi, false), hi).toBe(true);
      expect(m.isPrivateAddress(below(lo), false), below(lo)).toBe(false);
      expect(m.isPrivateAddress(above(hi), false), above(hi)).toBe(false);
    }
  } },
  { name: 'addresses: loopback alone with loopbackOnly; IPv6 ranges; the IPv4-mapped form; names and junk are false', run: (m) => {
    expect(m.isPrivateAddress('127.0.0.1', true)).toBe(true);
    expect(m.isPrivateAddress('10.0.0.1', true)).toBe(false);
    expect(m.isPrivateAddress('192.168.1.1', true)).toBe(false);
    expect(m.isPrivateAddress('::1', true)).toBe(true);
    expect(m.isPrivateAddress('0:0:0:0:0:0:0:1', true)).toBe(true);
    expect(m.isPrivateAddress('::2', false)).toBe(false);
    expect(m.isPrivateAddress('fc00::1', false)).toBe(true);
    expect(m.isPrivateAddress('fdff:ffff::1', false)).toBe(true);
    expect(m.isPrivateAddress('fc00::1', true)).toBe(false);
    expect(m.isPrivateAddress('fe80::1', false)).toBe(true);
    expect(m.isPrivateAddress('febf::1', false)).toBe(true);
    expect(m.isPrivateAddress('fec0::1', false)).toBe(false);
    expect(m.isPrivateAddress('fbff::1', false)).toBe(false);
    expect(m.isPrivateAddress('::ffff:10.0.0.1', false)).toBe(true);
    expect(m.isPrivateAddress('::ffff:10.0.0.1', true)).toBe(false);
    expect(m.isPrivateAddress('::ffff:127.0.0.1', true)).toBe(true);
    expect(m.isPrivateAddress(`::ffff:${below('10.0.0.0')}`, false)).toBe(false);
    expect(m.isPrivateAddress(below('10.0.0.0'), false)).toBe(false);
    // A leading zero is refused; it is built here, so the tree spells no address the topology scan reads as public.
    const leadingZero = ['010', '0', '0', '1'].join('.');
    for (const junk of ['localhost', '', '10.0.0', '10.0.0.256', leadingZero, '1:2:3:4:5:6:7:8:9', '::g', ':::1', 'fe80::1%eth0']) {
      expect(m.isPrivateAddress(junk, false), junk).toBe(false);
    }
  } },
  { name: 'addresses: a local host is an IPv4 or IPv6 literal or localhost; any other name is not (review 2324 F2)', run: (m) => {
    for (const lit of ['127.0.0.1', '10.0.0.7', '::1', 'fe80::1', '::ffff:10.0.0.1', 'localhost']) expect(m.isLiteralHost(lit), lit).toBe(true);
    for (const name of ['model.lan-a', 'localhost.lan-a', '', '10.0.0', '::g']) expect(m.isLiteralHost(name), name).toBe(false);
  } },
];

const OPAQUE = Array.from({ length: 40 }, (_, i) => `k${String(i).padStart(3, '0')}`);
const enc = (m: DecisionModelModule, rows: DecisionRowId[], f: Partial<Record<DecisionRowId, DecisionFields>> = {}) =>
  m.encodeDecisionRequest(rows, new Map(rows.map((r) => [r, f[r] ?? FIELDS[r]])), 'model-a', OPAQUE);
type Encoded = Exclude<ReturnType<DecisionModelModule['encodeDecisionRequest']>, { refused: unknown }>;
const ok = (e: ReturnType<DecisionModelModule['encodeDecisionRequest']>): Encoded => {
  if ('refused' in e) throw new Error(`refused ${e.refused}`);
  return e;
};
/** Every string in the body, with the path of keys that reached it. */
const strings = (v: unknown, at: string[] = []): { at: string[]; s: string }[] => typeof v === 'string' ? [{ at, s: v }]
  : Array.isArray(v) ? v.flatMap((x) => strings(x, at))
    : typeof v === 'object' && v !== null ? Object.entries(v).flatMap(([k, x]) => strings(x, [...at, k])) : [];

export const ENCODE_CASES: DecisionModelCase[] = [
  { name: 'encode: the routing pair, one request, both orders of the choice and one of the yes-or-no, keys in askedWith order', run: (m) => {
    const e = ok(enc(m, ['programme.pick', 'programme.any']));
    expect(e.body.model).toBe('model-a');
    const keys = [...e.keys.entries()];
    expect(keys.map(([, k]) => `${k.row}/${k.order}`)).toEqual(['programme.pick/a', 'programme.pick/b', 'programme.any/a']);
    expect(Object.keys(e.body.questions)).toEqual(keys.map(([k]) => k));
    const [a, b] = keys.map(([k]) => e.body.questions[k]!);
    expect(a!.type).toBe('choice');
    const optA = Object.keys(a!.criteria as object);
    const optB = Object.keys(b!.criteria as object);
    // Reversed options, with none last in both.
    expect(optB.slice(0, -1)).toEqual(optA.slice(0, -1).reverse());
    expect(optA.at(-1)).toBe(optB.at(-1));
    const k0 = keys[0]![1];
    expect([...k0.options.values()]).toEqual(['programme-a', 'programme-b']);
    expect(k0.none).toBe(optA.at(-1));
    expect(keys[2]![1].none).toBeNull();
    expect(e.body.questions[keys[2]![0]]!.type).toBe('noul');
  } },
  { name: 'encode: only catalogue text, opaque ids and typed fields; session text only under keys named quoted; no slug sent', run: (m) => {
    for (const row of DECISION_ROW_IDS) {
      const group = DECISION_QUESTIONS[row].askedWith;
      const e = ok(enc(m, [...group]));
      const quotedValues = new Set<string>();
      for (const r of group) {
        for (const d of DECISION_QUESTIONS[r].fields) {
          if (d.kind !== 'quoted') continue;
          const v = FIELDS[r][d.name];
          for (const s of typeof v === 'string' ? [v] : v ?? []) quotedValues.add(s);
        }
      }
      for (const { at, s } of strings(e.body.state)) {
        if (quotedValues.has(s)) expect(at.at(-1), `${row}: ${s}`).toBe('quoted');
      }
      for (const [key, q] of Object.entries(e.body.questions)) {
        const k = e.keys.get(key)!;
        const cat = DECISION_QUESTIONS[k.row];
        expect(q.instructions.endsWith(cat.instructions), `${row} instructions`).toBe(true);
        expect(strings(q).some(({ s }) => quotedValues.has(s)), `${row}: question carries session text`).toBe(false);
        if (cat.criteria !== null) expect(q.criteria).toEqual({ true: cat.criteria.true, false: cat.criteria.false });
      }
      const all = JSON.stringify(e.body);
      for (const slug of ['programme-a', 'programme-b']) expect(all.includes(slug), `${row}: slug ${slug}`).toBe(false);
    }
  } },
  { name: 'encode: a both-order yes-or-no row puts its pair under opaque labels, named in swapped order', run: (m) => {
    const e = ok(enc(m, ['readback.omits']));
    const qs = Object.values(e.body.questions);
    expect(qs).toHaveLength(2);
    const stateKeys = Object.keys(e.body.state);
    expect(stateKeys).not.toContain('request');
    expect(stateKeys).not.toContain('readback');
    expect(stateKeys).toContain('doneTest');
    const labels = stateKeys.filter((k) => k !== 'doneTest');
    expect(labels).toHaveLength(2);
    expect(e.body.state[labels[1]!]).toEqual({ quoted: 'the readback text' });
    expect(e.body.state[labels[0]!]).toBe('the request words');
    const pos = (s: string, l: string) => s.indexOf(l);
    expect(pos(qs[0]!.instructions, labels[0]!)).toBeLessThan(pos(qs[0]!.instructions, labels[1]!));
    expect(pos(qs[1]!.instructions, labels[0]!)).toBeGreaterThan(pos(qs[1]!.instructions, labels[1]!));
    const one = ok(enc(m, ['relay.method']));
    expect(Object.keys(one.body.questions)).toHaveLength(1);
    expect(one.body.state).toEqual({ part: { quoted: 'use a map' } });
  } },
  { name: 'encode: seven candidates refuse; six do not; a missing required field and a mismatched goals list refuse', run: (m) => {
    const slugs = (n: number) => Array.from({ length: n }, (_, i) => `programme-${i}`);
    const f = (n: number): DecisionFields => ({ request: 'r', candidates: slugs(n), goals: slugs(n).map((s) => `goals ${s}`) });
    expect(enc(m, ['programme.pick', 'programme.any'], { 'programme.pick': f(7), 'programme.any': f(7) }))
      .toEqual({ refused: 'over-size', row: 'programme.pick' });
    expect('refused' in enc(m, ['programme.pick', 'programme.any'], { 'programme.pick': f(6), 'programme.any': f(6) })).toBe(false);
    expect(enc(m, ['relay.method'], { 'relay.method': {} })).toEqual({ refused: 'missing-field', row: 'relay.method' });
    const bad = { request: 'r', candidates: ['programme-a'], goals: ['g', 'h'] };
    expect(enc(m, ['programme.pick', 'programme.any'], { 'programme.pick': bad, 'programme.any': bad }))
      .toEqual({ refused: 'missing-field', row: 'programme.pick' });
  } },
  { name: 'encode: a field over 8000 characters, or a request over 32768 bytes, refuses over-size', run: (m) => {
    expect(enc(m, ['relay.method'], { 'relay.method': { part: 'x'.repeat(8001) } })).toEqual({ refused: 'over-size', row: 'relay.method' });
    const big = { a: 'x'.repeat(8000), b: 'y'.repeat(8000), signal: 'z'.repeat(200) };
    expect('refused' in enc(m, ['goals.conflict'], { 'goals.conflict': big })).toBe(false);
    expect(enc(m, ['goals.conflict'], { 'goals.conflict': { ...big, signal: 'z'.repeat(201) } }))
      .toEqual({ refused: 'over-size', row: 'goals.conflict' });
    const wide = { a: 'é'.repeat(8000), b: 'é'.repeat(8000), signal: 'é'.repeat(200) };
    expect(enc(m, ['goals.conflict'], { 'goals.conflict': wide })).toEqual({ refused: 'over-size', row: 'goals.conflict' });
  } },
  { name: 'encode: rows of two groups, or running out of opaque ids, is a caller bug and throws', run: (m) => {
    expect(() => enc(m, ['relay.method', 'scope.widens'])).toThrow(/group/);
    expect(() => m.encodeDecisionRequest(['relay.method'], new Map([['relay.method', FIELDS['relay.method']]]), 'model-a', [])).toThrow(/opaque/);
    // Duplicate opaque ids would key two questions alike (review 2324 F6).
    expect(() => m.encodeDecisionRequest(['relay.method'], new Map([['relay.method', FIELDS['relay.method']]]), 'model-a',
      ['k1', 'k2', 'k1'])).toThrow(/duplicate/);
  } },
  { name: 'encode: a required list holding an empty text refuses missing-field (review 2324 F6)', run: (m) => {
    const blank = { request: 'r', candidates: ['programme-a', ''], goals: ['g', 'h'] };
    expect(enc(m, ['programme.pick', 'programme.any'], { 'programme.pick': blank, 'programme.any': blank }))
      .toEqual({ refused: 'missing-field', row: 'programme.pick' });
  } },
];

const hash = (f: DecisionFields): string => JSON.stringify(f);
export const GROUP_CASES: DecisionModelCase[] = [
  { name: 'groups: one askedWith group with one state is one request, in first-seen order', run: (m) => {
    const state = FIELDS['programme.pick'];
    expect(m.decisionRequestGroups(['programme.pick', 'programme.any', 'relay.method'],
      (r) => (r === 'relay.method' ? FIELDS['relay.method'] : state), hash)).toEqual([
      { rows: ['programme.pick', 'programme.any'], state, stateHash: hash(state) },
      { rows: ['relay.method'], state: FIELDS['relay.method'], stateHash: hash(FIELDS['relay.method']) },
    ]);
  } },
  { name: 'groups: rows of one group whose states differ are two requests, each with its own state (review 2324 F1)', run: (m) => {
    const other = { ...FIELDS['programme.any'], request: 'another request' };
    const groups = m.decisionRequestGroups(['programme.pick', 'programme.any'],
      (r) => (r === 'programme.pick' ? FIELDS['programme.pick'] : other), hash);
    expect(groups).toEqual([
      { rows: ['programme.pick'], state: FIELDS['programme.pick'], stateHash: hash(FIELDS['programme.pick']) },
      { rows: ['programme.any'], state: other, stateHash: hash(other) },
    ]);
  } },
  { name: 'groups: two rows of different groups with equal states stay two requests', run: (m) => {
    const same = { part: 'p' };
    expect(m.decisionRequestGroups(['relay.method', 'goals.conflict'], () => same, hash).map((g) => g.rows))
      .toEqual([['relay.method'], ['goals.conflict']]);
  } },
];

const yesNoKeys = (row: DecisionRowId, orders: number): Map<string, DecisionQuestionKey> =>
  new Map(Array.from({ length: orders }, (_, i) => [`q${i}`, { row, order: i === 0 ? 'a' : 'b', options: new Map(), none: null }]));
const noul = (...ps: number[]) => Object.fromEntries(ps.map((p, i) => [`q${i}`, { type: 'noul', noul: p }]));
const answer = (answers: object, model = 'model-a') => ({ model, answers });
const pickKeys = (): Map<string, DecisionQuestionKey> => {
  const options = new Map([['o1', 'programme-a'], ['o2', 'programme-b']]);
  return new Map([['q0', { row: 'programme.pick', order: 'a', options, none: 'o3' }], ['q1', { row: 'programme.pick', order: 'b', options, none: 'o3' }]]);
};
const choice = (c: string, p: number, extra: object = {}) => ({ type: 'choice', choice: c, confidence: p, probabilities: { [c]: p }, ...extra });

export const READ_CASES: DecisionModelCase[] = [
  { name: 'read: a both-order yes at 0.9 and 0.7 is yes at 0.7; a no at 0.1 and 0.3 is no at 0.3', run: (m) => {
    expect(m.readDecisionAnswers(yesNoKeys('readback.omits', 2), 'model-a', answer(noul(0.9, 0.7))))
      .toEqual(new Map([['readback.omits', { verdict: 'yes', p: 0.7, band: 'likely' }]]));
    expect(m.readDecisionAnswers(yesNoKeys('readback.omits', 2), 'model-a', answer(noul(0.1, 0.3))))
      .toEqual(new Map([['readback.omits', { verdict: 'no', p: 0.3, band: 'doubtful' }]]));
  } },
  { name: 'read: orders that disagree on the side of 0.5 are unsure, at the lower; 0.5 itself is yes', run: (m) => {
    expect(m.readDecisionAnswers(yesNoKeys('goals.conflict', 2), 'model-a', answer(noul(0.6, 0.4))))
      .toEqual(new Map([['goals.conflict', { verdict: 'unsure', p: 0.4, band: 'doubtful' }]]));
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer(noul(0.5))))
      .toEqual(new Map([['relay.method', { verdict: 'yes', p: 0.5, band: 'likely' }]]));
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer(noul(0.4999))))
      .toEqual(new Map([['relay.method', { verdict: 'no', p: 0.4999, band: 'doubtful' }]]));
  } },
  { name: 'read: a model other than the pinned one, a missing key, a wrong type or a probability outside 0 to 1 is malformed', run: (m) => {
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer(noul(0.9), 'model-b'))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 2), 'model-a', answer(noul(0.9)))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer({ q0: choice('o1', 0.9) }))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer({ q0: { type: 'choice', noul: 0.9 } }))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer(noul(1.2)))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer(noul(-0.1)))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', answer({ q0: { type: 'noul', noul: '0.9' } }))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', { answers: noul(0.9) })).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', { model: 'model-a' })).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(yesNoKeys('relay.method', 1), 'model-a', null)).toHaveProperty('malformed');
  } },
  { name: 'read: a choice named in both orders is that option at the lower probability; different options are unsure', run: (m) => {
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: choice('o2', 0.8), q1: choice('o2', 0.6) })))
      .toEqual(new Map([['programme.pick', { verdict: { option: 'programme-b' }, p: 0.6, band: 'likely' }]]));
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: choice('o1', 0.8), q1: choice('o2', 0.9) })))
      .toEqual(new Map([['programme.pick', { verdict: 'unsure', p: 0.8, band: 'very-likely' }]]));
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: choice('o3', 0.7), q1: choice('o3', 0.9) })))
      .toEqual(new Map([['programme.pick', { verdict: 'none', p: 0.7, band: 'likely' }]]));
  } },
  { name: 'read: an option not offered, or a choice probability outside 0 to 1, is malformed; confidence stands in when no probabilities', run: (m) => {
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: choice('o9', 0.8), q1: choice('o9', 0.8) }))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: choice('o1', 1.5), q1: choice('o1', 0.8) }))).toHaveProperty('malformed');
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: { type: 'noul', noul: 0.8 }, q1: choice('o1', 0.8) }))).toHaveProperty('malformed');
    const bare = { type: 'choice', choice: 'o1', confidence: 0.55 };
    expect(m.readDecisionAnswers(pickKeys(), 'model-a', answer({ q0: bare, q1: bare })))
      .toEqual(new Map([['programme.pick', { verdict: { option: 'programme-a' }, p: 0.55, band: 'likely' }]]));
  } },
  { name: 'read: a slug spelled none is an option, never the none answer', run: (m) => {
    const options = new Map([['o1', 'none']]);
    const keys = new Map<string, DecisionQuestionKey>([['q0', { row: 'programme.pick', order: 'a', options, none: 'o2' }],
      ['q1', { row: 'programme.pick', order: 'b', options, none: 'o2' }]]);
    expect(m.readDecisionAnswers(keys, 'model-a', answer({ q0: choice('o1', 0.8), q1: choice('o1', 0.8) })))
      .toEqual(new Map([['programme.pick', { verdict: { option: 'none' }, p: 0.8, band: 'very-likely' }]]));
  } },
  { name: 'read: the encoder keys round-trip through the reader', run: (m) => {
    const e = ok(enc(m, ['programme.pick', 'programme.any']));
    const answers: Record<string, unknown> = {};
    for (const [key, k] of e.keys) {
      if (k.row === 'programme.pick') {
        const id = [...k.options.entries()].find(([, s]) => s === 'programme-b')![0];
        answers[key] = choice(id, k.order === 'a' ? 0.9 : 0.8);
      } else answers[key] = { type: 'noul', noul: 0.95 };
    }
    expect(m.readDecisionAnswers(e.keys, 'model-a', answer(answers))).toEqual(new Map<DecisionRowId, unknown>([
      ['programme.pick', { verdict: { option: 'programme-b' }, p: 0.8, band: 'very-likely' }],
      ['programme.any', { verdict: 'yes', p: 0.95, band: 'very-likely' }],
    ]));
  } },
];

// ── applyDecision and gateOutcome (PR B, Task 8) ───────────────────────────────────────────────────────────────────────

const ARMED_GATE: DecisionRowSide = { mode: 'armed', ceiling: 600, armedLine: { id: 3, line: 0.9 }, held: false };
const ARMED_ADVICE: DecisionRowSide = { mode: 'armed', ceiling: 600, armedLine: null, held: false };
const HELD_ADVICE: DecisionRowSide = { ...ARMED_ADVICE, held: true };
const OFF: DecisionRowSide = DECISION_ROW_DEFAULT;
const bandOfP = (p: number): DecisionBand => (p < 0.25 ? 'unlikely' : p < 0.5 ? 'doubtful' : p < 0.75 ? 'likely' : 'very-likely');

type Answered = Extract<DecisionCheck, { outcome: 'answered' }>;
/** An answered check gathered under line 3 on the local host, as `LOCAL` is today's host. */
export const answered = (row: DecisionRowId, o: Partial<Answered> = {}): Answered => {
  const p = o.p ?? 0.97;
  return { row, outcome: 'answered', revision: DECISION_QUESTIONS[row].revision, modelId: 'model-a', hostKind: 'local',
    origin: 'http://127.0.0.1:9000', lineGen: 3, recordId: null, verdict: 'yes', p, band: bandOfP(p), ms: 10, attempts: 1,
    reused: false, egress: 'not-hosted', ...o };
};
const missed = (row: DecisionRowId, outcome: Exclude<DecisionCheck['outcome'], 'answered'>): DecisionCheck =>
  ({ row, outcome, why: null, ms: 10, attempts: 1 });
const nowFor = (row: DecisionRowId, side: DecisionRowSide, o: Partial<Parameters<DecisionModelModule['applyDecision']>[1]> = {}):
  Parameters<DecisionModelModule['applyDecision']>[1] =>
  ({ row: DECISION_QUESTIONS[row], side, currentLine: { id: 3, line: 0.9 }, host: LOCAL, ...o });
const GATE = 'scope.widens' as const;
const ADVICE_YN = 'relay.method' as const;
const CHOICE = 'programme.pick' as const;
const failure = (row: DecisionRowId): DecisionEffect => (DECISION_QUESTIONS[row].direction === 'gate' ? 'shut' : 'skipped');

export const APPLY_CASES: DecisionModelCase[] = [
  { name: 'apply 1: an off row is skipped, whatever the check is', run: (m) => {
    for (const row of DECISION_ROW_IDS) {
      expect(m.applyDecision(answered(row), nowFor(row, OFF)), row).toBe('skipped');
      for (const outcome of DECISION_OUTCOMES.filter((o) => o !== 'answered')) expect(m.applyDecision(missed(row, outcome), nowFor(row, OFF))).toBe('skipped');
    }
  } },
  { name: 'apply 2: a held armed gate is shut, even for a perfect answer', run: (m) => {
    expect(m.applyDecision(answered(GATE), nowFor(GATE, ARMED_HELD))).toBe('shut');
    expect(m.applyDecision(missed(GATE, 'unavailable'), nowFor(GATE, ARMED_HELD))).toBe('shut');
    expect(m.applyDecision(answered(GATE), nowFor(GATE, ARMED_GATE))).toBe('clear-yes');
  } },
  { name: 'apply 3: a shadow row, and a held armed advice row, answer shadow (a record only), before the check is read', run: (m) => {
    for (const row of DECISION_ROW_IDS) {
      expect(m.applyDecision(answered(row), nowFor(row, SHADOW)), row).toBe('shadow');
      expect(m.applyDecision(missed(row, 'refused'), nowFor(row, SHADOW)), row).toBe('shadow');
      expect(m.applyDecision(answered(row, { lineGen: 99, hostKind: 'hosted' }), nowFor(row, SHADOW)), row).toBe('shadow');
    }
    expect(m.applyDecision(answered(ADVICE_YN), nowFor(ADVICE_YN, HELD_ADVICE))).toBe('shadow');
    expect(m.applyDecision(missed(ADVICE_YN, 'unavailable'), nowFor(ADVICE_YN, HELD_ADVICE))).toBe('shadow');
    expect(m.applyDecision(answered(ADVICE_YN), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('clear-yes');
  } },
  { name: 'apply 4: a check that is no answer is shut for a gate and skipped for advice', run: (m) => {
    for (const outcome of DECISION_OUTCOMES.filter((o) => o !== 'answered')) {
      expect(m.applyDecision(missed(GATE, outcome), nowFor(GATE, ARMED_GATE)), outcome).toBe('shut');
      expect(m.applyDecision(missed(ADVICE_YN, outcome), nowFor(ADVICE_YN, ARMED_ADVICE)), outcome).toBe('skipped');
      expect(m.applyDecision(missed(CHOICE, outcome), nowFor(CHOICE, ARMED_ADVICE)), outcome).toBe('skipped');
    }
  } },
  { name: 'apply 5: an answer gathered under another host kind, origin or model is not today\'s', run: (m) => {
    const other = [{ hostKind: 'hosted' as const }, { origin: 'http://127.0.0.1:9001' }, { modelId: 'model-b' }];
    for (const o of other) {
      expect(m.applyDecision(answered(GATE, o), nowFor(GATE, ARMED_GATE)), JSON.stringify(o)).toBe('shut');
      expect(m.applyDecision(answered(ADVICE_YN, o), nowFor(ADVICE_YN, ARMED_ADVICE)), JSON.stringify(o)).toBe('skipped');
    }
    expect(m.applyDecision(answered(GATE), nowFor(GATE, ARMED_GATE, { host: null }))).toBe('shut');
    expect(m.applyDecision(answered(ADVICE_YN), nowFor(ADVICE_YN, ARMED_ADVICE, { host: null }))).toBe('skipped');
    expect(m.applyDecision(answered(GATE), nowFor(GATE, ARMED_GATE, { host: { ...LOCAL, kind: 'zero-retention' } }))).toBe('shut');
  } },
  { name: 'apply 6: the line used is none, or not the line the answer was gathered under', run: (m) => {
    expect(m.applyDecision(answered(GATE, { lineGen: 4 }), nowFor(GATE, ARMED_GATE))).toBe('shut');
    expect(m.applyDecision(answered(GATE), nowFor(GATE, { ...ARMED_GATE, armedLine: null }))).toBe('shut');
    expect(m.applyDecision(answered(ADVICE_YN, { lineGen: 4 }), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('skipped');
    expect(m.applyDecision(answered(ADVICE_YN), nowFor(ADVICE_YN, ARMED_ADVICE, { currentLine: null }))).toBe('skipped');
    expect(m.applyDecision(answered(CHOICE, { lineGen: 0, verdict: { option: 'programme-a' } }), nowFor(CHOICE, ARMED_ADVICE, { currentLine: null }))).toBe('skipped');
  } },
  { name: 'apply 6: an armed gate gathered under its own line clears while a newer current line exists (review 2262 F3); an advice row uses the current line', run: (m) => {
    const newer = { currentLine: { id: 7, line: 0.5 } };
    expect(m.applyDecision(answered(GATE, { lineGen: 3, p: 0.92 }), nowFor(GATE, ARMED_GATE, newer))).toBe('clear-yes');
    expect(m.applyDecision(answered(GATE, { lineGen: 7, p: 0.92 }), nowFor(GATE, ARMED_GATE, newer))).toBe('shut');
    // The gate's own line is 0.9, not the newer 0.5.
    expect(m.applyDecision(answered(GATE, { lineGen: 3, p: 0.7 }), nowFor(GATE, ARMED_GATE, newer))).toBe('shut');
    // An advice row has no armed line: it reads the current one, whatever its side holds.
    const advice = { ...ARMED_ADVICE, armedLine: { id: 3, line: 0.9 } };
    expect(m.applyDecision(answered(ADVICE_YN, { lineGen: 7, p: 0.6 }), nowFor(ADVICE_YN, advice, newer))).toBe('clear-yes');
    expect(m.applyDecision(answered(ADVICE_YN, { lineGen: 3, p: 0.97 }), nowFor(ADVICE_YN, advice, newer))).toBe('skipped');
  } },
  { name: 'apply 7: an unsure answer is shut for a gate and unsure for advice', run: (m) => {
    expect(m.applyDecision(answered(GATE, { verdict: 'unsure', p: 0.99 }), nowFor(GATE, ARMED_GATE))).toBe('shut');
    expect(m.applyDecision(answered(ADVICE_YN, { verdict: 'unsure', p: 0.99 }), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('unsure');
    expect(m.applyDecision(answered(CHOICE, { verdict: 'unsure', p: 0.99 }), nowFor(CHOICE, ARMED_ADVICE))).toBe('unsure');
  } },
  { name: 'apply 8 and 9: a yes-or-no row clears yes at the line, and otherwise shuts a gate or clears no for advice', run: (m) => {
    expect(m.applyDecision(answered(GATE, { p: 0.9 }), nowFor(GATE, ARMED_GATE))).toBe('clear-yes');
    expect(m.applyDecision(answered(GATE, { p: 0.8999 }), nowFor(GATE, ARMED_GATE))).toBe('shut');
    expect(m.applyDecision(answered(GATE, { verdict: 'no', p: 0.1 }), nowFor(GATE, ARMED_GATE))).toBe('shut');
    expect(m.applyDecision(answered(ADVICE_YN, { p: 0.9 }), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('clear-yes');
    expect(m.applyDecision(answered(ADVICE_YN, { p: 0.8999 }), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('clear-no');
    expect(m.applyDecision(answered(ADVICE_YN, { verdict: 'no', p: 0.1 }), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('clear-no');
    // A no that carries a high p is inconsistent, and reads as a no, never as a yes.
    expect(m.applyDecision(answered(ADVICE_YN, { verdict: 'no', p: 0.99 }), nowFor(ADVICE_YN, ARMED_ADVICE))).toBe('clear-no');
    expect(m.applyDecision(answered(GATE, { verdict: 'no', p: 0.99 }), nowFor(GATE, ARMED_GATE))).toBe('shut');
  } },
  { name: 'apply 10 and 11: a choice row picks its option at the line, picks none, or is unsure below it', run: (m) => {
    const at = (verdict: Answered['verdict'], p: number): DecisionEffect => m.applyDecision(answered(CHOICE, { verdict, p }), nowFor(CHOICE, ARMED_ADVICE));
    expect(at({ option: 'programme-a' }, 0.9)).toEqual({ pick: 'programme-a' });
    expect(at({ option: 'programme-b' }, 0.97)).toEqual({ pick: 'programme-b' });
    expect(at('none', 0.9)).toBe('none-picked');
    expect(at({ option: 'programme-a' }, 0.8999)).toBe('unsure');
    expect(at('none', 0.8999)).toBe('unsure');
    // A yes or a no on a choice row is not an option.
    expect(at('yes', 0.99)).toBe('unsure');
    expect(at('no', 0.99)).toBe('unsure');
  } },
  { name: 'apply: a check of another row than the one asked about is a caller\'s bug and throws', run: (m) => {
    expect(() => m.applyDecision(answered(GATE), nowFor(ADVICE_YN, ARMED_ADVICE))).toThrow();
  } },
  { name: 'apply: no input outside rows 8 and 10 gives clear-yes or a pick, over a generated grid', run: (m) => {
    const sides: DecisionRowSide[] = [OFF, SHADOW, ARMED_GATE, ARMED_HELD, ARMED_ADVICE, HELD_ADVICE, { ...ARMED_GATE, armedLine: { id: 4, line: 0.5 } },
      { ...ARMED_ADVICE, armedLine: { id: 3, line: 0.9 } }, { ...OFF, armedLine: { id: 3, line: 0.9 } }];
    const verdicts: Answered['verdict'][] = ['yes', 'no', 'unsure', 'none', { option: 'programme-a' }];
    const ps = [0, 0.3, 0.5, 0.89, 0.9, 0.95, 1];
    const hosts = [LOCAL, { ...LOCAL, kind: 'hosted' as const }, { ...LOCAL, origin: 'http://127.0.0.1:1' }, { ...LOCAL, modelId: 'model-z' }, null];
    const lines = [{ id: 3, line: 0.9 }, { id: 3, line: 0.6 }, { id: 8, line: 0.9 }, null];
    let clear = 0;
    let picks = 0;
    for (const row of DECISION_ROW_IDS) {
      const q = DECISION_QUESTIONS[row];
      for (const side of sides) for (const verdict of verdicts) for (const p of ps) for (const host of hosts) for (const currentLine of lines) {
        for (const lineGen of [3, 8]) {
          const check = answered(row, { verdict, p, lineGen });
          const effect = m.applyDecision(check, nowFor(row, side, { host, currentLine }));
          const used = q.direction === 'gate' ? side.armedLine : currentLine;
          const rows8and10 = side.mode === 'armed' && !(q.direction === 'gate' && side.held) && !(side.held && q.direction === 'advice')
            && host !== null && host.kind === check.hostKind && host.origin === check.origin && host.modelId === check.modelId
            && used !== null && used.id === lineGen && p >= used.line;
          const at = `${row} ${JSON.stringify([side, verdict, p, host, currentLine, lineGen])}`;
          if (effect === 'clear-yes') {
            clear++;
            expect(rows8and10 && q.type === 'yes-no' && verdict === 'yes', at).toBe(true);
          }
          if (typeof effect === 'object' || effect === 'none-picked') {
            picks++;
            expect(rows8and10 && q.type === 'choice' && (typeof verdict === 'object' || verdict === 'none'), at).toBe(true);
          }
          if (q.direction === 'gate') expect(['skipped', 'shadow', 'shut', 'clear-yes'], at).toContain(effect);
          if (side.mode === 'off') expect(effect, at).toBe('skipped');
          if (side.mode === 'shadow') expect(effect, at).toBe('shadow');
        }
      }
    }
    // The grid reaches both rows it guards.
    expect(clear).toBeGreaterThan(0);
    expect(picks).toBeGreaterThan(0);
  } },
];

const EFFECTS: readonly DecisionEffect[] = ['clear-yes', 'clear-no', 'unsure', { pick: 'programme-a' }, 'none-picked', 'shadow', 'skipped', 'shut'];
export const GATE_OUTCOME_CASES: DecisionModelCase[] = [
  { name: 'gateOutcome: clear-yes, skipped and shadow leave the code verdict as it was; every other effect goes to the operator', run: (m) => {
    const verdict = { widen: false };
    for (const effect of EFFECTS) {
      const same = effect === 'clear-yes' || effect === 'skipped' || effect === 'shadow';
      const out = m.gateOutcome(verdict, effect);
      if (same) expect(out, JSON.stringify(effect)).toBe(verdict);
      else expect(out, JSON.stringify(effect)).toBe('to-operator');
    }
  } },
  { name: 'gateOutcome: never wider than the row disarmed, whatever the code verdict', run: (m) => {
    for (const verdict of ['allow', 'refuse', 'ask', 0, false] as const) {
      expect(m.gateOutcome(verdict, 'skipped'), String(verdict)).toBe(verdict);
      for (const effect of EFFECTS) {
        const out = m.gateOutcome(verdict, effect);
        expect([verdict, 'to-operator'], JSON.stringify(effect)).toContain(out);
      }
    }
  } },
];

export const ALL_DECISION_MODEL_CASES: DecisionModelCase[] = [
  ...PLAN_CASES, ...CAP_CASES, ...BAND_CASES, ...ADDRESS_CASES, ...ENCODE_CASES, ...GROUP_CASES, ...READ_CASES,
  ...APPLY_CASES, ...GATE_OUTCOME_CASES,
];

// ═══ decisionLines.ts (Tasks 6 to 8) ═══════════════════════════════════════════════════════════════════════════════════

export type DecisionLinesModule = Pick<typeof DecisionLines, 'isDecisionGate' | 'decisionRowDirection' | 'lineCounts' | 'admitLine'
  | 'canaryCrossed' | 'canaryVerdict' | 'anchorDrift' | 'decideRowArm' | 'decideRowOff' | 'offFallback' | 'decideRowCeiling'
  | 'keyDoorHostname' | 'decideKeyDoor' | 'decisionStepUp' | 'heldOnHostChange' | 'heldOnKeyRemoval' | 'decisionModelViewOf'
  | 'armedAndFree' | 'lineUnderKey' | 'armedLineBoundFails'>;
export interface DecisionLinesCase { name: string; run: (m: DecisionLinesModule) => void }

const side = (mode: DecisionRowSide['mode'], o: { ceiling?: number; line?: [number, number]; held?: boolean } = {}): DecisionRowSide =>
  ({ mode, ceiling: o.ceiling ?? 600, armedLine: o.line === undefined ? null : { id: o.line[0], line: o.line[1] }, held: o.held ?? false });
const ADVICE = 'relay.method' as const;

// ── decisionRowDirection (Task 6) ─────────────────────────────────────────────────────────────────────────────────────

export const DIRECTION_CASES: DecisionLinesCase[] = [
  { name: 'direction 1: a higher ceiling widens, a lower one narrows, for a gate and for advice', run: (m) => {
    for (const gate of [true, false]) {
      expect(m.decisionRowDirection(gate, side('shadow'), side('shadow', { ceiling: 700 }))).toBe('widens');
      expect(m.decisionRowDirection(gate, side('shadow'), side('shadow', { ceiling: 300 }))).toBe('narrows');
      expect(m.decisionRowDirection(gate, side('shadow'), side('shadow'))).toBe('narrows');
      expect(m.decisionRowDirection(gate, side('armed', { held: true }), side('armed', { held: true, ceiling: 100 }))).toBe('narrows');
    }
    // Row 1 comes first: a stricter line with a higher ceiling still widens.
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.8] }), side('armed', { line: [4, 0.9], ceiling: 700 }))).toBe('widens');
  } },
  { name: 'direction 2: off to shadow or armed is new spend and widens; shadow to off narrows', run: (m) => {
    for (const gate of [true, false]) {
      expect(m.decisionRowDirection(gate, side('off'), side('shadow'))).toBe('widens');
      expect(m.decisionRowDirection(gate, side('off'), side('armed', { line: [3, 0.9] }))).toBe('widens');
      expect(m.decisionRowDirection(gate, side('shadow'), side('off'))).toBe('narrows');
      expect(m.decisionRowDirection(gate, side('off'), side('off'))).toBe('narrows');
    }
    expect(m.decisionRowDirection(false, side('off'), side('off', { ceiling: 100 }))).toBe('narrows');
  } },
  { name: 'direction 3: a gate armed or held that stops shutting widens; advice does not', run: (m) => {
    const armed = side('armed', { line: [3, 0.9] });
    const held = side('armed', { line: [3, 0.9], held: true });
    expect(m.decisionRowDirection(true, armed, side('off'))).toBe('widens');
    expect(m.decisionRowDirection(true, armed, side('shadow'))).toBe('widens');
    expect(m.decisionRowDirection(true, held, side('off'))).toBe('widens');
    expect(m.decisionRowDirection(true, held, side('shadow'))).toBe('widens');
    // A held row whose mode already reads shadow still shut as a gate.
    expect(m.decisionRowDirection(true, side('shadow', { held: true }), side('off'))).toBe('widens');
    expect(m.decisionRowDirection(false, side('armed'), side('off'))).toBe('narrows');
    expect(m.decisionRowDirection(false, side('armed'), side('shadow'))).toBe('narrows');
    expect(m.decisionRowDirection(false, side('armed', { held: true }), side('off'))).toBe('narrows');
  } },
  { name: 'direction 4: a held gate let through again widens, and armed to held narrows', run: (m) => {
    const held = side('armed', { line: [3, 0.9], held: true });
    const armed = side('armed', { line: [3, 0.9] });
    expect(m.decisionRowDirection(true, held, armed)).toBe('widens');
    expect(m.decisionRowDirection(true, held, side('armed', { line: [4, 0.95] }))).toBe('widens');
    expect(m.decisionRowDirection(true, armed, held)).toBe('narrows');
    expect(m.decisionRowDirection(false, armed, side('armed', { held: true }))).toBe('narrows');
    // Held to held, with nothing else moved, narrows.
    expect(m.decisionRowDirection(true, held, held)).toBe('narrows');
  } },
  { name: 'direction 5: an armed gate\'s line to 0.9 from 0.8 narrows, to 0.8 from 0.9 widens, a different id at the same value widens', run: (m) => {
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.8] }), side('armed', { line: [4, 0.9] }))).toBe('narrows');
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('armed', { line: [4, 0.8] }))).toBe('widens');
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('armed', { line: [4, 0.9] }))).toBe('widens');
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('armed', { line: [3, 0.8] }))).toBe('widens');
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('armed', { line: [3, 0.9] }))).toBe('narrows');
    // The same id at a higher value is still strictly stricter.
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.8] }), side('armed', { line: [3, 0.85] }))).toBe('narrows');
    // An armed gate with no line on either side is not provably stricter.
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('armed'))).toBe('widens');
    expect(m.decisionRowDirection(true, side('armed'), side('armed', { line: [3, 0.9] }))).toBe('widens');
    // Row 5 reads armed, not held, on both sides.
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('armed', { line: [4, 0.8], held: true }))).toBe('narrows');
    // Advice has no line to ease.
    expect(m.decisionRowDirection(false, side('armed', { line: [3, 0.9] }), side('armed', { line: [4, 0.8] }))).toBe('narrows');
  } },
  { name: 'direction: an advice row armed to off narrows (it was never a gate)', run: (m) => {
    expect(m.decisionRowDirection(false, side('armed'), side('off'))).toBe('narrows');
    expect(m.decisionRowDirection(true, side('armed', { line: [3, 0.9] }), side('off'))).toBe('widens');
  } },
  { name: 'isDecisionGate: only the catalogue\'s gate rows', run: (m) => {
    for (const row of DECISION_ROW_IDS) expect(m.isDecisionGate(row), row).toBe(DECISION_QUESTIONS[row].direction === 'gate');
    expect(m.isDecisionGate('scope.widens')).toBe(true);
    expect(m.isDecisionGate('relay.method')).toBe(false);
  } },
];

// ── lineCounts and admitLine (Task 8, question 17) ────────────────────────────────────────────────────────────────────

const YN = 'relay.method' as const;
const la = (verdict: LabelledAnswer['verdict'], p: number, label: LabelledAnswer['label']): LabelledAnswer => ({ p, verdict, label });
const many = (n: number, c: LabelledAnswer): LabelledAnswer[] => Array.from({ length: n }, () => c);
const opt = (o: string): { option: string } => ({ option: o });

export const LINE_CASES: DecisionLinesCase[] = [
  { name: 'lineCounts, yes-or-no: n is the clear yeses at the line, an error is a label no; unsure and no answers are not in n', run: (m) => {
    const cases = [la('yes', 0.95, 'yes'), la('yes', 0.95, 'no'), la('yes', 0.9, 'no'), la('yes', 0.8, 'no'), la('unsure', 0.99, 'no'),
      la('no', 0.99, 'no'), la('no', 0.99, 'yes'), la(opt('a'), 0.99, 'no'), la('none', 0.99, 'no')];
    for (const id of [YN, 'scope.widens', 'programme.any'] as const) {
      const row = DECISION_QUESTIONS[id];
      expect(m.lineCounts(row, cases, 0.95), id).toEqual({ n: 2, errors: 1 });
      expect(m.lineCounts(row, cases, 0.9), id).toEqual({ n: 3, errors: 2 });
      expect(m.lineCounts(row, cases, 0.8), id).toEqual({ n: 4, errors: 3 });
      expect(m.lineCounts(row, cases, 0.5), id).toEqual({ n: 4, errors: 3 });
      expect(m.lineCounts(row, cases, 0.99), id).toEqual({ n: 0, errors: 0 });
    }
    // A label of yes or none is no error for a yes.
    expect(m.lineCounts(DECISION_QUESTIONS[YN], [la('yes', 0.99, 'yes'), la('yes', 0.99, 'none')], 0.9)).toEqual({ n: 2, errors: 0 });
  } },
  { name: 'lineCounts, choice: n is the cases naming an option at the line; an error is another option or none; none and unsure are not in n', run: (m) => {
    const row = DECISION_QUESTIONS['programme.pick'];
    const cases = [la(opt('a'), 0.95, opt('a')), la(opt('a'), 0.95, opt('b')), la(opt('b'), 0.95, 'none'), la(opt('a'), 0.7, opt('b')),
      la('none', 0.99, opt('a')), la('none', 0.99, 'none'), la('unsure', 0.99, opt('a')), la('yes', 0.99, 'yes')];
    expect(m.lineCounts(row, cases, 0.9)).toEqual({ n: 3, errors: 2 });
    expect(m.lineCounts(row, cases, 0.7)).toEqual({ n: 4, errors: 3 });
    expect(m.lineCounts(row, cases, 0.99)).toEqual({ n: 0, errors: 0 });
    expect(m.lineCounts(row, [la(opt('a'), 0.9, opt('a'))], 0.9)).toEqual({ n: 1, errors: 0 });
  } },
  { name: 'admitLine: 29 clean cases pass a 10% row, 28 do not, and nothing is admitted from none', run: (m) => {
    const row = DECISION_QUESTIONS[YN];
    const got = m.admitLine(row, many(29, la('yes', 0.96, 'yes')));
    expect(got).toMatchObject({ admitted: true, line: 0.5, labelled: 29, errors: 0 });
    if (got.admitted) expect(got.bound).toBeCloseTo(upperBound95(0, 29), 12);
    expect(m.admitLine(row, many(28, la('yes', 0.96, 'yes')))).toEqual({ admitted: false, triedFirst: 0.95 });
    expect(m.admitLine(row, [])).toEqual({ admitted: false, triedFirst: 0.95 });
  } },
  { name: 'admitLine: a gate\'s 5% target needs 59 clean cases, not 58', run: (m) => {
    const row = DECISION_QUESTIONS['scope.widens'];
    expect(m.admitLine(row, many(59, la('yes', 0.96, 'yes'))).admitted).toBe(true);
    expect(m.admitLine(row, many(58, la('yes', 0.96, 'yes')))).toEqual({ admitted: false, triedFirst: 0.95 });
  } },
  { name: 'admitLine: fixed sequence, strictest first, stopped at the first that fails: a looser line that would pass is never tried', run: (m) => {
    const row = DECISION_QUESTIONS[YN];
    // 0.95 passes (29 clean), 0.9 passes (same 29), 0.85 fails (one error at 0.87 makes 1 of 30), 0.8 would pass (100 clean at 0.82).
    const cases = [...many(29, la('yes', 0.97, 'yes')), la('yes', 0.87, 'no'), ...many(100, la('yes', 0.82, 'yes'))];
    expect(m.lineCounts(row, cases, 0.85)).toEqual({ n: 30, errors: 1 });
    expect(upperBound95(1, 30)).toBeGreaterThan(0.1);
    expect(m.lineCounts(row, cases, 0.8)).toEqual({ n: 130, errors: 1 });
    expect(upperBound95(1, 130)).toBeLessThan(0.1);
    const got = m.admitLine(row, cases);
    expect(got).toMatchObject({ admitted: true, line: 0.9, labelled: 29, errors: 0 });
  } },
  { name: 'admitLine: the last line that passed is admitted, with the counts at that line', run: (m) => {
    const row = DECISION_QUESTIONS[YN];
    // 29 clean at 0.97 pass 0.95 and 0.9; at 0.7 a case with an error enters and fails the bound.
    const cases = [...many(29, la('yes', 0.97, 'yes')), ...many(3, la('yes', 0.72, 'yes')), la('yes', 0.71, 'no')];
    const got = m.admitLine(row, cases);
    expect(got).toMatchObject({ admitted: true, line: 0.75, labelled: 29, errors: 0 });
  } },
  { name: 'admitLine: a bound at the target passes, one over fails (the test is over, not at)', run: (m) => {
    const row = { ...DECISION_QUESTIONS[YN], target: upperBound95(0, 29) } as typeof DECISION_QUESTIONS[typeof YN];
    expect(m.admitLine(row, many(29, la('yes', 0.96, 'yes'))).admitted).toBe(true);
    expect(m.admitLine({ ...row, target: upperBound95(0, 29) - 1e-9 } as typeof row, many(29, la('yes', 0.96, 'yes'))).admitted).toBe(false);
  } },
  { name: 'admitLine: an unsure and a none answer are not in n, and a wrong option is an error on a choice row', run: (m) => {
    const yn = DECISION_QUESTIONS[YN];
    expect(m.admitLine(yn, [...many(28, la('yes', 0.96, 'yes')), ...many(9, la('unsure', 0.99, 'no'))])).toEqual({ admitted: false, triedFirst: 0.95 });
    const pick = DECISION_QUESTIONS['programme.pick'];
    const clean = many(29, la(opt('a'), 0.96, opt('a')));
    expect(m.admitLine(pick, clean)).toMatchObject({ admitted: true, labelled: 29, errors: 0 });
    expect(m.admitLine(pick, [...clean, ...many(40, la('none', 0.99, 'none'))])).toMatchObject({ admitted: true, labelled: 29 });
    expect(m.admitLine(pick, [...many(28, la(opt('a'), 0.96, opt('a'))), la(opt('a'), 0.96, opt('b'))])).toEqual({ admitted: false, triedFirst: 0.95 });
    expect(m.admitLine(pick, [...many(28, la(opt('a'), 0.96, opt('a'))), la(opt('a'), 0.96, 'none')])).toEqual({ admitted: false, triedFirst: 0.95 });
    // A `none` label on a yes-or-no row is no error; an error among enough cases still passes.
    const big = [...many(150, la('yes', 0.96, 'yes')), la('yes', 0.96, 'no')];
    expect(m.admitLine(yn, big)).toMatchObject({ admitted: true, labelled: 151, errors: 1 });
  } },
];

// ── canaryCrossed, canaryVerdict and anchorDrift (Task 8, questions 17 and 18) ────────────────────────────────────────

const cc = (id: DecisionRowId, m: DecisionLinesModule, plain: LabelledAnswer['verdict'], plainP: number, pert: LabelledAnswer['verdict'], pertP: number, line = 0.9): boolean =>
  m.canaryCrossed(DECISION_QUESTIONS[id], line, plain, plainP, pert, pertP);

export const CANARY_CASES: DecisionLinesCase[] = [
  { name: 'canaryCrossed, an attacker who wants no: the plain answer marks at the line and the perturbed one does not', run: (m) => {
    expect(cc(ADVICE, m, 'yes', 0.95, 'no', 0.1)).toBe(true);
    expect(cc(ADVICE, m, 'yes', 0.95, 'yes', 0.5)).toBe(true);
    expect(cc(ADVICE, m, 'yes', 0.95, 'yes', 0.8999)).toBe(true);
    expect(cc(ADVICE, m, 'yes', 0.9, 'unsure', 0.9)).toBe(true);
    expect(cc(ADVICE, m, 'yes', 0.95, opt('a'), 0.99)).toBe(true);
    expect(cc(ADVICE, m, 'yes', 0.95, 'yes', 0.9)).toBe(false);
    expect(cc(ADVICE, m, 'yes', 0.95, 'yes', 0.99)).toBe(false);
    // The plain answer is not a mark: nothing was lost.
    expect(cc(ADVICE, m, 'yes', 0.8999, 'no', 0.1)).toBe(false);
    expect(cc(ADVICE, m, 'no', 0.1, 'no', 0.1)).toBe(false);
    expect(cc(ADVICE, m, 'unsure', 0.99, 'no', 0.1)).toBe(false);
    // Away from the attacker\'s answer: a mark gained is no crossing.
    expect(cc(ADVICE, m, 'no', 0.1, 'yes', 0.99)).toBe(false);
  } },
  { name: 'canaryCrossed, an attacker who wants yes: the plain answer is not a clear yes and the perturbed one is', run: (m) => {
    expect(cc('scope.widens', m, 'no', 0.1, 'yes', 0.95)).toBe(true);
    expect(cc('scope.widens', m, 'unsure', 0.99, 'yes', 0.95)).toBe(true);
    expect(cc('scope.widens', m, 'yes', 0.5, 'yes', 0.9)).toBe(true);
    expect(cc('scope.widens', m, 'yes', 0.8999, 'yes', 0.9)).toBe(true);
    expect(cc('scope.widens', m, 'yes', 0.95, 'yes', 0.99)).toBe(false);
    expect(cc('scope.widens', m, 'yes', 0.95, 'no', 0.1)).toBe(false);
    expect(cc('scope.widens', m, 'no', 0.1, 'yes', 0.8999)).toBe(false);
    expect(cc('scope.widens', m, 'no', 0.1, 'unsure', 0.99)).toBe(false);
    expect(cc('scope.widens', m, 'no', 0.1, 'no', 0.1)).toBe(false);
  } },
  { name: 'canaryCrossed, an attacker who wants an option: the perturbed answer names a different option, none and unsure included', run: (m) => {
    const pick = 'programme.pick' as const;
    expect(cc(pick, m, opt('a'), 0.95, opt('b'), 0.95)).toBe(true);
    expect(cc(pick, m, opt('a'), 0.95, 'none', 0.95)).toBe(true);
    expect(cc(pick, m, opt('a'), 0.95, 'unsure', 0.95)).toBe(true);
    expect(cc(pick, m, opt('a'), 0.95, opt('a'), 0.5)).toBe(true);
    expect(cc(pick, m, opt('a'), 0.95, opt('a'), 0.95)).toBe(false);
    expect(cc(pick, m, opt('a'), 0.95, opt('a'), 0.99)).toBe(false);
    // An option exactly at the line is named there.
    expect(cc(pick, m, opt('a'), 0.9, opt('a'), 0.95)).toBe(false);
    expect(cc(pick, m, opt('a'), 0.9, opt('b'), 0.9)).toBe(true);
    // A pick gained from no pick is a move toward an option.
    expect(cc(pick, m, 'none', 0.95, opt('b'), 0.95)).toBe(true);
    expect(cc(pick, m, 'unsure', 0.95, opt('b'), 0.95)).toBe(true);
    expect(cc(pick, m, opt('a'), 0.5, opt('b'), 0.95)).toBe(true);
    // Neither names an option at the line: the answer moved away from an option, or stayed.
    expect(cc(pick, m, 'none', 0.95, 'unsure', 0.95)).toBe(false);
    expect(cc(pick, m, 'unsure', 0.95, 'none', 0.95)).toBe(false);
    expect(cc(pick, m, opt('a'), 0.5, opt('b'), 0.5)).toBe(false);
    expect(cc(pick, m, opt('a'), 0.5, 'none', 0.95)).toBe(false);
    expect(cc(pick, m, 'none', 0.95, 'none', 0.95)).toBe(false);
  } },
  { name: 'canaryVerdict: 0 asked has not run, a partial set is incomplete, and 5% of the full set is the line (295: 14 held, 15 unmet)', run: (m) => {
    expect(m.canaryVerdict(0, 0, 295)).toBe('not-run');
    expect(m.canaryVerdict(0, 0, 0)).toBe('not-run');
    expect(m.canaryVerdict(5, 0, 0)).toBe('not-run');
    expect(m.canaryVerdict(1, 0, 295)).toBe('incomplete');
    expect(m.canaryVerdict(100, 0, 295)).toBe('incomplete');
    expect(m.canaryVerdict(294, 0, 295)).toBe('incomplete');
    expect(m.canaryVerdict(294, 20, 295)).toBe('incomplete');
    expect(m.canaryVerdict(295, 0, 295)).toBe('held');
    expect(m.canaryVerdict(295, 14, 295)).toBe('held');
    expect(m.canaryVerdict(295, 15, 295)).toBe('unmet');
    expect(m.canaryVerdict(295, 295, 295)).toBe('unmet');
    expect(m.canaryVerdict(145, 7, 145)).toBe('held');
    expect(m.canaryVerdict(145, 8, 145)).toBe('unmet');
    expect(m.canaryVerdict(20, 1, 20)).toBe('held');
    expect(m.canaryVerdict(20, 2, 20)).toBe('unmet');
  } },
  { name: 'anchorDrift: 3 of 20 moved holds, 4 fires, position by position', run: (m) => {
    const base: DecisionBand[] = Array.from({ length: 20 }, (_, i) => DECISION_BANDS[i % 4]!);
    const moved = (n: number, from = 0): DecisionBand[] => base.map((b, i) => (i >= from && i < from + n ? DECISION_BANDS[(DECISION_BANDS.indexOf(b) + 1) % 4]! : b));
    expect(m.anchorDrift(base, base)).toBe(false);
    expect(m.anchorDrift(base, moved(3))).toBe(false);
    expect(m.anchorDrift(base, moved(4))).toBe(true);
    expect(m.anchorDrift(base, moved(3, 17))).toBe(false);
    expect(m.anchorDrift(base, moved(4, 16))).toBe(true);
    expect(m.anchorDrift(base, moved(20))).toBe(true);
    // Moving to a far band counts the same as moving to the next.
    expect(m.anchorDrift(base.map(() => 'unlikely' as const), base.map((_, i) => (i < 4 ? 'very-likely' as const : 'unlikely' as const)))).toBe(true);
    // The same shares in another order are drift: the comparison is by position.
    const swapped = [...base.slice(10), ...base.slice(0, 10)];
    expect(m.anchorDrift(base, swapped)).toBe(true);
  } },
  { name: 'anchorDrift: a set that is not 20 on both sides cannot be shown not to have drifted, so it counts as drift', run: (m) => {
    const base: DecisionBand[] = Array.from({ length: 20 }, () => 'likely' as const);
    expect(m.anchorDrift(base.slice(0, 19), base)).toBe(true);
    expect(m.anchorDrift(base, base.slice(0, 19))).toBe(true);
    expect(m.anchorDrift(base.slice(0, 19), base.slice(0, 19))).toBe(true);
    expect(m.anchorDrift([...base, 'likely'], [...base, 'likely'])).toBe(true);
    expect(m.anchorDrift([], [])).toBe(true);
    expect(m.anchorDrift(base, [])).toBe(true);
  } },
];

// ── the doors (Task 7) ──────────────────────────────────────────────────────────────────────────────────────────────

const lf = (id: number, o: Partial<DecisionLineFacts> = {}): DecisionLineFacts =>
  ({ id, line: 0.9, underToday: true, canaryAsked: 295, canaryExpected: 295, canaryCrossed: 0, ...o });
type ArmInput = Parameters<DecisionLinesModule['decideRowArm']>[0];
const SHADOW_SIDE = side('shadow', { ceiling: 700 });
const arm = (o: Partial<ArmInput> = {}, body: unknown = { mode: 'armed', expected: SHADOW_SIDE }): ArmInput => ({
  rowId: 'scope.widens', body, host: { kind: 'local' }, keySet: true, currentLine: lf(5),
  lineById: (id) => (id === 5 ? lf(5) : id === 3 ? lf(3, { line: 0.8 }) : null), ...o });
const refusal = (refusal: string): { ok: false; refusal: string; detail: string } => ({ ok: false, refusal, detail: expect.any(String) as string });
const moved = (row: DecisionRowId, expected: DecisionRowSide, to: DecisionRowSide, heldCause: string | null = null): unknown =>
  ({ ok: true, row, expected, to, heldCause });

export const ARM_CASES: DecisionLinesCase[] = [
  { name: 'arm 1: a row that is not in the catalogue is decision-row-unknown, before the body is read', run: (m) => {
    for (const rowId of ['nope', '', '__proto__', 'constructor', 'toString', 'scope.widens ']) {
      expect(m.decideRowArm(arm({ rowId }, null)), rowId).toEqual(refusal('decision-row-unknown'));
    }
  } },
  { name: 'arm 2: a body that is not exactly mode, expected and an optional line is bad-request', run: (m) => {
    const e = SHADOW_SIDE;
    const bad: unknown[] = [null, 'armed', 7, [], [{ mode: 'armed', expected: e }], {}, { mode: 'armed' }, { expected: e }, { mode: 'armed', expected: e, extra: 1 },
      { mode: 'armed', expected: e, line: 0 }, { mode: 'armed', expected: e, line: -1 }, { mode: 'armed', expected: e, line: 1.5 },
      { mode: 'armed', expected: e, line: '5' }, { mode: 'armed', expected: e, line: null }, { mode: 'armed', expected: e, line: undefined },
      { mode: 'armed', expected: e, line: Number.NaN }, { mode: 'armed', expected: e, line: 2 ** 53 },
      { mode: 'off', expected: e }, { mode: 'ARMED', expected: e }, { mode: 7, expected: e }, { mode: null, expected: e },
      { mode: 'armed', expected: null }, { mode: 'armed', expected: { ...e, ceiling: 10 } }, { mode: 'armed', expected: { mode: 'shadow' } },
      { mode: 'armed', expected: { ...e, extra: 1 } }, { mode: 'armed', expected: { ...e, armedLine: { id: 0, line: 0.9 } } },
      { mode: 'armed', expected: { ...e, mode: 'on' } }];
    for (const body of bad) expect(m.decideRowArm(arm({}, body)), JSON.stringify(body)).toEqual(refusal('bad-request'));
    // A body with a bad shape is refused before the host is read.
    expect(m.decideRowArm(arm({ host: null, keySet: false }, {}))).toEqual(refusal('bad-request'));
    // line and mode shadow are fine together; a valid line is a positive safe integer.
    expect(m.decideRowArm(arm({}, { mode: 'shadow', expected: e, line: 5 })).ok).toBe(true);
    expect(m.decideRowArm(arm({}, { mode: 'armed', expected: e, line: 1 }))).toEqual(refusal('line-not-admitted'));
  } },
  { name: 'arm 3: no host or no key is key-unset', run: (m) => {
    expect(m.decideRowArm(arm({ host: null }))).toEqual(refusal('key-unset'));
    expect(m.decideRowArm(arm({ keySet: false }))).toEqual(refusal('key-unset'));
    expect(m.decideRowArm(arm({ host: { kind: 'hosted' }, keySet: false }))).toEqual(refusal('key-unset'));
    expect(m.decideRowArm(arm({ host: null, currentLine: null }))).toEqual(refusal('key-unset'));
  } },
  { name: 'arm 4: a private-state row is never armed or shadowed on a hosted host (index Q10)', run: (m) => {
    for (const rowId of ['scope.widens', 'readback.omits', 'readback.adds']) {
      for (const mode of ['shadow', 'armed']) {
        expect(m.decideRowArm(arm({ rowId, host: { kind: 'hosted' }, currentLine: null }, { mode, expected: SHADOW_SIDE })), `${rowId} ${mode}`).toEqual(refusal('private-state-host'));
      }
      expect(m.decideRowArm(arm({ rowId, host: { kind: 'zero-retention' } }, { mode: 'shadow', expected: SHADOW_SIDE })).ok, rowId).toBe(true);
      expect(m.decideRowArm(arm({ rowId, host: { kind: 'local' } }, { mode: 'shadow', expected: SHADOW_SIDE })).ok, rowId).toBe(true);
    }
    for (const rowId of ['relay.method', 'programme.pick', 'programme.any', 'goals.conflict']) {
      expect(m.decideRowArm(arm({ rowId, host: { kind: 'hosted' } }, { mode: 'shadow', expected: SHADOW_SIDE })).ok, rowId).toBe(true);
    }
  } },
  { name: 'arm 5: armed needs an admitted line under today, the current one when line is named', run: (m) => {
    const body = (extra: object = {}): unknown => ({ mode: 'armed', expected: SHADOW_SIDE, ...extra });
    expect(m.decideRowArm(arm({ currentLine: null }, body()))).toEqual(refusal('line-not-admitted'));
    expect(m.decideRowArm(arm({ currentLine: null }, body({ line: 5 })))).toEqual(refusal('line-not-admitted'));
    // A line named other than the current one.
    expect(m.decideRowArm(arm({}, body({ line: 3 })))).toEqual(refusal('line-not-admitted'));
    expect(m.decideRowArm(arm({}, body({ line: 99 })))).toEqual(refusal('line-not-admitted'));
    // The current line is not under today\'s host, model and revision, or the lookup finds nothing.
    expect(m.decideRowArm(arm({ lineById: () => lf(5, { underToday: false }) }, body()))).toEqual(refusal('line-not-admitted'));
    expect(m.decideRowArm(arm({ lineById: () => lf(5, { underToday: false }) }, body({ line: 5 })))).toEqual(refusal('line-not-admitted'));
    expect(m.decideRowArm(arm({ lineById: () => null }, body()))).toEqual(refusal('line-not-admitted'));
    expect(m.decideRowArm(arm({ lineById: () => null }, body({ line: 5 })))).toEqual(refusal('line-not-admitted'));
    // A gate armed on an older line, line omitted: that line must still stand under today.
    const armedOld = side('armed', { ceiling: 700, line: [3, 0.8] });
    expect(m.decideRowArm(arm({ lineById: (id) => (id === 5 ? lf(5) : null) }, body({ expected: armedOld })))).toEqual(refusal('line-not-admitted'));
    expect(m.decideRowArm(arm({ lineById: (id) => (id === 5 ? lf(5) : lf(3, { underToday: false })) }, body({ expected: armedOld })))).toEqual(refusal('line-not-admitted'));
    // Shadow needs no line at all.
    expect(m.decideRowArm(arm({ currentLine: null, lineById: () => null }, { mode: 'shadow', expected: SHADOW_SIDE })).ok).toBe(true);
  } },
  { name: 'arm 6: armed needs the canary complete and held: 100 of 295 asked with 0 crossed is canary-unmet', run: (m) => {
    const withCanary = (o: Partial<DecisionLineFacts>): Partial<ArmInput> => ({ currentLine: lf(5, o), lineById: () => lf(5, o) });
    expect(m.decideRowArm(arm(withCanary({ canaryAsked: 100 })))).toEqual(refusal('canary-unmet'));
    expect(m.decideRowArm(arm(withCanary({ canaryAsked: 0 })))).toEqual(refusal('canary-unmet'));
    expect(m.decideRowArm(arm(withCanary({ canaryAsked: 294 })))).toEqual(refusal('canary-unmet'));
    expect(m.decideRowArm(arm(withCanary({ canaryCrossed: 15 })))).toEqual(refusal('canary-unmet'));
    expect(m.decideRowArm(arm(withCanary({ canaryCrossed: 14 }))).ok).toBe(true);
    expect(m.decideRowArm(arm(withCanary({ canaryAsked: 0, canaryExpected: 0 })))).toEqual(refusal('canary-unmet'));
    // Shadow is not gated by a canary.
    expect(m.decideRowArm(arm(withCanary({ canaryAsked: 0 }), { mode: 'shadow', expected: SHADOW_SIDE })).ok).toBe(true);
    // The canary is read from the line named, not from the current one.
    const armedOld = side('armed', { ceiling: 700, line: [3, 0.8] });
    expect(m.decideRowArm(arm({ lineById: (id) => (id === 3 ? lf(3, { canaryAsked: 5 }) : lf(5)) }, { mode: 'armed', expected: armedOld }))).toEqual(refusal('canary-unmet'));
  } },
  { name: 'arm 7: the move: a gate takes the line it arms on, advice takes none, shadow takes none, the ceiling is unchanged', run: (m) => {
    // A gate, shadow to armed: the current line, with its value from the line\'s own facts.
    expect(m.decideRowArm(arm())).toEqual(moved('scope.widens', SHADOW_SIDE, side('armed', { ceiling: 700, line: [5, 0.9] })));
    expect(m.decideRowArm(arm({}, { mode: 'armed', expected: SHADOW_SIDE, line: 5 }))).toEqual(moved('scope.widens', SHADOW_SIDE, side('armed', { ceiling: 700, line: [5, 0.9] })));
    // Advice armed: no armed line.
    expect(m.decideRowArm(arm({ rowId: ADVICE }))).toEqual(moved(ADVICE, SHADOW_SIDE, side('armed', { ceiling: 700 })));
    // Shadow, a gate included: no armed line, and an armed row coming back to shadow drops it.
    expect(m.decideRowArm(arm({}, { mode: 'shadow', expected: SHADOW_SIDE }))).toEqual(moved('scope.widens', SHADOW_SIDE, SHADOW_SIDE));
    const armedGate = side('armed', { ceiling: 900, line: [3, 0.8] });
    expect(m.decideRowArm(arm({}, { mode: 'shadow', expected: armedGate }))).toEqual(moved('scope.widens', armedGate, side('shadow', { ceiling: 900 })));
    // A held row, resumed with the stored mode: held clears, nothing else, and the cause is not set by the decider.
    const heldGate = side('armed', { ceiling: 900, line: [3, 0.8], held: true });
    expect(m.decideRowArm(arm({}, { mode: 'armed', expected: heldGate }))).toEqual(moved('scope.widens', heldGate, side('armed', { ceiling: 900, line: [3, 0.8] })));
    const heldAdvice = side('armed', { held: true });
    expect(m.decideRowArm(arm({ rowId: ADVICE }, { mode: 'armed', expected: heldAdvice }))).toEqual(moved(ADVICE, heldAdvice, side('armed')));
    expect(m.decideRowArm(arm({ rowId: ADVICE }, { mode: 'shadow', expected: heldAdvice }))).toEqual(moved(ADVICE, heldAdvice, side('shadow')));
  } },
  { name: 'arm: an armed gate keeps its armedLine when line is omitted, though a newer current line exists (ruling F4); line names the newer one to take it', run: (m) => {
    const armedOld = side('armed', { ceiling: 700, line: [3, 0.8] });
    expect(m.decideRowArm(arm({}, { mode: 'armed', expected: armedOld }))).toEqual(moved('scope.widens', armedOld, armedOld));
    // The old line must have its own canary held, as an old line\'s facts say.
    expect(m.decideRowArm(arm({}, { mode: 'armed', expected: armedOld, line: 5 }))).toEqual(moved('scope.widens', armedOld, side('armed', { ceiling: 700, line: [5, 0.9] })));
    // With no current line at all, the armed line still stands.
    expect(m.decideRowArm(arm({ currentLine: null }, { mode: 'armed', expected: armedOld }))).toEqual(moved('scope.widens', armedOld, armedOld));
    // An armed advice row has no armed line to keep: it takes the current one if any, else refuses.
    expect(m.decideRowArm(arm({ rowId: ADVICE }, { mode: 'armed', expected: side('armed', { ceiling: 700 }) }))).toEqual(moved(ADVICE, side('armed', { ceiling: 700 }), side('armed', { ceiling: 700 })));
    expect(m.decideRowArm(arm({ rowId: ADVICE, currentLine: null }, { mode: 'armed', expected: side('armed', { ceiling: 700 }) }))).toEqual(refusal('line-not-admitted'));
  } },
];

export const OFF_CASES: DecisionLinesCase[] = [
  { name: 'off: unknown row, then a body that is not exactly { expected }, then the move to off with the ceiling kept', run: (m) => {
    expect(m.decideRowOff({ rowId: 'nope', body: null })).toEqual(refusal('decision-row-unknown'));
    expect(m.decideRowOff({ rowId: '__proto__', body: { expected: SHADOW_SIDE } })).toEqual(refusal('decision-row-unknown'));
    for (const body of [null, 'x', [], {}, { expected: null }, { expected: { ...SHADOW_SIDE, ceiling: 1 } }, { expected: SHADOW_SIDE, extra: 1 },
      { expect: SHADOW_SIDE }, { expected: SHADOW_SIDE, mode: 'off' }]) {
      expect(m.decideRowOff({ rowId: 'scope.widens', body }), JSON.stringify(body)).toEqual(refusal('bad-request'));
    }
    const armed = side('armed', { ceiling: 900, line: [3, 0.9], held: true });
    expect(m.decideRowOff({ rowId: 'scope.widens', body: { expected: armed } })).toEqual(moved('scope.widens', armed, side('off', { ceiling: 900 })));
    expect(m.decideRowOff({ rowId: ADVICE, body: { expected: SHADOW_SIDE } })).toEqual(moved(ADVICE, SHADOW_SIDE, side('off', { ceiling: 700 })));
    expect(m.decideRowOff({ rowId: ADVICE, body: { expected: side('off') } })).toEqual(moved(ADVICE, side('off'), side('off')));
  } },
];

export const OFF_FALLBACK_CASES: DecisionLinesCase[] = [
  { name: 'offFallback (ruling F1): an armed gate whose off the journal refused is held, or already held; anything else is refused', run: (m) => {
    const armed = side('armed', { line: [3, 0.9] });
    const held = side('armed', { line: [3, 0.9], held: true });
    for (const error of ['authority-rolled-back', 'authority-unmeasured']) {
      expect(m.offFallback('scope.widens', armed, error), error).toBe('hold');
      expect(m.offFallback('scope.widens', held, error), error).toBe('already-held');
      expect(m.offFallback('scope.widens', SHADOW_SIDE, error), error).toBe('refuse');
      expect(m.offFallback('scope.widens', side('off'), error), error).toBe('refuse');
      expect(m.offFallback('relay.method', side('armed'), error), error).toBe('refuse');
      expect(m.offFallback('relay.method', side('armed', { held: true }), error), error).toBe('refuse');
    }
    for (const error of ['journal-unreadable', 'row-changed', 'authority-rolled', '', 'unknown']) {
      expect(m.offFallback('scope.widens', armed, error), error).toBe('refuse');
      expect(m.offFallback('scope.widens', held, error), error).toBe('refuse');
    }
  } },
];

export const CEILING_CASES: DecisionLinesCase[] = [
  { name: 'ceiling: unknown row, bad-request, bad-ceiling, in that order', run: (m) => {
    expect(m.decideRowCeiling({ rowId: 'nope', body: null })).toEqual(refusal('decision-row-unknown'));
    const e = SHADOW_SIDE;
    for (const body of [null, 'x', [], {}, { ceiling: 700 }, { expected: e }, { ceiling: '700', expected: e }, { ceiling: 700.5, expected: e },
      { ceiling: null, expected: e }, { ceiling: Number.NaN, expected: e }, { ceiling: 700, expected: e, extra: 1 }, { ceiling: 700, expected: null },
      { ceiling: 700, expected: { ...e, ceiling: 10 } }, { ceiling: 49.5, expected: e }, { ceiling: Infinity, expected: e }]) {
      expect(m.decideRowCeiling({ rowId: 'scope.widens', body }), JSON.stringify(body)).toEqual(refusal('bad-request'));
    }
    for (const ceiling of [49, 5001, 0, -1, 2 ** 53 - 1]) {
      expect(m.decideRowCeiling({ rowId: 'scope.widens', body: { ceiling, expected: e } }), String(ceiling)).toEqual(refusal('bad-ceiling'));
    }
    // A bad body is refused before its ceiling is bounded.
    expect(m.decideRowCeiling({ rowId: 'scope.widens', body: { ceiling: 49, expected: null } })).toEqual(refusal('bad-request'));
  } },
  { name: 'ceiling (ruling F4): only the ceiling changes; held, mode and armedLine are kept, and the cause is the store\'s', run: (m) => {
    const heldGate = side('armed', { ceiling: 900, line: [3, 0.8], held: true });
    expect(m.decideRowCeiling({ rowId: 'scope.widens', body: { ceiling: 300, expected: heldGate } }))
      .toEqual(moved('scope.widens', heldGate, side('armed', { ceiling: 300, line: [3, 0.8], held: true })));
    for (const ceiling of [50, 5000]) {
      expect(m.decideRowCeiling({ rowId: ADVICE, body: { ceiling, expected: SHADOW_SIDE } })).toEqual(moved(ADVICE, SHADOW_SIDE, side('shadow', { ceiling })));
    }
    const off = side('off');
    expect(m.decideRowCeiling({ rowId: ADVICE, body: { ceiling: 800, expected: off } })).toEqual(moved(ADVICE, off, side('off', { ceiling: 800 })));
    const armed = side('armed', { line: [4, 0.95] });
    expect(m.decideRowCeiling({ rowId: 'scope.widens', body: { ceiling: 601, expected: armed } })).toEqual(moved('scope.widens', armed, side('armed', { ceiling: 601, line: [4, 0.95] })));
  } },
];

const KEY = 'key-secret-value-1';
type KeyInput = Parameters<DecisionLinesModule['decideKeyDoor']>[0];
const keyBody = (o: Record<string, unknown> = {}): unknown => ({ kind: 'local', endpoint: 'http://127.0.0.1:9000/v1', modelId: 'model-a', key: KEY, ...o });
const keyDoor = (o: Partial<KeyInput> = {}, body: unknown = keyBody()): KeyInput => ({ body, addresses: ['127.0.0.1'], stored: null, ...o });
const STORED = { kind: 'local' as const, origin: 'http://127.0.0.1:9000', modelId: 'model-a', keySet: true };

/** The key door, with the rule that no refusal carries the key's text asserted on every answer. */
const kd = (m: DecisionLinesModule, input: KeyInput): ReturnType<DecisionLinesModule['decideKeyDoor']> => {
  const got = m.decideKeyDoor(input);
  if (!got.ok) expect(JSON.stringify(got), 'the key\'s text is never in a refusal').not.toContain(KEY);
  return got;
};

export const KEY_DOOR_CASES: DecisionLinesCase[] = [
  { name: 'key door 1: a body that is not exactly kind, endpoint, modelId and an optional key is bad-request', run: (m) => {
    const bad: unknown[] = [null, 'x', 7, [], [keyBody()], {}, { kind: 'local', endpoint: 'http://127.0.0.1', key: KEY }, { endpoint: 'http://127.0.0.1', modelId: 'm' },
      { kind: 'local', modelId: 'm' }, keyBody({ extra: 1 }), keyBody({ kind: 'cloud' }), keyBody({ kind: 7 }), keyBody({ kind: null }),
      keyBody({ endpoint: 7 }), keyBody({ endpoint: null }), keyBody({ modelId: '' }), keyBody({ modelId: 'x'.repeat(201) }), keyBody({ modelId: 7 }),
      keyBody({ key: '' }), keyBody({ key: 'a\nb' }), keyBody({ key: 'a\rb' }), keyBody({ key: 'a\u2028b' }), keyBody({ key: 'a\u2029b' }), keyBody({ key: 'x'.repeat(4097) }), keyBody({ key: 7 }), keyBody({ key: null }),
      keyBody({ key: undefined })];
    for (const body of bad) {
      const got = kd(m, keyDoor({}, body));
      expect(got, JSON.stringify(body)).toEqual(refusal('bad-request'));
      expect(JSON.stringify(got)).not.toContain(KEY);
    }
    expect(kd(m, keyDoor({}, keyBody({ modelId: 'x'.repeat(200) }))).ok).toBe(true);
    expect(kd(m, keyDoor({}, keyBody({ key: 'x'.repeat(4096) }))).ok).toBe(true);
    expect(kd(m, keyDoor({}, keyBody({ modelId: 'm' }))).ok).toBe(true);
    expect(kd(m, keyDoor({ stored: STORED }, { kind: 'local', endpoint: 'http://127.0.0.1:9000', modelId: 'model-a' })).ok).toBe(true);
  } },
  { name: 'key door 2: an endpoint that is no http or https URL, or carries userinfo, a query or a fragment, is bad-endpoint', run: (m) => {
    const hosted = (endpoint: string): unknown => keyBody({ kind: 'hosted', endpoint });
    const pub = { addresses: ['203.0.113.9'] };
    for (const endpoint of ['not a url', '', 'host.example', 'ftp://host.example/', 'file:///etc/passwd', 'javascript:alert(1)', 'https://', 'https://user@host.example/',
      'https://user:pw@host.example/', 'https://@host.example/', 'https://host.example/?q=1', 'https://host.example/?', 'https://host.example/v1?x', 'https://host.example/#frag',
      'https://host.example/#', 'https://host.example?q=1']) {
      const got = kd(m, keyDoor(pub, hosted(endpoint)));
      expect(got, endpoint).toEqual(refusal('bad-endpoint'));
      expect(JSON.stringify(got)).not.toContain(KEY);
    }
    // A scheme other than http and https is refused for a local host too, which no later row would stop.
    for (const endpoint of ['ftp://127.0.0.1:9000', 'ws://127.0.0.1:9000', 'file:///etc/passwd']) {
      expect(kd(m, keyDoor({}, keyBody({ endpoint }))), endpoint).toEqual(refusal('bad-endpoint'));
    }
    expect(kd(m, keyDoor(pub, hosted('https://host.example/v1/chat'))).ok).toBe(true);
    expect(kd(m, keyDoor(pub, hosted('https://model-host-a.example:8443/v1'))).ok).toBe(true);
  } },
  { name: 'key door 3: hosted and zero-retention endpoints must be https', run: (m) => {
    for (const kind of ['hosted', 'zero-retention']) {
      expect(kd(m, keyDoor({ addresses: ['127.0.0.1'] }, keyBody({ kind, endpoint: 'http://127.0.0.1:9000' }))), kind).toEqual(refusal('bad-endpoint'));
      expect(kd(m, keyDoor({ addresses: ['203.0.113.9'] }, keyBody({ kind, endpoint: 'http://model-host-a.example' }))), kind).toEqual(refusal('bad-endpoint'));
      expect(kd(m, keyDoor({ addresses: ['203.0.113.9'] }, keyBody({ kind, endpoint: 'https://model-host-a.example' }))).ok, kind).toBe(true);
    }
  } },
  { name: 'key door 4: a local endpoint names an address literal or localhost, and every resolved address is loopback or private', run: (m) => {
    const local = (endpoint: string, addresses: string[]): unknown => kd(m, keyDoor({ addresses }, keyBody({ endpoint })));
    // A public address for a local host.
    expect(local('https://203.0.113.9', ['203.0.113.9'])).toEqual(refusal('bad-endpoint'));
    expect(local('https://10.0.0.5', ['10.0.0.5', '203.0.113.9'])).toEqual(refusal('bad-endpoint'));
    expect(local('https://10.0.0.5', [])).toEqual(refusal('bad-endpoint'));
    // A name, even one that resolves to a private address.
    expect(local('https://model-host-a.example', ['10.0.0.5'])).toEqual(refusal('bad-endpoint'));
    expect(local('https://model-host-a.example', ['127.0.0.1'])).toEqual(refusal('bad-endpoint'));
    expect(local('http://localhost.example:9000', ['127.0.0.1'])).toEqual(refusal('bad-endpoint'));
    // Literals and localhost.
    expect((local('https://10.0.0.5', ['10.0.0.5']) as { ok: boolean }).ok).toBe(true);
    expect((local('https://192.168.1.2:9000/v1', ['192.168.1.2']) as { ok: boolean }).ok).toBe(true);
    expect((local('https://172.16.0.1', ['172.16.0.1']) as { ok: boolean }).ok).toBe(true);
    expect((local('https://[fd00::1]:9000/v1', ['fd00::1']) as { ok: boolean }).ok).toBe(true);
    expect((local('http://[::1]:9000', ['::1']) as { ok: boolean }).ok).toBe(true);
    expect((local('http://localhost:9000', ['127.0.0.1']) as { ok: boolean }).ok).toBe(true);
    expect((local('https://localhost', ['::1']) as { ok: boolean }).ok).toBe(true);
    expect(local('https://[2001:db8::1]', ['2001:db8::1'])).toEqual(refusal('bad-endpoint'));
    // A hosted endpoint is not held to this row.
    expect(kd(m, keyDoor({ addresses: ['203.0.113.9'] }, keyBody({ kind: 'hosted', endpoint: 'https://model-host-a.example' }))).ok).toBe(true);
  } },
  { name: 'key door 5: a key goes over http only to a loopback address', run: (m) => {
    const local = (endpoint: string, addresses: string[]): unknown => kd(m, keyDoor({ addresses }, keyBody({ endpoint })));
    expect((local('http://127.0.0.1', ['127.0.0.1']) as { ok: boolean }).ok).toBe(true);
    expect((local('http://127.0.0.1:9000/v1', ['127.0.0.1']) as { ok: boolean }).ok).toBe(true);
    expect((local('http://[::1]', ['::1']) as { ok: boolean }).ok).toBe(true);
    expect(local('http://10.0.0.5', ['10.0.0.5'])).toEqual(refusal('bad-endpoint'));
    expect(local('http://192.168.0.5:9000', ['192.168.0.5'])).toEqual(refusal('bad-endpoint'));
    expect(local('http://[fd00::1]', ['fd00::1'])).toEqual(refusal('bad-endpoint'));
    expect(local('http://localhost', ['127.0.0.1', '10.0.0.5'])).toEqual(refusal('bad-endpoint'));
    expect((local('https://10.0.0.5', ['10.0.0.5']) as { ok: boolean }).ok).toBe(true);
  } },
  { name: 'key door 6: a new endpoint origin needs the key in the same call', run: (m) => {
    const body = (o: Record<string, unknown>): unknown => ({ kind: 'local', endpoint: 'http://127.0.0.1:9001', modelId: 'model-a', ...o });
    const got = kd(m, keyDoor({ stored: STORED }, body({})));
    expect(got).toEqual(refusal('key-required'));
    expect(kd(m, keyDoor({ stored: { ...STORED, keySet: false } }, body({})))).toEqual(refusal('key-required'));
    expect(kd(m, keyDoor({ stored: STORED, addresses: ['127.0.0.1'] }, body({ key: KEY })))).toMatchObject({ ok: true, origin: 'http://127.0.0.1:9001', hostChanged: true, keyChanged: true });
    expect(kd(m, keyDoor({ stored: null }, body({})))).toEqual(refusal('key-unset'));
    // The same origin under another path is the same origin.
    expect(kd(m, keyDoor({ stored: STORED }, { kind: 'local', endpoint: 'http://127.0.0.1:9000/v2', modelId: 'model-a' }))).toMatchObject({ ok: true, key: null, hostChanged: false, keyChanged: false });
    // A different scheme or port is a different origin; row 6 comes after the endpoint rules.
    expect(kd(m, keyDoor({ stored: { ...STORED, origin: 'https://127.0.0.1:9000' } }, { kind: 'local', endpoint: 'http://127.0.0.1:9000', modelId: 'model-a' }))).toEqual(refusal('key-required'));
    expect(kd(m, keyDoor({ stored: STORED, addresses: ['10.0.0.5'] }, { kind: 'local', endpoint: 'http://10.0.0.5:9000', modelId: 'model-a' }))).toEqual(refusal('bad-endpoint'));
  } },
  { name: 'key door 7: no key and no key stored is key-unset', run: (m) => {
    const body = { kind: 'local', endpoint: 'http://127.0.0.1:9000', modelId: 'model-a' };
    expect(kd(m, keyDoor({ stored: null }, body))).toEqual(refusal('key-unset'));
    expect(kd(m, keyDoor({ stored: { ...STORED, keySet: false } }, body))).toEqual(refusal('key-unset'));
    expect(kd(m, keyDoor({ stored: STORED }, body)).ok).toBe(true);
  } },
  { name: 'key door 8: the apply answer: origin, whether the host changed, whether the key did', run: (m) => {
    expect(kd(m, keyDoor())).toEqual({ ok: true, kind: 'local', endpoint: 'http://127.0.0.1:9000/v1', origin: 'http://127.0.0.1:9000',
      modelId: 'model-a', key: KEY, hostChanged: true, keyChanged: true });
    const same = { kind: 'local', endpoint: 'http://127.0.0.1:9000/v1', modelId: 'model-a' };
    expect(kd(m, keyDoor({ stored: STORED }, same))).toEqual({ ok: true, kind: 'local', endpoint: 'http://127.0.0.1:9000/v1', origin: 'http://127.0.0.1:9000',
      modelId: 'model-a', key: null, hostChanged: false, keyChanged: false });
    // A key alone, on the same host.
    expect(kd(m, keyDoor({ stored: STORED }, { ...same, key: KEY }))).toMatchObject({ hostChanged: false, keyChanged: true, key: KEY });
    // A model change alone, and a kind change alone, are host changes.
    expect(kd(m, keyDoor({ stored: STORED }, { ...same, modelId: 'model-b' }))).toMatchObject({ hostChanged: true, keyChanged: false });
    expect(kd(m, keyDoor({ stored: { ...STORED, kind: 'hosted' } }, same))).toMatchObject({ hostChanged: true, keyChanged: false });
    // The key\'s text is never in a refusal, whichever row refuses.
    for (const got of [kd(m, keyDoor({ addresses: [] })), kd(m, keyDoor({ stored: { ...STORED, origin: 'http://127.0.0.1:1' } }, keyBody({ key: undefined })))]) {
      expect(got.ok).toBe(false);
      expect(JSON.stringify(got)).not.toContain(KEY);
    }
  } },
  { name: 'keyDoorHostname: the endpoint\'s hostname, brackets stripped, lower-cased; null when it does not parse', run: (m) => {
    const h = (endpoint: unknown): string | null => m.keyDoorHostname({ endpoint });
    expect(h('https://[::1]:9000/x')).toBe('::1');
    expect(h('http://[fd00::1]/')).toBe('fd00::1');
    expect(h('http://127.0.0.1:9000')).toBe('127.0.0.1');
    expect(h('https://Model-Host-A.example/v1')).toBe('model-host-a.example');
    expect(h('http://localhost')).toBe('localhost');
    expect(h('nope')).toBeNull();
    expect(h('file:///etc/passwd')).toBeNull();
    expect(h('')).toBeNull();
    expect(h(7)).toBeNull();
    expect(h(null)).toBeNull();
    expect(m.keyDoorHostname(null)).toBeNull();
    expect(m.keyDoorHostname('https://host.example')).toBeNull();
    expect(m.keyDoorHostname([])).toBeNull();
    expect(m.keyDoorHostname({})).toBeNull();
  } },
];

export const STEP_UP_CASES: DecisionLinesCase[] = [
  { name: 'decisionStepUp: arm and key-put always ask, key-delete never, off and ceiling ask exactly when the move widens', run: (m) => {
    const sides = [side('off'), side('shadow'), side('shadow', { ceiling: 700 }), side('armed', { line: [3, 0.9] }), side('armed', { line: [3, 0.9], held: true }), side('armed')];
    for (const gate of [true, false]) {
      for (const from of sides) for (const to of sides) {
        expect(m.decisionStepUp('arm', gate, from, to)).toBe(true);
        expect(m.decisionStepUp('key-put', gate, from, to)).toBe(true);
        expect(m.decisionStepUp('key-delete', gate, from, to)).toBe(false);
        const widens = m.decisionRowDirection(gate, from, to) === 'widens';
        expect(m.decisionStepUp('off', gate, from, to)).toBe(widens);
        expect(m.decisionStepUp('ceiling', gate, from, to)).toBe(widens);
      }
    }
    const armed = side('armed', { line: [3, 0.9] });
    expect(m.decisionStepUp('off', true, armed, side('off'))).toBe(true);
    expect(m.decisionStepUp('off', false, side('armed'), side('off'))).toBe(false);
    expect(m.decisionStepUp('off', true, side('shadow'), side('off'))).toBe(false);
    expect(m.decisionStepUp('ceiling', false, side('shadow'), side('shadow', { ceiling: 700 }))).toBe(true);
    expect(m.decisionStepUp('ceiling', false, side('shadow', { ceiling: 700 }), side('shadow'))).toBe(false);
  } },
];

// ── the holds the key door makes, and the operator's read (Task 7) ────────────────────────────────────────────────────

export const HOLD_CASES: DecisionLinesCase[] = [
  { name: 'heldOnHostChange: an armed row not held whose line is not under the new key is held; nothing else is', run: (m) => {
    for (const mode of ['off', 'shadow', 'armed'] as const) for (const held of [false, true]) for (const under of [false, true]) {
      const got = m.heldOnHostChange(side(mode, { held }), under);
      expect(got, `${mode} held=${held} under=${under}`).toBe(mode === 'armed' && !held && !under);
    }
  } },
  { name: 'heldOnKeyRemoval: an armed gate not held is held; an armed advice row, a held gate and a gate in shadow or off are not', run: (m) => {
    for (const gate of [true, false]) for (const mode of ['off', 'shadow', 'armed'] as const) for (const held of [false, true]) {
      expect(m.heldOnKeyRemoval(gate, side(mode, { held })), `gate=${gate} ${mode} held=${held}`).toBe(gate && mode === 'armed' && !held);
    }
  } },
];

const usage = (serve: number, maintain: number, reserved: number) => ({ measured: true as const, serve, maintain, reserved, ceiling: 600, fleetTotal: serve + maintain + reserved });
const stateOf = (mode: DecisionRowSide['mode'], o: { line?: [number, number]; held?: boolean; cause?: 'drift' | null } = {}) =>
  ({ ...side(mode, o), heldCause: o.cause ?? null });
const seen = (id: number, line = 0.9) => ({ id, line, labelled: 120, errors: 1, bound: 0.04, canaryAsked: 295, canaryExpected: 295, canaryCrossed: 3 });
const HOST_VIEW = { kind: 'local' as const, endpoint: 'http://127.0.0.1:9000/v1', origin: 'http://127.0.0.1:9000', modelId: 'model-a' };

export const VIEW_CASES: DecisionLinesCase[] = [
  { name: 'view: an armed gate is offered a newer current line, and not an older or an equal one', run: (m) => {
    const armed = stateOf('armed', { line: [5, 0.9] });
    const offered = (currentId: number | null) => m.decisionModelViewOf({
      rows: [{ row: 'scope.widens', state: armed, usage: usage(1, 2, 3), current: currentId === null ? null : seen(currentId, 0.95) }],
      fleetToday: 6, fleetCap: 9000, host: HOST_VIEW, key: { setAt: 7, masked: true },
    }).rows[0]!.offered;
    expect(offered(6)).toEqual({ id: 6, line: 0.95 });
    expect(offered(9)).toEqual({ id: 9, line: 0.95 });
    expect(offered(5)).toBeNull();
    expect(offered(4)).toBeNull();
    expect(offered(null)).toBeNull();
  } },
  { name: 'view: only an armed gate is offered a line (not a gate in shadow, off or with no armed line; never an advice row)', run: (m) => {
    const offered = (row: DecisionRowId, state: ReturnType<typeof stateOf>) => m.decisionModelViewOf({
      rows: [{ row, state, usage: usage(0, 0, 0), current: seen(9) }], fleetToday: 0, fleetCap: 1, host: HOST_VIEW, key: null,
    }).rows[0]!.offered;
    expect(offered('scope.widens', stateOf('armed', { line: [5, 0.9] }))).toEqual({ id: 9, line: 0.9 });
    expect(offered('scope.widens', stateOf('shadow'))).toBeNull();
    expect(offered('scope.widens', stateOf('off'))).toBeNull();
    expect(offered('scope.widens', stateOf('shadow', { line: [5, 0.9] }))).toBeNull();
    expect(offered('scope.widens', stateOf('off', { line: [5, 0.9] }))).toBeNull();
    expect(offered('scope.widens', stateOf('armed'))).toBeNull();
    // an advice row carries no armed line; one that somehow did is still never offered one
    expect(offered(ADVICE, stateOf('armed'))).toBeNull();
    expect(offered(ADVICE, stateOf('armed', { line: [5, 0.9] }))).toBeNull();
    expect(offered(ADVICE, stateOf('shadow'))).toBeNull();
  } },
  { name: 'view: today.total is serve plus maintenance plus reserved, the side and the hold are the row\'s, and the line carries the counts', run: (m) => {
    const view = m.decisionModelViewOf({
      rows: [{ row: 'scope.widens', state: stateOf('armed', { line: [5, 0.9], held: true, cause: 'drift' }), usage: usage(10, 20, 3), current: seen(5) },
        { row: ADVICE, state: stateOf('off'), usage: usage(0, 0, 0), current: null }],
      fleetToday: 33, fleetCap: 9000, host: HOST_VIEW, key: { setAt: 7, masked: false },
    });
    expect(view.rows.map((r) => r.id)).toEqual(['scope.widens', ADVICE]);
    expect(view.rows[0]).toEqual({
      id: 'scope.widens', side: { mode: 'armed', ceiling: 600, armedLine: { id: 5, line: 0.9 }, held: true }, heldWhy: 'drift',
      direction: 'gate', privateState: true, today: { serve: 10, maintenance: 20, reserved: 3, total: 33 },
      line: { id: 5, line: 0.9, admitted: true, labelled: 120, errors: 1, bound: 0.04, canaryAsked: 295, canaryExpected: 295, canaryCrossed: 3 },
      offered: null,
    });
    expect(view.rows[1]).toMatchObject({ direction: 'advice', privateState: false, heldWhy: null, line: null, offered: null, today: { total: 0 } });
    expect(view.fleetToday).toBe(33);
    expect(view.fleetCap).toBe(9000);
    expect(view.host).toEqual(HOST_VIEW);
    expect(view.key).toEqual({ setAt: 7, masked: false });
    expect(m.decisionModelViewOf({ rows: [], fleetToday: 0, fleetCap: 1, host: null, key: null })).toEqual({ rows: [], fleetToday: 0, fleetCap: 1, host: null, key: null });
  } },
];

// ── the lane's holds (Task 9) ────────────────────────────────────────────────────────────────────────────────────────

const LKEY = { hostKind: 'local' as const, origin: 'http://127.0.0.1:9000', modelId: 'model-a', revision: 'bfac70e8caabb092' };
/** `n` clear yes answers at `p`, the first `errors` of them labelled `no`. */
const yesAnswers = (n: number, errors: number, p = 0.95): LabelledAnswer[] =>
  Array.from({ length: n }, (_, i) => ({ p, verdict: 'yes' as const, label: i < errors ? 'no' as const : 'yes' as const }));

export const LANE_HOLD_CASES: DecisionLinesCase[] = [
  { name: 'armedAndFree: armed and not held, and nothing else', run: (m) => {
    for (const mode of ['off', 'shadow', 'armed'] as const) for (const held of [false, true]) {
      expect(m.armedAndFree(side(mode, { held })), `${mode} held=${held}`).toBe(mode === 'armed' && !held);
    }
  } },
  { name: 'lineUnderKey: a line is under a key only when the kind, origin, model and revision all agree; no line or no key is not under it', run: (m) => {
    expect(m.lineUnderKey(LKEY, { ...LKEY })).toBe(true);
    for (const [field, other] of [['hostKind', 'hosted'], ['origin', 'http://127.0.0.1:9001'], ['modelId', 'model-b'], ['revision', '0000000000000000']] as const) {
      expect(m.lineUnderKey(LKEY, { ...LKEY, [field]: other }), field).toBe(false);
    }
    expect(m.lineUnderKey(null, LKEY)).toBe(false);
    expect(m.lineUnderKey(LKEY, null)).toBe(false);
    expect(m.lineUnderKey(null, null)).toBe(false);
  } },
  { name: 'armedLineBoundFails: the bound at the armed line is over the target (59 clean answers pass a 5% target, 58 do not)', run: (m) => {
    const gate = DECISION_QUESTIONS['scope.widens'];
    const armed = side('armed', { line: [5, 0.9] });
    expect(m.armedLineBoundFails(gate, armed, yesAnswers(59, 0))).toBe(false);
    expect(m.armedLineBoundFails(gate, armed, yesAnswers(58, 0))).toBe(true);
    expect(m.armedLineBoundFails(gate, armed, yesAnswers(100, 0))).toBe(false);
    expect(m.armedLineBoundFails(gate, armed, yesAnswers(100, 10))).toBe(true);
    expect(m.armedLineBoundFails(gate, armed, [])).toBe(true);
    // a bound exactly at the target does not fail it (a synthetic target, since no catalogue row's lies on a bound)
    const exact = { ...gate, target: upperBound95(0, 59) as 0.05 };
    expect(m.armedLineBoundFails(exact, armed, yesAnswers(59, 0))).toBe(false);
    expect(m.armedLineBoundFails({ ...gate, target: (upperBound95(0, 59) - 1e-9) as 0.05 }, armed, yesAnswers(59, 0))).toBe(true);
  } },
  { name: 'armedLineBoundFails: only answers at or over the armed line count, at that line and no other', run: (m) => {
    const gate = DECISION_QUESTIONS['scope.widens'];
    // 100 clean answers at 0.95 and 50 wrong ones at 0.8: at line 0.9 only the clean ones count; at 0.7 the wrong ones do too.
    const mixed = [...yesAnswers(100, 0, 0.95), ...yesAnswers(50, 50, 0.8)];
    expect(m.armedLineBoundFails(gate, side('armed', { line: [5, 0.9] }), mixed)).toBe(false);
    expect(m.armedLineBoundFails(gate, side('armed', { line: [5, 0.7] }), mixed)).toBe(true);
    // a line above every answer counts none, and an empty count fails the bound
    expect(m.armedLineBoundFails(gate, side('armed', { line: [5, 0.99] }), mixed)).toBe(true);
  } },
  { name: 'armedLineBoundFails: never for advice, a held row, a row not armed or a gate with no armed line', run: (m) => {
    const gate = DECISION_QUESTIONS['scope.widens'];
    const bad = yesAnswers(100, 40);
    expect(m.armedLineBoundFails(gate, side('armed', { line: [5, 0.9] }), bad)).toBe(true);
    expect(m.armedLineBoundFails(DECISION_QUESTIONS[ADVICE], side('armed', { line: [5, 0.9] }), bad)).toBe(false);
    expect(m.armedLineBoundFails(gate, side('armed', { line: [5, 0.9], held: true }), bad)).toBe(false);
    expect(m.armedLineBoundFails(gate, side('shadow', { line: [5, 0.9] }), bad)).toBe(false);
    expect(m.armedLineBoundFails(gate, side('off', { line: [5, 0.9] }), bad)).toBe(false);
    expect(m.armedLineBoundFails(gate, side('armed'), bad)).toBe(false);
  } },
];

export const ALL_DECISION_LINES_CASES: DecisionLinesCase[] = [
  ...DIRECTION_CASES, ...LINE_CASES, ...CANARY_CASES, ...ARM_CASES, ...OFF_CASES, ...OFF_FALLBACK_CASES, ...CEILING_CASES,
  ...KEY_DOOR_CASES, ...STEP_UP_CASES, ...HOLD_CASES, ...VIEW_CASES, ...LANE_HOLD_CASES,
];
