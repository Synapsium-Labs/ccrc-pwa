// The box-token file adapter (server/src/token/files.ts, spec 4.2): measured
// reads that keep absent, unusable, placeholder and unreadable apart; the one
// atomic, fsynced, 0600-from-birth write; the fleet file's preamble rule; and
// the five readers of a fleet token file agreeing on what the writer wrote.
// Fixture homes only (mkTmp); no secret file outside them is ever read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs, {
  chmodSync, existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendRetired, fileExists, fleetFileText, mintClaimCode, mintGenerationId, mintValue, moveAsideUnusable, readAgentEnvMarksFleet, readRetired,
  readState, readValueFile, tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile, writeState,
  writeValueFileAtomic,
} from '../src/token/files.js';
import { PENDING_HARD_CAP, handedOutState, mintedState, stagedState } from '../src/token/policy.js';
import { extractToken, PLACEHOLDER_TOKEN } from '../src/coord/token.js';
import { FLEET_TOKEN_FILE_COMMENT, GENERATION_ID_RE, TOKEN_VALUE_RE } from '../../shared/box-token.js';
import { isClaimCode } from '../../shared/agent-protocol.js';
import { mkTmp } from './tmpHelpers.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const isRoot = typeof process.getuid === 'function' && process.getuid() === 0;
const V = 'a'.repeat(64);
const W = 'b'.repeat(64);

afterEach(() => { vi.restoreAllMocks(); });

const fixture = (): { home: string; dir: string } => {
  const home = mkTmp('ccrc-token-files-');
  const dir = path.join(home, '.ccrc');
  mkdirSync(dir, { recursive: true });
  return { home, dir };
};
const temps = (dir: string): string[] => readdirSync(dir).filter((n) => n.includes('.tmp-'));

describe('tokenPaths', () => {
  it('derives every server path from dirname(mailTokenPath), and the node and fleet paths from the home', () => {
    // The generation file is a NODE file: the verb, doctor and uninstall name $HOME/.ccrc/box-token-generation, so a
    // moved mail.token (CCRC_MAIL_TOKEN_PATH) never moves it.
    const p = tokenPaths('/x/elsewhere/mail.token', '/h');
    expect(p).toMatchObject({
      dir: '/x/elsewhere', current: '/x/elsewhere/mail.token', previous: '/x/elsewhere/mail-previous.token',
      state: '/x/elsewhere/box-token.json', retired: '/x/elsewhere/box-token-retired.json',
      generation: '/h/.ccrc/box-token-generation', fleetFile: '/h/.cc-secrets/ccrc-mail.token',
      agentEnv: '/h/.ccrc/agent.env',
    });
    expect(p.pending('0123456789abcdef')).toBe('/x/elsewhere/mail-pending-0123456789abcdef.token');
    expect(() => p.pending('../x')).toThrow(RangeError);
  });
});

describe('readValueFile keeps four outcomes apart', () => {
  it('absent only on a proven ENOENT', async () => {
    const { dir } = fixture();
    expect(await readValueFile(path.join(dir, 'mail.token'))).toEqual({ kind: 'absent' });
  });

  it.each([
    ['0 bytes', ''], ['whitespace only', ' \n\t\n'], ['comments only', '# a\n# b\n'],
  ])('unusable, with its lstat meta: %s', async (_n, content) => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, content, { mode: 0o600 });
    const r = await readValueFile(p);
    expect(r.kind).toBe('unusable');
    if (r.kind !== 'unusable') return;
    const st = lstatSync(p);
    expect(r.meta).toEqual({ dev: st.dev, ino: st.ino, mtimeMs: st.mtimeMs, mode: 0o600, kind: 'regular' });
  });

  it('placeholder for the shipped example value', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, `# copied\n${PLACEHOLDER_TOKEN}\n`);
    expect(await readValueFile(p)).toEqual({ kind: 'placeholder' });
  });

  it('a value by extractToken\'s rule, preamble skipped', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, `# preamble\n\n ${V} \n`);
    const r = await readValueFile(p);
    expect(r.kind === 'value' && r.value).toBe(V);
  });

  it('unreadable with the errno word: a directory, a dangling link, and EACCES', async () => {
    const { dir } = fixture();
    mkdirSync(path.join(dir, 'isdir'));
    expect(await readValueFile(path.join(dir, 'isdir'))).toEqual({ kind: 'unreadable', code: 'EISDIR' });
    symlinkSync(path.join(dir, 'gone'), path.join(dir, 'dangling'));
    expect(await readValueFile(path.join(dir, 'dangling'))).toEqual({ kind: 'unreadable', code: 'ENOENT' });
    if (!isRoot) {
      const p = path.join(dir, 'locked');
      writeFileSync(p, `${V}\n`);
      chmodSync(p, 0o000);
      expect(await readValueFile(p)).toEqual({ kind: 'unreadable', code: 'EACCES' });
    }
  });

  it('a symlink reads through and is reported as a symlink', async () => {
    const { dir } = fixture();
    writeFileSync(path.join(dir, 'real'), `${V}\n`);
    symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
    const r = await readValueFile(path.join(dir, 'link'));
    expect(r.kind === 'value' && r.meta.kind).toBe('symlink');
  });
});

