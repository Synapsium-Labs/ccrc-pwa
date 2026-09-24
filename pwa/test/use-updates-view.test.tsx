// useUpdatesView — the ONE poll of GET /api/updates (design 2026-09-20 §13;
// W3 Task 5) — and the two pure readers every update surface shares:
//
//  • asUpdatesView: a malformed answer is a FAILURE, never an empty fleet. A
//    stub `{}` read as "no nodes, no releases" would render "nothing to update"
//    over a fleet the screen simply failed to read.
//  • pendingTag: THE arrow predicate Tasks 9, 11 and 12 read. No arrow while a
//    node is unmeasured or has no resolved channel (spec §18 "unreachable is
//    not current"), and tags compare as semver — `v0.0.10` is newer than
//    `v0.0.9`, which string order gets backwards.
//
// The hook is `useFleetHealth`'s shape (newest issued request wins, `pollMs <=
// 0` is the injected mode) plus two things that hook does not have: it keeps
// the last GOOD view across a failed poll while reporting the failure beside
// it, and it re-polls when the page becomes visible.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { NodeWire, UpdatesView } from '../../shared/api';
import { ApiError, api } from '../src/lib/api';
import { UPDATES_POLL_MS, asUpdatesView, nodeVersion, pendingTag, useUpdatesView } from '../src/fleet/useUpdatesView';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  // The own property `setVisibility` planted shadows jsdom's getter; deleting
  // it restores the prototype's answer for the next file.
  Reflect.deleteProperty(document, 'visibilityState');
});

const node = (over: Partial<NodeWire> = {}): NodeWire => ({
  nodeId: '0f0e0d0c-0b0a-4908-8706-050403020100', role: 'fleet', label: 'fleet', os: 'linux',
  current: { sha: 'a'.repeat(40), ref: 'main', builtAt: '2026-09-22T00:00:00Z', dirty: false, version: 'v0.0.9' },
  stampRead: 'ok', installState: 'complete', provenance: 'verified',
  caps: ['verify', 'node-id', 'floor'], agentOps: [], highestVersion: 'v0.0.9', previousVersion: null,
  measuredAt: 1_000, reachable: true, unreachableSince: null,
  channel: 'stable', desiredTag: 'v0.0.9', resolveDetail: null, request: null, report: null,
  update: { state: 'idle', target: null, startedAt: null, detail: null },
  ...over,
});

const view = (over: Partial<UpdatesView> = {}): UpdatesView => ({
  catalogue: { lastOkAt: 1_000, lastError: null },
  releases: [],
  nodes: [node()],
  intent: [],
  ...over,
});

/** One poll interval, flushed. */
const tick = async (): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS); });
};

describe('asUpdatesView — a malformed answer is a failure, never an empty fleet', () => {
  it('passes a well-formed view through as the same object', () => {
    const v = view();
    expect(asUpdatesView(v)).toBe(v);
    const neverReached = view({ catalogue: { lastOkAt: null, lastError: { at: 5, reason: 'no-egress' } } });
    expect(asUpdatesView(neverReached)).toBe(neverReached);
  });

  it('refuses a non-object and every missing or non-array list', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      expect(asUpdatesView(raw), JSON.stringify(raw)).toBeNull();
    }
    const { releases: _r, ...noReleases } = view();
    void _r;
    expect(asUpdatesView(noReleases), 'releases absent').toBeNull();
    expect(asUpdatesView({ ...view(), nodes: {} }), 'nodes: {}').toBeNull();
    expect(asUpdatesView({ ...view(), intent: null }), 'intent: null').toBeNull();
  });

  it('refuses a catalogue that is not the two-field line — `lastOkAt` absent is not "never checked"', () => {
    // The half of "unreachable is not current" this guard owns: the settings
    // line and the banner decide on `lastOkAt !== null`, and `undefined !==
    // null` is true — so an object-only check would let `{}` read as checked.
    expect(asUpdatesView({ ...view(), catalogue: null }), 'catalogue: null').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: [] }), 'catalogue: []').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: {} }), 'catalogue: {}').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastError: null } }), 'lastOkAt absent').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: '5', lastError: null } }), 'a string lastOkAt').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: Number.NaN, lastError: null } }), 'NaN').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: null, lastError: { at: 5 } } }), 'no reason').toBeNull();
    expect(asUpdatesView({ ...view(), catalogue: { lastOkAt: null } }), 'lastError absent').toBeNull();
  });
});

