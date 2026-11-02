// The Accounts screen's lamp and trouble card (spec 2026-10-18 accounts-connect §4.1, §4.2, §12.4; accounts plan Task
// A2, D-7718).
//
// THE LAMP is a glyph and a word, never a glyph alone: the glyph is `aria-hidden` and the word beside it is the
// lamp's name. Its colour is fleet.css's, keyed on `data-state`: Signed in's `●` is `--status-busy` with no glow
// (ruled 2026-10-18), Rate-limited's and Expiring's dots are `--status-attention` at lamp scale, and the loud state,
// Signed out, is achromatic (the card's rail, not a colour).
//
// THE TROUBLE CARD says what is wrong, its effect and its fix, in sans. A fix the screen cannot run yet is the
// fleet-host command in a read-only mono field with a Copy that tells the truth (§12.4): "Copied" only once
// `navigator.clipboard.writeText` has resolved; on a refusal, or with no clipboard, the command is selected in its
// field with "Couldn't copy: press and hold to copy".
//
// "MOVE N SESSIONS OFF" (§4.2, §4.5; Task A3) is the card's own button when its copy offers a move: Rate-limited's first
// fix, and one beside Signed out's credential act. The card counts the lane's sessions as the sheet will move them
// (`sessionsToMove`), offers nothing when there are none, and owns the Move sessions sheet it opens.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, toast } from '@ccrc/ui';
import type { AccountStateWord } from '../../../shared/accounts';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { CHECK_AGAIN_LABEL, STATE_LAMPS, moveOffLabel, type TroubleCopy } from './accountWords';
import { MoveSessionsSheet, sessionsToMove } from './MoveSessionsSheet';
import './fleet.css';

/** The lamp: its glyph (hidden from assistive tech) and its word, which is the lamp's text. */
export function StateLamp({ word }: { word: AccountStateWord }): ReactNode {
  const lamp = STATE_LAMPS[word];
  return (
    <span className="acct-lamp" data-state={word}>
      <span className="acct-lamp-glyph" aria-hidden="true">{lamp.glyph}</span>
      <span className="acct-lamp-word">{lamp.word}</span>
    </span>
  );
}

/** The sentence a refused or missing clipboard leaves beside the selected command. */
export const COPY_FAILED = "Couldn't copy: press and hold to copy";

/** One fleet-host command, read-only, with a truthful Copy. The command is text in a mono field that wraps, so a phone
 *  shows all of it; on a failed copy the whole command is selected there, ready for a long press. */
export function CopyCommand({ command }: { command: string }): ReactNode {
  const field = useRef<HTMLElement>(null);
  const [copy, setCopy] = useState<'idle' | 'copied' | 'failed'>('idle');
  const failed = (): void => {
    setCopy('failed');
    const el = field.current;
    if (el === null) return;
    el.focus();
    window.getSelection()?.selectAllChildren(el);
  };
  const onCopy = (): void => {
    // `navigator.clipboard` is absent outside a secure context, whatever the DOM types say.
    const clipboard: Clipboard | undefined = navigator.clipboard;
    if (clipboard === undefined) { failed(); return; }
    let written: Promise<void>;
    try { written = clipboard.writeText(command); } catch { failed(); return; }
    written.then(() => { setCopy('copied'); toast('Copied'); }, failed);
  };
  return (
    <div className="acct-fix-command">
      <div className="acct-fix-row">
        <code ref={field} className="acct-fix-field" tabIndex={0} aria-label="Command to run on the fleet host">{command}</code>
        <Button variant="ghost" className="acct-fix-copy" onClick={onCopy}>{copy === 'copied' ? 'Copied' : 'Copy'}</Button>
      </div>
      {copy === 'failed' && <p className="acct-fix-hold" role="status">{COPY_FAILED}</p>}
    </div>
  );
}

/** A trouble card's body: what is wrong, its effect, and the fix. Where the fix names a check and the screen can run
 *  one (`onCheck`, accounts plan Task A14, D-7732), **Check again** calls the Check route, the knob row's own; while it
 *  runs (`checking`) the button is busy and does not take a second press. `fleet` is injectable for tests. */
export function TroubleCard({ copy, onCheck, checking = false, fleet = useFleetStore }: {
  copy: TroubleCopy; onCheck?: () => void; checking?: boolean; fleet?: FleetStore;
}): ReactNode {
  const sessions = fleet((s) => s.sessions);
  const [moveOpen, setMoveOpen] = useState(false);
  const from = copy.move?.from ?? null;
  const count = from === null ? 0 : sessionsToMove(sessions, from).length;
  const move = copy.move !== null && from !== null && count > 0 ? (
    <Button
      variant={copy.move.primary ? 'primary' : 'ghost'}
      className="acct-trouble-move"
      onClick={() => setMoveOpen(true)}
    >
      {moveOffLabel(count)}
    </Button>
  ) : null;
  return (
    <div className="acct-trouble">
      <p className="acct-trouble-wrong">{copy.wrong}</p>
      <p className="acct-trouble-effect">{copy.effect}</p>
      {copy.move?.primary === true && move}
      <p className="acct-trouble-lead">{copy.lead}</p>
      {copy.checkAgain && onCheck !== undefined && (
        <Button variant="ghost" size="fit" className="acct-check-again" disabled={checking} aria-busy={checking || undefined} onClick={onCheck}>
          {CHECK_AGAIN_LABEL}
        </Button>
      )}
      {copy.commands.map((c) => <CopyCommand key={c} command={c} />)}
      {copy.move?.primary === false && move}
      {from !== null && <MoveSessionsSheet lane={from} open={moveOpen} onClose={() => setMoveOpen(false)} fleet={fleet} />}
    </div>
  );
}
