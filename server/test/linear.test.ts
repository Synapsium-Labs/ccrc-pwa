// The first third-party lookup in the tree. Two properties matter more than
// the happy path: it carries a deadline (an outbound call a phone is waiting
// on), and every failure is its own condition the caller can act on.
import { describe, it, expect, vi } from 'vitest';
import {
  LINEAR_API, LINEAR_FAILURES, lookupLinearIssue, ticketTitle, type FetchLike,
} from '../src/linear.js';
import { parseLinearRef } from '../src/slug.js';

const REF = parseLinearRef('ENG-1234')!;

const okBody = (identifier: string, title: string) => ({
  ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }),
});

/** Records the one call it is given, so the header can be asserted exactly. */
const spyFetch = (answer: Awaited<ReturnType<FetchLike>>) => {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => { calls.push({ url, init }); return answer; };
  return { f, calls };
};

describe('lookupLinearIssue', () => {
  it('returns the ticket’s own identifier casing and its title', async () => {
    const { f } = spyFetch(okBody('ENG-1234', 'Fix the login flow'));
    await expect(lookupLinearIssue(REF, 'lin_api_x', { fetch: f }))
      .resolves.toEqual({ ok: true, identifier: 'ENG-1234', title: 'Fix the login flow' });
  });

  it('sends the personal key with NO Bearer prefix', async () => {
    // THE SLIP THIS EXISTS TO CATCH. Linear takes a personal API key as the
    // bare Authorization value; only OAuth access tokens use `Bearer`. Adding
    // it "for correctness" produces a 401 that looks like a bad key, so the
    // header is pinned exactly rather than loosely.
    const { f, calls } = spyFetch(okBody('ENG-1234', 'T'));
    await lookupLinearIssue(REF, 'lin_api_x', { fetch: f });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(LINEAR_API);
    expect(calls[0]!.init.headers['authorization']).toBe('lin_api_x');
    expect(calls[0]!.init.headers['authorization']).not.toMatch(/^Bearer/i);
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('asks for the issue by its HUMAN identifier, which is the same key the parse produced', async () => {
    // No id-translation step to get wrong: `issue(id:)` accepts `ENG-1234`.
    const { f, calls } = spyFetch(okBody('ENG-1234', 'T'));
    await lookupLinearIssue(REF, 'k', { fetch: f });
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ variables: { id: 'ENG-1234' } });
  });

  it('falls back to the identifier we asked for when Linear echoes none', async () => {
    const { f } = spyFetch({ ok: true, status: 200, json: async () => ({ data: { issue: { title: 'T' } } }) });
    await expect(lookupLinearIssue(REF, 'k', { fetch: f }))
      .resolves.toEqual({ ok: true, identifier: 'ENG-1234', title: 'T' });
  });

  // ── EVERY FAILURE ITS OWN CONDITION ──
  // Asserted one by one, because the operator does something different about
  // each: "paste your key" vs "check the ticket number" vs "try again".
  it('answers not-configured WITHOUT calling, when no token is set', async () => {
    const { f, calls } = spyFetch(okBody('ENG-1234', 'T'));
    await expect(lookupLinearIssue(REF, null, { fetch: f }))
      .resolves.toEqual({ ok: false, reason: 'not-configured' });
    await expect(lookupLinearIssue(REF, '', { fetch: f }))
      .resolves.toEqual({ ok: false, reason: 'not-configured' });
    // The half that matters: an unconfigured box makes no outbound call at all.
    expect(calls, 'an unconfigured box must not reach the network').toHaveLength(0);
  });

  it('answers unauthorised for 401 and 403', async () => {
    for (const status of [401, 403]) {
      const { f } = spyFetch({ ok: false, status, json: async () => ({}) });
      await expect(lookupLinearIssue(REF, 'k', { fetch: f }))
        .resolves.toEqual({ ok: false, reason: 'unauthorised' });
    }
  });

  it('answers not-found when the issue is null — a 200, not an error', async () => {
    // GraphQL's shape: a missing issue is a successful response carrying null.
    const { f } = spyFetch({ ok: true, status: 200, json: async () => ({ data: { issue: null } }) });
    await expect(lookupLinearIssue(REF, 'k', { fetch: f }))
      .resolves.toEqual({ ok: false, reason: 'not-found' });
  });

  it('answers not-found for an issue with no usable title', async () => {
    const { f } = spyFetch({ ok: true, status: 200, json: async () => ({ data: { issue: { title: '   ' } } }) });
    await expect(lookupLinearIssue(REF, 'k', { fetch: f }))
      .resolves.toEqual({ ok: false, reason: 'not-found' });
  });

  it('answers unreachable for a GraphQL errors array, which arrives as a 200', async () => {
    const { f } = spyFetch({
      ok: true, status: 200,
      json: async () => ({ data: { issue: null }, errors: [{ message: 'rate limited' }] }),
    });
    await expect(lookupLinearIssue(REF, 'k', { fetch: f }))
      .resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  it('answers unreachable for a 500 and for a rejected connection', async () => {
    const { f } = spyFetch({ ok: false, status: 500, json: async () => ({}) });
    await expect(lookupLinearIssue(REF, 'k', { fetch: f }))
      .resolves.toEqual({ ok: false, reason: 'unreachable' });

    const dead: FetchLike = async () => { throw Object.assign(new Error('ENOTFOUND'), { name: 'TypeError' }); };
    await expect(lookupLinearIssue(REF, 'k', { fetch: dead }))
      .resolves.toEqual({ ok: false, reason: 'unreachable' });
  });

  // ── THE DEADLINE ──
  it('aborts on the deadline and calls it a timeout, distinctly from unreachable', async () => {
    // Without the AbortSignal this hangs forever and a Linear outage wedges a
    // request the phone is waiting on. Delete the abort and this test does not
    // fail — it never finishes, which vitest reports as a timeout. That is the
    // honest shape of the guard: its absence is a hang, not a wrong answer.
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    await expect(lookupLinearIssue(REF, 'k', { fetch: hang, timeoutMs: 20 }))
      .resolves.toEqual({ ok: false, reason: 'timeout' });
  });

  it('never throws — every arm resolves, because a lookup must not block the create', async () => {
    const throwing: FetchLike = async () => { throw new Error('boom'); };
    const badJson: FetchLike = async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad'); } });
    for (const f of [throwing, badJson]) {
      const r = await lookupLinearIssue(REF, 'k', { fetch: f });
      expect(r.ok).toBe(false);
    }
  });

  it('clears its timer, so a fast answer leaves no handle behind', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { f } = spyFetch(okBody('ENG-1234', 'T'));
    await lookupLinearIssue(REF, 'k', { fetch: f });
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  it('the failure list is the type, not a second copy', () => {
    expect(new Set(LINEAR_FAILURES).size).toBe(LINEAR_FAILURES.length);
    expect(LINEAR_FAILURES).toContain('not-configured');
  });
});

describe('ticketTitle', () => {
  it('is the operator’s requested [TICKET] - {title} format, in one place', () => {
    expect(ticketTitle('ENG-1234', 'Fix the login flow')).toBe('ENG-1234 - Fix the login flow');
  });
});
