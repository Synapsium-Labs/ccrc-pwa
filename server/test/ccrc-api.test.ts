// The coordination protocol's client. It exists because a repo may legitimately
// deny `Bash(curl:*)` — and on 2026-08-26 one did, which stopped a worker reading
// its mail entirely while the coordinator on the same programme kept working only
// because `resp=$(curl …)` slips past that matcher. The deny was doing its job on
// one session and being evaded by accident on the other.
//
// What makes this a client and not curl under another name is that its surface is
// CLOSED: no argument here is a URL, a host, or a path fragment. The address comes
// from config the agent does not supply; the route comes from a table; the only id
// that ever reaches a path template is one the table declared and the client
// validated. Those properties are the whole justification, so `ccrc-api-closed.test.ts`
// pins them as standing tests. THIS file pins the behaviour: the table's rows, the
// three-part output contract, and the refusals.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { spawn } from 'node:child_process';
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { CCRC_API, ghContainedEnv } from './ccdWsHelpers.js';
import { mkTmp } from './tmpHelpers.js';

let home: string;
let server: Server;
let seen: { method: string; url: string; auth: string | undefined; body: string }[];
/** What the fake server answers next. A test sets it; the handler drains it. */
let reply: { code: number; body: string };

const TOKEN = 'z'.repeat(64);

/** The token file as it really ships: a `#`-comment preamble above ONE value
 *  line. Measured on the fleet host 2026-08-26 — 23 preamble lines above a
 *  64-char value — and reproduced here because a fixture holding a bare token
 *  would let a `cat`-shaped read pass this whole file. */
const tokenDoc = (): string =>
  ['# ccrc box token — do not commit, do not print.',
   '# The server reads this with coord/token.ts\'s extractToken:',
   '# first non-blank, non-# line, whitespace stripped.',
   '',
   TOKEN, ''].join('\n');

beforeEach(async () => {
  home = mkTmp('ccrc-api-home-');
  seen = [];
  reply = { code: 200, body: '{"ok":true}' };
  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({
        method: req.method ?? '', url: req.url ?? '',
        auth: req.headers['x-ccrc-mail-token'] as string | undefined, body,
      });
      res.writeHead(reply.code, { 'content-type': 'application/json' });
      res.end(reply.body);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;

  fs.mkdirSync(path.join(home, '.ccrc'), { recursive: true });
  fs.mkdirSync(path.join(home, '.cc-secrets'), { recursive: true });
  fs.writeFileSync(path.join(home, '.ccrc', 'agent.env'),
    `CCRC_AGENT_TOKEN=irrelevant\nCCRC_SERVER_URL=http://127.0.0.1:${port}\n`);
  fs.writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), tokenDoc(), { mode: 0o600 });
});

afterEach(async () => {
  await new Promise<void>((r) => { server.close(() => r()); });
  fs.rmSync(home, { recursive: true, force: true });
});

type Run = { stdout: string; stderr: string; status: number };

/** Runs the client. ASYNC, and that is not a style choice: the fake server above
 *  listens in THIS process, so a synchronous `execFileSync` would block the event
 *  loop for as long as the child runs — the server could never accept the
 *  connection, and every call would sit until curl's own `-m` bound expired.
 *  Measured while writing this file: 30047ms per case, `seen` empty, which reads
 *  exactly like a broken client and is not one.
 *
 *  Never rejects on a non-zero exit: the exit status is part of what these tests
 *  measure, so turning it into an exception would hide it. */
function run(args: string[], input?: string): Promise<Run> {
  const env = ghContainedEnv(home, { ...process.env, HOME: home }, { systemd: true, tmux: true });
  return new Promise<Run>((resolve) => {
    const child = spawn(CCRC_API, args, { env });
    let stdout = '', stderr = '';
    child.stdout.on('data', (c) => { stdout += c; });
    child.stderr.on('data', (c) => { stderr += c; });
    // stdin is CLOSED unless a test supplies input. Left open, `--json -` would
    // block in `cat` forever — the client is right to wait, so the harness must
    // be explicit about there being nothing to read.
    if (input !== undefined) child.stdin.end(input); else child.stdin.end();
    child.on('close', (code) => resolve({ stdout, stderr, status: code ?? -1 }));
  });
}

