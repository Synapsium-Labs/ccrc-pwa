import { afterEach, describe, it, expect } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { ProjectGroup } from '../src/fleet/ProjectGroup';
import type { FleetGroup } from '../src/fleet/groupFleet';
import type { FleetSession } from '../../shared/api';

afterEach(cleanup);

const s = (over: Partial<FleetSession>): FleetSession => ({
  id: 'x', wrapper: 'claude2', home: 'claude2', project: 'p', workdir: '/p',
  workspace: null, name: null, status: 'idle', statusUpdatedAt: 0, limits: null,
  dialogPending: false, version: null, model: null, effort: null,
  ultracode: false, branch: null, tasks: null, ...over,
});

const s1 = s({ id: 'a' });
const s2 = s({ id: 'b', workspace: 'quiet-mesa' });

const g = (over: Partial<FleetGroup>): FleetGroup => ({
  project: 'alpha',
  sessions: [s1],
  grouped: false,
  attention: false,
  busy: 0,
  ...over,
});

describe('ProjectGroup', () => {
  it('renders an ungrouped project as bare cards, with no header', () => {
    render(<ProjectGroup group={g({ grouped: false })} onOpen={() => {}} />);
    expect(screen.queryByRole('button', { name: /collapse|expand/i })).toBeNull();
  });

  it('renders a header with a session count when grouped', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}} />);
    expect(screen.getByText('alpha')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('collapses and expands', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2] })} onOpen={() => {}} />);
    const toggle = screen.getByRole('button', { name: /alpha/i });
    expect(screen.getAllByRole('article')).toHaveLength(2);
    fireEvent.click(toggle);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
  });

  it('shows attention on a COLLAPSED header — folding must not hide it', () => {
    render(<ProjectGroup group={g({ grouped: true, sessions: [s1, s2], attention: true })}
                         onOpen={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /alpha/i }));
    expect(screen.getByLabelText(/waiting on you/i)).toBeInTheDocument();
  });
});
