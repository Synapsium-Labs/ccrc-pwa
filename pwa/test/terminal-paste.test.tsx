// A screenshot on the clipboard, pasted straight into the console.
//
// The terminal drawer is a FULL-HEIGHT sheet, so while it is open the composer
// is behind it and out of reach: the only way to hand a session a screenshot
// was to close the terminal, paste into the chat, and open the terminal again.
// xterm's own paste carries TEXT, and an image has no text form, so the event
// died there with no reader at all.
//
// What reaches the pane is the PATH the upload answers with, as an ordinary
// input frame — the same thing a human types when they drag a file onto a
// terminal, and the only form a tmux pane can carry.
//
// Everything here was found by testing against a real device, and three of the
// cases exist because a fix that looked right silently did nothing:
//   - the listener has to CAPTURE, because xterm stops the event below it;
//   - an EMPTY paste must not be forwarded, or the pane is told to paste
//     nothing and answers "No image found in clipboard";
//   - the Ctrl+V guard must read the PHYSICAL key, because `ev.key` is the
//     letter a layout produced and xterm decides on `keyCode`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { TerminalDrawer, type DrawerTerm } from '../src/session/TerminalDrawer';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(navigator as unknown as object, 'clipboard');
  FakeSocket.instances.length = 0;
});

const ID = 'claude:OpenClawHetzner';

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

/** Scripted DrawerTerm. `key` presses one at the terminal and returns xterm's
 *  own verdict: `false` means the drawer took it and no byte reaches the pane. */
const fakeTermFactory = () => {
  const keyHandlers: ((ev: KeyboardEvent) => boolean)[] = [];
  const makeTerm = (_host: HTMLElement): DrawerTerm => ({
    write: () => {},
    onData: () => {},
    onKey: (cb) => {
      keyHandlers.push(cb);
    },
    fit: () => ({ cols: 48, rows: 20 }),
    focus: () => {},
    dispose: () => {},
  });
  return {
    makeTerm,
    key: (init: KeyboardEventInit) => keyHandlers.at(-1)?.(new KeyboardEvent('keydown', init)),
  };
};

const mountDrawer = () => {
  const t = fakeTermFactory();
  const view = render(
    <TerminalDrawer id={ID} open onClose={() => {}} makeSocket={makeSocket} makeTerm={t.makeTerm} />,
  );
  const ws = FakeSocket.instances.at(-1);
  if (!ws) throw new Error('drawer opened no socket');
  act(() => ws.onopen?.());
  ws.sent.length = 0;
  return { t, ws, view };
};

/** The live terminal's host — the element the drawer's own listeners sit on. */
const liveHost = (view: ReturnType<typeof mountDrawer>['view']): HTMLElement => {
  const el = view.baseElement.querySelector('.term-screen > .term-host');
  if (!el) throw new Error('the drawer rendered no terminal host');
  return el as HTMLElement;
};

/** A clipboard carrying files, in the shape `clipboardImages` reads. */
const pasteOf = (...files: File[]) => ({
  clipboardData: {
    items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
    getData: () => '',
  },
});

/** A PNG small enough that the staging path keeps it whole — jsdom has no
 *  canvas, and the downscale branch would need one. */
const smallPng = (name = 'image.png') =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });

