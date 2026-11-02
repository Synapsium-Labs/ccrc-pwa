// The item view (desktop-polish PL5a, D-7712; spec §2 and §3, view 3 of the prototype, minus the secret panel, which is
// PL6). `ItemView` takes `{item, onTick, onDismiss, programmeLive}`; a refused tick comes back as an `ApiError` the
// panel puts in the operator's words, and the button stays enabled so the operator can try again.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { ItemView } from '../src/ledgers/ItemView';
import { MIN, NOW, itemView } from './ledgersFixture';

afterEach(cleanup);

const show = (item = itemView(), over: Partial<React.ComponentProps<typeof ItemView>> = {}) => {
  const onTick = vi.fn(async () => {});
  const onDismiss = vi.fn(async () => {});
  render(<ItemView item={item} onTick={onTick} onDismiss={onDismiss} programmeLive={true} now={NOW} {...over} />);
  return { onTick, onDismiss };
};

describe('the item view', () => {
  it('shows what, why and the how as numbered steps', () => {
    show(itemView({ title: 'Flip the lane', why: 'Old workspaces pile up.', how: ['Open Settings.', 'Set it to Live.'] }));
    expect(screen.getByRole('heading', { name: 'Flip the lane' })).toBeTruthy();
    expect(screen.getByText('Old workspaces pile up.')).toBeTruthy();
    const steps = within(screen.getByRole('list', { name: 'How' })).getAllByRole('listitem');
    expect(steps.map((s) => s.textContent)).toEqual(['Open Settings.', 'Set it to Live.']);
  });

  it('the Decide panel posts the chosen option', async () => {
    const { onTick } = show(itemView({ kind: 'decide', options: ['Library first', 'Keep the order'] }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true); // nothing chosen yet: no accidental decision
    fireEvent.click(screen.getByRole('radio', { name: 'Keep the order' }));
    fireEvent.click(done);
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Keep the order'));
  });

  it('a Decide item with no options takes a typed answer', async () => {
    const { onTick } = show(itemView({ kind: 'decide', options: null }));
    fireEvent.change(screen.getByRole('textbox', { name: /your answer/i }), { target: { value: 'Yes, ship it' } });
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('Yes, ship it'));
  });

  it('Give a value posts the typed value', async () => {
    const { onTick } = show(itemView({ kind: 'value', title: 'Review rounds' }));
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    expect(done.disabled).toBe(true);
    fireEvent.change(screen.getByRole('textbox', { name: /your value/i }), { target: { value: '4' } });
    fireEvent.click(done);
    await waitFor(() => expect(onTick).toHaveBeenCalledWith('4'));
  });

  it('Do posts no answer', async () => {
    const { onTick } = show(itemView({ kind: 'do' }));
    fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
    await waitFor(() => expect(onTick).toHaveBeenCalledTimes(1));
    expect(onTick).toHaveBeenCalledWith();
  });

  it('a refused tick shows the refusal sentence and leaves the button enabled', async () => {
    const onTick = vi.fn(async () => { throw new ApiError(409, { ok: false, error: 'programme-ended' }); });
    show(itemView({ kind: 'do' }), { onTick });
    const done = screen.getByRole('button', { name: 'Mark done' }) as HTMLButtonElement;
    fireEvent.click(done);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/no open run|dismiss/i);
    expect(done.disabled).toBe(false);
  });

  it('every refusal the tick and dismiss routes name has a sentence, not a bare slug', async () => {
    for (const code of ['programme-ended', 'programme-unclaimed', 'not-open', 'duplicate', 'programme-live', 'use-secret-route']) {
      const onTick = vi.fn(async () => { throw new ApiError(409, { ok: false, error: code }); });
      show(itemView({ kind: 'do' }), { onTick });
      fireEvent.click(screen.getByRole('button', { name: 'Mark done' }));
      const alert = await screen.findByRole('alert');
      expect(alert.textContent, code).not.toBe(code);
      expect(alert.textContent!.length, code).toBeGreaterThan(20);
      cleanup();
    }
  });

  it('a checking item reads Checking… and offers no second tick', () => {
    show(itemView({ state: 'checking', tickedAt: NOW - 2 * MIN }));
    expect(screen.getByText(/Checking…/)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('a stale checking item says the coordinator is not responding', () => {
    show(itemView({ state: 'checking', stale: true, tickedAt: NOW - 50 * MIN }));
    expect(screen.getByText(/ticked; coordinator not responding/)).toBeTruthy();
  });

  it('shows a sent-back note as history, never as the current state', () => {
    show(itemView({
      note: 'Settings still shows record only.',
      history: [
        { at: NOW - 3 * 60 * MIN, act: 'raise', note: null }, { at: NOW - 2 * 60 * MIN, act: 'tick', note: null },
        { at: NOW - 60 * MIN, act: 'return', note: 'Settings still shows record only.' },
      ],
    }));
    expect(screen.getByText(/sent back: Settings still shows record only\./)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Mark done' })).toBeTruthy(); // it is open again
  });

  it('Dismiss is offered only while the programme has no open run', async () => {
    const { onDismiss } = show(itemView(), { programmeLive: false });
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    await waitFor(() => expect(onDismiss).toHaveBeenCalledTimes(1));
    cleanup();
    show(itemView(), { programmeLive: true });
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('a secret item has no input and no tick here (the paste panel is a later wave)', () => {
    show(itemView({ kind: 'secret', title: 'Paste the publish token', secretSlot: 'npm-token' }));
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(document.querySelector('input[type="password"]')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('never renders the answer of a secret item', () => {
    show(itemView({ kind: 'secret', state: 'checking', answer: 'set 1800 ending ab12' }));
    expect(document.body.textContent).not.toMatch(/ending ab12/);
  });
});
