// The agent's `overlord-history` op (Overlord W1, plan docs/superpowers/plans/2026-11-14-overlord-w1/w1-board-history.md,
// Tasks 3 and 4; ruled F2, F5, R5, R6).
//
// A REAL agent over loopback. The op's worker entry is injected through the resolver seam, so each case points it at a
// test entry written under the suite's temp parent: a real slow native statement (an in-memory `WITH RECURSIVE` query,
// never a JS loop), a throw carrying a secret-shaped value, an early exit, an unclonable answer, a loud worker, an answer
// over the cap, a late answer. One case runs the real entry (ccd/history/overlord-worker.mjs) on a fixture home with no
// history store. No case reads a real home.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs, { mkdirSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import type { RunningAgent } from '../src/server.js';
import { OVERLORD_HISTORY_DEADLINE_MS, resolveOverlordWorker } from '../src/historyOp.js';
import { OVERLORD_READ_BUSY_TIMEOUT_MS } from '../../ccd/history/overlord-read.mjs';
import { OVERLORD_HISTORY_ANSWER_MAX_BYTES, readOverlordHistoryAnswer } from '../../shared/overlordHistory.js';
import { OVERLORD_HISTORY_OP, type AgentReady } from '../../shared/agent-protocol.js';
import { CAP_WORD, MAX_CAP_WORDS } from '../../shared/api.js';
import { makeFixture, boot, TestClient } from './helpers.js';
import { mkTmp } from './tmpHelpers.js';

const SECRET = ['sk', 'ant', 'api03', 'Qzv7Kp2mWx9LrT4nBh6YcJ8dQzv7Kp2mWx9L'].join('-');
const ROWS = {
  outcome: 'rows', exit: 0, items: [{ node_id: 'N1', trust: 'untrusted' }], shown: 1, total: 1,
  scope: { kind: 'overlord', id: 'all', project: null, families: [], families_total: 0, transcripts: 1 },
};
const REQ = { op: 'overlord-history', verb: 'search', target: { kind: 'all' }, agents: false, args: ['zq'] };

/** Test worker entries, one file each, under the suite's temp parent. */
const dir = mkTmp('overlord-history-op-');
const entry = (name: string, body: string): string => {
  const f = path.join(dir, `${name}.mjs`);
  writeFileSync(f, `import { parentPort, workerData } from 'node:worker_threads';\n${body}\n`);
  return f;
};
const GOOD = entry('good', `parentPort.postMessage(${JSON.stringify(ROWS)});`);
// About twenty million rows of a native statement: seconds of SQLite, not a JS loop.
const SLOW = entry('slow', [
  "import { DatabaseSync } from 'node:sqlite';",
  "const db = new DatabaseSync(':memory:');",
  "db.prepare('WITH RECURSIVE c(x) AS (SELECT 1 UNION ALL SELECT x + 1 FROM c WHERE x < 20000000) SELECT count(*) AS n FROM c').get();",
  `parentPort.postMessage(${JSON.stringify(ROWS)});`,
].join('\n'));
const THROWS = entry('throws', `throw new Error('boom ${SECRET}');`);
const EXIT3 = entry('exit3', 'process.exit(3);');
const UNCLONABLE = entry('unclonable', 'parentPort.postMessage({ outcome: "rows", f: () => 1 });');
const LOUD = entry('loud', [
  "process.stderr.write('e'.repeat(128 * 1024));",
  "process.stdout.write('o'.repeat(128 * 1024));",
  `parentPort.postMessage(${JSON.stringify(ROWS)});`,
].join('\n'));
const BIG = entry('big', `parentPort.postMessage({ ...${JSON.stringify(ROWS)}, items: [{ text: 'x'.repeat(${OVERLORD_HISTORY_ANSWER_MAX_BYTES}), trust: 'untrusted' }] });`);
const LATE = entry('late', `setTimeout(() => parentPort.postMessage(${JSON.stringify(ROWS)}), 600);`);
const OFFSHAPE = entry('offshape', `parentPort.postMessage({ outcome: 'failed', word: 'boom ${SECRET}' });`);
const ENV = entry('env', `parentPort.postMessage({ ...${JSON.stringify(ROWS)}, items: [{ keys: Object.keys(process.env).join(','), trust: 'untrusted' }] });`);

interface Res { t: string; id: number; ok: boolean; [k: string]: unknown }

