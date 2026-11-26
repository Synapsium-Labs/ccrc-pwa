// The ladder's three doors for the Overlord's place (Overlord W1 home B, Task 4; plan "Authority", "The taking effect line" and
// "A latch's Clear is a raise"): L4. The place calls this once and hands the answer to both `ReadinessPart` (for Pause) and
// `LadderPart` (the rung and Clear), so the two share one in-flight guard, one refusal line and one "taking effect" state.
//
// AUTHORITY. Pause and a rung lowered to `off` or `chat` ask no step-up. A rung raised above the operator's current one, and a
// latch's Clear (a raise), go through the place's one `stepUp.runAct`: the server's gate answers `step-up-required` where it
// must, and `runAct` shows the step and waits for the operator to press the act again. The direction of a rung move is
// `rungMovesUp` (L1), never decided here.
//
// WHAT FOLLOWS A DOOR. Pause and a lowered rung whose answer carries a `narrowing`, present and not null, keep it (the "taking
// effect" line keys on that, never on `changed`: main answers Pause from `chat` with `changed: false` and no `narrowing`) and
// nudge the witness exchange (plan question 10). Clear answers no narrowing: none is kept, and no exchange follows. After EVERY
// door, success or refusal, the store is read again. A refusal is said in its sentence (`overlordRefusalText`); a 401 is left to
// the sign-in screen, as `RestoreBanner` leaves it.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { NarrowingState, Rung } from '../../../shared/overlord-ladder';
import type { StepUp } from '../accounts/useStepUp';
import { ApiError, api, overlordRefusalText } from '../lib/api';
import { nudgeWitness } from '../lib/witness';
import { refreshOverlord, useLadder } from '../stores/overlord';
import { rungMovesUp } from './ladderWords';

/** Which door the last answer or refusal belongs to: the part that owns that door draws its line and its sentence. */
export type LadderDoor = 'pause' | 'rung' | 'clear';

export interface LadderDoors {
  readonly busy: boolean;
  /** The last refusal's sentence, or null. */
  readonly said: string | null;
  /** The narrowing the last narrowing door answered, present and not null; null otherwise. */
  readonly narrowing: NarrowingState | null;
  /** The door `said` and `narrowing` belong to. */
  readonly door: LadderDoor | null;
  pause(): Promise<void>;
  setRung(rung: Rung): Promise<void>;
  clear(cause: string): Promise<void>;
}

interface DoorAnswer { readonly narrowing?: NarrowingState | null }

/** The one reader of a narrowing door's answer: present and not null, or null. */
function narrowingOf(answer: unknown): NarrowingState | null {
  const n = (answer as DoorAnswer | null | undefined)?.narrowing;
  return n !== undefined && n !== null && typeof n === 'object' ? n : null;
}

export function useLadderDoors(stepUp: StepUp): LadderDoors {
  const ladder = useLadder();
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [narrowing, setNarrowing] = useState<NarrowingState | null>(null);
  const [door, setDoor] = useState<LadderDoor | null>(null);
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  // The operator's rung as the last read has it: what a rung move is a raise from. Held in a ref so a door sent from an
  // earlier render still reads the newest read.
  const currentRung = useRef<string | null>(null);
  currentRung.current = ladder.state === 'answered' || ladder.state === 'stale' ? ladder.value.operatorRung : null;
  const stepUpRef = useRef(stepUp);
  stepUpRef.current = stepUp;

  const run = useCallback(async (which: LadderDoor, call: () => Promise<unknown>, opts: { stepped: boolean; narrows: boolean }): Promise<void> => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setSaid(null);
    setNarrowing(null);
    setDoor(which);
    try {
      let answer: unknown;
      const act = async (): Promise<void> => { answer = await call(); };
      if (opts.stepped) {
        const outcome = await stepUpRef.current.runAct(act);
        if (outcome === 'step-up') return;
      } else {
        await act();
      }
      const n = opts.narrows ? narrowingOf(answer) : null;
      if (n !== null) {
        if (mounted.current) setNarrowing(n);
        nudgeWitness();
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (mounted.current) setSaid(overlordRefusalText(err));
    } finally {
      inFlight.current = false;
      if (mounted.current) setBusy(false);
      void refreshOverlord();
    }
  }, []);

  const pause = useCallback(() => run('pause', () => api.overlordPause(), { stepped: false, narrows: true }), [run]);
  const setRung = useCallback((rung: Rung) => {
    const raise = currentRung.current === null ? true : rungMovesUp(currentRung.current, rung);
    return run('rung', () => api.overlordRung(rung), { stepped: raise, narrows: !raise });
  }, [run]);
  const clear = useCallback((cause: string) => run('clear', () => api.clearLatch(cause), { stepped: true, narrows: false }), [run]);

  return { busy, said, narrowing, door, pause, setRung, clear };
}
