// THE ADD ACCOUNT DOOR AND THE CONNECT SHEET (accounts plan Task A18, D-5522, D-5513, D-7740; spec §5, §6.1, §6.3, §12.3,
// §12.4, §12.5): Anthropic Paste end to end; and since Task A22 (D-7849; spec §6.1–§6.3), Mint a long-lived token (the
// default, Q1) and Sign in with Claude.
//
// The sheet's frames, in order: Provider → Name it → Method (with Confirm it's you, only when the step-up has lapsed) →
// Run → Result. The frames draw; this file holds the flow, and `connectFlow.ts` decides (the providers and methods each
// narrowed by its cap word, the default method, the default hue, the id and label rules).
//
// THE SECRET (spec §3.3). The pasted token lives only in `SecretField`'s own DOM node. It is read once, on submit,
// which empties the field; it goes out in the one `POST /api/accounts` and is held nowhere else: not in this file's
// state, a store, `localStorage`, `sessionStorage` or IndexedDB. A refusal re-presents the field empty. While the screen
// is offline, no secret field is drawn at all.
//
// NOTHING IS RETRIED ON ITS OWN. A refused add says why, from its code. An add whose answer never came ("outcome
// unknown") re-reads the roster and resumes at the step the reconciled roster shows (the lane exists: Check), or says
// nothing was added; it never sends the add again, so it can never run into `duplicate-id`. A re-read that fails too
// reconciles nothing, so the sheet says the outcome is still unknown and offers only Read again (D-7740 (5)).
//
// THE SIGN-IN (Task A22, D-7849; spec §6.2, §6.3, §3.7, §3.8). The lane is added with no credential, then the sheet
// starts an attempt (`auth/start`), polls its status every 1.5 s while the sheet is open and online (never otherwise),
// shows the URL the server accepted with the code field, sends the one code, and on `done` runs the check that ends in
// the result frame. Every deadline reads the attempt's `expiresAt`, the last one the server answered. Cancel is in every
// frame while the attempt is live. Each terminal state says what did not happen, from a code: the helper's state or a
// route's word. Offline mid-attempt, the run frame shows only the sentence with the last-known deadline: no URL, no code
// field, no Send, and no poll. The code lives only in the code field's DOM node and the one request.
//
// ANNOUNCEMENTS (spec §12.4). One live region per sheet: a step change is announced politely (`role="status"`), and a
// terminal state (refused, outcome unknown, done) as an alert (`role="alert"`). A frame that only re-renders announces
// nothing: an announcement is written by a transition, never by a render.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, ListRow, Sheet } from '@ccrc/ui';
import { authCodeShapeOk, type AuthStatusState } from '../../../shared/accounts';
import type { AccountAddAnswer, AccountAuthStartAnswer, AccountAuthStatusAnswer, AccountsConnect, LaneWire, RosterWire } from '../../../shared/api';
import type { ConnectMethod } from '../../../shared/providers';
import type { Hue } from '../../../shared/roster';
import { ApiError, api } from '../lib/api';
import {
  ADD_LANE, ADD_REFUSED, DOOR_META, FRAME_SAID, PICK_ANOTHER_NAME, STEP_UP_AGAIN, PROVIDER_ROWS, DOOR_WORD, LEDGER, NEEDS_APP_UPDATE, OUTCOME_UNKNOWN, TOKEN_CLEARED, TOKEN_FIELD_LABEL,
  READ_AGAIN, addRefusal, configDirFoundText, laneActRefusal, notFoundAfterUnknown, resultDone, stillUnknownAfterUnknown,
  ADD_AND_SIGN_IN, CANCEL_SIGN_IN, CODE_NOTICE, DISCARD_LANE, DONE, SIGN_IN_END, SIGN_IN_LEDGER, SIGN_OUT_RESTART,
  STEP_UP_AGAIN_DISCARD, STEP_UP_AGAIN_SIGN_OUT, START_AGAIN, cancelRefused, discardedDone, removeRefusal, removeUnknown,
  signInFailed, signInOffline, signInStartRefusal, signOutConfirm, signOutRefused, statedRefused, STEP_UP_AGAIN_ADD, KEEP_IT,
  type SignInEndKind,
} from '../fleet/accountWords';
import { CodeField } from './CodeField';
import { usePoll } from '../lib/usePoll';
import { CompromiseSteps } from './CompromiseSteps';
import { ConfirmItsYou } from './ConfirmItsYou';
import { CopyCommand } from '../fleet/TroubleCard';
import { FrameFoot, type FootAct } from './FrameFoot';
import { MethodFrame } from './MethodFrame';
import { NameFrame, type ConfigDirFound } from './NameFrame';
import { ProviderFrame } from './ProviderFrame';
import { ResultFrame } from './ResultFrame';
import { Countdown, RunFrame, UrlCard, type LedgerLine } from './RunFrame';
import { SecretField, type SecretFieldHandle } from './SecretField';
import { useStepUp, type StepUp, type StepUpDeps } from './useStepUp';
import {
  defaultHue, isSignInMethod, methodChoices, providerChoices, readStatus, readStatusRefusal, secretShapeOk, sheetRuns,
  type DoorProvider, type SignInMethod, type SignInReading,
} from './connectFlow';
import type { ProviderRow } from '../../../shared/providers';
import '../fleet/fleet.css';

