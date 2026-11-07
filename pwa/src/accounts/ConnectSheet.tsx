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
// field, no Send, and no poll. The code lives only in the code field's DOM node and the one request. The attempt itself
// is `useSignInAttempt`'s (Task A23, D-7871 (2)), which the method switch sheet runs too; this file holds the add, the
// check, the result and the sentences a new lane's terminal states say.
//
// THE CHATGPT LANE (Task A25, D-8051; spec §7.2): OpenAI has no method step, so the frame holds one line where the radio
// would be, Confirm it's you and the primary. Its add carries no method: `openai-login` is the attempt's, and `add` refuses
// it. The attempt is the same one with no code to send: the run frame shows the device-code card, the helper's `done`
// means the operator approved, and the check that follows starts the lane's gateway. The result frame carries the
// compromise disclosure, and no wrong-account act: a Codex lane has no sign-out.
//
// RESUME (Task A23, D-7871 (2); spec §6.2): opened with `resume`, the sheet adopts the attempt the server holds for this
// session on a lane it added, at the run frame, and the first poll brings back the URL and the code field.
//
// ANNOUNCEMENTS (spec §12.4). One live region per sheet: a step change is announced politely (`role="status"`), and a
// terminal state (refused, outcome unknown, done) as an alert (`role="alert"`). A frame that only re-renders announces
// nothing: an announcement is written by a transition, never by a render.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, ListRow } from '@ccrc/ui';
import { AccountSheet, type Announcement } from './AccountSheet';
import type { AccountAddAnswer, AccountsConnect, LaneWire, RosterWire } from '../../../shared/api';
import type { ConnectMethod } from '../../../shared/providers';
import type { Hue } from '../../../shared/roster';
import { ApiError, api } from '../lib/api';
import {
  ADD_LANE, ADD_REFUSED, DOOR_META, FRAME_SAID, PICK_ANOTHER_NAME, STEP_UP_AGAIN, PROVIDER_ROWS, DOOR_WORD, LEDGER, NEEDS_APP_UPDATE, OUTCOME_UNKNOWN, TOKEN_CLEARED, TOKEN_FIELD_LABEL,
  READ_AGAIN, addRefusal, configDirFoundText, laneActRefusal, notFoundAfterUnknown, resultDone, stillUnknownAfterUnknown,
  ADD_AND_SIGN_IN, CHATGPT_MODELS, DISCARD_LANE, DONE, SIGN_IN_LEDGER, checkedLine, checkingLine, signInLedger,
  STEP_UP_AGAIN_DISCARD, STEP_UP_AGAIN_SIGN_OUT, START_AGAIN, discardedDone, removeRefusal, removeUnknown,
  signOutConfirm, signOutRefused, signOutUnknown, statedRefused, STEP_UP_AGAIN_ADD,
} from '../fleet/accountWords';
import { CompromiseSteps } from './CompromiseSteps';
import { ConfirmItsYou } from './ConfirmItsYou';
import { CopyCommand } from '../fleet/TroubleCard';
import { FrameFoot, type FootAct } from './FrameFoot';
import { MethodFrame } from './MethodFrame';
import { NameFrame, type ConfigDirFound } from './NameFrame';
import { ProviderFrame } from './ProviderFrame';
import { ResultFrame } from './ResultFrame';
import { RunFrame, type LedgerLine } from './RunFrame';
import { SecretField, type SecretFieldHandle } from './SecretField';
import { useStepUp, type StepUp, type StepUpDeps } from './useStepUp';
import {
  addMethodField, defaultHue, isSignInMethod, methodChoices, providerChoices, secretShapeOk, sheetRuns, type DoorProvider,
} from './connectFlow';
import { readLaneAfterSignOut } from './useOldCredential';
import { SignInLive, WrongAccountAct, fieldOf, newLaneEnd, useSignInAttempt, wordOf, type Attempt, type HeldAttempt, type SignInRoutes } from './useSignInAttempt';
import type { ProviderRow } from '../../../shared/providers';
import '../fleet/fleet.css';

