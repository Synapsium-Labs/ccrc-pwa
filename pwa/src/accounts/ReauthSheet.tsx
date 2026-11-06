// RE-AUTHENTICATE AN EXISTING ANTHROPIC LANE (accounts plan Task A38, D-7872; spec §9 rows 1 and 2, §4.2, §4.4; D-5514,
// Q1): **Sign in again** on a sign-in lane, **Mint a new token** (the fold's and the Expiring card's Replace token, mint
// first) on a token lane. Both run A22's sign-in on the EXISTING lane, with the method it already has: no add, no Turn
// it on, no Discard. The box's same-method arm (A20) signs in, or mints, into a scratch dir and installs the new
// credential only once it has passed its own check, under the lane lock; until then the old one stays, so a refused,
// cancelled or expired attempt leaves the lane exactly as it was, and every such ending says so where the app knows the
// lane had a working credential (below). The two method
// switches are A23's sheet (`MethodSwitchSheet`), not this one.
//
// THE FRAMES. Confirm (what happens, then Confirm it's you when the stamp has lapsed, then the one primary: nothing is
// sent before it) → Run (`useSignInAttempt`'s, the connect sheet's and the switch sheet's own: the ledger, the URL card
// the server accepted, the code field, the countdown read from `expiresAt`, Cancel) → the ending. A terminal state
// says what is left of the old credential, from its code, and offers Start again. WHAT IT MAY SAY of the old credential
// is `oldCredentialOf`'s, the one rule (D-7872 (10), D-7992): that the lane keeps it only where the lane has one; that it
// is signed out where the lane says so or Sign this lane out and start again, below, just removed its sign-in; and the
// neutral words, true either way, where the provider refused the lane, a sign-out has not been read back, or a box too old to
// report it leaves the lane unsaid. `useOldCredential` reads it when
// a sentence is written, so a lane signed out elsewhere while the sheet is open gets the words its new facts allow, and
// the mint's restart lead and revoke item are held to it as well. Offline mid-attempt, the run frame shows
// only the sentence with the last-known deadline. Closed mid-attempt, the attempt keeps running on the box until
// `expiresAt`, and the app-level banner's Continue reopens this sheet with `resume` at the code field (A23, D-7871 (2)).
//
// EVERY ONE OF THEM ENDS THE SAME WAY (spec §9): the lane's live sessions with one-tap Restart (A23's `RestartList`),
// the revoke checklist item when a token was replaced (A19, N6), and a fresh check, whose word replaces the trouble
// card once the store reads the lane again. A sign-in's identity is read back, and when it is not the one the lane had,
// "Not the account this lane had? **Sign this lane out and start again**" (N5's sign-out, then a new attempt; G23 is
// unmeasured, so nothing is said about the provider). A mint cannot read its account, so the stated identity is asked
// again with the old one as its default text.
//
// A CODEX LANE (Task A25, D-8051; spec §9 row 5) runs this sheet too: **Sign in again** with the ChatGPT device-code card.
// A24's arm signs in into scratch and moves it into the lane's folder only on `done` and a passing check, so every
// ending above holds. The lane's gateway reloads the sign-in itself, so the restart list only offers a way out of a
// stuck session, and the fresh check starts the gateway. It has no identity to read back, and no token to revoke.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, TextLink } from '@ccrc/ui';
import type { AccountStateWord } from '../../../shared/accounts';
import type { AccountsConnect, AccountUsage, LaneWire, RosterWire } from '../../../shared/api';
import { api } from '../lib/api';
import { openExternal } from '../lib/markdown';
import { ensureSession } from '../session/useEnsure';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import {
  CHECK_AGAIN_LABEL, CLOSE, DONE, LEDGER, MINT_NEW_TOKEN, PASTE_A_TOKEN, PASTE_INSTEAD, REAUTH_WRONG, REPLACE_TOKEN,
  REVOKE_PAGES, SIGN_IN_AGAIN, SIGN_IN_LEDGER, signInLedger, START_SWITCH_AGAIN, STATE_LAMPS, STEP_UP_AGAIN_SIGN_OUT,
  SWITCH_TO_SIGN_IN, SWITCH_TO_TOKEN, chatgptSignedInLine, checkingLine, identityLine, laneActRefusal, reauthEnd, reauthInstalled, reauthIntro,
  reauthRestartLead, reauthSignOutConfirm, reauthStart, reauthStartRefusal, reauthTitle, reauthWasLine, revokeOldWords,
  signOutRefused, signOutUnknown, statedRefused,
} from '../fleet/accountWords';
import { AccountSheet, type Announcement } from './AccountSheet';
import { CompromiseSteps } from './CompromiseSteps';
import { ConfirmItsYou } from './ConfirmItsYou';
import { FrameFoot } from './FrameFoot';
import { RevokeItem, StepUpFor } from './RemoveSheet';
import { RestartList, restartableOn, useRestarts } from './RestartList';
import { StatedField } from './ResultFrame';
import { RunFrame, type LedgerLine } from './RunFrame';
import type { SignInMethod } from './connectFlow';
import { readLaneAfterSignOut, useOldCredential } from './useOldCredential';
import { SignInLive, WrongAccountAct, useSignInAttempt, wordOf, type HeldAttempt, type SignInRoutes } from './useSignInAttempt';
import type { StepUp, StepUpDeps } from './useStepUp';
import '../fleet/fleet.css';

