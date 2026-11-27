// Docs W8a Task 7: `docs/reader/bridge.ts`, the one adapter over the shared Markdown library's host mount. The
// adapters it hands the library are the whole of ccrc's control over the frame, so most cases inject a `mount` spy and
// read what it was given; the last group mounts the installed library for real (jsdom measured `MessageChannel` and
// an iframe `srcdoc` load, both yes, at Step 0). Every page is a placeholder (`demo`, `a/b.md`); control characters
// are built with `String.fromCharCode`.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_MANIFEST, frameCsp, isAnchorToken, mermaidGate, type RenderInput } from '@synapsium-labs/pinax-lib/frame';
import type { DocFrame, HostAdapters, HostLink, mountDocFrame, HiddenChar } from '@synapsium-labs/pinax-lib/host';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import type { EnumerableStoragePort } from '../src/lib/storage';
import {
  docsDrawFor, READER_E17_MERMAID, readerDocKey, readerMountPlan, readerWatchdogMs,
  type ReaderChrome, type ReaderE17Reading, type ReaderLink,
} from '../src/docs/reader/policy';
import { READER_LAB_DRAW_WATCHDOG_MS } from '../src/lib/readerLimits';
import { loadReaderAssets, loadReaderFonts } from '../src/docs/reader/assets';
import { READER_APPEARANCE_MAP } from '../src/docs/reader/appearance';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { parseAppearance } from '@synapsium-labs/pinax-lib/frame';
import { mountReader, TOP_TOKEN, type ReaderMountInput } from '../src/docs/reader/bridge';
import type { ReaderVersionSeed } from '../src/docs/reader/history';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

const SHA40 = 'a'.repeat(40);
const SHA64 = 'b'.repeat(64);

const mermaidCounts = (fences: number, largestChars: number, totalChars: number) =>
  ({ fences, largestBytes: largestChars, totalBytes: totalChars, largestChars, totalChars });

/** A rendered document, optionally with a Mermaid scan and a version. */
function docOf(extra: Partial<RenderInput> = {}): RenderInput {
  return { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: 'T', frontList: null } }, ...extra };
}

/** A `Storage`-shaped port over a map, recording every key asked for. */
function fakeStore(seed: Record<string, string> = {}): EnumerableStoragePort & { touched: string[]; data: Map<string, string> } {
  const data = new Map(Object.entries(seed));
  const touched: string[] = [];
  return {
    data, touched,
    getItem: (k) => { touched.push(k); return data.get(k) ?? null; },
    setItem: (k, v) => { touched.push(k); data.set(k, v); },
    removeItem: (k) => { touched.push(k); data.delete(k); },
    key: (i) => [...data.keys()][i] ?? null,
    get length() { return data.size; },
  } as EnumerableStoragePort & { touched: string[]; data: Map<string, string> };
}

const STUB_ASSETS = { guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' };

interface Rig {
  readonly input: { [K in keyof ReaderMountInput]: ReaderMountInput[K] };
  readonly frame: {
    update: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn>; setAppearance: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn>; closeOverlay: ReturnType<typeof vi.fn>; goto: ReturnType<typeof vi.fn>;
  };
  readonly mount: ReturnType<typeof vi.fn>;
  readonly mermaid: ReturnType<typeof vi.fn>;
  readonly options: () => { document: RenderInput; adapters: HostAdapters };
  /** What the nth mount call was given (0-based). */
  readonly optionsAt: (n: number) => { document: RenderInput; adapters: HostAdapters };
  /** Every frame the mount spy returned, in order; the first is `frame`. */
  readonly frames: Rig['frame'][];
  /** One entry per mount call and per frame destroy, in the order they happened: `mount 0`, `destroy 0`, `mount 1`... */
  readonly order: string[];
  readonly run: () => ReturnType<typeof mountReader>;
}

/** A rig: an injected `mount` spy that records its options, a stub asset loader and a store (or none). */
function rig(o: {
  document?: RenderInput; bytes?: number; docKey?: string | null; store?: EnumerableStoragePort | null;
  assets?: () => Promise<typeof STUB_ASSETS>; mermaid?: () => Promise<string>;
  /** The E17 reading the deps plan with (default `does-not-hold`: on request); `'recorded'` passes no `e17` dep at all. */
  e17?: ReaderE17Reading | 'recorded'; chrome?: ReaderChrome; onProgress?: (share: number) => void; onMermaidDrop?: () => void;
  /** The history members and the profile a mount is given (default: none, the Docs reader with no history input). */
  profile?: 'lab-draw'; version?: ReaderVersionSeed; changes?: ReaderMountInput['changes']; openVersion?: ReaderMountInput['openVersion'];
  /** The element mounted into (default: a detached div). */
  el?: HTMLElement;
  appearanceRoot?: HTMLElement;
  libraryContract?: () => number | 'none';
  fonts?: () => Promise<{ sans: string; mono: string }>;
  strictOld?: boolean;
  validateAppearance?: boolean;
  onMount?: () => void;
  /** The place callback a mount is given (default: none, as the reader lab's mounts). */
  onPlace?: ReaderMountInput['onPlace'];
} = {}): Rig {
  const order: string[] = [];
  const newFrame = (): Rig['frame'] => {
    const n = frames.length;
    const f = {
      update: vi.fn(), setPrefs: vi.fn(), setAppearance: vi.fn(), destroy: vi.fn(() => { order.push(`destroy ${n}`); }), command: vi.fn(),
      closeOverlay: vi.fn(), goto: vi.fn(),
    };
    frames.push(f);
    return f;
  };
  const frames: Rig['frame'][] = [];
  const frame = newFrame();
  const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => {
    o.onMount?.();
    if (o.strictOld) {
      const keys = ['assets', 'copy', 'docKey', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs', 'loadMermaid', 'features', 'onProgress', 'changes', 'openVersion'];
      if (Object.keys(_o.adapters).some((key) => !keys.includes(key)) || 'fonts' in _o.adapters.assets) throw new TypeError('unknown adapter');
    }
    if (o.validateAppearance && _o.adapters.appearance !== undefined) {
      if (JSON.stringify(parseAppearance(_o.adapters.appearance).appearance) !== JSON.stringify(_o.adapters.appearance)) throw new TypeError('unvalidated appearance');
    }
    order.push(`mount ${mount.mock.calls.length - 1}`);
    return (mount.mock.calls.length === 1 ? frame : newFrame()) as unknown as DocFrame;
  });
  const mermaid = vi.fn(o.mermaid ?? (() => Promise.resolve('MERMAID')));
  const input: ReaderMountInput = {
    document: o.document ?? docOf(),
    bytes: o.bytes ?? 100,
    docKey: o.docKey === undefined ? 'demo:sec:a/b.md' : o.docKey,
    title: 'b.md',
    prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    ...(o.chrome === undefined ? {} : { chrome: o.chrome }),
    ...(o.onProgress === undefined ? {} : { onProgress: o.onProgress }),
    ...(o.onMermaidDrop === undefined ? {} : { onMermaidDrop: o.onMermaidDrop }),
    ...(o.profile === undefined ? {} : { profile: o.profile }),
    ...(o.version === undefined ? {} : { version: o.version }),
    ...(o.changes === undefined ? {} : { changes: o.changes }),
    ...(o.openVersion === undefined ? {} : { openVersion: o.openVersion }),
    ...(o.appearanceRoot === undefined ? {} : { appearanceRoot: o.appearanceRoot }),
    ...(o.onPlace === undefined ? {} : { onPlace: o.onPlace }),
  };
  const store = o.store === undefined ? fakeStore() : o.store;
  const run = () => mountReader(o.el ?? document.createElement('div'), input, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => store,
    assets: o.assets ?? (() => Promise.resolve(STUB_ASSETS)),
    mermaid,
    ...(o.libraryContract === undefined ? {} : { libraryContract: o.libraryContract }),
    ...(o.fonts === undefined ? {} : { fonts: o.fonts }),
    ...(o.e17 === 'recorded' ? {} : { e17: o.e17 ?? 'does-not-hold' }),
  });
  return {
    input, frame, frames, order, mount, mermaid, run,
    options: () => mount.mock.calls[0]![1], optionsAt: (n) => mount.mock.calls[n]![1],
  };
}

