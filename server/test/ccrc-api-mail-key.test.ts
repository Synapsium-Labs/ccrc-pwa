// Overlord wave 164: `ccrc-api mail send --key <k>` puts the send's idempotency key on the wire as `clientKey`, LAST, so a retry
// of the same command answers the first mail. The client never invents a key: without `--key` the body goes out byte for byte.
// A stub server records each request; FIXTURE HOMEs only, the client runs with the contained PATH `ccrcApiClient.ts` builds.
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
const PANE_UUID = 'u-mailkey-1';
const BODY = `{"fromId":"${PANE_ID}","fromUuid":"${PANE_UUID}","toId":"coordinator","runId":7,"kind":"status","subject":"MERGED","body":"b","artifacts":[]}`;

let home: string;
let tmp: string;
let server: Server;
let seen: { method: string; url: URL; body: string }[];
let answer: Record<string, unknown>;

beforeEach(async () => {
  home = mkTmp('ccrc-api-mailkey-home-');
  tmp = mkTmp('ccrc-api-mailkey-tmp-');
  seen = [];
  answer = { ok: true, id: 1 };
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: new URL(req.url ?? '/', 'http://x'), body });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify(answer));
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

describe('ccrc-api mail send --key', () => {
  it('appends clientKey last, every other byte of the body unchanged', async () => {
    const r = await run(['mail', 'send', '--json', '-', '--key', 'merged-3045'], BODY);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname, s.url.search])).toEqual([['POST', '/api/mail', '']]);
    expect(seen[0]!.body).toBe(`${BODY.slice(0, -1)},"clientKey":"merged-3045"}`);
    expect(JSON.parse(seen[0]!.body)).toEqual({ ...JSON.parse(BODY), clientKey: 'merged-3045' });
  });

  it('the flag may come before --json', async () => {
    const r = await run(['mail', 'send', '--key', 'k1', '--json', '-'], BODY);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(seen[0]!.body).clientKey).toBe('k1');
  });

  // Review 2725 F3: a server that knows the key echoes it; an accepted answer without the echo came from one that ignored it.
  it('an accepted answer that echoes the key is quiet; one without the echo says on stderr that a retry may duplicate', async () => {
    const WARN = 'does not echo clientKey k1, so this server ignored the key; a retry of this send may send it twice';
    answer = { ok: true, id: 1, clientKey: 'k1' };
    const echoed = await run(['mail', 'send', '--json', '-', '--key', 'k1'], BODY);
    expect([echoed.status, echoed.stdout.trim()], echoed.stderr).toEqual([0, '{"ok":true,"id":1,"clientKey":"k1"}']);
    expect(echoed.stderr).not.toContain('clientKey');
    answer = { ok: true, id: 1, already: true, clientKey: 'k1' };
    expect((await run(['mail', 'send', '--json', '-', '--key', 'k1'], BODY)).stderr).not.toContain('clientKey');
    answer = { ok: true, id: 1, clientKey: 'k2' };
    expect((await run(['mail', 'send', '--json', '-', '--key', 'k1'], BODY)).stderr).toContain(WARN);
    answer = { ok: true, id: 1 };
    const bare = await run(['mail', 'send', '--json', '-', '--key', 'k1'], BODY);
    expect([bare.status, bare.stdout.trim()]).toEqual([0, '{"ok":true,"id":1}']);
    expect(bare.stderr).toContain(WARN);
    // No key, no line: a keyless send never claimed deduplication.
    expect((await run(['mail', 'send', '--json', '-'], BODY)).stderr).not.toContain('clientKey');
  });

  it('the help names the key, and that a deliberate resend needs a new one', async () => {
    const r = await run(['--help']);
    expect(r.stderr).toContain('mail send --key <k> sends an idempotency key');
    expect(r.stderr).toContain('a key never expires, so a deliberate resend needs a new key');
  });

  it('without --key the body goes out byte for byte, with no key invented', async () => {
    const r = await run(['mail', 'send', '--json', '-'], BODY);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => s.body)).toEqual([BODY]);
  });

  it('refuses a key that is not a plain value; nothing is sent', async () => {
    for (const bad of ['a b', 'a"b', 'a\\b', 'a.b', 'x}', '']) {
      const r = await run(['mail', 'send', '--json', '-', '--key', bad], BODY);
      expect([r.status, JSON.parse(r.stdout).error], bad).toEqual([2, 'bad-key']);
    }
    expect(seen).toEqual([]);
  });

  it('refuses --key with no value, on another row, or beside a body that names clientKey; nothing is sent', async () => {
    const none = await run(['mail', 'send', '--json', '-', '--key'], BODY);
    expect([none.status, JSON.parse(none.stdout).error]).toEqual([2, 'bad-args']);
    const other = await run(['claims', 'take', '--json', '-', '--key', 'k1'], '{}');
    expect([other.status, JSON.parse(other.stdout).error]).toEqual([2, 'bad-args']);
    for (const named of [`${BODY.slice(0, -1)},"clientKey":"k0"}`, `${BODY.slice(0, -1)}, "clientKey" : "k0"}`]) {
      const r = await run(['mail', 'send', '--json', '-', '--key', 'k1'], named);
      expect([r.status, JSON.parse(r.stdout).error]).toEqual([2, 'bad-body']);
    }
    const noBody = await run(['mail', 'send', '--key', 'k1']);
    expect([noBody.status, JSON.parse(noBody.stdout).error]).toEqual([2, 'no-body']);
    expect(seen).toEqual([]);
  });
});
