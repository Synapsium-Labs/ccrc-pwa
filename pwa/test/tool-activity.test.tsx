// One collapsed row per stretch of a turn's tool activity (desktop polish wave 168, chat readability part 1).
//
// The fold is pure (`foldToolActivity`, beside `toolSummary.ts`) and both skins draw it through the shared
// `ToolActivityRow`. This file pins, over a long synthetic transcript of many turns (prose and tools mixed, a failed call,
// an AskUserQuestion, an approval): one row per contiguous tool stretch, the transcript's order exactly as it was, what
// the collapsed row surfaces and counts, the expansion kept per row while the view is open, and an append that moves no
// index the list was handed.
//
// Virtuoso is replaced by a list that renders a WINDOW of its rows and captures its props (as `transcript-rows.test.tsx`
// does), so a row can be scrolled out of reach and back, and the count, the keys and every scroll call are read off
// what the list was really handed.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import type { ChatEvent } from '../../shared/api';
import { SkinSetProvider } from '../src/skins/frame';
import { REFINED_SET } from '../src/skins/refined/parts';
import { INSTRUMENT_SET } from '../src/skins/instrument/parts';
import type { SkinSet } from '../src/skins/types';
import { buildChatItems, type ChatItem } from '../src/session/chatItems';
import { HEIGHT_BUCKETS } from '../src/session/itemHeight';
import { activityWords, foldToolActivity, liveWaitOf, waitKey, type LiveWait, type ToolActivityItem } from '../src/session/toolActivity';
import { groupToolRun } from '../src/session/toolSummary';
import { NO_RESULT_WORD } from '@ccrc/ui';

const seen = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  scrolls: [] as unknown[],
  /** The rows the stand-in list renders, as [from, to) indices; null renders every row. */
  window: null as [number, number] | null,
  /** The scroller the stand-in list hands over: where the reader is, as the list's follow reads it. */
  scroller: Object.assign(document.createElement('div'), { scrollTop: 0 }) as HTMLElement,
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      seen.props = props;
      (props.scrollerRef as ((el: HTMLElement) => void) | undefined)?.(seen.scroller);
      React.useImperativeHandle(ref, () => ({
        scrollToIndex: (location: unknown) => { seen.scrolls.push(location); },
      }));
      const count = props.totalCount as number;
      const key = props.computeItemKey as (i: number) => string | number;
      const content = props.itemContent as (i: number) => React.ReactNode;
      const [from, to] = seen.window ?? [0, count];
      const rows: React.ReactNode[] = [];
      for (let i = Math.max(0, from); i < Math.min(count, to); i += 1) {
        rows.push(React.createElement('div', { key: key(i), 'data-index': i }, content(i)));
      }
      return React.createElement('div', { 'data-testid': 'virtuoso' }, rows);
    }),
  };
});

const { ChatList, ChatListInner, shapeOf } = await import('../src/session/ChatList');

afterEach(() => {
  cleanup();
  localStorage.clear();
  seen.props = null;
  seen.scrolls.length = 0;
  seen.window = null;
});

// ---- the fixture ------------------------------------------------------------------------------------------------------
const TS = '2026-11-22T10:00:00.000Z';
type Use = Extract<ChatEvent, { kind: 'tool_use' }>;

/** A transcript builder that also records, as it goes, the stretches it wrote: each a list of tool ids. */
function transcript() {
  let n = 0;
  const events: ChatEvent[] = [];
  const stretches: string[][] = [];
  let open: string[] | null = null;
  const end = (): void => { open = null; };
  const use = (name: string, input: unknown): Use => {
    n += 1;
    const u: Use = { kind: 'tool_use', uuid: `u${n}`, ts: TS, toolId: `t${n}`, name, input: JSON.stringify(input) };
    events.push(u);
    if (open === null) { open = []; stretches.push(open); }
    open.push(u.toolId);
    return u;
  };
  const result = (u: Use, isError = false, text = 'ok'): void => {
    events.push({ kind: 'tool_result', ts: TS, toolId: u.toolId, text, isError });
  };
  return {
    events,
    stretches,
    user(text: string): void { end(); n += 1; events.push({ kind: 'user', uuid: `q${n}`, ts: TS, text }); },
    say(text: string): void { end(); n += 1; events.push({ kind: 'assistant', uuid: `a${n}`, ts: TS, text }); },
    call(name: string, input: unknown, isError = false): Use { const u = use(name, input); result(u, isError); return u; },
    live(name: string, input: unknown): Use { return use(name, input); },
    answered(question: string): Use {
      const u = use('AskUserQuestion', { questions: [{ question, header: 'Pick', options: [{ label: 'Ink' }, { label: 'Paper' }] }] });
      result(u, false, `User has answered your questions: "${question}"="Ink".`);
      return u;
    },
    ask(question: string): Use {
      return use('AskUserQuestion', { questions: [{ question, header: 'Pick', options: [{ label: 'Ink' }, { label: 'Paper' }] }] });
    },
  };
}

/** A long, tool-heavy session: TURNS turns of prose and tools mixed, one failed call, one answered question, one
 *  STALE question (an ask of an earlier turn that never got a result), then a last turn whose final stretch holds the
 *  question the session is asking now. */
