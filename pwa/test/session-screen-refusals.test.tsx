// THE THREE REFUSALS THE SESSION SCREEN CAN SPEAK, and none of them had a
// test — measured: `SessionScreen.tsx` was the largest remaining coverage gap
// in the package (27 uncovered statements at 83.63%), and every one of them is
// an error arm. A refusal nobody has asked is a sentence nobody has read.
//
// The harness is `session-pickers.test.tsx`'s own, down to the Virtuoso
// stand-in jsdom needs and the `vi.hoisted` spies its factory closes over.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { fleetSession as baseSession } from './fleetFixture';
import { SessionScreen } from '../src/screens/SessionScreen';
import { ToastHost } from '@ccrc/ui';
import { createSessionStore } from '../src/stores/session';
import * as apiModule from '../src/lib/api';
import { ApiError } from '../src/lib/api';
import { createFleetStore } from '../src/stores/fleet';
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

const { ensure, route, restore, prompt } = vi.hoisted(() => ({
  ensure: vi.fn().mockResolvedValue(undefined),
  route: vi.fn().mockResolvedValue(undefined),
  restore: vi.fn().mockResolvedValue(undefined),
  prompt: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/lib/api', async () => {
  const actual = await vi.importActual<typeof import('../src/lib/api')>('../src/lib/api');
  return { ...actual, api: { ...actual.api, ensure, route, restore, prompt } };
});

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  for (const spy of [ensure, route, restore, prompt]) { spy.mockClear(); spy.mockResolvedValue(undefined); }
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const ID = 'claude:OpenClawHetzner';
const fakeSocket = (): WebSocket =>
  ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket;

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => (baseSession({ id: ID, project: 'OpenClawHetzner', workdir: '/root/projects/OpenClawHetzner', model: 'Sonnet 5', effort: 'medium', ...patch }));

/** The last render's stores, so a case can drive the session's own status —
 *  the Stop control is gated on `busy`, which is the session stream's fact,
 *  not the fleet frame's. */
const stores: { store: ReturnType<typeof createSessionStore> } = { store: null as never };

const renderScreen = (patch: Partial<FleetSession> = {}, status: 'idle' | 'dead' = 'idle') => {
  const store = createSessionStore(ID, { makeSocket: fakeSocket, api: { prompt } });
  stores.store = store;
  const fleet = createFleetStore();
  act(() => { fleet.setState({ roster: TEST_ROSTER, conn: 'open', sessions: [fleetSession(patch)] }); });
  render(<><SessionScreen id={ID} store={store} fleet={fleet} /><ToastHost /></>);
  act(() => { store.setState({ uuid: 'u1', status }); });
  return { store, fleet };
};

describe('Restart session — the one control a dead row offers', () => {
  it('says why it could not restart, as an alert, and re-arms the button', async () => {
    // `finally { setRestarting(false) }` is the half that matters: a refusal
    // that left the button saying "Restarting…" for ever would make a
    // recoverable failure look terminal.
    ensure.mockRejectedValue(new Error('tmux: no server running'));
    renderScreen({ status: 'dead', bucket: 'dead' }, 'dead');
    const btn = await screen.findByRole('button', { name: 'Restart session' });
    fireEvent.click(btn);
    const t = await screen.findByText("Couldn't restart — tmux: no server running");
    expect(t.closest('[role="alert"]'), 'a refusal is an alert, not a status').not.toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart session' })).not.toBeDisabled());
  });

  it('stringifies a thrown non-Error rather than printing [object Object]', async () => {
    // The `String(err)` arm. ccd's own failures arrive as Errors; a rejected
    // fetch in a stale browser does not.
    ensure.mockRejectedValue('offline');
    renderScreen({ status: 'dead', bucket: 'dead' }, 'dead');
    fireEvent.click(await screen.findByRole('button', { name: 'Restart session' }));
    expect(await screen.findByText("Couldn't restart — offline")).toBeInTheDocument();
  });

  it('refuses a second tap while the first is still in flight', async () => {
    // `if (restarting) return;` — two `/ensure` posts for one row is a race
    // between two spawns, and the second would report a failure that is not
    // one.
    let release!: () => void;
    ensure.mockReturnValue(new Promise<void>((res) => { release = () => res(); }));
    renderScreen({ status: 'dead', bucket: 'dead' }, 'dead');
    const btn = await screen.findByRole('button', { name: 'Restart session' });
    fireEvent.click(btn);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restarting…' })).toBeDisabled());
    fireEvent.click(screen.getByRole('button', { name: 'Restarting…' }));
    expect(ensure).toHaveBeenCalledTimes(1);
    release();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Restart session' })).not.toBeDisabled());
  });
});

describe('a routing write that fails', () => {
  it("says it could not apply, and drops the queued badge it had just armed", async () => {
    // BOTH halves, and the second is the one a reader would notice: the badge
    // promises "the pane has not confirmed it yet", which is a lie once the
    // write itself has been refused. `useQueuedRoute`'s `clear()` in the catch
    // is what retires it.
    route.mockRejectedValue(new Error('ccd: route refused'));
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByRole('button', { name: /Change effort/ }));
    fireEvent.click(await screen.findByRole('button', { name: /High/ }));
    expect(await screen.findByText(/Couldn't apply that/)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('queued')).toBeNull());
  });
});

describe('Restore, on a session already put away', () => {
  it('says why it could not restore', async () => {
    // A main checkout's Restore reaches `/ensure` (`restoreReachesEnsure`),
    // which is the same request Restart makes — so this arm is about the
    // SENTENCE, which is its own ("restore", not "restart").
    ensure.mockRejectedValue(new Error('registry row is gone'));
    renderScreen({ archivedAt: 1785300000, bucket: 'archived' });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: /Restore/ }));
    expect(await screen.findByText(/Couldn't restore — registry row is gone/)).toBeInTheDocument();
  });
});

describe('Stop — two sentences, because 409 is not a failure', () => {
  it('a 409 says there was nothing to stop, and says it QUIETLY', async () => {
    // `/interrupt` answers 409 when the pane is idle, which is not an error:
    // the reader asked for a stop and got one, in the sense that nothing is
    // running. A red toast there would teach them to distrust the button.
    const interrupt = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'not-busy' }));
    vi.spyOn(apiModule.api, 'interrupt').mockImplementation(interrupt);
    renderScreen();
    act(() => { stores.store.setState({ status: 'busy' }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const said = await screen.findByText(/nothing to stop/);
    expect(said.closest('[role="status"]'), 'an idle pane is a status, not an alert').not.toBeNull();
  });

  it('anything else IS a failure, and names what ccd said', async () => {
    vi.spyOn(apiModule.api, 'interrupt')
      .mockRejectedValue(new Error('tmux: no server running'));
    renderScreen();
    act(() => { stores.store.setState({ status: 'busy' }); });
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    const said = await screen.findByText("Couldn't stop — tmux: no server running");
    expect(said.closest('[role="alert"]')).not.toBeNull();
  });
});

describe('the screen\'s own wiring — each prop is the store\'s act, not a copy of it', () => {
  it('Back leaves for the fleet, which is the only way out of a session on a phone', () => {
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: /back/i }));
    expect(window.location.pathname).toBe('/');
  });

  it('Retry on a failed send calls the STORE\'s retry, with that send\'s own key', async () => {
    // `useStore.getState().retry(key)` — the screen holds no retry of its
    // own, because a second implementation would have to re-derive which call
    // to repeat (`PendingSend` remembers it, deliberately).
    renderScreen();
    const retry = vi.spyOn(stores.store.getState(), 'retry');
    act(() => {
      stores.store.setState({
        pending: [{ key: 'p1', text: 'hello', state: 'failed', error: 'tmux: no server running' }],
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledWith('p1');
  });

  it('Discard calls the store\'s discard, with the same key', async () => {
    renderScreen();
    const discard = vi.spyOn(stores.store.getState(), 'discard');
    act(() => {
      stores.store.setState({
        pending: [{ key: 'p2', text: 'hello', state: 'failed', error: 'refused' }],
      });
    });
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }));
    expect(discard).toHaveBeenCalledWith('p2');
  });

  it('publishes the composer height on :root, where the toast host can read it', () => {
    // NOT on `.chat`: `ToastHost` is not inside this subtree and custom
    // properties only inherit downward, which is the whole reason this
    // observer exists. jsdom's `ResizeObserver` stub never fires, so this
    // installs one that does — the only way the callback is reachable at all.
    const observers: (() => void)[] = [];
    // A plain field, not a parameter property: this tsconfig sets
    // `erasableSyntaxOnly`, which refuses the shorthand outright.
    vi.stubGlobal('ResizeObserver', class {
      cb: ResizeObserverCallback;
      constructor(cb: ResizeObserverCallback) {
        this.cb = cb;
        observers.push(() => this.cb(
          [{ contentRect: { height: 84.4 } } as ResizeObserverEntry], this as never));
      }
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    });
    const { unmount } = (() => {
      const r = renderScreen();
      return { ...r, unmount: () => cleanup() };
    })();
    expect(observers.length, 'the composer is observed').toBeGreaterThan(0);
    act(() => { for (const fire of observers) fire(); });
    expect(document.documentElement.style.getPropertyValue('--composer-h'),
      'rounded, because a fractional pixel in a custom property is noise').toBe('84px');
    unmount();
    expect(document.documentElement.style.getPropertyValue('--composer-h'),
      'cleared on unmount, so the fleet screen keeps the plain offset').toBe('');
  });
});