const okUpload = (path: string) =>
  // The parameter is declared because the assertion reads it back: a `vi.fn`
  // with no parameters types `mock.calls` as an empty tuple, and indexing it
  // is a compile error — caught by `npm run build`, not by the suite.
  vi.fn(async (_input: RequestInfo | URL) =>
    new Response(JSON.stringify({ ok: true, clip: { path } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

const typedInto = (ws: FakeSocket): string =>
  ws.sent.map((raw) => JSON.parse(raw) as { type: string; data?: string })
    .filter((f) => f.type === 'input').map((f) => f.data ?? '').join('');

describe('a screenshot on the clipboard reaches the pane', () => {
  it('stages a pasted image and types its path into the session', async () => {
    const fetchImpl = okUpload('~/.cc-clips/s/pasted-7.png');
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();

    // FIRED ON A CHILD THAT STOPS PROPAGATION, because that is what xterm
    // does: `handlePasteEvent` calls `stopPropagation()` UNCONDITIONALLY and is
    // bound both to its hidden textarea and to `.terminal.xterm`, one level
    // BELOW this host. A bubble-phase listener here is never reached and the
    // paste dies in silence — measured on a real device, where neither Ctrl+V
    // nor Cmd+V put anything in the pane.
    const inner = document.createElement('div');
    liveHost(view).appendChild(inner);
    inner.addEventListener('paste', (e) => e.stopPropagation());

    fireEvent.paste(inner, pasteOf(smallPng()));

    await waitFor(() =>
      expect(typedInto(ws), 'the staged clip never reached the pane')
        .toContain('~/.cc-clips/s/pasted-7.png'));
    expect(String(fetchImpl.mock.calls[0]?.[0]), 'nothing was staged').toContain('/upload');
  });

  it('leaves an ordinary TEXT paste to the terminal', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();
    const host = liveHost(view);
    const inner = document.createElement('div');
    host.appendChild(inner);
    let reachedXterm = false;
    inner.addEventListener('paste', () => { reachedXterm = true; });

    fireEvent.paste(inner, {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain' }], getData: () => 'echo hi' },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(reachedXterm, 'the drawer swallowed an ordinary text paste').toBe(true);
    expect(fetchImpl, 'a text paste was uploaded as an image').not.toHaveBeenCalled();
    expect(ws.sent, 'a text paste was retyped by the drawer').toEqual([]);
  });

  it('never forwards an EMPTY paste — a paste of nothing is not a paste', async () => {
    // MEASURED IN THE PANE. xterm's `handlePasteEvent` forwards
    // `getData('text/plain')` with no empty guard, and `paste('')` still goes
    // through `bracketTextForPaste`, so the session receives ESC[200~ ESC[201~
    // and Claude Code answers "No image found in clipboard. Use ctrl+v to
    // paste images." That message kept arriving after the Ctrl+V byte had
    // already been stopped, which is how this path was found.
    const { view } = mountDrawer();
    const inner = document.createElement('div');
    liveHost(view).appendChild(inner);
    let reachedXterm = false;
    inner.addEventListener('paste', () => { reachedXterm = true; });

    fireEvent.paste(inner, { clipboardData: { items: [], getData: () => '' } });

    expect(reachedXterm, 'an empty paste was handed to the terminal').toBe(false);
  });
});

// — the paste keystroke, and whose clipboard it is allowed to touch —
//
// xterm special-cases nothing: `Keyboard.ts`'s default arm turns any
// Ctrl+letter into `String.fromCharCode(keyCode - 64)`, so Ctrl+V is the byte
// 0x16 and it goes to the SESSION. What happens there depends on a machine the
// person pressing the key is not sitting at — in a Claude Code pane 0x16 is
// "paste" and reaches for the FLEET BOX's clipboard, and in a shell it is
// readline's quoted-insert, which eats the next keystroke. On a headless box
// that answers "nothing in the clipboard" and merely looks broken, while
// tmux's own paste buffers on the same box are NOT empty. The hazard is a
// gesture made on a phone inserting whatever the server last copied.
describe('Ctrl+V acts on this browser, or on nothing', () => {
  const withClipboard = (impl: unknown): void => {
    // DEFINED ON THE REAL navigator, never swapped for a stand-in: jsdom brands
    // its Navigator, and an `Object.create(navigator, …)` loses that brand —
    // the first thing to read `navigator.userAgent` then throws, which here is
    // vaul's own `isSafari()` inside the sheet this drawer renders in.
    Object.defineProperty(navigator, 'clipboard', { value: impl, configurable: true });
  };

  it('sends no byte to the pane — the session must never see 0x16', async () => {
    withClipboard({});
    const { t, ws } = mountDrawer();

    expect(t.key({ key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true }),
      'xterm was left to process the keystroke').toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent, 'a control byte reached the pane').toEqual([]);
  });

  it('holds under a non-Latin keyboard layout, where the key reports another letter', async () => {
    // xterm builds its control byte from `ev.keyCode` — layout-independent —
    // while `ev.key` is the character the layout produces: on a Ukrainian
    // layout the same physical key reports `м`. A guard written on `key` alone
    // misses precisely when its owner is typing in their own language, and
    // xterm sends 0x16 anyway. Measured in a live pane.
    withClipboard({});
    const { t, ws } = mountDrawer();

    expect(t.key({ key: 'м', code: 'KeyV', keyCode: 86, ctrlKey: true }),
      'the layout decided whether the byte was stopped').toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent, 'a control byte reached the pane under a Cyrillic layout').toEqual([]);
  });

  it('stages an image from THIS browser and types its path', async () => {
    const png = smallPng();
    withClipboard({
      read: async () => [{ types: ['image/png'], getType: async () => png }],
    });
    vi.stubGlobal('fetch', okUpload('~/.cc-clips/s/pasted-9.png'));
    const { t, ws } = mountDrawer();

    t.key({ key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true });

    await waitFor(() =>
      expect(typedInto(ws), 'the clipboard image never reached the pane')
        .toContain('~/.cc-clips/s/pasted-9.png'));
  });

  it('types clipboard TEXT, because that is what a paste of text does', async () => {
    withClipboard({
      read: async () => [{ types: ['text/plain'], getType: async () => new Blob(['x']) }],
      readText: async () => 'echo hello',
    });
    const { t, ws } = mountDrawer();

    t.key({ key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true });

    await waitFor(() => expect(typedInto(ws)).toBe('echo hello'));
  });

  it('a browser that will not hand over its clipboard still sends nothing', async () => {
    // The keystroke is swallowed either way, and the refusal is spoken — but
    // what this case pins is the half that matters: no byte crosses to the box.
    withClipboard({ read: async () => { throw new Error('refused'); }, readText: async () => '' });
    const { t, ws } = mountDrawer();

    expect(t.key({ key: 'v', code: 'KeyV', keyCode: 86, ctrlKey: true })).toBe(false);
    await new Promise((r) => setTimeout(r, 10));
    expect(ws.sent).toEqual([]);
  });

  it('every other Ctrl chord is left to xterm untouched', async () => {
    withClipboard({});
    const { t } = mountDrawer();

    // Ctrl+C is how a pane is interrupted; taking it would be a far worse bug
    // than the one being fixed.
    expect(t.key({ key: 'c', code: 'KeyC', keyCode: 67, ctrlKey: true }),
      'Ctrl+C was swallowed').toBe(true);
    expect(t.key({ key: 'v', code: 'KeyV', keyCode: 86 }), 'a bare v was swallowed').toBe(true);
    expect(t.key({ key: 'v', code: 'KeyV', keyCode: 86, metaKey: true }),
      'Cmd+V was taken from the paste event').toBe(true);
  });
});

// — the gap between the paste and the path —
//
// It is not small and it used to be silent. Measured on a real screenshot off
// a live fleet, 1,250,009 bytes: about a second of upload at 10 Mbit/s, ten at
// 1, forty at 0.25, multiplied by up to four images. With nothing on the
// glass, a slow link is indistinguishable from a paste that did not work — and
// the natural response, pressing again, starts a second upload beside the
// first.
describe('the drawer says it is staging', () => {
  it('says so while the upload is in flight, and stops saying it after', async () => {
    let release: ((r: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { release = res; })));
    const { view } = mountDrawer();

    fireEvent.paste(liveHost(view), pasteOf(smallPng()));

    await waitFor(() => expect(view.baseElement.textContent).toContain('staging image…'));

    release?.(new Response(JSON.stringify({ ok: true, clip: { path: '~/.cc-clips/s/p.png' } }),
      { status: 200, headers: { 'content-type': 'application/json' } }));

    await waitFor(() => expect(view.baseElement.textContent).not.toContain('staging'));
  });

  it('counts the images, because "three still to go" is not "busy"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never settles */ })));
    const { view } = mountDrawer();

    fireEvent.paste(liveHost(view), pasteOf(smallPng('a.png'), smallPng('b.png')));

    await waitFor(() => expect(view.baseElement.textContent).toContain('staging 2 images…'));
  });

  it('a FAILED upload clears the strip too — it must not outlive its upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"too-large"}', { status: 413 })));
    const { view } = mountDrawer();

    fireEvent.paste(liveHost(view), pasteOf(smallPng()));

    await waitFor(() => expect(view.baseElement.textContent).not.toContain('staging'));
  });
});
