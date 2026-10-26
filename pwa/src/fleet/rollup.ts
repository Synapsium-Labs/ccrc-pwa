// THE FLEET ROLLUP (D-6088): one pure decider for what a fleet list folds away. Both skins' lists read its answer
// (today both place `FleetColumn` → `FleetScreen` → `ProjectCard`; the W2 list restyles read the same answer), so
// no skin decides on its own which project is rolled up or which worker hides under its coordinator.
//
// INPUTS: the fleet tree (`fleetTree`, D-5527: each card's live rows and how they nest), the clock, the open session
// and the per-device preferences (`foldState.ts`'s `useRollupPrefs`). OUTPUT: per card, whether it is rolled up, its
// activity class, when it was last active, and the rows its body draws with the coordinator folds applied. Nothing
// here renders, reads storage or reads the clock itself.
//
// THE ONE PREDICATE THAT MAY NEVER BE HIDDEN: `operatorAsk`, the server's `attention` bucket. `sessionBucket`
// (shared/api.ts) files a live pane's open question or permission prompt there ONLY when no coordinator holds it:
// while the coordinator may still answer (`withCoordinator`, the newest `asks` row held before `notifyAt`) the row
// reads `working`; once the coordinator answers, the dialog is closed and the row leaves the rung; a dead pane is
// `dead` first. So `attention` is exactly "reached the operator and unanswered", the late hand-over included, and
// `session.ask` is not the predicate (it explains a hold or a ruling; a held chip can sit on a row already past its
// `notifyAt`). A cached snapshot revives `withCoordinator` as null, which reads `attention`: the safe direction.
import { substrateFault, type FleetSession } from '../../../shared/api';
import type { FleetRow } from './nestFleet';
import type { FleetTreeGroup } from './fleetTree';
import { rowStateWord } from './sessionFacts';
import { delegationParts } from './delegationWords';

/** A project whose last change is younger than this is active (rule 2). */
export const ROLLUP_RECENT_MS = 30 * 60_000;
/** A coordinator folds its workers from this many children (D-6089): one row folded into one line saves nothing. */
export const CHILD_FOLD_MIN = 2;

export type ActivityClass = 'active' | 'inactive';

/** The per-device preferences: a project's own ▾, stored with the class it was made in, and the coordinators
 *  whose worker line is open. */
export interface RollupPrefs {
  readonly projects: Readonly<Record<string, { readonly collapsed: boolean; readonly cls: ActivityClass }>>;
  readonly openChildren: readonly string[];
}
export const NO_ROLLUP_PREFS: RollupPrefs = { projects: {}, openChildren: [] };

/** A card body's row: `nestFleet`'s, or the line a coordinator's folded workers become. */
export type RolledRow =
  | FleetRow
  | {
    kind: 'summary'; depth: 1; parentId: string; expanded: boolean; total: number;
    /** The line's counts in drawing order; each `n word` is drawn unbreakable, so a wrap falls only between them. */
    parts: readonly SummaryPart[];
    text: string;
  };

/** One count of a coordinator's worker line: `5 workers`, `1 needs you`. */
export interface SummaryPart { readonly n: number; readonly word: string }

export interface CardRollup {
  readonly cls: ActivityClass;
  /** The body is not drawn; the header stands for the card. */
  readonly collapsed: boolean;
  /** What `collapsed` is with no stored ▾: rolled up when inactive, unless the card holds the open session. */
  readonly byDefault: boolean;
  /** An operator-facing question is on this card: it is never rolled up and its ▾ does nothing (rule 5). */
  readonly pinnedOpen: boolean;
  /** The latest change of a live member, epoch ms, or `null` when none is known. */
  readonly lastActive: number | null;
  readonly rows: readonly RolledRow[];
}

/** Rule 1: a question or permission prompt that reached the operator and is unanswered. */
export const operatorAsk = (s: FleetSession): boolean => s.bucket === 'attention';

/** Needs the operator: an operator-facing ask, or a fault the card already wears (substrate, strand). */
const needsOperator = (s: FleetSession): boolean =>
  operatorAsk(s) || substrateFault(s) !== null || (s.stranded ?? null) !== null;

