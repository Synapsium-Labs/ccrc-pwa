// L0: imports nothing (the PWA bundles this file). The landing line's words and the wire shape of one entry (landing
// order wave 5e, D-7611 to D-7613). The line is the server's record of which PRs a project's coordinators have pinned
// at `merging`, and in what order they may land; this file holds the vocabulary, `coord/landingEntry.ts` (L1) decides
// what to write, and `CoordStore.advanceLanding` (L3) is the one writer.

/** An entry's state. `unknown` is schema.ts's designated we-do-not-know member: a row this build cannot read. The
 *  decider treats it as not in the line, and no writer ever stores it. */
export const LANDING_ENTRY_STATE = {
  pinned: 'waiting in the line at its pinned head',
  ejected: 'sent back from the line for a fix round',
  landed: 'merged into its base',
  withdrawn: 'taken out of the line by the operator',
  unknown: 'a row this build cannot read',
} as const;
export type LandingEntryState = keyof typeof LANDING_ENTRY_STATE;
export const LANDING_ENTRY_STATES: readonly LandingEntryState[] = Object.keys(LANDING_ENTRY_STATE) as LandingEntryState[];
export const isLandingEntryState = (v: unknown): v is LandingEntryState =>
  typeof v === 'string' && (LANDING_ENTRY_STATES as readonly string[]).includes(v);

/** Why a pinned entry was sent back: the queue dequeued it, its head moved, or it conflicts with its base. */
export const LANDING_EJECTION_KINDS = ['dequeued', 'new-head', 'conflict'] as const;
export type LandingEjectionKind = (typeof LANDING_EJECTION_KINDS)[number];
export const isLandingEjectionKind = (v: unknown): v is LandingEjectionKind =>
  typeof v === 'string' && (LANDING_EJECTION_KINDS as readonly string[]).includes(v);

/** One entry of a project's landing line, one row per (project, pr).
 *
 *  Nulls, one meaning each: `baseSha` and `ejectionKind` are non-null only while `state` is `ejected` and that ejection
 *  named them; `null` with `state` `ejected` is a bare retreat that named no base (D-7616). `runId` is `null` only for
 *  a run-less entry, which 5f adds. `afterIds` name entry ids (`landing_entries.id`), never PR numbers. */
export interface LandingEntry {
  id: number;
  project: string;
  pr: number;
  /** The head the coordinator verified at `merging`; written only with the run's own `merging-at:` detail. */
  pinnedSha: string;
  handoffCommit: string;
  runId: number | null;
  state: LandingEntryState;
  baseSha: string | null;
  ejectionKind: LandingEjectionKind | null;
  /** How many times this entry was sent back; a re-pin keeps it. */
  ejections: number;
  afterIds: number[];
  fixesMain: boolean;
  setBy: string;
  /** Epoch ms of the (re-)pin; a re-pin moves the entry to the back (D-7617). */
  pinnedAt: number;
}

/** The project's two booleans (spec §5.5 Data): the line is paused while either is set. `CoordStore.landingProject`
 *  answers this. */
export interface LandingLineFlags { operatorPaused: boolean; mainRedHold: boolean }

/** Why the line is paused, each word naming the flag that sets it. The order of the keys is the order of `by`. */
export const LANDING_PAUSE_BY = { operator: 'operatorPaused', 'main-red': 'mainRedHold' } as const satisfies Record<string, keyof LandingLineFlags>;
export type LandingPauseBy = keyof typeof LANDING_PAUSE_BY;
export const LANDING_PAUSE_BYS = Object.keys(LANDING_PAUSE_BY) as LandingPauseBy[];

/** The decider's answer (`coord/landingLine.ts#landingOrder`). `order` is every `pinned` entry in the order they may
 *  land, a blocked remainder last. Not paused: `head` is the entry that may land next, or `null` when the line is
 *  empty or every entry waits on an `ejected` or `unknown` target or on a cycle. Paused: `by` names the flags, and
 *  there is no head. */
export type LandingOrder =
  | { paused: false; order: LandingEntry[]; head: LandingEntry | null }
  | { paused: true; by: LandingPauseBy[]; order: LandingEntry[] };

/** GET /api/landing's answer, flat beside ok. */
export interface LandingLineView { project: string; operatorPaused: boolean; mainRedHold: boolean; entries: LandingEntry[]; order: LandingOrder }

// Landing order, wave 5f: the authority journal's vocabulary (shared contract §1, §5). Pure types, no imports.
export interface LandingIdentity { id: number; project: string; pr: number }
export type LandingHistoricalBinding =
  | { kind: 'no-run' }
  | { kind: 'run'; observedRunId: number };
export interface LandingSubjectRef extends LandingIdentity {
  binding: LandingHistoricalBinding;
}
export interface LandingCreationClaim {
  at: number; setBy: string; pinnedSha: string; handoffCommit: string;
}
export interface LandingAuthority {
  afterIds: number[]; fixesMain: boolean; setBy: string; seq: number;
}
export type LandingJournalRecord = {
  v: 1; seq: number; at: number; setBy: string; subject: LandingSubjectRef;
} & (
  | { kind: 'entry'; claim: { pinnedSha: string; handoffCommit: string } }
  | { kind: 'order'; after: LandingSubjectRef[]; fixesMain: boolean }
);
export type LandingJournalInvalidReason =
  | 'empty' | 'blank' | 'torn' | 'json' | 'version' | 'kind'
  | 'fields' | 'sequence' | 'identity';
export type LandingRecoverySubject = LandingIdentity & {
  creation: { kind: 'recorded'; claim: LandingCreationClaim; seq: number }
    | { kind: 'not-recorded' };
  historical: { binding: LandingHistoricalBinding; observedSeq: number };
  projection: { kind: 'missing'; association: 'unmeasured' }
    | { kind: 'association-unmeasured'; reason: 'historical-binding-mismatch' }
    | { kind: 'identity-conflict'; conflicts: LandingIdentity[] };
  authority: { kind: 'set'; value: LandingAuthority } | { kind: 'not-set' };
};
export interface LandingRecovery {
  subjects: LandingRecoverySubject[];
  hold: null | { reason: 'landing-recovery-unresolved'; subjectIds: number[] };
}

export type LandingInfrastructureCode =
  | 'landing-journal-unavailable' | 'landing-journal-unreadable'
  | 'landing-journal-invalid' | 'landing-journal-missing'
  | 'landing-journal-cursor' | 'landing-journal-changed'
  | 'landing-journal-durability' | 'landing-journal-append'
  | 'landing-db-unavailable' | 'landing-db-apply' | 'landing-db-commit'
  | 'landing-fenced' | 'landing-projection-unreadable';
export interface LandingInfrastructureFailure {
  error: LandingInfrastructureCode;
  recovery: 'replay' | 'restart';
  mayApply?: true;
  invalid?: { reason: LandingJournalInvalidReason; record: number | null };
}
export type LandingMutationCode =
  | 'landing-entry-exists' | 'landing-entry-missing'
  | 'landing-after-missing' | 'landing-after-cross-project'
  | 'landing-cycle' | 'landing-dependencies-unreadable'
  | 'landing-recovery-unresolved' | 'landing-identity-conflict'
  | 'landing-id-overflow' | 'landing-sequence-overflow';
