// REMOVE AND DISCARD (spec §11; accounts plan Task A19, N3, N6, D-7742): the fold's Remove… opens this sheet.
//
// THE PRE-CHECK IS THE BOX'S. On open the sheet asks `remove {mode:'check'}` (A16's `--dry-run`, A17's route), which
// changes nothing and needs no step-up, and it asks again after every Move and every Wake and move. The line says what
// the box measured, with its age: "0 live sessions · not the upstream lane · 2 other lanes can take new sessions · no
// sign-in in progress · read just now". The sheet derives no count of its own.
//
// SESSIONS BLOCK, WITH A WAY THROUGH. Live sessions hold the destructive button, which says how many are still on the
// lane, and each gets **Move**, with **Move all** beside them: both open A3's Move sessions sheet, which moves one at a
// time. SLEEPING SESSIONS (N3, D-7733) are listed apart, because removing the lane would wake them somewhere else
// without their place in the conversation: **Wake and move** wakes each through the existing ensure route (inside the
// fleet-wide wake budget, one at a time), then opens the same mover. While the mover is open this sheet steps aside
// (one sheet at a time), and it reads the box again when the mover closes.
//
// THE ACT. A typed-id confirm (it must equal the id exactly, case and all), then the danger button, with step-up. A lane
// the box measures as discardable (never enabled, no session of any kind) is offered **Discard this lane** instead: one
// tap with step-up and no typed confirm; the route and the verb both check it again.
//
// A CODEX LANE (Task A25, D-8051 (3); spec §11 step 4, G20): **Delete this lane's ChatGPT sign-in folder**, on by default,
// sits above the typed confirm, and the verb does what the line says: off sends `--keep-codex-auth`. The ledger says
// which it did, and links chatgpt.com, where the sign-in stays authorised.
//
// THE LEDGER is the verb's answer, never guessed: Removed, Kept on the box, the archived sessions rehomed, and **Still
// valid at the provider** with each kind's revoke link. A token's row carries the checklist item the operator ticks,
// recorded through `revoke-ack` with no value (N6). A sign-in's row says what the OA1 record allows: G23 was not
// measured, so whether the sign-in ended at Anthropic is UNMEASURED.
//
// OFFLINE (spec §12.5): no request leaves the sheet, and every act is refused with the screen's one sentence.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button, OptionRow, RESET_LIST, Sheet, TextInput, TextLink } from '@ccrc/ui';
import {
  isArchivedRow, type AccountRemoveAnswer, type AccountRemoveCheckAnswer, type AccountRevokeAckBody, type AccountsConnect,
  type AtProviderKind, type AtProviderRow, type LaneWire, type RosterWire,
} from '../../../shared/api';
import { ApiError, api } from '../lib/api';
import { openExternal } from '../lib/markdown';
import { ensureSession } from '../session/useEnsure';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import {
  CODEX_FOLDER_KEPT, CODEX_FOLDER_LINE, DISCARD_LANE, DONE, LEDGER_HEADS, MOVE_ALL, MOVE_ONE, READ_IT_AGAIN, READING_LANE, REVOKE_NOT_RECORDED, REVOKE_PAGES,
  STEP_UP_AGAIN_REMOVE, WAKE_AND_MOVE, atProviderHead, atProviderWords, discardLine, liveBlockText, notRemovedAfterUnknown, removeButtonLabel,
  removeCheckFailed, removeCheckLine, removeConsequence, removeHeld, removeRefusal, removeStillUnknown, removeUnknown, removedButNoLedger,
  removedDone, revokeRecord, sleepingBlockText, typedConfirmLabel, wakeFailed, wakingProgress, REVOKED_IT,
} from '../fleet/accountWords';
import { MoveSessionsSheet } from '../fleet/MoveSessionsSheet';
import { presenceOf } from '../fleet/presence';
import { sessionLabel } from '../fleet/sessionLabel';
import { ConfirmItsYou } from './ConfirmItsYou';
import { useStepUp, type StepUp, type StepUpDeps } from './useStepUp';
import '../fleet/fleet.css';

/** The routes the sheet calls, injectable so a test drives a fake box. */
export type RemoveClient = Pick<typeof api, 'accountRemoveCheck' | 'accountRemove' | 'accountRevokeAck'>;
type Check = AccountRemoveCheckAnswer['check'];

/** The `error` word an `ApiError` carries, or `undefined` for a request that never completed. */
export function refusalWordOf(err: unknown): string | undefined {
  if (!(err instanceof ApiError)) return undefined;
  const b = err.body;
  const v = typeof b === 'object' && b !== null ? (b as Record<string, unknown>)['error'] : undefined;
  return typeof v === 'string' ? v : undefined;
}

