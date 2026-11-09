// The group abandon sheet (D-8074; spec 2026-11-04 §9.2; wave B4 Task 14). A Stuck head's free runs, every one ticked: untick to
// keep one, and the title and confirm follow. The sheet drives `runGroupAbandon` over the list it showed, so a run that joins the
// group afterwards is not added (A34), and it stays open only when something was refused, got no answer or was stopped.
//
// It is a `Sheet`, not a `QuickConfirm`, for `AbandonSheet`'s reason: a refusal needs its sentence in the sheet. A row is a
// `role="checkbox"` button, so the whole line is one 44px target and the census sees one control shape.
import { useRef, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import type { RunSummary, StuckReason } from '../../../shared/api';
import { Button, QC_ACTIONS, QC_CONSEQUENCE, Sheet, cn, toast } from '@ccrc/ui';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { api } from '../lib/api';
import { navigate } from '../lib/router';
import { runPath, runsAdvancedPath } from '../lib/routes';
import type { AbandonAnswer } from './AbandonSheet';
import {
  ABANDON_CALL_MS, groupRunSentence, groupSheetLines, groupSummary, groupToast, groupToastHasLink, runGroupAbandon,
  type GroupResult, type GroupStanding,
} from './groupAbandon';
import type { CoordinatorPresence } from './presence';
import { inAppClick } from './settingsText';
import { runRowName } from './runWords';
import { heldBack, stuckLine } from './stuckWords';
import './group-abandon.css';

type Phase = 'choose' | 'running' | 'done';

export function GroupAbandonSheet({
  reason, runs, nowMs, presence, standing, onClose, onDone, abandonRun = api.abandonRun,
}: {
  reason: StuckReason;
  /** The head's runs as the sheet opened: the confirmed list is a subset of these, and none joins later (A34). */
  runs: readonly RunSummary[];
  nowMs: number;
  presence: (run: RunSummary) => CoordinatorPresence;
  /** Where a run stands in the live frame right now, asked before each call (A49). */
  standing: (id: number) => GroupStanding;
  onClose: () => void;
  /** Fires once when the loop ends, whatever it ended in: the caller re-reads Closed today. */
  onDone?: () => void;
  abandonRun?: (id: number, opts?: { timeoutMs?: number | null }) => Promise<AbandonAnswer>;
}): ReactNode {
  const free = runs.filter((r) => !heldBack(r));
  const [ticked, setTicked] = useState<ReadonlySet<number>>(() => new Set(free.map((r) => r.id)));
  const [phase, setPhase] = useState<Phase>('choose');
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<GroupResult | null>(null);
  const stopRef = useRef(false);
  const [stopping, setStopping] = useState(false);

  const chosen = free.filter((r) => ticked.has(r.id));
  const sheet = groupSheetLines(reason, chosen, presence);
  const byId = new Map(runs.map((r) => [r.id, r] as const));
  const toggle = (id: number): void => {
    const next = new Set(ticked);
    if (!next.delete(id)) next.add(id);
    setTicked(next);
  };

  const confirm = (): void => {
    if (phase !== 'choose' || chosen.length === 0) return;
    const list = chosen.map((r) => r.id);
    setPhase('running');
    void runGroupAbandon(list, {
      abandon: (id) => abandonRun(id, { timeoutMs: ABANDON_CALL_MS }),
      standing,
      stopped: () => stopRef.current,
      onStep: setStep,
    }).then((r) => {
      onDone?.();
      const said = groupToast(r);
      if (said === null) { setResult(r); setPhase('done'); return; }
      toast(said, 'info', groupToastHasLink(r) ? { label: 'See them', onClick: () => navigate(runsAdvancedPath('by-you')) } : undefined);
      onClose();
    });
  };

  const stop = (): void => { stopRef.current = true; setStopping(true); };
  // Nothing closes the sheet while the loop runs: Stop is the way out, and it ends the loop within one limit.
  const close = (): void => { if (phase !== 'running') onClose(); };

  const toRecord = (id: number) => (e: MouseEvent<HTMLAnchorElement>): void => { inAppClick(runPath(id))(e); onClose(); };
  const recordLink = (id: number): ReactNode => (
    <a className={cn(GHOST_ANCHOR, 'abandon-link')} href={runPath(id)} onClick={toRecord(id)}>Open record</a>
  );

  let body: ReactNode;
  let footer: ReactNode;
  let title = sheet.title;
  if (phase === 'choose') {
    body = (
      <>
        {sheet.lines.map((l) => <p key={l} className={chosen.length === 1 ? 'abandon-note' : QC_CONSEQUENCE}>{l}</p>)}
        <ul className="group-abandon-list">
          {free.map((r) => (
            <li key={r.id}>
              <button type="button" role="checkbox" aria-checked={ticked.has(r.id)} className="group-abandon-row" onClick={() => toggle(r.id)}>
                <span className="group-abandon-box" aria-hidden="true">{ticked.has(r.id) ? '✓' : ''}</span>
                <span className="group-abandon-text">
                  <span className="group-abandon-name">Run {r.id} · {runRowName(r)}</span>
                  <span className="abandon-line">{stuckLine(r, nowMs)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </>
    );
    footer = (
      <div className={QC_ACTIONS}>
        <Button variant="danger" disabled={sheet.confirm === null} onClick={confirm}>{sheet.confirm ?? 'Abandon'}</Button>
        <Button variant="ghost" onClick={onClose}>Keep them</Button>
      </div>
    );
  } else if (phase === 'running') {
    body = <p className="abandon-note" role="status">Abandoning {step} of {chosen.length}…</p>;
    footer = (
      <div className={QC_ACTIONS}>
        <Button variant="danger" disabled>{`Abandoning ${step} of ${chosen.length}…`}</Button>
        <Button variant="ghost" disabled={stopping} onClick={stop}>{stopping ? 'Stopping…' : 'Stop'}</Button>
      </div>
    );
  } else {
    const r = result!;
    title = 'Some runs were not abandoned';
    const listed = [...r.refused.map((x) => x.id), ...r.noAnswer, ...r.notReached];
    // The runs not abandoned come first, in the order they were confirmed; the runs that had already closed follow (o4).
    const order = (ids: readonly number[]): number[] => chosen.map((c) => c.id).filter((id) => ids.includes(id));
    body = (
      <>
        <p className="abandon-note">{groupSummary(r)}</p>
        <ul className="group-abandon-list">
          {[...order(listed), ...order(r.alreadyClosed)].map((id) => {
            const run = byId.get(id);
            return (
              <li key={id} className="group-abandon-result">
                <span className="group-abandon-name">Run {id}{run === undefined ? '' : ` · ${runRowName(run)}`}</span>
                <span className={r.refused.some((x) => x.id === id) ? 'abandon-error' : 'abandon-line'}>{groupRunSentence(r, id)}</span>
                {(r.noAnswer.includes(id) || r.alreadyClosed.includes(id)) && <span className="abandon-links">{recordLink(id)}</span>}
              </li>
            );
          })}
        </ul>
        {r.leftAlone.length > 0 && (
          <p className="abandon-note">
            {r.leftAlone.length} started moving and {r.leftAlone.length === 1 ? 'was' : 'were'} left alone.
          </p>
        )}
      </>
    );
    footer = <div className={QC_ACTIONS}><Button variant="ghost" onClick={onClose}>Done</Button></div>;
  }

  return (
    <Sheet open onClose={close} title={title} footer={footer}>
      <div className="abandon-sheet group-abandon-sheet" data-phase={phase}>{body}</div>
    </Sheet>
  );
}