describe('writeValueFileAtomic', () => {
  it('opens its temp O_EXCL at 0600 and the file is 0600 even under umask 0', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    const open = vi.spyOn(fs.promises, 'open');
    const old = process.umask(0);
    try { await writeValueFileAtomic(p, `${V}\n`); } finally { process.umask(old); }
    const call = open.mock.calls[0];
    expect(path.basename(String(call[0]))).toMatch(/^\.mail\.token\.tmp-[0-9a-f]{16}$/);
    expect(Number(call[1]) & fs.constants.O_EXCL).toBe(fs.constants.O_EXCL);
    expect(Number(call[1]) & fs.constants.O_CREAT).toBe(fs.constants.O_CREAT);
    expect(call[2]).toBe(0o600);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toBe(`${V}\n`);
    expect(temps(dir)).toEqual([]);
  });

  it('returns the write record of the renamed file: its (dev, ino), and a time no earlier than its mtime', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    const rec = await writeValueFileAtomic(p, `${V}\n`);
    const st = lstatSync(p);
    expect([rec.dev, rec.ino]).toEqual([st.dev, st.ino]);
    expect(st.mtimeMs).toBeLessThanOrEqual(rec.writtenAtMs);
    // A second write is a new inode (the 4.2.1 proof tells a replaced file by exactly this).
    const rec2 = await writeValueFileAtomic(p, `${W}\n`);
    expect(rec2.ino).not.toBe(rec.ino);
  });

  it.each([
    ['the rename', 'rename'], ['the open', 'open'],
  ] as const)('a failure injected at %s leaves the old file byte-equal and no temp behind', async (_n, step) => {
    const { dir } = fixture();
    const p = path.join(dir, 'mail.token');
    writeFileSync(p, `# keep me\n${V}\n`, { mode: 0o600 });
    const before = readFileSync(p);
    const ino = lstatSync(p).ino;
    vi.spyOn(fs.promises, step).mockRejectedValueOnce(Object.assign(new Error('injected'), { code: 'ENOSPC' }));
    await expect(writeValueFileAtomic(p, `${W}\n`)).rejects.toThrow('injected');
    expect(readFileSync(p).equals(before)).toBe(true);
    expect(lstatSync(p).ino).toBe(ino);
    expect(temps(dir)).toEqual([]);
  });
});

