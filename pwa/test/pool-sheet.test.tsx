// Tag a project into a roster-derived pool from a phone. No free-text entry is
// offered: inventing a pool with no account in it creates the empty-pool strand
// this UI exists to make visible.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Profiler } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ProjectPoolWire, ProjectPoolsWire, RosterWire } from '../../shared/api';
import { ToastHost } from '../src/components/Toast';
import { ApiError, api } from '../src/lib/api';
import { PoolSheet } from '../src/fleet/PoolSheet';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { TEST_ROSTER } from './rosterFixture';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const fakeSocket = () => ({ close: () => {}, send: () => {} }) as never;

const pooled = (byId: Record<string, string>): RosterWire[] =>
  TEST_ROSTER.map((account) => ({ ...account, pool: byId[account.id] ?? null }));

const storeWith = (roster: RosterWire[]): FleetStore => {
  const store = createFleetStore({ makeSocket: fakeSocket });
  act(() => { store.setState({ conn: 'open', roster }); });
  return store;
};

const frame = (project: string, pool: ProjectPoolWire): ProjectPoolsWire => ({
  listed: true,
  byProject: { [project]: pool },
  enforcement: 'enforced',
});

/** Every test mounts the sole toast subscriber as well as the sheet. Without it,
 * a toast assertion stays red even when the production branch is intact. */
const renderPoolSheet = (props: {
  project?: string | null;
  open?: boolean;
  onClose?: () => void;
  fleet: FleetStore;
}) => {
  const project: string | null = Object.hasOwn(props, 'project')
    ? props.project ?? null
    : 'demo';
  return render(
    <>
      <ToastHost />
      <PoolSheet
        project={project}
        open={props.open ?? true}
        onClose={props.onClose ?? vi.fn()}
        fleet={props.fleet}
      />
    </>,
  );
};

const deferred = <T,>() => {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
};

describe('PoolSheet options', () => {
  it('renders nothing when no project is selected', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    renderPoolSheet({ project: null, fleet: store });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('offers each distinct roster pool once, plus no pool', () => {
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b', 'claude-corp': 'pool-a' }));
    renderPoolSheet({ fleet: store });

    expect(screen.getAllByRole('button', { name: /^pool / }).map((button) => button.textContent))
      .toEqual(['pool-a', 'pool-b']);
    expect(screen.getByRole('button', { name: /no pool/i })).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('offers only no pool when the roster carries no named pools', () => {
    const store = storeWith(pooled({}));
    renderPoolSheet({ fleet: store });

    expect(screen.queryAllByRole('button', { name: /^pool / })).toHaveLength(0);
    expect(screen.getByRole('button', { name: /no pool/i })).toBeInTheDocument();
  });
});

describe('PoolSheet writes', () => {
  it('displays and toasts the route-measured result, not request intent', async () => {
    const set = vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'untagged' } });
    const store = storeWith(pooled({ claude: 'pool-a' }));
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));

    expect(set).toHaveBeenCalledWith('demo', 'pool-a');
    expect(await screen.findByText(/demo is in no pool/i)).toBeInTheDocument();
    expect(screen.getByRole('dialog').textContent).not.toMatch(/demo is in pool pool-a/i);
    const successToast = await screen.findByText('demo is no longer in a pool.', {
      selector: '.toast',
    });
    expect(successToast).toHaveAttribute('role', 'status');
    expect(screen.queryByText('demo is in pool pool-a.', { selector: '.toast' }))
      .not.toBeInTheDocument();
  });

  it('posts explicit null for no pool, never an empty string', () => {
    const set = vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'untagged' } });
    const store = storeWith(pooled({ claude: 'pool-a' }));
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: /no pool/i }));

    expect(set).toHaveBeenCalledWith('demo', null);
  });

  it('toasts the unknown-pool warning from a successful write', async () => {
    vi.spyOn(api, 'setProjectPool').mockResolvedValue({
      ok: true,
      pool: { state: 'tagged', name: 'pool-b' },
      warning: 'unknown-pool',
    });
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));

    expect(await screen.findByText(/no account on this box is in pool pool-b/i, {
      selector: '.toast',
    })).toHaveTextContent(/no account on this box is in pool pool-b/i);
  });

  it('toasts the refusal text and does not invent a measured result', async () => {
    vi.spyOn(api, 'setProjectPool').mockRejectedValue(new ApiError(502, {
      ok: false,
      stderr: 'could not write the pool tag for demo — it is NOT tagged',
    }));
    const store = storeWith(pooled({ claude: 'pool-a' }));
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));

    expect(await screen.findByText(/it is NOT tagged/i, { selector: '.toast' })).toHaveTextContent(/it is NOT tagged/i);
    expect(screen.getByRole('dialog').textContent).not.toMatch(/demo is in pool pool-a/i);
  });
});

