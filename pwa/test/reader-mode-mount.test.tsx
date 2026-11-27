// Reader mode's mount layer (X6 XR1.4 with XR2.1 folded in, D-8975, D-8805): `docs/reader/bridge.ts`'s `ReaderMount.setReading`,
// `ReaderMount.focus`, the `onReader` adapter and `onProgress` on every production mount, and `policy.ts#readerMountAsks`'s
// `progress`, `reading` and `reader` words. jsdom, through the bridge's real mount path with an injected `mount` spy: the library
// itself is not run (its `setReading` queue and replay are the library's own, measured at Step 0 of XR1.1). Every page is a
// placeholder.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import type { RenderInput } from '@synapsium-labs/pinax-lib/frame';
import type { DocFrame, HostAdapters, mountDocFrame } from '@synapsium-labs/pinax-lib/host';
import type { DocsPageLocation } from '../../shared/docs';
import { mountReader, type ReaderMount, type ReaderMountInput } from '../src/docs/reader/bridge';
import { readerMountAsks, type ReaderChrome } from '../src/docs/reader/policy';
import { ReaderFrame, type ReaderDeps } from '../src/docs/ReaderFrame';
import { DocsReading } from '../src/docs/DocsReading';
import { readerModeHandle, setReaderModeHandle } from '../src/docs/readerModeHandle';
import { ReaderBarContext, type ReaderBar } from '../src/docs/readerBar';
import {
  ReaderModeContext, useReaderMode, type ReaderModeContextValue, type ReaderModePlaces,
} from '../src/docs/useReaderMode';
import { READER_WAKE_IDLE_MS, readerModeDocKey } from '../src/docs/reader/readerMode';
import type { DocLinkContextValue } from '../src/docs/DocLink';
import type { ReaderRenderOutcome } from '../src/lib/readerRenderJob';
import { parseMarkdown } from '../src/lib/markdownParse';
import { fileResponse, treeOk } from './docsFixtures';

// The visit's places are the history half's (reader-places.test.ts); here only what `ReaderFrame` hands them is read.
const placesFake = vi.hoisted(() => ({ onPlace: vi.fn(), onHash: vi.fn(), host: vi.fn(), end: vi.fn() }));
vi.mock('../src/docs/reader/places', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/docs/reader/places')>();
  return { ...orig, startPlaces: () => placesFake };
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const STUB_ASSETS = { guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' };

type Reading = 'screens' | 'scroll' | 'off';

interface FakeFrame {
  readonly n: number;
  readonly setReading: ReturnType<typeof vi.fn>;
  readonly destroy: ReturnType<typeof vi.fn>;
  readonly setPrefs: ReturnType<typeof vi.fn>;
  readonly setAppearance: ReturnType<typeof vi.fn>;
  readonly command: ReturnType<typeof vi.fn>;
  readonly closeOverlay: ReturnType<typeof vi.fn>;
  readonly goto: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
  readonly iframe: HTMLIFrameElement;
}

interface Rig {
  readonly input: ReaderMountInput;
  readonly frames: FakeFrame[];
  readonly mount: ReturnType<typeof vi.fn>;
  /** One entry per library event, in the order they happened: `mount 0`, `setReading 0 screens`, `ready 0`, `destroy 0`... */
  readonly order: string[];
  readonly adaptersAt: (n: number) => HostAdapters;
  /** The nth frame's `ready`, as the library would call the adapter the mount was given. */
  readonly ready: (n: number) => void;
  readonly el: HTMLElement;
  readonly run: () => ReturnType<typeof mountReader>;
}

/** A rig: an injected `mount` spy whose frame has `setReading`, an iframe element inside `el` for `focus`, and an order log. */
function rig(o: {
  reading?: Reading; chrome?: ReaderChrome; profile?: 'lab-draw'; onProgress?: (share: number) => void;
  onReader?: ReaderMountInput['onReader']; throwOnSetReading?: boolean;
} = {}): Rig {
  const order: string[] = [];
  const frames: FakeFrame[] = [];
  const el = document.createElement('div');
  document.body.append(el);
  const mount = vi.fn((target: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => {
    const n = frames.length;
    order.push(`mount ${n}`);
    const iframe = target.ownerDocument.createElement('iframe');
    target.replaceChildren(iframe);
    const f: FakeFrame = {
      n, iframe,
      setReading: vi.fn((mode: string) => {
        order.push(`setReading ${n} ${mode}`);
        if (o.throwOnSetReading) throw new TypeError('the frame refused');
      }),
      destroy: vi.fn(() => { order.push(`destroy ${n}`); }),
      setPrefs: vi.fn(), setAppearance: vi.fn(), command: vi.fn(), closeOverlay: vi.fn(), goto: vi.fn(), update: vi.fn(),
    };
    frames.push(f);
    return f as unknown as DocFrame;
  });
  const input: ReaderMountInput = {
    document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } },
    bytes: 100,
    docKey: 'demo:sec:a/b.md',
    title: 'b.md',
    prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    ...(o.reading === undefined ? {} : { reading: o.reading }),
    ...(o.chrome === undefined ? {} : { chrome: o.chrome }),
    ...(o.profile === undefined ? {} : { profile: o.profile }),
    ...(o.onProgress === undefined ? {} : { onProgress: o.onProgress }),
    ...(o.onReader === undefined ? {} : { onReader: o.onReader }),
  };
  const run = () => mountReader(el, input, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => null,
    assets: () => Promise.resolve(STUB_ASSETS),
    mermaid: () => Promise.resolve('MERMAID'),
    e17: 'does-not-hold',
  });
  const adaptersAt = (n: number): HostAdapters => (mount.mock.calls[n]![1] as { adapters: HostAdapters }).adapters;
  return {
    input, frames, mount, order, el, run, adaptersAt,
    ready: (n) => { order.push(`ready ${n}`); adaptersAt(n).onReady!(); },
  };
}