const TURNS = 14;
function longSession() {
  const t = transcript();
  let stale: Use | null = null;
  for (let i = 0; i < TURNS; i += 1) {
    t.user(`Step ${i}.`);
    t.say(`Reading for step ${i}.`);
    t.call('Read', { file_path: `/repo/src/a${i}.ts` });
    t.call('Read', { file_path: `/repo/src/b${i}.ts` });
    t.call('Bash', { command: `npm test -- step${i}` });
    t.say(`Editing for step ${i}.`);
    // A failed call in the middle of a stretch, in one turn: it does not end the stretch.
    t.call('Edit', { file_path: `/repo/src/a${i}.ts`, old_string: 'x', new_string: 'y' }, i === 3);
    t.call('Grep', { pattern: `step${i}` });
    if (i === 5) t.answered('Which colour reads best?');
    if (i === 7) stale = t.ask('A question nobody answered?');
    t.call('Bash', { command: 'git status' });
    t.say(`Step ${i} done.`);
  }
  t.user('Last step.');
  t.say('Checking first.');
  t.call('Read', { file_path: '/repo/src/last.ts' });
  const question = t.ask('Ship it now?');
  return { ...t, question, stale: stale! };
}

/** The live wait, as the screen hands it over (`liveWaitOf`): none, a question in Claude's own words, or anything else
 *  (an approval, a menu, a review screen, an ask the pane shows unreadably). */
const NONE: LiveWait = { kind: 'none' };
const OTHER: LiveWait = { kind: 'other' };
const asking = (...questions: string[]): LiveWait => ({ kind: 'question', questions });

const activities = (items: readonly unknown[]): ToolActivityItem[] =>
  items.filter((i): i is ToolActivityItem => (i as { kind: string }).kind === 'tool-activity');

/** The folded list flattened back: each activity row as its entries, every other item as itself. */
const unfold = (items: readonly (ChatItem | ToolActivityItem)[]): ChatItem[] =>
  items.flatMap((i) => (i.kind === 'tool-activity' ? i.entries : [i]));

