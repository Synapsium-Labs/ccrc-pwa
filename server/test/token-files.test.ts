// The box-token file adapter (server/src/token/files.ts, spec 4.2): measured
// reads that keep absent, unusable, placeholder and unreadable apart; the one
// atomic, fsynced, 0600-from-birth write; the fleet file's preamble rule; and
// the five readers of a fleet token file agreeing on what the writer wrote.
// Fixture homes only (mkTmp); no secret file outside them is ever read.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs, {
  chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  appendRetired, fileExists, fleetFileText, mintClaimCode, mintGenerationId, mintValue, readAgentEnvMarksFleet, readRetired,
  readState, readValueFile, tokenPaths, valueDigestHex, writeFleetTokenFile, writeGenerationFile, writeState,
  writeValueFileAtomic,
} from '../src/token/files.js';
import { mintedState } from '../src/token/policy.js';
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
