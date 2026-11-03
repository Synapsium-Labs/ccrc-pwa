// THE TWO METHOD SWITCHES (accounts plan Task A23, D-7871; spec §9, §4.2, §4.4; Q1, N5).
//
// SWITCH TO A LONG-LIVED TOKEN (a sign-in lane: the fold's act, and the primary fix of a Signed-out sign-in lane). The
// sheet runs Mint on the existing lane (`auth/start {method: 'setup-token'}`): the box mints into scratch, probes the
// token and, only once it passes, switches the lane under its lock (A20); the poll's `done` means it did. A refused,
// cancelled or expired attempt changes nothing, and each terminal state says so. Then a fresh check; the stated
// identity, with the sign-in's readable email as its default text; the lane's sessions with one-tap Restart, since a
// running session started without the token; and last, **Sign the old sign-in out** (N5): a plain button once no
// listed session predates the switch, and before then the danger confirm, because the OA1 record did not measure what
// a live session does after its lane's sign-in is logged out (§9 unmeasured). Until then the lane holds both. The sheet
// closes on "Sessions on this lane won't ask you to sign in again for about a year".
//
// SWITCH TO SIGN-IN (a token lane). The sign-in runs into scratch and the token is kept until it has passed (A20);
// then the fresh check, the sessions with Restart, and the revoke checklist item for the old token (A19, N6).
//
// THE ATTEMPT is `useSignInAttempt`'s, the connect sheet's own: the URL card, the one code, the countdown read from
// `expiresAt`, Cancel, offline. Closed mid-attempt, it keeps running on the box until `expiresAt`, and the app-level
// banner offers Continue, which reopens this sheet with `resume` at the code field.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, TextLink } from '@ccrc/ui';
import { AccountSheet, type Announcement } from './AccountSheet';
import { isArchivedRow, type AccountsConnect, type LaneWire, type RosterWire } from '../../../shared/api';
import type { AccountStateWord } from '../../../shared/accounts';
import { api } from '../lib/api';
import { openExternal } from '../lib/markdown';
import { ensureSession } from '../session/useEnsure';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import {
  CLOSE, DONE, KEEP_IT, LEDGER, METHOD_LINES, REVOKED_OLD, REVOKE_PAGES,
  SIGN_IN_LEDGER, SIGN_OLD_OUT, SIGN_OLD_OUT_ANYWAY, START_SWITCH_AGAIN, STATE_LAMPS, STEP_UP_AGAIN_SIGN_OLD_OUT,
  SWITCH_CLOSE_TOKEN, SWITCH_START, atProviderWords, bothHeld, identityLine, laneActRefusal, restartLead, revokeOldLead,
  revokeOldTail, signOldOutDanger, signOldOutRefused, statedRefused, switchEnd, switchIntro, switchLedger,
  switchRestartLead, switchTitle,
} from '../fleet/accountWords';
import { presenceOf } from '../fleet/presence';
import { CompromiseSteps } from './CompromiseSteps';
import { GuardedAct, RevokeItem } from './RemoveSheet';
import { StatedField } from './ResultFrame';
import { RestartList, useRestarts } from './RestartList';
import { RunFrame, type LedgerLine } from './RunFrame';
import type { SignInMethod } from './connectFlow';
import { SignInLive, useSignInAttempt, wordOf, type Attempt, type HeldAttempt, type SignInRoutes } from './useSignInAttempt';
import type { StepUp, StepUpDeps } from './useStepUp';
import '../fleet/fleet.css';

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type SwitchClient = SignInRoutes
  & Pick<typeof api, 'accountCheck' | 'accountSet' | 'accountSignOut' | 'accountRevokeAck' | 'stop'>;

