// REPLACE TOKEN, BY PASTE (spec §9's token row, §6.3; accounts plan Task A19, D-7742): the fold's Replace token, and a
// token lane's trouble card, open this sheet.
//
// VALIDATE FIRST. The pasted token goes out once, in `POST /api/accounts/:id/credential`, and the box probes it before
// anything is written (A16): a refused or unverified token leaves the lane exactly as it was, and the field is
// re-presented EMPTY. The token lives only in `SecretField`'s own DOM node, read once on submit, as in the connect sheet.
// What the intro, the refusals and the ending say of the old token is `oldCredentialOf`'s (D-7872 (10)), read through
// `useOldCredential`: a token lane can have no token (`add` writes one with no key file, and a cancelled or expired mint
// leaves it), so "keeps its old token" is said only behind a passing check.
//
// THEN A FRESH CHECK (spec §9: every re-login ends with one). The box clears the lane's check when it swaps the token,
// so the sheet runs Check, which also verifies the first-run setup, and says what it found.
//
// RUNNING SESSIONS KEEP THE TOKEN THEY STARTED WITH (09-05 decision 10), so the sheet lists the live sessions on the
// lane with one-tap Restart each (the existing stop, then ensure). Then the revoke checklist item: ccrc cannot revoke the
// old token, which stays valid for up to a year, so the operator ticks "I revoked the old token" ("any old token" where
// the app knows of none) once they have, and the tick is recorded with no value (N6). Leaving it unticked is allowed, and
// the record line then says "old token not marked revoked". The compromise disclosure closes the sheet (spec §3.11).
//
// MINT BESIDE PASTE (accounts plan Task A38, D-7872; spec §9's token row: "mint again or paste"). Where the fleet can run
// a mint (`account-auth-v1`), the screen hands this sheet `onMint`, and its paste frame opens with **Mint a new token
// instead** above the field: the mint is the first way, the paste the second. The mint itself is the re-auth sheet's
// (`ReauthSheet`), which the screen opens in this sheet's place, one sheet at a time.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Sheet, TextLink } from '@ccrc/ui';
import type { AccountsConnect, AccountUsage, LaneWire, RosterWire } from '../../../shared/api';
import { api } from '../lib/api';
import { openExternal } from '../lib/markdown';
import { ensureSession } from '../session/useEnsure';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import {
  DONE, LEDGER, MINT_INSTEAD, NEW_TOKEN_LABEL, REPLACE_SAVE, REVOKE_PAGES, STEP_UP_AGAIN_REPLACE,
  TOKEN_CLEARED_REPLACE, addRefusal, checkedLine, laneActRefusal, replaceIntro, replaceLedger, replaceRefusal, replaceUnknown,
  restartLead, revokeOldWords,
} from '../fleet/accountWords';
import { CompromiseSteps } from './CompromiseSteps';
import { RestartList, restartableOn, useRestarts } from './RestartList';
import { GuardedAct, RevokeItem, refusalWordOf } from './RemoveSheet';
import { RunFrame, type LedgerLine } from './RunFrame';
import { SecretField, type SecretFieldHandle } from './SecretField';
import { secretShapeOk } from './connectFlow';
import { useOldCredential } from './useOldCredential';
import type { StepUp, StepUpDeps } from './useStepUp';
import '../fleet/fleet.css';

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type ReplaceClient = Pick<typeof api, 'accountCredential' | 'accountCheck' | 'accountRevokeAck' | 'stop'>;

export interface ReplaceSheetProps {
  id: string;
  open: boolean;
  onClose: () => void;
  connect: AccountsConnect | null;
  /** Why the screen cannot act (offline, or `connectBlock`), or `null`. */
  blocked: string | null;
  /** The roster, for the compromise disclosure's providers. */
  roster: readonly RosterWire[];
  /** The lane as the screen read it: one of the facts `oldCredentialOf` reads (D-7872 (10)). */
  lane: LaneWire | undefined;
  /** The lane's telemetry row: its 401 marker is another. */
  usage?: Pick<AccountUsage, 'authDead'> | null;
  refresh: () => Promise<'ok' | 'error'>;
  client?: ReplaceClient;
  /** Starts one session again after its stop: the existing ensure route by default. */
  ensure?: (sessionId: string) => Promise<void>;
  stepUpDeps?: StepUpDeps;
  fleet?: FleetStore;
  /** The mint arm (Task A38): present when the fleet can mint, it closes this sheet and opens the re-auth sheet's mint. */
  onMint?: () => void;
}

type Phase = 'paste' | 'saving' | 'saved';
const NO_DEPS: StepUpDeps = {};

