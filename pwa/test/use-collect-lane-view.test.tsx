// useCollectLaneView — the Temp root collector section's own read of GET /api/coord/collect-lane (path-identity spec
// 2026-10-12 §5.6, §5.7), its two client methods, and the readers the section shares with it:
//
//  • asCollectLaneView: a view the section cannot render WHOLE is a failure, never a state. Nothing is dropped and
//    nothing is defaulted: a section built from part of a safety view would understate a stop.
//  • asCollectLaneConfirm: the 409 body, confirm-required or confirm-stale, accepted only whole.
//  • collectLanePostRefusal: a write's rejection read as a confirm, a refusal whose detail is never blank, or an
//    unconfirmed write (a network failure, which may have landed).
//
// The hook drops a landed view when the server answers that the switch is not available (404/501, the shared helper)
// or cannot be measured (503 state-unmeasurable). A read that did not land keeps the last good view.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { COLLECT_LANE_REFUSALS, type CollectLaneConfirmRequired, type CollectLaneView } from '../../shared/api';
import { ApiError, api, createApi } from '../src/lib/api';
import { settingsReadFailure } from '../src/lib/notAvailable';
import {
  COLLECT_LANE_POLL_MS, asCollectLaneConfirm, asCollectLaneView, collectLanePostRefusal, useCollectLaneView,
} from '../src/fleet/useCollectLaneView';

const setVisibility = (v: DocumentVisibilityState): void => {
  Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
});

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const view = (over: Partial<CollectLaneView> = {}): CollectLaneView => ({
  stored: { read: 'row', choice: 'live', fleetNodeId: 'node-a', markerRetiredAt: null, generation: 1, updatedAt: 1_000 },
  journal: { read: 'ok', max: 1 },
  control: { state: 'coherent', bootstrap: false },
  effective: { state: 'live', armedBy: 'both' },
  marker: { listing: 'stands', latch: 'unset' },
  node: { state: 'known', nodeId: 'node-a', measuredAt: 5_000, stored: 'this' },
  caps: { collect: true, reclaimPause: true },
  attention: { wouldCollect: 2, held: 1, boxLines: 0 },
  remedy: null,
  notice: null,
  ...over,
});

const confirmBody = (over: Record<string, unknown> = {}): CollectLaneConfirmRequired => ({
  ok: false,
  error: 'confirm-required',
  confirmKey: '0a1b2c3d',
  facts: {
    node: { nodeId: 'node-a', measuredAt: 5_000 },
    caps: { collect: true, reclaimPause: true },
    paused: false,
    marker: 'stands',
    repair: null,
    attention: { wouldCollect: 2, held: 1, boxLines: 0 },
  },
  ...over,
} as CollectLaneConfirmRequired);

const withFacts = (over: Record<string, unknown>): CollectLaneConfirmRequired =>
  confirmBody({ facts: { ...confirmBody().facts, ...over } });

/** One poll interval, flushed. */
const tick = async (): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(COLLECT_LANE_POLL_MS); });
};

describe('api.collectLane and api.setCollectLane (path-identity spec §5.6)', () => {
  it("GET's URL with no init", async () => {
    const answer = view();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, answer));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    expect(await client.collectLane()).toEqual(answer);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/coord/collect-lane');
    expect(init).toBeUndefined();
  });

  it("POST's method, headers and exact body, with no mail-token header", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, view()));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    await client.setCollectLane({ choice: 'live', confirm: '0a1b2c3d' });
    await client.setCollectLane({ choice: 'off' });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const first = fetchImpl.mock.calls[0] as [string, RequestInit];
    const second = fetchImpl.mock.calls[1] as [string, RequestInit];
    for (const [url, init] of [first, second]) {
      expect(url).toBe('/api/coord/collect-lane');
      expect(init.method).toBe('POST');
      const headers = new Headers(init.headers);
      expect(headers.get('content-type')).toBe('application/json');
      expect(headers.get('accept')).toBe('application/json');
      expect(headers.get('x-ccrc-mail-token')).toBeNull();
    }
    expect(JSON.parse(first[1].body as string)).toEqual({ choice: 'live', confirm: '0a1b2c3d' });
    expect(JSON.parse(second[1].body as string)).toEqual({ choice: 'off' });
  });

  it("a truncated 2xx is 'unreadable': the write may have landed", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.reject(new Error('truncated')), text: () => Promise.resolve(''),
    });
    const client = createApi(fetchImpl as unknown as typeof fetch);
    await expect(client.setCollectLane({ choice: 'off' })).resolves.toBe('unreadable');
  });

  it('a 409 rejects with its body, which collectLanePostRefusal reads as a confirm', async () => {
    const body = confirmBody();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, body));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    const err = await client.setCollectLane({ choice: 'live' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual(body);
    expect(collectLanePostRefusal(err)).toEqual({ kind: 'confirm', confirm: body });
  });
});