// ---- the pure fold ----------------------------------------------------------------------------------------------------
describe('foldToolActivity: one row per contiguous stretch of a turn\'s tool activity', () => {
  it('makes exactly one row per stretch the transcript wrote, each holding that stretch\'s calls in order', () => {
    const s = longSession();
    const folded = foldToolActivity(buildChatItems(s.events, [], false), { runs: 'none', wait: NONE, busy: false });
    const rows = activities(folded);
    expect(rows.map((r) => r.entries.map((e) => e.key))).toEqual(s.stretches);
    // A long session: many turns, more than one stretch per turn.
    expect(rows.length).toBe(TURNS * 2 + 1);
  });

  it('never reorders the transcript: unfolded, it is exactly the list `buildChatItems` made', () => {
    const s = longSession();
    const items = buildChatItems(s.events, [], true);
    const folded = foldToolActivity(items, { runs: 'tool-runs', wait: OTHER, busy: true });
    expect(unfold(folded).map((i) => i.key)).toEqual(items.map((i) => i.key));
    // Every item that is not a tool entry stands outside every row, prose above all.
    expect(folded.filter((i) => i.kind === 'message').length).toBe(items.filter((i) => i.kind === 'message').length);
    for (const row of activities(folded)) for (const e of row.entries) expect(e.kind).toBe('tool');
  });

  it('keeps a failed call inside its stretch and surfaces it', () => {
    const s = longSession();
    const rows = activities(foldToolActivity(buildChatItems(s.events, [], false), { runs: 'tool-runs', wait: NONE, busy: false }));
    const withFailure = rows.filter((r) => r.attention.some((a) => a.kind === 'failed'));
    expect(withFailure).toHaveLength(1);
    const row = withFailure[0]!;
    expect(row.entries).toHaveLength(3); // the failed Edit, the Grep and git status: one stretch
    expect(row.attention.map((a) => [a.kind, a.entry.use.name])).toEqual([['failed', 'Edit']]);
    expect(activityWords(row).attention).toEqual(['1 failed']);
  });

  it('surfaces the question the session is asking now, and never a stale one', () => {
    const s = longSession();
    const fold = (wait: LiveWait) =>
      activities(foldToolActivity(buildChatItems(s.events, [], true), { runs: 'tool-runs', wait, busy: true }));
    const rows = fold(asking('Ship it now?'));
    const last = rows[rows.length - 1]!;
    expect(last.attention.map((a) => [a.kind, a.entry.key])).toEqual([['question', s.question.toolId]]);
    expect(activityWords(last)).toMatchObject({ calls: '2 calls', state: 'running', attention: ['1 question'] });
    // The stale ask of turn 7 is not asked now: no flag, no card, no live control, in its own row or any other.
    const staleRow = rows.find((r) => r.entries.some((e) => e.key === s.stale.toolId))!;
    expect(staleRow.attention).toEqual([]);
    expect(staleRow.live).toBe(false);
    // One live wait, drawn once: the question's card carries it, so no row draws a wait line too.
    expect(rows.filter((r) => r.waiting)).toEqual([]);
    // With no live ask or dialog, the turn's open ask is not asked now either.
    expect(fold(NONE).flatMap((r) => r.attention.map((a) => a.kind))).not.toContain('question');
    // Asked a question the transcript holds nowhere open in this turn (the stale one's words): no card is singled out.
    expect(fold(asking('A question nobody answered?')).flatMap((r) => r.attention.map((a) => a.kind))).not.toContain('question');
  });

  it('leads with the question asked now, ahead of a failure in the same stretch', () => {
    const t = transcript();
    t.user('Go.');
    t.call('Bash', { command: 'npm test' }, true);
    const ask = t.ask('Retry?');
    const row = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', wait: asking('Retry?'), busy: true }))[0]!;
    expect(row.attention.map((a) => [a.kind, a.entry.key])).toEqual([['question', ask.toolId], ['failed', 't2']]);
  });

  it('names no call for a live wait the transcript does not single out: the current turn\'s newest row waits', () => {
    const fold = (t: ReturnType<typeof transcript>, wait: LiveWait = OTHER) =>
      activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', wait, busy: true }));
    // An approval: it names a tool, never a call, so no card is inferred; the newest row of the turn says the session waits.
    const a = transcript();
    a.user('Publish.');
    a.call('Read', { file_path: '/repo/a.ts' });
    a.say('Building, then publishing.');
    a.call('Bash', { command: 'npm run build' });
    a.live('Bash', { command: 'npm publish' });
    const rows = fold(a);
    expect(rows.map((r) => r.waiting)).toEqual([false, true]);
    expect(rows.flatMap((r) => r.attention)).toEqual([]);
    expect(activityWords(rows[1]!).attention).toEqual(['waiting on you']);
    expect(fold(a, NONE).map((r) => r.waiting)).toEqual([false, false]);
    // Two parallel calls, the newest already answered and the first not: still no card is named, and the row runs.
    const p = transcript();
    p.user('Go.');
    const first = p.live('Bash', { command: 'npm publish' });
    const second = p.live('Read', { file_path: '/repo/a.ts' });
    p.events.push({ kind: 'tool_result', ts: TS, toolId: second.toolId, text: 'ok', isError: false });
    const [par] = fold(p);
    expect(par!.entries.map((e) => e.key)).toEqual([first.toolId, second.toolId]);
    expect(par!.waiting).toBe(true);
    expect(par!.attention).toEqual([]);
    expect(par!.live, 'a resultless call before an answered one is still running').toBe(true);
    // Every call of the turn has its result, and the session still waits (a helper's approval, a menu): the row waits.
    const r = transcript();
    r.user('Go.');
    r.call('Agent', { description: 'review the diff' });
    const [done] = fold(r);
    expect(done!.waiting).toBe(true);
    expect(done!.live).toBe(false);
    // Two open asks in one turn: the transcript does not single one out, so neither card takes the wait.
    const q = transcript();
    q.user('Go.');
    q.ask('One?');
    q.ask('Two?');
    const [two] = fold(q);
    expect(two!.attention).toEqual([]);
    expect(two!.waiting).toBe(true);
    // The source names one of them by its words: that call is the one asked now, and no row waits.
    const [named] = fold(q, asking('Two?'));
    expect(named!.attention.map((a) => [a.kind, a.entry.key])).toEqual([['question', 't3']]);
    expect(named!.waiting).toBe(false);
    // Words that match both, or neither, single out nothing.
    const same = transcript();
    same.user('Go.');
    same.ask('Again?');
    same.ask('Again?');
    expect(fold(same, asking('Again?'))[0]!.waiting).toBe(true);
    expect(fold(q, asking('Three?'))[0]!.waiting).toBe(true);
    // A question asked now, but the live wait is an approval (review 3478 F2): no call takes it, none is counted.
    const ap = transcript();
    ap.user('Go.');
    ap.ask('Pick one?');
    ap.live('Bash', { command: 'npm publish' });
    const [approval] = fold(ap, OTHER);
    expect(approval!.attention).toEqual([]);
    expect(approval!.waiting).toBe(true);
  });

  it('keeps every live state to the current turn: a new prompt before its first call leaves the last turn quiet', () => {
    const t = transcript();
    t.user('Run it.');
    t.live('Bash', { command: 'sleep 100' });
    t.ask('Old question?');
    t.user('Never mind, do this instead.');
    const rows = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', wait: asking('Old question?'), busy: true }));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.live, 'an earlier turn\'s resultless call reads as running').toBe(false);
    expect(rows[0]!.waiting, 'an earlier turn\'s row hosts the live wait').toBe(false);
    expect(rows[0]!.attention, 'an earlier turn\'s ask reads as asked now').toEqual([]);
    // Only a prompt starts a turn: the assistant's own prose between calls does not.
    const m = transcript();
    m.user('Go.');
    m.live('Bash', { command: 'npm test' });
    m.say('Still going.');
    const [still] = activities(foldToolActivity(buildChatItems(m.events, [], true), { runs: 'none', wait: NONE, busy: true }));
    expect(still!.live, 'assistant prose ended the turn').toBe(true);
  });

  it('says running only while the session works: a turn that ended with a call unanswered is not running', () => {
    const t = transcript();
    t.user('Go.');
    t.live('Bash', { command: 'npm test' });
    const fold = (busy: boolean): boolean =>
      activities(foldToolActivity(buildChatItems(t.events, [], busy), { runs: 'none', wait: NONE, busy }))[0]!.live;
    expect(fold(true)).toBe(true);
    expect(fold(false)).toBe(false);
  });

  it('keeps its key while the stretch grows, so the reader\'s choice outlives an arriving call', () => {
    const t = transcript();
    t.user('Go.');
    t.call('Read', { file_path: '/repo/a.ts' });
    const before = activities(foldToolActivity(buildChatItems([...t.events], [], true), { runs: 'none', wait: NONE, busy: true }));
    t.call('Read', { file_path: '/repo/b.ts' });
    t.live('Bash', { command: 'npm test' });
    const after = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', wait: NONE, busy: true }));
    expect(after.map((r) => r.key)).toEqual(before.map((r) => r.key));
    expect(after[0]!.entries).toHaveLength(3);
    expect(after[0]!.latest).toBe('Ran npm');
  });

  it('opens into the skin\'s own grouping, unchanged: the runs for a set that folds them, the entries otherwise', () => {
    const s = longSession();
    const items = buildChatItems(s.events, [], false);
    for (const row of activities(foldToolActivity(items, { runs: 'tool-runs', wait: NONE, busy: false }))) {
      expect(row.inner).toEqual(groupToolRun(row.entries));
    }
    for (const row of activities(foldToolActivity(items, { runs: 'none', wait: NONE, busy: false }))) {
      expect(row.inner).toEqual(row.entries);
    }
  });

  it('says one call and many calls, and no running state once the stretch is done', () => {
    const t = transcript();
    t.user('Go.');
    t.call('Read', { file_path: '/repo/a.ts' });
    const one = activities(foldToolActivity(buildChatItems(t.events, [], false), { runs: 'none', wait: NONE, busy: false }))[0]!;
    expect(activityWords(one)).toEqual({
      title: 'Tool activity', calls: '1 call', state: null, latest: 'Read a.ts', attention: [],
    });
  });
});

