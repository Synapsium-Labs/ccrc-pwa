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
import { setReaderModeHandle, type ReaderModeHandle } from '../src/docs/readerModeHandle';
import { NO_READER_PLACES, useReaderMode, type ReaderModeFrame } from '../src/docs/useReaderMode';
import { READER_MODE_KEY, READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import { useFleetStore } from '../src/stores/fleet';

afterEach(() => {
  cleanup();
  setReaderModeHandle(null);
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
      ready: true, planned: false, focus: () => undefined, setReading: () => undefined, command: () => undefined,
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
