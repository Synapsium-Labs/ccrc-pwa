// Reader mode's overlay (native Docs reader, reader-mode plan Task XR1.4 with XR2.1 folded in, as amended 2026-11-24, D-8975,
// D-8803; spec 2026-11-20 sections 2.1, 2.2, 4.2 "The overlay, shown and hidden" and "Where things sit", 6.2 and 6.5). The XR2
// shape: a top strip with the title only, a clear layer between the strips, and a bottom strip (`role="toolbar"`) with Exit,
// Aa and the progress text. jsdom: the hook and `DocsReading` render with a fake frame whose `focus`, `command` and `setReading`
// are spies and whose progress is a real `createReaderProgress()`; the overlay is shown the way the frame's band tap shows it
// (`menu()`). Stylesheet rules are read as text (vitest evaluates none). Portrait and landscape, and the pixels, are the
// browser leg's (`reader-mode.browser.test.ts`): the plan's "in portrait and in landscape" half of the two XR2.1 rows is not
// asserted here. XR2.2 (the turn setting and the time left) is in the last two describes and in the X6.74 case.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRef, useEffect, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { Sheet } from '@ccrc/ui';
import { DocsReading } from '../src/docs/DocsReading';
import { ReaderModeOverlay, type ReaderModeOverlayHandle } from '../src/docs/ReaderModeOverlay';
import { createReaderProgress } from '../src/docs/readerBar';
import {
  NO_READER_PLACES, ReaderModeContext, useReaderMode,
  type ReaderModeContextValue, type ReaderModeFrame, type ReaderModePlaces,
} from '../src/docs/useReaderMode';
import { READER_MODE_TEXT } from '../src/docs/reader/readerModeWords';
import { useFleetStore } from '../src/stores/fleet';
import { clearAuthLost } from '../src/lib/auth';
import { atBlock, declaredValues, declValue, effectiveValue, ruleIn } from './cssRule';

const docsCss = readFileSync(path.join(import.meta.dirname, '..', 'src', 'docs', 'docs.css'), 'utf8');

// ─── the harness ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface FakeFrame extends ReaderModeFrame {
  readonly focus: ReturnType<typeof vi.fn<() => void>>;
  readonly setReading: ReturnType<typeof vi.fn<ReaderModeFrame['setReading']>>;
  readonly command: ReturnType<typeof vi.fn<ReaderModeFrame['command']>>;
  readonly progress: ReturnType<typeof createReaderProgress>;
  /** What the frame's `focus` and `command` were called in, in order (`focus`, `command:settings`). */
  readonly order: string[];
}

function fakeFrame(readingMinutes?: number): FakeFrame {
  const order: string[] = [];
  return {
    ready: true, planned: 'off', title: 'Native Docs reader: reader mode', progress: createReaderProgress(), order,
    ...(readingMinutes === undefined ? {} : { readingMinutes }),
    focus: vi.fn<() => void>(() => { order.push('focus'); }),
    setReading: vi.fn<ReaderModeFrame['setReading']>(),
    command: vi.fn<ReaderModeFrame['command']>((name) => { order.push(`command:${name}`); }),
  };
}

/** A places port that places and steps for real-looking answers, so an exit that steps back is seen as `stepBack` calls. */
function placingPlaces(): ReaderModePlaces & { readonly stepBack: ReturnType<typeof vi.fn<() => number>> } {
  return { ...NO_READER_PLACES, placeFree: () => true, push: () => true, stepBack: vi.fn<() => number>(() => 1) };
}

let latest: ReaderModeContextValue;

/** The hook, the context and the container around a body that holds a reader host and one `Sheet`. */
function Harness(p: { frame: ReaderModeFrame | null; places?: ReaderModePlaces; sheet?: boolean; onSheetClose?: () => void }): ReactNode {
  const { value, container } = useReaderMode({ doc: 'doc-a', plainView: false, places: p.places ?? NO_READER_PLACES });
  latest = value;
  const setFrame = value.setFrame;
  const { frame } = p;
  useEffect(() => { setFrame(frame); }, [setFrame, frame]);
  return (
    <ReaderModeContext value={value}>
      <header data-testid="console-head"><button type="button">Head control</button></header>
      <DocsReading reading={container}>
        <div className="docs-leaf">
          <div className="docs-reader" data-testid="host" />
          <Sheet open={p.sheet === true} onClose={p.onSheetClose ?? (() => undefined)} title="A link"><button type="button">Inside the sheet</button></Sheet>
        </div>
      </DocsReading>
    </ReaderModeContext>
  );
}

