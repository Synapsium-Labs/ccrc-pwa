// Overlord W1a, the card piece, PR B (plan `w1a-card.md` Task 5; review 2023 F1, F8, F13): `ccrc-api card` reads this pane's
// card ONE PAGE PER CALL through the `sessions.card` row: page 1 by default, a later page with `--page N --hash H`. It prints
// the page's text and one last line naming the page, the page count, the hash and the command for the next page, or whether
// the server recorded the read; a `card-changed` names the command that starts again. The raw row fills the pane's own pair.
// A stub server answers per page; FIXTURE HOMEs only, the client runs with the contained PATH `ccrcApiClient.ts` builds.
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
/** A card of `texts.length` pages under `hash`; `recordedOn` is the page whose answer records the read. */
const pageOf = (hash: string, texts: readonly string[], recordedOn: number | null = texts.length) => (u: URL) => {
  const page = Number(u.searchParams.get('page'));
  return { code: 200, body: { ok: true, hash, snapshotId: 's'.repeat(64), page, pages: texts.length, text: texts[page - 1], recorded: page === recordedOn } };
};
const asked = () => seen.map((u) => [u.pathname, u.searchParams.get('byId'), u.searchParams.get('byUuid'), u.searchParams.get('page'), u.searchParams.get('hash')]);

describe('ccrc-api card: one page per call', () => {
  it('page 1 by default: its text, and a last line naming the next page\'s exact command', async () => {
    answer = pageOf(H1, ['Card for lane-a-project-a\nfirst\n', 'second', 'third']);
    const r = await run();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe(`Card for lane-a-project-a\nfirst\n\ncard: page 1 of 3, hash ${H1}; next: ccrc-api card --page 2 --hash ${H1}\n`);
    expect(asked()).toEqual([[`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, '1', null]]);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('a later page carries the hash; the last page says the read is recorded', async () => {
    answer = pageOf(H1, ['one', 'two', 'three']);
    const mid = await run(['card', '--page', '2', '--hash', H1]);
    expect(mid.stdout).toBe(`two\ncard: page 2 of 3, hash ${H1}; next: ccrc-api card --page 3 --hash ${H1}\n`);
    const last = await run(['card', '--hash', H1, '--page', '3']);
    expect(last.stdout).toBe(`three\ncard: page 3 of 3, hash ${H1}; every page of this card is read, and the read is recorded\n`);
    expect(asked().map((a) => [a[3], a[4]])).toEqual([['2', H1], ['3', H1]]);
  });

  it('a one-page card is read and recorded in one call', async () => {
    answer = pageOf(H1, ['only']);
    const r = await run();
    expect(r.stdout).toBe(`only\ncard: page 1 of 1, hash ${H1}; every page of this card is read, and the read is recorded\n`);
  });

  it('a last page whose answer recorded nothing says so, with the command that reads the card again (review 2023 F8)', async () => {
    answer = pageOf(H1, ['one', 'two'], null);
    const r = await run(['card', '--page', '2', '--hash', H1]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`two\ncard: page 2 of 2, hash ${H1}; the read is NOT recorded`);
    expect(r.stdout).toContain('read it again from page 1: ccrc-api card\n');
    expect(r.stdout).not.toContain('every page of this card is read');
    // The longest last line stays under the 400 bytes `continuity-card-render.test.ts` leaves for it beside a full page.
    expect(Buffer.byteLength(r.stdout.split('\n').at(-2)!)).toBeLessThan(400);
  });

  it('card-changed prints the command that starts again, and no page text', async () => {
    answer = () => ({ code: 409, body: { ok: false, error: 'card-changed', hash: '2'.repeat(64) } });
    const r = await run(['card', '--page', '2', '--hash', H1]);
    expect(r.status).toBe(0);
    expect(r.stdout).toBe('card: the card changed since page 1 was read; read it again from page 1: ccrc-api card\n');
  });

  it('any other answer is printed as it came, with its status on stderr; a page answer of the wrong shape too', async () => {
    answer = () => ({ code: 403, body: { ok: false, error: 'stale-uuid' } });
    const r = await run();
    expect([r.status, r.stdout]).toEqual([0, '{"ok":false,"error":"stale-uuid"}\n']);
    expect(r.stderr).toContain('http 403');
    answer = (u) => { const a = pageOf(H1, ['x'])(u); const { recorded: _r, ...rest } = a.body; return { code: 200, body: rest }; };
    const shapeless = await run();
    expect(shapeless.stderr).toContain('http 200');
    expect(shapeless.stdout).not.toContain('card: page');
  });

  it('refuses bad arguments and sends nothing: a positional, a later page with no hash, a malformed page or hash', async () => {
    answer = pageOf(H1, ['x']);
    for (const args of [['card', 'lane-b-project-a'], ['card', '--page', '2'], ['card', '--page', '0'], ['card', '--hash', 'nope'], ['card', '--page']]) {
      const r = await run(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(JSON.parse(r.stdout), args.join(' ')).toMatchObject({ ok: false, error: 'bad-args' });
    }
    expect(seen).toEqual([]);
  });
});

describe('the raw row, sessions card <id> (review 2023 F13)', () => {
  it('fills the pane\'s own pair after the declared keys, page and hash', async () => {
    answer = pageOf(H1, ['only']);
    const r = await run(['sessions', 'card', PANE_ID, '--page', '1']);
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, hash: H1, pages: 1, text: 'only' });
    expect(asked()).toEqual([[`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, '1', null]]);
  });

  it('a typed pair is refused unknown-query, and nothing is sent', async () => {
    answer = pageOf(H1, ['only']);
    for (const k of ['--byId', '--byUuid']) {
      const r = await run(['sessions', 'card', PANE_ID, k, 'lane-b-project-a']);
      expect(JSON.parse(r.stdout), k).toMatchObject({ ok: false, error: 'unknown-query' });
    }
    expect(seen).toEqual([]);
  });
});

