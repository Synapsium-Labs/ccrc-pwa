// The Move sessions sheet (spec 2026-10-18 accounts-connect §4.5; accounts plan Task A3): "Move N sessions off" on a
// trouble card opens it, and it moves every session on one lane to one target, ONE AT A TIME.
//
// A client composition over `POST /api/sessions/:id/swap`, obeying that route's rules rather than restating them:
//   - THE TARGET is SwapSheet's own chooser (`SwapTargetChooser`), over the same candidates (`pickableWrappers` minus
//     the lanes an operator switched off) and the same pool split. With several sessions, a lane is in "the same pool"
//     only when it is eligible for EVERY session's project; the default is the least-loaded of those, by measured
//     numbers only (`leastLoaded`). A lane behind the other-pools disclosure is never the default: picking one is the
//     explicit crossing, and `crossPool` then rides only the moves that the target really crosses for.
//   - ONE AT A TIME. The server serialises nothing across sessions, and N swaps at once would restart N Claude processes
//     together, each running its SessionStart hooks. Each move is awaited before the next is sent, and the progress
//     line counts what has answered.
//   - BUSY SESSIONS ARE SKIPPED by default: each move is sent without consent, and the route's measured
//     `409 session-busy` is the skip. "Also interrupt busy ones" sends the existing consent (`interrupt: true`) as
//     SwapSheet's "swap anyway" does, as the second request after that refusal, so consent only ever follows a turn
//     the server measured.
//   - EACH SESSION GETS ONE OUTCOME WORD from its answer's code (`moveOutcomeOf`): moved, skipped busy, refused asleep
//     (the route's `SWAP_REFUSALS.hibernated`, which it answers before any turn read), refused other pool
//     (`pool-mismatch`), or refused with the reason its code names. No response text is rendered, and a refusal never
//     stops the sessions after it.
//   - OFFLINE, NOTHING IS SENT (spec §12.5). Offline is the fleet store's own reading (`conn` not `open`), never
//     `navigator.onLine`. Opened offline, the sheet says so and Move is off, so no swap leaves the page. A move under
//     way stops when the link drops or a swap gets no answer at all: that session reads "no answer: it may have moved",
//     and the rest read "not sent" rather than each spending a request that cannot be answered.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { isArchivedRow, type FleetSession } from '../../../shared/api';
import { Button, OptionRow, RESET_LIST, Sheet } from '@ccrc/ui';
import { accountLabel } from '../lib/accounts';
import { ApiError, api } from '../lib/api';
import { projectPoolOf, splitByPool } from '../lib/pools';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { disabledWrappers, leastLoaded, pickableWrappers, pickerEmptiness } from './accountPicker';
import { moveOutcomeOf, type MoveOutcome, type SwapAnswer } from './accountWords';
import { presenceOf } from './presence';
import { sessionLabel } from './sessionLabel';
import { ALL_SWITCHED_OFF, SwapTargetChooser } from './SwapSheet';
import './fleet.css';

/** The sessions a move off `lane` takes, in the fleet's order: every row on the lane that is not archived and that the
 *  server reads alive or asleep. An asleep one is listed so that it is named ("refused: asleep") rather than silently
 *  left behind; a dead or unknown pane has nothing to move. */
export function sessionsToMove(sessions: readonly FleetSession[], lane: string): FleetSession[] {
  return sessions.filter((s) => {
    if (s.wrapper !== lane || isArchivedRow(s)) return false;
    const p = presenceOf(s);
    return p === 'alive' || p === 'asleep';
  });
}

/** One swap, answered as `moveOutcomeOf` reads it: the refusal's status and code, never its text. */
async function swapOnce(id: string, wrapper: string, crossPool: boolean, interrupt: boolean): Promise<SwapAnswer> {
  try {
    await (crossPool || interrupt
      ? api.swap(id, wrapper, { ...(crossPool ? { crossPool: true } : {}), ...(interrupt ? { interrupt: true } : {}) })
      : api.swap(id, wrapper));
    return { kind: 'ok' };
  } catch (err) {
    if (!(err instanceof ApiError)) return { kind: 'no-answer' };
    const body: unknown = err.body;
    const raw = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : undefined;
    return { kind: 'refused', status: err.status, code: typeof raw === 'string' ? raw : null };
  }
}

type Phase = 'idle' | 'running' | 'done';

