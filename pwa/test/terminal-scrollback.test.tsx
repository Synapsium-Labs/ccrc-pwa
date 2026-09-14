// The drawer's wheel, and the console history it scrolls.
//
// THE DEFECT THIS PINS. `tmux attach` puts the CLIENT terminal on the ALTERNATE
// SCREEN (the first bytes of every attach are ESC[?1049h, measured off a real
// pty) and sets application cursor keys (ESC[?1h). xterm has no scrollback in
// the alternate buffer, so it translates a wheel notch into arrow keys and
// sends them to the pty — which is how "the mouse does the same thing as the
// arrows" happened: the wheel was paging Claude Code's prompt history and
// walking its agent blocks. `scrollback: 4000` in the drawer is inert there,
// not insufficient.
//
// So the wheel must emit NOTHING to the pty, and must scroll the pane's own
// history instead — read with `capture-pane`, which mutates nothing on the box
// and leaves no mode behind for the next client to find.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Terminal } from '@xterm/xterm';
import { TerminalDrawer, paintLag, type DrawerTerm } from '../src/session/TerminalDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  FakeSocket.instances.length = 0;
});

const ID = 'claude-a-MekWarLive';
const ESC = String.fromCharCode(27);
/** What tmux sends a fresh client, measured: alternate screen + app cursor keys. */
const TMUX_ATTACH = `${ESC}[?1049h${ESC}[?1h${ESC}=`;

class FakeSocket {
  static instances: FakeSocket[] = [];
  url: string;
  sent: string[] = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }
  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.closed = true;
  }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 20));

const wheelOn = (el: Element, deltaY: number): void => {
  el.dispatchEvent(new WheelEvent('wheel', { deltaY, deltaMode: 0, bubbles: true, cancelable: true }));
};

/** A real xterm, attached the way tmux attaches one — the control that proves
 *  the wheel→arrow translation this suite exists to stop is REAL in the xterm
 *  this build ships, not a story about an older one. */
const controlArrows = async (): Promise<string[]> => {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const term = new Terminal({ cols: 80, rows: 24, scrollback: 4000 });
  term.open(host);
  const out: string[] = [];
  term.onData((d) => out.push(d));
  await new Promise<void>((r) => term.write(TMUX_ATTACH, () => r()));
  const screenEl = host.querySelector('.xterm-screen') ?? host;
  wheelOn(screenEl, -120);
  wheelOn(screenEl, 120);
  term.dispose();
  host.remove();
  return out;
};

describe('the wheel is not an arrow key', () => {
  it('with tmux on the alternate screen a wheel notch sends nothing to the pty', async () => {
    expect(await controlArrows(), 'the control: a bare xterm DOES turn the wheel into arrows')
      .toEqual([`${ESC}OA`, `${ESC}OB`]);

    render(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} />);
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());
    act(() => ws.onmessage?.({ data: TMUX_ATTACH }));
    await act(async () => {
      await flush();
    });
    ws.sent.length = 0;

    const screenEl = document.querySelector('.xterm-screen');
    if (!screenEl) throw new Error('no xterm screen mounted');
    act(() => {
      wheelOn(screenEl, -120);
      wheelOn(screenEl, 120);
    });

    expect(ws.sent, 'the wheel reached the pty as arrow keys').toEqual([]);
    // Two REAL xterms in jsdom, each parsing and mounting: measured at 3.3 s on
    // an idle box and 5.7 s under a concurrent suite, so the 5 s default clock
    // is the flake here, never the guard.
  }, 20_000);
});

// — the history view —

/** Scripted DrawerTerm that records the wheel handler the drawer installs. */
const fakeTermFactory = () => {
  const write = vi.fn<(data: string) => void>();
  const dispose = vi.fn<() => void>();
  const wheelHandlers: ((ev: WheelEvent) => boolean)[] = [];
  const hosts: HTMLElement[] = [];
  // The KEYBOARD half of the operator's ruling. Scripted here and not only in
  // `terminal.test.tsx` because the ruling is a statement about the two
  // together — the wheel stops reaching the pane, the arrows go on reaching it
  // — and a suite that can only drive one of them cannot state it.
  let dataCb: ((data: string) => void) | null = null;
  let grid = { cols: 48, rows: 20 };
  const makeTerm = (host: HTMLElement): DrawerTerm => {
    hosts.push(host);
    return {
      write: (d) => write(d),
      onData: (cb) => {
        dataCb = cb;
      },
      onWheel: (cb) => {
        wheelHandlers.push(cb);
      },
      fit: () => ({ ...grid }),
      focus: () => {},
      dispose,
    };
  };
  return {
    makeTerm,
    write,
    dispose,
    hosts,
    type: (d: string) => dataCb?.(d),
    setGrid: (c: number, r: number) => {
      grid = { cols: c, rows: r };
    },
    // The LATEST handler: a re-attach builds a fresh terminal, and the wheel a
    // reader turns after reconnecting is the new one's.
    wheel: (deltaY: number) => wheelHandlers.at(-1)?.(new WheelEvent('wheel', { deltaY })),
    /** A wheel event with arbitrary modifiers — a trackpad pinch arrives as
     *  `wheel` with `ctrlKey`, and it is not a reach for older output. */
    wheelWith: (init: WheelEventInit) => wheelHandlers.at(-1)?.(new WheelEvent('wheel', init)),
  };
};

/** `defer: true` holds each write's parse callback instead of running it, so a
 *  test can measure what the drawer does BEFORE the history has landed — which
 *  is the real xterm's behaviour (`write` parses asynchronously) and the shape
 *  the opening scroll got wrong. */
const fakeHistoryFactory = ({ defer = false }: { defer?: boolean } = {}) => {
  const write = vi.fn<(data: string) => void>();
  const dispose = vi.fn<() => void>();
  const scrolled: number[] = [];
  /** Every sub-row shift the drawer asked to be RENDERED, in order. The whole
   *  point of the remainder is that it is shown, so a stub that only recorded
   *  `scrollLines` could not tell a pixel-smooth glide from a stepped one. */
  const offsets: number[] = [];
  const madeWith: number[] = [];
  /** Every call this terminal received, in order — the latch has to be armed
   *  before the scroll that takes the reader away from the bottom. */
  const order: string[] = [];
  const parses: Array<(() => void) | undefined> = [];
  let bottom: (() => void) | null = null;
  return {
    write,
    dispose,
    scrolled,
    offsets,
    madeWith,
    order,
    /** Run the parse callbacks a deferred stub is holding. */
    flushParse: () => {
      for (const done of parses.splice(0)) done?.();
    },
    toBottom: () => bottom?.(),
    makeHistoryTerm: (_host: HTMLElement, lines: number) => {
      madeWith.push(lines);
      return {
        write: (d: string, done?: () => void) => {
          write(d);
          order.push('write');
          if (defer) parses.push(done);
          else done?.();
        },
        fit: () => ({ cols: 48, rows: 20 }),
        rowHeight: () => ROW_PX,
        offset: (px: number) => {
          offsets.push(px);
        },
        scrollLines: (n: number) => {
          order.push('scroll');
          scrolled.push(n);
        },
        onBottom: (cb: () => void) => {
          order.push('onBottom');
          bottom = cb;
        },
        dispose,
      };
    },
  };
};

/** The history layer as a READER sees it: one door, and it says it is pressed.
 *  The old probe was the status badge — which a history that is up no longer
 *  shows, because a line count was never what the reader asked for. */
const historyDoor = () => screen.queryByRole('button', { name: 'Back to live' });

const HISTORY = 'older output\nolder still\n';

