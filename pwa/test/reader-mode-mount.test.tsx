// Reader mode's mount layer (X6 XR1.4 with XR2.1 folded in, D-8975, D-8805): `docs/reader/bridge.ts`'s `ReaderMount.setReading`,
// `ReaderMount.focus`, the `onReader` adapter and `onProgress` on every production mount, and `policy.ts#readerMountAsks`'s
// `progress`, `reading` and `reader` words. jsdom, through the bridge's real mount path with an injected `mount` spy: the library
// itself is not run (its `setReading` queue and replay are the library's own, measured at Step 0 of XR1.1). Every page is a
// placeholder.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { useEffect, type ReactNode } from 'react';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
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
import { DocsScreen } from '../src/screens/DocsScreen';
import { navigate } from '../src/lib/router';
import { readPlaces, resetPopstateForTests } from '../src/lib/popstate';
import { READER_LAYOUT_TEXT, READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import type { ReaderLayout } from '../src/docs/reader/policy';
import { chooseReaderLayout } from '../src/docs/reader/layoutPref';
import { baseCommands } from '../src/command/commands';
import type { CommandContext } from '../src/command/registry';
import { fakeLoaders, fileResponse, treeOk } from './docsFixtures';

// The visit's places are the history half's (reader-places.test.ts); here only what `ReaderFrame` hands them is read.
const placesFake = vi.hoisted(() => ({ onPlace: vi.fn(), onHash: vi.fn(), host: vi.fn(), end: vi.fn() }));
/** Set by a case that needs the real visit (the real record and dispatcher, a real Back and Forward): the body's places are then the
 *  real `startPlaces`'. */
const realPlaces = vi.hoisted(() => ({ on: false }));
vi.mock('../src/docs/reader/places', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/docs/reader/places')>();
  return { ...orig, startPlaces: (o: Parameters<typeof orig.startPlaces>[0]) => (realPlaces.on ? orig.startPlaces(o) : placesFake) };
});

/** The layout rule the hook reads (X2 P5.1): `READER_LAYOUT_RULE` is one constant, so the rows that need the other value read it through
 *  this holder, which every case of this file leaves at `remount`. The shipped constant is `default-only` (the coordinator's ruling of
 *  2026-11-28), so every case that enters reader mode from a layout other than `default` runs under `remount` pinned through this
 *  mock, to keep the remount machinery tested for the day the rule flips back; the one case that names `default-only` pins that
 *  value the same way, and the shipped behaviour itself is pinned against the real constant in `reader-mode-policy.test.ts`. */
const layoutRule = vi.hoisted(() => ({ value: 'remount' as 'remount' | 'default-only' }));
vi.mock('../src/docs/reader/readerMode', async (importOriginal) => {
  const orig = await importOriginal<typeof import('../src/docs/reader/readerMode')>();
  return { ...orig, get READER_LAYOUT_RULE() { return layoutRule.value; } };
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  layoutRule.value = 'remount';
});

const STUB_ASSETS = { guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' };
/** The stub texts of a layout: the default's four, and for another layout its own bundle and stylesheet. */
const stubAssetsOf = (layout: ReaderLayout): typeof STUB_ASSETS & { layoutCss?: string } => (
  layout === 'default' ? STUB_ASSETS : { ...STUB_ASSETS, enhance: `e:${layout}`, layoutCss: `css:${layout}` }
);

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
  onReader?: ReaderMountInput['onReader']; throwOnSetReading?: boolean; initialHash?: string; layout?: ReaderLayout;
  /** Each layout the assets loader was asked for, in order. */
  loads?: ReaderLayout[];
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
    document: {
      result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } },
      ...(o.initialHash === undefined ? {} : { initialHash: o.initialHash }),
    },
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
    ...(o.layout === undefined ? {} : { layout: o.layout }),
  };
  const run = () => mountReader(el, input, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => null,
    assets: (layout) => { o.loads?.push(layout); return Promise.resolve(stubAssetsOf(layout)); },
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
  project: 'demo', pageRef: null, pageAt: null, pageVariant: null, view: 'effective', section: 'specs', path: 'a.md', tree: treeOk(),
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
  readonly closeOverlay: Mock<() => void>;
  /** The layout request the mount was given (X2 P5.1): only a rig made with a `layout` has a mount with a `remount`. */
  readonly remount: Mock<(o: { layout: ReaderLayout; reading?: string; onKept?: () => void }) => void>;
}

interface BodyRig {
  readonly reader: ReaderDeps;
  readonly inputs: ReaderMountInput[];
  readonly mounts: BodyMount[];
  /** Every mount call in order: `mount 0`, `setReading 0 screens`, `focus 0`, `destroy 0`... */
  readonly log: string[];
}

/** A rig whose mounts are the fake `ReaderMount`s the body is handed. With `layout` its mounts carry a live `layout` (the one they were
 *  made in, then each `remount`'s) and a `remount`, as the bridge's do; without it they have neither, as before layouts. `gate` holds
 *  each mount until it settles (a mount still loading); `keep` makes each remount fail as a layout chunk that does not load does: the
 *  frame and its layout stay, and the caller is told (`onKept`); `pending` keeps each remount into another layout waiting, as a layout
 *  chunk still loading does (the live layout does not move and nobody is told). A request for the layout the mount carries is the
 *  bridge's same-layout arm in every rig: nothing is mounted, a request waiting is dropped, and the caller is told (`onKept`). */
function bodyRig(o: { layout?: boolean; gate?: Promise<void>; keep?: boolean; pending?: boolean } = {}): BodyRig {
  const inputs: ReaderMountInput[] = [];
  const mounts: BodyMount[] = [];
  const log: string[] = [];
  const reader: ReaderDeps = {
    render: async () => RENDERED,
    images: async () => ({ urls: {}, drafts: 0, auth: 0 }),
    mount: async (el, input) => {
      if (o.gate !== undefined) await o.gate;
      const n = mounts.length;
      inputs.push(input);
      log.push(`mount ${n}`);
      const iframe = el.ownerDocument.createElement('iframe');
      iframe.setAttribute('tabindex', '-1');
      el.replaceChildren(iframe);
      let current: ReaderLayout = input.layout ?? 'default';
      const m: BodyMount = {
        n, iframe,
        setReading: vi.fn((mode: string) => { log.push(`setReading ${n} ${mode}`); }),
        focus: vi.fn(() => { log.push(`focus ${n}`); }),
        destroy: vi.fn(() => { log.push(`destroy ${n}`); }),
        command: vi.fn(),
        openAt: vi.fn(),
        closeOverlay: vi.fn(),
        remount: vi.fn((r: { layout: ReaderLayout; reading?: string; onKept?: () => void }) => {
          log.push(`remount ${n} ${r.layout}${r.reading === undefined ? '' : ` ${r.reading}`}`);
          if (o.keep === true || r.layout === current) { r.onKept?.(); return; }
          if (o.pending === true) return;
          current = r.layout;
        }),
      };
      mounts.push(m);
      const handle: Record<string, unknown> = { seed: { hosted: false }, follow: vi.fn(), setPrefs: vi.fn(), ...m };
      if (o.layout === true) Object.defineProperty(handle, 'layout', { get: () => current, enumerable: true });
      else delete handle['remount'];
      return handle as unknown as ReaderMount;
    },
  };
  return { reader, inputs, mounts, log };
}

function placesPort(): ReaderModePlaces & { push: Mock<() => boolean>; stepBack: Mock<() => number>; land(): void } {
  let host: Parameters<ReaderModePlaces['register']>[0] | null = null;
  return {
    placeFree: () => true,
    push: vi.fn(() => true),
    stepBack: vi.fn(() => 1),
    landedBelow: () => false,
    markExitPending: vi.fn(),
    register: (h) => { host = h; return () => { host = null; }; },
    standingOnDead: () => false,
    // The step back's landing, as the pop dispatcher reports it (wave 62: until it comes, a re-entry is refused).
    land: () => { if (host === null) throw new Error('no host registered'); host.exitReader(false); },
  };
}

let latest: ReaderModeContextValue;
const parser = async () => parseMarkdown('# Formatted', 'docs');

