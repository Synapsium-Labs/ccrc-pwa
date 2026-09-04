import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ApiError, apiErrorText, clipUrl, createApi, kickoffErrorText, sendErrorText, uploadErrorText, UNSUPPORTED_VERB_TEXT } from '../src/lib/api';

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
  it('GETs /api/coord/caps and returns the parsed view', async () => {
    // The component tests always inject, so without a fetch-level block here a
    // new client method has NO coverage at all — measured for `coordPause`,
    // which is why this describe exists.
    const view = { caps: { maxConcurrentWorkers: 3, maxSessionsPerDay: 12 },
                   usage: { running: 1, dispatchedIn24h: 4 } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, view));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    expect(await api.coordCaps()).toEqual(view);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/caps');
    expect(init?.method ?? 'GET').toBe('GET');
  });

  it('POSTs only the given fields as JSON to /api/coord/caps', async () => {
    const view = { caps: { maxConcurrentWorkers: 5, maxSessionsPerDay: 12 },
                   usage: { running: 1, dispatchedIn24h: 4 } };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, view));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    expect(await api.setCoordCaps({ maxConcurrentWorkers: 5 })).toEqual(view);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/coord/caps');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    expect(JSON.parse(init.body as string)).toEqual({ maxConcurrentWorkers: 5 });
    // No box token on this call — it is an operator dial, not a machine lane.
    expect(new Headers(init.headers).get('x-ccrc-mail-token')).toBeNull();
  });

  it('answers `unreadable` when a 2xx caps write comes back unparseable (D-1150)', async () => {
    // The distinction the control depends on: the write may have LANDED, so
    // this must not reject the way a failed request does.
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true, status: 200, json: () => Promise.reject(new Error('truncated')),
      text: () => Promise.resolve(''),
    });
    const api = createApi(fetchImpl as unknown as typeof fetch);
    await expect(api.setCoordCaps({ maxConcurrentWorkers: 5 })).resolves.toBe('unreadable');
  });

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

// program-leverage wave 5. `ResumeSheet` takes its `reclaimRun` prop INJECTED in
// `resume-sheet.test.tsx`, so the real `api.reclaimRun` — the one the production
// sheet's default prop value actually calls — needs its own pin here, the same
// idiom `abandonRun` just above uses and for the same reason.
describe('reclaimRun (program-leverage wave 5)', () => {
  it('POSTs {claimedBy} as JSON to /api/runs/:id/reclaim', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {
      ok: true, program: 'program-leverage', runIds: [16, 18], from: 'coordinator-old', to: 'coordinator-new',
    }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const out = await api.reclaimRun(18, 'coordinator-new');

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/runs/18/reclaim');
    expect(init.method).toBe('POST');
    expect(new Headers(init.headers).get('content-type')).toBe('application/json');
    // ONE field. The event trail's `causedBy` is hardcoded `operator` server-side,
    // so nothing this client sends can attribute the reclaim to anybody else — and
    // a second field here would be the first step toward it trying.
    expect(JSON.parse(init.body as string)).toEqual({ claimedBy: 'coordinator-new' });
    // `runIds` is the answer the sheet renders: under ruling R1 the rewrite covers
    // every run of the program, terminal ones included, so a program with waves
    // behind it moves more than one row and the operator is told how many.
    //
    // `ok` is in the expectation because it is in the ANSWER: `postJson` hands
    // back the parsed body verbatim rather than projecting four fields out of
    // it, which is what every other `postJson` caller in this file does and
    // what `abandonRun` deliberately does NOT (it projects, because it owes a
    // degrade direction for an absent field). Written as a whole-body `toEqual`
    // rather than a `toMatchObject`, so this also pins that the client neither
    // drops a field the sheet may later want nor invents one the server did
    // not send. The declared return type names the four the sheet reads.
    expect(out).toEqual({
      ok: true,
      program: 'program-leverage', runIds: [16, 18], from: 'coordinator-old', to: 'coordinator-new',
    });
  });

  it('sends NO box token — the credential belongs to the session that died', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { ok: true, program: 'p', runIds: [1], from: 'a', to: 'b' }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.reclaimRun(1, 'b');

    const [, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    // The EXACT header set, not `.get('x-ccrc-mail-token')` being null: a
    // credential under any other spelling walks past that, and this door's
    // ungatedness is the decision most likely to be "fixed" by someone who has
    // not read D-282. Two names, because the JSON-reading helper asks for JSON
    // back as well as sending it. Sorted, so header iteration order is not part
    // of what this measures.
    const names = [...new Headers(init.headers).keys()].sort();
    expect(names, 'the reclaim call carries no credential header').toEqual(['accept', 'content-type']);
  });

  it('carries the 409 refusal through verbatim — the sheet renders it, not a toast', async () => {
    const refusal = {
      ok: false, refused: 'claimant-alive', by: 'coordinator-old', detail: 'tmux reports the pane live',
    };
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(409, refusal));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    const err = await api.reclaimRun(18, 'coordinator-new').then(
      () => { throw new Error('expected reclaimRun to reject'); },
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).body).toEqual(refusal);
    // The code rides `refused`, NOT `error`, so `ApiError`'s constructor
    // (`api.ts:13-18`) finds no message and this degrades to the bare status
    // sentence. Pinned so the sheet's own translator is written knowing it
    // rather than discovering it on a phone.
    expect(apiErrorText(err),
      'the refusal code rides `refused`; if a later wave teaches apiErrorText that key, rewrite this pin')
      .toBe('request failed (409)');
  });
});

