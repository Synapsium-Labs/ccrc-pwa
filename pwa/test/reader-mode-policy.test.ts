// Reader mode's L1 decisions (native Docs reader, reader-mode plan Task XR1.1 as amended 2026-11-24, D-8975; the reader-mode
// spec's sections 3.3, 4.1, 4.2 and 6.3). Pure cases over `readerModeStep`, `readerModeOffered`, `wakeLockWanted`,
// `timeLeftMinutes` and the words file: no DOM, no timer. Each case title is the name the mutation table (X6.n) cites.
import { describe, expect, it } from 'vitest';
import {
  READER_EXIT_SETTLE_MS,
  READER_MODE_OFF,
  READER_WAKE_IDLE_MS,
  readerModeOffered,
  readerModeStep,
  timeLeftMinutes,
  wakeLockWanted,
  type ReaderModeAct,
  type ReaderModeEvent,
  type ReaderModeState,
} from '../src/docs/reader/readerMode';
import { READER_MODE_TEXT, timeLeftText } from '../src/docs/reader/readerModeWords';

type On = Extract<ReaderModeState, { on: true }>;

const on = (over: Partial<On> = {}): ReaderModeState => ({
  on: true, doc: 'demo:specs:a.md', how: 'full-screen', overlay: false, placed: true, ...over,
});
const enter = (over: Partial<Extract<ReaderModeEvent, { kind: 'enter' }>> = {}): ReaderModeEvent => ({
  kind: 'enter', doc: 'demo:specs:a.md', activation: true, fullscreenEnabled: true, placeFree: true, ...over,
});
const toggle = (over: Partial<Extract<ReaderModeEvent, { kind: 'frame-toggle' }>> = {}): ReaderModeEvent => ({
  kind: 'frame-toggle', doc: 'demo:specs:a.md', activation: true, fullscreenEnabled: true, placeFree: true,
  offered: true, frameFocused: true, ...over,
});
const count = (acts: readonly ReaderModeAct[], act: ReaderModeAct): number => acts.filter((a) => a === act).length;

describe('reader mode: the constants', () => {
  it('holds the measured values', () => {
    expect(READER_WAKE_IDLE_MS).toBe(300000);
    expect(READER_EXIT_SETTLE_MS).toBe(100);
    expect(READER_MODE_OFF).toEqual({ on: false });
    expect(Object.isFrozen(READER_MODE_OFF)).toBe(true);
  });
});

describe('reader mode: entering', () => {
  it('reader mode: enter draws the fill, pushes the place, then requests full screen, hides the console, focuses the frame and announces, in that order', () => {
    const r = readerModeStep(READER_MODE_OFF, enter());
    expect(r.state).toEqual({ on: true, doc: 'demo:specs:a.md', how: 'fill', overlay: false, placed: true });
    expect(r.acts).toEqual(['draw-fill', 'push-place', 'request-full-screen', 'hide-console', 'start-reading', 'focus-frame', 'announce']);
  });

  it('reader mode: enter without fullscreenEnabled draws the fill and never requests full screen', () => {
    const r = readerModeStep(READER_MODE_OFF, enter({ fullscreenEnabled: false }));
    expect(r.acts).not.toContain('request-full-screen');
    expect(r.acts).toContain('draw-fill');
    expect(r.state).toMatchObject({ on: true, how: 'fill' });
  });

  it('reader mode: enter without activation draws the fill alone', () => {
    const r = readerModeStep(READER_MODE_OFF, enter({ activation: false }));
    expect(r.acts).toEqual(['draw-fill', 'push-place', 'hide-console', 'start-reading', 'focus-frame', 'announce']);
  });

  it('reader mode: enter with the place budget spent opens unplaced', () => {
    const r = readerModeStep(READER_MODE_OFF, enter({ placeFree: false }));
    expect(r.state).toEqual({ on: true, doc: 'demo:specs:a.md', how: 'fill', overlay: false, placed: false });
    expect(r.acts).not.toContain('push-place');
    expect(r.acts).toEqual(['draw-fill', 'request-full-screen', 'hide-console', 'start-reading', 'focus-frame', 'announce']);
  });

  it('reader mode: enter while on changes nothing', () => {
    const s = on();
    expect(readerModeStep(s, enter({ doc: 'other' }))).toEqual({ state: s, acts: [] });
  });
});