/** One row's height in CSS pixels, as the history terminal reports it. The real
 *  one measures `.xterm-screen` and divides by its own rows; the stub just says
 *  a number, because what is under test is the arithmetic on top of it. */
const ROW_PX = 18;

/** `TOUCH_OPEN_PX` as the drawer spells it. Restated rather than imported — a
 *  hardcoded literal is this repo's mutation-table control. Every drag below
 *  clears it by 4x, so this number being stale cannot make a test pass that
 *  should fail. */
const OPEN_PX = 24;

describe('the wheel scrolls the console history', () => {
  it('a wheel-up reads the pane history over capture-pane and renders it, touching the pty not at all', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) =>
      new Response(JSON.stringify({ ok: true, text: HISTORY, lines: 2000, asked: String(input) }), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    vi.stubGlobal('fetch', fetchImpl);
    const t = fakeTermFactory();
    const h = fakeHistoryFactory();
    render(
      <TerminalDrawer
        id={ID} open onClose={() => {}}
        makeSocket={makeSocket} makeTerm={t.makeTerm} makeHistoryTerm={h.makeHistoryTerm}
      />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());
    ws.sent.length = 0;

    let handled: boolean | undefined;
    act(() => {
      handled = t.wheel(-120);
    });
    expect(handled, 'the drawer must swallow the wheel, not let xterm process it').toBe(false);

    await waitFor(() => expect(h.write).toHaveBeenCalled());
    expect(fetchImpl.mock.calls.map((c) => c[0]))
      .toEqual([`/api/sessions/${encodeURIComponent(ID)}/pane/history`]);
    // CRLF, because a capture is LF-separated and an xterm needs the carriage
    // return to start the next line at column 0.
    expect(h.write).toHaveBeenCalledWith('older output\r\nolder still\r\n');
    expect(ws.sent, 'the pane must see nothing at all — the read is capture-pane').toEqual([]);
    // The view's own buffer is DERIVED from the number of lines the server
    // sent, never a second constant on this side to keep in step with it.
    expect(h.madeWith).toEqual([2000]);
    // And the gesture visibly moves: one notch up, so a wheel-up that opened
    // the history does not look like a wheel-up that did nothing.
    expect(h.scrolled).toEqual([-3]);
  });

  it('scrolling back to the bottom returns to the live pane', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, text: HISTORY, lines: 2000 }), {
        status: 200, headers: { 'content-type': 'application/json' },
      })));
    const t = fakeTermFactory();
    const h = fakeHistoryFactory();
    render(
      <TerminalDrawer
        id={ID} open onClose={() => {}}
        makeSocket={makeSocket} makeTerm={t.makeTerm} makeHistoryTerm={h.makeHistoryTerm}
      />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());
    expect(historyDoor(), 'the history went up without arming its door').toBeTruthy();

    act(() => {
      h.toBottom();
    });
    await waitFor(() => expect(historyDoor()).toBeNull());
    expect(h.dispose).toHaveBeenCalled();
  });

  it('a history read that fails says so and leaves the live view alone', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: false, error: 'gone' }), {
        status: 404, headers: { 'content-type': 'application/json' },
      })));
    const t = fakeTermFactory();
    const h = fakeHistoryFactory();
    render(
      <TerminalDrawer
        id={ID} open onClose={() => {}}
        makeSocket={makeSocket} makeTerm={t.makeTerm} makeHistoryTerm={h.makeHistoryTerm}
      />,
    );
    const ws = FakeSocket.instances.at(-1);
    if (!ws) throw new Error('drawer opened no socket');
    act(() => ws.onopen?.());
    ws.sent.length = 0;
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(screen.getByText(/no history/i)).toBeTruthy());
    expect(h.write).not.toHaveBeenCalled();
    expect(ws.sent).toEqual([]);
  });
});

// ─── the rest of the gesture, and the ruling it must not overshoot ──────────
//
// The operator's ruling has TWO halves, and only one of them is a change:
// "the MOUSE must scroll the CONSOLE HISTORY, as in a real console. Everything
// else — paging the prompt history, moving through agent blocks — stays on the
// ARROW KEYS, which already do it."
//
// The second half is why the tests below exist at all. The cheapest way to stop
// the wheel emitting arrows is to stop the DRAWER emitting arrows, and that
// passes every assertion above while taking away the affordance the operator
// said to keep. So the wheel and the arrows are measured together, in one
// mounted drawer, and the suite fails in both directions.

/** A scripted `fetch` answering one JSON body — the two status arms this route
 *  has, without each test rebuilding a Response. */
const jsonFetch = (status: number, body: unknown) =>
  // The parameter is ANNOTATED, not inferred: `vi.fn`'s type flows from the
  // implementation, and an implementation taking nothing gives a mock whose
  // `.mock.calls` are `never[]` — which quietly makes every assertion about the
  // URL this route was asked for vacuous.
  vi.fn(async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }));

const OK_HISTORY = { ok: true, text: HISTORY, lines: 2000 };

/** The four arrows as the quick-key bar spells them (`QUICK_KEYS`) — the
 *  affordance the ruling says keeps the job the wheel is being taken off. */
const ARROWS: [string, string][] = [
  ['Arrow up', '\x1b[A'],
  ['Arrow down', '\x1b[B'],
  ['Arrow left', '\x1b[D'],
  ['Arrow right', '\x1b[C'],
];

/** An opened drawer on scripted doubles, with the socket's frames already
 *  cleared: every assertion below is about what the GESTURE put there, never
 *  about the attach that preceded it. */
const mountDrawer = (histOpts?: { defer?: boolean; onClose?: () => void }) => {
  const t = fakeTermFactory();
  const h = fakeHistoryFactory(histOpts);
  const view = render(
    <TerminalDrawer
      id={ID}
      open
      onClose={histOpts?.onClose ?? (() => {})}
      makeSocket={makeSocket}
      makeTerm={t.makeTerm}
      makeHistoryTerm={h.makeHistoryTerm}
    />,
  );
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('drawer opened no socket');
  act(() => ws.onopen?.());
  ws.sent.length = 0;
  return { t, h, ws, view };
};

const lastFrame = (ws: FakeSocket): unknown => {
  const raw = ws.sent.at(-1);
  return raw === undefined ? undefined : JSON.parse(raw);
};

describe('the ruling: the wheel changes, the arrows do not', () => {
  it('the arrows still send their exact sequences, and the wheel still sends none of them', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h, ws } = mountDrawer();

    // 1 — THE HALF THAT MUST NOT CHANGE. From the keycap bar…
    for (const [label, seq] of ARROWS) {
      fireEvent.click(screen.getByRole('button', { name: label }));
      expect(lastFrame(ws), `${label} stopped reaching the pane`).toEqual({
        type: 'input',
        data: seq,
      });
    }
    // …and from a real keyboard, which arrives by `term.onData` instead.
    act(() => t.type('\x1b[A'));
    expect(lastFrame(ws)).toEqual({ type: 'input', data: '\x1b[A' });
    expect(ws.sent).toHaveLength(ARROWS.length + 1);

    // 2 — THE HALF THAT MUST. A wheel in each direction adds nothing to that
    // count: not an arrow, not anything.
    const before = ws.sent.length;
    act(() => {
      t.wheel(-120);
      t.wheel(120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());
    expect(ws.sent.length, 'the wheel put a frame on the socket').toBe(before);
  });

  it('a wheel-DOWN on the live pane reads nothing — the newest line is already on screen', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { t, h, ws } = mountDrawer();

    let handled: boolean | undefined;
    act(() => {
      handled = t.wheel(120);
    });
    // Still swallowed: xterm must not get this one either, or the down notch
    // goes back to being a Down arrow at the pane.
    expect(handled, 'a wheel-down was handed to xterm').toBe(false);
    await act(async () => {
      await flush();
    });

    expect(fetchImpl, 'scrolling down on the live pane asked the box for history').not
      .toHaveBeenCalled();
    expect(h.write).not.toHaveBeenCalled();
    expect(ws.sent).toEqual([]);
  });
});

