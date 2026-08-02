import { describe, it, expect } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { Runner } from '../src/exec.js';
import { buildServer } from '../src/server.js';
import { testDeps } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

/** A registry home with one workspace session, so `knownId` resolves. */
function seedWorkspace(): string {
  const home = mkTmp('ccrc-');
  const reg = path.join(home, '.cc-sessions');
  mkdirSync(reg, { recursive: true });
  for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w'],
    ['project', 'demo'], ['workspace', 'quiet-basin'], ['branch', 'ws/quiet-basin'],
    ['base', 'origin/main']]) {
    writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v!);
  }
  return home;
}

/**
 * `ccdVerbs` left undefined means NO `fleetState` at all, which `verbSupported`
 * reads as "no evidence" and permits — what every test here but the 501 one
 * wants. Passing a list makes the deployed-ccd claim explicit.
 */
async function app(stdout = '', code = 0, stderr = '', ccdVerbs?: string[] | null): Promise<{ app: FastifyInstance; calls: string[][] }> {
  const calls: string[][] = [];
  const run: Runner = async (_cmd, args) => { calls.push(args); return { code, stdout, stderr }; };
  const deps = testDeps(seedWorkspace(), run);
  return {
    app: await buildServer(ccdVerbs === undefined
      ? deps
      : { ...deps, fleetState: { connected: true, downSince: null, ccdVerbs } }),
    calls,
  };
}

const LINE = JSON.stringify({
  id: 'demo-quiet-basin', project: 'demo', repo: 'o/r', branch: 'ws/quiet-basin',
  base: 'origin/main', baseShort: 'main', tip: 'f'.repeat(40), ahead: 1, dirty: 0,
  commits: [{ sha: 'aaaaaaa', subject: 'the work', body: '' }], template: null, rows: [],
  phase: 'none', number: null, checkedAt: 1785300000000, reason: null,
});

describe('isSafeSessionId and knownId guard every PR-lifecycle route', () => {
  // The old delete route did not call isSafeSessionId, which is part of why
  // it was reachable with anything (clip.ts:10's own history). Every route
  // this task adds calls isSafeSessionId, then knownId, FIRST — before any
  // argv is built. Pinned here for all six routes, not just the one the
  // brief's own Step 1 test happened to cover (GET /pr), so a mutant dropping
  // either guard on any ONE route cannot survive by hiding behind the other
  // five.
  const UNSAFE = '..%2F..%2Fetc';

  it.each([
    ['GET', '/pr'],
    ['POST', '/pr'],
    ['POST', '/archive'],
    ['POST', '/restore'],
    ['GET', '/workspace/audit'],
    ['POST', '/workspace/reap'],
  ] as const)('%s .../:id%s 400s an unsafe id before building any argv', async (method, suffix) => {
    const { app: a, calls } = await app(LINE);
    const res = await a.inject({ method, url: `/api/sessions/${UNSAFE}${suffix}`,
      payload: method === 'POST' ? {} : undefined });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ ok: false, error: 'bad-session-id' });
    expect(calls).toEqual([]);
    await a.close();
  });

  it.each([
    ['GET', '/pr'],
    ['POST', '/pr'],
    ['POST', '/archive'],
    ['POST', '/restore'],
    ['GET', '/workspace/audit'],
    ['POST', '/workspace/reap'],
  ] as const)('%s .../:id%s 404s an unknown session before building any argv', async (method, suffix) => {
    const { app: a, calls } = await app(LINE);
    const res = await a.inject({ method, url: `/api/sessions/nope-nothing${suffix}`,
      payload: method === 'POST' ? {} : undefined });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ ok: false, error: 'unknown-session' });
    expect(calls).toEqual([]);
    await a.close();
  });
});