describe('reader mode: the mount plan', () => {
  it('every production mount asks for progress, the lab\'s does not', async () => {
    for (const chrome of ['frame-bar', 'host-bar', undefined] as const) {
      const onProgress = vi.fn();
      const r = rig({ ...(chrome === undefined ? {} : { chrome }), onProgress });
      await r.run();
      const a = r.adaptersAt(0);
      expect(a.onProgress).toBeTypeOf('function');
      a.onProgress!(0.25);
      expect(onProgress).toHaveBeenCalledWith(0.25);
      // The frame's own bar is turned off only on ccrc's bar: a frame-bar mount asks for progress and keeps its bar.
      expect('features' in a).toBe(chrome === 'host-bar');
    }
    const lab = rig({ profile: 'lab-draw', chrome: 'host-bar', onProgress: vi.fn() });
    await lab.run();
    expect(Object.keys(lab.adaptersAt(0))).not.toContain('onProgress');
    // The policy says it, not only the bridge.
    expect(readerMountAsks(undefined).progress).toBe(true);
    expect(readerMountAsks('lab-draw').progress).toBe(false);
    // A mount whose input has no listener asks for none, except on ccrc's bar, which always did; a share there with no
    // listener on the input is dropped, never thrown. (The reader's body always listens: ReaderFrame passes onProgress.)
    const none = rig();
    await none.run();
    expect(Object.keys(none.adaptersAt(0))).not.toContain('onProgress');
    const bar = rig({ chrome: 'host-bar' });
    await bar.run();
    expect(() => bar.adaptersAt(0).onProgress!(1)).not.toThrow();
  });

  it('mount plan: a mount made while reader mode is on is sent setReading with the turn before its ready', async () => {
    for (const reading of ['screens', 'scroll'] as const) {
      const r = rig({ reading });
      await r.run();
      expect(r.frames[0]!.setReading).toHaveBeenCalledTimes(1);
      expect(r.frames[0]!.setReading).toHaveBeenCalledWith(reading);
      r.ready(0);
      expect(r.order).toEqual(['mount 0', `setReading 0 ${reading}`, 'ready 0']);
      document.body.replaceChildren();
    }
    // Off, or no reading at all: a fresh mount is off, so nothing is sent.
    for (const reading of ['off', undefined] as const) {
      const r = rig(reading === undefined ? {} : { reading });
      await r.run();
      r.ready(0);
      expect(r.frames[0]!.setReading).not.toHaveBeenCalled();
      document.body.replaceChildren();
    }
    // The lab asks for none of it, whatever reading its input carried.
    const lab = rig({ profile: 'lab-draw', reading: 'screens' });
    await lab.run();
    expect(lab.frames[0]!.setReading).not.toHaveBeenCalled();
    expect(readerMountAsks(undefined, { reading: 'scroll' }).reading).toBe('scroll');
    expect(readerMountAsks(undefined).reading).toBe('off');
    expect(readerMountAsks('lab-draw', { reading: 'scroll' }).reading).toBe('off');
  });

  it('reader mode: leaving after a same-document remount sends off to the new mount, never to the destroyed one', async () => {
    const r = rig({ reading: 'scroll' });
    const m = await r.run();
    r.ready(0);
    m.openAt!('x');
    expect(r.mount).toHaveBeenCalledTimes(2);
    const [first, second] = r.frames as [FakeFrame, FakeFrame];
    // The remount is a new DocFrame, which the library replays nothing into: it is sent the turn before its ready.
    expect(r.order).toEqual(['mount 0', 'setReading 0 scroll', 'ready 0', 'destroy 0', 'mount 1', 'setReading 1 scroll']);
    r.ready(1);
    m.setReading!('off');
    expect(second.setReading).toHaveBeenLastCalledWith('off');
    expect(first.setReading).toHaveBeenCalledTimes(1);
    expect(r.order.slice(r.order.indexOf('destroy 0'))).not.toContain('setReading 0 off');
    // A turn chosen while on goes to the new mount too, and a remount after it carries the latest.
    m.setReading!('screens');
    m.openAt!('y');
    expect(r.frames[2]!.setReading).toHaveBeenCalledTimes(1);
    expect(r.frames[2]!.setReading).toHaveBeenCalledWith('screens');
    expect(r.order.at(-1)).toBe('setReading 2 screens');
    // And once left (`off`), a remount sends nothing: a fresh mount is off.
    m.setReading!('off');
    m.openAt!('z');
    expect(r.frames[3]!.setReading).not.toHaveBeenCalled();
  });
});

