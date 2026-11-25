// M4.B1's W5 half, the detail boundary around the Docs screen (W5 part 1 Task 9; design 2026-10-01 section 4.12): a
// mocked `DocsScreen` that throws while rendering at `/docs` shows "This screen could not be shown." inside
// `.shell-detail` while `.shell-nav` stays mounted, the boundary reports where it caught it, and any navigation
// draws the ladder again. W4 proved the boundary on a stand-in (`app-detail-boundary.test.tsx`, a throwing
// `RunsScreen`); this is the row's own fixture. Its own file because the module mock is per file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

/** A lazy screen's first load (console speed C1): the wait, and its case's own ceiling a few seconds above it, so a
 *  hang reports the wait's own failure, with the DOM, before the case's timeout (reviews 1464 F8 and 1473 A9). */
const LAZY_WAIT_MS = 30_000;
const LAZY_CEILING_MS = LAZY_WAIT_MS + 5_000;

/** `vi.hoisted`: the mock factory runs while app.tsx is being evaluated, before this file's body. */
const boom = vi.hoisted(() => ({ on: true }));

vi.mock('../src/screens/DocsScreen', () => ({
  DocsScreen: (p: { path: string; search: string }): ReactNode => {
    if (boom.on) throw new Error('docs screen broke');
    return <h1>docs (stand-in) {p.path + p.search}</h1>;
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
  navigate('/');
  act(() => useFleetStore.setState({ sessions: [], conn: 'connecting', notices: [], blocked: false, pools: null }));
  warn.mockRestore();
  error.mockRestore();
});

const FALLBACK = 'This screen could not be shown.';
const detail = (): HTMLElement => document.querySelector('.shell-detail') as HTMLElement;

describe('a throwing DocsScreen keeps the shell (M4.B1, W5 half)', () => {
  it('draws the fallback inside .shell-detail at /docs while .shell-nav stays mounted', () => {
    // Reached inside the console: a tab whose first page is a Docs address is a Docs tab, with no nav column (desktop
    // polish wave 174, fix round 1 L1; `docs-own-tab.test.tsx`).
    navigate('/fleet');
    render(<App />);
    act(() => { navigate('/docs'); });
    expect(document.querySelector('.shell-nav')).not.toBeNull();
    expect(detail()).toContainElement(screen.getByText(FALLBACK));
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', expect.objectContaining({ message: 'docs screen broke' }));
  });

  it('navigating to another Docs page resets the boundary, and the screen draws once it can', () => {
    navigate('/docs');
    render(<App />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    boom.on = false;
    act(() => { navigate('/docs/demo'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole('heading', { name: 'docs (stand-in) /docs/demo' })).toBeInTheDocument();
  });

  // A Docs address loaded first is a Docs tab (desktop polish wave 174), whose tree in `App` has a boundary of its own
  // around the reader. Asserted as a Docs tab first, so the case never depends on what an earlier case left in the tab's
  // store (wave 177: the shared teardown now clears it).
  it('in a Docs tab, a Docs address loaded first: its own boundary draws the fallback and the link back, the tab still a Docs tab', () => {
    navigate('/docs/demo');
    render(<App />);
    const shell = document.querySelector('.app-shell') as HTMLElement;
    expect(shell).toHaveAttribute('data-tab', 'docs');
    expect(shell.querySelector('.shell-nav')).toBeNull();
    expect(detail()).toContainElement(screen.getByText(FALLBACK));
    expect(warn).toHaveBeenCalledWith('ccrc: render error in detail', expect.objectContaining({ message: 'docs screen broke' }));
    // Below the desk width (the setup's `matchMedia` answers no) the link back moves in place, under its own word.
    expect(within(detail()).getByRole('link', { name: 'Back to the console' })).toHaveAttribute('href', '/');
    expect(screen.queryByRole('button', { name: 'Back to the fleet' })).toBeNull();
  });

  it('navigating away from Docs resets it too', { timeout: LAZY_CEILING_MS }, async () => {
    // Reached inside the console, so the move away is the console's own boundary resetting, not a Docs tab's tree giving
    // way to the console's (desktop polish wave 174, fix round 2 A1).
    navigate('/fleet');
    render(<App />);
    act(() => { navigate('/docs/demo?ref=ws/a'); });
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    act(() => { navigate('/settings'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    // Settings loads on demand (console speed C1): its chunk resolves after the navigation's commit.
    expect(await screen.findByRole('heading', { name: /^settings$/i }, { timeout: LAZY_WAIT_MS })).toBeInTheDocument();
  });
});
