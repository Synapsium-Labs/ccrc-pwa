// The resume door — the three doors a dead coordinator leaves open. Two
// halves, `abandon-sheet.test.tsx`'s own split: `coordPresence` as a TABLE
// (it is the gate, and a gate exercised only through a render is one nobody
// can enumerate), and `ResumeSheet` rendered with INJECTED api functions for
// the copy and the refusals. The row control's own pins live in
// `runs-screen.test.tsx`, beside the board that must not render it.
import { describe, it, expect, afterEach, vi } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { coordPresence } from '../src/fleet/coordWords';
import { ResumeSheet } from '../src/fleet/ResumeSheet';
import { ApiError } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

// RunSummary and FleetSession as PR I / Build 9 actually shipped them —
// copied from `runs-screen.test.tsx` rather than reinvented.
const run = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 3, program: 'build4-transcript-surface', programTitle: 'Build 4: transcript surface',
  wave: 3, waveOf: 4, project: 'ccrc-pwa',
  sessionId: 'ccrc-pwa-clear-cove', workspace: 'clear-cove', branch: 'ws/clear-cove',
  state: 'working', claimedBy: 'ccrc-pwa-coordinator', resumed: false, clearedAt: null,
  openedAt: Date.now() - 1_000_000, dispatchStartedAt: null,
  dispatchedAt: Date.now() - 900_000, closedAt: null,
  handoffCommit: null, items: { done: 3, total: 7 }, unreadMail: 0,
  // F7's per-run health facts. All-clear, deliberately: every case in this file
  // predates the warn row and must keep rendering exactly as it did.
  health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0,
            lastRejectCode: null, briefQueued: true, clearError: null,
            coordKickoffPendingSince: null }, ...over,
});

const sess = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'ccrc-pwa-coordinator', wrapper: 'claude', home: 'claude', project: 'ccrc-pwa',
  workdir: '/w', workspace: null, name: null, status: 'idle', statusUpdatedAt: null,
  limits: null, dialogPending: false, version: null, model: null, effort: null, ultracode: false,
  branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, held: null,
  bucket: 'working', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true,
  spawnState: null, ...over,
});

