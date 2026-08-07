// Every archived workspace, across every project. The card sub-fold makes an
// archived row reachable from its own project; this is the view that answers
// "what is sitting around, and how much would removing it free" — the only
// number in this UI that argues for a cleanup, which is why it comes from the
// manifest ws-archive measured on the box rather than from an estimate here.
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import '../fleet/fleet.css';

/** What the fleet has archived: how many rows, how many bytes of them were
 *  actually measured, and how many rows nobody could measure. */
export interface ArchivedSummary {
  count: number;         // archived rows, measured or not
  bytes: number | null;  // the total of the rows that WERE measured; null when none was
  unmeasured: number;    // rows whose `archivedBytes` never came back
}

export function archivedSummary(sessions: readonly FleetSession[]): ArchivedSummary {
  const rows = sessions.filter((s) => s.archivedAt !== null);
  // The sizes THEMSELVES, narrowed — not the rows: `?? 0` inside the sum is
  // the exact keystroke this finding is about, and it must not survive here
  // even as a type-narrowing artifact over an already-filtered list.
  const sizes = rows.map((s) => s.archivedBytes).filter((b): b is number => b !== null);
  // Fix round 3, verifier P3 (integration new-finding 2). This used to fold an
  // unmeasured row in as `?? 0` and return a plain `number`, so three archives
  // nobody could measure rendered as a confident "Archived · 3 · 0 B" and a
  // half-measured fleet rendered its measured part AS THE TOTAL — a partial
  // total, deterministic on both sides, which is the branch's oldest defect
  // class. `null` means nothing here was measured; `unmeasured` travels beside
  // the figure so no caller can present the sum as the whole without saying
  // what it leaves out. The count is a count of rows and is always exact —
  // that is why it stays a separate number from the bytes.
  //
  // An empty fleet is a true 0, not an unknown: there is no failed read behind
  // it, and no caller renders it anyway (both guard on `count > 0`).
  return {
    count: rows.length,
    bytes: sizes.length === 0 && rows.length > 0 ? null : sizes.reduce((n, b) => n + b, 0),
    unmeasured: rows.length - sizes.length,
  };
}

/** The size half of "Archived · N · …", in ONE place: the fleet footer and
 *  the archive screen's own total render the identical string, so the two
 *  cannot drift into disagreeing about the same fleet — and neither can print
 *  a number for a measurement that never happened. */
export function archivedSizeText(sum: ArchivedSummary): string {
  if (sum.bytes === null) return 'size unknown';
  return sum.unmeasured === 0
    ? humanBytes(sum.bytes)
    : `${humanBytes(sum.bytes)} + ${sum.unmeasured} unmeasured`;
}

export function humanBytes(n: number): string {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  if (n >= 1e3) return `${Math.round(n / 1e3)} kB`;
  return `${n} B`;
}

export function ArchiveScreen({
  sessions, onOpen,
}: { sessions: readonly FleetSession[]; onOpen: (id: string) => void }): ReactNode {
  const rows = sessions.filter((s) => s.archivedAt !== null)
    .slice().sort((a, b) => (b.archivedAt ?? 0) - (a.archivedAt ?? 0));
  const summary = archivedSummary(sessions);
  const { count } = summary;
  if (count === 0) return <p className="archive-empty">Nothing is archived.</p>;
  return (
    <div className="archive-screen">
      {/* The byte figure lives in its own text node, not folded into the
          template literal above it: DEVIATION from the plan's given markup —
          `getByText('2.3 GB')` (Step 5's test) needs an element whose OWN
          text is exactly the figure, and a single `${count} archived · $
          {bytes}` string has no such node — the paragraph's full text is
          "2 archived · 2.3 GB", never an exact match. See task-19-report.md.

          The figure comes from `archivedSizeText`, the same function the fleet
          footer uses (fix round 3, P3): when a row was never measured this
          says so — "size unknown", or "1.2 GB + 1 unmeasured" — instead of
          printing a total that quietly counts an unread size as zero. */}
      <p className="archive-total">{`${count} archived · `}<span className="archive-total-bytes">{archivedSizeText(summary)}</span></p>
      {rows.map((s) => (
        <button key={s.id} type="button" className="archive-row"
                aria-label={`workspace ${s.workspace ?? s.id} in ${s.project}`
                  + (s.held !== null ? `, held: ${s.held}` : '')}
                onClick={() => onOpen(s.id)}>
          <span className="archive-project">{s.project}</span>
          {/* THE ONE SURFACE THAT OFFERS CLEANUP MUST NOT HIDE THE HOLD.
              `ws-hold` refuses an archived workspace, but the reverse order is
              a supported flow — hold, then archive by hand from the PR sheet,
              which `ccd ws-archive` allows on purpose — so archived-and-held is
              reachable, and `ws-reap` refuses it. This screen rendered project,
              slug and size only, so the row led straight to a cleanup that
              cannot happen with nothing on screen to say why. Inside the slug
              cell rather than a fourth column: the row is a three-column grid
              and this needs no new CSS, no new token and no new tap target.
              `.sess-held` is SessionLine's own chip class; `title` carries the
              reason verbatim past the cell's ellipsis, exactly as it does
              there, and the aria-label carries it for a reader who has no
              hover at all. */}
          <span className="archive-slug">
            {s.workspace ?? s.id}
            {s.held !== null && (
              <span className="sess-held" data-held="true" title={s.held}>{' · held'}</span>
            )}
          </span>
          <span className="archive-size">{s.archivedBytes === null ? '—' : humanBytes(s.archivedBytes)}</span>
        </button>
      ))}
    </div>
  );
}
