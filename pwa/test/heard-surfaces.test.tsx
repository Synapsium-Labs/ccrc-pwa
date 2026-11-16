// What each surface that gates on "heard" shows, in the three states the console can be in (the Overlord face follow-up):
// NOT HEARD YET (the store holds the offline snapshot's rows and runs, and no frame has landed), HEARD (a fleet frame and
// a runs frame have landed, the link is open), and LINK LOST (both frames landed, then the link went down: the flags are
// sticky, so what was heard stays heard). Pinned on `main` before the four surfaces moved onto `useHeard`
// (`fleet/useHeard.ts`), so the move is measured, not assumed. The PR sheet's three states are in `pr-sheet.test.tsx`,
// beside its own fixtures.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { RunSummary } from '../../shared/api';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { useNavBadges } from '../src/fleet/navBadges';
import { StatusBar } from '../src/skins/instrument/StatusBar';
import { PhoneHeader } from '../src/skins/refined/PhoneHeader';
import { createFleetStore, useFleetStore, type FleetStore } from '../src/stores/fleet';
import { fleetSession } from './fleetFixture';
import { itemView, waitingView } from './ledgersFixture';

const ASKING = fleetSession({ id: 'sess-a', bucket: 'attention' });
const CALM = fleetSession({ id: 'sess-b' });
/** Two open runs claimed by the asking session, so the Runs door counts both once a runs frame and a fleet frame landed. */
const RUNS = [1, 2].map((id) => ({ id, program: 'p', state: 'working', closedAt: null, sessionId: null, claimedBy: 'sess-a' }) as unknown as RunSummary);

type Heard = 'not-heard' | 'heard' | 'link-lost';

/** The store slice each state names. The rows and runs are the SAME in all three: only the frame flags and the link move. */
function slice(state: Heard): Partial<ReturnType<FleetStore['getState']>> {
  const rows = { sessions: [ASKING, CALM], runs: RUNS, waiting: waitingView({ items: [itemView({ id: 1 })] }) };
  if (state === 'not-heard') return { ...rows, conn: 'connecting', linkLost: false, fleetFrameSeen: false, runsFrameSeen: false };
  if (state === 'heard') return { ...rows, conn: 'open', linkLost: false, fleetFrameSeen: true, runsFrameSeen: true };
  return { ...rows, conn: 'down', linkLost: true, fleetFrameSeen: true, runsFrameSeen: true };
}

const inert = (): WebSocket => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

/** The singleton's slice before this file touched it, so every case leaves it as it found it. */
const SINGLETON_KEYS = ['sessions', 'runs', 'waiting', 'conn', 'linkLost', 'fleetFrameSeen', 'runsFrameSeen'] as const;
let saved: Partial<ReturnType<FleetStore['getState']>>;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('offline'); }));
  const s = useFleetStore.getState();
  saved = Object.fromEntries(SINGLETON_KEYS.map((k) => [k, s[k]]));
});
afterEach(() => {
  cleanup();
  act(() => useFleetStore.setState(saved));
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useNavBadges, in the three states', () => {
  const badges = (state: Heard): ReturnType<typeof useNavBadges> => {
    const store = createFleetStore({ makeSocket: inert });
    store.setState(slice(state));
    const wrapper = ({ children }: { children?: ReactNode }): ReactNode => <FleetChromeProvider store={store}>{children}</FleetChromeProvider>;
    return renderHook(() => useNavBadges(), { wrapper }).result.current;
  };

  it('not heard yet: every count is null, never the snapshot\'s numbers', () => {
    expect(badges('not-heard')).toEqual({ waiting: null, runsNeedYou: null, waitingItems: null });
  });

  it('heard: each count is the frames\' rows', () => {
    expect(badges('heard')).toEqual({ waiting: 1, runsNeedYou: 2, waitingItems: 2 });
  });

  it('link lost: what was heard stays heard (the flags are sticky)', () => {
    expect(badges('link-lost')).toEqual(badges('heard'));
  });

  it('a fleet frame without a runs frame: the sessions count, the runs count stays null', () => {
    const store = createFleetStore({ makeSocket: inert });
    store.setState({ ...slice('heard'), runsFrameSeen: false });
    const wrapper = ({ children }: { children?: ReactNode }): ReactNode => <FleetChromeProvider store={store}>{children}</FleetChromeProvider>;
    expect(renderHook(() => useNavBadges(), { wrapper }).result.current).toEqual({ waiting: 1, runsNeedYou: null, waitingItems: 2 });
  });
});

describe("Instrument's status bar readout, in the three states", () => {
  // The status bar reads the app's singleton store, as the shell mounts it; the chrome is the same store.
  const readout = (state: Heard): string => {
    act(() => useFleetStore.setState(slice(state)));
    const { container } = render(<FleetChromeProvider store={useFleetStore}><StatusBar /></FleetChromeProvider>);
    return container.querySelector('.ins-status-summary')?.textContent ?? '(no readout)';
  };

  it('not heard yet: the snapshot\'s sessions are counted, its runs are left out', () => {
    expect(readout('not-heard')).toBe('2 sessions · 1 waiting');
  });

  it('heard: the runs part joins', () => {
    expect(readout('heard')).toBe('2 sessions · 1 waiting · 2 runs');
  });

  it('link lost: the same readout as heard', () => {
    expect(readout('link-lost')).toBe('2 sessions · 1 waiting · 2 runs');
  });
});

describe("Refined's phone header readout, in the three states", () => {
  const readout = (state: Heard): string => {
    const store = createFleetStore({ makeSocket: inert });
    store.setState(slice(state));
    const { container } = render(<FleetChromeProvider store={store}><PhoneHeader /></FleetChromeProvider>);
    return container.querySelector('.ref-phone-sub .fleet-count')?.textContent ?? '(no readout)';
  };

  it('not heard yet: the snapshot\'s sessions are counted, its runs are left out', () => {
    expect(readout('not-heard')).toBe('2 sessions · 1 waiting');
  });

  it('heard: the runs part joins', () => {
    expect(readout('heard')).toBe('2 sessions · 1 waiting · 2 runs');
  });

  it('link lost: the same readout as heard', () => {
    expect(readout('link-lost')).toBe('2 sessions · 1 waiting · 2 runs');
  });
});
