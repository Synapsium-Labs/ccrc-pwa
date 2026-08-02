import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { ArchiveScreen, archivedSummary } from '../src/screens/ArchiveScreen';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-basin', wrapper: 'claude', home: 'claude', project: 'demo', workdir: '/w',
  workspace: 'quiet-basin', name: null, status: 'dead', statusUpdatedAt: null, limits: null,
  dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: 'ws/quiet-basin', tasks: null, pr: null, archivedAt: 1785300123,
  archivedBytes: 1_200_000_000, ...over,
});

describe('archivedSummary', () => {
  it('counts the archived rows and totals their bytes', () => {
    expect(archivedSummary([s(), s({ id: 'demo-still-cove', archivedBytes: 1_100_000_000 }), s({ id: 'demo-live', archivedAt: null })]))
      .toEqual({ count: 2, bytes: 2_300_000_000 });
  });

  it('totals only what it actually knows, and says nothing about the rest', () => {
    // An unknown size contributes 0 to the total rather than inventing one;
    // the count still includes the row, so the two numbers stay honest
    // independently.
    expect(archivedSummary([s(), s({ id: 'demo-x', archivedBytes: null })]))
      .toEqual({ count: 2, bytes: 1_200_000_000 });
  });

  it('is zero-count for a fleet with nothing archived', () => {
    expect(archivedSummary([s({ archivedAt: null })])).toEqual({ count: 0, bytes: 0 });
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
