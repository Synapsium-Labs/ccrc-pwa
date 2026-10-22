// codex-auth-lib.test.ts — `ccd/ccgpt-auth.py`, the one library that reads and writes a Codex lane's credential
// (codex-bridge spec 2026-10-15 §2.6, §5; Stage 1 plan 2026-10-22, Tasks 1-3).
//
// Every case runs the library through `runAuthDriver` (codexAuthFixture.ts) in a mkTmp HOME, with
// CCRC_CODEX_AUTH_BASE pointed at a loopback URL, so no case can reach a live endpoint. Tokens are built at runtime by
// `syntheticJwt`; no token-shaped literal is written here.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pythonOrSkip } from './ccgptHarness.js';
import { mkTmp } from './tmpHelpers.js';
import {
  ACCOUNT_CLAIM, AUTH_LIB, AUTH_ROUTES, CLOSED_AUTH_BASE, FIXTURE_ACCOUNT_ID, driverLines, fakeAuthServer,
  plantBackendCredential, runAuthDriver, syntheticJwt,
} from './codexAuthFixture.js';

const PY = pythonOrSkip();

it('this box has a usable python3', () => {
  if (process.env.CI) expect(PY).toBeTruthy();
});

const laneDir = (home: string): string => join(home, '.local', 'share', 'ccrc', 'codex', 'codex-a');
const credPath = (dir: string): string => join(dir, 'auth.json');

/** The decoded payload of a synthetic JWT (the test's own view, to compare with the library's derivation). */
const payloadOf = (jwt: string): Record<string, unknown> =>
  JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8')) as Record<string, unknown>;

/** The fields of a file's lstat a read must leave alone. */
const lstatKey = (p: string): string => {
  const s = lstatSync(p, { bigint: true });
  return `${s.ino}:${s.mtimeNs}:${s.size}:${s.mode}`;
};

/** Each token, and every `.`-separated segment of it long enough to be identifying. */
const secretPieces = (tokens: string[]): string[] =>
  tokens.flatMap((t) => [t, ...t.split('.').filter((s) => s.length >= 12)]);

/** Write `content` (a string as is, anything else as JSON) as the credential, mode 0600. */
function writeCred(dir: string, content: unknown): string {
  mkdirSync(dir, { recursive: true });
  const p = credPath(dir);
  writeFileSync(p, typeof content === 'string' ? content : JSON.stringify(content), { mode: 0o600 });
  return p;
}

async function readAt(home: string, dir: string, extra: object = {}): Promise<Record<string, any>> {
  const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'read' }], ...extra });
  expect(r.timedOut, r.stderr).toBe(false);
  const lines = driverLines(r.stdout);
  expect(lines, r.stderr).toHaveLength(1);
  return lines[0];
}

// Built once, at runtime: another family's file at the backend path (Review Focus 2).
const FOREIGN: Array<[string, unknown, string]> = [
  ['codex-cli', { OPENAI_API_KEY: 'x', tokens: { id_token: syntheticJwt({ sub: 'a' }), access_token: syntheticJwt({ sub: 'b' }), refresh_token: 'rtok-fixture-cli', account_id: 'acct-fixture-cli' } }, 'codex-cli'],
  ['siwc', { family: 'siwc', access_token: syntheticJwt({ sub: 'c' }), refresh_token: 'rtok-fixture-siwc' }, 'siwc'],
  ['api-key', { OPENAI_API_KEY: 'x', tokens: null }, 'unknown'],
  ['fixture', { fixture: 'x' }, 'unknown'],
  ['array', [1], 'unknown'],
];

