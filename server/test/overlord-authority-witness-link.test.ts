// Overlord W1 authority journal plan, Task 6: `witnessLinkOver`, each answer arm, with a fake client.
import { describe, expect, it } from 'vitest';
import { witnessLinkOver, WITNESS_OP_TIMEOUT_MS } from '../src/coord/overlordAuthorityWitnessLink.js';
import { AgentOpError, LinkNotSentError } from '../src/remote/errors.js';
import type { ResOk } from '../../shared/agent-protocol.js';
import type { WitnessTuple } from '../../shared/authorityWitness.js';

const OFFER: WitnessTuple = {
  v: 1, epoch: 2, base: 0, terms: { authority: 2, privacy: 'absent', act: 'absent' }, boot: 'boot-a',
  authority: { sequence: 2, digest: 'a'.repeat(64) }, privacy: 'absent', act: 'absent', highestIds: { restoreGeneration: 0 },
  told: { operatorRung: null, latches: [] },
};

interface Sent { payload: unknown; timeoutMs: number | undefined }
function fake(ops: readonly string[] | undefined, outcome: () => Promise<ResOk>) {
  const sent: Sent[] = [];
  const client = {
    state: { agentOps: ops } as never,
    request: (payload: unknown, timeoutMs?: number) => { sent.push({ payload, timeoutMs }); return outcome(); },
  };
  return { client: client as never, sent };
}
const res = (body: Record<string, unknown>): ResOk => ({ t: 'res', id: 1, ok: true, ...body });

describe('witnessLinkOver', () => {
  it('answers no-op and sends nothing when the agent lists no witness op (or no ready yet)', async () => {
    for (const ops of [undefined, [], ['update']]) {
      const f = fake(ops, async () => res({}));
      expect(await witnessLinkOver(f.client).send(OFFER)).toEqual({ kind: 'no-op' });
      expect(f.sent).toEqual([]);
    }
  });

  it('sends the offer with the 15 s deadline and answers held', async () => {
    const f = fake(['witness'], async () => res({ kind: 'held', tuple: OFFER }));
    expect(await witnessLinkOver(f.client).send(OFFER)).toEqual({ kind: 'answered', answer: { kind: 'held', tuple: OFFER } });
    expect(f.sent).toEqual([{ payload: { t: 'req', op: 'witness', offer: OFFER }, timeoutMs: 15_000 }]);
    expect(WITNESS_OP_TIMEOUT_MS).toBe(15_000);
  });

  it('answers held null and each unmeasured word apart', async () => {
    expect(await witnessLinkOver(fake(['witness'], async () => res({ kind: 'held', tuple: null })).client).send(OFFER))
      .toEqual({ kind: 'answered', answer: { kind: 'held', tuple: null } });
    for (const why of ['unreadable', 'malformed', 'unwritable'] as const) {
      expect(await witnessLinkOver(fake(['witness'], async () => res({ kind: 'unmeasured', why })).client).send(OFFER))
        .toEqual({ kind: 'answered', answer: { kind: 'unmeasured', why } });
    }
  });

  it('answers malformed for an answer off the grammar', async () => {
    for (const body of [{}, { kind: 'held' }, { kind: 'held', tuple: { v: 1 } }, { kind: 'unmeasured', why: 'other' }]) {
      expect(await witnessLinkOver(fake(['witness'], async () => res(body)).client).send(OFFER)).toEqual({ kind: 'malformed' });
    }
  });

  it('bad-request means the agent predates the op; unsent and each lost word stay apart; nothing rejects', async () => {
    expect(await witnessLinkOver(fake(['witness'], async () => { throw new AgentOpError('bad-request', null); }).client).send(OFFER))
      .toEqual({ kind: 'predates-op' });
    expect(await witnessLinkOver(fake(['witness'], async () => { throw new LinkNotSentError('x'); }).client).send(OFFER))
      .toEqual({ kind: 'unsent' });
    for (const why of ['timeout', 'disconnected', 'aborted'] as const) {
      expect(await witnessLinkOver(fake(['witness'], async () => { throw new Error(why); }).client).send(OFFER)).toEqual({ kind: 'lost', why });
    }
    expect(await witnessLinkOver(fake(['witness'], async () => { throw new Error('something else'); }).client).send(OFFER))
      .toEqual({ kind: 'lost', why: 'disconnected' });
  });
});
