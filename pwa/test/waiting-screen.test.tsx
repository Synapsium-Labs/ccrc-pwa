// The Waiting on you list (desktop-polish PL5a, D-7712; spec §2, view 1 of the prototype). `WaitingScreen` is pure over
// `{view, sessions, runs, now}`: it grows no store and no route of its own, so the cases pass what the shell would.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { WAITS_ON_WORDS } from '../../shared/ledgers';
import { fleetHues } from '../src/fleet/programmeBoxes';
import { WaitingScreen } from '../src/ledgers/WaitingScreen';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';

afterEach(cleanup);

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
