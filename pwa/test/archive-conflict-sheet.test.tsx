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
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import {
  ArchiveConflictSheet, claimedSentence, runOpenRuns, runPhrase,
} from '../src/fleet/ArchiveConflictSheet';
import { ApiError, api } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const RUNS = [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }];

/** The sheet's one injection, named once: `api.archive`'s own shape, so a
 *  deferred fixture is type-checked against the real door rather than cast. */
type ArchiveFn = typeof api.archive;

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

  it('drops a member whose `program` is not a string — the shared validator measures all four fields', () => {
    const err = new ApiError(409, { ok: false, error: 'run-open',
      runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }, { id: 7, program: 5, wave: 1, waveOf: null }] });
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
    const archive = vi.fn(async () => null);
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

  it('renders the archive door\'s typed refusals in words — a forced archive of a busy workspace (workspace lifecycle §5.2)', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'session-busy' }));
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}} archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() =>
      expect(screen.getByText('It is working — archiving now would lose the turn in progress.')).toBeTruthy());
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

// THE BODY THAT IS NOT AN OBJECT. `ApiError.body` is `unknown` — a 409 whose
// payload arrived as text (an HTML error page from a proxy in front of the
// box is the ordinary producer) reaches this parser as a string, and
// `(body as {error?: unknown}).error` on a string is `undefined`, not a
// crash — which is why the guard has to be measured rather than reasoned
// about: without it the function still "works" and the case still returns
// null, so nothing but a test says the guard is load-bearing on the day a
// `.runs` read is added above it.
it('runOpenRuns answers null for a 409 whose body is not an object at all', () => {
  expect(runOpenRuns(new ApiError(409, 'Bad Gateway'))).toBeNull();
  expect(runOpenRuns(new ApiError(409, null))).toBeNull();
});

// The two exported sentence builders, as FUNCTIONS. They are exported because
// two sheets say them (this one and `ArchiveSheet`'s run-open case), and the
// arms a render cannot reach cheaply — a wave with no known total, and more
// than one open run — are exactly the arms the shared spelling exists for.
describe('runPhrase / claimedSentence — the arms the single render cannot reach', () => {
  it('suppresses the wave total when the server did not measure one', () => {
    expect(runPhrase({ id: 17, program: 'build4', wave: 2, waveOf: null }))
      .toBe('run 17 — build4 wave 2');
  });

  it('says `is` for one run and `are` for several, naming every one', () => {
    expect(claimedSentence([{ id: 17, program: 'build4', wave: 2, waveOf: 3 }]))
      .toBe('run 17 — build4 wave 2/3 is still open on this workspace.');
    const two = claimedSentence([
      { id: 17, program: 'build4', wave: 2, waveOf: 3 },
      { id: 18, program: 'build7', wave: 1, waveOf: null },
    ]);
    expect(two).toBe('run 17 — build4 wave 2/3; run 18 — build7 wave 1 are still open on this workspace.');
  });

  it('degrades to the unnamed sentence for an unreadable body, never an empty one', () => {
    expect(claimedSentence(null)).toBe('A run is still open on this workspace');
  });
});

