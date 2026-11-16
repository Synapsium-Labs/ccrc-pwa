// THE BOTTOM LATCH, and the transform that carries the rows between repaints —
// the two pieces of `defaultMakeHistoryTerm` no existing test can reach,
// because every xterm mock in this suite ignores the callbacks the factory
// registers. This one captures them.
//
// WHY THE LATCH IS NOT AN OPTIMISATION. Writing the history scrolls xterm's
// view to the newest line, which is a bottom arrival NOBODY ASKED FOR. Without
// the latch the drawer would hand itself straight back to the live pane the
// moment the scrollback landed — the reader taps to look back and is returned
// to where they started. Only a reader who has been AWAY from the bottom may
// come back to it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Fake {
  scrollCbs: (() => void)[];
  renderCbs: (() => void)[];
  buffer: { active: { viewportY: number; baseY: number } };
}

const fake = vi.hoisted(() => ({ current: null as null | Fake }));

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    buffer = { active: { viewportY: 40, baseY: 40 } };
    scrollCbs: (() => void)[] = [];
    renderCbs: (() => void)[] = [];
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts };
      fake.current = this as unknown as Fake;
    }
    loadAddon(): void {}
    open(host: HTMLElement): void {
      const wrapper = document.createElement('div');
      wrapper.className = 'xterm';
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      // 480px over 24 rows — a 20px cell, so a sub-row offset is legible.
      screen.getBoundingClientRect = (): DOMRect =>
        ({ height: 480, width: 800, top: 0, left: 0, right: 800, bottom: 480,
           x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      wrapper.appendChild(screen);
      host.appendChild(wrapper);
    }
    onRender(cb: () => void): { dispose(): void } {
      this.renderCbs.push(cb);
      return { dispose(): void {} };
    }
    onScroll(cb: () => void): { dispose(): void } {
      this.scrollCbs.push(cb);
      return { dispose(): void {} };
    }
    write(_d: string, done?: () => void): void { done?.(); }
    scrollLines(n: number): void {
      const b = this.buffer.active;
      b.viewportY = Math.max(0, Math.min(b.baseY, b.viewportY + n));
    }
    dispose(): void {}
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => ({ class: null, FitAddon: class { fit(): void {} } }));

const { defaultMakeHistoryTerm } = await import('../src/session/terminalFactory');

let host: HTMLElement;
beforeEach(() => {
  host = document.createElement('div');
  document.body.appendChild(host);
  fake.current = null;
});
afterEach(() => { host.remove(); });

/** `offset` is OPTIONAL on `HistoryTerm` — a terminal that cannot shift
 *  sub-row simply omits it, and the gesture steps in whole rows instead. The
 *  factory's own terminal always has it, and this narrows it once so every
 *  case below can call it. */
const build = (): {
  term: ReturnType<typeof defaultMakeHistoryTerm> & { offset: (px: number) => void };
  t: Fake;
} => {
  const term = defaultMakeHistoryTerm(host, 2000);
  const t = fake.current;
  if (t === null) throw new Error('the factory constructed no Terminal');
  if (term.offset === undefined) throw new Error('the factory omitted `offset`');
  return { term: term as typeof term & { offset: (px: number) => void }, t };
};

const scroll = (t: Fake, viewportY: number): void => {
  t.buffer.active.viewportY = viewportY;
  for (const cb of t.scrollCbs) cb();
};

describe('onBottom is LATCHED', () => {
  it('does not fire for a view that was never away from the bottom', () => {
    // The arrival the history's own write produces. Unlatched, this is the
    // callback that would send the reader back to the live pane immediately.
    const { term, t } = build();
    const back = vi.fn();
    term.onBottom(back);
    scroll(t, t.buffer.active.baseY);
    expect(back).not.toHaveBeenCalled();
  });

  it('fires once the reader has gone away and come back', () => {
    const { term, t } = build();
    const back = vi.fn();
    term.onBottom(back);
    scroll(t, 10);                        // away
    expect(back).not.toHaveBeenCalled();
    scroll(t, t.buffer.active.baseY);     // and back
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('re-arms: a second departure earns a second arrival', () => {
    const { term, t } = build();
    const back = vi.fn();
    term.onBottom(back);
    scroll(t, 10);
    scroll(t, 40);
    scroll(t, 5);
    scroll(t, 40);
    expect(back, 'each round trip is its own return to live').toHaveBeenCalledTimes(2);
  });
});

describe('the transform carries the rows until xterm repaints', () => {
  const transform = (): string =>
    (host.querySelector('.xterm') as HTMLElement | null)?.style.transform ?? '(no .xterm)';

  it('shifts the TERMINAL element by a sub-row offset', () => {
    // `.term-host` is the element with `overflow: hidden`, so the child is
    // what slides and gets clipped. A transform is cosmetic to xterm — it lays
    // its rows out inside this element and never measures against the page.
    const { term } = build();
    term.offset(7);
    expect(transform()).toBe('translateY(7px)');
  });

  it('clears the transform rather than writing translateY(0px)', () => {
    // An empty string is the resting state: a zero transform still costs the
    // compositor a layer, and the resting terminal should own none.
    const { term } = build();
    term.offset(7);
    term.offset(0);
    expect(transform()).toBe('');
  });

  it('xterm saying it painted ends the SCROLL carry, and only that', () => {
    // TWO SOURCES, ONE TRANSFORM, and the distinction is the whole of
    // `paintLag`: `scrolled()` adds a CARRY — the pixels the rows owe because
    // the buffer moved and the glass has not caught up — which `painted()`
    // zeroes, because xterm has now drawn them where they belong. `sub()` is
    // the FINGER's own sub-row position, and a repaint is no reason to drop
    // it: the thumb has not moved.
    //
    // Measured in that order, because the first version of this case expected
    // a paint to clear an `offset` too and the code was right: it carried the
    // finger's 7px through, as it must.
    const { term, t } = build();
    term.scrollLines(-3);                      // a carry the glass owes
    expect(transform(), 'three rows at 20px, upward').toBe('translateY(60px)');
    for (const cb of t.renderCbs) cb();
    expect(transform(), 'the carry is settled').toBe('');

    term.offset(7);                            // the finger's own position
    for (const cb of t.renderCbs) cb();
    expect(transform(), 'a repaint does not move the thumb').toBe('translateY(7px)');
  });
});
