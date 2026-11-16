// The ONE "Archive" (workspace lifecycle spec §5.2): the confirm by case, each consent a second tap after the words
// that ask for it, the server's refusals answered inside the sheet, and "Stop only" where — and only where — the
// caller asks for it. Rendered directly with an INJECTED `archive` (`ArchiveConflictSheet`'s idiom).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useState } from 'react';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession, RunSummary } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { ToastHost } from '@ccrc/ui';
import { ArchiveSheet, type ArchiveSheetProps } from '../src/fleet/ArchiveSheet';
import { createFleetStore } from '../src/stores/fleet';
import { ApiError, type api } from '../src/lib/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const s = (over: Partial<FleetSession> = {}): FleetSession => (fleetSession({ id: 'demo-amber', workdir: '/w/demo/amber', workspace: 'amber', ...over }));
const RUN7 = { id: 7, program: 'lifecycle', wave: 1, waveOf: 3 };
const RUN8 = { id: 8, program: 'lifecycle', wave: 2, waveOf: 3 };
const claimedRun = (r: typeof RUN7, state: RunSummary['state'] = 'working'): RunSummary =>
  ({ ...r, state, claimedBy: 'demo-amber', sessionId: 'demo-worker' }) as unknown as RunSummary;

type Archive = typeof api.archive;
const mount = (session: FleetSession, o: {
  archive: Archive; onStopOnly?: (id: string, body?: unknown) => unknown; runs?: RunSummary[]; onArchived?: () => void;
  sessions?: FleetSession[];
}) => {
  const fleet = createFleetStore();
  if (o.runs) act(() => { fleet.setState({ runs: o.runs! }); });
  if (o.sessions) act(() => { fleet.setState({ sessions: o.sessions!, fleetFrameSeen: true }); });
  const onClose = vi.fn();
  const view = render(
    <>
      <ArchiveSheet session={session} open onClose={onClose} archive={o.archive} fleet={fleet}
        onStopOnly={o.onStopOnly as ArchiveSheetProps['onStopOnly']} onArchived={o.onArchived} />
      <ToastHost />
    </>,
  );
  return { onClose, view, fleet };
};
const refusal = (body: Record<string, unknown>, status = 409) => new ApiError(status, { ok: false, ...body });
const buttons = (): string[] => screen.getAllByRole('button').map((b) => b.textContent ?? '');
/** D-8199: ending the programme is one of the coordinator question's three answers — picked, then confirmed. */
const endProgramme = async (): Promise<void> => {
  fireEvent.click(await screen.findByRole('button', { name: 'End programme' }));
  fireEvent.click(await screen.findByRole('button', { name: 'End programme and archive' }));
};

describe('the confirm reads by case', () => {
  it('an idle workspace: its words, and Archive sends the plain call', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    const onArchived = vi.fn();
    const { onClose } = mount(s(), { archive, onArchived });
    expect(screen.getByText('Archive this workspace?')).toBeInTheDocument();
    // True before and after the operator arms the expiry lane, under the cleanup pause, and on an older box (review 313,
    // parked item 2): the promise is conditional, as README and the skill already say it.
    expect(screen.getByText('It goes offline and folds into Archived. Restore brings it back; once automatic cleanup is on, '
      + 'it is cleaned up seven days after its archive.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(archive).toHaveBeenCalledWith('demo-amber', {});
    expect(onArchived).toHaveBeenCalledOnce();
  });

  it('a main checkout: it is never deleted, and Restore starts it again', () => {
    mount(s({ id: 'claude-demo', workspace: null }), { archive: vi.fn() as unknown as Archive });
    expect(screen.getByText('Archive this session?')).toBeInTheDocument();
    expect(screen.getByText('It goes offline and folds into Archived. Restore starts it again. It is never deleted.'))
      .toBeInTheDocument();
  });

  it('busy, either kind: the turn is lost — and only "Archive anyway" sends `interrupt`', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    mount(s({ id: 'claude-demo', workspace: null, status: 'busy', bucket: 'working' }), { archive });
    expect(screen.getByText("It's working. Archive anyway?")).toBeInTheDocument();
    expect(screen.getByText('The turn in progress is lost.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('claude-demo', { interrupt: true }));
  });

  it('a coordinator with open runs (L5, D-8199): it lists them and asks Release, Hand over or End programme — nothing is sent on the first tap', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7), claimedRun(RUN8), claimedRun({ ...RUN7, id: 6 }, 'done')] });
    expect(screen.getByText('It coordinates 2 open runs. What happens to them?')).toBeInTheDocument();
    expect(screen.getByText('run 7 — lifecycle wave 1/3; run 8 — lifecycle wave 2/3.')).toBeInTheDocument();
    expect(buttons()).toEqual(['Release runs', 'Hand over', 'End programme', 'Cancel']);
    await endProgramme();
    await waitFor(() => expect(archive).toHaveBeenCalledWith('demo-amber', { programme: 'end' }));
    expect(screen.getByText(/coordinator pause switch under Advanced on the Runs screen/)).toBeInTheDocument();
  });
});

