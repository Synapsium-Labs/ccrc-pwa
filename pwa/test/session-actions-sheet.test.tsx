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
  tasks: null, pr: null, archivedAt: null, archivedBytes: null, held: null,
  hookState: null, askSummary: null, subagents: null,
  bucket: 'idle', bucketSince: null, ...over,
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

describe('archive and restore (D5 rider 1)', () => {
  it('Archive shows only for an unarchived workspace session, and POSTs /archive', async () => {
    render(<SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/archive'))).toBe(true));
  });

  it('Restore shows only on the complement, and POSTs /restore', async () => {
    render(<SessionActionsSheet session={s({ archivedAt: null })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/restore workspace/i)).not.toBeInTheDocument();
    cleanup();
    render(<SessionActionsSheet session={s({ archivedAt: 1785300000 })} open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/archive workspace/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /restore workspace/i }));
    await waitFor(() => expect(vi.mocked(fetch).mock.calls.some(
      (c) => String(c[0]).endsWith('/demo-quiet-mesa/restore'))).toBe(true));
  });

  it('no workspace → neither appears', () => {
    render(<SessionActionsSheet session={s({ workspace: null, archivedAt: 1785300000 })}
                                open onClose={() => {}} onReap={() => {}} />);
    expect(screen.queryByText(/archive workspace/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/restore workspace/i)).not.toBeInTheDocument();
  });

  it("failure toasts Couldn't archive — with ccd's own words", async () => {
    stubFetch({ ok: false, stderr: 'not merged' });
    render(
      <>
        <SessionActionsSheet session={s()} open onClose={() => {}} onReap={() => {}} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /archive workspace/i }));
    expect(await screen.findByText(/Couldn't archive — not merged/)).toBeInTheDocument();
  });
});

describe('hold and release', () => {
  // `f`, not a second `s`: the brief's own tests name it `f`, and it is
  // exactly `s` — one session-literal builder for this file.
  const f = s;
  const sheetProps = { open: true, onClose: () => {}, onReap: () => {} };

  let heldCalls: { id: string; reason: string }[];
  let released: string[];

  beforeEach(() => {
    heldCalls = [];
    released = [];
    // A fetch stub that RECORDS hold/release requests rather than merely
    // answering 200 — `stubFetch`'s blanket 502 above is the wrong shape
    // here (SwapSheet's useDisabledWrappers polls /api/accounts on its own
    // effect, mounted alongside every SessionActionsSheet, and that call
    // must not read as a hold/release failure).
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      const id = url.split('/').at(-2) ?? '';
      if (method === 'POST' && url.endsWith('/hold')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { reason?: string };
        heldCalls.push({ id, reason: body.reason ?? '' });
      } else if (method === 'POST' && url.endsWith('/release')) {
        released.push(id);
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
  });

  it('the actions sheet offers Hold on an unheld workspace and Release on a held one, never both', () => {
    const { rerender } = render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
    expect(screen.getByRole('button', { name: /hold/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /release/i })).toBeNull();
    rerender(<SessionActionsSheet session={f({ held: 'program:x wave:2/4' })} {...sheetProps} />);
    expect(screen.getByRole('button', { name: /release/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^hold/i })).toBeNull();
  });

  it('offers neither once the workspace is archived — a hold cannot protect a pane that is already gone', () => {
    render(<SessionActionsSheet session={f({ held: null, archivedAt: 1785300000 })} {...sheetProps} />);
    expect(screen.queryByRole('button', { name: /hold/i })).toBeNull();
  });

  // `fireEvent`, not `userEvent`, for every click below — matching this
  // file's own established idiom for Sheet-rendered controls (every other
  // describe block here does the same). vaul's Drawer attaches its own
  // pointer/drag handlers to its content, and `userEvent.click`'s realistic
  // pointerdown/pointerup sequence walks straight into them under jsdom
  // (`getTranslate` reads a transform jsdom never sets) — an uncaught
  // exception vitest reports separately from the assertions, real but
  // orthogonal to anything this suite is testing.
  it('Release names its consequence before acting', () => {
    render(<SessionActionsSheet session={f({ held: 'program:x' })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    // The confirm says what release re-enables BEFORE anything is sent:
    expect(screen.getByText(/will archive on the next sweep after its PR merges/)).toBeInTheDocument();
    expect(released).toHaveLength(0);   // nothing sent yet — the copy precedes the act
  });

  it('confirming Release posts /release and closes the sheet', async () => {
    const onClose = vi.fn();
    render(<SessionActionsSheet session={f({ held: 'program:x' })} open onClose={onClose} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /release/i }));
    // QuickConfirm's own confirm button — targeted by its wrapper class
    // rather than role/name, which the opener Release button (still mounted
    // behind it) also matches.
    const confirmBtn = document.querySelector<HTMLButtonElement>('.qc-actions .btn-primary')!;
    fireEvent.click(confirmBtn);
    await waitFor(() => expect(released).toEqual(['demo-quiet-mesa']));
    expect(onClose).toHaveBeenCalled();
  });

  it("Hold refuses to send an empty reason, with the server's own sentence", () => {
    render(<SessionActionsSheet session={f({ held: null })} {...sheetProps} />);
    fireEvent.click(screen.getByRole('button', { name: /hold/i }));
    fireEvent.click(screen.getByRole('button', { name: /confirm|hold/i }));
    expect(heldCalls).toHaveLength(0);
    expect(screen.getByText(/say which program holds this/)).toBeInTheDocument();
  });

  it('Hold sends the typed reason and closes the sheet on success', async () => {
    const onClose = vi.fn();
    render(<SessionActionsSheet session={f({ held: null })} open onClose={onClose} onReap={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:agent-evals wave:2/4' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    await waitFor(() => expect(heldCalls).toEqual(
      [{ id: 'demo-quiet-mesa', reason: 'program:agent-evals wave:2/4' }]));
    expect(onClose).toHaveBeenCalled();
  });

  it("surfaces ccd's own refusal text when a hold request fails", async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      JSON.stringify({ ok: false, stderr: 'archived — restore first' }),
      { status: 502, headers: { 'content-type': 'application/json' } },
    )));
    render(
      <>
        <SessionActionsSheet session={f({ held: null })} {...sheetProps} />
        <ToastHost />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: /^hold$/i }));
    fireEvent.change(screen.getByLabelText('Hold reason'), { target: { value: 'program:x' } });
    fireEvent.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/Couldn't hold — archived — restore first/)).toBeInTheDocument();
  });
});
