// The Waiting on you list's words and its pure decisions (desktop-polish PL5a, D-7712; ring L1: no fetch, no store, no
// component). Every label the spec fixes lives here once ("Checking…", "Came back", "Recently cleared", "ticked;
// coordinator not responding", "Nothing needs you."), and so do the three derivations the screen and the navigation share:
// the question rows (the sessions asking the operator something, joined from the fleet frame's own `attention` bucket, so
// nothing new is stored for them), the groups of the list, and the count the navigation badge prints.
//
// An item's state is its `state` column only (plan PL5b R2): `Came back` is an OPEN item whose latest coordinator move was
// a return, read from its history, never from a field that keeps the last round's value.
import { shapeProgramSlug, type FleetSession, type RunSummary } from '../../../shared/api';
import { CLEARED_WINDOW_MS, orderItems, waitingCount, type ItemKind, type ItemView, type WaitingView } from '../../../shared/ledgers';
import { operatorAsk } from '../fleet/rollup';
import { sessionLabel } from '../fleet/sessionLabel';
import { isRunClosed, sessionProgramme } from '../fleet/runWords';
import { needsYou, needsYouCount } from './needsYou';
import { waitingPath } from '../lib/routes';

/** An item kind in the operator's words (plan PL5a). A session's own question is `QUESTION_WORD`, not an item kind. */
export const KIND_WORD: Readonly<Record<ItemKind, string>> = {
  decide: 'Decide', do: 'Do', value: 'Give a value', secret: 'Give a secret',
};
export const QUESTION_WORD = 'Question';
/** D-8123: a session on a usage limit that no account has room to take. The kind chip, the pills and the summary's word. */
export const LIMIT_WORD = 'Usage limit';
export const LIMIT_PILL_WORD = 'No account has room';
export const LIMIT_WAITING_PILL_WORD = 'Waiting for reset';
/** A review cap row's kind word, in the place an item's kind word stands. */
export const REVIEW_CAP_WORD = 'Review cap';

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
/** A decide item's recommended option (plan PL9; spec §3.2, D24): the mark on it, and the heading of its reasons. */
export const RECOMMENDED_WORD = 'Recommended';
export const RECOMMENDED_WHY_HEADING = 'Why it is recommended';

/** An item's number (D-8194): its own id as the API sends it, after a `#`, so a coordinator's "item 129" matches a card and a
 *  page. Never a number of the list's own: the id is the one both sides hold. */
export const itemNumber = (item: Pick<ItemView, 'id'>): string => `#${item.id}`;

/** What a closed item's page says (D-8194): an item opened by its number after it closed is read-only, and says why. Null for an
 *  item still waiting (open, checking). */
export function closedItemWords(state: ItemView['state']): string | null {
  const said = state === 'done' ? 'This item is done.' : state === 'withdrawn' ? 'The coordinator withdrew this item.'
    : state === 'dismissed' ? 'You dismissed this item.' : null;
  return said === null ? null : `${said} There is nothing to do on it.`;
}

/** The Recently cleared trail (D-8194): how many of it show before Show all, and the control's two words. */
export const CLEARED_SHOWN = 5;
export const showAllWord = (n: number): string => `Show all ${n}`;
export const SHOW_FEWER_WORD = 'Show fewer';

/** The Recently cleared trail opened whole, by programme (D-8194): one group per programme in the order of its newest clear (the
 *  trail is newest first), each holding its items in the trail's order. */
export interface ClearedGroup { readonly program: string; readonly items: readonly ItemView[] }
export function clearedGroups(trail: readonly ItemView[]): ClearedGroup[] {
  const by = new Map<string, ItemView[]>();
  for (const i of trail) { const g = by.get(i.program); if (g === undefined) by.set(i.program, [i]); else g.push(i); }
  return [...by].map(([program, items]) => ({ program, items }));
}
/** The line beside a card that links the items its text names (D-8194): a card is one button, so its links sit beside it. */
export const MENTIONS_WORD = 'Mentions';
/** A reference's words on that line. */
export const itemRefWord = (id: number): string => `item ${id}`;
/** A cleared group's count, beside its programme's name. */
export const clearedCountWord = (n: number): string => `${n} cleared`;

/** What the Recently cleared trail draws (D-8194): the items cleared inside `CLEARED_WINDOW_MS` of the page clock, the edge
 *  included as the server's list includes it, newest first (the id breaks a tie). The server sends the same window; this
 *  read keeps a list heard a while ago from showing what has since aged out. A copy: the input is not touched. */