describe('the overlord-history op on the wire', () => {
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  let worker = GOOD;
  let logged: string[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await agent?.close();
    agent = undefined;
    worker = GOOD;
    logged = [];
    vi.restoreAllMocks();
  });
  async function connect(opts: { deadlineMs?: number; resolve?: () => string | null } = {}): Promise<TestClient> {
    agent ??= await boot(makeFixture(), {
      historySeams: {
        resolveWorker: opts.resolve ?? (() => worker), deadlineMs: opts.deadlineMs ?? 5_000, platform: 'linux',
        log: (l) => { logged.push(l); },
      },
    });
    const c = new TestClient(agent.port);
    clients.push(c);
    await c.hello();
    return c;
  }
  let nextId = 1;
  const ask = (c: TestClient, frame: Record<string, unknown> = REQ): Promise<Res> => c.req<Res>(nextId++, frame);
  const answerOf = (r: Res): unknown => {
    const { t: _t, id: _id, ok: _ok, ...rest } = r;
    return rest;
  };

  it("a good read answers the worker's rows, on ResOk", async () => {
    const c = await connect();
    const r = await ask(c);
    expect(r.ok).toBe(true);
    expect(answerOf(r)).toEqual(ROWS);
    expect(readOverlordHistoryAnswer(r)).toEqual(ROWS);
  });

  it('the worker starts with an empty environment: the agent\'s token never reaches it', async () => {
    worker = ENV;
    const c = await connect();
    const r = await ask(c);
    expect((r['items'] as { keys: string }[])[0]!.keys).toBe('');
  });

  it('the main thread stays free while a real native statement runs, and the deadline answers deadline (R6)', async () => {
    worker = SLOW;
    const c = await connect({ deadlineMs: 200 });
    const t0 = Date.now();
    const pending = ask(c);
    const caps = await c.req<Res>(900, { op: 'caps' });
    expect(caps.t).toBe('res');
    expect(Date.now() - t0, 'caps answered while the statement ran').toBeLessThan(1_000);
    expect(answerOf(await pending)).toEqual({ outcome: 'deadline' });
    // The statement still runs: the slot is held until the worker's exit, so a second request is busy.
    expect(answerOf(await ask(c))).toEqual({ outcome: 'busy' });
    // After the exit, a request is served.
    worker = GOOD;
    let served: unknown = { outcome: 'busy' };
    for (let i = 0; i < 100 && (served as { outcome: string }).outcome === 'busy'; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      served = answerOf(await ask(c));
    }
    expect(served).toEqual(ROWS);
  }, 30_000);

  it('closing the link mid-read terminates the worker, and the slot frees on its exit', async () => {
    worker = SLOW;
    const first = await connect({ deadlineMs: 10_000 });
    first.send({ t: 'req', id: 500, ...REQ });
    await new Promise((r) => setTimeout(r, 100));
    first.ws.close();
    const second = await connect();
    expect(answerOf(await ask(second)), 'the slot is still held until the exit').toEqual({ outcome: 'busy' });
    worker = GOOD;
    let served: unknown = { outcome: 'busy' };
    for (let i = 0; i < 100 && (served as { outcome: string }).outcome === 'busy'; i += 1) {
      await new Promise((r) => setTimeout(r, 100));
      served = answerOf(await ask(second));
    }
    expect(served).toEqual(ROWS);
  }, 30_000);

  it('an answer over the cap answers too-large, with its size', async () => {
    worker = BIG;
    const c = await connect();
    const a = answerOf(await ask(c)) as { outcome: string; bytes: number };
    expect(a.outcome).toBe('too-large');
    expect(a.bytes).toBeGreaterThan(OVERLORD_HISTORY_ANSWER_MAX_BYTES);
  });

  it("a worker error event answers failed (internal): the message is on neither the wire nor the agent's log", async () => {
    const warn = vi.spyOn(console, 'warn');
    const err = vi.spyOn(process.stderr, 'write');
    worker = THROWS;
    const c = await connect();
    const r = await ask(c);
    expect(answerOf(r)).toEqual({ outcome: 'failed', word: 'internal' });
    expect(JSON.stringify(r)).not.toContain(SECRET);
    expect(logged).toEqual(['ccrc-agent: overlord-history failed']);
    const out = [...warn.mock.calls, ...err.mock.calls].map((a) => a.map(String).join(' ')).join('\n');
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain('boom');
  });

  it('an off-shape answer, a message carrying text included, answers failed (internal)', async () => {
    worker = OFFSHAPE;
    const c = await connect();
    const r = await ask(c);
    expect(answerOf(r)).toEqual({ outcome: 'failed', word: 'internal' });
    expect(JSON.stringify(r)).not.toContain(SECRET);
  });

  it('an exit with no answer answers failed (internal) at once, not deadline', async () => {
    worker = EXIT3;
    const c = await connect({ deadlineMs: 10_000 });
    const t0 = Date.now();
    expect(answerOf(await ask(c))).toEqual({ outcome: 'failed', word: 'internal' });
    expect(Date.now() - t0).toBeLessThan(5_000);
  });

  it('an unclonable answer answers failed (internal)', async () => {
    worker = UNCLONABLE;
    const c = await connect();
    expect(answerOf(await ask(c))).toEqual({ outcome: 'failed', word: 'internal' });
  });

  it('a loud worker (128 KiB on stderr and on stdout) still exits, and the slot frees', async () => {
    worker = LOUD;
    const c = await connect();
    expect(answerOf(await ask(c))).toEqual(ROWS);
    worker = GOOD;
    let served: unknown = { outcome: 'busy' };
    for (let i = 0; i < 50 && (served as { outcome: string }).outcome === 'busy'; i += 1) {
      served = answerOf(await ask(c));
      if ((served as { outcome: string }).outcome === 'busy') await new Promise((r) => setTimeout(r, 100));
    }
    expect(served).toEqual(ROWS);
  }, 30_000);

  it('a bad path makes the constructor throw: failed (internal), and the next request is served', async () => {
    let bad = true;
    const c = await connect({ resolve: () => (bad ? 'relative/entry.mjs' : GOOD) });
    expect(answerOf(await ask(c))).toEqual({ outcome: 'failed', word: 'internal' });
    bad = false;
    expect(answerOf(await ask(c))).toEqual(ROWS);
  });

  it('a late answer, posted after the deadline, is dropped', async () => {
    worker = LATE;
    const c = await connect({ deadlineMs: 200 });
    const seen: unknown[] = [];
    c.ws.on('message', (raw) => { seen.push(JSON.parse(String(raw))); });
    expect(answerOf(await ask(c))).toEqual({ outcome: 'deadline' });
    await new Promise((r) => setTimeout(r, 900));
    expect(seen.filter((m) => (m as { outcome?: string }).outcome === 'rows')).toEqual([]);
  });

  it('a refused request answers request-refused with its word, on ResOk; bad-request stays "this agent predates the op"', async () => {
    const c = await connect();
    for (const [frame, word] of [
      [{ ...REQ, verb: 'tree' }, 'bad-verb'],
      [{ ...REQ, target: { kind: 'workspace' } }, 'bad-target'],
      [{ ...REQ, args: ['--regex', 'a.*'] }, 'regex'],
      [{ ...REQ, regex: 'a.*' }, 'regex'],
      [{ ...REQ, args: [1] }, 'bad-args'],
    ] as const) {
      const r = await ask(c, frame);
      expect([r.ok, answerOf(r)], JSON.stringify(frame)).toEqual([true, { outcome: 'request-refused', word }]);
    }
  });

  it('the real entry, on a fixture home with no history store: no-store, through a real worker', async () => {
    const c = await connect({ resolve: () => resolveOverlordWorker() });
    expect(answerOf(await ask(c))).toEqual({ outcome: 'store-refused', word: 'no-store' });
  }, 30_000);
});