// ---- the rendered rows, in both skins ---------------------------------------------------------------------------------
const SETS: [string, SkinSet][] = [['Refined', REFINED_SET], ['Instrument', INSTRUMENT_SET]];

const rowsOf = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.tool-activity-row')];

interface MountOpts { askPending?: boolean; askWait?: LiveWait; askBelow?: boolean; onAnswer?: () => void; busy?: boolean; id?: string }
const list = (set: SkinSet, events: ChatEvent[], o: MountOpts = {}) => (
  <SkinSetProvider set={set}>
    <ChatList
      id={o.id ?? 's'} events={events} pending={[]} busy={o.busy ?? false} onRetry={() => {}} onDiscard={() => {}}
      askPending={o.askPending} askWait={o.askWait} askBelow={o.askBelow} onAnswer={o.onAnswer}
    />
  </SkinSetProvider>
);

describe.each(SETS)('%s draws one collapsed row per stretch', (_name, set) => {
  it('draws one row per stretch, collapsed, with every prose turn visible outside them', () => {
    const s = longSession();
    const { container } = render(list(set, s.events, { askPending: true, askWait: asking('Ship it now?'), busy: true }));
    const rows = rowsOf(container);
    expect(rows).toHaveLength(s.stretches.length);
    for (const row of rows) expect(row.getAttribute('aria-expanded')).toBe('false');
    for (let i = 0; i < TURNS; i += 1) {
      for (const text of [`Reading for step ${i}.`, `Editing for step ${i}.`, `Step ${i} done.`]) {
        const prose = within(container).getByText(text);
        expect(prose.closest('.tool-activity'), `"${text}" was folded away`).toBeNull();
      }
    }
    // Collapsed, the only cards drawn are the entries surfaced for the reader: one per row that has any.
    const surfaced = container.querySelectorAll('.tool-activity-first');
    expect(surfaced).toHaveLength(2); // the failed Edit's row, and the last row (its question asked now); never the stale ask's
    expect(container.querySelectorAll('.ref-tool-group')).toHaveLength(0);
    // The row's words: the title, the count, the running state and the newest call's summary.
    const last = rows[rows.length - 1]!;
    expect(last.textContent).toContain('Tool activity');
    expect(last.textContent).toContain('2 calls');
    expect(last.textContent).toContain('running');
    expect(last.textContent).toContain('AskUserQuestion');
    expect(last.textContent).toContain('1 question');
    expect(last.textContent).not.toContain('waiting on you');
    // One live wait, drawn once: the question's card, and no wait line anywhere.
    expect(container.querySelectorAll('.tool-activity-wait')).toHaveLength(0);
    // Only the current turn runs.
    expect(rows.filter((r) => (r.textContent ?? '').includes('running'))).toHaveLength(1);
  });

  it('surfaces a failed call on the collapsed row as its own card', () => {
    const s = longSession();
    const { container } = render(list(set, s.events));
    const failed = container.querySelector('.tool-activity-first[data-attention="failed"]');
    expect(failed, 'the failed call is not surfaced').not.toBeNull();
    expect(failed!.querySelector('.tool-dot--err')).not.toBeNull();
    expect(failed!.closest('.tool-activity')!.querySelector('.tool-activity-row')!.textContent).toContain('1 failed');
  });

  it('surfaces an open question with its own Answer, which raises the answer sheet', () => {
    const onAnswer = vi.fn();
    const s = longSession();
    const { container } = render(list(set, s.events, { askPending: true, askWait: asking('Ship it now?'), onAnswer, busy: true }));
    const question = container.querySelector<HTMLElement>('.tool-activity-first[data-attention="question"]');
    expect(question, 'the open question is not surfaced').not.toBeNull();
    expect(question!.textContent).toContain('Ship it now?');
    fireEvent.click(within(question!).getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    // Opened, the same card is in the body with its Answer, and is not drawn twice.
    const rows = rowsOf(container);
    const row = rows[rows.length - 1]!;
    fireEvent.click(row);
    const box = row.closest('.tool-activity') as HTMLElement;
    expect(box.querySelector('.tool-activity-first')).toBeNull();
    const body = box.querySelector<HTMLElement>('.tool-activity-body')!;
    expect(within(body).getAllByText('Ship it now?')).toHaveLength(1);
    fireEvent.click(within(body).getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledTimes(2);
  });

  it('draws a live wait no card is identified as on the current turn\'s newest row, closed and open, with the answer control', () => {
    const onAnswer = vi.fn();
    const t = transcript();
    t.user('Publish.');
    t.call('Bash', { command: 'npm run build' });
    t.live('Bash', { command: 'npm publish' });
    const { container, rerender } = render(list(set, t.events, { askPending: true, onAnswer, busy: true }));
    const waitLine = (): HTMLElement | null => container.querySelector<HTMLElement>('.tool-activity-wait');
    expect(waitLine(), 'the live wait is not drawn').not.toBeNull();
    expect(waitLine()!.textContent).toContain('waiting for you');
    // No card is named for it: the transcript does not know which call the approval is about.
    expect(container.querySelector('.tool-activity-first')).toBeNull();
    fireEvent.click(within(waitLine()!).getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    // Opened, the line and its control are still there.
    fireEvent.click(rowsOf(container)[0]!);
    expect(rowsOf(container)[0]!.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(within(waitLine()!).getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledTimes(2);
    // With the answer surface mounted below the transcript (the desk), the control takes the reader there.
    rerender(list(set, t.events, { askPending: true, askBelow: true, onAnswer, busy: true }));
    expect(waitLine()!.textContent).toContain('waiting for you, below');
    expect(within(waitLine()!).getByRole('button', { name: 'Go to the prompt' })).toBeTruthy();
    // No live ask or dialog: nothing waits on the reader, and nothing is drawn.
    rerender(list(set, t.events, { askPending: false, onAnswer, busy: true }));
    expect(waitLine()).toBeNull();
    // A new prompt before its first call: the last turn's row no longer runs or waits.
    t.user('Something else first.');
    rerender(list(set, [...t.events], { askPending: true, onAnswer, busy: true }));
    expect(waitLine()).toBeNull();
    expect(rowsOf(container)[0]!.textContent).not.toContain('running');
  });

  it('opens a row in place into what the transcript drew before the fold', () => {
    const s = longSession();
    const { container } = render(list(set, s.events));
    const row = rowsOf(container)[0]!;
    fireEvent.click(row);
    expect(row.getAttribute('aria-expanded')).toBe('true');
    const body = row.closest('.tool-activity')!.querySelector('.tool-activity-body')!;
    if (set.transcriptGrouping === 'tool-runs') {
      // Refined: its one grouped row for the three calls, itself collapsed, as before.
      expect(body.querySelectorAll('.ref-tool-group')).toHaveLength(1);
      expect(body.textContent).toContain('Read 2 files · Ran npm');
    } else {
      // Instrument: the three tool cards.
      expect(body.querySelectorAll('.toolcard')).toHaveLength(3);
    }
    fireEvent.click(row);
    expect(row.closest('.tool-activity')!.querySelector('.tool-activity-body')).toBeNull();
  });

  it('keeps a row open while it is scrolled out of reach and back', () => {
    const s = longSession();
    const { container, rerender } = render(list(set, s.events));
    const indexOf = (row: HTMLElement): number => Number(row.closest('[data-index]')!.getAttribute('data-index'));
    const first = rowsOf(container)[2]!;
    const index = indexOf(first);
    const neighbour = indexOf(rowsOf(container)[1]!);
    fireEvent.click(first);
    // The virtual list unmounts the row, then mounts it again.
    seen.window = [index + 5, index + 10];
    rerender(list(set, s.events));
    expect(container.querySelector(`[data-index="${index}"]`)).toBeNull();
    seen.window = null;
    rerender(list(set, [...s.events]));
    const again = container.querySelector(`[data-index="${index}"] .tool-activity-row`)!;
    expect(again.getAttribute('aria-expanded'), 'the reader\'s choice was lost').toBe('true');
    // Its neighbours stayed as the reader left them.
    expect(container.querySelector(`[data-index="${neighbour}"] .tool-activity-row`)!.getAttribute('aria-expanded')).toBe('false');
  });

  it("forgets the reader's choices when the view moves to another session", () => {
    const s = longSession();
    const { container, rerender } = render(list(set, s.events));
    fireEvent.click(rowsOf(container)[0]!);
    expect(rowsOf(container)[0]!.getAttribute('aria-expanded')).toBe('true');
    // Another session whose transcript has the same keys: its rows open closed.
    seen.window = [0, 0];
    rerender(list(set, s.events, { id: 't' }));
    seen.window = null;
    rerender(list(set, [...s.events], { id: 't' }));
    expect(rowsOf(container)[0]!.getAttribute('aria-expanded'), "another session's row opened with this one's choice").toBe('false');
  });

  it('keeps an open row open while calls arrive in it, and shows each one', () => {
    const t = transcript();
    t.user('Go.');
    t.say('Reading.');
    t.call('Read', { file_path: '/repo/a.ts' });
    t.live('Bash', { command: 'npm test' });
    const { container, rerender } = render(list(set, [...t.events], { busy: true }));
    const row = (): HTMLElement => rowsOf(container)[0]!;
    fireEvent.click(row());
    const cards = (): number => row().closest('.tool-activity')!.querySelectorAll('.tool-activity-body .toolcard, .tool-activity-body .ref-tool-group').length;
    const before = cards();
    t.call('Grep', { pattern: 'x' }, true);
    t.call('Edit', { file_path: '/repo/a.ts', old_string: 'x', new_string: 'y' });
    rerender(list(set, [...t.events], { busy: true }));
    expect(row().getAttribute('aria-expanded'), 'an arriving call closed the row').toBe('true');
    expect(row().textContent).toContain('4 calls');
    expect(cards(), 'the arriving calls are not in the opened row').toBeGreaterThan(before);
    // Open, a failure that arrives is in the body, not drawn a second time under the row.
    expect(row().closest('.tool-activity')!.querySelector('.tool-activity-first')).toBeNull();
  });

  it('follows the foot when the list changes height while the reader is there, and never once they scrolled up', () => {
    const s = longSession();
    const { container } = render(list(set, s.events, { busy: true }));
    const changed = (h: number): void => act(() => { (seen.props!.totalListHeightChanged as (h: number) => void)(h); });
    // The reader at the foot of a 5000px list in a 600px view.
    Object.defineProperty(seen.scroller, 'clientHeight', { configurable: true, value: 600 });
    seen.scroller.scrollTop = 4400;
    changed(5000); // the first height: nothing to compare it with
    expect(seen.scrolls).toEqual([]);
    changed(5050); // a failure card surfaced under the newest row
    expect(seen.scrolls, 'a reader at the foot was left above a row that grew').toEqual([{ index: 'LAST', align: 'end' }]);
    // A jump up the list before the list says the reader left the foot: the rows it lands on measure, the height
    // changes, and the reader is NOT pulled back (they were far from the foot as it stood).
    seen.scroller.scrollTop = 1200;
    changed(5120);
    expect(seen.scrolls, 'a reader who jumped up was pulled back to the foot').toHaveLength(1);
    // Back at the foot, then scrolled up: once the list says so, a height change never moves them. (Desktop polish wave
    // 175: the list measures that the reader moved up from where the foot stood, so the scroller moves as a reader's does.)
    seen.scroller.scrollTop = 4520;
    act(() => { (seen.props!.atBottomStateChange as (b: boolean) => void)(true); });
    seen.scroller.scrollTop = 4000;
    fireEvent.wheel(within(container).getByTestId('virtuoso'));
    act(() => { (seen.props!.atBottomStateChange as (b: boolean) => void)(false); });
    changed(5400);
    expect(seen.scrolls, 'a reader who scrolled up was moved').toHaveLength(1);
  });

  it('an append into a closed stretch leaves it closed and moves no index the list was handed', () => {
    const t = transcript();
    for (let i = 0; i < 6; i += 1) {
      t.user(`Step ${i}.`);
      t.say(`Working on ${i}.`);
      t.call('Read', { file_path: `/repo/a${i}.ts` });
    }
    t.call('Bash', { command: 'npm test' });
    const { container, rerender } = render(list(set, [...t.events], { busy: true }));
    const keys = (): unknown[] => {
      const count = seen.props!.totalCount as number;
      const key = seen.props!.computeItemKey as (i: number) => unknown;
      return Array.from({ length: count }, (_, i) => key(i));
    };
    const before = keys();
    // The reader scrolled up: the list is no longer following.
    fireEvent.wheel(within(container).getByTestId('virtuoso'));
    act(() => { (seen.props!.atBottomStateChange as (b: boolean) => void)(false); });
    // Three calls arrive in the newest, closed stretch.
    t.call('Edit', { file_path: '/repo/a5.ts', old_string: 'x', new_string: 'y' });
    t.call('Grep', { pattern: 'step' });
    t.live('Bash', { command: 'npm run build' });
    rerender(list(set, [...t.events], { busy: true }));
    expect(keys(), 'an index the list was handed moved').toEqual(before);
    expect(seen.scrolls, 'the list was scrolled for the reader').toEqual([]);
    const rows = rowsOf(container);
    const last = rows[rows.length - 1]!;
    expect(last.getAttribute('aria-expanded'), 'the arriving calls opened the row').toBe('false');
    expect(last.textContent).toContain('5 calls');
    expect(last.textContent).toContain('running');
  });
});

// ---- review 3478: one live control, and nothing historical that looks live ------------------------------------------
/** Every control on screen that answers the live wait. */
const answers = (root: HTMLElement): HTMLElement[] => within(root).queryAllByRole('button', { name: 'Answer' });
/** Open every closed tool-activity row on screen. */
const openAll = (root: HTMLElement): void => {
  for (const row of rowsOf(root)) if (row.getAttribute('aria-expanded') === 'false') fireEvent.click(row);
};

describe.each(SETS)('%s draws one live control, open or closed (review 3478 F1-F4)', (_name, set) => {
  it('opening an earlier turn\'s row that holds a stale ask adds no second Answer (F1, F3)', () => {
    const s = longSession();
    const { container } = render(list(set, s.events, { askPending: true, askWait: asking('Ship it now?'), onAnswer: () => {}, busy: true }));
    expect(answers(container), 'closed').toHaveLength(1);
    const staleRow = rowsOf(container)[s.stretches.findIndex((ids) => ids.includes(s.stale.toolId))]!;
    fireEvent.click(staleRow);
    expect(within(staleRow.closest('.tool-activity') as HTMLElement).getByText('A question nobody answered?')).toBeTruthy();
    expect(answers(container), 'the stale ask\'s row opened').toHaveLength(1);
    openAll(container);
    expect(answers(container), 'every row opened').toHaveLength(1);
    // The one control is the question asked now.
    expect(answers(container)[0]!.closest('.tool-activity')!.textContent).toContain('Ship it now?');
  });

  it('two open asks in the turn: one control, closed and opened, whichever the source names (F1, F3)', () => {
    const t = transcript();
    t.user('Go.');
    t.ask('One?');
    t.ask('Two?');
    for (const askWait of [OTHER, asking('Two?')]) {
      const { container, unmount } = render(list(set, t.events, { askPending: true, askWait, onAnswer: () => {}, busy: true }));
      expect(answers(container), `${askWait.kind}, closed`).toHaveLength(1);
      openAll(container);
      expect(answers(container), `${askWait.kind}, opened`).toHaveLength(1);
      if (askWait.kind === 'other') expect(answers(container)[0]!.closest('.tool-activity-wait')).not.toBeNull();
      else expect(answers(container)[0]!.closest('.tool-activity-wait')).toBeNull();
      unmount();
    }
  });

  it('an unanswered ask while an approval is the live wait: one control, on the wait line, none on the ask card (F2)', () => {
    const t = transcript();
    t.user('Go.');
    t.ask('Pick one?');
    t.live('Bash', { command: 'npm publish' });
    const { container } = render(list(set, t.events, { askPending: true, askWait: OTHER, onAnswer: () => {}, busy: true }));
    const row = rowsOf(container)[0]!;
    expect(row.textContent).not.toContain('question');
    expect(answers(container)).toHaveLength(1);
    expect(answers(container)[0]!.closest('.tool-activity-wait')).not.toBeNull();
    fireEvent.click(row);
    expect(within(container).getByText('Pick one?')).toBeTruthy();
    expect(answers(container), 'opened').toHaveLength(1);
    expect(answers(container)[0]!.closest('.tool-activity-wait')).not.toBeNull();
  });

  it('a question its words tie to no single open ask of this turn: the wait line alone, no control on any card', () => {
    // The rule: the live question's whole words equal exactly one open ask of the current turn. Its three other outcomes.
    const noMatch = transcript();
    noMatch.user('Go.');
    noMatch.ask('Pick one?');
    noMatch.call('Read', { file_path: '/repo/a.ts' });
    const twoEqual = transcript();
    twoEqual.user('Go.');
    twoEqual.ask('Pick one?');
    twoEqual.ask('Pick one?');
    const earlier = transcript();
    earlier.user('First.');
    earlier.ask('Pick one?');
    earlier.user('Then this.');
    earlier.call('Read', { file_path: '/repo/a.ts' });
    const cases: [string, ReturnType<typeof transcript>, LiveWait][] = [
      ['words no open ask asks', noMatch, asking('Pick one')],
      ['two open asks with the same words', twoEqual, asking('Pick one?')],
      ['the words asked only in an earlier turn', earlier, asking('Pick one?')],
    ];
    for (const [what, t, askWait] of cases) {
      const { container, unmount } = render(list(set, t.events, { askPending: true, askWait, onAnswer: () => {}, busy: true }));
      for (const phase of ['closed', 'opened']) {
        if (phase === 'opened') openAll(container);
        const controls = answers(container);
        expect(controls, `${what}, ${phase}`).toHaveLength(1);
        expect(controls[0]!.closest('.tool-activity-wait'), `${what}, ${phase}: the control is not the wait line's`).not.toBeNull();
        expect(container.querySelector('.tool-activity-first[data-attention="question"]'), `${what}: a card is surfaced`).toBeNull();
      }
      unmount();
    }
  });

  it('an opened earlier turn\'s call with no result shows nothing that reads as running (F4)', () => {
    const t = transcript();
    t.user('Run it.');
    t.live('Bash', { command: 'sleep 100' });
    t.user('Do this instead.');
    t.live('Bash', { command: 'npm test' });
    const { container } = render(list(set, t.events, { busy: true }));
    openAll(container);
    const [past, now] = [...container.querySelectorAll<HTMLElement>('.tool-activity')];
    const card = past!.querySelector<HTMLElement>('.toolcard')!;
    expect(card, 'the earlier turn\'s call is not drawn').not.toBeNull();
    expect(card.querySelector('.tool-dot--run'), 'a breathing dot').toBeNull();
    expect(card.querySelector('.tool-dur'), 'a ticking clock').toBeNull();
    fireEvent.click(card.querySelector<HTMLElement>('.tool-row')!);
    expect(card.textContent).not.toContain('running');
    expect(card.textContent).toContain(NO_RESULT_WORD);
    // The current turn's call still runs.
    const live = now!.querySelector<HTMLElement>('.toolcard')!;
    expect(live.querySelector('.tool-dot--run')).not.toBeNull();
  });
});

describe('the live wait the fold reads (review 3478 F2)', () => {
  it('only Claude\'s own question carries words a call is matched by; every other kind names no call', () => {
    const q = { question: '  Ship it now? ', header: 'Ship', options: [{ label: 'Yes' }] };
    expect(liveWaitOf({ kind: 'none' })).toEqual({ kind: 'none' });
    expect(liveWaitOf({ kind: 'structured', questions: [q], from: 'hook' })).toEqual({ kind: 'question', questions: ['Ship it now?'] });
    expect(liveWaitOf({ kind: 'approval', approval: { tool: 'Bash', summary: 'npm publish' } })).toEqual({ kind: 'other' });
    expect(liveWaitOf({ kind: 'menu', title: 'Pick', options: [] })).toEqual({ kind: 'other' });
    expect(liveWaitOf({ kind: 'ask-unreadable' })).toEqual({ kind: 'other' });
    expect(liveWaitOf({ kind: 'terminal-only' })).toEqual({ kind: 'other' });
    expect(liveWaitOf({ kind: 'review', rows: null as never, summary: [] })).toEqual({ kind: 'other' });
  });

  it('keys a wait by what it says, so an equal wait folds nothing again and other words fold anew', () => {
    expect(waitKey(asking('A?'))).toBe(waitKey(asking('A?')));
    expect(waitKey(asking('A?'))).not.toBe(waitKey(asking('B?')));
    expect(waitKey(asking('A?', 'B?'))).not.toBe(waitKey(asking('A?')));
    expect(new Set([waitKey(NONE), waitKey(OTHER), waitKey(asking())]).size).toBe(3);
  });

  it('matches every question of a call, in order', () => {
    const t = transcript();
    t.user('Go.');
    t.events.push({
      kind: 'tool_use', uuid: 'm', ts: TS, toolId: 'tm', name: 'AskUserQuestion',
      input: JSON.stringify({ questions: [{ question: 'A?', options: [] }, { question: 'B?', options: [] }] }),
    });
    const fold = (wait: LiveWait) => activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', wait, busy: true }))[0]!;
    expect(fold(asking('A?', 'B?')).attention.map((a) => a.kind)).toEqual(['question']);
    expect(fold(asking('A?')).waiting, 'one of its two questions').toBe(true);
    expect(fold(asking('B?', 'A?')).waiting, 'its questions out of order').toBe(true);
    // A call asking fewer questions than the wait does is not the one asked.
    const one = transcript();
    one.user('Go.');
    one.ask('A?');
    const [single] = activities(foldToolActivity(buildChatItems(one.events, [], true), { runs: 'none', wait: asking('A?', 'B?'), busy: true }));
    expect(single!.waiting, 'a call that asks only the first of the questions').toBe(true);
    expect(single!.attention).toEqual([]);
  });
});

describe('a stretch ends at anything that is not a tool entry (review 3478 A2)', () => {
  it('a divider, a mail card, a task card, a system row and a pending send each end one', () => {
    const t = transcript();
    t.user('Go.');
    for (let i = 0; i < 6; i += 1) t.call('Read', { file_path: `/repo/${i}.ts` });
    const tools = buildChatItems(t.events, [], false).filter((i) => i.kind === 'tool');
    const ev = { kind: 'assistant', uuid: 'x', ts: TS, text: '' };
    const between = [
      { kind: 'divider', key: 'd', label: '10:00' },
      { kind: 'mail', key: 'm', envelope: { artifacts: [], body: '' }, event: ev },
      { kind: 'task', key: 'k', notification: { fields: [] }, event: ev },
      { kind: 'message', key: 's', event: { kind: 'system', uuid: 's', ts: TS, text: 'note' }, streaming: false },
      { kind: 'pending', key: 'p', send: { key: 'p', text: 'hi' } },
    ] as unknown as ChatItem[];
    const items: ChatItem[] = tools.flatMap((tool, i) => (i < between.length ? [tool, between[i]!] : [tool]));
    const folded = foldToolActivity(items, { runs: 'none', wait: NONE, busy: false });
    expect(activities(folded).map((r) => r.entries.length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(folded.map((i) => i.kind)).toEqual([
      'tool-activity', 'divider', 'tool-activity', 'mail', 'tool-activity', 'task', 'tool-activity', 'message',
      'tool-activity', 'pending', 'tool-activity',
    ]);
  });
});

describe('the jsdom renderer and the heights', () => {
  it('ChatListInner takes the same path: one row per stretch, collapsed', () => {
    const s = longSession();
    for (const [, set] of SETS) {
      const { container, unmount } = render(
        <SkinSetProvider set={set}><ChatListInner id="s" events={s.events} pending={[]} /></SkinSetProvider>,
      );
      expect(rowsOf(container)).toHaveLength(s.stretches.length);
      unmount();
    }
  });

  it('outside a frame nothing folds', () => {
    const s = longSession();
    const { container } = render(<ChatListInner id="s" events={s.events} pending={[]} />);
    expect(rowsOf(container)).toHaveLength(0);
  });

  it('prices a row in its own bucket: one line, and the surfaced card\'s lines', () => {
    expect(HEIGHT_BUCKETS).toContain('activity');
    const s = longSession();
    const rows = activities(foldToolActivity(buildChatItems(s.events, [], false), { runs: 'none', wait: NONE, busy: false }));
    expect(shapeOf(rows[0]!)).toEqual({ bucket: 'activity', lines: 1 });
    const failed = rows.find((r) => r.attention.length > 0)!;
    expect(shapeOf(failed)).toEqual({ bucket: 'activity', lines: 2 });
    // A live wait's line is one line more.
    const t = transcript();
    t.user('Go.');
    t.live('Bash', { command: 'npm publish' });
    const waiting = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', wait: OTHER, busy: true }))[0]!;
    expect(waiting.waiting).toBe(true);
    expect(shapeOf(waiting)).toEqual({ bucket: 'activity', lines: 2 });
  });

  it("names a row word by word, and points its aria-controls only at a body that is there", () => {
    const s = longSession();
    const { container } = render(list(REFINED_SET, s.events, { askPending: true, askWait: asking('Ship it now?'), busy: true }));
    const rows = rowsOf(container);
    const last = rows[rows.length - 1]!;
    // What a screen reader is given: the text, less what is hidden from it (the chevron and the separators).
    const hidden = [...last.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent ?? '');
    let name = last.textContent ?? '';
    for (const h of hidden) name = name.replace(h, '');
    expect(name.replace(/\s+/g, ' ').trim()).toBe('Tool activity 2 calls running 1 question AskUserQuestion');
    // Every word is apart from the next, in the text itself.
    expect(name).not.toMatch(/activity\d|calls\S|running\d|question\S/);
    expect(last.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(last);
    const controls = last.getAttribute('aria-controls');
    expect(controls).not.toBeNull();
    expect(document.getElementById(controls!)).not.toBeNull();
  });
});
