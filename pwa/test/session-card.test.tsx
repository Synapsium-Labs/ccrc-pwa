import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SessionCard } from '../src/fleet/SessionCard';
import { api } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';

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
 *  failed lifecycle route (`{ ok: false, stderr }`, no `error` key). */
const stubFetch502 = (stderr: string): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: false, stderr }), {
        status: 502,
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
};

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
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
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, tasks: null,
  version: '2.1.0',
  ...over,
});

describe('card title', () => {
  it('titles on the project when standalone, exactly as before', () => {
    render(<SessionCard session={s({ project: 'alpha' })} onOpen={() => {}} />);
    expect(screen.getByRole('button', { name: 'alpha' })).toBeInTheDocument();
  });

  it('titles on the workspace inside a group', () => {
    render(<SessionCard session={s({ project: 'alpha', workspace: 'quiet-mesa' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'quiet-mesa' })).toBeInTheDocument();
  });

  it('prefers the live display name over the slug', () => {
    render(<SessionCard session={s({ project: 'alpha', workspace: 'quiet-mesa',
                                     name: 'fix the C-u under-press' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'fix the C-u under-press' })).toBeInTheDocument();
  });

  it('falls back to the branch when name and workspace are null', () => {
    render(<SessionCard session={s({ project: 'alpha', branch: 'ccrc/thing' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'ccrc/thing' })).toBeInTheDocument();
  });

  it('falls back to the id for a grouped main checkout with no name, workspace, or branch', () => {
    render(<SessionCard session={s({ project: 'alpha', id: 'claude:alpha-main',
                                     name: null, workspace: null, branch: null })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'claude:alpha-main' })).toBeInTheDocument();
  });
});

describe('remove workspace', () => {
  it('is absent on a main checkout — it can never be removed', () => {
    render(<SessionCard session={s({ workspace: null })} onOpen={() => {}} inGroup />);
    expect(screen.queryByRole('button', { name: /remove workspace/i })).toBeNull();
  });

  it('calls the API for a workspace', async () => {
    const spy = vi.spyOn(api, 'workspaceRemove').mockResolvedValue(undefined);
    render(<SessionCard session={s({ id: 'alpha-quiet-mesa', workspace: 'quiet-mesa' })}
                        onOpen={() => {}} inGroup />);
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    await waitFor(() => expect(spy).toHaveBeenCalledWith('alpha-quiet-mesa'));
  });

  it("surfaces ccd's refusal instead of pretending it worked", async () => {
    vi.spyOn(api, 'workspaceRemove')
      .mockRejectedValue(new Error('worktree not removed (uncommitted changes?)'));
    render(
      <>
        <SessionCard session={s({ id: 'alpha-quiet-mesa', workspace: 'quiet-mesa' })}
                     onOpen={() => {}} inGroup />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    await waitFor(() =>
      expect(screen.getByText(/uncommitted changes/)).toBeInTheDocument());
  });

  // The test above mocks api.workspaceRemove directly with a plain Error, so
  // its .message already equals ccd's text by construction — it can never
  // catch a broken ApiError -> toast translation. This one goes through the
  // real fetch -> ApiError path with the server's actual 502 shape
  // ({ ok: false, stderr }, no `error` key) to prove the toast carries
  // ccd's stderr rather than the generic "request failed (502)".
  it("surfaces ccd's stderr from a real 502, not a generic request-failed message", async () => {
    stubFetch502('worktree not removed (uncommitted changes?)');
    render(
      <>
        <SessionCard session={s({ id: 'alpha-quiet-mesa', workspace: 'quiet-mesa' })}
                     onOpen={() => {}} inGroup />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    await waitFor(() =>
      expect(screen.getByText(/uncommitted changes/)).toBeInTheDocument());
    expect(screen.queryByText(/request failed/)).toBeNull();
  });
});

describe('restart', () => {
  // Same defect, same fix, same proof: api.ensure is another runCcd-backed
  // lifecycle route that fails as a 502 { stderr } — a raw err.message would
  // show the same opaque "request failed (502)" on a failed restart.
  it("surfaces ccd's stderr from a real 502, not a generic request-failed message", async () => {
    stubFetch502('ccd: no such wrapper');
    render(
      <>
        <SessionCard session={s({ status: 'dead' })} onOpen={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /restart session/i }));
    await waitFor(() =>
      expect(screen.getByText(/no such wrapper/)).toBeInTheDocument());
    expect(screen.queryByText(/request failed/)).toBeNull();
  });
});
