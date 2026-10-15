// `OptionRow`'s two API decisions that a type cannot express, pinned.
//
// Both are deliberate and both are foot-guns if they drift, because neither
// shows up as a type error and neither looks wrong in a diff:
//
//   1. `onClick` decides the ELEMENT. Present -> <button disabled>; absent ->
//      <div aria-disabled>. That single prop therefore chooses focusability,
//      the disabled spelling, and the screen-reader role all at once — which
//      is right for the five call sites (a row with no handler is genuinely
//      not interactive) but means `onClick={ready ? go : undefined}` silently
//      produces a div where a disabled button was meant. Nothing else reds.
//   2. `marker` and `enter` share one trailing slot and `marker` wins.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { OptionRow } from '@ccrc/ui';

afterEach(cleanup);

describe('onClick decides the element, not just the behaviour', () => {
  it('a row WITH a handler is a real button, focusable and disable-able', () => {
    render(<OptionRow label="Allow once" onClick={() => {}} />);
    const el = screen.getByRole('button', { name: /allow once/i });
    expect(el.tagName).toBe('BUTTON');
    expect(el.hasAttribute('aria-disabled')).toBe(false);
  });

  it('a disabled row with a handler stays a button — a div cannot be :disabled', () => {
    // The moved CSS leans on this: its own comment records that `:disabled`
    // matches a real form control and nothing else, so a div here would lose
    // the dimmed state silently.
    render(<OptionRow label="Allow once" onClick={() => {}} disabled />);
    const el = screen.getByRole('button', { name: /allow once/i, hidden: true });
    expect(el.tagName).toBe('BUTTON');
    expect((el as HTMLButtonElement).disabled).toBe(true);
  });

  it('a row WITHOUT a handler is a non-interactive div', () => {
    render(<OptionRow label="Answer this one in the terminal" />);
    expect(screen.queryByRole('button')).toBeNull();
    const el = screen.getByText('Answer this one in the terminal').closest('.opt');
    expect(el?.tagName).toBe('DIV');
  });
});

describe('the trailing slot holds one mark', () => {
  it('marker wins when both are passed, rather than rendering two', () => {
    render(
      <OptionRow
        label="gpt"
        onClick={() => {}}
        enter="●"
        marker={<span data-testid="app-marker">inert on this lane</span>}
      />,
    );
    expect(screen.getByTestId('app-marker')).toBeInTheDocument();
    expect(document.querySelector('.opt-enter')).toBeNull();
  });

  it('the primitive mark renders when the app supplies none', () => {
    render(<OptionRow label="gpt" onClick={() => {}} enter="●" />);
    expect(document.querySelector('.opt-enter')?.textContent).toBe('●');
  });
});

// D-5091 (plan docs/superpowers/plans/2026-10-15-ask-sheet-half.md, Task 4): a multiSelect AskUserQuestion question is
// answered as boxes, and a box is still the design system's row. `checked` defined makes the row a checkbox, for a
// screen reader as much as for the eye: the role and its state on the element itself, and the box drawn in the glyph
// column as decoration (the column is aria-hidden, as the cursor is).
describe('checked makes the row a checkbox: role, aria-checked, and the box in the glyph column', () => {
  // The box is DRAWN, not a character: a ☑/☐ glyph rendered about 8px of ink in the 14px column, in the same accent
  // ink ticked or not, so the state was a speck (measured at 390 and 1920 in both themes). The box is an 18px frame;
  // ticked, it fills with the accent and carries a tick in the ink made for the accent (`--ink-on-accent`).
  const box = (el: HTMLElement): Element | null => el.querySelector('.opt-glyph[data-box]');

  it('a ticked row with a handler is a checkbox button, checked, with the ticked box drawn in the glyph column', () => {
    render(<OptionRow label="Logging" index={1} checked onClick={() => {}} />);
    const el = screen.getByRole('checkbox', { name: /Logging/ });
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('aria-checked', 'true');
    const drawn = box(el);
    expect(drawn).toHaveAttribute('data-box', 'ticked');
    expect(drawn).toHaveAttribute('aria-hidden', 'true');
    expect(drawn?.querySelector('svg rect'), 'the frame').not.toBeNull();
    expect(drawn?.querySelector('svg path'), 'the tick').not.toBeNull();
    expect(drawn?.textContent, 'a character, not a drawing').toBe('');
  });

  it('an unticked row is a checkbox too, unchecked, with the empty frame', () => {
    render(<OptionRow label="Metrics" index={2} checked={false} onClick={() => {}} />);
    const el = screen.getByRole('checkbox', { name: /Metrics/ });
    expect(el).toHaveAttribute('aria-checked', 'false');
    const drawn = box(el);
    expect(drawn).toHaveAttribute('data-box', 'clear');
    expect(drawn?.querySelector('svg rect')).not.toBeNull();
    expect(drawn?.querySelector('svg path'), 'an unticked box carries no tick').toBeNull();
  });

  it('the stylesheet tells ticked from clear by fill, and dims both when the row is disabled', () => {
    const css = readFileSync(path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'primitives', 'option-row.css'), 'utf8');
    const decls = (selector: string): string => {
      const at = css.indexOf(`${selector} {`);
      expect(at, selector).toBeGreaterThan(-1);
      return css.slice(at, css.indexOf('}', at));
    };
    expect(decls(".opt-glyph[data-box] rect")).toMatch(/fill:\s*none/);
    expect(decls(".opt-glyph[data-box] rect")).toMatch(/stroke:\s*var\(--ink-secondary\)/);
    expect(decls(".opt-glyph[data-box='ticked'] rect")).toMatch(/fill:\s*var\(--accent\)/);
    expect(decls(".opt-glyph[data-box] path")).toMatch(/stroke:\s*var\(--ink-on-accent\)/);
    expect(css).toMatch(/\.opt\[aria-disabled='true'\] \.opt-glyph\[data-box='ticked'\] rect[^{]*\{[^}]*fill:\s*var\(--ink-disabled\)/);
  });

  it('a read-only box is a non-interactive div that still says whether it is ticked', () => {
    render(<OptionRow label="Tracing" checked disabled />);
    const el = screen.getByRole('checkbox', { name: /Tracing/ });
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveAttribute('aria-checked', 'true');
    expect(el).toHaveAttribute('aria-disabled', 'true');
  });

  it('a glyph the caller passes keeps the column, and no box is drawn', () => {
    render(<OptionRow label="Hammer" glyph="❯" checked onClick={() => {}} />);
    const el = screen.getByRole('checkbox', { name: /Hammer/ });
    expect(el.querySelector('.opt-glyph')?.textContent).toBe('❯');
    expect(box(el)).toBeNull();
  });

  it('CONTROL: without checked the row is no checkbox and draws no box', () => {
    render(<OptionRow label="Allow once" onClick={() => {}} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    const el = screen.getByRole('button', { name: /allow once/i });
    expect(el.hasAttribute('aria-checked')).toBe(false);
    expect(el.querySelector('.opt-glyph')).toBeNull();
  });
});