describe('box-token.json and box-token-retired.json', () => {
  it('state round-trips; garbage and a wrong shape read unusable; a missing file reads absent', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    expect(await readState(p)).toEqual({ kind: 'absent' });
    const s = mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');
    await writeState(p, s);
    expect(await readState(p)).toEqual({ kind: 'state', state: s });
    expect(statSync(p).mode & 0o777).toBe(0o600);
    writeFileSync(p, '{not json');
    expect(await readState(p)).toEqual({ kind: 'unusable' });
    writeFileSync(p, JSON.stringify({ ...s, origin: 'stolen' }));
    expect(await readState(p)).toEqual({ kind: 'unusable' });
  });

  it('fileProblem is optional: absent, null or a known finding reads; an unknown word is unusable (plan assembly)', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    const s = mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');
    const withProblem = { ...s, fileProblem: { at: 2000, file: 'current' as const, word: 'changed' as const } };
    await writeState(p, withProblem);
    expect(await readState(p)).toEqual({ kind: 'state', state: withProblem });
    await writeState(p, { ...s, fileProblem: null });
    expect((await readState(p)).kind).toBe('state');
    writeFileSync(p, JSON.stringify({ ...s, fileProblem: { at: 2000, file: 'current', word: 'stolen' } }));
    expect(await readState(p)).toEqual({ kind: 'unusable' });
  });

  // D-4403: the seven fields and promoting.id the plan's first check left unvalidated.
  it('a state with a missing or malformed field reads unusable, and a fully populated valid one reads state (D-4403)', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    const s = mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');
    const full = {
      ...s, promoting: { id: 'fedcba9876543210' }, recovering: { source: 'previous' as const }, holdNode: 'n1',
      lastFailure: 'x', lastSync: { at: 5, word: 'synced', transport: 'https' as const }, retiredRefusedAt: 6,
      mintFailedAt: 7, lastBootRecovery: { at: 8, source: 'pending' as const },
    };
    await writeState(p, full);
    expect(await readState(p)).toEqual({ kind: 'state', state: full });
    await writeState(p, { ...full, lastSync: { at: 5, word: 'synced', transport: 'unmeasured' } });
    expect((await readState(p)).kind).toBe('state');
    const without = (k: string): Record<string, unknown> => { const o: Record<string, unknown> = { ...s }; delete o[k]; return o; };
    const bad: [string, Record<string, unknown>][] = [
      ['recovering missing', without('recovering')],
      ['recovering a string', { ...s, recovering: 'x' }],
      ['recovering with a junk source', { ...s, recovering: { source: 'current' } }],
      ['holdNode missing', without('holdNode')],
      ['holdNode a number', { ...s, holdNode: 3 }],
      ['lastFailure missing', without('lastFailure')],
      ['lastSync with a junk transport', { ...s, lastSync: { at: 1, word: 'synced', transport: 'ftp' } }],
      ['lastSync missing', without('lastSync')],
      ['retiredRefusedAt a string', { ...s, retiredRefusedAt: 'x' }],
      ['mintFailedAt missing', without('mintFailedAt')],
      ['lastBootRecovery with a junk source', { ...s, lastBootRecovery: { at: 1, source: 'x' } }],
      ['promoting with a non-hex id', { ...s, promoting: { id: 'nothex' } }],
    ];
    for (const [name, v] of bad) {
      writeFileSync(p, JSON.stringify(v));
      expect(await readState(p), name).toEqual({ kind: 'unusable' });
    }
  });

  // F4 (review 349) with D-4413: `pending` is bounded by the cap, so an over-cap list is never handed to a consumer
  // that throws on it (BoxTokenHolder.setSlots) - it reads unusable, like every other malformed shape.
  it('pending is bounded to the cap: three read as a state, a fourth reads unusable (F4, D-4413)', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    let s = mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');
    const withN = (n: number) => {
      let x = s;
      for (let i = 0; i < n; i++) {
        const id = String(i + 1).repeat(16);
        x = handedOutState(stagedState(x, id, 2000 + i, { dev: 1, ino: 10 + i, writtenAtMs: 2000 }), id, 3000 + i);
      }
      return x;
    };
    expect(PENDING_HARD_CAP).toBe(3);
    for (let n = 0; n <= PENDING_HARD_CAP; n++) {
      writeFileSync(p, JSON.stringify(withN(n)));
      expect((await readState(p)).kind, `${n} pending`).toBe('state');
    }
    writeFileSync(p, JSON.stringify(withN(PENDING_HARD_CAP + 1)));
    expect(await readState(p)).toEqual({ kind: 'unusable', why: 'over-cap' });
    s = withN(PENDING_HARD_CAP + 3);
    writeFileSync(p, JSON.stringify(s));
    expect(await readState(p)).toEqual({ kind: 'unusable', why: 'over-cap' });
    // any other malformed content keeps D-4403's plain unusable arm, over-cap or not
    writeFileSync(p, JSON.stringify({ ...withN(PENDING_HARD_CAP + 1), origin: 'stolen' }));
    expect(await readState(p)).toEqual({ kind: 'unusable' });
    writeFileSync(p, '{"v":1,"pending":[1,2,3,4]}');
    expect(await readState(p)).toEqual({ kind: 'unusable' });
  });

  // Conventions I1 (D-4403 item 2): a read FAILURE is not malformed content; the two need different handling.
  it('a state or retired file that cannot be read answers unreadable with the errno word, never unusable (D-4403)', async () => {
    const { dir } = fixture();
    const sp = path.join(dir, 'box-token.json');
    const rp = path.join(dir, 'box-token-retired.json');
    mkdirSync(sp);                                   // EISDIR on read: a read failure that holds as root too
    mkdirSync(rp);
    expect(await readState(sp)).toEqual({ kind: 'unreadable', code: 'EISDIR' });
    expect(await readRetired(rp)).toEqual({ kind: 'unreadable', code: 'EISDIR' });
    // Still told apart from the other two outcomes.
    expect(await readState(path.join(dir, 'nope.json'))).toEqual({ kind: 'absent' });
    expect(await readRetired(path.join(dir, 'nope.json'))).toEqual({ kind: 'absent' });
    const bad = path.join(dir, 'bad.json');
    writeFileSync(bad, '{not json');
    expect(await readState(bad)).toEqual({ kind: 'unusable' });
    expect(await readRetired(bad)).toEqual({ kind: 'unusable' });
  });

  it('retired digests append once each, and an unusable file is never rewritten', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token-retired.json');
    expect(await readRetired(p)).toEqual({ kind: 'absent' });
    await appendRetired(p, valueDigestHex(V), 1);
    await appendRetired(p, valueDigestHex(V), 2);
    await appendRetired(p, valueDigestHex(W), 3);
    expect(await readRetired(p)).toEqual({ kind: 'retired', digests: [valueDigestHex(V), valueDigestHex(W)] });
    expect(JSON.parse(readFileSync(p, 'utf8')).retired[0]).toEqual({ len: 64, sha256: valueDigestHex(V), at: 1 });
    writeFileSync(p, '{"v":1,"retired":"no"}');
    const before = readFileSync(p);
    await expect(appendRetired(p, valueDigestHex(V), 4)).rejects.toThrow(/unusable/);
    expect(readFileSync(p).equals(before)).toBe(true);
  });
});

