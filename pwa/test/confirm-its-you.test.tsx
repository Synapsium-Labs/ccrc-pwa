// "Confirm it's you" (D-5512, spec §3.2; accounts plan Task A6; D-5690).
//
// THE SEAMS, and the failure each one exists to prevent:
//
//   1. THE USER ACTIVATION. iOS Safari refuses `navigator.credentials.get` once an `await` has run between the tap
//      and the call: the activation is spent. So the challenge is fetched when the button is first SHOWN, and the
//      tap calls `get` synchronously, inside the click handler. The fake authenticator below records whether the
//      click handler was still on the stack when `get` ran.
//   2. NO RETRY. A step-up is a credential proof, and the act after it puts, replaces or deletes a credential.
//      The sheet never re-sends either by itself: an act refused `step-up-required` shows the button again and
//      waits for the operator.
//   3. THE PASSPHRASE IS A SECRET. It lives in the component's own state, is cleared on submit and on hide, and
//      never reaches a store.
//   4. THE LOCK. `step-up-locked` reads its sentence and offers no button: a button the server will refuse is a
//      trap.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { ConfirmItsYou, LOCKED_TEXT } from '../src/accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../src/accounts/useStepUp';
import { ApiError, createApi } from '../src/lib/api';
import { toB64url, type CredentialsApi } from '../src/lib/passkey';

const json = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  });

const b64 = (bytes: number[]): string => toB64url(new Uint8Array(bytes).buffer);
const CHALLENGE = b64([1, 2, 3, 4]);
const CRED_ID = b64([9, 9, 9]);

interface Box {
  fetch: ReturnType<typeof vi.fn>;
  calls: () => string[];
  bodies: (path: string) => unknown[];
}

/** A fake box: `start` answers with a challenge (and the enrolled ids `ids`), `finish` and `passphrase` answer
 *  with `answer` (a status and body), every other path 404s. */
const fakeBox = (opts: {
  ids?: string[];
  start?: () => Response;
  answer?: () => Response;
} = {}): Box => {
  const fetchImpl = vi.fn(async (path: string, _init?: RequestInit): Promise<Response> => {
    if (path === '/api/auth/step-up/start') {
      return opts.start?.() ?? json(200, { challengeB64url: CHALLENGE, rpId: 'box.example.invalid', allowCredentialIdsB64url: opts.ids ?? [CRED_ID] });
    }
    if (path === '/api/auth/step-up/finish' || path === '/api/auth/step-up/passphrase') {
      return opts.answer?.() ?? json(200, { ok: true, stepUpFreshUntil: Date.now() + 300_000 });
    }
    return json(404, { ok: false, error: 'not-found' });
  });
  return {
    fetch: fetchImpl,
    calls: () => fetchImpl.mock.calls.map((c) => c[0] as string),
    bodies: (path) => fetchImpl.mock.calls.filter((c) => c[0] === path)
      .map((c) => JSON.parse(String((c[1] as RequestInit | undefined)?.body ?? 'null'))),
  };
};

/** A fake authenticator. `inClick` is true while a click handler is on the stack, so `syncCalls` counts the `get`
 *  calls made before any `await` in the handler. */
let inClick = false;
const fakeAuthenticator = (): CredentialsApi & { syncCalls: number; calls: number; options: CredentialRequestOptions[] } => {
  const self = {
    syncCalls: 0,
    calls: 0,
    options: [] as CredentialRequestOptions[],
    create: vi.fn(async () => null),
    get: async (o: CredentialRequestOptions): Promise<Credential | null> => {
      self.calls += 1;
      if (inClick) self.syncCalls += 1;
      self.options.push(o);
      return {
        id: CRED_ID, type: 'public-key',
        rawId: new Uint8Array([9, 9, 9]).buffer,
        response: {
          authenticatorData: new Uint8Array([5]).buffer,
          clientDataJSON: new Uint8Array([6]).buffer,
          signature: new Uint8Array([7]).buffer,
        },
      } as unknown as Credential;
    },
  };
  return self;
};

/** Clicks with `inClick` raised for exactly the synchronous part of the handler. */
const tap = (el: HTMLElement): void => {
  inClick = true;
  try {
    fireEvent.click(el);
  } finally {
    inClick = false;
  }
};

/** The fixture sheet: the step, then the act it guards. `act` is the caller's act; the sheet runs it through
 *  `stepUp.runAct`, exactly as an account sheet does. */
function Sheet({ freshUntil, deps, act: actFn }: {
  freshUntil: number | null; deps: StepUpDeps; act?: () => Promise<void>;
}): ReactNode {
  const stepUp = useStepUp(freshUntil, deps);
  const [done, setDone] = useState('');
  return (
    <div>
      <ConfirmItsYou stepUp={stepUp} />
      {!stepUp.needed && actFn !== undefined && (
        <button type="button" onClick={() => void stepUp.runAct(actFn).then((r) => setDone(r))}>Remove</button>
      )}
      <p data-testid="done">{done}</p>
    </div>
  );
}

const confirmButton = (): HTMLElement => screen.getByRole('button', { name: /confirm it.s you/i });