const reading = (): HTMLElement => document.querySelector('.docs-reading') as HTMLElement;
const attr = (): string | null => reading().getAttribute('data-reader-mode');
const toolbar = (): HTMLElement | null => document.querySelector<HTMLElement>('.docs-reading-bottom');
const topStrip = (): HTMLElement | null => document.querySelector<HTMLElement>('.docs-reading-top');
const layer = (): HTMLElement | null => document.querySelector<HTMLElement>('.docs-reading-layer');
const exitButton = (): HTMLElement => screen.getByRole('button', { name: READER_MODE_TEXT.exit });
const aaButton = (): HTMLElement => screen.getByRole('button', { name: READER_MODE_TEXT.aa });
const pagesButton = (): HTMLElement => screen.getByRole('radio', { name: READER_MODE_TEXT.turnScreens });
const scrollButton = (): HTMLElement => screen.getByRole('radio', { name: READER_MODE_TEXT.turnScroll });
const TURN_KEY = 'ccrc-reader-turn';

/** Renders the harness with a ready frame and enters reader mode (the overlay is hidden on entry). */
function entered(
  over: { places?: ReaderModePlaces; sheet?: boolean; onSheetClose?: () => void; readingMinutes?: number } = {},
): { frame: FakeFrame; view: ReturnType<typeof render> } {
  const { readingMinutes, ...harness } = over;
  const frame = fakeFrame(readingMinutes);
  const view = render(<Harness frame={frame} {...harness} />);
  act(() => { latest.enter('button'); });
  expect(latest.state.on, 'CONTROL: reader mode is on').toBe(true);
  frame.focus.mockClear();
  frame.order.length = 0;
  return { frame, view };
}

const showOverlay = (): void => { act(() => { latest.menu(); }); };

beforeEach(() => {
  useFleetStore.setState({ blocked: false });
  window.localStorage.clear();   // the turn is the device's remembered choice: no case inherits another's
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  for (const el of document.querySelectorAll('[inert], [aria-hidden="true"]')) { el.removeAttribute('inert'); el.removeAttribute('aria-hidden'); }
  clearAuthLost();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── the overlay: shown, hidden, left (X6 XR1.4 as folded into XR2.1) ──────────────────────────────────────────────────

describe('overlay (X6 XR1.4, XR2.1)', () => {
  it('overlay: hidden on entry, a menu act shows it, Esc on it hides it and returns focus to the frame', () => {
    const { frame } = entered();
    expect(toolbar(), 'CONTROL: hidden on entry').toBeNull();
    expect(topStrip()).toBeNull();
    expect(layer()).toBeNull();
    expect(latest.state.on && latest.state.overlay).toBe(false);
    showOverlay();
    const bar = screen.getByRole('toolbar', { name: READER_MODE_TEXT.toolbar });
    expect(bar).toBe(toolbar());
    frame.focus.mockClear();
    fireEvent.keyDown(bar, { key: 'Escape' });
    expect(toolbar(), 'Esc did not hide the overlay').toBeNull();
    expect(layer(), 'Esc left the layer drawn').toBeNull();
    expect(latest.state.on, 'Esc on the overlay left reader mode').toBe(true);
    expect(attr()).toBe('fill');
    expect(frame.focus, 'focus did not return to the frame').toHaveBeenCalledTimes(1);
    expect(frame.setReading).not.toHaveBeenCalledWith('off');
  });

  it('overlay: showing it moves focus to Exit', () => {
    entered();
    showOverlay();
    expect(document.activeElement, 'focus did not move to Exit').toBe(exitButton());
  });

  it('overlay: Exit leaves reader mode', () => {
    const { frame } = entered();
    showOverlay();
    act(() => { fireEvent.click(exitButton()); });
    expect(latest.state.on, 'Exit did not leave reader mode').toBe(false);
    expect(attr()).toBeNull();
    expect(toolbar()).toBeNull();
    expect(frame.setReading).toHaveBeenLastCalledWith('off');
  });

  it('overlay: a tap on the layer outside it hides it and does nothing else', () => {
    const places = placingPlaces();
    const { frame } = entered({ places });
    showOverlay();
    frame.focus.mockClear();
    const l = layer();
    expect(l, 'the layer is not drawn while the overlay shows').not.toBeNull();
    expect(l?.getAttribute('aria-hidden')).toBe('true');
    expect(l?.hasAttribute('tabindex'), 'the layer is focusable').toBe(false);
    act(() => { fireEvent.click(l as HTMLElement); });
    expect(toolbar(), 'the tap did not hide the overlay').toBeNull();
    expect(layer(), 'the layer outlived the overlay').toBeNull();
    expect(latest.state.on, 'the tap left reader mode').toBe(true);
    expect(places.stepBack, 'the tap stepped back').not.toHaveBeenCalled();
    expect(frame.setReading).not.toHaveBeenCalledWith('off');
    expect(frame.command, 'the tap sent a command').not.toHaveBeenCalled();
    expect(frame.focus, 'focus did not go to the frame').toHaveBeenCalledTimes(1);
  });

  it('overlay: nothing hides it on a timer', async () => {
    vi.useFakeTimers();
    entered();
    showOverlay();
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60 * 1000); });
    expect(toolbar(), 'a timer hid the overlay').not.toBeNull();
    expect(latest.state.on && latest.state.overlay).toBe(true);
  });

  it('overlay: an Esc that closes a sheet in reader mode neither hides the overlay nor leaves reader mode', async () => {
    const onSheetClose = vi.fn();
    const { view } = entered({ onSheetClose });
    showOverlay();
    view.rerender(<Harness frame={latest.frame} sheet onSheetClose={onSheetClose} />);
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    const dialog = screen.getByRole('dialog');
    expect(reading().querySelector('.docs-reading-portal')?.contains(dialog), 'CONTROL: the sheet is in the container').toBe(true);
    expect(toolbar(), 'CONTROL: the overlay shows under the sheet').not.toBeNull();
    await act(async () => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    expect(onSheetClose, 'the Esc did not ask the sheet to close').toHaveBeenCalled();
    expect(toolbar(), 'the sheet\'s Esc hid the overlay').not.toBeNull();
    expect(latest.state.on, 'the sheet\'s Esc left reader mode').toBe(true);
    expect(latest.state.on && latest.state.overlay).toBe(true);
  });
});

