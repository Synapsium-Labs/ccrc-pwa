// `handleOnly` on the full-height sheet — the console's own drag, and the
// census that keeps the handle attached to it (spec §5.6, ruling 9).
//
// THE GESTURE ITSELF IS NOT MEASURABLE IN JSDOM and saying so is part of the
// guard: vaul's drag needs real layout, so a simulated pointer drag across the
// glass "passes" whether or not the panel owns it. What IS measurable is that
// the panel STOOD DOWN — without `handleOnly`, vaul's own `onPointerMove` runs
// `getTranslate`, which reads a computed style jsdom does not produce and
// throws `TypeError: Cannot read properties of undefined (reading 'match')`.
// The throw escapes into React's commit and reaches `window`'s `error` event,
// which is the signal this file counts. Measured, vaul 1.1.2: 2 TypeErrors
// from one drag without the flag, 0 with it.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { Sheet } from '../src/components/Sheet';

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

/** Whatever vaul threw while the drag was being dispatched. */
const errorsDuring = (run: () => void): unknown[] => {
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent): void => { errors.push(e.error); };
  window.addEventListener('error', onError);
  try {
    run();
  } finally {
    window.removeEventListener('error', onError);
  }
  return errors;
};

describe('the console keeps its own drag', () => {
  it('a full sheet does not let the panel claim a drag across its content', () => {
    // On a phone this is the whole defect: a swipe over the console collapsed
    // the drawer instead of scrolling it, because the panel and the glass were
    // both claiming the gesture and the panel won.
    const errors = errorsDuring(() => {
      render(
        <Sheet open full onClose={() => {}} title="Terminal">
          <div data-testid="glass">console</div>
        </Sheet>,
      );
      dragAcross(screen.getByTestId('glass'));
    });
    expect(errors, 'vaul claimed a drag across the full sheet\'s content').toEqual([]);
  });

  it('a NON-full sheet still lets the panel be dragged — the stand-down is scoped', () => {
    // The other nineteen sheets hold a list, where a downward swipe anywhere
    // IS a dismissal and should stay one. `handleOnly` is derived from `full`
    // for exactly this reason, and widening it to `true` reds here.
    const errors = errorsDuring(() => {
      render(
        <Sheet open onClose={() => {}} title="Pick one">
          <div data-testid="list">a list</div>
        </Sheet>,
      );
      dragAcross(screen.getByTestId('list'));
    });
    expect(errors.length, 'the non-full panel stood down too — the guard is not scoped to full')
      .toBeGreaterThan(0);
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
    const src = readFileSync(path.join(SRC, 'components', 'Sheet.tsx'), 'utf8');
    expect(src, 'the full variant no longer stands the panel down').toMatch(/handleOnly=\{full\}/);
    expect(src, 'the full variant renders no vaul handle to drag by')
      .toMatch(/full\s*\r?\n?\s*\?\s*<Drawer\.Handle/);
  });
});
