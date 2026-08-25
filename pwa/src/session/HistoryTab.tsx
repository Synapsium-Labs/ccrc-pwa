// HistoryTab — one session's past tense (Build 9 spec §2 pwa): the
// provenance journal's rows for this session, oldest-first, in a sheet off
// the header's overflow menu. `obs` and `dec` render SIDE BY SIDE and are
// never merged into a "who" (operator ruling R3 — nothing computes one);
// journalWords' one door relates them, and a `disagrees` wears its own
// colour (`data-corr`, chat.css) — a fact the operator sees, never a
// silently picked winner. Gaps ride in the same answer and render as holes
// in the timeline, not as silence (D6).
//
// NO DECISIONS (the pwa wave is L4): every word comes from journalWords/L0,
// every fact from the wire, and this component's own logic is fetch-on-open
// plus an interleave sort. It re-fetches each time it opens — history grows
// while the sheet is closed, and a stale timeline defeats the point.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { LifecycleGap, LifecycleQueryResult, MirroredLifecycleEvent } from '../../../shared/api';
import { lcRefusalWord } from '../../../shared/api';
import { Sheet } from '../components/Sheet';
import { api, apiErrorText } from '../lib/api';
import { CORROBORATION_WORD, actWord, eventCorroboration, outcomeGlyph, outcomeWord } from './journalWords';
import './chat.css';

/** '14:05 · 12 Aug' — an ABSOLUTE stamp: a timeline is read as a record, and
 *  "3d ago" on row after row defeats ordering at a glance. `null` = the line
 *  carried no readable time (never 0, which is a date, not an absence). */
function when(at: number | null): string {
  if (at === null) return '—';
  const d = new Date(at);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())} · ${d.getDate()} ${d.toLocaleString('en', { month: 'short' })}`;
}

function EventRow({ ev }: { ev: MirroredLifecycleEvent }): ReactNode {
  const corr = eventCorroboration(ev);
  return (
    <li className="history-row" data-outcome={ev.outcome}>
      <span className="history-when">{when(ev.at)}</span>
      <span className="history-act">
        {actWord(ev.act, ev.badact)}
        {ev.verb !== null && <span className="history-verb"> · {ev.verb}</span>}
      </span>
      <span className="history-outcome">{outcomeGlyph(ev.outcome)} {outcomeWord(ev.outcome)}</span>
      {/* The two identity families, side by side, never merged (R3). Declared
          values render VERBATIM — attribution, not authentication, the same
          rule lifecycleWords applies to the stop stamp's surface. */}
      <span className="history-obs">
        {ev.obs === null
          ? 'observed: nothing'
          : `observed: ${ev.obs.cg ?? 'unclassified'}${ev.obs.pane !== null ? ` · pane ${ev.obs.pane}` : ''}`}
      </span>
      <span className="history-dec">
        {ev.dec === null
          ? 'declared: nothing'
          : `declared: ${ev.dec.surface}${ev.dec.actor !== null ? ` · ${ev.dec.actor}` : ''}${ev.dec.reason !== null ? ` — ${ev.dec.reason}` : ''}`}
      </span>
      <span className="history-corr" data-corr={corr}>{CORROBORATION_WORD[corr]}</span>
      {ev.refusal !== null && (
        // Journal-only tokens get their sentence from LC_REFUSAL_WORD (L0);
        // a token from wsaudit's family has no L0 word here and renders as
        // itself — a maintainer's grep target, still better than silence.
        <span className="history-refusal">{lcRefusalWord(ev.refusal) ?? ev.refusal}</span>
      )}
    </li>
  );
}

function GapRow({ gap }: { gap: LifecycleGap }): ReactNode {
  return (
    <li className="history-row history-row--gap">
      <span className="history-when">{when(gap.at)}</span>
      <span className="history-gap">a hole in the record — {gap.reason}: {gap.detail}</span>
    </li>
  );
}

export function HistoryTab({ id, open, onClose }: {
  id: string; open: boolean; onClose: () => void;
}): ReactNode {
  const [result, setResult] = useState<LifecycleQueryResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return undefined;
    let live = true;
    setError(null);
    api.lifecycle(id)
      .then((r) => { if (live) setResult(r); })
      .catch((err: unknown) => { if (live) setError(apiErrorText(err)); });
    return () => { live = false; };
  }, [open, id]);

  let bodyNode: ReactNode;
  if (error !== null) {
    // An unmeasured absence is not an empty history — SessionScreen's own
    // searchComplete rule, applied to the journal.
    bodyNode = <p className="history-error" role="status">Couldn't read the journal — {error}</p>;
  } else if (result === null) {
    bodyNode = <p className="history-loading" role="status">Reading the journal…</p>;
  } else if (result.events.length === 0 && result.gaps.length === 0) {
    bodyNode = (
      <p className="history-empty">
        No journal rows for this session — nothing recorded yet, or this box's ccd
        predates the lifecycle journal.
      </p>
    );
  } else {
    // Events and gaps interleave on their own timestamps; a row with no
    // readable time sinks to the end rather than pretending to be first.
    const items: Array<{ at: number; node: ReactNode }> = [
      ...result.events.map((e, i) => ({
        at: e.at ?? Number.MAX_SAFE_INTEGER,
        node: <EventRow key={`e-${e.uid ?? i}`} ev={e} />,
      })),
      ...result.gaps.map((g, i) => ({
        at: g.at, node: <GapRow key={`g-${i}`} gap={g} />,
      })),
    ];
    items.sort((a, b) => a.at - b.at);
    bodyNode = <ol className="history-rows">{items.map((x) => x.node)}</ol>;
  }

  return (
    <Sheet open={open} onClose={onClose} eyebrow="history" title="What happened here">
      {bodyNode}
    </Sheet>
  );
}