describe('the read is one read', () => {
  it('a flick of the wheel is ONE capture, and so is a wheel turned again while reading', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { t, h } = mountDrawer();

    // Three notches inside one gesture, before any answer can arrive.
    act(() => {
      t.wheel(-120);
      t.wheel(-120);
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());
    // And one more once the history is up, which is the second state the guard
    // has to cover — `at !== 'live'` is true for `reading` AND for `history`.
    act(() => {
      t.wheel(-120);
    });
    await act(async () => {
      await flush();
    });

    expect(fetchImpl.mock.calls, 'each notch fired its own capture-pane').toHaveLength(1);
    expect(h.madeWith, 'a second history terminal was built over the first').toEqual([2000]);
  });
});

describe('the phone, which has no wheel', () => {
  it('the scroll-back keycap does the same read, and sends nothing to the pane', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { h, ws } = mountDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Scroll back' }));
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    expect(fetchImpl.mock.calls.map((c) => c[0])).toEqual([
      `/api/sessions/${encodeURIComponent(ID)}/pane/history`,
    ]);
    // It sits in the keycap bar, but it is NOT a key: the other eight put a
    // control sequence on the socket and this one must put nothing there.
    expect(ws.sent, 'the scroll-back cap sent a control sequence to the pane').toEqual([]);
  });
});

describe('the ways back to live', () => {
  it('the live button leaves the history and disposes its terminal', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h, ws } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));

    await waitFor(() => expect(historyDoor()).toBeNull());
    expect(h.dispose).toHaveBeenCalled();
    // Leaving the history is not a re-attach: the live socket is untouched and
    // still the one that was open.
    expect(ws.closed).toBe(false);
    expect(ws.sent).toEqual([]);
  });

  it('a keystroke while reading returns to live — and still reaches the pane', async () => {
    // `typed()` jumps to the bottom the way a console does when you type: the
    // keys reach the session either way, and watching them land is the whole
    // reason to press one. BOTH halves are the guard — a return-to-live that
    // swallowed the keystroke would be a worse bug than the one it fixes.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h, ws } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: 'Arrow up' }));

    await waitFor(() => expect(historyDoor()).toBeNull());
    expect(h.dispose).toHaveBeenCalled();
    expect(lastFrame(ws), 'the return to live ate the keystroke').toEqual({
      type: 'input',
      data: '\x1b[A',
    });
  });

  it('a ROTATION while reading is not a keystroke — the history stays up', async () => {
    // The other side of the same guard, and the reason `refit` does not go
    // through `typed`: a phone that turns in the reader's hand would otherwise
    // throw away the history they were reading, having been asked nothing.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h, ws } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    t.setGrid(60, 18);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });

    expect(historyDoor(), 'a rotation closed the history the reader was in').toBeTruthy();
    expect(h.dispose, 'a rotation disposed the history the reader was in').not.toHaveBeenCalled();
    // …and the resize itself still reached the pane, which is what a refit is for.
    expect(lastFrame(ws)).toEqual({ type: 'resize', cols: 60, rows: 18 });
  });

  it('a re-attach drops the history, and the fresh terminal gets a fresh wheel guard', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    const first = FakeSocket.instances.at(-1);
    act(() => first?.onclose?.());
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    // A capture taken before the drop is a snapshot of a session that has
    // moved on since, so the re-attach must not leave it on screen.
    expect(historyDoor()).toBeNull();
    expect(h.dispose).toHaveBeenCalled();

    // The guard is installed per attach. If it ever moves outside the attach
    // effect, the SECOND terminal is the one that goes back to emitting arrows
    // — and that is the shape nobody would notice by hand.
    const next = FakeSocket.instances.at(-1);
    if (!next) throw new Error('Reconnect opened no socket');
    act(() => next.onopen?.());
    next.sent.length = 0;
    let handled: boolean | undefined;
    act(() => {
      handled = t.wheel(-120);
    });
    expect(handled, 'the re-attached terminal handed its wheel to xterm').toBe(false);
    expect(next.sent, 'the re-attached terminal put the wheel on the pane').toEqual([]);
  });
});

describe('a read that fails says WHICH failure', () => {
  /** Open the history against a failing read; give back the word the drawer
   *  showed the reader, and unmount so the next arm starts clean. */
  const whyAfterFailedRead = async (fetchImpl: unknown): Promise<string> => {
    vi.stubGlobal('fetch', fetchImpl);
    const { t, h, ws, view } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    const bar = await screen.findByRole('status', { name: /history/i });
    const said = bar.textContent ?? '';
    expect(h.write, 'a failed read rendered a history anyway').not.toHaveBeenCalled();
    expect(ws.sent, 'a failed read fell back to driving the pane').toEqual([]);
    view.unmount();
    return said;
  };

  it('a dead pane, an unanswerable tmux and an unreachable box stay THREE answers', async () => {
    // The server already tells the first two apart — `CaptureHistory` is three
    // conditions and the route spends them as 404 `gone` and 502 `unmeasured`.
    // An adapter may not narrow a distinction it received, and this drawer is
    // the adapter: collapsing them to one "failed" would tell the reader a
    // session had died whenever the tmux server was merely busy.
    const gone = await whyAfterFailedRead(jsonFetch(404, { ok: false, error: 'gone' }));
    const unmeasured = await whyAfterFailedRead(
      jsonFetch(502, {
        ok: false,
        error: 'unmeasured',
        detail: 'error connecting to /tmp/tmux-1000/default (No such file or directory)',
      }),
    );
    // The third never reaches the route at all — the fetch itself rejects, so
    // there is no server word to carry and the drawer supplies its own.
    const unreachable = await whyAfterFailedRead(
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );

    expect(gone).toContain('gone');
    expect(unmeasured).toContain('unmeasured');
    expect(unreachable).toContain('unreachable');
    expect(
      new Set([gone, unmeasured, unreachable]).size,
      'the drawer narrowed three conditions into fewer words',
    ).toBe(3);
  });

  it('a failed read leaves the wheel able to try again', async () => {
    // `empty` is not `live`, so the idempotence guard would refuse a retry if
    // the only way out were the wheel. The way back is the key bar's own
    // toggle, which reads `live` in every state that is not live — measured
    // here so the reader is never stranded on a failure they cannot clear.
    vi.stubGlobal('fetch', jsonFetch(404, { ok: false, error: 'gone' }));
    const { t } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    await screen.findByText(/no history/i);

    fireEvent.click(screen.getByRole('button', { name: 'Back to live' }));
    await waitFor(() => expect(screen.queryByText(/no history/i)).toBeNull());
  });
});