// ─── the progress text ─────────────────────────────────────────────────────────────────────────────────────────────────

describe('overlay: the progress text (X6 XR1.4)', () => {
  it('overlay: the percentage follows progress, at most once a second', async () => {
    vi.useFakeTimers();
    const { frame } = entered();
    frame.progress.set(0.41);
    showOverlay();
    const status = screen.getByRole('status');
    expect(status.textContent, 'the first value is read at once, rounded').toBe('41%');
    expect(status.hasAttribute('tabindex'), 'the progress text is focusable').toBe(false);
    // A change within the second waits; the text holds the last shown value.
    await act(async () => { frame.progress.set(0.5); await vi.advanceTimersByTimeAsync(500); });
    expect(status.textContent, 'updated inside the second').toBe('41%');
    await act(async () => { await vi.advanceTimersByTimeAsync(499); });
    expect(status.textContent, 'updated a millisecond early').toBe('41%');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(status.textContent, 'did not follow progress after a second').toBe('50%');
    // A burst lands as its final value, once, a second after the last shown one.
    await act(async () => {
      frame.progress.set(0.6); frame.progress.set(0.7); frame.progress.set(0.804);
      await vi.advanceTimersByTimeAsync(999);
    });
    expect(status.textContent).toBe('50%');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(status.textContent, 'the burst\'s final value did not land').toBe('80%');
    // A change after a quiet second shows at once.
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    await act(async () => { frame.progress.set(1); });
    expect(status.textContent, 'a change after a quiet second waited').toBe('100%');
  });
});

// ─── the tap floor (spec 4.14; the house floor `--tap-min`) ────────────────────────────────────────────────────────────

describe('overlay: the tap floor and motion (X6 XR1.4)', () => {
  it('overlay: every control is at least the tap floor', () => {
    for (const sel of ['.docs-reading-exit', '.docs-reading-aa', '.docs-reading-turn']) {
      const rule = ruleIn(docsCss, sel);
      expect(declValue(rule, 'min-width'), `${sel} min-width`).toBe('var(--tap-min)');
      expect(declValue(rule, 'min-height'), `${sel} min-height`).toBe('var(--tap-min)');
    }
    // The top strip is a tap target too (it hides the overlay), so it holds the floor in its height.
    expect(effectiveValue(docsCss, '.docs-reading-top', 'min-height')).toBe('var(--tap-min)');
    // The rendered buttons wear the classes the rules floor.
    entered();
    showOverlay();
    expect(exitButton().classList.contains('docs-reading-exit')).toBe(true);
    expect(aaButton().classList.contains('docs-reading-aa')).toBe(true);
    expect(pagesButton().classList.contains('docs-reading-turn')).toBe(true);
    expect(scrollButton().classList.contains('docs-reading-turn')).toBe(true);
  });

  it('overlay: it appears with a --dur-fast fade, and with none under reduced motion', () => {
    const reduced = atBlock(docsCss, '@media (prefers-reduced-motion: reduce)');
    for (const sel of ['.docs-reading-top', '.docs-reading-bottom']) {
      expect(declaredValues(docsCss, sel, 'transition')[0] ?? '', `${sel} fade`).toContain('opacity var(--dur-fast)');
      expect(declValue(ruleIn(reduced, sel), 'transition'), `${sel} under reduced motion`).toBe('none');
    }
    // The fade starts from transparent, and the block governs: it sits after the rule that declares the fade.
    expect(atBlock(docsCss, '@starting-style'), 'no starting style: no fade').toContain('opacity: 0');
    expect(docsCss.indexOf(reduced)).toBeGreaterThan(docsCss.indexOf('transition: opacity var(--dur-fast)'));
  });

  it('overlay: the layer takes touch and the strips sit on the reader\'s ground, above the layer', () => {
    const layerRule = ruleIn(docsCss, '.docs-reading-layer');
    expect(declValue(layerRule, 'touch-action'), 'the layer lets a drag through to the frame').toBe('none');
    const z = (sel: string): number => Number(effectiveValue(docsCss, sel, 'z-index'));
    for (const sel of ['.docs-reading-top', '.docs-reading-bottom']) {
      expect(effectiveValue(docsCss, sel, 'background'), `${sel} ground`).toBe('var(--bg-page)');
      expect(z(sel), `${sel} is under the layer`).toBeGreaterThan(z('.docs-reading-layer'));
    }
  });
});

