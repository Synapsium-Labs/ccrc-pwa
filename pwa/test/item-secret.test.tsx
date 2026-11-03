// The item view's secret panel (programme ledgers plan PL6, spec §5): a password field held in the panel's state only, sent
// once to its own route through the step-up, cleared after saving and when the page is hidden, and disabled with its
// sentence when the box's sign-in is not armed. The route is a stub here (`saveSecret`), and so is the step-up's box.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { ItemView, SECRET_TEXT, type SaveSecret, type SecretSaved } from '../src/ledgers/ItemView';
import type { StepUpDeps } from '../src/accounts/useStepUp';
import { NOW, itemView } from './ledgersFixture';

afterEach(cleanup);

const VALUE = 'fixture-secret-value-0123456789';
const stepUpDeps: StepUpDeps = {
  client: {
    stepUpStart: async () => ({ challengeB64url: 'AQID', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] }),
    stepUpFinish: async () => { throw new Error('no passkey in this test'); },
    stepUpPassphrase: async () => ({ ok: true, stepUpFreshUntil: Date.now() + 300_000 }),
  } as unknown as NonNullable<StepUpDeps['client']>,
};
const secretItem = (over: Parameters<typeof itemView>[0] = {}) =>
  itemView({ kind: 'secret', title: 'Give the service key', secretSlot: 'api-key', ...over });
const answer = (over: Partial<SecretSaved['secret']> = {}): SecretSaved =>
  ({ ok: true, secret: { setAt: NOW, tail: '6789', masked: true, ...over }, item: secretItem({ state: 'checking' }) });

const show = (saveSecret: SaveSecret, item = secretItem()) =>
  render(<ItemView item={item} onTick={vi.fn(async () => {})} onDismiss={vi.fn(async () => {})} programmeLive={true} now={NOW}
                   saveSecret={saveSecret} stepUpDeps={stepUpDeps} />);
const field = (): HTMLInputElement => screen.getByLabelText(SECRET_TEXT.label);
const saveButton = (): HTMLButtonElement => screen.getByRole('button', { name: SECRET_TEXT.save }) as HTMLButtonElement;
const refuse = (status: number, error: string): ApiError => new ApiError(status, { ok: false, error }, 'application/json');
const hidePage = (): void => {
  const real = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  try {
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  } finally {
    delete (document as unknown as Record<string, unknown>)['visibilityState'];
    if (real) Object.defineProperty(Document.prototype, 'visibilityState', real);
  }
};

describe('the secret panel (plan PL6)', () => {
  it('is a password field that does not autocomplete, and Save waits for a value; there is no Mark done', () => {
    show(vi.fn());
    expect(field().type).toBe('password');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('the field clears after saving and on page hide', async () => {
    const save = vi.fn<SaveSecret>(async () => answer());
    show(save);
    fireEvent.change(field(), { target: { value: `  ${VALUE}\n` } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(save).toHaveBeenCalledWith(secretItem().id, VALUE); // trimmed at both ends, sent once
    await waitFor(() => expect(field().value).toBe(''));
    expect(screen.getByText('Saved. Ends in 6789.')).toBeTruthy();
    // …and a value typed and left waits in no backgrounded page.
    fireEvent.change(field(), { target: { value: VALUE } });
    expect(field().value).toBe(VALUE);
    hidePage();
    expect(field().value).toBe('');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('disabled with the sign-in sentence when the gate answers auth-off', async () => {
    for (const word of ['auth-off', 'insecure-origin']) {
      const save = vi.fn<SaveSecret>(async () => { throw refuse(403, word); });
      show(save);
      fireEvent.change(field(), { target: { value: VALUE } });
      fireEvent.click(saveButton());
      expect(await screen.findByText(SECRET_TEXT.signInOff)).toBeTruthy();
      expect(field().disabled, word).toBe(true);
      expect(field().value, word).toBe('');
      expect(saveButton().disabled, word).toBe(true);
      cleanup();
    }
  });

  it('a save refused step-up-required shows "Confirm it\'s you", keeps the value, and does not retry by itself', async () => {
    let refused = true;
    const save = vi.fn<SaveSecret>(async () => { if (refused) throw refuse(403, 'step-up-required'); return answer(); });
    show(save);
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    expect(await screen.findByText(/Changing a secret needs a fresh check/)).toBeTruthy();
    expect(field().value).toBe(VALUE);
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a test passphrase' } });
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(screen.queryByText(/needs a fresh check/)).toBeNull());
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(field().value).toBe(''));
  });

  it('a short secret says it is not masked, in plain words, and shows no tail (Review Focus 2)', async () => {
    show(vi.fn<SaveSecret>(async () => answer({ tail: '', masked: false, why: 'too-short' })));
    fireEvent.change(field(), { target: { value: 'Short-Key-12' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByText(SECRET_TEXT.unmasked['too-short'])).toBeTruthy();
  });

  it('a refusal is a fixed sentence, never the box\'s text, and the value stays to try again', async () => {
    show(vi.fn<SaveSecret>(async () => { throw new ApiError(503, { ok: false, error: 'write-failed', detail: 'BOX-TEXT' }, 'application/json'); }));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "The box couldn't store that, so nothing was sent to the coordinator. Try again.");
    expect(document.body.textContent).not.toContain('BOX-TEXT');
    expect(field().value).toBe(VALUE);
  });

  it('a checking secret item shows the slot\'s state from the server, and never the answer it ticked with', () => {
    show(vi.fn(), secretItem({ state: 'checking', answer: 'set 2026-11-03T09:00:00.000Z ending ab12', secretSet: { at: NOW, tail: 'ab12', masked: false, why: 'unregistered' } }));
    expect(screen.queryByLabelText(SECRET_TEXT.label)).toBeNull();
    expect(screen.getByText('Saved. Ends in ab12.')).toBeTruthy();
    expect(screen.getByText(SECRET_TEXT.unmasked.unregistered)).toBeTruthy();
    expect(document.body.textContent).not.toContain('2026-11-03T09');
  });

  it('the value is never written to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    show(vi.fn<SaveSecret>(async () => answer()));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(field().value).toBe(''));
    expect(setItem.mock.calls.filter((c) => c.some((a) => String(a).includes(VALUE)))).toEqual([]);
  });
});