// EVERY DOOR THIS SCREEN OPENS, IT CAN ALSO CLOSE.
//
// Six sheets hang off `SessionScreen`, each with its own `open` flag and its
// own `onClose`, and the suite opened none of them: the six close callbacks
// were uncovered functions (measured: 521, 551, 569, 592, 597, 598 and
// `openTerminal` at 331, with this file 11/11 green). A sheet whose `onClose`
// does not clear its flag cannot be dismissed at all — the scrim fades, vaul
// unmounts the content, and the next render puts it straight back up, which
// is the one failure a reader cannot work around.
describe('the screen’s six sheets each close the flag that opened them', () => {
  const openMenu = (): void => {
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
  };
  /** vaul's dismissal is not always synchronous with the click, so the
   *  assertion waits for the content to actually go (the same jsdom/vaul
   *  timing note `abandon-sheet.test.tsx` carries). */
  const dismiss = async (): Promise<void> => {
    const scrims = screen.getAllByTestId('sheet-overlay');
    fireEvent.click(scrims[scrims.length - 1]!);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-overlay').length)
      .toBeLessThan(scrims.length));
  };

  it('the model picker opens from the menu and closes on the scrim', async () => {
    renderScreen();
    openMenu();
    fireEvent.click(await screen.findByText('Change model'));
    expect(await screen.findByText('Choose a model')).toBeInTheDocument();
    await dismiss();
    await waitFor(() => expect(screen.queryByText('Choose a model')).toBeNull());
  });

  it('the effort picker is a SECOND sheet on the same flag, and closes the same way', async () => {
    // One `picker` state, two sheets — so a close that cleared only the model
    // arm would leave the effort sheet permanently up.
    renderScreen();
    openMenu();
    fireEvent.click(await screen.findByText('Change effort'));
    expect(await screen.findByText('Reasoning effort')).toBeInTheDocument();
    await dismiss();
    await waitFor(() => expect(screen.queryByText('Reasoning effort')).toBeNull());
  });

  it('the swap sheet opens from the menu and closes', async () => {
    renderScreen();
    openMenu();
    fireEvent.click(await screen.findByText('Move to another account'));
    const swap = await screen.findByText(/another account/i, { selector: '.sheet-title, h2, p' });
    expect(swap).toBeInTheDocument();
    await dismiss();
  });

  it('the archive sheet opens from the menu and closes', async () => {
    renderScreen();
    openMenu();
    fireEvent.click(await screen.findByText('Archive'));
    await waitFor(() => expect(screen.queryByText('Change model')).toBeNull());
    await dismiss();
  });

  it('the history tab opens from the menu and closes', async () => {
    // Its own body, because this sheet FETCHES on open and the suite's
    // blanket `{}` is a shape it refuses (see the case below).
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, events: [], gaps: [] }), { status: 200 })));
    renderScreen();
    openMenu();
    fireEvent.click(await screen.findByText('History'));
    // Its own title, not a scrim count: the menu and the tab are two sheets
    // on one stack, and the menu's dismissal races the tab's mount — so the
    // claim is that the TAB is up, and then that it is gone.
    expect(await screen.findByText('What happened here')).toBeInTheDocument();
    const scrims = screen.getAllByTestId('sheet-overlay');
    fireEvent.click(scrims[scrims.length - 1]!);
    await waitFor(() => expect(screen.queryByText('What happened here')).toBeNull());
  });

  it('the terminal drawer opens from its OWN keycap, not the menu, and closes', async () => {
    // `openTerminal` is passed twice — to the header's keycap and to
    // `DialogSheet`, which raises the terminal when a dialog needs the pane.
    // One function, two call sites, and neither had a case.
    renderScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    await waitFor(() => expect(screen.getAllByTestId('sheet-overlay').length).toBeGreaterThan(0));
    await dismiss();
  });
});

