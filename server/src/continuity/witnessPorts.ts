// L4 composition, context C3 (Session Conversation): the two witness ports gates B's runner takes (`overlordGateRun.ts`'s
// `witness` and `recordWitness`; Overlord W1 door process B1, plan `w1-door-process.md` Task 9). Built once at the composition
// root (`server.ts`) and handed over as one object. DECIDE IN L1, ACT HERE: every decision is `hookReports.ts`'s
// (`witnessVerdict`, `unwitnessedLatchDue`, `latchWindowStart`); this file reads through the stores' readers, asks, and acts.
//
// `witness`: `unmeasured` (so the runner refuses 502 and counts nothing) UNTIL the fleet node's ccd advertises
// `door-witness-v1` (`capSupported`: no evidence is no word), so a server updated before the fleet's hook fires no latch. With
// the word it reads the generation's start (the start row's server `receivedAt`), the session's witnesses for the key and which
// of them are used, and answers the verdict. Any read that fails is `unmeasured`, with its own detail.
//
// `recordWitness`: records the check and answers true ONLY when it was recorded (a refused or failed write answers false, which
// refuses the write at step 7a for a `used` record). After an `unwitnessed` it runs THE LATCH (the third in a day, counted from
// the later of a day ago and the operator's last clear, cause `unwitnessed-third`): the ladder's one delivery-facing raise, and
// on a raise that changed a row, ONE push. Every failure in the latch path is logged and never changes the recorder's answer.
// A log line never carries the witness key (this file never holds it past the lookup) or a free-text detail from a session.
import { capSupported, DOOR_WITNESS_CAP } from '../ccdargv.js';
import type { FleetState } from '../fleetstate.js';
import type { PushPayload } from '../push.js';
import type { Clock, Entropy } from '../time/ports.js';
import type { OverlordGateDeps } from '../coord/overlordGateRun.js';
import { raiseLatch } from '../coord/overlordLadderRead.js';
import { latchLastClearedAt, type AuthorityAppender } from '../coord/overlordLadderStore.js';
import type { CoordStore } from '../coord/store.js';
import { latchWindowStart, unwitnessedLatchDue, witnessVerdict } from './hookReports.js';
import { recordWitnessCheck, startReceivedAtOf, unwitnessedSince, usedWitnesses, witnessesFor } from './hookReportStore.js';

/** The ladder cause this file raises (a row of `LADDER_CAUSE_MAP`). */
const CAUSE = 'unwitnessed-third';

export interface WitnessPortDeps {
  /** `undefined` when the server has no coordination store: both ports then refuse. */
  readonly coord: Pick<CoordStore, 'db' | 'liveGenerations' | 'ladderRows' | 'raiseLatch'> | undefined;
  readonly fleetState: () => Pick<FleetState, 'ccdVerbs'> | undefined;
  /** The authority journal's appender, as the ladder's own doors take it (`NO_LADDER_AUTHORITY` when none is configured). */
  readonly journal: AuthorityAppender;
  readonly clock: Pick<Clock, 'wall'>;
  readonly entropy: Pick<Entropy, 'hex'>;
  /** An unbound operator push (the server's push funnel). May throw: the latch path logs it. */
  readonly push: (payload: PushPayload) => void;
}

const whyOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
const PUSH: PushPayload = {
  title: 'Overlord writes without a witness',
  body: 'Three of the Overlord\'s writes in a day had no matching hook report. It is held at advise until you clear the latch.',
  tag: 'overlord-unwitnessed-third',
};

export function witnessPorts(deps: WitnessPortDeps): Pick<OverlordGateDeps, 'witness' | 'recordWitness'> {
  const warn = (what: string, why: string): void => { console.warn(`ccrc-server: the unwitnessed latch: ${what} (${why})`); };

  /** THE LATCH, after an `unwitnessed` was recorded. Never throws. */
  const latch = (coord: NonNullable<WitnessPortDeps['coord']>, sessionId: string, now: number, actor: Parameters<typeof raiseLatch>[3]): void => {
    try {
      const cleared = latchLastClearedAt(coord.db, CAUSE);
      if (cleared.kind === 'unmeasured') return warn('the last clear could not be read', cleared.why);
      const count = unwitnessedSince(coord.db, sessionId, latchWindowStart({ now, clearedAt: cleared.at }));
      if (!count.ok) return warn('the count could not be read', count.detail);
      const rows = coord.ladderRows();
      if (rows.kind === 'unmeasured') return warn('the standing latches could not be read', rows.why);
      if (!unwitnessedLatchDue({ count: count.value, latchStanding: rows.standing.some((l) => l.cause === CAUSE) })) return;
      const raised = raiseLatch({ coord, journal: deps.journal, clock: deps.clock, entropy: deps.entropy }, CAUSE,
        `${count.value} unwitnessed writes in a day`, actor);
      if (!raised.ok) return warn('the raise was refused', 'error' in raised ? raised.error : raised.reason);
      if (raised.changed && raised.notice === 'push') deps.push(PUSH);
    } catch (e) {
      warn('the latch path failed', whyOf(e));
    }
  };

  return {
    witness: (sessionId, generationId, key) => {
      if (!capSupported(deps.fleetState(), DOOR_WITNESS_CAP)) return { kind: 'unmeasured', why: 'the fleet\'s hook sends no witness yet' };
      const coord = deps.coord;
      if (coord === undefined) return { kind: 'unmeasured', why: 'no coordination store' };
      const gens = coord.liveGenerations();
      if (!gens.ok) return { kind: 'unmeasured', why: gens.detail };
      const gen = gens.rows.find((g) => g.id === generationId);
      if (gen === undefined) return { kind: 'unmeasured', why: 'the generation is not live' };
      const start = startReceivedAtOf(coord.db, gen.startId);
      if (!start.ok) return { kind: 'unmeasured', why: start.detail };
      const now = deps.clock.wall();
      // A missing key is the verdict's own answer; it reads nothing.
      const witnesses = key === null ? { ok: true as const, value: [] } : witnessesFor(coord.db, sessionId, key, now);
      const used = witnesses.ok ? usedWitnesses(coord.db, witnesses.value.map((w) => w.id)) : { ok: false as const, detail: 'no witnesses were read to check' };
      return witnessVerdict({ witnesses, used, key, generationStartedAt: start.value, now });
    },
    recordWitness: (check) => {
      const coord = deps.coord;
      if (coord === undefined) return false;
      const w = recordWitnessCheck(coord.db, { sessionId: check.sessionId, generationId: check.generationId, outcome: check.outcome,
        witnessId: check.witnessId, why: check.why, at: check.at });
      if (!w.ok) {
        if (w.error === 'write-failed') console.warn('ccrc-server: a witness check could not be recorded');
        return false;
      }
      if (check.outcome === 'unwitnessed') latch(coord, check.sessionId, check.at, check.actor);
      return true;
    },
  };
}
