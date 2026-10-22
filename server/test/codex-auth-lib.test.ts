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
  chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, renameSync, rmSync, symlinkSync, utimesSync, writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
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
      'mod._UNSAVED[os.path.normpath(sys.argv[2])] = ({"access_token": "atok-fixture-u", "refresh_token": "rtok-fixture-u"}, None, None)',
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
const statusPath = (dir: string): string => join(dir, 'auth.status.json');

/** The account id every token the fake endpoint issues carries (so a status file can be checked for it). */
const ISSUED_ACCOUNT_ID = 'acct-fixture-issued';

/** A token answer the fake endpoint gives a refresh: three new tokens, the access token's `exp` `expiresIn` seconds
 *  from now (default 3600; inside the 60 s skew a refreshed lane is still expiring). Fields set to `undefined` in `o`
 *  are left out of the answer. */
function issuedAnswer(o: { expiresIn?: number; omit?: Array<'access_token' | 'refresh_token' | 'id_token'> } = {}): Record<string, unknown> {
  const now = Math.floor(Date.now() / 1000);
  const claim = { [ACCOUNT_CLAIM]: { chatgpt_account_id: ISSUED_ACCOUNT_ID } };
  const answer: Record<string, unknown> = {
    access_token: syntheticJwt({ exp: now + (o.expiresIn ?? 3600), iat: now, jti: randomBytes(8).toString('hex'), ...claim }),
    refresh_token: `rtok-fixture-issued-${randomBytes(16).toString('hex')}`,
    id_token: syntheticJwt({ exp: now + 3600, iat: now, email: 'lane-a@example.invalid', ...claim }),
    token_type: 'Bearer',
    expires_in: o.expiresIn ?? 3600,
  };
  for (const k of o.omit ?? []) delete answer[k];
  return answer;
}
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
    // Task 3 adds the status file to this case: it is named in the last expectation's message, not in the title, so
    // Task 2's mutation records keep naming the case they named.
    const home = mkTmp('codex-auth-umask-');
    const top = join(home, 'lvl1');
    const dir = join(top, 'lvl2');
    const srv = await fakeAuthServer({ token: [{ status: 200, body: issuedAnswer() }] });
    try {
      const a = await runAuthDriver(home, { authDir: dir, umask: 0o277, ops: [{ op: 'commit', record: nextRecord() }] });
      expect(a.status, a.stderr).toBe(0);
      expect(driverLines(a.stdout)[0].result).toBe(true);
      // A refresh (forced by a 10000 s window over a token fresh for 7200 s) writes the status file (Task 3).
      const s = await runAuthDriver(home, { authDir: dir, umask: 0o277, ops: [{ op: 'ensure_fresh', withinS: 10000 }] },
        { CCRC_CODEX_AUTH_BASE: srv.base });
      expect(s.status, s.stderr).toBe(0);
      expect(srv.requests).toHaveLength(1);
      expect(modeOf(statusPath(dir)), 'the status file').toBe(0o600);
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
      await srv.close();
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

  // The checkpoint changed between recover's lstat and its open, out of band (the lock excludes only ccrc's own
  // writers). The race is made exact in a process of its own: an `os.open` that, at the first open of the checkpoint,
  // first removes it (`gone`) or puts a symlink to `target` in its place (`symlink`).
  const recoverAfterSwap = (home: string, dir: string, swap: 'gone' | 'symlink', target = ''): Record<string, any> => {
    const code = [
      'import importlib.util, json, os, sys',
      'sys.dont_write_bytecode = True',
      'spec = importlib.util.spec_from_file_location("ccgpt_auth", sys.argv[1])',
      'mod = importlib.util.module_from_spec(spec)',
      'spec.loader.exec_module(mod)',
      'd, swap, target = sys.argv[2], sys.argv[3], sys.argv[4]',
      'pending = mod.paths_for(d).pending',
      'real_open = os.open',
      'done = []',
      'def swapping_open(path, *a, **k):',
      '    if os.fspath(path) == pending and not done:',
      '        done.append(1)',
      '        os.unlink(pending)',
      '        if swap == "symlink":',
      '            os.symlink(target, pending)',
      '    return real_open(path, *a, **k)',
      'os.open = swapping_open',
      'try:',
      '    with mod.held(d):',
      '        print(json.dumps({"result": mod.recover_pending(d)}))',
      'except mod.AuthError as e:',
      '    print(json.dumps({"error": e.word, "message": str(e)}))',
    ].join('\n');
    const r = spawnSync(PY as string, ['-I', '-c', code, AUTH_LIB, dir, swap, target], {
      encoding: 'utf8', cwd: home, timeout: 5000,
      env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE },
    });
    expect(r.status, r.stderr).toBe(0);
    return JSON.parse(r.stdout.trim()) as Record<string, any>;
  };

  it('a checkpoint removed between the lstat and the open answers none, as one absent at the lstat does', async () => {
    const home = mkTmp('codex-auth-recover-gone-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: nextRecord() }] });
    expect(crash.status, crash.stderr).toBe(9);
    const bytes = readFileSync(credPath(dir));
    const before = lstatKey(credPath(dir));
    expect(recoverAfterSwap(home, dir, 'gone')).toEqual({ result: 'none' });
    expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
    expect(lstatKey(credPath(dir))).toBe(before);
  });

  it('a symlink swapped in between the lstat and the open is refused naming the symlink, never chmod; the next recover removes it', async () => {
    const home = mkTmp('codex-auth-recover-swapped-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: nextRecord() }] });
    expect(crash.status, crash.stderr).toBe(9);
    const target = join(home, 'elsewhere.json');
    writeFileSync(target, 'not the checkpoint', { mode: 0o600 });
    const bytes = readFileSync(credPath(dir));
    const before = lstatKey(credPath(dir));
    const refused = recoverAfterSwap(home, dir, 'symlink', target);
    expect(refused.error).toBe('credential-unusable');
    expect(refused.message).toContain(pendingPath(dir));
    expect(refused.message).toContain('became a symlink while it was read (ELOOP)');
    expect(refused.message).not.toContain('chmod 600');
    expect(lstatSync(pendingPath(dir)).isSymbolicLink(), 'the symlink is left for the next recover').toBe(true);
    expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
    expect(lstatKey(credPath(dir))).toBe(before);
    const again = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(driverLines(again.stdout)[0].result, again.stderr).toBe('discarded');
    expect(() => lstatSync(pendingPath(dir)), 'the symlink is gone').toThrow();
    expect(readFileSync(target, 'utf8'), 'and what it pointed at is untouched').toBe('not the checkpoint');
    expect(readFileSync(credPath(dir)).equals(bytes)).toBe(true);
  });

  // A directory fsync opens the directory for reading, and nothing before it needs to: in a 0300 authDir whose lock
  // already exists, the checkpoint is written, fsynced and renamed into place, and only the directory fsync fails
  // (EACCES). That is a failed fsync, which this patch can raise, not a lost one, which only a power cut shows.
  it.skipIf(process.getuid?.() === 0)('a commit whose directory fsync fails keeps its record bound to the file now in place; the held retry re-runs it, never drops it', async () => {
    const home = mkTmp('codex-auth-dirsync-commit-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const first = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }] });
    expect(driverLines(first.stdout)[0].result, first.stderr).toBe('none');
    expect(existsSync(lockPath(dir)), 'the lock exists before the directory loses its read bit').toBe(true);
    const rec = nextRecord();
    const barrier = join(home, 'readable-again');
    let restored = false;
    chmodSync(dir, 0o300);
    try {
      const r = await runAuthDriver(home, {
        authDir: dir,
        ops: [
          { op: 'commit', record: rec }, { op: 'read' }, { op: 'held-retry' },
          { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'held-retry' }, { op: 'held-retry' },
        ],
      }, {}, {
        onLine: (l) => {
          if (l.op !== 'held-retry' || restored) return;
          chmodSync(dir, 0o700);
          restored = true;
          writeFileSync(barrier, '');
        },
      });
      const [commit, read, stillUnsaved, , written, none] = driverLines(r.stdout);
      expect(commit.result, r.stderr).toBe(false);
      expect(read).toMatchObject({ credential: 'present', account_id: 'acct-fixture-next' });
      expect(stillUnsaved.result, 'bound to the file the rename put in place, so never dropped').toBe('still-unsaved');
      expect(written.result).toBe('written');
      expect(none.result, 'the written record left the map').toBe('none');
      expect(fileRecord(dir)).toEqual(rec);
      expect(existsSync(pendingPath(dir))).toBe(false);
      expect(r.stderr, 'no record was dropped').toBe('');
    } finally {
      if (!restored) chmodSync(dir, 0o700);
    }
  });

  it.skipIf(process.getuid?.() === 0)('a promotion whose directory fsync fails still answers promoted: the checkpoint is the credential', async () => {
    const home = mkTmp('codex-auth-dirsync-recover-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const rec = nextRecord();
    const crash = await runAuthDriver(home, { authDir: dir, faults: ['die-before-rename'], ops: [{ op: 'commit', record: rec }] });
    expect(crash.status, crash.stderr).toBe(9);
    expect(existsSync(lockPath(dir)), 'the crashed commit made the lock').toBe(true);
    chmodSync(dir, 0o300);
    try {
      const r = await runAuthDriver(home, { authDir: dir, ops: [{ op: 'recover' }, { op: 'read' }] });
      const [promoted, read] = driverLines(r.stdout);
      expect(promoted.result, r.stderr).toBe('promoted');
      expect(read).toMatchObject({ credential: 'present', account_id: 'acct-fixture-next' });
      expect(fileRecord(dir)).toEqual(rec);
      expect(existsSync(pendingPath(dir))).toBe(false);
    } finally {
      chmodSync(dir, 0o700);
    }
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

// ── Task 3: the refresh, its error codes and the status file ───────────────────────────────────────────────────

/** The spec's six codes that mean needs-signin (spec §2.6), spelled here as the test's own copy of the contract. */
const NEEDS_SIGNIN_CODES = [
  'invalid_grant', 'invalid_refresh_token', 'token_expired', 'refresh_token_expired', 'refresh_token_invalidated',
  'refresh_token_reused',
];

const statusText = (dir: string): string => readFileSync(statusPath(dir), 'utf8');
const statusOf = (dir: string): Record<string, any> => JSON.parse(statusText(dir)) as Record<string, any>;

type IdentityKey = { ino: string; mtimeNs: string; size: string };

/** The credential's identity as the status file records it, compared exactly: `mtimeNs` is past 2**53, so each field
 *  is read from the raw text, never through JSON.parse. `null` when the status records no identity. */
function statusIdentity(text: string): IdentityKey | null {
  const m = /"identity":\s*(null|\{[^}]*\})/.exec(text);
  expect(m, 'the status file names an identity').not.toBeNull();
  if ((m as RegExpExecArray)[1] === 'null') return null;
  const body = (m as RegExpExecArray)[1];
  const field = (k: string): string => (new RegExp(`"${k}":\\s*(\\d+)`).exec(body) as RegExpExecArray)[1];
  return { ino: field('ino'), mtimeNs: field('mtimeNs'), size: field('size') };
}

/** The credential file's lstat, in the same exact form. */
function fileIdentity(dir: string): IdentityKey {
  const s = lstatSync(credPath(dir), { bigint: true });
  return { ino: String(s.ino), mtimeNs: String(s.mtimeNs), size: String(s.size) };
}

/** The three tokens of a token answer (or of a planting). */
const tokensOf = (o: Record<string, unknown>): string[] =>
  ['access_token', 'refresh_token', 'id_token', 'access', 'refresh', 'id']
    .map((k) => o[k]).filter((v): v is string => typeof v === 'string');

// Every status file a Task 3 case left, with the secrets it must not hold; the closing case re-checks them all.
const STATUS_SCANS: Array<{ dir: string; secrets: string[] }> = [];

/** The status file, if one exists, holds no token, no `.`-separated segment of one and no account id. */
function expectStatusClean(dir: string, secrets: string[]): void {
  STATUS_SCANS.push({ dir, secrets });
  if (!existsSync(statusPath(dir))) return;
  const text = statusText(dir);
  for (const piece of secretPieces(secrets)) expect(text, 'the status file holds a token piece').not.toContain(piece);
  for (const id of [FIXTURE_ACCOUNT_ID, ISSUED_ACCOUNT_ID, 'acct-fixture-1']) {
    expect(text, 'the status file holds an account id').not.toContain(id);
  }
}

/** Run `fn` against a fresh fakeAuthServer, closing it afterwards. */
async function withAuth<T>(script: Parameters<typeof fakeAuthServer>[0], fn: (srv: Awaited<ReturnType<typeof fakeAuthServer>>) => Promise<T>): Promise<T> {
  const srv = await fakeAuthServer(script);
  try {
    return await fn(srv);
  } finally {
    await srv.close();
  }
}

/** One driver run of `ops` against `base`; its lines. */
async function runFresh(
  home: string, dir: string, base: string, ops: object[] = [{ op: 'ensure_fresh' }], extra: object = {},
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  o: { timeoutMs?: number; onLine?: (line: Record<string, any>) => void } = {},
): Promise<{ status: number | null; stdout: string; stderr: string; lines: Array<Record<string, any>> }> {
  const r = await runAuthDriver(home, { authDir: dir, ops, ...extra }, { CCRC_CODEX_AUTH_BASE: base }, o);
  expect(r.timedOut, r.stderr).toBe(false);
  return { ...r, lines: driverLines(r.stdout) };
}

/** A 400 refusal of the refresh, whose kind and stored code a case asserts. */
async function refusal(body: unknown, status = 400): Promise<{ line: Record<string, any>; st: Record<string, any>; text: string; requests: number; fileId: IdentityKey }> {
  const home = mkTmp('codex-auth-refusal-');
  const dir = laneDir(home);
  const t = plantBackendCredential(dir, { expiresIn: -120 });
  return withAuth({ token: [{ status, body }] }, async (srv) => {
    const r = await runFresh(home, dir, srv.base);
    expectStatusClean(dir, tokensOf(t));
    return { line: r.lines[0], st: statusOf(dir), text: statusText(dir), requests: srv.requests.length, fileId: fileIdentity(dir) };
  });
}

/** The status file's temp path: a directory planted there makes every status write fail (its unlink is EISDIR). */
const statusTmpPath = (dir: string): string => `${statusPath(dir)}.tmp`;

/** A status file bound to the credential's current identity, written by hand (as another process would leave it):
 *  the identity's digits are spliced in as text, since `mtimeNs` is past 2**53. */
function plantStatus(dir: string, fields: Record<string, unknown>): void {
  const id = fileIdentity(dir);
  const body = JSON.stringify({
    version: 1, family: 'chatgpt-backend', state: 'ok', expiresAt: null, lastRefreshAt: null, lastErrorCode: null,
    lastRequestId: null, consent: null, identity: '@ID@', configHash: '0'.repeat(64), unsaved: false, updatedAt: 0,
    ...fields,
  });
  writeFileSync(statusPath(dir), body.replace('"@ID@"', `{"ino": ${id.ino}, "mtimeNs": ${id.mtimeNs}, "size": ${id.size}}`));
}

/** Run `code` (python) in a process of its own with the library loaded as `mod`; argv[2..] are `args`. */
function pyWithLib(home: string, body: string[], args: string[]): { status: number | null; stdout: string; stderr: string } {
  const code = [
    'import importlib.util, json, os, sys',
    'sys.dont_write_bytecode = True',
    'spec = importlib.util.spec_from_file_location("ccgpt_auth", sys.argv[1])',
    'mod = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(mod)',
    ...body,
  ].join('\n');
  const r = spawnSync(PY as string, ['-I', '-c', code, AUTH_LIB, ...args], {
    encoding: 'utf8', cwd: home, timeout: 5000,
    env: { PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: home, CCRC_CODEX_AUTH_BASE: CLOSED_AUTH_BASE },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe.skipIf(!PY)('the refresh (codex-bridge spec §2.6, §5)', () => {
  it('a valid token is returned with no lock taken and no request made', async () => {
    const home = mkTmp('codex-auth-valid-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir);
    await withAuth({ token: [{ status: 200, body: issuedAnswer() }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base);
      expect(r.status, r.stderr).toBe(0);
      expect(r.lines[0]).toMatchObject({ credential: 'present', access_token: t.access.length, refresh_token: t.refresh.length });
      expect(srv.requests).toHaveLength(0);
      expect(existsSync(lockPath(dir)), 'no lock was taken').toBe(false);
      expect(existsSync(statusPath(dir)), 'nothing was written').toBe(false);
    });
  });

  it('an expiring token is refreshed once: new tokens on disk, status ok with lastRefreshAt and lastRequestId', async () => {
    const home = mkTmp('codex-auth-refresh-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: 30 });
    const answer = issuedAnswer();
    await withAuth({ token: [{ status: 200, body: answer, headers: { 'x-request-id': 'req-fixture-1' } }] }, async (srv) => {
      const started = Math.floor(Date.now() / 1000);
      const r = await runFresh(home, dir, srv.base);
      expect(r.status, r.stderr).toBe(0);
      expect(r.stderr).toBe('');
      expect(r.lines[0]).toMatchObject({
        credential: 'present', access_token: (answer.access_token as string).length,
        refresh_token: (answer.refresh_token as string).length, account_id: ISSUED_ACCOUNT_ID,
      });
      expect(srv.requests).toHaveLength(1);
      const q = srv.requests[0];
      expect([q.method, q.path, q.headers['content-type']]).toEqual(['POST', AUTH_ROUTES.token, 'application/json']);
      expect(q.form).toMatchObject({ grant_type: 'refresh_token', refresh_token: t.refresh, scope: 'openid profile email' });
      expect(typeof q.form?.client_id).toBe('string');
      const exp = payloadOf(answer.access_token as string).exp as number;
      expect(fileRecord(dir), 'LiteLLM\'s five keys, and no other').toEqual({
        access_token: answer.access_token, refresh_token: answer.refresh_token, id_token: answer.id_token,
        expires_at: exp, account_id: ISSUED_ACCOUNT_ID,
      });
      const st = statusOf(dir);
      expect(st).toMatchObject({
        version: 1, family: 'chatgpt-backend', state: 'ok', expiresAt: exp, lastErrorCode: null,
        lastRequestId: 'req-fixture-1', consent: null, unsaved: false,
      });
      expect(Object.keys(st).sort()).toEqual([
        'configHash', 'consent', 'expiresAt', 'family', 'identity', 'lastErrorCode', 'lastRefreshAt', 'lastRequestId',
        'state', 'unsaved', 'updatedAt', 'version',
      ]);
      expect(st.lastRefreshAt).toBeGreaterThanOrEqual(started);
      expect(st.lastRefreshAt).toBeLessThanOrEqual(started + 30);
      expect(st.configHash).toMatch(/^[0-9a-f]{64}$/);
      expect(statusIdentity(statusText(dir)), 'the status binds the new file').toEqual(fileIdentity(dir));
      expect(existsSync(pendingPath(dir))).toBe(false);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  // Both drivers print a `paths` line once loaded, then wait on one barrier file the case writes when it has seen both
  // lines, so their refreshes start within a poll of each other, well inside the server's 300 ms delay.
  const raceTwo = (home: string, dir: string, base: string): Promise<Array<{ status: number | null; stdout: string; stderr: string; timedOut: boolean }>> => {
    const barrier = join(home, 'go');
    let ready = 0;
    const one = (): ReturnType<typeof runAuthDriver> => runAuthDriver(home, {
      authDir: dir, ops: [{ op: 'paths' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'ensure_fresh' }],
    }, { CCRC_CODEX_AUTH_BASE: base }, {
      onLine: (l) => { if (l.op === 'paths' && ++ready === 2) writeFileSync(barrier, ''); },
    });
    return Promise.all([one(), one()]);
  };

  it('two processes racing a refresh make exactly one token request', async () => {
    const home = mkTmp('codex-auth-race-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const answer = issuedAnswer();
    await withAuth({ token: [{ status: 200, body: answer, delayMs: 300 }] }, async (srv) => {
      const runs = await raceTwo(home, dir, srv.base);
      for (const r of runs) {
        expect(r.timedOut).toBe(false);
        expect(r.stdout, 'neither driver saw its refresh token spent').not.toContain('refresh_token_reused');
        expect(r.status, r.stdout + r.stderr).toBe(0);
        const last = driverLines(r.stdout)[2];
        expect(last).toMatchObject({ credential: 'present', access_token: (answer.access_token as string).length });
      }
      expect(srv.requests).toHaveLength(1);
      expect(fileRecord(dir).refresh_token).toBe(answer.refresh_token);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('two processes racing into invalid_grant make exactly one token request', async () => {
    const home = mkTmp('codex-auth-race-grant-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    await withAuth({ token: [{ status: 400, body: { error: 'invalid_grant' }, delayMs: 300 }] }, async (srv) => {
      const runs = await raceTwo(home, dir, srv.base);
      for (const r of runs) {
        expect(r.timedOut).toBe(false);
        expect(driverLines(r.stdout)[2].error, r.stdout + r.stderr).toBe('needs-signin');
      }
      expect(srv.requests).toHaveLength(1);
      expect(statusOf(dir).state).toBe('needs-signin');
      expectStatusClean(dir, tokensOf(t));
    });
  });

  it('a needs-signin credential answers at once while another process holds the lock', async () => {
    const home = mkTmp('codex-auth-barred-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const ready = join(home, 'a-holds');
    await withAuth({ token: [{ status: 400, body: { error: 'invalid_grant' } }] }, async (srv) => {
      const aRun = runAuthDriver(home, {
        authDir: dir, ops: [{ op: 'ensure_fresh' }, { op: 'hold', ms: 5000, touch: ready }],
      }, { CCRC_CODEX_AUTH_BASE: srv.base }, { timeoutMs: 15000 });
      const bRun = runAuthDriver(home, {
        authDir: dir, ops: [{ op: 'wait', path: ready, timeoutMs: 10000 }, { op: 'ensure_fresh' }],
      }, { CCRC_CODEX_AUTH_BASE: srv.base }, { timeoutMs: 15000 });
      const [a, b] = await Promise.all([aRun, bRun]);
      expect(driverLines(a.stdout)[0].error, a.stdout + a.stderr).toBe('needs-signin');
      const answer = driverLines(b.stdout)[1];
      expect(answer.error, b.stdout + b.stderr).toBe('needs-signin');
      expect(answer.ms, 'B never waited on A\'s lock').toBeLessThan(1000);
      expect(srv.requests, 'A\'s request alone').toHaveLength(1);
      expectStatusClean(dir, tokensOf(t));
    });
  });

  it('a crash between the token answer and the commit is recovered from the checkpoint', async () => {
    const home = mkTmp('codex-auth-refresh-crash-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const answer = issuedAnswer();
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const a = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }], { faults: ['die-before-rename'] });
      expect(a.status, a.stderr).toBe(9);
      expect(existsSync(pendingPath(dir)), 'the checkpoint survived the crash').toBe(true);
      const b = await runFresh(home, dir, srv.base);
      expect(b.status, b.stdout + b.stderr).toBe(0);
      expect(b.lines[0]).toMatchObject({ credential: 'present', access_token: (answer.access_token as string).length });
      expect(srv.requests, 'no further request').toHaveLength(1);
      expect(fileRecord(dir).refresh_token).toBe(answer.refresh_token);
      expect(existsSync(pendingPath(dir))).toBe(false);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('a full disk loses nothing: the refresh is served from memory, written by the next call, and asked for once', async () => {
    const home = mkTmp('codex-auth-refresh-enospc-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const old = readFileSync(credPath(dir), 'utf8');
    const answer = issuedAnswer();
    const barrier = join(home, 'checked');
    let afterFirst = '';
    let fileIdAtFirst: IdentityKey | null = null;
    let fileAtFirst = '';
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base, [
        { op: 'ensure_fresh' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'ensure_fresh' },
      ], { faults: ['enospc-writes:1'] }, {
        onLine: (l) => {
          if (l.op !== 'ensure_fresh' || existsSync(barrier)) return;
          afterFirst = existsSync(statusPath(dir)) ? statusText(dir) : '';
          fileIdAtFirst = fileIdentity(dir);
          fileAtFirst = readFileSync(credPath(dir), 'utf8');
          writeFileSync(barrier, '');
        },
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const [first, , second] = r.lines;
      const len = (answer.access_token as string).length;
      expect(first).toMatchObject({ credential: 'present', access_token: len });
      expect(second).toMatchObject({ credential: 'present', access_token: len });
      expect(srv.requests, 'one request in total').toHaveLength(1);
      expect(fileAtFirst, 'the first call could not write').toBe(old);
      expect(afterFirst, 'the first call wrote its status').not.toBe('');
      expect(JSON.parse(afterFirst)).toMatchObject({ state: 'ok', unsaved: true });
      expect(statusIdentity(afterFirst), 'the status binds the file still on disk').toEqual(fileIdAtFirst);
      expect(fileRecord(dir).refresh_token, 'the second call wrote the record').toBe(answer.refresh_token);
      expect(existsSync(pendingPath(dir)), 'no checkpoint is left').toBe(false);
      const st = statusOf(dir);
      expect(st).toMatchObject({ state: 'ok', unsaved: false });
      expect(typeof st.lastRefreshAt).toBe('number');
      expect(statusIdentity(statusText(dir)), 'the status binds the new file').toEqual(fileIdentity(dir));
      expect(r.stderr).toBe('');
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('a disk that stays full asks once: every call is answered from memory', async () => {
    const home = mkTmp('codex-auth-refresh-full-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: 30 });
    const old = readFileSync(credPath(dir), 'utf8');
    const answer = issuedAnswer();
    await withAuth({ token: [{ status: 200, body: answer }, { status: 200, body: issuedAnswer() }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }, { op: 'ensure_fresh' }, { op: 'ensure_fresh' }],
        { faults: ['enospc-writes:3'] });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.lines.map((l) => l.access_token)).toEqual(Array(3).fill((answer.access_token as string).length));
      expect(srv.requests, 'one request in total').toHaveLength(1);
      expect(readFileSync(credPath(dir), 'utf8'), 'the disk stayed full').toBe(old);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('a full disk that also fails the status write loses nothing: the retry writes state ok with this refresh\'s fields, never the stale state on disk', async () => {
    const home = mkTmp('codex-auth-refresh-enospc-status-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    // A config-error left under another library config: stale, so it bars nothing, but it is the status on disk.
    plantStatus(dir, { state: 'config-error', lastErrorCode: 'invalid_client' });
    const planted = statusText(dir);
    mkdirSync(statusTmpPath(dir));
    const answer = issuedAnswer();
    const barrier = join(home, 'checked');
    const started = Math.floor(Date.now() / 1000);
    let afterFirst = '';
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base, [
        { op: 'ensure_fresh' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'ensure_fresh' },
      ], { faults: ['enospc-writes:1'] }, {
        onLine: (l) => {
          if (l.op !== 'ensure_fresh' || existsSync(barrier)) return;
          afterFirst = statusText(dir);
          rmSync(statusTmpPath(dir), { recursive: true });
          writeFileSync(barrier, '');
        },
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const [first, , second] = r.lines;
      const len = (answer.access_token as string).length;
      expect(first).toMatchObject({ credential: 'present', access_token: len });
      expect(second).toMatchObject({ credential: 'present', access_token: len });
      expect(srv.requests, 'one request in total').toHaveLength(1);
      expect(afterFirst, 'the first call could not write its status').toBe(planted);
      expect(fileRecord(dir).refresh_token, 'the second call wrote the record').toBe(answer.refresh_token);
      const st = statusOf(dir);
      expect(st).toMatchObject({ state: 'ok', lastErrorCode: null, unsaved: false });
      expect(st.expiresAt, 'expiresAt is the new token\'s').toBe(payloadOf(answer.access_token as string).exp);
      expect(st.expiresAt).toBe(fileRecord(dir).expires_at);
      expect(typeof st.lastRefreshAt, 'this refresh\'s lastRefreshAt survives its failed status write').toBe('number');
      expect(st.lastRefreshAt).toBeGreaterThanOrEqual(started);
      expect(statusIdentity(statusText(dir)), 'the status binds the new file').toEqual(fileIdentity(dir));
      expect(r.stderr.split('\n').filter((l) => l.includes('could not be written')), r.stderr).toHaveLength(1);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('a needs-signin another process wrote over the replaced file never bars the unsaved record, and the retry leaves state ok', async () => {
    const home = mkTmp('codex-auth-refresh-enospc-signin-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const answer = issuedAnswer();
    const barrier = join(home, 'checked');
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base, [
        { op: 'ensure_fresh' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'ensure_fresh' },
      ], { faults: ['enospc-writes:1'] }, {
        onLine: (l) => {
          if (l.op !== 'ensure_fresh' || existsSync(barrier)) return;
          // Another refresher redeemed the replaced file's (already spent) refresh token and wrote what it met, bound
          // to that same file.
          const first = statusText(dir);
          const signin = first.replace('"state": "ok"', '"state": "needs-signin"')
            .replace('"lastErrorCode": null', '"lastErrorCode": "refresh_token_reused"');
          expect(signin).not.toBe(first);
          writeFileSync(statusPath(dir), signin);
          writeFileSync(barrier, '');
        },
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      const [, , second] = r.lines;
      expect(second, 'the unsaved record is served, not barred').toMatchObject({ credential: 'present', access_token: (answer.access_token as string).length });
      expect(srv.requests, 'one request in total').toHaveLength(1);
      expect(fileRecord(dir).refresh_token, 'the second call wrote the record').toBe(answer.refresh_token);
      expect(statusOf(dir)).toMatchObject({ state: 'ok', lastErrorCode: null, unsaved: false });
      expect(statusIdentity(statusText(dir))).toEqual(fileIdentity(dir));
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('an unsaved record the disk still cannot write is refreshed past a needs-signin measured on the replaced file', async () => {
    const home = mkTmp('codex-auth-refresh-enospc-signin2-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const a1 = issuedAnswer();
    const a2 = issuedAnswer();
    const barrier = join(home, 'checked');
    await withAuth({ token: [{ status: 200, body: a1 }, { status: 200, body: a2 }] }, async (srv) => {
      // Two failed commits: the first call's, and the retry inside the second call; the second call's own refresh
      // (forced by withinS) then commits.
      const r = await runFresh(home, dir, srv.base, [
        { op: 'ensure_fresh' }, { op: 'wait', path: barrier, timeoutMs: 5000 }, { op: 'ensure_fresh', withinS: 100000 },
      ], { faults: ['enospc-writes:2'] }, {
        onLine: (l) => {
          if (l.op !== 'ensure_fresh' || existsSync(barrier)) return;
          writeFileSync(statusPath(dir), statusText(dir).replace('"state": "ok"', '"state": "needs-signin"'));
          writeFileSync(barrier, '');
        },
      });
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.lines[2], 'the unsaved record is refreshed, not barred').toMatchObject({ credential: 'present', access_token: (a2.access_token as string).length });
      expect(srv.requests).toHaveLength(2);
      expect(srv.requests[1].form?.refresh_token, 'the record\'s refresh token is the one redeemed').toBe(a1.refresh_token);
      expect(fileRecord(dir).refresh_token).toBe(a2.refresh_token);
      expect(statusOf(dir)).toMatchObject({ state: 'ok', unsaved: false });
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(a1), ...tokensOf(a2)]);
    });
  });

  it('a status file that cannot be written is named on stderr once and never fails the refresh', async () => {
    const home = mkTmp('codex-auth-status-unwritable-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    mkdirSync(statusTmpPath(dir));
    const a1 = issuedAnswer();
    const a2 = issuedAnswer();
    await withAuth({ token: [{ status: 200, body: a1 }, { status: 200, body: a2 }] }, async (srv) => {
      // The second call is forced to refresh again, so the status write fails a second time.
      const r = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }, { op: 'ensure_fresh', withinS: 100000 }]);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.lines.map((l) => l.access_token)).toEqual([(a1.access_token as string).length, (a2.access_token as string).length]);
      expect(srv.requests).toHaveLength(2);
      expect(fileRecord(dir).refresh_token, 'the refresh is on disk').toBe(a2.refresh_token);
      expect(existsSync(statusPath(dir)), 'no status was written').toBe(false);
      const named = r.stderr.split('\n').filter((l) => l !== '');
      expect(named, 'named once').toHaveLength(1);
      expect(named[0]).toMatch(/^ccgpt-auth: the status file for .+ could not be written \(E[A-Z]+\); the credential is unaffected$/);
      for (const piece of secretPieces([...tokensOf(t), ...tokensOf(a1), ...tokensOf(a2)])) expect(r.stderr).not.toContain(piece);
    });
  });

  it('write_status outside held() is a RuntimeError, and writes nothing', () => {
    const home = mkTmp('codex-auth-status-unheld-');
    const dir = laneDir(home);
    plantBackendCredential(dir);
    const r = pyWithLib(home, [
      'try:',
      '    mod.write_status(sys.argv[2], state="ok")',
      '    print("written")',
      'except RuntimeError:',
      '    print("RuntimeError")',
    ], [dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('RuntimeError');
    expect(existsSync(statusPath(dir))).toBe(false);
  });

  it.each(['"x"', '{"ino": "1", "mtimeNs": 2, "size": 3}'])('a status whose identity is malformed (%s) is never current, over a credential path that is not a regular file', (identity) => {
    const home = mkTmp('codex-auth-status-unmeasured-');
    const dir = laneDir(home);
    const elsewhere = join(home, 'elsewhere');
    plantBackendCredential(elsewhere);
    mkdirSync(dir, { recursive: true });
    symlinkSync(credPath(elsewhere), credPath(dir));
    writeFileSync(statusPath(dir), `{"version": 1, "state": "needs-signin", "identity": ${identity}}`);
    const r = pyWithLib(home, ['print(mod.read_status(sys.argv[2]) is None)'], [dir]);
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout.trim()).toBe('True');
  });

  it.each(NEEDS_SIGNIN_CODES)('%s lands in needs-signin, and is never retried', async (code) => {
    const home = mkTmp('codex-auth-signin-code-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    await withAuth({ token: [{ status: 400, body: { error: code } }, { status: 200, body: issuedAnswer() }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh', lane: 'codex-a' }, { op: 'ensure_fresh' }]);
      expect(r.lines.map((l) => l.error), r.stderr).toEqual(['needs-signin', 'needs-signin']);
      expect(r.lines[0].message).toContain('ccrc codex login codex-a');
      expect(srv.requests, 'never retried').toHaveLength(1);
      expect(statusOf(dir)).toMatchObject({ state: 'needs-signin', lastErrorCode: code });
      expect(statusIdentity(statusText(dir))).toEqual(fileIdentity(dir));
      expectStatusClean(dir, tokensOf(t));
    });
  });

  it('invalid_client lands in config-error, and a changed library config retries once', async () => {
    const home = mkTmp('codex-auth-client-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const refused = { status: 400, body: { error: 'invalid_client' } };
    await withAuth({ token: [refused, refused, refused] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }, { op: 'ensure_fresh' }]);
      expect(r.lines.map((l) => l.error), r.stderr).toEqual(['config-error', 'config-error']);
      expect(srv.requests, 'a second call makes no request').toHaveLength(1);
      expect(statusOf(dir)).toMatchObject({ state: 'config-error', lastErrorCode: 'invalid_client' });
      const changed = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }, { op: 'ensure_fresh' }],
        { consts: { CLIENT_ID: 'app_fixture_changed' } });
      expect(changed.lines.map((l) => l.error), changed.stderr).toEqual(['config-error', 'config-error']);
      expect(srv.requests, 'the changed config retried exactly once').toHaveLength(2);
      expect(srv.requests[1].form?.client_id).toBe('app_fixture_changed');
      expectStatusClean(dir, tokensOf(t));
    });
  });

  it.each([
    ['nested', { error: { code: 'invalid_grant' } }],
    ['top-level', { code: 'invalid_grant' }],
  ])('%s: the nested and the top-level code are read as Codex reads them: needs-signin, lastErrorCode invalid_grant', async (_n, body) => {
    const { line, st } = await refusal(body);
    expect(line.error).toBe('needs-signin');
    expect(st).toMatchObject({ state: 'needs-signin', lastErrorCode: 'invalid_grant' });
  });

  it.each([
    ['an empty body', '', null],
    ['server_error', { error: 'server_error' }, 'server_error'],
  ])('a 401 is needs-signin whatever its code (%s)', async (_n, body, code) => {
    const { line, st } = await refusal(body, 401);
    expect(line.error).toBe('needs-signin');
    expect(st).toMatchObject({ state: 'needs-signin', lastErrorCode: code });
  });

  it('a 401 carrying invalid_client is config-error', async () => {
    const { line, st } = await refusal({ error: 'invalid_client' }, 401);
    expect(line.error).toBe('config-error');
    expect(st).toMatchObject({ state: 'config-error', lastErrorCode: 'invalid_client' });
  });

  it('invalid_grant on a 503 is transient, as Codex classifies it', async () => {
    const { line, st } = await refusal({ error: 'invalid_grant' }, 503);
    expect(line.error).toBe('refresh-failed');
    expect(st).toMatchObject({ state: 'ok', lastErrorCode: 'invalid_grant' });
  });

  it.each([
    ['129 characters', 'x'.repeat(129)],
    ['a control character', 'invalid\u0007grant'],
    ['a space', 'invalid grant'],
  ])('an error code outside CODE_RE is stored as unrecognised (%s)', async (_n, raw) => {
    const { line, st, text } = await refusal({ error: raw });
    expect(line.error).toBe('refresh-failed');
    expect(st.lastErrorCode).toBe('unrecognised');
    expect(text).not.toContain(raw);
    expect(text, 'nor its JSON-escaped form').not.toContain(JSON.stringify(raw).slice(1, -1));
    expect(line.message).not.toContain(raw);
  });

  it('a 400 INVALID_GRANT is needs-signin: codes are compared lower-cased, as Codex compares them', async () => {
    const { line, st } = await refusal({ error: 'INVALID_GRANT' });
    expect(line.error).toBe('needs-signin');
    expect(st.lastErrorCode).toBe('invalid_grant');
  });

  it('an empty error falls through to a top-level code, as Codex skips blank strings', async () => {
    const { line, st } = await refusal({ error: '', code: 'refresh_token_expired' });
    expect(line.error).toBe('needs-signin');
    expect(st.lastErrorCode).toBe('refresh_token_expired');
  });

  it.each([
    ['500', { status: 500, body: { error: 'server_error' } }, {}],
    ['503', { status: 503, body: 'unavailable' }, {}],
    ['a dropped connection', { status: 500, drop: true }, {}],
    ['a 1 s delay', { status: 503, delayMs: 1000 }, { TOKEN_TIMEOUT_S: 0.5 }],
  ] as Array<[string, Record<string, unknown>, Record<string, unknown>]>)('%s is transient: refresh-failed, the state is unchanged and the next call tries again', async (_n, first, consts) => {
    const home = mkTmp('codex-auth-transient-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const old = readFileSync(credPath(dir), 'utf8');
    const answer = issuedAnswer();
    await withAuth({ token: [first as never, { status: 200, body: answer }] }, async (srv) => {
      const a = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }], { consts });
      expect(a.lines[0].error, a.stderr).toBe('refresh-failed');
      expect(readFileSync(credPath(dir), 'utf8'), 'the credential is unchanged').toBe(old);
      expect(statusOf(dir), 'no state recorded against the lane').toMatchObject({ state: 'ok', lastRefreshAt: null });
      const b = await runFresh(home, dir, srv.base, [{ op: 'ensure_fresh' }], { consts });
      expect(b.status, b.stdout + b.stderr).toBe(0);
      expect(b.lines[0]).toMatchObject({ credential: 'present', access_token: (answer.access_token as string).length });
      expect(srv.requests, 'the next call tried again').toHaveLength(2);
      expect(statusOf(dir)).toMatchObject({ state: 'ok', lastErrorCode: null });
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('a 302 from the token route is refresh-failed, and its Location receives nothing', async () => {
    const home = mkTmp('codex-auth-redirect-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const old = readFileSync(credPath(dir), 'utf8');
    await withAuth({ token: [{ status: 200, body: issuedAnswer() }] }, async (elsewhere) => {
      await withAuth({ token: [{ status: 302, headers: { location: elsewhere.base + AUTH_ROUTES.token } }] }, async (srv) => {
        const r = await runFresh(home, dir, srv.base);
        expect(r.lines[0].error, r.stderr).toBe('refresh-failed');
        expect(srv.requests).toHaveLength(1);
        expect(elsewhere.requests, 'the Location was never fetched').toHaveLength(0);
        expect(readFileSync(credPath(dir), 'utf8')).toBe(old);
        expectStatusClean(dir, tokensOf(t));
      });
    });
  });

  it('a new credential clears needs-signin', async () => {
    const home = mkTmp('codex-auth-resignin-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const answer = issuedAnswer();
    await withAuth({ token: [{ status: 400, body: { error: 'invalid_grant' } }, { status: 200, body: answer }] }, async (srv) => {
      const a = await runFresh(home, dir, srv.base);
      expect(a.lines[0].error).toBe('needs-signin');
      // A sign-in elsewhere: a new credential renamed into place, a new inode.
      const side = join(home, 'signin');
      const u = plantBackendCredential(side, { expiresIn: -120 });
      renameSync(credPath(side), credPath(dir));
      const b = await runFresh(home, dir, srv.base);
      expect(b.status, b.stdout + b.stderr).toBe(0);
      expect(b.lines[0]).toMatchObject({ credential: 'present', access_token: (answer.access_token as string).length });
      expect(srv.requests).toHaveLength(2);
      expect(srv.requests[1].form?.refresh_token, 'the new credential\'s refresh token').toBe(u.refresh);
      expect(statusOf(dir).state).toBe('ok');
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(u), ...tokensOf(answer)]);
    });
  });

  it('an answer with no id_token keeps the old one; one with no refresh_token keeps the old one', async () => {
    const home = mkTmp('codex-auth-merge-');
    const dirA = join(home, 'lane-a');
    const dirB = join(home, 'lane-b');
    const a = plantBackendCredential(dirA, { expiresIn: -120 });
    const b = plantBackendCredential(dirB, { expiresIn: -120 });
    const noId = issuedAnswer({ omit: ['id_token'] });
    const noRefresh = issuedAnswer({ omit: ['refresh_token'] });
    await withAuth({ token: [{ status: 200, body: noId }, { status: 200, body: noRefresh }] }, async (srv) => {
      const r = await runFresh(home, dirA, srv.base, [{ op: 'ensure_fresh' }, { op: 'ensure_fresh', authDir: dirB }]);
      expect(r.status, r.stdout + r.stderr).toBe(0);
      expect(r.lines.map((l) => l.credential)).toEqual(['present', 'present']);
      expect(fileRecord(dirA)).toMatchObject({ access_token: noId.access_token, refresh_token: noId.refresh_token, id_token: a.id });
      expect(fileRecord(dirB)).toMatchObject({ access_token: noRefresh.access_token, refresh_token: b.refresh, id_token: noRefresh.id_token });
      expectStatusClean(dirA, [...tokensOf(a), ...tokensOf(noId)]);
      expectStatusClean(dirB, [...tokensOf(b), ...tokensOf(noRefresh)]);
    });
  });

  it.each([['a number', 5], ['null', null], ['an empty string', '']])('a stored id_token that is not a string is never written back (%s): with none in the answer, id_token is null', async (_label, stored) => {
    const home = mkTmp('codex-auth-merge-idtoken-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120, extra: { id_token: stored } });
    const answer = issuedAnswer({ omit: ['id_token'] });
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base);
      expect(r.lines[0], r.stdout + r.stderr).toMatchObject({ credential: 'present', access_token: (answer.access_token as string).length });
      const rec = fileRecord(dir);
      expect(Object.keys(rec).sort()).toEqual(['access_token', 'account_id', 'expires_at', 'id_token', 'refresh_token']);
      expect(rec.id_token).toBeNull();
      expect(rec.access_token).toBe(answer.access_token);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  /** The four places a leak would show: driver stdout, its stderr, the error's sentence and the status file. */
  const expectNowhere = (r: { stdout: string; stderr: string; lines: Array<Record<string, any>> }, dir: string, secrets: string[]): void => {
    const places = [r.stdout, r.stderr, String(r.lines[0].message ?? ''), existsSync(statusPath(dir)) ? statusText(dir) : ''];
    for (const piece of secretPieces(secrets)) {
      for (const place of places) expect(place, 'a token piece leaked').not.toContain(piece);
    }
  };

  it('an answer with no access_token is refresh-failed, writes nothing, and names none of the tokens it carried', async () => {
    const home = mkTmp('codex-auth-noaccess-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const before = lstatKey(credPath(dir));
    const bytes = readFileSync(credPath(dir));
    const answer = issuedAnswer({ omit: ['access_token'] });
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base);
      expect(r.lines[0].error, r.stderr).toBe('refresh-failed');
      expect(readFileSync(credPath(dir)).equals(bytes), 'the credential is unchanged').toBe(true);
      expect(lstatKey(credPath(dir))).toBe(before);
      expect(existsSync(pendingPath(dir)), 'no checkpoint').toBe(false);
      expectNowhere(r, dir, [...tokensOf(answer), ...tokensOf(t)]);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  const mixedCase = (hex: string): string => [...hex].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join('');
  it.each([
    ['lower-case', (): string => `rtok-fixture-${randomBytes(16).toString('hex')}`],
    ['mixed-case', (): string => `rtok-Fixture-${mixedCase(randomBytes(16).toString('hex'))}`],
  ] as Array<[string, () => string]>)('a 400 whose body echoes the submitted refresh token leaks it nowhere (%s)', async (_label, refreshOf) => {
    const home = mkTmp('codex-auth-echo-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120, refresh: refreshOf() });
    // The token is echoed as the error code itself (it fits CODE_RE) and in the description.
    const body = { error: t.refresh, error_description: `the refresh token ${t.refresh} is not valid`, token: t.access };
    await withAuth({ token: [{ status: 400, body }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base);
      expect(r.lines[0].error, r.stderr).toBe('refresh-failed');
      expect(statusOf(dir).lastErrorCode, 'an echoed token is never a code').toBe('unrecognised');
      expectNowhere(r, dir, tokensOf(t));
      // The code is lower-cased before it is bounded, so a case-folded copy of the token is a leak too.
      const folded = t.refresh.toLowerCase();
      for (const place of [String(r.lines[0].message ?? ''), statusText(dir)]) {
        expect(place.toLowerCase(), 'a case-folded token leaked').not.toContain(folded);
      }
      expectStatusClean(dir, tokensOf(t));
    });
  });

  // The plan's two names are refused by their word. The two that follow name no DNS name and reach the fake's own
  // listener when connected to (0.0.0.0 and the IPv4-mapped loopback both land on 127.0.0.1), so its request count is
  // a real check: a refusal that let them through would be seen there, with no query leaving the box.
  it.each([
    ['http://example.invalid', (): string => 'http://example.invalid'],
    ['https://127.0.0.1.example.invalid', (): string => 'https://127.0.0.1.example.invalid'],
    ['http://0.0.0.0:<the fake\'s port>', (port: string): string => `http://0.0.0.0:${port}`],
    ['http://[::ffff:127.0.0.1]:<the fake\'s port>', (port: string): string => `http://[::ffff:127.0.0.1]:${port}`],
  ] as Array<[string, (port: string) => string]>)('a non-loopback CCRC_CODEX_AUTH_BASE is refused before any request (%s)', async (_label, baseOf) => {
    const home = mkTmp('codex-auth-nonloop-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    await withAuth({ token: [{ status: 200, body: issuedAnswer() }] }, async (srv) => {
      const r = await runFresh(home, dir, baseOf(new URL(srv.base).port));
      expect(r.lines[0].error, r.stderr).toBe('auth-endpoint-refused');
      expect(srv.requests, 'the fake (bound anyway) saw nothing').toHaveLength(0);
      expectStatusClean(dir, tokensOf(t));
    });
  });

  it('an answer larger than ANSWER_MAX_BYTES is refresh-failed (refresh-response-unreadable) and writes nothing', async () => {
    const home = mkTmp('codex-auth-answer-big-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const bytes = readFileSync(credPath(dir));
    const answer = { ...issuedAnswer(), padding: 'p'.repeat((1 << 20) + 4096) };
    await withAuth({ token: [{ status: 200, body: answer }] }, async (srv) => {
      const r = await runFresh(home, dir, srv.base);
      expect(r.lines[0].error, r.stdout + r.stderr).toBe('refresh-failed');
      expect(srv.requests).toHaveLength(1);
      expect(readFileSync(credPath(dir)).equals(bytes), 'the credential is unchanged').toBe(true);
      expect(statusOf(dir).lastErrorCode).toBe('refresh-response-unreadable');
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    });
  });

  it('an answer sent slowly is cut at TOKEN_TIMEOUT_S from the request, not stretched by each read', async () => {
    const home = mkTmp('codex-auth-answer-slow-');
    const dir = laneDir(home);
    const t = plantBackendCredential(dir, { expiresIn: -120 });
    const bytes = readFileSync(credPath(dir));
    const answer = issuedAnswer();
    const text = JSON.stringify(answer);
    // Sixteen pieces 150 ms apart: each read waits far less than the 0.5 s timeout, the whole answer 2.4 s.
    const pieces = Array.from({ length: 16 }, (_, i) => text.slice(Math.floor((i * text.length) / 16), Math.floor(((i + 1) * text.length) / 16)));
    const timers: NodeJS.Timeout[] = [];
    let requests = 0;
    const server = createServer((req, res) => {
      requests += 1;
      req.resume();
      res.on('error', () => undefined);
      res.writeHead(200, { 'content-type': 'application/json' });
      pieces.forEach((piece, i) => timers.push(setTimeout(() => {
        if (res.destroyed) return;
        if (i === pieces.length - 1) res.end(piece);
        else res.write(piece);
      }, 150 * (i + 1))));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      const r = await runFresh(home, dir, base, [{ op: 'ensure_fresh' }], { consts: { TOKEN_TIMEOUT_S: 0.5 } });
      expect(r.lines[0].error, r.stdout + r.stderr).toBe('refresh-failed');
      expect(r.lines[0].ms, 'the request ends near its 0.5 s bound').toBeLessThan(1500);
      expect(requests).toBe(1);
      expect(readFileSync(credPath(dir)).equals(bytes), 'the credential is unchanged').toBe(true);
      expectStatusClean(dir, [...tokensOf(t), ...tokensOf(answer)]);
    } finally {
      for (const timer of timers) clearTimeout(timer);
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('the status file never holds a token, a JWT segment or the account id', async () => {
    // Run alone (`-t`), the cases above left nothing to re-check: make one ok and one needs-signin status here.
    if (STATUS_SCANS.length === 0) {
      const home = mkTmp('codex-auth-scan-');
      const dirs = [join(home, 'lane-a'), join(home, 'lane-b')];
      const planted = dirs.map((d) => plantBackendCredential(d, { expiresIn: -120 }));
      const answer = issuedAnswer();
      await withAuth({ token: [{ status: 200, body: answer }, { status: 400, body: { error: 'invalid_grant' } }] }, async (srv) => {
        await runFresh(home, dirs[0], srv.base, [{ op: 'ensure_fresh' }, { op: 'ensure_fresh', authDir: dirs[1] }]);
      });
      expectStatusClean(dirs[0], [...tokensOf(planted[0]), ...tokensOf(answer)]);
      expectStatusClean(dirs[1], tokensOf(planted[1]));
    }
    const scans = [...STATUS_SCANS];
    expect(scans.filter((s) => existsSync(statusPath(s.dir))).length, 'some case left a status file').toBeGreaterThan(0);
    for (const s of scans) {
      if (!existsSync(statusPath(s.dir))) continue;
      const text = statusText(s.dir);
      for (const piece of secretPieces(s.secrets)) expect(text).not.toContain(piece);
      for (const id of [FIXTURE_ACCOUNT_ID, ISSUED_ACCOUNT_ID, 'acct-fixture-1']) expect(text).not.toContain(id);
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
