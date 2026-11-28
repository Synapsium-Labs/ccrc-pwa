// Reader mode's reading container, its hook and its wiring on the Docs screen (native Docs reader, reader-mode plan Task XR1.2 as
// amended 2026-11-24, D-8975; spec 2026-11-20 sections 4.1, 4.2, 6.3 and 6.5). `useReaderMode` (L4) runs `readerModeStep`'s acts in
// order and decides nothing; `DocsReading` is the container, the focus guards, the live region and the sheets' portal target;
// `readerModeHandle` is the one outside door (`r`, the palette). jsdom: the Fullscreen and Wake Lock APIs are faked per test and
// restored after, the page clock's visibility change is the real event, and the frame is a fake with `focus` and `setReading`.
// Layout, `inert` and the focus order in a real engine are the browser suite's (`reader-mode.browser.test.ts`, a later task).
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { Fragment, StrictMode, useContext, useEffect, useState, type ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { flushSync } from 'react-dom';
import { CommandPalette, Sheet } from '@ccrc/ui';
import { DocsReading } from '../src/docs/DocsReading';
import { readerModeHandle } from '../src/docs/readerModeHandle';
import {
  NO_READER_PLACES, ReaderModeContext, useReaderMode,
  type ReaderModeContextValue, type ReaderModeFrame, type ReaderModePlaces,
} from '../src/docs/useReaderMode';
import { READER_EXIT_LANDING_MS, READER_EXIT_SETTLE_MS, READER_WAKE_IDLE_MS } from '../src/docs/reader/readerMode';
import { READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import { DocsScreen } from '../src/screens/DocsScreen';
import { clearAuthLost, raiseAuthLost, useAuthLost } from '../src/lib/auth';
import { LoginScreen } from '../src/components/LoginScreen';
import { navigate, useLocation } from '../src/lib/router';
import { IDX_KEY, PLACES_RECORD_KEY, PLACE_KEY } from '../src/lib/historyPlaces';
import { onPop, readPlaces, resetPopstateForTests } from '../src/lib/popstate';
import { startPlaces, type Places } from '../src/docs/reader/places';
import { useFleetStore } from '../src/stores/fleet';
import type { ReaderDeps } from '../src/docs/ReaderFrame';
import { parseMarkdown } from '../src/lib/markdownParse';
import type { MarkdownParser } from '../src/lib/markdownRunner';
import { COMMIT_B, fakeLoaders } from './docsFixtures';
import { declValue, ruleIn } from './cssRule';

// The Docs screen's reader frame, for the two screen rows: it reports itself ready to reader mode's context, as the real one
// will (XR1.4), and draws the host element the screen's CSS selects. The real frame's mount is `reader-frame.test.tsx`'s.
vi.mock('../src/docs/ReaderFrame', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/docs/ReaderFrame')>();
  const { ReaderModeContext: Ctx } = await import('../src/docs/useReaderMode');
  const { Sheet: BodySheet } = await import('@ccrc/ui');
  // It also holds one `Sheet` in the Docs body, as the real frame's external-link sheet is: opened and closed by a document event.
  function FakeReaderFrame(): ReactNode {
    const ctx = useContext(Ctx);
    const setFrame = ctx?.setFrame;
    const [sheet, setSheet] = useState(false);
    useEffect(() => {
      setFrame?.({
        ready: true, planned: 'off', focus: () => undefined, setReading: () => undefined, command: () => undefined,
        title: 'a.md', progress: { read: () => 0, subscribe: () => () => undefined },
      });
      return () => setFrame?.(null);
    }, [setFrame]);
    useEffect(() => {
      const on = (e: Event): void => setSheet((e as CustomEvent<boolean>).detail);
      document.addEventListener('test-reader-sheet', on);
      return () => document.removeEventListener('test-reader-sheet', on);
    }, []);
    return (
      <Fragment>
        <div className="docs-reader" data-testid="reader-host" />
        <BodySheet open={sheet} onClose={() => setSheet(false)} title="A link"><button type="button">Inside the sheet</button></BodySheet>
      </Fragment>
    );
  }
  return { ...orig, ReaderFrame: FakeReaderFrame };
});

const parser: MarkdownParser = async (src) => parseMarkdown(src, 'docs');
const reader = { render: () => new Promise<never>(() => undefined), mount: () => undefined, images: () => undefined } as unknown as ReaderDeps;

// ─── fakes, installed per test and restored in afterEach ────────────────────────────────────────────────────────────────

interface FullScreenFake {
  /** What each `requestFullscreen` call saw: its target, its options and the container's attribute at that moment. */
  readonly calls: Array<{ el: Element; opts: unknown; attr: string | null }>;
  grant(): void;
  refuse(): void;
  /** The browser takes full screen away (Esc, the page hidden): `fullscreenElement` goes and `fullscreenchange` fires. */
  lose(): void;
  readonly exitFullscreen: ReturnType<typeof vi.fn>;
}

const restorers: Array<() => void> = [];

function defineOwn(target: object, key: string, descriptor: PropertyDescriptor): void {
  const before = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  restorers.push(() => {
    if (before === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, before);
  });
}

function installFullScreen(order: string[] = []): FullScreenFake {
  let fsEl: Element | null = null;
  let pending: { el: Element; res(): void; rej(e: unknown): void } | null = null;
  const calls: FullScreenFake['calls'] = [];
  defineOwn(document, 'fullscreenEnabled', { get: () => true });
  defineOwn(document, 'fullscreenElement', { get: () => fsEl });
  const exitFullscreen = vi.fn(async () => { fsEl = null; document.dispatchEvent(new Event('fullscreenchange')); });
  defineOwn(document, 'exitFullscreen', { value: exitFullscreen, writable: true });
  defineOwn(HTMLElement.prototype, 'requestFullscreen', {
    writable: true,
    value(this: HTMLElement, opts?: unknown): Promise<void> {
      calls.push({ el: this, opts, attr: this.getAttribute('data-reader-mode') });
      order.push('request');
      return new Promise<void>((res, rej) => { pending = { el: this, res, rej }; });
    },
  });
  return {
    calls, exitFullscreen,
    grant: () => { const p = pending; if (p === null) throw new Error('no request'); fsEl = p.el; document.dispatchEvent(new Event('fullscreenchange')); p.res(); },
    refuse: () => { const p = pending; if (p === null) throw new Error('no request'); p.rej(new Error('refused')); },
    lose: () => { fsEl = null; document.dispatchEvent(new Event('fullscreenchange')); },
  };
}

interface WakeFake { readonly request: ReturnType<typeof vi.fn>; readonly sentinels: Array<{ release: ReturnType<typeof vi.fn> }> }

function installWakeLock(refuse = false): WakeFake {
  const sentinels: WakeFake['sentinels'] = [];
  const request = vi.fn(async (): Promise<unknown> => {
    if (refuse) throw new Error('NotAllowedError');
    const s = { release: vi.fn(async () => undefined), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    sentinels.push(s);
    return s;
  });
  defineOwn(navigator, 'wakeLock', { value: { request } });
  return { request, sentinels };
}

function removeWakeLock(): void {
  defineOwn(navigator, 'wakeLock', { value: undefined });
}

let visibility: 'visible' | 'hidden' = 'visible';
function installVisibility(): (next: 'visible' | 'hidden') => void {
  visibility = 'visible';
  defineOwn(document, 'visibilityState', { get: () => visibility });
  return (next) => { visibility = next; document.dispatchEvent(new Event('visibilitychange')); };
}

interface PlacesFake extends ReaderModePlaces {
  readonly push: ReturnType<typeof vi.fn<() => boolean>>;
  readonly stepBack: ReturnType<typeof vi.fn<() => number>>;
  readonly markExitPending: ReturnType<typeof vi.fn<(on: boolean) => void>>;
  landed: boolean;
  /** The step back's landing, as the pop dispatcher reports it: the registered host's `exitReader` (wave 62: until it comes, a
   *  re-entry after an exit that stepped back is refused). */
  land(): void;
}

function fakePlaces(order: string[] = []): PlacesFake {
  let host: Parameters<ReaderModePlaces['register']>[0] | null = null;
  const p: PlacesFake = {
    landed: false,
    placeFree: () => true,
    push: vi.fn(() => { order.push('push'); return true; }),
    stepBack: vi.fn(() => { order.push('step-back'); return 1; }),
    landedBelow: () => p.landed,
    markExitPending: vi.fn(),
    register: (h) => { host = h; return () => { host = null; }; },
    standingOnDead: () => false,
    land: () => { if (host === null) throw new Error('no host registered'); host.exitReader(false); },
  };
  return p;
}

interface FakeFrame extends ReaderModeFrame {
  readonly focus: Mock<() => void>;
  readonly setReading: Mock<ReaderModeFrame['setReading']>;
}

function fakeFrame(ready = true): FakeFrame {
  return {
    ready, planned: 'off', focus: vi.fn<() => void>(), setReading: vi.fn<ReaderModeFrame['setReading']>(), command: () => undefined,
    title: 'a.md', progress: { read: () => 0, subscribe: () => () => undefined },
  };
}

// ─── the harness ───────────────────────────────────────────────────────────────────────────────────────────────────────

let latest: ReaderModeContextValue;
const reading = (): HTMLElement => document.querySelector('.docs-reading') as HTMLElement;
const attr = (): string | null => reading().getAttribute('data-reader-mode');

/** The hook, the container around a body, and two console nodes standing outside it, as the head and the rail do. */
function Harness(p: {
  doc?: string | null; plainView?: boolean; places?: ReaderModePlaces; frame?: ReaderModeFrame | null; sheet?: boolean; closedDialog?: boolean;
}): ReactNode {
  const { value, container } = useReaderMode({ doc: p.doc === undefined ? 'doc-a' : p.doc, plainView: p.plainView ?? false, places: p.places });
  latest = value;
  const frame = p.frame === undefined ? null : p.frame;
  const setFrame = value.setFrame;
  useEffect(() => { setFrame(frame); }, [setFrame, frame]);
  return (
    <>
      <header data-testid="console-head"><button type="button">Head control</button></header>
      <DocsReading reading={container}>
        <div className="docs-leaf" data-testid="body">
          <div className="docs-reader" data-testid="host" />
          {p.closedDialog === true && <div role="dialog" data-state="closed" />}
          <Sheet open={p.sheet === true} onClose={() => undefined} title="A link"><button type="button">Inside the sheet</button></Sheet>
        </div>
      </DocsReading>
      <aside data-testid="console-nav" />
    </>
  );
}

const flush = async (): Promise<void> => { await act(async () => { await Promise.resolve(); }); };
const settle = async (): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, 20)); }); };
const hiddenUp = (el: Element): boolean => {
  for (let at: Element | null = el; at !== null; at = at.parentElement) {
    if (at.getAttribute('aria-hidden') === 'true' || at.hasAttribute('inert')) return true;
  }
  return false;
};

