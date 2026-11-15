// Overlord, the probes piece: `ccrc-api probe [--page N]` reads this pane's own open probe round ONE PAGE PER CALL through the
// `sessions.probe` row, and `ccrc-api probe answer --json -` posts the answers through the `probe.answer` row, whose `{id}` is the
// pane's (derived; no positional id) and whose body gets the pane's pair appended last. A stub server records each request;
// FIXTURE HOMEs only, the client runs with the contained PATH `ccrcApiClient.ts` builds.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { harnessBin } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'k'.repeat(64);
const PANE_ID = 'lane-a-project-a';
const PANE_UUID = 'u-probe-1';

let home: string;
let tmp: string;
let server: Server;
let seen: { method: string; url: URL; body: string }[];
let answer: (u: URL, method: string) => { code: number; body: unknown };

beforeEach(async () => {
  home = mkTmp('ccrc-api-probe-home-');
  tmp = mkTmp('ccrc-api-probe-tmp-');
  seen = [];
  answer = () => ({ code: 200, body: { ok: true } });
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      seen.push({ method: req.method ?? '', url: u, body });
      const a = answer(u, req.method ?? '');
      res.writeHead(a.code, { 'content-type': 'application/json' });
      res.end(JSON.stringify(a.body));
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

const run = (args: string[], input?: string): Promise<Run> =>
  runClient(home, args, input, { TMPDIR: tmp, TMUX_PANE: '%7', CCRC_API_STATUS: undefined });
const pages = (texts: readonly string[]) => (u: URL) => {
  const page = Number(u.searchParams.get('page') ?? '1');
  return { code: 200, body: { ok: true, roundId: 'r-7', kind: 'spot', page, pages: texts.length, questions: [{ id: 'q1', cls: 'c' }], text: texts[page - 1] } };
};

describe('ccrc-api probe: one page per call', () => {
  it('a non-last page prints its text and the next page\'s command; the pair rides the query', async () => {
    answer = pages(['first page\n', 'second page']);
    const r = await run(['probe']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('first page\n\nprobe: page 1 of 2, round r-7; next: ccrc-api probe --page 2\n');
    expect(seen.map((s) => [s.method, s.url.pathname, s.url.searchParams.get('byId'), s.url.searchParams.get('byUuid'), s.url.searchParams.get('page')]))
      .toEqual([['GET', `/api/sessions/${PANE_ID}/probe`, PANE_ID, PANE_UUID, '1']]);
  });

  it('the last page prints the answer command', async () => {
    answer = pages(['first page', 'second page']);
    const r = await run(['probe', '--page', '2']);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('second page\nprobe: page 2 of 2, round r-7; answer every question in one call: ccrc-api probe answer --json -\n');
    expect(seen[0]!.url.searchParams.get('page')).toBe('2');
  });

  it.each(['abc', '0', '-1', '1.5', ''])('--page %j is refused locally, nothing sent', async (v) => {
    const r = await run(['probe', '--page', v]);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout).error).toBe('bad-args');
    expect(seen).toEqual([]);
  });

  it('probe-none-open prints one line and exits 0', async () => {
    answer = () => ({ code: 409, body: { ok: false, error: 'probe-none-open' } });
    const r = await run(['probe']);
    expect([r.status, r.stdout]).toEqual([0, 'probe: no probe round of yours is open\n']);
  });

  it('any other answer is printed as it came, with its status on stderr', async () => {
    answer = () => ({ code: 403, body: { ok: false, error: 'not-owner' } });
    const r = await run(['probe']);
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: false, error: 'not-owner' });
    expect(r.stderr).toContain('http 403');
  });
});

describe('ccrc-api probe answer: the pane\'s own door', () => {
  const body = '{"roundId":"r-7","answers":[{"id":"q1","answer":"yes"}]}';

  it('posts to the pane\'s own id path with the pair appended last, and takes no positional id', async () => {
    const r = await run(['probe', 'answer', '--json', '-'], body);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname])).toEqual([['POST', `/api/sessions/${PANE_ID}/probe`]]);
    expect(JSON.parse(seen[0]!.body)).toEqual({ ...JSON.parse(body), byId: PANE_ID, byUuid: PANE_UUID });
    expect(seen[0]!.body.endsWith(`,"byId":"${PANE_ID}","byUuid":"${PANE_UUID}"}`)).toBe(true);
    seen = [];
    const typed = await run(['probe', 'answer', 'lane-b-project-a', '--json', '-'], body);
    expect(JSON.parse(typed.stdout).error).toBe('bad-args');
    expect(seen).toEqual([]);
  });

  it('refuses a body naming byId or byUuid, and a bodyless call; nothing is sent', async () => {
    for (const b of ['{"byId":"lane-b-project-a","answers":[]}', '{ "byUuid" : "u-x", "answers":[] }']) {
      const r = await run(['probe', 'answer', '--json', '-'], b);
      expect([r.status, JSON.parse(r.stdout).error], b).toEqual([2, 'bad-body']);
    }
    const none = await run(['probe', 'answer']);
    expect([none.status, JSON.parse(none.stdout).error]).toEqual([2, 'no-body']);
    expect(seen).toEqual([]);
  });

  it('reads the body from a file too', async () => {
    const f = path.join(tmp, 'answers.json');
    fs.writeFileSync(f, body);
    const r = await run(['probe', 'answer', '--json', f]);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ roundId: 'r-7', byId: PANE_ID });
  });
});
