import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { SessionCard } from '../src/fleet/SessionCard';

afterEach(() => {
  cleanup();
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

  it('falls back to the branch, then to main for a grouped main checkout', () => {
    render(<SessionCard session={s({ project: 'alpha', branch: 'ccrc/thing' })}
                        onOpen={() => {}} inGroup />);
    expect(screen.getByRole('button', { name: 'ccrc/thing' })).toBeInTheDocument();
  });
});
