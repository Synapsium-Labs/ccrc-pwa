// The response record's deciders' oracles and mutant sets (Overlord W1, the response record, Tasks 1, 5 and 8:
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md). The cases are written ONCE here:
// `responses-receipt.test.ts`, `responses-outcome.test.ts` and `responses-for.test.ts` run them against the real module,
// and `mutation-floors.test.ts` against each textual mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const MODULE = path.join(ROOT, 'server/src/responses.ts');

export type ResponsesModule = typeof import('../../src/responses.js');
type Facts = Parameters<ResponsesModule['receiptVerdict']>[1];
type Receipt = Parameters<ResponsesModule['receiptVerdict']>[0];
type RowKind = 'push' | 'waiting' | 'digest' | 'reply';
type RowState = 'pending' | 'delivered' | 'sealed';

// Literal on purpose, never read back from shared/responses.ts: a value change is a behaviour change.
const MAX = 8;
const HASH = 'a'.repeat(64);
const OTHER = 'b'.repeat(64);

const worker = (receipt: 'shown' | 'opened', endpointHash = HASH): Receipt =>
  ({ ref: { kind: 'push', pushId: '0'.repeat(32) }, receipt, from: { source: 'worker', version: 1, endpointHash } });
const consoleR = (receipt: 'shown' | 'opened'): Receipt =>
  ({ ref: { kind: 'item', id: 7 }, receipt, from: { source: 'console' } });
const rowOf = (kind: RowKind, state: RowState, accepted: boolean): NonNullable<Facts['row']> =>
  ({ kind, state, acceptedSubs: accepted ? [OTHER, HASH] : [OTHER] });

/** The oracle: the plan's seven rules, first match, as a list of [when, answer]. Written here, not derived from the
 *  module. */
type Case = { readonly r: Receipt; readonly f: Facts };
const isWorker = (c: Case): boolean => c.r.from.source === 'worker';
const RULES: readonly [(c: Case) => boolean, string][] = [
  [(c) => c.f.row === null, 'no-row'],
  [(c) => c.f.row!.state === 'sealed', 'sealed'],
  [(c) => (isWorker(c) && c.f.row!.kind !== 'push') || (!isWorker(c) && c.f.row!.kind === 'push'), 'wrong-source'],
  [(c) => !isWorker(c) && c.r.receipt === 'shown', 'wrong-source'],
  [(c) => isWorker(c) && c.f.row!.state === 'delivered' && !c.f.row!.acceptedSubs.includes(HASH), 'not-accepted'],
  [(c) => isWorker(c) && c.f.workerReceipts >= MAX, 'full'],
  [() => true, 'keep'],
];
const expected = (c: Case): string => RULES.find(([when]) => when(c))![1];
const word = (v: ReturnType<ResponsesModule['receiptVerdict']>): string => (v.keep ? 'keep' : v.why);

function* everyCase(): Generator<Case> {
  const rows: (Facts['row'])[] = [null];
  for (const kind of ['push', 'waiting', 'digest', 'reply'] as const) for (const state of ['pending', 'delivered', 'sealed'] as const)
    for (const accepted of [false, true]) rows.push(rowOf(kind, state, accepted));
  for (const row of rows) for (const source of ['worker', 'console'] as const) for (const kind of ['shown', 'opened'] as const)
    for (const workerReceipts of [0, MAX - 1, MAX, MAX + 1]) yield { r: source === 'worker' ? worker(kind) : consoleR(kind), f: { row, workerReceipts } };
}

export function receiptVerdictCases(m: ResponsesModule): Record<string, SuiteCase> {
  const v = (r: Receipt, row: Facts['row'], workerReceipts = 0): string => word(m.receiptVerdict(r, { row, workerReceipts }));
  return {
    'total: every combination of row, source, receipt and count answers its rule': () => {
      let n = 0;
      for (const c of everyCase()) { n++; expect(word(m.receiptVerdict(c.r, c.f)), JSON.stringify(c)).toBe(expected(c)); }
      expect(n).toBe(25 * 2 * 2 * 4);
    },
    'a worker receipt for a delivered push whose subscription was accepted is kept': () => {
      expect(m.receiptVerdict(worker('shown'), { row: rowOf('push', 'delivered', true), workerReceipts: 0 })).toEqual({ keep: true });
    },
    'a console opened for a waiting row or a digest line is kept': () => {
      expect(v(consoleR('opened'), rowOf('waiting', 'pending', false))).toBe('keep');
      expect(v(consoleR('opened'), rowOf('digest', 'delivered', false))).toBe('keep');
    },
    'no row is no-row, even past the bound': () => { expect(v(worker('shown'), null, MAX + 1)).toBe('no-row'); },
    'a sealed row is sealed, before the source and the count': () => {
      expect(v(consoleR('shown'), rowOf('push', 'sealed', false), MAX)).toBe('sealed');
    },
    'a worker receipt for a row that is not a push, and a console receipt for a push, are wrong-source': () => {
      expect(v(worker('opened'), rowOf('waiting', 'pending', true))).toBe('wrong-source');
      expect(v(consoleR('opened'), rowOf('push', 'pending', true))).toBe('wrong-source');
    },
    'a console shown is wrong-source even for a waiting row': () => {
      expect(v(consoleR('shown'), rowOf('waiting', 'pending', false))).toBe('wrong-source');
    },
    "a pending push's receipt is kept whatever its subscription (question 7)": () => {
      expect(v(worker('shown', 'c'.repeat(64)), rowOf('push', 'pending', false))).toBe('keep');
    },
    'a delivered push refuses a subscription outside the accepted set, before the bound': () => {
      expect(v(worker('shown', 'c'.repeat(64)), rowOf('push', 'delivered', true), MAX)).toBe('not-accepted');
    },
    'the bound: seven kept, eight and nine refused full (question 19)': () => {
      const row = rowOf('push', 'delivered', true);
      expect(v(worker('opened'), row, MAX - 1)).toBe('keep');
      expect(v(worker('opened'), row, MAX)).toBe('full');
      expect(v(worker('opened'), row, MAX + 1)).toBe('full');
    },
  };
}

// ── THE SEAL (Task 5): responseOutcome, responseWindowEnd, responseSealDue ────────────────────────────────────────────────

type SealFactsT = Parameters<ResponsesModule['responseOutcome']>[0];
type SealRowT = SealFactsT['row'];
type OwnerT = SealFactsT['owner'];
type ReceiptT = SealFactsT['receipts'][number];
type StampT = SealFactsT['stampNow'];

