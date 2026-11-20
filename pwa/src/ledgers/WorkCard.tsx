// The Work card (programme work map WM3, D-8806; spec 2026-11-16 §5 and §5.1; R129: a stage is a phase; R130: phases lead).
// It draws `WorkMapView`, which `workMapOf` decided on the server, and decides nothing: every count, status, carry and finish
// date is read off the view, and every word comes from `workMapWords.ts`. Props only: it reads no store and no route, keeps ONE
// piece of local state (the epic filter) and keeps no last view. The page (WM4) keeps the last `WorkMapView` it drew and passes
// it beside the failure's word in an `unreadable` answer, so the note draws over it (review 2268 F15). Nothing mounts the card
// yet; WM4 puts it on the programme page.
//
// The links are given: `runHref` and `itemHref` are functions of an id (the page knows the routes and what its list still
// holds), and `epicHref` is the page's `epicPath(slug, key)`. A `null` from `itemHref` draws the item's number as text.
//
// The card writes no word "Programme" (it sits where the programme's own icon and colours already say whose it is) and no
// "coordinator" word: a coordinator is shown by the badge another task adds (the operator's tidying notes of 2026-11-19).
import { useId, useState, type ReactNode } from 'react';
import { Button, TextLink, useNow } from '@ccrc/ui';
import { WORK_COUNTED_GROUPS, type WorkEpicView, type WorkGroup, type WorkItemView, type WorkMapView, type WorkPhaseView, type WorkUnreadable } from '../../../shared/plan';
import { inAppClick } from '../fleet/settingsText';
import {
  LAST_RUN_FAILED, NOTES, NOT_IN_PHASE_WORD, NOT_PROVED_WORD, OPEN_EPIC, OPEN_IN_LINEAR, PROVED_WORD, WORK_TITLE, beforePlanLine,
  carriedTargetsOf, carriedWords, checkpointFacts, checkpointsLabel, doneOnWords, doneWhenLine, epicChip, foldLabel, headline,
  initiativeNote, itemLinkWord, movedWords, outstandingLine, phaseHeading, phaseLine, runLinkWord, sourceLine, statusWord,
  unreadableNote, untitledWords, wholeEpicLine,
} from './workMapWords';

/** The card's answer: the server's `WorkAnswer` (`WorkMapView`, or `{ unreadable }`), widened so the unreadable arm may also
 *  carry the last view the page drew. The shipped `WorkAnswer` has no `last`; this prop type is the card's own (D-8806,
 *  `unreadable-carries-the-last-view`). */
export type WorkCardAnswer = WorkMapView | { unreadable: WorkUnreadable; last?: WorkMapView | null };

export interface WorkCardProps {
  work: WorkCardAnswer;
  /** When the page last read the plan, for the source line. */
  readAt: number;
  runHref: (runId: number) => string;
  /** The page of a Waiting on you item, or null when the page holds none for it. */
  itemHref: (itemId: number) => string | null;
  /** The epic's page; absent, the checkpoint row draws no epic link. */
  epicHref?: (epicKey: string) => string | null;
}

interface Ctx {
  view: WorkMapView;
  byKey: ReadonlyMap<string, WorkItemView>;
  now: number;
  /** The epic the strip filters to, or null. */
  filter: string | null;
  runHref: WorkCardProps['runHref'];
  itemHref: WorkCardProps['itemHref'];
}

/** The bar's segments: the groups the headline counts (`WORK_COUNTED_GROUPS`), then an ended plan's left-open work, which the
 *  headline counts apart but a closed plan's bar must still show, so it is never all done (D-8806, `bar-shows-left-open`). */
const BAR_GROUPS: readonly WorkGroup[] = [...WORK_COUNTED_GROUPS, 'left-open'];
/** The tickets a block carries out: none outside a phase. */
const NO_CARRY: ReadonlySet<string> = new Set();

function Link({ href, children }: { href: string; children: ReactNode }): ReactNode {
  return <TextLink href={href} onClick={inAppClick(href)}>{children}</TextLink>;
}

/** One fact of a row, in its own span so a screen reader and a test read each apart. */
const Fact = ({ children }: { children: ReactNode }): ReactNode => <span className="wk-fact">{children}</span>;

/** A row's facts: where it was carried out to, with its status now (spec Table 6a); why it reads as it does, which finishes the
 *  sentence the status word starts ("marked done, but" · "no evidence stored"); where it was carried from; its run and how long
 *  ago it moved, the items that wait on the operator, and the run that last failed. */
