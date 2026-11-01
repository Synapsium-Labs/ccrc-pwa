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
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
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

/** The driver's `store-caps` line: whether its python3 closes a connection without its checkpoint
 *  (`Connection.setconfig` and SQLITE_DBCONFIG_NO_CKPT_ON_CLOSE, Python 3.12 and later) and that interpreter's
 *  [major, minor]. Below 3.12, the driver's `walCall` close and the store's own close before a set-aside may
 *  checkpoint a damaged WAL into its file, so a case that needs that WAL left beside the copy cannot be built there,
 *  and skips (D-7676) — but only on a MEASURED older Python (OLD_PY): a probe that failed to answer (an import
 *  failure, a timeout, a renamed op) skips nothing, and the capability case below goes red on it. */
const CAPS_RUN = PY
  ? await runBridgeDriver(mkTmp('cb-store-caps-'), { ops: [{ op: 'store-caps' }] }, {}, { timeoutMs: 60_000 })
  : null;
const CAPS: Line | null = CAPS_RUN ? (driverLines(CAPS_RUN.stdout)[0] ?? null) : null;
const CAPS_PY: unknown = CAPS?.python;
const OLD_PY: boolean = Array.isArray(CAPS_PY) && CAPS_PY.length === 2
  && CAPS_PY.every((n) => Number.isInteger(n)) && (CAPS_PY[0] < 3 || (CAPS_PY[0] === 3 && CAPS_PY[1] < 12));

it.skipIf(!PY)('the capability probe answers, and a Python of 3.12 or later closes without its checkpoint', () => {
  expect(CAPS_RUN?.timedOut, CAPS_RUN?.stderr).toBe(false);
  expect(CAPS, `${CAPS_RUN?.stdout}\n${CAPS_RUN?.stderr}`).toMatchObject({ op: 'store-caps' });
  expect(CAPS?.raised, JSON.stringify(CAPS)).toBeUndefined();
  expect(CAPS_PY).toEqual([expect.any(Number), expect.any(Number)]);
  // Only a measured older Python may skip the WAL cases; 3.12 and later must have the close they need.
  if (!OLD_PY) expect(CAPS?.noCkptClose, JSON.stringify(CAPS)).toBe(true);
});

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

/** A set-aside copy's name in the lane directory (D-7676): the store's basename, `.damaged-`, a UTC stamp. */
const COPY_RE = /^reasoning\.sqlite\.damaged-\d{8}T\d{6}Z$/;
/** Every name in the lane directory that starts as a set-aside copy's does, sorted. */
const damaged = (dir: string): string[] => readdirSync(dir).filter((n) => n.startsWith('reasoning.sqlite.damaged-')).sort();
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** The stats file's per-process store entry as construction leaves it (D-7677). */
const STORE_OK = { state: 'ok', reason: null, at: null, setAside: null };

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
    // Never checked, never set aside (D-7676).
    expect(damaged(path.dirname(db))).toEqual([]);
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

