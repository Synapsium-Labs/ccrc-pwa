// The session header's view (W2 Task S7a, D-5471): everything `SessionHeader` shows, derived in one pure function.
//
// Both skins' session chrome render from this (Refined's short header, S7c; Instrument's header row, S12), so a word,
// a chip or its order changes in one place. It is the header's own derivation moved out, not a second one: the bucket
// and its `dead` override, the status word, the chips in the order the header draws them, the ⋯ menu's items
// (`sessionMenu`, the menu's own reader, each with its command id) and Stop's state. The hooks stay in the part: it
// passes the clock (`now`, ticking at `headerTickMs`) and the pointer query (`finePointer`) in.
import {
  backgroundWork, backgroundWords, sessionWithCoordinator, withCoordinatorWords,
  type FleetSession, type PrState, type RosterWire, type RouteField, type SessionBucket, type SessionStatus,
} from '../../../shared/api';
import { restartWords, type RestartWords } from '../lib/restart';
import { accountLabel } from '../lib/accounts';
import { sessionLabel } from '../fleet/sessionLabel';
import { hibernatedSince } from '../fleet/hibernated';
import { headerStatusWord } from '../fleet/sessionFacts';
import type { Coordination } from '../fleet/fleetTree';
import type { SessionFactSet } from '../fleet/sessionFacts';
import { hasPrCap } from './PrKeycap';
import { liveStatus } from './liveStatus';
import { sessionMenu, type SessionMenuEntry } from './SessionFlows';

export interface SessionHeaderViewInput {
  session: FleetSession | null;
  status: SessionStatus | null;
  statusUpdatedAt: number | null;
  queuedField?: RouteField | null;
  fallback?: { title: string; crumb?: string | null; wrapper: string };
  roster?: readonly RosterWire[];
  repo?: string | null;
  coordination?: Coordination | null;
  facts?: SessionFactSet | null;
  /** The part's clock (`useNow(headerTickMs(…))`). */
  now: number;
  /** `(pointer: fine)`: where a physical Escape key exists the Stop cap is absent. */
  finePointer: boolean;
}

/** The status strip's four tints (chat.css's `status-line--*`). */
export type StatusVariant = 'attention' | 'idle' | 'busy' | 'dead';

/** One chip of the header, in the order the header draws it. */
export type HeaderChip =
  /** D-5527: who this session works for, under the name (`SessionCoordination`). */
  | { kind: 'coordination'; facts: SessionFactSet; coordination: Coordination | null }
  | {
    kind: 'status'; bucket: SessionBucket; asleep: boolean; variant: StatusVariant; word: string;
    /** D-5296: `with coordinator · <parent>` replaces the word. */
    coordinator: { short: string } | null; title: string | undefined;
  }
  | { kind: 'lane'; text: string; title: string | undefined }
  | { kind: 'restart'; text: string; title: string; cause: RestartWords['cause'] }
  | { kind: 'repo'; text: string }
  /** `parts` are the words as the chip draws them, `archived` then ` · merged #N` (two text runs, as main draws them,
   *  so the extraction moves no pixel); `text` is them joined. */
  | { kind: 'archived'; text: string; parts: readonly string[] }
  /** `text: null` is a queued `class` write before the pane has a model string: the bare `queued` badge alone. */
  | { kind: 'model'; text: string | null; queued: boolean }
  | { kind: 'effort'; text: string; ultra: boolean; queued: boolean }
  | { kind: 'branch'; text: string }
  /** D-5545: every other fact (the context fact among them), `SessionDetails`. */
  | { kind: 'details'; facts: SessionFactSet; coordination: Coordination | null }
  /** A workspace's PR cap (`hasPrCap`); `pr: null` is a PR not checked yet. */
  | { kind: 'pr'; pr: PrState | null };

export type HeaderChipKind = HeaderChip['kind'];

export interface SessionHeaderView {
  title: string;
  crumb: string | null;
  /** The title and crumb are a present workspace row's, so a change to them is a rename, which types in. False before
   *  the first fleet frame (the fallback) and for a main checkout, so a swap between the fallback and the row draws
   *  plainly rather than typing in as a rename that never happened (desktop polish T3c, D-6333). */
  renames: boolean;
  chips: HeaderChip[];
  /** The ⋯ menu's items, each with its command id: `sessionMenu`, the one reader the menu sheet renders. */
  menu: SessionMenuEntry[];
  /** The interrupt: shown where no Escape key exists, enabled only while the LIVE status is busy. */
  stop: { shown: boolean; enabled: boolean };
}

