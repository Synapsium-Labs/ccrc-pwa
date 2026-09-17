// The fleet screen's class chooser (routing slice 5, Task 6): a `<select>`
// beside the fleet head that re-fetches `GET /api/projects?class=<cls>` and
// seeds the same class into the `+`'s `route` body. Verified seams: `api.projects(cls?)`
// already appends `?class=` (slice 4); `api.workspaceAdd` gains an optional
// second `route?: RouteFields` parameter this task adds; `ProjectCard` already
// renders `no lane can serve <class>` for a `{kind:'none', class}` placement
// (D-2854) — this suite asserts against those exact rendered words, not a
// paraphrase.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { TEST_ROSTER } from './rosterFixture';
import type { FleetSession } from '../../shared/api';

beforeEach(() => {
  window.localStorage.clear();
  resetAcks();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const MIN = 60_000;

const session = (over: Partial<FleetSession> = {}): FleetSession => ({
  id: 'claude:alpha',
  wrapper: 'claude',
  home: '/home/rc',
  project: 'alpha',
  workdir: '/home/rc/projects/alpha',
  workspace: null,
  name: null,
  status: 'idle',
  statusUpdatedAt: Date.now() - 2 * MIN,
  limits: { five: 10, seven: 40 },
  dialogPending: false, model: null, effort: null, ultracode: false, branch: null, ctxPct: null, tasks: null, pr: null, archivedAt: null, archivedBytes: null,
  hookState: null, askSummary: null, subagents: null, graphQueries: null, graphGateDenials: null, held: null, bucket: 'idle', bucketSince: null, unmeasured: [], statusUnmeasured: false,
  lifecycle: null, stoppedBy: null, swapBlocked: null, stranded: null, substrate: null, started: true, spawnState: null, ask: null, usage: null, route: null,
  version: '2.1.0',
  ...over,
});

/** Store whose ReconnectingSocket gets an inert fake — connect() is harmless. */
const makeStore = (): FleetStore =>
  createFleetStore({
    makeSocket: () =>
      ({
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        close(): void {},
      }) as unknown as WebSocket,
  });

const accountsRoute = (): Response =>
  new Response(JSON.stringify({ accounts: [], projected: null, roster: TEST_ROSTER }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });

const seed = (store: FleetStore, patch: Partial<ReturnType<FleetStore['getState']>>): void => {
  act(() => {
    store.setState(patch);
  });
};

describe('the fleet screen class chooser (routing slice 5, Task 6)', () => {
  it('choosing Fable re-fetches with ?class=fable and renders the none-with-class row', async () => {
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects?class=fable')) {
        return new Response(JSON.stringify({
          roots: [], projects: [{
            name: 'alpha', workdir: '/home/rc/projects/alpha',
            pool: { state: 'untagged' },
            placement: { kind: 'none', pool: null, class: 'fable' },
          }],
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });

    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects'))).toBe(true));

    const select = screen.getByLabelText('Class');
    fireEvent.change(select, { target: { value: 'fable' } });

    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects?class=fable'))).toBe(true));
    expect(await screen.findByRole('button', { name: /no lane can serve fable/ })).toBeInTheDocument();
  });

  it('tapping + while Fable is chosen posts route: { class: "fable" }', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue(undefined);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });

    const select = screen.getByLabelText('Class');
    fireEvent.change(select, { target: { value: 'fable' } });

    fireEvent.click(await screen.findByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith('alpha', { class: 'fable' });
  });

  it('the unset chooser posts no route and fetches without the query', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue(undefined);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects'))).toBe(true));

    // The chooser starts on "Coordinator row" (unset) — never touched here.
    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('');
    expect(urls.some((u) => u.includes('/api/projects?class='))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith('alpha');
  });

  it('choosing Default fetches with ?class=default and posts route: { class: "default" }', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue(undefined);
    const urls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      urls.push(String(url));
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects'))).toBe(true));

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'default' } });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects?class=default'))).toBe(true));

    fireEvent.click(await screen.findByRole('button', { name: /New workspace on alpha/i }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith('alpha', { class: 'default' });
  });

  it('offers the four classes in capability order, plus Coordinator row and Default', () => {
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session()] });

    const select = screen.getByLabelText('Class') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.value);
    expect(labels).toEqual(['', 'default', 'fable', 'opus', 'sonnet', 'haiku']);
  });

  it('renders outside the fleet head, on a row of its own', () => {
    // Where this control LIVES is a layout fact with a measured cause, not a
    // cosmetic one: `.fleet-head-right`'s four other items need 244px of
    // min-content and the group has 294px at 390px, while this select is
    // sized to its widest option, "Coordinator row", at 167px. While it sat
    // in the head the fleet screen overflowed the viewport by 225px at 390px
    // and 219px at 700px — measured in Chromium against this component's own
    // rendered markup. Nothing about its BEHAVIOUR is different out here,
    // which is why the rest of this suite is untouched; the assertions below
    // exist so a future tidy-up cannot quietly put it back.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    render(<FleetScreen store={store} />);
    seed(store, { conn: 'open', pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()] });

    const select = screen.getByLabelText('Class');
    expect(select.closest('.fleet-head'), 'the class chooser is back inside the fleet head')
      .toBeNull();
    expect(select.closest('.fleet-class-row'), 'the class chooser lost its own row')
      .not.toBeNull();
    // The head itself is still there and still carries the items that DO fit,
    // so this is not passing merely because the header stopped rendering.
    expect(document.querySelector('.fleet-head .fleet-head-right')).not.toBeNull();
  });
});
