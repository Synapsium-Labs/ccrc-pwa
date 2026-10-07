// useStallWatchView — the Stall watch section's own read of GET /api/coord/stall-watch (design 2026-10-05 §13),
// modelled on useUpdatesView, and the three pure readers the section shares with it:
//
//  • asStallWatchView: a malformed answer is a FAILURE, never a level. Missing `next`, `filesExceed` or `fallback` read
//    as "not stated" (§12's absence-permits); a malformed `fallback` refuses the answer, because reading it as `null`
//    would claim the choice applies when the server said it does not.
//  • asStallConfirm: the 409 `confirm-required` body, accepted only whole — a sheet built from part of an effect
//    would understate what the write does.
//  • stallWriteRefusal: a write's rejection read as a confirm to show, a refusal with a detail that is never empty, or
//    (a network failure, which may have landed) an unconfirmed write.
//
// The hook adds `settle(view)` to useUpdatesView's shape: a write's reply wins over any poll issued before it (P4).
// Only 501 `not-configured` and 404 `not-found` read as not-configured, each status with its own code (P7).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { StallConfirmRequired, StallWatchEffective, StallWatchView, StallWriteEffect } from '../../shared/api';
import { ApiError, api, createApi } from '../src/lib/api';
import {
  STALL_WATCH_POLL_MS, asStallConfirm, asStallWatchView, stallWriteRefusal, useStallWatchView,
} from '../src/fleet/useStallWatchView';

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

const effective = (over: Record<string, unknown> = {}): StallWatchEffective => ({
  measured: true, level: 'check', files: 'check', source: 'files',
  stages: { runs: true, checks: true, alerts: false, busyDelivery: false, busyGate: true, wave2: false },
  held: { watchOff: false, mailOff: false, gateStrict: false, wave2HeldByStrict: false },
  next: { kind: 'step', level: 'alert', waitsOn: ['alerts'] },
  filesExceed: false,
  ...over,
} as StallWatchEffective);

const view = (over: Partial<StallWatchView> = {}): StallWatchView => ({
  chosen: { level: 'follow', quietMs: 'default', updatedAt: 1_000, stored: 'row' },
  effective: effective(),
  quiet: {
    effectiveMs: 7_200_000, builtInMs: 7_200_000, minMs: 1_800_000, maxMs: 43_200_000, stepMs: 1_800_000,
    source: 'default',
  },
  notices: {
    ok: true, since: 0, windowMs: 172_800_000,
    counts: [
      { row: 'checks', sent: 1, shadow: 2 }, { row: 'wakes', sent: 0, shadow: 0 },
      { row: 'reports', sent: 0, shadow: 3 }, { row: 'pushes', sent: 4, shadow: 0 },
    ],
  },
  fallback: null,
  ...over,
});

const stagesOff = { runs: true, checks: false, alerts: false, busyDelivery: false, busyGate: false, wave2: false };
const effect = (over: Record<string, unknown> = {}): StallWriteEffect => ({
  measured: true, turnsOn: ['checks'], turnsOff: [], leavesWave2: false, heldByBox: false,
  quietLowered: false, filesExceed: false,
  before: stagesOff, after: { ...stagesOff, checks: true },
  quietMs: { before: 7_200_000, after: 7_200_000 }, mailOff: false,
  ...over,
} as StallWriteEffect);

const confirmBody = (over: Record<string, unknown> = {}): StallConfirmRequired => ({
  ok: false, error: 'confirm-required', effect: effect(), effectKey: '0a1b2c3d', ...over,
} as StallConfirmRequired);

/** One poll interval, flushed. */
const tick = async (): Promise<void> => {
  await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS); });
};

