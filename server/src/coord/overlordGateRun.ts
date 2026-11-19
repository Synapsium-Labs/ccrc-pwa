// The gate runner (Overlord W1, gates B; spec §11.2; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-gates.md` Task 5).
// Ring L4, context C5: every Overlord door's one call, after its `onRequest` token check and its own body parse. It READS each
// fact once through a port filled at L5, ASKS the L1 deciders (`overlordGate.ts`), REFUSES through `refuseRoute`, and RECORDS
// what the verdict names, each through its one writer. It holds no `if` over a gate word and spells none (a scan in
// `overlord-gate-run.test.ts` holds that): which facts a door reads, step 1's early answer and every refusal are the deciders'.
//
// Fail closed: the runner never throws. A port that throws reads as that fact's unmeasured arm, which refuses at its own step
// (slug `unmeasured-refuses-at-its-step`). A port whose producer has not landed is bound at L5 to its stated default, which
// refuses (the witness: `unmeasured`, 502), never to a stub that passes.
//
// SECRETS: the act key is read from its header, handed to the `actKey` port (which compares digests) and dropped. It never
// enters a decider, a refusal's detail, a recorded row or a log line.
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseRoute } from '../refuse.js';
import { ACT_COUNTER_HEADER, ACT_GENERATION_HEADER, ACT_KEY_HEADER, WITNESS_KEY_HEADER } from '../../../shared/continuity-door.js';
import type { DesignationRead } from '../../../shared/overlord-designation.js';
import type { CallerIdentity, SessionCaller } from '../auth/callerIdentity.js';
import { effectiveGeneration, type CardReadRead, type GenRow, type GenerationsRead } from '../continuity/continuityStore.js';
import { designationFactFrom, identityOf } from '../roleOf.js';
import type { AuthorityState } from './overlordAuthorityCoherence.js';
import { doorRow, type OverlordDoorRow } from './overlordDoors.js';
import {
  callerStandingOf, counterVerdict, gateReads, incarnationNeeded, overlordGate, standingVerdict, witnessRecordOf,
  type FenceFacts, type FencePresented, type FenceWhy, type GateFacts, type GateVerdict, type WitnessRecord, type WitnessVerdict,
} from './overlordGate.js';
import type { ActKeyFact, CounterAnswer, FenceRefusalRow } from './overlordGateStore.js';

/** One witness check, as door process B's `recordWitnessCheck` records it: what `witnessRecordOf` (L1) decided, the used
 *  witness on a pass or the reason of a refusal at step 7a, with where and when; an unmeasured witness records nothing. */
export interface WitnessCheck {
  readonly sessionId: string; readonly generationId: number; readonly door: string;
  readonly outcome: WitnessRecord['outcome']; readonly witnessId: number | null; readonly why: string | null; readonly at: number;
}

/** The facts the runner reads and records, each a port filled at L5 (`server.ts`). */
export interface OverlordGateDeps {
  readonly identity: Pick<CallerIdentity, 'session' | 'incarnation'>;
  readonly designation: () => DesignationRead;
  /** `OverlordAuthorityGuard.state()`. */
  readonly authority: () => AuthorityState;
  /** The ladder's composed read, as the gate takes it (never `start-door`: the runner does not ask it for a start door). */
  readonly ladder: () => Exclude<GateFacts['ladder'], 'start-door'>;
  /** `CoordStore.liveGenerations()`. */
  readonly generations: () => GenerationsRead;
  /** Whether the `continuity` row is live, for `effectiveGeneration`. */
  readonly continuityLive: () => boolean;
  /** `cardReadOfStart`. */
  readonly cardRead: (startId: number) => CardReadRead;
  /** The live generation's act key against the presented one, compared by digest (`overlordGateStore.ts#actKeyFact`). */
  readonly actKey: (generationId: number, presentedKey: string | null) => ActKeyFact;
  /** The guarded compare-and-set (`overlordGateStore.ts#advanceCounterGuarded`). */
  readonly counter: (generationId: number, counter: number) => CounterAnswer;
  /** Door process B's witness lookup. */
  readonly witness: (sessionId: string, generationId: number, witnessKey: string | null) => WitnessVerdict;
  /** Door process B's `recordWitnessCheck`. */
  readonly recordWitness: (check: WitnessCheck) => void;
  /** `overlordGateStore.ts#recordFenceRefusal`. */
  readonly recordFenceRefusal: (row: FenceRefusalRow) => void;
  /** `SERVER_CAPS`, read at the call. */
  readonly serverWords: () => readonly string[];
  /** The `Clock` port's wall time. */
  readonly now: () => number;
}

