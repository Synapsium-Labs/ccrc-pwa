import type { Viewers } from './viewer.js';
import type { Deps } from './server.js';
import type { FleetState } from './fleetstate.js';
import type { SessionRecord } from './registry.js';
import type { FleetSession } from '../../shared/api.js';
import type { HibernateMark, HibernateRow, HibernateVerdict } from './coord/hibernate.js';
import { IDLE_HOURS_LANE, sleepPass, type IdleHoursCoordPort } from './sleepLane.js';

/**
 * HIBERNATION'S SWEEP (D-5242, plan Tasks 17a and 17b): L4, it reads, logs and — only when ARMED — acts; it decides
 * nothing: `hibernateVerdict` (`coord/hibernate.ts`, L1) holds the rule. Since D-7042 (ARCH-43) its pass is the one
 * sleep executor's (`sleepPass` in `sleepLane.ts`) under this lane's row, `IDLE_HOURS_LANE`, which says how it differs
 * from the stop-done lane; this file keeps the lane's deps, memory and outcome types and its pass's signature.
 */

/** The act's half of the deps: absent in a shadow-only harness, and then nothing can act whatever the markers say. */
export interface HibernateActPort {
  readonly runCcd: Deps['runCcd'];
  readonly fleetState: FleetState | undefined;
  /** The coordination serialiser (`CoordRoutesHandle.serial`); null until `buildServer` hands it over, and while it is
   *  the sweep stays in shadow. */
  readonly serial: (<T>(fn: () => Promise<T>) => Promise<T>) | null;
  /** The process's per-session write queue. */
  readonly queueRun: <T>(id: string, fn: () => Promise<T>) => Promise<T>;
  /** At the act: the registry record read again and the frame's row assembled from it (`readSessionRecord`, then
   *  `liveRowFor`). `ok: false` when either could not be read — the act then holds `unmeasured`. */
  readonly rowAtAct: (rec: SessionRecord) => Promise<{ ok: true; row: HibernateRow } | { ok: false }>;
}

export interface HibernateSweepDeps {
  /** Undefined without a coordination store: every row then holds `runs-unreadable`. */
  readonly coord: IdleHoursCoordPort | undefined;
  /** Undefined: every row holds `viewer` (fail closed): a screen nothing measured is never an empty one. */
  readonly viewers: Pick<Viewers, 'isOpen'> | undefined;
  /** `turnverdict.ts`'s `liveWordFor`, over the watcher's thunks. */
  readonly liveWord: (rec: SessionRecord) => Promise<
    { ok: true; word: string; since: number | null } | { ok: false; reason: 'no-pane' | 'no-config-dir' | 'unmeasured' }>;
  /** `turnverdict.ts`'s `turnMarkFor`: the turn marker, judged against the live process. */
  readonly mark: (rec: SessionRecord) => Promise<HibernateMark>;
  /** `$REG/hibernate-after-hours`'s body; called only when the listing names it. */
  readonly readAfterHours: () => Promise<string | null>;
  readonly log: (line: string) => void;
  readonly startedAt: number;
  readonly now: () => number;
  /** Null: shadow only, whatever the markers say. */
  readonly act: HibernateActPort | null;
}

export interface HibernateSweepMemory {
  /** The last shadow line per id. Pruned of ids the pass no longer sees. */
  readonly lastLine: Map<string, number>;
  /** The last skip or failure line per id after an act ccd refused or that failed. Pruned the same way. */
  readonly lastActLine: Map<string, number>;
}

/** What one row came to: the verdict the pass reached, and — armed, for a `hibernate` answer — what the act did. */
export type HibernateActOutcome =
  | { readonly kind: 'hibernated' }
  | { readonly kind: 'held-at-act'; readonly verdict: HibernateVerdict }
  | { readonly kind: 'skipped'; readonly detail: string }
  | { readonly kind: 'failed'; readonly detail: string };
export interface HibernateSweepOutcome {
  readonly id: string;
  readonly verdict: HibernateVerdict;
  readonly act?: HibernateActOutcome;
}

/** One pass. Returns every row's verdict (and, armed, what each act did), for the tests and the watcher's log. */
export async function hibernatePass(
  deps: HibernateSweepDeps, mem: HibernateSweepMemory,
  sessions: readonly FleetSession[], records: readonly SessionRecord[], names: readonly string[],
): Promise<HibernateSweepOutcome[]> {
  return sleepPass(IDLE_HOURS_LANE, deps, mem, sessions, records, names);
}