// D-4410: the retiring record is a persisted field; box-token.json must accept it and stay strict about its shape.
describe('box-token.json carries the retiring record (D-4410)', () => {
  const base = () => mintedState(1000, { dev: 1, ino: 2, writtenAtMs: 1000 }, null, null, '0123456789abcdef');

  it('retiring is optional: absent, null, [] or entries of the shape read as a state, unchanged', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    for (const retiring of [undefined, null, [], [{ sha256: V, at: 5 }], [{ sha256: V, at: 5 }, { sha256: W, at: 6 }]]) {
      const s = { ...base(), ...(retiring === undefined ? {} : { retiring }) };
      writeFileSync(p, JSON.stringify(s));
      expect(await readState(p), JSON.stringify(retiring)).toEqual({ kind: 'state', state: s });
    }
  });

  it('anything but the shape reads unusable, never state: a non-array, a junk entry, a non-hex or upper-case digest', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token.json');
    const bad: [string, unknown][] = [
      ['a string', 'x'], ['an object', { sha256: V, at: 1 }], ['a number', 3],
      ['an entry that is a string', [V]], ['an entry with no sha256', [{ at: 1 }]], ['an entry with no at', [{ sha256: V }]],
      ['a short digest', [{ sha256: 'a'.repeat(63), at: 1 }]], ['a long digest', [{ sha256: 'a'.repeat(65), at: 1 }]],
      ['an upper-case digest', [{ sha256: 'A'.repeat(64), at: 1 }]], ['a non-hex digest', [{ sha256: 'g'.repeat(64), at: 1 }]],
      ['at a string', [{ sha256: V, at: '1' }]], ['at NaN-like null', [{ sha256: V, at: null }]], ['one good, one bad', [{ sha256: V, at: 1 }, { sha256: 'x', at: 1 }]],
    ];
    for (const [name, retiring] of bad) {
      writeFileSync(p, JSON.stringify({ ...base(), retiring }));
      expect(await readState(p), name).toEqual({ kind: 'unusable' });
    }
  });
});

