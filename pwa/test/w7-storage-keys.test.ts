// Every key each storage owner reads or writes, as a literal sorted list (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 13; ARCH-75). The owners are `storageOwners()`
// (census-w7, 12 files); each is driven through its own read and write, and `Storage`'s three methods are recorded, so
// the keys are what the code touches, not text it holds. C7l moves every owner onto one storage port; every key here
// stays byte-identical (a renamed key loses a device's remembered choice).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { fleetSession } from './fleetFixture';
import { loadFolded, loadRollupPrefs, saveFolded, saveRollupPrefs } from '../src/fleet/foldState';
import { dismissRelease, readDismissed, resetDismissalForTests } from '../src/fleet/releaseDismissal';
import { setStripExpanded, useStripExpanded } from '../src/fleet/stripExpanded';
import { inspectorHidden, resetInspectorChoiceForTests, setInspectorHidden } from '../src/inspector/inspectorShown';
import { loadMark, saveMark } from '../src/lib/notifymark';
import { loadFleetSnapshot, saveFleetSnapshot } from '../src/lib/offline';
import { ack, loadAcks } from '../src/lib/seen';
import { rememberSkin, storedSkin } from '../src/lib/skin';
import { rememberTheme, storedTheme } from '../src/lib/theme';
import { readViewOverride, writeViewOverride } from '../src/session/drawerView';
import { rememberedRows, rememberRows, type HeightBucket, type MeasuredRow } from '../src/session/itemHeight';
import { FleetTable, loadGroupMode } from '../src/skins/instrument/FleetTable';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { createFleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { BRIDGE_LIMITS } from '@synapsium-labs/docserver/frame';
import { readerDocKey } from '../src/docs/reader/policy';
import { READER_STORE_PREFIX } from '../src/lib/readerLimits';

/** Every key any owner touched in this file. */
const ALL = new Set<string>();

/** The keys `Storage` was asked for while `fn` ran, sorted and de-duplicated (the real storage answers). */
async function keysTouched(fn: () => void | Promise<void>): Promise<string[]> {
  const keys = new Set<string>();
  const record = (['getItem', 'setItem', 'removeItem'] as const).map((m) => {
    const orig = Storage.prototype[m];
    return vi.spyOn(Storage.prototype, m).mockImplementation(function (this: Storage, ...args: unknown[]) {
      keys.add(String(args[0]));
      return (orig as (...a: unknown[]) => unknown).apply(this, args) as never;
    });
  });
  try { await fn(); } finally { for (const s of record) s.mockRestore(); }
  for (const k of keys) ALL.add(k);
  return [...keys].sort();
}

beforeEach(() => { window.localStorage.clear(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.localStorage.clear(); });

const row = (lines: number): MeasuredRow => ({ id: lines, lines, px: 20 + 18 * lines });

describe('each storage owner\'s keys (read and write), byte for byte', () => {
  it('fleet/foldState.ts', async () => {
    expect(await keysTouched(() => { saveFolded(new Set(['project-a'])); loadFolded(); saveRollupPrefs(loadRollupPrefs()); })).toEqual(['ccrc.fleet-folded.v1', 'ccrc.fleet-rollup.v1']);
  });
  it('fleet/stripExpanded.ts (the desk strip\'s choice: a write, then a read; a phone reads nothing)', async () => {
    expect(await keysTouched(() => {
      setStripExpanded(true);
      renderHook(() => useStripExpanded(true)).unmount();
    })).toEqual(['ccrc-accounts-strip']);
    expect(window.localStorage.getItem('ccrc-accounts-strip')).toBe('expanded');
    expect(await keysTouched(() => { renderHook(() => useStripExpanded(false)).unmount(); }), 'a phone').toEqual([]);
    setStripExpanded(false);
  });
  it('fleet/releaseDismissal.ts', async () => {
    resetDismissalForTests();
    expect(await keysTouched(() => { dismissRelease('v1.2.3'); readDismissed(); })).toEqual(['ccrc-release-dismissed']);
  });
  it('inspector/inspectorShown.ts (the per-device choice: a write, then a read on a fresh page)', async () => {
    resetInspectorChoiceForTests();
    expect(await keysTouched(() => { setInspectorHidden(true); resetInspectorChoiceForTests(); inspectorHidden(); })).toEqual(['ccrc-inspector']);
    expect(window.localStorage.getItem('ccrc-inspector')).toBe('hidden');
    resetInspectorChoiceForTests();
  });
  it('lib/notifymark.ts', async () => {
    expect(await keysTouched(() => { saveMark({ epoch: 'epoch-a', seq: 3 }); loadMark(); })).toEqual(['ccrc:notify:v1']);
  });
  it('lib/offline.ts', async () => {
    expect(await keysTouched(() => { saveFleetSnapshot([fleetSession({ id: 'session-a' })]); loadFleetSnapshot(); })).toEqual(['ccrc.fleet-snapshot.v1']);
  });
  it('lib/seen.ts', async () => {
    expect(await keysTouched(() => { ack('session-a', 1_784_500_000_000); loadAcks(); })).toEqual(['ccrc:seen:v1']);
  });
  it('lib/skin.ts', async () => {
    expect(await keysTouched(() => { rememberSkin('auto'); storedSkin(); })).toEqual(['ccrc-skin']);
  });
  it('lib/theme.ts', async () => {
    expect(await keysTouched(() => { rememberTheme('system'); storedTheme(); })).toEqual(['ccrc-theme']);
  });
  it('session/TerminalDrawer.tsx (its view chip, through drawerView.ts\'s StorageLike over window.localStorage)', async () => {
    expect(await keysTouched(() => { writeViewOverride(() => window.localStorage, 'wrapped'); readViewOverride(() => window.localStorage); writeViewOverride(() => window.localStorage, null); }))
      .toEqual(['ccrc.drawer-view.v1']);
  });
  it('session/itemHeight.ts (its retired key is removed on a save)', async () => {
    const visit = new Map<HeightBucket, readonly MeasuredRow[]>([['user', [row(1), row(2), row(3), row(4)]]]);
    expect(await keysTouched(() => { rememberRows(visit, rememberedRows(window.localStorage), window.localStorage); rememberedRows(window.localStorage); }))
      .toEqual(['ccrc:chat-row-samples', 'ccrc:chat-row-samples-v2']);
  });
  it('skins/instrument/FleetTable.tsx (the group-mode toggle: its read, and the write a tap makes)', async () => {
    vi.spyOn(api, 'fleetHealth').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'updates').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'projects').mockReturnValue(new Promise(() => {}));
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    const store = createFleetStore({ makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket });
    render(createElement(FleetChromeProvider, { store }, createElement(FleetTable)));
    const keys = await keysTouched(() => {
      loadGroupMode();
      act(() => { fireEvent.click(screen.getByRole('radio', { name: /project/i })); });
    });
    // The toggle's own key; project mode then draws the cards, whose fold and roll-up reads are `foldState.ts`'s keys.
    expect(keys).toEqual(['ccrc-fleet-group', 'ccrc.fleet-folded.v1', 'ccrc.fleet-rollup.v1']);
    expect(window.localStorage.getItem('ccrc-fleet-group')).toBe('project');
  });
});