describe('coordPresence — three answers, because the client cannot measure what the server measures', () => {
  it('answers `dead` for a dead row whose lifecycle never resolves on its own', () => {
    expect(coordPresence('ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: 'orphan' }), true))
      .toBe('dead');
  });

  // Every input that must produce `unknown`, enumerated — the door is HIDDEN
  // on each of these, and a table is the only shape in which "each of them"
  // is a claim rather than a hope.
  const UNKNOWN: readonly [string, string | null, FleetSession | null | undefined, boolean][] = [
    ['the run names no claimant', null, sess({ status: 'dead', lifecycle: 'orphan' }), true],
    ['no fleet frame has landed', 'ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: 'orphan' }), false],
    ['the claimant is missing from the array', 'ccrc-pwa-coordinator', null, true],
    ['the lookup missed (undefined, not null)', 'ccrc-pwa-coordinator', undefined, true],
    ['the lifecycle key never arrived', 'ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: null }), true],
    ['the lifecycle is unmeasurable', 'ccrc-pwa-coordinator', sess({ status: 'dead', lifecycle: 'unmeasurable' }), true],
    ['a substrate fault stands', 'ccrc-pwa-coordinator',
      sess({ status: 'dead', lifecycle: 'orphan', substrate: { at: 1, text: 'tmux: no server running' } }), true],
  ];
  it.each(UNKNOWN)('answers `unknown` when %s', (_why, claimedBy, session, frameSeen) => {
    expect(coordPresence(claimedBy, session, frameSeen)).toBe('unknown');
  });

  // D-309 IS the substrate row above, and it is worth its own name: the
  // server already turned a cannot-ask into `status:'dead'`
  // (`server/src/fleet.ts`), so a door gated on that word alone opens
  // during a tmux outage and offers to hand a LIVE coordinator's program away.
  const ALIVE: readonly [string, FleetSession][] = [
    ['a live pane', sess({ status: 'idle', lifecycle: 'running' })],
    ['a busy pane', sess({ status: 'busy', lifecycle: 'running' })],
    ['a dead pane the supervisor is bringing back', sess({ status: 'dead', lifecycle: 'restarting' })],
    ['a dead pane whose lifecycle resolves itself', sess({ status: 'dead', lifecycle: 'unclaimed' })],
    ['a live pane with a dead-listed lifecycle — status is half the answer, not all of it',
      sess({ status: 'idle', lifecycle: 'orphan' })],
  ];
  it.each(ALIVE)('answers `alive` for %s', (_why, session) => {
    expect(coordPresence('ccrc-pwa-coordinator', session, true)).toBe('alive');
  });
});

const ok = { program: 'build4-transcript-surface', runIds: [1, 2, 3], from: 'ccrc-pwa-coordinator', to: 'ccrc-pwa-far-mesa' };
const noop = { ensure: async () => {}, kickoff: async () => ({ queued: true }), reclaimRun: async () => ok };

describe('ResumeSheet — the three doors, in order', () => {
  it('names the dead claimant, the run and the wave, and offers Revive first', () => {
    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} />);
    // `/ccrc-pwa-coordinator/` alone matches TWO elements here — the
    // consequence line and the Revive button's own label, which names the
    // session it would revive. Anchoring on the consequence line is
    // `abandon-sheet.test.tsx`'s own answer to the identical ambiguity
    // (`/^Abandon run 7 —/`), and it is the stronger assertion besides: the
    // sentence has to name the claimant, not merely the button.
    const said = screen.getByText(/claims run 3/);
    expect(said).toHaveTextContent('ccrc-pwa-coordinator');
    expect(said).toHaveTextContent('wave 3');
    // …and the button names it too, which is the second cue.
    expect(screen.getByRole('button', { name: /^revive ccrc-pwa-coordinator$/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^revive/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^re-kickoff$/i })).toBeInTheDocument();
  });

  // The third door is REVEALED, not offered: reclaiming rewrites `claimedBy`
  // on every run of the program (contract R1), and it is the only one of the
  // three that cannot be undone by waiting.
  it('hides the reclaim field until Revive has been tried', () => {
    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} />);
    expect(screen.queryByLabelText(/hand run 3/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /^reclaim$/i })).toBeNull();
  });

  it('reveals it once Revive has been tried, even when the revive SUCCEEDED', async () => {
    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} />);
    fireEvent.click(screen.getByRole('button', { name: /^revive/i }));
    expect(await screen.findByLabelText(/hand run 3/i)).toBeInTheDocument();
  });

  it('reveals it on the explicit door too, without a revive attempt', async () => {
    const ensure = vi.fn(async () => {});
    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} ensure={ensure} />);
    fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
    expect(await screen.findByLabelText(/hand run 3/i)).toBeInTheDocument();
    expect(ensure).not.toHaveBeenCalled();
  });

  it('sends the run and the wave with the re-kickoff, never a bare program', async () => {
    const kickoff = vi.fn(async () => ({ queued: true }));
    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} kickoff={kickoff} />);
    fireEvent.click(screen.getByRole('button', { name: /^re-kickoff$/i }));
    await waitFor(() => expect(kickoff).toHaveBeenCalled());
    expect(kickoff.mock.calls[0]).toEqual(['ccrc-pwa-coordinator', {
      slug: 'build4-transcript-surface', title: 'Build 4: transcript surface', runId: 3, wave: 3,
    }]);
  });

  // `queued:false` is not a failure and not the same sentence: the operator
  // standing at the board has to know whether THIS tap put something in the
  // queue or found one already there. The FOLD stays folded on purpose (the
  // contract's own decision, D-1132) — the sentence says "a kickoff", never
  // "this program's kickoff", because no store read can tell the two apart.
  it('says something DIFFERENT when a kickoff was already waiting', async () => {
    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} kickoff={async () => ({ queued: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /^re-kickoff$/i }));
    const queued = (await screen.findByText(/queued/i)).textContent ?? '';
    cleanup();

    render(<ResumeSheet run={run()} onClose={() => {}} {...noop} kickoff={async () => ({ queued: false })} />);
    fireEvent.click(screen.getByRole('button', { name: /^re-kickoff$/i }));
    const already = (await screen.findByText(/already waiting/i)).textContent ?? '';

    expect(already).not.toBe(queued);
    expect(already).toMatch(/has not been read/i);
    // …and it must not claim a second kickoff was queued.
    expect(already).toMatch(/nothing new was queued/i);
  });
});

