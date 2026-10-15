// The keyboard is counted ONCE on the full-height sheet (the terminal drawer).
//
// vaul's `repositionInputs` (on by default) listens to `visualViewport` resizes
// and, whenever an input or textarea has focus, shrinks the panel to the
// visible area. The terminal already pads its own bottom by the keyboard's
// height (`useKeyboardInset`, shared with the session screen), so with both on
// the keyboard was subtracted twice. Measured on an Android phone (Chrome 155;
// a 792px layout viewport, 444px visible with the keyboard up): typing into the
// terminal collapsed its glass to zero rows, and the input box left the screen.
//
// jsdom has no visualViewport, so this file installs a minimal one and drives
// vaul's own handler with it. The non-full row proves the harness reaches that
// handler: a sheet that keeps `repositionInputs` IS resized here.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { Sheet } from '../src/components/Sheet';

class FakeViewport extends EventTarget {
  width = 412;
  height = window.innerHeight;
  offsetTop = 0;
  offsetLeft = 0;
  pageTop = 0;
  pageLeft = 0;
  scale = 1;
}

let vv: FakeViewport;
const had = Object.getOwnPropertyDescriptor(window, 'visualViewport');

beforeEach(() => {
  vv = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: vv });
});
afterEach(() => {
  cleanup();
  if (had) Object.defineProperty(window, 'visualViewport', had);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

/** Focus the sheet's textarea, then open a keyboard that leaves 300px visible. */
const openKeyboard = (): void => {
  (screen.getByTestId('ta') as HTMLTextAreaElement).focus();
  vv.height = 300;
  vv.dispatchEvent(new Event('resize'));
};

const panelHeight = (): string =>
  (document.querySelector('[data-vaul-drawer]') as HTMLElement | null)?.style.height ?? '<no panel>';

describe('the keyboard is counted once on the terminal sheet', () => {
  it('a full sheet is not resized by vaul when the keyboard opens over a focused textarea', () => {
    render(<Sheet open full onClose={() => {}} title="Terminal"><textarea data-testid="ta" /></Sheet>);
    openKeyboard();
    expect(panelHeight(), 'vaul resized the full sheet: with useKeyboardInset that subtracts the keyboard twice')
      .toBe('');
  });

  it('a NON-full sheet is still resized by vaul — the stand-down is scoped, and the harness reaches vaul', () => {
    render(<Sheet open onClose={() => {}} title="Rename"><textarea data-testid="ta" /></Sheet>);
    openKeyboard();
    expect(panelHeight(), 'vaul did not resize a non-full sheet: either the scope widened or this harness is vacuous')
      .toBe('300px');
  });
});
