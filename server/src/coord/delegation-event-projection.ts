// Delegation events retention (C5). Ring L1 policy: pure, clock-free (every instant is an argument), no I/O and no store.
// Spec `docs/superpowers/specs/2026-11-27-delegation-events-retention-design.md`, plan `docs/superpowers/plans/2026-11-27-delegation-events-retention.md`.
//
// D-9165: nothing reads `delegation_events`' rows; the lane reads every record from the journal. D-9167: so SQLite keeps only the
// KEPT CLASSES, and one rule decides which records it holds, for recovery, the applier, the repair's replay and the sweep alike:
//   - a record's CLASS, from its envelope (`delegationEventClassOf`), and the one table of kept classes;
//   - the CONTRACT, the one-row fact in `coord.db` that says what SQLite holds: `all` (every record, `main`'s behaviour), or `thin`
//     (the kept classes, plus the LEGACY rows the sweep has not reached: excluded records in [sweptBelow, legacyBelow));
//   - the AUTOMATIC STOP (D-9170): a mismatch the repair would fix by replay sends the contract back to `all` and records why; the stop
//     stands while the card row's `updatedAt` is the one it was made under, so only the operator's tap re-arms the lane;
//   - the SWEEP's batches, which halve themselves when one is slow, and the daily counts line.
// The journal, the checkpoint, the carried file and compaction are not this module's business: none of them changes.
import type { DelegationEventEnvelopeV1 } from '../../../shared/api.js';

/** A record's class. Closed; the order is the daily line's. Lane-internal: it never goes on the wire. */
export const DELEGATION_EVENT_CLASSES = ['bash-plain', 'bash-listed', 'bash-shed', 'agentic', 'subagent', 'session', 'prompt'] as const;
export type DelegationEventClass = (typeof DELEGATION_EVENT_CLASSES)[number];

/** THE ONE TABLE (D1 (a), the operator's ruling of 2026-11-27): which classes SQLite keeps while the lane is armed. Every Bash record
 *  is the lane's, read from the journal; extending this is a row, never a branch. */
export const DELEGATION_EVENT_CLASS_KEPT: Readonly<Record<DelegationEventClass, boolean>> = {
  'bash-plain': false, 'bash-listed': false, 'bash-shed': false, agentic: true, subagent: true, session: true, prompt: true,
};

/** The class of one record, from the fields the ingest validated: a Bash record with a `listing`, one `truncated` without (it may have
 *  shed one), or neither; an Agent, Task or Workflow call; a subagent's start or stop; a session's start or end; a task notification. */
export function delegationEventClassOf(e: DelegationEventEnvelopeV1): DelegationEventClass {
  switch (e.eventKind) {
    case 'PreToolUse':
    case 'PostToolUse':
      if (e.toolName !== 'Bash') return 'agentic';
      if (e.listing !== undefined) return 'bash-listed';
      return e.truncated === true ? 'bash-shed' : 'bash-plain';
    case 'SubagentStart':
    case 'SubagentStop':
      return 'subagent';
    case 'SessionStart':
    case 'SessionEnd':
      return 'session';
    case 'UserPromptSubmit':
      return 'prompt';
    default:
      return e satisfies never;
  }
}

/** Why the lane stopped itself (D-9170): the two answers of the repair that say SQLite and the rule disagree. `replay-from-start`: SQLite's
 *  count below its own maximum is not the held count, so the repair would replay from the first record. `rows-not-in-journal`: SQLite
 *  holds rows the held set does not, so the repair would wipe. Declared here and read by the repair (`delegation-db-projection.ts`). */
export const DELEGATION_EVENTS_STOP_REASONS = ['replay-from-start', 'rows-not-in-journal'] as const;
export type DelegationEventsStopReason = (typeof DELEGATION_EVENTS_STOP_REASONS)[number];
export const isDelegationEventsStopReason = (v: unknown): v is DelegationEventsStopReason =>
  typeof v === 'string' && (DELEGATION_EVENTS_STOP_REASONS as readonly string[]).includes(v);

/** What SQLite holds. `thin`: the kept classes, plus excluded records with `sweptBelow <= sequence < legacyBelow`. */
export type DelegationEventsContract =
  | { readonly mode: 'all' }
  | { readonly mode: 'thin'; readonly legacyBelow: number; readonly sweptBelow: number };

/** The automatic stop: when, why, the card row's `updatedAt` it was made under, and when its one notice was raised (null: not yet). */
export interface DelegationEventsStop {
  readonly at: number;
  readonly reason: DelegationEventsStopReason;
  readonly choiceAt: number | null;
  readonly noticedAt: number | null;
}

/** The contract row as the applier keeps it. */
export interface DelegationEventsRow { readonly contract: DelegationEventsContract; readonly stop: DelegationEventsStop | null }

/** Every record, no stop: the seed, `main`'s behaviour, and what doubt reads as. */
export const DELEGATION_EVENTS_ALL: DelegationEventsRow = Object.freeze({ contract: Object.freeze({ mode: 'all' as const }), stop: null });