type Frame = 'provider' | 'name' | 'method' | 'run' | 'result';
type Announcement = { readonly kind: 'status' | 'alert'; readonly text: string };

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type ConnectClient = Pick<typeof api, 'accountAdd' | 'accountCheck' | 'accountEnable'>;
/** The sign-in's routes (Task A22), injectable the same way: the attempt, `set {stated}`, the sign-out and discard. */
export type SignInClient = Pick<typeof api,
  'accountAuthStart' | 'accountAuthStatus' | 'accountAuthCode' | 'accountAuthCancel' | 'accountSet' | 'accountSignOut' | 'accountRemove'>;

/** How often an open sheet reads a live attempt's status (spec §6.2 step 5). */
export const AUTH_POLL_MS = 1500;

/** A live attempt as this sheet holds it: the server's id and deadline (the LAST one it answered), the state the helper
 *  last published, the URL and host the server accepted (kept once seen), and whether its one code went. */
interface Attempt {
  readonly attemptId: string;
  readonly method: SignInMethod;
  readonly expiresAt: number;
  readonly state: AuthStatusState | null;
  readonly url: string | null;
  readonly host: string | null;
  readonly codeSent: boolean;
}
type RunAct = (act: () => Promise<unknown>) => Promise<'done' | 'step-up'>;
const plainRun: RunAct = async (act) => { await act(); return 'done'; };

export interface ConnectSheetProps {
  open: boolean;
  onClose: () => void;
  roster: readonly RosterWire[];
  connect: AccountsConnect | null;
  /** The offline refusal (`offlineRefusal`), or `null` while the store reads the server. */
  offline: string | null;
  /** Re-reads `/api/accounts` through the store, its one reader: `'ok'` once an answer carrying a roster landed,
   *  `'error'` when the read failed (the store's `refreshAccounts`, which never rejects). */
  refresh: () => Promise<'ok' | 'error'>;
  /** The roster as the store holds it NOW (read after `refresh` resolves, so an outcome unknown sees the re-read). */
  readRoster: () => readonly RosterWire[];
  client?: ConnectClient;
  signInClient?: SignInClient;
  stepUpDeps?: StepUpDeps;
  /** The provider table the method radio reads its order from; the real one by default. */
  table?: Readonly<Record<DoorProvider, Pick<ProviderRow, 'connect'>>>;
}

/** The `error` word an `ApiError` carries, or `undefined` for a request that never completed. */
function wordOf(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const b = err.body;
  const v = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)['error'] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** A refusal's body field when it is a string, or `undefined`. The words file holds it to a plain word before it
 *  prints it (`signInStartRefusal`). */
function fieldOf(err: unknown, k: string): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const b = err.body;
  const v = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)[k] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** The poll of a live attempt and its deadline: mounted only while the attempt is live and the screen is online, so a
 *  closed sheet, an ended attempt or an offline screen reads nothing. */
