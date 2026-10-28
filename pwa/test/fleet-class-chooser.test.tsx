// The fleet screen's class chooser (routing slice 5, Task 6): a `<select>`
// beside the fleet head that re-fetches `GET /api/projects?class=<cls>` and
// seeds the same class into the `+`'s `route` body. Verified seams: `api.projects(cls?)`
// already appends `?class=` (slice 4); `api.workspaceAdd` takes an options object
// whose `route` this task adds (named workspaces S7 widened it with `name` and `wrapper`); `ProjectCard` already
// renders `no lane can serve <class>` for a `{kind:'none', class}` placement
// (D-2854) — this suite asserts against those exact rendered words, not a
// paraphrase.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { api } from '../src/lib/api';
import { resetAcks } from '../src/lib/seen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { renderFleet } from './fleetHost';
import { TEST_ROSTER } from './rosterFixture';
import type { FleetSession } from '../../shared/api';
import { fleetSession } from './fleetFixture';

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

const session = (over: Partial<FleetSession> = {}): FleetSession => (fleetSession({ id: 'claude:alpha', home: '/home/u', project: 'alpha', workdir: '/home/u/projects/alpha', statusUpdatedAt: Date.now() - 2 * MIN, limits: { five: 10, seven: 40 }, version: '2.1.0', ...over }));

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
            name: 'alpha', workdir: '/home/u/projects/alpha',
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
    renderFleet(<FleetScreen store={store} />);
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
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    renderFleet(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });

    const select = screen.getByLabelText('Class');
    fireEvent.change(select, { target: { value: 'fable' } });

    fireEvent.click(await screen.findByRole('button', { name: /New workspace on alpha/i }));
    // The tap opens the sheet; the sheet's own confirm is what creates (named workspaces S7).
    expect(add).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith('alpha', { route: { class: 'fable' } });
  });

  it('the unset chooser posts no route and fetches without the query', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
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
    renderFleet(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects'))).toBe(true));

    // The chooser starts on "Automatic" (unset) — never touched here.
    expect((screen.getByLabelText('Class') as HTMLSelectElement).value).toBe('');
    expect(urls.some((u) => u.includes('/api/projects?class='))).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    // No route and no name: the options object is empty, and `api.workspaceAdd` sends no body for it.
    expect(add).toHaveBeenCalledWith('alpha', {});
  });

  it('choosing Default fetches with ?class=default and posts route: { class: "default" }', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
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
    renderFleet(<FleetScreen store={store} />);
    seed(store, {
      conn: 'open',
      pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()],
    });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects'))).toBe(true));

    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'default' } });
    await waitFor(() => expect(urls.some((u) => u.includes('/api/projects?class=default'))).toBe(true));

    fireEvent.click(await screen.findByRole('button', { name: /New workspace on alpha/i }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(add).toHaveBeenCalledTimes(1));
    expect(add).toHaveBeenCalledWith('alpha', { route: { class: 'default' } });
  });

  it('offers the four classes in capability order, plus Automatic and Default', () => {
    const store = makeStore();
    renderFleet(<FleetScreen store={store} />);
    seed(store, { conn: 'open', sessions: [session()] });

    const select = screen.getByLabelText('Class') as HTMLSelectElement;
    const labels = Array.from(select.options).map((o) => o.value);
    expect(labels).toEqual(['', 'default', 'fable', 'opus', 'sonnet', 'haiku']);
    // The unset option's word and its title (T3a, D-6331): "Coordinator row" is the registry's name for it.
    expect(select.options[0]).toHaveTextContent('Automatic');
    expect(select.options[0]).toHaveAttribute('title', 'The routing matrix picks the class');
    expect(Array.from(select.options).map((o) => o.textContent)).not.toContain('Coordinator row');
  });

  it('renders outside the fleet head, on the runs line', () => {
    // Where this control LIVES is a layout fact with a measured cause, not a
    // cosmetic one: `.fleet-head-right`'s four other items need 244px of
    // min-content and the group has 294px at 390px, while this select is
    // sized to its widest option, then "Coordinator row" (now "Automatic"), at 167px. While it sat
    // in the head the fleet screen overflowed the viewport by 225px at 390px
    // and 219px at 700px — measured in Chromium against this component's own
    // rendered markup. Nothing about its BEHAVIOUR is different out here,
    // which is why the rest of this suite is untouched; the assertions below
    // exist so a future tidy-up cannot quietly put it back. It shares the
    // runs line rather than holding a band of its own, which read as an
    // orphan; the runs door is the partner because it always renders, while
    // HotFilesStrip renders nothing with no live claim.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url).includes('/api/accounts')) return accountsRoute();
      if (String(url).includes('/api/projects')) {
        return new Response(JSON.stringify({ roots: [], projects: [] }),
          { status: 200, headers: { 'content-type': 'application/json' } });
      }
      return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
    }));
    const store = makeStore();
    renderFleet(<FleetScreen store={store} />);
    seed(store, { conn: 'open', pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [session()] });

    const select = screen.getByLabelText('Class');
    expect(select.closest('.fleet-head'), 'the class chooser is back inside the fleet head')
      .toBeNull();
    const line = select.closest('.fleet-runs-line');
    expect(line, 'the class chooser left the runs line').not.toBeNull();
    // The partner is there too — a line holding only the chooser is the
    // orphan row this replaced.
    expect(line!.querySelector('.fleet-runs-row'),
      'the runs door left the line, so the chooser is orphaned again').not.toBeNull();
    // The head itself is still there and still carries the items that DO fit,
    // so this is not passing merely because the header stopped rendering.
    expect(document.querySelector('.fleet-head .fleet-head-right')).not.toBeNull();
  });
});

