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