const H = 3_600_000;
const D = 86_400_000;
const T0 = 1_000_000_000;
const DELIVERED = T0 + 1_000;
const A = 'a'.repeat(64);
const B = 'b'.repeat(64);
const C = 'c'.repeat(64);

/** The row variants the oracle walks: what the row is and what it carries. */
type RowV = 'push-bare' | 'push-actions' | 'push-item' | 'push-ask' | 'waiting-item' | 'waiting-ask' | 'digest';
/** The owner variants, each a family's (none, item, ask, digest) or `gone`. */
type OwnerV = 'none' | 'item-none' | 'item-op-in' | 'item-op-after' | 'item-coord-in' | 'item-op-before' | 'item-raise-only'
  | 'ask-held' | 'ask-op-in' | 'ask-session-in' | 'ask-stale' | 'ask-unknown'
  | 'digest-clean' | 'digest-corrected' | 'digest-overturned-in' | 'digest-overturned-before' | 'gone';
type ReceiptsV = 'none' | 'shownA' | 'shownAB' | 'shownAB-openA' | 'shownAB-openA-after' | 'shownAB-openC' | 'console-open' | 'console-open-after';
type StampV = 'equal' | 'restore-unmeasured' | 'restore-differs' | 'boot-row-unmeasured' | 'boot-now-unmeasured';
interface Scenario {
  readonly row: RowV; readonly state: 'pending' | 'delivered'; readonly accepted: 'AB' | 'none';
  readonly owner: OwnerV; readonly receipts: ReceiptsV; readonly replaced: boolean; readonly stamp: StampV; readonly boots: 0 | 1;
}

const isPushV = (r: RowV): boolean => r.startsWith('push');
const familyOf = (r: RowV): 'none' | 'item' | 'ask' | 'digest' =>
  r === 'push-bare' || r === 'push-actions' ? 'none' : r.endsWith('item') ? 'item' : r.endsWith('ask') ? 'ask' : 'digest';
const ownersFor = (r: RowV): OwnerV[] => {
  const fam = familyOf(r);
  const all: OwnerV[] = ['none', 'item-none', 'item-op-in', 'item-op-after', 'item-coord-in', 'item-op-before', 'item-raise-only',
    'ask-held', 'ask-op-in', 'ask-session-in', 'ask-stale', 'ask-unknown',
    'digest-clean', 'digest-corrected', 'digest-overturned-in', 'digest-overturned-before'];
  return [...all.filter((o) => (fam === 'none' ? o === 'none' : o.startsWith(`${fam}-`))), ...(fam === 'none' ? [] : ['gone' as const])];
};
const startOf = (s: Scenario): number => (isPushV(s.row) && s.state === 'delivered' ? DELIVERED : T0);
const endOf = (s: Scenario): number => {
  if (isPushV(s.row)) return s.state === 'pending' ? T0 + 24 * H : DELIVERED + 24 * H;
  return s.row === 'digest' ? T0 + D : T0 + 7 * D;
};

function rowOfScenario(s: Scenario): SealRowT {
  const push = isPushV(s.row);
  const delivered = s.state === 'delivered';
  const stampRow = { boot: s.stamp === 'boot-row-unmeasured' ? { kind: 'unmeasured' as const } : { kind: 'measured' as const, epoch: 1 },
    restore: s.stamp === 'restore-unmeasured' ? { kind: 'unmeasured' as const } : { kind: 'measured' as const, n: 4 } };
  return {
    id: 9, kind: push ? 'push' : s.row === 'digest' ? 'digest' : 'waiting', label: 'coord', state: push ? s.state : 'delivered',
    carries: s.row === 'push-item' ? { kind: 'item', id: 3 } : s.row === 'push-ask' ? { kind: 'ask', id: 3 } : null,
    hasActions: s.row === 'push-actions' || s.row === 'push-ask',
    acceptedSubs: push && delivered && s.accepted === 'AB' ? [A, B] : [],
    ...stampRow, insertedAt: T0, deliveredAt: push ? (delivered ? DELIVERED : null) : T0,
    windowCapAt: push ? (delivered ? DELIVERED + 24 * H : null) : endOf(s),
  };
}
function ownerOfScenario(s: Scenario): OwnerT {
  const inside = startOf(s) + 5_000, after = endOf(s) + 5_000, before = T0 - 5_000;
  const item = (acts: { act: 'tick' | 'withdraw' | 'raise' | 'block'; actor: 'operator' | 'coordinator'; at: number }[]): OwnerT => ({ kind: 'item', acts });
  const ask = (state: 'held' | 'answered' | 'stale' | 'unknown', answeredBy: string | null, answeredAt: number | null): OwnerT =>
    ({ kind: 'ask', state, answeredBy, answeredAt, endedAt: answeredAt });
  switch (s.owner) {
    case 'none': return { kind: 'none' };
    case 'gone': return { kind: 'gone' };
    case 'item-none': return item([{ act: 'raise', actor: 'coordinator', at: before }]);
    case 'item-op-in': return item([{ act: 'raise', actor: 'coordinator', at: before }, { act: 'tick', actor: 'operator', at: inside }]);
    case 'item-op-after': return item([{ act: 'tick', actor: 'operator', at: after }]);
    case 'item-coord-in': return item([{ act: 'withdraw', actor: 'coordinator', at: inside }]);
    case 'item-op-before': return item([{ act: 'tick', actor: 'operator', at: before }]);
    case 'item-raise-only': return item([{ act: 'raise', actor: 'coordinator', at: inside }, { act: 'block', actor: 'coordinator', at: inside }]);
    case 'ask-held': return ask('held', null, null);
    case 'ask-op-in': return ask('answered', 'operator', inside);
    case 'ask-session-in': return ask('answered', 'lane-a-project-a', inside);
    case 'ask-stale': return ask('stale', null, null);
    case 'ask-unknown': return ask('unknown', null, null);
    case 'digest-clean': return { kind: 'digest', corrected: false, overturnedAt: null };
    case 'digest-corrected': return { kind: 'digest', corrected: true, overturnedAt: null };
    case 'digest-overturned-in': return { kind: 'digest', corrected: false, overturnedAt: inside };
    case 'digest-overturned-before': return { kind: 'digest', corrected: false, overturnedAt: before };
    default: { const never: never = s.owner; throw new Error(String(never)); }
  }
}
function receiptsOfScenario(s: Scenario): ReceiptT[] {
  const inside = startOf(s) + 9_000, after = endOf(s) + 9_000;
  const w = (receipt: 'shown' | 'opened', endpointHash: string, at = inside): ReceiptT => ({ receipt, source: 'worker', endpointHash, at });
  const c = (at: number): ReceiptT => ({ receipt: 'opened', source: 'console', endpointHash: '', at });
  switch (s.receipts) {
    case 'none': return [];
    case 'shownA': return [w('shown', A)];
    case 'shownAB': return [w('shown', A), w('shown', B)];
    case 'shownAB-openA': return [w('shown', A), w('shown', B), w('opened', A)];
    case 'shownAB-openA-after': return [w('shown', A), w('shown', B), w('opened', A, after)];
    case 'shownAB-openC': return [w('shown', A), w('shown', B), w('opened', C)];
    case 'console-open': return [c(inside)];
    case 'console-open-after': return [c(after)];
    default: { const never: never = s.receipts; throw new Error(String(never)); }
  }
}
function factsOfScenario(s: Scenario): SealFactsT {
  const stampNow: StampT = {
    boot: s.stamp === 'boot-now-unmeasured' ? { kind: 'unmeasured' } : { kind: 'measured', epoch: 1 },
    restore: s.stamp === 'restore-unmeasured' ? { kind: 'unmeasured' } : { kind: 'measured', n: s.stamp === 'restore-differs' ? 5 : 4 },
  };
  return { row: rowOfScenario(s), owner: ownerOfScenario(s), receipts: receiptsOfScenario(s), replacedOn: s.replaced ? [B] : [],
    bootsInWindow: s.boots, stampNow };
}

