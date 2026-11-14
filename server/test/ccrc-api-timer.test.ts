// Overlord W1a, the timers piece, PR D (plan `w1a-timers.md` Task 11): `ccrc-api timer set <duration> <note> [--run <id> |
// --programme <slug>]`, `timer list` and `timer cancel <id>`. All three derive the identity pair from the pane and refuse a
// typed one (slug timer-verbs-derive-identity); `set` builds its body whole with `jq --arg` (slug timer-body-built-by-jq) and
// refuses `no-jq` without it. On a CURRENT cap file that omits `timers-v1` every verb answers `capability-missing`, naming the
// word in `detail`, and sends nothing; an absent or stale file sends, as every gate in the client does (slug
// timer-gate-fails-open-like-every-gate). A stub server records each request; FIXTURE HOMEs only, the client runs with the
// contained PATH `ccrcApiClient.ts` builds.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { renderServerCaps, SERVER_CAPS, SERVER_CAPS_FILE } from '../../shared/api.js';
import { harnessBin } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'k'.repeat(64);
const PANE_ID = 'lane-a-project-a';
const PANE_UUID = 'u-timer-1';
const WORD = 'timers-v1';
const CAPABILITY_MISSING = {
  ok: false, error: 'capability-missing',
  detail: 'the server this box talks to does not keep timers yet (it does not advertise timers-v1); no timer was set',
};

let home: string;
let tmp: string;
let server: Server;
let seen: { method: string; url: URL; token: string | undefined; body: string }[];

beforeEach(async () => {
  home = mkTmp('ccrc-api-timer-home-');
  tmp = mkTmp('ccrc-api-timer-tmp-');
  seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const token = req.headers['x-ccrc-mail-token'];
      seen.push({ method: req.method ?? '', url: new URL(req.url ?? '/', 'http://x'), token: typeof token === 'string' ? token : undefined, body });
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: 12, dueAt: 1 }));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
  fs.writeFileSync(path.join(harnessBin(home), 'tmux'), `#!/bin/sh\nprintf 'cc-${PANE_ID}\\n'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${PANE_ID}.uuid`), `${PANE_UUID}\n`);
});

afterEach(async () => {
  await new Promise<void>((r) => { server.close(() => r()); });
});

const run = (args: string[], env: Record<string, string | undefined> = {}): Promise<Run> =>
  runClient(home, ['timer', ...args], undefined, { TMPDIR: tmp, TMUX_PANE: '%7', CCRC_API_STATUS: undefined, ...env });
const capFile = (): string => path.join(home, '.ccrc', SERVER_CAPS_FILE);
const nowS = (): number => Math.floor(Date.now() / 1000);
const writeCaps = (words: readonly string[], at = nowS()): void => { fs.writeFileSync(capFile(), renderServerCaps(words, at)); };
const refused = (r: Run): { status: number; body: unknown } => ({ status: r.status, body: JSON.parse(r.stdout) as unknown });
const sentBody = (i = 0): Record<string, unknown> => JSON.parse(seen[i]!.body) as Record<string, unknown>;