/** The latest state change the row carries evidence for: entering its bucket, or its status file's last write. */
const lastChange = (s: FleetSession): number | null => {
  const at = [s.bucketSince, s.statusUpdatedAt].filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  return at.length === 0 ? null : Math.max(...at);
};

/** The next instant a row's last change leaves the 30-minute window, or `null` when none is inside it: the one moment
 *  a quiet fleet's rollup can change with no frame, so the screen sets ONE timer for it and none in a quiet fleet. */
export function nextRollupBoundary(sessions: readonly FleetSession[], now: number): number | null {
  let next: number | null = null;
  for (const s of sessions) {
    const t = s.bucket === 'archived' ? null : lastChange(s);
    if (t === null || t + ROLLUP_RECENT_MS < now) continue;
    next = next === null ? t + ROLLUP_RECENT_MS : Math.min(next, t + ROLLUP_RECENT_MS);
  }
  return next;
}

/** A coordinator's worker children (W) and its delegation children (D: delegated work and worktrees,
 *  delegation broker wave 4). */
type WorkerRow = Extract<FleetRow, { kind: 'session' | 'pending' }>;
type DelegatedRow = Extract<FleetRow, { kind: 'activity' | 'lease' }>;
const isWorker = (r: FleetRow): r is WorkerRow => r.kind === 'session' || r.kind === 'pending';
const isDelegated = (r: FleetRow): r is DelegatedRow => r.kind === 'activity' || r.kind === 'lease';

/** A child's word in the summary line: the row's own state word (`rowStateWord`), `needs you` for an
 *  operator-facing ask. Asked of W only. */
const childWord = (row: WorkerRow): string => {
  if (row.kind === 'pending') return 'spawning';
  const s = row.session;
  return operatorAsk(s) ? 'needs you' : rowStateWord(s);
};

/** The summary line's order: `needs you` straight after the total, so the count the operator most needs is never the
 *  one a narrow column pushes to a second line; the rest in the bucket order. */
const WORD_ORDER = ['needs you', 'working', 'waiting', 'done', 'idle', 'merged', 'asleep', 'exited', 'archived', 'spawning'];

/** A coordinator's worker line, as counts in drawing order: the total, then each state word. A programme box's
 *  footer counts its hidden workers with it (Task G2), so the two never word a worker differently. Asked of W only
 *  (delegation broker wave 4): delegation rows are counted by `delegationParts`. */
export function summaryParts(children: readonly WorkerRow[]): SummaryPart[] {
  const counts = new Map<string, number>();
  for (const c of children) counts.set(childWord(c), (counts.get(childWord(c)) ?? 0) + 1);
  const parts = [...counts].sort(([a], [b]) => WORD_ORDER.indexOf(a) - WORD_ORDER.indexOf(b)).map(([word, n]) => ({ n, word }));
  return [{ n: children.length, word: children.length === 1 ? 'worker' : 'workers' }, ...parts];
}

/** Rules 6 and 7 over one card's rows: each coordinator with `CHILD_FOLD_MIN` children or more gets one summary line;
 *  folded, only its operator-facing children and the open session stay under it.
 *
 *  Delegation broker wave 4: W is a head's worker children and D its delegation children. It folds when EITHER
 *  reaches `CHILD_FOLD_MIN`, so worktrees appearing beside a lone worker never hide that worker: folded, W keeps
 *  today's filter only when W itself would have folded, else all of W stays, and D hides. The line is today's worker
 *  counts (only when W is non-empty), then `n delegated` and `n worktree(s)`, never sorted into `WORD_ORDER`. A
 *  delegation group header is not a session head, so its members pass through unfolded. */
