import { randomBytes } from 'node:crypto';
import {
  AUTH_DEVICE_CODE_METHODS, AUTH_HELPER_BOUND_MS, AUTH_STATUS_STATES, AUTH_TERMINAL_STATES, AUTH_USER_CODE_SHAPES, authUrlVerdict,
  type AuthMethod, type AuthStatusState,
} from '../../../shared/accounts.js';
import type { AccountAuthStatusAnswer, LaneWire } from '../../../shared/api.js';

/**
 * THE SIGN-IN ATTEMPT, IN MEMORY (spec §3.7, §3.8, §13.1; D-5514, N2; accounts plan Task A21, D-7792, D-7793).
 *
 * `POST /api/accounts/:id/auth/start` generates the attempt's id and keeps `{attemptId, sessionIdHash, method,
 * startedAt, expiresAt, node}` here, one attempt per lane. Nothing here is persisted: a server restart forgets the
 * attempt, and the box's helper ends it at its own 600 s bound. The code is never here: the route holds it for one
 * request.
 *
 *  - `expiresAt` is the earlier of the provider's expiry and the helper's bound, and the helper publishes no provider
 *    expiry, so it is `startedAt + AUTH_HELPER_BOUND_MS`, measured before the op is sent, so it is never later than the
 *    helper's own deadline. It is the only source of every countdown.
 *  - At `expiresAt` the store calls its expiry handler for an attempt that has not ended (the routes issue
 *    `auth-cancel`, a no-op for a unit that has already ended) and forgets it.
 *  - `node` is the fleet node the attempt started on; a later call answered by another is refused (spec §13.2), and one
 *    made while the node is not known is answered `unmeasured` with the attempt kept (an unknown node is not another).
 *
 * {@link authStatusVerdictOf} is N2's check of the helper's status file (pure, L1): the store and the verdict are the
 * routes' only inputs about an attempt.
 */

/** One attempt. `state` is the last state the server read from the status file (`starting` until the first read),
 *  `codeSent` whether this server relayed its code, and `ended` whether the server saw a terminal state. */
export interface AuthAttempt {
  readonly laneId: string;
  readonly attemptId: string;
  readonly sessionIdHash: string;
  readonly method: AuthMethod;
  readonly startedAt: number;
  readonly expiresAt: number;
  /** Always a known node: a start while the fleet identity is not known is refused `unmeasured` before any op. */
  readonly node: string;
  state: AuthStatusState;
  codeSent: boolean;
  ended: boolean;
}

/** The server-generated attempt id: 32 lowercase hex characters (the argv builder's `attempt` grammar). */
export const newAttemptId = (): string => randomBytes(16).toString('hex');

/** The time and the timer the store runs on, a parameter so a test can move them. */
export interface AuthAttemptClock {
  now(): number;
  /** Runs `fn` after `ms`, never keeping the process alive for it; answers the cancel. */
  schedule(fn: () => void, ms: number): () => void;
}

export const REAL_AUTH_CLOCK: AuthAttemptClock = {
  now: () => Date.now(),
  schedule: (fn, ms) => {
    const t = setTimeout(fn, Math.max(0, ms));
    t.unref();
    return () => clearTimeout(t);
  },
};

export class AuthAttempts {
  private readonly byLane = new Map<string, { a: AuthAttempt; cancel: () => void }>();
  private onExpire: (a: AuthAttempt) => void = () => {};
  readonly clock: AuthAttemptClock;

  constructor(clock: AuthAttemptClock = REAL_AUTH_CLOCK) { this.clock = clock; }

  /** The routes' act at `expiresAt` for an attempt that has not ended (the `auth-cancel`). */
  setExpiryHandler(fn: (a: AuthAttempt) => void): void { this.onExpire = fn; }

  /** The deadline of an attempt that starts now. */
  expiresAtFrom(startedAt: number): number { return startedAt + AUTH_HELPER_BOUND_MS; }

  /** Keeps `a` as lane `a.laneId`'s attempt, replacing any earlier one, and arms its expiry. */
  begin(a: AuthAttempt): void {
    this.forget(a.laneId);
    const cancel = this.clock.schedule(() => { this.expire(a.laneId, a.attemptId); }, a.expiresAt - this.clock.now());
    this.byLane.set(a.laneId, { a, cancel });
  }

  /** Lane `laneId`'s attempt, ended or not, while it has not expired; an expired one is expired here first. */
  get(laneId: string): AuthAttempt | undefined {
    const held = this.byLane.get(laneId);
    if (held === undefined) return undefined;
    if (this.clock.now() >= held.a.expiresAt) { this.expire(laneId, held.a.attemptId); return undefined; }
    return held.a;
  }

  /** Lane `laneId`'s attempt when it is still live: not ended, not expired. */
  live(laneId: string): AuthAttempt | undefined {
    const a = this.get(laneId);
    return a !== undefined && !a.ended ? a : undefined;
  }

  /** Records the state the server read; a terminal one ends the attempt (it stays readable until `expiresAt`). */
  observe(a: AuthAttempt, state: AuthStatusState): void {
    a.state = state;
    if (AUTH_TERMINAL_STATES.includes(state)) a.ended = true;
  }

  /** Forgets lane `laneId`'s attempt now, with no act at the box. */
  forget(laneId: string): void {
    const held = this.byLane.get(laneId);
    if (held === undefined) return;
    held.cancel();
    this.byLane.delete(laneId);
  }