beforeEach(() => { useFleetStore.setState({ blocked: false }); });

afterEach(() => {
  // Unmounting leaves reader mode (the hook's teardown), so a failed assertion never leaves the console suspended; the sweep
  // below is only a net for a node a test appended to the body itself.
  cleanup();
  for (const el of document.querySelectorAll('[inert], [aria-hidden="true"]')) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  clearAuthLost();
  useFleetStore.setState({ blocked: false });
  vi.useRealTimers();
  vi.restoreAllMocks();
  while (restorers.length > 0) restorers.pop()?.();
  history.replaceState(null, '', '/');
});

/** Renders the harness with a ready frame and a places port, and returns them. */
function setup(over: { places?: ReaderModePlaces; wake?: boolean; order?: string[] } = {}): {
  fs: FullScreenFake; frame: ReturnType<typeof fakeFrame>; places: PlacesFake; view: ReturnType<typeof render>; props: Parameters<typeof Harness>[0];
} {
  const order = over.order ?? [];
  const fs = installFullScreen(order);
  const places = over.places === undefined ? fakePlaces(order) : (over.places as PlacesFake);
  const frame = fakeFrame();
  const props = { frame, places };
  const view = render(<Harness {...props} />);
  return { fs, frame, places, view, props };
}

// ─── the container, the fill and full screen ───────────────────────────────────────────────────────────────────────────

describe('reader mode: the fill, the request and the exits (X6 XR1.2)', () => {
  it('reader mode: enter sets data-reader-mode to fill before requestFullscreen resolves', () => {
    const { fs } = setup();
    expect(attr(), 'CONTROL: no attribute before entering').toBeNull();
    act(() => { latest.enter('button'); });
    expect(fs.calls).toHaveLength(1);
    expect(fs.calls[0]?.attr, 'the fill was not drawn when the request was made').toBe('fill');
    expect(attr(), 'still fill while the request is pending').toBe('fill');
  });

  it('reader mode: requestFullscreen is called on the container with navigationUI hide, in the same task as enter, after the place is pushed', () => {
    const order: string[] = [];
    const { fs, places } = setup({ order });
    act(() => { latest.enter('key'); });
    // Synchronously after the enter call: no await between the tap and the request (user activation).
    expect(fs.calls).toHaveLength(1);
    expect(fs.calls[0]?.el).toBe(reading());
    expect(fs.calls[0]?.opts).toEqual({ navigationUI: 'hide' });
    expect(places.push).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['push', 'request']);
  });

  it('reader mode: granted sets full-screen, refused keeps fill', async () => {
    const granted = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { granted.fs.grant(); });
    expect(attr()).toBe('full-screen');
    cleanup();
    while (restorers.length > 0) restorers.pop()?.();

    const refused = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { refused.fs.refuse(); });
    expect(attr(), 'a refusal must leave reader mode on as fill').toBe('fill');
    expect(refused.frame.setReading).toHaveBeenCalledWith('screens');
    expect(refused.frame.setReading).not.toHaveBeenCalledWith('off');
  });

  it('reader mode: fullscreenchange to no element ends reader mode once', async () => {
    vi.useFakeTimers();
    const { fs, frame, places } = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { fs.grant(); });
    expect(attr()).toBe('full-screen');
    await act(async () => { fs.lose(); });
    expect(attr(), 'reader mode did not end').toBeNull();
    expect(latest.state.on).toBe(false);
    // A second change with no element, and the settle wait, add no second exit.
    await act(async () => { fs.lose(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_EXIT_SETTLE_MS + 50); });
    expect(frame.setReading.mock.calls.filter(([m]) => m === 'off')).toHaveLength(1);
    expect(places.stepBack).toHaveBeenCalledTimes(1);
    expect(places.markExitPending).toHaveBeenCalledWith(true);
    expect(fs.exitFullscreen, 'the browser took full screen away: nothing to leave').not.toHaveBeenCalled();
  });

  it('reader mode: exitFullscreen is called only when the container is the full-screen element', async () => {
    const refused = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { refused.fs.refuse(); });
    act(() => { latest.exit('exit-tap'); });
    expect(refused.fs.exitFullscreen, 'the container never held full screen').not.toHaveBeenCalled();
    cleanup();
    while (restorers.length > 0) restorers.pop()?.();

    const held = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { held.fs.grant(); });
    act(() => { latest.exit('exit-tap'); });
    expect(held.fs.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(attr()).toBeNull();
  });

  it('reader mode: a block or sign-in screen appearing ends reader mode', async () => {
    setup();
    act(() => { latest.enter('button'); });
    expect(latest.state.on).toBe(true);
    await act(async () => { useFleetStore.setState({ blocked: true }); });
    expect(latest.state.on, 'the block screen did not end reader mode').toBe(false);
    expect(attr()).toBeNull();
    useFleetStore.setState({ blocked: false });
    cleanup();

    setup();
    act(() => { latest.enter('button'); });
    expect(latest.state.on).toBe(true);
    await act(async () => { raiseAuthLost('expired'); });
    expect(latest.state.on, 'the sign-in screen did not end reader mode').toBe(false);
    expect(attr()).toBeNull();
  });

  it('reader mode: losing full screen with a sheet open keeps the sheet usable', async () => {
    const { fs, view, props } = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { fs.grant(); });
    view.rerender(<Harness {...props} sheet />);
    await settle();
    const dialog = screen.getByRole('dialog');
    expect(reading().querySelector('.docs-reading-portal')?.contains(dialog), 'the sheet is not in the container\'s portal').toBe(true);
    await act(async () => { fs.lose(); });
    expect(latest.state.on).toBe(false);
    const still = screen.getByRole('dialog');
    expect(still, 'the sheet was remounted').toBe(dialog);
    expect(still.getAttribute('data-state')).toBe('open');
    expect(reading().querySelector('.docs-reading-portal')?.contains(still)).toBe(true);
    expect(hiddenUp(still), 'the sheet or an ancestor is aria-hidden or inert').toBe(false);
  });

  it('reader mode: everything outside the container is inert and aria-hidden while on, and restored after', () => {
    setup();
    const nodes = [screen.getByTestId('console-head'), screen.getByTestId('console-nav')];
    for (const n of nodes) expect(n.hasAttribute('inert') || n.getAttribute('aria-hidden') === 'true', 'CONTROL: not hidden before').toBe(false);
    act(() => { latest.enter('button'); });
    for (const n of nodes) {
      expect(n.hasAttribute('inert'), 'not inert while on').toBe(true);
      expect(n.getAttribute('aria-hidden'), 'not aria-hidden while on').toBe('true');
      expect(n.hasAttribute('data-aria-hidden'), 'a data-aria-hidden mark was written').toBe(false);
    }
    expect(hiddenUp(reading()), 'the container itself was hidden').toBe(false);
    expect(hiddenUp(document.querySelector('.docs-reading-live') as Element), 'the live region is inside a hidden node').toBe(false);
    act(() => { latest.exit('exit-tap'); });
    for (const n of nodes) {
      expect(n.hasAttribute('inert'), 'still inert after').toBe(false);
      expect(n.hasAttribute('aria-hidden'), 'still aria-hidden after').toBe(false);
    }
  });

  it('reader mode: not offered while a sheet is animating closed', () => {
    const fs = installFullScreen();
    const places = fakePlaces();
    render(<Harness frame={fakeFrame()} places={places} closedDialog />);
    expect(latest.offered, 'CONTROL: the frame is ready and the view is rich').toBe(true);
    act(() => { latest.enter('key'); });
    expect(latest.state.on, 'reader mode started under a modal layer').toBe(false);
    expect(attr()).toBeNull();
    expect(places.push).not.toHaveBeenCalled();
    expect(fs.calls).toHaveLength(0);
  });

  it('reader mode: the entry is announced in the polite live region, which sits in the container', async () => {
    setup();
    act(() => { latest.enter('button'); });
    await flush();
    const live = document.querySelector('.docs-reading-live') as HTMLElement;
    expect(live.getAttribute('aria-live')).toBe('polite');
    expect(reading().contains(live)).toBe(true);
    expect(live.textContent).toBe(READER_MODE_TEXT.live);
  });
});

// ─── the wake lock (spec 6.3) ──────────────────────────────────────────────────────────────────────────────────────────

