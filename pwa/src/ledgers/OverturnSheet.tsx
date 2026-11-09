// The confirm sheet of "Overturn…" on a call made for the operator (D-8126; ring L4 delivery over @ccrc/ui's `Sheet`). One
// tap on a call opens it: the options the coordinator weighed with the chosen one marked, and a note (required) that is mailed
// to the coordinator as written. Confirm sends the one correction door's body; a refusal is shown in words on the sheet, which
// stays open. It decides nothing: the words are `callWords.ts`'s and the door is the one the digest uses.
import { useState, type FormEvent, type ReactNode } from 'react';
import { Button, QC_ACTIONS, Sheet } from '@ccrc/ui';
import { DIGEST_CORRECTION_MAX_CHARS, type CallView, type DigestCorrectBody } from '../../../shared/api';
import { apiErrorText } from '../lib/api';
import { callRefusalText } from './callWords';
import './ledgers.css';

/** What the sheet sends: the correction door's body, `rowKind: 'call'`. */
export type OverturnSend = (body: DigestCorrectBody) => Promise<unknown>;

export function OverturnSheet({ call, send, onClose }: {
  readonly call: CallView; readonly send: OverturnSend; readonly onClose: () => void;
}): ReactNode {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = note.trim() !== '' && !busy;
  // The options the coordinator weighed; a call recorded with none shows the one it chose.
  const options = call.options !== null && call.options.length > 0 ? call.options : [call.chosen];
  const confirm = (e?: FormEvent): void => {
    e?.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError(null);
    send({ rowKind: 'call', id: call.id, text: note })
      .then(() => onClose())
      .catch((err: unknown) => { setError(callRefusalText(err) ?? apiErrorText(err)); setBusy(false); });
  };
  return (
    <Sheet
      open
      onClose={onClose}
      title="Overturn this call"
      footer={
        <div className={QC_ACTIONS}>
          <Button variant="primary" disabled={!ready} onClick={() => confirm()}>{busy ? 'Sending…' : 'Confirm'}</Button>
          <Button variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
        </div>
      }
    >
      <form className="wl-overturn" onSubmit={confirm} aria-label={`Overturn call ${call.id}`}>
        {call.question !== null && call.question !== '' && <p className="wl-overturn-q">{call.question}</p>}
        <ul className="wl-overturn-options" aria-label="Options weighed">
          {options.map((o) => (
            <li key={o} className="wl-overturn-option" data-chosen={o === call.chosen ? 'true' : 'false'}>
              {o}{o === call.chosen && <span className="wl-overturn-mark">{' (chosen)'}</span>}
            </li>
          ))}
        </ul>
        <textarea
          className="wl-overturn-note"
          aria-label="What should it have decided?"
          placeholder="What should it have decided? This is mailed to the coordinator as written."
          value={note}
          maxLength={DIGEST_CORRECTION_MAX_CHARS}
          rows={3}
          disabled={busy}
          onChange={(e) => setNote(e.target.value)}
        />
        {error !== null && <p className="wl-overturn-error" role="alert">{error}</p>}
      </form>
    </Sheet>
  );
}
