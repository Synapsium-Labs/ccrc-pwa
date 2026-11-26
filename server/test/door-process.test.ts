// Overlord W1 door process A2 (plan w1-door-process.md Task 5 Step 1 and Task 6): ccd/door-process.mjs, run as a real program
// against a STUB client (CCRC_API) that records every invocation (argv, stdin, the fence variables in its environment) and
// answers from files in its temp dir. The back-off cases run in-process with a fake clock. Fixture keys, nonces and ids only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import {
  DOOR_TOOLS, readToolOver, DELTA_LEASE_MS, CLAIM_RETRY_MIN_MS, CLAIM_RETRY_MAX_MS, MAX_LINE_BYTES, PROTOCOL_VERSIONS, createDoor,
} from '../../ccd/door-process.mjs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const PROGRAM = path.resolve(__dirname, '../../ccd/door-process.mjs');
const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const NONCE = '0123456789abcdef'.repeat(4);
const KEY = 'fedcba9876543210'.repeat(4);
const HASH = 'abcdef0123456789'.repeat(4);

type Entry = { argv: string[]; stdin: string; verb: string; nonce: string | null; key: string | null; gen: string | null;
  counter: string | null; wit: string | null; s: number; e: number };

/** The stub client. Verb names: `whoami`, `sessions-act-key`, `delta` (card --anchor), else argv[0]. Files in its dir:
 *  ans.<verb> (stdout), rc.<verb> (exit code), delay.<verb> (seconds to sleep). One JSON line a call goes to `log`, at the end. */
function writeStub(dir: string): string {
  const file = path.join(dir, 'client.sh');
  fs.writeFileSync(file, [
    '#!/bin/bash',
    `D='${dir}'`,
    'in=$(cat)',
    's=$(( $(date +%s%N) / 1000000 ))',
    'verb="$1"',
    '[ "$1" = sessions ] && verb="sessions-$2"',
    '[ "$1" = card ] && [ "$2" = --anchor ] && verb=delta',
    '[ "$verb" = sessions-act-key ] || true',
    '[ -f "$D/delay.$verb" ] && sleep "$(cat "$D/delay.$verb")"',
    'e=$(( $(date +%s%N) / 1000000 ))',
    'v() { if [ -n "${!1+x}" ]; then jq -Rn --arg v "${!1}" \'$v\'; else echo null; fi; }',
    'argv=$(printf \'%s\\n\' "$@" | jq -Rn \'[inputs]\')',
    'jq -cn --argjson argv "$argv" --arg stdin "$in" --arg verb "$verb" --argjson nonce "$(v CCRC_DOOR_NONCE)" \\',
    '  --argjson key "$(v CCRC_ACT_KEY)" --argjson gen "$(v CCRC_ACT_GENERATION)" --argjson counter "$(v CCRC_ACT_COUNTER)" --argjson wit "$(v CCRC_WITNESS_KEY)" \\',
    '  --argjson s "$s" --argjson e "$e" \'{argv:$argv,stdin:$stdin,verb:$verb,nonce:$nonce,key:$key,gen:$gen,counter:$counter,wit:$wit,s:$s,e:$e}\' >> "$D/log"',
    'rc=0; [ -f "$D/rc.$verb" ] && rc=$(cat "$D/rc.$verb")',
    'if [ -f "$D/ans.$verb" ]; then cat "$D/ans.$verb"; else',
    `  case "$verb" in whoami) echo '{"id":"${ID}","uuid":"${UUID}"}';; *) echo '{"ok":true}';; esac`,
    'fi',
    'exit $rc',
    '',
  ].join('\n'), { mode: 0o755 });
  return file;
}

let dir: string;
let stub: string;
let procs: Proc[] = [];
/** Every byte any spawned door wrote to stdout or stderr, across the whole file. */
const collected: string[] = [];

const put = (name: string, text: string): void => { fs.writeFileSync(path.join(dir, name), text); };
const answer = (verb: string, body: unknown): void => put(`ans.${verb}`, typeof body === 'string' ? body : JSON.stringify(body));
const claimGood = (): void => answer('sessions-act-key', { ok: true, generation: 3, key: KEY });
const log = (): Entry[] => {
  const p = path.join(dir, 'log');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Entry) : [];
};
const of = (verb: string): Entry[] => log().filter((e) => e.verb === verb);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean, what: string, ms = 8000): Promise<void> {
  const end = Date.now() + ms;
  while (!fn()) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}

