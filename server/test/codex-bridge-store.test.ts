// codex-bridge-store.test.ts — the reasoning store, `ccd/codexbridge/store.py` (codex-bridge Stage 2 plan 2026-10-22,
// Task 4; spec 2026-10-15 §2.5 "stdlib `sqlite3`, mode 0600", "14 days, and a size cap that evicts the oldest first";
// D23 "oldest-first eviction past 256 MB").
//
// Every case runs the package through `runBridgeDriver`'s `store-*` ops in a mkTmp HOME, with the store file in a
// lane directory this file makes 0700 (as the tier's start does), and both endpoint variables at a closed loopback
// URL: nothing here makes a request. A store key is never spelled here: the driver keys each `call` with
// `inbound.call_key` and each `[session, text]` with `inbound.text_key`, and `remember` is fed by the driver's own
// `reduce` op over streams written below. Ids are `<prefix>_fx<n>`, encrypted content `ENC-<n>`.
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import { driverLines, runBridgeDriver } from './codexBridgeFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Line = Record<string, any>;

const DAY = 86_400;
/** The clock for the cases that pass `now`: the real one when this file loads. `put` and `evict` take the case's
 *  `now`, so a row's age at an eviction is the case's own; `get` measures a row's age by the real clock (store.py
 *  `_get`), so a row a case reads back must also be young on that clock. A fixed future T0 would hold that only until
 *  the real clock passed it. */
const T0 = Math.floor(Date.now() / 1000);

/** A fixture HOME with a 0700 lane directory; the store file's path inside it. */
function lane(prefix: string): { home: string; dir: string; db: string } {
  const home = mkTmp(prefix);
  const dir = path.join(home, 'lane');
  mkdirSync(dir, { mode: 0o700 });
  return { home, dir, db: path.join(dir, 'reasoning.sqlite') };
}

async function run(
  home: string, ops: object[], o: { consts?: Record<string, unknown>; timeoutMs?: number } = {},
): Promise<Line[]> {
  const r = await runBridgeDriver(home, { ops, ...(o.consts ? { consts: o.consts } : {}) }, {},
    { timeoutMs: o.timeoutMs ?? 60_000 });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines.map((l) => l.op), `${r.stdout}\n${r.stderr}`).toEqual(ops.map((o) => (o as { op: string }).op));
  for (const l of lines) expect(l.raised, JSON.stringify(l)).toBeUndefined();
  return lines;
}

const rs = (n: number): object => ({ type: 'reasoning', id: `rs_fx${n}`, summary: [], encrypted_content: `ENC-${n}` });

/** A reduce op over events written here, one SSE event per object, ending in `response.completed`. */
function stream(items: object[]): object {
  const events: Array<Record<string, unknown>> = [
    { type: 'response.created', response: { id: 'resp_fx1', status: 'in_progress', output: [] } },
    ...items.map((item, i) => ({ type: 'response.output_item.done', output_index: i, item })),
    {
      type: 'response.completed',
      response: { id: 'resp_fx1', status: 'completed', output: [], usage: { input_tokens: 3, output_tokens: 4 } },
    },
  ];
  const sse = events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join('');
  return { op: 'reduce', bytes_b64: Buffer.from(sse, 'utf8').toString('base64'), chunk: 'whole' };
}

const msg = (n: number, text: string, phase?: string): object => ({
  type: 'message', id: `msg_fx${n}`, role: 'assistant', status: 'completed',
  content: [{ type: 'output_text', text, annotations: [] }], ...(phase ? { phase } : {}),
});
const fc = (n: number, args: string): object => ({
  type: 'function_call', id: `fc_fx${n}`, call_id: `call_fx${n}`, name: 'probe_tool', arguments: args,
  status: 'completed',
});

