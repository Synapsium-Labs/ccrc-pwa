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
  tasks: null, ...over,
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
      <SessionActionsSheet session={null} open={false} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('offers Remove workspace for a workspace session', () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /remove workspace/i })).toBeInTheDocument();
  });

  it('hides Remove workspace for a main checkout — ws-rm would refuse it anyway', () => {
    render(<SessionActionsSheet session={s({ workspace: null })} open onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /remove workspace/i })).not.toBeInTheDocument();
  });

  it('explains the limit consequence that the line only had room to flag', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 82, seven: 10 } })}
                                open onClose={() => {}} />);
    expect(screen.getByText(/5h limit near/i)).toBeInTheDocument();
  });

  // The 5h case above never exercises the `seven` half of the ternary chain —
  // a mutation there (`seven > CRITICAL` -> `<`) would still leave this
  // green. Pin it with the 7d window as the ONLY one over threshold.
  it('narrates the 7d window when only it is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 82 } })}
                                open onClose={() => {}} />);
    expect(screen.getByText(/7d limit near/i)).toBeInTheDocument();
  });

  it('says nothing about limits when neither window is critical', () => {
    render(<SessionActionsSheet session={s({ limits: { five: 10, seven: 10 } })}
                                open onClose={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });

  // Dead sessions stay silent about limits (SessionLine does the same): a
  // session that will never run again has nothing to warn about moving.
  it('says nothing about limits on a dead session, even past the threshold', () => {
    render(<SessionActionsSheet session={s({ status: 'dead', limits: { five: 90, seven: 90 } })}
                                open onClose={() => {}} />);
    expect(screen.queryByText(/limit near/i)).not.toBeInTheDocument();
  });
});

describe('actions', () => {
  it('restarts through api.ensure', async () => {
    render(<SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(String(call[0])).toContain('demo-quiet-mesa');
  });

  // api.ensure kept its id assertion when SessionCard's tests were dropped;
  // api.workspaceRemove did not — a hardcoded id in the request would have
  // shipped unnoticed.
  it('sends the session id to api.workspaceRemove', async () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThan(0));
    const call = vi.mocked(fetch).mock.calls[0]!;
    expect(String(call[0])).toContain('demo-quiet-mesa');
  });

  // THE regression this project has shipped twice. The server answers
  // 502 { ok, stderr } with no `error` key, so err.message yields the generic
  // "request failed (502)" and ccd's actual refusal never reaches the reader.
  it("surfaces ccd's own refusal text when a remove fails", async () => {
    stubFetch({ ok: false, stderr: 'ccd: worktree not removed (uncommitted changes?)' });
    render(
      <>
        <SessionActionsSheet session={s()} open onClose={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove workspace/i }));
    expect(await screen.findByText(/uncommitted changes/i)).toBeInTheDocument();
  });

  it("surfaces ccd's own refusal text when a restart fails", async () => {
    stubFetch({ ok: false, stderr: 'ccd: no such session: demo-quiet-mesa' });
    render(
      <>
        <SessionActionsSheet session={s({ status: 'dead' })} open onClose={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /restart/i }));
    expect(await screen.findByText(/no such session/i)).toBeInTheDocument();
  });
});

describe('away note', () => {
  it('spells out the swap, which the line only marks', () => {
    render(<SessionActionsSheet session={s({ wrapper: 'claude2', home: 'claude' })}
                                open onClose={() => {}} />);
    expect(screen.getByText(/Pinned to team·max, running on alt·max/)).toBeInTheDocument();
  });

  it('says nothing when the session is home', () => {
    render(<SessionActionsSheet session={s({ wrapper: 'claude', home: 'claude' })}
                                open onClose={() => {}} />);
    expect(screen.queryByText(/Pinned to/)).not.toBeInTheDocument();
  });
});