// THE bucket — the server's, never this header's. It used to OR `dialogPending`/`hookState` into an `attention` of its
// own, which is the second writer §1 of the spec forbids and which made the two screens contradict each other from ONE
// snapshot: a `done` session read `finished` on its fleet row and `idle` here; a `cleanup` one read "merged, ready to
// clean up" there and "not running" here.
//
// The fallback is not a re-derivation: on a deep link, before /ws/fleet lands, there IS no bucket — only the live
// stream's status — so it is translated into the same vocabulary ('busy' -> 'working'; idle and dead spell the same
// word in both) purely so the strip can paint something.
//
// And neither is the `dead` override. This screen holds a LIVE stream for one session; the fleet snapshot is up to a
// tick behind it. Making the header snapshot-first (Task 6) dropped the override entirely, so a session whose own
// stream has already reported it dead kept pulsing amber "waiting on you" — the header contradicting the socket it is
// attached to, over the one state that asks the reader to act on a process that is gone. It only ever DEMOTES: `dead`
// is never manufactured into attention, and the bucket the server chose is what paints in every other case. Archived
// rows are exempt because `ws-archive` stops the session by construction — `dead` is true of every one of them, and
// saying "not running" there would bury `cleanup`'s merge facts under a liveness fact nobody is waiting on.
function headerBucket(st: SessionStatus | null, session: FleetSession | null): SessionBucket | null {
  const snapshotBucket = session?.bucket ?? null;
  return st === 'dead' && session != null && session.archivedAt == null
    ? 'dead'
    : snapshotBucket ?? (st === null ? null : st === 'busy' ? 'working' : st);
}

/** How often the part's clock ticks: every second while `working` (the live elapsed clock), else every 30s. */
export function headerTickMs(status: SessionStatus | null, session: FleetSession | null): number {
  return headerBucket(liveStatus(status, session), session) === 'working' ? 1_000 : 30_000;
}

/**
 * The words of the quiet state, gated (D-5296, D-6325): `withCoordinatorWords` for a row whose parent holds its
 * question, and only while the row's bucket reads `working`. THE ONE DERIVATION: the header's chip and the ask
 * surface's "held" line both read it, so a `dead` or `idle` row that keeps a stale `withCoordinator` shows neither.
 * `status` is the live stream's, as the header receives it (`liveStatus` and `headerBucket` give the bucket).
 */
export function heldCoordinatorWords(
  session: FleetSession | null, status: SessionStatus | null,
): ReturnType<typeof withCoordinatorWords> | null {
  const bucket = headerBucket(liveStatus(status, session), session);
  const wc = bucket === 'working' && session != null ? sessionWithCoordinator(session) : null;
  return wc === null || session == null ? null : withCoordinatorWords(wc, session.project);
}

/** What a deep link's header shows before the first fleet frame names the session (desktop polish T3c, D-6333): the
 *  same words the row will give, so the title does not jump when the frame lands. Ids carry no colon: a workspace is
 *  `<project>-<slug>` (ccd's `$project-$slug`) and a main checkout `<lane>-<project>`, so the id is split only by a
 *  name the fleet KNOWS, never guessed.
 *   1. The longest roster id that prefixes the id is the lane of a main checkout: titled by its project, no crumb.
 *   2. Else the longest known project that prefixes it makes the id a workspace: `ws/<slug>` (the label a born
 *      workspace's branch gives, `sessionLabel`) under that project.
 *   3. Else `today`: what the screen showed before this, unchanged. */
export function deepLinkFallback(
  id: string, roster: readonly Pick<RosterWire, 'id'>[], projects: readonly { name: string }[] | null,
  today: { title: string; wrapper: string },
): { title: string; crumb: string | null; wrapper: string } {
  const longest = (names: readonly string[]): string | null => names
    .filter((n) => n !== '' && id.startsWith(`${n}-`) && id.length > n.length + 1)
    .reduce<string | null>((best, n) => (best === null || n.length > best.length ? n : best), null);
  const lane = longest(roster.map((a) => a.id));
  if (lane !== null) return { title: id.slice(lane.length + 1), crumb: null, wrapper: lane };
  const project = longest((projects ?? []).map((p) => p.name));
  if (project !== null) return { title: `ws/${id.slice(project.length + 1)}`, crumb: project, wrapper: today.wrapper };
  return { title: today.title, crumb: null, wrapper: today.wrapper };
}

