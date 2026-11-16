// ONE SIGN-IN ATTEMPT, AS A SHEET RUNS IT (accounts plan Tasks A22 and A23; D-7849, D-7871 (2); spec §6.2, §3.7, §3.8,
// §9). The connect sheet's sign-in (A22) and the method switch sheet (A23) run the same attempt: `auth/start`, the
// status poll every 1.5 s while the sheet is open and online, the URL the server accepted, the one code, Cancel, and
// each terminal state from a code. This file holds that once, moved here from `ConnectSheet.tsx` unchanged in what it
// does; each sheet supplies what differs: its ledger and live region, the sentence each terminal state says (a new
// lane "exists and is off"; a switch "changed nothing"), and what follows the helper's `done`.
//
// EVERY DEADLINE READS THE ATTEMPT'S `expiresAt`, the last one the server answered (spec §3.7). The code lives only in
// the code field's DOM node and the one request. The attempt's own `codeSent` is the one-send latch, so a remount of
// the field (offline and back, the sheet closed and reopened, a resumed attempt) offers no second send.
//
// THE RE-AUTH SHEET (A38, D-7872) runs the same attempt on an existing lane, with the same method it already has.
//
// THE CHATGPT SIGN-IN (A25, D-8051; spec §7.2) is the same attempt with no code to send: the status answer brings a
// device code beside the URL, the operator types it on the provider's page, and the helper's `done` says they approved.
// The URL and the code are one fact, read from one answer: an answer that brings a URL without a code clears the code,
// so the card shows the pair the server accepted together or nothing.
//
// RESUME (A23, D-7871 (2)): a sheet opened for an attempt the server already holds for this session (the app-level
// banner's Continue) adopts it by its id and method, with no start, and the poll brings back its URL.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { authCodeShapeOk, type AuthStatusState } from '../../../shared/accounts';
import type { AccountAuthStartAnswer, AccountAuthStatusAnswer } from '../../../shared/api';
import { ApiError, api } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { Button } from '@ccrc/ui';
import {
  CANCEL_SIGN_IN, CODE_NOTICE, KEEP_IT, SIGN_OUT_RESTART, SIGN_IN_END, SIGN_IN_LEDGER, cancelRefused, chatgptEnd, signInFailed, signInLedger, signInOffline,
  signInStartRefusal, type SignInEndKind,
} from '../fleet/accountWords';
import { CodeField } from './CodeField';
import { ConfirmItsYou } from './ConfirmItsYou';
import { FrameFoot } from './FrameFoot';
import { Countdown, RunFrame, UrlCard, UserCodeWell, type LedgerLine } from './RunFrame';
import { readStatus, readStatusRefusal, showsDeviceCode, type SignInMethod, type SignInReading } from './connectFlow';
import { StepUpFor } from './RemoveSheet';
import type { StepUp, StepUpDeps } from './useStepUp';

/** How often an open sheet reads a live attempt's status (spec §6.2 step 5). */
export const AUTH_POLL_MS = 1500;

/** The attempt's routes, injectable so a test drives a fake box. */
export type SignInRoutes = Pick<typeof api, 'accountAuthStart' | 'accountAuthStatus' | 'accountAuthCode' | 'accountAuthCancel'>;

/** A live attempt as a sheet holds it: the server's id and deadline (the LAST one it answered), the state the helper
 *  last published, the URL and host the server accepted (kept once seen), and whether its one code went. */
export interface Attempt {
  readonly attemptId: string;
  readonly method: SignInMethod;
  readonly expiresAt: number;
  readonly state: AuthStatusState | null;
  readonly url: string | null;
  readonly host: string | null;
  /** The device code the server accepted beside the URL (`null` for a method that has none). */
  readonly userCode: string | null;
  readonly codeSent: boolean;
}

/** Whether the attempt has what its card shows: the URL, and a device sign-in's code with it. */
const cardReady = (a: Attempt): boolean => a.url !== null && a.host !== null && (!showsDeviceCode(a.method) || a.userCode !== null);

/** An attempt the server already holds for this session (`LaneWire.authAttempt` with `mine`, D-7871 (1)). */
export interface HeldAttempt {
  readonly attemptId: string;
  readonly method: SignInMethod;
  readonly expiresAt: number;
}

