// Rename on the session's actions sheet (named workspaces S9, design 2026-10-20 §6). A workspace's TITLE, never its slug:
// offered on every workspace row (auto-named and archived ones included) and never on a main checkout, whose name is its
// project. The PWA cannot see `ccd caps`, so a box without the verb answers 501 inside the Rename sheet.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToastHost } from '@ccrc/ui';
import type { FleetSession } from '../../shared/api';
import { SessionActionsSheet } from '../src/fleet/SessionActionsSheet';
import { fleetSession } from './fleetFixture';
import { TEST_ROSTER } from './rosterFixture';

const titled = (over: Partial<FleetSession> = {}): FleetSession => fleetSession({
  id: 'demo-quiet-mesa', workdir: '/w/demo/quiet-mesa', workspace: 'quiet-mesa', branch: 'ws/quiet-mesa',
  title: 'Investigate flaky upload test', ...over,
});

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const accountsRoute = (): Response => json({ accounts: [], projected: null, roster: TEST_ROSTER });

/** The title route answers `title`; every other route answers a blanket `/api/accounts` body. The swap sheet no
 *  longer polls that route: it reads the fleet store, the route's one reader. */
const stubTitleRoute = (answer: Response): void => {
  vi.stubGlobal('fetch', vi.fn(async (u: unknown) => (String(u).endsWith('/title') ? answer : accountsRoute())));
};
const titleCalls = (): unknown[][] => (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls
  .filter((c) => String(c[0]).endsWith('/title'));

const field = (): HTMLElement => screen.getByLabelText('Name or Linear ticket');
const openRename = (): void => { fireEvent.click(screen.getByRole('button', { name: 'Rename' })); };

beforeEach(() => { stubTitleRoute(json({ ok: true, id: 'demo-quiet-mesa', title: 'Upload retry spike' })); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

const mount = (session: FleetSession, onClose: () => void = () => {}) =>
  render(<><SessionActionsSheet session={session} open onClose={onClose} onReap={() => {}} /><ToastHost /></>);

describe('where Rename is offered', () => {
  it('on a workspace row, whether or not it has a title', () => {
    mount(titled());
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
    cleanup();
    mount(titled({ title: null }));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it('on an archived workspace: ccd writes two registry fields and touches no pane', () => {
    mount(titled({ archivedAt: 1785300000 }));
    expect(screen.getByRole('button', { name: 'Rename' })).toBeInTheDocument();
  });

  it('NOT on a main checkout', () => {
    mount(titled({ workspace: null }));
    expect(screen.queryByRole('button', { name: 'Rename' })).not.toBeInTheDocument();
  });
});

describe('the Rename sheet from the actions sheet', () => {
  it('opens pre-filled with the title and the slug it keeps, and sends nothing by itself', () => {
    mount(titled());
    openRename();
    expect((field() as HTMLInputElement).value).toBe('Investigate flaky upload test');
    expect(screen.getByRole('button', { name: 'Save title' })).toBeDisabled();
    expect(titleCalls()).toEqual([]);
  });

  it('Save posts the title to /api/sessions/:id/title and closes the actions sheet', async () => {
    const onClose = vi.fn();
    mount(titled(), onClose);
    openRename();
    fireEvent.change(field(), { target: { value: 'Upload retry spike' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    const [url, init] = titleCalls()[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/demo-quiet-mesa/title');
    expect(JSON.parse(init.body as string)).toEqual({ title: 'Upload retry spike' });
  });

  it('Clear posts {clear: true}', async () => {
    const onClose = vi.fn();
    mount(titled(), onClose);
    openRename();
    fireEvent.change(field(), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Clear title' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(JSON.parse((titleCalls()[0] as [string, RequestInit])[1].body as string)).toEqual({ clear: true });
  });

  it('a 501 from a box whose ccd predates the verb is said in the Rename sheet, which stays open', async () => {
    stubTitleRoute(json({ ok: false, error: 'unsupported', needs: 'ws-title' }, 501));
    const onClose = vi.fn();
    mount(titled(), onClose);
    openRename();
    fireEvent.change(field(), { target: { value: 'Upload retry spike' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save title' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('too old to rename a workspace');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('a retarget to another session closes the Rename sheet over it', () => {
    const r = mount(titled());
    openRename();
    expect(field()).toBeInTheDocument();
    r.rerender(<><SessionActionsSheet session={titled({ id: 'demo-still-water', workspace: 'still-water' })}
                                      open onClose={() => {}} onReap={() => {}} /><ToastHost /></>);
    expect(screen.queryByLabelText('Name or Linear ticket')).not.toBeInTheDocument();
  });
});
