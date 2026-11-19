// Overlord W1 door process A2 (plan w1-door-process.md Task 5 Step 1): each DOOR_TOOLS row's argv, run through the REAL
// ccd/ccrc-api (a stub tmux naming the fixture session, a fixture registry uuid, a fixture server URL and token) against a
// recording curl, reaches the row's route (method and path from ROUTES) with the row's query and body; and the fence's three
// header lines ride curl's stdin config, never its argv. FIXTURE HOME only.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { DOOR_TOOLS } from '../../ccd/door-process.mjs';
import { harnessBin } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

type Row = { name: string; verb: string; argv: (i: unknown, self: string) => string[]; body?: (i: unknown) => unknown };
const ROWS = DOOR_TOOLS as unknown as Row[];
const ROOT = path.resolve(__dirname, '../..');
const TOKEN = 'z'.repeat(64);
const ID = 'lane-a-project-a';
const UUID = 'u-door-1';
const KEY = 'fedcba9876543210'.repeat(4);
const HASH = 'abcdef0123456789'.repeat(4);
const REAL_CURL = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/curl';

let home: string;
let server: Server;
let seen: { method: string; url: URL; body: string; headers: Record<string, string | string[] | undefined> }[];

beforeEach(async () => {
  home = mkTmp('door-tools-argv-');
  seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: new URL(req.url ?? '/', 'http://x'), body, headers: req.headers });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
  const bin = harnessBin(home);
  fs.writeFileSync(path.join(bin, 'tmux'), `#!/bin/sh\nprintf 'cc-${ID}\\n'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${ID}.uuid`), `${UUID}\n`);
  // The recording curl: its own command line, then its stdin; the real curl runs on that stdin.
  fs.writeFileSync(path.join(bin, 'curl'), [
    '#!/bin/sh',
    'if [ -r /proc/$$/cmdline ]; then tr \'\\000\' \'\\n\' < /proc/$$/cmdline > "$HOME/curl.cmdline"; else printf \'%s\\n\' "$0" "$@" > "$HOME/curl.cmdline"; fi',
    'cat > "$HOME/curl.stdin"',
    `exec '${REAL_CURL}' "$@" < "$HOME/curl.stdin"`,
    '',
  ].join('\n'), { mode: 0o755 });
});
afterEach(async () => {
  await new Promise<void>((r) => { server.close(() => r()); });
  removeTmpFixtures();
});

const row = (name: string): Row => ROWS.find((r) => r.name === name)!;
const cmdline = (): string => fs.readFileSync(path.join(home, 'curl.cmdline'), 'utf8');
const stdin = (): string => fs.readFileSync(path.join(home, 'curl.stdin'), 'utf8');

/** Run a row's own argv (and body, if it has one) through the real client, as the door process's child would. */
async function door(name: string, input: unknown, env: Record<string, string | undefined> = {}): Promise<Run> {
  const r = row(name);
  const body = r.body ? JSON.stringify(r.body(input)) : undefined;
  return runClient(home, r.argv(input, ID), body, { TMUX_PANE: '%7', CCRC_API_STATUS: undefined, ...env });
}

/** ccd/ccrc-api's ROUTES row for a verb: its method and path template. */
function route(verb: string): { method: string; tmpl: string } {
  const text = fs.readFileSync(path.join(ROOT, 'ccd/ccrc-api'), 'utf8');
  const m = new RegExp(`^\\s+\\[${verb.replace('.', '\\.')}\\]='([A-Z]+)\\|([^|]+)\\|`, 'm').exec(text);
  expect(m, verb).not.toBeNull();
  return { method: m![1]!, tmpl: m![2]! };
}
const q = (u: URL): Record<string, string> => Object.fromEntries(u.searchParams.entries());
const PAIR = { byId: ID, byUuid: UUID };

/** One request must have arrived, on the row's own route. */
function arrived(verb: string, id: string = ID): (typeof seen)[number] {
  expect(seen).toHaveLength(1);
  const { method, tmpl } = route(verb);
  expect([seen[0]!.method, seen[0]!.url.pathname]).toEqual([method, tmpl.replace('{id}', id)]);
  return seen[0]!;
}