describe('overlay: the safe areas (X6 XR1.4)', () => {
  it('reader mode: the fill reads the device\'s own safe areas, not the console\'s bars', () => {
    // Inside the phone's `.app-shell` the bar's mount redefines `--safe-bottom` (inset + `--phone-bar-h`, shell.css); the fill
    // covers the console's bars, so it restates the device's inset for itself and for the strips it positions.
    const fill = ruleIn(docsCss, '.docs-reading[data-reader-mode]');
    expect(declValue(fill, '--safe-bottom'), 'the fill inherits the shell\'s --safe-bottom, bar height included')
      .toBe('env(safe-area-inset-bottom,0px)');
    expect(declValue(fill, 'padding'), 'the fill pads by the safe areas').toContain('var(--safe-bottom)');
    expect(declValue(fill, 'padding')).toContain('var(--safe-top)');
    // `--safe-top` is declared on the root only (no shell rule redefines it): the fill must not redefine it to something else.
    expect(declValue(fill, '--safe-top')).toBeNull();
    // The strips read the fill's own values (they are its descendants), never a restatement of their own.
    expect(effectiveValue(docsCss, '.docs-reading-bottom', 'inset-block-end')).toBe('var(--safe-bottom)');
    expect(effectiveValue(docsCss, '.docs-reading-top', 'inset-block-start')).toBe('var(--safe-top)');
    expect(declaredValues(docsCss, '.docs-reading-bottom', '--safe-bottom')).toEqual([]);
  });
});

// ─── the XR2.1 rows: the band's menu act, the top strip, the bottom strip and Aa ───────────────────────────────────────────

