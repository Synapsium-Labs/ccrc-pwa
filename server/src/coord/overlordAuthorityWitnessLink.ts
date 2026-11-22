// Overlord W1 authority journal plan, Task 6: the server's adapter over the agent link's `witness` op (ring L3, context C5). It keeps
// every distinction the link gives it (`token/link.ts#tokenSyncLinkOver`'s way): an agent that lists no `witness` op is never sent
// one (`no-op`), `bad-request` from the op means the agent predates it, a frame that never left is `unsent`, any other failure after
// the send is `lost`, and an answer off the grammar is `malformed`. It never throws and never rejects.
import { AgentOpError, LinkNotSentError } from '../remote/errors.js';
import type { FleetClient } from '../remote/client.js';
import { WITNESS_OP, readWitnessOpAnswer, type WitnessOpAnswer } from '../../../shared/agent-protocol.js';
import type { WitnessTuple } from '../../../shared/authorityWitness.js';

export type WitnessLinkAnswer =
  | { kind: 'answered'; answer: WitnessOpAnswer }
  | { kind: 'no-op' }
  | { kind: 'predates-op' }
  | { kind: 'unsent' }
  | { kind: 'lost'; why: 'timeout' | 'disconnected' | 'aborted' }
  | { kind: 'malformed' };

export interface WitnessLink { send(offer: WitnessTuple): Promise<WitnessLinkAnswer> }

/** The op's request deadline. */
export const WITNESS_OP_TIMEOUT_MS = 15_000;
const LOST_WORDS = ['timeout', 'disconnected', 'aborted'] as const;

export function witnessLinkOver(client: Pick<FleetClient, 'request' | 'state'>): WitnessLink {
  return {
    async send(offer: WitnessTuple): Promise<WitnessLinkAnswer> {
      if (!(client.state.agentOps ?? []).includes(WITNESS_OP)) return { kind: 'no-op' };
      try {
        const res = await client.request({ t: 'req', op: WITNESS_OP, offer }, WITNESS_OP_TIMEOUT_MS);
        const { t: _t, id: _id, ok: _ok, ...body } = res as Record<string, unknown>;
        const answer = readWitnessOpAnswer(body);
        return answer === 'malformed' ? { kind: 'malformed' } : { kind: 'answered', answer };
      } catch (e) {
        if (e instanceof AgentOpError) return e.code === 'bad-request' ? { kind: 'predates-op' } : { kind: 'malformed' };
        if (e instanceof LinkNotSentError) return { kind: 'unsent' };
        const m = e instanceof Error ? e.message : '';
        return { kind: 'lost', why: (LOST_WORDS as readonly string[]).includes(m) ? (m as (typeof LOST_WORDS)[number]) : 'disconnected' };
      }
    },
  };
}
