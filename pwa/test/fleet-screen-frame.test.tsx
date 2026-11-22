// Session helpers HF2 (D-8877; review 2988 F7): the fleet screen selects the Archived row's unowned COUNT from the store, a
// plain number, not the whole delegation frame, so a frame that leaves the count as it was re-renders nothing of the screen
// (`sessionWorktrees.ts` selects a plain-value key for the same reason). The shared project cards read the frame themselves
// for their own reasons, so they are stubbed here: what is counted is the screen's own commits.
//
// RED FIRST: at `main` the screen selected `s.delegation` and computed the count on every render, so every frame committed.
import { Profiler } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, screen } from '@testing-library/react';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { FleetScreen } from '../src/screens/FleetScreen';
import { renderFleet } from './fleetHost';
import { fleetSession } from './fleetFixture';
import { activity, frame, unowned } from './delegationFixture';

vi.mock('../src/fleet/FleetCards', () => ({ FleetCards: () => null }));

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
  vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

describe('the fleet screen and the delegation frame (HF2, review 2988 F7)', () => {
  it('a frame that leaves the unowned count as it was re-renders nothing of the screen; one that changes it does', () => {
    const store = makeStore();
    let commits = 0;
    renderFleet(<Profiler id="fleet" onRender={() => { commits += 1; }}><FleetScreen store={store} /></Profiler>, store);
    const listed = fleetSession({ id: 'a', project: 'alpha', workspace: null });
    act(() => store.setState({ conn: 'open', sessions: [listed], delegation: frame({ unowned: [unowned({ adminRecord: 'agent-u1' })] }) }));
    // The mount is real: the row says the count.
    expect(screen.getByRole('button', { name: /^work no session owns · 1$/i })).toBeInTheDocument();
    const before = commits;
    expect(before).toBeGreaterThan(0);
    // A new frame object, a recorded entry of the listed session added: the count is still 1.
    act(() => store.setState({ delegation: frame({
      unowned: [unowned({ adminRecord: 'agent-u1' })], activities: [activity({ activityId: 'e1', parentId: 'a' })],
    }) }));
    expect(commits, 'the same count: no commit').toBe(before);
    // The control: a frame that changes the count re-renders the row.
    act(() => store.setState({ delegation: frame({ unowned: [unowned({ adminRecord: 'agent-u1' }), unowned({ adminRecord: 'agent-u2' })] }) }));
    expect(commits).toBeGreaterThan(before);
    expect(screen.getByRole('button', { name: /^work no session owns · 2$/i })).toBeInTheDocument();
  });
});
