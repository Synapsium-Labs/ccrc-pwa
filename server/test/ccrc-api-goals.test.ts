// Overlord W1 portfolio B (review 2240 F1): `ccrc-api goals pin|modify|merged` carry the PANE's pair, the note door's rule. The
// ratification a coordinator's pin carries rests on this attribution, so the client appends `byId` then `byUuid` LAST (review 2039,
// F7), refuses a body that names either (unsent), and refuses a bodyless call. A stub server records each request; FIXTURE HOMEs
// only, the client runs with the contained PATH `ccrcApiClient.ts` builds. The residual (a same-user forger with the box token
// and a raw HTTP call) is not something this client can stop.
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
const PANE_UUID = 'u-goals-1';
const SLUG = 'prog-a';

let home: string;
let tmp: string;
let server: Server;
let seen: { method: string; url: URL; body: string }[];

beforeEach(async () => {
  home = mkTmp('ccrc-api-goals-home-');
  tmp = mkTmp('ccrc-api-goals-tmp-');
  seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
    req.on('end', () => {
      seen.push({ method: req.method ?? '', url: new URL(req.url ?? '/', 'http://x'), body });
      res.writeHead(202, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, id: 1 }));
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

const ROWS: [string, string, string][] = [
  ['pin', `/api/programmes/${SLUG}/spec`, '{"specPath":"docs/x.md","doneWhen":"done"}'],
  ['modify', `/api/programmes/${SLUG}/modifications`, '{"pr":12,"summary":"s"}'],
  ['merged', `/api/programmes/${SLUG}/modifications/merged`, '{"pr":12}'],
];

describe('ccrc-api goals: the pane\'s pair, never typed', () => {
  it.each(ROWS)('goals %s appends byId then byUuid to the body, last, other fields unchanged', async (verb, pathname, body) => {
    const r = await run(['goals', verb, SLUG, '--json', '-'], body);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname])).toEqual([['POST', pathname]]);
    expect(JSON.parse(seen[0]!.body)).toEqual({ ...JSON.parse(body), byId: PANE_ID, byUuid: PANE_UUID });
    expect(seen[0]!.body.endsWith(`,"byId":"${PANE_ID}","byUuid":"${PANE_UUID}"}`)).toBe(true);
    expect(seen[0]!.body.startsWith(body.slice(0, -1))).toBe(true);
  });

  it.each(ROWS)('goals %s refuses a body that names byId or byUuid (also with whitespace); nothing is sent', async (verb, _p, body) => {
    const withKey = (k: string): string => `${body.slice(0, -1)},${k}}`;
    for (const bad of [
      withKey('"byId":"lane-b-project-a"'),
      withKey('"byUuid":"u-other"'),
      withKey('"byId" : "lane-b-project-a"'),
      withKey('"byUuid"\n:\t"u-other"'),
      '{ "byId" : "x" }',
    ]) {
      const r = await run(['goals', verb, SLUG, '--json', '-'], bad);
      expect([r.status, JSON.parse(r.stdout).error], bad).toEqual([2, 'bad-body']);
    }
    expect(seen).toEqual([]);
  });

  it.each(ROWS)('goals %s refuses a bodyless call; nothing is sent', async (verb) => {
    const none = await run(['goals', verb, SLUG]);
    expect([none.status, JSON.parse(none.stdout).error]).toEqual([2, 'no-body']);
    expect(seen).toEqual([]);
  });

  it('goals pin refuses a body that is not a JSON object; nothing is sent', async () => {
    const bad = await run(['goals', 'pin', SLUG, '--json', '-'], '[1]');
    expect([bad.status, JSON.parse(bad.stdout).error]).toEqual([2, 'bad-body']);
    expect(seen).toEqual([]);
  });

  it('goals show is a read and carries no body', async () => {
    const r = await run(['goals', 'show', SLUG]);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname, s.body])).toEqual([['GET', `/api/programmes/${SLUG}/goals`, '']]);
  });
});
