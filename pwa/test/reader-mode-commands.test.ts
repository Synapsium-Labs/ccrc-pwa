// Reader mode's `r` in the console's command registry (native Docs reader, reader-mode plan Task XR1.5, spec 2026-11-20 sections
// 3.1 and 3.2). One command, key `r`: its `run` asks the handle the Docs screen sets while it is mounted
// (`readerModeHandle.ts`) and toggles only when reader mode is offered or on; its `when` asks the same handle and is false while
// the palette is open, so the palette never lists it and the shortcut sheet lists `r` only where it acts. A single key never
// reads `when` (`useShortcuts`), so the `run` is null-safe on its own. Every case sets a stand-in handle: the real handle's
// answers are reader-mode.test.tsx's, and the key-holding while reader mode is on is command-layer.test.tsx's.
import { createElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { CommandLayer } from '../src/command/CommandLayer';
import { baseCommands } from '../src/command/commands';
import { available, rankCommands, type CommandContext } from '../src/command/registry';
import { useShortcuts } from '../src/command/useShortcuts';
import { setReaderLayoutHandle } from '../src/docs/readerLayoutHandle';
import { setReaderModeHandle, type ReaderModeHandle } from '../src/docs/readerModeHandle';
import { NO_READER_PLACES, useReaderMode, type ReaderModeFrame } from '../src/docs/useReaderMode';
import { onReaderLayout } from '../src/docs/reader/layoutPref';
import { READER_LAYOUTS } from '../src/docs/reader/policy';
import { READER_LAYOUT_TEXT, READER_MODE_KEY, READER_MODE_TEXT, readerLayoutCommandTitle } from '../src/docs/reader/readerModeWords';
import { useFleetStore } from '../src/stores/fleet';

afterEach(() => {
  cleanup();
  setReaderModeHandle(null);
  setReaderLayoutHandle(null);
  vi.restoreAllMocks();
});

const ctx = (over: Partial<CommandContext> = {}): CommandContext => ({
  path: '/docs/demo/specs/a.md', sessions: [], runs: [], navigate: () => {}, setSkin: () => {}, setTheme: () => {}, setCharacter: () => {},
  openShortcuts: () => {}, openNewSession: () => {}, openPalette: () => {}, paletteOpen: false, session: null, inspector: null,
  home: { place: 'fleet', why: 'not-advertised' }, overlordShown: false,
  ...over,
});

/** The Docs screen's handle, as the screen sets it: what it offers, whether reader mode is on, and the toggle it spies.
 *  `available` is `offered` less the modal-layer clause, so it defaults to what is offered. */
function setHandle(o: { readonly offered: boolean; readonly available?: boolean; readonly on?: boolean }): ReaderModeHandle & { toggle: ReturnType<typeof vi.fn> } {
  const handle = { offered: () => o.offered, available: () => o.available ?? o.offered, on: () => o.on === true, toggle: vi.fn() };
  setReaderModeHandle(handle);
  return handle;
}

/** The `r` command: the one row whose only key is `r`. */
const rRow = (): ReturnType<typeof baseCommands>[number] => {
  const found = baseCommands().filter((c) => c.keys?.length === 1 && c.keys[0] === 'r');
  expect(found, 'one command is bound to r').toHaveLength(1);
  return found[0]!;
};

/** Binds the global keys over the registry and presses `r` on the page. */
function pressR(context: CommandContext = ctx()): void {
  const hook = renderHook(() => useShortcuts({ enabled: true, commands: baseCommands(), context: () => context, onPalette: vi.fn() }));
  fireEvent.keyDown(document.body, { key: 'r' });
  hook.unmount();
}

describe('commands: r', () => {
  it('commands: r enters reader mode on a Docs page with a ready frame', () => {
    const handle = setHandle({ offered: true });
    const row = rRow();
    expect(row.title).toBe(READER_MODE_TEXT.enter);
    expect(available([row], ctx()), 'offered here').toHaveLength(1);
    row.run(ctx());
    expect(handle.toggle).toHaveBeenCalledTimes(1);
    // The key itself, bound by the layer's hook: one press, one toggle.
    pressR();
    expect(handle.toggle).toHaveBeenCalledTimes(2);
    // While reader mode is on, the same key is the exit: the toggle is the handle's, which reads its own state.
    const on = setHandle({ offered: false, on: true });
    pressR();
    expect(on.toggle).toHaveBeenCalledTimes(1);
  });

  it('commands: the r key is spelled once, in READER_MODE_KEY', () => {
    expect(READER_MODE_KEY).toBe('r');
    expect(rRow().keys).toEqual([READER_MODE_KEY]);
  });

  it('commands: the real handle answers available() through a dialog that offered() refuses', () => {
    const { result } = renderHook(() => useReaderMode({ doc: 'doc-a', plainView: false, places: NO_READER_PLACES }));
    const frame: ReaderModeFrame = {
      ready: true, layout: 'default', planned: 'off', focus: () => undefined, setReading: () => undefined, command: () => undefined,
      title: 'a.md', progress: { read: () => 0, subscribe: () => () => undefined },
    };
    expect(result.current.controls.available(), 'no frame stored').toBe(false);
    act(() => { result.current.value.setFrame(frame); });
    expect(result.current.controls.offered(), 'a ready frame, no layer').toBe(true);
    expect(result.current.controls.available()).toBe(true);
    const layer = document.createElement('div');
    layer.setAttribute('role', 'dialog');
    document.body.append(layer);
    try {
      expect(result.current.controls.offered(), 'a dialog is mounted: the act is refused').toBe(false);
      expect(result.current.controls.available(), 'the listing still reads the screen').toBe(true);
    } finally {
      layer.remove();
    }
  });

  it('commands: r does nothing on every other screen', () => {
    // No Docs screen mounted: the handle is empty, and the key neither throws nor acts.
    setReaderModeHandle(null);
    expect(() => rRow().run(ctx({ path: '/fleet' }))).not.toThrow();
    expect(() => pressR(ctx({ path: '/fleet' }))).not.toThrow();
    // A Docs screen that offers nothing (the plain view, a frame not ready, a modal layer up) and is not on: the key is no act.
    const idle = setHandle({ offered: false, on: false });
    rRow().run(ctx());
    pressR();
    expect(idle.toggle).not.toHaveBeenCalled();
    // And the row is not offered where it does not act, so the sheet does not list it there.
    expect(available([rRow()], ctx({ path: '/fleet' }))).toEqual([]);
    expect(available([rRow()], ctx())).toEqual([]);
  });

  it('palette: Reader mode is never listed, and r still enters with the palette closed', () => {
    const handle = setHandle({ offered: true });
    const commands = baseCommands();
    // The palette is open: the row is not offered, so no query finds it, whether it reads the words or the id.
    const open = ctx({ paletteOpen: true });
    expect(available(commands, open).map((c) => c.id)).not.toContain(rRow().id);
    for (const query of ['', 'reader', 'Reader mode', 'rm']) {
      expect(rankCommands(query, available(commands, open)).map((c) => c.title), `query "${query}"`).not.toContain(READER_MODE_TEXT.enter);
    }
    // The palette closed: offered where it acts, and the key enters.
    expect(available(commands, ctx()).map((c) => c.id)).toContain(rRow().id);
    pressR(ctx());
    expect(handle.toggle).toHaveBeenCalledTimes(1);
  });

  describe('the shortcut sheet', () => {
    beforeEach(() => {
      window.history.replaceState(null, '', '/');
      useFleetStore.setState({ sessions: [], runs: [], blocked: false });
    });

    /** The rows of the sheet the layer draws when `?` is pressed. */
    function sheetRows(): string[] {
      render(createElement(CommandLayer, { openNewSession: vi.fn() }));
      fireEvent.keyDown(document.body, { key: '?' });
      const sheet = screen.getByRole('dialog', { name: 'Keyboard shortcuts' });
      return within(sheet).getAllByRole('listitem').map((li) => li.textContent ?? '');
    }
    const listsReader = (rows: readonly string[]): boolean => rows.some((r) => r.startsWith(READER_MODE_TEXT.enter));

    it('shortcut sheet: r is listed on a Docs page that offers reader mode and on no other screen', () => {
      setHandle({ offered: true });
      const docs = sheetRows();
      expect(listsReader(docs), 'a Docs page that offers it').toBe(true);
      expect(docs.find((r) => r.startsWith(READER_MODE_TEXT.enter)), 'with its key').toMatch(/r$/);
      cleanup();
      setReaderModeHandle(null);
      expect(listsReader(sheetRows()), 'no Docs screen').toBe(false);
      cleanup();
      setHandle({ offered: false, on: false });
      expect(listsReader(sheetRows()), 'a Docs page that does not offer it').toBe(false);
      // (While reader mode is on `?` is held, so the sheet cannot be opened then; the row is still offered, as `r` still acts.)
      cleanup();
      setHandle({ offered: false, on: true });
      expect(available([rRow()], ctx()), 'reader mode on: r exits, so it is offered').toHaveLength(1);
    });

    it('shortcut sheet: the r row stays listed while the sheet is open, though the sheet is itself a dialog', () => {
      // The real handle's `offered()` is false whenever any `[role="dialog"]` is mounted, and the sheet is one, so a `when`
      // that asked it would drop the row at the layer's next render. `available()` is the same offer without that clause.
      // The stand-in reads the document as the real one does.
      let ready = true;
      const handle: ReaderModeHandle = {
        offered: () => ready && document.querySelector('[role="dialog"]') === null,
        available: () => ready,
        on: () => false,
        toggle: vi.fn(),
      };
      setReaderModeHandle(handle);
      render(createElement(CommandLayer, { openNewSession: vi.fn() }));
      fireEvent.keyDown(document.body, { key: '?' });
      const rowsNow = (): string[] => within(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).getAllByRole('listitem').map((li) => li.textContent ?? '');
      expect(listsReader(rowsNow()), 'listed when the sheet opens').toBe(true);
      expect(handle.offered(), 'the sheet is a dialog, so the full offer is false under it').toBe(false);
      // Any re-render of the layer while the sheet is open (a fleet update here) draws the rows again.
      act(() => { useFleetStore.setState({ sessions: [], runs: [] }); });
      expect(listsReader(rowsNow()), 'still listed after the layer re-rendered').toBe(true);
      // The listing still follows the screen: a frame that is no longer ready takes the row away, and the act is still the full test.
      ready = false;
      act(() => { useFleetStore.setState({ sessions: [], runs: [] }); });
      expect(listsReader(rowsNow()), 'gone when nothing is available').toBe(false);
    });
  });
});

// The layout from the command palette, on every width (X2 P5.1, D-9180): the desk's head has no Layout control, so each layout is a
// palette command, offered where Page details draws the Layout row.
describe('palette: the Layout commands (D-9180)', () => {
  const layoutRows = (): ReturnType<typeof baseCommands> => baseCommands().slice(-READER_LAYOUTS.length);

  it('palette: one Layout command per layout, last, titled from the one list', () => {
    const all = baseCommands();
    const rows = layoutRows();
    // Last, after `toggle-reader-mode`, so every earlier command keeps its place; one per layout, in the layouts' own order.
    expect(all.at(-READER_LAYOUTS.length - 1)?.id, 'the row before them is reader mode\'s').toBe('toggle-reader-mode');
    expect(rows.map((c) => c.title)).toEqual(READER_LAYOUTS.map((l) => `Layout: ${READER_LAYOUT_TEXT.names[l]}`));
    expect(rows.map((c) => c.title)).toEqual(['Layout: Default', 'Layout: Classic', 'Layout: Editorial', 'Layout: Review', 'Layout: Guided']);
    expect(rows.map((c) => c.title)).toEqual(READER_LAYOUTS.map(readerLayoutCommandTitle));
    for (const row of rows) {
      expect(row.group, row.id).toBe('Docs');
      expect(row.keys, `${row.id}: no key binding`).toBeUndefined();
    }
    expect(new Set(all.map((c) => c.id)).size, 'ids are unique').toBe(all.length);
  });

  it('palette: the Layout commands are offered exactly when the Layout row would be, never in reader mode, on no other screen', () => {
    const rows = layoutRows();
    const ids = new Set(rows.map((c) => c.id));
    const offered = (c: CommandContext): string[] => available(baseCommands(), c).map((x) => x.id).filter((id) => ids.has(id));
    const open = ctx({ paletteOpen: true });
    // No Docs screen: none, with the palette open or closed.
    setReaderLayoutHandle(null);
    expect(offered(open), 'no Docs screen').toEqual([]);
    expect(offered(ctx({ path: '/fleet' })), 'another screen').toEqual([]);
    // A stand-in handle: offered exactly as it answers, and they ARE listed while the palette is open.
    let drawn = true;
    setReaderLayoutHandle({ layoutRowDrawn: () => drawn });
    expect(offered(open), 'listed in the open palette').toEqual([...ids]);
    expect(rankCommands('Layout: G', available(baseCommands(), open)).map((c) => c.title)).toContain('Layout: Guided');
    expect(offered(ctx()), 'and with the palette closed').toEqual([...ids]);
    drawn = false;
    expect(offered(open), 'the row is not drawn').toEqual([]);
    // The real hook's answer is `readerLayoutRowDrawn`'s: a ready frame outside the plain view; none while reader mode is on.
    const frame: ReaderModeFrame = {
      ready: true, layout: 'review', planned: 'off', focus: () => undefined, setReading: () => undefined, command: () => undefined,
      title: 'a.md', progress: { read: () => 0, subscribe: () => () => undefined },
    };
    const first = renderHook((p: { plainView: boolean }) => useReaderMode({ doc: 'doc-a', plainView: p.plainView, places: NO_READER_PLACES }), {
      initialProps: { plainView: false },
    });
    expect(offered(open), 'CONTROL: no frame yet').toEqual([]);
    act(() => { first.result.current.value.setFrame(frame); });
    expect(offered(open), 'a ready frame').toEqual([...ids]);
    first.rerender({ plainView: true });
    expect(offered(open), 'the plain view').toEqual([]);
    first.rerender({ plainView: false });
    expect(offered(open)).toEqual([...ids]);
    act(() => { first.result.current.value.setFrame({ ...frame, ready: false }); });
    expect(offered(open), 'a frame that is not ready').toEqual([]);
    first.unmount();
    expect(offered(open), 'unmounted: the slot is cleared').toEqual([]);
  });

  it('palette: a Layout command writes the pref and tells the frame, for the layout already shown too', () => {
    setReaderLayoutHandle({ layoutRowDrawn: () => true });
    const heard: string[] = [];
    const stop = onReaderLayout((l) => { heard.push(l); });
    try {
      for (const row of layoutRows()) row.run(ctx());
      expect(heard).toEqual([...READER_LAYOUTS]);
      expect(window.localStorage.getItem('ccrc:reader:v1:pref:prefs'), 'the last choice is stored').toBe('{"layout":"guided"}');
      // The layout already stored is written again: no skip for "already shown".
      heard.length = 0;
      layoutRows()[4]!.run(ctx());
      expect(heard).toEqual(['guided']);
    } finally {
      stop();
      window.localStorage.clear();
    }
  });

  it('palette: a Layout command run where the Layout row is not drawn does nothing', () => {
    // m-1: `run` re-checks the handle as `toggle-reader-mode`'s does, so a run that reaches it after the row went (a stale palette
    // list, reader mode entered meanwhile, another screen) writes no pref and tells no frame.
    const heard: string[] = [];
    const stop = onReaderLayout((l) => { heard.push(l); });
    try {
      // No Docs screen at all, and a screen whose row is not drawn.
      setReaderLayoutHandle(null);
      for (const row of layoutRows()) row.run(ctx());
      setReaderLayoutHandle({ layoutRowDrawn: () => false });
      for (const row of layoutRows()) row.run(ctx());
      expect(heard, 'a frame was told').toEqual([]);
      expect(window.localStorage.getItem('ccrc:reader:v1:pref:prefs'), 'a pref was written').toBeNull();
      // CONTROL: the same runs with the row drawn choose.
      setReaderLayoutHandle({ layoutRowDrawn: () => true });
      layoutRows()[3]!.run(ctx());
      expect(heard).toEqual(['review']);
    } finally {
      stop();
      window.localStorage.clear();
    }
  });
});