describe('reader mode: full screen and its refusals', () => {
  it('reader mode: a refusal keeps reader mode on as fill', () => {
    const s = on({ how: 'fill' });
    expect(readerModeStep(s, { kind: 'full-screen-refused' })).toEqual({ state: s, acts: [] });
    expect(readerModeStep(READER_MODE_OFF, { kind: 'full-screen-refused' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: a grant while on as fill makes it full screen', () => {
    expect(readerModeStep(on({ how: 'fill' }), { kind: 'full-screen-granted' })).toEqual({ state: on({ how: 'full-screen' }), acts: [] });
  });

  it('reader mode: a grant after the exit leaves full screen', () => {
    expect(readerModeStep(READER_MODE_OFF, { kind: 'full-screen-granted' })).toEqual({ state: READER_MODE_OFF, acts: ['exit-full-screen'] });
  });

  it('reader mode: losing full screen exits and awaits the settle before stepping back', () => {
    const r = readerModeStep(on(), { kind: 'full-screen-lost' });
    expect(r.state).toEqual(READER_MODE_OFF);
    expect(r.acts).toEqual(['clear-fill', 'stop-reading', 'show-console', 'await-settle', 'focus-frame']);
    expect(r.acts).not.toContain('step-back');
    // unplaced: nothing to wait for
    expect(readerModeStep(on({ placed: false }), { kind: 'full-screen-lost' }).acts).toEqual(['clear-fill', 'stop-reading', 'show-console', 'focus-frame']);
    // the echo of an exit that already happened
    expect(readerModeStep(READER_MODE_OFF, { kind: 'full-screen-lost' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: settled after a pop landed below steps nothing, otherwise steps back once', () => {
    expect(readerModeStep(READER_MODE_OFF, { kind: 'settled', landedBelow: true })).toEqual({ state: READER_MODE_OFF, acts: [] });
    expect(readerModeStep(READER_MODE_OFF, { kind: 'settled', landedBelow: false })).toEqual({ state: READER_MODE_OFF, acts: ['step-back'] });
    // re-entered meanwhile: nothing, whatever it says
    const s = on();
    expect(readerModeStep(s, { kind: 'settled', landedBelow: false })).toEqual({ state: s, acts: [] });
    expect(readerModeStep(s, { kind: 'settled', landedBelow: true })).toEqual({ state: s, acts: [] });
  });
});

describe('reader mode: exits', () => {
  it('reader mode: a popped place exits without stepping back', () => {
    const r = readerModeStep(on(), { kind: 'place-popped' });
    expect(r.state).toEqual(READER_MODE_OFF);
    expect(r.acts).toEqual(['exit-full-screen', 'clear-fill', 'stop-reading', 'show-console', 'focus-frame']);
    expect(r.acts).not.toContain('step-back');
    expect(readerModeStep(on({ how: 'fill' }), { kind: 'place-popped' }).acts).toEqual(['clear-fill', 'stop-reading', 'show-console', 'focus-frame']);
  });

  it('reader mode: Exit and r each step back exactly once', () => {
    for (const kind of ['exit-tap', 'key', 'frame-exit'] as const) {
      const r = readerModeStep(on(), { kind });
      expect(count(r.acts, 'step-back'), kind).toBe(1);
      expect(r.state, kind).toEqual(READER_MODE_OFF);
      expect(r.acts, kind).toEqual(['exit-full-screen', 'clear-fill', 'stop-reading', 'show-console', 'step-back', 'focus-frame']);
    }
  });

  it('reader mode: esc hides the overlay and focuses the frame, and never exits', () => {
    const s = on({ overlay: true });
    expect(readerModeStep(s, { kind: 'esc' })).toEqual({ state: on({ overlay: false }), acts: ['focus-frame'] });
    // with the overlay already hidden, it still never exits
    const r = readerModeStep(on(), { kind: 'esc' });
    expect(r.state).toMatchObject({ on: true, overlay: false });
    expect(readerModeStep(READER_MODE_OFF, { kind: 'esc' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: an unplaced exit steps back nothing', () => {
    for (const kind of ['exit-tap', 'key', 'frame-exit', 'block'] as const) {
      const r = readerModeStep(on({ placed: false }), { kind });
      expect(r.acts).not.toContain('step-back');
      expect(r.state).toEqual(READER_MODE_OFF);
    }
    expect(readerModeStep(on({ placed: false, how: 'fill' }), { kind: 'exit-tap' }).acts).toEqual(['clear-fill', 'stop-reading', 'show-console', 'focus-frame']);
  });

  it("reader mode: every exit shows the console and focuses the frame, and no exit closes the frame's overlay itself", () => {
    const exits: readonly ReaderModeEvent[] = [
      { kind: 'exit-tap' }, { kind: 'key' }, { kind: 'frame-exit' }, { kind: 'block' }, { kind: 'full-screen-lost' },
      { kind: 'place-popped' }, { kind: 'doc-changed', doc: 'other' }, { kind: 'fallback' },
    ];
    for (const e of exits) {
      const r = readerModeStep(on({ overlay: true }), e);
      expect(r.state, e.kind).toEqual(READER_MODE_OFF);
      expect(r.acts, e.kind).toContain('show-console');
      expect(r.acts, e.kind).toContain('focus-frame');
      // the vocabulary has no act that closes the frame's overlay: the step-back's pop does (XR1.3)
      expect(r.acts.filter((a) => /overlay/.test(a)), e.kind).toEqual([]);
    }
  });

  it('reader mode: a place popped after an exit is a no-op', () => {
    expect(readerModeStep(READER_MODE_OFF, { kind: 'place-popped' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: a doc change exits and steps back nothing', () => {
    const r = readerModeStep(on(), { kind: 'doc-changed', doc: 'demo:specs:b.md' });
    expect(r.state).toEqual(READER_MODE_OFF);
    expect(r.acts).toEqual(['exit-full-screen', 'clear-fill', 'stop-reading', 'show-console', 'focus-frame']);
    const s = on();
    expect(readerModeStep(s, { kind: 'doc-changed', doc: 'demo:specs:a.md' })).toEqual({ state: s, acts: [] });
    expect(readerModeStep(READER_MODE_OFF, { kind: 'doc-changed', doc: 'x' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: a fallback exits and steps back once', () => {
    const r = readerModeStep(on(), { kind: 'fallback' });
    expect(r.state).toEqual(READER_MODE_OFF);
    expect(r.acts).toEqual(['exit-full-screen', 'clear-fill', 'show-console', 'step-back', 'focus-frame']);
    expect(count(r.acts, 'step-back')).toBe(1);
    expect(readerModeStep(on({ placed: false, how: 'fill' }), { kind: 'fallback' }).acts).toEqual(['clear-fill', 'show-console', 'focus-frame']);
    expect(readerModeStep(READER_MODE_OFF, { kind: 'fallback' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: a block exits full screen and reader mode', () => {
    const r = readerModeStep(on(), { kind: 'block' });
    expect(r.state).toEqual(READER_MODE_OFF);
    // A block is not a pop, so a placed entry is stepped back over once, as Exit does: no dead reader entry is left.
    expect(r.acts).toEqual(['exit-full-screen', 'clear-fill', 'stop-reading', 'show-console', 'step-back', 'focus-frame']);
    expect(readerModeStep(READER_MODE_OFF, { kind: 'block' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: the screen leaving gives the page back and steps nothing', () => {
    const r = readerModeStep(on(), { kind: 'leave' });
    expect(r.state).toEqual(READER_MODE_OFF);
    expect(r.acts).toEqual(['exit-full-screen', 'clear-fill', 'show-console']);
    expect(readerModeStep(on({ how: 'fill' }), { kind: 'leave' }).acts).toEqual(['clear-fill', 'show-console']);
    expect(readerModeStep(READER_MODE_OFF, { kind: 'leave' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: an exit while off does nothing', () => {
    for (const kind of ['exit-tap', 'key', 'frame-exit'] as const) {
      expect(readerModeStep(READER_MODE_OFF, { kind })).toEqual({ state: READER_MODE_OFF, acts: [] });
    }
  });
});

describe('reader mode: the overlay', () => {
  it('reader mode: menu toggles the overlay', () => {
    const shown = readerModeStep(on(), { kind: 'menu' });
    expect(shown).toEqual({ state: on({ overlay: true }), acts: [] });
    const hidden = readerModeStep(shown.state, { kind: 'menu' });
    expect(hidden).toEqual({ state: on({ overlay: false }), acts: ['focus-frame'] });
    expect(readerModeStep(READER_MODE_OFF, { kind: 'menu' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader mode: dismiss hides a shown overlay, does nothing when hidden, and never exits', () => {
    expect(readerModeStep(on({ overlay: true }), { kind: 'dismiss' })).toEqual({ state: on({ overlay: false }), acts: ['focus-frame'] });
    const hidden = on({ overlay: false });
    expect(readerModeStep(hidden, { kind: 'dismiss' })).toEqual({ state: hidden, acts: [] });
    expect(readerModeStep(READER_MODE_OFF, { kind: 'dismiss' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });
});

describe('reader ops: the frame', () => {
  it('reader ops: frame exit leaves reader mode', () => {
    const r = readerModeStep(on(), { kind: 'frame-exit' });
    expect(r.state).toEqual(READER_MODE_OFF);
    expect(r.acts).toEqual(readerModeStep(on(), { kind: 'key' }).acts);
    expect(readerModeStep(READER_MODE_OFF, { kind: 'frame-exit' })).toEqual({ state: READER_MODE_OFF, acts: [] });
  });

  it('reader ops: frame toggle enters as fill without activation, and asks for full screen with it', () => {
    const without = readerModeStep(READER_MODE_OFF, toggle({ activation: false }));
    expect(without.state).toEqual({ on: true, doc: 'demo:specs:a.md', how: 'fill', overlay: false, placed: true });
    expect(without.acts).not.toContain('request-full-screen');
    expect(without.acts).toEqual(readerModeStep(READER_MODE_OFF, enter({ activation: false })).acts);
    const withIt = readerModeStep(READER_MODE_OFF, toggle());
    expect(withIt.acts).toEqual(['draw-fill', 'push-place', 'request-full-screen', 'hide-console', 'start-reading', 'focus-frame', 'announce']);
    // while on it exits as the key does
    const out = readerModeStep(on(), toggle());
    expect(out.state).toEqual(READER_MODE_OFF);
    expect(out.acts).toEqual(readerModeStep(on(), { kind: 'key' }).acts);
  });

  it('reader ops: frame toggle is refused unless the frame is ready and focused', () => {
    // `offered` is the whole offer (a ready frame, outside the plain view, no modal layer mounted, even one closing).
    for (const over of [{ frameFocused: false }, { offered: false }, { offered: false, frameFocused: false }]) {
      expect(readerModeStep(READER_MODE_OFF, toggle(over))).toEqual({ state: READER_MODE_OFF, acts: [] });
    }
  });

  it('reader mode: entering starts the reading and every exit but a fallback stops it', () => {
    expect(readerModeStep(READER_MODE_OFF, enter()).acts).toContain('start-reading');
    const stops: readonly ReaderModeEvent[] = [
      { kind: 'exit-tap' }, { kind: 'key' }, { kind: 'frame-exit' }, { kind: 'full-screen-lost' },
      { kind: 'place-popped' }, { kind: 'doc-changed', doc: 'other' }, { kind: 'block' },
    ];
    for (const e of stops) expect(readerModeStep(on(), e).acts, e.kind).toContain('stop-reading');
    // the frame is gone on a fallback: nothing to tell
    expect(readerModeStep(on(), { kind: 'fallback' }).acts).not.toContain('stop-reading');
  });
});

describe('reader mode: what is offered, and the wake lock', () => {
  it('offered: only a ready frame outside the plain view, and never while a modal layer is mounted', () => {
    expect(readerModeOffered({ frameReady: true, plainView: false, modalMounted: false })).toBe(true);
    expect(readerModeOffered({ frameReady: false, plainView: false, modalMounted: false })).toBe(false);
    expect(readerModeOffered({ frameReady: true, plainView: true, modalMounted: false })).toBe(false);
    expect(readerModeOffered({ frameReady: true, plainView: false, modalMounted: true })).toBe(false);
  });

  it('wake: wanted at 299999 ms idle, not at 300000', () => {
    expect(wakeLockWanted({ on: true, visible: true, lastActivityMs: 0, nowMs: 299999 })).toBe(true);
    expect(wakeLockWanted({ on: true, visible: true, lastActivityMs: 0, nowMs: 300000 })).toBe(false);
    expect(wakeLockWanted({ on: true, visible: true, lastActivityMs: 1000, nowMs: 300999 })).toBe(true);
  });

  it('wake: never while hidden or off', () => {
    expect(wakeLockWanted({ on: true, visible: false, lastActivityMs: 0, nowMs: 1 })).toBe(false);
    expect(wakeLockWanted({ on: false, visible: true, lastActivityMs: 0, nowMs: 1 })).toBe(false);
    expect(wakeLockWanted({ on: false, visible: false, lastActivityMs: 0, nowMs: 1 })).toBe(false);
  });
});

describe('reader mode: time left and its words', () => {
  it('time left: 10 minutes at share 0.5 is 5 and at 1 is 0', () => {
    expect(timeLeftMinutes(10, 0.5)).toBe(5);
    expect(timeLeftMinutes(10, 1)).toBe(0);
    expect(timeLeftMinutes(10, 0)).toBe(10);
    // a share outside [0, 1] is clamped, and the result is not rounded
    expect(timeLeftMinutes(10, 2)).toBe(0);
    expect(timeLeftMinutes(10, -1)).toBe(10);
    expect(timeLeftMinutes(7, 0.25)).toBeCloseTo(5.25, 10);
  });

  it('time left text: 0.6 minutes is less than a minute, 1.4 is about 1 min, 11.6 is about 12 min', () => {
    expect(timeLeftText(0.6)).toBe('less than a minute left');
    expect(timeLeftText(1.4)).toBe('about 1 min left');
    expect(timeLeftText(11.6)).toBe('about 12 min left');
    expect(timeLeftText(0)).toBe('less than a minute left');
  });

  it('words: the reader mode sentences', () => {
    expect(READER_MODE_TEXT).toEqual({
      enter: 'Reader mode', exit: 'Exit reader mode', live: 'Reader mode. Back or Exit leaves it.', toolbar: 'Reader mode',
    });
    expect(Object.isFrozen(READER_MODE_TEXT)).toBe(true);
  });
});