function AuthWatch({ id, client, expiresAt, onOutcome, onExpired }: {
  id: string; client: SignInClient; expiresAt: number;
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

/** The step-up for the frame that shows it. Mounted only while that frame is drawn and the screen is online, so the
 *  challenge is fetched when the step is SHOWN (`useStepUp`'s rule) and an offline sheet sends nothing. */
function StepUpGate({ freshUntil, deps, children }: {
  freshUntil: number | null; deps: StepUpDeps | undefined; children: (s: StepUp) => ReactNode;
}): ReactNode {
  const s = useStepUp(freshUntil, deps);
  return children(s);
}
const NO_DEPS: StepUpDeps = {};

export function ConnectSheet(props: ConnectSheetProps): ReactNode {
  const { open, onClose, roster, connect, offline, refresh, readRoster } = props;
  const client = props.client ?? api;
  const sc: SignInClient = props.signInClient ?? api;
  const blocked = offline !== null;

  const [frame, setFrame] = useState<Frame>('provider');
  const [provider, setProvider] = useState<DoorProvider | null>(null);
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [hue, setHue] = useState<Hue>(() => defaultHue(roster));
  const [found, setFound] = useState<ConfigDirFound | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [picked, setPicked] = useState<ConnectMethod | null>(null);
  const [hasSecret, setHasSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [lane, setLane] = useState<LaneWire | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  /** An outcome unknown whose re-read failed too: the run frame holds Read again until a read lands. */
  const [unread, setUnread] = useState(false);
  const [said, setSaid] = useState<Announcement | null>(null);
  // The sign-in (Task A22). `att` is the live attempt (null once it ended or before it began); `end` the terminal
  // sentence; `lapsed` a step-up the server refused, so the next gate shows the step whatever the store's stamp says.
  const [att, setAttState] = useState<Attempt | null>(null);
  const attRef = useRef<Attempt | null>(null);
  const putAtt = (a: Attempt | null): void => { attRef.current = a; setAttState(a); };
  const [end, setEnd] = useState<string | null>(null);
  const [endNotice, setEndNotice] = useState<string | null>(null);
  const [discarded, setDiscarded] = useState(false);
  const [lapsed, setLapsed] = useState(false);
  const [codeKey, setCodeKey] = useState(0);
  const [codeNotice, setCodeNotice] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [wrongOpen, setWrongOpen] = useState(false);
  const [statedBusy, setStatedBusy] = useState(false);
  const [statedNotice, setStatedNotice] = useState<string | null>(null);
  const codeNoticeId = useId();
  const secret = useRef<SecretFieldHandle>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const noticeId = useId();

  // Closed: the field is emptied (it unmounts with the sheet's body, and this says so even if a transition keeps it).
  useEffect(() => { if (!open) secret.current?.clear(); }, [open]);
  // Offline: the field is not drawn, so it unmounts; its value goes with its node.

  const status = (text: string): void => setSaid({ kind: 'status', text });
  const alert = (text: string): void => setSaid({ kind: 'alert', text });
  const write = (text: string): void => setLedger((l) => [...l, { text, at: Date.now() }]);
  /** The last line was a step's running form: replace it with its result. */
  const settle = (text: string): void => setLedger((l) => [...l.slice(0, -1), { text, at: Date.now() }]);

  const choices = provider === null ? null : methodChoices(provider, connect, props.table);
  const method = picked !== null && choices?.choices.some((c) => c.value === picked && c.narrowed === null)
    ? picked : choices?.selected ?? null;

  const check = async (): Promise<void> => {
    write(LEDGER.checking(id));
    status(LEDGER.checking(id));
    const t0 = Date.now();
    let refused: string | null = null;
    try {
      const a = await client.accountCheck(id);
      if (!live.current) return;
      const ms = Date.now() - t0;
      setLatency(ms);
      setLane(a.lane);
      settle(LEDGER.checked);
      setNotice(null);
    } catch (e) {
      if (!live.current) return;
      // A refused (or unanswered) check leaves no lane read: an earlier answer is not this one's, so the result frame
      // holds Turn it on with this sentence beneath it and offers Check again (D-7740 (4)).
      refused = laneActRefusal('check', id, e);
      setLane(null);
      setLatency(null);
      settle(refused);
      setNotice(refused);
    }
    await refresh();
    if (!live.current) return;
    setFrame('result');
    // The terminal state is announced as what it is: the refusal, or the lane added and off.
    alert(refused ?? resultDone(id, false));
  };

  /** The add's answer never came: re-read, and resume where the reconciled roster says. Never a second add. */
  const reconcile = async (): Promise<void> => {
    write(OUTCOME_UNKNOWN);
    alert(OUTCOME_UNKNOWN);
    await reread();
  };

  /** The re-read itself. A read that failed reconciled nothing: the store's roster is the one held before the add, so
   *  "nothing was added" would be a guess. The sheet says the outcome is still unknown and offers Read again. */
  const reread = async (): Promise<void> => {
    const read = await refresh();
    if (!live.current) return;
    if (read !== 'ok') {
      const text = stillUnknownAfterUnknown(id);
      setUnread(true);
      setNotice(text);
      setFrame('run');
      alert(text);
      return;
    }
    setUnread(false);
    setNotice(null);
    // The unknown line stays in the ledger: what the re-read found is written after it.
    if (readRoster().some((r) => r.id === id)) {
      write(LEDGER.found(id));
      // The lane exists: a sign-in lane resumes at its sign-in (spec §6.2 step 4), a pasted one at its check.
      if (isSignInMethod(method)) await startSignIn(method); else await check();
      return;
    }
    const text = notFoundAfterUnknown(id);
    setNotice(text);
    setFrame('method');
    alert(text);
  };

  const submit = async (stepUp: StepUp): Promise<void> => {
    if (blocked || busy || provider === null || method === null) return;
    const signIn = isSignInMethod(method);
    // A sign-in lane is added with no credential (spec §6.2 step 3); a pasted token is read once, and the field is
    // empty from here on, whatever the answer.
    let value: string | null = null;
    if (!signIn) {
      value = secret.current?.take() ?? '';
      if (value === '') { setNotice(TOKEN_CLEARED); alert(TOKEN_CLEARED); return; }
      if (!secretShapeOk(value)) {
        const r = addRefusal(id, 'key-charset')!;
        setNotice(r.text);
        alert(r.text);
        return;
      }
    }
    setBusy(true);
    setNotice(null);
    setFrame('run');
    const first = signIn ? SIGN_IN_LEDGER.creating(id) : LEDGER.adding(id);
    setLedger([{ text: first, at: Date.now() }]);
    status(first);
    const got: { answer: AccountAddAnswer | null } = { answer: null };
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => {
        got.answer = await client.accountAdd({
          provider, id, label, hue, method, ...(value !== null ? { credential: value } : {}), ...(adopt ? { adopt: true as const } : {}),
        });
      });
    } catch (e) {
      failure = e;
    }
    if (!live.current) return;
    try {
      if (outcome === 'step-up') {
        const text = signIn ? STEP_UP_AGAIN_ADD : STEP_UP_AGAIN;
        setNotice(text);
        setFrame('method');
        alert(text);
        return;
      }
      if (got.answer !== null) {
        settle(LEDGER.added(id));
        if (signIn) await startSignIn(method); else await check();
        return;
      }
      const word = wordOf(failure);
      if (word === undefined || word === 'outcome-unknown') { await reconcile(); return; }
      if (word === 'config-dir-exists') {
        const body = (failure as ApiError).body as Record<string, unknown>;
        const f: ConfigDirFound = typeof body['signedIn'] === 'boolean' ? { signedIn: body['signedIn'] } : {};
        setFound(f);
        setFrame('name');
        alert(configDirFoundText(id, f.signedIn));
        void refresh();
        return;
      }
      if (word === 'lane-exists') {
        // The server's roster holds the id though this screen's did not: re-read, and the name frame says it is taken.
        await refresh();
        if (!live.current) return;
        const r = addRefusal(id, 'duplicate-id')!;
        setNotice(r.text);
        setFrame('name');
        alert(r.text);
        return;
      }
      const r = addRefusal(id, word) ?? { frame: 'method' as const, text: ADD_REFUSED };
      setNotice(r.text);
      setFrame(r.frame);
      alert(r.text);
      void refresh();
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const turnOn = async (): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    write(LEDGER.enabling(id));
    status(LEDGER.enabling(id));
    try {
      const a = await client.accountEnable(id);
      if (!live.current) return;
      setLane(a.lane);
      const nowOn = a.lane.state.word !== 'off';
      setOn(nowOn);
      settle(nowOn ? LEDGER.on : resultDone(id, false));
      setNotice(null);
      alert(resultDone(id, nowOn));
    } catch (e) {
      if (!live.current) return;
      const text = laneActRefusal('switch', id, e);
      settle(text);
      setNotice(text);
      alert(text);
    }
    await refresh();
    if (live.current) setBusy(false);
  };

  const readAgain = async (): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    status(LEDGER.reading);
    await reread();
    if (live.current) setBusy(false);
  };

  const checkAgain = async (): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    await check();
    if (live.current) setBusy(false);
  };

  // ── The sign-in (Task A22, D-7849) ──────────────────────────────────────────────────────────────────────────────

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
  const endOf = (k: SignInEndKind, failure?: string): string => (k === 'failed' ? signInFailed(failure) : SIGN_IN_END[k](id));

  /** `auth/start` (spec §6.2 step 4), once. `runAct` is a mounted gate's (Start again), which shows the step itself on a
   *  `step-up-required`; the start right after the add is sent plainly, its step-up just taken. */
  const startSignIn = async (m: SignInMethod, runAct: RunAct = plainRun): Promise<void> => {
    putAtt(null);
    setEnd(null);
    setEndNotice(null);
    setCodeNotice(null);
    setWrongOpen(false);
    setFrame('run');
    write(SIGN_IN_LEDGER.starting);
    status(SIGN_IN_LEDGER.starting);
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
      ({ attemptId, method: m, expiresAt, state: null, url: null, host: null, codeSent: false });
    if (outcome === 'step-up') { setLapsed(true); finish(signInStartRefusal(id, 'step-up-required', undefined)); return; }
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
    if (word === undefined || word === 'outcome-unknown') { finish(SIGN_IN_END.unknown(id)); return; }
    if (word === 'step-up-required') setLapsed(true);
    finish(signInStartRefusal(id, word, fieldOf(failure, 'reason')));
  };

  /** The helper says `done`: the lane holds its credential, so the check runs (spec §6.2 step 8) into the result. */
  const signedIn = async (a: Attempt): Promise<void> => {
    putAtt(null);
    settle(a.method === 'login' ? SIGN_IN_LEDGER.signedIn : SIGN_IN_LEDGER.minted);
    setBusy(true);
    await check();
    if (live.current) setBusy(false);
  };

  /** One reading of the attempt: still live (the ledger and the cards follow the state), done, or ended. */
  const apply = (a: Attempt, r: SignInReading, next: Attempt): void => {
    if (r.kind === 'done') { void signedIn(next); return; }
    if (r.kind === 'end') { finish(endOf(r.end, r.failure)); return; }
    const before = a.url !== null;
    putAtt(next);
    // The URL arrived: the sheet now waits on the operator (the amber pulse), and says so once.
    if (!before && next.url !== null && !next.codeSent) {
      settle(SIGN_IN_LEDGER.waiting);
      status(SIGN_IN_LEDGER.waiting);
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
    const url = typeof ans.url === 'string' && typeof ans.host === 'string' ? ans.url : a.url;
    const host = typeof ans.url === 'string' && typeof ans.host === 'string' ? ans.host : a.host;
    const next: Attempt = {
      ...a, state: ans.state, url, host, expiresAt: typeof ans.expiresAt === 'number' ? ans.expiresAt : a.expiresAt,
    };
    apply(a, readStatus(ans.state, a.codeSent, typeof ans.failure === 'string' ? ans.failure : undefined), next);
  };

  /** The deadline passed with the attempt still live (spec §6.2's Expired, at `expiresAt`). */
  const onExpired = (): void => {
    const a = attRef.current;
    if (a !== null && Date.now() >= a.expiresAt) finish(SIGN_IN_END.expired(id));
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
      if (word === 'node-changed') { finish(SIGN_IN_END['node-changed'](id)); return; }
      if (word === 'no-auth-attempt') { finish(endOf(Date.now() >= a.expiresAt ? 'expired' : 'lost')); return; }
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
      if (live.current) finish(SIGN_IN_END.cancelled(id));
    } catch (e) {
      if (!live.current) return;
      const word = wordOf(e);
      if (word === 'no-auth-attempt') finish(endOf(Date.now() >= a.expiresAt ? 'expired' : 'lost'));
      else setCodeNotice(cancelRefused(word));
    } finally {
      if (live.current) setCancelling(false);
    }
  };

  /** Discard this lane (spec §6.2): one tap with step-up, from a terminal state, for the lane this sheet added. */
  const discard = async (stepUp: StepUp): Promise<void> => {
    if (blocked || busy) return;
    setBusy(true);
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => { await sc.accountRemove(id, { mode: 'discard' }); });
    } catch (e) {
      failure = e;
    }
    if (!live.current) return;
    if (outcome === 'step-up') setEndNotice(STEP_UP_AGAIN_DISCARD);
    else if (failure === null) {
      write(discardedDone(id));
      setDiscarded(true);
      setEndNotice(null);
      alert(discardedDone(id));
    } else {
      const text = removeRefusal(id, wordOf(failure)) ?? removeUnknown(id);
      setEndNotice(text);
      alert(text);
    }
    await refresh();
    if (live.current) setBusy(false);
  };

  /** "Not the account you meant? Sign this lane out and start again" (spec §6.2 step 10): N5's sign-out, then a new
   *  attempt of the same method. */
  const signOutRestart = async (stepUp: StepUp): Promise<void> => {
    if (blocked || busy || !isSignInMethod(method)) return;
    setBusy(true);
    let removed: boolean | null = null;
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => { removed = (await sc.accountSignOut(id)).signOut === 'removed'; });
    } catch (e) {
      failure = e;
    }
    if (!live.current) return;
    try {
      if (outcome === 'step-up') { setNotice(STEP_UP_AGAIN_SIGN_OUT); alert(STEP_UP_AGAIN_SIGN_OUT); return; }
      if (removed === null) {
        const text = signOutRefused(id, wordOf(failure));
        setNotice(text);
        alert(text);
        return;
      }
      setLane(null);
      setLatency(null);
      setOn(false);
      setNotice(null);
      write(SIGN_IN_LEDGER.signedOut(id, removed));
      await startSignIn(method, stepUp.runAct);
    } finally {
      if (live.current) setBusy(false);
    }
  };

  /** The mint's stated account (spec §6.3): `set {stated}`, then the lane as the server reads it. */
  const saveStated = async (text: string): Promise<void> => {
    if (blocked || statedBusy) return;
    setStatedBusy(true);
    try {
      const a = await sc.accountSet(id, { stated: text });
      if (!live.current) return;
      setLane(a.lane);
      setStatedNotice(null);
    } catch (e) {
      if (!live.current) return;
      setStatedNotice(statedRefused(wordOf(e)));
    } finally {
      if (live.current) setStatedBusy(false);
    }
  };

  const freshUntil = lapsed ? null : connect?.stepUpFreshUntil ?? null;
  const runs = provider !== null && method !== null && sheetRuns(provider, method);

  const back: FootAct = { label: 'Back', onClick: () => { setFrame('name'); setNotice(null); status(FRAME_SAID.name); } };
  let body: ReactNode;
  switch (frame) {
    case 'provider':
      body = (
        <ProviderFrame
          choices={providerChoices(connect)}
          blocked={blocked}
          onPick={(p) => { setProvider(p); setPicked(null); setFrame('name'); status(FRAME_SAID.name); }}
        />
      );
      break;
    case 'name':
      body = (
        <NameFrame
          id={id} label={label} hue={hue} roster={roster} found={found} notice={notice} blocked={blocked}
          onId={(v) => { setId(v); setFound(null); setAdopt(false); setNotice(null); }}
          onLabel={setLabel}
          onHue={setHue}
          onBack={() => { setFrame('provider'); setNotice(null); status(FRAME_SAID.provider); }}
          onContinue={() => { setNotice(null); setFrame('method'); status(FRAME_SAID.method); }}
          onPickAnother={() => { setFound(null); setAdopt(false); setId(''); status(PICK_ANOTHER_NAME); }}
          onUseThere={() => { setFound(null); setAdopt(true); setFrame('method'); status(FRAME_SAID.adopt); }}
        />
      );
      break;
    case 'method':
      body = choices === null ? null : (
        <MethodFrame choices={choices.choices} selected={method} onSelect={(m) => { setPicked(m); setNotice(null); }}>
          {method !== null && !runs && <p className="acct-notice">{NEEDS_APP_UPDATE}</p>}
          {method === 'paste' && runs && !blocked && (
            <SecretField label={TOKEN_FIELD_LABEL} handle={secret} onPresence={setHasSecret} describedBy={notice !== null ? noticeId : undefined} />
          )}
          {notice !== null && <p className="acct-notice" id={noticeId}>{notice}</p>}
          {!blocked && runs ? (
            <StepUpGate freshUntil={freshUntil} deps={props.stepUpDeps ?? NO_DEPS}>
              {(stepUp) => (
                <>
                  <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
                  <FrameFoot
                    quiet={[back]}
                    primary={isSignInMethod(method)
                      ? { label: ADD_AND_SIGN_IN, onClick: () => { void submit(stepUp); }, disabled: busy || stepUp.needed, busy }
                      : { label: ADD_LANE, onClick: () => { void submit(stepUp); }, disabled: busy || stepUp.needed || !hasSecret, busy }}
                  />
                </>
              )}
            </StepUpGate>
          ) : (
            <FrameFoot quiet={[back]} primary={{ label: isSignInMethod(method) ? ADD_AND_SIGN_IN : ADD_LANE, onClick: () => {}, disabled: true }} />
          )}
        </MethodFrame>
      );
      break;
    case 'run':
      if (att !== null && isSignInMethod(method)) {
        // A live attempt (spec §6.2 steps 4–7). Offline: the sentence with the last-known deadline, and nothing to act on
        // but a Cancel the screen refuses.
        const waiting = att.url !== null && !att.codeSent;
        body = (
          <RunFrame lines={ledger} live waiting={waiting && !blocked}>
            {!blocked && <AuthWatch id={id} client={sc} expiresAt={att.expiresAt} onOutcome={onStatus} onExpired={onExpired} />}
            {blocked ? (
              <p className="acct-offline" data-sign-in-offline="true">{signInOffline(att.expiresAt)}</p>
            ) : (
              <>
                {att.url !== null && att.host !== null && !att.codeSent && <UrlCard url={att.url} host={att.host} method={att.method} />}
                {att.url !== null && (
                  <CodeField key={codeKey} onSend={(c) => { void sendCode(c); }} disabled={att.codeSent}
                    describedBy={codeNotice !== null ? codeNoticeId : undefined} />
                )}
                {codeNotice !== null && <p className="acct-notice" id={codeNoticeId}>{codeNotice}</p>}
                <Countdown expiresAt={att.expiresAt} waiting={waiting} />
              </>
            )}
            <FrameFoot quiet={[{ label: CANCEL_SIGN_IN, onClick: () => { void cancel(); }, disabled: blocked || cancelling }]} />
          </RunFrame>
        );
        break;
      }
      if (end !== null && isSignInMethod(method)) {
        // A terminal state of the sign-in (spec §6.2): what did not happen, then Start again or Discard this lane.
        body = (
          <RunFrame lines={ledger} live={busy}>
            {endNotice !== null && <p className="acct-notice">{endNotice}</p>}
            {discarded ? (
              <FrameFoot primary={{ label: DONE, onClick: onClose }} />
            ) : !blocked ? (
              <StepUpGate freshUntil={freshUntil} deps={props.stepUpDeps ?? NO_DEPS}>
                {(stepUp) => (
                  <>
                    <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
                    <FrameFoot
                      quiet={[{ label: DISCARD_LANE, onClick: () => { void discard(stepUp); }, disabled: busy || stepUp.needed }]}
                      primary={{ label: START_AGAIN, onClick: () => { void startSignIn(method, stepUp.runAct); }, disabled: busy || stepUp.needed, busy }}
                    />
                  </>
                )}
              </StepUpGate>
            ) : (
              <FrameFoot quiet={[{ label: DISCARD_LANE, onClick: () => {}, disabled: true }]} primary={{ label: START_AGAIN, onClick: () => {}, disabled: true }} />
            )}
          </RunFrame>
        );
        break;
      }
      body = (
        <>
          <RunFrame lines={ledger} live={busy} />
          {unread && notice !== null && <p className="acct-notice" id={noticeId}>{notice}</p>}
          {unread && (
            <FrameFoot primary={{
              label: READ_AGAIN, onClick: () => { void readAgain(); }, disabled: busy || blocked, busy, describedBy: noticeId,
            }} />
          )}
        </>
      );
      break;
    case 'result':
      body = (
        <>
          <RunFrame lines={ledger} live={busy} />
          <ResultFrame
            id={id} lane={lane} latencyMs={latency} on={on} busy={busy} notice={notice} blocked={blocked}
            nowSec={Math.floor(Date.now() / 1000)}
            onTurnOn={() => { void turnOn(); }}
            onCheckAgain={() => { void checkAgain(); }}
            onClose={onClose}
            {...(isSignInMethod(method) ? {
              signIn: {
                method,
                wrongAccount: wrongOpen && !blocked ? (
                  <StepUpGate freshUntil={freshUntil} deps={props.stepUpDeps ?? NO_DEPS}>
                    {(stepUp) => (
                      <div className="acct-wrong-confirm">
                        <p className="acct-field-note">{signOutConfirm(id, method)}</p>
                        <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
                        <FrameFoot
                          quiet={[{ label: KEEP_IT, onClick: () => setWrongOpen(false), disabled: busy }]}
                          primary={{ label: SIGN_OUT_RESTART, onClick: () => { void signOutRestart(stepUp); }, disabled: busy || stepUp.needed, busy }}
                        />
                      </div>
                    )}
                  </StepUpGate>
                ) : (
                  <Button variant="ghost" size="fit" className="acct-wrong-act" disabled={busy || blocked} onClick={() => setWrongOpen(true)}>
                    {SIGN_OUT_RESTART}
                  </Button>
                ),
                ...(method === 'setup-token' ? { onStated: (t: string) => { void saveStated(t); }, statedBusy, statedNotice } : {}),
              },
            } : {})}
          />
          {/* The compromise disclosure (spec §3.11; Task A19): in the token, Codex and OpenRouter result frames, never a
              sign-in's. */}
          {method !== 'login' && <CompromiseSteps roster={roster} />}
        </>
      );
      break;
  }

  return (
    <Sheet open={open} onClose={onClose} title="Add account" eyebrow={provider === null ? undefined : PROVIDER_ROWS[provider].name} size="md">
      <div className="acct-connect" data-frame={frame}>
        {/* One live region per sheet (spec §12.4): a step change is polite, a terminal state an alert. */}
        <div className="sr-only">
          <p role="status" data-testid="connect-status">{said?.kind === 'status' ? said.text : ''}</p>
          <p role="alert" data-testid="connect-alert">{said?.kind === 'alert' ? said.text : ''}</p>
        </div>
        {offline !== null && <p className="acct-offline">{offline}</p>}
        {body}
      </div>
    </Sheet>
  );
}

