import { useCallback, useEffect, useRef, useState } from 'react';
import type { StepUpAnswer, StepUpStart } from '../../../shared/api';
import { ApiError, api } from '../lib/api';
import { PasskeyCeremonyError, assertStepUp, passkeyLoginSupported, type CredentialsApi } from '../lib/passkey';

/**
 * THE STEP OF "CONFIRM IT'S YOU" (D-5512, spec §3.2; accounts plan Task A6; D-5690).
 *
 * Every act that puts, replaces or deletes a credential needs a step-up from the last five minutes on the same
 * session. This hook owns that step for one sheet: whether it is needed, which arm the box offers (a passkey, or the
 * passphrase on a box with none enrolled), the challenge, and the sentence. `ConfirmItsYou` draws it.
 *
 * THREE RULES, each held by `pwa/test/confirm-its-you.test.tsx`:
 *  - **The challenge is fetched when the step is SHOWN, never on the tap.** iOS Safari refuses
 *    `navigator.credentials.get` once an `await` has run between the tap and the call, so {@link StepUp.confirm}
 *    calls it synchronously over the challenge already held (`assertStepUp`, `lib/passkey.ts`).
 *  - **Nothing is retried by this hook.** Not a refused proof, and not the act after it: {@link StepUp.runAct} runs
 *    the act ONCE, and an act refused `step-up-required` (the stamp lapsed between the button and the act) shows the
 *    step again and waits for the operator to press the act again.
 *  - **`step-up-locked` offers no button.** The session spent its budget; the box refuses every attempt until the
 *    session ends or the operator signs in again.
 *
 * The passphrase is never held here: the arm's field keeps it in its own state (`ConfirmItsYou`), and
 * {@link StepUp.submitPassphrase} takes it for one request.
 */

/** A held challenge is replaced after this long, before the box's own two-minute TTL (`CHALLENGE_TTL_MS`,
 *  `server/src/auth/webauthn.ts`) would refuse it and charge the session's budget for a stale one (D-5690). */
export const CHALLENGE_REFRESH_MS = 90_000;

/** The arms, and the states around them. `loading` is the challenge on its way; `unavailable` is a step the
 *  operator cannot take from here, with its sentence in {@link StepUp.notice}. */
export type StepUpArm = 'loading' | 'passkey' | 'passphrase' | 'locked' | 'unavailable';

/** What the hook needs from the outside, injectable so a test drives a fake box and a fake authenticator. */
export interface StepUpDeps {
  client?: Pick<typeof api, 'stepUpStart' | 'stepUpFinish' | 'stepUpPassphrase'>;
  /** The authenticator. Absent: the browser's own, when it has one (`passkeyLoginSupported`). */
  credentials?: CredentialsApi;
}

export interface StepUp {
  /** Is the step showing? False while the stamp is fresh and no act has been refused `step-up-required` since. */
  needed: boolean;
  arm: StepUpArm;
  /** A passkey challenge is held and nothing is in flight: the button may be pressed. */
  ready: boolean;
  /** An attempt is in flight. */
  busy: boolean;
  /** The sentence beside the step, or null. Built from refusal words only. */
  notice: string | null;
  /** Offered after a failure that another try could cure (the box unreachable, too many at once). */
  canRetry: boolean;
  /** THE TAP. Synchronous by contract: calls `credentials.get` before it returns. */
  confirm: () => void;
  submitPassphrase: (passphrase: string) => void;
  /** Fetch the step again after a `canRetry` failure. Never re-sends a proof or an act. */
  retry: () => void;
  /** Reads an act's refusal: `true` when it was `step-up-required`, which shows the step again. */
  actRefused: (err: unknown) => boolean;
  /** Runs `act` once. `'step-up'` when it was refused `step-up-required` (the step is showing again); any other
   *  failure is rethrown to the caller. */
  runAct: (act: () => Promise<unknown>) => Promise<'done' | 'step-up'>;
}

export const LOCKED_TEXT =
  "Confirm it's you is locked on this device after too many tries. Sign out and sign in again to unlock it.";