describe('reader mode: reader ops at the mount', () => {
  it('reader ops: entering sends setReading with the stored turn and remounts nothing', async () => {
    const r = rig();
    const m = await r.run();
    r.ready(0);
    m.setReading!('screens');
    expect(r.frames[0]!.setReading).toHaveBeenCalledTimes(1);
    expect(r.frames[0]!.setReading).toHaveBeenCalledWith('screens');
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(r.frames[0]!.destroy).not.toHaveBeenCalled();
    m.setReading!('scroll');
    expect(r.frames[0]!.setReading).toHaveBeenLastCalledWith('scroll');
    expect(r.mount).toHaveBeenCalledTimes(1);
    // Before the frame's ready it is neither held here nor dropped: the library queues it, the latest winning, and replays it.
    const early = rig();
    const em = await early.run();
    em.setReading!('screens');
    expect(early.frames[0]!.setReading).toHaveBeenCalledWith('screens');
    // Nothing after destroy.
    m.destroy();
    m.setReading!('off');
    expect(r.frames[0]!.setReading).toHaveBeenCalledTimes(2);
  });

  it('reader ops: a frame that refuses setReading is warned about and ignored', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig({ throwOnSetReading: true });
    const m = await r.run();
    expect(() => m.setReading!('screens')).not.toThrow();
    expect(warn).toHaveBeenCalled();
    // A refusing frame at a mount's own send is the same.
    const at = rig({ reading: 'scroll', throwOnSetReading: true });
    await expect(at.run()).resolves.toBeDefined();
  });

  it('reader ops: the frame\'s reader acts reach onReader as they came, and only a Docs mount asks for them', async () => {
    const onReader = vi.fn();
    const docs = rig({ onReader });
    await docs.run();
    const a = docs.adaptersAt(0);
    expect(a.onReader).toBeTypeOf('function');
    for (const act of ['menu', 'exit', 'toggle', 'active'] as const) a.onReader!(act);
    expect(onReader.mock.calls).toEqual([['menu'], ['exit'], ['toggle'], ['active']]);
    // On every Docs mount, a remount's included.
    const m = await docs.run();
    m.openAt!('x');
    docs.adaptersAt(2).onReader!('exit');
    expect(onReader).toHaveBeenLastCalledWith('exit');
    // The lab passes none: the library sends `reader` acts only to a host that gave it.
    const lab = rig({ profile: 'lab-draw', onReader: vi.fn() });
    await lab.run();
    expect(Object.keys(lab.adaptersAt(0))).not.toContain('onReader');
    // A Docs mount whose input has none passes none.
    const bare = rig();
    await bare.run();
    expect(Object.keys(bare.adaptersAt(0))).not.toContain('onReader');
    expect(readerMountAsks(undefined).reader).toBe(true);
    expect(readerMountAsks('lab-draw').reader).toBe(false);
  });

  it('focus: ReaderMount.focus focuses the frame\'s iframe, blurring it first when it is already active', async () => {
    const r = rig();
    const m = await r.run();
    const frame = r.frames[0]!.iframe;
    const calls: string[] = [];
    const focus = frame.focus.bind(frame);
    const blur = frame.blur.bind(frame);
    vi.spyOn(frame, 'focus').mockImplementation(() => { calls.push('focus'); focus(); });
    vi.spyOn(frame, 'blur').mockImplementation(() => { calls.push('blur'); blur(); });
    frame.setAttribute('tabindex', '-1');
    // Not active: a plain focus.
    m.focus!();
    expect(calls).toEqual(['focus']);
    expect(document.activeElement).toBe(frame);
    // Already active: a second focus() on it would be a no-op, so it is blurred first.
    m.focus!();
    expect(calls).toEqual(['focus', 'blur', 'focus']);
    expect(document.activeElement).toBe(frame);
    // After a same-document remount it is the new frame's iframe.
    m.openAt!('x');
    const next = r.frames[1]!.iframe;
    const nextFocus = vi.spyOn(next, 'focus');
    m.focus!();
    expect(nextFocus).toHaveBeenCalledTimes(1);
    expect(r.frames[0]!.iframe.isConnected).toBe(false);
    // Nothing after destroy.
    m.destroy();
    m.focus!();
    expect(nextFocus).toHaveBeenCalledTimes(1);
  });
});

// ─── the frame wiring: `ReaderFrame` and the hook's context (X6 XR1.4 with XR2.1) ───────────────────────────────────────────
//
// Through the real `ReaderFrame` body with an injected `reader.mount` that hands back a fake `ReaderMount` and keeps the input's
// callbacks, inside the real hook (`useReaderMode`) and its container. The mount's real bridge is the describes' above.

const LINK: Omit<DocLinkContextValue, 'urls'> = {
  project: 'demo', pageRef: null, pageAt: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
  pageSource: 'committed', onFragment: () => undefined,
};
const RENDERED: ReaderRenderOutcome = {
  kind: 'rendered',
  result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null, headings: [], figures: 0, mermaidKinds: [] } },
  mermaid: { fences: 0, largestBytes: 0, totalBytes: 0, largestChars: 0, totalChars: 0 },
  images: [],
  imagesTruncated: false,
};
const pageOf = (path: string): DocsPageLocation => (
  { kind: 'path', project: 'demo', section: 'specs', path, dirSlash: false, ref: null } as unknown as DocsPageLocation
);
/** The Docs screen's own key for the two documents the cases use (`readerModeDocKey`, as `DocsScreen` computes it). */
const KEY_A = readerModeDocKey(pageOf('a.md'), null)!;
const KEY_B = readerModeDocKey(pageOf('b.md'), null)!;

interface BodyMount {
  readonly n: number;
  readonly iframe: HTMLIFrameElement;
  readonly setReading: Mock<(mode: string) => void>;
  readonly focus: Mock<() => void>;
  readonly destroy: Mock<() => void>;
  readonly command: Mock<(name: string) => void>;
  readonly openAt: Mock<(id: string) => void>;
}

interface BodyRig {
  readonly reader: ReaderDeps;
  readonly inputs: ReaderMountInput[];
  readonly mounts: BodyMount[];
  /** Every mount call in order: `mount 0`, `setReading 0 screens`, `focus 0`, `destroy 0`... */
  readonly log: string[];
}

function bodyRig(): BodyRig {
  const inputs: ReaderMountInput[] = [];
  const mounts: BodyMount[] = [];
  const log: string[] = [];
  const reader: ReaderDeps = {
    render: async () => RENDERED,
    images: async () => ({ urls: {}, drafts: 0, auth: 0 }),
    mount: async (el, input) => {
      const n = mounts.length;
      inputs.push(input);
      log.push(`mount ${n}`);
      const iframe = el.ownerDocument.createElement('iframe');
      iframe.setAttribute('tabindex', '-1');
      el.replaceChildren(iframe);
      const m: BodyMount = {
        n, iframe,
        setReading: vi.fn((mode: string) => { log.push(`setReading ${n} ${mode}`); }),
        focus: vi.fn(() => { log.push(`focus ${n}`); }),
        destroy: vi.fn(() => { log.push(`destroy ${n}`); }),
        command: vi.fn(),
        openAt: vi.fn(),
      };
      mounts.push(m);
      return { seed: { hosted: false }, follow: vi.fn(), setPrefs: vi.fn(), ...m } as unknown as ReaderMount;
    },
  };
  return { reader, inputs, mounts, log };
}

function placesPort(): ReaderModePlaces & { push: Mock<() => boolean>; stepBack: Mock<() => number> } {
  return {
    placeFree: () => true,
    push: vi.fn(() => true),
    stepBack: vi.fn(() => 1),
    landedBelow: () => false,
    markExitPending: vi.fn(),
    register: () => () => undefined,
    standingOnDead: () => false,
  };
}

let latest: ReaderModeContextValue;
const parser = async () => parseMarkdown('# Formatted', 'docs');

