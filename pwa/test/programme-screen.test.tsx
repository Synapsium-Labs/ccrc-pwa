// The programme view (desktop-polish PL5b, D-7713; spec section 3, the prototype's view 2): Goals on one side, this
// programme's share of the Waiting on you list on the other. `ProgrammeScreen` reads the fleet store (the list, the fleet's
// sessions and runs), asks the server for the programme's Goals, and navigates; the panels it draws take props only
// (`goals-panel.test.tsx`). The store is the test's own, the programme `prog-a`, the project `project-a`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { GoalsView } from '../../shared/ledgers';
import { WAITS_ON_WORDS } from '../../shared/ledgers';
import { ApiError } from '../src/lib/apiError';
import { api } from '../src/lib/api';
import { ROUTES, matchRoute, programmePath } from '../src/lib/routes';
import { ProgrammeScreen } from '../src/ledgers/ProgrammeScreen';
import { itemPath } from '../src/ledgers/WaitingRoutes';
import { createFleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { withRunBinding } from './runBindingFixture';
import { MIN, NOW, itemView, runRow, waitingView } from './ledgersFixture';

const SPEC = 'docs/superpowers/specs/2026-10-31-prog-a-design.md';
const makeSocket = (): WebSocket => ({ close() {}, set onopen(_v: unknown) {}, set onmessage(_v: unknown) {}, set onclose(_v: unknown) {}, set onerror(_v: unknown) {} }) as unknown as WebSocket;
const mk = () => createFleetStore({ makeSocket });

const goals = (over: Partial<GoalsView> = {}): GoalsView => ({
  program: 'prog-a', specPath: SPEC, inShort: 'A console view of what the programme is building.',
  inShortAt: NOW - 3 * 24 * 60 * MIN, modifications: [], ...over,
});
const live = [runRow({ id: 1, program: 'prog-a', state: 'working', wave: 2, waveOf: 5, programTitle: 'Programme A', homeProject: 'project-a' } as never)];

/** A store that has heard the fleet, the runs and a list. */
function heard(over: Partial<ReturnType<ReturnType<typeof mk>['getState']>> = {}) {
  const store = mk();
  act(() => store.setState({ fleetFrameSeen: true, runsFrameSeen: true, sessions: [], runs: live, waiting: waitingView(), ...over }));
  return store;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals() });
  history.replaceState(null, '', '/');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); history.replaceState(null, '', '/'); });

describe('the programme route', () => {
  it('matches /programmes/<slug> with the slug as its param, and nothing near it', () => {
    const at = matchRoute('/programmes/prog-a');
    expect(at?.route.id).toBe('programme');
    expect(at?.param).toBe('prog-a');
    expect(matchRoute('/programmes/prog-a/')?.param).toBe('prog-a');
    for (const bad of ['/programmes', '/programmes/', '/programmes/Prog-A', '/programmes/-a', '/programmes/a/b', '/programmesx/a', '/programme/a']) {
      expect(matchRoute(bad)?.route.id, bad).not.toBe('programme');
    }
  });

  it('is a page under the fleet, not a place of its own: no tab, and no "Go to" command', () => {
    const row = ROUTES.find((r) => r.id === 'programme')!;
    expect(row.top).toBe(false);
    expect(row.path).toBeNull();
    expect(row.title).toBe('Programme');
  });

  it('programmePath is the one builder of that path, and the route parses what it builds', () => {
    expect(programmePath('prog-a')).toBe('/programmes/prog-a');
    expect(matchRoute(programmePath('prog-a'))?.param).toBe('prog-a');
    expect(matchRoute(programmePath('a1-b2'))?.param).toBe('a1-b2');
  });
});

describe('the programme view: the head', () => {
  it('names the programme, its wave and a way back to the fleet', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Programme A' })).toBeTruthy();
    expect(screen.getByText('wave 2 of 5')).toBeTruthy();
    history.replaceState(null, '', '/programmes/prog-a');
    fireEvent.click(screen.getByRole('button', { name: 'Back to Fleet' }));
    expect(location.pathname).toBe('/');
  });

  it('says the programme has ended once the runs frame holds none open, and not before it has been heard', () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'done' })] });
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByText(WAITS_ON_WORDS.ended, { selector: '[data-ended]' })).toBeTruthy();
    view.unmount();
    render(<ProgrammeScreen slug="prog-a" store={heard({ runsFrameSeen: false, runs: [] })} />);
    expect(screen.queryByText(WAITS_ON_WORDS.ended, { selector: '[data-ended]' })).toBeNull();
  });
});