describe.skipIf(!PY)('the start check: a damaged store is set aside and started fresh (D-7676, D-7677)', () => {
  const statsPath = (dir: string): string => path.join(dir, 'bridge.stats.json');
  const turn = { items: [rs(1)], phase: null };

  it('CONTROL: a healthy store with rows survives a restart, never set aside', async () => {
    const { home, dir, db } = lane('cb-store-start-ok-');
    await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-put', call: 'call_fx1', turn },
    ]);
    const [, open, got, snap] = await run(home, [
      { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
      { op: 'store-open', path: db, stats: true },
      { op: 'store-get', call: 'call_fx1' },
      { op: 'stats-snapshot' },
    ]);
    expect(open.disabled).toBeNull();
    expect(got.turn).toEqual(turn);
    expect(damaged(dir)).toEqual([]);
    expect(snap.doc.store).toEqual(STORE_OK);
    expect(snap.doc.outcomes).toEqual({});
  });

  it('NOT A DATABASE: a file whose bytes are not sqlite\'s is set aside, 0600, and the fresh store serves', async () => {
    const { home, dir, db } = lane('cb-store-start-nadb-');
    const [planted] = await run(home, [{ op: 'store-damage', path: db, how: 'not-a-database' }]);
    // Measured, not assumed: the class this shape raises is exactly sqlite3.DatabaseError.
    expect(planted.probe.raised).toBe('DatabaseError');
    const bytes = sha(readFileSync(db));
    expect(statSync(db).mode & 0o777).toBe(0o644);
    const [, open, put, got, snap] = await run(home, [
      { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
      { op: 'store-open', path: db, stats: true },
      { op: 'store-put', call: 'call_fx1', turn },
      { op: 'store-get', call: 'call_fx1' },
      { op: 'stats-snapshot' },
    ]);
    expect(open.disabled).toBeNull();
    expect(put.disabled).toBeNull();
    expect(got.turn).toEqual(turn);
    const copies = damaged(dir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(COPY_RE);
    const copy = path.join(dir, copies[0]);
    expect(statSync(copy).mode & 0o777).toBe(0o600);
    expect(sha(readFileSync(copy))).toBe(bytes);
    expect(snap.doc.outcomes).toEqual({ 'store:set-aside': 1 });
    expect(snap.doc.store).toMatchObject({ state: 'set-aside', reason: 'store:set-aside' });
    expect(snap.doc.store.at).toMatch(ISO);
    expect(snap.doc.store.setAside).toEqual({ at: snap.doc.store.at, found: planted.probe.raised, file: copies[0] });
  });

  it('DAMAGED INDEX OR PAGE: a store integrity_check does not pass is set aside, its rows not answered', async () => {
    // Measured: the stale index raises nothing and each check answers it in rows. On the 0xff page quick_check answers
    // in rows, and this box's SQLite raises exactly DatabaseError from integrity_check, which the start reads as damage
    // too; another SQLite may answer that page in rows instead, so the expected `found` is the probe's, as in NOT A
    // DATABASE. The page's pin is only that the probe's integrityCheck is not exactly `ok`: a probe that raised at
    // EITHER pragma (quick_check runs first, in the same try) leaves it null and satisfies the pin too, and its
    // quick_check is not pinned (fix round 3, F5); the start check's own integrity_check verdict is pinned by the
    // set-aside assertions that follow (fix round 4, G2). The stale index's pin is integrity_check's rows, never
    // quick_check's: whether quick_check counts an index's entries depends on the SQLite (measured: this box's 3.46.1
    // answers the incident's `wrong # of entries` from quick_check; the CI runner's answers `ok` to quick_check and
    // names the index only from integrity_check), which is why the start runs integrity_check.
    for (const how of ['stale-index', 'garbage-page'] as const) {
      const { home, dir, db } = lane(`cb-store-start-${how}-`);
      const [planted] = await run(home, [{ op: 'store-damage', path: db, how }]);
      expect(planted.probe.integrityCheck, how).not.toEqual(['ok']);
      if (how === 'stale-index') {
        expect(planted.probe.raised).toBeNull();
        expect(planted.probe.integrityCheck).not.toBeNull();
        expect(planted.probe.integrityCheck.join('\n')).toMatch(/index sqlite_autoindex_reasoning_1/);
      }
      const found: string = planted.probe.raised ?? 'integrity-check';
      const [, open, old, put, got, snap] = await run(home, [
        { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
        { op: 'store-open', path: db, stats: true },
        { op: 'store-get', call: 'call_fx1' },
        { op: 'store-put', call: 'call_fx9', turn },
        { op: 'store-get', call: 'call_fx9' },
        { op: 'stats-snapshot' },
      ]);
      expect(open.disabled, how).toBeNull();
      expect(old.turn, how).toBeNull();
      expect(put.disabled, how).toBeNull();
      expect(got.turn, how).toEqual(turn);
      // The start's own open put the store in WAL mode, so its copy may carry that WAL beside it.
      const copies = damaged(dir).filter((n) => COPY_RE.test(n));
      expect(copies, how).toHaveLength(1);
      for (const n of damaged(dir)) expect([copies[0], `${copies[0]}-wal`, `${copies[0]}-shm`], how).toContain(n);
      expect(snap.doc.store.setAside, how).toEqual({ at: snap.doc.store.at, found, file: copies[0] });
      expect(snap.doc.outcomes, how).toEqual({ 'store:set-aside': 1 });
    }
  });

  it('EQUAL COUNT: a torn index whose entry count still matches is set aside, though quick_check passes it', async () => {
    const { home, dir, db } = lane('cb-store-start-equal-');
    const [planted] = await run(home, [{ op: 'store-damage', path: db, how: 'equal-count' }]);
    // Measured: quick_check only counts the index's entries, so a REPLACE between the index page's save and its
    // restore (the store's own write: same count, a new rowid) passes it; integrity_check compares them with the table.
    expect(planted.probe.raised).toBeNull();
    expect(planted.probe.quickCheck).toEqual(['ok']);
    expect(planted.probe.integrityCheck).not.toEqual(['ok']);
    expect(planted.probe.integrityCheck.join('\n')).toMatch(/missing from index sqlite_autoindex_reasoning_1/);
    const [, open, old, put, got, snap] = await run(home, [
      { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
      { op: 'store-open', path: db, stats: true },
      { op: 'store-get', call: 'call_fx1' },
      { op: 'store-put', call: 'call_fx9', turn },
      { op: 'store-get', call: 'call_fx9' },
      { op: 'stats-snapshot' },
    ]);
    // Unchecked, the first get of the REPLACEd key raises DatabaseError and disables the store for the process.
    expect(open.disabled).toBeNull();
    expect(old.turn).toBeNull();
    expect(old.disabled).toBeNull();
    expect(put.disabled).toBeNull();
    expect(got.turn).toEqual(turn);
    const copies = damaged(dir).filter((n) => COPY_RE.test(n));
    expect(copies).toHaveLength(1);
    expect(snap.doc.store).toMatchObject({ state: 'set-aside', reason: 'store:set-aside' });
    expect(snap.doc.store.setAside).toEqual({ at: snap.doc.store.at, found: 'integrity-check', file: copies[0] });
    expect(snap.doc.outcomes).toEqual({ 'store:set-aside': 1 });
  });

  // Skipped on a measured Python below 3.12 (OLD_PY): there the damaged WAL may be checkpointed into the file, not left.
  it.skipIf(OLD_PY)('a damaged store\'s WAL goes with its copy, which still answers its row', async () => {
    const { home, dir, db } = lane('cb-store-start-wal-');
    const [planted] = await run(home, [{ op: 'store-damage', path: db, how: 'stale-index', walCall: 'call_fx_wal' }]);
    expect(planted.probe.integrityCheck.join('\n')).toMatch(/index sqlite_autoindex_reasoning_1/); // not quick_check: see above
    expect(existsSync(db + '-wal')).toBe(true);
    const wal = sha(readFileSync(db + '-wal'));
    const [open, got] = await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-get', call: 'call_fx_wal' },
    ]);
    expect(open.disabled).toBeNull();
    // Not the rename's doing: sqlite deletes a WAL left beside a 0-byte database at its first open (measured), so the
    // fresh store would not answer the row either way. The rename is pinned by the copy's `-wal` assertions below.
    expect(got.turn).toBeNull();
    const copies = damaged(dir).filter((n) => COPY_RE.test(n));
    expect(copies).toHaveLength(1);
    const copy = path.join(dir, copies[0]);
    // The copy's WAL sits beside it, byte for byte the one the damaged store had (never checkpointed into the copy).
    expect(existsSync(copy + '-wal')).toBe(true);
    expect(sha(readFileSync(copy + '-wal'))).toBe(wal);
    // The copy and its WAL open as one database that still holds the row.
    const [keys, dump] = await run(home, [
      { op: 'inbound-keys', call: ['call_fx_wal'] },
      { op: 'store-dump', path: copy },
    ]);
    expect(dump.rows.map((r: Line) => r.key)).toContain(keys.call[0]);
  });

  // Skipped on a measured Python below 3.12 (OLD_PY): its first start's copy is pinned to keep a WAL beside it.
  it.skipIf(OLD_PY)('RETENTION: two damaged starts in a row leave only the newest copy and its siblings', async () => {
    const { home, dir, db } = lane('cb-store-start-keep-');
    // An older copy and a stray sibling of another, both in the copy's name shape; two names outside it stay.
    for (const n of ['reasoning.sqlite.damaged-20200101T000000Z', 'reasoning.sqlite.damaged-20200101T000000Z-wal',
      'reasoning.sqlite.damaged-20200102T000000Z-shm', 'reasoning.sqlite.damaged-notes',
      'other.sqlite.damaged-20200101T000000Z']) writeFileSync(path.join(dir, n), 'old', { mode: 0o600 });
    await run(home, [{ op: 'store-damage', path: db, how: 'stale-index', walCall: 'call_fx_wal' }, { op: 'store-open', path: db }]);
    const first = damaged(dir).filter((n) => COPY_RE.test(n));
    expect(first).toHaveLength(1);
    expect(first[0]).not.toBe('reasoning.sqlite.damaged-20200101T000000Z');
    // The first start already removed the older copy and the stray sibling; its own copy keeps its WAL.
    expect(damaged(dir).filter((n) => n.includes('2020'))).toEqual([]);
    expect(existsSync(path.join(dir, first[0] + '-wal'))).toBe(true);
    // The stamp has one-second resolution: the second start waits past it, so its copy has a name of its own.
    await run(home, [
      { op: 'sleep', s: 1.1 },
      { op: 'store-damage', path: db, how: 'not-a-database' },
      { op: 'store-open', path: db },
    ]);
    const second = damaged(dir).filter((n) => COPY_RE.test(n));
    expect(second).toHaveLength(1);
    expect(second[0]).not.toBe(first[0]);
    // The first copy's WAL went with it; nothing of the older copies is left but the two names outside the shape.
    expect(damaged(dir)).toEqual([second[0], 'reasoning.sqlite.damaged-notes'].sort());
    expect(existsSync(path.join(dir, 'other.sqlite.damaged-20200101T000000Z'))).toBe(true);
  });

  it('LOCKED: a store another connection holds is disabled as OperationalError, never set aside', async () => {
    const { home, dir, db } = lane('cb-store-start-locked-');
    await run(home, [
      { op: 'store-open', path: db },
      { op: 'store-put', call: 'call_fx1', turn },
    ]);
    const ino = statSync(db).ino;
    const before = sha(storeBytes(db));
    const [, , open, , snap] = await run(home, [
      { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
      { op: 'store-lock', path: db },
      { op: 'store-open', path: db, stats: true },
      { op: 'store-unlock' },
      { op: 'stats-snapshot' },
    ], { consts: { 'store.BUSY_TIMEOUT_S': 0.2 } });
    expect(open.disabled).toBe('store:OperationalError');
    expect(damaged(dir)).toEqual([]);
    expect(statSync(db).ino).toBe(ino);
    expect(sha(storeBytes(db))).toBe(before);
    expect(snap.doc.store).toMatchObject({ state: 'disabled', reason: 'store:OperationalError', setAside: null });
    expect(snap.doc.outcomes).toEqual({ 'store:OperationalError': 1 });
  });

  it('SET-ASIDE FAILS: a rename that fails disables the store as set-aside-failed, and requests are still served', async () => {
    const { home, dir, db } = lane('cb-store-start-fail-');
    await run(home, [{ op: 'store-damage', path: db, how: 'not-a-database' }]);
    const bytes = sha(readFileSync(db));
    const [, , open, put, got, replay, snap] = await run(home, [
      { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
      { op: 'stats-fault', call: 'rename', errno: 'EACCES', times: 1 },
      { op: 'store-open', path: db, stats: true },
      { op: 'store-put', call: 'call_fx1', turn },
      { op: 'store-get', call: 'call_fx1' },
      {
        op: 'from-anthropic', lookup: 'store',
        body: { model: 'model-6.1-alpha', messages: [{ role: 'user', content: 'start' }] },
      },
      { op: 'stats-snapshot' },
    ]);
    expect(open.disabled).toBe('store:set-aside-failed');
    expect(put.disabled).toBe('store:set-aside-failed');
    expect(got.turn).toBeNull();
    expect(replay.request.items.map((i: Line) => i.type)).toEqual(['message']);
    expect(damaged(dir)).toEqual([]);
    expect(sha(readFileSync(db))).toBe(bytes);
    expect(snap.doc.store).toMatchObject({ state: 'disabled', reason: 'store:set-aside-failed', setAside: null });
    expect(snap.doc.outcomes).toEqual({ 'store:set-aside-failed': 1 });
  });

  it('SET-ASIDE FAILS AFTER ITS RENAMES: the fresh store failing names the copy and what was found', async () => {
    const { home, dir, db } = lane('cb-store-start-fail-fresh-');
    await run(home, [{ op: 'store-damage', path: db, how: 'not-a-database' }]);
    const bytes = sha(readFileSync(db));
    // The start's first os.open is the damaged file's own `_create`; the second is the fresh store's, which fails.
    const [, , open, put, got, snap] = await run(home, [
      { op: 'stats-open', path: statsPath(dir), lane: 'lane-a' },
      { op: 'stats-fault', call: 'open', errno: 'EACCES', times: 1, skip: 1 },
      { op: 'store-open', path: db, stats: true },
      { op: 'store-put', call: 'call_fx1', turn },
      { op: 'store-get', call: 'call_fx1' },
      { op: 'stats-snapshot' },
    ]);
    expect(open.disabled).toBe('store:set-aside-failed');
    expect(put.disabled).toBe('store:set-aside-failed');
    expect(got.turn).toBeNull();
    const copies = damaged(dir);
    expect(copies).toHaveLength(1);
    expect(copies[0]).toMatch(COPY_RE);
    expect(sha(readFileSync(path.join(dir, copies[0])))).toBe(bytes);
    expect(existsSync(db)).toBe(false);
    expect(snap.doc.store).toMatchObject({ state: 'disabled', reason: 'store:set-aside-failed' });
    expect(snap.doc.store.setAside).toEqual({ at: snap.doc.store.at, found: 'DatabaseError', file: copies[0] });
    expect(snap.doc.outcomes).toEqual({ 'store:set-aside-failed': 1 });
  });
});
