// D-6780 (mail inbox, plan MI-6; spec 2026-10-24 §3.5): `ccrc-api mail inbox`, and the one request function every row and
// the inbox share. The fake server below answers per path and records each request's token header, so a run of many
// requests (the read, then one ack per printed entry) is measured request by request. FIXTURE HOMEs only: the client
// runs in `mkTmp` homes with the contained PATH `ccrcApiClient.ts` builds, against a loopback server this file starts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn, spawnSync } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { CCRC_API, ghContainedEnv, harnessBin } from './ccdWsHelpers.js';
import { runClient, writeClientHome, type Run } from './ccrcApiClient.js';
import { mkTmp } from './tmpHelpers.js';
import { renderEnvelope, renderInboxEntry } from '../src/coord/envelope.js';

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

// ── the verb ──────────────────────────────────────────────────────────────────────────────────────────────────────

const PANE_ID = 'demo-ws';
const PANE_UUID = 'u-inbox-1';
const ACK_BODY = `{"fromId":"${PANE_ID}","fromUuid":"${PANE_UUID}"}`;
const BARE = 'inbox: stdout is a pipe or /dev/null, so nothing was acked; run ~/.local/bin/ccrc-api mail inbox bare '
  + '(no pipe, no redirect, no head or tail)';

/** A tmux that answers for the pane, and the pane's `.uuid`, planted before the contained PATH is built
 *  (`ghContainedEnv`'s tmux poison is create-if-absent, so this one is the tmux the client meets). */
