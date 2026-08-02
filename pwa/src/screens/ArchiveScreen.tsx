// Every archived workspace, across every project. The card sub-fold makes an
// archived row reachable from its own project; this is the view that answers
// "what is sitting around, and how much would removing it free" — the only
// number in this UI that argues for a cleanup, which is why it comes from the
// manifest ws-archive measured on the box rather than from an estimate here.
import type { ReactNode } from 'react';
import type { FleetSession } from '../../../shared/api';
import '../fleet/fleet.css';

export function archivedSummary(sessions: readonly FleetSession[]): { count: number; bytes: number } {
  const rows = sessions.filter((s) => s.archivedAt !== null);
  // An unknown size contributes nothing rather than an invented figure; the
  // count still includes the row, so the two numbers stay honest separately.
  return { count: rows.length, bytes: rows.reduce((n, s) => n + (s.archivedBytes ?? 0), 0) };
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
  const { count, bytes } = archivedSummary(sessions);
  if (count === 0) return <p className="archive-empty">Nothing is archived.</p>;
  return (
    <div className="archive-screen">
      {/* The byte figure lives in its own text node, not folded into the
          template literal above it: DEVIATION from the plan's given markup —
          `getByText('2.3 GB')` (Step 5's test) needs an element whose OWN
          text is exactly the figure, and a single `${count} archived · $
          {bytes}` string has no such node — the paragraph's full text is
          "2 archived · 2.3 GB", never an exact match. See task-19-report.md. */}
      <p className="archive-total">{`${count} archived · `}<span className="archive-total-bytes">{humanBytes(bytes)}</span></p>
      {rows.map((s) => (
        <button key={s.id} type="button" className="archive-row"
                aria-label={`workspace ${s.workspace ?? s.id} in ${s.project}`}
                onClick={() => onOpen(s.id)}>
          <span className="archive-project">{s.project}</span>
          <span className="archive-slug">{s.workspace ?? s.id}</span>
          <span className="archive-size">{s.archivedBytes === null ? '—' : humanBytes(s.archivedBytes)}</span>
        </button>
      ))}
    </div>
  );
}
