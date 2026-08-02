import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { FleetSession } from '../../shared/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { navigate } from '../src/lib/router';
import { FleetScreen } from '../src/screens/FleetScreen';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { ToastHost } from '../src/components/Toast';

// foldState.ts persists to localStorage — clear it so one test's fold can
// never leak into the next's initial (expanded) expectation.
beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

// — fixtures —

const MIN = 60_000;

/** Stubs the real `fetch` (not the `api` module) so a request runs through
 *  the actual `ApiError` construction — this is the only way to exercise the
 *  `body.stderr` vs `body.error` translation that `apiErrorText` handles and
 *  a raw `err.message` does not. Mirrors the server's real 502 shape for a
 *  failed lifecycle route (`{ ok: false, stderr }`, no `error` key).
 *
 *  Unlike the sibling helper in session-card.test.tsx, this mounts the full
 *  FleetScreen tree — AccountsStrip and FleetHostBanner also call fetch on
 *  mount (api.accounts / api.fleetHealth), and a Response body can only be
 *  read once. A single shared `mockResolvedValue(response)` would let the
 *  first of those consume the body, leaving later callers (our click) with
 *  an empty, already-read stream — so this hands back a fresh Response
 *  per call instead. */
const stubFetch502 = (stderr: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify({ ok: false, stderr }), {
          status: 502,
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
};

const session = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/home/rc/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: Date.now() - 2 * MIN,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  version: '2.1.0',
  ...over,
});

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless. */
const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close(): void {},
      }) as unknown as WebSocket,
  });

const seed = (store: FleetStore, patch: Partial<ReturnType<FleetStore['getState']>>): void => {
  act(() => {
    store.setState(patch);
  });
};

// — FleetScreen —

