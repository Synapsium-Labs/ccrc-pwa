// The per-session actions that no longer fit on a row. The failure paths are
// the point: ccd's refusals are the only explanation the reader gets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { createFleetStore } from '../src/stores/fleet';
import { ApiError, type api } from '../src/lib/api';
import { TEST_ROSTER } from './rosterFixture';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, unmeasured: [],
  lifecycle: null, stoppedBy: null, swapBlocked: null, started: true, spawnState: null, ...over,
});

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
 *  it via `useDisabledWrappers` whenever the sheet is open, so a bare `{}`
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
    // polls /api/accounts on its own effect (useDisabledWrappers), so the
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
    expect(screen.getByText(/Pinned to team·max, running on alt·max/)).toBeInTheDocument();
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

describe('archive and restore (D5 rider 1)', () => {
  it('Archive shows only for an unarchived workspace session, and POSTs /archive', async () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/archive'))).toBe(true));
  });

  it('Restore shows only on the complement, and POSTs /restore', async () => {
    render(<SessionActionsSheet session={s({ archivedAt: null })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/restore workspace/i)).not.toBeInTheDocument();
    cleanup();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/archive workspace/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /restore workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/restore'))).toBe(true));
  });

  it('no workspace → neither appears', () => {
    render(<SessionActionsSheet session={s({ workspace: null, archivedAt: 1785300000 })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/archive workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/restore workspace/i)).not.toBeInTheDocument();
  });

  it("failure toasts Couldn't archive — with ccd's own words", async () => {
    stubFetch({ ok: false, stderr: 'not merged' });
    render(
      <>
        <SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    expect(await screen.findByText(/Couldn't archive — not merged/)).toBeInTheDocument();
  });

  // Build 8 Wave 2, Task 213. `archive` is INJECTED, not module-mocked — the
  // AbandonSheet idiom, and the reason this component gained the prop. The
  // helper is new: this file had no render helper at all, every mount was
  // spelled inline with `open`/`onClose`/`onReap` each time.
  it('Archive workspace routes a 409 run-open into the sheet, never a toast', async () => {
    const archive = vi.fn().mockRejectedValue(
      new ApiError(409, { ok: false, error: 'run-open', runs: [{ id: 17, program: 'build4', wave: 2, waveOf: 3 }] }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    await waitFor(() => expect(screen.getByText(/This workspace is claimed/)).toBeTruthy());
    expect(screen.getByText(/run 17/)).toBeTruthy();
    // The defect this replaces: a bare slug in a toast.
    expect(screen.queryByText(/Couldn't archive — run-open/)).toBeNull();
  });

  it('any OTHER archive failure still toasts — the sheet is for run-open, not for everything', async () => {
    const archive = vi.fn().mockRejectedValue(new ApiError(502, { ok: false, stderr: 'ws-archive: busy' }));
    renderSheet(workspaceSession(), { archive });
    fireEvent.click(screen.getByRole('button', { name: 'Archive workspace' }));
    expect(await screen.findByText(/Couldn't archive — ws-archive: busy/)).toBeInTheDocument();
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
    // here (SwapSheet's useDisabledWrappers polls /api/accounts on its own
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
    // The confirm says what release re-enables BEFORE anything is sent:
    expect(screen.getByText(/may archive it once its PR merges/)).toBeInTheDocument();
    expect(released).toHaveLength(0);   // nothing sent yet — the copy precedes the act
  });

  it('Release promises a MAY, not a WILL — the gate has a deferral the hold knows nothing about', () => {
    // FIX-WAVE OBSERVATION. The copy read "released — will archive on the next
    // sweep after its PR merges", under a comment claiming it was ccd's own
    // fact restated. ccd's `cmd_ws_release` says the next sweep MAY archive,
    // and `archiveMerged` still defers on `archiveSafety` (busy/attached) —
    // which the PrSheet two taps away is careful to name as a separate reason.
    // An operator who released to unblock a merge and then watched three
    // sweeps go by was told a certainty that was never on offer.
    render(<SessionActionsSheet session={f({ held: 'program:x' })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    expect(screen.queryByText(/will archive on the next sweep/)).not.toBeInTheDocument();
    // And the deferral itself is named, not merely hedged away.
    expect(screen.getByText(/busy or attached session defers/)).toBeInTheDocument();
  });

  it('the release consequence no longer promises a sweep the run can veto', () => {
    // Build 8 Wave 2: `archiveMerged` now asks coord.db as well, so an absent
    // hold is not sufficient — releasing does NOT re-arm the sweep while a run
    // is open. This is the PWA half of ccd's own corrected `cmd_ws_release`
    // comment; left uncorrected, the phone tells the operator the opposite of
    // what the box will do.
    renderSheet(heldSession());
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    const text = screen.getByText(/released —/).textContent ?? '';
    expect(text).toMatch(/open run/i);
    expect(text).toMatch(/may/);              // still a MAY, never a WILL
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