describe('the readers refuse rather than fold (path-identity spec §5.6)', () => {
  it('each well-formed view passes as the same object', () => {
    const others = (['shadowed', 'paused', 'safety-stopped', 'not-running', 'unknown-fleet'] as const)
      .map((state) => view({ effective: { state, armedBy: 'neither' } }));
    const cases: unknown[] = [
      view(),
      { ok: true, ...view() },
      view({ stored: { read: 'malformed' } }),
      view({ stored: { read: 'unreadable' } }),
      view({ stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: 1_700_000_000_000, generation: 4, updatedAt: 9 } }),
      view({ journal: { read: 'missing' } }),
      view({ journal: { read: 'malformed' } }),
      view({ journal: { read: 'unreadable' } }),
      view({ journal: { read: 'not-regular' } }),
      view({ control: { state: 'coherent', bootstrap: true } }),
      view({ control: { state: 'mismatch', journal: 'ahead' } }),
      view({ control: { state: 'mismatch', journal: 'behind' } }),
      view({ control: { state: 'unmeasurable' } }),
      ...others,
      view({ effective: { state: 'live', armedBy: 'settings' } }),
      view({ effective: { state: 'live', armedBy: 'legacy-marker' } }),
      view({ marker: { listing: 'absent', latch: 'set' } }),
      view({ marker: { listing: 'unmeasured', latch: 'unmeasured' } }),
      view({ node: { state: 'known', nodeId: 'node-b', measuredAt: 9_000, stored: 'other' } }),
      view({ node: { state: 'known', nodeId: 'node-a', measuredAt: 5_000, stored: 'none' } }),
      view({ node: { state: 'known', nodeId: 'node-a', measuredAt: 5_000, stored: 'unread' } }),
      view({ node: { state: 'unmeasured', stored: 'set' } }),
      view({ node: { state: 'unmeasured', stored: 'none' } }),
      view({ node: { state: 'collision', stored: 'unread' } }),
      view({ caps: { collect: false, reclaimPause: true } }),
      view({ attention: null }),
      view({ remedy: 'Raise the cleanup pause, then confirm Live again.', notice: 'The choice applies from the next check.' }),
    ];
    for (const v of cases) expect(asCollectLaneView(v), JSON.stringify(v)).toBe(v);
  });

  it("an unknown state, 'toString', a negative count, known with no nodeId, or a non-string remedy refuses the whole view", () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      expect(asCollectLaneView(raw), JSON.stringify(raw)).toBeNull();
    }
    const v = view();
    const cases: Array<[string, unknown]> = [
      ['an unknown effective state', { ...v, effective: { state: 'stopped', armedBy: 'neither' } }],
      ["'toString' as the effective state", { ...v, effective: { state: 'toString', armedBy: 'neither' } }],
      ["'toString' as the arming source", { ...v, effective: { state: 'live', armedBy: 'toString' } }],
      ['live armed by neither', { ...v, effective: { state: 'live', armedBy: 'neither' } }],
      ['shadowed armed by settings', { ...v, effective: { state: 'shadowed', armedBy: 'settings' } }],
      ['a negative held count', { ...v, attention: { wouldCollect: 1, held: -1, boxLines: 0 } }],
      ['a fractional count', { ...v, attention: { wouldCollect: 1.5, held: 0, boxLines: 0 } }],
      ['attention missing a count', { ...v, attention: { wouldCollect: 1, held: 0 } }],
      ['known with no nodeId', { ...v, node: { state: 'known', measuredAt: 5_000, stored: 'this' } }],
      ['known with an empty nodeId', { ...v, node: { state: 'known', nodeId: '', measuredAt: 5_000, stored: 'this' } }],
      ['known with no measuredAt', { ...v, node: { state: 'known', nodeId: 'node-a', stored: 'this' } }],
      ["known with the unknown arm's stored word", { ...v, node: { state: 'known', nodeId: 'node-a', measuredAt: 5_000, stored: 'set' } }],
      ["unmeasured with the known arm's stored word", { ...v, node: { state: 'unmeasured', stored: 'other' } }],
      ['an unknown node state', { ...v, node: { state: 'unknown', stored: 'none' } }],
      ['a non-string remedy', { ...v, remedy: 5 }],
      ['a missing remedy', { ...v, remedy: undefined }],
      ['a non-string notice', { ...v, notice: false }],
      ['a stored absent, which the route answers 503 for', { ...v, stored: { read: 'absent' } }],
      ['a stored row with a non-string choice', { ...v, stored: { ...v.stored, choice: 1 } }],
      ['a stored row with an empty node', { ...v, stored: { ...v.stored, fleetNodeId: '' } }],
      ['a stored row with a zero latch', { ...v, stored: { ...v.stored, markerRetiredAt: 0 } }],
      ['a stored row with a negative generation', { ...v, stored: { ...v.stored, generation: -1 } }],
      ['a stored row with no updatedAt', { ...v, stored: { ...v.stored, updatedAt: undefined } }],
      ['an unknown journal read', { ...v, journal: { read: 'gone' } }],
      ['an ok journal with no max', { ...v, journal: { read: 'ok' } }],
      ['a coherent control with no bootstrap flag', { ...v, control: { state: 'coherent' } }],
      ['a mismatch with no side', { ...v, control: { state: 'mismatch' } }],
      ['an unknown marker listing', { ...v, marker: { listing: 'gone', latch: 'unset' } }],
      ['a boolean latch', { ...v, marker: { listing: 'stands', latch: true } }],
      ['caps null', { ...v, caps: null }],
      ['a non-boolean capability', { ...v, caps: { collect: 'yes', reclaimPause: true } }],
    ];
    for (const [name, raw] of cases) expect(asCollectLaneView(raw), name).toBeNull();
  });

  it("a raw stored 'shadowed' passes: any stored token reads, and arms nothing", () => {
    for (const choice of ['shadowed', 'LIVE', 'toString', '']) {
      const v = view({
        stored: { read: 'row', choice, fleetNodeId: null, markerRetiredAt: null, generation: 1, updatedAt: 1 },
        effective: { state: 'shadowed', armedBy: 'neither' },
      });
      expect(asCollectLaneView(v), choice).toBe(v);
    }
  });

  it('confirm-required and confirm-stale with whole facts are confirm; partial facts are refused', () => {
    const accepted = [
      confirmBody(),
      confirmBody({ error: 'confirm-stale', confirmKey: 'ffffffff' }),
      withFacts({ repair: 'journal-ahead', attention: null, paused: true, marker: 'absent' }),
      withFacts({ repair: 'journal-behind', caps: { collect: false, reclaimPause: false } }),
    ];
    for (const body of accepted) {
      expect(asCollectLaneConfirm(body), JSON.stringify(body)).toBe(body);
      expect(collectLanePostRefusal(new ApiError(409, body))).toEqual({ kind: 'confirm', confirm: body });
    }
    const refused: Array<[string, unknown]> = [
      ['not an object', 'confirm-required'],
      ['another code', confirmBody({ error: 'conflict' })],
      ['ok true', confirmBody({ ok: true })],
      ['no key', confirmBody({ confirmKey: undefined })],
      ['an uppercase key', confirmBody({ confirmKey: '0A1B2C3D' })],
      ['a 7-character key', confirmBody({ confirmKey: '0a1b2c3' })],
      ['a 9-character key', confirmBody({ confirmKey: '0a1b2c3d4' })],
      ['a numeric key', confirmBody({ confirmKey: 12345678 })],
      ['no facts', confirmBody({ facts: undefined })],
      ['a node with no id', withFacts({ node: { measuredAt: 5_000 } })],
      ['a node with an empty id', withFacts({ node: { nodeId: '', measuredAt: 5_000 } })],
      ['a node measured at a string', withFacts({ node: { nodeId: 'node-a', measuredAt: '5000' } })],
      ['caps missing reclaimPause', withFacts({ caps: { collect: true } })],
      ['no pause fact', withFacts({ paused: undefined })],
      ['an unmeasured marker', withFacts({ marker: 'unmeasured' })],
      ['an unknown repair', withFacts({ repair: 'ahead' })],
      ['a negative count', withFacts({ attention: { wouldCollect: -1, held: 0, boxLines: 0 } })],
    ];
    for (const [name, raw] of refused) {
      expect(asCollectLaneConfirm(raw), name).toBeNull();
      expect(collectLanePostRefusal(new ApiError(409, raw)).kind, name).toBe('refused');
    }
  });

  it('a TypeError is unconfirmed', () => {
    expect(collectLanePostRefusal(new TypeError('Failed to fetch'))).toEqual({ kind: 'unconfirmed' });
    expect(collectLanePostRefusal(new Error('aborted'))).toEqual({ kind: 'unconfirmed' });
  });

  it("a refusal carries L0's code when the server sent one, and a detail that is never blank", () => {
    for (const code of COLLECT_LANE_REFUSALS) {
      const got = collectLanePostRefusal(new ApiError(400, { ok: false, error: code, detail: `because ${code}` }));
      expect(got, code).toEqual({ kind: 'refused', code, detail: `because ${code}` });
    }
    expect(collectLanePostRefusal(new ApiError(409, { ok: false, error: 'marker-still-controls' })))
      .toEqual({ kind: 'refused', code: 'marker-still-controls', detail: 'marker-still-controls' });
    expect(collectLanePostRefusal(new ApiError(400, { ok: false, error: 'toString', detail: 'x' })))
      .toEqual({ kind: 'refused', code: null, detail: 'x' });
    expect(collectLanePostRefusal(new ApiError(503, { error: '' })))
      .toEqual({ kind: 'refused', code: null, detail: 'HTTP 503' });
    expect(collectLanePostRefusal(new ApiError(502, 'Bad Gateway')))
      .toEqual({ kind: 'refused', code: null, detail: 'request failed (502)' });
  });
});

