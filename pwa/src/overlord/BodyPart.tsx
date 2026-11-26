// The Overlord place's body part: Start, Open, Rebind and Restart (Overlord W1 home B, Task 5; spec 2026-11-09 §3.1, §3.2;
// plan `w1-home.md` Task 5). Ring L4, context C5: it decides nothing. Which controls a state draws is `bodyControlsOf` (L1,
// `placeWords.ts`); the state is `useDesignationState()`'s, so an unread designation draws no control, and Restart is drawn from
// the readiness read's `restartable`, never from its word (F2).
//
// THE DOORS. Start (`POST /api/overlord/designate`) and Rebind (`POST /api/overlord/rebind`) are raises: each runs once through the
// place's one step-up (`stepUp.runAct`), and on `step-up-required` the place's `ConfirmItsYou` shows the step and the operator
// presses the act again (nothing is retried here). Restart is a recovery with no step-up. Every refusal is drawn by
// `overlordRefusalText`, never swallowed; a 401 is the sign-in screen's. After every door that answers, the store reads again
// (`refreshOverlord`). A refused Rebind that says `overlord-body-alive` offers "Rebind anyway" (`force: true`, behind the step-up)
// with the spec's sentence that the old session is stopped.
//
// The class names below are the place's one stylesheet's: `overlord-body` (the part), `overlord-body-form` (Start's inputs, one
// column), `overlord-body-actions` (the control row, wrapping), `overlord-body-note` (a status line), `overlord-body-refusal`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, useNow, RADIO_FIELDSET, RADIO_INPUT, RADIO_LEGEND, RADIO_OPTION, RADIO_SENTENCE, RadioFieldset } from '@ccrc/ui';
import type { OverlordModelClass } from '../../../shared/overlord-designation';
import type { StepUp } from '../accounts/useStepUp';
import { ApiError, api, overlordRefusalText } from '../lib/api';
import { poolOptions } from '../lib/pools';
import { navigate } from '../lib/router';
import { sessionPath } from '../lib/routes';
import { refreshOverlord, useDesignationState, useOverlordStore, useReadiness } from '../stores/overlord';
import { useFleetStore } from '../stores/fleet';
import {
  BODY_WORDS, DEFAULT_MODEL_CLASS, MODEL_CLASS_OPTIONS, accountSetOf, attemptOutcomeText, bodyControlsOf, bodyLeadOf,
  designateWarningText, offersForce, pendingOf, pendingWords, refusalWordOf, startBlockedWhy, startLabelOf,
} from './placeWords';

type Door = 'start' | 'rebind' | 'restart';

