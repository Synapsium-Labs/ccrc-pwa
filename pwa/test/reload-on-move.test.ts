// Console speed, Task C3 (spec 2026-11-04 §2.5, D15): the reload gate's acts. `swupdate.ts` holds the pending
// reload and acts on the gate's answer; `navigate` asks it before it pushes. A release's reload runs at the next move
// between screens once the page has been visible for 15 s, as a full page load of the new path, so the old build never
// draws the new screen first; back and forward reload in place. It reloads once per page (the latch), never on a failed
// lazy chunk, and never while a send is unresolved. Fake acts with their own clock, the gate started per case and
// stopped after it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '../src/lib/router';
import {
  noteActivated, reloadOnMove, requestUpdate, resetReloadGateForTests, setBlockProbe, setReloadHold, startReloadGate,
  type ReloadActs,
} from '../src/lib/swupdate';

const T0 = 1_000_000;
let now = T0;
let vis: DocumentVisibilityState = 'visible';
let hasFocus = true;
let acts: { reload: ReturnType<typeof vi.fn>; go: ReturnType<typeof vi.fn>; now: () => number };
let stop: (() => void) | null = null;
let heard = 0;
const onPop = (): void => { heard += 1; };

/** The page turns hidden or visible, through the one `visibilitychange` the page clock listens to. */
function setVisibility(v: DocumentVisibilityState): void {
  vis = v;
  document.dispatchEvent(new Event('visibilitychange'));
}

function start(): void {
  stop = startReloadGate(acts as ReloadActs);
}

beforeEach(() => {
  now = T0;
  vis = 'visible';
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => vis);
  hasFocus = true;
  vi.spyOn(document, 'hasFocus').mockImplementation(() => hasFocus);
  acts = { reload: vi.fn(), go: vi.fn(), now: () => now };
  history.replaceState(null, '', '/');
  heard = 0;
  addEventListener('popstate', onPop);
});

afterEach(() => {
  removeEventListener('popstate', onPop);
  stop?.();
  stop = null;
  resetReloadGateForTests();
  vi.restoreAllMocks();
  history.replaceState(null, '', '/');
});

