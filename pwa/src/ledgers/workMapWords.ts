// The Work card's words (programme work map WM3, D-8806; spec 2026-11-16 §5 and §5.1; ring L1: pure, no store, no component).
// Every word the card writes lives here once: a ticket's status word (keyed by `WORK_STATUSES`, so a status added there is a
// compile error until it has a word), the headline, the outstanding line, the source line, a phase's line and the notes of
// each plan state. The card decides nothing: `workMapOf` (server, L1) decided every count, status, carry and finish, and
// these functions only put them in words.
//
// R129 (a stage is a phase) and the operator's tidying notes of 2026-11-19: nothing here writes the word "Programme" where
// the card already carries the programme's own icon and colours, and nothing writes a "coordinator" word: a coordinator is
// shown by a badge another task adds.
import { elapsedWords } from '@ccrc/ui';
import {
  WORK_APART_GROUPS, WORK_COUNTED_GROUPS,
  type CheckpointEvidence, type CheckpointKind, type WorkCountedGroup, type WorkEpicView, type WorkItemView, type WorkMapView, type WorkPhaseView,
  type WorkStatus, type WorkUnreadable,
} from '../../../shared/plan';
import { releaseDate } from '../lib/format';

/** The card's answer: the server's `WorkAnswer` (`WorkMapView`, or `{ unreadable }`), widened by the page's own two arms, each of
 *  which may carry the last view the page drew. The shipped `WorkAnswer` has no `last` and no failed-read arm; the card's one
 *  `work` prop is this (D-8806, `unreadable-carries-the-last-view`; D-8823, `failed-read-arm`: the page's failed read speaks in
 *  the refusal's word, which the server's `unreadable` has no place for). Defined here (L1) so the page's decider, `workRead.ts`,
 *  reads it without importing the component. */
export type WorkCardAnswer =
  | WorkMapView
  | { unreadable: WorkUnreadable; last?: WorkMapView | null }
  | { readFailed: string; last?: WorkMapView | null };

/** A server's word looked up in a table of this build's words. A word the table does not hold (a newer server's) reads as itself,
 *  never as "undefined" (review 2873 F15); `hasOwn`, so a word such as "constructor" is not found on the prototype. One owner of
 *  the fallback: every lookup of a word the server sent goes through it. */
const wordIn = (table: Readonly<Record<string, string>>, word: string): string => (Object.hasOwn(table, word) ? table[word]! : word);

/** A ticket's status in the operator's words, one per `WorkStatus` and spelt once (spec Table 6). `done-unverified` is the
 *  front of "marked done, but …": the row's facts carry the reason that finishes the sentence. */
export const STATUS_WORD: Readonly<Record<WorkStatus, string>> = {
  dropped: 'dropped',
  closed: 'closed',
  done: 'done',
  'done-unverified': 'marked done, but',
  'left-open': 'left open',
  'waiting-on-you': 'waiting on you',
  stuck: 'stuck',
  blocked: 'blocked',
  working: 'working',
  'state-unknown': 'state unknown',
  'in-review': 'in review',
  merging: 'merging',
  queued: 'queued',
  'not-started': 'not started',
  failed: 'failed',
};
export const statusWord = (status: WorkStatus): string => wordIn(STATUS_WORD, status);

/** An outstanding group's words in the outstanding line (spec §5 item 1). Keyed by the counted groups less `done`, so a group
 *  the server starts counting is a compile error until it has a word; the line writes them in `WORK_COUNTED_GROUPS` order
 *  (review 2873 F3). A group that is also a status reads that status's word, spelt once in `STATUS_WORD` (review 2891 F5). */
const OUTSTANDING_WORD: Readonly<Record<Exclude<WorkCountedGroup, 'done'>, string>> = {
  'in-progress': 'in progress', 'waiting-on-you': STATUS_WORD['waiting-on-you'], held: 'held', 'not-started': STATUS_WORD['not-started'],
};
const OUTSTANDING_GROUPS = WORK_COUNTED_GROUPS.filter((g): g is Exclude<WorkCountedGroup, 'done'> => g !== 'done');

