import type { ReactNode } from 'react';
import type { AccountStateWord } from '../../../shared/accounts';
import type { LaneWire } from '../../../shared/api';
import { FrameFoot } from './FrameFoot';
import { LEAVE_IT_OFF, checkLatency, STATE_LAMPS, TURN_IT_ON, identityLine, notReadyWords } from '../fleet/accountWords';

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
}

/**
 * "Result" (spec §12.3 frame 6; accounts plan Task A18): a register, not a celebration. The lane's word, its identity
 * line, the check's latency, then **Turn it on** (primary) or **Leave it off for now**. THE SHEET NEVER CLOSES ITSELF:
 * once the lane is on, the frame says so and offers Done. A lane the box does not read as ready cannot be turned on
 * here: the primary is disabled with the reason beneath it, and Check again sits beside it.
 */
export function ResultFrame(p: ResultFrameProps): ReactNode {
  const word = (p.lane?.state.word ?? 'not-checked') as AccountStateWord;
  const lamp = STATE_LAMPS[word] ?? STATE_LAMPS['not-checked'];
  const identity = p.lane === null ? null : identityLine(p.lane, word, p.nowSec);
  const notReady = p.lane !== null && !p.lane.ready ? notReadyWords(p.lane.notReadyReason) : null;
  return (
    <div className="acct-frame" data-frame="result">
      <p className="acct-result-word" data-state={word}>
        <span aria-hidden="true">{lamp.glyph}</span> {lamp.word} · {p.id}
      </p>
      {identity !== null && <p className="acct-result-line">{identity}</p>}
      {p.latencyMs !== null && <p className="acct-result-line">{checkLatency(p.latencyMs)}</p>}
      {p.notice !== null && <p className="acct-notice">{p.notice}</p>}
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
