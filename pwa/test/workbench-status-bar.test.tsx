// WorkbenchStatusBar — the desk shell's quiet bottom line: the agent link, the
// fleet totals, what needs you, the palette and shortcut hints, the build.
// Neutral fixtures only. Behaviour and accessibility are pinned here; pixels
// are the stories' and the blind verifier's.
//
// The component formats only its own counts ("19 sessions · 5 runs", "2 need
// you", "nothing needs you", "1 exited"); every other word (the build text)
// arrives as a prop. It never writes "0 need you".
//
// MUTATION TABLE (measured 2026-10-20, each row: guard removed -> this file red,
// guard restored -> 23/23 green):
//   - zero branch "nothing needs you" replaced by `${needYou} need you`
//       -> red: "says nothing needs you at zero, never 0 need you" (and the
//          keyboard-order case, which names the item by that text)
//   - `n === 1` singular choice forced to the plural
//       -> red: "uses singulars for one"
//   - `data-warn` dropped from the build text
//       -> red: "build warn rides data-warn, and only with warn set"
//   - onOpenBuild not wired to the build item
//       -> red: "every item is a named button and each callback fires"
//   - `flex: 0 100000 auto` (now `0 1e12 auto`) on .wb-status-totals relaxed to `flex: 0 1 auto`
//       -> red: "the totals are the item that shrinks first"
//   - the 480px hide written bare (`.wb-status-keys`, which loses to the
//     item's `display: inline-flex`)
//       -> red: "below 480px the shortcuts and the word "connected" yield"
//
// SECOND ROUND (the yield order moved onto the bar's own width; measured
// 2026-10-20, 28/28 green before and after, each mutation alone):
//   - the hide step written back as `@media (max-width: 480px)`
//       -> red 3: "the bar is its own container…", "step 2: under 84ch…", "step 3…"
//   - the 84ch hide written bare (`.wb-status-keys`)
//       -> red 1: "step 2: under 84ch…"
//   - `data-calm` set while something needs you
//       -> red 1: "only the calm needs item may yield its words…"
//   - `data-long` on every build line
//       -> red 1: "marks a build line longer than its 11-character floor…"
//   - the calm item's shrink factor relaxed to `0 1 auto`
//       -> red 1: "then the calm words yield before the build line…"
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  WorkbenchStatusBar,
  type WorkbenchStatusBarProps,
} from '@ccrc/ui';
import { atBlock, declValue, ruleIn, stripComments } from './cssRule';

afterEach(cleanup);

const SHEET = readFileSync(
  path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-status-bar.css'),
  'utf8',
);
const CSS = stripComments(SHEET);

type Callbacks = Pick<
  WorkbenchStatusBarProps,
  'onOpenLink' | 'onOpenFleet' | 'onOpenNeeds' | 'onOpenPalette' | 'onOpenShortcuts' | 'onOpenBuild'
>;

function callbacks(): { [K in keyof Callbacks]: ReturnType<typeof vi.fn<() => void>> } {
  return {
    onOpenLink: vi.fn<() => void>(),
    onOpenFleet: vi.fn<() => void>(),
    onOpenNeeds: vi.fn<() => void>(),
    onOpenPalette: vi.fn<() => void>(),
    onOpenShortcuts: vi.fn<() => void>(),
    onOpenBuild: vi.fn<() => void>(),
  };
}

function bar(over: Partial<WorkbenchStatusBarProps> = {}) {
  const cb = callbacks();
  const props: WorkbenchStatusBarProps = {
    connected: true,
    sessions: 19,
    runs: 5,
    needYou: 0,
    exited: 0,
    build: { text: 'v1.4.2', warn: false },
    ...cb,
    ...over,
  };
  const view = render(<WorkbenchStatusBar {...props} />);
  const footer = screen.getByRole('contentinfo', { name: 'Fleet status' });
  return { cb, view, footer };
}

