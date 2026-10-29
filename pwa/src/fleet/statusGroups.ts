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
//
// THE STATUS VIEW (Task G3, D-7333; programme-boxes spec §2.7). `statusView` is the groups Instrument's Status view
// draws, given the fleet's tree: a coordinator's open work is its programme's box (G2's `programmeBoxes`, over each
// card the tree built), and a child never draws as a row of its own. A box's members are its children on its own card
// and its far workers on others (a card's `elsewhere` row whose claimant is a box): hidden, and drawn in the box's tray
// only while they ask the operator (`operatorAsk`) or the operator has one open (G3's Step 0 ruling). A worker whose claimant is a
// box nowhere (the coordinator gone, or in a fold) stays a row of its own, so nothing is lost (the same ruling); so does every
// row the tree does not draw (Released, Archived). The groups: Needs you (the boxes that need the operator, then the
// rows in no programme that do), Programmes (the other boxes, in `boxOrder`), then `groupByStatus` over the rows in no
// programme. Every group counts what it draws: a box counts one, and a hidden child counts nowhere.
import { sessionAsk, substrateFault, type FleetSession, type SessionBucket } from '../../../shared/api';
import { isUnseen, type Acks } from '../lib/seen';
import type { FleetTreeGroup } from './fleetTree';
import type { FleetRow } from './nestFleet';
import {
  boxNeeds, boxOrder, boxState, programmeBoxes, rowRun, type BoxState, type ProgHue, type ProgrammeBoxView, type Tray,
} from './programmeBoxes';
import { operatorAsk } from './rollup';
import { sortFleet } from './sortFleet';

/** Why a Needs-you session needs you. `null` is "no field says", never a fifth reason. */
export type NeedsReason = 'ask' | 'allow' | 'fault' | 'sign-in';

/** The table's order, its headings and which groups fold. A `Record`, so a new
 *  `SessionBucket` member is a compile error here, never a silently missing group. */
export const STATUS_GROUPS: Record<SessionBucket, { readonly order: number; readonly label: string; readonly folds: boolean }> = {
  attention: { order: 0, label: 'Needs you', folds: false },
  done: { order: 1, label: 'Done', folds: false },
  working: { order: 2, label: 'Working', folds: false },
  idle: { order: 3, label: 'Idle', folds: true },
  cleanup: { order: 4, label: 'Cleanup', folds: true },
  archived: { order: 5, label: 'Archived', folds: true },
  dead: { order: 6, label: 'Exited', folds: true },
};

const ORDER: readonly SessionBucket[] =
  (Object.keys(STATUS_GROUPS) as SessionBucket[]).sort((a, b) => STATUS_GROUPS[a].order - STATUS_GROUPS[b].order);

/** The Status view's one group that is not a bucket (Task G3): the programme boxes that do not need the operator, just
 *  after Needs you. Open, like the groups the operator reads first. */
export const PROGRAMMES_GROUP = { order: 0.5, label: 'Programmes', folds: false } as const;

