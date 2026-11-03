// The Waiting on you list's words and its pure decisions (desktop-polish PL5a, D-7712; ring L1: no fetch, no store, no
// component). Every label the spec fixes lives here once ("Checking…", "Came back", "Recently cleared", "ticked;
// coordinator not responding", "Nothing needs you."), and so do the three derivations the screen and the navigation share:
// the question rows (the sessions asking the operator something, joined from the fleet frame's own `attention` bucket, so
// nothing new is stored for them), the groups of the list, and the count the navigation badge prints.
//
// An item's state is its `state` column only (plan PL5b R2): `Came back` is an OPEN item whose latest coordinator move was
// a return, read from its history, never from a field that keeps the last round's value.
import { shapeProgramSlug, type FleetSession, type RunSummary } from '../../../shared/api';
import { orderItems, waitingCount, type ItemKind, type ItemView, type WaitingView } from '../../../shared/ledgers';
import { operatorAsk } from '../fleet/rollup';
import { sessionLabel } from '../fleet/sessionLabel';
import { boundOpenRun, claimedRunsOf, isRunClosed } from '../fleet/runWords';

/** An item kind in the operator's words (plan PL5a). A session's own question is `QUESTION_WORD`, not an item kind. */
export const KIND_WORD: Readonly<Record<ItemKind, string>> = {
  decide: 'Decide', do: 'Do', value: 'Give a value', secret: 'Give a secret',
};
export const QUESTION_WORD = 'Question';

/** The spec's exact labels (plan Global Constraints). */
export const CHECKING_WORD = 'Checking…';
export const STALE_WORD = 'ticked; coordinator not responding';
export const CAME_BACK_WORD = 'Came back';
export const BLOCKING_WORD = 'Blocking';
export const SOON_DEFAULT_WORD = 'Needed soon';
export const LATER_WORD = 'Later';
export const QUESTION_PILL_WORD = 'Session waiting';
export const CLEARED_HEADING = 'Recently cleared';
export const EMPTY_WORD = 'Nothing needs you.';
export const NO_FRAME_WORD = 'Waiting for the first update from the server…';
export const NO_PROGRAMME_WORD = 'Not in a programme';
/** A decide item's recommended option (plan PL9, D-7896; spec §3.2, D24): the mark on it, and the heading of its reasons. */
export const RECOMMENDED_WORD = 'Recommended';
export const RECOMMENDED_WHY_HEADING = 'Why it is recommended';

/** What a pill's colour means; a pill always says it in words too, so no state is read out of colour alone. */
export type PillTone = 'blocking' | 'soon' | 'later' | 'checking' | 'stale' | 'bounced' | 'ask';
export interface Pill { readonly tone: PillTone; readonly word: string }

/** The latest coordinator return on an item's history, or `null`: the item has not come back. */
function latestReturn(item: ItemView): { at: number; note: string | null } | null {
  let best: { at: number; note: string | null } | null = null;
  for (const h of item.history) if (h.act === 'return' && (best === null || h.at >= best.at)) best = { at: h.at, note: h.note };
  return best;
}

/** An OPEN item the coordinator sent back: it counts for the operator again, with the coordinator's note. */
export const cameBack = (item: ItemView): boolean => item.state === 'open' && latestReturn(item) !== null;

/** The coordinator's note on a sent-back item (what to fix), or `null` when it has none or the item did not come back. */
export function cameBackNote(item: ItemView): string | null {
  return item.state === 'open' ? latestReturn(item)?.note ?? null : null;
}

/** The pill of how soon an item is needed (spec §2: a needed-by label whatever the item's state). */
function neededByPill(item: ItemView): Pill {
  if (item.neededBy === 'blocking') return { tone: 'blocking', word: BLOCKING_WORD };
  if (item.neededBy === 'soon') return { tone: 'soon', word: item.soonLabel ?? SOON_DEFAULT_WORD };
  return { tone: 'later', word: LATER_WORD };
}