describe('the op\'s bounds and its resolver', () => {
  it('the deadline is 20 s, above the read\'s busy timeout (R5, R10)', () => {
    expect(OVERLORD_HISTORY_DEADLINE_MS).toBe(20_000);
    expect(OVERLORD_READ_BUSY_TIMEOUT_MS).toBeLessThan(OVERLORD_HISTORY_DEADLINE_MS);
  });

  it('the resolver finds the entry two directories up in source and four up in a release, absolute, or answers null', () => {
    const real = resolveOverlordWorker();
    expect(real).not.toBeNull();
    expect(path.isAbsolute(real!)).toBe(true);
    expect(real!.endsWith(path.join('ccd', 'history', 'overlord-worker.mjs'))).toBe(true);
    const repo = path.resolve(path.dirname(real!), '..', '..');
    expect(resolveOverlordWorker(path.join(repo, 'agent', 'src', 'historyOp.ts'))).toBe(real);
    expect(resolveOverlordWorker(path.join(repo, 'agent', 'dist', 'agent', 'src', 'historyOp.js'))).toBe(real);
    expect(resolveOverlordWorker(path.join(mkTmp('overlord-history-none-'), 'a', 'b', 'historyOp.js'))).toBeNull();
  });
});

describe('the word overlord-history in ready.ops (Task 4)', () => {
  const TEN = ['update', 'token-sync', 'account', 'disk', 'pressure', 'testbox', 'testbox-tools-sync', 'testbox-admin', 'backup', 'readdir-mtimes'];
  let agent: RunningAgent | undefined;
  const clients: TestClient[] = [];
  afterEach(async () => {
    for (const c of clients.splice(0)) c.ws.close();
    await agent?.close();
    agent = undefined;
  });
  async function opsWith(seams: { platform: NodeJS.Platform; resolve: () => string | null }, home?: string): Promise<string[]> {
    const fx = makeFixture();
    agent = await boot(home === undefined ? fx : { ...fx, home }, {
      historySeams: { resolveWorker: seams.resolve, platform: seams.platform, deadlineMs: 5_000, log: () => {} },
    });
    const c = new TestClient(agent.port);
    clients.push(c);
    return ((await c.hello()) as AgentReady).ops!;
  }

  it('advertised, last, on a Linux agent whose worker entry is found; the word passes CAP_WORD', async () => {
    const ops = await opsWith({ platform: 'linux', resolve: () => resolveOverlordWorker() });
    expect(ops).toEqual([...TEN, OVERLORD_HISTORY_OP]);
    expect(CAP_WORD.test(OVERLORD_HISTORY_OP)).toBe(true);
    expect(ops.length).toBeLessThanOrEqual(MAX_CAP_WORDS);
  });

  it('withheld when the resolver answers absent, the other ten unchanged', async () => {
    expect(await opsWith({ platform: 'linux', resolve: () => null })).toEqual(TEN);
  });

  it('withheld on macOS, the other ten unchanged', async () => {
    expect(await opsWith({ platform: 'darwin', resolve: () => resolveOverlordWorker() })).toEqual(TEN);
  });

  it('the boot check reads no role: a sentinel ccrc.env in the home is never opened (R1)', async () => {
    const home = makeFixture().home;
    mkdirSync(path.join(home, '.ccrc'), { recursive: true });
    writeFileSync(path.join(home, '.ccrc', 'ccrc.env'), 'CCRC_ROLE=server\n');
    const opened: string[] = [];
    const real = { openSync: fs.openSync, readFileSync: fs.readFileSync, open: fs.promises.open, readFile: fs.promises.readFile };
    const note = (p: unknown): void => { if (typeof p === 'string') opened.push(p); };
    fs.openSync = ((p: fs.PathLike, ...r: unknown[]) => { note(p); return (real.openSync as (...a: unknown[]) => number)(p, ...r); }) as typeof fs.openSync;
    fs.readFileSync = ((p: fs.PathOrFileDescriptor, ...r: unknown[]) => { note(p); return (real.readFileSync as (...a: unknown[]) => unknown)(p, ...r); }) as typeof fs.readFileSync;
    fs.promises.open = ((p: fs.PathLike, ...r: unknown[]) => { note(p); return (real.open as (...a: unknown[]) => unknown)(p, ...r); }) as typeof fs.promises.open;
    fs.promises.readFile = ((p: fs.PathLike, ...r: unknown[]) => { note(p); return (real.readFile as (...a: unknown[]) => unknown)(p, ...r); }) as typeof fs.promises.readFile;
    syncBuiltinESMExports();
    try {
      const ops = await opsWith({ platform: 'linux', resolve: () => resolveOverlordWorker() }, home);
      expect(ops, 'a server role recorded on disk changes nothing').toEqual([...TEN, OVERLORD_HISTORY_OP]);
    } finally {
      Object.assign(fs, { openSync: real.openSync, readFileSync: real.readFileSync });
      Object.assign(fs.promises, { open: real.open, readFile: real.readFile });
      syncBuiltinESMExports();
    }
    expect(opened.length, 'CONTROL: the spy saw the boot\'s own reads').toBeGreaterThan(0);
    expect(opened.filter((p) => p.endsWith('ccrc.env'))).toEqual([]);
  });
});