describe('GET /api/sessions/:id/pr', () => {
  it('runs ccd pr-state --session and answers a PrView', async () => {
    const { app: a, calls } = await app(LINE);
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/pr' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['pr-state', '--session', 'demo-quiet-basin']);
    const body = res.json();
    expect(body.pr.phase).toBe('none');
    expect(body.draft.title).toBe('the work');
    expect(body.facts.repo).toBe('o/r');
    await a.close();
  });

  it('answers unknown/agent-down rather than 502 when ccd fails', async () => {
    // The cap must render and offer Retry; a 502 gives the sheet nothing to
    // say and no affordance.
    const { app: a } = await app('', 1, 'boom');
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/pr' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr).toMatchObject({ phase: 'unknown', reason: 'agent-down' });
    await a.close();
  });

  it('passes ccd\'s own answer object through, timeout and all', async () => {
    const { app: a } = await app('{"phase":"unknown","reason":"timeout"}');
    expect((await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/pr' })).json().pr.reason)
      .toBe('timeout');
    await a.close();
  });

  it('rejects an unsafe session id before building any argv', async () => {
    const { app: a, calls } = await app(LINE);
    const res = await a.inject({ method: 'GET', url: '/api/sessions/..%2F..%2Fetc/pr' });
    expect(res.statusCode).toBe(400);
    expect(calls).toEqual([]);
    await a.close();
  });

  it('404s an unknown session', async () => {
    const { app: a } = await app(LINE);
    expect((await a.inject({ method: 'GET', url: '/api/sessions/nope-nothing/pr' })).statusCode).toBe(404);
    await a.close();
  });

  it('folds the session\'s real task list into the draft — prTasks reads through cfgDir/uuid, not an empty stand-in', async () => {
    // seedWorkspace's own registry writes wrapper:'claude', uuid:'u', so
    // prTasks resolves cfgDir = deps.cfg.wrappers.claude (home/.claude) and
    // reads home/.claude/tasks/u/*.json (tasks/read.ts's own tasksDir). Every
    // OTHER test in this file leaves that directory absent, so readTasks
    // there already answers [] — indistinguishable from prTasks answering
    // null outright, which is why this is its own fixture: without a real
    // task file, a mutant that hands draftPr `null` unconditionally (instead
    // of actually reading the session's tasks) passes every other assertion
    // in this file.
    const home = mkTmp('ccrc-');
    const reg = path.join(home, '.cc-sessions');
    mkdirSync(reg, { recursive: true });
    for (const [f, v] of [['uuid', 'u'], ['wrapper', 'claude'], ['workdir', '/w'],
      ['project', 'demo'], ['workspace', 'quiet-basin'], ['branch', 'ws/quiet-basin'],
      ['base', 'origin/main']]) {
      writeFileSync(path.join(reg, `demo-quiet-basin.${f}`), v!);
    }
    const tasksDir = path.join(home, '.claude', 'tasks', 'u');
    mkdirSync(tasksDir, { recursive: true });
    writeFileSync(path.join(tasksDir, '1.json'), JSON.stringify({
      id: '1', subject: 'Wire the six routes', activeForm: 'Wiring the six routes',
      description: '', status: 'in_progress',
    }));

    const run: Runner = async () => ({ code: 0, stdout: LINE, stderr: '' });
    const deps = testDeps(home, run);
    const a = await buildServer(deps);
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/pr' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.draft.body).toContain('## Plan');
    expect(body.draft.body).toContain('- [ ] Wire the six routes');
    await a.close();
  });

  it('answers unknown/unsupported (200, not 501) when the deployed ccd has no pr-state, and shells out to nothing', async () => {
    // Unlike the write routes below, a READ has no destructive side effect to
    // withhold — the cap still has to render something, so this is a 200
    // carrying phase:unknown/reason:unsupported via unknownView, same as the
    // agent-down branch above, never a 501.
    const { app: a, calls } = await app(LINE, 0, '', ['start']);
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/pr' });
    expect(res.statusCode).toBe(200);
    expect(res.json().pr).toMatchObject({ phase: 'unknown', reason: 'unsupported' });
    expect(calls).toEqual([]);
    await a.close();
  });
});

describe('POST /api/sessions/:id/pr', () => {
  it('base64-encodes the body and pins the flag order', async () => {
    const { app: a, calls } = await app('[]');
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/pr',
      payload: { title: 'the work', body: 'because', draft: false } });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['pr-open', '--session', 'demo-quiet-basin', '--title', 'the work',
      '--body-b64', Buffer.from('because', 'utf8').toString('base64'), '--draft', 'false']);
    await a.close();
  });

  it('sends --draft true when asked', async () => {
    const { app: a, calls } = await app('[]');
    await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/pr',
      payload: { title: 't', body: 'b', draft: true } });
    expect(calls[0]!.at(-1)).toBe('true');
    await a.close();
  });

  it('400s an empty title or body without shelling out', async () => {
    const { app: a, calls } = await app('[]');
    expect((await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/pr',
      payload: { title: '', body: 'b', draft: false } })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/pr',
      payload: { title: 't', body: '', draft: false } })).statusCode).toBe(400);
    expect(calls).toEqual([]);
    await a.close();
  });

  it('502s with ccd stderr when the verb refuses', async () => {
    const { app: a } = await app('', 1, 'ccd: not a workspace — refusing to open a PR from a main checkout');
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/pr',
      payload: { title: 't', body: 'b', draft: false } });
    expect(res.statusCode).toBe(502);
    expect(res.json().stderr).toContain('not a workspace');
    await a.close();
  });

  it('501s ONCE when the deployed ccd has no pr-open, and shells out to nothing', async () => {
    // The support check is hoisted OUT of the queued fn deliberately. Sent from
    // inside it, the 501 returned a FastifyReply — which has no `ok` — so the
    // caller's `'ok' in res` guard fell through and reply.code(502).send() ran
    // after send() had already fired: FST_ERR_REP_ALREADY_SENT, a 501 followed
    // by a crash. Nothing covered the 501 path, which is why it survived.
    // `calls` empty is the other half: an unsupported verb must not reach ccd.
    const { app: a, calls } = await app('', 0, '', ['start', 'pr-state']);
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/pr',
      payload: { title: 't', body: 'b', draft: false } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
    await a.close();
  });
});