// A FOUND DEFECT, and the fix measured here. `api.lifecycle` is a bare
// `getJson<LifecycleQueryResult>` — a CAST, not a revive — so what reaches
// `HistoryTab` is whatever the box sent. A build whose journal predates
// `gaps`, or a proxy answering `{}` with a 200, arrives without the arrays
// every render branch reads `.length` off, and the throw comes out of a
// `.then` nothing catches: a white screen inside the sheet. (Measured: before
// the guard, the close case above failed with "An error occurred in the
// <HistoryTab> component".)
//
// The answer is the ERROR arm rather than an empty result, because this
// component's own rule — SessionScreen's `searchComplete` rule applied to the
// journal — is that an unmeasured absence is not an empty history: rendering
// "No journal rows for this session" would state a fact nothing measured.
it('a lifecycle body with no arrays is reported, not rendered as an empty journal', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
  renderScreen();
  fireEvent.click(screen.getByRole('button', { name: 'More' }));
  fireEvent.click(await screen.findByText('History'));

  expect(await screen.findByText(/shape this build cannot read/)).toBeInTheDocument();
  expect(screen.queryByText(/No journal rows for this session/),
    'an unmeasured absence was rendered as an empty history').toBeNull();
});

// — the screen before any frame, and the facts it derives from the id alone —
describe('a deep link whose session the fleet has not reported yet', () => {
  /** No fleet row at all: the store is live, the board is not. */
  const deepLink = (id: string) => {
    const store = createSessionStore(id, { makeSocket: fakeSocket, api: { prompt } });
    const fleet = createFleetStore();
    act(() => { fleet.setState({ roster: TEST_ROSTER, conn: 'open', sessions: [] }); });
    render(<><SessionScreen id={id} store={store} fleet={fleet} /><ToastHost /></>);
    act(() => { store.setState({ uuid: 'u1', status: 'idle' }); });
    return { store, fleet };
  };

  it('names the project out of the id, past the account prefix', () => {
    // `live?.project ?? id.slice(wrapperFromId.length + 1)`. The composer's
    // placeholder says "Message <project>", and before the first frame the id
    // is the only thing that knows what that is.
    deepLink('claude:OpenClawHetzner');
    expect(screen.getByPlaceholderText('Message OpenClawHetzner')).toBeInTheDocument();
  });

  it('falls back to the whole id when there is no prefix to strip', () => {
    // A workspace id is `<project>-<slug>` with no colon, so slicing past a
    // prefix that is not there would leave an empty string — and a composer
    // reading "Message " is the shape this `|| id` prevents.
    deepLink('demo-quiet-basin');
    expect(screen.getByPlaceholderText('Message demo-quiet-basin')).toBeInTheDocument();
  });

  it('Restore does nothing without a row to restore', () => {
    // `restoreNow` reads the LIVE row to decide which verb a restore is — a
    // workspace is `ws-restore`, a main checkout is `/ensure`. With no row
    // there is nothing to decide from, so it must not guess.
    //
    // A PROPERTY, not a killer, and measured as such: the header renders no
    // Restore control without a row, so deleting the handler's own guard
    // leaves this green. What it pins is the outcome the two share.
    deepLink('demo-quiet-basin');
    expect(restore).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
  });
});

