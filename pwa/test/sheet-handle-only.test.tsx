// `handleOnly` on the full-height sheet — the console's own drag, and the
// census that keeps the handle attached to it (spec §5.6, ruling 9).
//
// THE GESTURE ITSELF IS NOT MEASURABLE IN JSDOM and saying so is part of the
// guard: vaul's drag needs real layout, so a simulated pointer drag across the
// glass "passes" whether or not the panel owns it. What IS measurable is that
// the panel STOOD DOWN. A panel that claims the drag runs vaul's `onPress` on
// the pointerdown, and `onPress` captures the pointer on the element pressed
// (`event.target.setPointerCapture`); with `handleOnly`, vaul's Content returns
// before `onPress`, so nothing is captured. The captures are the signal this
// file counts. Measured, vaul 1.1.2 on jsdom 30: 1 capture from one drag
// without the flag, 0 with it. (Through jsdom 28 the signal was a TypeError
// from vaul's `getTranslate`, which read a computed `transform` jsdom left
// empty; jsdom 29+ computes `transform` as `none`, so that throw is gone.)
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Sheet } from '@ccrc/ui';

afterEach(cleanup);

/** One deliberate downward drag across a sheet's CONTENT — not its grabber. */
const dragAcross = (el: HTMLElement): void => {
  fireEvent.pointerDown(el, {
    pointerId: 1, clientX: 100, clientY: 100, isPrimary: true, button: 0, pointerType: 'touch',
  });
  fireEvent.pointerMove(el, {
    pointerId: 1, clientX: 100, clientY: 220, isPrimary: true, pointerType: 'touch',
  });
  fireEvent.pointerUp(el, {
    pointerId: 1, clientX: 100, clientY: 220, isPrimary: true, pointerType: 'touch',
  });
};

/** The elements vaul captured the pointer on while the drag was being dispatched: one per drag the panel claimed. */
const capturesDuring = (run: () => void): Element[] => {
  const captured: Element[] = [];
  const spy = vi.spyOn(window.HTMLElement.prototype, 'setPointerCapture').mockImplementation(function (this: Element) {
    captured.push(this);
  });
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return captured;
};

describe('the console keeps its own drag', () => {
  it('a full sheet does not let the panel claim a drag across its content', () => {
    // On a phone this is the whole defect: a swipe over the console collapsed
    // the drawer instead of scrolling it, because the panel and the glass were
    // both claiming the gesture and the panel won.
    const captures = capturesDuring(() => {
      render(
        <Sheet open full onClose={() => {}} title="Terminal">
          <div data-testid="glass">console</div>
        </Sheet>,
      );
      dragAcross(screen.getByTestId('glass'));
    });
    expect(captures, 'vaul claimed a drag across the full sheet\'s content').toEqual([]);
  });

  it('a NON-full sheet still lets the panel be dragged — the stand-down is scoped', () => {
    // The other nineteen sheets hold a list, where a downward swipe anywhere
    // IS a dismissal and should stay one. `handleOnly` is derived from `full`
    // for exactly this reason, and widening it to `true` reds here.
    const captures = capturesDuring(() => {
      render(
        <Sheet open onClose={() => {}} title="Pick one">
          <div data-testid="list">a list</div>
        </Sheet>,
      );
      dragAcross(screen.getByTestId('list'));
    });
    expect(captures, 'the non-full panel stood down too — the guard is not scoped to full')
      .toContain(screen.getByTestId('list'));
  });

  it('a full sheet offers a real handle to drag by', () => {
    // `handleOnly` without a handle is a panel nothing can dismiss by touch.
    render(<Sheet open full onClose={() => {}} title="Terminal"><div /></Sheet>);
    expect(document.querySelector('[data-vaul-handle]'),
      'the grabber is decoration, not a drag target').toBeTruthy();
  });
});

// — the census (ruling 9a) —
//
// `handleOnly` reaches every consumer that passes `full`, and a full-height
// sheet with the flag and no handle cannot be dismissed by drag at all. Today
// exactly one sheet is full-height and `Sheet` gives it the handle in the same
// branch as the flag. A second one arriving must prove the same thing rather
// than inherit an assumption.
describe('the full-height sheet census', () => {
  const SRC = path.resolve(__dirname, '../src');
  const REPO = path.resolve(__dirname, '../..');
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((e) => {
      const full = path.join(dir, e);
      return statSync(full).isDirectory() ? walk(full) : full.endsWith('.tsx') ? [full] : [];
    });

  it('the terminal drawer is the only full-height Sheet', () => {
    const consumers = walk(SRC)
      .filter((f) => [...readFileSync(f, 'utf8').matchAll(/<Sheet\b[^>]*>/g)]
        .some((m) => /\bfull\b/.test(m[0])))
      .map((f) => path.relative(REPO, f));
    expect(consumers, 'a new full-height Sheet appeared — prove its handle, then list it here')
      .toEqual(['pwa/src/session/TerminalDrawer.tsx']);
  });

  it('every full-height Sheet gets its handle from Sheet itself, in the same branch as the flag', () => {
    // The primitive moved to @ccrc/ui in wave 1; the invariant did not. Both
    // assertions below are unchanged — the flag and the handle must still be
    // chosen in ONE branch, or a future edit can set `handleOnly` without
    // giving the panel a handle to drag by.
    const src = readFileSync(
      path.join(REPO, 'ui', 'src', 'primitives', 'sheet.tsx'), 'utf8');
    // The desktop arm (D-5933) stands the panel down too, on purpose with NO handle: a centred dialog has no drag,
    // and the ✕, Escape and the scrim close it (`sheet-desktop-arm.test.tsx`). The flag is `full` or that, nothing else.
    expect(src, 'the full variant no longer stands the panel down').toMatch(/handleOnly=\{full \|\| desk\}/);
    expect(src, 'the full variant renders no vaul handle to drag by')
      .toMatch(/full\s*\r?\n?\s*\?\s*<Drawer\.Handle/);
  });
});