/** One body of `a.md` (or `path`), keyed so a new key is a new body, as a new commit's `bodyKey` is. */
function bodyOf(rig: BodyRig, bodyKey: string, path = 'a.md', link: Omit<DocLinkContextValue, 'urls'> = LINK): ReactNode {
  return (
    <ReaderFrame
      key={bodyKey} show={{ ...fileResponse('# A').show, path }} bodyKey={bodyKey} link={link} parser={parser}
      reader={rig.reader} pendingFragment={null} onFragmentConsumed={() => undefined}
    />
  );
}

/** The Docs screen's part of reader mode: the hook, its container and its context around one body. */
function Screen(p: {
  doc: string | null; rig: BodyRig; bodyKey: string; path?: string; places: ReaderModePlaces; phone?: true;
  /** The page's link context, where a case needs another than `LINK` (a visit's `pageVariant`). */
  link?: Omit<DocLinkContextValue, 'urls'>;
}): ReactNode {
  const { value, container, controls } = useReaderMode({ doc: p.doc, plainView: false, places: p.places });
  latest = value;
  // The outside door, as `DocsScreen` sets it (`r` and the palette read it).
  useEffect(() => {
    setReaderModeHandle(controls);
    return () => setReaderModeHandle(null);
  }, [controls]);
  const body = <DocsReading reading={container}>{bodyOf(p.rig, p.bodyKey, p.path, p.link)}</DocsReading>;
  return (
    <ReaderModeContext value={value}>
      {/* A phone's body is mounted on ccrc's own bar, a desk's on the frame's: both enter reader mode the same way (X2 P5.1). */}
      {p.phone === true ? <ReaderBarContext value={{ chrome: 'host-bar', publish: () => undefined }}>{body}</ReaderBarContext> : body}
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
    act(() => { places.land(); });   // the exit's step back lands (wave 62: a re-entry waits for it)
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
    expect(rig.mounts[0]!.closeOverlay, 'the mount was not told to close the figure').toHaveBeenCalledTimes(1);
    expect(latest.offered, 'a Back that closed the figure left reader mode unoffered').toBe(true);
    // A figure open when the body ends (a new commit): the next body's frame has none.
    act(() => { rig.inputs[0]!.onPlace!('overlay'); });
    expect(latest.offered, 'CONTROL: a figure is open again').toBe(false);
    view.rerender(<Screen doc={KEY_A} rig={rig} bodyKey="k2" places={placesPort()} />);
    await flush();
    await frameReady(rig, 1);
    expect(latest.offered, 'a figure of the ended body kept reader mode unoffered').toBe(true);
  });

  it('figure: a frame replaced without being dropped (a same-page reopening reports ready again) has no figure open (review M1)', async () => {
    const { rig } = await ready();
    act(() => { rig.inputs[0]!.onPlace!('overlay'); });
    expect(latest.offered, 'CONTROL: a figure is open').toBe(false);
    // The same mount's frame is made anew and reports ready again: the context is handed a new frame and no `dropFrame` came.
    const before = latest.frame;
    await frameReady(rig, 0);
    expect(latest.frame, 'CONTROL: the context was handed a new frame').not.toBe(before);
    expect(latest.offered, 'a figure of the replaced frame kept reader mode unoffered').toBe(true);
  });
});

// ─── focus after a fall back that follows an entry, with the real Docs head (X6 follow-up, review 4052 F1) ──────────────
//
// The real Docs screen (its head, its reading container and the real `ReaderFrame` body over `bodyRig`'s mount), inside a stand-in
// for the console's `<main id="content" tabindex="-1">` that `focusShownLandmark` reaches. The fall back drops the frame, and the
// exit's focus act runs in the same step, before React commits the frame's loss: the head still holds its Reader mode action
// then, and that action unmounts in the next commit, since reader mode is no longer offered.

describe('reader mode: focus after a fall back that follows an entry, the real Docs head drawn (X6 follow-up, review 4052 F1)', () => {
  beforeEach(() => {
    for (const f of Object.values(placesFake)) f.mockClear();
  });
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
    while (restorers.length > 0) restorers.pop()?.();
    navigate('/');
  });

  it('fall back: after entering by the head\'s Reader mode action, a fall back puts focus on a control that stays (the main region), never on the action the next commit unmounts', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installWakeLock();
    const rig = bodyRig();
    navigate('/docs/demo/specs/a.md');
    render(
      <main id="content" tabIndex={-1}>
        <DocsScreen path={location.pathname} search={location.search} loaders={fakeLoaders().loaders} parser={parser} reader={rig.reader} />
      </main>,
    );
    await flush();
    await waitFor(() => expect(rig.inputs.length, 'CONTROL: the body mounted its frame').toBe(1));
    await frameReady(rig, 0);
    const action = await screen.findByRole('button', { name: READER_MODE_TEXT.enter });
    act(() => { action.click(); });
    expect(readerModeHandle()?.on(), 'CONTROL: the head\'s action entered reader mode').toBe(true);
    await act(async () => { rig.inputs[0]!.onFallback('timeout'); });
    expect(readerModeHandle()?.on(), 'CONTROL: the fall back ended reader mode').toBe(false);
    expect(screen.queryByRole('button', { name: READER_MODE_TEXT.enter }), 'CONTROL: the head no longer draws Reader mode').toBeNull();
    const main = document.getElementById('content');
    expect(document.activeElement, 'after the commit, focus is on the main region, not left on the body by an unmounted action')
      .toBe(main);
    expect(main?.isConnected).toBe(true);
  });
});

// ─── focus on the head's Reader mode action while a dead reader entry is left (wave 62 fix round 1, review 4192 F6) ──────
//
// The real Docs screen and head over the real visit, record and dispatcher: reader mode is entered by the head's action, a Back
// ends it, and a Forward lands on the dead reader entry, which the dispatcher hands the hook's `leaveDead`. Its step back stands
// until its landing, and reader mode is refused meanwhile; the action stays drawn, so a focus it holds stays on it.

describe('reader mode: focus on the head\'s action while a dead reader entry is left, the real Docs head drawn (review 4192 F6)', () => {
  const sleep = (ms: number): Promise<void> => new Promise((r) => { setTimeout(r, ms); });
  const lastIdx = (): number => readPlaces().lastIdx;
  beforeEach(() => {
    for (const f of Object.values(placesFake)) f.mockClear();
    realPlaces.on = true;
    resetPopstateForTests();
  });
  afterEach(async () => {
    cleanup();
    await sleep(20);
    realPlaces.on = false;
    resetPopstateForTests();
    window.localStorage.clear();
    while (restorers.length > 0) restorers.pop()?.();
    navigate('/');
  });

  it('dead entry: with focus on the head\'s Reader mode action, a Forward onto the dead reader entry leaves the focus on it', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    installWakeLock();
    const rig = bodyRig();
    history.replaceState(null, '', '/before');
    navigate('/docs/demo/specs/a.md');
    render(
      <main id="content" tabIndex={-1}>
        <DocsScreen path={location.pathname} search={location.search} loaders={fakeLoaders().loaders} parser={parser} reader={rig.reader} />
      </main>,
    );
    await flush();
    await waitFor(() => expect(rig.inputs.length, 'CONTROL: the body mounted its frame').toBe(1));
    await frameReady(rig, 0);
    const doc = lastIdx();
    act(() => { screen.getByRole('button', { name: READER_MODE_TEXT.enter }).click(); });
    expect(readerModeHandle()?.on(), 'CONTROL: the head\'s action entered reader mode').toBe(true);
    expect(lastIdx(), 'CONTROL: the reader place was pushed').toBe(doc + 1);
    await act(async () => { history.back(); });
    await act(async () => { await vi.waitFor(() => { expect(readerModeHandle()?.on()).toBe(false); }, { timeout: 4000, interval: 10 }); });
    expect(lastIdx(), 'CONTROL: the Back landed on the document\'s entry').toBe(doc);
    const action = screen.getByRole('button', { name: READER_MODE_TEXT.enter });
    act(() => { action.focus(); });
    expect(document.activeElement, 'CONTROL: the head\'s action holds focus').toBe(action);
    // The hook's step is held, so its landing comes only when the case lets it: the wait stands while the focus is read.
    const go = vi.spyOn(history, 'go').mockImplementation(() => undefined);
    await act(async () => { history.forward(); });
    await act(async () => { await vi.waitFor(() => { expect(go).toHaveBeenCalledTimes(1); }, { timeout: 4000, interval: 10 }); });
    expect(go, 'CONTROL: the hook stepped below the dead entry').toHaveBeenCalledWith(-1);
    expect(readerModeHandle()?.offered(), 'CONTROL: reader mode is refused while the step lands').toBe(false);
    expect(action.isConnected, 'the head unmounted its Reader mode action while the step lands').toBe(true);
    expect(document.activeElement, 'focus fell from the head\'s action to the page body').toBe(action);
    // The step is made now, and lands.
    go.mockRestore();
    await act(async () => { history.go(-1); });
    await act(async () => { await vi.waitFor(() => { expect(lastIdx()).toBe(doc); }, { timeout: 4000, interval: 10 }); await sleep(30); });
    expect(readerModeHandle()?.offered(), 'CONTROL: offered again once the step landed').toBe(true);
    expect(document.activeElement, 'after the landing, focus is still on the head\'s action').toBe(action);
  });
});