/** One body of `a.md` (or `path`), keyed so a new key is a new body, as a new commit's `bodyKey` is. */
function bodyOf(rig: BodyRig, bodyKey: string, path = 'a.md'): ReactNode {
  return (
    <ReaderFrame
      key={bodyKey} show={{ ...fileResponse('# A').show, path }} bodyKey={bodyKey} link={LINK} parser={parser}
      reader={rig.reader} pendingFragment={null} onFragmentConsumed={() => undefined}
    />
  );
}

/** The Docs screen's part of reader mode: the hook, its container and its context around one body. */
function Screen(p: { doc: string | null; rig: BodyRig; bodyKey: string; path?: string; places: ReaderModePlaces }): ReactNode {
  const { value, container, controls } = useReaderMode({ doc: p.doc, plainView: false, places: p.places });
  latest = value;
  // The outside door, as `DocsScreen` sets it (`r` and the palette read it).
  useEffect(() => {
    setReaderModeHandle(controls);
    return () => setReaderModeHandle(null);
  }, [controls]);
  return (
    <ReaderModeContext value={value}>
      <DocsReading reading={container}>{bodyOf(p.rig, p.bodyKey, p.path)}</DocsReading>
    </ReaderModeContext>
  );
}

/** Lets the body's run reach its mount and go on past it. */
const flush = async (): Promise<void> => {
  await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
};
const advance = (ms: number): Promise<void> => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
/** The nth mount's frame reports ready. */
const frameReady = (rig: BodyRig, n: number): Promise<void> => act(async () => { rig.inputs[n]!.onReady(); });

const restorers: Array<() => void> = [];
function defineOwn(target: object, key: string, descriptor: PropertyDescriptor): void {
  const before = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  restorers.push(() => {
    if (before === undefined) Reflect.deleteProperty(target, key);
    else Object.defineProperty(target, key, before);
  });
}
interface WakeFake { readonly request: Mock<() => Promise<unknown>>; readonly sentinels: Array<{ release: Mock<() => Promise<void>> }> }
function installWakeLock(): WakeFake {
  const sentinels: WakeFake['sentinels'] = [];
  const request = vi.fn(async (): Promise<unknown> => {
    const s = { release: vi.fn(async () => undefined), addEventListener: vi.fn(), removeEventListener: vi.fn() };
    sentinels.push(s);
    return s;
  });
  defineOwn(navigator, 'wakeLock', { value: { request } });
  return { request, sentinels };
}

/** A screen with one body, reader mode entered on its ready frame: the rig, the places port and the wake lock fake. */
async function entered(over: { timers?: boolean } = {}): Promise<{
  rig: BodyRig; places: ReturnType<typeof placesPort>; wake: WakeFake; view: ReturnType<typeof render>;
}> {
  if (over.timers === true) vi.useFakeTimers();
  const wake = installWakeLock();
  const rig = bodyRig();
  const places = placesPort();
  const view = render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
  await flush();
  await frameReady(rig, 0);
  act(() => { latest.enter('button'); });
  if (over.timers === true) await advance(0);
  else await flush();
  return { rig, places, wake, view };
}