describe('PoolSheet current-pool sources', () => {
  it('uses the frame before the sheet has written', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => { store.setState({ pools: frame('demo', { state: 'tagged', name: 'pool-a' }) }); });
    renderPoolSheet({ fleet: store });

    expect(screen.getByText(/demo is in pool pool-a/i)).toBeInTheDocument();
  });

  it('says the fleet has not said when no pools frame has arrived', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    renderPoolSheet({ fleet: store });

    expect(screen.getByText(/has not said which pool/i)).toBeInTheDocument();
  });

  it('names the marker path when the tag is unreadable', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => { store.setState({ pools: frame('demo', { state: 'unreadable' }) }); });
    renderPoolSheet({ fleet: store });

    expect(screen.getByText(/~\/\.cc-sessions\/pools\/demo/)).toBeInTheDocument();
  });

  it('says this app is older than the fleet for an unrecognised current state', () => {
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => {
      store.setState({ pools: frame('demo', {
        state: 'future-pool-state',
      } as unknown as ProjectPoolWire) });
    });
    renderPoolSheet({ fleet: store });

    expect(screen.getByText(/app is older than the fleet; reload/i)).toBeInTheDocument();
    expect(screen.queryByText(/could not be read/i)).not.toBeInTheDocument();
  });

  it('forgets a measured result after close and reopen', async () => {
    vi.spyOn(api, 'setProjectPool')
      .mockResolvedValue({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
    const store = storeWith(pooled({ claude: 'pool-a' }));
    const view = renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    expect(await screen.findByText(/demo is in pool pool-a/i, {
      selector: '.sheet-copy',
    })).toBeInTheDocument();

    view.rerender(
      <><ToastHost /><PoolSheet project="demo" open={false} onClose={vi.fn()} fleet={store} /></>,
    );
    view.rerender(
      <><ToastHost /><PoolSheet project="demo" open onClose={vi.fn()} fleet={store} /></>,
    );

    expect(screen.getByText(/has not said which pool/i)).toBeInTheDocument();
  });

  it('invalidates a pending write across a close and reopen of the same project', async () => {
    const response = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockReturnValue(response.promise);
    const store = storeWith(pooled({ claude: 'pool-a' }));
    const view = renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    view.rerender(
      <><ToastHost /><PoolSheet project="demo" open={false} onClose={vi.fn()} fleet={store} /></>,
    );
    view.rerender(
      <><ToastHost /><PoolSheet project="demo" open onClose={vi.fn()} fleet={store} /></>,
    );
    await act(async () => {
      response.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await response.promise;
    });

    expect(screen.getByRole('dialog')).toHaveTextContent(/has not said which pool/i);
    expect(screen.queryByText(/demo is in pool pool-a\./i)).not.toBeInTheDocument();
  });
});

describe('PoolSheet unmount relevance', () => {
  it('does not publish a completion toast after the sheet unmounts', async () => {
    const response = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockReturnValue(response.promise);
    const store = storeWith(pooled({ claude: 'pool-a' }));
    const view = renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    // Keep the production toast subscriber mounted so a stale toast remains observable.
    view.rerender(<ToastHost />);
    await act(async () => {
      response.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await response.promise;
    });

    expect(screen.queryByText(/demo is in pool pool-a\./i)).not.toBeInTheDocument();
  });
});

