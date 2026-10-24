// New-session sheet — two steps in one sheet. Step 1: pick the account
// (shared AccountRow chips with limit gauges from GET /api/accounts).
// Step 2: pick the project — searchable list from api.projects, with
// registry projects first, most recently active on top. The confirm row
// narrates the action in plain language ("Start project-c on
// team·alt") and posts api.createSession. Success opens the new session: the sheet
// closes and goes to it as soon as /ws/fleet lists its row (a create answers no id), with the old "Starting…" toast
// as the fallback if no row comes within a minute. A project whose main checkout is ALREADY live (usually
// the session is already running: `ccd start` answers "already running", exit 0, and no new row comes) toasts and closes
// at once, with no wait and no navigation; where that check over-matches, this is the toast-and-close it always was.
// Failure toasts ccd's stderr and leaves every choice in place.
// Step 2 shows the fleet store's last project list the moment it opens, and the fetch on open replaces it.
//
// THE NAME FIELD (named workspaces S8, design 2026-10-20 §2.1) sits under the project list. Empty, nothing about
// this sheet changed: the same `createSession`, the same body, the main checkout. Filled, the sheet starts a
// WORKSPACE instead, `api.workspaceAdd(project, {name, wrapper, route})` with the account picked at step 1 (the
// server's `--wrapper`, never a quiet placement elsewhere). That create's refusals stay in the sheet with the text
// intact; an account refusal returns to the account step, with the project and the name kept. A crossing project or
// an account a workspace never starts on closes the door: the field is disabled with its sentence and no name is
// ever sent (`nameDoorReason`). A workspace create answers its session's id, so that success closes the sheet and
// opens the session at once, with no toast; an answer this build cannot read names no id, so it keeps the toast and the
// close (and only a sheet still the same one closes: a dismissed sheet says it started and leaves the parent alone).
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { FleetSession, ProjectRow } from '../../../shared/api';
import { CLASSES, type ModelClass } from '../../../shared/models';
import { Button, Select, Sheet, toast } from '@ccrc/ui';
import { accountIsHomeAble, accountLabel, accountPool, accountPoolState } from '../lib/accounts';
import { api, apiErrorText, failedTo } from '../lib/api';
import { navigate } from '../lib/router';
import { effortOptions, modelOptions } from '../lib/models';
import { poolSide } from '../lib/pools';
import { declaredAccountPool } from '../../../shared/poolrule';
import { useFleetStore, type FleetStore } from '../stores/fleet';
import { AccountRow } from './AccountRow';
import { PoolTag } from './PoolTag';
import { ProjectRowShell } from './ProjectRowShell';
import { OtherPoolsDisclosure } from './chips';
import {
  disabledWrappers,
  factsFor,
  pickableWrappers,
  pickerEmptiness,
} from './accountPicker';
import { useAccountUsage } from './useProjectedHome';
import { ProjectPicker } from './ProjectPicker';
import { liveIdsIn, liveMainCheckoutIn, startedSessionFor } from './startProgramPolicy';
import { NAME_FIELD_CLASS, WorkspaceNameField } from './WorkspaceNameField';
import { useNamePreview } from './useNamePreview';
import { addRefusalText, classifyAddError } from './workspaceAddWords';
import { LINEAR_SETTINGS_PATH, confirmLabel, nameDoorReason } from './workspaceNameWords';
import './fleet.css';

/** How long an unnamed create waits for its session's row on the fleet feed before it gives up, toasts and closes. */
export const NEW_SESSION_WAIT_MS = 60_000;

/** The new-session door's own sentences for the name field (named workspaces S8, design §2.1). */
export const NEW_SESSION_NAME_TEXT = {
  emptyHint: 'Leave empty to run on the main checkout, as today. Fill it to get a new workspace on its own branch.',
  named: 'Creates a new workspace on its own branch instead of using the main checkout.',
} as const;

function ProjectRowButton({ row, selected, pool, onPick }: {
  row: ProjectRow;
  selected: boolean;
  pool: string | null;
  onPick: (project: ProjectRow) => void;
}): ReactNode {
  return (
    <ProjectRowShell selected={selected} name={row.name} onPick={() => onPick(row)}>
      <PoolTag pool={pool} />
      <span className="proj-dir">{row.workdir}</span>
    </ProjectRowShell>
  );
}

