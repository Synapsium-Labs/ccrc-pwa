// SPEC §5.5 LENS 3 — ESCAPE-SEQUENCE REPLAY. The one lens the programme marked
// MANDATORY, and the one the wave reviewed without leaving a mechanism behind.
//
// WHAT THE THREAT IS. `GET /api/sessions/:id/pane/history` captures with
// `capture-pane -e`, which RE-EMITS escape sequences, and the drawer replays up
// to `PANE_HISTORY_LINES` (2000) lines of them into a SECOND emulator. Those
// bytes are model- and repo-controlled: anything a session printed, anything a
// file it `cat`ed contained. The live terminal and the history terminal are two
// `new Terminal({...})` calls with two option objects, so the second one can
// drift from the first silently — and it is the second one that parses bytes
// nobody is watching arrive.
//
// WHY IT IS CLOSED TODAY, and what each clause below is holding shut:
//   - `disableStdin: true` closes the REPLY path. xterm answers a handful of
//     queries by writing back (DA, DSR, and — where a handler exists — OSC 52);
//     with stdin disabled there is nowhere for a reply to go, and this terminal
//     has no pty behind it in any case.
//   - no addon beyond `FitAddon`. The clipboard addon is what would give OSC 52
//     a handler, and the web-links addon is what would turn OSC 8 (which
//     `capture-pane -e` DOES re-emit) into a clickable target.
//   - no `allowProposedApi`, which is what unlocks the proposed parser hooks,
//     and no `linkHandler`, which is the option form of the same reach.
//
// NONE OF THAT IS A CLAIM ABOUT XTERM'S PARSER. It is a claim about this
// terminal's CONFIGURATION, which is the part this repo owns and the part that
// can change in a one-line diff. The review found the property true by reading;
// this file is what notices when it stops being true.
import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

interface Constructed { opts: Record<string, unknown>; addons: unknown[] }

vi.mock('@xterm/xterm', () => {
  class Terminal {
    cols = 80;
    rows = 24;
    options: Record<string, unknown>;
    buffer = { active: { viewportY: 20, baseY: 40 } };
    constructor(opts: Record<string, unknown>) {
      this.options = { ...opts };
      const rec: Constructed = { opts, addons: [] };
      (globalThis as { __built?: Constructed[] }).__built ??= [];
      (globalThis as { __built?: Constructed[] }).__built!.push(rec);
      (this as unknown as { __rec: Constructed }).__rec = rec;
    }
    loadAddon(a: unknown): void {
      (this as unknown as { __rec: Constructed }).__rec.addons.push(a);
    }
    open(host: HTMLElement): void {
      const wrapper = document.createElement('div');
      wrapper.className = 'xterm';
      const screen = document.createElement('div');
      screen.className = 'xterm-screen';
      screen.getBoundingClientRect = (): DOMRect =>
        ({ height: 480, width: 800, top: 0, left: 0, right: 800, bottom: 480,
           x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
      wrapper.appendChild(screen);
      host.appendChild(wrapper);
    }
    onRender(): { dispose(): void } { return { dispose(): void {} }; }
    onScroll(): { dispose(): void } { return { dispose(): void {} }; }
    write(_d: string, done?: () => void): void { done?.(); }
    scrollLines(n: number): void {
      const b = this.buffer.active;
      b.viewportY = Math.max(0, Math.min(b.baseY, b.viewportY + n));
    }
    dispose(): void {}
  }
  return { Terminal };
});

vi.mock('@xterm/addon-fit', () => {
  class FitAddon { fit(): void {} }
  return { FitAddon };
});

const { defaultMakeHistoryTerm } = await import('../src/session/TerminalDrawer');
const { FitAddon } = await import('@xterm/addon-fit');

/** Build the history terminal and hand back what it asked xterm for. */
const built = (): Constructed => {
  (globalThis as { __built?: Constructed[] }).__built = [];
  const host = document.createElement('div');
  document.body.appendChild(host);
  defaultMakeHistoryTerm(host, 2000);
  const all = (globalThis as { __built?: Constructed[] }).__built ?? [];
  const rec = all.at(-1);
  if (!rec) throw new Error('the history terminal constructed no Terminal at all');
  return rec;
};

const root = path.resolve(__dirname, '..', 'src');
const sources = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sources(path.join(dir, e.name))
      : (/\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));

describe('the history terminal replays untrusted bytes with the live glass and no more reach', () => {
  it('keeps stdin disabled — the reply path a query would answer down', () => {
    expect(built().opts.disableStdin,
      'the history terminal can write back to something again').toBe(true);
  });

  it('loads the fit addon and nothing else', () => {
    // A second addon here is how OSC 52 gets a clipboard handler or OSC 8 gets a
    // click target. `instanceof` rather than a count alone, so swapping FitAddon
    // for something else is caught as well as adding to it.
    const { addons } = built();
    expect(addons, 'the history terminal loads an addon beyond FitAddon').toHaveLength(1);
    expect(addons[0], 'the one addon loaded is no longer the fit addon')
      .toBeInstanceOf(FitAddon);
  });

  it('asks for no proposed API and installs no link handler', () => {
    const { opts } = built();
    for (const key of ['allowProposedApi', 'linkHandler', 'customGlyphs']) {
      expect(Object.hasOwn(opts, key), `the history terminal now sets \`${key}\``).toBe(false);
    }
  });

  it('and NEITHER terminal reaches for them — the option object is not the only door', () => {
    // The behavioural checks above see ONE constructor. `defaultMakeTerm` is not
    // exported and `registerLinkProvider` is a method, not an option, so the
    // second half of the property is a scan: nowhere in the shipped app does any
    // terminal ask for the proposed API, install a link handler, or register a
    // link provider.
    const offenders = sources(root).filter((f) =>
      /allowProposedApi|linkHandler|registerLinkProvider/.test(readFileSync(f, 'utf8')));
    expect(offenders.map((f) => path.relative(root, f)),
      'a shipped source reaches for proposed API or link handling').toEqual([]);
  });

  it('imports exactly one xterm addon package, and it is the fit addon', () => {
    // DERIVED, not a denylist: a clipboard or web-links addon added anywhere in
    // the app lands here whether or not anyone thought to forbid it by name.
    const imported = new Set<string>();
    for (const f of sources(root)) {
      for (const m of readFileSync(f, 'utf8').matchAll(/@xterm\/addon-[a-z-]+/g)) imported.add(m[0]);
    }
    expect([...imported].sort(), 'the app imports an xterm addon beyond fit')
      .toEqual(['@xterm/addon-fit']);
  });
});