describe('reader ops: the overlay\'s shape and Aa (X6 XR2.1)', () => {
  it('reader ops: a second menu act hides the overlay, and a tap on the layer or anywhere on the top strip hides it', () => {
    const { frame } = entered();
    // The second `menu` act of the frame's band toggles it off, and returns focus to the frame.
    showOverlay();
    expect(toolbar()).not.toBeNull();
    frame.focus.mockClear();
    showOverlay();
    expect(toolbar(), 'a second menu act did not hide the overlay').toBeNull();
    expect(frame.focus).toHaveBeenCalledTimes(1);
    // A tap on the layer.
    showOverlay();
    act(() => { fireEvent.click(layer() as HTMLElement); });
    expect(toolbar(), 'a tap on the layer did not hide it').toBeNull();
    // A tap on the top strip's title, and on the strip itself away from the title.
    showOverlay();
    const title = topStrip()?.querySelector('.docs-reading-title') as HTMLElement;
    expect(title.textContent).toBe(frame.title);
    act(() => { fireEvent.click(title); });
    expect(toolbar(), 'a tap on the title did not hide it').toBeNull();
    showOverlay();
    act(() => { fireEvent.click(topStrip() as HTMLElement); });
    expect(toolbar(), 'a tap on the strip away from the title did not hide it').toBeNull();
    expect(latest.state.on, 'a hide left reader mode').toBe(true);
    expect(frame.setReading).not.toHaveBeenCalledWith('off');
    // (Portrait and landscape: the browser leg's.)
  });

  it('reader ops: the top strip holds no control and a tap anywhere on it hides the overlay; Exit, the turn setting and Aa sit in the bottom strip', () => {
    entered();
    showOverlay();
    const top = topStrip() as HTMLElement;
    expect(top.querySelectorAll('button, a, input, select, textarea, [tabindex], [role]'), 'the top strip holds a control').toHaveLength(0);
    expect(top.textContent, 'the title alone').toBe('Native Docs reader: reader mode');
    expect(top.contains(exitButton()), 'Exit is drawn in the top strip').toBe(false);
    const bar = toolbar() as HTMLElement;
    expect(bar.contains(exitButton())).toBe(true);
    expect(bar.contains(aaButton())).toBe(true);
    // The turn setting (X6 XR2.2): a named radio group of the two turn radios, in the bottom strip.
    const turns = within(bar).getByRole('radiogroup', { name: READER_MODE_TEXT.turn });
    expect(turns.contains(pagesButton()) && turns.contains(scrollButton()), 'the turn setting is not in the bottom strip').toBe(true);
    expect(top.contains(turns), 'the turn setting is drawn in the top strip').toBe(false);
    const buttons: HTMLElement[] = [...bar.querySelectorAll('button')];
    expect(buttons[0], 'Exit is at the strip\'s left end').toBe(exitButton());
    // The spec's order: Exit, the turn setting, Aa (Aa stays the toolbar's last control).
    expect(buttons, 'the order of the bottom strip\'s controls').toEqual([exitButton(), pagesButton(), scrollButton(), aaButton()]);
    // The strips and the layer, in DOM order: the top strip, the layer, the bottom strip.
    const controls = document.querySelector('.docs-reading-controls') as HTMLElement;
    expect([...controls.children].map((c) => c.className)).toEqual(['docs-reading-top', 'docs-reading-layer', 'docs-reading-bottom']);
    // The progress text follows the buttons and is not focusable.
    expect(bar.lastElementChild?.getAttribute('role')).toBe('status');
  });

  it('reader ops: entering hides the frame\'s Aa in place, and the overlay\'s Aa sends command settings', () => {
    const { frame } = entered();
    // Entering sent the reading with the turn: the frame's own Aa is hidden in place by the library, with no remount.
    expect(frame.setReading).toHaveBeenCalledWith('screens');
    expect(latest.frame, 'the same frame stands: nothing remounted').toBe(frame);
    expect(frame.command).not.toHaveBeenCalled();
    showOverlay();
    act(() => { fireEvent.click(aaButton()); });
    expect(frame.command).toHaveBeenCalledTimes(1);
    expect(frame.command).toHaveBeenCalledWith('settings');
    expect(latest.state.on, 'Aa left reader mode').toBe(true);
  });

  it('reader ops: the overlay\'s Aa hides the overlay and its layer before it sends command settings', () => {
    const { frame } = entered();
    showOverlay();
    frame.order.length = 0;
    act(() => { fireEvent.click(aaButton()); });
    // The decider's `dismiss` runs first (its `focus-frame` act is the first call), then the command.
    expect(frame.order, 'the command went before the overlay was hidden').toEqual(['focus', 'command:settings']);
    expect(toolbar(), 'the overlay stayed').toBeNull();
    expect(layer(), 'the layer stayed under the frame\'s settings menu').toBeNull();
    expect(latest.state.on && latest.state.overlay).toBe(false);
    expect(latest.state.on).toBe(true);
  });

  it('overlay: a tap on Exit or Aa counts as activity, and a tap on the layer or the top strip does not', () => {
    const calls: string[] = [];
    const props = {
      title: 'A title', progress: createReaderProgress(),
      onExit: () => { calls.push('exit'); }, onAa: () => { calls.push('aa'); }, onDismiss: () => { calls.push('dismiss'); },
      onEsc: () => { calls.push('esc'); }, onActivity: () => { calls.push('activity'); },
      turn: 'screens' as const, onTurn: (next: string) => { calls.push(`turn:${next}`); },
    };
    render(<ReaderModeOverlay {...props} />);
    fireEvent.click(exitButton());
    expect(calls).toEqual(['activity', 'exit']);
    calls.length = 0;
    fireEvent.click(aaButton());
    expect(calls).toEqual(['activity', 'aa']);
    calls.length = 0;
    fireEvent.click(scrollButton());
    expect(calls, 'the turn setting counts as activity, then asks for the turn').toEqual(['activity', 'turn:scroll']);
    calls.length = 0;
    fireEvent.click(pagesButton());
    expect(calls).toEqual(['activity', 'turn:screens']);
    calls.length = 0;
    fireEvent.click(layer() as HTMLElement);
    fireEvent.click(topStrip() as HTMLElement);
    expect(calls).toEqual(['dismiss', 'dismiss']);
    calls.length = 0;
    fireEvent.keyDown(toolbar() as HTMLElement, { key: 'Escape' });
    fireEvent.keyDown(toolbar() as HTMLElement, { key: 'a' });
    expect(calls, 'only Esc on the toolbar is the overlay\'s').toEqual(['esc']);
  });
});