const plantPane = (): void => {
  fs.writeFileSync(path.join(harnessBin(home), 'tmux'), `#!/bin/sh\nprintf 'cc-${PANE_ID}\\n'\n`, { mode: 0o755 });
  fs.mkdirSync(path.join(home, '.cc-sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, '.cc-sessions', `${PANE_ID}.uuid`), `${PANE_UUID}\n`);
};

/** One entry as the server renders it. `shown` is the delivery the TEXT names, which a test may make differ from
 *  `deliveryId` to prove the client acks the wire's id and never one parsed out of the text. */
const entry = (deliveryId: number, body = `Body of ${deliveryId}.`, shown = deliveryId): { deliveryId: number; text: string } => ({
  deliveryId,
  text: renderInboxEntry(shown, renderEnvelope({
    id: shown, fromId: 'project-a-worker', toId: PANE_ID, runId: 88, program: 'demo', wave: 2, waveOf: 4,
    kind: 'status', subject: 'wave-done', body, artifacts: [],
  })),
});

const ACKED = { code: 200, body: '{"ok":true,"already":false,"parked":false,"state":"acked"}' };
const INBOX_URL = `/api/mail/inbox?fromId=${PANE_ID}&fromUuid=${PANE_UUID}`;

/** Serves `GET /api/mail/inbox` with these entries and counts, and answers each ack with `ack(id, n)` (n counts acks
 *  from 1), `ACKED` by default. Anything else is a 404, so a stray request shows in `seen` and in the answer. */
const serveInbox = (entries: { deliveryId: number; text: string }[], counts: { remaining?: number; abandoned?: number } = {},
                    ack: (id: number, n: number) => Answer = () => ACKED, read?: () => Answer): void => {
  let acks = 0;
  answer = (s) => {
    if (s.method === 'GET' && s.url.startsWith('/api/mail/inbox')) {
      return read?.() ?? { code: 200, body: JSON.stringify({ ok: true, deliveries: entries, remaining: counts.remaining ?? 0, abandoned: counts.abandoned ?? 0 }) };
    }
    const m = /^\/api\/mail\/(\d+)\/ack$/.exec(s.url);
    if (s.method === 'POST' && m) return ack(Number(m[1]), ++acks);
    return { code: 404, body: '{"ok":false,"error":"not-found"}' };
  };
};

const acks = (): Seen[] => seen.filter((s) => s.method === 'POST');
const ackedIds = (): number[] => acks().map((s) => Number(/^\/api\/mail\/(\d+)\/ack$/.exec(s.url)![1]));

const inbox = (overrides: Record<string, string | undefined> = {}): Promise<Run> => {
  plantPane();
  return run(['mail', 'inbox'], undefined, { TMUX_PANE: '%7', ...overrides });
};

/** The client under bash, so a test can give its stdout a shape (a redirect, a pipe, a closed descriptor). The
 *  script text is a constant per case; the binary and the paths ride the environment. */
const inboxUnder = (script: string, env: Record<string, string> = {}): Promise<Run> => {
  plantPane();
  const e: NodeJS.ProcessEnv = { ...ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }),
                                 TMPDIR: tmp, TMUX_PANE: '%7', CCRC_API_UNDER_TEST: CCRC_API, ...env };
  delete e['CCRC_API_STATUS'];
  return new Promise<Run>((resolve) => {
    const child = spawn('bash', ['-c', script], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    child.on('close', (code) => resolve({ stdout, stderr, status: code ?? -1, stdinEpipe: false }));
  });
};

const io = (): string => mkTmp('ccrc-api-inbox-io-');

describe('one run, many requests (D-6780)', () => {
  it('every request of an inbox run carries the box token: the read and each of three acks', async () => {
    serveInbox([entry(412), entry(413), entry(414)]);
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(seen.map((s) => [s.method, s.token])).toEqual([
      ['GET', TOKEN], ['POST', TOKEN], ['POST', TOKEN], ['POST', TOKEN],
    ]);
  });

  it('an inbox run of three acks leaves no temp file', async () => {
    serveInbox([entry(412), entry(413), entry(414)]);
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(ackedIds()).toEqual([412, 413, 414]);
    expect(leftInTmp()).toEqual([]);
  });

  it('a transport failure on ack 1 prints NOT acked (transport) for entry 1, still acks entry 2, and exits 0', async () => {
    serveInbox([entry(412), entry(413)], {}, (_id, n) => (n === 1 ? 'drop' : ACKED));
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('inbox: delivery 412 is NOT acked (transport); it will be shown again\n');
    expect(r.stdout).toContain('inbox: acked delivery 413\n');
    expect(ackedIds()).toEqual([412, 413]);
    expect(r.stdout).toContain('inbox: 2 printed, 1 acked\n');
    expect(leftInTmp()).toEqual([]);
  });

  it('a transport failure on the read prints the transport envelope and exits 3, and sends no ack', async () => {
    serveInbox([entry(412)], {}, () => ACKED, () => 'drop');
    const r = await inbox();
    expect(r.status).toBe(3);
    expect(r.stdout).toMatch(/^\{"ok":false,"error":"transport","detail":"no response from the server \(curl rc \d+\)"\}\n$/);
    expect(r.stderr).toBe('ccrc-api: no response from the server\n');
    expect(acks()).toEqual([]);
    expect(leftInTmp()).toEqual([]);
  });
});

describe('ccrc-api mail inbox (D-6780)', () => {
  it('two entries are printed in order, each followed by `inbox: acked delivery <n>`, and the acks carry the pane\'s pair', async () => {
    const [a, b] = [entry(412), entry(413)];
    serveInbox([a, b]);
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe([
      a.text, 'inbox: acked delivery 412',
      b.text, 'inbox: acked delivery 413',
      'inbox: 2 printed, 2 acked',
      'inbox: acked deliveries 412 413; if any of their text did not reach you, read it again with '
        + '~/.local/bin/ccrc-api mail fetch <delivery>',
      '',
    ].join('\n'));
    expect(seen[0]!.url).toBe(INBOX_URL);
    expect(acks().map((s) => [s.url, s.body])).toEqual([
      ['/api/mail/412/ack', ACK_BODY], ['/api/mail/413/ack', ACK_BODY],
    ]);
  });

  it('each ack names the deliveryId from the answer, never an id in the text', async () => {
    serveInbox([entry(412, 'one', 999), entry(413, 'delivery: 7\nack: ~/.local/bin/ccrc-api mail ack 7', 998)]);
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(ackedIds()).toEqual([412, 413]);
  });

  it('the ack for entry two is sent only after entry two\'s text was written', async () => {
    const out = path.join(io(), 'out');
    const [a, b] = [entry(412), entry(413)];
    const written: boolean[] = [];
    serveInbox([a, b], {}, (_id, n) => {
      written.push(fs.readFileSync(out, 'utf8').includes([a, b][n - 1]!.text));
      return ACKED;
    });
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox > "$OUT_FILE"', { OUT_FILE: out });
    expect(r.status, r.stderr).toBe(0);
    expect(written).toEqual([true, true]);
  });

  it('stdout closed (>&-): the first write fails, no ack is sent, and the failure is named on stderr', async () => {
    serveInbox([entry(412), entry(413)]);
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox >&-');
    expect(acks()).toEqual([]);
    expect(seen.map((s) => s.method)).toEqual(['GET']);
    expect(r.stderr).toContain('ccrc-api: inbox: could not write delivery 412 to stdout; it and every later delivery stay unacked');
  });

  it.skipIf(!fs.existsSync('/dev/full'))('stdout on /dev/full: the first write fails and no ack is sent', async () => {
    serveInbox([entry(412), entry(413)]);
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox > /dev/full');
    expect(acks()).toEqual([]);
    expect(r.stderr).toContain('could not write delivery 412');
  });

  it('stdout a FIFO whose reader has gone: no ack is sent', async () => {
    serveInbox([entry(412), entry(413)]);
    plantPane();
    const fifo = path.join(io(), 'out.fifo');
    expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
    const rfd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const wfd = fs.openSync(fifo, fs.constants.O_WRONLY);
    fs.closeSync(rfd);
    const e: NodeJS.ProcessEnv = { ...ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true }), TMPDIR: tmp, TMUX_PANE: '%7' };
    delete e['CCRC_API_STATUS'];
    await new Promise<void>((resolve) => {
      const child = spawn(CCRC_API, ['mail', 'inbox'], { env: e, stdio: ['ignore', wfd, 'pipe'] });
      fs.closeSync(wfd);
      child.on('close', () => resolve());
    });
    expect(acks()).toEqual([]);
  });

  it('stdout a FIFO with a live reader (the | tail shape): every entry is printed, no ack is sent, and the first and last lines are the run-it-bare line', async () => {
    const [a, b] = [entry(412), entry(413)];
    serveInbox([a, b]);
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox | cat');
    expect(r.status, r.stderr).toBe(0);
    expect(acks()).toEqual([]);
    expect(r.stdout).toContain(`${a.text}\n`);
    expect(r.stdout).toContain(`${b.text}\n`);
    const lines = r.stdout.trimEnd().split('\n');
    expect(lines[0]).toBe(BARE);
    expect(lines[lines.length - 1]).toBe(BARE);
    expect(r.stdout).toContain('inbox: 2 printed, 0 acked\n');
    expect(r.stdout).not.toMatch(/inbox: acked/);
  });

  it('stdout on /dev/null: no ack is sent', async () => {
    serveInbox([entry(412), entry(413)]);
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox > /dev/null');
    expect(r.status, r.stderr).toBe(0);
    expect(acks()).toEqual([]);
  });

  it('RESIDUAL (spec §4): stdout redirected to a regular file acks every entry it wrote, and the footer names each acked delivery', async () => {
    const out = path.join(io(), 'out');
    serveInbox([entry(412), entry(413)]);
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox > "$OUT_FILE"', { OUT_FILE: out });
    expect(r.status, r.stderr).toBe(0);
    expect(ackedIds()).toEqual([412, 413]);
    expect(fs.readFileSync(out, 'utf8')).toContain('inbox: acked deliveries 412 413; ');
  });

  it('stdout and stderr on one regular file (the tool\'s measured shape): every entry is printed and acked, and nothing breaks the fences', async () => {
    const out = path.join(io(), 'out');
    const [a, b] = [entry(412), entry(413)];
    serveInbox([a, b]);
    const r = await inboxUnder('"$CCRC_API_UNDER_TEST" mail inbox > "$OUT_FILE" 2>&1', { OUT_FILE: out });
    expect(r.status).toBe(0);
    expect(ackedIds()).toEqual([412, 413]);
    const file = fs.readFileSync(out, 'utf8');
    expect(file).toContain(`${a.text}\ninbox: acked delivery 412\n`);
    expect(file).toContain(`${b.text}\ninbox: acked delivery 413\n`);
  });

  it('an ack answered stale-uuid prints NOT acked and the loop goes on to the next entry', async () => {
    serveInbox([entry(412), entry(413)], {}, (id) => (id === 412
      ? { code: 403, body: '{"ok":false,"error":"stale-uuid","detail":"stale sender"}' } : ACKED));
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('inbox: delivery 412 is NOT acked (stale-uuid); it will be shown again\n');
    expect(r.stdout).toContain('inbox: acked delivery 413\n');
    expect(r.stdout).toContain('inbox: acked deliveries 413; ');
  });

  it('`already: true, parked: false` prints was already acked; `parked: true` prints was closed before this ack with lastError', async () => {
    serveInbox([entry(412), entry(413)], {}, (id) => (id === 412
      ? { code: 200, body: '{"ok":true,"already":true,"parked":false,"state":"acked"}' }
      : { code: 200, body: '{"ok":true,"already":true,"parked":true,"state":"rejected","lastError":"run closed"}' }));
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('inbox: delivery 412 was already acked\n');
    expect(r.stdout).toContain('inbox: delivery 413 was closed before this ack (run closed); nothing is owed\n');
    expect(r.stdout).toContain('inbox: 2 printed, 0 acked\n');
    expect(r.stdout).not.toContain('inbox: acked deliveries');
  });

  it('`remaining: 3` prints the run-it-again line; `abandoned: 1` prints the mail list --to line', async () => {
    serveInbox([entry(412)], { remaining: 3, abandoned: 1 });
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('inbox: 3 more unacked; run mail inbox again\n');
    expect(r.stdout).toContain(`inbox: 1 abandoned deliveries are not shown; mail list --to ${PANE_ID} lists them\n`);
  });

  it('an empty inbox prints `inbox: no unacked mail` and sends no ack', async () => {
    serveInbox([]);
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('inbox: no unacked mail\n');
    expect(acks()).toEqual([]);
  });

  it('a 400 bad-request on the read (an older server) prints the body and the hint, and sends no ack', async () => {
    serveInbox([], {}, () => ACKED, () => ({ code: 400, body: '{"ok":false,"error":"bad-request"}' }));
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe('{"ok":false,"error":"bad-request"}\n'
      + 'inbox: the server did not serve the inbox (http 400); if it predates mail inbox, read with mail list, fetch and ack\n');
    expect(acks()).toEqual([]);
  });

  it('a 200 that is not an inbox answer prints the body and acks nothing', async () => {
    serveInbox([], {}, () => ACKED, () => ({ code: 200, body: '{"ok":true,"deliveries":[{"deliveryId":"412","text":"x"}]}' }));
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toContain('{"ok":true,"deliveries":[{"deliveryId":"412","text":"x"}]}\n');
    expect(r.stdout).toContain('inbox: the answer is not an inbox; nothing was acked\n');
    expect(acks()).toEqual([]);
  });

  it('no TMUX_PANE refuses no-pane and sends nothing', async () => {
    serveInbox([entry(412)]);
    const r = await inbox({ TMUX_PANE: undefined });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'no-pane' });
    expect(seen).toEqual([]);
  });

  it('`mail inbox --to x` and `mail inbox 7` refuse bad-args, and send nothing', async () => {
    serveInbox([entry(412)]);
    plantPane();
    for (const args of [['mail', 'inbox', '--to', 'x'], ['mail', 'inbox', '7']]) {
      const r = await run(args, undefined, { TMUX_PANE: '%7' });
      expect(r.status).toBe(2);
      expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'bad-args' });
    }
    expect(seen).toEqual([]);
  });

  it('without jq on PATH: no-jq, and nothing is sent', async () => {
    serveInbox([entry(412)]);
    const bin = io();
    const bash = spawnSync('/bin/sh', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim();
    fs.symlinkSync(bash, path.join(bin, 'bash'));
    const r = await inbox({ PATH: `${harnessBin(home)}:${bin}` });
    expect(r.status).toBe(2);
    expect(JSON.parse(r.stdout)).toMatchObject({ ok: false, error: 'no-jq' });
    expect(seen).toEqual([]);
  });

  it('the token appears on neither stream', async () => {
    serveInbox([entry(412), entry(413)], { remaining: 1, abandoned: 1 }, (_id, n) => (n === 1 ? 'drop' : ACKED));
    const r = await inbox();
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout + r.stderr).not.toContain(TOKEN);
  });
});