/** The two names this file used to have for one thing. `run` already captures
 *  both streams, so `runBoth` is the same call — kept as an alias only until the
 *  call sites below read as one vocabulary. */
const runBoth = run;

describe('the closed route table', () => {
  // One case per row of the table, method AND path, because a table is only a
  // table if every row is reachable and lands where it says. The ids here are
  // deliberately plain: the id-validation cases live in their own describe.
  const ROWS: [string[], string, string][] = [
    [['runs', 'list'], 'GET', '/api/runs'],
    [['runs', 'open'], 'POST', '/api/runs'],
    [['runs', 'dispatch', '12'], 'POST', '/api/runs/12/dispatch'],
    [['runs', 'advance', '12'], 'POST', '/api/runs/12/advance'],
    [['runs', 'close', '12'], 'POST', '/api/runs/12/close'],
    [['runs', 'items', '12'], 'POST', '/api/runs/12/items'],
    [['mail', 'list'], 'GET', '/api/mail'],
    [['mail', 'send'], 'POST', '/api/mail'],
    [['mail', 'fetch', '7'], 'GET', '/api/mail/7'],
    [['mail', 'ack', '7'], 'POST', '/api/mail/7/ack'],
    [['peers', 'list'], 'GET', '/api/peers'],
    [['lifecycle', 'list'], 'GET', '/api/lifecycle'],
    [['claims', 'list'], 'GET', '/api/claims'],
    [['claims', 'take'], 'POST', '/api/claims'],
    [['claims', 'release', '3'], 'POST', '/api/claims/3/release'],
    [['ledger', 'list'], 'GET', '/api/ledger'],
    [['ledger', 'allocate'], 'POST', '/api/ledger/deviations'],
  ];

  it.each(ROWS)('%s -> %s %s', async (args, method, url) => {
    await run(args as string[]);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.method).toBe(method);
    // Query strings are the caller's (`mail list --to x` appends one); the path
    // is the table's, so compare the path half exactly.
    expect(seen[0]!.url.split('?')[0]).toBe(url);
  });

  it('has exactly the rows exercised above — the table is read from the client, not from here', () => {
    // Counting `ROWS` alone would be self-referential: adding a row to the
    // client and not to this file would pass. Measured while writing this —
    // planting an eighteenth row in `ccd/ccrc-api` left `expect(ROWS).toHaveLength(17)`
    // green. So the client's own table is the input, and this asserts the two
    // sets AGREE. A new row is now red until it is exercised.
    const src = fs.readFileSync(CCRC_API, 'utf8');
    const table = src.slice(src.indexOf('declare -A ROUTES=('));
    const keys = [...table.slice(0, table.indexOf('\n)')).matchAll(/^\s*\[([a-z.]+)\]=/gm)].map((m) => m[1]!);
    expect(keys.sort()).toEqual(ROWS.map(([a]) => `${a[0]}.${a[1]}`).sort());
    // Stated separately so the number itself is a claim someone has to edit.
    // D-688: `POST /api/coord/pause` was inferred from routes.ts rather than
    // measured from the callers, and coordinator clause 4 forbids a session
    // from touching that file at all. Its absence is a decision.
    expect(keys).toHaveLength(17);
  });

  it('has no verb that reaches the pause door', async () => {
    const r = await run(['coord', 'pause']);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });
});