export type RunAct = (act: () => Promise<unknown>) => Promise<'done' | 'step-up'>;
export const plainRun: RunAct = async (act) => { await act(); return 'done'; };

/** The `error` word an `ApiError` carries, or `undefined` for a request that never completed. */
export function wordOf(err: unknown): string | undefined {
  return fieldOf(err, 'error');
}

/** A refusal's body field when it is a string, or `undefined`. The words file holds it to a plain word before it
 *  prints it (`signInStartRefusal`). */
export function fieldOf(err: unknown, k: string): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const b = err.body;
  const v = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)[k] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** What the hosting sheet supplies. */
export interface SignInHost {
  readonly id: string;
  readonly client: SignInRoutes;
  /** The screen cannot act (offline): no code is sent and Cancel is refused. */
  readonly blocked: boolean;
  /** The ledger: a new line, and the last (running) line replaced by its result. */
  readonly write: (text: string) => void;
  readonly settle: (text: string) => void;
  /** The live region: a step change (polite) and a terminal state (an alert). */
  readonly status: (text: string) => void;
  readonly alert: (text: string) => void;
  /** The sentence a terminal state says: what did not happen, from its kind. `expiresAt` is the attempt's last-known
   *  deadline, for the sentence that names it. */
  readonly endText: (kind: SignInEndKind, failure?: string, expiresAt?: number) => string;
  /** The sentence a start refused with a word says: A22's `signInStartRefusal` by default; the re-auth sheet adds that
   *  the old credential is untouched (Task A38, D-7872). */
  readonly startRefusal?: (word: string, reason: string | undefined) => string;
  /** A start is under way: the host shows its run frame. */
  readonly onStart?: () => void;
  /** The helper says `done`: the attempt is over, and the host runs what follows (the check). */
  readonly onDone: (a: Attempt) => void;
}

export interface SignInAttempt {
  /** The live attempt, or `null` before one began and once it ended. */
  readonly att: Attempt | null;
  /** The terminal sentence, or `null` while none has been said. */
  readonly end: string | null;
  readonly endNotice: string | null;
  readonly setEndNotice: (t: string | null) => void;
  /** A step-up the server refused, so the next gate shows the step whatever the store's stamp says. */
  readonly lapsed: boolean;
  readonly codeKey: number;
  readonly codeNotice: string | null;
  readonly cancelling: boolean;
  readonly start: (m: SignInMethod, runAct?: RunAct) => Promise<void>;
  readonly resume: (h: HeldAttempt) => void;
  readonly sendCode: (code: string) => Promise<void>;
  readonly cancel: () => Promise<void>;
  readonly onStatus: (o: { ok: true; raw: unknown } | { ok: false; err: unknown }) => void;
  readonly onExpired: () => void;
}

