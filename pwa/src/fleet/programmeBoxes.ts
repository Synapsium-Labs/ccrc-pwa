// THE PROGRAMME BOX (Task G2): a coordinator's open work, seen as one thing inside its project card. Pure (L1): the
// card hands it its rows and the runs, and draws the answer; nothing here renders, reads storage or reads the clock.
// Named for its main export, `programmeBoxes`: `programmeBox.ts` beside `ProgrammeBox.tsx` (the component) would be two
// modules a case-insensitive disk cannot tell apart (drawer-keybar.test.tsx's census).
//
// MEMBERS. A box is a session on this card that claims an open run of another session (or of a spawn not yet
// bound): its children are the rows `nestFleet` brackets under it, unchanged, and its far workers (`abroad`) are the
// runs it claims whose worker renders on another card (`fleetTree`'s `claimed`, by `runCard`). A claimed run whose
// worker reaches this card without being a row of it (in its Released or Archived fold, or gone) is no far worker. ONE box per coordinator session: a coordinator holding open
// runs of two programmes is led by the one with the most open work runs, a tie going to the newest run, and says
// `more`. A coordinator with no open run is an ordinary row (`lone`). A worker whose claimant is not a box here, and
// a spawn whose claimant is not on this card, is `elsewhere`: its programme's box is not on this card.
//
// STATE. `boxState` is one decider, in this order: needs (a drawn member is the operator's ask, `operatorAsk`), the
// operator's pause, stalled (no move within the stall watch's quiet threshold), moving. Movement is an INPUT
// (`lastMoveOf`, the run's last move, the threshold and the card's clock): `cardBoxes` reads the moves by `runLastMove`,
// and the card hands it the runs frame's `stallQuietMs`, the coord frame's pause and the list's clock (Task G1b,
// D-7380). `nextStallBoundary` is the next instant a box crosses that threshold, which the list's one timer wakes at
// (`useRollupClock`).
//
// HUE. Each programme carries one of four cool hues (`assignHues`): the `--prog-*` aliases of the lane hues, always
// beside the programme's title in words. The map is the FLEET's (`fleetHues`), assigned once per runs frame over every
// open programme, so a programme keeps one hue on every card and in every view; a card is handed its own entries.
import type { FleetSession, RunState, RunSummary } from '../../../shared/api';
import { fleetRowKey, type FleetRow } from './nestFleet';
import { formatReset } from './formatReset';
import { isDelegated, isWorker, operatorAsk, summaryParts, type RolledRow } from './rollup';
import { delegationParts } from './delegationWords';
import { RUN_WORD, boundOpenRun, claimedRunsOf, programWave, programmeTitle, runLastMove } from './runWords';

export const PROG_HUES = ['cyan', 'violet', 'magenta', 'blue'] as const;
export type ProgHue = (typeof PROG_HUES)[number];

/** FNV-1a, 32-bit, over the slug's UTF-8 bytes. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(s)) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return h;
}

/** Each slug's hue: its preferred one (FNV-1a modulo 4), or, when a slug before it in sorted order took that, the
 *  next one in `PROG_HUES` order that fewest slugs hold. Past four slugs a hue repeats, from the preferred one. Pure
 *  and stable: the same set of slugs gives the same map, whatever its order. */
export function assignHues(slugs: readonly string[]): ReadonlyMap<string, ProgHue> {
  const uses = PROG_HUES.map(() => 0);
  const out = new Map<string, ProgHue>();
  for (const slug of [...new Set(slugs)].sort()) {
    const first = fnv1a(slug) % PROG_HUES.length;
    let pick = first;
    for (let k = 1; k < PROG_HUES.length; k += 1) {
      const i = (first + k) % PROG_HUES.length;
      if (uses[i]! < uses[pick]!) pick = i;
    }
    uses[pick]! += 1;
    out.set(slug, PROG_HUES[pick]!);
  }
  return out;
}

/** The fleet's one hue map: `assignHues` over every open programme in the runs frame. A programme's hue changes only
 *  when the fleet's set of open programmes does, never with what another card holds. */