// program-leverage wave 4 (F4). The sheet's kickoff prop is injected in
// `start-program.test.tsx`'s cases, so the real client method — the one the
// production sheet's default prop actually calls — is pinned here, exactly as
// `createSession` below it is and for the same reason.
//
// Wave 5 gave the same method a SECOND consumer: `ResumeSheet`'s re-kickoff
// door, which passes the `{runId, wave}` pair and so asks the server for a
// wave-N revive sentence rather than a program-start one. Both consumers'
// default prop value is this one method, so both are pinned here — including
// the answer it stopped discarding (D-1133), which only the second renders.
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
    // can queue a program kickoff and nothing else. A prose key here hands that
    // narrowing back.
    //
    // WAVE-4 REVIEW, MINOR 5 (D-1122) is why this reads the DECLARATION rather
    // than the first line mentioning ``/kickoff` `` — that one was a JSDoc line
    // seventeen rows above the code and could never red on the mutation it
    // named. Wave 5 breaks the repair in turn: the method stopped being a
    // one-liner the moment it started reading its answer, which is the case
    // `toBeDefined()` was left there to catch. So it now scans the WHOLE method,
    // declaration through its own `},` — strictly more of the file than the line
    // form ever saw — and it is anti-vacuous three ways: the slice must be
    // found, it must terminate, and it must contain both the call and the payload.
    //
    // `postJson` stayed the anchor when MINOR 7 (D-1150) moved this method onto
    // the degrading twin `postJsonOr`: the substring holds for both spellings on
    // purpose, because what THIS pin measures is that a JSON-answering POST
    // sends the program identity and no prose — the degrade itself is pinned by
    // behaviour two tests below, which is the mechanism that reds if the method
    // is ever walked back to the throwing helper.
    const src = readFileSync(path.join(import.meta.dirname, '..', 'src', 'lib', 'api.ts'), 'utf8');
    const lines = src.split('\n');
    const start = lines.findIndex((l) => l.includes('kickoff: async ('));
    expect(start, 'the kickoff declaration — rewrite this pin if the method was renamed or re-shaped')
      .toBeGreaterThan(-1);
    const end = lines.findIndex((l, i) => i > start && l === '    },');
    expect(end, 'the kickoff method never closes at its own indent — rewrite this pin').toBeGreaterThan(start);
    const slice = lines.slice(start, end + 1).join('\n');
    expect(slice, 'not the declaration that posts the payload').toContain('postJson');
    expect(slice, 'the payload is the program identity and the wave, nothing else').toContain('slug');
    expect(slice).not.toMatch(/\btext\b|\bbody\b/);
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

  it('reads `queued` off the 200 body — wave 5 is the consumer the old docstring said did not exist', async () => {
    const fresh = createApi(async () => jsonResponse(200, { ok: true, queued: true }));
    expect(await fresh.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: true });

    // NOT a failure — a kickoff IS waiting for that session — and on the revive
    // path it is the likelier of the two answers, which is precisely why the
    // sheet has to be able to tell them apart.
    const waiting = createApi(async () => jsonResponse(200, { ok: true, queued: false }));
    expect(await waiting.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: false });
  });

  it('absence of `queued` degrades to TRUE, the abandonRun direction', async () => {
    // No deployed server produces this: the route has sent the field on every
    // 200 it has ever answered (`server/src/server.ts`'s kickoff handler ends
    // `return { ok: true, queued: out.queued }`). It covers a truncated or
    // proxy-rewritten body, where the safe direction is not to assert a kickoff
    // was already waiting that never was.
    const older = createApi(async () => jsonResponse(200, { ok: true }));
    expect(await older.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: true });
  });

  it('an UNREADABLE 200 degrades the same way absence does, instead of rejecting (D-1150)', async () => {
    // WAVE-5 REVIEW, MINOR 7. The docstring above `kickoff` promised this
    // degrade before any code implemented it: this method went through plain
    // `postJson`, which is `(await request(…)).json()` with no `.catch` at all,
    // so an answer that cannot be parsed THREW. And on `main` this method read no answer at
    // all, which makes the gap a REGRESSION rather than a missing nicety — a 200
    // that really did queue the kickoff reached the operator as "nothing was
    // sent, and it has no brief yet", above a retry that would queue a SECOND
    // one.
    //
    // Two fixtures, because "unreadable" arrives two ways and the promise names
    // both: a truncated answer, and an emptied one (a stripping proxy, a 200
    // with no payload at all).
    const truncated = createApi(async () => new Response('{"ok":true,"queu', {
      status: 200, headers: { 'content-type': 'application/json' },
    }));
    expect(await truncated.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: true });

    const emptied = createApi(async () => new Response('', { status: 200 }));
    expect(await emptied.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' })).toEqual({ queued: true });
  });

  it('degrades ONLY what it measured — a request that never completed still rejects (D-1150)', async () => {
    // THE LINE, and why the fix is `abandonRun`'s shape rather than a `.catch`
    // around `postJson`. Reading the answer only after `request` has handed back
    // a 2xx makes "the exchange completed and the answer was unreadable"
    // separable from "the exchange never happened"; a catch wrapped around the
    // parsed call cannot separate them at all, because a dropped connection and
    // a body that never arrived both surface as a TypeError. Degrading the
    // second would tell the operator a kickoff was queued by a POST that never
    // left the phone — the unsafe half of the same coin the degrade direction is
    // chosen for.
    const offline = createApi(async () => { throw new TypeError('Failed to fetch'); });
    await expect(offline.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' }))
      .rejects.toThrow(/failed to fetch/i);

    // …and a non-2xx is untouched: the codes are what the sheet turns into a
    // sentence, so swallowing one would be the same regression in the other
    // direction. (The 501 case above pins the full translation.)
    const refused = createApi(async () => jsonResponse(409, { ok: false, error: 'bad-request' }));
    await expect(refused.kickoff('claude-ccrc-pwa', { slug: 's', title: 't' }))
      .rejects.toBeInstanceOf(ApiError);
  });

  it('carries {runId, wave} when the caller has them, and omits the keys entirely when it does not', async () => {
    // `mockImplementation`, not `mockResolvedValue(jsonResponse(…))`: this is
    // the file's only fixture that calls the same client method TWICE, and a
    // single `Response` instance can be read once. Since `kickoff` started
    // reading its answer (D-1133) the shared-instance form throws `Body is
    // unusable: Body has already been read` on the second call — a fixture
    // defect that would have been read as the implementation's. `vi.fn()` first
    // and the implementation second, so `mock.calls` keeps the loose element
    // type the two casts below need.
    const fetchImpl = vi.fn().mockImplementation(async () => jsonResponse(200, { ok: true, queued: true }));
    const api = createApi(fetchImpl as unknown as typeof fetch);

    await api.kickoff('claude-ccrc-pwa', { slug: 'program-leverage', title: 'Program leverage', runId: 18, wave: 5 });
    expect(JSON.parse((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string))
      .toEqual({ slug: 'program-leverage', title: 'Program leverage', runId: 18, wave: 5 });

    // Absence-permits, and it must be ABSENCE: the server refuses a HALF pair
    // with 400 `bad-request`, so a body that always carried the two keys would
    // turn wave 4's byte-identical request into a refusal.
    await api.kickoff('claude-ccrc-pwa', { slug: 'program-leverage', title: 'Program leverage' });
    expect(JSON.parse((fetchImpl.mock.calls[1] as [string, RequestInit])[1].body as string))
      .toEqual({ slug: 'program-leverage', title: 'Program leverage' });
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

  // WAVE-4 REVIEW, MINOR 3 (D-1120). The kickoff route names five codes and
  // `API_ERROR_TEXT` can only ever teach two of them: `uploadErrorText` OWNS
  // `unknown-session`, `bad-session-id` and `bad-request`, and it consumes this
  // function's OUTPUT as a KEY, so a sentence there shadows the upload
  // translator's own. The fourth per-surface map is the answer this file's own
  // idiom already prescribes, and it composes the same way `useAttachImage.ts`
  // composes the upload one.
  it('does not shadow any code the KICKOFF translator owns either', () => {
    for (const code of ['unknown-session', 'bad-session-id', 'bad-request', 'oversize']) {
      expect(apiErrorText(asError(404, { ok: false, error: code })), code).toBe(code);
      expect(kickoffErrorText(apiErrorText(asError(404, { ok: false, error: code }))), code)
        .not.toBe(code);
    }
  });

  it('leaves a sentence apiErrorText already owns exactly as it is', () => {
    // The composition runs on EVERY kickoff failure, including the two codes
    // `API_ERROR_TEXT` does own — so `kickoffErrorText` has to be a no-op on a
    // sentence, not only on an unmapped slug.
    const sentence = apiErrorText(asError(501, { ok: false, error: 'not-configured' }));
    expect(sentence).toMatch(/does not run coordination/i);
    expect(kickoffErrorText(sentence)).toBe(sentence);
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
