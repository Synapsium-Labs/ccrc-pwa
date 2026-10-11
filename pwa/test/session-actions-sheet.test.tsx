// The per-session actions that no longer fit on a row. The failure paths are
// the point: ccd's refusals are the only explanation the reader gets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';
import { READER_MIN_COLS } from '../../shared/api';
import { ToastHost } from '@ccrc/ui';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { createFleetStore } from '../src/stores/fleet';
import { ApiError, HOLD_EMPTY_REASON_TEXT, type api } from '../src/lib/api';
import { TEST_ROSTER } from './rosterFixture';

const s = (over: Partial<FleetSession> = {}): FleetSession => (fleetSession({ id: 'demo-quiet-mesa', workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', ...over }));

/** The REAL server failure shape: runCcd routes answer 502 with `stderr` and
 *  no `error` key. A mocked rejection would not catch an err.message regression;
 *  this does. */
const stubFetch = (body: unknown, status = 502): void => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
};

/** A real `AccountsResponse` shape for `GET /api/accounts` — every other
 *  route this blanket stub answers still gets the bare `'{}'` 200, which is
 *  fine for a POST action that only needs to succeed. `/api/accounts` is
 *  different: `SwapSheet` mounts under every `SessionActionsSheet` and polls
 *  it via `useAccountUsage` whenever the sheet is open, so a bare `{}`
 *  here answered `roster: undefined` — a wire shape the server never sends
 *  (fix round 1: the guards this motivated should be a production boundary
 *  check, not load-bearing for the suite). */
const accountsRoute = (): Response =>
  new Response(JSON.stringify({ accounts: [], projected: null, roster: TEST_ROSTER }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

/** The render helper this file never had — every mount above is spelled
 *  inline, with `open`, `onClose` and `onReap` all required. Task 213 needs an
 *  INJECTED `archive` (the AbandonSheet idiom: never module-mock what a prop
 *  can carry), and `ToastHost` alongside, because the point of two of its
 *  tests is WHICH of the two surfaces the refusal lands on. */
const renderSheet = (
  session: FleetSession, over: { archive?: typeof api.archive } = {},
): void => {
  render(
    <>
      <SessionActionsSheet session={session} open onClose={() => {}} onReap={() => {}} {...over} />
      <ToastHost />
    </>,
  );
};
/** The two shapes the archive door needs, named once. */
const workspaceSession = (): FleetSession => s({ workspace: 'quiet-basin', archivedAt: null });
const heldSession = (): FleetSession => s({ held: 'program:build4 wave:2/4 run:17' });

// vitest runs without globals, so RTL's auto-cleanup never registers itself
// (see test/message-links.test.tsx et al.) — without this, rerender/multi-render
// tests below leak DOM across `it` blocks.
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) =>
    String(input).includes('/api/accounts') ? accountsRoute() : new Response('{}', { status: 200 })));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('composition', () => {
  it('renders nothing when no session is selected', () => {
    const { container } = render(
      <SessionActionsSheet session={null} open={false} onClose={() => {}} onReap={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains the limit consequence that the line only had room to flag', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 82, seven: 10 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/5h limit near/i)).toBeInTheDocument();
  });

  // The 5h case above never exercises the `seven` half of the ternary chain —
  // a mutation there (`seven > CRITICAL` -> `<`) would still leave this
  // green. Pin it with the 7d window as the ONLY one over threshold.
  it('narrates the 7d window when only it is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 82 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/7d limit near/i)).toBeInTheDocument();
  });

  it('says nothing about limits when neither window is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 10 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });

  // Dead sessions stay silent about limits (SessionLine does the same): a
  // session that will never run again has nothing to warn about moving.
  it('says nothing about limits on a dead session, even past the threshold', () => {
    render(<SessionActionsSheet session={s({ status: 'dead', limits: { five: 90, seven: 90 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });
});

describe('actions', () => {
  it('restarts through api.ensure', async () => {
    render(<SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    // SwapSheet is mounted (hidden) alongside every SessionActionsSheet and
    // polls /api/accounts on its own effect (useAccountUsage), so the
    // restart call is no longer necessarily the first fetch recorded — find
    // it by the id it must carry, rather than assume its position.
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('demo-quiet-mesa'))).toBe(true),
    );
  });

  it("surfaces ccd's own refusal text when a restart fails", async () => {
    stubFetch({ ok: false, stderr: 'ccd: no such session: demo-quiet-mesa' });
    render(
      <>
        <SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} onReap={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    expect(await screen.findByText(/no such session/i)).toBeInTheDocument();
  });
});

describe('the unguarded delete is gone', () => {
  it('offers no Remove workspace button for a workspace session', () => {
    // A shallower unguarded door beside a careful one guarantees the
    // unguarded one gets used.
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/Remove workspace/)).not.toBeInTheDocument();
  });

  it('still offers restart and swap', () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText('Restart session')).toBeInTheDocument();
    expect(screen.getByText('Swap account')).toBeInTheDocument();
  });
});

describe('away note', () => {
  it('spells out the swap, which the line only marks', () => {
    const fleet = createFleetStore();
    act(() => { fleet.setState({ roster: TEST_ROSTER }); });
    render(<SessionActionsSheet session={s({ wrapper: 'claude2', home: 'claude' })}
                                open onClose={() => {}} onReap={() => {}} fleet={fleet} />);
    expect(screen.getByText(/Pinned to team·max, running on team·alt/)).toBeInTheDocument();
  });

  it('says nothing when the session is home', () => {
    render(<SessionActionsSheet session={s({ wrapper: 'claude', home: 'claude' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/Pinned to/)).not.toBeInTheDocument();
  });
});

describe('cleanup, guarded', () => {
  it('offers Clean up workspace… only once the workspace is ARCHIVED', () => {
    // Archive is the staging step. Offering cleanup before it would put the
    // confirmed path in front of a running session.
    render(<SessionActionsSheet session={s({ archivedAt: null })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/clean up workspace/i)).not.toBeInTheDocument();
    cleanup();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/clean up workspace/i)).toBeInTheDocument();
  });

  it('hands the session UP rather than deleting anything itself', () => {
    const onReap = vi.fn();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={onReap} />);
    fireEvent.click(screen.getByText(/clean up workspace/i));
    expect(onReap).toHaveBeenCalledWith('demo-quiet-mesa');
  });

  it('offers nothing for a main checkout', () => {
    render(<SessionActionsSheet session={s({ workspace: null, archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/clean up workspace/i)).not.toBeInTheDocument();
  });
});

describe('archive and restore (workspace lifecycle §5.2: one Archive, Restore on the fold)', () => {
  /** The archive sheet's own confirm — its primary button, beside the actions sheet's same-named opener. */
  const confirmArchive = async (): Promise<void> => {
    await waitFor(() => expect(document.querySelector('.archive-conflict-sheet .btn-primary')).not.toBeNull());
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-primary')!);
  };
  const posted = (suffix: string) => vi.mocked(fetch).mock.calls.some((c) => String(c[0]).endsWith(suffix));

  it('every session offers Archive — a workspace and a main checkout alike — through the one archive sheet', async () => {
    for (const [session, title] of [[s(), 'Archive this workspace?'],
      [s({ id: 'claude-demo', workspace: null }), 'Archive this session?']] as const) {
      const archive = vi.fn(async () => null);
      renderSheet(session, { archive });
      expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
      expect(await screen.findByText(title)).toBeInTheDocument();
      await confirmArchive();
      await waitFor(() => expect(archive).toHaveBeenCalledWith(session.id, {}));
      cleanup();
    }
  });

  it.each([
    ['an archived workspace', s({ status: 'dead', archivedAt: 1785300000, bucket: 'archived' }), '/demo-quiet-mesa/restore'],
    ['a stopped main checkout', s({ id: 'claude-demo', workspace: null, status: 'dead', bucket: 'dead',
      stoppedBy: { at: 1785300000_000, surface: 'pwa' } }), '/claude-demo/ensure'],
    ['a merged-and-archived (`cleanup`) workspace', s({ status: 'dead', archivedAt: 1785300000, bucket: 'cleanup' }),
      '/demo-quiet-mesa/restore'],
  ] as const)('%s offers Restore and no Archive, and Restore POSTs %s', async (_label, session, suffix) => {
    renderSheet(session);
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(posted(suffix)).toBe(true));
  });

  it.each([
    ['a stopped workspace that is not archived — Archive again', s({ status: 'dead', bucket: 'dead',
      stoppedBy: { at: 1785300000_000, surface: 'pwa' } })],
    ['a crashed main checkout — dead, never stopped', s({ id: 'claude-demo', workspace: null, status: 'dead', bucket: 'dead' })],
  ] as const)('%s offers Archive and no Restore', (_label, session) => {
    renderSheet(session);
    expect(screen.getByRole('button', { name: 'Archive' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Restore' })).toBeNull();
  });

  it('a 409 run-open lands in the archive sheet, naming the run — never a toast', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());
    expect(screen.getByText(/run 17/)).toBeTruthy();
    expect(screen.queryByText(/Couldn't archive — run-open/)).toBeNull();
  });

  it('a failure the door has no word for stays in the sheet, in ccd\'s own words', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    expect(await screen.findByText('ws-archive: busy')).toBeInTheDocument();
  });

  it('"Stop only" after a refusal the phone cannot fix POSTs the unchanged /stop', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'worktree-gone' }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    fireEvent.click(await screen.findByRole('button', { name: 'Stop only' }));
    await waitFor(() => expect(posted('/demo-quiet-mesa/stop')).toBe(true));
  });

  // The SAME class as this file's `swapOpen`/`holdOpen`/`releaseConfirmOpen`
  // resets, one state later: a claim is measured for ONE session, and
  // FleetScreen's `openActionsFor` retargets `actionsSession` while
  // `actionsOpen` stays true (tap another row's ··· with this sheet up). The
  // sheet is mounted at screen level and never unmounts on close, so nothing
  // else clears it — session B's operator would be shown session A's run.
  it('a run-open captured for session A does NOT follow a retarget to session B', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    const b = s({ id: 'demo-still-ridge', workspace: 'still-ridge', archivedAt: null });
    const props = { open: true, onClose: () => {}, onReap: () => {}, archive };
    const { rerender } = render(
      <>
        <SessionActionsSheet session={workspaceSession()} {...props} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());

    rerender(
      <>
        <SessionActionsSheet session={b} {...props} />
        <ToastHost />
      </>,
    );
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
    expect(screen.queryByText(/run 17/)).toBeNull();
  });

  // The OTHER half of "unconditional": the archive sheet is mounted as a
  // SIBLING of `<Sheet open={open}>`, not inside it, so a claim left set while
  // the actions sheet closes would stay on screen with nothing behind it.
  it('closing the door drops the claim — the archive sheet is gated on `open` too', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    const session = workspaceSession();
    const props = { session, onClose: () => {}, onReap: () => {}, archive };
    const { rerender } = render(
      <><SessionActionsSheet {...props} open /><ToastHost /></>);
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await confirmArchive();
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());

    rerender(<><SessionActionsSheet {...props} open={false} /><ToastHost /></>);
    expect(screen.queryByText(/This workspace is claimed/)).toBeNull();
  });
});