type Rpc = { id?: number | string | null; result?: any; error?: { code: number; message: string } };
class Proc {
  child: ChildProcess;
  out = ''; err = '';
  private buf = '';
  private waiting = new Map<number, (m: Rpc) => void>();
  private nextId = 1;
  exited: Promise<number | null>;
  raw: Rpc[] = [];
  constructor(opts: { doorDir?: string; program?: string } = {}) {
    const env: Record<string, string> = {
      PATH: process.env['PATH'] ?? '', HOME: dir, CCRC_SESSION_ID: ID, CCRC_API: stub, CCRC_DOOR_NONCE: NONCE,
      // Stale fence variables in the process's own environment: no child may inherit them.
      CCRC_ACT_KEY: 'ab'.repeat(32), CCRC_ACT_GENERATION: '77', CCRC_ACT_COUNTER: '99', CCRC_WITNESS_KEY: 'cd'.repeat(32),
    };
    if (opts.doorDir !== undefined) env['CCRC_DOOR_DIR'] = opts.doorDir;
    this.child = spawn('node', [opts.program ?? PROGRAM], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdin!.on('error', () => {});
    this.child.stdout!.setEncoding('utf8');
    this.child.stderr!.setEncoding('utf8');
    this.child.stderr!.on('data', (d: string) => { this.err += d; });
    this.child.stdout!.on('data', (d: string) => {
      this.out += d; this.buf += d;
      let n: number;
      while ((n = this.buf.indexOf('\n')) >= 0) {
        const line = this.buf.slice(0, n); this.buf = this.buf.slice(n + 1);
        const m = JSON.parse(line) as Rpc;
        this.raw.push(m);
        const w = typeof m.id === 'number' ? this.waiting.get(m.id) : undefined;
        if (w) { this.waiting.delete(m.id as number); w(m); }
      }
    });
    this.exited = new Promise((res) => {
      this.child.on('close', (code) => { collected.push(this.out, this.err); res(code); });
    });
    procs.push(this);
  }
  write(line: string): void { this.child.stdin!.write(`${line}\n`); }
  rpc(method: string, params?: unknown): Promise<Rpc> {
    const id = this.nextId++;
    return new Promise((res) => { this.waiting.set(id, res); this.write(JSON.stringify({ jsonrpc: '2.0', id, method, params })); });
  }
  async call(name: string, args?: unknown): Promise<{ text: string; isError: boolean; error?: Rpc['error'] }> {
    const m = await this.rpc('tools/call', { name, arguments: args });
    if (m.error) return { text: '', isError: true, error: m.error };
    return { text: m.result.content[0].text as string, isError: m.result.isError as boolean };
  }
  async end(): Promise<number | null> { this.child.stdin!.end(); return this.exited; }
}

beforeEach(() => {
  dir = mkTmp('door-process-');
  stub = writeStub(dir);
  claimGood();
  procs = [];
});
afterEach(async () => {
  for (const p of procs) { p.child.kill('SIGKILL'); await p.exited; }
  removeTmpFixtures();
});

const rowByName = (n: string) => (DOOR_TOOLS as unknown as Array<{ name: string; input: unknown; fenced: boolean }>).find((r) => r.name === n)!;

describe('the door process: protocol', () => {
  it('initialize names the server door; tools/list is DOOR_TOOLS\' names and schemas', async () => {
    const p = new Proc();
    const init = await p.rpc('initialize', { protocolVersion: '2025-06-18' });
    expect(init.result.serverInfo.name).toBe('door');
    expect(init.result.capabilities).toEqual({ tools: {} });
    const list = await p.rpc('tools/list');
    const tools = list.result.tools as Array<{ name: string; description: string; inputSchema: unknown }>;
    const rows = DOOR_TOOLS as unknown as Array<{ name: string; input: unknown }>;
    expect(tools.map((t) => t.name)).toEqual(rows.map((r) => r.name));
    for (const t of tools) {
      expect(t.inputSchema, t.name).toEqual(JSON.parse(JSON.stringify(rowByName(t.name).input)));
      expect(typeof t.description).toBe('string');
    }
  });

  it('an unknown tool answers a JSON-RPC error, and nothing runs', async () => {
    const p = new Proc();
    const r = await p.call('no_such_tool', {});
    expect(r.error?.code).toBe(-32602);
    await until(() => log().length >= 1, 'the start-up whoami');
    await sleep(200);
    expect(log().map((e) => e.verb)).toEqual(['whoami']);
  });

  it('ping answers an empty result; initialize agrees to a version it knows and answers its own for any other (review 2735 F7)', async () => {
    const p = new Proc();
    expect((await p.rpc('ping')).result).toEqual({});
    expect((await p.rpc('initialize', { protocolVersion: PROTOCOL_VERSIONS[1] })).result.protocolVersion).toBe(PROTOCOL_VERSIONS[1]);
    expect((await p.rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion).toBe(PROTOCOL_VERSIONS[0]);
  });

  it('a line past MAX_LINE_BYTES is dropped with one parse error, and the next line is served (review 2735 F7)', async () => {
    const p = new Proc();
    // A valid request, once whole: a process that kept the line would answer id 99.
    p.child.stdin!.write('{"jsonrpc":"2.0","id":99,"method":"ping","params":{"pad":"');
    p.child.stdin!.write('x'.repeat(MAX_LINE_BYTES + 10));
    p.child.stdin!.write('y'.repeat(MAX_LINE_BYTES + 10));
    p.write('"}}');                             // the end of the long line: dropped with it
    expect((await p.rpc('ping')).result).toEqual({});
    expect(p.raw.filter((m) => m.id === null).map((m) => m.error?.code)).toEqual([-32700]);
    expect(p.raw.filter((m) => m.id === 99)).toEqual([]);
  });

  it('started through a linked ancestor directory, the program still serves (review 2735 F1)', async () => {
    const linked = path.join(dir, 'linked');
    fs.symlinkSync(path.dirname(PROGRAM), linked);
    const p = new Proc({ program: path.join(linked, path.basename(PROGRAM)) });
    p.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }));
    await until(() => p.raw.length > 0, 'an answer to initialize', 5000);
    expect(p.raw[0]!.result.serverInfo.name).toBe('door');
  });