// ─── the layouts (X2 P5.1, D-8975): reader mode reads in the default layout ─────────────────────────────────────────────────────────

const PREFS_KEY = 'ccrc:reader:v1:pref:prefs';
/** A remount request as the body makes it (M5): the layout and the reading the frame was last sent. (The stale-write guard of I1 is
 *  not part of the request any more: the storage port the bridge hands the library keeps the stored layout, I-3.) */
const asked = (layout: ReaderLayout, reading: string): unknown => expect.objectContaining({ layout, reading });
const layoutsOf = (rig: Rig): string[] => rig.mount.mock.calls.map((c) => (c as unknown as [HTMLElement, { adapters: HostAdapters }])[1].adapters.layout ?? 'default');

describe('layouts: ReaderMount.remount (X2 P5.1)', () => {
  it('remount: the same document, no body read, no initialHash', async () => {
    // X6.22: a `remount` that keeps the opening hash reds here.
    const loads: ReaderLayout[] = [];
    const r = rig({ initialHash: 'sec', loads });
    const m = await r.run();
    r.ready(0);
    const first = (r.mount.mock.calls[0] as unknown as [HTMLElement, { document: RenderInput }])[1].document;
    expect(first.initialHash, 'CONTROL: the first mount opens at the hash it was given').toBe('sec');
    m.remount!({ layout: 'review', reading: 'screens' });
    // The new layout's texts load first, and the old frame stays meanwhile.
    expect(r.mount, 'the new frame was mounted before the layout\'s texts came').toHaveBeenCalledTimes(1);
    expect(r.frames[0]!.destroy).not.toHaveBeenCalled();
    await vi.waitFor(() => { expect(r.mount).toHaveBeenCalledTimes(2); });
    const second = (r.mount.mock.calls[1] as unknown as [HTMLElement, { document: RenderInput }])[1].document;
    expect(second.initialHash, 'the stored place wins: the new frame has no opening hash').toBeNull();
    expect(second.result, 'the same rendered document: nothing was read again').toBe(first.result);
    expect(loads, 'only the new layout\'s texts were loaded').toEqual(['default', 'review']);
    const a = r.adaptersAt(1);
    expect(a.layout).toBe('review');
    expect(a.assets.enhance).toBe('e:review');
    expect(a.assets.layoutCss).toBe('css:review');
    expect(m.layout).toBe('review');
    // The old frame goes, the new one is sent the reading before its ready, and the old one never was.
    expect(r.order).toEqual(['mount 0', 'ready 0', 'destroy 0', 'mount 1', 'setReading 1 screens']);
    expect(r.frames[0]!.setReading).not.toHaveBeenCalled();
    // Back to the default layout: its texts are kept, so the swap is at once, and the default's adapters name no layout.
    m.remount!({ layout: 'default', reading: 'off' });
    expect(r.mount, 'a layout loaded before swaps in the same task').toHaveBeenCalledTimes(3);
    expect(Object.keys(r.adaptersAt(2))).not.toContain('layout');
    expect(Object.keys(r.adaptersAt(2).assets).sort()).toEqual(['bootstrap', 'css', 'enhance', 'guard']);
    expect(loads, 'a kept layout is not loaded again').toEqual(['default', 'review']);
    expect(r.frames[2]!.setReading, 'a fresh mount is off: nothing is sent').not.toHaveBeenCalled();
    expect(m.layout).toBe('default');
  });

  it('remount: a later request replaces a loading one, and a destroy cancels it', async () => {
    const pending = new Map<ReaderLayout, () => void>();
    const loads: ReaderLayout[] = [];
    const el = document.createElement('div');
    document.body.append(el);
    const frames: DocFrame[] = [];
    const mount = vi.fn(() => {
      const f = { destroy: vi.fn(), setReading: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn() } as unknown as DocFrame;
      frames.push(f);
      return f;
    });
    const onFallback = vi.fn();
    const m = await mountReader(el, {
      document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } },
      bytes: 100, docKey: null, title: 'a.md', prefs: { theme: 'auto' },
      onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback,
    }, {
      mount: mount as unknown as typeof mountDocFrame, store: () => null, mermaid: () => Promise.resolve('M'), e17: 'does-not-hold',
      assets: (layout) => {
        loads.push(layout);
        if (layout === 'default') return Promise.resolve(STUB_ASSETS);
        return new Promise((resolve) => { pending.set(layout, () => resolve(stubAssetsOf(layout))); });
      },
    });
    m.remount!({ layout: 'review' });
    m.remount!({ layout: 'guided' });
    expect(loads).toEqual(['default', 'review', 'guided']);
    // The first request's texts arrive after the second was made: it changes nothing.
    pending.get('review')!();
    await Promise.resolve();
    await Promise.resolve();
    expect(mount, 'a replaced request mounted').toHaveBeenCalledTimes(1);
    pending.get('guided')!();
    await vi.waitFor(() => { expect(mount).toHaveBeenCalledTimes(2); });
    expect(m.layout).toBe('guided');
    expect(frames[0]!.destroy).toHaveBeenCalledTimes(1);
    // A destroy while a layout loads cancels the swap: the frame is the live one's, and nothing more is mounted.
    m.remount!({ layout: 'classic' });
    m.destroy();
    pending.get('classic')!();
    await Promise.resolve();
    await Promise.resolve();
    expect(mount).toHaveBeenCalledTimes(2);
    m.remount!({ layout: 'editorial' });
    expect(loads, 'a destroyed mount asked for nothing').not.toContain('editorial');
    expect(onFallback).not.toHaveBeenCalled();
  });

  /** A bridge whose layouts' texts, but the one it mounts in (`initial`, the default's), are held until `release(layout)` or
   *  `fail(layout)`, with the frames it mounts. */
  async function heldBridge(initial: ReaderLayout = 'default'): Promise<{
    m: ReaderMount; mount: Mock<(el: HTMLElement, o: { document: RenderInput; adapters: HostAdapters }) => DocFrame>;
    frames: Array<{ destroy: Mock<() => void>; setReading: Mock<(mode: string) => void> }>;
    release: (l: ReaderLayout) => void; fail: (l: ReaderLayout) => void; onFallback: Mock<() => void>;
  }> {
    const held = new Map<ReaderLayout, { ok: () => void; no: () => void }>();
    const frames: Array<{ destroy: Mock<() => void>; setReading: Mock<(mode: string) => void> }> = [];
    const el = document.createElement('div');
    document.body.append(el);
    const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => {
      const f = { destroy: vi.fn(), setReading: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn() };
      frames.push(f);
      return f as unknown as DocFrame;
    });
    const onFallback = vi.fn();
    const m = await mountReader(el, {
      document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } } },
      bytes: 100, docKey: null, title: 'a.md', prefs: { theme: 'auto' },
      onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback,
      ...(initial === 'default' ? {} : { layout: initial }),
    }, {
      mount: mount as unknown as typeof mountDocFrame, store: () => null, mermaid: () => Promise.resolve('M'), e17: 'does-not-hold',
      assets: (layout) => (layout === initial
        ? Promise.resolve(stubAssetsOf(layout))
        : new Promise((resolve, reject) => { held.set(layout, { ok: () => resolve(stubAssetsOf(layout)), no: () => reject(new Error('chunk')) }); })),
    });
    return {
      m, mount, frames, onFallback,
      release: (l) => { held.get(l)!.ok(); },
      fail: (l) => { held.get(l)!.no(); },
    };
  }
  const settle = async (): Promise<void> => { for (let i = 0; i < 10; i += 1) await Promise.resolve(); };

  it('remount: a layout chunk that fails to load keeps the frame that was showing', async () => {
    // M3: a failed layout chunk is no fallback and no loss of the frame: the console warns, the layout stays, and a reading that was
    // recorded for the swap (reader mode's entry) is set on the frame that stays, in place.
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const b = await heldBridge();
    const onKept = vi.fn();
    b.m.remount!({ layout: 'review', onKept });
    b.fail('review');
    await settle();
    expect(b.onFallback, 'a failed layout chunk fell back').not.toHaveBeenCalled();
    expect(b.frames[0]!.destroy, 'the frame that was showing was destroyed').not.toHaveBeenCalled();
    expect(b.mount).toHaveBeenCalledTimes(1);
    expect(b.m.layout).toBe('default');
    expect(warn.mock.calls.some((c) => typeof c[0] === 'string' && c[0].startsWith('ccrc-reader: '))).toBe(true);
    expect(onKept, 'the caller is told the frame was kept').toHaveBeenCalledTimes(1);
    // Reader mode's entry: the reading rode the request, and the chunk fails: reader mode stays on the frame that stands, in place.
    b.m.remount!({ layout: 'guided', reading: 'screens', onKept });
    expect(b.frames[0]!.setReading, 'the reading went to the old frame while the texts loaded').not.toHaveBeenCalled();
    b.fail('guided');
    await settle();
    expect(b.frames[0]!.setReading).toHaveBeenCalledTimes(1);
    expect(b.frames[0]!.setReading).toHaveBeenCalledWith('screens');
    expect(b.onFallback).not.toHaveBeenCalled();
    expect(b.mount).toHaveBeenCalledTimes(1);
    expect(onKept).toHaveBeenCalledTimes(2);
    // A request replaced by a later one reports nothing when it fails.
    b.m.remount!({ layout: 'classic', onKept });
    b.m.remount!({ layout: 'editorial', onKept });
    b.fail('classic');
    await settle();
    expect(onKept, 'a replaced request told the caller').toHaveBeenCalledTimes(2);
  });

  it('remount: openAt during a pending layout load keeps the anchor', async () => {
    // M1: the anchor wins. The pending swap is dropped, so the frame opened at the anchor is not replaced by one with no hash when
    // the texts arrive; with the pending layout's texts not in, it is made in the layout the live frame carries.
    const b = await heldBridge();
    b.m.remount!({ layout: 'review', reading: 'screens' });
    b.m.openAt!('sec');
    expect(b.mount, 'the openAt did not mount at once').toHaveBeenCalledTimes(2);
    const at = (n: number): { document: RenderInput; adapters: HostAdapters } => b.mount.mock.calls[n]![1];
    expect(at(1).document.initialHash).toBe('sec');
    expect(at(1).adapters.layout, 'made in the live layout, the pending one\'s texts not being in').toBeUndefined();
    b.release('review');
    await settle();
    expect(b.mount, 'the dropped swap mounted when its texts arrived').toHaveBeenCalledTimes(2);
    expect(b.frames[1]!.destroy, 'the anchored frame was replaced').not.toHaveBeenCalled();
    expect(b.m.layout).toBe('default');
    // The reading recorded for the dropped request is the reading the anchored frame was sent.
    expect(b.frames[1]!.setReading).toHaveBeenCalledWith('screens');
    expect(b.frames[0]!.setReading).not.toHaveBeenCalled();
  });

  it('remount: a reading set while a layout loads rides the swap and is never sent to the frame about to go', async () => {
    // M2.
    const b = await heldBridge();
    b.m.remount!({ layout: 'review' });
    b.m.setReading!('scroll');
    b.m.setReading!('screens');
    expect(b.frames[0]!.setReading, 'a reading reached the old frame during the load').not.toHaveBeenCalled();
    b.release('review');
    await vi.waitFor(() => { expect(b.mount).toHaveBeenCalledTimes(2); });
    expect(b.frames[0]!.setReading).not.toHaveBeenCalled();
    expect(b.frames[1]!.setReading).toHaveBeenCalledTimes(1);
    expect(b.frames[1]!.setReading).toHaveBeenCalledWith('screens');
    // Once nothing loads, a reading is sent to the live frame as before.
    b.m.setReading!('off');
    expect(b.frames[1]!.setReading).toHaveBeenLastCalledWith('off');
  });

  it('remount: a request for the layout the frame carries mounts nothing, drops a loading one, sets the reading in place and tells the caller', async () => {
    const b = await heldBridge();
    const onKept = vi.fn();
    b.m.remount!({ layout: 'review' });
    expect(onKept).not.toHaveBeenCalled();
    b.m.remount!({ layout: 'default', reading: 'screens', onKept });
    expect(b.frames[0]!.setReading).toHaveBeenCalledWith('screens');
    // I-4a: the caller took a hold on the host for the request that was dropped, and no `ready` will lift it: it is told, as for a
    // frame that was kept, so it releases the hold and shows the document.
    expect(onKept, 'the same-layout arm told nobody the frame stands').toHaveBeenCalledTimes(1);
    b.release('review');
    await settle();
    expect(b.mount, 'a dropped request mounted').toHaveBeenCalledTimes(1);
    expect(b.m.layout).toBe('default');
    expect(onKept, 'the dropped request told the caller again when its texts came').toHaveBeenCalledTimes(1);
  });

  it('remount: openAt while the default load is pending under a reading mounts in default, at the anchor, when the texts come', async () => {
    // I-4b: reader mode on reads in default. An anchor link made while the entry's default texts load rides that swap, so the frame the
    // anchor opens is the default one, not a review frame that a second remount would have to replace.
    const b = await heldBridge('review');
    b.m.remount!({ layout: 'default', reading: 'screens' });
    b.m.openAt!('sec');
    expect(b.mount, 'a frame was mounted in review at the anchor').toHaveBeenCalledTimes(1);
    expect(b.frames[0]!.destroy, 'the review frame went before the default one was in').not.toHaveBeenCalled();
    b.release('default');
    await vi.waitFor(() => { expect(b.mount).toHaveBeenCalledTimes(2); });
    const at = (n: number): { document: RenderInput; adapters: HostAdapters } => b.mount.mock.calls[n]![1];
    expect(at(1).document.initialHash, 'the swap opens at the anchor').toBe('sec');
    expect(Object.keys(at(1).adapters), 'the swap is in default').not.toContain('layout');
    expect(b.m.layout).toBe('default');
    expect(b.frames[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(b.frames[1]!.setReading, 'the reading rode the swap').toHaveBeenCalledWith('screens');
    expect(b.mount, 'a second frame was mounted for the anchor').toHaveBeenCalledTimes(2);
    // With no reading in force the anchor wins as it always did (M1): the pending swap is dropped, the frame opens in the live layout.
    const off = await heldBridge('review');
    off.m.remount!({ layout: 'default' });
    off.m.openAt!('sec');
    expect(off.mount, 'the anchor did not mount at once with no reading').toHaveBeenCalledTimes(2);
    expect(Object.keys(off.mount.mock.calls[1]![1].adapters)).toContain('layout');
    off.release('default');
    await settle();
    expect(off.mount, 'the dropped swap mounted').toHaveBeenCalledTimes(2);
  });

  it('remount: an anchor riding a default swap that fails to load opens in the live layout, and a later request for it does the same', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const failed = await heldBridge('review');
    const onKept = vi.fn();
    failed.m.remount!({ layout: 'default', reading: 'screens', onKept });
    failed.m.openAt!('sec');
    failed.fail('default');
    await settle();
    expect(warn).toHaveBeenCalled();
    expect(onKept, 'the caller was not told the frame was kept').toHaveBeenCalledTimes(1);
    expect(failed.mount, 'the anchor was lost with the failed swap').toHaveBeenCalledTimes(2);
    expect(failed.mount.mock.calls[1]![1].document.initialHash).toBe('sec');
    expect(Object.keys(failed.mount.mock.calls[1]![1].adapters), 'the anchor opened in the live layout').toContain('layout');
    expect(failed.m.layout).toBe('review');
    // Leaving meanwhile: the request for the layout the frame carries drops the swap, and the anchor opens there at once.
    const left = await heldBridge('review');
    const keptOnLeave = vi.fn();
    left.m.remount!({ layout: 'default', reading: 'screens' });
    left.m.openAt!('sec');
    left.m.remount!({ layout: 'review', reading: 'off', onKept: keptOnLeave });
    expect(keptOnLeave).toHaveBeenCalledTimes(1);
    expect(left.mount, 'the anchor was lost with the dropped swap').toHaveBeenCalledTimes(2);
    expect(left.mount.mock.calls[1]![1].document.initialHash).toBe('sec');
    left.release('default');
    await settle();
    expect(left.mount, 'the dropped swap mounted').toHaveBeenCalledTimes(2);
  });

  it('remount: a same-page reopening after a remount is mounted in the layout the frame is in, with the anchor', async () => {
    const r = rig();
    const m = await r.run();
    r.ready(0);
    m.remount!({ layout: 'guided' });
    await vi.waitFor(() => { expect(r.mount).toHaveBeenCalledTimes(2); });
    m.openAt!('x');
    expect(layoutsOf(r)).toEqual(['default', 'guided', 'guided']);
    const reopened = (r.mount.mock.calls[2] as unknown as [HTMLElement, { document: RenderInput }])[1].document;
    expect(reopened.initialHash).toBe('x');
  });
});