describe('the server re-reads, and its refusal turns the sheet', () => {
  it('found busy after all: the busy words, then `interrupt`', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'session-busy' }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("It's working. Archive anyway?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { interrupt: true }));
  });

  it('found coordinating: L5 with the server\'s runs, and the consent already given rides along', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [RUN7] }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s({ status: 'busy', bucket: 'working' }), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText('It coordinates 1 open run. What happens to them?')).toBeInTheDocument();
    expect(screen.getByText('run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
    await endProgramme();
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { interrupt: true, programme: 'end' }));
  });

  // `runsOf` reads every run-bearing member of a refusal body through `isArchiveConflictRun`, the one validator
  // `runOpenRuns` shares. Dropping that filter here, or its `program` check there, lets a member this build cannot read
  // reach `runPhrase` — "undefined" on screen, or a throw on a `null`.
  it('a malformed member of `runs` is dropped by the shared validator — only the readable run is named', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs',
      runs: [RUN7, { id: 9, program: 5, wave: 1, waveOf: null }, null] })) as unknown as Archive;
    mount(s({ status: 'busy', bucket: 'working' }), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText('It coordinates 1 open run. What happens to them?')).toBeInTheDocument();
    expect(screen.getByText('run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
    expect(screen.queryByText(/run 9/)).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/undefined|null/);
  });

  it('claimed by a run (`run-open`): the claimed words, and "Archive anyway" sends `force`', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'run-open', runs: [RUN7] }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('run 7 — lifecycle wave 1/3 is still open on this workspace.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { force: true }));
  });

  it('coordinator runs it could not read: refused, nothing to consent to — and where Stop only is', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [] })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/could not read them, so it will not archive it/)).toBeInTheDocument();
    expect(screen.getByText("Stop only is in this session's actions sheet on the board.")).toBeInTheDocument();
    expect(buttons()).toEqual(['Close']);
  });

  it('a partly ended programme says what ended, what did not and why, and that nothing else happened', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'programme-partly-ended', closed: [RUN7],
      notClosed: [RUN8], refusal: { id: 8, kind: 'bad-transition', detail: 'closing → closing' } })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7), claimedRun(RUN8)] });
    await endProgramme();
    expect(await screen.findByText('The programme was only partly ended')).toBeInTheDocument();
    expect(screen.getByText('Ended: run 7 — lifecycle wave 1/3. Still open: run 8 — lifecycle wave 2/3. '
      + 'Run 8 could not be ended (bad-transition: closing → closing). Nothing was stopped or archived.')).toBeInTheDocument();
  });

  it('a failure with no word stays on the sheet, in the server\'s own words', async () => {
    const archive = vi.fn().mockRejectedValueOnce(new ApiError(502, { ok: false, stderr: 'ccd: no such session' })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('ccd: no such session')).toBeInTheDocument();
    expect(screen.getByText('Archive this workspace?')).toBeInTheDocument();
  });
});

