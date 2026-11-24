// The Overlord's history door, its two deciders (Overlord W1, PR B1; plan
// `docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md` Task 5, questions 5 and 10; spec §3.2, C47, H3).
// Ring L1, context C5: pure, no store, no `fs`, no fastify. The door (`overlordHistoryRoutes.ts`, L4) reads facts and
// hands them here; it picks no agent and maps no outcome itself.
//
// - `historyAgentFor` chooses the one CONNECTED link that advertises `overlord-history` in its ready frame's ops (H3: the
//   op goes to an agent chosen by its word, never to "the fleet box"). It reads `connected` because the link keeps its
//   last ready's ops across a drop (`FleetState.agentOps`). Today the list has at most one link; the decider is total over
//   the list, so a multi-agent server (#275) changes its caller, not this rule.
// - `historyDoorAnswer` maps every outcome of a read to the door's one answer (Table 2, total): an agent that was not
//   reached, or may not have answered, is `history-unreachable` (503) with its cause, never an empty result (D-6034's
//   rule); an outcome the agent answered is a 200 with that outcome, except its `request-refused`, which is `bad-request`.
//   Only `rows` hands session text to the caller, so only `rows` is a served line for the read ceiling (ruled R8).
import { OVERLORD_HISTORY_OP } from '../../../shared/agent-protocol.js';
import type { OverlordHistoryAnswer, OverlordHistoryRequestRefusal } from '../../../shared/overlordHistory.js';
import { REFUSAL_STATUS } from '../../../shared/refusal.js';

/** One agent link, as the choice reads it: whether it is up, and the ops its last ready frame named. */
export interface HistoryLink {
  readonly connected: boolean;
  readonly agentOps?: readonly string[];
}

/** Which link serves the read: the one, or why there is none. */
export type HistoryAgentChoice<L extends HistoryLink> =
  | { readonly kind: 'agent'; readonly link: L }
  | { readonly kind: 'no-agent' }
  | { readonly kind: 'many-agents' };

/** THE CHOICE: the one connected link that advertises the word, else `no-agent` (none) or `many-agents` (two or more). */
export function historyAgentFor<L extends HistoryLink>(links: readonly L[]): HistoryAgentChoice<L> {
  const serving = links.filter((l) => l.connected && (l.agentOps ?? []).includes(OVERLORD_HISTORY_OP));
  if (serving.length === 0) return { kind: 'no-agent' };
  if (serving.length > 1) return { kind: 'many-agents' };
  return { kind: 'agent', link: serving[0]! };
}

/** `FleetIO.overlordHistory`'s answer, its failure contract (Table 2's port half). `unsupported`: an agent that does not
 *  list the op, an older agent's `bad-request`, or a fleet with no agent link (local mode); `not-started`: a frame that
 *  never left; `timeout`: the server's own wait expired; `lost`: anything else after the send, an abort, the agent's own
 *  `timeout`, or a reply off `readOverlordHistoryAnswer`'s grammar. Never a throw. */
export type OverlordHistoryAsked =
  | { readonly kind: 'unsupported' }
  | { readonly kind: 'not-started' }
  | { readonly kind: 'lost' }
  | { readonly kind: 'timeout' }
  | { readonly kind: 'answer'; readonly answer: OverlordHistoryAnswer };

/** Why the door answers `history-unreachable`: the choice's two, and the port's four (question 5). */
export type HistoryUnreachableCause = 'no-agent' | 'many-agents' | 'unsupported' | 'not-started' | 'lost' | 'timeout';
const CAUSE_MAP: Record<HistoryUnreachableCause, string> = {
  'no-agent': 'no connected agent advertises overlord-history',
  'many-agents': 'more than one connected agent advertises overlord-history',
  unsupported: 'the agent does not answer the op',
  'not-started': 'the request never left the server',
  lost: 'the request was sent and no answer the server can read came back',
  timeout: "the server's own wait expired",
};
/** Every `HistoryUnreachableCause`, derived from the map. */
export const HISTORY_UNREACHABLE_CAUSES = Object.keys(CAUSE_MAP) as HistoryUnreachableCause[];

/** Whether a kebab word is one this file names: a cause of `history-unreachable`, or the agent's refused request as a line's
 *  outcome. A word rides a door answer's `cause` or a read-ledger line, never a `refused` or `reject.code` (the coordination
 *  scan's guard, `mail-routes.test.ts`). */
export const isOverlordHistoryKebab = (word: string): boolean =>
  Object.prototype.hasOwnProperty.call(CAUSE_MAP, word) || word === 'request-refused';

/** Everything the door can be handed: the choice's no-link answers, or what the port answered. */
export type HistoryReadOutcome = { readonly kind: 'no-agent' } | { readonly kind: 'many-agents' } | OverlordHistoryAsked;

/** The door's answer: a served page, another 200 (an outcome the agent answered), or a refusal; each with its status and
 *  the outcome word of its read-ledger line. */
export type HistoryDoorAnswer =
  | { readonly kind: 'rows'; readonly status: 200; readonly body: { readonly ok: true } & OverlordHistoryAnswer; readonly count: number }
  | { readonly kind: 'answer'; readonly status: 200; readonly body: { readonly ok: true } & OverlordHistoryAnswer; readonly outcome: string }
  | { readonly kind: 'refuse'; readonly status: number; readonly word: 'history-unreachable'; readonly outcome: HistoryUnreachableCause;
      readonly extra: { readonly cause: HistoryUnreachableCause } }
  | { readonly kind: 'refuse'; readonly status: number; readonly word: 'bad-request'; readonly outcome: 'request-refused';
      readonly extra: { readonly refusal: OverlordHistoryRequestRefusal } };

const unreachable = (cause: HistoryUnreachableCause): HistoryDoorAnswer =>
  ({ kind: 'refuse', status: REFUSAL_STATUS['history-unreachable'], word: 'history-unreachable', outcome: cause, extra: { cause } });

/** THE MAPPING (Table 2), total over every outcome. */
export function historyDoorAnswer(o: HistoryReadOutcome): HistoryDoorAnswer {
  if (o.kind !== 'answer') return unreachable(o.kind);
  const a = o.answer;
  switch (a.outcome) {
    case 'rows': return { kind: 'rows', status: 200, body: { ok: true, ...a }, count: a.items.length };
    case 'request-refused':
      return { kind: 'refuse', status: REFUSAL_STATUS['bad-request'], word: 'bad-request', outcome: 'request-refused', extra: { refusal: a.word } };
    default: return { kind: 'answer', status: 200, body: { ok: true, ...a }, outcome: a.outcome };
  }
}
