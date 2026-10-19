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
import {
  CANCELLED_TEXT, CHALLENGE_REFRESH_MS, STEP_UP_CEREMONY_MS, STALE_CHALLENGE_TEXT, WRONG_PASSKEY_TEXT, useStepUp, type StepUpDeps,
} from '../src/accounts/useStepUp';
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

    // The assertion reaches /finish, and the stamp it earns hides the step: checked AFTER the finish settles, since
    // the button reads "Confirming…" while it is in flight (D-5690 (3): the earned stamp outranks the screen's read).
    await waitFor(() => expect(box.bodies('/api/auth/step-up/finish')).toHaveLength(1));
    await act(async () => { await new Promise((r) => setTimeout(r, 50)); });
    expect(screen.queryByRole('button', { name: /confirm/i })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
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

  // ---- Review round 1 (D-5690, amended) ----

  it('start answers `not-configured` on a box with no passkey: the passphrase field shows (spec §3.2 fallback)', async () => {
    const box = fakeBox({ start: () => json(501, { ok: false, error: 'not-configured' }) });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    const field = await screen.findByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'pass-one' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(box.bodies('/api/auth/step-up/passphrase')).toEqual([{ passphrase: 'pass-one' }]));
    await waitFor(() => expect(screen.queryByLabelText(/passphrase/i)).toBeNull());
  });

  it('`not-configured` at start: a wrong passphrase says so, and the field stays for the next try', async () => {
    const box = fakeBox({
      start: () => json(501, { ok: false, error: 'not-configured' }),
      answer: () => json(403, { ok: false, error: 'step-up-required', verdict: 'wrong' }),
    });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    const field = await screen.findByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'pass-one' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(box.calls().filter((p) => p === '/api/auth/step-up/start')).toHaveLength(2));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.getByRole('status').textContent).toMatch(/wrong passphrase/i);
    expect(screen.getByLabelText(/passphrase/i)).toBeTruthy();
  });

  it('`not-configured` at start and `passkey-enrolled` from the passphrase: the not-configured sentence, no loop', async () => {
    const box = fakeBox({
      start: () => json(501, { ok: false, error: 'not-configured' }),
      answer: () => json(409, { ok: false, error: 'passkey-enrolled' }),
    });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    const field = await screen.findByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'pass-one' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/passkey settings are incomplete/i));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(box.calls().filter((p) => p === '/api/auth/step-up/start')).toHaveLength(1);
  });

  it('`passkey-enrolled` from the passphrase arm reads start again, which offers the passkey button (D-5690 (4))', async () => {
    let enrolled = false;
    const box = fakeBox({
      start: () => json(200, { challengeB64url: CHALLENGE, rpId: 'box.example.invalid', allowCredentialIdsB64url: enrolled ? [CRED_ID] : [] }),
      answer: () => { enrolled = true; return json(409, { ok: false, error: 'passkey-enrolled' }); },
    });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    const field = await screen.findByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.change(field, { target: { value: 'pass-one' } });
    fireEvent.submit(field.closest('form')!);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(box.calls().filter((p) => p === '/api/auth/step-up/start')).toHaveLength(2);
    expect(screen.queryByLabelText(/passphrase/i)).toBeNull();
  });

  it('`rate-limited` at start offers Try again, which is a new start (D-5690 (6))', async () => {
    let n = 0;
    const box = fakeBox({
      start: () => (n++ === 0 ? json(429, { ok: false, error: 'rate-limited' })
        : json(200, { challengeB64url: CHALLENGE, rpId: 'box.example.invalid', allowCredentialIdsB64url: [CRED_ID] })),
    });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    fireEvent.click(await screen.findByRole('button', { name: /try again/i }));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(box.calls()).toEqual(['/api/auth/step-up/start', '/api/auth/step-up/start']);
  });

  it('an act refused with a 403 that is not step-up-required is rethrown, and the step stays hidden', async () => {
    const box = fakeBox();
    const err = new ApiError(403, { ok: false, error: 'insecure-origin' });
    const errors: unknown[] = [];
    function ActSheet(): ReactNode {
      const stepUp = useStepUp(Date.now() + 60_000, { client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() });
      return (
        <div>
          <ConfirmItsYou stepUp={stepUp} />
          <button type="button" onClick={() => void stepUp.runAct(async () => { throw err; }).catch((e: unknown) => errors.push(e))}>Remove</button>
        </div>
      );
    }
    render(<ActSheet />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(errors).toEqual([err]));
    expect(screen.queryByRole('button', { name: /confirm it.s you/i })).toBeNull();
    expect(box.calls()).toEqual([]);
  });

  it('a challenge held past its bound (timers suspended, laptop asleep) is never signed: a fresh start instead', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const box = fakeBox();
    const auth = fakeAuthenticator();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    // Wall time moves five minutes; no timer runs (a suspended page).
    vi.setSystemTime(Date.now() + 5 * 60_000);
    tap(confirmButton());
    expect(auth.calls).toBe(0);
    expect(screen.getByRole('status').textContent).toBe(STALE_CHALLENGE_TEXT);
    await waitFor(() => expect(box.calls()).toEqual(['/api/auth/step-up/start', '/api/auth/step-up/start']));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    expect(auth.syncCalls).toBe(1);
  });

  it('coming back to a page whose held challenge is past its bound fetches a fresh one', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const box = fakeBox();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    vi.setSystemTime(Date.now() + 5 * 60_000);
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(box.calls()).toEqual(['/api/auth/step-up/start', '/api/auth/step-up/start']));
  });

  it('while a replacement start is in flight the superseded challenge cannot be tapped', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    let n = 0;
    let release: () => void = () => undefined;
    const box = fakeBox({
      start: () => json(200, { challengeB64url: CHALLENGE, rpId: 'box.example.invalid', allowCredentialIdsB64url: [CRED_ID] }),
    });
    const inner = box.fetch.getMockImplementation() as (path: string, init?: RequestInit) => Promise<Response>;
    box.fetch.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === '/api/auth/step-up/start' && n++ === 1) await new Promise<void>((r) => { release = r; });
      return inner(path, init);
    });
    const auth = fakeAuthenticator();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    await act(async () => { await vi.advanceTimersByTimeAsync(CHALLENGE_REFRESH_MS + 1_000); });
    await waitFor(() => expect(n).toBe(2));
    expect(confirmButton()).toBeDisabled();
    tap(confirmButton());
    expect(auth.calls).toBe(0);
    await act(async () => { release(); await Promise.resolve(); });
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
  });

  it('the refresh bound plus the ceremony timeout stays inside the box\'s two-minute challenge TTL', () => {
    // `CHALLENGE_TTL_MS`, server/src/auth/webauthn.ts. A challenge used at the bound and signed at the timeout must
    // still be live when /finish reads it.
    expect(CHALLENGE_REFRESH_MS + STEP_UP_CEREMONY_MS).toBeLessThanOrEqual(120_000 - 5_000);
  });

  // ---- A6 follow-up: the verifiers' surviving mutants, and a return to the page (D-5691) ----

  /** Runs `fn` with the page hidden, without firing `visibilitychange` on the way back. */
  const whileHidden = async (fn: () => Promise<void>): Promise<void> => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    try {
      await fn();
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
    }
  };
  const starts = (box: Box): number => box.calls().filter((p) => p === '/api/auth/step-up/start').length;
  const OTHER = 'The box refused that. Try again.';

  it('the refresh timer never fires while a passkey prompt is open (D-5690 (2))', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const box = fakeBox();
    let finishGet: (c: Credential | null) => void = () => undefined;
    const auth = fakeAuthenticator();
    const real = auth.get;
    auth.get = (o) => { void real(o); return new Promise((r) => { finishGet = r; }); };
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    await act(async () => { await vi.advanceTimersByTimeAsync(50_000); });
    tap(confirmButton());
    expect(auth.syncCalls).toBe(1);
    // The prompt stays open past the bound: no new start replaces the challenge being signed.
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
    expect(starts(box)).toBe(1);
    await act(async () => { finishGet(null); await Promise.resolve(); });
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(CANCELLED_TEXT));
  });

  it('a hidden page never refreshes on the timer (D-5690 (2))', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const box = fakeBox();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    await whileHidden(async () => {
      await act(async () => { await vi.advanceTimersByTimeAsync(CHALLENGE_REFRESH_MS + 1_000); });
    });
    expect(starts(box)).toBe(1);
  });

  it('coming back to the page always replaces the held challenge, however young (D-5691)', async () => {
    // Another tab on the same session may have started since: the box keeps one live challenge per session.
    const box = fakeBox();
    const auth = fakeAuthenticator();
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    await whileHidden(async () => { fireEvent(document, new Event('visibilitychange')); });
    expect(starts(box)).toBe(1);
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(starts(box)).toBe(2));
    // And the superseded challenge is not tappable while the new one is on its way.
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(auth.calls).toBe(0);
  });

  it('coming back to the page while a prompt is open does not replace the challenge being signed (D-5691)', async () => {
    const box = fakeBox();
    const auth = fakeAuthenticator();
    const real = auth.get;
    auth.get = (o) => { void real(o); return new Promise(() => undefined); };
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    fireEvent(document, new Event('visibilitychange'));
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(starts(box)).toBe(1);
  });

  it('a cancelled prompt reads the cancel sentence, not the wrong-passkey one', async () => {
    const box = fakeBox();
    const auth = fakeAuthenticator();
    auth.get = async () => { auth.calls += 1; return null; };
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: auth }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(CANCELLED_TEXT));
    expect(box.bodies('/api/auth/step-up/finish')).toHaveLength(0);
  });

  it('the wrong-passkey sentence survives the next challenge arriving', async () => {
    const box = fakeBox({ answer: () => json(403, { ok: false, error: 'step-up-required', verdict: 'wrong' }) });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    await waitFor(() => expect(starts(box)).toBe(2));
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    expect(screen.getByRole('status').textContent).toBe(WRONG_PASSKEY_TEXT);
  });

  it('an unknown refusal word at start offers Try again, and its text never reaches the page', async () => {
    const box = fakeBox({ start: () => json(400, { ok: false, error: 'something-new', message: 'sk-ant-secret-looking' }) });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(OTHER));
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/sk-ant|something-new/);
  });

  it('an unknown refusal word from the confirmation reads the plain sentence, never the box\'s message', async () => {
    const box = fakeBox({ answer: () => json(400, { ok: false, error: 'something-new', message: 'sk-ant-secret-looking' }) });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    await waitFor(() => expect(confirmButton()).not.toBeDisabled());
    tap(confirmButton());
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe(OTHER));
    expect(document.body.textContent).not.toMatch(/sk-ant|something-new/);
  });

  it('Enter on an empty passphrase field sends nothing', async () => {
    const box = fakeBox({ ids: [] });
    render(<Sheet freshUntil={null} deps={{ client: createApi(box.fetch as unknown as typeof fetch), credentials: fakeAuthenticator() }} />);
    const field = await screen.findByLabelText(/passphrase/i) as HTMLInputElement;
    fireEvent.submit(field.closest('form')!);
    await act(async () => { await new Promise((r) => setTimeout(r, 30)); });
    expect(box.bodies('/api/auth/step-up/passphrase')).toEqual([]);
  });
});