describe('wake lock (X6 XR1.2)', () => {
  it('wake lock: requested on enter, released on exit', async () => {
    const wake = installWakeLock();
    setup();
    expect(wake.request, 'CONTROL: nothing requested before entering').not.toHaveBeenCalled();
    act(() => { latest.enter('button'); });
    await flush();
    expect(wake.request).toHaveBeenCalledWith('screen');
    expect(wake.request).toHaveBeenCalledTimes(1);
    expect(wake.sentinels[0]?.release).not.toHaveBeenCalled();
    act(() => { latest.exit('exit-tap'); });
    await flush();
    expect(wake.sentinels[0]?.release, 'the lock was not released on exit').toHaveBeenCalledTimes(1);
  });

  it('wake lock: released after 300000 ms with no activity and requested again on the next activity', async () => {
    vi.useFakeTimers();
    const wake = installWakeLock();
    setup();
    act(() => { latest.enter('button'); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(wake.request).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_WAKE_IDLE_MS - 1); });
    expect(wake.sentinels[0]?.release, 'released a millisecond early').not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(wake.sentinels[0]?.release, 'not released after the idle time').toHaveBeenCalledTimes(1);
    expect(latest.state.on, 'idle release does not end reader mode').toBe(true);
    act(() => { latest.activity(); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(wake.request, 'not requested again on the next activity').toHaveBeenCalledTimes(2);
    // The new activity re-armed the one idle timer: it is released again a full idle time after it.
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_WAKE_IDLE_MS); });
    expect(wake.sentinels[1]?.release).toHaveBeenCalledTimes(1);
  });

  it('wake lock: re-requested on visible, released when reader mode ended while hidden', async () => {
    const wake = installWakeLock();
    const fire = installVisibility();
    const { fs } = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { fs.grant(); });
    await flush();
    expect(wake.request).toHaveBeenCalledTimes(1);
    // Hidden: the browser drops the lock itself, and ccrc forgets the sentinel. Visible again: asked for again.
    await act(async () => { fire('hidden'); });
    await act(async () => { fire('visible'); });
    await flush();
    expect(wake.request, 'not requested again when the page was visible again').toHaveBeenCalledTimes(2);
    // Reader mode ends while the page is hidden (the browser dropped full screen): nothing is asked for on return.
    await act(async () => { fire('hidden'); });
    await act(async () => { fs.lose(); });
    expect(latest.state.on).toBe(false);
    await act(async () => { fire('visible'); });
    await flush();
    expect(wake.request, 'requested again after reader mode had ended').toHaveBeenCalledTimes(2);
    for (const s of wake.sentinels) expect(s.release.mock.calls.length, 'a sentinel was released twice').toBeLessThanOrEqual(1);
  });

  it('wake lock: a missing API or a refusal changes nothing', async () => {
    removeWakeLock();
    setup();
    act(() => { latest.enter('button'); });
    await flush();
    expect(latest.state.on).toBe(true);
    expect(attr()).toBe('fill');
    act(() => { latest.exit('exit-tap'); });
    expect(latest.state.on).toBe(false);
    cleanup();
    while (restorers.length > 0) restorers.pop()?.();

    const refusing = installWakeLock(true);
    setup();
    act(() => { latest.enter('button'); });
    await flush();
    expect(refusing.request).toHaveBeenCalledTimes(1);
    expect(latest.state.on, 'a refused lock ended reader mode').toBe(true);
    expect(attr()).toBe('fill');
    act(() => { latest.activity(); });
    await flush();
    act(() => { latest.exit('exit-tap'); });
    expect(latest.state.on).toBe(false);
  });
});

// ─── the focus guards (spec 6.5) ───────────────────────────────────────────────────────────────────────────────────────

describe('focus (X6 XR1.2)', () => {
  it('focus: the guards take focus only while reader mode is on, and the leading one sends focus to the frame when no control is drawn', () => {
    const { frame } = setup();
    const guards = [...document.querySelectorAll<HTMLElement>('.docs-reading-guard')];
    expect(guards).toHaveLength(2);
    const [leading, trailing] = guards as [HTMLElement, HTMLElement];
    for (const g of guards) expect(g.getAttribute('tabindex'), 'a guard is in the tab order while reader mode is off').toBe('-1');
    act(() => { leading.focus(); });
    act(() => { trailing.focus(); });
    expect(frame.focus, 'a guard moved focus while reader mode was off').not.toHaveBeenCalled();

    act(() => { latest.enter('button'); });
    for (const g of guards) expect(g.getAttribute('tabindex')).toBe('0');
    frame.focus.mockClear();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => { leading.focus(); });
    expect(frame.focus, 'no control drawn: the leading guard sends focus to the frame').toHaveBeenCalledTimes(1);

    frame.focus.mockClear();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => { trailing.focus(); });
    expect(frame.focus, 'the trailing guard sends focus into the frame').toHaveBeenCalledTimes(1);
    // With the overlay shown, the leading guard wraps to the overlay's last control instead: it decides by reader mode's
    // state, not by the controls it finds (`reader-mode-overlay.test.tsx`'s focus case, X6.77).
  });
});

// ─── the Docs screen ───────────────────────────────────────────────────────────────────────────────────────────────────