/** The step-up for the act that needs it, mounted only while that act is drawn and the screen can act, so the
 *  challenge is fetched when the step is SHOWN (`useStepUp`'s rule) and an offline sheet sends nothing. */
export function StepUpFor({ freshUntil, deps, children }: {
  freshUntil: number | null; deps: StepUpDeps; children: (s: StepUp) => ReactNode;
}): ReactNode {
  return children(useStepUp(freshUntil, deps));
}
const NO_DEPS: StepUpDeps = {};

/** An act that needs a fresh step-up (spec §3.2): Confirm it's you while the stamp has lapsed, then the act's one
 *  button. While the screen cannot act (`blocked`), the button is drawn disabled and no step-up is fetched. */
export function GuardedAct({ blocked, freshUntil, deps = NO_DEPS, label, variant, disabled, busy, onAct }: {
  blocked: boolean; freshUntil: number | null; deps?: StepUpDeps; label: string; variant: 'primary' | 'danger' | 'ghost';
  disabled: boolean; busy: boolean; onAct: (stepUp: StepUp) => void;
}): ReactNode {
  if (blocked) return <div className="acct-actions"><Button variant={variant} disabled>{label}</Button></div>;
  return (
    <StepUpFor freshUntil={freshUntil} deps={deps}>
      {(stepUp) => (
        <>
          <ConfirmItsYou stepUp={stepUp} subject="the fleet's accounts" />
          <div className="acct-actions">
            <Button variant={variant} disabled={disabled || busy || stepUp.needed} aria-busy={busy || undefined} onClick={() => onAct(stepUp)}>
              {label}
            </Button>
          </div>
        </>
      )}
    </StepUpFor>
  );
}

/** One link to a provider's revoke page, opened as the app opens every external link. */
function RevokeLink({ page }: { page: keyof typeof REVOKE_PAGES }): ReactNode {
  const p = REVOKE_PAGES[page];
  return <TextLink href={p.href} onClick={(e) => openExternal(e, p.href)}>{p.label}</TextLink>;
}

/**
 * THE REVOKE CHECKLIST ITEM (spec §9, §11.3; N6): ccrc cannot revoke a token at the provider, so the operator does, and
 * ticks this. The tick sends `revoke-ack` with the lane and the credential kind ONLY, never a value or a hint, and the
 * box ticks only once the row is recorded. Leaving it unticked is allowed: the record line then says so.
 */
export function RevokeItem({ laneId, kind, label, old, blocked, ack }: {
  laneId: string;
  kind: AtProviderKind;
  label: string;
  /** Is it the token this lane HAD (Replace) rather than the lane's only one (Remove)? `any` when the app knows of no old
   *  token but one may exist (D-7872 (10)). Only the words differ. */
  old: boolean | 'any';
  /** The screen cannot act (offline): the tick sends nothing. */
  blocked: boolean;
  ack: (body: AccountRevokeAckBody) => Promise<unknown>;
}): ReactNode {
  const [state, setState] = useState<'open' | 'sending' | 'ticked' | 'failed'>('open');
  const tick = async (): Promise<void> => {
    if (state === 'sending' || state === 'ticked' || blocked) return;
    setState('sending');
    try {
      await ack({ laneId, kind });
      setState('ticked');
    } catch {
      setState('failed');
    }
  };
  return (
    <div className="acct-revoke">
      <OptionRow
        label={label}
        checked={state === 'ticked'}
        disabled={state === 'ticked' || blocked}
        busy={state === 'sending'}
        onClick={() => { void tick(); }}
      />
      {state === 'failed' && <p className="acct-field-note" role="alert">{REVOKE_NOT_RECORDED}</p>}
      <p className="acct-field-note" data-testid="revoke-record">{revokeRecord(state === 'ticked', old)}</p>
    </div>
  );
}

/** One "still valid at the provider" row, with its link and, for a token, the checklist item. */
function AtProvider({ laneId, row, keyHint, blocked, ack }: {
  laneId: string; row: AtProviderRow; keyHint: string | undefined; blocked: boolean;
  ack: (body: AccountRevokeAckBody) => Promise<unknown>;
}): ReactNode {
  const w = atProviderWords(row.kind, row.state, keyHint);
  return (
    <li className="acct-at-provider" data-kind={row.kind} data-state={row.state}>
      <p className="acct-result-line">
        {w.lead}
        {row.revokeAt !== null && <>{' '}<RevokeLink page={row.revokeAt} /></>}
        {w.tail}
      </p>
      {row.kind === 'anthropic-token' && (
        <RevokeItem laneId={laneId} kind={row.kind} label={REVOKED_IT} old={false} blocked={blocked} ack={ack} />
      )}
    </li>
  );
}