describe('reader mode: the frame wiring (X6 XR1.4 with XR2.1)', () => {
  beforeEach(() => {
    for (const f of Object.values(placesFake)) f.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();   // the turn is the device's remembered choice: no case inherits another's
    while (restorers.length > 0) restorers.pop()?.();
  });

  it('progress: every Docs body\'s mount listens for progress, on either bar', async () => {
    for (const chrome of ['frame-bar', 'host-bar', null] as const) {
      const rig = bodyRig();
      const published: Array<ReaderBar | null> = [];
      const view = render(
        chrome === null
          ? bodyOf(rig, 'k1')
          : <ReaderBarContext value={{ chrome, publish: (b) => published.push(b) }}>{bodyOf(rig, 'k1')}</ReaderBarContext>,
      );
      await flush();
      const input = rig.inputs[0]!;
      expect(input.onProgress, `a body on ${String(chrome)} asks for progress`).toBeTypeOf('function');
      expect(input.onReader, `a body on ${String(chrome)} asks for the reader acts`).toBeTypeOf('function');
      await frameReady(rig, 0);
      expect(() => input.onProgress!(0.5)).not.toThrow();
      // Only ccrc's own bar publishes a handle, and its progress is the one the frame reported.
      const bar = published.filter((b): b is ReaderBar => b !== null).at(-1);
      if (chrome === 'host-bar') expect(bar?.progress.read()).toBe(0.5);
      else expect(bar).toBeUndefined();
      view.unmount();
    }
  });

  it('wake lock: a progress message counts as activity', async () => {
    const { rig, wake } = await entered({ timers: true });
    expect(wake.request).toHaveBeenCalledTimes(1);
    await advance(299000);
    act(() => { rig.inputs[0]!.onProgress!(0.3); });
    await advance(1000);
    expect(wake.sentinels[0]!.release, 'released at 300 s although a new share came at 299 s').not.toHaveBeenCalled();
    await advance(298000);
    expect(wake.sentinels[0]!.release, 'released at 598 s').not.toHaveBeenCalled();
    await advance(1000);
    expect(wake.sentinels[0]!.release, 'not released at 599 s, 300 s after the share').toHaveBeenCalledTimes(1);
    expect(latest.state.on, 'the idle release does not end reader mode').toBe(true);
    expect(READER_WAKE_IDLE_MS).toBe(300000);
  });

  it('wake lock: a progress with the same share counts for nothing', async () => {
    const { rig, wake } = await entered({ timers: true });
    for (let s = 0; s < 299; s += 1) {
      act(() => { rig.inputs[0]!.onProgress!(0.4); });
      await advance(1000);
    }
    expect(wake.sentinels[0]!.release, 'released early').not.toHaveBeenCalled();
    act(() => { rig.inputs[0]!.onProgress!(0.4); });
    await advance(1000);
    expect(wake.sentinels[0]!.release, 'a resent share kept the lock past 300 s').toHaveBeenCalledTimes(1);
  });

  it('wake lock: a figure\'s full screen opening and closing each count as activity', async () => {
    const { rig, wake } = await entered({ timers: true });
    await advance(200000);
    act(() => { rig.inputs[0]!.onPlace!('overlay'); });
    // Still the places' own: the frame's report reaches them as before.
    expect(placesFake.onPlace).toHaveBeenCalledWith('overlay');
    await advance(150000);
    expect(wake.sentinels[0]!.release, 'the figure opening did not count (300 s after entering)').not.toHaveBeenCalled();
    await advance(50000);
    act(() => { rig.inputs[0]!.onPlace!('overlay-closed'); });
    expect(placesFake.onPlace).toHaveBeenCalledWith('overlay-closed');
    await advance(200000);
    expect(wake.sentinels[0]!.release, 'the figure closing did not count (300 s after opening)').not.toHaveBeenCalled();
    await advance(100000);
    expect(wake.sentinels[0]!.release).toHaveBeenCalledTimes(1);
  });

  it('reader ops: an active act counts as wake-lock activity and does nothing else', async () => {
    const { rig, wake, places } = await entered({ timers: true });
    const before = { state: latest.state, readings: rig.mounts[0]!.setReading.mock.calls.length, focus: rig.mounts[0]!.focus.mock.calls.length };
    await advance(200000);
    act(() => { rig.inputs[0]!.onReader!('active'); });
    await advance(250000);
    expect(wake.sentinels[0]!.release, 'an active act did not keep the lock').not.toHaveBeenCalled();
    await advance(50000);
    expect(wake.sentinels[0]!.release).toHaveBeenCalledTimes(1);
    expect(latest.state, 'an active act changed the state').toEqual(before.state);
    expect(rig.mounts[0]!.setReading.mock.calls.length).toBe(before.readings);
    expect(rig.mounts[0]!.focus.mock.calls.length).toBe(before.focus);
    expect(places.stepBack).not.toHaveBeenCalled();
  });

  it('reader ops: frame exit leaves reader mode', async () => {
    const { rig, places } = await entered();
    expect(latest.state.on).toBe(true);
    act(() => { rig.inputs[0]!.onReader!('exit'); });
    expect(latest.state.on, 'the frame\'s exit act did not leave reader mode').toBe(false);
    expect(rig.mounts[0]!.setReading).toHaveBeenLastCalledWith('off');
    expect(places.stepBack).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.docs-reading')?.getAttribute('data-reader-mode')).toBeNull();
    // A second exit is an echo: nothing more.
    act(() => { rig.inputs[0]!.onReader!('exit'); });
    expect(places.stepBack).toHaveBeenCalledTimes(1);
  });

  it('reader ops: frame toggle is refused unless the frame is ready and focused', async () => {
    const rig = bodyRig();
    const places = placesPort();
    const view = render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
    await flush();
    const iframe = rig.mounts[0]!.iframe;
    // The mount exists but its frame has not reported ready: refused, focused or not.
    iframe.focus();
    expect(document.activeElement).toBe(iframe);
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    expect(latest.state.on, 'toggled in before the frame was ready').toBe(false);
    await frameReady(rig, 0);
    // Ready, but the frame does not hold focus (something of the console does): refused.
    const other = document.createElement('button');
    document.body.append(other);
    other.focus();
    expect(document.activeElement).toBe(other);
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    expect(latest.state.on, 'toggled in without the frame\'s focus').toBe(false);
    // Ready and focused: enters, with the turn sent to the frame.
    iframe.focus();
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    expect(latest.state.on).toBe(true);
    expect(rig.mounts[0]!.setReading).toHaveBeenCalledWith('screens');
    expect(places.push).toHaveBeenCalledTimes(1);
    // On, the toggle leaves, whether or not the frame holds focus.
    other.focus();
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    expect(latest.state.on).toBe(false);
    expect(rig.mounts[0]!.setReading).toHaveBeenLastCalledWith('off');
    view.unmount();
  });

  it('reader ops: frame toggle asks for full screen only with the console\'s own activation', async () => {
    const rig = bodyRig();
    const places = placesPort();
    render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
    await flush();
    await frameReady(rig, 0);
    // The document allows full screen and the container can ask; only the activation differs between the two toggles.
    let active = false;
    defineOwn(navigator, 'userActivation', { get: () => ({ isActive: active }) });
    defineOwn(document, 'fullscreenEnabled', { value: true });
    const request = vi.fn(() => Promise.resolve());
    defineOwn(document.querySelector('.docs-reading') as HTMLElement, 'requestFullscreen', { value: request });
    const iframe = rig.mounts[0]!.iframe;
    // The frame's key is not the console's activation: without it reader mode starts, and asks for nothing.
    iframe.focus();
    expect(document.activeElement).toBe(iframe);
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    await flush();
    expect(latest.state.on, 'CONTROL: the toggle entered reader mode').toBe(true);
    expect(request, 'full screen was asked for without the console\'s own activation').not.toHaveBeenCalled();
    act(() => { latest.exit('exit-tap'); });
    await flush();
    expect(latest.state.on, 'CONTROL: reader mode ended').toBe(false);
    // With the console's own activation: one request.
    active = true;
    iframe.focus();
    expect(document.activeElement).toBe(iframe);
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    await flush();
    expect(latest.state.on).toBe(true);
    expect(request, 'full screen was not asked for with the console\'s own activation').toHaveBeenCalledTimes(1);
  });

  it('reader mode: a new body that lands in the plain view while reader mode is on ends it and consumes its place', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { rig, places, view } = await entered();
    expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
    expect(places.push).toHaveBeenCalledTimes(1);
    expect(places.stepBack).not.toHaveBeenCalled();
    // A new body of the same document whose render times out: the plain view with the timeout note, no frame to read.
    const timedOut: BodyRig = { ...rig, reader: { ...rig.reader, render: async () => ({ kind: 'timeout', budgetMs: 1000 }) } };
    view.rerender(<Screen doc={KEY_A} rig={timedOut} bodyKey="k2" places={places} />);
    await flush();
    expect(rig.mounts[0]!.destroy, 'CONTROL: the first body ended').toHaveBeenCalledTimes(1);
    expect(timedOut.mounts.length, 'CONTROL: the timed-out body mounted no frame').toBe(1);
    expect(latest.state.on, 'the plain view left reader mode on').toBe(false);
    expect(places.stepBack, 'the reader place was not consumed').toHaveBeenCalledTimes(1);
    expect(document.querySelector('.docs-reading')?.getAttribute('data-reader-mode')).toBeNull();
    expect(latest.offered, 'no frame is offered over the plain view').toBe(false);
  });

  it('reader ops: a toggle that enters ends a settle still waiting from the last exit', async () => {
    vi.useFakeTimers();
    const rig = bodyRig();
    const places = placesPort();
    render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
    await flush();
    await frameReady(rig, 0);
    const calls = (places.markExitPending as Mock<(on: boolean) => void>).mock.calls;
    act(() => { latest.enter('key'); });
    // The browser takes full screen away: the exit waits for a pop in flight (the settle timer is armed).
    act(() => { document.dispatchEvent(new Event('fullscreenchange')); });
    expect(latest.state.on).toBe(false);
    expect(places.stepBack).not.toHaveBeenCalled();
    rig.mounts[0]!.iframe.focus();
    act(() => { rig.inputs[0]!.onReader!('toggle'); });
    expect(latest.state.on).toBe(true);
    expect(calls.at(-1), 'the toggle left the old settle marked').toEqual([false]);
    await advance(500);
    expect(places.stepBack, 'the old settle stepped back the new reading\'s place').not.toHaveBeenCalled();
  });

  it('reader ops: the hook does not subscribe to the window\'s blur', async () => {
    const { rig } = await entered();
    act(() => { rig.inputs[0]!.onReader!('menu'); });
    expect(latest.state.on && latest.state.overlay, 'the menu act shows the overlay').toBe(true);
    act(() => { window.dispatchEvent(new Event('blur')); });
    expect(latest.state.on && latest.state.overlay, 'a window blur hid the overlay').toBe(true);
    expect(latest.state.on).toBe(true);
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'useReaderMode.ts'), 'utf8');
    expect(src).not.toContain('onWindowBlur');
    expect(src).not.toMatch(/addEventListener\(\s*['"]blur['"]/);
  });

  it('reader mode: a fallback after entering ends reader mode and consumes its place', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { rig, places } = await entered();
    expect(latest.state.on).toBe(true);
    expect(places.push).toHaveBeenCalledTimes(1);
    expect(places.stepBack).not.toHaveBeenCalled();
    await act(async () => { rig.inputs[0]!.onFallback('timeout'); });
    expect(latest.state.on, 'the fallback did not end reader mode').toBe(false);
    expect(places.stepBack, 'the reader place was not consumed').toHaveBeenCalledTimes(1);
    expect(document.querySelector('.docs-reading')?.getAttribute('data-reader-mode')).toBeNull();
    expect(rig.mounts[0]!.destroy).toHaveBeenCalledTimes(1);
    // The frame is gone: it is not told to stop.
    expect(rig.mounts[0]!.setReading).not.toHaveBeenCalledWith('off');
    expect(latest.offered, 'a fallen frame is no longer offered').toBe(false);
  });

  it('mount plan: a body mounted while reader mode is on for its document is made under the turn, and one for another document is not', async () => {
    const rig = bodyRig();
    const places = placesPort();
    const view = render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
    await flush();
    expect(rig.inputs[0]!.reading, 'a body made while reader mode is off').toBe('off');
    await frameReady(rig, 0);
    act(() => { latest.enter('button'); });
    expect(latest.readingFor(KEY_A)).toBe('screens');
    expect(latest.readingFor(KEY_B), 'another document is not the one entered').toBe('off');
    expect(latest.readingFor(null)).toBe('off');
    // A new commit of the same document: its body is made under the reading.
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={places} />);
    await flush();
    expect(rig.inputs[1]!.reading, 'a new body of the document entered').toBe('screens');
    // A body for another document, with reader mode still on for the first: not under it.
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k3" path="b.md" places={places} />);
    await flush();
    expect(rig.inputs[2]!.reading, 'a new document\'s body inherited the old document\'s reading').toBe('off');
    // Leaving: the next body is made off.
    act(() => { latest.exit('exit-tap'); });
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k4" places={places} />);
    await flush();
    expect(rig.inputs[3]!.reading).toBe('off');
    expect(latest.readingFor(KEY_A)).toBe('off');
  });

  it('reader mode: leaving after a new body of the same document sends off to the new mount only', async () => {
    const { rig, view, places } = await entered();
    expect(rig.mounts[0]!.setReading).toHaveBeenCalledWith('screens');
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={places} />);
    await flush();
    expect(rig.mounts[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(rig.inputs[1]!.reading).toBe('screens');
    await frameReady(rig, 1);
    expect(latest.state.on, 'a new body of the same document leaves reader mode on').toBe(true);
    // The new body was made under the reading: it is not sent the turn again at its ready.
    expect(rig.mounts[1]!.setReading).not.toHaveBeenCalled();
    const first = rig.mounts[0]!.setReading.mock.calls.length;
    act(() => { latest.exit('exit-tap'); });
    expect(rig.mounts[1]!.setReading, 'off did not reach the new mount').toHaveBeenCalledTimes(1);
    expect(rig.mounts[1]!.setReading).toHaveBeenCalledWith('off');
    expect(rig.mounts[0]!.setReading.mock.calls.length, 'off went to the destroyed mount').toBe(first);
  });

  it('reader mode: a body made under a reading that ended before its ready is stopped when it reports ready', async () => {
    const { rig, view, places } = await entered();
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={places} />);
    await flush();
    expect(rig.inputs[1]!.reading).toBe('screens');
    // Exit while the new body is still mounting: there is no frame to tell yet.
    act(() => { latest.exit('exit-tap'); });
    expect(rig.mounts[1]!.setReading).not.toHaveBeenCalled();
    await frameReady(rig, 1);
    expect(rig.mounts[1]!.setReading, 'the late frame was left under a reading that ended').toHaveBeenCalledTimes(1);
    expect(rig.mounts[1]!.setReading).toHaveBeenCalledWith('off');
  });

  it('reader mode: a body made while reader mode is on keeps its host under the reading ground until its ready has had two frames', async () => {
    const host = (): Element | null => document.querySelector('.docs-reader');
    const { rig, view, places } = await entered({ timers: true });
    expect(host()?.hasAttribute('data-reader-hold'), 'CONTROL: the body made while reader mode was off was never held').toBe(false);
    // A new commit of the document while reader mode is on: its new frame is held from before the library mounts it.
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={places} />);
    await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
    expect(rig.inputs[1]!.reading, 'CONTROL: the new body is made under the reading').toBe('screens');
    expect(host()?.hasAttribute('data-reader-hold'), 'the new frame is mounted under the reading ground').toBe(true);
    // Its ready alone does not show it: the turn the library posts at ready is applied by the frame after it.
    await frameReady(rig, 1);
    expect(host()?.hasAttribute('data-reader-hold'), 'shown at the ready itself, before the frame applied the turn').toBe(true);
    await advance(20);
    expect(host()?.hasAttribute('data-reader-hold'), 'shown after one animation frame').toBe(true);
    expect(rig.mounts[1]!.focus, 'the held frame was focused while it could not take the focus').not.toHaveBeenCalled();
    await advance(20);
    expect(host()?.hasAttribute('data-reader-hold'), 'still held after two animation frames').toBe(false);
    // The hidden iframe could not take the library's focus at its insertion, so it is given it as the hold lifts.
    expect(rig.mounts[1]!.focus, 'the frame was not focused when the hold lifted').toHaveBeenCalledTimes(1);
  });

  it('reader mode: leaving while a new mount is held gives the frame focus at its release', async () => {
    const host = (): Element | null => document.querySelector('.docs-reader');
    const { rig } = await entered({ timers: true });
    // A link to this very page, spelled with its file name: the live mount opens the document again, and its new frame is held.
    act(() => { rig.inputs[0]!.onLink({ kind: 'relative', path: 'a.md', fragment: 'sec' }); });
    expect(rig.mounts[0]!.openAt, 'CONTROL: the same-page link reopened the frame').toHaveBeenCalledWith('sec');
    expect(host()?.hasAttribute('data-reader-hold'), 'CONTROL: the reopened frame is held').toBe(true);
    // Reader mode is left before the new frame's ready: the context asks the frame for focus, and a hidden iframe takes none.
    const before = rig.mounts[0]!.focus.mock.calls.length;
    act(() => { latest.exit('exit-tap'); });
    const asked = rig.mounts[0]!.focus.mock.calls.length;
    expect(asked, 'CONTROL: leaving asked the frame for focus').toBeGreaterThan(before);
    expect(latest.state.on, 'CONTROL: reader mode is off').toBe(false);
    await frameReady(rig, 0);
    await advance(40);
    expect(host()?.hasAttribute('data-reader-hold'), 'the hold lifted').toBe(false);
    expect(rig.mounts[0]!.focus.mock.calls.length, 'the frame was not given the focus it was asked for while hidden').toBe(asked + 1);
  });

  it('reader mode: a body whose host is held and which ends before its ready leaves no hold behind', async () => {
    const { rig, view, places } = await entered({ timers: true });
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={places} />);
    await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
    const held = document.querySelector('.docs-reader');
    expect(held?.hasAttribute('data-reader-hold')).toBe(true);
    // The body ends (a third commit) before the frame was ready: the old host goes with its hold, and the new one is its own.
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k3" places={places} />);
    await act(async () => { for (let i = 0; i < 30; i += 1) await Promise.resolve(); });
    expect(held?.isConnected, 'the ended body\'s host is gone').toBe(false);
    await frameReady(rig, 2);
    await advance(40);
    expect(document.querySelector('.docs-reader')?.hasAttribute('data-reader-hold'), 'the last body\'s host was released').toBe(false);
    expect(document.querySelectorAll('[data-reader-hold]').length).toBe(0);
  });

  it('reader mode: a body made under one turn and ready after a switch to the other is brought to the new turn', async () => {
    const { rig, view, places } = await entered();
    expect(rig.mounts[0]!.setReading).toHaveBeenLastCalledWith('screens');
    // A new body of the document, made under Pages; its frame is not ready yet.
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={places} />);
    await flush();
    expect(rig.inputs[1]!.reading, 'CONTROL: the new body is made under Pages').toBe('screens');
    // The turn is switched to Scroll meanwhile: no frame is stored (the old one is gone, the new one is not ready), so none is sent.
    const first = rig.mounts[0]!.setReading.mock.calls.length;
    act(() => { latest.setTurn('scroll'); });
    expect(rig.mounts[0]!.setReading.mock.calls.length, 'the destroyed mount was sent the turn').toBe(first);
    expect(rig.mounts[1]!.setReading).not.toHaveBeenCalled();
    // It reports ready: it is brought to Scroll, once.
    await frameReady(rig, 1);
    expect(rig.mounts[1]!.setReading, 'the body made under Pages was left there').toHaveBeenCalledTimes(1);
    expect(rig.mounts[1]!.setReading).toHaveBeenCalledWith('scroll');
    // A turn chosen while the frame is up goes to it in place, and the next body made carries the latest.
    act(() => { latest.setTurn('screens'); });
    expect(rig.mounts[1]!.setReading).toHaveBeenLastCalledWith('screens');
    expect(rig.mounts[1]!.setReading).toHaveBeenCalledTimes(2);
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k3" places={places} />);
    await flush();
    expect(rig.inputs[2]!.reading, 'a new body is made under the latest turn').toBe('screens');
    await frameReady(rig, 2);
    expect(rig.mounts[2]!.setReading, 'a body made under the turn in force was sent it again').not.toHaveBeenCalled();
  });

  it('reader mode: a same-page reopening reports ready again and the turn chosen meanwhile reaches the frame once', async () => {
    const { rig } = await entered();
    const sent = rig.mounts[0]!.setReading;
    expect(sent.mock.calls).toEqual([['screens']]);
    act(() => { latest.setTurn('scroll'); });
    expect(sent.mock.calls, 'the chosen turn did not reach the frame in place').toEqual([['screens'], ['scroll']]);
    // The same mount opens the same document again at an anchor (`openAt`, a same-page link): its new frame reports ready again, and the
    // handle's last-sent reading (`scroll`) is what `planned` says, so the context has nothing to send again.
    await frameReady(rig, 0);
    await frameReady(rig, 0);
    expect(sent.mock.calls, 'the turn was sent to the frame again at its second ready').toEqual([['screens'], ['scroll']]);
    expect(latest.state.on).toBe(true);
  });

  it('time left: the frame a body hands the context carries the render\'s readingMinutes, and none when the library gave none', async () => {
    const base = bodyRig();
    const timed: ReaderRenderOutcome = { ...RENDERED, result: { ...RENDERED.result, meta: { ...RENDERED.result.meta, readingMinutes: 7 } } };
    const rig: BodyRig = { ...base, reader: { ...base.reader, render: async () => timed } };
    const places = placesPort();
    const view = render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
    await flush();
    await frameReady(rig, 0);
    expect(latest.frame?.readingMinutes, 'the reading time did not reach the frame reader mode holds').toBe(7);
    view.unmount();
    const plain = bodyRig();
    render(<Screen doc={KEY_A} rig={plain} bodyKey="k1" places={places} />);
    await flush();
    await frameReady(plain, 0);
    expect(latest.frame, 'CONTROL: a frame is stored').not.toBeNull();
    expect(latest.frame?.readingMinutes, 'a reading time appeared from nowhere').toBeUndefined();
    expect('readingMinutes' in (latest.frame ?? {}), 'the key is absent, not undefined').toBe(false);
  });

  it('focus: the frame is focused after entering and after leaving', async () => {
    const { rig } = await entered();
    expect(rig.mounts[0]!.focus, 'entering did not focus the frame').toHaveBeenCalledTimes(1);
    act(() => { latest.exit('exit-tap'); });
    expect(rig.mounts[0]!.focus, 'leaving did not focus the frame').toHaveBeenCalledTimes(2);
  });

  it('reader mode: a ReaderFrame outside a Docs screen reads reader mode as off and calls nothing', async () => {
    const rig = bodyRig();
    render(bodyOf(rig, 'k1'));
    await flush();
    expect(rig.inputs[0]!.reading).toBe('off');
    await frameReady(rig, 0);
    for (const act1 of ['menu', 'exit', 'toggle', 'active'] as const) expect(() => rig.inputs[0]!.onReader!(act1)).not.toThrow();
    expect(() => rig.inputs[0]!.onProgress!(0.2)).not.toThrow();
    expect(() => rig.inputs[0]!.onPlace!('overlay')).not.toThrow();
    expect(rig.mounts[0]!.setReading).not.toHaveBeenCalled();
  });
});