export const fleetHues = (runs: readonly RunSummary[]): ReadonlyMap<string, ProgHue> => assignHues(runs.map((r) => r.program));

/** A card's entries of the fleet's map: the programmes of `runs`, the runs the card can know of, in slug order. */
export function cardHues(fleet: ReadonlyMap<string, ProgHue>, runs: readonly RunSummary[]): ReadonlyMap<string, ProgHue> {
  const out = new Map<string, ProgHue>();
  for (const slug of [...new Set(runs.map((r) => r.program))].sort()) {
    const hue = fleet.get(slug);
    if (hue !== undefined) out.set(slug, hue);
  }
  return out;
}

export type BoxState = 'needs' | 'stalled' | 'moving' | 'paused';

export interface ProgrammeBoxView {
  coordinatorId: string;
  /** The coordinator's own session, the box's first row. */
  coordinator: FleetSession;
  lead: { slug: string; title: string; hue: ProgHue };
  /** How many other programmes this coordinator holds open runs of. */
  more: number;
  progress: { wave: number; waveOf: number | null };
  /** `nestFleet`'s rows under the coordinator, every one of them; the fold is the rollup's (`foldChildren`). */
  children: readonly FleetRow[];
  /** The runs it claims whose worker renders on another card. */
  abroad: readonly RunSummary[];
  lastMoveAt: number | null;
  waiting: 'awaiting-review' | 'merging' | null;
}

export interface ProgrammeBoxes {
  boxes: ProgrammeBoxView[];
  elsewhere: FleetRow[];
  lone: FleetRow[];
  /** The hue of every programme on this card, boxes and elsewhere workers alike, by slug: the fleet's map. */
  hues: ReadonlyMap<string, ProgHue>;
}

/** What the lead programme gives its box, before the card's hues are known. */
type LeadFacts = { slug: string; title: string } & Pick<ProgrammeBoxView, 'more' | 'progress' | 'waiting'>;

const WAITING: ReadonlySet<RunState> = new Set<RunState>(['awaiting-review', 'merging']);

/** The run a row is doing: a spawn's own, or the session's open bound run (`boundOpenRun`, the wire's binding). A
 *  delegation row (wave 4) does no run: it is in no programme, and takes no programme's hue. */
export function rowRun(row: FleetRow, runs: readonly RunSummary[]): RunSummary | null {
  if (row.kind === 'pending') return row.run;
  return row.kind === 'session' ? boundOpenRun(runs, row.session) : null;
}

/** One card's boxes, the workers of programmes elsewhere, and the rows in no programme. `rows` is the card's tree
 *  (`nestFleet`'s order); `here` is the open runs whose worker renders on this card, and `far` those a session here
 *  claims whose worker renders on another (`fleetTree`'s `runs` and `claimed`). `hues` is the fleet's map: a slug it
 *  lacks takes its preferred hue, as `assignHues` gives a slug alone. */
