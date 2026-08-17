// The archive-conflict sheet — what `409 run-open` looks like to a human
// (Build 8 Wave 2, Task 212). TDD red-first: written before
// `ArchiveConflictSheet.tsx` exists, run once to confirm it fails on the
// missing module, then again once the implementation lands.
//
// Two halves, `abandon-sheet.test.tsx`'s own split: `runOpenRuns` — the ONE
// reader of the refusal body in the whole client — tested as a function, and
// the sheet rendered directly with an INJECTED `archive`. The two DOORS that
// route into it (`PrSheet`, `SessionActionsSheet`) are pinned in their own
// files by Task 213, for the reason Task 11's review recorded: a component
// that only ever exists in its own isolated test file ships missing the
// moment someone drops the line from the screen that mounts it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ArchiveConflictSheet, runOpenRuns } from '../src/fleet/ArchiveConflictSheet';
import { ApiError } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const RUNS = [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }];

describe('runOpenRuns — the ONE reader of the run-open body', () => {
  // It lives beside the sheet, not in either door, because Task 213 wires TWO
  // doors and a reader per door is how the two sentences drift. Its three
  // answers are three different facts and must not collapse into two.
  it('returns the runs for a 409 run-open', () => {
    const err = new ApiError(409, { ok: false, error: 'run-open', runs: RUNS });
    expect(runOpenRuns(err)).toEqual(RUNS);
  });

  it('returns [] — NOT null — for a run-open whose `runs` is missing or malformed', () => {
    // "a run-open refusal we could not read the runs of" is the DEGRADE case;
    // the sheet renders it as the unnamed sentence. `null` would send it to a
    // toast instead, which is the defect this whole task exists to close.
    expect(runOpenRuns(new ApiError(409, { ok: false, error: 'run-open' }))).toEqual([]);
    expect(runOpenRuns(new ApiError(409, { ok: false, error: 'run-open', runs: 'x' }))).toEqual([]);
  });

  it('returns null for anything else — a 502, a 409 with another code, a non-ApiError', () => {
    expect(runOpenRuns(new ApiError(502, { ok: false, stderr: 'busy' }))).toBeNull();
    expect(runOpenRuns(new ApiError(409, { ok: false, error: 'not-merged' }))).toBeNull();
    expect(runOpenRuns(new Error('boom'))).toBeNull();
    expect(runOpenRuns(undefined)).toBeNull();
  });

  it('drops a malformed member rather than passing it to the renderer', () => {
    const err = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }, { id: 'nope' }] });
    expect(runOpenRuns(err)).toEqual(RUNS);
  });
});

describe('ArchiveConflictSheet', () => {
  it('names the run from the body — a measurement, not a guess', () => {
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}} archive={vi.fn()} />);
    expect(screen.getByText(/This workspace is claimed/)).toBeTruthy();
    expect(screen.getByText(/run 17/)).toBeTruthy();
    expect(screen.getByText(/build4/)).toBeTruthy();
    expect(screen.getByText(/wave 2\/3/)).toBeTruthy();
  });

  it('degrades without inventing an id when `runs` is absent', () => {
    render(<ArchiveConflictSheet sessionId="demo-x" runs={null} onClose={() => {}} archive={vi.fn()} />);
    expect(screen.getByText('A run is still open on this workspace')).toBeTruthy();
    expect(screen.queryByText(/run \d+/)).toBeNull();
  });

  it('Archive anyway posts {force:true}', async () => {
    const archive = vi.fn(async () => {});
    const onDone = vi.fn();
    const onClose = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} onDone={onDone}
                                 archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('demo-x', { force: true }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalled();
  });

  it('SURVIVES a further refusal — the property QuickConfirm structurally cannot provide', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    const onClose = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(screen.getByText('ws-archive: busy')).toBeTruthy());
    expect(onClose).not.toHaveBeenCalled();     // still open, refusal rendered INSIDE
  });

  it('renders a 501 as the host-skew sentence, not a slug', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}} archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() =>
      expect(screen.getByText(/does not have this verb yet/)).toBeTruthy());
  });

  it('Open the run hands the id up; Cancel closes without archiving', () => {
    const onOpenRun = vi.fn();
    const onClose = vi.fn();
    const archive = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} onOpenRun={onOpenRun}
                                 archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open the run' }));
    expect(onOpenRun).toHaveBeenCalledWith(17);
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalled();
    expect(archive).not.toHaveBeenCalled();
  });

  it('renders nothing when sessionId is null', () => {
    const { container } = render(
      <ArchiveConflictSheet sessionId={null} runs={RUNS} onClose={() => {}} archive={vi.fn()} />);
    expect(container.textContent).toBe('');
  });
});