/** The pills an item wears, in the order they are read: its state when it has one to say (being checked, ticked with the
 *  coordinator not responding, sent back), then how soon it is needed, which an item says in every state. */
export function itemPills(item: ItemView): Pill[] {
  const needed = neededByPill(item);
  if (item.state === 'checking') return [item.stale ? { tone: 'stale', word: STALE_WORD } : { tone: 'checking', word: CHECKING_WORD }, needed];
  if (cameBack(item)) return [{ tone: 'bounced', word: CAME_BACK_WORD }, needed];
  return [needed];
}

/** A session asking the operator something: one row, never tickable (it is answered in its own session). */
export interface QuestionRow { readonly sessionId: string; readonly program: string | null; readonly title: string; readonly at: number }

/** The sessions waiting on the operator (`operatorAsk`, the same attention bucket the Inbox door counts), each with the
 *  programme of its OPEN bound run (a worker) or of the run it claims (a coordinator); `null` when it is in none, which the
 *  screen files under "Not in a programme". `at` is when it entered the bucket (0 when the row carries none). */
export function questionRows(sessions: readonly FleetSession[], runs: readonly RunSummary[]): QuestionRow[] {
  return sessions.filter(operatorAsk).map((s) => ({
    sessionId: s.id,
    program: boundOpenRun(runs, s)?.program ?? claimedRunsOf(runs, s.id)[0]?.program ?? null,
    title: sessionLabel(s),
    at: s.bucketSince ?? 0,
  }));
}

/** What the Waiting on you door counts: the open items (sent-back ones included) plus the question rows. An item being
 *  checked is the coordinator's, so it does not count (spec §2). */
export const waitingTotal = (items: readonly ItemView[], questions: readonly QuestionRow[]): number =>
  waitingCount(items) + questions.length;

/** The chip's number for `program`, off what the fleet store holds: "waiting on you" as spec §2 defines it once, the programme's
 *  open items (sent-back ones included, one being checked not) plus the questions its sessions ask, summed by `waitingTotal`,
 *  the one sum the combined list, the navigation badge and the programme view's heading (`groupByProgramme`'s `waiting`) read
 *  too, so a programme never reads one number on its box and another on its view (ruling 14290). Zero until the list AND the
 *  fleet frame have landed (`sessions`, as the navigation badge gates them): "not heard yet" draws no chip rather than a guess. `runs` may be `null` (no runs frame yet): a question's programme is then
 *  unknown, so it counts for no programme. */
export function programmeWaitingCount(
  view: WaitingView | null, sessions: readonly FleetSession[] | null, runs: readonly RunSummary[] | null, program: string,
): number {
  if (view === null || sessions === null) return 0;
  return waitingTotal(
    view.items.filter((i) => i.program === program),
    questionRows(sessions, runs ?? []).filter((q) => q.program === program),
  );
}

/** The runs of one programme that are still open (`isRunClosed`, the runs board's own predicate), which is what keeps its
 *  coordinator waiting on the operator's tick and refuses a dismiss. The list's wave label and `programmeIsLive` both read
 *  this ONE measurement, so no screen filters runs for openness of its own. */
export const openRunsOf = (program: string, runs: readonly RunSummary[]): RunSummary[] =>
  runs.filter((r) => r.program === program && !isRunClosed(r));

/** Whether a programme has an open run. `null` runs (no runs frame yet) is live: a run this page has not heard of counts as
 *  open, so no screen calls a programme ended, or offers a dismiss, on a guess. */
export const programmeIsLive = (program: string, runs: readonly RunSummary[] | null): boolean =>
  runs === null || openRunsOf(program, runs).length > 0;

/** One line of the list: an item, or a session's question. */
export type Row = { readonly kind: 'item'; readonly item: ItemView } | { readonly kind: 'question'; readonly question: QuestionRow };