  /** The attempt's expiry: the handler for one that has not ended, then forgotten. Only `attemptId`'s. */
  private expire(laneId: string, attemptId: string): void {
    const held = this.byLane.get(laneId);
    if (held === undefined || held.a.attemptId !== attemptId) return;
    this.forget(laneId);
    if (!held.a.ended) {
      try { this.onExpire(held.a); } catch { /* the handler answers on its own; an expiry never throws into a timer */ }
    }
  }

  /** `LaneWire.authAttempt` for lane `laneId` as `sessionIdHash` reads it (`mine` only for the starting session, which
   *  alone is also told the attempt's id and method, D-7871 (1)), or undefined when the server holds none. */
  wireOf(laneId: string, sessionIdHash: string | null): LaneWire['authAttempt'] {
    const a = this.get(laneId);
    if (a === undefined) return undefined;
    const mine = sessionIdHash !== null && sessionIdHash === a.sessionIdHash;
    return mine
      ? { state: a.state, expiresAt: a.expiresAt, mine: true, attemptId: a.attemptId, method: a.method }
      : { state: a.state, expiresAt: a.expiresAt, mine: false };
  }

  /** Disarms every timer (the server's close). */
  close(): void { for (const id of [...this.byLane.keys()]) this.forget(id); }
}

// ── N2: the status file, checked before the server answers it (spec §3.8; D-7792) ─────────────────────────────────

/** Why a status file was not trusted, each its own word for the tests and the audit's reasoning; the route answers
 *  every one as `auth-url-untrusted`. */
export type AuthUntrustedWhy = 'not-an-object' | 'attempt' | 'state' | 'updated-at' | 'url' | 'user-code';

export type AuthStatusVerdict =
  | { kind: 'ok'; answer: AccountAuthStatusAnswer }
  | { kind: 'untrusted'; why: AuthUntrustedWhy };

/** The states whose answer carries the URL (and the device code): the ones the operator acts on. */
const URL_STATES: readonly AuthStatusState[] = ['url', 'waiting-code'];
/** A helper refusal code that may cross as `failure`: a kebab word, never a sentence. */
const FAILURE_WORD_RE = /^[a-z][a-z0-9-]{0,47}$/;

/**
 * N2's verdict on the helper's status file (pure). The file is writable by any fleet-user process, so it is trusted
 * only when it echoes this attempt's id, names a state of the helper's vocabulary, carries an ISO `updatedAt`, every
 * `url` it carries passes the method's allowlist, and, for a method that shows a device code, every `userCode` its
 * shape (any other method's `userCode` is dropped unread). A URL is checked whatever the state, so a foreign URL is
 * refused even beside a terminal state. The answer's `url` and `host` are the server's parse of it. The route then masks
 * the answer and refuses one the mask changed (`authAnswerMasked`).
 */
export function authStatusVerdictOf(
  json: unknown, a: { readonly attemptId: string; readonly method: AuthMethod; readonly expiresAt: number },
): AuthStatusVerdict {
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return { kind: 'untrusted', why: 'not-an-object' };
  const f = json as Record<string, unknown>;
  if (f['attemptId'] !== a.attemptId) return { kind: 'untrusted', why: 'attempt' };
  const state = f['state'];
  if (typeof state !== 'string' || !(AUTH_STATUS_STATES as readonly string[]).includes(state)) return { kind: 'untrusted', why: 'state' };
  const st = state as AuthStatusState;
  const updatedAt = typeof f['updatedAt'] === 'string' ? Date.parse(f['updatedAt']) : NaN;
  if (!Number.isFinite(updatedAt)) return { kind: 'untrusted', why: 'updated-at' };
  let url: { href: string; host: string } | null = null;
  if (f['url'] !== undefined) {
    url = authUrlVerdict(f['url'], a.method);
    if (url === null) return { kind: 'untrusted', why: 'url' };
  }
  // A device code is read only for a method that shows one: for any other the helper's scan may have caught a run of
  // the authorize URL's own parameters, which is never shown, so it is dropped unread (D-7792).
  let userCode: string | null = null;
  if (f['userCode'] !== undefined && AUTH_DEVICE_CODE_METHODS.includes(a.method)) {
    const shape = AUTH_USER_CODE_SHAPES[a.method];
    if (shape === null || typeof f['userCode'] !== 'string' || !shape.test(f['userCode'])) return { kind: 'untrusted', why: 'user-code' };
    userCode = f['userCode'];
  }
  const shows = URL_STATES.includes(st);
  const failure = st === 'failed' && typeof f['error'] === 'string' && FAILURE_WORD_RE.test(f['error']) ? f['error'] : null;
  return {
    kind: 'ok',
    answer: {
      ok: true, state: st,
      ...(shows && url !== null ? { url: url.href, host: url.host } : {}),
      ...(shows && userCode !== null ? { userCode } : {}),
      ...(failure !== null ? { failure } : {}),
      updatedAt, expiresAt: a.expiresAt,
    },
  };
}

/** The answer as the egress mask leaves it (D-5513, D-5995), or null when the mask changed anything: the status file
 *  is session-writable text, so a credential planted in the URL's query would otherwise cross to the PWA, its history
 *  and the provider. The masker works on credential shapes and fingerprints, so a genuine authorize URL passes as it is;
 *  a changed one is a file somebody rewrote (`auth-url-untrusted`), never a URL with a hole in it. Pure over `mask`. */
export function authAnswerMasked(
  answer: AccountAuthStatusAnswer, mask: <T>(v: T) => T,
): AccountAuthStatusAnswer | null {
  const masked = mask(answer);
  return JSON.stringify(masked) === JSON.stringify(answer) ? masked : null;
}
