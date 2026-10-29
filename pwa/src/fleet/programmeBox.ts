// THE PROGRAMME BOX (Task G2): a coordinator's open work, seen as one thing inside its project card. Pure (L1): the
// card hands it its rows and the runs, and draws the answer; nothing here renders, reads storage or reads the clock.
//
// MEMBERS. A box is a session on this card that claims an open run of another session (or of a spawn not yet
// bound): its children are the rows `nestFleet` brackets under it, unchanged, and its far workers (`abroad`) are the
// runs it claims whose worker renders on another card. ONE box per coordinator session: a coordinator holding open
// runs of two programmes is led by the one with the most open work runs, a tie going to the newest run, and says
// `more`. A coordinator with no open run is an ordinary row (`lone`). A worker whose claimant is not a box here, and
// a spawn whose claimant is not on this card, is `elsewhere`: its programme's box is not on this card.
//
// STATE. `boxState` is one decider, in this order: needs (a drawn member is the operator's ask, `operatorAsk`), the
// operator's pause, stalled (no move within the stall watch's quiet threshold), moving. Movement is an INPUT
// (`lastMoveOf`, the run's last move, and the threshold): until the server sends either (Task G1) the card passes
// `() => null` and `null`, so a box shows no movement readout and never reads stalled.
//
// HUE. Each programme on a card carries one of four cool hues (`assignHues`): the `--prog-*` aliases of the lane
// hues, always beside the programme's title in words.
import type { FleetSession, RunState, RunSummary } from '../../../shared/api';
import type { FleetRow } from './nestFleet';
import { formatReset } from './formatReset';
import { operatorAsk } from './rollup';
import { RUN_WORD, programWave, programmeTitle, runForSession } from './runWords';

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
  /** Every programme on this card, boxes and elsewhere workers alike, by slug. */
  hues: ReadonlyMap<string, ProgHue>;
}

/** What the lead programme gives its box, before the card's hues are known. */
type LeadFacts = { slug: string; title: string } & Pick<ProgrammeBoxView, 'more' | 'progress' | 'waiting'>;

const WAITING: ReadonlySet<RunState> = new Set<RunState>(['awaiting-review', 'merging']);

/** The run a row is doing: a spawn's own, or the session's current run (`runForSession`). */
export function rowRun(row: FleetRow, runs: readonly RunSummary[]): RunSummary | null {
  return row.kind === 'pending' ? row.run : runForSession(runs, row.session);
}

/** One card's boxes, the workers of programmes elsewhere, and the rows in no programme. `rows` is the card's tree
 *  (`nestFleet`'s order); `runs` is every open run this card can know of: those whose worker renders here and those
 *  a session here claims. */
export function programmeBoxes(
  rows: readonly FleetRow[], runs: readonly RunSummary[], lastMoveOf: (r: RunSummary) => number | null,
): ProgrammeBoxes {
  const onCard = new Set(rows.flatMap((r) => (r.kind === 'session' ? [r.session.id] : [])));
  const byId = new Map<number, RunSummary>();
  for (const r of runs) byId.set(r.id, r);
  const claims = new Map<string, RunSummary[]>();
  for (const r of byId.values()) {
    if (r.claimedBy === null || r.claimedBy === r.sessionId || !onCard.has(r.claimedBy)) continue;
    const list = claims.get(r.claimedBy);
    if (list) list.push(r);
    else claims.set(r.claimedBy, [r]);
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
        abroad: claimed.filter((r) => r.sessionId !== null && !onCard.has(r.sessionId)).sort((a, b) => a.id - b.id),
        lastMoveAt: newest(claimed.map(lastMoveOf)) });
      continue;
    }
    const by = rowRun(head, runs)?.claimedBy ?? null;
    const far = by !== null && !(head.kind === 'session' && by === head.session.id) && !claims.has(by);
    (far ? elsewhere : lone).push(head, ...kids);
  }

  const slugs = [
    ...drafts.flatMap((d) => (claims.get(d.coordinatorId) ?? []).map((r) => r.program)),
    ...elsewhere.flatMap((r) => rowRun(r, runs)?.program ?? []),
  ];
  const hues = assignHues(slugs);
  const boxes = drafts.map(({ slug, title, ...d }) => ({ ...d, lead: { slug, title, hue: hues.get(slug)! } }));
  return { boxes, elsewhere, lone, hues };
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