describe('FleetScreen', () => {
  it('renders a card per session with account label and status word', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({
          id: 'claude:OpenClawHetzner',
          status: 'busy',
          statusUpdatedAt: Date.now() - 4 * MIN,
        }),
        session({
          id: 'claude2:mekwarlive',
          wrapper: 'claude2',
          project: 'mekwarlive',
          status: 'idle',
        }),
      ],
    });

    // Both cards, titled by project, with jargon-free account labels. The
    // account label also appears once in the accounts strip, so allow multiples.
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
    expect(screen.getByText('mekwarlive')).toBeInTheDocument();
    expect(screen.getAllByText('team·max').length).toBeGreaterThan(0);
    expect(screen.getAllByText('alt·max').length).toBeGreaterThan(0);

    // Status is dot + word, never dot alone. SessionLine (unlike the SessionCard
    // it replaces) carries no relative timestamp — that's cut, not moved.
    expect(screen.getByRole('img', { name: 'working' })).toBeInTheDocument();
    expect(screen.getByText('working')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'idle' })).toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
  });

  it('shows the attention badge when a dialog is pending', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session({ dialogPending: true })] });

    // The attention SENTENCE is gone from the line (SessionLine.tsx) — it
    // becomes the dot plus the bare word "waiting". The badge now lives twice:
    // once on the line's own lamp, once on the project header (proj-card-attn),
    // which is what lets a fold never hide it.
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'waiting on you' })).toHaveLength(2);
  });

  it("shows a persistent offline banner when conn is 'down', keeping last-known cards", () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'down', sessions: [session()] });

    expect(screen.getByText('Reconnecting…')).toBeInTheDocument();
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
  });

  it('renders the first-run block when the fleet is empty and connected', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [] });

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start a session' })).toBeInTheDocument();
  });

  it('renders 3 skeleton cards while connecting with nothing known', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    // untouched store: conn 'connecting', no sessions
    expect(screen.getAllByRole('status', { name: 'Loading' })).toHaveLength(3);
  });

  it('renders notices as dismissible banners', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session()],
      notices: [{ id: 1, message: 'OpenClawHetzner moved to alt·max' }],
    });

    expect(screen.getByText('OpenClawHetzner moved to alt·max')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('OpenClawHetzner moved to alt·max')).not.toBeInTheDocument();
  });

  it('creates a workspace on the tapped project', async () => {
    const calls: string[] = [];
    vi.spyOn(api, 'workspaceAdd').mockImplementation(async (p: string) => {
      calls.push(p);
    });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha' }),
        session({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(calls).toEqual(['alpha']));
  });

  it('surfaces a failure as a toast rather than a silent no-op', async () => {
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(new Error('no origin/HEAD'));
    const store = makeStore();
    render(
      <>
        <FleetScreen store={store} />
        <ToastHost />
      </>,
    );
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha' }),
        session({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(screen.getByText(/no origin\/HEAD/)).toBeInTheDocument());
  });

  it('offers a + on a project holding a single session', () => {
    // Every one of the nine live projects holds exactly one session, so a +
    // that only exists on grouped headers exists nowhere at all.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session({ id: 'a', project: 'solo' })] });

    expect(screen.getByRole('button', { name: /New workspace on solo/i })).toBeInTheDocument();
  });

  it('disables a + while its own ws-add is in flight, per project', async () => {
    // ccd does NOT dedupe: ws-add draws a fresh random slug each call and only
    // checks it against the registry, so two concurrent calls both succeed —
    // two worktrees, two branches, two systemd units, two of three account
    // lanes gone. The window is _spawn plus _accept_first_run_prompts, up to
    // ~15 minutes, with no feedback whatsoever.
    let release!: () => void;
    const add = vi.spyOn(api, 'workspaceAdd').mockImplementation(
      () => new Promise<void>((resolve) => { release = resolve; }),
    );
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha' }), session({ id: 'b', project: 'beta' })],
    });

    const alpha = screen.getByRole('button', { name: /New workspace on alpha/i });
    const beta = screen.getByRole('button', { name: /New workspace on beta/i });
    fireEvent.click(alpha);
    await waitFor(() => expect(alpha).toBeDisabled());

    // A second tap on the same project is refused…
    fireEvent.click(alpha);
    expect(add).toHaveBeenCalledTimes(1);
    // …while another project's + is untouched: the guard is per project.
    expect(beta).not.toBeDisabled();

    await act(async () => { release(); });
    await waitFor(() => expect(alpha).not.toBeDisabled());
  });

  it('re-enables the + after a FAILED ws-add, so a refusal is not a dead button', async () => {
    let reject!: (e: Error) => void;
    vi.spyOn(api, 'workspaceAdd').mockImplementation(
      () => new Promise<void>((_resolve, r) => { reject = r; }),
    );
    const store = makeStore();
    render(
      <>
        <FleetScreen store={store} />
        <ToastHost />
      </>,
    );
    seed(store, { conn: 'open', sessions: [session({ id: 'a', project: 'alpha' })] });

    const plus = screen.getByRole('button', { name: /New workspace on alpha/i });
    fireEvent.click(plus);
    await waitFor(() => expect(plus).toBeDisabled());
    await act(async () => { reject(new Error('no origin/HEAD')); });
    await waitFor(() => expect(plus).not.toBeDisabled());
  });

  it("surfaces ccd's stderr from a real 502, not a generic request-failed message", async () => {
    // Goes through the REAL fetch → ApiError path (unlike the mocked-api test
    // above), which is the only way to observe the body.stderr vs body.error
    // translation that apiErrorText performs and a raw err.message does not.
    stubFetch502('no origin/HEAD — run: git -C /repo remote set-head origin -a');
    const store = makeStore();
    render(
      <>
        <FleetScreen store={store} />
        <ToastHost />
      </>,
    );
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha' }),
        session({ id: 'b', project: 'alpha', workspace: 'quiet-mesa' }),
      ],
    });

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() =>
      expect(screen.getByText(/origin\/HEAD — run: git -C \/repo remote set-head/))
        .toBeInTheDocument());
    expect(screen.queryByText(/request failed/)).toBeNull();
  });

  it('keeps a project folded across a remount', async () => {
    // The whole reason fold state left useState: navigating into a session and
    // back re-expanded everything.
    const store = makeStore();
    const first = render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session({ id: 'a', project: 'alpha' })] });

    await userEvent.click(screen.getByRole('button', { expanded: true }));
    first.unmount();

    render(<FleetScreen store={store} />);
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument();
  });

  // Whole-branch review, findings 2/3/5: the actions sheet used to be fed a
  // FleetSession captured at tap time (FleetScreen held `actionsFor` as the
  // session itself) and unmounted the instant it closed (nulling the session
  // in the same commit that flipped `open`). That both popped the sheet out
  // of existence instead of letting vaul animate its exit, AND froze whatever
  // the line looked like at tap time even if the fleet moved on.
  describe('actions sheet lifecycle', () => {
    it('keeps the limit note current with a live fleet update (Finding 5)', async () => {
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({
          id: 'a', project: 'alpha', workspace: 'quiet-mesa',
          limits: { five: 10, seven: 10 },
        })],
      });

      fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
      expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();

      // The SAME id, a fresh limits snapshot — the sheet is still open.
      seed(store, {
        sessions: [session({
          id: 'a', project: 'alpha', workspace: 'quiet-mesa',
          limits: { five: 90, seven: 10 },
        })],
      });

      expect(await screen.findByText(/5h limit near/i)).toBeInTheDocument();
    });

    it(
      'closes over its last snapshot when its session vanishes, and never leaks ' +
      'swapOpen to the next session tapped (Findings 2, 3, 5)',
      async () => {
        const store = makeStore();
        render(<FleetScreen store={store} />);
        seed(store, {
          conn: 'open',
          sessions: [
            session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa' }),
            session({ id: 'b', project: 'beta', workspace: 'brave-elm' }),
          ],
        });

        fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
        fireEvent.click(screen.getByRole('button', { name: /swap account/i }));
        expect(screen.getByText(/pick where it should live/i)).toBeInTheDocument();

        // Session a is gone from the fleet entirely — nothing left to act on.
        seed(store, { sessions: [session({ id: 'b', project: 'beta', workspace: 'brave-elm' })] });

        // The sheet (and its stacked SwapSheet) close rather than freezing open
        // on stale data forever.
        await waitFor(() =>
          expect(screen.queryByText(/pick where it should live/i)).not.toBeInTheDocument());

        // A stale swapOpen would show SwapSheet already stacked on the very
        // next session tapped, rather than the plain actions list.
        fireEvent.click(screen.getByRole('button', { name: /actions for brave-elm/i }));
        expect(screen.getByRole('button', { name: /restart session/i })).toBeInTheDocument();
        expect(screen.queryByText(/pick where it should live/i)).not.toBeInTheDocument();
      },
    );
  });

  describe('the guarded reap flow (Task 17)', () => {
    const wsAudit = {
      id: 'a', branch: 'ws/quiet-mesa', base: 'origin/main', workdir: '/w/alpha/quiet-mesa',
      project: 'alpha', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
      dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0,
      clips: [], stashes: 0, worktreeBytes: 900_000_000, commitsAheadOfBase: 1,
      pr: { number: 9, url: 'u', mergeCommit: 'x', headRefOid: 'y' },
      merge: { proof: 'ancestor', fetchedAt: Math.floor(Date.now() / 1000) },
      transcript: '/t.jsonl', verdict: 'reapable', detail: '', token: 'z'.repeat(64), sentence: '',
    };

    it("the fleet line's Clean up workspace… opens the REAL ReapSheet for THAT session", async () => {
      // SessionActionsSheet's own suite (session-actions-sheet.test.tsx) only
      // proves the button calls `onReap(id)` against a spy — it never mounts
      // FleetScreen, so `onReap={setReapId}` and the `<ReapSheet .../>` mount
      // fed by `sessions.find((sn) => sn.id === reapId)` could both be gutted
      // with that suite staying green. This drives the real tap-through and
      // checks the real sheet fetched THIS session's audit.
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (String(url).includes('/workspace/audit')) {
          return new Response(JSON.stringify(wsAudit), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({
          id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 1785300000,
        })],
      });

      // Archived (Task 18): folded out of the live list by default, so its
      // row — and the ··· that opens this sheet — only reaches the DOM once
      // the Archived (1) sub-fold is expanded.
      fireEvent.click(screen.getByRole('button', { name: /archived \(1\)/i }));
      fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
      fireEvent.click(screen.getByText(/clean up workspace/i));

      expect(await screen.findByText('/w/alpha/quiet-mesa')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: /Remove quiet-mesa/ })).toBeInTheDocument();
    });

    it('completing a reap closes the sheet — `onReaped={() => setReapId(null)}` is not dead wiring', async () => {
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (String(url).includes('/workspace/audit')) {
          return new Response(JSON.stringify(wsAudit), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (String(url).includes('/workspace/reap')) {
          return new Response(JSON.stringify({ reaped: 'a', branch: 'ws/quiet-mesa', attic: 1, sentence: '' }),
            { status: 200, headers: { 'content-type': 'application/json' } });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({
          id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 1785300000,
        })],
      });

      // Archived (Task 18): see the sibling test above for why this fold has
      // to open first.
      fireEvent.click(screen.getByRole('button', { name: /archived \(1\)/i }));
      fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
      fireEvent.click(screen.getByText(/clean up workspace/i));
      fireEvent.click(await screen.findByRole('button', { name: /Remove quiet-mesa/ }));

      await waitFor(() => expect(screen.queryByText('/w/alpha/quiet-mesa')).not.toBeInTheDocument());
    });

    it('offers no Clean up workspace… button before the workspace is archived', () => {
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: null })],
      });
      fireEvent.click(screen.getByRole('button', { name: /actions for quiet-mesa/i }));
      expect(screen.queryByText(/clean up workspace/i)).not.toBeInTheDocument();
    });

    // Pre-merge fix round, finding 17-F1: FleetScreen keeps ONE ReapSheet
    // mounted and swaps which session it targets (`sessions.find((sn) =>
    // sn.id === reapId)`) — `load()`'s missing `setAudit(null)` meant that
    // instant re-render still showed the PREVIOUS target's audit (path,
    // bytes, token) alongside the NEW target's slug. Demonstrated exactly as
    // measured: "Remove bravo · 1.2 GB" — bravo's slug, alpha's stale bytes
    // — rendered together with alpha's still-visible "/w/ALPHA" row. The
    // real hazard: a tap there would call
    // `api.workspaceReap('bravo-id', <alpha's token>)` — one session's stale
    // token posted to another session's endpoint. `_ws_fingerprint` hashes
    // `id=`, so ccd would refuse `state-changed`, fail-closed — but display
    // integrity is this sheet's entire job.
    it('clears the stale audit — and its token — the instant the reap target switches to a different session', async () => {
      const alphaAudit = { ...wsAudit, id: 'alpha-id', workdir: '/w/ALPHA', worktreeBytes: 1_200_000_000, token: 'a'.repeat(64) };
      let resolveBravoAudit!: (r: Response) => void;
      vi.stubGlobal('fetch', vi.fn(async (url: string) => {
        if (String(url).includes('/sessions/alpha-id/workspace/audit')) {
          return new Response(JSON.stringify(alphaAudit), { status: 200, headers: { 'content-type': 'application/json' } });
        }
        if (String(url).includes('/sessions/bravo-id/workspace/audit')) {
          // Bravo's fresh audit is deliberately held pending — the fix must
          // clear alpha's stale audit the instant the target changes, not
          // leave it rendered under bravo's identity until this resolves.
          return new Promise<Response>((resolve) => { resolveBravoAudit = resolve; });
        }
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [
          session({ id: 'alpha-id', project: 'omega', workspace: 'alpha', archivedAt: 1785300000 }),
          session({ id: 'bravo-id', project: 'omega', workspace: 'bravo', archivedAt: 1785300000 }),
        ],
      });

      fireEvent.click(screen.getByRole('button', { name: /archived \(2\)/i }));
      fireEvent.click(screen.getByRole('button', { name: /actions for alpha/i }));
      fireEvent.click(screen.getByText(/clean up workspace/i));
      expect(await screen.findByText('/w/ALPHA')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Remove alpha · 1.2 GB' })).toBeInTheDocument();

      // Back out to the fleet list (both the actions sheet and the reap
      // sheet are stacked open at this point) and switch to bravo's own
      // reap flow — the ReapSheet component instance persists underneath,
      // so its `audit` state carries over unless `load()` clears it.
      let overlays = screen.queryAllByTestId('sheet-overlay');
      while (overlays.length > 0) {
        // `noUncheckedIndexedAccess`: the loop guard already proves an
        // element exists at this index.
        fireEvent.click(overlays[overlays.length - 1]!);
        overlays = screen.queryAllByTestId('sheet-overlay');
      }
      fireEvent.click(screen.getByRole('button', { name: /actions for bravo/i }));
      fireEvent.click(screen.getByText(/clean up workspace/i));

      expect(screen.queryByText('/w/ALPHA')).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /^Remove bravo/ })).not.toBeInTheDocument();
      expect(screen.getByText('Checking…')).toBeInTheDocument();

      resolveBravoAudit(new Response(JSON.stringify({
        ...wsAudit, id: 'bravo-id', workdir: '/w/BRAVO', worktreeBytes: 500_000_000, token: 'b'.repeat(64),
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
      expect(await screen.findByText('/w/BRAVO')).toBeInTheDocument();
      expect(await screen.findByRole('button', { name: 'Remove bravo · 500 MB' })).toBeInTheDocument();
    });
  });
});

