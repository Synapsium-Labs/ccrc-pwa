// The Move sessions sheet (accounts plan Task A3; spec 2026-10-18 accounts-connect §4.5): "Move N sessions off" moves
// every session on one lane through `POST /api/sessions/:id/swap`, ONE AT A TIME, to SwapSheet's own target, skipping
// busy sessions unless the operator consents, and naming each session's outcome from its answer's code. The fixture is
// four sessions on lane-b (one busy, one hibernated) and three targets: lane-a and lane-f in pool `p1`, lane-c in `p2`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { AccountUsage, FleetSession, ProjectPoolsWire, RosterWire } from '../../shared/api';
import { SWAP_REFUSALS } from '../../shared/api';
import { stateWordFor } from '../../shared/accounts';
import { api, ApiError } from '../src/lib/api';
import { MOVE_LINK_LOST, MOVE_OFFLINE, MoveSessionsSheet, sessionsToMove } from '../src/fleet/MoveSessionsSheet';
import { TroubleCard } from '../src/fleet/TroubleCard';
import { troubleCopy } from '../src/fleet/accountWords';
import { createFleetStore, type FleetState, type FleetStore } from '../src/stores/fleet';
import { fleetSession, hibernatedSession } from './fleetFixture';

const nowSec = Math.floor(Date.now() / 1000);
const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

const lane = (id: string, pool: string | null, over: Partial<RosterWire> = {}): RosterWire => ({
  id, label: `${id} label`, hue: 'cyan', homeAble: true, hidden: false, pool, provider: 'anthropic', kind: 'sign-in', ...over,
});
const ROSTER: RosterWire[] = [lane('lane-a', 'p1'), lane('lane-b', 'p1'), lane('lane-c', 'p2'), lane('lane-f', 'p1')];

const usage = (wrapper: string, five: number, seven: number, over: Partial<AccountUsage> = {}): AccountUsage => ({
  wrapper, five, seven, ts: nowSec - 60, fiveResetAt: null, sevenResetAt: null,
  fiveRolledOver: false, sevenRolledOver: false, disabled: false, authDead: false, ...over,
});
// lane-c is the emptiest lane on the fleet, and the only one in the other pool: it must never be the default.
const USAGE: AccountUsage[] = [
  usage('lane-a', 30, 40), usage('lane-b', 100, 60), usage('lane-c', 2, 3), usage('lane-f', 50, 55),
];

const POOLS: ProjectPoolsWire = {
  listed: true, enforcement: 'enforced',
  byProject: { 'p-one': { state: 'tagged', name: 'p1' }, 'p-two': { state: 'tagged', name: 'p1' } },
};

const s1 = fleetSession({ id: 'lane-b:p-one', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'one' });
const s2 = fleetSession({ id: 'lane-b:p-two', wrapper: 'lane-b', home: 'lane-b', project: 'p-two', title: 'two', status: 'busy' });
const s3 = hibernatedSession(Date.now() - 60_000, { id: 'lane-b:p-three', wrapper: 'lane-b', home: 'lane-b', project: 'p-one', title: 'three' });
const s4 = fleetSession({ id: 'lane-b:p-four', wrapper: 'lane-b', home: 'lane-b', project: 'p-two', title: 'four' });
const elsewhere = fleetSession({ id: 'lane-a:p-one', wrapper: 'lane-a', home: 'lane-a', project: 'p-one', title: 'stays' });
const SESSIONS = [s1, s2, s3, s4, elsewhere];

const storeWith = (o: {
  sessions?: FleetSession[]; usage?: AccountUsage[]; pools?: ProjectPoolsWire | null; conn?: FleetState['conn'];
} = {}): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => {
    store.setState({
      conn: o.conn ?? 'open', sessions: o.sessions ?? SESSIONS, roster: ROSTER, usage: o.usage ?? USAGE,
      pools: o.pools === undefined ? POOLS : o.pools,
    });
  });
  return store;
};

const refusal = (status: number, body: unknown): ApiError => new ApiError(status, body);

/** A swap stub that answers each call when the test says so, recording the calls in the order they were sent. */
function deferredSwap() {
  const pending: { args: unknown[]; resolve: () => void; reject: (e: unknown) => void }[] = [];
  const spy = vi.spyOn(api, 'swap').mockImplementation((...args: unknown[]) => new Promise<unknown>((resolve, reject) => {
    pending.push({ args, resolve: () => resolve(undefined), reject });
  }) as never);
  return { spy, pending };
}

