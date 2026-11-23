// The authority witness exchange (Overlord spec §7.6; plan `docs/superpowers/plans/2026-11-14-overlord-w1/w1-authority-journal.md`
// Task 6, questions 6, 8, 10, 11 and 13). Ring L4, context C5. It gathers the server's facts, asks the L1 deciders
// (`witnessVerdict`, `currentWitnessTuple`, `offVolumeHolders`, `narrowestTold`), and ACTS on the answer: a rollback is told to the
// guard, an unreadable fact of the server's own is told to the guard, a malformed field is warned once per change, and a consistent
// witness off the volume from an earlier boot lifts "no witness since boot". Nothing here decides: every word comes from L1.
//
// WHO IS A WITNESS. The fleet box's agent (its ready field, then its answer to the offered tuple, under the source `agent`), and each
// signed-in console (a source per device, through the door). Each source's LAST answer is kept for the reads below, bounded at
// `MAX_SOURCES` (the oldest answer is dropped), so a long-lived server holds no unbounded map. The highest epoch, restore generation
// and message id any witness answered with are kept apart from that map, because a dropped source's maximum still counts.
//
// THE ONE FLIGHT. At most one agent exchange runs; a call during a flight schedules exactly one more after it (`coalesced`), so a
// burst of appends costs one more exchange, and the exchange never rejects (the lane and the guard's report only nudge it).
//
// Departure `held-for-compares-authority-sequence`: `heldFor` asks `offVolumeHeld` with each holder's AUTHORITY head sequence in place
// of its epoch (`offVolumeHolders`), because a record's own epoch also counts privacy records appended before it, which the server
// cannot recover; the authority sequence is exact, and the digest check that made the verdict `consistent` proved the same chain.
import type { OverlordAuthorityJournal } from './overlordAuthorityJournal.js';
import type { OverlordAuthorityGuard } from './overlordAuthorityGuard.js';
import { authorityFold, type AuthorityView } from './overlordAuthority.js';
import { authorityCoherence, type AuthorityRowsSeen } from './overlordAuthorityCoherence.js';
import {
  authorityEpoch, currentWitnessTuple, measuredWitnessFacts, narrowestTold, offVolumeHeld, offVolumeHolders, witnessVerdict,
  type AuthorityEpoch, type HostRelation, type ServerWitnessFacts, type WitnessHeld, type WitnessSourceAnswer, type WitnessVerdict,
} from './overlordAuthorityWitness.js';
import type { WitnessLink } from './overlordAuthorityWitnessLink.js';
import type { PrivacyHeadRead, PrivacyJournalHead } from './privacyJournalHead.js';
import type { ReadyWitness } from '../../../shared/agent-protocol.js';
import { parseWitnessTuple, type WitnessHead, type WitnessTold, type WitnessTuple } from '../../../shared/authorityWitness.js';

export const MAX_SOURCES = 64;
const AGENT_SOURCE = 'agent';

/** What the console door answers: an offer, a measured rollback, or an unmeasured exchange. */
export type ExchangeAnswer = { kind: 'offer'; tuple: WitnessTuple } | { kind: 'unmeasured'; why: string }
  | Extract<WitnessVerdict, { kind: 'rolled-back' }>;

export interface OverlordAuthorityExchangeDeps {
  journal: Pick<OverlordAuthorityJournal, 'readVerified'>;
  /** Read committed rows only; an open transaction cannot attest that its head has landed. */
  committedRows(): AuthorityRowsSeen;
  guard: OverlordAuthorityGuard;
  privacy: PrivacyJournalHead;
  /** The ONE boot nonce of this process (`collectLane.bootNonce`). */
  boot: string;
  /** The fleet box's agent: what its ready frame held, and the link; null in `local` mode (no agent witness). */
  agent: { held(): ReadyWitness | undefined; link: WitnessLink } | null;
  /** The agent link's host relation against this server's volume (question 10); `'unmeasured'` until the isolation word's port lands. */
  relationOf: () => HostRelation;
  warn: (line: string) => void;
}