function foldChildren(rows: readonly FleetRow[], open: ReadonlySet<string>, selectedId: string | null): RolledRow[] {
  const out: RolledRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const head = rows[i]!;
    out.push(head);
    i += 1;
    const kids: FleetRow[] = [];
    while (i < rows.length && rows[i]!.depth === 1) kids.push(rows[i++]!);
    const w = kids.filter(isWorker);
    const d = kids.filter(isDelegated);
    if (head.kind !== 'session' || (w.length < CHILD_FOLD_MIN && d.length < CHILD_FOLD_MIN)) {
      out.push(...kids);
      continue;
    }
    const expanded = open.has(head.session.id);
    const parts = [...(w.length > 0 ? summaryParts(w) : []), ...delegationParts(d)];
    const text = parts.map((p) => `${p.n} ${p.word}`).join(' · ');
    out.push({ kind: 'summary', depth: 1, parentId: head.session.id, expanded, total: kids.length, parts, text });
    const kept = w.length < CHILD_FOLD_MIN ? w
      : w.filter((k) => k.kind === 'session' && (operatorAsk(k.session) || k.session.id === selectedId));
    out.push(...(expanded ? kids : kept));
  }
  return out;
}

/** One card's rollup (rules 2 to 7). */
export function rollupCard(g: FleetTreeGroup, prefs: RollupPrefs, now: number, selectedId: string | null): CardRollup {
  const live = [...g.sessions, ...g.released];
  const times = live.map(lastChange).filter((t): t is number => t !== null);
  const lastActive = times.length === 0 ? null : Math.max(...times);
  const active = live.some((s) => s.bucket === 'working' || needsOperator(s))
    || (lastActive !== null && lastActive >= now - ROLLUP_RECENT_MS)
    || g.rows.some((r) => r.kind === 'pending');
  const cls: ActivityClass = active ? 'active' : 'inactive';
  const pinnedOpen = g.sessions.some(operatorAsk);
  const own = prefs.projects[g.project];
  // A card holding the open session is open by default (a deep link or a jump lands on a visible row); the operator
  // may still roll it up, and toggleProject stores that because it departs from this default.
  const byDefault = cls === 'inactive' && !(selectedId !== null && live.some((s) => s.id === selectedId));
  const collapsed = pinnedOpen ? false : own !== undefined && own.cls === cls ? own.collapsed : byDefault;
  return { cls, collapsed, byDefault, pinnedOpen, lastActive, rows: foldChildren(g.rows, new Set(prefs.openChildren), selectedId) };
}

/** The whole fleet's rollup, by project. */
export function rollupFleet(
  groups: readonly FleetTreeGroup[], prefs: RollupPrefs, now: number, selectedId: string | null,
): { readonly cards: ReadonlyMap<string, CardRollup> } {
  return { cards: new Map(groups.map((g) => [g.project, rollupCard(g, prefs, now, selectedId)] as const)) };
}

/** The operator's ▾ on a project (rule 4): stored with the current class; a toggle back to the default removes the
 *  entry. A card held open by a question is left alone (rule 5). */
export function toggleProject(prefs: RollupPrefs, card: CardRollup, project: string): RollupPrefs {
  if (card.pinnedOpen) return prefs;
  const collapsed = !card.collapsed;
  const { [project]: _old, ...rest } = prefs.projects;
  void _old;
  const projects = collapsed === card.byDefault ? rest : { ...rest, [project]: { collapsed, cls: card.cls } };
  return { ...prefs, projects };
}

/** Open or close a coordinator's worker line. */
export function toggleChildren(prefs: RollupPrefs, parentId: string): RollupPrefs {
  const open = prefs.openChildren.includes(parentId);
  return { ...prefs, openChildren: open ? prefs.openChildren.filter((id) => id !== parentId) : [...prefs.openChildren, parentId] };
}

/** Rule 4's reset, from a FRESH frame only: drop a project's ▾ made in the other class or for a project the frame no
 *  longer carries, and an open worker line whose coordinator the fleet no longer carries. `null` when nothing changes, so the caller writes nothing. */
export function prunePrefs(
  prefs: RollupPrefs, roll: { readonly cards: ReadonlyMap<string, CardRollup> }, sessionIds: ReadonlySet<string>,
): RollupPrefs | null {
  const projects = Object.fromEntries(Object.entries(prefs.projects).filter(([p, o]) => {
    const c = roll.cards.get(p);
    return c !== undefined && c.cls === o.cls;
  }));
  const openChildren = prefs.openChildren.filter((id) => sessionIds.has(id));
  const same = Object.keys(projects).length === Object.keys(prefs.projects).length
    && openChildren.length === prefs.openChildren.length;
  return same ? null : { projects, openChildren };
}
