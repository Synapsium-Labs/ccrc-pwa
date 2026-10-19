// The status grouping and the needs-you reason, as a pure model (D-5473).
//
// Instrument's status-grouped table (S10) and the reason tags on Needs-you
// rows (W3's U1) both read this file; neither computes a group, a count or a
// reason itself. Nothing here renders.
//
// THE BUCKET IS THE SERVER'S. Every group is a straight read of `s.bucket`,
// which `shared/api.ts`'s `sessionBucket` decides once, server-side. This model
// never re-derives it from `dialogPending`, `hookState` or `status`: a killed
// session can still carry `dialogPending`, and the ladder files it under
// `dead` (FleetScreen's own comment says the same), so a client-side
// derivation would put a corpse in Needs you.
//
// STEP 0, THE FIELD MAP for `needsReason` (D-5497). Each reason, the
// `FleetSession` field that carries it, and the server code that sets it:
//
//   fault    `substrate`, read through `substrateFault` (shared/api.ts).
//            ccd's `cmd_supervise` writes `$REG/<id>.substrate` while tmux
//            answers neither live nor gone; `server/src/fleet.ts`'s
//            `assembleFleet` carries it onto the wire (epoch ms, the reason
//            verbatim; `at: 0` for a marker it could see and not read).
//   ask      `ask` in state `held` (or `answering`, which the server folds onto
//            held), read through `sessionAsk`. `fleet.ts` folds the newest
//            `asks` row (`CoordStore`) for the session; those rows are minted
//            for questions only today (`fleetWithCoordinator` answers
//            `kind: 'question'` for every one), so a held row proves the open
//            dialog is a question. `answered` does not: it explains a ruling
//            already made, not the dialog that is open now.
//   allow    NO FIELD. A permission prompt reaches the wire only as
//            `dialogPending`, `hookState: 'waiting'` and an `askSummary`
//            string; the hook's ask envelope (questions or approval) and the
//            live file's `waitingFor` word stay on the server. Parsing
//            `askSummary` (an approval reads `tool: summary`) would be a
//            guess, since a question's header can carry a colon too.
//            `withCoordinator.kind` does name an approval, but only on a held
//            row, which the ladder files under `working`, never Needs you.
//   sign-in  NO FIELD. Nothing on `FleetSession` says a session is blocked on
//            its account's sign-in.
//
// So `allow` and `sign-in` are in the answer's type, for the tags W3 renders,
// and this model answers neither until the server carries a field for them.
// A session the fields cannot place answers `null`, never a guessed reason.
import { sessionAsk, substrateFault, type FleetSession, type SessionBucket } from '../../../shared/api';
import { isUnseen, type Acks } from '../lib/seen';
import { sortFleet } from './sortFleet';

/** Why a Needs-you session needs you. `null` is "no field says", never a fifth reason. */
export type NeedsReason = 'ask' | 'allow' | 'fault' | 'sign-in';

/** The table's order, its headings and which groups fold. A `Record`, so a new
 *  `SessionBucket` member is a compile error here, never a silently missing group. */
export const STATUS_GROUPS: Record<SessionBucket, { readonly order: number; readonly label: string; readonly folds: boolean }> = {
  attention: { order: 0, label: 'Needs you', folds: false },
  working: { order: 1, label: 'Working', folds: false },
  done: { order: 2, label: 'Done', folds: false },
  idle: { order: 3, label: 'Idle', folds: true },
  cleanup: { order: 4, label: 'Cleanup', folds: true },
  archived: { order: 5, label: 'Archived', folds: true },
  dead: { order: 6, label: 'Dead', folds: true },
};

const ORDER: readonly SessionBucket[] =
  (Object.keys(STATUS_GROUPS) as SessionBucket[]).sort((a, b) => STATUS_GROUPS[a].order - STATUS_GROUPS[b].order);

export interface StatusGroup {
  bucket: SessionBucket;
  label: string;
  /** In `sortFleet`'s order. */
  sessions: FleetSession[];
  /** Counted with `isUnseen`, the reader `BucketBar` and `groupFleet` use: its
   *  BADGED precondition means an Idle, Working, Archived or Dead row never counts. */
  unseen: number;
  /** Folded by default (Idle, Cleanup, Archived, Dead). */
  folds: boolean;
}

/** Every bucket's group, in the fixed order. An empty group is kept with a
 *  count of 0; the view decides whether to show it. */
export function groupByStatus(sessions: readonly FleetSession[], acks: Acks): StatusGroup[] {
  const sorted = sortFleet([...sessions]);
  return ORDER.map((bucket) => {
    const rows = sorted.filter((s) => s.bucket === bucket);
    return {
      bucket,
      label: STATUS_GROUPS[bucket].label,
      sessions: rows,
      unseen: rows.filter((s) => isUnseen(s, acks)).length,
      folds: STATUS_GROUPS[bucket].folds,
    };
  });
}

/** Why a Needs-you session needs you, from the fields the header's map names
 *  (D-5497). A session outside Needs you answers `null`: the tag is a Needs-you
 *  row's. A fault outranks an ask, since the console cannot re-measure a row
 *  whose substrate is faulted. */
export function needsReason(s: FleetSession): NeedsReason | null {
  if (s.bucket !== 'attention') return null;
  if (substrateFault(s) !== null) return 'fault';
  const ask = sessionAsk(s);
  if (ask !== null && (ask.state === 'held' || ask.state === 'answering')) return 'ask';
  return null;
}
