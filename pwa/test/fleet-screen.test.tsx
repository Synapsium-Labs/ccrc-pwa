import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SPAWN_STALL_MS, type FleetSession, type RunSummary } from '../../shared/api';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { ack, FEED_ACK_KEY, loadAcks, resetAcks } from '../src/lib/seen';
import { navigate } from '../src/lib/router';
import { FleetScreen } from '../src/screens/FleetScreen';
import { AccountsStrip } from '../src/fleet/AccountsStrip';
import { ToastHost } from '../src/components/Toast';
import { TEST_ROSTER } from './rosterFixture';

// foldState.ts persists to localStorage — clear it so one test's fold can
// never leak into the next's initial (expanded) expectation. `resetAcks` for
// the watermark's half: seen.ts holds its map for the document's lifetime and
// never re-reads storage (that is what stops a refused write being rolled
// back a tick later), so clearing the key alone leaves one test's acks
// clearing the next test's badges.
beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
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

/** A real `AccountsResponse` for `GET /api/accounts` — the reap-flow fetch
 *  stubs below used to fall through to a bare `new Response('{}')` for it
 *  (a wire shape the server never sends, since `accounts`/`projected`/
 *  `roster` are none of them optional). AccountsStrip and the fleet store's
 *  own roster poll both hit this route on every FleetScreen mount, so those
 *  guards were load-bearing for this suite rather than a production-only
 *  boundary check (fix round 1). */