describe('navigate asks the reload gate before it pushes (Task C3)', () => {
  it('navigate with nothing pending pushes as today and calls no act', () => {
    start();
    now = T0 + 60_000;
    navigate('/runs');
    expect(location.pathname).toBe('/runs');
    expect(heard).toBe(1);
    expect(acts.go).not.toHaveBeenCalled();
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('after an activation, navigate in the first 15 s back pushes as today', () => {
    start();
    noteActivated();
    now = T0 + 14_999;
    navigate('/runs');
    expect(location.pathname).toBe('/runs');
    expect(heard).toBe(1);
    expect(acts.go).not.toHaveBeenCalled();
    expect(acts.reload, 'the activation alone never reloads').not.toHaveBeenCalled();
  });

  it('after 15 s back, navigate to another screen calls go once and pushes nothing', () => {
    start();
    noteActivated();
    now = T0 + 15_000;
    const length = history.length;
    navigate('/runs?x=1');
    expect(acts.go).toHaveBeenCalledTimes(1);
    expect(acts.go).toHaveBeenCalledWith('/runs?x=1', false);
    expect(location.pathname).toBe('/');
    expect(history.length).toBe(length);
    expect(heard, 'no popstate: the old build never draws the new screen').toBe(0);
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('navigate with replace calls go(href, true)', () => {
    start();
    noteActivated();
    now = T0 + 15_000;
    navigate('/s/sess-a', { replace: true });
    expect(acts.go).toHaveBeenCalledTimes(1);
    expect(acts.go).toHaveBeenCalledWith('/s/sess-a', true);
  });

  it('a Docs page turn after 15 s back pushes as today', () => {
    history.replaceState(null, '', '/docs/a');
    start();
    noteActivated();
    now = T0 + 60_000;
    navigate('/docs/b');
    navigate('/docs/b?ref=x');
    expect(location.pathname).toBe('/docs/b');
    expect(heard).toBe(2);
    expect(acts.go).not.toHaveBeenCalled();
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('a search-only change on Accounts after 15 s back pushes as today', () => {
    history.replaceState(null, '', '/accounts');
    start();
    noteActivated();
    now = T0 + 60_000;
    navigate('/accounts?lane=lane-a');
    expect(acts.go).not.toHaveBeenCalled();
    expect(location.pathname).toBe('/accounts');
    expect(heard).toBe(1);
  });

  it('back after 15 s calls reload once', () => {
    start();
    noteActivated();
    now = T0 + 1_000;
    navigate('/runs');                          // inside the window: pushed
    expect(location.pathname).toBe('/runs');
    now = T0 + 20_000;
    history.replaceState(null, '', '/');        // the browser's back: the path moves, then popstate
    dispatchEvent(new PopStateEvent('popstate'));
    expect(acts.reload).toHaveBeenCalledTimes(1);
    expect(acts.go).not.toHaveBeenCalled();
  });

  it('back inside the window holds', () => {
    start();
    noteActivated();
    now = T0 + 1_000;
    navigate('/runs');
    now = T0 + 2_000;
    history.replaceState(null, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(acts.reload).not.toHaveBeenCalled();
    expect(acts.go).not.toHaveBeenCalled();
  });

  it('back to the same screen after 15 s holds (a Docs page turn)', () => {
    history.replaceState(null, '', '/docs/a');
    start();
    noteActivated();
    now = T0 + 30_000;
    history.replaceState(null, '', '/docs/b');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('a page loaded visible counts its load as the return', () => {
    start();
    noteActivated();
    now = T0 + 15_000;
    navigate('/runs');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });

  it('a page loaded hidden holds until it has been visible for 15 s', () => {
    vis = 'hidden';
    start();
    noteActivated();
    now = T0 + 600_000;
    navigate('/runs');
    expect(acts.go, 'never seen visible: holds').not.toHaveBeenCalled();
    setVisibility('visible');
    now = T0 + 614_999;
    navigate('/accounts');
    expect(acts.go).not.toHaveBeenCalled();
    now = T0 + 615_000;
    navigate('/waiting');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });

  it('a return restarts the 15 s', () => {
    start();
    noteActivated();
    setVisibility('hidden');
    const t = T0 + 120_000;
    now = t;
    navigate('/runs');
    expect(acts.go, 'hidden, two minutes after the load: holds').not.toHaveBeenCalled();
    setVisibility('visible');
    now = t + 5_000;
    navigate('/accounts');
    expect(acts.go, 'five seconds back: holds').not.toHaveBeenCalled();
    expect(location.pathname).toBe('/accounts');
    now = t + 15_000;
    navigate('/waiting');
    expect(acts.go).toHaveBeenCalledTimes(1);
    expect(acts.go).toHaveBeenCalledWith('/waiting', false);
  });

  it('a hidden page never reloads', () => {
    start();
    noteActivated();
    now = T0 + 60_000;
    setVisibility('hidden');
    expect(reloadOnMove('/runs', false)).toBe(false);
    requestUpdate();
    expect(acts.go).not.toHaveBeenCalled();
    expect(acts.reload).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(acts.reload, 'the block screen reloads on the return').toHaveBeenCalledTimes(1);
  });
});

describe('once per page, and never over an unsent message (Task C3, fix round 1)', () => {
  it('after one reload the gate answers no: the next navigate pushes in-page and back reloads nothing', () => {
    start();
    noteActivated();
    now = T0 + 15_000;
    navigate('/runs');
    expect(acts.go).toHaveBeenCalledTimes(1);
    now = T0 + 16_000;
    navigate('/accounts');
    expect(acts.go, 'latched').toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/accounts');
    history.replaceState(null, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
    requestUpdate();
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('a failed lazy chunk never reloads: the event is left alone, pending or not, and the release waits for a move', () => {
    start();
    now = T0 + 60_000;
    const idle = new Event('vite:preloadError', { cancelable: true });
    dispatchEvent(idle);
    expect(idle.defaultPrevented).toBe(false);
    noteActivated();
    const failed = new Event('vite:preloadError', { cancelable: true });
    dispatchEvent(failed);
    expect(failed.defaultPrevented, 'the helper rethrows the real error to the screen').toBe(false);
    expect(acts.reload).not.toHaveBeenCalled();
    navigate('/runs');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });

  it('a send in flight or failed holds the move, after any wait; resolved, the next move reloads', () => {
    let unresolved = true;
    setReloadHold(() => unresolved);
    start();
    noteActivated();
    now = T0 + 600_000;
    navigate('/runs');
    expect(acts.go, 'held').not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');
    history.replaceState(null, '', '/');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(acts.reload, 'back is held too').not.toHaveBeenCalled();
    unresolved = false;
    navigate('/accounts');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });

  it('a block that lifts clears urgent: the next release waits for a move', () => {
    let blocked = false;
    setBlockProbe(() => blocked);
    start();
    requestUpdate();                     // the fleet store asks on the rising edge, then sets blocked
    blocked = true;
    dispatchEvent(new Event('blur'));    // a step while the block stands: urgent holds
    blocked = false;                     // a later compatible hello lowers it
    noteActivated();
    expect(acts.reload, 'no longer urgent').not.toHaveBeenCalled();
    now = T0 + 5_000;
    navigate('/runs');
    expect(acts.go, 'inside the window').not.toHaveBeenCalled();
    now = T0 + 15_000;
    navigate('/accounts');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });

  it('a block that stands keeps urgent: the release reloads as soon as the new worker is in', () => {
    let blocked = false;
    setBlockProbe(() => blocked);
    start();
    requestUpdate();
    blocked = true;
    noteActivated();
    expect(acts.reload).toHaveBeenCalledTimes(1);
  });

  it('a page restored from the back-forward cache is back: the latch clears, the window restarts, the reload stays pending', () => {
    start();
    noteActivated();
    now = T0 + 15_000;
    navigate('/runs');
    expect(acts.go, 'the move reload').toHaveBeenCalledTimes(1);
    now = T0 + 600_000;
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    now = T0 + 605_000;
    navigate('/accounts');
    expect(acts.go, 'five seconds after the restore: holds').toHaveBeenCalledTimes(1);
    now = T0 + 615_000;
    navigate('/waiting');
    expect(acts.go).toHaveBeenCalledTimes(2);
    expect(acts.go).toHaveBeenLastCalledWith('/waiting', false);
    now = T0 + 700_000;
    navigate('/runs');
    expect(acts.go, 'latched again').toHaveBeenCalledTimes(2);
  });

  it('a pageshow that is not a restore changes nothing', () => {
    start();
    noteActivated();
    now = T0 + 15_000;
    navigate('/runs');
    now = T0 + 600_000;
    dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    navigate('/accounts');
    expect(acts.go, 'still latched').toHaveBeenCalledTimes(1);
  });

  it('focus regained after the window was away for at least 15 s restarts the window', () => {
    start();
    noteActivated();
    now = T0 + 60_000;
    hasFocus = false;
    dispatchEvent(new Event('blur'));
    now = T0 + 120_000;
    hasFocus = true;
    dispatchEvent(new Event('focus'));
    now = T0 + 125_000;
    navigate('/runs');
    expect(acts.go, 'five seconds after the focus').not.toHaveBeenCalled();
    now = T0 + 135_000;
    navigate('/accounts');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });

  it('a page loaded without focus counts its first focus as back', () => {
    hasFocus = false;
    start();
    noteActivated();
    now = T0 + 60_000;
    hasFocus = true;
    dispatchEvent(new Event('focus'));
    now = T0 + 65_000;
    navigate('/runs');
    expect(acts.go).not.toHaveBeenCalled();
    now = T0 + 75_000;
    navigate('/accounts');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });
});

describe('the block screen reloads at once (Task C3)', () => {
  it('an incompatible hello reloads as soon as the new worker is in', () => {
    start();
    requestUpdate();
    expect(acts.reload, 'no new worker yet').not.toHaveBeenCalled();
    noteActivated();
    expect(acts.reload).toHaveBeenCalledTimes(1);
  });

  it('requestUpdate after an activation reloads at once', () => {
    start();
    noteActivated();
    requestUpdate();
    expect(acts.reload).toHaveBeenCalledTimes(1);
  });

  it('requestUpdate still asks the updater for a check', async () => {
    const { setUpdater } = await import('../src/lib/swupdate');
    const check = vi.fn();
    setUpdater(check);
    start();
    requestUpdate();
    expect(check).toHaveBeenCalledTimes(1);
  });

});

describe('the gate starts once and stops whole (Task C3)', () => {
  it('reloadOnMove answers false with the gate not started', () => {
    noteActivated();
    now = T0 + 60_000;
    expect(reloadOnMove('/runs', false)).toBe(false);
  });

  it('starting twice is starting once', () => {
    const add = vi.spyOn(window, 'addEventListener');
    start();
    const again = startReloadGate(acts as ReloadActs);
    expect(again).toBe(stop);
    expect(add.mock.calls.filter((c) => c[0] === 'popstate')).toHaveLength(1);
    expect(add.mock.calls.filter((c) => c[0] === 'vite:preloadError'), 'no chunk arm').toHaveLength(0);
  });

  it('stop removes the popstate listener and the page-clock subscriptions', () => {
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    start();
    expect(docAdd.mock.calls.filter((c) => c[0] === 'visibilitychange')).toHaveLength(1);
    stop?.();
    stop = null;
    for (const kind of ['popstate', 'focus', 'blur', 'pageshow']) {
      const added = winAdd.mock.calls.find((c) => c[0] === kind);
      expect(added, kind).toBeDefined();
      expect(winRemove.mock.calls.some((c) => c[0] === kind && c[1] === added?.[1]), kind).toBe(true);
    }
    expect(docRemove.mock.calls.filter((c) => c[0] === 'visibilitychange'), 'the page clock holds no listener').toHaveLength(1);
    noteActivated();
    now = T0 + 60_000;
    history.replaceState(null, '', '/runs');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('a stopped gate never reloads, on navigate either', () => {
    start();
    noteActivated();
    stop?.();
    stop = null;
    now = T0 + 60_000;
    expect(reloadOnMove('/runs', false)).toBe(false);
    navigate('/accounts');
    expect(acts.go).not.toHaveBeenCalled();
    expect(acts.reload).not.toHaveBeenCalled();
  });

  it('the default clock is monotonic: a forward wall-clock step inside the window holds', () => {
    let wall = 1_800_000_000_000;
    let mono = 50_000;
    vi.spyOn(Date, 'now').mockImplementation(() => wall);
    vi.spyOn(performance, 'now').mockImplementation(() => mono);
    const { reload, go } = acts as ReloadActs;
    stop = startReloadGate({ reload, go });
    noteActivated();
    wall += 60_000;                      // a network-time correction lands
    mono += 5_000;
    navigate('/runs');
    expect(acts.go, 'five seconds back on the monotonic clock').not.toHaveBeenCalled();
    mono += 10_000;
    navigate('/accounts');
    expect(acts.go).toHaveBeenCalledTimes(1);
  });
});
