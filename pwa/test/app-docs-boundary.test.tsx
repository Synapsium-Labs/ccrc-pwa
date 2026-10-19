// M4.B1's W5 half, the detail boundary around the Docs screen (W5 part 1 Task 9; design 2026-10-01 section 4.12): a
// mocked `DocsScreen` that throws while rendering at `/docs` shows "This screen could not be shown." inside
// `.shell-detail` while `.shell-nav` stays mounted, the boundary reports where it caught it, and any navigation
// draws the ladder again. W4 proved the boundary on a stand-in (`app-detail-boundary.test.tsx`, a throwing
// `RunsScreen`); this is the row's own fixture. Its own file because the module mock is per file.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockInstance } from 'vitest';
import type { ReactNode } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { navigate } from '../src/lib/router';
import { useFleetStore } from '../src/stores/fleet';

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
    navigate('/docs');
    render(<App />);
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

  it('navigating away from Docs resets it too', () => {
    navigate('/docs/demo?ref=ws/a');
    render(<App />);
    expect(screen.getByText(FALLBACK)).toBeInTheDocument();
    act(() => { navigate('/settings'); });
    expect(screen.queryByText(FALLBACK)).toBeNull();
    expect(screen.getByRole('heading', { name: /^settings$/i })).toBeInTheDocument();
  });
});
