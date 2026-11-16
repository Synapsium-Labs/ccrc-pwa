// Advanced, "What ccrc closes on its own" (the runs rebuild, Task 26, D-8077; spec 2026-11-04 §8.6 item 2, §12.3, A15, o7, o12).
// One row per lane group: its state word (off, shadow, on, or held), the count of runs that would close, the controls that arm it,
// and what it closed and was refused in the last 7 days. "Turn on" opens the sheet that lists every run that would close, with its
// reason and time, and names under the list any run the row fits that the lane would not close. The row and the sheet draw their
// count from the same list, so they cannot disagree. Turn off and Back to shadow are the safe directions and act at once.
//
// It reads `GET /api/coord/run-close` every minute and after a write; the write's reply is installed as the view. A held group
// (a pause, or a registry that would not list) has no list and Turn on is disabled; the server refuses to arm then as well.
import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Button, EmptyState, QC_ACTIONS, Sheet, cn, toast, useNow } from '@ccrc/ui';
import type { RunCloseChoice, RunCloseGroup, RunCloseGroupView, RunCloseRequest, RunCloseView } from '../../../shared/run-close';
import { runCloseListOf } from '../../../shared/run-close';
import { api } from '../lib/api';
import { usePoll } from '../lib/usePoll';
import { GHOST_ANCHOR } from '../lib/ghostAnchor';
import { inAppClick } from '../fleet/settingsText';
import { runPath } from '../lib/routes';
import {
  RUN_CLOSE_GROUP_TITLE, RUN_CLOSE_HELD_WORD, RUN_CLOSE_STATE_NOTE, RUN_CLOSE_STATE_WORD, RUN_CLOSE_WHY_WORD, RUN_CLOSE_WORDS,
  asRunCloseView, namedWord, runCloseControls, runCloseCountLine, runCloseTally, runCloseWhen,
} from './runCloseWords';
import './run-close.css';

/** A line under a row's heading that spans its width. */
const WIDE_NOTE = 'rc-note rc-wide';

/** The read's cadence: the lane's own beat. */
export const RUN_CLOSE_POLL_MS = 60_000;

type Reader = () => Promise<unknown>;
type Writer = (body: RunCloseRequest) => Promise<unknown>;
const readDefault: Reader = () => api.runClose();
const writeDefault: Writer = (body) => api.setRunClose(body);

export function RunCloseSection({ read = readDefault, write = writeDefault, pollMs = RUN_CLOSE_POLL_MS }: {
  read?: Reader;
  write?: Writer;
  /** `<= 0` is the injected mode: one read is asked by the caller's `reload`, none by a timer. */
  pollMs?: number;
}): ReactNode {
  const now = useNow(30_000);
  const [view, setView] = useState<RunCloseView | null>(null);
  const [failed, setFailed] = useState(false);
  const [sheet, setSheet] = useState<RunCloseGroup | null>(null);
  const [busy, setBusy] = useState(false);
  const { reload, supersede } = usePoll({
    pollMs: pollMs > 0 ? pollMs : null,
    request: () => read(),
    onOutcome: (o) => {
      const next = o.ok ? asRunCloseView(o.raw, Date.now()) : null;
      if (next === null) { setFailed(true); return; }
      setFailed(false);
      setView(next);
    },
  });

  const change = useCallback((group: RunCloseGroup, choice: RunCloseChoice): void => {
    setBusy(true);
    void write({ group, choice }).then((raw) => {
      supersede();
      const next = asRunCloseView(raw, Date.now());
      if (next === null) { toast(RUN_CLOSE_WORDS.writeFailed, 'info'); reload(); return; }
      setView(next);
      setFailed(false);
    }, () => { toast(RUN_CLOSE_WORDS.writeFailed, 'info'); reload(); }).finally(() => { setBusy(false); setSheet(null); });
  }, [write, supersede, reload]);

  let body: ReactNode;
  if (view === null) {
    body = failed ? (
      <EmptyState data-state="error">
        {RUN_CLOSE_WORDS.failed}{' '}
        <Button variant="ghost" size="fit" onClick={() => { reload(); }}>{RUN_CLOSE_WORDS.tryAgain}</Button>
      </EmptyState>
    ) : <EmptyState data-state="loading">{RUN_CLOSE_WORDS.loading}</EmptyState>;
  } else {
    body = view.groups.map((g) => <GroupRow key={g.group} g={g} nowMs={now} busy={busy} onChoose={(c) => {
      if (c === 'on') setSheet(g.group); else change(g.group, c);
    }} />);
  }
  const sheeted = sheet === null ? null : view?.groups.find((g) => g.group === sheet) ?? null;
  return (
    <section className="ra-section rc-section" aria-label={RUN_CLOSE_WORDS.heading}>
      <h2 className="ra-head">{RUN_CLOSE_WORDS.heading}</h2>
      {body}
      {sheeted !== null && (
        <TurnOnSheet g={sheeted} nowMs={now} busy={busy} onConfirm={() => change(sheeted.group, 'on')} onClose={() => setSheet(null)} />
      )}
    </section>
  );
}