// ── The acts, and which card offers which (spec §4.2, §4.4) ─────────────────────────────────────────────────────────

/** A lane's credential acts. `sign-in-again` and `mint-new-token`/`replace-token` are this sheet's; `paste-token` is
 *  A19's paste arm; the two switches are A23's switch sheet. */
export type CredentialAct = 'switch-to-token' | 'sign-in-again' | 'mint-new-token' | 'paste-token' | 'replace-token' | 'switch-to-sign-in';

/** Each act's words. */
export const CREDENTIAL_ACT_LABEL: Readonly<Record<CredentialAct, string>> = {
  'switch-to-token': SWITCH_TO_TOKEN,
  'sign-in-again': SIGN_IN_AGAIN,
  'mint-new-token': MINT_NEW_TOKEN,
  'paste-token': PASTE_A_TOKEN,
  'replace-token': REPLACE_TOKEN,
  'switch-to-sign-in': SWITCH_TO_SIGN_IN,
};

/** One act on a card, in its place: the first is the card's primary (spec §4.2) when the fleet can run a sign-in. */
export interface CardAct { readonly act: CredentialAct; readonly primary: boolean }

/**
 * An Anthropic lane's trouble-card acts, in order (spec §4.2's fix column), for its word and kind. `auth` is whether the
 * fleet can run a sign-in (`account-auth-v1` in `connect.caps`): without it only A19's paste arm is offered, as before.
 *  - Signed out, sign-in lane: **Switch to a long-lived token** (primary, Q1; A23's sheet) · Sign in again.
 *  - Signed out, token lane: **Mint a new token** (primary) · Paste a token.
 *  - Expiring (a minted token): **Replace token** (the mint) · Switch to sign-in (A23's sheet).
 *  - Signed out, Codex lane: **Sign in again** (primary, Task A25, D-8051), where the fleet runs the ChatGPT sign-in and
 *    can install it (`codex`: `account-codex-v1` in `connect.caps`, which the server holds back until its host is
 *    measured, on a lane ccrc owns: `managedCodex`).
 */
export function troubleActs(word: AccountStateWord, kind: string | undefined, auth: boolean, codex = false): readonly CardAct[] {
  const acts: CredentialAct[] = [];
  if (word === 'signed-out' && kind === 'codex' && auth && codex) acts.push('sign-in-again');
  else if (word === 'signed-out' && kind === 'sign-in' && auth) acts.push('switch-to-token', 'sign-in-again');
  else if (word === 'signed-out' && kind === 'token') acts.push(...(auth ? ['mint-new-token', 'paste-token'] as const : ['paste-token'] as const));
  else if (word === 'expiring' && kind === 'token') acts.push(...(auth ? ['replace-token', 'switch-to-sign-in'] as const : ['replace-token'] as const));
  return acts.map((act, i) => ({ act, primary: auth && i === 0 }));
}

// ── The sheet ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type ReauthClient = SignInRoutes
  & Pick<typeof api, 'accountCheck' | 'accountSet' | 'accountSignOut' | 'accountRevokeAck' | 'stop'>;