const show = (store: FleetStore): void => {
  render(<MoveSessionsSheet lane="lane-b" open onClose={vi.fn()} fleet={store} />);
};
const startMove = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: /^Move \d+ sessions?$/ }));
};
const row = (title: string): HTMLElement => screen.getByText(title).closest('.move-row') as HTMLElement;
const wordOf = (title: string): string => row(title).querySelector('.move-word')?.textContent ?? '';
const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); }); };

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Move sessions moves one at a time (spec §4.5)', () => {
  it('the second swap is not sent until the first has answered', async () => {
    const { spy, pending } = deferredSwap();
    show(storeWith());
    await startMove();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]![0]).toBe(s1.id);
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { pending[0]!.resolve(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2));
    expect(spy.mock.calls[1]![0]).toBe(s2.id);
    // Each send waits for the answer before it: at no instant are two in flight.
    await act(async () => { pending[1]!.resolve(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(3));
    await act(async () => { pending[2]!.resolve(); });
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(4));
    expect(spy.mock.calls.map((c) => c[0])).toEqual([s1.id, s2.id, s3.id, s4.id]);
  });

  it('the progress line counts what has answered, not what was sent', async () => {
    const { pending } = deferredSwap();
    show(storeWith());
    await startMove();
    await flush();
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe('Moving 1 of 4');
    expect(wordOf('one')).toBe('moving…');
    expect(wordOf('two')).toBe('waiting');
    await act(async () => { pending[0]!.resolve(); });
    await waitFor(() => expect(status.textContent).toBe('Moving 2 of 4'));
    expect(wordOf('one')).toBe('moved');
    for (const i of [1, 2, 3]) {
      await waitFor(() => expect(pending).toHaveLength(i + 1));
      await act(async () => { pending[i]!.resolve(); });
    }
    await waitFor(() => expect(status.textContent).toBe('Done: 4 of 4 moved.'));
  });

  it('"Stop after this one" ends the move after the session in flight: no further swap is sent', async () => {
    const { spy, pending } = deferredSwap();
    show(storeWith());
    await startMove();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Stop after this one' }));
    // The session in flight is not abandoned: the stop waits for its answer.
    const stopping = screen.getByRole('button', { name: 'Stopping after this one' }) as HTMLButtonElement;
    expect(stopping.disabled).toBe(true);
    await act(async () => { pending[0]!.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped: 1 of 4 moved.'));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(['one', 'two', 'three', 'four'].map(wordOf)).toEqual(['moved', 'not sent', 'not sent', 'not sent']);
    // A stop the operator asked for says nothing of the link.
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('closing the sheet mid-move is a stop: the session in flight finishes, and nothing after it is sent', async () => {
    const { spy, pending } = deferredSwap();
    const onClose = vi.fn();
    // The parent here leaves the sheet open, so the rows and the line can still be read after the close.
    render(<MoveSessionsSheet lane="lane-b" open onClose={onClose} fleet={storeWith()} />);
    await startMove();
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    // The scrim is the phone sheet's close (the ✕ is the desktop arm's); both call the sheet's own close.
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(onClose).toHaveBeenCalled();
    await act(async () => { pending[0]!.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped: 1 of 4 moved.'));
    await flush();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(['one', 'two', 'three', 'four'].map(wordOf)).toEqual(['moved', 'not sent', 'not sent', 'not sent']);
  });

  it('only the sessions on the lane, archived and dead ones left out, asleep ones kept to be named', () => {
    const archived = fleetSession({ id: 'lane-b:gone', wrapper: 'lane-b', project: 'p-one', archivedAt: Date.now() });
    expect(sessionsToMove([...SESSIONS, archived], 'lane-b').map((s) => s.id)).toEqual([s1.id, s2.id, s3.id, s4.id]);
  });
});

describe('the target is SwapSheet\'s, same pool by default', () => {
  it('the default target is the least-loaded lane in the same pool, and cross-pool is never the default', async () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined as never);
    show(storeWith({ sessions: [s1, s4] }));
    // lane-c (2%) is emptier, but it is in pool p2: the default is lane-a, the least loaded of p1's lanes.
    expect(screen.getByText(/^To lane-a label · least-loaded in this pool\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /lane-c label/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'show other pools (1)' })).toBeInTheDocument();
    await startMove();
    await waitFor(() => expect(swap).toHaveBeenCalledTimes(2));
    // The plain two-argument call: no crossPool, no interrupt.
    expect(swap.mock.calls).toEqual([[s1.id, 'lane-a'], [s4.id, 'lane-a']]);
  });

  it('with no measured lane in the pool there is no default, even though another pool has one', () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined as never);
    show(storeWith({
      sessions: [s1], usage: [usage('lane-a', 30, 40, { fiveRolledOver: true }), usage('lane-c', 2, 3), usage('lane-f', 0, 0, { authDead: true })],
    }));
    expect(screen.getByText('Pick the account to move them to.')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: 'Move 1 session' }) as HTMLButtonElement).disabled).toBe(true);
    expect(swap).not.toHaveBeenCalled();
  });

  it('crossing pools is a separate explicit choice, and sets crossPool only where the target crosses', async () => {
    const swap = vi.spyOn(api, 'swap').mockResolvedValue(undefined as never);
    // p-two is untagged here, so lane-c crosses for p-one only.
    show(storeWith({ sessions: [s1, s4], pools: { ...POOLS, byProject: { 'p-one': { state: 'tagged', name: 'p1' } } } }));
    fireEvent.click(screen.getByRole('button', { name: 'show other pools (1)' }));
    fireEvent.click(screen.getByRole('button', { name: /lane-c label/ }));
    expect(screen.getByText(/^To lane-c label\. This crosses pools on purpose/)).toBeInTheDocument();
    await startMove();
    await waitFor(() => expect(swap).toHaveBeenCalledTimes(2));
    expect(swap.mock.calls).toEqual([[s1.id, 'lane-c', { crossPool: true }], [s4.id, 'lane-c']]);
  });
});

