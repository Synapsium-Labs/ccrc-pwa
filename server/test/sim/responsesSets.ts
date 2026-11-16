// The response record's deciders' oracles and mutant sets (Overlord W1, the response record, Task 1:
// docs/superpowers/plans/2026-11-14-overlord-w1/w1-responses.md). The cases are written ONCE here:
// `responses-receipt.test.ts` runs them against the real module and `mutation-floors.test.ts` against each textual mutant.
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
};