describe('the output contract', () => {
  it('puts the response body on stdout, verbatim and alone', async () => {
    reply = { code: 200, body: '{"ok":true,"runs":[]}' };
    const r = await runBoth(['runs', 'list']);
    expect(r.stdout.trim()).toBe('{"ok":true,"runs":[]}');
  });

  it('puts the status on stderr, so a caller never parses it back out of the body', async () => {
    reply = { code: 200, body: '{"ok":true}' };
    expect((await runBoth(['runs', 'list'])).stderr).toMatch(/^http 200$/m);
  });

  it('exits 0 on a 4xx and still prints the body — the refusal IS the protocol', async () => {
    // This is the whole reason the corpora say "never use `curl -f`": every
    // refusal these routes send arrives as a 4xx JSON body, and `-f` throws the
    // body away and exits 22. A client that exited non-zero here would rebuild
    // that trap for its callers.
    reply = { code: 409, body: '{"ok":false,"refused":"claimed-by-another"}' };
    const r = await runBoth(['runs', 'open']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"ok":false,"refused":"claimed-by-another"}');
    expect(r.stderr).toMatch(/^http 409$/m);
  });

  it('exits 0 on a 500 too — a server fault is still an answer', async () => {
    reply = { code: 500, body: '{"ok":false,"stderr":"ccd blew up"}' };
    const r = await runBoth(['runs', 'list']);
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe('{"ok":false,"stderr":"ccd blew up"}');
  });

  it('exits non-zero when NO response happened, and still answers in JSON', async () => {
    // The one case that is not an answer. A caller must be able to tell it apart
    // without parsing a second shape, so the synthetic body is the same JSON
    // envelope every route uses.
    await new Promise<void>((r) => { server.close(() => r()); });
    const r = await runBoth(['runs', 'list']);
    expect(r.status).not.toBe(0);
    const body = JSON.parse(r.stdout.trim());
    expect(body).toMatchObject({ ok: false, error: 'transport' });
    expect(typeof body.detail).toBe('string');
  });
});

describe('the token', () => {
  it('sends the value line, not the document around it', async () => {
    await run(['runs', 'list']);
    expect(seen[0]!.auth).toBe(TOKEN);
  });

  it('never prints the token, on any path', async () => {
    reply = { code: 401, body: '{"ok":false,"error":"unauthenticated"}' };
    const r = await runBoth(['runs', 'list']);
    expect(r.stdout).not.toContain(TOKEN);
    expect(r.stderr).not.toContain(TOKEN);
  });

  it('refuses by name when the token file is absent, and sends nothing', async () => {
    fs.rmSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'));
    const r = await runBoth(['runs', 'list']);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/token/i);
    expect(seen).toHaveLength(0);
  });

  it('refuses when the token file is all preamble and no value', async () => {
    fs.writeFileSync(path.join(home, '.cc-secrets', 'ccrc-mail.token'), '# only a comment\n\n');
    const r = await runBoth(['runs', 'list']);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });
});

describe('the address is config, never a guess', () => {
  it('refuses when CCRC_SERVER_URL is absent instead of guessing a host', async () => {
    // A worker guessed a host on 2026-08-25 and reported success against
    // nothing. Refusing by name is the whole point.
    fs.writeFileSync(path.join(home, '.ccrc', 'agent.env'), 'CCRC_AGENT_TOKEN=irrelevant\n');
    const r = await runBoth(['runs', 'list']);
    expect(r.status).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/CCRC_SERVER_URL/);
  });

  it('refuses when agent.env itself is absent', async () => {
    fs.rmSync(path.join(home, '.ccrc', 'agent.env'));
    expect((await runBoth(['runs', 'list'])).status).not.toBe(0);
  });

  it('accepts the ws:// spelling agent.env may carry and speaks http to it', async () => {
    // `ccrc install --role fleet` writes either form; the corpora already
    // document the swap. Doing it here is what stops each caller doing it.
    const port = (server.address() as AddressInfo).port;
    fs.writeFileSync(path.join(home, '.ccrc', 'agent.env'), `CCRC_SERVER_URL=ws://127.0.0.1:${port}\n`);
    await run(['runs', 'list']);
    expect(seen).toHaveLength(1);
  });
});

