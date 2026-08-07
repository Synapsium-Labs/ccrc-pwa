import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { ArchiveScreen, archivedSizeText, archivedSummary } from '../src/screens/ArchiveScreen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo', workdir: '/w',
  workspace: 'quiet-basin', name: null, status: 'dead', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: 1785300123,
  archivedBytes: 1_200_000_000, hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'idle', bucketSince: null, ...over,
});

describe('archivedSummary', () => {
  it('counts the archived rows and totals their bytes', () => {
    expect(archivedSummary([s(), s({ id: 'demo-still-cove', archivedBytes: 1_100_000_000 }), s({ id: 'demo-live', archivedAt: null })]))
      .toEqual({ count: 2, bytes: 2_300_000_000, unmeasured: 0 });
  });

  // Fix round 3, verifier P3. Before: this returned a bare `number` and an
  // unmeasured row was folded in as `?? 0`, so the caller could not tell a
  // measured total from a partial one and rendered the partial AS the total.
  it('reports the measured total and how many rows it leaves out — never a partial total on its own', () => {
    expect(archivedSummary([s(), s({ id: 'demo-x', archivedBytes: null })]))
      .toEqual({ count: 2, bytes: 1_200_000_000, unmeasured: 1 });
    expect(archivedSizeText(archivedSummary([s(), s({ id: 'demo-x', archivedBytes: null })])))
      .toBe('1.2 GB + 1 unmeasured');
  });

  it('has no total at all when nothing archived was measured — null, never 0', () => {
    const sum = archivedSummary([
      s({ id: 'a', archivedBytes: null }),
      s({ id: 'b', archivedBytes: null }),
      s({ id: 'c', archivedBytes: null }),
    ]);
    expect(sum).toEqual({ count: 3, bytes: null, unmeasured: 3 });
    // `humanBytes(0)` is the string '0 B' — a stated total for three
    // workspaces nobody sized. The count stays exact: it counts rows.
    expect(archivedSizeText(sum)).toBe('size unknown');
  });

  it('keeps a genuine zero-byte archive a measurement, distinct from an unmeasured one', () => {
    const sum = archivedSummary([s({ id: 'a', archivedBytes: 0 })]);
    expect(sum).toEqual({ count: 1, bytes: 0, unmeasured: 0 });
    expect(archivedSizeText(sum)).toBe('0 B');
  });

  it('is zero-count for a fleet with nothing archived', () => {
    // No archived row means no failed read either — an empty sum is a true 0,
    // not an unknown.
    expect(archivedSummary([s({ archivedAt: null })])).toEqual({ count: 0, bytes: 0, unmeasured: 0 });
  });
});

describe('ArchiveScreen', () => {
  it('lists every archived workspace across projects, newest first', () => {
    render(<ArchiveScreen sessions={[
      s({ id: 'demo-quiet-basin', project: 'demo', archivedAt: 100 }),
      s({ id: 'tools-still-cove', project: 'custom-tools', workspace: 'still-cove', archivedAt: 200 }),
    ]} onOpen={() => {}} />);
    const rows = screen.getAllByRole('button', { name: /workspace/i });
    expect(rows).toHaveLength(2);
    expect(rows[0]!).toHaveTextContent('still-cove');
  });

  // DEVIATION from the brief's given test text — added while closing a
  // mutation-sweep gap; see task-19-report.md. Every other test in this file
  // uses a session whose `workspace` is set, so an aria-label mutant that
  // named every row by `s.id` (never falling through to it) survived them
  // all: the accessible NAME was never asserted precisely enough to notice.
  it('names the row by workspace slug, falling back to the session id only when there is no slug', () => {
    render(<ArchiveScreen sessions={[
      s({ id: 'demo-quiet-basin', workspace: 'quiet-basin', project: 'demo' }),
      s({ id: 'demo-main', workspace: null, project: 'demo' }),
    ]} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'workspace quiet-basin in demo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'workspace demo-main in demo' })).toBeInTheDocument();
  });

  it('shows each row size and the total', () => {
    render(<ArchiveScreen sessions={[s(), s({ id: 'demo-still-cove', workspace: 'still-cove', archivedBytes: 1_100_000_000 })]} onOpen={() => {}} />);
    expect(screen.getByText('2.3 GB')).toBeInTheDocument();
  });

  // Fix round 3, verifier P3 — the screen half of the same defect the fleet
  // footer had. The total and the per-row glyph must agree about what is
  // known: rows that read '—' cannot be silently worth 0 in the figure above
  // them.
  it('qualifies the total when a row was never measured, and refuses one entirely when none was', () => {
    const { container, rerender } = render(<ArchiveScreen sessions={[
      s({ id: 'demo-quiet-basin' }),
      s({ id: 'demo-still-cove', workspace: 'still-cove', archivedBytes: null }),
    ]} onOpen={() => {}} />);
    expect(container.querySelector('.archive-total')).toHaveTextContent('2 archived · 1.2 GB + 1 unmeasured');

    rerender(<ArchiveScreen sessions={[
      s({ id: 'demo-quiet-basin', archivedBytes: null }),
      s({ id: 'demo-still-cove', workspace: 'still-cove', archivedBytes: null }),
    ]} onOpen={() => {}} />);
    expect(container.querySelector('.archive-total')).toHaveTextContent('2 archived · size unknown');
    expect(screen.queryByText('0 B')).not.toBeInTheDocument();
  });

  it('opens the session — the transcript still renders', () => {
    const onOpen = vi.fn();
    render(<ArchiveScreen sessions={[s()]} onOpen={onOpen} />);
    fireEvent.click(screen.getAllByRole('button', { name: /workspace/i })[0]!);
    expect(onOpen).toHaveBeenCalledWith('demo-quiet-basin');
  });

  it('says so plainly when nothing is archived', () => {
    render(<ArchiveScreen sessions={[]} onOpen={() => {}} />);
    expect(screen.getByText(/nothing is archived/i)).toBeInTheDocument();
  });

  // DEVIATION from the brief's given test text — added while closing a
  // mutation-sweep gap; see task-19-report.md. The measurement rule cuts
  // both ways: a genuine zero-byte archive is a MEASUREMENT (render it), an
  // absent one is UNKNOWN (render '—'). `archivedBytes === null` is the only
  // correct test for the row; `!s.archivedBytes` or `s.archivedBytes ||` would
  // fold a real 0 into the same glyph as "never measured" and this is the
  // only test that would notice.
  it('renders a genuine zero-byte archive as 0 B, distinct from an unmeasured archive\'s —', () => {
    // A third row with a large, distinct size keeps the fleet TOTAL off
    // "0 B" too, so the assertions below can only match the per-row spans.
    render(<ArchiveScreen sessions={[
      s({ id: 'demo-quiet-basin', archivedBytes: 0 }),
      s({ id: 'demo-still-cove', workspace: 'still-cove', archivedBytes: null }),
      s({ id: 'demo-far-shore', workspace: 'far-shore', archivedBytes: 5_000_000_000 }),
    ]} onOpen={() => {}} />);
    expect(screen.getByText('0 B')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
