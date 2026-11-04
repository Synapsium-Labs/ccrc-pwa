// Console speed, Task C3 (spec 2026-11-04 §2.5, D15): the reload gate's acts. `swupdate.ts` holds the pending
// reload and acts on the gate's answer; `navigate` asks it before it pushes. A release's reload runs at the next move
// between screens once the page has been visible for 15 s, as a full page load of the new path, so the old build never
// draws the new screen first; back and forward reload in place. Fake acts with their own clock, the gate started per
// case and stopped after it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { navigate } from '../src/lib/router';
import {
  noteActivated, reloadOnMove, requestUpdate, resetReloadGateForTests, startReloadGate, type ReloadActs,
} from '../src/lib/swupdate';

const T0 = 1_000_000;
let now = T0;
let vis: DocumentVisibilityState = 'visible';
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
    setVisibility('visible');
    now = t + 5_000;
    navigate('/runs');
    expect(acts.go, 'five seconds back: holds').not.toHaveBeenCalled();
    expect(location.pathname).toBe('/runs');
    now = t + 15_000;
    navigate('/accounts');
    expect(acts.go).toHaveBeenCalledTimes(1);
    expect(acts.go).toHaveBeenCalledWith('/accounts', false);
  });

  it('a hidden page never reloads', () => {
    start();
    noteActivated();
    now = T0 + 60_000;
    setVisibility('hidden');
    expect(reloadOnMove('/runs', false)).toBe(false);
    requestUpdate();
    const ev = new Event('vite:preloadError', { cancelable: true });
    dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(acts.go).not.toHaveBeenCalled();
    expect(acts.reload).not.toHaveBeenCalled();
    setVisibility('visible');
    expect(acts.reload, 'the block screen reloads on the return').toHaveBeenCalledTimes(1);
  });
});

describe('the two cases that reload at once (Task C3)', () => {
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

  it('vite:preloadError while pending reloads and prevents the default; with nothing pending it is left alone', () => {
    start();
    const idle = new Event('vite:preloadError', { cancelable: true });
    dispatchEvent(idle);
    expect(idle.defaultPrevented, 'nothing pending: the boundary draws its fallback').toBe(false);
    expect(acts.reload).not.toHaveBeenCalled();
    noteActivated();
    const failed = new Event('vite:preloadError', { cancelable: true });
    dispatchEvent(failed);
    expect(failed.defaultPrevented).toBe(true);
    expect(acts.reload).toHaveBeenCalledTimes(1);
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
    expect(add.mock.calls.filter((c) => c[0] === 'vite:preloadError')).toHaveLength(1);
  });

  it('stop removes the popstate and preloadError listeners and the page-clock subscriptions', () => {
    const winAdd = vi.spyOn(window, 'addEventListener');
    const winRemove = vi.spyOn(window, 'removeEventListener');
    const docAdd = vi.spyOn(document, 'addEventListener');
    const docRemove = vi.spyOn(document, 'removeEventListener');
    start();
    expect(docAdd.mock.calls.filter((c) => c[0] === 'visibilitychange')).toHaveLength(1);
    stop?.();
    stop = null;
    for (const kind of ['popstate', 'vite:preloadError']) {
      const added = winAdd.mock.calls.find((c) => c[0] === kind);
      expect(added, kind).toBeDefined();
      expect(winRemove.mock.calls.some((c) => c[0] === kind && c[1] === added?.[1]), kind).toBe(true);
    }
    expect(docRemove.mock.calls.filter((c) => c[0] === 'visibilitychange'), 'the page clock holds no listener').toHaveLength(1);
    noteActivated();
    now = T0 + 60_000;
    const ev = new Event('vite:preloadError', { cancelable: true });
    dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    history.replaceState(null, '', '/runs');
    dispatchEvent(new PopStateEvent('popstate'));
    expect(acts.reload).not.toHaveBeenCalled();
  });
});
