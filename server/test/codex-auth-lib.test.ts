// codex-auth-lib.test.ts — `ccd/ccgpt-auth.py`, the one library that reads and writes a Codex lane's credential
// (codex-bridge spec 2026-10-15 §2.6, §5; Stage 1 plan 2026-10-22, Tasks 1-3).
//
// Every case runs the library through `runAuthDriver` (codexAuthFixture.ts) in a mkTmp HOME, with
// CCRC_CODEX_AUTH_BASE pointed at a loopback URL, so no case can reach a live endpoint. Tokens are built at runtime by
// `syntheticJwt`; no token-shaped literal is written here.
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
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

/** Make `dir` an authDir under which `lstat` cannot measure the credential path: a regular file where the directory
 *  should be (ENOTDIR), a symlink loop in its place (ELOOP), or a directory with no search permission (EACCES). The
 *  returned function restores what the cleanup needs (the directory's mode). */
type Unstatable = 'enotdir' | 'dir-loop' | 'unsearchable';
function plantUnstatable(dir: string, kind: Unstatable): () => void {
  mkdirSync(dirname(dir), { recursive: true });
  if (kind === 'enotdir') {
    writeFileSync(dir, 'not a directory', { mode: 0o600 });
    return () => undefined;
  }
  if (kind === 'dir-loop') {
    symlinkSync(basename(dir), dir);
    return () => undefined;
  }
  mkdirSync(dir);
  chmodSync(dir, 0o000);
  return () => chmodSync(dir, 0o700);
}

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
    // The driver prints the `paths` line and starts the read at once; the heal lands 450 ms later, well after the read's
    // first attempt and well inside its first READ_RETRY_S (1 s) wait. A read with no re-read answers unreadable, and
    // so does one that binds READ_RETRY_S as 0.05: its three re-reads are done about 150 ms in, before the heal.
    const run = async (whole: string, consts: object): Promise<Record<string, any>> => {
      let healed: Promise<void> = Promise.resolve();
      const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'paths' }, { op: 'read' }], consts }, {}, {
        onLine: (line) => {
          if (line.op === 'paths') {
            healed = new Promise((resolve) => { setTimeout(() => { renameSync(credPath(join(home, whole)), p); resolve(); }, 450); });
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
    // A JSON integer too large for a float (json.loads parses it as an int; math.isfinite on it raises OverflowError).
    const huge = '1' + '0'.repeat(400);
    writeCred(join(home, 'huge-stored'), raw(rawJwt(`{"exp": ${exp}}`), huge));
    writeCred(join(home, 'huge-exp'), raw(rawJwt(`{"exp": ${huge}}`), 'null'));
    const at = (name: string): string => join(home, name);
    const r = await runAuthDriver(home, {
      authDir: at('nan'),
      ops: [
        { op: 'read' }, { op: 'expired' },
        { op: 'read', authDir: at('inf') }, { op: 'expired', authDir: at('inf') },
        { op: 'read', authDir: at('nan-stored') },
        { op: 'read', authDir: at('deep-claims') },
        { op: 'read', authDir: at('deep-file') },
        { op: 'read', authDir: at('huge-stored') },
        { op: 'read', authDir: at('huge-exp') }, { op: 'expired', authDir: at('huge-exp') },
      ],
    });
    expect(r.status, r.stderr).toBe(0);
    const [nan, nanExpired, inf, infExpired, nanStored, deepClaims, deepFile, hugeStored, hugeExp, hugeExpired] =
      driverLines(r.stdout);
    expect(nan).toMatchObject({ credential: 'present', expires_at: null });
    expect(nanExpired.result, 'a NaN expiry is expired, never fresh forever').toBe(true);
    expect(inf).toMatchObject({ credential: 'present', expires_at: null });
    expect(infExpired.result).toBe(true);
    expect(nanStored, 'a stored NaN falls through to the exp claim').toMatchObject({ credential: 'present', expires_at: exp });
    expect(deepClaims).toMatchObject({ credential: 'present', expires_at: null, account_id: null });
    expect(deepFile.credential).toBe('unreadable');
    expect(deepFile.detail).toMatch(/nested too deeply/);
    expect(hugeStored, 'a stored integer past the float range falls through to the exp claim')
      .toMatchObject({ credential: 'present', expires_at: exp });
    expect(hugeExp, 'an exp claim past the float range is no expiry').toMatchObject({ credential: 'present', expires_at: null });
    expect(hugeExpired.result).toBe(true);
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
    // `count-opens`: the driver counts every `os.open` on the credential path, a refused one (ELOOP) included.
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'read' }], faults: ['count-opens'] }, {},
      { timeoutMs: 2000 });
    expect(r.timedOut, 'the read opened the file').toBe(false);
    const [line] = driverLines(r.stdout);
    expect(line.credential).toBe('unreadable');
    expect(line.credentialOpens, 'the read opened (or tried to open) the credential path').toBe(0);
    // Only the lstat arm says this; the open (a symlink's ELOOP) and the fstat arm ("was replaced by a non-regular
    // file", a FIFO the non-blocking open let through) each say something else.
    expect(line.detail).toContain(`${credPath(dir)} is not a regular file; move it aside`);
    expect(line.detail).not.toMatch(/replaced|cannot be opened/);
  });

  it.each([
    ['enotdir', 'ENOTDIR'], ['dir-loop', 'ELOOP'],
  ] as Array<[Unstatable, string]>)('a credential path whose authDir is not a directory reads unreadable, naming the authDir (%s)', async (kind, code) => {
    const home = mkTmp('codex-auth-notdir-');
    const dir = laneDir(home);
    plantUnstatable(dir, kind);
    const line = await readAt(home, dir);
    expect(line).toMatchObject({ credential: 'unreadable', identity: null });
    expect(line.detail).toContain(`cannot be read (${code}); ${dir} or a directory above it is not a directory, or is a symlink loop`);
    expect(line.detail, 'neither the file-mode nor the symlink remedy can fix a directory').not.toMatch(/chmod|the path is a symlink/);
  });

  // Root searches a 0000 directory, so the case cannot measure anything there.
  it.skipIf(process.getuid?.() === 0)('a credential under an authDir that cannot be searched reads unreadable, naming the directories\' permissions', async () => {
    const home = mkTmp('codex-auth-unsearchable-');
    const dir = laneDir(home);
    const restore = plantUnstatable(dir, 'unsearchable');
    try {
      const line = await readAt(home, dir);
      expect(line).toMatchObject({ credential: 'unreadable', identity: null });
      expect(line.detail).toContain(`cannot be read (EACCES); check the permissions of ${dir} and the directories above it`);
      expect(line.detail, 'the file\'s own mode is not what refused').not.toMatch(/chmod/);
    } finally {
      restore();
    }
  });

  it('a credential whose read fails after it opened reads unreadable with its identity, naming a retry, not a path or a mode', async () => {
    const home = mkTmp('codex-auth-eio-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const p = credPath(dir);
    const before = lstatKey(p);
    // `eio-read:1`: the first `os.read` on an fd opened on the credential raises OSError(EIO), after lstat, the open
    // and fstat have all succeeded.
    const line = await readAt(home, dir, { faults: ['eio-read:1'] });
    expect(line.credential, 'an EIO is unreadable, never absent').toBe('unreadable');
    expect(line.identity, 'the fstat identity is carried').toMatchObject({ ino: Number(lstatSync(p).ino), size: lstatSync(p).size });
    expect(line.detail).toContain('cannot be read (EIO); the file opened but could not be read; retry, and if it persists move it aside');
    expect(line.detail, 'the path and the mode are already proven').not.toMatch(/chmod|permissions|not a directory|symlink/);
    expect(lstatKey(p)).toBe(before);
  });

  // The unsaved map is only ever filled by Task 2's writers; this case fills it directly, in a process of its own, to
  // pin what `read` compares it against: an absent file (identity None) matches a record bound to None, and nothing
  // else does, a path `lstat` cannot measure (ENOTDIR, ELOOP, EACCES) included.
  const unsavedRead = (kind: string): string => {
    const home = mkTmp('codex-auth-unsaved-');
    const dir = laneDir(home);
    let restore = (): void => undefined;
    if (kind === 'enotdir' || kind === 'dir-loop' || kind === 'unsearchable') restore = plantUnstatable(dir, kind);
    else mkdirSync(dir, { recursive: true });
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
    try {
      const r = spawnSync(PY as string, ['-I', '-c', code, AUTH_LIB, dir], {
        encoding: 'utf8', cwd: home, timeout: 5000,
        env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE },
      });
      expect(r.status, r.stderr).toBe(0);
      return r.stdout.trim();
    } finally {
      restore();
    }
  };
  const UNSAVED_TITLE = 'an unsaved record bound to an absent file is served only while the file is absent (%s)';
  it.each(['absent', 'fifo', 'symlink', 'enotdir', 'dir-loop'])(UNSAVED_TITLE, (kind) => {
    expect(unsavedRead(kind)).toBe(kind === 'absent' ? 'present' : 'unreadable');
  });
  // Root searches a 0000 directory, so this kind cannot be measured there.
  it.skipIf(process.getuid?.() === 0).each(['unsearchable'])(UNSAVED_TITLE, (kind) => {
    expect(unsavedRead(kind)).toBe('unreadable');
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

// ── Task 2: the lock, the commit, the checkpoint and a full disk ────────────────────────────────────────────────

const pendingPath = (dir: string): string => join(dir, 'auth.pending.json');
const lockPath = (dir: string): string => join(dir, 'auth.json.lock');
const modeOf = (p: string): number => lstatSync(p).mode & 0o777;
const fileRecord = (dir: string): Record<string, unknown> =>
  JSON.parse(readFileSync(credPath(dir), 'utf8')) as Record<string, unknown>;

/** The next credential a commit writes: LiteLLM's five keys, an account id of its own (the reading prints the id in
 *  full and every token only by its length, so the id is what tells the new record from the planted one). */
function nextRecord(accountId = 'acct-fixture-next'): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const claim = { [ACCOUNT_CLAIM]: { chatgpt_account_id: accountId } };
  return {
    access_token: syntheticJwt({ exp: now + 7200, iat: now, ...claim }),
    refresh_token: `rtok-fixture-next-${randomBytes(16).toString('hex')}`,
    id_token: syntheticJwt({ exp: now + 7200, iat: now, ...claim }),
    expires_at: now + 7200,
    account_id: accountId,
  };
}

/** SIGKILL every driver child of this process whose argv matches `pattern` (a `pgrep -f` regex); the pids killed. */
function killDriver(pattern: string): number[] {
  const found = spawnSync('pgrep', ['-P', String(process.pid), '-f', pattern], { encoding: 'utf8' });
  const pids = found.stdout.split('\n').filter((l) => l.trim() !== '').map(Number);
  for (const pid of pids) process.kill(pid, 'SIGKILL');
  return pids;
}

const reEscape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Parseable checkpoints that are not a present backend record (the contract: "a checkpoint that parses as a backend
// record with both tokens" is the only one promoted). Built at runtime: the access token is a synthetic JWT.
const NOT_PRESENT_CHECKPOINTS: Array<[string, () => unknown]> = [
  ['empty object', () => ({})],
  ['an abandoned device flow', () => ({ device_code_requested_at: 1 })],
  ['an access token alone', () => ({ access_token: syntheticJwt({ exp: Math.floor(Date.now() / 1000) + 7200 }) })],
  ['another family (tokens)', () => ({ tokens: {} })],
  ['not an object', () => [1]],
];

const FOREIGN_WRITES = FOREIGN.filter(([name]) => ['codex-cli', 'siwc', 'api-key'].includes(name));

describe.skipIf(!PY)('the lock and the commit (codex-bridge spec §2.6, figure 4)', () => {
  it('under a 0277 umask every file is 0600 and a new authDir 0700: credential, checkpoint and lock', async () => {
    const home = mkTmp('codex-auth-umask-');
    const top = join(home, 'lvl1');
    const dir = join(top, 'lvl2');
    try {
      const a = await runAuthDriver(home, { authDir: dir, umask: 0o277, ops: [{ op: 'commit', record: nextRecord() }] });
      expect(a.status, a.stderr).toBe(0);
      expect(driverLines(a.stdout)[0].result).toBe(true);
      // The checkpoint left behind by a crash between its fsync and the rename.
      const b = await runAuthDriver(home, {
        authDir: dir, umask: 0o277, faults: ['die-before-rename'], ops: [{ op: 'commit', record: nextRecord('acct-fixture-2') }],
      });
      expect(b.status, b.stderr).toBe(9);
      expect({
        credential: modeOf(credPath(dir)), checkpoint: modeOf(pendingPath(dir)), lock: modeOf(lockPath(dir)),
        lvl1: modeOf(top), lvl2: modeOf(dir),
      }).toEqual({ credential: 0o600, checkpoint: 0o600, lock: 0o600, lvl1: 0o700, lvl2: 0o700 });
    } finally {
      // A mutated `held` leaves the levels without their search bit; the cleanup needs it back.
      for (const d of [top, dir]) { try { chmodSync(d, 0o700); } catch { /* absent */ } }
    }
  });

  it('an adopted 0755 authDir keeps 0755', async () => {
    const home = mkTmp('codex-auth-adopt-');
    const dir = laneDir(home);
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] });
    expect(r.status, r.stderr).toBe(0);
    expect(driverLines(r.stdout)[0].result).toBe(true);
    expect(modeOf(dir)).toBe(0o755);
    expect(modeOf(credPath(dir))).toBe(0o600);
  });

  it('a commit replaces the inode, and the lock file\'s inode is unchanged across it', async () => {
    const home = mkTmp('codex-auth-inode-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const planted = lstatSync(credPath(dir)).ino;
    const first = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord('acct-fixture-1') }] });
    expect(first.status, first.stderr).toBe(0);
    const afterFirst = lstatSync(credPath(dir)).ino;
    const lock = lstatSync(lockPath(dir)).ino;
    const second = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord('acct-fixture-2') }] });
    expect(second.status, second.stderr).toBe(0);
    expect(afterFirst, 'the first commit renamed a new file into place').not.toBe(planted);
    expect(lstatSync(credPath(dir)).ino, 'so did the second').not.toBe(afterFirst);
    expect(lstatSync(lockPath(dir)).ino, 'the lock is a file of its own, never replaced').toBe(lock);
    expect(lock).not.toBe(lstatSync(credPath(dir)).ino);
    expect(fileRecord(dir).account_id).toBe('acct-fixture-2');
  });

  it.each(FOREIGN_WRITES)('refuses to write over another family\'s file: bytes and mtime unchanged (%s)', async (_name, content) => {
    const home = mkTmp('codex-auth-foreign-write-');
    const dir = laneDir(home);
    const p = writeCred(dir, content);
    const bytes = readFileSync(p);
    const before = lstatKey(p);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] });
    expect(driverLines(r.stdout)[0].error).toBe('foreign-family');
    expect(readFileSync(p).equals(bytes)).toBe(true);
    expect(lstatKey(p)).toBe(before);
    expect(existsSync(pendingPath(dir)), 'no checkpoint was written').toBe(false);
  });

  it('refuses to write over a file that reads unreadable under the lock', async () => {
    const home = mkTmp('codex-auth-unreadable-write-');
    const dir = laneDir(home);
    const p = writeCred(dir, '{"access_token": "x');
    const before = lstatKey(p);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] });
    expect(driverLines(r.stdout)[0].error).toBe('credential-unusable');
    expect(readFileSync(p, 'utf8')).toBe('{"access_token": "x');
    expect(lstatKey(p)).toBe(before);
  });

  it('a symlink at the lock path is refused, and its target is untouched', async () => {
    const home = mkTmp('codex-auth-locklink-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const credBefore = lstatKey(credPath(dir));
    const target = join(home, 'lock-target');
    writeFileSync(target, 'lock target', { mode: 0o644 });
    chmodSync(target, 0o644);
    const targetBefore = lstatKey(target);
    symlinkSync(target, lockPath(dir));
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] });
    const [line] = driverLines(r.stdout);
    expect(line.error).toBe('credential-unusable');
    expect(line.message).toContain(lockPath(dir));
    expect(readFileSync(target, 'utf8')).toBe('lock target');
    expect(lstatKey(target), 'the target\'s mode and bytes').toBe(targetBefore);
    expect(lstatKey(credPath(dir)), 'nothing was committed').toBe(credBefore);
  });

  it('a FIFO at the lock path is refused as a non-regular file, and nothing is committed', async () => {
    const home = mkTmp('codex-auth-lockfifo-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const credBefore = lstatKey(credPath(dir));
    const mk = spawnSync('mkfifo', [lockPath(dir)]);
    expect(mk.status, String(mk.stderr)).toBe(0);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] }, {}, { timeoutMs: 5000 });
    expect(r.timedOut).toBe(false);
    const [line] = driverLines(r.stdout);
    expect(line.error).toBe('credential-unusable');
    expect(line.message).toContain(`${lockPath(dir)} is not a regular file`);
    expect(lstatSync(lockPath(dir)).isFIFO()).toBe(true);
    expect(lstatKey(credPath(dir))).toBe(credBefore);
  });

  // Root opens a 0400 file for writing, so the case cannot measure anything there.
  it.skipIf(process.getuid?.() === 0)('a 0400 lock file is refused credential-unusable, naming chmod 600', async () => {
    const home = mkTmp('codex-auth-lockmode-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    writeFileSync(lockPath(dir), '', { mode: 0o400 });
    chmodSync(lockPath(dir), 0o400);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] });
    const [line] = driverLines(r.stdout);
    expect(line.error).toBe('credential-unusable');
    expect(line.message).toContain(lockPath(dir));
    expect(line.message).toMatch(/chmod 600/);
    expect(modeOf(lockPath(dir))).toBe(0o400);
  });

  // The same EACCES, from O_CREAT in an authDir this process cannot write: there is no lock file to chmod.
  it.skipIf(process.getuid?.() === 0)('a lock the open cannot create in a 0500 authDir names the authDir, not chmod 600', async () => {
    const home = mkTmp('codex-auth-lockdir-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const credBefore = lstatKey(credPath(dir));
    chmodSync(dir, 0o500);
    try {
      const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: nextRecord() }] });
      const [line] = driverLines(r.stdout);
      expect(line.error).toBe('credential-unusable');
      expect(line.message).toContain(lockPath(dir));
      expect(line.message).toContain(`check the permissions of ${dir}`);
      expect(line.message).not.toMatch(/chmod 600/);
      expect(existsSync(lockPath(dir))).toBe(false);
      expect(lstatKey(credPath(dir))).toBe(credBefore);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  it('a symlink at the checkpoint path is unlinked, never followed: its target is untouched', async () => {
    const home = mkTmp('codex-auth-pendlink-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const target = join(home, 'pending-target');
    writeFileSync(target, 'pending target', { mode: 0o644 });
    chmodSync(target, 0o644);
    const targetBefore = lstatKey(target);
    symlinkSync(target, pendingPath(dir));
    const rec = nextRecord();
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'commit', record: rec }] });
    expect(r.status, r.stderr).toBe(0);
    expect(driverLines(r.stdout)[0].result).toBe(true);
    expect(readFileSync(target, 'utf8')).toBe('pending target');
    expect(lstatKey(target)).toBe(targetBefore);
    expect(lstatSync(credPath(dir)).isFile(), 'the credential is a regular file, not the link').toBe(true);
    expect(fileRecord(dir)).toEqual(rec);
    expect(existsSync(pendingPath(dir))).toBe(false);
  });

  it('held: a second process waits, and takes the lock once the first releases', async () => {
    const home = mkTmp('codex-auth-wait-');
    const dir = laneDir(home);
    const ready = join(home, 'a-holds');
    const [a, b] = await Promise.all([
      runAuthDriver(home, { authDir: dir, ops: [{ op: 'hold', ms: 500, touch: ready }] }),
      runAuthDriver(home, { authDir: dir, ops: [{ op: 'wait', path: ready, timeoutMs: 5000 }, { op: 'hold', ms: 0 }] }),
    ]);
    expect(a.status, a.stderr).toBe(0);
    expect(b.status, b.stderr).toBe(0);
    const held = driverLines(b.stdout)[1];
    expect(held.result).toBe('released');
    expect(held.ms).toBeGreaterThanOrEqual(400);
    expect(held.ms).toBeLessThanOrEqual(2000);
  });

  it('held: past its bound the second process answers auth-lock-busy', async () => {
    const home = mkTmp('codex-auth-busy-');
    const dir = laneDir(home);
    const ready = join(home, 'a-holds');
    const [a, b] = await Promise.all([
      runAuthDriver(home, { authDir: dir, ops: [{ op: 'hold', ms: 2000, touch: ready }] }),
      runAuthDriver(home, {
        authDir: dir, consts: { LOCK_WAIT_S: 0.3 },
        ops: [{ op: 'wait', path: ready, timeoutMs: 5000 }, { op: 'hold', ms: 0 }],
      }),
    ]);
    expect(a.status, a.stderr).toBe(0);
    const busy = driverLines(b.stdout)[1];
    expect(busy.error).toBe('auth-lock-busy');
    expect(busy.message).toContain(lockPath(dir));
    expect(busy.ms).toBeGreaterThanOrEqual(250);
    expect(busy.ms).toBeLessThan(1500);
  });

  it('held: a holder killed with SIGKILL releases at once', async () => {
    const home = mkTmp('codex-auth-kill-');
    const dir = laneDir(home);
    const ready = join(home, 'a-holds');
    let killed: number[] = [];
    let killAt = 0;
    let bTookAt = 0;
    // A keeps the lock 30 s. The case kills it itself, 700 ms after B has seen A's ready file (so B is past its `wait`
    // and polling the lock), so neither process's interpreter start-up is inside any bound. runAuthDriver's own
    // timeout is only a backstop here.
    const aRun = runAuthDriver(home, { authDir: dir, ops: [{ op: 'hold', ms: 30000, touch: ready }] }, {}, { timeoutMs: 18000 });
    const bRun = runAuthDriver(home, {
      authDir: dir, consts: { LOCK_WAIT_S: 15 },
      ops: [{ op: 'wait', path: ready, timeoutMs: 10000 }, { op: 'hold', ms: 0 }],
    }, {}, {
      timeoutMs: 18000,
      onLine: (l) => {
        if (l.op === 'wait') {
          setTimeout(() => { killAt = Date.now(); killed = killDriver(`${reEscape(home)}.*"ms":30000`); }, 700);
        }
        if (l.op === 'hold') bTookAt = Date.now();
      },
    });
    const [a, b] = await Promise.all([aRun, bRun]);
    expect(killed, 'the case killed A, and only A').toHaveLength(1);
    expect(a.timedOut, 'A died of the case\'s SIGKILL, not the backstop').toBe(false);
    expect(a.status, 'a signal ended A').toBeNull();
    expect(b.status, b.stderr).toBe(0);
    const took = driverLines(b.stdout)[1];
    expect(took.result).toBe('released');
    expect(took.ms, 'B waited while A held').toBeGreaterThan(500);
    expect(bTookAt - killAt, 'B took the lock as A died, far inside A\'s 30 s hold').toBeLessThan(2000);
  });

  it('held: re-entered in the same thread it raises HeldReentry at once, never waits', async () => {
    const home = mkTmp('codex-auth-reenter-');
    const dir = laneDir(home);
    const r = await runAuthDriver(home, { authDir: dir, consts: { LOCK_WAIT_S: 5 }, ops: [{ op: 'reenter' }] });
    const [line] = driverLines(r.stdout);
    expect(line.error).toBe('HeldReentry');
    expect(line.ms).toBeLessThan(1000);
  });

  it('a crash after the checkpoint and before the rename is recovered by the next holder', async () => {
    const home = mkTmp('codex-auth-crash-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const old = readFileSync(credPath(dir), 'utf8');
    const rec = nextRecord();
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: rec }] });
    expect(crash.status, crash.stderr).toBe(9);
    expect(existsSync(pendingPath(dir)), 'the checkpoint survived the crash').toBe(true);
    expect(readFileSync(credPath(dir), 'utf8'), 'the credential is still the old one').toBe(old);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }, { op: 'read' }] });
    expect(r.status, r.stderr).toBe(0);
    const [recovered, read] = driverLines(r.stdout);
    expect(recovered.result).toBe('promoted');
    expect(read).toMatchObject({ credential: 'present', account_id: 'acct-fixture-next' });
    expect(fileRecord(dir)).toEqual(rec);
    expect(existsSync(pendingPath(dir))).toBe(false);
  });

  it('a partial checkpoint is discarded, and the credential is unchanged', async () => {
    const home = mkTmp('codex-auth-partial-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const before = lstatKey(credPath(dir));
    const old = readFileSync(credPath(dir), 'utf8');
    writeFileSync(pendingPath(dir), JSON.stringify(nextRecord()).slice(0, 40), { mode: 0o600 });
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(r.status, r.stderr).toBe(0);
    expect(driverLines(r.stdout)[0].result).toBe('discarded');
    expect(readFileSync(credPath(dir), 'utf8')).toBe(old);
    expect(lstatKey(credPath(dir))).toBe(before);
    expect(existsSync(pendingPath(dir))).toBe(false);
  });

  it('a checkpoint older than the credential is discarded, never promoted', async () => {
    const home = mkTmp('codex-auth-stale-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const old = readFileSync(credPath(dir), 'utf8');
    writeFileSync(pendingPath(dir), JSON.stringify(nextRecord()), { mode: 0o600 });
    const anHourAgo = Date.now() / 1000 - 3600;
    utimesSync(pendingPath(dir), anHourAgo, anHourAgo);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(r.status, r.stderr).toBe(0);
    expect(driverLines(r.stdout)[0].result).toBe('discarded');
    expect(readFileSync(credPath(dir), 'utf8')).toBe(old);
    expect(existsSync(pendingPath(dir))).toBe(false);
  });

  // A file moved into place keeps its own mtime, so another family's file restored from elsewhere can be OLDER than a
  // checkpoint a crash left; the mtime rule alone would promote over it.
  it('a checkpoint is never promoted over another family\'s file, even one older than it', async () => {
    const home = mkTmp('codex-auth-crash-foreign-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: nextRecord() }] });
    expect(crash.status, crash.stderr).toBe(9);
    const p = writeCred(dir, FOREIGN[0][1]);
    const anHourAgo = Date.now() / 1000 - 3600;
    utimesSync(p, anHourAgo, anHourAgo);
    const bytes = readFileSync(p);
    const before = lstatKey(p);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(driverLines(r.stdout)[0].error).toBe('foreign-family');
    expect(readFileSync(p).equals(bytes)).toBe(true);
    expect(lstatKey(p)).toBe(before);
    expect(existsSync(pendingPath(dir)), 'the checkpoint is kept, never lost').toBe(true);
  });

  it.each(NOT_PRESENT_CHECKPOINTS)('a parseable checkpoint that is not a present backend record is discarded, never promoted (%s)', async (_name, make) => {
    const home = mkTmp('codex-auth-notpresent-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    // The credential an hour old, so the checkpoint is newer and the mtime rule alone would promote it.
    const anHourAgo = Date.now() / 1000 - 3600;
    utimesSync(credPath(dir), anHourAgo, anHourAgo);
    const bytes = readFileSync(credPath(dir));
    const before = lstatKey(credPath(dir));
    writeFileSync(pendingPath(dir), JSON.stringify(make()), { mode: 0o600 });
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(r.status, r.stderr).toBe(0);
    expect(driverLines(r.stdout)[0].result).toBe('discarded');
    expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
    expect(lstatKey(credPath(dir))).toBe(before);
    expect(existsSync(pendingPath(dir))).toBe(false);
  });

  // The discard's unlink, refused: the lock already exists, so held() opens it in a 0500 authDir without creating
  // anything, and the read and fsync of the checkpoint succeed; only the unlink needs to write the directory.
  it.skipIf(process.getuid?.() === 0)('a checkpoint the discard cannot unlink in a 0500 authDir is refused credential-unusable, both files kept', async () => {
    const home = mkTmp('codex-auth-discard-eacces-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const first = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(driverLines(first.stdout)[0].result, first.stderr).toBe('none');
    expect(existsSync(lockPath(dir)), 'the lock exists before the directory is made read-only').toBe(true);
    writeFileSync(pendingPath(dir), '{}', { mode: 0o600 });
    const bytes = readFileSync(credPath(dir));
    const before = lstatKey(credPath(dir));
    const pendingBefore = lstatKey(pendingPath(dir));
    chmodSync(dir, 0o500);
    try {
      const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
      const [line] = driverLines(r.stdout);
      expect(line.error, r.stderr).toBe('credential-unusable');
      expect(line.message).toContain(pendingPath(dir));
      expect(line.message).toContain('cannot be removed');
      expect(line.message).toContain(`check the permissions of ${dir}`);
      expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
      expect(lstatKey(credPath(dir))).toBe(before);
      expect(readFileSync(pendingPath(dir), 'utf8')).toBe('{}');
      expect(lstatKey(pendingPath(dir))).toBe(pendingBefore);
    } finally {
      chmodSync(dir, 0o700);
    }
  });

  // A checkpoint the open cannot read may still be the only copy of a refreshed pair: it is kept, never discarded.
  it.skipIf(process.getuid?.() === 0)('a checkpoint that cannot be read is refused credential-unusable and kept; once readable it is promoted', async () => {
    const home = mkTmp('codex-auth-recover-unread-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const rec = nextRecord();
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: rec }] });
    expect(crash.status, crash.stderr).toBe(9);
    const bytes = readFileSync(credPath(dir));
    const before = lstatKey(credPath(dir));
    const pendingBytes = readFileSync(pendingPath(dir));
    chmodSync(pendingPath(dir), 0o000);
    const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    chmodSync(pendingPath(dir), 0o600);
    const [refused] = driverLines(r.stdout);
    expect(refused.error, r.stderr).toBe('credential-unusable');
    expect(refused.message).toContain(pendingPath(dir));
    expect(refused.message).toContain('cannot be read (EACCES)');
    expect(refused.message).toContain(`chmod 600 ${pendingPath(dir)}`);
    expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
    expect(lstatKey(credPath(dir))).toBe(before);
    expect(readFileSync(pendingPath(dir)).equals(pendingBytes), 'the checkpoint is kept, never lost').toBe(true);
    const again = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }, { op: 'read' }] });
    const [promoted, read] = driverLines(again.stdout);
    expect(promoted.result, again.stderr).toBe('promoted');
    expect(read).toMatchObject({ credential: 'present', account_id: 'acct-fixture-next' });
    expect(fileRecord(dir)).toEqual(rec);
  });

  it.each([['enospc-fsync:1', 'made durable'], ['enospc-replace:1', 'renamed into place']])('a promotion that meets a full disk (%s) refuses credential-unusable and keeps both files; the next holder promotes', async (fault, words) => {
    const home = mkTmp('codex-auth-recover-enospc-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const rec = nextRecord();
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: rec }] });
    expect(crash.status, crash.stderr).toBe(9);
    const bytes = readFileSync(credPath(dir));
    const before = lstatKey(credPath(dir));
    const pendingBytes = readFileSync(pendingPath(dir));
    const barrier = join(home, 'checked');
    let credAtRefusal = Buffer.alloc(0);
    let credKeyAtRefusal = '';
    let pendingAtRefusal = Buffer.alloc(0);
    const r = await runAuthDriver(home, {
      authDir: dir, faults: [fault],
      ops: [{ op: 'recover' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'recover' }, { op: 'read' }],
    }, {}, {
      onLine: (l) => {
        if (l.op !== 'recover' || existsSync(barrier)) return;
        credAtRefusal = readFileSync(credPath(dir));
        credKeyAtRefusal = lstatKey(credPath(dir));
        pendingAtRefusal = existsSync(pendingPath(dir)) ? readFileSync(pendingPath(dir)) : Buffer.alloc(0);
        writeFileSync(barrier, '');
      },
    });
    const [refused, , promoted, read] = driverLines(r.stdout);
    expect(refused.error, r.stderr).toBe('credential-unusable');
    expect(refused.message).toContain(pendingPath(dir));
    expect(refused.message).toContain('ENOSPC');
    expect(refused.message).toContain(words);
    expect(credAtRefusal.equals(bytes), 'the credential\'s bytes are unchanged').toBe(true);
    expect(credKeyAtRefusal, 'and its inode and mtime').toBe(before);
    expect(pendingAtRefusal.equals(pendingBytes), 'the checkpoint is kept, never lost').toBe(true);
    expect(promoted.result).toBe('promoted');
    expect(read).toMatchObject({ credential: 'present', account_id: 'acct-fixture-next' });
    expect(fileRecord(dir)).toEqual(rec);
    expect(existsSync(pendingPath(dir))).toBe(false);
  });

  it.each(['enospc-writes:1', 'enospc-fsync:1', 'enospc-replace:1'])('a full disk loses nothing (%s): read answers from memory, and a held retry writes it', async (fault) => {
    const home = mkTmp('codex-auth-enospc-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const old = readFileSync(credPath(dir), 'utf8');
    const rec = nextRecord();
    const barrier = join(home, 'checked');
    let fileAtRead = '';
    let pendingAtRead = true;
    const r = await runAuthDriver(home, {
      authDir: dir, faults: [fault],
      ops: [
        { op: 'commit', record: rec }, { op: 'read' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'held-retry' },
        // The written record is cleared: a second retry finds none, and a read answers from the file.
        { op: 'held-retry' }, { op: 'read' },
      ],
    }, {}, {
      onLine: (l) => {
        if (l.op !== 'read' || existsSync(barrier)) return;
        fileAtRead = readFileSync(credPath(dir), 'utf8');
        pendingAtRead = existsSync(pendingPath(dir));
        writeFileSync(barrier, '');
      },
    });
    expect(r.status, r.stderr).toBe(0);
    const [commit, read, , retry, again, after] = driverLines(r.stdout);
    expect(again.result, 'the written record left the map').toBe('none');
    expect(after).toMatchObject({ credential: 'present', account_id: 'acct-fixture-next' });
    expect(after.detail, 'the read answers from the file').not.toMatch(/held in memory/);
    expect(commit.result, 'the commit could not write').toBe(false);
    expect(read).toMatchObject({
      credential: 'present', account_id: 'acct-fixture-next',
      access_token: (rec.access_token as string).length, refresh_token: (rec.refresh_token as string).length,
    });
    expect(fileAtRead, 'the file still held the old credential').toBe(old);
    expect(pendingAtRead, 'the partial checkpoint was unlinked').toBe(false);
    expect(retry.result).toBe('written');
    expect(fileRecord(dir)).toEqual(rec);
    expect(existsSync(pendingPath(dir))).toBe(false);
    expect(r.stderr).toBe('');
  });

  it('a credential changed under an unsaved record is kept', async () => {
    const home = mkTmp('codex-auth-changed-');
    const dir = laneDir(home);
    const planted = [...Object.values(plantBackendCredential(dir))];
    const rec = nextRecord();
    const barrier = join(home, 'signed-in');
    const r = await runAuthDriver(home, {
      authDir: dir, faults: ['enospc-writes:1'],
      ops: [
        { op: 'commit', record: rec }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'read' }, { op: 'held-retry' },
      ],
    }, {}, {
      onLine: (l) => {
        if (l.op !== 'commit') return;
        // A sign-in elsewhere: a new credential renamed into place, a new inode.
        const side = join(home, 'signin');
        planted.push(...Object.values(plantBackendCredential(side, { accountId: 'acct-fixture-signin' })));
        renameSync(credPath(side), credPath(dir));
        writeFileSync(barrier, '');
      },
    });
    expect(r.status, r.stderr).toBe(0);
    const [commit, , read, retry] = driverLines(r.stdout);
    expect(commit.result).toBe(false);
    expect(read).toMatchObject({ credential: 'present', account_id: 'acct-fixture-signin' });
    expect(retry.result).toBe('dropped');
    expect(fileRecord(dir).account_id, 'the signed-in credential is kept').toBe('acct-fixture-signin');
    const lines = r.stderr.split('\n').filter((l) => l !== '');
    expect(lines, 'one line, from the retry alone').toHaveLength(1);
    expect(lines[0]).toContain(dir);
    for (const piece of secretPieces([...planted, rec.access_token as string, rec.refresh_token as string, rec.id_token as string])) {
      expect(r.stderr).not.toContain(piece);
    }
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