// Under the `remount` rule, pinned through the `layoutRule` holder above (the shipped rule is `default-only`): the cases that enter from
// another layout and leave are the remount machinery's, kept tested for the day the rule flips back.
describe('layouts: the body and reader mode, under the remount rule (X2 P5.1)', () => {
  beforeEach(() => {
    for (const f of Object.values(placesFake)) f.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
    while (restorers.length > 0) restorers.pop()?.();
  });

  const PREF = JSON.stringify({ theme: 'dark', layout: 'review' });
  /** A screen with one ready body whose mount is in the stored layout `pref` (none stored: the default), nothing entered. */
  async function layoutScreen(o: {
    pref: ReaderLayout | null; phone?: true; timers?: boolean; link?: Omit<DocLinkContextValue, 'urls'>; keep?: true;
  }): Promise<{ rig: BodyRig; places: ReturnType<typeof placesPort>; view: ReturnType<typeof render> }> {
    if (o.timers === true) vi.useFakeTimers();
    if (o.pref !== null) window.localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: 'dark', layout: o.pref }));
    const rig = bodyRig({ layout: true, ...(o.keep === true ? { keep: true } : {}) });
    const places = placesPort();
    const view = render(
      <Screen
        doc={KEY_A} rig={rig} bodyKey="k1" places={places}
        {...(o.phone === true ? { phone: true as const } : {})} {...(o.link === undefined ? {} : { link: o.link })}
      />,
    );
    await flush();
    await frameReady(rig, 0);
    return { rig, places, view };
  }
  const host = (): Element | null => document.querySelector('.docs-reader');

  it('remount: waits 400 ms after the last progress message', async () => {
    // X6.23: a remount that does not wait for the quiet reds here.
    const { rig } = await layoutScreen({ pref: 'review', timers: true });
    expect(rig.inputs[0]!.layout, 'CONTROL: the body mounted in the stored layout').toBe('review');
    act(() => { rig.inputs[0]!.onProgress!(0.3); });
    await advance(100);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
    expect(rig.mounts[0]!.remount, 'remounted 100 ms after a progress message').not.toHaveBeenCalled();
    expect(rig.mounts[0]!.setReading, 'the reading went to the frame that is about to be replaced').not.toHaveBeenCalled();
    await advance(299);
    expect(rig.mounts[0]!.remount, 'remounted 399 ms after the progress message').not.toHaveBeenCalled();
    // Another message meanwhile moves the quiet on: the wait is read again when it ends.
    act(() => { rig.inputs[0]!.onProgress!(0.31); });
    await advance(1);
    expect(rig.mounts[0]!.remount, 'remounted before the frame had been quiet for 400 ms').not.toHaveBeenCalled();
    await advance(399);
    expect(rig.mounts[0]!.remount).toHaveBeenCalledTimes(1);
    expect(rig.mounts[0]!.remount).toHaveBeenCalledWith(asked('default', 'screens'));
  });

  it('remount: a turn change during the quiet wait remounts in default with the new turn, and nothing reaches the old frame', async () => {
    // I2: the decision reads the layout the bridge was last ASKED to mount, which a request still waiting has not changed.
    const { rig } = await layoutScreen({ pref: 'review', timers: true });
    const m = rig.mounts[0]!;
    act(() => { rig.inputs[0]!.onProgress!(0.3); });
    await advance(100);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
    await advance(100);
    act(() => { latest.setTurn('scroll'); });
    expect(m.setReading, 'the new turn reached the review frame that is about to be replaced').not.toHaveBeenCalled();
    await advance(199);
    expect(m.remount, 'remounted before the frame had been quiet for 400 ms').not.toHaveBeenCalled();
    await advance(1);
    expect(m.remount, 'the turn change dropped the remount').toHaveBeenCalledTimes(1);
    expect(m.remount).toHaveBeenCalledWith(asked('default', 'scroll'));
    expect(m.setReading, 'a reading reached the old frame').not.toHaveBeenCalled();
  });

  it('remount: leaving during the quiet wait cancels it and remounts nothing', async () => {
    // I2: entering was never carried out, so leaving has nothing to give back: the review frame stays, its reading off.
    const { rig } = await layoutScreen({ pref: 'review', timers: true });
    const m = rig.mounts[0]!;
    act(() => { rig.inputs[0]!.onProgress!(0.3); });
    await advance(100);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
    await advance(100);
    act(() => { latest.exit('exit-tap'); });
    expect(latest.state.on).toBe(false);
    await advance(2000);
    expect(m.remount, 'a remount ran after leaving').not.toHaveBeenCalled();
    expect(rig.mounts, 'a second mount was made').toHaveLength(1);
    expect(m.setReading, 'the review frame was not told reader mode is off').toHaveBeenLastCalledWith('off');
    expect(m.setReading.mock.calls.filter((c) => c[0] !== 'off'), 'the review frame was told to read').toEqual([]);
  });

  it('remount: a same-page link during the quiet wait keeps the anchor, and the frame it opens is remounted in default once the wait is over', async () => {
    // M1, the body's half: the anchor wins over the waiting remount, which is dropped. I-4c: the frame the anchor opened is in the layout
    // the mount has (review), and reader mode reads in default, so the body asks `readerLayoutRemount` again for it: the remount is
    // scheduled anew, behind the quiet wait, with the reading, instead of setting the reading on a review frame in place.
    const { rig } = await layoutScreen({ pref: 'review', timers: true });
    const m = rig.mounts[0]!;
    act(() => { rig.inputs[0]!.onProgress!(0.3); });
    await advance(100);
    act(() => { latest.enter('button'); });
    expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
    act(() => { rig.inputs[0]!.onLink({ kind: 'relative', path: 'a.md', fragment: 'x' }); });
    expect(m.openAt, 'the link did not reopen the frame at its anchor').toHaveBeenCalledWith('x');
    expect(m.setReading, 'reader mode went on in place in the review frame the anchor opened').not.toHaveBeenCalled();
    await advance(2000);
    expect(m.remount, 'the frame the anchor opened was left in review under reader mode').toHaveBeenCalledTimes(1);
    expect(m.remount).toHaveBeenCalledWith(asked('default', 'screens'));
    expect(m.setReading, 'a reading reached the review frame').not.toHaveBeenCalled();
  });

  it('default-only: a Layout choice still loading to guided is not offered reader mode, and r does nothing', async () => {
    // I-1: the published frame names the layout it is on its way to (`issued`), not the one it still carries, so the offer, the note and
    // `r` read the layout on its way; and the published `setReading` is a backstop that never sends a reading to a layout the rule refuses.
    layoutRule.value = 'default-only';
    const rig = bodyRig({ layout: true, pending: true });
    render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={placesPort()} />);
    await flush();
    await frameReady(rig, 0);
    expect(latest.frame?.layout, 'CONTROL: the frame is in the default layout').toBe('default');
    expect(latest.offered, 'CONTROL: reader mode is offered in default').toBe(true);
    act(() => { chooseReaderLayout('guided'); });
    expect(rig.mounts[0]!.remount, 'CONTROL: the choice reached the frame, whose texts are still loading').toHaveBeenCalledWith(asked('guided', 'off'));
    expect(latest.frame?.layout, 'the published frame still says default while it loads guided').toBe('guided');
    expect(latest.offered, 'reader mode was offered while the frame was on its way to guided').toBe(false);
    expect(readerModeHandle()?.available()).toBe(false);
    expect(latest.layoutNote, 'the note beside the Layout row').toBe(READER_LAYOUT_TEXT.note);
    // `r`: the registry's own command, as the key runs it, and the frame's own `r` (its toggle op).
    const r = baseCommands().find((c) => c.id === 'toggle-reader-mode')!;
    act(() => { r.run({} as CommandContext); });
    act(() => { latest.frameToggle(); });
    expect(latest.state.on, 'r started reader mode on a frame on its way to guided').toBe(false);
    // The backstop: a reading reaches the published frame anyway, and is not sent.
    act(() => { latest.frame!.setReading('screens'); });
    expect(rig.mounts[0]!.setReading, 'a reading was sent to a frame on its way to a layout the rule refuses').not.toHaveBeenCalled();
    // Off is always sent.
    act(() => { latest.frame!.setReading('off'); });
    expect(rig.mounts[0]!.setReading).toHaveBeenCalledWith('off');
  });

  it('remount: a frame that is kept after a layout chunk fails to load is where the body goes on from', async () => {
    // M3, the body's half: the bridge kept the frame and says so (`onKept`); the hold on the host lifts, the published frame says the
    // layout it still has, and leaving then sets the reading in place instead of mounting a layout the frame already carries.
    vi.useFakeTimers();
    const { rig } = await layoutScreen({ pref: 'review', keep: true });
    const m = rig.mounts[0]!;
    act(() => { latest.enter('button'); });
    await advance(0);
    expect(m.remount, 'CONTROL: entering asked for default').toHaveBeenCalledTimes(1);
    await advance(40);
    expect(host()?.hasAttribute('data-reader-hold'), 'the host stays held after a failed remount').toBe(false);
    expect(latest.frame?.layout, 'the published frame names the layout it has').toBe('review');
    act(() => { latest.exit('exit-tap'); });
    await advance(0);
    expect(m.remount, 'leaving mounted a layout the frame already carries').toHaveBeenCalledTimes(1);
    expect(m.setReading).toHaveBeenLastCalledWith('off');
  });

  it('remount: a layout chosen while the mount is still loading is asked for once it lands, unless the frame is already in it', async () => {
    // M4: the one decider (`readerLayoutChoice`) is asked here as it is for a choice made on a landed mount.
    let open: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => { open = resolve; });
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ layout: 'review' }));
    const rig = bodyRig({ layout: true, gate });
    render(<Screen doc={KEY_A} rig={rig} bodyKey="k1" places={placesPort()} />);
    await flush();
    expect(rig.mounts, 'CONTROL: the mount is still loading').toHaveLength(0);
    act(() => { chooseReaderLayout('guided'); });
    open();
    await flush();
    expect(rig.mounts[0]!.remount, 'a choice made while the mount loaded was lost').toHaveBeenCalledWith(asked('guided', 'off'));
    // A choice of the layout the mount was made in, while it loads, asks for nothing.
    cleanup();
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ layout: 'review' }));
    let open2: () => void = () => undefined;
    const gate2 = new Promise<void>((resolve) => { open2 = resolve; });
    const rig2 = bodyRig({ layout: true, gate: gate2 });
    render(<Screen doc={KEY_A} rig={rig2} bodyKey="k1" places={placesPort()} />);
    await flush();
    act(() => { chooseReaderLayout('review'); });
    open2();
    await flush();
    expect(rig2.mounts[0]!.remount).not.toHaveBeenCalled();
  });

  it('remount: a phone mount in the default layout enters in place, with no remount', async () => {
    for (const phone of [true, undefined] as const) {
      const { rig } = await layoutScreen({ pref: null, ...(phone === true ? { phone } : {}) });
      expect(rig.inputs[0]!.chrome, 'CONTROL: the mount is on the bar the width asked for').toBe(phone === true ? 'host-bar' : 'frame-bar');
      expect(rig.inputs[0]!.layout).toBe('default');
      act(() => { latest.enter('button'); });
      await flush();
      expect(latest.state.on).toBe(true);
      expect(rig.mounts[0]!.setReading, 'entered in place').toHaveBeenCalledWith('screens');
      expect(rig.mounts[0]!.remount, 'the default layout was mounted again').not.toHaveBeenCalled();
      expect(rig.mounts, 'a second mount was made').toHaveLength(1);
      act(() => { latest.exit('exit-tap'); });
      expect(rig.mounts[0]!.setReading).toHaveBeenLastCalledWith('off');
      expect(rig.mounts[0]!.remount, 'leaving mounted the default layout again').not.toHaveBeenCalled();
      cleanup();
      window.localStorage.clear();
    }
  });

  it('remount: entering from review remounts in default, on a phone too, and leaving restores review', async () => {
    // X6.59: entering that keeps the reader's layout reds here.
    for (const phone of [true, undefined] as const) {
      const { rig, places } = await layoutScreen({ pref: 'review', ...(phone === true ? { phone } : {}) });
      const m = rig.mounts[0]!;
      expect(rig.inputs[0]!.layout, 'CONTROL: the body mounted in review').toBe('review');
      expect(latest.frame?.layout, 'CONTROL: the published frame says review').toBe('review');
      act(() => { latest.enter('button'); });
      await flush();
      expect(latest.state.on).toBe(true);
      expect(m.remount, `entering from review did not remount in default (${phone === true ? 'phone' : 'desk'})`).toHaveBeenCalledTimes(1);
      expect(m.remount).toHaveBeenLastCalledWith(asked('default', 'screens'));
      expect(m.setReading, 'the reading was set in place on the review frame').not.toHaveBeenCalled();
      // The new mount reports ready: it is published, in the layout it now carries.
      await frameReady(rig, 0);
      expect(latest.frame?.layout, 'the published frame is the default layout\'s').toBe('default');
      // Leaving: the reader's own layout comes back, and reader mode's reading ends with it.
      act(() => { latest.exit('exit-tap'); });
      await flush();
      expect(latest.state.on).toBe(false);
      expect(m.remount, 'leaving did not restore review').toHaveBeenCalledTimes(2);
      expect(m.remount).toHaveBeenLastCalledWith(asked('review', 'off'));
      // Reader mode never writes the layout pref.
      expect(window.localStorage.getItem(PREFS_KEY), 'reader mode wrote the stored layout').toBe(PREF);
      expect(places.push).toHaveBeenCalledTimes(1);
      cleanup();
      window.localStorage.clear();
    }
  });

  // One case per layout the reader may stand in besides the default (P5.1, AR-2). Each is made fresh (a stored pref of that layout),
  // enters from it and leaves, on a desk and on a phone.
  for (const layout of ['classic', 'editorial', 'review', 'guided'] as const) {
    it(`remount: entering from ${layout} remounts in default and leaving restores ${layout}`, async () => {
      for (const phone of [undefined, true] as const) {
        const where = `${layout}, ${phone === true ? 'phone' : 'desk'}`;
        const stored = JSON.stringify({ theme: 'dark', layout });
        const { rig, places } = await layoutScreen({ pref: layout, ...(phone === true ? { phone } : {}) });
        const m = rig.mounts[0]!;
        expect(rig.inputs[0]!.layout, `CONTROL (${where}): the body mounted in the stored layout`).toBe(layout);
        act(() => { latest.enter('button'); });
        await flush();
        expect(latest.state.on, `${where}: reader mode is on`).toBe(true);
        expect(m.remount, `${where}: entering did not remount in default`).toHaveBeenCalledTimes(1);
        expect(m.remount, `${where}: entering did not remount in default`).toHaveBeenLastCalledWith(asked('default', 'screens'));
        expect(m.setReading, `${where}: the reading was set in place on the ${layout} frame`).not.toHaveBeenCalled();
        await frameReady(rig, 0);
        expect(latest.frame?.layout, `${where}: the published frame is the default layout's`).toBe('default');
        act(() => { latest.exit('exit-tap'); });
        await flush();
        expect(latest.state.on, `${where}: reader mode is off`).toBe(false);
        expect(m.remount, `${where}: leaving did not restore ${layout}`).toHaveBeenCalledTimes(2);
        expect(m.remount, `${where}: leaving did not restore ${layout}`).toHaveBeenLastCalledWith(asked(layout, 'off'));
        expect(window.localStorage.getItem(PREFS_KEY), `${where}: reader mode wrote the stored layout`).toBe(stored);
        expect(places.push, `${where}: one place was pushed`).toHaveBeenCalledTimes(1);
        cleanup();
        window.localStorage.clear();
      }
    });
  }

  it('remount: with ?variant=B on the page, reader mode reads in default and leaving restores review, and the stored pref is untouched', async () => {
    // The visit's `?variant=B` (`DOCS_VARIANT_LAYOUT`: review) beats the stored classic for this visit; reader mode takes neither.
    const link = { ...LINK, pageVariant: 'review' as const };
    const stored = JSON.stringify({ theme: 'dark', layout: 'classic' });
    for (const phone of [undefined, true] as const) {
      const where = phone === true ? 'phone' : 'desk';
      const { rig } = await layoutScreen({ pref: 'classic', link, ...(phone === true ? { phone } : {}) });
      const m = rig.mounts[0]!;
      expect(rig.inputs[0]!.layout, `CONTROL (${where}): the visit's variant beats the stored layout`).toBe('review');
      act(() => { latest.enter('button'); });
      await flush();
      expect(m.remount, `${where}: entering did not remount in default`).toHaveBeenCalledTimes(1);
      expect(m.remount).toHaveBeenLastCalledWith(asked('default', 'screens'));
      await frameReady(rig, 0);
      act(() => { latest.exit('exit-tap'); });
      await flush();
      expect(m.remount, `${where}: leaving did not restore the visit's review`).toHaveBeenCalledTimes(2);
      expect(m.remount).toHaveBeenLastCalledWith(asked('review', 'off'));
      expect(window.localStorage.getItem(PREFS_KEY), `${where}: the stored pref was changed`).toBe(stored);
      cleanup();
      window.localStorage.clear();
    }
  });

  it('remount: a layout chosen from the Layout row while reader mode is off mounts again at once; while it is on, leaving gives the choice back', async () => {
    const { rig } = await layoutScreen({ pref: 'review' });
    const m = rig.mounts[0]!;
    act(() => { chooseReaderLayout('guided'); });
    expect(m.remount, 'the choice did not reach the frame in the same task').toHaveBeenCalledWith(asked('guided', 'off'));
    await frameReady(rig, 0);
    // The same layout again asks for nothing.
    act(() => { chooseReaderLayout('guided'); });
    expect(m.remount).toHaveBeenCalledTimes(1);
    // Reader mode on: the frame goes to default, and a choice made now waits; leaving restores it, not the stored review.
    act(() => { latest.enter('button'); });
    await flush();
    expect(m.remount).toHaveBeenLastCalledWith(asked('default', 'screens'));
    await frameReady(rig, 0);
    act(() => { chooseReaderLayout('classic'); });
    expect(m.remount, 'a choice remounted the frame while reader mode held it in default').toHaveBeenCalledTimes(2);
    act(() => { latest.exit('exit-tap'); });
    await flush();
    expect(m.remount).toHaveBeenLastCalledWith(asked('classic', 'off'));
    // A body that has ended hears no more choices.
    cleanup();
    const after = m.remount.mock.calls.length;
    chooseReaderLayout('editorial');
    expect(m.remount.mock.calls.length).toBe(after);
  });

  it('remount: under default-only, nothing remounts for the layout, because reader mode is not offered outside default', async () => {
    layoutRule.value = 'default-only';
    const { rig } = await layoutScreen({ pref: 'review' });
    expect(latest.frame?.layout, 'CONTROL: the frame is in review').toBe('review');
    expect(latest.offered, 'reader mode was drawn outside the default layout').toBe(false);
    expect(readerModeHandle()?.available(), 'r is available outside the default layout').toBe(false);
    expect(latest.layoutNote, 'the note beside the Layout row').toBe(READER_LAYOUT_TEXT.note);
    act(() => { latest.enter('button'); });
    await flush();
    expect(latest.state.on, 'reader mode started outside the default layout').toBe(false);
    expect(rig.mounts[0]!.remount).not.toHaveBeenCalled();
    expect(rig.mounts[0]!.setReading).not.toHaveBeenCalled();
    expect(rig.mounts).toHaveLength(1);
    // In the default layout it is offered, and entered in place: nothing to remount for.
    cleanup();
    window.localStorage.clear();
    const def = await layoutScreen({ pref: null });
    expect(latest.offered).toBe(true);
    expect(latest.layoutNote).toBeNull();
    act(() => { latest.enter('button'); });
    await flush();
    expect(latest.state.on).toBe(true);
    expect(def.rig.mounts[0]!.setReading).toHaveBeenCalledWith('screens');
    expect(def.rig.mounts[0]!.remount).not.toHaveBeenCalled();
  });

  it('mount plan: while reader mode is on, a same-document remount (a new commit, or openAt) is planned in default, whatever the stored layout pref', async () => {
    // X6.68's layout half: a mount plan that ignores reader mode's state reds here.
    const body = await layoutScreen({ pref: 'review' });
    expect(body.rig.inputs[0]!.layout, 'CONTROL: a body made while reader mode is off is in the stored layout').toBe('review');
    act(() => { latest.enter('button'); });
    await flush();
    expect(body.rig.mounts[0]!.remount).toHaveBeenLastCalledWith(asked('default', 'screens'));
    await frameReady(body.rig, 0);
    // A new commit of the document while reader mode is on: its body is made in the default layout, not the stored one.
    body.view.rerender(<Screen doc={KEY_A} rig={body.rig} bodyKey="k2" places={body.places} />);
    await flush();
    expect(body.rig.inputs[1]!.reading, 'CONTROL: the new body is made under the reading').toBe('screens');
    expect(body.rig.inputs[1]!.layout, 'a new commit made while reader mode is on was planned in the stored layout').toBe('default');
    expect(window.localStorage.getItem(PREFS_KEY), 'the stored layout is untouched').toBe(PREF);
    // After leaving, a later commit is in the stored layout again.
    act(() => { latest.exit('exit-tap'); });
    body.view.rerender(<Screen doc={KEY_A} rig={body.rig} bodyKey="k3" places={body.places} />);
    await flush();
    expect(body.rig.inputs[2]!.layout).toBe('review');
    // A same-page reopening (openAt) is made in the layout the live mount is in: the bridge keeps it, default while reader mode is on.
    const r = rig({ layout: 'review' });
    const m = await r.run();
    r.ready(0);
    m.remount!({ layout: 'default', reading: 'screens' });
    await vi.waitFor(() => { expect(r.mount).toHaveBeenCalledTimes(2); });
    m.openAt!('x');
    expect(layoutsOf(r)).toEqual(['review', 'default', 'default']);
  });

  it('focus: the frame is focused on the new mount\'s ready, after entering and after leaving', async () => {
    const { rig } = await layoutScreen({ pref: 'review', timers: true });
    const m = rig.mounts[0]!;
    act(() => { latest.enter('button'); });
    await advance(0);
    expect(m.remount, 'CONTROL: entering remounted').toHaveBeenCalledTimes(1);
    expect(host()?.hasAttribute('data-reader-hold'), 'the remounted frame is held under the reading ground').toBe(true);
    const asked = m.focus.mock.calls.length;
    // The new mount's ready: the hold lifts after two animation frames and the frame is given the focus it could not take hidden.
    await frameReady(rig, 0);
    await advance(20);
    expect(m.focus.mock.calls.length, 'focused before the hold lifted').toBe(asked);
    await advance(20);
    expect(host()?.hasAttribute('data-reader-hold'), 'the hold lifted').toBe(false);
    expect(m.focus.mock.calls.length, 'the frame was not focused at the new mount\'s ready after entering').toBe(asked + 1);
    // Leaving: the same, for the mount that gives the reader's own layout back.
    act(() => { latest.exit('exit-tap'); });
    await advance(0);
    expect(m.remount, 'CONTROL: leaving remounted').toHaveBeenCalledTimes(2);
    expect(host()?.hasAttribute('data-reader-hold'), 'the restored frame is held').toBe(true);
    const askedOnLeaving = m.focus.mock.calls.length;
    await frameReady(rig, 0);
    await advance(40);
    expect(host()?.hasAttribute('data-reader-hold')).toBe(false);
    expect(m.focus.mock.calls.length, 'the frame was not focused at the new mount\'s ready after leaving').toBe(askedOnLeaving + 1);
  });

  it('remount: a body that ends while a remount waits drops it, and a mount without remount is set in place', async () => {
    const { rig, view } = await layoutScreen({ pref: 'review', timers: true });
    act(() => { rig.inputs[0]!.onProgress!(0.3); });
    act(() => { latest.enter('button'); });
    expect(rig.mounts[0]!.remount).not.toHaveBeenCalled();
    view.unmount();
    await advance(1000);
    expect(rig.mounts[0]!.remount, 'a remount fired after its body ended').not.toHaveBeenCalled();
    cleanup();
    // The older mounts (no `remount`, no `layout`) are entered in place, as they always were.
    vi.useRealTimers();
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ layout: 'review' }));
    const plain = bodyRig();
    const places = placesPort();
    render(<Screen doc={KEY_A} rig={plain} bodyKey="k1" places={places} />);
    await flush();
    await frameReady(plain, 0);
    act(() => { latest.enter('button'); });
    await flush();
    expect(plain.mounts[0]!.setReading).toHaveBeenCalledWith('screens');
  });
});