/** The server's own facts as one read gathered them. `view` is null when the authority journal could not be read. */
interface Gathered {
  server: ServerWitnessFacts;
  view: AuthorityView | null;
  head: WitnessHead | null;
  restoreGeneration: number;
}

export class OverlordAuthorityExchange {
  private readonly sources = new Map<string, WitnessSourceAnswer>();
  /** The sources whose current malformed word has been warned: one line per change, not one per tick. */
  private readonly warned = new Set<string>();
  private bootWitness: 'missing' | 'seen' | 'confirmed' = 'missing';
  /** The ready reader produces a new object on every ready; the same object between passes is not a new answer. */
  private agentObservation: { ready: ReadyWitness | undefined; held: WitnessHeld } | null = null;
  private highestEpoch = 0;
  private highestGeneration = 0;
  private highestMessage: number | null = null;
  private flight: Promise<void> | null = null;
  private queued = false;

  constructor(private readonly deps: OverlordAuthorityExchangeDeps) {}

  // ── The server's facts ───────────────────────────────────────────────────────────────────────────────────────────

  private gather(): Gathered {
    const privacy = this.safePrivacy();
    const read = this.deps.journal.readVerified();
    if ((read.kind !== 'records' && read.kind !== 'absent') || authorityCoherence(read, this.deps.committedRows()).kind !== 'coherent') {
      return { server: { epoch: 'unmeasured', boot: this.deps.boot, authority: 'unmeasured', privacy }, view: null, head: null, restoreGeneration: 0 };
    }
    const records = read.kind === 'records' ? read.records : [];
    const view = authorityFold(records);
    const last = records[records.length - 1];
    const head: WitnessHead | null = last === undefined ? null : { sequence: last.sequence, digest: last.digest };
    const authority = { head, digestAt: (sequence: number): string | null => (sequence >= 1 ? (records[sequence - 1]?.digest ?? null) : null) };
    return {
      server: { epoch: authorityEpoch(view, head?.sequence ?? 0, privacy), boot: this.deps.boot, authority, privacy },
      view, head, restoreGeneration: view.lastConfirm?.restoreGeneration ?? 0,
    };
  }

  private safePrivacy(): PrivacyHeadRead {
    try { return this.deps.privacy.read(); } catch (e) { return { kind: 'unmeasured', why: e instanceof Error ? e.message : 'the privacy head read threw' }; }
  }

  private offerTo(g: Gathered, verdict: WitnessVerdict): ExchangeAnswer {
    if (verdict.kind === 'rolled-back' || verdict.kind === 'unmeasured') return verdict;
    if (g.view === null) return { kind: 'unmeasured', why: 'journal' };
    const highestMessageId = g.server.privacy.kind === 'head' ? g.server.privacy.highestMessageId : null;
    const offered = currentWitnessTuple(g.view, g.head, g.server.epoch, g.server.privacy, this.deps.boot, g.restoreGeneration, highestMessageId);
    return offered.kind === 'tuple' ? { kind: 'offer', tuple: offered.tuple } : { kind: 'unmeasured', why: offered.why };
  }

  // ── Judging one witness's word ───────────────────────────────────────────────────────────────────────────────────

  private applyRefusal(g: Gathered, v: WitnessVerdict): void {
    const facts = measuredWitnessFacts(g.server);
    // Rows 1 and 2 of the source verdict do not measure the server. Fence independently of their result.
    if (facts.kind === 'unmeasured') this.deps.guard.witnessUnmeasured(facts.why);
    else if (v.kind === 'rolled-back') {
      if (this.bootWitness !== 'confirmed') this.bootWitness = 'missing';
      this.deps.guard.witnessRefused(v.cause);
    } else if (v.kind === 'unmeasured' && v.why !== 'malformed') this.deps.guard.witnessUnmeasured(v.why);
  }

