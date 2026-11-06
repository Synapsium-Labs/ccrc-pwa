import { useId, useState, type ReactNode } from 'react';
import { Button, TextInput } from '@ccrc/ui';
import { isLaneIdentity, LANE_IDENTITY_MAX, type AccountStateWord } from '../../../shared/accounts';
import type { LaneWire } from '../../../shared/api';
import { FrameFoot } from './FrameFoot';
import {
  LEAVE_IT_OFF, SAVE_STATED, STATED_LABEL, STATED_NOTE, STATED_PROBLEM, WRONG_ACCOUNT, checkLatency, STATE_LAMPS, TURN_IT_ON,
  chatgptSignedInLine, identityLine, notReadyWords,
} from '../fleet/accountWords';
import type { SignInMethod } from './connectFlow';

/** The sign-in methods' part of the result (accounts plan Task A22, D-7849; spec §6.2 step 10, §6.3). */
export interface ResultSignIn {
  readonly method: SignInMethod;
  /** "Sign this lane out and start again", drawn by the host, which holds its step-up. Absent for a ChatGPT lane, which
   *  has no sign-out act: the verb refuses `not-a-sign-in-lane`, and Sign in again replaces its sign-in (D-8051 (5)). */
  readonly wrongAccount?: ReactNode;
  /** Mint only: save the stated account (`set {stated}`). */
  readonly onStated?: (text: string) => void;
  readonly statedBusy?: boolean;
  /** The sentence the last save left (a refusal), or `null`. */
  readonly statedNotice?: string | null;
}

export interface ResultFrameProps {
  id: string;
  /** The lane as the last answer read it, or `null` when the check's answer never came. */
  lane: LaneWire | null;
  /** The check's round trip, measured by this sheet, or `null` when it did not answer. */
  latencyMs: number | null;
  /** Whether the lane is on: an ack of Turn it on. */
  on: boolean;
  busy: boolean;
  /** The sentence a refused act left here, or `null`. */
  notice: string | null;
  blocked: boolean;
  nowSec: number;
  onTurnOn: () => void;
  onCheckAgain: () => void;
  onClose: () => void;
  /** Present for a lane this sheet signed in or minted. */
  signIn?: ResultSignIn;
}

/** "Which account did you just approve?" (spec §6.3, Q5): optional, one line of 1 to 120 characters (the lane-state
 *  file's identity grammar, `isLaneIdentity`), saved with `set {stated}`. Not a secret: an ordinary controlled field.
 *  `initial` is its default text: the switch to a long-lived token offers the sign-in's readable email (spec §9; Task
 *  A23, D-7871). */
export function StatedField({ onSave, busy, notice, blocked, initial = '' }: {
  onSave: (text: string) => void; busy: boolean; notice: string | null; blocked: boolean; initial?: string;
}): ReactNode {
  const [v, setV] = useState(initial);
  const fieldId = useId();
  const noteId = useId();
  const bad = v !== '' && !isLaneIdentity(v);
  return (
    <div className="acct-field acct-stated">
      <label htmlFor={fieldId}>{STATED_LABEL}</label>
      <div className="acct-secret-row">
        <TextInput
          id={fieldId} value={v} maxLength={LANE_IDENTITY_MAX} autoComplete="off" spellCheck={false}
          aria-describedby={noteId} aria-invalid={bad || undefined}
          onChange={(e) => setV(e.currentTarget.value)}
        />
        <Button
          variant="ghost" size="fit" className="flex-none" disabled={busy || blocked || v.trim() === '' || bad}
          aria-busy={busy || undefined} onClick={() => onSave(v.trim())}
        >
          {SAVE_STATED}
        </Button>
      </div>
      <p className="acct-field-note" id={noteId}>{bad ? STATED_PROBLEM : notice ?? STATED_NOTE}</p>
    </div>
  );
}

