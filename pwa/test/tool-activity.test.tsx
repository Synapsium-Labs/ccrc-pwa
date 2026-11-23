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
import { activityWords, foldToolActivity, type ToolActivityItem } from '../src/session/toolActivity';
import { groupToolRun } from '../src/session/toolSummary';

const seen = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
  scrolls: [] as unknown[],
  /** The rows the stand-in list renders, as [from, to) indices; null renders every row. */
  window: null as [number, number] | null,
}));

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: React.forwardRef((props: Record<string, unknown>, ref: React.Ref<unknown>) => {
      seen.props = props;
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

/** A long, tool-heavy session: TURNS turns of prose and tools mixed, one failed call, one answered question, then a
 *  last turn whose final stretch holds an open question and, newest, a call waiting on approval. */
const TURNS = 14;
function longSession() {
  const t = transcript();
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
    t.call('Bash', { command: 'git status' });
    t.say(`Step ${i} done.`);
  }
  t.user('Last step.');
  t.say('Checking first.');
  t.call('Read', { file_path: '/repo/src/last.ts' });
  const question = t.ask('Ship it now?');
  const approval = t.live('Bash', { command: 'npm publish' });
  return { ...t, question, approval };
}

const activities = (items: readonly unknown[]): ToolActivityItem[] =>
  items.filter((i): i is ToolActivityItem => (i as { kind: string }).kind === 'tool-activity');

/** The folded list flattened back: each activity row as its entries, every other item as itself. */
const unfold = (items: readonly (ChatItem | ToolActivityItem)[]): ChatItem[] =>
  items.flatMap((i) => (i.kind === 'tool-activity' ? i.entries : [i]));

// ---- the pure fold ----------------------------------------------------------------------------------------------------
describe('foldToolActivity: one row per contiguous stretch of a turn\'s tool activity', () => {
  it('makes exactly one row per stretch the transcript wrote, each holding that stretch\'s calls in order', () => {
    const s = longSession();
    const folded = foldToolActivity(buildChatItems(s.events, [], false), { runs: 'none', askPending: false, busy: false });
    const rows = activities(folded);
    expect(rows.map((r) => r.entries.map((e) => e.key))).toEqual(s.stretches);
    // A long session: many turns, more than one stretch per turn.
    expect(rows.length).toBe(TURNS * 2 + 1);
  });

  it('never reorders the transcript: unfolded, it is exactly the list `buildChatItems` made', () => {
    const s = longSession();
    const items = buildChatItems(s.events, [], true);
    const folded = foldToolActivity(items, { runs: 'tool-runs', askPending: true, busy: true });
    expect(unfold(folded).map((i) => i.key)).toEqual(items.map((i) => i.key));
    // Every item that is not a tool entry stands outside every row, prose above all.
    expect(folded.filter((i) => i.kind === 'message').length).toBe(items.filter((i) => i.kind === 'message').length);
    for (const row of activities(folded)) for (const e of row.entries) expect(e.kind).toBe('tool');
  });

  it('keeps a failed call inside its stretch and surfaces it', () => {
    const s = longSession();
    const rows = activities(foldToolActivity(buildChatItems(s.events, [], false), { runs: 'tool-runs', askPending: false, busy: false }));
    const withFailure = rows.filter((r) => r.attention.some((a) => a.kind === 'failed'));
    expect(withFailure).toHaveLength(1);
    const row = withFailure[0]!;
    expect(row.entries).toHaveLength(3); // the failed Edit, the Grep and git status: one stretch
    expect(row.attention.map((a) => [a.kind, a.entry.use.name])).toEqual([['failed', 'Edit']]);
    expect(activityWords(row).attention).toEqual(['1 failed']);
  });

  it('surfaces an open question and the call waiting on approval, those that block first', () => {
    const s = longSession();
    const rows = activities(foldToolActivity(buildChatItems(s.events, [], true), { runs: 'tool-runs', askPending: true, busy: true }));
    const last = rows[rows.length - 1]!;
    expect(last.attention.map((a) => [a.kind, a.entry.key])).toEqual([
      ['question', s.question.toolId],
      ['approval', s.approval.toolId],
    ]);
    expect(activityWords(last)).toMatchObject({ calls: '3 calls', state: 'running', attention: ['1 question', '1 waiting on you'] });
    // A blocking entry leads an older failure in the same stretch.
    const t = transcript();
    t.user('Go.');
    t.call('Bash', { command: 'npm test' }, true);
    const waiting = t.live('Bash', { command: 'npm publish' });
    const row = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', askPending: true, busy: true }))[0]!;
    expect(row.attention.map((a) => [a.kind, a.entry.key])).toEqual([['approval', waiting.toolId], ['failed', 't2']]);
  });

  it('marks an approval only while the session holds a live ask or dialog, and only on the newest call', () => {
    const s = longSession();
    const idle = activities(foldToolActivity(buildChatItems(s.events, [], true), { runs: 'none', askPending: false, busy: true }));
    expect(idle.flatMap((r) => r.attention.map((a) => a.kind))).not.toContain('approval');
    // An older resultless call (an interrupted one) is never the one a dialog is about.
    const t = transcript();
    t.user('Go.');
    t.live('Bash', { command: 'sleep 100' });
    t.say('Interrupted; carrying on.');
    const newest = t.live('Bash', { command: 'npm publish' });
    const rows = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', askPending: true, busy: true }));
    expect(rows.map((r) => r.attention.map((a) => [a.kind, a.entry.key]))).toEqual([[], [['approval', newest.toolId]]]);
    // And only the newest stretch is running.
    expect(rows.map((r) => r.live)).toEqual([false, true]);
  });

  it('says running only while the session works: a turn that ended with a call unanswered is not running', () => {
    const t = transcript();
    t.user('Go.');
    t.live('Bash', { command: 'npm test' });
    const fold = (busy: boolean): boolean =>
      activities(foldToolActivity(buildChatItems(t.events, [], busy), { runs: 'none', askPending: false, busy }))[0]!.live;
    expect(fold(true)).toBe(true);
    expect(fold(false)).toBe(false);
  });

  it('keeps its key while the stretch grows, so the reader\'s choice outlives an arriving call', () => {
    const t = transcript();
    t.user('Go.');
    t.call('Read', { file_path: '/repo/a.ts' });
    const before = activities(foldToolActivity(buildChatItems([...t.events], [], true), { runs: 'none', askPending: false, busy: true }));
    t.call('Read', { file_path: '/repo/b.ts' });
    t.live('Bash', { command: 'npm test' });
    const after = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', askPending: false, busy: true }));
    expect(after.map((r) => r.key)).toEqual(before.map((r) => r.key));
    expect(after[0]!.entries).toHaveLength(3);
    expect(after[0]!.latest).toBe('Ran npm');
  });

  it('opens into the skin\'s own grouping, unchanged: the runs for a set that folds them, the entries otherwise', () => {
    const s = longSession();
    const items = buildChatItems(s.events, [], false);
    for (const row of activities(foldToolActivity(items, { runs: 'tool-runs', askPending: false, busy: false }))) {
      expect(row.inner).toEqual(groupToolRun(row.entries));
    }
    for (const row of activities(foldToolActivity(items, { runs: 'none', askPending: false, busy: false }))) {
      expect(row.inner).toEqual(row.entries);
    }
  });

  it('says one call and many calls, and no running state once the stretch is done', () => {
    const t = transcript();
    t.user('Go.');
    t.call('Read', { file_path: '/repo/a.ts' });
    const one = activities(foldToolActivity(buildChatItems(t.events, [], false), { runs: 'none', askPending: false, busy: false }))[0]!;
    expect(activityWords(one)).toEqual({
      title: 'Tool activity', calls: '1 call', state: null, latest: 'Read a.ts', attention: [],
    });
  });
});

// ---- the rendered rows, in both skins ---------------------------------------------------------------------------------
const SETS: [string, SkinSet][] = [['Refined', REFINED_SET], ['Instrument', INSTRUMENT_SET]];

const rowsOf = (root: ParentNode): HTMLElement[] => [...root.querySelectorAll<HTMLElement>('.tool-activity-row')];

interface MountOpts { askPending?: boolean; askBelow?: boolean; onAnswer?: () => void; busy?: boolean; id?: string }
const list = (set: SkinSet, events: ChatEvent[], o: MountOpts = {}) => (
  <SkinSetProvider set={set}>
    <ChatList
      id={o.id ?? 's'} events={events} pending={[]} busy={o.busy ?? false} onRetry={() => {}} onDiscard={() => {}}
      askPending={o.askPending} askBelow={o.askBelow} onAnswer={o.onAnswer}
    />
  </SkinSetProvider>
);

describe.each(SETS)('%s draws one collapsed row per stretch', (_name, set) => {
  it('draws one row per stretch, collapsed, with every prose turn visible outside them', () => {
    const s = longSession();
    const { container } = render(list(set, s.events, { askPending: true, busy: true }));
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
    expect(surfaced).toHaveLength(2); // the failed Edit's row, and the last row (its open question leads)
    expect(container.querySelectorAll('.ref-tool-group')).toHaveLength(0);
    // The row's words: the title, the count, the running state and the newest call's summary.
    const last = rows[rows.length - 1]!;
    expect(last.textContent).toContain('Tool activity');
    expect(last.textContent).toContain('3 calls');
    expect(last.textContent).toContain('running');
    expect(last.textContent).toContain('Ran npm');
    expect(last.textContent).toContain('1 question');
    expect(last.textContent).toContain('1 waiting on you');
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
    const { container } = render(list(set, s.events, { askPending: true, onAnswer, busy: true }));
    const question = container.querySelector<HTMLElement>('.tool-activity-first[data-attention="question"]');
    expect(question, 'the open question is not surfaced').not.toBeNull();
    expect(question!.textContent).toContain('Ship it now?');
    fireEvent.click(within(question!).getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('surfaces a call waiting on approval with the transcript\'s answer control', () => {
    const onAnswer = vi.fn();
    const t = transcript();
    t.user('Publish.');
    t.call('Bash', { command: 'npm run build' });
    t.live('Bash', { command: 'npm publish' });
    const { container, rerender } = render(list(set, t.events, { askPending: true, onAnswer, busy: true }));
    const approval = container.querySelector<HTMLElement>('.tool-activity-first[data-attention="approval"]');
    expect(approval, 'the approval is not surfaced').not.toBeNull();
    expect(approval!.textContent).toContain('waiting for you');
    fireEvent.click(within(approval!).getByRole('button', { name: 'Answer' }));
    expect(onAnswer).toHaveBeenCalledTimes(1);
    // With the answer surface mounted below the transcript (the desk), the control takes the reader there.
    rerender(list(set, t.events, { askPending: true, askBelow: true, onAnswer, busy: true }));
    expect(within(container).getByRole('button', { name: 'Go to approval' })).toBeTruthy();
    // No live dialog: nothing waits on the reader, and nothing is surfaced.
    rerender(list(set, t.events, { askPending: false, onAnswer, busy: true }));
    expect(container.querySelector('.tool-activity-first')).toBeNull();
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

  it('keeps a row open while it is scrolled out of reach and back, and while calls arrive', () => {
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
    const rows = activities(foldToolActivity(buildChatItems(s.events, [], false), { runs: 'none', askPending: false, busy: false }));
    expect(shapeOf(rows[0]!)).toEqual({ bucket: 'activity', lines: 1 });
    const failed = rows.find((r) => r.attention.length > 0)!;
    expect(shapeOf(failed)).toEqual({ bucket: 'activity', lines: 2 });
    // An approval's card has its word and control under it: one line more.
    const t = transcript();
    t.user('Go.');
    t.live('Bash', { command: 'npm publish' });
    const approval = activities(foldToolActivity(buildChatItems(t.events, [], true), { runs: 'none', askPending: true, busy: true }))[0]!;
    expect(approval.attention.map((a) => a.kind)).toEqual(['approval']);
    expect(shapeOf(approval)).toEqual({ bucket: 'activity', lines: 3 });
  });

  it("names a row word by word, and points its aria-controls only at a body that is there", () => {
    const s = longSession();
    const { container } = render(list(REFINED_SET, s.events, { askPending: true, busy: true }));
    const rows = rowsOf(container);
    const last = rows[rows.length - 1]!;
    // What a screen reader is given: the text, less what is hidden from it (the chevron and the separators).
    const hidden = [...last.querySelectorAll('[aria-hidden="true"]')].map((el) => el.textContent ?? '');
    let name = last.textContent ?? '';
    for (const h of hidden) name = name.replace(h, '');
    expect(name.replace(/\s+/g, ' ').trim()).toBe('Tool activity 3 calls running 1 question 1 waiting on you Ran npm');
    // Every word is apart from the next, in the text itself.
    expect(name).not.toMatch(/activity\d|calls\S|running\d|you\S/);
    expect(last.hasAttribute('aria-controls')).toBe(false);
    fireEvent.click(last);
    const controls = last.getAttribute('aria-controls');
    expect(controls).not.toBeNull();
    expect(document.getElementById(controls!)).not.toBeNull();
  });
});