export interface ReauthSheetProps {
  id: string;
  /** The method this sheet runs, the lane's own: `login` or `openai-login` (Sign in again), or `setup-token` (Mint a new
   *  token). */
  method: SignInMethod;
  open: boolean;
  onClose: () => void;
  connect: AccountsConnect | null;
  /** Why the screen cannot act (offline, or `connectBlock`), or `null`. */
  blocked: string | null;
  /** The lane as the screen read it before the sheet opened: its identity is the one the lane had. */
  lane: LaneWire | undefined;
  /** The lane's telemetry row: its 401 marker is one of the facts `oldCredentialOf` reads (D-7872 (10)). */
  usage?: Pick<AccountUsage, 'authDead'> | null;
  /** The roster, for the compromise disclosure's providers. */
  roster: readonly RosterWire[];
  refresh: () => Promise<'ok' | 'error'>;
  /** A token lane's second way (A19's paste arm): closes this sheet and opens the paste sheet. */
  onPaste?: () => void;
  /** The attempt the server holds for this session on this lane, to continue at its code (A23, D-7871 (2)). */
  resume?: HeldAttempt;
  client?: ReauthClient;
  /** Starts one session again after its stop: the existing ensure route by default. */
  ensure?: (sessionId: string) => Promise<void>;
  stepUpDeps?: StepUpDeps;
  fleet?: FleetStore;
}

type Frame = 'confirm' | 'run' | 'done';
const NO_DEPS: StepUpDeps = {};