describe('docs screen (X6 XR1.2)', () => {
  function screenAt(url: string): ReturnType<typeof render> {
    navigate(url);
    return render(<DocsScreen path={location.pathname} search={location.search} loaders={fakeLoaders().loaders} parser={parser} reader={reader} />);
  }

  it('docs screen: the container wraps the body in every view and remounts nothing', async () => {
    screenAt('/docs/demo/specs/a.md');
    const host = await screen.findByTestId('reader-host');
    const container = reading();
    expect(container, 'no reading container on a leaf').not.toBeNull();
    expect(container.contains(host)).toBe(true);
    expect(container.querySelector('.docs-leaf')?.contains(host)).toBe(true);
    await flush();
    expect(readerModeHandle()?.offered(), 'CONTROL: the frame is ready').toBe(true);

    act(() => { readerModeHandle()?.toggle(); });
    expect(reading().getAttribute('data-reader-mode')).toBe('fill');
    expect(readerModeHandle()?.on()).toBe(true);
    expect(screen.getByTestId('reader-host'), 'the reader host was remounted entering').toBe(host);
    expect(reading(), 'the container was remounted entering').toBe(container);
    act(() => { readerModeHandle()?.toggle(); });
    expect(reading().getAttribute('data-reader-mode')).toBeNull();
    expect(readerModeHandle()?.on()).toBe(false);
    expect(screen.getByTestId('reader-host'), 'the reader host was remounted leaving').toBe(host);
    expect(reading(), 'the container was remounted leaving').toBe(container);
    cleanup();

    // A page with no reader (the index, a section) still has the container, in the normal view.
    screenAt('/docs/demo/specs');
    await screen.findByRole('button', { name: /share/i });
    expect(document.querySelector('.docs-screen > .docs-reading'), 'no container on a non-leaf page').not.toBeNull();
    expect(reading().getAttribute('data-reader-mode')).toBeNull();
  });

  it('handle: empty on every other screen', async () => {
    expect(readerModeHandle(), 'CONTROL: nothing mounted').toBeNull();
    const view = screenAt('/docs/demo/specs/a.md');
    await screen.findByTestId('reader-host');
    expect(readerModeHandle(), 'the Docs screen sets no handle').not.toBeNull();
    view.unmount();
    expect(readerModeHandle(), 'the handle outlived the Docs screen').toBeNull();
    render(<p>Another screen</p>);
    expect(readerModeHandle()).toBeNull();
  });

  it('docs screen: unmounting while reader mode is on gives the console back, without a step back', async () => {
    const view = screenAt('/docs/demo/specs/a.md');
    await screen.findByTestId('reader-host');
    await flush();
    const outside = document.createElement('aside');
    document.body.appendChild(outside);
    try {
      act(() => { readerModeHandle()?.toggle(); });
      expect(outside.hasAttribute('inert')).toBe(true);
      view.unmount();
      expect(outside.hasAttribute('inert'), 'the console stayed hidden after the screen left').toBe(false);
      expect(outside.hasAttribute('aria-hidden')).toBe(false);
    } finally {
      outside.remove();
    }
  });

  /** Opens or closes the Docs body's sheet (the fake frame's, standing for the reader's external-link sheet). */
  const sheetOpen = async (open: boolean): Promise<void> => {
    await act(async () => { document.dispatchEvent(new CustomEvent('test-reader-sheet', { detail: open })); });
    await settle();
  };
  /** Leaves reader mode if a failed assertion left it on, so no console node stays inert for the next case. */
  const leaveReaderMode = (): void => {
    act(() => { if (readerModeHandle()?.on() === true) readerModeHandle()?.toggle(); });
  };

  it('reader mode: sheets on a Docs page portal into the container in both views and survive entering and leaving', async () => {
    screenAt('/docs/demo/specs/a.md');
    await screen.findByTestId('reader-host');
    await flush();
    const portal = (): Element | null => reading().querySelector('.docs-reading-portal');
    try {
      // The normal view: the sheet the body opens is drawn in the container's portal target.
      await sheetOpen(true);
      expect(portal()?.contains(screen.getByRole('dialog')), 'the sheet is not drawn in the reading container (normal view)').toBe(true);
      await sheetOpen(false);
      expect(screen.queryByRole('dialog')).toBeNull();

      // Reader mode: the same, and a sheet open as reader mode ends is not moved or remounted.
      act(() => { readerModeHandle()?.toggle(); });
      expect(readerModeHandle()?.on()).toBe(true);
      await sheetOpen(true);
      const dialog = screen.getByRole('dialog');
      expect(portal()?.contains(dialog), 'the sheet is not drawn in the reading container (reader mode)').toBe(true);
      act(() => { readerModeHandle()?.toggle(); });
      expect(readerModeHandle()?.on()).toBe(false);
      await settle();
      expect(screen.getByRole('dialog'), 'the sheet was remounted by leaving').toBe(dialog);
      expect(portal()?.contains(dialog), 'the sheet left the container by leaving').toBe(true);
    } finally {
      leaveReaderMode();
    }
  });

  // X6 XR fix round 2, review 4043 F1: a sheet that unmounts while open, after reader mode has ended, gives the console back.
  /** Every node outside the reading container that is hidden from assistive technology or inert. The page's own markup hides
   *  some (a decorative icon or glyph), and a head draws others as its state changes, so a case reads what reader mode added:
   *  the nodes hidden once it is on that were not before it, and which of those are still hidden or inert later. */
  const suspendedOutside = (): Element[] => {
    const container = document.querySelector('.docs-reading');
    return [...document.querySelectorAll('[aria-hidden="true"], [inert]')].filter((el) => !(container?.contains(el) ?? false));
  };
  const stillSuspended = (nodes: readonly Element[]): Element[] =>
    nodes.filter((el) => el.isConnected && (el.getAttribute('aria-hidden') === 'true' || el.hasAttribute('inert')));

  it('reader mode: the sheet open, full screen lost, then the body remounting at another commit leaves no console node hidden', async () => {
    const fs = installFullScreen();
    const f = fakeLoaders();
    function Routed(): ReactNode {
      const { path, search } = useLocation();
      return <DocsScreen path={path} search={search} loaders={f.loaders} parser={parser} reader={reader} />;
    }
    navigate('/docs/demo/specs/a.md');
    render(<Routed />);
    await screen.findByTestId('reader-host');
    await flush();
    const outside = document.createElement('aside');
    document.body.appendChild(outside);
    const before = suspendedOutside();
    try {
      act(() => { readerModeHandle()?.toggle(); });
      await act(async () => { fs.grant(); });
      await sheetOpen(true);
      expect(screen.getByRole('dialog').getAttribute('data-state'), 'CONTROL: the body sheet is open').toBe('open');
      expect(outside.getAttribute('aria-hidden'), 'CONTROL: the console is hidden in reader mode').toBe('true');
      const added = suspendedOutside().filter((el) => !before.includes(el));
      expect(added, 'CONTROL: reader mode hid the console').toContain(outside);
      await act(async () => { fs.lose(); });
      expect(readerModeHandle()?.on(), 'CONTROL: losing full screen ended reader mode').toBe(false);
      expect(screen.getByRole('dialog'), 'CONTROL: the sheet is still open').toBeDefined();
      expect(outside.hasAttribute('inert'), 'CONTROL: the console is focusable again').toBe(false);
      expect(outside.getAttribute('aria-hidden'), 'CONTROL: hidden behind the open sheet').toBe('true');
      const body = screen.getByTestId('reader-host');
      await act(async () => { navigate(`/docs/demo/specs/a.md?at=${COMMIT_B}`); });
      await settle();
      expect(screen.queryByRole('dialog'), 'CONTROL: the body remounted, and its sheet went with it').toBeNull();
      expect(screen.getByTestId('reader-host'), 'CONTROL: the body is a new mount').not.toBe(body);
      expect(stillSuspended(added), 'a console node stayed hidden or inert after the sheet unmounted').toEqual([]);
    } finally {
      leaveReaderMode();
      outside.remove();
    }
  });

  it('reader mode: the sheet open, then the route leaving the Docs screen, leaves no console node hidden', async () => {
    installFullScreen();
    const f = fakeLoaders();
    function Routed(): ReactNode {
      const { path, search } = useLocation();
      return path.startsWith('/docs')
        ? <DocsScreen path={path} search={search} loaders={f.loaders} parser={parser} reader={reader} />
        : <p>Another screen</p>;
    }
    navigate('/docs/demo/specs/a.md');
    render(<Routed />);
    await screen.findByTestId('reader-host');
    await flush();
    const outside = document.createElement('aside');
    document.body.appendChild(outside);
    try {
      act(() => { readerModeHandle()?.toggle(); });
      await sheetOpen(true);
      expect(screen.getByRole('dialog').getAttribute('data-state'), 'CONTROL: the body sheet is open').toBe('open');
      expect(outside.getAttribute('aria-hidden'), 'CONTROL: the console is hidden in reader mode').toBe('true');
      await act(async () => { navigate('/somewhere-else'); });
      await settle();
      expect(screen.getByText('Another screen'), 'CONTROL: the route left the Docs screen').toBeDefined();
      expect(screen.queryByRole('dialog'), 'CONTROL: the sheet went with it').toBeNull();
      expect(suspendedOutside(), 'a console node stayed hidden or inert after the sheet unmounted').toEqual([]);
    } finally {
      outside.remove();
    }
  });

  // X6 follow-up, review 4052 A1, its five steps: (1) enter and open the external-link sheet in the reading container; (2) leave
  // full screen with the browser's Esc, so reader mode ends and the sheet stays open, the console held hidden for it; (3) Ctrl+K
  // opens the palette over the sheet; (4) a "Go to" command: `CommandLayer` runs the command before it closes the palette, and
  // without view transitions or under reduced motion the router commits the route inside `flushSync`, so the Docs screen and its
  // sheet unmount while the palette still reads open; (5) the palette closes. Then a second reader mode, and the console must be
  // announced again.
  it('reader mode: the palette\'s "Go to" path (the sheet unmounts under the open palette, which then closes), then a second reader mode, leaves no console node hidden', async () => {
    const fs = installFullScreen();
    const f = fakeLoaders();
    let setPalette: (open: boolean) => void = () => undefined;
    function Routed(): ReactNode {
      const { path, search } = useLocation();
      const [palette, setOpen] = useState(false);
      setPalette = setOpen;
      return (
        <>
          {path.startsWith('/docs')
            ? <DocsScreen path={path} search={search} loaders={f.loaders} parser={parser} reader={reader} />
            : <p>Another screen</p>}
          <CommandPalette open={palette} onClose={() => setOpen(false)} query="" onQueryChange={() => undefined} options={[]} onRun={() => undefined} />
        </>
      );
    }
    navigate('/docs/demo/specs/a.md');
    render(<Routed />);
    await screen.findByTestId('reader-host');
    await flush();
    const outside = document.createElement('aside');
    document.body.appendChild(outside);
    const before = suspendedOutside();
    try {
      // (1)
      act(() => { readerModeHandle()?.toggle(); });
      await act(async () => { fs.grant(); });
      await sheetOpen(true);
      const added = suspendedOutside().filter((el) => !before.includes(el));
      expect(added, 'CONTROL: reader mode hid the console').toContain(outside);
      // (2)
      await act(async () => { fs.lose(); });
      expect(readerModeHandle()?.on(), 'CONTROL: losing full screen ended reader mode').toBe(false);
      expect(outside.getAttribute('aria-hidden'), 'CONTROL: hidden behind the open sheet').toBe('true');
      // (3)
      act(() => { setPalette(true); });
      await settle();
      expect(screen.getByRole('dialog', { name: 'Command palette' }).getAttribute('data-state'), 'CONTROL: the palette is open').toBe('open');
      // (4)
      act(() => { flushSync(() => { navigate('/somewhere-else'); }); });
      await settle();
      expect(screen.getByText('Another screen'), 'CONTROL: the route left the Docs screen').toBeDefined();
      expect(screen.queryByRole('dialog', { name: 'A link' }), 'CONTROL: the sheet went with it').toBeNull();
      expect(outside.getAttribute('aria-hidden'), 'the console was announced under the open palette').toBe('true');
      // (5)
      act(() => { setPalette(false); });
      await settle();
      expect(document.querySelector('[role="dialog"]'), 'CONTROL: the palette is closed and gone').toBeNull();
      expect(stillSuspended(added), 'a console node stayed hidden or inert after the palette, the last dialog over it, closed').toEqual([]);
      // A second reader mode, entered and left: the console is announced again.
      await act(async () => { navigate('/docs/demo/specs/a.md'); });
      await screen.findByTestId('reader-host');
      await flush();
      act(() => { readerModeHandle()?.toggle(); });
      expect(readerModeHandle()?.on(), 'CONTROL: the second reader mode is on').toBe(true);
      expect(outside.getAttribute('aria-hidden'), 'CONTROL: the second reader mode hides the console').toBe('true');
      act(() => { readerModeHandle()?.toggle(); });
      await settle();
      expect(readerModeHandle()?.on(), 'CONTROL: the second reader mode ended').toBe(false);
      expect(stillSuspended(added), 'a console node stayed hidden or inert after the second reader mode').toEqual([]);
    } finally {
      leaveReaderMode();
      outside.remove();
    }
  });

  it('reader mode: the entry announcement is not inside any aria-hidden or inert node', async () => {
    screenAt('/docs/demo/specs/a.md');
    await screen.findByTestId('reader-host');
    await flush();
    const outside = document.createElement('aside');
    document.body.appendChild(outside);
    try {
      act(() => { readerModeHandle()?.toggle(); });
      await flush();
      expect(outside.hasAttribute('inert'), 'CONTROL: the console is suspended').toBe(true);
      const live = [...document.querySelectorAll('.docs-reading-live')].find((el) => el.textContent === READER_MODE_TEXT.live);
      expect(live, 'the announcement was not made').toBeDefined();
      expect(hiddenUp(live as Element), 'the announcement is inside an aria-hidden or inert node').toBe(false);
    } finally {
      leaveReaderMode();
      outside.remove();
    }
  });
});

describe('the default places port', () => {
  it('NO_READER_PLACES places nothing, steps nothing and lands nowhere', () => {
    expect(NO_READER_PLACES.placeFree()).toBe(false);
    expect(NO_READER_PLACES.push()).toBe(false);
    expect(NO_READER_PLACES.stepBack()).toBe(0);
    expect(NO_READER_PLACES.landedBelow()).toBe(false);
    expect(() => NO_READER_PLACES.markExitPending(true)).not.toThrow();
    expect(NO_READER_PLACES.standingOnDead()).toBe(false);
    const stop = NO_READER_PLACES.register({ on: () => false, exitReader: () => undefined, leaveDead: () => undefined });
    expect(() => stop()).not.toThrow();
  });
});

describe('the context', () => {
  it('ReaderModeContext defaults to null outside a Docs screen', () => {
    let seen: ReaderModeContextValue | null | undefined;
    function Probe(): ReactNode { seen = useContext(ReaderModeContext); return null; }
    render(<Probe />);
    expect(seen).toBeNull();
  });
});

// ─── late answers, the document's identity and the settle timer (fix round 1) ───────────────────────────────────────────