// — the door a thumb can reach —
//
// MEASURED against the real Terminal in jsdom: a touch drag over xterm 6.0.0
// emits NOTHING to the pty in either buffer, and xterm exposes no touch
// equivalent of `attachCustomWheelEventHandler`. So there is no touch->arrow
// translation to stop, and equally no touch gesture that opens anything: the
// wheel is the only pointer door and a phone has no wheel. This key IS the
// door touch has, and the two things that can silently take it away are its
// place in the DOM and one CSS declaration.
describe('the console history has a door a thumb can reach', () => {
  it('the scroll-back key is NOT inside the strip that scrolls away', () => {
    // ARITHMETIC, not taste. `.term-keys-seq` is `overflow-x: auto` and its
    // eight caps measure 8x44 + 7x8 = 408px before a legend is laid out; add
    // this bar's 2x12 padding and a ninth cap starts at x=428. A 390px phone
    // — `.sheet-panel--full` zeroes the drawer's side padding, so that is the
    // whole width — never shows it. Put this button back in the scroller and
    // the only affordance touch has is off-screen at rest.
    render(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} />);
    const door = screen.getByRole('button', { name: 'Scroll back' });
    expect(door.closest('.term-keys-seq'), 'the history door scrolls off the edge with the keys').toBeNull();
    expect(door.closest('.term-keys'), 'the history door left the key bar entirely').not.toBeNull();
    // …and every sequence cap DID stay in the scroller, so this is a split and
    // not a bar that stopped scrolling.
    const esc = screen.getByRole('button', { name: 'Escape' });
    expect(esc.closest('.term-keys-seq')).not.toBeNull();
  });

  it('it is an action, not a key — its legend promises no sequence', () => {
    // Every other legend in this bar IS the key it transmits. A `⇞` glyph
    // would promise a PageUp that this button never sends — and PageUp would
    // reach the Claude Code TUI, which is the prompt paging the operator's
    // ruling puts on the arrows.
    render(<TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} />);
    const door = screen.getByRole('button', { name: 'Scroll back' });
    expect(door.textContent).toBe('hist');
    expect(door.className).toContain('keycap--act');
  });
});

// — one door, both ways —
//
// The operator's own words, testing the first cut: "вмикати історію однією
// кнопкою, а вимикати іншою, не зручно". The badge over the history carried a
// line count nobody asked for and a second exit beside it; the key bar's door
// opened but never closed. One toggle now does both, and says which way it is
// facing — a button that changes what it does without changing how it looks is
// the failure this block exists to refuse.
describe('the history door is a toggle', () => {
  it('names the way out, says it is pressed, and takes it', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h, ws } = mountDrawer();

    const door = screen.getByRole('button', { name: 'Scroll back' });
    expect(door.textContent, 'the door did not offer the history').toBe('hist');
    expect(door.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    // The SAME element — a second button would be the inconvenience this
    // replaces, so identity is part of the claim.
    const back = screen.getByRole('button', { name: 'Back to live' });
    expect(back, 'the door was replaced rather than toggled').toBe(door);
    expect(back.textContent, 'the legend still promised the way in').toBe('live');
    expect(back.getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(back);

    await waitFor(() => expect(historyDoor()).toBeNull());
    expect(h.dispose).toHaveBeenCalled();
    expect(door.textContent).toBe('hist');
    expect(door.getAttribute('aria-pressed')).toBe('false');
    // Still not a key: the way out sends nothing to the pane either.
    expect(ws.sent, 'the toggle put a control sequence on the socket').toEqual([]);
  });

  it('the badge over a history that is up is gone, and the two states that need words keep them', async () => {
    // A line count is not news to someone looking at the lines. A read still in
    // flight, and a pane with no history to give, are.
    let settle: ((r: Response) => void) | null = null;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((r) => { settle = r; })));
    const { t, h } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });

    expect(await screen.findByText(/reading history/i), 'a read in flight said nothing').toBeTruthy();

    act(() => {
      settle?.(new Response(JSON.stringify(OK_HISTORY), {
        status: 200, headers: { 'content-type': 'application/json' },
      }));
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    expect(screen.queryByText(/lines/i), 'the line count came back').toBeNull();
    expect(screen.queryByText(/reading history/i)).toBeNull();
    expect(historyDoor(), 'the history is up, so its door must say so').toBeTruthy();
  });
});

// — one notch up, one notch back —
//
// Also measured by the operator: "один скрол вверх і вниз вже не повертає, два
// рази вверх і два рази вниз - повертає". Two mechanisms had to be wrong at
// once for that, and both are ordering.
describe('the opening scroll', () => {
  it('arms the bottom latch BEFORE the departure it latches', async () => {
    // `onBottom` only fires for a reader who has been away from the newest
    // line, and the opening scroll is that departure. Registered after it, the
    // latch never saw it — so the first scroll DOWN read as an arrival nobody
    // had left, and the way back cost two notches instead of one.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.scrolled.length).toBe(1));

    expect(h.order, 'the latch was armed after the scroll it exists to catch')
      .toEqual(['onBottom', 'write', 'scroll']);
    expect(h.scrolled, 'the history opened by more than the notch that asked for it')
      .toEqual([-3]);
  });

  it('waits for the PARSE, not the call — a scroll against an empty buffer moves nothing', async () => {
    // xterm writes asynchronously. Issued beside the write, the opening scroll
    // ran against the buffer as it stood BEFORE the history landed: it moved
    // nothing, so the reader was left at the bottom with the latch unarmed —
    // the same two-notch symptom by a second road.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h } = mountDrawer({ defer: true });
    act(() => {
      t.wheel(-120);
    });
    await waitFor(() => expect(h.write).toHaveBeenCalled());

    expect(h.scrolled, 'the history scrolled before it had been parsed').toEqual([]);

    act(() => {
      h.flushParse();
    });
    expect(h.scrolled).toEqual([-3]);
  });
});

// — a pane with nothing above its screen —
//
// `capture-pane` answers with the VISIBLE SCREEN whether or not a line has
// ever scrolled off, so a 200 is not by itself a history. Opening one anyway
// put a second copy of the live view on the glass with an empty scrollbar on
// it — the operator's own report: "зʼявляється пустий скролбар справа, але
// історія нікуди не рухається". Measured on the live fleet the same hour: four
// of ten panes held no scrollback at all. The COUNT is what decides here — a
// pane keeps its scrollback across the switch to the alternate screen
// (measured, 453 lines still captured at `alternate_on=1`), so the flag only
// picks the WORDS for a zero, never causes one.
describe('a pane with no scrollback says so', () => {
  it('a MEASURED zero opens no history and names the reason', async () => {
    vi.stubGlobal('fetch', jsonFetch(200, { ...OK_HISTORY, scrollback: 0, alternate: false }));
    const { t, h } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });

    expect(await screen.findByText(/nothing has scrolled off this pane yet/i)).toBeTruthy();
    expect(h.write, 'a dead history terminal was built and written to').not.toHaveBeenCalled();
    expect(h.madeWith, 'a history terminal was built over an empty capture').toEqual([]);
    // The door still offers the way back — `empty` is not `live`.
    expect(historyDoor()).toBeTruthy();
  });

  it('the alternate screen is named as itself, not as an empty history', async () => {
    // A full-screen TUI holds the pane. It did not eat the history — tmux keeps
    // what was already there — but nothing scrolls off while it is up, so a
    // zero here means something different from a zero on a normal screen:
    // "not yet" versus "not while this is up".
    vi.stubGlobal('fetch', jsonFetch(200, { ...OK_HISTORY, scrollback: 0, alternate: true }));
    const { t } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });

    expect(await screen.findByText(/full-screen app/i)).toBeTruthy();
    expect(screen.queryByText(/nothing has scrolled off this pane yet/i)).toBeNull();
  });

  it('an ABSENT measurement still opens the history — absence is not zero', async () => {
    // The guard on the guard. An older server omits both fields, and a pane
    // tmux could not measure sends nothing; either way the drawer must behave
    // exactly as it did before the fields existed, or one unreachable probe
    // would tell every reader their session has no history.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t, h } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });

    await waitFor(() => expect(h.write).toHaveBeenCalled());
    expect(screen.queryByText(/no history/i)).toBeNull();
    expect(historyDoor()).toBeTruthy();
  });

  it('a refused history is not a mode the reader is in', async () => {
    // THE OPERATOR'S OWN RULE for this cap: it must be visible when it is
    // engaged. `aria-pressed` is what carries that — to AT and, through the
    // attribute selector, to the inverted fill. `empty` engages NOTHING: the
    // read came back and the drawer declined to put a layer up, so the reader
    // is looking at the live pane with a notice over it. A pressed cap there
    // says they are somewhere they are not, and it is the state a swap drops
    // every reader into — measured on this fleet, a re-created pane answers a
    // scrollback of zero.
    //
    // The LEGEND still reads `live`, because the cap's other job in this state
    // is to dismiss the notice. Engaged and useful are different claims.
    vi.stubGlobal('fetch', jsonFetch(200, { ...OK_HISTORY, scrollback: 0, alternate: false }));
    const { t } = mountDrawer();
    act(() => {
      t.wheel(-120);
    });

    const cap = await screen.findByRole('button', { name: 'Back to live' });
    expect(cap.getAttribute('aria-pressed'), 'the cap claims a history that never opened').toBe('false');
    expect(cap.textContent, 'the way out of the notice lost its legend').toBe('live');
  });
});