describe('"Stop only" — after a refusal the phone cannot fix, and only where the caller asks', () => {
  it.each(['worktree-gone', 'status-unknown', 'manifest-unbuildable'])('offered after %s, and it stops', async (code) => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: code })) as unknown as Archive;
    const onStopOnly = vi.fn();
    const { onClose } = mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
    // D-8199: the sheet awaits the stop's answer (its refusal may turn it to the question), then closes.
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  // The only stop control left in the PWA carries the gate the header's "Stop session" had (spec §4, stop is
  // destructive during an outage): disabled with the chip's own title while tmux cannot be reached, and inert.
  it('under a substrate fault Stop only is disabled, names the fault, and never fires', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone' })) as unknown as Archive;
    const onStopOnly = vi.fn();
    const { view, fleet, onClose } = mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByRole('button', { name: 'Stop only' })).toBeEnabled();
    view.rerender(
      <ArchiveSheet session={s({ substrate: { at: 1, text: 'x' } })} open onClose={onClose} archive={archive}
        fleet={fleet} onStopOnly={onStopOnly} />,
    );
    const btn = screen.getByRole('button', { name: 'Stop only' });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toBe('tmux unreachable — x');
    fireEvent.click(btn);
    expect(onStopOnly).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('never offered where the caller does not ask for it — the sheet says where it is, and offers no button', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone' })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("Couldn't archive")).toBeInTheDocument();
    expect(screen.getByText("Stop only is in this session's actions sheet on the board.")).toBeInTheDocument();
    expect(buttons()).toEqual(['Close']);
  });

  it('offered after a store this box could not read — every consent is refused there, and the phone cannot fix it', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [] })) as unknown as Archive;
    const onStopOnly = vi.fn();
    mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/could not read them, so it will not archive it/)).toBeInTheDocument();
    expect(buttons()).toEqual(['Stop only', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
  });

  it('offered after a programme it could not end — and, the session still claiming a run, it asks first (D-8199)', async () => {
    const onStopOnly = vi.fn();
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'programme-partly-ended', closed: [],
      notClosed: [RUN7], refusal: { id: 7, kind: 'bad-transition', detail: 'closing → closing' } })) as unknown as Archive;
    mount(s(), { archive, onStopOnly, runs: [claimedRun(RUN7, 'closing')] });
    await endProgramme();
    expect(await screen.findByText('The programme was only partly ended')).toBeInTheDocument();
    expect(buttons()).toEqual(['Stop only', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).not.toHaveBeenCalled();
    expect(screen.getByText('It coordinates 1 open run. What happens to them?')).toBeInTheDocument();
    // A stop never ends a programme: Release or Hand over only.
    expect(buttons()).toEqual(['Release runs', 'Hand over', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    expect(screen.getByText('Release its run and stop?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release and stop' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber', { runs: 'release' });
  });

  it('offered after `501 unsupported` — a box whose ccd has no ws-archive refuses every retry until it is updated', async () => {
    const onStopOnly = vi.fn();
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'unsupported' }, 501)) as unknown as Archive;
    mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("Couldn't archive")).toBeInTheDocument();
    expect(screen.getByText('The fleet host is running a ccd that does not have this verb yet.')).toBeInTheDocument();
    expect(buttons()).toEqual(['Stop only', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
  });

  it('never offered after a refusal the phone CAN answer — a busy session asks for `interrupt` instead', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'session-busy' })) as unknown as Archive;
    mount(s(), { archive, onStopOnly: vi.fn() });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText("It's working. Archive anyway?")).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stop only' })).not.toBeInTheDocument();
    expect(screen.queryByText("Stop only is in this session's actions sheet on the board.")).not.toBeInTheDocument();
  });
});