export function programmeBoxes(
  rows: readonly FleetRow[], here: readonly RunSummary[], far: readonly RunSummary[],
  lastMoveOf: (r: RunSummary) => number | null, hues: ReadonlyMap<string, ProgHue>,
): ProgrammeBoxes {
  const onCard = new Set(rows.flatMap((r) => (r.kind === 'session' ? [r.session.id] : [])));
  const runs = [...here, ...far];
  const farIds = new Set(far.map((r) => r.id));
  const byId = new Map<number, RunSummary>();
  for (const r of runs) byId.set(r.id, r);
  const all = [...byId.values()];
  const claims = new Map<string, RunSummary[]>();
  for (const id of onCard) {
    const list = boxRunsOf(all, id);
    if (list.length > 0) claims.set(id, list);
  }

  const drafts: (Omit<ProgrammeBoxView, 'lead'> & LeadFacts)[] = [];
  const elsewhere: FleetRow[] = [];
  const lone: FleetRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const head = rows[i]!;
    i += 1;
    const kids: FleetRow[] = [];
    while (i < rows.length && rows[i]!.depth === 1) kids.push(rows[i++]!);
    const claimed = head.kind === 'session' ? claims.get(head.session.id) : undefined;
    if (head.kind === 'session' && claimed !== undefined) {
      drafts.push({ ...lead(claimed), coordinatorId: head.session.id, coordinator: head.session, children: kids,
        abroad: claimed.filter((r) => farIds.has(r.id)).sort((a, b) => a.id - b.id),
        lastMoveAt: boxLastMove(claimed, lastMoveOf) });
      continue;
    }
    const by = rowRun(head, runs)?.claimedBy ?? null;
    const far = by !== null && !(head.kind === 'session' && by === head.session.id) && !claims.has(by);
    (far ? elsewhere : lone).push(head, ...kids);
  }

  const hueOf = (slug: string): ProgHue => hues.get(slug) ?? PROG_HUES[fnv1a(slug) % PROG_HUES.length]!;
  const boxes = drafts.map(({ slug, title, ...d }) => ({ ...d, lead: { slug, title, hue: hueOf(slug) } }));
  return { boxes, elsewhere, lone, hues };
}

/** The runs that make a session a box: its claimed runs through the one coordinator-side reader (`claimedRunsOf`,
 *  D-7182), less a run it claims for itself, which is no box. The runs here are the open runs frame's, so its open
 *  filter keeps every one of them. Written once for `programmeBoxes` and `nextStallBoundary`. */
const boxRunsOf = (runs: readonly RunSummary[], id: string): RunSummary[] =>
  claimedRunsOf(runs, id).filter((r) => r.claimedBy !== r.sessionId);

/** A box's last move: the newest over its runs. Written once for `programmeBoxes` and `nextStallBoundary`. */
const boxLastMove = (runs: readonly RunSummary[], lastMoveOf: (r: RunSummary) => number | null): number | null =>
  newest(runs.map(lastMoveOf));

/** The next instant a box crosses the quiet threshold with no new frame (Task G1b, D-7380; review 1152 F1): per
 *  claimant, its box's last move (`boxLastMove` over `boxRunsOf`, the box's own rules) plus `quietMs`, the earliest still
 *  ahead of `now`. `null` with no threshold, under the operator's pause (nothing stalls), or with none ahead. The
 *  rollup's clock folds it into its one timer, as it does `nextRollupBoundary`. Fleet-wide: a claimant on no card
 *  costs one wake that changes nothing. */
export function nextStallBoundary(
  runs: readonly RunSummary[], lastMoveOf: (r: RunSummary) => number | null, now: number, quietMs: number | null,
  paused: boolean,
): number | null {
  if (quietMs === null || paused) return null;
  let next: number | null = null;
  for (const id of new Set(runs.flatMap((r) => (r.claimedBy === null ? [] : [r.claimedBy])))) {
    const moved = boxLastMove(boxRunsOf(runs, id), lastMoveOf);
    if (moved === null || moved + quietMs <= now) continue;
    next = next === null ? moved + quietMs : Math.min(next, moved + quietMs);
  }
  return next;
}

const newest = (at: readonly (number | null)[]): number | null => {
  const known = at.filter((t): t is number => t !== null && Number.isFinite(t));
  return known.length === 0 ? null : Math.max(...known);
};

/** The lead programme of a coordinator's open runs, and what the box says about it. */
function lead(claimed: readonly RunSummary[]): LeadFacts {
  const by = new Map<string, { work: RunSummary[]; newest: number }>();
  for (const r of claimed) {
    const p = by.get(r.program) ?? { work: [], newest: -Infinity };
    if (r.kind !== 'review') p.work.push(r);
    p.newest = Math.max(p.newest, r.id);
    by.set(r.program, p);
  }
  const [slug, p] = [...by].sort(([, a], [, b]) => b.work.length - a.work.length || b.newest - a.newest)[0]!;
  // The furthest wave of its work runs, a tie to the newest: the run the progress and the wait are read from.
  const front = [...p.work].sort((a, b) => b.wave - a.wave || b.id - a.id)[0];
  return {
    slug, title: programmeTitle(slug, claimed), more: by.size - 1, progress: programWave(p.work),
    waiting: front !== undefined && WAITING.has(front.state) ? (front.state as 'awaiting-review' | 'merging') : null,
  };
}

