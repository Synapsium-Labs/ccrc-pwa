// M4.B1's W4 half, the detail boundary (native Docs reader, W4 Task 8; design 2026-10-01 section 4.12, the W4 plan's
// refinements (a) and (m)). `app.tsx` wraps the detail ladder in a `RenderBoundary` INSIDE `<section
// className="shell-detail">`, keyed `path + search`: a screen that throws while rendering shows "This screen could
// not be shown." in the pane, while `.shell-nav`, the login overlay and the toasts, all outside it, stay mounted;
// any navigation (Back to the fleet, another route, the same path with another search) renders the ladder again.
//
// The thrower is a mocked `RunsScreen` at `/runs`, a W4 stand-in: M4.B1's own fixture is "a mocked throwing
// `DocsScreen` at `/docs`", and that screen and route arm are W5's (refinement (a); Task 12 records the W5 half for
// W5's brief). Its own file because the module mock is per-file (app-pane-reset-timing.test.tsx's reason).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { clearAuthLost, raiseAuthLost } from '../src/lib/auth';
import { toast } from '../src/components/Toast';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

/** `vi.hoisted`: the mock factory runs while app.tsx is being evaluated, before this file's body. */
const boom = vi.hoisted(() => ({ on: true }));

vi.mock('../src/screens/RunsScreen', () => ({
  RunsScreen: (): ReactNode => {
    if (boom.on) throw new Error('runs screen broke');
    return <h1>runs (stand-in)</h1>;
  },
}));

const { App } = await import('../src/app');

let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

beforeEach(() => {
  boom.on = true;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  // React reports every error a boundary caught through console.error; silenced here, in this file only.
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  act(() => clearAuthLost());
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  warn.mockRestore();
  error.mockRestore();
});

const FALLBACK = 'This screen could not be shown.';
const detail = (): HTMLElement => document.querySelector('.shell-detail') as HTMLElement;

describe('a throwing detail screen keeps the shell (M4.B1, W4 half)', () => {
  it('draws the fallback inside .shell-detail while .shell-nav stays mounted', () => {
    navigate('/runs');
    render(<App />);
    expect(document.querySelector('.shell-nav')).not.toBeNull();
    expect(detail()).not.toBeNull();
    expect(detail()).toContainElement(screen.getByText(FALLBACK));
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', expect.objectContaining({ message: 'runs screen broke' }));
  });

  it('Back to the fleet navigates to / and the pane shows the placeholder again', () => {
    navigate('/runs');
    render(<App />);
    fireEvent.click(screen.getByRole('button', { name: 'Back to the fleet' }));
    expect(location.pathname).toBe('/');
    expect(screen.getByText('Select a session')).toBeInTheDocument();
    expect(screen.queryByText(FALLBACK)).toBeNull();
  });

  it('navigating to another route resets the boundary too', () => {
    navigate('/runs');
    render(<App />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    act(() => { navigate('/settings'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
  });

  it('the same path with another search resets it: the key is path + search', () => {
    navigate('/runs?x=1');
    render(<App />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    boom.on = false;
    act(() => { navigate('/runs?x=2'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole('heading', { name: 'runs (stand-in)' })).toBeInTheDocument();
  });

  it('the same path and search keeps the fallback, even once the screen would draw', () => {
    navigate('/runs?x=1');
    render(<App />);
    boom.on = false;
    act(() => { navigate('/runs?x=1'); });
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });

  it('the toasts and the login overlay, outside the boundary, still mount while the fallback shows', () => {
    navigate('/runs');
    render(<App />);
    act(() => { toast('still here'); });
    expect(screen.getByText('still here')).toBeInTheDocument();
    act(() => raiseAuthLost('expired'));
    expect(document.querySelector('.login-screen')).not.toBeNull();
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
  });
});