export interface MethodSwitchSheetProps {
  id: string;
  /** The method the lane switches TO: `setup-token` from a sign-in lane, `login` from a token lane. */
  to: SignInMethod;
  open: boolean;
  onClose: () => void;
  connect: AccountsConnect | null;
  /** Why the screen cannot act (offline, or `connectBlock`), or `null`. */
  blocked: string | null;
  roster: readonly RosterWire[];
  /** The lane as the screen read it when the sheet opened: the sign-in's readable email, the stated identity's default. */
  lane: LaneWire | undefined;
  refresh: () => Promise<'ok' | 'error'>;
  /** The attempt the server holds for this session on this lane, to continue at its code (D-7871 (2)). */
  resume?: HeldAttempt;
  client?: SwitchClient;
  /** Starts one session again after its stop: the existing ensure route by default. */
  ensure?: (sessionId: string) => Promise<void>;
  stepUpDeps?: StepUpDeps;
  fleet?: FleetStore;
}

type Phase = 'intro' | 'run' | 'checking' | 'done';
const NO_DEPS: StepUpDeps = {};

export function MethodSwitchSheet(props: MethodSwitchSheetProps): ReactNode {
  const { id, to, open, onClose, connect, blocked, roster, refresh } = props;
  const client = props.client ?? api;
  const ensure = props.ensure ?? ensureSession;
  const fleet = props.fleet ?? useFleetStore;
  const sessions = fleet((s) => s.sessions);
  const offline = blocked !== null;

  const [phase, setPhase] = useState<Phase>(props.resume !== undefined ? 'run' : 'intro');
  const [ledger, setLedger] = useState<LedgerLine[]>(() =>
    (props.resume !== undefined ? [{ text: SIGN_IN_LEDGER.waiting, at: Date.now() }] : []));
  const [said, setSaid] = useState<Announcement | null>(null);
  const [checked, setChecked] = useState<LaneWire | null>(null);
  /** The sessions live on the lane when the switch landed: the ones that started on the old credential. */
  const [onOld, setOnOld] = useState<readonly string[]>([]);
  const { restarts, restart } = useRestarts(client.stop, ensure, offline);
  const [confirming, setConfirming] = useState(false);
  const [signedOut, setSignedOut] = useState<boolean | null>(null);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [signOutNotice, setSignOutNotice] = useState<string | null>(null);
  const [statedBusy, setStatedBusy] = useState(false);
  const [statedNotice, setStatedNotice] = useState<string | null>(null);
  /** The sign-in's readable email, read once, when the sheet opened: the stated identity's default (spec §9). */
  const [oldIdentity] = useState<string>(() =>
    (props.lane?.identity !== undefined && props.lane.identitySource !== 'stated' ? props.lane.identity : ''));
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);

  const write = (text: string): void => setLedger((l) => [...l, { text, at: Date.now() }]);
  const settle = (text: string): void => setLedger((l) => [...l.slice(0, -1), { text, at: Date.now() }]);
  const status = (text: string): void => setSaid({ kind: 'status', text });
  const alert = (text: string): void => setSaid({ kind: 'alert', text });
  const liveOn = (): string[] =>
    sessions.filter((s) => s.wrapper === id && !isArchivedRow(s) && presenceOf(s) === 'alive').map((s) => s.id);

  /** The helper's `done`: the box has switched the lane (only a passing probe reaches it, A20). Then a fresh check. */
  const switched = async (a: Attempt): Promise<void> => {
    settle(a.method === 'login' ? SIGN_IN_LEDGER.signedIn : SIGN_IN_LEDGER.minted);
    write(switchLedger.switched(id, to));
    setOnOld(liveOn());
    setPhase('checking');
    write(LEDGER.checking(id));
    status(LEDGER.checking(id));
    let refused: string | null = null;
    try {
      const r = await client.accountCheck(id);
      if (!live.current) return;
      setChecked(r.lane);
      settle(LEDGER.checked);
    } catch (e) {
      if (!live.current) return;
      refused = laneActRefusal('check', id, e);
      settle(refused);
    }
    await refresh();
    if (!live.current) return;
    setPhase('done');
    alert(refused ?? switchLedger.switched(id, to));
  };

  const s = useSignInAttempt({
    id, client, blocked: offline, write, settle, status, alert,
    endText: (k, failure) => switchEnd(id, to, k, failure),
    onStart: () => setPhase('run'),
    onDone: (a) => { void switched(a); },
  });
  const adopted = useRef(false);
  useEffect(() => {
    if (adopted.current || props.resume === undefined) return;
    adopted.current = true;
    s.resume(props.resume);
  });

  /** Sign the old sign-in out (N5): `credential {signOut: true}`, behind the step-up. */
  const signOldOut = async (stepUp: StepUp): Promise<void> => {
    if (offline || signOutBusy || signedOut !== null) return;
    setSignOutBusy(true);
    let removed: boolean | null = null;
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => { removed = (await client.accountSignOut(id)).signOut === 'removed'; });
    } catch (e) {
      failure = e;
    }
    if (!live.current) return;
    setSignOutBusy(false);
    if (outcome === 'step-up') { setSignOutNotice(STEP_UP_AGAIN_SIGN_OLD_OUT); return; }
    if (removed === null) { setSignOutNotice(signOldOutRefused(id, wordOf(failure))); return; }
    setSignOutNotice(null);
    setConfirming(false);
    setSignedOut(removed);
    write(SIGN_IN_LEDGER.signedOut(id, removed));
    alert(SIGN_IN_LEDGER.signedOut(id, removed));
    void refresh();
  };

  const saveStated = async (text: string): Promise<void> => {
    if (offline || statedBusy) return;
    setStatedBusy(true);
    try {
      const a = await client.accountSet(id, { stated: text });
      if (!live.current) return;
      setChecked(a.lane);
      setStatedNotice(null);
    } catch (e) {
      if (!live.current) return;
      setStatedNotice(statedRefused(wordOf(e)));
    } finally {
      if (live.current) setStatedBusy(false);
    }
  };

  const freshUntil = s.lapsed ? null : connect?.stepUpFreshUntil ?? null;
  const deps = props.stepUpDeps ?? NO_DEPS;
  /** The listed sessions that still predate the switch: not yet restarted onto the new credential. */
  const predating = onOld.filter((sid) => restarts[sid] !== 'done').length;
  const toToken = to === 'setup-token';

  let body: ReactNode;
  if (phase === 'intro') {
    body = (
      <div className="acct-frame" data-frame="switch">
        <p className="acct-field-note">{switchIntro(id, to)}</p>
        <p className="acct-field-note">{METHOD_LINES[to].line}</p>
        <GuardedAct
          blocked={offline} freshUntil={freshUntil} deps={deps} label={SWITCH_START[to]} variant="primary"
          disabled={false} busy={false} onAct={(stepUp) => { void s.start(to, stepUp.runAct); }}
        />
      </div>
    );
  } else if (phase === 'run' && s.att !== null) {
    body = <SignInLive s={s} att={s.att} id={id} client={client} blocked={offline} ledger={ledger} />;
  } else if (phase === 'run' && s.end === null) {
    // The start is in flight, or a resumed attempt is being adopted.
    body = <RunFrame lines={ledger} live />;
  } else if (phase === 'run') {
    // A terminal state: what did not happen, then Start again (behind the step-up) or Close.
    body = (
      <RunFrame lines={ledger} live={false}>
        <GuardedAct
          blocked={offline} freshUntil={freshUntil} deps={deps} label={START_SWITCH_AGAIN} variant="primary"
          disabled={false} busy={false} onAct={(stepUp) => { void s.start(to, stepUp.runAct); }}
        />
        <div className="acct-actions"><Button variant="ghost" onClick={onClose}>{CLOSE}</Button></div>
      </RunFrame>
    );
  } else {
    const word = (checked?.state.word ?? 'not-checked') as AccountStateWord;
    const lamp = STATE_LAMPS[word] ?? STATE_LAMPS['not-checked'];
    const identity = checked === null ? null : identityLine(checked, word, Math.floor(Date.now() / 1000));
    const page = REVOKE_PAGES['claude-code-settings'];
    const provider = atProviderWords('anthropic-sign-in', 'unmeasured', undefined);
    const accountPage = REVOKE_PAGES['claude-account-settings'];
    body = (
      <>
        <RunFrame lines={ledger} live={phase === 'checking'} />
        {phase === 'done' && (
          <div className="acct-frame" data-frame="switched">
            <p className="acct-result-word" data-state={word}>
              <span aria-hidden="true">{lamp.glyph}</span> {lamp.word} · {id}
            </p>
            {identity !== null && <p className="acct-result-line">{identity}</p>}
            {toToken && (
              <StatedField
                initial={oldIdentity} busy={statedBusy} notice={statedNotice} blocked={offline}
                onSave={(t) => { void saveStated(t); }}
              />
            )}
            <RestartList
              ids={onOld} lead={toToken ? switchRestartLead(onOld.length) : restartLead(onOld.length)} sessions={sessions}
              restarts={restarts} blocked={offline} onRestart={(sid) => { void restart(sid); }}
            />
            {toToken ? (
              <section className="acct-remove-block" data-sign-old-out={signedOut !== null ? 'done' : predating > 0 ? 'danger' : 'plain'}>
                {signedOut === null ? (
                  <>
                    <p className="acct-field-note">{bothHeld(id)}</p>
                    {predating > 0 && !confirming && (
                      <div className="acct-actions">
                        <Button variant="danger-ghost" disabled={offline} onClick={() => setConfirming(true)}>{SIGN_OLD_OUT}</Button>
                      </div>
                    )}
                    {predating > 0 && confirming && (
                      <div className="acct-wrong-confirm">
                        <p className="acct-notice" role="alert">{signOldOutDanger(predating, id)}</p>
                        <GuardedAct
                          blocked={offline} freshUntil={freshUntil} deps={deps} label={SIGN_OLD_OUT_ANYWAY} variant="danger"
                          disabled={false} busy={signOutBusy} onAct={(stepUp) => { void signOldOut(stepUp); }}
                        />
                        <div className="acct-actions">
                          <Button variant="ghost" disabled={signOutBusy} onClick={() => setConfirming(false)}>{KEEP_IT}</Button>
                        </div>
                      </div>
                    )}
                    {predating === 0 && (
                      <GuardedAct
                        blocked={offline} freshUntil={freshUntil} deps={deps} label={SIGN_OLD_OUT} variant="ghost"
                        disabled={false} busy={signOutBusy} onAct={(stepUp) => { void signOldOut(stepUp); }}
                      />
                    )}
                    {signOutNotice !== null && <p className="acct-notice">{signOutNotice}</p>}
                  </>
                ) : (
                  // G23 is unmeasured (the OA1 record): this box's sign-out is said, and the provider's is not claimed.
                  <p className="acct-result-line">
                    {provider.lead}{' '}
                    <TextLink href={accountPage.href} onClick={(e) => openExternal(e, accountPage.href)}>{accountPage.label}</TextLink>
                    {provider.tail}
                  </p>
                )}
              </section>
            ) : (
              <>
                <p className="acct-result-line">
                  {revokeOldLead}{' '}
                  <TextLink href={page.href} onClick={(e) => openExternal(e, page.href)}>{page.label}</TextLink>
                  {revokeOldTail}
                </p>
                <RevokeItem
                  laneId={id} kind="anthropic-token" label={REVOKED_OLD} old blocked={offline}
                  ack={(b) => client.accountRevokeAck(b)}
                />
              </>
            )}
            {/* The compromise disclosure (spec §3.11; Task A19): in a token lane's result frame, never a sign-in's. */}
            {toToken && <CompromiseSteps roster={roster} />}
            {toToken && <p className="acct-result-line" data-switch-close="true">{SWITCH_CLOSE_TOKEN}</p>}
            <div className="acct-actions"><Button variant="primary" onClick={onClose}>{DONE}</Button></div>
          </div>
        )}
      </>
    );
  }

  return (
    <AccountSheet
      open={open} onClose={onClose} title={switchTitle(id, to)} eyebrow="switch method" frame={phase} said={said}
      offline={blocked} testIds="switch"
    >
      {body}
    </AccountSheet>
  );
}