describe('archive and restore', () => {
  it('POST /archive runs ccd ws-archive --session', async () => {
    const { app: a, calls } = await app('archived demo-quiet-basin');
    expect((await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/archive' })).statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-archive', '--session', 'demo-quiet-basin']);
    await a.close();
  });

  it('POST /restore runs ccd ws-restore --session', async () => {
    const { app: a, calls } = await app('restored demo-quiet-basin');
    expect((await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/restore' })).statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-restore', '--session', 'demo-quiet-basin']);
    await a.close();
  });
});

describe('audit and reap', () => {
  const AUDIT = JSON.stringify({
    id: 'demo-quiet-basin', branch: 'ws/quiet-basin', base: 'origin/main', workdir: '/w',
    project: 'demo', repo: 'o/r', exists: true, headMatchesRegistry: true, reaping: null,
    dirty: [], ignored: [{ path: 'node_modules/', bytes: 412000000, sensitive: false }],
    ignoredCount: 1, ignoredBytes: 412000000, sensitive: [], sensitiveFiltered: 0, clips: [], stashes: 0,
    worktreeBytes: 1200000000, commitsAheadOfBase: 3,
    pr: { number: 42, url: 'u', mergeCommit: '7a68ca0', headRefOid: 'deadbee' },
    merge: { proof: 'patch-id', fetchedAt: 1785300000 }, transcript: '/t.jsonl',
    verdict: 'reapable', detail: '', token: 'a'.repeat(64),
  });

  it('GET the audit runs ccd ws-audit --session and passes the object through', async () => {
    const { app: a, calls } = await app(AUDIT);
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/workspace/audit' });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-audit', '--session', 'demo-quiet-basin']);
    expect(res.json().token).toBe('a'.repeat(64));
    await a.close();
  });

  it('turns a refusal verdict into a sentence, never a raw shell string', async () => {
    const { app: a } = await app(JSON.stringify({ ...JSON.parse(AUDIT), verdict: 'sensitive-ignored', token: undefined, detail: '.env' }));
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/workspace/audit' });
    expect(res.json().sentence).toMatch(/secret-shaped/i);
    expect(res.json().token).toBeUndefined();
    await a.close();
  });

  it('POST reap requires an expect token of the right shape', async () => {
    const { app: a, calls } = await app('{}');
    expect((await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/workspace/reap',
      payload: {} })).statusCode).toBe(400);
    expect((await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/workspace/reap',
      payload: { expect: 'nope' } })).statusCode).toBe(400);
    expect(calls).toEqual([]);
    await a.close();
  });

  it('POST reap runs ccd ws-reap --expect <tok> --session <id>', async () => {
    const out = JSON.stringify({ reaped: 'demo-quiet-basin', branch: 'ws/quiet-basin', pr: 42,
      proof: 'patch-id', tombstone: '/t.json', attic: 17, bytes: 1200000000, resumed: null });
    const { app: a, calls } = await app(out);
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/workspace/reap',
      payload: { expect: 'a'.repeat(64) } });
    expect(res.statusCode).toBe(200);
    expect(calls).toContainEqual(['ws-reap', '--expect', 'a'.repeat(64), '--session', 'demo-quiet-basin']);
    expect(res.json().reaped).toBe('demo-quiet-basin');
    await a.close();
  });

  it('surfaces a refusal as a 200 with a sentence — a refusal is an ANSWER', async () => {
    const { app: a } = await app('{"refused":"state-changed","detail":"expected x","paths":[]}');
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/workspace/reap',
      payload: { expect: 'a'.repeat(64) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().refused).toBe('state-changed');
    expect(res.json().sentence).toMatch(/changed since/i);
    await a.close();
  });

  it('maps empty stderr plus a non-zero exit to INDETERMINATE, never failed', async () => {
    // A ws-reap killed at the outer timeout, an agent disconnect and a server
    // restart all look exactly like this. Reporting "failed" would be a claim
    // about the filesystem we cannot make.
    const { app: a } = await app('', 1, '');
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/workspace/reap',
      payload: { expect: 'a'.repeat(64) } });
    expect(res.statusCode).toBe(200);
    expect(res.json().indeterminate).toBe(true);
    expect(res.json().sentence).toMatch(/lost contact/i);
    await a.close();
  });

  it('501s when the deployed ccd has no ws-audit, and shells out to nothing', async () => {
    // INTEGRATION NEW FINDING 10 — the audit route was the one ccd route with
    // no verbSupported gate, so version skew came back as a bare 502 (ccd
    // answers on stderr, parseAudit returns null) instead of the 'unsupported'
    // answer every sibling route gives. Two halves, because either alone is
    // satisfiable by the wrong fix: the STATUS AND BODY must match the reap
    // route's (the sheet drives both from one flow), and ccd must not be
    // called at all.
    const { app: a, calls } = await app(AUDIT, 0, '', ['start', 'ws-reap']);
    const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/workspace/audit' });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
    await a.close();
  });

  it('still audits when the fleet advertised ws-audit, and when it advertised nothing', async () => {
    // The other direction, so "501 always" is not a passing fix. `null` verbs
    // is NO EVIDENCE (local mode, or an agent too old to send the list) and
    // must permit — an absent list must never grey out the fleet.
    for (const verbs of [['ws-audit'], null] as (string[] | null)[]) {
      const { app: a, calls } = await app(AUDIT, 0, '', verbs);
      const res = await a.inject({ method: 'GET', url: '/api/sessions/demo-quiet-basin/workspace/audit' });
      expect(res.statusCode, JSON.stringify(verbs)).toBe(200);
      expect(calls).toContainEqual(['ws-audit', '--session', 'demo-quiet-basin']);
      await a.close();
    }
  });

  it('501s ONCE when the deployed ccd has no ws-reap, and shells out to nothing', async () => {
    const { app: a, calls } = await app('', 0, '', ['start', 'ws-audit']);
    const res = await a.inject({ method: 'POST', url: '/api/sessions/demo-quiet-basin/workspace/reap',
      payload: { expect: 'a'.repeat(64) } });
    expect(res.statusCode).toBe(501);
    expect(res.json()).toEqual({ ok: false, error: 'unsupported' });
    expect(calls).toEqual([]);
    await a.close();
  });
});
