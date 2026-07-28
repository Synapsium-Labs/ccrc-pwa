import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SessionCard } from '../src/fleet/SessionCard';
import { api } from '../src/lib/api';
import { ToastHost } from '../src/components/Toast';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// — fixtures —

const MIN = 60_000;

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
});