// — the sheet is dragged by its handle, not by the console —
//
// The operator, on a phone: "неможливо там скролити, бо свайп по робочій
// області згортає консоль". Until the wheel read a history there was nothing
// under the finger to scroll, so the panel could own every downward drag; now
// the glass owns the gesture and the panel may only have the grabber. vaul
// spells that `handleOnly`, and the grabber has to be its own `Drawer.Handle`
// for the hit area to exist.
//
// THE GESTURE ITSELF IS NOT MEASURABLE HERE, and saying so is part of the
// guard: vaul's drag needs real layout, so a simulated pointer drag across the
// glass passes in jsdom whether or not the panel owns it — a test that cannot
// go red measures nothing. What CAN go red is the handle: without
// `Drawer.Handle` the grabber is a decorative div, `handleOnly` has nothing to
// grant the drag to, and the panel is undismissable by touch. Measured: red
// before this change, green after.
describe('the console keeps its own drag', () => {
  it('the drawer offers a real handle to drag by', () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { view } = mountDrawer();
    const handle = view.baseElement.querySelector('[data-vaul-handle]');
    expect(handle, 'the grabber is decoration, not a drag target').toBeTruthy();
  });
});

// — the finger scrolls the history —
//
// xterm 6.0.0 has NO native scroller to pan. `.xterm-viewport` survives with
// `overflow-y: scroll` on it but is an EMPTY leftover (measured: zero children,
// empty innerHTML); the real scroll is a virtual VS Code `Scrollable` that
// re-renders rows, and its only input is a `wheel` listener. A finger has
// nothing to drag. Measured on a real Terminal over a 500-line normal buffer: a
// touchstart/touchmove/touchend across `.xterm-screen` left `viewportY` at 477
// and put nothing on the pty — and the pointer-event twin did the same. On top
// of that vaul computes `touch-action: none` on the panel, so even a real
// scroller would not have been panned here.
//
// So the drag is ours to implement, and these pin it.
const histHost = (view: ReturnType<typeof mountDrawer>['view']): HTMLElement => {
  const el = view.baseElement.querySelector('.term-history > .term-host');
  if (!el) throw new Error('the history layer rendered no host');
  return el as HTMLElement;
};

/** One drag, in pointer events, at ROW_PX pixels to the row. */
const drag = (el: HTMLElement, from: number, to: number, id = 1): void => {
  fireEvent.pointerDown(el, { pointerId: id, clientY: from, isPrimary: true, button: 0 });
  fireEvent.pointerMove(el, { pointerId: id, clientY: to, isPrimary: true });
  fireEvent.pointerUp(el, { pointerId: id, clientY: to, isPrimary: true });
};