describe('the class chooser is one component (T2f, D-6371)', () => {
  const src = path.join(import.meta.dirname, '..', 'src');
  const read = (...p: string[]): string => readFileSync(path.join(src, ...p), 'utf8');

  /** Every .ts/.tsx under src, as paths relative to it with `/` separators. */
  const sources = (dir = ''): string[] =>
    readdirSync(path.join(src, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = dir === '' ? e.name : `${dir}/${e.name}`;
      if (e.isDirectory()) return sources(rel);
      return /\.tsx?$/.test(e.name) ? [rel] : [];
    });

  it('the chooser is one component: FleetScreen and FleetTable import ClassChooser and declare no class select of their own', () => {
    const chooser = read('fleet', 'ClassChooser.tsx');
    // Non-vacuity: the component holds the one select, so the absences below are read against a file that has it.
    expect(chooser.split('aria-label="Class"').length - 1, 'ClassChooser.tsx holds the class select once').toBe(1);

    const homes: readonly [string, string, string][] = [
      ['screens/FleetScreen.tsx', read('screens', 'FleetScreen.tsx'), "from '../fleet/ClassChooser'"],
      ['skins/instrument/FleetTable.tsx', read('skins', 'instrument', 'FleetTable.tsx'), "from '../../fleet/ClassChooser'"],
    ];
    for (const [name, text, importLine] of homes) {
      expect(text, `${name} imports ClassChooser`).toContain(importLine);
      expect(text, `${name} renders ClassChooser`).toContain('<ClassChooser');
      expect(text, `${name} declares a class select of its own`).not.toContain('aria-label="Class"');
      expect(text, `${name} reads chooseClass itself`).not.toContain('chooseClass');
      expect(text, `${name} reads classFilter itself`).not.toContain('classFilter');
    }

    // The one caller of `chooseClass(` in the tree is the component; its definition is `useProjectRows`'s own.
    const callers = sources().filter((f) => read(...f.split('/')).includes('chooseClass(')).sort();
    expect(callers).toEqual(['fleet/ClassChooser.tsx']);
  });

  it("the toggle's radiogroup grows to the row's width beside the chooser (T2f, D-6371)", () => {
    const table = read('skins', 'instrument', 'FleetTable.tsx');
    // A source pin: the width itself is measured in a real browser, jsdom has no layout.
    const group = table.match(/<div\s+role="radiogroup"[^>]*?className="([^"]*)"/);
    expect(group, 'the toggle radiogroup is not where this read looks').not.toBeNull();
    const classes = group![1]!.split(/\s+/);
    expect(classes, 'the radiogroup lost its class').toContain('ins-toggle');
    expect(classes, 'the radiogroup no longer grows into the row').toContain('flex-1');
    expect(classes, 'the radiogroup may not shrink below its content').toContain('min-w-0');
  });
});