export function sessionHeaderView({
  session, status, statusUpdatedAt, queuedField = null, fallback, roster = [], repo = null, coordination = null,
  facts = null, now, finePointer,
}: SessionHeaderViewInput): SessionHeaderView {
  // Live stream status wins; the fleet snapshot fills in before it connects (`liveStatus`, the screen's one derivation).
  const st: SessionStatus | null = liveStatus(status, session);
  const at = statusUpdatedAt ?? session?.statusUpdatedAt ?? null;
  const bucket = headerBucket(st, session);
  // D-5242: a `dead` row `ccd hibernate` put to sleep reads `hibernated` beside the calm dot, never "✕ not running":
  // this screen wakes it on open (SessionScreen), and "not running" above "Waking…" would contradict it. Read off the
  // ROW (`hibernatedSince`, both halves), the same fact the wake trigger reads; the dead override above stays.
  const asleepAt = bucket === 'dead' && session != null ? hibernatedSince(session) : null;

  // `working` drives the visible clock's tempo; `busy` (the LIVE status, not the snapshot's bucket) stays the gate on
  // interrupting, because stopping a turn is a fact about the process right now, not about how the fleet last filed it.
  const working = bucket === 'working';
  const busy = st === 'busy';

  // D-5231: a `working` row whose last main Stop left delegated work running reads `working · N in background` (the
  // kinds in the title), as the card does.
  const bg = bucket === 'working' && session != null ? backgroundWork(session) : null;
  const bgWords = bg === null ? null : backgroundWords(bg);
  // D-5296: a `working` row whose parent holds its question reads `with coordinator · <parent>`, in the calm (idle)
  // tint, as the card does. The dialog stays answerable from this screen: nothing here gates it.
  const wcWords = heldCoordinatorWords(session, status);
  // D-5237: "restarted · out of memory · 3m ago" for an hour after a process end.
  const restart = session != null ? restartWords(session, now) : null;
  // D-5545 (verifier round 1): the word is the MODEL's (`headerStatusWord`), from the bucket this strip paints — it
  // always begins with the card's word (`exited` on both; the lamp still speaks `not running`), adding only what this
  // screen knows: the live clock, the age, `on you`, `ready to clean up`.
  const word = bucket === null ? '' : headerStatusWord({ bucket, asleepAt, background: bgWords, at, now });
  // Four tints for seven buckets, on purpose: `status-line--*` is the existing, contrast-verified set (chat.css) and
  // the glyph already carries the distinction colour must not carry alone. done/cleanup/archived take idle's matte
  // ink, exactly as their dots do (StatusDot's table).
  const variant: StatusVariant =
    bucket === 'attention' ? 'attention' : wcWords !== null || asleepAt !== null ? 'idle' : working ? 'busy' : bucket === 'dead' ? 'dead' : 'idle';

  // The session is the title (desktop polish T3c, D-6333): a workspace is named by its row's label, `sessionLabel`, the
  // same words its fleet row shows, and the project is the crumb before it, so two workspaces of one project read
  // apart. A main checkout IS the project's checkout: its title stays the project and there is no crumb.
  const workspace = session !== null && session.workspace !== null;
  const title = session === null ? (fallback?.title ?? '…') : workspace ? sessionLabel(session) : session.project;
  const crumb = session === null ? (fallback?.crumb ?? null) : workspace ? session.project : null;
  const wrapper = session?.wrapper ?? fallback?.wrapper ?? '';

  // Model / effort / ultracode / branch — read from the pane statusline the server already parses.
  const model = session?.model ?? null;
  const effort = session?.effort ?? null;
  const ultracode = session?.ultracode ?? false;
  const branch = session?.branch ?? null;
  const hasMeta = st !== 'dead' && (model !== null || branch !== null || effort !== null || ultracode);
  // With no chosen `name`, sessionLabel()'s fallback chain lands on `branch` — so the title above and this chip would
  // print the identical string a few pixels apart. Compare the actual rendered text (title vs branch), not the fields
  // that produced them, so the two can never disagree about what "duplicate" means. A workspace's only: a main
  // checkout's title is its project, which says nothing about its branch.
  const branchDuplicatesTitle = workspace && branch === title;

  const chips: HeaderChip[] = [];
  if (facts !== null) chips.push({ kind: 'coordination', facts, coordination });
  if (bucket !== null) {
    chips.push({
      kind: 'status', bucket, asleep: asleepAt !== null, variant, word,
      coordinator: wcWords === null ? null : { short: wcWords.short }, title: wcWords?.title ?? bgWords?.title,
    });
  }
  if (wrapper !== '') chips.push({ kind: 'lane', text: accountLabel(roster, wrapper), title: facts?.lane.label });
  if (restart !== null) chips.push({ kind: 'restart', text: restart.text, title: restart.title, cause: restart.cause });
  if (repo !== null) chips.push({ kind: 'repo', text: repo });
  // Derived from archivedAt, never from pr.phase — merging archives nothing, so a merged PR sits on a live workspace
  // until a human archives it, and must not claim the chip meanwhile.
  if (session?.archivedAt != null) {
    const parts = session.pr?.number != null ? ['archived', ` · merged #${session.pr.number}`] : ['archived'];
    chips.push({ kind: 'archived', text: parts.join(''), parts });
  }
  if (hasMeta) {
    // The model chip is gated on a model string; a queued `class` write on a freshly spawned session (no model on the
    // pane yet) still shows its `queued` badge, alone, in the chip's place.
    if (model !== null || queuedField === 'class') chips.push({ kind: 'model', text: model, queued: queuedField === 'class' });
    chips.push({ kind: 'effort', text: ultracode ? 'ultracode' : (effort ?? 'set effort'), ultra: ultracode, queued: queuedField === 'effort' });
    if (branch !== null && !branchDuplicatesTitle) chips.push({ kind: 'branch', text: branch });
  }
  if (facts !== null) chips.push({ kind: 'details', facts, coordination });
  if (hasPrCap(session)) chips.push({ kind: 'pr', pr: session.pr });

  return { title, crumb, renames: workspace, chips, menu: sessionMenu(session), stop: { shown: !finePointer, enabled: busy } };
}