describe("useCollectLaneView — the section's own read (path-identity spec §5.6, §5.7)", () => {
  it('polls at mount and then every COLLECT_LANE_POLL_MS (60 s)', async () => {
    expect(COLLECT_LANE_POLL_MS).toBe(60_000);
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'collectLane').mockResolvedValue(view());
    renderHook(() => useCollectLaneView());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(COLLECT_LANE_POLL_MS - 1); });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('404 or 501 is not-configured, replacing a landed view', async () => {
    vi.useFakeTimers();
    for (const err of [new ApiError(404, { ok: false, error: 'not-found' }), new ApiError(501, { ok: false, error: 'not-configured' })]) {
      const landed = view();
      vi.spyOn(api, 'collectLane').mockResolvedValueOnce(landed).mockRejectedValueOnce(err);
      const { result, unmount } = renderHook(() => useCollectLaneView());
      await act(async () => {});
      expect(result.current.view).toBe(landed);
      expect(result.current.failure).toBeNull();
      await tick();
      expect(result.current.view, `${err.status}: a landed Live view never outlives a not-available answer`).toBeNull();
      expect(result.current.failure).toEqual({ kind: 'not-configured' });
      unmount();
      vi.restoreAllMocks();
    }
  });

  it("a 503 {error:'state-unmeasurable', detail} is its own failure, with its detail, replacing a landed view", async () => {
    vi.useFakeTimers();
    const landed = view();
    const fresh = view({ attention: null });
    vi.spyOn(api, 'collectLane')
      .mockResolvedValueOnce(landed)
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'state-unmeasurable', detail: 'the switch row is absent' }))
      .mockRejectedValueOnce(new ApiError(503, { ok: false, error: 'state-unmeasurable' }))
      .mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useCollectLaneView());
    await act(async () => {});
    expect(result.current.view).toBe(landed);
    await tick();
    expect(result.current.view).toBeNull();
    expect(result.current.failure).toEqual({ kind: 'state-unmeasurable', detail: 'the switch row is absent' });
    await tick();
    expect(result.current.failure, 'no detail: the code names it, never a blank')
      .toEqual({ kind: 'state-unmeasurable', detail: 'state-unmeasurable' });
    await tick();
    expect(result.current.view).toBe(fresh);
    expect(result.current.failure).toBeNull();
  });

  it('a 503 without that error, and any other failure, is failed; the shared helper is unchanged', async () => {
    const cases: unknown[] = [
      new ApiError(503, { ok: false, error: 'write-failed', detail: 'x' }),
      new ApiError(503, 'Service Unavailable'),
      new ApiError(500, { ok: false, error: 'state-unmeasurable' }),
      new ApiError(404, { message: 'Route GET:/api/coord/collect-lane not found', error: 'Not Found', statusCode: 404 }),
      new TypeError('Failed to fetch'),
    ];
    for (const err of cases) {
      vi.spyOn(api, 'collectLane').mockRejectedValue(err);
      const { result, unmount } = renderHook(() => useCollectLaneView());
      await act(async () => {});
      expect(result.current.view, String(err)).toBeNull();
      expect(result.current.failure, String(err)).toEqual({ kind: 'failed' });
      unmount();
      vi.restoreAllMocks();
    }
    expect(settingsReadFailure(new ApiError(503, { ok: false, error: 'state-unmeasurable', detail: 'x' }))).toBe('failed');
  });

  it('the last good view survives a failed read', async () => {
    vi.useFakeTimers();
    const good = view();
    const fresh = view({ attention: { wouldCollect: 0, held: 0, boxLines: 1 } });
    vi.spyOn(api, 'collectLane')
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ...good, caps: null } as unknown as CollectLaneView)
      .mockResolvedValueOnce(fresh);
    const { result } = renderHook(() => useCollectLaneView());
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();
    await tick();
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toEqual({ kind: 'failed' });
    await tick();
    expect(result.current.view, 'a view it cannot read whole is a failure, not a state').toBe(good);
    expect(result.current.failure).toEqual({ kind: 'failed' });
    await tick();
    expect(result.current.view).toBe(fresh);
    expect(result.current.failure).toBeNull();
  });

  it('settle beats an older in-flight poll', async () => {
    const stale = Promise.withResolvers<CollectLaneView>();
    const before = view();
    const written = view({
      stored: { read: 'row', choice: 'off', fleetNodeId: null, markerRetiredAt: 7, generation: 2, updatedAt: 9 },
      effective: { state: 'shadowed', armedBy: 'neither' },
    });
    vi.spyOn(api, 'collectLane').mockResolvedValueOnce(before).mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useCollectLaneView());
    await act(async () => {});
    expect(result.current.view).toBe(before);
    act(() => { result.current.reload(); });          // a poll in flight when the write's reply arrives
    act(() => { result.current.settle(written); });
    expect(result.current.view).toBe(written);
    expect(result.current.failure).toBeNull();
    await act(async () => { stale.resolve(before); await stale.promise; });
    expect(result.current.view, 'the stale poll lands after the write and is dropped').toBe(written);
  });

  it('pollMs <= 0 is the injected mode — no request, no interval, no listener; settle still installs', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'collectLane').mockResolvedValue(view());
    for (const pollMs of [0, -1]) {
      const { result, unmount } = renderHook(() => useCollectLaneView(pollMs));
      setVisibility('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(COLLECT_LANE_POLL_MS * 3); });
      act(() => { result.current.reload(); });
      expect(spy, `pollMs ${pollMs}`).not.toHaveBeenCalled();
      expect(result.current.view).toBeNull();
      expect(result.current.failure).toBeNull();
      const written = view();
      act(() => { result.current.settle(written); });
      expect(result.current.view).toBe(written);
      unmount();
    }
  });

  it('re-polls once when the page becomes visible, and not when it is hidden', async () => {
    const spy = vi.spyOn(api, 'collectLane').mockResolvedValue(view());
    renderHook(() => useCollectLaneView());
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