describe('the outcome', () => {
  it('stopped but not archived: a toast says so and that Archive is still offered; the row is not called archived', async () => {
    const archive = vi.fn(async () => ({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
      detail: 'ccd: status-unknown' })) as unknown as Archive;
    const onArchived = vi.fn();
    mount(s({ status: 'busy', bucket: 'working' }), { archive, onArchived });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText('Stopped, but not archived — Its status cannot be read, so it will not be archived on a guess. '
      + 'Archive is still offered on its row.')).toBeInTheDocument();
    expect(onArchived).not.toHaveBeenCalled();
  });

  it('a refusal AFTER the programme was ended says the programme was ended — then the refusal, then Stop only', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone', detail: 'ccd: worktree is gone: /w',
      ended: [RUN7] })) as unknown as Archive;
    mount(s(), { archive, onStopOnly: vi.fn(), runs: [claimedRun(RUN7)] });
    await endProgramme();
    expect(await screen.findByText('Its programme was ended first: run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
    expect(screen.getByText("Couldn't archive")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stop only' })).toBeInTheDocument();
  });

  it('stopped but not archived after the programme was ended: the toast says both', async () => {
    const archive = vi.fn(async () => ({ ok: true, archived: false, stopped: true, ended: [RUN7], refusal: 'manifest-unbuildable',
      detail: 'ccd: cannot describe demo-amber truthfully — nothing was touched' })) as unknown as Archive;
    mount(s({ status: 'busy', bucket: 'working' }), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText(/^Its programme was ended \(run 7 — lifecycle wave 1\/3\)\. Stopped, but not archived/))
      .toBeInTheDocument();
  });

  it('a programme ended on an EARLIER send is still named when a later send stops but does not archive', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'session-busy', detail: 'ccd: session-busy', ended: [RUN7] }))
      .mockResolvedValueOnce({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
        detail: 'ccd: status-unknown' }) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    await endProgramme();
    fireEvent.click(await screen.findByRole('button', { name: 'Archive anyway' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { interrupt: true, programme: 'end' }));
    expect(await screen.findByText(/^Its programme was ended \(run 7 — lifecycle wave 1\/3\)\. Stopped, but not archived/))
      .toBeInTheDocument();
  });

  it('a fault landing under the open sheet blocks the send and names it', async () => {
    const archive = vi.fn() as unknown as Archive;
    const { view, fleet } = mount(s(), { archive });
    view.rerender(
      <ArchiveSheet session={s({ substrate: { at: 1, text: 'x' } })} open onClose={() => {}} archive={archive} fleet={fleet} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('tmux unreachable — x')).toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();
  });
});

