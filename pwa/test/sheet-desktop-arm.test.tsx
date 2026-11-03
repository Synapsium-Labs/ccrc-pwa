// The Sheet's desktop arm (D-5933, spec §2.1–§2.2): at ≥900 every non-full sheet is a centred dialog in three
// sizes on `--elev-pop`, with a ✕, no grabber and no drag. The arm is chosen BY WIDTH, never by skin, from one width
// reading (`useDesk()`), and nothing remounts on a crossing. The 900 query is written once, in
// `ui/src/lib/use-media-query.ts`, and `.whats-new-panel`, the local copy of this arm, is gone.
//
// jsdom computes no layout and no animation: this file holds the chrome, the drag's stand-down (the pointer-capture signal
// `sheet-handle-only.test.tsx` documents), the classes and the source pins. What Chrome computes from them is
// `browser/sheet-desktop-arm.browser.test.tsx`'s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { INSTRUMENT, REFINED, Sheet } from '@ccrc/ui';

const REPO = path.resolve(import.meta.dirname, '..', '..');
const read = (rel: string): string => readFileSync(path.join(REPO, rel), 'utf8');

// — a viewport whose width the test moves, and whose `change` listeners hear it —
let wide = false;
const listeners = new Set<() => void>();
const setWidth = (px: number): void => {
  wide = px >= 900;
  for (const l of [...listeners]) l();
};
beforeEach(() => {
  wide = false;
  vi.stubGlobal('matchMedia', (q: string) => ({
    get matches() { return q === '(min-width: 900px)' ? wide : false; },
    media: q,
    onchange: null,
    addEventListener: (_: string, l: () => void) => { listeners.add(l); },
    removeEventListener: (_: string, l: () => void) => { listeners.delete(l); },
    addListener() {}, removeListener() {}, dispatchEvent: () => false,
  }));
});
afterEach(() => {
  vi.unstubAllGlobals();
  listeners.clear();
  document.documentElement.removeAttribute('data-skin');
});

const panel = (): HTMLElement => document.querySelector<HTMLElement>('.sheet-panel')!;
const grabber = (): Element | null => document.querySelector('.sheet-grabber');
const closeButton = (): HTMLElement | null => screen.queryByRole('button', { name: 'Close' });

/** One deliberate downward drag across the panel's content (the grabber is not where it starts). */
const dragAcross = (el: HTMLElement): void => {
  fireEvent.pointerDown(el, { pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0, pointerType: 'touch' });
  fireEvent.pointerMove(el, { pointerId: 1, clientX: 100, clientY: 220, isPrimary: true, pointerType: 'touch' });
  fireEvent.pointerUp(el, { pointerId: 1, clientX: 100, clientY: 220, isPrimary: true, pointerType: 'touch' });
};
/** The elements vaul captured the pointer on while a drag was dispatched: a panel that CLAIMS the drag runs vaul's
 *  `onPress`, which captures the pointer on the pressed element, and one that stood down captures nothing (measured
 *  in `sheet-handle-only.test.tsx`). */
const capturesDuring = (run: () => void): Element[] => {
  const captured: Element[] = [];
  const spy = vi.spyOn(window.HTMLElement.prototype, 'setPointerCapture').mockImplementation(function (this: Element) {
    captured.push(this);
  });
  try { run(); } finally { spy.mockRestore(); }
  return captured;
};

describe('the arm is chosen by width, never by skin', () => {
  for (const skin of [REFINED, INSTRUMENT]) {
    it(`≥900 in ${skin}: no .sheet-grabber, a ✕ present`, () => {
      document.documentElement.setAttribute('data-skin', skin);
      setWidth(1280);
      render(<Sheet open onClose={() => {}} title="Pick one"><p>body</p></Sheet>);
      expect(grabber(), 'a grabber on a centred dialog promises a drag it does not have').toBeNull();
      expect(closeButton(), 'the dialog has no ✕').not.toBeNull();
    });
  }

  it('<900 in Instrument: the grabber is present, and there is no ✕', () => {
    document.documentElement.setAttribute('data-skin', INSTRUMENT);
    setWidth(390);
    render(<Sheet open onClose={() => {}} title="Pick one"><p>body</p></Sheet>);
    expect(grabber()).not.toBeNull();
    expect(closeButton()).toBeNull();
  });
});

