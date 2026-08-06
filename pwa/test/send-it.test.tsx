// The rescue for `enter-ignored`: the server proved our text reached the input
// box and then watched both of its Enters get swallowed, so it left the text
// there. Before this button the only remedy the UI offered was a sentence
// telling the operator to open a terminal and press one key.
import { afterEach, describe, expect, it, vi, beforeEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatListInner } from '../src/session/ChatList';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import type { PendingSend } from '../src/stores/session';

const failed = (patch: Partial<PendingSend> = {}): PendingSend => ({
  key: 'p1', text: 'run the tests', state: 'failed',
  error: "Typed it, but the session didn't take it.", code: 'enter-ignored',
  ...patch,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('Send it', () => {
  it('appears only for enter-ignored', () => {
    render(<ChatListInner id="s" events={[]} pending={[failed()]} />);
    expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
  });

  it('is absent for every other failure, where there is nothing to submit', () => {
    for (const code of ['dialog-open', 'verify-failed', 'not-alive', 'draft-clear-failed']) {
      cleanup();
      render(<ChatListInner id="s" events={[]} pending={[failed({ code, error: 'nope' })]} />);
      expect(screen.queryByRole('button', { name: 'Send it' }), code).toBeNull();
    }
  });

  it('is absent when the failure carries no code at all (an offline throw)', () => {
    render(<ChatListInner id="s" events={[]} pending={[failed({ code: undefined, error: 'Failed to fetch' })]} />);
    expect(screen.queryByRole('button', { name: 'Send it' })).toBeNull();
  });

  it('POSTs /submit and discards the pending once it lands', async () => {
    const submit = vi.spyOn(api, 'submit').mockResolvedValue(undefined);
    const onDiscard = vi.fn();
    render(<ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    await waitFor(() => expect(submit).toHaveBeenCalledWith('cc-a'));
    // Discarded, not retried: the message is in flight for real now, and the
    // transcript will carry it. Leaving the red bubble would show a failure
    // that has since succeeded.
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith('p1'));
  });

  it('treats nothing-to-submit as good news and clears the bubble', async () => {
    vi.spyOn(api, 'submit').mockRejectedValue(new ApiError(409, { error: 'nothing-to-submit' }));
    const onDiscard = vi.fn();
    render(<><ToastHost /><ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    // The box turned out to be empty, which means it went through after all.
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText('The box is empty — it went through after all.')).toBeInTheDocument();
  });

  it('keeps the bubble and says why when the rescue is refused', async () => {
    vi.spyOn(api, 'submit').mockRejectedValue(new ApiError(409, { error: 'dialog-open' }));
    const onDiscard = vi.fn();
    render(<><ToastHost /><ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    expect(await screen.findByText('A question is up — answer that first.')).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('disables itself while the Enter is in flight, so one tap is one Enter', async () => {
    let release: () => void = () => {};
    vi.spyOn(api, 'submit').mockImplementation(
      () => new Promise<void>((r) => { release = r; }),
    );
    render(<ChatListInner id="cc-a" events={[]} pending={[failed()]} />);
    const btn = screen.getByRole('button', { name: 'Send it' });
    await userEvent.click(btn);
    await waitFor(() => expect(btn).toBeDisabled());
    release();
  });
});
