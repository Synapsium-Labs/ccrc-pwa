// Every `/api/accounts` reader's rendered state, pinned (W7 C7a's deferred file, landed as C7b Step 1; D-7179, D-7180,
// D-7221; ARCH-28 #540).
//
// The fleet store is the one reader of `GET /api/accounts` (#1720, D-6440): its poll and `refreshAccounts()` are the
// only calls, and the four readers below subscribe to what that read writes. These rows hold what each reader shows
// over the states the store can be in, written against #1720's behaviour (coordinator call 3):
//   - a cold start with a persisted fleet snapshot that carries a roster, before any answer: the store's `roster` is
//     hydrated from the snapshot (#1720's rule), and no reader renders account rows from it (the strip's placeholder,
//     the screen's skeleton, `useAccountUsage`'s `null`, `useProjectedHome`'s `undefined`);
//   - a malformed answer (`accounts`, `roster` and `projected` not of their shapes) after a good one: every reader keeps
//     the last good value;
//   - `projected` before any answer (`undefined`) beside an answer that says nothing is placeable (`null`);
//   - the request schedule, under fake timers: each reader mounted (or, for a picker, opened) after the store's first
//     answer, and the `/api/accounts` requests it causes counted. The strip and the three pickers send none (#1720's
//     store read, accepted under coordinator call 3: they show the store's answer, at most 20 s old).
import { createElement, type ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { AccountsResponse, AccountUsage, ProjectedHome } from '../../shared/api';
import { AccountsStrip as Strip } from '../src/fleet/AccountsStrip';
import { NewSessionSheet } from '../src/fleet/NewSessionSheet';
import { StartProgramSheet } from '../src/fleet/StartProgramSheet';
import { SwapSheet } from '../src/fleet/SwapSheet';
import { useAccountUsage, useProjectedHome } from '../src/fleet/useProjectedHome';
import { api } from '../src/lib/api';
import { saveFleetSnapshot } from '../src/lib/offline';
import { AccountsScreen } from '../src/screens/AccountsScreen';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

const nowSec = Math.floor(Date.now() / 1000);

const usage = (wrapper: string, five: number, seven: number): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false,
});

const GOOD: AccountsResponse = {
  accounts: [usage('claude', 12, 30), usage('claude9', 40, 55)],
  projected: { wrapper: 'claude', score: 12 },
  roster: TEST_ROSTER,
} as AccountsResponse;

/** A route answering the wrong shape on every accounts field. */
const MALFORMED = { accounts: 'nope', roster: 'nope', projected: 'nope' } as unknown as AccountsResponse;

const NOTHING_PLACEABLE: AccountsResponse = { accounts: [], projected: null, roster: TEST_ROSTER } as AccountsResponse;

/** `AccountsStrip` with its optional `store` prop typed for `createElement` (its props default to `{}`). */
const AccountsStrip = Strip as (props: { store?: FleetStore }) => ReactNode;

const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {}, send(): void {} }) as unknown as WebSocket;

/** A store whose one read answers each call with the next of `answers` (the last repeats). */
const storeAnswering = (...answers: AccountsResponse[]): FleetStore => {
  let i = 0;
  return createFleetStore({ makeSocket: fakeSocket, fetchAccounts: async () => answers[Math.min(i++, answers.length - 1)]! });
};

/** What the two hooks answer, as one line: `useAccountUsage(true)`'s wrappers and `useProjectedHome(true)`'s word. */
function HookProbe({ store }: { store: FleetStore }): ReactNode {
  const rows = useAccountUsage(true, store);
  const projected = useProjectedHome(true, store);
  return createElement('output', { 'data-testid': 'hooks' }, `${hookWords(rows, projected)}`);
}

const hookWords = (rows: readonly AccountUsage[] | null, projected: ProjectedHome | null | undefined): string =>
  `usage=${rows === null ? 'null' : rows.map((u) => u.wrapper).join(',') || '[]'}|projected=${projected === undefined ? 'undefined' : projected === null ? 'null' : projected.wrapper}`;

