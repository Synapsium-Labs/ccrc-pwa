// The run page's words and its facts (the runs rebuild, D-8072; spec 2026-11-04 §8.4). Pure (L1): the screen mounts what
// this returns and decides nothing. The facts come in the spec's order under four labelled groups, and a fact that is absent
// is left out, except "Last move", which says "None recorded". The trail is a fifth group, drawn by its own component.
import type { ReviewCapStatus, RunHit, RunSignals, RunSummary } from '../../../shared/api';
import type { CoordinatorPresence } from './presence';
import { closedLine } from './closeWords';
import { coordLiftLine, coordLiftOf, reviewCapOf } from './reviewCapWords';
import { waveLabel } from './runWords';

export const RUN_PAGE_WORDS = {
  failed: 'Could not load this run. Try again.',
  retry: 'Try again',
  noneRecorded: 'None recorded',
  gone: 'gone',
  /** The strip's visible words (o3); a screen reader hears `backLabel` of them: "Back to Runs", "Back to Search results". */
  stripRuns: 'Runs',
  stripSearch: 'Search results',
  /** The strip's own name for a screen reader. */
  stripLabel: 'Where you came from',
  openSession: 'Open the session',
  openCoordinator: 'Open the coordinator',
  liftCap: 'Lift cap',
  abandon: 'Abandon',
  resume: 'Resume',
  /** The link back to the board under "There is no run N.". */
  toBoard: 'Back to Runs',
} as const;

/** "There is no run 9999." */
export const noRunLine = (id: number): string => `There is no run ${id}.`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const two = (n: number): string => String(n).padStart(2, '0');