function RowFacts({ it, ctx, phaseKey, carriedOut }: { it: WorkItemView; ctx: Ctx; phaseKey: string | null; carriedOut: boolean }): ReactNode {
  const here = phaseKey === null ? undefined : it.phases.find((p) => p.key === phaseKey);
  return (
    <span className="wk-facts">
      {carriedOut && here?.carriedTo != null && <Fact>{carriedWords.to(here.carriedTo.number)}</Fact>}
      {carriedOut && <Fact>{carriedWords.now(it.status)}</Fact>}
      {it.reason !== null && it.reason !== '' && <Fact>{it.reason}</Fact>}
      {here?.carriedFrom.map((f) => <Fact key={f.key}>{carriedWords.from(f)}</Fact>)}
      {it.runId !== null && <Fact><Link href={ctx.runHref(it.runId)}>{runLinkWord(it.runId)}</Link></Fact>}
      {typeof it.lastMoveAt === 'number' && it.runId !== null && <Fact>{movedWords(it.lastMoveAt, ctx.now)}</Fact>}
      {it.itemIds.map((id) => {
        const href = ctx.itemHref(id);
        return <Fact key={id}>{href === null ? itemLinkWord(id) : <Link href={href}>{itemLinkWord(id)}</Link>}</Fact>;
      })}
      {it.status === 'not-started' && it.lastFailedRunId !== null && <Fact><Link href={ctx.runHref(it.lastFailedRunId)}>{LAST_RUN_FAILED}</Link></Fact>}
      {it.status === 'done' && it.doneAt !== null && <Fact>{doneOnWords(it.doneAt)}</Fact>}
    </span>
  );
}

/** One ticket (or no-plan run): its status word, its title with its epic tag, and its facts. `carriedOut` writes "carried" in the
 *  status column, which is not a `WorkStatus` (F22). */
function Row({ it, ctx, phaseKey, carriedOut }: { it: WorkItemView; ctx: Ctx; phaseKey: string | null; carriedOut: boolean }): ReactNode {
  return (
    <li className="wk-row" data-ticket={it.key} data-status={carriedOut ? 'carried' : it.status}>
      <span className="wk-status">{carriedOut ? carriedWords.status : statusWord(it.status)}</span>
      <span className="wk-what">
        <span className="wk-ticket-title">{it.title ?? untitledWords(it)}</span>
        {it.epic !== null && <span className="wk-epic">{it.epic.title}</span>}
      </span>
      <RowFacts it={it} ctx={ctx} phaseKey={phaseKey} carriedOut={carriedOut} />
    </li>
  );
}

/** A folded group of rows under one counted line ("5 done"): closed by default, empty draws nothing. */
function Fold({ rows, group, ctx, phaseKey }: { rows: readonly WorkItemView[]; group: 'done' | 'failed'; ctx: Ctx; phaseKey: string | null }): ReactNode {
  return rows.length === 0 ? null : (
    <details className="wk-done">
      <summary>{foldLabel(rows.length, group)}</summary>
      <ul className="wk-rows">{rows.map((it) => <Row key={it.key} it={it} ctx={ctx} phaseKey={phaseKey} carriedOut={false} />)}</ul>
    </details>
  );
}

/** Rows in the order the card keeps: outstanding first in the view's order, carried ones next, then the done ones folded into
 *  one counted line. A row is carried out of its phase only when the phase's `carriedOut` says so: `workMapOf` reads a closed
 *  ticket first (Table 6a), so one with a recorded carry still reads closed, and the card re-derives none of it. */
function Rows({ items, ctx, phaseKey, carriedKeys = NO_CARRY }: { items: readonly WorkItemView[]; ctx: Ctx; phaseKey: string | null; carriedKeys?: ReadonlySet<string> }): ReactNode {
  const carriedOut = (it: WorkItemView): boolean => carriedKeys.has(it.key);
  const open = items.filter((it) => !carriedOut(it) && it.group !== 'done');
  const carried = items.filter(carriedOut);
  const done = items.filter((it) => !carriedOut(it) && it.group === 'done');
  return (
    <>
      {(open.length > 0 || carried.length > 0) && (
        <ul className="wk-rows">
          {open.map((it) => <Row key={it.key} it={it} ctx={ctx} phaseKey={phaseKey} carriedOut={false} />)}
          {carried.map((it) => <Row key={it.key} it={it} ctx={ctx} phaseKey={phaseKey} carriedOut />)}
        </ul>
      )}
      <Fold rows={done} group="done" ctx={ctx} phaseKey={phaseKey} />
    </>
  );
}

/** The items of a list of keys, as the view holds them: a dropped one is never shown, and the epic filter keeps one epic's. */
function itemsOf(keys: readonly string[], ctx: Ctx): WorkItemView[] {
  return keys
    .map((k) => ctx.byKey.get(k))
    .filter((it): it is WorkItemView => it !== undefined && it.group !== 'dropped' && (ctx.filter === null || it.epic?.key === ctx.filter));
}