  it('an unknown method with an id answers method-not-found; closing stdin ends the process within a short bound', async () => {
    const p = new Proc();
    const m = await p.rpc('resources/list');
    expect(m.error?.code).toBe(-32601);
    const t0 = Date.now();
    const code = await p.end();
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeLessThan(3000);
  });
});

describe('the door process: the claim and the fence', () => {
  it('the first fenced call claims with the nonce on the claim child\'s stdin, never argv; later calls do not claim', async () => {
    const p = new Proc();
    const r1 = await p.call('note_add', { kind: 'thread' });
    expect(r1.isError).toBe(false);
    const claims = of('sessions-act-key');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.argv).toEqual(['sessions', 'act-key', ID, '--json', '-']);
    expect(JSON.parse(claims[0]!.stdin)).toEqual({ fromId: ID, fromUuid: UUID, nonce: NONCE });
    expect(JSON.stringify(log().map((e) => e.argv))).not.toContain(NONCE);
    await p.call('timer_cancel', { id: 4 });
    await p.call('card', {});
    expect(of('sessions-act-key')).toHaveLength(1);
    // The claim itself, not being a fenced send, carries no fence.
    expect([claims[0]!.key, claims[0]!.gen, claims[0]!.counter]).toEqual([null, null, null]);
  });

  it('two calls sent at once make exactly one claim, and run one at a time with counters 1 then 2', async () => {
    put('delay.sessions-act-key', '0.3');
    put('delay.note', '0.3');
    put('delay.timer', '0.2');
    const p = new Proc();
    const a = p.call('note_add', {});
    const b = p.call('timer_cancel', { id: 4 });
    await Promise.all([a, b]);
    expect(of('sessions-act-key')).toHaveLength(1);
    const sends = log().filter((e) => e.verb === 'note' || e.verb === 'timer').sort((x, y) => x.s - y.s);
    expect(sends.map((e) => [e.verb, e.counter])).toEqual([['note', '1'], ['timer', '2']]);
    // One chain: no two client children overlap in time.
    const all = log().sort((x, y) => x.s - y.s);
    for (let i = 1; i < all.length; i += 1) expect(all[i]!.s, `${all[i]!.verb} started before ${all[i - 1]!.verb} ended`).toBeGreaterThanOrEqual(all[i - 1]!.e - 1);
  });

  it('no child holds the nonce; a fenced call\'s child carries the key, generation and counter; an unfenced call\'s carries none', async () => {
    const p = new Proc();
    await p.call('note_add', {});            // fenced, counter 1
    await p.call('probe', {});               // unfenced
    await p.call('timer_cancel', { id: 2 }); // fenced, counter 2
    await p.call('note_list', {});           // unfenced
    await p.call('timer_list', {});          // unfenced
    const l = log();
    expect(l.length).toBeGreaterThan(6);
    for (const e of l) expect(e.nonce, `${e.verb} child holds the nonce`).toBeNull();
    const fenced = l.filter((e) => e.verb === 'note' || e.verb === 'timer').filter((e) => e.argv[1] !== 'list');
    expect(fenced.map((e) => [e.key, e.gen, e.counter])).toEqual([[KEY, '3', '1'], [KEY, '3', '2']]);
    for (const e of l.filter((x) => ['probe', 'whoami', 'sessions-act-key'].includes(x.verb) || x.argv[1] === 'list')) {
      expect([e.key, e.gen, e.counter], `${e.verb} ${e.argv.join(' ')} carries the fence`).toEqual([null, null, null]);
    }
  });

  /** The witness key, computed independently of the program: sha256 of `mcp__door__<name>`, one newline and `jq -cS` of the input. */
  const expectedWitness = (name: string, input: unknown): string => {
    const r = spawnSync('jq', ['-cS', '.'], { input: JSON.stringify(input ?? {}), encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    return createHash('sha256').update(`mcp__door__${name}\n${r.stdout.replace(/\n$/, '')}`).digest('hex');
  };
  const HARD = { z: 1, a: { y: [1.5, 1e21, 12345678901234567890], b: 'caf\u00e9 \u0001 \ud83d\ude00' }, m: null };

  it('a fenced call\'s child carries CCRC_WITNESS_KEY, the digest the hook computes (question 6); an unfenced one, the claim and the whoami carry none', async () => {
    const p = new Proc();
    await p.call('note_add', HARD);
    await p.call('timer_cancel', { id: 2 });
    await p.call('probe', {});
    await p.call('note_list', {});
    await p.call('read', { door: 'card' });
    const l = log();
    expect(l.filter((e) => e.wit !== null).map((e) => [e.verb, e.wit])).toEqual([
      ['note', expectedWitness('note_add', HARD)], ['timer', expectedWitness('timer_cancel', { id: 2 })],
    ]);
    for (const e of l.filter((x) => ['probe', 'whoami', 'sessions-act-key', 'delta'].includes(x.verb) || x.argv[1] === 'list')) {
      expect(e.wit, `${e.verb} ${e.argv.join(' ')} carries a witness key`).toBeNull();
    }
    expect(expectedWitness('note_add', HARD)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('every card page carries its own witness key (gates B\'s F9: the page that completes the read is a write)', async () => {
    const p = new Proc();
    await p.call('card', {});
    await p.call('card', { page: 2, hash: HASH });
    expect(of('card').map((e) => e.wit)).toEqual([expectedWitness('card', {}), expectedWitness('card', { page: 2, hash: HASH })]);
  });

  it('an absent input hashes as {}, the same as an empty one; a call that gets no claim still carries its key', async () => {
    const p = new Proc();
    answer('sessions-act-key', { ok: false, error: 'unmeasured' });
    await p.call('note_handover');
    const h = of('note').find((e) => e.argv[1] === 'handover')!;
    expect(h.key, 'no claim, so no act key').toBeNull();
    expect(h.wit).toBe(expectedWitness('note_handover', {}));
  });

  it('no child inherits a witness key the process itself held: the stale one in its own environment reaches nobody', async () => {
    const p = new Proc();
    await p.call('probe', {});
    await p.call('note_add', {});
    for (const e of log()) expect(e.wit === 'cd'.repeat(32), `${e.verb} inherited the stale key`).toBe(false);
  });

  // Board B2 (call 1590): board and history are the readers' doors. Every other door, the fenced card and messages included, is
  // refused by the read tool before anything runs; a readable door runs its own row, unfenced (no key, no counter).
  it('read refuses every door that is not a reader\'s, and runs nothing; the board runs unfenced through it', async () => {
    const p = new Proc();
    const before = log().length;
    for (const input of [{ door: 'card' }, { door: 'messages', args: {} }, { door: 'note_list' }, { door: 'inbox' }, {}]) {
      const r = await p.call('read', input);
      expect(r.isError, JSON.stringify(input)).toBe(true);
      expect(r.text).toMatch(/not a readable door|door is the name of a readable door/);
    }
    expect(log().filter((e) => e.verb !== 'whoami' && e.verb !== 'delta').length - before).toBe(0);
    await p.call('read', { door: 'board' });
    const boards = log().slice(before).filter((e) => e.verb !== 'whoami' && e.verb !== 'delta');
    expect(boards).toHaveLength(1);
    expect([boards[0]!.argv, boards[0]!.key, boards[0]!.counter]).toEqual([['overlord', 'board'], null, null]);
  });

  it('read serves a row marked reader as that row\'s own argv and body, and never an unmarked, fenced or non-view one (a table with readers, in-process)', () => {
    const mk = (name: string, over: object = {}): any => ({ name, class: 'view', fenced: false, reader: true, input: { type: 'object' },
      argv: (i: any, self: string) => [name, self, ...(i.page ? ['--page', String(i.page)] : [])], body: (i: any) => ({ echoed: i }), ...over });
    const rows = [mk('board'), mk('history'), mk('messages', { reader: false }), mk('card', { fenced: true, reader: true }), mk('weird', { class: 'operate' })];
    const read = readToolOver(rows) as any;
    expect(read.input.properties.door).toEqual({ type: 'string', enum: ['board', 'history', 'card', 'weird'] });
    expect(read.argv({ door: 'board', args: { page: 2 } }, ID)).toEqual(['board', ID, '--page', '2']);
    expect(read.argv({ door: 'history' }, ID)).toEqual(['history', ID]);
    expect(read.body({ door: 'board', args: { page: 2 } })).toEqual({ echoed: { page: 2 } });
    for (const input of [{ door: 'messages' }, { door: 'card' }, { door: 'weird' }, { door: 'nothing' }, { door: 'board', args: [] }, { door: 'board', args: null }]) {
      expect(() => read.argv(input, ID), JSON.stringify(input)).toThrow();
    }
    expect(() => read.argv({ door: 'messages' }, ID)).toThrow(/not a readable door/);
    const none = readToolOver([mk('x', { reader: false })]) as any;
    expect(none.input.properties.door.enum).toBeUndefined();
    expect(() => none.argv({ door: 'x' }, ID)).toThrow(/no door is readable yet/);
  });

  it.each([1, 2, 3])('the card tool presents key, generation and a rising counter on page %i of 3', async (page) => {
    const p = new Proc();
    for (let n = 1; n <= page; n += 1) {
      const r = await p.call('card', n === 1 ? {} : { page: n, hash: HASH });
      expect(r.isError).toBe(false);
    }
    const cards = of('card');
    expect(cards).toHaveLength(page);
    expect(cards.map((e) => e.counter)).toEqual(Array.from({ length: page }, (_, i) => String(i + 1)));
    const last = cards[page - 1]!;
    expect(last.argv).toEqual(page === 1 ? ['card', '--door'] : ['card', '--door', '--page', String(page), '--hash', HASH]);
    expect([last.key, last.gen]).toEqual([KEY, '3']);
  });

  it('a probe or note_list call between two card pages takes no counter', async () => {
    const p = new Proc();
    await p.call('card', {});
    await p.call('probe', {});
    await p.call('note_list', {});
    await p.call('card', { page: 2, hash: HASH });
    const l = log();
    expect(l.filter((e) => e.verb === 'card').map((e) => e.counter)).toEqual(['1', '2']);
    expect(l.filter((e) => e.verb === 'probe' || (e.verb === 'note' && e.argv[1] === 'list')).map((e) => e.counter)).toEqual([null, null]);
  });

  it('a call that gets no usable claim is served without a key and takes no counter; the failed send\'s counter is never reused', async () => {
    const p = new Proc();
    await p.call('note_add', {});            // counter 1
    put('rc.note', '3');                     // the next send gets no answer
    const failed = await p.call('note_add', {});
    expect(failed.isError).toBe(true);
    put('rc.note', '0');
    await p.call('note_add', {});
    expect(of('note').map((e) => e.counter)).toEqual(['1', '2', '3']);
  });
});

describe('the door process: the sequence read (Overlord W1, sequence C)', () => {
  it('an unfenced view: the child carries no key, no counter and no witness key, and claims nothing', async () => {
    const p = new Proc();
    const r = await p.call('sequence', { after: 7, limit: 20 });
    expect(r.isError).toBe(false);
    const calls = of('overlord');
    expect(calls.map((e) => [e.argv, e.key, e.gen, e.counter, e.wit, e.nonce])).toEqual([
      [['overlord', 'sequence', '--after', '7', '--limit', '20'], null, null, null, null, null],
    ]);
    expect(of('sessions-act-key')).toEqual([]);
  });

  it('a cursor or limit outside its bounds, or an attribution field, is refused with no client call', async () => {
    const p = new Proc();
    for (const args of [{ after: -1 }, { limit: 0 }, { limit: 501 }, { after: '3' }, { byId: 'x' }]) {
      const r = await p.call('sequence', args);
      expect(r.isError, JSON.stringify(args)).toBe(true);
    }
    expect(of('overlord')).toEqual([]);
  });

  it('the client\'s ok:false is an error result, its text passed through', async () => {
    const p = new Proc();
    answer('overlord', { ok: false, error: 'not-the-overlord' });
    const r = await p.call('sequence', {});
    expect(r).toEqual({ text: '{"ok":false,"error":"not-the-overlord"}', isError: true });
  });
});

describe('the door process: refusals, errors and the cache', () => {
  it.each([
    ['fromUuid at the top', 'note_add', { fromUuid: 'x' }],
    ['fromUuid nested in an object', 'note_add', { key: { nested: { fromUuid: 'x' } } }],
    ['byUuid inside an array', 'probe_answer', { roundId: 'r-1', answers: [{ byUuid: 'x' }] }],
    ['byId at the top of an unfenced tool', 'note_list', { byId: 'x' }],
  ])('an input naming an attribution field (%s) is refused with no client call', async (_w, tool, args) => {
    const p = new Proc();
    const r = await p.call(tool, args);
    expect(r.isError).toBe(true);
    expect(r.text).toContain('attribution');
    expect(log().map((e) => e.verb)).toEqual(['whoami']);
  });

  it('a whoami naming another session refuses every call, fenced or not', async () => {
    answer('whoami', { id: 'lane-b-project-b', uuid: 'u-2' });
    const p = new Proc();
    for (const [tool, args] of [['note_list', {}], ['timer_list', {}], ['note_add', {}], ['card', {}]] as const) {
      const r = await p.call(tool, args);
      expect(r.isError, tool).toBe(true);
      expect(r.text).toContain('does not serve this session');
    }
    expect(log().map((e) => e.verb)).toEqual(['whoami']);
    expect(p.err).toContain('whoami does not name this session');
    expect(p.err, 'another session is not a failed read').not.toContain('could not be read');
  });

  it('a whoami that fails refuses the call that asked, and runs nothing else', async () => {
    put('rc.whoami', '3');
    const p = new Proc();
    const r = await p.call('timer_list', {});
    expect(r.isError).toBe(true);
    expect(r.text).toContain('could not be read');
    expect(log().every((e) => e.verb === 'whoami')).toBe(true);
  });

  it('a tool result is an error when the client says ok:false, when it exits non-zero, and not otherwise', async () => {
    const p = new Proc();
    answer('timer', { ok: false, error: 'nope' });
    const a = await p.call('timer_list', {});
    expect(a.isError).toBe(true);
    expect(JSON.parse(a.text)).toEqual({ ok: false, error: 'nope' });
    answer('timer', { ok: true });
    put('rc.timer', '3');
    expect((await p.call('timer_list', {})).isError).toBe(true);
    put('rc.timer', '0');
    const ok = await p.call('timer_list', {});
    expect(ok.isError).toBe(false);
    expect(JSON.parse(ok.text)).toEqual({ ok: true });
  });

  describe('the delta cache', () => {
    const cacheDir = (): string => path.join(dir, 'doordir');
    const cache = (): string => path.join(cacheDir(), 'delta');
    const fetches = (): number => of('delta').length;
    const TEXT = 'ccrc-delta: term 1 · generation 3 · card abcdef012345 · 0 runs';
    beforeEach(() => { fs.mkdirSync(cacheDir(), { mode: 0o700 }); });
    const delta = (body: unknown): void => answer('delta', body);
    const good = (text: string) => ({ ok: true, part: 'anchor', form: 'delta', hash: 'h', text });

    it('after a call the process writes the cache at 0600: v=1 at=<ms> until=<ms>, a lease of DELTA_LEASE_MS, then the text, by rename', async () => {
      delta(good(TEXT));
      const p = new Proc({ doorDir: cacheDir() });
      const t0 = Date.now();
      await p.call('timer_list', {});
      await until(() => fs.existsSync(cache()), 'the delta file');
      const body = fs.readFileSync(cache(), 'utf8');
      const m = /^v=1 at=(\d+) until=(\d+)\n/.exec(body);
      expect(m, body).not.toBeNull();
      expect(Number(m![2]) - Number(m![1])).toBe(DELTA_LEASE_MS);
      expect(Math.abs(Number(m![1]) - t0)).toBeLessThan(10_000);
      expect(body.slice(m![0].length)).toBe(TEXT);
      expect(fs.statSync(cache()).mode & 0o777).toBe(0o600);
      expect(fs.existsSync(path.join(cacheDir(), 'delta.tmp'))).toBe(false);
      expect(of('delta')[0]!.argv).toEqual(['card', '--anchor', '--form', 'delta']);
      // A second refresh replaces the file by rename: a new inode, never a rewrite in place.
      const ino = fs.statSync(cache()).ino;
      const before = fetches();
      delta(good('ccrc-delta: second'));
      await p.call('timer_list', {});
      await until(() => fs.readFileSync(cache(), 'utf8').endsWith('ccrc-delta: second') && fetches() > before, 'the second write');
      expect(fs.statSync(cache()).ino).not.toBe(ino);
      expect(fs.existsSync(path.join(cacheDir(), 'delta.tmp'))).toBe(false);
      expect(fs.statSync(cache()).mode & 0o777).toBe(0o600);
    });

    it('the process writes the cache once at its start, before any call (review 2735 F2)', async () => {
      delta(good(TEXT));
      const p = new Proc({ doorDir: cacheDir() });
      await until(() => fs.existsSync(cache()), 'the delta file at the start');
      expect(fs.readFileSync(cache(), 'utf8').endsWith(TEXT)).toBe(true);
      expect(log().map((e) => e.verb)).toEqual(['whoami', 'delta']);
      expect(p.raw).toEqual([]);
    });

    it('calls sent together are followed by one refresh, not one each (review 2735 F7)', async () => {
      delta(good(TEXT));
      put('delay.timer', '0.3');
      const p = new Proc({ doorDir: cacheDir() });
      await Promise.all([p.call('timer_list', {}), p.call('timer_list', {}), p.call('timer_list', {})]);
      await until(() => fetches() >= 2, 'the refresh after the calls');
      await sleep(500);
      expect(fetches(), 'the start\'s refresh and one after the three calls').toBe(2);
    });

    it('a dark answer writes an empty text', async () => {
      delta(good(TEXT));
      const p = new Proc({ doorDir: cacheDir() });
      await p.call('timer_list', {});
      await until(() => fs.existsSync(cache()), 'the delta file');
      const before = fetches();
      delta({ ok: true, part: 'anchor', form: 'delta', dark: true });
      await p.call('timer_list', {});
      await until(() => /^v=1 at=\d+ until=\d+\n$/.test(fs.readFileSync(cache(), 'utf8')) && fetches() > before, 'the empty text');
    });

    it('a failed fetch (exit 3) leaves the old file untouched', async () => {
      delta(good(TEXT));
      const p = new Proc({ doorDir: cacheDir() });
      await p.call('timer_list', {});
      await until(() => fs.existsSync(cache()), 'the delta file');
      const old = fs.readFileSync(cache(), 'utf8');
      const st = fs.statSync(cache());
      const before = fetches();
      put('rc.delta', '3');
      delta(good('ccrc-delta: must not be written'));   // even a good-looking answer: the exit code rules
      await p.call('timer_list', {});
      await until(() => fetches() > before, 'the failed fetch');
      await sleep(300);
      expect(fs.readFileSync(cache(), 'utf8')).toBe(old);
      expect(fs.statSync(cache()).ino).toBe(st.ino);
      expect(fs.statSync(cache()).mtimeMs).toBe(st.mtimeMs);
      expect(fs.existsSync(path.join(cacheDir(), 'delta.tmp'))).toBe(false);
    });
  });
});

describe('the claim\'s answers (in-process, a fake clock)', () => {
  let now = 0;
  const door = () => createDoor({ api: stub, self: ID, nonce: NONCE, dir: null, env: { PATH: process.env['PATH'] ?? '', HOME: dir }, now: () => now });
  beforeEach(() => { now = 1_000_000; });

  it('renewing keeps the nonce and retries only after a back-off that doubles from CLAIM_RETRY_MIN_MS to CLAIM_RETRY_MAX_MS', async () => {
    answer('sessions-act-key', { ok: false, error: 'renewing' });
    const d = door();
    const gaps = [1000, 2000, 4000, 8000, 16000, 30000, 30000];
    expect(gaps[0]).toBe(CLAIM_RETRY_MIN_MS);
    expect(gaps.at(-1)).toBe(CLAIM_RETRY_MAX_MS);
    let t = now;
    for (const gap of gaps) {
      const before = of('sessions-act-key').length;
      now = t;
      const served = await d.call('note_add', {});
      expect(of('sessions-act-key'), `claim at +${t - 1_000_000}`).toHaveLength(before + 1);
      expect(served!.isError).toBe(false);      // served without a key
      now = t + gap - 1;
      await d.call('note_add', {});
      expect(of('sessions-act-key'), `no claim before the ${gap} ms back-off has passed`).toHaveLength(before + 1);
      t += gap;
    }
    expect(of('note').every((e) => e.key === null && e.counter === null)).toBe(true);
    expect(d.state()).toMatchObject({ claimed: false, nonceHeld: true });
    // The nonce was kept: a good answer after the back-off claims.
    claimGood();
    now = t;
    await d.call('note_add', {});
    expect(d.state()).toMatchObject({ claimed: true, nonceHeld: false, generation: 3, counter: 1 });
    expect(of('note').at(-1)!.key).toBe(KEY);
  });

  it('a whoami that fails refuses only that call; the next call after the back-off asks again and is served (review 2735 F4)', async () => {
    put('rc.whoami', '3');
    const d = door();
    const a = await d.call('note_list', {});
    expect(a!.isError).toBe(true);
    expect(a!.text).toContain('could not be read');
    expect(of('whoami')).toHaveLength(1);
    now += CLAIM_RETRY_MIN_MS - 1;
    expect((await d.call('note_list', {}))!.isError).toBe(true);
    expect(of('whoami'), 'no ask inside the back-off').toHaveLength(1);
    put('rc.whoami', '0');
    now += 1;
    const b = await d.call('note_list', {});
    expect(b!.isError).toBe(false);
    expect(of('whoami')).toHaveLength(2);
    expect(d.state()).toMatchObject({ identified: true, refused: false });
  });

  it('a whoami naming another session refuses for the life of the process, whatever a later whoami would say (review 2735 F4)', async () => {
    answer('whoami', { id: 'lane-b-project-b', uuid: 'u-2' });
    const d = door();
    expect((await d.call('note_list', {}))!.text).toContain('does not serve this session');
    answer('whoami', { id: ID, uuid: UUID });
    now += 10 * CLAIM_RETRY_MAX_MS;
    expect((await d.call('note_list', {}))!.text).toContain('does not serve this session');
    expect(of('whoami')).toHaveLength(1);
    expect(of('note')).toHaveLength(0);
  });

  it('a whoami that fails at the start is asked again by the refresh after its back-off, so the cache is written with no tool call (review 2756 F1)', async () => {
    const cacheDir = path.join(dir, 'doordir');
    fs.mkdirSync(cacheDir, { mode: 0o700 });
    answer('delta', { ok: true, part: 'anchor', form: 'delta', hash: 'h', text: 'ccrc-delta: term 1' });
    put('rc.whoami', '3');
    const d = createDoor({ api: stub, self: ID, nonce: NONCE, dir: cacheDir, env: { PATH: process.env['PATH'] ?? '', HOME: dir }, now: () => now });
    await d.ready;
    await d.refreshDelta();
    expect(fs.existsSync(path.join(cacheDir, 'delta')), 'inside the back-off').toBe(false);
    put('rc.whoami', '0');
    now += CLAIM_RETRY_MIN_MS;
    await d.refreshDelta();
    expect(fs.readFileSync(path.join(cacheDir, 'delta'), 'utf8').endsWith('ccrc-delta: term 1')).toBe(true);
    expect(log().map((e) => e.verb)).toEqual(['whoami', 'whoami', 'delta']);
  });

  it('the claim reads whoami as the identity does: another session there refuses for good, a failed one only backs off (review 2756 F6)', async () => {
    const d = door();
    expect((await d.call('note_list', {}))!.isError).toBe(false);            // identified
    put('rc.whoami', '3');                                                      // a good-looking answer, but the exit fails
    expect((await d.call('note_add', {}))!.isError).toBe(false);              // served without a key
    expect(of('sessions-act-key')).toHaveLength(0);
    expect(d.state()).toMatchObject({ refused: false, nonceHeld: true });
    put('rc.whoami', '0');
    answer('whoami', { id: 'lane-b-project-b', uuid: 'u-2' });
    now += 10 * CLAIM_RETRY_MAX_MS;
    const r = await d.call('note_add', {});
    expect(r!.text).toContain('does not serve this session');
    expect(of('sessions-act-key')).toHaveLength(0);
    expect(of('note').map((e) => e.argv[1])).toEqual(['list', 'add']);       // the refused call sent nothing
    answer('whoami', { id: ID, uuid: UUID });
    expect((await d.call('note_list', {}))!.text).toContain('does not serve this session');
  });

  it('a claim\'s whoami with an empty uuid is a failure, never a claim (review 2756 F6)', async () => {
    const d = door();
    await d.call('note_list', {});
    answer('whoami', { id: ID, uuid: '' });
    await d.call('note_add', {});
    expect(of('sessions-act-key')).toHaveLength(0);
    expect(d.state()).toMatchObject({ refused: false, claimed: false });
  });

  it('no child gets the nonce from the base environment it was handed: the children\'s own removal (review 2735 F6)', async () => {
    const d = createDoor({ api: stub, self: ID, nonce: NONCE, dir: null, env: { PATH: process.env['PATH'] ?? '', HOME: dir, CCRC_DOOR_NONCE: NONCE }, now: () => now });
    await d.call('note_add', {});
    await d.call('timer_list', {});
    expect(log().length).toBeGreaterThan(3);
    for (const e of log()) expect(e.nonce, `${e.verb} child holds the nonce`).toBeNull();
  });

  it('a timer note holding a NUL is refused before anything runs, and takes no counter (review 2735 F7)', async () => {
    const d = door();
    const r = await d.call('timer_set', { after: '90m', note: 'a\u0000b' });
    expect(r!.isError).toBe(true);
    expect(r!.text).toContain('NUL');
    expect(of('timer')).toHaveLength(0);
    expect(d.state().counter).toBe(0);
  });

  it('stale-generation drops the nonce: no later claim, and reads still serve', async () => {
    answer('sessions-act-key', { ok: false, error: 'stale-generation' });
    const d = door();
    await d.call('note_add', {});
    expect(of('sessions-act-key')).toHaveLength(1);
    expect(d.state()).toMatchObject({ claimed: false, nonceHeld: false });
    now += 10 * CLAIM_RETRY_MAX_MS;
    claimGood();
    await d.call('note_add', {});
    await d.call('card', {});
    expect(of('sessions-act-key')).toHaveLength(1);
    const read = await d.call('note_list', {});
    expect(read!.isError).toBe(false);
    expect(of('note').concat(of('card')).every((e) => e.key === null && e.counter === null)).toBe(true);
  });

  it.each([
    ['sixty hex digits and four stars', 'f'.repeat(60) + '****'],
    ['sixty-four stars', '*'.repeat(64)],
    ['a redaction marker', '[redacted]'],
    ['uppercase hex', 'ABCDEF0123456789'.repeat(4)],
  ])('a claim answer whose key is not 64 hex (%s) is no key: it fails closed and keeps the nonce', async (_w, key) => {
    answer('sessions-act-key', { ok: true, generation: 3, key });
    const d = door();
    const r = await d.call('note_add', {});
    expect(r!.isError).toBe(false);
    expect(of('note')[0]!.key).toBeNull();
    expect(of('note')[0]!.counter).toBeNull();
    expect(d.state()).toMatchObject({ claimed: false, nonceHeld: true });
    now += CLAIM_RETRY_MIN_MS;
    await d.call('note_add', {});
    expect(of('sessions-act-key')).toHaveLength(2);      // the nonce was kept, so it asked again
  });
});

describe('the secrets', () => {
  it('started as a program, the process deletes the nonce from its own environment at once (review 2735 F6)', () => {
    const code = 'await import(pathToFileURL(process.argv[1]).href); process.stdout.write(`nonce-in-env=${"CCRC_DOOR_NONCE" in process.env}`); process.exit(0);';
    const r = spawnSync('node', ['--input-type=module', '-e', `import { pathToFileURL } from 'node:url'; ${code}`, PROGRAM], {
      env: { PATH: process.env['PATH'] ?? '', HOME: dir, CCRC_SESSION_ID: ID, CCRC_API: stub, CCRC_DOOR_NONCE: NONCE }, input: '', encoding: 'utf8', timeout: 20_000,
    });
    expect(r.stdout, r.stderr).toBe('nonce-in-env=false');
  });

  it('a claim and a malformed line leave neither the nonce nor the key on any spawned door\'s stdout or stderr', async () => {
    const p = new Proc();
    await p.call('note_add', { kind: 'thread' });
    await p.call('card', {});
    p.write(`{"x":"${NONCE}${KEY}`);           // unterminated JSON that carries both secrets
    p.write(`["${KEY}"]`);                     // JSON, not an object
    await until(() => p.raw.filter((m) => m.id === null).length >= 2, 'the parse errors');
    expect(p.raw.filter((m) => m.id === null).every((m) => m.error?.code === -32700)).toBe(true);
    expect(of('note')[0]!.key).toBe(KEY);      // the secret really flowed through this run
    await p.end();
    const all = collected.join('\n');
    expect(all.length).toBeGreaterThan(100);
    expect(all).not.toContain(NONCE);
    expect(all).not.toContain(KEY);
    expect(all).not.toContain(UUID);
  });
});