describe('ccrc-api timer set', () => {
  it('posts the duration in milliseconds and the note, with the pane\'s pair, and prints the answer', async () => {
    const r = await run(['set', '2h', 'check the checks']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('{"ok":true,"id":12,"dueAt":1}\n');
    expect(seen.map((s) => [s.method, s.url.pathname, s.url.search, s.token])).toEqual([['POST', '/api/timers', '', TOKEN]]);
    expect(sentBody()).toEqual({ fromId: PANE_ID, fromUuid: PANE_UUID, durationMs: 7_200_000, note: 'check the checks' });
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it.each([['90m', 5_400_000], ['1m', 60_000], ['3d', 259_200_000], ['45d', 3_888_000_000]])('%s is %d ms; the bounds are the server\'s', async (d, ms) => {
    expect((await run(['set', d, 'n'])).status).toBe(0);
    expect(sentBody().durationMs).toBe(ms);
  });

  it('a note carrying control characters, quotes and backslashes posts valid JSON that reads back as the note', async () => {
    const note = 'a\x01b\x1bc "q" \\ d\te\nf';
    expect((await run(['set', '2h', note])).status).toBe(0);
    expect(sentBody().note).toBe(note);
    expect(seen[0]!.body).not.toMatch(/[\x00-\x1f]/);
  });

  it('--run 7 adds runId 7, a number; --programme prog-a adds the programme; both at once are refused, unsent', async () => {
    await run(['set', '2h', 'n', '--run', '7']);
    expect(sentBody(0)).toEqual({ fromId: PANE_ID, fromUuid: PANE_UUID, durationMs: 7_200_000, note: 'n', runId: 7 });
    await run(['set', '2h', 'n', '--programme', 'prog-a']);
    expect(sentBody(1)).toEqual({ fromId: PANE_ID, fromUuid: PANE_UUID, durationMs: 7_200_000, note: 'n', programme: 'prog-a' });
    seen = [];
    for (const args of [['--run', '7', '--programme', 'prog-a'], ['--run', 'x'], ['--run', '0'], ['--programme', 'a.b'], ['--run'],
      ['--run', '7', '--run', '8']]) {
      const r = await run(['set', '2h', 'n', ...args]);
      expect([r.status, (JSON.parse(r.stdout) as { error: string }).error], args.join(' ')).toEqual([2, 'bad-args']);
    }
    expect(seen).toEqual([]);
  });

  it.each([['3w'], ['2'], ['h'], ['0h'], ['-2h'], ['2.5h'], ['2H'], ['1234567890m'], ['']])('the duration %j refuses locally, unsent', async (d) => {
    const r = await run(['set', d, 'n']);
    expect([r.status, (JSON.parse(r.stdout) as { error: string }).error]).toEqual([2, 'bad-duration']);
    expect(seen).toEqual([]);
  });

  it('a binding flag before the duration and the note is refused bad-args for its position, not as a typed identity (review 2064 F7)', async () => {
    for (const args of [['set', '--run', '5', '2h', 'n'], ['set', '--programme', 'prog-a', '2h', 'n']]) {
      const r = await run(args);
      const b = JSON.parse(r.stdout) as { error: string; detail: string };
      expect([r.status, b.error], args.join(' ')).toEqual([2, 'bad-args']);
      expect(b.detail, args.join(' ')).toContain(`timer set takes the duration and the note first, then ${args[1]}`);
      expect(b.detail, args.join(' ')).not.toContain('identity');
    }
    // Any other flag in the first place is still a typed identity.
    const r = await run(['set', '--fromId', 'lane-b-project-a', '2h', 'n']);
    expect((JSON.parse(r.stdout) as { detail: string }).detail).toContain("the identity is this pane's");
    expect(seen).toEqual([]);
  });

  it('a set with no note, or nothing at all, refuses, unsent', async () => {
    for (const args of [['set'], ['set', '2h']]) {
      expect((await run(args)).status, args.join(' ')).toBe(2);
    }
    expect(seen).toEqual([]);
  });

  it('without jq on PATH: no-jq, and nothing is sent', async () => {
    const bin = mkTmp('ccrc-api-timer-bin-');
    const bash = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(bash, path.join(bin, 'bash'));
    const r = await run(['set', '2h', 'n'], { PATH: `${harnessBin(home)}:${bin}` });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'no-jq' });
    expect(seen).toEqual([]);
  });
});

describe('ccrc-api timer list and cancel', () => {
  it('timer list sends the pane\'s pair in its query, and nothing else', async () => {
    expect((await run(['list'])).status).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname, s.url.search, s.body])).toEqual([
      ['GET', '/api/timers', `?byId=${PANE_ID}&byUuid=${PANE_UUID}`, ''],
    ]);
  });

  it('timer cancel 12 posts the pane\'s pair, built whole, to the timer\'s path', async () => {
    expect((await run(['cancel', '12'])).status).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname, s.url.search, s.body])).toEqual([
      ['POST', '/api/timers/12/cancel', '', `{"fromId":"${PANE_ID}","fromUuid":"${PANE_UUID}"}`],
    ]);
  });

  it('a cancel id that passes SAFE_RE is the server\'s to check; one that does not, or none, refuses here', async () => {
    expect((await run(['cancel', 'abc'])).status).toBe(0);
    expect(seen.map((s) => s.url.pathname)).toEqual(['/api/timers/abc/cancel']);
    seen = [];
    expect((JSON.parse((await run(['cancel', 'a.b'])).stdout) as { error: string }).error).toBe('bad-id');
    expect((JSON.parse((await run(['cancel'])).stdout) as { error: string }).error).toBe('no-id');
    expect((await run(['cancel', '12', '13'])).status).toBe(2);
    expect((await run(['list', 'x'])).status).toBe(2);
    expect(seen).toEqual([]);
  });
});