/** The row's columns, as `CoordStore` reads and writes them (`delegation_events_projection`). */
export interface DelegationEventsColumns {
  readonly mode: string;
  readonly legacyBelow: number | null;
  readonly sweptBelow: number | null;
  readonly stoppedAt: number | null;
  readonly stopReason: string | null;
  readonly stopChoiceAt: number | null;
  readonly stopNoticedAt: number | null;
}

/** The store's raw read of the row (`CoordStore.delegationEventsRow`), declared here by its consumer: the columns as SQLite holds
 *  them, no row, or why the read failed. Never folded: an absent row and an unreadable one both keep every class, for two reasons. */
export type DelegationEventsRowRead =
  | { readonly kind: 'row'; readonly raw: Readonly<Record<string, unknown>> }
  | { readonly kind: 'absent' }
  | { readonly kind: 'unreadable'; readonly detail: string };

/** SQLite's page counts, for the daily line (`CoordStore.coordPageStats`). */
export interface DelegationEventsPageStats { readonly pageCount: number; readonly freelistCount: number; readonly pageSize: number }

const isCount = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const countOrNull = (v: unknown): boolean => v === null || isCount(v);

/** The ONE reading of a stored row. Anything this build cannot read as exactly one row is refused with the reason, never defaulted:
 *  the caller keeps every class over a refusal (doubt never thins the table). */
export function decodeDelegationEventsRow(raw: Readonly<Record<string, unknown>>):
  { readonly ok: true; readonly row: DelegationEventsRow } | { readonly ok: false; readonly detail: string } {
  let contract: DelegationEventsContract;
  if (raw.mode === 'all') contract = { mode: 'all' };
  else if (raw.mode === 'thin') {
    if (!isCount(raw.legacyBelow) || !isCount(raw.sweptBelow)) return { ok: false, detail: 'a thin row needs whole legacyBelow and sweptBelow' };
    contract = { mode: 'thin', legacyBelow: raw.legacyBelow, sweptBelow: raw.sweptBelow };
  } else return { ok: false, detail: `mode ${JSON.stringify(raw.mode)} is not all or thin` };
  if (raw.stoppedAt === null || raw.stoppedAt === undefined) return { ok: true, row: { contract, stop: null } };
  if (!isCount(raw.stoppedAt) || !isDelegationEventsStopReason(raw.stopReason) || !countOrNull(raw.stopChoiceAt ?? null) || !countOrNull(raw.stopNoticedAt ?? null)) {
    return { ok: false, detail: 'a stop needs a whole stoppedAt, a known stopReason and whole-or-null stopChoiceAt and stopNoticedAt' };
  }
  return { ok: true, row: { contract, stop: { at: raw.stoppedAt, reason: raw.stopReason, choiceAt: (raw.stopChoiceAt ?? null) as number | null, noticedAt: (raw.stopNoticedAt ?? null) as number | null } } };
}

/** The row's columns for the store's one UPDATE. The inverse of `decodeDelegationEventsRow`. */
export function encodeDelegationEventsRow(row: DelegationEventsRow): DelegationEventsColumns {
  const c = row.contract;
  const s = row.stop;
  return {
    mode: c.mode, legacyBelow: c.mode === 'thin' ? c.legacyBelow : null, sweptBelow: c.mode === 'thin' ? c.sweptBelow : null,
    stoppedAt: s?.at ?? null, stopReason: s?.reason ?? null, stopChoiceAt: s?.choiceAt ?? null, stopNoticedAt: s?.noticedAt ?? null,
  };
}

/** MEMBERSHIP: does SQLite hold this record under `contract`? */
export function delegationEventHeld(contract: DelegationEventsContract, sequence: number, cls: DelegationEventClass): boolean {
  if (contract.mode === 'all' || DELEGATION_EVENT_CLASS_KEPT[cls]) return true;
  return sequence >= contract.sweptBelow && sequence < contract.legacyBelow;
}

/** The card row's reading the lane hands over: Live or not (`laneArmRowViewOf(...).live`: an unreadable or absent row is not), and its
 *  write time. */
export interface DelegationEventsChoice { readonly live: boolean; readonly updatedAt: number | null }

/** A stop stands while the card row's write time is the one it was made under: every tap writes a new one (`CoordStore.setLaneArm`). */
export const delegationEventsStopStands = (stop: DelegationEventsStop | null, choice: DelegationEventsChoice): boolean =>
  stop !== null && stop.choiceAt === choice.updatedAt;

/** What the lane wants SQLite to hold: thin while the row reads Live and no stop stands against that choice. */
export function delegationEventsWant(choice: DelegationEventsChoice, stop: DelegationEventsStop | null): 'thin' | 'all' {
  return choice.live && !delegationEventsStopStands(stop, choice) ? 'thin' : 'all';
}

/** The contract's next row toward `want`, or null when it already says it. Arming makes every record SQLite holds now legacy (its
 *  `legacyBelow` is one past the last evidence sequence, its `sweptBelow` 0, so carried records below the journal are legacy too) and
 *  clears a stop; disarming keeps the stop's record. */
