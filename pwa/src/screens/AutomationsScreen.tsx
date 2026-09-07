// Task 11, spec §11: the operator-facing automations surface — `/automations`.
//
// THREE EMPTY STATES, NEVER ONE (the brief's own first rule with teeth). "No
// answer yet" (`data-state="loading"`, until `automationsFrameSeen` flips OR
// the cold read settles), "answered empty" (`data-state="empty"`, a genuine
// zero-automation fleet) and "the read failed" (`data-state="error"`,
// `coldState !== 'ok'` with no live frame either) render as three DIFFERENT
// sentences — an empty-state sentence is a positive claim, and "No
// automations yet" is not one a failed read has standing to make. Same
// idiom `RunsScreen.tsx` already carries for its own two sources; this
// screen has one live list (the `{type:'automations'}` frame is a full
// snapshot of the store's DEFAULT filter, unlike `runs`'s active-only frame
// — spec §10 "Run history is NOT on the frame"), so there is no
// active/finished split to reconcile. The one state the frame does NOT carry
// is `retired`, which the default filter drops by design (spec §9); the
// retired chip therefore has its own server-side read and its own read
// state, a few lines down.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  type AutomationLastFilter, type AutomationRunSummary, type AutomationState, type AutomationStepWire,
  type AutomationSummary,
} from '../../../shared/api';
import { cadenceFromColumns, describeCadence } from '../../../shared/schedule';
import {
  automationErrorSentence, automationOutcomeChip, automationStateChip, refusalSentence,
  scheduleErrorSentence,
} from '../auto/autoWords';
import { AutomationSheet } from '../auto/AutomationSheet';
import { formatAge, formatReset } from '../fleet/formatReset';
import { api, ApiError } from '../lib/api';
import { navigate } from '../lib/router';
import { useNow } from '../lib/useNow';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import '../auto/auto.css';

/** Hoisted to MODULE scope, never an inline default parameter (the brief's
 *  second rule with teeth). `RunsScreen.tsx`'s `loadRunsDefault` and
 *  `MailScreen.tsx`'s `loadFeedDefault` both carry the identical warning and
 *  the identical fix: an inline `() => api.automations()` used as a default
 *  PARAMETER value is re-evaluated on every render, so its identity is
 *  fresh every time — a caller that keys an effect's dependency array on
 *  that identity (or a caller downstream that re-renders for any reason,
 *  even one unrelated to this prop) tears the effect down and re-fires it,
 *  forever, on the one path — the shipping default — no test exercised
 *  before this file's own fixture pinned it (`fetch-loop` in
 *  `automations.test.tsx`). */
const loadAutomationsDefault = (
  filter?: { state?: AutomationState },
): Promise<{ automations: AutomationSummary[]; paused?: boolean }> => api.automations(filter);

const stateFilters: readonly ('all' | AutomationState)[] = ['all', 'armed', 'paused', 'retired'];
const outcomeFilters: readonly ('all' | AutomationLastFilter)[] = ['all', 'ok', 'failed', 'never-ran'];

/** ONE STEP OF THE TRAIL (spec §11's run detail: "the step trail in order,
 *  each with time, `ok`, detail, and a visible marker when `truncatedBytes >
 *  0`"). The marker is not decoration: a detail is TRUNCATED, never refused
 *  (it is machine output — ccd's stderr on a failed spawn is the largest text
 *  stored), so an operator reading a cut detail has to know it is cut, or
 *  they will read the missing half as "nothing more was said". */
function AutomationStepRow({ step, nowSec }: { step: AutomationStepWire; nowSec: number }): ReactNode {
  return (
    <li className="auto-step-row" data-ok={step.ok ? 'true' : 'false'} data-step={step.step}>
      <span className="auto-step-glyph" aria-hidden="true">{step.ok ? '✓' : '✗'}</span>
      <span className="auto-step-name">{step.step}</span>
      <span className="auto-step-when">{formatAge(nowSec - Math.floor(step.at / 1000))}</span>
      {step.detail !== '' && <span className="auto-step-detail">{step.detail}</span>}
      {step.truncatedBytes > 0 && (
        <span className="auto-step-cut" data-cut="true" title="the stored detail was truncated">
          +{step.truncatedBytes} bytes cut
        </span>
      )}
    </li>
  );
}