/** The oracle: Table 4.3b's seven rules, first match, written over the scenario's words, never over the facts the module
 *  reads. Each entry answers `outcome` or `outcome/why`. */
function expectedOutcome(s: Scenario): string {
  const push = isPushV(s.row);
  const counted = push
    ? (s.state === 'delivered' && s.accepted === 'AB' && s.receipts === 'shownAB-openA')
    : s.receipts === 'console-open';
  const allShown = s.receipts === 'shownAB' || s.receipts === 'shownAB-openA' || s.receipts === 'shownAB-openA-after' || s.receipts === 'shownAB-openC';
  const stampsHold = s.stamp === 'equal' && s.boots === 0;
  const RULES: readonly [() => boolean, string][] = [
    [() => ['item-op-in', 'ask-op-in', 'digest-corrected', 'digest-overturned-in'].includes(s.owner), 'acted'],
    [() => ['item-coord-in', 'item-op-before', 'ask-session-in'].includes(s.owner), 'settled-elsewhere'],
    [() => s.owner === 'gone', 'unmeasured/reader'],
    [() => s.row === 'push-bare', 'not-actionable'],
    [() => push && s.state === 'pending', 'unmeasured/no-verdict'],
    [() => s.owner === 'ask-stale' || s.owner === 'ask-unknown', 'unmeasured/ask-ended'],
    [() => push && !counted && (!(s.accepted === 'AB' ? allShown : true) || (s.replaced && s.accepted === 'AB') || !stampsHold), 'unmeasured/receipts'],
    [() => counted, 'opened'],
    [() => push && s.accepted === 'AB', 'not-opened'],
    [() => true, 'unmeasured/receipts'],
  ];
  return RULES.find(([when]) => when())![1];
}
const outcomeWord = (o: { outcome: string; why: string | null }): string => (o.why === null ? o.outcome : `${o.outcome}/${o.why}`);

function* everyScenario(): Generator<Scenario> {
  const rows: RowV[] = ['push-bare', 'push-actions', 'push-item', 'push-ask', 'waiting-item', 'waiting-ask', 'digest'];
  for (const row of rows) for (const state of isPushV(row) ? (['pending', 'delivered'] as const) : (['delivered'] as const))
    for (const accepted of isPushV(row) && state === 'delivered' ? (['AB', 'none'] as const) : (['none'] as const))
      for (const owner of ownersFor(row))
        for (const receipts of ['none', 'shownA', 'shownAB', 'shownAB-openA', 'shownAB-openA-after', 'shownAB-openC', 'console-open', 'console-open-after'] as const)
          for (const replaced of [false, true]) for (const stamp of ['equal', 'restore-unmeasured', 'restore-differs', 'boot-row-unmeasured', 'boot-now-unmeasured'] as const)
            for (const boots of [0, 1] as const) yield { row, state, accepted, owner, receipts, replaced, stamp, boots };
}
const OP_IN: Record<'none' | 'item' | 'ask' | 'digest', OwnerV | null> = { none: null, item: 'item-op-in', ask: 'ask-op-in', digest: 'digest-corrected' };