describe('busy, asleep and refused sessions', () => {
  /** lane-b's sessions as the route answers them: the busy one is `409 session-busy` unless the move consents, the
   *  hibernated one `409 hibernated`, the others move. */
  const routeLike = () => vi.spyOn(api, 'swap').mockImplementation(((id: string, _w: string, opts?: { interrupt?: boolean }) => {
    if (id === s2.id && opts?.interrupt !== true) return Promise.reject(refusal(409, { ok: false, error: SWAP_REFUSALS.sessionBusy }));
    if (id === s3.id) return Promise.reject(refusal(409, { ok: false, error: SWAP_REFUSALS.hibernated }));
    return Promise.resolve(undefined);
  }) as never);

  it('a busy session is skipped without interrupt consent, and sent with it when the box is ticked', async () => {
    const swap = routeLike();
    show(storeWith());
    await startMove();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done: 2 of 4 moved.'));
    expect(wordOf('two')).toBe('skipped: busy');
    // Sent once, without consent, and not again.
    expect(swap.mock.calls.filter((c) => c[0] === s2.id)).toEqual([[s2.id, 'lane-a']]);
    for (const c of swap.mock.calls) expect(c[2]).toBeUndefined();
    cleanup();
    swap.mockClear();

    show(storeWith());
    const box = screen.getByRole('checkbox', { name: /Also interrupt busy ones/ });
    expect(box.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(box);
    expect(box.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText(/the turn in progress and its background tasks are lost/)).toBeInTheDocument();
    await startMove();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done: 3 of 4 moved.'));
    expect(wordOf('two')).toBe('moved');
    // The consent follows the measured busy answer, as SwapSheet's "swap anyway" does; nobody else carries it.
    expect(swap.mock.calls.filter((c) => c[0] === s2.id)).toEqual([[s2.id, 'lane-a'], [s2.id, 'lane-a', { interrupt: true }]]);
    expect(swap.mock.calls.filter((c) => c[0] !== s2.id).every((c) => c[2] === undefined)).toBe(true);
  });

  it('a hibernated session reads refused: asleep, and the move carries on with the next', async () => {
    const swap = routeLike();
    show(storeWith());
    await startMove();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done: 2 of 4 moved.'));
    expect(wordOf('three')).toBe('refused: asleep');
    expect(wordOf('four')).toBe('moved');
    expect(swap.mock.calls.map((c) => c[0])).toEqual([s1.id, s2.id, s3.id, s4.id]);
  });

  it('every refusal names its reason from its code; no response text is rendered', async () => {
    const answers: Record<string, ApiError> = {
      [s1.id]: refusal(409, { ok: false, error: 'pool-mismatch', accountPool: 'p1', projectPool: 'SECRET-POOL-TEXT' }),
      [s2.id]: refusal(409, { ok: false, error: SWAP_REFUSALS.statusUnknown }),
      [s3.id]: refusal(502, { ok: false, stderr: 'ccd: SECRET-STDERR-TEXT' }),
      [s4.id]: refusal(409, { ok: false, error: 'brand-new-code', detail: 'SECRET-DETAIL-TEXT' }),
    };
    vi.spyOn(api, 'swap').mockImplementation(((id: string) => Promise.reject(answers[id])) as never);
    show(storeWith());
    await startMove();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done: 0 of 4 moved.'));
    expect(wordOf('one')).toBe('refused: other pool');
    expect(wordOf('two')).toBe('refused: status unreadable');
    expect(wordOf('three')).toBe('refused: the fleet host could not move it');
    expect(wordOf('four')).toBe('refused: a reason this app does not know');
    expect(document.body.textContent).not.toMatch(/SECRET|brand-new-code|ccd:/);
  });

  it('no answer at all is not a refusal: it may have moved', async () => {
    vi.spyOn(api, 'swap').mockRejectedValue(new TypeError('Failed to fetch'));
    show(storeWith({ sessions: [s1] }));
    await startMove();
    await waitFor(() => expect(wordOf('one')).toBe('no answer: it may have moved'));
    expect(document.body.textContent).not.toMatch(/Failed to fetch/);
  });
});

describe('offline, nothing is sent (spec §12.5)', () => {
  for (const conn of ['down', 'connecting'] as const) {
    it(`opened with the store reading ${conn}, the sheet says so and Move sends nothing`, async () => {
      const spy = vi.spyOn(api, 'swap').mockResolvedValue(undefined as never);
      show(storeWith({ conn }));
      expect(screen.getByText(MOVE_OFFLINE).getAttribute('role')).toBe('status');
      const move = screen.getByRole('button', { name: 'Move 4 sessions' }) as HTMLButtonElement;
      expect(move.disabled).toBe(true);
      fireEvent.click(move);
      await flush();
      expect(spy).not.toHaveBeenCalled();
      expect(wordOf('one')).toBe('');
    });
  }

  it('the link back on, the sentence goes and Move is live again', async () => {
    const store = storeWith({ conn: 'down' });
    show(store);
    act(() => { store.setState({ conn: 'open' }); });
    expect(screen.queryByText(MOVE_OFFLINE)).toBeNull();
    expect((screen.getByRole('button', { name: 'Move 4 sessions' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('the link dropping mid-move stops it: the rest read not sent, and none is sent into the dead link', async () => {
    const { spy, pending } = deferredSwap();
    const store = storeWith();
    show(store);
    await startMove();
    await flush();
    act(() => { store.setState({ conn: 'down' }); });
    await act(async () => { pending[0]!.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped: 1 of 4 moved.'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(['one', 'two', 'three', 'four'].map(wordOf)).toEqual(['moved', 'not sent', 'not sent', 'not sent']);
    expect(screen.getByRole('alert').textContent).toBe(MOVE_LINK_LOST);
  });

  it('a swap with no answer at all stops the move before the next is sent', async () => {
    const spy = vi.spyOn(api, 'swap').mockRejectedValue(new TypeError('Failed to fetch'));
    show(storeWith());
    await startMove();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Stopped: 0 of 4 moved.'));
    expect(spy).toHaveBeenCalledTimes(1);
    expect(['one', 'two', 'three', 'four'].map(wordOf))
      .toEqual(['no answer: it may have moved', 'not sent', 'not sent', 'not sent']);
    expect(screen.getByRole('alert').textContent).toBe(MOVE_LINK_LOST);
  });

  it('a refusal is an answer: the move goes on past it, and says nothing of the link', async () => {
    vi.spyOn(api, 'swap').mockImplementation((id: string) => (id === s3.id
      ? Promise.reject(refusal(409, { ok: false, error: SWAP_REFUSALS.hibernated }))
      : Promise.resolve(undefined)) as never);
    show(storeWith());
    await startMove();
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Done: 3 of 4 moved.'));
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('the trouble card opens it', () => {
  const cardFor = (word: 'signed-out' | 'rate-limited', sessions: FleetSession[]) => {
    const store = storeWith({ sessions });
    const answer = stateWordFor({
      disabled: false, authDead: word === 'signed-out', five: word === 'rate-limited' ? 100 : 10, seven: 20,
      fiveResetAt: null, sevenResetAt: null, now: Date.now(),
    });
    expect(answer.word).toBe(word);
    const copy = troubleCopy({
      id: 'lane-b', answer, entry: ROSTER[1], lane: undefined, usage: USAGE[1]!, sessions: sessions.length, now: Date.now(),
    })!;
    render(<TroubleCard copy={copy} fleet={store} />);
  };

  it('Rate-limited leads with "Move 4 sessions off", and it opens the sheet', async () => {
    cardFor('rate-limited', SESSIONS);
    const move = screen.getByRole('button', { name: 'Move 4 sessions off' });
    // The first fix (spec §4.2): before the switch-off command's lead.
    const lead = screen.getByText(/switch it off on the fleet host/);
    expect(move.compareDocumentPosition(lead) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(move);
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText('Move sessions off lane-b')).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Move 4 sessions' })).toBeInTheDocument();
  });

  it('Signed out offers it after the credential fix; a lane with no sessions offers nothing', () => {
    cardFor('signed-out', [s1]);
    const move = screen.getByRole('button', { name: 'Move 1 session off' });
    const lead = screen.getByText(/check it again/);
    expect(lead.compareDocumentPosition(move) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();
    cardFor('signed-out', [elsewhere]);
    expect(screen.queryByRole('button', { name: /sessions? off/ })).toBeNull();
  });
});