function PhaseBlock({ phase, ctx }: { phase: WorkPhaseView; ctx: Ctx }): ReactNode {
  const items = itemsOf(phase.items, ctx);
  if (ctx.filter !== null && items.length === 0) return null;
  const line = phaseLine(phase, carriedTargetsOf(phase, ctx.view.items));
  const whole = wholeEpicLine(ctx.view.epics.filter((e) => phase.wholeEpics.includes(e.key)));
  const head = (
    <>
      <span className="wk-phase-title">{phaseHeading(phase)}</span>
      <span className="wk-phase-line">{line}</span>
    </>
  );
  const body = (
    <>
      {phase.summary !== '' && <p className="wk-summary">{phase.summary}</p>}
      {whole !== null && <p className="wk-whole">{whole}</p>}
      <Rows items={items} ctx={ctx} phaseKey={phase.key} carriedKeys={new Set(phase.carriedOut)} />
    </>
  );
  // A finished phase folds, and its heading stays a heading inside its summary, so a screen-reader user moving by headings
  // reaches it as it does an open phase (review 2873 F13).
  return phase.finish !== null
    ? <details className="wk-phase" data-phase={phase.key}><summary className="wk-phase-fold"><h3 className="wk-phase-head">{head}</h3></summary>{body}</details>
    : <section className="wk-phase" data-phase={phase.key}><h3 className="wk-phase-head">{head}</h3>{body}</section>;
}

/** A plan with no phases groups by epic, the work axis: each epic's line carries its counts and its checkpoints. */
function EpicGroup({ epic, ctx }: { epic: WorkEpicView; ctx: Ctx }): ReactNode {
  const items = itemsOf(epic.items, ctx);
  return (
    <section className="wk-phase" data-epic={epic.key}>
      <h3 className="wk-phase-head">
        <span className="wk-phase-title">{epic.title}</span>
        <span className="wk-phase-line">{epicChip(epic)}</span>
      </h3>
      <Rows items={items} ctx={ctx} phaseKey={null} />
    </section>
  );
}

/** The no-plan fallback: the work runs so far, outstanding first, done and failed folded (spec §5.1). */
function RunsList({ runs, ctx }: { runs: readonly WorkItemView[]; ctx: Ctx }): ReactNode {
  const open = runs.filter((r) => r.group !== 'done' && r.group !== 'failed');
  const done = runs.filter((r) => r.group === 'done');
  const failed = runs.filter((r) => r.group === 'failed');
  return (
    <div className="wk-runs">
      {open.length > 0 && <ul className="wk-rows">{open.map((r) => <Row key={r.key} it={r} ctx={ctx} phaseKey={null} carriedOut={false} />)}</ul>}
      <Fold rows={done} group="done" ctx={ctx} phaseKey={null} />
      <Fold rows={failed} group="failed" ctx={ctx} phaseKey={null} />
    </div>
  );
}

/** The epic strip: a chip per epic, in plan order; a tap filters the card to that epic and opens a row of its checkpoints, a
 *  second tap clears it (spec §5 item 2). */
function Strip({ view, filter, onFilter, epicHref }: { view: WorkMapView; filter: string | null; onFilter: (key: string | null) => void; epicHref: WorkCardProps['epicHref'] }): ReactNode {
  const open = view.epics.find((e) => e.key === filter);
  const epicLink = open === undefined || epicHref === undefined ? null : epicHref(open.key);
  return (
    <>
      <ul className="wk-strip">
        {view.epics.map((e) => (
          <li key={e.key}>
            <Button variant="ghost" size="fit" className="wk-chip" aria-pressed={filter === e.key} onClick={() => onFilter(filter === e.key ? null : e.key)}>
              <span className="wk-chip-title">{e.title}</span>
              <span className="wk-chip-figures">{epicChip(e)}</span>
            </Button>
          </li>
        ))}
      </ul>
      {open !== undefined && (
        <div className="wk-cps" role="group" aria-label={checkpointsLabel(open.title)}>
          <ul className="wk-cp-list">
            {open.checkpoints.map((cp) => (
              <li key={cp.key} className="wk-cp">
                <span className="wk-cp-title">{cp.title}</span>
                <span className="wk-cp-facts">{checkpointFacts(cp)}</span>
                {cp.url !== null && <TextLink href={cp.url}>{OPEN_IN_LINEAR}</TextLink>}
              </li>
            ))}
          </ul>
          <p className="wk-cp-links">
            {epicLink !== null && <Link href={epicLink}>{OPEN_EPIC}</Link>}
            {open.url !== null && <TextLink href={open.url}>{OPEN_IN_LINEAR}</TextLink>}
          </p>
        </div>
      )}
    </>
  );
}