describe('the counts the bar formats', () => {
  it('says nothing needs you at zero, never 0 need you', () => {
    const { footer } = bar({ needYou: 0 });
    expect(within(footer).getByText('nothing needs you')).toBeTruthy();
    expect(footer.textContent).not.toMatch(/\b0 need/);
  });

  it('only the calm needs item may yield its words: at zero with nothing exited', () => {
    const needs = (f: HTMLElement): HTMLElement => f.querySelector('.wb-status-needs')!;
    const calm = bar();
    expect(needs(calm.footer).getAttribute('data-calm')).toBe('true');
    expect(within(needs(calm.footer)).getByText('nothing needs you').className).toBe('wb-status-text');
    cleanup();
    expect(needs(bar({ needYou: 2 }).footer).hasAttribute('data-calm')).toBe(false);
    cleanup();
    expect(needs(bar({ exited: 1 }).footer).hasAttribute('data-calm')).toBe(false);
  });

  it('counts what needs you, in the attention word', () => {
    const { footer } = bar({ needYou: 2 });
    const need = within(footer).getByText('2 need you');
    expect(need.classList.contains('wb-status-need')).toBe(true);
    expect(footer.textContent).not.toContain('nothing needs you');
  });

  it('uses plurals for many and zero', () => {
    const { footer } = bar({ sessions: 19, runs: 0 });
    expect(within(footer).getByText('19 sessions · 0 runs')).toBeTruthy();
  });

  it('uses singulars for one', () => {
    const { footer } = bar({ sessions: 1, runs: 1, exited: 1 });
    expect(within(footer).getByText('1 session · 1 run')).toBeTruthy();
    expect(within(footer).getByText('1 exited')).toBeTruthy();
  });

  it('shows the exited count only when there is one, in the dead word', () => {
    const none = bar({ exited: 0 });
    expect(none.footer.querySelector('.wb-status-exited')).toBeNull();
    expect(none.footer.textContent).not.toContain('exited');
    cleanup();
    const { footer } = bar({ needYou: 2, exited: 3 });
    const exited = within(footer).getByText('3 exited');
    expect(exited.classList.contains('wb-status-exited')).toBe(true);
    // the needs button reads both facts as one sentence, not a glued "you3"
    expect(within(footer).getByRole('button', { name: '2 need you, 3 exited' })).toBeTruthy();
  });
});

describe('the build line', () => {
  it('build warn rides data-warn, and only with warn set', () => {
    const quiet = bar({ build: { text: 'v1.4.2', warn: false } });
    expect(within(quiet.footer).getByText('v1.4.2').getAttribute('data-warn')).toBeNull();
    cleanup();
    const { footer } = bar({ build: { text: 'v1.4.2 → v1.4.3', warn: true } });
    expect(within(footer).getByText('v1.4.2 → v1.4.3').getAttribute('data-warn')).toBe('true');
  });

  it('marks a build line longer than its 11-character floor, and only that', () => {
    const short = bar({ build: { text: 'v1.4.2', warn: false } });
    expect(within(short.footer).getByRole('button', { name: 'v1.4.2' }).hasAttribute('data-long')).toBe(false);
    cleanup();
    const { footer } = bar({ build: { text: 'v1.4.2 → v1.4.3', warn: true } });
    expect(within(footer).getByRole('button', { name: 'v1.4.2 → v1.4.3' }).getAttribute('data-long')).toBe('true');
  });

  it('shows the build words it is given verbatim, and carries them as the hover title', () => {
    const { footer } = bar({ build: { text: 'unversioned (bd2bf57a)', warn: true } });
    const btn = within(footer).getByRole('button', { name: 'unversioned (bd2bf57a)' });
    expect(btn.getAttribute('title')).toBe('unversioned (bd2bf57a)');
  });
});

describe('the agent link: two cues, never colour alone', () => {
  it('connected: label, word and dot all say on', () => {
    const { footer } = bar({ connected: true });
    const link = within(footer).getByRole('button', { name: 'Agent link connected' });
    expect(link.querySelector('.wb-status-word')?.textContent).toBe('connected');
    expect(link.querySelector('.wb-status-word')?.getAttribute('data-link')).toBe('on');
    const dot = link.querySelector('.wb-status-dot');
    expect(dot?.getAttribute('data-link')).toBe('on');
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
  });

  it('offline: the word offline is written, not only the dot', () => {
    const { footer } = bar({ connected: false });
    const link = within(footer).getByRole('button', { name: 'Agent link offline' });
    const word = link.querySelector('.wb-status-word');
    expect(word?.textContent).toBe('offline');
    expect(word?.getAttribute('data-link')).toBe('off');
    expect(link.querySelector('.wb-status-dot')?.getAttribute('data-link')).toBe('off');
  });
});

