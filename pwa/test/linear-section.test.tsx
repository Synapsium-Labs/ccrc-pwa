// Settings → Linear (#1444, spec §10.2; it began as named workspaces S4b's one-key section). The card is driven against
// a fake BOX (a fetch stub keyed by method and path), not against stubbed `api` methods, so the wire readers and the
// step-up hook run for real. Tests use `fireEvent`, not `userEvent` (the plan's rule for this feature).
//
// The one-key card's states (on `main` before this card) are the legacy row's cases here: each keeps its sentence, as
// the row's note, and the row keeps `main`'s Check again and Disconnect on the `/api/linear/connection` routes, with no
// Replace (spec §3.4).
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { LinearConnectionView, LinearLegacyRow, LinearWorkspaceView } from '../../shared/linear';
import { LinearSection, LINEAR_TEXT, LINEAR_TEAMS_SHOWN, workspaceControls, linearStateText } from '../src/screens/LinearSection';
import { useLinearWorkspaces } from '../src/fleet/useLinearWorkspaces';
import { renderSettings } from './settingsHost';
import { readLinearConnection, readLinearWorkspaces } from '../src/lib/api';

const LEAK = 'BOX-TEXT-THAT-MUST-NOT-REACH-THE-SCREEN';
const NOW = 1_800_000_000_000;
const ID_A = '00000000-0000-4000-8000-00000000000a';
const ID_B = '00000000-0000-4000-8000-00000000000b';

const reply = (status: number, body?: unknown): Response =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const CONNECTED: LinearConnectionView = { state: 'connected', outcome: 'ok', org: 'Workspace L', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 3 * 60_000 };
const NOT_CONNECTED: LinearConnectionView = { state: 'not-connected' };
const REJECTED: LinearConnectionView = { state: 'key-rejected', outcome: 'rejected', org: 'Workspace L', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 60_000 };
const FORBIDDEN: LinearConnectionView = { state: 'key-forbidden', outcome: 'forbidden', org: 'Workspace L', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 60_000 };
const UNREACHABLE: LinearConnectionView = { state: 'unreachable', outcome: 'unreachable', org: 'Workspace L', user: 'user-a', keyTail: '4f2c', checkedAt: NOW - 60_000 };

const TEAMS = [{ key: 'AAA', name: 'Team A' }, { key: 'BBB', name: 'Team B' }];
/** A slot's row, connected unless a view is given; its record's name, URL key and teams beside the view. */
const slot = (id: string, name: string | null, view: Exclude<LinearConnectionView, { state: 'not-connected' }> = { ...CONNECTED, org: name }): LinearWorkspaceView => {
  const base = { id, name, urlKey: name === null ? null : 'ws-a', teams: name === null ? [] : TEAMS };
  return ('keyTail' in view ? { ...base, ...view } : { ...base, user: null, keyTail: null, checkedAt: null, ...view }) as LinearWorkspaceView;
};
const WS_A = slot(ID_A, 'Workspace A');
const WS_B = slot(ID_B, 'Workspace B');
const LEARNED: LinearLegacyRow = { view: CONNECTED, workspace: { name: 'Workspace L', urlKey: 'ws-l', teams: [{ key: 'LLL', name: 'Team L' }] }, superseded: false };
const UNLEARNED: LinearLegacyRow = { view: CONNECTED, workspace: null, superseded: false };
const SUPERSEDED: LinearLegacyRow = { view: CONNECTED, workspace: { name: 'Workspace A', urlKey: 'ws-a', teams: TEAMS }, superseded: true };

interface ListBody { store?: 'ok' | 'unreadable'; workspaces?: unknown[]; legacy?: unknown; added?: string; replaced?: string }
const list = (b: ListBody = {}): Response => reply(200, { ok: true, store: 'ok', workspaces: [], legacy: null, ...b });
const conn = (connection: LinearConnectionView): Response => reply(200, { ok: true, connection });

interface Sent { method: string; path: string; body: unknown }
type Answer = () => Response | Promise<Response>;
interface Routes {
  list: Answer; add: Answer; check: Answer; remove: Answer;
  legacyGet: Answer; legacyCheck: Answer; legacyDel: Answer;
}
interface Box extends Routes { sent: Sent[]; paths: () => string[] }

let box: Box;
const install = (init: Partial<Routes> = {}): Box => {
  const b: Box = {
    sent: [],
    list: () => list(), add: () => list({ workspaces: [WS_A], added: ID_A }), check: () => list({ workspaces: [WS_A] }),
    remove: () => list(), legacyGet: () => conn(NOT_CONNECTED), legacyCheck: () => conn(CONNECTED), legacyDel: () => conn(NOT_CONNECTED),
    ...init,
    paths: () => b.sent.map((s) => `${s.method} ${s.path}`),
  };
  vi.stubGlobal('fetch', vi.fn(async (path: string, init?: RequestInit): Promise<Response> => {
    const method = init?.method ?? 'GET';
    let body: unknown = null;
    try { body = init?.body === undefined ? null : JSON.parse(String(init.body)); } catch { body = String(init?.body); }
    b.sent.push({ method, path, body });
    if (path === '/api/linear/workspaces' && method === 'GET') return b.list();
    if (path === '/api/linear/workspaces' && method === 'POST') return b.add();
    if (/^\/api\/linear\/workspaces\/[^/]+\/check$/.test(path) && method === 'POST') return b.check();
    if (/^\/api\/linear\/workspaces\/[^/]+$/.test(path) && method === 'DELETE') return b.remove();
    if (path === '/api/linear/connection' && method === 'GET') return b.legacyGet();
    if (path === '/api/linear/connection' && method === 'DELETE') return b.legacyDel();
    if (path === '/api/linear/connection/check' && method === 'POST') return b.legacyCheck();
    if (path === '/api/auth/step-up/start') {
      return reply(200, { challengeB64url: 'AQID', rpId: 'box.example.invalid', allowCredentialIdsB64url: [] });
    }
    if (path === '/api/auth/step-up/passphrase') return reply(200, { ok: true, stepUpFreshUntil: Date.now() + 300_000 });
    return reply(404, { ok: false, error: 'not-found' });
  }));
  box = b;
  return b;
};

beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(NOW); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

/** The card over the frame's read, as `SettingsDataProvider` hands it down. */
function Harness(): ReactNode {
  return <LinearSection poll={useLinearWorkspaces()} />;
}

const mount = async (): Promise<void> => {
  render(<Harness />);
  await waitFor(() => expect(document.querySelector('[data-linear="list"], [data-linear="empty"], [data-linear="unread"]')).not.toBeNull());
};
const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-linear="row"]')];
const slotRow = (name: string): HTMLElement => {
  const r = rows().find((x) => x.dataset.row === 'slot' && x.querySelector('[data-linear="name"]')?.textContent === name);
  if (r === undefined) throw new Error(`no slot row named ${name}`);
  return r;
};
const legacyRow = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-linear="row"][data-row="legacy"]');
const part = (row: HTMLElement, p: string): string => row.querySelector(`[data-linear="${p}"]`)?.textContent ?? '';
const buttonsOf = (row: HTMLElement): string[] => within(row).queryAllByRole('button').map((b) => b.textContent ?? '');
const chipsOf = (row: HTMLElement): string[] => [...row.querySelectorAll('[data-linear="teams"] .chip')].map((c) => c.textContent ?? '');
const status = (): string => screen.getByRole('status').textContent ?? '';

describe('the list, row by row (§10.2)', () => {
  it('shows a loading block until the box answers', () => {
    install({ list: () => new Response(new ReadableStream()) });
    render(<Harness />);
    expect(screen.getByRole('heading', { name: 'Linear' })).toBeTruthy();
    expect(rows()).toEqual([]);
  });

  it('no key at all: one sentence, and no row', async () => {
    install();
    await mount();
    expect(document.querySelector('[data-linear="empty"]')?.textContent).toBe(LINEAR_TEXT.empty);
    expect(rows()).toEqual([]);
  });

  it('connected: the name, who the key is, its tail and its age, the teams; Check again and Remove', async () => {
    install({ list: () => list({ workspaces: [WS_A] }) });
    await mount();
    const r = slotRow('Workspace A');
    expect(r.dataset.linearState).toBe('connected');
    expect(part(r, 'state')).toBe('Connected as user-a');
    expect(part(r, 'meta')).toBe('key ending …4f2c · checked 3m ago');
    expect(chipsOf(r)).toEqual(['AAA', 'BBB']);
    expect(buttonsOf(r)).toEqual(['Check again', 'Remove']);
  });

  it('every workspace is its own row, in the order the box sent them, each with its own controls', async () => {
    install({ list: () => list({ workspaces: [WS_A, WS_B] }) });
    await mount();
    expect(rows().map((r) => part(r, 'name'))).toEqual(['Workspace A', 'Workspace B']);
    for (const r of rows()) expect(buttonsOf(r)).toEqual(['Check again', 'Remove']);
  });

  it('key rejected names the workspace sessions cannot use, and offers no Check again', async () => {
    install({ list: () => list({ workspaces: [slot(ID_A, 'Workspace A', { ...REJECTED, org: 'Workspace A' })] }) });
    await mount();
    const r = slotRow('Workspace A');
    expect(part(r, 'state')).toBe("Linear rejected this key; sessions can't use Workspace A until it is replaced.");
    expect(buttonsOf(r)).not.toContain('Check again');
    expect(buttonsOf(r)).toContain('Remove');
  });

  it('key forbidden, unreachable: their own sentences; each offers Check again and Remove', async () => {
    for (const [view, sentence] of [[FORBIDDEN, 'Linear refused the last check; the key may lack access.'], [UNREACHABLE, "Couldn't reach Linear at the last check."]] as const) {
      install({ list: () => list({ workspaces: [slot(ID_A, 'Workspace A', view)] }) });
      await mount();
      const r = slotRow('Workspace A');
      expect(part(r, 'state'), view.state).toBe(sentence);
      expect(buttonsOf(r), view.state).toEqual(expect.arrayContaining(['Check again', 'Remove']));
      cleanup();
    }
  });

  it('a slot no check has named: its own name line, today\'s sentence for its state, and no key line', async () => {
    const cases: [LinearWorkspaceView, string][] = [
      [slot(ID_A, null, { state: 'details-unknown', why: 'absent' }), LINEAR_TEXT.detailsUnknown],
      [slot(ID_A, null, { state: 'unreadable' }), LINEAR_TEXT.unreadableKey],
      [slot(ID_A, null, { state: 'unusable' }), LINEAR_TEXT.unusableKey],
      [slot(ID_A, null, { state: 'placeholder' }), LINEAR_TEXT.placeholderKey],
    ];
    for (const [w, sentence] of cases) {
      install({ list: () => list({ workspaces: [w] }) });
      await mount();
      const r = slotRow(LINEAR_TEXT.unnamed);
      expect(part(r, 'state'), w.state).toBe(sentence);
      expect(r.querySelector('[data-linear="meta"]'), w.state).toBeNull();
      expect(r.querySelector('[data-linear="teams"]'), w.state).toBeNull();
      cleanup();
    }
  });

  it('the controls each state offers (§10.2): Check again where a look can tell, Replace key where the key is not working, Remove always', () => {
    const at = (view: Exclude<LinearConnectionView, { state: 'not-connected' }>) => workspaceControls(slot(ID_A, 'Workspace A', view));
    expect(at(CONNECTED)).toEqual({ check: true, replace: false, remove: true });
    expect(at(REJECTED)).toEqual({ check: false, replace: true, remove: true });
    expect(at(FORBIDDEN)).toEqual({ check: true, replace: true, remove: true });
    expect(at(UNREACHABLE)).toEqual({ check: true, replace: false, remove: true });
    expect(at({ state: 'details-unknown', why: 'stale' })).toEqual({ check: true, replace: false, remove: true });
    for (const state of ['unreadable', 'unusable', 'placeholder'] as const) {
      expect(at({ state }), state).toEqual({ check: false, replace: true, remove: true });
    }
  });

  it('teams past the phone band\'s first eight wait behind +N more, which shows them all', async () => {
    const teams = Array.from({ length: 40 }, (_, i) => ({ key: `T${String(i + 1).padStart(2, '0')}`, name: `Team ${i + 1}` }));
    install({ list: () => list({ workspaces: [{ ...WS_A, teams }] }) });
    await mount();
    const r = slotRow('Workspace A');
    expect(chipsOf(r)).toHaveLength(LINEAR_TEAMS_SHOWN.phone);
    const more = within(r).getByRole('button', { name: '+32 more' });
    expect(more.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(more);
    expect(chipsOf(r)).toHaveLength(40);
    expect(within(r).getByRole('button', { name: LINEAR_TEXT.fewer }).getAttribute('aria-expanded')).toBe('true');
  });

  it('a folder the box cannot list says so, and the legacy row still shows', async () => {
    install({ list: () => list({ store: 'unreadable', legacy: UNLEARNED }) });
    await mount();
    expect(document.querySelector('[data-linear="store"]')?.textContent).toBe(LINEAR_TEXT.storeUnreadable);
    expect(legacyRow()).not.toBeNull();
  });

  it('a read that fails, or answers a list this build cannot read, says so and offers nothing but Add a workspace', async () => {
    for (const answer of [
      () => reply(500, { ok: false, error: 'internal' }),
      () => list({ workspaces: [{ ...WS_A, state: 'from-the-future' }] }),
      () => list({ workspaces: [{ ...WS_A, id: 'not-a-uuid' }] }),
      () => list({ workspaces: [{ id: ID_A, name: null, urlKey: null, user: null, teams: [], keyTail: null, checkedAt: null, state: 'not-connected' }] }),
      () => list({ legacy: { view: { state: 'nope' }, workspace: null, superseded: false } }),
      () => reply(200, { ok: true, store: 'maybe', workspaces: [], legacy: null }),
      () => reply(200, 'nope'),
    ]) {
      install({ list: answer });
      await mount();
      expect(document.querySelector('[data-linear="unread"]')?.textContent).toBe(LINEAR_TEXT.unread);
      expect(screen.queryAllByRole('button').map((b) => b.textContent)).toEqual(['Add']);
      cleanup();
    }
  });

  it('is on the Security page, a level-3 card beside the box token, read once by the frame', async () => {
    install({ list: () => list({ workspaces: [WS_A] }) });
    renderSettings('security');
    expect(await screen.findByRole('heading', { level: 3, name: 'Linear' })).toBeTruthy();
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(box.paths().filter((p) => p === 'GET /api/linear/workspaces')).toHaveLength(1);
    // The legacy key is a row of that one list: the card does not read the old connection route too.
    expect(box.paths().filter((p) => p === 'GET /api/linear/connection')).toEqual([]);
  });

  it('is on no other page', async () => {
    install();
    for (const id of ['updates', 'appearance', 'notifications', 'automation'] as const) {
      renderSettings(id);
      expect(screen.queryByRole('heading', { name: 'Linear' }), id).toBeNull();
      cleanup();
    }
  });
});

describe('the legacy row (§3.4): the key saved before workspaces, on main\'s routes', () => {
  it('learned: its workspace\'s name, who the key is, that it is the older key, its tail and its teams', async () => {
    install({ list: () => list({ legacy: LEARNED }) });
    await mount();
    const r = legacyRow()!;
    expect(part(r, 'name')).toBe('Workspace L');
    expect(part(r, 'state')).toBe('Connected as user-a · a key saved before workspaces');
    expect(part(r, 'meta')).toBe('key ending …4f2c · checked 3m ago');
    expect(chipsOf(r)).toEqual(['LLL']);
    expect(buttonsOf(r)).toEqual(['Check again', 'Disconnect']);
  });

  it('not yet learned: asks for Check again so sessions can use it', async () => {
    install({ list: () => list({ legacy: UNLEARNED }) });
    await mount();
    const r = legacyRow()!;
    expect(part(r, 'name')).toBe(LINEAR_TEXT.legacyName);
    expect(part(r, 'state')).toBe(LINEAR_TEXT.legacyUnlearned);
    expect(buttonsOf(r)).toEqual(['Check again', 'Disconnect']);
  });

  it('superseded: names the workspace that now uses the newer key, and leaves Disconnect to the operator', async () => {
    install({ list: () => list({ workspaces: [WS_A], legacy: SUPERSEDED }) });
    await mount();
    const r = legacyRow()!;
    expect(part(r, 'state')).toBe('A key saved before workspaces. Workspace A now uses the newer key; Disconnect this one when you are ready.');
    expect(buttonsOf(r)).toEqual(['Check again', 'Disconnect']);
  });

  it('each of today\'s states keeps its own sentence as the row\'s note, and the row never offers Replace', async () => {
    const cases: [LinearConnectionView, string][] = [
      [REJECTED, LINEAR_TEXT.rejected],
      [FORBIDDEN, LINEAR_TEXT.forbidden],
      [UNREACHABLE, LINEAR_TEXT.unreachable],
      [{ state: 'details-unknown', why: 'absent' }, LINEAR_TEXT.detailsUnknown],
      [{ state: 'unreadable' }, LINEAR_TEXT.unreadableKey],
      [{ state: 'unusable' }, LINEAR_TEXT.unusableKey],
      [{ state: 'placeholder' }, LINEAR_TEXT.placeholderKey],
    ];
    const seen = new Set<string>();
    for (const [view, sentence] of cases) {
      install({ list: () => list({ legacy: { view, workspace: null, superseded: false } }) });
      await mount();
      const r = legacyRow()!;
      expect(part(r, 'note'), view.state).toBe(sentence);
      expect(seen.has(sentence), view.state).toBe(false);
      seen.add(sentence);
      expect(buttonsOf(r), view.state).toEqual(['Check again', 'Disconnect']);
      expect(screen.queryByRole('button', { name: 'Replace key' }), view.state).toBeNull();
      cleanup();
    }
    expect(LINEAR_TEXT.forbidden).not.toMatch(/revoked|expired/);
  });

  it('names a connected key by what it is when the box could not name the organisation or user', () => {
    const text = linearStateText({ ...CONNECTED, org: null, user: null }, NOW);
    expect(JSON.stringify(text)).toContain('Linear');
    expect(JSON.stringify(text)).toContain('this key');
  });

  it('Check again calls the connection\'s check route, shows what it answers, then reads the list again', async () => {
    let learned = false;
    install({
      list: () => list({ legacy: learned ? LEARNED : { ...UNLEARNED, view: UNREACHABLE } }),
      legacyCheck: () => { learned = true; return conn(CONNECTED); },
    });
    await mount();
    expect(part(legacyRow()!, 'note')).toBe(LINEAR_TEXT.unreachable);
    fireEvent.click(within(legacyRow()!).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(part(legacyRow()!, 'name')).toBe('Workspace L'));
    expect(box.paths()).toContain('POST /api/linear/connection/check');
    expect(box.paths().filter((p) => p.includes('/api/linear/workspaces') && !p.startsWith('GET'))).toEqual([]);
    expect(box.paths().filter((p) => p === 'GET /api/linear/workspaces')).toHaveLength(2);
    expect(legacyRow()!.querySelector('[data-linear="note"]')).toBeNull();
  });

  it('Check again that finds the key rejected shows the rejected sentence', async () => {
    // The box's list follows the check, as the server's does: the pair's view is read from its files each time.
    let view: LinearConnectionView = CONNECTED;
    install({ list: () => list({ legacy: { ...UNLEARNED, view } }), legacyCheck: () => { view = REJECTED; return conn(REJECTED); } });
    await mount();
    fireEvent.click(within(legacyRow()!).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(part(legacyRow()!, 'note')).toBe(LINEAR_TEXT.rejected));
  });

  it('a check with nothing stored takes the row away, as the 409 says', async () => {
    let gone = false;
    install({
      list: () => list({ legacy: gone ? null : UNLEARNED }),
      legacyCheck: () => { gone = true; return reply(409, { ok: false, error: 'not-connected', connection: NOT_CONNECTED }); },
    });
    await mount();
    fireEvent.click(within(legacyRow()!).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(legacyRow()).toBeNull());
  });

  it('Disconnect calls the connection\'s DELETE and the row goes', async () => {
    install({ list: () => list({ legacy: LEARNED }) });
    await mount();
    box.list = () => list();
    fireEvent.click(within(legacyRow()!).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(legacyRow()).toBeNull());
    expect(box.paths()).toContain('DELETE /api/linear/connection');
    expect(box.paths().filter((p) => p.startsWith('DELETE /api/linear/workspaces'))).toEqual([]);
    expect(status()).toBe(LINEAR_TEXT.disconnected);
  });

  it('a failed Disconnect says why and keeps the row', async () => {
    install({ list: () => list({ legacy: LEARNED }), legacyDel: () => reply(503, { ok: false, error: 'write-failed', message: LEAK }) });
    await mount();
    fireEvent.click(within(legacyRow()!).getByRole('button', { name: 'Disconnect' }));
    await waitFor(() => expect(status()).toContain("couldn't save"));
    expect(part(legacyRow()!, 'name')).toBe('Workspace L');
    expect(document.body.textContent).not.toContain(LEAK);
  });

  it('a Disconnect refused step-up-required shows "Confirm it\'s you", and the row is unchanged', async () => {
    install({ list: () => list({ legacy: LEARNED }), legacyDel: () => reply(403, { ok: false, error: 'step-up-required' }) });
    await mount();
    fireEvent.click(within(legacyRow()!).getByRole('button', { name: 'Disconnect' }));
    expect(await screen.findByText(/Changing the Linear key needs a fresh check/)).toBeTruthy();
    expect(part(legacyRow()!, 'name')).toBe('Workspace L');
  });
});

describe('a workspace\'s Check again and Remove', () => {
  it('Check again calls the slot\'s check route by its id and shows the list it answers', async () => {
    install({ list: () => list({ workspaces: [slot(ID_A, 'Workspace A', { ...UNREACHABLE, org: 'Workspace A' })] }) });
    await mount();
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(slotRow('Workspace A').dataset.linearState).toBe('connected'));
    expect(box.sent.filter((s) => s.method === 'POST')).toEqual([{ method: 'POST', path: `/api/linear/workspaces/${ID_A}/check`, body: null }]);
  });

  it('a check whose slot is gone shows the list its 409 carries', async () => {
    install({
      list: () => list({ workspaces: [WS_A, WS_B] }),
      check: () => reply(409, { ok: false, error: 'not-connected', store: 'ok', workspaces: [WS_B], legacy: null }),
    });
    await mount();
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(rows().map((r) => part(r, 'name'))).toEqual(['Workspace B']));
  });

  it('Remove calls the slot\'s DELETE by its id, and the row goes', async () => {
    install({ list: () => list({ workspaces: [WS_A, WS_B] }), remove: () => list({ workspaces: [WS_B] }) });
    await mount();
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(rows().map((r) => part(r, 'name'))).toEqual(['Workspace B']));
    expect(box.paths()).toContain(`DELETE /api/linear/workspaces/${ID_A}`);
    expect(box.paths()).not.toContain('DELETE /api/linear/connection');
    expect(status()).toBe(LINEAR_TEXT.removed);
  });

  it('each refusal is a fixed sentence chosen by its word, and the box\'s own text never reaches the screen', async () => {
    const cases: [number, string, string][] = [
      [503, 'write-failed', "couldn't save"],
      [503, 'journal-unavailable', "couldn't record this change"],
      [503, 'linear-unavailable', "can't change Linear keys right now"],
      [429, 'rate-limited', 'Linear is busy'],
      [501, 'auth-off', 'Sign-in is off'],
      [403, 'insecure-origin', 'not served over HTTPS'],
    ];
    for (const [code, word, sentence] of cases) {
      install({ list: () => list({ workspaces: [WS_A] }), remove: () => reply(code, { ok: false, error: word, message: LEAK, stderr: LEAK }) });
      await mount();
      fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Remove' }));
      await waitFor(() => expect(status(), word).toContain(sentence));
      expect(document.body.textContent).not.toContain(LEAK);
      expect(rows()).toHaveLength(1);
      cleanup();
    }
  });

  it('a 2xx whose body cannot be read is re-read, because the write may have landed', async () => {
    let reads = 0;
    install({ list: () => (reads++ === 0 ? list({ workspaces: [WS_A] }) : list()), remove: () => reply(200, 'garbled') });
    await mount();
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(rows()).toEqual([]));
    expect(box.paths().filter((p) => p === 'GET /api/linear/workspaces')).toHaveLength(2);
  });

  it('a Remove refused step-up-required shows the step, does not retry by itself, and goes through when pressed again', async () => {
    let refused = true;
    install({ list: () => list({ workspaces: [WS_A] }), remove: () => (refused ? reply(403, { ok: false, error: 'step-up-required' }) : list()) });
    await mount();
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText(/Changing the Linear key needs a fresh check/)).toBeTruthy();
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a test passphrase' } });
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(screen.queryByText(/needs a fresh check/)).toBeNull());
    expect(box.sent.filter((s) => s.method === 'DELETE')).toHaveLength(1);
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(rows()).toEqual([]));
    expect(box.sent.filter((s) => s.method === 'DELETE')).toHaveLength(2);
  });

  it('asks for no step-up until an act is refused, and a check refused for another reason shows none', async () => {
    install({ list: () => list({ workspaces: [WS_A] }), check: () => reply(503, { ok: false, error: 'write-failed' }) });
    await mount();
    expect(box.paths().some((p) => p.includes('step-up'))).toBe(false);
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(status()).toContain("couldn't save"));
    expect(screen.queryByText(/needs a fresh check/)).toBeNull();
  });
});