export function responseOutcomeCases(m: ResponsesModule): Record<string, SuiteCase> {
  const out = (s: Scenario): ReturnType<ResponsesModule['responseOutcome']> => m.responseOutcome(factsOfScenario(s), endOf(s));
  const base: Scenario = { row: 'push-item', state: 'delivered', accepted: 'AB', owner: 'item-none', receipts: 'shownAB', replaced: false, stamp: 'equal', boots: 0 };
  return {
    'total: every scenario answers its first-match rule (Table 4.3b)': () => {
      let n = 0;
      for (const s of everyScenario()) { n += 1; expect(outcomeWord(out(s)), JSON.stringify(s)).toBe(expectedOutcome(s)); }
      expect(n).toBeGreaterThan(10_000);
    },
    'a push shown on every accepted subscription, never opened, with stamps equal and no boot, is not-opened': () => {
      expect(out(base)).toEqual({ seal: true, outcome: 'not-opened', how: null, why: null, actedAt: null, shownAt: DELIVERED + 9_000, openedAt: null });
    },
    'the roll-back-and-forward case: v2 inserts, v1 boots, v2 boots, a shown and no opened is unmeasured, receipts': () => {
      const f = factsOfScenario(base);
      const rolled = { ...f, bootsInWindow: 2, stampNow: { boot: { kind: 'measured' as const, epoch: 3 }, restore: f.stampNow.restore } };
      expect(outcomeWord(m.responseOutcome(rolled, endOf(base)))).toBe('unmeasured/receipts');
    },
    'an operator tick inside the window is acted, how tick, at its time, with the receipts it holds': () => {
      expect(out({ ...base, owner: 'item-op-in', receipts: 'shownAB-openA' })).toEqual({
        seal: true, outcome: 'acted', how: 'tick', why: null, actedAt: DELIVERED + 5_000, shownAt: DELIVERED + 9_000, openedAt: DELIVERED + 9_000 });
    },
    'an ask answered by the operator is acted, how answer; a digest correction is acted, how correct, with no time': () => {
      expect(out({ ...base, row: 'waiting-ask', accepted: 'none', owner: 'ask-op-in' })).toMatchObject({ outcome: 'acted', how: 'answer', actedAt: T0 + 5_000 });
      expect(out({ ...base, row: 'digest', accepted: 'none', owner: 'digest-corrected' })).toMatchObject({ outcome: 'acted', how: 'correct', actedAt: null });
      expect(out({ ...base, row: 'digest', accepted: 'none', owner: 'digest-overturned-in' })).toMatchObject({ outcome: 'acted', how: 'correct', actedAt: T0 + 5_000 });
    },
    'each of the operator item acts is its own how, and the earliest one wins': () => {
      const f = factsOfScenario({ ...base, row: 'waiting-item', accepted: 'none' });
      for (const act of ['tick', 'dismiss', 'act', 'decline'] as const) {
        const owner: OwnerT = { kind: 'item', acts: [{ act: 'tick', actor: 'operator', at: T0 + 9 }, { act, actor: 'operator', at: T0 + 2 }] };
        expect(m.responseOutcome({ ...f, owner }, T0 + 7 * D)).toMatchObject({ outcome: 'acted', how: act, actedAt: T0 + 2 });
      }
      const ccrc: OwnerT = { kind: 'item', acts: [{ act: 'settle', actor: 'ccrc', at: T0 + 2 }] };
      expect(m.responseOutcome({ ...f, owner: ccrc }, T0 + 7 * D).outcome).toBe('settled-elsewhere');
      const returned: OwnerT = { kind: 'item', acts: [{ act: 'return', actor: 'coordinator', at: T0 + 2 }] };
      expect(outcomeWord(m.responseOutcome({ ...f, owner: returned }, T0 + 7 * D))).toBe('unmeasured/receipts');
    },
    'a console opened inside the window opens a Waiting on you row; its shownAt stays null': () => {
      expect(out({ ...base, row: 'waiting-item', accepted: 'none', receipts: 'console-open' }))
        .toEqual({ seal: true, outcome: 'opened', how: null, why: null, actedAt: null, shownAt: null, openedAt: T0 + 9_000 });
    },
    'a receipt outside the accepted set or after the window is not counted': () => {
      expect(out({ ...base, receipts: 'shownAB-openC' }).openedAt).toBeNull();
      expect(out({ ...base, receipts: 'shownAB-openA-after' }).openedAt).toBeNull();
    },
    'an act is the operator\'s only by its actor: a tick recorded by a coordinator settles the row elsewhere': () => {
      const f = factsOfScenario({ ...base, row: 'waiting-item', accepted: 'none' });
      const owner: OwnerT = { kind: 'item', acts: [{ act: 'tick', actor: 'coordinator', at: T0 + 2 }] };
      expect(m.responseOutcome({ ...f, owner }, T0 + 7 * D).outcome).toBe('settled-elsewhere');
    },
    'an ask a session answered after the window is not settled elsewhere': () => {
      const f = factsOfScenario({ ...base, row: 'waiting-ask', accepted: 'none' });
      const owner: OwnerT = { kind: 'ask', state: 'answered', answeredBy: 'lane-a-project-a', answeredAt: T0 + 8 * D, endedAt: T0 + 8 * D };
      expect(outcomeWord(m.responseOutcome({ ...f, owner }, T0 + 7 * D))).toBe('unmeasured/receipts');
    },
    "a push's window starts at its delivery: an operator tick between its insert and its delivery settled it elsewhere": () => {
      const f = factsOfScenario(base);
      const owner: OwnerT = { kind: 'item', acts: [{ act: 'tick', actor: 'operator', at: T0 + 500 }] };
      expect(m.responseOutcome({ ...f, owner }, endOf(base)).outcome).toBe('settled-elsewhere');
    },
    'a later push under the same tag on a subscription outside the set changes nothing': () => {
      const f = { ...factsOfScenario(base), replacedOn: [C] };
      expect(m.responseOutcome(f, endOf(base)).outcome).toBe('not-opened');
    },
    'monotone: adding an operator act inside the window always makes the row acted': () => {
      for (const s of everyScenario()) {
        const op = OP_IN[familyOf(s.row)];
        if (op === null || s.owner === 'gone') continue;
        expect(out({ ...s, owner: op }).outcome, JSON.stringify(s)).toBe('acted');
      }
    },
    'monotone: adding a counted opened never moves a row to not-opened': () => {
      for (const s of everyScenario()) {
        const opened = isPushV(s.row) ? 'shownAB-openA' : 'console-open';
        if (out(s).outcome === 'opened') expect(out({ ...s, receipts: opened }).outcome, JSON.stringify(s)).toBe('opened');
        expect(out({ ...s, receipts: opened }).outcome, JSON.stringify(s)).not.toBe('not-opened');
      }
    },
    'monotone: an unmeasured stamp, a boot inside the window or a replacement never yields not-opened': () => {
      for (const s of everyScenario()) {
        for (const worse of [{ stamp: 'restore-unmeasured' as const }, { stamp: 'restore-differs' as const }, { stamp: 'boot-row-unmeasured' as const },
          { stamp: 'boot-now-unmeasured' as const }, { boots: 1 as const }, { replaced: true }]) {
          expect(out({ ...s, ...worse }).outcome, JSON.stringify({ ...s, ...worse })).not.toBe('not-opened');
        }
      }
    },
  };
}