// ─── fix round 1 (X6 XR fix round 1) ───────────────────────────────────────────────────────────────────────────────────────

describe('reader mode: not offered while a figure is open (X6 XR fix round 1, item 3)', () => {
  beforeEach(() => {
    for (const f of Object.values(placesFake)) f.mockClear();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    while (restorers.length > 0) restorers.pop()?.();
  });

  /** A screen with one ready body and nothing entered. */
  async function ready(): Promise<{ rig: BodyRig; places: ReturnType<typeof placesPort>; view: ReturnType<typeof render> }> {
    const rig = bodyRig();
    const places = placesPort();
    const view = render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={places} />);
    await flush();
    await frameReady(rig, 0);
    return { rig, places, view };
  }

  it('figure: with a figure open the head, the one bar, r and enter all refuse, and after it closes it is offered again', async () => {
    const { rig, places } = await ready();
    expect(latest.offered, 'CONTROL: offered with no figure open').toBe(true);
    expect(readerModeHandle()?.available(), 'CONTROL: r is available with no figure open').toBe(true);
    act(() => { rig.inputs[0]!.onPlace!('overlay'); });
    expect(latest.offered, 'the head still draws Reader mode over an open figure').toBe(false);
    expect(readerModeHandle()?.available(), 'r is still available over an open figure').toBe(false);
    expect(readerModeHandle()?.offered(), 'r still acts over an open figure').toBe(false);
    act(() => { latest.enter('button'); });
    act(() => { readerModeHandle()?.toggle(); });
    expect(latest.state.on, 'reader mode started over an open figure').toBe(false);
    expect(places.push, 'a reader place was pushed over the figure\'s entry').not.toHaveBeenCalled();
    act(() => { rig.inputs[0]!.onPlace!('overlay-closed'); });
    expect(latest.offered, 'not offered again after the figure closed').toBe(true);
    expect(readerModeHandle()?.available()).toBe(true);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'could not enter after the figure closed').toBe(true);
    expect(places.push).toHaveBeenCalledTimes(1);
  });

  it('figure: a figure closed by Back (the dispatcher\'s closeOverlay reports nothing) and a body that ends both offer it again', async () => {
    const { rig, view } = await ready();
    act(() => { rig.inputs[0]!.onPlace!('overlay'); });
    expect(latest.offered, 'CONTROL: a figure is open').toBe(false);
    // The pop that closes the figure is the dispatcher's: it calls the host the body registered, and the frame reports nothing.
    const host = placesFake.host.mock.calls.map((c) => c[0] as { closeOverlay?(): void } | null).filter((h) => h !== null).at(-1);
    expect(host, 'the body registered no host').toBeDefined();
    act(() => { host!.closeOverlay?.(); });
    expect(latest.offered, 'a Back that closed the figure left reader mode unoffered').toBe(true);
    // A figure open when the body ends (a new commit): the next body's frame has none.
    act(() => { rig.inputs[0]!.onPlace!('overlay'); });
    expect(latest.offered, 'CONTROL: a figure is open again').toBe(false);
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={placesPort()} />);
    await flush();
    await frameReady(rig, 1);
    expect(latest.offered, 'a figure of the ended body kept reader mode unoffered').toBe(true);
  });
});
