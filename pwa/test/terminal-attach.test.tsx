// Handing the console a file — by paste, by the picker, or by dropping one on
// it. The same three doors the composer has had since documents landed there,
// and the same rule behind all three.
//
// WHY THE CONSOLE NEEDS ITS OWN. The terminal drawer is a FULL-HEIGHT sheet,
// so while it is open the composer is behind it and out of reach: the only way
// to hand a session a file was to close the terminal, attach in the chat, and
// open the terminal again. xterm's own paste carries TEXT, and a file has no
// text form, so the event died there with no reader at all.
//
// WHAT REACHES THE PANE is the PATH the upload answers with, as an ordinary
// input frame — the same thing a human types when they drag a file onto a
// terminal, and the only form a tmux pane can carry. Claude Code opens it.
//
// WHY THREE DOORS AND NOT ONE. Pasting a file needs a clipboard that can hold
// one: a desktop OS can, a phone cannot, and the async-clipboard fallback this
// drawer uses for Ctrl+V is image-only by the platform's rule rather than
// ours. A console whose document door opened on desktops alone would be the
// wrong shape for an app whose whole premise is the phone.
//
// Several cases here exist because a fix that looked right silently did
// nothing, each found against a real device:
//   - the paste listener has to CAPTURE, because xterm stops the event below;
//   - an EMPTY paste must not be forwarded, or the pane is told to paste
//     nothing and answers "No image found in clipboard";
//   - the Ctrl+V guard must read the PHYSICAL key, because `ev.key` is the
//     letter a layout produced and xterm decides on `keyCode`;
//   - a drop must `preventDefault` on BOTH dragover and drop, or the browser
//     navigates to the file and the console is gone from the screen.
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
    onWheel: () => {},
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

type View = ReturnType<typeof mountDrawer>['view'];

/** The live terminal's host — the element the drawer's own listeners sit on. */
const liveHost = (view: View): HTMLElement => {
  const el = view.baseElement.querySelector('.term-screen > .term-host');
  if (!el) throw new Error('the drawer rendered no terminal host');
  return el as HTMLElement;
};

/** The whole drawer panel — what a drop is answered on, because a file let
 *  through anywhere on it navigates the page away. */
const panel = (view: View): HTMLElement => {
  const el = view.baseElement.querySelector('.term');
  if (!el) throw new Error('the drawer rendered no panel');
  return el as HTMLElement;
};

const picker = (view: View): HTMLInputElement => {
  const el = view.baseElement.querySelector('input[type="file"]');
  if (!el) throw new Error('the drawer rendered no file picker');
  return el as HTMLInputElement;
};

/** A transfer carrying files, in the shape `clipboardFiles` reads — the same
 *  `DataTransfer` shape for a paste and for a drop, which is the point. */
const transferOf = (...files: File[]) => ({
  items: files.map((f) => ({ kind: 'file', type: f.type, getAsFile: () => f })),
  getData: () => '',
});

/** A PNG small enough that the staging path keeps it whole — jsdom has no
 *  canvas, and the downscale branch would need one. */
const smallPng = (name = 'image.png') =>
  new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], name, { type: 'image/png' });

const doc = (name = 'notes.md', body = '# hello\n') =>
  new File([body], name, { type: 'text/markdown' });

const okUpload = (path: string) =>
  // The parameter is declared because the assertions read it back: a `vi.fn`
  // with no parameters types `mock.calls` as an empty tuple, and indexing it
  // is a compile error — caught by `npm run build`, not by the suite.
  vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify({ ok: true, clip: { path } }), {
      status: 200, headers: { 'content-type': 'application/json' },
    }));

/** The file an upload call actually carried, read back off its FormData. */
const uploadedFile = (init: RequestInit | undefined): File => {
  const body = init?.body;
  if (!(body instanceof FormData)) throw new Error('the upload carried no form');
  const f = body.get('file');
  if (!(f instanceof File)) throw new Error('the form carried no file');
  return f;
};

const typedInto = (ws: FakeSocket): string =>
  ws.sent.map((raw) => JSON.parse(raw) as { type: string; data?: string })
    .filter((f) => f.type === 'input').map((f) => f.data ?? '').join('');