/** Every byte the store owns on disk: the database and sqlite's two WAL files, when present. */
function storeBytes(db: string): Buffer {
  return Buffer.concat(['', '-wal', '-shm'].map((s) => (existsSync(db + s) ? readFileSync(db + s) : Buffer.alloc(0))));
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');

describe.skipIf(!PY)('the reasoning store (codex-bridge spec §2.5, D23)', () => {
  it("a call's reasoning comes back by its call_id", async () => {
    const { home, db } = lane('cb-store-call-');
    const [open, , remember, got, missing, replay] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(1), fc(2, '{"q":"one"}')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-get', call: 'call_fx2' },
      { op: 'store-get', call: 'call_fx9' },
      {
        op: 'from-anthropic', lookup: 'store', headers: { 'x-claude-code-session-id': 's-2' },
        body: {
          model: 'model-6.1-alpha',
          messages: [
            { role: 'user', content: 'start' },
            { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx2', name: 'probe_tool', input: { q: 'one' } }] },
            { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'call_fx2', content: 'ok' }] },
          ],
        },
      },
    ]);
    expect(open.disabled).toBeNull();
    expect(remember.disabled).toBeNull();
    expect(got.turn).toEqual({ items: [rs(1)], phase: null });
    expect(missing.turn).toBeNull();
    // A call id is unique, so its key carries no session: the reasoning comes back in any session.
    expect(replay.request.items.slice(1, 3)).toEqual([
      rs(1), { type: 'function_call', call_id: 'call_fx2', name: 'probe_tool', arguments: '{"q":"one"}' },
    ]);
  });

  it("a text-only reply's reasoning comes back by its text, in that session only", async () => {
    const { home, db } = lane('cb-store-text-');
    const [, , , mine, other, none, phased, plain] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(3), msg(4, 'All done.', 'final_answer'), msg(5, 'Plain words.')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-get', session: 's-1', text: 'All done.' },
      { op: 'store-get', session: 's-2', text: 'All done.' },
      { op: 'store-get', session: null, text: 'All done.' },
      { op: 'store-get', session: 's-1', text: 'All done.' },
      { op: 'store-get', session: 's-1', text: 'Plain words.' },
    ]);
    expect(mine.turn).toEqual({ items: [rs(3)], phase: 'final_answer' });
    expect(other.turn).toBeNull();
    expect(none.turn).toBeNull();
    expect(phased.turn.phase).toBe('final_answer');
    // A message no reasoning preceded and no phase marks still gets its row, with nothing to replay.
    expect(plain.turn).toEqual({ items: [], phase: null });
  });

  it('a phase alone is kept for a text with no reasoning before it', async () => {
    const { home, db } = lane('cb-store-phase-');
    const [, , , call, text] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(1), fc(2, '{}'), msg(3, 'Looking now.', 'commentary')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-get', call: 'call_fx2' },
      { op: 'store-get', session: 's-1', text: 'Looking now.' },
    ]);
    expect(call.turn).toEqual({ items: [rs(1)], phase: null });
    expect(text.turn).toEqual({ items: [], phase: 'commentary' });
  });

  it('rows older than 14 days are gone', async () => {
    const { home, db } = lane('cb-store-ttl-');
    const turn = { items: [rs(1)], phase: null };
    const [, , , evict, old, young] = await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-put', call: 'call_fx1', turn, now: T0 - 15 * DAY },
      { op: 'store-put', call: 'call_fx2', turn, now: T0 - 13 * DAY },
      { op: 'store-evict', now: T0 },
      { op: 'store-get', call: 'call_fx1' },
      { op: 'store-get', call: 'call_fx2' },
    ]);
    expect(evict.evicted).toBe(1);
    expect(old.turn).toBeNull();
    expect(young.turn).toEqual(turn);
    // No eviction has run on an expired row (a lane idle since, or just restarted): get still never answers it.
    const fresh = lane('cb-store-ttl-read-');
    const now = Math.floor(Date.now() / 1000);
    const [, , , expired, live] = await run(fresh.home, [
      { op: 'store-open', path: fresh.db },
      { op: 'store-put', call: 'call_fx3', turn, now: now - 15 * DAY },
      { op: 'store-put', call: 'call_fx4', turn, now: now - 13 * DAY },
      { op: 'store-get', call: 'call_fx3' },
      { op: 'store-get', call: 'call_fx4' },
    ]);
    expect(expired.turn).toBeNull();
    expect(live.turn).toEqual(turn);
  });

  it('past the size cap the oldest go first', async () => {
    const { home, db } = lane('cb-store-cap-');
    const turn = (n: number): object => ({ items: [{ ...rs(n), encrypted_content: `ENC-${n}-${'x'.repeat(400)}` }], phase: null });
    // Each row is about 500 bytes (its key and its stored JSON), so a 1,200-byte cap keeps two. The once-a-minute
    // bound runs on the monotonic clock, so it is lowered to 0 here and each put runs the eviction.
    const ops: object[] = [{ op: 'store-open', path: db, max_bytes: 1200 }];
    for (let n = 1; n <= 4; n += 1) ops.push({ op: 'store-put', call: `call_fx${n}`, turn: turn(n), now: T0 + n * 100 });
    for (let n = 1; n <= 4; n += 1) ops.push({ op: 'store-get', call: `call_fx${n}` });
    ops.push({ op: 'store-dump', path: db });
    const lines = await run(home, ops, { consts: { 'store.EVICT_EVERY_S': 0 } });
    const gets = lines.slice(5, 9).map((l) => l.turn);
    expect(gets[0]).toBeNull();
    expect(gets[1]).toBeNull();
    expect(gets[2]).toEqual(turn(3));
    expect(gets[3]).toEqual(turn(4));
    const dump = lines[9];
    expect(dump.rows.reduce((s: number, r: Line) => s + (r.size as number), 0)).toBeLessThanOrEqual(1200);
  });

  it('a wall clock stepping back does not stop the eviction', async () => {
    const { home, db } = lane('cb-store-clock-');
    const turn = (n: number): object => ({ items: [{ ...rs(n), encrypted_content: `ENC-${n}-${'x'.repeat(400)}` }], phase: null });
    // Each put's wall clock is 100 s BEFORE the last one's; the bound runs on the monotonic clock, so each put still
    // runs the eviction and the cap holds.
    const ops: object[] = [{ op: 'store-open', path: db, max_bytes: 1200 }];
    for (let n = 1; n <= 4; n += 1) ops.push({ op: 'store-put', call: `call_fx${n}`, turn: turn(n), now: T0 - n * 100 });
    ops.push({ op: 'store-dump', path: db });
    const lines = await run(home, ops, { consts: { 'store.EVICT_EVERY_S': 0 } });
    const dump = lines[5];
    expect(dump.rows.reduce((s: number, r: Line) => s + (r.size as number), 0)).toBeLessThanOrEqual(1200);
  });

  it('a put evicts at most once a minute', async () => {
    const { home, db } = lane('cb-store-throttle-');
    const turn = (n: number): object => ({ items: [{ ...rs(n), encrypted_content: `ENC-${n}-${'x'.repeat(400)}` }], phase: null });
    // EVICT_EVERY_S stays at its default: the first put evicts (one row, within the cap) and the next three, milliseconds
    // later on the monotonic clock, do not, so the rows stand past the 1,200-byte cap until an explicit evict.
    const ops: object[] = [{ op: 'store-open', path: db, max_bytes: 1200 }];
    for (let n = 1; n <= 4; n += 1) ops.push({ op: 'store-put', call: `call_fx${n}`, turn: turn(n), now: T0 + n * 100 });
    ops.push({ op: 'store-dump', path: db }, { op: 'store-evict', now: T0 + 500 }, { op: 'store-dump', path: db });
    const lines = await run(home, ops);
    const total = (l: Line): number => l.rows.reduce((s: number, r: Line) => s + (r.size as number), 0);
    expect(lines[5].rows.length).toBe(4);
    expect(total(lines[5])).toBeGreaterThan(1200);
    expect(lines[6].evicted).toBe(2);
    expect(lines[7].rows.map((r: Line) => r.turn)).toEqual([turn(3), turn(4)]);
    expect(total(lines[7])).toBeLessThanOrEqual(1200);
  });

  it('the file is 0600 under a 0277 umask', async () => {
    const { home, db } = lane('cb-store-mode-');
    const [open, put, got, dump] = await run(home, [
      { op: 'store-open', path: db, umask: 0o277 },
      { op: 'store-put', call: 'call_fx1', turn: { items: [rs(1)], phase: null } },
      { op: 'store-get', call: 'call_fx1' },
      { op: 'store-dump', path: db },
    ]);
    expect(open.disabled).toBeNull();
    expect(put.disabled).toBeNull();
    expect(got.turn).toEqual({ items: [rs(1)], phase: null });
    expect(dump.userVersion).toBe(1);
    expect(dump.journalMode).toBe('wal');
    expect(statSync(db).mode & 0o777).toBe(0o600);
    // Measured while the store still holds its connection: sqlite removes both WAL files on the last close.
    expect(dump.modes).toEqual({ '': 0o600, '-wal': 0o600, '-shm': 0o600 });
  });

  it('a fifo at the store path disables the store and the request still succeeds', async () => {
    const { home, db } = lane('cb-store-fifo-');
    execFileSync('mkfifo', ['-m', '600', db]);
    const [open, put, got, replay] = await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-put', call: 'call_fx1', turn: { items: [rs(1)], phase: null } },
      { op: 'store-get', call: 'call_fx1' },
      {
        op: 'from-anthropic', lookup: 'store',
        body: { model: 'model-6.1-alpha', messages: [{ role: 'user', content: 'start' }] },
      },
    ], { timeoutMs: 15_000 });
    expect(open.disabled).toBe('store:not-a-regular-file');
    expect(put.disabled).toBe('store:not-a-regular-file');
    expect(got.turn).toBeNull();
    expect(replay.request.items.map((i: Line) => i.type)).toEqual(['message']);
  });

  it('a file swapped in after the start disables the store', async () => {
    const { home, db } = lane('cb-store-swap-');
    const other = path.join(home, 'other.sqlite');
    writeFileSync(other, '', { mode: 0o600 });
    const [open, put, , threads] = await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-put', call: 'call_fx1', turn: { items: [rs(1)], phase: null } },
      { op: 'store-swap', path: db, link_to: other },
      // A new thread opens its own connection: the path is no longer the file this store made.
      { op: 'store-threads', n: 1, each: 1 },
    ]);
    expect(open.disabled).toBeNull();
    expect(put.disabled).toBeNull();
    expect(threads.raised_in_threads).toEqual([]);
    expect(threads.disabled).toBe('store:replaced');
    expect(statSync(other).size).toBe(0);
  });

  it('a later reply of the same text with no reasoning replaces the earlier reasoning', async () => {
    const { home, db } = lane('cb-store-supersede-');
    const [, , , first, , , second, replay] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(1), msg(2, 'Done.')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-get', session: 's-1', text: 'Done.' },
      stream([msg(3, 'Done.')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-get', session: 's-1', text: 'Done.' },
      {
        op: 'from-anthropic', lookup: 'store', headers: { 'x-claude-code-session-id': 's-1' },
        body: {
          model: 'model-6.1-alpha',
          messages: [
            { role: 'user', content: 'one' }, { role: 'assistant', content: 'Done.' },
            { role: 'user', content: 'two' }, { role: 'assistant', content: 'Done.' },
            { role: 'user', content: 'three' },
          ],
        },
      },
    ]);
    expect(first.turn).toEqual({ items: [rs(1)], phase: null });
    expect(second.turn).toEqual({ items: [], phase: null });
    // The earlier turn's reasoning is not replayed before the later message.
    expect(replay.request.items.map((i: Line) => i.type)).not.toContain('reasoning');
  });

  it('a reply with no session id keeps no text row', async () => {
    const { home, db } = lane('cb-store-nosession-');
    const [, , , text, call, dump] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(1), fc(2, '{}'), rs(3), msg(4, 'Same words.', 'final_answer')]),
      { op: 'store-remember', session: null },
      { op: 'store-get', session: null, text: 'Same words.' },
      { op: 'store-get', call: 'call_fx2' },
      { op: 'store-dump', path: db },
    ]);
    // Every sessionless request shares one text scope, so a text row there would cross conversations.
    expect(text.turn).toBeNull();
    expect(call.turn).toEqual({ items: [rs(1)], phase: null });
    expect(dump.rows.length).toBe(1);
  });

  it('a symlink at the store path disables the store and the request still succeeds', async () => {
    const { home, db } = lane('cb-store-link-');
    const target = path.join(home, 'elsewhere.sqlite');
    symlinkSync(target, db);
    const [open, , remember, put, got, replay] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(1), fc(2, '{}')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-put', call: 'call_fx3', turn: { items: [rs(3)], phase: null } },
      { op: 'store-get', call: 'call_fx2' },
      {
        op: 'from-anthropic', lookup: 'store',
        body: {
          model: 'model-6.1-alpha',
          messages: [
            { role: 'user', content: 'start' },
            { role: 'assistant', content: [{ type: 'tool_use', id: 'call_fx2', name: 'probe_tool', input: {} }] },
          ],
        },
      },
    ]);
    expect(open.disabled).toBe('store:OSError');
    expect(remember.disabled).toBe('store:OSError');
    expect(put.disabled).toBe('store:OSError');
    expect(got.turn).toBeNull();
    expect(replay.request.items.map((i: Line) => i.type)).toEqual(['message', 'function_call']);
    expect(existsSync(target)).toBe(false);
  });

  it('a store from a newer version is never written', async () => {
    const { home, db } = lane('cb-store-newer-');
    await run(home, [{ op: 'store-plant', path: db, user_version: 2 }]);
    const before = sha(storeBytes(db));
    const [open, , remember, put, got, dump] = await run(home, [
      { op: 'store-open', path: db },
      stream([rs(1), fc(2, '{}')]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-put', call: 'call_fx3', turn: { items: [rs(3)], phase: null } },
      { op: 'store-get', call: 'call_fx3' },
      { op: 'store-dump', path: db },
    ]);
    expect(open.disabled).toBe('store:newer-version');
    expect(remember.disabled).toBe('store:newer-version');
    expect(put.disabled).toBe('store:newer-version');
    expect(got.turn).toBeNull();
    expect(dump.userVersion).toBe(2);
    expect(dump.rows).toEqual([]);
    expect(sha(storeBytes(db))).toBe(before);
    expect(existsSync(db + '-wal')).toBe(false);
  });

  it('nothing but reasoning items is stored', async () => {
    const { home, db } = lane('cb-store-only-');
    const reply = 'REPLY-TEXT-fx7 the words of the answer';
    const input = 'TOOL-INPUT-fx8-a-path-argument';
    const lines = await run(home, [
      { op: 'store-open', path: db },
      stream([
        { ...rs(1), summary: [] }, msg(2, reply, 'commentary'),
        { ...rs(3), summary: [{ type: 'summary_text', text: 'SUMMARY-TEXT-fx9 the reasoning in words' }] },
        fc(4, JSON.stringify({ path: input })),
        { type: 'reasoning', id: 'rs_fx5', summary: [], encrypted_content: 'ENC-5', extra: 'DROP-fx5' },
        msg(6, 'Second reply.'),
      ]),
      { op: 'store-remember', session: 's-1' },
      { op: 'store-dump', path: db },
    ]);
    const dump = lines[3];
    expect(dump.rows.length).toBe(3);
    for (const row of dump.rows as Line[]) {
      expect(row.key).not.toContain('REPLY-TEXT');
      expect(row.key).not.toContain('Second reply');
      expect(row.key).not.toContain(input);
      expect(Object.keys(row.turn).sort()).toEqual(['items', 'phase']);
      for (const item of row.turn.items as Line[]) {
        expect(Object.keys(item).sort()).toEqual(['encrypted_content', 'id', 'summary', 'type']);
        expect(item.type).toBe('reasoning');
        expect(item.summary).toEqual([]);
      }
    }
    const bytes = storeBytes(db).toString('latin1');
    for (const needle of [reply, 'REPLY-TEXT', 'Second reply', input, 'TOOL-INPUT', 'DROP-fx5', 'probe_tool', 'SUMMARY-TEXT']) {
      expect(bytes, needle).not.toContain(needle);
    }
    expect(bytes).toContain('ENC-1');
    expect(bytes).toContain('ENC-5');
  });

  it('two threads put and get through one store', async () => {
    const { home, db } = lane('cb-store-threads-');
    const [open, threads, dump] = await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-threads', n: 2, each: 50 },
      { op: 'store-dump', path: db },
    ]);
    expect(open.disabled).toBeNull();
    expect(threads.raised_in_threads).toEqual([]);
    expect(threads.mismatches).toBe(0);
    expect(threads.disabled).toBeNull();
    expect(dump.rows.length).toBe(100);
  });
});