describe('PoolSheet frame relevance', () => {
  it('keeps a measured response over a frame observed before that response', async () => {
    const response = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockReturnValue(response.promise);
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => { store.setState({ pools: frame('demo', { state: 'untagged' }) }); });
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    // A frame can arrive while the write is in flight. It predates the response
    // and therefore cannot overwrite the route's fresher read-back.
    act(() => { store.setState({ pools: frame('demo', { state: 'untagged' }) }); });
    await act(async () => {
      response.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await response.promise;
    });

    expect(screen.getByRole('dialog')).toHaveTextContent(/demo is in pool pool-a/i);
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/demo is in no pool/i);
  });

  it('yields to the first pools frame after the response without closing', async () => {
    const response = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockReturnValue(response.promise);
    const store = storeWith(pooled({ claude: 'pool-a' }));
    act(() => { store.setState({ pools: frame('demo', { state: 'untagged' }) }); });
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    await act(async () => {
      response.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await response.promise;
    });
    expect(screen.getByRole('dialog')).toHaveTextContent(/demo is in pool pool-a/i);

    act(() => { store.setState({ pools: frame('demo', { state: 'untagged' }) }); });

    expect(screen.getByRole('dialog')).toHaveTextContent(/demo is in no pool/i);
    expect(screen.getByRole('heading', { name: 'Which pool runs this project?' })).toBeInTheDocument();
  });
});