/** The groups a headline and a phase line write apart from "N of M": `WORK_APART_GROUPS` less `dropped`, which no line writes (a
 *  dropped ticket leaves the plan). Keyed by that list, so an apart group the server adds is a compile error until it has a word,
 *  and is then written in both lines (review 2891 F5); each word is its status's, spelt once in `STATUS_WORD`. */
type ApartGroup = Exclude<(typeof WORK_APART_GROUPS)[number], 'dropped'>;
const APART_WORD: Readonly<Record<ApartGroup, string>> = { closed: STATUS_WORD.closed, 'left-open': STATUS_WORD['left-open'], failed: STATUS_WORD.failed };
const APART_GROUPS = WORK_APART_GROUPS.filter((g): g is ApartGroup => g !== 'dropped');
/** "2 closed", "1 left open", "3 failed", in `WORK_APART_GROUPS` order, each left out when it is zero. */
const apartParts = (c: WorkMapView['counts']): string[] => APART_GROUPS.filter((g) => c[g] > 0).map((g) => `${c[g]} ${APART_WORD[g]}`);

/** What the headline's "N of M" counts: the work still in the plan, each ticket once, over the groups the server counts
 *  (`WORK_COUNTED_GROUPS`, the one list `workMapOf`'s own strip reads). Closed, left open, dropped and failed count apart. */
const countedIn = (c: WorkMapView['counts']): number => WORK_COUNTED_GROUPS.reduce((n, g) => n + c[g], 0);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The headline: "11 of 21 done", then closed, left-open and failed counts apart ("· 2 closed"); "38 work runs done" with no
 *  plan, never an "N of M"; "Plan closed as done on 2026-11-20" or "Plan abandoned on 2026-11-20: why" once the plan has
 *  ended. Null for a plan declared with nothing to count, where the note says it (spec §5.1). */
export function headline(view: WorkMapView): string | null {
  const c = view.counts;
  const apart = apartParts(c);
  if (view.source === 'declared-empty') return null;
  if (view.source === 'runs') return [`${plural(c.done, 'work run', 'work runs')} done`, ...apart].join(' · ');
  if (view.end !== null) {
    const day = releaseDate(view.end.at);
    const how = view.end.outcome === 'done' ? `Plan closed as done on ${day}`
      : view.end.why === null || view.end.why === '' ? `Plan abandoned on ${day}` : `Plan abandoned on ${day}: ${view.end.why}`;
    return [how, ...(c.done > 0 ? [`${c.done} done`] : []), ...apart].join(' · ');
  }
  return [`${c.done} of ${countedIn(c)} done`, ...apart].join(' · ');
}

/** "3 in progress · 1 waiting on you · 6 not started", with "held" when any is. Null when nothing is outstanding, and always
 *  for an ended plan, which shows no outstanding work (the coordinator's ruling on review 2382 L3-F1, decided by
 *  `workMapOf`: an ended plan's open tickets are `left-open`, in a group of their own). */
