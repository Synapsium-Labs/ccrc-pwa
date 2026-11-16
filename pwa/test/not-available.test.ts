// settingsReadFailure — the one decision, shared by the Settings sections that read a route of their own, of which
// failed read means "not available on this server" (path-identity spec 2026-10-12 §5.7). Only 501 `not-configured`
// and 404 `not-found` qualify, each status with its own code. The stall section's hook now calls this helper, so its
// classification is re-run here, case for case, against the helper's.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, renderHook } from '@testing-library/react';
import { ApiError, api } from '../src/lib/api';
import { settingsReadFailure } from '../src/lib/notAvailable';
import { useStallWatchView } from '../src/fleet/useStallWatchView';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const CASES: Array<[string, unknown, 'not-configured' | 'failed']> = [
  ['501 not-configured', new ApiError(501, { ok: false, error: 'not-configured' }), 'not-configured'],
  ['404 not-found', new ApiError(404, { ok: false, error: 'not-found' }), 'not-configured'],
  ['501 with another code', new ApiError(501, { ok: false, error: 'unsupported' }), 'failed'],
  ['501 carrying the 404 code', new ApiError(501, { ok: false, error: 'not-found' }), 'failed'],
  ['404 carrying the 501 code', new ApiError(404, { ok: false, error: 'not-configured' }), 'failed'],
  ['404 as raw text', new ApiError(404, 'Not Found'), 'failed'],
  ["Fastify's default 404 body",
    new ApiError(404, { message: 'Route GET:/api/coord/collect-lane not found', error: 'Not Found', statusCode: 404 }), 'failed'],
  ['404 with an array body', new ApiError(404, ['not-found']), 'failed'],
  ['500 carrying not-configured', new ApiError(500, { ok: false, error: 'not-configured' }), 'failed'],
  ['503 state-unmeasurable', new ApiError(503, { ok: false, error: 'state-unmeasurable', detail: 'the switch row is absent' }), 'failed'],
  ['a network failure', new TypeError('Failed to fetch'), 'failed'],
  ['a plain Error', new Error('aborted'), 'failed'],
  ['a bare string', 'not-found', 'failed'],
];

describe('one 404/501 decision for Settings reads (path-identity spec §5.7)', () => {
  it('501 not-configured and 404 not-found are not-configured', () => {
    const yes = CASES.filter(([, , want]) => want === 'not-configured');
    expect(yes.map(([name]) => name)).toEqual(['501 not-configured', '404 not-found']);
    for (const [name, err] of yes) expect(settingsReadFailure(err), name).toBe('not-configured');
  });

  it("Fastify's default 404 body, a 500 and a non-ApiError are failed", () => {
    for (const [name, err, want] of CASES.filter(([, , w]) => w === 'failed')) {
      expect(settingsReadFailure(err), name).toBe(want);
    }
  });

  it("the collector's 503 is not this helper's: state-unmeasurable is failed here, and the collector hook reads it", () => {
    expect(settingsReadFailure(new ApiError(503, { ok: false, error: 'state-unmeasurable', detail: 'x' }))).toBe('failed');
    expect(settingsReadFailure(new ApiError(503, { ok: false, error: 'not-configured' }))).toBe('failed');
  });

  it('the stall hook still classifies identically', async () => {
    for (const [name, err, want] of CASES) {
      vi.spyOn(api, 'stallWatch').mockRejectedValue(err);
      const { result, unmount } = renderHook(() => useStallWatchView());
      await act(async () => {});
      expect(result.current.failure, name).toBe(want);
      expect(settingsReadFailure(err), name).toBe(result.current.failure);
      unmount();
      vi.restoreAllMocks();
    }
  });
});