// ─── the focus guards, decided by the state (spec 6.5; X6.77's jsdom half) ─────────────────────────────────────────────

describe('focus (X6 XR1.2, XR2.1)', () => {
  it('focus: with the overlay hidden, the leading guard sends focus to the frame, and with it shown, to its last control', () => {
    const { frame } = entered();
    const leading = document.querySelector('.docs-reading-guard') as HTMLElement;
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => { leading.focus(); });
    expect(frame.focus, 'hidden: the leading guard did not send focus to the frame').toHaveBeenCalledTimes(1);
    expect(document.activeElement, 'hidden: focus went to a ccrc control').toBe(leading);

    showOverlay();
    frame.focus.mockClear();
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => { leading.focus(); });
    expect(document.activeElement, 'shown: the leading guard did not wrap to the overlay\'s last control').toBe(aaButton());
    expect(frame.focus, 'shown: focus also went to the frame').not.toHaveBeenCalled();
  });

  it('overlay: Aa is the toolbar\'s last control, and the leading guard wraps to it', () => {
    entered();
    showOverlay();
    const buttons = [...(toolbar() as HTMLElement).querySelectorAll('button')];
    expect(buttons[0], 'Exit is first').toBe(exitButton());
    expect(buttons.at(-1), 'Aa is not the toolbar\'s last control').toBe(aaButton());
    const leading = document.querySelector('.docs-reading-guard') as HTMLElement;
    (document.activeElement as HTMLElement | null)?.blur();
    act(() => { leading.focus(); });
    expect(document.activeElement, 'the leading guard did not wrap to the last control').toBe(buttons.at(-1));
  });

  it('overlay: the wrap takes the toolbar\'s last button, whatever sits there (the turn setting, XR2.2, is placed before Aa)', () => {
    const ref = createRef<ReaderModeOverlayHandle>();
    render(
      <ReaderModeOverlay
        ref={ref} title="T" progress={createReaderProgress()}
        onExit={() => undefined} onAa={() => undefined} onDismiss={() => undefined} onEsc={() => undefined} onActivity={() => undefined}
        turn="screens" onTurn={() => undefined}
      />,
    );
    const bar = toolbar() as HTMLElement;
    // A control placed anywhere is never skipped: a button appended after Aa is the last one, and one before it changes nothing.
    const before = document.createElement('button');
    before.type = 'button';
    aaButton().before(before);
    ref.current?.focusLast();
    expect(document.activeElement, 'the wrap went to Aa, not the toolbar\'s last button').toBe(aaButton());
    const after = document.createElement('button');
    after.type = 'button';
    bar.querySelector('.docs-reading-aa')?.after(after);
    ref.current?.focusLast();
    expect(document.activeElement, 'a button placed last was skipped').toBe(after);
  });
});

describe('overlay: a dropped frame (X6 XR1.4)', () => {
  it('overlay: a new body while the overlay shows hides it, and the new frame\'s ready does not show it again', () => {
    const { frame, view } = entered();
    showOverlay();
    expect(toolbar(), 'CONTROL: the overlay shows').not.toBeNull();
    frame.focus.mockClear();
    // The body ends (a new commit, a part switch): its frame is dropped, as `ReaderFrame`'s cleanup does.
    act(() => { latest.dropFrame(frame); });
    // With no frame standing the Exit alone is drawn (X6 XR fix round 1): none of the overlay's own controls outlives its frame.
    expect(toolbar()?.querySelectorAll('button').length, 'more than the Exit outlived the frame').toBe(1);
    expect(toolbar()?.querySelector('[role="radiogroup"]'), 'the turn setting outlived its frame').toBeNull();
    expect(document.querySelector('.docs-reading-top'), 'the title strip outlived its frame').toBeNull();
    expect(layer(), 'the layer outlived its frame').toBeNull();
    expect(latest.state.on, 'dropping the frame left reader mode').toBe(true);
    expect(latest.state.on && latest.state.overlay, 'the state still says the overlay shows').toBe(false);
    expect(frame.focus, 'the dropped frame was focused').not.toHaveBeenCalled();
    // The new body's frame is ready: reader mode is brought to it, and the overlay does not come back or take focus.
    const next = fakeFrame();
    view.rerender(<Harness frame={next} />);
    expect(latest.frame, 'CONTROL: the new frame is the stored one').toBe(next);
    expect(toolbar(), 'the new frame\'s ready showed the overlay again').toBeNull();
    expect(document.activeElement?.closest('.docs-reading-bottom'), 'focus went to a ccrc control unasked').toBeNull();
    expect(latest.state.on && latest.state.overlay).toBe(false);
    // A frame that is not the stored one clears nothing and hides nothing.
    showOverlay();
    expect(toolbar(), 'CONTROL: the overlay shows again by a menu act').not.toBeNull();
    act(() => { latest.dropFrame(frame); });
    expect(toolbar(), 'a stale frame\'s drop hid the overlay').not.toBeNull();
    expect(latest.frame).toBe(next);
  });
});