describe('PoolSheet request relevance', () => {
  it('leaves B display, toast surface, and saving state untouched when stale A succeeds', async () => {
    const first = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    const second = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockImplementation((project) =>
      project === 'alpha' ? first.promise : second.promise,
    );
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    act(() => {
      store.setState({ pools: {
        listed: true,
        byProject: {
          alpha: { state: 'untagged' },
          beta: { state: 'tagged', name: 'pool-b' },
        },
        enforcement: 'enforced',
      } });
    });
    const view = renderPoolSheet({ project: 'alpha', fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    view.rerender(<><ToastHost /><PoolSheet project="alpha" open={false} onClose={vi.fn()} fleet={store} /></>);
    view.rerender(<><ToastHost /><PoolSheet project="beta" open onClose={vi.fn()} fleet={store} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));
    expect(screen.getByRole('button', { name: 'pool pool-b' })).toBeDisabled();

    await act(async () => {
      first.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await first.promise;
    });

    expect(screen.getByText(/beta is in pool pool-b/i)).toBeInTheDocument();
    expect(screen.queryByText(/alpha is in pool pool-a/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/alpha is in pool pool-a\./i)).not.toBeInTheDocument();
    expect(screen.queryByText(/alpha is in pool pool-a\./i, { selector: '.toast' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pool pool-b' })).toBeDisabled();

    await act(async () => {
      second.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-b' } });
      await second.promise;
    });
  });

  it('does not commit stale success state after its sheet has been replaced', async () => {
    const first = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    const second = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockImplementation((project) =>
      project === 'alpha' ? first.promise : second.promise,
    );
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    act(() => {
      store.setState({ pools: {
        listed: true,
        byProject: {
          alpha: { state: 'untagged' },
          beta: { state: 'tagged', name: 'pool-b' },
        },
        enforcement: 'enforced',
      } });
    });
    const commits = vi.fn();
    const view = render(
      <>
        <ToastHost />
        <Profiler id="pool-sheet" onRender={commits}>
          <PoolSheet project="alpha" open onClose={vi.fn()} fleet={store} />
        </Profiler>
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    view.rerender(
      <><ToastHost /><Profiler id="pool-sheet" onRender={commits}><PoolSheet project="alpha" open={false} onClose={vi.fn()} fleet={store} /></Profiler></>,
    );
    view.rerender(
      <><ToastHost /><Profiler id="pool-sheet" onRender={commits}><PoolSheet project="beta" open onClose={vi.fn()} fleet={store} /></Profiler></>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));
    commits.mockClear();

    await act(async () => {
      first.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await first.promise;
    });

    expect(commits).not.toHaveBeenCalled();
    expect(screen.queryByText(/alpha is in pool pool-a\./i, { selector: '.toast' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog')).toHaveTextContent(/beta is in pool pool-b/i);
    expect(screen.getByRole('dialog')).not.toHaveTextContent(/alpha is in pool pool-a/i);
    expect(screen.getByRole('button', { name: 'pool pool-b' })).toBeDisabled();
    await act(async () => {
      second.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-b' } });
      await second.promise;
    });
  });

  it('toasts the unknown-pool warning from a successful write', async () => {
    const first = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    const second = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockImplementation((project) =>
      project === 'alpha' ? first.promise : second.promise,
    );
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    act(() => {
      store.setState({ pools: {
        listed: true,
        byProject: {
          alpha: { state: 'untagged' },
          beta: { state: 'tagged', name: 'pool-a' },
        },
        enforcement: 'enforced',
      } });
    });
    const view = render(
      <>
        <ToastHost />
        <PoolSheet project="alpha" open onClose={vi.fn()} fleet={store} />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    // Preserve the original ToastHost subscription while only replacing the sheet.
    view.rerender(<ToastHost />);
    view.rerender(
      <>
        <ToastHost />
        <PoolSheet project="beta" open onClose={vi.fn()} fleet={store} />
      </>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));
    expect(screen.getByRole('button', { name: 'pool pool-b' })).toBeDisabled();

    await act(async () => {
      first.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-a' } });
      await first.promise;
    });

    expect(document.querySelector('.toast-host')?.textContent ?? '').not.toContain('alpha is in pool pool-a.');
    expect(screen.getByRole('dialog')).toHaveTextContent(/beta is in pool pool-a/i);
    expect(screen.getByRole('button', { name: 'pool pool-b' })).toBeDisabled();
    await act(async () => {
      second.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-b' } });
      await second.promise;
    });
  });

  it('does not toast a stale A refusal over an open saving B', async () => {
    const first = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    const second = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    vi.spyOn(api, 'setProjectPool').mockImplementation((project) =>
      project === 'alpha' ? first.promise : second.promise,
    );
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    act(() => {
      store.setState({ pools: {
        listed: true,
        byProject: {
          alpha: { state: 'untagged' },
          beta: { state: 'tagged', name: 'pool-b' },
        },
        enforcement: 'enforced',
      } });
    });
    const view = renderPoolSheet({ project: 'alpha', fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    view.rerender(<><ToastHost /><PoolSheet project="alpha" open={false} onClose={vi.fn()} fleet={store} /></>);
    view.rerender(<><ToastHost /><PoolSheet project="beta" open onClose={vi.fn()} fleet={store} /></>);
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));

    await act(async () => {
      first.reject(new ApiError(502, { ok: false, stderr: 'alpha refusal must stay on alpha' }));
      try {
        await first.promise;
      } catch {
        // The component handles this rejection; awaiting it only drains React's work.
      }
    });

    expect(screen.queryByText(/alpha refusal must stay on alpha/i)).not.toBeInTheDocument();
    expect(screen.getByText(/beta is in pool pool-b/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'pool pool-b' })).toBeDisabled();

    await act(async () => {
      second.resolve({ ok: true, pool: { state: 'tagged', name: 'pool-b' } });
      await second.promise;
    });
  });

  it('does not permit a newer same-sheet write while the first is saving', () => {
    // The disabled rows make same-subject ordering unreachable through this UI;
    // A/B replacement above exercises the reachable newer-request ordering.
    const first = deferred<{ ok: true; pool: { state: 'tagged'; name: string } }>();
    const set = vi.spyOn(api, 'setProjectPool').mockReturnValue(first.promise);
    const store = storeWith(pooled({ claude: 'pool-a', claude2: 'pool-b' }));
    renderPoolSheet({ fleet: store });

    fireEvent.click(screen.getByRole('button', { name: 'pool pool-a' }));
    fireEvent.click(screen.getByRole('button', { name: 'pool pool-b' }));

    expect(set).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith('demo', 'pool-a');
  });
});