describe('the finger scrolls the history', () => {
  const open = async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const m = mountDrawer();
    act(() => {
      m.t.wheel(-120);
    });
    await waitFor(() => expect(m.h.write).toHaveBeenCalled());
    return m;
  };

  it('a drag DOWN the glass pulls the history down — older lines, one row per row-height', async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;

    // ROW_PX is what the stub reports for one row. Dragging down by three of
    // them asks for three rows of older output: the content follows the finger,
    // which is the only direction a console can mean.
    drag(histHost(view), 100, 100 + 3 * ROW_PX);

    expect(h.scrolled, 'the drag moved the history the wrong way, or not at all').toEqual([-3]);
  });

  it('a drag UP returns toward the newest line', async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;

    drag(histHost(view), 300, 300 - 2 * ROW_PX);

    expect(h.scrolled).toEqual([2]);
  });

  it('a tap scrolls nothing, and neither does a drag shorter than one row', async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;

    drag(histHost(view), 200, 200);                       // a tap
    drag(histHost(view), 200, 200 + Math.floor(ROW_PX / 2)); // half a row

    expect(h.scrolled, 'the glass moved under a finger that did not').toEqual([]);
  });

  it('the remainder is kept, so a slow drag is not swallowed a half-row at a time', async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;
    const el = histHost(view);

    // Three moves of two thirds of a row each: no single step is a whole row,
    // but the drag has covered two. A handler that truncated per move would
    // report nothing at all.
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 0, isPrimary: true, button: 0 });
    for (const y of [ROW_PX * (2 / 3), ROW_PX * (4 / 3), ROW_PX * 2]) {
      fireEvent.pointerMove(el, { pointerId: 1, clientY: y, isPrimary: true });
    }
    fireEvent.pointerUp(el, { pointerId: 1, clientY: ROW_PX * 2, isPrimary: true });

    expect(h.scrolled.reduce((a, b) => a + b, 0), 'the drag lost its remainder').toBe(-2);
  });


  it('a TOUCH drag scrolls even when the pointer stream is taken away', async () => {
    // WHY A SECOND PATH AT ALL. Two vaul sheets can be open over one session —
    // the ask picker and this drawer are siblings in SessionScreen — and each
    // open one installs a document-level capturing `touchmove` with
    // preventDefault on iOS. Preventing a touch there cancels the POINTER
    // stream, so a drag driven by pointer events alone dies as soon as another
    // sheet is up. Touch listeners still run: preventDefault stops the default
    // action, not the other listeners.
    const { h, view } = await open();
    h.scrolled.length = 0;
    const el = histHost(view);

    // `changedTouches` is not decoration. react-remove-scroll — which vaul
    // mounts under every open sheet through Radix's Dialog — reads it in a
    // document-level capturing listener, so a synthetic touch without it
    // throws inside the library instead of exercising the lock these cases
    // exist to survive.
    const point = (y: number) => [{ clientY: y, clientX: 0, identifier: 1 }];
    const touch = (y: number) => ({ touches: point(y), changedTouches: point(y) });
    fireEvent.touchStart(el, touch(0));
    fireEvent.touchMove(el, touch(3 * ROW_PX));
    fireEvent.touchEnd(el, { changedTouches: [{ clientY: 3 * ROW_PX, clientX: 0, identifier: 1 }] });

    expect(h.scrolled, 'a finger moved nothing').toEqual([-3]);
  });

  it('a cancelled pointer stream does not kill the finger that is still dragging', async () => {
    // THE FAILURE THE TOUCH PATH EXISTS FOR, made explicit. Another open sheet
    // preventDefaults the touch at document level on iOS, and the browser
    // answers by CANCELLING the pointer stream mid-gesture. The finger has not
    // lifted; if `pointercancel` ends the drag, the console simply stops
    // responding — which is how the operator met it, with the ask picker up.
    const { h, view } = await open();
    h.scrolled.length = 0;
    const el = histHost(view);

    const at = (y: number) => ({ touches: [{ clientY: y, clientX: 0, identifier: 1 }],
                                 changedTouches: [{ clientY: y, clientX: 0, identifier: 1 }] });
    fireEvent.touchStart(el, at(0));
    fireEvent.touchMove(el, at(2 * ROW_PX));
    fireEvent.pointerCancel(el, { pointerId: 1, clientY: 2 * ROW_PX, pointerType: 'touch' });
    fireEvent.touchMove(el, at(4 * ROW_PX));
    fireEvent.touchEnd(el, at(4 * ROW_PX));

    expect(h.scrolled.reduce((a, b) => a + b, 0), 'the cancel killed a live finger').toBe(-4);
  });

  it('a MOUSE drag selects text — it does not scroll the view', async () => {
    // THE COST OF NOT DOING THIS is the one way to copy a line out of the
    // console. xterm starts a selection on `mousedown` and follows it with a
    // document-level `mousemove`; this drag captures the pointer and
    // `preventDefault()`s every move, which suppresses precisely those
    // compatibility events. The mouse loses nothing by standing down: the
    // history terminal is in the normal buffer with no custom wheel handler,
    // so xterm's own wheel scrolls it.
    const { h, view } = await open();
    h.scrolled.length = 0;
    const el = histHost(view);

    fireEvent.pointerDown(el, { pointerId: 1, clientY: 0, isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { pointerId: 1, clientY: 4 * ROW_PX, isPrimary: true, pointerType: 'mouse' });
    fireEvent.pointerUp(el, { pointerId: 1, clientY: 4 * ROW_PX, isPrimary: true, pointerType: 'mouse' });

    expect(h.scrolled, 'a mouse drag scrolled the history instead of selecting it').toEqual([]);
  });

  it("a press xterm's own scrollbar has already taken is left alone", async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;

    // MEASURED, and the reason this guard exists: xterm binds `pointerdown` on
    // its slider (`abstractScrollbar.ts:111`) and takes `setPointerCapture`
    // through `GlobalPointerMoveMonitor`, but calls only `preventDefault()` —
    // never `stopPropagation()`. So the press reaches this host too, and a
    // handler that captured the pointer here would steal the capture xterm took
    // an instant earlier and break dragging the scrollbar. `defaultPrevented`
    // is the signal, and it does not depend on a class name.
    document.addEventListener('pointerdown', (e) => e.preventDefault(), { capture: true, once: true });
    drag(histHost(view), 100, 100 + 5 * ROW_PX);

    expect(h.scrolled, "the drawer fought xterm's own scrollbar for the pointer").toEqual([]);
  });

  it('a second finger abandons the drag rather than scrolling with it', async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;
    const el = histHost(view);

    // THE SECOND FINGER IS THE ONE THAT MOVES, and that is the whole test.
    // Without the guard a second `pointerdown` simply re-aims the drag at the
    // new pointer, so moving the FIRST finger proves nothing — it is ignored
    // either way. Moving the second separates them: unguarded it scrolls by
    // four rows, guarded the gesture has been abandoned and nothing moves.
    fireEvent.pointerDown(el, { pointerId: 1, clientY: 0, isPrimary: true, button: 0 });
    fireEvent.pointerDown(el, { pointerId: 2, clientY: 0, isPrimary: false, button: 0 });
    fireEvent.pointerMove(el, { pointerId: 2, clientY: 4 * ROW_PX, isPrimary: false });
    fireEvent.pointerUp(el, { pointerId: 2, clientY: 4 * ROW_PX, isPrimary: false });
    fireEvent.pointerUp(el, { pointerId: 1, clientY: 0, isPrimary: true });

    expect(h.scrolled, 'a pinch scrolled the history').toEqual([]);
  });
});