describe('hold and release', () => {
  // `f`, not a second `s`: the brief's own tests name it `f`, and it is
  // exactly `s` — one session-literal builder for this file.
  const f = s;
  const sheetProps = { open: true, onClose: () => {}, onReap: () => {} };

  let heldCalls: { id: string; reason: string }[];
  let released: string[];

  beforeEach(() => {
    heldCalls = [];
    released = [];
    // A fetch stub that RECORDS hold/release requests rather than merely
    // answering 200 — `stubFetch`'s blanket 502 above is the wrong shape
    // here (SwapSheet's useAccountUsage polls /api/accounts on its own
    // effect, mounted alongside every SessionActionsSheet, and that call
    // must not read as a hold/release failure).
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const id = url.split('/').at(-2) ?? '';
      if (method === 'POST' && url.endsWith('/hold')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { reason?: string };
        heldCalls.push({ id, reason: body.reason ?? '' });
      } else if (method === 'POST' && url.endsWith('/release')) {
        released.push(id);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });

  it('the actions sheet offers Hold on an unheld workspace and Release on a held one, never both', () => {
    const { rerender } = render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
    expect(screen.getByRole('button', { name: /hold/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release/i })).toBeNull();
    rerender(<SessionActionsSheet session={f({ held: 'program:x wave:2/4' })} {...sheetProps} />);
    expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^hold/i })).toBeNull();
  });

  it('offers neither once the workspace is archived — a hold cannot protect a pane that is already gone', () => {
    render(<SessionActionsSheet session={f({ held: null, archivedAt: 1785300000 })} {...sheetProps} />);
    expect(screen.queryByRole('button', { name: /hold/i })).toBeNull();
  });

  it('titles the sheet with the label chain, branch outranking the slug', () => {
    render(<SessionActionsSheet session={f({ name: null, branch: 'ws/fix-the-pr-sheet', workspace: 'quiet-basin' })}
                                {...sheetProps} />);
    expect(screen.getByText('ws/fix-the-pr-sheet')).toBeInTheDocument();
  });

  // `fireEvent`, not `userEvent`, for every click below — matching this
  // file's own established idiom for Sheet-rendered controls (every other
  // describe block here does the same). vaul's Drawer attaches its own
  // pointer/drag handlers to its content, and `userEvent.click`'s realistic
  // pointerdown/pointerup sequence walks straight into them under jsdom
  // (`getTranslate` reads a transform jsdom never sets) — an uncaught
  // exception vitest reports separately from the assertions, real but
  // orthogonal to anything this suite is testing.
  it('Release names its consequence before acting', () => {
    render(<SessionActionsSheet session={f({ held: 'program:x' })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    // The confirm says what release re-enables BEFORE anything is sent, and
    // what it re-enables is the audited cleanup flow — the one thing the hold
    // was gating.
    expect(screen.getByText(/cleanup stops refusing/)).toBeInTheDocument();
    expect(released).toHaveLength(0);   // nothing sent yet — the copy precedes the act
  });

  it('Release promises no archive at all — there is no sweep left to promise one', () => {
    // Two earlier waves had to walk this string back from a future act it
    // could not guarantee: first "will archive on the next sweep" when ccd's
    // own `cmd_ws_release` said MAY, then a hedged MAY that a newly added
    // second deferral could still break. `sweepMerged` archives nothing now,
    // so both spellings are false in the same way and neither may come back.
    render(<SessionActionsSheet session={f({ held: 'program:x' })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    expect(screen.queryByText(/will archive on the next sweep/)).not.toBeInTheDocument();
    expect(screen.queryByText(/may archive it once its PR merges/)).not.toBeInTheDocument();
    // Said outright, not merely left unsaid — an operator who released to
    // unblock a merge is exactly the one who needs to hear it.
    expect(screen.getByText(/No archive follows: ccrc does not archive on merge/))
      .toBeInTheDocument();
  });

  it('the release consequence leaves the archive with the operator, by hand', () => {
    // The workspace outlives its merge now, so the sentence has to end
    // somewhere true: nobody is coming to archive it.
    renderSheet(heldSession());
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    const text = screen.getByText(/released —/).textContent ?? '';
    expect(text).toMatch(/stays live until you archive it by hand/);
    expect(text).not.toMatch(/sweep/);
  });

  it('confirming Release posts /release and closes the sheet', async () => {
    const onClose = vi.fn();
    render(<SessionActionsSheet session={f({ held: 'program:x' })} open onClose={onClose} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    // QuickConfirm's own confirm button — targeted by its wrapper class
    // rather than role/name, which the opener Release button (still mounted
    // behind it) also matches.
    const confirmBtn = document.querySelector<HTMLButtonElement>('.qc-actions .btn-primary')!;
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(released).toEqual(['demo-quiet-mesa']));
    expect(onClose).toHaveBeenCalled();
  });

  it("Hold refuses to send an empty reason, with the server's own sentence", () => {
    render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /hold/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm|hold/i }));
    expect(heldCalls).toHaveLength(0);
    expect(screen.getByText(/say which program holds this/)).toBeInTheDocument();
  });

  it('the empty-reason refusal clears on the first keystroke, not on the next submit', () => {
    // FIX-WAVE OBSERVATION: `holdError` was set by `confirmHold`'s empty branch
    // and cleared only INSIDE `confirmHold`, after the non-empty check passed.
    // So "empty reason — say which program holds this" sat under a box with a
    // perfectly good reason typed into it until the operator submitted again —
    // a refusal of what was on screen a moment ago, not of what is there now.
    render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(screen.getByText(/say which program holds this/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'p' } });
    expect(screen.queryByText(/say which program holds this/)).not.toBeInTheDocument();
    expect(heldCalls).toHaveLength(0);   // typing is not sending
  });

  // THE RESET HAD A LONG COMMENT AND NO TEST — measured: deleting the effect
  // that clears the composer left all 60 tests in this file green. The sheet
  // is mounted at screen level and never unmounts on close, and
  // `FleetScreen`'s `openActionsFor` retargets it while `open` stays true, so
  // nothing else clears a half-typed reason. Both halves of the reset key get
  // their own case below.
  it('a reason half-typed for session A does NOT follow a retarget to session B', () => {
    const a = f({ id: 'demo-quiet-mesa', held: null });
    const b = f({ id: 'demo-still-ridge', workspace: 'still-ridge', held: null });
    const { rerender } = render(<SessionActionsSheet session={a} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:a wave:1/4' } });

    rerender(<SessionActionsSheet session={b} {...sheetProps} />);
    // Back to the opener: session B's operator is not handed A's sentence,
    // and cannot send it by tapping Confirm.
    expect(screen.getByRole('button', { name: /^hold$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Hold reason')).toBeNull();
    expect(heldCalls).toHaveLength(0);
  });

  // THE BEHAVIOUR, NOT THE MECHANISM — said out loud because the measurement
  // says so: with the reset effect deleted entirely this case stays GREEN,
  // because `Sheet open={false}` unmounts the composer and the state dies
  // with it. It is kept as the behavioural claim (a closed-and-reopened sheet
  // offers an empty box, however that is achieved); the retarget case above
  // is the one that pins the effect, and it is the only one that reds.
  it('a reason half-typed survives nothing on a close either', () => {
    const session = f({ held: null });
    const props = { onClose: () => {}, onReap: () => {} };
    const { rerender } = render(<SessionActionsSheet session={session} open {...props} />);
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:a' } });

    rerender(<SessionActionsSheet session={session} open={false} {...props} />);
    rerender(<SessionActionsSheet session={session} open {...props} />);
    expect(screen.getByRole('button', { name: /^hold$/i })).toBeInTheDocument();
    expect(screen.queryByLabelText('Hold reason')).toBeNull();
  });

  it('Hold sends the typed reason and closes the sheet on success', async () => {
    const onClose = vi.fn();
    render(<SessionActionsSheet session={f({ held: null })} open onClose={onClose} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:agent-evals wave:2/4' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(heldCalls).toEqual(
      [{ id: 'demo-quiet-mesa', reason: 'program:agent-evals wave:2/4' }]));
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces ccd's own refusal text when a hold request fails", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, stderr: 'archived — restore first' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )));
    render(
      <>
        <SessionActionsSheet session={f({ held: null })} {...sheetProps} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:x' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/Couldn't hold — archived — restore first/)).toBeInTheDocument();
  });

  // D-2731. The route refuses an over-cap reason with a sentence the operator can
  // act on — `detail` says it is written verbatim and refused rather than
  // shortened — and `apiErrorText` has no `oversize` entry, so the toast used to
  // read the bare slug. It must not GROW one either: the kickoff translator
  // already owns `oversize` with a different sentence, which is why this reader
  // is surface-local. The fixture is the server's real 413 shape.
  it('surfaces the hold cap sentence, not the bare `oversize` slug', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({
        ok: false, error: 'oversize', limit: 512,
        detail: 'reason exceeds 512 bytes — it is written verbatim into the '
          + 'registry hold field and refused rather than shortened',
      }),
      { status: 413, headers: { 'content-type': 'application/json' } },
    )));
    render(
      <>
        <SessionActionsSheet session={f({ held: null })} {...sheetProps} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'x'.repeat(600) } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/refused rather than shortened/)).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't hold — oversize$/)).toBeNull();
  });
});