/** One line per workspace: a link to its initiative where the plan is bound, the note where initiatives are off. */
function Initiatives({ view }: { view: WorkMapView }): ReactNode {
  if (view.initiatives.length === 0) return null;
  const several = view.initiatives.length > 1;
  return (
    <ul className="wk-initiatives">
      {view.initiatives.map((i) => {
        const note = initiativeNote(i.state);
        const label = several ? `${i.workspaceId}: ` : '';
        if (i.url === null && note === null) return null;
        return (
          <li key={i.workspaceId} className="wk-initiative">
            {i.url !== null ? <>{label}<TextLink href={i.url}>{OPEN_IN_LINEAR}</TextLink></> : `${label}${note}`}
          </li>
        );
      })}
    </ul>
  );
}

function Bar({ counts }: { counts: WorkMapView['counts'] }): ReactNode {
  const segs = BAR_GROUPS.filter((g) => counts[g] > 0);
  return segs.length === 0 ? null : (
    <div className="wk-bar" aria-hidden="true">
      {segs.map((g) => <span key={g} className="wk-seg" data-group={g} style={{ flexGrow: counts[g] }} />)}
    </div>
  );
}

function Body({ view, readAt, now, filter, onFilter, runHref, itemHref, epicHref }: {
  view: WorkMapView; readAt: number; now: number; filter: string | null; onFilter: (key: string | null) => void;
} & Pick<WorkCardProps, 'runHref' | 'itemHref' | 'epicHref'>): ReactNode {
  const ctx: Ctx = { view, byKey: new Map(view.items.map((i) => [i.key, i])), now, filter, runHref, itemHref };
  const head = headline(view);
  const outstanding = outstandingLine(view);
  const note = view.source === 'runs' ? NOTES.noPlan
    : view.source === 'declared-empty' ? NOTES.declaredEmpty
      : view.phases.length === 0 && view.items.some((i) => i.group !== 'dropped') ? NOTES.noPhases : null;
  const notIn = itemsOf(view.notInPhase, ctx);
  return (
    <>
      {head !== null && <p className="wk-headline">{head}</p>}
      {outstanding !== null && <p className="wk-outstanding">{outstanding}</p>}
      <Bar counts={view.counts} />
      <Strip view={view} filter={filter} onFilter={onFilter} epicHref={epicHref} />
      <p className="wk-source">{sourceLine(view, readAt, now)}</p>
      {note !== null && <p className="wk-note">{note}</p>}
      {view.source === 'runs'
        ? view.runs !== null && <RunsList runs={view.runs.items} ctx={ctx} />
        : view.phases.length > 0
          ? view.phases.map((p) => <PhaseBlock key={p.key} phase={p} ctx={ctx} />)
          : view.epics.map((e) => (filter === null || filter === e.key ? <EpicGroup key={e.key} epic={e} ctx={ctx} /> : null))}
      {notIn.length > 0 && (
        <section className="wk-nophase">
          <h3 className="wk-phase-head"><span className="wk-phase-title">{NOT_IN_PHASE_WORD}</span></h3>
          <Rows items={notIn} ctx={ctx} phaseKey={null} />
        </section>
      )}
      {view.beforePlan !== null && <p className="wk-before">{beforePlanLine(view.beforePlan.runs)}</p>}
      {view.doneWhen.length > 0 && (
        <details className="wk-donewhen">
          <summary>{doneWhenLine(view.doneWhen)}</summary>
          <ul className="wk-donewhen-list">
            {view.doneWhen.map((d, i) => <li key={i}><span>{d.text}</span>{' '}<span className="wk-proved">{d.proved ? PROVED_WORD : NOT_PROVED_WORD}</span></li>)}
          </ul>
        </details>
      )}
      <Initiatives view={view} />
    </>
  );
}

export function WorkCard({ work, readAt, runHref, itemHref, epicHref }: WorkCardProps): ReactNode {
  const now = useNow(30_000);
  const headingId = useId();
  const [epicFilter, setEpicFilter] = useState<string | null>(null);
  const unreadable = 'unreadable' in work ? work.unreadable : null;
  const view = 'unreadable' in work ? (work.last ?? null) : work;
  // A filter naming an epic the view no longer holds filters nothing.
  const filter = view !== null && view.epics.some((e) => e.key === epicFilter) ? epicFilter : null;
  return (
    <section className="wk-card" aria-labelledby={headingId}>
      <h2 id={headingId} className="wk-heading">{WORK_TITLE}</h2>
      {unreadable !== null && <p className="wk-note wk-unreadable" role="alert">{unreadableNote(unreadable)}</p>}
      {view !== null && (
        <Body view={view} readAt={readAt} now={now} filter={filter} onFilter={setEpicFilter} runHref={runHref} itemHref={itemHref} epicHref={epicHref} />
      )}
    </section>
  );
}
