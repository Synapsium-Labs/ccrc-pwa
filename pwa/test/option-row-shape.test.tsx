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
  it('a ticked row with a handler is a checkbox button, checked, with the ticked box in the glyph column', () => {
    render(<OptionRow label="Logging" index={1} checked onClick={() => {}} />);
    const el = screen.getByRole('checkbox', { name: /Logging/ });
    expect(el.tagName).toBe('BUTTON');
    expect(el).toHaveAttribute('aria-checked', 'true');
    const glyph = el.querySelector('.opt-glyph');
    expect(glyph?.textContent).toBe('☑');
    expect(glyph).toHaveAttribute('aria-hidden', 'true');
  });

  it('an unticked row is a checkbox too, unchecked, with the empty box', () => {
    render(<OptionRow label="Metrics" index={2} checked={false} onClick={() => {}} />);
    const el = screen.getByRole('checkbox', { name: /Metrics/ });
    expect(el).toHaveAttribute('aria-checked', 'false');
    expect(el.querySelector('.opt-glyph')?.textContent).toBe('☐');
  });

  it('a read-only box is a non-interactive div that still says whether it is ticked', () => {
    render(<OptionRow label="Tracing" checked disabled />);
    const el = screen.getByRole('checkbox', { name: /Tracing/ });
    expect(el.tagName).toBe('DIV');
    expect(el).toHaveAttribute('aria-checked', 'true');
    expect(el).toHaveAttribute('aria-disabled', 'true');
  });

  it('a glyph the caller passes keeps the column', () => {
    render(<OptionRow label="Hammer" glyph="❯" checked onClick={() => {}} />);
    expect(screen.getByRole('checkbox', { name: /Hammer/ }).querySelector('.opt-glyph')?.textContent).toBe('❯');
  });

  it('CONTROL: without checked the row is no checkbox and draws no box', () => {
    render(<OptionRow label="Allow once" onClick={() => {}} />);
    expect(screen.queryByRole('checkbox')).toBeNull();
    const el = screen.getByRole('button', { name: /allow once/i });
    expect(el.hasAttribute('aria-checked')).toBe(false);
    expect(el.querySelector('.opt-glyph')).toBeNull();
  });
});