// D-4410: a retired file that cannot be READ is never "unusable" (boot refuses on the one, moves the other aside).
describe('the retired file: unreadable is never unusable (D-4410, D-4403 item 2)', () => {
  it('a read failure answers unreadable with the errno word, and appendRetired names it as unreadable, not unusable', async () => {
    const { dir } = fixture();
    const rp = path.join(dir, 'box-token-retired.json');
    mkdirSync(rp);                                              // EISDIR: a read failure that holds as root too
    expect(await readRetired(rp)).toEqual({ kind: 'unreadable', code: 'EISDIR' });
    const err = await appendRetired(rp, valueDigestHex(V), 1).then(() => null, (e: unknown) => e as Error);
    expect(err?.message).toContain('unreadable (EISDIR)');
    expect(err?.message).not.toContain('unusable');
  });

  it.skipIf(isRoot)('EACCES reads unreadable too (never unusable), and appendRetired leaves the file alone', async () => {
    const { dir } = fixture();
    const rp = path.join(dir, 'box-token-retired.json');
    await appendRetired(rp, valueDigestHex(V), 1);
    chmodSync(rp, 0o000);
    try {
      expect(await readRetired(rp)).toEqual({ kind: 'unreadable', code: 'EACCES' });
      await expect(appendRetired(rp, valueDigestHex(W), 2)).rejects.toThrow(/unreadable \(EACCES\)/);
    } finally { chmodSync(rp, 0o600); }
    expect(await readRetired(rp)).toEqual({ kind: 'retired', digests: [valueDigestHex(V)] });
  });
});

describe('moveAsideUnusable: a file set aside under a new name, never overwritten (D-4410)', () => {
  it('moves the bytes to <path>.unusable-<tag>, the original path is then absent', async () => {
    const { dir } = fixture();
    const rp = path.join(dir, 'box-token-retired.json');
    writeFileSync(rp, '{not json', { mode: 0o600 });
    const to = await moveAsideUnusable(rp, 1234);
    expect(to).toBe(`${rp}.unusable-1234`);
    expect(readFileSync(to, 'utf8')).toBe('{not json');
    expect(statSync(to).mode & 0o777).toBe(0o600);
    expect(existsSync(rp)).toBe(false);
  });

  it('never overwrites a file already holding the name: it takes the next free one and leaves the other byte-equal', async () => {
    const { dir } = fixture();
    const rp = path.join(dir, 'box-token-retired.json');
    writeFileSync(rp, 'second');
    writeFileSync(`${rp}.unusable-9`, 'first');
    writeFileSync(`${rp}.unusable-9-1`, 'third');
    const to = await moveAsideUnusable(rp, 9);
    expect(to).toBe(`${rp}.unusable-9-2`);
    expect(readFileSync(`${rp}.unusable-9`, 'utf8')).toBe('first');
    expect(readFileSync(`${rp}.unusable-9-1`, 'utf8')).toBe('third');
    expect(readFileSync(to, 'utf8')).toBe('second');
    expect(existsSync(rp)).toBe(false);
  });
});

describe('mints', () => {
  it('64 lowercase hex values, 16 hex generation ids and 43-character codes, never repeated', () => {
    const vs = new Set([mintValue(), mintValue()]);
    for (const v of vs) expect(v).toMatch(TOKEN_VALUE_RE);
    expect(vs.size).toBe(2);
    expect(mintGenerationId()).toMatch(GENERATION_ID_RE);
    const c = mintClaimCode();
    expect(c).toHaveLength(43);
    expect(isClaimCode(c)).toBe(true);
  });
});

