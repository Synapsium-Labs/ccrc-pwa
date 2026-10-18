// Task 8 — SessionHeader (stop keycap gated on busy, live-name fallback),
// the screen-level api.interrupt wiring (incl. the 409 not-busy toast), and
// the visualViewport keyboard-inset hook.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { fleetSession as baseSession, hibernatedSession } from './fleetFixture';
import { Sheet, ToastHost } from '@ccrc/ui';
import { api, ApiError } from '../src/lib/api';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';
import { SessionScreen, chatPulsing, useKeyboardInsets } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'visualViewport');
});

// (pointer: fine) stub — the one predicate behind both Enter-sends (Composer)
// and the esc keycap's touch-only visibility here. Unstubbed, setup.ts's
// matchMedia shim already answers `false` (touch/coarse).
const stubPointer = (fine: boolean): void => {
  vi.stubGlobal('matchMedia', (q: string) => ({
    matches: q.includes('pointer: fine') ? fine : false,
    media: q, addEventListener: () => {}, removeEventListener: () => {},
    addListener: () => {}, removeListener: () => {}, onchange: null,
    dispatchEvent: () => false,
  }));
};

// — fixtures —

const fakeSocket = (): WebSocket =>
  ({
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    close(): void {},
  }) as unknown as WebSocket;

/** A real workspace session id — ccd builds them as `$project-$slug`
 *  (ccd:738) and validates them against `^[A-Za-z0-9._-]+$` on every verb
 *  that takes one. The reap tests below use it for the session, the audit
 *  fixture and the URL alike, because that is the only combination the
 *  server can actually serve (fix round 3, verifier P4). */
const WS_ID = 'OpenClawHetzner-quiet-basin';

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => (baseSession({ id: 'claude:OpenClawHetzner', home: '/home/rc', project: 'OpenClawHetzner', workdir: '/root/projects/OpenClawHetzner', ...patch }));

/** Full SessionHeaderProps with no-op callbacks — build it, don't render it,
 *  so tests that need to compose SessionHeader alongside sibling elements
 *  (the Escape-while-typing case) can render for themselves. */
const props = (over: Partial<SessionHeaderProps> = {}): SessionHeaderProps => ({
  session: fleetSession(),
  status: 'idle',
  statusUpdatedAt: null,
  onInterrupt: vi.fn(),
  onOpenTerminal: vi.fn(),
  onBack: vi.fn(),
  onChangeModel: vi.fn(),
  onChangeEffort: vi.fn(),
  onMoveAccount: vi.fn(),
  onArchive: vi.fn(),
  onRestore: vi.fn(),
  onOpenHistory: vi.fn(),
  onReapWorkspace: vi.fn(),
  roster: TEST_ROSTER,
  ...over,
});

const renderHeader = (over: Partial<SessionHeaderProps> = {}): SessionHeaderProps => {
  const p = props(over);
  render(<SessionHeader {...p} />);
  return p;
};

// — SessionHeader —

describe('SessionHeader', () => {
  it('keeps the stop keycap disabled while idle', () => {
    const props = renderHeader();
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeDisabled();
    fireEvent.click(stop);
    expect(props.onInterrupt).not.toHaveBeenCalled();
  });

  it('enables the stop keycap while busy and fires onInterrupt', () => {
    const props = renderHeader({
      status: 'busy',
      session: fleetSession({ status: 'busy', bucket: 'working' }),
    });
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(props.onInterrupt).toHaveBeenCalledOnce();
    // D-5237: the keycap names itself as the interrupt's source.
    expect(props.onInterrupt).toHaveBeenCalledWith('keycap');
    expect(screen.getByText(/working/)).toBeInTheDocument();
  });

  // This header reads the SERVER's bucket, like every fleet surface. It used
  // to OR dialogPending/hookState into an `attention` of its own — a second
  // writer for a fact the wire carries, and the reason one snapshot could say
  // two different things about one session on two screens.
  it('shows the attention word when the server buckets it attention', () => {
    // NEITHER raw signal is set. With `hookState: 'waiting'` in the fixture
    // this passed under the very OR it was written to prove gone — the
    // deleted code would have manufactured the same word from the hook.
    renderHeader({
      session: fleetSession({ dialogPending: false, hookState: null, bucket: 'attention' }),
    });
    expect(screen.getByText('waiting on you')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'waiting on you' })).toBeInTheDocument();
  });

  // The one direction the live stream still outranks the snapshot. Making
  // this header snapshot-first dropped the override entirely, so a session
  // its OWN socket has already reported dead kept pulsing amber "waiting on
  // you" — the header contradicting the stream it is attached to, over the
  // state that asks the reader to act on a process that is gone.
  it('says the session is not running once its own stream reports it dead', () => {
    renderHeader({
      status: 'dead',
      session: fleetSession({ status: 'busy', dialogPending: true, bucket: 'attention' }),
    });
    expect(screen.getByText('not running')).toBeInTheDocument();
    expect(screen.queryByText('waiting on you')).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'not running' })).toBeInTheDocument();
  });

  it('never lets a dead stream bury an archived workspace\'s own bucket', () => {
    // `ws-archive` STOPS the session, so `dead` is true of every archived
    // row by construction — the override must not fire there, or `cleanup`
    // loses the merge facts the leapfrog bucket exists for.
    renderHeader({
      status: 'dead',
      session: fleetSession({
        status: 'dead', archivedAt: 1785300000, bucket: 'cleanup',
        pr: { phase: 'merged', number: 157, url: null, title: null, checks: null,
              checkNames: null, ahead: 0, reason: null, checkedAt: null,
              mergedAt: 1785300000_000, retryAt: null },
      }),
    });
    expect(screen.getByText('merged, ready to clean up')).toBeInTheDocument();
    expect(screen.queryByText('not running')).not.toBeInTheDocument();
  });

  it('does not manufacture the attention treatment from hookState or dialogPending', () => {
    // The mirror of fleet-screen.test.tsx's own "only the server bucket
    // decides": both raw signals set, the bucket says idle, so the header
    // says idle — the server had those same fields and a ladder of evidence
    // this component does not (shared/api.ts's sessionBucket).
    renderHeader({
      session: fleetSession({ dialogPending: true, hookState: 'waiting', bucket: 'idle' }),
    });
    expect(screen.queryByText('waiting on you')).not.toBeInTheDocument();
    expect(screen.queryByRole('img', { name: 'waiting on you' })).not.toBeInTheDocument();
  });

  it('says finished for a done session, where the fleet row says done', () => {
    // status 'idle' + a finished hook is the `done` bucket (shared/api.ts).
    // Before this read the bucket, the row said `done` under a ✓ labelled
    // `finished` while this header said `idle` under a ○ — same session, same
    // snapshot, same instant.
    renderHeader({
      status: 'idle',
      session: fleetSession({
        status: 'idle', hookState: 'done', bucket: 'done',
        statusUpdatedAt: Date.now() - 3 * 60_000,
      }),
    });
    expect(screen.getByRole('img', { name: 'finished' })).toBeInTheDocument();
    expect(screen.getByText('done · 3m ago')).toBeInTheDocument();
  });

  it('says merged-and-ready for a cleanup session, not "not running"', () => {
    // A merged, archived workspace is `cleanup` — the row wears ♻. The header
    // used to read the raw status and call the same session dead.
    renderHeader({
      status: 'dead',
      session: fleetSession({ status: 'dead', archivedAt: 1, bucket: 'cleanup' }),
    });
    expect(screen.getByRole('img', { name: 'merged, ready to clean up' })).toBeInTheDocument();
    expect(screen.getByText('merged, ready to clean up')).toBeInTheDocument();
    expect(screen.queryByText('not running')).not.toBeInTheDocument();
  });

  it('still says not running for a dead session', () => {
    renderHeader({ status: 'dead', session: fleetSession({ status: 'dead', bucket: 'dead' }) });
    expect(screen.getByRole('img', { name: 'not running' })).toBeInTheDocument();
    expect(screen.getByText('not running')).toBeInTheDocument();
  });

  it('paints from the live status alone before the fleet snapshot lands', () => {
    // Deep link, no session record yet: there IS no bucket, so the stream's
    // status is translated into the same vocabulary rather than guessed at.
    renderHeader({ session: null, status: 'busy', statusUpdatedAt: Date.now() - 1000,
      fallback: { title: 'OpenClawHetzner', wrapper: 'claude' } });
    expect(screen.getByRole('img', { name: 'working' })).toBeInTheDocument();
  });

  it('shows the clean project name, ignoring the auto-derived session name', () => {
    // Even when Claude Code supplies a derived name like "openclawhetzner-8f",
    // the header shows the project ("OpenClawHetzner"), not the noisy name.
    renderHeader({ session: fleetSession({ name: 'openclawhetzner-8f' }) });
    expect(screen.getByRole('heading', { name: 'OpenClawHetzner' })).toBeInTheDocument();
    cleanup();
    renderHeader({ session: fleetSession({ name: null }) });
    expect(screen.getByRole('heading', { name: 'OpenClawHetzner' })).toBeInTheDocument();
  });

  it('falls back to the id-derived identity before the fleet snapshot lands', () => {
    renderHeader({
      session: null,
      fallback: { title: 'OpenClawHetzner', wrapper: 'claude' },
    });
    expect(screen.getByRole('heading', { name: 'OpenClawHetzner' })).toBeInTheDocument();
    expect(screen.getByText('team·max')).toBeInTheDocument();
  });

  it('terminal keycap and back chevron fire their callbacks', () => {
    const props = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'Terminal' }));
    expect(props.onOpenTerminal).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Back to fleet' }));
    expect(props.onBack).toHaveBeenCalledOnce();
  });

  it('a queued class write still shows the badge when the session has no model yet (fix round 2, finding 4)', () => {
    // The model chip itself only renders when `model !== null` — a freshly
    // spawned session's pane has not printed a model string yet. `effort`
    // set makes `hasMeta` true so the meta row renders at all; `model` stays
    // null so the model chip is absent and the badge has no chip to ride.
    renderHeader({
      session: fleetSession({ model: null, effort: 'medium' }),
      queuedField: 'class',
    });
    expect(screen.getByText('queued')).toBeInTheDocument();
    expect(document.querySelector('.route-queued')).toBeInTheDocument();
  });
});

