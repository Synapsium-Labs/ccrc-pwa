// Task 8 — SessionHeader (stop keycap gated on busy, live-name fallback),
// the screen-level api.interrupt wiring (incl. the 409 not-busy toast), and
// the visualViewport keyboard-inset hook.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { FleetSession } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { api, ApiError } from '../src/lib/api';
import { SessionHeader, type SessionHeaderProps } from '../src/session/SessionHeader';
import { SessionScreen, useKeyboardInsets } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';

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
 *  (ccd:712) and validates them against `^[A-Za-z0-9._-]+$` on every verb
 *  that takes one. The reap tests below use it for the session, the audit
 *  fixture and the URL alike, because that is the only combination the
 *  server can actually serve (fix round 3, verifier P4). */
const WS_ID = 'OpenClawHetzner-quiet-basin';

const fleetSession = (patch: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:OpenClawHetzner',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'OpenClawHetzner',
  workdir: '/root/projects/OpenClawHetzner',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: null,
  limits: null,
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  version: null,
  ...patch,
});

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
  onStopSession: vi.fn(),
  onReapWorkspace: vi.fn(),
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
      session: fleetSession({ status: 'busy' }),
    });
    const stop = screen.getByRole('button', { name: 'Stop' });
    expect(stop).toBeEnabled();
    fireEvent.click(stop);
    expect(props.onInterrupt).toHaveBeenCalledOnce();
    expect(screen.getByText(/working/)).toBeInTheDocument();
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

  it('the stop keycap calls api.interrupt with the session id', () => {
    const spy = vi.spyOn(api, 'interrupt').mockResolvedValue(undefined);
    const { store, fleet } = makeStores();
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    act(() => {
      store.setState({ uuid: 'u1', status: 'busy' });
    });
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(spy).toHaveBeenCalledWith('claude:OpenClawHetzner');
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
          // first field (`cmd_ws_audit`'s `local id=$2`, ccd:2511), and the
          // sheet refuses to render an audit that does not name the session
          // it is describing (final-round F2), so the two must agree.
          //
          // Fix round 3, verifier P4: the previous note here justified the
          // change by calling the old `id: 'demo'` "a response ccd cannot
          // produce" — while substituting 'claude:OpenClawHetzner', which ccd
          // cannot produce either. `cmd_ws_audit` validates the id BEFORE
          // doing anything (`[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die`, ccd:2512)
          // and a colon is not in that class, so that request dies and the
          // route 502s. Both this fixture and the session it describes now use
          // a real workspace session id: ccd builds them as `$project-$slug`
          // (ccd:712), and reap only ever applies to a workspace session.
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
          // first field (`cmd_ws_audit`'s `local id=$2`, ccd:2511), and the
          // sheet refuses to render an audit that does not name the session
          // it is describing (final-round F2), so the two must agree.
          //
          // Fix round 3, verifier P4: the previous note here justified the
          // change by calling the old `id: 'demo'` "a response ccd cannot
          // produce" — while substituting 'claude:OpenClawHetzner', which ccd
          // cannot produce either. `cmd_ws_audit` validates the id BEFORE
          // doing anything (`[[ $id =~ ^[A-Za-z0-9._-]+$ ]] || die`, ccd:2512)
          // and a colon is not in that class, so that request dies and the
          // route 502s. Both this fixture and the session it describes now use
          // a real workspace session id: ccd builds them as `$project-$slug`
          // (ccd:712), and reap only ever applies to a workspace session.
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