describe('the programme view: Goals', () => {
  it('asks the server for this programme\'s Goals and draws them, the spec link in the programme\'s home project', async () => {
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(await screen.findByText('A console view of what the programme is building.')).toBeTruthy();
    expect(api.goals).toHaveBeenCalledWith('prog-a');
    const link = screen.getByRole('link', { name: 'Open the spec in Docs' });
    expect(link.getAttribute('href')).toBe('/docs/project-a/specs/2026-10-31-prog-a-design.md');
  });

  it('builds no spec link when no run of the programme names a home project', async () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'working', homeProject: null } as never)] });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(await screen.findByText('A console view of what the programme is building.')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Open the spec in Docs' })).toBeNull();
  });

  it('draws the Goals the list already carries while the read is on the wire, and the read\'s answer replaces them', async () => {
    let release!: (v: { ok: true; goals: GoalsView }) => void;
    vi.spyOn(api, 'goals').mockReturnValue(new Promise((r) => { release = r; }));
    const store = heard({ waiting: waitingView({ goals: [goals({ inShort: 'The list\'s copy.' })] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByText('The list\'s copy.')).toBeTruthy();
    await act(async () => { release({ ok: true, goals: goals({ inShort: 'The newer read.' }) }); });
    expect(await screen.findByText('The newer read.')).toBeTruthy();
    expect(screen.queryByText('The list\'s copy.')).toBeNull();
  });

  it('draws only a view that is this programme\'s: another programme\'s answer is a failed read', async () => {
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ program: 'prog-b', inShort: 'Another programme\'s summary.' }) });
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Goals could not be read.');
    expect(screen.queryByText('Another programme\'s summary.')).toBeNull();
  });

  it('says it is reading until Goals arrive, never "no spec is pinned yet"', async () => {
    vi.spyOn(api, 'goals').mockReturnValue(new Promise(() => {}));
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(screen.getByText('Reading Goals…')).toBeTruthy();
    expect(screen.queryByText('No spec is pinned yet.')).toBeNull();
  });

  it('a failed read with no copy to show says so, and keeps the rest of the view', async () => {
    vi.spyOn(api, 'goals').mockRejectedValue(new ApiError(500, { ok: false, error: 'boom' }));
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items: [itemView({ id: 4, title: 'Pick the order' })] }) })} />);
    expect((await screen.findByRole('alert')).textContent).toBe('Goals could not be read.');
    expect(screen.getByRole('button', { name: /Pick the order/ })).toBeTruthy();
  });

  it('a failed read leaves the list\'s copy on screen', async () => {
    vi.spyOn(api, 'goals').mockRejectedValue(new TypeError('offline'));
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ goals: [goals({ inShort: 'The list\'s copy.' })] }) })} />);
    await waitFor(() => expect(api.goals).toHaveBeenCalled());
    await act(async () => { await Promise.resolve(); });
    expect(screen.getByText('The list\'s copy.')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a modification that came from an item links to it only while the list still holds that item', async () => {
    const mods = [
      { id: 2, at: NOW - MIN, text: 'Dropped the old flag', ruling: null, itemId: 7, pr: null, merged: true },
      { id: 1, at: NOW - 2 * MIN, text: 'Added a ledger', ruling: null, itemId: 8, pr: null, merged: true },
    ];
    vi.spyOn(api, 'goals').mockResolvedValue({ ok: true, goals: goals({ modifications: mods }) });
    const store = heard({ waiting: waitingView({ cleared: [itemView({ id: 7, state: 'done', closedAt: NOW })] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    await screen.findByText('Dropped the old flag');
    const links = screen.getAllByRole('link', { name: 'Open the item' });
    expect(links).toHaveLength(1); // item 8 is no longer on the list: no link to a page that says so
    expect(links[0]!.getAttribute('href')).toBe(itemPath(7));
    fireEvent.click(links[0]!);
    expect(location.pathname).toBe(itemPath(7));
  });
});

describe('the programme view: its share of the list', () => {
  const items = [
    itemView({ id: 1, program: 'prog-a', title: 'Pick the order', neededBy: 'blocking' }),
    itemView({ id: 2, program: 'prog-a', title: 'Switch it on' }),
    itemView({ id: 3, program: 'prog-a', title: 'Being checked', state: 'checking', tickedAt: NOW - MIN }),
    itemView({ id: 4, program: 'prog-b', title: 'Another programme\'s item' }),
  ];

  it('lists this programme\'s items and no other\'s, with the count of what waits on the operator', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items }) })} />);
    const card = screen.getByRole('region', { name: 'Waiting on you' });
    expect(within(card).getByRole('heading', { name: 'Waiting on you · 2' })).toBeTruthy();
    expect(within(card).getAllByRole('listitem').map((r) => within(r).getByText(/Pick|Switch|checked/).textContent))
      .toEqual(['Pick the order', 'Switch it on', 'Being checked']);
    expect(screen.queryByText('Another programme\'s item')).toBeNull();
  });

  it('a programme that leads the combined list (a blocking item) does not take this view\'s rows', () => {
    const lead = [itemView({ id: 30, program: 'prog-a', title: 'Mine', neededBy: 'later' }),
      itemView({ id: 31, program: 'prog-b', title: 'Blocks another programme', neededBy: 'blocking' })];
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items: lead }) })} />);
    expect(screen.getByRole('button', { name: /Mine/ })).toBeTruthy();
    expect(screen.queryByText('Blocks another programme')).toBeNull();
    expect(screen.getByRole('heading', { name: 'Waiting on you · 1' })).toBeTruthy();
  });

  it('counts a session\'s question of this programme beside the items, and lists it', () => {
    const asker = fleetSession({ id: 'project-a-ask', bucket: 'attention', title: 'Keep the old flag?', bucketSince: NOW - 6 * MIN });
    const runs = [runRow({ id: 1, program: 'prog-a', state: 'working', sessionId: 'project-a-ask', claimedBy: 'project-a-coord' })];
    const store = heard({ sessions: withRunBinding([asker], runs), runs, waiting: waitingView({ items: [items[0]!] }) });
    render(<ProgrammeScreen slug="prog-a" store={store} />);
    expect(screen.getByRole('heading', { name: 'Waiting on you · 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Keep the old flag/ })).toBeTruthy();
  });

  it('opening an item goes to its page', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ items }) })} />);
    fireEvent.click(screen.getByRole('button', { name: /Pick the order/ }));
    expect(location.pathname).toBe('/waiting/1');
  });

  it('lists what was recently cleared for this programme only', () => {
    const cleared = [
      itemView({ id: 20, program: 'prog-a', state: 'done', title: 'Approve v6', closedAt: NOW - 60 * MIN }),
      itemView({ id: 21, program: 'prog-b', state: 'done', title: 'Lift the cap', closedAt: NOW - 60 * MIN }),
    ];
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: waitingView({ cleared }) })} />);
    const trail = screen.getByRole('region', { name: 'Recently cleared' });
    expect(within(trail).getByText('Approve v6')).toBeTruthy();
    expect(within(trail).queryByText('Lift the cap')).toBeNull();
  });

  it('with nothing cleared it draws no trail', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard()} />);
    expect(screen.queryByRole('region', { name: 'Recently cleared' })).toBeNull();
  });
});