describe('an id reaches a path template only if the table declared one', () => {
  it('refuses a verb that needs an id when none is given', async () => {
    const r = await runBoth(['runs', 'dispatch']);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('refuses an id that is not a plain run/mail id', async () => {
    // The id is the ONLY caller-supplied thing that ever reaches a URL, so it is
    // the only place a path could be smuggled in. Anything but a conservative
    // token is refused before a request is built, never escaped and sent.
    for (const bad of ['../peers', '1/../../admin', 'a b', '12?x=1', '12#f', '']) {
      seen = [];
      const r = await runBoth(['mail', 'ack', bad]);
      expect(r.status, `id ${JSON.stringify(bad)} must be refused`).not.toBe(0);
      expect(seen, `id ${JSON.stringify(bad)} must not reach the wire`).toHaveLength(0);
    }
  });

  it('refuses an id on a verb that declares none, rather than ignoring it', async () => {
    const r = await runBoth(['runs', 'list', '12']);
    expect(r.status).not.toBe(0);
  });
});

describe('a query key rides only if its row declared it', () => {
  // The corpora ask for four of these and no more: `to`, `project`, `session`,
  // `of`. Anything else is refused rather than appended, for the same reason the
  // path is a template and not an argument — a client that forwarded arbitrary
  // query keys would be a URL builder with extra steps.
  it('appends a declared key', async () => {
    await run(['mail', 'list', '--to', 'a-workspace']);
    expect(seen[0]!.url).toBe('/api/mail?to=a-workspace');
  });

  it('appends two declared keys on a row that takes two', async () => {
    await run(['peers', 'list', '--of', 'me', '--project', 'ccrc-pwa']);
    expect(seen[0]!.url).toBe('/api/peers?of=me&project=ccrc-pwa');
  });

  it('refuses a key the row does not declare, rather than passing it through', async () => {
    const r = await run(['mail', 'list', '--project', 'ccrc-pwa']);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('refuses a key no row declares anywhere', async () => {
    for (const k of ['--url', '--host', '--path', '--raw', '--as', '--from-id']) {
      seen = [];
      const r = await run(['mail', 'list', k, 'x']);
      expect(r.status, `${k} must be refused`).not.toBe(0);
      expect(seen, `${k} must not reach the wire`).toHaveLength(0);
    }
  });

  it('refuses a query VALUE that could smuggle a second parameter or a path', async () => {
    for (const bad of ['a&b=c', 'a b', '../x', 'a#f', 'a?b', '']) {
      seen = [];
      const r = await run(['mail', 'list', '--to', bad]);
      expect(r.status, `value ${JSON.stringify(bad)} must be refused`).not.toBe(0);
      expect(seen, `value ${JSON.stringify(bad)} must not reach the wire`).toHaveLength(0);
    }
  });
});

describe('the body comes from --json, and only from there', () => {
  it('sends a file body verbatim', async () => {
    const f = path.join(home, 'body.json');
    fs.writeFileSync(f, '{"program":"p","wave":1}');
    await run(['runs', 'open', '--json', f]);
    expect(seen[0]!.body).toBe('{"program":"p","wave":1}');
  });

  it('reads stdin for --json -', async () => {
    await run(['runs', 'open', '--json', '-'], '{"program":"from-stdin"}');
    expect(seen[0]!.body).toBe('{"program":"from-stdin"}');
  });

  it('refuses a --json file that does not exist rather than sending an empty body', async () => {
    const r = await runBoth(['runs', 'open', '--json', path.join(home, 'nope.json')]);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });

  it('sets content-type on a POST that carries a body', async () => {
    const f = path.join(home, 'body.json');
    fs.writeFileSync(f, '{}');
    await run(['runs', 'open', '--json', f]);
    expect(seen).toHaveLength(1);
  });
});

describe('unknown verbs refuse rather than improvise', () => {
  it.each([[['runs']], [['nope', 'list']], [['runs', 'nope']], [[]]])('%s', async (args) => {
    const r = await runBoth(args as string[]);
    expect(r.status).not.toBe(0);
    expect(seen).toHaveLength(0);
  });
});

describe('whoami', () => {
  it('refuses outside tmux rather than inventing an identity', async () => {
    // Identity on this fleet is attribution, and the one thing not carried in a
    // payload is what tmux says about the pane. No pane, no answer — never a
    // guess, and deliberately no flag to supply one.
    const r = await runBoth(['whoami']);
    expect(r.status).not.toBe(0);
  });
});
