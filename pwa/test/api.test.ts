import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, apiErrorText, clipUrl, createApi, sendErrorText, uploadErrorText, UNSUPPORTED_VERB_TEXT } from '../src/lib/api';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('api client', () => {
  // Task 8: DELETE /api/sessions/:id/workspace is gone, and so is this method.
  // A mutation sweep found that restoring workspaceRemove (and the `del`
  // helper it needs) in isolation — without touching SessionActionsSheet's
  // button — compiles clean and leaves every other test green, because
  // nothing else in the client ever called it. This pins the client shape
  // directly so that gap can't reopen unnoticed.
  it('has no workspaceRemove — the route it called no longer exists', () => {
    const api = createApi();
    expect('workspaceRemove' in api).toBe(false);
  });

  it('prompt posts a JSON body to /api/sessions/:id/prompt', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.prompt('x', 'ship it', { replaceDraft: true });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/x/prompt');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ text: 'ship it', replaceDraft: true });
  });

  it('prompt omits replaceDraft from the body when not passed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.prompt('x', 'hello');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ text: 'hello' });
  });

  it('prompt throws ApiError with the parsed body on 409', async () => {
    const draftBody = { ok: false, error: 'draft-present', draft: 'half-typed thought' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, draftBody));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.prompt('x', 'new text').then(
      () => { throw new Error('expected prompt to reject'); },
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(ApiError);
    const apiErr = err as ApiError;
    expect(apiErr.status).toBe(409);
    expect(apiErr.body).toEqual(draftBody);
  });
});

describe('the Build 9 read fetchers', () => {
  it('lifecycle GETs /api/lifecycle with the session encoded and limit only when given', async () => {
    // A fresh Response per call — these tests make several calls through one
    // mock, and a Response body reads once.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, { events: [], gaps: [] }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.lifecycle('claude:a b');
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/lifecycle?session=claude%3Aa%20b');
    await api.lifecycle('x', 50);
    expect(fetchImpl.mock.calls[1]![0]).toBe('/api/lifecycle?session=x&limit=50');
  });

  it('claims GETs the live set by default and ?all=1 only on request', async () => {
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, { claims: [] }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.claims();
    expect(fetchImpl.mock.calls[0]![0]).toBe('/api/claims');
    await api.claims({ all: true });
    expect(fetchImpl.mock.calls[1]![0]).toBe('/api/claims?all=1');
    // `all: false` and an absent opts send the byte-identical request — the
    // `archive({force})` rule one screen over.
    await api.claims({ all: false });
    expect(fetchImpl.mock.calls[2]![0]).toBe('/api/claims');
  });
});

// PR-I reconciliation item 5: `GET /api/runs` defaults to active-only
// (`includeClosed: false`), and the archive view is `?closed=1`. Without a
// parameter on the client method there is no data path to the archive at
// all — the board's "split on closedAt" contract has nothing to split.
describe('runs (active vs archive)', () => {
  it('defaults to the active set — no query string at all', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { runs: [] }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.runs();

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('/api/runs');
  });

  it('passing true reads the archive via ?closed=1', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { runs: [] }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.runs(true);

    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('/api/runs?closed=1');
  });
});

describe('attachments', () => {
  it('returns where an upload landed', async () => {
    const clip = { path: '/home/u/.cc-clips/s/clip-1-a1b2.png', name: 'clip-1-a1b2.png', bytes: 9 };
    const fetchImpl = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true, clip }), { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.upload('s', new File(['x'], 'a.png', { type: 'image/png' }))).resolves.toEqual(clip);
  });

  it('posts attachments alongside the text', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.prompt('s', 'hi', { attachments: ['/home/u/.cc-clips/s/clip-1-a1b2.png'] });
    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      text: 'hi', attachments: ['/home/u/.cc-clips/s/clip-1-a1b2.png'],
    });
  });

  it('builds an origin-qualified clip URL — a bare path breaks openExternal', () => {
    expect(clipUrl('claude2-Proj', 'clip-1-a1b2.png'))
      .toBe(`${location.origin}/api/sessions/claude2-Proj/clip/clip-1-a1b2.png`);
  });
});