describe('api.stallWatch and api.setStallWatch — the two client methods (§13)', () => {
  it('GETs /api/coord/stall-watch and returns the parsed answer', async () => {
    const answer = { ok: true, ...view() };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, answer));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    expect(await client.stallWatch()).toEqual(answer);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/coord/stall-watch');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('POSTs only the given fields as JSON, with no box token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, ...view() }));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    await client.setStallWatch({ level: 'check' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/stall-watch');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ level: 'check' });
    expect(new Headers(init.headers).get('x-ccrc-mail-token')).toBeNull();
  });

  it('answers `unreadable` when a 2xx write comes back unparseable — the write may have landed (D-1150)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.reject(new Error('truncated')), text: () => Promise.resolve(''),
    });
    const client = createApi(fetchImpl as unknown as typeof fetch);
    await expect(client.setStallWatch({ quietMs: 'default' })).resolves.toBe('unreadable');
  });

  it('rejects a 409 with an ApiError carrying the confirm body, which stallWriteRefusal reads', async () => {
    const body = confirmBody();
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, body));
    const client = createApi(fetchImpl as unknown as typeof fetch);
    const err = await client.setStallWatch({ level: 'alert' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual(body);
    expect(stallWriteRefusal(err)).toEqual({ kind: 'confirm', confirm: body });
  });
});

