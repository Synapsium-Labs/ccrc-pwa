// D-6780 (mail inbox, plan MI-6; spec 2026-10-24 §3.5): `ccrc-api mail inbox`, and the one request function every row and
// the inbox share. The fake server below answers per path and records each request's token header, so a run of many
// requests (the read, then one ack per printed entry) is measured request by request. FIXTURE HOMEs only: the client
// runs in `mkTmp` homes with the contained PATH `ccrcApiClient.ts` builds, against a loopback server this file starts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { CCRC_API, harnessBin } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp } from './tmpHelpers.js';

const TOKEN = 'k'.repeat(64);

type Seen = { method: string; url: string; token: string | undefined; body: string };
/** One answer: a status and a body, or `drop`, which destroys the connection before any reply (curl answers rc 52). */
type Answer = { code: number; body: string } | 'drop';

let home: string;
let tmp: string;
let server: Server;
let seen: Seen[];
/** What the fake server answers for one request. A test replaces it; the default answers every request 200 `{"ok":true}`. */
let answer: (req: Seen) => Answer;

beforeEach(async () => {
  home = mkTmp('ccrc-api-inbox-home-');
  tmp = mkTmp('ccrc-api-inbox-tmp-');
  seen = [];
  answer = () => ({ code: 200, body: '{"ok":true}' });
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const s: Seen = {
        method: req.method ?? '', url: req.url ?? '',
        token: req.headers['x-ccrc-mail-token'] as string | undefined, body,
      };
      seen.push(s);
      const a = answer(s);
      if (a === 'drop') { req.socket.destroy(); return; }
      res.writeHead(a.code, { 'content-type': 'application/json' });
      res.end(a.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
});

afterEach(async () => {
  await new Promise<void>((r) => { server.close(() => r()); });
});

/** The client in this file's HOME, its temp files kept in `tmp` so a test can see what was left behind. */
const run = (args: string[], input?: string, overrides?: Record<string, string | undefined>): Promise<Run> =>
  runClient(home, args, input, { TMPDIR: tmp, CCRC_API_STATUS: undefined, ...overrides });

const leftInTmp = (): string[] => fs.readdirSync(tmp);

describe('characterization: a one-request row (green before send_request, D-6780)', () => {
  it('a transport failure prints the envelope, the stderr line and exits 3', async () => {
    answer = () => 'drop';
    const r = await run(['runs', 'list']);
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/^\{"ok":false,"error":"transport","detail":"no response from the server \(curl rc \d+\)"\}\n$/);
    expect(r.stderr).toBe('ccrc-api: no response from the server\n');
    expect(seen).toHaveLength(1);
  });

  it('the token rides curl\'s stdin, never its argv', async () => {
    const real = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/curl';
    fs.writeFileSync(path.join(harnessBin(home), 'curl'),
      `#!/bin/sh\nprintf '%s\\n' "$@" > "$HOME/curl.argv"\ncat > "$HOME/curl.stdin"\n`
      + `exec '${real}' "$@" < "$HOME/curl.stdin"\n`, { mode: 0o755 });
    const r = await run(['runs', 'list']);
    expect(r.status, r.stderr).toBe(0);
    const argv = fs.readFileSync(path.join(home, 'curl.argv'), 'utf8');
    expect(argv).not.toContain(TOKEN);
    expect(fs.readFileSync(path.join(home, 'curl.stdin'), 'utf8')).toBe(`header = "x-ccrc-mail-token: ${TOKEN}"\n`);
    expect(seen.map((s) => s.token)).toEqual([TOKEN]);
  });

  it('no temp file is left behind, after an answer or after no response', async () => {
    const ok = await run(['runs', 'list']);
    expect(ok.status).toBe(0);
    expect(leftInTmp()).toEqual([]);
    answer = () => 'drop';
    const none = await run(['runs', 'list']);
    expect(none.status).toBe(3);
    expect(leftInTmp()).toEqual([]);
  });

  it('a refusal before the request leaves no temp file and sends nothing', async () => {
    const r = await run(['runs', 'dispatch']);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'no-id' });
    expect(seen).toEqual([]);
    expect(leftInTmp()).toEqual([]);
  });
});