export interface ProgrammeGroup {
  /** The programme's slug, or `null` for questions of sessions that are in none. */
  readonly program: string | null;
  readonly rows: readonly Row[];
  /** An OPEN blocking item: the programme is stopped on the operator. */
  readonly blocking: boolean;
  /** Open items plus questions: what this programme asks of the operator. */
  readonly waiting: number;
}

/** The list grouped by programme: programmes with a blocking item first, then by slug, "Not in a programme" last. Within a
 *  group the open blocking items come first, then the session questions, then the rest in `orderItems` order. */
export function groupByProgramme(items: readonly ItemView[], questions: readonly QuestionRow[]): ProgrammeGroup[] {
  const slugs = new Set<string | null>([...items.map((i) => i.program), ...questions.map((q) => q.program)]);
  const groups: ProgrammeGroup[] = [];
  for (const program of slugs) {
    const mine = orderItems(items.filter((i) => i.program === program));
    const asks = questions.filter((q) => q.program === program).sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
    const isBlocking = (i: ItemView): boolean => i.state === 'open' && i.neededBy === 'blocking';
    const rows: Row[] = [
      ...mine.filter(isBlocking).map((item): Row => ({ kind: 'item', item })),
      ...asks.map((question): Row => ({ kind: 'question', question })),
      ...mine.filter((i) => !isBlocking(i)).map((item): Row => ({ kind: 'item', item })),
    ];
    groups.push({ program, rows, blocking: mine.some(isBlocking), waiting: waitingTotal(mine, asks) });
  }
  const key = (g: ProgrammeGroup): string => g.program ?? '￿';
  return groups.sort((a, b) => Number(b.blocking) - Number(a.blocking) || key(a).localeCompare(key(b)));
}

/** The summary line's counts, in the order the screen prints them. */
export interface SummaryCounts { blocking: number; questions: number; soon: number; checking: number; cameBack: number }