describe('interrupt control', () => {
  it('renders the esc keycap on touch, where there is no Escape key', () => {
    stubPointer(false);
    render(<SessionHeader {...props({ status: 'busy' })} />);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeInTheDocument();
  });

  it('hides the keycap where a real keyboard exists', () => {
    stubPointer(true);
    render(<SessionHeader {...props({ status: 'busy' })} />);
    expect(screen.queryByRole('button', { name: 'Stop' })).not.toBeInTheDocument();
  });

  it('binds the physical Escape key in its place', () => {
    // THE test that matters. One asserting only that the cap is hidden would
    // pass a change that silently removes the ability to interrupt.
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<SessionHeader {...props({ status: 'busy', onInterrupt })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onInterrupt).toHaveBeenCalled();
    // D-5237: the physical key names itself as the interrupt's source.
    expect(onInterrupt).toHaveBeenCalledWith('escape-key');
  });

  it('does not interrupt an idle session, matching the keycap\'s disabled state', () => {
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<SessionHeader {...props({ status: 'idle', onInterrupt })} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onInterrupt).not.toHaveBeenCalled();
  });

  it('ignores Escape while typing — it dismisses, it does not interrupt', () => {
    stubPointer(true);
    const onInterrupt = vi.fn();
    render(<><textarea data-testid="box" /><SessionHeader {...props({ status: 'busy', onInterrupt })} /></>);
    const box = screen.getByTestId('box');
    box.focus();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(onInterrupt).not.toHaveBeenCalled();
  });
});

// — SessionScreen wiring —