const KEY = 'lin_api_fixture_key_one_0001';
const field = (): HTMLInputElement => screen.getByLabelText(LINEAR_TEXT.keyLabel);
const type = (v: string): void => { fireEvent.change(field(), { target: { value: v } }); };
const addButton = (): HTMLButtonElement => within(document.querySelector<HTMLElement>('[data-linear="add"]')!).getByRole('button', { name: 'Add' }) as HTMLButtonElement;
const hidePage = (): void => {
  const real = Object.getOwnPropertyDescriptor(Document.prototype, 'visibilityState');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
  try {
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
  } finally {
    delete (document as unknown as Record<string, unknown>)['visibilityState'];
    if (real) Object.defineProperty(Document.prototype, 'visibilityState', real);
  }
};
const EXISTS = (): Response => reply(409, { ok: false, error: 'workspace-exists', workspace: { id: ID_A, name: 'Workspace A', urlKey: 'ws-a' } });

describe('Add a workspace (§10.1, §10.2): the one key field', () => {
  it('is at the card\'s foot whatever the list says: a password field that does not autocomplete, its read-only note, and Add waiting for a key', async () => {
    for (const answer of [() => list(), () => list({ workspaces: [WS_A], legacy: LEARNED }), () => reply(500, { ok: false, error: 'internal' })]) {
      install({ list: answer });
      await mount();
      expect(field().type).toBe('password');
      expect(field().getAttribute('autocomplete')).toBe('off');
      expect(document.getElementById(field().getAttribute('aria-describedby') ?? '')?.textContent).toBe('A read-only key lets sessions read but not write.');
      expect(addButton().disabled).toBe(true);
      type('   ');
      expect(addButton().disabled).toBe(true);
      type(KEY);
      expect(addButton().disabled).toBe(false);
      cleanup();
    }
  });

  it('sends the trimmed key once, shows the list the box answers, says what it added, and clears the field', async () => {
    install();
    await mount();
    type(`  ${KEY}\n`);
    fireEvent.click(addButton());
    await waitFor(() => expect(rows().map((r) => part(r, 'name'))).toEqual(['Workspace A']));
    expect(box.sent.filter((s) => s.method === 'POST')).toEqual([{ method: 'POST', path: '/api/linear/workspaces', body: { key: KEY } }]);
    expect(status()).toBe('Added Workspace A.');
    expect(field().value).toBe('');
  });

  it('says a key that fails the shape rule is not one, without a request', async () => {
    install();
    await mount();
    type('not a key');
    fireEvent.click(addButton());
    await waitFor(() => expect(status()).toContain("doesn't look like a Linear API key"));
    expect(box.paths().filter((p) => p.startsWith('POST'))).toEqual([]);
  });

  it('each refusal is a fixed sentence chosen by its word; nothing changes and the field keeps what was typed', async () => {
    const cases: [number, string, string][] = [
      [400, 'key-rejected', 'Linear rejected that key'],
      [400, 'key-forbidden', 'Linear refused that key access'],
      [400, 'bad-key', "doesn't look like a Linear API key"],
      [503, 'unreachable', "Couldn't reach Linear"],
      [503, 'timeout', 'took too long'],
      [503, 'malformed', 'not what was expected'],
      [503, 'write-failed', "couldn't save"],
      [503, 'journal-unavailable', "couldn't record this change"],
      [503, 'linear-unavailable', "can't change Linear keys right now"],
      [429, 'rate-limited', 'Linear is busy'],
      [501, 'auth-off', 'Sign-in is off'],
      [403, 'insecure-origin', 'not served over HTTPS'],
    ];
    for (const [code, word, sentence] of cases) {
      install({ add: () => reply(code, { ok: false, error: word, message: LEAK, stderr: LEAK }) });
      await mount();
      type(KEY);
      fireEvent.click(addButton());
      await waitFor(() => expect(status(), word).toContain(sentence));
      expect(document.body.textContent).not.toContain(LEAK);
      expect(rows()).toEqual([]);
      expect(field().value, word).toBe(KEY);
      expect(screen.queryByRole('dialog'), word).toBeNull();
      cleanup();
    }
  });

  it('a workspace that already has a key asks to replace it by name, and Replace key sends the same key with replace', async () => {
    install({ list: () => list({ workspaces: [WS_A] }), add: EXISTS });
    await mount();
    type(KEY);
    fireEvent.click(addButton());
    const dialog = await screen.findByRole('dialog', { name: 'Replace the key for Workspace A?' });
    // The key waits in the field while the operator answers.
    expect(field().value).toBe(KEY);
    box.add = () => list({ workspaces: [{ ...WS_A, keyTail: '9e1d' }], replaced: ID_A });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Replace key' }));
    await waitFor(() => expect(part(slotRow('Workspace A'), 'meta')).toContain('…9e1d'));
    expect(box.sent.filter((s) => s.method === 'POST').map((s) => s.body)).toEqual([{ key: KEY }, { key: KEY, replace: true }]);
    expect(status()).toBe('Replaced the key for Workspace A.');
    expect(field().value).toBe('');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Cancel on the replace confirm sends nothing more and keeps the typed key', async () => {
    install({ list: () => list({ workspaces: [WS_A] }), add: EXISTS });
    await mount();
    type(KEY);
    fireEvent.click(addButton());
    const dialog = await screen.findByRole('dialog', { name: 'Replace the key for Workspace A?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(box.sent.filter((s) => s.method === 'POST')).toHaveLength(1);
    expect(field().value).toBe(KEY);
  });

  it('a replace refused for another reason says why and never asks again by itself', async () => {
    let n = 0;
    install({ list: () => list({ workspaces: [WS_A] }), add: () => (n++ === 0 ? EXISTS() : reply(400, { ok: false, error: 'key-rejected' })) });
    await mount();
    type(KEY);
    fireEvent.click(addButton());
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Replace key' }));
    await waitFor(() => expect(status()).toContain('Linear rejected that key'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(field().value).toBe(KEY);
  });

  it('an Add refused step-up-required shows "Confirm it\'s you", keeps the typed key, and does not retry by itself', async () => {
    let refused = true;
    install({ add: () => (refused ? reply(403, { ok: false, error: 'step-up-required' }) : list({ workspaces: [WS_A], added: ID_A })) });
    await mount();
    type(KEY);
    fireEvent.click(addButton());
    expect(await screen.findByText(/Changing the Linear key needs a fresh check/)).toBeTruthy();
    expect(field().value).toBe(KEY);
    expect(box.sent.filter((s) => s.method === 'POST' && s.path === '/api/linear/workspaces')).toHaveLength(1);
    fireEvent.change(await screen.findByLabelText('Passphrase'), { target: { value: 'a test passphrase' } });
    refused = false;
    fireEvent.click(screen.getByRole('button', { name: 'Confirm with passphrase' }));
    await waitFor(() => expect(screen.queryByText(/needs a fresh check/)).toBeNull());
    expect(box.sent.filter((s) => s.method === 'POST' && s.path === '/api/linear/workspaces')).toHaveLength(1);
    fireEvent.click(addButton());
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(field().value).toBe('');
  });

  it('a 2xx whose body cannot be read is re-read, because the write may have landed', async () => {
    let reads = 0;
    install({ list: () => (reads++ === 0 ? list() : list({ workspaces: [WS_A] })), add: () => reply(200, 'garbled') });
    await mount();
    type(KEY);
    fireEvent.click(addButton());
    await waitFor(() => expect(rows()).toHaveLength(1));
    expect(box.paths().filter((p) => p === 'GET /api/linear/workspaces')).toHaveLength(2);
    expect(field().value).toBe('');
  });

  it('clears a typed key when the page goes to the background, and closes a replace confirm waiting on it', async () => {
    install({ list: () => list({ workspaces: [WS_A] }), add: EXISTS });
    await mount();
    type(KEY);
    fireEvent.click(addButton());
    await screen.findByRole('dialog');
    hidePage();
    expect(field().value).toBe('');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(box.sent.filter((s) => s.method === 'POST')).toHaveLength(1);
  });

  it('a row\'s Replace key takes the operator to the one key field and says what to paste there', async () => {
    install({ list: () => list({ workspaces: [slot(ID_A, 'Workspace A', { ...REJECTED, org: 'Workspace A' })] }) });
    await mount();
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Replace key' }));
    expect(document.activeElement).toBe(field());
    expect(status()).toBe('Paste the new key for Workspace A below and press Add.');
    expect(box.paths().filter((p) => !p.startsWith('GET'))).toEqual([]);
  });

  it('Replace key is offered where the key is not working, and never on the legacy row', async () => {
    install({ list: () => list({
      workspaces: [slot(ID_A, 'Workspace A', { ...REJECTED, org: 'Workspace A' }), slot(ID_B, 'Workspace B', { ...FORBIDDEN, org: 'Workspace B' })],
      legacy: { ...UNLEARNED, view: REJECTED },
    }) });
    await mount();
    expect(buttonsOf(slotRow('Workspace A'))).toEqual(['Replace key', 'Remove']);
    expect(buttonsOf(slotRow('Workspace B'))).toEqual(['Check again', 'Replace key', 'Remove']);
    expect(buttonsOf(legacyRow()!)).toEqual(['Check again', 'Disconnect']);
  });
});

describe('reads and writes racing', () => {
  it('a read issued before an Add\'s answer cannot put the old list back', async () => {
    let releaseRead: (r: Response) => void = () => undefined;
    let first = true;
    install({
      list: () => {
        if (first) { first = false; return list(); }
        return new Promise<Response>((res) => { releaseRead = res; });
      },
    });
    await mount();
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(box.paths().filter((p) => p === 'GET /api/linear/workspaces')).toHaveLength(2));
    type(KEY);
    fireEvent.click(addButton());
    await waitFor(() => expect(rows()).toHaveLength(1));
    await act(async () => { releaseRead(list()); await Promise.resolve(); });
    expect(rows()).toHaveLength(1);
  });

  it('a read issued before a write\'s answer cannot put the old list back', async () => {
    let releaseRead: (r: Response) => void = () => undefined;
    let first = true;
    install({
      list: () => {
        if (first) { first = false; return list({ workspaces: [WS_A, WS_B] }); }
        return new Promise<Response>((res) => { releaseRead = res; });
      },
      remove: () => list({ workspaces: [WS_B] }),
    });
    await mount();
    // The page comes back to the front: a read starts and is held.
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(box.paths().filter((p) => p === 'GET /api/linear/workspaces')).toHaveLength(2));
    fireEvent.click(within(slotRow('Workspace A')).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(rows()).toHaveLength(1));
    // The held read now answers with what it saw BEFORE the write.
    await act(async () => { releaseRead(list({ workspaces: [WS_A, WS_B] })); await Promise.resolve(); });
    expect(rows().map((r) => part(r, 'name'))).toEqual(['Workspace B']);
  });

  it('a page returning to the front re-reads, so a rejection marked meanwhile shows', async () => {
    let w = WS_A;
    install({ list: () => list({ workspaces: [w] }) });
    await mount();
    expect(slotRow('Workspace A').dataset.linearState).toBe('connected');
    w = slot(ID_A, 'Workspace A', { ...REJECTED, org: 'Workspace A' });
    act(() => { document.dispatchEvent(new Event('visibilitychange')); });
    await waitFor(() => expect(slotRow('Workspace A').dataset.linearState).toBe('key-rejected'));
  });
});

describe('readLinearWorkspaces', () => {
  it('reads every row state the server sends, the legacy row\'s three shapes, and the added and replaced ids', () => {
    const states: Exclude<LinearConnectionView, { state: 'not-connected' }>[] = [CONNECTED, REJECTED, FORBIDDEN, UNREACHABLE,
      { state: 'unreadable' }, { state: 'unusable' }, { state: 'placeholder' }, { state: 'details-unknown', why: 'stale' }];
    const workspaces = states.map((v, i) => slot(`00000000-0000-4000-8000-00000000000${i}`, i % 2 === 0 ? 'Workspace A' : null, v));
    for (const legacy of [null, LEARNED, UNLEARNED, SUPERSEDED]) {
      expect(readLinearWorkspaces({ ok: true, store: 'ok', workspaces, legacy })).toEqual({ store: 'ok', workspaces, legacy });
    }
    expect(readLinearWorkspaces({ store: 'unreadable', workspaces: [], legacy: null, added: ID_A })).toEqual({ store: 'unreadable', workspaces: [], legacy: null, added: ID_A });
    expect(readLinearWorkspaces({ store: 'ok', workspaces: [], legacy: null, replaced: ID_B })).toEqual({ store: 'ok', workspaces: [], legacy: null, replaced: ID_B });
  });

  it('refuses what it cannot vouch for', () => {
    const one = (w: unknown, legacy: unknown = null): unknown => readLinearWorkspaces({ store: 'ok', workspaces: [w], legacy });
    for (const bad of [
      { ...WS_A, id: 'x' }, { ...WS_A, name: 5 }, { ...WS_A, name: '' }, { ...WS_A, name: 'a\u0007b' }, { ...WS_A, urlKey: 'WS A' },
      { ...WS_A, teams: 'AAA' }, { ...WS_A, teams: [{ key: 'aaa!', name: 'Team' }] }, { ...WS_A, teams: [{ key: 'AAA' }] },
      { ...WS_A, state: 'not-connected' }, { ...WS_A, outcome: 'rejected' }, { ...WS_A, keyTail: 4 },
    ]) {
      expect(one(bad), JSON.stringify(bad)).toBeNull();
    }
    for (const legacy of [{ view: CONNECTED, workspace: null }, { view: { state: 'x' }, workspace: null, superseded: false },
      { view: CONNECTED, workspace: { name: 'Workspace L', urlKey: 'ws-l' }, superseded: false }, 'legacy']) {
      expect(readLinearWorkspaces({ store: 'ok', workspaces: [], legacy }), JSON.stringify(legacy)).toBeNull();
    }
    for (const top of [null, 'x', [], {}, { store: 'ok', workspaces: {}, legacy: null }, { store: 'ok', workspaces: [] }]) {
      expect(readLinearWorkspaces(top), JSON.stringify(top)).toBeNull();
    }
  });

  it('keeps nothing it was not asked to: no key, no digest, no team id, no field a newer server adds', () => {
    const read = readLinearWorkspaces({
      store: 'ok', legacy: null, added: 'not-a-uuid', extra: 1,
      workspaces: [{ ...WS_A, key: 'lin_api_fixture_key_one_0001', keyDigest: 'a'.repeat(64), extra: 1, teams: [{ id: ID_B, key: 'AAA', name: 'Team A' }] }],
    });
    expect(read).toEqual({ store: 'ok', legacy: null, workspaces: [{ ...WS_A, teams: [{ key: 'AAA', name: 'Team A' }] }] });
  });
});

describe('readLinearConnection (the legacy row\'s view)', () => {
  it('reads every state the server sends', () => {
    for (const v of [NOT_CONNECTED, CONNECTED, REJECTED, FORBIDDEN, UNREACHABLE, { state: 'unreadable' }, { state: 'unusable' }, { state: 'placeholder' },
      { state: 'details-unknown', why: 'stale' }] as LinearConnectionView[]) {
      expect(readLinearConnection(v), v.state).toEqual(v);
    }
  });

  it('refuses what it cannot vouch for, and keeps nothing it was not asked to', () => {
    for (const bad of [null, 'x', [], {}, { state: 'nope' }, { state: 'details-unknown', why: 'because' },
      { ...CONNECTED, outcome: 'rejected' }, { ...CONNECTED, keyTail: 4 }, { ...CONNECTED, checkedAt: 'now' }, { ...CONNECTED, org: 5 },
      { ...REJECTED, outcome: 'ok' }, { ...FORBIDDEN, outcome: 'rejected' }]) {
      expect(readLinearConnection(bad), JSON.stringify(bad)).toBeNull();
    }
    expect(readLinearConnection({ ...CONNECTED, key: 'lin_api_fixture_key_one_0001', extra: 1 })).toEqual(CONNECTED);
  });
});
