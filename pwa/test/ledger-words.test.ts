// The Waiting on you list's pure decisions (desktop-polish PL5a, D-7712; review 1359 F3, F5, F7, F8, F13d). Each case names
// what it pins; the screen's and the routes' tests read the same words through their components.
import { describe, expect, it } from 'vitest';
import {
  COMBINED_LIST, fromWord, goalsBack, groupByProgramme, itemPills, itemPlace, listGroups, listOfFromWord, openRunsOf,
  limitRows, positionWords, programmeIsLive, programmeWaitingCount, questionRows, resolveList, shownSummary, summaryCounts, summaryWords, waitingTotal,
  type ItemList, type QuestionRow, CLEARED_SHOWN, clearedGroups, clearedTrail, itemNumber, type ClearedEntry, CALL_CLEARED_WORD, callClearedHow, callClearedOn,
} from '../src/ledgers/ledgerWords';
import { RATIFICATION_UNREADABLE_WORDS, RATIFY_UNAVAILABLE_TEXT, doneWhenPlacement, ratificationWords, ratifyFailureOf, ratifyOffered } from '../src/ledgers/ledgerWords';
import type { GoalsView, Ratification, RatificationWhy } from '../../shared/ledgers';
import { CLEARED_WINDOW_MS } from '../../shared/ledgers';
import type { AskMarkRow } from '../../shared/answerMarks';
import type { CallView } from '../../shared/api';
import { isWaitingView } from '../src/ledgers/waitingView';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';
import { sessionProgramme } from '../src/fleet/runWords';

const ask = (sessionId: string, program: string | null, at = NOW - MIN): QuestionRow => ({ sessionId, program, title: sessionId, at });

describe('groupByProgramme', () => {
  it('an item being checked is not blocking: its programme does not sort first and it does not lead its group', () => {
    const groups = groupByProgramme([
      itemView({ id: 1, program: 'prog-a', neededBy: 'soon' }),
      itemView({ id: 2, program: 'prog-b', neededBy: 'blocking', state: 'checking', tickedAt: NOW - MIN }),
    ], []);
    expect(groups.map((g) => [g.program, g.blocking])).toEqual([['prog-a', false], ['prog-b', false]]);
    const mixed = groupByProgramme([
      itemView({ id: 3, program: 'prog-a', neededBy: 'blocking', state: 'checking', tickedAt: NOW - MIN }),
      itemView({ id: 4, program: 'prog-a', neededBy: 'soon' }),
    ], [ask('project-a-ask', 'prog-a')]);
    const kinds = mixed[0]!.rows.map((r) => (r.kind === 'item' ? `item ${r.item.id}` : r.kind === 'question' ? `question ${r.question.sessionId}` : r.kind === 'cap' ? `cap ${r.run.id}` : `limit ${r.limit.sessionId}`));
    // The question is the operator's and comes first; the item the coordinator holds follows in `orderItems` order.
    expect(kinds).toEqual(['question project-a-ask', 'item 3', 'item 4']);
  });

  it('an open blocking item leads its group and its programme sorts first', () => {
    const groups = groupByProgramme([
      itemView({ id: 1, program: 'prog-a', neededBy: 'soon' }),
      itemView({ id: 2, program: 'prog-z', neededBy: 'blocking' }),
    ], [ask('project-a-ask', 'prog-z')]);
    expect(groups.map((g) => g.program)).toEqual(['prog-z', 'prog-a']);
    expect(groups[0]!.rows.map((r) => r.kind)).toEqual(['item', 'question']);
  });

  it('a group counts its open items and its questions once each, and not what is being checked', () => {
    const groups = groupByProgramme([
      itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-a', neededBy: 'later' }),
      itemView({ id: 3, program: 'prog-a', state: 'checking', tickedAt: NOW - MIN }),
    ], [ask('project-a-ask', 'prog-a'), ask('project-b-ask', null)]);
    expect(groups.map((g) => [g.program, g.waiting])).toEqual([['prog-a', 3], [null, 1]]);
  });

  it('the groups add up to the door count', () => {
    const items = [itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-b', state: 'checking' })];
    const questions = [ask('project-a-ask', 'prog-a'), ask('project-b-ask', null)];
    const total = groupByProgramme(items, questions).reduce((n, g) => n + g.waiting, 0);
    expect(total).toBe(waitingTotal(items, questions));
    expect(total).toBe(3);
  });
});

describe('questionRows', () => {
  it('a session whose bound run and claimed run name different programmes is one row, under its bound run', () => {
    const runs = [
      runRow({ id: 5, program: 'prog-a', sessionId: 'project-a-ask' }),
      runRow({ id: 6, program: 'prog-b', claimedBy: 'project-a-ask' }),
    ];
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'Which one?', bucketSince: NOW - MIN });
    const rows = questionRows(withRunBinding([asking], runs), runs);
    expect(rows.map((r) => [r.sessionId, r.program])).toEqual([['project-a-ask', 'prog-a']]);
  });

  // The session's programme has ONE reader (desktop-polish PL11, D-7986): the question rows and the session's Goals door both
  // ask `sessionProgramme`, so a session never files its question under one programme and opens another's Goals.
  it('the row\'s programme is the session\'s one reader: its bound open run\'s, else the open run it claims, else none', () => {
    const runs = [
      runRow({ id: 5, program: 'prog-a', sessionId: 'project-a-w1' }),
      runRow({ id: 6, program: 'prog-b', claimedBy: 'project-a-coord' }),
      runRow({ id: 7, program: 'prog-c', claimedBy: 'project-a-old', state: 'done', closedAt: NOW }),
    ];
    const sessions = withRunBinding(['project-a-w1', 'project-a-coord', 'project-a-old', 'project-a-solo']
      .map((id) => fleetSession({ id, bucket: 'attention', title: id })), runs);
    expect(sessions.map((s) => sessionProgramme(s, runs))).toEqual(['prog-a', 'prog-b', null, null]);
    expect(questionRows(sessions, runs).map((r) => r.program)).toEqual(sessions.map((s) => sessionProgramme(s, runs)));
  });

  it('a session in no programme is one row with no programme', () => {
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'Which one?' });
    expect(questionRows([asking], []).map((r) => r.program)).toEqual([null]);
  });
});

