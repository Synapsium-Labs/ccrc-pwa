// HIBERNATION, THE PWA HALF (D-5242, plan Task 18): a session `ccd hibernate` put to sleep wakes when a screen shows
// it. A mounted SessionScreen calls `api.ensure` once whenever its fleet row reads hibernated (`dead` with
// `hibernatedAt`) while the page is visible: at mount, when the page becomes visible again, and when a frame turns the
// row hibernated in view. One call in flight per screen, re-armed only when the row reads alive or the call fails.
// "Waking…" and a Wake control meanwhile, the composer disabled, and a failure toast whose action is Wake.
//
// The harness is `session-screen-refusals.test.tsx`'s own: the Virtuoso stand-in and the hoisted `api` spies.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { fleetSession as baseSession, hibernatedSession } from './fleetFixture';
import { SessionScreen } from '../src/screens/SessionScreen';
import { ToastHost } from '@ccrc/ui';
import { createSessionStore } from '../src/stores/session';
import { createFleetStore } from '../src/stores/fleet';
import { coordPresence } from '../src/fleet/coordWords';
import { hibernatedSince, hibernatedWords } from '../src/fleet/hibernated';
import { TEST_ROSTER } from './rosterFixture';

vi.mock('react-virtuoso', async () => {
  const React = await import('react');
  return {
    Virtuoso: (props: { totalCount: number; itemContent: (i: number) => ReactNode }) =>
      React.createElement('div', { 'data-testid': 'virtuoso' },
        Array.from({ length: props.totalCount }, (_, i) =>
          React.createElement('div', { key: i }, props.itemContent(i)))),
  };
});

const { ensure, prompt } = vi.hoisted(() => ({
  ensure: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { ...actual.api, ensure, prompt } };
});

// `document.visibilityState` is a getter on Document.prototype; an own accessor on the instance shadows it.
let visibility: DocumentVisibilityState = 'visible';
const setVisibility = (v: DocumentVisibilityState): void => {
  visibility = v;
  act(() => { document.dispatchEvent(new Event('visibilitychange')); });
};

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  for (const spy of [ensure, prompt]) { spy.mockReset(); spy.mockResolvedValue(undefined); }
});
afterEach(() => {
  cleanup();
  Reflect.deleteProperty(document, 'visibilityState');
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ID = 'project-a-quiet-basin';
const AT = Date.now() - 6 * 3_600_000;
const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;
const where = { id: ID, project: 'project-a', workdir: '/w/project-a', wrapper: 'lane-a', home: 'lane-a' } as const;
const asleep = (over: Partial<FleetSession> = {}): FleetSession => hibernatedSession(AT, { ...where, ...over });
const awake = (over: Partial<FleetSession> = {}): FleetSession => baseSession({ ...where, ...over });

/** The stream status is the SESSION socket's fact; the row is the fleet frame's. They are set apart on purpose: the
 *  wake reads the row, and a stream that has not yet said `dead` must not leave the composer typing to no pane. */
const renderScreen = (row: FleetSession, stream: 'idle' | 'dead' | null = null) => {
  const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });
  const fleet = createFleetStore();
  act(() => { fleet.setState({ roster: TEST_ROSTER, conn: 'open', sessions: [row] }); });
  const view = render(<><SessionScreen id={ID} store={store} fleet={fleet} /><ToastHost /></>);
  act(() => { store.setState({ uuid: 'u1', status: stream }); });
  const frame = (next: FleetSession): void => { act(() => { fleet.setState({ sessions: [next] }); }); };
  return { store, fleet, frame, view };
};