// THE DEGRADE ARMS. Every case above sends a body the route promises; these
// send what a box under load and a proxy in front of it produce — and each
// had no case (measured: statements 148, 166, 181 and branches 76#1, 83#1,
// 87#1, 88#1, 91#1, 170#1, 171#0/1, 183#1, 185#1, 252#1 uncovered with this
// file 34/34 green).
describe('the shapes a well-formed fixture never sends', () => {
  it('a `run-open` whose `runs` we could not read still names the condition', () => {
    // `[]` is the DEGRADE case, not `null`: the sheet opens and says a run is
    // still open, naming none. Inventing an id would be worse, and sending
    // this to a toast — which is what a `null` would do — would leave the
    // operator with a bare slug and no door.
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'run-open', runs: 'not-an-array' })) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    return waitFor(() => {
      expect(screen.getByText('A run is still open on this workspace')).toBeInTheDocument();
      expect(screen.queryByText(/run \d+/), 'an id was invented').toBeNull();
    });
  });

  it('a partly-ended body with nothing readable in it still says what did NOT happen', async () => {
    // Three absences at once: no `closed`, no `notClosed`, no `refusal`. The
    // one claim that survives is the one that matters — nothing was stopped
    // or archived — and the sentence must not silently become "Ended: ."
    const archive = vi.fn().mockRejectedValueOnce(
      refusal({ error: 'programme-partly-ended' })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    await endProgramme();
    expect(await screen.findByText('No run was ended. Nothing was stopped or archived.')).toBeInTheDocument();
  });

  it('a partly-ended body that is not an object at all is read the same way', async () => {
    const archive = vi.fn().mockRejectedValueOnce(
      new ApiError(409, 'programme-partly-ended')) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    await endProgramme();
    // A body that is not an object carries no `error` either, so there is no
    // partly-ended sentence to say — and the sheet must stay on its confirm
    // rather than turn into a titled refusal with an empty body.
    await waitFor(() =>
      expect(screen.getByText('End its programme and archive?')).toBeInTheDocument());
    expect(screen.queryByText('The programme was only partly ended')).toBeNull();
  });

  it('a partly-ended `refusal` with no id or kind drops the clause, never prints undefined', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({
      error: 'programme-partly-ended', closed: [RUN7], refusal: { detail: 'something' },
    })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    await endProgramme();
    const said = await screen.findByText(/Ended: run 7/);
    expect(said.textContent).not.toMatch(/undefined|could not be ended/);
  });

  it('a partly-ended `refusal` with no detail names the run and the kind alone', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({
      error: 'programme-partly-ended', notClosed: [RUN8], refusal: { id: 8, kind: 'claimed' },
    })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    await endProgramme();
    const said = await screen.findByText(/Still open: run 8/);
    expect(said.textContent).toContain('Run 8 could not be ended (claimed).');
    expect(said.textContent).not.toMatch(/undefined/);
  });

  it('a rejection that is not an ApiError leaves the sheet open, with no invented ended list', async () => {
    // `fetch` rejecting with a `TypeError` when the box goes away. The two
    // reads it skips are the refusal CODE and the `ended` runs — and claiming
    // runs were ended by a request that never arrived is the damaging one.
    const archive = vi.fn().mockRejectedValueOnce(new TypeError('Failed to fetch')) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(screen.getByText('Archive this workspace?')).toBeInTheDocument());
    expect(screen.queryByText(/programme was ended/i)).toBeNull();
  });

  it('a 2xx `archived: false` with no refusal word and no detail still says it was not archived', async () => {
    // Two absences on the SUCCESS arm: a partial answer that names neither
    // the refusal nor a detail. The toast is the only thing the operator
    // gets — a blank one would read as a successful archive.
    const archive = vi.fn(async () => ({ ok: true, archived: false })) as unknown as Archive;
    const onArchived = vi.fn();
    mount(s(), { archive, onArchived });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText(/Stopped, but not archived — the archive was refused\./))
      .toBeInTheDocument();
    expect(onArchived, 'a row that was not archived must not be called archived').not.toHaveBeenCalled();
  });

  it('a second tap while the first is in flight sends nothing', async () => {
    // The `busy` guard. Both buttons are disabled while sending, but the
    // scrim is not — and a sheet dismissed and reopened by the row would
    // otherwise fire a second archive for a request still running.
    let land!: () => void;
    const archive = vi.fn(() => new Promise<null>((res) => { land = () => res(null); })) as unknown as Archive;
    mount(s(), { archive });
    const button = screen.getByRole('button', { name: 'Archive' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(archive).toHaveBeenCalledTimes(1);
    await act(async () => { land(); await Promise.resolve(); });
  });
});