// Each refusal renders its OWN sentence INLINE and the sheet stays open: the
// shape `AbandonSheet` was moved off `QuickConfirm` to get (`AbandonSheet.tsx`
// — `QuickConfirm` closes on every tap, win or lose).
describe('ResumeSheet — the reclaim refusals, each with its own sentence', () => {
  const reclaimFailing = (err: unknown) => {
    const onClose = vi.fn();
    render(<ResumeSheet run={run()} onClose={onClose} {...noop}
                        reclaimRun={vi.fn().mockRejectedValue(err)} />);
    fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
    fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
    fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
    return onClose;
  };

  it('404 unknown-run — that run is gone', async () => {
    const onClose = reclaimFailing(new ApiError(404, { ok: false, error: 'unknown-run' }));
    expect(await screen.findByText(/that run is gone/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /^reclaim$/i })).not.toBeDisabled();
  });

  // TWO conditions at ONE status, and they have opposite remedies: the run is
  // gone (nothing to do) versus the id you TYPED has no registry row (type a
  // different one). Collapsing them onto one sentence is the overloaded null
  // this repo bans, one layer up.
  it('404 unknown-session — the id typed here, not the run', async () => {
    reclaimFailing(new ApiError(404, { ok: false, error: 'unknown-session' }));
    expect(await screen.findByText(/no registry row for that id/i)).toBeInTheDocument();
    expect(screen.queryByText(/that run is gone/i)).toBeNull();
  });

  it('409 no-claimant — nobody holds this run', async () => {
    reclaimFailing(new ApiError(409, { ok: false, refused: 'no-claimant' }));
    expect(await screen.findByText(/nobody claims this run/i)).toBeInTheDocument();
  });

  // The refusal that matters most, because it is the door refusing to do
  // harm: `by` and `detail` are what make it a MEASUREMENT rather than a
  // guess, and the server cannot recompute them for the client (D-1139).
  it('409 claimant-alive — names WHO, and repeats the evidence verbatim', async () => {
    reclaimFailing(new ApiError(409, {
      ok: false, refused: 'claimant-alive', by: 'ccrc-pwa-coordinator',
      detail: 'the supervisor is restarting it',
    }));
    const said = (await screen.findByText(/is not dead/i)).textContent ?? '';
    expect(said).toContain('ccrc-pwa-coordinator');
    expect(said).toContain('the supervisor is restarting it');
  });

  it('502 registry-unmeasurable — the box could not look, and says the box could not look', async () => {
    reclaimFailing(new ApiError(502, {
      ok: false, error: 'registry-unmeasurable', detail: 'the registry directory could not be listed',
    }));
    expect(await screen.findByText(/the registry directory could not be listed/i)).toBeInTheDocument();
  });

  it('501 not-configured — this box runs no coordination at all', async () => {
    reclaimFailing(new ApiError(501, { ok: false, error: 'not-configured' }));
    expect(await screen.findByText(/does not run coordination/i)).toBeInTheDocument();
  });

  it('400 bad-request — the id was refused by the box, not by this sheet', async () => {
    reclaimFailing(new ApiError(400, { ok: false, error: 'bad-request' }));
    expect(await screen.findByText(/not one this box will accept/i)).toBeInTheDocument();
  });

  // The total map's designated member. A refusal shape this build has never
  // heard of is real traffic, not a fixture — `RUN_WORD.unknown`'s discipline
  // (`runWords.ts`), never a blank sheet and never a crash.
  it('a shape this build has never heard of lands on the designated unknown', async () => {
    reclaimFailing(new ApiError(418, { ok: false, error: 'teapot' }));
    expect(await screen.findByText(/this build does not recognise/i)).toBeInTheDocument();
  });

  it('a reclaim that SUCCEEDS closes the sheet and re-fires the board’s cold read', async () => {
    const onClose = vi.fn();
    const onDone = vi.fn();
    render(<ResumeSheet run={run()} onClose={onClose} onDone={onDone} {...noop} />);
    fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
    fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
    fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(onDone).toHaveBeenCalled();
  });
});

// The `Harness` is not optional and not cosmetic: `ResumeSheet` is mounted
// UNCONDITIONALLY at screen level and `run === null` merely renders nothing, so
// neither bug is reachable by rendering the sheet once with a fixed `run`
// (`abandon-sheet.test.tsx` states exactly this for its own sheet).
function Harness({
  reclaimRun, onDone,
}: {
  reclaimRun: (id: number, claimedBy: string) => Promise<typeof ok>;
  onDone?: () => void;
}): ReactNode {
  const [target, setTarget] = useState<RunSummary | null>(run());
  return (
    <>
      <button type="button" onClick={() => setTarget(run({ id: 7, program: 'far-mesa-program' }))}>
        open run 7
      </button>
      <ResumeSheet run={target} onClose={() => setTarget(null)} onDone={onDone}
                   ensure={async () => {}} kickoff={async () => ({ queued: true })}
                   reclaimRun={reclaimRun} />
    </>
  );
}