// THE REST OF `archiveErrorText`'s DISPATCH. The three cases above cover 502
// WITH a stderr, 409 with a typed code, and 501; the four arms below had no
// case at all, and each is a different fact about where the archive died. The
// sheet has no toast to defer to, so every one of them must be a sentence or
// the operator watches a button go un-busy and nothing else happen.
describe('a forced archive’s other refusals', () => {
  const refusedWith = (err: unknown): void => {
    render(<ArchiveConflictSheet sessionId="demo-x" runs={RUNS} onClose={() => {}}
                                 archive={vi.fn().mockRejectedValue(err)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
  };

  it('404 — the session is already gone, which is not a failure to apologise for', async () => {
    refusedWith(new ApiError(404, { ok: false, error: 'unknown-session' }));
    expect(await screen.findByText(/that session is gone/i)).toBeInTheDocument();
  });

  it('502 with no stderr says the box failed, rather than printing nothing', async () => {
    refusedWith(new ApiError(502, { ok: false, error: 'ccd-failed' }));
    expect(await screen.findByText('the archive failed on the box')).toBeInTheDocument();
  });

  it('502 whose stderr is only whitespace is the same as none', async () => {
    // The trim is the point: `stderr: '\n'` is a real shape (a verb that
    // wrote a newline and died), and rendering it would leave the operator
    // with a blank line where the reason goes.
    refusedWith(new ApiError(502, { ok: false, error: 'ccd-failed', stderr: '  \n ' }));
    expect(await screen.findByText('the archive failed on the box')).toBeInTheDocument();
  });

  it('a status this build does not dispatch on still lands on the designated unknown', async () => {
    refusedWith(new ApiError(500, { ok: false }));
    expect(await screen.findByText(/a reason this build does not recognise/i)).toBeInTheDocument();
  });

  it('a 409 whose body is not an object reads its code as absent, not as a crash', async () => {
    // `isArchiveRefusal(undefined)` is false, so this falls to the designated
    // unknown — the branch that makes the `typeof` guard on line 120 more
    // than decoration.
    refusedWith(new ApiError(409, 'Conflict'));
    expect(await screen.findByText(/a reason this build does not recognise/i)).toBeInTheDocument();
  });

  it('a rejection that is not an ApiError is still a sentence', async () => {
    refusedWith(new TypeError('Failed to fetch'));
    expect(await screen.findByText(/a reason this build does not recognise/i)).toBeInTheDocument();
  });
});

// THE PER-TARGET GENERATION GUARDS, the pair `ResumeSheet` and `AbandonSheet`
// each carry. This sheet is mounted at screen level too and `sessionId ===
// null` merely renders nothing, so a slow forced archive of `demo-x` can land
// on `demo-y`'s open sheet: the success arm would CLOSE a sheet the operator
// just opened for a different session, and the refusal arm would print
// `demo-x`'s stderr under `demo-y`'s name.
describe('a superseded forced archive cannot act on a different session’s sheet', () => {
  /** The two-session switcher. `demo-y`'s sheet opens over `demo-x`'s
   *  in-flight request, which is the whole shape: one `gen` per target. */
  const Switcher = ({ archive, onDone }: {
    archive: ArchiveFn;
    onDone?: () => void;
  }): ReactNode => {
    const [id, setId] = useState('demo-x');
    return (
      <>
        <button type="button" data-testid="switch" onClick={() => setId('demo-y')}>switch</button>
        <ArchiveConflictSheet sessionId={id} runs={RUNS} onClose={() => {}} onDone={onDone}
                               archive={archive} />
      </>
    );
  };

  it('its SUCCESS neither closes nor reports — the sheet on screen is another session’s', async () => {
    let land!: () => void;
    const onDone = vi.fn();
    const archive: ArchiveFn = vi.fn(() => new Promise<null>((res) => { land = () => res(null); }));
    render(<Switcher archive={archive} onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    fireEvent.click(screen.getByTestId('switch'));
    await act(async () => { land(); await Promise.resolve(); await Promise.resolve(); });

    expect(onDone, "demo-x's archive must not fire the board's cold read for demo-y").not.toHaveBeenCalled();
    // And the button is not left reading "Archiving…" for a request this
    // target never made.
    expect(screen.getByRole('button', { name: 'Archive anyway' })).not.toBeDisabled();
  });

  it('its REFUSAL cannot print one session’s stderr under another’s name', async () => {
    let fail!: () => void;
    const archive: ArchiveFn = vi.fn(() => new Promise<null>((_res, rej) => {
      fail = () => rej(new ApiError(502, { ok: false, error: 'ccd-failed', stderr: 'ws-archive: demo-x is busy' }));
    }));
    render(<Switcher archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    fireEvent.click(screen.getByTestId('switch'));
    await act(async () => { fail(); await Promise.resolve(); await Promise.resolve(); });

    expect(screen.queryByText(/demo-x is busy/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Archive anyway' })).not.toBeDisabled();
  });
});