describe('a superseded archive cannot act on the sheet that is up now', () => {
  /** The sheet is mounted at screen level and `open=false` renders nothing, so
   *  a slow archive of one row can land while another row's sheet is up. */
  const Switcher = ({ archive }: { archive: Archive }): ReactNode => {
    const [row, setRow] = useState(s());
    const fleet = createFleetStore();
    return (
      <>
        <button type="button" data-testid="switch"
                onClick={() => setRow(s({ id: 'demo-other', workspace: 'other' }))}>
          switch
        </button>
        <ArchiveSheet session={row} open onClose={() => {}} archive={archive} fleet={fleet} />
        <ToastHost />
      </>
    );
  };

  it('its SUCCESS does not toast or close over another row', async () => {
    let land!: () => void;
    const archive = vi.fn(() => new Promise<{ ok: true; archived: false }>((res) => {
      land = () => res({ ok: true, archived: false });
    })) as unknown as Archive;
    render(<Switcher archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByTestId('switch'));
    await act(async () => { land(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText(/Stopped, but not archived/),
      "one row's partial answer surfaced over another row").toBeNull();
  });

  it('its REFUSAL does not turn the sheet that is up now', async () => {
    let fail!: () => void;
    const archive = vi.fn(() => new Promise<null>((_res, rej) => {
      fail = () => rej(refusal({ error: 'session-busy' }));
    })) as unknown as Archive;
    render(<Switcher archive={archive} />);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(screen.getByTestId('switch'));
    await act(async () => { fail(); await Promise.resolve(); await Promise.resolve(); });
    expect(screen.queryByText("It's working. Archive anyway?"),
      "one row's refusal turned another row's sheet").toBeNull();
  });
});

describe('the coordinator question (D-8199): Release or Hand over, one tap then confirm', () => {
  const HEIR = fleetSession({ id: 'demo-heir', name: 'heir', project: 'demo', workdir: '/w/demo/heir', workspace: 'heir',
    role: 'coordinator' });
  const runs = [claimedRun(RUN7), claimedRun(RUN8)];

  it('Release: the first tap says what it does, the second sends `runs: "release"`', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    const { onClose } = mount(s(), { archive, runs });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    expect(archive).not.toHaveBeenCalled();
    expect(screen.getByText('Release its 2 runs and archive?')).toBeInTheDocument();
    expect(screen.getByText(/They stay open, claimed by nobody\. Nothing is ended/)).toBeInTheDocument();
    expect(buttons()).toEqual(['Release and archive', 'Back', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('demo-amber', { runs: 'release' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('Hand over: the picker lists the project\'s live coordinators, never the session itself; the confirm sends the heir', async () => {
    const archive = vi.fn(async () => null) as unknown as Archive;
    const self = s({ role: 'coordinator' });
    mount(self, { archive, runs, sessions: [self, HEIR] });
    expect(screen.getByRole('button', { name: 'Hand over' })).toBeDisabled();
    const picker = screen.getByRole('combobox', { name: 'Hand over to' });
    expect([...picker.querySelectorAll('option')].map((o) => o.value)).toEqual(['', 'demo-heir']);
    fireEvent.change(picker, { target: { value: 'demo-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to heir' }));
    expect(screen.getByText('Hand its 2 runs to heir and archive?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hand over and archive' }));
    await waitFor(() => expect(archive).toHaveBeenCalledWith('demo-amber', { runs: 'handover', heir: 'demo-heir' }));
  });

  it('with no live coordinator to take them, Hand over stays off and the sheet says why', () => {
    mount(s(), { archive: vi.fn() as unknown as Archive, runs, sessions: [fleetSession({ id: 'demo-heir', project: 'demo', workdir: '/w/demo/heir', workspace: 'heir', role: 'coordinator',
      status: 'dead' })] });
    expect(screen.queryByRole('combobox')).toBeNull();
    expect(screen.getByText('No other live coordinator of demo to hand them to.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hand over' })).toBeDisabled();
  });

  it('Back returns to the question, and nothing was sent', () => {
    const archive = vi.fn() as unknown as Archive;
    mount(s(), { archive, runs });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(screen.getByText('It coordinates 2 open runs. What happens to them?')).toBeInTheDocument();
    expect(archive).not.toHaveBeenCalled();
  });

  it('found coordinating by the server: its runs, then the question', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [RUN7] }))
      .mockResolvedValueOnce(null) as unknown as Archive;
    mount(s(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    expect(await screen.findByText('It coordinates 1 open run. What happens to them?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    await waitFor(() => expect(archive).toHaveBeenLastCalledWith('demo-amber', { runs: 'release' }));
  });

  it('a refused move (`claims-not-moved`) returns to the question with the reason, and nothing was stopped or archived', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'claims-not-moved', moved: [], notMoved: [RUN7, RUN8],
      refusal: { kind: 'heir-not-live', detail: 'its pane is gone (the lifecycle reads stopped)' } })) as unknown as Archive;
    const self = s({ role: 'coordinator' });
    mount(self, { archive, runs, sessions: [self, HEIR] });
    fireEvent.change(screen.getByRole('combobox', { name: 'Hand over to' }), { target: { value: 'demo-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to heir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand over and archive' }));
    expect(await screen.findByText('Its runs could not be moved: that coordinator is not live '
      + '(its pane is gone (the lifecycle reads stopped)). Nothing was stopped or archived.')).toBeInTheDocument();
    expect(screen.getByText('It coordinates 2 open runs. What happens to them?')).toBeInTheDocument();
  });

  it('Stop only on a session that claims runs hands the choice to the stop, never ending the programme', async () => {
    const onStopOnly = vi.fn();
    // "Stop only" is offered after a refusal the phone cannot fix; the frame says the session claims runs.
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'status-unknown' })) as unknown as Archive;
    const self = s({ role: 'coordinator' });
    mount(self, { archive, onStopOnly, runs, sessions: [self, HEIR] });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).not.toHaveBeenCalled();
    expect(buttons()).toEqual(['Release runs', 'Hand over', 'Cancel']);
    fireEvent.change(screen.getByRole('combobox', { name: 'Hand over to' }), { target: { value: 'demo-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to heir' }));
    expect(screen.getByText('Hand its 2 runs to heir and stop?')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Hand over and stop' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber', { runs: 'handover', heir: 'demo-heir' });
  });
});

