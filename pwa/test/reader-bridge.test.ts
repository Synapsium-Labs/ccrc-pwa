// Docs W8a Task 7: `docs/reader/bridge.ts`, the one adapter over the shared Markdown library's host mount. The
// adapters it hands the library are the whole of ccrc's control over the frame, so most cases inject a `mount` spy and
// read what it was given; the last group mounts the installed library for real (jsdom measured `MessageChannel` and
// an iframe `srcdoc` load, both yes, at Step 0). Every page is a placeholder (`demo`, `a/b.md`); control characters
// are built with `String.fromCharCode`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { frameCsp, mermaidGate, type RenderInput } from '@synapsium-labs/docserver/frame';
import type { DocFrame, HostAdapters, HostLink, mountDocFrame, HiddenChar } from '@synapsium-labs/docserver/host';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';
import type { EnumerableStoragePort } from '../src/lib/storage';
import { readerDocKey, readerWatchdogMs, type ReaderLink } from '../src/docs/reader/policy';
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
  readonly frame: { update: ReturnType<typeof vi.fn>; setPrefs: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> };
  readonly mount: ReturnType<typeof vi.fn>;
  readonly mermaid: ReturnType<typeof vi.fn>;
  readonly options: () => { document: RenderInput; adapters: HostAdapters };
  readonly run: () => ReturnType<typeof mountReader>;
}

/** A rig: an injected `mount` spy that records its options, a stub asset loader and a store (or none). */
function rig(o: {
  document?: RenderInput; bytes?: number; docKey?: string | null; store?: EnumerableStoragePort | null;
  assets?: () => Promise<typeof STUB_ASSETS>; mermaid?: () => Promise<string>;
} = {}): Rig {
  const frame = { update: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn() };
  const mount = vi.fn((_el: HTMLElement, _o: { document: RenderInput; adapters: HostAdapters }) => frame as unknown as DocFrame);
  const mermaid = vi.fn(o.mermaid ?? (() => Promise.resolve('MERMAID')));
  const input: ReaderMountInput = {
    document: o.document ?? docOf(),
    bytes: o.bytes ?? 100,
    docKey: o.docKey === undefined ? 'demo:sec:a/b.md' : o.docKey,
    title: 'b.md',
    prefs: { theme: 'auto' },
    onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
  };
  const store = o.store === undefined ? fakeStore() : o.store;
  const run = () => mountReader(document.createElement('div'), input, {
    mount: mount as unknown as typeof mountDocFrame,
    store: () => store,
    assets: o.assets ?? (() => Promise.resolve(STUB_ASSETS)),
    mermaid,
  });
  return { input, frame, mount, mermaid, run, options: () => mount.mock.calls[0]![1] };
}

describe('the adapters', () => {
  it('the adapters are exactly ccrc\'s fourteen keys, with no changes or openVersion', async () => {
    const r = rig();
    await r.run();
    const keys = Object.keys(r.options().adapters).sort();
    expect(keys).toEqual(
      ['assets', 'copy', 'docKey', 'focus', 'mermaidDraw', 'onFallback', 'onHash', 'onLink', 'onReady', 'prefs', 'store', 'storePrefix', 'title', 'watchdogMs'],
    );
    expect(keys).toHaveLength(14);
    for (const k of ['changes', 'openVersion', 'features', 'mermaidGate']) expect(keys).not.toContain(k);
  });

  it('mermaidDraw is on-request, storePrefix is ccrc:reader:v1:, focus is true', async () => {
    const r = rig();
    await r.run();
    const a = r.options().adapters;
    expect(a.mermaidDraw).toBe('on-request');
    expect(a.storePrefix).toBe('ccrc:reader:v1:');
    expect(a.storePrefix).toBe(READER_STORE_PREFIX);
    expect(a.focus).toBe(true);
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