export function alignDelegationEvents(row: DelegationEventsRow, want: 'thin' | 'all', lastSequence: number | null): DelegationEventsRow | null {
  if (want === 'all') return row.contract.mode === 'all' ? null : { contract: DELEGATION_EVENTS_ALL.contract, stop: row.stop };
  if (row.contract.mode === 'thin') return null;
  return { contract: { mode: 'thin', legacyBelow: (lastSequence ?? 0) + 1, sweptBelow: 0 }, stop: null };
}

/** The stop (D-9170): every record again, with why, when, and the choice it was made under. The repair's mismatch decides it only
 *  under `thin`: under `all` the same answers are the repair's ordinary work. */
export function delegationEventsStopOf(contract: DelegationEventsContract, mismatch: DelegationEventsStopReason | null): DelegationEventsStopReason | null {
  return contract.mode === 'thin' ? mismatch : null;
}
export function stopDelegationEvents(reason: DelegationEventsStopReason, at: number, choiceAt: number | null): DelegationEventsRow {
  return { contract: DELEGATION_EVENTS_ALL.contract, stop: { at, reason, choiceAt, noticedAt: null } };
}
/** The row with its stop's notice marked, or null when there is no stop or it is already marked. */
export function noticedDelegationEvents(row: DelegationEventsRow, at: number): DelegationEventsRow | null {
  return row.stop === null || row.stop.noticedAt !== null ? null : { contract: row.contract, stop: { ...row.stop, noticedAt: at } };
}
/** The once-only feed key of a stop's notice. */
export const delegationEventsNoticeKey = (stoppedAt: number): string => `delegation-events-stopped:${stoppedAt}`;

/** THE SWEEP. The first batch, the bound past which a batch halves the next, the batches one pass may run, and the floor. */
export const DELEGATION_EVENTS_SWEEP_FIRST_BATCH = 1000;
export const DELEGATION_EVENTS_SWEEP_SLOW_MS = 100;
export const DELEGATION_EVENTS_SWEEP_BATCHES_PER_PASS = 20;
export const DELEGATION_EVENTS_SWEEP_MIN_BATCH = 1;

/** The next batch: halved (to the floor) when this one took MORE than the bound, else the same. It never grows back. */
export function nextDelegationSweepBatch(size: number, elapsedMs: number): number {
  return elapsedMs > DELEGATION_EVENTS_SWEEP_SLOW_MS ? Math.max(DELEGATION_EVENTS_SWEEP_MIN_BATCH, Math.floor(size / 2)) : size;
}

/** One batch: the lowest `size` legacy sequences (`legacy` is every one left, ascending) and the `sweptBelow` they reach: the next legacy
 *  sequence when some remain, else `legacyBelow`, which closes the window. Null when there is nothing to do. */
export function planDelegationEventSweep(contract: DelegationEventsContract, legacy: readonly number[], size: number):
  { readonly delete: readonly number[]; readonly sweptBelow: number } | null {
  if (contract.mode !== 'thin' || contract.sweptBelow >= contract.legacyBelow) return null;
  const take = legacy.slice(0, Math.max(DELEGATION_EVENTS_SWEEP_MIN_BATCH, size));
  const next = legacy[take.length];
  return { delete: take, sweptBelow: next === undefined ? contract.legacyBelow : next };
}

/** What the daily line reports, measured by the applier and the store. */
export interface DelegationEventsLineInput {
  readonly row: DelegationEventsRow;
  readonly held: number;
  readonly total: number;
  readonly byClass: Readonly<Record<DelegationEventClass, number>>;
  readonly legacyLeft: number;
  readonly pages: DelegationEventsPageStats | null;
}

/** The daily counts line (D-9170: the measurement a shadow phase would have given). */
export function delegationEventsLine(i: DelegationEventsLineInput): string {
  const stop = i.row.stop === null ? '' : ` stopped ${i.row.stop.reason} at ${new Date(i.row.stop.at).toISOString()}`;
  const classes = DELEGATION_EVENT_CLASSES.map((c) => `${c}=${i.byClass[c]}`).join(',');
  const pages = i.pages === null ? 'pages unmeasured' : `freelist ${i.pages.freelistCount} of ${i.pages.pageCount} pages of ${i.pages.pageSize} bytes`;
  return `ccrc-server: delegation events: mode ${i.row.contract.mode}${stop}; held ${i.held} of ${i.total} evidence records; by class ${classes}; legacy left ${i.legacyLeft}; ${pages}`;
}

/** Every kebab word this file spells, for `mail-routes.test.ts`'s scan of `server/src/coord`: derived from the tables above, never
 *  re-spelled. None is a mail rejection or a run refusal. */
export function isDelegationEventProjectionKebab(v: string): boolean {
  return (DELEGATION_EVENT_CLASSES as readonly string[]).includes(v) || isDelegationEventsStopReason(v) || v === 'delegation-events-stopped';
}