export type GateRun =
  | { readonly kind: 'pass'; readonly caller: SessionCaller; readonly generation: { readonly id: number; readonly n: number; readonly term: number } | null }
  | { readonly kind: 'hook'; readonly caller: SessionCaller }
  | { readonly kind: 'refused' };

export interface GateClaim { readonly sessionId: string; readonly uuid: string; readonly uuidField: 'byUuid' | 'fromUuid' }

const whyOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
/** A header's one value, or null when it is absent or repeated. */
const headerOf = (req: FastifyRequest, name: string): string | null => {
  const v = req.headers[name];
  return typeof v === 'string' ? v : null;
};
const POS_INT = /^[1-9][0-9]{0,15}$/;
const posIntOf = (v: string | null): number | null => (v !== null && POS_INT.test(v) && Number.isSafeInteger(Number(v)) ? Number(v) : null);

/** Each port's call, its throw read as the fact's unmeasured arm. */
function attempt<T>(read: () => T, unmeasured: (why: string) => T): T {
  try { return read(); } catch (e) { return unmeasured(whyOf(e)); }
}

/** Build the runner once (L5); every Overlord door calls the function it answers with its own row's key. */
export function overlordGateRun(deps: OverlordGateDeps):
  (req: FastifyRequest, reply: FastifyReply, key: string, claim: GateClaim) => Promise<GateRun> {
  const refused = (reply: FastifyReply, v: Extract<GateVerdict, { kind: 'refuse' }>): GateRun => {
    void refuseRoute(reply, v.word, { detail: v.detail, step: v.step });
    return { kind: 'refused' };
  };
  const recordWitness = (r: WitnessRecord | null, live: GenRow | null, sessionId: string, door: string): void => {
    if (r === null || live === null) return;
    attempt(() => deps.recordWitness({ sessionId, generationId: live.id, door, ...r, at: deps.now() }), () => undefined);
  };
  const recordFence = (sessionId: string, generationId: number | null, door: string, why: FenceWhy | null): void => {
    if (why === null) return;
    attempt(() => deps.recordFenceRefusal({ sessionId, generationId, door, why, at: deps.now() }), () => undefined);
  };

  return async (req, reply, key, claim) => {
    const row = doorRow(key);
    if (row.group !== 'overlord') throw new Error(`overlordGateRun: ${key} is not an Overlord door`);
    const door: OverlordDoorRow = row;
    // Step 1, attribution: the caller's id and current uuid against the registry (the box token was the door's onRequest).
    let who: Awaited<ReturnType<OverlordGateDeps['identity']['session']>>;
    try {
      who = await deps.identity.session(claim.sessionId, claim.uuid, claim.uuidField);
    } catch (e) {
      who = { ok: false, error: 'registry-unmeasurable', detail: whyOf(e) };
    }
    if (!who.ok) {
      void refuseRoute(reply, who.error, { detail: who.detail });
      return { kind: 'refused' };
    }
    const caller = who;
    // Step 1, standing: the designation, then the incarnation only for the bound or a pending designate id.
    const designation = attempt<DesignationRead>(() => deps.designation(), (why) => ({ kind: 'unmeasured', why }));
    let incarnation: Parameters<typeof callerStandingOf>[0]['incarnation'] = 'not-asked';
    if (incarnationNeeded(claim.sessionId, designation)) {
      try { incarnation = await deps.identity.incarnation(claim.sessionId); } catch (e) { incarnation = { kind: 'unmeasured', reason: whyOf(e) }; }
    }
    const standing = callerStandingOf({ sessionId: claim.sessionId, incarnation }, designation);
    const early = standingVerdict(door, standing);
    if (early !== null) return early.kind === 'refuse' ? refused(reply, early) : { kind: 'hook', caller };

    // The remaining facts, each read once: the identity's live generation, then what this door's order reads.
    const reads = gateReads(door);
    const fact = designationFactFrom(designation);
    const term = fact === 'unmeasured' || fact.kind === 'none' ? null : fact.term;
    const gens = attempt<GenerationsRead>(() => deps.generations(), (detail) => ({ ok: false, detail }));
    let live: GenRow | null = null;
    let generation: GateFacts['generation'] = { kind: 'unmeasured', why: 'the generations could not be read' };
    if (gens.ok && fact !== 'unmeasured') {
      const identity = identityOf(claim.sessionId, fact);
      live = gens.rows.find((g) => g.identity === identity) ?? null;
      generation = live === null ? { kind: 'none' }
        : attempt<GateFacts['generation']>(() => ({ kind: 'state', state: effectiveGeneration(live!, deps.continuityLive()).state }), (why) => ({ kind: 'unmeasured', why }));
    } else if (!gens.ok) {
      generation = { kind: 'unmeasured', why: gens.detail };
    }
    const ladder: GateFacts['ladder'] = reads.ladder ? attempt(() => deps.ladder(), (why) => ({ kind: 'unmeasured', why })) : 'start-door';
    let card: GateFacts['card'] = 'none';
    if (reads.card) {
      const c = live === null ? { ok: true as const, read: null } : attempt<CardReadRead>(() => deps.cardRead(live!.startId), (detail) => ({ ok: false, detail }));
      card = !c.ok ? { kind: 'unmeasured', why: c.detail } : c.read === null ? 'none' : c.read.current ? 'read-current' : 'read-stale';
    }
    let fence: GateFacts['fence'] = 'read-door';
    let witness: GateFacts['witness'] = 'read-door';
    let presented: FencePresented = { generation: null, counter: null, key: false };
    if (reads.fence) {
      const presentedKey = headerOf(req, ACT_KEY_HEADER);
      presented = { generation: posIntOf(headerOf(req, ACT_GENERATION_HEADER)), counter: posIntOf(headerOf(req, ACT_COUNTER_HEADER)), key: presentedKey !== null };
      let facts: FenceFacts;
      if (!gens.ok) facts = { kind: 'unmeasured', why: gens.detail };
      else if (live === null) facts = { kind: 'read', live: null };
      else {
        const k = attempt<ActKeyFact>(() => deps.actKey(live!.id, presentedKey), (why) => ({ kind: 'unmeasured', why }));
        facts = k.kind === 'unmeasured' ? k : { kind: 'read', live: { id: live.id, n: live.n, term: live.term, key: k.key, counter: k.counter } };
      }
      fence = { presented, facts };
      // @anchor op-key-slot
      // W2's operation-key lookup is read here and decided right after step 7, before step 7a (the act rows piece adds its
      // port and its arm; its hash binds the door, the path parameters and the body).
      witness = live === null ? { kind: 'unmeasured', why: 'no live generation' }
        : attempt<WitnessVerdict>(() => deps.witness(claim.sessionId, live!.id, headerOf(req, WITNESS_KEY_HEADER)), (why) => ({ kind: 'unmeasured', why }));
    }
    const authority = reads.ladder ? attempt<AuthorityState>(() => deps.authority(), () => ({ kind: 'unmeasured', why: 'journal' })) : { kind: 'coherent' } as const;

    const verdict = overlordGate({
      door, standing, serverWords: attempt(() => deps.serverWords(), () => []), authority, ladder, term, fence, witness, card, generation,
    });
    if (verdict.kind === 'refuse') {
      if (verdict.record === 'fence-refusal') recordFence(claim.sessionId, live?.id ?? null, key, verdict.why);
      recordWitness(witnessRecordOf(verdict, witness), live, claim.sessionId, key);
      return refused(reply, verdict);
    }
    if (verdict.kind === 'hook') return { kind: 'hook', caller };
    if (!door.write || live === null) return { kind: 'pass', caller, generation: live === null ? null : { id: live.id, n: live.n, term: live.term } };
    // A write that passed: the witness is spent, then the counter's compare-and-set, a TOCTOU re-check of step 7's read
    // (legitimately different: two racing writes both read the same stored counter; only one may advance it).
    recordWitness(witnessRecordOf(verdict, witness), live, claim.sessionId, key);
    const counted = counterVerdict(attempt<CounterAnswer>(() => deps.counter(live!.id, presented.counter ?? 0), () => 'unmeasured'));
    if (counted.kind === 'refuse') {
      recordFence(claim.sessionId, live.id, key, counted.why);
      void refuseRoute(reply, counted.word, { detail: counted.detail, step: '7' });
      return { kind: 'refused' };
    }
    return { kind: 'pass', caller, generation: { id: live.id, n: live.n, term: live.term } };
  };
}