function AutomationRunRow({ run, nowSec, getRun }: {
  run: AutomationRunSummary; nowSec: number; getRun: typeof api.automationRun;
}): ReactNode {
  const outcome = automationOutcomeChip(run.outcome);
  const refusal = run.refusal === null ? null : refusalSentence(run.refusal);
  // THE TRAIL IS PER RUN, so its state lives per run — the panel above holds
  // ONE `detail`, and giving the trail the same shape would make one run's
  // steps land under another (the row-ownership defect this screen already
  // carries a guard for). Its own three states, for this file's first rule:
  // a failed read must not read as "this run had no steps".
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState<AutomationStepWire[] | null>(null);
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading');
  const toggle = (): void => {
    if (open) { setOpen(false); return; }
    setOpen(true);
    setSteps(null);
    setState('loading');
    getRun(run.id)
      .then((r) => { setSteps(r.steps); setState('ok'); })
      .catch(() => setState('error'));
  };
  return (
    <li className="auto-run-row" data-outcome={outcome.token}>
      <button type="button" className="auto-run-open" onClick={toggle} aria-expanded={open}>
      <span className="auto-run-glyph" aria-hidden="true">{outcome.glyph}</span>
      <span className="auto-run-outcome">{outcome.word}</span>
      <span className="auto-run-trigger">{run.trigger}</span>
      {/* `formatAge`, NOT `formatReset`. `formatReset` counts down to a FUTURE
          instant and answers the literal `now` for anything already past, so
          feeding it `startedAt` made every row in the history read `now`
          whatever its real age. `nextRunAt` above is a future instant and
          still uses `formatReset` correctly; an AGE is the other question, and
          `formatAge` takes elapsed seconds, so the subtraction is here. */}
      <span className="auto-run-when">{formatAge(nowSec - Math.floor(run.startedAt / 1000))}</span>
      {/* The adopted chip (spec §11's run detail): "ran — the spawn was cut
          short; check the pane" — an asterisked tick, never the plain one,
          so an operator scanning for green never mistakes this run for a
          clean success (the mutation table's own case v). */}
      {run.adopted && (
        <span
          className="auto-run-adopted"
          data-adopted="true"
          title="ran — the spawn was cut short; check the pane"
        >
          adopted*
        </span>
      )}
      {refusal !== null && <span className="auto-run-refusal">{refusal}</span>}
      </button>
      {open && (
        state === 'loading' ? (
          <p className="auto-step-loading">Loading…</p>
        ) : state === 'error' ? (
          <p className="auto-step-loading" data-state="error">Could not reach the server.</p>
        ) : steps !== null && steps.length === 0 ? (
          <p className="auto-step-empty">No steps recorded for this run.</p>
        ) : (
          <ol className="auto-step-list">
            {(steps ?? []).map((st) => <AutomationStepRow key={st.id} step={st} nowSec={nowSec} />)}
          </ol>
        )
      )}
    </li>
  );
}