/** A `CLASSES` entry's display name for the sheet's `Class` select — the
 *  label `modelOptions` already has for this wrapper/class pair (so gpt's
 *  own aliases read the same here as they do in the session screen's own
 *  picker) when the lane offers one, else the class word with its first
 *  letter capitalised — with the class word ITSELF always appended (`—
 *  <cls>`), because a gpt-lane label like "GPT-6 Astra" carries no class word
 *  at all, though the option it labels posts `class=fable` (S4-R13). Never a
 *  hand-typed list of the four names — this is the only path this file may
 *  take to spell one, and it derives every spelling from `CLASSES` at render
 *  time. */
function classDisplayLabel(wrapper: string, cls: ModelClass): string {
  const opt = modelOptions(wrapper, null).find((o) => o.route.field === 'class' && o.route.value === cls);
  const base = opt?.label ?? cls.charAt(0).toUpperCase() + cls.slice(1);
  return `${base} — ${cls}`;
}

export interface NewSessionSheetProps {
  open: boolean;
  onClose: () => void;
  /** Injectable for tests; defaults to the app-wide fleet store. */
  fleet?: FleetStore;
}

/** One field of the optional routing row: a label over a select.
 *
 *  THREE CALL SITES, all in this sheet. The markup census pairs only two of
 *  them — the third renders a different NUMBER of literal `<option>`s and an
 *  exact structural match cannot see past that, which is the limit documented
 *  in the census itself rather than tuned away. Reading found the third.
 *
 *  The options stay `children`: every one of them is derived at render time
 *  from `CLASSES` or `effortOptions`, and a `options={[...]}` prop would make
 *  this component decide how a route value is spelled. It should not. */
function RouteField(
  { label, value, onChange, children }: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: ReactNode;
  },
): ReactNode {
  return (
    <label className="route-field">
      <span className="route-field-label">{label}</span>
      <Select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </Select>
    </label>
  );
}