describe('reader mode: answers that arrive late, and what ends it (X6 XR1.2, fix round 1)', () => {
  it('reader mode: a grant that lands after the exit leaves full screen', async () => {
    const { fs } = setup();
    act(() => { latest.enter('button'); });
    expect(fs.calls).toHaveLength(1);
    act(() => { latest.exit('exit-tap'); });
    expect(fs.exitFullscreen, 'CONTROL: full screen was not held yet, so the exit left nothing').not.toHaveBeenCalled();
    await act(async () => { fs.grant(); });
    expect(fs.exitFullscreen, 'the late grant kept full screen').toHaveBeenCalledTimes(1);
    expect(document.fullscreenElement).toBeNull();
    expect(attr()).toBeNull();
  });

  it('wake lock: a lock that resolves after it is no longer wanted is released at once', async () => {
    let resolve: (s: unknown) => void = () => undefined;
    const sentinel = { release: vi.fn(async () => undefined), addEventListener: vi.fn() };
    const request = vi.fn(() => new Promise((r) => { resolve = r; }));
    defineOwn(navigator, 'wakeLock', { value: { request } });
    setup();
    act(() => { latest.enter('button'); });
    expect(request).toHaveBeenCalledTimes(1);
    act(() => { latest.exit('exit-tap'); });
    await act(async () => { resolve(sentinel); });
    expect(sentinel.release, 'a lock granted after reader mode ended was kept').toHaveBeenCalledTimes(1);
  });

  it('reader mode: the settle timer is cleared when the screen leaves', async () => {
    vi.useFakeTimers();
    const { fs, places, view } = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { fs.grant(); });
    await act(async () => { fs.lose(); });
    expect(places.markExitPending, 'CONTROL: the exit is waiting on its settle').toHaveBeenCalledWith(true);
    const landed = vi.spyOn(places, 'landedBelow');
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_EXIT_SETTLE_MS + 100); });
    expect(landed, 'the settle ran after the screen left').not.toHaveBeenCalled();
    expect(places.stepBack).not.toHaveBeenCalled();
  });

  it('reader mode: a re-entry during the settle cancels it', async () => {
    vi.useFakeTimers();
    const { fs, places } = setup();
    act(() => { latest.enter('button'); });
    await act(async () => { fs.grant(); });
    await act(async () => { fs.lose(); });
    act(() => { latest.enter('key'); });
    expect(latest.state.on).toBe(true);
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_EXIT_SETTLE_MS + 100); });
    expect(places.stepBack, 'the old settle stepped back the new reading\'s place').not.toHaveBeenCalled();
    expect(places.markExitPending).toHaveBeenLastCalledWith(false);
    expect(latest.state.on).toBe(true);
  });

  it('reader mode: a change of document ends it, and the same document at another commit or fragment does not', async () => {
    const f = fakeLoaders();
    function Routed(): ReactNode {
      const { path, search } = useLocation();
      return <DocsScreen path={path} search={search} loaders={f.loaders} parser={parser} reader={reader} />;
    }
    navigate('/docs/demo/specs/a.md');
    render(<Routed />);
    await screen.findByTestId('reader-host');
    await flush();
    try {
      act(() => { readerModeHandle()?.toggle(); });
      expect(readerModeHandle()?.on()).toBe(true);
      await act(async () => { navigate('/docs/demo/specs/a.md#elsewhere'); });
      await settle();
      expect(readerModeHandle()?.on(), 'another fragment of the same document ended reader mode').toBe(true);
      await act(async () => { navigate(`/docs/demo/specs/a.md?at=${COMMIT_B}`); });
      await settle();
      expect(readerModeHandle()?.on(), 'the same document at another commit ended reader mode').toBe(true);
      await act(async () => { navigate('/docs/demo/specs/b.md'); });
      await settle();
      expect(readerModeHandle()?.on(), 'another document did not end reader mode').toBe(false);
      expect(reading().getAttribute('data-reader-mode')).toBeNull();
    } finally {
      act(() => { if (readerModeHandle()?.on() === true) readerModeHandle()?.toggle(); });
    }
  });
});

// ─── the fill's rules over both shapes of a leaf (spec 4.1; the browser suite pins the pixels) ──────────────────────────

describe('docs.css: the fill keeps the reader host\'s path drawn in both shapes of a leaf (X6 XR1.2, fix round 1)', () => {
  const docsCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8');
  const LEAF = '.docs-screen > .docs-reading[data-reader-mode] > .docs-leaf';
  const UNDRAWN_LEAF = `${LEAF}:has(.docs-reader) > :not(.docs-reader):not(:has(.docs-reader))`;
  const UNDRAWN_DEEP = `${LEAF} :has(.docs-reader) > :not(.docs-reader):not(:has(.docs-reader))`;
  const ON_PATH = `${LEAF} :has(.docs-reader)`;

  const shape = (leaf: string): HTMLElement => {
    const root = document.createElement('div');
    root.innerHTML = `<div class="docs-screen"><div class="docs-reading" data-reader-mode="fill"><div class="docs-leaf">${leaf}</div></div></div>`;
    document.body.appendChild(root);
    restorers.push(() => root.remove());
    return root;
  };
  const idsOf = (root: HTMLElement, selector: string): string[] =>
    [...root.querySelectorAll(selector)].map((el) => el.id).filter((id) => id !== '').sort();

  it('the undrawing rules say display none and the path rule makes a column that hands the host the room', () => {
    expect(declValue(ruleIn(docsCss, UNDRAWN_LEAF), 'display')).toBe('none');
    expect(declValue(ruleIn(docsCss, UNDRAWN_DEEP), 'display')).toBe('none');
    const column = ruleIn(docsCss, ON_PATH);
    expect(declValue(column, 'display')).toBe('flex');
    expect(declValue(column, 'flex-direction')).toBe('column');
    expect(declValue(column, 'min-block-size')).toBe('0');
  });

  it('a leaf that holds the host directly: its siblings are undrawn, the host and its frame are not', () => {
    const root = shape(
      '<p id="fmt" class="doc-formatting">Formatting</p><div id="host" class="docs-reader"><iframe id="frame"></iframe></div><p id="note">n</p>',
    );
    expect(idsOf(root, `${UNDRAWN_LEAF}, ${UNDRAWN_DEEP}`)).toEqual(['fmt', 'note']);
    expect(idsOf(root, ON_PATH), 'no wrapper stands between the leaf and the host').toEqual([]);
  });

  it('a leaf shown in parts: the path to the current part\'s host stays drawn and every sibling at each level is undrawn', () => {
    const root = shape(
      '<div id="actions" class="docs-leaf-actions"><button type="button">Download</button></div>'
      + '<div id="parts" class="docs-in-parts"><nav id="bar" class="docs-parts"><button id="prev" type="button">Previous</button></nav>'
      + '<p id="pnote" class="docs-note">Continued</p><p id="pfmt" class="doc-formatting">Formatting</p>'
      + '<div id="host" class="docs-reader"><iframe id="frame"></iframe></div></div>',
    );
    expect(idsOf(root, `${UNDRAWN_LEAF}, ${UNDRAWN_DEEP}`)).toEqual(['actions', 'bar', 'pfmt', 'pnote']);
    expect(idsOf(root, ON_PATH), 'the wrapper holding the host is on the path').toEqual(['parts']);
  });

  it('a wrapper two levels down is on the path too, and a sibling beside it is undrawn', () => {
    const root = shape(
      '<div id="outer"><div id="inner"><div id="host" class="docs-reader"></div><p id="deep-note">n</p></div><p id="outer-note">n</p></div>',
    );
    expect(idsOf(root, `${UNDRAWN_LEAF}, ${UNDRAWN_DEEP}`)).toEqual(['deep-note', 'outer-note']);
    expect(idsOf(root, ON_PATH)).toEqual(['inner', 'outer']);
  });
});

// ─── the reader place, through the hook with the real port and the real history (X6 XR1.3, the hook's half) ─────────────