export function useSignInAttempt(host: SignInHost): SignInAttempt {
  const { id, client: sc, blocked, write, settle, status, alert } = host;
  const [att, setAttState] = useState<Attempt | null>(null);
  const attRef = useRef<Attempt | null>(null);
  const putAtt = (a: Attempt | null): void => { attRef.current = a; setAttState(a); };
  const [end, setEnd] = useState<string | null>(null);
  const [endNotice, setEndNotice] = useState<string | null>(null);
  const [lapsed, setLapsed] = useState(false);
  const [codeKey, setCodeKey] = useState(0);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  /** A terminal state: its sentence replaces the running line, the attempt is forgotten (its poll unmounts), and the
   *  state is announced as an alert. */
  const finish = (text: string): void => {
    putAtt(null);
    settle(text);
    setEnd(text);
    setEndNotice(null);
    setCodeNotice(null);
    alert(text);
  };
  const endOf = (k: SignInEndKind, failure?: string, expiresAt?: number): string => host.endText(k, failure, expiresAt);
  const refusedStart = (word: string, reason: string | undefined, m: SignInMethod): string =>
    (host.startRefusal ?? ((w, r) => signInStartRefusal(id, w, r, m)))(word, reason);

  /** `auth/start` (spec §6.2 step 4), once. `runAct` is a mounted gate's (Start again), which shows the step itself on a
   *  `step-up-required`; the start right after the add is sent plainly, its step-up just taken. */
  const start = async (m: SignInMethod, runAct: RunAct = plainRun): Promise<void> => {
    putAtt(null);
    setEnd(null);
    setEndNotice(null);
    setCodeNotice(null);
    host.onStart?.();
    const { starting } = signInLedger(m);
    write(starting);
    status(starting);
    const got: { a: AccountAuthStartAnswer | null } = { a: null };
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await runAct(async () => { got.a = await sc.accountAuthStart(id, { method: m }); });
    } catch (e) {
      failure = e;
    }
    if (!live.current) return;
    const fresh = (attemptId: string, expiresAt: number): Attempt =>
      ({ attemptId, method: m, expiresAt, state: null, url: null, host: null, userCode: null, codeSent: false });
    if (outcome === 'step-up') { setLapsed(true); finish(refusedStart('step-up-required', undefined, m)); return; }
    if (got.a !== null) {
      setLapsed(false);
      setCodeKey((k) => k + 1);
      putAtt(fresh(got.a.attemptId, got.a.expiresAt));
      return;
    }
    const word = wordOf(failure);
    const body = failure instanceof ApiError && typeof failure.body === 'object' && failure.body !== null
      ? failure.body as Record<string, unknown> : {};
    // The box may have started it: the server kept the attempt and answered its id, so the sheet polls it (D-7793 (2)).
    const { attemptId: keptId, expiresAt: keptUntil } = body;
    if (word === 'outcome-unknown' && typeof keptId === 'string' && typeof keptUntil === 'number') {
      settle(SIGN_IN_LEDGER.startUnknown);
      status(SIGN_IN_LEDGER.startUnknown);
      setCodeKey((k) => k + 1);
      putAtt(fresh(keptId, keptUntil));
      return;
    }
    if (word === undefined || word === 'outcome-unknown') { finish(endOf('unknown')); return; }
    if (word === 'step-up-required') setLapsed(true);
    finish(refusedStart(word, fieldOf(failure, 'reason'), m));
  };

  /** An attempt the server already holds for this session (D-7871 (2)): adopted as it is, with no start. Its state and
   *  URL come back with the first poll, which the attempt's mount issues at once. */
  const resume = (h: HeldAttempt): void => {
    setEnd(null);
    setEndNotice(null);
    setCodeNotice(null);
    setCodeKey((k) => k + 1);
    putAtt({ attemptId: h.attemptId, method: h.method, expiresAt: h.expiresAt, state: null, url: null, host: null, userCode: null, codeSent: false });
  };

  /** One reading of the attempt: still live (the ledger and the cards follow the state), done, or ended. */
  const apply = (a: Attempt, r: SignInReading, next: Attempt): void => {
    if (r.kind === 'done') { putAtt(null); host.onDone(next); return; }
    if (r.kind === 'end') { finish(endOf(r.end, r.failure, next.expiresAt)); return; }
    const before = cardReady(a);
    putAtt(next);
    // The card arrived: the sheet now waits on the operator (the amber pulse), and says so once.
    if (!before && cardReady(next) && !next.codeSent) {
      const { waiting } = signInLedger(next.method);
      settle(waiting);
      status(waiting);
    }
  };

  const onStatus = (o: { ok: true; raw: unknown } | { ok: false; err: unknown }): void => {
    const a = attRef.current;
    if (a === null || !live.current) return;
    if (!o.ok) {
      const r = readStatusRefusal(wordOf(o.err), Date.now(), a.expiresAt);
      if (r !== null) apply(a, r, a);
      return;
    }
    const ans = o.raw as AccountAuthStatusAnswer;
    if (typeof ans !== 'object' || ans === null || typeof ans.state !== 'string') return;
    const fresh = typeof ans.url === 'string' && typeof ans.host === 'string';
    const url = fresh ? ans.url as string : a.url;
    const hostName = fresh ? ans.host as string : a.host;
    // Read with the URL, never kept past it: the pair is the one the server accepted in this answer.
    const userCode = fresh ? (typeof ans.userCode === 'string' ? ans.userCode : null) : a.userCode;
    const next: Attempt = {
      ...a, state: ans.state, url, host: hostName, userCode, expiresAt: typeof ans.expiresAt === 'number' ? ans.expiresAt : a.expiresAt,
    };
    apply(a, readStatus(ans.state, a.codeSent, typeof ans.failure === 'string' ? ans.failure : undefined), next);
  };

  /** The deadline passed with the attempt still live (spec §6.2's Expired, at `expiresAt`). */
  const onExpired = (): void => {
    const a = attRef.current;
    if (a !== null && Date.now() >= a.expiresAt) finish(endOf('expired', undefined, a.expiresAt));
  };

  /**
   * Send code (spec §3.7): the one code, once. A code off its method's shape is never sent. The attempt's own `codeSent`
   * is the latch: the field's is only for one mount, and a remount (offline and back, the sheet closed and reopened) must
   * not offer a second send.
   */
  const sendCode = async (code: string): Promise<void> => {
    const a = attRef.current;
    if (a === null || blocked || a.codeSent) return;
    if (!authCodeShapeOk(code, a.method)) {
      setCodeNotice(CODE_NOTICE.shape);
      setCodeKey((k) => k + 1);
      return;
    }
    putAtt({ ...a, codeSent: true });
    setCodeNotice(null);
    settle(SIGN_IN_LEDGER.exchanging);
    status(SIGN_IN_LEDGER.exchanging);
    try {
      await sc.accountAuthCode(id, { attemptId: a.attemptId, code });
    } catch (e) {
      if (!live.current || attRef.current === null) return;
      const word = wordOf(e);
      // It went, or may have: a second code would be refused, so none is offered and the poll says what happened.
      if (word === undefined || word === 'outcome-unknown') { setCodeNotice(CODE_NOTICE.unknown); return; }
      if (word === 'code-already-sent') return;
      if (word === 'node-changed') { finish(endOf('node-changed')); return; }
      if (word === 'no-auth-attempt') { finish(endOf(Date.now() >= a.expiresAt ? 'expired' : 'lost', undefined, a.expiresAt)); return; }
      // Nothing was sent: a fresh field for the next paste.
      putAtt({ ...attRef.current, codeSent: false });
      settle(SIGN_IN_LEDGER.waiting);
      setCodeNotice(word === 'bad-code' ? CODE_NOTICE.shape : word === 'not-your-attempt' ? CODE_NOTICE.notYours
        : word === 'unmeasured' ? CODE_NOTICE.unmeasured : CODE_NOTICE.refused(word));
      setCodeKey((k) => k + 1);
    }
  };

  /** Cancel (spec §6.2): present while the attempt is live. A cancel the box could not carry out leaves it standing. */
  const cancel = async (): Promise<void> => {
    const a = attRef.current;
    if (a === null || blocked || cancelling) return;
    setCancelling(true);
    try {
      await sc.accountAuthCancel(id, { attemptId: a.attemptId });
      if (live.current) finish(endOf('cancelled'));
    } catch (e) {
      if (!live.current) return;
      const word = wordOf(e);
      if (word === 'no-auth-attempt') finish(endOf(Date.now() >= a.expiresAt ? 'expired' : 'lost', undefined, a.expiresAt));
      else setCodeNotice(cancelRefused(word));
    } finally {
      if (live.current) setCancelling(false);
    }
  };

  return {
    att, end, endNotice, setEndNotice, lapsed, codeKey, codeNotice, cancelling,
    start, resume, sendCode, cancel, onStatus, onExpired,
  };
}

