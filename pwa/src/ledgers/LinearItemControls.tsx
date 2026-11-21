// The controls of the five hierarchy items (Linear hierarchy design §11.3 and §11.4, D-8184): each act of `LINEAR_ITEM_ACTS`, one
// control, one body to `POST /api/items/:id/linear`. The map's Approve and the report's Put back ask first (`QuickConfirm`); Return
// carries a note; Name picks one live coordinator and asks. A refusal is said in its fixed sentence (`linearItemErrorText`), never
// the box's text, and the controls stay for another try. Only an open item draws them, and a saved copy draws them disabled.
import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, QuickConfirm, Select, TextInput } from '@ccrc/ui';
import { isLinearItemAction, type LinearItemAct, type LinearItemAction } from '../../../shared/ledgers';
import type { ItemView } from '../../../shared/ledgers';
import { api } from '../lib/api';
import { linearItemErrorText } from '../lib/refusalWords';
import { LINEAR_GROUP_WORDS, LINEAR_ITEM_TEXT as T, nameConsequence } from './migrationWords';
import './ledgers.css';

type Body = { act: LinearItemAct; note?: string; owner?: string };

export function LinearItemControls({ item, handWords, enabled = true, onActed }: {
  item: ItemView; handWords: string; enabled?: boolean; onActed?: (() => void) | undefined;
}): ReactNode {
  const action: LinearItemAction | null = isLinearItemAction(item.action ?? null) ? item.action as LinearItemAction : null;
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<{ refusal: boolean; text: string } | null>(null);
  const [ask, setAsk] = useState<'approve' | 'put-back' | 'name' | null>(null);
  const [note, setNote] = useState('');
  const [owner, setOwner] = useState('');
  // The coordinators that are live: not read yet (null), the read failed ('unread': said, never as "none live"), or the list.
  const [live, setLive] = useState<string[] | 'unread' | null>(null);
  const noteId = useId();
  const pickId = useId();
  useEffect(() => {
    if (action?.verb !== 'linear-owner') return;
    let on = true;
    api.hierarchy().then((h) => { if (on) setLive(h.coordinators.filter((c) => c.live).map((c) => c.id)); }, () => { if (on) setLive('unread'); });
    return () => { on = false; };
  }, [action?.verb]);
  if (action === null || item.state !== 'open') return null;

  const send = (body: Body): void => {
    if (busy || !enabled) return;
    setBusy(true);
    setSaid(null);
    api.linearItemAct(item.id, body).then(
      (answer) => {
        setBusy(false);
        // The act reached the server but nothing will run (no key serves the workspace): a plain status line, and the item stays open.
        if (answer.queued === false) { setSaid({ refusal: false, text: T.notQueued }); return; }
        setSaid({ refusal: false, text: answer.queued === true ? T.queued : T.sent });
        onActed?.();
      },
      (err: unknown) => { setBusy(false); setSaid({ refusal: true, text: linearItemErrorText(err, body.act) }); },
    );
  };
  const off = busy || !enabled;
  const noteText = note.trim();
  return (
    <div className="wl-acts wl-linear" role="group" aria-label={LINEAR_GROUP_WORDS[action.verb]} data-item-acts={item.id} data-linear={action.verb}>
      {action.verb === 'linear-map' && (
        <>
          <label className="wi-field" htmlFor={noteId}>
            <span className="wi-label">{T.note}</span>
            <TextInput id={noteId} className="wi-input" value={note} aria-label={T.note} disabled={off} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button variant="primary" size="fit" disabled={off} onClick={() => setAsk('approve')}>{T.approve}</Button>
          <Button variant="ghost" size="fit" disabled={off || noteText === ''} onClick={() => send({ act: 'return', note: noteText })}>{T.return}</Button>
        </>
      )}
      {action.verb === 'linear-report' && (
        <>
          <Button variant="danger" size="fit" disabled={off} onClick={() => setAsk('put-back')}>{T.putBack}</Button>
          <Button variant="primary" size="fit" disabled={off} onClick={() => send({ act: 'done' })}>{T.done}</Button>
        </>
      )}
      {action.verb === 'linear-drift' && (
        <>
          <Button variant="primary" size="fit" disabled={off} data-door="hand-to-coordinator" onClick={() => send({ act: 'hand' })}>{handWords}</Button>
          <Button variant="ghost" size="fit" disabled={off} onClick={() => send({ act: 'keep' })}>{T.keep}</Button>
        </>
      )}
      {action.verb === 'linear-initiatives' && (
        <Button variant="primary" size="fit" disabled={off} onClick={() => send({ act: 'check-again' })}>{T.checkAgain}</Button>
      )}
      {action.verb === 'linear-owner' && (
        live === 'unread'
          ? <p className="wi-hint" role="alert">{T.unread}</p>
          : live !== null && live.length === 0
          ? <p className="wi-hint">{T.noneLive}</p>
          : (
            <>
              <label className="wi-field" htmlFor={pickId}>
                <span className="wi-label">{T.pick}</span>
                <Select id={pickId} value={owner} disabled={off || live === null} onChange={(e) => setOwner(e.target.value)}>
                  <option value="">{T.pickNone}</option>
                  {(live ?? []).map((id) => <option key={id} value={id}>{id}</option>)}
                </Select>
              </label>
              <Button variant="primary" size="fit" disabled={off || owner === ''} onClick={() => setAsk('name')}>{T.name}</Button>
            </>
          )
      )}
      <QuickConfirm open={ask === 'approve'} title={T.approveTitle} consequence={T.approveConsequence} confirmLabel={T.approveConfirm}
                    onClose={() => setAsk(null)} onConfirm={() => send({ act: 'approve' })} />
      <QuickConfirm open={ask === 'put-back'} title={T.putBackTitle} consequence={T.putBackConsequence} confirmLabel={T.putBackConfirm} tone="danger"
                    defaultFocus="cancel" onClose={() => setAsk(null)} onConfirm={() => send({ act: 'put-back' })} />
      <QuickConfirm open={ask === 'name'} title={T.nameTitle} consequence={action.verb === 'linear-owner' ? nameConsequence(action.project, owner) : ''}
                    confirmLabel={T.nameConfirm} onClose={() => setAsk(null)} onConfirm={() => send({ act: 'name', owner })} />
      {said !== null && (said.refusal
        ? <p className="wi-refusal wl-linear-said" role="alert">{said.text}</p>
        : <p className="wi-status wl-linear-said" role="status">{said.text}</p>)}
    </div>
  );
}