/** A moment as the page says it: "4 Nov at 15:05", the viewer's local time. */
export function runWhen(ms: number): string {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} at ${two(d.getHours())}:${two(d.getMinutes())}`;
}

/** The coordinator's one word, or null when the page has no reading to word (`unknown` is never "gone": doubt is not dead). */
export function coordinatorWord(p: CoordinatorPresence): string | null {
  if (p === 'alive') return 'alive';
  if (p === 'hibernated') return 'asleep';
  if (p === 'dead') return RUN_PAGE_WORDS.gone;
  return null;
}

/** The Who facts' coordinator word: the server's verdict first (spec §8.4, A46/A60), `coordinatorPresence` only when the
 *  verdict is absent. A claimant with no fleet row (an old closed run) reads gone when the server says so. The run page and
 *  the programme page's head both ask it. */
export function coordinatorFactWord(gone: boolean | undefined, presence: CoordinatorPresence): string | null {
  if (gone === true) return coordinatorWord('dead');
  if (gone === false) return presence === 'dead' ? null : coordinatorWord(presence);
  return coordinatorWord(presence);
}

export interface FactPart { readonly text: string; readonly href?: string; readonly external?: true }
export interface Fact { readonly key: string; readonly label: string; readonly parts: readonly FactPart[] }
export interface FactGroup { readonly id: 'belongs' | 'who' | 'when' | 'work'; readonly title: string; readonly facts: readonly Fact[] }

/** What the page has heard for the facts that come from their own reads; `undefined` is "not asked yet" or "did not answer",
 *  and either leaves the fact out. */
export interface FactInput {
  readonly run: RunSummary;
  readonly reviewedBy: readonly Pick<RunHit, 'id'>[];
  readonly fmt?: (ms: number) => string;
  readonly programmeHref: string | null;
  readonly specHref: string | null;
  readonly runHref: (id: number) => string;
  readonly coordinator: string | null;
  readonly worker: string | null;
  readonly pr: { readonly text: string; readonly href: string | null } | null;
  readonly items?: { readonly done: number; readonly total: number };
  readonly signals?: RunSignals['signals'];
  readonly unreadMail?: number;
  readonly spend?: string;
}

const txt = (text: string): readonly FactPart[] => [{ text }];
const fact = (key: string, label: string, parts: readonly FactPart[]): Fact => ({ key, label, parts });

function suiteAndChecks(s: RunSignals['signals']): string | null {
  if (s === null) return null;
  const parts: string[] = [];
  if (s.suite.ok) parts.push(`suite ${s.suite.value}`);
  if (s.failure.ok) parts.push(`failure ${s.failure.value}`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/** The Review cap fact (D-8125): "3 of 6 rounds", then who lifted it. The operator's lift wins over a coordinator's, as
 *  it removes the cap; a coordinator lift says its reason and, past the first, how many times. */
function reviewCapParts(cap: ReviewCapStatus): readonly FactPart[] {
  const rounds = `${cap.rounds} of ${cap.cap} rounds`;
  const lift = coordLiftOf(cap);
  if (cap.liftedAt !== null) return txt(`${rounds} · Lifted by the operator`);
  if (lift === null) return txt(rounds);
  return txt(`${rounds} · ${coordLiftLine(cap)}${lift.count > 1 ? `, ${lift.count} times` : ''}`);
}

/** The facts, in §8.4's order, under their groups. A group with no fact is left out. */
export function runFacts(input: FactInput): FactGroup[] {
  const { run } = input;
  const fmt = input.fmt ?? runWhen;
  const belongs: Fact[] = [];
  const programme = run.programTitle !== '' ? run.programTitle : run.program;
  belongs.push(fact('programme', 'Programme', [input.programmeHref === null ? { text: programme } : { text: programme, href: input.programmeHref }]));
  if (input.specHref !== null) belongs.push(fact('spec', 'Spec', [{ text: 'Open the spec', href: input.specHref }]));
  belongs.push(fact('wave', 'Wave', txt(waveLabel(run))));
  belongs.push(fact('project', 'Project', txt(run.project)));
  if (typeof run.reviews === 'number') {
    belongs.push(fact('reviews', 'Reviews', [{ text: `run ${run.reviews}`, href: input.runHref(run.reviews) }]));
  }
  if (input.reviewedBy.length > 0) {
    const parts: FactPart[] = [];
    input.reviewedBy.forEach((r, i) => {
      if (i > 0) parts.push({ text: ', ' });
      parts.push({ text: `run ${r.id}`, href: input.runHref(r.id) });
    });
    belongs.push(fact('reviewedBy', 'Reviewed by', parts));
  }
  const who: Fact[] = [];
  if (run.claimedBy !== null) who.push(fact('coordinator', 'Coordinator', txt(input.coordinator ?? 'not reported')));
  if (run.sessionId !== null) who.push(fact('worker', 'Worker', txt(input.worker ?? 'not reported')));
  const when: Fact[] = [fact('opened', 'Opened', txt(fmt(run.openedAt)))];
  if (run.dispatchedAt !== null) when.push(fact('dispatched', 'Dispatched', txt(fmt(run.dispatchedAt))));
  const last = run.lastMoveAt;
  when.push(fact('lastMove', 'Last move', txt(typeof last === 'number' ? fmt(last) : RUN_PAGE_WORDS.noneRecorded)));
  if (run.closedAt !== null) when.push(fact('closed', 'Closed', txt(fmt(run.closedAt))));
  const work: Fact[] = [];
  if (run.workspace !== null) work.push(fact('workspace', 'Workspace', txt(run.workspace)));
  if (run.branch !== null) work.push(fact('branch', 'Branch', txt(run.branch)));
  if (input.pr !== null) work.push(fact('pr', 'Pull requests', [input.pr.href === null ? { text: input.pr.text } : { text: input.pr.text, href: input.pr.href, external: true }]));
  const cap = reviewCapOf(run);
  if (cap !== null && cap !== 'unmeasured') work.push(fact('reviewCap', 'Review cap', reviewCapParts(cap)));
  if (input.items !== undefined) work.push(fact('items', 'Items done', txt(`${input.items.done} of ${input.items.total}`)));
  const checks = input.signals === undefined ? null : suiteAndChecks(input.signals);
  if (checks !== null) work.push(fact('checks', 'Suite and checks', txt(checks)));
  if (input.unreadMail !== undefined && input.unreadMail > 0) work.push(fact('mail', 'Unread mail', txt(String(input.unreadMail))));
  if (input.spend !== undefined) work.push(fact('spend', 'Spend', txt(input.spend)));
  const groups: FactGroup[] = [
    { id: 'belongs', title: 'Where it belongs', facts: belongs },
    { id: 'who', title: 'Who', facts: who },
    { id: 'when', title: 'When', facts: when },
    { id: 'work', title: 'Work', facts: work },
  ];
  return groups.filter((g) => g.facts.length > 0);
}

/** The line a closed run leads with beneath its word (check 5), or null for an open run. */
export function closeLeadLine(run: RunSummary, fmt: (ms: number) => string = runWhen): string | null {
  if (run.state !== 'done' && run.state !== 'failed') return null;
  return typeof run.closedAt === 'number' ? closedLine(run, fmt) : null;
}