export function ReplaceSheet(props: ReplaceSheetProps): ReactNode {
  const { id, open, onClose, connect, blocked, roster, refresh } = props;
  const client = props.client ?? api;
  const ensure = props.ensure ?? ensureSession;
  const fleet = props.fleet ?? useFleetStore;
  const sessions = fleet((s) => s.sessions);

  const [phase, setPhase] = useState<Phase>('paste');
  const [hasSecret, setHasSecret] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [ledger, setLedger] = useState<LedgerLine[]>([]);
  const [checking, setChecking] = useState(false);
  /** The sessions live on the lane when the new token was saved: the ones still holding the old token. */
  const [onOld, setOnOld] = useState<readonly string[]>([]);
  const { restarts, restart } = useRestarts(client.stop, ensure, blocked !== null);
  const secret = useRef<SecretFieldHandle>(null);
  /** One replacement at a time: a second tap in the same frame, before the phase has re-rendered, sends nothing. */
  const sending = useRef(false);
  /** What the sheet may say of the old token (D-7872 (10)): read when a sentence is written. */
  const old = useOldCredential(id, props.lane, props.usage);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  useEffect(() => { if (!open) secret.current?.clear(); }, [open]);

  const write = (text: string): void => setLedger((l) => [...l, { text, at: Date.now() }]);
  const settle = (text: string): void => setLedger((l) => [...l.slice(0, -1), { text, at: Date.now() }]);
  const liveOn = (): string[] => restartableOn(sessions, id);

  const check = async (): Promise<void> => {
    setChecking(true);
    write(LEDGER.checking(id));
    try {
      const a = await client.accountCheck(id);
      if (!live.current) return;
      settle(checkedLine(a.lane));
    } catch (e) {
      if (!live.current) return;
      settle(laneActRefusal('check', id, e));
    }
    await refresh();
    if (live.current) setChecking(false);
  };

  const submit = async (stepUp: StepUp): Promise<void> => {
    if (blocked !== null || phase !== 'paste' || sending.current) return;
    // Read once: the field is empty from here on, whatever the answer.
    const value = secret.current?.take() ?? '';
    if (value === '') { setNotice(TOKEN_CLEARED_REPLACE); return; }
    if (!secretShapeOk(value)) { setNotice(replaceRefusal(id, 'key-charset', old.now())); return; }
    setNotice(null);
    sending.current = true;
    setPhase('saving');
    setLedger([{ text: replaceLedger.saving(id), at: Date.now() }]);
    let saved = false;
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => {
        await client.accountCredential(id, { credential: value });
        saved = true;
      });
    } catch (e) {
      failure = e;
    }
    sending.current = false;
    if (!live.current) return;
    if (outcome === 'step-up') { setPhase('paste'); setLedger([]); setNotice(STEP_UP_AGAIN_REPLACE); return; }
    if (!saved) {
      const word = refusalWordOf(failure);
      // An answer that never came: the swap may have happened. Say so, and check the lane rather than guess.
      if (word === undefined || word === 'outcome-unknown') {
        old.freeze();
        settle(replaceUnknown(id));
        setPhase('saved');
        setOnOld(liveOn());
        await check();
        return;
      }
      setPhase('paste');
      setLedger([]);
      setNotice(replaceRefusal(id, word, old.now()) ?? addRefusal(id, word)?.text ?? null);
      void refresh();
      return;
    }
    old.freeze();
    settle(replaceLedger.saved);
    setPhase('saved');
    setOnOld(liveOn());
    await check();
  };

  const freshUntil = connect?.stepUpFreshUntil ?? null;
  const deps = props.stepUpDeps ?? NO_DEPS;
  const page = REVOKE_PAGES['claude-code-settings'];
  const was = old.now();
  const revoke = revokeOldWords(id, was);

  return (
    <Sheet open={open} onClose={onClose} title={`Replace ${id}'s token`} eyebrow="replace token" size="md">
      <div className="acct-frame" data-frame={phase === 'paste' ? 'replace' : 'replaced'}>
        {blocked !== null && <p className="acct-offline">{blocked}</p>}
        {phase === 'paste' && (
          <>
            {props.onMint !== undefined && (
              <div className="acct-actions acct-mint-instead">
                <Button variant="ghost" size="fit" disabled={blocked !== null} onClick={props.onMint}>{MINT_INSTEAD}</Button>
              </div>
            )}
            <p className="acct-field-note">{replaceIntro(id, was)}</p>
            {blocked === null && (
              <SecretField label={NEW_TOKEN_LABEL} handle={secret} onPresence={setHasSecret} />
            )}
            {notice !== null && <p className="acct-notice" role="alert">{notice}</p>}
            <GuardedAct
              blocked={blocked !== null} freshUntil={freshUntil} deps={deps} label={REPLACE_SAVE} variant="primary"
              disabled={!hasSecret} busy={false} onAct={(stepUp) => { void submit(stepUp); }}
            />
          </>
        )}
        {phase !== 'paste' && <RunFrame lines={ledger} live={phase === 'saving' || checking} />}
        {phase === 'saved' && (
          <>
            {/* One-tap Restart for each session still on the old token (one stop, then ensure). */}
            <RestartList
              ids={onOld} lead={restartLead(onOld.length, was)} sessions={sessions} restarts={restarts} blocked={blocked !== null}
              onRestart={(sid) => { void restart(sid); }}
            />
            <p className="acct-result-line">
              {revoke.lead}{' '}
              <TextLink href={page.href} onClick={(e) => openExternal(e, page.href)}>{page.label}</TextLink>
              {revoke.tail}
            </p>
            <RevokeItem
              laneId={id} kind="anthropic-token" label={revoke.label} old={revoke.old} blocked={blocked !== null}
              ack={(body) => client.accountRevokeAck(body)}
            />
            <CompromiseSteps roster={roster} />
            <div className="acct-actions"><Button variant="primary" disabled={checking} onClick={onClose}>{DONE}</Button></div>
          </>
        )}
      </div>
    </Sheet>
  );
}