describe('SessionScreen interrupt wiring', () => {
  const makeStores = () => {
    const store = createSessionStore('claude:OpenClawHetzner', {
      makeSocket: fakeSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({ sessions: [fleetSession({ status: 'busy' })], conn: 'open' });
    });
    return { store, fleet };
  };

  it('the stop keycap calls api.interrupt with the session id and its source (D-5237)', () => {
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { store, fleet } = makeStores();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    act(() => {
      store.setState({ uuid: 'u1', status: 'busy' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(spy).toHaveBeenCalledWith('claude:OpenClawHetzner', 'keycap');
  });

  it('a 409 not-busy answer surfaces as a quiet toast', async () => {
    vi.spyOn(api, 'interrupt').mockRejectedValue(
      new ApiError(409, { ok: false, error: 'not-busy' }),
    );
    const { store, fleet } = makeStores();
    render(
      <>
        <SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />
        <ToastHost />
      </>,
    );
    act(() => {
      store.setState({ uuid: 'u1', status: 'busy' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(await screen.findByText(/nothing to stop/)).toBeInTheDocument();
  });
});

// Fix round 1, finding 1: the dev0-in-cyan bug (see SessionScreen.tsx's own
// comment on `acct`) had NO regression coverage — `grep -rn "data-acct"
// pwa/test` returned nothing before this block existed. Pins both the general
// case (a non-cyan account stamps its OWN hue, not cyan) and finding 4's
// companion fix (an unresolved hue stamps 'unknown', never a bare absence
// that would leave `--acct-active` at its cyan default).
describe('SessionScreen account accent (data-acct)', () => {
  const makeStores = (roster: typeof TEST_ROSTER | []) => {
    const store = createSessionStore('claude2:OpenClawHetzner', {
      makeSocket: fakeSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({
        sessions: [fleetSession({ id: 'claude2:OpenClawHetzner', wrapper: 'claude2' })],
        conn: 'open',
        roster,
      });
    });
    return { store, fleet };
  };

  it("stamps the session's own hue — a non-cyan account never renders in claude's cyan", () => {
    const { store, fleet } = makeStores(TEST_ROSTER);
    const { container } = render(
      <SessionScreen id="claude2:OpenClawHetzner" store={store} fleet={fleet} />,
    );
    // claude2 -> violet (rosterFixture.ts). Cyan would mean the old
    // string-parsed lookup (or its regression) is back.
    expect(container.querySelector('.chat')).toHaveAttribute('data-acct', 'violet');
  });

  it("stamps 'unknown', never cyan, before the roster has arrived", () => {
    const { store, fleet } = makeStores([]);
    const { container } = render(
      <SessionScreen id="claude2:OpenClawHetzner" store={store} fleet={fleet} />,
    );
    expect(container.querySelector('.chat')).toHaveAttribute('data-acct', 'unknown');
  });
});

// Task 7 (board-placement wave 2): the repo label reaches the header THROUGH
// the fleet store's `projects` field, not a prop SessionScreen invents on its
// own — this exercises the store round trip `renderHeader` above cannot.
describe('SessionScreen repo label (board-placement wave 2, Task 7, R3)', () => {
  const makeStores = () => {
    const store = createSessionStore('claude:OpenClawHetzner', {
      makeSocket: fakeSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({ sessions: [fleetSession({ status: 'idle' })], conn: 'open' });
    });
    return { store, fleet };
  };

  it('renders the repo the store carries for this session\'s project', () => {
    const { store, fleet } = makeStores();
    act(() => {
      fleet.getState().setProjects([
        { name: 'OpenClawHetzner', workdir: '/root/projects/OpenClawHetzner', repo: { state: 'named', slug: 'Synapsium-Labs/OpenClawHetzner' } },
      ]);
    });
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    expect(screen.getByText('Synapsium-Labs/OpenClawHetzner')).toBeInTheDocument();
    expect(document.querySelector('.chip--repo')).not.toBeNull();
  });

  it('renders no repo chip when the store has never read `/api/projects` (D-3013)', () => {
    const { store, fleet } = makeStores();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    expect(document.querySelector('.chip--repo')).toBeNull();
  });
});

describe('SessionScreen reap wiring (Task 17)', () => {
  it('wires onReapWorkspace to the real ReapSheet, not a no-op', async () => {
    // The line above this test (Task 16's own "Clean up (Task 16) both
    // closes the sheet and hands off to onReapWorkspace") only proves the
    // CALLBACK fires against a mocked onReapWorkspace — it never mounts the
    // real SessionScreen, so `onReapWorkspace={() => setReapOpen(true)}` and
    // the `<ReapSheet open={reapOpen} .../>` mount below it could both be
    // deleted with that suite staying green. This mounts the real screen and
    // checks the real sheet — this session's audit, fetched and rendered.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/workspace/audit')) {
        return new Response(JSON.stringify({
          // ccd echoes the REQUESTED session id back as the audit's own
          // first field (`cmd_ws_audit`'s `local id=$2`, ccd:3415), and the
          // sheet refuses to render an audit that does not name the session
          // it is describing (final-round F2), so the two must agree.
          //
          // Fix round 3, verifier P4: the previous note here justified the
          // change by calling the old `id: 'demo'` "a response ccd cannot
          // produce" — while substituting 'claude:OpenClawHetzner', which ccd
          // cannot produce either. `cmd_ws_audit` validates the id BEFORE
          // doing anything (`[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die`, ccd:3416)
          // and a colon is not in that class, so that request dies and the
          // route 502s. Both this fixture and the session it describes now use
          // a real workspace session id: ccd builds them as `$project-$slug`
          // (ccd:738), and reap only ever applies to a workspace session.
          id: 'OpenClawHetzner-quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', workdir: '/w/quiet-basin',
          project: 'OpenClawHetzner', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
          dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0,
          clips: [], stashes: 0, worktreeBytes: 500_000_000, commitsAheadOfBase: 2,
          pr: { number: 7, url: 'u', mergeCommit: 'x', headRefOid: 'y' },
          merge: { proof: 'ancestor', fetchedAt: Math.floor(Date.now() / 1000) },
          transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'q'.repeat(64), sentence: '',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const mergedPr: FleetSession['pr'] = {
      phase: 'merged', number: 42, url: 'u', title: null, checks: null, checkNames: null,
      ahead: 0, reason: null, checkedAt: Date.now(), mergedAt: Date.now(), retryAt: null,
    };
    const store = createSessionStore(WS_ID, { makeSocket: fakeSocket });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({
        sessions: [fleetSession({ id: WS_ID, workspace: 'quiet-basin', archivedAt: 1, pr: mergedPr })],
        conn: 'open',
      });
    });
    render(<SessionScreen id={WS_ID} store={store} fleet={fleet} />);
    fireEvent.click(screen.getByLabelText(/pull request/i));
    fireEvent.click(await screen.findByRole('button', { name: /clean up/i }));
    expect(await screen.findByText('/w/quiet-basin')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: /Remove quiet-basin/ })).toBeInTheDocument();
  });

  it('completing a reap from the chat header hands control back to the fleet', async () => {
    // `onReaped={() => { setReapOpen(false); navigate('/'); }}` — nothing
    // above exercises the SECOND half of that line. A mutant dropping the
    // `navigate('/')` call would leave every other test in this file green:
    // the session that no longer exists would stay on screen.
    history.pushState(null, '', `/s/${WS_ID}`);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/workspace/audit')) {
        return new Response(JSON.stringify({
          // ccd echoes the REQUESTED session id back as the audit's own
          // first field (`cmd_ws_audit`'s `local id=$2`, ccd:3415), and the
          // sheet refuses to render an audit that does not name the session
          // it is describing (final-round F2), so the two must agree.
          //
          // Fix round 3, verifier P4: the previous note here justified the
          // change by calling the old `id: 'demo'` "a response ccd cannot
          // produce" — while substituting 'claude:OpenClawHetzner', which ccd
          // cannot produce either. `cmd_ws_audit` validates the id BEFORE
          // doing anything (`[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die`, ccd:3416)
          // and a colon is not in that class, so that request dies and the
          // route 502s. Both this fixture and the session it describes now use
          // a real workspace session id: ccd builds them as `$project-$slug`
          // (ccd:738), and reap only ever applies to a workspace session.
          id: 'OpenClawHetzner-quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', workdir: '/w/quiet-basin',
          project: 'OpenClawHetzner', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
          dirty: [], ignored: [], ignoredCount: 0, ignoredBytes: 0, sensitive: [], sensitiveFiltered: 0,
          clips: [], stashes: 0, worktreeBytes: 500_000_000, commitsAheadOfBase: 2,
          pr: { number: 7, url: 'u', mergeCommit: 'x', headRefOid: 'y' },
          merge: { proof: 'ancestor', fetchedAt: Math.floor(Date.now() / 1000) },
          transcript: '/t.jsonl', children: [], verdict: 'reapable', detail: '', token: 'q'.repeat(64), sentence: '',
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).includes('/workspace/reap')) {
        return new Response(JSON.stringify({ reaped: 'demo', branch: 'ws/quiet-basin', attic: 2, sentence: '' }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const mergedPr: FleetSession['pr'] = {
      phase: 'merged', number: 42, url: 'u', title: null, checks: null, checkNames: null,
      ahead: 0, reason: null, checkedAt: Date.now(), mergedAt: Date.now(), retryAt: null,
    };
    const store = createSessionStore(WS_ID, { makeSocket: fakeSocket });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({
        sessions: [fleetSession({ id: WS_ID, workspace: 'quiet-basin', archivedAt: 1, pr: mergedPr })],
        conn: 'open',
      });
    });
    render(<SessionScreen id={WS_ID} store={store} fleet={fleet} />);
    fireEvent.click(screen.getByLabelText(/pull request/i));
    fireEvent.click(await screen.findByRole('button', { name: /clean up/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Remove quiet-basin/ }));
    await waitFor(() => expect(location.pathname).toBe('/'));
    // Both halves of the one-liner, not just navigate('/'): a mutant that
    // drops `setReapOpen(false)` alone would still pass the path check above
    // — this render has no router shell to unmount the screen for it, so the
    // sheet itself has to be the witness that it actually closed.
    expect(screen.queryByText('/w/quiet-basin')).not.toBeInTheDocument();
  });
});

// — the substrate gate (spec §4) —

describe('the substrate gate — Archive, Restart and Restore refuse a session nobody can see', () => {
  // Same contract as the actions sheet's gates: one derived fault per render
  // (`substrateFault`), the chip's own `tmux unreachable — <reason>` string in
  // `title`, and the click proven inert — the keycap idiom at the top of this
  // file, aimed at the controls this screen owns (a workspace's Restore is the one ungated: `ws-restore`, not `/ensure`).
  // Workspace lifecycle §5.2: the menu's "Stop session" became "Archive" — stop and archive are one feature. The
  // `esc` keycap (interrupt) is a different control and is pinned unchanged at the top of this file.
  it('disables the Archive menu item under a fault, naming it', async () => {
    const p = renderHeader({ session: fleetSession({ substrate: { at: 1, text: 'x' } }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const archive = await screen.findByRole('button', { name: 'Archive' });
    expect(archive).toBeDisabled();
    expect(archive.getAttribute('title')).toContain('x');
    expect(archive.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(archive);
    expect(p.onArchive).not.toHaveBeenCalled();
  });

  it('a null substrate leaves the Archive menu item live, and the menu has no Stop session left', async () => {
    const p = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const archive = await screen.findByRole('button', { name: 'Archive' });
    expect(archive).toBeEnabled();
    expect(screen.queryByRole('button', { name: /Stop session/ })).toBeNull();
    fireEvent.click(archive);
    expect(p.onArchive).toHaveBeenCalledOnce();
  });

  it('a put-away MAIN CHECKOUT under a fault: Restore is disabled, names the fault, and a click is inert', async () => {
    // Its Restore is `POST /ensure` — the request the dead banner's Restart refuses under the same fault.
    const p = renderHeader({ session: fleetSession({
      status: 'dead', bucket: 'dead', stoppedBy: { at: Date.now() - 60_000, surface: 'pwa' },
      substrate: { at: 1, text: 'x' } }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const restore = await screen.findByRole('button', { name: 'Restore' });
    expect(restore).toBeDisabled();
    expect(restore.getAttribute('title')).toContain('x');
    expect(restore.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(restore);
    expect(p.onRestore).not.toHaveBeenCalled();
  });

  it('an archived WORKSPACE under a fault keeps Restore live — ws-restore is not /ensure', async () => {
    const p = renderHeader({ session: fleetSession({
      workspace: 'quiet-basin', status: 'dead', bucket: 'archived', archivedAt: 1785300000,
      substrate: { at: 1, text: 'x' } }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const restore = await screen.findByRole('button', { name: 'Restore' });
    expect(restore).toBeEnabled();
    expect(restore.getAttribute('title')).toBeNull();
    fireEvent.click(restore);
    expect(p.onRestore).toHaveBeenCalledOnce();
  });

  it('a session already put away offers Restore in Archive\'s place', async () => {
    const p = renderHeader({ session: fleetSession({ status: 'dead', bucket: 'archived', archivedAt: 1785300000 }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Restore' }));
    expect(screen.queryByRole('button', { name: 'Archive' })).toBeNull();
    expect(p.onRestore).toHaveBeenCalledOnce();
  });

  it("the dead banner's Restart is disabled and never posts /ensure", () => {
    const spy = vi.spyOn(api, 'ensure').mockResolvedValue(undefined);
    const store = createSessionStore('claude:OpenClawHetzner', { makeSocket: fakeSocket });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({
        sessions: [fleetSession({ status: 'dead', bucket: 'dead', substrate: { at: 1, text: 'x' } })],
        conn: 'open',
      });
    });
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    const btn = screen.getByRole('button', { name: /Restart session/ });
    expect(btn).toBeDisabled();
    expect(btn.getAttribute('title')).toContain('x');
    fireEvent.click(btn);
    expect(spy).not.toHaveBeenCalled();
  });

  it('a fault landing while the archive sheet is already open still blocks the archive', async () => {
    // The menu item's `disabled` cannot cover this: the fleet frame updates
    // LIVE under an open sheet, and the sheet owns its own button — so the
    // send re-reads the fault at the moment of firing, and the refusal is
    // named rather than swallowed.
    const spy = vi.spyOn(api, 'archive').mockResolvedValue(null);
    const store = createSessionStore('claude:OpenClawHetzner', {
      makeSocket: fakeSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({ sessions: [fleetSession()], conn: 'open' });
    });
    render(
      <>
        <SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    // The sheet is on screen; NOW the snapshot flags the substrate.
    act(() => {
      fleet.setState({ sessions: [fleetSession({ substrate: { at: 1, text: 'x' } })] });
    });
    // The sheet's own confirm button — by wrapper class, since the menu's
    // same-named opener may still be unmounting behind it (the actions-sheet
    // suite's Release idiom).
    // The archive confirm is the danger variant now (D-5099); its hook class follows (D-5449).
    await waitFor(() => expect(document.querySelector('.archive-conflict-sheet .btn-danger')).not.toBeNull());
    fireEvent.click(document.querySelector('.archive-conflict-sheet .btn-danger')!);
    expect(spy).not.toHaveBeenCalled();
    expect(await screen.findByText(/tmux unreachable — x/)).toBeInTheDocument();
  });
});

// — keyboard discipline —

describe('breadcrumb', () => {
  it('names the workspace beside the project', () => {
    // The header's branch metachip (session/SessionHeader.tsx's `.chat-meta`)
    // already renders this session's raw branch text, so a bare getByText for
    // 'ws/quiet-basin' is ambiguous once the crumb exists too — scope to the
    // crumb span, which is what this test is actually about.
    const { container } = render(<SessionHeader {...props({ session: fleetSession({
      project: 'custom-tools', workspace: 'quiet-basin', name: null, branch: 'ws/quiet-basin',
    }) })} />);
    expect(screen.getByText('custom-tools')).toBeInTheDocument();
    expect(container.querySelector('.chat-crumb')).toHaveTextContent('ws/quiet-basin');
  });

  it('distinguishes two workspaces of one project — the whole point', () => {
    // Same ambiguity as above: the branch metachip duplicates the crumb text,
    // so assert against the crumb element specifically.
    const { container, unmount } = render(<SessionHeader {...props({ session: fleetSession({
      id: 'a', project: 'demo', workspace: 'quiet-basin', branch: 'ws/quiet-basin' }) })} />);
    expect(container.querySelector('.chat-crumb')).toHaveTextContent('ws/quiet-basin');
    unmount();
    const { container: container2 } = render(<SessionHeader {...props({ session: fleetSession({
      id: 'b', project: 'demo', workspace: 'still-cove', branch: 'ws/still-cove' }) })} />);
    expect(container2.querySelector('.chat-crumb')).toHaveTextContent('ws/still-cove');
  });

  it('shows the project alone for a main checkout', () => {
    const { container } = render(<SessionHeader {...props({ session: fleetSession({
      project: 'demo', workspace: null, name: null, branch: null, id: 'demo' }) })} />);
    expect(screen.getByText('demo')).toBeInTheDocument();
    expect(container.querySelector('.chat-crumb')).toBeNull();
  });

  it('prefers a chosen name over the branch, as the fleet line does', () => {
    render(<SessionHeader {...props({ session: fleetSession({
      project: 'demo', workspace: 'quiet-basin', name: 'refactor-auth', branch: 'ws/quiet-basin' }) })} />);
    expect(screen.getByText('refactor-auth')).toBeInTheDocument();
  });

  // The common case: no chosen `name`, so sessionLabel() falls through to
  // `branch` and the crumb prints the exact same string the branch metachip
  // would — a few pixels below it. The chip must not repeat it.
  it('suppresses the branch chip when it would repeat the crumb', () => {
    const { container } = render(<SessionHeader {...props({ session: fleetSession({
      project: 'demo', workspace: 'quiet-basin', name: null, branch: 'ws/quiet-basin' }) })} />);
    expect(container.querySelector('.chat-crumb')).toHaveTextContent('ws/quiet-basin');
    expect(container.querySelector('.metachip--branch')).toBeNull();
    // Belt and braces: the branch text appears exactly once in the whole
    // header, not zero (that would pass against deleting the chip outright)
    // and not twice (the duplicate this fix removes).
    expect(screen.getAllByText('ws/quiet-basin')).toHaveLength(1);
  });

  it('keeps the branch chip once it differs from the crumb — two distinct elements', () => {
    const { container } = render(<SessionHeader {...props({ session: fleetSession({
      project: 'demo', workspace: 'quiet-basin', name: 'refactor-auth', branch: 'ws/quiet-basin' }) })} />);
    const crumb = container.querySelector('.chat-crumb');
    const chip = container.querySelector('.metachip--branch');
    expect(crumb).toHaveTextContent('refactor-auth');
    expect(chip).toHaveTextContent('ws/quiet-basin');
    expect(crumb).not.toBe(chip);
    expect(crumb?.textContent).not.toBe(chip?.textContent);
  });

  it('keeps the branch chip for a main checkout with no crumb at all', () => {
    // No workspace -> no crumb -> nothing for the chip to duplicate; it must
    // render exactly as it always has. (Not the common case in practice —
    // `branch` is usually only parsed for worktree sessions — but the fix
    // must not regress it if it ever occurs.)
    const { container } = render(<SessionHeader {...props({ session: fleetSession({
      project: 'demo', workspace: null, name: null, branch: 'main', id: 'demo' }) })} />);
    expect(container.querySelector('.chat-crumb')).toBeNull();
    expect(container.querySelector('.metachip--branch')).toHaveTextContent('main');
  });
});

describe('the PR cap in the header', () => {
  it('renders for a workspace session, whatever its pr value is', () => {
    render(<SessionHeader {...props({ session: fleetSession({ workspace: 'quiet-basin', pr: null }) })} />);
    expect(screen.getByLabelText(/pull request/i)).toBeInTheDocument();
  });

  it('does NOT render for a project main checkout', () => {
    render(<SessionHeader {...props({ session: fleetSession({ workspace: null, pr: null }) })} />);
    expect(screen.queryByLabelText(/pull request/i)).not.toBeInTheDocument();
  });

  // These two pin the "unconditional" half of the rule directly, beyond what
  // the pr: null case above already covers: a session whose PR read came back
  // `unknown` (a gh outage, mid-sweep) and a session whose agent link is down
  // (status 'dead' — tmux gone) both still get the cap. Gating visibility on
  // either would hide the retry affordance behind a control that isn't there.
  it('renders during a gh outage — phase unknown is not phase absent', () => {
    render(<SessionHeader {...props({ session: fleetSession({
      workspace: 'quiet-basin',
      pr: {
        phase: 'unknown', number: null, url: null, title: null, checks: null, checkNames: null,
        ahead: 0, reason: 'offline', checkedAt: Date.now(), mergedAt: null, retryAt: null,
      },
    }) })} />);
    // Beyond mere presence: this pins that `session.pr` is what actually
    // reaches PrKeycap — a header that hardcoded `pr={null}` regardless of
    // the session would pass every OTHER assertion in this describe block
    // (every phase's sentence still contains "pull request"), and only a
    // phase-specific check like this one catches that the wiring is real.
    expect(screen.getByLabelText(/pull request/i)).toHaveAttribute('data-phase', 'unknown');
  });

  it('renders while the agent link is down (status dead)', () => {
    render(<SessionHeader {...props({
      status: 'dead',
      session: fleetSession({ workspace: 'quiet-basin', status: 'dead', pr: null }),
    })} />);
    expect(screen.getByLabelText(/pull request/i)).toBeInTheDocument();
  });

  it('opens PrSheet (Task 16) when the PR cap is tapped', async () => {
    // PrSheet fires a one-shot GET on open; stub it so this stays a unit test
    // rather than reaching a real network.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    render(<SessionHeader {...props({ session: fleetSession({ workspace: 'quiet-basin', pr: null }) })} />);
    expect(screen.queryByText(/not checked yet/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/pull request/i));
    expect(await screen.findByText(/not checked yet/i)).toBeInTheDocument();
  });

  it('closes PrSheet (Task 16) via its own scrim, same as any other sheet', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    render(<SessionHeader {...props({ session: fleetSession({ workspace: 'quiet-basin', pr: null }) })} />);
    fireEvent.click(screen.getByLabelText(/pull request/i));
    await screen.findByText(/not checked yet/i);
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    await waitFor(() => expect(screen.queryByText(/not checked yet/i)).not.toBeInTheDocument());
  });

  it('Clean up (Task 16) both closes the sheet and hands off to onReapWorkspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"ok":true}', { status: 200 })));
    const onReapWorkspace = vi.fn();
    const mergedPr: FleetSession['pr'] = {
      phase: 'merged', number: 42, url: 'u', title: null, checks: null, checkNames: null,
      ahead: 0, reason: null, checkedAt: Date.now(), mergedAt: Date.now(), retryAt: null,
    };
    render(<SessionHeader {...props({
      onReapWorkspace,
      session: fleetSession({ workspace: 'quiet-basin', archivedAt: 1, pr: mergedPr }),
    })} />);
    fireEvent.click(screen.getByLabelText(/pull request/i));
    fireEvent.click(await screen.findByRole('button', { name: /clean up/i }));
    expect(onReapWorkspace).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.queryByTestId('sheet-overlay')).not.toBeInTheDocument());
  });

  it('sits after the ⋯ cap and before esc, which keeps the outer edge', () => {
    // esc is the interrupt and its position is muscle memory.
    stubPointer(false);
    const { container } = render(<SessionHeader {...props({ session: fleetSession({ workspace: 'quiet-basin' }), status: 'busy' })} />);
    const caps = [...container.querySelectorAll('.chat-head .keycap')].map((n) => n.className);
    expect(caps.findIndex((c) => c.includes('keycap--more')))
      .toBeLessThan(caps.findIndex((c) => c.includes('keycap--pr')));
    expect(caps.findIndex((c) => c.includes('keycap--pr')))
      .toBeLessThan(caps.findIndex((c) => c.includes('keycap--esc')));
  });
});

describe('archived chip', () => {
  it('says the session is archived and names the PR', () => {
    render(<SessionHeader {...props({ session: fleetSession({
      workspace: 'quiet-basin', archivedAt: 1785300000,
      pr: { phase: 'merged', number: 42, url: 'u', title: 't', checks: null, checkNames: null,
        ahead: 3, reason: null, checkedAt: 1, mergedAt: 1, retryAt: null },
    }) })} />);
    const chip = screen.getByText('archived · merged #42');
    expect(chip).toBeInTheDocument();
    expect(chip).toHaveClass('chip--archived');
  });

  it('renders no chip for a live session', () => {
    render(<SessionHeader {...props({ session: fleetSession({ workspace: 'quiet-basin', archivedAt: null }) })} />);
    expect(screen.queryByText(/^archived/)).not.toBeInTheDocument();
  });

  it('says just "archived" when the PR number is not known', () => {
    // Pins the ternary's OTHER branch — the first test above only exercises
    // the "PR known" half, so a mutant collapsing both to one string would
    // survive it.
    render(<SessionHeader {...props({ session: fleetSession({
      workspace: 'quiet-basin', archivedAt: 1785300000, pr: null,
    }) })} />);
    expect(screen.getByText('archived')).toBeInTheDocument();
  });

  it('does not derive from pr.phase — a merged PR alone is not an archive', () => {
    // The context this chip exists for: a merged PR whose archive was
    // deferred (session busy, say) must not claim it was archived.
    render(<SessionHeader {...props({ session: fleetSession({
      workspace: 'quiet-basin', archivedAt: null,
      pr: { phase: 'merged', number: 42, url: 'u', title: 't', checks: null, checkNames: null,
        ahead: 3, reason: null, checkedAt: 1, mergedAt: 1, retryAt: null },
    }) })} />);
    expect(screen.queryByText(/^archived/)).not.toBeInTheDocument();
  });
});

describe('the repo label in the session view (board-placement wave 2, Task 7, R3)', () => {
  it('renders the repo unconditionally when it is known', () => {
    renderHeader({ repo: 'Synapsium-Labs/custom-tools' });
    expect(screen.getByText('Synapsium-Labs/custom-tools')).toBeInTheDocument();
    expect(document.querySelector('.chip--repo')).not.toBeNull();
  });
  it('renders nothing when it is not — an older server, or a deep link before any fleet read (D-3013)', () => {
    renderHeader({});
    expect(document.querySelector('.chip--repo')).toBeNull();
  });
});

describe('useKeyboardInsets', () => {
  function Probe(): ReactNode {
    return <div data-testid="inset">{useKeyboardInsets()}</div>;
  }

  it('tracks the visualViewport keyboard overlap as a bottom inset', () => {
    const vv = Object.assign(new EventTarget(), {
      height: window.innerHeight,
      offsetTop: 0,
    });
    Object.defineProperty(window, 'visualViewport', { value: vv, configurable: true });

    render(<Probe />);
    expect(screen.getByTestId('inset')).toHaveTextContent(/^0$/);

    act(() => {
      vv.height = window.innerHeight - 320; // keyboard slid up
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('inset')).toHaveTextContent(/^320$/);

    act(() => {
      vv.height = window.innerHeight; // keyboard dismissed
      vv.dispatchEvent(new Event('resize'));
    });
    expect(screen.getByTestId('inset')).toHaveTextContent(/^0$/);
  });
});

describe('the substrate gate — the Move (swap) door refuses too (branch review)', () => {
  // Spec §4 names swap in the destructive list; the actions sheet's opener is
  // gated, and this menu item opens the SAME SwapSheet whose confirm fires
  // api.swap with no check of its own — so an ungated item here was a swap
  // reachable end-to-end with zero gate anywhere.
  it('disables Move to another account under a fault, naming it', async () => {
    const p = renderHeader({ session: fleetSession({ substrate: { at: 1, text: 'x' } }) });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const move = await screen.findByRole('button', { name: /Move to another account/ });
    expect(move).toBeDisabled();
    expect(move.getAttribute('title')).toContain('x');
    expect(move.getAttribute('title')).toMatch(/tmux unreachable/);
    fireEvent.click(move);
    expect(p.onMoveAccount).not.toHaveBeenCalled();
  });

  it('a null substrate leaves Move live', async () => {
    const p = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const move = await screen.findByRole('button', { name: /Move to another account/ });
    expect(move).toBeEnabled();
    fireEvent.click(move);
    expect(p.onMoveAccount).toHaveBeenCalledOnce();
  });
});

// — the header with no frame yet, the hour-long turn, and the menu's own exit —
describe('the header before the first fleet frame lands', () => {
  it('shows the caller’s fallback title and account rather than an empty crumb', () => {
    // A deep link renders this header before any frame has arrived.
    // `SessionScreen` passes `fallback={{ title: project, wrapper }}` — both
    // derived from the id — and those arms had no case: the title would read
    // `…` and the account accent would be blank on a screen that knows both.
    renderHeader({ session: null, fallback: { title: 'OpenClawHetzner', wrapper: 'claude' } });
    expect(screen.getByText('OpenClawHetzner')).toBeInTheDocument();
  });

  it('and `…` when the caller has no fallback either', () => {
    // The last resort. An empty string here collapses the crumb row and the
    // header jumps when the frame lands.
    renderHeader({ session: null, fallback: undefined });
    expect(screen.getByText('…')).toBeInTheDocument();
  });
});

describe('a turn that has been running for over an hour', () => {
  it('counts hours, not 90 minutes', () => {
    // `clock`'s h arm. A turn this long is exactly the one an operator is
    // deciding whether to interrupt, and `90:12` reads as a minute count
    // nobody can place.
    const at = Date.now() - (3600_000 + 12 * 60_000 + 7_000);
    renderHeader({ status: 'busy', statusUpdatedAt: at,
                   session: fleetSession({ status: 'busy', bucket: 'working', bucketSince: at }) });
    expect(screen.getByText(/working · 1:12:0\d/)).toBeInTheDocument();
  });
});

describe('the session menu', () => {
  it('opens, offers History, and closes on the scrim without acting', () => {
    // The menu's own `onClose` was an uncovered function, and so was the
    // History row's handler. A menu that cannot be dismissed is a menu that
    // owns the screen.
    const p = renderHeader();
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByText('History'));
    expect(p.onOpenHistory).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    fireEvent.click(screen.getByTestId('sheet-overlay'));
    expect(p.onOpenHistory, 'the dismissal acted on the menu').toHaveBeenCalledTimes(1);
    // The FLAG has to come down with the content: vaul closes its own view on
    // a scrim click whatever `onClose` does, and a sheet still told `open`
    // puts itself straight back up. So the claim is that the rows are gone
    // and STAY gone (measured — asserting only the callback left a no-op
    // `onClose` green).
    return waitFor(() => expect(screen.queryByText('History')).toBeNull());
  });
});

describe('the Escape binding ignores every other key', () => {
  it('a keystroke that is not Escape does not interrupt the turn', () => {
    // The handler is on the DOCUMENT while a turn is running, so every
    // keystroke in the app reaches it. Without the key check, typing would
    // kill the turn.
    stubPointer(true);
    const p = props({ status: 'busy' });
    render(<SessionHeader {...p} />);
    fireEvent.keyDown(document, { key: 'a' });
    fireEvent.keyDown(document, { key: 'Enter' });
    expect(p.onInterrupt, 'an ordinary keystroke interrupted the turn').not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(p.onInterrupt, 'the control: Escape still interrupts').toHaveBeenCalledTimes(1);
  });
});

// `background-aware-working` (D-5231; plan 2026-10-16-working-state-and-interruptions Task 1): the header says what
// the card says about delegated work a main Stop left running, and the chat pulse follows the server's BUCKET, so a
// wedged `busy` the ladder filed `done` stops pulsing and delegated work after a Stop keeps it.
describe('delegated background work (D-5231)', () => {
  const NEUTRAL = 'lane-a:project-a';
  const row = (over: Partial<FleetSession> = {}): FleetSession => baseSession({
    id: NEUTRAL, project: 'project-a', status: 'busy', bucket: 'working', hookState: 'done',
    statusUpdatedAt: Date.now() - 95 * 60_000, background: { count: 2, kinds: ['workflow'] }, ...over,
  });

  it('a working row with background reads `working · 2 in background`, the kinds in the title', () => {
    renderHeader({ status: 'busy', session: row() });
    const line = screen.getByText('working · 2 in background');
    expect(line.getAttribute('title')).toBe('in background: workflow');
  });

  it('the same row with no background keeps the elapsed clock', () => {
    renderHeader({ status: 'busy', session: row({ background: null }) });
    expect(screen.queryByText(/in background/)).not.toBeInTheDocument();
    expect(screen.getByText(/^working · /)).toBeInTheDocument();
  });

  it('a row the ladder filed `done` never shows the background words', () => {
    renderHeader({ status: 'busy', session: row({ bucket: 'done' }) });
    expect(screen.queryByText(/in background/)).not.toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'finished' })).toBeInTheDocument();
    // Nor the kinds in a title: the row's `background` is still set (fleet.ts does not clear it once the live file
    // goes idle after the Stop), so only the `bucket === 'working'` gate keeps a stale title off the done line.
    const line = document.querySelector('.status-line');
    expect(line).not.toBeNull();
    expect(line!.textContent).toMatch(/^done/);
    expect(line!.hasAttribute('title')).toBe(false);
  });

  // The pulse rule is tested directly: `ChatList` renders through Virtuoso, which cannot measure in jsdom, so a
  // SessionScreen render never shows the trailing indicator whatever `busy` is (a vacuous assertion).
  it('the chat does not pulse on a wedged busy row whose bucket is `done`', () => {
    expect(chatPulsing(row({ bucket: 'done', background: null }), 'busy')).toBe(false);
  });

  it('the chat pulses on a busy row the ladder keeps `working` for its delegated work', () => {
    expect(chatPulsing(row(), 'busy')).toBe(true);
  });

  it('the chat pulses on a `working` row while the live word already reads idle (the bucket decides)', () => {
    expect(chatPulsing(row(), 'idle')).toBe(true);
  });

  it('before the snapshot row lands the live word decides, and a dead session never pulses', () => {
    expect(chatPulsing(null, 'busy')).toBe(true);
    expect(chatPulsing(null, 'idle')).toBe(false);
    expect(chatPulsing(row(), 'dead')).toBe(false);
  });
});

// D-5235 (spec 2026-10-16 §5.5; plan Task 5). The desktop Escape binding sits
// on the window, in the bubble phase, so the same keystroke that dismisses a
// sheet (Radix's dismiss, in its document capture listener, preventDefault()s
// without stopping propagation) reached it and interrupted the running turn.
// The operator closed a sheet and lost the turn.
//
// RED FIRST, measured 2026-10-16 against origin/main 0a06ebb9: the sheet case
// and the already-handled case failed (onInterrupt called once each); the
// nothing-open and textarea cases passed before and after, as they should.
//
// MUTATION TABLE (plan Task 5 Step 3; RUN 2026-10-16 on an isolated copy, each
// mutant applied, header + drawer-view run, restored and compared byte for byte;
// the open-dialog rows re-run 2026-10-17 with the window-dispatched case added):
//   the defaultPrevented check removed ......... RED: the already-handled case
//                                                (the sheet case stays green
//                                                through the open-dialog check)
//   the open-dialog check removed .............. RED: the open-sheet,
//                                                window-dispatched case (Radix
//                                                never sees that Escape, so only
//                                                the open-dialog check holds it)
//   both removed ............................... RED: the sheet case, the
//                                                already-handled case, the
//                                                window-dispatched case, and the
//                                                drawer's focus-elsewhere case
//   the textarea skip removed .................. RED: both textarea cases; the
//                                                drawer's terminal-focused case
//                                                stays GREEN (see drawer-view)
//   the textarea skip and both checks removed .. the drawer's terminal-focused
//                                                case is STILL green: xterm's
//                                                `cancel(e, true)` stops the
//                                                keydown's propagation, so it
//                                                never reaches the window
describe('Escape that closes a sheet never interrupts (D-5235)', () => {
  const neutral = baseSession({ id: 'project-a-quiet-basin', project: 'project-a', workdir: '/w' });

  it('a sheet is open with focus on a button inside it: Escape closes the sheet and interrupts nothing', () => {
    stubPointer(true);
    const onClose = vi.fn();
    const p = props({ session: neutral, status: 'busy' });
    render(
      <>
        <SessionHeader {...p} />
        <Sheet open onClose={onClose} title="a sheet"><button type="button">inside</button></Sheet>
      </>,
    );
    const inside = screen.getByRole('button', { name: 'inside' });
    act(() => inside.focus());
    fireEvent.keyDown(inside, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(onClose, 'the control: Escape dismisses the sheet').toHaveBeenCalledTimes(1);
    expect(p.onInterrupt, 'closing the sheet interrupted the turn').not.toHaveBeenCalled();
  });

  it('an Escape something earlier already handled (defaultPrevented) interrupts nothing', () => {
    stubPointer(true);
    const p = props({ session: neutral, status: 'busy' });
    render(<SessionHeader {...p} />);
    // What Radix's dismiss does: a document capture listener that prevents
    // the default and lets the event go on bubbling.
    const handled = (e: Event): void => { e.preventDefault(); };
    document.addEventListener('keydown', handled, { capture: true });
    try {
      fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    } finally {
      document.removeEventListener('keydown', handled, { capture: true });
    }
    expect(p.onInterrupt, 'an already-handled Escape interrupted the turn').not.toHaveBeenCalled();
  });

  it('a sheet is open and an Escape reaches the window without Radix preventing it: nothing is interrupted', () => {
    stubPointer(true);
    const p = props({ session: neutral, status: 'busy' });
    render(
      <>
        <SessionHeader {...p} />
        <Sheet open onClose={vi.fn()} title="a sheet"><button type="button">inside</button></Sheet>
      </>,
    );
    // Dispatched straight on window: Radix's document listener never sees it,
    // so its default is not prevented and only the open-dialog check holds it.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    expect(p.onInterrupt, 'an Escape with a sheet open interrupted the turn').not.toHaveBeenCalled();
  });

  it('with nothing open, Escape still interrupts, once', () => {
    stubPointer(true);
    const p = props({ session: neutral, status: 'busy' });
    render(<SessionHeader {...p} />);
    fireEvent.keyDown(document.body, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(p.onInterrupt).toHaveBeenCalledTimes(1);
  });

  it('with focus in a textarea, Escape does not interrupt (unchanged)', () => {
    stubPointer(true);
    const p = props({ session: neutral, status: 'busy' });
    render(<><textarea data-testid="box" /><SessionHeader {...p} /></>);
    const box = screen.getByTestId('box');
    act(() => box.focus());
    fireEvent.keyDown(box, { key: 'Escape', code: 'Escape', keyCode: 27 });
    expect(p.onInterrupt).not.toHaveBeenCalled();
  });
});

// `interrupt-and-restart-causes-recorded` (D-5237; plan 2026-10-16-working-state-and-interruptions Task 8): the
// header names a recent process end as the card does, for an hour.
describe('a recent restart is named (D-5237)', () => {
  const row = (over: Partial<FleetSession> = {}): FleetSession => baseSession({
    id: 'lane-a:project-a', project: 'project-a', ...over,
  });
  it('an oom end 3 minutes ago reads `restarted · out of memory · 3m ago`', () => {
    renderHeader({ status: 'idle', session: row({ lastEnd: { at: Date.now() - 3 * 60_000 - 5_000, cause: 'oom' } }) });
    const chip = screen.getByText('restarted · out of memory · 3m ago');
    expect(chip.closest('[data-restart]')?.getAttribute('data-restart')).toBe('oom');
  });
  it('after an hour, or with no end, nothing', () => {
    renderHeader({ status: 'idle', session: row({ lastEnd: { at: Date.now() - 61 * 60_000, cause: 'oom' } }) });
    expect(screen.queryByText(/^restarted · /)).not.toBeInTheDocument();
  });
});

// `with-coordinator-state` (D-5296; plan Task 7): the header reads the same
// words as the card, in the calm (idle) tint, and the dialog stays answerable
// from the session screen: the operator can still answer first.
describe('the quiet "with coordinator" state (D-5296)', () => {
  const WC = { kind: 'question' as const, parentId: 'project-a-calm-mesa', since: 4000, notifyAt: 184_000 };
  const held = (over: Partial<FleetSession> = {}): FleetSession => baseSession({
    id: 'project-a-quiet-basin', project: 'project-a', workspace: 'quiet-basin', workdir: '/data/projects/project-a/quiet-basin',
    status: 'idle', hookState: 'waiting', bucket: 'working', bucketSince: 4000, withCoordinator: WC, ...over,
  });

  for (const width of [360, 390, 1280, 1920]) {
    it(`reads "with coordinator · calm-mesa" in the calm tint at ${width} px`, () => {
      window.innerWidth = width;
      window.dispatchEvent(new Event('resize'));
      renderHeader({ session: held(), status: 'idle' });
      const line = document.querySelector('.status-line');
      expect(line?.textContent).toBe('with coordinator · calm-mesa');
      expect(line?.className).toContain('status-line--idle');
      expect(line?.getAttribute('title')).toContain('You can still answer it yourself.');
    });
  }

  // Layout is not measurable in jsdom: the widths above prove the words, and
  // these rules are what the Playwright measurements (PR body) depend on. The
  // name never breaks; the word sits beside the dot; the title column may
  // shrink to the column instead of pushing the name under the keycaps.
  it('the header rules: the name never breaks, the word stays beside the dot', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { ruleIn, declValue, stripComments } = await import('./cssRule');
    const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8'));
    expect(declValue(ruleIn(css, '.chat-meta .status-line-name'), 'white-space')).toBe('nowrap');
    expect(declValue(ruleIn(css, '.chat-meta .status-line--coordinator'), 'max-width')).toBe('calc(100% - 8px - var(--sp-2))');
    expect(declValue(ruleIn(css, '.chat-meta:has(.status-line--coordinator)'), 'min-width')).toBe('0');
    renderHeader({ session: held(), status: 'idle' });
    expect(document.querySelector('.status-line--coordinator .status-line-name')?.textContent).toBe('· calm-mesa');
  });

  it('without the field the header reads the ordinary working word', () => {
    renderHeader({ session: held({ withCoordinator: null }), status: 'idle' });
    expect(document.querySelector('.status-line')?.textContent).not.toContain('with coordinator');
  });

  it('the DialogSheet still opens from the session screen while the parent holds the question', () => {
    const store = createSessionStore('project-a-quiet-basin', {
      makeSocket: fakeSocket,
      api: { prompt: vi.fn().mockResolvedValue(undefined) },
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => { fleet.setState({ sessions: [held()], conn: 'open' }); });
    render(<SessionScreen id="project-a-quiet-basin" store={store} fleet={fleet} />);
    act(() => {
      store.setState({
        uuid: 'u1', status: 'idle',
        dialog: {
          id: 'd-1', title: 'Which branch?',
          options: [{ index: 1, label: 'main' }, { index: 2, label: 'release' }],
          selectedIndex: 1, parsed: true, raw: '❯ 1. main\n  2. release',
        },
      });
    });
    expect(document.querySelector('.status-line')?.textContent).toBe('with coordinator · calm-mesa');
    expect(screen.getByText('Which branch?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /release/ })).toBeInTheDocument();
  });

  // The guard that keeps the words off any bucket but `working`: the server
  // keeps the field on a dead row, or an idle one whose asks row is still held.
  it('a dead row with the field set reads its dead word, never the coordinator words', () => {
    renderHeader({ session: held({ status: 'dead', bucket: 'dead' }), status: 'dead' });
    const line = document.querySelector('.status-line');
    expect(line?.textContent).not.toContain('with coordinator');
    expect(line?.className).not.toContain('status-line--coordinator');
    expect(line?.className).toContain('status-line--dead');
  });

  it('an idle row with the field set reads its idle word, never the coordinator words', () => {
    renderHeader({ session: held({ bucket: 'idle' }), status: 'idle' });
    const line = document.querySelector('.status-line');
    expect(line?.textContent).toMatch(/^idle/);
    expect(line?.className).not.toContain('status-line--coordinator');
  });

  // D-5390: a `<wrapper>-<project>` main-checkout parent keeps its whole id,
  // which at 360 and 390 px is wider than the column. The name ellipsises
  // inside the status line (Playwright-measured, PR body); the full id stays
  // on `title`.
  it('a long `<wrapper>-<project>` parent ellipsises inside the line, the full id on title', async () => {
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const { ruleIn, declValue, stripComments } = await import('./cssRule');
    const css = stripComments(readFileSync(path.join(import.meta.dirname, '..', 'src', 'session', 'chat.css'), 'utf8'));
    const rule = ruleIn(css, '.chat-meta .status-line-name');
    expect(declValue(rule, 'overflow')).toBe('hidden');
    expect(declValue(rule, 'text-overflow')).toBe('ellipsis');
    expect(declValue(rule, 'display')).toBe('inline-block');
    expect(declValue(rule, 'max-width')).toBe('100%');
    renderHeader({ session: held({ withCoordinator: { ...WC, parentId: 'wrapper-two-project-a' } }), status: 'idle' });
    expect(document.querySelector('.status-line-name')?.textContent).toBe('· wrapper-two-project-a');
    expect(document.querySelector('.status-line')?.getAttribute('title')).toContain('wrapper-two-project-a');
  });

  // The chat's working pulse stands down while the parent holds the question,
  // so it agrees with the header's calm tint.
  it('the chat does not pulse while the parent holds the question', () => {
    expect(chatPulsing(held(), 'idle')).toBe(false);
    expect(chatPulsing(held({ withCoordinator: null }), 'idle')).toBe(true);
  });
});

// D-5242 (plan Task 18): the session's own screen never shows "not running" above "Waking…".
describe('the header of a hibernated row (D-5242)', () => {
  const AT = Date.now() - 6 * 3_600_000;
  it('a dead row with hibernatedAt reads `hibernated` with the calm dot, never "not running"', () => {
    renderHeader({ status: 'dead', session: hibernatedSession(AT, { id: 'project-a-quiet-basin', project: 'project-a' }) });
    expect(screen.getByText('hibernated')).toBeInTheDocument();
    expect(screen.queryByText('not running')).toBeNull();
    const dot = screen.getByRole('img', { name: 'hibernated' });
    expect(dot.className).toMatch(/dot--idle/);
    // The word wears the calm ink too, not the dead tone: colour must not contradict "Waking…" below.
    const line = screen.getByText('hibernated').closest('.status-line');
    expect(line?.className).toMatch(/status-line--idle/);
    expect(line?.className).not.toMatch(/status-line--dead/);
  });

  it('the stream saying dead over a sleeping row still reads hibernated', () => {
    renderHeader({ status: 'dead', session: hibernatedSession(AT, { id: 'project-a-quiet-basin', project: 'project-a' }) });
    expect(screen.queryByRole('img', { name: 'not running' })).toBeNull();
  });

  it('a dead row without hibernatedAt still reads "not running"', () => {
    renderHeader({ status: 'dead', session: fleetSession({ status: 'dead', bucket: 'dead' }) });
    expect(screen.getByText('not running')).toBeInTheDocument();
    expect(screen.queryByText('hibernated')).toBeNull();
  });
});

// — D-5527: a coordinated workspace says, in words, whose code it works on and who coordinates it —

describe('SessionScreen: the coordination line (D-5527)', () => {
  const CHILD = 'lane-b-project-b-quiet-river';
  const COORD = 'lane-a-project-a';
  const run41 = {
    id: 41, program: 'port-api', programTitle: 'Port the API', wave: 5, waveOf: 7,
    project: 'project-b', homeProject: 'project-b', sessionId: CHILD, workspace: 'quiet-river', branch: null,
    state: 'dispatched', kind: 'work', reviews: null, claimedBy: COORD, resumed: true, clearedAt: null,
    openedAt: 1_800_000_000_000, dispatchStartedAt: null, dispatchedAt: null, closedAt: null, handoffCommit: null,
    items: { done: 0, total: 0 }, unreadMail: 0,
    health: { mailOutstanding: 0, mailParked: 0, mailReplayMax: 0, doneRejects: 0, lastRejectCode: null,
              briefQueued: true, clearError: null, coordKickoffPendingSince: null }, childReclaim: null,
  } as const;
  const mount = (sessions: FleetSession[], runs: readonly (typeof run41)[] = [run41]) => {
    const store = createSessionStore(CHILD, { makeSocket: fakeSocket, api: { prompt: vi.fn().mockResolvedValue(undefined) } });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({ sessions, runs: runs.map((r) => ({ ...r })), runsFrameSeen: true, conn: 'open' });
    });
    render(<SessionScreen id={CHILD} store={store} fleet={fleet} />);
  };
  const child = baseSession({
    id: CHILD, project: 'project-b', workspace: 'quiet-river', role: 'child',
    child: { kind: 'child', runId: 39 }, boardProject: 'project-a',
  });

  it('a cross-project child: working on its project, coordinated from its coordinator, then the programme, wave and run', () => {
    mount([baseSession({ id: COORD, project: 'project-a', name: 'the coordinator', role: 'coordinator' }), child]);
    const line = document.querySelector('.chat-coord');
    expect(line?.textContent).toBe('working on project-b · coordinated from the coordinator · port-api · wave 5 of 7 · run #41');
    expect(line).toHaveAttribute('title', expect.stringContaining('one wave of Port the API on project-b’s code for the coordinator'));
  });

  it('a coordinator the fleet does not carry is named by the project it coordinates from', () => {
    mount([child]);
    expect(document.querySelector('.chat-coord')?.textContent)
      .toBe('working on project-b · coordinated from project-a · port-api · wave 5 of 7 · run #41');
  });

  it('names the ACTIVE run, never a closed one the store still holds with a higher id', () => {
    const closed = { ...run41, id: 45, wave: 6, state: 'done', closedAt: 1_800_000_100_000 } as unknown as typeof run41;
    mount([baseSession({ id: COORD, project: 'project-a', name: 'the coordinator', role: 'coordinator' }), child], [run41, closed]);
    expect(document.querySelector('.chat-coord')?.textContent).toContain('wave 5 of 7 · run #41');
  });

  it('a session nobody coordinates has no coordination line — the no-regression baseline', () => {
    mount([baseSession({ id: CHILD, project: 'project-b' })], []);
    expect(document.querySelector('.chat-coord')).toBeNull();
  });
});
