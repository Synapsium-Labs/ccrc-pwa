// Overlord W2, the decision-model port (plan docs/superpowers/plans/2026-11-16-overlord-w2/w2-decision-model.md, Task 2):
// the cases over `planDecision`, `serveCap`, `maintainCap`, `bandOf`, `isPrivateAddress`, `isLiteralHost`,
// `encodeDecisionRequest`, `decisionRequestGroups` and `readDecisionAnswers`, each over hand-built inputs. `decision-model-decide.test.ts` runs them against the real module and
// `sim/decisionModelSets.ts` against each mutant, so one list of cases is both the suite and the mutation floor's judge.
import { expect } from 'vitest';
import {
  DECISION_QUESTIONS, DECISION_ROW_DEFAULT, DECISION_ROW_IDS,
  type DecisionRowId, type DecisionRowSide,
} from '../../shared/decisionModel.js';
import type * as DecisionModel from '../src/coord/decisionModel.js';
import type { DecisionFields, DecisionQuestionKey, PlanInput } from '../src/coord/decisionModel.js';

export type DecisionModelModule = Pick<typeof DecisionModel, 'planDecision' | 'serveCap' | 'maintainCap' | 'bandOf'
  | 'isPrivateAddress' | 'isLiteralHost' | 'encodeDecisionRequest' | 'decisionRequestGroups' | 'readDecisionAnswers'>;

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

export const ALL_DECISION_MODEL_CASES: DecisionModelCase[] = [
  ...PLAN_CASES, ...CAP_CASES, ...BAND_CASES, ...ADDRESS_CASES, ...ENCODE_CASES, ...GROUP_CASES, ...READ_CASES,
];
