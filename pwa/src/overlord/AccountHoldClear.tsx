// Clear one of the Overlord's standing account holds (Overlord W1 home C, Task 9; spec §3.6; plan F17). Ring L4, context C5: one
// control, drawn by Settings › Overlord's account facts beside a lane the holds read names, and by the hold item's detail
// (`ItemView.tsx`) for the lane its title names, so the item and the card share one control.
//
// THE DOOR (`POST /api/continuity/account-holds/:lane/clear`) asks no step-up: a hold only narrows, so its clear widens back to
// the set the operator chose, which the door rules. It is sent once: a second tap while it is in flight sends nothing, and
// after an answer the button goes. `not-found` (no hold stands any more) takes the button with it too; any other refusal is
// drawn by its sentence and leaves the button to be pressed again. A 401 is the sign-in screen's.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { ApiError, api, overlordSettingsRefusalText } from '../lib/api';
import { FACT_WORDS } from './overlordSettingsWords';

// `current` is false on an item drawn from the device's saved copy (`ItemViewProps.current`): Clear is disabled and sends nothing,
// the panel's rule for every act (review 4056 F2).
// `onAnswered` hears every answer with what it said: `cleared`, `gone` (no hold stood) or `refused` (anything else, a 401
// included), so a caller can tell an answer that ended the hold from one that changed nothing (review 4065 F2).
export type HoldClearOutcome = 'cleared' | 'gone' | 'refused';
// `onSent` hears the send itself, before any answer, so a caller can keep this control mounted while its Clear is in flight: an
// answer that lands after another re-read has dropped the lane's hold then lands here and is drawn (W2 Settings, the carried ticket
// `clear-answer-after-its-control-unmounted`).
export function AccountHoldClear({ lane, onAnswered, onSent, current = true }: {
  readonly lane: string; readonly onAnswered?: (outcome: HoldClearOutcome) => void; readonly onSent?: () => void; readonly current?: boolean;
}): ReactNode {
  const [state, setState] = useState<'ready' | 'busy' | 'cleared' | 'gone'>('ready');
  const [refusal, setRefusal] = useState<string | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const clear = async (): Promise<void> => {
    if (inFlight.current || !current) return;
    inFlight.current = true;
    setState('busy');
    setRefusal(null);
    onSent?.();
    let outcome: HoldClearOutcome = 'refused';
    try {
      await api.clearAccountHold(lane);
      outcome = 'cleared';
      if (mounted.current) setState('cleared');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) { if (mounted.current) setState('ready'); return; }
      const said = overlordSettingsRefusalText(err, 'hold-clear', true);
      if (err instanceof ApiError && err.status === 404) outcome = 'gone';
      if (mounted.current) { setRefusal(said); setState(outcome === 'gone' ? 'gone' : 'ready'); }
    } finally {
      inFlight.current = false;
      onAnswered?.(outcome);
    }
  };
  if (state === 'cleared') return <p className="ovs-note" role="status" data-hold-cleared={lane}>{FACT_WORDS.cleared}</p>;
  return (
    <>
      {state !== 'gone' && (
        <Button variant="ghost" size="fit" data-hold-clear={lane} disabled={state === 'busy' || !current} onClick={() => { void clear(); }}>
          {state === 'busy' ? FACT_WORDS.clearing : FACT_WORDS.clear}
        </Button>
      )}
      {refusal !== null && <p className="ovs-refusal" role="alert" data-hold-refusal={lane}>{refusal}</p>}
    </>
  );
}