describe('nodeVersion and pendingTag — the one arrow predicate', () => {
  it('nodeVersion is the stamp\'s tag, or null when there is none to compare', () => {
    expect(nodeVersion(node())).toBe('v0.0.9');
    expect(nodeVersion(node({ current: null })), 'no stamp').toBeNull();
    const { version: _v, ...untagged } = node().current!;
    void _v;
    expect(nodeVersion(node({ current: untagged })), 'an untagged build').toBeNull();
    expect(nodeVersion(node({ current: { ...untagged, version: 'dev' } })), 'not a tag').toBeNull();
  });

  it('points at a newer desired tag — in semver order, across the v0.0.9 → v0.0.10 boundary', () => {
    expect('v0.0.10' < 'v0.0.9', 'the control: string order gets this pair backwards').toBe(true);
    expect(pendingTag(node({ desiredTag: 'v0.0.10' }))).toBe('v0.0.10');
  });

  it('draws no arrow while the node is unmeasured (spec §18 "unreachable is not current")', () => {
    expect(pendingTag(node({ desiredTag: 'v0.0.10', measuredAt: null }))).toBeNull();
    const absent = { ...node({ desiredTag: 'v0.0.10' }), measuredAt: undefined } as unknown as NodeWire;
    expect(pendingTag(absent), 'measuredAt absent is unmeasured, not measured').toBeNull();
  });

  it('draws no arrow while the node has no resolved channel', () => {
    expect(pendingTag(node({ desiredTag: 'v0.0.10', channel: null }))).toBeNull();
    const absent = { ...node({ desiredTag: 'v0.0.10' }), channel: undefined } as unknown as NodeWire;
    expect(pendingTag(absent), 'channel absent').toBeNull();
  });

  it('draws no arrow for a missing, non-tag, equal or older desired tag', () => {
    expect(pendingTag(node({ desiredTag: null })), 'no desired tag').toBeNull();
    expect(pendingTag(node({ desiredTag: 'latest' })), 'not a tag').toBeNull();
    expect(pendingTag(node({ desiredTag: 'v0.0.9' })), 'equal').toBeNull();
    expect(pendingTag(node({ desiredTag: 'v0.0.8' })), 'older — a rollback is not an update arrow').toBeNull();
  });

  it('points at the desired tag when the node runs nothing it can compare', () => {
    const { version: _v, ...untagged } = node().current!;
    void _v;
    expect(pendingTag(node({ current: untagged })), 'unversioned').toBe('v0.0.9');
    expect(pendingTag(node({ current: null })), 'no stamp').toBe('v0.0.9');
    expect(pendingTag(node({ current: { ...untagged, version: 'dev' } })), 'a non-tag version').toBe('v0.0.9');
  });
});

