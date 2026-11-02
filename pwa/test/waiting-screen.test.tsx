// The Waiting on you list (desktop-polish PL5a, D-7712; spec §2, view 1 of the prototype). `WaitingScreen` is pure over
// `{view, sessions, runs, now}`: it grows no store and no route of its own, so the cases pass what the shell would.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
          id: 4, title: 'Flip the lane', note: 'Settings still shows record only.',
          history: [
            { at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
            { at: NOW - 60 * MIN, act: 'return', note: 'Settings still shows record only.' },
          ],
        })],
      }),
    });
    const row = screen.getByRole('button', { name: /Flip the lane/ });
    expect(within(row).getByText('Came back')).toBeTruthy();
    expect(within(row).getByText(/Settings still shows record only\./)).toBeTruthy();
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

  it('a tapped item opens it', () => {
    const { onOpenItem } = open({ view: waitingView({ items: [itemView({ id: 7, title: 'Pick one' })] }) });
    fireEvent.click(screen.getByRole('button', { name: /Pick one/ }));
    expect(onOpenItem).toHaveBeenCalledWith(7);
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

  it('the rail filters to one programme', () => {
    open({
      view: waitingView({
        items: [itemView({ id: 1, program: 'prog-a', title: 'In A' }), itemView({ id: 2, program: 'prog-b', title: 'In B' })],
      }),
    });
    fireEvent.click(within(screen.getByRole('navigation', { name: 'Programmes' })).getByRole('button', { name: /prog-b/ }));
    expect(screen.queryByText('In A')).toBeNull();
    expect(screen.getByText('In B')).toBeTruthy();
  });
});