describe('roles, names and keys', () => {
  it('is a footer labelled "Fleet status"', () => {
    const { footer } = bar();
    expect(footer.tagName).toBe('FOOTER');
    expect(footer.classList.contains('wb-status')).toBe(true);
  });

  it('every item is a named button and each callback fires', async () => {
    const user = userEvent.setup();
    const { cb, footer } = bar({ needYou: 2, exited: 1, build: { text: 'v1.4.2', warn: false } });
    const pairs: [string, keyof Callbacks][] = [
      ['Agent link connected', 'onOpenLink'],
      ['19 sessions · 5 runs', 'onOpenFleet'],
      ['2 need you, 1 exited', 'onOpenNeeds'],
      ['Command palette, ⌘K', 'onOpenPalette'],
      ['Keyboard shortcuts', 'onOpenShortcuts'],
      ['v1.4.2', 'onOpenBuild'],
    ];
    const buttons = within(footer).getAllByRole('button');
    expect(buttons).toHaveLength(pairs.length);
    for (const [name, key] of pairs) {
      const btn = within(footer).getByRole('button', { name });
      expect(btn.getAttribute('type')).toBe('button');
      await user.click(btn);
      expect(cb[key]).toHaveBeenCalledTimes(1);
    }
  });

  it('is reachable by keyboard in reading order, and Enter and Space activate', async () => {
    const user = userEvent.setup();
    const { cb } = bar();
    const order = [
      'Agent link connected', '19 sessions · 5 runs', 'nothing needs you',
      'Command palette, ⌘K', 'Keyboard shortcuts', 'v1.4.2',
    ];
    for (const name of order) {
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name }));
    }
    screen.getByRole('button', { name: 'Agent link connected' }).focus();
    await user.keyboard('{Enter}');
    expect(cb.onOpenLink).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Command palette, ⌘K' }).focus();
    await user.keyboard(' ');
    expect(cb.onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it('every item carries the focus ring and the shared hook', () => {
    const { footer } = bar();
    for (const btn of within(footer).getAllByRole('button')) {
      expect(btn.classList.contains('wb-status-item')).toBe(true);
      expect(btn.className).toMatch(/focus-visible:outline/);
    }
  });

  it('the separators and the palette glyph are hidden from assistive tech', () => {
    const { footer } = bar({ needYou: 1, exited: 1 });
    const seps = footer.querySelectorAll('.wb-status-sep');
    expect(seps.length).toBeGreaterThan(0);
    for (const s of seps) expect(s.getAttribute('aria-hidden')).toBe('true');
    const palette = within(footer).getByRole('button', { name: 'Command palette, ⌘K' });
    expect(palette.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('stamps each item with its part, which the narrow rules and the shrink order select', () => {
    const { footer } = bar();
    const parts = within(footer).getAllByRole('button').map((b) =>
      [...b.classList].find((c) => c.startsWith('wb-status-') && c !== 'wb-status-item'),
    );
    expect(parts).toEqual([
      'wb-status-link', 'wb-status-totals', 'wb-status-needs',
      'wb-status-palette', 'wb-status-keys', 'wb-status-build',
    ]);
  });
});

describe('the sheet', () => {
  // The part rules are written under `.wb-status` (0,2,0) and AFTER the item
  // rule: a bare `.wb-status-totals` (0,1,0) loses its min-width to the item's
  // own, and a bare `.wb-status-keys { display: none }` loses to the item's
  // `display: inline-flex` — the rule would exist and hide nothing.
  it('the totals are the item that shrinks first', () => {
    const totals = ruleIn(CSS, '.wb-status .wb-status-totals');
    expect(declValue(totals, 'flex')).toBe('0 1e12 auto');
    expect(declValue(totals, 'min-width')).toBe('calc(3ch + 12px)');
    expect(declValue(ruleIn(CSS, '.wb-status .wb-status-build'), 'flex')).toBe('0 1 auto');
    expect(CSS.indexOf('.wb-status .wb-status-totals')).toBeGreaterThan(CSS.lastIndexOf('.wb-status .wb-status-item {'));
  });

  // The hide steps read the BAR's width (a container query), never the
  // viewport's: a 480px viewport rule let the build line ellipsize at 560 while
  // `?` and "connected" still stood, which is the order inverted.
  it('the bar is its own container, and no hide step reads the viewport', () => {
    expect(declValue(ruleIn(CSS, '.wb-status'), 'container')).toBe('wb-status / inline-size');
    expect(CSS).not.toMatch(/@media\s*\(max-width/);
  });

  it('step 2: under 84ch the shortcuts and the word "connected" yield; "offline" never does', () => {
    const narrow = atBlock(CSS, '@container wb-status (max-width: 84ch)');
    expect(declValue(ruleIn(narrow, '.wb-status .wb-status-keys'), 'display')).toBe('none');
    expect(declValue(ruleIn(narrow, ".wb-status .wb-status-word[data-link='on']"), 'display')).toBe('none');
    expect(narrow).not.toMatch(/data-link=['"]?off/);
    expect(narrow).not.toMatch(/wb-status-(need|exited|build)/);
  });

  it('step 3: under 68ch the palette hint yields; under 54ch the build floor goes; the steps nest in that order', () => {
    expect(declValue(ruleIn(atBlock(CSS, '@container wb-status (max-width: 68ch)'), '.wb-status .wb-status-palette'), 'display')).toBe('none');
    expect(declValue(ruleIn(atBlock(CSS, '@container wb-status (max-width: 54ch)'), ".wb-status .wb-status-build[data-long='true']"), 'min-width')).toBe('0');
    const steps = [...CSS.matchAll(/@container wb-status \(max-width: (\d+)ch\)/g)].map((m) => Number(m[1]));
    expect(steps).toEqual([84, 68, 54]);
  });

  it('then the calm words yield before the build line, which keeps an 11-character floor', () => {
    const calm = ruleIn(CSS, ".wb-status .wb-status-needs[data-calm='true']");
    expect(declValue(calm, 'flex')).toBe('0 1e6 auto');
    expect(declValue(calm, 'min-width')).toBe('calc(8ch + 12px)');
    expect(declValue(ruleIn(CSS, ".wb-status .wb-status-build[data-long='true']"), 'min-width')).toBe('calc(11ch + 12px)');
  });

  it('is a self-grounded root: ink and ground on .wb-status', () => {
    const root = ruleIn(CSS, '.wb-status');
    expect(declValue(root, 'color')).toBe('var(--ink-tertiary)');
    expect(declValue(root, 'background')).toBe('var(--bg-surface)');
    expect(declValue(root, 'font-family')).toBe('var(--family-mono)');
    expect(declValue(root, 'font-size')).toBe('var(--fs-meta)');
  });

  it('tokens only: no literal colour, no --ink-disabled, no skin selector', () => {
    expect(CSS).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(CSS).not.toMatch(/\b(rgb|rgba|hsl|hsla|oklch|oklab)\(/i);
    expect(CSS).not.toContain('--ink-disabled');
    expect(CSS).not.toContain('data-skin');
  });

  it('glow means life: nothing on the bar glows or moves', () => {
    expect(CSS).not.toMatch(/box-shadow|filter\s*:|text-shadow/);
    expect(CSS).not.toMatch(/\b(animation|transition)\s*:/);
  });

  it('the tap floor holds by default; the 20px card size is only for a fine pointer', () => {
    expect(CSS).not.toMatch(/\b44px\b/);
    expect(declValue(ruleIn(CSS, '.wb-status .wb-status-item'), 'min-height')).toBe('var(--tap-min)');
    const fine = atBlock(CSS, '@media (pointer: fine)');
    expect(declValue(ruleIn(fine, '.wb-status .wb-status-item'), 'min-height')).toBe('20px');
    expect(declValue(ruleIn(fine, '.wb-status'), 'height')).toBe('24px');
  });

  it('every :hover is inside (hover: hover)', () => {
    const outside = CSS.replace(atBlock(CSS, '@media (hover: hover)'), '');
    expect(outside).not.toContain(':hover');
    expect(atBlock(CSS, '@media (hover: hover)')).toMatch(/\.wb-status-item:hover/);
  });

  it('counts use tabular figures', () => {
    expect(declValue(ruleIn(CSS, '.wb-status'), 'font-variant-numeric')).toBe('tabular-nums');
  });
});
