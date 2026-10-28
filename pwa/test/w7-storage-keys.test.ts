// Every key each storage owner reads or writes, as a literal sorted list (D-7179; Task C7a Step 5; plan
// docs/superpowers/plans/2026-10-27-consolidation-w7-pwa.md, item 13; ARCH-75). The owners are `storageOwners()`
// (census-w7, 10 files); each is driven through its own read and write, and `Storage`'s three methods are recorded, so
// the keys are what the code touches, not text it holds. C7l moves every owner onto one storage port; every key here
// stays byte-identical (a renamed key loses a device's remembered choice).
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { fleetSession } from './fleetFixture';
import { loadFolded, loadRollupPrefs, saveFolded, saveRollupPrefs } from '../src/fleet/foldState';
import { dismissRelease, readDismissed, resetDismissalForTests } from '../src/fleet/releaseDismissal';
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
  it('fleet/releaseDismissal.ts', async () => {
    resetDismissalForTests();
    expect(await keysTouched(() => { dismissRelease('v1.2.3'); readDismissed(); })).toEqual(['ccrc-release-dismissed']);
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

describe('every key, across the ten owners, as one sorted list', () => {
  it('the literal list (the union of the rows above)', () => {
    expect([...ALL].sort()).toEqual([
      'ccrc-fleet-group', 'ccrc-release-dismissed', 'ccrc-skin', 'ccrc-theme',
      'ccrc.drawer-view.v1', 'ccrc.fleet-folded.v1', 'ccrc.fleet-rollup.v1', 'ccrc.fleet-snapshot.v1',
      'ccrc:chat-row-samples', 'ccrc:chat-row-samples-v2', 'ccrc:notify:v1', 'ccrc:seen:v1',
    ]);
  });
});