// ─── the turn setting (X6 XR2.2) ───────────────────────────────────────────────────────────────────────────────────────────

describe('turn (X6 XR2.2)', () => {
  it('turn: Pages by default, Scroll kept per device, sent with setReading', () => {
    // Nothing stored: pages, sent when reader mode starts, and nothing written.
    const { frame } = entered();
    expect(latest.turn, 'the default turn').toBe('screens');
    expect(frame.setReading).toHaveBeenCalledTimes(1);
    expect(frame.setReading).toHaveBeenLastCalledWith('screens');
    expect(window.localStorage.getItem(TURN_KEY), 'choosing nothing stored something').toBeNull();
    showOverlay();
    expect(pagesButton().getAttribute('aria-checked')).toBe('true');
    expect(scrollButton().getAttribute('aria-checked')).toBe('false');
    // Choosing Scroll: stored, sent to the frame in place, the overlay stays, reader mode stays on.
    frame.setReading.mockClear();
    act(() => { fireEvent.click(scrollButton()); });
    expect(frame.setReading, 'the new turn was not sent to the frame').toHaveBeenCalledTimes(1);
    expect(frame.setReading).toHaveBeenCalledWith('scroll');
    expect(window.localStorage.getItem(TURN_KEY), 'the choice was not kept on the device').toBe('scroll');
    expect(latest.turn).toBe('scroll');
    expect(scrollButton().getAttribute('aria-checked')).toBe('true');
    expect(pagesButton().getAttribute('aria-checked')).toBe('false');
    expect(toolbar(), 'choosing a turn hid the overlay').not.toBeNull();
    expect(latest.state.on && latest.state.overlay).toBe(true);
    expect(latest.frame, 'choosing a turn remounted the frame').toBe(frame);
    expect(frame.command, 'choosing a turn sent a command').not.toHaveBeenCalled();
    // The turn already in force: nothing is sent or written again.
    act(() => { fireEvent.click(scrollButton()); });
    expect(frame.setReading).toHaveBeenCalledTimes(1);
    // A later mount of the hook (another visit, another document) reads Scroll back, and a body made under reader mode is made under it.
    cleanup();
    const next = fakeFrame();
    render(<Harness frame={next} />);
    expect(latest.turn, 'a new hook instance did not read the kept turn').toBe('scroll');
    // Off: a change of turn is kept and sent nowhere.
    act(() => { latest.setTurn('screens'); });
    expect(next.setReading, 'a change of turn while off reached the frame').not.toHaveBeenCalled();
    expect(window.localStorage.getItem(TURN_KEY)).toBe('screens');
    act(() => { latest.setTurn('scroll'); });
    act(() => { latest.enter('button'); });
    expect(next.setReading).toHaveBeenCalledTimes(1);
    expect(next.setReading, 'entering did not send the kept turn').toHaveBeenCalledWith('scroll');
    expect(latest.readingFor('doc-a')).toBe('scroll');
  });

  it('turn: the setting is a radio group: the checked radio is the one tab stop, and the arrow keys move between the radios and choose', () => {
    const { frame } = entered();
    showOverlay();
    const group = screen.getByRole('radiogroup', { name: READER_MODE_TEXT.turn });
    expect(within(group).getAllByRole('radio')).toHaveLength(2);
    expect(pagesButton().tabIndex, 'the checked radio is the tab stop').toBe(0);
    expect(scrollButton().tabIndex, 'the other radio is reached by the arrow keys').toBe(-1);
    frame.setReading.mockClear();
    // Right: from Pages to Scroll. Focus moves, the turn is chosen, sent and kept; the overlay stays.
    pagesButton().focus();
    act(() => { fireEvent.keyDown(pagesButton(), { key: 'ArrowRight' }); });
    expect(document.activeElement, 'focus did not move to Scroll').toBe(scrollButton());
    expect(scrollButton().getAttribute('aria-checked')).toBe('true');
    expect(pagesButton().tabIndex).toBe(-1);
    expect(scrollButton().tabIndex).toBe(0);
    expect(frame.setReading).toHaveBeenLastCalledWith('scroll');
    expect(window.localStorage.getItem(TURN_KEY)).toBe('scroll');
    expect(toolbar(), 'an arrow key hid the overlay').not.toBeNull();
    // Right again wraps to Pages; Left and Up go back; Down goes forward.
    act(() => { fireEvent.keyDown(scrollButton(), { key: 'ArrowRight' }); });
    expect(document.activeElement).toBe(pagesButton());
    expect(latest.turn).toBe('screens');
    act(() => { fireEvent.keyDown(pagesButton(), { key: 'ArrowLeft' }); });
    expect(document.activeElement, 'Left from the first did not wrap').toBe(scrollButton());
    expect(latest.turn).toBe('scroll');
    act(() => { fireEvent.keyDown(scrollButton(), { key: 'ArrowUp' }); });
    expect(latest.turn).toBe('screens');
    act(() => { fireEvent.keyDown(pagesButton(), { key: 'ArrowDown' }); });
    expect(latest.turn).toBe('scroll');
    // Any other key is not the group's: it neither moves nor chooses, and Esc still reaches the toolbar and hides the overlay.
    const calls = frame.setReading.mock.calls.length;
    act(() => { fireEvent.keyDown(scrollButton(), { key: 'a' }); });
    expect(frame.setReading.mock.calls.length).toBe(calls);
    act(() => { fireEvent.keyDown(scrollButton(), { key: 'Escape' }); });
    expect(toolbar(), 'Esc on a radio did not reach the toolbar').toBeNull();
    expect(latest.state.on).toBe(true);
  });

  it('turn: an unknown stored word reads Pages, and a hook that cannot store still turns for the page', () => {
    window.localStorage.setItem(TURN_KEY, 'book');
    const { result } = renderHook(() => useReaderMode({ doc: 'doc-a', plainView: false, places: NO_READER_PLACES }));
    expect(result.current.value.turn).toBe('screens');
    cleanup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('full', 'QuotaExceededError'); });
    const { frame } = entered();
    showOverlay();
    frame.setReading.mockClear();
    act(() => { fireEvent.click(scrollButton()); });
    expect(frame.setReading, 'a refused write stopped the turn reaching the frame').toHaveBeenCalledWith('scroll');
    expect(latest.turn).toBe('scroll');
    expect(window.localStorage.getItem(TURN_KEY), 'CONTROL: the store refused the write').toBe('book');
  });

  it('turn: a frame ready after a switch of the turn is brought to it, and a ready frame under the turn in force is left alone', () => {
    // Reader mode is on over one frame; the turn is switched to Scroll; that body ends, and its replacement, made under Pages
    // before the switch, reports ready.
    const { frame } = entered();
    act(() => { latest.setTurn('scroll'); });
    expect(frame.setReading).toHaveBeenLastCalledWith('scroll');
    act(() => { latest.dropFrame(frame); });
    const made = fakeFrame();
    act(() => { latest.setFrame({ ...made, planned: 'screens' }); });
    expect(made.setReading, 'the frame made under Pages was left there').toHaveBeenCalledTimes(1);
    expect(made.setReading).toHaveBeenCalledWith('scroll');
    // One made under the turn in force is left alone.
    act(() => { latest.dropFrame(latest.frame as ReaderModeFrame); });
    const current = fakeFrame();
    act(() => { latest.setFrame({ ...current, planned: 'scroll' }); });
    expect(current.setReading, 'a frame already under the turn was sent it again').not.toHaveBeenCalled();
  });
});

