// Task 8 — SessionHeader (stop keycap gated on busy, live-name fallback),
// the screen-level api.interrupt wiring (incl. the 409 not-busy toast), and
// the visualViewport keyboard-inset hook.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
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
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null, pr: null, archivedAt: null,
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