describe('host appearance', () => {
  function root(): HTMLElement {
    const el = document.createElement('div');
    document.body.append(el);
    el.dataset.skin = 'refined'; el.dataset.theme = 'first';
    el.style.setProperty('color-scheme', 'light');
    for (const token of Object.values(READER_APPEARANCE_MAP.colour)) el.style.setProperty(token, '#123456');
    return el;
  }
  const fonts = { sans: 'sans', mono: 'mono' };

  it.each(['assets', 'mermaid', 'fonts'] as const)('reads after the %s wait and again on remount', async (held) => {
    const el = root();
    let release!: () => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const wait = async <T,>(value: T): Promise<T> => { entered(); await gate; return value; };
    const computed = window.getComputedStyle.bind(window);
    let yielded = false;
    const read = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      yielded = false;
      queueMicrotask(() => { yielded = true; });
      return computed(element, pseudo);
    });
    const r = rig({ appearanceRoot: el,
      document: docOf({ scan: { mermaid: mermaidCounts(1, 10, 10) } }),
      assets: () => held === 'assets' ? wait(STUB_ASSETS) : Promise.resolve(STUB_ASSETS),
      mermaid: () => held === 'mermaid' ? wait('MERMAID') : Promise.resolve('MERMAID'),
      fonts: () => held === 'fonts' ? wait(fonts) : Promise.resolve(fonts),
      onMount: () => { expect(read.mock.calls.length).toBeGreaterThan(0); expect(yielded, 'no microtask between read and mount').toBe(false); },
    });
    const pending = r.run();
    await waiting;
    if (held === 'fonts') await vi.waitFor(() => expect(r.mermaid).toHaveBeenCalledTimes(1));
    expect(read).not.toHaveBeenCalled();
    el.dataset.theme = 'second'; el.style.setProperty('--bg-page', '#abcdef');
    release();
    const mount = await pending;
    expect(read).toHaveBeenCalledTimes(1);
    expect(mount.seed).toEqual({ hosted: true, stamp: 'refined|second' });
    expect(r.options().adapters.appearance?.colour?.bg).toBe('#abcdef');
    expect(r.options().adapters.assets.fonts).toEqual(fonts);
    expect(r.options().adapters.prefs?.theme).toBeUndefined();
    el.dataset.theme = 'third';
    mount.openAt!('x');
    expect(read).toHaveBeenCalledTimes(2);
    expect(mount.seed).toEqual({ hosted: true, stamp: 'refined|third' });
  });

  it('starts hosted faces and base assets before either settles', async () => {
    let releaseAssets!: (value: typeof STUB_ASSETS) => void;
    let releaseFonts!: (value: typeof fonts) => void;
    const order: string[] = [];
    const assets = vi.fn(() => { order.push('base'); return new Promise<typeof STUB_ASSETS>((resolve) => { releaseAssets = resolve; }); });
    const faces = vi.fn(() => { order.push('faces'); return new Promise<typeof fonts>((resolve) => { releaseFonts = resolve; }); });
    const r = rig({ appearanceRoot: root(), assets, fonts: faces });
    const pending = r.run();
    expect(assets).toHaveBeenCalledTimes(1);
    expect(faces).toHaveBeenCalledTimes(1);
    expect(order).toEqual(['base', 'faces']);
    expect(r.mount).not.toHaveBeenCalled();
    releaseFonts(fonts); releaseAssets(STUB_ASSETS);
    await pending;
    expect(r.options().adapters.assets.fonts).toEqual(fonts);
  });

  it.each(['reject', 'throw'] as const)('base %s falls back without waiting for pending faces', async (failure) => {
    const faces = vi.fn(() => new Promise<typeof fonts>(() => {}));
    const r = rig({ appearanceRoot: root(), fonts: faces, assets: () => {
      if (failure === 'throw') throw new Error('base failed');
      return Promise.reject(new Error('base failed'));
    } });
    await r.run();
    expect(faces).toHaveBeenCalledTimes(1);
    expect(r.input.onFallback).toHaveBeenCalledWith('assets');
    expect(r.mount).not.toHaveBeenCalled();
  });

  it.each(['reject', 'throw'] as const)('face %s is contained while base assets are held', async (failure) => {
    let release!: (value: typeof STUB_ASSETS) => void;
    const r = rig({ appearanceRoot: root(),
      assets: () => new Promise<typeof STUB_ASSETS>((resolve) => { release = resolve; }),
      fonts: () => { if (failure === 'throw') throw new Error('faces failed'); return Promise.reject(new Error('faces failed')); },
    });
    const pending = r.run();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(r.mount).not.toHaveBeenCalled();
    release(STUB_ASSETS);
    await pending;
    expect(r.options().adapters.assets.fonts).toBeUndefined();
    expect(r.input.onFallback).not.toHaveBeenCalled();
  });

  it('only passes the validated appearance, and follows drops without setPrefs', async () => {
    expect(parseAppearance({ mode: 'light', skin: { radius: '99px' } }).appearance.skin?.radius).toBeUndefined();
    const el = root(); el.style.setProperty('--r-md', '99px');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig({ appearanceRoot: el, fonts: () => Promise.resolve(fonts), validateAppearance: true });
    const m = await r.run();
    el.dataset.theme = 'changed';
    m.follow('dark');
    expect(m.seed).toEqual({ hosted: true, stamp: 'refined|first' });
    r.frame.setAppearance.mockClear();
    expect(r.options().adapters.appearance?.skin?.radius).toBeUndefined();
    expect(Object.keys(r.options().adapters).sort()).toEqual(['appearance', 'assets', 'copy', 'docKey', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'store', 'storePrefix', 'title', 'watchdogMs'].sort());
    el.style.removeProperty('--bg-page');
    m.follow('dark'); m.follow('dark');
    expect(r.frame.setAppearance).toHaveBeenCalledTimes(2);
    expect(r.frame.setAppearance.mock.lastCall![0]).toMatchObject({ mode: 'light' });
    expect(r.frame.setAppearance.mock.lastCall![0].colour).toBeUndefined();
    expect(r.frame.setPrefs).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain('ccrc-reader: ');
    expect(warn.mock.calls[0]![0]).toContain('colour-unreadable');
    expect(warn.mock.calls[0]![0]).toContain('--bg-page');
    el.style.setProperty('--bg-page', '#123456'); el.style.removeProperty('--bg-surface');
    m.follow('dark'); expect(warn).toHaveBeenCalledTimes(2);
    const read = vi.spyOn(window, 'getComputedStyle');
    m.destroy(); m.follow('light'); expect(r.frame.setAppearance).toHaveBeenCalledTimes(3);
    expect(read).not.toHaveBeenCalled();
  });

  it('mounts with an appearance and warns once when its colour group is dropped', async () => {
    const el = root(); el.style.removeProperty('--bg-page');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig({ appearanceRoot: el, fonts: () => Promise.resolve(fonts) });
    const m = await r.run();
    expect(r.options().adapters.appearance).toMatchObject({ mode: 'light' });
    expect(r.options().adapters.appearance?.colour).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toMatch(/^ccrc-reader: .*colour-unreadable.*--bg-page/);
    m.follow('dark'); expect(warn).toHaveBeenCalledTimes(1);
    el.style.setProperty('--bg-page', 'not-a-colour');
    m.follow('dark'); expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]![0]).toContain('colour-refused');
    expect(warn.mock.calls[1]![0]).toContain('--bg-page');
    el.style.setProperty('--bg-page', '#123456'); el.style.removeProperty('--bg-surface');
    m.follow('dark'); expect(warn).toHaveBeenCalledTimes(3);
    el.style.setProperty('--bg-surface', '#123456'); el.style.removeProperty('--bg-raised');
    m.follow('dark'); expect(warn).toHaveBeenCalledTimes(4);
    expect(warn.mock.calls[2]![0]).toContain('colour-unreadable');
    expect(warn.mock.calls[3]![0]).toContain('colour-unreadable');
    expect(warn.mock.calls[3]![0]).toContain('--bg-raised');
  });

  it.each(['none', 2] as const)('unsupported contract %s is mode-only and never reads the root', async (contract) => {
    const read = vi.spyOn(window, 'getComputedStyle');
    const faces = vi.fn(() => Promise.resolve(fonts));
    const r = rig({ appearanceRoot: root(), libraryContract: () => contract, fonts: faces, strictOld: true });
    const m = await r.run();
    expect(faces).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    expect(m.seed).toEqual({ hosted: false });
    expect(r.options().adapters.appearance).toBeUndefined();
    expect(r.options().adapters.assets.fonts).toBeUndefined();
    expect(r.options().adapters.prefs).toEqual({ theme: 'auto' });
    m.follow('dark'); expect(r.frame.setPrefs).toHaveBeenCalledTimes(1);
    expect(r.frame.setPrefs).toHaveBeenCalledWith({ theme: 'dark' });
    expect(read).not.toHaveBeenCalled();
  });

  it('the lab never reads the root and failed fonts do not fall back', async () => {
    const read = vi.spyOn(window, 'getComputedStyle');
    const preloaded = { ...STUB_ASSETS, fonts, mermaid: 'preloaded' };
    const lab = rig({ profile: 'lab-draw', appearanceRoot: root(), assets: () => Promise.resolve(preloaded) });
    const lm = await lab.run();
    expect(lm.seed).toEqual({ hosted: false }); expect(read).not.toHaveBeenCalled();
    expect(lab.options().adapters.appearance).toBeUndefined();
    expect(lab.options().adapters.assets).toEqual({ ...STUB_ASSETS, mermaid: 'preloaded' });
    const unsupported = rig({ appearanceRoot: root(), libraryContract: () => 'none', assets: () => Promise.resolve(preloaded) });
    await unsupported.run();
    expect(unsupported.options().adapters.assets).toEqual({ ...STUB_ASSETS, mermaid: 'preloaded' });
    const r = rig({ appearanceRoot: root(), assets: () => Promise.resolve(preloaded), fonts: () => Promise.reject(new Error('unavailable')) });
    await r.run();
    expect(r.options().adapters.assets).toEqual({ ...STUB_ASSETS, mermaid: 'preloaded' });
    expect(r.input.onFallback).not.toHaveBeenCalled();
  });

  it('the loaded faces are the design system files', async () => {
    const result = await loadReaderFonts();
    for (const [name, file] of [['sans', 'Geist-Variable.woff2'], ['mono', 'GeistMono-Variable.woff2']] as const) {
      const hash = (data: Buffer) => createHash('sha256').update(data).digest('hex');
      expect(hash(Buffer.from(result[name], 'base64'))).toBe(hash(readFileSync(path.join(import.meta.dirname, '../../ui/src/fonts', file))));
    }
  });
});