const accountsRoute = (): Response =>
  new Response(JSON.stringify({ accounts: [], projected: null, roster: TEST_ROSTER }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

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
  hookState: null, askSummary: null, subagents: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, substrate: null, started: true, spawnState: null,
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
      roster: TEST_ROSTER,
      sessions: [
        session({
          id: 'claude:OpenClawHetzner',
          status: 'busy',
          bucket: 'working',
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
    expect(screen.getAllByText('team·alt').length).toBeGreaterThan(0);

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
    seed(store, { conn: 'open', sessions: [session({ dialogPending: true, bucket: 'attention' })] });

    // The attention SENTENCE is gone from the line (SessionLine.tsx) — it
    // becomes the dot plus the bare word "waiting". The badge now lives twice:
    // once on the line's own lamp, once on the project header (proj-card-attn),
    // which is what lets a fold never hide it.
    expect(screen.getByText('waiting')).toBeInTheDocument();
    expect(screen.getAllByRole('img', { name: 'waiting on you' })).toHaveLength(2);
  });

  // Task 6 deleted SessionLine's defensive client-side OR of
  // `hookState === 'waiting'` into dialogPending — the server already folds
  // that into `bucket` (shared/api.ts's `sessionBucket`), and the client no
  // longer re-derives it. A session the default fixture calls `idle` reads
  // `idle`, even with a hook actively reporting `waiting`.
  it('does not render the waiting treatment from hookState alone — only the server bucket decides', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ dialogPending: false, hookState: 'waiting', bucket: 'idle' })],
    });

    expect(screen.queryByText('waiting')).not.toBeInTheDocument();
    expect(screen.getByText('idle')).toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'waiting on you' })).not.toBeInTheDocument();
  });

  it('renders the subagent chip on the line when the hook reports subagents running', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ subagents: [{ name: 'reviewer', startedAt: 1 }] })],
    });

    expect(screen.getByLabelText('1 subagent')).toHaveTextContent('⑂ 1');
  });

  it('shows the muted ask summary line under a waiting session', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ hookState: 'waiting', askSummary: 'Deploy now?' })],
    });

    expect(screen.getByText('Deploy now?')).toBeInTheDocument();
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

  // Review fix: AccountsStrip is the app's only door to /accounts (Task 6).
  // It used to sit inside the populated arm only, so a phone that had never
  // started a session — the first-run block is exactly what a brand-new
  // fleet renders — had no accounts strip and so no way to reach /accounts
  // at all. Same gap in the loading branch: a fleet mid-first-connect also
  // rendered no strip.
  it('renders the accounts strip in the first-run block, not just the populated fleet', async () => {
    vi.spyOn(api, 'accounts').mockResolvedValue({
      accounts: [{ wrapper: 'claude', five: 0, seven: 0, ts: null, fiveResetAt: null, sevenResetAt: null, fiveRolledOver: false, sevenRolledOver: false, disabled: false }],
      projected: { wrapper: 'claude', score: 0 },
      roster: [],
    });
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [] });

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: 'account usage — open accounts' })).toBeInTheDocument();
  });

  it('renders the accounts strip during the initial skeleton load, not just once sessions are known', () => {
    vi.spyOn(api, 'accounts').mockReturnValue(new Promise(() => {}));
    const store = makeStore();
    render(<FleetScreen store={store} />);
    // untouched store: conn 'connecting', no sessions — same state as the
    // skeleton test above.
    expect(screen.getByRole('link', { name: 'account usage — open accounts' })).toBeInTheDocument();
  });

  // Fix round 1, Task 4, finding 5: MailBadge is D-2's ENTIRE remedy — the
  // only door to /mail — and nothing pinned it at its mount point. Deleting
  // `<MailBadge unread={unreadMail} />` from `.fleet-head-right` (and its
  // import) left the full 1253-test suite green, because the door is only
  // ever rendered standalone in mail-screen.test.tsx and tap-targets.test.tsx
  // — never inside the screen that hosts it. This is the AccountsStrip pair's
  // twin (see the review fix above): the door is present in the first-run
  // block AND during the skeleton load, not only once the fleet is
  // populated.
  it('renders the mail door in the first-run block, not just the populated fleet', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [] });

    expect(screen.getByText('No sessions yet')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /mail/i })).toHaveClass('mail-badge');
  });

  it('renders the mail door during the initial skeleton load, not just once sessions are known', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    // untouched store: conn 'connecting', no sessions — same state as the
    // skeleton test above.
    expect(screen.getByRole('button', { name: /mail/i })).toHaveClass('mail-badge');
  });

  // The `unreadMail` derivation (FleetScreen.tsx, beside `countLine`) was
  // likewise untested: replacing it with a literal `0` (badge permanently
  // silent) or with `feed.length` (badge ignores the watermark entirely)
  // survived the full suite too. This seeds one record either side of a
  // `FEED_ACK_KEY` ack and reads the count off the badge's own accessible
  // name — the same `isUnseenAt` comparison the bucket chips use.
  it("the mail door's count is the feed filtered through the SAME isUnseenAt comparison the bucket chips use", () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    const stamp = Date.now();
    act(() => { ack(FEED_ACK_KEY, stamp); });
    seed(store, {
      conn: 'open',
      sessions: [],
      feed: [
        { seq: 1, at: stamp - 60_000, kind: 'mail', sessionId: 'x', title: 'read already', body: '' },
        { seq: 2, at: stamp + 60_000, kind: 'mail', sessionId: 'x', title: 'unread', body: '' },
      ],
    });
    expect(screen.getByRole('button', { name: /mail — 1 unread/i })).toBeInTheDocument();
  });

  it('renders notices as dismissible banners', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session()],
      notices: [{ id: 1, message: 'OpenClawHetzner moved to team·alt' }],
    });

    expect(screen.getByText('OpenClawHetzner moved to team·alt')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByText('OpenClawHetzner moved to team·alt')).not.toBeInTheDocument();
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
    // ccd now REFUSES a second concurrent ws-add per project
    // (`busy: another ws-add for <project> is in flight`), so this in-flight state
    // is a courtesy that saves a round trip — see FleetScreen's own note. It is no
    // longer the only thing standing between a double-tap and two worktrees.
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
      transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'z'.repeat(64), sentence: '',
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
        if (String(url).includes('/api/accounts')) return accountsRoute();
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({
          id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 1785300000,
          // The archived BUCKET, which is what puts it behind the sub-fold —
          // groupFleet splits on `bucket`, not on `archivedAt` (a merged
          // workspace has both and belongs on the live list under Cleanup).
          bucket: 'archived',
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
        if (String(url).includes('/api/accounts')) return accountsRoute();
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({
          id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 1785300000,
          // The archived BUCKET, which is what puts it behind the sub-fold —
          // groupFleet splits on `bucket`, not on `archivedAt` (a merged
          // workspace has both and belongs on the live list under Cleanup).
          bucket: 'archived',
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
        if (String(url).includes('/api/accounts')) return accountsRoute();
        return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
      }));
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [
          session({ id: 'alpha-id', project: 'omega', workspace: 'alpha', archivedAt: 1785300000, bucket: 'archived' }),
          session({ id: 'bravo-id', project: 'omega', workspace: 'bravo', archivedAt: 1785300000, bucket: 'archived' }),
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

// — bucket sections (Task 6) —
//
// "Above the project cards" — a chip per non-empty bucket, counts read from
// the SAME `sessions` array the project cards below iterate, so the head can
// never disagree with its own rows.
describe('bucket sections', () => {
  it('renders one section per non-empty bucket, in RANK order, and none for an empty one', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'attention' }),
        session({ id: 'b', project: 'beta', bucket: 'working' }),
        session({ id: 'c', project: 'gamma', bucket: 'idle' }),
      ],
    });

    const heads = screen.getAllByText(/^(Attention|Working|Done|Idle|Cleanup|Archived|Dead)$/);
    expect(heads.map((h) => h.textContent)).toEqual(['Attention', 'Idle', 'Working']);
    // No section rendered for a bucket with zero members.
    expect(screen.queryByText('Done')).not.toBeInTheDocument();
    expect(screen.queryByText('Cleanup')).not.toBeInTheDocument();
    expect(screen.queryByText('Dead')).not.toBeInTheDocument();
  });

  it('counts from the same array the rows render, not a second tally', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'working' }),
        session({ id: 'b', project: 'beta', bucket: 'working' }),
        session({ id: 'c', project: 'gamma', bucket: 'working' }),
      ],
    });

    const head = screen.getByText('Working').closest('.bucket-head') as HTMLElement;
    expect(within(head).getByText('3')).toBeInTheDocument();
  });

  it('shows no unseen badge or Mark-all-seen control when nothing is unseen', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', bucket: 'idle' })],
    });

    const head = screen.getByText('Idle').closest('.bucket-head') as HTMLElement;
    expect(within(head).queryByRole('button', { name: /^mark all .+ seen$/i })).not.toBeInTheDocument();
  });

  it('badges an unseen session in a badged bucket, with a Mark all seen control', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince: Date.now() })],
    });

    const head = screen.getByText('Attention').closest('.bucket-head') as HTMLElement;
    expect(within(head).getByLabelText('1 unseen')).toBeInTheDocument();
    expect(within(head).getByRole('button', { name: /^mark all .+ seen$/i })).toBeInTheDocument();
  });

  // `working`/`idle` are never badged, even with a fresh bucketSince — only
  // attention/done/cleanup ask for a human (pwa/src/lib/seen.ts's `BADGED`).
  it('never badges a working or idle session, however fresh', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', bucket: 'working', bucketSince: Date.now() })],
    });

    const head = screen.getByText('Working').closest('.bucket-head') as HTMLElement;
    expect(within(head).queryByRole('button', { name: /^mark all .+ seen$/i })).not.toBeInTheDocument();
  });

  it('clicking Mark all seen acks every session in THAT bucket, and only that bucket', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince: Date.now() }),
        session({ id: 'b', project: 'beta', bucket: 'done', bucketSince: Date.now() }),
      ],
    });

    const attnHead = screen.getByText('Attention').closest('.bucket-head') as HTMLElement;
    fireEvent.click(within(attnHead).getByRole('button', { name: /^mark all .+ seen$/i }));

    // The acked bucket's badge is gone…
    expect(within(attnHead).queryByLabelText(/unseen/)).not.toBeInTheDocument();
    // …the untouched bucket's is not.
    const doneHead = screen.getByText('Done').closest('.bucket-head') as HTMLElement;
    expect(within(doneHead).getByLabelText('1 unseen')).toBeInTheDocument();
  });

  it('the ack survives a remount — it is written through to localStorage, not held only in state', () => {
    const bucketSince = Date.now() - 60_000; // fixed instant, strictly before the click below
    const store = makeStore();
    const first = render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince })],
    });
    fireEvent.click(screen.getByRole('button', { name: /^mark all .+ seen$/i }));
    first.unmount();

    // Same session, same bucketSince — a stale in-memory `acks` (never
    // reloaded from localStorage on this fresh mount) would still show the
    // control, since nothing else in this render path re-acks it.
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince })],
    });
    expect(screen.queryByRole('button', { name: /^mark all .+ seen$/i })).not.toBeInTheDocument();
  });

  it('prunes an acked session that has since left the fleet — the map does not grow unbounded', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'gone', project: 'alpha', bucket: 'attention', bucketSince: Date.now() })],
    });
    fireEvent.click(screen.getByRole('button', { name: /^mark all .+ seen$/i }));
    expect(loadAcks()).toHaveProperty('gone');

    // A fresh snapshot that no longer includes 'gone' — the effect prunes it.
    seed(store, { sessions: [session({ id: 'still-here', project: 'beta', bucket: 'idle' })] });
    expect(loadAcks()).not.toHaveProperty('gone');
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

  it('reads Archived on disk · count · total bytes across every project, and routes to /archive on tap', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: 1_200_000_000 }),
        session({ id: 'b', project: 'beta', workspace: 'still-cove', archivedAt: 200, archivedBytes: 1_100_000_000 }),
      ],
    });
    const row = screen.getByRole('button', { name: /archived on disk · 2 · 2\.3 gb/i });
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
    expect(screen.getByRole('button', { name: /^archived on disk · 2 · 1\.2 gb \+ 1 unmeasured$/i })).toBeInTheDocument();
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
    expect(screen.getByRole('button', { name: /^archived on disk · 3 · size unknown$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /0 B/ })).not.toBeInTheDocument();
  });

  it('does not render when nothing in the fleet is archived', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: null })],
    });
    expect(screen.queryByRole('button', { name: /^archived on disk ·/i })).not.toBeInTheDocument();
  });

  it('renders for exactly one archived workspace too — the guard is count > 0, not > 1', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', workspace: 'quiet-mesa', archivedAt: 100, archivedBytes: 1_200_000_000 })],
    });
    expect(screen.getByRole('button', { name: /archived on disk · 1 · 1\.2 gb/i })).toBeInTheDocument();
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
      // regardless of what telemetry exists — see `projectHome` in limits.ts,
      // which filters `roster.homeAble`.
      projected: { wrapper: 'claude', score: 0 },
      roster: [],
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

