// The `Popover` primitive (D-5934): Radix's popover in the Phosphor & Ink
// chrome. It shares the dismissable layer, focus scope and portal that vaul
// already brings in, so dismissal is Radix's one mechanism, never a second
// hand-rolled one. Escape and an outside press close it, and focus goes back
// to the trigger, because a popover has a real trigger to go back to.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Popover, PopoverContent, PopoverTrigger } from '@ccrc/ui';

afterEach(cleanup);

function Fixture(): React.ReactElement {
  return (
    <div data-testid="host">
      <button type="button">elsewhere</button>
      <Popover>
        <PopoverTrigger>agent actions</PopoverTrigger>
        <PopoverContent aria-label="agent actions">
          <button type="button">Skip agent</button>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Radix arms its outside-press listener on a zero timeout after opening. */
const settle = (): Promise<void> => act(() => new Promise<void>((r) => { setTimeout(r, 0); }));

describe('Popover', () => {
  it('opens from its trigger', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    expect(screen.queryByRole('dialog', { name: 'agent actions' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'agent actions' }));
    expect(screen.getByRole('dialog', { name: 'agent actions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'agent actions' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('Escape closes and focus returns to the trigger', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    const trigger = screen.getByRole('button', { name: 'agent actions' });
    await user.click(trigger);
    await settle();
    // Focus moves into the content on open, so the return below is a real move.
    expect(screen.getByRole('dialog', { name: 'agent actions' }).contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await settle();
    expect(screen.queryByRole('dialog', { name: 'agent actions' })).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('an outside press closes', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'agent actions' }));
    await settle();
    expect(screen.getByRole('dialog', { name: 'agent actions' })).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'elsewhere' }));
    await settle();
    expect(screen.queryByRole('dialog', { name: 'agent actions' })).toBeNull();
  });

  it('its content is in a portal on `shadow-pop`', async () => {
    const user = userEvent.setup();
    render(<Fixture />);
    await user.click(screen.getByRole('button', { name: 'agent actions' }));
    const content = screen.getByRole('dialog', { name: 'agent actions' });
    // In a portal: outside the tree that rendered it, so no ancestor's
    // overflow or stacking context clips it.
    expect(screen.getByTestId('host').contains(content)).toBe(false);
    const classes = content.className.split(/\s+/);
    expect(classes).toContain('shadow-pop');
    expect(classes).not.toContain('shadow-sheet');
    expect(classes).toContain('bg-sheet');
    expect(classes).toContain('rounded-lg');
  });

  it('`shadow-pop` is a theme utility, so the class draws a shadow (D-6019)', () => {
    // Tailwind emits CSS only for a `--shadow-*` key in the theme: an
    // unmapped `shadow-pop` passes the class check above and draws nothing.
    const theme = readFileSync(
      path.join(import.meta.dirname, '..', '..', 'ui', 'src', 'styles', 'theme.css'), 'utf8',
    );
    expect(theme).toMatch(/^\s*--shadow-pop:\s*var\(--elev-[a-z]+\);/m);
  });
});
