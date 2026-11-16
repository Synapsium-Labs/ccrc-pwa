// "I handled this elsewhere" (Overlord W1, C69), L4: reads the message's response rows and, when some are unhandled,
// offers one button that marks every one of them. While the read is pending or failed, and when there are no rows,
// it renders nothing. The handled sentence shows at once and rolls back to the button on any refusal; no undo.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { api } from '../lib/api';
import { HANDLED_WORDS, handledState, refParam, type HandledState } from './responseWords';
import type { ResponseRef } from '../../../shared/responses';

export function HandledElsewhere({ target }: { target: Extract<ResponseRef, { kind: 'item' | 'digest' }> }): ReactNode {
  const param = refParam(target);
  const [state, setState] = useState<HandledState>({ kind: 'none' });
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);
  useEffect(() => {
    let live = true;
    setState({ kind: 'none' });
    api.responsesFor(param).then((a) => { if (live) setState(handledState(a.rows)); }).catch(() => {});
    return () => { live = false; };
  }, [param]);
  if (state.kind === 'none') return null;
  if (state.kind === 'handled') return <p className="wi-status" data-handled="true">{HANDLED_WORDS.handled}</p>;
  const offer = state;
  const mark = (): void => {
    setBusy(true);
    setRefused(false);
    setState({ kind: 'handled' });
    Promise.all(offer.ids.map((id) => api.markResponseHandled(id)))
      .catch(() => { setState(offer); setRefused(true); })
      .finally(() => setBusy(false));
  };
  return (
    <div className="handled-elsewhere">
      <Button variant="ghost" size="fit" disabled={busy} onClick={mark}>{HANDLED_WORDS.button}</Button>
      {refused && <p className="wi-refusal" role="alert">{HANDLED_WORDS.refused}</p>}
    </div>
  );
}
