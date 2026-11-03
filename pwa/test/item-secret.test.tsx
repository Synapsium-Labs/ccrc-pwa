// The item view's secret panel (programme ledgers plan PL6, spec §5): a password field held in the panel's state only, sent
// once to its own route through the step-up, cleared after saving and when the page is hidden, and disabled with its
// sentence when the box's sign-in is not armed. The route is a stub here (`saveSecret`), and so is the step-up's box.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { createApi } from '../src/lib/api';
import { ItemView, SECRET_TEXT, type SaveSecret } from '../src/ledgers/ItemView';
import { SECRET_TAIL_MIN, SECRET_VALUE_MAX, type SecretSaveAnswer } from '../../shared/ledgers';
import type { StepUpDeps } from '../src/accounts/useStepUp';
import type { AuthStatus } from '../../shared/api';
import { api } from '../src/lib/api';
import { NOW, itemView } from './ledgersFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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
const answer = (over: Partial<SecretSaveAnswer['secret']> = {}): SecretSaveAnswer =>
  ({ ok: true, secret: { setAt: NOW, tail: '6789', masked: true, ...over }, item: secretItem({ state: 'checking' }) });

/** What the box says of its sign-in (`readAuthStatus`): armed, unless a test says otherwise. */
const ARMED = async (): Promise<Partial<AuthStatus>> => ({ authed: true, mode: 'passphrase', passkeysEnrolled: 0 });
/** Renders the item; for an open secret item, waits until the panel has read the box's sign-in and opened its field. */
const show = async (saveSecret: SaveSecret, item = secretItem(), authStatus = ARMED) => {
  const view = render(<ItemView item={item} onTick={vi.fn(async () => {})} onDismiss={vi.fn(async () => {})} programmeLive={true} now={NOW}
                   saveSecret={saveSecret} stepUpDeps={stepUpDeps} authStatus={authStatus} />);
  if (item.state === 'open') await waitFor(() => expect(field().disabled).toBe(false));
  return view;
};
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
  it('is a password field that does not autocomplete, and Save waits for a value; there is no Mark done', async () => {
    await show(vi.fn());
    expect(field().type).toBe('password');
    expect(field().getAttribute('autocomplete')).toBe('off');
    expect(saveButton().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Mark done' })).toBeNull();
  });

  it('the field clears after saving and on page hide', async () => {
    const save = vi.fn<SaveSecret>(async () => answer());
    await show(save);
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

  it('disabled with the sign-in sentence when a save is refused auth-off or insecure-origin (the fallback)', async () => {
    for (const word of ['auth-off', 'insecure-origin']) {
      const save = vi.fn<SaveSecret>(async () => { throw refuse(403, word); });
      await show(save);
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
    await show(save);
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
    await show(vi.fn<SaveSecret>(async () => answer({ tail: '', masked: false, why: 'too-short' })));
    fireEvent.change(field(), { target: { value: 'Short-Key-12' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByText(SECRET_TEXT.unmasked['too-short'])).toBeTruthy();
  });

  it('a refusal is a fixed sentence, never the box\'s text, and the value stays to try again', async () => {
    await show(vi.fn<SaveSecret>(async () => { throw new ApiError(503, { ok: false, error: 'write-failed', detail: 'BOX-TEXT' }, 'application/json'); }));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', "The box couldn't store that, so nothing was sent to the coordinator. Try again.");
    expect(document.body.textContent).not.toContain('BOX-TEXT');
    expect(field().value).toBe(VALUE);
  });

  it('a checking secret item shows the slot\'s state from the server, and never the answer it ticked with', async () => {
    await show(vi.fn(), secretItem({ state: 'checking', answer: 'set 2026-11-03T09:00:00.000Z ending ab12', secretSet: { at: NOW, tail: 'ab12', masked: false, why: 'unregistered' } }));
    expect(screen.queryByLabelText(SECRET_TEXT.label)).toBeNull();
    expect(screen.getByText('Saved. Ends in ab12.')).toBeTruthy();
    expect(screen.getByText(SECRET_TEXT.unmasked.unregistered)).toBeTruthy();
    expect(document.body.textContent).not.toContain('2026-11-03T09');
  });

  it('the value is never written to browser storage', async () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem');
    await show(vi.fn<SaveSecret>(async () => answer()));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(field().value).toBe(''));
    expect(setItem.mock.calls.filter((c) => c.some((a) => String(a).includes(VALUE)))).toEqual([]);
  });

  it('on a box whose sign-in is off the field is disabled from the first render, with its sentence, and nothing is sent (review 1389 A9)', async () => {
    const save = vi.fn<SaveSecret>(async () => answer());
    const status = vi.fn(async (): Promise<Partial<AuthStatus>> => ({ authed: false, mode: 'off', passkeysEnrolled: 0 }));
    render(<ItemView item={secretItem()} onTick={vi.fn(async () => {})} onDismiss={vi.fn(async () => {})} programmeLive={true} now={NOW}
                     saveSecret={save} stepUpDeps={stepUpDeps} authStatus={status} />);
    expect(field().disabled).toBe(true);
    expect(await screen.findByText(SECRET_TEXT.signInOff)).toBeTruthy();
    expect(field().disabled).toBe(true);
    expect(saveButton().disabled).toBe(true);
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(status).toHaveBeenCalledTimes(1);
    expect(save).not.toHaveBeenCalled();
  });

  it('a box that cannot say its sign-in (an older server) opens the field, and the refusal stays the fallback', async () => {
    await show(vi.fn<SaveSecret>(async () => answer()), secretItem(), async () => { throw new Error('auth status 404'); });
    expect(field().disabled).toBe(false);
  });

  it('the hint says one line, and names the last four characters only for a long enough secret (review 1389 F4, A8)', async () => {
    await show(vi.fn());
    expect(SECRET_TEXT.hint).toMatch(/single line/);
    expect(SECRET_TEXT.hint).toContain(`${SECRET_TAIL_MIN} characters`);
    expect(screen.getByText(SECRET_TEXT.hint)).toBeTruthy();
  });

  it('the bound counts the trimmed value: spaces around a value of the full length still save it (review 1389 A8)', async () => {
    const save = vi.fn<SaveSecret>(async () => answer());
    await show(save);
    expect(field().getAttribute('maxlength')).toBeNull();
    const full = 'k'.repeat(SECRET_VALUE_MAX);
    fireEvent.change(field(), { target: { value: `   ${full}  ` } });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    await waitFor(() => expect(save).toHaveBeenCalledWith(secretItem().id, full));
    fireEvent.change(field(), { target: { value: `${full}k` } });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByText(SECRET_TEXT.tooLong)).toBeTruthy();
  });

  it('stored-not-ticked says the secret is kept and the item is not done (review 1389 F3)', async () => {
    await show(vi.fn<SaveSecret>(async () => { throw refuse(503, 'stored-not-ticked'); }));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'The secret is stored, but the item was not marked done. Refresh and try again.');
  });

  it('with no saveSecret given, the panel saves through api.saveItemSecret (review 1389 F5)', async () => {
    const spy = vi.spyOn(api, 'saveItemSecret').mockImplementation(async () => answer());
    render(<ItemView item={secretItem()} onTick={vi.fn(async () => {})} onDismiss={vi.fn(async () => {})} programmeLive={true} now={NOW}
                     stepUpDeps={stepUpDeps} authStatus={ARMED} />);
    await waitFor(() => expect(field().disabled).toBe(false));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    await waitFor(() => expect(spy).toHaveBeenCalledWith(secretItem().id, VALUE));
  });
});

describe('api.saveItemSecret (the console client call)', () => {
  it('PUTs the value in the body only, to the item\'s own route, and answers the slot\'s state', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = createApi((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      return new Response(JSON.stringify(answer()), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    const got = await client.saveItemSecret(7, VALUE);
    expect(got.secret).toEqual({ setAt: NOW, tail: '6789', masked: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('/api/items/7/secret');
    expect(calls[0]!.url).not.toContain(VALUE);
    expect(calls[0]!.init?.method).toBe('PUT');
    expect(calls[0]!.init?.body).toBe(JSON.stringify({ value: VALUE }));
    expect(new Headers(calls[0]!.init?.headers).get('content-type')).toBe('application/json');
  });

  it('a refusal rejects with the route\'s ApiError, its word in the body', async () => {
    const client = createApi((async () =>
      new Response(JSON.stringify({ ok: false, error: 'step-up-required' }), { status: 403, headers: { 'content-type': 'application/json' } })) as typeof fetch);
    const err = await client.saveItemSecret(7, VALUE).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).body).toEqual({ ok: false, error: 'step-up-required' });
  });
});