describe.skipIf(!PY)('reading a credential (codex-bridge spec §2.6)', () => {
  // What this case checks is the STORED account id and expiry (the planting writes both into the file, and the
  // file's values win); the derivation from the tokens is the next case's.
  it('reads a present backend credential: its stored account id and expiry', async () => {
    const home = mkTmp('codex-auth-present-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { accountId: 'acct-fixture-1', expiresIn: 3600 });
    const line = await readAt(home, dir);
    expect(line).toMatchObject({ credential: 'present', family: 'chatgpt-backend', account_id: 'acct-fixture-1' });
    expect(Math.abs(line.expires_at - (Date.now() / 1000 + 3600))).toBeLessThan(5);
    expect(line.access_token).toBe(t.access.length);
    expect(line.refresh_token).toBe(t.refresh.length);
    expect(line.identity).toMatchObject({ ino: Number(lstatSync(credPath(dir)).ino), size: lstatSync(credPath(dir)).size });
  });

  it('derives account_id and expires_at in memory when the file has none, and never writes them back', async () => {
    const home = mkTmp('codex-auth-derive-');
    // The id token's claim comes first: the access token carries a different id, which must not win.
    const dirA = join(home, 'lane-a');
    const a = plantBackendCredential(dirA, {
      accountId: null, storedExpiresAt: null,
      accessClaims: { [ACCOUNT_CLAIM]: { chatgpt_account_id: 'acct-access-only' } },
    });
    // With no account claim in the id token, the access token's is used.
    const dirB = join(home, 'lane-b');
    plantBackendCredential(dirB, {
      accountId: null, storedExpiresAt: null,
      idClaims: { [ACCOUNT_CLAIM]: undefined },
      accessClaims: { [ACCOUNT_CLAIM]: { chatgpt_account_id: 'acct-access-only' } },
    });
    const before = [lstatKey(credPath(dirA)), lstatKey(credPath(dirB))];
    const bytes = [readFileSync(credPath(dirA), 'utf8'), readFileSync(credPath(dirB), 'utf8')];
    const r = await runAuthDriver(home, {
      authDir: dirA,
      ops: [{ op: 'read' }, { op: 'expired' }, { op: 'read', authDir: dirB }],
    });
    expect(r.status, r.stderr).toBe(0);
    const [ra, ea, rb] = driverLines(r.stdout);
    expect(ra).toMatchObject({ credential: 'present', account_id: FIXTURE_ACCOUNT_ID });
    expect(ra.expires_at).toBe(payloadOf(a.access).exp);
    expect(ea.result).toBe(false);
    expect(rb).toMatchObject({ credential: 'present', account_id: 'acct-access-only' });
    expect([lstatKey(credPath(dirA)), lstatKey(credPath(dirB))]).toEqual(before);
    expect([readFileSync(credPath(dirA), 'utf8'), readFileSync(credPath(dirB), 'utf8')]).toEqual(bytes);
    expect(JSON.parse(bytes[0])).toMatchObject({ account_id: null, expires_at: null });
  });

  it('absent is absent, and an empty object is absent with its identity', async () => {
    const home = mkTmp('codex-auth-absent-');
    const dir = laneDir(home);
    const none = await readAt(home, dir);
    expect(none).toMatchObject({ credential: 'absent', identity: null, family: null });
    writeCred(dir, {});
    const empty = await readAt(home, dir);
    expect(empty.credential).toBe('absent');
    expect(empty.identity).toMatchObject({ ino: Number(lstatSync(credPath(dir)).ino), size: 2 });
    expect(empty.detail).toMatch(/empty object/);
  });

  it('a torn credential reads unreadable after its retries, never absent', async () => {
    const home = mkTmp('codex-auth-torn-');
    const dir = laneDir(home);
    const p = writeCred(dir, '{"access_token": "x');
    const before = lstatKey(p);
    const line = await readAt(home, dir);
    expect(line.credential).toBe('unreadable');
    expect(line.identity).not.toBeNull();
    expect(readFileSync(p, 'utf8')).toBe('{"access_token": "x');
    expect(lstatKey(p)).toBe(before);
  });

  it('a torn credential made whole while the read waits is re-read and reads present; READ_RETRIES is read when called', async () => {
    const home = mkTmp('codex-auth-heal-');
    const dir = laneDir(home);
    const torn = '{"access_token": "x';
    const p = writeCred(dir, torn);
    // Two whole credentials, each renamed over the torn one (atomically: a rename is never seen half-done).
    plantBackendCredential(join(home, 'whole-1'));
    plantBackendCredential(join(home, 'whole-2'));
    // The driver prints the `paths` line and starts the read at once; the heal lands 150 ms later, after the read's
    // first attempt and well inside its first READ_RETRY_S (1 s) wait. A read with no re-read answers unreadable.
    const run = async (whole: string, consts: object): Promise<Record<string, any>> => {
      let healed: Promise<void> = Promise.resolve();
      const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'paths' }, { op: 'read' }], consts }, {}, {
        onLine: (line) => {
          if (line.op === 'paths') {
            healed = new Promise((resolve) => { setTimeout(() => { renameSync(credPath(join(home, whole)), p); resolve(); }, 150); });
          }
        },
      });
      await healed;
      expect(r.status, r.stderr).toBe(0);
      return driverLines(r.stdout)[1];
    };
    const healedRead = await run('whole-1', { READ_RETRY_S: 1.0 });
    expect(healedRead.credential, 'the torn file was re-read after READ_RETRY_S').toBe('present');
    writeCred(dir, torn);
    const noRetry = await run('whole-2', { READ_RETRY_S: 1.0, READ_RETRIES: 0 });
    expect(noRetry.credential, 'READ_RETRIES 0, set on the module, means no re-read').toBe('unreadable');
  });

  // Root opens a 0000 file, so the case cannot measure anything there.
  it.skipIf(process.getuid?.() === 0)('a credential whose own mode refuses the open reads unreadable with its identity, naming chmod 600', async () => {
    const home = mkTmp('codex-auth-eacces-');
    const dir = laneDir(home);
    plantBackendCredential(dir, { mode: 0o000 });
    const p = credPath(dir);
    const before = lstatKey(p);
    const line = await readAt(home, dir);
    expect(line.credential, 'an EACCES is unreadable, never absent').toBe('unreadable');
    expect(line.identity).toMatchObject({ ino: Number(lstatSync(p).ino), size: lstatSync(p).size });
    expect(line.detail).toMatch(/EACCES.*chmod 600/);
    expect(lstatKey(p)).toBe(before);
    chmodSync(p, 0o600);
  });

  it('a non-finite expiry is no expiry, and a file or a claim nested past the parser\'s limit never raises', async () => {
    const home = mkTmp('codex-auth-nonfinite-');
    // Python's json.loads accepts NaN and 1e400 (inf); JSON.stringify cannot write either, so these are raw text.
    const rawJwt = (payload: string): string =>
      `${Buffer.from('{"alg":"none"}').toString('base64url')}.${Buffer.from(payload).toString('base64url')}.sig-fixture`;
    const exp = Math.floor(Date.now() / 1000) + 3600;
    const raw = (access: string, stored: string): string =>
      `{"access_token": "${access}", "refresh_token": "rtok-fixture-nf", "expires_at": ${stored}}`;
    writeCred(join(home, 'nan'), raw(rawJwt('{"exp": NaN}'), 'NaN'));
    writeCred(join(home, 'inf'), raw(rawJwt('{"exp": 1e400}'), 'Infinity'));
    writeCred(join(home, 'nan-stored'), raw(rawJwt(`{"exp": ${exp}}`), 'NaN'));
    writeCred(join(home, 'deep-claims'), raw(rawJwt('['.repeat(100000)), 'null'));
    writeCred(join(home, 'deep-file'), '['.repeat(200000));
    const at = (name: string): string => join(home, name);
    const r = await runAuthDriver(home, {
      authDir: at('nan'),
      ops: [
        { op: 'read' }, { op: 'expired' },
        { op: 'read', authDir: at('inf') }, { op: 'expired', authDir: at('inf') },
        { op: 'read', authDir: at('nan-stored') },
        { op: 'read', authDir: at('deep-claims') },
        { op: 'read', authDir: at('deep-file') },
      ],
    });
    expect(r.status, r.stderr).toBe(0);
    const [nan, nanExpired, inf, infExpired, nanStored, deepClaims, deepFile] = driverLines(r.stdout);
    expect(nan).toMatchObject({ credential: 'present', expires_at: null });
    expect(nanExpired.result, 'a NaN expiry is expired, never fresh forever').toBe(true);
    expect(inf).toMatchObject({ credential: 'present', expires_at: null });
    expect(infExpired.result).toBe(true);
    expect(nanStored, 'a stored NaN falls through to the exp claim').toMatchObject({ credential: 'present', expires_at: exp });
    expect(deepClaims).toMatchObject({ credential: 'present', expires_at: null, account_id: null });
    expect(deepFile.credential).toBe('unreadable');
    expect(deepFile.detail).toMatch(/nested too deeply/);
  });

  it.each(['fifo', 'symlink'])('a non-regular file at the credential path reads unreadable at once, without opening it (%s)', async (kind) => {
    const home = mkTmp('codex-auth-nonreg-');
    const dir = laneDir(home);
    mkdirSync(dir, { recursive: true });
    if (kind === 'fifo') {
      const mk = spawnSync('mkfifo', [credPath(dir)]);
      expect(mk.status, String(mk.stderr)).toBe(0);
    } else {
      const elsewhere = join(home, 'elsewhere');
      plantBackendCredential(elsewhere);
      symlinkSync(credPath(elsewhere), credPath(dir));
    }
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'read' }] }, {}, { timeoutMs: 2000 });
    expect(r.timedOut, 'the read opened the file').toBe(false);
    const [line] = driverLines(r.stdout);
    expect(line.credential).toBe('unreadable');
    expect(line.detail).toMatch(/not a regular file/);
  });

  // The unsaved map is only ever filled by Task 2's writers; this case fills it directly, in a process of its own, to
  // pin what `read` compares it against: an absent file (identity None) matches a record bound to None, and nothing
  // else does.
  it.each(['absent', 'fifo', 'symlink'])('an unsaved record bound to an absent file is served only while the file is absent (%s)', (kind) => {
    const home = mkTmp('codex-auth-unsaved-');
    const dir = laneDir(home);
    mkdirSync(dir, { recursive: true });
    if (kind === 'fifo') {
      const mk = spawnSync('mkfifo', [credPath(dir)]);
      expect(mk.status, String(mk.stderr)).toBe(0);
    } else if (kind === 'symlink') {
      const elsewhere = join(home, 'elsewhere');
      plantBackendCredential(elsewhere);
      symlinkSync(credPath(elsewhere), credPath(dir));
    }
    const code = [
      'import importlib.util, json, os, sys',
      'sys.dont_write_bytecode = True',
      'spec = importlib.util.spec_from_file_location("ccgpt_auth", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'mod._UNSAVED[os.path.normpath(sys.argv[2])] = ({"access_token": "atok-fixture-u", "refresh_token": "rtok-fixture-u"}, None)',
      'print(mod.read(sys.argv[2]).credential)',
    ].join('\n');
    const r = spawnSync(PY as string, ['-I', '-c', code, AUTH_LIB, dir], {
      encoding: 'utf8', cwd: home, timeout: 5000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE },
    });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe(kind === 'absent' ? 'present' : 'unreadable');
  });

  it.each(FOREIGN)('another family\'s file reads foreign-family (%s)', async (_name, content, family) => {
    const home = mkTmp('codex-auth-foreign-');
    const dir = laneDir(home);
    const p = writeCred(dir, content);
    const before = lstatKey(p);
    const line = await readAt(home, dir);
    expect(line).toMatchObject({ credential: 'foreign-family', family, access_token: null, refresh_token: null });
    expect(lstatKey(p)).toBe(before);
  });

  it('a LiteLLM device marker alone reads incomplete', async () => {
    const home = mkTmp('codex-auth-marker-');
    const dir = laneDir(home);
    writeCred(dir, { device_code_requested_at: 1 });
    const line = await readAt(home, dir);
    expect(line).toMatchObject({ credential: 'incomplete', family: 'chatgpt-backend', access_token: null });
  });

  it('expired: inside the 60 s skew is expired; no stored expires_at and no exp claim is expired', async () => {
    const home = mkTmp('codex-auth-expired-');
    const soon = join(home, 'soon');
    const fresh = join(home, 'fresh');
    const noexp = join(home, 'noexp');
    plantBackendCredential(soon, { expiresIn: 30 });
    plantBackendCredential(fresh, { expiresIn: 3600 });
    writeCred(noexp, { access_token: syntheticJwt({ sub: 'n' }), refresh_token: 'rtok-fixture-noexp', id_token: syntheticJwt({ sub: 'n' }) });
    const r = await runAuthDriver(home, {
      authDir: soon,
      ops: [
        { op: 'expired' }, { op: 'expired', authDir: fresh }, { op: 'expired', authDir: noexp },
        { op: 'read', authDir: noexp },
      ],
    });
    expect(r.status, r.stderr).toBe(0);
    const [s, f, n, nr] = driverLines(r.stdout);
    expect(s.result, 'thirty seconds left is inside the 60 s skew').toBe(true);
    expect(f.result, 'an hour left is not').toBe(false);
    expect(n.result, 'neither a stored expires_at nor an exp claim').toBe(true);
    expect(nr).toMatchObject({ credential: 'present', expires_at: null });
    // A consts override reaches a default bound: nothing binds EXPIRY_SKEW_S when the function is defined.
    const o = await runAuthDriver(home, { authDir: fresh, ops: [{ op: 'expired' }], consts: { EXPIRY_SKEW_S: 7200 } });
    expect(o.status, o.stderr).toBe(0);
    expect(driverLines(o.stdout)[0].result).toBe(true);
  });

  it('no reading carries a token in detail', async () => {
    const home = mkTmp('codex-auth-nodetail-');
    const planted: string[] = [];
    const dirs: string[] = [];
    const at = (name: string): string => { const d = join(home, name); dirs.push(d); return d; };
    const p = plantBackendCredential(at('present'));
    planted.push(p.access, p.refresh, p.id);
    const q = plantBackendCredential(at('derived'), { accountId: null, storedExpiresAt: null });
    planted.push(q.access, q.refresh, q.id);
    const tornToken = syntheticJwt({ sub: 'torn' });
    planted.push(tornToken);
    writeCred(at('torn'), `{"access_token": "${tornToken}`);
    const lone = syntheticJwt({ sub: 'lone' });
    planted.push(lone);
    writeCred(at('incomplete'), { access_token: lone });
    for (const [name, content] of FOREIGN) {
      const text = JSON.stringify(content);
      planted.push(...(text.match(/[\w-]{12,}\.[\w-]{12,}\.[\w-]{12,}/g) ?? []), 'rtok-fixture-cli', 'rtok-fixture-siwc');
      writeCred(at(`foreign-${name}`), content);
    }
    at('absent');
    const r = await runAuthDriver(home, { authDir: dirs[0], ops: dirs.map((d) => ({ op: 'read', authDir: d })) });
    expect(r.status, r.stderr).toBe(0);
    const lines = driverLines(r.stdout);
    expect(lines.map((l) => l.credential)).toEqual([
      'present', 'present', 'unreadable', 'incomplete',
      ...FOREIGN.map(() => 'foreign-family'), 'absent',
    ]);
    for (const piece of secretPieces(planted)) {
      for (const l of lines) expect(l.detail, `a detail carries a token piece`).not.toContain(piece);
      expect(r.stdout + r.stderr, 'the driver printed a token piece').not.toContain(piece);
    }
  });

  it('paths_for names the four files beside the credential, and refuses a relative authDir', async () => {
    const home = mkTmp('codex-auth-paths-');
    const dir = laneDir(home);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'paths' }, { op: 'paths', authDir: 'relative/codex-a' }, { op: 'read', authDir: 'relative/codex-a' }] });
    expect(r.status).toBe(1);
    const [ok, rel, relRead] = driverLines(r.stdout);
    expect(ok).toMatchObject({
      credential: join(dir, 'auth.json'), pending: join(dir, 'auth.pending.json'),
      lock: join(dir, 'auth.json.lock'), status: join(dir, 'auth.status.json'),
    });
    expect(rel.error).toBe('ValueError');
    expect(relRead.error).toBe('ValueError');
  });

  it('the library runs on Python 3.9: ast.parse with feature_version (3, 9)', () => {
    const code = [
      'import ast, json, sys',
      'src = open(sys.argv[1], encoding="utf-8").read()',
      'tree = ast.parse(src, filename=sys.argv[1], feature_version=(3, 9))',
      'def has_bitor(n):',
      '    return any(isinstance(x, ast.BinOp) and isinstance(x.op, ast.BitOr) for x in ast.walk(n))',
      'bad = []',
      'for node in ast.walk(tree):',
      '    anns = []',
      '    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):',
      '        a = node.args',
      '        for arg in a.posonlyargs + a.args + a.kwonlyargs + [a.vararg, a.kwarg]:',
      '            if arg is not None and arg.annotation is not None:',
      '                anns.append(arg.annotation)',
      '        if node.returns is not None:',
      '            anns.append(node.returns)',
      '    elif isinstance(node, ast.AnnAssign):',
      '        anns.append(node.annotation)',
      '    elif isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in ("isinstance", "issubclass") and len(node.args) > 1:',
      '        anns.append(node.args[1])',
      '    bad.extend(node.lineno for a in anns if has_bitor(a))',
      'print(json.dumps(bad))',
    ].join('\n');
    const r = spawnSync(PY as string, ['-I', '-c', code, AUTH_LIB], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(JSON.parse(r.stdout), 'lines with a PEP 604 union evaluated at runtime').toEqual([]);
  });

  it('imports only the standard library, never litellm', () => {
    const load = [
      'import importlib.util, sys',
      'sys.dont_write_bytecode = True',
      'spec = importlib.util.spec_from_file_location("ccgpt_auth", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'print("loaded")',
    ].join('\n');
    // -I -S: no user site, no site-packages at all; only the standard library is importable.
    const r = spawnSync(PY as string, ['-I', '-S', '-c', load, AUTH_LIB], { encoding: 'utf8' });
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('loaded');
    const src = readFileSync(AUTH_LIB, 'utf8');
    expect(src).not.toMatch(/^\s*(?:from\s+litellm\b|import\s+(?:[\w.]+\s*,\s*)*litellm\b)/m);
  });

  it('runAuthDriver names a loopback CCRC_CODEX_AUTH_BASE unless told otherwise, and kills a child past its bound', async () => {
    const home = mkTmp('codex-auth-driver-');
    const saved = process.env.CCRC_CODEX_AUTH_BASE;
    // The vitest process's own value never reaches the child: its env is built from scratch.
    process.env.CCRC_CODEX_AUTH_BASE = 'http://example.invalid';
    try {
      const d = await runAuthDriver(home, { ops: [{ op: 'env', name: 'CCRC_CODEX_AUTH_BASE' }] });
      expect(d.status, d.stderr).toBe(0);
      expect(driverLines(d.stdout)[0].result).toBe(CLOSED_AUTH_BASE);
    } finally {
      if (saved === undefined) delete process.env.CCRC_CODEX_AUTH_BASE;
      else process.env.CCRC_CODEX_AUTH_BASE = saved;
    }
    const named = await runAuthDriver(home, { ops: [{ op: 'env', name: 'CCRC_CODEX_AUTH_BASE' }] }, { CCRC_CODEX_AUTH_BASE: 'http://127.0.0.1:9' });
    expect(driverLines(named.stdout)[0].result).toBe('http://127.0.0.1:9');
    const started = Date.now();
    const w = await runAuthDriver(home, { ops: [{ op: 'wait', path: join(home, 'never') }] }, {}, { timeoutMs: 500 });
    expect(w.timedOut).toBe(true);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe.skipIf(!PY)('the fixtures (codex-bridge Stage 1, Task 1)', () => {
  it('fakeAuthServer answers each route from its queue, and rejects a refresh token it already redeemed', async () => {
    const srv = await fakeAuthServer({
      token: [{ status: 200, body: { access_token: 'first' } }, { status: 503, body: 'down' }],
      usercode: [{ status: 200, body: { device_auth_id: 'd', user_code: 'u', interval: 5 }, headers: { 'x-request-id': 'req-1' } }],
    });
    try {
      const post = (route: string, body: string, type = 'application/json'): Promise<Response> =>
        fetch(srv.base + route, { method: 'POST', headers: { 'content-type': type }, body });
      const refresh = JSON.stringify({ grant_type: 'refresh_token', refresh_token: 'rt-one' });
      const a = await post(AUTH_ROUTES.token, refresh);
      expect([a.status, await a.json()]).toEqual([200, { access_token: 'first' }]);
      const reused = await post(AUTH_ROUTES.token, refresh);
      expect([reused.status, await reused.json()]).toEqual([400, { error: 'refresh_token_reused' }]);
      const next = await post(AUTH_ROUTES.token, 'grant_type=authorization_code&code=c1', 'application/x-www-form-urlencoded');
      expect([next.status, await next.text()], 'the reuse answer took no queued answer').toEqual([503, 'down']);
      const u = await post(AUTH_ROUTES.usercode, JSON.stringify({ client_id: 'x' }));
      expect(u.headers.get('x-request-id')).toBe('req-1');
      const unscripted = await post(AUTH_ROUTES.deviceToken, '{}');
      expect(unscripted.status).toBe(500);
      const other = await post('/elsewhere', '');
      expect(other.status).toBe(404);
      expect(srv.requests.map((q) => q.path)).toEqual([
        AUTH_ROUTES.token, AUTH_ROUTES.token, AUTH_ROUTES.token, AUTH_ROUTES.usercode, AUTH_ROUTES.deviceToken, '/elsewhere',
      ]);
      expect(srv.requests[2].form).toEqual({ grant_type: 'authorization_code', code: 'c1' });
      expect(srv.base).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
    } finally {
      await srv.close();
    }
  });
});