const hooks = (): string => screen.getByTestId('hooks').textContent ?? '';
const gauges = (root: ParentNode = document): number => root.querySelectorAll('.account-gauge').length;
const accountRows = (): number => document.querySelectorAll('.accounts-list .accounts-row:not([data-loading])').length;
const skeletons = (): number => document.querySelectorAll('.accounts-list .accounts-row[data-loading="true"]').length;
const projectionLine = (): string | null => document.querySelector('.accounts-projection')?.textContent ?? null;
const rosterLabelsShown = (): string[] => TEST_ROSTER.map((a) => a.label).filter((l) => l !== 'gpt' && screen.queryAllByText(new RegExp(l)).length > 0);

/** The app-wide store's accounts fields put back to "nothing landed", so each case starts cold. */
const coldAppStore = (): void => {
  act(() => useFleetStore.setState({
    sessions: [], conn: 'connecting', usage: null, projected: undefined, roster: [], lanes: null, accountsConnect: null,
  }));
};

beforeEach(() => {
  window.localStorage.clear();
  coldAppStore();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.localStorage.clear();
  coldAppStore();
});

describe('cold start: a persisted snapshot with a roster, before any answer', () => {
  it('the store hydrates the roster only; the strip shows its placeholder and the hooks answer null and undefined', () => {
    saveFleetSnapshot([fleetSession({ id: 'session-a', project: 'project-a' })], TEST_ROSTER);
    const store = createFleetStore({ makeSocket: fakeSocket, fetchAccounts: () => new Promise(() => {}) });
    // #1720's rule: the roster is the snapshot's; usage and projected are not hydrated.
    expect(store.getState().roster).toEqual(TEST_ROSTER);
    expect(store.getState().usage).toBeNull();
    expect(store.getState().projected).toBeUndefined();
    render(createElement('div', null, createElement(AccountsStrip, { store }), createElement(HookProbe, { store })));
    expect(screen.getByText('checking accounts…')).toBeInTheDocument();
    expect(gauges()).toBe(0);
    expect(hooks()).toBe('usage=null|projected=undefined');
  });

  it('the Accounts screen shows its skeleton, no account row and no projection line, over the snapshot\'s roster', () => {
    saveFleetSnapshot([fleetSession({ id: 'session-a', project: 'project-a' })], TEST_ROSTER);
    // The app-wide store is built at import, before this case wrote its snapshot: give it the state a store built
    // after the snapshot holds, read off a real one, so the screen sees the cold start the store produces.
    const cold = createFleetStore({ makeSocket: fakeSocket, fetchAccounts: () => new Promise(() => {}) }).getState();
    act(() => useFleetStore.setState({ roster: cold.roster, usage: cold.usage, projected: cold.projected }));
    expect(useFleetStore.getState().roster).toEqual(TEST_ROSTER);
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    render(createElement(AccountsScreen));
    expect(skeletons()).toBe(1);
    expect(accountRows()).toBe(0);
    expect(projectionLine()).toBeNull();
    expect(rosterLabelsShown()).toEqual([]);
  });
});

describe('a malformed answer after a good one keeps the last good value in every reader', () => {
  it('the strip and the two hooks', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const store = storeAnswering(GOOD, MALFORMED);
    const { container } = render(createElement('div', null, createElement(AccountsStrip, { store }), createElement(HookProbe, { store })));
    await act(() => store.getState().refreshAccounts());
    expect(gauges(container)).toBe(2);
    expect(hooks()).toBe('usage=claude,claude9|projected=claude');
    const good = container.textContent;
    await act(() => store.getState().refreshAccounts());
    expect(gauges(container)).toBe(2);
    expect(hooks()).toBe('usage=claude,claude9|projected=claude');
    expect(screen.queryByText('checking accounts…')).toBeNull();
    expect(container.textContent).toBe(good);
  });

  it('the Accounts screen', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const spy = vi.spyOn(api, 'accounts').mockResolvedValueOnce(GOOD).mockResolvedValue(MALFORMED);
    const { container } = render(createElement(AccountsScreen));
    await act(() => useFleetStore.getState().refreshAccounts());
    await act(async () => { await Promise.resolve(); });
    expect(accountRows()).toBe(TEST_ROSTER.length);
    expect(projectionLine()).toBe('Next workspace lands on team·max — least-loaded');
    const good = container.textContent;
    await act(() => useFleetStore.getState().refreshAccounts());
    expect(spy.mock.results.length, 'the malformed read ran').toBeGreaterThanOrEqual(2);
    expect(skeletons()).toBe(0);
    expect(accountRows()).toBe(TEST_ROSTER.length);
    expect(projectionLine()).toBe('Next workspace lands on team·max — least-loaded');
    expect(container.textContent).toBe(good);
  });
});