beforeEach(() => {
  vi.useRealTimers();
  vi.stubGlobal('PublicKeyCredential', class {});
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('Confirm it\'s you (D-5512, spec §3.2)', () => {
  it('the tap calls `credentials.get` synchronously, with a challenge fetched before the tap', async () => {
    const box = fakeBox();
    const auth = fakeAuthenticator();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    // The challenge is fetched when the button is SHOWN: before any tap.
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(box.calls()).toEqual(['/api/auth/step-up/start']);
    expect(auth.calls).toBe(0);

    tap(confirmButton());
    // `get` ran while the click handler was still on the stack, and no fetch ran between the tap and it.
    expect(auth.syncCalls).toBe(1);
    expect(box.calls()).toEqual(['/api/auth/step-up/start']);
    const pk = auth.options[0]!.publicKey!;
    expect(toB64url((pk.challenge as Uint8Array).buffer as ArrayBuffer)).toBe(CHALLENGE);
    expect(pk.rpId).toBe('box.example.invalid');
    expect(pk.userVerification).toBe('required');

    // The assertion reaches /finish, and the stamp hides the step.
    await waitFor(() => expect(screen.queryByRole('button', { name: /confirm it.s you/i })).toBeNull());
    expect(box.bodies('/api/auth/step-up/finish')).toEqual([{
      credentialIdB64url: CRED_ID,
      authenticatorDataB64url: b64([5]),
      clientDataJsonB64url: b64([6]),
      signatureB64url: b64([7]),
    }]);
  });

  it('it is not shown while the stamp is fresh', async () => {
    const box = fakeBox();
    render(<Sheet freshUntil={Date.now() + 60_000} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    expect(screen.queryByRole('button', { name: /confirm it.s you/i })).toBeNull();
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
    // And no challenge is spent on a step nobody needs.
    await act(async () => { await Promise.resolve(); });
    expect(box.calls()).toEqual([]);
  });

  it('a `step-up-required` on the act shows the button again, and nothing is retried', async () => {
    const box = fakeBox();
    const auth = fakeAuthenticator();
    const actFn = vi.fn(async () => { throw new ApiError(403, { ok: false, error: 'step-up-required' }); });
    // Fresh as far as the screen knows: the stamp lapsed on the server between the read and the act.
    render(<Sheet freshUntil={Date.now() + 60_000} act={actFn}
      deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(screen.getByTestId('done').textContent).toBe('step-up');
    expect(actFn).toHaveBeenCalledTimes(1);

    // The operator confirms. The act is NOT re-sent: they press it again themselves.
    tap(confirmButton());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Remove' })).toBeTruthy());
    await act(async () => { await new Promise((r) => setTimeout(r, 20)); });
    expect(actFn).toHaveBeenCalledTimes(1);
    expect(box.calls().filter((p) => p === '/api/auth/step-up/finish')).toHaveLength(1);
  });

  it('a refused confirmation is not retried either: it says so, and offers the button with a new challenge', async () => {
    let n = 0;
    const box = fakeBox({ answer: () => json(403, { ok: false, error: 'step-up-required', verdict: 'wrong' }) });
    const auth = fakeAuthenticator();
    box.fetch.mockImplementationOnce(async () => {
      n += 1;
      return json(200, { challengeB64url: CHALLENGE, rpId: 'box.example.invalid', allowCredentialIdsB64url: [CRED_ID] });
    });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/didn.t confirm/i));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(n).toBe(1);
    // One finish, and a second start for the next tap: a challenge is single-use.
    expect(box.calls()).toEqual(['/api/auth/step-up/start', '/api/auth/step-up/finish', '/api/auth/step-up/start']);
    expect(auth.calls).toBe(1);
  });

  it('with no passkey enrolled it shows the passphrase field, and the field is cleared on submit and on hide', async () => {
    const box = fakeBox({ ids: [], answer: () => json(403, { ok: false, error: 'step-up-required', verdict: 'wrong' }) });
    const auth = fakeAuthenticator();
    const deps = { client: createApi(box.fetch as unknown as typeof fetch), credentials: auth };
    render(<Sheet freshUntil={null} deps={deps} />);
    const field = await screen.findByLabelText(/passphrase/i) as HTMLInputElement;
    expect(field.type).toBe('password');
    expect(screen.queryByRole('button', { name: /confirm it.s you/i })).toBeNull();

    // On submit: cleared at once, before the answer.
    fireEvent.change(field, { target: { value: 'pass-one' } });
    fireEvent.submit(field.closest('form')!);
    expect(field.value).toBe('');
    await waitFor(() => expect(box.bodies('/api/auth/step-up/passphrase')).toEqual([{ passphrase: 'pass-one' }]));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/wrong passphrase/i));
    expect(auth.calls).toBe(0);

    // On hide: the page going to the background clears it.
    fireEvent.change(field, { target: { value: 'pass-two' } });
    expect(field.value).toBe('pass-two');
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      fireEvent(document, new Event('visibilitychange'));
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    }
    expect(field.value).toBe('');
  });

  it('`step-up-locked` reads its sentence and offers no button', async () => {
    const box = fakeBox({ start: () => json(429, { ok: false, error: 'step-up-locked' }) });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(screen.getByText(LOCKED_TEXT)).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
  });

  it('`step-up-locked` from the confirmation itself locks too, with no button', async () => {
    const box = fakeBox({ answer: () => json(429, { ok: false, error: 'step-up-locked' }) });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    await waitFor(() => expect(screen.getByText(LOCKED_TEXT)).toBeTruthy());
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('a held challenge is replaced before the box would expire it (D-5690)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const box = fakeBox();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(box.calls()).toEqual(['/api/auth/step-up/start']);
    await act(async () => { await vi.advanceTimersByTimeAsync(91_000); });
    await waitFor(() => expect(box.calls()).toEqual(['/api/auth/step-up/start', '/api/auth/step-up/start']));
  });

  it('the stamp lapsing on its own shows the step again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const box = fakeBox();
    render(<Sheet freshUntil={Date.now() + 1_000} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    expect(screen.queryByRole('button', { name: /confirm it.s you/i })).toBeNull();
    await act(async () => { await vi.advanceTimersByTimeAsync(1_100); });
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  });

  it('a browser with no passkey support, on a box with passkeys, says so and offers no dead button', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined);
    const box = fakeBox();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch) }} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/passkey/i));
    expect(screen.queryByRole('button')).toBeNull();
  });
});
