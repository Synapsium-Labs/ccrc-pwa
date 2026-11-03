// The Waiting on you list's pure decisions (desktop-polish PL5a, D-7712; review 1359 F3, F5, F7, F8, F13d). Each case names
// what it pins; the screen's and the routes' tests read the same words through their components.
import { describe, expect, it } from 'vitest';
import {
  groupByProgramme, itemPills, openRunsOf, programmeIsLive, programmeWaitingCount, questionRows, waitingTotal, type QuestionRow,
} from '../src/ledgers/ledgerWords';
import { isWaitingView } from '../src/ledgers/waitingView';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';

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
    const kinds = mixed[0]!.rows.map((r) => (r.kind === 'item' ? `item ${r.item.id}` : `question ${r.question.sessionId}`));
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
  it('is zero for a programme with nothing open, and until the list and the fleet frame have both been heard', () => {
    expect(programmeWaitingCount(view, sessions, runs, 'prog-c')).toBe(0);
    expect(programmeWaitingCount(null, sessions, runs, 'prog-a')).toBe(0);
    expect(programmeWaitingCount(view, null, runs, 'prog-a')).toBe(0);
    expect(programmeWaitingCount(waitingView({ items: [itemView({ state: 'done', closedAt: NOW })] }), [], [], 'prog-a')).toBe(0);
  });
});