export function outstandingLine(view: WorkMapView): string | null {
  if (view.end !== null || view.source === 'declared-empty') return null;
  const parts = OUTSTANDING_GROUPS.filter((g) => view.counts[g] > 0).map((g) => `${view.counts[g]} ${OUTSTANDING_WORD[g]}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** "From the plan · 3 phases · 3 epics · read 1m ago", adding "stuck and blocked not read yet" while the verdicts reader is
 *  empty. The elapsed spelling is the design system's own (`elapsedWords`). */
export function sourceLine(view: WorkMapView, readAt: number, now: number): string {
  const parts = [
    view.source === 'runs' ? 'From the work runs so far' : 'From the plan',
    ...(view.phases.length > 0 ? [plural(view.phases.length, 'phase', 'phases')] : []),
    ...(view.epics.length > 0 ? [plural(view.epics.length, 'epic', 'epics')] : []),
    `read ${elapsedWords(Math.max(0, now - readAt))} ago`,
    ...(view.verdicts === 'not-read' ? ['stuck and blocked not read yet'] : []),
  ];
  return parts.join(' · ');
}

/** A phase's heading: its number, from `phaseNumbers` on the server, and its title. */
export const phaseHeading = (p: Pick<WorkPhaseView, 'number' | 'title'>): string => `Phase ${p.number} · ${p.title}`;

/** The phase numbers its carried tickets went to, ascending and once each (the wire's `WorkPhaseView.carried` is a count). The
 *  tickets are the ones the phase serves as carried out (`carriedOut`, decided by `workMapOf` where it counts `carried`); a
 *  closed ticket with a recorded carry is not among them (Table 6a, review 2873 F2). */
export function carriedTargetsOf(phase: Pick<WorkPhaseView, 'key' | 'carriedOut'>, items: readonly WorkItemView[]): number[] {
  const out = new Set(phase.carriedOut);
  const to = items.filter((i) => out.has(i.key)).flatMap((i) => i.phases.filter((p) => p.key === phase.key && p.carriedTo !== null).map((p) => p.carriedTo!.number));
  return [...new Set(to)].sort((a, b) => a - b);
}

const joinWords = (names: readonly (string | number)[]): string =>
  names.length <= 1 ? String(names[0] ?? '') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

/** A phase's line: "5 of 8 done · 1 closed · 1 left open · 1 carried to phase 3", each part left out when it is zero, and once
 *  finished "finished 2026-11-02" or "finished, date unknown". Closed and left-open tickets count apart, as the headline writes
 *  them, so a phase never reads as finished while a ticket of it is left open (spec §3.1, §5.1; review 2873 F1). A phase that
 *  holds no ticket in any group says it holds no work yet. */
export function phaseLine(p: WorkPhaseView, carriedTo: readonly number[]): string {
  if (p.finish !== null) return p.finish.at === 'unknown' ? 'finished, date unknown' : `finished ${releaseDate(p.finish.at)}`;
  const own = countedIn(p.counts);
  const parts = [
    ...(own > 0 ? [`${p.counts.done} of ${own} done`] : []),
    ...apartParts(p.counts),
    ...(p.carried === 0 ? [] : [carriedTo.length === 0 ? `${p.carried} carried` : `${p.carried} carried to ${carriedTo.length === 1 ? 'phase' : 'phases'} ${joinWords(carriedTo)}`]),
  ];
  return parts.length === 0 ? 'no work of its own yet' : parts.join(' · ');
}

/** The folded done line: "5 done"; the no-plan fallback folds its failed runs the same way. */
export const foldLabel = (n: number, group: 'done' | 'failed' = 'done'): string => `${n} ${group}`;

/** An epic chip's figures: "5 of 9 · ◇ 1 of 2" (a diamond for its checkpoints, left out when it has none), and "dropped" for a
 *  dropped epic the strip still holds while a done ticket of it counts (F3). */
export function epicChip(e: WorkEpicView): string {
  return [
    `${e.done} of ${e.total}`,
    ...(e.checkpointsTotal > 0 ? [`◇ ${e.checkpointsMet} of ${e.checkpointsTotal}`] : []),
    ...(e.dropped ? ['dropped'] : []),
  ].join(' · ');
}

/** What a carried row says. "carried" is the status column of a ticket carried OUT of this phase (not a `WorkStatus`, F22);
 *  `to` and `from` are its facts in the earlier and the later phase. A `from` whose phase was dropped since has no number (a
 *  recorded carry from a dropped source stands, review 2375 F10) and says so by its key (review 2382 L3-F8). */
export const carriedWords = {
  status: 'carried',
  to: (n: number): string => `carried to phase ${n}`,
  /** A carried-out row keeps its status now beside the carry (spec Table 6a: "carried to phase N, with its status now"). */
  now: (status: WorkStatus): string => `now ${statusWord(status)}`,
  from: (f: { key: string; number: number | null }): string => (f.number === null ? `from phase ${f.key}, dropped` : `from phase ${f.number}`),
} as const;

/** "takes on all of Epic B (◇ 1 of 2)": a phase that references whole epics, each with its checkpoint count. Null for none. */
export function wholeEpicLine(epics: readonly WorkEpicView[]): string | null {
  if (epics.length === 0) return null;
  return `takes on all of ${joinWords(epics.map((e) => (e.checkpointsTotal > 0 ? `${e.title} (◇ ${e.checkpointsMet} of ${e.checkpointsTotal})` : e.title)))}`;
}

/** "Done when · 1 of 3 proved": the folded last line of the card. */
export const doneWhenLine = (entries: WorkMapView['doneWhen']): string => `Done when · ${entries.filter((e) => e.proved).length} of ${entries.length} proved`;
export const PROVED_WORD = 'proved';
export const NOT_PROVED_WORD = 'not proved';

/** "Before the plan · 61 work runs": work runs with no ticket on a planned programme, one folded line, in no "N of M" (D12). */
export const beforePlanLine = (n: number): string => `Before the plan · ${plural(n, 'work run', 'work runs')}`;

/** The note of each plan state (spec §5.1). */
export const NOTES = {
  noPhases: 'No phases declared: grouped by epic',
  noPlan: 'No plan declared, so what remains is not known. Below is the work run so far.',
  declaredEmpty: 'The plan is declared but lists no work yet.',
} as const;
const UNREADABLE_WHY: Readonly<Record<WorkUnreadable, string>> = {
  'run-unreadable': 'the runs could not be read',
  'read-failed': 'a read failed',
};
/** The unreadable words this build can word: the keys of `UNREADABLE_WHY`, so the page's decider checks a server's word against what the card
 *  knows and falls to the failed-read arm for any other (review 2922 F3). Keyed by the type, so a word added to it is a compile error here. */
export const UNREADABLE_WORDS: readonly WorkUnreadable[] = Object.keys(UNREADABLE_WHY) as WorkUnreadable[];
/** The note over a card whose read failed; the one sentence, spelt once, for the server's `unreadable` and the page's failed read. */
const couldNotRead = (why: string): string => `The work could not be read: ${why}`;
export const unreadableNote = (why: WorkUnreadable): string => couldNotRead(wordIn(UNREADABLE_WHY, why));
/** The page's failed read, in the refusal's own word ("The work could not be read: not-found"). */
export const readFailedNote = (word: string): string => couldNotRead(word);
/** The card's section name, and the strip's. */
export const WORK_TITLE = 'Work';
export const NOT_IN_PHASE_WORD = 'Not in a phase';

/** An initiative the plan makes no Linear object for: say why there is no link (Task 5.2's note). Null where the state needs no
 *  note (a link, or a binding not made yet). */
export function initiativeNote(state: WorkMapView['initiatives'][number]['state']): string | null {
  return state === 'off' ? 'Initiatives are off for this project, so there is no initiative link.' : null;
}
export const OPEN_IN_LINEAR = 'Open in Linear';
export const OPEN_EPIC = 'Open the epic';

/** The facts on a ticket's row. */
export const runLinkWord = (runId: number): string => `Run #${runId}`;
export const itemLinkWord = (itemId: number): string => `Item #${itemId}`;
export const LAST_RUN_FAILED = 'last run failed';
export const movedWords = (at: number, now: number): string => `moved ${elapsedWords(Math.max(0, now - at))} ago`;
export const doneOnWords = (at: number): string => `done ${releaseDate(at)}`;
/** A row with no title: a no-plan run reads "Wave N" (spec §5.1), and a run with no wave its run number. */
export const untitledWords = (i: Pick<WorkItemView, 'wave' | 'runId' | 'key'>): string =>
  i.wave !== null ? `Wave ${i.wave}` : i.runId !== null ? `Run #${i.runId}` : i.key;

/** A checkpoint's kind in words. */
export const CHECKPOINT_KIND_WORD: Readonly<Record<CheckpointKind, string>> = {
  acceptance: 'acceptance', 'operator-act': 'operator act', measured: 'measured',
};
/** A checkpoint's facts: its kind, "open" or "met <date>", and what evidences it (a pull request, an item, a path). */
export function checkpointFacts(cp: { kind: CheckpointKind; state: string; metAt: number | null; evidence: CheckpointEvidence | null }): string {
  const evidence = cp.evidence === null ? null : 'pr' in cp.evidence ? `PR #${cp.evidence.pr}` : 'itemId' in cp.evidence ? itemLinkWord(cp.evidence.itemId) : cp.evidence.path;
  const state = cp.state === 'met' ? (cp.metAt === null ? 'met' : `met ${releaseDate(cp.metAt)}`) : cp.state;
  return [wordIn(CHECKPOINT_KIND_WORD, cp.kind), state, ...(evidence === null ? [] : [evidence])].join(' · ');
}
export const checkpointsLabel = (epicTitle: string): string => `Checkpoints of ${epicTitle}`;