/** A ledger section: its heading, then its lines in mono (box paths and names, as the verb answered them). */
function LedgerSection({ head, lines }: { head: string; lines: readonly string[] }): ReactNode {
  if (lines.length === 0) return null;
  return (
    <section className="acct-removal-section" aria-label={head}>
      <h3 className="acct-removal-head">{head}</h3>
      <ul className="acct-removal-lines">{lines.map((l) => <li key={l}>{l}</li>)}</ul>
    </section>
  );
}

export interface RemoveSheetProps {
  id: string;
  open: boolean;
  onClose: () => void;
  /** The lane's state as the screen last read it, for the key hint a key's revoke row names. */
  lane: LaneWire | undefined;
  connect: AccountsConnect | null;
  /** Why the screen cannot act (offline, or `connectBlock`), or `null`. */
  blocked: string | null;
  /** Re-reads `/api/accounts` through the store: `'ok'` once an answer carrying a roster landed. */
  refresh: () => Promise<'ok' | 'error'>;
  /** The roster as the store holds it NOW (read after `refresh`). */
  readRoster: () => readonly RosterWire[];
  client?: RemoveClient;
  /** Wakes one sleeping session: the existing ensure route by default. */
  wake?: (sessionId: string) => Promise<void>;
  stepUpDeps?: StepUpDeps;
  fleet?: FleetStore;
}