export function NewSessionSheet({
  open,
  onClose,
  fleet = useFleetStore,
}: NewSessionSheetProps): ReactNode {
  const sessions = fleet((s) => s.sessions);
  const roster = fleet((s) => s.roster);
  // The last `/api/projects` read, which `useProjectRows` owns and writes. Read here, never written: it fills step 2
  // until this sheet's own fetch answers.
  const cachedProjects = fleet((s) => s.projects);
  // The SAME poll the picker's eligibility already came from, now also the
  // source of its gauges — this sheet was fetching every account row and using
  // one boolean off it while reading its numbers off the live fleet frame,
  // which carries no provenance and no row for an account with no live session.
  // One source per fact; see `useAccountUsage`.
  const accounts = useAccountUsage(open);

  const [wrapper, setWrapper] = useState<string | null>(null); // null = step 1
  const [project, setProject] = useState<ProjectRow | null>(null);
  // Classification at the deliberate pick, not at the current render. A later
  // eligible -> crossing transition must withdraw the selection; a project
  // picked from the disclosed crossing side remains a deliberate crossing.
  const selectedCrossingRef = useRef<boolean | null>(null);
  const [query, setQuery] = useState('');
  const [showOther, setShowOther] = useState(false);
  const [list, setList] = useState<ProjectRow[] | null>(null); // null = loading
  const [listError, setListError] = useState<string | null>(null);
  // The routing row's three fields (routing spec, slice 4, Task 6). Each is
  // '' (unset) until the operator picks one; unset means the request carries
  // no `route` key at all, so an operator who never touches this row starts
  // a session exactly the way this sheet always has.
  const [routeClass, setRouteClass] = useState('');
  const [routeEffort, setRouteEffort] = useState('');
  const [routeWorkflow, setRouteWorkflow] = useState('');
  // The name field (named workspaces S8): what the operator typed, and the one sentence a refusal left behind.
  // `notice` is shown at the step it belongs to: an account refusal on the account step, every other on the field.
  const [name, setName] = useState('');
  // A create answers after its sheet was closed: its words are for a sheet that is gone. Bumped on every close.
  const generation = useRef(0);
  // Ends the wait for a created session's row (settles it as "no row"); null when nothing is waiting.
  const stopWait = useRef<(() => void) | null>(null);
  const [notice, setNotice] = useState<{ step: 'account' | 'name'; text: string } | null>(null);
  const [starting, setStarting] = useState(false);
  /** `starting` has been true for long enough that "Starting…" is no longer an
   *  honest description of the wait. The server's `start`/`enable` budget is
   *  300 s (the unsupervised fallback settles for up to `SPAWN_SETTLE_S` — a COLD
   *  Claude Code boot against a freshly seeded workspace HOME), so the old
   *  ninety-second failure is gone and the sheet can legitimately sit for
   *  minutes. There is still no cancel — this is the minimum: say what is
   *  happening rather than imply it is nearly done. */
  const [slow, setSlow] = useState(false);

  // Fetch the project list the moment the sheet opens so step 2 is instant.
  useEffect(() => {
    if (!open) return undefined;
    let cancelled = false;
    setList(null);
    setListError(null);
    api.projects().then(
      (r) => {
        if (!cancelled) setList(r.projects);
      },
      (err: unknown) => {
        if (!cancelled) setListError(apiErrorText(err));
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open]);

  // An unmount is a dismissal too: the wait's clock and its fleet subscription go with it, and nothing navigates.
  useEffect(() => () => {
    generation.current += 1;
    stopWait.current?.();
  }, []);

  // The slow-label clock. Keyed on `starting` alone, so it is armed by the same
  // transition that disables the button and disarmed by every exit from it —
  // including the close-reset below, which sets `starting` back to false.
  useEffect(() => {
    if (!starting) { setSlow(false); return undefined; }
    const t = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(t);
  }, [starting]);

  // A closed sheet forgets its choices — reopening starts fresh at step 1.
  useEffect(() => {
    if (open) return;
    generation.current += 1;
    stopWait.current?.();
    setWrapper(null);
    setProject(null);
    selectedCrossingRef.current = null;
    setQuery('');
    setShowOther(false);
    setRouteClass('');
    setRouteEffort('');
    setRouteWorkflow('');
    setName('');
    setNotice(null);
    setStarting(false);
    setSlow(false);
  }, [open]);

  // Registry projects first, most recently active on top; the rest keep the
  // server's order. Recency comes from the fleet snapshot (workdir-keyed).
  const lastActive = new Map<string, number>();
  for (const s of sessions) {
    const at = s.statusUpdatedAt ?? 0;
    const prev = lastActive.get(s.workdir);
    if (prev === undefined || at > prev) lastActive.set(s.workdir, at);
  }
  // This sheet's own list once it has one, else the store's cached one; the skeleton only when neither exists, and a
  // failed fetch speaks only when there is nothing cached to show.
  const shown: readonly ProjectRow[] | null = list ?? cachedProjects;
  const shownError = shown === null ? listError : null;
  const ordered =
    shown === null
      ? []
      : [...shown].sort((a, b) => {
          const ra = lastActive.get(a.workdir);
          const rb = lastActive.get(b.workdir);
          if (ra === undefined && rb === undefined) return 0; // keep server order
          return (rb ?? -1) - (ra ?? -1);
        });
  const needle = query.trim().toLowerCase();
  const matching =
    needle === '' ? ordered : ordered.filter((p) => p.name.toLowerCase().includes(needle));
  // At step 2 the account is fixed, so split the projects that account may take.
  // An absent or undecidable project pool is offered plainly; only a measured
  // mismatch requires disclosure and an explicit crossing override.
  //
  // Item 6 (I4, wave-1 fix round A): `poolSide` now takes the account's full
  // `AccountPoolWire`, not a name — `accountPoolState` (not `accountPool`)
  // is what keeps an `unreadable`/`malformed`/`stale` account from arriving
  // here already narrowed to `null` and reading as `untagged` -> eligible.
  // No wrapper picked yet is `declaredAccountPool(null)`, the same untagged
  // probe `splitByPool` uses — "nobody chosen" and "chosen but untagged"
  // both mean "nothing to constrain by" for this split.
  const wrapperPool = wrapper === null ? declaredAccountPool(null) : accountPoolState(roster, wrapper);
  const poolClass = (candidate: ProjectRow) => poolSide(wrapperPool, candidate.pool ?? null);
  const isCrossing = (candidate: ProjectRow): boolean => poolClass(candidate) === 'crossing';
  const inPool = matching.filter((candidate) => poolClass(candidate) !== 'crossing');
  const otherPool = matching.filter((candidate) => poolClass(candidate) === 'crossing');
  const hasUnknownPool = inPool.some(
    (candidate) => candidate.pool !== undefined && poolClass(candidate) === 'unknown',
  );

  useEffect(() => {
    if (project !== null && selectedCrossingRef.current === false && isCrossing(project)) {
      setProject(null);
      selectedCrossingRef.current = null;
    }
  }, [project, wrapperPool]);

  // The picked project follows the CURRENT row. A pick from the store's cached list holds that list's row, and the fetch
  // that answers later replaces the list, not the pick: the crossing re-check above, the name door and `crossPool` all
  // read the row, so it is re-resolved by workdir (the list's own identity) whenever the shown list changes. Found: the
  // current row replaces it, and the crossing effect re-checks it from current data. Gone: the selection is withdrawn,
  // as that effect withdraws an eligible-to-crossing change.
  useEffect(() => {
    if (project === null || shown === null) return;
    const current = shown.find((candidate) => candidate.workdir === project.workdir);
    if (current === undefined) {
      setProject(null);
      selectedCrossingRef.current = null;
    } else if (current !== project) {
      setProject(current);
    }
  }, [shown]);

  const pickProject = (candidate: ProjectRow): void => {
    selectedCrossingRef.current = isCrossing(candidate);
    setProject(candidate);
    setNotice(null);
  };

  // THE NAME DOOR (S8). A crossing project or an account a workspace never starts on closes it: the field is
  // disabled with its sentence, the preview asks nothing, and the start below is today's, whatever was typed.
  const nameReason = project === null || wrapper === null
    ? null
    : nameDoorReason({ crossing: isCrossing(project), homeAble: accountIsHomeAble(roster, wrapper) });
  const preview = useNamePreview(name, { enabled: nameReason === null });

  // THE SAME RULE THE SWAP PICKER ASKS, AND THAT IS A DECISION, NOT A SHARED
  // HELPER'S SIDE EFFECT (D-1978). The two surfaces were re-examined separately, because
  // a swap is the RESCUE of a wedged session while this starts a brand-new one,
  // and "a rescue must always have a destination" does not obviously reach a
  // first placement. It reaches it by a different route: the fleet-side twin of
  // THIS sheet is `ws-add`, whose `_ws_least_loaded` was given a condemned-lane
  // fallback tier for exactly this case — "letting it empty this function would
  // let one bad probe run wedge every `ws-add` on the box" — and the server's
  // `projectHome` mirrors it ("filtering condemned lanes out of the fallback
  // altogether answers `null` on an all-condemned fleet"). Both of those are
  // AUTOMATIC placement, which is the stricter setting; a human choosing on
  // purpose is the looser one. So there is no reading on which a new session
  // should be barred from a lane `ws-add` would still place work on, and the
  // two pickers do not diverge. If they ever must, the divergence is a
  // PARAMETER to the shared rule — never a second copy of it here.
  const switchedOff = disabledWrappers(accounts);
  const candidates = pickableWrappers(roster, sessions);
  const wrappers = candidates.filter((w) => !switchedOff.includes(w));
  const emptiness = pickerEmptiness(candidates, wrappers);
  const emptyNote =
    emptiness === null
      ? null
      : emptiness === 'none-known'
        ? 'No accounts to start a session on yet.'
        : 'Every account is switched off on the fleet host — turn one back on from Accounts.';

  // Only the SET fields ride the request — an unset select contributes no
  // key, so an operator who never touches the row gets the request shape
  // this sheet has always sent (mirrors `crossPool`'s own rule just below).
  const route: Partial<Record<'class' | 'effort' | 'workflow', string>> = {};
  if (routeClass !== '') route.class = routeClass;
  if (routeEffort !== '') route.effort = routeEffort;
  if (routeWorkflow !== '') route.workflow = routeWorkflow;
  const hasRoute = Object.keys(route).length > 0;

  /** The confirm's own gate, which Enter in the name field follows exactly. */
  const canStart = wrapper !== null && project !== null && !starting && preview.kind !== 'refused';

  /** Settles with the first row `find` returns, checked now and on every change of the store, or with null at the bound
   *  or when the sheet is dismissed (`stopWait`). The caller tells those two apart by the generation. */
  const waitForRow = (find: () => FleetSession | null): Promise<FleetSession | null> => new Promise((resolve) => {
    const settle = (row: FleetSession | null): void => {
      clearTimeout(timer);
      unsubscribe();
      stopWait.current = null;
      resolve(row);
    };
    const check = (): void => {
      const row = find();
      if (row !== null) settle(row);
    };
    const timer = setTimeout(() => settle(null), NEW_SESSION_WAIT_MS);
    const unsubscribe = fleet.subscribe(check);
    stopWait.current = () => settle(null);
    check();
  });

  const start = async (): Promise<void> => {
    if (wrapper === null || project === null || starting) return;
    const mine = generation.current;
    setStarting(true);
    setNotice(null);
    try {
      // A NAME takes the workspace create, with the account the operator picked (`--wrapper`), instead of
      // `POST /api/sessions` and the main checkout. The preview is `empty` for a blank field AND for a closed door
      // (`nameReason`), so a name typed before a crossing project was picked is never sent.
      if (preview.kind === 'named') {
        const answer = await api.workspaceAdd(project.name, { name, wrapper, ...(hasRoute ? { route } : {}) });
        // THE TITLE IS THE SERVER'S: it resolves a ticket again at create, so the preview's title (or what was typed) may
        // not be what it stored. An answer this build cannot read names none, rather than a guess.
        if (answer.named) {
          // The answer carries the session's id: open it. A dismissed sheet only says it started, and goes nowhere.
          if (mine !== generation.current) {
            toast(`Starting ${answer.title} on ${accountLabel(roster, wrapper)}…`);
            return;
          }
          onClose();
          navigate(`/s/${encodeURIComponent(answer.id)}`);
          return;
        }
        toast(`Starting ${project.name} on ${accountLabel(roster, wrapper)}…`);
        // A dismissed sheet only says it started: the close is the parent's, and would shut a sheet reopened since.
        if (mine === generation.current) onClose();
        return;
      }
      // The new row can reach the fleet store before this create's HTTP answer, so what was alive is taken BEFORE it.
      // The snapshot is defence in depth: past the already-live arm below, no id in it can be a main checkout of this
      // project, so this sheet cannot reach the freshness conjunct of `startedSessionFor`. That conjunct is pinned at its
      // owner (`start-program.test.tsx`, "startedSessionFor — the wait arm, directly").
      const preLive = liveIdsIn(fleet.getState().sessions);
      // A live main checkout of this project (any lane: a swap keeps the id) is usually what `ccd start` answers "already
      // running" for, exit 0: the create succeeds and no new row comes, so there is nothing to wait for. The owner is
      // deliberately wider than ccd's own collision test (a live `<A>-demo` while the operator picked lane B still starts a
      // new `<B>-demo`), and then the sheet falls back to the toast-and-close it had before the wait. Taken BEFORE the
      // create, from the owner `StartProgramSheet` refuses with.
      const alreadyLive = liveMainCheckoutIn(fleet.getState().sessions, project.name) !== null;
      const said = `Starting ${project.name} on ${accountLabel(roster, wrapper)}…`;
      const body = {
        wrapper, project: project.name, workdir: project.workdir,
        ...(hasRoute ? { route } : {}),
      };
      await (isCrossing(project)
        ? api.createSession({ ...body, crossPool: true })
        : api.createSession(body));
      if (mine !== generation.current) {
        toast(said);
        return;
      }
      if (alreadyLive) {
        // As before the wait existed: said, and closed, with no navigation.
        toast(said);
        onClose();
        return;
      }
      // The create answers no id, so the sheet stays in its starting state until /ws/fleet lists the new main checkout.
      const row = await waitForRow(() => startedSessionFor(fleet.getState().sessions, wrapper, project.name, preLive));
      if (mine !== generation.current) {
        toast(said); // dismissed during the wait: the create succeeded, so it is said once, with no sheet and no navigation
        return;
      }
      if (row === null) toast(said);
      onClose();
      if (row !== null) navigate(`/s/${encodeURIComponent(row.id)}`);
    } catch (err) {
      if (preview.kind === 'named') {
        const refusal = classifyAddError(err);
        const dismissed = mine !== generation.current;
        const text = addRefusalText(refusal, { door: 'new-session', project: project.name, slug: preview.slug, roster, dismissed });
        if (dismissed) {
          // The sheet was dismissed while the request was in flight: there is no sheet to hold the sentence, and the next
          // opening must not inherit it, so it is said once, as an error toast, in the words that are true without a
          // sheet (its text is NOT kept, and there is no account step to return to).
          toast(text, 'error');
        } else {
          // The create's refusals stay in the sheet with the text intact (design §4.2); an account refusal sends the
          // operator back to the account step, where the remedy is, and keeps the project and the name.
          setNotice({ step: refusal.kind === 'account-refused' ? 'account' : 'name', text });
          if (refusal.kind === 'account-refused') setWrapper(null);
        }
      } else {
        toast(failedTo('start', err), 'error');
      }
    } finally {
      // A dismissed start has nothing left to release: the close already cleared `starting`, and a sheet reopened since
      // may have its own start in flight, which this one's end must not re-enable.
      if (mine === generation.current) setStarting(false);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      eyebrow="new session"
      title="Start a session"
      // THE CONFIRM IS PINNED (the sheets' own footer, D-5932), not the last thing in a scrolling body: with the name
      // field, its preview and the routing row it fell below the fold at 360 and 390 wide. Step 1 has no confirm.
      footer={wrapper === null ? undefined : (
        <div className={NAME_FIELD_CLASS.confirmRow}>
          <Button variant="primary" disabled={!canStart || project === null} onClick={() => void start()}>
            <span className={NAME_FIELD_CLASS.confirmLabel}>
              {starting
                ? (slow ? 'Still starting — a cold session can take minutes' : 'Starting…')
                : project === null
                  ? 'Choose a project'
                  : confirmLabel(preview, {
                    empty: `Start ${project.name} on ${accountLabel(roster, wrapper)}`,
                    named: (short) => `Start ${short} on ${accountLabel(roster, wrapper)}`,
                  })}
            </span>
          </Button>
        </div>
      )}
    >
      {wrapper === null ? (
        <>
          <p className="sheet-copy">Pick the account it runs on — you can move it later.</p>
          {notice?.step === 'account' && <p role="alert" className={NAME_FIELD_CLASS.refusal}>{notice.text}</p>}
          <div className="acct-list">
            {/* A lane an OPERATOR switched off is not offered — intent cannot
                be wrong. A lane the health PROBE condemned is offered, marked
                by `AccountRow`, and never suggested: see `disabledWrappers`
                for the ruling and the paragraph above for why this sheet
                answers it the same way SwapSheet does. */}
            {emptyNote === null ? (
              wrappers.map((w) => (
                <AccountRow
                  key={w}
                  wrapper={w}
                  facts={factsFor(accounts, w)}
                  onPick={setWrapper}
                  roster={roster}
                  poolChip={accountPool(roster, w)}
                />
              ))
            ) : (
              <p className="acct-none">{emptyNote}</p>
            )}
          </div>
        </>
      ) : (
        // LOCKED WHILE THE REQUEST IS IN FLIGHT: a disabled fieldset disables every control inside it (the change link, the
        // search, the project rows, the three selects), so nothing the request was built from can change under it.
        // It is DIMMED with `NAME_FIELD_CLASS.locked`, the one look every door's lock has (it is a box, not `contents`: an
        // opacity does nothing to a `display: contents` element); `min-w-0` takes off a fieldset's own min-content width.
        // The name field inside is locked by this fieldset and is not passed `locked`, which would dim it twice.
        // The confirm is the footer's, outside it.
        <fieldset
          disabled={starting}
          data-locked={starting ? 'true' : undefined}
          className={starting ? `min-w-0 ${NAME_FIELD_CLASS.locked}` : 'min-w-0'}
        >
          <button
            type="button"
            className="acct-change"
            onClick={() => {
              setWrapper(null);
              setProject(null);
              selectedCrossingRef.current = null;
              setShowOther(false);
              setRouteClass('');
              setRouteEffort('');
              setRouteWorkflow('');
              setNotice(null);
            }}
          >
            <span aria-hidden="true">‹</span> on {accountLabel(roster, wrapper)} — change
          </button>
          <ProjectPicker
            query={query}
            onQuery={setQuery}
            list={shown}
            listError={shownError}
            empty={inPool.length === 0 && otherPool.length === 0}
          >
              {inPool.map((candidate) => (
                <ProjectRowButton
                  key={candidate.workdir}
                  row={candidate}
                  selected={candidate.workdir === project?.workdir}
                  pool={null}
                  onPick={pickProject}
                />
              ))}
              {hasUnknownPool && (
                <p className="pool-note">
                  One or more project pools are not known from here, so pool matching does not hide those projects.
                </p>
              )}
              {otherPool.length > 0 && (
                <>
                  <OtherPoolsDisclosure
                    count={otherPool.length}
                    shown={showOther}
                    onToggle={() => setShowOther((shown) => !shown)}
                  />
                  {showOther && otherPool.map((candidate) => (
                    <ProjectRowButton
                      key={candidate.workdir}
                      row={candidate}
                      selected={candidate.workdir === project?.workdir}
                      pool={candidate.pool?.state === 'tagged' ? candidate.pool.name : null}
                      onPick={pickProject}
                    />
                  ))}
                </>
              )}
          </ProjectPicker>
          {/* The name field (named workspaces S8, design §2.1), after the project it belongs to. Empty is today's
              start on the main checkout; a name starts a workspace on the account picked at step 1. */}
          {project !== null && (
            // `mb-4`: a refusal under the field sat 14px above the routing row's first label (second blind review, S4-1),
            // which the pinned confirm below then crops mid-row as the body scrolls; a full `--sp-4` parts them.
            <div className="grid gap-2 mb-4">
              <WorkspaceNameField
                value={name}
                onChange={(v) => { setName(v); setNotice(null); }}
                preview={preview}
                project={project.name}
                emptyHint={NEW_SESSION_NAME_TEXT.emptyHint}
                disabledReason={nameReason}
                namedNote={NEW_SESSION_NAME_TEXT.named}
                onSubmit={() => { if (canStart) void start(); }}
                onOpenSettings={() => { onClose(); navigate(LINEAR_SETTINGS_PATH); }}
              />
              {notice?.step === 'name' && <p role="alert" className={NAME_FIELD_CLASS.refusal}>{notice.text}</p>}
            </div>
          )}
          {/* The optional routing row (routing spec, slice 4, Task 6): every
              option is derived from `CLASSES`/`effortOptions` at render time,
              never a hand-typed list, so a class or effort rung this build
              adds or drops shows up here for free. Leaving all three unset
              sends no `route` key at all — the coordinator row an ordinary
              start has always landed on. */}
          <div className="route-row">
            <RouteField label="Class" value={routeClass} onChange={setRouteClass}>
              <option value="">Coordinator row</option>
              <option value="default">Default</option>
              {[...CLASSES].reverse().map((c) => (
                <option key={c} value={c}>{classDisplayLabel(wrapper, c)}</option>
              ))}
            </RouteField>
            <RouteField label="Effort" value={routeEffort} onChange={setRouteEffort}>
              <option value="">Unset</option>
              {effortOptions(wrapper, null, false).map((o) => (
                <option key={o.route.value} value={o.route.value}>{o.label}</option>
              ))}
            </RouteField>
            <RouteField label="Workflows" value={routeWorkflow} onChange={setRouteWorkflow}>
              <option value="">Unset</option>
              <option value="on">on</option>
              <option value="off">off</option>
            </RouteField>
          </div>
          <p className="sheet-copy route-note">
            Unset fields take the coordinator row (Opus · ultracode, Sonnet subagents, workflows on).
            If the account can't serve the class today, ccd starts one rung down and restores it when it can.
          </p>
        </fieldset>
      )}
    </Sheet>
  );
}
