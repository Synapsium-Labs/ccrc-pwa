// Desktop polish C48 (D-8782): a session's own details list its worktrees with the three controls the fleet list's row had, and
// each control posts what that row posted at `main`: Keep -> POST /api/leases/:lease/operator-retain {}, Attach to… ->
// POST /api/leases/:lease/resolve {action:'attach', parent}, Not delegated -> POST /api/leases/:lease/resolve {action:'foreign'}.
// The words and the refusals are `session-worktrees.test.tsx`'s; this file holds that the details DRAW them for the right session.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastHost } from '@ccrc/ui';
import { SessionDetails } from '../src/session/SessionDetails';
import { sessionFacts } from '../src/fleet/sessionFacts';
import { leasesStartedBy, readDelegation } from '../src/fleet/delegationWords';
import { worktreeSidesKey, worktreesOf } from '../src/fleet/sessionWorktrees';
import { fleetSession } from './fleetFixture';
import { frame, lease } from './delegationFixture';
import { LEASE_ID, okJson } from './leaseCardFixture';

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const coord = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a' });
const detailsOf = (self: typeof coord, others: (typeof coord)[], w = frame({ leases: [lease({ leaseId: LEASE_ID, sourceKind: 'raw', disposition: 'retained', expiresAt: null })] })) => {
  const leases = leasesStartedBy(self.id, readDelegation(w));
  const key = worktreeSidesKey(leases, self.id, (id) => [self, ...others].find((s) => s.id === id) ?? null);
  return <><SessionDetails facts={sessionFacts({ session: self, now: Date.now(), worktrees: worktreesOf(leases, key) })} coordination={null} /><ToastHost /></>;
};
const open = (ui: ReturnType<typeof detailsOf>) => {
  const r = render(ui);
  const door = screen.queryByRole('button', { name: 'Session details' });
  if (door !== null && door.getAttribute('aria-expanded') === 'false') fireEvent.click(door);
  return r;
};
const record = () => {
  const calls: { url: string; method: string | undefined; body: unknown }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
    return okJson({ ok: true, lease: LEASE_ID, generation: 2, disposition: 'retained', expiresAt: null, carrier: 'pending' });
  }));
  return calls;
};

describe('a session\'s details list its worktrees with their controls (C48, D-8782)', () => {
  it('the details draw the lease row and its three controls', () => {
    open(detailsOf(coord, []));
    const row = document.querySelector<HTMLElement>('.sess-worktrees .proj-work')!;
    expect(row, 'the worktree row').not.toBeNull();
    expect(row.textContent).toContain('agent-a1');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
  });

  it('a raw lease whose session is listed live offers all three, and each posts what the fleet-list row posted', async () => {
    const calls = record();
    open(detailsOf(coord, []));
    const row = (): HTMLElement => document.querySelector<HTMLElement>('.sess-worktrees .proj-work')!;
    expect(within(row()).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(calls).toEqual([{ url: expect.stringMatching(new RegExp(`/api/leases/${LEASE_ID}/operator-retain$`)), method: 'POST', body: {} }]);
    calls.length = 0;
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Attach to coord-a' }));
    expect(calls).toEqual([{ url: expect.stringMatching(new RegExp(`/api/leases/${LEASE_ID}/resolve$`)), method: 'POST', body: { action: 'attach', parent: 'coord-a' } }]);
    calls.length = 0;
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not delegated' }));
    expect(calls).toEqual([{ url: expect.stringMatching(new RegExp(`/api/leases/${LEASE_ID}/resolve$`)), method: 'POST', body: { action: 'foreign' } }]);
  });

  it('an offline coordinator\'s lease shows on that coordinator\'s own details, which open for a session the list does not carry', () => {
    const gone = fleetSession({ id: 'coord-gone', project: 'project-a', workspace: null, workdir: '/work/project-a-gone', name: 'coord-gone', archivedAt: 1_800_000_000_000 });
    const w = frame({ leases: [lease({ leaseId: LEASE_ID, parentId: 'coord-gone', group: 'offline-coordinator', sourceKind: 'raw', disposition: 'retained', expiresAt: null })] });
    open(detailsOf(gone, [coord], w));
    expect(document.querySelectorAll('.sess-worktrees .proj-work')).toHaveLength(1);
    // And not on another session's details.
    cleanup();
    open(detailsOf(coord, [gone], w));
    expect(document.querySelectorAll('.sess-worktrees .proj-work')).toHaveLength(0);
  });

  it('a session holding no worktree draws no section', () => {
    open(detailsOf(coord, [], frame({})));
    expect(document.querySelector('.sess-worktrees')).toBeNull();
  });
});