describe('useUpdatesView — the one poll of /api/updates', () => {
  it('polls at mount and then every UPDATES_POLL_MS (60 s)', async () => {
    expect(UPDATES_POLL_MS).toBe(60_000);
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    renderHook(() => useUpdatesView());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS - 1); });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('starts with nothing, then carries the first good answer', async () => {
    const good = view();
    vi.spyOn(api, 'updates').mockResolvedValue(good);
    const { result } = renderHook(() => useUpdatesView());
    expect(result.current.view).toBeNull();
    expect(result.current.failure).toBeNull();
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();
  });

  it('keeps the newest issued poll authoritative when an older request resolves last', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<UpdatesView>();
    const newer = view({ catalogue: { lastOkAt: 2_000, lastError: null } });
    vi.spyOn(api, 'updates').mockReturnValueOnce(first.promise).mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useUpdatesView());
    await tick();
    expect(result.current.view).toBe(newer);

    await act(async () => { first.resolve(view()); await first.promise; });
    expect(result.current.view).toBe(newer);
    expect(result.current.failure).toBeNull();
  });

  it('keeps it authoritative when an older request REJECTS last — a stale failure is not reported', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<UpdatesView>();
    const newer = view();
    vi.spyOn(api, 'updates').mockReturnValueOnce(first.promise).mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useUpdatesView());
    await tick();
    await act(async () => { first.reject(new TypeError('Failed to fetch')); await first.promise.catch(() => {}); });
    expect(result.current.view).toBe(newer);
    expect(result.current.failure).toBeNull();
  });

  it('reads a 501 not-configured as not-configured, and any other failure as failed', async () => {
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'not-configured' }));
    const unconfigured = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(unconfigured.result.current).toMatchObject({ view: null, failure: 'not-configured' });
    unconfigured.unmount();

    // Two conditions the screen renders differently must not share one value:
    // a 501 carrying another word is not "this box has no control plane".
    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(501, { ok: false, error: 'unsupported' }));
    const other501 = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(other501.result.current).toMatchObject({ view: null, failure: 'failed' });
    other501.unmount();

    vi.spyOn(api, 'updates').mockRejectedValue(new ApiError(404, 'Not Found'));
    const older = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(older.result.current).toMatchObject({ view: null, failure: 'failed' });
  });

  it('keeps the last good view across a failed, a malformed and a 501 poll, and clears the failure on the next good one', async () => {
    vi.useFakeTimers();
    const good = view();
    const fresh = view({ catalogue: { lastOkAt: 9_000, lastError: null } });
    vi.spyOn(api, 'updates')
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ...good, nodes: {} } as unknown as UpdatesView)
      .mockRejectedValueOnce(new ApiError(501, { ok: false, error: 'not-configured' }))
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();

    await tick();
    expect(result.current.view, 'a failed poll never clears the view').toBe(good);
    expect(result.current.failure).toBe('failed');

    await tick();
    expect(result.current.view, 'a malformed answer is a failure, not an empty fleet').toBe(good);
    expect(result.current.failure).toBe('failed');

    await tick();
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBe('not-configured');

    await tick();
    expect(result.current.view).toBe(fresh);
    expect(result.current.failure).toBeNull();
  });

  it('pollMs <= 0 is the injected mode — no request, no interval, no listener, and reload does nothing', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    for (const pollMs of [0, -1]) {
      const { result, unmount } = renderHook(() => useUpdatesView(pollMs));
      setVisibility('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS * 3); });
      act(() => { result.current.reload(); });
      expect(spy, `pollMs ${pollMs}`).not.toHaveBeenCalled();
      expect(result.current.view).toBeNull();
      expect(result.current.failure).toBeNull();
      unmount();
    }
  });

  it('re-polls once when the page becomes visible, and not when it is hidden', async () => {
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    renderHook(() => useUpdatesView());
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);

    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);

    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reload polls once now, lands its answer, and keeps one identity across renders', async () => {
    const fresh = view({ catalogue: { lastOkAt: 3_000, lastError: null } });
    const spy = vi.spyOn(api, 'updates').mockResolvedValueOnce(view()).mockResolvedValueOnce(fresh);
    const { result, rerender } = renderHook(() => useUpdatesView());
    await act(async () => {});
    const reload = result.current.reload;

    await act(async () => { result.current.reload(); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.view).toBe(fresh);

    rerender();
    expect(result.current.reload).toBe(reload);
  });

  it('stops the interval and the visibility listener on unmount', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'updates').mockResolvedValue(view());
    const { unmount } = renderHook(() => useUpdatesView());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(UPDATES_POLL_MS * 2); });
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