export function ReauthSheet(props: ReauthSheetProps): ReactNode {
  const { id, method, open, onClose, connect, blocked, roster, refresh } = props;
  const client = props.client ?? api;
  const ensure = props.ensure ?? ensureSession;
  const fleet = props.fleet ?? useFleetStore;
  const sessions = fleet((s) => s.sessions);
  const deps = props.stepUpDeps ?? NO_DEPS;
  const offline = blocked !== null;
  /** The identity the lane had when the sheet opened: the stated default, and what a sign-in's read-back is held to. */
  const before = useRef(props.lane).current;

  const [frame, setFrame] = useState<Frame>(props.resume !== undefined ? 'run' : 'confirm');
  const [ledger, setLedger] = useState<LedgerLine[]>(() =>
    (props.resume !== undefined ? [{ text: signInLedger(props.resume.method).waiting, at: Date.now() }] : []));
  const [said, setSaid] = useState<Announcement | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The fresh check's lane, or `null` when it was refused or never answered (its sentence is `checkNotice`). */
  const [checked, setChecked] = useState<LaneWire | null>(null);
  const [checkNotice, setCheckNotice] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  /** The sessions live on the lane when the new credential went in: the ones that may still hold the old one. */
  const [onOld, setOnOld] = useState<readonly string[]>([]);
  const { restarts, restart } = useRestarts(client.stop, ensure, offline);
  const [wrongOpen, setWrongOpen] = useState(false);
  const [statedBusy, setStatedBusy] = useState(false);
  const [statedNotice, setStatedNotice] = useState<string | null>(null);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  /** What this sheet may say of the lane's old credential (D-7872 (10)): read when a sentence is written, from the lane
   *  and the 401 marker as the screen holds them then, and `signed-out` once this sheet's own sign-out has removed the
   *  sign-in. */
  const old = useOldCredential(id, props.lane, props.usage);

  const status = (text: string): void => setSaid({ kind: 'status', text });
  const alert = (text: string): void => setSaid({ kind: 'alert', text });
  const write = (text: string): void => setLedger((l) => [...l, { text, at: Date.now() }]);
  const settle = (text: string): void => setLedger((l) => [...l.slice(0, -1), { text, at: Date.now() }]);

  /** The fresh check (spec §9: every re-login ends with one), then the store reads the lane again. */
  const check = async (): Promise<void> => {
    setChecking(true);
    write(checkingLine(id, method));
    status(checkingLine(id, method));
    try {
      const a = await client.accountCheck(id);
      if (!live.current) return;
      setChecked(a.lane);
      setCheckNotice(null);
      settle(LEDGER.checked);
    } catch (e) {
      if (!live.current) return;
      const text = laneActRefusal('check', id, e);
      setChecked(null);
      setCheckNotice(text);
      settle(text);
    }
    await refresh();
    if (live.current) setChecking(false);
  };

  /** The helper says `done`: the box installed the new credential after its own check (A20). The ending follows. */
  const installed = async (): Promise<void> => {
    old.freeze();
    settle(reauthInstalled(method));
    setOnOld(restartableOn(sessions, id));
    setFrame('done');
    alert(reauthInstalled(method));
    await check();
  };

  const s = useSignInAttempt({
    id, client, blocked: offline, write, settle, status, alert,
    endText: (k, failure, expiresAt) => reauthEnd(id, method, k, failure, old.now(), expiresAt),
    startRefusal: (word, reason) => reauthStartRefusal(id, method, word, reason, old.now()),
    onStart: () => { setNotice(null); setWrongOpen(false); setFrame('run'); },
    onDone: () => { void installed(); },
  });
  // Resume (A23, D-7871 (2)): the held attempt is taken up once, on the sheet's first mount.
  const resumedOnce = useRef(false);
  useEffect(() => {
    if (resumedOnce.current || props.resume === undefined) return;
    resumedOnce.current = true;
    s.resume(props.resume);
  });

  /** "Not the account this lane had? Sign this lane out and start again": N5's sign-out, then a new attempt. */
  const signOutRestart = async (stepUp: StepUp): Promise<void> => {
    if (offline || busy) return;
    setBusy(true);
    let removed: boolean | null = null;
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => { removed = (await client.accountSignOut(id)).signOut === 'removed'; });
    } catch (e) {
      failure = e;
    }
    // The lane says what happened (D-7992), once it is read again: that is marked and asked for whether or not the sheet
    // is still open, on any answer that may have signed it out (removed, absent, or no answer: `signOutUnknown`).
    if (outcome === 'done' && (removed !== null || signOutUnknown(wordOf(failure)))) readLaneAfterSignOut(id, removed !== null, refresh);
    if (!live.current) return;
    setBusy(false);
    if (outcome === 'step-up') { setNotice(STEP_UP_AGAIN_SIGN_OUT); alert(STEP_UP_AGAIN_SIGN_OUT); return; }
    if (removed === null) {
      const text = signOutRefused(id, wordOf(failure));
      setNotice(text);
      alert(text);
      return;
    }
    // Removed, the lane has no sign-in on the box now: every ending in this sheet until a new one goes in says so. Absent
    // proves nothing, since a sign-in on macOS lives in the keychain and no logout ran, so the lane says, once it is read.
    if (removed) old.signedOutHere();
    else old.readTheLane();
    setChecked(null);
    setCheckNotice(null);
    setOnOld([]);
    write(SIGN_IN_LEDGER.signedOut(id, removed));
    await s.start(method, stepUp.runAct);
  };

  /** A mint's stated account (spec §6.3), asked again: `set {stated}`, then the lane as the server reads it. */
  const saveStated = async (text: string): Promise<void> => {
    if (offline || statedBusy) return;
    setStatedBusy(true);
    try {
      const a = await client.accountSet(id, { stated: text });
      if (!live.current) return;
      setChecked(a.lane);
      setStatedNotice(null);
      void refresh();
    } catch (e) {
      if (!live.current) return;
      setStatedNotice(statedRefused(wordOf(e)));
    } finally {
      if (live.current) setStatedBusy(false);
    }
  };

  const freshUntil = s.lapsed ? null : connect?.stepUpFreshUntil ?? null;
  const { title, eyebrow } = reauthTitle(id, method);
  // The identity read back, against the one the lane had: only a sign-in reads one (a mint's is stated by the operator).
  const had = before?.identitySource === 'measured' ? before.identity : undefined;
  const now = checked?.identitySource === 'measured' ? checked.identity : undefined;
  const otherAccount = method === 'login' && had !== undefined && now !== undefined && had !== now;
  const page = REVOKE_PAGES['claude-code-settings'];
  /** A frame's one primary (a start), behind the step-up, beside its quiet act. Offline, the primary is drawn and
   *  refused, and so is the quiet act unless it only closes the sheet. */
  const startFoot = (label: string, quiet: { label: string; onClick: () => void; closes?: boolean } | null): ReactNode => (offline ? (
    <FrameFoot
      quiet={quiet === null ? [] : [quiet.closes === true ? quiet : { label: quiet.label, onClick: () => {}, disabled: true }]}
      primary={{ label, onClick: () => {}, disabled: true }}
    />
  ) : (
    <StepUpFor freshUntil={freshUntil} deps={deps}>
      {(stepUp) => (
        <>
          <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
          <FrameFoot
            quiet={quiet !== null ? [quiet] : []}
            primary={{ label, onClick: () => { void s.start(method, stepUp.runAct); }, disabled: busy || stepUp.needed, busy }}
          />
        </>
      )}
    </StepUpFor>
  ));

  let body: ReactNode;
  if (frame === 'confirm') {
    body = (
      <div className="acct-frame" data-frame="reauth">
        <p className="acct-field-note">{reauthIntro(id, method, old.now())}</p>
        {notice !== null && <p className="acct-notice" role="alert">{notice}</p>}
        {startFoot(reauthStart(method), props.onPaste !== undefined ? { label: PASTE_INSTEAD, onClick: props.onPaste } : null)}
      </div>
    );
  } else if (frame === 'run' && s.att !== null) {
    body = <SignInLive s={s} att={s.att} id={id} client={client} blocked={offline} ledger={ledger} />;
  } else if (frame === 'run' && s.end === null) {
    // The start is in flight, or a resumed attempt is being taken up.
    body = <RunFrame lines={ledger} live />;
  } else if (frame === 'run') {
    // A terminal state: what did not happen, then Start again (behind the step-up) or Close.
    body = (
      <RunFrame lines={ledger} live={false}>
        {startFoot(START_SWITCH_AGAIN, { label: CLOSE, onClick: onClose, closes: true })}
      </RunFrame>
    );
  } else {
    const word = (checked?.state.word ?? 'not-checked') as AccountStateWord;
    const lamp = STATE_LAMPS[word] ?? STATE_LAMPS['not-checked'];
    const identity = checked === null ? null
      : identityLine(checked, word, Math.floor(Date.now() / 1000)) ?? (method === 'openai-login' ? chatgptSignedInLine(checked) : null);
    const revoke = revokeOldWords(id, old.now());
    body = (
      <>
        <RunFrame lines={ledger} live={checking} />
        <div className="acct-frame" data-frame="reauthed">
          {checked !== null && (
            <p className="acct-result-word" data-state={word}>
              <span aria-hidden="true">{lamp.glyph}</span> {lamp.word} · {id}
            </p>
          )}
          {identity !== null && <p className="acct-result-line">{identity}</p>}
          {checkNotice !== null && (
            <>
              <p className="acct-notice">{checkNotice}</p>
              <div className="acct-actions">
                <Button variant="ghost" size="fit" disabled={checking || offline} onClick={() => { void check(); }}>{CHECK_AGAIN_LABEL}</Button>
              </div>
            </>
          )}
          {otherAccount && (
            <div className="acct-wrong-account">
              <span className="acct-result-line">{REAUTH_WRONG} {reauthWasLine(had)}</span>
              <WrongAccountAct
                open={wrongOpen} onOpen={() => setWrongOpen(true)} onKeep={() => setWrongOpen(false)}
                confirm={reauthSignOutConfirm(id)} freshUntil={freshUntil} deps={deps} busy={busy} offline={offline}
                onSignOut={(stepUp) => { void signOutRestart(stepUp); }}
              />
            </div>
          )}
          {notice !== null && <p className="acct-notice">{notice}</p>}
          {method === 'setup-token' && (
            <StatedField
              initial={before?.identity ?? ''} onSave={(t) => { void saveStated(t); }} busy={statedBusy}
              notice={statedNotice} blocked={offline}
            />
          )}
          <RestartList
            ids={onOld} lead={reauthRestartLead(onOld.length, method, old.now())} sessions={sessions} restarts={restarts}
            blocked={offline} onRestart={(sid) => { void restart(sid); }}
          />
          {method === 'setup-token' && (
            <>
              <p className="acct-result-line">
                {revoke.lead}{' '}
                <TextLink href={page.href} onClick={(e) => openExternal(e, page.href)}>{page.label}</TextLink>
                {revoke.tail}
              </p>
              <RevokeItem
                laneId={id} kind="anthropic-token" label={revoke.label} old={revoke.old} blocked={offline}
                ack={(b) => client.accountRevokeAck(b)}
              />
            </>
          )}
          {/* In the token and Codex sheets' result frames, never a Claude sign-in's (spec §3.11). */}
          {method !== 'login' && <CompromiseSteps roster={roster} />}
          <FrameFoot primary={{ label: DONE, onClick: onClose, disabled: checking }} />
        </div>
      </>
    );
  }

  return (
    <AccountSheet
      open={open} onClose={onClose} title={title} eyebrow={eyebrow} frame={frame} said={said} offline={blocked}
      testIds="reauth" className="acct-reauth"
    >
      {body}
    </AccountSheet>
  );
}