describe('reader place: the hook with the real port (X6 XR1.3)', () => {
  const DOC = '/docs/demo/specs/a.md';
  const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
  const lastIdx = (): number => readPlaces().lastIdx;
  const stateNow = (): Record<string, unknown> => (history.state ?? {}) as Record<string, unknown>;
  /** Waits for the landing (a traversal's `popstate` fires a task later), then a little more so an extra event would show. */
  const landed = (n: number): Promise<void> => act(async () => {
    await vi.waitFor(() => { expect(lastIdx()).toBe(n); }, { timeout: 4000, interval: 10 });
    await sleep(30);
  });

  interface Real {
    fs: FullScreenFake;
    frame: FakeFrame;
    ran: Mock<() => void>;
    places: Places;
    popstates: () => number;
    props: Parameters<typeof Harness>[0];
  }
  let visit: Places | null = null;
  let counted = 0;
  const countPop = (): void => { counted += 1; };

  /** The page as the Docs screen leaves it: the previous screen's entry (0), the doc's own (1), the visit started as the
   *  reader body does, a router subscriber counting runs, and the hook mounted with NO injected port (the real one). */
  function mountReal(): Real {
    resetPopstateForTests();
    history.replaceState(null, '', '/before');
    const ran = vi.fn<() => void>();
    onPop(ran);
    history.pushState(null, '', DOC);
    const places = startPlaces({ doc: DOC });
    visit = places;
    const fs = installFullScreen();
    const frame = fakeFrame();
    const props = { frame };
    counted = 0;
    window.addEventListener('popstate', countPop);
    restorers.push(() => window.removeEventListener('popstate', countPop));
    render(<Harness {...props} />);
    return { fs, frame, ran, places, popstates: () => counted, props };
  }

  afterEach(async () => {
    cleanup();
    await sleep(20);
    visit?.end();
    visit = null;
    resetPopstateForTests();
  });

  const consoleFree = (): boolean => {
    for (const id of ['console-head', 'console-nav']) {
      const n = screen.getByTestId(id);
      if (n.hasAttribute('inert') || n.hasAttribute('aria-hidden')) return false;
    }
    return true;
  };

  it('reader place: Exit and losing full screen each consume exactly one reader place', async () => {
    for (const how of ['Exit', 'full screen lost'] as const) {
      const r = mountReal();
      act(() => { latest.enter('button'); });
      await act(async () => { r.fs.grant(); });
      expect(latest.state.on, `${how}: CONTROL: entered`).toBe(true);
      expect(lastIdx(), `${how}: the reader place was pushed`).toBe(2);
      expect(stateNow()[IDX_KEY]).toBe(2);
      expect(stateNow()[PLACE_KEY], `${how}: the entry carries the place`).toBeDefined();
      const go = vi.spyOn(history, 'go');
      if (how === 'Exit') {
        act(() => { latest.exit('exit-tap'); });
      } else {
        await act(async () => { r.fs.lose(); });
        expect(latest.state.on, 'full screen lost ends reader mode at once').toBe(false);
        await act(async () => { await sleep(READER_EXIT_SETTLE_MS + 60); });
      }
      await landed(1);
      expect(latest.state.on, how).toBe(false);
      expect(go, `${how}: the reader place's entry is left exactly once`).toHaveBeenCalledTimes(1);
      expect(go).toHaveBeenCalledWith(-1);
      expect(r.popstates(), `${how}: one traversal`).toBe(1);
      expect(r.ran, `${how}: no router run`).not.toHaveBeenCalled();
      expect(stateNow()[IDX_KEY], `${how}: the doc's own entry`).toBe(1);
      expect(stateNow()[PLACE_KEY], `${how}: no place left on it`).toBeUndefined();
      expect(location.pathname).toBe(DOC);
      expect(readPlaces().exitPending, `${how}: the landing was consumed`).toBe(false);
      cleanup();
      visit?.end();
      visit = null;
      while (restorers.length > 0) restorers.pop()?.();
      go.mockRestore();
    }
  });

  it('reader place: fullscreenchange and popstate in either order exit once', async () => {
    for (const order of ['fullscreenchange first', 'popstate first'] as const) {
      const r = mountReal();
      act(() => { latest.enter('button'); });
      await act(async () => { r.fs.grant(); });
      expect(lastIdx(), `${order}: CONTROL: the place was pushed`).toBe(2);
      const go = vi.spyOn(history, 'go');
      if (order === 'fullscreenchange first') {
        await act(async () => { r.fs.lose(); });
        expect(latest.state.on).toBe(false);
        // The browser's own Back arrives inside the settle.
        await act(async () => { await sleep(50); history.back(); });
      } else {
        await act(async () => { history.back(); });
        await landed(1);
        expect(latest.state.on, 'the Back ended reader mode').toBe(false);
        // The browser's `fullscreenchange` follows the pop.
        await act(async () => { await sleep(50); r.fs.lose(); });
      }
      await landed(1);
      // Past the settle: a second step-back would show now.
      await act(async () => { await sleep(READER_EXIT_SETTLE_MS + 60); });
      expect(lastIdx(), order).toBe(1);
      expect(latest.state.on, `${order}: reader mode is off`).toBe(false);
      expect(r.popstates(), `${order}: exactly one history step in total`).toBe(1);
      expect(go, `${order}: the hook stepped nothing of its own`).not.toHaveBeenCalled();
      expect(r.ran, `${order}: no router run`).not.toHaveBeenCalled();
      expect(stateNow()[IDX_KEY], `${order}: the doc's own entry`).toBe(1);
      expect(location.pathname).toBe(DOC);
      expect(readPlaces().exitPending, order).toBe(false);
      cleanup();
      visit?.end();
      visit = null;
      while (restorers.length > 0) restorers.pop()?.();
      go.mockRestore();
    }
  });

  it('reader place: a reload in reader mode steps below the reader place once, and the next Back leaves the doc', async () => {
    const first = mountReal();
    act(() => { latest.enter('button'); });
    expect(lastIdx()).toBe(2);
    expect(first.ran).not.toHaveBeenCalled();
    // A reload keeps the tab's stored record and the page's history, and loses the page's own memory: its copy of the record
    // and its once-per-page seed. The storage is the tab's, so the stored record is put back after the reset.
    const stored = sessionStorage.getItem(PLACES_RECORD_KEY);
    expect(stored, 'CONTROL: the record is stored').not.toBeNull();
    cleanup();
    resetPopstateForTests();
    sessionStorage.setItem(PLACES_RECORD_KEY, stored as string);
    const ran = vi.fn<() => void>();
    onPop(ran);
    expect(lastIdx(), 'CONTROL: the page seeded on the reader entry').toBe(2);
    visit = startPlaces({ doc: DOC });
    expect(readPlaces().visit, 'CONTROL: the same doc continues the visit').not.toBeNull();
    const go = vi.spyOn(history, 'go');
    const popstates = (): number => counted;
    counted = 0;
    render(<Harness frame={fakeFrame()} />);
    expect(latest.state.on, 'reader mode is always off at a mount').toBe(false);
    await landed(1);
    expect(go, 'stepped below the reader place once').toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(popstates()).toBe(1);
    expect(ran, 'the landing is consumed: no router run').not.toHaveBeenCalled();
    expect(readPlaces().exitPending, 'the mark is cleared by the landing').toBe(false);
    expect(stateNow()[IDX_KEY]).toBe(1);
    expect(stateNow()[PLACE_KEY]).toBeUndefined();
    expect(location.pathname).toBe(DOC);
    expect(latest.state.on, 'reader mode never reopens').toBe(false);
    // The next Back leaves the doc.
    history.back();
    await vi.waitFor(() => { expect(ran).toHaveBeenCalledTimes(1); }, { timeout: 4000, interval: 10 });
    expect(location.pathname).toBe('/before');
    expect(go, 'no second step of the hook').toHaveBeenCalledTimes(1);
  });

  it('reader place: Forward onto the dead reader entry steps below it once through the hook', async () => {
    const r = mountReal();
    act(() => { latest.enter('button'); });
    await act(async () => { r.fs.grant(); });
    expect(lastIdx()).toBe(2);
    await act(async () => { history.back(); });
    await landed(1);
    expect(latest.state.on, 'CONTROL: the Back ended reader mode').toBe(false);
    expect(r.ran).not.toHaveBeenCalled();
    const go = vi.spyOn(history, 'go');
    await act(async () => { history.forward(); });
    await act(async () => { await vi.waitFor(() => { expect(go).toHaveBeenCalledTimes(1); }, { timeout: 4000, interval: 10 }); });
    await landed(1);
    expect(go, 'one step below the dead entry').toHaveBeenCalledTimes(1);
    expect(go).toHaveBeenCalledWith(-1);
    expect(r.popstates(), 'the Back, the Forward and the step').toBe(3);
    expect(r.ran, 'its landing is consumed: no router run').not.toHaveBeenCalled();
    expect(readPlaces().exitPending).toBe(false);
    expect(latest.state.on, 'reader mode does not reopen').toBe(false);
    expect(stateNow()[IDX_KEY], 'the doc\'s own entry').toBe(1);
    expect(location.pathname).toBe(DOC);
  });

  it('reader place: the hook\'s reader host leaves with the screen', async () => {
    // The port: `register` is called once, and its unregister once, on unmount.
    const stop = vi.fn();
    const register = vi.fn((_host: Parameters<ReaderModePlaces['register']>[0]) => stop);
    const standingOnDead = vi.fn(() => false);
    const injected = render(<Harness frame={fakeFrame()} places={{ ...fakePlaces(), register, standingOnDead }} />);
    expect(register).toHaveBeenCalledTimes(1);
    expect(standingOnDead, 'the reload check runs right after registering').toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
    injected.unmount();
    expect(stop, 'the host was not unregistered').toHaveBeenCalledTimes(1);

    // The real dispatcher: a Forward onto a dead reader entry after the screen left is not the hook's to step.
    const r = mountReal();
    act(() => { latest.enter('button'); });
    await act(async () => { r.fs.grant(); });
    await act(async () => { history.back(); });
    await landed(1);
    cleanup();
    const go = vi.spyOn(history, 'go');
    history.forward();
    await act(async () => { await sleep(150); });
    expect(go, 'a host that outlived the screen stepped the page').not.toHaveBeenCalled();
  });

  it('reader place: Back from reader mode shows the doc in the normal view, a second Back leaves it', async () => {
    const r = mountReal();
    act(() => { latest.enter('button'); });
    await act(async () => { r.fs.grant(); });
    expect(attr()).toBe('full-screen');
    expect(consoleFree(), 'CONTROL: the console is hidden while on').toBe(false);
    await act(async () => { history.back(); });
    await landed(1);
    expect(latest.state.on, 'reader mode is off').toBe(false);
    expect(attr(), 'the fill is cleared').toBeNull();
    expect(consoleFree(), 'the console is released').toBe(true);
    expect(r.frame.setReading).toHaveBeenLastCalledWith('off');
    expect(r.ran, 'no router run').not.toHaveBeenCalled();
    expect(location.pathname).toBe(DOC);
    expect(stateNow()[IDX_KEY]).toBe(1);
    // The second Back is no exit: it leaves the doc, and the router runs once.
    history.back();
    await vi.waitFor(() => { expect(r.ran).toHaveBeenCalledTimes(1); }, { timeout: 4000, interval: 10 });
    expect(location.pathname).toBe('/before');
  });
});

// ─── fix round 1 (X6 XR fix round 1) ───────────────────────────────────────────────────────────────────────────────────

/** The hook, its context and the container, as the Docs screen draws them: the overlay and the frameless Exit read the context. */
function CtxHarness(p: { frame: ReaderModeFrame | null; places?: ReaderModePlaces; head?: true }): ReactNode {
  const { value, container } = useReaderMode({ doc: 'doc-a', plainView: false, places: p.places });
  latest = value;
  const setFrame = value.setFrame;
  const { frame } = p;
  useEffect(() => { setFrame(frame); }, [setFrame, frame]);
  // The app's main landmark (`<main id="content" tabIndex={-1}>`, `skins/frame.tsx`) holds the screen; `head` stands in for the Docs
  // head's Reader mode action (a button with its name), outside the reading container as the head is, so reader mode hides it.
  return (
    <ReaderModeContext value={value}>
      <main id="content" tabIndex={-1}>
        {p.head === true && <header><button type="button" aria-label={READER_MODE_TEXT.enter}>Reader mode</button></header>}
        <DocsReading reading={container}>
          <div className="docs-leaf"><div className="docs-reader" data-testid="host" /></div>
        </DocsReading>
      </main>
    </ReaderModeContext>
  );
}