export function clearedTrail(items: readonly ItemView[], now: number): ItemView[] {
  return items
    .filter((i) => i.closedAt !== null && i.closedAt >= now - CLEARED_WINDOW_MS)
    .sort((a, b) => (b.closedAt ?? 0) - (a.closedAt ?? 0) || b.id - a.id);
}

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

/** The pill a limit row wears: stopped with no room, or waiting for the reset the operator chose. A pill says it in words. */
export const limitPill = (l: LimitRow): Pill =>
  l.waiting ? { tone: 'soon', word: LIMIT_WAITING_PILL_WORD } : { tone: 'blocking', word: LIMIT_PILL_WORD };

/** A session asking the operator something: one row, never tickable (it is answered in its own session). */
export interface QuestionRow { readonly sessionId: string; readonly program: string | null; readonly title: string; readonly at: number }

/** The sessions waiting on the operator (`operatorAsk`, the same attention bucket the Inbox door counts), each with its
 *  programme (`sessionProgramme`, the one reader the session's Goals door asks too: its OPEN bound run's, a worker's, or the
 *  run it claims, a coordinator's); `null` when it is in none, which the screen files under "Not in a programme". `at` is
 *  when it entered the bucket (0 when the row carries none). */
export function questionRows(sessions: readonly FleetSession[], runs: readonly RunSummary[]): QuestionRow[] {
  return sessions.filter(operatorAsk).map((s) => ({
    sessionId: s.id,
    program: sessionProgramme(s, runs),
    title: sessionLabel(s),
    at: s.bucketSince ?? 0,
  }));
}

/** A session on a usage limit that the watchdog found no account for (D-8123; `FleetSession.limitWait`): one row, with its own
 *  controls (`LimitWaitRow`). It carries the session itself, because "Swap to…" opens the swap sheet for it. */
export interface LimitRow {
  readonly sessionId: string;
  readonly program: string | null;
  readonly title: string;
  /** Epoch ms the limit sign began. */
  readonly since: number;
  /** Epoch ms the limit resets, or `null` when neither the banner nor the account's window states one. */
  readonly reset: number | null;
  /** The account the session is stopped on. */
  readonly account: string;
  /** A "Wait until reset" choice stands: the operator's (`waitingBy: 'operator'`) or ccrc's own (`'auto'`). */
  readonly waiting: boolean;
  /** Who chose the wait, null when none stands. `'operator'`: the operator's tap, a pin that nothing moves before the reset.
   *  `'auto'`: ccrc chose it because no account had room (D-8173 ruling (a)); not a pin, so ccrc still moves the session if
   *  an account gets room, and the row keeps the wait control that makes it the operator's pin. */
  readonly waitingBy: 'operator' | 'auto' | null;
  readonly session: FleetSession;
}

/** The sessions whose `limitWait` stands, oldest first, each filed under its programme as a question is (`sessionProgramme`).
 *  An item the operator must act on is never hidden (the rollup ruling), so every count a question joins, these join. `runs` may
 *  be left out: a row is then filed under no programme. */
export function limitRows(sessions: readonly FleetSession[], runs: readonly RunSummary[] = []): LimitRow[] {
  const out: LimitRow[] = [];
  for (const s of sessions) {
    const w = s.limitWait;
    if (w === null || w === undefined) continue;
    out.push({
      sessionId: s.id, program: sessionProgramme(s, runs), title: sessionLabel(s),
      since: w.since, reset: w.reset, account: w.account, waiting: w.waiting, waitingBy: w.waitingBy, session: s,
    });
  }
  return out.sort((a, b) => a.since - b.since || a.sessionId.localeCompare(b.sessionId));
}

/** What the Waiting on you door counts: the open items (sent-back ones included) plus the question rows and the sessions on a
 *  usage limit with no account to take them (D-8123). An item being checked is the coordinator's, so it does not count (spec
 *  §2). `limits` defaults to none, so a caller that has no fleet rows asks the sum it always did. */
export const waitingTotal = (items: readonly ItemView[], questions: readonly QuestionRow[], limits: readonly LimitRow[] = []): number =>
  waitingCount(items) + questions.length + limits.length;

/** The chip's number for `program`, off what the fleet store holds: "waiting on you" as spec §2 defines it once, the programme's
 *  open items (sent-back ones included, one being checked not) plus the questions its sessions ask, summed by `waitingTotal`,
 *  the one sum the combined list's side rail (`groupByProgramme`'s `waiting`), the navigation badge and the Goals page's link
 *  read too, so a programme never reads one number on its box and another on its page (ruling 14290). Until the list AND the
 *  fleet frame have landed (`sessions`, as the navigation badge gates them) it answers `null`, as its sibling
 *  `waitingItemsCount` does, because "not heard yet" is not zero; the chip draws nothing for either (carry C, D-7951; review 1386 F9). `runs`
 *  may be `null` (no runs frame yet): a question's programme is then unknown, so it counts for no programme. */
