// R64 F10 (D-6326): the page's single keys and chords stand down while focus is INSIDE the mounted inline ask card.
// The card is `<section data-ask-surface="inline" tabindex="-1">`; a `[`, `]`, `?` or `g` chord typed there is the card's
// own business (its digits, arrows and Enter are `useAskKeys`'s), never a page step, the shortcut sheet or a Go to. It is the
// EXISTING guard in `useShortcuts` that holds, beside the open-dialog hold: no second registry, and no global block while
// an ask is mounted, so the same keys from the page body, from a control outside the card (a transcript button) and from
// an empty composer still fire, a non-empty composer still keeps them as text, an open dialog still holds them, and ⌘K
// still opens the palette from inside the card.
//
// The harness mounts `useShortcuts` alone over four commands and a DOM that holds the card, the page body, a transcript
// button and the composer's two states. One case in addition mounts the real `DialogSheet` at the desk (fixture 1) and
// presses the keys on its real first option.
//
// RED FIRST, measured on the task's base (the guard held back only for an open dialog): the cases whose key lands inside
// the card red on `expected ... not to have been called`; every other case is a regression pin that passes today and
// keeps passing.
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { Command, CommandContext } from '../src/command/registry';
import { useShortcuts } from '../src/command/useShortcuts';
import { DialogSheet } from '../src/session/DialogSheet';
import { createSessionStore } from '../src/stores/session';
import { askFixture } from './askFixtures';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const ID = 'lane-a-project-a';

/** The four commands every case binds: two single keys, the help key and one `g` chord. `ran` names what fired. */
function bind(ran: string[]): Command[] {
  const cmd = (id: string, keys: readonly string[]): Command => ({
    id, title: id, group: 'Test', keys, run: () => { ran.push(id); },
  });
  return [cmd('prev', ['[']), cmd('next', [']']), cmd('help', ['?']), cmd('go-runs', ['g', 'r'])];
}

function Keys({ ran, palette }: { ran: string[]; palette: () => void }): ReactNode {
  useShortcuts({
    enabled: true,
    commands: bind(ran),
    // No command here reads its context.
    context: () => ({}) as CommandContext,
    onPalette: palette,
  });
  return null;
}

/** The page: a transcript button, the inline card with an option button inside, and the composer's two states. */
function mountPage() {
  const ran: string[] = [];
  const palette = vi.fn();
  render(
    <>
      <Keys ran={ran} palette={palette} />
      <button type="button" data-testid="transcript-button">Copy</button>
      <section data-ask-surface="inline" tabIndex={-1} data-testid="card">
        <p data-testid="card-text">Which cache should the service use?</p>
        <button type="button" data-testid="card-option">Redis</button>
      </section>
      <textarea data-page-keys aria-label="empty composer" defaultValue="" />
      <textarea data-page-keys aria-label="typed composer" defaultValue="draft" />
    </>,
  );
  const at = (id: string): HTMLElement => document.querySelector<HTMLElement>(`[data-testid="${id}"]`)!;
  const field = (label: string): HTMLElement => document.querySelector<HTMLElement>(`[aria-label="${label}"]`)!;
  return { ran, palette, at, field };
}

const press = (el: Element, k: string, init: KeyboardEventInit = {}): void => {
  fireEvent.keyDown(el, { key: k, ...init });
};

describe('focus inside the inline ask card holds the page keys', () => {
  it.each(['[', ']', '?'])('"%s" typed on the card option runs no command', (k) => {
    const { ran, at } = mountPage();
    press(at('card-option'), k);
    expect(ran, `premise: focus is on a button inside the card; "${k}" stayed the card's`).toEqual([]);
  });

  it.each(['[', ']', '?'])('"%s" typed on the card itself (a click on its text puts focus there) runs no command', (k) => {
    const { ran, at } = mountPage();
    press(at('card'), k);
    expect(ran, `premise: the section is the target; "${k}" stayed the card's`).toEqual([]);
  });

  it('a "]" typed on text inside the card runs no command', () => {
    const { ran, at } = mountPage();
    press(at('card-text'), ']');
    expect(ran, 'premise: a descendant of the card is the target').toEqual([]);
  });

  it('a "g" chord with focus inside the card runs no command', () => {
    const { ran, at } = mountPage();
    press(at('card-option'), 'g');
    press(at('card-option'), 'r');
    expect(ran, 'premise: both keys of "g r" land inside the card').toEqual([]);
  });

  it('a "g" pressed on the page and its second key pressed inside the card runs no command', () => {
    const { ran, at } = mountPage();
    press(document.body, 'g');
    press(at('card-option'), 'r');
    expect(ran, 'premise: the chord is half on the page, half in the card; the card holds the second key').toEqual([]);
  });

  it('a held-back key inside the card does not arm a chord for a later key on the page', () => {
    const { ran, at } = mountPage();
    press(at('card-option'), 'g');
    press(document.body, 'r');
    expect(ran, 'premise: the "g" was the card\'s, so the page "r" is a lone key').toEqual([]);
  });

  it('⌘K inside the card still opens the palette', () => {
    const { ran, palette, at } = mountPage();
    press(at('card-option'), 'k', { metaKey: true });
    expect(palette, 'premise: the palette opens from anywhere, the card included').toHaveBeenCalledTimes(1);
    expect(ran).toEqual([]);
  });
});

