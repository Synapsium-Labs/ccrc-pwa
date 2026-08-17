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

  // `waveOf` was the ONE field of four this parser ASSERTED and did not
  // MEASURE, inside a function whose entire job is validating an untrusted
  // body: `ArchiveConflictRun` declares `waveOf: number | null`, so a member
  // that merely omits it satisfied the predicate as `undefined` and reached
  // `runPhrase`, which prints `wave 2/undefined` (its `=== null` test is the
  // only branch that suppresses the suffix). `null` is the LEGITIMATE value —
  // a wave with no known total — so the check must admit it, not require a
  // number.
  it('drops a member whose `waveOf` is neither a number nor null, and KEEPS null', () => {
    const absent = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2 }] });
    expect(runOpenRuns(absent)).toEqual([]);           // degrades, never "wave 2/undefined"

    const wrongType = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2, waveOf: '3' }] });
    expect(runOpenRuns(wrongType)).toEqual([]);

    const nul = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2, waveOf: null }] });
    expect(runOpenRuns(nul)).toEqual([{ id: 17, program: 'build4', wave: 2, waveOf: null }]);
  });

  it('never renders `undefined` as a wave total — the parser is what makes that unreachable', () => {
    const err = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2 }] });
    render(<ArchiveConflictSheet sessionId="demo-x" runs={runOpenRuns(err)} onClose={() => {}}
                                 archive={vi.fn()} />);
    expect(screen.queryByText(/undefined/)).toBeNull();
    expect(screen.getByText('A run is still open on this workspace')).toBeTruthy();
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

  // WAS "Open the run hands the id up; Cancel closes without archiving".
  // The first half went with the affordance (Wave 2 review, Finding 3): the
  // `onOpenRun` button had no call site — neither door passed the prop — so
  // this test was the only thing that ever rendered it. A control reachable
  // solely from its own unit test is coverage of something no operator can
  // reach; see the note on `ArchiveConflictSheetProps` for what a future door
  // would have to bring to add it back. Cancel's half is untouched, and the
  // button count is now pinned so the drop cannot silently regrow.
  it('Cancel closes without archiving, and the sheet offers exactly two buttons', () => {
    const onClose = vi.fn();
    const archive = vi.fn();
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={onClose} archive={archive} />);
    expect(screen.getAllByRole('button').map((b) => b.textContent))
      .toEqual(['Archive anyway', 'Cancel']);
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
