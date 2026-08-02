// The per-session actions that no longer fit on a row. The failure paths are
// the point: ccd's refusals are the only explanation the reader gets.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { FleetSession } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';

const s = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'demo-quiet-mesa', wrapper: 'claude', home: 'claude', project: 'demo',
  workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', name: null,
  status: 'idle', statusUpdatedAt: null, limits: null, dialogPending: false,
  version: null, model: null, effort: null, ultracode: false, branch: null,
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, ...over,
});

/** The REAL server failure shape: runCcd routes answer 502 with `stderr` and
 *  no `error` key. A mocked rejection would not catch an err.message regression;
 *  this does. */
const stubFetch = (body: unknown, status = 502): void => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), {
    status, headers: { 'content-type': 'application/json' },
  })));
};

// vitest runs without globals, so RTL's auto-cleanup never registers itself
// (see test/message-links.test.tsx et al.) — without this, rerender/multi-render
// tests below leak DOM across `it` blocks.
beforeEach(() => { vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 }))); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('composition', () => {
  it('renders nothing when no session is selected', () => {
    const { container } = render(
      <SessionActionsSheet session={null} open={false} onClose={() => {}} onReap={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('explains the limit consequence that the line only had room to flag', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 82, seven: 10 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/5h limit near/i)).toBeInTheDocument();
  });

  // The 5h case above never exercises the `seven` half of the ternary chain —
  // a mutation there (`seven > CRITICAL` -> `<`) would still leave this
  // green. Pin it with the 7d window as the ONLY one over threshold.
  it('narrates the 7d window when only it is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 82 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/7d limit near/i)).toBeInTheDocument();
  });

  it('says nothing about limits when neither window is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 10 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });

  // Dead sessions stay silent about limits (SessionLine does the same): a
  // session that will never run again has nothing to warn about moving.
  it('says nothing about limits on a dead session, even past the threshold', () => {
    render(<SessionActionsSheet session={s({ status: 'dead', limits: { five: 90, seven: 90 } })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });
});

describe('actions', () => {
  it('restarts through api.ensure', async () => {
    render(<SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    // SwapSheet is mounted (hidden) alongside every SessionActionsSheet and
    // polls /api/accounts on its own effect (useDisabledWrappers), so the
    // restart call is no longer necessarily the first fetch recorded — find
    // it by the id it must carry, rather than assume its position.
    await waitFor(() =>
      expect(vi.mocked(fetch).mock.calls.some((c) => String(c[0]).includes('demo-quiet-mesa'))).toBe(true),
    );
  });

  it("surfaces ccd's own refusal text when a restart fails", async () => {
    stubFetch({ ok: false, stderr: 'ccd: no such session: demo-quiet-mesa' });
    render(
      <>
        <SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} onReap={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    expect(await screen.findByText(/no such session/i)).toBeInTheDocument();
  });
});

describe('the unguarded delete is gone', () => {
  it('offers no Remove workspace button for a workspace session', () => {
    // A shallower unguarded door beside a careful one guarantees the
    // unguarded one gets used.
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/Remove workspace/)).not.toBeInTheDocument();
  });

  it('still offers restart and swap', () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText('Restart session')).toBeInTheDocument();
    expect(screen.getByText('Swap account')).toBeInTheDocument();
  });
});

describe('away note', () => {
  it('spells out the swap, which the line only marks', () => {
    render(<SessionActionsSheet session={s({ wrapper: 'claude2', home: 'claude' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/Pinned to team·max, running on alt·max/)).toBeInTheDocument();
  });

  it('says nothing when the session is home', () => {
    render(<SessionActionsSheet session={s({ wrapper: 'claude', home: 'claude' })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/Pinned to/)).not.toBeInTheDocument();
  });
});

describe('cleanup, guarded', () => {
  it('offers Clean up workspace… only once the workspace is ARCHIVED', () => {
    // Archive is the staging step. Offering cleanup before it would put the
    // confirmed path in front of a running session.
    render(<SessionActionsSheet session={s({ archivedAt: null })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/clean up workspace/i)).not.toBeInTheDocument();
    cleanup();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.getByText(/clean up workspace/i)).toBeInTheDocument();
  });

  it('hands the session UP rather than deleting anything itself', () => {
    const onReap = vi.fn();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={onReap} />);
    fireEvent.click(screen.getByText(/clean up workspace/i));
    expect(onReap).toHaveBeenCalledWith('demo-quiet-mesa');
  });

  it('offers nothing for a main checkout', () => {
    render(<SessionActionsSheet session={s({ workspace: null, archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/clean up workspace/i)).not.toBeInTheDocument();
  });
});