type Frame = 'provider' | 'name' | 'method' | 'run' | 'result';

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type ConnectClient = Pick<typeof api, 'accountAdd' | 'accountCheck' | 'accountEnable'>;
/** The sign-in's routes (Task A22), injectable the same way: the attempt, `set {stated}`, the sign-out and discard. */
export type SignInClient = SignInRoutes & Pick<typeof api, 'accountSet' | 'accountSignOut' | 'accountRemove'>;

export { AUTH_POLL_MS } from './useSignInAttempt';

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
  /** Opened to resume (Task A23, D-7871 (2)): the lane this session added and the attempt the server holds for it. The
   *  sheet starts at the run frame with that attempt, and starts nothing. */
  resume?: { readonly id: string; readonly held: HeldAttempt };
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
  const resumed = props.resume;

  const [frame, setFrame] = useState<Frame>(resumed !== undefined ? 'run' : 'provider');
  const [provider, setProvider] = useState<DoorProvider | null>(
    resumed === undefined ? null : resumed.held.method === 'openai-login' ? 'openai' : 'anthropic');
  const [id, setId] = useState(resumed?.id ?? '');
  const [label, setLabel] = useState('');
  const [hue, setHue] = useState<Hue>(() => defaultHue(roster));
  const [found, setFound] = useState<ConfigDirFound | null>(null);
  const [adopt, setAdopt] = useState(false);
  const [picked, setPicked] = useState<ConnectMethod | null>(resumed?.held.method ?? null);
  const [hasSecret, setHasSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerLine[]>(() =>
    (resumed !== undefined ? [{ text: signInLedger(resumed.held.method).waiting, at: Date.now() }] : []));
  const [lane, setLane] = useState<LaneWire | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [on, setOn] = useState(false);
  const [busy, setBusy] = useState(false);
  /** An outcome unknown whose re-read failed too: the run frame holds Read again until a read lands. */
  const [unread, setUnread] = useState(false);
  const [said, setSaid] = useState<Announcement | null>(null);
  // The sign-in (Task A22): the attempt, its terminal sentence and its step-up are `useSignInAttempt`'s (below).
  const [discarded, setDiscarded] = useState(false);
  const [wrongOpen, setWrongOpen] = useState(false);
  const [statedBusy, setStatedBusy] = useState(false);
  const [statedNotice, setStatedNotice] = useState<string | null>(null);
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
  // A resumed attempt's method is the one it runs, whatever the radio would offer now.
  const method = picked !== null && (resumed !== undefined || choices?.choices.some((c) => c.value === picked && c.narrowed === null))
    ? picked : choices?.selected ?? null;

  const check = async (): Promise<void> => {
    write(checkingLine(id, method));
    status(checkingLine(id, method));
    const t0 = Date.now();
    let refused: string | null = null;
    try {
      const a = await client.accountCheck(id);
      if (!live.current) return;
      const ms = Date.now() - t0;
      setLatency(ms);
      setLane(a.lane);
      const line = checkedLine(a.lane);
      settle(line);
      if (line !== LEDGER.checked) refused = line;
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
    // The terminal state is announced as what it is: the refusal, a check that did not pass, or the lane added and off.
    alert(refused ?? resultDone(id, false));
  };

  /** The helper says `done`: the lane holds its credential, so the check runs (spec §6.2 step 8) into the result. */
  const signedIn = async (a: Attempt): Promise<void> => {
    settle(signInLedger(a.method).done);
    setBusy(true);
    await check();
    if (live.current) setBusy(false);
  };
  const s = useSignInAttempt({
    id, client: sc, blocked, write, settle, status, alert, endText: newLaneEnd(id, method),
    onStart: () => { setWrongOpen(false); setFrame('run'); },
    onDone: (a) => { void signedIn(a); },
  });
  // Resume (D-7871 (2)): the held attempt is adopted once, on the sheet's first mount.
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || resumed === undefined) return;
    adopted.current = true;
    s.resume(resumed.held);
  });

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
      const text = stillUnknownAfterUnknown(id, isSignInMethod(method));
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
      if (isSignInMethod(method)) await s.start(method); else await check();
      return;
    }
    const text = notFoundAfterUnknown(id, isSignInMethod(method));
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
          provider, id, label, hue, ...addMethodField(method), ...(value !== null ? { credential: value } : {}), ...(adopt ? { adopt: true as const } : {}),
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
        if (signIn) await s.start(method); else await check();
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
      const r = addRefusal(id, word, fieldOf(failure, 'verbCode')) ?? { frame: 'method' as const, text: ADD_REFUSED };
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
    if (outcome === 'step-up') s.setEndNotice(STEP_UP_AGAIN_DISCARD);
    else if (failure === null) {
      write(discardedDone(id));
      setDiscarded(true);
      s.setEndNotice(null);
      alert(discardedDone(id));
    } else {
      const text = removeRefusal(id, wordOf(failure)) ?? removeUnknown(id);
      s.setEndNotice(text);
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
    // The lane says what happened (D-7992), once it is read again: that is marked and asked for whether or not this sheet
    // is still open, on any answer that may have signed it out (an unknown one too).
    if (outcome === 'done' && (removed !== null || signOutUnknown(wordOf(failure)))) readLaneAfterSignOut(id, removed !== null, refresh);
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
      await s.start(method, stepUp.runAct);
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

  const freshUntil = s.lapsed ? null : connect?.stepUpFreshUntil ?? null;
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
          onContinue={() => { setNotice(null); setFrame('method'); status(provider === 'openai' ? FRAME_SAID.chatgpt : FRAME_SAID.method); }}
          onPickAnother={() => { setFound(null); setAdopt(false); setId(''); status(PICK_ANOTHER_NAME); }}
          onUseThere={() => { setFound(null); setAdopt(true); setFrame('method'); status(provider === 'openai' ? FRAME_SAID.chatgpt : FRAME_SAID.adopt); }}
        />
      );
      break;
    case 'method':
      body = choices === null ? null : (
        <MethodFrame
          choices={choices.choices} selected={method} onSelect={(m) => { setPicked(m); setNotice(null); }}
          {...(provider === 'openai' ? { only: CHATGPT_MODELS } : {})}
        >
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
      if (s.att !== null && isSignInMethod(method)) {
        // A live attempt (spec §6.2 steps 4–7): `SignInLive`, the switch sheet's too.
        body = <SignInLive s={s} att={s.att} id={id} client={sc} blocked={blocked} ledger={ledger} />;
        break;
      }
      if (s.end !== null && isSignInMethod(method)) {
        // A terminal state of the sign-in (spec §6.2): what did not happen, then Start again or Discard this lane.
        body = (
          <RunFrame lines={ledger} live={busy}>
            {s.endNotice !== null && <p className="acct-notice">{s.endNotice}</p>}
            {discarded ? (
              <FrameFoot primary={{ label: DONE, onClick: onClose }} />
            ) : !blocked ? (
              <StepUpGate freshUntil={freshUntil} deps={props.stepUpDeps ?? NO_DEPS}>
                {(stepUp) => (
                  <>
                    <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
                    <FrameFoot
                      quiet={[{ label: DISCARD_LANE, onClick: () => { void discard(stepUp); }, disabled: busy || stepUp.needed }]}
                      primary={{ label: START_AGAIN, onClick: () => { void s.start(method, stepUp.runAct); }, disabled: busy || stepUp.needed, busy }}
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
                ...(method !== 'openai-login' ? {
                  wrongAccount: (
                    <WrongAccountAct
                      open={wrongOpen} onOpen={() => setWrongOpen(true)} onKeep={() => setWrongOpen(false)}
                      confirm={signOutConfirm(id, method)} freshUntil={freshUntil} deps={props.stepUpDeps ?? NO_DEPS} busy={busy}
                      offline={blocked} onSignOut={(stepUp) => { void signOutRestart(stepUp); }}
                    />
                  ),
                } : {}),
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
    <AccountSheet
      open={open} onClose={onClose} title="Add account" eyebrow={provider === null ? undefined : PROVIDER_ROWS[provider].name}
      frame={frame} said={said} offline={offline} testIds="connect"
    >
      {body}
    </AccountSheet>
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