export function responseWindowEndCases(m: ResponsesModule): Record<string, SuiteCase> {
  const s: Scenario = { row: 'push-item', state: 'delivered', accepted: 'AB', owner: 'item-none', receipts: 'none', replaced: false, stamp: 'equal', boots: 0 };
  const row = (v: Partial<Scenario>): SealRowT => rowOfScenario({ ...s, ...v });
  const item = (...acts: [string, string, number][]): OwnerT =>
    ({ kind: 'item', acts: acts.map(([act, actor, at]) => ({ act: act as 'tick', actor: actor as 'operator', at })) });
  return {
    'a pending push ends 24 hours after its insert, whatever its owner': () => {
      expect(m.responseWindowEnd(row({ state: 'pending' }), item(['tick', 'operator', T0 + 5]))).toBe(T0 + 24 * H);
    },
    'a delivered push ends at its cap, or earlier when its carried row settles inside it': () => {
      expect(m.responseWindowEnd(row({}), { kind: 'none' })).toBe(DELIVERED + 24 * H);
      expect(m.responseWindowEnd(row({}), item(['tick', 'operator', DELIVERED + H]))).toBe(DELIVERED + H);
      expect(m.responseWindowEnd(row({}), item(['withdraw', 'coordinator', DELIVERED + 2 * H], ['tick', 'operator', DELIVERED + 3 * H]))).toBe(DELIVERED + 2 * H);
      expect(m.responseWindowEnd(row({}), item(['tick', 'operator', DELIVERED + 30 * H]))).toBe(DELIVERED + 24 * H);
    },
    'a move before the window, a return, a raise or a blocking change never ends it': () => {
      expect(m.responseWindowEnd(row({}), item(['tick', 'operator', DELIVERED - 1]))).toBe(DELIVERED + 24 * H);
      expect(m.responseWindowEnd(row({}), item(['return', 'coordinator', DELIVERED + H], ['raise', 'coordinator', DELIVERED + H],
        ['block', 'coordinator', DELIVERED + H], ['unblock', 'coordinator', DELIVERED + H]))).toBe(DELIVERED + 24 * H);
    },
    'every settling move ends a Waiting on you row': () => {
      for (const act of ['tick', 'confirm', 'withdraw', 'dismiss', 'act', 'decline', 'settle']) {
        expect(m.responseWindowEnd(row({ row: 'waiting-item' }), item([act, 'ccrc', T0 + H])), act).toBe(T0 + H);
      }
    },
    'an ask ends when it is answered, by anyone, and otherwise at its cap': () => {
      const ask = (state: 'answered' | 'held' | 'stale', answeredAt: number | null): OwnerT =>
        ({ kind: 'ask', state, answeredBy: 'lane-a-project-a', answeredAt, endedAt: answeredAt });
      expect(m.responseWindowEnd(row({ row: 'waiting-ask' }), ask('answered', T0 + H))).toBe(T0 + H);
      expect(m.responseWindowEnd(row({ row: 'waiting-ask' }), ask('held', null))).toBe(T0 + 7 * D);
      expect(m.responseWindowEnd(row({ row: 'waiting-ask' }), ask('stale', null))).toBe(T0 + 7 * D);
      expect(m.responseWindowEnd(row({ row: 'waiting-ask' }), ask('answered', T0 - 1))).toBe(T0 + 7 * D);
    },
    'a digest line ends at the next digest, even once corrected; a gone owner at the cap': () => {
      expect(m.responseWindowEnd(row({ row: 'digest' }), { kind: 'digest', corrected: true, overturnedAt: T0 + 1 })).toBe(T0 + D);
      expect(m.responseWindowEnd(row({ row: 'waiting-item' }), { kind: 'gone' })).toBe(T0 + 7 * D);
    },
    'a delivered row with no cap is open with no end known': () => {
      expect(m.responseWindowEnd({ ...row({ row: 'waiting-item' }), windowCapAt: null }, { kind: 'gone' })).toBeNull();
      expect(m.responseWindowEnd({ ...row({}), windowCapAt: null }, { kind: 'none' })).toBeNull();
    },
  };
}

export function responseSealDueCases(m: ResponsesModule): Record<string, SuiteCase> {
  const s: Scenario = { row: 'waiting-item', state: 'delivered', accepted: 'none', owner: 'item-none', receipts: 'console-open', replaced: false, stamp: 'equal', boots: 0 };
  const facts = factsOfScenario(s);
  const row = facts.row;
  const CAP = T0 + 7 * D;
  return {
    'an open window seals nothing; its end seals the outcome': () => {
      expect(m.responseSealDue(row, { ok: true, facts }, CAP - 1)).toEqual({ seal: false });
      expect(m.responseSealDue(row, { ok: true, facts }, CAP)).toMatchObject({ seal: true, outcome: 'opened' });
      expect(m.responseSealDue(row, { ok: true, facts }, CAP + 5 * D)).toMatchObject({ seal: true, outcome: 'opened' });
    },
    'a settled owner seals before the cap': () => {
      const owner: OwnerT = { kind: 'item', acts: [{ act: 'tick', actor: 'operator', at: T0 + H }] };
      expect(m.responseSealDue(row, { ok: true, facts: { ...facts, owner } }, T0 + H)).toMatchObject({ seal: true, outcome: 'acted', how: 'tick' });
      expect(m.responseSealDue(row, { ok: true, facts: { ...facts, owner } }, T0 + H - 1)).toEqual({ seal: false });
    },
    'a sealed row is never sealed again, whatever the read': () => {
      const sealed = { ...row, state: 'sealed' as const };
      expect(m.responseSealDue(sealed, { ok: true, facts: { ...facts, row: sealed } }, CAP + 9 * D)).toEqual({ seal: false });
      expect(m.responseSealDue(sealed, { ok: false }, CAP + 9 * D)).toEqual({ seal: false });
    },
    'a failed read defers the seal a day past the cap, then seals unmeasured, reader, with no act': () => {
      expect(m.responseSealDue(row, { ok: false }, CAP)).toEqual({ seal: false });
      expect(m.responseSealDue(row, { ok: false }, CAP + D - 1)).toEqual({ seal: false });
      expect(m.responseSealDue(row, { ok: false }, CAP + D)).toEqual({ seal: true, outcome: 'unmeasured', how: null, why: 'reader', actedAt: null, shownAt: null, openedAt: null });
    },
    "a pending push's failed read defers from 24 hours after its insert": () => {
      const pending = rowOfScenario({ ...s, row: 'push-item', state: 'pending' });
      expect(m.responseSealDue(pending, { ok: false }, T0 + 24 * H + D - 1)).toEqual({ seal: false });
      expect(m.responseSealDue(pending, { ok: false }, T0 + 24 * H + D)).toMatchObject({ seal: true, why: 'reader' });
      expect(m.responseSealDue(pending, { ok: true, facts: { ...facts, row: pending, owner: { kind: 'item', acts: [] } } }, T0 + 24 * H))
        .toMatchObject({ seal: true, outcome: 'unmeasured', why: 'no-verdict' });
    },
    'a row with no cap and no read seals nothing, ever': () => {
      const open = { ...row, windowCapAt: null };
      expect(m.responseSealDue(open, { ok: false }, CAP + 99 * D)).toEqual({ seal: false });
      expect(m.responseSealDue(open, { ok: true, facts: { ...facts, row: open } }, CAP + 99 * D)).toEqual({ seal: false });
    },
  };
}

// ── THE FIGURES (Task 5): responsesFor ───────────────────────────────────────────────────────────────────────────────

type ViewT = Parameters<ResponsesModule['responsesFor']>[0][number];
const NOW = T0 + 60 * D;
const view = (v: Partial<ViewT>): ViewT => ({ kind: 'push', label: 'coord', delivery: 'at-once', outcome: null, why: null,
  admittedAt: NOW - D, deliveredAt: NOW - D, openedAt: null, actedAt: null, handledAt: null, ...v });

