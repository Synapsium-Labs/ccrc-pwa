// Delegation broker wave 5, PR10 (Task 5.10.2), moved by desktop polish C48 (D-8782): the worktree controls, now on the session's
// own details' worktree rows instead of the fleet list's card rows. The words module decides which control a row offers and
// spells every word; the section draws them, asks first where the words say so, calls the door, and says a refusal in worktree
// words (D-8097). Every request each control posts is pinned as the fleet-list row posted it at `main` (same URL, same body).
// The cases that were about an UNOWNED row are gone with that row (no home in the PWA after C48; the coordinator raises the
// follow-up). Fix rounds 1 and 2 (reviews 1615, 1623, 1624, 1626) keep their case names; F1's one-post rows are `worktree-confirm-close`'s.
import { afterEach, describe, it, expect, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fleetSession } from './fleetFixture';
import type { FleetSession } from '../../shared/api';
import { frame, lease } from './delegationFixture';
import { COORD_A, LEASE_ID, cardElement, okJson, renderCard, worldWithLease } from './leaseCardFixture';
import { clearAuthLost } from '../src/lib/auth';

afterEach(cleanup);

describe('worktree controls on a project card (delegation broker wave 5, PR10)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); clearAuthLost(); });
  type Call = { url: string; body: unknown };
  const accepted = (expiresAt: string | null = '2026-11-24T12:00:00.000Z') => okJson({ ok: true, lease: LEASE_ID, generation: 2,
    disposition: 'retained', expiresAt, carrier: 'pending' });
  const recorder = (answer: (url: string) => Response | Promise<Response> = () => accepted()) => {
    const calls: Call[] = [];
    return { calls, fetch: (url: string, init?: RequestInit) => {
      calls.push({ url, body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body });
      return answer(url);
    } };
  };
  const RESOLVE = new RegExp(`/api/leases/${LEASE_ID}/resolve$`);
  const rowOf = (container: HTMLElement, worktree = 'agent-a1'): HTMLElement =>
    [...container.querySelectorAll<HTMLElement>('.proj-work')].find((r) => r.textContent?.includes(worktree))!;
  /** F2: the focus sits on a live element in the row (never a disabled control). */
  const focusInRow = (row: HTMLElement): void => {
    const at = document.activeElement as HTMLElement | null;
    expect(at !== null && row.contains(at), `focus is in the row, not on ${at?.tagName}.${at?.className}`).toBe(true);
    expect((at as HTMLButtonElement).disabled ?? false, 'focus is not on a disabled control').toBe(false);
  };
  const confirmButton = (dialog: HTMLElement, name: string): HTMLElement => within(dialog).getByRole('button', { name });

  it('W5-U4: an adopted row says it is kept until its date once, and Keep calls operator-retain, toasts its date and keeps the focus', async () => {
    const r = recorder();
    const { container, getByRole, getByText } = renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }),
      { fetch: r.fetch });
    expect(getByText('worktree kept until 17 Nov')).toBeTruthy();
    expect(container.textContent).not.toMatch(/kept\b.*\bkept until/);
    await userEvent.click(getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(r.calls.map((c) => c.url)).toEqual([expect.stringMatching(/\/api\/leases\/[0-9a-f-]{36}\/operator-retain$/)]);
    expect(await screen.findByText('Worktree kept until 24 Nov')).toBeTruthy();
    focusInRow(rowOf(container));
  });

  it('W5-U5: an inferred row\'s Attach offers only its own session, posts {action:\'attach\', parent}, says its date and keeps the focus', async () => {
    const r = recorder();
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw' }), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(r.calls).toEqual([]);
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain('Attach this worktree to coord-a?');
    // The one choice is the worktree's own session: no picker, no list of sessions.
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByRole('combobox')).toBeNull();
    await userEvent.click(confirmButton(dialog, 'Attach to coord-a'));
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'attach', parent: 'coord-a' } }]);
    expect(await screen.findByText('Worktree attached to coord-a, kept until 24 Nov')).toBeTruthy();
    focusInRow(rowOf(container));
  });

  it('W5-U5 (R9): a programme worker\'s inferred worktree attaches to the worker, never to the coordinator it is drawn under', async () => {
    const worker = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', role: 'child' });
    const r = recorder();
    renderCard(worldWithLease({ sourceKind: 'raw', parentId: 'coord-a', via: 'worker-a' }, [COORD_A, worker]), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Attach to worker-a' }));
    expect(screen.queryByRole('button', { name: 'Attach to coord-a' })).toBeNull();
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'attach', parent: 'worker-a' } }]);
  });

  it('F4: Attach shows only while the worktree\'s own session is listed live; a raw row whose session is gone offers none', () => {
    const worker = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', role: 'child' });
    const gone = renderCard(worldWithLease({ sourceKind: 'raw', parentId: 'coord-gone', group: 'offline-coordinator' }));
    const row = rowOf(gone.container);
    expect(row.textContent).not.toContain('from coord-gone');
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Not delegated']);
    gone.unmount();
    // CONTROL: the same offline row whose own session (`via`) is listed live offers Attach to it.
    const live = renderCard(worldWithLease({ sourceKind: 'raw', parentId: 'coord-gone', via: 'worker-a', group: 'offline-coordinator' },
      [COORD_A, worker]));
    expect(within(rowOf(live.container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
  });

  it('W5-U7 (F6): Not delegated asks first in the danger tone with Cancel focused, says what it means, and posts only after it', async () => {
    const r = recorder();
    const { container } = renderCard(worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' }), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog.textContent).toContain(
      'This worktree is not delegated work. It will no longer be shown here, and it is not held back from the disk sweep.');
    expect(confirmButton(dialog, 'Not delegated').className, 'the danger tone').toMatch(/\bbtn-danger\b/);
    expect(document.activeElement, 'Cancel holds the focus').toBe(confirmButton(dialog, 'Cancel'));
    expect(r.calls).toEqual([]);
    await userEvent.click(confirmButton(dialog, 'Cancel'));
    expect(r.calls).toEqual([]);
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await userEvent.click(confirmButton(await screen.findByRole('dialog'), 'Not delegated'));
    expect(r.calls).toEqual([{ url: expect.stringMatching(RESOLVE), body: { action: 'foreign' } }]);
    expect(await screen.findByText('Worktree marked not delegated')).toBeTruthy();
    focusInRow(rowOf(container));
  });

  it('F2: the last row leaving while it holds the focus hands it to the details region', async () => {
    const r = recorder();
    const world = worldWithLease({ disposition: 'adopted', expiresAt: '2026-11-17T12:00:00.000Z' });
    const { container, rerender } = renderCard(world, { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    await userEvent.click(confirmButton(await screen.findByRole('dialog'), 'Not delegated'));
    await screen.findByText('Worktree marked not delegated');
    focusInRow(rowOf(container));
    // The next frame carries no row for it.
    rerender(cardElement({ ...world, frame: { ...world.frame, leases: [] } }));
    expect(container.querySelector('.proj-work')).toBeNull();
    // The section went with its heading: the details region that held it takes the focus.
    expect(document.activeElement).toBe(container.querySelector('.chat-facts'));
  });

  it('W5-U8: a transferring row says "moving to a run" and offers no control; a promoted one offers only Not delegated', () => {
    const { container, unmount } = renderCard(worldWithLease({ disposition: 'transferring', expiresAt: '2026-11-17T12:00:00.000Z' }));
    expect(screen.getByText('moving to a run')).toBeTruthy();
    expect(container.querySelector('.proj-work button')).toBeNull();
    expect(container.textContent).not.toContain('kept until');
    unmount();
    const promoted = renderCard(worldWithLease({ disposition: 'promoted' }));
    expect(screen.getByText('moved to a run')).toBeTruthy();
    expect([...promoted.container.querySelectorAll('.proj-work button')].map((b) => b.textContent)).toEqual(['Not delegated']);
  });

  it('W5-U9 (D-8097, F3): a refusal is said in worktree words in a region mounted empty, its detail never drawn, and nothing retries', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const detail = 'lease 0b0c3f8e is behind its carrier; retry operator-retain later';
    const r = recorder(() => okJson({ ok: false, error: 'carrier-behind', detail }, 409));
    const { container } = renderCard(worldWithLease({ disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' }), { fetch: r.fetch });
    const row = rowOf(container);
    const region = within(row).getByRole('alert');
    expect(region.textContent, 'the region is mounted empty, before it has anything to say').toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await within(row).findByText('The fleet box has not caught up with this worktree yet. Try again shortly.')).toBe(region);
    expect(within(row).getByRole('alert'), 'the same region, its text swapped').toBe(region);
    expect(document.body.textContent).not.toContain(detail);
    expect(document.body.textContent).not.toMatch(/operator-retain|carrier-behind/);
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    expect(r.calls, 'nothing is retried by itself').toHaveLength(1);
  });

  it('D-8097: a refusal word this build does not know says one plain sentence; a failure that is no answer says the app\'s words', async () => {
    const unknown = recorder(() => okJson({ ok: false, error: 'future-word', detail: 'a newer lease rule refused this' }, 409));
    const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: unknown.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await within(rowOf(container)).findByText('The server refused this.')).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/future-word|newer lease rule/);
    cleanup();
    const broken = recorder(() => okJson({ error: 'internal' }, 500));
    renderCard(worldWithLease({ disposition: 'retained' }), { fetch: broken.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await screen.findByText(/^Couldn't keep the worktree/)).toBeTruthy();
    expect(broken.calls).toHaveLength(1);
  });

  it('F1 (measured, not a departure): a raw row on a conflicting tree, and a box without the hold, each say their refusal', async () => {
    for (const [error, sentence] of [
      ['lease-conflicting', 'Two sessions claimed this worktree, so it cannot be kept until that is settled.'],
      ['box-unsupported', 'The fleet box cannot hold this worktree back from the disk sweep until its ccrc is updated.'],
    ] as const) {
      const r = recorder(() => okJson({ ok: false, error, detail: 'lease refused' }, error === 'box-unsupported' ? 503 : 409));
      const { container } = renderCard(worldWithLease({ sourceKind: 'raw', disposition: 'ephemeral' }), { fetch: r.fetch });
      await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
      expect(await within(rowOf(container)).findByText(sentence), error).toBeTruthy();
      cleanup();
    }
  });

  it('F6: every control is disabled while an act is in flight, and comes back when it ends', async () => {
    let release: (r: Response) => void = () => {};
    const r = recorder(() => new Promise<Response>((res) => { release = res; }));
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw', disposition: 'retained' }), { fetch: r.fetch });
    const buttons = () => within(rowOf(container)).getAllByRole('button') as HTMLButtonElement[];
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(buttons().map((b) => b.disabled)).toEqual([true, true, true]);
    focusInRow(rowOf(container));
    await act(async () => { release(accepted()); });
    await screen.findByText('Worktree kept until 24 Nov');
    expect(buttons().map((b) => b.disabled)).toEqual([false, false, false]);
  });

  // F9 (a), the confirm's words as it closes, is `worktree-confirm-close.test.tsx`'s: jsdom unmounts a closed sheet at once.
  it('F9 (b): an ask is dropped when its row stops offering the act, and it never reopens or posts by itself', async () => {
    const r = recorder();
    const world = (disposition: 'adopted' | 'transferring') => worldWithLease({ disposition, expiresAt: '2026-11-17T12:00:00.000Z' });
    const { rerender } = renderCard(world('adopted'), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    rerender(cardElement(world('transferring')));
    expect(screen.queryByRole('dialog')).toBeNull();
    rerender(cardElement(world('adopted')));
    expect(screen.queryByRole('dialog'), 'the ask does not come back with the control').toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('F9 (c): a 2xx whose body is not JSON says the act was accepted and its answer unread, with no thrown parse', async () => {
    const r = recorder(() => new Response('<html>ok</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
    const row = rowOf(container);
    const status = within(row).getByRole('status');
    expect(status.textContent, 'the status region is mounted empty').toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    // F8 (b) (review 1623): an accepted act is no error, so it is said politely, never in the alert.
    expect(await within(row).findByText(
      'The server accepted this, but its answer could not be read; the row updates with its next change.')).toBe(status);
    expect(within(row).getByRole('alert').textContent).toBe('');
  });

  it('F8 (a) (review 1623): a 2xx that says ok with no expiresAt reads it as no date known, as the wire\'s own reader does', async () => {
    const r = recorder(() => okJson({ ok: true }));
    const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(await screen.findByText('Worktree kept')).toBeTruthy();
    expect(rowOf(container).textContent).not.toContain('could not be read');
  });

  it('F2 (review 1623): a refusal that is no door\'s answer (the server\'s real 401, 403, 429 and 501 bodies, a door word at another status) says the app\'s words', async () => {
    for (const [status, body] of [
      [401, { ok: false, error: 'unauthenticated', verdict: 'no-session' }],
      [501, { ok: false, error: 'not-configured' }],
      [403, { ok: false, error: 'foreign-origin' }],
      [429, { ok: false, error: 'rate-limited' }],
      [409, { ok: false, error: 'not-ready', detail: 'a door word at a status it is never sent with' }],
    ] as const) {
      const r = recorder(() => okJson(body, status));
      const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
      await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
      const alert = within(rowOf(container)).getByRole('alert');
      await vi.waitFor(() => expect(alert.textContent, `${status} ${body.error}`).toMatch(/^Couldn't keep the worktree — /));
      expect(alert.textContent, `${status} ${body.error}`).not.toBe('The server refused this.');
      cleanup();
      clearAuthLost();
    }
  });

  it('F5 (review 1623): a session in the dead bucket is still listed, so its inferred worktree offers Attach to it', () => {
    const dead = fleetSession({ id: 'coord-a', project: 'project-a', workspace: null, workdir: '/work/project-a', name: 'coord-a', bucket: 'dead' });
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw' }, [dead]));
    expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
  });

  it('F4 (review 1623): Attach removed by its session leaving the list while its confirm is open closes it; Keep and Not delegated stay; nothing posts', async () => {
    const r = recorder();
    const world = worldWithLease({ sourceKind: 'raw' });
    const { container, rerender } = renderCard(world, { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    rerender(cardElement({ ...world, sessions: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Not delegated']);
    rerender(cardElement(world));
    expect(screen.queryByRole('dialog'), 'the ask does not come back with the control').toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('F4 (review 1623): an open Attach closes when the worktree\'s own session changes, and never posts the old one', async () => {
    const worker = (id: string) => fleetSession({ id, project: 'project-a', workspace: id, workdir: `/work/project-a/.ws/${id}`, role: 'child' });
    const sessions = [COORD_A, worker('worker-a'), worker('worker-b')];
    const r = recorder();
    const at = (via: string) => worldWithLease({ sourceKind: 'raw', parentId: 'coord-a', via }, sessions);
    const { rerender } = renderCard(at('worker-a'), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect((await screen.findByRole('dialog')).textContent).toContain('Attach this worktree to worker-a?');
    rerender(cardElement(at('worker-b')));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(r.calls).toEqual([]);
  });

  it('F3 (a) (review 1623): a row that goes transferring while its box holds the focus hands it to the card\'s toggle, its regions kept', async () => {
    const r = recorder();
    const world = (disposition: 'retained' | 'transferring') => worldWithLease({ disposition, expiresAt: '2026-11-17T12:00:00.000Z' });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    const alert = within(rowOf(container)).getByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await screen.findByText('Worktree kept until 24 Nov');
    expect(document.activeElement).toBe(container.querySelector('.proj-work-controls'));
    rerender(cardElement(world('transferring')));
    expect(container.querySelector('.proj-work button')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector('.sess-worktrees > .sess-entries-note'));
    expect(within(rowOf(container)).getByRole('alert'), 'the region stays mounted while the row offers none').toBe(alert);
  });

  it('C38 (review 1624): the box the focus goes to while an act is in flight says it is busy, and stops saying so once the act settles', async () => {
    let release: (r: Response) => void = () => undefined;
    const r = recorder(() => new Promise<Response>((done) => { release = done; }));
    const { container } = renderCard(worldWithLease({ disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' }), { fetch: r.fetch });
    const box = container.querySelector('.proj-work-controls')!;
    expect(box.getAttribute('aria-busy'), 'CONTROL: the box is not busy before an act').toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    expect(document.activeElement, 'CONTROL: the act took the focus to the box').toBe(box);
    expect(box.getAttribute('aria-busy'), 'the box holding the focus does not say its act is in flight').toBe('true');
    await act(async () => { release(accepted()); });
    await screen.findByText('Worktree kept until 24 Nov');
    expect(box.getAttribute('aria-busy'), 'the box still says busy once its act settled').toBeNull();
  });

  it('F3 (a) (review 1623): on an offline coordinator\'s own page, the focus goes to the worktree section\'s heading', async () => {
    const r = recorder();
    const world = (disposition: 'retained' | 'transferring') =>
      worldWithLease({ disposition, parentId: 'coord-gone', group: 'offline-coordinator' });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await screen.findByText(/^Worktree kept/);
    rerender(cardElement(world('transferring')));
    expect(document.activeElement).toBe(container.querySelector('.sess-worktrees > .sess-entries-note'));
  });

  it('F3 (b) (review 1623): a row first drawn with none that later offers a control and loses it, focused, hands the focus over', () => {
    const world = (disposition: 'transferring' | 'promoted') => worldWithLease({ disposition });
    const { container, rerender } = renderCard(world('transferring'));
    expect(container.querySelector('.proj-work button')).toBeNull();
    rerender(cardElement(world('promoted')));
    act(() => { screen.getByRole('button', { name: 'Not delegated (agent-a1)' }).focus(); });
    rerender(cardElement(world('transferring')));
    expect(document.activeElement).toBe(container.querySelector('.sess-worktrees > .sess-entries-note'));
  });

  it('F3 (c) (review 1623): a refusal that settles while the row offers none is said then, in the same region, which never remounts', async () => {
    let release: (r: Response) => void = () => {};
    const r = recorder(() => new Promise<Response>((res) => { release = res; }));
    const world = (disposition: 'retained' | 'transferring') => worldWithLease({ disposition });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    const alert = within(rowOf(container)).getByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    rerender(cardElement(world('transferring')));
    await act(async () => { release(okJson({ ok: false, error: 'wrong-disposition', detail: 'x' }, 409)); });
    expect(alert.isConnected).toBe(true);
    await vi.waitFor(() => expect(alert.textContent).toBe("This worktree's state does not allow that now."));
    rerender(cardElement(world('retained')));
    // Review 1624 F5 (ruled): the refusal answered the act the row offered before; once its controls are back it is cleared.
    expect(within(rowOf(container)).getByRole('alert'), 'the same element, still mounted').toBe(alert);
    expect(alert.textContent, 'the old refusal is no longer said').toBe('');
  });

  it('F5 (review 1624): a refusal is cleared when the row\'s state moves under the same controls; a repeat of the act says it again', async () => {
    const r = recorder(() => okJson({ ok: false, error: 'wrong-disposition', detail: 'x' }, 409));
    const world = (disposition: 'retained' | 'adopted') => worldWithLease({ disposition, expiresAt: '2026-11-17T12:00:00.000Z' });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    const alert = within(rowOf(container)).getByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await vi.waitFor(() => expect(alert.textContent).toBe("This worktree's state does not allow that now."));
    // CONTROL: a frame that changes nothing the row offers keeps the sentence.
    rerender(cardElement(world('retained')));
    expect(alert.textContent).toBe("This worktree's state does not allow that now.");
    rerender(cardElement(world('adopted')));
    expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent), 'the same two controls').toEqual(
      ['Keep worktree', 'Not delegated']);
    expect(within(rowOf(container)).getByRole('alert'), 'the region stays mounted').toBe(alert);
    expect(alert.textContent, 'its text emptied').toBe('');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await vi.waitFor(() => expect(alert.textContent).toBe("This worktree's state does not allow that now."));
  });

  it('F2 (review 1624): an unknown word at a status no door sends, and a 409 body with no ok, say the app\'s words', async () => {
    for (const [status, body, what] of [
      [500, { ok: false, error: 'future-word' }, 'an unknown word away from a door status'],
      [409, { error: 'x' }, 'a body without ok: false'],
    ] as const) {
      const r = recorder(() => okJson(body, status));
      const { container } = renderCard(worldWithLease({ disposition: 'retained' }), { fetch: r.fetch });
      await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
      const alert = within(rowOf(container)).getByRole('alert');
      await vi.waitFor(() => expect(alert.textContent, what).toMatch(/^Couldn't keep the worktree — /));
      expect(alert.textContent, what).not.toBe('The server refused this.');
      expect(r.calls, what).toHaveLength(1);
      cleanup();
    }
  });

  it('F1 (review 1624): a hand-off clears the box\'s hold, so a later change moves no focus; every focus the row moves skips the scroll', async () => {
    const r = recorder();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    try {
      const world = (disposition: 'retained' | 'promoted' | 'transferring') =>
        worldWithLease({ sourceKind: 'raw', disposition, expiresAt: '2026-11-17T12:00:00.000Z' });
      const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
      const toggle = container.querySelector<HTMLElement>('.sess-worktrees > .sess-entries-note')!;
      // The row's own script focuses: the box after Keep, after a confirmed Not delegated, and the hand-off below.
      const ours = (): unknown[] => focus.mock.calls.filter((_, i) => {
        const el = focus.mock.contexts[i] as HTMLElement;
        return el === toggle || el.classList.contains('proj-work-controls');
      }).map((c) => c[0]);
      await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
      await screen.findByText('Worktree kept until 24 Nov');
      await userEvent.click(screen.getByRole('button', { name: 'Not delegated (agent-a1)' }));
      await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Not delegated' }));
      await screen.findByText('Worktree marked not delegated');
      // The focus on a button the row then removes, with no blur (as a removal fires none): the box still holds it.
      act(() => { screen.getByRole('button', { name: 'Attach to… (agent-a1)' }).focus(); });
      rerender(cardElement(world('promoted')));
      expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent)).toEqual(['Not delegated']);
      expect(document.activeElement).toBe(document.body);
      rerender(cardElement(world('transferring')));
      expect(document.activeElement, 'the hand-off, as F3 (b) rules it').toBe(toggle);
      // The operator moves on; the box is no longer theirs. The row comes back and goes again: nothing moves.
      act(() => { toggle.blur(); });
      rerender(cardElement(world('promoted')));
      rerender(cardElement(world('transferring')));
      expect(document.activeElement, 'no focus moved at an unrelated moment').toBe(document.body);
      expect(ours().length, 'the box twice for Not delegated, once for Keep, and one hand-off').toBe(4);
      for (const o of ours()) expect(o, 'every focus the row moves skips the scroll').toEqual({ preventScroll: true });
    } finally {
      focus.mockRestore();
    }
  });

  it('F3 (review 1624): an ask its row stops offering, closed while the sheet gives the focus back to nothing, places it in the box', async () => {
    const r = recorder();
    const world = worldWithLease({ sourceKind: 'raw' });
    const { container, rerender } = renderCard(world, { fetch: r.fetch });
    await userEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    // The worktree's session leaves the list: Attach, the opener, goes with it, so the sheet has nothing to give back to.
    rerender(cardElement({ ...world, sessions: [] }));
    expect(screen.queryByRole('dialog')).toBeNull();
    await vi.waitFor(() => expect(document.activeElement).toBe(container.querySelector('.proj-work-controls')));
    expect(r.calls).toEqual([]);
  });

  it('F1 (review 1626): a row left with no controls while its confirm is open hands the focus to its heading, the box being the opener', async () => {
    const r = recorder();
    const world = (disposition: 'retained' | 'transferring') => worldWithLease({ sourceKind: 'raw', disposition });
    const { container, rerender } = renderCard(world('retained'), { fetch: r.fetch });
    // The box holds the focus when the confirm opens (a tap that does not focus its button), so the sheet's opener is the box.
    const box = container.querySelector<HTMLElement>('.proj-work-controls')!;
    act(() => { box.focus(); });
    fireEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    rerender(cardElement(world('transferring')));
    expect(container.querySelector('.proj-work-controls'), 'the box stays, with no controls').not.toBeNull();
    await vi.waitFor(() => expect(document.activeElement, 'the heading, never the empty box').toBe(container.querySelector('.sess-worktrees > .sess-entries-note')));
    expect(r.calls).toEqual([]);
  });

  it('F3 (b) (review 1626): Cancel on a confirm with no opener to give back to leaves no hold, so a later change moves nothing', async () => {
    const world = (disposition: 'retained' | 'transferring') => worldWithLease({ sourceKind: 'raw', disposition });
    const { container, rerender } = renderCard(world('retained'));
    // The page holds the focus when the confirm opens (a tap that focuses nothing), so the sheet has no opener.
    expect(document.activeElement).toBe(document.body);
    fireEvent.click(screen.getByRole('button', { name: 'Attach to… (agent-a1)' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(document.body);
    rerender(cardElement(world('transferring')));
    expect(container.querySelector('.proj-work button')).toBeNull();
    expect(document.activeElement, 'nothing moved').toBe(document.body);
  });

  it('F5 (review 1626): a refusal is cleared when Attach goes because its session left the list, the state unchanged', async () => {
    const worker = fleetSession({ id: 'worker-a', project: 'project-a', workspace: 'worker-a', workdir: '/work/project-a/.ws/worker-a', role: 'child' });
    const r = recorder(() => okJson({ ok: false, error: 'wrong-disposition', detail: 'x' }, 409));
    const world = (sessions: readonly FleetSession[]) => worldWithLease({ sourceKind: 'raw', parentId: 'coord-a', via: 'worker-a',
      disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' }, sessions);
    const { container, rerender } = renderCard(world([COORD_A, worker]), { fetch: r.fetch });
    const alert = within(rowOf(container)).getByRole('alert');
    await userEvent.click(screen.getByRole('button', { name: 'Keep worktree (agent-a1)' }));
    await vi.waitFor(() => expect(alert.textContent).toBe("This worktree's state does not allow that now."));
    rerender(cardElement(world([COORD_A])));
    expect(within(rowOf(container)).getAllByRole('button').map((b) => b.textContent), 'Attach went; the state did not move').toEqual(
      ['Keep worktree', 'Not delegated']);
    expect(within(rowOf(container)).getByRole('alert'), 'the region stays mounted').toBe(alert);
    expect(alert.textContent, 'its text emptied').toBe('');
  });

  it('W5-U10: an older server\'s rows (no disposition) add no word and no control to the row\'s own', () => {
    // Measured on the base (67121c031) with this fixture, before PR10's card change, and re-measured for H3 (D-8875): the
    // row says what made it and its path, and its title is the path; it says no liveness word. Re-measured for HF2 (D-8877):
    // the path is drawn as one box per piece, cut after each `/` (review 3123 F3), and the two chips are one box (F6).
    const BASE = [
    "<div class=\"proj-work\" title=\"/work/project-a/.claude/worktrees/agent-a1\"><span class=\"proj-work-parts\"><span class=\"proj-work-part\">agent worktree</span><span class=\"proj-work-part proj-work-name\"><span class=\"proj-work-name-text\"><span class=\"proj-work-seg\">/</span><span class=\"proj-work-seg\">work/</span><span class=\"proj-work-seg\">project-a/</span><span class=\"proj-work-seg\">.claude/</span><span class=\"proj-work-seg\">worktrees/</span><span class=\"proj-work-seg\">agent-a1</span></span></span></span></div>",
    "<div class=\"proj-work\" title=\"/work/project-a/.claude/worktrees/agent-r1\"><span class=\"proj-work-parts\"><span class=\"proj-work-part\">worktree</span><span class=\"proj-work-part proj-work-name\"><span class=\"proj-work-name-text\"><span class=\"proj-work-seg\">/</span><span class=\"proj-work-seg\">work/</span><span class=\"proj-work-seg\">project-a/</span><span class=\"proj-work-seg\">.claude/</span><span class=\"proj-work-seg\">worktrees/</span><span class=\"proj-work-seg\">agent-r1</span></span></span></span><span class=\"proj-work-chips\"><span class=\"proj-work-chip\" title=\"linked by the worktree listing taken before and after Bash call toolu_test_0001, with no other session's listing overlapping it; no upstream id confirms it, and nothing acts on it automatically\">inferred</span><span class=\"proj-work-chip\" title=\"the Bash call that created this worktree: toolu_test_0001\">Bash call …est_0001</span></span></div>",
    ];
    const { container } = renderCard({ frame: frame({ leases: [lease({ leaseId: LEASE_ID }), lease({ leaseId: 'l-raw', sourceKind: 'raw',
      adminRecord: 'agent-r1', canonicalPath: '/work/project-a/.claude/worktrees/agent-r1' })] }), sessions: [COORD_A] });
    expect([...container.querySelectorAll('.proj-work')].map((r) => r.outerHTML)).toEqual(BASE);
  });

  it('W5-U11 (F9 (f)): the three controls are buttons named by their words and their worktree, drawn by the design system\'s Button', () => {
    const { container } = renderCard(worldWithLease({ sourceKind: 'raw', disposition: 'retained', expiresAt: '2026-11-17T12:00:00.000Z' }));
    const row = rowOf(container);
    expect(within(row).getAllByRole('button').map((b) => b.textContent)).toEqual(['Keep worktree', 'Attach to…', 'Not delegated']);
    expect(within(row).getAllByRole('button').map((b) => b.getAttribute('aria-label')))
      .toEqual(['Keep worktree (agent-a1)', 'Attach to… (agent-a1)', 'Not delegated (agent-a1)']);
    // `Button` (@ccrc/ui) carries its own tap floor, which is why control-census registers no `<Button>` call site.
    for (const b of within(row).getAllByRole('button')) expect(b.className).toMatch(/\bmin-h-tap\b/);
    expect(row.textContent).not.toMatch(/lease|adopt|retain|clean|spool|running/i);
    // F8 (c), (d) (review 1623): the controls carry no tooltip of the row's (an empty title ends its reach), and sit in a
    // group named by the row's worktree.
    for (const b of within(row).getAllByRole('button')) expect(b.closest('[title]')?.getAttribute('title')).toBe('');
    expect(within(row).getByRole('group', { name: 'Worktree agent-a1' })).toBe(row.querySelector('.proj-work-controls'));
  });
});