// D-8199 review: the stop door asks the archive door's question, so the sheet answers its refusal words the same way —
// the question, then the request repeated with the choice — inside the sheet, never as a toast after it closed.
describe('the stop asks the same question: a refusal word, then the stop repeated with the choice', () => {
  const HEIR = fleetSession({ id: 'demo-heir', name: 'heir', project: 'demo', workdir: '/w/demo/heir', workspace: 'heir',
    role: 'coordinator' });

  it('a plain Stop only the server finds coordinating turns to the question; the confirm repeats the stop with the choice', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone' })) as unknown as Archive;
    const onStopOnly = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [RUN7] }))
      .mockResolvedValueOnce({ ok: true, moved: { to: null, runs: [RUN7] } });
    const { onClose } = mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    expect(onStopOnly).toHaveBeenCalledWith('demo-amber');
    expect(await screen.findByText('It coordinates 1 open run. What happens to them?')).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    // A stop never ends a programme: Release or Hand over only.
    expect(buttons()).toEqual(['Release runs', 'Hand over', 'Cancel']);
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and stop' }));
    await waitFor(() => expect(onStopOnly).toHaveBeenLastCalledWith('demo-amber', { runs: 'release' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });

  it('a stop whose move was refused (`claims-not-moved`) returns to the question with the reason; nothing closes', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone' })) as unknown as Archive;
    // The frame shows no claim, so the stop is sent plain and the server names the run; the hand-over is then refused.
    const onStopOnly = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'coordinator-has-open-runs', runs: [RUN7] }))
      .mockRejectedValueOnce(refusal({ error: 'claims-not-moved', moved: [], notMoved: [RUN7], refusal: { kind: 'heir-not-live' } }));
    const self = s({ role: 'coordinator' });
    const { onClose } = mount(self, { archive, onStopOnly, sessions: [self, HEIR] });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    fireEvent.change(await screen.findByRole('combobox', { name: 'Hand over to' }), { target: { value: 'demo-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to heir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand over and stop' }));
    expect(await screen.findByText('Its runs could not be moved: that coordinator is not live. Nothing was stopped or archived.'))
      .toBeInTheDocument();
    expect(screen.getByText('It coordinates 1 open run. What happens to them?')).toBeInTheDocument();
    expect(buttons()).toEqual(['Release runs', 'Hand over to heir', 'Cancel']);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a stop that fails with no word stays on the sheet, in the server\'s own words', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'worktree-gone' })) as unknown as Archive;
    const onStopOnly = vi.fn().mockRejectedValueOnce(new ApiError(502, { ok: false, stderr: 'tmux: no server running' }));
    const { onClose } = mount(s(), { archive, onStopOnly });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    expect(await screen.findByText(/Couldn't stop — tmux: no server running/)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a choice over a store the server could not read: stopped, and the toast says the runs were not moved', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'status-unknown' })) as unknown as Archive;
    const onStopOnly = vi.fn().mockResolvedValueOnce({ ok: true, claimsUnreadable: 'runs.wave' });
    const { onClose } = mount(s(), { archive, onStopOnly, runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and stop' }));
    expect(await screen.findByText('Stopped, but its runs could not be read, so none was moved: they are still claimed by it.'))
      .toBeInTheDocument();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
  });
});

