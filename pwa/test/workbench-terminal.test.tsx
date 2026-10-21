// WorkbenchTerminal — the session's pane as a tab of its own: the bar (name,
// attach state, the view switch), the pane the app hands in, and on a phone the
// dock above the soft keyboard (key row, shortcut chips, the input line), or,
// on a session that cannot take input, the reason and the one way back.
// Neutral fixtures only. The component draws; every word that states app
// behaviour (attach word, reason, action, placeholder, hint) arrives as a prop.
//
// MUTATION TABLE (measured, 2026-10-20; "before" = the guard deleted, "after" =
// restored):
//   - the latch's branch in the key click (latch → onLatchChange, never onKey)
//     replaced by a plain `onKey(k.id)`: "the latch …" red (onLatchChange not
//     called, onKey called with 'ctrl'); restored green.
//   - `onPointerDown={keep}` removed from the key: "a tap never takes focus"
//     red (pointerdown not defaultPrevented); restored green.
//   - the read-only branch removed (keys always drawn): both "read-only" cases
//     red (a toolbar found; extra buttons); restored green.
//   - the toolbar's arrow-key handler removed: "the key row is one tab stop"
//     red (focus stays on the first key); restored green.
//   - the keys' hover-ink override removed: "the keys keep on-well ink under
//     the mouse" red; restored green.
//   - the split hide removed from the sheet: "CSS: Split leaves under 560px"
//     red; restored green.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import {
  WorkbenchTerminal,
  type WorkbenchKey,
  type WorkbenchTerminalProps,
} from '@ccrc/ui';
import { atBlock, declValue, ruleIn, stripComments } from './cssRule';

afterEach(cleanup);

const KEYS: WorkbenchKey[] = [
  { id: 'esc', legend: 'esc', label: 'Escape' },
  { id: 'ctrl', legend: 'ctrl', label: 'Ctrl, latches for the next key', latch: true },
  { id: 'ctrl-c', legend: '^C', label: 'Control C' },
  { id: 'tab', legend: 'tab', label: 'Tab' },
];
const SHORTS = ['/compact', 'y', '1'];

function draw(over: Partial<WorkbenchTerminalProps> = {}) {
  const props: WorkbenchTerminalProps = {
    paneId: 'feature-x',
    attached: true,
    attachWord: 'attached',
    view: 'terminal',
    onViewChange: vi.fn(),
    layout: 'phone',
    keys: KEYS,
    latched: false,
    onLatchChange: vi.fn(),
    onKey: vi.fn(),
    shortcuts: SHORTS,
    onShortcut: vi.fn(),
    draft: '',
    onDraftChange: vi.fn(),
    onSend: vi.fn(),
    placeholder: 'Type here',
    children: <pre>$ npm test</pre>,
    ...over,
  };
  const view = render(<WorkbenchTerminal {...props} />);
  return { props, ...view };
}

describe('the bar', () => {
  it('names the pane `terminal · <id>` and labels the region with it', () => {
    draw();
    expect(screen.getByText('terminal · feature-x')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'terminal · feature-x' })).toBeTruthy();
  });

  it('the attach state is a word and a dot — two cues, the word from the app', () => {
    const { container, rerender, props } = draw({ attached: false, attachWord: 'not running' });
    const attach = container.querySelector('.wb-term-attach');
    expect(attach?.textContent).toBe('not running');
    expect(attach?.getAttribute('data-attached')).toBe('false');
    expect(attach?.querySelector('.wb-term-dot')?.getAttribute('aria-hidden')).toBe('true');
    rerender(<WorkbenchTerminal {...props} attached attachWord="attached" />);
    expect(container.querySelector('.wb-term-attach')?.getAttribute('data-attached')).toBe('true');
  });

  it('the view switch is a group of three aria-pressed buttons', () => {
    const { props } = draw({ view: 'chat' });
    const group = screen.getByRole('group', { name: 'View' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Terminal', 'Chat', 'Split']);
    expect(buttons.map((b) => b.getAttribute('aria-pressed'))).toEqual(['false', 'true', 'false']);
    expect(buttons[2]?.getAttribute('data-view')).toBe('split');
    fireEvent.click(buttons[2]!);
    expect(props.onViewChange).toHaveBeenCalledWith('split');
  });
});

describe('the pane', () => {
  it('is focusable so a keyboard can reach and scroll it, and holds the children', () => {
    const { container } = draw();
    const pane = container.querySelector('.wb-term-pane');
    expect(pane?.getAttribute('tabindex')).toBe('0');
    expect(pane?.textContent).toBe('$ npm test');
  });
});