describe('PR lifecycle (Task 13)', () => {
  it('pr GETs /api/sessions/:id/pr and returns the parsed PrView', async () => {
    const view = { pr: { phase: 'none' }, draft: null, facts: null };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, view));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.pr('demo-quiet-basin')).resolves.toEqual(view);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(url).toBe('/api/sessions/demo-quiet-basin/pr');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('prOpen POSTs the draft as JSON to /api/sessions/:id/pr', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.prOpen('demo-quiet-basin', { title: 't', body: 'b', draft: true });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/demo-quiet-basin/pr');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ title: 't', body: 'b', draft: true });
  });

  it('archive POSTs to /api/sessions/:id/archive with no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.archive('demo-quiet-basin');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/demo-quiet-basin/archive');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  // Task 211 — `{force:true}` is a SECOND tap made after reading the `409
  // run-open` refusal, never a flag the first call carries. These three pin
  // that the unforced call is byte-identical to what shipped (the route has
  // always taken a bodyless POST, and every caller but the conflict sheet
  // still sends one) and that only a literal `true` changes the wire.
  it('archive(id) posts NO body — byte-identical to what shipped', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x');
    expect(calls[0]![0]).toBe('/api/sessions/demo-x/archive');
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });

  it('archive(id, {force:true}) posts {force:true} as JSON', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x', { force: true });
    expect(calls[0]![1]).toMatchObject({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ force: true }),
    });
  });

  it('archive(id, {force:false}) is the UNFORCED call — never a body that says no', async () => {
    const calls: [string, RequestInit | undefined][] = [];
    const a = createApi(async (u, init) => { calls.push([String(u), init]); return new Response('', { status: 200 }); });
    await a.archive('demo-x', { force: false });
    expect(calls[0]![1]).toEqual({ method: 'POST' });
  });

  it('restore POSTs to /api/sessions/:id/restore with no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.restore('demo-quiet-basin');

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/demo-quiet-basin/restore');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('workspaceAudit GETs /api/sessions/:id/workspace/audit and returns the parsed WsAudit', async () => {
    const audit = { id: 'demo-quiet-basin', verdict: 'reapable', sentence: '', token: 'a'.repeat(64) };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, audit));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.workspaceAudit('demo-quiet-basin')).resolves.toEqual(audit);
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('/api/sessions/demo-quiet-basin/workspace/audit');
  });

  it('workspaceReap POSTs the expect token to /api/sessions/:id/workspace/reap and returns the parsed ReapResult', async () => {
    const result = { refused: 'state-changed', sentence: 'This workspace changed since the list you were shown — nothing was removed.' };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, result));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await expect(api.workspaceReap('demo-quiet-basin', 'a'.repeat(64))).resolves.toEqual(result);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/demo-quiet-basin/workspace/reap');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ expect: 'a'.repeat(64) });
  });

  it('workspaceReap throws ApiError on a non-2xx response — e.g. the 400 for a malformed expect token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { ok: false, error: 'bad-request' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.workspaceReap('demo-quiet-basin', 'nope').then(
      () => { throw new Error('expected workspaceReap to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});

// Task 11 review, Important 2: `CoordBanner` always takes its `coordPause`
// prop INJECTED in `coord-banner.test.tsx`, so the real `api.coordPause`
// method — the one every shipped tap of the button actually calls — was
// exercised by nothing anywhere in the suite. This pins its URL and body in
// the same idiom every other write above already uses (`prompt`, `prOpen`,
// `workspaceReap`), so a change to the path or the body key ships as a red
// test rather than a live 400 the first time someone taps Pause.
describe('coordPause (Task 11, spec §4.2)', () => {
  it('POSTs {paused} as JSON to /api/coord/pause', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, requested: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.coordPause(true);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/pause');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ paused: true });
  });

  it('carries paused:false for a resume, the same route, no separate verb', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, requested: false }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.coordPause(false);

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/pause');
    expect(JSON.parse(init.body as string)).toEqual({ paused: false });
  });

  it('throws ApiError on a non-2xx response — e.g. the 501 an old ccd answers', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(501, { ok: false, error: 'unsupported' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.coordPause(true).then(
      () => { throw new Error('expected coordPause to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(501);
  });
});

// Task 12 review lesson (Task 11's own review, applied ahead of time):
// `AbandonSheet` always takes its `abandonRun` prop INJECTED in
// `abandon-sheet.test.tsx`'s copy/refusal cases, so the real `api.abandonRun`
// — the one the production sheet's default prop value actually calls — needs
// its own pin here, same idiom as `coordPause` just above (`archive`/
// `restore`'s own "no body" idiom too: the server route reads no body at
// all, D-280 (was D-B4-7)).
describe('abandonRun (Task 12, spec §4.3)', () => {
  it('POSTs to /api/runs/:id/abandon with no body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, id: 3, state: 'failed' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.abandonRun(3);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/runs/3/abandon');
    expect(init.method).toBe('POST');
    expect(init.body).toBeUndefined();
  });

  it('abandonRun reads `released` off the 200 body, and absence degrades to true', async () => {
    const a = createApi(async () =>
      new Response(JSON.stringify({ ok: true, id: 3, state: 'failed', released: false }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    expect(await a.abandonRun(3)).toEqual({ released: false });

    const older = createApi(async () =>
      new Response(JSON.stringify({ ok: true, id: 3, state: 'failed' }),
        { status: 200, headers: { 'content-type': 'application/json' } }));
    // An older server never sends the field: absence reads TRUE — today's
    // behaviour, no toast, the safe direction.
    expect(await older.abandonRun(3)).toEqual({ released: true });
  });

  it('throws ApiError on a non-2xx response — e.g. the 409 bad-transition for an already-closed run', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(409, { ok: false, error: 'bad-transition', from: 'done', to: 'failed' }),
    );
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.abandonRun(3).then(
      () => { throw new Error('expected abandonRun to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual({ ok: false, error: 'bad-transition', from: 'done', to: 'failed' });
  });
});

// program-leverage wave 4 (F4). The sheet's kickoff prop is injected in
// `start-program.test.tsx`'s cases, so the real client method — the one the
// production sheet's default prop actually calls — is pinned here, exactly as
// `createSession` below it is and for the same reason.
describe('kickoff (program-leverage wave 4)', () => {
  it('POSTs {slug, title} to /api/sessions/:id/kickoff', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, queued: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.kickoff('claude-ccrc-pwa', { slug: 'build9-demo', title: 'Build 9 demo' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions/claude-ccrc-pwa/kickoff');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ slug: 'build9-demo', title: 'Build 9 demo' });
  });

  it('sends NO prose — the server composes the sentence from the L0 constant', () => {
    // The route is narrower than `POST /api/sessions/:id/prompt` on purpose: it
    // can queue a program kickoff and nothing else. A `text` or `body` key here
    // would hand that narrowing back.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');
    const line = src.split('\n').find((l) => l.includes('/kickoff`'));
    expect(line).toBeDefined();
    expect(line).not.toMatch(/\btext\b|\bbody\b/);
  });

  it('encodes the session id, like every other session-scoped call', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true, queued: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await api.kickoff('a/b', { slug: 's', title: 't' });
    const [url] = fetchImpl.mock.calls[0] as [string];
    expect(url).toBe('/api/sessions/a%2Fb/kickoff');
  });

  it('throws ApiError on a non-2xx — the sheet needs the code to say what failed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(501, { ok: false, error: 'not-configured' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' }).then(
      () => { throw new Error('expected kickoff to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(501);
    // …and the code becomes a sentence rather than reaching the operator as a
    // bare slug. A box with no coord.db is an ordinary, silent state.
    expect(apiErrorText(err)).toMatch(/coordination/i);
  });
});

// Task 13 review lesson (Task 11/12's own reviews, applied here ahead of
// time): `StartProgramSheet` always takes its `createSession`/kickoff props
// INJECTED in `start-program.test.tsx`'s copy/refusal cases, so the real
// `api.createSession` — the one the production sheet's default prop value
// actually calls — needs its own pin here, same idiom as `coordPause`/
// `abandonRun` above. `prompt`'s own pin already exists at the top of this
// file, and stays: this wave retires the kickoff's use of that route, never
// the route.
describe('createSession (Task 13)', () => {
  it('POSTs {wrapper, project, workdir} to /api/sessions', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.createSession({ wrapper: 'claude', project: 'ccrc-pwa', workdir: '/w' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/sessions');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ wrapper: 'claude', project: 'ccrc-pwa', workdir: '/w' });
  });

  it('omits workdir from the body when not passed', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { ok: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.createSession({ wrapper: 'claude', project: 'ccrc-pwa' });

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ wrapper: 'claude', project: 'ccrc-pwa' });
  });

  it('throws ApiError on a non-2xx response — e.g. the 400 for a malformed request', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { ok: false, error: 'bad-request' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.createSession({ wrapper: 'claude', project: '' }).then(
      () => { throw new Error('expected createSession to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(400);
  });
});

// svc's round-4 residual, and the one composition hazard the fix creates.
//
// `apiErrorText` now maps a `body.error` CODE to a sentence when there is no
// `stderr`. One caller composes the two translators —
// `useAttachImage.ts:145`, `uploadErrorText(apiErrorText(err))` — so a code
// that BOTH maps know would have its upload-specific sentence shadowed by the
// generic one, silently, with the suite green. The two vocabularies are
// disjoint today (`unsupported` vs `unsupported-type`) and this is what keeps
// it true.
describe('apiErrorText and the code translators that compose with it', () => {
  const asError = (status: number, body: unknown): unknown => {
    try { throw new ApiError(status, body); } catch (e) { return e; }
  };

  it('routes a 501 unsupported to the sentence, not the slug', () => {
    expect(apiErrorText(asError(501, { ok: false, error: 'unsupported' })))
      .toBe(UNSUPPORTED_VERB_TEXT);
  });

  it('keeps ccd’s stderr ahead of the code map', () => {
    expect(apiErrorText(asError(502, { ok: false, error: 'unsupported', stderr: '  ccd said no  ' })))
      .toBe('ccd said no');
  });

  it('leaves an unmapped code exactly as it was — the floor did not move', () => {
    expect(apiErrorText(asError(409, { ok: false, error: 'draft-present' }))).toBe('draft-present');
    expect(apiErrorText(asError(500, 'plain text body'))).toBe('request failed (500)');
    expect(apiErrorText(new Error('boom'))).toBe('boom');
    expect(apiErrorText('not an error at all')).toBe('not an error at all');
  });

  it('does not shadow any code the UPLOAD translator owns', () => {
    // Every upload code must survive `apiErrorText` UNCHANGED, so that
    // `uploadErrorText` still gets a key to look up rather than a sentence.
    for (const code of ['too-large', 'unsupported-type', 'bad-request',
      'unknown-session', 'bad-session-id']) {
      expect(apiErrorText(asError(415, { ok: false, error: code })), code).toBe(code);
      expect(uploadErrorText(apiErrorText(asError(415, { ok: false, error: code }))), code)
        .not.toBe(code);
    }
  });

  it('does not shadow any code the SEND translator owns either', () => {
    for (const code of ['dialog-open', 'enter-ignored', 'verify-failed',
      'draft-clear-failed', 'not-alive']) {
      expect(apiErrorText(asError(409, { ok: false, error: code })), code).toBe(code);
      expect(sendErrorText(apiErrorText(asError(409, { ok: false, error: code }))), code)
        .not.toBe(code);
    }
  });
});

// TASK 410 — `verify-failed`'s sentence was false twice after this build.
describe('send-failure copy', () => {
  it("verify-failed's sentence stops sending the operator to a terminal", () => {
    // The old copy was "The session never showed the text — open the terminal
    // to check." Both halves stopped being right: the ordinary path now
    // REFUSES rather than clearing, so the text is still in the box, and the
    // box-scoped echo check makes this refusal fire more often. A message that
    // tells the operator to go elsewhere and do something the UI can do is the
    // dead end `enter-ignored`'s own copy was rewritten to close.
    //
    // A NEW sentence, minted here — not a reuse of its neighbour, which is
    // left exactly as it was so the two read as one register.
    expect(sendErrorText('verify-failed')).toBe('Typed it, but the session never echoed it back.');
    expect(sendErrorText('enter-ignored')).toBe("Typed it, but the session didn't take it.");
    // The NEGATIVE half, which is the whole point of the change and survives
    // no mutant that quietly restores the old dead end.
    expect(sendErrorText('verify-failed')).not.toMatch(/terminal/);
    // And the two stay DISTINCT: they describe different failures (nothing
    // echoed back, versus echoed and then not taken), and collapsing them
    // would tell the operator the wrong story about which one happened.
    expect(sendErrorText('verify-failed')).not.toBe(sendErrorText('enter-ignored'));
  });
});
