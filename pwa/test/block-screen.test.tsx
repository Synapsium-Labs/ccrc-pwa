// The dormant handshake's one visible act. Copy and Reload behaviour only —
// WHEN it renders (blocked/unblocked, its position relative to .app-shell)
// is pinned in app.test.tsx, where the store that decides that lives.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { BlockScreen } from '../src/components/BlockScreen';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('BlockScreen', () => {
  it('states the build is too old for the fleet server, and that it is updating', () => {
    render(<BlockScreen />);
    expect(
      screen.getByText('This app build is too old for the fleet server. Updating…'),
    ).toBeInTheDocument();
  });

  it('announces itself so assistive tech does not need to be looking at it already', () => {
    render(<BlockScreen />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('the Reload button reloads the page — the manual fallback for whenever the automatic SW check is a no-op', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload });
    render(<BlockScreen />);

    fireEvent.click(screen.getByRole('button', { name: /reload/i }));
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