// — the door a finger can open —
//
// A phone has no wheel, so on the LIVE glass the only way into the history was
// the key bar. The operator's report: "на свайпи по тексту пальцями не реагує
// зовсім". It cannot scroll there — tmux attaches the client on the alternate
// screen, where xterm keeps no scrollback at all — but the gesture still has an
// obvious meaning, and it is the same one the wheel has: reach for what is
// above the screen.
// — the throw —
//
// Every list on the device keeps moving when the finger leaves and slows to a
// stop; a view that halts dead does not read as scrolling at all, which is
// what the operator met: it worked only while the finger was down. The history
// cannot borrow the platform's deceleration — it is not a native scroller,
// xterm's viewport is an empty leftover and the scroll is a virtual re-render
// — so the curve is the drawer's own, and these cases hold its shape.
describe('the history keeps moving after the finger leaves', () => {
  const open = async () => {
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const m = mountDrawer();
    act(() => {
      m.t.wheel(-120);
    });
    await waitFor(() => expect(m.h.write).toHaveBeenCalled());
    return m;
  };

  /** A clock and a frame pump the test drives by hand, so a throw is measured
   *  in frames rather than waited out in real time. `performance.now` is what
   *  the drag reads for its speed, so the two have to be the same clock. */
  const rig = () => {
    let t = 1000;
    const queue: ((now: number) => void)[] = [];
    vi.spyOn(performance, 'now').mockImplementation(() => t);
    vi.stubGlobal('requestAnimationFrame', (cb: (now: number) => void) => {
      queue.push(cb);
      return queue.length;
    });
    vi.stubGlobal('cancelAnimationFrame', () => { queue.length = 0; });
    return {
      wait: (ms: number) => { t += ms; },
      pending: () => queue.length,
      /** Run up to `n` frames of `dt` each; stops early if the throw ended. */
      frames: (n: number, dt = 1000 / 60) => {
        for (let i = 0; i < n; i += 1) {
          const cb = queue.shift();
          if (cb === undefined) return i;
          t += dt;
          act(() => cb(t));
        }
        return n;
      },
    };
  };

  const at = (y: number) => ({ touches: [{ clientX: 0, clientY: y, identifier: 1 }],
                               changedTouches: [{ clientX: 0, clientY: y, identifier: 1 }] });

  /** One finger, moved through `ys` with `dt` between each, then lifted. */
  const flick = (el: HTMLElement, r: ReturnType<typeof rig>, ys: number[], dt: number): void => {
    fireEvent.touchStart(el, at(ys[0]!));
    for (const y of ys.slice(1)) { r.wait(dt); fireEvent.touchMove(el, at(y)); }
    fireEvent.touchEnd(el, at(ys[ys.length - 1]!));
  };

  const total = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

  it('a flick keeps reaching for older output after the finger has gone', async () => {
    const { h, view } = await open();
    const r = rig();
    h.scrolled.length = 0;

    // Two rows every 8 ms is a throw, not a placement: about 4.5 px/ms.
    flick(histHost(view), r, [0, 2 * ROW_PX, 4 * ROW_PX], 8);
    const byHand = total(h.scrolled);
    expect(byHand, 'the drag itself moved nothing').toBeLessThan(0);

    expect(r.pending(), 'the finger left and nothing was thrown').toBeGreaterThan(0);
    r.frames(20);

    expect(total(h.scrolled), 'the history stopped dead with the finger')
      .toBeLessThan(byHand);
  });

  it('the throw slows to a stop on its own rather than running forever', async () => {
    const { view } = await open();
    const r = rig();

    flick(histHost(view), r, [0, 2 * ROW_PX, 4 * ROW_PX], 8);
    // Far more frames than the curve can need; `frames` returns early when the
    // throw has stopped asking for another.
    const ran = r.frames(600);

    // BOTH ENDS, because either alone is vacuous: a drawer that throws nothing
    // also "stops", and one that never stops would have been caught only by
    // the ceiling. A flick this fast is worth tens of frames before it decays
    // below the threshold.
    expect(ran, 'nothing was thrown at all').toBeGreaterThan(10);
    expect(ran, 'the throw never ended').toBeLessThan(600);
    expect(r.pending()).toBe(0);
  });

  it('a placement is not a throw — a slow drag ends where the finger did', async () => {
    const { h, view } = await open();
    const r = rig();
    h.scrolled.length = 0;

    // The same three rows, taken 150 ms at a time: 0.06 px/ms, well under the
    // flick threshold. This is a reader positioning the view.
    flick(histHost(view), r, [0, 1.5 * ROW_PX, 3 * ROW_PX], 150);
    const byHand = total(h.scrolled);

    expect(r.pending(), 'a slow drag was thrown').toBe(0);
    r.frames(20);
    expect(total(h.scrolled)).toBe(byHand);
  });

  it('a finger that rested before lifting is placing the view, not throwing it', async () => {
    const { view } = await open();
    const r = rig();

    // Fast, fast, then a pause longer than the idle window and one small move
    // — a reader who flicked, changed their mind, and set the view down.
    // Averaging the samples would have carried the flick's speed into the lift.
    const el = histHost(view);
    fireEvent.touchStart(el, at(0));
    r.wait(8); fireEvent.touchMove(el, at(2 * ROW_PX));
    r.wait(8); fireEvent.touchMove(el, at(4 * ROW_PX));
    r.wait(300); fireEvent.touchMove(el, at(4 * ROW_PX + 2));
    fireEvent.touchEnd(el, at(4 * ROW_PX + 2));

    expect(r.pending(), 'the view was thrown by a finger that had stopped').toBe(0);
  });

  // — the reason the tail looked wrong —
  //
  // A terminal scrolls in whole rows. At speed that is invisible; at the end
  // of a throw it is the whole problem, because the time between row steps is
  // the row height over the speed, so as the glide decays the steps spread out
  // and the last one is the longest of all: "останній крок найсильніше, що не
  // приємно виглядає". Tuning the curve cannot fix that — it is the quantum,
  // not the speed. Rendering the remainder can, and these two cases are what
  // say it is rendered.
  it('a drag shorter than one row still moves the view, by the fraction it covered', async () => {
    const { h, view } = await open();
    h.scrolled.length = 0;
    h.offsets.length = 0;
    const el = histHost(view);
    const third = ROW_PX / 3;

    fireEvent.touchStart(el, at(0));
    fireEvent.touchMove(el, at(third));
    fireEvent.touchMove(el, at(2 * third));
    fireEvent.touchEnd(el, at(2 * third));

    expect(h.scrolled, 'two thirds of a row dropped a whole row').toEqual([]);
    expect(h.offsets.map((px) => Math.round(px)), 'the view did not follow the finger between rows')
      .toEqual([Math.round(third), Math.round(2 * third)]);
  });

  it('a throw moves the view on every frame, not only on the frames that drop a row', async () => {
    const { h, view } = await open();
    const r = rig();
    h.scrolled.length = 0;
    h.offsets.length = 0;

    flick(histHost(view), r, [0, 2 * ROW_PX, 4 * ROW_PX], 8);
    const afterDrag = h.offsets.length;
    const ran = r.frames(40);

    expect(ran, 'the throw was over before the tail').toBeGreaterThan(10);
    expect(h.offsets.length - afterDrag, 'a frame of the throw rendered nothing at all').toBe(ran);
    expect(h.scrolled.length, 'every frame dropped a whole row — there is no tail here to smooth')
      .toBeLessThan(ran);
  });

  it('a touch during the throw stops it where it is', async () => {
    const { h, view } = await open();
    const r = rig();
    h.scrolled.length = 0;
    const el = histHost(view);

    flick(el, r, [0, 2 * ROW_PX, 4 * ROW_PX], 8);
    r.frames(3);
    const caught = total(h.scrolled);

    // The catch: a finger down, and nothing else. Every scroller on the device
    // does this, and it is the only way to stop a line going past.
    fireEvent.touchStart(el, at(500));

    expect(r.pending(), 'the throw survived the catch').toBe(0);
    r.frames(20);
    expect(total(h.scrolled), 'the history kept moving under a held finger').toBe(caught);
  });
});

// — what the rows and the pixels agree on —
//
// The two halves of the motion do not land together: a transform is on the
// glass at the next paint, while `scrollLines` updates xterm's buffer and then
// schedules its repaint with xterm's own rAF, which from inside a frame
// callback means the frame AFTER this one. Unmanaged, the transform snaps back
// by a row at every boundary while the rows it stood in for are still coming —
// invisible at speed, and the whole of the motion as a throw decelerates,
// which is where the operator saw the rows shake.
//
// jsdom cannot see a pixel, so what is tested is the invariant the fix rests
// on rather than the picture: what is on the glass — the rows that have
// painted, plus the transform — is always exactly the displacement that was
// asked for.
describe('the rows and the transform stay one motion', () => {
  const ROW = 18;

  it('the transform stands in for a row until it lands, then steps back by exactly it', () => {
    const lag = paintLag();

    lag.scrolled(-1, ROW);   // scrollLines(-1): one row of content, downward
    lag.sub(3);          // and three pixels over
    expect(lag.transform(), 'the unpainted row was not carried').toBe(ROW + 3);

    lag.painted();
    expect(lag.transform(), 'the transform did not hand the row back').toBe(3);
  });

  it('holds "painted + transform === asked for" through a decelerating throw', () => {
    // The drawer's own arithmetic, run here against a paint that lands late,
    // on time, and twice in a row — the three schedules a real frame gives.
    const lag = paintLag();
    let carry = 0;
    let issued = 0;   // displacement handed to scrollLines, painted or not
    let painted = 0;  // displacement actually on the glass
    let asked = 0;

    const step = (travel: number): void => {
      asked += travel;
      const t = carry + travel;
      const rows = Math.trunc(t / ROW);
      carry = t - rows * ROW;
      if (rows !== 0) { issued += rows * ROW; lag.scrolled(-rows, ROW); }
      lag.sub(carry);
    };
    const paint = (): void => { painted = issued; lag.painted(); };
    const check = (where: string): void => {
      expect(painted + lag.transform(), `the glass disagreed with the drag ${where}`)
        .toBeCloseTo(asked, 6);
    };

    let v = 4.5;                       // px/ms, a firm flick
    for (let frame = 0; frame < 60; frame += 1) {
      step(v * (1000 / 60));
      check(`on frame ${frame}`);
      // A paint lands on most frames, skips some, and doubles up on others.
      if (frame % 3 !== 0) { paint(); check(`after the paint on frame ${frame}`); }
      if (frame % 7 === 0) { paint(); check(`after the second paint on frame ${frame}`); }
      v *= 0.95;
    }
    // And the whole throw actually crossed many rows, or the loop proved
    // nothing about boundaries.
    expect(Math.abs(issued) / ROW, 'the simulated throw never crossed a row').toBeGreaterThan(20);
  });

  it('is symmetric — a throw the other way carries its rows the same', () => {
    const lag = paintLag();
    lag.scrolled(1, ROW);
    lag.sub(-4);
    expect(lag.transform()).toBe(-ROW - 4);
    lag.painted();
    expect(lag.transform()).toBe(-4);
  });
});