export function responsesForCases(m: ResponsesModule): Record<string, SuiteCase> {
  const scope = { by: 'label' as const, kind: 'push' as const, label: 'coord' };
  const f = (rows: ViewT[], since = 0): ReturnType<ResponsesModule['responsesFor']> => m.responsesFor(rows, scope, since, NOW);
  return {
    'the denominator counts acted, opened, not-opened and unmeasured receipts, and leaves the rest out': () => {
      const rows = [view({ outcome: 'acted', actedAt: NOW - D + 10 }), view({ outcome: 'opened' }), view({ outcome: 'not-opened' }),
        view({ outcome: 'unmeasured', why: 'receipts' }), view({ outcome: 'unmeasured', why: 'reader' }), view({ outcome: 'unmeasured', why: 'ask-ended' }),
        view({ outcome: 'unmeasured', why: 'no-verdict' }), view({ outcome: 'settled-elsewhere' }), view({ outcome: 'not-actionable' })];
      expect(f(rows)).toMatchObject({ measured: 4, acted: 1, opened: 1, notOpened: 1, unmeasured: 4, elsewhere: 0, actedAfterOpen: 0 });
    },
    'the correction is read first: a handled row is acted, elsewhere and measured, whatever its seal said': () => {
      for (const outcome of ['settled-elsewhere', 'not-actionable', 'not-opened', 'opened', null] as const) {
        const r = f([view({ outcome, why: null, handledAt: NOW - 5 })]);
        expect(r, String(outcome)).toMatchObject({ measured: 1, acted: 1, elsewhere: 1, opened: 0, notOpened: 0, unmeasured: 0 });
      }
      expect(f([view({ outcome: 'unmeasured', why: 'reader', handledAt: NOW - 5 })])).toMatchObject({ measured: 1, acted: 1, elsewhere: 1, unmeasured: 0 });
    },
    'an unsealed row that is not handled counts nowhere': () => {
      expect(f([view({})])).toMatchObject({ measured: 0, acted: 0, unmeasured: 0, medianActMs: null });
    },
    'acted after an open counts the acted rows with an open': () => {
      expect(f([view({ outcome: 'acted', openedAt: NOW - D + 1 }), view({ outcome: 'acted' })])).toMatchObject({ acted: 2, actedAfterOpen: 1 });
    },
    'the median act time, odd and even, over rows with both times': () => {
      const acted = (ms: number): ViewT => view({ outcome: 'acted', deliveredAt: NOW - D, actedAt: NOW - D + ms });
      expect(f([acted(10), acted(30), acted(20)]).medianActMs).toBe(20);
      expect(f([acted(10), acted(40), acted(20), acted(30)]).medianActMs).toBe(25);
      expect(f([view({ outcome: 'acted', actedAt: null })]).medianActMs).toBeNull();
    },
    'only rows admitted inside [max(since, now - 28 days), now], of the scope, count': () => {
      const r = (admittedAt: number | null, more: Partial<ViewT> = {}): ViewT => view({ outcome: 'opened', admittedAt, ...more });
      const rows = [r(NOW - 28 * D), r(NOW - 28 * D - 1), r(NOW), r(NOW + 1), r(null), r(NOW - D, { label: 'disk' }), r(NOW - D, { kind: 'waiting' })];
      expect(f(rows).opened).toBe(2);
      expect(f(rows, NOW - 10).opened).toBe(1);
      expect(f(rows, NOW - 40 * D).opened).toBe(2);
    },
    'the delivery split counts each delivery apart, and the totals are their sum': () => {
      const rows = [view({ outcome: 'opened' }), view({ outcome: 'opened', delivery: 'in-batch' }), view({ outcome: 'not-opened', delivery: 'in-batch' })];
      const r = f(rows);
      expect(r.byDelivery['at-once']).toMatchObject({ opened: 1, notOpened: 0, measured: 1 });
      expect(r.byDelivery['in-batch']).toMatchObject({ opened: 1, notOpened: 1, measured: 2 });
      expect(r).toMatchObject({ opened: 2, notOpened: 1, measured: 3 });
    },
  };
}

// ── RETENTION (Task 8): retentionChangeGate ─────────────────────────────────────────────────────────────────────────

export function retentionChangeGateCases(m: ResponsesModule): Record<string, SuiteCase> {
  return {
    'lowering asks the step-up; raising and the same value ask the session alone': () => {
      expect(m.retentionChangeGate(180, 30)).toBe('step-up');
      expect(m.retentionChangeGate(180, 179)).toBe('step-up');
      expect(m.retentionChangeGate(180, 180)).toBe('session');
      expect(m.retentionChangeGate(180, 181)).toBe('session');
      expect(m.retentionChangeGate(180, 365)).toBe('session');
    },
    'an unreadable stored value is treated as a lowering, whatever the new one': () => {
      for (const next of [14, 180, 3_650]) expect(m.retentionChangeGate('unreadable', next)).toBe('step-up');
    },
  };
}

const set = (mutants: MutantSet<ResponsesModule>['mutants'], suite: (m: ResponsesModule) => Record<string, SuiteCase>):
  MutantSet<never> => ({ modulePath: MODULE, mutants, suite } as MutantSet<ResponsesModule> as MutantSet<never>);