describe('the keyboard, and the transcript banner with no path', () => {
  it('pads the chat by the keyboard overlap and stamps it for the stylesheet', () => {
    // `data-kb` is what the sheet reads; the padding is what keeps the
    // composer above the keys. Both arms are one condition, and neither had
    // a case.
    const vv = Object.assign(new EventTarget(), { height: window.innerHeight, offsetTop: 0 });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });
    try {
      renderScreen();
      const chat = document.querySelector('.chat');
      if (!(chat instanceof HTMLElement)) throw new Error('no .chat');
      expect(chat.getAttribute('data-kb'), 'a closed keyboard stamps nothing').toBeNull();

      act(() => {
        vv.height = window.innerHeight - 280;
        vv.dispatchEvent(new Event('resize'));
      });
      expect(chat.getAttribute('data-kb')).toBe('true');
      expect(chat.style.paddingBottom).toBe('280px');
    } finally {
      Reflect.deleteProperty(window, 'visualViewport');
    }
  });

  it('a transcript nobody could MEASURE says so, and names no path it does not have', () => {
    // The fourth combination the banner's own comment enumerates: no
    // `missingFile`, `missing: false`, and `fileMeasured: false` — a present
    // transcript whose bytes could not be read. There is no path to print,
    // and printing `undefined` or `null` there is the failure the `?? ''` ends.
    const { store } = renderScreen();
    act(() => {
      store.setState({ missingFile: null, file: null, fileMeasured: false, searchComplete: true });
    });
    expect(screen.getByText("Can't read the fleet host right now")).toBeInTheDocument();
    const path = document.querySelector('.banner-path');
    expect(path?.textContent, 'a path was invented for a transcript nothing measured').toBe('');
  });
});