describe('itemPills (the spec: a needed-by label whatever the state)', () => {
  it('an open item wears its needed-by pill alone', () => {
    expect(itemPills(itemView({ neededBy: 'blocking' }))).toEqual([{ tone: 'blocking', word: 'Blocking' }]);
    expect(itemPills(itemView({ neededBy: 'soon', soonLabel: 'before Friday' }))).toEqual([{ tone: 'soon', word: 'before Friday' }]);
    expect(itemPills(itemView({ neededBy: 'later' }))).toEqual([{ tone: 'later', word: 'Later' }]);
  });

  it('a checking item wears its state and its needed-by, and a stale one says so', () => {
    expect(itemPills(itemView({ state: 'checking', neededBy: 'blocking' })).map((p) => p.word)).toEqual(['Checking…', 'Blocking']);
    expect(itemPills(itemView({ state: 'checking', stale: true, neededBy: 'later' })).map((p) => p.word))
      .toEqual(['ticked; coordinator not responding', 'Later']);
  });

  it('a sent-back blocking item says Came back and still says Blocking', () => {
    const back = itemView({ neededBy: 'blocking', history: [{ at: 1, act: 'raise', note: null }, { at: 2, act: 'return', note: 'no' }] });
    expect(itemPills(back).map((p) => p.word)).toEqual(['Came back', 'Blocking']);
  });
});

describe('openRunsOf (the one measurement the wave label and the liveness both read)', () => {
  it('is the programme\'s open runs: its own, and not a closed one', () => {
    const runs = [
      runRow({ id: 1, program: 'prog-a', state: 'working' }), runRow({ id: 2, program: 'prog-a', state: 'done' }),
      runRow({ id: 3, program: 'prog-b', state: 'working' }), runRow({ id: 4, program: 'prog-a', state: 'planned' }),
    ];
    expect(openRunsOf('prog-a', runs).map((r) => r.id)).toEqual([1, 4]);
    expect(openRunsOf('prog-c', runs)).toEqual([]);
    expect(programmeIsLive('prog-a', runs)).toBe(openRunsOf('prog-a', runs).length > 0);
  });
});

describe('programmeIsLive (one decision, on the runs board\'s own reader)', () => {
  const runs = [runRow({ id: 1, program: 'prog-a', state: 'working' }), runRow({ id: 2, program: 'prog-b', state: 'done' })];
  it('is true for a programme with an open run, false for one with none', () => {
    expect(programmeIsLive('prog-a', runs)).toBe(true);
    expect(programmeIsLive('prog-b', runs)).toBe(false);
    expect(programmeIsLive('prog-c', runs)).toBe(false);
  });
  it('is true while the runs are unheard: an unknown run counts as open, never as ended', () => {
    expect(programmeIsLive('prog-b', null)).toBe(true);
  });
});

