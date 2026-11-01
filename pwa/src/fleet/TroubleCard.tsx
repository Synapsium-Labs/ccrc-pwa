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
// field with "Couldn't copy: press and hold to copy". Moving sessions off is Task A3's sheet.
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, toast } from '@ccrc/ui';
import type { AccountStateWord } from '../../../shared/accounts';
import { STATE_LAMPS, type TroubleCopy } from './accountWords';
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

/** A trouble card's body: what is wrong, its effect, and the fix. */
export function TroubleCard({ copy }: { copy: TroubleCopy }): ReactNode {
  return (
    <div className="acct-trouble">
      <p className="acct-trouble-wrong">{copy.wrong}</p>
      <p className="acct-trouble-effect">{copy.effect}</p>
      <p className="acct-trouble-lead">{copy.lead}</p>
      {copy.commands.map((c) => <CopyCommand key={c} command={c} />)}
    </div>
  );
}