// — the head count, and acks arriving from another screen —
//
// Both are the same bug in two places: a second answer to a question the wire
// already answers, and a first answer that never reaches the screen.
describe('the head count', () => {
  it('reads "waiting" from the bucket, so it cannot contradict the chip below it', () => {
    // A hook wrote `waiting`, then the tmux session was killed: fleet.ts still
    // ORs the stale hook state into `dialogPending`, while the server's bucket
    // ladder checks `status === 'dead'` first. Three surfaces on one screen —
    // this head, the bucket chip, the row — must give ONE answer.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', status: 'dead', dialogPending: true, bucket: 'dead' })],
    });

    expect(screen.getByText('1 session')).toBeInTheDocument(); // not '1 session · 1 waiting'
    expect(screen.getByText('Dead')).toBeInTheDocument();
    expect(screen.getByText('exited')).toBeInTheDocument();
    expect(screen.queryByText(/waiting/)).not.toBeInTheDocument();
  });

  it('still says how many are waiting when the server says any are', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'attention' }),
        session({ id: 'b', project: 'beta', bucket: 'idle' }),
      ],
    });
    expect(screen.getByText('2 sessions · 1 waiting')).toBeInTheDocument();
  });
});

describe('an ack written by another screen', () => {
  it('clears this screen\'s badge with no new fleet snapshot', () => {
    // THE shipped path: SessionScreen acks on mount (`/s/<id>`), this screen is
    // never unmounted (app.tsx keeps it as the desktop sidebar), and a fleet
    // that has not changed emits no snapshot (watch.ts's lastJson guard) — so
    // nothing here re-reads localStorage. A merged-and-archived session's wire
    // record never changes again, so its badge used to survive until a reload.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({
        id: 'a', project: 'alpha', bucket: 'cleanup',
        bucketSince: Date.now() - MIN, archivedAt: Date.now() - MIN,
      })],
    });

    const head = (): HTMLElement => screen.getByText('Cleanup').closest('.bucket-head') as HTMLElement;
    expect(within(head()).getByLabelText('1 unseen')).toBeInTheDocument();

    // Exactly what SessionScreen's mount effect calls — same module, other screen.
    act(() => {
      ack('a', Date.now());
    });

    expect(within(head()).queryByLabelText(/unseen/)).not.toBeInTheDocument();
    expect(within(head()).queryByRole('button', { name: /^mark all .+ seen$/i })).not.toBeInTheDocument();
    // The section itself stays: the session is still in the cleanup bucket,
    // it is only no longer NEW.
    expect(within(head()).getByText('1')).toBeInTheDocument();
  });
});