describe('the page, a control outside the card and the composer behave as before', () => {
  it('"[", "]" and "?" from the page body run their commands', () => {
    const { ran } = mountPage();
    press(document.body, '[');
    press(document.body, ']');
    press(document.body, '?');
    expect(ran, 'premise: the target is the body, outside any card').toEqual(['prev', 'next', 'help']);
  });

  it('a "g" chord from the page body runs its command', () => {
    const { ran } = mountPage();
    press(document.body, 'g');
    press(document.body, 'r');
    expect(ran).toEqual(['go-runs']);
  });

  it('a control outside the card (a transcript button) does not suppress the keys', () => {
    const { ran, at } = mountPage();
    press(at('transcript-button'), ']');
    press(at('transcript-button'), 'g');
    press(at('transcript-button'), 'r');
    expect(ran, 'premise: the button is in the page, not in the card').toEqual(['next', 'go-runs']);
  });

  it('an empty composer marked data-page-keys still passes "[", "]" and "?" and never a chord', () => {
    const { ran, field } = mountPage();
    press(field('empty composer'), '[');
    press(field('empty composer'), ']');
    press(field('empty composer'), '?');
    expect(ran, 'premise: the box is empty').toEqual(['prev', 'next', 'help']);
    press(field('empty composer'), 'g');
    press(field('empty composer'), 'r');
    expect(ran, 'the g chord never passes from a field').toEqual(['prev', 'next', 'help']);
  });

  it('a composer holding text keeps "[", "]" and "?" as text', () => {
    const { ran, field } = mountPage();
    for (const k of ['[', ']', '?']) press(field('typed composer'), k);
    expect(ran, 'premise: the box holds "draft"').toEqual([]);
  });

  it('an open dialog still holds the keys, and ⌘K still opens the palette over it', () => {
    const { ran, palette } = mountPage();
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('data-state', 'open');
    document.body.appendChild(dialog);
    press(document.body, ']');
    press(document.body, '?');
    expect(ran, 'premise: a dialog is open').toEqual([]);
    press(document.body, 'k', { ctrlKey: true });
    expect(palette).toHaveBeenCalledTimes(1);
    dialog.remove();
  });
});

describe('the real inline card at the desk', () => {
  /** `(min-width: 900px)` and `(pointer: fine)` true: the desk, as `ask-inline.test.tsx` stubs it. */
  function desk(): void {
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('min-width: 900px') || q.includes('pointer: fine'),
      media: q, onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false,
    }));
  }

  it('the keys stand down on the mounted card\'s real option and fire from a button outside it', () => {
    desk();
    const ran: string[] = [];
    const store = createSessionStore(ID, {
      makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    act(() => { for (const f of askFixture(1).frames) store.getState().apply(f); });
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    render(
      <>
        <Keys ran={ran} palette={vi.fn()} />
        <DialogSheet id={ID} store={store} />
      </>,
    );
    const card = document.querySelector<HTMLElement>('[data-ask-surface="inline"]');
    expect(card, 'premise: the real inline card is mounted').not.toBeNull();
    const option = card!.querySelector<HTMLElement>('.opt[tabindex="0"]');
    expect(option, 'premise: the card has its roving first option').not.toBeNull();
    act(() => option!.focus());
    expect(document.activeElement, 'premise: focus is on the option').toBe(option);
    press(option!, '[');
    press(option!, ']');
    press(option!, '?');
    expect(ran, 'inside the real card, no page key fires').toEqual([]);
    press(outside, ']');
    expect(ran, 'the same key from a control outside it fires').toEqual(['next']);
    outside.remove();
  });
});
