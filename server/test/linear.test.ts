// The Linear client (S4 of the named-workspaces plan): the first third-party
// lookup in the tree. Two properties matter more than the happy path: it
// carries a deadline (an outbound call a phone is waiting on), and every
// failure is its own condition the caller can act on. No test here reaches the
// network — every case hands the client a `fetch` stand-in.
//
// The API origin and path are two constants and are never written joined, in
// source, comments or tests: `topology-clean.test.ts` bans that shape in every
// tracked file and in every blob the branch adds.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LINEAR_API_ORIGIN, LINEAR_API_PATH, LINEAR_TIMEOUT_MS,
  lookupLinearIssue, verifyLinearKey, type FetchLike, type LinearLookup,
} from '../src/linear/client.js';
import { LINEAR_KEY_FILE, linearKeyPath, readLinearKey, type LinearKeyRead } from '../src/linear/connection.js';
import { ticketTitle } from '../src/linear/title.js';
import { valueDigestHex } from '../src/token/files.js';
import { PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { LINEAR_FAILURES } from '../../shared/linear.js';
import { WS_TITLE_MAX_BYTES } from '../../shared/slug.js';
import { mkTmp, removeTmpFixturesEachTest } from './tmpHelpers.js';

removeTmpFixturesEachTest();
afterEach(() => { vi.useRealTimers(); });

const here = path.dirname(fileURLToPath(import.meta.url));
const REF = { key: 'ENG', num: '1234' };
const KEY = 'lin_api_fixturekey';
const HAVE_KEY: LinearKeyRead = { kind: 'key', key: KEY };
const bytes = (s: string): number => new TextEncoder().encode(s).length;

type Answer = Awaited<ReturnType<FetchLike>>;
const okBody = (identifier: string, title: string): Answer => ({
  ok: true, status: 200, json: async () => ({ data: { issue: { identifier, title } } }),
});
const bodyOf = (v: unknown, status = 200): Answer => ({ ok: status < 400, status, json: async () => v });

/** Records the calls it is given, so the header can be asserted exactly. */
const spyFetch = (answer: Answer): { f: FetchLike; calls: { url: string; init: Parameters<FetchLike>[1] }[] } => {
  const calls: { url: string; init: Parameters<FetchLike>[1] }[] = [];
  const f: FetchLike = async (url, init) => { calls.push({ url, init }); return answer; };
  return { f, calls };
};
const failureOf = (r: LinearLookup): string => (r.ok ? 'ok' : r.reason);

describe('lookupLinearIssue', () => {
  it('returns the ticket’s own identifier casing and its title', async () => {
    const { f } = spyFetch(okBody('ENG-1234', 'Fix the login flow'));
    const r = await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
    expect(r).toEqual({ ok: true, identifier: 'ENG-1234', title: 'Fix the login flow', keyDigest: valueDigestHex(KEY) });
  });

  it('sends the personal key with NO Bearer prefix', async () => {
    // THE SLIP THIS EXISTS TO CATCH. Linear takes a personal API key as the
    // bare Authorization value; only OAuth access tokens use `Bearer`. Adding
    // it "for correctness" produces a 401 that looks like a bad key, so the
    // header is pinned exactly rather than loosely.
    const { f, calls } = spyFetch(okBody('ENG-1234', 'T'));
    await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${LINEAR_API_ORIGIN}${LINEAR_API_PATH}`);
    expect(calls[0]!.init.headers['authorization']).toBe(KEY);
    expect(calls[0]!.init.headers['authorization']).not.toMatch(/^Bearer/i);
    expect(calls[0]!.init.method).toBe('POST');
  });

  it('asks for the issue by its HUMAN identifier, the same key the parse produced', async () => {
    const { f, calls } = spyFetch(okBody('ENG-1234', 'T'));
    await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ variables: { id: 'ENG-1234' } });
  });

  it('falls back to the identifier we asked for, upper-cased, when Linear echoes none or a malformed one', async () => {
    for (const echoed of [undefined, '', 'not an identifier', 'ENG-1234\nINJECTED']) {
      const { f } = spyFetch(bodyOf({ data: { issue: { identifier: echoed, title: 'T' } } }));
      const r = await lookupLinearIssue({ key: 'eng', num: '1234' }, HAVE_KEY, { fetch: f });
      expect(r, String(echoed)).toMatchObject({ ok: true, identifier: 'ENG-1234', title: 'T' });
    }
  });

  // ── EVERY FAILURE ITS OWN CONDITION ──
  it('answers not-configured WITHOUT calling, and keeps the four unusable key reads apart', async () => {
    const reads: [LinearKeyRead, string][] = [
      [{ kind: 'absent' }, 'absent'],
      [{ kind: 'unreadable', code: 'EACCES' }, 'unreadable'],
      [{ kind: 'unusable' }, 'unusable'],
      [{ kind: 'placeholder' }, 'placeholder'],
    ];
    for (const [read, why] of reads) {
      const { f, calls } = spyFetch(okBody('ENG-1234', 'T'));
      await expect(lookupLinearIssue(REF, read, { fetch: f }))
        .resolves.toEqual({ ok: false, reason: 'not-configured', key: why });
      // The half that matters: a box with no usable key makes no outbound call at all.
      expect(calls, `${why} must not reach the network`).toHaveLength(0);
    }
  });

  it('answers unauthorised for a 401 and forbidden for a 403, each with the digest of the key it used (never the key)', async () => {
    // Spec 5.1: only a 401 says the key is bad. A 403 is Linear refusing THIS request (a scope, a team the key cannot
    // see), so it is its own word and the one place a caller decides what to condemn reads the two apart.
    for (const [status, reason] of [[401, 'unauthorised'], [403, 'forbidden']] as const) {
      const { f } = spyFetch(bodyOf({}, status));
      const r = await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
      expect(r).toEqual({ ok: false, reason, keyDigest: valueDigestHex(KEY) });
      expect(JSON.stringify(r)).not.toContain(KEY);
    }
  });

  it('answers not-found when the issue is null — a 200, not an error', async () => {
    const { f } = spyFetch(bodyOf({ data: { issue: null } }));
    await expect(lookupLinearIssue(REF, HAVE_KEY, { fetch: f }))
      .resolves.toMatchObject({ ok: false, reason: 'not-found' });
  });

  it('answers not-found for a title that is blank once sanitised — nothing to name it with', async () => {
    for (const title of ['   ', '\t\n', '\u0000\u0007']) {
      const { f } = spyFetch(okBody('ENG-1234', title));
      await expect(lookupLinearIssue(REF, HAVE_KEY, { fetch: f }), JSON.stringify(title))
        .resolves.toMatchObject({ ok: false, reason: 'not-found' });
    }
  });

  it('answers malformed for a 200 that is not the shape asked for, one case at a time', async () => {
    const shapes: [string, Answer][] = [
      ['json() throws', { ok: true, status: 200, json: async () => { throw new Error('bad'); } }],
      ['body is a string', bodyOf('nope')],
      ['body is null', bodyOf(null)],
      ['body is an array', bodyOf([])],
      ['no data', bodyOf({})],
      ['data is not an object', bodyOf({ data: 3 })],
      ['no issue key', bodyOf({ data: {} })],
      ['issue is not an object', bodyOf({ data: { issue: 'ENG-1234' } })],
      ['title is not a string', bodyOf({ data: { issue: { identifier: 'ENG-1234', title: 42 } } })],
      ['title is absent', bodyOf({ data: { issue: { identifier: 'ENG-1234' } } })],
    ];
    for (const [what, answer] of shapes) {
      const { f } = spyFetch(answer);
      expect(failureOf(await lookupLinearIssue(REF, HAVE_KEY, { fetch: f })), what).toBe('malformed');
    }
  });

  it('answers unreachable for a 500, a 429, a rejected connection and a GraphQL errors array', async () => {
    for (const status of [500, 429, 503]) {
      const { f } = spyFetch(bodyOf({}, status));
      expect(failureOf(await lookupLinearIssue(REF, HAVE_KEY, { fetch: f })), String(status)).toBe('unreachable');
    }
    const dead: FetchLike = async () => { throw Object.assign(new Error('ENOTFOUND'), { name: 'TypeError' }); };
    expect(failureOf(await lookupLinearIssue(REF, HAVE_KEY, { fetch: dead }))).toBe('unreachable');
    const { f } = spyFetch(bodyOf({ data: { issue: null }, errors: [{ message: 'rate limited' }] }));
    expect(failureOf(await lookupLinearIssue(REF, HAVE_KEY, { fetch: f }))).toBe('unreachable');
  });

  it('puts no response text in any failure it reports', async () => {
    const LEAK = 'LINEAR-SAYS-SECRET-TEXT';
    const bodies = [
      bodyOf({ data: { issue: null }, errors: [{ message: LEAK }] }),
      bodyOf({ message: LEAK }, 401),
      bodyOf({ message: LEAK }, 500),
      bodyOf({ data: { issue: { title: 42, note: LEAK } } }),
    ];
    for (const b of bodies) {
      const { f } = spyFetch(b);
      expect(JSON.stringify(await lookupLinearIssue(REF, HAVE_KEY, { fetch: f }))).not.toContain(LEAK);
    }
  });

  // ── THE DEADLINE ──
  it('is eight seconds, and the abort fires at the deadline and not before', async () => {
    expect(LINEAR_TIMEOUT_MS).toBe(8_000);
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => {
      signal = init.signal;
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    const p = lookupLinearIssue(REF, HAVE_KEY, { fetch: hang });
    await vi.advanceTimersByTimeAsync(LINEAR_TIMEOUT_MS - 1);
    expect(signal?.aborted, 'aborted before the deadline').toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(signal?.aborted, 'never aborted at the deadline').toBe(true);
    await expect(p).resolves.toMatchObject({ ok: false, reason: 'timeout' });
  });

  it('calls a deadline that fires while the body is being read a timeout, not malformed', async () => {
    let signal: AbortSignal | undefined;
    const slowBody: FetchLike = async (_u, init) => {
      signal = init.signal;
      return {
        ok: true, status: 200,
        json: () => new Promise((_res, rej) => {
          init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
        }),
      };
    };
    await expect(lookupLinearIssue(REF, HAVE_KEY, { fetch: slowBody, timeoutMs: 20 }))
      .resolves.toMatchObject({ ok: false, reason: 'timeout' });
    expect(signal?.aborted).toBe(true);
  });

  it('never throws — every arm resolves, because a lookup must not block the create', async () => {
    const throwing: FetchLike = async () => { throw new Error('boom'); };
    const r = await lookupLinearIssue(REF, HAVE_KEY, { fetch: throwing });
    expect(r.ok).toBe(false);
  });

  it('clears its timer, so a fast answer leaves no handle behind', async () => {
    const clear = vi.spyOn(globalThis, 'clearTimeout');
    const { f } = spyFetch(okBody('ENG-1234', 'T'));
    await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
    expect(clear).toHaveBeenCalled();
    clear.mockRestore();
  });

  // ── THE TITLE ──
  it('sanitises the title it returns: a tab or newline is a space, and ccd will not refuse it', async () => {
    const { f } = spyFetch(okBody('ENG-1234', '  Fix\tthe\nlogin\r\nflow\u0000 '));
    const r = await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
    expect(r).toMatchObject({ ok: true, title: 'Fix the login flow' });
  });

  it('shortens a title over the cap and never refuses it', async () => {
    const { f } = spyFetch(okBody('ENG-1234', 'word '.repeat(300)));
    const r = await lookupLinearIssue(REF, HAVE_KEY, { fetch: f });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(bytes(r.title)).toBeLessThanOrEqual(WS_TITLE_MAX_BYTES);
      expect(r.title.endsWith('…')).toBe(true);
    }
  });

  it('the failure list is the type, not a second copy, and names every arm', () => {
    expect(new Set(LINEAR_FAILURES).size).toBe(LINEAR_FAILURES.length);
    expect([...LINEAR_FAILURES].sort())
      .toEqual(['forbidden', 'malformed', 'not-configured', 'not-found', 'timeout', 'unauthorised', 'unreachable']);
  });
});

describe('ticketTitle', () => {
  it('is the operator\u2019s requested [TICKET] - {title} format, in one place', () => {
    expect(ticketTitle('ENG-1234', 'Fix the login flow')).toBe('ENG-1234 - Fix the login flow');
  });
});

describe('readLinearKey', () => {
  const dirWith = (content: string | null): string => {
    const d = mkTmp('ccrc-linear-');
    if (content !== null) writeFileSync(path.join(d, LINEAR_KEY_FILE), content, { mode: 0o600 });
    return d;
  };

  it('lives in the ccrc dir, under one file name', () => {
    expect(linearKeyPath('/x/.ccrc')).toBe(path.join('/x/.ccrc', 'linear.key'));
  });

  it('reads a key, taking the first value line like the box token does', async () => {
    const r = await readLinearKey(dirWith(`# my key\n  ${KEY}  \nsecond-line\n`));
    expect(r).toEqual({ kind: 'key', key: KEY });
  });

  it('answers absent for a proven ENOENT', async () => {
    expect(await readLinearKey(dirWith(null))).toEqual({ kind: 'absent' });
  });

  it('answers unusable for a file with no value line', async () => {
    expect(await readLinearKey(dirWith('# nothing here\n\n'))).toEqual({ kind: 'unusable' });
    expect(await readLinearKey(dirWith(''))).toEqual({ kind: 'unusable' });
  });

  it('answers placeholder for the committed example value', async () => {
    expect(await readLinearKey(dirWith(`${PLACEHOLDER_TOKEN}\n`))).toEqual({ kind: 'placeholder' });
  });

  it('answers unreadable, with the errno word, for a path that exists but cannot be read — never absent', async () => {
    const d = mkTmp('ccrc-linear-');
    mkdirSync(path.join(d, LINEAR_KEY_FILE));   // a directory: lstat succeeds, the read fails EISDIR
    expect(await readLinearKey(d)).toEqual({ kind: 'unreadable', code: 'EISDIR' });
  });

  it('never returns the file metadata, only the vocabulary the callers need', async () => {
    const r = await readLinearKey(dirWith(`${KEY}\n`));
    expect(Object.keys(r).sort()).toEqual(['key', 'kind']);
  });
});

describe('verifyLinearKey', () => {
  const viewer = (v: unknown): Answer => bodyOf(v);
  const GOOD = viewer({ data: { viewer: { name: 'user-a' }, organization: { name: 'team-a' } } });

  it('names the user and the organisation, and carries the digest of the key it asked with', async () => {
    const { f } = spyFetch(GOOD);
    expect(await verifyLinearKey(KEY, { fetch: f })).toEqual({ ok: true, org: 'team-a', user: 'user-a', keyDigest: valueDigestHex(KEY) });
  });

  it('sends the bare key (no Bearer) to the one endpoint, with the viewer query and a signal', async () => {
    const { f, calls } = spyFetch(GOOD);
    await verifyLinearKey(KEY, { fetch: f });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${LINEAR_API_ORIGIN}${LINEAR_API_PATH}`);
    expect(calls[0]!.init.headers['authorization']).toBe(KEY);
    expect(calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(calls[0]!.init.body)).toMatchObject({ query: expect.stringContaining('viewer') });
  });

  it('carries the deadline: a hung call is a timeout, in well under it', async () => {
    const hang: FetchLike = (_u, init) => new Promise((_res, rej) => {
      init.signal.addEventListener('abort', () => rej(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    });
    expect(await verifyLinearKey(KEY, { fetch: hang, timeoutMs: 15 })).toEqual({ ok: false, reason: 'timeout', keyDigest: valueDigestHex(KEY) });
  });

  it('each failure is its own word, and every one carries the digest', async () => {
    const cases: [Answer | (() => Promise<Answer>), string][] = [
      [bodyOf({}, 401), 'unauthorised'],
      [bodyOf({}, 403), 'forbidden'],
      [bodyOf({}, 500), 'unreachable'],
      [bodyOf({}, 429), 'unreachable'],
      [async () => { throw new Error('ECONNREFUSED'); }, 'unreachable'],
      [viewer({ errors: [{ message: 'x' }] }), 'unreachable'],
      [viewer('nope'), 'malformed'],
      [viewer({ data: {} }), 'malformed'],
      [viewer({ data: { viewer: { name: 'u' }, organization: {} } }), 'malformed'],
      [viewer({ data: { viewer: { name: '\u0001\u0002' }, organization: { name: 'o' } } }), 'malformed'],
      [{ ok: true, status: 200, json: async () => { throw new SyntaxError('bad json'); } }, 'malformed'],
    ];
    for (const [ans, word] of cases) {
      const f: FetchLike = async () => (typeof ans === 'function' ? ans() : ans);
      expect(await verifyLinearKey(KEY, { fetch: f }), word).toEqual({ ok: false, reason: word, keyDigest: valueDigestHex(KEY) });
    }
  });

  it('cleans and bounds the names, and never copies the rest of the answer', async () => {
    const { f } = spyFetch(viewer({ data: { viewer: { name: `a\tb${'x'.repeat(300)}`, email: 'leak@example.invalid' }, organization: { name: ' team-a\n' } } }));
    const r = await verifyLinearKey(KEY, { fetch: f });
    expect(r.ok && r.org).toBe('team-a');
    expect(r.ok && [...r.user].length).toBe(80);
    expect(JSON.stringify(r)).not.toContain('leak@');
  });

  it('shares the lookup\'s one fetch path: client.ts has exactly one call to the network', () => {
    const text = readFileSync(path.resolve(here, '..', 'src', 'linear', 'client.ts'), 'utf8');
    expect(text.match(/\bdoFetch\(/g)).toHaveLength(1);
    expect(text.match(/\bfetch\(url, init\)/g)).toHaveLength(1);
  });
});

describe('the key has one source', () => {
  it('no file in server/src/linear reads the environment', () => {
    const dir = path.resolve(here, '..', 'src', 'linear');
    const files = readdirSync(dir).filter((f) => f.endsWith('.ts'));
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(path.join(dir, f), 'utf8');
      expect(text, `${f} reads process.env`).not.toMatch(/process\.env/);
    }
  });
});
