// The item view's secret panel (programme ledgers plan PL6, spec §5): a password field held in the panel's state only, sent
// once to its own route through the step-up, cleared after saving and when the page is hidden, and disabled with its
// sentence when the box's sign-in is not armed. The route is a stub here (`saveSecret`), and so is the step-up's box.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '../src/lib/apiError';
import { createApi } from '../src/lib/api';
import { ItemView, SECRET_TEXT, STORED_TEXT, type RemoveSecret, type SaveSecret } from '../src/ledgers/ItemView';
import { SECRET_TAIL_MIN, SECRET_VALUE_MAX, type SecretSaveAnswer } from '../../shared/ledgers';
import { LEDGER_ROUTE_REFUSALS } from '../../shared/refusal';
import { LEDGER_REFUSAL_TEXT } from '../src/lib/refusalWords';
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

  it('disabled with its own sentence when a save is refused auth-off or insecure-origin (the fallback; review 1391 A-7)', async () => {
    for (const [word, sentence] of [['auth-off', SECRET_TEXT.signInOff], ['insecure-origin', SECRET_TEXT.insecureOrigin]] as const) {
      const save = vi.fn<SaveSecret>(async () => { throw refuse(403, word); });
      await show(save);
      fireEvent.change(field(), { target: { value: VALUE } });
      fireEvent.click(saveButton());
      expect(await screen.findByText(sentence)).toBeTruthy();
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

  it('the hint says one line, and names the last four characters only for a secret of SECRET_TAIL_MIN BYTES that is masked (review 1391 F2, F3)', async () => {
    await show(vi.fn());
    expect(SECRET_TEXT.hint).toMatch(/single line/);
    expect(SECRET_TEXT.hint).toContain(`at least ${SECRET_TAIL_MIN} bytes`);
    expect(SECRET_TEXT.hint).not.toMatch(/\d+ characters/);
    expect(SECRET_TEXT.hint).toMatch(/outgoing text will mask it/);
    expect(SECRET_TEXT.tooLong).toContain(`${SECRET_VALUE_MAX} bytes`);
    expect(screen.getByText(SECRET_TEXT.hint)).toBeTruthy();
  });

  it('the too-long line is part of the field\'s description and is announced (review 1391 A-6)', async () => {
    await show(vi.fn());
    fireEvent.change(field(), { target: { value: 'k'.repeat(SECRET_VALUE_MAX + 1) } });
    const line = screen.getByText(SECRET_TEXT.tooLong);
    expect(line.getAttribute('role')).toBe('alert');
    expect(field().getAttribute('aria-describedby')!.split(' ')).toContain(line.id);
  });

  it('a value the masker cannot catch as one run says so, and shows no tail (review 1391 F2)', async () => {
    await show(vi.fn<SaveSecret>(async () => answer({ tail: '', masked: false, why: 'not-one-run' })));
    fireEvent.change(field(), { target: { value: 'pass phrase with spaces 0123' } });
    fireEvent.click(saveButton());
    expect(await screen.findByText('Saved.')).toBeTruthy();
    expect(screen.getByText(SECRET_TEXT.unmasked['not-one-run'])).toBeTruthy();
  });

  it('a value with a line break the server refused reads its one-line sentence (programme item 8)', async () => {
    await show(vi.fn<SaveSecret>(async () => { throw refuse(400, LEDGER_ROUTE_REFUSALS.secretNotOneLine); }));
    fireEvent.change(field(), { target: { value: VALUE } });
    fireEvent.click(saveButton());
    expect(await screen.findByRole('alert')).toHaveProperty('textContent', LEDGER_REFUSAL_TEXT['secret-not-one-line']);
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

describe('a stored secret shows "Stored" with Remove (the operator\'s ruling on programme item 9)', () => {
  const stored = (over: Parameters<typeof itemView>[0] = {}) =>
    secretItem({ state: 'confirmed' as never, secretSet: { at: NOW, tail: 'ab12', masked: true }, ...over });
  const showStored = (removeSecret: RemoveSecret, item = stored()) =>
    render(<ItemView item={item} onTick={vi.fn(async () => {})} onDismiss={vi.fn(async () => {})} programmeLive={true} now={NOW}
                     saveSecret={vi.fn()} removeSecret={removeSecret} stepUpDeps={stepUpDeps} authStatus={ARMED} />);
  const removeButton = (): HTMLButtonElement => screen.getByRole('button', { name: STORED_TEXT.removeLabel('api-key') }) as HTMLButtonElement;

  it('while its slot is stored, the item says Stored with a Remove control; with nothing stored there is neither', () => {
    showStored(vi.fn());
    expect(screen.getByText(STORED_TEXT.stored)).toBeTruthy();
    expect(removeButton()).toBeTruthy();
    // The block carries the class its styles are scoped to (review 1418 A3): a rename would leave every .wi-stored rule dead.
    expect(screen.getByText(STORED_TEXT.stored).closest('.wi-stored')).not.toBeNull();
    expect(removeButton().closest('.wi-stored .wi-stored-remove')).not.toBeNull();
    cleanup();
    showStored(vi.fn(), stored({ secretSet: null }));
    expect(screen.queryByText(STORED_TEXT.stored)).toBeNull();
    expect(screen.queryByRole('button', { name: STORED_TEXT.removeLabel('api-key') })).toBeNull();
  });

  it('a slot that holds a value with no readable record is stored all the same: Stored and Remove, no saved line (review 1416 F4)', () => {
    for (const state of ['open', 'checking', 'confirmed'] as const) {
      showStored(vi.fn(), stored({ state: state as never, secretSet: { at: null, tail: '' } }));
      expect(screen.getByText(STORED_TEXT.stored), state).toBeTruthy();
      expect(removeButton(), state).toBeTruthy();
      // No saved line of any shape, and no masking sentence: nothing is known of when or how.
      expect(screen.queryByText(/^Saved\./), state).toBeNull();
      expect(document.querySelector('[data-secret="unmasked"]'), state).toBeNull();
      cleanup();
    }
  });

  it('a slot the box cannot read says so: never Stored, never Remove, never the field to give a secret (review 1418 F2)', () => {
    for (const state of ['open', 'checking', 'confirmed'] as const) {
      showStored(vi.fn(), stored({ state: state as never, secretSet: { unreadable: true } }));
      const line = document.querySelector('[data-secret="unreadable"]');
      expect(line?.textContent, state).toBe(LEDGER_REFUSAL_TEXT['secrets-unreadable']);
      expect(screen.queryByText(STORED_TEXT.stored), state).toBeNull();
      expect(screen.queryByRole('button', { name: STORED_TEXT.removeLabel('api-key') }), state).toBeNull();
      expect(screen.queryByLabelText(SECRET_TEXT.label), state).toBeNull();
      expect(screen.queryByRole('button', { name: SECRET_TEXT.save }), state).toBeNull();
      expect(screen.queryByText(/^Saved\./), state).toBeNull();
      cleanup();
    }
  });

  it('Remove asks first: Cancel removes nothing; the confirm removes the item\'s slot once and says Removed', async () => {
    const remove = vi.fn<RemoveSecret>(async (_p, slot) => ({ ok: true, slot }));
    showStored(remove);
    fireEvent.click(removeButton());
    expect(await screen.findByText(STORED_TEXT.confirmTitle('api-key'))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(remove).not.toHaveBeenCalled();
    fireEvent.click(removeButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === STORED_TEXT.remove)!);
    await waitFor(() => expect(remove).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith('prog-a', 'api-key');
    expect(await screen.findByText(STORED_TEXT.removed)).toBeTruthy();
    // No part of a value is on the page: not the tail the slot's record carries.
    expect(document.body.textContent).not.toContain('ab12');
  });

  it('a refused Remove reads its fixed sentence and the control stays; secret-not-stored counts as removed', async () => {
    showStored(vi.fn<RemoveSecret>(async () => { throw new ApiError(503, { ok: false, error: 'remove-failed', detail: 'BOX-TEXT' }, 'application/json'); }));
    fireEvent.click(removeButton());
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(Array.from(dialog.querySelectorAll('button')).find((b) => b.textContent === STORED_TEXT.remove)!);
    expect(await screen.findByText(LEDGER_REFUSAL_TEXT['remove-failed'])).toBeTruthy();
    expect(document.body.textContent).not.toContain('BOX-TEXT');
    expect(removeButton()).toBeTruthy();
    cleanup();
    showStored(vi.fn<RemoveSecret>(async () => { throw refuse(404, 'secret-not-stored'); }));
    fireEvent.click(removeButton());
    const again = await screen.findByRole('dialog');
    fireEvent.click(Array.from(again.querySelectorAll('button')).find((b) => b.textContent === STORED_TEXT.remove)!);
    expect(await screen.findByText(STORED_TEXT.removed)).toBeTruthy();
  });
});

describe('api.storedSecrets and api.removeStoredSecret (the console client calls)', () => {
  it('reads the programme\'s stored secrets, and DELETEs one slot with no body', async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const client = createApi((async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      const body = init?.method === 'DELETE' ? { ok: true, slot: 'api-key' } : { ok: true, program: 'prog-a', slots: [] };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch);
    expect(await client.storedSecrets('prog-a')).toEqual({ ok: true, program: 'prog-a', slots: [] });
    expect(await client.removeStoredSecret('prog-a', 'api-key')).toEqual({ ok: true, slot: 'api-key' });
    expect(calls.map((c) => [c.init?.method ?? 'GET', c.url])).toEqual([['GET', '/api/programmes/prog-a/secrets'], ['DELETE', '/api/programmes/prog-a/secrets/api-key']]);
    expect(calls[1]!.init?.body).toBeUndefined();
  });
});
