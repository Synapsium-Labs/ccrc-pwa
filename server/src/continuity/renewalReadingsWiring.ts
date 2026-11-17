// L4 delivery, context C3 (Session Conversation): the renewal readings' wiring for the generations pass (Overlord W1, plan
// `w1-renewal-readings.md`). It builds the gather's one optional port, `GatherPorts.w1`, which reads each wired producer
// for one generation and hands the mappers' answers (`renewalReadings.ts`, L1) to the lane, which spreads them over its
// `W1` defaults (`renewalInputsOf`). It decides nothing and writes nothing: every reading is its producer's, and every
// mapping is the L1 module's.
//
// ONE PRODUCER NEVER REJECTS THE PASS (review 2183 F17). Each producer's read and its mapper run inside their own `try`: a
// throw sets that one field to unmeasured `<reading> read failed`, logged once per pass, and the other fields and the other
// generations read as their ports answer.
//
// PR A wires two readings, both the Overlord's only: the fitted ceiling (`closedSpotProbes`, read once per model class per
// pass) and the daily backstop (`backstopRead`, read once per pass). A field it does not answer keeps the lane's `W1`.
import type { SessionRecord } from '../registry.js';
import type { WatcherCoordPort } from '../coord/ports.js';
import type { Clock } from '../time/ports.js';
import { familyClassOf } from '../../../shared/models.js';
import type { BackstopRead } from '../../../shared/renewal-readings.js';
import type { GenRow } from './continuityStore.js';
import { usageReading, type GenReadings } from './generationsLane.js';
import { backstopDueOf, fittedCeilingOf, type SpotsRead, type W1Inputs } from './renewalReadings.js';

/** The store reads the wiring makes, declared by this consumer. */
export type ReadingsCoord = Pick<WatcherCoordPort, 'closedSpotProbes' | 'backstopRead'>;

export interface ReadingsDeps {
  readonly time: { readonly clock: Pick<Clock, 'wall'> };
  /** Where a failed read is logged, once per reading per pass. Absent: `console.warn`. */
  readonly log?: (line: string) => void;
}

/** The gather's port for one pass (`GatherPorts.w1`). */
export interface RenewalReadingsWiring {
  w1(g: GenRow, base: GenReadings): Promise<Pick<GenReadings, 'w1' | 'soft'>>;
}

/** The pass's readings port. `records` is the pass's registry listing, the array `sweepGenerations` hands the renewal act;
 *  the later pull requests read it (the session's identity for `notLocal`). One wiring per pass: its memo is the pass's. */
export function renewalReadingsOf(deps: ReadingsDeps, coord: ReadingsCoord, records: readonly SessionRecord[]): RenewalReadingsWiring {
  void records;
  const log = deps.log ?? ((line: string) => console.warn(line));
  const logged = new Set<keyof W1Inputs>();
  const spotsByClass = new Map<string, SpotsRead>();
  let backstop: BackstopRead | undefined;

  /** One field, read and mapped inside its own catch (F17). */
  const field = <K extends keyof W1Inputs>(out: Partial<W1Inputs>, key: K, name: string, read: () => W1Inputs[K]): void => {
    try {
      out[key] = read();
    } catch (e) {
      out[key] = { kind: 'unmeasured', why: `${name} read failed` } as W1Inputs[K];
      if (!logged.has(key)) {
        logged.add(key);
        log(`ccrc-server: generations: the ${name} read failed, so ${key} reads unmeasured this pass: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  };

  return {
    w1: async (g, base) => {
      const w1: Partial<W1Inputs> = {};
      if (g.role === 'overlord') {
        field(w1, 'fittedCeilingTokens', 'fitted ceiling', () => {
          const cls = g.model === null ? null : familyClassOf(g.model);
          let spots: SpotsRead = { ok: true, spots: [] };
          if (cls !== null) {
            const held = spotsByClass.get(cls);
            spots = held ?? coord.closedSpotProbes(cls);
            if (held === undefined) spotsByClass.set(cls, spots);
          }
          return fittedCeilingOf(cls, usageReading(base, 'ctxWindow'), spots);
        });
        field(w1, 'backstopDue', 'backstop', () => {
          backstop ??= coord.backstopRead();
          return backstopDueOf(backstop, g.startReportedAt, deps.time.clock.wall());
        });
      }
      return { w1 };
    },
  };
}
