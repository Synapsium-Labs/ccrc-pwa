// The `+` door end to end (named workspaces S7): the card, the chrome, the sheet, `useProjectRows`, `api`, and the
// real request on the wire. This is where "an empty field is today's request byte for byte" is proved, because it
// reads the `fetch` call itself rather than a spy on `api`.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { createFleetStore, type FleetStore } from '../src/stores/fleet';
import { resetAcks } from '../src/lib/seen';
import { FleetScreen } from '../src/screens/FleetScreen';
import { NAME_FIELD_TEXT } from '../src/fleet/WorkspaceNameField';
import { renderFleet } from './fleetHost';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

beforeEach(() => { window.localStorage.clear(); resetAcks(); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const makeStore = (): FleetStore => createFleetStore({
  makeSocket: () => ({ onopen: null, onmessage: null, onclose: null, onerror: null, close(): void {} }) as unknown as WebSocket,
});

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

interface Sent { url: string; init: RequestInit }

/** A fetch that answers the reads the screen makes and records every workspace create; `create` is what that answers. */
const stub = (create: () => Response): Sent[] => {
  const creates: Sent[] = [];
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes('/workspaces')) { creates.push({ url: u, init: init ?? {} }); return create(); }
    if (u.includes('/api/accounts')) return json(200, { accounts: [], projected: null, roster: TEST_ROSTER });
    if (u.includes('/api/projects')) return json(200, { roots: [], projects: [] });
    if (u.includes('/api/linear/resolve')) return json(200, { kind: 'named', slug: 'x', title: 'ENG-1234 - Fix the login flow', source: 'linear' });
    return json(200, {});
  }));
  return creates;
};

const open = (): FleetStore => {
  const store = makeStore();
  renderFleet(<FleetScreen store={store} />);
  act(() => {
    store.setState({
      conn: 'open', pools: { listed: true, byProject: {}, enforcement: 'enforced' },
      sessions: [fleetSession({ id: 'claude:alpha', project: 'alpha', workdir: '/w/alpha', home: '/h', version: '2.1.0' })],
    });
  });
  return store;
};

const tapPlus = (): void => { fireEvent.click(screen.getByRole('button', { name: /New workspace on alpha/i })); };
const field = async (): Promise<HTMLInputElement> => await screen.findByLabelText(NAME_FIELD_TEXT.label) as HTMLInputElement;

describe('tapping + on a project card', () => {
  it('opens the sheet and creates nothing', async () => {
    const creates = stub(() => json(200, { ok: true }));
    open();
    tapPlus();
    expect(await screen.findByText('Add a workspace to alpha')).toBeInTheDocument();
    expect(creates).toEqual([]);
  });

  it('an empty field then Add is today\'s request, byte for byte: no body, no content-type', async () => {
    const creates = stub(() => json(200, { ok: true }));
    open();
    tapPlus();
    fireEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(creates).toHaveLength(1));
    const [sent] = creates;
    expect(sent?.url).toBe('/api/projects/alpha/workspaces');
    expect(sent?.init.method).toBe('POST');
    expect('body' in (sent?.init ?? {})).toBe(false);
    expect(new Headers(sent?.init.headers).get('content-type')).toBeNull();
  });

  it('a chosen class rides the empty create exactly as before', async () => {
    const creates = stub(() => json(200, { ok: true }));
    open();
    fireEvent.change(screen.getByLabelText('Class'), { target: { value: 'fable' } });
    tapPlus();
    fireEvent.click(await screen.findByRole('button', { name: 'Add workspace' }));
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(JSON.parse(creates[0]?.init.body as string)).toEqual({ route: { class: 'fable' } });
  });

  it('a name rides the body, and the sheet closes on the box\'s answer', async () => {
    const creates = stub(() => json(200, { ok: true, id: 'alpha-eng-1234', slug: 'eng-1234', title: 'ENG-1234 - Fix the login flow' }));
    open();
    tapPlus();
    fireEvent.change(await field(), { target: { value: 'ENG-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add ENG-1234' }));
    await waitFor(() => expect(creates).toHaveLength(1));
    expect(JSON.parse(creates[0]?.init.body as string)).toEqual({ name: 'ENG-1234' });
    await waitFor(() => expect(screen.queryByText('Add a workspace to alpha')).not.toBeInTheDocument());
  });

  it('a 409 slug-taken from the real route keeps the sheet open with the text intact', async () => {
    stub(() => json(409, { ok: false, error: 'slug-taken' }));
    open();
    tapPlus();
    fireEvent.change(await field(), { target: { value: 'ENG-1234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add ENG-1234' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('alpha-eng-1234 already exists');
    expect((await field()).value).toBe('ENG-1234');
    expect(screen.getByText('Add a workspace to alpha')).toBeInTheDocument();
  });
});