/**
 * "Result" (spec §12.3 frame 6; accounts plan Task A18): a register, not a celebration. The lane's word, its identity
 * line, the check's latency, then **Turn it on** (primary) or **Leave it off for now**. THE SHEET NEVER CLOSES ITSELF:
 * once the lane is on, the frame says so and offers Done. A lane the box does not read as ready cannot be turned on
 * here: the primary is disabled with the reason beneath it, and Check again sits beside it. A check that was refused,
 * or never answered, leaves no lane read (`lane` is `null`): that is not ready either, its reason the refusal's own
 * sentence, so Turn it on is disabled with it beneath and Check again beside it (D-7740 (4)).
 *
 * A LANE THIS SHEET SIGNED IN OR MINTED (Task A22, D-7849; spec §6.2 step 10, §6.3): "Not the account you meant?" with
 * the host's "Sign this lane out and start again" beside the identity, and for a mint, which cannot read its account,
 * "Which account did you just approve?" (optional), saved with `set {stated}`.
 */
export function ResultFrame(p: ResultFrameProps): ReactNode {
  const word = (p.lane?.state.word ?? 'not-checked') as AccountStateWord;
  const lamp = STATE_LAMPS[word] ?? STATE_LAMPS['not-checked'];
  // A Codex lane has no identity to read back (spec §3.4): it says how it is signed in, unless one was stated. That
  // reads the check, since this frame's word is Off until Turn it on.
  const identity = p.lane === null ? null
    : identityLine(p.lane, word, p.nowSec) ?? (p.signIn?.method === 'openai-login' ? chatgptSignedInLine(p.lane) : null);
  const unchecked = p.lane === null;
  // Why Turn it on is held: the box's not-ready reason, or, with no lane read, the check's refusal (or the box's word
  // for a lane never checked, should no sentence have been left).
  const notReady = p.lane === null
    ? p.notice ?? notReadyWords('not-checked')
    : !p.lane.ready ? notReadyWords(p.lane.notReadyReason) : null;
  return (
    <div className="acct-frame" data-frame="result">
      <p className="acct-result-word" data-state={word}>
        <span aria-hidden="true">{lamp.glyph}</span> {lamp.word} · {p.id}
      </p>
      {identity !== null && <p className="acct-result-line">{identity}</p>}
      {p.signIn?.onStated !== undefined && (
        <StatedField onSave={p.signIn.onStated} busy={p.signIn.statedBusy ?? false} notice={p.signIn.statedNotice ?? null} blocked={p.blocked} />
      )}
      {/* Before the lane is turned on only: signing an on lane out would fail its sessions' next turn. */}
      {p.signIn?.wrongAccount !== undefined && !p.on && (
        <div className="acct-wrong-account">
          <span className="acct-result-line">{WRONG_ACCOUNT}</span>
          {p.signIn.wrongAccount}
        </div>
      )}
      {p.latencyMs !== null && <p className="acct-result-line">{checkLatency(p.latencyMs)}</p>}
      {/* With no lane read, the notice IS the held reason, drawn once beneath the primary. */}
      {p.notice !== null && !unchecked && <p className="acct-notice">{p.notice}</p>}
      {p.on ? (
        <FrameFoot primary={{ label: 'Done', onClick: p.onClose }} />
      ) : (
        <FrameFoot
          quiet={[
            { label: LEAVE_IT_OFF, onClick: p.onClose, disabled: p.busy },
            ...(notReady !== null ? [{ label: 'Check again', onClick: p.onCheckAgain, disabled: p.busy || p.blocked }] : []),
          ]}
          primary={{
            label: TURN_IT_ON, onClick: p.onTurnOn, disabled: p.busy || p.blocked || notReady !== null, busy: p.busy,
            ...(notReady !== null ? { describedBy: `acct-result-reason-${p.id}` } : {}),
          }}
        />
      )}
      {!p.on && notReady !== null && <p className="acct-field-note" id={`acct-result-reason-${p.id}`}>{notReady}</p>}
    </div>
  );
}