describe('desktop and phone', () => {
  it('desktop: the hint under the pane, and no dock', () => {
    draw({ layout: 'desktop', hint: 'typing goes to the pane' });
    expect(screen.getByText('typing goes to the pane')).toBeTruthy();
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('phone: the dock, and no hint', () => {
    draw({ layout: 'phone', hint: 'typing goes to the pane' });
    expect(screen.queryByText('typing goes to the pane')).toBeNull();
    expect(screen.getAllByRole('toolbar').map((t) => t.getAttribute('aria-label')))
      .toEqual(['Terminal keys', 'Shortcuts']);
  });
});

describe('the key row', () => {
  it('every key is named in words, its legend a hidden picture', () => {
    draw();
    const esc = screen.getByRole('button', { name: 'Escape' });
    const legend = esc.querySelector('span');
    expect(legend?.textContent).toBe('esc');
    expect(legend?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('button', { name: 'Control C' })).toBeTruthy();
  });

  it('a sequence key calls onKey(id) and carries no aria-pressed', () => {
    const { props } = draw();
    const key = screen.getByRole('button', { name: 'Control C' });
    expect(key.hasAttribute('aria-pressed')).toBe(false);
    fireEvent.click(key);
    expect(props.onKey).toHaveBeenCalledWith('ctrl-c');
  });

  it('the latch: aria-pressed, flips through onLatchChange and sends no byte', () => {
    const { props, rerender } = draw({ latched: false });
    const ctrl = screen.getByRole('button', { name: 'Ctrl, latches for the next key' });
    expect(ctrl.getAttribute('aria-pressed')).toBe('false');
    expect(ctrl.className).toContain('wb-term-latch');
    fireEvent.click(ctrl);
    expect(props.onLatchChange).toHaveBeenCalledWith(true);
    expect(props.onKey).not.toHaveBeenCalled();
    rerender(<WorkbenchTerminal {...props} latched />);
    const pressed = screen.getByRole('button', { name: 'Ctrl, latches for the next key' });
    expect(pressed.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(pressed);
    expect(props.onLatchChange).toHaveBeenLastCalledWith(false);
    expect(props.onKey).not.toHaveBeenCalled();
  });

  it('a tap never takes focus from the line: pointerdown is defaultPrevented on keys, chips and Send', () => {
    draw();
    for (const name of ['Escape', 'Ctrl, latches for the next key', 'Type /compact', 'Send to the pane']) {
      const notPrevented = fireEvent.pointerDown(screen.getByRole('button', { name }));
      expect(notPrevented, name).toBe(false);
    }
  });

  it('the key row is one tab stop: arrows move, Home/End jump, focus follows', () => {
    draw();
    const bar = screen.getByRole('toolbar', { name: 'Terminal keys' });
    const keys = within(bar).getAllByRole('button');
    expect(keys.map((k) => k.tabIndex)).toEqual([0, -1, -1, -1]);
    keys[0]!.focus();
    fireEvent.keyDown(keys[0]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(keys[1]);
    expect(keys.map((k) => k.tabIndex)).toEqual([-1, 0, -1, -1]);
    fireEvent.keyDown(keys[1]!, { key: 'End' });
    expect(document.activeElement).toBe(keys[3]);
    fireEvent.keyDown(keys[3]!, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(keys[0]);   // wraps
    fireEvent.keyDown(keys[0]!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(keys[3]);
    fireEvent.keyDown(keys[3]!, { key: 'Home' });
    expect(document.activeElement).toBe(keys[0]);
  });

  it('the keys keep on-well ink under the mouse (Keycap hovers to ink-primary, which the well cannot carry)', () => {
    const { rerender, props } = draw();
    const esc = screen.getByRole('button', { name: 'Escape' });
    expect(esc.className).toContain('enabled:hover:text-ink-on-well');
    expect(esc.className).not.toContain('enabled:hover:text-ink-primary');
    rerender(<WorkbenchTerminal {...props} latched />);
    // The latched key is inverted: its legend is the well's colour, hovered too.
    const ctrl = screen.getByRole('button', { name: 'Ctrl, latches for the next key' });
    expect(ctrl.className).toContain('enabled:hover:text-well');
    expect(ctrl.className).not.toContain('enabled:hover:text-ink-primary');
  });
});

describe('the shortcut row', () => {
  it('each chip is a named button that calls onShortcut with its text', () => {
    const { props } = draw();
    const bar = screen.getByRole('toolbar', { name: 'Shortcuts' });
    const chips = within(bar).getAllByRole('button');
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual(['Type /compact', 'Type y', 'Type 1']);
    expect(chips.map((c) => c.tabIndex)).toEqual([0, -1, -1]);
    fireEvent.click(chips[1]!);
    expect(props.onShortcut).toHaveBeenCalledWith('y');
  });
});

describe('the input line', () => {
  it('typing reports the draft; Enter and Send both send', () => {
    const { props } = draw({ draft: 'ls' });
    const input = screen.getByRole('textbox', { name: 'Type to the pane' }) as HTMLInputElement;
    expect(input.value).toBe('ls');
    expect(input.placeholder).toBe('Type here');
    fireEvent.change(input, { target: { value: 'ls -la' } });
    expect(props.onDraftChange).toHaveBeenCalledWith('ls -la');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(props.onSend).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Send to the pane' }));
    expect(props.onSend).toHaveBeenCalledTimes(2);
  });

  it('Enter while composing (an IME) does not send', () => {
    const { props } = draw();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter', isComposing: true });
    expect(props.onSend).not.toHaveBeenCalled();
  });
});

describe('read-only', () => {
  it('shows no keys and no shortcuts, a disabled line described by the reason, and the way back', () => {
    const onClick = vi.fn();
    const { container } = draw({
      attached: false,
      attachWord: 'not running',
      readOnly: { reason: 'Stopped, so input is off.', action: { label: 'Restart session', onClick } },
    });
    expect(screen.queryByRole('toolbar')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Escape' })).toBeNull();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    expect(input.disabled).toBe(true);
    const why = document.getElementById(input.getAttribute('aria-describedby') ?? '');
    expect(why?.textContent).toBe('Stopped, so input is off.');
    expect(why?.className).toContain('wb-term-why');
    expect(screen.queryByRole('button', { name: 'Send to the pane' })).toBeNull();
    const back = screen.getByRole('button', { name: 'Restart session' });
    fireEvent.click(back);
    expect(onClick).toHaveBeenCalled();
    // The way back sits on the well: on-well ink, never the page's ink-primary.
    expect(back.className).toContain('text-ink-on-well');
    expect(back.className).not.toMatch(/(^|\s)text-ink-primary(\s|$)/);
    expect(container.querySelector('.wb-term')?.getAttribute('data-readonly')).toBe('true');
    expect(container.querySelector('.wb-term-pane')?.getAttribute('data-readonly')).toBe('true');
  });

  it('read-only with no action: the line, and nothing in Send\'s place', () => {
    draw({ readOnly: { reason: 'Stopped.' } });
    expect(screen.getByRole('textbox')).toHaveProperty('disabled', true);
    expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Terminal', 'Chat', 'Split']);
  });
});

describe('the sheet', () => {
  const css = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-terminal.css'), 'utf8');
  const src = readFileSync(
    path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'components', 'workbench-terminal.tsx'), 'utf8');
  const decls = stripComments(css);

  it('CSS: the phone field is --fs-input (16px, so iOS never zooms)', () => {
    expect(declValue(ruleIn(css, '.wb-term-input'), 'font-size')).toBe('var(--fs-input)');
  });

  it('CSS: Split leaves under 560px, by a container query on the tab', () => {
    expect(declValue(ruleIn(css, '.wb-term'), 'container-type')).toBe('inline-size');
    const block = atBlock(css, '@container (max-width: 559px)');
    expect(declValue(ruleIn(block, ".wb-term-view[data-view='split']"), 'display')).toBe('none');
  });

  it('CSS: every on-well mix is mixed down to the well or its bar, never to transparent', () => {
    const mixes = [...decls.matchAll(/color-mix\(\s*in srgb\s*,[^,]+,\s*([^)]+\)?)\s*\)/g)].map((m) => m[1]!.trim());
    expect(mixes.length).toBeGreaterThan(5);
    for (const ground of mixes) expect(['var(--bg-well)', 'var(--well-bar-bg)']).toContain(ground);
    expect(decls).not.toMatch(/transparent/);
  });

  it('CSS: glow means life — no outer shadow, no opacity fade, no motion to reduce', () => {
    for (const m of decls.matchAll(/box-shadow\s*:\s*([^;]+);/g)) expect(m[1]).toMatch(/^inset\b/);
    expect(decls).not.toMatch(/(^|[^-])opacity\s*:/);
    expect(decls).not.toMatch(/\b(transition|animation)\s*:/);
    expect(decls).not.toMatch(/@keyframes/);
  });

  it('CSS: tap floor from the token, never a literal 44px', () => {
    expect(decls).not.toMatch(/\b44px\b/);
    expect(declValue(ruleIn(css, '.wb-term-short'), 'min-height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.wb-term-short'), 'min-width')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.wb-term-send'), 'width')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.wb-term-send'), 'height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.wb-term-input'), 'height')).toBe('var(--tap-min)');
    expect(declValue(ruleIn(css, '.wb-term-bar .wb-term-view'), 'min-height')).toBe('var(--tap-min)');
  });

  it('CSS: every :hover sits inside (hover: hover)', () => {
    const outside = decls.replace(/@media \(hover: hover\)\s*\{(?:[^{}]|\{[^{}]*\})*\}/g, '');
    expect(outside).not.toMatch(/:hover/);
  });

  it('the pane is never called "tmux", and no skin is named', () => {
    expect(css).not.toMatch(/tmux/i);
    expect(src).not.toMatch(/tmux/i);
    expect(css).not.toMatch(/data-skin/);
    expect(src).not.toMatch(/data-skin/);
  });
});