// — the bucket bar's three repairs (whole-branch review, findings 1, 5 and 6)
//
// One fixture, the review's own: a project holding a merged-and-archived
// workspace (the `cleanup` bucket, with the merge facts the leapfrog bucket
// exists to surface) and a plainly-archived one.
describe('a chip never names rows that are not on the screen', () => {
  const merged = (): FleetSession => session({
    id: 'wt-merged', project: 'P', workspace: 'wt-merged',
    status: 'dead', archivedAt: 1785300000, archivedBytes: 1_200_000_000,
    pr: { phase: 'merged', number: 157, url: null, title: null, checks: null, checkNames: null,
          ahead: 0, reason: null, checkedAt: null, mergedAt: 1785300000_000, retryAt: null },
    bucket: 'cleanup', bucketSince: 1785300000_000,
  });
  const plain = (): FleetSession => session({
    id: 'wt-plain', project: 'P', workspace: 'wt-plain',
    status: 'dead', archivedAt: 1785300000, bucket: 'archived', bucketSince: 1785300000_000,
  });

  const seedBoth = (): FleetStore => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [merged(), plain()] });
    return store;
  };

  it('renders the Cleanup chip\'s row, with its merge facts, without expanding anything', () => {
    // The defect: `groupFleet` split on `archivedAt`, which is true of a
    // cleanup row too, so the chip counted `Cleanup 1` and offered "Mark all
    // seen" for a row that rendered nowhere — its word, its PR number and its
    // reclaimable size reachable only by opening a fold named after a
    // DIFFERENT bucket.
    seedBoth();
    const cleanupChip = screen.getByText('Cleanup').closest('.bucket-head') as HTMLElement;
    expect(cleanupChip.querySelector('.bucket-head-count')).toHaveTextContent('1');

    // No fold expanded, and yet:
    expect(screen.getByText('merged')).toBeInTheDocument();
    expect(screen.getByText('#157')).toBeInTheDocument();
    expect(screen.getByText('1.2 GB')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'merged, ready to clean up' })).toBeInTheDocument();
  });

  it('leaves exactly the Archived chip\'s members behind the fold, at the same count', () => {
    seedBoth();
    const archivedChip = screen.getByText('Archived').closest('.bucket-head') as HTMLElement;
    expect(archivedChip.querySelector('.bucket-head-count')).toHaveTextContent('1');
    // The fold used to read `Archived (2)` under a chip reading `Archived 1`.
    expect(screen.getByRole('button', { name: /^archived \(1\)$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /archived \(2\)/i })).not.toBeInTheDocument();
  });

  it('does not put a third, larger count under the same noun', () => {
    // The footer covers the DISK set — everything with an archivedAt, merged
    // ones included, which is what makes its byte figure honest — so it is
    // legitimately 2 while both bucket surfaces say 1. It must therefore not
    // be spelled as the bare word the other two use.
    seedBoth();
    expect(screen.getByRole('button', { name: /^archived on disk · 2 · 1\.2 gb \+ 1 unmeasured$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^archived · 2/i })).not.toBeInTheDocument();
  });

  // Finding 5. Every ack control was the bare string "Mark all seen". NVDA's
  // Elements List, JAWS's button list and the VoiceOver rotor all list
  // controls by name alone, outside their containing group, so N unseen
  // buckets produced N indistinguishable entries — and picking the wrong one
  // silently clears the badge on the session Claude is still blocked on.
  it('names each ack control by its bucket, so a control list can tell them apart', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    const now = Date.now();
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince: now }),
        session({ id: 'b', project: 'beta', bucket: 'done', bucketSince: now }),
        session({ id: 'c', project: 'gamma', bucket: 'cleanup', bucketSince: now, archivedAt: 1 }),
      ],
    });

    const names = screen.getAllByRole('button', { name: /mark all/i })
      .map((b) => b.getAttribute('aria-label'));
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names).toEqual(expect.arrayContaining([
      'Mark all Attention seen', 'Mark all Done seen', 'Mark all Cleanup seen',
    ]));
  });

  // The chips are a `role="group"`, not a labelled <section>. A labelled
  // section is a `region` LANDMARK, and up to seven of them named after
  // buckets — none containing any of that bucket's sessions — turns the
  // landmark rotor into that many dead ends.
  it('adds no landmark per bucket', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'attention' }),
        session({ id: 'b', project: 'beta', bucket: 'idle' }),
      ],
    });
    expect(screen.queryAllByRole('region')).toHaveLength(0);
    expect(screen.getAllByRole('group').map((g) => g.getAttribute('aria-label')))
      .toEqual(['Attention', 'Idle']);
  });

  // Finding 6. "Mark all seen" destroys the element that was activated — both
  // it and the badge live inside `{unseenCount > 0 && …}` — so without a
  // transfer the browser drops focus to <body> and the next Tab restarts at
  // the top of the document, and a screen-reader user is told nothing at all.
  it('moves focus to the chip and announces the ack, instead of dropping to body', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince: Date.now() }),
        session({ id: 'b', project: 'beta', bucket: 'attention', bucketSince: Date.now() }),
      ],
    });

    const chip = screen.getByText('Attention').closest('.bucket-head') as HTMLElement;
    const btn = within(chip).getByRole('button', { name: /^mark all .+ seen$/i });
    // fireEvent.click never establishes focus, which is why the suite never
    // exercised this path — focus it the way a keyboard user's Tab would.
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);

    expect(within(chip).queryByRole('button', { name: /mark all/i })).not.toBeInTheDocument();
    expect(document.activeElement).not.toBe(document.body);
    expect(document.activeElement).toBe(within(chip).getByText('Attention'));
    expect(screen.getByRole('status')).toHaveTextContent('Attention: 2 marked seen');
  });

  // Finding 4's screen-level half: the ack stamp is floored against the
  // episode's own start, so a device whose clock runs behind the fleet host
  // can still clear a badge. Before that, the chip kept its count and the
  // button kept sitting there doing visibly nothing.
  it('clears the badge even when this device\'s clock is behind the fleet host', () => {
    const serverNow = Date.now() + 90_000; // the host is 90s ahead of us
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'a', project: 'alpha', bucket: 'attention', bucketSince: serverNow })],
    });

    fireEvent.click(screen.getByRole('button', { name: /^mark all .+ seen$/i }));

    const chip = screen.getByText('Attention').closest('.bucket-head') as HTMLElement;
    expect(within(chip).queryByLabelText(/unseen/)).not.toBeInTheDocument();
    expect(within(chip).queryByRole('button', { name: /mark all/i })).not.toBeInTheDocument();
  });
});

