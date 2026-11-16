// Docs W8a Task 7: `docs/reader/bridge.ts`, the one adapter over the shared Markdown library's host mount. The
// adapters it hands the library are the whole of ccrc's control over the frame, so most cases inject a `mount` spy and
// read what it was given; the last group mounts the installed library for real (jsdom measured `MessageChannel` and
// an iframe `srcdoc` load, both yes, at Step 0). Every page is a placeholder (`demo`, `a/b.md`); control characters
// are built with `String.fromCharCode`.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FRAME_MANIFEST, frameCsp, mermaidGate, type RenderInput } from '@synapsium-labs/docserver/frame';
import type { DocFrame, HostAdapters, HostLink, mountDocFrame, HiddenChar } from '@synapsium-labs/docserver/host';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import type { EnumerableStoragePort } from '../src/lib/storage';
import {
  docsDrawFor, READER_E17_MERMAID, readerDocKey, readerMountPlan, readerWatchdogMs,
  type ReaderChrome, type ReaderE17Reading, type ReaderLink,
} from '../src/docs/reader/policy';
import { READER_LAB_DRAW_WATCHDOG_MS } from '../src/lib/readerLimits';
import { loadReaderAssets } from '../src/docs/reader/assets';
import { mountReader, type ReaderMountInput } from '../src/docs/reader/bridge';

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
  readonly frame: { update: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn>; command: ReturnType<typeof vi.fn> };
  readonly mount: ReturnType<typeof vi.fn>;
  readonly mermaid: ReturnType<typeof vi.fn>;
  readonly options: () => { document: RenderInput; adapters: HostAdapters };
  readonly run: () => ReturnType<typeof mountReader>;
}

/** A rig: an injected `mount` spy that records its options, a stub asset loader and a store (or none). */
function rig(o: {
  document?: RenderInput; bytes?: number; docKey?: string | null; store?: EnumerableStoragePort | null;
  assets?: () => Promise<typeof STUB_ASSETS>; mermaid?: () => Promise<string>;
  /** The E17 reading the deps plan with (default `does-not-hold`: on request); `'recorded'` passes no `e17` dep at all. */
  e17?: ReaderE17Reading | 'recorded'; chrome?: ReaderChrome; onProgress?: (share: number) => void; onMermaidDrop?: () => void;
} = {}): Rig {
  const frame = { update: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn(), command: vi.fn() };
  const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => frame as unknown as DocFrame);
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
  };
  const store = o.store === undefined ? fakeStore() : o.store;
  const run = () => mountReader(document.createElement('div'), input, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => store,
    assets: o.assets ?? (() => Promise.resolve(STUB_ASSETS)),
    mermaid,
    ...(o.e17 === 'recorded' ? {} : { e17: o.e17 ?? 'does-not-hold' }),
  });
  return { input, frame, mount, mermaid, run, options: () => mount.mock.calls[0]![1] };
}

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
      .toEqual({ draw: 'auto', watchdogMs: READER_LAB_DRAW_WATCHDOG_MS, store: false, chrome: 'frame-bar' });
    expect(readerMountPlan(undefined, 100, 'frame-bar', 'does-not-hold'))
      .toEqual({ draw: 'on-request', watchdogMs: readerWatchdogMs(100), store: true, chrome: 'frame-bar' });
  });
});