describe('asStallWatchView — a malformed answer is a failure, never a level', () => {
  it('passes a well-formed answer through as the same object: measured, unmeasured, counts failed, a fallback stated', () => {
    for (const v of [
      view(),
      { ok: true, ...view() },
      view({ effective: { measured: false } }),
      view({ notices: { ok: false } }),
      view({ fallback: { at: 5, reason: 'resolver threw' } }),
      view({ chosen: { level: 'unreadable', quietMs: 'unreadable', updatedAt: null, stored: 'absent' } }),
      view({ chosen: { level: 'all', quietMs: 3_600_000, updatedAt: 9, stored: 'row' } }),
      view({ effective: effective({ level: 'custom', next: { kind: 'none' } }) }),
      view({ effective: effective({ level: 'all', next: { kind: 'top' } }) }),
    ]) {
      expect(asStallWatchView(v), JSON.stringify(v)).toBe(v);
    }
  });

  it('refuses a non-object, and every missing or malformed required part', () => {
    for (const raw of [null, undefined, 'x', 7, [], {}]) {
      expect(asStallWatchView(raw), JSON.stringify(raw)).toBeNull();
    }
    const v = view();
    const cases: Array<[string, unknown]> = [
      ['chosen absent', { ...v, chosen: undefined }],
      ['chosen.level not a choice', { ...v, chosen: { ...v.chosen, level: 'loud' } }],
      ['chosen.level inherited name', { ...v, chosen: { ...v.chosen, level: 'toString' } }],
      ['chosen.quietMs a string', { ...v, chosen: { ...v.chosen, quietMs: '3600000' } }],
      ['chosen.quietMs NaN', { ...v, chosen: { ...v.chosen, quietMs: Number.NaN } }],
      ['chosen.updatedAt absent', { ...v, chosen: { ...v.chosen, updatedAt: undefined } }],
      ['chosen.stored unknown', { ...v, chosen: { ...v.chosen, stored: 'gone' } }],
      ['effective absent', { ...v, effective: undefined }],
      ['effective.measured absent', { ...v, effective: { ...effective(), measured: undefined } }],
      ['effective.level unknown', { ...v, effective: effective({ level: 'loud' }) }],
      ['effective.files unknown', { ...v, effective: effective({ files: 7 }) }],
      ['effective.source unknown', { ...v, effective: effective({ source: 'box' }) }],
      ['effective.stages missing a stage', { ...v, effective: effective({ stages: { runs: true, checks: true } }) }],
      ['effective.stages a non-boolean', { ...v, effective: effective({ stages: { ...stagesOff, wave2: 'no' } }) }],
      ['effective.held missing a flag', { ...v, effective: effective({ held: { watchOff: false } }) }],
      ['quiet absent', { ...v, quiet: undefined }],
      ['quiet.builtInMs absent', { ...v, quiet: { ...v.quiet, builtInMs: undefined } }],
      ['quiet.stepMs zero', { ...v, quiet: { ...v.quiet, stepMs: 0 } }],
      ['quiet.stepMs negative', { ...v, quiet: { ...v.quiet, stepMs: -1_800_000 } }],
      ['quiet.minMs above maxMs', { ...v, quiet: { ...v.quiet, minMs: 50_000_000 } }],
      ['quiet steps past any list', { ...v, quiet: { ...v.quiet, stepMs: 1 } }],
      ['quiet.source unknown', { ...v, quiet: { ...v.quiet, source: 'files' } }],
      ['notices absent', { ...v, notices: undefined }],
      ['notices.ok absent', { ...v, notices: { since: 0, windowMs: 1, counts: [] } }],
      ['notices.counts not an array', { ...v, notices: { ok: true, since: 0, windowMs: 1, counts: {} } }],
      ['notices.windowMs absent', { ...v, notices: { ok: true, since: 0, counts: [] } }],
      ['notices.since absent', { ...v, notices: { ok: true, windowMs: 1, counts: [] } }],
    ];
    for (const [name, raw] of cases) expect(asStallWatchView(raw), name).toBeNull();
  });

  it('reads a MISSING fallback as none stated, with no warning; refuses a MALFORMED one', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { fallback: _f, ...noFallback } = view();
    void _f;
    expect(asStallWatchView(noFallback)).toEqual({ ...noFallback, fallback: null });
    expect(warn).not.toHaveBeenCalled();
    for (const bad of [{}, { at: 5 }, { reason: 'x' }, { at: '5', reason: 'x' }, 'resolver threw', 0]) {
      expect(asStallWatchView({ ...view(), fallback: bad }), JSON.stringify(bad)).toBeNull();
    }
  });

  it('reads a missing next or filesExceed as not stated, passing the answer through unchanged', () => {
    const { next: _n, filesExceed: _x, ...bare } = effective() as Extract<StallWatchEffective, { measured: true }>;
    void _n; void _x;
    const v = view({ effective: bare });
    expect(asStallWatchView(v)).toBe(v);
  });

  it('drops a malformed next or filesExceed as not stated, keeps the rest, and warns exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const next of [{ kind: 'jump' }, { kind: 'step', level: 'loud', waitsOn: [] },
      { kind: 'step', level: 'alert', waitsOn: ['alerts', 'runs'] }, { kind: 'step', level: 'alert' }, null]) {
      warn.mockClear();
      const got = asStallWatchView(view({ effective: effective({ next, filesExceed: 'yes' }) }));
      expect(got, JSON.stringify(next)).not.toBeNull();
      expect(got!.effective).not.toHaveProperty('next');
      expect(got!.effective).not.toHaveProperty('filesExceed');
      expect(got!.effective).toMatchObject({ measured: true, level: 'check', source: 'files' });
      expect(warn).toHaveBeenCalledTimes(1);
    }
  });

  it('drops a malformed counts element, keeps the others, and warns exactly once', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const good = view();
    const counts = (good.notices as Extract<StallWatchView['notices'], { ok: true }>).counts;
    const got = asStallWatchView({
      ...good,
      notices: {
        ok: true, since: 0, windowMs: 172_800_000,
        counts: [null, { row: 'toString', sent: 1, shadow: 1 }, { row: 'checks', sent: -1, shadow: 0 },
          { row: 'wakes', sent: 1.5, shadow: 0 }, { row: 'reports', sent: 0 }, ...counts],
      },
    });
    expect(got).not.toBeNull();
    expect(got!.notices).toEqual({ ok: true, since: 0, windowMs: 172_800_000, counts });
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('asStallConfirm — the 409 body, accepted only whole', () => {
  it('accepts a confirm-required body with a readable effect, measured or not', () => {
    const a = confirmBody();
    expect(asStallConfirm(a)).toBe(a);
    const b = confirmBody({ effect: { measured: false } });
    expect(asStallConfirm(b)).toBe(b);
    const c = confirmBody({ effect: effect({ turnsOn: [], turnsOff: ['busyDelivery', 'wave2'], leavesWave2: true }) });
    expect(asStallConfirm(c)).toBe(c);
  });

  it('refuses another code, a missing or non-string key, and any effect it cannot read whole', () => {
    const cases: Array<[string, unknown]> = [
      ['not an object', 'confirm-required'],
      ['another code', confirmBody({ error: 'bad-request' })],
      ['no key', confirmBody({ effectKey: undefined })],
      ['a numeric key', confirmBody({ effectKey: 12 })],
      ['no effect', confirmBody({ effect: undefined })],
      ['effect.measured absent', confirmBody({ effect: { ...effect(), measured: undefined } })],
      ['an unknown stage turning on', confirmBody({ effect: effect({ turnsOn: ['checks', 'runs'] }) })],
      ['turnsOff not an array', confirmBody({ effect: effect({ turnsOff: 'wave2' }) })],
      ['leavesWave2 absent', confirmBody({ effect: effect({ leavesWave2: undefined }) })],
      ['heldByBox absent', confirmBody({ effect: effect({ heldByBox: undefined }) })],
      ['quietLowered absent', confirmBody({ effect: effect({ quietLowered: undefined }) })],
      ['filesExceed absent', confirmBody({ effect: effect({ filesExceed: undefined }) })],
      ['before missing a stage', confirmBody({ effect: effect({ before: { runs: true } }) })],
      ['after missing a stage', confirmBody({ effect: effect({ after: { runs: true } }) })],
      ['quietMs.before absent', confirmBody({ effect: effect({ quietMs: { after: 1 } }) })],
      ['quietMs.after absent', confirmBody({ effect: effect({ quietMs: { before: 1 } }) })],
      ['mailOff absent', confirmBody({ effect: effect({ mailOff: undefined }) })],
    ];
    for (const [name, raw] of cases) expect(asStallConfirm(raw), name).toBeNull();
  });
});

describe('stallWriteRefusal — a confirm to show, a refusal whose detail is never empty, or an unconfirmed write', () => {
  it('reads a 409 with a readable confirm body as a confirm', () => {
    const body = confirmBody();
    expect(stallWriteRefusal(new ApiError(409, body))).toEqual({ kind: 'confirm', confirm: body });
  });

  it('reads a confirm body on any other status as a refusal: the status and the code must both match', () => {
    expect(stallWriteRefusal(new ApiError(400, confirmBody()))).toEqual({ kind: 'refused', detail: 'confirm-required' });
  });

  it('reads a 409 whose body is not a readable confirm as a refusal that still names something', () => {
    expect(stallWriteRefusal(new ApiError(409, confirmBody({ effectKey: undefined }))))
      .toEqual({ kind: 'refused', detail: 'confirm-required' });
  });

  it("takes the server's detail when it sends one", () => {
    const err = new ApiError(400, { ok: false, error: 'bad-request', detail: 'unknown key: loudness' });
    expect(stallWriteRefusal(err)).toEqual({ kind: 'refused', detail: 'unknown key: loudness' });
  });

  it("takes Fastify's message when the body has no detail: a 500 names the cause the route threw", () => {
    const cause = 'stall settings unreadable, nothing written: disk gone';
    const fastify500 = new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: cause });
    expect(stallWriteRefusal(fastify500)).toEqual({ kind: 'refused', detail: cause });
    const both = new ApiError(400, { ok: false, error: 'bad-request', detail: 'unknown key: loudness', message: 'other' });
    expect(stallWriteRefusal(both)).toEqual({ kind: 'refused', detail: 'unknown key: loudness' });
  });

  it("falls back to the error's own text when the body has neither: a blank detail or message, raw text", () => {
    const bare500 = new ApiError(500, { statusCode: 500, error: 'Internal Server Error', message: '  ' });
    expect(stallWriteRefusal(bare500)).toEqual({ kind: 'refused', detail: 'Internal Server Error' });
    const blank = new ApiError(400, { ok: false, error: 'bad-request', detail: '   ' });
    expect(stallWriteRefusal(blank)).toEqual({ kind: 'refused', detail: 'bad-request' });
    expect(stallWriteRefusal(new ApiError(502, 'Bad Gateway'))).toEqual({ kind: 'refused', detail: 'request failed (502)' });
  });

  it('never leaves the refusal detail blank: a body whose only text is empty or whitespace names the HTTP status', () => {
    expect(stallWriteRefusal(new ApiError(400, { error: '' })), 'an empty error code').toEqual({ kind: 'refused', detail: 'HTTP 400' });
    expect(stallWriteRefusal(new ApiError(503, { error: '   ' })), 'a whitespace-only error code').toEqual({ kind: 'refused', detail: 'HTTP 503' });
    expect(stallWriteRefusal(new ApiError(422, { error: '', detail: '', message: ' ' })), 'every slot blank')
      .toEqual({ kind: 'refused', detail: 'HTTP 422' });
  });

  it('reads a rejection that is not an ApiError as unconfirmed, never a refusal: the POST may have landed', () => {
    expect(stallWriteRefusal(new TypeError('Failed to fetch'))).toEqual({ kind: 'unconfirmed' });
    expect(stallWriteRefusal(new Error('aborted'))).toEqual({ kind: 'unconfirmed' });
  });
});