describe('the wake trigger (D-5242)', () => {
  it('at mount on a visible page: one ensure, not one per render, and not another on a re-render after a frame', async () => {
    const { frame, store } = renderScreen(asleep(), 'dead');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    expect(ensure).toHaveBeenCalledWith(ID);
    // A new frame for the same sleeping row, and a stream re-render: still one.
    frame(asleep({ name: 'renamed' }));
    act(() => { store.setState({ uuid: 'u2' }); });
    frame(asleep({ statusUpdatedAt: 5 }));
    await Promise.resolve();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('mounted while hidden: none, then one when the page becomes visible', async () => {
    visibility = 'hidden';
    renderScreen(asleep(), 'dead');
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    setVisibility('visible');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
  });

  it('a screen already open when a frame turns its row hibernated, page visible: one ensure', async () => {
    const { frame } = renderScreen(awake({ status: 'idle', bucket: 'idle' }), 'idle');
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    frame(asleep());
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
  });

  it('a second visibilitychange while the call is in flight: no second call', async () => {
    ensure.mockImplementation(() => new Promise(() => {}));
    renderScreen(asleep(), 'dead');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    setVisibility('hidden');
    setVisibility('visible');
    await Promise.resolve();
    expect(ensure).toHaveBeenCalledTimes(1);
    // …and the screen's own Wake cannot send a second one meanwhile.
    expect(screen.getByRole('button', { name: 'Wake' })).toBeDisabled();
  });

  it('a call that succeeded but whose row still sleeps is not re-sent on a return to the page', async () => {
    renderScreen(asleep(), 'dead');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    setVisibility('hidden');
    setVisibility('visible');
    await Promise.resolve();
    expect(ensure).toHaveBeenCalledTimes(1);
  });

  it('after the row reads alive and later hibernates again: one more', async () => {
    const { frame } = renderScreen(asleep(), 'dead');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    frame(awake({ status: 'idle', bucket: 'idle' }));
    frame(asleep({ hibernatedAt: AT + 1 }));
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
  });

  it('never wakes a dead row with no hibernatedAt: a crash is not silently restarted by opening it', async () => {
    renderScreen(awake({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' }), 'dead');
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    expect(screen.queryByText('Waking…')).toBeNull();
    expect(screen.getByRole('button', { name: 'Restart session' })).toBeInTheDocument();
  });

  it('a failed call re-arms: the next return to the page tries once more', async () => {
    ensure.mockRejectedValueOnce(new Error('ccd: no server running'));
    renderScreen(asleep(), 'dead');
    await screen.findByText("Couldn't wake — ccd: no server running");
    setVisibility('hidden');
    setVisibility('visible');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
  });

  it('a failure toast tapped while a later wake is out sends nothing more', async () => {
    ensure.mockRejectedValueOnce(new Error('ccd: no server running')).mockImplementation(() => new Promise(() => {}));
    renderScreen(asleep(), 'dead');
    const t = await screen.findByText("Couldn't wake — ccd: no server running");
    setVisibility('hidden');
    setVisibility('visible');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
    fireEvent.click(within(t.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Wake' }));
    await Promise.resolve();
    expect(ensure).toHaveBeenCalledTimes(2);
  });

  it('never wakes under a substrate fault (D-5430): nobody can measure that pane, and Wake is disabled', async () => {
    renderScreen(asleep({ substrate: { at: 1, text: 'tmux unreachable' } }), 'dead');
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Wake' })).toBeDisabled();
  });

  it('never wakes a live row whose hibernatedAt is stale (the frame that woke it)', async () => {
    renderScreen(awake({ status: 'idle', bucket: 'idle', hibernatedAt: AT }), 'idle');
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    expect(screen.queryByText('Waking…')).toBeNull();
  });
});

describe('the sleeping screen (D-5242)', () => {
  it('reads "Waking…" until the row is alive, never "Not running"', async () => {
    const { frame } = renderScreen(asleep(), 'dead');
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Waking…')).toBeInTheDocument();
    expect(screen.queryByText(/Not running/)).toBeNull();
    frame(awake({ status: 'idle', bucket: 'idle' }));
    expect(screen.queryByText('Waking…')).toBeNull();
  });

  it('the Wake control calls ensure (a hidden mount sent nothing on its own)', async () => {
    visibility = 'hidden';
    renderScreen(asleep(), 'dead');
    await Promise.resolve();
    expect(ensure).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Wake' }));
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(1));
  });

  it('a failed wake says so in a toast whose action is Wake, and re-arms', async () => {
    ensure.mockRejectedValueOnce(new Error('ccd: no server running'));
    renderScreen(asleep(), 'dead');
    const t = await screen.findByText("Couldn't wake — ccd: no server running");
    const alert = t.closest('[role="alert"]');
    expect(alert, 'a failure is an alert').not.toBeNull();
    const again = within(alert as HTMLElement).getByRole('button', { name: 'Wake' });
    fireEvent.click(again);
    await waitFor(() => expect(ensure).toHaveBeenCalledTimes(2));
  });

  it('the composer is disabled while the row is hibernated, even before the stream says dead', () => {
    const { view } = renderScreen(asleep(), 'idle');
    const box = view.container.querySelector('textarea');
    expect(box).not.toBeNull();
    expect(box!.disabled).toBe(true);
    expect(box!.placeholder).toMatch(/asleep/i);
  });
});

describe('the word for a sleeping row (D-5242)', () => {
  it('hibernatedSince answers only a dead row with hibernatedAt', () => {
    expect(hibernatedSince({ status: 'dead', hibernatedAt: AT })).toBe(AT);
    expect(hibernatedSince({ status: 'dead', hibernatedAt: null })).toBeNull();
    expect(hibernatedSince({ status: 'idle', hibernatedAt: AT })).toBeNull();
    // An older server omits the key: the live frame is cast, not revived.
    expect(hibernatedSince({ status: 'dead' } as never)).toBeNull();
  });

  it('hibernatedWords reads `hibernated · 6h`', () => {
    expect(hibernatedWords(AT, AT + 6 * 3_600_000)).toBe('hibernated · 6h');
  });

  it('a hibernated coordinator is not a dead one: no Resume door, no "coordinator gone"', () => {
    expect(coordPresence('project-a-quiet-basin', asleep(), true)).toBe('hibernated');
    expect(coordPresence('project-a-quiet-basin', awake({ status: 'dead', bucket: 'dead', lifecycle: 'orphan' }), true))
      .toBe('dead');
  });
});

