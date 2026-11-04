// `useProjectRows.addProject` (add-project spec 2026-11-04 §4 PWA): it sends the body it is handed, refreshes the rows
// through the plane's own read after a success (the plane stays THE ONE reader of `GET /api/projects`), and reports how
// it ended instead of toasting: the sheet that asked says it. Driven through the real plane with `api` spied.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { api } from '../src/lib/api';
import { ApiError } from '../src/lib/apiError';
import { useProjectRows } from '../src/fleet/useProjectRows';
import type { ProjectRow } from '../../shared/api';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });

const ROW: ProjectRow = { name: 'project-a', workdir: '<projects-root>/project-a' };

describe('addProject', () => {
  it('sends the body, then re-reads the projects and publishes them', async () => {
    const projects = vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [ROW] });
    const add = vi.spyOn(api, 'projectAdd').mockResolvedValue({ ok: true, name: 'project-a', source: 'empty' });
    const publish = vi.fn();
    const { result } = renderHook(() => useProjectRows(null, publish));
    expect(projects).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.addProject({ source: 'empty', name: 'project-a' }))
        .toEqual({ kind: 'added', answer: { ok: true, name: 'project-a', source: 'empty' } });
    });
    expect(add).toHaveBeenCalledWith({ source: 'empty', name: 'project-a' });
    await waitFor(() => expect(result.current.knownProjects).toEqual(['project-a']));
    expect(projects).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith([ROW]);
  });

  it('reports a refusal as what was thrown, unread, refreshes nothing and re-arms', async () => {
    const projects = vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    const thrown = new ApiError(409, { ok: false, error: 'project-exists' });
    vi.spyOn(api, 'projectAdd').mockRejectedValue(thrown);
    const { result } = renderHook(() => useProjectRows(null, () => {}));
    await act(async () => {
      expect(await result.current.addProject({ source: 'empty', name: 'project-a' })).toEqual({ kind: 'refused', error: thrown });
    });
    expect(result.current.addingProject).toBe(false);
    expect(projects).not.toHaveBeenCalled();
  });

  it.each([
    ['an answer the server could not wait for', new ApiError(504, { ok: false, error: 'outcome-unknown' })],
    ['no answer at all', new TypeError('Failed to fetch')],
  ])('re-reads the projects after %s, since the project may be there', async (_label, thrown) => {
    const projects = vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [ROW] });
    vi.spyOn(api, 'projectAdd').mockRejectedValue(thrown);
    const { result } = renderHook(() => useProjectRows(null, () => {}));
    await act(async () => {
      expect(await result.current.addProject({ source: 'empty', name: 'project-a' })).toEqual({ kind: 'refused', error: thrown });
    });
    await waitFor(() => expect(result.current.knownProjects).toEqual(['project-a']));
    expect(projects).toHaveBeenCalledTimes(1);
  });

  it('answers busy, and sends nothing, while the first add has not answered', async () => {
    vi.spyOn(api, 'projects').mockResolvedValue({ roots: [], projects: [] });
    let release!: () => void;
    const add = vi.spyOn(api, 'projectAdd').mockImplementation(() => new Promise((resolve) => {
      release = () => resolve({ ok: true, name: 'repo', source: 'github' });
    }));
    const { result } = renderHook(() => useProjectRows(null, () => {}));
    let first!: Promise<unknown>;
    act(() => { first = result.current.addProject({ source: 'github', repo: 'example/repo', name: 'repo' }); });
    await waitFor(() => expect(result.current.addingProject).toBe(true));

    await act(async () => { expect(await result.current.addProject({ source: 'empty', name: 'project-b' })).toEqual({ kind: 'busy' }); });
    expect(add).toHaveBeenCalledTimes(1);

    await act(async () => { release(); await first; });
    expect(result.current.addingProject).toBe(false);
  });
});