  /** Record one newly observed source answer. A retry that gets no answer must not replace it or add boot evidence. */
  private judge(source: string, held: WitnessHeld, host: HostRelation, g: Gathered): WitnessVerdict {
    const v = witnessVerdict(g.server, held, host);
    const malformed = v.kind === 'unmeasured' && v.why === 'malformed';
    if (held.kind === 'tuple') this.noteHighest(held.tuple);
    this.applyRefusal(g, v);
    if (v.kind === 'consistent' && v.counts && this.bootWitness === 'missing' && this.deps.guard.state().kind === 'coherent') {
      this.bootWitness = 'seen';
    }
    if (malformed) {
      if (!this.warned.has(source)) {
        this.warned.add(source);
        this.deps.warn(`ccrc-server: the authority witness from ${source} is malformed; it neither refuses nor counts`);
      }
    // The agent's ready word `nothing` sits between two answers of one exchange, so it never resets a warning; any other parse does.
    } else if (held.kind === 'tuple' || source !== AGENT_SOURCE) this.warned.delete(source);
    this.sources.delete(source);
    this.sources.set(source, { host, verdict: v.kind, tuple: held.kind === 'tuple' ? held.tuple : null });
    while (this.sources.size > MAX_SOURCES) {
      const oldest = this.sources.keys().next().value as string;
      this.sources.delete(oldest);
      this.warned.delete(oldest);
    }
    return v;
  }

  private noteHighest(t: WitnessTuple): void {
    this.highestEpoch = Math.max(this.highestEpoch, t.epoch);
    this.highestGeneration = Math.max(this.highestGeneration, t.highestIds.restoreGeneration);
    if (t.highestIds.message !== undefined) this.highestMessage = Math.max(this.highestMessage ?? 0, t.highestIds.message);
  }

  // ── The agent ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** Judges what the agent held at ready, offers it the current tuple, and judges what it answered. At most one in flight; a call
   *  during a flight schedules exactly one more after it. Never rejects. */
  exchangeAgent(): Promise<void> {
    if (this.deps.agent === null) return Promise.resolve();
    if (this.flight !== null) { this.queued = true; return this.flight; }
    const run = async (): Promise<void> => {
      await Promise.resolve();          // the flight is recorded before the first pass can finish
      try {
        do {
          this.queued = false;
          try { await this.once(); } catch (e) { this.deps.warn(`ccrc-server: the authority witness exchange with the agent failed: ${e instanceof Error ? e.message : String(e)}`); }
        } while (this.queued);
      } finally { this.flight = null; }
    };
    this.flight = run();
    return this.flight;
  }

  /** Schedules `exchangeAgent` (coalesced): the guard's appended report, the agent's ready, and the lane call it. */
  nudge(): void {
    void this.exchangeAgent();
  }

  private async once(): Promise<void> {
    const agent = this.deps.agent;
    if (agent === null) return;
    const ready = agent.held();
    const host = this.deps.relationOf();
    const g = this.gather();
    let v: WitnessVerdict;
    if (this.agentObservation === null || this.agentObservation.ready !== ready) {
      const held = readyHeld(ready ?? { kind: 'absent' });
      this.agentObservation = { ready, held };
      v = this.judge(AGENT_SOURCE, held, host, g);
    } else {
      // Compare against today's facts for offer safety, but a cached answer must not replace the recorded word or count again.
      v = witnessVerdict(g.server, this.agentObservation.held, host);
      this.applyRefusal(g, v);
    }
    const offer = this.offerTo(g, v);
    if (offer.kind !== 'offer') return;
    const res = await agent.link.send(offer.tuple);
    if (res.kind !== 'answered' || agent.held() !== ready) return; // failed ops and obsolete connections leave the last answer standing
    const a = res.answer;
    const held: WitnessHeld = a.kind === 'held' ? (a.tuple === null ? { kind: 'nothing' } : { kind: 'tuple', tuple: a.tuple }) : { kind: 'malformed' };
    this.agentObservation = { ready, held };
    this.judge(AGENT_SOURCE, held, this.deps.relationOf(), this.gather());
  }