describe('the adapters', () => {
  it('the adapters are ccrc\'s keys for each draw and bar: the fourteen, loadMermaid after ready, features and onProgress on ccrc\'s bar', async () => {
    const fourteen = [
      'assets', 'copy', 'docKey', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs',
    ];
    const rows: Array<[ReaderE17Reading, ReaderChrome, string[]]> = [
      ['does-not-hold', 'frame-bar', fourteen],
      ['holds', 'frame-bar', [...fourteen, 'loadMermaid']],
      ['does-not-hold', 'host-bar', [...fourteen, 'features', 'onProgress']],
      ['holds', 'host-bar', [...fourteen, 'features', 'loadMermaid', 'onProgress']],
    ];
    const literal = [
      ['assets', 'copy', 'docKey', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs'],
      ['assets', 'copy', 'docKey', 'focus', 'loadMermaid', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs'],
      ['assets', 'copy', 'docKey', 'features', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onProgress', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs'],
      ['assets', 'copy', 'docKey', 'features', 'focus', 'loadMermaid', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onProgress', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs'],
    ];
    expect(literal.map((l) => l.length)).toEqual([14, 15, 16, 17]);
    for (const [n, [e17, chrome, expected]] of rows.entries()) {
      const r = rig({ e17, chrome });
      await r.run();
      const keys = Object.keys(r.options().adapters).sort();
      expect(keys).toEqual(literal[n]);
      expect(keys).toEqual([...expected].sort());
      for (const k of ['changes', 'openVersion', 'mermaidGate']) expect(keys).not.toContain(k);
    }
  });

  it('a Docs mount given changes and openVersion passes exactly those two more keys, for each draw and bar', async () => {
    const rows: Array<[ReaderE17Reading, ReaderChrome]> = [
      ['does-not-hold', 'frame-bar'], ['holds', 'frame-bar'], ['does-not-hold', 'host-bar'], ['holds', 'host-bar'],
    ];
    for (const [e17, chrome] of rows) {
      const plain = rig({ e17, chrome });
      await plain.run();
      const withHistory = rig({ e17, chrome, changes: () => Promise.resolve(null), openVersion: vi.fn() });
      await withHistory.run();
      expect(Object.keys(withHistory.options().adapters).sort())
        .toEqual([...Object.keys(plain.options().adapters), 'changes', 'openVersion'].sort());
    }
  });

  it('a lab-draw mount given changes and openVersion passes neither', async () => {
    const r = rig({ profile: 'lab-draw', changes: () => Promise.resolve(null), openVersion: vi.fn() });
    await r.run();
    const keys = Object.keys(r.options().adapters);
    expect(keys).not.toContain('changes');
    expect(keys).not.toContain('openVersion');
  });

  it('a Docs mount given only one of the two passes only that one', async () => {
    const c = rig({ changes: () => Promise.resolve(null) });
    await c.run();
    expect(Object.keys(c.options().adapters)).toContain('changes');
    expect(Object.keys(c.options().adapters)).not.toContain('openVersion');
    const o = rig({ openVersion: vi.fn() });
    await o.run();
    expect(Object.keys(o.options().adapters)).toContain('openVersion');
    expect(Object.keys(o.options().adapters)).not.toContain('changes');
  });

  it('changes forwards the sha to the input and resolves what it resolves, null included', async () => {
    const answer = { ranges: [[1, 2]] as const, removedAfter: [3] };
    const changes = vi.fn((_sha: string) => Promise.resolve<{ ranges: readonly (readonly [number, number])[]; removedAfter?: readonly number[] } | null>(answer));
    const r = rig({ changes });
    await r.run();
    await expect(r.options().adapters.changes!(SHA64)).resolves.toBe(answer);
    expect(changes).toHaveBeenCalledTimes(1);
    expect(changes).toHaveBeenCalledWith(SHA64);
    const none = rig({ changes: () => Promise.resolve(null) });
    await none.run();
    await expect(none.options().adapters.changes!(SHA40)).resolves.toBeNull();
  });

  it('openVersion forwards a fresh object holding the sha and only the library gave, and {} as {}', async () => {
    const openVersion = vi.fn();
    const r = rig({ openVersion });
    await r.run();
    const given = { sha: SHA40, only: SHA64 };
    r.options().adapters.openVersion!(given);
    expect(openVersion).toHaveBeenLastCalledWith({ sha: SHA40, only: SHA64 });
    expect(openVersion.mock.lastCall![0]).not.toBe(given);
    r.options().adapters.openVersion!({});
    expect(openVersion).toHaveBeenLastCalledWith({});
    expect(Object.keys(openVersion.mock.lastCall![0] as object)).toEqual([]);
    r.options().adapters.openVersion!({ only: SHA40 });
    expect(openVersion.mock.lastCall![0]).toEqual({ only: SHA40 });
    const extra = { sha: SHA40, other: 1 } as unknown as { sha: string };
    r.options().adapters.openVersion!(extra);
    expect(Object.keys(openVersion.mock.lastCall![0] as object)).toEqual(['sha']);
    expect(openVersion).toHaveBeenCalledTimes(4);
  });

  it('mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true', async () => {
    const r = rig({ e17: 'does-not-hold' });
    await r.run();
    const a = r.options().adapters;
    expect(a.mermaidDraw).toBe('on-request');
    expect(a.storePrefix).toBe('ccrc:reader:v1:');
    expect(a.storePrefix).toBe(READER_STORE_PREFIX);
    expect(a.focus).toBe(true);
  });

  it('mermaidDraw is after-ready when E17 held', async () => {
    const r = rig({ e17: 'holds' });
    await r.run();
    expect(r.options().adapters.mermaidDraw).toBe('after-ready');
  });

  it('watchdogMs is readerWatchdogMs of the document\'s bytes', async () => {
    for (const bytes of [0, 100, 70_000, 400_000]) {
      const r = rig({ bytes });
      await r.run();
      expect(r.options().adapters.watchdogMs).toBe(readerWatchdogMs(bytes));
    }
  });

  it('the prefs, the title and the assets reach the library as given', async () => {
    const r = rig();
    await r.run();
    const a = r.options().adapters;
    expect(a.prefs).toEqual({ theme: 'auto' });
    expect(a.title).toBe(r.input.title);
    expect(a.title).toBe('b.md');
    expect(a.assets).toMatchObject(STUB_ASSETS);
  });

  it('store is omitted when the port answers null', async () => {
    const r = rig({ store: null });
    await r.run();
    expect('store' in r.options().adapters).toBe(false);
  });

  it('docKey is omitted when readerDocKey answered null', async () => {
    const bad = readerDocKey('demo', 'sec', `a${String.fromCharCode(0)}b`);
    expect(bad).toBeNull();
    const r = rig({ docKey: bad });
    await r.run();
    expect('docKey' in r.options().adapters).toBe(false);
    expect(r.options().adapters.title).toBe(r.input.title);
    const ok = rig({ docKey: 'demo:sec:a/b.md' });
    await ok.run();
    expect(ok.options().adapters.docKey).toBe('demo:sec:a/b.md');
  });
});

describe('the Mermaid gate (A15/M8.20, the W8a plan\'s refinement (c))', () => {
  it('a gated Mermaid doc carries the Mermaid text; a rejected Mermaid import drops scan and mounts', async () => {
    const scan = { mermaid: mermaidCounts(2, 100, 200) };
    const r = rig({ document: docOf({ scan }) });
    await r.run();
    expect(r.options().adapters.assets.mermaid).toBe('MERMAID');
    expect(r.options().document.scan).toEqual(scan);

    const bad = rig({ document: docOf({ scan }), mermaid: () => Promise.reject(new Error('chunk failed')) });
    await bad.run();
    expect(bad.mount).toHaveBeenCalledTimes(1);
    expect(bad.options().document.scan).toBeUndefined();
    expect(bad.options().adapters.assets.mermaid).toBeUndefined();
  });

  it('a Mermaid import that never settles mounts without scan once the watchdog passes, and a late chunk changes nothing', async () => {
    vi.useFakeTimers();
    try {
      const scan = { mermaid: mermaidCounts(2, 100, 200) };
      let late!: (text: string) => void;
      const r = rig({ document: docOf({ scan }), mermaid: () => new Promise<string>((res) => { late = res; }) });
      const mounted = r.run();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.mermaid).toHaveBeenCalledTimes(1);
      expect(r.mount).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(readerWatchdogMs(100) - 1);
      expect(r.mount).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1);
      expect(r.mount).toHaveBeenCalledTimes(1);
      await mounted;
      expect(r.options().document.scan).toBeUndefined();
      expect(r.options().adapters.assets.mermaid).toBeUndefined();

      late('MERMAID');
      await vi.advanceTimersByTimeAsync(0);
      expect(r.mount).toHaveBeenCalledTimes(1);
      expect(r.options().document.scan).toBeUndefined();
      expect(r.options().adapters.assets.mermaid).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a Mermaid import that settles in time leaves no timer behind', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ document: docOf({ scan: { mermaid: mermaidCounts(2, 100, 200) } }) });
      await r.run();
      expect(r.options().adapters.assets.mermaid).toBe('MERMAID');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('on request, a rejected load drops the scan and reports no drop: the drop report is the lab\'s alone', async () => {
    const dropped = vi.fn();
    const r = rig({
      document: docOf({ scan: { mermaid: mermaidCounts(2, 100, 200) } }),
      mermaid: () => Promise.reject(new Error('chunk failed')), onMermaidDrop: dropped,
    });
    await r.run();
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(r.options().document.scan).toBeUndefined();
    expect(dropped).not.toHaveBeenCalled();
  });

  it('a document with no scan loads no Mermaid text', async () => {
    const r = rig();
    await r.run();
    expect(r.mermaid).not.toHaveBeenCalled();
    expect(r.options().adapters.assets.mermaid).toBeUndefined();
  });

  it('M8.20: a doc over the Mermaid fence count mounts with scan and no Mermaid text', async () => {
    const scan = { mermaid: mermaidCounts(25, 100, 2500) };
    const r = rig({ document: docOf({ scan }) });
    await r.run();
    expect(r.mermaid).not.toHaveBeenCalled();
    expect(r.options().document.scan).toEqual(scan);
    expect(r.options().adapters.assets.mermaid).toBeUndefined();
  });

  it('M8.20: a doc over the total cap mounts with scan and no Mermaid text', async () => {
    // Two fences of 65 537 and 65 536 code units: 131 073 in all, one over the total cap.
    const scan = { mermaid: mermaidCounts(2, 65_537, 131_073) };
    const r = rig({ document: docOf({ scan }) });
    await r.run();
    expect(r.mermaid).not.toHaveBeenCalled();
    expect(r.options().document.scan).toEqual(scan);
    expect(r.options().adapters.assets.mermaid).toBeUndefined();
  });

  it('M8.20: one fence over the per-fence cap still inlines Mermaid, with maxTextSize 16384', async () => {
    const counts = mermaidCounts(1, 16_385, 16_385);
    expect(mermaidGate(counts)).toEqual({ inline: true, maxTextSize: 16_384 });
    const r = rig({ document: docOf({ scan: { mermaid: counts } }) });
    await r.run();
    expect(r.options().adapters.assets.mermaid).toBe('MERMAID');
    expect(r.options().document.scan).toEqual({ mermaid: counts });
    // The bridge passes no caps of its own (the library's mount applies the gate and its maxTextSize).
    expect('mermaidGate' in r.options().adapters).toBe(false);
  });
});

describe('Mermaid drawn after ready (the take-up plan, refinement (c))', () => {
  const scan = { mermaid: mermaidCounts(2, 100, 200) };

  it('hands the library the loader itself and awaits nothing before the mount', async () => {
    const r = rig({ document: docOf({ scan }), e17: 'holds' });
    await r.run();
    expect(r.mermaid).not.toHaveBeenCalled();
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(r.options().adapters.loadMermaid).toBe(r.mermaid);
    expect(r.options().adapters.assets.mermaid).toBeUndefined();
    expect(r.options().document.scan).toEqual(scan);
  });

  it('a loader that never settles does not hold the mount, and leaves no timer', async () => {
    vi.useFakeTimers();
    try {
      const r = rig({ document: docOf({ scan }), e17: 'holds', mermaid: () => new Promise<string>(() => {}) });
      void r.run();
      await vi.advanceTimersByTimeAsync(0);
      expect(r.mount).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('a doc over the gate is handed the loader too: the library\'s gate decides', async () => {
    const over = { mermaid: mermaidCounts(25, 100, 2500) };
    const r = rig({ document: docOf({ scan: over }), e17: 'holds' });
    await r.run();
    expect(r.options().adapters.loadMermaid).toBeDefined();
    expect(r.options().document.scan).toEqual(over);
    expect(r.mermaid).not.toHaveBeenCalled();
  });

  it('the D-8030 drop is never reported for the Docs reader', async () => {
    const dropped = vi.fn();
    const r = rig({
      document: docOf({ scan }), e17: 'holds', onMermaidDrop: dropped,
      mermaid: () => Promise.reject(new Error('chunk failed')),
    });
    await r.run();
    expect(dropped).not.toHaveBeenCalled();
  });
});

describe('ccrc\'s bar and the commands (the take-up plan, refinements (g), (i))', () => {
  it('a host-bar mount turns the frame\'s bar off and trims its top space, as a fresh plain object', async () => {
    const a = rig({ chrome: 'host-bar' });
    await a.run();
    const b = rig({ chrome: 'host-bar' });
    await b.run();
    const fa = a.options().adapters.features;
    const fb = b.options().adapters.features;
    expect(fa).toEqual({ chrome: { bar: false, topSpace: false } });
    expect(Object.getPrototypeOf(fa)).toBe(Object.prototype);
    expect(fa).not.toBe(fb);
  });

  it('a host-bar mount forwards each progress share to the input', async () => {
    const onProgress = vi.fn();
    const r = rig({ chrome: 'host-bar', onProgress });
    await r.run();
    r.options().adapters.onProgress!(0.25);
    expect(onProgress).toHaveBeenCalledWith(0.25);
    const none = rig({ chrome: 'host-bar' });
    await none.run();
    expect(() => none.options().adapters.onProgress!(1)).not.toThrow();
  });

  it('a frame-bar mount, and a mount that names no chrome, pass neither features nor onProgress', async () => {
    for (const chrome of ['frame-bar', undefined] as const) {
      const r = rig({ ...(chrome === undefined ? {} : { chrome }), onProgress: vi.fn() });
      await r.run();
      const keys = Object.keys(r.options().adapters);
      expect(keys).not.toContain('features');
      expect(keys).not.toContain('onProgress');
    }
  });

  it('command forwards to DocFrame.command at once, and does nothing after destroy', async () => {
    const r = rig();
    const m = await r.run();
    m.command!('jump');
    expect(r.frame.command).toHaveBeenCalledTimes(1);
    expect(r.frame.command).toHaveBeenCalledWith('jump');
    m.destroy();
    m.command!('contents');
    expect(r.frame.command).toHaveBeenCalledTimes(1);
  });

  it('a mount whose assets did not load has no command', async () => {
    const r = rig({ assets: () => Promise.reject(new Error('chunk failed')) });
    const m = await r.run();
    expect('command' in m).toBe(false);
  });

  it('with no e17 dep, the recorded reading decides the draw', async () => {
    const r = rig({ e17: 'recorded' });
    await r.run();
    expect(r.options().adapters.mermaidDraw).toBe(docsDrawFor(READER_E17_MERMAID));
  });
});

describe('the version (the W8a plan\'s refinement (k))', () => {
  it('version carries sha and draft only for a full-hex commit, and never commits or only', async () => {
    const commits = [{ sha: SHA40, subject: 's', date: '2026-01-01T00:00:00Z', parents: [] }];
    const full = rig({ document: docOf({ version: { sha: SHA40, draft: true, commits, only: SHA40 } }) });
    await full.run();
    expect(full.options().document.version).toEqual({ sha: SHA40, draft: true });

    const full64 = rig({ document: docOf({ version: { sha: SHA64 } }) });
    await full64.run();
    expect(full64.options().document.version).toEqual({ sha: SHA64, draft: false });

    for (const sha of ['abc1234', 'A'.repeat(40), `${'a'.repeat(39)}g`, 'a'.repeat(41), '', null, undefined]) {
      const r = rig({ document: docOf({ version: { sha, draft: true, commits, only: SHA40 } }) });
      await r.run();
      expect(r.options().document.version).toBeUndefined();
    }
    const none = rig();
    await none.run();
    expect(none.options().document.version).toBeUndefined();
  });

  const seed: ReaderVersionSeed = {
    sha: SHA40, draft: true,
    commits: [{ sha: SHA64, subject: 's', date: '2026-01-01T00:00:00Z', parents: [] }], only: SHA64,
  };

  it('a seed on the Docs profile is the document\'s version exactly, and the document\'s own version is ignored', async () => {
    const own = { sha: 'b'.repeat(40), draft: false, commits: [], only: null };
    const r = rig({ document: docOf({ version: own }), version: seed });
    await r.run();
    expect(r.options().document.version).toEqual({ sha: SHA40, draft: true, commits: seed.commits, only: SHA64 });
    expect(Object.keys(r.options().document.version!).sort()).toEqual(['commits', 'draft', 'only', 'sha']);
    const bare = rig({ version: { sha: SHA64, draft: false, commits: null, only: null } });
    await bare.run();
    expect(bare.options().document.version).toEqual({ sha: SHA64, draft: false, commits: null, only: null });
  });

  it('a seed on lab-draw is not used: the document\'s version is cut as before, with no commits and no only', async () => {
    const own = { sha: SHA64, draft: false, commits: [], only: SHA64 };
    const r = rig({ profile: 'lab-draw', document: docOf({ version: own }), version: seed });
    await r.run();
    expect(r.options().document.version).toEqual({ sha: SHA64, draft: false });
    const none = rig({ profile: 'lab-draw', version: seed });
    await none.run();
    expect(none.options().document.version).toBeUndefined();
  });
});

// The Docs reader yields to a host element that owns focus (the completion plan's D-8729, `policy.ts#readerMountFocusFor`):
// the bridge reads `ownerDocument.activeElement` once, after its last await and just before the synchronous library mount,
// and puts the decision on the existing `focus` key.
describe('the mount focus (D-8729)', () => {
  /** A button appended to the page outside any reader element, focused. */
  function outsideButton(): HTMLButtonElement {
    const b = document.createElement('button');
    document.body.append(b);
    b.focus();
    return b;
  }
  /** A reader element appended to the page, so a focus inside it is a connected one. */
  function hostEl(): HTMLElement {
    const el = document.createElement('div');
    document.body.append(el);
    return el;
  }
  const focusOf = (r: Rig, n = 0): unknown => r.optionsAt(n).adapters.focus;

  it('body active: the Docs reader focuses its frame', async () => {
    const r = rig({ el: hostEl() });
    expect(document.activeElement).toBe(document.body);
    await r.run();
    expect(focusOf(r)).toBe(true);
  });

  it('the document element active: the Docs reader focuses its frame', async () => {
    document.documentElement.tabIndex = -1;
    document.documentElement.focus();
    // jsdom lets a tabindex'd root take focus; if it ever did not, the case below would stop proving anything.
    expect(document.activeElement).toBe(document.documentElement);
    const r = rig({ el: hostEl() });
    await r.run();
    expect(focusOf(r)).toBe(true);
    document.documentElement.removeAttribute('tabindex');
  });

  it('a connected button outside the reader holds focus: the Docs reader leaves it alone', async () => {
    const el = hostEl();
    const button = outsideButton();
    const r = rig({ el });
    await r.run();
    expect(document.activeElement).toBe(button);
    expect(focusOf(r)).toBe(false);
  });

  it('a button inside the reader element holds focus: the Docs reader focuses its frame', async () => {
    const el = hostEl();
    const inner = document.createElement('button');
    el.append(inner);
    inner.focus();
    const r = rig({ el });
    await r.run();
    expect(document.activeElement).toBe(inner);
    expect(focusOf(r)).toBe(true);
  });

  it('the reader element itself holding focus counts as the reader\'s own', async () => {
    const el = hostEl();
    el.tabIndex = -1;
    el.focus();
    const r = rig({ el });
    await r.run();
    expect(document.activeElement).toBe(el);
    expect(focusOf(r)).toBe(true);
  });

  it('an active element that is not connected does not own focus', async () => {
    const stray = document.createElement('button');
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(stray);
    const r = rig({ el: hostEl() });
    await r.run();
    expect(stray.isConnected).toBe(false);
    expect(focusOf(r)).toBe(true);
  });

  it('focus is read from the reader element\'s own document, not the global one', async () => {
    // The page has an outside button focused; the reader element lives in another document whose active element is its body.
    const other = document.implementation.createHTMLDocument('other');
    const el = other.createElement('div');
    other.body.append(el);
    outsideButton();
    const r = rig({ el });
    await r.run();
    expect(other.activeElement).toBe(other.body);
    expect(focusOf(r)).toBe(true);
  });

  it('the reader lab profile keeps its unconditional focus beside an outside button', async () => {
    const el = hostEl();
    outsideButton();
    const r = rig({ el, profile: 'lab-draw' });
    await r.run();
    expect(focusOf(r)).toBe(true);
  });

  it('the adapter key set is the same whoever owns focus (the table in "the adapters" still holds)', async () => {
    const quiet = rig({ el: hostEl() });
    await quiet.run();
    outsideButton();
    const owned = rig({ el: hostEl() });
    await owned.run();
    expect(Object.keys(owned.options().adapters).sort()).toEqual(Object.keys(quiet.options().adapters).sort());
  });

  it('the read is taken after the assets load: a button focused while it is pending decides', async () => {
    let release!: (a: typeof STUB_ASSETS) => void;
    const assets = vi.fn(() => new Promise<typeof STUB_ASSETS>((res) => { release = res; }));
    const r = rig({ el: hostEl(), assets });
    const pending = r.run();
    await vi.waitFor(() => expect(assets).toHaveBeenCalled());
    outsideButton();
    release(STUB_ASSETS);
    await pending;
    expect(focusOf(r)).toBe(false);
  });

  it('the read is taken after the assets load: a button blurred while it is pending no longer owns focus', async () => {
    const button = outsideButton();
    let release!: (a: typeof STUB_ASSETS) => void;
    const assets = vi.fn(() => new Promise<typeof STUB_ASSETS>((res) => { release = res; }));
    const r = rig({ el: hostEl(), assets });
    const pending = r.run();
    await vi.waitFor(() => expect(assets).toHaveBeenCalled());
    button.blur();
    release(STUB_ASSETS);
    await pending;
    expect(document.activeElement).toBe(document.body);
    expect(focusOf(r)).toBe(true);
  });

  describe('across the Mermaid wait (a document whose scan inlines Mermaid on request)', () => {
    const scanned = (): RenderInput => docOf({ scan: { mermaid: mermaidCounts(1, 10, 10) } } as Partial<RenderInput>);
    /** A Mermaid dep that settles when `release` is called. */
    function held(): { mermaid: () => Promise<string>; release: () => void } {
      let release!: () => void;
      const gate = new Promise<void>((res) => { release = res; });
      return { mermaid: () => gate.then(() => 'MERMAID'), release };
    }

    it('a button focused while the Mermaid text loads decides', async () => {
      const h = held();
      const r = rig({ el: hostEl(), document: scanned(), mermaid: h.mermaid });
      const pending = r.run();
      await vi.waitFor(() => expect(r.mermaid).toHaveBeenCalled());
      outsideButton();
      h.release();
      await pending;
      expect(r.optionsAt(0).adapters.assets.mermaid).toBe('MERMAID');
      expect(focusOf(r)).toBe(false);
    });

    it('a button blurred while the Mermaid text loads no longer owns focus', async () => {
      const button = outsideButton();
      const h = held();
      const r = rig({ el: hostEl(), document: scanned(), mermaid: h.mermaid });
      const pending = r.run();
      await vi.waitFor(() => expect(r.mermaid).toHaveBeenCalled());
      button.blur();
      h.release();
      await pending;
      expect(r.optionsAt(0).adapters.assets.mermaid).toBe('MERMAID');
      expect(focusOf(r)).toBe(true);
    });

    it('a rejected Mermaid load is also read after the wait', async () => {
      let fail!: () => void;
      const gate = new Promise<string>((_res, rej) => { fail = () => rej(new Error('chunk failed')); });
      const r = rig({ el: hostEl(), document: scanned(), mermaid: () => gate });
      const pending = r.run();
      await vi.waitFor(() => expect(r.mermaid).toHaveBeenCalled());
      outsideButton();
      fail();
      await pending;
      expect(r.optionsAt(0).document.scan).toBeUndefined();
      expect(focusOf(r)).toBe(false);
    });
  });

  it('command still reaches the frame at once, once, whatever the mount decided about focus', async () => {
    for (const owned of [false, true]) {
      document.body.replaceChildren();
      const el = hostEl();
      if (owned) outsideButton();
      const r = rig({ el });
      const m = await r.run();
      expect(focusOf(r)).toBe(!owned);
      m.command!('jump');
      expect(r.frame.command).toHaveBeenCalledTimes(1);
      expect(r.frame.command).toHaveBeenCalledWith('jump');
    }
  });
});

// `openAt` (the completion plan's Task 13): a link to this very page spelled with its file name mounts the same document
// again at the anchor, through the same mount function and adapters, with focus decided again and the latest theme.
describe('openAt', () => {
  function hostEl(): HTMLElement {
    const el = document.createElement('div');
    document.body.append(el);
    return el;
  }
  const button = (): HTMLButtonElement => {
    const b = document.createElement('button');
    document.body.append(b);
    b.focus();
    return b;
  };

  it('a mount that destroys itself while the library mounts the new frame tears that frame down too (review of Task 13, nit 6)', async () => {
    const r = rig({ el: hostEl() });
    const m = await r.run();
    type MountCall = (el: HTMLElement, o: { document: RenderInput; adapters: HostAdapters }) => unknown;
    const real = r.mount.getMockImplementation() as MountCall;
    r.mount.mockImplementationOnce((el: HTMLElement, o: { document: RenderInput; adapters: HostAdapters }) => {
      const f = real(el, o);
      m.destroy();
      return f;
    });
    m.openAt!('far');
    expect(r.mount).toHaveBeenCalledTimes(2);
    expect(r.frames[1]!.destroy, 'the frame mounted while the mount was destroyed is destroyed').toHaveBeenCalledTimes(1);
    m.openAt!('again');
    expect(r.mount, 'and nothing mounts after that').toHaveBeenCalledTimes(2);
  });

  it('mounts the same document a second time with initialHash set and nothing else changed, the first frame destroyed first', async () => {
    const r = rig({ el: hostEl(), document: docOf({ version: { sha: SHA40, draft: false } } as Partial<RenderInput>) });
    const m = await r.run();
    expect(r.optionsAt(0).document).not.toHaveProperty('initialHash');
    m.openAt!('far');
    expect(r.mount).toHaveBeenCalledTimes(2);
    expect(r.optionsAt(1).document.initialHash).toBe('far');
    expect(r.optionsAt(1).document).toEqual({ ...r.optionsAt(0).document, initialHash: 'far' });
    expect(Object.keys(r.optionsAt(1).adapters).sort()).toEqual(Object.keys(r.optionsAt(0).adapters).sort());
    expect(r.frames[0]!.destroy).toHaveBeenCalledTimes(1);
    expect(r.order).toEqual(['mount 0', 'destroy 0', 'mount 1']);
    expect(r.frame.update).not.toHaveBeenCalled();
  });

  it('hands the second mount the same assets, the same callbacks\' behaviour and the latest theme given through setPrefs', async () => {
    const r = rig({ el: hostEl() });
    const m = await r.run();
    expect(r.optionsAt(0).adapters.prefs).toEqual({ theme: 'auto' });
    m.setPrefs({ theme: 'light' });
    m.setPrefs({ theme: 'dark' });
    m.openAt!('far');
    expect(r.optionsAt(1).adapters.prefs).toEqual({ theme: 'dark' });
    expect(r.optionsAt(1).adapters.assets).toBe(r.optionsAt(0).adapters.assets);
    const link: HostLink = { kind: 'fragment', id: 'x' };
    r.optionsAt(1).adapters.onLink!(link);
    expect(r.input.onLink).toHaveBeenCalledWith({ kind: 'fragment', id: 'x' });
    r.optionsAt(1).adapters.onHash!('y');
    expect(r.input.onHash).toHaveBeenCalledWith('y');
  });

  it('without a setPrefs, the second mount carries the prefs the first was given', async () => {
    const r = rig({ el: hostEl() });
    const m = await r.run();
    m.openAt!('far');
    expect(r.optionsAt(1).adapters.prefs).toEqual({ theme: 'auto' });
  });

  it('decides focus again: an outside button focused at that moment keeps it, and a quiet page lets the frame take it', async () => {
    const r = rig({ el: hostEl() });
    const m = await r.run();
    expect(r.optionsAt(0).adapters.focus).toBe(true);
    const b = button();
    m.openAt!('one');
    expect(r.optionsAt(1).adapters.focus).toBe(false);
    b.blur();
    m.openAt!('two');
    expect(r.optionsAt(2).adapters.focus).toBe(true);
  });

  it('the lab profile keeps focus on a second mount too', async () => {
    const r = rig({ el: hostEl(), profile: 'lab-draw' });
    const m = await r.run();
    button();
    m.openAt!('far');
    expect(r.optionsAt(1).adapters.focus).toBe(true);
  });

  it('does nothing after destroy', async () => {
    const r = rig({ el: hostEl() });
    const m = await r.run();
    m.destroy();
    m.openAt!('far');
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(r.order).toEqual(['mount 0', 'destroy 0']);
  });

  it('command, setPrefs and destroy act on the new frame after it', async () => {
    const r = rig({ el: hostEl() });
    const m = await r.run();
    m.openAt!('far');
    m.command!('jump');
    expect(r.frames[0]!.command).not.toHaveBeenCalled();
    expect(r.frames[1]!.command).toHaveBeenCalledTimes(1);
    expect(r.frames[1]!.command).toHaveBeenCalledWith('jump');
    m.setPrefs({ theme: 'dark' });
    expect(r.frames[0]!.setPrefs).not.toHaveBeenCalled();
    expect(r.frames[1]!.setPrefs).toHaveBeenCalledWith({ theme: 'dark' });
    m.destroy();
    expect(r.frames[1]!.destroy).toHaveBeenCalledTimes(1);
    expect(r.frames[0]!.destroy).toHaveBeenCalledTimes(1);
  });

  it('a mount whose assets did not load has no openAt', async () => {
    const r = rig({ assets: () => Promise.reject(new Error('chunk failed')) });
    const m = await r.run();
    expect('openAt' in m).toBe(false);
  });
});

// Back places (X2 P5.3, D-8763): the library's `onPlace`, `onHash`'s second argument, and the frame's `closeOverlay` and `goto`.
describe('places (X2 P5.3)', () => {
  it('onPlace reaches the library\'s adapters only when the input has it; the reader lab\'s input has none, its adapters unchanged', async () => {
    const without = rig();
    await without.run();
    expect(Object.keys(without.options().adapters)).not.toContain('onPlace');
    const lab = rig({ profile: 'lab-draw' });
    await lab.run();
    expect(Object.keys(lab.options().adapters)).not.toContain('onPlace');
    // The lab's adapters are exactly what they were before this change: the same keys, none of them new.
    expect(Object.keys(lab.options().adapters).sort()).toEqual(
      ['assets', 'copy', 'docKey', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'storePrefix', 'title', 'watchdogMs'],
    );

    const onPlace = vi.fn();
    const withIt = rig({ onPlace });
    await withIt.run();
    const a = withIt.options().adapters;
    expect(typeof a.onPlace).toBe('function');
    a.onPlace!('overlay');
    a.onPlace!('overlay-closed');
    expect(onPlace.mock.calls).toEqual([['overlay'], ['overlay-closed']]);
  });

  it('onHash hands on the library\'s second argument, and only when the library gave one', async () => {
    const r = rig({ onPlace: vi.fn() });
    await r.run();
    const a = r.options().adapters;
    a.onHash!('sec-1');
    expect((r.input.onHash as ReturnType<typeof vi.fn>).mock.lastCall, 'no second argument invented').toEqual(['sec-1']);
    a.onHash!('sec-2', { push: true, from: 'tok' });
    expect(r.input.onHash).toHaveBeenLastCalledWith('sec-2', { push: true, from: 'tok', inGrammar: true });
    a.onHash!('sec-3', { push: false, from: null });
    expect(r.input.onHash).toHaveBeenLastCalledWith('sec-3', { push: false, from: null, inGrammar: true });
  });

  it('onHash tells whether the id is inside the fragment grammar (D-9117), only with the library\'s second argument', async () => {
    const r = rig({ onPlace: vi.fn() });
    await r.run();
    const a = r.options().adapters;
    const last = (): unknown => (r.input.onHash as ReturnType<typeof vi.fn>).mock.lastCall;
    for (const [id, inGrammar] of [['part-20', true], ['a.b:c_d-e', true], ['bad id', false], ['a/b', false], ['x#y', false], ['é-ü', true]] as const) {
      a.onHash!(id, { push: true, from: 'tok' });
      expect(last(), id).toEqual([id, { push: true, from: 'tok', inGrammar }]);
    }
    // 257 code units are outside the grammar's length.
    a.onHash!('a'.repeat(257), { push: true, from: null });
    expect(last()).toEqual(['a'.repeat(257), { push: true, from: null, inGrammar: false }]);
    // Without the second argument the id goes alone, whatever it is.
    a.onHash!('bad id');
    expect(last()).toEqual(['bad id']);
  });

  it('closeOverlay and goto call the live frame\'s, and goto without a from passes none', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    r.optionsAt(0).adapters.onReady!();
    m.closeOverlay!();
    expect(r.frame.closeOverlay).toHaveBeenCalledTimes(1);
    m.goto!('sec-4', 'tok');
    expect(r.frame.goto).toHaveBeenLastCalledWith('sec-4', 'tok');
    m.goto!('sec-5');
    expect((r.frame.goto as ReturnType<typeof vi.fn>).mock.lastCall).toEqual(['sec-5']);
  });

  it('closeOverlay and goto do nothing after destroy', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    // Ready first, so `closeOverlay` gets past its not-ready return and meets the destroy guard it names.
    r.optionsAt(0).adapters.onReady!();
    m.destroy();
    m.closeOverlay!();
    m.goto!('sec-4', 'tok');
    expect(r.frame.closeOverlay).not.toHaveBeenCalled();
    expect(r.frame.goto).not.toHaveBeenCalled();
  });

  it('closeOverlay and goto do nothing on a mount made without onPlace (the library throws a TypeError for a host with none)', async () => {
    const r = rig();
    r.frame.closeOverlay.mockImplementation(() => { throw new TypeError('no onPlace'); });
    r.frame.goto.mockImplementation(() => { throw new TypeError('no onPlace'); });
    const m = await r.run();
    // Ready first, so `closeOverlay` gets past its not-ready return and meets the no-onPlace guard it names.
    r.optionsAt(0).adapters.onReady!();
    expect(() => m.closeOverlay!()).not.toThrow();
    expect(() => m.goto!('sec-4')).not.toThrow();
    expect(r.frame.closeOverlay).not.toHaveBeenCalled();
    expect(r.frame.goto).not.toHaveBeenCalled();
  });

  it('a frame that throws on closeOverlay or goto is contained', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig({ onPlace: vi.fn() });
    r.frame.closeOverlay.mockImplementation(() => { throw new TypeError('refused'); });
    r.frame.goto.mockImplementation(() => { throw new TypeError('refused'); });
    const m = await r.run();
    r.optionsAt(0).adapters.onReady!();
    expect(() => m.closeOverlay!()).not.toThrow();
    expect(() => m.goto!('sec-4', 'tok')).not.toThrow();
    expect(() => m.gotoTop!('sec-4')).not.toThrow();
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it('a command held until ready that the frame then refuses is contained too', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const r = rig({ onPlace: vi.fn() });
    r.frame.goto.mockImplementation(() => { throw new TypeError('refused'); });
    const m = await r.run();
    m.goto!('sec-4', 'tok');
    expect(r.frame.goto, 'held: nothing is sent before ready').not.toHaveBeenCalled();
    expect(() => r.optionsAt(0).adapters.onReady!()).not.toThrow();
    expect(r.frame.goto, 'sent once, at ready').toHaveBeenCalledTimes(1);
    expect(r.frame.goto).toHaveBeenCalledWith('sec-4', 'tok');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(r.input.onReady).toHaveBeenCalledTimes(1);
  });

  it('bridge: a goto before ready is held and sent at ready', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    m.goto!('sec-4', 'tok');
    m.closeOverlay!();
    expect(r.frame.goto, 'nothing is sent before ready').not.toHaveBeenCalled();
    m.destroy();
    const s = rig({ onPlace: vi.fn() });
    const n = await s.run();
    n.goto!('sec-4', 'tok');
    expect(s.frame.goto).not.toHaveBeenCalled();
    s.optionsAt(0).adapters.onReady!();
    expect(s.frame.goto).toHaveBeenCalledTimes(1);
    expect(s.frame.goto).toHaveBeenCalledWith('sec-4', 'tok');
    expect(s.input.onReady, 'the input still hears ready').toHaveBeenCalledTimes(1);
    // Sent once: a second ready sends nothing more, and a command after ready goes at once.
    s.optionsAt(0).adapters.onReady!();
    expect(s.frame.goto).toHaveBeenCalledTimes(1);
    n.goto!('sec-5');
    expect(s.frame.goto).toHaveBeenCalledTimes(2);
  });

  it('bridge: a later command before ready replaces the held one', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    m.goto!('sec-1', 'tok');
    m.closeOverlay!();
    m.gotoTop!('sec-2');
    r.optionsAt(0).adapters.onReady!();
    expect(r.frame.closeOverlay, 'the earlier ones are gone').not.toHaveBeenCalled();
    expect(r.frame.goto).toHaveBeenCalledTimes(1);
    expect(r.frame.goto).toHaveBeenCalledWith('sec-2', TOP_TOKEN);
  });

  it('bridge: a close before ready is dropped and leaves a held goto in place', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    m.goto!('sec-1', 'tok');
    m.closeOverlay!();
    r.optionsAt(0).adapters.onReady!();
    expect(r.frame.closeOverlay, 'a fresh frame has no overlay to close').not.toHaveBeenCalled();
    expect(r.frame.goto, 'the held position still reaches the frame').toHaveBeenCalledWith('sec-1', 'tok');
    m.closeOverlay!();
    expect(r.frame.closeOverlay, 'after ready a close is sent').toHaveBeenCalledTimes(1);
  });

  it('bridge: openAt\'s new frame holds a command until its own ready', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const r = rig({ el, onPlace: vi.fn() });
    const m = await r.run();
    r.optionsAt(0).adapters.onReady!();
    m.openAt!('far');
    m.goto!('sec-4', 'tok');
    expect(r.frames[1]!.goto, 'the new frame is not ready').not.toHaveBeenCalled();
    expect(r.frames[0]!.goto).not.toHaveBeenCalled();
    r.optionsAt(0).adapters.onReady!();
    expect(r.frames[1]!.goto, 'the old frame\'s ready does not release it').not.toHaveBeenCalled();
    r.optionsAt(1).adapters.onReady!();
    expect(r.frames[1]!.goto).toHaveBeenCalledWith('sec-4', 'tok');
    expect(r.frames[0]!.goto).not.toHaveBeenCalled();
  });

  it('bridge: nothing is held after destroy', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    m.goto!('sec-4', 'tok');
    m.destroy();
    r.optionsAt(0).adapters.onReady!();
    expect(r.frame.goto, 'a command held before destroy is dropped').not.toHaveBeenCalled();
    m.goto!('sec-5');
    m.closeOverlay!();
    m.gotoTop!('sec-6');
    r.optionsAt(0).adapters.onReady!();
    expect(r.frame.goto).not.toHaveBeenCalled();
    expect(r.frame.closeOverlay).not.toHaveBeenCalled();
    // And with no onPlace nothing is held, so a ready sends nothing.
    const q = rig();
    const n = await q.run();
    n.goto!('sec-4');
    n.gotoTop!('sec-4');
    n.closeOverlay!();
    q.optionsAt(0).adapters.onReady!();
    expect(q.frame.goto).not.toHaveBeenCalled();
    expect(q.frame.closeOverlay).not.toHaveBeenCalled();
  });

  it('bridge: gotoTop sends the id with the top token', async () => {
    const r = rig({ onPlace: vi.fn() });
    const m = await r.run();
    r.optionsAt(0).adapters.onReady!();
    m.gotoTop!('part-20');
    expect(r.frame.goto).toHaveBeenCalledTimes(1);
    expect(r.frame.goto).toHaveBeenCalledWith('part-20', TOP_TOKEN);
  });

  it('bridge: the top token is a position token the library reads', () => {
    expect(isAnchorToken(TOP_TOKEN)).toBe(true);
  });

  it('openAt keeps onPlace and the commands follow the new frame', async () => {
    const el = document.createElement('div');
    document.body.append(el);
    const onPlace = vi.fn();
    const r = rig({ el, onPlace });
    const m = await r.run();
    m.openAt!('far');
    r.optionsAt(1).adapters.onReady!();
    expect(r.mount).toHaveBeenCalledTimes(2);
    expect(Object.keys(r.optionsAt(1).adapters).sort()).toEqual(Object.keys(r.optionsAt(0).adapters).sort());
    r.optionsAt(1).adapters.onPlace!('overlay');
    expect(onPlace).toHaveBeenCalledWith('overlay');
    r.optionsAt(1).adapters.onHash!('x', { push: true, from: 'tok' });
    expect(r.input.onHash).toHaveBeenLastCalledWith('x', { push: true, from: 'tok', inGrammar: true });
    m.closeOverlay!();
    expect(r.frames[0]!.closeOverlay).not.toHaveBeenCalled();
    expect(r.frames[1]!.closeOverlay).toHaveBeenCalledTimes(1);
  });

  it('a mount whose assets did not load has neither closeOverlay nor goto', async () => {
    const r = rig({ assets: () => Promise.reject(new Error('chunk failed')), onPlace: vi.fn() });
    const m = await r.run();
    expect('closeOverlay' in m).toBe(false);
    expect('goto' in m).toBe(false);
  });
});