/** A drawn member is the operator's ask: the coordinator, or a child (the folded tray always draws those). */
export const boxNeeds = (b: ProgrammeBoxView): boolean =>
  operatorAsk(b.coordinator) || b.children.some((r) => r.kind === 'session' && operatorAsk(r.session));

/** The box's state: needs, then paused, then stalled, then moving. Never stalled without a threshold and a move. */
export function boxState(
  b: ProgrammeBoxView, rowsNeed: boolean, now: number, quietMs: number | null, paused: boolean,
): BoxState {
  if (rowsNeed) return 'needs';
  if (paused) return 'paused';
  if (quietMs !== null && b.lastMoveAt !== null && now - b.lastMoveAt >= quietMs) return 'stalled';
  return 'moving';
}

/** A span in `formatReset`'s units: `3m`, `2h 10m`, `3d 4h`. */
const span = (at: number, now: number): string => formatReset(Math.floor(now / 1000), Math.floor(at / 1000));

/** The coordinator row's movement readout: `moved 3m ago`, `no move 2h 10m · awaiting review`, `paused`, or nothing
 *  when no move is known. */
export function movementWords(b: ProgrammeBoxView, state: BoxState, now: number): string {
  if (b.lastMoveAt === null) return '';
  if (state === 'paused') return 'paused';
  if (state === 'stalled') return `no move ${span(b.lastMoveAt, now)}${b.waiting === null ? '' : ` · ${RUN_WORD[b.waiting]}`}`;
  return now - b.lastMoveAt < 60_000 ? 'moved just now' : `moved ${span(b.lastMoveAt, now)} ago`;
}

const RANK: Record<BoxState, number> = { needs: 0, stalled: 1, moving: 2, paused: 2 };

/** The card's box order: needs, then stalled, then moving and paused, then the longest quiet first. */
export function boxOrder(
  a: { readonly state: BoxState; readonly view: ProgrammeBoxView },
  b: { readonly state: BoxState; readonly view: ProgrammeBoxView },
): number {
  const r = RANK[a.state] - RANK[b.state];
  if (r !== 0 || a.view.lastMoveAt === null || b.view.lastMoveAt === null) return r;
  return a.view.lastMoveAt - b.view.lastMoveAt;
}

/** The boxes in the card's order, each with its state. `now` is the card's clock; with none (the card reads no clock
 *  of its own) there is no threshold to cross either, so no box reads stalled. */
export function rankBoxes(
  boxes: readonly ProgrammeBoxView[], now: number | null, quietMs: number | null, paused: boolean,
): { state: BoxState; view: ProgrammeBoxView }[] {
  return boxes
    .map((view) => ({ view, state: boxState(view, boxNeeds(view), now ?? 0, now === null ? null : quietMs, paused) }))
    .sort(boxOrder);
}

/** A card's boxes and their ranked states at `now`, over the card's tree (`fleetTree`'s rows, runs, claimed runs and
 *  hues), with the moves read by `runLastMove`: the one composition `ProjectCard` draws and `FleetCards`' view hold
 *  counts a folded card's kept boxes by (D-6090), so the two never disagree about what a folded card shows. */
export function cardBoxes(
  rows: readonly FleetRow[], here: readonly RunSummary[], far: readonly RunSummary[], hues: ReadonlyMap<string, ProgHue>,
  now: number | null, quietMs: number | null, paused: boolean,
): { prog: ProgrammeBoxes; ranked: { state: BoxState; view: ProgrammeBoxView }[] } {
  const prog = programmeBoxes(rows, here, far, runLastMove, hues);
  return { prog, ranked: rankBoxes(prog.boxes, now, quietMs, paused) };
}

