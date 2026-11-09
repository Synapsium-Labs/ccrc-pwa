// The Stuck band (D-8074; spec 2026-11-04 §8.2 item 4, §8.2.1; wave B4 Task 13). L4. One head per reason with live runs, in the
// fixed order of `STUCK_HEAD_ORDER` whatever the sizes, folded by default at every width, oldest first within a head. A head
// says its heading, its count and its oldest age (the largest age a row of it shows); its group control counts only what may
// go in bulk, and a head with a run that holds a workspace or session says so beside it. Rows and heads take the one page
// clock from the board, so nothing here reads the network or the time. Stuck never counts in a badge (D-6170): a row carries
// a "needs you" marker only from the one needs-you source, which this task does not feed.
//
// THE GROUP CONTROL IS NOT WIRED HERE. Task 14 gives it a sheet; until a caller passes `onGroup` the control is drawn disabled
// rather than as a tap that does nothing. A row's own Abandon works from the start and is the only Abandon on the board.
import { useState } from 'react';
import type { ReactNode } from 'react';
import type { RunSummary, StuckReason } from '../../../shared/api';
import { RUN_GLYPH, isRunClosed, runRowName, runState, runStateWord } from '../fleet/runWords';
import {
  STUCK_HEAD_ORDER, STUCK_HEADING, groupControlWords, heldBack, heldBackLine, oldestAge, runMarker, stuckLine,
} from '../fleet/stuckWords';
import { navigate } from '../lib/router';
import { runPath } from '../lib/routes';
import { pageStorage, readKey, writeKey } from '../lib/storage';
import './stuck-band.css';

/** The open heads, remembered per viewer (check 11). Folded is the default; storage may be absent or throw. */
const OPEN_KEY = 'ccrc-runs-stuck-open';

function readOpen(): ReadonlySet<StuckReason> {
  try {
    const raw = readKey(OPEN_KEY, pageStorage);
    const list: unknown = raw === null ? [] : JSON.parse(raw);
    return new Set(Array.isArray(list) ? STUCK_HEAD_ORDER.filter((r) => list.includes(r)) : []);
  } catch {
    return new Set();
  }
}

/** An open run the server calls stuck. A run with `stuck` absent (an older server, or before its first pass) or null is not. */
export const isStuckRun = (r: RunSummary): boolean => r.stuck != null && !isRunClosed(r);

/** The band's groups: a head per reason that has runs, in the fixed order, each oldest first (ties by id). */
export function stuckGroups(runs: readonly RunSummary[]): { reason: StuckReason; runs: RunSummary[] }[] {
  const out: { reason: StuckReason; runs: RunSummary[] }[] = [];
  for (const reason of STUCK_HEAD_ORDER) {
    const list = runs.filter((r) => isStuckRun(r) && r.stuck!.reason === reason)
      .sort((a, b) => a.stuck!.since - b.stuck!.since || a.id - b.id);
    if (list.length > 0) out.push({ reason, runs: list });
  }
  return out;
}

function StuckRow({ run, nowMs, current, onAbandon }: {
  run: RunSummary; nowMs: number; current: boolean; onAbandon: (run: RunSummary) => void;
}): ReactNode {
  const marker = runMarker(run, false);
  const where = run.workspace ?? run.branch;
  return (
    <li className="run-row run-stuck" title={where === null ? `run ${run.id}` : `run ${run.id} · ${where}`}>
      <button type="button" className="run-open" aria-current={current ? 'true' : undefined} onClick={() => navigate(runPath(run.id))}>
        <span className="run-glyph" aria-hidden="true">{RUN_GLYPH[runState(run)]}</span>
        <span className="run-state run-stuck-word">{runStateWord(run)}</span>
        <span className="run-name">{runRowName(run)}</span>
        <span className="run-stuck-line">{stuckLine(run, nowMs)}</span>
        {marker !== null && <span className="run-marker">{marker}</span>}
      </button>
      <button type="button" className="run-abandon" aria-label={`Abandon run ${run.id}`} onClick={() => onAbandon(run)}>Abandon</button>
    </li>
  );
}

export function StuckBand({ runs, nowMs, openId = null, onAbandon, onGroup }: {
  runs: readonly RunSummary[];
  nowMs: number;
  /** The run open in the broad pane, if any: its row is marked current. */
  openId?: number | null;
  onAbandon: (run: RunSummary) => void;
  /** Opens the group act for a head's free runs (Task 14). Absent, the control is drawn disabled. */
  onGroup?: (reason: StuckReason, free: RunSummary[]) => void;
}): ReactNode {
  const [open, setOpen] = useState<ReadonlySet<StuckReason>>(readOpen);
  const groups = stuckGroups(runs);
  if (groups.length === 0) return null;
  const total = groups.reduce((n, g) => n + g.runs.length, 0);
  const toggle = (reason: StuckReason): void => {
    const next = new Set(open);
    if (!next.delete(reason)) next.add(reason);
    setOpen(next);
    writeKey(OPEN_KEY, JSON.stringify(STUCK_HEAD_ORDER.filter((r) => next.has(r))));
  };
  return (
    <section className="stuck-band" aria-label={`Stuck, ${total}`} data-testid="stuck-band">
      <h2 className="stuck-band-title">Stuck · {total}</h2>
      <p className="stuck-band-note">Nothing is moving these. Each says why, and whether ccrc will close it.</p>
      {groups.map(({ reason, runs: list }) => {
        const free = list.filter((r) => !heldBack(r));
        const held = list.length - free.length;
        const words = groupControlWords(free.length, list.length);
        const isOpen = open.has(reason);
        const bodyId = `stuck-body-${reason}`;
        return (
          <div key={reason} className="stuck-group" data-reason={reason}>
            <div className="stuck-head">
              <button type="button" className="stuck-head-toggle" aria-expanded={isOpen} aria-controls={bodyId} onClick={() => toggle(reason)}>
                <span className="stuck-head-name">{STUCK_HEADING[reason]}</span>
                <span className="stuck-head-count">· {list.length}</span>
                <span className="stuck-head-oldest">· oldest {oldestAge(list, nowMs)}</span>
              </button>
              {words !== null && (
                <button type="button" className="stuck-head-group" disabled={onGroup === undefined}
                  onClick={() => onGroup?.(reason, free)}>{words}</button>
              )}
              {held > 0 && <p className="stuck-held">{heldBackLine(held)}</p>}
            </div>
            {isOpen && (
              <ul className="runs-list stuck-rows" id={bodyId}>
                {list.map((run) => <StuckRow key={run.id} run={run} nowMs={nowMs} current={run.id === openId} onAbandon={onAbandon} />)}
              </ul>
            )}
          </div>
        );
      })}
    </section>
  );
}