describe('every key, across the twelve owners, as one sorted list', () => {
  it('the literal list (the union of the rows above)', () => {
    expect([...ALL].sort()).toEqual([
      'ccrc-accounts-strip', 'ccrc-fleet-group', 'ccrc-inspector', 'ccrc-release-dismissed', 'ccrc-skin', 'ccrc-theme',
      'ccrc.drawer-view.v1', 'ccrc.fleet-folded.v1', 'ccrc.fleet-rollup.v1', 'ccrc.fleet-snapshot.v1',
      'ccrc:chat-row-samples', 'ccrc:chat-row-samples-v2', 'ccrc:notify:v1', 'ccrc:seen:v1',
    ]);
  });
});

// W8a (Task 7): the reader's keys. They are NOT in the union list above (the list is the twelve owners' keys, and the
// reader's are a family under one prefix, not a literal set); this describe pins that the library's store keeps every
// write and every eviction inside `READER_STORE_PREFIX`, and the budget and caps it states (M8.15).
describe('W8a: the reader\'s keys stay under its own prefix (M8.15)', () => {
  const LIB = path.join(__dirname, '..', 'node_modules', '@synapsium-labs', 'docserver', 'dist', 'host');
  /** The part of Web Storage the library's store uses, and the store's two methods (its `.d.ts` declares both). */
  interface HostStorage {
    getItem(key: string): string | null;
    setItem(key: string, value: string): void;
    removeItem(key: string): void;
    key(index: number): string | null;
    readonly length: number;
  }
  interface HostStore {
    set(key: string, value: string): { readonly ok: true } | { readonly ok: false; readonly reason: string };
    snapshot(): Partial<Record<string, string>>;
  }
  type CreateHostStore = (storage: HostStorage, prefix?: string, docKey?: string) => HostStore;

  /** The library's store factory, from the file the installed mount runs (`./host` does not export it). */
  async function createHostStore(): Promise<CreateHostStore> {
    const mountText = readFileSync(path.join(LIB, 'mount.js'), 'utf8');
    expect(mountText).toMatch(/from '\.\/store\.js'/);
    const url = pathToFileURL(path.join(LIB, 'store.js')).href;
    return ((await import(/* @vite-ignore */ url)) as { createHostStore: CreateHostStore }).createHostStore;
  }

  /** A `Storage`-shaped port over a map whose mutating methods are spies. `seed` goes straight into the map. */
  function spyStorage(seed: Record<string, string> = {}) {
    const data = new Map(Object.entries(seed));
    const setItem = vi.fn((k: string, v: string) => { data.set(k, v); });
    const removeItem = vi.fn((k: string) => { data.delete(k); });
    const port: HostStorage = {
      getItem: (k) => data.get(k) ?? null, setItem, removeItem,
      key: (i) => [...data.keys()][i] ?? null,
      get length() { return data.size; },
    };
    return { data, setItem, removeItem, port };
  }

  const bytes = (s: string): number => new TextEncoder().encode(s).length;
  /** The UTF-8 bytes of every key and value under the reader's prefix. */
  const usage = (data: Map<string, string>): number =>
    [...data].filter(([k]) => k.startsWith(READER_STORE_PREFIX)).reduce((n, [k, v]) => n + bytes(k) + bytes(v), 0);
  /** A JSON string value of `n` UTF-8 bytes (its quotes included). */
  const json = (n: number): string => `"${'a'.repeat(n - 2)}"`;

  it('the adapter hands the page store with storePrefix ccrc:reader:v1:', async () => {
    const { mountReader } = await import('../src/docs/reader/bridge');
    const port = spyStorage().port;
    const mount = vi.fn(() => ({ update: vi.fn(), setPrefs: vi.fn(), destroy: vi.fn() }));
    await mountReader(document.createElement('div'), {
      document: { result: { outcome: 'rendered', html: '<p>x</p>', meta: { title: null, frontList: null } } },
      bytes: 10, docKey: 'demo:sec:a.md', title: 'a.md', prefs: { theme: 'auto' },
      onLink: vi.fn(), onHash: vi.fn(), copy: vi.fn(), onReady: vi.fn(), onFallback: vi.fn(),
    }, {
      mount: mount as never, store: () => port as never,
      assets: () => Promise.resolve({ guard: 'g', bootstrap: 'b', enhance: 'e', css: 'c' }),
    });
    const calls = mount.mock.calls as unknown as Array<[HTMLElement, { adapters: { store: unknown; storePrefix: string } }]>;
    expect(calls[0]![1].adapters.store).toBe(port);
    expect(calls[0]![1].adapters.storePrefix).toBe(READER_STORE_PREFIX);
  });

  it('a store.set flood past 1 MiB evicts the oldest other documents, only ccrc:reader:v1: keys, stays within the budget and leaves ccrc.fleet-snapshot.v1 writable', async () => {
    const create = await createHostStore();
    const consoleKeys = { 'ccrc-theme': 'dark', 'ccrc-skin': 'auto', 'ccrc.fleet-snapshot.v1': '[]', 'ccrc:seen:v1': '{}' };
    const spy = spyStorage(consoleKeys);
    const others = ['a.md', 'b.md', 'c.md', 'd.md', 'e.md'].map((p) => readerDocKey('demo', 'sec', p)!);
    const current = readerDocKey('demo', 'sec', 'now.md')!;
    const order: string[] = [];
    const fieldsOf = (n: number) => ['pos', 'folds', 'marks', 'outline', 'seen', 'ixfold'].slice(0, n);
    for (const doc of others) {
      const s = create(spy.port, READER_STORE_PREFIX, doc);
      order.push(doc);
      for (const f of fieldsOf(3)) {
        expect(s.set(`doc:${f}`, json(60_000)).ok).toBe(true);
        expect(usage(spy.data)).toBeLessThanOrEqual(BRIDGE_LIMITS.storeBudgetBytes);
      }
    }
    expect(usage(spy.data)).toBeLessThan(BRIDGE_LIMITS.storeBudgetBytes);
    const cur = create(spy.port, READER_STORE_PREFIX, current);
    order.push(current);
    for (const f of fieldsOf(6)) {
      expect(cur.set(`doc:${f}`, json(60_000)).ok).toBe(true);
      expect(usage(spy.data)).toBeLessThanOrEqual(BRIDGE_LIMITS.storeBudgetBytes);
    }
    // The 6 x 60 000 bytes of the current document with the 5 x 3 x 60 000 of the others pass the budget.
    const live = (doc: string): number => [...spy.data.keys()].filter((k) => k.startsWith(`${READER_STORE_PREFIX}doc:${doc}:`)).length;
    const removed = others.filter((d) => live(d) === 0);
    expect(removed.length).toBeGreaterThanOrEqual(1);
    expect(removed).toEqual(others.slice(0, removed.length));
    for (const d of others.slice(removed.length)) expect(live(d)).toBe(3);
    expect(live(current)).toBe(6);
    expect(spy.removeItem).toHaveBeenCalled();
    for (const [k] of spy.removeItem.mock.calls) expect(k.startsWith(READER_STORE_PREFIX)).toBe(true);
    for (const [k, v] of Object.entries(consoleKeys)) expect(spy.data.get(k)).toBe(v);
    spy.port.setItem('ccrc.fleet-snapshot.v1', '[1]');
    expect(spy.data.get('ccrc.fleet-snapshot.v1')).toBe('[1]');
  });

  it('a write that cannot fit without evicting the prefs, the current document or a non-document key is refused with budget and evicts nothing', async () => {
    const create = await createHostStore();
    const other = readerDocKey('demo', 'sec', 'other.md')!;
    const otherKey = `${READER_STORE_PREFIX}doc:${other}:pos`;
    const otherValue = json(5_000);
    const fixed = bytes(`${READER_STORE_PREFIX}x`) + bytes(otherKey) + bytes(otherValue);
    // A non-document key under the prefix leaves 20 000 bytes of room: a 60 KiB value fits only by evicting what the
    // store never evicts (the key itself), and the other document's 5 000 bytes do not make up the difference.
    const filler = 'x'.repeat(BRIDGE_LIMITS.storeBudgetBytes - 20_000 - fixed);
    const spy = spyStorage({ [`${READER_STORE_PREFIX}x`]: filler, [otherKey]: otherValue });
    const before = new Map(spy.data);
    const s = create(spy.port, READER_STORE_PREFIX, readerDocKey('demo', 'sec', 'now.md')!);
    expect(s.set('pref:prefs', json(60 * 1024))).toEqual({ ok: false, reason: 'budget' });
    expect(spy.setItem).not.toHaveBeenCalled();
    expect(spy.removeItem).not.toHaveBeenCalled();
    expect(spy.data).toEqual(before);
  });

  it('a value over 64 KiB is refused', async () => {
    const create = await createHostStore();
    const spy = spyStorage();
    const s = create(spy.port, READER_STORE_PREFIX, readerDocKey('demo', 'sec', 'now.md')!);
    const over = json(BRIDGE_LIMITS.valueMaxBytes + 1);
    expect(bytes(over)).toBe(BRIDGE_LIMITS.valueMaxBytes + 1);
    expect(s.set('pref:prefs', over)).toEqual({ ok: false, reason: 'oversize' });
    expect(spy.setItem).not.toHaveBeenCalled();
    expect(spy.data.size).toBe(0);
    expect(s.set('pref:prefs', json(BRIDGE_LIMITS.valueMaxBytes)).ok).toBe(true);
  });

  it('a frame-supplied doc field lands under the current doc\'s key', async () => {
    const create = await createHostStore();
    const spy = spyStorage();
    const doc = readerDocKey('demo', 'sec', 'now.md')!;
    const s = create(spy.port, READER_STORE_PREFIX, doc);
    expect(s.set('doc:pos', '1').ok).toBe(true);
    expect(spy.data.get(`${READER_STORE_PREFIX}doc:${doc}:pos`)).toBe('1');
    // A key naming another document is not on the allow-list: refused, never written under that document.
    const other = readerDocKey('demo', 'sec', 'other.md')!;
    for (const key of [`doc:${other}:pos`, `doc:${other}`, 'doc:other:pos']) {
      expect(s.set(key, '2')).toEqual({ ok: false, reason: 'store-key' });
    }
    expect([...spy.data.keys()].some((k) => k.includes('other'))).toBe(false);
    expect([...spy.data.keys()].filter((k) => k.startsWith(READER_STORE_PREFIX) && !k.includes(`doc:${doc}:`) && !k.endsWith('meta:written'))).toEqual([]);
  });
});