// ─── the body over the REAL bridge, under the remount rule (X2 P5.1, I-4) ───────────────────────────────────────────────────────
//
// The rig above fakes the bridge, so what the bridge answers a request is whatever the fake says. These cases run the body over the real
// `mountReader` with a fake library mount and layout texts held until released, so a dropped or riding request is the bridge's own.

interface LibFrame {
  readonly adapters: HostAdapters;
  readonly document: RenderInput;
  readonly destroy: Mock<() => void>;
  readonly setReading: Mock<(mode: string) => void>;
}

/** A body rig whose `mount` is the real bridge over a fake library mount. The layout texts of each layout in `held` wait until
 *  `release(layout)`; every other layout's come at once. */
function bridgeRig(held: readonly ReaderLayout[]): { rig: BodyRig; frames: LibFrame[]; release: (l: ReaderLayout) => void } {
  const frames: LibFrame[] = [];
  const releases = new Map<ReaderLayout, () => void>();
  const libraryMount = vi.fn((target: HTMLElement, o: { document: RenderInput; adapters: HostAdapters }) => {
    const iframe = target.ownerDocument.createElement('iframe');
    iframe.setAttribute('tabindex', '-1');
    target.replaceChildren(iframe);
    const f: LibFrame = {
      adapters: o.adapters, document: o.document, destroy: vi.fn(), setReading: vi.fn(),
    };
    frames.push(f);
    return { ...f, setPrefs: vi.fn(), setAppearance: vi.fn() } as unknown as DocFrame;
  });
  const reader: ReaderDeps = {
    render: async () => RENDERED,
    images: async () => ({ urls: {}, drafts: 0, auth: 0 }),
    mount: (el, input) => mountReader(el, input, {
      mount: libraryMount as unknown as typeof mountDocFrame, store: () => null, mermaid: () => Promise.resolve('M'),
      e17: 'does-not-hold', libraryContract: () => 'none',
      assets: (layout) => (held.includes(layout)
        ? new Promise((resolve) => { releases.set(layout, () => resolve(stubAssetsOf(layout))); })
        : Promise.resolve(stubAssetsOf(layout))),
    }),
  };
  return { rig: { reader, inputs: [], mounts: [], log: [] }, frames, release: (l) => { releases.get(l)!(); } };
}