describe('per-target state — the two bugs AbandonSheet measured, on this sheet', () => {
  it("clears a previous run's refusal, and its revealed field, when a different run's sheet opens", async () => {
    render(<Harness reclaimRun={vi.fn().mockRejectedValue(new ApiError(404, { ok: false, error: 'unknown-run' }))} />);
    fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
    fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
    fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
    expect(await screen.findByText(/that run is gone/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));
    fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));

    // Run 7's sheet must not open showing run 3's refusal, and must not open
    // with the third door already unlocked and a stale id in the field.
    expect(await screen.findByText(/claims run 7/)).toBeInTheDocument();
    expect(screen.queryByText(/that run is gone/i)).toBeNull();
    expect(screen.queryByLabelText(/hand run 7/i)).toBeNull();
  });

  it("a superseded in-flight reclaim cannot close or write into a different run's now-open sheet", async () => {
    let resolveRun3: (() => void) | null = null;
    const reclaimRun = vi.fn((id: number) => {
      if (id === 3) return new Promise<typeof ok>((resolve) => { resolveRun3 = () => resolve(ok); });
      return Promise.resolve(ok);
    });
    const onDone = vi.fn();
    render(<Harness reclaimRun={reclaimRun} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
    fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
    fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
    expect(await screen.findByText(/handing over…/i)).toBeInTheDocument();

    // Dismissed via the SCRIM, not the (disabled-while-busy) Cancel button —
    // the path the AbandonSheet review found ungated on `busy`
    // (`components/Sheet.tsx`, `Drawer.Root onOpenChange`).
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    // vaul's dismissal is not always synchronous with the click; wait for the
    // first sheet to be really gone before opening the second, so a delayed
    // vaul callback is not racing the second mount (a jsdom/vaul artifact,
    // not the behaviour under test — `abandon-sheet.test.tsx`).
    await waitFor(() => expect(screen.queryByRole('button', { name: /^re-kickoff$/i })).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));
    expect(await screen.findByText(/claims run 7/)).toBeInTheDocument();
    // Not stuck reading "Handing over…" for a request it never made.
    expect(screen.getByRole('button', { name: /^re-kickoff$/i })).not.toBeDisabled();

    resolveRun3!();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.getByText(/claims run 7/)).toBeInTheDocument();
  });

  // MEASURED HOLE, closed here. The case above only ever exercises the RESOLVE
  // arm, so `reclaim`'s REJECT-arm `gen` guard had no killer at all: deleting
  // it left this file 30/30 green. The two arms are two guards — a late
  // REFUSAL writing run 3's sentence into run 7's open sheet is the first of
  // `AbandonSheet`'s two measured bugs, and it is the arm the fixture above
  // cannot reach.
  it("a superseded in-flight reclaim's REFUSAL cannot write into a different run's now-open sheet", async () => {
    let rejectRun3: (() => void) | null = null;
    const reclaimRun = vi.fn((id: number) => {
      if (id === 3) {
        return new Promise<typeof ok>((_resolve, reject) => {
          rejectRun3 = () => reject(new ApiError(404, { ok: false, error: 'unknown-run' }));
        });
      }
      return Promise.resolve(ok);
    });
    render(<Harness reclaimRun={reclaimRun} />);

    fireEvent.click(screen.getByRole('button', { name: /cannot be revived/i }));
    fireEvent.change(screen.getByLabelText(/hand run 3/i), { target: { value: 'ccrc-pwa-far-mesa' } });
    fireEvent.click(screen.getByRole('button', { name: /^reclaim$/i }));
    expect(await screen.findByText(/handing over…/i)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('sheet-overlay'));
    await waitFor(() => expect(screen.queryByRole('button', { name: /^re-kickoff$/i })).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: /open run 7/i }));
    expect(await screen.findByText(/claims run 7/)).toBeInTheDocument();

    rejectRun3!();
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    // Run 3's refusal must not land in run 7's sheet, and run 7's sheet must
    // not be left disabled by a request it never made.
    expect(screen.queryByText(/that run is gone/i)).toBeNull();
    expect(screen.getByRole('button', { name: /^re-kickoff$/i })).not.toBeDisabled();
  });
});