describe('projected: undefined before any answer, null once an answer says nothing is placeable', () => {
  it('useProjectedHome and useAccountUsage', async () => {
    const store = storeAnswering(NOTHING_PLACEABLE);
    render(createElement(HookProbe, { store }));
    expect(hooks()).toBe('usage=null|projected=undefined');
    await act(() => store.getState().refreshAccounts());
    expect(hooks()).toBe('usage=[]|projected=null');
  });

  it('the Accounts screen: no projection line, then the nothing-placeable line', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue(NOTHING_PLACEABLE);
    act(() => useFleetStore.setState({ roster: TEST_ROSTER }));
    render(createElement(AccountsScreen));
    expect(projectionLine()).toBeNull();
    expect(skeletons()).toBe(1);
    await act(() => useFleetStore.getState().refreshAccounts());
    await act(async () => { await Promise.resolve(); });
    expect(projectionLine()).toBe('Next workspace: team·max, team·alt, team·b and team·d all disabled — nothing can take it');
  });
});

describe('the request schedule: each reader mounted or opened after the store\'s first answer', () => {
  let requests = 0;

  /** Counts `/api/accounts` both ways it could leave the page: through `api.accounts` and as a bare fetch. */
  const countRequests = (): void => {
    vi.spyOn(api, 'accounts').mockImplementation(async () => { requests += 1; return GOOD; });
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      if (url.includes('/api/accounts')) requests += 1;
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  };

  /** The store's first answer has landed; the counter starts after it. */
  const firstAnswerLanded = async (): Promise<void> => {
    act(() => useFleetStore.setState({ conn: 'open', sessions: [fleetSession({ id: 'session-a', wrapper: 'claude', home: 'claude', project: 'project-a' })] }));
    await act(() => useFleetStore.getState().refreshAccounts());
    expect(useFleetStore.getState().usage).toEqual(GOOD.accounts);
    requests = 0;
  };

  /** Five seconds of the page open, well inside the store's 20 s cadence. */
  const fiveSeconds = async (): Promise<void> => {
    for (let s = 0; s < 5; s += 1) await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
  };

  beforeEach(() => {
    requests = 0;
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout'] });
    countRequests();
  });

  it('the strip sends none on mount', async () => {
    await firstAnswerLanded();
    render(createElement(AccountsStrip));
    await fiveSeconds();
    expect(gauges()).toBe(2);
    expect(requests).toBe(0);
  });

  // C7b Step 3's behaviour row (coordinator call 3; D-7180): opening Accounts asks once, so the screen shows the
  // store's answer at once and then a fresh one. #1720's tree sent none here.
  it('the Accounts screen sends one on open, and shows the store\'s answer before it lands', async () => {
    await firstAnswerLanded();
    render(createElement(AccountsScreen));
    expect(accountRows(), 'the store\'s answer, at once').toBe(TEST_ROSTER.length);
    await fiveSeconds();
    expect(requests).toBe(1);
    expect(accountRows()).toBe(TEST_ROSTER.length);
  });

  // The pickers are mounted unconditionally and opened by their `open` prop: each is mounted closed, then opened.
  const session = { id: 'session-a', wrapper: 'claude', project: 'project-a', home: 'claude' };
  const pickers: Array<[string, (open: boolean) => ReactNode]> = [
    ['SwapSheet', (open) => createElement(SwapSheet, { session, open, onClose: () => {} })],
    ['NewSessionSheet', (open) => createElement(NewSessionSheet, { open, onClose: () => {} })],
    ['StartProgramSheet', (open) => createElement(StartProgramSheet, {
      open, onClose: () => {}, openRunProjects: new Set<string>(),
      loadProjects: async () => ({ roots: [], projects: [] }),
    })],
  ];

  it.each(pickers)('%s sends none on open (#1720\'s store read, accepted under coordinator call 3)', async (_name, sheet) => {
    await firstAnswerLanded();
    const { rerender } = render(sheet(false));
    await fiveSeconds();
    rerender(sheet(true));
    await fiveSeconds();
    expect(requests).toBe(0);
  });
});