/** The connect sheet's terminal sentences (A22): a new lane that "exists and is off". */
export const newLaneEnd = (id: string, method: string | null = null) => (k: SignInEndKind, failure?: string, expiresAt?: number): string => {
  if (method === 'openai-login') return chatgptEnd(id, k, failure, expiresAt);
  return k === 'failed' ? signInFailed(failure) : SIGN_IN_END[k](id);
};

/** The poll of a live attempt and its deadline: mounted only while the attempt is live and the screen is online, so a
 *  closed sheet, an ended attempt or an offline screen reads nothing. */
function AuthWatch({ id, client, expiresAt, onOutcome, onExpired }: {
  id: string; client: SignInRoutes; expiresAt: number;
  onOutcome: (o: { ok: true; raw: unknown } | { ok: false; err: unknown }) => void;
  onExpired: () => void;
}): ReactNode {
  usePoll({ pollMs: AUTH_POLL_MS, request: () => client.accountAuthStatus(id), onOutcome });
  const expired = useRef(onExpired);
  expired.current = onExpired;
  useEffect(() => {
    const t = setTimeout(() => expired.current(), Math.max(0, expiresAt - Date.now()));
    return () => clearTimeout(t);
  }, [expiresAt]);
  return null;
}

/**
 * A LIVE ATTEMPT'S RUN FRAME (spec §6.2 steps 4–7): the ledger, the URL card, the code field, the countdown and
 * Cancel. Offline: the sentence with the last-known deadline, and nothing to act on but a Cancel the screen refuses.
 */