/** This piece's sets, keyed as `mutation-floors.json` keys them (`<file>#<decider>`). */
export const RESPONSES_MUTANT_SETS: Record<string, MutantSet<never>> = {
  'server/src/responses.ts#receiptVerdict': set([
    { id: 'V1 no row kept', old: "if (row === null) return refuse('no-row');", new: 'if (row === null) return { keep: true };' },
    { id: 'V2 sealed kept', old: "if (row.state === 'sealed') return refuse('sealed');", new: '' },
    { id: 'V3 a worker receipt for a non-push kept', old: 'if (fromWorker !== (row.kind === \'push\'))', new: "if (fromWorker && row.kind === 'push')" },
    { id: 'V4 a console receipt for a push kept', old: 'if (fromWorker !== (row.kind === \'push\'))', new: "if (fromWorker && row.kind !== 'push')" },
    { id: 'V5 a console shown kept', old: "if (!fromWorker && r.receipt === 'shown') return refuse('wrong-source');", new: '' },
    { id: 'V6 a console opened refused', old: "!fromWorker && r.receipt === 'shown'", new: '!fromWorker' },
    { id: 'V7 a pending push checked too', old: "row.state === 'delivered' && !row.acceptedSubs", new: '!row.acceptedSubs' },
    { id: 'V8 the accepted set never asked', old: "row.state === 'delivered' && !row.acceptedSubs.includes(r.from.endpointHash)", new: 'false' },
    { id: 'V9 a delivered push refuses an accepted subscription', old: '&& !row.acceptedSubs.includes(', new: '&& row.acceptedSubs.includes(' },
    { id: 'V10 the bound is exclusive', old: 'f.workerReceipts >= RECEIPTS_PER_PUSH_MAX', new: 'f.workerReceipts > RECEIPTS_PER_PUSH_MAX' },
    { id: 'V11 no bound', old: "if (f.workerReceipts >= RECEIPTS_PER_PUSH_MAX) return refuse('full');", new: '' },
    { id: 'V12 the bound before the set', old: "    if (row.state === 'delivered' && !row.acceptedSubs.includes(r.from.endpointHash)) return refuse('not-accepted');\n    if (f.workerReceipts >= RECEIPTS_PER_PUSH_MAX) return refuse('full');",
      new: "    if (f.workerReceipts >= RECEIPTS_PER_PUSH_MAX) return refuse('full');\n    if (row.state === 'delivered' && !row.acceptedSubs.includes(r.from.endpointHash)) return refuse('not-accepted');" },
    { id: 'V13 the source before sealed', old: "  if (row.state === 'sealed') return refuse('sealed');\n  const fromWorker = r.from.source === 'worker';\n  if (fromWorker !== (row.kind === 'push')) return refuse('wrong-source');",
      new: "  const fromWorker = r.from.source === 'worker';\n  if (fromWorker !== (row.kind === 'push')) return refuse('wrong-source');\n  if (row.state === 'sealed') return refuse('sealed');" },
    { id: 'V14 a wrong-source answer says sealed', old: "if (fromWorker !== (row.kind === 'push')) return refuse('wrong-source');", new: "if (fromWorker !== (row.kind === 'push')) return refuse('sealed');" },
    { id: 'V15 the bound counted for the console too', old: '  if (r.from.source === \'worker\') {', new: '  if (true) {' },
  ], receiptVerdictCases),
  'server/src/responses.ts#responseOutcome': set([
    { id: 'O1 acted dropped', old: "if (act !== null) return sealOf('acted', { how: act.how, actedAt: act.at, ...seen });", new: '' },
    { id: 'O2 elsewhere dropped', old: "if (settledElsewhere(owner, windowEnd)) return sealOf('settled-elsewhere', seen);", new: '' },
    { id: 'O3 a gone owner falls through', old: "if (owner.kind === 'gone') return sealOf('unmeasured', { why: 'reader', ...seen });", new: '' },
    { id: 'O4 not-actionable dropped', old: "if (isPush && row.carries === null && !row.hasActions) return sealOf('not-actionable', seen);", new: '' },
    { id: 'O5 not-actionable ignores actions', old: 'row.carries === null && !row.hasActions', new: 'row.carries === null' },
    { id: 'O6 no-verdict dropped', old: "if (isPush && row.state === 'pending') return sealOf('unmeasured', { why: 'no-verdict', ...seen });", new: '' },
    { id: 'O7 ask-ended dropped', old: "if (owner.kind === 'ask' && (owner.state === 'stale' || owner.state === 'unknown')) return sealOf('unmeasured', { why: 'ask-ended', ...seen });", new: '' },
    { id: 'O8 not-opened ignores the stamps', old: '|| !stampsHold) {', new: ') {' },
    { id: 'O9 not-opened ignores the boots', old: 'const stampsHold = f.bootsInWindow === 0\n      && ', new: 'const stampsHold = ' },
    { id: 'O10 the restore compared, not its measure', old: "row.restore.kind === 'measured' && f.stampNow.restore.kind === 'measured' && row.restore.n === f.stampNow.restore.n",
      new: "(row.restore.kind !== 'measured' || f.stampNow.restore.kind !== 'measured' || row.restore.n === f.stampNow.restore.n)" },
    { id: 'O11 the restore never compared', old: ' && row.restore.n === f.stampNow.restore.n', new: '' },
    { id: 'O12 the boot stamps ignored', old: "row.boot.kind === 'measured' && f.stampNow.boot.kind === 'measured'\n      && ", new: '' },
    { id: 'O13 shown from one is enough', old: 'row.acceptedSubs.some((s) => !shownBy.has(s))', new: 'row.acceptedSubs.every((s) => !shownBy.has(s))' },
    { id: 'O14 replacement ignored', old: ' || f.replacedOn.some((s) => accepted.has(s))', new: '' },
    { id: 'O15 replacement on any subscription', old: 'f.replacedOn.some((s) => accepted.has(s))', new: 'f.replacedOn.length > 0' },
    { id: 'O16 the empty set is not-opened', old: "if (isPush && row.acceptedSubs.length > 0) return sealOf('not-opened', seen);", new: "if (isPush) return sealOf('not-opened', seen);" },
    { id: 'O17 opened after the window counted', old: 'r.at >= row.insertedAt && r.at <= windowEnd', new: 'r.at >= row.insertedAt' },
    { id: 'O18 any subscription counted', old: "r.source === 'worker' && accepted.has(r.endpointHash)", new: "r.source === 'worker'" },
    { id: 'O19 a console receipt counts for a push', old: "isPush ? r.source === 'worker' && accepted.has(r.endpointHash) : r.source === 'console'", new: "isPush ? accepted.has(r.endpointHash) || r.source === 'console' : r.source === 'console'" },
    { id: 'O20 opened before not-opened swapped', old: "  if (openedAt !== null) return sealOf('opened', seen);\n", new: '' },
    { id: 'O21 any actor acts', old: "a.actor === 'operator' && OPERATOR_ITEM_ACTS[a.act] !== undefined", new: 'OPERATOR_ITEM_ACTS[a.act] !== undefined' },
    { id: 'O22 an act after the window counts', old: 'const inside = (at: number): boolean => at >= start && at <= end;', new: 'const inside = (at: number): boolean => at >= start;' },
    { id: 'O23 an act before the window counts', old: 'const inside = (at: number): boolean => at >= start && at <= end;', new: 'const inside = (at: number): boolean => at <= end;' },
    { id: 'O24 a session answer is acted', old: "owner.answeredBy === 'operator' && ", new: '' },
    { id: 'O25 a digest flag ignored', old: "return owner.corrected ? { how: 'correct', at: null } : null;", new: 'return null;' },
    { id: 'O26 an overturn before the line counts', old: "return owner.overturnedAt >= start ? { how: 'correct', at: owner.overturnedAt } : null;", new: "return { how: 'correct', at: owner.overturnedAt };" },
    { id: 'O27 latest act wins', old: '(b.at < a.at ? b : a)', new: '(b.at > a.at ? b : a)' },
    { id: 'O28 elsewhere counts a return', old: "const ITEM_SETTLING: readonly ItemEventAct[] = ['tick', 'confirm',", new: "const ITEM_SETTLING: readonly ItemEventAct[] = ['return', 'tick', 'confirm'," },
    { id: 'O29 elsewhere after the window', old: "ITEM_SETTLING.includes(a.act) && a.at <= end);", new: 'ITEM_SETTLING.includes(a.act));' },
    { id: 'O30 a session answer after the window is elsewhere', old: "owner.state === 'answered' && owner.answeredAt !== null && owner.answeredAt <= end;", new: "owner.state === 'answered';" },
    { id: 'O31 a push starts at its insert', old: "(row.kind === 'push' ? (row.deliveredAt ?? row.insertedAt) : row.insertedAt)", new: 'row.insertedAt' },
    { id: 'O32 shownAt read from opened', old: "const shownAt = earliest('shown');", new: "const shownAt = earliest('opened');" },
  ], responseOutcomeCases),
  'server/src/responses.ts#responseWindowEnd': set([
    { id: 'W1 a pending push ends at its cap', old: "if (row.kind === 'push' && row.state === 'pending') return row.insertedAt + PUSH_WINDOW_MS;\n  const cap", new: '  const cap' },
    { id: 'W3 the settle ignored', old: 'return settled === null ? cap : Math.min(cap, settled);', new: 'return cap;' },
    { id: 'W4 the later of the two', old: 'Math.min(cap, settled)', new: 'Math.max(cap, settled)' },
    { id: 'W5 a move before the window settles it', old: 'ITEM_SETTLING.includes(a.act) && a.at >= from).map', new: 'ITEM_SETTLING.includes(a.act)).map' },
    { id: 'W6 any event settles', old: 'owner.acts.filter((a) => ITEM_SETTLING.includes(a.act) && a.at >= from)', new: 'owner.acts.filter((a) => a.at >= from)' },
    { id: 'W7 the latest move settles', old: 'return at.length === 0 ? null : Math.min(...at);\n  }\n  if (owner.kind === \'ask\')', new: 'return at.length === 0 ? null : Math.max(...at);\n  }\n  if (owner.kind === \'ask\')' },
    { id: 'W8 an ask never settles', old: "if (owner.kind === 'ask') return owner.state === 'answered' && owner.answeredAt !== null && owner.answeredAt >= from ? owner.answeredAt : null;", new: '' },
    { id: 'W9 an answer before the window settles', old: '&& owner.answeredAt >= from ? owner.answeredAt', new: '? owner.answeredAt' },
    { id: 'W10 no cap reads as the insert', old: '  if (cap === null) return null;\n', new: '  if (cap === null) return row.insertedAt;\n' },
  ], responseWindowEndCases),
  'server/src/responses.ts#responseSealDue': set([
    { id: 'S1 a sealed row sealed again', old: "  if (row.state === 'sealed') return { seal: false };\n  if (!read.ok)", new: '  if (!read.ok)' },
    { id: 'S2 no deferral', old: 'now < end + SEAL_DEFER_MS', new: 'now < end' },
    { id: 'S3 never seals a failed read', old: "    return sealOf('unmeasured', { why: 'reader' });", new: '    return { seal: false };' },
    { id: 'S4 a failed pending push read uses the cap', old: "const end = row.kind === 'push' && row.state === 'pending' ? row.insertedAt + PUSH_WINDOW_MS : row.windowCapAt;", new: 'const end = row.windowCapAt;' },
    { id: 'S5 an open window seals', old: 'if (end === null || now < end) return { seal: false };', new: 'if (end === null) return { seal: false };' },
    { id: 'S6 the end is exclusive', old: 'if (end === null || now < end) return { seal: false };', new: 'if (end === null || now <= end) return { seal: false };' },
    { id: 'S7 the deferral is inclusive', old: 'now < end + SEAL_DEFER_MS', new: 'now <= end + SEAL_DEFER_MS' },
  ], responseSealDueCases),
  'server/src/responses.ts#responsesFor': set([
    { id: 'F1 the seal before the correction', old: "const outcome = r.handledAt !== null ? 'acted' : r.outcome;", new: 'const outcome = r.outcome;' },
    { id: 'F2 handled is not elsewhere', old: '    if (r.handledAt !== null) elsewhere += 1;\n', new: '' },
    { id: 'F3 reader rows measured', old: "if (r.why === 'receipts') measured += 1;", new: "if (r.why === 'receipts' || r.why === 'reader') measured += 1;" },
    { id: 'F4 receipts rows not measured', old: " if (r.why === 'receipts') measured += 1;", new: '' },
    { id: 'F5 not-opened not measured', old: "else if (outcome === 'not-opened') { notOpened += 1; measured += 1; }", new: "else if (outcome === 'not-opened') { notOpened += 1; }" },
    { id: 'F6 no 28-day bound', old: 'Math.max(since, now - RESPONSE_FIGURES_LOOKBACK_MS)', new: 'since' },
    { id: 'F7 since ignored', old: 'Math.max(since, now - RESPONSE_FIGURES_LOOKBACK_MS)', new: 'now - RESPONSE_FIGURES_LOOKBACK_MS' },
    { id: 'F8 the label ignored', old: ' && r.label === scope.label', new: '' },
    { id: 'F9 the future admitted', old: ' && r.admittedAt <= now', new: '' },
    { id: 'F10 the median of an even count is the upper', old: '(actMs[mid - 1]! + actMs[mid]!) / 2', new: 'actMs[mid]!' },
    { id: 'F11 acted after open counts every acted', old: '      if (r.openedAt !== null) actedAfterOpen += 1;\n', new: '      actedAfterOpen += 1;\n' },
    { id: 'F12 the split ignores delivery', old: "'in-batch': figuresOf(inScope.filter((r) => r.delivery === 'in-batch'))", new: "'in-batch': figuresOf(inScope)" },
    { id: 'F13 unsorted median', old: '  actMs.sort((a, b) => a - b);\n', new: '' },
  ], responsesForCases),
  'server/src/responses.ts#retentionChangeGate': set([
    { id: 'R1 unreadable is a session change', old: "if (stored === 'unreadable') return 'step-up';", new: "if (stored === 'unreadable') return 'session';" },
    { id: 'R2 compared the wrong way', old: "return next < stored ? 'step-up' : 'session';", new: "return next > stored ? 'step-up' : 'session';" },
    { id: 'R3 the same value asks the step-up', old: "return next < stored ? 'step-up' : 'session';", new: "return next <= stored ? 'step-up' : 'session';" },
    { id: 'R4 never asks the step-up', old: "return next < stored ? 'step-up' : 'session';", new: "return 'session';" },
  ], retentionChangeGateCases),
};