describe('reader mode: an Exit with no frame standing (X6 XR fix round 1, item 2)', () => {
  it('no frame: with reader mode on and the leaf failed, the Exit control is drawn without a tap, and it leaves once', async () => {
    installFullScreen();
    const places = fakePlaces();
    const frame = fakeFrame();
    const view = render(<CtxHarness frame={frame} places={places} />);
    act(() => { latest.enter('button'); });
    await flush();
    expect(latest.state.on).toBe(true);
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.exit }), 'CONTROL: the overlay is hidden while a frame stands').toBeNull();
    // The leaf leaves `ok` (changing or failed): its frame is dropped, and reader mode stays on.
    view.rerender(<CtxHarness frame={null} places={places} />);
    await flush();
    expect(latest.state.on, 'dropping the frame ended reader mode').toBe(true);
    const exit = screen.getByRole('button', { name: READER_MODE_TEXT.exit });
    expect(reading().contains(exit), 'the Exit is outside the reading container').toBe(true);
    expect(screen.queryByRole('radio'), 'the frameless form draws a turn switch').toBeNull();
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.aa }), 'the frameless form draws Aa').toBeNull();
    act(() => { exit.click(); });
    expect(latest.state.on, 'the Exit did not leave reader mode').toBe(false);
    expect(places.stepBack, 'the exit did not step back once').toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.exit }), 'the Exit stayed after leaving').toBeNull();
    // X6 XR fix round 2, item 3 (review 4043 A2): the Exit was tapped and unmounted with no frame to give focus to, so focus must not
    // be left on the page's body: with no head action on screen it goes to the main region. This case clicks without focusing the
    // Exit first (focus starts on the body); the Exit that holds the focus as it unmounts is `tapExit`'s, below (review 4052 A5).
    expect(document.activeElement, 'focus was left on the body').not.toBe(document.body);
    expect(document.activeElement, 'focus did not go to the main region').toBe(document.getElementById('content'));
  });

  it('no frame: reader mode off draws no Exit, and a standing frame with the overlay hidden draws none either', async () => {
    installFullScreen();
    const view = render(<CtxHarness frame={null} places={fakePlaces()} />);
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.exit }), 'an Exit while reader mode is off').toBeNull();
    view.rerender(<CtxHarness frame={fakeFrame()} places={fakePlaces()} />);
    act(() => { latest.enter('button'); });
    await flush();
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.exit }), 'an Exit beside a standing frame').toBeNull();
  });

  it('no frame: both focus guards send focus to the Exit, so Tab never leaves the container for an invisible span (review M2)', async () => {
    installFullScreen();
    const view = render(<CtxHarness frame={fakeFrame()} places={fakePlaces()} />);
    act(() => { latest.enter('button'); });
    await flush();
    view.rerender(<CtxHarness frame={null} places={fakePlaces()} />);
    await flush();
    const exit = screen.getByRole('button', { name: READER_MODE_TEXT.exit });
    const guards = [...document.querySelectorAll<HTMLElement>('.docs-reading-guard')];
    expect(guards, 'CONTROL: two guards').toHaveLength(2);
    for (const [i, guard] of guards.entries()) {
      (document.activeElement as HTMLElement | null)?.blur();
      act(() => { guard.focus(); });
      expect(document.activeElement, `the ${i === 0 ? 'leading' : 'trailing'} guard left focus on itself`).toBe(exit);
    }
  });
});

describe('reader mode: where focus goes after the frameless Exit (X6 XR fix round 2, item 3, review 4043 A2)', () => {
  /** Enters with a standing frame, then drops it (the leaf left `ok`): reader mode is on and the Exit alone is drawn. It takes no
   *  focus when it appears (a frame that comes back must not find focus pulled to it), so `tapExit` focuses it first, as a tap on
   *  a button does in most engines: the Exit that unmounts then holds the focus. */
  async function onWithoutFrame(head?: true): Promise<{ view: ReturnType<typeof render>; places: ReturnType<typeof fakePlaces> }> {
    installFullScreen();
    const places = fakePlaces();
    const view = render(<CtxHarness frame={fakeFrame()} places={places} head={head} />);
    act(() => { latest.enter('button'); });
    await flush();
    view.rerender(<CtxHarness frame={null} places={places} head={head} />);
    await flush();
    expect(latest.state.on, 'CONTROL: reader mode stays on without the frame').toBe(true);
    return { view, places };
  }
  const tapExit = (): void => {
    const exit = screen.getByRole('button', { name: READER_MODE_TEXT.exit });
    act(() => { exit.focus(); });
    expect(document.activeElement, 'CONTROL: the Exit holds focus before the tap').toBe(exit);
    act(() => { exit.click(); });
  };

  // X6 follow-up, review 4052 F1: this case first pinned focus ON the stand-in action. The real head draws its action only while
  // reader mode is offered, from React's state, one commit behind the controller, so an action on the page with no frame standing
  // is one the next commit takes away (a fall back after entering: `reader-mode-mount.test.tsx`, the real head). Wave 62 (review
  // 4092 F2) deleted the head-action answer of the exit's focus, which that offer made unreachable: an exit with no frame standing
  // focuses the main region, and the stand-in action stays drawn, as a stale one would be.
  it('no frame: a head Reader mode action still on the page is not taken; an exit with no frame standing focuses the main region (review 4052 F1, review 4092 F2)', async () => {
    await onWithoutFrame(true);
    const action = screen.getByRole('button', { name: READER_MODE_TEXT.enter, hidden: true });
    tapExit();
    expect(latest.state.on, 'the Exit did not leave reader mode').toBe(false);
    expect(hiddenUp(action), 'CONTROL: the head is back on screen').toBe(false);
    expect(action.isConnected, 'CONTROL: the stand-in action is still drawn').toBe(true);
    expect(latest.offered, 'CONTROL: reader mode is not offered with no frame').toBe(false);
    expect(document.activeElement, 'focus went to a head action the controller does not offer').not.toBe(action);
    expect(document.activeElement, 'focus did not go to the main region').toBe(document.getElementById('content'));
  });

  it('no frame: the Exit\'s tap puts focus on the main region when the head draws no Reader mode action', async () => {
    await onWithoutFrame();
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.enter, hidden: true }), 'CONTROL: no head action stands').toBeNull();
    tapExit();
    expect(latest.state.on, 'the Exit did not leave reader mode').toBe(false);
    expect(document.activeElement, 'focus did not go to the main region').toBe(document.getElementById('content'));
  });

  it('no frame: a frame that arrives after the Exit is not given focus, and focus stays where the Exit put it', async () => {
    const { view, places } = await onWithoutFrame();
    tapExit();
    const main = document.getElementById('content');
    expect(document.activeElement, 'CONTROL: focus is on the main region').toBe(main);
    const later = fakeFrame();
    view.rerender(<CtxHarness frame={later} places={places} />);
    await flush();
    await settle();
    expect(latest.frame, 'CONTROL: the later frame is the context\'s').toBe(later);
    expect(later.focus, 'a frame that arrived after the exit was given focus').not.toHaveBeenCalled();
    expect(later.setReading, 'the later frame was told to read').not.toHaveBeenCalled();
    expect(document.activeElement, 'focus moved when the frame arrived').toBe(main);
  });

  it('no frame: an exit with a frame standing still focuses the frame, and leaves the head and the main region alone', async () => {
    installFullScreen();
    const frame = fakeFrame();
    render(<CtxHarness frame={frame} places={fakePlaces()} head />);
    act(() => { latest.enter('button'); });
    await flush();
    frame.focus.mockClear();
    act(() => { latest.exit('exit-tap'); });
    expect(latest.state.on).toBe(false);
    expect(frame.focus, 'the exit did not focus the frame').toHaveBeenCalledTimes(1);
    expect(document.activeElement, 'focus went to the head or the main region').toBe(document.body);
  });

  it('no frame: a dropped frame\'s dismiss while reader mode stays on moves focus nowhere', async () => {
    installFullScreen();
    const places = fakePlaces();
    const view = render(<CtxHarness frame={fakeFrame()} places={places} head />);
    act(() => { latest.enter('button'); });
    await flush();
    act(() => { latest.menu(); });
    await flush();
    expect(latest.state.on && latest.state.overlay, 'CONTROL: the overlay is shown').toBe(true);
    view.rerender(<CtxHarness frame={null} places={places} head />);
    await flush();
    expect(latest.state.on, 'reader mode ended with the frame').toBe(true);
    expect(screen.getByRole('button', { name: READER_MODE_TEXT.exit }), 'CONTROL: the frameless Exit is drawn').toBeTruthy();
    expect(document.activeElement, 'focus was moved to the head or the main region').toBe(document.body);
  });
});