export function SignInLive({ s, att, id, client, blocked, ledger }: {
  s: SignInAttempt; att: Attempt; id: string; client: SignInRoutes; blocked: boolean; ledger: readonly LedgerLine[];
}): ReactNode {
  const codeNoticeId = useId();
  const device = showsDeviceCode(att.method);
  const ready = cardReady(att);
  const waiting = ready && !att.codeSent;
  return (
    <RunFrame lines={ledger} live waiting={waiting && !blocked}>
      {!blocked && <AuthWatch id={id} client={client} expiresAt={att.expiresAt} onOutcome={s.onStatus} onExpired={s.onExpired} />}
      {blocked ? (
        <p className="acct-offline" data-sign-in-offline="true">{signInOffline(att.expiresAt)}</p>
      ) : (
        <>
          {waiting && <UrlCard url={att.url!} host={att.host!} method={att.method} />}
          {device && waiting && <UserCodeWell code={att.userCode!} />}
          {!device && att.url !== null && (
            <CodeField key={s.codeKey} onSend={(c) => { void s.sendCode(c); }} disabled={att.codeSent}
              describedBy={s.codeNotice !== null ? codeNoticeId : undefined} />
          )}
          {s.codeNotice !== null && <p className="acct-notice" id={codeNoticeId}>{s.codeNotice}</p>}
          <Countdown expiresAt={att.expiresAt} waiting={waiting} />
        </>
      )}
      <FrameFoot quiet={[{ label: CANCEL_SIGN_IN, onClick: () => { void s.cancel(); }, disabled: blocked || s.cancelling }]} />
    </RunFrame>
  );
}

/**
 * "SIGN THIS LANE OUT AND START AGAIN" (spec §6.2 step 10, §9 row 1; Tasks A22 and A38, D-7849, D-7872): the act, then,
 * once tapped, what it does, Confirm it's you while the stamp has lapsed, Keep it, and the act again, which runs
 * `onSignOut` with the mounted step-up. The connect sheet's result frame and the re-auth sheet's ending draw it alike.
 */
export function WrongAccountAct({ open, onOpen, onKeep, confirm, freshUntil, deps, busy, offline, onSignOut }: {
  open: boolean;
  onOpen: () => void;
  onKeep: () => void;
  /** What it does, said before it runs. */
  confirm: string;
  freshUntil: number | null;
  deps: StepUpDeps;
  busy: boolean;
  offline: boolean;
  onSignOut: (stepUp: StepUp) => void;
}): ReactNode {
  if (!open || offline) {
    return (
      <Button variant="ghost" size="fit" className="acct-wrong-act" disabled={busy || offline} onClick={onOpen}>
        {SIGN_OUT_RESTART}
      </Button>
    );
  }
  return (
    <StepUpFor freshUntil={freshUntil} deps={deps}>
      {(stepUp) => (
        <div className="acct-wrong-confirm">
          <p className="acct-field-note">{confirm}</p>
          <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
          <FrameFoot
            quiet={[{ label: KEEP_IT, onClick: onKeep, disabled: busy }]}
            primary={{ label: SIGN_OUT_RESTART, onClick: () => onSignOut(stepUp), disabled: busy || stepUp.needed, busy }}
          />
        </div>
      )}
    </StepUpFor>
  );
}
