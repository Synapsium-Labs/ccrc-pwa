// `useProjectRows.addWorkspace` as the sheets use it (named workspaces S7): it sends what it is handed, keeps the
// class the chooser holds, refreshes after a success, and reports how it ended instead of toasting: the sheet that
// asked says it. Driven through the real plane with `api` spied, no screen around it.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { useProjectRows } from '../src/fleet/useProjectRows';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const plane = () => {
  vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
  return renderHook(() => useProjectRows(null, () => {}));
};

describe('addWorkspace', () => {
  it('sends nothing but the project for an empty create', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    const { result } = plane();
    await act(async () => { expect(await result.current.addWorkspace('alpha')).toEqual({ kind: 'added', answer: { named: false } }); });
    expect(add).toHaveBeenCalledWith('alpha', {});
  });

  it('sends the name it is handed', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: true, id: 'alpha-eng-1', slug: 'eng-1', title: 'ENG-1' });
    const { result } = plane();
    await act(async () => { await result.current.addWorkspace('alpha', { name: 'ENG-1' }); });
    expect(add).toHaveBeenCalledWith('alpha', { name: 'ENG-1' });
  });

  it('keeps the class the chooser holds beside the name', async () => {
    const add = vi.spyOn(api, 'workspaceAdd').mockResolvedValue({ named: false });
    const { result } = plane();
    act(() => { result.current.chooseClass('opus'); });
    await act(async () => { await result.current.addWorkspace('alpha', { name: 'ENG-1' }); });
    expect(add).toHaveBeenCalledWith('alpha', { route: { class: 'opus' }, name: 'ENG-1' });
  });

  it('reports a refusal as what was thrown, unread, and raises no toast of its own', async () => {
    const thrown = new ApiError(409, { ok: false, error: 'slug-taken' });
    vi.spyOn(api, 'workspaceAdd').mockRejectedValue(thrown);
    const { result } = plane();
    await act(async () => { expect(await result.current.addWorkspace('alpha', { name: 'ENG-1' })).toEqual({ kind: 'refused', error: thrown }); });
    expect(result.current.adding.has('alpha')).toBe(false);
  });

  it('answers busy, and sends nothing, for a project whose first create has not answered', async () => {
    let release!: () => void;
    const add = vi.spyOn(api, 'workspaceAdd').mockImplementation(() => new Promise((resolve) => { release = () => resolve({ named: false }); }));
    const { result } = plane();
    let first!: Promise<unknown>;
    act(() => { first = result.current.addWorkspace('alpha'); });
    await waitFor(() => expect(result.current.adding.has('alpha')).toBe(true));

    await act(async () => { expect(await result.current.addWorkspace('alpha')).toEqual({ kind: 'busy' }); });
    expect(add).toHaveBeenCalledTimes(1);

    await act(async () => { release(); await first; });
    expect(result.current.adding.has('alpha')).toBe(false);
  });
});