describe('every DOOR_TOOLS row, through the real ccrc-api, reaches its route', () => {
  it('card (no page): GET with page 1, door=1 and the pane\'s pair; no hash', async () => {
    const r = await door('card', {});
    expect(r.status, r.stderr).toBe(0);
    expect(q(arrived('sessions.card').url)).toEqual({ ...PAIR, page: '1', door: '1' });
  });

  it('card (page 2 and a hash): the query carries page, hash and door=1', async () => {
    const r = await door('card', { page: 2, hash: HASH });
    expect(r.status, r.stderr).toBe(0);
    expect(q(arrived('sessions.card').url)).toEqual({ ...PAIR, page: '2', hash: HASH, door: '1' });
  });

  it('probe: GET with the page and door=1', async () => {
    const r = await door('probe', { page: 2 });
    expect(r.status, r.stderr).toBe(0);
    expect(q(arrived('sessions.probe').url)).toEqual({ ...PAIR, page: '2', door: '1' });
  });

  it('probe_answer: POST, the answers on the stdin config, the pane\'s pair appended last', async () => {
    const input = { roundId: 'r-7', answers: [{ id: 'q1', text: 'a "quoted" answer' }] };
    const r = await door('probe_answer', input);
    expect(r.status, r.stderr).toBe(0);
    const s = arrived('probe.answer');
    expect(JSON.parse(s.body)).toEqual({ ...input, ...PAIR });
    expect(Object.keys(JSON.parse(s.body)).slice(-2)).toEqual(['byId', 'byUuid']);
    expect(stdin()).toContain('data-raw = "');
    expect(cmdline()).not.toContain('quoted');
  });

  it('note_add: POST to the notes route with the note and the pair', async () => {
    const input = { key: { kind: 'run', id: 12 }, kind: 'thread', waitsOn: 'a review', next: 'merge' };
    const r = await door('note_add', input);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(arrived('note.add').body)).toEqual({ ...input, ...PAIR });
  });

  it('note_close: POST { revises, closes: true } and the pair', async () => {
    const r = await door('note_close', { revises: 5 });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(arrived('note.close').body)).toEqual({ revises: 5, closes: true, ...PAIR });
  });

  it('note_list: GET with before, limit and the pair in the query, no body', async () => {
    const r = await door('note_list', { before: 9, limit: 3 });
    expect(r.status, r.stderr).toBe(0);
    const s = arrived('note.list');
    expect(q(s.url)).toEqual({ before: '9', limit: '3', ...PAIR });
    expect(s.body).toBe('');
  });

  it('note_handover: POST to the handover route with the note and the pair', async () => {
    const input = { text: 'where I stand' };
    const r = await door('note_handover', input);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(arrived('note.handover').body)).toEqual({ ...input, ...PAIR });
  });

  it('timer_set (a run): POST /api/timers with the duration in ms, the note, the run and the pair', async () => {
    const r = await door('timer_set', { after: '90m', note: 'wake me', run: 4 });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(arrived('timer.set').body)).toEqual({ fromId: ID, fromUuid: UUID, durationMs: 5_400_000, note: 'wake me', runId: 4 });
  });

  it('timer_set (a programme)', async () => {
    const r = await door('timer_set', { after: '2h', note: 'check', programme: 'prog-a' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(arrived('timer.set').body)).toEqual({ fromId: ID, fromUuid: UUID, durationMs: 7_200_000, note: 'check', programme: 'prog-a' });
  });

  it('timer_list: GET /api/timers with the pair in the query', async () => {
    const r = await door('timer_list', {});
    expect(r.status, r.stderr).toBe(0);
    expect(q(arrived('timer.list').url)).toEqual(PAIR);
  });

  it('timer_cancel: POST /api/timers/7/cancel with the pair in the body', async () => {
    const r = await door('timer_cancel', { id: 7 });
    expect(r.status, r.stderr).toBe(0);
    const s = arrived('timer.cancel', '7');
    expect(s.url.pathname).toBe('/api/timers/7/cancel');
    expect(JSON.parse(s.body)).toEqual({ fromId: ID, fromUuid: UUID });
  });

  it('covers every row of the table', () => {
    const covered = ['card', 'probe', 'probe_answer', 'note_add', 'note_close', 'note_list', 'note_handover', 'timer_set', 'timer_list', 'timer_cancel'];
    expect(ROWS.map((r) => r.name)).toEqual(covered);
  });
});

describe('the fence rides curl\'s stdin config', () => {
  const FENCE = { CCRC_ACT_KEY: KEY, CCRC_ACT_GENERATION: '3', CCRC_ACT_COUNTER: '12' };

  it('a fenced call with all three set puts three header lines on the stdin config and none on the argv', async () => {
    const r = await door('note_close', { revises: 5 }, FENCE);
    expect(r.status, r.stderr).toBe(0);
    const cfg = stdin();
    expect(cfg).toContain(`header = "x-ccrc-act-key: ${KEY}"`);
    expect(cfg).toContain('header = "x-ccrc-act-generation: 3"');
    expect(cfg).toContain('header = "x-ccrc-act-counter: 12"');
    const argv = cmdline();
    expect(argv).not.toContain(KEY);
    expect(argv.toLowerCase()).not.toContain('x-ccrc-act');
    expect(argv).not.toContain(TOKEN);
    // And they reached the server as headers.
    expect([seen[0]!.headers['x-ccrc-act-key'], seen[0]!.headers['x-ccrc-act-generation'], seen[0]!.headers['x-ccrc-act-counter']]).toEqual([KEY, '3', '12']);
  });

  it('an unfenced environment adds none', async () => {
    const r = await door('note_close', { revises: 5 });
    expect(r.status, r.stderr).toBe(0);
    expect(stdin().toLowerCase()).not.toContain('x-ccrc-act');
    expect(seen[0]!.headers['x-ccrc-act-key']).toBeUndefined();
  });

  it.each([
    ['a key of 63 hex digits', { CCRC_ACT_KEY: KEY.slice(1) }],
    ['an uppercase key', { CCRC_ACT_KEY: KEY.toUpperCase() }],
    ['a key with a non-hex digit', { CCRC_ACT_KEY: `${KEY.slice(1)}g` }],
    ['a zero generation', { CCRC_ACT_GENERATION: '0' }],
    ['a non-numeric generation', { CCRC_ACT_GENERATION: 'abc' }],
    ['an empty generation', { CCRC_ACT_GENERATION: '' }],
    ['a counter with a leading zero', { CCRC_ACT_COUNTER: '012' }],
    ['a negative counter', { CCRC_ACT_COUNTER: '-1' }],
    ['an empty counter', { CCRC_ACT_COUNTER: '' }],
  ])('%s adds none of the three headers', async (_w, bad) => {
    const r = await door('note_close', { revises: 5 }, { ...FENCE, ...bad });
    expect(r.status, r.stderr).toBe(0);
    expect(stdin().toLowerCase()).not.toContain('x-ccrc-act');
    expect(cmdline().toLowerCase()).not.toContain('x-ccrc-act');
    expect([seen[0]!.headers['x-ccrc-act-key'], seen[0]!.headers['x-ccrc-act-generation'], seen[0]!.headers['x-ccrc-act-counter']]).toEqual([undefined, undefined, undefined]);
  });
});