// — archived footer row (Task 19) —
//
// DEVIATION from the brief's Test: list, which names only
// server/test/fleet.test.ts and the new pwa/test/archive-screen.test.tsx:
// the footer row and its /archive wiring live in FleetScreen.tsx (in the
// brief's own Modify list) and had zero behavioural coverage otherwise — a
// mutant deleting the `> 0` guard, swapping `navigate('/archive')` for a
// no-op, or breaking the count/byte interpolation would have shipped green.
// See task-19-report.md.
describe('archived footer row', () => {
  afterEach(() => navigate('/'));

  it('reads Archived · count · total bytes across every project, and routes to /archive on tap', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: 1_200_000_000 }),
        session({ id: 'b', project: 'beta', workspace: 'still-cove', archivedAt: 200, archivedBytes: 1_100_000_000 }),
      ],
    });
    const row = screen.getByRole('button', { name: /archived · 2 · 2\.3 gb/i });
    fireEvent.click(row);
    expect(location.pathname).toBe('/archive');
  });

  it('totals only what it actually knows — an unmeasured archive contributes nothing, never a fabricated 0 GB', () => {
    // The measurement rule (deviation 10, this task's ledger item): a manifest
    // that never wrote (or half-wrote) worktreeBytes must not silently sink
    // the fleet total, and the row itself must not claim "0 B" for archived-
    // but-unmeasured — both would argue against a cleanup that would free
    // real space.
    //
    // Fix round 3, verifier P3: "1.2 GB" alone was still a forgery — it is
    // the measured PART presented as the total, and nothing on screen said a
    // second workspace went uncounted. The name is asserted whole (anchored
    // both ends) because the old, unqualified text is a prefix of the new one
    // and a loose regex would match either.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: 1_200_000_000 }),
        session({ id: 'b', project: 'beta', workspace: 'still-cove', archivedAt: 200, archivedBytes: null }),
      ],
    });
    expect(screen.getByRole('button', { name: /^archived · 2 · 1\.2 gb \+ 1 unmeasured$/i })).toBeInTheDocument();
  });

  it('states no size at all when every archived workspace went unmeasured — never a confident "0 B"', () => {
    // The pure forgery case: three archives, no manifest read on any of them,
    // rendered as a stated total of zero for work that may be gigabytes.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: null }),
        session({ id: 'b', project: 'beta', workspace: 'still-cove', archivedAt: 200, archivedBytes: null }),
        session({ id: 'c', project: 'beta', workspace: 'far-shore', archivedAt: 300, archivedBytes: null }),
      ],
    });
    expect(screen.getByRole('button', { name: /^archived · 3 · size unknown$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /0 B/ })).not.toBeInTheDocument();
  });

  it('does not render when nothing in the fleet is archived', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: null })],
    });
    expect(screen.queryByRole('button', { name: /^archived ·/i })).not.toBeInTheDocument();
  });

  it('renders for exactly one archived workspace too — the guard is count > 0, not > 1', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: 1_200_000_000 })],
    });
    expect(screen.getByRole('button', { name: /archived · 1 · 1\.2 gb/i })).toBeInTheDocument();
  });
});

