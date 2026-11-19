// Overlord W1 door process A2 (plan w1-door-process.md Task 5 Step 1 and Task 6): ccd/door-process.mjs, run as a real program
// against a STUB client (CCRC_API) that records every invocation (argv, stdin, the fence variables in its environment) and
// answers from files in its temp dir. The back-off cases run in-process with a fake clock. Fixture keys, nonces and ids only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  DOOR_TOOLS, DELTA_LEASE_MS, CLAIM_RETRY_MIN_MS, CLAIM_RETRY_MAX_MS, createDoor,
} from '../../ccd/door-process.mjs';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const PROGRAM = path.resolve(__dirname, '../../ccd/door-process.mjs');
const ID = 'lane-a-project-a';
const UUID = '11111111-2222-3333-4444-555555555555';
const NONCE = '0123456789abcdef'.repeat(4);
const KEY = 'fedcba9876543210'.repeat(4);
const HASH = 'abcdef0123456789'.repeat(4);

type Entry = { argv: string[]; stdin: string; verb: string; nonce: string | null; key: string | null; gen: string | null;
  counter: string | null; s: number; e: number };

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
    '  --argjson key "$(v CCRC_ACT_KEY)" --argjson gen "$(v CCRC_ACT_GENERATION)" --argjson counter "$(v CCRC_ACT_COUNTER)" \\',
    '  --argjson s "$s" --argjson e "$e" \'{argv:$argv,stdin:$stdin,verb:$verb,nonce:$nonce,key:$key,gen:$gen,counter:$counter,s:$s,e:$e}\' >> "$D/log"',
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
  constructor(opts: { doorDir?: string } = {}) {
    const env: Record<string, string> = {
      PATH: process.env['PATH'] ?? '', HOME: dir, CCRC_SESSION_ID: ID, CCRC_API: stub, CCRC_DOOR_NONCE: NONCE,
      // Stale fence variables in the process's own environment: no child may inherit them.
      CCRC_ACT_KEY: 'ab'.repeat(32), CCRC_ACT_GENERATION: '77', CCRC_ACT_COUNTER: '99',
    };
    if (opts.doorDir !== undefined) env['CCRC_DOOR_DIR'] = opts.doorDir;
    this.child = spawn('node', [PROGRAM], { env, stdio: ['pipe', 'pipe', 'pipe'] });
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
  });

  it('a whoami that fails refuses every call too', async () => {
    put('rc.whoami', '3');
    const p = new Proc();
    expect((await p.call('timer_list', {})).isError).toBe(true);
    expect(log().map((e) => e.verb)).toEqual(['whoami']);
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