// D-8199 review: once runs were released or handed over, every later answer says so first — the server's `moved` — as
// `ended` does after a programme end, so a refusal that follows never reads as "nothing happened".
describe('the runs moved ride every later refusal', () => {
  const MOVED_RELEASE = { to: null, runs: [RUN7] };
  const HEIR = fleetSession({ id: 'demo-heir', name: 'heir', project: 'demo', workdir: '/w/demo/heir', workspace: 'heir',
    role: 'coordinator' });

  it('released, then refused busy: the busy question says the runs were released first', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'session-busy', moved: MOVED_RELEASE })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    expect(await screen.findByText("It's working. Archive anyway?")).toBeInTheDocument();
    expect(screen.getByText('Its runs were released first: run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
  });

  it('handed over, then stopped but not archived: the toast names the heir first', async () => {
    const archive = vi.fn(async () => ({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
      detail: 'ccd: status-unknown', moved: { to: 'demo-heir', runs: [RUN7] } })) as unknown as Archive;
    const self = s({ role: 'coordinator' });
    mount(self, { archive, runs: [claimedRun(RUN7)], sessions: [self, HEIR] });
    fireEvent.change(screen.getByRole('combobox', { name: 'Hand over to' }), { target: { value: 'demo-heir' } });
    fireEvent.click(screen.getByRole('button', { name: 'Hand over to heir' }));
    fireEvent.click(screen.getByRole('button', { name: 'Hand over and archive' }));
    expect(await screen.findByText(/^Its runs were handed to heir \(run 7 — lifecycle wave 1\/3\)\. Stopped, but not archived/))
      .toBeInTheDocument();
  });

  it('runs moved on an EARLIER send are still named when a later send stops but does not archive', async () => {
    const archive = vi.fn()
      .mockRejectedValueOnce(refusal({ error: 'session-busy', moved: MOVED_RELEASE }))
      .mockResolvedValueOnce({ ok: true, archived: false, stopped: true, ended: [], refusal: 'status-unknown',
        detail: 'ccd: status-unknown' }) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive anyway' }));
    expect(await screen.findByText(/^Its runs were released \(run 7 — lifecycle wave 1\/3\)\. Stopped, but not archived/))
      .toBeInTheDocument();
  });

  it('a 502 after the move: the sheet says the runs moved, then the server\'s words', async () => {
    const archive = vi.fn().mockRejectedValueOnce(new ApiError(502, { ok: false, stderr: 'ccd: boom', moved: MOVED_RELEASE })) as unknown as Archive;
    mount(s(), { archive, runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    expect(await screen.findByText('ccd: boom')).toBeInTheDocument();
    expect(screen.getByText('Its runs were released first: run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
  });

  it('a stop that fails after its move says the runs moved', async () => {
    const archive = vi.fn().mockRejectedValueOnce(refusal({ error: 'status-unknown' })) as unknown as Archive;
    const onStopOnly = vi.fn().mockRejectedValueOnce(new ApiError(502, { ok: false, stderr: 'tmux: gone', moved: MOVED_RELEASE }));
    mount(s(), { archive, onStopOnly, runs: [claimedRun(RUN7)] });
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and archive' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release runs' }));
    fireEvent.click(screen.getByRole('button', { name: 'Release and stop' }));
    expect(await screen.findByText(/Couldn't stop — tmux: gone/)).toBeInTheDocument();
    expect(screen.getByText('Its runs were released first: run 7 — lifecycle wave 1/3.')).toBeInTheDocument();
  });
});