describe('failure and teardown', () => {
  it('a rejected asset load falls back with assets and never mounts', async () => {
    const r = rig({ assets: () => Promise.reject(new Error('chunk failed')) });
    const m = await r.run();
    expect(r.mount).not.toHaveBeenCalled();
    expect(r.input.onFallback).toHaveBeenCalledTimes(1);
    expect(r.input.onFallback).toHaveBeenCalledWith('assets');
    m.destroy();
    m.setPrefs({ theme: 'dark' });
    expect(r.mount).not.toHaveBeenCalled();
  });

  it('copy receives the library\'s check.hidden array; onLink receives a ReaderLink mapped from HostLink; onHash is forwarded; update is never called', async () => {
    const r = rig();
    await r.run();
    const a = r.options().adapters;
    const h: HiddenChar = { index: 1, codePoint: 0x202e, name: 'RIGHT-TO-LEFT OVERRIDE' };
    const text = `a${String.fromCharCode(0x202e)}`;
    a.copy!(text, { hidden: [h] });
    expect(r.input.copy).toHaveBeenLastCalledWith(text, [h]);
    expect(Array.isArray((r.input.copy as ReturnType<typeof vi.fn>).mock.calls[0]![1])).toBe(true);
    a.copy!('ab', { hidden: [] });
    expect(r.input.copy).toHaveBeenLastCalledWith('ab', []);

    const links: Array<[HostLink, ReaderLink]> = [
      [{ kind: 'fragment', id: 'sec-1' }, { kind: 'fragment', id: 'sec-1' }],
      [{ kind: 'relative', path: 'c.md', fragment: 'h' }, { kind: 'relative', path: 'c.md', fragment: 'h' }],
      [{ kind: 'relative', path: 'c.md', fragment: null }, { kind: 'relative', path: 'c.md', fragment: null }],
      [
        { kind: 'external', url: 'https://a.example/x', scheme: 'https', host: 'a.example' },
        { kind: 'external', url: 'https://a.example/x', scheme: 'https', host: 'a.example' },
      ],
      [
        { kind: 'external', url: 'mailto:you@example.com', scheme: 'mailto', host: 'example.com' },
        { kind: 'external', url: 'mailto:you@example.com', scheme: 'mailto', host: 'example.com' },
      ],
    ];
    for (const [from, to] of links) {
      a.onLink!(from);
      expect(r.input.onLink).toHaveBeenLastCalledWith(to);
    }
    // The mapped link is a fresh object holding exactly the ReaderLink fields.
    const fresh = { kind: 'fragment', id: 'x', extra: 1 } as unknown as HostLink;
    a.onLink!(fresh);
    expect((r.input.onLink as ReturnType<typeof vi.fn>).mock.lastCall![0]).toEqual({ kind: 'fragment', id: 'x' });

    a.onHash!('sec-2');
    expect(r.input.onHash).toHaveBeenCalledWith('sec-2');
    a.onReady!();
    expect(r.input.onReady).toHaveBeenCalledTimes(1);
    a.onFallback('timeout');
    expect(r.input.onFallback).toHaveBeenCalledWith('timeout');
    expect(r.frame.update).not.toHaveBeenCalled();
  });

  it('setPrefs forwards to DocFrame.setPrefs and never remounts', async () => {
    const r = rig();
    const m = await r.run();
    m.setPrefs({ theme: 'dark' });
    expect(r.frame.setPrefs).toHaveBeenCalledTimes(1);
    expect(r.frame.setPrefs).toHaveBeenCalledWith({ theme: 'dark' });
    expect(r.mount).toHaveBeenCalledTimes(1);
    expect(r.frame.update).not.toHaveBeenCalled();
  });

  it('destroy is idempotent', async () => {
    const r = rig();
    const m = await r.run();
    m.destroy();
    m.destroy();
    expect(r.frame.destroy).toHaveBeenCalledTimes(1);
    m.setPrefs({ theme: 'light' });
    expect(r.frame.setPrefs).not.toHaveBeenCalled();
  });
});