/** Opened offline: why Move is off (spec §12.5). The read-line beside it is Task A18's, with the store's read time. */
export const MOVE_OFFLINE = "You're offline: nothing will be sent until the server answers again.";
/** A move the link stopped: the session in flight keeps its own word, and nothing after it was sent. */
export const MOVE_LINK_LOST = 'The server stopped answering, so the rest were not sent.';
/** The class both offline lines wear: the sheet's sentence, marked as the offline one. */
const OFFLINE_LINE = 'sheet-copy move-offline';

export interface MoveSessionsSheetProps {
  /** The lane the sessions move off. */
  lane: string;
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

export function MoveSessionsSheet({ lane, open, onClose, fleet = useFleetStore }: MoveSessionsSheetProps): ReactNode {
  const sessions = fleet((s) => s.sessions);
  const roster = fleet((s) => s.roster);
  const pools = fleet((s) => s.pools);
  const accounts = fleet((s) => (open ? s.usage : null));
  // The store's offline reading: a cold start from the snapshot (`connecting`) is no more live than a dropped link.
  const offline = fleet((s) => s.conn !== 'open');

  const [phase, setPhase] = useState<Phase>('idle');
  // The list being moved, frozen when the move starts: a moved session leaves the lane in the next fleet frame, and its
  // row must stay to carry its word.
  const [moving, setMoving] = useState<readonly FleetSession[] | null>(null);
  const [outcomes, setOutcomes] = useState<ReadonlyMap<string, { outcome: MoveOutcome; word: string }>>(new Map());
  const [answered, setAnswered] = useState(0);
  const [stopped, setStopped] = useState(false);
  const [linkLost, setLinkLost] = useState(false);
  const [chosen, setChosen] = useState<string | null>(null);
  const [showOther, setShowOther] = useState(false);
  const [interruptBusy, setInterruptBusy] = useState(false);
  const [stopping, setStopping] = useState(false);
  // Read by the loop between moves: closing the sheet or Stop ends the move after the session in flight.
  const stop = useRef(false);
  const running = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; stop.current = true; }; }, []);

  // A fresh sheet for each opening and each lane, unless a move is still finishing its session in flight.
  useEffect(() => {
    if (!open || running.current) return;
    setPhase('idle'); setMoving(null); setOutcomes(new Map()); setAnswered(0); setStopped(false); setLinkLost(false);
    setChosen(null); setShowOther(false); setInterruptBusy(false); setStopping(false);
  }, [open, lane]);

  const live = sessionsToMove(sessions, lane);
  const list = moving ?? live;

  // The candidates, as SwapSheet builds them: every lane this build knows except this one, minus the switched off.
  const switchedOff = disabledWrappers(accounts);
  const others = pickableWrappers(roster, sessions).filter((w) => w !== lane);
  const wrappers = others.filter((w) => !switchedOff.includes(w));
  const emptiness = pickerEmptiness(others, wrappers);
  // Each session's own pool split; a lane is eligible only when it is eligible for every one of them.
  const splitOf = (s: FleetSession) => splitByPool(roster, wrappers, projectPoolOf(pools, s.project));
  const splits = list.map(splitOf);
  const eligible = wrappers.filter((w) => splits.every((sp) => sp.eligible.includes(w)));
  const split = {
    eligible,
    crossing: wrappers.filter((w) => !eligible.includes(w)),
    unknown: splits.length > 0 && splits.every((sp) => sp.unknown),
  };
  const suggested = leastLoaded(accounts, split.eligible);
  const target = chosen ?? suggested;
  const crossing = target !== null && split.crossing.includes(target);
  const emptyNote = emptiness === null
    ? null
    : emptiness === 'none-known'
      ? 'No other account to move these sessions to yet.'
      : ALL_SWITCHED_OFF;

  const run = (): void => {
    if (target === null || running.current || offline) return;
    const batch = [...list];
    const to = target;
    running.current = true;
    stop.current = false;
    setMoving(batch); setPhase('running'); setAnswered(0); setOutcomes(new Map()); setStopped(false); setStopping(false);
    setLinkLost(false);
    void (async () => {
      let lost = false;
      for (const s of batch) {
        if (stop.current) break;
        // Read between moves, never sent into: a link the store reads down answers nothing.
        if (fleet.getState().conn !== 'open') { lost = true; break; }
        // `crossPool` only where the target crosses for THIS session's project, and only when the crossing was picked.
        const cross = crossing && splitOf(s).crossing.includes(to);
        let answer = await swapOnce(s.id, to, cross, false);
        if (interruptBusy && answer.kind === 'refused' && moveOutcomeOf(answer).outcome === 'skipped-busy') {
          answer = await swapOnce(s.id, to, cross, true);
        }
        if (!mounted.current) return;
        const word = moveOutcomeOf(answer);
        setOutcomes((m) => new Map(m).set(s.id, word));
        setAnswered((n) => n + 1);
        // No answer at all puts the link in doubt: the rest are not sent into it (a refusal is an answer, and goes on).
        if (answer.kind === 'no-answer') { lost = true; break; }
      }
      running.current = false;
      if (!mounted.current) return;
      setStopped(stop.current || lost);
      setLinkLost(lost);
      setPhase('done');
    })();
  };

  const close = (): void => {
    // Closing mid-move is a stop: the session in flight finishes, and nothing after it is sent.
    if (running.current) { stop.current = true; setStopping(true); }
    onClose();
  };

  const n = list.length;
  const movedCount = [...outcomes.values()].filter((o) => o.outcome === 'moved').length;
  const progress = phase === 'running'
    ? `Moving ${Math.min(answered + 1, n)} of ${n}`
    : phase === 'done'
      ? `${stopped ? 'Stopped' : 'Done'}: ${movedCount} of ${n} moved.`
      : '';
  const targetLabel = target === null ? null : accountLabel(roster, target);

  return (
    <Sheet open={open} onClose={close} eyebrow="move sessions" title={`Move sessions off ${lane}`}>
      <p className="sheet-copy">
        One at a time: each session restarts under the account you pick, and the next waits for it to answer. Anyone
        attached is briefly disconnected.
      </p>
      {n === 0 ? (
        <p className="acct-none">No sessions are running on {lane}.</p>
      ) : (
        <ul className={RESET_LIST}>
          {list.map((s, i) => {
            const o = outcomes.get(s.id);
            const word = o?.word
              ?? (phase === 'running' && i === answered ? 'moving…'
                : phase === 'idle' ? '' : phase === 'running' ? 'waiting' : 'not sent');
            return (
              <li key={s.id} className="move-row" data-outcome={o?.outcome ?? (word === '' ? undefined : 'pending')}>
                <span className="move-name">
                  <span>{sessionLabel(s)}</span>
                  {s.project !== sessionLabel(s) && <span className="move-project">{s.project}</span>}
                </span>
                {word !== '' && <span className="move-word">{word}</span>}
              </li>
            );
          })}
        </ul>
      )}
      {/* Announced politely, and only ever counts what has answered. */}
      <p className="move-progress" role="status" aria-live="polite">{progress}</p>
      {phase === 'done' && linkLost && <p className={OFFLINE_LINE} role="alert">{MOVE_LINK_LOST}</p>}
      {phase === 'idle' && n > 0 && offline && <p className={OFFLINE_LINE} role="status">{MOVE_OFFLINE}</p>}
      {phase === 'idle' && n > 0 && (
        <>
          <p className="sheet-copy">
            {targetLabel === null
              ? 'Pick the account to move them to.'
              : `To ${targetLabel}${target === suggested ? ` · least-loaded${split.unknown ? '' : ' in this pool'}` : ''}.`}
            {crossing
              ? ' This crosses pools on purpose for the sessions whose project is in another pool: ccrc records each '
                + 'crossing, and leaves those sessions alone until the project is retagged or they move again.'
              : ''}
          </p>
          <SwapTargetChooser
            split={split}
            accounts={accounts}
            suggested={suggested}
            emptyNote={emptyNote}
            roster={roster}
            onPick={setChosen}
            showOther={showOther}
            onToggleOther={() => setShowOther((shown) => !shown)}
          />
          <OptionRow
            label="Also interrupt busy ones"
            sublabel={interruptBusy
              ? 'A busy session is moved anyway: the turn in progress and its background tasks are lost.'
              : 'Busy sessions are skipped, and keep working where they are.'}
            checked={interruptBusy}
            onClick={() => setInterruptBusy((v) => !v)}
          />
          <Button disabled={target === null || offline} onClick={run}>{`Move ${n} ${n === 1 ? 'session' : 'sessions'}`}</Button>
        </>
      )}
      {phase === 'running' && (
        <Button variant="ghost" disabled={stopping} onClick={() => { stop.current = true; setStopping(true); }}>
          {stopping ? 'Stopping after this one' : 'Stop after this one'}
        </Button>
      )}
      {phase === 'done' && <Button variant="ghost" onClick={close}>Close</Button>}
    </Sheet>
  );
}