describe('≥900: the dialog closes by the ✕, Escape and the scrim, and never by a drag', () => {
  beforeEach(() => { setWidth(1280); });

  it('a ✕ named Close closes', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Pick one"><p>body</p></Sheet>);
    fireEvent.click(closeButton()!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('a pointer drag on the panel does not close it', () => {
    const onClose = vi.fn();
    const captures = capturesDuring(() => {
      render(<Sheet open onClose={onClose} title="Pick one"><div data-testid="list">a list</div></Sheet>);
      dragAcross(screen.getByTestId('list'));
    });
    expect(captures, 'vaul claimed a drag on the centred dialog').toEqual([]);
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector('[data-vaul-handle]'), 'a handle would be a drag target').toBeNull();
  });

  it('Escape closes', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Pick one"><p>body</p></Sheet>);
    fireEvent.keyDown(document.activeElement ?? panel(), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('the scrim closes', () => {
    const onClose = vi.fn();
    render(<Sheet open onClose={onClose} title="Pick one"><p>body</p></Sheet>);
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    ['sm', '440px'],
    ['md', '560px'],
    ['lg', '720px'],
    [undefined, '560px'],
  ] as const)('size %s sets the dialog to %s, capped by the gutters', (size, px) => {
    render(<Sheet open onClose={() => {}} title="Pick one" size={size}><p>body</p></Sheet>);
    const cls = panel().className;
    expect(cls).toContain(`min-[900px]:w-[min(${px},calc(100vw-2*var(--sp-8)))]`);
    for (const other of ['440px', '560px', '720px'].filter((o) => o !== px)) expect(cls).not.toContain(`(${other},`);
  });

  it('centred, on --elev-pop, round on every corner, with no overscroll strip below it', () => {
    render(<Sheet open onClose={() => {}} title="Pick one"><p>body</p></Sheet>);
    const cls = panel().className.split(/\s+/);
    for (const c of [
      'min-[900px]:inset-0', 'min-[900px]:m-auto', 'min-[900px]:h-fit', 'min-[900px]:rounded-xl',
      'min-[900px]:shadow-pop', 'min-[900px]:after:content-none!',
    ]) expect(cls, c).toContain(c);
  });
});

describe('<900: the bottom sheet is unchanged', () => {
  it('the grabber is back and the panel claims the drag', () => {
    setWidth(390);
    const captures = capturesDuring(() => {
      render(<Sheet open onClose={() => {}} title="Pick one"><div data-testid="list">a list</div></Sheet>);
      dragAcross(screen.getByTestId('list'));
    });
    expect(grabber()).not.toBeNull();
    expect(captures, 'the phone panel stood down: a swipe no longer dismisses').toContain(screen.getByTestId('list'));
  });
});

describe('nothing remounts on a crossing', () => {
  it('crossing 900 while open keeps the typed text in a child input', () => {
    setWidth(390);
    render(<Sheet open onClose={() => {}} title="Name it"><input aria-label="name" /></Sheet>);
    const input = screen.getByRole<HTMLInputElement>('textbox', { name: 'name' });
    fireEvent.change(input, { target: { value: 'half typed' } });
    act(() => { setWidth(1280); });
    expect(grabber(), 'the crossing was not heard').toBeNull();
    const after = screen.getByRole<HTMLInputElement>('textbox', { name: 'name' });
    expect(after, 'the input remounted').toBe(input);
    expect(after.value).toBe('half typed');
    act(() => { setWidth(390); });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'name' }).value).toBe('half typed');
  });
});

describe('`full` is identical at both widths', () => {
  it('the terminal drawer keeps its handle, its classes and no ✕ at 1280', () => {
    const shot = (): { cls: string; eyebrow: string; handle: boolean; close: boolean } => {
      const view = render(<Sheet open full onClose={() => {}} title="Terminal" eyebrow="project-a"><div /></Sheet>);
      const out = {
        cls: panel().className, eyebrow: document.querySelector('.sheet-eyebrow')!.className,
        handle: document.querySelector('[data-vaul-handle]') !== null, close: closeButton() !== null,
      };
      view.unmount();
      return out;
    };
    setWidth(390);
    const phone = shot();
    setWidth(1280);
    const desk = shot();
    expect(desk).toEqual(phone);
    expect(desk.handle).toBe(true);
    expect(desk.close).toBe(false);
    expect(desk.cls).not.toContain('min-[900px]');
  });
});

describe('one owner for each part of the arm', () => {
  const walk = (dir: string, ext: RegExp): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = path.join(dir, e);
      return statSync(full).isDirectory() ? walk(full, ext) : ext.test(full) ? [full] : [];
    });

  it('no `.whats-new-panel` rule exists, and no source names it', () => {
    const hits = [...walk(path.join(REPO, 'pwa', 'src'), /\.(css|tsx?)$/), ...walk(path.join(REPO, 'ui', 'src'), /\.(css|tsx?)$/)]
      .filter((f) => readFileSync(f, 'utf8').includes('whats-new-panel'))
      .map((f) => path.relative(REPO, f));
    expect(hits).toEqual([]);
  });

  it('no `(min-width: 900px)` literal exists in pwa/src or ui/src TS outside ui/src/lib/use-media-query.ts', () => {
    // CSS `@media` rules cannot import a TS constant and stay; test files that parse them are out of scope.
    const hits = [...walk(path.join(REPO, 'pwa', 'src'), /\.tsx?$/), ...walk(path.join(REPO, 'ui', 'src'), /\.tsx?$/)]
      .filter((f) => /min-width:\s*900px/.test(readFileSync(f, 'utf8')))
      .map((f) => path.relative(REPO, f));
    expect(hits).toEqual(['ui/src/lib/use-media-query.ts']);
    expect(read('ui/src/lib/use-media-query.ts')).toMatch(/export const DESK_QUERY = '\(min-width: 900px\)';/);
  });

  it('`--shadow-pop` is `--elev-pop` (D-6019), and the arm\'s two keyframes are declared once, in theme.css', () => {
    const theme = read('ui/src/styles/theme.css');
    expect(theme).toMatch(/^\s*--shadow-pop:\s*var\(--elev-pop\);/m);
    for (const name of ['sheet-pop-in', 'sheet-pop-out']) {
      const everywhere = [...walk(path.join(REPO, 'pwa', 'src'), /\.css$/), ...walk(path.join(REPO, 'ui', 'src'), /\.css$/)]
        .flatMap((f) => [...readFileSync(f, 'utf8').matchAll(new RegExp(`@keyframes\\s+${name}\\b`, 'g'))].map(() => path.relative(REPO, f)));
      expect(everywhere, name).toEqual(['ui/src/styles/theme.css']);
    }
  });
});