describe('time left (X6 XR2.2)', () => {
  it('time left: the overlay reads about N min left from readingMinutes and the share', () => {
    const { frame } = entered({ readingMinutes: 10 });
    frame.progress.set(0.5);
    showOverlay();
    const status = screen.getByRole('status');
    expect(status.textContent, 'the percentage, then the time left at the same share').toBe('50% · about 5 min left');
    expect(status.hasAttribute('tabindex'), 'the progress text is focusable').toBe(false);
  });

  it('time left: the time left and the percentage change together, at most once a second', async () => {
    vi.useFakeTimers();
    const { frame } = entered({ readingMinutes: 10 });
    frame.progress.set(0.4);
    showOverlay();
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('40% · about 6 min left');
    await act(async () => { frame.progress.set(0.95); await vi.advanceTimersByTimeAsync(999); });
    expect(status.textContent, 'the time left moved inside the second').toBe('40% · about 6 min left');
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(status.textContent, 'the time left did not land with the percentage').toBe('95% · less than a minute left');
  });

  it('time left: absent readingMinutes shows the percentage alone', () => {
    const { frame } = entered();
    frame.progress.set(0.5);
    showOverlay();
    expect(screen.getByRole('status').textContent).toBe('50%');
  });

  it('time left: a reading time of 0, the library\'s no text, shows the percentage alone', () => {
    const { frame } = entered({ readingMinutes: 0 });
    frame.progress.set(0.5);
    showOverlay();
    expect(screen.getByRole('status').textContent, 'a document with no text claimed a time left').toBe('50%');
  });
});