describe('a finger opens the history from the live glass', () => {
  const liveGlass = (view: ReturnType<typeof mountDrawer>['view']): HTMLElement => {
    const el = view.baseElement.querySelector('.term-screen > .term-host');
    if (!el) throw new Error('the drawer rendered no terminal host');
    return el as HTMLElement;
  };

  const swipe = (el: HTMLElement, dx: number, dy: number): void => {
    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0 });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy, isPrimary: true });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 100 + dx, clientY: 100 + dy, isPrimary: true });
  };

  it('a deliberate drag DOWN reads the pane history, exactly as a wheel-up does', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { h, view } = mountDrawer();

    swipe(liveGlass(view), 0, 3 * ROW_PX);

    await waitFor(() => expect(h.write, 'the swipe opened no history').toHaveBeenCalled());
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/pane/history');
  });

  it('a tap and a short wobble are not a gesture', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();

    swipe(liveGlass(view), 0, 0);
    swipe(liveGlass(view), 0, 6);

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl, 'a tap on the glass read the pane').not.toHaveBeenCalled();
  });

  const touchSwipe = (el: HTMLElement, dx: number, dy: number): void => {
    const at = (x: number, y: number) => ({ touches: [{ clientX: x, clientY: y, identifier: 1 }],
                                            changedTouches: [{ clientX: x, clientY: y, identifier: 1 }] });
    fireEvent.touchStart(el, at(100, 100));
    fireEvent.touchMove(el, at(100 + dx, 100 + dy));
    fireEvent.touchEnd(el, { changedTouches: [{ clientX: 100 + dx, clientY: 100 + dy, identifier: 1 }] });
  };

  // — the path that had to exist, and did not —
  //
  // vaul installs `preventScrollMobileSafari` for as long as a drawer is open:
  // document, capture phase, `passive: false`, and it calls `preventDefault()`
  // on touchmove whenever the touch's scroll parent is the document — which on
  // this glass is every touch, since `.term-host` and every xterm element
  // inside it are `overflow: hidden`. Safari answers a prevented touchmove by
  // tearing down the pointer stream for that gesture, so `pointermove` never
  // arrives. The gesture above is therefore unreachable on an iPhone, which is
  // where it was reported from and where it was never once seen to work.
  it('a TOUCH drag DOWN opens the history with no pointer event in sight', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { h, view } = mountDrawer();

    touchSwipe(liveGlass(view), 0, 3 * ROW_PX);

    await waitFor(() => expect(h.write, 'the finger opened no history').toHaveBeenCalled());
    expect(String(fetchImpl.mock.calls[0]?.[0])).toContain('/pane/history');
  });

  it('a finger that taps, wobbles or swipes sideways still opens nothing', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();

    touchSwipe(liveGlass(view), 0, 0);
    touchSwipe(liveGlass(view), 0, 6);
    touchSwipe(liveGlass(view), 120, 30);
    touchSwipe(liveGlass(view), 0, -4 * ROW_PX);

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl, 'a finger that was not reaching for the history read the pane').not.toHaveBeenCalled();
  });

  it('is not lost to a descendant that stops the event — the listener sits above it', async () => {
    // The clipboard fix was lost for a day to exactly this: a handler bound on
    // the bubble phase, and xterm calling `stopPropagation()` one level below
    // the host. Nothing in xterm 6.0.0 listens for touch today, so this is
    // insurance — but it is the cheap kind, and the phase is what buys it.
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { h, view } = mountDrawer();
    const child = document.createElement('div');
    liveGlass(view).appendChild(child);
    for (const type of ['touchstart', 'touchmove', 'touchend']) {
      child.addEventListener(type, (e) => e.stopPropagation());
    }

    touchSwipe(child, 0, 3 * ROW_PX);

    await waitFor(() => expect(h.write, 'a child took the gesture away').toHaveBeenCalled());
  });

  it('a sideways swipe is left alone, and so is a drag UP', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();

    // Sideways: the reader is not asking for what is above the screen. Up: on
    // the live glass there is nothing below it either — the newest line is
    // already on the screen.
    swipe(liveGlass(view), 120, 30);
    swipe(liveGlass(view), 0, -4 * ROW_PX);

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('a MOUSE drag selects text on the live glass — it does not open the history', async () => {
    // The history layer already stands the mouse down for exactly this reason
    // (`a MOUSE drag selects text — it does not scroll the view`); the live
    // glass never learned it. A reader dragging across the live pane to copy a
    // line got a history layer over their selection instead, and the selection
    // with it. The mouse loses nothing: its gesture is the wheel, which opens
    // the history already.
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();
    const el = liveGlass(view);

    fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0, pointerType: 'mouse' });
    fireEvent.pointerMove(el, { pointerId: 1, clientX: 100, clientY: 100 + 4 * OPEN_PX, isPrimary: true, pointerType: 'mouse' });
    fireEvent.pointerUp(el, { pointerId: 1, clientX: 100, clientY: 100 + 4 * OPEN_PX, isPrimary: true, pointerType: 'mouse' });
    await act(async () => { await flush(); });

    expect(fetchImpl, 'a mouse selection opened the console history').not.toHaveBeenCalled();
  });

  it('a bare pointer drag still opens it — the guard names the mouse, not the pointer', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { view } = mountDrawer();
    swipe(liveGlass(view), 0, 4 * OPEN_PX);
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });
});

describe('a pinch is not a reach for the history', () => {
  it('a ctrl+wheel-up opens nothing and still keeps the pty clean', async () => {
    // A trackpad pinch is delivered as `wheel` with `ctrlKey` set — the browser
    // has no separate event for it, which is why xterm's own
    // `attachCustomWheelEventHandler` documentation uses exactly this case as
    // its example. Reading only `deltaY < 0` turns a zoom-in into a history
    // read: a request to the box, a second terminal mounted, and the reader's
    // live pane covered by a layer they never asked for.
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { t, ws } = mountDrawer();

    act(() => {
      t.wheelWith({ deltaY: -120, ctrlKey: true });
    });
    await act(async () => { await flush(); });

    expect(fetchImpl, 'a pinch read the pane history').not.toHaveBeenCalled();
    expect(historyDoor()?.getAttribute('aria-pressed') ?? 'false',
      'a pinch put the history layer up').toBe('false');
    expect(ws.sent, 'a pinch reached the pty').toEqual([]);
  });

  it('the ordinary wheel still opens it — the guard is the modifier, not the wheel', async () => {
    const fetchImpl = jsonFetch(200, OK_HISTORY);
    vi.stubGlobal('fetch', fetchImpl);
    const { t } = mountDrawer();

    act(() => { t.wheel(-120); });
    await waitFor(() => expect(fetchImpl).toHaveBeenCalled());
  });

  it('xterm is still told not to process the pinch itself', async () => {
    // Returning `false` is xterm's own "do not process this", and it is the
    // only thing between the wheel and the pane in the alternate buffer. The
    // guard must SKIP THE READ, not hand the event back to xterm.
    vi.stubGlobal('fetch', jsonFetch(200, OK_HISTORY));
    const { t } = mountDrawer();
    expect(t.wheelWith({ deltaY: -120, ctrlKey: true }),
      'xterm was handed a pinch it will turn into arrow keys').toBe(false);
  });
});