export const WRONG_PASSKEY_TEXT = "That didn't confirm it's you. Try again.";
export const WRONG_PASSPHRASE_TEXT = 'Wrong passphrase. Try again.';
export const CANCELLED_TEXT = 'The passkey prompt closed before it finished. Try again.';
export const NO_PASSKEY_HERE_TEXT =
  "This browser can't use a passkey, and this box asks for one. Confirm from a device that has your passkey.";
export const UNREACHABLE_TEXT = "Couldn't reach the box. Try again.";

/** The refusal words a step-up route answers, each with its sentence and whether another try could cure it. A word
 *  not listed reads as {@link UNREACHABLE_TEXT}'s sibling below, never as the server's own text. */
const WORD_TEXT: Readonly<Record<string, { text: string; retry: boolean }>> = {
  'auth-off': { text: 'Sign-in is off on this box, so accounts cannot be changed from here.', retry: false },
  'not-configured': { text: "This box's passkey settings are incomplete. ccrc doctor names the fix.", retry: false },
  'rate-limited': { text: 'Too many tries at once. Wait a moment, then try again.', retry: true },
  'unmeasured': { text: "The box couldn't read its passkey list. Try again.", retry: true },
};
const OTHER_TEXT = { text: "The box refused that. Try again.", retry: true };

/** The refusal word an `ApiError` carries in its body, or null when it carries none. */
function wordOf(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const b = err.body;
  return typeof b === 'object' && b !== null && typeof (b as { error?: unknown }).error === 'string'
    ? (b as { error: string }).error
    : null;
}

