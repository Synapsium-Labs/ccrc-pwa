// A gate for suites that build the continuity routes by hand (Overlord W1 gates B): the real runner over no designation,
// so every caller is another session and is served the hook's way after the given attribution, exactly as the doors ran
// it before the gate. Every fact a designated caller would need throws: a suite that reaches one has found a designation it
// did not seed.
import type { AttributionRead } from '../src/coord/openRun.js';
import { attributionIdentity } from '../src/auth/attributionIdentity.js';
import { overlordGateRun, type GateClaim, type GateRun } from '../src/coord/overlordGateRun.js';
import type { FastifyReply, FastifyRequest } from 'fastify';

const unread = (): never => { throw new Error('hookGate: no designation was seeded, so no Overlord fact is read'); };

export function hookGate(attribute: (id: string, uuid: string) => Promise<AttributionRead>):
  (req: FastifyRequest, reply: FastifyReply, key: string, claim: GateClaim) => Promise<GateRun> {
  return overlordGateRun({
    identity: attributionIdentity({ attribute: (id, uuid) => attribute(id, uuid), incarnation: async () => ({ kind: 'unmeasured', reason: 'absent' }) }),
    designation: () => ({ kind: 'not-designated', row: null }),
    authority: unread, ladder: unread, generations: unread, continuityLive: unread, cardRead: unread, actKey: unread, counter: unread,
    witness: unread, recordWitness: unread, recordFenceRefusal: unread, serverWords: () => [], now: () => 0,
  });
}

/** A gate that passes every caller: for a suite that tests what a door does AFTER the gate passed (the designated session's
 *  own reads), where no fixture can present every fact a real pass needs. The gate's own decisions are held by its suites. */
export function passGate(): (req: FastifyRequest, reply: FastifyReply, key: string, claim: GateClaim) => Promise<GateRun> {
  return async () => ({ kind: 'pass', caller: {} as never, generation: null });
}
