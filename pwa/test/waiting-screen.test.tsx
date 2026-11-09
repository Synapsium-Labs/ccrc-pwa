// The Waiting on you list (desktop-polish PL5a, D-7712; spec §2, view 1 of the prototype). `WaitingScreen` is pure over
// `{view, sessions, runs, now}`: it grows no store and no route of its own, so the cases pass what the shell would.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { WAITS_ON_WORDS } from '../../shared/ledgers';
import { fleetHues } from '../src/fleet/programmeBoxes';
import { WaitingScreen } from '../src/ledgers/WaitingScreen';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';
import { run as runFixture } from './rollupFixture';
import { ApiError, api } from '../src/lib/api';
import { needsYou, needsYouCount } from '../src/ledgers/needsYou';
import { endRunAction } from '../../shared/ledgers';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const open = (props: Partial<React.ComponentProps<typeof WaitingScreen>> = {}) => {
  const onOpenItem = vi.fn();
  const onOpenSession = vi.fn();
  render(<WaitingScreen view={waitingView()} sessions={[]} runs={[]} now={NOW} onOpenItem={onOpenItem}
    onOpenSession={onOpenSession} {...props} />);
  return { onOpenItem, onOpenSession };
};

describe('the Waiting on you list', () => {
  it('the empty list says Nothing needs you', () => {
    open();
    expect(screen.getByText('Nothing needs you.')).toBeTruthy();
  });

  it('no frame yet is not the empty list', () => {
    open({ view: null });
    expect(screen.queryByText('Nothing needs you.')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
  });

  it('groups by programme in hue, programmes with a blocking item first', () => {
    const runs = [runRow({ id: 1, program: 'prog-a' }), runRow({ id: 2, program: 'prog-b' })];
    const hues = fleetHues(runs);
    open({
      runs,
      view: waitingView({
        items: [
          itemView({ id: 1, program: 'prog-a', title: 'A soon thing', neededBy: 'soon' }),
          itemView({ id: 2, program: 'prog-b', title: 'A blocking thing', neededBy: 'blocking' }),
          itemView({ id: 3, program: 'prog-b', title: 'A later thing', neededBy: 'later' }),
        ],
      }),
    });
    const groups = screen.getAllByRole('region', { name: /^prog-/ });
    expect(groups.map((g) => g.getAttribute('data-program'))).toEqual(['prog-b', 'prog-a']);
    expect(groups.map((g) => g.getAttribute('data-hue'))).toEqual([hues.get('prog-b'), hues.get('prog-a')]);
    // Within a group, blocking first.
    const rows = within(groups[0]!).getAllByRole('button').map((b) => b.getAttribute('data-item'));
    expect(rows).toEqual(['2', '3']);
  });

  it('a checking item reads Checking… and a stale one reads ticked; coordinator not responding', () => {
    open({
      view: waitingView({
        items: [
          itemView({ id: 1, state: 'checking', tickedAt: NOW - 5 * MIN, title: 'Fresh tick' }),
          itemView({ id: 2, state: 'checking', stale: true, tickedAt: NOW - 50 * MIN, title: 'Old tick' }),
        ],
      }),
    });
    const fresh = screen.getByRole('button', { name: /Fresh tick/ });
    const stale = screen.getByRole('button', { name: /Old tick/ });
    expect(within(fresh).getByText('Checking…')).toBeTruthy();
    expect(within(stale).getByText('ticked; coordinator not responding')).toBeTruthy();
    expect(within(fresh).queryByText('ticked; coordinator not responding')).toBeNull();
  });

  it('a returned item shows the coordinator\'s note under Came back', () => {
    open({
      view: waitingView({
        items: [itemView({
          id: 4, title: 'Flip the lane', note: 'A different line kept on the item.',
          history: [
            { at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
            { at: NOW - 60 * MIN, act: 'return', note: 'Settings still shows record only.' },
          ],
        })],
      }),
    });
    const row = screen.getByRole('button', { name: /Flip the lane/ });
    expect(within(row).getByText('Came back')).toBeTruthy();
    // The note is the history's return note, the coordinator's latest word: never the item's own `note` column.
    expect(within(row).getByText(/Settings still shows record only\./)).toBeTruthy();
    expect(within(row).queryByText(/A different line kept on the item/)).toBeNull();
  });

  it('Recently cleared lists done items', () => {
    open({
      view: waitingView({
        cleared: [itemView({ id: 9, state: 'done', title: 'Approve the prototype', closedAt: NOW - 24 * 60 * MIN })],
      }),
    });
    const trail = screen.getByRole('region', { name: 'Recently cleared' });
    expect(within(trail).getByText('Approve the prototype')).toBeTruthy();
  });

  // ONE WAITING ON YOU PAGE (desktop-polish PL11, D-7986; spec §2, D29): the programme page lost its cleared trail, so the list
  // filtered to a programme is where that programme's recently cleared items show, and only those; clearing the filter shows all.
  it('filtered to a programme, Recently cleared holds that programme\'s items only; unfiltered, every programme\'s', () => {
    const view = waitingView({
      items: [itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-b' })],
      cleared: [itemView({ id: 20, program: 'prog-a', state: 'done', title: 'Approve v6', closedAt: NOW - 60 * MIN }),
        itemView({ id: 21, program: 'prog-b', state: 'done', title: 'Lift the cap', closedAt: NOW - 60 * MIN })],
    });
    open({ view, programme: 'prog-a' });
    const trail = screen.getByRole('region', { name: 'Recently cleared' });
    expect(within(trail).getByText('Approve v6')).toBeTruthy();
    expect(within(trail).queryByText('Lift the cap')).toBeNull();
    cleanup();
    open({ view, programme: null });
    const all = screen.getByRole('region', { name: 'Recently cleared' });
    expect(within(all).getByText('Approve v6')).toBeTruthy();
    expect(within(all).getByText('Lift the cap')).toBeTruthy();
  });

  it('filtered to the sessions in no programme, Recently cleared is not drawn: every cleared item is a programme\'s', () => {
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'A question', bucketSince: NOW - 6 * MIN });
    const view = waitingView({ cleared: [itemView({ id: 20, program: 'prog-a', state: 'done', title: 'Approve v6', closedAt: NOW - 60 * MIN })] });
    open({ view, sessions: [asking], programme: '' });
    expect(screen.getByText('A question')).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Recently cleared' })).toBeNull();
  });

  it('a question row links to its session and is never tickable', () => {
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'Status flag question', bucketSince: NOW - 6 * MIN });
    const runs = [runRow({ id: 5, program: 'prog-a', sessionId: 'project-a-ask' })];
    const { onOpenSession, onOpenItem } = open({ sessions: withRunBinding([asking], runs), runs });
    const row = screen.getByRole('button', { name: /Status flag question/ });
    expect(within(row).getByText('Question')).toBeTruthy();
    expect(screen.queryByRole('checkbox')).toBeNull();
    expect(screen.queryByRole('button', { name: /mark done|tick/i })).toBeNull();
    fireEvent.click(row);
    expect(onOpenSession).toHaveBeenCalledWith('project-a-ask');
    expect(onOpenItem).not.toHaveBeenCalled();
  });

  it('before the first fleet frame it says it is waiting, never that nothing needs the operator', () => {
    open({ view: waitingView(), sessions: null });
    expect(screen.queryByText('Nothing needs you.')).toBeNull();
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    cleanup();
    open({ view: waitingView(), sessions: [] });
    expect(screen.getByText('Nothing needs you.')).toBeTruthy();
  });

  it('a list with items waits for the fleet frame too: its rows are not shown without the sessions\' questions', () => {
    open({ view: waitingView({ items: [itemView({ id: 1, title: 'An item on the list' })] }), sessions: null });
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    expect(screen.queryByText('An item on the list')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('says why no list will come, in place of the waiting line', () => {
    open({ view: null, unavailable: 'This box has no coordination database, so there is no Waiting on you list here.' });
    expect(screen.getByRole('alert').textContent).toMatch(/no coordination database/);
    expect(screen.queryByText(/first update/i)).toBeNull();
  });

  it('a programme with no open run is marked ended, and one with a run, or whose runs are unheard, is not', () => {
    const view = waitingView({ items: [itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-b' })] });
    const runs = [runRow({ id: 1, program: 'prog-a', state: 'working' }), runRow({ id: 2, program: 'prog-b', state: 'done' })];
    open({ view, runs });
    const marked = screen.getAllByRole('region', { name: /^prog-/ }).filter((g) => within(g).queryByText(WAITS_ON_WORDS.ended) !== null);
    expect(marked.map((g) => g.getAttribute('data-program'))).toEqual(['prog-b']);
    cleanup();
    open({ view, runs: null });
    expect(screen.queryByText(WAITS_ON_WORDS.ended)).toBeNull();
    cleanup();
    open({ view: waitingView({ items: [itemView({ id: 3 })], }), runs: [runRow({ id: 1, program: 'prog-a', state: 'working' })] });
    expect(screen.queryByText(WAITS_ON_WORDS.ended)).toBeNull();
  });

  it('the rail counts each programme\'s open items and questions, not what is being checked, and the total adds up', () => {
    const runs = [runRow({ id: 5, program: 'prog-a', sessionId: 'project-a-ask' })];
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'Which one?', bucketSince: NOW - MIN });
    open({
      runs, sessions: withRunBinding([asking], runs),
      view: waitingView({
        items: [
          itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-a', neededBy: 'later' }),
          itemView({ id: 3, program: 'prog-a', state: 'checking', tickedAt: NOW - MIN }),
          itemView({ id: 4, program: 'prog-b' }),
        ],
      }),
    });
    const rail = screen.getByRole('navigation', { name: 'Programmes' });
    const counts = within(rail).getAllByRole('button').map((b) => [b.querySelector('.wl-rail-name')!.textContent, b.querySelector('.wl-rail-n')!.textContent]);
    expect(counts).toEqual([['All programmes', '4'], ['prog-a', '3'], ['prog-b', '1']]);
  });

  it('a row says how soon an item is needed whatever its state', () => {
    open({
      view: waitingView({
        items: [
          itemView({ id: 1, title: 'Held one', state: 'checking', neededBy: 'blocking', tickedAt: NOW - MIN }),
          itemView({ id: 2, title: 'Sent back one', neededBy: 'blocking', history: [{ at: 1, act: 'raise', note: null }, { at: 2, act: 'return', note: 'no' }] }),
        ],
      }),
    });
    const held = screen.getByRole('button', { name: /Held one/ });
    expect(within(held).getByText('Checking…')).toBeTruthy();
    expect(within(held).getByText('Blocking')).toBeTruthy();
    const back = screen.getByRole('button', { name: /Sent back one/ });
    expect(within(back).getByText('Came back')).toBeTruthy();
    expect(within(back).getByText('Blocking')).toBeTruthy();
  });

  it('a tapped item opens it', () => {
    const { onOpenItem } = open({ view: waitingView({ items: [itemView({ id: 7, title: 'Pick one' })] }) });
    fireEvent.click(screen.getByRole('button', { name: /Pick one/ }));
    // The list it was opened from rides along (plan PL9): the combined list, unfiltered.
    expect(onOpenItem).toHaveBeenCalledWith(7, { at: 'waiting', programme: null });
  });

  it('the summary counts items by state', () => {
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', bucketSince: NOW - MIN });
    open({
      sessions: [asking],
      view: waitingView({
        items: [
          itemView({ id: 1, neededBy: 'blocking' }), itemView({ id: 2, neededBy: 'soon' }), itemView({ id: 3, neededBy: 'soon' }),
          itemView({ id: 4, state: 'checking' }),
          itemView({ id: 5, history: [{ at: 1, act: 'raise', note: null }, { at: 2, act: 'return', note: 'no' }] }),
        ],
      }),
    });
    const summary = screen.getByRole('list', { name: 'Summary' });
    const words = within(summary).getAllByRole('listitem').map((li) => li.textContent);
    expect(words).toEqual(['1 blocking now', '1 question from a session', '2 needed soon', '1 being checked', '1 came back']);
  });

  // REVIEW 1537 F4: under a filter the pills count only what the page draws, so prog-b's blocking item never reads on prog-a's
  // page, where a programme chip lands.
  it("filtered to a programme, the summary counts that programme's items alone: another's blocking item does not reach it", () => {
    open({
      programme: 'prog-a',
      view: waitingView({
        items: [
          itemView({ id: 1, program: 'prog-b', neededBy: 'blocking' }), itemView({ id: 2, program: 'prog-b', neededBy: 'soon' }),
          itemView({ id: 3, program: 'prog-a', neededBy: 'soon' }), itemView({ id: 4, program: 'prog-a', neededBy: 'soon' }),
        ],
      }),
    });
    const words = within(screen.getByRole('list', { name: 'Summary' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(words).toEqual(['2 needed soon']);
  });

  // REVIEW 1548 M3: the other filter. Filtered to the sessions in no programme, the pills count those sessions' questions alone:
  // a programme's blocking item does not reach them.
  it('filtered to the sessions in no programme, the summary counts their questions alone: a programme\'s blocking item does not reach it', () => {
    const asking = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'A question', bucketSince: NOW - 6 * MIN });
    open({
      sessions: [asking], programme: '',
      view: waitingView({ items: [itemView({ id: 1, program: 'prog-a', neededBy: 'blocking' }), itemView({ id: 2, program: 'prog-a', neededBy: 'soon' })] }),
    });
    const words = within(screen.getByRole('list', { name: 'Summary' })).getAllByRole('listitem').map((li) => li.textContent);
    expect(words).toEqual(['1 question from a session']);
  });

  it('the rail filters to the programme its prop names, keeps no copy of its own, and tells the route of a pick', () => {
    const view = waitingView({
      items: [itemView({ id: 1, program: 'prog-a', title: 'In A' }), itemView({ id: 2, program: 'prog-b', title: 'In B' })],
    });
    const onFilter = vi.fn();
    const { rerender } = render(<WaitingScreen view={view} sessions={[]} runs={[]} now={NOW} onOpenItem={vi.fn()}
      onOpenSession={vi.fn()} programme="prog-b" onFilter={onFilter} />);
    expect(screen.queryByText('In A')).toBeNull();
    expect(screen.getByText('In B')).toBeTruthy();
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Programmes' })).getByRole('button', { name: /prog-a/ }));
    expect(onFilter).toHaveBeenLastCalledWith('prog-a');
    // The pick is the route's to make: until the prop says prog-a, prog-b is what is drawn.
    expect(screen.queryByText('In A')).toBeNull();
    rerender(<WaitingScreen view={view} sessions={[]} runs={[]} now={NOW} onOpenItem={vi.fn()} onOpenSession={vi.fn()}
      programme={null} onFilter={onFilter} />);
    expect(screen.getByText('In A')).toBeTruthy();
    expect(screen.getByText('In B')).toBeTruthy();
  });
});

// Desktop-polish PL10 (D-7952; spec §2, D26): each programme group of the combined list links its pinned spec, at the address
// Goals builds (`programmeSpecHref`), and a programme with no pin, or no home project, has none.
describe('the spec one tap away on the combined list', () => {
  const SPEC = 'docs/superpowers/specs/2026-10-31-prog-a-design.md';
  const goalsOf = (program: string, specPath: string | null) => ({ program, specPath, inShort: null, inShortAt: null, modifications: [] });

  it('each programme group links the pinned spec; no spec link is drawn without a pin', () => {
    const runs = [runRow({ id: 1, program: 'prog-a', homeProject: 'project-a' } as never), runRow({ id: 2, program: 'prog-b', homeProject: 'project-a' } as never)];
    open({
      runs,
      view: waitingView({
        items: [itemView({ id: 1, program: 'prog-a' }), itemView({ id: 2, program: 'prog-b' })],
        goals: [goalsOf('prog-a', SPEC), goalsOf('prog-b', null)],
      }),
    });
    const [a, b] = ['prog-a', 'prog-b'].map((p) => document.querySelector<HTMLElement>(`.wl-group[data-program="${p}"]`)!);
    const link = within(a!).getByRole('link', { name: 'Spec for prog-a' });
    expect(link.getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
    expect(within(b!).queryByRole('link')).toBeNull();
    // Not even as words: a link with no address is no `link` role, so the words are what a dead "Spec" leaves (review 1466 F15).
    expect(within(b!).queryByText('Spec')).toBeNull();
  });

  it('no spec link without a home project, nor on the group of sessions in no programme', () => {
    open({
      runs: [runRow({ id: 1, program: 'prog-a', homeProject: null } as never)],
      view: waitingView({ items: [itemView({ id: 1, program: 'prog-a' })], goals: [goalsOf('prog-a', SPEC)] }),
    });
    expect(screen.queryByRole('link', { name: /^Spec/ })).toBeNull();
    expect(screen.queryByText('Spec'), 'no dead Spec word (review 1466 F15)').toBeNull();
  });
});

// D-8123 (limit-swap-autofix Task 11): a session on a usage limit that no account has room to take is a row of the list,
// beside an item and a question, in its programme's group, with its own controls, and it counts.
describe('a session on a usage limit with no account to take it', () => {
  const stuck = (id: string, over: object = {}) => fleetSession({
    id, title: `Worker ${id}`, wrapper: 'lane-a', home: 'lane-a',
    limitWait: { since: NOW - 12 * MIN, reset: null, account: 'lane-a', waiting: false, ...over },
  });

  it('draws one row with both controls, in the combined list, and counts it in the summary', () => {
    open({ sessions: [stuck('project-a-w1')] });
    const row = screen.getByTestId('limit-wait-row');
    expect(row.textContent).toContain('Worker project-a-w1 is on a usage limit and no account has room');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['No account has room yet', 'Wait until the limit resets']);
    expect(screen.getByLabelText('Summary').textContent).toContain('1 session on a usage limit');
    expect(screen.queryByText('Nothing needs you.')).toBeNull();
  });

  it('is filed under its programme, beside that programme\'s items, and the side rail counts it', () => {
    const runs = [runRow({ id: 1, program: 'prog-a', sessionId: 'project-a-w1' })];
    open({
      runs, sessions: withRunBinding([stuck('project-a-w1')], runs),
      view: waitingView({ items: [itemView({ id: 1, program: 'prog-a', title: 'An item' })] }),
    });
    const group = screen.getByRole('region', { name: /prog-a/ });
    expect(within(group).getByTestId('limit-wait-row')).toBeTruthy();
    expect(within(group).getByText('An item')).toBeTruthy();
    expect(within(screen.getByRole('navigation', { name: 'Programmes' })).getByRole('button', { name: /prog-a/ }).textContent).toContain('2');
  });

  it('keeps the summary count line right while a blocking item and a limit row come and go together', () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const blocking = waitingView({ items: [itemView({ id: 1, program: 'prog-a', title: 'Blocker', neededBy: 'blocking' })] });
    const sessions = [stuck('project-a-w1')];
    const props = { view: blocking, sessions, runs: [] as never[], now: NOW, onOpenItem: vi.fn(), onOpenSession: vi.fn() };
    const { rerender } = render(<WaitingScreen {...props} />);
    const pills = () => within(screen.getByLabelText('Summary')).getAllByRole('listitem').map((li) => li.textContent);
    expect(pills()).toEqual(['1 blocking now', '1 session on a usage limit']);
    // The blocking item is resolved: its pill must go, the limit's stays.
    rerender(<WaitingScreen {...props} view={waitingView()} />);
    expect(pills()).toEqual(['1 session on a usage limit']);
    // A blocking item and a second limit row arrive: each pill is drawn once.
    rerender(<WaitingScreen {...props} view={blocking} sessions={[stuck('project-a-w1'), stuck('project-a-w2')]} />);
    expect(pills()).toEqual(['1 blocking now', '2 sessions on a usage limit']);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('same key');
    errors.mockRestore();
  });

  it('opens nothing when the row itself is tapped: it is not an item, its controls are its own', () => {
    const { onOpenItem, onOpenSession } = open({ sessions: [stuck('project-a-w1')] });
    fireEvent.click(screen.getByTestId('limit-wait-row'));
    expect(onOpenItem).not.toHaveBeenCalled();
    expect(onOpenSession).not.toHaveBeenCalled();
  });
});

// Task 24 (runs rebuild §8.7, §10, F21; D-8076): the controls an item or a review cap carries on the list.
describe('the controls on /waiting (Task 24)', () => {
  const ORIGINS = ['Raised by its coordinator', 'Its coordinator did not answer', 'Its coordinator is gone'] as const;
  const endItem = (over: Partial<ReturnType<typeof itemView>> = {}) => itemView({
    id: 31, program: 'port-api', runId: 7, title: 'End run: Port the API, wave 1', why: `It never started.\n${ORIGINS[1]}`,
    how: ['Read why it asked.', 'Abandon the run, or keep it.'], action: endRunAction(7, null), ...over,
  });
  const live = runFixture(7, 'coord', 'w-7');
  const cap = (id: number, over: object = {}) => runFixture(id, 'coord', `w-${id}`, {
    reviewCap: { rounds: 3, cap: 3, askedAt: NOW - MIN, liftedAt: null, granted: 0, askHandledAt: null, coordLift: null }, ...over,
  });
  const rowOf = (id: number): HTMLElement => document.querySelector<HTMLElement>(`li:has([data-item="${id}"])`)!;

  it('an end-run row carries Abandon run and Keep the run, at the right from 640 and on their own line below it', () => {
    open({ runs: [live], view: waitingView({ items: [endItem(), itemView({ id: 32, program: 'port-api' })] }) });
    const li = rowOf(31);
    const acts = within(li).getByRole('group', { name: 'Run 7' });
    expect(within(acts).getAllByRole('button').map((b) => b.textContent)).toEqual(['Abandon run', 'Keep the run']);
    // The controls are siblings of the row's own button, never inside it (a button holds no button).
    expect(li.querySelector('[data-item="31"] button')).toBeNull();
    expect(acts.parentElement).toBe(li);
    // An ordinary item carries neither.
    expect(within(rowOf(32)).queryByRole('button', { name: /Abandon run|Keep the run/ })).toBeNull();
    // The width rule: one column below 640, the controls beside the row from 640 up.
    const css = readFileSync(path.join(__dirname, '../src/ledgers/ledgers.css'), 'utf8');
    expect(css).toMatch(/\.wl-li\[data-acts='true'\] \{ display: grid; grid-template-columns: minmax\(0, 1fr\) auto;/);
    expect(css).toMatch(/@media \(max-width: 639\.98px\) \{\s*\.wl-li\[data-acts='true'\] \{ grid-template-columns: minmax\(0, 1fr\); \}/);
  });

  it('Abandon run opens the single sheet and calls act', async () => {
    const act = vi.spyOn(api, 'actItem').mockResolvedValue({ released: true });
    const abandon = vi.spyOn(api, 'abandonRun');
    open({ runs: [live], view: waitingView({ items: [endItem()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run' }));
    // The one sheet of spec §9.1: its title names the run, and nothing is sent by the first tap.
    expect(await screen.findByText('Abandon run 7?')).toBeTruthy();
    expect(act).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run 7' }));
    await waitFor(() => expect(act).toHaveBeenCalledWith(31));
    expect(abandon).not.toHaveBeenCalled();
  });

  it('a refused act is said in the sheet, which stays open', async () => {
    vi.spyOn(api, 'actItem').mockRejectedValue(new ApiError(409, { error: 'not-open' }));
    open({ runs: [live], view: waitingView({ items: [endItem()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Abandon run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abandon run 7' }));
    expect(await screen.findByText(/This item is not open any more/)).toBeTruthy();
    expect(screen.getByText('Abandon run 7?')).toBeTruthy();
  });

  it('Keep the run confirms and calls decline', async () => {
    const decline = vi.spyOn(api, 'declineItem').mockResolvedValue({ ok: true, item: endItem({ state: 'dismissed' }) });
    open({ runs: [live], view: waitingView({ items: [endItem()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the run' }));
    expect(await screen.findByText('Keep run 7?')).toBeTruthy();
    expect(screen.getByText('The asker is told.')).toBeTruthy();
    expect(decline).not.toHaveBeenCalled();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Keep the run' }));
    await waitFor(() => expect(decline).toHaveBeenCalledWith(31));
  });

  it('Back leaves the item alone', async () => {
    const decline = vi.spyOn(api, 'declineItem');
    open({ runs: [live], view: waitingView({ items: [endItem()] }) });
    fireEvent.click(screen.getByRole('button', { name: 'Keep the run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Back' }));
    expect(decline).not.toHaveBeenCalled();
  });

  it('the row line ends in one of the three origins', () => {
    open({ runs: [live], view: waitingView({ items: ORIGINS.map((o, i) => endItem({ id: 40 + i, runId: 7, why: `Asked in its own words.\n${o}` })) }) });
    for (let i = 0; i < ORIGINS.length; i++) {
      const lines = rowOf(40 + i).querySelector('.wl-why')!.textContent!.split('\n');
      expect(lines.at(-1)).toBe(ORIGINS[i]);
      expect(ORIGINS).toContain(lines.at(-1));
    }
    // The line keeps its own line: the why is drawn with its newline.
    expect(rowOf(40).querySelector('.wl-why')!.getAttribute('data-lines')).toBe('true');
  });

  it('a saved copy draws the controls disabled', () => {
    open({ runs: [live], notCurrent: 'Saved on this device.', view: waitingView({ items: [endItem()] }) });
    expect((screen.getByRole('button', { name: 'Abandon run' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Keep the run' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('an end-run item whose run is not among the runs heard still offers Keep the run, and no Abandon run', () => {
    open({ runs: [], view: waitingView({ items: [endItem()] }) });
    expect(screen.queryByRole('button', { name: 'Abandon run' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Keep the run' })).toBeTruthy();
  });

  it('an item being checked or closed carries no end-run control', () => {
    open({ runs: [live], view: waitingView({ items: [endItem({ state: 'checking', tickedAt: NOW })] }) });
    expect(screen.queryByRole('button', { name: /Abandon run|Keep the run/ })).toBeNull();
  });

  it('a review cap is a /waiting row with Lift cap on it', async () => {
    vi.spyOn(api, 'reviewCap').mockReturnValue(new Promise(() => {}));
    open({ runs: [cap(12), cap(13, { reviewCap: { rounds: 3, cap: 3, askedAt: 1, liftedAt: 5 } })], view: waitingView() });
    const row = document.querySelector<HTMLElement>('[data-run="12"]')!;
    expect(row.textContent).toMatch(/Review cap/);
    expect(row.textContent).toMatch(/run 12/);
    expect(row.textContent).toMatch(/3 of 3 review rounds/);
    // The list is not empty because of it, and a lifted cap is no row.
    expect(screen.queryByText('Nothing needs you.')).toBeNull();
    expect(document.querySelector('[data-run="13"]')).toBeNull();
    fireEvent.click(within(row.closest('li')!).getByRole('button', { name: 'Lift cap' }));
    expect(await screen.findByText('Lift the review cap?')).toBeTruthy();
    expect(api.reviewCap).toHaveBeenCalledWith(12);
  });

  it('a review cap counts once on the page, in its programme group, in the summary, and in the door', () => {
    const runs = [cap(12), runFixture(14, 'coord', 'w-14', { program: 'other', programTitle: 'Other' })];
    open({ runs, view: waitingView({ items: [itemView({ id: 1, program: 'port-api' })] }) });
    const group = document.querySelector('.wl-group[data-program="port-api"]')!;
    expect(group.querySelectorAll('.wl-item, .wl-capitem')).toHaveLength(2);
    expect(screen.getByText('1 review cap to lift')).toBeTruthy();
    const rail = screen.getByRole('navigation', { name: 'Programmes' });
    expect(within(rail).getByRole('button', { name: /All programmes/ }).textContent).toMatch(/2$/);
    // The door's number is the page's: both read `needsYou`.
    expect(needsYouCount(needsYou([itemView({ id: 1, program: 'port-api' })], [], runs))).toBe(2);
  });

  it('a review cap sits under the programme filter it belongs to', () => {
    open({ runs: [cap(12)], programme: 'other', view: waitingView({ items: [itemView({ id: 1, program: 'other' })] }) });
    expect(document.querySelector('[data-run="12"]')).toBeNull();
  });
});
