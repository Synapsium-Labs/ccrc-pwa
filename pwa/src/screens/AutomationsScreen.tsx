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
// screen has only one list (the `{type:'automations'}` frame is a FULL
// snapshot, unlike `runs`'s active-only frame — spec §10 "Run history is
// NOT on the frame", but every automation regardless of state rides it), so
// there is no active/finished split to reconcile.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  type AutomationLastFilter, type AutomationRunSummary, type AutomationState, type AutomationSummary,
} from '../../../shared/api';
import { cadenceFromColumns, describeCadence } from '../../../shared/schedule';
import {
  automationErrorSentence, automationOutcomeChip, automationStateChip, refusalSentence,
  scheduleErrorSentence,
} from '../auto/autoWords';
import { AutomationSheet } from '../auto/AutomationSheet';
import { formatReset } from '../fleet/formatReset';
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
const loadAutomationsDefault = (): Promise<{ automations: AutomationSummary[] }> => api.automations();

const stateFilters: readonly ('all' | AutomationState)[] = ['all', 'armed', 'paused', 'retired'];
const outcomeFilters: readonly ('all' | AutomationLastFilter)[] = ['all', 'ok', 'failed', 'never-ran'];

function AutomationRunRow({ run, nowSec }: { run: AutomationRunSummary; nowSec: number }): ReactNode {
  const outcome = automationOutcomeChip(run.outcome);
  const refusal = run.refusal === null ? null : refusalSentence(run.refusal);
  return (
    <li className="auto-run-row" data-outcome={outcome.token}>
      <span className="auto-run-glyph" aria-hidden="true">{outcome.glyph}</span>
      <span className="auto-run-outcome">{outcome.word}</span>
      <span className="auto-run-trigger">{run.trigger}</span>
      <span className="auto-run-when">{formatReset(Math.floor(run.startedAt / 1000), nowSec)}</span>
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
    </li>
  );
}

function AutomationDetail({
  automation,
  runs,
  runsEvicted,
  nowSec,
  onArm,
  onRun,
  onPause,
  onRetire,
  busy,
  actionError,
}: {
  automation: AutomationSummary;
  runs: AutomationRunSummary[];
  runsEvicted: number;
  nowSec: number;
  onArm: () => void;
  onRun: () => void;
  onPause: () => void;
  onRetire: () => void;
  busy: 'arm' | 'run' | 'pause' | 'retire' | null;
  actionError: string | null;
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
      <p className="auto-detail-prompt">{automation.prompt}</p>
      {runs.length === 0 ? (
        <p className="auto-run-empty">No runs yet.</p>
      ) : (
        <ul className="auto-run-list">
          {runs.map((r) => <AutomationRunRow key={r.id} run={r} nowSec={nowSec} />)}
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
  ...actions
}: {
  automation: AutomationSummary;
  nowSec: number;
  expanded: boolean;
  onToggle: () => void;
  detail: { automation: AutomationSummary; runs: AutomationRunSummary[] } | null;
  detailState: 'loading' | 'ok' | 'error';
  onArm: () => void;
  onRun: () => void;
  onPause: () => void;
  onRetire: () => void;
  busy: 'arm' | 'run' | 'pause' | 'retire' | null;
  actionError: string | null;
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
            {...actions}
          />
        ) : null
      )}
    </li>
  );
}

export interface AutomationsScreenProps {
  store?: FleetStore;
  loadAutomations?: () => Promise<{ automations: AutomationSummary[] }>;
  getAutomation?: typeof api.automation;
  armAutomation?: typeof api.armAutomation;
  runAutomation?: typeof api.runAutomation;
  setAutomationState?: typeof api.setAutomationState;
}

export function AutomationsScreen({
  store = useFleetStore,
  loadAutomations = loadAutomationsDefault,
  getAutomation = api.automation,
  armAutomation = api.armAutomation,
  runAutomation = api.runAutomation,
  setAutomationState = api.setAutomationState,
}: AutomationsScreenProps): ReactNode {
  const live = store((s) => s.automations);
  const automationsFrameSeen = store((s) => s.automationsFrameSeen);
  const conn = store((s) => s.conn);
  const [cold, setCold] = useState<AutomationSummary[] | null>(null);
  const [coldState, setColdState] = useState<'loading' | 'ok' | 'error'>('loading');

  const [stateFilter, setStateFilter] = useState<'all' | AutomationState>('all');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | AutomationLastFilter>('all');
  const [projectFilter, setProjectFilter] = useState('all');

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<{ automation: AutomationSummary; runs: AutomationRunSummary[] } | null>(null);
  const [detailState, setDetailState] = useState<'loading' | 'ok' | 'error'>('loading');
  const [busy, setBusy] = useState<'arm' | 'run' | 'pause' | 'retire' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

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
      .then((r) => { if (aliveRef.current) { setCold(r.automations); setColdState('ok'); } })
      .catch(() => { if (aliveRef.current) setColdState('error'); });

  useEffect(() => {
    void loadCold();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  const now = useNow(30_000);
  const nowSec = Math.floor(now / 1000);

  const source = automationsFrameSeen ? live : cold;
  const noSignalYet = !automationsFrameSeen && coldState === 'loading';
  const readFailed = !automationsFrameSeen && coldState === 'error';
  const list = source ?? [];

  const projects = Array.from(new Set(list.map((a) => a.project))).sort();

  const filtered = list.filter((a) => {
    if (stateFilter !== 'all' && a.state !== stateFilter) return false;
    if (projectFilter !== 'all' && a.project !== projectFilter) return false;
    if (outcomeFilter === 'never-ran') return a.lastFireAt === null;
    if (outcomeFilter !== 'all' && a.lastOutcome !== outcomeFilter) return false;
    return true;
  });

  const openDetail = (id: number): void => {
    if (expandedId === id) { setExpandedId(null); return; }
    setExpandedId(id);
    setDetail(null);
    setDetailState('loading');
    setActionError(null);
    getAutomation(id)
      .then((r) => { setDetail(r); setDetailState('ok'); })
      .catch(() => setDetailState('error'));
  };

  const refreshDetail = (id: number): void => {
    getAutomation(id).then((r) => { setDetail(r); setDetailState('ok'); }).catch(() => {});
  };

  const runAction = (
    kind: 'arm' | 'run' | 'pause' | 'retire',
    id: number,
    fn: () => Promise<unknown>,
  ): void => {
    setBusy(kind);
    setActionError(null);
    fn()
      .then(() => {
        setBusy(null);
        refreshDetail(id);
        void loadCold();
      })
      .catch((err: unknown) => {
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
      </header>

      <div className="auto-filters" role="group" aria-label="filters">
        {stateFilters.map((f) => (
          <button
            key={f}
            type="button"
            className="auto-filter"
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
            data-selected={outcomeFilter === f}
            onClick={() => setOutcomeFilter(f)}
          >
            {f}
          </button>
        ))}
        {projects.length > 0 && (
          <select
            className="auto-filter-project"
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
              onArm={() => runAction('arm', a.id, () => armAutomation(a.id))}
              onRun={() => runAction('run', a.id, () => runAutomation(a.id))}
              onPause={() => runAction('pause', a.id, () => setAutomationState(a.id, 'paused'))}
              onRetire={() => runAction('retire', a.id, () => setAutomationState(a.id, 'retired'))}
              busy={expandedId === a.id ? busy : null}
              actionError={expandedId === a.id ? actionError : null}
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