describe('the installed library\'s mount, for real (jsdom)', () => {
  /** Mounts the installed library with the real asset texts; Mermaid is never inlined (no scan). */
  async function realMount(store: EnumerableStoragePort | null) {
    const el = document.createElement('div');
    document.body.append(el);
    const input: ReaderMountInput = {
      document: docOf(), bytes: 100, docKey: 'demo:sec:a/b.md', title: 'b.md', prefs: { theme: 'auto' },
      onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    };
    const m = await mountReader(el, input, { store: () => store });
    return { el, m, input };
  }

  it('M8.1 in jsdom: the installed mount\'s iframe has sandbox allow-scripts, referrerpolicy no-referrer, csp equal to frameCsp and to the srcdoc meta\'s content, and no src, name or allow', async () => {
    const { el, m, input } = await realMount(fakeStore());
    const f = el.querySelector('iframe')!;
    expect(f).not.toBeNull();
    expect(f.getAttribute('sandbox')).toBe('allow-scripts');
    expect(f.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(f.getAttribute('csp')).toBe(frameCsp());
    for (const attr of ['src', 'name', 'allow']) expect(f.hasAttribute(attr)).toBe(false);
    const parsed = new DOMParser().parseFromString(f.getAttribute('srcdoc')!, 'text/html');
    expect(parsed.head.firstElementChild!.getAttribute('content')).toBe(f.getAttribute('csp'));
    expect(input.onFallback).not.toHaveBeenCalled();
    m.destroy();
  });

  it('M8.3 in jsdom: the srcdoc starts with the CSP meta carrying frameCsp exactly, then the guard, the seed and the bootstrap, each once', async () => {
    const { el, m } = await realMount(fakeStore());
    const f = el.querySelector('iframe')!;
    const parsed = new DOMParser().parseFromString(f.getAttribute('srcdoc')!, 'text/html');
    const first = parsed.head.firstElementChild!;
    expect(first.tagName.toLowerCase()).toBe('meta');
    expect(first.getAttribute('http-equiv')!.toLowerCase()).toBe('content-security-policy');
    expect(first.getAttribute('content')).toBe(frameCsp());
    expect(first.getAttribute('content')).toBe(f.getAttribute('csp'));
    const assets = await loadReaderAssets();
    const scripts = [...parsed.querySelectorAll('script')];
    const texts = scripts.map((s) => s.textContent ?? '');
    expect(texts.filter((t) => t === assets.guard)).toHaveLength(1);
    expect(texts.filter((t) => t === assets.bootstrap)).toHaveLength(1);
    expect(scripts.filter((s) => s.getAttribute('type') === 'application/json')).toHaveLength(1);
    const at = (t: string) => texts.indexOf(t);
    const seedAt = scripts.findIndex((s) => s.getAttribute('type') === 'application/json');
    expect(at(assets.guard)).toBeLessThan(seedAt);
    expect(seedAt).toBeLessThan(at(assets.bootstrap));
    m.destroy();
  });

  it('the installed library seeds a host-bar mount drawn after ready with the bar off, progress asked for, and no Mermaid script in its srcdoc', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const el = document.createElement('div');
    document.body.append(el);
    const input: ReaderMountInput = {
      document: docOf({ scan: { mermaid: mermaidCounts(1, 10, 10) } }), bytes: 100, docKey: 'demo:sec:a/b.md', title: 'b.md',
      prefs: { theme: 'auto' }, chrome: 'host-bar', onProgress: vi.fn(),
      onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    };
    const m = await mountReader(el, input, { store: () => fakeStore(), e17: 'holds', mermaid: () => Promise.resolve('x') });
    const srcdoc = el.querySelector('iframe')!.getAttribute('srcdoc')!;
    const parsed = new DOMParser().parseFromString(srcdoc, 'text/html');
    const seedEl = [...parsed.querySelectorAll('script')].find((s) => s.getAttribute('type') === 'application/json')!;
    const seed = JSON.parse(seedEl.textContent ?? '{}') as {
      features: { chrome: unknown }; bridge: { progress: unknown }; mermaid: { draw: unknown };
    };
    expect(seed.features.chrome).toEqual({ bar: false, topSpace: false });
    expect(seed.bridge.progress).toBe(true);
    expect(seed.mermaid.draw).toBe('after-ready');
    for (const sc of parsed.querySelectorAll('script')) {
      expect(createHash('sha256').update(sc.textContent ?? '').digest('hex')).not.toBe(FRAME_MANIFEST.mermaid.sha256);
    }
    expect(srcdoc.length).toBeLessThan(FRAME_MANIFEST.mermaid.chars);
    m.destroy();
  });

  it('M8.15 seed half: every key the real mount reads starts with ccrc:reader:v1:', async () => {
    const store = fakeStore({
      'ccrc-theme': 'dark', 'ccrc.fleet-snapshot.v1': '[]',
      [`${READER_STORE_PREFIX}pref:prefs`]: '{"theme":"dark"}',
    });
    const { m } = await realMount(store);
    expect(store.touched.length).toBeGreaterThan(0);
    for (const k of store.touched) expect(k.startsWith(READER_STORE_PREFIX)).toBe(true);
    m.destroy();
  });
});