describe('the fleet token file', () => {
  it('fleetFileText: no file gets the fixed comment line; an existing preamble is kept verbatim and in order', () => {
    expect(fleetFileText(null, V)).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${V}\n`);
    expect(fleetFileText(`# one\n\n#  two  \n${W}\n`, V)).toBe(`# one\n\n#  two  \n${V}\n`);
    expect(fleetFileText(`${W}\n`, V)).toBe(`${V}\n`);
  });

  it('creates ~/.cc-secrets at 0700 only when absent, and the file is 0600', async () => {
    const { home } = fixture();
    const p = path.join(home, '.cc-secrets', 'ccrc-mail.token');
    await writeFleetTokenFile(p, V);
    expect(statSync(path.dirname(p)).mode & 0o777).toBe(0o700);
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readFileSync(p, 'utf8')).toBe(`${FLEET_TOKEN_FILE_COMMENT}\n${V}\n`);
  });

  it('never chmods an existing ~/.cc-secrets', async () => {
    const { home } = fixture();
    const d = path.join(home, '.cc-secrets');
    mkdirSync(d, { mode: 0o750 });
    chmodSync(d, 0o750);
    await writeFleetTokenFile(path.join(d, 'ccrc-mail.token'), V);
    expect(statSync(d).mode & 0o777).toBe(0o750);
  });

  it('writeGenerationFile writes `<id>\\n` at 0600 and refuses anything else', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'box-token-generation');
    await writeGenerationFile(p, '0123456789abcdef');
    expect(readFileSync(p, 'utf8')).toBe('0123456789abcdef\n');
    expect(statSync(p).mode & 0o777).toBe(0o600);
    await expect(writeGenerationFile(p, 'nope')).rejects.toThrow(RangeError);
  });

  it('fileExists answers by lstat: a dangling link exists', async () => {
    const { dir } = fixture();
    expect(await fileExists(path.join(dir, 'nothing'))).toBe(false);
    symlinkSync(path.join(dir, 'gone'), path.join(dir, 'l'));
    expect(await fileExists(path.join(dir, 'l'))).toBe(true);
  });

  // D-4399 (plan assembly): agent.env marks a fleet box by its CCRC_AGENT_TOKEN key, which every
  // `ccrc install --role fleet` writes and the README's single-box line never does. Values are minted here, never typed.
  it('readAgentEnvMarksFleet: absent and the README single-box file do not mark a fleet box; the agent key or a read failure does', async () => {
    const { dir } = fixture();
    const p = path.join(dir, 'agent.env');
    const key = ['CCRC', 'AGENT', 'TOKEN'].join('_');
    expect(await readAgentEnvMarksFleet(p)).toBe(false);
    writeFileSync(p, 'CCRC_SERVER_URL=http://127.0.0.1:7788\n', { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(false);
    writeFileSync(p, `# ${key}= in a comment is not a key\nCCRC_SERVER_URL=ws://127.0.0.1:1\n`, { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(false);
    writeFileSync(p, `CCRC_SERVER_URL=ws://127.0.0.1:1\n${key}=${mintValue()}\n`, { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(true);
    writeFileSync(p, `export ${key}=${mintValue()}\n`, { mode: 0o600 });
    expect(await readAgentEnvMarksFleet(p)).toBe(true);
    rmSync(p);
    mkdirSync(p);                                                  // present but not readable as a file: unknown -> marks
    expect(await readAgentEnvMarksFleet(p)).toBe(true);
  });
});

// Spec 10.1, "Readers agree on the written file": every reader of the fleet file, sliced out of the shipped
// script (never re-typed), run over the bytes writeFleetTokenFile wrote.
describe('the five readers extract the same value from the written fleet file', () => {
  const read = (rel: string): string => readFileSync(path.join(repoRoot, rel), 'utf8');
  const oneLine = (rel: string, re: RegExp): string => {
    const hits = read(rel).split('\n').filter((l) => re.test(l));
    if (hits.length !== 1) throw new Error(`${rel}: expected one extraction line, found ${hits.length}`);
    return hits[0].trim();
  };
  const notify = read('deploy/notify.sh');
  const notifySnippet = notify.slice(notify.indexOf('TOKEN_FILE='), notify.indexOf('ADDR="${CCRC_ADDR:-}"'));
  const shellReaders: [string, string, string][] = [
    ['deploy/notify.sh', notifySnippet, 'tok'],
    ['ccd/ccrc-api', oneLine('ccd/ccrc-api', /^\s*t=\$\(grep -v /), 't'],
    ['ccd/ccd-pool-sync', oneLine('ccd/ccd-pool-sync', /^tok=\$\(grep -vE /), 'tok'],
    ['ccd/ccd-update-sync', oneLine('ccd/ccd-update-sync', /^tok=\$\(grep -vE /), 'tok'],
  ];
  const run = (snippet: string, v: string, file: string): string =>
    execFileSync('bash', ['-c', `TOKEN_FILE="$F"\n${snippet}\nprintf '%s' "$${v}"`],
      { env: { PATH: process.env.PATH ?? '/usr/bin:/bin', F: file, CCRC_MAIL_TOKEN_FILE: file } }).toString();

  it.each([
    ['a new file (fixed comment line)', null],
    ['an existing file with a comment preamble', `# hand-made\n#   with spaces\n\n${W}\n`],
  ])('%s', async (_n, existing) => {
    const { home } = fixture();
    const p = path.join(home, '.cc-secrets', 'ccrc-mail.token');
    if (existing !== null) { mkdirSync(path.dirname(p), { mode: 0o700 }); writeFileSync(p, existing, { mode: 0o600 }); }
    await writeFleetTokenFile(p, V);
    const server = extractToken(readFileSync(p, 'utf8'));
    expect(server).toBe(V);
    for (const [name, snippet, v] of shellReaders) expect(run(snippet, v, p), name).toBe(V);
    expect(shellReaders).toHaveLength(4);   // plus the server's own: five
  });
});
