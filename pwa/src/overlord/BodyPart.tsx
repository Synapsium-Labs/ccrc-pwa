// The Overlord place's body part: Start, Open, Rebind and Restart (Overlord W1 home B, Task 5; spec 2026-11-09 §3.1, §3.2;
// plan `w1-home.md` Task 5). Ring L4, context C5: it decides nothing. Which controls a state draws is `bodyControlsOf` (L1,
// `placeWords.ts`); the state is `useDesignationState()`'s, so an unread designation draws no control, and Restart is drawn from
// the readiness read's `restartable`, never from its word (F2).
//
// THE DOORS. Start (`POST /api/overlord/designate`) and Rebind (`POST /api/overlord/rebind`) are raises: each runs once through the
// place's one step-up (`stepUp.runAct`), and on `step-up-required` the place's `ConfirmItsYou` shows the step and the operator
// presses the act again (nothing is retried here). Restart is a recovery with no step-up. Every refusal is drawn by
// `overlordRefusalText`, never swallowed; a 401 is the sign-in screen's. After every door that answers, a step-up refusal
// included (slug `refresh-after-every-door`), the store reads again (`refreshOverlord`). A refused Rebind that says
// `overlord-body-alive` offers "Rebind anyway" (`force: true`, behind the step-up) with the spec's sentence that the old session is
// stopped. The offer keeps the session and term it was refused for and is drawn only while the designation still names them
// (`forceStands`, L1), and its refusal line goes with it.
//
// START opens only once the accounts read has landed (`accountsHeard`): until then a sentence says it waits. The first start's
// set opens with every roster pool on and untagged accounts off, or on where the roster has no pool (slug
// `first-start-set-every-pool-untagged-off`; `openingUntaggedOf`, L1).
//
// The class names below are the place's one stylesheet's: `overlord-body` (the part), `overlord-body-form` (Start's inputs, one
// column), `overlord-body-actions` (the control row, wrapping), `overlord-body-note` (a status line), `overlord-body-refusal`.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, useNow, RadioFieldset } from '@ccrc/ui';
import type { OverlordModelClass } from '../../../shared/overlord-designation';
import type { StepUp } from '../accounts/useStepUp';
import { ApiError, api, overlordRefusalText } from '../lib/api';
import { poolOptions } from '../lib/pools';
import { navigate } from '../lib/router';
import { sessionPath } from '../lib/routes';
import { refreshOverlord, useDesignationState, useOverlordStore, useReadiness } from '../stores/overlord';
import { useFleetStore } from '../stores/fleet';
import { AccountSetFieldset } from './AccountSetFieldset';
import {
  BODY_WORDS, DEFAULT_MODEL_CLASS, MODEL_CLASS_OPTIONS, accountSetOf, attemptOutcomeText, bodyControlsOf, bodyLeadOf,
  designateWarningText, forceOfferOf, forceStands, pendingOf, pendingWords, refusalStands, refusalWordOf, startGateOf, startLabelOf,
  untaggedOf, type ForceOffer,
} from './placeWords';

type Door = 'start' | 'rebind' | 'restart';

export function BodyPart({ stepUp }: { readonly stepUp: StepUp }): ReactNode {
  const state = useDesignationState();
  const designation = useOverlordStore((s) => s.designation);
  const readiness = useReadiness();
  const roster = useFleetStore((s) => s.roster);
  const accountsHeard = useFleetStore((s) => s.accountsHeard);
  // The page clock, ticking while an attempt is pending, so the deadline's "within N min" moves on its own.
  const now = useNow(30_000, state.kind === 'pending');

  const [model, setModel] = useState<OverlordModelClass>(DEFAULT_MODEL_CLASS);
  const [off, setOff] = useState<readonly string[]>([]);
  // The operator's own pick for untagged accounts, or null until made: the opening is L1's (`untaggedOf`), and depends on the
  // roster, which may land after the form is drawn.
  const [untaggedPick, setUntaggedPick] = useState<boolean | null>(null);
  const [busy, setBusy] = useState<Door | null>(null);
  // The refusal's sentence, and whether it came with a "Rebind anyway" offer (the sentence then goes with the offer).
  const [refusal, setRefusal] = useState<{ readonly text: string; readonly withOffer: boolean } | null>(null);
  const [warnings, setWarnings] = useState<readonly string[]>([]);
  // The binding a refused Rebind was refused for (F4): kept with the offer, drawn only while it stands.
  const [force, setForce] = useState<ForceOffer | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const options = useMemo(() => poolOptions(roster), [roster]);
  const untagged = untaggedOf(untaggedPick, options, accountsHeard);
  const set = accountSetOf(options, off, untagged);
  const gate = startGateOf(set, accountsHeard);
  const offerStands = forceStands(force, designation);
  // The binding moved after the refusal: the offer is dropped (L1 decided it), and the sentence that came with it.
  useEffect(() => {
    if (force === null || offerStands) return;
    setForce(null);
    setRefusal((cur) => (cur !== null && cur.withOffer ? null : cur));
  }, [force, offerStands]);
  const controls = bodyControlsOf(state, readiness);
  const lead = bodyLeadOf(state);
  const pending = pendingOf(designation);

  /** One door, once: the busy mark, its refusal in words, and a fresh read after any answer, a step-up refusal
   *  included (the ladder's doors read again in their `finally` too); only a 401 is left to the sign-in screen. */
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
        // The designation as the store holds it now, when the Rebind is refused, is the binding the offer is for.
        const offer = door === 'rebind' ? forceOfferOf(err instanceof ApiError ? refusalWordOf(err.body) : null, useOverlordStore.getState().designation) : null;
        setRefusal({ text: overlordRefusalText(err, door), withOffer: offer !== null });
        setForce(offer);
      }
    } finally {
      if (mounted.current) setBusy(null);
    }
    if (outcome === 'done' && mounted.current) setForce(null);
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
  // A forced rebind names the binding its offer was made for (slug `forced-rebind-names-the-session-it-stops`): the door compares
  // it with what is bound and refuses `stale-designation` when it moved, so it never stops a session the operator did not see.
  const rebind = (forced: boolean): Promise<void> =>
    run('rebind', () => stepUp.runAct(() => api.overlordRebind(forced, forced && force !== null ? force : undefined)));
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
          <AccountSetFieldset
            legend={BODY_WORDS.accounts} disabled={busy !== null} marker="data-overlord-account-set"
            boxes={[
              ...options.map((pool) => ({ key: pool, label: pool, on: !off.includes(pool), set: (v: boolean) => flip(pool, v) })),
              { key: '(untagged)', label: BODY_WORDS.untagged, on: untagged, set: setUntaggedPick },
            ]}
          />
          {gate !== null && <p className="overlord-body-note" role="status" data-overlord-start-wait={gate.kind === 'waiting' ? '' : undefined}>{gate.text}</p>}
        </div>
      )}
      <div className="overlord-body-actions">
        {controls.includes('start') && (
          <Button variant="primary" size="fit" data-overlord-control="start" disabled={busy !== null || gate !== null} onClick={() => { void start(); }}>
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
      {offerStands && controls.includes('rebind') && (
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
      {refusal !== null && refusalStands(refusal.withOffer, offerStands) && (
        <p className="overlord-body-refusal" role="alert" data-overlord-refusal>{refusal.text}</p>
      )}
    </section>
  );
}
