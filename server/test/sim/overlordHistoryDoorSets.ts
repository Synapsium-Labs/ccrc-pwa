// The history door's two deciders, their cases and their mutant sets (Overlord W1, PR B1;
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md`, Task 5 Step 4). Each decider's cases are written ONCE
// here, as suite cases over the module `server/src/coord/overlordHistory.ts`: `overlord-history-door.test.ts` runs them
// against the real module, and `mutation-floors.test.ts` runs them against each named mutant.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { OVERLORD_HISTORY_OP } from '../../../shared/agent-protocol.js';
import type { OverlordHistoryAnswer } from '../../../shared/overlordHistory.js';
import type { HistoryLink, HistoryReadOutcome } from '../../src/coord/overlordHistory.js';
import type { MutantSet, SuiteCase } from './mutate.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const L1 = path.join(ROOT, 'server/src/coord/overlordHistory.ts');

export type HistoryDoorModule = typeof import('../../src/coord/overlordHistory.js');

const up = (ops?: string[]): HistoryLink => ({ connected: true, ...(ops === undefined ? {} : { agentOps: ops }) });

export function historyAgentForCases(m: HistoryDoorModule): Record<string, SuiteCase> {
  return {
    'zero links give no-agent': () => { expect(m.historyAgentFor([])).toEqual({ kind: 'no-agent' }); },
    'one connected link without the word gives no-agent (no ops at all, too)': () => {
      expect(m.historyAgentFor([up(['disk'])])).toEqual({ kind: 'no-agent' });
      expect(m.historyAgentFor([up()])).toEqual({ kind: 'no-agent' });
    },
    'one connected link with it gives that link': () => {
      const l = up(['disk', OVERLORD_HISTORY_OP]);
      expect(m.historyAgentFor([l])).toEqual({ kind: 'agent', link: l });
    },
    'a disconnected link with the word gives no-agent (the link keeps its ops across a drop)': () => {
      expect(m.historyAgentFor([{ connected: false, agentOps: [OVERLORD_HISTORY_OP] }])).toEqual({ kind: 'no-agent' });
    },
    'two connected links with it give many-agents': () => {
      expect(m.historyAgentFor([up([OVERLORD_HISTORY_OP]), up([OVERLORD_HISTORY_OP])])).toEqual({ kind: 'many-agents' });
    },
    'two connected links where one has it give that one, wherever it stands': () => {
      const l = up([OVERLORD_HISTORY_OP]);
      expect(m.historyAgentFor([up(['disk']), l])).toEqual({ kind: 'agent', link: l });
      expect(m.historyAgentFor([l, up(['disk'])])).toEqual({ kind: 'agent', link: l });
      expect(m.historyAgentFor([{ connected: false, agentOps: [OVERLORD_HISTORY_OP] }, l])).toEqual({ kind: 'agent', link: l });
    },
  };
}

const SCOPE = { kind: 'overlord', id: 'all', project: null, families: [], families_total: 0, transcripts: 0 } as const;
export const HISTORY_ROWS: Extract<OverlordHistoryAnswer, { outcome: 'rows' }> = {
  outcome: 'rows', exit: 0, items: [{ trust: 'untrusted', text: 'TEXT-MARKER in project-a' }], shown: 1, total: 1, scope: SCOPE,
};
const answer = (a: OverlordHistoryAnswer): HistoryReadOutcome => ({ kind: 'answer', answer: a });
const unreachable = (cause: string) => ({ kind: 'refuse', status: 503, word: 'history-unreachable', outcome: cause, extra: { cause } });
const other = (a: OverlordHistoryAnswer) => ({ kind: 'answer', status: 200, body: { ok: true, ...a }, outcome: a.outcome });

/** Table 2, row by row: the outcome the door is handed, and its one answer. */
export const TABLE_2: readonly (readonly [string, HistoryReadOutcome, unknown])[] = [
  ['no connected link advertises', { kind: 'no-agent' }, unreachable('no-agent')],
  ['two or more', { kind: 'many-agents' }, unreachable('many-agents')],
  ['unsupported', { kind: 'unsupported' }, unreachable('unsupported')],
  ['not-started', { kind: 'not-started' }, unreachable('not-started')],
  ['lost', { kind: 'lost' }, unreachable('lost')],
  ["timeout (the client's own)", { kind: 'timeout' }, unreachable('timeout')],
  ['agent rows', answer(HISTORY_ROWS), { kind: 'rows', status: 200, body: { ok: true, ...HISTORY_ROWS }, count: 1 }],
  ['agent verb-refused', answer({ outcome: 'verb-refused', word: 'not-indexed' }), other({ outcome: 'verb-refused', word: 'not-indexed' })],
  ['agent store-refused', answer({ outcome: 'store-refused', word: 'store-absent' }), other({ outcome: 'store-refused', word: 'store-absent' })],
  ['agent request-refused', answer({ outcome: 'request-refused', word: 'regex' }),
    { kind: 'refuse', status: 400, word: 'bad-request', outcome: 'request-refused', extra: { refusal: 'regex' } }],
  ['agent busy', answer({ outcome: 'busy' }), other({ outcome: 'busy' })],
  ['agent deadline', answer({ outcome: 'deadline' }), other({ outcome: 'deadline' })],
  ['agent too-large', answer({ outcome: 'too-large', bytes: 70_000 }), other({ outcome: 'too-large', bytes: 70_000 })],
  ['agent failed', answer({ outcome: 'failed', word: 'internal' }), other({ outcome: 'failed', word: 'internal' })],
];

export function historyDoorAnswerCases(m: HistoryDoorModule): Record<string, SuiteCase> {
  const out: Record<string, SuiteCase> = {};
  for (const [name, o, want] of TABLE_2) out[`Table 2: ${name}`] = () => { expect(m.historyDoorAnswer(o)).toEqual(want); };
  out['every cause of history-unreachable is a row of Table 2'] = () => {
    const causes = TABLE_2.map(([, , w]) => (w as { extra?: { cause?: string } }).extra?.cause).filter((c) => c !== undefined);
    expect([...causes].sort()).toEqual([...m.HISTORY_UNREACHABLE_CAUSES].sort());
  };
  return out;
}

const AGENT_KEY = 'server/src/coord/overlordHistory.ts#historyAgentFor';
const ANSWER_KEY = 'server/src/coord/overlordHistory.ts#historyDoorAnswer';

export const HISTORY_DOOR_MUTANT_SETS: Record<string, MutantSet<never>> = {
  [AGENT_KEY]: {
    modulePath: L1,
    mutants: [
      { id: 'A1 answer the first advertiser when there are two', old: "  if (serving.length > 1) return { kind: 'many-agents' };\n", new: '' },
      { id: 'A2 treat a link without the word as an advertiser', old: '(l.agentOps ?? []).includes(OVERLORD_HISTORY_OP)', new: '(l.agentOps ?? []).length >= 0' },
      { id: 'A3 ignore connected', old: 'l.connected && (l.agentOps', new: '(l.agentOps' },
      { id: 'A4 no advertiser picks the first link', old: "  if (serving.length === 0) return { kind: 'no-agent' };\n", new: "  if (serving.length === 0) return links.length > 0 ? { kind: 'agent', link: links[0]! } : { kind: 'no-agent' };\n" },
    ],
    suite: historyAgentForCases,
  } as MutantSet<HistoryDoorModule> as MutantSet<never>,
  [ANSWER_KEY]: {
    modulePath: L1,
    mutants: [
      { id: 'D1 map an agent outcome to history-unreachable', old: "    default: return { kind: 'answer', status: 200, body: { ok: true, ...a }, outcome: a.outcome };", new: "    default: return unreachable('lost');" },
      { id: 'D2 map lost to 200', old: '  if (o.kind !== \'answer\') return unreachable(o.kind);', new: "  if (o.kind === 'lost') return { kind: 'answer', status: 200, body: { ok: true, outcome: 'busy' }, outcome: 'busy' };\n  if (o.kind !== 'answer') return unreachable(o.kind);" },
      { id: 'D3 map request-refused to 200', old: "    case 'request-refused':\n", new: "    case 'request-refused': return { kind: 'answer', status: 200, body: { ok: true, ...a }, outcome: a.outcome };\n    case 'request-refused-was':\n" },
      { id: 'D4 map timeout to rows', old: '  if (o.kind !== \'answer\') return unreachable(o.kind);', new: "  if (o.kind === 'timeout') return { kind: 'rows', status: 200, body: { ok: true } as never, count: 0 };\n  if (o.kind !== 'answer') return unreachable(o.kind);" },
      { id: 'D5 count no row', old: 'count: a.items.length', new: 'count: 0' },
    ],
    suite: historyDoorAnswerCases,
  } as MutantSet<HistoryDoorModule> as MutantSet<never>,
};