export function summaryCounts(items: readonly ItemView[], questions: readonly QuestionRow[]): SummaryCounts {
  // Each open item is counted once: one that came back is counted as that, whatever its needed-by says.
  const open = items.filter((i) => i.state === 'open');
  const fresh = open.filter((i) => !cameBack(i));
  return {
    blocking: fresh.filter((i) => i.neededBy === 'blocking').length,
    questions: questions.length,
    soon: fresh.filter((i) => i.neededBy === 'soon').length,
    checking: items.filter((i) => i.state === 'checking').length,
    cameBack: open.length - fresh.length,
  };
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The summary pills as `{tone, text}`, zero counts left out. */
export function summaryWords(c: SummaryCounts): { tone: PillTone; text: string }[] {
  const out: { tone: PillTone; text: string }[] = [];
  if (c.blocking > 0) out.push({ tone: 'blocking', text: `${c.blocking} blocking now` });
  if (c.questions > 0) out.push({ tone: 'ask', text: plural(c.questions, 'question from a session', 'questions from sessions') });
  if (c.soon > 0) out.push({ tone: 'soon', text: `${c.soon} needed soon` });
  if (c.checking > 0) out.push({ tone: 'checking', text: `${c.checking} being checked` });
  if (c.cameBack > 0) out.push({ tone: 'bounced', text: `${c.cameBack} came back` });
  return out;
}

/** "raised 2h ago", from an epoch-ms instant and the page's `now`; "just now" under two minutes. */
export function ageWords(at: number, now: number): string {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  if (m < 2) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

// ── moving between items (plan PL9, D-7896; spec §2 "Moving between items", D23) ───────────────────────────────────────────
//
// An opened item steps to the previous and next item OF THE LIST IT WAS OPENED FROM, in that list's own order and filter. There
// is ONE ORDER: `groupByProgramme`'s groups, which the combined list, its side rail's filter and the programme view all draw, read
// through `listGroups`; the neighbours are read off those same groups, so no second ordering exists to drift from the drawn one.
// A session's question is a row of the list but not an item (it opens its session), so the steps go from item to item.

/** The list an item was opened from: the combined list, unfiltered (`programme: null`) or filtered by its side rail to one
 *  programme, or one programme's own view. */
export type ItemList =
  | { readonly at: 'waiting'; readonly programme: string | null }
  | { readonly at: 'programme'; readonly programme: string };

/** The combined list, unfiltered: where an item opened with no list, or with one this page cannot read, steps and goes back. */
export const COMBINED_LIST: ItemList = { at: 'waiting', programme: null };

const isSlug = (s: string): boolean => { const shaped = shapeProgramSlug(s); return shaped.ok && shaped.slug === s; };

/** The list as one word for the item's URL (`?from=`), so a reload or a shared link keeps it: `waiting`, `waiting:<slug>`,
 *  `programme:<slug>`. A slug never holds `:` (`shapeProgramSlug`), so the word reads back unambiguously. */
export function fromWord(list: ItemList): string {
  if (list.at === 'programme') return `programme:${list.programme}`;
  return list.programme === null ? 'waiting' : `waiting:${list.programme}`;
}

/** The list a `from` word names, or the combined list for a word that names none (absent, unknown or malformed). */
export function listOfFromWord(word: string | null): ItemList {
  if (word === 'waiting') return COMBINED_LIST;
  const m = word === null ? null : /^(waiting|programme):([^:]+)$/.exec(word);
  if (m === null || !isSlug(m[2]!)) return COMBINED_LIST;
  return m[1] === 'programme' ? { at: 'programme', programme: m[2]! } : { at: 'waiting', programme: m[2]! };
}

/** THE GROUPS A LIST DRAWS, in its order, from `groupByProgramme`'s: every group for the combined list; the programme's own group
 *  for its filter or its view. A filter to a programme with no group draws every group (the side rail offers only programmes that
 *  have one, so this is a stale link); a programme's view draws none, and says what the programme waits on instead. */
export function listGroups(list: ItemList, groups: readonly ProgrammeGroup[]): readonly ProgrammeGroup[] {
  if (list.programme === null) return groups;
  const mine = groups.filter((g) => g.program === list.programme);
  return mine.length > 0 || list.at === 'programme' ? mine : groups;
}

/** Where an item sits in a list: the list it was resolved to, its 0-based index among the list's items, how many items the list
 *  holds, and the ids either side (`null` past either end). */
export interface ItemPlace {
  readonly list: ItemList;
  readonly index: number;
  readonly total: number;
  readonly prev: number | null;
  readonly next: number | null;
}

/** The item's place in the list it was opened from, read off the groups that list draws (`listGroups`). A list that does not
 *  hold the item (a stale link: an item of another programme, or a programme with no items now) falls back to the combined list;
 *  `null` when that does not hold it either (an item recently cleared, or gone), which has a way back and no steps. */
export function itemPlace(id: number, list: ItemList, groups: readonly ProgrammeGroup[]): ItemPlace | null {
  // A list naming a programme with no group is stale whatever it draws: it resolves to the combined list, so the way back never
  // returns to a filter the side rail no longer offers.
  const named = list.programme === null || groups.some((g) => g.program === list.programme) ? list : COMBINED_LIST;
  const tries = named.programme === null ? [named] : [named, COMBINED_LIST];
  for (const l of tries) {
    const ids = listGroups(l, groups).flatMap((g) => g.rows).flatMap((r) => (r.kind === 'item' ? [r.item.id] : []));
    const index = ids.indexOf(id);
    if (index >= 0) return { list: l, index, total: ids.length, prev: ids[index - 1] ?? null, next: ids[index + 1] ?? null };
  }
  return null;
}

/** "3 of 6": the place as the operator reads it. */
export const placeWords = (place: ItemPlace): string => `${place.index + 1} of ${place.total}`;