describe('layouts: the body over the real bridge, under the remount rule (X2 P5.1, I-4)', () => {
  beforeEach(() => {
    for (const f of Object.values(placesFake)) f.mockClear();
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    window.localStorage.clear();
  });

  const host = (): Element | null => document.querySelector('.docs-reader');
  /** A screen in the stored layout `review`, its first frame ready, the default layout's texts held. Fake timers. */
  async function bridgeScreen(): Promise<ReturnType<typeof bridgeRig>> {
    vi.useFakeTimers();
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ theme: 'dark', layout: 'review' }));
    const b = bridgeRig(['default']);
    render(<Screen doc={KEY_A} rig={b.rig} bodyKey="k1" places={placesPort()} />);
    await flush();
    expect(b.frames, 'CONTROL: the body mounted a frame in review').toHaveLength(1);
    expect(b.frames[0]!.adapters.layout).toBe('review');
    await act(async () => { b.frames[0]!.adapters.onReady!(); });
    return b;
  }

  it('remount: leaving while the entry\'s default load is pending releases the hold and shows the document', async () => {
    // I-4a: entering from review holds the host and asks for default, whose texts are still loading; leaving asks for review, the
    // layout the frame still carries. The bridge's same-layout arm drops the request and mounts nothing, so no `ready` comes to lift the
    // hold: the arm tells the caller, which releases it.
    const b = await bridgeScreen();
    act(() => { latest.enter('button'); });
    await advance(0);
    expect(host()?.hasAttribute('data-reader-hold'), 'CONTROL: entering holds the host while its default frame loads').toBe(true);
    act(() => { latest.exit('exit-tap'); });
    await advance(0);
    await advance(60);
    expect(host()?.hasAttribute('data-reader-hold'), 'the document stayed hidden under a hold nothing would lift').toBe(false);
    expect(b.frames, 'CONTROL: nothing was mounted again').toHaveLength(1);
    b.release('default');
    await flush();
    await advance(60);
    expect(b.frames, 'the dropped default load mounted when its texts came').toHaveLength(1);
    expect(host()?.hasAttribute('data-reader-hold')).toBe(false);
  });

  it('remount: a same-page link while entering reads in default', async () => {
    // I-4b: an anchor link made while the entry's default texts load rides that swap. The frame it opens is the default one (reader mode
    // reads in default), and the body goes on knowing the frame is on its way to default: leaving then gives review back.
    const b = await bridgeScreen();
    act(() => { latest.enter('button'); });
    await advance(0);
    act(() => { b.frames[0]!.adapters.onLink!({ kind: 'relative', path: 'a.md', fragment: 'x' } as never); });
    expect(b.frames, 'the link mounted a frame before the default texts came').toHaveLength(1);
    b.release('default');
    await flush();
    expect(b.frames, 'the swap did not mount').toHaveLength(2);
    expect(Object.keys(b.frames[1]!.adapters), 'the frame the anchor opened is not in the default layout').not.toContain('layout');
    expect(b.frames[1]!.document.initialHash).toBe('x');
    expect(b.frames[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(b.frames[1]!.setReading, 'reader mode did not go on in the frame the anchor opened').toHaveBeenCalledWith('screens');
    await act(async () => { b.frames[1]!.adapters.onReady!(); });
    await advance(60);
    expect(host()?.hasAttribute('data-reader-hold')).toBe(false);
    // Leaving gives the reader's own layout back: the body still knew the frame as default-bound, so it asks for review.
    act(() => { latest.exit('exit-tap'); });
    await advance(0);
    expect(b.frames, 'leaving did not remount into review').toHaveLength(3);
    expect(b.frames[2]!.adapters.layout).toBe('review');
  });
});