// The anchor piece (plan `w1a-anchor.md` Task 2): `card --anchor [--form F]` asks the card door's `part=anchor` (page 0)
// for the session hook, and prints an answer that proves itself (`part: "anchor"` and the form asked) as it came, its status
// on stderr, for the hook's one jq read; any other answer prints nothing and exits 3 (fix round 1, F1).
describe('ccrc-api card --anchor: the card\'s short part, for the session hook', () => {
  const anchorAsked = () => seen.map((u) => [u.pathname, u.searchParams.get('byId'), u.searchParams.get('byUuid'),
    u.searchParams.get('part'), u.searchParams.get('form'), u.searchParams.get('page'), u.searchParams.get('hash')]);

  it('asks part=anchor and page 0 with the pane\'s pair, form start by default, and no hash; prints a proved answer as it came', async () => {
    answer = () => ({ code: 200, body: { ok: true, part: 'anchor', form: 'start', dark: true } });
    const r = await run(['card', '--anchor']);
    expect([r.status, r.stdout]).toEqual([0, '{"ok":true,"part":"anchor","form":"start","dark":true}\n']);
    expect(r.stderr).toContain('http 200');
    answer = () => ({ code: 200, body: { ok: true, part: 'anchor', form: 'prompt', hash: H1, text: 'ccrc-anchor: x' } });
    expect(JSON.parse((await run(['card', '--anchor', '--form', 'prompt'])).stdout))
      .toEqual({ ok: true, part: 'anchor', form: 'prompt', hash: H1, text: 'ccrc-anchor: x' });
    answer = () => ({ code: 200, body: { ok: true, part: 'anchor', form: 'fork', live: true } });
    expect(JSON.parse((await run(['card', '--form', 'fork', '--anchor'])).stdout)).toEqual({ ok: true, part: 'anchor', form: 'fork', live: true });
    expect(anchorAsked()).toEqual([
      [`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, 'anchor', 'start', '0', null],
      [`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, 'anchor', 'prompt', '0', null],
      [`/api/sessions/${PANE_ID}/card`, PANE_ID, PANE_UUID, 'anchor', 'fork', '0', null],
    ]);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('F1: an answer without the proof prints nothing and exits 3, its status on stderr: an older server\'s card page, a refusal, another form', async () => {
    const OLD_PAGE = { ok: true, hash: H1, snapshotId: H1, page: 1, pages: 1, text: 'ccrc-role: coordinator\n...', recorded: true };
    const cases: [number, Record<string, unknown>, string[]][] = [
      [200, OLD_PAGE, ['card', '--anchor']],
      [200, OLD_PAGE, ['card', '--anchor', '--form', 'prompt']],
      [200, { ok: true, hash: H1, text: 'ccrc-anchor: x' }, ['card', '--anchor']],
      [200, { ok: true, dark: true }, ['card', '--anchor', '--form', 'fork']],
      [200, { ok: true, part: 'anchor', form: 'start', hash: H1, text: 'ccrc-anchor: x' }, ['card', '--anchor', '--form', 'prompt']],
      [400, { ok: false, error: 'bad-request', detail: 'page is a positive integer' }, ['card', '--anchor']],
      [403, { ok: false, error: 'stale-uuid' }, ['card', '--anchor']],
    ];
    for (const [code, body, args] of cases) {
      answer = () => ({ code, body });
      const r = await run(args);
      expect([r.status, r.stdout], JSON.stringify(body)).toEqual([3, '']);
      expect(r.stderr).toContain(`http ${code}`);
    }
  });

  it('refuses bad arguments and sends nothing: an unknown form, a form without --anchor, a page or hash with it', async () => {
    answer = () => ({ code: 200, body: { ok: true, dark: true } });
    for (const args of [['card', '--anchor', '--form', 'other'], ['card', '--form', 'start'], ['card', '--anchor', '--page', '2', '--hash', H1],
      ['card', '--anchor', '--hash', H1], ['card', '--anchor', '--form']]) {
      const r = await run(args);
      expect(r.status, args.join(' ')).toBe(2);
      expect(JSON.parse(r.stdout), args.join(' ')).toMatchObject({ ok: false, error: 'bad-args' });
    }
    expect(seen).toEqual([]);
  });
});

