// Overlord W1a, the card piece, PR B (plan `w1a-card.md` Task 5): `ccrc-api card` reads this pane's card whole, every page
// of one card hash in order through the `sessions.card` row, prints the text and one line naming the hash, and starts
// again at page 1 on `card-changed`, at most three times. A stub server answers per page; FIXTURE HOMEs only, the client
// runs with the contained PATH `ccrcApiClient.ts` builds.
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
const PANE_UUID = 'u-card-1';
const H1 = '1'.repeat(64);
const H2 = '2'.repeat(64);

let home: string;
let tmp: string;
let server: Server;
let seen: URL[];
let answer: (u: URL) => { code: number; body: unknown };

beforeEach(async () => {
  home = mkTmp('ccrc-api-card-home-');
  tmp = mkTmp('ccrc-api-card-tmp-');
  seen = [];
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    req.resume();
    req.on('end', () => {
      const u = new URL(req.url ?? '/', 'http://x');
      seen.push(u);
      const a = answer(u);
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

const run = (args: string[] = ['card']): Promise<Run> => runClient(home, args, undefined, { TMPDIR: tmp, TMUX_PANE: '%7', CCRC_API_STATUS: undefined });
/** A card of `pages` pages under `hash`, each page's text given. */
const pageOf = (hash: string, texts: readonly string[]) => (u: URL) => {
  const page = Number(u.searchParams.get('page'));
  return { code: 200, body: { ok: true, hash, snapshotId: 's'.repeat(64), page, pages: texts.length, text: texts[page - 1] } };
};

describe('ccrc-api card', () => {
  it('prints a three-page card whole, in order, each page asked with the pane\'s pair and, after the first, the hash', async () => {
    answer = pageOf(H1, ['Card for lane-a-project-a\nfirst ', 'second\n', 'third']);
    const r = await run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`Card for lane-a-project-a\nfirst second\nthird\ncard: read whole, hash ${H1}, 3 page(s)\n`);
    expect(seen.map((u) => [u.pathname, u.searchParams.get('byId'), u.searchParams.get('byUuid'), u.searchParams.get('page'), u.searchParams.get('hash')]))
      .toEqual([
        [`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, '1', null],
        [`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, '2', H1],
        [`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, '3', H1],
      ]);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('starts again at page 1 on card-changed, and prints only the card it read whole', async () => {
    let changed = false;
    answer = (u) => {
      if (u.searchParams.get('page') === '2' && !changed) { changed = true; return { code: 409, body: { ok: false, error: 'card-changed', hash: H2 } }; }
      return pageOf(changed ? H2 : H1, changed ? ['new one ', 'new two'] : ['old one ', 'old two'])(u);
    };
    const r = await run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`new one new two\ncard: read whole, hash ${H2}, 2 page(s)\n`);
    expect(seen.map((u) => [u.searchParams.get('page'), u.searchParams.get('hash')])).toEqual([['1', null], ['2', H1], ['1', null], ['2', H2]]);
  });

  it('gives up after three restarts, saying so, and prints no card text', async () => {
    let n = 0;
    answer = (u) => {
      if (u.searchParams.get('page') === '2') return { code: 409, body: { ok: false, error: 'card-changed', hash: H2 } };
      n += 1;
      return pageOf(n % 2 === 0 ? H2 : H1, ['one ', 'two'])(u);
    };
    const r = await run();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('card: the card changed 4 times while it was being read; run ccrc-api card again\n');
    expect(seen.filter((u) => u.searchParams.get('page') === '1')).toHaveLength(4);
  });

  it('any other answer is printed as it came, with its status on stderr', async () => {
    answer = () => ({ code: 403, body: { ok: false, error: 'stale-uuid' } });
    const r = await run();
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('{"ok":false,"error":"stale-uuid"}\n');
    expect(r.stderr).toContain('http 403');
  });

  it('takes no argument, and sends nothing when given one', async () => {
    answer = pageOf(H1, ['x']);
    const r = await run(['card', 'lane-b-project-a']);
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'bad-args' });
    expect(seen).toEqual([]);
  });

  it('the raw row reads one page: sessions card <id> with the pair and the page as query keys', async () => {
    answer = pageOf(H1, ['only']);
    const r = await run(['sessions', 'card', PANE_ID, '--byId', PANE_ID, '--byUuid', PANE_UUID, '--page', '1']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, hash: H1, pages: 1, text: 'only' });
  });
});