describe('the programme view: when nothing needs the operator', () => {
  const says = (store: ReturnType<typeof mk>): string => {
    const view = render(<ProgrammeScreen slug="prog-a" store={store} />);
    const text = screen.getByRole('region', { name: 'Waiting on you' }).textContent ?? '';
    view.unmount();
    return text;
  };

  it('with no open item it reads "Nothing needs you. Waiting on: <what the programme is waiting on>"', () => {
    const runs = (state: 'working' | 'awaiting-review' | 'merging' | 'planned') => [runRow({ id: 1, program: 'prog-a', state })];
    expect(says(heard({ runs: runs('working') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.work}`);
    expect(says(heard({ runs: runs('awaiting-review') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.review}`);
    expect(says(heard({ runs: runs('merging') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS['merge-queue']}`);
    expect(says(heard({ runs: runs('planned') }))).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS['next-wave']}`);
  });

  it('reads only this programme\'s runs: another programme\'s working run changes nothing', () => {
    const store = heard({ runs: [
      runRow({ id: 1, program: 'prog-a', state: 'planned' }), runRow({ id: 2, program: 'prog-b', state: 'working' }),
      runRow({ id: 3, program: 'prog-c', state: 'awaiting-review' }),
    ] });
    expect(says(store)).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS['next-wave']}`);
  });

  it('a programme with no open run says that, in the same sentence', () => {
    const store = heard({ runs: [runRow({ id: 1, program: 'prog-a', state: 'done' })] });
    expect(says(store)).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.ended}`);
  });

  it('an item the coordinator is checking is not the operator\'s: the sentence stands and the item is still listed', () => {
    const checking = itemView({ id: 3, program: 'prog-a', title: 'Being checked', state: 'checking', tickedAt: NOW - MIN });
    const store = heard({ waiting: waitingView({ items: [checking] }) });
    const text = says(store);
    expect(text).toContain(`Nothing needs you. Waiting on: ${WAITS_ON_WORDS.work}`);
    expect(text).toContain('Being checked');
  });

  it('says nothing of what the programme waits on while an item waits on the operator', () => {
    const store = heard({ waiting: waitingView({ items: [itemView({ id: 1, program: 'prog-a' })] }) });
    expect(says(store)).not.toMatch(/Nothing needs you|Waiting on:/);
  });

  it('before the runs frame it says "Nothing needs you." and names nothing it has not heard', () => {
    const text = says(heard({ runsFrameSeen: false, runs: [] }));
    expect(text).toContain('Nothing needs you.');
    expect(text).not.toContain('Waiting on:');
  });

  it('before the first list it says it is waiting, never that nothing needs the operator', () => {
    render(<ProgrammeScreen slug="prog-a" store={heard({ waiting: null })} />);
    expect(screen.getByRole('status').textContent).toMatch(/first update/i);
    expect(screen.queryByText(/Nothing needs you/)).toBeNull();
    // Goals do not wait on the list: they come from their own read.
    expect(screen.getByRole('region', { name: 'Goals' })).toBeTruthy();
  });
});