describe('useStallWatchView — the section\'s own read of /api/coord/stall-watch', () => {
  it('polls at mount and then every STALL_WATCH_POLL_MS (60 s, the stall sweep\'s cadence)', async () => {
    expect(STALL_WATCH_POLL_MS).toBe(60_000);
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    renderHook(() => useStallWatchView());
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS - 1); });
    expect(spy).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('starts with nothing, then carries the first good answer; it has no refresh()', async () => {
    const good = view();
    vi.spyOn(api, 'stallWatch').mockResolvedValue(good);
    const { result } = renderHook(() => useStallWatchView());
    expect(result.current.view).toBeNull();
    expect(result.current.failure).toBeNull();
    expect(Object.keys(result.current).sort()).toEqual(['failure', 'reload', 'settle', 'view']);
    await act(async () => {});
    expect(result.current.view).toBe(good);
    expect(result.current.failure).toBeNull();
  });

  it('keeps the newest issued poll authoritative when an older request resolves or rejects last', async () => {
    vi.useFakeTimers();
    const first = Promise.withResolvers<StallWatchView>();
    const second = Promise.withResolvers<StallWatchView>();
    const newer = view({ chosen: { level: 'log', quietMs: 'default', updatedAt: 2_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch')
      .mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockResolvedValueOnce(newer);

    const { result } = renderHook(() => useStallWatchView());
    await tick();
    await tick();
    expect(result.current.view).toBe(newer);

    await act(async () => { first.resolve(view()); await first.promise; });
    expect(result.current.view).toBe(newer);
    await act(async () => { second.reject(new TypeError('Failed to fetch')); await second.promise.catch(() => {}); });
    expect(result.current.view).toBe(newer);
    expect(result.current.failure).toBeNull();
  });

  it('P7: reads only 501 not-configured and 404 not-found as not-configured; every other pairing is failed', async () => {
    const cases: Array<[ApiError | TypeError, 'not-configured' | 'failed']> = [
      [new ApiError(501, { ok: false, error: 'not-configured' }), 'not-configured'],
      [new ApiError(404, { ok: false, error: 'not-found' }), 'not-configured'],
      [new ApiError(501, { ok: false, error: 'unsupported' }), 'failed'],
      [new ApiError(501, { ok: false, error: 'not-found' }), 'failed'],
      [new ApiError(404, { ok: false, error: 'not-configured' }), 'failed'],
      [new ApiError(404, 'Not Found'), 'failed'],
      [new ApiError(404, { message: 'Route GET:/api/coord/stall-watch not found', error: 'Not Found', statusCode: 404 }), 'failed'],
      [new ApiError(500, { ok: false, error: 'not-configured' }), 'failed'],
      [new TypeError('Failed to fetch'), 'failed'],
    ];
    for (const [err, want] of cases) {
      vi.spyOn(api, 'stallWatch').mockRejectedValue(err);
      const { result, unmount } = renderHook(() => useStallWatchView());
      await act(async () => {});
      expect(result.current, `${err instanceof ApiError ? err.status : 'network'} ${JSON.stringify((err as ApiError).body)}`)
        .toMatchObject({ view: null, failure: want });
      unmount();
      vi.restoreAllMocks();
    }
  });

  it('keeps the last good view across a failed, a malformed and a not-configured poll, and clears the failure on the next good one', async () => {
    vi.useFakeTimers();
    const good = view();
    const fresh = view({ chosen: { level: 'check', quietMs: 'default', updatedAt: 9_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch')
      .mockResolvedValueOnce(good)
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ...good, quiet: {} } as unknown as StallWatchView)
      .mockRejectedValueOnce(new ApiError(404, { ok: false, error: 'not-found' }))
      .mockResolvedValueOnce(fresh);

    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(result.current).toMatchObject({ view: good, failure: null });
    await tick();
    expect(result.current).toMatchObject({ view: good, failure: 'failed' });
    await tick();
    expect(result.current.view, 'a malformed answer is a failure, not a level').toBe(good);
    expect(result.current.failure).toBe('failed');
    await tick();
    expect(result.current.view, 'the hook keeps it; the section decides not-configured wins (P1b)').toBe(good);
    expect(result.current.failure).toBe('not-configured');
    await tick();
    expect(result.current).toMatchObject({ view: fresh, failure: null });
  });

  it('P4: settle installs a write\'s reply, and a poll issued before it that lands after it never overwrites it', async () => {
    const stale = Promise.withResolvers<StallWatchView>();
    const before = view();
    const written = view({ chosen: { level: 'alert', quietMs: 'default', updatedAt: 5_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch').mockResolvedValueOnce(before).mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(result.current.view).toBe(before);

    act(() => { result.current.reload(); });          // a poll in flight when the write's reply arrives
    act(() => { result.current.settle(written); });
    expect(result.current).toMatchObject({ view: written, failure: null });

    await act(async () => { stale.resolve(before); await stale.promise; });
    expect(result.current.view, 'the stale poll lands after the write and is dropped').toBe(written);
  });

  it('P4: a poll issued before settle that REJECTS after it reports no failure, and settle clears an earlier one', async () => {
    vi.useFakeTimers();
    const stale = Promise.withResolvers<StallWatchView>();
    const written = view({ chosen: { level: 'off', quietMs: 'default', updatedAt: 6_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch')
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockReturnValueOnce(stale.promise);
    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(result.current).toMatchObject({ view: null, failure: 'failed' });

    await tick();                                       // the second poll is now in flight
    act(() => { result.current.settle(written); });
    expect(result.current).toMatchObject({ view: written, failure: null });

    await act(async () => { stale.reject(new ApiError(404, { ok: false, error: 'not-found' })); await stale.promise.catch(() => {}); });
    expect(result.current).toMatchObject({ view: written, failure: null });
  });

  it('a poll issued AFTER settle lands normally — settle moves the generation on, it does not stop it', async () => {
    vi.useFakeTimers();
    const written = view({ chosen: { level: 'alert', quietMs: 'default', updatedAt: 5_000, stored: 'row' } });
    const later = view({ chosen: { level: 'alert', quietMs: 3_600_000, updatedAt: 7_000, stored: 'row' } });
    vi.spyOn(api, 'stallWatch').mockResolvedValueOnce(view()).mockResolvedValueOnce(later);
    const { result } = renderHook(() => useStallWatchView());
    await act(async () => {});
    act(() => { result.current.settle(written); });
    await tick();
    expect(result.current).toMatchObject({ view: later, failure: null });
  });

  it('pollMs <= 0 is the injected mode — no request, no interval, no listener, reload does nothing, settle still installs', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    for (const pollMs of [0, -1]) {
      const { result, unmount } = renderHook(() => useStallWatchView(pollMs));
      setVisibility('visible');
      act(() => { document.dispatchEvent(new Event('visibilitychange')); });
      await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS * 3); });
      act(() => { result.current.reload(); });
      expect(spy, `pollMs ${pollMs}`).not.toHaveBeenCalled();
      expect(result.current).toMatchObject({ view: null, failure: null });
      const written = view();
      act(() => { result.current.settle(written); });
      expect(result.current.view).toBe(written);
      unmount();
    }
  });

  it('re-polls once when the page becomes visible, and not when it is hidden', async () => {
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    renderHook(() => useStallWatchView());
    await act(async () => {});
    expect(spy).toHaveBeenCalledTimes(1);
    setVisibility('hidden');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(1);
    setVisibility('visible');
    await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reload polls once now and lands its answer; reload and settle keep one identity across renders', async () => {
    const fresh = view({ chosen: { level: 'log', quietMs: 'default', updatedAt: 3_000, stored: 'row' } });
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValueOnce(view()).mockResolvedValueOnce(fresh);
    const { result, rerender } = renderHook(() => useStallWatchView());
    await act(async () => {});
    const { reload, settle } = result.current;
    await act(async () => { result.current.reload(); });
    expect(spy).toHaveBeenCalledTimes(2);
    expect(result.current.view).toBe(fresh);
    rerender();
    expect(result.current.reload).toBe(reload);
    expect(result.current.settle).toBe(settle);
  });

  it('stops the interval and the visibility listener on unmount', async () => {
    vi.useFakeTimers();
    const spy = vi.spyOn(api, 'stallWatch').mockResolvedValue(view());
    const { unmount } = renderHook(() => useStallWatchView());
    expect(spy).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(STALL_WATCH_POLL_MS * 2); });
    setVisibility('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