  // ── The console ──────────────────────────────────────────────────────────────────────────────────────────────────

  /** One signed-in console's exchange: judge what it holds (`null`: nothing; a tuple that does not parse: malformed), and answer
   *  the current tuple, or why none can be built. */
  exchangeConsole(sourceKey: string, rawHeld: unknown): ExchangeAnswer {
    let held: WitnessHeld;
    if (rawHeld === null || rawHeld === undefined) held = { kind: 'nothing' };
    else {
      const p = parseWitnessTuple(rawHeld);
      held = p.ok ? { kind: 'tuple', tuple: p.tuple } : { kind: 'malformed' };
    }
    const g = this.gather();
    return this.offerTo(g, this.judge(`console:${sourceKey}`, held, 'console', g));
  }

  // ── The reads ────────────────────────────────────────────────────────────────────────────────────────────────────

  /** A prior-boot answer can lift the condition; rollback withdraws it, and Confirm holds it standing until restart. */
  noWitnessSinceBoot(): 'standing' | 'lifted' {
    return this.bootWitness === 'seen' ? 'lifted' : 'standing';
  }

  /** The ladder's `NarrowingWitness`: whether the narrowing at authority record `recordSequence` is held off the volume. */
  heldFor(recordSequence: number): 'held' | 'not-yet' | 'unmeasured' {
    const g = this.gather();
    if (g.server.epoch === 'unmeasured') return 'unmeasured';
    return offVolumeHeld(recordSequence, offVolumeHolders([...this.sources.values()], g.server.epoch.base));
  }

  /** What Confirm's port (`RestoreWitnessFacts`, PR C) reads: the server's epoch. */
  epoch(): { kind: 'measured'; n: number } | { kind: 'unmeasured'; why: string } {
    const e: AuthorityEpoch = this.gather().server.epoch;
    return e === 'unmeasured' ? { kind: 'unmeasured', why: 'the epoch could not be measured' } : { kind: 'measured', n: e.total };
  }

  /** The highest epoch and restore generation any source answered with since boot, any host (0 and 0 with none). */
  highest(): { kind: 'measured'; epoch: number; restoreGeneration: number } | { kind: 'unmeasured'; why: string } {
    return { kind: 'measured', epoch: this.highestEpoch, restoreGeneration: this.highestGeneration };
  }

  /** The post-commit notification from Confirm. It must withdraw the earlier boot observation before scheduling any offer. */
  offerNow(): void {
    this.bootWitness = 'confirmed';
    this.nudge();
  }

  /** Confirm can recover a narrower told value from a consistent or rollback-detecting off-volume source. */
  told(): { kind: 'measured'; told: WitnessTold | null } | { kind: 'unmeasured'; why: string } {
    return { kind: 'measured', told: narrowestTold([...this.sources.values()]) };
  }

  /** For the private store (Overlord W1 private store A): the highest message id any witness answered with since boot. */
  witnessHighestIds(): { message: number | null } | 'unmeasured' {
    return { message: this.highestMessage };
  }

  /** How many sources are kept (a test's read of the bound). */
  sourceCount(): number {
    return this.sources.size;
  }
}

/** The agent's ready word as the verdict's input: `nothing` and `absent` hold nothing; `unmeasured` and `malformed` are malformed. */
function readyHeld(r: ReadyWitness): WitnessHeld {
  switch (r.kind) {
    case 'tuple': return { kind: 'tuple', tuple: r.tuple };
    case 'nothing': case 'absent': return { kind: 'nothing' };
    case 'unmeasured': case 'malformed': return { kind: 'malformed' };
  }
}
