// Overlord W1a, the notes piece (plan `w1a-notes.md` Task 3): `ccrc-api note add|close|list|handover`, four rows of the closed
// table. A note is attributed to this pane: the three POSTs carry the pane's pair spliced LAST into the body (a body that names
// either is refused, unsent; a bodyless one too), and the list carries it in the query, after `--before` and `--limit`. A stub server records each request;
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
const PANE_UUID = 'u-note-1';

let home: string;
let tmp: string;
let server: Server;
let seen: { method: string; url: URL; body: string }[];

beforeEach(async () => {
  home = mkTmp('ccrc-api-note-home-');
  tmp = mkTmp('ccrc-api-note-tmp-');
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

describe('ccrc-api note: the pane\'s pair, never typed', () => {
  it.each([
    ['add', '/notes', '{"key":{"kind":"run","id":12},"kind":"thread","waitsOn":"w","next":"n"}'],
    ['close', '/notes', '{"revises":4,"closes":true}'],
    ['handover', '/handover', '{"threads":[],"cautions":[],"tone":"calm"}'],
  ])('note %s splices byId and byUuid into the body, last', async (verb, tail, body) => {
    const r = await run(['note', verb, PANE_ID, '--json', '-'], body);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname])).toEqual([['POST', `/api/sessions/${PANE_ID}${tail}`]]);
    expect(JSON.parse(seen[0]!.body)).toEqual({ ...JSON.parse(body), byId: PANE_ID, byUuid: PANE_UUID });
    expect(seen[0]!.body.endsWith(`,"byId":"${PANE_ID}","byUuid":"${PANE_UUID}"}`)).toBe(true);
  });

  it('the pane\'s pair outranks a spelling of byId the textual test misses: a parser keeps the later key (review 2039, F7)', async () => {
    const forged = '{"by\\u0049d":"lane-b-project-a","by\\u0055uid":"u-other","revises":4,"closes":true}';
    const r = await run(['note', 'close', PANE_ID, '--json', '-'], forged);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(seen[0]!.body)).toMatchObject({ byId: PANE_ID, byUuid: PANE_UUID, revises: 4 });
    for (const empty of ['{}', '  { \n }  ']) {
      seen = [];
      expect((await run(['note', 'handover', PANE_ID, '--json', '-'], empty)).status).toBe(0);
      expect(seen[0]!.body).toBe(`{"byId":"${PANE_ID}","byUuid":"${PANE_UUID}"}`);
    }
    for (const notObject of ['[1]', '"x"', '{"a":1']) {
      seen = [];
      const bad = await run(['note', 'add', PANE_ID, '--json', '-'], notObject);
      expect([bad.status, JSON.parse(bad.stdout).error], notObject).toEqual([2, 'bad-body']);
      expect(seen).toEqual([]);
    }
  });

  it.each(['add', 'close', 'handover'])('note %s refuses a body that names byId or byUuid, and a bodyless call; nothing is sent', async (verb) => {
    for (const body of ['{"byId":"lane-b-project-a","revises":1}', '{ "byUuid" : "x" }']) {
      const r = await run(['note', verb, PANE_ID, '--json', '-'], body);
      expect([r.status, JSON.parse(r.stdout).error]).toEqual([2, 'bad-body']);
    }
    const none = await run(['note', verb, PANE_ID]);
    expect([none.status, JSON.parse(none.stdout).error]).toEqual([2, 'no-body']);
    expect(seen).toEqual([]);
  });

  it('note list carries the pair in the query, and sends no body', async () => {
    const r = await run(['note', 'list', PANE_ID]);
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.url.pathname, s.url.searchParams.get('byId'), s.url.searchParams.get('byUuid'), s.body]))
      .toEqual([['GET', `/api/sessions/${PANE_ID}/notes`, PANE_ID, PANE_UUID, '']]);
  });

  it('note list pages with --before and --limit (review 2039, F2); the pair still rides after them', async () => {
    const r = await run(['note', 'list', PANE_ID, '--before', '43', '--limit', '1']);
    expect(r.status, r.stderr).toBe(0);
    expect(seen[0]!.url.search).toBe(`?before=43&limit=1&byId=${PANE_ID}&byUuid=${PANE_UUID}`);
    const undeclared = await run(['note', 'list', PANE_ID, '--after', '3']);
    expect([undeclared.status, JSON.parse(undeclared.stdout).error]).toEqual([2, 'unknown-query']);
    expect(seen).toHaveLength(1);
  });

  it('with no pane, nothing is sent', async () => {
    const r = await runClient(home, ['note', 'add', PANE_ID, '--json', '-'], '{"kind":"thread"}', { TMPDIR: tmp, TMUX_PANE: undefined, CCRC_API_STATUS: undefined });
    expect(r.status).toBe(2);
    expect(seen).toEqual([]);
  });
});