// ── Task 4: the programme tree reaches the fleet card ───────────────────────
//
// `nestFleet` decides the shape (nestFleet.test.ts) and `ProjectCard` draws it
// (project-card.test.tsx). What is left, and only measurable here, is the WIRE:
// the `runs` frame this screen already reads for its footer count has to reach
// the cards, scoped to each card's own project, with a tick that follows the
// content the way `SessionHeader`/`ToolCard` do it. Without this, both suites
// above stay green over a screen that renders a flat list forever.

const RUN_FROZEN = 1_800_000_000_499;

const runRow = (over: Partial<RunSummary> = {}): RunSummary => ({
  id: 1, program: 'build9b', programTitle: 'Build 9b', wave: 1, waveOf: 3,
  project: 'OpenClawHetzner', sessionId: null, workspace: null, branch: null,
  state: 'dispatched', claimedBy: 'claude:OpenClawHetzner', resumed: false, clearedAt: null,
  openedAt: RUN_FROZEN - 1_000_000, dispatchStartedAt: null, dispatchedAt: null,
  closedAt: null, handoffCommit: null, items: { done: 0, total: 0 },
  unreadMail: 0, ...over,
});

describe('the programme tree on the fleet screen', () => {
  it('brackets a worker under the coordinator that owns its run', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'claude:OpenClawHetzner', workspace: 'quiet-mesa' }),
        session({ id: 'claude:worker', workspace: 'still-cove' }),
      ],
      runs: [runRow({ id: 10, sessionId: 'claude:worker' })],
      runsFrameSeen: true,
    });
    const nested = document.querySelectorAll('.proj-nest');
    expect(nested).toHaveLength(1);
    expect(nested[0]?.querySelector('.sess-label')?.textContent).toBe('still-cove');
  });

  it('scopes each card to its OWN project’s runs — a bracket never crosses cards', () => {
    // The run names a coordinator on a different project. Both sessions are on
    // screen, so a screen that handed every card every run would draw an edge
    // between two cards; the tree is per card, and the child stays flat.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [
        session({ id: 'claude:coord', project: 'alpha', workspace: 'quiet-mesa' }),
        session({ id: 'claude:worker', project: 'beta', workspace: 'still-cove' }),
      ],
      runs: [runRow({ id: 10, project: 'beta', sessionId: 'claude:worker', claimedBy: 'claude:coord' })],
      runsFrameSeen: true,
    });
    expect(document.querySelector('.proj-nest')).toBeNull();
    expect(screen.getByText('still-cove')).toBeInTheDocument();
  });

  it('renders a spawn in flight as a pending child, and ticks its clock every second', () => {
    // The cadence follows the CONTENT (`SessionHeader`/`ToolCard`'s idiom): a
    // readout rendered to the second on a 30s tick is the "board that never
    // moves" this build exists to end, one screen over.
    vi.useFakeTimers({ now: RUN_FROZEN });
    try {
      const store = makeStore();
      render(<FleetScreen store={store} />);
      seed(store, {
        conn: 'open',
        sessions: [session({ id: 'claude:OpenClawHetzner', workspace: 'quiet-mesa' })],
        runs: [runRow({ id: 12, wave: 2, state: 'planned', dispatchStartedAt: RUN_FROZEN - 42_000 })],
        runsFrameSeen: true,
      });
      expect(screen.getByText('spawning a worker')).toBeInTheDocument();
      expect(screen.getByText('0:42')).toBeInTheDocument();
      act(() => { vi.advanceTimersByTime(3_000); });
      expect(screen.getByText('0:45')).toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });

  // ── the tick is a GATE, and nothing was measuring it ──────────────────────
  //
  // This screen asks `useNow(1_000, anyDispatchPending(activeRuns))`, and the
  // second argument is the whole claim: NO timer at all in the ordinary case,
  // which is how the fleet screen has always behaved and what keeps a
  // twenty-row list off a permanent one-second re-render loop. Nothing
  // measured it — dropping the gate to a bare `useNow(1_000)` left the full
  // package GREEN, 74 files / 1900 tests (measured, Task 4's review round), so
  // a standing interval could ship in silence. The pin below is the twin of
  // `runs-screen.test.tsx`'s "asks for the slow cadence when no row is
  // spawning", and it is here for the reason stated there: an affordance that
  // is always on is not a gate.

  /** Every interval FleetScreen's tree asks the timer for during one mount,
   *  in ms.
   *
   *  THE ADAPTATION against the runs-screen twin, which asserts on the whole
   *  recorded array: that tree is single-interval, and this one is not.
   *  `useProjectedHome` (20_000), `AccountsStrip` (20_000 for its poll and
   *  30_000 for its own `useNow`), `FleetHostBanner` (15_000 + 30_000) and
   *  `HotFilesStrip` (30_000) all start polling from this screen's mount, and
   *  none of them is what this gate decides — so the instrument is the
   *  PRESENCE of `1_000` among the recorded intervals, not their sequence.
   *  Measured across `pwa/src`: no other timer in this tree has a 1_000 ms
   *  period (the nearest neighbour is `TypedLabel`'s 28 ms typing timer), so a
   *  recorded 1_000 is `useNow`'s and nobody else's.
   *
   *  `mockRestore()` BEFORE `useRealTimers()`, deliberately — the note travels
   *  with the harness: the spy wraps the FAKE `setInterval`, and unwinding the
   *  other way round hands the global back the fake after the fake clock has
   *  already been uninstalled, leaking a timer into the NEXT file rather than
   *  failing in this one. */
  const ticksOf = (mount: () => void): number[] => {
    vi.useFakeTimers({ now: RUN_FROZEN });
    const spy = vi.spyOn(globalThis, 'setInterval');
    try {
      mount();
      return spy.mock.calls.map((c) => Number(c[1]));
    } finally {
      spy.mockRestore();
      vi.useRealTimers();
      cleanup();
    }
  };

  /** One mount of the screen with these runs on the single card's project —
   *  the same seed the cases above use, minus the assertions. */
  const withRuns = (runs: RunSummary[]) => (): void => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'claude:OpenClawHetzner', workspace: 'quiet-mesa' })],
      runs,
      runsFrameSeen: true,
    });
  };

  it('asks for the one-second tick only while something is spawning — both directions, or it is not a gate', () => {
    expect(ticksOf(withRuns([]))).not.toContain(1_000);
    expect(ticksOf(withRuns([runRow({ id: 12, state: 'planned', dispatchStartedAt: null })])))
      .not.toContain(1_000);
    // The case a gate reading the FIELD instead of asking `dispatchWindow`
    // would fail: the stamp SURVIVES success (§Design — a measurement, never
    // cleared), so such a gate would tick once a second for every run this
    // fleet has ever dispatched, forever, over a card with nothing to narrate.
    expect(ticksOf(withRuns([runRow({
      id: 12, state: 'dispatched', dispatchStartedAt: RUN_FROZEN - 42_000, dispatchedAt: RUN_FROZEN - 1_000,
    })]))).not.toContain(1_000);
    // And the direction that pays for the timer: a spawn in flight is a
    // second-granular readout, so the card gets a second-granular clock.
    expect(ticksOf(withRuns([runRow({ id: 12, state: 'planned', dispatchStartedAt: RUN_FROZEN - 42_000 })])))
      .toContain(1_000);
    // The wedge keeps it too — the pending child still renders its own elapsed
    // span to the second and the run is still `planned`: the window has not
    // closed, it has gone bad.
    expect(ticksOf(withRuns([runRow({ id: 12, state: 'planned', dispatchStartedAt: RUN_FROZEN - SPAWN_STALL_MS })])))
      .toContain(1_000);
  });

  it('does not render a pending child for a dispatched run whose stamp merely survived', () => {
    // §Design: the stamp is a MEASUREMENT and is never cleared, so `state` is
    // the whole of what ends this row. A card that keyed on the timestamp
    // alone would claim every worker on the fleet is still being spawned.
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      sessions: [session({ id: 'claude:OpenClawHetzner', workspace: 'quiet-mesa' })],
      runs: [runRow({ id: 12, state: 'dispatched', dispatchStartedAt: Date.now() - 42_000 })],
      runsFrameSeen: true,
    });
    expect(document.querySelector('.proj-pending')).toBeNull();
  });
});