// — AccountsStrip —
//
// Was filed under a `describe('SessionCard', ...)` block alongside three
// tests that rendered <SessionCard> directly. SessionCard is retired (see
// SessionLine.tsx); those three were dropped as redundant with coverage that
// already exists for its replacement:
//   - "opens the session when tapped" → session-line.test.tsx
//     ("opens the session on tap")
//   - "renders the dead card muted with restart affordances" → the dead/exited
//     state is covered by session-line.test.tsx ("reads exited when dead");
//     the restart affordance itself by session-actions-sheet.test.tsx
//     ("restarts through api.ensure") and chat.test.tsx.
//   - "a session card no longer renders its own limit bars" → superseded by
//     session-line.test.tsx's own limit-bar-free rendering (SessionLine never
//     had card-style limit bars to begin with).
// This test never rendered <SessionCard> — it renders <AccountsStrip />
// directly — so it survives, renamed to match what it actually tests.
describe('AccountsStrip', () => {
  it('renders account usage from /api/accounts with a reset countdown, independent of sessions', async () => {
    const nowSec = Math.floor(Date.now() / 1000);
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [
        // gpt has NO active session, yet still shows — telemetry-driven.
        { wrapper: 'gpt', five: 8, seven: 8, ts: nowSec, fiveResetAt: nowSec + 2 * 3600, sevenResetAt: nowSec + 3 * 86400, fiveRolledOver: false, sevenRolledOver: false, disabled: false },
      ],
      // gpt is not home-able, so the projection names an Anthropic account
      // regardless of what telemetry exists — see limits.ts HOME_ABLE.
      projected: { wrapper: 'claude', score: 0 },
    });
    render(<AccountsStrip />);
    // one account gauge → two meters (5h + 7d)
    await screen.findByText('gpt');
    expect(document.querySelectorAll('.acct-fill')).toHaveLength(2);
    // reset countdown rendered ("2h" for the 5h window)
    expect(screen.getByText(/↻\s*2h/)).toBeInTheDocument();
    vi.restoreAllMocks();
  });
});