describe('a file on the clipboard reaches the pane', () => {
  it('stages a pasted image and types its path into the session', async () => {
    const fetchImpl = okUpload('~/.cc-clips/s/pasted-7.png');
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();

    // FIRED ON A CHILD THAT STOPS PROPAGATION, because that is what xterm
    // does: `handlePasteEvent` calls `stopPropagation()` UNCONDITIONALLY and
    // is bound both to its hidden textarea and to `.terminal.xterm`, one level
    // BELOW this host. A bubble-phase listener here is never reached and the
    // paste dies in silence — measured on a real device, where neither Ctrl+V
    // nor Cmd+V put anything in the pane.
    const inner = document.createElement('div');
    liveHost(view).appendChild(inner);
    inner.addEventListener('paste', (e) => e.stopPropagation());

    fireEvent.paste(inner, { clipboardData: transferOf(smallPng()) });

    await waitFor(() =>
      expect(typedInto(ws), 'the staged clip never reached the pane')
        .toContain('~/.cc-clips/s/pasted-7.png'));
    expect(String(fetchImpl.mock.calls[0]?.[0]), 'nothing was staged').toContain('/upload');
  });

  it('stages a pasted DOCUMENT, and sends it byte for byte', async () => {
    // The whole reason a document may not take the image path: `uploadPayload`
    // is a canvas pass, and running it over text or a PDF either throws or
    // succeeds and uploads a picture of nothing. What the box must receive is
    // the file the reader chose, unchanged, under the name they recognise.
    const fetchImpl = okUpload('~/.cc-clips/s/clip-notes.md');
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();

    fireEvent.paste(liveHost(view), { clipboardData: transferOf(doc('notes.md', '# hello\n')) });

    await waitFor(() =>
      expect(typedInto(ws), 'the document never reached the pane')
        .toContain('~/.cc-clips/s/clip-notes.md'));
    const sent = uploadedFile(fetchImpl.mock.calls[0]?.[1]);
    expect(sent.name, 'the document was renamed on its way up').toBe('notes.md');
    expect(await sent.text(), 'the document was re-encoded on its way up').toBe('# hello\n');
  });

  it('refuses a type the reader on the far end cannot open, and types nothing', async () => {
    // `.zip` is not on the list for a stated reason — a container `Read`
    // cannot open would reach Claude as binary noise. The refusal is SAID; the
    // failure this replaces was a file that vanished with no chip, no toast
    // and nothing in the pane to say why.
    const fetchImpl = okUpload('~/.cc-clips/s/never.zip');
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();

    fireEvent.paste(liveHost(view), {
      clipboardData: transferOf(new File(['PK'], 'bundle.zip', { type: 'application/zip' })),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl, 'a refused type was uploaded anyway').not.toHaveBeenCalled();
    expect(typedInto(ws), 'a refused type put a path in the pane').toBe('');
  });

  it('refuses an IMAGE format the clips directory does not admit', async () => {
    // A GIF walks past `isAttachable` — it is `image/*` — and is stopped one
    // step later, where the NAME is derived: there is no extension for it that
    // the upload route would accept. Two different refusals, and this is the
    // second one; the `.zip` case above never reaches it.
    const fetchImpl = okUpload('~/.cc-clips/s/never.gif');
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();

    fireEvent.paste(liveHost(view), {
      clipboardData: transferOf(new File(['GIF89a'], 'anim.gif', { type: 'image/gif' })),
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(fetchImpl, 'a GIF was staged under a name the route refuses').not.toHaveBeenCalled();
    expect(typedInto(ws), 'a refused image put a path in the pane').toBe('');
  });

  it('leaves an ordinary TEXT paste to the terminal', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();
    const inner = document.createElement('div');
    liveHost(view).appendChild(inner);
    let reachedXterm = false;
    inner.addEventListener('paste', () => { reachedXterm = true; });

    fireEvent.paste(inner, {
      clipboardData: { items: [{ kind: 'string', type: 'text/plain' }], getData: () => 'echo hi' },
    });

    await new Promise((r) => setTimeout(r, 20));
    expect(reachedXterm, 'the drawer swallowed an ordinary text paste').toBe(true);
    expect(fetchImpl, 'a text paste was uploaded as a file').not.toHaveBeenCalled();
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

// — the picker, which is the door a phone can walk through —
describe('the picker hands the console a file', () => {
  it('stages what was picked and types its path', async () => {
    const fetchImpl = okUpload('~/.cc-clips/s/clip-report.pdf');
    vi.stubGlobal('fetch', fetchImpl);
    const { ws, view } = mountDrawer();
    const input = picker(view);

    fireEvent.change(input, {
      target: { files: [new File(['%PDF-1.7'], 'report.pdf', { type: 'application/pdf' })] },
    });

    await waitFor(() =>
      expect(typedInto(ws), 'the picked file never reached the pane')
        .toContain('~/.cc-clips/s/clip-report.pdf'));
  });

  it('admits documents as well as images, so the two doors agree', () => {
    // DERIVED, never hand-written: the accept list is the same constant the
    // composer's own picker uses. A console that admitted a narrower set than
    // the chat would be a second answer to one question.
    const accept = picker(mountDrawer().view).accept;
    expect(accept, 'the picker refuses images').toContain('image/*');
    for (const ext of ['.md', '.txt', '.pdf', '.json', '.csv']) {
      expect(accept, `the picker refuses ${ext}`).toContain(ext);
    }
  });

  it('clears its value, so the same file can be picked twice', async () => {
    // A file input fires `change` only when the value CHANGES. Without the
    // reset, picking the same file again is silent — and "I picked it and
    // nothing happened" is the exact failure this drawer has already paid for.
    //
    // THE WRITE IS WATCHED, not the value afterwards. A file input's value
    // cannot be assigned from script in a real browser and reads back as ''
    // in jsdom whatever the component does, so asserting on it would pass with
    // the reset deleted — measured: that spelling of this test survived the
    // mutation. Spying on the setter observes the one thing that is actually
    // ours to do.
    vi.stubGlobal('fetch', okUpload('~/.cc-clips/s/again.md'));
    const { view } = mountDrawer();
    const input = picker(view);
    const writes: string[] = [];
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => '',
      set: (v: string) => { writes.push(v); },
    });

    fireEvent.change(input, { target: { files: [doc('again.md')] } });

    await waitFor(() => expect(writes, 'the picker never cleared its value').toContain(''));
  });
});

// — a file dropped on the console —
//
// The browser's default action for a file dropped on a page is to NAVIGATE TO
// IT: a PDF let through replaces the console with a PDF viewer and the session
// is gone from the screen. Both halves are required — without preventDefault
// on dragover no drop event is delivered at all, and without it on drop the
// navigation happens anyway.
describe('a dropped file reaches the pane, and never the address bar', () => {
  it('stages a dropped document and types its path', async () => {
    vi.stubGlobal('fetch', okUpload('~/.cc-clips/s/clip-spec.md'));
    const { ws, view } = mountDrawer();

    fireEvent.drop(panel(view), { dataTransfer: transferOf(doc('spec.md')) });

    await waitFor(() =>
      expect(typedInto(ws), 'the dropped file never reached the pane')
        .toContain('~/.cc-clips/s/clip-spec.md'));
  });

  it('answers dragover, or no drop is ever delivered', () => {
    const { view } = mountDrawer();
    const ev = new Event('dragover', { bubbles: true, cancelable: true });

    panel(view).dispatchEvent(ev);

    expect(ev.defaultPrevented, 'dragover was left to the browser').toBe(true);
  });

  it('answers the drop itself, so the page is not navigated away', () => {
    vi.stubGlobal('fetch', okUpload('~/.cc-clips/s/x.md'));
    const { view } = mountDrawer();
    const ev = Object.assign(
      new Event('drop', { bubbles: true, cancelable: true }),
      { dataTransfer: transferOf(doc()) },
    );

    panel(view).dispatchEvent(ev);

    expect(ev.defaultPrevented, 'the browser was left to open the dropped file').toBe(true);
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

// — the gap between the gesture and the path —
//
// It is not small and it used to be silent. Measured on a real screenshot off
// a live fleet, 1,250,009 bytes: about a second of upload at 10 Mbit/s, ten at
// 1, forty at 0.25, multiplied by up to four files. With nothing on the glass,
// a slow link is indistinguishable from a gesture that did not work — and the
// natural response, doing it again, starts a second upload beside the first.
describe('the drawer says it is staging', () => {
  it('says so while the upload is in flight, and stops saying it after', async () => {
    let release: ((r: Response) => void) | undefined;
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((res) => { release = res; })));
    const { view } = mountDrawer();

    fireEvent.paste(liveHost(view), { clipboardData: transferOf(smallPng()) });

    await waitFor(() => expect(view.baseElement.textContent).toContain('staging file…'));

    release?.(new Response(JSON.stringify({ ok: true, clip: { path: '~/.cc-clips/s/p.png' } }),
      { status: 200, headers: { 'content-type': 'application/json' } }));

    await waitFor(() => expect(view.baseElement.textContent).not.toContain('staging'));
  });

  it('counts them, because "three still to go" is not "busy"', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => { /* never settles */ })));
    const { view } = mountDrawer();

    fireEvent.paste(liveHost(view), { clipboardData: transferOf(smallPng('a.png'), doc('b.md')) });

    await waitFor(() => expect(view.baseElement.textContent).toContain('staging 2 files…'));
  });

  it('a FAILED upload clears the strip too — it must not outlive its upload', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":"too-large"}', { status: 413 })));
    const { view } = mountDrawer();

    fireEvent.paste(liveHost(view), { clipboardData: transferOf(smallPng()) });

    await waitFor(() => expect(view.baseElement.textContent).not.toContain('staging'));
  });
});