/** The door's reason, beneath it, and the command that fixes it when there is one. */
export function DoorReason({ id, text, fix }: { id: string; text: string; fix?: string }): ReactNode {
  return (
    <div className="acct-door-reason">
      <p className="m-0" id={id}>{text}</p>
      {fix !== undefined && <CopyCommand command={fix} />}
    </div>
  );
}

/**
 * THE ADD ACCOUNT DOOR (D-5522; spec §5): one per width. On a phone (both skins) it is the lane list's last row, a
 * `ListRow` whose height is the skin's row (52px in Refined, 44px in Instrument) with the meta line beside the word; on
 * desktop it is a secondary button in the page's header. It NARROWS IN PLACE, never vanishes: `aria-disabled`, still
 * focusable, its reason named by `aria-describedby` and drawn beneath it. No palette command and no hint key.
 */
export function AddAccountDoor({ desk, narrowedBy, onOpen }: {
  desk: boolean;
  /** The reason's element id when the door is narrowed, or `null` when it opens. */
  narrowedBy: string | null;
  onOpen: () => void;
}): ReactNode {
  const narrowed = narrowedBy !== null;
  const tap = (): void => { if (!narrowed) onOpen(); };
  if (desk) {
    return (
      <Button
        variant="ghost" size="fit" className="acct-door-action"
        aria-disabled={narrowed || undefined} aria-describedby={narrowedBy ?? undefined}
        data-narrowed={narrowed ? 'true' : undefined} onClick={tap}
      >
        <span aria-hidden="true">＋</span> {DOOR_WORD}
      </Button>
    );
  }
  return (
    <ListRow
      className="acct-door"
      aria-label={DOOR_WORD}
      aria-disabled={narrowed || undefined} aria-describedby={narrowedBy ?? undefined}
      data-narrowed={narrowed ? 'true' : undefined} onClick={tap}
    >
      <span className="acct-door-word"><span aria-hidden="true">＋</span> {DOOR_WORD}</span>
      <span className="acct-door-meta" aria-hidden="true">{DOOR_META}</span>
    </ListRow>
  );
}