// The reader lab's mount profile (the reader lab plan of 2026-11-03, Task 7, refinement (k); M10.15): `lab-draw` draws
// Mermaid on open, waits the lab's watchdog and is handed no storage port; no profile is the Docs reader, unchanged.
describe('the reader lab profile (reader lab plan, Task 7)', () => {
  const inputOf = (profile?: 'lab-draw'): ReaderMountInput => ({
    document: docOf({ scan: { mermaid: mermaidCounts(1, 10, 10) } } as Partial<RenderInput>),
    bytes: 100, docKey: null, title: 'lab.md', prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    ...(profile === undefined ? {} : { profile }),
  });
  const adaptersFor = async (input: ReaderMountInput): Promise<HostAdapters> => {
    const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) =>
      ({ update: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn() }) as unknown as DocFrame);
    await mountReader(document.createElement('div'), input, {
      mount: mount as unknown as typeof mountDocFrame, store: () => fakeStore(),
      assets: () => Promise.resolve(STUB_ASSETS), mermaid: () => Promise.resolve('MERMAID'),
      e17: 'does-not-hold',
    });
    return mount.mock.calls[0]![1].adapters;
  };

  it('lab-draw draws Mermaid on open, waits READER_LAB_DRAW_WATCHDOG_MS, and is handed no storage port', async () => {
    expect(READER_LAB_DRAW_WATCHDOG_MS).toBe(60000);
    const a = await adaptersFor(inputOf('lab-draw'));
    expect(a.mermaidDraw).toBe('auto');
    expect(a.watchdogMs).toBe(READER_LAB_DRAW_WATCHDOG_MS);
    expect(Object.keys(a)).not.toContain('store');
  });

  it('no profile is the Docs reader: Mermaid on request where E17 did not hold, the reader watchdog, the storage port', async () => {
    const a = await adaptersFor(inputOf());
    expect(a.mermaidDraw).toBe('on-request');
    expect(a.watchdogMs).toBe(readerWatchdogMs(100));
    expect(Object.keys(a)).toContain('store');
  });

  it('readerMountPlan is the one decision, and only lab-draw maps to drawing on open', () => {
    expect(readerMountPlan('lab-draw', 100, 'frame-bar', 'holds'))
      .toEqual({ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar', history: false, appearance: false });
    expect(readerMountPlan(undefined, 100, 'frame-bar', 'does-not-hold'))
      .toEqual({ draw: 'on-request', watchdogMs: readerWatchdogMs(100), store: true, chrome: 'frame-bar', history: true, appearance: true });
  });
});