export interface StatusGroup {
  bucket: SessionBucket;
  label: string;
  /** In `sortFleet`'s order. */
  sessions: FleetSession[];
  /** Counted with `isUnseen`, the reader `BucketBar` and `groupFleet` use: its
   *  BADGED precondition means an Idle, Working, Archived or Exited row never counts. */
  unseen: number;
  /** Folded by default (Idle, Cleanup, Archived, Exited). */
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

/** A Status view group's key: a bucket, or the programmes. */
export type StatusGroupId = SessionBucket | 'programmes';

/** The groups' order: the buckets', with Programmes at its own place among them. */
const VIEW_ORDER: readonly StatusGroupId[] = [...ORDER, 'programmes' as const]
  .sort((a, b) => viewGroup(a).order - viewGroup(b).order);

function viewGroup(id: StatusGroupId): { readonly order: number; readonly label: string; readonly folds: boolean } {
  return id === 'programmes' ? PROGRAMMES_GROUP : STATUS_GROUPS[id];
}

/** A group's heading: the bucket's, or Programmes. */
export const statusGroupLabel = (id: StatusGroupId): string => viewGroup(id).label;

/** A programme box as the Status view draws it: G2's view and state, the project card it belongs to (its kicker names
 *  it), and its tray, the members that ask the operator. The box does not fold and has no footer. */
export interface StatusBox {
  readonly view: ProgrammeBoxView;
  readonly state: BoxState;
  readonly project: string;
  /** G2's tray shape with no summary row, so the box draws no footer. */
  readonly tray: Tray;
  /** Each tray row's own programme hue, by session id: the lead's, or another of this coordinator's programmes'. */
  readonly hues: ReadonlyMap<string, ProgHue>;
}

export interface StatusViewGroup {
  readonly id: StatusGroupId;
  readonly label: string;
  /** In `boxOrder`, the tree's card order within a rank. */
  readonly boxes: readonly StatusBox[];
  /** The rows in no programme, in `sortFleet`'s order. */
  readonly sessions: readonly FleetSession[];
  /** What the group draws: each box as one, each row as one. */
  readonly count: number;
  /** What Mark all seen acks, and `unseen` counts: what the group draws, each box's coordinator and tray, then the rows
   *  in no programme. */
  readonly seen: readonly FleetSession[];
  readonly unseen: number;
  readonly folds: boolean;
  /** Held open whatever is stored: Needs you while it draws anything (the fleet rollup's rule 5, D-6088). */
  readonly held: boolean;
}

const rowSession = (r: FleetRow): FleetSession | null => (r.kind === 'session' ? r.session : null);

/** The Status view's groups, every one in the fixed order, an empty one kept with a count of 0 (the view decides
 *  whether to show it). `tree` is the fleet's cards (`fleetTree`); movement is not wired yet (Task G1), so no box reads
 *  stalled and Programmes is in the tree's order. `selectedId` is the session the operator has open: a member keeps its
 *  place in its box's tray while open, by `foldChildren`'s own rule (G3's Step 0 ruling), and makes the box need nothing. */
export function statusView(
  sessions: readonly FleetSession[], tree: readonly FleetTreeGroup[], acks: Acks, selectedId: string | null,
): StatusViewGroup[] {
  const cards = tree.map((g) => ({
    project: g.project, runs: [...g.runs, ...g.claimed], prog: programmeBoxes(g.rows, g.runs, g.claimed, () => null, g.hues),
  }));
  // Each box's members: its children on its own card, and its far workers, rows of other cards' `elsewhere`. Each is
  // read on the card that draws it, with the hue of the programme it works for. A spawn is no member: the Status view
  // draws sessions only.
  const heads = new Set(cards.flatMap(({ prog }) => prog.boxes.map((b) => b.coordinatorId)));
  const members = new Map<string, { session: FleetSession; hue: ProgHue | undefined }[]>();
  // A box's own children first, then its far workers, each in its card's order.
  const placed = [
    ...cards.flatMap((c) => c.prog.boxes.flatMap((b) => b.children.map((row) => [c, b.coordinatorId, row] as const))),
    ...cards.flatMap((c) => c.prog.elsewhere.map((row) => [c, rowRun(row, c.runs)?.claimedBy ?? null, row] as const)),
  ];
  for (const [{ runs, prog }, by, row] of placed) {
    if (by === null || !heads.has(by) || row.kind !== 'session') continue;
    const member = { session: row.session, hue: prog.hues.get(rowRun(row, runs)?.program ?? '') };
    members.set(by, [...(members.get(by) ?? []), member]);
  }
  // Drawn by a box: its coordinator, as its head, and every member, in its tray or nowhere.
  const inBox = new Set([...heads, ...[...members.values()].flat().map((m) => m.session.id)]);
  const boxes = cards.flatMap(({ project, prog }) => prog.boxes.map((view): StatusBox => {
    const mine = members.get(view.coordinatorId) ?? [];
    const drawn = mine.filter((m) => operatorAsk(m.session) || m.session.id === selectedId);
    return {
      view, project,
      tray: { rows: drawn.map((m): FleetRow => ({ kind: 'session', depth: 1, session: m.session })), summary: null },
      hues: new Map(drawn.flatMap((m) => (m.hue === undefined ? [] : [[m.session.id, m.hue] as const]))),
      state: boxState(view, boxNeeds(view) || mine.some((m) => operatorAsk(m.session)), 0, null, false),
    };
  })).sort(boxOrder);
  const lone = sessions.filter((s) => !inBox.has(s.id));
  const byBucket = new Map(groupByStatus(lone, acks).map((g) => [g.bucket, g] as const));

  return VIEW_ORDER.map((id) => {
    const { label, folds } = viewGroup(id);
    const inBoxes = id === 'programmes' ? boxes.filter((b) => b.state !== 'needs')
      : id === 'attention' ? boxes.filter((b) => b.state === 'needs') : [];
    const rows = id === 'programmes' ? [] : byBucket.get(id)?.sessions ?? [];
    const seen = [
      ...inBoxes.flatMap((b) => [b.view.coordinator, ...b.tray.rows.map(rowSession).filter((s): s is FleetSession => s !== null)]),
      ...rows,
    ];
    const count = inBoxes.length + rows.length;
    return {
      id, label, boxes: inBoxes, sessions: rows, count, seen,
      unseen: seen.filter((s) => isUnseen(s, acks)).length,
      folds, held: id === 'attention' && count > 0,
    };
  });
}

/** Everything the Status view draws, the All tab's count: the sum of its groups' counts. */
export const statusViewTotal = (groups: readonly StatusViewGroup[]): number =>
  groups.reduce((n, g) => n + g.count, 0);