describe('reader mode: a block exit leaves focus where the cover put it (wave 62, review 4092 F1)', () => {
  /** The app's order (`app.tsx`): the sign-in cover is a preceding sibling of the shell, mounted while sign-in is lost, and the
   *  shell (here the reading container's harness) stays mounted under it. The cover's passphrase field takes focus at its commit
   *  (`autoFocus`); the hook's block runs in a passive effect after it. */
  function Covered(p: { frame: ReaderModeFrame | null; places: ReaderModePlaces }): ReactNode {
    const { lost } = useAuthLost();
    return <>{lost && <LoginScreen />}<CtxHarness frame={p.frame} places={p.places} /></>;
  }
  /** Enters with a frame whose focus really moves the document's focus (to the host), and drops the frame when `frameless`. */
  async function enterCovered(frameless: boolean): Promise<{ places: ReturnType<typeof fakePlaces>; host: HTMLElement }> {
    // The cover reads the box's sign-in status once; held unanswered, so nothing clears the loss under the case.
    vi.stubGlobal('fetch', vi.fn(() => new Promise<never>(() => undefined)));
    installFullScreen();
    const places = fakePlaces();
    const frame = fakeFrame();
    const view = render(<Covered frame={frame} places={places} />);
    const host = screen.getByTestId('host');
    host.tabIndex = -1;
    frame.focus.mockImplementation(() => { host.focus(); });
    act(() => { latest.enter('button'); });
    await flush();
    expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
    expect(document.activeElement, 'CONTROL: entering gave the frame focus').toBe(host);
    if (frameless) {
      view.rerender(<Covered frame={null} places={places} />);
      await flush();
      expect(latest.state.on, 'CONTROL: reader mode stays on without the frame').toBe(true);
    }
    return { places, host };
  }
  afterEach(() => { vi.unstubAllGlobals(); });

  it('block: the sign-in cover mounting over reader mode with a frame standing keeps focus on its passphrase field', async () => {
    const { places, host } = await enterCovered(false);
    await act(async () => { raiseAuthLost('expired'); });
    await flush();
    const field = document.getElementById('ccrc-passphrase');
    expect(field, 'CONTROL: the sign-in cover is drawn').not.toBeNull();
    expect(latest.state.on, 'the sign-in cover did not end reader mode').toBe(false);
    expect(places.stepBack, 'CONTROL: a block steps back over its place once').toHaveBeenCalledTimes(1);
    expect(document.activeElement, 'the block exit took focus from the passphrase field (to the frame)').not.toBe(host);
    expect(document.activeElement, 'the passphrase field lost focus').toBe(field);
  });

  it('block: the sign-in cover mounting over reader mode with no frame standing keeps focus on its passphrase field', async () => {
    await enterCovered(true);
    await act(async () => { raiseAuthLost('expired'); });
    await flush();
    const field = document.getElementById('ccrc-passphrase');
    expect(field, 'CONTROL: the sign-in cover is drawn').not.toBeNull();
    expect(latest.state.on, 'the sign-in cover did not end reader mode').toBe(false);
    expect(document.activeElement, 'the block exit took focus from the passphrase field (to the main region)').not.toBe(document.getElementById('content'));
    expect(document.activeElement, 'the passphrase field lost focus').toBe(field);
  });
});

describe('reader mode: a re-entry while its exit is still landing (wave 62, ticket x6-fu-reentry-flag)', () => {
  /** A places port whose step back steps over one entry (or none, `steps: 0`); `land` delivers the step's landing as the dispatcher
   *  does (`exitReader` while off). */
  function landingPlaces(steps = 1): PlacesFake {
    const p = fakePlaces();
    p.stepBack.mockImplementation(() => steps);
    return p;
  }

  it('reader mode: after an exit that stepped back, a re-entry is refused until that step lands, then offered again', async () => {
    const places = landingPlaces();
    setup({ places });
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'CONTROL: entered').toBe(true);
    act(() => { latest.exit('exit-tap'); });
    expect(places.stepBack, 'CONTROL: the exit stepped back').toHaveBeenCalledTimes(1);
    expect(latest.offered, 'reader mode is offered while the exit\'s step back is on its way').toBe(false);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'a re-entry before the landing was taken').toBe(false);
    expect(places.push, 'a re-entry before the landing pushed a reader place').toHaveBeenCalledTimes(1);
    // The dispatcher reports the step's landing: a crossing landing while reader mode is off.
    act(() => { places.land(); });
    expect(latest.offered, 'the landing did not end the wait').toBe(true);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'the re-entry after the landing was refused').toBe(true);
    expect(places.push).toHaveBeenCalledTimes(2);
  });

  it('reader mode: a step back whose landing never comes holds the entry for at most READER_EXIT_LANDING_MS', async () => {
    vi.useFakeTimers();
    const places = landingPlaces();
    setup({ places });
    act(() => { latest.enter('button'); });
    act(() => { latest.exit('exit-tap'); });
    expect(latest.offered, 'CONTROL: the wait stands').toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_EXIT_LANDING_MS - 1); });
    expect(latest.offered, 'the wait ended before its bound').toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(latest.offered, 'the wait outlived its bound').toBe(true);
    act(() => { latest.enter('key'); });
    expect(latest.state.on, 'an entry after the bound was refused').toBe(true);
  });

  it('reader mode: a wait armed before StrictMode\'s simulated remount (the reload check\'s step) is still bounded after it', async () => {
    vi.useFakeTimers();
    installFullScreen();
    const places = landingPlaces();
    let dead = true;
    places.standingOnDead = () => { const d = dead; dead = false; return d; };
    render(<StrictMode><Harness frame={fakeFrame()} places={places} /></StrictMode>);
    await flush();
    expect(places.stepBack, 'CONTROL: the reload check stepped below the dead entry').toHaveBeenCalledTimes(1);
    expect(latest.offered, 'CONTROL: the wait stands').toBe(false);
    await act(async () => { await vi.advanceTimersByTimeAsync(READER_EXIT_LANDING_MS); });
    expect(latest.offered, 'the remount left the wait with no bound').toBe(true);
  });

  it('reader mode: an exit that stepped over nothing (an unplaced entry, or a step of no entries) holds no re-entry', () => {
    const places = landingPlaces(0);
    setup({ places });
    act(() => { latest.enter('button'); });
    act(() => { latest.exit('exit-tap'); });
    expect(latest.offered, 'a step of no entries held the entry').toBe(true);
    act(() => { latest.enter('button'); });
    expect(latest.state.on).toBe(true);
  });

  it('reader mode: the frame\'s r is refused too while the step is landing, and the screen leaving clears the bound\'s timer', async () => {
    vi.useFakeTimers();
    const places = landingPlaces();
    const { frame, view } = setup({ places });
    const base = vi.getTimerCount();
    act(() => { latest.enter('button'); });
    act(() => { latest.exit('exit-tap'); });
    expect(vi.getTimerCount(), 'CONTROL: the wait\'s bound is armed').toBe(base + 1);
    const iframe = document.createElement('iframe');
    screen.getByTestId('host').appendChild(iframe);
    frame.focus.mockImplementation(() => { iframe.focus(); });
    act(() => { iframe.focus(); });
    expect(document.activeElement, 'CONTROL: the frame holds focus').toBe(iframe);
    act(() => { latest.frameToggle(); });
    expect(latest.state.on, 'the frame\'s r entered while the step was landing').toBe(false);
    // Another exit's wait, then the screen leaving with it armed.
    act(() => { places.land(); });
    act(() => { iframe.focus(); });
    act(() => { latest.frameToggle(); });
    expect(latest.state.on, 'CONTROL: the frame\'s r enters once the step has landed').toBe(true);
    act(() => { latest.exit('exit-tap'); });
    expect(vi.getTimerCount(), 'CONTROL: the second wait\'s bound is armed').toBe(base + 1);
    view.unmount();
    expect(vi.getTimerCount(), 'the wait\'s bound outlived the screen').toBe(base);
  });
});

describe('wake lock: a refusal is remembered (X6 XR fix round 1, item 5)', () => {
  it('wake lock: a refused request is not asked again by activity, but by the page visible again and by a fresh entry', async () => {
    const wake = installWakeLock(true);
    const fire = installVisibility();
    const { places } = setup();
    act(() => { latest.enter('button'); });
    await settle();
    expect(wake.request, 'entering asks once').toHaveBeenCalledTimes(1);
    for (let i = 0; i < 4; i += 1) {
      act(() => { latest.activity(); });
      await settle();
    }
    expect(wake.request, 'activity asked again after the refusal').toHaveBeenCalledTimes(1);
    // The page is hidden and visible again: the next ask is made once (and refused again).
    await act(async () => { fire('hidden'); });
    await act(async () => { fire('visible'); });
    await settle();
    expect(wake.request, 'the page visible again did not ask once more').toHaveBeenCalledTimes(2);
    act(() => { latest.activity(); });
    await settle();
    expect(wake.request, 'activity asked again after the second refusal').toHaveBeenCalledTimes(2);
    // A fresh entry into reader mode asks once more (after the exit's step back has landed, wave 62).
    act(() => { latest.exit('exit-tap'); });
    act(() => { places.land(); });
    await settle();
    act(() => { latest.enter('button'); });
    await settle();
    expect(wake.request, 'a fresh entry did not ask once more').toHaveBeenCalledTimes(3);
    act(() => { latest.activity(); });
    await settle();
    expect(wake.request, 'activity after the fresh entry\'s refusal asked again').toHaveBeenCalledTimes(3);
    expect(latest.state.on, 'a refused lock ended reader mode').toBe(true);
  });

  /** A wake lock whose requests stay pending until the test settles them, one by one. */
  function installPendingWakeLock(): { request: ReturnType<typeof vi.fn>; refuse(n: number): void } {
    const pending: Array<{ rej(e: unknown): void }> = [];
    const request = vi.fn(() => new Promise<unknown>((_res, rej) => { pending.push({ rej }); }));
    defineOwn(navigator, 'wakeLock', { value: { request } });
    return { request, refuse: (n) => pending[n]!.rej(new Error('NotAllowedError')) };
  }

  it('wake lock: a request that rejects late does not mark the new period refused (the page visible again meanwhile) (review M3)', async () => {
    const wake = installPendingWakeLock();
    const fire = installVisibility();
    setup();
    act(() => { latest.enter('button'); });
    await settle();
    expect(wake.request, 'entering asks once').toHaveBeenCalledTimes(1);
    await act(async () => { fire('hidden'); });
    await act(async () => { fire('visible'); });
    await settle();
    // The first request is still pending, so the visible page waits for it; it is refused late, after the period it asked in.
    await act(async () => { wake.refuse(0); });
    await settle();
    expect(wake.request, 'the late refusal of the old period blocked the new one').toHaveBeenCalledTimes(2);
  });

  it('wake lock: a request that rejects late does not mark a fresh entry refused (exit and enter meanwhile) (review M3)', async () => {
    const wake = installPendingWakeLock();
    const { places } = setup();
    act(() => { latest.enter('button'); });
    await settle();
    act(() => { latest.exit('exit-tap'); });
    act(() => { places.land(); });   // the exit's step back lands (wave 62: a re-entry waits for it)
    act(() => { latest.enter('button'); });
    await settle();
    await act(async () => { wake.refuse(0); });
    await settle();
    expect(wake.request, 'the late refusal of the old entry blocked the new one').toHaveBeenCalledTimes(2);
  });
});