/** A group's list as the page clock reads it: `now` and `later` recomputed, so a run whose time runs out moves with the clock. */
const listAt = (g: RunCloseGroupView, nowMs: number): ReturnType<typeof runCloseListOf> | null =>
  g.list === null ? null : runCloseListOf(g.list.would, g.list.named, nowMs);

function GroupRow({ g, nowMs, busy, onChoose }: {
  g: RunCloseGroupView; nowMs: number; busy: boolean; onChoose: (c: RunCloseChoice) => void;
}): ReactNode {
  const list = listAt(g, nowMs);
  const controls = runCloseControls(g);
  const disabledWhy = controls.find((c) => !c.enabled && c.why !== null)?.why ?? null;
  return (
    <div className="rc-row" data-testid={`run-close-${g.group}`} data-state={g.state}>
      <div>
        <h3 className="rc-title">{RUN_CLOSE_GROUP_TITLE[g.group]}</h3>
        <span className={g.state === 'on' ? 'rc-state rc-state-on' : 'rc-state'}>{RUN_CLOSE_STATE_WORD[g.state]}</span>
        {' '}
        <span className="rc-note">{g.held === null ? RUN_CLOSE_STATE_NOTE[g.state] : RUN_CLOSE_HELD_WORD[g.held]}</span>
      </div>
      {controls.length > 0 && (
        <div className="rc-controls">
          {controls.map((c) => (
            <Button key={c.choice} variant="ghost" size="fit" className="rc-control" disabled={busy || !c.enabled} onClick={() => onChoose(c.choice)}>
              {c.label}
            </Button>
          ))}
        </div>
      )}
      {g.marker === 'set' && <p className={WIDE_NOTE}>{RUN_CLOSE_WORDS.markerNote}</p>}
      {list !== null && <p className="rc-count rc-wide" data-testid="run-close-count">{runCloseCountLine(list.would.length, list.now)}</p>}
      {list !== null && list.named.length > 0 && (
        <p className={WIDE_NOTE}>{list.named.length === 1 ? '1 more run fits but is not in that count.' : `${list.named.length} more runs fit but are not in that count.`}</p>
      )}
      {disabledWhy !== null && <p className="rc-why rc-wide">{disabledWhy}</p>}
      <p className="rc-tally rc-wide">{runCloseTally(g)}</p>
    </div>
  );
}

function TurnOnSheet({ g, nowMs, busy, onConfirm, onClose }: {
  g: RunCloseGroupView; nowMs: number; busy: boolean; onConfirm: () => void; onClose: () => void;
}): ReactNode {
  const list = listAt(g, nowMs);
  const footer = (
    <div className={QC_ACTIONS}>
      <Button variant="danger" disabled={busy} onClick={onConfirm}>{RUN_CLOSE_WORDS.turnOn}</Button>
      <Button variant="ghost" disabled={busy} onClick={onClose}>{RUN_CLOSE_WORDS.keepShadow}</Button>
    </div>
  );
  return (
    <Sheet open onClose={busy ? () => {} : onClose} title={RUN_CLOSE_WORDS.sheetTitle} footer={footer}>
      <div className="rc-sheet" data-testid="run-close-sheet">
        <p className="rc-sub">{RUN_CLOSE_GROUP_TITLE[g.group]}</p>
        {list === null ? <p className="rc-note">{g.group === 'claimant-crashed' ? RUN_CLOSE_WORDS.noList : RUN_CLOSE_WORDS.noListYet}</p> : (
          <>
            <p className="rc-count" data-testid="run-close-sheet-count">{runCloseCountLine(list.would.length, list.now)}</p>
            <RunList label="Would close" items={list.would.map((w) => ({
              runId: w.runId, program: w.program, line: `${RUN_CLOSE_WHY_WORD[w.why]} · ${runCloseWhen(w.at, nowMs)}`,
            }))} />
            {list.named.length > 0 && (
              <>
                <p className="rc-sub">{RUN_CLOSE_WORDS.notClosing}</p>
                <RunList label="Not closing" items={list.named.map((n) => ({ runId: n.runId, program: n.program, line: namedWord(n.why) }))} />
              </>
            )}
          </>
        )}
      </div>
    </Sheet>
  );
}

/** A list of runs in the sheet: each a link to its record and one line under it. Empty draws nothing. */
function RunList({ label, items }: { label: string; items: readonly { runId: number; program: string; line: string }[] }): ReactNode {
  if (items.length === 0) return null;
  return (
    <ul className="rc-list" aria-label={label}>
      {items.map((r) => (
        <li key={r.runId}>
          <a className={cn(GHOST_ANCHOR, 'rc-run')} href={runPath(r.runId)} onClick={inAppClick(runPath(r.runId))}>Run {r.runId} · {r.program}</a>
          <span className="rc-line">{r.line}</span>
        </li>
      ))}
    </ul>
  );
}