describe('the identity is the pane\'s on every timer verb: a typed one is refused, unsent', () => {
  it.each([
    [['set', '2h', 'n', '--json', '-']], [['set', '2h', 'n', '--by', 'lane-b-project-a']],
    [['set', '2h', 'n', '--fromId', 'lane-b-project-a', '--fromUuid', 'u']], [['set', '--json', '-']],
    [['list', '--byId', 'lane-b-project-a', '--byUuid', 'u']], [['list', '--json', '-']], [['list', '--by', 'lane-b-project-a']],
    [['cancel', '12', '--json', '-']], [['cancel', '12', '--fromId', 'lane-b-project-a']], [['cancel', '--by', 'x', '12']],
  ])('%j', async (args) => {
    const r = await run(args);
    expect(r.status).toBe(2);
    expect((JSON.parse(r.stdout) as { error: string }).error).toBe('bad-args');
    expect(seen).toEqual([]);
  });

  it('no pane: no-pane on every verb, unsent', async () => {
    for (const args of [['set', '2h', 'n'], ['list'], ['cancel', '12']]) {
      const r = await run(args, { TMUX_PANE: undefined });
      expect((JSON.parse(r.stdout) as { error: string }).error, args.join(' ')).toBe('no-pane');
    }
    expect(seen).toEqual([]);
  });
});

describe('the gate: a current cap file without timers-v1 refuses locally; an absent or stale one sends', () => {
  const VERBS = [['set', '2h', 'n'], ['list'], ['cancel', '12']];

  it('a current file without the word answers capability-missing, naming it in detail, and sends nothing', async () => {
    for (const words of [SERVER_CAPS.filter((w) => w !== WORD), []]) {
      writeCaps(words);
      for (const args of VERBS) expect(refused(await run(args)), args.join(' ')).toEqual({ status: 2, body: CAPABILITY_MISSING });
    }
    expect(CAPABILITY_MISSING.detail).toContain(WORD);
    expect(seen).toEqual([]);
  });

  it('a current file with the word sends', async () => {
    writeCaps([...SERVER_CAPS.filter((w) => w !== WORD), WORD]);
    for (const args of VERBS) expect((await run(args)).status, args.join(' ')).toBe(0);
    expect(seen.map((s) => s.url.pathname)).toEqual(['/api/timers', '/api/timers', '/api/timers/12/cancel']);
  });

  it('an absent file, a stale one (181 s) and a torn one send the request', async () => {
    fs.rmSync(capFile(), { force: true });
    expect((await run(['list'])).status).toBe(0);
    writeCaps([], nowS() - 181);
    expect((await run(['set', '2h', 'n'])).status).toBe(0);
    fs.writeFileSync(capFile(), 'at 1\n');
    expect((await run(['cancel', '12'])).status).toBe(0);
    expect(seen.map((s) => s.url.pathname)).toEqual(['/api/timers', '/api/timers', '/api/timers/12/cancel']);
  });
});

describe('the word is advertised (Task 12, slug word-last): the default cap file sends every timer verb', () => {
  it('SERVER_CAPS includes timers-v1, and a current file of the defaults sends', async () => {
    expect(SERVER_CAPS as readonly string[]).toContain(WORD);
    writeCaps(SERVER_CAPS);
    for (const args of [['set', '2h', 'n'], ['list'], ['cancel', '12']]) expect((await run(args)).status, args.join(' ')).toBe(0);
    expect(seen).toHaveLength(3);
  });
});

describe('the token rides curl\'s stdin, never a stream', () => {
  it('the token appears on neither stream of a set, a list or a refusal', async () => {
    const outs = [await run(['set', '2h', 'n']), await run(['list'])];
    writeCaps([]);
    outs.push(await run(['cancel', '12']));
    for (const r of outs) expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });
});