describe('isWaitingView', () => {
  it('takes exactly a list of three arrays', () => {
    expect(isWaitingView(waitingView())).toBe(true);
    for (const bad of [null, undefined, 'x', {}, { items: [] }, { items: [], cleared: [] }, { items: {}, cleared: [], goals: [] },
      { items: [], cleared: 'x', goals: [] }, { items: [], cleared: [], goals: null }]) {
      expect(isWaitingView(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});

// PL5b: the programme box's chip. Its number is `programmeWaitingCount`, decided here once and the same sum the programme view's
// heading reads (`groupByProgramme`'s `waiting`): the programme's open items plus its sessions' questions (ruling 14290).
describe('programmeWaitingCount (the chip\'s count)', () => {
  const runs = [runRow({ id: 1, program: 'prog-a', state: 'working', sessionId: 'project-a-ask' })];
  const asker = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'A question', bucketSince: NOW - MIN });
  const sessions = withRunBinding([asker], runs);
  const view = waitingView({
    items: [
      itemView({ id: 1, program: 'prog-a' }),
      itemView({ id: 2, program: 'prog-a', state: 'checking', tickedAt: NOW - MIN }),
      itemView({ id: 3, program: 'prog-a', state: 'open', history: [
        { at: NOW - 30 * MIN, act: 'raise', note: null }, { at: NOW - 5 * MIN, act: 'return', note: 'not yet' }] }),
      itemView({ id: 4, program: 'prog-b' }),
    ],
  });
  it('counts the programme\'s open items and its sessions\' questions: a sent-back item included, one being checked not', () => {
    expect(programmeWaitingCount(view, sessions, runs, 'prog-a')).toBe(2 + 1);
    expect(programmeWaitingCount(view, sessions, runs, 'prog-b')).toBe(1);
  });
  it('is the programme view\'s heading figure: the group\'s `waiting` is the same number', () => {
    const group = groupByProgramme(view.items, questionRows(sessions, runs)).find((g) => g.program === 'prog-a')!;
    expect(programmeWaitingCount(view, sessions, runs, 'prog-a')).toBe(group.waiting);
    expect(programmeWaitingCount(view, sessions, runs, 'prog-b')).toBe(groupByProgramme(view.items, questionRows(sessions, runs)).find((g) => g.program === 'prog-b')!.waiting);
  });
  it('a question of another programme, or of none, is not this programme\'s', () => {
    expect(programmeWaitingCount(waitingView(), sessions, runs, 'prog-b')).toBe(0);
    expect(programmeWaitingCount(waitingView(), sessions, [], 'prog-a')).toBe(0); // runs unheard: its programme is unknown
  });
  it('is zero for a programme with nothing open, and null until the list and the fleet frame have both been heard', () => {
    expect(programmeWaitingCount(view, sessions, runs, 'prog-c')).toBe(0);
    // Not heard yet is not zero (carry C, D-7951; review 1386 F9): null, as its sibling `waitingItemsCount` answers.
    expect(programmeWaitingCount(null, sessions, runs, 'prog-a')).toBeNull();
    expect(programmeWaitingCount(view, null, runs, 'prog-a')).toBeNull();
    expect(programmeWaitingCount(waitingView({ items: [itemView({ state: 'done', closedAt: NOW })] }), [], [], 'prog-a')).toBe(0);
  });
});

// ── moving between items (plan PL9; spec §2 "Moving between items", D23) ──────────────────────────────────────────
describe('the list an item was opened from rides the URL as one word', () => {
  const LISTS: readonly (readonly [string, ItemList])[] = [
    ['waiting', { at: 'waiting', programme: null }],
    ['waiting:prog-a', { at: 'waiting', programme: 'prog-a' }],
    // An item opened from its programme's Goals page (review 1537 F2): the same filtered list, its way back that Goals page.
    ['goals:prog-a', { at: 'waiting', programme: 'prog-a', back: 'goals' }],
  ];
  it.each(LISTS)('%s reads back as the list it names, and that list writes it', (word, list) => {
    expect(listOfFromWord(word)).toEqual(list);
    expect(fromWord(list)).toBe(word);
  });
  // ONE WAITING ON YOU PAGE (desktop-polish PL11, D-7986; spec §2, D29): the programme view's own share of the list is gone, so
  // an old `programme:<slug>` word names the combined list filtered to that programme, and is written as that list's word.
  it('an old from=programme word reads as the combined list filtered to that programme', () => {
    expect(listOfFromWord('programme:prog-b')).toEqual({ at: 'waiting', programme: 'prog-b' });
    expect(fromWord(listOfFromWord('programme:prog-b'))).toBe('waiting:prog-b');
  });
  // REVIEW 1537 F2 (keeping review 1402's F3): the way back of an item opened from Goals is read off the list its URL names.
  it("an item opened from Goals goes back to that programme's Goals page; any other list goes back to the list", () => {
    expect(goalsBack(listOfFromWord('goals:prog-a'))).toBe('prog-a');
    expect(goalsBack(listOfFromWord('waiting:prog-a'))).toBeNull();
    expect(goalsBack(listOfFromWord('programme:prog-a'))).toBeNull();
    expect(goalsBack(COMBINED_LIST)).toBeNull();
    // Its steps go along the programme's filtered list, as that list's own do, and keep the way back.
    const groups = groupByProgramme([itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-a' }),
      itemView({ id: 3, program: 'prog-b' })], []);
    const place = itemPlace(1, listOfFromWord('goals:prog-a'), groups);
    expect(place?.next).toBe(2);
    expect(place?.total).toBe(2);
    expect(fromWord(place!.list)).toBe('goals:prog-a');
  });
  it.each([null, '', 'fleet', 'waiting:', 'programme:', 'programme:../x', 'programme:a b', 'waiting:prog-a:x', 'PROGRAMME:prog-a',
    'goals:', 'goals:../x', 'GOALS:prog-a'])(
    'an unknown or malformed word (%j) falls back to the combined list', (word) => {
      expect(listOfFromWord(word)).toEqual(COMBINED_LIST);
    });
});

describe('itemPlace: previous and next in the order and filter of the list the item was opened from', () => {
  // prog-b holds the blocking item, so it sorts first though it is second by slug; a session's question sits in prog-a.
  const items = [
    itemView({ id: 1, program: 'prog-a', neededBy: 'later' }),
    itemView({ id: 2, program: 'prog-b', neededBy: 'soon' }),
    itemView({ id: 3, program: 'prog-b', neededBy: 'blocking' }),
    itemView({ id: 4, program: 'prog-a', neededBy: 'soon' }),
    itemView({ id: 5, program: 'prog-b', neededBy: 'later', state: 'checking', tickedAt: NOW - MIN }),
  ];
  const groups = groupByProgramme(items, [ask('prog-a-w1', 'prog-a')]);
  /** The item ids the screen draws, in its order: read off the same groups the screen draws. */
  const drawn = (list: ItemList): number[] =>
    listGroups(list, groups).flatMap((g) => g.rows).flatMap((r) => (r.kind === 'item' ? [r.item.id] : []));

  it('the combined list: every programme\'s items in the order the list draws them, questions skipped', () => {
    expect(drawn(COMBINED_LIST)).toEqual([3, 2, 5, 4, 1]);
    expect(itemPlace(2, COMBINED_LIST, groups)).toEqual({ list: COMBINED_LIST, index: 1, total: 5, prev: 3, next: 5 });
  });

  it('the side rail\'s filter to one programme steps inside that programme only', () => {
    const filtered: ItemList = { at: 'waiting', programme: 'prog-a' };
    expect(itemPlace(4, filtered, groups)).toEqual({ list: filtered, index: 0, total: 2, prev: null, next: 1 });
    expect(itemPlace(1, filtered, groups)).toEqual({ list: filtered, index: 1, total: 2, prev: 4, next: null });
  });

  it('the first item has no previous and the last no next', () => {
    expect(itemPlace(3, COMBINED_LIST, groups)).toMatchObject({ index: 0, prev: null, next: 2 });
    expect(itemPlace(1, COMBINED_LIST, groups)).toMatchObject({ index: 4, prev: 4, next: null });
    expect(itemPlace(2, { at: 'waiting', programme: 'prog-b' }, groups)).toMatchObject({ index: 1, total: 3, prev: 3, next: 5 });
  });

  it('a list that does not hold the item (a stale link) falls back to the combined list', () => {
    expect(itemPlace(2, { at: 'waiting', programme: 'prog-a' }, groups)).toEqual({ list: COMBINED_LIST, index: 1, total: 5, prev: 3, next: 5 });
    expect(itemPlace(2, { at: 'waiting', programme: 'prog-gone' }, groups)).toEqual({ list: COMBINED_LIST, index: 1, total: 5, prev: 3, next: 5 });
  });

  it('an item no list holds (recently cleared, or gone) has no place', () => {
    expect(itemPlace(9, COMBINED_LIST, groups)).toBeNull();
    expect(itemPlace(9, { at: 'waiting', programme: 'prog-a' }, groups)).toBeNull();
  });

  it('the filter to a programme with no group shows every group, as the side rail does', () => {
    expect(listGroups({ at: 'waiting', programme: 'prog-gone' }, groups)).toEqual(groups);
  });

  it('resolveList is the one stale-list rule: a filter naming a programme no group holds is the combined list, any other stands', () => {
    for (const list of [COMBINED_LIST, { at: 'waiting', programme: 'prog-a' }, { at: 'waiting', programme: 'prog-b' }] as ItemList[]) {
      expect(resolveList(list, groups), fromWord(list)).toBe(list);
    }
    expect(resolveList({ at: 'waiting', programme: 'prog-gone' }, groups)).toEqual(COMBINED_LIST);
    expect(resolveList({ at: 'waiting', programme: 'zzz' }, [])).toEqual(COMBINED_LIST);
  });

  it('the position as announced carries the item\'s title, so a step that keeps "N of M" still says something new (follow-up A-3)', () => {
    expect(positionWords({ list: COMBINED_LIST, index: 1, total: 3, prev: 10, next: 12 }, 'Item 11')).toBe('2 of 3, Item 11');
    expect(positionWords(null, 'Item 11')).toBe('');
    // No title (the item is gone and its place kept): the place alone (carry C, D-7951; review 1408 F3).
    expect(positionWords({ list: COMBINED_LIST, index: 1, total: 3, prev: 10, next: 12 }, '')).toBe('2 of 3');
  });
});

// ── the summary counts what the page draws (review 1537 F4) ───────────────────────────────────────────────────────────
describe('the summary pills count the groups the list draws', () => {
  const ITEMS = [
    itemView({ id: 1, program: 'prog-b', neededBy: 'blocking' }), itemView({ id: 2, program: 'prog-b', neededBy: 'soon' }),
    itemView({ id: 3, program: 'prog-a', neededBy: 'soon' }), itemView({ id: 4, program: 'prog-a', state: 'checking' }),
  ];
  const QUESTIONS: QuestionRow[] = [{ sessionId: 's-b', program: 'prog-b', title: 'Ask', at: NOW }];
  const groups = groupByProgramme(ITEMS, QUESTIONS);
  it("unfiltered, every group's: the whole list's counts", () => {
    expect(shownSummary(listGroups(COMBINED_LIST, groups))).toEqual(summaryCounts(ITEMS, QUESTIONS));
  });
  it("filtered to prog-a, prog-a's alone: prog-b's blocking item and question do not reach it", () => {
    expect(shownSummary(listGroups({ at: 'waiting', programme: 'prog-a' }, groups)))
      .toEqual({ blocking: 0, questions: 0, limits: 0, caps: 0, soon: 1, checking: 1, cameBack: 0 });
  });
});

// D-8123 (limit-swap-autofix Task 11): a session the limit watchdog found no account for (`FleetSession.limitWait`) is an
// item the operator must act on, so it is NEVER hidden: it counts wherever a question counts (the door badge, the
// programme chip, the side rail) and is filed under its programme as a question is.
describe('limitRows (a session on a limit with no account to take it)', () => {
  const stuck = (id: string, over: object = {}) => fleetSession({
    id, title: `Title of ${id}`,
    limitWait: { since: NOW - 10 * MIN, reset: NOW + 60 * MIN, account: 'lane-a', waiting: false, waitingBy: null, ...over },
  });
  it('lists exactly the sessions whose limitWait is not null, oldest first', () => {
    const rows = limitRows([stuck('s-b', { since: NOW - MIN }), fleetSession({ id: 's-none' }), stuck('s-a', { since: NOW - 30 * MIN })]);
    expect(rows.map((r) => r.sessionId)).toEqual(['s-a', 's-b']);
    expect(rows[0]).toMatchObject({ title: 'Title of s-a', since: NOW - 30 * MIN, reset: NOW + 60 * MIN, account: 'lane-a', waiting: false, waitingBy: null, program: null });
    // Who chose the wait rides along (D-8173): ccrc's own is not the operator's pin, and the row words it differently.
    expect(limitRows([stuck('s-c', { waiting: true, waitingBy: 'auto' })])[0]).toMatchObject({ waiting: true, waitingBy: 'auto' });
  });
  it('files a row under its programme as a question is (the run it is bound to)', () => {
    const runs = [runRow({ id: 1, program: 'prog-a', state: 'working', sessionId: 's-a' })];
    const sessions = withRunBinding([stuck('s-a')], runs);
    expect(limitRows(sessions, runs).map((r) => r.program)).toEqual([sessionProgramme(sessions[0]!, runs)]);
    expect(limitRows(sessions, runs)[0]!.program).toBe('prog-a');
  });
  it('counts in the total, the programme chip, the side-rail group and the summary', () => {
    const runs = [runRow({ id: 1, program: 'prog-a', state: 'working', sessionId: 's-a' })];
    const sessions = withRunBinding([stuck('s-a')], runs);
    const limits = limitRows(sessions, runs);
    const items = [itemView({ id: 1, program: 'prog-a' })];
    expect(waitingTotal(items, [], limits)).toBe(2);
    expect(waitingTotal(items, [])).toBe(1);
    const view = waitingView({ items });
    expect(programmeWaitingCount(view, sessions, runs, 'prog-a')).toBe(2);
    expect(programmeWaitingCount(view, sessions, runs, 'prog-b')).toBe(0);
    const group = groupByProgramme(items, [], limits).find((g) => g.program === 'prog-a')!;
    expect(group.waiting).toBe(2);
    expect(group.rows.map((r) => r.kind)).toEqual(['limit', 'item']);
    expect(shownSummary(listGroups(COMBINED_LIST, groupByProgramme(items, [], limits)))).toMatchObject({ limits: 1 });
  });
  it('a limit row alone makes a group, and opening the list steps over it (it is not an item)', () => {
    const groups = groupByProgramme([], [], limitRows([stuck('s-a')]));
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ program: null, waiting: 1 });
    expect(itemPlace(1, COMBINED_LIST, groups)).toBeNull();
  });
});

describe('review caps in the grouping (Task 24, F21)', () => {
  const cap = (id: number, program: string) => runRow({ id, program, reviewCap: { rounds: 3, cap: 3, askedAt: 5, liftedAt: null } } as never);

  it('a waiting cap is a row of its programme, after the questions and before the other items, and it counts in the group', () => {
    const groups = groupByProgramme([
      itemView({ id: 3, program: 'prog-a', neededBy: 'blocking' }), itemView({ id: 4, program: 'prog-a', neededBy: 'soon' }),
    ], [], [], [cap(12, 'prog-a')]);
    expect(groups[0]!.rows.map((r) => (r.kind === 'item' ? `item ${r.item.id}` : r.kind === 'cap' ? `cap ${r.run.id}` : 'q'))).toEqual(['item 3', 'cap 12', 'item 4']);
    expect(groups[0]!.waiting).toBe(3);
  });

  it('a programme with only a cap still has a group, and the summary counts it', () => {
    const groups = groupByProgramme([], [], [], [cap(12, 'prog-c'), cap(13, 'prog-c')]);
    expect(groups.map((g) => [g.program, g.waiting])).toEqual([['prog-c', 2]]);
    expect(shownSummary(groups).caps).toBe(2);
    expect(summaryWords(shownSummary(groups)).map((w) => w.text)).toEqual(['2 review caps to lift']);
  });

  it('an item\'s place in a list ignores the cap rows', () => {
    const groups = groupByProgramme([itemView({ id: 3, program: 'prog-a' }), itemView({ id: 4, program: 'prog-a' })], [], [], [cap(12, 'prog-a')]);
    expect(itemPlace(4, COMBINED_LIST, groups)).toMatchObject({ index: 1, total: 2, prev: 3, next: null });
  });
});

// D-8194: the Recently cleared trail is the last 48 hours (CLEARED_WINDOW_MS, the server's window too), newest first.
describe('clearedTrail and itemNumber (D-8194)', () => {
  const idOf = (e: ClearedEntry): string => (e.kind === 'item' ? `i${e.item.id}` : e.kind === 'ask' ? `a${e.ask.id}` : `c${e.call.id}`);
  const HOUR = 60 * MIN;
  const done = (id: number, closedAt: number | null) => itemView({ id, state: 'done', closedAt });

  it('the window is 48 hours, one shared constant', () => {
    expect(CLEARED_WINDOW_MS).toBe(48 * HOUR);
  });

  it('keeps what was cleared inside the window, edge included, newest first; drops the older and the undated', () => {
    const items = [done(1, NOW - 2 * HOUR), done(2, NOW - CLEARED_WINDOW_MS), done(3, NOW - CLEARED_WINDOW_MS - 1), done(4, NOW - HOUR), done(5, null)];
    expect(clearedTrail(items, NOW).map(idOf)).toEqual(['i4', 'i1', 'i2']);
  });

  // Answer marks B: the asks the operator has that are not live join the trail by their time.
  const NEVER = { state: 'never' as const };
  const ask = (id: number, at: number, o: Partial<AskMarkRow> = {}): AskMarkRow => ({
    id, childId: `lane-a-${id}`, program: 'prog-a', question: 'q?', how: 'lapsed', reason: null, at, live: false,
    answerMarks: { couldAnswer: NEVER, unsure: NEVER }, ...o,
  });

  it('orders items and asks that are not live together by their time, an item first at the same instant; a live ask is not in it', () => {
    const items = [done(1, NOW - 2 * HOUR), done(2, NOW - 4 * HOUR)];
    const asks = [ask(1, NOW - HOUR), ask(3, NOW - 3 * HOUR), ask(4, NOW - 2 * HOUR), ask(5, NOW - 30 * MIN, { live: true }),
      ask(6, NOW - 30 * MIN, { live: 'unmeasured' }), ask(7, NOW - CLEARED_WINDOW_MS - 1)];
    expect(clearedTrail(items, NOW, asks).map(idOf)).toEqual(['a6', 'a1', 'i1', 'a4', 'a3', 'i2']);
  });

  it('groups the trail by programme in the order of its newest clear, the asks in no programme as one group', () => {
    const trail = clearedTrail([done(1, NOW - 2 * HOUR)], NOW, [ask(2, NOW - HOUR, { program: null }), ask(3, NOW - 3 * HOUR), ask(4, NOW - 4 * HOUR, { program: null })]);
    expect(clearedGroups(trail).map((g) => [g.program, g.entries.map(idOf)])).toEqual([[null, ['a2', 'a4']], ['prog-a', ['i1', 'a3']]]);
  });

  // D-8126 A4: a big call that left "Calls made for you" joins the trail. Its time there is the operator's own clear (Seen or
  // Overturn, the earlier), or when it was made for one that aged out (the wire carries no other); the server's list is its window.
  const call = (id: number, o: Partial<CallView> = {}): CallView => ({
    id, program: 'prog-a', runId: null, madeBy: 'coord', class: 'big', question: 'q?', options: ['a', 'b'], chosen: 'a', why: 'w',
    reversible: true, wakeOn: null, at: NOW - 3 * 86_400_000, seenAt: null, overturnedAt: null, overturnNote: null, ...o,
  });

  it('joins the calls that left the group, at the operator\'s clear, an aged one at when it was made, an item first at the same instant', () => {
    const calls = [call(1, { seenAt: NOW - HOUR }), call(2, { seenAt: NOW - 5 * HOUR, overturnedAt: NOW - 90 * MIN }), call(3, { at: NOW - 30 * HOUR }),
      call(4, { overturnedAt: NOW - 2 * HOUR })];
    expect(clearedTrail([done(1, NOW - 2 * HOUR)], NOW, [], calls).map(idOf)).toEqual(['c1', 'i1', 'c4', 'c2', 'c3']);
    expect(clearedGroups(clearedTrail([], NOW, [], [call(5, { seenAt: NOW, program: 'prog-b' })])).map((g) => g.program)).toEqual(['prog-b']);
  });

  // Fix round 1 (review 2792 F4): a stale frame or the device's saved copy keeps calls to the trail's window, as items and asks.
  it('windows cleared calls by the same 48 hours, edge included', () => {
    const calls = [call(1, { seenAt: NOW - CLEARED_WINDOW_MS }), call(2, { seenAt: NOW - CLEARED_WINDOW_MS - 1 }), call(3, { overturnedAt: NOW - HOUR })];
    expect(clearedTrail([], NOW, [], calls).map(idOf)).toEqual(['c3', 'c1']);
  });

  // Fix round 1 (review 2792 F3, the coordinator's ruling): the server sends when a cleared call left the group (`clearedAt`,
  // from `callClearedAt`), and the trail sorts, windows and dates a call by it; an older server omits it and the console's own
  // reading stands.
  it('a call the server dates by clearedAt sorts and windows by it; without it, the console\'s reading stands', () => {
    const aged = call(1, { at: NOW - 8 * 86_400_000, clearedAt: NOW - 86_400_000 });
    const lateOverturn = call(2, { at: NOW - 8 * 86_400_000, overturnedAt: NOW - HOUR, clearedAt: NOW - 86_400_000 });
    expect(callClearedOn(aged)).toBe(NOW - 86_400_000);
    expect(callClearedOn(lateOverturn)).toBe(NOW - 86_400_000);
    expect(clearedTrail([done(1, NOW - 2 * HOUR)], NOW, [], [aged]).map(idOf)).toEqual(['i1', 'c1']);
    expect(callClearedOn(call(3, { seenAt: NOW - HOUR }))).toBe(NOW - HOUR);
    expect(callClearedHow(aged)).toBe('aged');
    expect(callClearedHow(lateOverturn)).toBe('aged');
    expect(callClearedHow(call(4, { seenAt: NOW - HOUR, clearedAt: NOW - HOUR }))).toBe('seen');
  });

  // Fix round 1 (review 2792 F8): a cleared call says how it cleared, never a bare tick.
  it('says how a call cleared: seen, overturned, or aged out', () => {
    expect(callClearedHow(call(1, { seenAt: NOW - HOUR }))).toBe('seen');
    expect(callClearedHow(call(2, { overturnedAt: NOW - HOUR }))).toBe('overturned');
    expect(callClearedHow(call(3, { seenAt: NOW - HOUR, overturnedAt: NOW - 2 * HOUR }))).toBe('overturned');
    expect(callClearedHow(call(4, { seenAt: NOW - 2 * HOUR, overturnedAt: NOW - HOUR }))).toBe('seen');
    expect(callClearedHow(call(5))).toBe('aged');
    expect(Object.values(CALL_CLEARED_WORD)).toEqual(['seen', 'overturned', 'aged out']);
  });

  it('the shown count is five', () => {
    expect(CLEARED_SHOWN).toBe(5);
  });

  it('an item\'s number is its id after a #', () => {
    expect(itemNumber(itemView({ id: 129 }))).toBe('#129');
  });
});

describe('ratificationWords', () => {
  it('words both ratified sources', () => {
    expect(ratificationWords({ ratified: true, source: { kind: 'operator' } }, null)).toBe('Ratified by you');
    expect(ratificationWords({ ratified: true, source: { kind: 'coordinator' } }, null)).toBe('Ratified by the coordinator');
  });
  it('words every reason a version is not ratified, naming the item where there is one', () => {
    const words: Record<RatificationWhy, string> = {
      'source-does-not-ratify': 'Not ratified: written by the coordinator',
      'effect-unmeasured': "Not ratified: rests on item 9's answer, which does not ratify goals yet",
      'item-not-answered': 'Not ratified: item 9 has not been answered',
      unreadable: 'Not ratified: what it rests on could not be read',
      unrecorded: 'Not recorded',
      absent: 'Not recorded',
    };
    for (const [why, text] of Object.entries(words)) {
      const r: Ratification = { ratified: false, why: why as RatificationWhy, source: null };
      expect(ratificationWords(r, 9), why).toBe(text);
    }
  });
});

describe('ratifyFailureOf: what a failed ratify means to the Goals card', () => {
  it('a 404 (an older server), not-configured and auth-off take the button away, each with its words', () => {
    expect(ratifyFailureOf(404, { ok: false, error: 'not-found' })).toEqual({ kind: 'unavailable', text: RATIFY_UNAVAILABLE_TEXT['not-found'] });
    expect(ratifyFailureOf(501, { ok: false, error: 'not-configured' })).toEqual({ kind: 'unavailable', text: RATIFY_UNAVAILABLE_TEXT['not-configured'] });
    expect(ratifyFailureOf(501, { ok: false, error: 'auth-off' })).toEqual({ kind: 'unavailable', text: RATIFY_UNAVAILABLE_TEXT['auth-off'] });
  });
  it('goals-changed reads again; anything else is only said', () => {
    expect(ratifyFailureOf(409, { ok: false, error: 'goals-changed' })).toEqual({ kind: 'changed' });
    expect(ratifyFailureOf(400, { ok: false, error: 'bad-request' })).toEqual({ kind: 'other' });
    expect(ratifyFailureOf(null, null)).toEqual({ kind: 'other' });
    for (const inherited of ['toString', '__proto__', 'constructor']) expect(ratifyFailureOf(400, { ok: false, error: inherited }), inherited).toEqual({ kind: 'other' });
  });
  it('a version resting on an item\'s answer, ratified (from W3), has its own words', () => {
    expect(ratificationWords({ ratified: true, source: { kind: 'item' } }, 4)).toBe('Ratified by the answer to the item it cites');
  });
});

describe('ratificationWords and ratifyOffered: a word from a newer server (review 2240 F5)', () => {
  const FIXED = 'Could not read whether this is ratified';
  const bad = (r: unknown): Ratification => r as Ratification;
  it('the fixed word is the one constant', () => { expect(RATIFICATION_UNREADABLE_WORDS).toBe(FIXED); });
  it.each(['future-reason', 'toString', '__proto__', 'constructor', ''])('an unknown why %j reads the fixed word and offers no Ratify', (why) => {
    const r = bad({ ratified: false, why, source: null });
    expect(ratificationWords(r, 3)).toBe(FIXED);
    expect(ratifyOffered(r)).toBe(false);
  });
  it.each(['future-kind', 'toString', '__proto__'])('an unknown source kind %j on a ratified verdict reads the fixed word', (kind) => {
    const r = bad({ ratified: true, source: { kind } });
    expect(ratificationWords(r, null)).toBe(FIXED);
    expect(ratifyOffered(r)).toBe(false);
  });
  it.each(['future-kind', 'toString', '__proto__'])('an unknown source kind %j on a not-ratified verdict reads the fixed word and offers no Ratify', (kind) => {
    const r = bad({ ratified: false, why: 'unrecorded', source: { kind } });
    expect(ratificationWords(r, null)).toBe(FIXED);
    expect(ratifyOffered(r)).toBe(false);
  });
  it('a ratified verdict with no source reads the fixed word', () => {
    expect(ratificationWords(bad({ ratified: true, source: null }), null)).toBe(FIXED);
  });
  it('offers Ratify only to an unratified, readable verdict that is not absent', () => {
    const no = (why: RatificationWhy, source: Ratification['source'] = null): Ratification => ({ ratified: false, why, source });
    for (const why of ['unrecorded', 'unreadable', 'source-does-not-ratify', 'effect-unmeasured', 'item-not-answered'] as const) {
      expect(ratifyOffered(no(why)), why).toBe(true);
    }
    expect(ratifyOffered(no('item-not-answered', { kind: 'item' }))).toBe(true);
    expect(ratifyOffered(no('absent'))).toBe(false);
    expect(ratifyOffered({ ratified: true, source: { kind: 'operator' } })).toBe(false);
  });
});

describe('doneWhenPlacement: where the stored definition of done is drawn (review 2240 F4)', () => {
  const g = (over: Partial<GoalsView> = {}): GoalsView => ({
    program: 'prog-a', specPath: null, inShort: 'In short', inShortAt: 1000,
    modifications: [{ id: 5, at: 2000, text: 'change', ruling: null, itemId: null, pr: null, merged: true }], doneWhen: ['one'], ...over,
  });
  it('is null with no list: null, absent or empty', () => {
    expect(doneWhenPlacement(g({ doneWhen: null }))).toBeNull();
    expect(doneWhenPlacement(g({ doneWhen: undefined }))).toBeNull();
    expect(doneWhenPlacement(g({ doneWhen: [] }))).toBeNull();
  });
  it('the pin when its stamp is the one shown', () => {
    expect(doneWhenPlacement(g({ doneWhenVersion: { pin: { inShortAt: 1000 } } }))).toEqual({ at: 'pin' });
  });
  it('a modification when it is one listed', () => {
    expect(doneWhenPlacement(g({ doneWhenVersion: { modification: 5 } }))).toEqual({ at: 'modification', id: 5 });
  });
  it('alone when the writer is null, absent, a stale pin stamp, a modification not shown, or unreadable', () => {
    expect(doneWhenPlacement(g({ doneWhenVersion: null }))).toEqual({ at: 'alone' });
    expect(doneWhenPlacement(g())).toEqual({ at: 'alone' });
    expect(doneWhenPlacement(g({ doneWhenVersion: { pin: { inShortAt: 999 } } }))).toEqual({ at: 'alone' });
    expect(doneWhenPlacement(g({ doneWhenVersion: { modification: 6 } }))).toEqual({ at: 'alone' });
    expect(doneWhenPlacement(g({ doneWhenVersion: {} as never }))).toEqual({ at: 'alone' });
  });
  it('alone when the pin is the writer but none is drawn', () => {
    expect(doneWhenPlacement(g({ inShort: null, inShortAt: null, doneWhenVersion: { pin: { inShortAt: 1000 } } }))).toEqual({ at: 'alone' });
  });
});
