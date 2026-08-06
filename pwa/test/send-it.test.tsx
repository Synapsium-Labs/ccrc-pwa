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

/** `draft` is the box row the server READ when it gave up — the correspondence
 *  claim `Send it` hands back, without which the button does not render. */
const failed = (patch: Partial<PendingSend> = {}): PendingSend => ({
  key: 'p1', text: 'run the tests', state: 'failed',
  error: "Typed it, but the session didn't take it.", code: 'enter-ignored',
  draft: 'run the tests',
  ...patch,
});

beforeEach(() => vi.restoreAllMocks());
afterEach(cleanup);

describe('Send it', () => {
  it('appears only for enter-ignored', () => {
    render(<ChatListInner id="s" events={[]} pending={[failed()]} />);
    expect(screen.getByRole('button', { name: 'Send it' })).toBeInTheDocument();
  });

  // Paired guards, not proof: both of these also pass against the pre-branch
  // code, where the button did not exist at all. They are kept because they
  // are what fails if the `code` branch is ever widened.
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

  // PR F whole-branch review, Critical. With nothing to correspond against
  // there is no way to know the box still holds THIS message rather than a
  // later one, and a tap would press Enter on whatever is there. The refusal
  // is to render the button, not to press hopefully. (The row is blank exactly
  // when the message's own first line was blank — `blank-first-row` on the
  // server.)
  it('is absent when the refusal carried no box row to correspond against', () => {
    for (const draft of [undefined, '', '   ']) {
      cleanup();
      render(<ChatListInner id="s" events={[]} pending={[failed({ draft })]} />);
      expect(screen.queryByRole('button', { name: 'Send it' }), String(draft)).toBeNull();
    }
  });

  it('POSTs /submit with the box row it was shown, and discards the pending once it lands', async () => {
    const submit = vi.spyOn(api, 'submit').mockResolvedValue(undefined);
    const onDiscard = vi.fn();
    render(<ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} />);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    // The second argument is the whole correspondence gate: the server refuses
    // unless the box still reads exactly this.
    await waitFor(() => expect(submit).toHaveBeenCalledWith('cc-a', 'run the tests'));
    // Discarded, not retried: the server proved OUR text was in the box and
    // then proved it left, so the message is in flight for real and the
    // transcript will carry it. Leaving the red bubble would show a failure
    // that has since succeeded.
    await waitFor(() => expect(onDiscard).toHaveBeenCalledWith('p1'));
  });

  // PR F whole-branch review, Critical. `nothing-to-submit` used to clear the
  // bubble and toast "it went through after all". The live sequence that makes
  // that a lie: this send left "run the tests" in the box; the operator sent
  // "check the logs", hit the draft-conflict sheet and tapped Replace draft,
  // which C-u'd the box and typed the new message; this bubble is still here.
  // Tapping it now finds an empty box — and "run the tests" was never sent,
  // exists nowhere, and the operator would have been told it landed.
  it('never reads an empty box as success — the bubble stays and the copy claims nothing', async () => {
    vi.spyOn(api, 'submit').mockRejectedValue(new ApiError(409, { error: 'nothing-to-submit' }));
    const onDiscard = vi.fn();
    render(<><ToastHost /><ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    expect(await screen.findByText(
      'The box is empty — nothing was sent from here. Check the transcript before sending again.',
    )).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('says so when the box has been taken over by another message', async () => {
    vi.spyOn(api, 'submit').mockRejectedValue(new ApiError(409, { error: 'box-mismatch' }));
    const onDiscard = vi.fn();
    render(<><ToastHost /><ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    expect(await screen.findByText(
      'The box holds something else now — open the session and look before sending.',
    )).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it('keeps the bubble and says why when the rescue is refused', async () => {
    vi.spyOn(api, 'submit').mockRejectedValue(new ApiError(409, { error: 'dialog-open' }));
    const onDiscard = vi.fn();
    render(<><ToastHost /><ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    expect(await screen.findByText('A question is up — answer that first.')).toBeInTheDocument();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  // PR F whole-branch review, Important 5. A non-ApiError rejection (the phone
  // lost the network, ccrc-server is restarting) has no code, and
  // `submitErrorText('')` is the empty string — which ToastHost renders as a
  // wordless red alert that vanishes in 4.2 s, leaving the tap's outcome
  // entirely unstated.
  it('says something when the rescue never leaves the phone', async () => {
    vi.spyOn(api, 'submit').mockRejectedValue(new TypeError('Failed to fetch'));
    const onDiscard = vi.fn();
    render(<><ToastHost /><ChatListInner id="cc-a" events={[]} pending={[failed()]} onDiscard={onDiscard} /></>);
    await userEvent.click(screen.getByRole('button', { name: 'Send it' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent?.trim()).toBe('Failed to fetch');
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
