// Overlord W1 door process A1 (plan `w1-door-process.md` Task 2, ruled F1): `ccd/ccrc-api` sends every request body in the
// curl config it writes to curl's stdin, never as `--data-binary "$body"` on curl's argv, so a secret in a body (the act-key
// claim's launch nonce) is in no process listing. A recording `curl` on PATH writes its own command line (from
// `/proc/<pid>/cmdline` where there is one) and its stdin to files, then runs the real curl on that stdin, so the suite's
// local server measures what arrived. CHARACTERIZATION: the bytes the server receives are the body's own, as they were when
// the body rode the argv, for a body holding a newline, a quote, a backslash, a tab and non-ASCII text.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { harnessBin } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp, removeTmpFixtures } from './tmpHelpers.js';

const TOKEN = 'z'.repeat(64);
const ID = 'lane-a-project-a';
const NONCE = '0123456789abcdef'.repeat(4);
const REAL_CURL = spawnSync('/bin/sh', ['-c', 'command -v curl'], { encoding: 'utf8' }).stdout.trim() || '/usr/bin/curl';

let home: string;
let server: Server;
let seen: { method: string; url: string; body: Buffer }[];

beforeEach(async () => {
  home = mkTmp('ccrc-api-stdin-');
  seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => { chunks.push(c); });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: req.url ?? '', body: Buffer.concat(chunks) });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end('{"ok":true}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  writeClientHome(home, `http://127.0.0.1:${(server.address() as AddressInfo).port}`, TOKEN);
  // The recorder: its own command line, NUL-separated words as one per line, then its stdin; the real curl runs on it.
  fs.writeFileSync(path.join(harnessBin(home), 'curl'), [
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

const run = (args: string[], input: string): Promise<Run> => runClient(home, args, input);
const cmdline = (): string => fs.readFileSync(path.join(home, 'curl.cmdline'), 'utf8');
const stdin = (): string => fs.readFileSync(path.join(home, 'curl.stdin'), 'utf8');

/** A body every escape of curl's config grammar meets: a quote, a backslash, a newline between tokens, a carriage
 *  return, a tab, a `\n` escape inside a string and non-ASCII text. JSON all the same. */
const HARD = '{"fromId":"' + ID + '",\n "note":"a \\"quoted\\" word, a \\\\ backslash, a \\n escape,\tand é ☃",\r\n "n":1}';

const ROWS: Array<[string, string[], string, string]> = [
  ['sessions act-key (the nonce)', ['sessions', 'act-key', ID, '--json', '-'],
    JSON.stringify({ fromId: ID, fromUuid: '11111111-2222-3333-4444-555555555555', nonce: NONCE }), `/api/sessions/${ID}/act-key`],
  ['sessions start', ['sessions', 'start', ID, '--json', '-'], HARD, `/api/sessions/${ID}/start`],
  ['sessions loads', ['sessions', 'loads', ID, '--json', '-'], HARD, `/api/sessions/${ID}/start/loads`],
  ['claims take', ['claims', 'take', '--json', '-'], HARD, '/api/claims'],
];

describe('ccrc-api: every body rides curl\'s stdin, never its argv', () => {
  for (const [what, args, body, url] of ROWS) {
    it(`${what}: the command line holds neither the body nor any value from it; the stdin config holds it`, async () => {
      const r = await run(args, body);
      expect(r.status, r.stderr).toBe(0);
      const words = cmdline();
      expect(words).not.toContain('--data-binary');
      expect(words).not.toContain(body);
      // No value of the body: the nonce, a key name, the escaped words and the non-ASCII text.
      for (const v of [NONCE, '"fromId"', 'quoted', 'é ☃']) expect(words, `${v} is on curl's command line`).not.toContain(v);
      expect(words).not.toContain(TOKEN);
      expect(stdin()).toContain('data-raw = "');
      expect(stdin()).toContain(TOKEN);
      // THE CHARACTERIZATION: the server received the body's own bytes, as `--data-binary "$body"` delivered them.
      expect(seen.map((x) => [x.method, x.url])).toEqual([['POST', url]]);
      expect(seen[0]!.body.equals(Buffer.from(body, 'utf8')), `received ${JSON.stringify(seen[0]!.body.toString('utf8'))}`).toBe(true);
    });
  }

  it('a GET sends no body line', async () => {
    const r = await runClient(home, ['runs', 'list']);
    expect(r.status, r.stderr).toBe(0);
    expect(stdin()).toBe(`header = "x-ccrc-mail-token: ${TOKEN}"\n`);
    expect(seen.map((x) => [x.method, x.body.length])).toEqual([['GET', 0]]);
  });
});