/** A folded project card (spec §2.3): the boxes that need the operator or have stalled stay drawn, and the rest of
 *  the card is counted, a box as one and a row as one. */
export function foldedCard<B extends { readonly state: BoxState }>(
  ranked: readonly B[], elsewhere: readonly FleetRow[], lone: readonly FleetRow[],
): { keep: B[]; more: number } {
  const keep = ranked.filter((b) => b.state === 'needs' || b.state === 'stalled');
  const rows = [...elsewhere, ...lone].filter((r) => r.depth === 0).length;
  return { keep, more: ranked.length - keep.length + rows };
}

export type SummaryRow = Extract<RolledRow, { kind: 'summary' }>;

/** A box's tray as the rollup folded it (`foldChildren`, unchanged): the child rows drawn under the coordinator,
 *  and the summary row, which is the footer's state, when the rollup folded them. */
export interface Tray { rows: FleetRow[]; summary: SummaryRow | null }

export function trayOf(rolled: readonly RolledRow[], coordinatorId: string): Tray {
  const at = rolled.findIndex((r) => r.depth === 0 && r.kind === 'session' && r.session.id === coordinatorId);
  const tray: Tray = { rows: [], summary: null };
  for (let i = at + 1; at >= 0 && i < rolled.length && rolled[i]!.depth === 1; i += 1) {
    const r = rolled[i]!;
    if (r.kind === 'summary') tray.summary = r;
    else tray.rows.push(r);
  }
  return tray;
}

const workersWord = (n: number): string => (n === 1 ? 'worker' : 'workers');

/** The footer's words, the existing children toggle's: folded, `2 more workers · 1 working` over the workers the tray
 *  hides; open, `hide 3 workers`. `null` when the rollup did not fold the children, or folded nothing away. A box's
 *  delegation children (wave 4: delegated work and worktrees) are never counted as workers: after the worker words,
 *  the rollup's own `n delegated` and `n worktree(s)` (`delegationParts`) over the same rows. */
export function footerWords(b: ProgrammeBoxView, tray: Tray): readonly string[] | null {
  if (tray.summary === null) return null;
  const delegated = (rows: readonly FleetRow[]): string[] =>
    delegationParts(rows.filter(isDelegated)).map((p) => `${p.n} ${p.word}`);
  if (tray.summary.expanded) {
    const n = b.children.filter(isWorker).length;
    const d = delegated(b.children);
    if (n === 0) return d.length === 0 ? null : [`hide ${d[0]!}`, ...d.slice(1)];
    return [`hide ${n} ${workersWord(n)}`, ...d];
  }
  const shown = new Set(tray.rows.map(fleetRowKey));
  const hidden = b.children.filter((r) => !shown.has(fleetRowKey(r)));
  if (hidden.length === 0) return null;
  const workers = hidden.filter(isWorker);
  const working = summaryParts(workers).slice(1).find((p) => p.word === 'working');
  return [
    ...(workers.length > 0 ? [`${workers.length} more ${workersWord(workers.length)}`] : []),
    ...(working ? [`${working.n} working`] : []),
    ...delegated(hidden),
  ];
}

/** The kicker's progress: `3/6 waves` with the share of a bar when the programme declared its total, `wave 62` with
 *  no bar when it did not, nothing before a first work wave. */
export function progressWords(p: ProgrammeBoxView['progress']): { text: string; share: number | null } | null {
  if (p.wave <= 0) return null;
  if (p.waveOf === null || p.waveOf <= 0) return { text: `wave ${p.wave}`, share: null };
  return { text: `${p.wave}/${p.waveOf} waves`, share: Math.min(1, p.wave / p.waveOf) };
}

/** The card's own abroad list, less every run a box on it already lists in its tray. */
export function cardAbroad(abroad: readonly RunSummary[], boxes: readonly ProgrammeBoxView[]): readonly RunSummary[] {
  const listed = new Set(boxes.flatMap((b) => b.abroad.map((r) => r.id)));
  return listed.size === 0 ? abroad : abroad.filter((r) => !listed.has(r.id));
}
