// §5.4 row 1's WIRING half — spec §11 ruling 11.
//
// The adapter must credit `paintLag` with the displacement the viewport actually
// MADE, not the one `scrollLines` was asked for, because xterm CLAMPS at both ends
// of its buffer. The plan for this wave ships a source scan over the call site, on
// the grounds that a real `Terminal`'s `viewportY` does not move under jsdom — which
// is true, and measured (60 lines written, rows 24, baseY 37; viewportY reads 37
// before `scrollLines(-3)`, after it, and 50 ms later). A source scan can see that
// the right words are present; it cannot see that they compute the right number.
//
// Ruling 11 names the way round that: a FAKE `Terminal` whose `viewportY` does move,
// and which clamps the way the real one does. That makes both directions provable —
// a clamped scroll must credit ZERO, and a free scroll must credit the DELTA — so
// crediting `n` reds the first and crediting a constant reds the second.
//
// It lives in its own file because `vi.mock('@xterm/xterm')` is module-wide, and
// `terminal-scrollback.test.tsx` drives the REAL terminal in the dispose-mid-parse
// control test. Mocking xterm there would quietly hollow that control out.
import { describe, it, expect, vi, beforeEach } from 'vitest';

/** Row height the stubbed screen rect implies: 480px over 24 rows. */
const ROW_PX = 20;

interface FakeTerm {
  cols: number;
  rows: number;
  options: Record<string, unknown>;
  buffer: { active: { viewportY: number; baseY: number } };
}

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    // `baseY` is the bottom of the scrollback; `viewportY` rides between 0 and it.
    buffer = { active: { viewportY: 20, baseY: 40 } };
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts };
      (globalThis as { __fakeTerms?: Terminal[] }).__fakeTerms ??= [];
      (globalThis as { __fakeTerms?: Terminal[] }).__fakeTerms!.push(this);
    }
    loadAddon(): void {}
    open(host: HTMLElement): void {
      const wrapper = document.createElement('div');
      wrapper.className = 'xterm';
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      // jsdom has no layout, so the one measurement `cellHeight()` makes is stubbed
      // rather than faked away — this is the same 480/24 the plan used for its own
      // measurement table.
      screen.getBoundingClientRect = (): DOMRect =>
        ({ height: ROW_PX * 24, width: 800, top: 0, left: 0, right: 800, bottom: 480,
           x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      wrapper.appendChild(screen);
      host.appendChild(wrapper);
    }
    onRender(): { dispose(): void } { return { dispose(): void {} }; }
    onScroll(): { dispose(): void } { return { dispose(): void {} }; }
    write(_d: string, done?: () => void): void { done?.(); }
    /** THE CLAMP, which is the whole reason this fake exists. */
    scrollLines(n: number): void {
      const b = this.buffer.active;
      b.viewportY = Math.max(0, Math.min(b.baseY, b.viewportY + n));
    }
    dispose(): void {}
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon {
    fit(): void {}
  }
  return { FitAddon };
});

// Imported AFTER the mocks above are declared; `vi.mock` is hoisted, so the module
// under test binds to the fakes.
const { defaultMakeHistoryTerm } = await import('../src/session/TerminalDrawer');

const lastTerm = (): FakeTerm => {
  const all = (globalThis as { __fakeTerms?: FakeTerm[] }).__fakeTerms ?? [];
  const t = all.at(-1);
  if (!t) throw new Error('no terminal was constructed');
  return t;
};

/** The translateY the adapter is holding, in pixels; 0 when it holds none. */
const transformPx = (host: HTMLElement): number => {
  const el = host.querySelector('.xterm');
  if (!(el instanceof HTMLElement)) throw new Error('no .xterm element to read');
  const m = /translateY\((-?[\d.]+)px\)/.exec(el.style.transform);
  return m === null ? 0 : Number(m[1]);
};

const mount = (): { host: HTMLElement; term: ReturnType<typeof defaultMakeHistoryTerm> } => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const term = defaultMakeHistoryTerm(host, 2000);
  term.fit();
  return { host, term };
};

beforeEach(() => {
  (globalThis as { __fakeTerms?: unknown[] }).__fakeTerms = [];
  document.body.innerHTML = '';
});

describe('the transform is credited the rows that MOVED', () => {
  it('a free scroll credits the displacement — rows x the row height', () => {
    const { host, term } = mount();
    const fake = lastTerm();
    fake.buffer.active.viewportY = 20;          // room to move in both directions

    term.scrollLines(-3);

    // viewportY 20 -> 17, a delta of -3; the CONTENT moves down, so the transform
    // stands in for +3 rows until xterm paints them.
    expect(fake.buffer.active.viewportY, 'the fake did not scroll at all').toBe(17);
    expect(transformPx(host), 'a real displacement stopped being credited').toBe(3 * ROW_PX);
  });

  it('a scroll CLAMPED at the oldest line credits nothing', () => {
    // The defect, in one assertion. A throw that reaches the top goes on asking for
    // rows for the rest of its curve; every ask used to be credited, so the view slid
    // by a displacement the rows were never going to make and snapped back when
    // xterm's own onRender cleared it. That is the tail of a throw shaking, at the
    // top of the history, where a reader is most likely to be looking.
    const { host, term } = mount();
    const fake = lastTerm();
    fake.buffer.active.viewportY = 0;           // already at the oldest line

    term.scrollLines(-3);

    expect(fake.buffer.active.viewportY, 'the clamp did not hold').toBe(0);
    expect(transformPx(host), 'a clamped scroll displaced the view anyway').toBe(0);
  });

  it('a scroll CLAMPED at the newest line credits nothing either — both ends', () => {
    const { host, term } = mount();
    const fake = lastTerm();
    fake.buffer.active.viewportY = 40;          // baseY: nothing newer to reach

    term.scrollLines(+3);

    expect(fake.buffer.active.viewportY, 'the clamp did not hold').toBe(40);
    expect(transformPx(host), 'a clamped scroll displaced the view anyway').toBe(0);
  });

  it('a PARTIALLY clamped scroll credits only what moved', () => {
    // The case neither a pure clamp nor a pure move can catch, and the one that
    // tells `viewportY`'s delta apart from `n` most sharply: asked for 10, got 2.
    const { host, term } = mount();
    const fake = lastTerm();
    fake.buffer.active.viewportY = 2;

    term.scrollLines(-10);

    expect(fake.buffer.active.viewportY, 'the clamp did not hold').toBe(0);
    expect(transformPx(host), 'the rows ASKED FOR were credited, not the rows that moved')
      .toBe(2 * ROW_PX);
  });
});
