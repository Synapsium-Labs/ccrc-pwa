// One owner of question state per composition (D-7026; W3 Task Q3b, ARCH-56 (#791); plan
// 2026-10-26-consolidation-w3-questions.md, §Global constraints "One owner of question state per composition" and
// Review focus 8). `FleetWatcher` makes one `Questions` instance in its constructor; `buildServer` hands the routes the
// watcher's own when it is given a watcher and makes its own otherwise; and two apps or two watchers in one process
// share nothing. Observed from outside: `createQuestions` and `registerCoordRoutes` are wrapped (each still runs the
// real function) so the test sees every instance made and the one the routes received. Q3e and Q3d append their state
// rows to this file.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Bus } from '../src/bus.js';
import { buildServer } from '../src/server.js';
import { FleetWatcher } from '../src/watch.js';
import type { Questions } from '../src/coord/questions.js';
import { createQuestions as createQuestionsReal } from '../src/coord/questions.js';
import { testDeps } from './helpers.js';
import { hookInput, PARENT, requestBody, standardFixture, TOK, uuidOf } from './approvalsHarness.js';
import { mkTmp } from './tmpHelpers.js';

const seen = vi.hoisted(() => ({ made: [] as unknown[], routed: [] as unknown[] }));

vi.mock('../src/coord/questions.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/coord/questions.js')>();
  return {
    ...real,
    createQuestions: (...args: Parameters<typeof real.createQuestions>) => {
      const q = real.createQuestions(...args);
      seen.made.push(q);
      return q;
    },
  };
});

vi.mock('../src/coord/routes.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../src/coord/routes.js')>();
  return {
    ...real,
    registerCoordRoutes: (...args: Parameters<typeof real.registerCoordRoutes>) => {
      // The eighth argument: `app, deps, bus, sessionAuth, askDeps, watcher, notice, questions`.
      seen.routed.push(args[7]);
      return real.registerCoordRoutes(...args);
    },
  };
});

beforeEach(() => { seen.made.length = 0; seen.routed.length = 0; });

const deps = () => testDeps(mkTmp('ccrc-questions-instances-'));

describe('one Questions instance per watcher and per server', () => {
  it('a watcher makes one in its constructor, and buildServer given that watcher hands the routes the same object', async () => {
    const d = deps();
    const watcher = new FleetWatcher(d, new Bus(), 10_000);
    expect(seen.made).toEqual([watcher.questions]);
    const app = await buildServer(d, new Bus(), watcher);
    try {
      expect(seen.made, 'buildServer made no second instance').toHaveLength(1);
      expect(seen.routed).toHaveLength(1);
      expect(seen.routed[0]).toBe(watcher.questions);
    } finally { await app.close(); }
  });

  it('buildServer given no watcher makes its own, and hands the routes that one', async () => {
    const app = await buildServer(deps(), new Bus());
    try {
      expect(seen.made).toHaveLength(1);
      expect(seen.routed).toHaveLength(1);
      expect(seen.routed[0]).toBe(seen.made[0]);
    } finally { await app.close(); }
  });

  it('two servers and two watchers in one process get four distinct instances', async () => {
    const a = await buildServer(deps(), new Bus());
    const b = await buildServer(deps(), new Bus());
    const w1 = new FleetWatcher(deps(), new Bus(), 10_000);
    const w2 = new FleetWatcher(deps(), new Bus(), 10_000);
    try {
      const all: Questions[] = [seen.routed[0] as Questions, seen.routed[1] as Questions, w1.questions, w2.questions];
      expect(seen.made).toHaveLength(4);
      expect(new Set(all).size).toBe(4);
      expect(new Set(seen.made).size).toBe(4);
    } finally { await a.close(); await b.close(); }
  });
});

// Q3e (D-7029): the approval inputs are this instance's closure locals, so two apps share none (Review focus 8). An allow
// ruled on app B for a row app A minted is refused `guard-escalate`: B holds no input to run the guard again over.
describe('approvalInputs: one map per Questions instance (W3 Q3e)', () => {
  it('two buildServer apps share no approvalInputs: an allow on app B for a row minted on app A is guard-escalate', async () => {
    const f = await standardFixture();
    const b = await buildServer(f.deps, new Bus());
    try {
      const minted = await f.request(requestBody(hookInput({ command: 'rm -rf build' })));
      expect(minted.statusCode).toBe(201);
      const id = (minted.json() as { id: number }).id;
      const allow = { fromId: PARENT, fromUuid: uuidOf(PARENT), verdict: 'allow', reason: 'a cleanup inside your worktree' };
      const onB = await b.inject({ method: 'POST', url: `/api/approvals/${id}/rule`, headers: TOK, payload: allow });
      expect(onB.statusCode).toBe(409);
      expect(onB.body).toBe('{"ok":false,"error":"guard-escalate"}');
      // App A, which minted it, still holds the input: its allow is ruled.
      expect((await f.app.inject({ method: 'POST', url: `/api/approvals/${id}/rule`, headers: TOK, payload: allow })).json())
        .toEqual({ ok: true, state: 'allowed' });
    } finally { await b.close(); await f.close(); }
  });

  it('the input map is no property of the instance: every property the returned object carries is a function', () => {
    const q = createQuestionsReal({}) as unknown as Record<string, unknown>;
    expect(Object.keys(q)).not.toContain('approvalInputs');
    expect(Object.entries(q).filter(([, v]) => typeof v !== 'function').map(([k]) => k)).toEqual([]);
  });
});