export function BodyPart({ stepUp }: { readonly stepUp: StepUp }): ReactNode {
  const state = useDesignationState();
  const designation = useOverlordStore((s) => s.designation);
  const readiness = useReadiness();
  const roster = useFleetStore((s) => s.roster);
  // The page clock, ticking while an attempt is pending, so the deadline's "within N min" moves on its own.
  const now = useNow(30_000, state.kind === 'pending');

  const [model, setModel] = useState<OverlordModelClass>(DEFAULT_MODEL_CLASS);
  const [off, setOff] = useState<readonly string[]>([]);
  const [untagged, setUntagged] = useState(true);
  const [busy, setBusy] = useState<Door | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  const [forceOffered, setForceOffered] = useState(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const options = useMemo(() => poolOptions(roster), [roster]);
  const set = accountSetOf(options, off, untagged);
  const blocked = startBlockedWhy(set);
  const controls = bodyControlsOf(state, readiness);
  const lead = bodyLeadOf(state);
  const pending = pendingOf(designation);

  /** One door, once: the busy mark, its refusal in words, and a fresh read after any answer. `'step-up'` means the step is
   *  showing and nothing was sent past it, so there is nothing to read again. */
  const run = async (door: Door, act: () => Promise<'done' | 'step-up'>): Promise<void> => {
    if (busy !== null) return;
    setBusy(door);
    setRefusal(null);
    let outcome: 'done' | 'step-up' | 'refused' = 'refused';
    try {
      outcome = await act();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) return;
      if (mounted.current) {
        setRefusal(overlordRefusalText(err));
        setForceOffered(door === 'rebind' && offersForce(err instanceof ApiError ? refusalWordOf(err.body) : null));
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
    if (outcome === 'step-up') return;
    if (outcome === 'done' && mounted.current) setForceOffered(false);
    await refreshOverlord();
  };

  const start = (): Promise<void> => run('start', async () => {
    setWarnings([]);
    const said: { warnings: readonly string[] } = { warnings: [] };
    const outcome = await stepUp.runAct(async () => {
      const answer = await api.overlordDesignate({ model, accountPools: set });
      said.warnings = (answer.warnings ?? []).map(designateWarningText);
    });
    if (outcome === 'done' && mounted.current) setWarnings(said.warnings);
    return outcome;
  });
  const rebind = (force: boolean): Promise<void> => run('rebind', () => stepUp.runAct(() => api.overlordRebind(force)));
  const restart = (): Promise<void> => run('restart', async () => { await api.overlordRestart(); return 'done'; });

  const flip = (pool: string, on: boolean): void => setOff((cur) => (on ? cur.filter((p) => p !== pool) : [...cur, pool]));

  return (
    <section className="overlord-body" data-overlord-body={state.kind} aria-label="The Overlord's session">
      {lead !== null && <p className="overlord-body-note" role="status">{lead}</p>}
      {state.kind === 'failed-start' && <p className="overlord-body-note" role="status" data-overlord-outcome={state.outcome}>{attemptOutcomeText(state.outcome)}</p>}
      {state.kind === 'pending' && pending !== null && (
        <p className="overlord-body-note" role="status" data-overlord-pending={pending.kind}>{pendingWords(pending, now)}</p>
      )}
      {controls.includes('start') && (
        <div className="overlord-body-form" data-overlord-start-form>
          <RadioFieldset
            legend={BODY_WORDS.model} name="overlord-model" options={MODEL_CLASS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            value={model} onPick={setModel} disabled={busy !== null}
          />
          <fieldset className={RADIO_FIELDSET} disabled={busy !== null} data-overlord-account-set>
            <legend className={RADIO_LEGEND}>{BODY_WORDS.accounts}</legend>
            {options.map((pool) => (
              <label key={pool} className={RADIO_OPTION}>
                <input type="checkbox" className={RADIO_INPUT} checked={!off.includes(pool)} onChange={(e) => flip(pool, e.currentTarget.checked)} />
                <span className={RADIO_SENTENCE}>{pool}</span>
              </label>
            ))}
            <label className={RADIO_OPTION}>
              <input type="checkbox" className={RADIO_INPUT} checked={untagged} onChange={(e) => setUntagged(e.currentTarget.checked)} />
              <span className={RADIO_SENTENCE}>{BODY_WORDS.untagged}</span>
            </label>
          </fieldset>
          {blocked !== null && <p className="overlord-body-note" role="status">{blocked}</p>}
        </div>
      )}
      <div className="overlord-body-actions">
        {controls.includes('start') && (
          <Button variant="primary" size="fit" data-overlord-control="start" disabled={busy !== null || blocked !== null} onClick={() => { void start(); }}>
            {busy === 'start' ? BODY_WORDS.starting : startLabelOf(state)}
          </Button>
        )}
        {controls.includes('open') && state.kind === 'bound' && (
          <Button variant="primary" size="fit" data-overlord-control="open" onClick={() => navigate(sessionPath(state.sessionId))}>
            {BODY_WORDS.open}
          </Button>
        )}
        {controls.includes('rebind') && (
          <Button variant="ghost" size="fit" data-overlord-control="rebind" disabled={busy !== null} onClick={() => { void rebind(false); }}>
            {busy === 'rebind' ? BODY_WORDS.working : BODY_WORDS.rebind}
          </Button>
        )}
        {controls.includes('restart') && (
          <Button variant="ghost" size="fit" data-overlord-control="restart" disabled={busy !== null} onClick={() => { void restart(); }}>
            {busy === 'restart' ? BODY_WORDS.working : BODY_WORDS.restart}
          </Button>
        )}
      </div>
      {forceOffered && controls.includes('rebind') && (
        <div className="overlord-body-note" data-overlord-force>
          <p>{BODY_WORDS.forceSentence}</p>
          <Button variant="danger-ghost" size="fit" data-overlord-control="rebind-anyway" disabled={busy !== null} onClick={() => { void rebind(true); }}>
            {BODY_WORDS.rebindAnyway}
          </Button>
        </div>
      )}
      {warnings.length > 0 && (
        <ul className="overlord-body-note" data-overlord-warnings>
          {warnings.map((w) => <li key={w}>{w}</li>)}
        </ul>
      )}
      {refusal !== null && <p className="overlord-body-refusal" role="alert" data-overlord-refusal>{refusal}</p>}
    </section>
  );
}