describe('forget — the end-of-life a non-workspace session never had', () => {
  // The exact production shape: a dead wrapper session on a project's main
  // checkout (`claude-corp-data-internal`), which no other affordance on this
  // sheet can remove — archive/reap are workspace-only, stop leaves the row.
  const deadWrapper = (over: Partial<FleetSession> = {}): FleetSession =>
    s({ id: 'claude-corp-demo', wrapper: 'claude-corp', home: 'claude-corp',
        workspace: null, status: 'dead', ...over });

  it('offers Forget on a dead non-workspace session only', () => {
    render(<SessionActionsSheet session={deadWrapper()} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByRole('button', { name: /forget session/i })).toBeInTheDocument();
  });

  it('hides Forget while the session is alive — stopping is a different act', () => {
    render(<SessionActionsSheet session={deadWrapper({ status: 'idle' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByRole('button', { name: /forget session/i })).not.toBeInTheDocument();
  });

  it('hides Forget on a workspace, dead or not — those go archive → reap', () => {
    render(<SessionActionsSheet session={s({ status: 'dead' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByRole('button', { name: /forget session/i })).not.toBeInTheDocument();
  });

  it('names the consequence before firing, then POSTs /forget and closes', async () => {
    const onClose = vi.fn();
    render(<SessionActionsSheet session={deadWrapper()} open onClose={onClose} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /forget session/i }));
    // The consequence says what goes AND what is kept — a deletion the sheet
    // does not name is not one anybody consented to.
    expect(screen.getByText(/transcript and any pasted images stay/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Forget$/ }));
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/api/sessions/claude-corp-demo/forget'))).toBe(true),
    );
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces ccd's refusal — a held session names its holder", async () => {
    stubFetch({ ok: false, stderr: 'held: program:evals — release first' });
    render(
      <>
        <SessionActionsSheet session={deadWrapper()} open onClose={() => {}} onReap={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /forget session/i }));
    fireEvent.click(screen.getByRole('button', { name: /^Forget$/ }));
    expect(await screen.findByText(/Couldn't forget — held: program:evals/)).toBeInTheDocument();
  });
});

describe('the substrate gate — destructive affordances refuse a session nobody can see (spec §4)', () => {
  // One derived fault per render (`substrateFault`), one string on every gated
  // control: the chip's own `tmux unreachable — <reason>`, carried in `title`
  // (the PrSheet disabled+title idiom). Disabled, NOT hidden — the control
  // stays where muscle memory expects it and names why it refuses. Each case
  // below also proves the click is inert, so a dropped `disabled` cannot hide
  // behind a still-guarded handler (or vice versa).
  const faulted = (over: Partial<FleetSession> = {}): FleetSession =>
    s({ substrate: { at: 1, text: 'x' }, ...over });
  const sheetProps = { open: true, onClose: () => {}, onReap: () => {} };

  it('Restart is disabled, names the fault, and never posts /ensure', () => {
    render(<SessionActionsSheet session={faulted({ status: 'dead' })} {...sheetProps} />);
    const btn = screen.getByRole('button', { name: /restart session/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    expect(btn.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(btn);
    expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/ensure'))).toBe(false);
  });

  it('Restore on a faulted stopped main checkout is disabled and never posts /ensure', () => {
    render(<SessionActionsSheet
      session={faulted({ id: 'claude-demo', workspace: null, status: 'dead', bucket: 'dead',
        stoppedBy: { at: 1785300000_000, surface: 'pwa' } })} {...sheetProps} />);
    const btn = screen.getByRole('button', { name: 'Restore' });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    expect(btn.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(btn);
    expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/ensure'))).toBe(false);
  });

  // The fleet frame is live under the open sheets, so the handler re-reads the fault when it fires. Here the row object
  // gains the fault AFTER the render, so the button is still enabled (no re-render) and only the fire-time check refuses.
  it('Stop only re-checks the fault when it fires: it toasts the refusal and never posts /stop', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'worktree-gone' }));
    const session = s({ workspace: 'quiet-basin', archivedAt: null });
    renderSheet(session, { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(document.querySelector('.archive-conflict-sheet .btn-primary')).not.toBeNull());
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-primary')!);
    const stop = await screen.findByRole('button', { name: 'Stop only' });
    expect(stop).toBeEnabled();
    (session as { substrate: FleetSession['substrate'] }).substrate = { at: 1, text: 'x' };
    fireEvent.click(stop);
    expect(await screen.findByText(/Couldn't stop — tmux unreachable — x/)).toBeInTheDocument();
    expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('/stop'))).toBe(false);
  });

  it('Swap account is disabled and the swap sheet never opens', () => {
    render(<SessionActionsSheet session={faulted()} {...sheetProps} />);
    const btn = screen.getByRole('button', { name: /swap account/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    fireEvent.click(btn);
    expect(screen.queryByText('Move to another account')).not.toBeInTheDocument();
  });

  it('Archive is disabled and the injected archive spy never fires', () => {
    const archive = vi.fn();
    renderSheet(faulted(), { archive });
    const btn = screen.getByRole('button', { name: 'Archive' });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    fireEvent.click(btn);
    expect(archive).not.toHaveBeenCalled();
  });

  it('Clean up workspace… is disabled and never hands the session up', () => {
    const onReap = vi.fn();
    render(<SessionActionsSheet session={faulted({ archivedAt: 1785300000 })}
                                open onClose={() => {}} onReap={onReap} />);
    const btn = screen.getByRole('button', { name: /clean up workspace/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    fireEvent.click(btn);
    expect(onReap).not.toHaveBeenCalled();
  });

  it('Forget session… is disabled and its consequence confirm never opens', () => {
    render(<SessionActionsSheet session={faulted({ workspace: null, status: 'dead' })}
                                {...sheetProps} />);
    const btn = screen.getByRole('button', { name: /forget session/i });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    fireEvent.click(btn);
    expect(screen.queryByText(/transcript and any pasted images stay/i)).not.toBeInTheDocument();
  });

  it('a null substrate leaves Restart enabled with no gate title', () => {
    render(<SessionActionsSheet session={s({ status: 'dead' })} {...sheetProps} />);
    const btn = screen.getByRole('button', { name: /restart session/i });
    expect(btn).toBeEnabled();
    expect(btn.getAttribute('title')).toBeNull();
  });
});

describe('the spawn-state note (§1.6b)', () => {
  // THIS FILE HAS NO RENDER HELPER — every one of its mount sites spells the
  // render inline, and `open`, `onClose` and `onReap` are all required props.
  // So the helper is DEFINED HERE, modelled on the `line()` helper in
  // pwa/test/session-lifecycle.test.tsx.
  const renderSheet = (session: FleetSession): void => {
    render(<SessionActionsSheet session={session} open onClose={() => {}} onReap={() => {}} />);
  };
  const notes = () => [...document.querySelectorAll('.sess-sheet-note')].map((n) => n.textContent ?? '');

  it('points a blocked spawn at Swap account and the terminal, not at Restart', () => {
    // A hard block is the one verdict where waiting cannot help and restarting
    // reproduces it: the account is rate-limited or logged out.
    renderSheet(s({ spawnState: 'blocked' }));
    expect(notes().join(' ')).toContain('Swap account');
    expect(notes().join(' ')).not.toContain('Restart session revives it');
  });

  it('points a login spawn at Swap account too', () => {
    renderSheet(s({ spawnState: 'login' }));
    expect(notes().join(' ')).toContain('Swap account');
  });

  it('says an unconfirmed settle is not a fault', () => {
    // A systemd restart of a large session legitimately settles unconfirmed
    // ("700k+-token resumes take minutes between gates"). A sheet that calls that
    // broken teaches the operator to ignore the sheet.
    renderSheet(s({ spawnState: 'expired' }));
    expect(notes().join(' ')).toContain('not a fault');
  });

  it('tells a narrow spawn to widen the window and look for an unanswered prompt', () => {
    // rc 6: ccd stood its startup gates down on a pane under READER_MIN_COLS,
    // so a trust/bypass/resume prompt may still be waiting, and the window
    // stays narrow until something re-pins it. The drawer re-pins 220x50 on
    // open and on close (server.ts's `resizeWindow(id, 220, 50)`).
    renderSheet(s({ spawnState: 'narrow' }));
    const t = notes().join(' ');
    // Rendered from the constant ccd stands down at (a hand-typed 120 would
    // match this too — what this pins is the value, not its spelling).
    expect(t).toContain(`under ${READER_MIN_COLS} columns`);
    // rc 6 also answers when ccd could not read the width at all.
    expect(t).toContain('could not read');
    expect(t).toContain('terminal drawer');
    expect(t).toContain('startup prompt');
    // ccd pins every spawn 220x50 now (ccd-spawn-split.test.ts), so a narrow
    // terminal on ANOTHER session no longer narrows one — the usual cause left
    // is a terminal on this session. But rc 6 also covers a failed pin and an
    // unreadable width, and a marker written by an older ccd outlives the
    // rollout (panes are not respawned), so the sentence is hedged, not single.
    expect(t).toContain('attached straight to this session');
    expect(t).toContain('failed pin');
    expect(t).toContain('older ccd');
    // rc 6 answers only for a live pane, so Restart session (ensure) spawns
    // nothing there — the note must not offer it as the remedy.
    expect(t).not.toContain('Restart session');
  });

  it('tells a narrow spawn whose pane is measured wide again what is back on, and what the spawn still skipped', () => {
    // `paneCols` is THIS tick's prompt-box width, so a reading at or over
    // READER_MIN_COLS means the pane is wide with its prompt up — no startup
    // gate is showing, and ccd's per-tick readers are back on.
    renderSheet(s({ spawnState: 'narrow', paneCols: 220 }));
    const t = notes().join(' ');
    expect(t).toContain('since been widened');
    // rc 6 folds two causes; the widened arm keeps both.
    expect(t).toContain('could not read');
    expect(t).toContain('auto-swap and auto-compact are back on');
    expect(t).toContain('/effort');
    // Nothing left to widen: no drawer instruction, no "keeps … off".
    expect(t).not.toContain('terminal drawer');
    expect(t).not.toContain('keeps auto-swap');
  });

  it('keeps the widen-it note while the pane is unmeasured or still narrow — unmeasured is never wide', () => {
    for (const paneCols of [null, READER_MIN_COLS - 1]) {
      cleanup();
      renderSheet(s({ spawnState: 'narrow', paneCols }));
      const t = notes().join(' ');
      expect(t, `paneCols ${paneCols}`).toContain('terminal drawer');
      expect(t, `paneCols ${paneCols}`).not.toContain('since been widened');
    }
  });

  it('sends a DEAD narrow row to Restart session — the pane to widen is gone', () => {
    // `.spawn` survives the pane, so a stopped or dead row can still carry rc
    // 6. There is no drawer to open; Restart session is the respawn, and ccd
    // pins that new pane 220x50.
    renderSheet(s({ spawnState: 'narrow', status: 'dead', bucket: 'dead' }));
    const t = notes().join(' ');
    expect(t).toContain('Restart session builds a new one');
    // True only on a fleet box running a pinning ccd, and it says so.
    expect(t).toContain('a current ccd pins 220x50');
    expect(t).not.toContain('attached to any session');
    expect(t).not.toContain('terminal drawer');
  });

  it('says NOTHING for a CLEAN spawn', () => {
    renderSheet(s({ spawnState: 'ready' }));
    expect(notes().join(' ')).not.toContain('last spawn');
  });

  it('and says NOTHING for an UNRECORDED one — the case every pre-#50 row carries', () => {
    // A SEPARATE `it`, deliberately. `notes()` reads the whole document and the
    // file's cleanup runs BETWEEN TESTS, not between renders — two renders in
    // one case leave the second assertion unable to fail, which would pin
    // nothing at all about `spawnState: null`. This is the false-positive
    // direction that would otherwise light a note on all 18 live sessions.
    renderSheet(s({ spawnState: null }));
    expect(notes().join(' ')).not.toContain('last spawn');
  });

  it('names a CLAIM as the repair for unclaimed, never a process', () => {
    renderSheet(s({ lifecycle: 'unclaimed' }));
    const t = notes().join(' ');
    expect(t).toContain('Restart session');
    expect(t).not.toContain('Nothing is watching');
  });
});

// — the refusals the three fire-and-forget doors say, and the swap's own exit —
describe('a door that fails still says so, in ccd’s own words', () => {
  it('Restore reports ccd’s refusal rather than closing in silence', async () => {
    // `restoreNow`'s catch, and the sheet stays open: a restore that failed
    // leaves the row exactly as it was, so closing would read as success.
    // 502 `{stderr}` with no `error` key is the REAL shape every runCcd route
    // fails as, which is why `apiErrorText` and not `err.message`.
    stubFetch({ ok: false, stderr: 'ws-restore: worktree is gone' });
    renderSheet(s({ status: 'dead', archivedAt: 1785300000, bucket: 'archived' }));
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }));
    expect(await screen.findByText(/ws-restore: worktree is gone/)).toBeInTheDocument();
  });

  it('“Stop only” reports a /stop that failed, after the sheet has already closed', async () => {
    // Fire-and-forget by design — QuickConfirm already ran the consequence
    // past the operator — so the toast is the ONLY thing left that can carry
    // a failure. Without it a stop that never landed looks like one that did.
    const archive = vi.fn().mockRejectedValue(new ApiError(409, { ok: false, error: 'worktree-gone' }));
    renderSheet(workspaceSession(), { archive: archive as unknown as typeof api.archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(document.querySelector('.archive-conflict-sheet .btn-primary')).not.toBeNull());
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-primary')!);
    const stopOnly = await screen.findByRole('button', { name: 'Stop only' });

    // Only now make the box refuse, so the archive path above is unaffected.
    stubFetch({ ok: false, stderr: 'tmux: no server running' });
    fireEvent.click(stopOnly);
    expect(await screen.findByText(/tmux: no server running/)).toBeInTheDocument();
  });

  it('Release reports a /release that failed the same way', async () => {
    // The third fire-and-forget door. A held session whose release 502s is
    // still held, and the board will show it — but the operator tapped a
    // button, and a button that reports nothing is a button that lied.
    stubFetch({ ok: false, stderr: 'hold: file is gone' });
    renderSheet(heldSession());
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    const confirm = document.querySelector('.qc-actions .btn-primary');
    if (!(confirm instanceof HTMLElement)) throw new Error('no release confirm');
    fireEvent.click(confirm);
    expect(await screen.findByText(/hold: file is gone/)).toBeInTheDocument();
  });
});

describe('the swap sheet this one mounts', () => {
  it('opens from Swap account and closes on its own scrim', async () => {
    // `onClose` was an uncovered function: every case that opens the swap
    // sheet leaves it open. A sheet that cannot be dismissed covers the
    // actions sheet that raised it.
    renderSheet(workspaceSession());
    fireEvent.click(screen.getByRole('button', { name: /swap account/i }));
    await waitFor(() => expect(screen.queryAllByTestId('sheet-overlay').length).toBeGreaterThan(1));

    const scrims = screen.getAllByTestId('sheet-overlay');
    fireEvent.click(scrims[scrims.length - 1]!);
    await waitFor(() => expect(screen.queryAllByTestId('sheet-overlay').length).toBe(1));
  });
});

describe('the spawn notes, one per state', () => {
  it('a VANISHED pane says the conversation is resumed from the transcript', () => {
    // The third of three spawn-state notes and the only one with no case. It
    // is the one that answers the reader's actual question — the pane is gone,
    // so is my work? — and silence there is the worst of the three.
    renderSheet(s({ spawnState: 'vanished', status: 'dead', bucket: 'dead' }));
    expect(screen.getByText(/tmux session disappeared/)).toBeInTheDocument();
    expect(screen.getByText(/resumed\s+from the transcript, not from that pane/)).toBeInTheDocument();
  });
});

// — the hold composer's remaining three arms —
//
// MOST OF IT WAS ALREADY HERE, and finding that out was the measurement: the
// empty-reason refusal, its clear-on-keystroke and the `oversize` detail
// sentence all have cases further up this file, and the first drafts of the
// three below were duplicates of them (the mutation run named both copies).
// What was genuinely unreached is the whitespace-only reason, the `oversize`
// that carries NO detail, and what Cancel forgets.
describe('the hold composer, past the arms already covered', () => {
  const openComposer = (): void => {
    renderSheet(workspaceSession());
    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
  };

  it('a reason of only whitespace is empty too', () => {
    // `reason.trim()`. A hold whose reason is three spaces is a row nobody
    // can read later, and the box would refuse it — so the refusal is here,
    // where it costs no round trip.
    openComposer();
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(screen.getByText(HOLD_EMPTY_REASON_TEXT)).toBeInTheDocument();
  });

  it('an `oversize` with no detail falls back to the ordinary translator', async () => {
    // The guard is on `typeof detail === 'string'`: the case above this one
    // in the file proves the detail is PREFERRED, and this proves its absence
    // is survivable — a 413 with nothing more specific to say must not render
    // an empty sentence.
    stubFetch({ ok: false, error: 'oversize' }, 413);
    openComposer();
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:build9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }));
    expect(await screen.findByText(/Couldn't hold —/)).toBeInTheDocument();
  });

  it('Cancel closes the composer and forgets what was typed', () => {
    // The reason is not a draft: reopening Hold for a row must not offer the
    // program name from a hold the operator abandoned.
    openComposer();
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:gone' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('Hold reason')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Hold' }));
    expect(screen.getByLabelText('Hold reason')).toHaveValue('');
  });
});
