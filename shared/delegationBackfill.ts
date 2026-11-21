// Session helpers S2 (D-8874; spec docs/superpowers/specs/2026-11-19-session-helpers-design.md §7.2, Table 10; plan
// docs/superpowers/plans/2026-11-20-broker-helper-ends.md, Task S2). The wire half of the one-time pass over the delegation broker's
// old open records (`GET`/`POST /api/coord/delegation-backfill`): the words a closed record's basis stands for, the dry run's report,
// the request's acts and the door's one refusal word. Every decision is the server's L1 (`server/src/coord/delegation-backfill.ts`);
// nothing here decides. L0: the PWA bundles `shared/`, so this file takes no `node:` module. It sits outside `shared/api.ts`, whose
// growth is capped (D-8635), as `delegation-adopt.ts` does.
import type { DelegationActivitySourceKind } from './api.js';

/** What `endBasis: backfill-unmeasured` stands for (spec §7.2, condition 2). A closed record is never projected to any wire, so the
 *  basis is readable in the checkpoint and the database, and these words in the dry run's report. */
export const DELEGATION_BACKFILL_WORDS = 'closed by the one-time pass; its real end was not measured';

const DELEGATION_BACKFILL_AGE_BAND_MAP = { days1to7: true, days7to30: true, days30plus: true } as const;
/** How long ago a record the pass would close was OPENED: 1 to 7 days, 7 to 30 days, or 30 days and more. Nothing younger qualifies,
 *  because a record must have been quiet for 24 hours. */
export type DelegationBackfillAgeBand = keyof typeof DELEGATION_BACKFILL_AGE_BAND_MAP;
export const DELEGATION_BACKFILL_AGE_BANDS: readonly DelegationBackfillAgeBand[] = Object.keys(DELEGATION_BACKFILL_AGE_BAND_MAP) as DelegationBackfillAgeBand[];

const DELEGATION_BACKFILL_MODE_MAP = { first: true, listed: true } as const;
/** `first`: no pass has run, so the five conditions alone choose. `listed`: a pass has run, and it recorded the ids it closed; a re-run
 *  (after a rebuild from the journal alone reopened them) closes only those ids (review 2900 F2). */
export type DelegationBackfillMode = keyof typeof DELEGATION_BACKFILL_MODE_MAP;
export const DELEGATION_BACKFILL_MODES: readonly DelegationBackfillMode[] = Object.keys(DELEGATION_BACKFILL_MODE_MAP) as DelegationBackfillMode[];

const DELEGATION_BACKFILL_SCAN_MAP = { complete: true, cut: true, skipped: true } as const;
/** How far the dry run read the retained journal for review 3026 F4's count: all of it, cut at its time bound (the count is then
 *  unmeasured, never a partial number), or not at all (the pass reads none). */
export type DelegationBackfillScan = keyof typeof DELEGATION_BACKFILL_SCAN_MAP;
export const DELEGATION_BACKFILL_SCANS: readonly DelegationBackfillScan[] = Object.keys(DELEGATION_BACKFILL_SCAN_MAP) as DelegationBackfillScan[];

const DELEGATION_BACKFILL_ACT_MAP = { pass: true, undo: true } as const;
/** The POST's two acts: the pass, which carries the dry run's count, and its undo. */
export type DelegationBackfillAct = keyof typeof DELEGATION_BACKFILL_ACT_MAP;
export function isDelegationBackfillAct(v: unknown): v is DelegationBackfillAct {
  return typeof v === 'string' && Object.hasOwn(DELEGATION_BACKFILL_ACT_MAP, v);
}

/** The door's own refusal word, by name, so the server spells it once (here): the pass was asked to close a count that is not what it
 *  would close now, so it closed nothing. The dry run is read first, and its count is what the pass is asked for. */
export const DELEGATION_BACKFILL_REFUSAL = { countChanged: 'count-changed' } as const;
/** Each refusal word's one status, spread into `shared/refusal.ts`'s `REFUSAL_STATUS`: 409, the request was well formed and the
 *  broker's state refused it. CHOSEN, not measured: a new word. */
export const DELEGATION_BACKFILL_REFUSALS = { [DELEGATION_BACKFILL_REFUSAL.countChanged]: 409 } as const;
export type DelegationBackfillRefusal = keyof typeof DELEGATION_BACKFILL_REFUSALS;
export function isDelegationBackfillRefusal(v: unknown): v is DelegationBackfillRefusal {
  return typeof v === 'string' && Object.hasOwn(DELEGATION_BACKFILL_REFUSALS, v);
}

/** The dry run's report (spec §7.2, condition 4), and the pass's and the refusal's too, decided on one checkpoint at one instant. */
export interface DelegationBackfillReport {
  /** `DELEGATION_BACKFILL_WORDS`: what a closed record's basis says. */
  readonly words: string;
  /** The instant the report was decided at. */
  readonly asOf: string;
  readonly mode: DelegationBackfillMode;
  /** How many ids the first pass recorded; null before any pass. */
  readonly listed: number | null;
  /** How many records the pass would close now. */
  readonly closes: number;
  /** Those records, by kind and by how long ago they were opened. */
  readonly byKind: { readonly [K in DelegationActivitySourceKind]: { readonly [B in DelegationBackfillAgeBand]: number } };
  /** Of those, how many a lease or a lineage row names. */
  readonly named: number;
  /** Open agent and workflow records quiet for 24 hours whose positive check failed: their parent was measured here, at the same
   *  incarnation, or could not be measured, and they were quiet for less than 7 days. They stay open. */
  readonly failedCheck: number;
  /** Open records quiet for less than 24 hours: untouched. */
  readonly young: number;
  /** In `listed` mode, the open records that would qualify but that the first pass did not record: untouched. 0 in `first` mode. */
  readonly unlisted: number;
  /** Records the pass has already closed (their basis is the backfill's). */
  readonly closed: number;
  /** Review 3026 F4: open (or already closed) agent records whose final task notification the journal retains: the meta door opened
   *  them after their notification was journaled while their key was unmapped, so only a restart ends them by it. Null when the
   *  journal was not read whole: see `reportedScan`. */
  readonly reportedFirst: number | null;
  readonly reportedScan: DelegationBackfillScan;
}