function AutomationDetail({
  automation,
  runs,
  runsEvicted,
  nowSec,
  getRun,
  onArm,
  onRun,
  onPause,
  onRetire,
  busy,
  actionError,
  actionNote,
}: {
  automation: AutomationSummary;
  runs: AutomationRunSummary[];
  runsEvicted: number;
  nowSec: number;
  getRun: typeof api.automationRun;
  onArm: () => void;
  onRun: () => void;
  onPause: () => void;
  onRetire: () => void;
  busy: 'arm' | 'run' | 'pause' | 'retire' | null;
  actionError: string | null;
  actionNote: string | null;
}): ReactNode {
  const needsProof = automation.state === 'paused' && automation.provedAt === null;
  return (
    <div className="auto-detail">
      {needsProof && (
        <p className="auto-detail-note">
          Paused — needs one manual run before it can arm.
        </p>
      )}
      <div className="auto-detail-actions">
        {automation.state !== 'armed' && automation.state !== 'retired' && (
          <button type="button" className="auto-detail-arm" disabled={busy !== null} onClick={onArm}>
            {busy === 'arm' ? 'Arming…' : 'Arm'}
          </button>
        )}
        {automation.state !== 'retired' && (
          <button type="button" className="auto-detail-run" disabled={busy !== null} onClick={onRun}>
            {busy === 'run' ? 'Starting…' : 'Run now'}
          </button>
        )}
        {automation.state === 'armed' && (
          <button type="button" className="auto-detail-pause" disabled={busy !== null} onClick={onPause}>
            {busy === 'pause' ? 'Pausing…' : 'Pause'}
          </button>
        )}
        {automation.state !== 'retired' && (
          <button type="button" className="auto-detail-retire" disabled={busy !== null} onClick={onRetire}>
            {busy === 'retire' ? 'Retiring…' : 'Retire'}
          </button>
        )}
      </div>
      {actionError !== null && <p className="auto-detail-error" role="alert">{actionError}</p>}
      {actionNote !== null && <p className="auto-detail-note" role="status">{actionNote}</p>}
      <p className="auto-detail-prompt">{automation.prompt}</p>
      {runs.length === 0 ? (
        <p className="auto-run-empty">No runs yet.</p>
      ) : (
        <ul className="auto-run-list">
          {runs.map((r) => <AutomationRunRow key={r.id} run={r} nowSec={nowSec} getRun={getRun} />)}
        </ul>
      )}
      {/* §9: eviction is not a silence — the gap row states the NUMBER the
          ring was built from, never an inferred count (mutation table case
          iii's neighbour: this row disappearing on a mutant that drops the
          count is its own red case). */}
      {runsEvicted > 0 && (
        <p className="auto-run-gap" data-gap="true">
          {runsEvicted} earlier run{runsEvicted === 1 ? '' : 's'} no longer kept.
        </p>
      )}
    </div>
  );
}

function AutomationRow({
  automation,
  nowSec,
  expanded,
  onToggle,
  detail,
  detailState,
  getRun,
  ...actions
}: {
  automation: AutomationSummary;
  nowSec: number;
  expanded: boolean;
  onToggle: () => void;
  detail: { automation: AutomationSummary; runs: AutomationRunSummary[] } | null;
  detailState: 'loading' | 'ok' | 'error';
  getRun: typeof api.automationRun;
  onArm: () => void;
  onRun: () => void;
  onPause: () => void;
  onRetire: () => void;
  busy: 'arm' | 'run' | 'pause' | 'retire' | null;
  actionError: string | null;
  actionNote: string | null;
}): ReactNode {
  const state = automationStateChip(automation.state);
  const cadence = cadenceFromColumns(automation);
  const cadenceText = cadence.kind === 'unknown' ? `? ${cadence.token}` : describeCadence(cadence);
  const nextText =
    automation.nextRunAt !== null ? formatReset(Math.floor(automation.nextRunAt / 1000), nowSec)
      : automation.scheduleError !== null ? scheduleErrorSentence(automation.scheduleError)
      : '—';
  const outcome = automation.lastOutcome === null ? null : automationOutcomeChip(automation.lastOutcome);
  const lastRefusalText = automation.lastRefusal === null ? null : refusalSentence(automation.lastRefusal);

  return (
    <li className="auto-row" data-state={state.token}>
      <button type="button" className="auto-open" onClick={onToggle} aria-expanded={expanded}>
        <span className="auto-glyph" aria-hidden="true">{state.glyph}</span>
        <span className="auto-state">{state.word}</span>
        <span className="auto-name">{automation.name}</span>
        <span className="auto-cadence">{cadenceText}</span>
        <span className="auto-next">{nextText}</span>
        {outcome !== null && (
          <span className="auto-last" data-outcome={outcome.token}>
            <span className="auto-last-glyph" aria-hidden="true">{outcome.glyph}</span>
            {outcome.word}
            {lastRefusalText !== null && <span className="auto-last-refusal">{lastRefusalText}</span>}
          </span>
        )}
        {automation.lastFireAt === null && <span className="auto-never">never ran</span>}
      </button>
      {expanded && (
        detailState === 'loading' ? (
          <p className="auto-detail-loading">Loading…</p>
        ) : detailState === 'error' ? (
          <p className="auto-detail-loading" data-state="error">Could not reach the server.</p>
        ) : detail !== null ? (
          <AutomationDetail
            automation={detail.automation}
            runs={detail.runs}
            runsEvicted={detail.automation.runsEvicted}
            nowSec={nowSec}
            getRun={getRun}
            {...actions}
          />
        ) : null
      )}
    </li>
  );
}