export function useStepUp(freshUntil: number | null, deps: StepUpDeps = {}): StepUp {
  const client = deps.client ?? api;
  const credentials = deps.credentials;
  const canPasskey = credentials !== undefined || passkeyLoginSupported();

  // The stamp this sheet earned, which outranks the screen's read until it lapses; and the act's refusal, which
  // outranks both until the next stamp.
  const [stamp, setStamp] = useState<number | null>(null);
  const [refused, setRefused] = useState(false);
  const [, setTick] = useState(0);
  const until = Math.max(freshUntil ?? -Infinity, stamp ?? -Infinity);
  const needed = refused || !(until > Date.now());

  // Re-render the instant the stamp lapses, so the step shows on its own.
  useEffect(() => {
    if (needed || !Number.isFinite(until)) return undefined;
    const t = setTimeout(() => setTick((n) => n + 1), Math.max(0, until - Date.now()) + 1);
    return () => clearTimeout(t);
  }, [needed, until]);

  const [arm, setArm] = useState<StepUpArm>('loading');
  const [held, setHeld] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [canRetry, setCanRetry] = useState(false);
  // Bumped to fetch a new challenge: after every attempt (a challenge is single-use), on the refresh timer, and on
  // a retry.
  const [generation, setGeneration] = useState(0);
  const challenge = useRef<StepUpStart | null>(null);
  const busyRef = useRef(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => { live.current = false; };
  }, []);

  const fail = useCallback((word: string | null): void => {
    if (word === 'step-up-locked') {
      setArm('locked');
      setNotice(LOCKED_TEXT);
      setCanRetry(false);
      return;
    }
    const t = word === null ? { text: UNREACHABLE_TEXT, retry: true } : (WORD_TEXT[word] ?? OTHER_TEXT);
    setArm('unavailable');
    setNotice(t.text);
    setCanRetry(t.retry);
  }, []);

  // THE CHALLENGE, fetched when the step shows. Never on the tap.
  useEffect(() => {
    if (!needed) {
      challenge.current = null;
      setHeld(false);
      return undefined;
    }
    let current = true;
    void client.stepUpStart().then((s) => {
      if (!current || !live.current) return;
      if (s.allowCredentialIdsB64url.length === 0) {
        challenge.current = null;
        setHeld(false);
        setArm('passphrase');
        return;
      }
      if (!canPasskey) {
        challenge.current = null;
        setHeld(false);
        setArm('unavailable');
        setNotice(NO_PASSKEY_HERE_TEXT);
        setCanRetry(false);
        return;
      }
      challenge.current = s;
      setHeld(true);
      setArm('passkey');
    }, (err: unknown) => {
      if (!current || !live.current) return;
      challenge.current = null;
      setHeld(false);
      fail(wordOf(err));
    });
    // Replace a held challenge before the box's TTL would refuse it (D-5690). The passphrase arm holds none, and a
    // replaced one is simply the next generation.
    const refresh = setTimeout(() => {
      if (current && live.current && !busyRef.current) setGeneration((g) => g + 1);
    }, CHALLENGE_REFRESH_MS);
    return () => {
      current = false;
      clearTimeout(refresh);
    };
  }, [needed, generation, client, canPasskey, fail]);

  const confirmed = useCallback((a: StepUpAnswer): void => {
    if (!live.current) return;
    busyRef.current = false;
    setBusy(false);
    setNotice(null);
    setCanRetry(false);
    setRefused(false);
    setStamp(a.stepUpFreshUntil);
  }, []);

  /** One failed attempt: its sentence, and a new challenge for the next tap. Never a second attempt. */
  const attemptFailed = useCallback((err: unknown, wrongText: string): void => {
    if (!live.current) return;
    busyRef.current = false;
    setBusy(false);
    const word = wordOf(err);
    if (err instanceof PasskeyCeremonyError) {
      setNotice(CANCELLED_TEXT);
      setCanRetry(false);
    } else if (word === 'step-up-required') {
      setNotice(wrongText);
      setCanRetry(false);
    } else if (word === 'passkey-enrolled') {
      // A passkey was enrolled since the step was shown: the next start offers the passkey arm.
      setNotice(null);
      setCanRetry(false);
    } else if (word === 'step-up-locked') {
      fail(word);
      return;
    } else {
      // The arm stands; the sentence says why, and the next generation's challenge is the next try.
      setNotice((word === null ? null : WORD_TEXT[word]?.text) ?? (word === null ? UNREACHABLE_TEXT : OTHER_TEXT.text));
      setCanRetry(false);
    }
    setGeneration((g) => g + 1);
  }, [fail]);

  const confirm = useCallback((): void => {
    const options = challenge.current;
    if (options === null || busyRef.current) return;
    // Spent here: a challenge is single-use, and the next tap gets the next generation's.
    challenge.current = null;
    busyRef.current = true;
    // SYNCHRONOUS: `assertStepUp` calls `credentials.get` before it returns, inside this tap's user activation.
    const ceremony = assertStepUp(options, credentials);
    setHeld(false);
    setBusy(true);
    setNotice(null);
    void ceremony.then((body) => client.stepUpFinish(body))
      .then(confirmed, (err: unknown) => attemptFailed(err, WRONG_PASSKEY_TEXT));
  }, [client, credentials, confirmed, attemptFailed]);

  const submitPassphrase = useCallback((passphrase: string): void => {
    if (busyRef.current || passphrase === '') return;
    busyRef.current = true;
    setBusy(true);
    setNotice(null);
    void client.stepUpPassphrase(passphrase)
      .then(confirmed, (err: unknown) => attemptFailed(err, WRONG_PASSPHRASE_TEXT));
  }, [client, confirmed, attemptFailed]);

  const retry = useCallback((): void => {
    setNotice(null);
    setCanRetry(false);
    setArm('loading');
    setGeneration((g) => g + 1);
  }, []);

  const actRefused = useCallback((err: unknown): boolean => {
    if (wordOf(err) !== 'step-up-required') return false;
    setStamp(null);
    setRefused(true);
    return true;
  }, []);

  const runAct = useCallback(async (act: () => Promise<unknown>): Promise<'done' | 'step-up'> => {
    try {
      await act();
      return 'done';
    } catch (err) {
      if (actRefused(err)) return 'step-up';
      throw err;
    }
  }, [actRefused]);

  return {
    needed, arm, ready: arm === 'passkey' && held && !busy, busy, notice, canRetry,
    confirm, submitPassphrase, retry, actRefused, runAct,
  };
}
