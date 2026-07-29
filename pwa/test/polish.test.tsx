// Task 14 — polish gate fixes: theme reachability (the light theme must be
// applied, not just defined), the card→chat view transition, session-screen
// status fallback (dead/busy states before the stream's first status frame),
// the critical-limit narration line, and the attach input's gallery access.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { initTheme, type ThemeMedia } from '../src/lib/theme';
import { navigate } from '../src/lib/router';
import { AttachButton } from '../src/session/AttachButton';
import { SessionCard } from '../src/fleet/SessionCard';
import { SessionScreen } from '../src/screens/SessionScreen';
import { createFleetStore } from '../src/stores/fleet';
import { createSessionStore } from '../src/stores/session';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-theme');
  Reflect.deleteProperty(document, 'startViewTransition');
});

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
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null,
  version: null,
  ...patch,
});

const media = (matches: boolean): ThemeMedia & { fire: (matches: boolean) => void } => {
  let cb: ((e: { matches: boolean }) => void) | null = null;
  return {
    matches,
    addEventListener: (_t, listener) => {
      cb = listener;
    },
    fire(next: boolean) {
      cb?.({ matches: next });
    },
  };
};

// — theme: the light theme must be reachable (follows the system setting) —

describe('initTheme', () => {
  it('stamps data-theme="light" when the system prefers light', () => {
    initTheme(media(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  it('leaves the dark default (no attribute) when the system prefers dark', () => {
    initTheme(media(false));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('follows live system theme changes both ways', () => {
    const mq = media(false);
    initTheme(mq);
    act(() => mq.fire(true));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    act(() => mq.fire(false));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

// — router: card→chat navigation rides a view transition when available —

describe('navigate view transition', () => {
  it('wraps the route change in document.startViewTransition when supported', () => {
    const vt = vi.fn((cb: () => void) => {
      cb();
      return { finished: Promise.resolve() };
    });
    (document as { startViewTransition?: unknown }).startViewTransition = vt;
    navigate('/s/x');
    expect(vt).toHaveBeenCalledTimes(1);
    expect(location.pathname).toBe('/s/x');
    navigate('/');
  });

  it('falls back to a plain route change without the API', () => {
    navigate('/s/y');
    expect(location.pathname).toBe('/s/y');
    navigate('/');
  });
});

// — session screen: fleet status fills in before the stream's first frame —

describe('SessionScreen status fallback', () => {
  it('a fleet-dead session shows the read-only banner and disables the composer before any stream status arrives', () => {
    const store = createSessionStore('claude:OpenClawHetzner', { makeSocket: fakeSocket });
    // Backlog landed (uuid known) but no status frame ever came.
    act(() => {
      store.setState({ uuid: 'u-1', status: null });
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({ conn: 'open', sessions: [fleetSession({ status: 'dead' })] });
    });
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    expect(screen.getByText(/chat is read-only/i)).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeDisabled();
  });

  it('a live stream status wins over the fleet snapshot', () => {
    const store = createSessionStore('claude:OpenClawHetzner', { makeSocket: fakeSocket });
    act(() => {
      store.setState({ uuid: 'u-1', status: 'idle' });
    });
    const fleet = createFleetStore({ makeSocket: fakeSocket });
    act(() => {
      fleet.setState({ conn: 'open', sessions: [fleetSession({ status: 'dead' })] });
    });
    render(<SessionScreen id="claude:OpenClawHetzner" store={store} fleet={fleet} />);
    expect(screen.queryByText(/chat is read-only/i)).not.toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Message' })).toBeEnabled();
  });
});

// — session card: a critical limit narrates its consequence (DIRECTION.md) —

describe('SessionCard limit narration', () => {
  it('narrates the 5h window crossing critical', () => {
    render(
      <SessionCard
        session={fleetSession({ limits: { five: 82, seven: 40 } })}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/5h limit near — will move to another account/i)).toBeInTheDocument();
  });

  it('narrates the 7d window when only it is critical', () => {
    render(
      <SessionCard
        session={fleetSession({ limits: { five: 10, seven: 80 } })}
        onOpen={() => {}}
      />,
    );
    expect(screen.getByText(/7d limit near/i)).toBeInTheDocument();
  });

  it('stays quiet below the critical band and on dead sessions', () => {
    render(
      <SessionCard
        session={fleetSession({ limits: { five: 60, seven: 74 } })}
        onOpen={() => {}}
      />,
    );
    render(
      <SessionCard
        session={fleetSession({ status: 'dead', limits: { five: 90, seven: 90 } })}
        onOpen={() => {}}
      />,
    );
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });
});

// — attach: picking from the photo library must stay possible —

describe('AttachButton input', () => {
  it('does not force direct camera capture (gallery screenshots are the main lane)', () => {
    const { container } = render(<AttachButton onPick={() => {}} />);
    const input = container.querySelector('input[type="file"]');
    expect(input).not.toBeNull();
    expect(input!.hasAttribute('capture')).toBe(false);
  });
});