export interface AutomationsScreenProps {
  store?: FleetStore;
  loadAutomations?: (
    filter?: { state?: AutomationState },
  ) => Promise<{ automations: AutomationSummary[]; paused?: boolean }>;
  getAutomation?: typeof api.automation;
  getRun?: typeof api.automationRun;
  pauseAutomations?: typeof api.automationsPause;
  armAutomation?: typeof api.armAutomation;
  runAutomation?: typeof api.runAutomation;
  setAutomationState?: typeof api.setAutomationState;
}

export function AutomationsScreen({
  store = useFleetStore,
  loadAutomations = loadAutomationsDefault,
  getAutomation = api.automation,
  getRun = api.automationRun,
  pauseAutomations = api.automationsPause,
  armAutomation = api.armAutomation,
  runAutomation = api.runAutomation,
  setAutomationState = api.setAutomationState,
}: AutomationsScreenProps): ReactNode {
  const live = store((s) => s.automations);
  const automationsFrameSeen = store((s) => s.automationsFrameSeen);
  const conn = store((s) => s.conn);
  const [cold, setCold] = useState<AutomationSummary[] | null>(null);
  const [coldState, setColdState] = useState<'loading' | 'ok' | 'error'>('loading');
  // THE GLOBAL KILL SWITCH, and which way it points. `POST /api/automations/
  // pause` shipped with no reader at all — not on the frame, not on any GET —
  // so the only door a phone could offer was a button that could not say
  // whether every automation on the box was currently held. It rides the list
  // read now (one reader, additive); `undefined` from an older server leaves
  // the control out rather than guessing a direction.
  const [globalPause, setGlobalPause] = useState<boolean | null>(null);
  const [pauseBusy, setPauseBusy] = useState(false);

  // RETIRED IS A SERVER-SIDE READ, NOT A CLIENT-SIDE FILTER. The store's
  // default filter appends `state != 'retired'` — deliberately, spec §9 ("a
  // retired automation leaves the default list") — and BOTH feeds of the
  // live list take that default: the `{type:'automations'}` frame and the
  // param-less cold read. A chip that only filtered `list` could therefore
  // never match a row, so it rendered "No automations match these filters."
  // over a database that held them, and because this list's row is the only
  // door to `api.automation(id)` (there is no `/automations/:id` route), a
  // retired automation's run history had no way in from a phone at all —
  // against §9's other half, that "what did that thing do before I removed
  // it?" stays answerable. Its own list and its own read state, because a
  // failed chip-scoped read may not borrow the live list's emptiness: an
  // empty-state sentence is a positive claim (this file's first rule).
  const [retired, setRetired] = useState<AutomationSummary[] | null>(null);
  const [retiredState, setRetiredState] = useState<'loading' | 'ok' | 'error'>('loading');

  const [stateFilter, setStateFilter] = useState<'all' | AutomationState>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | AutomationLastFilter>('all');
  const [projectFilter, setProjectFilter] = useState('all');

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ automation: AutomationSummary; runs: AutomationRunSummary[] } | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [busy, setBusy] = useState<'arm' | 'run' | 'pause' | 'retire' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // *Run now* answers the moment the run is CLAIMED; the spawn happens on the
  // box's next pass. Without a word for that, the button's `Starting…` flashes
  // for a millisecond and the operator is left with a run row reading
  // `running` — which after the claim-only cut-over means "claimed", not "a
  // session exists". `ResumeSheet`'s re-kickoff note is the shipped precedent
  // for saying what was QUEUED without claiming what has not happened.
  const [actionNote, setActionNote] = useState<string | null>(null);

  const [sheetOpen, setSheetOpen] = useState(false);

  // Held in a ref, not the effect's own dependency array — `RunsScreen`'s
  // and `MailScreen`'s own fix: "once per mount" has to hold regardless of
  // the CALLER's identity discipline, not only the hoisted default's.
  const loadRef = useRef(loadAutomations);
  loadRef.current = loadAutomations;

  const aliveRef = useRef(true);
  useEffect(() => {
    aliveRef.current = true;
    return () => { aliveRef.current = false; };
  }, []);

  const loadCold = (): Promise<void> =>
    loadRef.current()
      .then((r) => {
        if (!aliveRef.current) return;
        setCold(r.automations);
        setColdState('ok');
        if (r.paused !== undefined) setGlobalPause(r.paused);
      })
      .catch(() => { if (aliveRef.current) setColdState('error'); });

  useEffect(() => {
    void loadCold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  // Keyed on the CHIP, not on the loader's identity — `loadRef` is what keeps
  // "once per selection" true regardless of the caller's identity discipline,
  // the same fix the cold read above carries.
  useEffect(() => {
    if (stateFilter !== 'retired') return;
    setRetiredState('loading');
    loadRef.current({ state: 'retired' })
      .then((r) => { if (aliveRef.current) { setRetired(r.automations); setRetiredState('ok'); } })
      .catch(() => { if (aliveRef.current) setRetiredState('error'); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stateFilter]);

  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  const showsRetired = stateFilter === 'retired';
  const source = showsRetired ? retired : automationsFrameSeen ? live : cold;
  const noSignalYet = showsRetired
    ? retiredState === 'loading'
    : !automationsFrameSeen && coldState === 'loading';
  const readFailed = showsRetired
    ? retiredState === 'error'
    : !automationsFrameSeen && coldState === 'error';
  const list = source ?? [];

  const projects = Array.from(new Set(list.map((a) => a.project))).sort();
  // `data-state="empty"` below reads `list.length === 0`, which is the right
  // question for BOTH sources: an answered-empty retired read is a genuine
  // "nothing retired yet", not a filtered-out list.

  const filtered = list.filter((a) => {
    if (stateFilter !== 'all' && a.state !== stateFilter) return false;
    if (projectFilter !== 'all' && a.project !== projectFilter) return false;
    if (outcomeFilter === 'never-ran') return a.lastFireAt === null;
    if (outcomeFilter !== 'all' && a.lastOutcome !== outcomeFilter) return false;
    return true;
  });

  // THE PANEL AND ITS OWN HEADER MUST NOT DISAGREE. The list row is fed by the
  // `{type:'automations'}` frame and updates itself; the expanded panel's runs
  // come from a one-shot cold read fired at open and after an action. Once
  // *Run now* answers BEFORE the act, that read lands while the run is still
  // `running`, so the panel would say `running` for ever while the header of
  // the same <li> flipped to `ok` or `refused <sentence>` — one row making two
  // contradictory claims.
  //
  // The FRAME is the signal, not a timer: `emitAutomations` broadcasts on any
  // change to the row, and a settle changes `lastOutcome`/`lastRefusal`, so
  // this re-reads exactly when there is something new to read — and only while
  // the panel is actually showing a run that has not ended.
  const liveRow = expandedId === null ? null : list.find((a) => a.id === expandedId) ?? null;
  const liveStamp = liveRow === null
    ? null
    : `${String(liveRow.lastFireAt)}:${String(liveRow.lastOutcome)}:${String(liveRow.lastRefusal)}`;
  const showsUnsettledRun = detail !== null && detail.runs.some((r) => r.endedAt === null);
  // `showsUnsettledRun` is in the list because the GUARD reads it, and a
  // dependency list that omits what the guard reads samples that guard only
  // when the other dependency moves. The missed ordering is real and is the
  // exact contradiction this effect exists to prevent: the frame changes
  // BEFORE the cold read lands (so `showsUnsettledRun` is still false), the
  // run settles server-side in that gap, and the frame never changes again —
  // so the panel keeps saying `running` under a header that says `ok`, for
  // ever. Adding it cannot loop: `refreshDetail` writes `detail`, and if the
  // re-read is still unsettled the flag stays true, which is not a change.
  useEffect(() => {
    if (expandedId === null || !showsUnsettledRun) return;
    refreshDetail(expandedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveStamp, showsUnsettledRun, expandedId]);

  // WHICH ROW A LANDING BELONGS TO. `detail`, `detailState`, `busy`,
  // `actionError` and `actionNote` are single screen-level states handed to
  // whichever row is expanded, and every write to them used to be
  // unconditional — so a `getAutomation` resolving for the row the operator
  // just collapsed (or for the row they collapsed and replaced with another)
  // wrote ITS answer into the panel now on screen. The tap that starts a
  // second fetch is one finger-width away from the first, so the window is
  // ordinary use, not a stress case. `aliveRef` a few lines up already makes
  // this argument for the cold load; this is the same argument for the panel.
  const shownRef = useRef<number | null>(null);
  const owns = (id: number): boolean => shownRef.current === id;

  const openDetail = (id: number): void => {
    if (expandedId === id) { setExpandedId(null); shownRef.current = null; return; }
    setExpandedId(id);
    shownRef.current = id;
    setDetail(null);
    setDetailState('loading');
    setActionError(null);
    setActionNote(null);
    // `busy` too: it was the one action state `openDetail` did not clear, so a
    // row opened while another was mid-action inherited its disabled buttons.
    setBusy(null);
    getAutomation(id)
      .then((r) => { if (owns(id)) { setDetail(r); setDetailState('ok'); } })
      .catch(() => { if (owns(id)) setDetailState('error'); });
  };

  const refreshDetail = (id: number): void => {
    getAutomation(id)
      .then((r) => { if (owns(id)) { setDetail(r); setDetailState('ok'); } })
      .catch(() => { /* a refresh that fails leaves the last good answer up */ });
  };

  const runAction = (
    kind: 'arm' | 'run' | 'pause' | 'retire',
    id: number,
    fn: () => Promise<unknown>,
  ): void => {
    setBusy(kind);
    setActionError(null);
    setActionNote(null);
    fn()
      .then(() => {
        if (!owns(id)) return;
        setBusy(null);
        // NEVER a duration. The lag is the automations lane's own sweep gate
        // plus a tick; both are server-side (`AUTOMATION_SWEEP_MS`) and
        // neither is on the wire, so a number here would be exactly the drift
        // `single-definition.test.ts` polices — stated to the operator as if
        // it were a fact about their box.
        if (kind === 'run') setActionNote('Run queued — the session starts on the box’s next pass.');
        refreshDetail(id);
        void loadCold();
      })
      .catch((err: unknown) => {
        if (!owns(id)) return;
        setBusy(null);
        setActionError(err instanceof ApiError ? automationErrorSentence(err.body) : String(err));
      });
  };

  return (
    <div className="automations-screen" data-conn={conn}>
      <header className="auto-head">
        <button type="button" className="auto-back" aria-label="Back to fleet" onClick={() => navigate('/')}>
          ‹
        </button>
        <h1 className="auto-title">Automations</h1>
        {globalPause !== null && (
          <button
            type="button"
            className="auto-global-pause"
            aria-label={globalPause ? 'automations paused' : 'pause all automations'}
            aria-pressed={globalPause}
            data-paused={globalPause}
            disabled={pauseBusy}
            onClick={() => {
              const next = !globalPause;
              setPauseBusy(true);
              pauseAutomations(next)
                .then((r) => { if (aliveRef.current) setGlobalPause(r.paused); })
                .catch(() => { /* the switch keeps saying what the server last said */ })
                .finally(() => { if (aliveRef.current) setPauseBusy(false); });
            }}
          >
            {globalPause ? 'All paused' : 'Pause all'}
          </button>
        )}
      </header>

      {/* `aria-pressed` is what carries SELECTION, not `data-selected`: a data
          attribute is not in the accessibility tree at all, so the entire
          signal was `.auto-filter[data-selected='true']`'s colour and border —
          state by colour alone, which this project's own design rules refuse.
          The visible text stays the bare token because these are chips on a
          phone; the DIMENSION goes in the label, which also ends two buttons
          answering to the same accessible name: `stateFilters` and
          `outcomeFilters` both contain `all`, so "the all button" named two
          different controls. */}
      <div className="auto-filters" role="group" aria-label="filters">
        {stateFilters.map((f) => (
          <button
            key={f}
            type="button"
            className="auto-filter"
            aria-label={`state: ${f}`}
            aria-pressed={stateFilter === f}
            data-selected={stateFilter === f}
            onClick={() => setStateFilter(f)}
          >
            {f}
          </button>
        ))}
        {outcomeFilters.map((f) => (
          <button
            key={f}
            type="button"
            className="auto-filter"
            aria-label={`last outcome: ${f}`}
            aria-pressed={outcomeFilter === f}
            data-selected={outcomeFilter === f}
            onClick={() => setOutcomeFilter(f)}
          >
            {f}
          </button>
        ))}
        {projects.length > 0 && (
          <select
            className="auto-filter-project"
            // Named, like the chips beside it: the group's own `aria-label`
            // names the GROUP, not the control, so an unlabelled select in it
            // is announced by its value alone ("all projects") with no word
            // for what it selects.
            aria-label="project"
            value={projectFilter}
            onChange={(e) => setProjectFilter(e.target.value)}
          >
            <option value="all">all projects</option>
            {projects.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        )}
      </div>

      {noSignalYet ? (
        <p className="auto-empty" data-state="loading">Loading…</p>
      ) : readFailed ? (
        <p className="auto-empty" data-state="error">
          Could not reach the server — automations may exist that are not shown.
        </p>
      ) : list.length === 0 ? (
        <p className="auto-empty" data-state="empty">No automations yet.</p>
      ) : filtered.length === 0 ? (
        <p className="auto-empty" data-state="filtered">No automations match these filters.</p>
      ) : (
        <ul className="auto-list">
          {filtered.map((a) => (
            <AutomationRow
              key={a.id}
              automation={a}
              nowSec={nowSec}
              expanded={expandedId === a.id}
              onToggle={() => openDetail(a.id)}
              detail={expandedId === a.id ? detail : null}
              detailState={detailState}
              getRun={getRun}
              onArm={() => runAction('arm', a.id, () => armAutomation(a.id))}
              onRun={() => runAction('run', a.id, () => runAutomation(a.id))}
              onPause={() => runAction('pause', a.id, () => setAutomationState(a.id, 'paused'))}
              onRetire={() => runAction('retire', a.id, () => setAutomationState(a.id, 'retired'))}
              busy={expandedId === a.id ? busy : null}
              actionError={expandedId === a.id ? actionError : null}
              actionNote={expandedId === a.id ? actionNote : null}
            />
          ))}
        </ul>
      )}

      <button type="button" className="auto-door" onClick={() => setSheetOpen(true)}>
        New automation
      </button>

      <AutomationSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onSaved={() => { void loadCold(); }}
      />
    </div>
  );
}