export function RemoveSheet(props: RemoveSheetProps): ReactNode {
  const { id, open, onClose, connect, blocked, refresh, readRoster } = props;
  const client = props.client ?? api;
  const wake = props.wake ?? ensureSession;
  const fleet = props.fleet ?? useFleetStore;
  const sessions = fleet((s) => s.sessions);
  // The key hint outlives the lane: the screen's lane state is gone once the removal lands.
  const keyHint = useRef<string | undefined>(undefined);
  if (props.lane?.keyHint !== undefined) keyHint.current = props.lane.keyHint;

  const [check, setCheck] = useState<Check | null>(null);
  const [checkFailed, setCheckFailed] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [typed, setTyped] = useState('');
  /** The Codex line (spec §11 step 4): on by default. */
  const [deleteFolder, setDeleteFolder] = useState(true);
  const codexLane = readRoster().some((r) => r.id === id && r.kind === 'codex');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [ledger, setLedger] = useState<AccountRemoveAnswer | null>(null);
  /** The removal happened, but its ledger never arrived (an unknown outcome the roster settled). */
  const [goneUnledgered, setGoneUnledgered] = useState(false);
  /** The Move sessions sheet, open over the sessions it moves (`undefined`: every session the mover finds on the lane). */
  const [mover, setMover] = useState<{ readonly only: readonly string[] | undefined } | null>(null);
  const [waking, setWaking] = useState<string | null>(null);
  const [wakeNotes, setWakeNotes] = useState<readonly string[]>([]);
  const live = useRef(true);
  useEffect(() => { live.current = true; return () => { live.current = false; }; }, []);
  const seq = useRef(0);
  /** One removal at a time: a second tap in the same frame, before `busy` has re-rendered, sends nothing. */
  const sending = useRef(false);
  const confirmId = useId();
  const done = ledger !== null || goneUnledgered;

  /** Asks the box again. The latest ask wins: an older answer that lands after a newer ask is dropped. */
  const recheck = async (): Promise<void> => {
    if (blocked !== null) return;
    const n = ++seq.current;
    setReading(true);
    try {
      const a = await client.accountRemoveCheck(id);
      if (!live.current || n !== seq.current) return;
      setCheck(a.check);
      setCheckFailed(null);
    } catch (e) {
      if (!live.current || n !== seq.current) return;
      setCheck(null);
      setCheckFailed(removeRefusal(id, refusalWordOf(e)) ?? removeCheckFailed(id));
    } finally {
      if (live.current && n === seq.current) setReading(false);
    }
  };
  // Measured on the box at open, and again whenever the screen can act again.
  const canAsk = blocked === null;
  useEffect(() => {
    if (open && canAsk && !done) void recheck();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- an open, or the link back, is the trigger
  }, [open, canAsk]);

  const liveOn = sessions.filter((s) => s.wrapper === id && !isArchivedRow(s) && presenceOf(s) === 'alive');
  const sleeping = check?.sleeping ?? [];
  const still = (check?.live ?? 0) + sleeping.length;
  const held = check === null ? null
    : check.authInProgress ? removeHeld.authInProgress(id)
      : check.upstream ? removeHeld.upstream(id)
        : check.live === null ? removeHeld.liveUncounted(id) : null;
  const discard = check !== null && check.discardable && still === 0 && held === null;

  const closeMover = (): void => { setMover(null); void recheck(); };

  const wakeAndMove = async (): Promise<void> => {
    if (blocked !== null || waking !== null) return;
    const ids = [...sleeping];
    const woke: string[] = [];
    const notes: string[] = [];
    // One at a time: each wake restarts a Claude process, and the next waits for it.
    for (let i = 0; i < ids.length; i++) {
      const sid = ids[i]!;
      setWaking(wakingProgress(i + 1, ids.length));
      try {
        await wake(sid);
        woke.push(sid);
      } catch {
        notes.push(wakeFailed(sid));
      }
      if (!live.current) return;
    }
    setWaking(null);
    setWakeNotes(notes);
    if (woke.length > 0) setMover({ only: woke });
    else void recheck();
  };

  const act = async (stepUp: StepUp, mode: 'remove' | 'discard'): Promise<void> => {
    if (busy || blocked !== null || sending.current) return;
    sending.current = true;
    setBusy(true);
    setNotice(null);
    const got: { answer: AccountRemoveAnswer | null } = { answer: null };
    let failure: unknown = null;
    let outcome: 'done' | 'step-up' = 'done';
    try {
      outcome = await stepUp.runAct(async () => {
        got.answer = await client.accountRemove(id, mode === 'discard' ? { mode: 'discard' } : {
          mode: 'remove', confirmId: typed, ...(codexLane ? { codexAuth: deleteFolder ? 'delete' as const : 'keep' as const } : {}),
        });
      });
    } catch (e) {
      failure = e;
    }
    sending.current = false;
    if (!live.current) return;
    try {
      if (outcome === 'step-up') { setNotice(STEP_UP_AGAIN_REMOVE); return; }
      if (got.answer !== null) {
        setLedger(got.answer);
        void refresh();
        return;
      }
      const word = refusalWordOf(failure);
      if (word === undefined || word === 'outcome-unknown') {
        setNotice(removeUnknown(id));
        const read = await refresh();
        if (!live.current) return;
        // The roster could not be read either: still unknown. The pre-check, asked again, says what the box holds.
        if (read !== 'ok') { setNotice(removeStillUnknown(id)); void recheck(); return; }
        if (!readRoster().some((r) => r.id === id)) { setGoneUnledgered(true); return; }
        setNotice(notRemovedAfterUnknown(id));
        void recheck();
        return;
      }
      setNotice(removeRefusal(id, word));
      if (word === 'confirm-mismatch') setTyped('');
      void recheck();
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const ack = (body: AccountRevokeAckBody): Promise<unknown> => client.accountRevokeAck(body);
  const freshUntil = connect?.stepUpFreshUntil ?? null;
  const deps = props.stepUpDeps ?? NO_DEPS;

  let body: ReactNode;
  if (done) {
    body = (
      <div className="acct-frame" data-frame="removed">
        <p className="acct-result-word" role="status">{removedDone(id)}</p>
        {goneUnledgered && <p className="acct-notice">{removedButNoLedger(id)}</p>}
        {ledger !== null && (
          <>
            <LedgerSection head={LEDGER_HEADS.removed} lines={ledger.removed} />
            <LedgerSection head={LEDGER_HEADS.kept} lines={ledger.kept} />
            <LedgerSection head={LEDGER_HEADS.rehomed} lines={ledger.rehomed} />
            {ledger.atProvider.length > 0 && (
              <section className="acct-removal-section" aria-label={atProviderHead(ledger.atProvider.map((r) => r.state))}>
                <h3 className="acct-removal-head">{atProviderHead(ledger.atProvider.map((r) => r.state))}</h3>
                <ul className={RESET_LIST}>
                  {ledger.atProvider.map((row) => (
                    <AtProvider key={row.kind} laneId={id} row={row} keyHint={keyHint.current} blocked={blocked !== null} ack={ack} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
        <div className="acct-actions"><Button variant="primary" onClick={onClose}>{DONE}</Button></div>
      </div>
    );
  } else {
    body = (
      <div className="acct-frame" data-frame="remove">
        {blocked !== null && <p className="acct-offline">{blocked}</p>}
        {check !== null && <p className="acct-result-line" data-testid="remove-check" role="status">{removeCheckLine(check, Date.now())}</p>}
        {check === null && reading && <p className="acct-result-line" role="status">{READING_LANE(id)}</p>}
        {checkFailed !== null && check === null && !reading && (
          <>
            <p className="acct-notice" role="alert">{checkFailed}</p>
            <div className="acct-actions">
              <Button variant="ghost" size="fit" disabled={blocked !== null} onClick={() => { void recheck(); }}>{READ_IT_AGAIN}</Button>
            </div>
          </>
        )}
        {held !== null && <p className="acct-notice">{held}</p>}

        {check !== null && (check.live ?? 0) > 0 && (
          <section className="acct-remove-block" aria-label={liveBlockText(id, check.live ?? 0)}>
            <p className="acct-notice">{liveBlockText(id, check.live ?? 0)}</p>
            <ul className={RESET_LIST}>
              {liveOn.map((s) => (
                <li key={s.id} className="acct-remove-session">
                  <span className="acct-remove-name">{sessionLabel(s)}</span>
                  <Button variant="ghost" size="fit" disabled={blocked !== null} onClick={() => setMover({ only: [s.id] })}>{MOVE_ONE}</Button>
                </li>
              ))}
            </ul>
            <div className="acct-actions">
              <Button variant="ghost" size="fit" disabled={blocked !== null} onClick={() => setMover({ only: liveOn.length > 0 ? liveOn.map((s) => s.id) : undefined })}>
                {MOVE_ALL}
              </Button>
            </div>
          </section>
        )}

        {sleeping.length > 0 && (
          <section className="acct-remove-block" data-sleeping="true" aria-label={sleepingBlockText(id, sleeping.length)}>
            <p className="acct-notice">{sleepingBlockText(id, sleeping.length)}</p>
            <ul className="acct-removal-lines">{sleeping.map((sid) => <li key={sid}>{sid}</li>)}</ul>
            {waking !== null && <p className="acct-field-note" role="status">{waking}</p>}
            {wakeNotes.map((n) => <p key={n} className="acct-field-note" role="alert">{n}</p>)}
            <div className="acct-actions">
              <Button variant="ghost" size="fit" disabled={blocked !== null || waking !== null} aria-busy={waking !== null || undefined} onClick={() => { void wakeAndMove(); }}>
                {WAKE_AND_MOVE}
              </Button>
            </div>
          </section>
        )}

        {notice !== null && <p className="acct-notice" role="alert">{notice}</p>}

        {check !== null && held === null && (
          discard ? (
            <>
              <p className="acct-field-note">{discardLine(id)}</p>
              <GuardedAct
                blocked={blocked !== null} freshUntil={freshUntil} deps={deps} label={DISCARD_LANE} variant="danger"
                disabled={false} busy={busy} onAct={(stepUp) => { void act(stepUp, 'discard'); }}
              />
            </>
          ) : (
            <>
              <p className="acct-field-note">{removeConsequence(id)}</p>
              {codexLane && (
                <div className="acct-revoke" data-codex-folder="true">
                  <OptionRow
                    label={CODEX_FOLDER_LINE} checked={deleteFolder} disabled={blocked !== null}
                    onClick={() => setDeleteFolder((d) => !d)}
                  />
                  {!deleteFolder && <p className="acct-field-note">{CODEX_FOLDER_KEPT}</p>}
                </div>
              )}
              <div className="acct-field">
                <label htmlFor={confirmId}>{typedConfirmLabel(id)}</label>
                <TextInput
                  id={confirmId}
                  className="font-mono"
                  value={typed}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={blocked !== null}
                  onChange={(e) => setTyped(e.target.value)}
                />
              </div>
              <GuardedAct
                blocked={blocked !== null} freshUntil={freshUntil} deps={deps} label={removeButtonLabel(id, still)}
                variant="danger" disabled={still > 0 || typed !== id} busy={busy}
                onAct={(stepUp) => { void act(stepUp, 'remove'); }}
              />
            </>
          )
        )}
      </div>
    );
  }

  return (
    <>
      <Sheet open={open && mover === null} onClose={onClose} title={`Remove ${id}`} eyebrow="remove lane" size="md">
        {body}
      </Sheet>
      {mover !== null && <MoveSessionsSheet lane={id} only={mover.only} open onClose={closeMover} fleet={fleet} />}
    </>
  );
}