export function programmeWaitingCount(
  view: WaitingView | null, sessions: readonly FleetSession[] | null, runs: readonly RunSummary[] | null, program: string,
): number | null {
  if (view === null || sessions === null) return null;
  return needsYouCount(needsYou(view.items, sessions, runs ?? []), program);
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

/** One line of the list: an item, a session's question, a session on a usage limit with no account to take it (D-8123), or a
 *  run whose review cap waits (its Lift cap control is on the row; runs rebuild §8.7, F21). */
export type Row =
  | { readonly kind: 'item'; readonly item: ItemView }
  | { readonly kind: 'question'; readonly question: QuestionRow }
  | { readonly kind: 'limit'; readonly limit: LimitRow }
  | { readonly kind: 'cap'; readonly run: RunSummary };

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
 *  group the open blocking items come first, then the sessions stopped on a usage limit (D-8123: a stopped session is the most
 *  urgent thing a session can ask), then the session questions, then the review caps that wait (`caps`: the runs `capWaiting`
 *  reads waiting; none by default), then the rest in `orderItems` order. */
export function groupByProgramme(
  items: readonly ItemView[], questions: readonly QuestionRow[], limits: readonly LimitRow[] = [], caps: readonly RunSummary[] = [],
): ProgrammeGroup[] {
  const slugs = new Set<string | null>([
    ...items.map((i) => i.program), ...questions.map((q) => q.program), ...limits.map((l) => l.program), ...caps.map((r) => r.program),
  ]);
  const groups: ProgrammeGroup[] = [];
  for (const program of slugs) {
    const mine = orderItems(items.filter((i) => i.program === program));
    const asks = questions.filter((q) => q.program === program).sort((a, b) => a.at - b.at || a.sessionId.localeCompare(b.sessionId));
    const stopped = limits.filter((l) => l.program === program);
    const capRuns = caps.filter((r) => r.program === program).sort((a, b) => a.id - b.id);
    const isBlocking = (i: ItemView): boolean => i.state === 'open' && i.neededBy === 'blocking';
    const rows: Row[] = [
      ...mine.filter(isBlocking).map((item): Row => ({ kind: 'item', item })),
      ...stopped.map((limit): Row => ({ kind: 'limit', limit })),
      ...asks.map((question): Row => ({ kind: 'question', question })),
      ...capRuns.map((run): Row => ({ kind: 'cap', run })),
      ...mine.filter((i) => !isBlocking(i)).map((item): Row => ({ kind: 'item', item })),
    ];
    groups.push({ program, rows, blocking: mine.some(isBlocking), waiting: waitingTotal(mine, asks, stopped) + capRuns.length });
  }
  const key = (g: ProgrammeGroup): string => g.program ?? '￿';
  return groups.sort((a, b) => Number(b.blocking) - Number(a.blocking) || key(a).localeCompare(key(b)));
}

/** The summary line's counts, in the order the screen prints them. */
export interface SummaryCounts { blocking: number; questions: number; limits: number; caps: number; soon: number; checking: number; cameBack: number }

export function summaryCounts(
  items: readonly ItemView[], questions: readonly QuestionRow[], limits: readonly LimitRow[] = [], caps: readonly RunSummary[] = [],
): SummaryCounts {
  // Each open item is counted once: one that came back is counted as that, whatever its needed-by says.
  const open = items.filter((i) => i.state === 'open');
  const fresh = open.filter((i) => !cameBack(i));
  return {
    blocking: fresh.filter((i) => i.neededBy === 'blocking').length,
    questions: questions.length,
    limits: limits.length,
    caps: caps.length,
    soon: fresh.filter((i) => i.neededBy === 'soon').length,
    checking: items.filter((i) => i.state === 'checking').length,
    cameBack: open.length - fresh.length,
  };
}

/** THE SUMMARY OF WHAT A PAGE DRAWS (review 1537 F4): the counts over the rows of the groups the list draws (`listGroups`), so
 *  under a programme filter the pills count that programme's items and questions only, and unfiltered, every group's, which
 *  is every item and question (`groupByProgramme` files each in exactly one group). */
export function shownSummary(groups: readonly ProgrammeGroup[]): SummaryCounts {
  const rows = groups.flatMap((g) => g.rows);
  return summaryCounts(
    rows.flatMap((r) => (r.kind === 'item' ? [r.item] : [])),
    rows.flatMap((r) => (r.kind === 'question' ? [r.question] : [])),
    rows.flatMap((r) => (r.kind === 'limit' ? [r.limit] : [])),
    rows.flatMap((r) => (r.kind === 'cap' ? [r.run] : [])),
  );
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** The summary pills as `{tone, text}`, zero counts left out. */
export function summaryWords(c: SummaryCounts): { tone: PillTone; text: string }[] {
  const out: { tone: PillTone; text: string }[] = [];
  if (c.blocking > 0) out.push({ tone: 'blocking', text: `${c.blocking} blocking now` });
  if (c.questions > 0) out.push({ tone: 'ask', text: plural(c.questions, 'question from a session', 'questions from sessions') });
  if (c.limits > 0) out.push({ tone: 'blocking', text: plural(c.limits, 'session on a usage limit', 'sessions on a usage limit') });
  if (c.caps > 0) out.push({ tone: 'ask', text: plural(c.caps, 'review cap to lift', 'review caps to lift') });
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

/** The line over a list drawn from the device's copy (console speed, Task C4; spec §2.6, D16): when it was saved, and that
 *  it is not current. It stands where the waiting line stands with no copy. */
export function savedListWords(savedAt: number, now: number): string {
  return `Saved on this device ${ageWords(savedAt, now)}, not current. Waiting for live data…`;
}
/** The line over the live list drawn with the device's rows, before the fleet's live rows have landed. */
export const SAVED_ROWS_WORD = 'Sessions as last saved on this device, not current. Waiting for live data…';
/** Beside an item's acts while it is drawn from the device's copy: why they are off. */
export const NOT_CURRENT_ACTS_WORD = 'You can act on this item once live data arrives.';

// ── moving between items (plan PL9; spec §2 "Moving between items", D23) ───────────────────────────────────────────
//
// An opened item steps to the previous and next item OF THE LIST IT WAS OPENED FROM, in that list's own order and filter. There
// is ONE ORDER: `groupByProgramme`'s groups, which the combined list and its side rail's filter draw, read through `listGroups`;
// the neighbours are read off those same groups, so no second ordering exists to drift from the drawn one. A session's question
// is a row of the list but not an item (it opens its session), so the steps go from item to item.
//
// THERE IS ONE LIST (desktop-polish PL11, D-7986; spec §2, D29). The programme view drew its own share of the list until PL11;
// that identity folded into the combined list's programme filter, so the navigation, a programme box's chip and the
// programme's Goals page all open the one list, the last two filtered, and an old `programme:<slug>` link reads as that filter.

/** The list an item was opened from: the combined list, unfiltered (`programme: null`) or filtered by its side rail to one
 *  programme. One arm: `at` is kept so the word in the URL and every caller read as before.
 *
 *  `back: 'goals'` (review 1537 F2, keeping review 1402's F3): the item was opened from its programme's Goals page, so its way
 *  back and its Dismiss return to that page, not to the list; its steps still go along the programme's filtered list. Absent:
 *  the way back is the list. Only a filtered list carries it: the Goals page is a programme's. */
export type ItemList = { readonly at: 'waiting'; readonly programme: string | null; readonly back?: 'goals' };

/** The combined list, unfiltered: where an item opened with no list, or with one this page cannot read, steps and goes back. */
export const COMBINED_LIST: ItemList = { at: 'waiting', programme: null };

/** The side rail's filter to the sessions in no programme, as the list's URL holds it (`?programme=`, empty): no slug is
 *  empty (`shapeProgramSlug`), so it names no programme. No item can be opened from it: it holds questions only. */
export const NO_PROGRAMME_FILTER = '';

/** The words of the strip above an item (plan PL9). The step controls' names hold their shown words (WCAG 2.5.3). */
export const BETWEEN_ITEMS_LABEL = 'Between items';
export const PREVIOUS_WORD = 'Previous';
export const NEXT_WORD = 'Next';
export const PREVIOUS_ITEM_LABEL = 'Previous item';
export const NEXT_ITEM_LABEL = 'Next item';
export const BESIDE_LABEL = 'The list beside this item';
/** An item no list holds and none ever showed: an id that names nothing now. */
export const GONE_WORD = 'That item is not on the list any more.';
/** The open item left the list while the operator was on it (confirmed, withdrawn): its steps stay where they were. */
export const LEFT_LIST_WORD = 'This item is not on the list now.';
/** The way back's name: the list's own name after "Back to". */
export const backLabel = (listName: string): string => `Back to ${listName}`;

const isSlug = (s: string): boolean => { const shaped = shapeProgramSlug(s); return shaped.ok && shaped.slug === s; };

/** The list as one word for the item's URL (`?from=`), so a reload or a shared link keeps it: `waiting`, `waiting:<slug>`, or
 *  `goals:<slug>` for an item opened from that programme's Goals page. A slug never holds `:` (`shapeProgramSlug`), so the word
 *  reads back unambiguously. */
export function fromWord(list: ItemList): string {
  if (list.programme === null) return 'waiting';
  return `${list.back === 'goals' ? 'goals' : 'waiting'}:${list.programme}`;
}

/** The item path's query naming the list it was opened from (plan PL9): it rides the URL, so a reload or a shared link keeps it.
 *  The combined list's own query, its side rail's filter, is `PROGRAMME_FILTER_QUERY` (`lib/routes.ts`, beside `waitingPath`).
 *  Moved here from `WaitingRoutes.tsx` with `itemPath`, so chat's resolver, an L1 module, can ask it (chat reading Task L,
 *  D-8062). */
export const FROM_QUERY = 'from';

/** The one builder of an item's path, `/waiting/<id>`, which the `item` row of the route table parses, with `?from=` naming the
 *  list it is opened from (plan PL9). The combined list, unfiltered, is the default and writes no query. */
export const itemPath = (id: number, list: ItemList = COMBINED_LIST): string =>
  `${waitingPath()}/${id}${list.programme === null ? '' : `?${new URLSearchParams({ [FROM_QUERY]: fromWord(list) })}`}`;

/** The list a `from` word names, or the combined list for a word that names none (absent, unknown or malformed). An older page's
 *  `programme:<slug>` (its programme view's share of the list, before PL11) names the combined list filtered to that programme;
 *  `goals:<slug>` names the same filtered list, with its way back to that programme's Goals page. */
export function listOfFromWord(word: string | null): ItemList {
  if (word === 'waiting') return COMBINED_LIST;
  const m = word === null ? null : /^(waiting|programme|goals):([^:]+)$/.exec(word);
  if (m === null || !isSlug(m[2]!)) return COMBINED_LIST;
  return m[1] === 'goals' ? { at: 'waiting', programme: m[2]!, back: 'goals' } : { at: 'waiting', programme: m[2]! };
}

/** The programme whose Goals page an item's way back and its Dismiss return to (`back: 'goals'`, review 1537 F2), or `null`: they
 *  return to the list. Read off the list the item's URL names, never the settled one: a programme with nothing on the list now
 *  settles to the combined list, and its Goals page is still where the item was opened. */
export const goalsBack = (list: ItemList): string | null => (list.back === 'goals' ? list.programme : null);

/** THE ONE STALE-LIST RULE: a filter naming a programme no group holds (an old link, a programme with nothing waiting now, a
 *  well-formed slug nobody uses) is the combined list. The filter, the way back to the list, the column beside an item and the
 *  steps all settle the list they were given through this, so none of them returns to a filter the side rail no longer
 *  offers. The way back to a Goals page is not settled (`goalsBack` reads the list the URL names): that page stands whether
 *  or not its programme has anything on the list. */
export function resolveList(list: ItemList, groups: readonly ProgrammeGroup[]): ItemList {
  return list.programme === null || groups.some((g) => g.program === list.programme) ? list : COMBINED_LIST;
}

/** THE GROUPS A LIST DRAWS, in its order, from `groupByProgramme`'s: every group for the combined list; the programme's own group
 *  for its filter. A filter to a programme with no group is stale (`resolveList`) and draws every group. */
export function listGroups(list: ItemList, groups: readonly ProgrammeGroup[]): readonly ProgrammeGroup[] {
  const settled = resolveList(list, groups);
  return settled.programme === null ? groups : groups.filter((g) => g.program === settled.programme);
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
  const named = resolveList(list, groups);
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

/** The place as a screen reader hears it (follow-up A-3): "3 of 6, <the open item's title>", so a step that lands on the same
 *  "N of M" still announces something new; empty with no place, and the place alone with no title (the item gone while its
 *  place is kept: never "3 of 6, ", carry C, D-7951; review 1408 F3). */
export const positionWords = (place: ItemPlace | null, title: string): string =>
  (place === null ? '' : title === '' ? placeWords(place) : `${placeWords(place)}, ${title}`);
