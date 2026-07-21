// Task 12 — TerminalDrawer: a full-height sheet holding an xterm bound to
// `/ws/pty/:id?cols=&rows=` — raw frames flow into term.write, typed data and
// the mobile quick-keys flow back as {type:'input'} frames, refits that change
// the grid send {type:'resize'}, a connection overlay narrates attach/loss,
// and closing the drawer closes the socket (the server then restores the
// session's canonical window size).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TerminalDrawer, type DrawerTerm } from '../src/session/TerminalDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  FakeSocket.instances.length = 0;
});

const ID = 'claude:OpenClawHetzner';

// — fakes —

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
  lastFrame(): unknown {
    const raw = this.sent.at(-1);
    return raw === undefined ? undefined : JSON.parse(raw);
  }
}
const makeSocket = (url: string): WebSocket => new FakeSocket(url) as unknown as WebSocket;

/** Scripted DrawerTerm — the measured grid is settable so fits are provable. */
const fakeTermFactory = (cols = 48, rows = 20) => {
  const write = vi.fn<(data: string) => void>();
  const dispose = vi.fn<() => void>();
  let grid = { cols, rows };
  let dataCb: ((data: string) => void) | null = null;
  const hosts: HTMLElement[] = [];
  const makeTerm = (host: HTMLElement): DrawerTerm => {
    hosts.push(host);
    return {
      write: (d) => write(d),
      onData: (cb) => {
        dataCb = cb;
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
  };
};

const renderDrawer = () => {
  const t = fakeTermFactory();
  const onClose = vi.fn();
  const view = render(
    <TerminalDrawer id={ID} open onClose={onClose} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
  );
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('drawer opened no socket');
  return { t, ws, onClose, view };
};

const opened = () => {
  const r = renderDrawer();
  act(() => r.ws.onopen?.());
  return r;
};

// — wiring —

describe('TerminalDrawer wiring', () => {
  it('opening measures the terminal and dials /ws/pty/:id with the fitted cols/rows', () => {
    const { ws, t } = renderDrawer();
    expect(t.hosts).toHaveLength(1); // xterm attached to the drawer host
    expect(ws.url).toContain(`/ws/pty/${encodeURIComponent(ID)}?cols=48&rows=20`);
  });

  it('incoming raw frames reach term.write', () => {
    const { ws, t } = opened();
    act(() => ws.onmessage?.({ data: 'phosphor$ ls\r\n' }));
    expect(t.write).toHaveBeenCalledWith('phosphor$ ls\r\n');
  });

  it('typed terminal data forwards as {type:"input"} frames', () => {
    const { ws, t } = opened();
    act(() => t.type('ls\r'));
    expect(ws.lastFrame()).toEqual({ type: 'input', data: 'ls\r' });
  });

  it('a refit that changes the grid sends {type:"resize"}', () => {
    const { ws, t } = opened();
    t.setGrid(60, 18);
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(ws.lastFrame()).toEqual({ type: 'resize', cols: 60, rows: 18 });
  });

  it('closing the drawer closes the socket and disposes the term', () => {
    const { ws, t, view, onClose } = opened();
    view.rerender(
      <TerminalDrawer
        id={ID}
        open={false}
        onClose={onClose}
        makeSocket={makeSocket}
        makeTerm={t.makeTerm}
      />,
    );
    expect(ws.closed).toBe(true);
    expect(t.dispose).toHaveBeenCalled();
  });
});

// — quick keys —

describe('TerminalDrawer quick keys', () => {
  it('the Esc keycap sends {type:"input",data:"\\x1b"}', () => {
    const { ws } = opened();
    fireEvent.click(screen.getByRole('button', { name: 'Escape' }));
    expect(ws.lastFrame()).toEqual({ type: 'input', data: '\x1b' });
  });

  it.each([
    ['Escape', '\x1b'],
    ['Arrow up', '\x1b[A'],
    ['Arrow down', '\x1b[B'],
    ['Arrow left', '\x1b[D'],
    ['Arrow right', '\x1b[C'],
    ['Tab', '\t'],
    ['Shift Tab', '\x1b[Z'],
    ['Enter', '\r'],
  ])('%s sends its control sequence', (label, seq) => {
    const { ws } = opened();
    fireEvent.click(screen.getByRole('button', { name: label }));
    expect(ws.lastFrame()).toEqual({ type: 'input', data: seq });
  });

  it('keys are inert before the socket opens — nothing is queued blind', () => {
    const { ws } = renderDrawer();
    fireEvent.click(screen.getByRole('button', { name: 'Enter' }));
    expect(ws.sent).toHaveLength(0);
  });
});

// — connection overlay —

describe('TerminalDrawer connection overlay', () => {
  it('narrates attaching, clears on open, reports loss with a Reconnect', () => {
    const { ws } = renderDrawer();
    expect(screen.getByText('attaching…')).toBeInTheDocument();

    act(() => ws.onopen?.());
    expect(screen.queryByText('attaching…')).not.toBeInTheDocument();

    act(() => ws.onclose?.());
    expect(screen.getByText('connection lost')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reconnect' })).toBeInTheDocument();
  });

  it('Reconnect dials a fresh socket with freshly measured cols/rows', () => {
    const { ws, t } = opened();
    act(() => ws.onclose?.());

    t.setGrid(100, 30);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));

    expect(FakeSocket.instances).toHaveLength(2);
    const next = FakeSocket.instances.at(-1);
    expect(next?.url).toContain(`/ws/pty/${encodeURIComponent(ID)}?cols=100&rows=30`);
  });
});
